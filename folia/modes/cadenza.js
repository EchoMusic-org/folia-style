// 心象模式：移植自 folia-major src/components/visualizer/cadenza/VisualizerCadenza.tsx
// 重布局模式：pretext 预排版（测量/折行）→ 词映射到字形流 → 强调词（hero 1.46 倍）→
// 碰撞回避散落布局 → DOM overlay 每帧指数平滑驱动（k: transform 11 / visual 14 / glow 16）。
// glow 包络/正文混色/行包络与原版公式逐一对齐。
(function () {
  'use strict'

  var Runtime = window.FoliaVisualizerRuntime
  var RenderHints = window.FoliaRenderHints
  var GraphemeTiming = window.FoliaGraphemeTiming
  var ColorMix = window.FoliaColorMix
  var WordColoring = window.FoliaWordColoring

  // 原版 DEFAULT_CADENZA_TUNING
  var TUNING = { fontScale: 1.12, widthRatio: 0.72, motionAmount: 1, glowIntensity: 1, beamIntensity: 0 }
  var ACTIVE_PULSE_FREQUENCY = 10

  function clamp(value, min, max) { return Math.max(min, Math.min(max, value)) }
  function mix(from, to, amount) { return from + (to - from) * amount }
  function easeOutCubic(value) { return 1 - Math.pow(1 - clamp(value, 0, 1), 3) }
  function easeInOutQuad(value) {
    var normalized = clamp(value, 0, 1)
    return normalized < 0.5
      ? 2 * normalized * normalized
      : 1 - Math.pow(-2 * normalized + 2, 2) / 2
  }

  function isCJK(text) { return /[\u4e00-\u9fa5\u3040-\u30ff\uac00-\ud7af]/.test(text) }

  function splitGraphemes(text) {
    return GraphemeTiming.splitLyricGraphemes(text)
  }

  function createMode() {
    var host = null
    var container = null
    var lineLayer = null
    var overlay = null
    var emptyEl = null
    var overlayNodes = new Map()
    var animatedPlacement = new Map()
    var preparedCache = new Map()
    var preparedContextKey = ''
    var theme = null
    var fontScale = 1
    var showText = true
    var lastFrameTime = null

    function mount(hostEl) {
      host = hostEl

      container = document.createElement('div')
      container.className = 'folia-mode-cadenza'
      container.style.cssText = 'position:absolute;inset:0;z-index:10;pointer-events:none;overflow:hidden'

      lineLayer = document.createElement('div')
      lineLayer.style.cssText = [
        'position:absolute', 'inset:0', 'z-index:10', 'pointer-events:none',
        'opacity:0', 'transform-origin:50% 42%', 'perspective:1000px'
      ].join(';')

      overlay = document.createElement('div')
      overlay.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;user-select:none'

      lineLayer.appendChild(overlay)
      container.appendChild(lineLayer)
      host.appendChild(container)
    }

    function fontFamily() {
      return window.foliaGetLyricFontFamily
        ? window.foliaGetLyricFontFamily()
        : (theme && theme.fontFamily) || 'sans-serif'
    }

    // ---------- 状态包络公式（原版一一对应） ----------
    function getWordStatus(time, lineTiming, word) {
      var lookahead = lineTiming.wordRevealMode === 'fast' ? 0.045 : lineTiming.wordRevealMode === 'instant' ? 0 : 0.18
      var activeEndTime = lineTiming.wordRevealMode === 'instant' ? lineTiming.lineRenderEndTime : word.endTime

      if (time >= word.startTime - lookahead && time <= activeEndTime) return 'active'
      if (time > activeEndTime) return 'passed'
      return 'waiting'
    }

    function getWordProgress(time, wordRevealMode, word) {
      if (wordRevealMode === 'instant') return time < word.startTime ? 0 : 1
      var minDuration = wordRevealMode === 'fast' ? 0.045 : 0.01
      var duration = Math.max(word.endTime - word.startTime, minDuration)
      return clamp((time - word.startTime) / duration, 0, 1)
    }

    function getClassicKeyframedGlow(progress) {
      if (progress <= 0 || progress >= 1) return 0
      if (progress < 0.3) return easeOutCubic(progress / 0.3)
      return 1 - clamp((progress - 0.3) / 0.7, 0, 1)
    }

    function getClassicGlowEnvelope(time, lineTiming, word) {
      if (lineTiming.wordRevealMode === 'instant') {
        var activeEndTime = lineTiming.lineRenderEndTime
        if (time < word.startTime || time > activeEndTime) return 0
        var pulseProgress = clamp((time - word.startTime) / 0.067, 0, 1)
        return getClassicKeyframedGlow(pulseProgress)
      }

      if (lineTiming.wordRevealMode === 'fast') {
        var fastDuration = Math.max(word.endTime - word.startTime, 0.045)
        if (time < word.startTime) return 0
        if (time <= word.endTime) {
          var fastProgress = clamp((time - word.startTime) / fastDuration, 0, 1)
          if (fastProgress < 0.14) return easeOutCubic(fastProgress / 0.14)
          if (fastProgress < 0.82) return 1
          return mix(1, 0.92, (fastProgress - 0.82) / 0.18)
        }
        var fastFadeOut = clamp((time - word.endTime) / 0.14, 0, 1)
        return Math.pow(1 - fastFadeOut, 2)
      }

      var duration = Math.max(word.endTime - word.startTime, 0.1)
      if (time < word.startTime) return 0
      if (time <= word.endTime) {
        var progress = clamp((time - word.startTime) / duration, 0, 1)
        if (progress < 0.18) return easeOutCubic(progress / 0.18)
        if (progress < 0.9) return 1
        return mix(1, 0.9, (progress - 0.9) / 0.1)
      }
      var fadeOut = clamp((time - word.endTime) / 0.9, 0, 1)
      return 0.9 * Math.pow(1 - fadeOut, 2)
    }

    function getClassicCharGlow(time, word, glyphIndex, glyphCount, wordGraphemeTimings) {
      if (!wordGraphemeTimings) wordGraphemeTimings = []
      var duration = Math.max(word.endTime - word.startTime, 0.1)
      var singleDuration = duration / Math.max(glyphCount, 1)
      var timing = wordGraphemeTimings[glyphIndex]
      var charDuration = timing ? Math.max(timing.endTime - timing.startTime, 0.001) : singleDuration
      var charStartTime = timing ? timing.startTime : (word.startTime + singleDuration * glyphIndex)
      var animationDuration = charDuration * 6
      var elapsed = time - charStartTime
      var activeGlow = elapsed <= 0 ? 0 : getClassicKeyframedGlow(elapsed / animationDuration)

      if (time <= word.endTime) return activeGlow
      var fadeOut = Math.pow(1 - clamp((time - word.endTime) / 0.9, 0, 1), 2)
      return activeGlow * fadeOut
    }

    function getClassicBodyMix(time, lineTiming, word) {
      if (lineTiming.wordRevealMode === 'instant') {
        if (time < word.startTime) return 0
        return time <= lineTiming.lineRenderEndTime ? 1 : 0
      }
      if (time < word.startTime) return 0
      if (time <= word.endTime) return getWordProgress(time, lineTiming.wordRevealMode, word)
      var fadeOut = clamp((time - word.endTime) / (lineTiming.wordRevealMode === 'fast' ? 0.12 : 0.8), 0, 1)
      return 1 - fadeOut
    }

    // 整行进出场包络（normal/fast/none 三档）
    function getClassicLineEnvelope(time, line, lineTiming) {
      if (!line) return { opacity: 1, scale: 1, blur: 0 }

      var renderHints = lineTiming.renderHints
      var lineEndTime = lineTiming.lineRenderEndTime
      var linePassStart = Math.max(lineTiming.lastWordEndTime, line.startTime) + lineTiming.linePassHold

      if (renderHints && renderHints.lineTransitionMode === 'none') {
        return { opacity: 1, scale: 1, blur: 0 }
      }

      if (renderHints && renderHints.lineTransitionMode === 'fast') {
        var enterDuration = lineTiming.transitionTiming.enterDuration
        var exitDuration = lineTiming.transitionTiming.exitDuration
        var exitStartFast = Math.max(line.startTime + enterDuration + 0.01, linePassStart, lineEndTime - exitDuration)
        var enterProgress = easeOutCubic(clamp((time - line.startTime) / enterDuration, 0, 1))
        var opacity = mix(0.65, 1, enterProgress)
        var scale = mix(0.97, 1, enterProgress)
        var blur = mix(4, 0, enterProgress)

        var exitProgress = easeOutCubic(clamp((time - exitStartFast) / exitDuration, 0, 1))
        if (exitProgress > 0) {
          opacity = mix(opacity, 0, exitProgress)
          scale = mix(scale, 1.03, exitProgress)
          blur = Math.max(blur, mix(0, 6, exitProgress))
        }

        return { opacity: clamp(opacity, 0, 1), scale: scale, blur: blur }
      }

      var normalEnterDuration = lineTiming.transitionTiming.enterDuration
      var normalExitDuration = lineTiming.transitionTiming.exitDuration
      var preEnter = Math.min(0.1, normalEnterDuration * 0.35)

      var normalEnterProgress = easeOutCubic(clamp((time - (line.startTime - preEnter)) / (normalEnterDuration + preEnter), 0, 1))
      var nOpacity = mix(0, 1, normalEnterProgress)
      var nScale = mix(0.9, 1, normalEnterProgress)
      var nBlur = mix(10, 0, normalEnterProgress)

      var normalExitStart = Math.max(linePassStart, lineEndTime - normalExitDuration)
      var normalExitProgress = easeOutCubic(clamp((time - normalExitStart) / normalExitDuration, 0, 1))
      if (normalExitProgress > 0) {
        nOpacity *= 1 - normalExitProgress
        nScale = mix(nScale, 1.1, normalExitProgress)
        nBlur = Math.max(nBlur, mix(0, 20, normalExitProgress))
      }

      return { opacity: clamp(nOpacity, 0, 1), scale: nScale, blur: nBlur }
    }

    function getClassicPassedDrift(time, word) {
      if (time <= word.endTime) return 0
      return easeInOutQuad(clamp((time - word.endTime) / 5, 0, 1))
    }

    function resolveLineRenderTiming(line) {
      var renderHints = line.renderHints || null
      var wordRevealMode = renderHints ? renderHints.wordRevealMode : 'normal'
      var lastWord = line.words[line.words.length - 1]
      var rawDuration = renderHints ? renderHints.rawDuration : Math.max(line.endTime - line.startTime, 0)
      var transitionTiming = RenderHints.getLineTransitionTiming(
        rawDuration,
        renderHints ? renderHints.lineTransitionMode : 'normal',
        wordRevealMode
      )

      return {
        renderHints: renderHints,
        lineRenderEndTime: renderHints ? renderHints.renderEndTime : line.endTime,
        wordRevealMode: wordRevealMode,
        lastWordEndTime: lastWord ? lastWord.endTime : line.endTime,
        linePassHold: transitionTiming.linePassHold,
        transitionTiming: transitionTiming
      }
    }

    function buildDomTextShadow(color, intensity, blurScale) {
      if (blurScale === undefined) blurScale = 1
      var glow = clamp(intensity, 0, 1.6)
      if (glow <= 0.01) return 'none'

      return [
        '0 0 ' + (40 * blurScale) + 'px ' + ColorMix.colorWithAlpha(color, Math.min(0.98, glow)),
        '0 0 ' + (40 * blurScale) + 'px ' + ColorMix.colorWithAlpha(color, Math.min(0.92, glow * 0.92)),
        '0 0 ' + (40 * blurScale) + 'px ' + ColorMix.colorWithAlpha(color, Math.min(0.35, glow * 0.26))
      ].join(', ')
    }

    // ---------- 布局管线（pretext 测量 → 折行 → 词放置） ----------
    function chooseFontPx(width, line) {
      var graphemeCount = splitGraphemes(line.fullText).length || 1
      var wordCount = line.words.length || 1
      var widthBase = clamp(width * 0.086, 34, 94)
      var lengthPenalty = graphemeCount > 12 ? Math.min((graphemeCount - 12) * 1.8, 34) : 0
      var densityPenalty = wordCount > 7 ? Math.min((wordCount - 7) * 1.5, 18) : 0
      return clamp(widthBase - lengthPenalty - densityPenalty, 28, 104)
    }

    function buildSegmentMetas(prepared) {
      var segmentMetas = []
      var graphemes = []
      var graphemeCursor = 0

      for (var i = 0; i < prepared.segments.length; i += 1) {
        var segment = prepared.segments[i]
        var segmentGraphemes = splitGraphemes(segment)
        segmentMetas.push({
          graphemeStart: graphemeCursor,
          graphemeEnd: graphemeCursor + segmentGraphemes.length,
          graphemeCount: segmentGraphemes.length
        })
        graphemes = graphemes.concat(segmentGraphemes)
        graphemeCursor += segmentGraphemes.length
      }

      return { segmentMetas: segmentMetas, graphemes: graphemes }
    }

    function getActiveColor(wordText) {
      return WordColoring.resolveWordColor(wordText, theme.wordColors, theme.accentColor)
    }

    function findWordRanges(line, graphemes) {
      // 词重新映射到字形流；映射错位会导致发光落到错误文本片
      var ranges = []
      var cursor = 0

      for (var wordIndex = 0; wordIndex < line.words.length; wordIndex += 1) {
        var word = line.words[wordIndex]
        var target = splitGraphemes(word.text)
        var start = -1

        for (var i = cursor; i <= graphemes.length - target.length; i += 1) {
          var isMatch = true
          for (var j = 0; j < target.length; j += 1) {
            if (graphemes[i + j] !== target[j]) { isMatch = false; break }
          }
          if (isMatch) { start = i; break }
        }

        if (start === -1) start = clamp(cursor, 0, graphemes.length)
        var end = clamp(start + target.length, start, graphemes.length)

        ranges.push({
          wordIndex: wordIndex,
          word: word,
          start: start,
          end: end,
          color: getActiveColor(word.text),
          graphemeTimings: GraphemeTiming.buildWordGraphemeTimings(word)
        })

        cursor = end
      }

      return ranges
    }

    function cursorToGlobalOffset(cursor, segmentMetas) {
      if (segmentMetas.length === 0) return 0
      var segment = segmentMetas[cursor.segmentIndex]
      if (!segment) return segmentMetas[segmentMetas.length - 1].graphemeEnd
      return clamp(segment.graphemeStart + cursor.graphemeIndex, segment.graphemeStart, segment.graphemeEnd)
    }

    function getPartialSegmentWidth(prepared, segmentIndex, segmentMeta, startOffset, endOffset) {
      var localStart = clamp(startOffset - segmentMeta.graphemeStart, 0, segmentMeta.graphemeCount)
      var localEnd = clamp(endOffset - segmentMeta.graphemeStart, 0, segmentMeta.graphemeCount)

      if (localEnd <= localStart) return 0
      if (localStart === 0 && localEnd === segmentMeta.graphemeCount) {
        return prepared.widths[segmentIndex] || 0
      }

      var breakableFitAdvances = prepared.breakableFitAdvances[segmentIndex]
      if (breakableFitAdvances && breakableFitAdvances.length > 0) {
        var width = 0
        for (var i = localStart; i < localEnd; i += 1) width += breakableFitAdvances[i] || 0
        return width
      }

      var fullWidth = prepared.widths[segmentIndex] || 0
      if (segmentMeta.graphemeCount === 0) return fullWidth
      return fullWidth * ((localEnd - localStart) / segmentMeta.graphemeCount)
    }

    function widthBetweenOffsets(prepared, segmentMetas, startOffset, endOffset) {
      if (endOffset <= startOffset) return 0
      var width = 0

      for (var segmentIndex = 0; segmentIndex < segmentMetas.length; segmentIndex += 1) {
        var meta = segmentMetas[segmentIndex]
        if (endOffset <= meta.graphemeStart) break
        if (startOffset >= meta.graphemeEnd) continue
        var sliceStart = Math.max(startOffset, meta.graphemeStart)
        var sliceEnd = Math.min(endOffset, meta.graphemeEnd)
        width += getPartialSegmentWidth(prepared, segmentIndex, meta, sliceStart, sliceEnd)
      }

      return width
    }

    function buildLineFragments(prepared, segmentMetas, graphemes, layout, ranges) {
      // 折行可能直接切断一个词：先按折行建片段，再标记"同词跨行"的片段
      var lineViews = layout.lines.map(function (line) {
        var lineStart = cursorToGlobalOffset(line.start, segmentMetas)
        var lineEnd = cursorToGlobalOffset(line.end, segmentMetas)

        var fragments = []
        ranges.forEach(function (range) {
          if (range.end <= lineStart || range.start >= lineEnd) return
          var fragmentStart = Math.max(range.start, lineStart)
          var fragmentEnd = Math.min(range.end, lineEnd)
          fragments.push({
            wordIndex: range.wordIndex,
            lineIndex: 0,
            word: range.word,
            text: graphemes.slice(fragmentStart, fragmentEnd).join(''),
            color: range.color,
            startX: widthBetweenOffsets(prepared, segmentMetas, lineStart, fragmentStart),
            endX: widthBetweenOffsets(prepared, segmentMetas, lineStart, fragmentEnd),
            fragmentStartInWord: fragmentStart - range.start,
            fragmentEndInWord: fragmentEnd - range.start,
            wordGraphemeCount: Math.max(range.end - range.start, 1),
            wordGraphemeTimings: range.graphemeTimings,
            fragmentIndexInWord: 0,
            fragmentCountInWord: 1,
            isPrimaryFragment: true,
            isSplitAcrossLines: false
          })
        })

        return { line: line, lineStart: lineStart, lineEnd: lineEnd, fragments: fragments }
      })

      var fragmentCountByWord = new Map()
      lineViews.forEach(function (lineView) {
        lineView.fragments.forEach(function (fragment) {
          var count = fragmentCountByWord.get(fragment.wordIndex) || 0
          fragmentCountByWord.set(fragment.wordIndex, count + 1)
        })
      })

      var seenFragmentsByWord = new Map()

      return lineViews.map(function (lineView, lineIndex) {
        return {
          line: lineView.line,
          lineStart: lineView.lineStart,
          lineEnd: lineView.lineEnd,
          fragments: lineView.fragments.map(function (fragment) {
            var fragmentCountInWord = fragmentCountByWord.get(fragment.wordIndex) || 1
            var fragmentIndexInWord = seenFragmentsByWord.get(fragment.wordIndex) || 0
            seenFragmentsByWord.set(fragment.wordIndex, fragmentIndexInWord + 1)
            fragment.lineIndex = lineIndex
            fragment.fragmentIndexInWord = fragmentIndexInWord
            fragment.fragmentCountInWord = fragmentCountInWord
            fragment.isPrimaryFragment = fragmentIndexInWord === 0
            fragment.isSplitAcrossLines = fragmentCountInWord > 1
            return fragment
          })
        }
      })
    }

    function buildEmphasisMap(lineData, isInterlude) {
      var emphasisMap = new Map()
      if (isInterlude) return emphasisMap

      var primaryFragments = []
      lineData.forEach(function (lineView) {
        lineView.fragments.forEach(function (fragment) {
          if (fragment.isPrimaryFragment) primaryFragments.push(fragment)
        })
      })

      var candidates = []
      primaryFragments.forEach(function (fragment) {
        if (fragment.isSplitAcrossLines || fragment.text.trim().length === 0) return
        var graphemeCount = Math.max(fragment.wordGraphemeCount, splitGraphemes(fragment.word.text).length, 1)
        var semanticWeight = isCJK(fragment.word.text) ? 0.18 : Math.min(graphemeCount * 0.08, 0.36)
        var centerBias = 1 - Math.abs(fragment.wordIndex - (primaryFragments.length - 1) / 2) / Math.max(primaryFragments.length, 1)
        candidates.push({ fragment: fragment, score: semanticWeight + centerBias * 0.18 })
      })

      candidates.sort(function (a, b) { return b.score - a.score })

      var hero = candidates[0]
      if (hero) {
        var scoreBoost = 1 + clamp(hero.score - 0.48, 0, 0.52)
        emphasisMap.set(hero.fragment.wordIndex, 1.46 * scoreBoost)
      }

      return emphasisMap
    }

    // 片段 → 视觉放置对象（碰撞回避：椭圆采样 + band 加速查询）
    function buildWordPlacements(lineData, fontPx, lineHeight, maxWidth, animationIntensity, seed, isInterlude) {
      var totalHeight = Math.max(lineData.length, 1) * lineHeight
      var baseMargin = animationIntensity === 'calm' ? 4 : 6
      var baseScale = animationIntensity === 'chaotic' ? 1.02 : animationIntensity === 'calm' ? 1 : 1.01
      var emphasisMap = buildEmphasisMap(lineData, isInterlude)
      var heroWordIndex = null
      var bestEmphasis = 0
      emphasisMap.forEach(function (value, key) {
        if (value > bestEmphasis) { bestEmphasis = value; heroWordIndex = key }
      })

      var placements = []
      var occupiedRects = []
      var occupiedBands = new Map()
      var occupiedMarks = []
      var occupiedQueryStamp = 0
      var collisionBandSize = Math.max(24, Math.round(lineHeight * 0.9))

      function getBandIndex(value) { return Math.floor(value / collisionBandSize) }

      function registerOccupiedRect(rect) {
        var rectIndex = occupiedRects.length
        occupiedRects.push(rect)
        var startBand = getBandIndex(rect.top)
        var endBand = getBandIndex(rect.bottom)
        for (var band = startBand; band <= endBand; band += 1) {
          var bucket = occupiedBands.get(band)
          if (bucket) bucket.push(rectIndex)
          else occupiedBands.set(band, [rectIndex])
        }
      }

      function evaluateCollisionRect(left, top, right, bottom) {
        if (occupiedRects.length === 0) return { intersects: false, overlapArea: 0 }

        occupiedQueryStamp += 1
        var stamp = occupiedQueryStamp
        var startBand = getBandIndex(top)
        var endBand = getBandIndex(bottom)
        var intersects = false
        var overlapArea = 0

        for (var band = startBand; band <= endBand; band += 1) {
          var bucket = occupiedBands.get(band)
          if (!bucket) continue

          for (var bucketIndex = 0; bucketIndex < bucket.length; bucketIndex += 1) {
            var rectIndex = bucket[bucketIndex]
            if (occupiedMarks[rectIndex] === stamp) continue
            occupiedMarks[rectIndex] = stamp

            var rect = occupiedRects[rectIndex]
            var overlapWidth = Math.max(0, Math.min(right, rect.right) - Math.max(left, rect.left))
            var overlapHeight = Math.max(0, Math.min(bottom, rect.bottom) - Math.max(top, rect.top))
            if (overlapWidth <= 0 || overlapHeight <= 0) continue

            intersects = true
            overlapArea += overlapWidth * overlapHeight
          }
        }

        return { intersects: intersects, overlapArea: overlapArea }
      }

      function pushPlacementRect(left, top, width, height, padding) {
        registerOccupiedRect({
          left: left - padding,
          top: top - height - padding,
          right: left + width + padding,
          bottom: top + padding
        })
      }

      var placementPlans = []
      lineData.forEach(function (lineView, lineIndex) {
        var lineLeft = -lineView.line.width / 2
        var baselineY = -totalHeight / 2 + fontPx + lineIndex * lineHeight

        lineView.fragments.forEach(function (fragment, fragmentIndex) {
          var emphasis = emphasisMap.get(fragment.wordIndex) || 1
          var width = Math.max(fragment.endX - fragment.startX, fontPx * 0.18)
          var scale = emphasis > 1 ? baseScale * emphasis : baseScale
          var height = fontPx * scale * 0.95

          placementPlans.push({
            fragment: fragment,
            lineIndex: lineIndex,
            fragmentIndex: fragmentIndex,
            baseX: lineLeft + fragment.startX,
            baseY: baselineY,
            emphasis: emphasis,
            width: width,
            height: height,
            scale: scale,
            collisionWidth: width * scale * (emphasis > 1 ? 1.48 : 1.26),
            collisionHeight: height * (emphasis > 1 ? 1.36 : 1.24),
            padding: baseMargin + (emphasis > 1 ? 10 : 2)
          })
        })
      })

      placementPlans.sort(function (a, b) {
        var emphasisDelta = b.emphasis - a.emphasis
        if (Math.abs(emphasisDelta) > 0.001) return emphasisDelta
        if (a.lineIndex !== b.lineIndex) return a.lineIndex - b.lineIndex
        return a.fragment.startX - b.fragment.startX
      })

      var primaryPlanByWordIndex = new Map()
      placementPlans.forEach(function (plan) {
        if (!primaryPlanByWordIndex.has(plan.fragment.wordIndex)) {
          primaryPlanByWordIndex.set(plan.fragment.wordIndex, plan)
        }
      })
      var heroPlan = heroWordIndex === null ? null : (primaryPlanByWordIndex.get(heroWordIndex) || null)
      var heroMetrics = heroPlan
        ? {
          centerX: (heroPlan.width * heroPlan.scale) / 2,
          centerY: -heroPlan.height * 0.46,
          width: heroPlan.width * heroPlan.scale
        }
        : null

      placementPlans.forEach(function (plan) {
        var fragment = plan.fragment
        var emphasis = plan.emphasis
        var width = plan.width
        var height = plan.height
        var scale = plan.scale
        var collisionWidth = plan.collisionWidth
        var collisionHeight = plan.collisionHeight
        var padding = plan.padding

        var wordSeed = seed + fragment.wordIndex * 17 + plan.lineIndex * 31 + plan.fragmentIndex * 13
        var random = function (offset) {
          var x = Math.sin(wordSeed + offset) * 10000
          return x - Math.floor(x)
        }
        var rotate = 0
        var passedRotate = (random(3) - 0.5) * (animationIntensity === 'chaotic' ? 20 : 12)
        var entryOffsetX = 0
        var entryOffsetY = 0
        var step = Math.max(10, Math.round(fontPx * 0.14))
        var maxRadius = emphasis > 1
          ? Math.max(20, lineHeight * 0.5)
          : Math.max(lineHeight * 2.2, collisionWidth * 0.75, 56)
        var preferredX = emphasis > 1 ? -width / 2 : plan.baseX
        var preferredY = emphasis > 1 ? 0 : plan.baseY

        // 与 hero 词保持最小间距（推开）
        if (!isInterlude && emphasis <= 1 && heroMetrics) {
          var wordCenterX = preferredX + width / 2
          var wordCenterY = preferredY - height * 0.46
          var dx = wordCenterX - heroMetrics.centerX
          var dy = wordCenterY - heroMetrics.centerY
          var distance = Math.hypot(dx, dy)
          if (distance < 1) {
            dx = preferredX >= 0 ? 1 : -1
            dy = plan.lineIndex % 2 === 0 ? -0.65 : 0.65
          }
          var minHeroSeparation = heroMetrics.width * 0.34 + width * 0.52 + padding * 2
          if (distance < minHeroSeparation) {
            var normalizedDistance = Math.max(Math.hypot(dx, dy), 1)
            var ux = dx / normalizedDistance
            var uy = dy / normalizedDistance
            var push = minHeroSeparation - distance
            preferredX += ux * push
            preferredY += uy * push * 0.92
          }
        }

        var horizontalMin = (-maxWidth / 2) - 72
        var horizontalMax = (maxWidth / 2) + 72
        var verticalMin = -Math.max(totalHeight * 0.9, lineHeight * 1.6)
        var verticalMax = Math.max(totalHeight * 0.9, lineHeight * 1.45)
        var chosenX = preferredX
        var chosenY = preferredY
        var found = false
        var bestFallback = { x: preferredX, y: preferredY, score: Number.POSITIVE_INFINITY }
        var baseAngle = heroMetrics && emphasis <= 1
          ? Math.atan2(preferredY, preferredX + width / 2)
          : 0

        for (var radius = 0; radius <= maxRadius && !found; radius += step) {
          var sampleCount = radius === 0
            ? 1
            : emphasis > 1
              ? 8
              : Math.max(12, Math.round((Math.PI * 2 * radius) / Math.max(step * 1.1, 10)))
          var candidates = radius === 0
            ? [[0, 0]]
            : (function () {
              var arr = []
              for (var sampleIndex = 0; sampleIndex < sampleCount; sampleIndex += 1) {
                var angle = baseAngle + (sampleIndex / sampleCount) * Math.PI * 2
                var ellipseY = radius * (emphasis > 1 ? 0.8 : 0.92)
                arr.push([Math.cos(angle) * radius, Math.sin(angle) * ellipseY])
              }
              return arr
            })()

          for (var ci = 0; ci < candidates.length; ci += 1) {
            var dxC = candidates[ci][0]
            var dyC = candidates[ci][1]
            var left = preferredX + dxC - padding
            var top = preferredY + dyC - collisionHeight - padding
            var right = left + collisionWidth + padding * 2
            var bottom = top + collisionHeight + padding * 2
            var withinBounds = left >= horizontalMin
              && right <= horizontalMax
              && top >= verticalMin
              && bottom <= verticalMax
            if (!withinBounds) continue

            var collision = evaluateCollisionRect(left, top, right, bottom)
            var travel = Math.hypot(dxC, dyC)
            var score = collision.overlapArea * 2.2 + travel
            if (score < bestFallback.score) {
              bestFallback = { x: preferredX + dxC, y: preferredY + dyC, score: score }
            }

            if (!collision.intersects) {
              chosenX = preferredX + dxC
              chosenY = preferredY + dyC
              pushPlacementRect(chosenX, chosenY, collisionWidth, collisionHeight, padding)
              found = true
              break
            }
          }
        }

        if (!found) {
          chosenX = bestFallback.x
          chosenY = bestFallback.y
          pushPlacementRect(chosenX, chosenY, collisionWidth, collisionHeight, padding)
        }

        var outwardX = chosenX + width / 2
        var outwardY = chosenY - height * 0.46
        var outwardLength = Math.max(Math.hypot(outwardX, outwardY), 1)
        var outwardUnitX = outwardX / outwardLength
        var outwardUnitY = outwardY / outwardLength
        var driftAmount = isInterlude
          ? 3 + random(6) * 3
          : emphasis > 1
            ? 4 + random(6) * 4
            : animationIntensity === 'chaotic'
              ? 8 + random(6) * 9
              : 5 + random(6) * 6
        var passedDriftX = outwardUnitX * driftAmount + (random(7) - 0.5) * 2.4
        var passedDriftY = outwardUnitY * driftAmount * 0.72 + (random(8) - 0.5) * 2

        placements.push({
          id: fragment.word.text + '-' + fragment.wordIndex + '-' + plan.lineIndex + '-' + plan.fragmentIndex + '-' + fragment.fragmentIndexInWord,
          wordIndex: fragment.wordIndex,
          word: fragment.word,
          text: fragment.text,
          color: fragment.color,
          x: chosenX,
          y: chosenY,
          width: width,
          height: height,
          rotate: rotate,
          scale: scale,
          passedRotate: passedRotate,
          passedDriftX: passedDriftX,
          passedDriftY: passedDriftY,
          entryOffsetX: entryOffsetX,
          entryOffsetY: entryOffsetY,
          fragmentStartInWord: fragment.fragmentStartInWord,
          fragmentEndInWord: fragment.fragmentEndInWord,
          wordGraphemeCount: fragment.wordGraphemeCount,
          wordGraphemeTimings: fragment.wordGraphemeTimings,
          emphasis: emphasis,
          isInterlude: isInterlude
        })
      })

      return placements
    }

    // 预排版状态构建与缓存
    function buildPreparedState(line, viewport) {
      var fontPx = clamp(chooseFontPx(viewport.width, line) * TUNING.fontScale, 24, 132)
      var font = '700 ' + fontPx + 'px ' + fontFamily()
      var pretext = window.Pretext
      if (!pretext) return null

      var prepared = pretext.prepareWithSegments(line.fullText, font)
      var text = prepared.segments.join('')
      var metas = buildSegmentMetas(prepared)
      var lineHeight = Math.round(fontPx * (isCJK(text) ? 1.22 : 1.1))
      var availableWidth = Math.max(viewport.width - 48, 120)
      var minWidth = Math.min(220, availableWidth)
      var wrapCompression = metas.graphemes.length > 12
        ? clamp(0.92 - (metas.graphemes.length - 12) * 0.018, 0.62, 0.92)
        : 0.92
      var compactWidthRatio = TUNING.widthRatio * wrapCompression
      var maxWidth = clamp(Math.min(viewport.width * compactWidthRatio, 820), minWidth, availableWidth)
      var layout = pretext.layoutWithLines(prepared, maxWidth, lineHeight)
      var ranges = findWordRanges(line, metas.graphemes)
      var lineFragments = buildLineFragments(prepared, metas.segmentMetas, metas.graphemes, layout, ranges)
      var placements = buildWordPlacements(
        lineFragments,
        fontPx,
        lineHeight,
        maxWidth,
        theme.animationIntensity,
        line.startTime * 1000,
        line.fullText === '......'
      )

      return {
        prepared: prepared,
        text: text,
        font: font,
        fontPx: fontPx,
        lineHeight: lineHeight,
        maxWidth: maxWidth,
        layout: layout,
        segmentMetas: metas.segmentMetas,
        graphemes: metas.graphemes,
        placements: placements
      }
    }

    function getPreparedState(line, viewport) {
      if (!line) return null
      var cacheKey = [line.startTime, line.endTime, line.fullText, line.words.length].join('|')
      var cached = preparedCache.get(cacheKey)
      if (cached) return cached

      var nextState = buildPreparedState(line, viewport)
      if (nextState) preparedCache.set(cacheKey, nextState)
      return nextState
    }

    function invalidatePreparedCache() {
      var key = [
        theme ? theme.fontFamily || '' : '',
        theme ? theme.fontWeight || 'auto' : 'auto',
        theme ? theme.animationIntensity : '',
        theme ? theme.accentColor : ''
      ].join('|')
      if (key !== preparedContextKey) {
        preparedCache.clear()
        preparedContextKey = key
      }
    }

    // ---------- DOM overlay 节点 ----------
    function createOverlayWordNodes() {
      var outer = document.createElement('div')
      outer.style.cssText = 'position:absolute;left:0;top:0'

      var inner = document.createElement('div')
      inner.style.cssText = 'white-space:nowrap;line-height:1;display:inline-block;position:relative'

      var body = document.createElement('span')
      body.style.cssText = 'line-height:1;display:block;position:relative;z-index:1;white-space:pre'

      var glow = document.createElement('span')
      glow.style.cssText = 'color:transparent;line-height:1;display:block;position:absolute;inset:0;z-index:0;pointer-events:none;white-space:pre'

      inner.appendChild(body)
      inner.appendChild(glow)
      outer.appendChild(inner)

      return { outer: outer, inner: inner, body: body, glow: glow, glyphSpans: [], glyphSignature: '' }
    }

    function syncOverlayGlyphSpans(nodes, texts) {
      var glyphSignature = texts.join('\u0001')
      if (nodes.glyphSignature === glyphSignature) return

      nodes.glow.replaceChildren()
      nodes.glyphSpans = texts.map(function (text) {
        var span = document.createElement('span')
        span.textContent = text
        span.style.color = 'transparent'
        span.style.lineHeight = '1'
        nodes.glow.appendChild(span)
        return span
      })
      nodes.glyphSignature = glyphSignature
    }

    function clearOverlayWordNodes() {
      overlayNodes.forEach(function (nodes) { nodes.outer.remove() })
      overlayNodes.clear()
      animatedPlacement.clear()
    }

    function showEmpty(show) {
      if (!container) return
      if (show && !emptyEl) {
        emptyEl = document.createElement('div')
        emptyEl.style.cssText = [
          'position:absolute', 'left:0', 'right:0', 'top:50%', 'text-align:center',
          'font-size:2rem', 'opacity:0', 'transition:opacity 0.4s',
          'color:' + (theme ? theme.secondaryColor : '#71717a')
        ].join(';')
        emptyEl.textContent = '等待音乐...'
        container.appendChild(emptyEl)
        requestAnimationFrame(function () { if (emptyEl) emptyEl.style.opacity = '0.5' })
      } else if (!show && emptyEl) {
        var el = emptyEl
        emptyEl = null
        el.style.opacity = '0'
        setTimeout(function () { el.remove() }, 400)
      }
    }

    // ---------- 每帧绘制（DOM overlay 指数平滑驱动） ----------
    function drawFrame(frameState, viewport, preparedState, activeLine) {
      var now = performance.now()
      var dt = lastFrameTime === null ? 1 / 60 : clamp((now - lastFrameTime) / 1000, 1 / 240, 0.05)
      lastFrameTime = now

      var time = frameState.currentTime
      var lineTiming = resolveLineRenderTiming(activeLine)
      var lineEnvelope = getClassicLineEnvelope(time, activeLine, lineTiming)
      var wordRevealMode = lineTiming.wordRevealMode
      var isInstantWordReveal = wordRevealMode === 'instant'
      var lineSeed = Math.abs(Math.sin(activeLine.startTime * 997.1))
      var linePerspective = theme.animationIntensity === 'chaotic' ? 500 + Math.round(lineSeed * 500) : 1000
      var energy = clamp(frameState.audioPower || 0, 0, 1)
      var motionEnergy = energy * TUNING.motionAmount
      var verticalLift = Math.sin(time * 2.3) * (3 + motionEnergy * 8)
      var focusY = viewport.height * 0.42 + verticalLift

      lineLayer.style.opacity = String(lineEnvelope.opacity)
      lineLayer.style.filter = lineEnvelope.blur > 0.05 ? 'blur(' + lineEnvelope.blur.toFixed(2) + 'px)' : 'none'
      lineLayer.style.transform = 'scale(' + lineEnvelope.scale + ')'
      lineLayer.style.perspective = linePerspective + 'px'

      var order = { waiting: 0, passed: 1, active: 2 }
      var placements = preparedState.placements.slice().sort(function (a, b) {
        return order[getWordStatus(time, lineTiming, a.word)] - order[getWordStatus(time, lineTiming, b.word)]
      })
      var placementIds = new Set()
      placements.forEach(function (p) { placementIds.add(p.id) })
      var usedOverlayIds = new Set()
      var width = viewport.width

      placements.forEach(function (placement, placementIndex) {
        var status = getWordStatus(time, lineTiming, placement.word)
        var progress = getWordProgress(time, wordRevealMode, placement.word)
        var passedAlpha = isInstantWordReveal
          ? 0
          : theme.animationIntensity === 'chaotic' ? 0.9 : 0.82
        var pulse = status === 'active' && !isInstantWordReveal
          ? 1 + Math.sin(time * ACTIVE_PULSE_FREQUENCY + placement.word.startTime * 5) * 0.04 * TUNING.motionAmount
          : 1
        var passedDriftProgress = isInstantWordReveal ? 0 : getClassicPassedDrift(time, placement.word)
        var targetScale = status === 'waiting'
          ? (isInstantWordReveal ? placement.scale : Math.max(placement.scale * 0.5, 0.5))
          : status === 'active'
            ? (isInstantWordReveal ? placement.scale : placement.scale * 1.3 * pulse)
            : placement.scale
        var targetRotation = status === 'waiting'
          ? (isInstantWordReveal ? placement.rotate : placement.rotate + 20)
          : status === 'passed'
            ? (isInstantWordReveal ? placement.rotate : placement.rotate + placement.passedRotate * passedDriftProgress)
            : placement.rotate
        var localFloatX = Math.sin(time * 1.2 + placementIndex * 0.6) * motionEnergy * 4
        var localFloatY = Math.cos(time * 1.5 + placementIndex * 0.4) * motionEnergy * 2.5
        var passedDriftX = status === 'passed' ? placement.passedDriftX * passedDriftProgress : 0
        var passedDriftY = status === 'passed' ? placement.passedDriftY * passedDriftProgress : 0
        var targetX = width / 2 + placement.x + localFloatX + passedDriftX + (status === 'waiting' ? placement.entryOffsetX : 0)
        var targetY = focusY + placement.y + localFloatY + passedDriftY + (status === 'waiting' ? placement.entryOffsetY : 0)
        var targetBodyAlpha = status === 'waiting' ? 0 : status === 'active' ? 1 : passedAlpha
        var targetBlur = status === 'waiting' && !isInstantWordReveal ? 10 : 0
        var targetActiveMix = getClassicBodyMix(time, lineTiming, placement.word)
        var targetGlowAlpha = getClassicGlowEnvelope(time, lineTiming, placement.word)
        var transformTransitionAmount = 1 - Math.exp(-11 * dt)
        var visualTransitionAmount = 1 - Math.exp(-14 * dt)
        var existingState = animatedPlacement.get(placement.id)
        var shouldInitializeAsActive = isInstantWordReveal && time >= placement.word.startTime
        var animatedState = existingState || {
          x: width / 2 + placement.x + placement.entryOffsetX,
          y: focusY + placement.y + placement.entryOffsetY,
          rotation: shouldInitializeAsActive ? targetRotation : targetRotation + 16,
          scale: shouldInitializeAsActive ? targetScale : Math.max(placement.scale * 0.5, 0.5),
          bodyAlpha: shouldInitializeAsActive ? targetBodyAlpha : 0,
          blur: shouldInitializeAsActive ? targetBlur : 10,
          activeMix: shouldInitializeAsActive ? targetActiveMix : 0,
          glowAlpha: shouldInitializeAsActive ? targetGlowAlpha : 0
        }

        animatedState.x = mix(animatedState.x, targetX, transformTransitionAmount)
        animatedState.y = mix(animatedState.y, targetY, transformTransitionAmount)
        animatedState.rotation = mix(animatedState.rotation, targetRotation, transformTransitionAmount)
        animatedState.scale = mix(animatedState.scale, targetScale, transformTransitionAmount)
        animatedState.bodyAlpha = mix(animatedState.bodyAlpha, targetBodyAlpha, visualTransitionAmount)
        animatedState.blur = mix(animatedState.blur, targetBlur, visualTransitionAmount)
        animatedState.activeMix = mix(animatedState.activeMix, targetActiveMix, visualTransitionAmount)
        animatedState.glowAlpha = mix(animatedState.glowAlpha, targetGlowAlpha, 1 - Math.exp(-16 * dt))
        animatedPlacement.set(placement.id, animatedState)

        if (animatedState.bodyAlpha < 0.015 && animatedState.glowAlpha < 0.015) return

        var drawX = animatedState.x
        var drawBaselineY = animatedState.y
        var textX = -placement.width / 2
        var textY = placement.height * 0.42
        var textColor = ColorMix.mixColors(theme.primaryColor, placement.color, animatedState.activeMix)

        var overlayAnchorX = drawX + placement.width / 2
        var overlayAnchorY = drawBaselineY - placement.height * 0.42
        var overlayOffsetX = textX
        var measureSpan = document.createElement('span')
        measureSpan.style.cssText = 'position:absolute;visibility:hidden;white-space:pre;font:' + preparedState.font
        measureSpan.textContent = placement.text
        overlay.appendChild(measureSpan)
        var measuredAscent = preparedState.fontPx * 0.78
        var measureRect = measureSpan.getBoundingClientRect()
        if (measureRect.height > 0) measuredAscent = measureRect.height * 0.78
        overlay.removeChild(measureSpan)
        var overlayOffsetY = textY - measuredAscent
        var glyphs = splitGraphemes(placement.text)
        var shouldSplitGlow = wordRevealMode === 'normal' && !isCJK(placement.text) && glyphs.length > 1
        var blurScale = 1 + energy * 0.22
        usedOverlayIds.add(placement.id)

        var overlayWord = overlayNodes.get(placement.id)
        if (!overlayWord) {
          overlayWord = createOverlayWordNodes()
          overlayNodes.set(placement.id, overlayWord)
          overlay.appendChild(overlayWord.outer)
        }

        overlayWord.outer.style.transform = 'translate3d(' + overlayAnchorX + 'px, ' + overlayAnchorY + 'px, 0) rotate(' + animatedState.rotation + 'deg) scale(' + animatedState.scale + ')'
        overlayWord.outer.style.transformOrigin = '0 0'
        overlayWord.inner.style.font = preparedState.font
        overlayWord.inner.style.transform = 'translate3d(' + overlayOffsetX + 'px, ' + overlayOffsetY + 'px, 0)'
        overlayWord.body.textContent = placement.text
        overlayWord.body.style.color = textColor
        overlayWord.body.style.opacity = String(animatedState.bodyAlpha)
        overlayWord.body.style.filter = animatedState.blur > 0.05 ? 'blur(' + animatedState.blur.toFixed(2) + 'px)' : 'none'

        var glowTexts = shouldSplitGlow ? glyphs : [placement.text]
        syncOverlayGlyphSpans(overlayWord, glowTexts)

        if (shouldSplitGlow) {
          overlayWord.glyphSpans.forEach(function (glyphSpan, glyphIndex) {
            var absoluteIndex = placement.fragmentStartInWord + glyphIndex
            var intensity = getClassicCharGlow(
              time,
              placement.word,
              absoluteIndex,
              Math.max(placement.wordGraphemeCount, glyphs.length),
              placement.wordGraphemeTimings
            ) * clamp(animatedState.glowAlpha, 0, 1) * Math.max(TUNING.glowIntensity, 0)
            glyphSpan.style.textShadow = buildDomTextShadow(placement.color, intensity, blurScale)
          })
        } else if (overlayWord.glyphSpans[0]) {
          var glowIntensity = getClassicGlowEnvelope(time, lineTiming, placement.word)
            * clamp(animatedState.glowAlpha, 0, 1)
            * Math.max(TUNING.glowIntensity, 0)
          overlayWord.glyphSpans[0].style.textShadow = buildDomTextShadow(placement.color, glowIntensity, blurScale)
        }
      })

      animatedPlacement.forEach(function (_value, key) {
        if (!placementIds.has(key)) animatedPlacement.delete(key)
      })

      overlayNodes.forEach(function (nodes, key) {
        if (!usedOverlayIds.has(key)) {
          nodes.outer.remove()
          overlayNodes.delete(key)
        }
      })
    }

    function setTheme(newTheme) {
      theme = newTheme
    }

    function setLines() { /* 行数据经 tick 传入 */ }

    function tick(frameState) {
      if (!theme) return
      showText = frameState.showText !== false
      invalidatePreparedCache()

      var viewport = { width: window.innerWidth, height: window.innerHeight }
      var runtimeState = Runtime.getRuntimeState({
        lines: frameState.lines,
        currentLineIndex: frameState.currentLineIndex,
        currentTime: frameState.currentTime,
        getLineEndTime: RenderHints.getLineRenderEndTime
      })

      if (!showText || viewport.width <= 0 || viewport.height <= 0) {
        getPreparedState(runtimeState.upcomingLine, viewport)
        lineLayer.style.opacity = '0'
        lineLayer.style.filter = 'none'
        lineLayer.style.transform = 'scale(1)'
        showEmpty(showText)
        return
      }

      // 先预热 upcoming，再准备 active（原版 prepareActiveAndUpcoming）
      getPreparedState(runtimeState.upcomingLine, viewport)
      var preparedState = getPreparedState(runtimeState.activeLine, viewport)
      var activeLine = runtimeState.activeLine

      if (!preparedState || !activeLine) {
        lineLayer.style.opacity = '0'
        lineLayer.style.filter = 'none'
        lineLayer.style.transform = 'scale(1)'
        lineLayer.style.perspective = '1000px'
        clearOverlayWordNodes()
        showEmpty(showText)
        window.FoliaSubtitleOverlay.update({
          hostEl: host, showText: showText, activeLine: null,
          recentCompletedLine: runtimeState.recentCompletedLine,
          nextLines: runtimeState.nextLines, theme: theme
        })
        return
      }

      showEmpty(false)
      drawFrame(frameState, viewport, preparedState, activeLine)

      window.FoliaSubtitleOverlay.update({
        hostEl: host, showText: showText, activeLine: activeLine,
        recentCompletedLine: runtimeState.recentCompletedLine,
        nextLines: runtimeState.nextLines, theme: theme
      })
    }

    function destroy() {
      clearOverlayWordNodes()
      preparedCache.clear()
      if (container) { container.remove(); container = null }
      lineLayer = null
      overlay = null
      emptyEl = null
      lastFrameTime = null
      window.FoliaSubtitleOverlay.destroy()
      host = null
    }

    return {
      id: 'cadenza',
      mount: mount,
      setTheme: setTheme,
      setLines: setLines,
      setFontScale: function (s) { fontScale = s === undefined ? 1 : s },
      tick: tick,
      destroy: destroy
    }
  }

  window.FoliaModeCadenza = { create: createMode }
})()
