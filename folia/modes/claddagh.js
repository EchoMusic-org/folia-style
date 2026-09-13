// 回环模式：移植自 folia-major src/components/visualizer/claddagh/VisualizerCladdagh.tsx
// 椭圆环形歌词：每行字符沿细长椭圆弧排布（副轴 = Rx*0.09），行间相隔 180°，
// 切行时整环以 spring(stiffness 55, damping 14, mass 0.9) 自转；
// 每字符的深度 D / 焦点 F / 透明度 / 缩放 / 模糊 / 切向倾斜全部由弧上位置公式化得出；
// 音频响应：半径随 power 缩放（按强度分档），中轴线随 bass/vocal 脉动变色。
// 字符 advance 用 pretext 测量（缺失时回退 canvas measureText）。
(function () {
  'use strict'

  var Runtime = window.FoliaVisualizerRuntime
  var GraphemeTiming = window.FoliaGraphemeTiming
  var ColorMix = window.FoliaColorMix
  var WordColoring = window.FoliaWordColoring
  var LyricsData = window.FoliaLyricsData

  // 原版 DEFAULT_CLADDAGH_TUNING
  var TUNING = { focusScaleRatio: 0.65, radiusScale: 1.0, ellipseTiltDeg: 45, showAxisLine: true, letterSpacingOffset: 0 }

  var CLADDAGH_MAX_ARC_SPAN = 4.25
  var CLADDAGH_LETTER_SPACING_EM = 0.04
  var CLADDAGH_BASE_TRACKING_EM = 0.18
  var CLADDAGH_BACK_FOLLOW_RATIO = 0.28
  var CLADDAGH_BACK_ORBIT_FOLLOW_RATIO = 0.52
  var CLADDAGH_NEXT_LINE_ENTRY_LEAD_SECONDS = 0.34
  var SPACING_CACHE_LIMIT = 240
  var spacingCache = new Map()

  function clamp(value, min, max) { return Math.max(min, Math.min(max, value)) }

  function isCJKChar(char) {
    return /[\u4e00-\u9fa5\u3040-\u30ff\uac00-\ud7af]/.test(char)
  }

  // 句子的视觉长度分：CJK 记 1.0，半角记 0.5
  function getVisualLength(text) {
    if (!text) return 0
    var score = 0
    for (var i = 0; i < text.length; i += 1) {
      score += isCJKChar(text[i]) ? 1.0 : 0.5
    }
    return score
  }

  // 空隙字符（ startTime===endTime ）平滑分配时长：必要时向相邻字符借时间
  function adjustCladdaghTimeline(timeline, line) {
    if (timeline.length === 0) return timeline

    var adjusted = timeline.map(function (item) { return Object.assign({}, item) })
    var n = adjusted.length
    var i = 0

    while (i < n) {
      if (adjusted[i].startTime === adjusted[i].endTime) {
        var j = i
        while (j < n && adjusted[j].startTime === adjusted[j].endTime) j += 1
        var gapCount = j - i
        var gapStart = i > 0 ? adjusted[i - 1].endTime : line.startTime
        var gapEnd = j < n ? adjusted[j].startTime : line.endTime

        var minNeeded = gapCount * 0.06
        var duration = gapEnd - gapStart

        if (duration < minNeeded) {
          var deficit = minNeeded - duration
          if (i > 0 && j < n) {
            var half = deficit / 2
            var prevDuration = adjusted[i - 1].endTime - adjusted[i - 1].startTime
            var prevSteal = Math.min(half, Math.max(0, prevDuration - 0.04))
            var nextDuration = adjusted[j].endTime - adjusted[j].startTime
            var nextSteal = Math.min(deficit - prevSteal, Math.max(0, nextDuration - 0.04))
            gapStart -= prevSteal
            gapEnd += nextSteal
            adjusted[i - 1].endTime = gapStart
            adjusted[j].startTime = gapEnd
          } else if (i > 0) {
            var prevDuration2 = adjusted[i - 1].endTime - adjusted[i - 1].startTime
            var prevSteal2 = Math.min(deficit, Math.max(0, prevDuration2 - 0.04))
            gapStart -= prevSteal2
            adjusted[i - 1].endTime = gapStart
          } else if (j < n) {
            var nextDuration2 = adjusted[j].endTime - adjusted[j].startTime
            var nextSteal2 = Math.min(deficit, Math.max(0, nextDuration2 - 0.04))
            gapEnd += nextSteal2
            adjusted[j].startTime = gapEnd
          }
          duration = gapEnd - gapStart
        }

        var gapUnit = duration > 0 ? duration / gapCount : 0
        for (var k = i; k < j; k += 1) {
          var idxInGap = k - i
          adjusted[k].startTime = gapStart + gapUnit * idxInGap
          adjusted[k].endTime = gapStart + gapUnit * (idxInGap + 1)
        }
        i = j
      } else {
        i += 1
      }
    }

    return adjusted
  }

  // 让切向旋转保持可读（不出现倒置字形）
  function normalizeReadableAngle(degrees) {
    var normalized = degrees
    while (normalized > 90) normalized -= 180
    while (normalized < -90) normalized += 180
    return normalized
  }

  function rememberSpacingOffsets(key, offsets) {
    if (spacingCache.size >= SPACING_CACHE_LIMIT) {
      var oldestKey = spacingCache.keys().next().value
      spacingCache.delete(oldestKey)
    }
    spacingCache.set(key, offsets)
    return offsets
  }

  function measureCladdaghTextWidth(text, fontSpec, fontPx, fallbackWidth) {
    if (!text) return 0
    var pretext = window.Pretext
    if (pretext && typeof pretext.measureNaturalWidth === 'function' && typeof pretext.prepareWithSegments === 'function') {
      try {
        var prepared = pretext.prepareWithSegments(text, fontSpec, {
          whiteSpace: 'pre-wrap',
          letterSpacing: fontPx * CLADDAGH_LETTER_SPACING_EM
        })
        var measuredWidth = pretext.measureNaturalWidth(prepared)
        if (Number.isFinite(measuredWidth) && measuredWidth > 0) return measuredWidth
      } catch (e) { /* 回退 */ }
    }
    // canvas measureText 回退
    var canvas = measureCladdaghTextWidth.__canvas || (measureCladdaghTextWidth.__canvas = document.createElement('canvas'))
    var ctx = canvas.getContext('2d')
    if (ctx) {
      ctx.font = fontSpec
      return ctx.measureText(text).width + Math.max(0, text.length - 1) * fontPx * CLADDAGH_LETTER_SPACING_EM
    }
    return fallbackWidth
  }

  // 用字符前缀宽度累计出每个字形的 advance 中心位置
  function measureCladdaghGraphemeOffsets(graphemes, fontSpec, fontPx, letterSpacingOffsetPx) {
    if (letterSpacingOffsetPx === undefined) letterSpacingOffsetPx = 0
    var text = graphemes.join('')
    var cacheKey = fontPx + '|' + fontSpec + '|' + CLADDAGH_BASE_TRACKING_EM + '|' + letterSpacingOffsetPx + '|' + text
    var cached = spacingCache.get(cacheKey)
    if (cached) return cached

    var offsets = new Array(graphemes.length + 1)
    offsets.fill(0)
    var fallbackWidth = 0
    for (var index = 1; index <= graphemes.length; index += 1) {
      fallbackWidth += getFallbackGraphemeWidth(graphemes[index - 1], fontPx)
      var baseTracking = Math.max(0, index - 1) * fontPx * CLADDAGH_BASE_TRACKING_EM
      var extraOffset = Math.max(0, index - 1) * letterSpacingOffsetPx
      offsets[index] = Math.max(
        offsets[index - 1],
        measureCladdaghTextWidth(graphemes.slice(0, index).join(''), fontSpec, fontPx, fallbackWidth) + baseTracking + extraOffset
      )
    }
    return rememberSpacingOffsets(cacheKey, offsets)
  }

  function getFallbackGraphemeWidth(char, fontPx) {
    if (/^\s+$/.test(char)) return fontPx * 0.36
    if (isCJKChar(char)) return fontPx
    return fontPx * 0.62
  }

  function buildMeasuredSpacingInfo(items, fontSpec, fontPx, radiusPx, spacingScale, letterSpacingOffsetPx) {
    if (items.length === 0) return []
    var graphemes = items.map(function (item) { return item.char })
    var offsets = measureCladdaghGraphemeOffsets(graphemes, fontSpec, fontPx, letterSpacingOffsetPx)
    var safeSpacingScale = Number.isFinite(spacingScale) ? Math.max(0.1, spacingScale) : 1
    var totalWidth = (offsets[offsets.length - 1] || 0) * safeSpacingScale
    var safeRadius = Math.max(radiusPx, fontPx * 2, 1)
    var totalSpan = totalWidth / safeRadius
    var scaleFactor = totalSpan > CLADDAGH_MAX_ARC_SPAN ? CLADDAGH_MAX_ARC_SPAN / totalSpan : 1.0

    return items.map(function (item, index) {
      var centerPx = ((offsets[index] || 0) + (offsets[index + 1] !== undefined ? offsets[index + 1] : (offsets[index] || 0))) / 2 * safeSpacingScale
      var startAngle = centerPx / safeRadius
      var next = Object.assign({}, item, {
        startAngle: startAngle,
        nominalAngle: (startAngle - totalSpan / 2) * scaleFactor,
        scaleFactor: scaleFactor
      })
      return next
    })
  }

  // 时间 → 字形小数索引（支持平滑外推防止尾部冻结）
  function getFractionalActiveIndex(timeline, t, renderEnd) {
    if (timeline.length === 0) return 0
    if (timeline.length === 1) {
      var single = timeline[0]
      var targetEnd = typeof renderEnd === 'number' && Number.isFinite(renderEnd) ? renderEnd : single.endTime
      var dur = Math.max(0.2, targetEnd - single.startTime)
      if (t <= single.startTime) return 0
      return (t - single.startTime) / dur
    }

    if (t <= timeline[0].startTime) return 0

    var lastIdx = timeline.length - 1
    if (t >= timeline[lastIdx].startTime) {
      var lastItem = timeline[lastIdx]

      if (typeof renderEnd === 'number' && Number.isFinite(renderEnd) && renderEnd > lastItem.startTime) {
        var progress = clamp((t - lastItem.startTime) / (renderEnd - lastItem.startTime), 0, 1)
        return lastIdx + progress * 2.0
      }

      var prevItem = timeline[lastIdx - 1]
      var itemDur = lastItem.endTime - lastItem.startTime
      var gapDur = lastItem.startTime - prevItem.startTime
      var stepDur = itemDur > 0 ? itemDur : (gapDur > 0 ? gapDur : 0.5)
      var rawProgress = (t - lastItem.startTime) / stepDur
      var cappedProgress = Math.min(rawProgress, 1.8)
      return lastIdx + cappedProgress
    }

    for (var i = 0; i < timeline.length - 1; i += 1) {
      var tStart = timeline[i].startTime
      var tEnd = timeline[i + 1].startTime
      if (t >= tStart && t < tEnd) {
        if (tEnd === tStart) return i
        return i + (t - tStart) / (tEnd - tStart)
      }
    }
    return timeline.length - 1
  }

  // 当前行的小数角度偏移
  function getLineWordOffset(spacingInfo, latestTime, renderEnd) {
    if (spacingInfo.length === 0) return 0
    var fractionalIndex = getFractionalActiveIndex(spacingInfo, latestTime, renderEnd)
    var lastIdx = spacingInfo.length - 1
    if (fractionalIndex <= lastIdx) {
      var intPart = Math.floor(fractionalIndex)
      var fracPart = fractionalIndex - intPart
      var angleA = spacingInfo[intPart] ? spacingInfo[intPart].nominalAngle : 0
      var angleB = spacingInfo[Math.min(intPart + 1, lastIdx)] ? spacingInfo[Math.min(intPart + 1, lastIdx)].nominalAngle : 0
      return angleA + (angleB - angleA) * fracPart
    }

    var lastAngle = spacingInfo[lastIdx] ? spacingInfo[lastIdx].nominalAngle : 0
    var prevAngle = spacingInfo[Math.max(0, lastIdx - 1)] ? spacingInfo[Math.max(0, lastIdx - 1)].nominalAngle : 0
    var step = lastAngle - prevAngle
    var overshoot = fractionalIndex - lastIdx
    return lastAngle + step * overshoot
  }

  // 行播放进度 0..1
  function getLinePlaybackProgress(spacingInfo, latestTime, renderEnd) {
    if (spacingInfo.length === 0) return 0
    if (spacingInfo.length === 1) {
      var item = spacingInfo[0]
      var targetEnd = typeof renderEnd === 'number' && Number.isFinite(renderEnd) ? renderEnd : item.endTime
      var duration = Math.max(0.001, targetEnd - item.startTime)
      return clamp((latestTime - item.startTime) / duration, 0, 1)
    }

    var fractionalIndex = getFractionalActiveIndex(spacingInfo, latestTime, renderEnd)
    return clamp(fractionalIndex / Math.max(1, spacingInfo.length - 1), 0, 1)
  }

  function createMode() {
    var host = null
    var containerEl = null
    var ringHost = null
    var axisLineEl = null
    var theme = null
    var fontScale = 1
    var showText = true
    var paused = false

    var centerLineIndex = -1
    var renderBaseIndex = -1
    var lineOffset = 0                      // 当前环自转角（rad）
    var lineOffsetTarget = 0
    var lineOffsetVelocity = 0              // spring 状态量
    var lastIndex = -1
    var glowIntensity = 0
    var rawPowerScale = false

    var ringLines = new Map()               // lineIndex → { line, charEls, spacingInfo }
    var activeSpacingInfo = []
    var dimensions = { width: 800, height: 600 }

    function mount(hostEl) {
      host = hostEl

      containerEl = document.createElement('div')
      containerEl.className = 'folia-mode-claddagh'
      containerEl.style.cssText = [
        'position:absolute', 'inset:0', 'z-index:10',
        'display:flex', 'flex-direction:column', 'align-items:center', 'justify-content:center',
        'width:100%', 'height:100%', 'overflow:hidden', 'user-select:none', 'pointer-events:none',
        'opacity:0', 'filter:blur(4px)', 'transform:scale(0.96)',
        'transition:opacity 0.8s cubic-bezier(0.16,1,0.3,1), transform 0.8s cubic-bezier(0.16,1,0.3,1), filter 0.8s cubic-bezier(0.16,1,0.3,1)'
      ].join(';')

      // 中轴线（背景专用视觉）
      axisLineEl = document.createElement('div')
      axisLineEl.style.cssText = [
        'position:absolute', 'left:50%', 'top:50%', 'width:300px', 'height:4px',
        'transform:translate(-50%, -50%) rotate(' + (90 - TUNING.ellipseTiltDeg) + 'deg) scale(1, 1)',
        'transform-origin:center center', 'will-change:background, transform, filter',
        'background:transparent'
      ].join(';')
      containerEl.appendChild(axisLineEl)

      ringHost = document.createElement('div')
      ringHost.style.cssText = 'width:100%;height:100%;position:relative;z-index:10'
      containerEl.appendChild(ringHost)

      host.appendChild(containerEl)
      requestAnimationFrame(function () {
        if (containerEl) {
          containerEl.style.opacity = '1'
          containerEl.style.filter = 'blur(0px)'
          containerEl.style.transform = 'scale(1)'
        }
      })

      var rect = hostEl.getBoundingClientRect()
      if (rect.width > 0 && rect.height > 0) dimensions = { width: rect.width, height: rect.height }
    }

    function fontFamily() {
      return window.foliaGetLyricFontFamily
        ? window.foliaGetLyricFontFamily()
        : (theme && theme.fontFamily) || 'sans-serif'
    }

    function resolveThemeFontWeight(fallback) {
      if (theme && typeof theme.fontWeight === 'number' && Number.isFinite(theme.fontWeight)) {
        return Math.min(900, Math.max(100, Math.round(theme.fontWeight / 10) * 10))
      }
      return fallback
    }

    function normalizePower(power) {
      if (!Number.isFinite(power)) return 0
      if (power > 1.0) rawPowerScale = true
      return Math.max(0, Math.min(1, rawPowerScale ? power / 255 : power))
    }

    function buildRingLine(line, lineIndex) {
      var baseFontSize = 72 * fontScale
      var fontWeight = resolveThemeFontWeight(700)
      var fontSpec = fontWeight + ' ' + baseFontSize + 'px ' + fontFamily()

      var wrapEl = document.createElement('div')
      wrapEl.style.cssText = 'position:absolute;inset:0;pointer-events:none;width:100%;height:100%'

      var timeline = adjustCladdaghTimeline(GraphemeTiming.buildLineGraphemeTimeline(line), line)
      var wordColorRanges = WordColoring.buildWordColorRanges(line.fullText, theme.wordColors)

      var codeUnitCursor = 0
      var data = timeline.map(function (t) {
        var charLength = t.char.length
        var startOffset = codeUnitCursor
        var endOffset = codeUnitCursor + charLength
        codeUnitCursor = endOffset

        var charColor = null
        for (var r = 0; r < wordColorRanges.length; r += 1) {
          var range = wordColorRanges[r]
          if (startOffset < range.endOffset && range.startOffset < endOffset) { charColor = range.color; break }
        }

        return Object.assign({}, t, { charColor: charColor })
      })

      var Rx = getRx()
      var spacingInfo = buildMeasuredSpacingInfo(data, fontSpec, baseFontSize, Rx, getActiveTextSpacingScale(), TUNING.letterSpacingOffset)

      var charEls = spacingInfo.map(function (item) {
        var span = document.createElement('span')
        span.style.cssText = [
          'position:absolute', 'left:50%', 'top:50%', 'opacity:0',
          'transform:translate3d(-50%, -50%, 0px) scale(0.2)',
          'transform-origin:center center',
          'will-change:transform, opacity, filter, color, text-shadow',
          'font-family:' + fontFamily(),
          'font-size:' + baseFontSize + 'px',
          'font-weight:' + fontWeight,
          'letter-spacing:' + CLADDAGH_LETTER_SPACING_EM + 'em',
          'white-space:nowrap'
        ].join(';')
        span.textContent = item.char
        wrapEl.appendChild(span)
        return span
      })

      ringHost.appendChild(wrapEl)
      return { line: line, charEls: charEls, spacingInfo: spacingInfo, wrapEl: wrapEl, baseFontSize: baseFontSize, fontWeight: fontWeight }
    }

    function getRx() {
      return (dimensions.width > 0 ? Math.min(dimensions.width * 0.44, 560) : 360) * TUNING.radiusScale
    }

    function getActiveTextSpacingScale() {
      return (1 + TUNING.focusScaleRatio) / (1 + 0.65)
    }

    function updateAudioLine(mixed, bassPower, isChorus) {
      if (!axisLineEl) return
      var fromColor = theme.primaryColor || '#ffffff'
      var toColor = theme.accentColor || '#ffffff'
      if (toColor === fromColor && theme.secondaryColor) toColor = theme.secondaryColor
      if (toColor === fromColor) toColor = '#ffffff'

      var colorPower = bassPower
      var colorDelta = Math.max(0, colorPower - 0.02)
      var colorRatio = Math.min(1.0, colorDelta / 0.58)
      var mixedColor = ColorMix.mixColors(fromColor, toColor, colorRatio, 0.2 + 0.75 * colorRatio)

      var gradientString = 'linear-gradient(90deg, transparent, ' + mixedColor + ' 20%, ' + mixedColor + ' 80%, transparent)'
      axisLineEl.style.background = gradientString

      var bassSqr = bassPower * bassPower
      var scaleX = 1.0 + bassSqr * 1.5
      var scaleY = 1.0 + bassSqr * 0.5
      axisLineEl.style.transform = 'translate(-50%, -50%) rotate(' + (90 - TUNING.ellipseTiltDeg) + 'deg) scale(' + scaleX + ', ' + scaleY + ')'

      var targetIntensity = isChorus ? 1.0 : 0.0
      var diff = targetIntensity - glowIntensity
      if (Math.abs(diff) > 0.01) {
        glowIntensity += Math.sign(diff) * 0.05
        glowIntensity = Math.max(0, Math.min(1, glowIntensity))
      } else {
        glowIntensity = targetIntensity
      }

      if (glowIntensity > 0.001) {
        var glowSize = (4 + bassPower * 12) * glowIntensity
        var glowColor = ColorMix.colorWithAlpha(mixedColor, glowIntensity)
        axisLineEl.style.filter = 'drop-shadow(0 0 ' + glowSize.toFixed(1) + 'px ' + glowColor + ')'
      } else {
        axisLineEl.style.filter = 'none'
      }
    }

    // 每帧驱动：环自转 spring + 每字符公式化投影
    function tick(frameState) {
      if (!theme || !containerEl) return
      var now = frameState.currentTime
      showText = frameState.showText !== false
      paused = frameState.isPlaying === false

      var runtimeState = Runtime.getRuntimeState({
        lines: frameState.lines,
        currentLineIndex: frameState.currentLineIndex,
        currentTime: now,
        getLineEndTime: window.FoliaRenderHints.getLineRenderEndTime
      })

      var lines = frameState.lines

      // 焦点行：活动行，无活动行时取最近完成行
      var focusIndex = frameState.currentLineIndex !== -1
        ? frameState.currentLineIndex
        : (runtimeState.recentCompletedLine ? lines.indexOf(runtimeState.recentCompletedLine) : -1)
      var newCenterLineIndex = Math.max(-1, focusIndex)

      // 环自转（spring 55/14/0.9 状态积分）
      if (lastIndex === -1) {
        lastIndex = newCenterLineIndex
        centerLineIndex = newCenterLineIndex
        renderBaseIndex = newCenterLineIndex
        lineOffset = newCenterLineIndex * Math.PI
        lineOffsetTarget = lineOffset
      } else if (newCenterLineIndex !== centerLineIndex) {
        var prev = centerLineIndex
        centerLineIndex = newCenterLineIndex
        if (Math.abs(centerLineIndex - prev) > 1) {
          // 跨行跳转：直接吸附
          lineOffset = centerLineIndex * Math.PI
          lineOffsetTarget = lineOffset
          lineOffsetVelocity = 0
          renderBaseIndex = centerLineIndex
        } else {
          renderBaseIndex = centerLineIndex
          lineOffsetTarget = centerLineIndex * Math.PI
        }
      }

      // spring 积分（stiffness 55, damping 14, mass 0.9）
      if (Math.abs(lineOffsetTarget - lineOffset) > 1e-4 || Math.abs(lineOffsetVelocity) > 1e-4) {
        var dt = Math.min(frameState.dt || 1 / 60, 0.05)
        var stiffness = 55
        var damping = 14
        var mass = 0.9
        var force = -stiffness * (lineOffset - lineOffsetTarget)
        var damper = -damping * lineOffsetVelocity
        lineOffsetVelocity += (force + damper) / mass * dt
        lineOffset += lineOffsetVelocity * dt
      }

      // 需要渲染的行：过渡对 + 前一行
      var lineIndicesToRender = []
      if (lines.length > 0) {
        for (var i = renderBaseIndex - 1; i <= renderBaseIndex + 2; i += 1) {
          if (i >= 0 && i < lines.length) lineIndicesToRender.push(i)
        }
        if (lineIndicesToRender.length === 0) {
          lineIndicesToRender.push(Math.max(0, Math.min(centerLineIndex, lines.length - 1)))
        }
      }

      // 同步行 DOM
      var neededSet = new Set(lineIndicesToRender)
      ringLines.forEach(function (entry, idx) {
        if (!neededSet.has(idx)) {
          entry.wrapEl.remove()
          ringLines.delete(idx)
        }
      })
      lineIndicesToRender.forEach(function (idx) {
        if (!ringLines.has(idx)) {
          ringLines.set(idx, buildRingLine(lines[idx], idx))
        }
      })

      // 活动行的 spacing info（wordOffset 基准）
      var activeLineForSpacing = lines[renderBaseIndex]
      if (activeLineForSpacing) {
        var baseFontSize = 72 * fontScale
        var fontSpec = resolveThemeFontWeight(700) + ' ' + baseFontSize + 'px ' + fontFamily()
        var RxForSpacing = getRx()
        var timelineActive = adjustCladdaghTimeline(GraphemeTiming.buildLineGraphemeTimeline(activeLineForSpacing), activeLineForSpacing)
        activeSpacingInfo = buildMeasuredSpacingInfo(timelineActive, fontSpec, baseFontSize, RxForSpacing, getActiveTextSpacingScale(), TUNING.letterSpacingOffset)
      } else {
        activeSpacingInfo = []
      }

      // 音频
      var bassRaw = frameState.audioBands ? (frameState.audioBands.bass || 0) : 0
      var bassPower = paused ? 0 : normalizePower(bassRaw)
      var power = paused ? 0 : normalizePower(frameState.audioPower || 0)
      var isChorus = (lines[centerLineIndex] && lines[centerLineIndex].isChorus) || false
      updateAudioLine(null, Math.max(bassPower, power), isChorus)

      var intensity = theme.animationIntensity || 'normal'
      var intensityMultiplier = 0.25
      var maxScale = 1.25
      if (intensity === 'calm') { intensityMultiplier = 0.08; maxScale = 1.08 }
      else if (intensity === 'chaotic') { intensityMultiplier = 0.95; maxScale = 1.95 }

      var scaleFactor = Math.min(1 + power * intensityMultiplier, maxScale)
      var baseRx = getRx()
      var Ry = baseRx > 0 ? baseRx * 0.707 : 254
      var currentRx = baseRx * scaleFactor
      var currentRy = Ry * scaleFactor

      var activeColor = theme.accentColor || theme.primaryColor
      var baseColor = ColorMix.colorWithAlpha(theme.primaryColor, 0.55)

      // 活动行偏移/进度
      var activeNextLine = lines[renderBaseIndex + 1]
      var activeRenderEnd = activeLineForSpacing
        ? Math.max(
          activeLineForSpacing.renderHints ? activeLineForSpacing.renderHints.renderEndTime : activeLineForSpacing.endTime,
          activeNextLine ? activeNextLine.startTime - CLADDAGH_NEXT_LINE_ENTRY_LEAD_SECONDS : activeLineForSpacing.endTime + 10.0
        )
        : undefined
      var activeWordOffset = getLineWordOffset(activeSpacingInfo, now, activeRenderEnd)
      var activeLineProgress = getLinePlaybackProgress(activeSpacingInfo, now, activeRenderEnd)
      var backOrbitFollow = Math.PI * CLADDAGH_BACK_ORBIT_FOLLOW_RATIO * (1 - Math.pow(1 - activeLineProgress, 1.35))

      ringLines.forEach(function (entry, lineIndex) {
        var line = entry.line
        var spacingInfo = entry.spacingInfo
        var mvsLength = spacingInfo.length
        if (mvsLength === 0) return

        var curLineOffset = lineOffset
        var isUpcomingLine = lineIndex > centerLineIndex
        var upcomingEntryProgress = isUpcomingLine
          ? clamp((now - (line.startTime - CLADDAGH_NEXT_LINE_ENTRY_LEAD_SECONDS)) / CLADDAGH_NEXT_LINE_ENTRY_LEAD_SECONDS, 0, 1)
          : 0
        var lineDiffFromCenter = Math.abs(curLineOffset - lineIndex * Math.PI) / Math.PI

        // 行长重叠缓解
        var currentLen = lines[centerLineIndex] ? getVisualLength(lines[centerLineIndex].fullText) : 0
        var targetLen = line ? getVisualLength(line.fullText) : 0

        var lengthFadeFactor = 1.0
        var lengthScaleFactor = 1.0

        if (lineIndex > centerLineIndex && currentLen > 10) {
          var fadeStrength = clamp((currentLen - 10) / 8, 0, 1)
          var targetStrength = clamp((targetLen - 5) / 5, 0.4, 1)
          var combinedStrength = fadeStrength * targetStrength

          var targetMinOpacity = 1.0 - combinedStrength
          var targetMinScale = 1.0 - combinedStrength * 0.25

          var transitionProgress = clamp((lineDiffFromCenter - 0.4) / 0.5, 0, 1)

          lengthFadeFactor = 1.0 - (1.0 - targetMinOpacity) * transitionProgress
          lengthScaleFactor = 1.0 - (1.0 - targetMinScale) * transitionProgress
        }

        var nextLine = lines[lineIndex + 1]
        var ownRenderEnd = Math.max(
          line.renderHints ? line.renderHints.renderEndTime : line.endTime,
          nextLine ? nextLine.startTime - CLADDAGH_NEXT_LINE_ENTRY_LEAD_SECONDS : line.endTime + 10.0
        )

        var ownWordOffset = getLineWordOffset(spacingInfo, now, ownRenderEnd)
        var wordOffset = ownWordOffset
        if (lineIndex >= centerLineIndex) {
          var backFollowFactor = lineIndex > centerLineIndex ? 1 : clamp(lineDiffFromCenter, 0, 1)
          wordOffset += (activeWordOffset * CLADDAGH_BACK_FOLLOW_RATIO + backOrbitFollow) * backFollowFactor
        }

        var R_ref = currentRx
        var R_major = currentRx
        var R_minor = currentRx * 0.09

        for (var ci = 0; ci < mvsLength; ci += 1) {
          var el = entry.charEls[ci]
          if (!el) continue

          var item = spacingInfo[ci]
          var nominalAngle = item.nominalAngle

          var theta = lineIndex * Math.PI + nominalAngle
          var psi = theta - curLineOffset - wordOffset

          var deltaDist = psi * R_ref
          var thetaCurve = deltaDist / R_major

          var localCos = Math.cos(thetaCurve)
          var D = (localCos + 1) / 2

          var spacingFactor = 0.35 + 0.65 * Math.pow(D, 1.2)

          var rawX = Math.sin(thetaCurve) * R_major * spacingFactor

          var rawY = localCos * R_minor
          if (line.isChorus) {
            var staggerAmount = entry.baseFontSize * (0.06 + power * 0.12)
            rawY += (ci % 2 === 0 ? 1 : -1) * staggerAmount
          }

          var thetaRot = -(TUNING.ellipseTiltDeg * Math.PI) / 180
          var cosTheta = Math.cos(thetaRot)
          var sinTheta = Math.sin(thetaRot)

          var x = rawX * cosTheta - rawY * sinTheta
          var y = rawX * sinTheta + rawY * cosTheta

          var tangentX = Math.cos(thetaCurve) * R_major
          var tangentY = -Math.sin(thetaCurve) * R_minor
          var rotatedTangentX = tangentX * cosTheta - tangentY * sinTheta
          var rotatedTangentY = tangentX * sinTheta + tangentY * cosTheta
          var tangentAngle = normalizeReadableAngle(Math.atan2(rotatedTangentY, rotatedTangentX) * 180 / Math.PI)

          var lineDiffNormalized = lineDiffFromCenter
          var activeLineFactor = Math.max(0, 1 - lineDiffNormalized)

          var maxVisibleDist = currentRx * 0.48
          var distRatio = Math.min(1, Math.abs(deltaDist) / maxVisibleDist)
          var F = activeLineFactor * Math.pow(1 - distRatio, 1.8)

          var distanceOpacity = 0.68 + 0.32 * Math.pow(D, 1.9)
          var finalOpacity = (0.35 + 0.65 * Math.pow(D, 1.5) * (0.35 + 0.65 * F)) * distanceOpacity

          var lineWindowFade = clamp(2 - lineDiffNormalized, 0, 1)
          finalOpacity = finalOpacity * lineWindowFade

          if (lineIndex < centerLineIndex) {
            var pastFade = Math.max(0, 1 - lineDiffNormalized)
            finalOpacity = finalOpacity * pastFade
          }

          finalOpacity = finalOpacity * lengthFadeFactor

          if (isUpcomingLine) {
            finalOpacity = finalOpacity * (0.18 + 0.82 * upcomingEntryProgress)
          }

          var boundaryFade = 1.0
          if (lineDiffFromCenter > 0.02) {
            var bProgress = clamp((lineDiffFromCenter - 0.3) / 0.6, 0, 1)
            var cosThreshold = 1.0 - 1.2 * bProgress
            if (localCos > cosThreshold) {
              boundaryFade = clamp(1.0 - (localCos - cosThreshold) / 0.15, 0, 1)
            }
          }
          finalOpacity = finalOpacity * boundaryFade

          var scale = (0.22 + 0.98 * Math.pow(D, 1.5)) * (1.0 + TUNING.focusScaleRatio * F) * lengthScaleFactor * (item.scaleFactor || 1.0)
          var blur = 8.0 * (1 - D) * (1 - 0.5 * F)
          var tiltAngle = clamp(tangentAngle * (0.4 + 0.6 * D), -38, 38)

          el.style.transform = 'translate3d(calc(-50% + ' + x.toFixed(1) + 'px), calc(-50% + ' + y.toFixed(1) + 'px), 0px) rotate(' + tiltAngle.toFixed(2) + 'deg) scale(' + scale.toFixed(3) + ')'
          el.style.opacity = finalOpacity.toFixed(3)
          el.style.filter = blur < 0.2 ? 'none' : 'blur(' + blur.toFixed(2) + 'px)'

          // 字符播放进度与"闪光"效果
          var charProgress = 0
          if (now >= item.endTime) charProgress = 1
          else if (now > item.startTime) {
            var dur = item.endTime - item.startTime
            charProgress = dur > 0 ? (now - item.startTime) / dur : 1
          }

          var baseGlow = line.isChorus
            ? (36 + power * 24) * Math.pow(F, 1.5)
            : 24 * Math.pow(F, 2.0)

          var finalHighlightColor = item.charColor || activeColor

          var targetColor = baseColor
          var currentAlpha = 0.55
          var flashPop = 0

          if (charProgress >= 1) {
            targetColor = finalHighlightColor
            currentAlpha = 1.0
          } else if (charProgress > 0) {
            var progressFactor = Math.min(1, charProgress * 15.0)
            currentAlpha = 0.55 + 0.45 * progressFactor
            targetColor = ColorMix.mixColors(baseColor, finalHighlightColor, progressFactor, currentAlpha)
            if (charProgress < 0.4) {
              flashPop = Math.pow(1 - charProgress / 0.4, 2.0) * 0.65
            }
          }

          var currentGlowRadius = baseGlow * (1.0 + flashPop)

          el.style.color = targetColor

          var shadowFade = clamp((currentGlowRadius - 0.5) / 2.0, 0, 1)

          if (currentGlowRadius > 0.5 && shadowFade > 0.01) {
            var fadedTargetColor = ColorMix.mixColors(targetColor, targetColor, 0, currentAlpha * shadowFade)

            if (line.isChorus) {
              var innerGlowColor = ColorMix.mixColors(targetColor, theme.primaryColor || '#ffffff', 0.65, shadowFade)
              el.style.textShadow = '0 0 ' + (currentGlowRadius * 0.35).toFixed(1) + 'px ' + innerGlowColor + ', 0 0 ' + currentGlowRadius.toFixed(1) + 'px ' + fadedTargetColor + ', 0 0 ' + (currentGlowRadius * 1.6).toFixed(1) + 'px ' + fadedTargetColor
            } else {
              el.style.textShadow = '0 0 ' + currentGlowRadius.toFixed(1) + 'px ' + fadedTargetColor
            }
          } else {
            el.style.textShadow = 'none'
          }
        }
      })

      if (showText) {
        window.FoliaSubtitleOverlay.update({
          hostEl: host, showText: showText, activeLine: runtimeState.activeLine,
          recentCompletedLine: runtimeState.recentCompletedLine,
          nextLines: runtimeState.nextLines, theme: theme
        })
      } else {
        window.FoliaSubtitleOverlay.hide()
      }
    }

    function setTheme(newTheme) {
      theme = newTheme
    }

    function setLines() { /* 行数据经 tick 传入 */ }

    function destroy() {
      if (containerEl) { containerEl.remove(); containerEl = null }
      ringHost = null
      axisLineEl = null
      ringLines.clear()
      activeSpacingInfo = []
      lastIndex = -1
      centerLineIndex = -1
      renderBaseIndex = -1
      lineOffset = 0
      lineOffsetVelocity = 0
      window.FoliaSubtitleOverlay.destroy()
      host = null
    }

    return {
      id: 'claddagh',
      mount: mount,
      setTheme: setTheme,
      setLines: setLines,
      setFontScale: function (s) { fontScale = s === undefined ? 1 : s },
      tick: tick,
      destroy: destroy
    }
  }

  window.FoliaModeCladdagh = { create: createMode }
})()
