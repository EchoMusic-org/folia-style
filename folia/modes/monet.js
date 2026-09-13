// 莫奈模式：移植自 folia-major src/components/visualizer/monet/
//   VisualizerMonet.tsx（海报布局 / 人像封面 / 入场动画）
//   MonetLyricsRail.tsx（歌词 rail：离散 waiting/active/passed 行、逐字渐变扫过、翻译行）
//   monetLyricsModel.ts（Pretext 测量与离散 rail 状态模型）
//   monetLyricMotion.ts（绝对时间发光/填充包络 + rail 弹簧参数）
//   MonetFloatingDecor.tsx（漂浮装饰）
//   MonetPortraitImage.tsx（封面解码后交叉淡化，monetPortraitCrossfade.ts 一并入内）
//   AudioOverlay.tsx（底部 canvas 频谱覆盖层）
//   types.ts 的 DEFAULT_MONET_TUNING（内联为 MONET_TUNING 常量）
// 原版 framer-motion 的 rail 行进出场/位置动画 → FoliaAnim.animateProps / WAAPI；
// useMotionValueEvent(currentTime) → tick(frameState) 驱动；
// y/scale 双弹簧（原版独立 transform 值）拆外层(translateY)+内层(scale)两个元素合成。
// 注意：原版 monet 不渲染共享字幕层（VisualizerMonet 不在 VisualizerSubtitleOverlay 使用者之列），故本模式不接 FoliaSubtitleOverlay。
(function () {
  'use strict'

  var Anim = window.FoliaAnim
  var Runtime = window.FoliaVisualizerRuntime
  var RenderHints = window.FoliaRenderHints
  var ColorMix = window.FoliaColorMix
  var WordColoring = window.FoliaWordColoring
  var GraphemeTiming = window.FoliaGraphemeTiming

  // ================= 原版 DEFAULT_MONET_TUNING（src/types.ts）内联 =================
  var MONET_TUNING = {
    keywordColoringEnabled: true,
    showDescription: true,
    showAudioVisualization: true,
    audioStyle: 'bar',
    fontScale: 1.2,
    portraitSource: 'cover',
    portraitOffsetX: 0,
    portraitStyle: 'square',
    showPortraitDragHanger: true
  }

  // ================= monetLyricsModel.ts 常量 =================
  var ROOT_FONT_PX = 16
  var VIEWPORT_WIDTH_FALLBACK_PX = 1280
  // 活动行永不截断（内容驱动盒高），该上限只为约束 rail 预留的纵向轨道高度
  var MONET_ACTIVE_TEXT_LINE_LIMIT = 14
  var MONET_INACTIVE_TEXT_LINE_LIMIT = 2
  var MONET_TRANSLATION_LINE_LIMIT = 2
  var MONET_MIN_MEASURE_WIDTH_PX = 180
  var MONET_GRAPHEME_OFFSETS_CACHE_LIMIT = 420
  var MONET_VERTICAL_METRICS_CACHE_LIMIT = 420
  var MONET_GLYPH_VERTICAL_SAFETY_PX = 2
  // 2xl（1536px）以下不缩放；之上整体放大（上限 1.16）
  var MONET_LARGE_SCREEN_MIN_PX = 1536
  var MONET_LARGE_SCREEN_FULL_PX = 2200
  var MONET_LARGE_SCREEN_MAX_SCALE = 1.16
  var MONET_RAIL_BASE_MAX_WIDTH_PX = 780
  var MONET_RAIL_BASE_MAX_HEIGHT_PX = 520
  var MONET_ROW_BASE_MAX_WIDTH_PX = 1520
  var MONET_PORTRAIT_BASE_MAX_PX = 430
  var MONET_PORTRAIT_INNER_BASE_MAX_PX = 380

  // ================= MonetLyricsRail.tsx 常量 =================
  var MONET_RAIL_WIDTH_FALLBACK_PX = 680
  var MONET_RAIL_HEIGHT_FALLBACK_PX = 340
  var MONET_ACTIVE_GAP_PX = 18
  var MONET_INACTIVE_GAP_PX = 14
  // 行间距比例按默认 36.5px 歌词字号还原固定间隙；超出后随字号增长
  var MONET_RAIL_MIN_ROWS = 7
  var MONET_ACTIVE_GAP_RATIO = 0.49
  var MONET_INACTIVE_GAP_RATIO = 0.38
  var MONET_SCROLL_IDLE_RESET_MS = 1800
  var MONET_SCROLL_STEP_PX = 72
  var MONET_TOUCH_STEP_PX = 52
  var MONET_SCROLL_BEFORE = 4
  var MONET_SCROLL_AFTER = 4
  var MONET_LAYOUT_CACHE_LIMIT = 240
  // 原版 MONET_SCROLL_TRANSITION：y/scale 用弹簧，opacity/filter 用 tween
  var MONET_SCROLL_EASE = [0.32, 0.72, 0, 1]

  // ================= monetLyricMotion.ts 弹簧参数 =================
  var MONET_SCROLL_SPRING = { stiffness: 142, damping: 28, mass: 0.82 }
  var MONET_SCALE_SPRING = { stiffness: 150, damping: 30, mass: 0.78 }

  // ================= monetPortraitCrossfade.ts =================
  var MONET_PORTRAIT_FADE_MS = 900
  var MONET_PORTRAIT_MAX_LAYERS = 4

  // ================= AudioOverlay.tsx =================
  var BAR_COUNT = 72
  var MIN_RAW_SPECTRUM_BIN = 6

  // ================= MonetFloatingDecor.tsx =================
  var PARTICLE_COUNT = 10

  // 通用小工具
  function clamp(value, min, max) { return Math.min(max, Math.max(min, value)) }

  // ============================================================
  // monetLyricMotion.ts：绝对时间包络（rail 与 GPU 歌词共用，此处 rail 用）
  // ============================================================
  function clampMonetProgress(value) { return Math.min(1, Math.max(0, value)) }

  // 发光包络：上升段 Smoothstep 到峰值，衰退段 Smoothstep（先驻留后平滑消失）
  function resolveMonetGlow(time, start, end, lineEnd) {
    if (time <= start) return 0
    var rise = Math.max(0.001, end - start) * 1.18
    var peak = start + rise
    var tail = Math.max(lineEnd, end + 1.05)
    if (time <= peak) {
      var progress = clampMonetProgress((time - start) / rise)
      return progress * progress * (3 - 2 * progress)
    }
    var remaining = 1 - clampMonetProgress((time - peak) / Math.max(0.18, tail - peak))
    return remaining * remaining * (3 - 2 * remaining)
  }

  // 插值测量好的字形位置（含未计时字形的等比回退），让填充边缘逐字扫过
  function resolveMonetFillWidth(time, start, end, offsets, timings) {
    var width = offsets.length > 0 ? offsets[offsets.length - 1] : 0
    if (time <= start) return 0
    if (time >= end) return width
    var count = Math.min(timings.length, offsets.length - 1)
    if (count > 0) {
      for (var i = 0; i < count; i += 1) {
        var timing = timings[i]
        var timingStart = Math.max(start, timing.startTime)
        var timingEnd = Math.max(timingStart, timing.endTime)
        if (time < timingStart) return offsets[i]
        if (time <= timingEnd) {
          var progress = (time - timingStart) / Math.max(0.001, timingEnd - timingStart)
          return offsets[i] + (offsets[i + 1] - offsets[i]) * progress
        }
      }
      return offsets[count] !== undefined ? offsets[count] : width
    }
    var index = clampMonetProgress((time - start) / Math.max(0.001, end - start)) * (offsets.length - 1)
    var whole = Math.floor(index)
    var lower = whole < offsets.length ? offsets[whole] : width
    var upper = (whole + 1) < offsets.length ? offsets[whole + 1] : width
    return lower + (upper - lower) * (index - whole)
  }

  // ============================================================
  // monetLyricsModel.ts：测量与离散 rail 状态模型
  // ============================================================
  var monetGraphemeOffsetsCache = new Map()
  var monetVerticalMetricsCache = new Map()
  var monetVerticalMeasureContext = null
  var graphemeSegmenter = typeof Intl !== 'undefined' && Intl.Segmenter
    ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    : null

  function splitMonetGraphemes(text) {
    if (!text) return []
    if (graphemeSegmenter) {
      var out = []
      var iter = graphemeSegmenter.segment(text)[Symbol.iterator]()
      var res = iter.next()
      while (!res.done) { out.push(res.value.segment); res = iter.next() }
      return out
    }
    return Array.from(text)
  }

  // 2xl 以上整体放大；优先取容器宽度（内嵌预览不按整屏放大）
  function resolveMonetLargeScreenScale(containerWidthPx) {
    var referenceWidth = containerWidthPx && containerWidthPx > 0
      ? containerWidthPx
      : (typeof window !== 'undefined' ? window.innerWidth : VIEWPORT_WIDTH_FALLBACK_PX)
    if (referenceWidth <= MONET_LARGE_SCREEN_MIN_PX) return 1
    var progress = Math.min(1, (referenceWidth - MONET_LARGE_SCREEN_MIN_PX) / (MONET_LARGE_SCREEN_FULL_PX - MONET_LARGE_SCREEN_MIN_PX))
    return 1 + (MONET_LARGE_SCREEN_MAX_SCALE - 1) * progress
  }

  // 原版 clamp(minRem*16, vw*preferred, maxRem*16)
  function resolveClampFontPx(minRem, preferredVw, maxRem) {
    var viewportWidth = typeof window !== 'undefined' ? window.innerWidth : VIEWPORT_WIDTH_FALLBACK_PX
    return Math.min(maxRem * ROOT_FONT_PX, Math.max(minRem * ROOT_FONT_PX, viewportWidth * (preferredVw / 100)))
  }

  function getMonetVerticalMeasureContext() {
    if (monetVerticalMeasureContext) return monetVerticalMeasureContext
    if (typeof OffscreenCanvas !== 'undefined') {
      monetVerticalMeasureContext = new OffscreenCanvas(1, 1).getContext('2d')
      return monetVerticalMeasureContext
    }
    if (typeof document !== 'undefined') {
      monetVerticalMeasureContext = document.createElement('canvas').getContext('2d')
    }
    return monetVerticalMeasureContext
  }

  // 量测最高字形边界（含降部），保证 Monet 裁剪行盒不切字
  function measureMonetLineHeight(text, fontSpec, fontPx, defaultLineHeightPx) {
    var cacheKey = fontSpec + '|' + text
    var cached = monetVerticalMetricsCache.get(cacheKey)
    if (cached !== undefined) return cached

    var context = getMonetVerticalMeasureContext()
    if (!context) return defaultLineHeightPx

    context.font = fontSpec
    var metrics = context.measureText(text || 'Hg')
    var glyphHeightPx = metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent
    var measuredLineHeightPx = glyphHeightPx > 0
      ? Math.max(defaultLineHeightPx, Math.ceil(glyphHeightPx + MONET_GLYPH_VERTICAL_SAFETY_PX))
      : defaultLineHeightPx

    if (monetVerticalMetricsCache.size >= MONET_VERTICAL_METRICS_CACHE_LIMIT) {
      var oldestKey = monetVerticalMetricsCache.keys().next().value
      if (oldestKey) monetVerticalMetricsCache.delete(oldestKey)
    }
    monetVerticalMetricsCache.set(cacheKey, measuredLineHeightPx)
    return measuredLineHeightPx
  }

  // 丢弃全部文本测量缓存（web 字体加载前后 font 串相同，缓存不会自行过期）
  function clearMonetMeasurementCaches() {
    monetVerticalMetricsCache.clear()
    monetGraphemeOffsetsCache.clear()
    if (window.Pretext && typeof window.Pretext.clearCache === 'function') window.Pretext.clearCache()
  }

  // 单行文本宽度（Pretext 优先，缺失时 canvas measureText 回退）
  function measureTextWidthAtPx(text, fontPx, fontSpec) {
    var pretext = window.Pretext
    if (pretext && typeof pretext.prepareWithSegments === 'function' && typeof pretext.layoutWithLines === 'function') {
      var prepared = pretext.prepareWithSegments(text || ' ', fontSpec)
      var layout = pretext.layoutWithLines(prepared, 99999, fontPx * 1.2)
      return layout.lines && layout.lines[0] && layout.lines[0].width !== undefined
        ? layout.lines[0].width
        : Math.max((text || ' ').length, 1) * fontPx * 0.6
    }
    var context = getMonetVerticalMeasureContext()
    if (!context) return Math.max((text || ' ').length, 1) * fontPx * 0.6
    context.font = fontSpec
    return context.measureText(text || ' ').width
  }

  function buildGraphemeOffsetsCacheKey(text, fontPx, fontSpec) {
    return fontPx + '|' + fontSpec + '|' + text
  }

  function rememberGraphemeOffsets(key, offsets) {
    if (monetGraphemeOffsetsCache.size >= MONET_GRAPHEME_OFFSETS_CACHE_LIMIT) {
      var oldestKey = monetGraphemeOffsetsCache.keys().next().value
      if (oldestKey) monetGraphemeOffsetsCache.delete(oldestKey)
    }
    monetGraphemeOffsetsCache.set(key, offsets)
    return offsets
  }

  // 累计字形偏移，让填充边缘逐字扫过而不是整词跳变
  function measureMonetGraphemeOffsets(text, fontPx, fontSpec) {
    var cacheKey = buildGraphemeOffsetsCacheKey(text, fontPx, fontSpec)
    var cached = monetGraphemeOffsetsCache.get(cacheKey)
    if (cached) return cached

    var graphemes = splitMonetGraphemes(text)
    var offsets = new Array(graphemes.length + 1)
    offsets[0] = 0
    for (var index = 1; index <= graphemes.length; index += 1) {
      offsets[index] = measureTextWidthAtPx(graphemes.slice(0, index).join(''), fontPx, fontSpec)
    }
    return rememberGraphemeOffsets(cacheKey, offsets)
  }

  // 扫过掩膜边缘软化：短 CJK token 也能连续交接
  function resolveMonetSweepEdgeSoftness(fontPx) {
    return Math.max(Math.min(fontPx * 0.45, 16), 6)
  }

  // 前沿外扩，让软化尾缘在词结束时刻完全离开文本
  function resolveMonetSweepEnd(filledWidthPx, fullWidthPx, edgeSoftnessPx) {
    if (fullWidthPx <= 0) return 0
    var progress = Math.min(1, Math.max(0, filledWidthPx / fullWidthPx))
    return filledWidthPx + edgeSoftnessPx * progress
  }

  function resolveMonetLineStatus(line, index, activeIndex, currentTime) {
    if (index === activeIndex || (activeIndex < 0 && currentTime >= line.startTime && currentTime <= line.endTime)) {
      return 'active'
    }
    if (currentTime > line.endTime || (activeIndex >= 0 && index < activeIndex)) {
      return 'passed'
    }
    return 'waiting'
  }

  function resolveMonetWordStatus(currentTime, startTime, endTime) {
    if (currentTime < startTime) return 'waiting'
    if (currentTime <= endTime) return 'active'
    return 'passed'
  }

  // 稳定的展示 token 列表：让 fullText 中的标点与空格包在计时词周围
  function buildMonetDisplayTokens(line) {
    if (!line.words || line.words.length === 0) {
      return [{
        text: line.fullText,
        startTime: line.startTime,
        endTime: RenderHints.getLineRenderEndTime(line),
        key: line.startTime + '-full',
        timed: true,
        startOffset: 0,
        endOffset: line.fullText.length,
        graphemeTimings: GraphemeTiming.buildLineGraphemeTimeline(line)
      }]
    }

    var tokens = []
    var cursor = 0
    line.words.forEach(function (word, index) {
      var matchIndex = line.fullText.indexOf(word.text, cursor)
      if (matchIndex < 0) return

      if (matchIndex > cursor) {
        tokens.push({
          text: line.fullText.slice(cursor, matchIndex),
          startTime: null,
          endTime: null,
          key: line.startTime + '-static-' + cursor,
          timed: false,
          startOffset: cursor,
          endOffset: matchIndex,
          graphemeTimings: []
        })
      }

      var endOffset = matchIndex + word.text.length
      tokens.push({
        text: word.text,
        startTime: word.startTime,
        endTime: word.endTime,
        key: line.startTime + '-' + index + '-' + word.startTime,
        timed: true,
        startOffset: matchIndex,
        endOffset: endOffset,
        graphemeTimings: GraphemeTiming.buildWordGraphemeTimings(word)
      })

      cursor = endOffset
    })

    if (cursor < line.fullText.length) {
      tokens.push({
        text: line.fullText.slice(cursor),
        startTime: null,
        endTime: null,
        key: line.startTime + '-tail-' + cursor,
        timed: false,
        startOffset: cursor,
        endOffset: line.fullText.length,
        graphemeTimings: []
      })
    }

    if (tokens.length > 0) return tokens
    return [{
      text: line.fullText,
      startTime: line.startTime,
      endTime: RenderHints.getLineRenderEndTime(line),
      key: line.startTime + '-fallback-full',
      timed: true,
      startOffset: 0,
      endOffset: line.fullText.length,
      graphemeTimings: GraphemeTiming.buildLineGraphemeTimeline(line)
    }]
  }

  function findLineIndex(lines, target) {
    if (!target) return -1
    var directIndex = lines.indexOf(target)
    if (directIndex >= 0) return directIndex
    return lines.findIndex(function (line) {
      return line.startTime === target.startTime && line.fullText === target.fullText
    })
  }

  // 选取小窗口歌词并为每个 rail 项指定 waiting/active/passed 状态
  function buildMonetVisibleLineEntries(options) {
    var lines = options.lines
    var currentLineIndex = options.currentLineIndex
    var activeLine = options.activeLine
    var recentCompletedLine = options.recentCompletedLine
    var upcomingLine = options.upcomingLine
    var currentTime = options.currentTime
    var before = options.before === undefined ? 2 : options.before
    var after = options.after === undefined ? 2 : options.after

    if (lines.length === 0) return []

    var activeIndex = activeLine
      ? (currentLineIndex >= 0 ? currentLineIndex : findLineIndex(lines, activeLine))
      : -1
    var upcomingIndex = findLineIndex(lines, upcomingLine)
    var recentIndex = findLineIndex(lines, recentCompletedLine)
    var anchorIndex = activeIndex >= 0
      ? activeIndex
      : upcomingIndex >= 0 ? upcomingIndex : recentIndex

    if (anchorIndex < 0) return []

    var startIndex = Math.max(0, anchorIndex - before)
    var endIndex = Math.min(lines.length - 1, anchorIndex + after)
    var entries = []

    for (var index = startIndex; index <= endIndex; index += 1) {
      var line = lines[index]
      entries.push({
        key: index + '-' + line.startTime + '-' + line.fullText,
        line: line,
        index: index,
        offset: index - anchorIndex,
        status: resolveMonetLineStatus(line, index, activeIndex, currentTime)
      })
    }

    return entries
  }

  // Pretext 缺失时的 canvas 回退：把 untimed token 拆成词/空白原子片，贪心折行
  function splitBreakablePieces(text) {
    var pieces = text.match(/\s+|\S+/g)
    return pieces || (text.length ? [text] : [])
  }

  // Pretext 缺失时的 canvas 回退：按字形贪心折行
  function measureTextLineCountFallback(text, fontSpec, maxWidthPx) {
    var context = getMonetVerticalMeasureContext()
    if (!context) return 1
    context.font = fontSpec
    var maxWidth = Math.max(maxWidthPx, MONET_MIN_MEASURE_WIDTH_PX)
    var graphemes = splitMonetGraphemes(text || ' ')
    var lineCount = 1
    var cursorX = 0
    for (var i = 0; i < graphemes.length; i += 1) {
      var w = context.measureText(graphemes[i]).width
      if (cursorX > 0 && cursorX + w > maxWidth) { lineCount += 1; cursorX = 0 }
      cursorX += w
    }
    return Math.max(lineCount, 1)
  }

  // 量测 rail 实际渲染的折行数与最宽行。
  // 计时词渲染为 inline-block（见扫过层），浏览器只在 token 之间断行；
  // 用 rich-inline 的 break:'never' 复现原子盒，预留高度与实际绘制一致。
  function measureLyricLineStats(line, fontSpec, maxWidthPx) {
    var tokens = buildMonetDisplayTokens(line)
    if (tokens.length === 0) return { lineCount: 1, maxLineWidthPx: 0 }

    var pretext = window.Pretext
    if (pretext && typeof pretext.prepareRichInline === 'function' && typeof pretext.measureRichInlineStats === 'function') {
      var items = tokens.map(function (token) {
        return { text: token.text, font: fontSpec, break: token.timed ? 'never' : 'normal' }
      })
      var stats = pretext.measureRichInlineStats(
        pretext.prepareRichInline(items),
        Math.max(maxWidthPx, MONET_MIN_MEASURE_WIDTH_PX)
      )
      return { lineCount: Math.max(stats.lineCount, 1), maxLineWidthPx: stats.maxLineWidth }
    }

    // 回退：canvas 贪心折行（计时词为原子盒，untimed 内部可断）
    var context = getMonetVerticalMeasureContext()
    if (!context) return { lineCount: 1, maxLineWidthPx: 0 }
    context.font = fontSpec
    var maxWidth = Math.max(maxWidthPx, MONET_MIN_MEASURE_WIDTH_PX)
    var lineCount = 1
    var cursorX = 0
    var maxLineWidth = 0
    tokens.forEach(function (token) {
      var pieces = token.timed ? [token.text] : splitBreakablePieces(token.text)
      pieces.forEach(function (piece) {
        var w = context.measureText(piece).width
        if (cursorX > 0 && cursorX + w > maxWidth) { lineCount += 1; cursorX = 0 }
        cursorX += w
        if (cursorX > maxLineWidth) maxLineWidth = cursorX
      })
    })
    return { lineCount: Math.max(lineCount, 1), maxLineWidthPx: maxLineWidth }
  }

  // 普通文本折行数（翻译行）
  function measureTextLineCount(text, fontSpec, maxWidthPx, lineHeightPx) {
    var pretext = window.Pretext
    if (pretext && typeof pretext.prepareWithSegments === 'function' && typeof pretext.layoutWithLines === 'function') {
      var prepared = pretext.prepareWithSegments(text || ' ', fontSpec, { whiteSpace: 'pre-wrap' })
      var layout = pretext.layoutWithLines(prepared, Math.max(maxWidthPx, MONET_MIN_MEASURE_WIDTH_PX), lineHeightPx)
      return Math.max(layout.lines ? layout.lines.length : 1, 1)
    }
    return measureTextLineCountFallback(text, fontSpec, maxWidthPx)
  }

  // 在动画前预量测 rail 要预留的文本盒（布局不进热路径）
  function measureMonetLineLayout(options) {
    var line = options.line
    var status = options.status
    var fontPx = options.fontPx
    var translationFontPx = options.translationFontPx
    var fontStack = options.fontStack
    var translationFontStack = options.translationFontStack || fontStack
    var fontWeight = options.fontWeight === undefined ? 600 : options.fontWeight
    var translationFontWeight = options.translationFontWeight === undefined ? 500 : options.translationFontWeight
    var maxWidthPx = options.maxWidthPx
    var showSubtitleTranslation = options.showSubtitleTranslation === undefined ? true : options.showSubtitleTranslation

    var fontSpec = fontWeight + ' ' + fontPx + 'px ' + fontStack
    var translationFontSpec = translationFontWeight + ' ' + translationFontPx + 'px ' + translationFontStack
    var lineHeightPx = measureMonetLineHeight(line.fullText, fontSpec, fontPx, fontPx * 1.18)
    var translationLineHeightPx = measureMonetLineHeight(line.translation || '', translationFontSpec, translationFontPx, translationFontPx * 1.28)
    var textPaddingTopPx = Math.max(fontPx * 0.16, 8)
    var textPaddingBottomPx = Math.max(fontPx * 0.34, 14)
    var translationPaddingTopPx = Math.max(translationFontPx * 0.45, 7)
    var translationPaddingBottomPx = Math.max(translationFontPx * 0.18, 5)
    var stats = measureLyricLineStats(line, fontSpec, maxWidthPx)
    var textLineCount = stats.lineCount
    var maxLineWidthPx = stats.maxLineWidthPx
    var textLimit = status === 'active' ? MONET_ACTIVE_TEXT_LINE_LIMIT : MONET_INACTIVE_TEXT_LINE_LIMIT
    var visibleTextLineCount = Math.min(textLineCount, textLimit)
    var hasActiveTranslation = showSubtitleTranslation && status === 'active' && Boolean((line.translation || '').trim())
    var rawTranslationLineCount = hasActiveTranslation
      ? measureTextLineCount(line.translation || '', translationFontSpec, maxWidthPx, translationLineHeightPx)
      : 0
    var translationLineCount = Math.min(rawTranslationLineCount, MONET_TRANSLATION_LINE_LIMIT)
    var textContentHeightPx = visibleTextLineCount * lineHeightPx
    var textHeightPx = textContentHeightPx + textPaddingTopPx + textPaddingBottomPx
    var translationContentHeightPx = translationLineCount * translationLineHeightPx
    var translationHeightPx = translationLineCount > 0
      ? translationContentHeightPx + translationPaddingTopPx + translationPaddingBottomPx
      : 0

    return {
      textLineCount: textLineCount,
      visibleTextLineCount: visibleTextLineCount,
      textHeightPx: textHeightPx,
      textContentHeightPx: textContentHeightPx,
      textPaddingTopPx: textPaddingTopPx,
      textPaddingBottomPx: textPaddingBottomPx,
      translationLineCount: translationLineCount,
      translationHeightPx: translationHeightPx,
      translationContentHeightPx: translationContentHeightPx,
      translationPaddingTopPx: translationPaddingTopPx,
      translationPaddingBottomPx: translationPaddingBottomPx,
      visualHeightPx: textHeightPx + translationHeightPx,
      lineHeightPx: lineHeightPx,
      translationLineHeightPx: translationLineHeightPx,
      isTextClipped: textLineCount > visibleTextLineCount,
      // 宽于列宽的 token（长复合词）会超出文本盒被 overflow:hidden 切断，rail 改为把该边缘淡出
      isTextOverflowingWidth: maxLineWidthPx > maxWidthPx,
      isTranslationClipped: rawTranslationLineCount > translationLineCount
    }
  }

  function trimOldestCacheEntry(cache, limit) {
    if (cache.size < limit) return
    var oldestKey = cache.keys().next().value
    if (oldestKey) cache.delete(oldestKey)
  }

  // ============================================================
  // MonetLyricsRail.tsx：行色调 / 间距 / 定位 / 滚动手动锚点
  // ============================================================
  function resolveLineTone(entry, theme, inactiveScale) {
    if (entry.status === 'active') {
      return {
        opacity: 1,
        scale: 1,
        blurPx: 0,
        baseColor: ColorMix.colorWithAlpha(theme.primaryColor, 0.34),
        fontWeight: 600,
        zIndex: 4
      }
    }

    var distance = Math.max(Math.abs(entry.offset), 1)
    var isWaiting = entry.status === 'waiting'
    var scale = clamp(inactiveScale * Math.pow(0.9, distance - 1), 0.68, 0.92)

    return {
      opacity: isWaiting
        ? clamp(0.72 - (distance - 1) * 0.18, 0.36, 0.72)
        : clamp(0.52 - (distance - 1) * 0.12, 0.28, 0.52),
      scale: scale,
      blurPx: isWaiting
        ? (distance === 1 ? 0.7 : 1.8 + (distance - 2) * 0.8)
        : 1.1 + (distance - 1) * 0.7,
      baseColor: ColorMix.colorWithAlpha(theme.primaryColor, isWaiting ? 0.46 : 0.36),
      fontWeight: 500,
      zIndex: isWaiting ? 3 - distance : 2 - distance
    }
  }

  function resolveLineGap(previous, next, lyricFontPx) {
    return previous.status === 'active' || next.status === 'active'
      ? Math.max(MONET_ACTIVE_GAP_PX, lyricFontPx * MONET_ACTIVE_GAP_RATIO)
      : Math.max(MONET_INACTIVE_GAP_PX, lyricFontPx * MONET_INACTIVE_GAP_RATIO)
  }

  function resolveRailLineStatus(lineIndex, activeLineIndex) {
    if (lineIndex === activeLineIndex) return 'active'
    if (activeLineIndex >= 0 && lineIndex < activeLineIndex) return 'passed'
    return 'waiting'
  }

  // 手动滚动（滚轮/触摸）：以锚点为中心取 ±4 行窗口
  function buildScrollableRailEntries(lines, anchorIndex, activeLineIndex) {
    if (lines.length === 0) return []

    var safeAnchorIndex = Math.round(clamp(anchorIndex, 0, lines.length - 1))
    var startIndex = Math.max(0, safeAnchorIndex - MONET_SCROLL_BEFORE)
    var endIndex = Math.min(lines.length - 1, safeAnchorIndex + MONET_SCROLL_AFTER)
    var nextEntries = []

    for (var index = startIndex; index <= endIndex; index += 1) {
      var line = lines[index]
      nextEntries.push({
        key: index + '-' + line.startTime + '-' + line.fullText,
        line: line,
        index: index,
        offset: index - safeAnchorIndex,
        status: resolveRailLineStatus(index, activeLineIndex)
      })
    }

    return nextEntries
  }

  // 量测 + 定位：锚点行中心对齐 rail 高度 46% 处，上下按间距排开
  function buildPositionedEntries(entries, railSize, theme, lyricFontPx, inactiveFontPx, translationFontPx, fontStack, translationFontStack, fontWeight, translationFontWeight, glowBufferPx, showSubtitleTranslation, layoutCache, getOrMeasureLayout) {
    var railWidth = railSize.width || MONET_RAIL_WIDTH_FALLBACK_PX
    var railHeight = railSize.height || MONET_RAIL_HEIGHT_FALLBACK_PX
    var inactiveScale = clamp(inactiveFontPx / Math.max(lyricFontPx, 1), 0.72, 0.92)
    var contentWidthPx = Math.max(railWidth - glowBufferPx * 2, 0)

    var measuredEntries = entries.map(function (entry) {
      var tone = resolveLineTone(entry, theme, inactiveScale)
      tone.fontWeight = fontWeight
      var layout = getOrMeasureLayout(
        entry,
        lyricFontPx,
        translationFontPx,
        fontStack,
        translationFontStack,
        fontWeight,
        translationFontWeight,
        contentWidthPx - 8,
        showSubtitleTranslation
      )

      return {
        key: entry.key,
        line: entry.line,
        index: entry.index,
        offset: entry.offset,
        status: entry.status,
        y: 0,
        tone: tone,
        layout: layout,
        scaledHeight: layout.visualHeightPx * tone.scale
      }
    })

    if (measuredEntries.length === 0) return []

    var anchorIndex = Math.max(0, measuredEntries.findIndex(function (entry) { return entry.offset === 0 }))
    var focusCenterY = railHeight * 0.46
    measuredEntries[anchorIndex].y = focusCenterY - measuredEntries[anchorIndex].scaledHeight / 2

    for (var index = anchorIndex + 1; index < measuredEntries.length; index += 1) {
      var previous = measuredEntries[index - 1]
      var current = measuredEntries[index]
      current.y = previous.y + previous.scaledHeight + resolveLineGap(previous, current, lyricFontPx)
    }

    for (var reverse = anchorIndex - 1; reverse >= 0; reverse -= 1) {
      var cur = measuredEntries[reverse]
      var next = measuredEntries[reverse + 1]
      cur.y = next.y - cur.scaledHeight - resolveLineGap(cur, next, lyricFontPx)
    }

    return measuredEntries
  }

  // ---------- 掩膜辅助 ----------
  function getLineMask(isClipped, fadePx) {
    return isClipped
      ? 'linear-gradient(180deg, black 0%, black calc(100% - ' + fadePx + 'px), transparent 100%)'
      : null
  }

  // 在最后一个可见文本行处截断（而非盒边缘），避免截断行叠到相邻歌词上
  function getClippedTextMask(isClipped, contentBottomPx, fadePx) {
    if (!isClipped) return null
    var solidEndPx = Math.max(contentBottomPx - fadePx, 0)
    return 'linear-gradient(180deg, black 0px, black ' + solidEndPx + 'px, transparent ' + contentBottomPx + 'px)'
  }

  // 右缘软化：超宽 token 淡出而非切成半个字形
  function getEdgeFadeMask(isOverflowing, fadePx) {
    return isOverflowing
      ? 'linear-gradient(90deg, black 0%, black calc(100% - ' + fadePx + 'px), transparent 100%)'
      : null
  }

  // 纵向裁剪淡出与横向边缘淡出取交集（多掩膜时 mask-composite: intersect）
  function composeLineMasks(masks) {
    var layers = []
    masks.forEach(function (mask) { if (mask) layers.push(mask) })
    if (layers.length === 0) return null

    return {
      webkitMaskImage: layers.join(', '),
      maskImage: layers.join(', '),
      webkitMaskRepeat: 'no-repeat',
      maskRepeat: 'no-repeat',
      webkitMaskSize: '100% 100%',
      maskSize: '100% 100%',
      webkitMaskComposite: layers.length > 1 ? 'source-in' : undefined,
      maskComposite: layers.length > 1 ? 'intersect' : undefined
    }
  }

  var MASK_PROPS = [
    ['webkitMaskImage', '-webkit-mask-image'], ['maskImage', 'mask-image'],
    ['webkitMaskRepeat', '-webkit-mask-repeat'], ['maskRepeat', 'mask-repeat'],
    ['webkitMaskSize', '-webkit-mask-size'], ['maskSize', 'mask-size'],
    ['webkitMaskComposite', '-webkit-mask-composite'], ['maskComposite', 'mask-composite']
  ]

  function applyMaskStyle(el, mask) {
    if (!el) return
    MASK_PROPS.forEach(function (pair) {
      var value = mask ? mask[pair[0]] : undefined
      if (value === undefined || value === null) el.style.removeProperty(pair[1])
      else el.style[pair[0]] = value
    })
  }

  // ============================================================
  // AudioOverlay.tsx：频谱采样（本插件 frameState 无原始 spectrum 数组，
  // 恒走五频段包络分支；sampleRawSpectrumProfile 保留以对齐原版结构）
  // ============================================================
  function buildSpectrumAnchors(bands) {
    var bass = bands[0]
    var lowMid = bands[1]
    var mid = bands[2]
    var vocal = bands[3]
    var treble = bands[4]
    return [
      bass * 1.08,
      bass * 0.96,
      bass * 0.74 + lowMid * 0.26,
      lowMid,
      lowMid * 0.58 + mid * 0.42,
      mid,
      mid * 0.42 + vocal * 0.58,
      vocal,
      vocal * 0.48 + treble * 0.52,
      treble,
      treble * 0.82
    ].map(function (value) { return Math.max(0, Math.min(1, value)) })
  }

  function sampleSpectrumProfile(bands, normalizedIndex) {
    var clampedIndex = Math.max(0, Math.min(1, normalizedIndex))
    var anchors = buildSpectrumAnchors(bands)
    var logIndex = Math.log10(1 + clampedIndex * 9)
    var scaledIndex = logIndex * (anchors.length - 1)
    var lowerIndex = Math.floor(scaledIndex)
    var upperIndex = Math.min(lowerIndex + 1, anchors.length - 1)
    var interpolation = scaledIndex - lowerIndex
    var lowerValue = anchors[lowerIndex] !== undefined ? anchors[lowerIndex] : 0
    var upperValue = anchors[upperIndex] !== undefined ? anchors[upperIndex] : lowerValue
    var interpolated = lowerValue + (upperValue - lowerValue) * interpolation

    // 更饱满的轮廓，让曲线读起来像连续响应
    var contour =
      0.92 +
      Math.sin(clampedIndex * Math.PI * 3.4 - Math.PI * 0.3) * 0.08 +
      Math.sin(clampedIndex * Math.PI * 9.2 + Math.PI * 0.2) * 0.035
    return Math.max(0, Math.min(1, interpolated * contour))
  }

  function sampleRawSpectrumProfile(rawSpectrum, normalizedIndex) {
    if (!rawSpectrum || rawSpectrum.length <= MIN_RAW_SPECTRUM_BIN) return 0

    var clampedIndex = Math.max(0, Math.min(1, normalizedIndex))
    var usableBinCount = Math.max(1, rawSpectrum.length - MIN_RAW_SPECTRUM_BIN)
    var mappedIndex = Math.expm1(clampedIndex * Math.log(usableBinCount + 1))
    var centerIndex = MIN_RAW_SPECTRUM_BIN + mappedIndex
    var edgeSoftness = 1 - Math.abs(clampedIndex - 0.5) * 2
    var windowRadius = Math.max(1, Math.round(5 - edgeSoftness * 3))
    var start = Math.max(MIN_RAW_SPECTRUM_BIN, Math.floor(centerIndex - windowRadius))
    var end = Math.min(rawSpectrum.length - 1, Math.ceil(centerIndex + windowRadius))

    var weightedSum = 0
    var weightTotal = 0
    for (var index = start; index <= end; index += 1) {
      var distance = Math.abs(index - centerIndex)
      var weight = Math.max(0.1, 1 - distance / (windowRadius + 1))
      weightedSum += rawSpectrum[index] * weight
      weightTotal += weight
    }

    var averaged = weightTotal > 0 ? weightedSum / weightTotal : 0
    // 按频率动态噪底（低频减更多噪）
    var noiseFloor = 16 + (1 - clampedIndex) * 12
    var normalized = Math.max(0, Math.min(1, (averaged - noiseFloor) / (255 - noiseFloor)))
    // 幂压缩压低安静基线、拉高视觉峰值对比
    var power = 1.8 + (1 - clampedIndex) * 0.4
    var processed = Math.pow(normalized, power)
    var lowFrequencyCompensation = 0.52 + clampedIndex * 0.62
    var presenceLift = 0.92 + Math.sqrt(clampedIndex) * 0.14
    return Math.max(0, Math.min(1, processed * lowFrequencyCompensation * presenceLift))
  }

  // ============================================================
  // MonetFloatingDecor.tsx：以可用图标列表为种子的稳定漂浮粒子
  // ============================================================
  function buildParticles(availableIcons) {
    var out = []
    for (var i = 0; i < PARTICLE_COUNT; i += 1) {
      var useIcon = availableIcons.length > 0 && ((i * 37 + 11) % 100) > 20
      out.push({
        id: i,
        x: ((i * 127 + 43) % 80) + 10,
        y: ((i * 211 + 17) % 80) + 5,
        size: 46 + ((i * 53) % 40),
        rotation: (i * 97) % 360,
        duration: 20 + ((i * 71) % 20),
        delay: ((i * 41) % 80) / 10,
        opacity: 0.06 + ((i * 31) % 12) / 100,
        iconName: useIcon ? availableIcons[i % availableIcons.length] : null,
        reverse: i % 2 === 0
      })
    }
    return out
  }

  // ============================================================
  // 模式工厂
  // ============================================================
  function createMode() {
    var host = null
    var styleEl = null
    var rootEl = null
    var decorLayer = null
    var decorFade = null
    var mainContent = null
    var rowEl = null
    var leftCol = null
    var headerEl = null
    var artistEl = null
    var dividerEl = null
    var titleBlock = null
    var titleEl = null
    var albumEl = null
    var railWrap = null
    var railEl = null
    var descWrap = null
    var capsuleEl = null
    var capsuleDotEl = null
    var capsuleLabelEl = null
    var portraitCol = null
    var boundWrap = null
    var dragWrap = null
    var floatWrap = null
    var hangerEl = null
    var coverBoxEl = null
    var coverInnerEl = null
    var portraitStack = null
    var audioWrap = null
    var audioCanvas = null
    var audioContext = null

    var theme = null
    var subtitleFontScale = 1
    var showText = true
    var introPlayed = false
    var portraitIntroPlayed = false
    var lastTime = 0
    var prevSongIdentifier = null
    var lastShowText = null
    var dividerAnim = null
    var floatAnim = null

    // ---------- rail 状态 ----------
    var lineNodes = new Map()
    var railSize = { width: 0, height: 0 }
    var railResizeObserver = null
    var shellResizeObserver = null
    var layoutCache = new Map()
    var manualScrollAnchorIndex = null
    var manualScrollResetTimer = null
    var wheelAccumulator = 0
    var wheelDirection = 0
    var touchLastY = null
    var touchAccumulator = 0
    var touchDirection = 0
    var fontsEpoch = 0
    var handledFontsEpoch = 0
    var fontsLoadingDoneSeen = false
    var wordColorMatchers = []
    var glowBufferPx = 0
    var vGlowBufferPx = 0
    var lyricFontPx = 0
    var inactiveFontPx = 0
    var translationFontPx = 0
    var largeScreenScale = 1
    var shellWidth = 0
    var firstRailPaint = true
    var lastRailStyleKey = ''
    var lastFontStack = null
    var lastLines = []
    var lastCurrentLineIndex = -1
    var lastVisibleEntries = []
    var lastPosterText = { title: null, artist: null, album: null, capsule: null }
    var lastSizesKey = ''
    var exitTimers = []

    // ---------- 封面交叉淡化状态 ----------
    var portraitLayers = []
    var portraitLayerKey = 0
    var portraitRequestId = 0
    var portraitTargetOpacity = 1
    var portraitSettleTimer = null

    // ---------- 频谱 canvas 状态 ----------
    var audioFrameId = 0
    var audioCssWidth = 0
    var audioCssHeight = 0
    var audioState = { power: 0, bass: 0, lowMid: 0, mid: 0, vocal: 0, treble: 0 }

    // 本插件无行点击 seek 回调（宿主接口没有），恒 false；保留分支结构
    var canSeek = false
    // 副歌词开关：宿主已把翻译/罗马音写入 line.translation，恒显示
    var showSubtitleTranslation = true

    var listeners = []

    function addListener(target, type, handler, options) {
      target.addEventListener(type, handler, options)
      listeners.push({ target: target, type: type, handler: handler, options: options })
    }

    // ---------- 字体 ----------
    function lyricFontFamily() {
      return window.foliaGetLyricFontFamily
        ? window.foliaGetLyricFontFamily()
        : (theme && theme.fontFamily) || 'sans-serif'
    }

    // 原版 resolveThemeFontWeight：fontWeight 归一到 10 的倍数，否则用回退
    function resolveThemeFontWeight(sourceTheme, fallback) {
      var weight = sourceTheme && typeof sourceTheme.fontWeight === 'number' && Number.isFinite(sourceTheme.fontWeight)
        ? Math.round(Math.min(900, Math.max(100, sourceTheme.fontWeight)) / 10) * 10
        : null
      return weight === null ? fallback : weight
    }

    function lyricFontWeight() { return resolveThemeFontWeight(theme, 600) }
    function translationFontWeight() { return resolveThemeFontWeight(theme, 500) }
    // 本插件无独立字幕主题，翻译字体栈与歌词一致（原版取 subtitleTheme ?? theme）
    function translationFontFamily() { return lyricFontFamily() }

    // ============================================================
    // 挂载：一次性创建全部 DOM 层
    // ============================================================
    function mount(hostEl) {
      host = hostEl

      // 响应式断点（对应 Tailwind sm/md/lg/xl/2xl）
      styleEl = document.createElement('style')
      styleEl.textContent = [
        '.folia-monet-left-col{padding:1.25rem}',
        '.folia-monet-portrait-col{display:none;padding-left:0.75rem;padding-right:1.25rem;align-items:center;justify-content:center}',
        '.folia-monet-audio{padding-left:1.25rem;padding-right:1.25rem}',
        '@media (min-width:640px){',
        '.folia-monet-left-col{padding:1.5rem 2rem}',
        '.folia-monet-portrait-col{padding-right:2rem}',
        '.folia-monet-audio{padding-left:2rem;padding-right:2rem}',
        '}',
        '@media (min-width:768px){.folia-monet-portrait-col{display:flex}}',
        '@media (min-width:1024px){',
        '.folia-monet-left-col{padding:2rem 3.5rem}',
        '.folia-monet-portrait-col{justify-content:flex-end;padding-right:2.5rem}',
        '.folia-monet-audio{padding-left:3.5rem;padding-right:3.5rem}',
        '}',
        '@media (min-width:1280px){.folia-monet-portrait-col{padding-right:3rem}}',
        '@media (min-width:1536px){.folia-monet-left-col{padding:2rem 5rem}}'
      ].join('')
      document.head.appendChild(styleEl)

      rootEl = document.createElement('div')
      rootEl.className = 'folia-mode-monet'
      rootEl.style.cssText = 'position:absolute;inset:0;z-index:10;pointer-events:none'

      // ---- 漂浮装饰层（原版 MonetFloatingDecor，z-[5]）----
      decorLayer = document.createElement('div')
      decorLayer.style.cssText = 'position:absolute;inset:0;z-index:5;overflow:hidden;pointer-events:none'
      decorFade = document.createElement('div')
      decorFade.style.cssText = 'position:absolute;inset:0;opacity:0'
      decorLayer.appendChild(decorFade)
      rootEl.appendChild(decorLayer)

      // ---- 主内容（海报左列 + 人像右列）----
      mainContent = document.createElement('div')
      mainContent.style.cssText = 'position:absolute;inset:0;z-index:10;display:flex;align-items:center;justify-content:center;overflow:hidden'

      rowEl = document.createElement('div')
      rowEl.style.cssText = 'display:flex;flex-direction:row;align-items:center;width:100%;height:100%;overflow:hidden'
      mainContent.appendChild(rowEl)

      // 左列（海报文本列）
      leftCol = document.createElement('div')
      leftCol.className = 'folia-monet-left-col'
      leftCol.style.cssText = 'display:flex;min-height:0;min-width:0;flex:1 1 0%;flex-direction:column;justify-content:center'

      // 头部：歌手 + 竖线（space-y-1.5 → 第二个子项 margin-top 0.375rem）
      headerEl = document.createElement('div')
      headerEl.style.cssText = 'margin-bottom:0.75rem'
      artistEl = document.createElement('div')
      artistEl.style.cssText = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-style:italic;letter-spacing:0;opacity:0;transform:translate(-30px, -10px)'
      dividerEl = document.createElement('div')
      dividerEl.style.cssText = 'height:3.5rem;width:1px;border-radius:9999px;margin-top:0.375rem;transform:scaleY(0);transform-origin:top'
      headerEl.appendChild(artistEl)
      headerEl.appendChild(dividerEl)
      leftCol.appendChild(headerEl)

      // 标题块（flex column 让标题的负 margin 不塌陷穿透包装层）
      titleBlock = document.createElement('div')
      titleBlock.style.cssText = 'opacity:0;transform:translate(-40px, 0px)'
      var titleInner = document.createElement('div')
      titleInner.style.cssText = 'margin-bottom:1.5rem;display:flex;flex-direction:column'
      titleEl = document.createElement('div')
      titleEl.style.cssText = [
        'display:-webkit-box', '-webkit-line-clamp:2', '-webkit-box-orient:vertical', 'overflow:hidden',
        'font-weight:600', 'line-height:1.06', 'letter-spacing:0', 'overflow-wrap:anywhere',
        'padding-top:0.25em', 'padding-bottom:0.25em', 'margin-top:-0.25em', 'margin-bottom:-0.12em'
      ].join(';')
      albumEl = document.createElement('div')
      albumEl.style.cssText = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:0.875rem;text-transform:uppercase;letter-spacing:0;margin-top:0.25rem'
      titleInner.appendChild(titleEl)
      titleInner.appendChild(albumEl)
      titleBlock.appendChild(titleInner)
      leftCol.appendChild(titleBlock)

      // 歌词 rail
      railWrap = document.createElement('div')
      railWrap.style.cssText = 'opacity:0;transform:translate(0px, 20px)'
      railEl = document.createElement('div')
      railEl.style.cssText = [
        'position:relative', 'overflow:hidden', 'touch-action:none',
        'user-select:none', '-webkit-user-select:none',
        'pointer-events:auto', '-webkit-tap-highlight-color:transparent'
      ].join(';')
      railWrap.appendChild(railEl)
      leftCol.appendChild(railWrap)

      // 描述胶囊（mt-auto pt-4 顶到底部）
      if (MONET_TUNING.showDescription) {
        descWrap = document.createElement('div')
        descWrap.style.cssText = 'margin-top:auto;padding-top:1rem;opacity:0;transform:translate(0px, 10px) scale(0.9)'
        capsuleEl = document.createElement('div')
        capsuleEl.style.cssText = [
          'display:inline-flex', 'align-items:center', 'gap:0.75rem', 'border-radius:9999px',
          'border:1px solid transparent', 'padding:0.5rem 1rem',
          'backdrop-filter:blur(12px)', '-webkit-backdrop-filter:blur(12px)',
          'width:fit-content'
        ].join(';')
        capsuleDotEl = document.createElement('span')
        capsuleDotEl.style.cssText = 'height:0.625rem;width:0.625rem;border-radius:9999px;display:inline-block'
        capsuleLabelEl = document.createElement('span')
        capsuleLabelEl.style.cssText = 'font-size:0.75rem;text-transform:uppercase;letter-spacing:0'
        capsuleEl.appendChild(capsuleDotEl)
        capsuleEl.appendChild(capsuleLabelEl)
        descWrap.appendChild(capsuleEl)
        leftCol.appendChild(descWrap)
      }
      rowEl.appendChild(leftCol)

      // 右列（人像封面，md 以下隐藏；入场动画只播一次，故意不随 introKey 重挂）
      portraitCol = document.createElement('div')
      portraitCol.className = 'folia-monet-portrait-col'
      portraitCol.style.cssText = 'min-width:0;overflow:visible;user-select:none;-webkit-user-select:none;opacity:0;transform:translate(50px, 0px) rotate(1deg) scale(0.95)'
      boundWrap = document.createElement('div')
      boundWrap.style.cssText = 'position:relative;width:100%'

      // 拖拽包装层：本插件无位置编辑模式，仅保留 portraitOffsetX（默认 0）的静态位移
      dragWrap = document.createElement('div')
      dragWrap.style.cssText = 'width:100%;position:relative;transform:translateX(' + (MONET_TUNING.portraitOffsetX || 0) + 'px)'

      // 漂浮层（chaotic 强度下整幅浮动）
      floatWrap = document.createElement('div')
      floatWrap.style.cssText = [
        'position:relative', 'will-change:transform', 'transform:translateZ(0)',
        MONET_TUNING.portraitStyle === 'square' ? 'width:135.135%;margin-left:-35.135%' : 'width:100%;margin-left:0%'
      ].join(';')

      // 挂钩 / 黑白条（位置编辑把手；本插件无编辑交互，仅保留静态装饰）
      if (MONET_TUNING.showPortraitDragHanger) {
        hangerEl = document.createElement('div')
        hangerEl.style.cssText = [
          'position:absolute', 'top:-0.75rem', 'right:2rem', 'z-index:20',
          'height:3.5rem', 'width:0.75rem', 'border-radius:9999px',
          'box-shadow:0 8px 18px rgba(0,0,0,0.24)',
          'border-width:1.5px', 'border-style:solid'
        ].join(';')
        floatWrap.appendChild(hangerEl)
      }

      // 封面框（square：直角方框；否则：拍立得卡纸）
      if (MONET_TUNING.portraitStyle === 'square') {
        coverBoxEl = document.createElement('div')
        coverBoxEl.style.cssText = [
          'position:relative', 'width:100%', 'aspect-ratio:1/1', 'overflow:hidden',
          'border-radius:2rem', 'background-position:center'
        ].join(';')
        portraitStack = document.createElement('div')
        portraitStack.style.cssText = 'position:relative;width:100%;height:100%'
        coverBoxEl.appendChild(portraitStack)
        floatWrap.appendChild(coverBoxEl)
      } else {
        coverBoxEl = document.createElement('div')
        coverBoxEl.style.cssText = [
          'position:relative', 'width:100%', 'aspect-ratio:0.74', 'padding:0.375rem',
          'border-radius:2.15rem', 'border:1px solid transparent', 'backdrop-filter:blur(4px)', '-webkit-backdrop-filter:blur(4px)'
        ].join(';')
        coverInnerEl = document.createElement('div')
        coverInnerEl.style.cssText = 'width:100%;height:100%;overflow:hidden;border-radius:1.85rem;background-position:center'
        portraitStack = document.createElement('div')
        portraitStack.style.cssText = 'position:relative;width:100%;height:100%'
        coverInnerEl.appendChild(portraitStack)
        coverBoxEl.appendChild(coverInnerEl)
        floatWrap.appendChild(coverBoxEl)
      }

      dragWrap.appendChild(floatWrap)
      boundWrap.appendChild(dragWrap)
      portraitCol.appendChild(boundWrap)
      rowEl.appendChild(portraitCol)
      rootEl.appendChild(mainContent)

      // ---- 底部频谱覆盖层 ----
      if (MONET_TUNING.showAudioVisualization) {
        audioWrap = document.createElement('div')
        audioWrap.className = 'folia-monet-audio'
        audioWrap.style.cssText = 'position:absolute;bottom:0;left:0;z-index:20;height:2.5rem;overflow:hidden;width:min(450px, 55vw);opacity:0;transform:translate(0px, 15px)'
        var audioInner = document.createElement('div')
        audioInner.style.cssText = 'height:100%;width:100%'
        audioCanvas = document.createElement('canvas')
        audioCanvas.style.cssText = 'height:100%;width:100%;display:block'
        audioInner.appendChild(audioCanvas)
        audioWrap.appendChild(audioInner)
        rootEl.appendChild(audioWrap)
      }

      host.appendChild(rootEl)

      // ---- 尺寸观察 ----
      if (typeof ResizeObserver !== 'undefined') {
        shellResizeObserver = new ResizeObserver(function () {
          shellWidth = Math.round(mainContent.clientWidth)
        })
        shellResizeObserver.observe(mainContent)
        shellWidth = Math.round(mainContent.clientWidth)

        railResizeObserver = new ResizeObserver(function () {
          var nextWidth = Math.round(railEl.clientWidth)
          var nextHeight = Math.round(railEl.clientHeight)
          if (railSize.width !== nextWidth || railSize.height !== nextHeight) {
            railSize = { width: nextWidth, height: nextHeight }
          }
        })
        railResizeObserver.observe(railEl)
        railSize = { width: Math.round(railEl.clientWidth), height: Math.round(railEl.clientHeight) }
      }

      // ---- rail 手动滚动（滚轮 / 触摸，与原版一致 passive:false）----
      addListener(railEl, 'wheel', handleRailWheel, { passive: false })
      addListener(railEl, 'touchstart', handleRailTouchStart, { passive: false })
      addListener(railEl, 'touchmove', handleRailTouchMove, { passive: false })
      addListener(railEl, 'touchend', handleRailTouchEnd, { passive: false })
      addListener(railEl, 'touchcancel', handleRailTouchEnd, { passive: false })

      // ---- 字体加载完成后失效测量缓存（原版 useFontsEpoch）----
      var fonts = typeof document !== 'undefined' ? document.fonts : null
      if (fonts && typeof fonts.addEventListener === 'function') {
        fonts.addEventListener('loadingdone', function () {
          fontsLoadingDoneSeen = true
          fontsEpoch += 1
        })
      }
      if (fonts && fonts.status !== 'loaded' && fonts.ready) {
        fonts.ready.then(function () {
          if (!fontsLoadingDoneSeen) fontsEpoch += 1
        }).catch(function () { /* 忽略 */ })
      }

      // ---- 频谱 canvas 自绘循环（原版 AudioOverlay 自持 rAF）----
      if (audioCanvas) {
        audioContext = audioCanvas.getContext('2d')
        resizeAudioCanvas()
        addListener(window, 'resize', function () {
          resizeAudioCanvas()
        })
        var audioLoop = function () {
          audioFrameId = window.requestAnimationFrame(audioLoop)
          drawAudioOverlay()
        }
        audioLoop()
      }
    }

    // ---------- 海报静态主题（颜色类） ----------
    function applyPosterTheme() {
      if (!theme) return
      artistEl.style.color = ColorMix.colorWithAlpha(theme.primaryColor, 0.96)
      dividerEl.style.background = 'linear-gradient(180deg, ' + ColorMix.colorWithAlpha(theme.primaryColor, 0.72) + ', transparent)'
      titleEl.style.color = theme.primaryColor
      titleEl.style.textShadow = '0 14px 36px ' + ColorMix.colorWithAlpha(theme.backgroundColor, 0.28)
      albumEl.style.color = ColorMix.colorWithAlpha(theme.secondaryColor, 0.84)
      if (capsuleEl) {
        capsuleEl.style.borderColor = ColorMix.colorWithAlpha(theme.primaryColor, 0.16)
        capsuleEl.style.backgroundColor = ColorMix.colorWithAlpha(theme.backgroundColor, 0.18)
        capsuleEl.style.color = ColorMix.colorWithAlpha(theme.primaryColor, 0.9)
        capsuleDotEl.style.backgroundColor = theme.accentColor
      }
      if (MONET_TUNING.portraitStyle === 'square') {
        coverBoxEl.style.boxShadow = '0 36px 80px ' + ColorMix.colorWithAlpha(theme.backgroundColor, 0.45) +
          ', 0 20px 42px ' + ColorMix.colorWithAlpha(theme.accentColor, 0.22) +
          ', 0 0 0 1px ' + ColorMix.colorWithAlpha(theme.primaryColor, 0.06)
        coverBoxEl.style.backgroundColor = ColorMix.colorWithAlpha(theme.primaryColor, 0.08)
      } else {
        coverBoxEl.style.borderColor = ColorMix.colorWithAlpha(theme.primaryColor, 0.1)
        coverBoxEl.style.backgroundColor = ColorMix.colorWithAlpha(theme.backgroundColor, 0.15)
        coverBoxEl.style.boxShadow = '0 24px 60px ' + ColorMix.colorWithAlpha(theme.backgroundColor, 0.35)
        coverInnerEl.style.backgroundColor = ColorMix.colorWithAlpha(theme.primaryColor, 0.08)
      }
      if (hangerEl) {
        hangerEl.style.backgroundColor = ColorMix.colorWithAlpha(theme.backgroundColor, 0.86)
        // 非编辑态边框透明（原版 hover 才亮起；本插件 root 无指针事件，hover 不触发）
        hangerEl.style.borderColor = ColorMix.colorWithAlpha(theme.primaryColor, 0)
      }
    }

    // ---------- 海报动态尺寸（随 largeScreenScale / 视口变化） ----------
    function applyPosterSizes() {
      var rowMaxWidthPx = Math.round(MONET_ROW_BASE_MAX_WIDTH_PX * largeScreenScale)
      var portraitMaxPx = Math.round(MONET_PORTRAIT_BASE_MAX_PX * largeScreenScale)
      var portraitInnerMaxPx = Math.round(MONET_PORTRAIT_INNER_BASE_MAX_PX * largeScreenScale)
      var titleMaxRem = (2.8 * largeScreenScale).toFixed(3)
      var artistMaxRem = (1.8 * largeScreenScale).toFixed(3)
      // 海报头部（歌手/标题/专辑）右侧必须留出的宽度：方框封面占列宽 135.135% 并左移
      // 超出 35.135%，会盖住文本列；3rem 是只吃掉两列自身 padding 的部分
      var portraitBleedCss = MONET_TUNING.portraitStyle === 'square'
        ? '0.35135 * clamp(210px, 26vw, ' + portraitInnerMaxPx + 'px) - 3rem'
        : '0px'
      var portraitShiftPx = Math.abs(Math.min(0, MONET_TUNING.portraitOffsetX || 0))
      var headerMaxWidth = 'max(12rem, calc(100% - max(0px, calc(' + portraitBleedCss + ')) - ' + portraitShiftPx + 'px))'

      var key = [rowMaxWidthPx, portraitMaxPx, portraitInnerMaxPx, titleMaxRem, artistMaxRem, headerMaxWidth].join('|')
      if (key === lastSizesKey) return
      lastSizesKey = key

      rowEl.style.maxWidth = rowMaxWidthPx + 'px'
      portraitCol.style.flex = '0 0 clamp(220px, 28vw, ' + portraitMaxPx + 'px)'
      boundWrap.style.maxWidth = 'clamp(210px, 26vw, ' + portraitInnerMaxPx + 'px)'
      headerEl.style.maxWidth = headerMaxWidth
      titleBlock.style.maxWidth = headerMaxWidth
      artistEl.style.fontSize = 'clamp(1rem, 1.8vw, ' + artistMaxRem + 'rem)'
      titleEl.style.fontSize = 'clamp(1.45rem, 3.3vw, ' + titleMaxRem + 'rem)'
    }

    // ---------- 海报文本内容 ----------
    function applyPosterText(frameState) {
      var title = frameState.songTitle || 'Monet'
      var artist = (frameState.songArtist && frameState.songArtist.trim()) || 'Monet'
      var album = (frameState.songAlbum && frameState.songAlbum.trim()) || 'Monet'
      var capsule = (theme && theme.description && theme.description.trim()) ||
        (theme && theme.name && theme.name.trim()) || 'Monet'
      if (lastPosterText.title !== title) { lastPosterText.title = title; titleEl.textContent = title }
      if (lastPosterText.artist !== artist) { lastPosterText.artist = artist; artistEl.textContent = artist }
      if (lastPosterText.album !== album) { lastPosterText.album = album; albumEl.textContent = album }
      if (capsuleLabelEl && lastPosterText.capsule !== capsule) {
        lastPosterText.capsule = capsule
        capsuleLabelEl.textContent = capsule
      }
    }

    // ============================================================
    // 入场动画（原版各 motion.div 的 initial/animate/transition）
    // ============================================================
    function playIntro() {
      if (!theme || !rootEl) return
      var posterEase = [0.25, 1, 0.5, 1]
      // 装饰层淡入（原版 decor 包装层 opacity 0→1，2.2s easeOut）
      Anim.animateProps(decorFade, { opacity: { from: 0, to: 1 } }, { duration: 2.2, ease: 'easeOut' })
      // 歌手名
      Anim.animateProps(artistEl, {
        opacity: { from: 0, to: 1 },
        transform: { from: { x: -30, y: -10 }, to: { x: 0, y: 0 } }
      }, { duration: 1.2, ease: posterEase, delay: 0.15 })
      // 竖线 scaleY 0→1（originY 0）
      if (dividerAnim) { try { dividerAnim.cancel() } catch (e) { /* 已结束忽略 */ } }
      dividerAnim = dividerEl.animate(
        [{ transform: 'scaleY(0)' }, { transform: 'scaleY(1)' }],
        { duration: 1500, delay: 500, easing: Anim.resolveEasing(posterEase), fill: 'forwards' }
      )
      if (dividerAnim.finished) dividerAnim.finished.catch(function () { /* 忽略 */ })
      // 标题块
      Anim.animateProps(titleBlock, {
        opacity: { from: 0, to: 1 },
        transform: { from: { x: -40 }, to: { x: 0 } }
      }, { duration: 1.3, ease: posterEase, delay: 0.3 })
      // rail
      Anim.animateProps(railWrap, {
        opacity: { from: 0, to: 1 },
        transform: { from: { y: 20 }, to: { y: 0 } }
      }, { duration: 1.2, ease: posterEase, delay: 0.65 })
      // 描述胶囊
      if (descWrap) {
        Anim.animateProps(descWrap, {
          opacity: { from: 0, to: 1 },
          transform: { from: { y: 10, scale: 0.9 }, to: { y: 0, scale: 1 } }
        }, { duration: 1.0, ease: posterEase, delay: 0.95 })
      }
      // 底部频谱
      if (audioWrap) {
        Anim.animateProps(audioWrap, {
          opacity: { from: 0, to: 1 },
          transform: { from: { y: 15 }, to: { y: 0 } }
        }, { duration: 1.2, ease: posterEase, delay: 0.8 })
      }
      rebuildDecor()
    }

    // 人像列入场：只在挂载时播一次（原版故意不随 introKey 重挂，避免换封面闪空帧）
    function playPortraitIntro() {
      if (portraitIntroPlayed) return
      portraitIntroPlayed = true
      Anim.animateProps(portraitCol, {
        opacity: { from: 0, to: 1 },
        transform: { from: { x: 50, scale: 0.95, rotate: 1 }, to: { x: 0, scale: 1, rotate: 0 } }
      }, { duration: 1.6, ease: [0.25, 1, 0.5, 1], delay: 0.25 })
    }

    // 人像整幅浮动：chaotic 时关键帧循环，否则回到静止（0.8s easeOut 归位）
    function applyPortraitFloat() {
      if (!floatWrap) return
      var isChaotic = theme && theme.animationIntensity === 'chaotic'
      if (isChaotic) {
        if (floatAnim) return
        floatAnim = floatWrap.animate([
          { transform: 'translate3d(0px, 0px, 0) rotate(0deg)' },
          { transform: 'translate3d(-9px, -18px, 0) rotate(1.2deg)' },
          { transform: 'translate3d(0px, 0px, 0) rotate(0deg)' },
          { transform: 'translate3d(9px, 18px, 0) rotate(-1.2deg)' },
          { transform: 'translate3d(0px, 0px, 0) rotate(0deg)' }
        ], { duration: 9000, delay: 200, iterations: Infinity, easing: 'ease-in-out', fill: 'both' })
      } else if (floatAnim) {
        try {
          var current = getComputedStyle(floatWrap).transform
          floatAnim.cancel()
          floatAnim = null
          floatWrap.animate(
            [{ transform: current && current !== 'none' ? current : 'translateZ(0)' }, { transform: 'translateZ(0)' }],
            { duration: 800, easing: 'ease-out', fill: 'forwards' }
          )
        } catch (e) {
          floatAnim = null
          floatWrap.style.transform = 'translateZ(0)'
        }
      }
    }

    function bumpIntro() {
      playIntro()
    }

    // ============================================================
    // MonetFloatingDecor：樱花花瓣兜底（本插件 theme.lyricsIcons 恒为空，
    // 无 lucide 图标解析器，图标分支保留判断但落到花瓣）
    // ============================================================
    function buildParticleContent(p, petalColor) {
      var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
      svg.setAttribute('width', String(p.size))
      svg.setAttribute('height', String(p.size))
      svg.setAttribute('viewBox', '0 0 24 24')
      svg.setAttribute('fill', 'none')
      svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
      var path1 = document.createElementNS('http://www.w3.org/2000/svg', 'path')
      path1.setAttribute('d', 'M12 3C14.5 5.5 16.8 9 16 14C15.2 19 13.5 21 12 21C10.5 21 8.8 19 8 14C7.2 9 9.5 5.5 12 3Z')
      path1.setAttribute('fill', petalColor)
      svg.appendChild(path1)
      var path2 = document.createElementNS('http://www.w3.org/2000/svg', 'path')
      path2.setAttribute('d', 'M12 6C12 6 11.3 10.5 11.3 14.5C11.3 17.5 12 20 12 20')
      path2.setAttribute('stroke', ColorMix.colorWithAlpha(petalColor, 0.35))
      path2.setAttribute('stroke-width', '0.45')
      path2.setAttribute('stroke-linecap', 'round')
      svg.appendChild(path2)
      return svg
    }

    function rebuildDecor() {
      if (!decorFade || !theme) return
      decorFade.innerHTML = ''
      var availableIcons = (theme && theme.lyricsIcons) || []
      var particles = buildParticles(availableIcons)
      var petalColor = ColorMix.colorWithAlpha(theme.secondaryColor, 0.55)

      particles.forEach(function (p) {
        var wrap = document.createElement('div')
        wrap.style.cssText = 'position:absolute;left:' + p.x + '%;top:' + p.y + '%'
        wrap.appendChild(buildParticleContent(p, petalColor))
        decorFade.appendChild(wrap)

        // 与原版 framer-motion 关键帧逐项一致（4 段插值，easeInOut，无限循环）
        var yFrames = p.reverse ? [-40, 60, -20, 40, -40] : [40, -60, 20, -40, 40]
        var xFrames = p.reverse ? [15, -25, 10, -20, 15] : [-15, 25, -10, 20, -15]
        var rotFrames = [
          p.rotation,
          p.rotation + (p.reverse ? -120 : 120),
          p.rotation + (p.reverse ? -60 : 60),
          p.rotation + (p.reverse ? -180 : 180),
          p.rotation
        ]
        var opFrames = [p.opacity * 0.6, p.opacity * 1.2, p.opacity, p.opacity * 1.3, p.opacity * 0.7]
        var keyframes = []
        for (var k = 0; k < 5; k += 1) {
          keyframes.push({
            transform: 'translate(' + xFrames[k] + 'px, ' + yFrames[k] + 'px) rotate(' + rotFrames[k] + 'deg)',
            opacity: String(opFrames[k])
          })
        }
        wrap.animate(keyframes, {
          duration: p.duration * 1000,
          delay: p.delay * 1000,
          iterations: Infinity,
          easing: 'ease-in-out',
          fill: 'both'
        })
      })
    }

    // ============================================================
    // MonetPortraitImage：封面离屏解码后整帧叠入，帧永不空；
    // 无封面时整栈淡出并保留，下一张有东西可淡入
    // ============================================================
    function animatePortraitLayer(el, targetOpacity) {
      var current = parseFloat(getComputedStyle(el).opacity)
      if (!Number.isFinite(current)) current = 0
      el.animate(
        [{ opacity: String(current) }, { opacity: String(targetOpacity) }],
        { duration: MONET_PORTRAIT_FADE_MS, easing: 'ease-in-out', fill: 'forwards' }
      )
    }

    function armPortraitSettle() {
      if (portraitSettleTimer) { clearTimeout(portraitSettleTimer); portraitSettleTimer = null }
      // 只对顶层设防；淡入途中又来新封面会重新武装，最后一层不透明后一次清掉整栈
      if (portraitLayers.length <= 1) return
      var settlingKey = portraitLayers[portraitLayers.length - 1].key
      portraitSettleTimer = setTimeout(function () {
        portraitSettleTimer = null
        var index = -1
        for (var i = 0; i < portraitLayers.length; i += 1) {
          if (portraitLayers[i].key === settlingKey) { index = i; break }
        }
        if (index > 0) {
          var removed = portraitLayers.splice(0, index)
          removed.forEach(function (layer) { layer.el.remove() })
        }
      }, MONET_PORTRAIT_FADE_MS)
    }

    function pushPortraitLayer(src) {
      // 模式已销毁（等价原版 effect cleanup 的 cancelled 标志）：丢弃迟到的解码结果
      if (!portraitStack) return
      portraitLayerKey += 1
      var img = document.createElement('img')
      img.src = src
      img.decoding = 'async'
      img.alt = ''
      img.draggable = false
      img.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;object-fit:cover;opacity:0;pointer-events:none'
      portraitStack.appendChild(img)
      portraitLayers.push({ key: portraitLayerKey, src: src, el: img })
      if (portraitLayers.length > MONET_PORTRAIT_MAX_LAYERS) {
        var dropped = portraitLayers.splice(0, portraitLayers.length - MONET_PORTRAIT_MAX_LAYERS)
        dropped.forEach(function (layer) { layer.el.remove() })
      }
      img.animate(
        [{ opacity: '0' }, { opacity: String(portraitTargetOpacity) }],
        { duration: MONET_PORTRAIT_FADE_MS, easing: 'ease-in-out', fill: 'forwards' }
      )
      armPortraitSettle()
    }

    function updatePortraitLayers(src) {
      if (!portraitStack) return
      // 无封面：整栈淡出并保留
      var target = src ? 1 : 0
      if (target !== portraitTargetOpacity) {
        portraitTargetOpacity = target
        portraitLayers.forEach(function (layer) { animatePortraitLayer(layer.el, target) })
      }
      if (!src) return
      // 顶层已是该封面：URL 变成自身不算新封面
      if (portraitLayers.length > 0 && portraitLayers[portraitLayers.length - 1].src === src) return

      var requestId = ++portraitRequestId
      var loader = new Image()
      loader.decoding = 'async'
      loader.src = src
      var stack = function () {
        if (requestId !== portraitRequestId) return
        pushPortraitLayer(src)
      }
      if (typeof loader.decode === 'function') {
        // 解码失败（失效 blob / 404）刻意吞掉：保留屏幕上已有的封面
        loader.decode().then(stack, function () { /* 忽略 */ })
      } else {
        loader.onload = stack
      }
    }

    // ============================================================
    // AudioOverlay：底部频谱 canvas（bar / line 两种风格）
    // ============================================================
    function resizeAudioCanvas() {
      if (!audioCanvas || !audioContext) return
      var rect = audioCanvas.getBoundingClientRect()
      var dpr = window.devicePixelRatio || 1
      var nextWidth = Math.max(1, Math.floor(rect.width * dpr))
      var nextHeight = Math.max(1, Math.floor(rect.height * dpr))
      audioCssWidth = rect.width
      audioCssHeight = rect.height
      if (audioCanvas.width !== nextWidth || audioCanvas.height !== nextHeight) {
        audioCanvas.width = nextWidth
        audioCanvas.height = nextHeight
      }
      audioContext.setTransform(dpr, 0, 0, dpr, 0, 0)
    }

    function drawAudioOverlay() {
      if (!audioContext || !theme) return
      if (audioWrap && audioWrap.style.display === 'none') return
      var width = audioCssWidth
      var height = audioCssHeight
      if (width <= 0 || height <= 0) return

      var context = audioContext
      context.clearRect(0, 0, width, height)
      // frameState 频段 0~1（原版 MotionValue 0~255 / 255 后同域）
      var bands = [audioState.bass, audioState.lowMid, audioState.mid, audioState.vocal, audioState.treble]
      var rawSpectrum = null
      var hasRawSpectrum = false
      var energy = Math.min(1, Math.max(0.08, audioState.power))
      var primaryInk = ColorMix.colorWithAlpha(theme.primaryColor, 0.94)
      var softInk = ColorMix.colorWithAlpha(theme.primaryColor, 0.72)
      var gradient = context.createLinearGradient(0, 0, width, 0)
      gradient.addColorStop(0, softInk)
      gradient.addColorStop(0.5, primaryInk)
      gradient.addColorStop(1, softInk)
      context.fillStyle = gradient
      context.strokeStyle = gradient
      context.lineWidth = 1.5
      context.lineCap = 'round'

      if (MONET_TUNING.audioStyle === 'line') {
        var points = []
        for (var index = 0; index < BAR_COUNT; index += 1) {
          var x = (index / (BAR_COUNT - 1)) * width
          var spectrumIndex = index / (BAR_COUNT - 1)
          var band = hasRawSpectrum
            ? sampleRawSpectrumProfile(rawSpectrum, spectrumIndex)
            : sampleSpectrumProfile(bands, spectrumIndex)
          var wave =
            Math.sin(index * 0.24 + performance.now() * 0.004) * 0.08 +
            Math.sin(index * 0.68 + performance.now() * 0.0028) * 0.05

          var envelope = Math.sin(spectrumIndex * Math.PI)
          var amplitude = energy * 0.04 + band * 0.8 + wave * 0.04
          var y = height - Math.max(0, height * amplitude * envelope)
          points.push({ x: x, y: y })
        }

        var drawCurve = function (ctx) {
          if (points.length === 0) return
          ctx.moveTo(points[0].x, points[0].y)
          for (var i = 0; i < points.length - 1; i += 1) {
            var xc = (points[i].x + points[i + 1].x) / 2
            var yc = (points[i].y + points[i + 1].y) / 2
            ctx.quadraticCurveTo(points[i].x, points[i].y, xc, yc)
          }
          ctx.lineTo(points[points.length - 1].x, points[points.length - 1].y)
        }

        // 曲线下方填充
        context.beginPath()
        drawCurve(context)
        context.lineTo(width, height)
        context.lineTo(0, height)
        context.closePath()
        var fillGradient = context.createLinearGradient(0, 0, 0, height)
        fillGradient.addColorStop(0, ColorMix.colorWithAlpha(theme.primaryColor, 0.24))
        fillGradient.addColorStop(1, ColorMix.colorWithAlpha(theme.primaryColor, 0.0))
        context.fillStyle = fillGradient
        context.fill()

        // 顶部曲线描边
        context.beginPath()
        drawCurve(context)
        context.strokeStyle = gradient
        context.lineWidth = 2.0
        context.stroke()
      } else {
        var gap = width / BAR_COUNT
        for (var barIndex = 0; barIndex < BAR_COUNT; barIndex += 1) {
          var barSpectrumIndex = barIndex / (BAR_COUNT - 1)
          var barBand = hasRawSpectrum
            ? sampleRawSpectrumProfile(rawSpectrum, barSpectrumIndex)
            : sampleSpectrumProfile(bands, barSpectrumIndex)
          var pulse = Math.sin(barIndex * 0.45 + performance.now() * 0.006) * 0.5 + 0.5

          var barEnvelope = Math.sin(barSpectrumIndex * Math.PI)
          var barHeight = height * (0.02 + (energy * 0.04 + barBand * 0.82 + pulse * 0.02) * barEnvelope)
          var barX = barIndex * gap + gap * 0.14
          context.fillRect(barX, height - barHeight, Math.max(1.35, gap * 0.34), barHeight)
        }
      }
    }

    // ============================================================
    // rail：测量缓存 / 节点管理 / 逐帧词视觉
    // ============================================================
    function getOrMeasureMonetLineLayout(entry, fontPx, translationFontPx, fontStack, translationFontStack, fontWeight, translationFontWeight, maxWidthPx, showSubtitleTranslationFlag) {
      var cacheKey = [
        entry.index,
        entry.line.startTime,
        entry.line.endTime,
        entry.line.fullText,
        entry.line.translation || '',
        entry.status,
        fontPx,
        translationFontPx,
        fontStack,
        translationFontStack,
        fontWeight,
        translationFontWeight,
        maxWidthPx,
        showSubtitleTranslationFlag ? 1 : 0
      ].join('\u0001')
      var cached = layoutCache.get(cacheKey)
      if (cached) return cached

      var layout = measureMonetLineLayout({
        line: entry.line,
        status: entry.status,
        fontPx: fontPx,
        translationFontPx: translationFontPx,
        fontStack: fontStack,
        translationFontStack: translationFontStack,
        fontWeight: fontWeight,
        translationFontWeight: translationFontWeight,
        maxWidthPx: maxWidthPx,
        showSubtitleTranslation: showSubtitleTranslationFlag
      })
      trimOldestCacheEntry(layoutCache, MONET_LAYOUT_CACHE_LIMIT)
      layoutCache.set(cacheKey, layout)
      return layout
    }

    // token DOM 构建（timed 词带基线 span 供扫过层叠加；静态透传模式整 token 单色）
    function buildTokensForNode(node, entry, renderStaticPassed) {
      var line = entry.line
      var tokens = buildMonetDisplayTokens(line)
      var ranges = WordColoring.buildWordColorRangesFromMatchers(line.fullText, wordColorMatchers)
      var tokenColors = WordColoring.resolveTokenColorMap(tokens, ranges)
      var accentColor = ColorMix.colorWithAlpha(theme.primaryColor, 0.98)
      var resolvedAccentColor = line.isChorus && theme.accentColor
        ? ColorMix.mixColors(accentColor, theme.accentColor, 0.48)
        : accentColor
      node.fontSpec = entry.tone.fontWeight + ' ' + lyricFontPx + 'px ' + lyricFontFamily()
      node.lineRenderEndTime = RenderHints.getLineRenderEndTime(line)

      node.tokenWrap.innerHTML = ''
      node.tokens = []
      tokens.forEach(function (token) {
        var wordColor = tokenColors.get(token.key) || resolvedAccentColor
        if (renderStaticPassed) {
          var span = document.createElement('span')
          span.style.color = token.timed ? wordColor : entry.tone.baseColor
          span.textContent = token.text
          node.tokenWrap.appendChild(span)
          node.tokens.push({
            token: token,
            wordColor: wordColor,
            untimedEl: token.timed ? null : span,
            baseEl: null,
            wrapEl: null,
            sweepEl: null,
            sweepFillEl: null,
            offsets: null,
            lastBaseColor: '',
            lastShadow: null,
            lastMask: null,
            lastGradient: null
          })
          return
        }
        if (token.timed && token.startTime !== null && token.endTime !== null) {
          var wrap = document.createElement('span')
          wrap.style.cssText = 'position:relative;display:inline-block;white-space:pre-wrap;overflow-wrap:break-word'
          var base = document.createElement('span')
          base.textContent = token.text
          wrap.appendChild(base)
          node.tokenWrap.appendChild(wrap)
          node.tokens.push({
            token: token,
            wordColor: wordColor,
            untimedEl: null,
            baseEl: base,
            wrapEl: wrap,
            sweepEl: null,
            sweepFillEl: null,
            offsets: null,
            lastBaseColor: '',
            lastShadow: null,
            lastMask: null,
            lastGradient: null
          })
        } else {
          var plain = document.createElement('span')
          plain.style.color = entry.tone.baseColor
          plain.textContent = token.text
          node.tokenWrap.appendChild(plain)
          node.tokens.push({
            token: token,
            wordColor: wordColor,
            untimedEl: plain,
            baseEl: null,
            wrapEl: null,
            sweepEl: null,
            sweepFillEl: null,
            offsets: null,
            lastBaseColor: '',
            lastShadow: null,
            lastMask: null,
            lastGradient: null
          })
        }
      })
      node.staticPassed = renderStaticPassed
    }

    // 扫过层：background-clip:text 不画出填充盒之外、掩膜在边框盒裁剪，
    // 字体 em 盒高于 line-height 时会切到降部 —— 两盒同时撑大再把文本拉回原位
    function ensureSweep(tn) {
      if (tn.sweepEl) return
      var sweepOverflowPx = Math.round(lyricFontPx * 0.5)
      var sweepEl = document.createElement('span')
      sweepEl.setAttribute('aria-hidden', 'true')
      sweepEl.style.cssText = [
        'pointer-events:none', 'position:absolute', 'left:0', 'right:0', 'display:block',
        'white-space:pre-wrap', 'overflow-wrap:break-word',
        'top:' + (-sweepOverflowPx) + 'px', 'bottom:' + (-sweepOverflowPx) + 'px',
        'padding-top:' + sweepOverflowPx + 'px', 'padding-bottom:' + sweepOverflowPx + 'px',
        'box-sizing:border-box',
        '-webkit-mask-size:100% 100%', 'mask-size:100% 100%',
        '-webkit-mask-repeat:no-repeat', 'mask-repeat:no-repeat',
        'text-shadow:none'
      ].join(';')
      var fillEl = document.createElement('span')
      fillEl.style.cssText = [
        'display:block', 'white-space:pre-wrap', 'overflow-wrap:break-word',
        'margin-top:' + (-sweepOverflowPx) + 'px',
        'padding-top:' + sweepOverflowPx + 'px', 'padding-bottom:' + sweepOverflowPx + 'px',
        'color:transparent', '-webkit-text-fill-color:transparent',
        '-webkit-background-clip:text', 'background-clip:text'
      ].join(';')
      fillEl.textContent = tn.token.text
      sweepEl.appendChild(fillEl)
      tn.wrapEl.appendChild(sweepEl)
      tn.sweepEl = sweepEl
      tn.sweepFillEl = fillEl
      tn.lastMask = null
      tn.lastGradient = null
    }

    function removeSweep(tn) {
      if (!tn.sweepEl) return
      tn.sweepEl.remove()
      tn.sweepEl = null
      tn.sweepFillEl = null
      tn.lastMask = null
      tn.lastGradient = null
    }

    // 发光阴影（active/passed 行；intensity 经原版 Smoothstep 包络）
    function computeMonetGlowShadow(now, token, baseColor, wordColor, canRenderGlow, lineRenderEndTime, isChorus) {
      if (!canRenderGlow || now <= token.startTime) return 'none'
      var intensity = resolveMonetGlow(now, token.startTime, token.endTime, lineRenderEndTime)
      if (intensity <= 0) return 'none'
      var radiusOne = Math.round(lyricFontPx * (isChorus ? 0.45 : 0.28))
      var radiusTwo = Math.round(lyricFontPx * (isChorus ? 0.90 : 0.65))
      var maxAlpha = isChorus ? 1.0 : 0.88
      var glowColor = ColorMix.mixColors(baseColor, wordColor, intensity, intensity * maxAlpha)
      return '0 0 ' + radiusOne + 'px ' + glowColor + ', 0 0 ' + radiusTwo + 'px ' + glowColor
    }

    // 每帧：活动行的逐字扫过（掩膜/渐变）+ active/passed 行的发光衰减
    function updateWordVisuals(now) {
      lineNodes.forEach(function (node) {
        if (node.staticPassed) return
        var status = node.entry.status
        var isActive = status === 'active'
        var canRenderGlow = status === 'active' || status === 'passed'
        var lineRenderEndTime = node.lineRenderEndTime

        node.tokens.forEach(function (tn) {
          var token = tn.token
          if (!token.timed || token.startTime === null || token.endTime === null) {
            if (tn.untimedEl && tn.lastBaseColor !== node.tone.baseColor) {
              tn.untimedEl.style.color = node.tone.baseColor
              tn.lastBaseColor = node.tone.baseColor
            }
            return
          }

          var wordColor = tn.wordColor
          var baseColor = node.tone.baseColor
          var resolvedColor
          var shadow

          if (isActive) {
            var wordStatus = resolveMonetWordStatus(now, token.startTime, token.endTime)
            resolvedColor = wordStatus === 'passed' ? wordColor : baseColor
            ensureSweep(tn)

            if (!tn.offsets) {
              tn.offsets = measureMonetGraphemeOffsets(token.text, lyricFontPx, node.fontSpec)
            }
            var fillWidth = resolveMonetFillWidth(now, token.startTime, token.endTime, tn.offsets, token.graphemeTimings)
            var edgeSoftness = resolveMonetSweepEdgeSoftness(lyricFontPx)
            var fullWidth = tn.offsets[tn.offsets.length - 1] || 0
            var sweepEnd = resolveMonetSweepEnd(fillWidth, fullWidth, edgeSoftness)
            var solidEnd = Math.max(sweepEnd - edgeSoftness, 0)
            var featherStart = Math.max(sweepEnd - edgeSoftness * 0.55, 0)
            var featherEnd = Math.max(sweepEnd, 0)
            var mask = 'linear-gradient(90deg, rgba(0, 0, 0, 1) 0px, rgba(0, 0, 0, 1) ' + solidEnd +
              'px, rgba(0, 0, 0, 0.92) ' + featherStart +
              'px, rgba(0, 0, 0, 0) ' + featherEnd + 'px, rgba(0, 0, 0, 0) 100%)'

            var progress = now <= token.startTime
              ? 0
              : now >= token.endTime
                ? 1
                : (now - token.startTime) / Math.max(0.001, token.endTime - token.startTime)
            var fillColor = ColorMix.mixColors(baseColor, wordColor, Math.min(progress, 1))
            var fillGradient = 'linear-gradient(90deg, ' + fillColor + ' 0%, ' +
              ColorMix.colorWithAlpha(fillColor, 0.92) + ' 68%, ' +
              ColorMix.colorWithAlpha(fillColor, 0.72) + ' 100%)'

            if (tn.lastMask !== mask) {
              tn.sweepEl.style.webkitMaskImage = mask
              tn.sweepEl.style.maskImage = mask
              tn.lastMask = mask
            }
            if (tn.lastGradient !== fillGradient) {
              tn.sweepFillEl.style.backgroundImage = fillGradient
              tn.lastGradient = fillGradient
            }
            shadow = computeMonetGlowShadow(now, token, baseColor, wordColor, canRenderGlow, lineRenderEndTime, node.entry.line.isChorus)
          } else {
            removeSweep(tn)
            resolvedColor = status === 'passed' ? wordColor : baseColor
            shadow = computeMonetGlowShadow(now, token, baseColor, wordColor, canRenderGlow, lineRenderEndTime, node.entry.line.isChorus)
          }

          if (tn.baseEl && tn.lastBaseColor !== resolvedColor) {
            tn.baseEl.style.color = resolvedColor
            tn.lastBaseColor = resolvedColor
          }
          if (tn.baseEl && shadow !== tn.lastShadow) {
            tn.baseEl.style.textShadow = shadow
            tn.lastShadow = shadow
          }
        })
      })
    }

    // ---------- 行节点：读取实时动画值（framer 弹簧从当前位置续跑的等价物） ----------
    function readLiveTransforms(node) {
      var state = { y: node.target.y, scale: node.target.scale, opacity: node.target.opacity, filter: 'blur(' + node.target.blurPx + 'px)' }
      try {
        var outerTransform = getComputedStyle(node.outer).transform
        if (outerTransform && outerTransform !== 'none') {
          var m = outerTransform.match(/matrix\(([^)]+)\)/)
          if (m) {
            var ty = parseFloat(m[1].split(',')[5])
            if (Number.isFinite(ty)) state.y = ty
          }
        }
        var innerTransform = getComputedStyle(node.inner).transform
        if (innerTransform && innerTransform !== 'none') {
          var m2 = innerTransform.match(/matrix\(([^)]+)\)/)
          if (m2) {
            var a = parseFloat(m2[1].split(',')[0])
            if (Number.isFinite(a) && a !== 0) state.scale = a
          }
        }
        var opacity = parseFloat(getComputedStyle(node.outer).opacity)
        if (Number.isFinite(opacity)) state.opacity = opacity
        var filter = getComputedStyle(node.outer).filter
        var fm = filter && filter.match(/blur\(([\d.]+)px\)/)
        state.filter = fm ? 'blur(' + parseFloat(fm[1]) + 'px)' : 'blur(0px)'
      } catch (e) { /* 取不到就用缓存目标值 */ }
      return state
    }

    // 行进出场/重定位动画（原版 MONET_SCROLL_TRANSITION：y/scale 双弹簧 + opacity/filter tween）
    function animateRailLineTo(node, entry, fromInitial) {
      var tone = entry.tone
      var targetFilter = 'blur(' + tone.blurPx + 'px)'
      if (fromInitial) {
        var initialOffset = entry.offset >= 0 ? 34 : -34
        node.outer.style.opacity = '0'
        node.outer.style.transform = 'translateY(' + (entry.y + initialOffset) + 'px)'
        node.outer.style.filter = 'blur(5px)'
        node.inner.style.transform = 'scale(' + (tone.scale * 0.98) + ')'
        Anim.animateProps(node.outer, {
          opacity: { from: 0, to: tone.opacity },
          transform: { from: { y: entry.y + initialOffset }, to: { y: entry.y } },
          filter: { from: 'blur(5px)', to: targetFilter }
        }, {
          type: 'spring',
          stiffness: MONET_SCROLL_SPRING.stiffness,
          damping: MONET_SCROLL_SPRING.damping,
          mass: MONET_SCROLL_SPRING.mass,
          opacity: { duration: 0.28, ease: MONET_SCROLL_EASE },
          filter: { duration: 0.32, ease: MONET_SCROLL_EASE }
        })
        Anim.animateProps(node.inner, {
          transform: { from: { scale: tone.scale * 0.98 }, to: { scale: tone.scale } }
        }, {
          type: 'spring',
          stiffness: MONET_SCALE_SPRING.stiffness,
          damping: MONET_SCALE_SPRING.damping,
          mass: MONET_SCALE_SPRING.mass
        })
      } else {
        var live = readLiveTransforms(node)
        Anim.animateProps(node.outer, {
          opacity: { from: live.opacity, to: tone.opacity },
          transform: { from: { y: live.y }, to: { y: entry.y } },
          filter: { from: live.filter, to: targetFilter }
        }, {
          type: 'spring',
          stiffness: MONET_SCROLL_SPRING.stiffness,
          damping: MONET_SCROLL_SPRING.damping,
          mass: MONET_SCROLL_SPRING.mass,
          opacity: { duration: 0.28, ease: MONET_SCROLL_EASE },
          filter: { duration: 0.32, ease: MONET_SCROLL_EASE }
        })
        Anim.animateProps(node.inner, {
          transform: { from: { scale: live.scale }, to: { scale: tone.scale } }
        }, {
          type: 'spring',
          stiffness: MONET_SCALE_SPRING.stiffness,
          damping: MONET_SCALE_SPRING.damping,
          mass: MONET_SCALE_SPRING.mass
        })
      }
      node.target = { y: entry.y, scale: tone.scale, opacity: tone.opacity, blurPx: tone.blurPx }
    }

    // 文本块布局样式（含裁剪淡出 / 边缘淡出掩膜）
    function applyTextBlockLayout(node, entry) {
      var layout = entry.layout
      var isActiveLine = entry.status === 'active'
      node.textEl.style.marginLeft = -glowBufferPx + 'px'
      node.textEl.style.marginRight = -glowBufferPx + 'px'
      node.textEl.style.paddingLeft = glowBufferPx + 'px'
      node.textEl.style.paddingRight = glowBufferPx + 'px'
      node.textEl.style.marginTop = -vGlowBufferPx + 'px'
      node.textEl.style.marginBottom = -vGlowBufferPx + 'px'
      node.textEl.style.paddingTop = (layout.textPaddingTopPx + vGlowBufferPx) + 'px'
      node.textEl.style.paddingBottom = (layout.textPaddingBottomPx + vGlowBufferPx) + 'px'
      // 活动行盒高由内容撑开（绝不截断）；上下文行用预量测的固定两行盒
      node.textEl.style.height = isActiveLine ? '' : (layout.textHeightPx + vGlowBufferPx * 2) + 'px'
      node.textEl.style.lineHeight = layout.lineHeightPx + 'px'

      var textMask = isActiveLine
        ? null
        : getClippedTextMask(
          layout.isTextClipped,
          vGlowBufferPx + layout.textPaddingTopPx + layout.textContentHeightPx,
          Math.max(lyricFontPx * 0.55, 12)
        )
      var textEdgeMask = getEdgeFadeMask(layout.isTextOverflowingWidth, Math.max(lyricFontPx * 0.9, 24))
      applyMaskStyle(node.textEl, composeLineMasks([textMask, textEdgeMask]))
    }

    // 翻译行（仅活动行 + 有翻译时存在；进出场 opacity/y 0.28s）
    function ensureTranslation(node, entry) {
      var need = showSubtitleTranslation && entry.status === 'active' && Boolean((entry.line.translation || '').trim())
      if (need && !node.translationEl) {
        var el = document.createElement('div')
        el.style.cssText = 'min-width:0;overflow:hidden;white-space:pre-wrap;overflow-wrap:break-word;box-sizing:border-box;letter-spacing:0'
        el.textContent = entry.line.translation
        node.inner.appendChild(el)
        node.translationEl = el
        applyTranslationLayout(node, entry)
        Anim.animateProps(el, {
          opacity: { from: 0, to: 1 },
          transform: { from: { y: 8 }, to: { y: 0 } }
        }, { duration: 0.28, ease: MONET_SCROLL_EASE })
      } else if (!need && node.translationEl) {
        node.translationEl.remove()
        node.translationEl = null
      } else if (need) {
        applyTranslationLayout(node, entry)
      }
    }

    function applyTranslationLayout(node, entry) {
      var layout = entry.layout
      var el = node.translationEl
      if (!el) return
      el.style.marginLeft = -glowBufferPx + 'px'
      el.style.marginRight = -glowBufferPx + 'px'
      el.style.paddingLeft = glowBufferPx + 'px'
      el.style.paddingRight = glowBufferPx + 'px'
      el.style.height = layout.translationHeightPx + 'px'
      el.style.paddingTop = layout.translationPaddingTopPx + 'px'
      el.style.paddingBottom = layout.translationPaddingBottomPx + 'px'
      el.style.color = ColorMix.colorWithAlpha(theme.primaryColor, 0.68)
      el.style.fontFamily = translationFontFamily()
      el.style.fontSize = translationFontPx + 'px'
      el.style.fontWeight = String(translationFontWeight())
      el.style.lineHeight = layout.translationLineHeightPx + 'px'
      applyMaskStyle(el, composeLineMasks([
        getLineMask(layout.isTranslationClipped, Math.max(translationFontPx * 0.65, 10))
      ]))
    }

    // 合唱背景（本插件数据恒无 isChorus，分支保留但不触发）
    function updateChorusBg(node, status) {
      var active = status === 'active'
      Anim.animateProps(node.chorusEl, {
        opacity: { to: active ? 1 : 0 },
        transform: { to: { scale: active ? 1.02 : 0.96 } }
      }, { duration: 0.45, ease: 'easeOut' })
    }

    function createRailLineNode(entry, currentLineIndex, isManualScrolling, isFirstPaint) {
      var tone = entry.tone
      var outer = document.createElement('div')
      outer.style.cssText = [
        'position:absolute', 'top:0', 'min-width:0', 'will-change:transform',
        'transform-origin:left top',
        'left:' + glowBufferPx + 'px', 'right:' + glowBufferPx + 'px',
        'height:' + entry.layout.visualHeightPx + 'px',
        'z-index:' + tone.zIndex
      ].join(';')
      // y 与 scale 双弹簧拆两层合成（等价 framer-motion 的独立 transform 值）
      var inner = document.createElement('div')
      inner.style.cssText = 'position:relative;width:100%;height:100%;transform-origin:left top;will-change:transform'

      var chorusEl = null
      if (entry.line.isChorus) {
        chorusEl = document.createElement('div')
        chorusEl.style.cssText = [
          'position:absolute', 'inset:0', 'pointer-events:none', 'z-index:-10', 'border-radius:1rem',
          'background:radial-gradient(circle at 50% 45%, ' + ColorMix.colorWithAlpha(theme.accentColor, 0.14) + ' 0%, ' +
          ColorMix.colorWithAlpha(theme.accentColor, 0.04) + ' 55%, transparent 82%)',
          'filter:blur(10px)', 'opacity:0'
        ].join(';')
        inner.appendChild(chorusEl)
      }

      var textEl = document.createElement('div')
      textEl.style.cssText = [
        'min-width:0', 'overflow:hidden', 'pointer-events:none', 'box-sizing:border-box',
        'font-family:' + lyricFontFamily(),
        'font-size:' + lyricFontPx + 'px',
        'font-weight:' + tone.fontWeight,
        'letter-spacing:0'
      ].join(';')
      var tokenWrap = document.createElement('span')
      tokenWrap.style.cssText = 'display:block;width:100%;min-width:0;max-width:100%;white-space:pre-wrap;overflow-wrap:break-word'
      textEl.appendChild(tokenWrap)
      inner.appendChild(textEl)
      outer.appendChild(inner)
      railEl.appendChild(outer)

      var node = {
        key: entry.key,
        entry: entry,
        tone: tone,
        layout: entry.layout,
        outer: outer,
        inner: inner,
        chorusEl: chorusEl,
        textEl: textEl,
        tokenWrap: tokenWrap,
        tokens: [],
        translationEl: null,
        staticPassed: false,
        fontSpec: '',
        lineRenderEndTime: RenderHints.getLineRenderEndTime(entry.line),
        target: { y: entry.y, scale: tone.scale, opacity: tone.opacity, blurPx: tone.blurPx },
        lastTextShadow: null,
        timers: []
      }
      buildTokensForNode(node, entry, isManualScrolling && entry.index !== currentLineIndex)
      applyTextBlockLayout(node, entry)

      var shadow = entry.status === 'active'
        ? '0 14px 34px ' + ColorMix.colorWithAlpha(theme.backgroundColor, 0.22)
        : 'none'
      node.textEl.style.textShadow = shadow
      node.lastTextShadow = shadow

      if (entry.line.isChorus && entry.status === 'active') updateChorusBg(node, entry.status)
      ensureTranslation(node, entry)

      // AnimatePresence initial={false}：首次绘制直接落在终态，不播入场
      if (isFirstPaint || isManualScrolling) {
        node.outer.style.opacity = String(tone.opacity)
        node.outer.style.transform = 'translateY(' + entry.y + 'px)'
        node.outer.style.filter = 'blur(' + tone.blurPx + 'px)'
        node.inner.style.transform = 'scale(' + tone.scale + ')'
      } else {
        animateRailLineTo(node, entry, true)
      }
      return node
    }

    function updateRailLineNode(node, entry, currentLineIndex, isManualScrolling) {
      var prevStatus = node.entry.status
      var prevTone = node.tone
      var prevLayout = node.layout
      node.entry = entry
      node.tone = entry.tone
      node.layout = entry.layout

      // 手动滚动时除当前行外全部静态透传（无扫过/发光）
      var renderStaticPassed = isManualScrolling && entry.index !== currentLineIndex
      if (renderStaticPassed !== node.staticPassed) {
        buildTokensForNode(node, entry, renderStaticPassed)
      }

      if (node.outer.style.zIndex !== String(entry.tone.zIndex)) {
        node.outer.style.zIndex = String(entry.tone.zIndex)
      }
      var heightStr = entry.layout.visualHeightPx + 'px'
      if (node.outer.style.height !== heightStr) node.outer.style.height = heightStr
      if (entry.layout !== prevLayout) applyTextBlockLayout(node, entry)
      if (entry.tone.fontWeight !== prevTone.fontWeight) {
        node.textEl.style.fontWeight = String(entry.tone.fontWeight)
      }

      var shadow = entry.status === 'active'
        ? '0 14px 34px ' + ColorMix.colorWithAlpha(theme.backgroundColor, 0.22)
        : 'none'
      if (shadow !== node.lastTextShadow) {
        node.textEl.style.textShadow = shadow
        node.lastTextShadow = shadow
      }

      ensureTranslation(node, entry)
      if (node.chorusEl && entry.status !== prevStatus) updateChorusBg(node, entry.status)

      var target = node.target
      var tone = entry.tone
      if (entry.y !== target.y || tone.scale !== target.scale || tone.opacity !== target.opacity || tone.blurPx !== target.blurPx) {
        animateRailLineTo(node, entry, false)
      }
    }

    // 旧行退场：0.2s ease [0.32,0.72,0,1]，位移方向按 passed/上方行决定
    function exitRailLineNode(node, disableExitMotion) {
      node.timers.forEach(function (timer) { clearTimeout(timer) })
      node.timers = []
      if (disableExitMotion) {
        node.outer.remove()
        return
      }
      var exitOffset = node.entry.status === 'passed' || node.entry.offset < 0 ? -38 : 38
      var live = readLiveTransforms(node)
      Anim.animateProps(node.outer, {
        opacity: { from: live.opacity, to: 0 },
        transform: { from: { y: live.y }, to: { y: node.target.y + exitOffset } },
        filter: { from: live.filter, to: 'blur(6px)' }
      }, { duration: 0.2, ease: MONET_SCROLL_EASE })
      Anim.animateProps(node.inner, {
        transform: { from: { scale: live.scale }, to: { scale: node.tone.scale * 0.98 } }
      }, { duration: 0.2, ease: MONET_SCROLL_EASE })
      var el = node.outer
      var timer = setTimeout(function () { el.remove() }, 280)
      exitTimers.push(timer)
    }

    function rebuildRailNodes() {
      lineNodes.forEach(function (node) { node.outer.remove() })
      lineNodes.clear()
      firstRailPaint = true
    }

    function reconcileRail(positioned, currentLineIndex, isManualScrolling) {
      var seen = new Set()
      for (var i = 0; i < positioned.length; i += 1) {
        var entry = positioned[i]
        seen.add(entry.key)
        var node = lineNodes.get(entry.key)
        if (!node) {
          node = createRailLineNode(entry, currentLineIndex, isManualScrolling, firstRailPaint)
          lineNodes.set(entry.key, node)
        } else {
          updateRailLineNode(node, entry, currentLineIndex, isManualScrolling)
        }
      }
      if (firstRailPaint && positioned.length > 0) firstRailPaint = false

      lineNodes.forEach(function (node, key) {
        if (!seen.has(key)) {
          lineNodes.delete(key)
          exitRailLineNode(node, isManualScrolling)
        }
      })
    }

    // ---------- 手动滚动（滚轮 / 触摸，常量与原版一致） ----------
    function clampScrollSteps(steps) { return Math.max(-1, Math.min(1, steps)) }
    function getScrollDirection(delta) { return delta === 0 ? 0 : (delta > 0 ? 1 : -1) }

    function getFallbackAnchorIndex() {
      if (manualScrollAnchorIndex !== null) return manualScrollAnchorIndex
      if (lastCurrentLineIndex >= 0) return lastCurrentLineIndex
      for (var i = 0; i < lastVisibleEntries.length; i += 1) {
        if (lastVisibleEntries[i].offset === 0) return lastVisibleEntries[i].index
      }
      return 0
    }

    function scheduleManualScrollReset() {
      if (manualScrollResetTimer !== null) clearTimeout(manualScrollResetTimer)
      manualScrollResetTimer = setTimeout(function () {
        manualScrollResetTimer = null
        manualScrollAnchorIndex = null
        wheelAccumulator = 0
        wheelDirection = 0
        touchAccumulator = 0
        touchDirection = 0
      }, MONET_SCROLL_IDLE_RESET_MS)
    }

    function moveManualScrollAnchor(steps) {
      if (lastLines.length === 0) return
      var baseIndex = manualScrollAnchorIndex !== null ? manualScrollAnchorIndex : getFallbackAnchorIndex()
      manualScrollAnchorIndex = Math.round(clamp(baseIndex + steps, 0, lastLines.length - 1))
      scheduleManualScrollReset()
    }

    function handleRailWheel(event) {
      if (lastLines.length === 0) return
      if (event.cancelable) event.preventDefault()
      event.stopPropagation()
      var direction = getScrollDirection(event.deltaY)
      if (direction !== 0 && wheelDirection !== 0 && direction !== wheelDirection) wheelAccumulator = 0
      wheelDirection = direction || wheelDirection
      wheelAccumulator += event.deltaY
      var steps = clampScrollSteps(Math.trunc(wheelAccumulator / MONET_SCROLL_STEP_PX))
      if (steps !== 0) {
        wheelAccumulator = 0
        moveManualScrollAnchor(steps)
      } else {
        scheduleManualScrollReset()
      }
    }

    function handleRailTouchStart(event) {
      if (lastLines.length === 0) return
      event.stopPropagation()
      touchLastY = event.touches[0] ? event.touches[0].clientY : null
      touchAccumulator = 0
      touchDirection = 0
      manualScrollAnchorIndex = getFallbackAnchorIndex()
      scheduleManualScrollReset()
    }

    function handleRailTouchMove(event) {
      if (lastLines.length === 0 || touchLastY === null) return
      event.stopPropagation()
      var nextY = event.touches[0] ? event.touches[0].clientY : null
      if (typeof nextY !== 'number') return

      var deltaY = touchLastY - nextY
      touchLastY = nextY
      var direction = getScrollDirection(deltaY)
      if (direction !== 0 && touchDirection !== 0 && direction !== touchDirection) touchAccumulator = 0
      touchDirection = direction || touchDirection
      touchAccumulator += deltaY
      var steps = clampScrollSteps(Math.trunc(touchAccumulator / MONET_TOUCH_STEP_PX))
      if (steps !== 0) {
        touchAccumulator = 0
        moveManualScrollAnchor(steps)
      } else {
        scheduleManualScrollReset()
      }
    }

    function handleRailTouchEnd() {
      touchLastY = null
      touchDirection = 0
      touchAccumulator = 0
      scheduleManualScrollReset()
    }

    // ---------- showText 开关（原版条件渲染对应隐藏/显示） ----------
    function applyShowText(show) {
      var display = show ? '' : 'none'
      decorLayer.style.display = display
      mainContent.style.display = display
      if (audioWrap) audioWrap.style.display = display
    }

    // ---------- 生命周期 ----------
    function setTheme(newTheme) {
      var isFirst = !theme
      theme = newTheme
      if (!theme) return
      wordColorMatchers = WordColoring.prepareWordColorMatchers(theme.wordColors, MONET_TUNING.keywordColoringEnabled)
      applyPosterTheme()
      rebuildDecor()
      applyPortraitFloat()
      if (!isFirst) rebuildRailNodes()
    }

    function setLines() { /* 行数据经 tick 的 frameState.lines 传入 */ }

    function setFontScale(scale) {
      // 宿主字体缩放对应原版 subtitleFontScale（翻译行）；歌词行另有 monetTuning.fontScale=1.2 内联
      subtitleFontScale = scale === undefined ? 1 : scale
    }

    function tick(frameState) {
      if (!theme || !rootEl) return
      frameState = frameState || {}
      var lines = frameState.lines || []
      var currentLineIndex = frameState.currentLineIndex === undefined ? -1 : frameState.currentLineIndex
      var now = frameState.currentTime || 0

      // 频谱 canvas 自绘循环读取的音频缓存
      audioState.power = frameState.audioPower || 0
      var ab = frameState.audioBands || {}
      audioState.bass = ab.bass || 0
      audioState.lowMid = ab.lowMid || 0
      audioState.mid = ab.mid || 0
      audioState.vocal = ab.vocal || 0
      audioState.treble = ab.treble || 0

      showText = frameState.showText !== false
      if (showText !== lastShowText) {
        var wasHidden = lastShowText === false
        lastShowText = showText
        applyShowText(showText)
        if (showText && wasHidden) {
          // 原版 showText 切换 = 整组元素重挂：rail 静态首绘 + 海报入场重播
          firstRailPaint = true
          playIntro()
          resizeAudioCanvas()
        }
      }

      // introKey：切歌（songIdentifier 变化）或播放位置从尾部跳回开头时重播入场
      var songIdentifier = frameState.songTitle == null ? '' : frameState.songTitle
      if (prevSongIdentifier === null) prevSongIdentifier = songIdentifier
      else if (songIdentifier !== prevSongIdentifier) {
        prevSongIdentifier = songIdentifier
        bumpIntro()
      }
      if (now !== lastTime) {
        var wasAtEnd = lastTime > 2.0
        var isAtStart = now < 0.1
        if (isAtStart && wasAtEnd) bumpIntro()
        lastTime = now
      }
      if (!introPlayed) {
        introPlayed = true
        playIntro()
        playPortraitIntro()
      }

      if (!showText) return

      // 字号与布局比例（每帧重算廉价；测量缓存按键自动分流）
      largeScreenScale = resolveMonetLargeScreenScale(shellWidth)
      lyricFontPx = resolveClampFontPx(1.34, 2.75, 2.28) * MONET_TUNING.fontScale * largeScreenScale
      inactiveFontPx = resolveClampFontPx(1.08, 2, 1.48) * MONET_TUNING.fontScale * largeScreenScale
      translationFontPx = resolveClampFontPx(0.94, 1.28, 1.14) * MONET_TUNING.fontScale * subtitleFontScale * largeScreenScale
      applyPosterSizes()
      applyPosterText(frameState)

      var activeFontStack = lyricFontFamily()
      if (rootEl.style.fontFamily !== activeFontStack) rootEl.style.fontFamily = activeFontStack
      if (activeFontStack !== lastFontStack) {
        lastFontStack = activeFontStack
        rebuildRailNodes()
      }

      glowBufferPx = Math.round(lyricFontPx * 1.2)
      vGlowBufferPx = Math.round(lyricFontPx * 1.2)
      var railMaxWidthPx = Math.round(MONET_RAIL_BASE_MAX_WIDTH_PX * largeScreenScale)
      var railMaxHeightPx = Math.round(Math.max(
        MONET_RAIL_BASE_MAX_HEIGHT_PX * largeScreenScale,
        lyricFontPx * 1.18 * MONET_RAIL_MIN_ROWS
      ))
      var railStyleKey = glowBufferPx + '|' + railMaxWidthPx + '|' + railMaxHeightPx
      if (railStyleKey !== lastRailStyleKey) {
        lastRailStyleKey = railStyleKey
        railEl.style.height = 'clamp(280px, 52vh, ' + railMaxHeightPx + 'px)'
        railEl.style.maxWidth = railMaxWidthPx + 'px'
        railEl.style.marginLeft = -glowBufferPx + 'px'
        railEl.style.marginRight = -glowBufferPx + 'px'
        railEl.style.paddingLeft = glowBufferPx + 'px'
        railEl.style.paddingRight = glowBufferPx + 'px'
        // 缓冲变化影响行内边距/掩膜，全部节点刷新
        rebuildRailNodes()
      }

      // 字体加载完成后失效测量缓存并重算布局
      if (handledFontsEpoch !== fontsEpoch) {
        handledFontsEpoch = fontsEpoch
        clearMonetMeasurementCaches()
        layoutCache.clear()
      }

      var runtimeState = Runtime.getRuntimeState({
        lines: lines,
        currentLineIndex: currentLineIndex,
        currentTime: now,
        getLineEndTime: RenderHints.getLineRenderEndTime
      })
      lastLines = lines
      lastCurrentLineIndex = currentLineIndex

      var visibleEntries = manualScrollAnchorIndex === null
        ? buildMonetVisibleLineEntries({
          lines: lines,
          currentLineIndex: currentLineIndex,
          activeLine: runtimeState.activeLine,
          recentCompletedLine: runtimeState.recentCompletedLine,
          upcomingLine: runtimeState.upcomingLine,
          currentTime: runtimeState.currentTimeValue,
          before: 2,
          after: 2
        })
        : buildScrollableRailEntries(lines, manualScrollAnchorIndex, currentLineIndex)
      lastVisibleEntries = visibleEntries

      var positioned = buildPositionedEntries(
        visibleEntries,
        railSize,
        theme,
        lyricFontPx,
        inactiveFontPx,
        translationFontPx,
        activeFontStack,
        translationFontFamily(),
        lyricFontWeight(),
        translationFontWeight(),
        glowBufferPx,
        showSubtitleTranslation,
        layoutCache,
        getOrMeasureMonetLineLayout
      )

      var isManualScrolling = manualScrollAnchorIndex !== null
      reconcileRail(positioned, currentLineIndex, isManualScrolling)
      updateWordVisuals(now)
      updatePortraitLayers(frameState.coverUrl)
    }

    function destroy() {
      if (audioFrameId) { window.cancelAnimationFrame(audioFrameId); audioFrameId = 0 }
      exitTimers.forEach(function (timer) { clearTimeout(timer) })
      exitTimers.length = 0
      if (manualScrollResetTimer !== null) { clearTimeout(manualScrollResetTimer); manualScrollResetTimer = null }
      if (portraitSettleTimer) { clearTimeout(portraitSettleTimer); portraitSettleTimer = null }
      if (dividerAnim) { try { dividerAnim.cancel() } catch (e) { /* 忽略 */ } dividerAnim = null }
      if (floatAnim) { try { floatAnim.cancel() } catch (e) { /* 忽略 */ } floatAnim = null }
      if (railResizeObserver) { railResizeObserver.disconnect(); railResizeObserver = null }
      if (shellResizeObserver) { shellResizeObserver.disconnect(); shellResizeObserver = null }
      listeners.forEach(function (entry) {
        entry.target.removeEventListener(entry.type, entry.handler, entry.options)
      })
      listeners.length = 0
      if (styleEl) { styleEl.remove(); styleEl = null }
      if (rootEl) { rootEl.remove(); rootEl = null }
      lineNodes.clear()
      layoutCache.clear()
      clearMonetMeasurementCaches()
      // 作废在途的封面解码回调（等价原版 effect cleanup 的 cancelled 标志）
      portraitRequestId += 1
      decorFade = null
      mainContent = null
      railEl = null
      portraitStack = null
      portraitLayers = []
      audioContext = null
      audioCanvas = null
      audioWrap = null
      host = null
    }

    return {
      id: 'monet',
      mount: mount,
      setTheme: setTheme,
      setLines: setLines,
      setFontScale: setFontScale,
      tick: tick,
      destroy: destroy
    }
  }

  window.FoliaModeMonet = { create: createMode }
})()
