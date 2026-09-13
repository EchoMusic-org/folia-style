// 商籁模式·排版：移植自 folia-major
//   sonnet/sonnetTypographyRoles.ts（与版式模板解耦的确定性强调角色选取）
//   sonnet/sonnetTypographyLayout.ts（基于精确盒测量的 PV 动态排版版式）
//   sonnet/sonnetGlyphLayout.ts（解析器字形时间 → 最终字形坐标与入场向量）
//   sonnet/sonnetCameraTracking.ts（可选驱动的镜头字形选取与绝对时间焦点）
// 测量使用 window.Pretext（prepareWithSegments/layoutWithLines），缺失时回退 canvas measureText。
(function () {
  'use strict'

  var Core = window.FoliaSonnetCore

  // ---------- 排版角色（原版 sonnetTypographyRoles.ts） ----------
  function isSonnetEmphasisRole(role) {
    return role === 'hero' || role === 'semi-hero'
  }

  // 自动模式使用 Sonnet 的设计角色字重，或用户的全局手动覆盖
  function resolveSonnetRoleFontWeight(configuredFontWeight, role) {
    var manualWeight = Core.normalizeFontWeight(configuredFontWeight)
    if (manualWeight !== null) return manualWeight
    if (isSonnetEmphasisRole(role)) return 900
    return role === 'decoration' ? 300 : 700
  }

  function getSonnetVisibleSegmentLength(segment) {
    return segment.graphemes.filter(function (item) { return item.char.trim().length > 0 }).length
  }

  function scoreSonnetHeroSegment(segment) {
    var lengthScore = Math.min(getSonnetVisibleSegmentLength(segment), 8) * 14
    var durationScore = Math.min(2.5, Math.max(0, segment.endTime - segment.startTime)) * 18
    return lengthScore + durationScore
  }

  function findSonnetHeroSegmentIndex(segments) {
    var bestIndex = -1
    for (var i = 0; i < segments.length; i += 1) {
      if (segments[i].isWordLike) { bestIndex = i; break }
    }
    var bestScore = -Infinity
    segments.forEach(function (segment, index) {
      if (!segment.isWordLike || getSonnetVisibleSegmentLength(segment) === 0) return
      var score = scoreSonnetHeroSegment(segment)
      if (score > bestScore) {
        bestScore = score
        bestIndex = index
      }
    })
    return Math.max(0, bestIndex)
  }

  // 次强调约束：强调词需要间距、实词胜过虚词、只有足够长的行才配副重音
  var SEMI_HERO_MIN_GAP = 2
  var SEMI_HERO_MIN_VISIBLE_LENGTH = 2
  var SEMI_HERO_MIN_LINE_WORDS = 4
  var SEMI_HERO_SCORE_RATIO = 0.35
  var SEMI_HERO_MULTI_WORD_COUNT = 9

  // 在 hero 倾斜方向的另一侧挑选次强调词，保持构图平衡；长行在另一侧赢得第二重音
  function findSonnetSemiHeroSegmentIndices(segments, heroIndex) {
    var hero = segments[heroIndex]
    if (!hero) return []
    var wordLikeCount = segments.filter(function (segment) {
      return segment.isWordLike && getSonnetVisibleSegmentLength(segment) > 0
    }).length
    if (wordLikeCount < SEMI_HERO_MIN_LINE_WORDS) return []

    var threshold = scoreSonnetHeroSegment(hero) * SEMI_HERO_SCORE_RATIO
    var candidates = []
    segments.forEach(function (segment, index) {
      if (index !== heroIndex
        && segment.isWordLike
        && getSonnetVisibleSegmentLength(segment) >= SEMI_HERO_MIN_VISIBLE_LENGTH
        && Math.abs(index - heroIndex) >= SEMI_HERO_MIN_GAP
        && scoreSonnetHeroSegment(segment) >= threshold) {
        candidates.push({ segment: segment, index: index })
      }
    })
    if (candidates.length === 0) return []

    var bestOf = function (list) {
      var best = null
      list.forEach(function (item) {
        if (!best || scoreSonnetHeroSegment(item.segment) > scoreSonnetHeroSegment(best.segment)) best = item
      })
      return best
    }

    var heroLeansEarly = heroIndex <= (segments.length - 1) / 2
    var primarySide = candidates.filter(function (entry) {
      return heroLeansEarly ? entry.index > heroIndex : entry.index < heroIndex
    })
    var secondarySide = candidates.filter(function (entry) {
      return heroLeansEarly ? entry.index < heroIndex : entry.index > heroIndex
    })

    var picks = []
    var primary = bestOf(primarySide) || bestOf(secondarySide)
    if (primary) picks.push(primary.index)
    if (wordLikeCount >= SEMI_HERO_MULTI_WORD_COUNT && primary) {
      var secondary = bestOf(secondarySide.filter(function (entry) {
        return Math.abs(entry.index - primary.index) >= SEMI_HERO_MIN_GAP
      }))
      if (secondary) picks.push(secondary.index)
    }
    return picks.sort(function (first, second) { return first - second })
  }

  function findSonnetSemiHeroSegmentIndex(segments, heroIndex) {
    var indices = findSonnetSemiHeroSegmentIndices(segments, heroIndex)
    return indices.length > 0 ? indices[0] : -1
  }

  // ---------- 文本测量（原版 sonnetTypographyLayout.ts 的 measureText） ----------
  // 所有调用方共享记忆化。fontSpec 描述字重/字号/字族，键完全自描述。
  var MEASURE_CACHE_LIMIT = 20000
  var measureCache = new Map()
  var measureCanvas = null

  function measureTextWithPretext(text, fontSpec, fontSize) {
    var pretext = window.Pretext
    if (pretext && typeof pretext.prepareWithSegments === 'function' && typeof pretext.layoutWithLines === 'function') {
      try {
        var layout = pretext.layoutWithLines(pretext.prepareWithSegments(text || ' ', fontSpec), 99999, fontSize * 1.2)
        if (layout && layout.lines && layout.lines[0] && layout.lines[0].width !== undefined) {
          return layout.lines[0].width
        }
      } catch (e) { /* 走下方回退 */ }
    }
    if (!measureCanvas) measureCanvas = document.createElement('canvas')
    var context = measureCanvas.getContext('2d')
    if (!context) return text.length * fontSize * 0.6
    context.font = fontSpec
    return context.measureText(text || ' ').width
  }

  function measureText(text, fontSpec, fontSize) {
    var key = fontSpec + '|' + fontSize + '|' + text
    var cached = measureCache.get(key)
    if (cached !== undefined) return cached
    var width
    try {
      width = measureTextWithPretext(text, fontSpec, fontSize)
    } catch (e) {
      width = text.length * fontSize * 0.6
    }
    // 纯 FIFO 淘汰：条目重算代价相同，策略只需约束内存
    if (measureCache.size >= MEASURE_CACHE_LIMIT) {
      var oldest = measureCache.keys().next()
      if (!oldest.done) measureCache.delete(oldest.value)
    }
    measureCache.set(key, width)
    return width
  }

  // ---------- 版式主流程（原版 sonnetTypographyLayout.ts） ----------
  function isSonnetLayoutSegment(segment) {
    return segment.text.trim().length > 0
  }

  var CJK_TEXT = /[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/u

  function shouldRotateNonCjkSegment(segment, vertical) {
    return vertical
      && segment.graphemes.filter(function (item) { return item.char.trim().length > 0 }).length > 1
      && !CJK_TEXT.test(segment.text)
  }

  function verticalText(segment) {
    var chars = segment.graphemes.length
      ? segment.graphemes.map(function (item) { return item.char })
      : Array.from(segment.text)
    return chars.join('\n')
  }

  // 输入与原版 SonnetTypographyLayoutOptions 对齐
  function resolveSonnetTypographyLayout(options) {
    var lines = options.lines
    var shotKind = options.shotKind
    var width = options.width
    var height = options.height
    var baseFontSize = options.baseFontSize
    var fontFamily = options.fontFamily
    var fontWeight = options.fontWeight
    var segments = []
    lines.forEach(function (lineSegs) {
      lineSegs.forEach(function (seg) { segments.push(seg) })
    })

    var offset = 0
    var heroIndices = []
    var semiHeroIndices = []
    lines.forEach(function (lineSegs) {
      var localHero = findSonnetHeroSegmentIndex(lineSegs)
      var globalHero = offset + localHero
      var localSemiHeroes = findSonnetSemiHeroSegmentIndices(lineSegs, localHero)
      heroIndices.push(globalHero)
      localSemiHeroes.forEach(function (localSemiHero) { semiHeroIndices.push(offset + localSemiHero) })
      offset += lineSegs.length
    })

    var heroIndex = findSonnetHeroSegmentIndex(segments)
    var midpoints = segments.map(function (segment) { return (segment.startTime + segment.endTime) / 2 })
    var timelineStart = Math.min.apply(null, midpoints)
    var timelineEnd = Math.max.apply(null, midpoints)
    var timelineDuration = timelineEnd - timelineStart
    var phases = midpoints.map(function (midpoint, index) {
      return timelineDuration > 0.001
        ? (midpoint - timelineStart) / timelineDuration
        : index / Math.max(1, segments.length - 1)
    })
    var heroPhase = heroIndex < phases.length ? phases[heroIndex] : 0.5

    // 版式变化的确定性伪随机
    var layoutVariantSeed = segments.reduce(function (acc, seg) { return acc + (seg.text.trim().length || 1) }, 0) + segments.length
    var posterLayoutSeed = Core.hashSonnetSeed(segments.map(function (segment) { return segment.text }).join('\u241f'))
    var editorialVariant = layoutVariantSeed % 5 // 扩展为 5 个变体（0-4，含徽标卡）
    var ribbonVariant = layoutVariantSeed % 3
    var tableauVariant = layoutVariantSeed % 4 // 扩展为 4 个变体（0-3，含横排卡片）
    var collageVariant = layoutVariantSeed % 3 // 扩展为 3 个环形/螺线拼贴变体

    var secondaryHeroIndex = -1
    if (editorialVariant === 3 && segments.length > 2) {
      var bestScore = -Infinity
      segments.forEach(function (segment, index) {
        if (index === heroIndex || !segment.isWordLike || getSonnetVisibleSegmentLength(segment) === 0) return
        var distanceBonus = Math.abs(index - heroIndex) > 1 ? 50 : 0
        var score = scoreSonnetHeroSegment(segment) + distanceBonus
        if (score > bestScore) {
          bestScore = score
          secondaryHeroIndex = index
        }
      })
      if (secondaryHeroIndex === -1) editorialVariant = 0
    } else if (editorialVariant === 3) {
      editorialVariant = 0
    } else if (editorialVariant === 4 && segments.length < 2) {
      editorialVariant = 2 // 句子太短放不下徽标卡时回退杂志刊头
    }

    // 1. 分配风格并测量盒子
    var boxes = segments.map(function (segment, index) {
      var isHero = heroIndices.indexOf(index) >= 0 || (index === secondaryHeroIndex && shotKind === 'editorial-column' && editorialVariant === 3)
      var isSemiHero = semiHeroIndices.indexOf(index) >= 0 && !isHero
      var isEmphasized = isHero || isSemiHero
      var heroFontScale = 1.0
      var supportFontScale = 1.0
      var vertical = false
      var rotation = 0

      switch (shotKind) {
        case 'editorial-column':
          if (editorialVariant === 3) {
            heroFontScale = 3.8
            supportFontScale = 1.3
            vertical = false
          } else if (editorialVariant === 4) {
            // 徽标卡：hero 巨型竖排立柱居左右，支持文本多行横排块居另一侧
            heroFontScale = 4.2
            supportFontScale = 1.25
            vertical = isEmphasized
          } else {
            heroFontScale = editorialVariant === 2 ? 3.2 : 4.0
            supportFontScale = 1.2
            vertical = isEmphasized && editorialVariant !== 2
          }
          break
        case 'type-impact':
          heroFontScale = 5.5
          supportFontScale = 1.5
          break
        case 'fragment-collage':
          heroFontScale = 3.2
          supportFontScale = 1.35
          vertical = isSemiHero || (index % 4) === 0
          break
        case 'tracking-ribbon':
          heroFontScale = 3.5
          supportFontScale = 1.5
          break
        case 'mask-reveal':
          heroFontScale = 4.5
          supportFontScale = 1.6
          vertical = isEmphasized
          break
        case 'poster-blocks':
          heroFontScale = 4.4
          supportFontScale = 1.15
          break
        case 'quiet-tableau':
        default:
          heroFontScale = 3.0
          supportFontScale = 1.15
          vertical = isEmphasized && (tableauVariant === 0 || tableauVariant === 1)
          break
      }

      var fontScale = isHero
        ? heroFontScale
        : isSemiHero
          ? Math.max(supportFontScale * 1.35, heroFontScale * 0.72)
          : supportFontScale

      // 非 CJK 词在竖排构图中使用水平字形步进并整体旋转。
      // 在测量前解析书写模式，让收排使用渲染后的边界。
      var rotatesNonCjkSegment = shouldRotateNonCjkSegment(segment, vertical)
      if (rotatesNonCjkSegment) {
        vertical = false
        rotation += Math.PI / 2
      }

      // 防止巨型文本溢出 82% 屏宽，计算 fitScale
      var displayText = vertical ? verticalText(segment) : segment.text
      var renderRole = isHero ? 'hero' : isSemiHero ? 'semi-hero' : 'support'
      var renderWeight = resolveSonnetRoleFontWeight(fontWeight, renderRole)

      var targetFontSize = baseFontSize * fontScale
      var fontSpec = renderWeight + ' ' + targetFontSize + 'px ' + fontFamily

      var horizontalAdvance
      if (rotatesNonCjkSegment) {
        horizontalAdvance = segment.graphemes.reduce(function (sum, item) {
          return item.char.trim().length > 0
            ? sum + Math.max(targetFontSize * 0.2, measureText(item.char, fontSpec, targetFontSize))
            : sum
        }, 0)
      } else {
        horizontalAdvance = measureText(displayText, fontSpec, targetFontSize)
      }

      var measuredWidth = rotatesNonCjkSegment ? targetFontSize * 1.2 : horizontalAdvance
      var measuredHeight = rotatesNonCjkSegment ? horizontalAdvance : targetFontSize * 1.2

      if (vertical) {
        // CJK 竖排列：逐字形测量，让收排与字形渲染器产出同样的边界——
        // 字形沿列以 fontSize * 0.9 步进并保持列轴居中
        var columnChars0 = segment.graphemes.length
          ? segment.graphemes.map(function (item) { return item.char })
          : Array.from(segment.text)
        var glyphAdvances0 = columnChars0
          .filter(function (char) { return char.trim().length > 0 })
          .map(function (char) { return Math.max(targetFontSize * 0.2, measureText(char, fontSpec, targetFontSize)) })
        measuredWidth = glyphAdvances0.length ? Math.max.apply(null, glyphAdvances0) : targetFontSize
        measuredHeight = Math.max(1, columnChars0.length) * targetFontSize * 0.9
      }

      // 超出屏幕边界时安全降档
      var maxW = width * 0.82
      var maxH = height * 0.82
      var fitScale = 1.0
      if (measuredWidth > maxW) fitScale = Math.min(fitScale, maxW / measuredWidth)
      if (measuredHeight > maxH) fitScale = Math.min(fitScale, maxH / measuredHeight)

      if (fitScale < 1.0) {
        targetFontSize *= fitScale
        fontScale *= fitScale
        measuredWidth *= fitScale
        measuredHeight *= fitScale
      }

      // 海报块可能把 CJK 段翻成竖排列。逐字形测量该朝向，
      // 让收排与字形渲染器产出同样的边界：字形沿列以 fontSize * 0.9 步进并保持列轴居中
      var posterVerticalDisplayText
      var posterVerticalMeasuredWidth
      var posterVerticalMeasuredHeight
      var posterVerticalFontScale
      if (shotKind === 'poster-blocks' && CJK_TEXT.test(segment.text)) {
        var columnChars = segment.graphemes.length
          ? segment.graphemes.map(function (item) { return item.char })
          : Array.from(segment.text)
        var glyphAdvances = columnChars
          .filter(function (char) { return char.trim().length > 0 })
          .map(function (char) { return Math.max(targetFontSize * 0.2, measureText(char, fontSpec, targetFontSize)) })
        var columnWidth = glyphAdvances.length ? Math.max.apply(null, glyphAdvances) : targetFontSize
        var columnHeight = Math.max(1, columnChars.length) * targetFontSize * 0.9
        var verticalFit = Math.min(1, maxW / columnWidth, maxH / columnHeight)
        columnWidth *= verticalFit
        columnHeight *= verticalFit
        posterVerticalDisplayText = verticalText(segment)
        posterVerticalMeasuredWidth = columnWidth
        posterVerticalMeasuredHeight = columnHeight
        posterVerticalFontScale = fontScale * verticalFit
      }

      return {
        index: index,
        isHero: isHero,
        isSemiHero: isSemiHero,
        displayText: displayText,
        verticalDisplayText: posterVerticalDisplayText,
        verticalMeasuredWidth: posterVerticalMeasuredWidth,
        verticalMeasuredHeight: posterVerticalMeasuredHeight,
        verticalFontScale: posterVerticalFontScale,
        fontScale: fontScale,
        vertical: vertical,
        layoutDirection: 'horizontal',
        rotation: rotation,
        measuredWidth: measuredWidth,
        measuredHeight: measuredHeight,
        timingPhase: phases[index],
        relativePhase: phases[index] - heroPhase,
        role: undefined,
        x: 0,
        y: 0,
        enterX: 0,
        enterY: 0
      }
    })

    // 2. 精确版面收排：每个 shotKind 按时间线扫描顺序流动测量盒；
    // 非海报分支共享 gap 常量与全局缩放重试
    var heroBox = boxes[heroIndex]
    if (heroBox) {
      if (shotKind === 'poster-blocks') {
        window.FoliaSonnetFlowLayouts.layoutSonnetPosterBlocks(boxes, width, height, baseFontSize, posterLayoutSeed)
      } else {
        var gaps = window.FoliaSonnetFlowLayouts.resolveSonnetFlowGaps(baseFontSize)
        var flowCtx = { boxes: boxes, heroIndex: heroIndex, width: width, height: height, flowGap: gaps.flowGap, stackGap: gaps.stackGap }
        if (shotKind === 'quiet-tableau') window.FoliaSonnetFlowLayouts.layoutQuietTableau(flowCtx, tableauVariant)
        else if (shotKind === 'tracking-ribbon') window.FoliaSonnetFlowLayouts.layoutTrackingRibbon(flowCtx, ribbonVariant)
        else if (shotKind === 'editorial-column') window.FoliaSonnetFlowLayouts.layoutEditorialColumn(flowCtx, editorialVariant, secondaryHeroIndex)
        else if (shotKind === 'fragment-collage') window.FoliaSonnetFlowLayouts.layoutFragmentCollage(flowCtx, collageVariant)
        else window.FoliaSonnetFlowLayouts.layoutCrossStack(flowCtx)
      }

      heroBox.enterX = 0
      heroBox.enterY = height * 0.15

      var decorations = []
      if (shotKind !== 'quiet-tableau' && shotKind !== 'poster-blocks') {
        var allHeroes = boxes.filter(function (b) { return b.isHero })
        allHeroes.forEach(function (hBox, idx) {
          decorations.push({
            index: hBox.index,
            isHero: false,
            isSemiHero: false,
            displayText: hBox.displayText,
            verticalDisplayText: hBox.verticalDisplayText,
            verticalMeasuredWidth: hBox.verticalMeasuredWidth,
            verticalMeasuredHeight: hBox.verticalMeasuredHeight,
            verticalFontScale: hBox.verticalFontScale,
            fontScale: Math.max(2.8, Math.min(hBox.fontScale * 3.5, 5.5)),
            vertical: false,
            layoutDirection: 'horizontal',
            rotation: -0.15 + (idx % 2 === 0 ? 0 : 0.05),
            measuredWidth: hBox.measuredWidth,
            measuredHeight: hBox.measuredHeight,
            timingPhase: hBox.timingPhase,
            relativePhase: hBox.relativePhase,
            role: 'decoration',
            x: hBox.x - width * (0.1 - idx * 0.03),
            y: hBox.y - height * (0.05 - idx * 0.02),
            enterX: -width * 0.05,
            enterY: -height * 0.05
          })
        })
        if (boxes.length > 1 && allHeroes.length > 0) {
          var dec2 = boxes[boxes.length - 1].isHero ? boxes[0] : boxes[boxes.length - 1]
          decorations.push({
            index: dec2.index,
            isHero: false,
            isSemiHero: false,
            displayText: dec2.displayText,
            verticalDisplayText: dec2.verticalDisplayText,
            verticalMeasuredWidth: dec2.verticalMeasuredWidth,
            verticalMeasuredHeight: dec2.verticalMeasuredHeight,
            verticalFontScale: dec2.verticalFontScale,
            fontScale: Math.max(1.8, Math.min(allHeroes[0].fontScale * 2.2, 3.5)),
            vertical: false,
            layoutDirection: 'horizontal',
            rotation: 0.08,
            measuredWidth: dec2.measuredWidth,
            measuredHeight: dec2.measuredHeight,
            timingPhase: dec2.timingPhase,
            relativePhase: dec2.relativePhase,
            role: 'decoration',
            x: allHeroes[0].x + width * 0.25,
            y: allHeroes[0].y + height * 0.15,
            enterX: width * 0.05,
            enterY: height * 0.05
          })
        }
      }

      decorations.forEach(function (d) { boxes.unshift(d) })
    }

    return boxes.map(function (box) {
      return {
        segmentIndex: box.index,
        displayText: box.displayText,
        role: box.role || (box.isHero ? 'hero' : box.isSemiHero ? 'semi-hero' : 'support'),
        fontScale: box.fontScale,
        measuredWidth: box.measuredWidth,
        measuredHeight: box.measuredHeight,
        x: box.x,
        y: box.y,
        rotation: box.rotation,
        enterX: box.enterX,
        enterY: box.enterY,
        vertical: box.vertical,
        layoutDirection: box.layoutDirection,
        timingPhase: box.timingPhase
      }
    })
  }

  // ---------- 字形布局（原版 sonnetGlyphLayout.ts） ----------
  function resolveSonnetGlyphMotionDuration(motionWindow) {
    var shotDuration = Math.max(0.001, motionWindow.endTime - motionWindow.startTime)
    var preferred = Math.min(1.8, Math.max(0.65, shotDuration * 0.42))
    return Math.min(preferred, shotDuration * 0.72)
  }

  function buildSonnetGlyphLayout(segment, placement, fontSize, measureGlyph, motionWindow) {
    var fallbackChars = Array.from(segment.text)
    var graphemes
    if (segment.graphemes.length) {
      graphemes = segment.graphemes
    } else {
      graphemes = fallbackChars.map(function (char, index) {
        return {
          char: char,
          startTime: segment.startTime + (segment.endTime - segment.startTime) * index / Math.max(1, fallbackChars.length),
          endTime: segment.startTime + (segment.endTime - segment.startTime) * (index + 1) / Math.max(1, fallbackChars.length)
        }
      })
    }
    var advances = graphemes.map(function (item) {
      return placement.vertical ? fontSize * 0.9 : Math.max(fontSize * 0.2, measureGlyph(item.char))
    })
    var totalAdvance = advances.reduce(function (sum, advance) { return sum + advance }, 0)
    var motionDuration = resolveSonnetGlyphMotionDuration(motionWindow)
    var cursor = -totalAdvance / 2
    return graphemes.map(function (grapheme, index) {
      var advance = advances[index]
      var localX = placement.vertical ? 0 : cursor + advance / 2
      var localY = placement.vertical ? cursor + advance / 2 : 0
      cursor += advance
      var cosine = Math.cos(placement.rotation)
      var sine = Math.sin(placement.rotation)
      var stagger = index % 2 === 0 ? -1 : 1
      var startTime = grapheme.startTime
      var settleTime = startTime + motionDuration
      return {
        char: grapheme.char,
        baseX: placement.x + localX * cosine - localY * sine,
        baseY: placement.y + localX * sine + localY * cosine,
        enterX: placement.enterX + (placement.vertical ? stagger * fontSize * 0.28 : 0),
        enterY: placement.enterY + (placement.vertical ? 0 : stagger * fontSize * 0.24),
        entryRotation: stagger * (isSonnetEmphasisRole(placement.role) ? 0.055 : 0.035),
        startTime: startTime,
        settleTime: Math.max(startTime, settleTime)
      }
    })
  }

  // ---------- 镜头追踪（原版 sonnetCameraTracking.ts） ----------
  // 只选取可能驱动镜头的渲染字形
  function resolveSonnetCameraTrackingGlyphs(glyphs) {
    return glyphs.filter(function (glyph) { return glyph.isBackgroundShape !== true })
  }

  // 只对语义镜头字形插值；装饰性渲染节点必须先被过滤
  function resolveSonnetSegmentCameraFocus(glyphs, time, trackingFactor) {
    if (trackingFactor === undefined) trackingFactor = 0.5
    if (glyphs.length === 0) return { x: 0, y: 0 }
    var first = glyphs[0]
    var last = glyphs[glyphs.length - 1]
    var segCenterX = (first.baseX + last.baseX) / 2
    var segCenterY = (first.baseY + last.baseY) / 2
    var applyFactor = function (exactX, exactY) {
      return {
        x: segCenterX + (exactX - segCenterX) * trackingFactor,
        y: segCenterY + (exactY - segCenterY) * trackingFactor
      }
    }

    if (time <= first.startTime) return applyFactor(first.baseX, first.baseY)
    if (time >= last.startTime) return applyFactor(last.baseX, last.baseY)

    for (var index = 0; index < glyphs.length - 1; index += 1) {
      var current = glyphs[index]
      var next = glyphs[index + 1]
      if (time < current.startTime || time > next.startTime) continue
      var progress = (time - current.startTime) / Math.max(0.001, next.startTime - current.startTime)
      return applyFactor(
        current.baseX + (next.baseX - current.baseX) * progress,
        current.baseY + (next.baseY - current.baseY) * progress
      )
    }
    return applyFactor(first.baseX, first.baseY)
  }

  window.FoliaSonnetTypography = {
    isSonnetEmphasisRole: isSonnetEmphasisRole,
    resolveSonnetRoleFontWeight: resolveSonnetRoleFontWeight,
    getSonnetVisibleSegmentLength: getSonnetVisibleSegmentLength,
    scoreSonnetHeroSegment: scoreSonnetHeroSegment,
    findSonnetHeroSegmentIndex: findSonnetHeroSegmentIndex,
    findSonnetSemiHeroSegmentIndex: findSonnetSemiHeroSegmentIndex,
    findSonnetSemiHeroSegmentIndices: findSonnetSemiHeroSegmentIndices,
    isSonnetLayoutSegment: isSonnetLayoutSegment,
    measureText: measureText,
    resolveSonnetTypographyLayout: resolveSonnetTypographyLayout,
    resolveSonnetGlyphMotionDuration: resolveSonnetGlyphMotionDuration,
    buildSonnetGlyphLayout: buildSonnetGlyphLayout,
    resolveSonnetCameraTrackingGlyphs: resolveSonnetCameraTrackingGlyphs,
    resolveSonnetSegmentCameraFocus: resolveSonnetSegmentCameraFocus
  }
})()
