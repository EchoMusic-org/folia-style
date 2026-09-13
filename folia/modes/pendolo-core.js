// 时计模式核心工具库：移植自 folia-major src/components/visualizer/pendolo/ 的纯函数模块
//   - pendoloMotionProfile.ts（强度运动档位 / 合唱强调参数）
//   - pendoloTimeline.ts（锚点回退 + 弧外淡出）
//   - pendoloGeometry.ts（表盘弧形轮盘布局）
//   - pendoloTextLayout.ts（pretext 换行排版，缺失时回退 canvas 贪婪折行）
//   - pendoloColorRuns.ts（同色字形合并 run）
//   - monetLyricsModel.ts 的 measureMonetGraphemeOffsets（字形累计宽度，供逐字扫过填充）
// 原版 types.ts 的 DEFAULT_PENDOLO_TUNING 在此内联为常量。
// 挂载 window.FoliaPendoloCore，由 modes/pendolo.js（入口）按依赖顺序使用。
(function () {
  'use strict'

  var GraphemeTiming = window.FoliaGraphemeTiming
  var WordColoring = window.FoliaWordColoring

  // ---------- 原版 types.ts DEFAULT_PENDOLO_TUNING ----------
  var DEFAULT_PENDOLO_TUNING = {
    arcRadius: 0.42,
    arcAngleDeg: 100,
    wheelCenterX: 0.0,
    wheelCenterY: 0.50,
    tickSnappiness: 2.0,
    activeScale: 1.25,
    showGearDecor: 'subtle',
    showCenterGradient: true,
    showCoverOnWatchFace: false,
    enableLineGlow: false
  }

  // ---------- 原版 pendoloMotionProfile.ts ----------
  // 按主题动画强度（calm/normal/chaotic）分档的运动参数
  var PENDOLO_MOTION_PROFILES = {
    calm: {
      balanceSpeedMultiplier: 0.72,
      balanceAmplitudeMultiplier: 0.58,
      bassResponseMultiplier: 0.62,
      escapementSpringMultiplier: 0.72,
      escapementDampingMultiplier: 1.2,
      chorusHaloOpacity: 0.22,
      chorusHaloScale: 1.012,
      chorusGlowMultiplier: 0.72,
      chorusTransitionDuration: 0.52
    },
    normal: {
      balanceSpeedMultiplier: 1,
      balanceAmplitudeMultiplier: 1,
      bassResponseMultiplier: 1,
      escapementSpringMultiplier: 1,
      escapementDampingMultiplier: 1,
      chorusHaloOpacity: 0.34,
      chorusHaloScale: 1.026,
      chorusGlowMultiplier: 1,
      chorusTransitionDuration: 0.42
    },
    chaotic: {
      balanceSpeedMultiplier: 1.3,
      balanceAmplitudeMultiplier: 1.42,
      bassResponseMultiplier: 1.38,
      escapementSpringMultiplier: 1.3,
      escapementDampingMultiplier: 0.84,
      chorusHaloOpacity: 0.5,
      chorusHaloScale: 1.045,
      chorusGlowMultiplier: 1.42,
      chorusTransitionDuration: 0.3
    }
  }

  // 解析当前强度的稳定运动参数
  function resolvePendoloMotionProfile(intensity) {
    return intensity === 'calm' || intensity === 'chaotic'
      ? PENDOLO_MOTION_PROFILES[intensity]
      : PENDOLO_MOTION_PROFILES.normal
  }

  // 合唱强调限定在当前正在演唱的行（插件数据无合唱标记，恒为非激活，分支保留）
  function resolvePendoloChorusPresentation(isChorus, isPlaybackActive, profile) {
    var isActive = Boolean(isChorus && isPlaybackActive)
    return {
      isActive: isActive,
      accentMix: isActive ? 0.58 : 0.32,
      haloOpacity: isActive ? profile.chorusHaloOpacity : 0,
      haloScale: isActive ? profile.chorusHaloScale : 1,
      glowMultiplier: isActive ? profile.chorusGlowMultiplier : 0,
      transitionDuration: profile.chorusTransitionDuration
    }
  }

  // ---------- 原版 pendoloTimeline.ts ----------
  // 播放位置不在任何计时行内时，解析轮盘锚点：
  // 有效行 → 当前行；未观察过行 → -1；超过末行渲染结束 → lines.length（锚点滑出）；否则停在上一个有效行 +0.5
  function resolvePendoloFallbackAnchorIndex(lines, currentLineIndex, lastValidLineIndex, hasObservedLine, currentTime) {
    if (currentLineIndex >= 0 && currentLineIndex < lines.length) {
      return currentLineIndex
    }

    if (!hasObservedLine) {
      return -1
    }

    var finalLine = lines.length > 0 ? lines[lines.length - 1] : null
    var finalRenderEndTime = finalLine
      ? (finalLine.renderHints && finalLine.renderHints.renderEndTime !== undefined
        ? finalLine.renderHints.renderEndTime
        : finalLine.endTime)
      : undefined
    if (finalRenderEndTime !== undefined && currentTime > finalRenderEndTime) {
      return lines.length
    }

    return lastValidLineIndex + 0.5
  }

  var PENDOLO_VISIBLE_ARC_DEG = 110
  var PENDOLO_EDGE_FADE_DEG = 28

  // 只在未换算弧角进入右侧可见弧段时淡入（越界直接隐藏）
  function resolvePendoloRotatingLineOpacity(baseAngleDeg, wheelRotationDeg, baseOpacity) {
    var visibleAngleDeg = Math.abs(baseAngleDeg + wheelRotationDeg)
    if (visibleAngleDeg >= PENDOLO_VISIBLE_ARC_DEG) return 0
    var edgeProgress = Math.min(1, (PENDOLO_VISIBLE_ARC_DEG - visibleAngleDeg) / PENDOLO_EDGE_FADE_DEG)
    return baseOpacity * edgeProgress
  }

  // ---------- 原版 pendoloGeometry.ts ----------
  // 计算轮盘几何：沿擒纵弧布置歌词行（右侧半圆 ±90°， focal 行角度 = 0）
  function calculatePendoloWheelLayout(
    lines,
    targetLineIndex,
    escapementAngleOffsetRad,
    viewportWidth,
    viewportHeight,
    tuning,
    radiusOffsetPx,
    lineBlockHeights
  ) {
    if (radiusOffsetPx === undefined) radiusOffsetPx = 0
    var centerX = viewportWidth * tuning.wheelCenterX
    var centerY = viewportHeight * tuning.wheelCenterY
    var baseRadius = Math.min(viewportWidth, viewportHeight) * tuning.arcRadius + radiusOffsetPx

    // 相邻歌词行沿弧的角度步长（弧度）
    var totalArcRad = (tuning.arcAngleDeg * Math.PI) / 180
    var visibleWindowCount = 9 // 弧窗内可见行数
    var angleStepRad = totalArcRad / Math.max(1, visibleWindowCount - 1)

    var isIntegerTarget = Number.isInteger(targetLineIndex)
    var activeIndex = isIntegerTarget && targetLineIndex >= 0 && targetLineIndex < lines.length
      ? targetLineIndex
      : -1
    var hasActive = activeIndex >= 0
    var items = []

    // 渲染窗口的参考中心
    var centerRef = Math.max(0, Math.min(lines.length - 1, Math.floor(targetLineIndex >= 0 ? targetLineIndex : 0)))
    // 足够宽的索引窗口；实际可见性由 ±90° 角度门控（只渲染右半圆）
    var windowStart = Math.max(0, centerRef - 8)
    var windowEnd = Math.min(lines.length - 1, centerRef + 8)
    var visualAngles = new Map()

    if (Number.isInteger(targetLineIndex) && targetLineIndex >= windowStart && targetLineIndex <= windowEnd) {
      var anchorIndex = targetLineIndex
      visualAngles.set(anchorIndex, 0)
      for (var index = anchorIndex + 1; index <= windowEnd; index += 1) {
        var previousHeight = lineBlockHeights ? (lineBlockHeights[index - 1] || 0) : 0
        var currentHeight = lineBlockHeights ? (lineBlockHeights[index] || 0) : 0
        var spacing = Math.max(angleStepRad, (previousHeight + currentHeight + 24) / (2 * baseRadius))
        visualAngles.set(index, (visualAngles.get(index - 1) || 0) + spacing)
      }
      for (var backIndex = anchorIndex - 1; backIndex >= windowStart; backIndex -= 1) {
        var nextHeight = lineBlockHeights ? (lineBlockHeights[backIndex + 1] || 0) : 0
        var currentHeight2 = lineBlockHeights ? (lineBlockHeights[backIndex] || 0) : 0
        var spacing2 = Math.max(angleStepRad, (nextHeight + currentHeight2 + 24) / (2 * baseRadius))
        visualAngles.set(backIndex, (visualAngles.get(backIndex + 1) || 0) - spacing2)
      }
    }

    for (var i = windowStart; i <= windowEnd; i++) {
      var line = lines[i]
      if (!line) continue

      var distanceIndex = i - targetLineIndex
      // focal 基准角为 0（水平向右）；未来行向下弯（正角），过去行向上弯（负角）
      var rawAngleRad = (visualAngles.has(i) ? visualAngles.get(i) : distanceIndex * angleStepRad) + escapementAngleOffsetRad

      // 只渲染右半圆（相对 focal 轴 ±90°）内的行
      if (Math.abs(rawAngleRad) >= Math.PI / 2) continue

      // 屏幕笛卡尔坐标（中心在左缘）
      var x = centerX + baseRadius * Math.cos(rawAngleRad)
      var y = centerY + baseRadius * Math.sin(rawAngleRad)

      var isActive = hasActive && i === activeIndex
      var absDistance = Math.abs(distanceIndex)

      // 透明度随离 focal 角度（0）的远近平滑衰减
      var alpha = Math.max(0.12, Math.pow(Math.cos(rawAngleRad * 0.75), 2.5) * (1 - absDistance * 0.18))

      // focal 行获得 activeScale 放大，相邻行平滑缩小
      var scale = isActive
        ? tuning.activeScale
        : Math.max(0.7, 1 - absDistance * 0.08)

      items.push({
        line: line,
        index: i,
        angleRad: rawAngleRad,
        angleDeg: (rawAngleRad * 180) / Math.PI,
        x: x,
        y: y,
        isActive: isActive,
        distanceFromActive: absDistance,
        alpha: alpha,
        scale: scale
      })
    }

    return items
  }

  // ---------- 测量辅助（Pretext 优先，canvas measureText 回退） ----------
  var measureCanvas = null

  function getMeasureContext(fontSpec) {
    if (!measureCanvas) measureCanvas = document.createElement('canvas')
    var ctx = measureCanvas.getContext('2d')
    if (ctx && fontSpec) ctx.font = fontSpec
    return ctx
  }

  // 原版 monetLyricsModel.measureTextWidthAtPx：单行文本在指定像素字号下的宽度
  function measureTextWidthAtPx(text, fontPx, fontSpec) {
    var pretext = window.Pretext
    if (pretext && typeof pretext.prepareWithSegments === 'function' && typeof pretext.layoutWithLines === 'function') {
      try {
        var prepared = pretext.prepareWithSegments(text || ' ', fontSpec)
        var layout = pretext.layoutWithLines(prepared, 99999, fontPx * 1.2)
        if (layout && layout.lines && layout.lines.length > 0 && Number.isFinite(layout.lines[0].width)) {
          return layout.lines[0].width
        }
      } catch (e) { /* 回退 canvas 测量 */ }
    }
    var ctx = getMeasureContext(fontSpec)
    if (ctx) return ctx.measureText(text || ' ').width
    return Math.max((text || '').length, 1) * fontPx * 0.6
  }

  // ---------- 原版 pendoloTextLayout.ts ----------
  // 构建稳定的视觉行，让逐字填充与纵向间距共用同一份换行结果
  var textLayoutCache = new Map()
  var TEXT_LAYOUT_CACHE_LIMIT = 240

  // canvas 贪婪折行回退（仅在 Pretext 缺失/异常时使用）：优先在空格处断行
  function wrapTextFallback(text, fontSpec, maxWidth, lineHeight) {
    var graphemes = GraphemeTiming.splitLyricGraphemes(text)
    var ctx = getMeasureContext(fontSpec)
    var measure = function (value) {
      if (ctx) return ctx.measureText(value).width
      return value.length * 16
    }
    var n = graphemes.length
    var outLines = []
    var start = 0
    while (start < n) {
      var cursorText = ''
      var lastFit = start
      var lastSpaceAfter = -1
      var hardBreak = false
      var i2 = start
      while (i2 < n) {
        var test = cursorText + graphemes[i2]
        if (i2 > start && measure(test) > maxWidth) { hardBreak = true; break }
        cursorText = test
        lastFit = i2 + 1
        if (graphemes[i2] === ' ') lastSpaceAfter = i2 + 1
        i2 += 1
      }
      var lineEnd
      if (hardBreak && lastSpaceAfter > start) lineEnd = lastSpaceAfter
      else lineEnd = lastFit
      if (lineEnd <= start) lineEnd = start + 1
      var lineStr = graphemes.slice(start, lineEnd).join('')
      outLines.push({
        text: lineStr,
        width: measure(lineStr),
        graphemeStart: start,
        graphemeEnd: lineEnd
      })
      start = lineEnd
    }
    if (outLines.length === 0) {
      outLines.push({ text: '', width: 0, graphemeStart: 0, graphemeEnd: 0 })
    }
    return {
      lines: outLines,
      lineHeight: lineHeight,
      height: Math.max(outLines.length, 1) * lineHeight
    }
  }

  function buildPendoloTextLayout(text, fontSpec, maxWidth, lineHeight) {
    var key = fontSpec + '|' + maxWidth + '|' + lineHeight + '|' + (text || ' ')
    var cached = textLayoutCache.get(key)
    if (cached) return cached

    var result = null
    var pretext = window.Pretext
    if (pretext && typeof pretext.prepareWithSegments === 'function' && typeof pretext.layoutWithLines === 'function') {
      try {
        var prepared = pretext.prepareWithSegments(text || ' ', fontSpec, {
          whiteSpace: 'pre-wrap'
        })
        var layout = pretext.layoutWithLines(prepared, Math.max(1, maxWidth), lineHeight)
        var graphemeCursor = 0
        var outLines = []
        for (var i = 0; i < layout.lines.length; i += 1) {
          var layoutLine = layout.lines[i]
          var graphemeCount = GraphemeTiming.splitLyricGraphemes(layoutLine.text).length
          outLines.push({
            text: layoutLine.text,
            width: layoutLine.width,
            graphemeStart: graphemeCursor,
            graphemeEnd: graphemeCursor + graphemeCount
          })
          graphemeCursor += graphemeCount
        }
        result = {
          lines: outLines,
          lineHeight: lineHeight,
          height: Math.max(outLines.length, 1) * lineHeight
        }
      } catch (e) { result = null }
    }
    if (!result) result = wrapTextFallback(text || ' ', fontSpec, maxWidth, lineHeight)

    if (textLayoutCache.size >= TEXT_LAYOUT_CACHE_LIMIT) {
      var oldestKey = textLayoutCache.keys().next().value
      textLayoutCache.delete(oldestKey)
    }
    textLayoutCache.set(key, result)
    return result
  }

  // ---------- 原版 monetLyricsModel.measureMonetGraphemeOffsets ----------
  // 构建字形累计偏移，让填充边缘逐字形扫过而不是整词跳变
  var graphemeOffsetsCache = new Map()
  var GRAPHEME_OFFSETS_CACHE_LIMIT = 420

  function measurePendoloGraphemeOffsets(text, fontPx, fontSpec) {
    var cacheKey = fontPx + '|' + fontSpec + '|' + text
    var cached = graphemeOffsetsCache.get(cacheKey)
    if (cached) return cached

    var graphemes = GraphemeTiming.splitLyricGraphemes(text)
    var offsets = new Array(graphemes.length + 1)
    for (var i = 0; i < offsets.length; i += 1) offsets[i] = 0
    for (var index = 1; index <= graphemes.length; index += 1) {
      offsets[index] = measureTextWidthAtPx(graphemes.slice(0, index).join(''), fontPx, fontSpec)
    }

    if (graphemeOffsetsCache.size >= GRAPHEME_OFFSETS_CACHE_LIMIT) {
      var oldestKey = graphemeOffsetsCache.keys().next().value
      graphemeOffsetsCache.delete(oldestKey)
    }
    graphemeOffsetsCache.set(cacheKey, offsets)
    return offsets
  }

  // ---------- 原版 pendoloColorRuns.ts ----------
  // 把解析出同色的相邻字形合并为一个 shaping 安全的文本 run
  function buildPendoloColorRuns(text, graphemeStart, tokenColors, fallbackColor) {
    var runs = []
    var graphemes = GraphemeTiming.splitLyricGraphemes(text)
    for (var localIndex = 0; localIndex < graphemes.length; localIndex += 1) {
      var grapheme = graphemes[localIndex]
      var color = tokenColors.get(String(graphemeStart + localIndex))
      if (color === undefined) color = fallbackColor
      var previous = runs.length > 0 ? runs[runs.length - 1] : null
      if (previous && previous.color === color) {
        previous.text += grapheme
        continue
      }
      runs.push({ key: (graphemeStart + localIndex) + '-' + color, text: grapheme, color: color })
    }
    return runs
  }

  // ---------- 原版 utils/lyrics/alternateText.ts（translation/romanization 直取部分） ----------
  function resolveSubtitleContentMode(mode, legacyShowTranslation) {
    return mode || (legacyShowTranslation === false ? 'none' : 'translation')
  }

  function resolveLyricAlternateText(source, mode) {
    if (!source || mode === 'none') return null
    var directText = mode === 'translation' ? source.translation : source.romanization
    return (directText && directText.trim()) || null
  }

  // ---------- 原版 pendoloGeometry.ts 的 measurePendoloLineWidth（原版导出但未被引用，保留对齐） ----------
  function measurePendoloLineWidth(text, fontSpec) {
    if (!text) return 0
    var pretext = window.Pretext
    if (pretext && typeof pretext.prepareWithSegments === 'function' && typeof pretext.layoutWithLines === 'function') {
      try {
        var prepared = pretext.prepareWithSegments(text, fontSpec)
        var layout = pretext.layoutWithLines(prepared, 2000, 32)
        if (layout && layout.lines && layout.lines.length > 0 && Number.isFinite(layout.lines[0].width)) {
          return layout.lines[0].width
        }
      } catch (e) { /* 回退估算 */ }
    }
    return text.length * 16
  }

  window.FoliaPendoloCore = {
    DEFAULT_PENDOLO_TUNING: DEFAULT_PENDOLO_TUNING,
    resolvePendoloMotionProfile: resolvePendoloMotionProfile,
    resolvePendoloChorusPresentation: resolvePendoloChorusPresentation,
    resolvePendoloFallbackAnchorIndex: resolvePendoloFallbackAnchorIndex,
    resolvePendoloRotatingLineOpacity: resolvePendoloRotatingLineOpacity,
    calculatePendoloWheelLayout: calculatePendoloWheelLayout,
    measurePendoloLineWidth: measurePendoloLineWidth,
    measureTextWidthAtPx: measureTextWidthAtPx,
    buildPendoloTextLayout: buildPendoloTextLayout,
    measurePendoloGraphemeOffsets: measurePendoloGraphemeOffsets,
    buildPendoloColorRuns: buildPendoloColorRuns,
    resolveSubtitleContentMode: resolveSubtitleContentMode,
    resolveLyricAlternateText: resolveLyricAlternateText
  }
})()
