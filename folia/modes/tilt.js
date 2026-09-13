// 倾诉模式：移植自 folia-major src/components/visualizer/tilt/VisualizerTilt.tsx
// 歌词按概率拆成 1-4 行（SentenceLayout 分句），两种排版：常规横排 vs 大号斜体错落（tilt 行）。
// 行按时间顺序依次揭示；tilt 行字符上下交替偏移；所有字符有逐字脉冲（唱歌时呼吸式缩放）。
// 宽度溢出时重拆或缩放兜底（pretext 测量）。
(function () {
  'use strict'

  var Runtime = window.FoliaVisualizerRuntime
  var RenderHints = window.FoliaRenderHints
  var GraphemeTiming = window.FoliaGraphemeTiming
  var SentenceLayout = window.FoliaSentenceLayout

  // 原版 DEFAULT_TILT_TUNING
  var TUNING = { splitProbability: 0.75, tiltStyleProbability: 0.35, colorScheme: 'default' }

  var CHAR_REF_LENGTH = 20
  var LOG_OFFSET = 4
  var LINE_THRESHOLDS = [0.45, 1.05, 1.7]
  var REM_PX = 16
  var RESPLIT_THRESHOLD = 1.6
  var SCALE_FLOOR_NORMAL = 0.55
  var SCALE_FLOOR_TILT = 0.5

  function seededRandom(seed, offset) {
    var x = Math.sin(seed * 1000 + offset) * 10000
    return x - Math.floor(x)
  }

  function determineLineCount(charCount, seed, splitProbability) {
    var normalized = Math.log(charCount + LOG_OFFSET) / Math.log(CHAR_REF_LENGTH + LOG_OFFSET)
    var jitter = seededRandom(seed, 1) * 0.6 + 0.7
    var score = normalized * jitter * splitProbability
    if (score < LINE_THRESHOLDS[0]) return 1
    if (score < LINE_THRESHOLDS[1]) return 2
    if (score < LINE_THRESHOLDS[2]) return 3
    return 4
  }

  function getAvailableWidth() {
    return Math.max(320, window.innerWidth) * 0.85
  }

  function splitGraphemeObjs(text) {
    var segs = []
    var iter = new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)[Symbol.iterator]()
    var res = iter.next()
    while (!res.done) { segs.push(res.value); res = iter.next() }
    return segs
  }

  // 找 segment 覆盖的词范围（把 charOffset 映射回 words 下标）
  function findSegmentWordRange(charOffset, segmentText, fullText, words) {
    var segmentStart = charOffset
    if (segmentStart < 0 || segmentStart >= fullText.length) return { startWordIndex: 0, endWordIndex: words.length }

    var segmentEnd = segmentStart + segmentText.length

    var fullTextPos = 0
    var startWordIndex = 0
    var endWordIndex = words.length

    for (var wi = 0; wi < words.length; wi += 1) {
      var wordText = words[wi].text
      var wordFullStart = fullText.indexOf(wordText, fullTextPos)

      if (wordFullStart === -1) {
        fullTextPos += wordText.length
        continue
      }

      var wordFullEnd = wordFullStart + wordText.length

      if (wordFullStart <= segmentStart && wordFullEnd > segmentStart) startWordIndex = wi
      if (wordFullStart < segmentEnd && wordFullEnd >= segmentEnd) { endWordIndex = wi + 1; break }

      fullTextPos = wordFullEnd
    }

    return { startWordIndex: startWordIndex, endWordIndex: endWordIndex }
  }

  // 分句内逐字符时间（优先词级时间，对齐失败按段时长均分）
  function buildCharTimings(charOffset, segmentText, segmentStartTime, segmentEndTime, activeLine) {
    var graphemes = splitGraphemeObjs(segmentText)
    if (!activeLine || graphemes.length === 0) return []

    var nonSpaceGraphemes = graphemes.filter(function (g) { return !/^\s+$/.test(g.segment) })
    if (nonSpaceGraphemes.length === 0) return []

    var totalDuration = Math.max(segmentEndTime - segmentStartTime, 0.3)
    var range = findSegmentWordRange(charOffset, segmentText, activeLine.fullText, activeLine.words)
    var segmentWords = activeLine.words.slice(range.startWordIndex, range.endWordIndex)

    var currentCharIndex = 0
    var timings = []

    if (segmentWords.length > 0) {
      for (var wi = 0; wi < segmentWords.length; wi += 1) {
        var word = segmentWords[wi]
        var wordGraphemes = splitGraphemeObjs(word.text)
        var wordNonSpaceCount = wordGraphemes.filter(function (g) { return !/^\s+$/.test(g.segment) }).length
        if (wordNonSpaceCount === 0) continue

        // 有字形时间则用之（原版优先 syllables/grapheme timings）
        var wordTimings = GraphemeTiming.buildWordGraphemeTimings(word).filter(function (t) { return !/^\s+$/.test(t.char) })
        if (wordTimings.length >= wordNonSpaceCount) {
          for (var ti = 0; ti < wordTimings.length; ti += 1) {
            if (currentCharIndex >= nonSpaceGraphemes.length) break
            timings.push({ charIndex: currentCharIndex, startTime: wordTimings[ti].startTime, endTime: wordTimings[ti].endTime })
            currentCharIndex += 1
          }
          continue
        }

        var wordDuration = Math.max(word.endTime - word.startTime, 0.05)
        var charDuration = wordDuration / wordNonSpaceCount
        var nonSpaceCi = 0

        for (var gi = 0; gi < wordGraphemes.length; gi += 1) {
          if (currentCharIndex >= nonSpaceGraphemes.length) break
          if (/^\s+$/.test(wordGraphemes[gi].segment)) continue
          timings.push({
            charIndex: currentCharIndex,
            startTime: word.startTime + nonSpaceCi * charDuration,
            endTime: word.startTime + (nonSpaceCi + 1) * charDuration
          })
          currentCharIndex += 1
          nonSpaceCi += 1
        }
      }
    }

    if (timings.length === 0 || timings.length !== nonSpaceGraphemes.length) {
      var avgCharDuration = totalDuration / nonSpaceGraphemes.length
      timings.length = 0
      currentCharIndex = 0

      for (var i = 0; i < graphemes.length; i += 1) {
        if (/^\s+$/.test(graphemes[i].segment)) continue
        timings.push({
          charIndex: currentCharIndex,
          startTime: segmentStartTime + currentCharIndex * avgCharDuration,
          endTime: segmentStartTime + (currentCharIndex + 1) * avgCharDuration
        })
        currentCharIndex += 1
      }
    }

    return timings
  }

  // 逐字脉冲强度（正弦呼吸 + 0.25 余晖）
  function getCharPulseIntensity(currentTime, charTiming) {
    var startTime = charTiming.startTime
    var endTime = charTiming.endTime
    var rawDuration = Math.max(endTime - startTime, 0.05)
    var duration = Math.min(Math.max(rawDuration, 0.2), 0.9)
    var elapsed = currentTime - startTime

    if (elapsed < 0) return 0

    if (elapsed <= duration) {
      var progress = elapsed / duration
      return Math.sin(progress * Math.PI)
    }

    var afterElapsed = elapsed - duration
    var afterglowRamp = duration * 1.2
    if (afterElapsed >= afterglowRamp) return 0.25

    return 0.25 * (afterElapsed / afterglowRamp)
  }

  // pretext 测量文本在指定字号下的宽度
  function measureAtSize(text, pxSize, fontSpec) {
    var pretext = window.Pretext
    if (!pretext) return text.length * pxSize * 0.6
    var prepared = pretext.prepareWithSegments(text, fontSpec)
    var layout = pretext.layoutWithLines(prepared, 99999, pxSize * 1.4)
    return layout.lines[0] ? layout.lines[0].width : text.length * pxSize * 0.6
  }

  function fontFamily(theme) {
    return window.foliaGetLyricFontFamily
      ? window.foliaGetLyricFontFamily()
      : (theme && theme.fontFamily) || 'sans-serif'
  }

  // 倾诉布局：分句 + 随机 tilt 行 + 溢出处理
  function buildTiltLayout(fullText, lineSeed, theme, fontScale) {
    var fontStack = fontFamily(theme)
    var viewportWidth = window.innerWidth
    var measureMaxPx = Math.max(viewportWidth * 0.06875, 5.625 * REM_PX * fontScale)
    var normalFontSpec = '400 ' + measureMaxPx + 'px ' + fontStack
    var tiltFontSpec = '300 ' + measureMaxPx + 'px ' + fontStack + ' italic'
    var availableWidth = getAvailableWidth()

    var charCount = fullText.trim().length
    var isEllipsisOnly = /^[\s.…·。]+$/.test(fullText.trim())
    var mergedSegments

    if (isEllipsisOnly) {
      mergedSegments = [fullText]
    } else {
      var numLines = determineLineCount(charCount, lineSeed, TUNING.splitProbability)
      var layoutUnits = SentenceLayout.splitIntoSentences(fullText, numLines, lineSeed)
      mergedSegments = layoutUnits.map(function (u) { return u.text })
    }

    // 候选 tilt 行（每行按概率掷点）
    var candidates = []
    mergedSegments.forEach(function (_seg, i) {
      var lineRoll = seededRandom(lineSeed, 100 + i)
      if (lineRoll < TUNING.tiltStyleProbability) candidates.push(i)
    })

    var finalTiltIndex = -1
    if (candidates.length > 0) {
      finalTiltIndex = candidates[Math.floor(seededRandom(lineSeed, 200) * candidates.length)]
    }

    var offsetAccum = 0
    var segments = mergedSegments.map(function (text, i) {
      var trimmed = text.trimStart().trimEnd()
      var leadingSpaces = text.length - text.trimStart().length
      var seg = {
        text: trimmed,
        isTilt: i === finalTiltIndex,
        isShortLastLine: false,
        charOffset: offsetAccum + leadingSpaces
      }
      offsetAccum += text.length
      return seg
    })

    var scaleMultiplier = 1
    var tiltWithWidth = segments.filter(function (s) { return s.isTilt })
      .map(function (s) { return { text: s.text, width: measureAtSize(s.text, measureMaxPx, tiltFontSpec) } })
      .sort(function (a, b) { return b.width - a.width })
    var normalWithWidth = segments.filter(function (s) { return !s.isTilt })
      .map(function (s) { return { text: s.text, width: measureAtSize(s.text, measureMaxPx, normalFontSpec) } })
      .sort(function (a, b) { return b.width - a.width })

    var tiltWidth = tiltWithWidth.length ? tiltWithWidth[0].width : 0
    var normalWidth = normalWithWidth.length ? normalWithWidth[0].width : 0

    var tiltOverflow = tiltWidth > 0 ? tiltWidth / availableWidth : 0
    var normalOverflow = normalWidth > 0 ? normalWidth / availableWidth : 0
    var maxOverflow = Math.max(tiltOverflow, normalOverflow)

    function markShortLastLine(segs) {
      if (segs.length < 2) return segs
      var last = segs[segs.length - 1]
      if (last.isTilt || last.text.trim().length > 2) return segs
      var prev = segs[segs.length - 2]
      if (last.text.trim().length * 2 <= prev.text.length) {
        segs[segs.length - 1] = Object.assign({}, last, { isShortLastLine: true })
      }
      return segs
    }

    if (maxOverflow > 1) {
      if (maxOverflow >= RESPLIT_THRESHOLD) {
        var targetWidth = availableWidth * (RESPLIT_THRESHOLD - 0.15)
        var totalEstWidth = measureAtSize(fullText, measureMaxPx, normalFontSpec)
        var extraSplitsNeeded = Math.min(4, Math.max(segments.length + 1, Math.ceil(totalEstWidth / targetWidth)))
        if (extraSplitsNeeded > segments.length) {
          var reSplitUnits = SentenceLayout.splitIntoSentences(fullText, extraSplitsNeeded, lineSeed)
          var reSplitOffset = 0
          var newSegments = reSplitUnits.map(function (u) {
            var trimmed = u.text.trimStart().trimEnd()
            var leadingSpaces = u.text.length - u.text.trimStart().length
            var seg = { text: trimmed, isTilt: false, isShortLastLine: false, charOffset: reSplitOffset + leadingSpaces }
            reSplitOffset += u.text.length
            return seg
          })
          if (newSegments.length > 0) {
            var resplitTiltRoll = seededRandom(lineSeed, 300)
            if (resplitTiltRoll < TUNING.tiltStyleProbability) {
              var picked = Math.floor(seededRandom(lineSeed, 301) * newSegments.length)
              newSegments[picked].isTilt = true
            }
          }

          var postWidestTilt = null
          for (var i = 0; i < newSegments.length; i += 1) {
            if (newSegments[i].isTilt) { postWidestTilt = newSegments[i]; break }
          }
          var postNormalWithWidth = newSegments.filter(function (s) { return !s.isTilt })
            .map(function (s) { return { text: s.text, width: measureAtSize(s.text, measureMaxPx, normalFontSpec) } })
            .sort(function (a, b) { return b.width - a.width })
          var postWidestNormal = postNormalWithWidth.length ? postNormalWithWidth[0] : null

          var postScale = 1
          if (postWidestTilt) {
            var wTilt = measureAtSize(postWidestTilt.text, measureMaxPx, tiltFontSpec)
            if (wTilt > availableWidth) postScale = Math.max(SCALE_FLOOR_TILT, availableWidth / wTilt)
          } else if (postWidestNormal) {
            var wNormal = measureAtSize(postWidestNormal.text, measureMaxPx, normalFontSpec)
            if (wNormal > availableWidth) postScale = Math.max(SCALE_FLOOR_NORMAL, availableWidth / wNormal)
          }

          return { segments: markShortLastLine(newSegments), scaleMultiplier: postScale }
        }
      }

      if (tiltOverflow >= normalOverflow && tiltWithWidth.length) {
        scaleMultiplier = Math.max(SCALE_FLOOR_TILT, availableWidth / tiltWidth)
      } else if (normalWithWidth.length) {
        scaleMultiplier = Math.max(SCALE_FLOOR_NORMAL, availableWidth / normalWidth)
      }
    }

    return { segments: markShortLastLine(segments), scaleMultiplier: scaleMultiplier }
  }

  function createMode() {
    var host = null
    var layerEl = null
    var lineContainer = null
    var currentLineEl = null
    var currentLineKey = null
    var charItems = []       // [{span, mv: 当前 scale, graphemeIndex, timing, isTilt}]
    var segmentStates = []   // [{el, visible, isTilt, charSpans}]
    var theme = null
    var fontScale = 1
    var showText = true
    var visibleSegmentIndex = -1
    var layout = null
    var segmentTimings = null
    var layoutKey = null

    function mount(hostEl) {
      host = hostEl

      layerEl = document.createElement('div')
      layerEl.className = 'folia-mode-tilt'
      layerEl.style.cssText = [
        'position:absolute', 'left:0', 'right:0', 'top:0', 'height:70vh', 'z-index:10',
        'display:flex', 'align-items:center', 'justify-content:center', 'padding:32px',
        'pointer-events:none'
      ].join(';')

      lineContainer = document.createElement('div')
      lineContainer.style.cssText = 'display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px'
      layerEl.appendChild(lineContainer)
      host.appendChild(layerEl)
    }

    // 颜色方案（原版 getColors，colorScheme 默认 'default'）
    function getColors(colorScheme) {
      var scheme = colorScheme || TUNING.colorScheme
      switch (scheme) {
        case 'swap':
          return { normal: theme.accentColor || theme.primaryColor, tilt: theme.primaryColor }
        case 'accentAll':
          return { normal: theme.accentColor || theme.primaryColor, tilt: theme.accentColor || theme.primaryColor }
        case 'primaryAll':
          return { normal: theme.primaryColor, tilt: theme.primaryColor }
        default:
          return { normal: theme.primaryColor, tilt: theme.accentColor || theme.primaryColor }
      }
    }

    function resolveThemeFontWeight(theme, fallback) {
      if (theme && typeof theme.fontWeight === 'number' && Number.isFinite(theme.fontWeight)) {
        return Math.min(900, Math.max(100, Math.round(theme.fontWeight / 10) * 10))
      }
      return fallback
    }

    // ---------- 行构建 ----------
    function buildLineEl(activeLine, lineLayout, timings) {
      var lineEl = document.createElement('div')
      lineEl.style.cssText = [
        'display:flex', 'flex-direction:column', 'align-items:center', 'justify-content:center',
        'gap:16px', 'will-change:transform,opacity'
      ].join(';')
      // 行容器入场淡入（对齐原版 wrapper initial opacity:0 → animate opacity:1）。
      // 若只置 0 不点亮，整行恒不可见；且行结束的退场动画从 1 起播会让整行瞬间闪现
      lineEl.animate(
        [{ opacity: 0 }, { opacity: 1 }],
        { duration: 300, easing: 'ease-out', fill: 'forwards' }
      )

      var colors = getColors()
      charItems = []
      segmentStates = []

      lineLayout.segments.forEach(function (segment, si) {
        var baseFontScale = fontScale * lineLayout.scaleMultiplier
        var shortLastBoost = segment.isShortLastLine ? 1.18 : 1
        var viewportWidth = window.innerWidth
        var tiltFontPx = Math.min(viewportWidth * 0.06875 * baseFontScale, 5.625 * REM_PX * baseFontScale)
        var yOffset = tiltFontPx / 6
        var fontSizePx = Math.min(viewportWidth * 0.06875 * baseFontScale * (segment.isTilt ? 1 : shortLastBoost), 5.625 * REM_PX * baseFontScale * (segment.isTilt ? 1 : shortLastBoost))

        var segEl = document.createElement('div')
        segEl.style.cssText = [
          'white-space:nowrap',
          'font-size:' + fontSizePx + 'px',
          'color:' + (segment.isTilt ? colors.tilt : colors.normal),
          'font-style:' + (segment.isTilt ? 'italic' : 'normal'),
          'line-height:' + (segment.isTilt ? 1.25 : 1.35),
          'font-weight:' + resolveThemeFontWeight(theme, segment.isTilt ? 300 : 400),
          'letter-spacing:' + (segment.isTilt ? '0.15em' : '0.08em'),
          'will-change:transform,opacity'
        ].join(';')

        var graphemes = splitGraphemeObjs(segment.text)
        var charTimings = timings ? timings[si] : []
        var charIndexMap = []
        var idx = 0
        graphemes.forEach(function (seg) {
          var isSpace = /^\s+$/.test(seg.segment)
          if (!isSpace) idx += 1
          charIndexMap.push(idx - 1)
        })

        var state = { el: segEl, visible: false, isTilt: segment.isTilt, charSpans: [] }
        var visualIndex = 0

        graphemes.forEach(function (seg, ti) {
          var isSpace = /^\s+$/.test(seg.segment)
          var isEven = visualIndex % 2 === 0
          var yStagger = isEven ? -1 : 1
          var ci = visualIndex
          if (!isSpace) visualIndex += 1

          var span = document.createElement('span')
          span.className = 'inline-block'
          span.style.cssText = [
            'display:inline-block',
            'transition:transform 0.06s ease-out',
            isSpace ? 'min-width:' + (segment.isTilt ? '0.35em' : '0.25em') : ''
          ].join(';')
          span.textContent = isSpace ? '\u00A0' : seg.segment
          span.style.opacity = '0'
          span.style.transform = 'translateY(0) scale(1)'
          if (!isSpace && segment.isTilt) span.dataset.yStagger = String(yStagger * yOffset)
          if (!isSpace && !segment.isTilt) span.dataset.yStagger = '0'

          segEl.appendChild(span)
          state.charSpans.push({
            span: span,
            isSpace: isSpace,
            visualIndex: ci,
            yStagger: isSpace ? 0 : yStagger * yOffset,
            yStaggerBoost: isSpace ? 0 : yStagger * yOffset * 2,
            charIndex: charIndexMap[ti],
            isTilt: segment.isTilt,
            shown: false
          })
        })

        lineEl.appendChild(segEl)
        segmentStates.push(state)
      })

      return lineEl
    }

    // 字符揭示动画（可见时带 delay 错峰）
    function revealSegment(state, index, delayStep, duration) {
      if (state.visible) return
      state.visible = true

      var easing = 'cubic-bezier(0.25, 0.46, 0.45, 0.94)'
      state.el.animate(
        [
          { opacity: 0, transform: state.isTilt ? 'translateY(24px) scale(0.92)' : 'translateY(20px)' },
          { opacity: 1, transform: state.isTilt ? 'translateY(0) scale(1)' : 'translateY(0)' }
        ],
        { duration: state.isTilt ? 600 : 550, easing: easing, fill: 'forwards' }
      )

      state.charSpans.forEach(function (charItem) {
        // fill:'forwards' 会永久压过内联样式，导致 updateCharPulse 的逐字脉冲失效，
        // 因此入场动画结束后取消效果并把终态落到内联样式
        if (charItem.isSpace) {
          var spaceAnim = charItem.span.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 500, fill: 'forwards' })
          spaceAnim.onfinish = function () {
            spaceAnim.cancel()
            charItem.span.style.opacity = '1'
          }
          return
        }
        var charAnim = charItem.span.animate(
          [
            { opacity: 0, transform: 'translateY(' + (charItem.isTilt ? charItem.yStaggerBoost : 0) + 'px) scale(1)' },
            { opacity: 1, transform: 'translateY(' + charItem.yStagger + 'px) scale(1)' }
          ],
          { duration: 500, delay: charItem.visualIndex * (charItem.isTilt ? 50 : 40), easing: easing, fill: 'forwards' }
        )
        charAnim.onfinish = function () {
          charAnim.cancel()
          charItem.span.style.opacity = '1'
          charItem.span.style.transform = 'translateY(' + charItem.yStagger + 'px) scale(1)'
        }
      })
    }

    // 每帧：字符脉冲缩放
    function updateCharPulse(now) {
      for (var si = 0; si < segmentStates.length; si += 1) {
        var state = segmentStates[si]
        if (!state.visible) continue

        var charTimings = segmentTimings ? segmentTimings[si].charTimings : null
        state.charSpans.forEach(function (charItem) {
          if (charItem.isSpace) {
            charItem.span.style.transform = 'translateY(' + charItem.yStagger + 'px) scale(1)'
            return
          }
          if (!charTimings || charTimings.length === 0) {
            charItem.span.style.transform = 'translateY(' + charItem.yStagger + 'px) scale(1)'
            return
          }
          var timing = charTimings[charItem.charIndex]
          if (!timing) {
            charItem.span.style.transform = 'translateY(' + charItem.yStagger + 'px) scale(1)'
            return
          }
          var intensity = getCharPulseIntensity(now, timing)
          var scale = 1 + intensity * (charItem.isTilt ? 0.18 : 0.15)
          charItem.span.style.transform = 'translateY(' + charItem.yStagger + 'px) scale(' + scale + ')'
        })
      }
    }

    function setTheme(newTheme) {
      theme = newTheme
    }

    function setLines() { /* 行数据经 tick 传入 */ }

    function tick(frameState) {
      if (!theme) return
      var now = frameState.currentTime
      showText = frameState.showText !== false

      var runtimeState = Runtime.getRuntimeState({
        lines: frameState.lines,
        currentLineIndex: frameState.currentLineIndex,
        currentTime: now,
        getLineEndTime: RenderHints.getLineRenderEndTime
      })

      var activeLine = runtimeState.activeLine

      if (!showText || !activeLine || !activeLine.fullText) {
        if (currentLineEl) {
          var oldEl = currentLineEl
          oldEl.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 450, easing: 'ease-in-out', fill: 'forwards' })
          setTimeout(function () { oldEl.remove() }, 460)
          currentLineEl = null
          currentLineKey = null
          charItems = []
          segmentStates = []
        }
        window.FoliaSubtitleOverlay.update({
          hostEl: host, showText: showText, activeLine: null,
          recentCompletedLine: runtimeState.recentCompletedLine,
          nextLines: runtimeState.nextLines, theme: theme
        })
        return
      }

      // 行变化时重建布局
      var key = activeLine.startTime
      if (key !== currentLineKey) {
        currentLineKey = key
        if (currentLineEl) {
          var previous = currentLineEl
          previous.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 450, easing: 'ease-in-out', fill: 'forwards' })
          setTimeout(function () { previous.remove() }, 460)
        }

        layout = buildTiltLayout(activeLine.fullText, activeLine.startTime, theme, fontScale)
        visibleSegmentIndex = -1

        // 分句时间范围 + 逐字时间
        segmentTimings = layout.segments.map(function (seg) {
          var range = findSegmentWordRange(seg.charOffset, seg.text, activeLine.fullText, activeLine.words)
          var segWords = activeLine.words.slice(range.startWordIndex, range.endWordIndex)

          var start
          var end
          if (segWords.length > 0) {
            start = segWords[0].startTime
            end = segWords[segWords.length - 1].endTime
          } else {
            start = activeLine.startTime
            end = RenderHints.getLineRenderEndTime(activeLine)
          }

          return {
            start: start,
            end: end,
            charTimings: buildCharTimings(seg.charOffset, seg.text, start, end, activeLine)
          }
        })

        var newLineEl = buildLineEl(activeLine, layout, segmentTimings)
        lineContainer.appendChild(newLineEl)
        currentLineEl = newLineEl
      }

      // 可见分句推进
      var targetIndex = -1
      for (var i = 0; i < segmentTimings.length; i += 1) {
        if (now >= segmentTimings[i].start - 0.25) targetIndex = i
      }
      if (now < activeLine.startTime - 0.1 || now > RenderHints.getLineRenderEndTime(activeLine)) {
        targetIndex = -1
      }

      for (var si = 0; si <= targetIndex; si += 1) {
        revealSegment(segmentStates[si], si, 50, 500)
      }

      updateCharPulse(now)

      window.FoliaSubtitleOverlay.update({
        hostEl: host, showText: showText, activeLine: activeLine,
        recentCompletedLine: runtimeState.recentCompletedLine,
        nextLines: runtimeState.nextLines, theme: theme
      })
    }

    function destroy() {
      if (layerEl) { layerEl.remove(); layerEl = null }
      lineContainer = null
      currentLineEl = null
      charItems = []
      segmentStates = []
      layout = null
      segmentTimings = null
      window.FoliaSubtitleOverlay.destroy()
      host = null
    }

    return {
      id: 'tilt',
      mount: mount,
      setTheme: setTheme,
      setLines: setLines,
      setFontScale: function (s) { fontScale = s === undefined ? 1 : s },
      tick: tick,
      destroy: destroy
    }
  }

  window.FoliaModeTilt = { create: createMode }
})()
