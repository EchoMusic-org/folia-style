// 浮名模式：移植自 folia-major src/components/visualizer/fume/VisualizerFume.tsx（主渲染器，3081 行）
//          与 folia-major src/components/visualizer/FumeBackground.ts（背景场景绘制，467 行）
//          默认调参 DEFAULT_FUME_TUNING 内联自 folia-major src/types.ts（第 443-462 行）
// 核心思路："把整首歌词排成一篇文章，然后移动相机阅读它"。
// 管线：pretext prepareWithSegments + layoutWithLines 预排版 → 分块（body/hero 变体）→
//       相机聚焦块解析 → 每帧 canvas 2D 绘制（背景 + 纸张 + 打字文本 + 已读文本残迹）。
// 所有数值/公式/缓动与原版逐项对齐。
(function () {
  'use strict'

  var ColorMix = window.FoliaColorMix
  var RenderHints = window.FoliaRenderHints
  var GraphemeTiming = window.FoliaGraphemeTiming
  var WordColoring = window.FoliaWordColoring
  var Runtime = window.FoliaVisualizerRuntime
  var Anim = window.FoliaAnim

  // 原版 DEFAULT_FUME_TUNING（types.ts）：插件不暴露调参 UI，直接使用默认值（保留 clamp 形态以便扩展）
  var DEFAULT_FUME_TUNING = {
    hidePrintSymbols: false,
    disableGeometricBackground: true,
    backgroundObjectOpacity: 0.5,
    textHoldRatio: 1,
    cameraTrackingMode: 'smooth',
    cameraSpeed: 1,
    glowIntensity: 1,
    heroScale: 1
  }

  // ===== 原版模块常量 =====
  var FUME_PRETEXT_OPTIONS = { whiteSpace: 'pre-wrap' }
  var CAMERA_SCALE_MIN = 0.22
  var CAMERA_SCALE_MAX = 2.24
  var OVERVIEW_CAMERA_SOURCE = -2
  var LAYOUT_REBUILD_DEBOUNCE_MS = 96
  var FUME_BACKGROUND_PARALLAX_X = 0.9
  var FUME_BACKGROUND_PARALLAX_Y = 0.74
  var FUME_BACKGROUND_SCALE_FACTOR = 0.94
  var FUME_BACKGROUND_VERTICAL_OFFSET_RATIO = 0.22
  var FUME_CAMERA_TELEPORT_TRIGGER_SCREENS = 2.75

  // ===== 通用数学/工具（与原版一一对应） =====
  function clamp(value, min, max) { return Math.max(min, Math.min(max, value)) }
  function mix(from, to, amount) { return from + (to - from) * amount }
  function quadraticBezier(from, control, to, amount) {
    var normalized = clamp(amount, 0, 1)
    var inverse = 1 - normalized
    return inverse * inverse * from + 2 * inverse * normalized * control + normalized * normalized * to
  }
  function easeOutCubic(value) { return 1 - Math.pow(1 - clamp(value, 0, 1), 3) }
  function easeInCubic(value) { return Math.pow(clamp(value, 0, 1), 3) }
  function easeInOutCubic(value) {
    var normalized = clamp(value, 0, 1)
    return normalized < 0.5
      ? 4 * normalized * normalized * normalized
      : 1 - Math.pow(-2 * normalized + 2, 3) / 2
  }
  // 延迟发光包络：先升至峰值（默认 0.8 处）再衰减
  function resolveDelayedGlowEnvelope(progress, peakProgress) {
    if (peakProgress === undefined) peakProgress = 0.8
    var normalized = clamp(progress, 0, 1)
    var clampedPeak = clamp(peakProgress, 0.05, 0.95)
    if (normalized <= clampedPeak) {
      return easeOutCubic(normalized / clampedPeak)
    }
    return 1 - easeInCubic((normalized - clampedPeak) / (1 - clampedPeak))
  }

  function hashString(input) {
    var hash = 2166136261
    for (var index = 0; index < input.length; index += 1) {
      hash ^= input.charCodeAt(index)
      hash = Math.imul(hash, 16777619)
    }
    return hash >>> 0
  }
  function seeded(seed) {
    var hash = hashString(seed)
    return (hash % 10000) / 10000
  }

  // 原版 isCJK（注意与 wordColoring 的范围略不同，保持原版）
  function isCJK(text) { return /[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/.test(text) }

  // 字形拆分：使用运行时的 Intl.Segmenter 实现（与原版 splitGraphemes 等价）
  function splitGraphemes(text) {
    if (!text) return []
    if (GraphemeTiming && typeof GraphemeTiming.splitLyricGraphemes === 'function') {
      return GraphemeTiming.splitLyricGraphemes(text)
    }
    return Array.from(text)
  }

  function getActiveColor(wordText, theme) {
    // 原版：resolveWordColor(wordText, theme.wordColors, theme.accentColor, { cjkMatchMode: 'bidirectional-contains' })
    return WordColoring.resolveWordColor(wordText, theme.wordColors, theme.accentColor, { cjkMatchMode: 'bidirectional-contains' })
  }

  // ===== 字体解析（对应原版 utils/fontStacks，按插件规范改用 foliaGetLyricFontFamily） =====
  function resolveThemeFontStack(theme) {
    if (window.foliaGetLyricFontFamily) {
      var family = window.foliaGetLyricFontFamily()
      if (family) return family
    }
    return (theme && theme.fontFamily) || 'sans-serif'
  }
  // 原版 normalizeFontWeight：clamp 100~900 后按 10 取整；非数字回退 fallback
  function resolveThemeFontWeight(theme, fallback) {
    if (theme && typeof theme.fontWeight === 'number' && Number.isFinite(theme.fontWeight)) {
      var clamped = Math.min(900, Math.max(100, theme.fontWeight))
      return Math.round(clamped / 10) * 10
    }
    return fallback
  }
  function buildFontSpec(fontPx, variant, fontFamily, theme) {
    var fontWeight = resolveThemeFontWeight(theme, variant === 'hero' ? 780 : 640)
    return fontWeight + ' ' + fontPx + 'px ' + fontFamily
  }

  // ===== 模块级缓存（与原版一致） =====
  var lastFumeLayoutCache = null                 // { key, article }
  var lastFumePassedFadeDurationCache = null     // { key, duration }
  var segmentMeasureCanvas = null
  var segmentMeasureCache = new Map()            // fontSpec__text → 字形前缀宽度数组

  // ===== 布局管线纯函数（与原版同名函数一一对应） =====

  // prepared.segments → 段元数据 + 全文字形流
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

    return { graphemes: graphemes, segmentMetas: segmentMetas }
  }

  // 词数组 → 字形流上的词区间（有些歌词载荷 word.text 缺词间空格，把紧跟的空白并入当前词区间）
  function buildWordRangesFromWords(line, graphemes) {
    if (!line.words || line.words.length === 0 || graphemes.length === 0) return []

    var rangedWords = line.words.filter(function (word) { return splitGraphemes(word.text).length > 0 })
    if (rangedWords.length === 0) return []

    var ranges = []
    var cursor = 0

    for (var wordIndex = 0; wordIndex < rangedWords.length; wordIndex += 1) {
      var word = rangedWords[wordIndex]
      var wordGraphemes = splitGraphemes(word.text)
      var start = clamp(cursor, 0, graphemes.length)
      var end = clamp(start + wordGraphemes.length, start, graphemes.length)

      while (end < graphemes.length && /\s/.test(graphemes[end] || '')) {
        end += 1
      }

      ranges.push({
        wordIndex: wordIndex,
        word: word,
        start: start,
        end: end,
        colorStart: start,
        colorEnd: end,
        graphemeTimings: GraphemeTiming.buildWordGraphemeTimings(word)
      })
      cursor = end
    }

    return ranges
  }

  function resolveWordRevealProgress(range, currentTimeValue) {
    if (range.word.endTime <= range.word.startTime) {
      return currentTimeValue >= range.word.endTime ? 1 : 0
    }
    var duration = Math.max(range.word.endTime - range.word.startTime, 0.08)
    return clamp((currentTimeValue - range.word.startTime) / duration, 0, 1)
  }

  // 词区间内已打印字形数（有音节时间按音节，否则按比例 + 0.2 前偏）
  function resolvePrintedGlyphsInRange(range, currentTimeValue) {
    var length = Math.max(range.end - range.start, 0)
    if (length === 0) return 0
    if (currentTimeValue < range.word.startTime) return 0

    var timedGlyphCount = range.word.syllables && range.word.syllables.length
      ? Math.min(range.graphemeTimings.length, length)
      : 0
    if (timedGlyphCount > 0) {
      if (currentTimeValue >= range.word.endTime) return length

      var printed = 0
      for (var index = 0; index < timedGlyphCount; index += 1) {
        if (currentTimeValue >= range.graphemeTimings[index].startTime) {
          printed = index + 1
        }
      }
      return clamp(printed, 0, length)
    }

    var progress = resolveWordRevealProgress(range, currentTimeValue)
    if (progress >= 1) return length
    return clamp(
      Math.floor(progress * length + 0.2),
      progress > 0 ? 1 : 0,
      length
    )
  }

  function hasRevealCompletedByLineEnd(line, currentTimeValue) {
    return currentTimeValue >= line.endTime
  }

  // 行通过截止时间 = min(渲染结束时间, 下一行开始)
  function resolveLinePassCutoffTime(line, nextLineStartTime) {
    var renderEndTime = RenderHints.getLineRenderEndTime(line)
    if (typeof nextLineStartTime !== 'number' || !Number.isFinite(nextLineStartTime)) {
      return renderEndTime
    }
    return Math.min(renderEndTime, nextLineStartTime)
  }

  function resolveVisualProgressWithCutoff(startedAt, duration, currentTimeValue, cutoffTime) {
    var nominalEndTime = startedAt + Math.max(duration, 0.001)
    var effectiveEndTime = Math.max(
      startedAt + 0.001,
      Math.min(nominalEndTime, cutoffTime)
    )
    return clamp(
      (currentTimeValue - startedAt) / Math.max(effectiveEndTime - startedAt, 0.001),
      0,
      1
    )
  }

  // pretext 折行游标 → 全文字形偏移
  function cursorToGlobalOffset(cursor, segmentMetas) {
    if (segmentMetas.length === 0) return 0
    var segment = segmentMetas[cursor.segmentIndex]
    if (!segment) {
      return segmentMetas[segmentMetas.length - 1].graphemeEnd
    }
    return clamp(segment.graphemeStart + cursor.graphemeIndex, segment.graphemeStart, segment.graphemeEnd)
  }

  function getPartialSegmentWidth(prepared, segmentIndex, segmentMeta, startOffset, endOffset) {
    var localStart = clamp(startOffset - segmentMeta.graphemeStart, 0, segmentMeta.graphemeCount)
    var localEnd = clamp(endOffset - segmentMeta.graphemeStart, 0, segmentMeta.graphemeCount)

    if (localEnd <= localStart) return 0
    if (localStart === 0 && localEnd === segmentMeta.graphemeCount) {
      return prepared.widths[segmentIndex] !== undefined ? prepared.widths[segmentIndex] : 0
    }

    var breakableFitAdvances = prepared.breakableFitAdvances[segmentIndex]
    if (breakableFitAdvances && breakableFitAdvances.length > 0) {
      var width = 0
      for (var index = localStart; index < localEnd; index += 1) {
        width += breakableFitAdvances[index] !== undefined ? breakableFitAdvances[index] : 0
      }
      return width
    }

    var fullWidth = prepared.widths[segmentIndex] !== undefined ? prepared.widths[segmentIndex] : 0
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

  // 从行首累计每个字形的 x 前缀宽度
  function buildGlyphOffsets(prepared, segmentMetas, startOffset, graphemeCount) {
    var offsets = new Array(graphemeCount)
    for (var index = 0; index < graphemeCount; index += 1) {
      offsets[index] = widthBetweenOffsets(prepared, segmentMetas, startOffset, startOffset + index)
    }
    return offsets
  }

  function resolveGlyphAdvance(renderLine, graphemeIndex) {
    var currentOffset = renderLine.glyphOffsets[graphemeIndex] !== undefined ? renderLine.glyphOffsets[graphemeIndex] : 0
    var nextOffset = graphemeIndex < renderLine.graphemes.length - 1
      ? (renderLine.glyphOffsets[graphemeIndex + 1] !== undefined ? renderLine.glyphOffsets[graphemeIndex + 1] : renderLine.width)
      : renderLine.width
    return Math.max(nextOffset - currentOffset, 0)
  }

  // 折行内的 segment 切片（含 canvas 逐字形测量前缀）
  function buildRenderSegments(prepared, segmentMetas, lineStart, lineEnd, fontSpec) {
    var segments = []

    for (var segmentIndex = 0; segmentIndex < segmentMetas.length; segmentIndex += 1) {
      var meta = segmentMetas[segmentIndex]
      if (lineEnd <= meta.graphemeStart) break
      if (lineStart >= meta.graphemeEnd) continue

      var start = Math.max(lineStart, meta.graphemeStart)
      var end = Math.min(lineEnd, meta.graphemeEnd)
      if (end <= start) continue

      var localStart = start - lineStart
      var localEnd = end - lineStart
      var segmentText = prepared.segments[segmentIndex] !== undefined ? prepared.segments[segmentIndex] : ''
      var segmentGraphemes = splitGraphemes(segmentText)
      var text = start === meta.graphemeStart && end === meta.graphemeEnd
        ? segmentText
        : segmentGraphemes.slice(start - meta.graphemeStart, end - meta.graphemeStart).join('')

      segments.push({
        text: text,
        start: start,
        end: end,
        localStart: localStart,
        localEnd: localEnd,
        x: widthBetweenOffsets(prepared, segmentMetas, lineStart, start),
        width: widthBetweenOffsets(prepared, segmentMetas, start, end),
        isFullSegment: start === meta.graphemeStart && end === meta.graphemeEnd,
        measuredGlyphOffsets: measureSegmentGlyphOffsets(text, fontSpec)
      })
    }

    return segments
  }

  // 逐段字形前缀宽度测量（canvas measureText，带缓存）
  function measureSegmentGlyphOffsets(text, fontSpec) {
    var cacheKey = fontSpec + '__' + text
    var cached = segmentMeasureCache.get(cacheKey)
    if (cached) return cached

    var graphemes = splitGraphemes(text)
    var offsets = new Array(graphemes.length + 1)
    offsets.fill(0)
    if (typeof document === 'undefined') return offsets

    if (!segmentMeasureCanvas) {
      segmentMeasureCanvas = document.createElement('canvas')
    }
    var context = segmentMeasureCanvas.getContext('2d')
    if (!context) return offsets

    context.font = fontSpec
    for (var index = 1; index <= graphemes.length; index += 1) {
      offsets[index] = context.measureText(graphemes.slice(0, index).join('')).width
    }

    segmentMeasureCache.set(cacheKey, offsets)
    return offsets
  }

  // 每个字形偏移 → 所属词区间下标（timing 用 start/end，color 用 colorStart/colorEnd）
  function buildWordRangeIndexByOffset(graphemeCount, wordRanges, rangeKind) {
    if (rangeKind === undefined) rangeKind = 'timing'
    var indices = new Array(graphemeCount)
    indices.fill(-1)
    for (var rangeIndex = 0; rangeIndex < wordRanges.length; rangeIndex += 1) {
      var range = wordRanges[rangeIndex]
      var start = rangeKind === 'color' ? range.colorStart : range.start
      var end = rangeKind === 'color' ? range.colorEnd : range.end
      for (var offset = start; offset < end && offset < graphemeCount; offset += 1) {
        indices[offset] = rangeIndex
      }
    }
    return indices
  }

  function countRenderableGraphemes(text) {
    return splitGraphemes(text).filter(function (value) { return value.trim().length > 0 }).length
  }

  // ===== body / hero 变体选择 =====
  function chooseNaturalBlockVariant(line, index, total) {
    var graphemeCount = countRenderableGraphemes(line.fullText)
    if (graphemeCount === 0) return 'body'
    if (line.isChorus && graphemeCount <= 22) return 'hero'

    var shortEnough = graphemeCount >= 4 && graphemeCount <= 28
    var centered = Math.abs(index - total / 2) / Math.max(total, 1)
    var random = seeded(line.fullText + ':' + index)
    return shortEnough && centered < 0.72 && ((index + 1) % 6 === 0 || random > 0.965)
      ? 'hero'
      : 'body'
  }

  // 整首没有自然 hero 时，按"居中 + 长度适中"打分挑一个兜底 hero
  function chooseFallbackHeroBlockIndex(entries) {
    if (entries.length === 0) return -1

    var hasNaturalHero = entries.some(function (entry, blockIndex) {
      return chooseNaturalBlockVariant(entry.line, blockIndex, entries.length) === 'hero'
    })
    if (hasNaturalHero) return -1

    var bestIndex = -1
    var bestScore = Number.NEGATIVE_INFINITY

    entries.forEach(function (entry, blockIndex) {
      var line = entry.line
      var graphemeCount = countRenderableGraphemes(line.fullText)
      if (graphemeCount === 0) return

      var isComfortableHeroLength = graphemeCount >= 4 && graphemeCount <= 28
      var isAcceptableFallbackLength = graphemeCount <= 36
      if (!isComfortableHeroLength && !isAcceptableFallbackLength) return

      var centered = Math.abs(blockIndex - entries.length / 2) / Math.max(entries.length, 1)
      var centerScore = 1 - centered
      var lengthScore = graphemeCount >= 6 && graphemeCount <= 22
        ? 1
        : graphemeCount <= 28
          ? 0.72
          : 0.36
      var chorusScore = line.isChorus ? 0.28 : 0
      var stableJitter = seeded(line.fullText + ':' + blockIndex + ':fallback-hero') * 0.04
      var score = centerScore * 0.62 + lengthScore * 0.34 + chorusScore + stableJitter

      if (score > bestScore) {
        bestScore = score
        bestIndex = blockIndex
      }
    })

    if (bestIndex >= 0) return bestIndex

    var shortestIndex = -1
    var shortestCount = Number.POSITIVE_INFINITY
    entries.forEach(function (entry, blockIndex) {
      var graphemeCount = countRenderableGraphemes(entry.line.fullText)
      if (graphemeCount > 0 && graphemeCount < shortestCount) {
        shortestCount = graphemeCount
        shortestIndex = blockIndex
      }
    })

    return shortestIndex
  }

  function chooseBlockVariant(line, index, total, forcedHeroIndex) {
    return index === forcedHeroIndex ? 'hero' : chooseNaturalBlockVariant(line, index, total)
  }

  // 二分搜索一个能保持单行的最大字号（fume 希望大多数块保持单行）
  function buildPreparedSingleLine(text, fontFamily, width, variant, lyricsFontScale, densityScale, heroScale, theme) {
    var low = variant === 'hero' ? 18 : 10
    var high = variant === 'hero' ? 58 : 30
    var best = null

    for (var iteration = 0; iteration < 8; iteration += 1) {
      var candidateFontPx = ((low + high) / 2)
        * lyricsFontScale
        * densityScale
        * (variant === 'hero' ? heroScale : 1)
      var fontSpec = buildFontSpec(candidateFontPx, variant, fontFamily, theme)
      var prepared = window.Pretext.prepareWithSegments(text, fontSpec, FUME_PRETEXT_OPTIONS)
      var layout = window.Pretext.layoutWithLines(prepared, width, Math.round(candidateFontPx * (variant === 'hero' ? 1.02 : 1.06)))

      if (layout.lineCount <= 1) {
        best = { fontPx: candidateFontPx, prepared: prepared, layout: layout }
        low = (low + high) / 2
      } else {
        high = (low + high) / 2
      }
    }

    if (best) return best

    var fallbackFontPx = (variant === 'hero' ? 18 : 10)
      * lyricsFontScale
      * densityScale
      * (variant === 'hero' ? heroScale : 1)
    var fallbackFontSpec = buildFontSpec(fallbackFontPx, variant, fontFamily, theme)
    var fallbackPrepared = window.Pretext.prepareWithSegments(text, fallbackFontSpec, FUME_PRETEXT_OPTIONS)
    return {
      fontPx: fallbackFontPx,
      prepared: fallbackPrepared,
      layout: window.Pretext.layoutWithLines(fallbackPrepared, width, Math.round(fallbackFontPx * (variant === 'hero' ? 1.02 : 1.06)))
    }
  }

  // 布局缓存键：只含几何相关输入，忽略播放态
  function computeLinesHash(lines) {
    var linesHash = 2166136261
    for (var i = 0; i < lines.length; i += 1) {
      var line = lines[i]
      var lineKey = line.startTime + ':' + line.endTime + ':' + line.fullText + ':' + line.words.length + ':' + (line.isChorus ? 1 : 0)
      linesHash ^= hashString(lineKey)
      linesHash = Math.imul(linesHash, 16777619)
    }
    return linesHash >>> 0
  }

  function buildLayoutCacheKey(lines, viewport, layoutTheme, resolvedFontFamily, lyricsFontScale, fumeTuning) {
    return [
      Math.round(viewport.width),
      Math.round(viewport.height),
      layoutTheme.fontStyle !== undefined ? layoutTheme.fontStyle : '',
      layoutTheme.fontFamily !== undefined && layoutTheme.fontFamily !== null ? layoutTheme.fontFamily : '',
      layoutTheme.fontFamilyStack ? layoutTheme.fontFamilyStack.join(',') : '',
      layoutTheme.fontWeight !== undefined && layoutTheme.fontWeight !== null ? layoutTheme.fontWeight : 'auto',
      layoutTheme.name !== undefined && layoutTheme.name !== null ? layoutTheme.name : '',
      resolvedFontFamily,
      lyricsFontScale.toFixed(4),
      fumeTuning.heroScale.toFixed(4),
      lines.length,
      computeLinesHash(lines)
    ].join('|')
  }

  // 行（全文）已打印字形数（整型，用于 stepped 相机与聚焦块解析）
  function resolvePrintedGraphemeCount(line, wordRanges, graphemeCount, currentTimeValue) {
    if (graphemeCount === 0) return 0
    if (currentTimeValue < line.startTime) return 0
    if (hasRevealCompletedByLineEnd(line, currentTimeValue)) return graphemeCount

    if (wordRanges.length === 0) {
      var duration = Math.max(line.endTime - line.startTime, 0.12)
      var progress = clamp((currentTimeValue - line.startTime) / duration, 0, 1)
      return clamp(Math.floor(progress * graphemeCount + (progress > 0 ? 1 : 0)), 0, graphemeCount)
    }

    var printed = 0
    for (var index = 0; index < wordRanges.length; index += 1) {
      var range = wordRanges[index]
      var partial = resolvePrintedGlyphsInRange(range, currentTimeValue)
      printed = range.start + partial
      if (partial < range.end - range.start) {
        return clamp(printed, 0, graphemeCount)
      }
    }

    return clamp(printed, 0, graphemeCount)
  }

  // 行（全文）已打印字形进度（小数，用于 smooth 相机）
  function resolvePrintedGraphemeProgress(line, wordRanges, graphemeCount, currentTimeValue) {
    if (graphemeCount === 0) return 0
    if (currentTimeValue < line.startTime) return 0
    if (hasRevealCompletedByLineEnd(line, currentTimeValue)) return graphemeCount

    if (wordRanges.length === 0) {
      var duration = Math.max(line.endTime - line.startTime, 0.12)
      var progress = clamp((currentTimeValue - line.startTime) / duration, 0, 1)
      return clamp(progress * graphemeCount, 0, graphemeCount)
    }

    var printed = 0
    for (var index = 0; index < wordRanges.length; index += 1) {
      var range = wordRanges[index]
      if (currentTimeValue < range.word.startTime) {
        return clamp(printed, 0, graphemeCount)
      }
      var wordProgress = resolveWordRevealProgress(range, currentTimeValue)
      var length = Math.max(range.end - range.start, 0)
      printed = range.start + wordProgress * length
      if (wordProgress < 1) {
        return clamp(printed, 0, graphemeCount)
      }
    }

    return clamp(printed, 0, graphemeCount)
  }

  // ===== 文章布局（measure 模式只算几何指标，render 模式再建渲染细节） =====
  function buildArticleLayoutAttempt(lines, viewport, layoutTheme, lyricsFontScale, fumeTuning, options) {
    if (viewport.width <= 0 || viewport.height <= 0 || lines.length === 0) return null

    var paperWidth = options.paperWidth
    var viewportHeight = options.viewportHeight
    var columns = options.columns
    var gap = options.gap
    var densityScale = options.densityScale
    var seedKey = options.seedKey
    var mode = options.mode || 'render'
    var shouldBuildRenderDetails = mode === 'render'

    var horizontalMargin = Math.max(viewport.width * 0.86, 280)
    var verticalMargin = Math.max(viewport.height * 0.82, 220)
    var columnWidth = (paperWidth - gap * (columns - 1)) / columns
    var fontFamily = resolveThemeFontStack(layoutTheme)

    // 空行不参与排版；放置顺序做确定性洗牌，让纸面有"编排感"而非严格时间顺序
    var filteredLines = []
    for (var li = 0; li < lines.length; li += 1) {
      if (lines[li].fullText.trim().length > 0) filteredLines.push({ line: lines[li], index: li })
    }
    filteredLines.sort(function (left, right) {
      var leftSeed = seeded(seedKey + ':' + left.index + ':' + left.line.fullText)
      var rightSeed = seeded(seedKey + ':' + right.index + ':' + right.line.fullText)
      return leftSeed - rightSeed
    })

    var blocks = []
    var columnHeights = []
    for (var ci = 0; ci < columns; ci += 1) columnHeights.push(verticalMargin)
    var bodyColumnTieCursor = 0
    var heroPlacementTieCursor = 0
    var forcedHeroIndex = chooseFallbackHeroBlockIndex(filteredLines)

    filteredLines.forEach(function (entry, blockIndex) {
      var line = entry.line
      var index = entry.index
      var variant = chooseBlockVariant(line, blockIndex, filteredLines.length, forcedHeroIndex)
      // hero 块可占据更多视觉领地；body 块保持窄列，文章才像分栏
      var heroSpanColumns = variant === 'hero'
        ? Math.min(columns, columns <= 1 ? 1 : 2)
        : 1
      var heroSpanWidth = heroSpanColumns > 1
        ? columnWidth * heroSpanColumns + gap * (heroSpanColumns - 1)
        : paperWidth
      var blockWidth = variant === 'hero'
        ? (heroSpanColumns === 1
          ? paperWidth
          : columns === 2
            ? columnWidth * 1.5 + gap * 0.5
            : heroSpanWidth)
        : columnWidth
      var paddingX = 0
      var paddingY = 0
      var innerWidth = Math.max(blockWidth - paddingX * 2, 120)

      var preparedSingleLine = buildPreparedSingleLine(
        line.fullText,
        fontFamily,
        innerWidth,
        variant,
        lyricsFontScale,
        densityScale,
        fumeTuning.heroScale,
        layoutTheme
      )
      var fontPx = preparedSingleLine.fontPx
      var lineHeight = Math.round(fontPx * (variant === 'hero' ? 1.02 : 1.06))
      var layout = preparedSingleLine.layout
      var blockGap = variant === 'hero'
        ? Math.max(Math.round(lineHeight * 0.2), 6)
        : Math.max(Math.round(lineHeight * 0.08), 2)
      var blockHeight = paddingY * 2 + layout.lines.length * lineHeight
      var x = 0
      var y = 0

      if (variant === 'hero') {
        // hero 放置：跨列找最"安静"的大槽位
        if (heroSpanColumns === 1) {
          y = Math.max.apply(null, columnHeights)
          x = horizontalMargin
          columnHeights[0] = y + blockHeight + blockGap
        } else {
          var bestHeight = Number.POSITIVE_INFINITY
          var candidateStarts = []

          for (var startColumn = 0; startColumn <= columns - heroSpanColumns; startColumn += 1) {
            var coveredHeight = 0
            for (var columnIndex = startColumn; columnIndex < startColumn + heroSpanColumns; columnIndex += 1) {
              coveredHeight = Math.max(coveredHeight, columnHeights[columnIndex] !== undefined ? columnHeights[columnIndex] : 0)
            }
            if (coveredHeight < bestHeight) {
              bestHeight = coveredHeight
              candidateStarts = [startColumn]
            } else if (coveredHeight === bestHeight) {
              candidateStarts.push(startColumn)
            }
          }

          var targetStart = candidateStarts.length > 0
            ? candidateStarts[heroPlacementTieCursor % candidateStarts.length]
            : 0
          heroPlacementTieCursor += 1
          y = bestHeight
          x = horizontalMargin
            + targetStart * (columnWidth + gap)
            + Math.max((heroSpanWidth - blockWidth) * 0.5, 0)

          for (var fillColumn = targetStart; fillColumn < targetStart + heroSpanColumns; fillColumn += 1) {
            columnHeights[fillColumn] = y + blockHeight + blockGap
          }
        }
      } else {
        // body 放置：落入当前最矮列（平局用轮替游标）
        var targetColumn = 0
        var minHeight = columnHeights[0] !== undefined ? columnHeights[0] : 0
        var candidateColumns = [0]

        for (var colIndex = 1; colIndex < columns; colIndex += 1) {
          var height = columnHeights[colIndex] !== undefined ? columnHeights[colIndex] : 0
          if (height < minHeight) {
            minHeight = height
            candidateColumns.length = 0
            candidateColumns.push(colIndex)
          } else if (height === minHeight) {
            candidateColumns.push(colIndex)
          }
        }

        targetColumn = candidateColumns[bodyColumnTieCursor % candidateColumns.length] !== undefined
          ? candidateColumns[bodyColumnTieCursor % candidateColumns.length]
          : 0
        bodyColumnTieCursor += 1
        x = horizontalMargin + targetColumn * (columnWidth + gap)
        y = columnHeights[targetColumn]
        columnHeights[targetColumn] = y + blockHeight + blockGap
      }

      if (shouldBuildRenderDetails) {
        // measure 模式到此为止；render 模式继续构建字形打印与逐行聚焦所需的全部结构
        var prepared = preparedSingleLine.prepared
        var fontSpec = buildFontSpec(fontPx, variant, fontFamily, layoutTheme)
        var metas = buildSegmentMetas(prepared)
        var graphemes = metas.graphemes
        var segmentMetas = metas.segmentMetas
        var wordRanges = buildWordRangesFromWords(line, graphemes)
        var wordRangeIndexByOffset = buildWordRangeIndexByOffset(graphemes.length, wordRanges)
        var colorRangeIndexByOffset = buildWordRangeIndexByOffset(graphemes.length, wordRanges, 'color')
        var renderLines = layout.lines.map(function (layoutLine, lineIndex) {
          var start = cursorToGlobalOffset(layoutLine.start, segmentMetas)
          var end = cursorToGlobalOffset(layoutLine.end, segmentMetas)
          var lineGraphemes = splitGraphemes(layoutLine.text)

          return {
            id: line.startTime + '-' + lineIndex,
            text: layoutLine.text,
            start: start,
            end: end,
            graphemes: lineGraphemes,
            glyphOffsets: buildGlyphOffsets(prepared, segmentMetas, start, lineGraphemes.length),
            segments: buildRenderSegments(prepared, segmentMetas, start, end, fontSpec),
            left: variant === 'hero'
              ? Math.max((blockWidth - layoutLine.width) * 0.08, 0)
              : 0,
            top: paddingY + lineIndex * lineHeight,
            width: layoutLine.width
          }
        })

        blocks.push({
          id: 'fume-' + line.startTime + '-' + index,
          sourceLineIndex: index,
          line: line,
          variant: variant,
          x: x,
          y: y,
          width: blockWidth,
          height: blockHeight,
          innerWidth: innerWidth,
          fontPx: fontPx,
          lineHeight: lineHeight,
          prepared: prepared,
          layout: layout,
          graphemes: graphemes,
          segmentMetas: segmentMetas,
          wordRanges: wordRanges,
          wordRangeIndexByOffset: wordRangeIndexByOffset,
          colorRangeIndexByOffset: colorRangeIndexByOffset,
          renderLines: renderLines
        })
      }
    })

    var maxColumnHeight = 0
    for (var ch = 0; ch < columnHeights.length; ch += 1) {
      maxColumnHeight = Math.max(maxColumnHeight, columnHeights[ch])
    }
    var articleHeight = maxColumnHeight + verticalMargin

    var metrics = {
      width: paperWidth + horizontalMargin * 2,
      height: articleHeight,
      viewportHeight: viewportHeight,
      columns: columns,
      gap: gap,
      paperBounds: {
        left: horizontalMargin,
        top: verticalMargin,
        right: horizontalMargin + paperWidth,
        bottom: Math.max(articleHeight - verticalMargin, verticalMargin)
      }
    }

    if (!shouldBuildRenderDetails) return metrics

    var chronologicalBlocks = blocks.slice().sort(function (left, right) { return left.sourceLineIndex - right.sourceLineIndex })
    var blockBySourceLineIndex = new Map()
    chronologicalBlocks.forEach(function (block) {
      blockBySourceLineIndex.set(block.sourceLineIndex, block)
    })
    var firstRenderableStartTime = chronologicalBlocks.length > 0 ? chronologicalBlocks[0].line.startTime : Number.POSITIVE_INFINITY
    var lastChronologicalRenderEndTime = chronologicalBlocks.length > 0
      ? RenderHints.getLineRenderEndTime(chronologicalBlocks[chronologicalBlocks.length - 1].line)
      : Number.NEGATIVE_INFINITY

    metrics.blocks = blocks
    metrics.blockBySourceLineIndex = blockBySourceLineIndex
    metrics.chronologicalBlocks = chronologicalBlocks
    metrics.firstRenderableStartTime = firstRenderableStartTime
    metrics.lastChronologicalRenderEndTime = lastChronologicalRenderEndTime
    return metrics
  }

  // 尝试几组列数与密度缩放，保留最接近目标高度的文章布局
  function buildArticleLayout(lines, viewport, layoutTheme, lyricsFontScale, fumeTuning) {
    if (viewport.width <= 0 || viewport.height <= 0 || lines.length === 0) return null

    var paperWidth = clamp(Math.max(viewport.width * 1.95, viewport.width + 520), 920, 2400)
    var viewportHeight = Math.max(viewport.height, 240)
    var maxColumns = paperWidth >= 1120 ? 4 : paperWidth >= 760 ? 3 : paperWidth >= 500 ? 2 : 1
    var targetHeight = viewportHeight * 2.45
    var layoutSeedKey = layoutTheme.name !== undefined && layoutTheme.name !== null ? layoutTheme.name : 'fume'

    var bestOptions = null
    var bestScore = Number.POSITIVE_INFINITY
    var bestHeight = 0

    for (var columns = maxColumns; columns >= 1; columns -= 1) {
      var low = 0.82
      var high = 1.42
      var gap = clamp(Math.round(paperWidth * (columns >= 4 ? 0.0065 : columns === 3 ? 0.0085 : 0.0115)), 6, 14)

      for (var iteration = 0; iteration < 8; iteration += 1) {
        var densityScale = (low + high) / 2
        var layout = buildArticleLayoutAttempt(lines, viewport, layoutTheme, lyricsFontScale, fumeTuning, {
          paperWidth: paperWidth,
          viewportHeight: viewportHeight,
          columns: columns,
          gap: gap,
          densityScale: densityScale,
          seedKey: layoutSeedKey + ':' + columns + ':' + paperWidth,
          mode: 'measure'
        })

        if (!layout) continue

        var coveragePenalty = Math.abs(layout.height - targetHeight)
        var overflowPenalty = layout.height < targetHeight ? 0 : (layout.height - targetHeight) * 0.14
        var score = coveragePenalty + overflowPenalty

        if (score < bestScore) {
          bestScore = score
          bestHeight = layout.height
          bestOptions = {
            paperWidth: paperWidth,
            viewportHeight: viewportHeight,
            columns: columns,
            gap: gap,
            densityScale: densityScale,
            seedKey: layoutSeedKey + ':' + columns + ':' + paperWidth,
            mode: 'render'
          }
        }

        if (layout.height < targetHeight) {
          low = densityScale
        } else {
          high = densityScale
        }
      }
    }

    var article = bestOptions
      ? buildArticleLayoutAttempt(lines, viewport, layoutTheme, lyricsFontScale, fumeTuning, bestOptions)
      : null

    return article
  }

  // ===== 相机聚焦点解析 =====
  function resolveSteppedBlockFocusPoint(block, printedCount) {
    if (block.renderLines.length === 0) {
      return { x: block.x + block.width * 0.5, y: block.y + block.height * 0.5 }
    }

    var effectiveOffset = clamp(printedCount, 0, block.graphemes.length)
    var targetLine = null
    for (var i = 0; i < block.renderLines.length; i += 1) {
      if (effectiveOffset <= block.renderLines[i].end) { targetLine = block.renderLines[i]; break }
    }
    if (!targetLine) targetLine = block.renderLines[block.renderLines.length - 1]
    var localOffset = clamp(effectiveOffset, targetLine.start, targetLine.end)
    var progressWidth = widthBetweenOffsets(block.prepared, block.segmentMetas, targetLine.start, localOffset)
    var minX = block.x + targetLine.left
    var maxX = minX + targetLine.width

    return {
      x: clamp(minX + progressWidth, minX, maxX),
      y: block.y + targetLine.top + block.lineHeight * 0.5
    }
  }

  function resolveSmoothBlockFocusPoint(block, printedProgress) {
    if (block.renderLines.length === 0) {
      return { x: block.x + block.width * 0.5, y: block.y + block.height * 0.5 }
    }

    var effectiveOffset = clamp(printedProgress, 0, block.graphemes.length)
    var findRenderLineIndex = function (offset) {
      var exactIndex = -1
      for (var i = 0; i < block.renderLines.length; i += 1) {
        if (offset <= block.renderLines[i].end) { exactIndex = i; break }
      }
      return exactIndex >= 0 ? exactIndex : block.renderLines.length - 1
    }

    var resolvePointOnRenderLine = function (lineIndex, offset) {
      var targetLine = block.renderLines[lineIndex] || block.renderLines[block.renderLines.length - 1]
      var clampedOffset = clamp(offset, targetLine.start, targetLine.end)
      var baseOffset = Math.floor(clampedOffset)
      var fractionalOffset = clampedOffset - baseOffset
      var baseWidth = widthBetweenOffsets(block.prepared, block.segmentMetas, targetLine.start, baseOffset)
      var localGlyphIndex = baseOffset - targetLine.start
      var glyphAdvance = localGlyphIndex >= 0 && localGlyphIndex < targetLine.graphemes.length
        ? resolveGlyphAdvance(targetLine, localGlyphIndex)
        : 0
      var minX = block.x + targetLine.left
      var maxX = minX + targetLine.width

      return {
        x: clamp(minX + baseWidth + glyphAdvance * fractionalOffset, minX, maxX),
        y: block.y + targetLine.top + block.lineHeight * 0.5
      }
    }

    var targetLineIndex = findRenderLineIndex(effectiveOffset)
    var point = resolvePointOnRenderLine(targetLineIndex, effectiveOffset)
    var currentLine = block.renderLines[targetLineIndex]
    var crossLineBlendWindow = 0.7

    if (targetLineIndex > 0 && effectiveOffset < currentLine.start + crossLineBlendWindow) {
      var previousLine = block.renderLines[targetLineIndex - 1]
      var blend = easeInOutCubic(clamp(
        1 - ((effectiveOffset - previousLine.end) / crossLineBlendWindow),
        0,
        1
      ))
      var previousPoint = resolvePointOnRenderLine(targetLineIndex - 1, previousLine.end)
      point = { x: mix(point.x, previousPoint.x, blend), y: mix(point.y, previousPoint.y, blend) }
    } else if (targetLineIndex < block.renderLines.length - 1 && effectiveOffset > currentLine.end - crossLineBlendWindow) {
      var nextLine = block.renderLines[targetLineIndex + 1]
      var blendNext = easeInOutCubic(clamp(
        (effectiveOffset - (currentLine.end - crossLineBlendWindow)) / crossLineBlendWindow,
        0,
        1
      ))
      var nextPoint = resolvePointOnRenderLine(targetLineIndex + 1, nextLine.start)
      point = { x: mix(point.x, nextPoint.x, blendNext), y: mix(point.y, nextPoint.y, blendNext) }
    }

    return point
  }

  // 行入场聚焦点：第一渲染行的行首
  function resolveBlockEntryFocusPoint(block) {
    var firstRenderLine = block.renderLines[0]
    if (!firstRenderLine) {
      return { x: block.x + block.width * 0.5, y: block.y + block.height * 0.5 }
    }

    return {
      x: block.x + firstRenderLine.left,
      y: block.y + firstRenderLine.top + block.lineHeight * 0.5
    }
  }

  // ===== 绘制辅助 =====
  function buildCanvasFont(block, theme) {
    var fontFamily = resolveThemeFontStack(theme)
    return buildFontSpec(block.fontPx, block.variant, fontFamily, theme)
  }

  function buildTextStyleKey(fillStyle, shadowBlur, shadowColor) {
    return fillStyle + '|' + shadowColor + '|' + shadowBlur.toFixed(3)
  }

  function resolveRenderLineOffset(renderLine, localOffset) {
    if (localOffset <= 0) return 0
    if (localOffset >= renderLine.graphemes.length) return renderLine.width
    return renderLine.glyphOffsets[localOffset] !== undefined ? renderLine.glyphOffsets[localOffset] : renderLine.width
  }

  function resolveSegmentGlyphOffset(segment, globalOffset) {
    var localOffset = clamp(globalOffset - segment.start, 0, segment.measuredGlyphOffsets.length - 1)
    return segment.measuredGlyphOffsets[localOffset] !== undefined ? segment.measuredGlyphOffsets[localOffset] : 0
  }

  function resolveSegmentGlyphAdvance(segment, globalOffset) {
    var localOffset = clamp(globalOffset - segment.start, 0, segment.measuredGlyphOffsets.length - 2)
    var current = segment.measuredGlyphOffsets[localOffset] !== undefined ? segment.measuredGlyphOffsets[localOffset] : 0
    var next = segment.measuredGlyphOffsets[localOffset + 1] !== undefined ? segment.measuredGlyphOffsets[localOffset + 1] : current
    return Math.max(next - current, 0)
  }

  // 按 clip 矩形绘制文本片（避免相邻字形阴影互相污染）
  function drawRenderTextRun(context, renderLine, segment, runStart, runEnd, baseX, baseY) {
    if (!segment.text || runEnd <= runStart) return

    var segmentRunStart = Math.max(runStart - segment.localStart, 0)
    var segmentRunEnd = Math.min(runEnd - segment.localStart, segment.measuredGlyphOffsets.length - 1)
    var clipLeft = segment.measuredGlyphOffsets[segmentRunStart] !== undefined
      ? segment.measuredGlyphOffsets[segmentRunStart]
      : (resolveRenderLineOffset(renderLine, runStart) - segment.x)
    var clipRight = segment.measuredGlyphOffsets[segmentRunEnd] !== undefined
      ? segment.measuredGlyphOffsets[segmentRunEnd]
      : (resolveRenderLineOffset(renderLine, runEnd) - segment.x)
    var clipWidth = Math.max(clipRight - clipLeft, 0)
    if (clipWidth <= 0) return

    context.save()
    context.beginPath()
    context.rect(
      baseX + segment.x + clipLeft,
      baseY - Math.max(clipWidth, 1) - 64,
      clipWidth,
      Math.max(128 + clipWidth * 2, 256)
    )
    context.clip()
    context.fillText(segment.text, baseX + segment.x, baseY)
    context.restore()
  }

  // 静态块（waiting/passed）整块栅格化快照，避免逐帧逐字形重绘
  function createStaticBlockSnapshot(block, theme, fillStyle, shadowBlur, shadowColor) {
    if (typeof document === 'undefined') return null
    if (shadowBlur === undefined) shadowBlur = 0
    if (shadowColor === undefined) shadowColor = 'transparent'

    var rasterScale = clamp(window.devicePixelRatio || 1, 1, 2)
    var padding = Math.ceil(Math.max(block.fontPx * 0.32, shadowBlur + block.fontPx * 0.08, 4))
    var canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.ceil((block.width + padding * 2) * rasterScale))
    canvas.height = Math.max(1, Math.ceil((block.height + padding * 2) * rasterScale))

    var context = canvas.getContext('2d')
    if (!context) return null

    var baselineOffset = block.lineHeight * (isCJK(block.line.fullText) ? 0.52 : 0.5)
    context.setTransform(rasterScale, 0, 0, rasterScale, 0, 0)
    context.font = buildCanvasFont(block, theme)
    context.textAlign = 'left'
    context.textBaseline = 'middle'
    context.fillStyle = fillStyle
    context.shadowBlur = shadowBlur
    context.shadowColor = shadowColor

    for (var i = 0; i < block.renderLines.length; i += 1) {
      var renderLine = block.renderLines[i]
      context.fillText(
        renderLine.text,
        renderLine.left + padding,
        renderLine.top + baselineOffset + padding
      )
    }

    context.shadowBlur = 0
    context.shadowColor = 'transparent'
    return { canvas: canvas, padding: padding }
  }

  // ===== 相机相关 =====
  function resolveCameraScaleForBlock(block, viewport) {
    var minViewportSide = Math.max(Math.min(viewport.width, viewport.height), 1)
    var targetLineHeight = clamp(minViewportSide * 0.115, 64, 124)
    return clamp(targetLineHeight / Math.max(block.lineHeight, 1), 0.88, 2.2)
  }

  function resolveCameraRetargetDuration(line) {
    var hints = RenderHints.getLineRenderHints(line)
    if (!hints) return 0.09

    var transitionTiming = RenderHints.getLineTransitionTiming(hints.rawDuration, hints.lineTransitionMode, hints.wordRevealMode)

    if (hints.lineTransitionMode === 'none') {
      return clamp(Math.max(hints.rawDuration, 0.08) * 0.34, 0.04, 0.075)
    }
    if (hints.lineTransitionMode === 'fast') {
      return clamp(
        transitionTiming.enterDuration * 0.5 + transitionTiming.exitDuration * 0.12,
        0.055,
        0.095
      )
    }
    return clamp(
      transitionTiming.enterDuration * 0.44 + transitionTiming.linePassHold * 0.22,
      0.075,
      0.13
    )
  }

  function resolveOverviewRetargetDuration(viewport) {
    return clamp(Math.min(viewport.width, viewport.height) / 1500, 0.38, 0.58)
  }

  // 跨屏跳转时的"Overview 飞行桥"：抛物线经由总览相机附近的路标点
  function resolveOverviewFlightBridge(params) {
    var fromX = params.fromX
    var fromY = params.fromY
    var fromScale = params.fromScale
    var targetX = params.targetX
    var targetY = params.targetY
    var targetScale = params.targetScale
    var overviewCamera = params.overviewCamera
    var viewport = params.viewport

    if (!overviewCamera) return null

    var safeScale = Math.max(fromScale, targetScale, overviewCamera.scale, 0.001)
    var minViewportSide = Math.max(Math.min(viewport.width, viewport.height), 1)
    var deltaX = fromX - targetX
    var deltaY = fromY - targetY
    var worldDistance = Math.hypot(deltaX, deltaY)
    var screenDistance = worldDistance * safeScale

    if (worldDistance <= 0 || screenDistance < minViewportSide * FUME_CAMERA_TELEPORT_TRIGGER_SCREENS) {
      return null
    }

    var loftStrength = clamp(
      (screenDistance / minViewportSide - FUME_CAMERA_TELEPORT_TRIGGER_SCREENS) / 3.4,
      0,
      1
    )
    var midpointX = mix(fromX, targetX, 0.5)
    var midpointY = mix(fromY, targetY, 0.5)
    var waypointCenterBias = mix(0.18, 0.42, loftStrength)
    var waypointX = mix(midpointX, overviewCamera.x, waypointCenterBias)
    var waypointY = mix(midpointY, overviewCamera.y, waypointCenterBias)
    var endpointScale = Math.max(fromScale, targetScale, 0.001)
    var loftedScale = endpointScale * mix(0.62, 0.4, loftStrength)
    var overviewLimitedScale = overviewCamera.scale * mix(1.85, 1.55, loftStrength)
    var waypointScale = clamp(
      Math.max(loftedScale, overviewLimitedScale),
      CAMERA_SCALE_MIN,
      Math.max(endpointScale * 0.92, CAMERA_SCALE_MIN)
    )
    var overviewDistanceFromStart = Math.hypot(waypointX - fromX, waypointY - fromY)
      * Math.max(fromScale, waypointScale, 0.001)
    var overviewDistanceToTarget = Math.hypot(targetX - waypointX, targetY - waypointY)
      * Math.max(targetScale, waypointScale, 0.001)
    var totalLegDistance = overviewDistanceFromStart + overviewDistanceToTarget
    var waypointPhase = totalLegDistance <= 0
      ? 0.36
      : clamp(overviewDistanceFromStart / totalLegDistance, 0.26, 0.44)
    var duration = clamp(
      0.26 + (screenDistance / (minViewportSide * 5.5)) * 0.28,
      0.3,
      0.68
    )

    return {
      waypointX: waypointX,
      waypointY: waypointY,
      waypointScale: waypointScale,
      waypointPhase: waypointPhase,
      duration: duration
    }
  }

  // 总览相机：框住全部块（无块时按文章整体适配）
  function resolveArticleOverviewCamera(article, viewport) {
    if (article.blocks.length === 0) {
      var fitScaleEmpty = Math.min(
        viewport.width / Math.max(article.width, 1),
        viewport.height / Math.max(article.height, 1)
      )
      return {
        x: article.width * 0.5,
        y: article.height * 0.5,
        scale: clamp(fitScaleEmpty * 0.92, CAMERA_SCALE_MIN, 0.72)
      }
    }

    var minX = Number.POSITIVE_INFINITY
    var minY = Number.POSITIVE_INFINITY
    var maxX = Number.NEGATIVE_INFINITY
    var maxY = Number.NEGATIVE_INFINITY

    for (var i = 0; i < article.blocks.length; i += 1) {
      var block = article.blocks[i]
      minX = Math.min(minX, block.x)
      minY = Math.min(minY, block.y)
      maxX = Math.max(maxX, block.x + block.width)
      maxY = Math.max(maxY, block.y + block.height)
    }

    var paddingX = clamp(viewport.width * 0.2, 120, 280)
    var paddingY = clamp(viewport.height * 0.2, 96, 220)
    var framedWidth = Math.max(maxX - minX + paddingX * 2, 1)
    var framedHeight = Math.max(maxY - minY + paddingY * 2, 1)
    var fitScale = Math.min(
      viewport.width / framedWidth,
      viewport.height / framedHeight
    )

    return {
      x: (minX + maxX) * 0.5,
      y: (minY + maxY) * 0.5,
      scale: clamp(fitScale, CAMERA_SCALE_MIN, 0.72)
    }
  }

  // 当前应聚焦的块：活动行 → 曲末最后一块 → 最后一个已开始打印的块 → 第一块
  function resolveFocusBlock(article, currentLineIndex, currentTimeValue) {
    if (currentLineIndex >= 0) {
      var active = article.blockBySourceLineIndex.get(currentLineIndex)
      if (active) return active
    }

    var chronologicalLastBlock = article.chronologicalBlocks.length > 0
      ? article.chronologicalBlocks[article.chronologicalBlocks.length - 1]
      : null
    if (chronologicalLastBlock && currentTimeValue >= article.lastChronologicalRenderEndTime) {
      return chronologicalLastBlock
    }

    for (var index = article.chronologicalBlocks.length - 1; index >= 0; index -= 1) {
      var block = article.chronologicalBlocks[index]
      var printedCount = resolvePrintedGraphemeCount(
        block.line,
        block.wordRanges,
        block.graphemes.length,
        currentTimeValue
      )
      if (printedCount > 0) return block
    }

    return article.chronologicalBlocks.length > 0 ? article.chronologicalBlocks[0] : null
  }

  // ===== 已读文本淡出（textHoldRatio < 1 时） =====
  function resolveFumePassedFadeDuration(lines, textHoldRatio) {
    if (textHoldRatio >= 1) return Number.POSITIVE_INFINITY

    var timedLines = []
    for (var i = 0; i < lines.length; i += 1) {
      var startTime = lines[i].startTime
      var endTime = RenderHints.getLineRenderEndTime(lines[i])
      if (Number.isFinite(startTime) && Number.isFinite(endTime) && endTime >= startTime) {
        timedLines.push({ startTime: startTime, endTime: endTime })
      }
    }
    timedLines.sort(function (left, right) { return left.startTime - right.startTime })

    var keyParts = []
    for (var j = 0; j < timedLines.length; j += 1) {
      keyParts.push(timedLines[j].startTime.toFixed(3) + ':' + timedLines[j].endTime.toFixed(3))
    }
    var cacheKey = keyParts.join('|') + ':' + textHoldRatio.toFixed(3)

    if (lastFumePassedFadeDurationCache && lastFumePassedFadeDurationCache.key === cacheKey) {
      return lastFumePassedFadeDurationCache.duration
    }

    var duration
    if (timedLines.length <= 1) {
      duration = clamp(8 * textHoldRatio, 2.4, 130)
    } else {
      var first = timedLines[0]
      var last = timedLines[timedLines.length - 1]
      var totalDuration = Math.max(last.endTime - first.startTime, 0)
      duration = clamp(totalDuration * textHoldRatio, 2.4, 130)
    }
    lastFumePassedFadeDurationCache = { key: cacheKey, duration: duration }
    return duration
  }

  // 已读样式：standard（默认 textHoldRatio=1）/ dimmed（hold < 1）
  function resolvePassedTextStyle(variant, textHoldStyle) {
    return textHoldStyle === 'dimmed'
      ? {
        opacity: variant === 'hero' ? 0.11 : 0.075,
        glowMultiplier: 0,
        shadowAlphaBase: 0,
        shadowAlphaTrail: 0
      }
      : {
        opacity: variant === 'hero' ? 0.74 : 0.58,
        glowMultiplier: 1,
        shadowAlphaBase: 0.1,
        shadowAlphaTrail: 0.16
      }
  }

  function resolvePassedDimAmount(currentTimeValue, passedAt, fadeDuration) {
    if (!Number.isFinite(currentTimeValue) || !Number.isFinite(passedAt) || !Number.isFinite(fadeDuration) || fadeDuration <= 0) {
      return 1
    }
    var passedAge = Math.max(currentTimeValue - passedAt, 0)
    return easeInCubic(clamp(passedAge / fadeDuration, 0, 1))
  }

  // ============================================================
  // 背景：移植自 folia-major src/components/visualizer/FumeBackground.ts
  // ============================================================

  function buildShapePath(context, shape) {
    context.beginPath()

    if (shape.kind === 'ring') {
      var gapStart = shape.ringGapStart !== undefined && shape.ringGapStart !== null ? shape.ringGapStart : -Math.PI * 0.18
      var gapSize = clamp(shape.ringGapSize !== undefined && shape.ringGapSize !== null ? shape.ringGapSize : Math.PI * 0.2, 0.18, Math.PI * 0.6)
      context.lineCap = 'round'
      context.ellipse(
        0,
        0,
        shape.width * 0.5,
        shape.width * 0.5,
        0,
        gapStart + gapSize,
        gapStart + Math.PI * 2
      )
    } else {
      var size = shape.width
      if (shape.kind === 'square') {
        context.rect(-size * 0.5, -size * 0.5, size, size)
      } else if (shape.kind === 'cross') {
        var arm = size * 0.3
        context.moveTo(-arm, -size * 0.5)
        context.lineTo(arm, -size * 0.5)
        context.lineTo(arm, -arm)
        context.lineTo(size * 0.5, -arm)
        context.lineTo(size * 0.5, arm)
        context.lineTo(arm, arm)
        context.lineTo(arm, size * 0.5)
        context.lineTo(-arm, size * 0.5)
        context.lineTo(-arm, arm)
        context.lineTo(-size * 0.5, arm)
        context.lineTo(-size * 0.5, -arm)
        context.lineTo(-arm, -arm)
        context.closePath()
      } else {
        var outer = size * 0.5
        var inner = size * 0.13
        context.moveTo(0, -outer)
        context.lineTo(inner, -inner)
        context.lineTo(outer, 0)
        context.lineTo(inner, inner)
        context.lineTo(0, outer)
        context.lineTo(-inner, inner)
        context.lineTo(-outer, 0)
        context.lineTo(-inner, -inner)
        context.closePath()
      }
    }
  }

  function traceShape(context, shape) {
    context.save()
    context.translate(shape.x, shape.y)
    context.rotate(shape.rotation)
    buildShapePath(context, shape)
    context.stroke()
    context.restore()
  }

  function normalizeBounds(bounds, worldWidth, worldHeight) {
    return {
      left: clamp(Math.min(bounds.left, bounds.right), 0, worldWidth),
      top: clamp(Math.min(bounds.top, bounds.bottom), 0, worldHeight),
      right: clamp(Math.max(bounds.left, bounds.right), 0, worldWidth),
      bottom: clamp(Math.max(bounds.top, bounds.bottom), 0, worldHeight)
    }
  }

  // 光晕形状锚点：22% 概率落纸内，否则绕纸张四边外溢
  function choosePaperHaloAnchor(params) {
    var paperBounds = params.paperBounds
    var worldWidth = params.worldWidth
    var worldHeight = params.worldHeight
    var width = params.width
    var height = params.height
    var seedKey = params.seedKey

    var insideChance = seeded(seedKey + ':inside-chance')
    if (insideChance < 0.22) {
      return {
        x: clamp(
          mix(
            paperBounds.left + width * 0.12,
            paperBounds.right - width * 0.12,
            seeded(seedKey + ':inside-x')
          ),
          0,
          worldWidth
        ),
        y: clamp(
          mix(
            paperBounds.top + height * 0.12,
            paperBounds.bottom - height * 0.12,
            seeded(seedKey + ':inside-y')
          ),
          0,
          worldHeight
        )
      }
    }

    var side = Math.floor(seeded(seedKey + ':side') * 4) % 4
    var overflowX = width * mix(0.16, 0.24, seeded(seedKey + ':overflow-x'))
    var overflowY = height * mix(0.16, 0.24, seeded(seedKey + ':overflow-y'))
    var spanJitterX = width * mix(-0.18, 0.18, seeded(seedKey + ':span-jitter-x'))
    var spanJitterY = height * mix(-0.18, 0.18, seeded(seedKey + ':span-jitter-y'))

    if (side === 0) {
      return {
        x: clamp(paperBounds.left - overflowX, 0, worldWidth),
        y: clamp(
          mix(paperBounds.top - height * 0.12, paperBounds.bottom + height * 0.12, seeded(seedKey + ':y')) + spanJitterY,
          0,
          worldHeight
        )
      }
    }

    if (side === 1) {
      return {
        x: clamp(paperBounds.right + overflowX, 0, worldWidth),
        y: clamp(
          mix(paperBounds.top - height * 0.12, paperBounds.bottom + height * 0.12, seeded(seedKey + ':y')) + spanJitterY,
          0,
          worldHeight
        )
      }
    }

    if (side === 2) {
      return {
        x: clamp(
          mix(paperBounds.left - width * 0.12, paperBounds.right + width * 0.12, seeded(seedKey + ':x')) + spanJitterX,
          0,
          worldWidth
        ),
        y: clamp(paperBounds.top - overflowY, 0, worldHeight)
      }
    }

    return {
      x: clamp(
        mix(paperBounds.left - width * 0.12, paperBounds.right + width * 0.12, seeded(seedKey + ':x')) + spanJitterX,
        0,
        worldWidth
      ),
      y: clamp(paperBounds.bottom + overflowY, 0, worldHeight)
    }
  }

  function buildFumeBackgroundScene(params) {
    var viewport = params.viewport
    var world = params.world
    var paperBounds = params.paperBounds
    var seed = params.seed

    if (viewport.width <= 0 || viewport.height <= 0 || world.width <= 0 || world.height <= 0) {
      return {
        width: Math.max(world.width, viewport.width, 1),
        height: Math.max(world.height, viewport.height, 1),
        shapes: []
      }
    }

    var worldWidth = Math.max(world.width, viewport.width * 1.2)
    var worldHeight = Math.max(world.height, viewport.height * 1.2)
    var baseUnit = clamp(Math.min(viewport.width, viewport.height) * 0.72, 320, 760)
    var defaultPaperBounds = {
      left: worldWidth * 0.24,
      top: worldHeight * 0.18,
      right: worldWidth * 0.76,
      bottom: worldHeight * 0.82
    }
    var resolvedPaperBounds = normalizeBounds(
      paperBounds || defaultPaperBounds,
      worldWidth,
      worldHeight
    )
    var shapeKinds = ['ring', 'square', 'cross', 'ring', 'square', 'cross']
    var shapeCount = worldWidth > worldHeight ? 8 : 7
    var sparkBands = ['treble', 'vocal', 'mid', 'treble', 'lowMid']
    var sparkCount = worldWidth > worldHeight ? 12 : 9
    var sparkAreaLeft = worldWidth * 0.2
    var sparkAreaRight = worldWidth * 0.8
    var sparkAreaTop = worldHeight * 0.18
    var sparkAreaBottom = worldHeight * 0.82
    var sparkAreaWidth = sparkAreaRight - sparkAreaLeft
    var sparkAreaHeight = sparkAreaBottom - sparkAreaTop
    var sparkColumns = Math.ceil(Math.sqrt(sparkCount * (worldWidth / Math.max(worldHeight, 1))))
    var sparkRows = Math.ceil(sparkCount / sparkColumns)
    var sparkCellWidth = sparkAreaWidth / sparkColumns
    var sparkCellHeight = sparkAreaHeight / sparkRows

    var baseShapes = []
    for (var index = 0; index < shapeCount; index += 1) {
      var localSeed = (seed !== undefined && seed !== null ? seed : 'fume') + ':' + worldWidth + ':' + worldHeight + ':' + index
      var kind = shapeKinds[index % shapeKinds.length]
      var width = baseUnit * mix(0.82, 1.36, seeded(localSeed + ':size'))
      var height = width
      var anchor = choosePaperHaloAnchor({
        paperBounds: resolvedPaperBounds,
        worldWidth: worldWidth,
        worldHeight: worldHeight,
        width: width,
        height: height,
        seedKey: localSeed
      })

      baseShapes.push({
        id: 'fume-bg-' + index,
        kind: kind,
        x: anchor.x,
        y: anchor.y,
        width: width,
        height: height,
        rotation: mix(-Math.PI * 0.2, Math.PI * 0.2, seeded(localSeed + ':rotation')),
        rotationSpeed: mix(-0.045, 0.045, seeded(localSeed + ':rotation-speed')),
        strokeWidth: mix(0.25, 2.1, seeded(localSeed + ':stroke-width')),
        opacity: mix(0.01, 0.16, seeded(localSeed + ':opacity')),
        color: seeded(localSeed + ':color') > 0.5 ? 'accent' : 'secondary',
        depth: seeded(localSeed + ':depth'),
        ringGapStart: kind === 'ring' ? mix(-Math.PI, Math.PI, seeded(localSeed + ':gap-start')) : undefined,
        ringGapSize: kind === 'ring' ? mix(Math.PI * 0.12, Math.PI * 0.24, seeded(localSeed + ':gap-size')) : undefined,
        audioBand: undefined
      })
    }

    var sparkShapes = []
    for (var sparkIndex = 0; sparkIndex < sparkCount; sparkIndex += 1) {
      var sparkSeed = (seed !== undefined && seed !== null ? seed : 'fume') + ':' + worldWidth + ':' + worldHeight + ':spark:' + sparkIndex
      var sparkWidth = baseUnit * mix(0.1, 0.24, seeded(sparkSeed + ':size'))
      var column = sparkIndex % sparkColumns
      var row = Math.floor(sparkIndex / sparkColumns)
      var jitterX = mix(-0.32, 0.32, seeded(sparkSeed + ':jitter-x')) * sparkCellWidth
      var jitterY = mix(-0.32, 0.32, seeded(sparkSeed + ':jitter-y')) * sparkCellHeight
      var sparkX = clamp(sparkAreaLeft + (column + 0.5) * sparkCellWidth + jitterX, sparkAreaLeft, sparkAreaRight)
      var sparkY = clamp(sparkAreaTop + (row + 0.5) * sparkCellHeight + jitterY, sparkAreaTop, sparkAreaBottom)

      sparkShapes.push({
        id: 'fume-spark-' + sparkIndex,
        kind: 'spark',
        x: sparkX,
        y: sparkY,
        width: sparkWidth,
        height: sparkWidth,
        rotation: mix(-Math.PI, Math.PI, seeded(sparkSeed + ':rotation')),
        rotationSpeed: mix(-0.18, 0.18, seeded(sparkSeed + ':rotation-speed')),
        strokeWidth: mix(0.75, 1.7, seeded(sparkSeed + ':stroke-width')),
        opacity: mix(0.08, 0.22, seeded(sparkSeed + ':opacity')),
        color: seeded(sparkSeed + ':color') > 0.5 ? 'accent' : 'secondary',
        depth: seeded(sparkSeed + ':depth'),
        audioBand: sparkBands[sparkIndex % sparkBands.length],
        ringGapStart: undefined,
        ringGapSize: undefined
      })
    }

    var shapes = baseShapes.concat(sparkShapes).sort(function (left, right) { return left.depth - right.depth })

    return {
      width: worldWidth,
      height: worldHeight,
      shapes: shapes
    }
  }

  function drawFumeBackground(params) {
    var context = params.context
    var scene = params.scene
    var theme = params.theme
    var time = params.time === undefined ? 0 : params.time
    var audioLevels = params.audioLevels
    var parallax = params.parallax
    var objectOpacityMultiplier = params.objectOpacityMultiplier === undefined ? 1 : params.objectOpacityMultiplier

    var resolvedObjectOpacityMultiplier = clamp(objectOpacityMultiplier, 0, 2)
    var createLineGradient = function (shape, opacity) {
      var gradient = context.createLinearGradient(-shape.width * 0.55, -shape.height * 0.28, shape.width * 0.55, shape.height * 0.28)
      gradient.addColorStop(0, ColorMix.colorWithAlpha(theme.secondaryColor, opacity * 0.18))
      gradient.addColorStop(0.28, ColorMix.colorWithAlpha(ColorMix.mixColors(theme.secondaryColor, theme.accentColor, 0.24), opacity * 0.58))
      gradient.addColorStop(0.54, ColorMix.colorWithAlpha(ColorMix.mixColors(theme.secondaryColor, theme.accentColor, 0.62), opacity * 0.92))
      gradient.addColorStop(1, ColorMix.colorWithAlpha(theme.accentColor, opacity * 0.7))
      return gradient
    }

    var drawGradientGeometry = function (shape, opacity) {
      var baseWidth = Math.max(shape.strokeWidth * 0.28, 0.14)
      var topWidth = Math.max(shape.strokeWidth * 0.92, 0.78)

      buildShapePath(context, shape)
      context.strokeStyle = createLineGradient(shape, opacity * 0.56)
      context.lineWidth = baseWidth
      context.shadowBlur = 0
      context.shadowColor = 'transparent'
      context.stroke()

      buildShapePath(context, shape)
      context.strokeStyle = createLineGradient(shape, opacity)
      context.lineWidth = topWidth
      context.shadowBlur = 0
      context.shadowColor = 'transparent'
      context.stroke()
    }

    for (var i = 0; i < scene.shapes.length; i += 1) {
      var shape = scene.shapes[i]
      var bandValue = shape.audioBand && audioLevels && audioLevels[shape.audioBand] !== undefined
        ? audioLevels[shape.audioBand]
        : undefined
      var audioScale = bandValue === undefined
        ? 1
        : mix(0.95, 1.45, clamp((bandValue - 10) / 190, 0, 1))
      var audioOpacityBoost = bandValue === undefined
        ? 1
        : mix(0.85, 1.55, clamp((bandValue - 10) / 190, 0, 1))

      context.save()
      context.lineWidth = shape.strokeWidth
      var shapeColor = shape.color === 'accent' ? theme.accentColor : theme.secondaryColor
      var layerResponse = mix(0.58, 1.16, shape.depth)
      var parallaxStrength = parallax && parallax.strength !== undefined ? parallax.strength : 1
      var parallaxOffsetX = parallax
        ? (parallax.cameraX - parallax.originX) * (1 - layerResponse) * parallaxStrength
        : 0
      var parallaxOffsetY = parallax
        ? (parallax.cameraY - parallax.originY) * (1 - layerResponse) * parallaxStrength
        : 0

      var renderedShape = {
        id: shape.id,
        kind: shape.kind,
        x: shape.x + parallaxOffsetX,
        y: shape.y + parallaxOffsetY,
        width: shape.width * audioScale,
        height: shape.height * audioScale,
        rotation: shape.rotation + time * shape.rotationSpeed,
        rotationSpeed: shape.rotationSpeed,
        strokeWidth: shape.strokeWidth,
        opacity: shape.opacity,
        color: shape.color,
        depth: shape.depth,
        audioBand: shape.audioBand,
        ringGapStart: shape.ringGapStart,
        ringGapSize: shape.ringGapSize
      }

      if (shape.kind === 'spark') {
        context.strokeStyle = ColorMix.colorWithAlpha(
          shapeColor,
          clamp(shape.opacity * audioOpacityBoost * resolvedObjectOpacityMultiplier, 0, 0.42)
        )
        context.lineWidth = shape.strokeWidth
        context.shadowBlur = 10 * audioScale
        context.shadowColor = ColorMix.colorWithAlpha(
          shapeColor,
          shape.opacity * audioOpacityBoost * 0.75 * resolvedObjectOpacityMultiplier
        )
        traceShape(context, renderedShape)
      } else {
        context.translate(renderedShape.x, renderedShape.y)
        context.rotate(renderedShape.rotation)
        drawGradientGeometry(
          renderedShape,
          clamp(shape.opacity * audioOpacityBoost * resolvedObjectOpacityMultiplier, 0, 0.42)
        )
      }
      context.restore()
    }
  }

  // ============================================================
  // 模式实例
  // ============================================================
  function createMode() {
    var host = null
    var containerEl = null       // 模式根容器（独占背景，铺满 host）
    var canvasHostEl = null      // canvas 包装层（对应原版 motion.div，入场后 hasPrintedContent 时 scale 0.985 → 1）
    var canvasEl = null
    var context2d = null
    var loaderEl = null          // 排版进行中提示卡（对应原版 isLayoutPending 分支）
    var resizeObserver = null

    var theme = null
    var staticMode = false       // 原版 props.staticMode，插件场景恒 false（保留分支形态）
    var fontScale = 1            // lyricsFontScale
    var showText = true
    var paused = false

    var viewport = { width: 0, height: 0 }
    var currentLines = []
    var lastLinesRef = null
    var lastLinesHash = ''
    var article = null
    var layoutPending = false
    var hasPrintedContent = false
    var hasResolvedArticle = false
    var layoutBuildVersion = 0
    var buildRafId = 0
    var buildTimeoutId = 0

    var camera = { x: 0, y: 0, velocityX: 0, velocityY: 0, focusX: 0, focusY: 0, scale: 1, velocityScale: 0, focusScale: 1 }
    var cameraInitialized = false
    var cameraRetarget = {
      sourceLineIndex: -1,
      startedAt: 0,
      duration: 0.18,
      fromX: 0,
      fromY: 0,
      fromScale: 1,
      bridgeMode: 'none',
      bridgeWaypointX: 0,
      bridgeWaypointY: 0,
      bridgeWaypointScale: 1,
      bridgeWaypointPhase: 0.36
    }

    var staticBlockSnapshotCache = new Map()
    var lastThemeStyleKey = ''

    var backgroundScene = null
    var backgroundSceneKey = ''
    var overviewCamera = null
    var overviewCameraKey = ''

    var wallNow = 0              // 原版 draw 内 performance.now()；暂停时冻结（原版暂停即停帧）
    var wrapperLastScale = null

    // ---------- DOM ----------
    function mount(hostEl) {
      host = hostEl

      containerEl = document.createElement('div')
      containerEl.className = 'folia-mode-fume'
      containerEl.style.cssText = 'position:absolute;inset:0;z-index:10;pointer-events:none;overflow:hidden;user-select:none'

      // canvas 包装层：原版 "absolute left-1/2 top-0 -translate-x-1/2" + motion scale 动画
      canvasHostEl = document.createElement('div')
      canvasHostEl.style.cssText = [
        'position:absolute', 'left:50%', 'top:0',
        'translate:-50% 0', // 与原版 -translate-x-1/2 等价（独立 translate 属性，不干扰 scale 动画）
        'will-change:transform', 'pointer-events:none'
      ].join(';')

      canvasEl = document.createElement('canvas')
      canvasEl.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block'
      canvasHostEl.appendChild(canvasEl)
      containerEl.appendChild(canvasHostEl)

      // 排版进行中提示卡（原版 isLayoutPending UI）
      loaderEl = document.createElement('div')
      loaderEl.style.cssText = [
        'position:absolute', 'inset:0', 'display:flex', 'align-items:center', 'justify-content:center',
        'opacity:0', 'transition:opacity 0.3s ease', 'pointer-events:none'
      ].join(';')
      loaderEl.appendChild(buildLoaderCard())
      containerEl.appendChild(loaderEl)

      host.appendChild(containerEl)

      // 视口尺寸：ResizeObserver 对应原版 viewportRef 观察
      if (typeof ResizeObserver !== 'undefined') {
        resizeObserver = new ResizeObserver(function (entries) {
          var entry = entries && entries[0]
          if (!entry) return
          applyViewport(entry.contentRect.width, entry.contentRect.height)
        })
        resizeObserver.observe(hostEl)
      }
      var rect = hostEl.getBoundingClientRect()
      applyViewport(rect.width, rect.height)
    }

    // 加载卡：原版 rounded-3xl 边框卡 + Hourglass 图标 + 三条 pulse 进度条
    function buildLoaderCard() {
      var card = document.createElement('div')
      card.style.cssText = [
        'display:flex', 'min-width:10rem', 'flex-direction:column', 'align-items:center',
        'gap:1rem', 'border-radius:1.5rem', 'border:1px solid', 'padding:1.25rem 1.5rem'
      ].join(';')
      if (theme) {
        card.style.backgroundColor = theme.backgroundColor
        card.style.borderColor = ColorMix.colorWithAlpha(theme.secondaryColor, 0.24)
        card.style.boxShadow = '0 18px 60px ' + ColorMix.colorWithAlpha(theme.backgroundColor, 0.52)
      }

      var icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
      icon.setAttribute('viewBox', '0 0 24 24')
      icon.setAttribute('width', '24')
      icon.setAttribute('height', '24')
      icon.setAttribute('fill', 'none')
      icon.setAttribute('stroke', 'currentColor')
      icon.setAttribute('stroke-width', '2')
      icon.setAttribute('stroke-linecap', 'round')
      icon.setAttribute('stroke-linejoin', 'round')
      // lucide Hourglass 图标路径
      var iconPaths = [
        'M5 22h14',
        'M5 2h14',
        'M17 22v-4.172a2 2 0 0 0-.586-1.414L12 12l-4.414 4.414A2 2 0 0 0 7 17.828V22',
        'M7 2v4.172a2 2 0 0 0 .586 1.414L12 12l4.414-4.414A2 2 0 0 0 17 6.172V2'
      ]
      iconPaths.forEach(function (d) {
        var path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
        path.setAttribute('d', d)
        icon.appendChild(path)
      })
      if (theme) icon.style.color = ColorMix.colorWithAlpha(theme.primaryColor, 0.78)
      startPulse(icon)

      var bars = document.createElement('div')
      bars.style.cssText = 'display:flex;width:7rem;flex-direction:column;gap:0.625rem'

      var barSpecs = [
        { width: '100%', color: theme ? ColorMix.colorWithAlpha(theme.primaryColor, 0.32) : '' },
        { width: '78%', color: theme ? ColorMix.colorWithAlpha(theme.primaryColor, 0.22) : '' },
        { width: '56%', color: theme ? ColorMix.colorWithAlpha(theme.secondaryColor, 0.2) : '' }
      ]
      barSpecs.forEach(function (spec) {
        var bar = document.createElement('div')
        bar.style.cssText = 'height:0.5rem;border-radius:9999px'
        bar.style.width = spec.width
        if (spec.color) bar.style.backgroundColor = spec.color
        startPulse(bar)
        bars.appendChild(bar)
      })

      card.appendChild(icon)
      card.appendChild(bars)
      return card
    }

    // tailwind animate-pulse 等价：opacity 1 → 0.5 → 1，2s 无限循环
    function startPulse(el) {
      try {
        el.animate(
          [
            { opacity: 1 },
            { opacity: 0.5 },
            { opacity: 1 }
          ],
          { duration: 2000, iterations: Infinity, easing: 'cubic-bezier(0.4, 0, 0.6, 1)' }
        )
      } catch (e) { /* 不支持 WAAPI 时保持静态 */ }
    }

    function applyViewport(width, height) {
      var nextWidth = Number.isFinite(width) ? width : 0
      var nextHeight = Number.isFinite(height) ? height : 0
      if (viewport.width === nextWidth && viewport.height === nextHeight) return
      viewport.width = nextWidth
      viewport.height = nextHeight
      if (canvasHostEl) {
        canvasHostEl.style.width = nextWidth + 'px'
        canvasHostEl.style.height = nextHeight + 'px'
      }
      scheduleArticleBuild()
    }

    // ---------- 文章布局构建（原版 useEffect：rAF + 防抖 setTimeout + 模块缓存） ----------
    function layoutThemeInfo() {
      return {
        name: theme ? theme.name : undefined,
        fontStyle: theme ? theme.fontStyle : undefined,
        fontFamily: theme ? theme.fontFamily : undefined,
        fontFamilyStack: theme ? theme.fontFamilyStack : undefined,
        fontWeight: theme ? theme.fontWeight : undefined
      }
    }

    function resolvedFumeTuning() {
      return {
        hidePrintSymbols: DEFAULT_FUME_TUNING.hidePrintSymbols,
        disableGeometricBackground: DEFAULT_FUME_TUNING.disableGeometricBackground,
        backgroundObjectOpacity: clamp(DEFAULT_FUME_TUNING.backgroundObjectOpacity, 0, 1),
        textHoldRatio: clamp(DEFAULT_FUME_TUNING.textHoldRatio, 0, 1),
        cameraTrackingMode: DEFAULT_FUME_TUNING.cameraTrackingMode,
        cameraSpeed: clamp(DEFAULT_FUME_TUNING.cameraSpeed, 0.55, 1.85),
        glowIntensity: clamp(DEFAULT_FUME_TUNING.glowIntensity, 0, 1.8),
        heroScale: clamp(DEFAULT_FUME_TUNING.heroScale, 0.82, 1.32)
      }
    }

    // 原版 layoutFumeTuning = { ...DEFAULT, heroScale: resolved.heroScale }
    function layoutFumeTuning() {
      var tuning = resolvedFumeTuning()
      return Object.assign({}, DEFAULT_FUME_TUNING, { heroScale: tuning.heroScale })
    }

    function hasPretext() {
      return Boolean(
        window.Pretext
        && typeof window.Pretext.prepareWithSegments === 'function'
        && typeof window.Pretext.layoutWithLines === 'function'
      )
    }

    function scheduleArticleBuild() {
      var requestVersion = layoutBuildVersion + 1
      layoutBuildVersion = requestVersion

      if (viewport.width <= 0 || viewport.height <= 0 || currentLines.length === 0 || !theme || !hasPretext()) {
        hasResolvedArticle = false
        article = null
        layoutPending = false
        onArticleChanged()
        return
      }

      layoutPending = true
      updateLoader()

      var delay = hasResolvedArticle ? LAYOUT_REBUILD_DEBOUNCE_MS : 0
      if (buildRafId) { try { cancelAnimationFrame(buildRafId) } catch (e) { /* 忽略 */ } }
      if (buildTimeoutId) { clearTimeout(buildTimeoutId); buildTimeoutId = 0 }

      buildRafId = requestAnimationFrame(function () {
        buildRafId = 0
        buildTimeoutId = setTimeout(function () {
          buildTimeoutId = 0
          if (layoutBuildVersion !== requestVersion) return

          var tuning = layoutFumeTuning()
          var themeInfo = layoutThemeInfo()
          var cacheKey = buildLayoutCacheKey(
            currentLines,
            viewport,
            themeInfo,
            resolveThemeFontStack(theme),
            fontScale,
            tuning
          )
          var nextArticle = lastFumeLayoutCache && lastFumeLayoutCache.key === cacheKey
            ? lastFumeLayoutCache.article
            : buildArticleLayout(currentLines, viewport, themeInfo, fontScale, tuning)
          if (layoutBuildVersion !== requestVersion) return

          lastFumeLayoutCache = { key: cacheKey, article: nextArticle }
          hasResolvedArticle = nextArticle !== null
          article = nextArticle
          layoutPending = false
          onArticleChanged()
        }, delay)
      })
    }

    // 文章变化后的派生量重置（对应原版 article 相关 useEffect）
    function onArticleChanged() {
      // 静态块快照缓存清空（article / 主题视觉键变化时）
      staticBlockSnapshotCache.clear()
      // 打印内容标记复位
      hasPrintedContent = false
      wrapperLastScale = null
      overviewCameraKey = ''
      backgroundSceneKey = ''
      updateWrapperScale()
      updateWrapperVisibility()
      updateLoader()
    }

    function updateWrapperVisibility() {
      if (!canvasHostEl) return
      // 原版渲染条件：article || lines.length === 0
      var visible = Boolean(article) || currentLines.length === 0
      canvasHostEl.style.display = visible ? '' : 'none'
    }

    // 原版 motion.div animate scale：article && showText ? (hasPrintedContent ? 1 : 0.985) : 1
    function updateWrapperScale() {
      if (!canvasHostEl) return
      var target = article && showText ? (hasPrintedContent ? 1 : 0.985) : 1
      if (wrapperLastScale === target) return
      var from = wrapperLastScale === null ? target : wrapperLastScale
      wrapperLastScale = target
      if (from === target || !Anim) {
        canvasHostEl.style.transform = 'scale(' + target + ')'
        return
      }
      Anim.animateProps(canvasHostEl, {
        transform: { from: { scale: from }, to: { scale: target } }
      }, { duration: 0.45, ease: 'easeOut' })
    }

    function updateLoader() {
      if (!loaderEl) return
      loaderEl.style.opacity = layoutPending ? '1' : '0'
      loaderEl.style.pointerEvents = 'none'
    }

    // ---------- 每帧绘制 ----------
    function tick(frameState) {
      if (!host || !theme || !context2d) return

      showText = frameState.showText !== false
      paused = frameState.isPlaying === false

      // 行数据经 tick 传入（registry 只在切换时调 setLines）。
      // 引用变化时再比内容哈希，避免宿主每帧重建数组导致排版任务被反复取消
      if (frameState.lines !== lastLinesRef) {
        var incomingLines = frameState.lines || []
        lastLinesRef = frameState.lines || null
        var incomingHash = String(computeLinesHash(incomingLines))
        if (incomingHash !== lastLinesHash) {
          lastLinesHash = incomingHash
          currentLines = incomingLines
          scheduleArticleBuild()
        } else {
          currentLines = incomingLines
        }
      }

      // 原版 draw 内 performance.now()；暂停时冻结以复现"停帧"
      if (!paused) {
        wallNow = typeof performance !== 'undefined' ? performance.now() : Date.now()
      }
      var now = wallNow
      // 原版 dt：clamp((now - lastFrameAt) / 1000, 1/240, 0.05)；由 frameState.dt 提供
      var rawDt = typeof frameState.dt === 'number' && Number.isFinite(frameState.dt) ? frameState.dt : 1 / 60
      var dt = clamp(rawDt, 1 / 240, 0.05)

      // canvas 尺寸/DPR 校准
      var width = Math.max(Math.floor(viewport.width), 1)
      var height = Math.max(Math.floor(viewport.height), 1)
      var dpr = window.devicePixelRatio || 1
      if (canvasEl.width !== Math.floor(width * dpr) || canvasEl.height !== Math.floor(height * dpr)) {
        canvasEl.width = Math.floor(width * dpr)
        canvasEl.height = Math.floor(height * dpr)
        canvasEl.style.width = width + 'px'
        canvasEl.style.height = height + 'px'
      }
      context2d.setTransform(dpr, 0, 0, dpr, 0, 0)
      context2d.clearRect(0, 0, width, height)

      // 派生场景缓存（背景场景 / 总览相机，对应原版 useMemo）
      ensureDerivedScenes()

      // 相机初始化 / 边界钳制（原版 draw 顶部逻辑）
      if (article && !cameraInitialized) {
        camera = {
          x: article.width * 0.5,
          y: article.height * 0.5,
          velocityX: 0,
          velocityY: 0,
          focusX: article.width * 0.5,
          focusY: article.height * 0.5,
          scale: 1.18,
          velocityScale: 0,
          focusScale: 1.18
        }
        cameraInitialized = true
      } else if (article) {
        camera.x = clamp(camera.x, 0, article.width)
        camera.y = clamp(camera.y, 0, article.height)
        camera.focusX = clamp(camera.focusX, 0, article.width)
        camera.focusY = clamp(camera.focusY, 0, article.height)
        camera.scale = clamp(camera.scale, CAMERA_SCALE_MIN, CAMERA_SCALE_MAX)
        camera.focusScale = clamp(camera.focusScale, CAMERA_SCALE_MIN, CAMERA_SCALE_MAX)
      } else {
        cameraInitialized = false
      }

      var time = frameState.currentTime
      var viewportCenterX = viewport.width * 0.5
      var viewportCenterY = viewport.height * 0.5

      // 原版 audioPower.get()/audioBands.*.get() 是 0~255 域（getByteFrequencyData 派生），
      // frameState 提供 0~1，此处换算回原域后套用原公式
      var fumeBackgroundAudioLevels = {
        power: toLegacyAudioValue(frameState.audioPower),
        bass: toLegacyAudioValue(frameState.audioBands && frameState.audioBands.bass),
        lowMid: toLegacyAudioValue(frameState.audioBands && frameState.audioBands.lowMid),
        mid: toLegacyAudioValue(frameState.audioBands && frameState.audioBands.mid),
        vocal: toLegacyAudioValue(frameState.audioBands && frameState.audioBands.vocal),
        treble: toLegacyAudioValue(frameState.audioBands && frameState.audioBands.treble)
      }

      var tuning = resolvedFumeTuning()
      var cameraSpeed = tuning.cameraSpeed
      var glowIntensity = tuning.glowIntensity
      var backgroundObjectOpacity = tuning.backgroundObjectOpacity
      var showPrintStamp = !tuning.hidePrintSymbols
      var textHoldRatio = tuning.textHoldRatio
      var passedFadeDuration = resolveFumePassedFadeDuration(currentLines, textHoldRatio)

      if (!article) {
        if (!staticMode) {
          context2d.save()
          context2d.translate(viewportCenterX, viewportCenterY)
          context2d.translate(-backgroundSceneWidth() * 0.5, -backgroundSceneHeight() * 0.5)
          drawFumeBackground({
            context: context2d,
            scene: backgroundScene,
            theme: theme,
            time: time + now * 0.00018,
            audioLevels: fumeBackgroundAudioLevels,
            objectOpacityMultiplier: backgroundObjectOpacity * 2
          })
          context2d.restore()
        }
        updateSubtitleOverlay(frameState, time)
        return
      }

      // 一次性检测：任意块开始打印即置 hasPrintedContent（驱动包装层 0.985 → 1）
      if (!hasPrintedContent && time >= article.firstRenderableStartTime) {
        hasPrintedContent = true
        updateWrapperScale()
      }

      var focusBlock = resolveFocusBlock(article, frameState.currentLineIndex, time)
      var shouldShowOverview = overviewCamera !== null && time >= overviewStartTime()

      var targetCameraX = article.width * 0.5
      var targetCameraY = article.height * 0.5
      var targetCameraScale = 1.18
      var entryFocusPoint = null
      var didRetargetThisFrame = false

      if (shouldShowOverview && overviewCamera) {
        targetCameraX = overviewCamera.x
        targetCameraY = overviewCamera.y
        targetCameraScale = overviewCamera.scale

        if (cameraRetarget.sourceLineIndex !== OVERVIEW_CAMERA_SOURCE) {
          cameraRetarget = {
            sourceLineIndex: OVERVIEW_CAMERA_SOURCE,
            startedAt: time,
            duration: clamp(resolveOverviewRetargetDuration(viewport) / cameraSpeed, 0.12, 1.2),
            fromX: camera.x,
            fromY: camera.y,
            fromScale: camera.scale,
            bridgeMode: 'none',
            bridgeWaypointX: 0,
            bridgeWaypointY: 0,
            bridgeWaypointScale: 1,
            bridgeWaypointPhase: 0.36
          }
          didRetargetThisFrame = true
        }
      } else if (focusBlock) {
        var focusPoint = tuning.cameraTrackingMode === 'stepped'
          ? resolveSteppedBlockFocusPoint(
            focusBlock,
            resolvePrintedGraphemeCount(focusBlock.line, focusBlock.wordRanges, focusBlock.graphemes.length, time)
          )
          : resolveSmoothBlockFocusPoint(
            focusBlock,
            resolvePrintedGraphemeProgress(focusBlock.line, focusBlock.wordRanges, focusBlock.graphemes.length, time)
          )
        entryFocusPoint = resolveBlockEntryFocusPoint(focusBlock)
        targetCameraX = focusPoint.x
        targetCameraY = focusPoint.y
        targetCameraScale = resolveCameraScaleForBlock(focusBlock, viewport)

        if (cameraRetarget.sourceLineIndex !== focusBlock.sourceLineIndex) {
          cameraRetarget = {
            sourceLineIndex: focusBlock.sourceLineIndex,
            startedAt: time,
            duration: clamp(resolveCameraRetargetDuration(focusBlock.line) / cameraSpeed, 0.03, 0.3),
            fromX: camera.x,
            fromY: camera.y,
            fromScale: camera.scale,
            bridgeMode: 'none',
            bridgeWaypointX: 0,
            bridgeWaypointY: 0,
            bridgeWaypointScale: 1,
            bridgeWaypointPhase: 0.36
          }
          didRetargetThisFrame = true
        }
      } else if (cameraRetarget.sourceLineIndex !== -1) {
        cameraRetarget = {
          sourceLineIndex: -1,
          startedAt: time,
          duration: clamp(0.18 / cameraSpeed, 0.05, 0.4),
          fromX: camera.x,
          fromY: camera.y,
          fromScale: camera.scale,
          bridgeMode: 'none',
          bridgeWaypointX: 0,
          bridgeWaypointY: 0,
          bridgeWaypointScale: 1,
          bridgeWaypointPhase: 0.36
        }
        didRetargetThisFrame = true
      }

      var retargetElapsed = Math.max(time - cameraRetarget.startedAt, 0)
      var overviewTextRestoreProgress = shouldShowOverview && cameraRetarget.sourceLineIndex === OVERVIEW_CAMERA_SOURCE
        ? easeInOutCubic(clamp(
          retargetElapsed / Math.max(cameraRetarget.duration, 0.001),
          0,
          1
        ))
        : 0
      var retargetPhase = clamp(
        retargetElapsed / Math.max(cameraRetarget.duration, 0.001),
        0,
        1
      )
      var retargetBoost = 1 - easeOutCubic(retargetPhase)
      var entryFocusBias = Math.pow(retargetBoost, 0.58)

      if (entryFocusPoint) {
        targetCameraX = mix(targetCameraX, entryFocusPoint.x, entryFocusBias)
        targetCameraY = mix(targetCameraY, entryFocusPoint.y, entryFocusBias)
      }

      if (!staticMode) {
        // 整屏浮动（按强度分档），总览时衰减
        var floatConfig = theme.animationIntensity === 'chaotic'
          ? { distance: 24, duration: 5.8, scaleAmplitude: 0.014 }
          : theme.animationIntensity === 'calm'
            ? { distance: 14, duration: 8.5, scaleAmplitude: 0.008 }
            : { distance: 18, duration: 7, scaleAmplitude: 0.011 }
        var floatPhase = (now / 1000 / floatConfig.duration) * Math.PI * 2
        var overviewAttenuation = shouldShowOverview ? 0.36 : 1
        var screenFloatX = Math.sin(floatPhase * 0.74 + 0.8) * floatConfig.distance * 0.34
        var screenFloatY = (
          Math.sin(floatPhase) * floatConfig.distance
          + Math.sin(floatPhase * 0.5 + 1.1) * floatConfig.distance * 0.22
        ) * overviewAttenuation
        var worldFloatDivisor = Math.max(targetCameraScale, 0.001)

        targetCameraX -= screenFloatX / worldFloatDivisor
        targetCameraY -= screenFloatY / worldFloatDivisor
        targetCameraScale = clamp(
          targetCameraScale * (1 + Math.sin(floatPhase + 0.9) * floatConfig.scaleAmplitude * overviewAttenuation),
          CAMERA_SCALE_MIN,
          CAMERA_SCALE_MAX
        )
      }

      if (didRetargetThisFrame) {
        var bridgeScale = Math.max(camera.scale, targetCameraScale, 0.001)
        var screenDeltaX = Math.abs(targetCameraX - cameraRetarget.fromX) * bridgeScale
        var screenDeltaY = Math.abs(targetCameraY - cameraRetarget.fromY) * bridgeScale
        var screenDistance = Math.hypot(screenDeltaX, screenDeltaY)
        cameraRetarget.bridgeMode = screenDistance >= Math.min(viewport.width, viewport.height) * 0.42
          ? 'direct'
          : 'none'
        cameraRetarget.bridgeWaypointX = targetCameraX
        cameraRetarget.bridgeWaypointY = targetCameraY
        cameraRetarget.bridgeWaypointScale = targetCameraScale
        cameraRetarget.bridgeWaypointPhase = 0.5

        if (cameraRetarget.sourceLineIndex >= 0) {
          var overviewFlightBridge = resolveOverviewFlightBridge({
            fromX: cameraRetarget.fromX,
            fromY: cameraRetarget.fromY,
            fromScale: cameraRetarget.fromScale,
            targetX: targetCameraX,
            targetY: targetCameraY,
            targetScale: targetCameraScale,
            overviewCamera: overviewCamera,
            viewport: viewport
          })

          if (overviewFlightBridge) {
            cameraRetarget.bridgeMode = 'overview'
            cameraRetarget.bridgeWaypointX = overviewFlightBridge.waypointX
            cameraRetarget.bridgeWaypointY = overviewFlightBridge.waypointY
            cameraRetarget.bridgeWaypointScale = overviewFlightBridge.waypointScale
            cameraRetarget.bridgeWaypointPhase = overviewFlightBridge.waypointPhase
            cameraRetarget.duration = Math.max(
              cameraRetarget.duration,
              clamp(overviewFlightBridge.duration / cameraSpeed, 0.16, 0.9)
            )
          }
        }
      }

      var cameraDistance = Math.hypot(
        targetCameraX - camera.x,
        targetCameraY - camera.y
      )
      var shouldUseBridge = cameraRetarget.bridgeMode !== 'none' && retargetPhase < 1

      // 相机积分：暂停时冻结（原版暂停即停止 rAF 循环）
      if (!paused) {
        if (shouldUseBridge) {
          var bridgedCameraX = targetCameraX
          var bridgedCameraY = targetCameraY
          var bridgedCameraScale = targetCameraScale

          if (cameraRetarget.bridgeMode === 'overview') {
            var bridgePhase = easeOutCubic(retargetPhase)
            bridgedCameraX = quadraticBezier(cameraRetarget.fromX, cameraRetarget.bridgeWaypointX, targetCameraX, bridgePhase)
            bridgedCameraY = quadraticBezier(cameraRetarget.fromY, cameraRetarget.bridgeWaypointY, targetCameraY, bridgePhase)
            bridgedCameraScale = quadraticBezier(cameraRetarget.fromScale, cameraRetarget.bridgeWaypointScale, targetCameraScale, bridgePhase)
          } else {
            var bridgePhaseDirect = easeInOutCubic(retargetPhase)
            bridgedCameraX = mix(cameraRetarget.fromX, targetCameraX, bridgePhaseDirect)
            bridgedCameraY = mix(cameraRetarget.fromY, targetCameraY, bridgePhaseDirect)
            bridgedCameraScale = mix(cameraRetarget.fromScale, targetCameraScale, bridgePhaseDirect)
          }

          var bridgeCatchUp = 1 - Math.exp(-dt * (
            cameraRetarget.bridgeMode === 'overview'
              ? mix(12.5, 22, 1 - retargetPhase)
              : mix(10.5, 17.5, 1 - retargetPhase)
          ))

          camera.focusX = bridgedCameraX
          camera.focusY = bridgedCameraY
          camera.focusScale = bridgedCameraScale
          camera.x += (bridgedCameraX - camera.x) * bridgeCatchUp
          camera.y += (bridgedCameraY - camera.y) * bridgeCatchUp
          camera.scale += (bridgedCameraScale - camera.scale) * bridgeCatchUp
          camera.scale = clamp(camera.scale, CAMERA_SCALE_MIN, CAMERA_SCALE_MAX)
          camera.velocityX *= 0.72
          camera.velocityY *= 0.72
          camera.velocityScale *= 0.68
        } else {
          var boostedCatchUpRate = clamp(
            4.8 / Math.max(cameraRetarget.duration, 0.05),
            20,
            54
          )
          var targetCatchUp = 1 - Math.exp(-dt * mix(11.2, boostedCatchUpRate, retargetBoost))
          camera.focusX += (targetCameraX - camera.focusX) * targetCatchUp
          camera.focusY += (targetCameraY - camera.focusY) * targetCatchUp
          camera.focusScale += (targetCameraScale - camera.focusScale)
            * (1 - Math.exp(-dt * mix(5.4, 12.8, retargetBoost)))

          var springStrength = mix(
            208,
            clamp(15.8 / Math.max(cameraRetarget.duration * cameraRetarget.duration, 0.0064), 260, 780),
            retargetBoost
          )
          var damping = mix(
            24,
            clamp(Math.sqrt(springStrength) * 1.36, 24, 40),
            retargetBoost
          )
          var accelX = (camera.focusX - camera.x) * springStrength - camera.velocityX * damping
          var accelY = (camera.focusY - camera.y) * springStrength - camera.velocityY * damping
          camera.velocityX += accelX * dt
          camera.velocityY += accelY * dt
          var maxVelocity = mix(
            1320,
            clamp(cameraDistance / Math.max(cameraRetarget.duration * 0.28, 0.028), 2600, 8800),
            retargetBoost
          )
          camera.velocityX = clamp(camera.velocityX, -maxVelocity, maxVelocity)
          camera.velocityY = clamp(camera.velocityY, -maxVelocity, maxVelocity)
          camera.x += camera.velocityX * dt
          camera.y += camera.velocityY * dt

          var scaleSpringStrength = mix(54, 108, retargetBoost)
          var scaleDamping = mix(13.5, 21, retargetBoost)
          var accelScale = (camera.focusScale - camera.scale) * scaleSpringStrength
            - camera.velocityScale * scaleDamping
          camera.velocityScale += accelScale * dt
          camera.velocityScale = clamp(camera.velocityScale, -1.6, 1.6)
          camera.scale += camera.velocityScale * dt
          camera.scale = clamp(camera.scale, CAMERA_SCALE_MIN, CAMERA_SCALE_MAX)
        }
      }

      var screenScale = camera.scale

      if (!staticMode) {
        // 背景视差相机（跟随主相机 0.9/0.74，另加垂直偏移）
        var backgroundCenterX = backgroundSceneWidth() * 0.5
        var backgroundCenterY = backgroundSceneHeight() * 0.5
        var backgroundVerticalOffset = clamp(
          viewport.height * FUME_BACKGROUND_VERTICAL_OFFSET_RATIO / Math.max(screenScale, 0.001),
          48,
          180
        )
        var backgroundCameraX = mix(backgroundCenterX, camera.x, FUME_BACKGROUND_PARALLAX_X)
        var backgroundCameraY = mix(backgroundCenterY, camera.y, FUME_BACKGROUND_PARALLAX_Y) - backgroundVerticalOffset
        var backgroundScale = clamp(
          screenScale * FUME_BACKGROUND_SCALE_FACTOR,
          CAMERA_SCALE_MIN,
          CAMERA_SCALE_MAX
        )

        context2d.save()
        context2d.translate(viewportCenterX, viewportCenterY)
        context2d.scale(backgroundScale, backgroundScale)
        context2d.translate(-backgroundCameraX, -backgroundCameraY)
        drawFumeBackground({
          context: context2d,
          scene: backgroundScene,
          theme: theme,
          time: time,
          audioLevels: fumeBackgroundAudioLevels,
          objectOpacityMultiplier: backgroundObjectOpacity * 2,
          parallax: {
            cameraX: backgroundCameraX,
            cameraY: backgroundCameraY,
            originX: backgroundCenterX,
            originY: backgroundCenterY,
            strength: 0.72
          }
        })
        context2d.restore()
      }

      // ===== 纸张世界：相机变换后绘制文本 =====
      context2d.save()
      context2d.translate(viewportCenterX, viewportCenterY)
      context2d.scale(screenScale, screenScale)
      context2d.translate(-camera.x, -camera.y)

      var activeGlowBoost = (theme.animationIntensity === 'chaotic'
        ? 1.15
        : theme.animationIntensity === 'calm'
          ? 0.72
          : 0.92) * glowIntensity
      var passedGlowBase = (theme.animationIntensity === 'chaotic'
        ? 0.95
        : theme.animationIntensity === 'calm'
          ? 0.35
          : 0.62) * glowIntensity

      if (showText) {
        for (var blockIndex = 0; blockIndex < article.blocks.length; blockIndex += 1) {
          var block = article.blocks[blockIndex]
          var screenLeft = viewportCenterX + (block.x - camera.x) * screenScale
          var screenTop = viewportCenterY + (block.y - camera.y) * screenScale
          var screenRight = screenLeft + block.width * screenScale
          var screenBottom = screenTop + block.height * screenScale
          var overscan = 180

          if (screenRight < -overscan || screenLeft > viewport.width + overscan || screenBottom < -overscan || screenTop > viewport.height + overscan) {
            continue
          }

          drawBlock(
            block,
            time,
            textHoldRatio,
            passedFadeDuration,
            overviewTextRestoreProgress,
            activeGlowBoost,
            passedGlowBase,
            showPrintStamp,
            glowIntensity
          )
        }
      }

      context2d.restore()
      updateSubtitleOverlay(frameState, time)
    }

    // frameState 0~1 频段 → 原版 0~255 域（>1 视为已是原域，防御处理）
    function toLegacyAudioValue(value) {
      var num = typeof value === 'number' && Number.isFinite(value) ? value : 0
      if (num > 1) return num
      return num * 255
    }

    function backgroundSceneWidth() { return backgroundScene ? backgroundScene.width : 1 }
    function backgroundSceneHeight() { return backgroundScene ? backgroundScene.height : 1 }

    // 派生场景缓存（对应原版 useMemo）：背景场景随 article/viewport/主题名重建；总览相机随 article/viewport 重建
    function ensureDerivedScenes() {
      var worldWidth = article ? article.width : Math.max(viewport.width * 1.8, viewport.width)
      var worldHeight = article ? article.height : Math.max(viewport.height * 1.8, viewport.height)
      var sceneSeed = 'fume:' + (theme && theme.name !== undefined && theme.name !== null ? theme.name : 'fume')
      var bounds = article ? article.paperBounds : null
      var sceneKey = [
        Math.round(viewport.width), Math.round(viewport.height),
        Math.round(worldWidth), Math.round(worldHeight),
        bounds ? [bounds.left, bounds.top, bounds.right, bounds.bottom].map(function (v) { return Math.round(v) }).join(',') : '',
        sceneSeed
      ].join('|')
      if (sceneKey !== backgroundSceneKey || !backgroundScene) {
        backgroundSceneKey = sceneKey
        backgroundScene = buildFumeBackgroundScene({
          viewport: viewport,
          world: { width: worldWidth, height: worldHeight },
          paperBounds: bounds || undefined,
          seed: sceneSeed
        })
      }

      var ovKey = article ? (Math.round(viewport.width) + 'x' + Math.round(viewport.height) + ':a') : 'none'
      if (overviewCameraKey !== ovKey) {
        overviewCameraKey = ovKey
        overviewCamera = article ? resolveArticleOverviewCamera(article, viewport) : null
      }
    }

    // 原版 overviewStartTime：最后一个可渲染行播放过半后进入总览
    function overviewStartTime() {
      var lastRenderableLine = null
      for (var index = currentLines.length - 1; index >= 0; index -= 1) {
        if (currentLines[index] && currentLines[index].fullText.trim().length) {
          lastRenderableLine = currentLines[index]
          break
        }
      }
      if (!lastRenderableLine) return Number.POSITIVE_INFINITY

      var lineStartTime = lastRenderableLine.startTime
      var lineRenderEndTime = RenderHints.getLineRenderEndTime(lastRenderableLine)
      return lineStartTime + Math.max(lineRenderEndTime - lineStartTime, 0) * 0.5
    }

    // ===== 单块绘制（原版 draw 循环内的 per-block 逻辑） =====
    function drawBlock(block, time, textHoldRatio, passedFadeDuration, overviewTextRestoreProgress, activeGlowBoost, passedGlowBase, showPrintStamp, glowIntensity) {
      var context = context2d
      var waitingOpacity = block.variant === 'hero' ? 0.06 : 0.035
      var activeOpacity = block.variant === 'hero' ? 0.985 : 0.92
      var effectiveTextHoldStyle = textHoldRatio >= 1 ? 'standard' : 'dimmed'
      var passedStyle = resolvePassedTextStyle(block.variant, effectiveTextHoldStyle)
      var passedOpacity = passedStyle.opacity
      var transitionPassedStyle = resolvePassedTextStyle(block.variant, 'standard')
      var baselineOffset = block.lineHeight * (isCJK(block.line.fullText) ? 0.52 : 0.5)
      var lineEndTime = RenderHints.getLineRenderEndTime(block.line)
      var nextLine = currentLines[block.sourceLineIndex + 1]
      var nextLineStartTime = nextLine ? nextLine.startTime : null
      var linePassCutoffTime = resolveLinePassCutoffTime(block.line, nextLineStartTime)
      var revealCompleteTime = block.line.endTime
      var hasRevealCompleted = time >= revealCompleteTime
      var hasPassCutoffReached = time >= linePassCutoffTime
      var lineDuration = Math.max(lineEndTime - block.line.startTime, 0.18)
      var colorTrailDuration = clamp(
        lineDuration * (block.variant === 'hero' ? 0.42 : 0.52),
        0.45,
        1.45
      )
      var staticState = time < block.line.startTime
        ? 'waiting'
        : (time >= lineEndTime + colorTrailDuration ? 'passed' : null)

      // 静态态（waiting/passed）走整块快照
      if (staticState) {
        var snapshotScale = clamp(window.devicePixelRatio || 1, 1, 2)
        var cacheStyleKey = staticState === 'passed' ? effectiveTextHoldStyle : 'base'
        var cacheKey = block.id + ':' + staticState + ':' + cacheStyleKey + ':' + snapshotScale
        var snapshot = staticBlockSnapshotCache.get(cacheKey)

        if (!snapshot) {
          snapshot = createStaticBlockSnapshot(
            block,
            theme,
            staticState === 'waiting'
              ? ColorMix.colorWithAlpha(theme.primaryColor, waitingOpacity)
              : ColorMix.colorWithAlpha(theme.primaryColor, passedOpacity),
            staticState === 'waiting'
              ? 0
              : (2 + block.fontPx * 0.1) * 0.65 * passedGlowBase * passedStyle.glowMultiplier,
            staticState === 'waiting'
              ? 'transparent'
              : ColorMix.colorWithAlpha(theme.primaryColor, passedStyle.shadowAlphaBase)
          )
          if (snapshot) {
            staticBlockSnapshotCache.set(cacheKey, snapshot)
          }
        }

        if (snapshot) {
          if (staticState === 'passed' && effectiveTextHoldStyle === 'dimmed') {
            var passedAt = lineEndTime + colorTrailDuration
            var baseDimAmount = resolvePassedDimAmount(time, passedAt, passedFadeDuration)
            var dimAmount = baseDimAmount * (1 - overviewTextRestoreProgress)
            var standardCacheKey = block.id + ':passed:standard:' + snapshotScale
            var standardSnapshot = staticBlockSnapshotCache.get(standardCacheKey)

            if (!standardSnapshot) {
              standardSnapshot = createStaticBlockSnapshot(
                block,
                theme,
                ColorMix.colorWithAlpha(theme.primaryColor, transitionPassedStyle.opacity),
                (2 + block.fontPx * 0.1) * 0.65 * passedGlowBase * transitionPassedStyle.glowMultiplier,
                ColorMix.colorWithAlpha(theme.primaryColor, transitionPassedStyle.shadowAlphaBase)
              )
              if (standardSnapshot) {
                staticBlockSnapshotCache.set(standardCacheKey, standardSnapshot)
              }
            }

            if (standardSnapshot) {
              if (dimAmount <= 0) {
                context.drawImage(
                  standardSnapshot.canvas,
                  block.x - standardSnapshot.padding,
                  block.y - standardSnapshot.padding,
                  block.width + standardSnapshot.padding * 2,
                  block.height + standardSnapshot.padding * 2
                )
                return
              }

              if (dimAmount < 1) {
                var previousAlpha = context.globalAlpha
                context.globalAlpha = previousAlpha * (1 - dimAmount)
                context.drawImage(
                  standardSnapshot.canvas,
                  block.x - standardSnapshot.padding,
                  block.y - standardSnapshot.padding,
                  block.width + standardSnapshot.padding * 2,
                  block.height + standardSnapshot.padding * 2
                )
                context.globalAlpha = previousAlpha * dimAmount
                context.drawImage(
                  snapshot.canvas,
                  block.x - snapshot.padding,
                  block.y - snapshot.padding,
                  block.width + snapshot.padding * 2,
                  block.height + snapshot.padding * 2
                )
                context.globalAlpha = previousAlpha
                return
              }
            }
          }

          context.drawImage(
            snapshot.canvas,
            block.x - snapshot.padding,
            block.y - snapshot.padding,
            block.width + snapshot.padding * 2,
            block.height + snapshot.padding * 2
          )
          return
        }
      }

      // 动态态：逐字形绘制
      var printedCount = resolvePrintedGraphemeCount(
        block.line,
        block.wordRanges,
        block.graphemes.length,
        time
      )
      var totalGraphemeCount = block.graphemes.length

      context.save()
      context.font = buildCanvasFont(block, theme)
      context.textAlign = 'left'
      context.textBaseline = 'middle'

      var isLineActive = time >= block.line.startTime && time <= linePassCutoffTime
      if (isLineActive) {
        // 整行底光（打印进度包络）
        var lineProgress = resolveVisualProgressWithCutoff(
          block.line.startTime,
          lineDuration,
          time,
          linePassCutoffTime
        )
        var lineGlowEnvelope = resolveDelayedGlowEnvelope(lineProgress, 0.8)
        var lineGlowAlpha = (
          (block.variant === 'hero' ? 0.16 : 0.12)
          + lineGlowEnvelope * (block.variant === 'hero' ? 0.26 : 0.2)
        ) * glowIntensity
        var lineGlowBlur = (
          (block.variant === 'hero' ? 12 : 8)
          + lineGlowEnvelope * (block.fontPx * (block.variant === 'hero' ? 0.7 : 0.52))
        ) * glowIntensity
        var lineGlowColor = ColorMix.colorWithAlpha(theme.accentColor, lineGlowAlpha)

        context.save()
        context.fillStyle = lineGlowColor
        context.shadowBlur = lineGlowBlur
        context.shadowColor = ColorMix.colorWithAlpha(theme.accentColor, lineGlowAlpha * 1.35)

        for (var gi = 0; gi < block.renderLines.length; gi += 1) {
          var glowRenderLine = block.renderLines[gi]
          var glowBaseX = block.x + glowRenderLine.left
          var glowBaseY = block.y + glowRenderLine.top + baselineOffset

          for (var gsi = 0; gsi < glowRenderLine.segments.length; gsi += 1) {
            var glowSegment = glowRenderLine.segments[gsi]
            if (glowSegment.text.trim().length === 0) continue
            context.fillText(glowSegment.text, glowBaseX + glowSegment.x, glowBaseY)
          }
        }

        context.restore()
      }

      for (var rli = 0; rli < block.renderLines.length; rli += 1) {
        var renderLine = block.renderLines[rli]
        var baseX = block.x + renderLine.left
        var baseY = block.y + renderLine.top + baselineOffset

        for (var si = 0; si < renderLine.segments.length; si += 1) {
          var segment = renderLine.segments[si]
          var runStart = -1
          var runFillStyle = ''
          var runShadowBlur = 0
          var runShadowColor = 'transparent'
          var runStyleKey = ''

          var flushRun = function (segmentEnd) {
            if (runStart < 0 || !runStyleKey || segmentEnd <= runStart) return

            var localStart = runStart - renderLine.start
            var localEnd = segmentEnd - renderLine.start
            var runText = renderLine.graphemes.slice(localStart, localEnd).join('')
            if (!runText || (runText.trim().length === 0 && runFillStyle === '')) {
              runStart = -1
              runStyleKey = ''
              return
            }

            context.fillStyle = runFillStyle
            context.shadowBlur = runShadowBlur
            context.shadowColor = runShadowColor
            drawRenderTextRun(
              context,
              renderLine,
              segment,
              localStart,
              localEnd,
              baseX,
              baseY
            )
            context.shadowBlur = 0
            context.shadowColor = 'transparent'
            runStart = -1
            runStyleKey = ''
          }

          for (var globalOffset = segment.start; globalOffset < segment.end; globalOffset += 1) {
            var graphemeIndex = globalOffset - renderLine.start
            var grapheme = renderLine.graphemes[graphemeIndex] || ''
            var rangeIndex = block.wordRangeIndexByOffset[globalOffset] !== undefined ? block.wordRangeIndexByOffset[globalOffset] : -1
            var range = rangeIndex >= 0 ? block.wordRanges[rangeIndex] : null
            var colorRangeIndex = block.colorRangeIndexByOffset[globalOffset] !== undefined ? block.colorRangeIndexByOffset[globalOffset] : -1
            var colorRange = colorRangeIndex >= 0 ? block.wordRanges[colorRangeIndex] : range
            var isPrinted = hasRevealCompleted || globalOffset < printedCount
            var isFrontier = printedCount > 0
              && globalOffset === printedCount
              && printedCount < totalGraphemeCount
              && !hasRevealCompleted
              && !hasPassCutoffReached

            var alpha = isPrinted
              ? activeOpacity
              : (isFrontier ? 0.82 : waitingOpacity)
            var shadowBlur = 0
            var shadowColor = 'transparent'
            var fillStyle = ColorMix.colorWithAlpha(theme.primaryColor, alpha)

            if (range) {
              var wordDuration = Math.max(range.word.endTime - range.word.startTime, 0.08)
              var wordProgress = clamp((time - range.word.startTime) / wordDuration, 0, 1)
              var glyphCount = Math.max(range.end - range.start, 1)
              var glyphIndexInRange = globalOffset - range.start
              var hasSyllables = range.word.syllables && range.word.syllables.length > 0
              var glyphTiming = hasSyllables
                ? range.graphemeTimings[Math.min(glyphIndexInRange, Math.max(range.graphemeTimings.length - 1, 0))]
                : undefined
              var glyphStartTime = glyphTiming
                ? glyphTiming.startTime
                : (range.word.startTime + (glyphIndexInRange / glyphCount) * wordDuration)
              var glyphEndTime = glyphTiming
                ? glyphTiming.endTime
                : (range.word.startTime + ((glyphIndexInRange + 1) / glyphCount) * wordDuration)
              var glyphDuration = Math.max(glyphEndTime - glyphStartTime, 0.001)
              var glyphProgress = glyphTiming
                ? clamp((time - glyphStartTime) / glyphDuration + 0.16, 0, 1)
                : clamp(wordProgress * glyphCount - glyphIndexInRange + 0.16, 0, 1)
              var easedGlyphProgress = easeOutCubic(glyphProgress)
              var activeColor = getActiveColor((colorRange || range).word.text, theme)
              var glyphTrailStart = glyphStartTime + glyphDuration * 0.18
              var colorTrailPhase = resolveVisualProgressWithCutoff(
                glyphTrailStart,
                colorTrailDuration,
                time,
                linePassCutoffTime
              )
              var colorTrailProgress = Math.pow(colorTrailPhase, 1.35)

              if (hasPassCutoffReached) {
                // 行通过后：颜色拖尾衰减为已读样式
                alpha = mix(activeOpacity, transitionPassedStyle.opacity, colorTrailProgress)
                fillStyle = ColorMix.mixColors(activeColor, theme.primaryColor, 0.18 + colorTrailProgress * 0.82, alpha)
                shadowBlur = (2 + block.fontPx * 0.1) * (1 - colorTrailProgress * 0.35) * passedGlowBase * transitionPassedStyle.glowMultiplier
                shadowColor = ColorMix.colorWithAlpha(
                  ColorMix.mixColors(activeColor, theme.primaryColor, 0.55 + colorTrailProgress * 0.45),
                  transitionPassedStyle.shadowAlphaBase + (1 - colorTrailProgress) * transitionPassedStyle.shadowAlphaTrail
                )
              } else if (time < range.word.startTime) {
                alpha = waitingOpacity
                fillStyle = ColorMix.colorWithAlpha(theme.primaryColor, alpha)
              } else if (time <= glyphTrailStart) {
                // 打印激活：向 activeColor 点亮
                alpha = mix(waitingOpacity, activeOpacity, easedGlyphProgress)
                fillStyle = ColorMix.mixColors(theme.primaryColor, activeColor, 0.22 + easedGlyphProgress * 0.78, alpha)
                shadowBlur = (4 + block.fontPx * 0.22) * easedGlyphProgress * activeGlowBoost
                shadowColor = ColorMix.colorWithAlpha(activeColor, 0.4 + easedGlyphProgress * 0.44)
              } else {
                alpha = mix(activeOpacity, transitionPassedStyle.opacity, colorTrailProgress)
                fillStyle = ColorMix.mixColors(activeColor, theme.primaryColor, 0.18 + colorTrailProgress * 0.82, alpha)
                shadowBlur = (2 + block.fontPx * 0.1) * (1 - colorTrailProgress * 0.35) * passedGlowBase * transitionPassedStyle.glowMultiplier
                shadowColor = ColorMix.colorWithAlpha(
                  ColorMix.mixColors(activeColor, theme.primaryColor, 0.55 + colorTrailProgress * 0.45),
                  transitionPassedStyle.shadowAlphaBase + (1 - colorTrailProgress) * transitionPassedStyle.shadowAlphaTrail
                )
              }

              // 打印戳记：字形落下时的发光方块
              if (showPrintStamp && grapheme.trim().length > 0) {
                var glyphWindowDuration = Math.max(wordDuration / glyphCount, 0.04)
                var activationLeadDuration = clamp(
                  Math.min(glyphWindowDuration * 0.86, lineDuration * 0.16),
                  0.055,
                  block.variant === 'hero' ? 0.2 : 0.16
                )
                var activationReleaseDuration = activationLeadDuration * 0.42
                var activationWindowStart = glyphTrailStart - activationLeadDuration
                var activationWindowEnd = glyphTrailStart + activationReleaseDuration
                var glyphAdvance = resolveSegmentGlyphAdvance(segment, globalOffset)
                var stampProgress = resolveVisualProgressWithCutoff(
                  activationWindowStart,
                  activationWindowEnd - activationWindowStart,
                  time,
                  linePassCutoffTime
                )

                if (stampProgress > 0 && stampProgress < 1) {
                  var glyphTrailPhase = resolveVisualProgressWithCutoff(
                    glyphTrailStart,
                    Math.max(activationWindowEnd - glyphTrailStart, 0.001),
                    time,
                    linePassCutoffTime
                  )
                  var isDropping = glyphTrailPhase <= 0
                  var dropProgress = isDropping
                    ? easeOutCubic(
                      resolveVisualProgressWithCutoff(
                        activationWindowStart,
                        Math.max(glyphTrailStart - activationWindowStart, 0.001),
                        time,
                        linePassCutoffTime
                      )
                    )
                    : 1
                  var fadeProgress = isDropping
                    ? 0
                    : easeInOutCubic(glyphTrailPhase)
                  var blockPulse = isDropping
                    ? mix(0.18, 1, Math.pow(dropProgress, 0.78))
                    : Math.pow(1 - fadeProgress, 1.2)
                  var glyphVisualWidth = Math.max(
                    glyphAdvance * 0.88,
                    isCJK(grapheme) ? block.fontPx * 0.56 : block.fontPx * 0.38
                  )
                  var blockCenterX = baseX + segment.x + resolveSegmentGlyphOffset(segment, globalOffset) + glyphAdvance * 0.5
                  var dropDistance = block.lineHeight * (block.variant === 'hero' ? 0.24 : 0.2)
                  var activationBlockAlpha = blockPulse * (block.variant === 'hero' ? 0.82 : 0.72)
                  var activationBlockWidth = glyphVisualWidth + block.fontPx * (block.variant === 'hero' ? 0.18 : 0.12)
                  var activationBlockHeight = block.fontPx * (block.variant === 'hero' ? 0.72 : 0.62)
                  var activationBlockY = baseY
                    - block.fontPx * 0.38
                    - mix(dropDistance, 0, dropProgress)
                  var activationBlockBlur = (8 + block.fontPx * 0.24) * blockPulse * activeGlowBoost

                  if (activationBlockWidth > 0) {
                    var blockLeft = blockCenterX - activationBlockWidth * 0.5
                    context.save()
                    context.fillStyle = ColorMix.colorWithAlpha(activeColor, activationBlockAlpha)
                    context.shadowBlur = activationBlockBlur
                    context.shadowColor = ColorMix.colorWithAlpha(activeColor, 0.56 * blockPulse)
                    context.fillRect(
                      blockLeft,
                      activationBlockY - activationBlockHeight * 0.5,
                      activationBlockWidth,
                      activationBlockHeight
                    )
                    context.restore()
                  }
                }
              }
            }

            if (alpha <= 0.002) {
              flushRun(globalOffset)
              continue
            }

            var styleKey = buildTextStyleKey(fillStyle, shadowBlur, shadowColor)
            if (runStart < 0) {
              runStart = globalOffset
              runFillStyle = fillStyle
              runShadowBlur = shadowBlur
              runShadowColor = shadowColor
              runStyleKey = styleKey
              continue
            }

            if (styleKey !== runStyleKey) {
              flushRun(globalOffset)
              runStart = globalOffset
              runFillStyle = fillStyle
              runShadowBlur = shadowBlur
              runShadowColor = shadowColor
              runStyleKey = styleKey
            }
          }

          flushRun(segment.end)
        }
      }

      context.restore()
    }

    // 字幕浮层（等价原版 VisualizerSubtitleOverlay）
    function updateSubtitleOverlay(frameState, time) {
      var runtimeState = Runtime.getRuntimeState({
        lines: currentLines,
        currentLineIndex: frameState.currentLineIndex,
        currentTime: time,
        getLineEndTime: RenderHints.getLineRenderEndTime
      })
      window.FoliaSubtitleOverlay.update({
        hostEl: host,
        showText: showText,
        activeLine: runtimeState.activeLine,
        recentCompletedLine: runtimeState.recentCompletedLine,
        nextLines: runtimeState.nextLines,
        theme: theme
      })
    }

    // ---------- 生命周期 ----------
    // 主题视觉键（静态块快照缓存失效条件，对应原版 useEffect 依赖）
    function themeStyleKeyOf(t) {
      return [
        t.name,
        t.primaryColor,
        t.secondaryColor,
        t.accentColor,
        t.fontStyle,
        t.fontFamily,
        t.fontFamilyStack ? t.fontFamilyStack.join(',') : ''
      ].join('|')
    }

    function themeStyleKey() {
      return theme ? themeStyleKeyOf(theme) : ''
    }

    function setTheme(newTheme) {
      theme = newTheme
      var key = themeStyleKey()
      if (key !== lastThemeStyleKey) {
        lastThemeStyleKey = key
        // 主题视觉字段变化：清空静态块快照缓存
        staticBlockSnapshotCache.clear()
      }
      // 重建加载卡配色（mount 时 theme 尚未到达）
      if (loaderEl) {
        while (loaderEl.firstChild) loaderEl.removeChild(loaderEl.firstChild)
        loaderEl.appendChild(buildLoaderCard())
      }
      // 主题变化影响布局缓存键（字体族/字重/名称）
      scheduleArticleBuild()
    }

    function setLines(lines) { /* 行数据经 tick 传入 */ }

    function setFontScale(scale) {
      var next = scale === undefined || scale === null ? 1 : scale
      if (next === fontScale) return
      fontScale = next
      scheduleArticleBuild()
    }

    function destroy() {
      if (buildRafId) { try { cancelAnimationFrame(buildRafId) } catch (e) { /* 忽略 */ } buildRafId = 0 }
      if (buildTimeoutId) { clearTimeout(buildTimeoutId); buildTimeoutId = 0 }
      if (resizeObserver) { resizeObserver.disconnect(); resizeObserver = null }
      if (containerEl) { containerEl.remove(); containerEl = null }
      canvasHostEl = null
      canvasEl = null
      context2d = null
      loaderEl = null
      host = null
      article = null
      currentLines = []
      lastLinesRef = null
      lastLinesHash = ''
      staticBlockSnapshotCache.clear()
      backgroundScene = null
      backgroundSceneKey = ''
      overviewCamera = null
      overviewCameraKey = ''
      cameraInitialized = false
      layoutBuildVersion = 0
      hasResolvedArticle = false
      layoutPending = false
      if (window.FoliaSubtitleOverlay) window.FoliaSubtitleOverlay.destroy()
    }

    return {
      id: 'fume',
      mount: function (hostEl) {
        mount(hostEl)
        // mount 后才有 canvas 上下文
        if (canvasEl) context2d = canvasEl.getContext('2d')
      },
      setTheme: setTheme,
      setLines: setLines,
      setFontScale: setFontScale,
      tick: tick,
      destroy: destroy
    }
  }

  window.FoliaModeFume = { create: createMode }
})()
