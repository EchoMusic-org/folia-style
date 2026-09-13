// 商籁模式·场景构建：移植自 folia-major
//   sonnet/sonnetDebug.ts（布局开发期的调试覆盖与 shot 快照）
//   sonnet/sonnetTransitions.ts（快速、seek 稳定的单色场景转场，无色散）
//   sonnet/sonnetCredits.ts（末尾歌词之后的确定性片尾海报）
//   sonnet/sonnetSceneBuilder.ts（构建单个有界段落场景；播放期变更留在运行时控制器）
(function () {
  'use strict'

  var Core = window.FoliaSonnetCore
  var Typography = window.FoliaSonnetTypography
  var Filters = window.FoliaSonnetFilters
  var Decor = window.FoliaSonnetDecor
  var Text = window.FoliaSonnetText

  // ---------- 调试（原版 sonnetDebug.ts） ----------
  // 置 true 时在 shot 上叠加每个段落的测量收排盒
  var DEBUG_SONNET_MEASURED_BOUNDS = false

  var ROLE_COLORS = {
    hero: 0xff4466,
    'semi-hero': 0xffaa00,
    support: 0x44ccff,
    decoration: 0x888888
  }

  function buildSonnetMeasuredBoundsDebug(pixi, placements) {
    var layer = new pixi.Container()
    layer.visible = DEBUG_SONNET_MEASURED_BOUNDS
    if (!DEBUG_SONNET_MEASURED_BOUNDS) return layer

    placements.forEach(function (placement) {
      var color = ROLE_COLORS[placement.role] !== undefined ? ROLE_COLORS[placement.role] : 0xffffff
      // measuredWidth/Height 是屏幕空间边界；先还原本地文字尺寸，
      // 避免下方旋转把盒子双重旋转
      var local = Text.resolveSonnetFrameLocalDimensions(placement)
      var box = new pixi.Graphics()
        .rect(-local.width / 2, -local.height / 2, local.width, local.height)
        .stroke({ color: color, width: 1.5, alpha: 0.9 })
        .circle(0, 0, 2.5)
        .fill({ color: color, alpha: 0.9 })
      box.position.set(placement.x, placement.y)
      box.rotation = placement.rotation
      layer.addChild(box)
    })
    return layer
  }

  // 开发覆盖层状态通道（本插件没有调试面板，保留状态以维持运行时写入面）
  var sonnetDebugState = {
    activeShot: null,
    paragraphIndex: -1
  }

  // MG 变体的人类可读标签；只有 themed/open 区间携带真实名称
  function resolveSonnetGeoVariantLabel(variant) {
    if (variant >= window.FoliaSonnetMgExtended.SONNET_EXTENDED_GEO_VARIANT_START) {
      var extendedName = window.FoliaSonnetMgExtended.SONNET_EXTENDED_GEO_VARIANTS[variant - window.FoliaSonnetMgExtended.SONNET_EXTENDED_GEO_VARIANT_START]
      return extendedName ? 'extended #' + variant + ' ' + extendedName : 'extended #' + variant
    }
    if (variant >= window.FoliaSonnetMgOpen.SONNET_OPEN_GEO_VARIANT_START) {
      var openName = window.FoliaSonnetMgOpen.SONNET_OPEN_GEO_VARIANTS[variant - window.FoliaSonnetMgOpen.SONNET_OPEN_GEO_VARIANT_START]
      return openName ? 'open #' + variant + ' ' + openName : 'open #' + variant
    }
    if (variant >= window.FoliaSonnetMgThemed.SONNET_THEMED_GEO_VARIANT_START) {
      var themedName = window.FoliaSonnetMgThemed.SONNET_THEMED_GEO_VARIANTS[variant - window.FoliaSonnetMgThemed.SONNET_THEMED_GEO_VARIANT_START]
      return themedName ? 'themed #' + variant + ' ' + themedName : 'themed #' + variant
    }
    if (variant >= window.FoliaSonnetMg.SONNET_ADDITIONAL_GEO_VARIANT_START) {
      return 'additional #' + variant
    }
    return 'core #' + variant
  }

  function labelFor(prefix, names, variant) {
    var name = names[variant]
    return name ? prefix + ' #' + variant + ' ' + name : prefix + ' #' + variant
  }

  // 构建调试面板消费的静态 shot 快照
  function createSonnetShotDebugInfo(options) {
    return {
      programSeed: options.programSeed,
      paragraphId: options.paragraphId,
      paragraphKind: options.paragraphKind,
      shotId: options.shot.id,
      shotKind: options.shot.kind,
      shotIndex: options.shotIndex,
      shotCount: options.shotCount,
      lineIndices: options.shot.lineIndices.slice(),
      startTime: options.shot.startTime,
      endTime: options.shot.endTime,
      camera: {
        x: options.shot.camera.x,
        y: options.shot.camera.y,
        zoom: options.shot.camera.zoom,
        rotation: options.shot.camera.rotation
      },
      baseFontSize: options.baseFontSize,
      wordCount: options.wordCount,
      geoVariant: options.geoVariant,
      geoVariantLabel: options.geoVariant === null ? null : resolveSonnetGeoVariantLabel(options.geoVariant),
      backgroundMgLabel: labelFor('bgMG', Decor.SONNET_BACKGROUND_MG_VARIANTS, options.backgroundMgVariant),
      fixedGeoLabel: options.fixedGeoVariant === null
        ? null
        : labelFor('fixedGeo', Decor.SONNET_FIXED_GEO_VARIANTS, options.fixedGeoVariant),
      backgroundDecorLabel: labelFor('decor', Decor.SONNET_BACKGROUND_DECOR_VARIANTS, options.backgroundDecorVariant),
      segments: options.placements.map(function (placement) {
        return {
          text: options.segmentTexts[placement.segmentIndex] !== undefined
            ? options.segmentTexts[placement.segmentIndex]
            : placement.displayText,
          role: placement.role,
          x: placement.x,
          y: placement.y,
          width: placement.measuredWidth,
          height: placement.measuredHeight,
          fontScale: placement.fontScale,
          vertical: placement.vertical
        }
      })
    }
  }

  // ---------- 转场（原版 sonnetTransitions.ts） ----------
  var IDLE_SONNET_TRANSITION_FRAME = {
    x: 0,
    y: 0,
    scale: 1,
    rotation: 0,
    alpha: 1,
    blur: 0,
    glitch: 0,
    glitchSeed: 0
  }

  function resolveBoundaryKind(seed, boundaryIndex) {
    var mixed = (seed ^ Math.imul(boundaryIndex + 1, 0x9e3779b1)) >>> 0
    return Core.SONNET_TRANSITION_KINDS[mixed % Core.SONNET_TRANSITION_KINDS.length]
  }

  function resolveSonnetTransitionEffectFrame(kind, phase, progress, seed) {
    var linear = Core.clamp01(progress)
    var eased = Core.easeSonnetInOut(linear)
    var amount = phase === 'exit' ? eased : 1 - eased

    if (kind === 'fast-blur') {
      return {
        x: 0,
        y: 0,
        scale: 1,
        rotation: 0,
        alpha: phase === 'exit' ? 1 - amount : 1 - amount * 0.82,
        blur: amount * 14,
        glitch: 0,
        glitchSeed: 0
      }
    }

    if (kind === 'mono-glitch') {
      var step = Math.floor(linear * 14)
      return {
        x: 0,
        y: 0,
        scale: 1,
        rotation: 0,
        alpha: phase === 'exit' && linear > 0.86
          ? 1 - (linear - 0.86) / 0.14
          : 1,
        blur: 0,
        glitch: amount,
        glitchSeed: seed * 0.0001 + step * 0.173
      }
    }

    return {
      x: 0,
      y: 0,
      // 场景滤镜使用视口尺寸的渲染面，转场缩放会暴露其边界，因此 scale 恒为 1
      scale: 1,
      rotation: 0,
      alpha: phase === 'exit' ? 1 - amount : 1 - amount * 0.72,
      blur: 0,
      glitch: 0,
      glitchSeed: 0
    }
  }

  function resolveSonnetExitTransitionFrame(paragraph, time, enabled, seed) {
    var transition = paragraph.transitionOut
    if (!enabled || !transition || time < transition.startTime) return IDLE_SONNET_TRANSITION_FRAME
    var progress = (time - transition.startTime) / Math.max(transition.endTime - transition.startTime, 0.001)
    return resolveSonnetTransitionEffectFrame(transition.kind, 'exit', progress, seed)
  }

  function resolveSonnetEnterTransitionFrame(kind, timeSinceStart, duration, enabled, seed) {
    if (!enabled || !kind || timeSinceStart < 0 || timeSinceStart > duration) {
      return IDLE_SONNET_TRANSITION_FRAME
    }
    return resolveSonnetTransitionEffectFrame(kind, 'enter', timeSinceStart / Math.max(duration, 0.001), seed)
  }

  // 给每个版式边界一段短转场；段落通常包含多个 shot
  function resolveSonnetShotTransitionFrame(shots, activeShotIndex, time, enabled, seed) {
    if (!enabled || shots.length < 2) return IDLE_SONNET_TRANSITION_FRAME
    var current = shots[activeShotIndex]
    if (!current) return IDLE_SONNET_TRANSITION_FRAME

    if (activeShotIndex > 0) {
      var previous = shots[activeShotIndex - 1]
      var duration = Math.min(0.24, Math.max(0.14, (current.startTime - previous.startTime) * 0.18))
      if (time <= current.startTime + duration) {
        return resolveSonnetEnterTransitionFrame(
          resolveBoundaryKind(seed, activeShotIndex - 1),
          time - current.startTime,
          duration,
          true,
          seed + activeShotIndex * 97
        )
      }
    }

    var next = shots[activeShotIndex + 1]
    if (!next) return IDLE_SONNET_TRANSITION_FRAME
    var duration2 = Math.min(0.24, Math.max(0.14, (next.startTime - current.startTime) * 0.18))
    var transitionStart = next.startTime - duration2
    if (time < transitionStart) return IDLE_SONNET_TRANSITION_FRAME
    return resolveSonnetTransitionEffectFrame(
      resolveBoundaryKind(seed, activeShotIndex),
      'exit',
      (time - transitionStart) / duration2,
      seed + (activeShotIndex + 1) * 97
    )
  }

  // ---------- 片尾海报（原版 sonnetCredits.ts） ----------
  function normalizeMetadata(value) {
    return value ? String(value).trim() : ''
  }

  // 歌词失焦与海报入场错峰，同时在 seek 下保持确定性
  function resolveSonnetCreditsFrame(time, finalLyricEndTime) {
    var elapsed = time - finalLyricEndTime
    if (elapsed <= 0) {
      return {
        active: false,
        lyricAlpha: 1,
        lyricBlur: 0,
        posterAlpha: 0,
        posterOffsetY: 0.04,
        posterScale: 0.965
      }
    }
    var lyricExit = Core.easeSonnetInOut(Core.clamp01(elapsed / 1.25))
    var posterEnter = Core.easeSonnetInOut(Core.clamp01((elapsed - 0.38) / 1.55))
    return {
      active: true,
      lyricAlpha: 1 - lyricExit,
      lyricBlur: lyricExit * 18,
      posterAlpha: posterEnter,
      posterOffsetY: (1 - posterEnter) * 0.04,
      posterScale: 0.965 + posterEnter * 0.035
    }
  }

  function hasSonnetCreditsMetadata(metadata) {
    return Boolean(
      normalizeMetadata(metadata.title)
      || normalizeMetadata(metadata.artist)
      || normalizeMetadata(metadata.album)
    )
  }

  function buildSonnetCreditsPoster(pixi, theme, metadata, width, height, lyricsFontScale) {
    var container = new pixi.Container()
    var title = normalizeMetadata(metadata.title)
    var artist = normalizeMetadata(metadata.artist)
    var album = normalizeMetadata(metadata.album)
    var fontFamily = Core.resolveThemeFontStack(theme)
    var titleWeight = Core.resolveThemeFontWeight(theme, 700)
    var detailWeight = Core.resolveThemeFontWeight(theme, 500)
    var left = Math.max(38, width * 0.105)
    var right = Math.max(38, width * 0.09)
    var contentWidth = Math.max(220, width - left - right)
    var titleSize = Math.max(42, Math.min(118, width * 0.088 * lyricsFontScale))
    var detailSize = Math.max(13, Math.min(25, width * 0.018 * lyricsFontScale))
    var accent = pixi.Color.shared.setValue(theme.accentColor).toNumber()
    var primary = pixi.Color.shared.setValue(theme.primaryColor).toNumber()
    var secondary = pixi.Color.shared.setValue(theme.secondaryColor).toNumber()
    var geometry = new pixi.Graphics()

    geometry
      .rect(left, height * 0.155, Math.max(42, width * 0.075), 5)
      .fill({ color: accent, alpha: 0.95 })
      .rect(left, height * 0.155, 2, height * 0.57)
      .fill({ color: primary, alpha: 0.22 })
      .rect(width - right - 8, height * 0.225, 8, height * 0.34)
      .fill({ color: secondary, alpha: 0.32 })
      .moveTo(left, height * 0.79)
      .lineTo(width - right, height * 0.79)
      .stroke({ color: primary, width: 1, alpha: 0.36 })
    container.addChild(geometry)

    if (artist) {
      var artistText = new pixi.Text({
        text: artist.toLocaleUpperCase(),
        style: new pixi.TextStyle({
          fontFamily: fontFamily,
          fontWeight: String(detailWeight),
          fontSize: detailSize,
          fill: theme.accentColor,
          letterSpacing: Math.max(2, detailSize * 0.18),
          wordWrap: true,
          wordWrapWidth: contentWidth * 0.72
        })
      })
      artistText.position.set(left + 20, height * 0.205)
      container.addChild(artistText)
    }

    if (title) {
      var titleText = new pixi.Text({
        text: title,
        style: new pixi.TextStyle({
          fontFamily: fontFamily,
          fontWeight: String(titleWeight),
          fontSize: titleSize,
          fill: theme.primaryColor,
          leading: -Math.max(2, titleSize * 0.08),
          letterSpacing: -Math.max(0.5, titleSize * 0.018),
          wordWrap: true,
          wordWrapWidth: contentWidth * 0.88,
          breakWords: true
        })
      })
      titleText.position.set(left + 16, height * 0.285)
      container.addChild(titleText)
    }

    if (album) {
      var albumText = new pixi.Text({
        text: '— ' + album,
        style: new pixi.TextStyle({
          fontFamily: fontFamily,
          fontWeight: String(detailWeight),
          fontSize: detailSize * 0.92,
          fill: theme.secondaryColor,
          letterSpacing: Math.max(1, detailSize * 0.1),
          wordWrap: true,
          wordWrapWidth: contentWidth * 0.72
        })
      })
      albumText.position.set(left + 18, height * 0.825)
      container.addChild(albumText)
    }

    container.pivot.set(width / 2, height / 2)
    container.position.set(width / 2, height / 2)
    return container
  }

  // ---------- 场景构建（原版 sonnetSceneBuilder.ts） ----------
  function colorNumberOf(pixi, color) {
    return pixi.Color.shared.setValue(color).toNumber()
  }

  function shouldDrawSonnetSceneBackdrop(showBackgroundMg, transparentBackground) {
    return showBackgroundMg && !transparentBackground
  }

  function buildSonnetScene(pixi, options, iconTextures, paragraph) {
    var Container = pixi.Container
    var Graphics = pixi.Graphics
    var width = Math.max(options.host.clientWidth, 320)
    var height = Math.max(options.host.clientHeight, 240)
    var container = new Container()
    var sceneBackgroundLayer = new Container()
    // 构建期解析一次可见性；播放期只变更动画状态
    var showOnlyText = options.tuning.showOnlyText
    var showBackgroundMg = !showOnlyText && options.tuning.showBackgroundMg
    var showFixedGeo = !showOnlyText && options.tuning.showFixedGeo
    var showBackgroundDecor = !showOnlyText && options.tuning.showBackgroundDecor
    var showGuide = !showOnlyText && options.tuning.showGuide
    var showOuterMetadata = !showOnlyText && options.tuning.outerFrameMode === 'full'
    var sceneSeed = Core.hashSonnetSeed(options.programSeed + ':' + paragraph.id)
    var postProcessProfile = Filters.resolveSonnetPostProcessProfile(
      options.theme,
      options.tuning,
      options.staticMode
    )
    var fontFamily = Core.resolveThemeFontStack(options.theme)
    var manualFontWeight = Core.normalizeFontWeight(options.theme.fontWeight)
    var postProcessFilters = []
    if (showBackgroundMg) {
      var density = Math.round(4 + options.tuning.mgDensity * 5)
      if (shouldDrawSonnetSceneBackdrop(showBackgroundMg, options.transparentBackground)) {
        sceneBackgroundLayer.addChild(new Graphics()
          .rect(0, 0, width, height)
          .fill({ color: colorNumberOf(pixi, options.theme.backgroundColor), alpha: 0.10 }))
      }

      for (var index = 0; index < density; index += 1) {
        var x = ((sceneSeed + index * 97) % 997) / 997 * width
        var y = ((sceneSeed + index * 193) % 991) / 991 * height
        var length = 32 + ((sceneSeed + index * 43) % 180)
        sceneBackgroundLayer.addChild(new Graphics()
          .moveTo(x, y)
          .lineTo(Math.min(width, x + length), y)
          .stroke({
            color: colorNumberOf(pixi, index % 2 ? options.theme.secondaryColor : options.theme.accentColor),
            width: index % 3 === 0 ? 2 : 1,
            alpha: 0.12 + (index % 4) * 0.04
          }))
      }
    }

    var TextStyle = pixi.TextStyle
    // 装饰性主题元数据文本
    if (options.theme.name) {
      var nameText = new pixi.Text({
        text: '[ THEME ] ' + String(options.theme.name).toUpperCase(),
        style: new TextStyle({
          fontFamily: fontFamily,
          fontWeight: manualFontWeight === null ? 'bold' : String(manualFontWeight),
          fontSize: 14,
          fill: options.theme.primaryColor,
          letterSpacing: 4
        })
      })
      nameText.alpha = 0.2
      nameText.rotation = -Math.PI / 2
      nameText.position.set(20, height - 20)
      nameText.anchor.set(0, 1)
      if (showOuterMetadata) sceneBackgroundLayer.addChild(nameText)
    }

    if (options.theme.description) {
      var descText = new pixi.Text({
        text: options.theme.description,
        style: new TextStyle({
          fontFamily: fontFamily,
          fontWeight: manualFontWeight === null ? undefined : String(manualFontWeight),
          fontSize: 12,
          fill: options.theme.secondaryColor,
          wordWrap: true,
          wordWrapWidth: width * 0.3
        })
      })
      descText.alpha = 0.3
      descText.position.set(width - 20, 20)
      descText.anchor.set(1, 0)
      if (showOuterMetadata) sceneBackgroundLayer.addChild(descText)
    }
    container.addChild(sceneBackgroundLayer)

    var shots = paragraph.shots.map(function (shot, shotIndex) {
      var shotContainer = new Container()
      var compiledLines = shot.lineIndices
        .map(function (lineIndex) {
          return paragraph.lines.find(function (item) { return item.sourceIndex === lineIndex })
        })
        .filter(Boolean)
      var linesSegments = compiledLines
        .map(function (line) { return line.segments.filter(Typography.isSonnetLayoutSegment) })
        .filter(function (segs) { return segs.length > 0 })
      var segments = []
      linesSegments.forEach(function (segs) {
        segs.forEach(function (seg) { segments.push(seg) })
      })
      var wordCount = Math.max(1, segments.filter(function (segment) { return segment.isWordLike }).length)
      var heroScale = shot.kind === 'type-impact' ? 1.55 : shot.kind === 'quiet-tableau' ? 0.82 : 1
      var fontSize = Math.max(24, Math.min(112, (
        width / Math.max(7, wordCount * 2.15)
      ) * heroScale * options.lyricsFontScale))
      var views = []
      var placements = Typography.resolveSonnetTypographyLayout({
        lines: linesSegments,
        shotKind: shot.kind,
        paragraphKind: paragraph.kind,
        width: width,
        height: height,
        baseFontSize: fontSize,
        fontFamily: fontFamily,
        fontWeight: manualFontWeight
      })
      var shotSeed = sceneSeed + shotIndex * 97
      var mgLayer = window.FoliaSonnetMg.buildSonnetShotMg(
        pixi,
        shot.kind,
        options.theme,
        width,
        height,
        shotSeed,
        iconTextures
      )
      shotContainer.addChild(mgLayer)
      var mgBackgroundLayer = mgLayer.bgLayer
      var mgGeoLayer = mgLayer.geoLayer
      var mgParticleLayer = mgLayer.particleLayer
      var mgFixedGeoLayer = mgLayer.fixedGeoLayer
      mgLayer.visible = showBackgroundMg || showFixedGeo || showBackgroundDecor
      if (mgBackgroundLayer) mgBackgroundLayer.visible = showBackgroundMg
      if (mgGeoLayer) mgGeoLayer.visible = showBackgroundMg
      if (mgParticleLayer) mgParticleLayer.visible = showBackgroundDecor
      if (mgFixedGeoLayer) mgFixedGeoLayer.visible = showFixedGeo
      var haloResult = Filters.createSonnetHaloLayer(pixi, postProcessProfile)
      var haloLayer = haloResult.layer
      var haloFilters = haloResult.filters
      var guideLayer = new Container()
      var textLayer = new Container()
      guideLayer.visible = showGuide
      haloLayer.visible = !showOnlyText
      shotContainer.addChild(guideLayer, haloLayer, textLayer)
      haloFilters.forEach(function (filter) { postProcessFilters.push(filter) })
      // 虚拟器乐行可共享一个 shot；完整五线谱属于 shot 而非每行
      var staffViewAdded = false
      placements.forEach(function (placement, placementIndex) {
        var segment = segments[placement.segmentIndex]
        if (segment.text === '♪') {
          if (staffViewAdded) return
          staffViewAdded = true
        }
        views.push(Text.buildSonnetTextView(
          pixi,
          {
            segment: segment,
            placement: placement,
            segmentIndex: placement.segmentIndex,
            baseFontSize: fontSize,
            shotStartTime: shot.startTime,
            shotEndTime: shot.endTime,
            paragraphKind: paragraph.kind,
            width: width,
            fontFamily: fontFamily,
            fontWeight: manualFontWeight,
            theme: options.theme,
            glowEnabled: postProcessProfile.glowStrength > 0,
            showFixedGeo: showFixedGeo,
            guideLayer: guideLayer,
            haloLayer: haloLayer,
            textLayer: textLayer
          }
        ))
      })
      var bounds = shotContainer.getLocalBounds()
      // `mask-reveal` 由字形时间轴揭示。按边界生成的遮罩会保持静止，
      // 而镜头追踪与视差在移动 shot，会裁开开放的 MG 图形。
      // 调试覆盖保持在文字之上，从不参与边界/焦点计算。
      shotContainer.addChild(buildSonnetMeasuredBoundsDebug(pixi, placements))
      var usesGeoMg = shot.kind === 'type-impact' || shot.kind === 'fragment-collage'
      var debugInfo = createSonnetShotDebugInfo({
        programSeed: options.programSeed,
        paragraphId: paragraph.id,
        paragraphKind: paragraph.kind,
        shot: shot,
        shotIndex: shotIndex,
        shotCount: paragraph.shots.length,
        baseFontSize: fontSize,
        wordCount: wordCount,
        geoVariant: usesGeoMg ? Decor.resolveSonnetGeoVariant(shotSeed) : null,
        backgroundMgVariant: Decor.resolveSonnetBackgroundMgVariant(shotSeed),
        fixedGeoVariant: usesGeoMg ? Decor.resolveSonnetFixedGeoVariant(shotSeed) : null,
        backgroundDecorVariant: Decor.resolveSonnetBackgroundDecorVariant(shotSeed),
        placements: placements,
        segmentTexts: segments.map(function (segment) { return segment.text })
      })

      // 海报块在运行时追踪前居中起步；其他模板从 hero 词起步
      var heroPlacement = placements.find(function (p) { return p.role === 'hero' })
      var focusX = shot.kind === 'poster-blocks'
        ? 0
        : heroPlacement ? heroPlacement.x : (bounds.x + bounds.width / 2)
      var focusY = shot.kind === 'poster-blocks'
        ? 0
        : heroPlacement ? heroPlacement.y : (bounds.y + bounds.height / 2)

      shotContainer.pivot.set(focusX, focusY)
      shotContainer.position.set(
        width * (shot.kind === 'poster-blocks' ? 0.5 : 0.5 + shot.camera.x),
        height * (shot.kind === 'poster-blocks'
          ? 0.5
          : 0.48 + shot.camera.y + (shotIndex % 2 ? 0.025 : -0.025))
      )
      container.addChild(shotContainer)
      return {
        shot: shot,
        container: shotContainer,
        segments: views,
        debugInfo: debugInfo,
        baseX: shotContainer.x,
        baseY: shotContainer.y,
        basePivotX: focusX,
        basePivotY: focusY,
        haloLayer: haloLayer,
        mgLayer: mgLayer,
        mgBackgroundLayer: mgBackgroundLayer,
        mgGeoLayer: mgGeoLayer,
        mgParticleLayer: mgParticleLayer,
        mgFixedGeoLayer: mgFixedGeoLayer
      }
    })

    if (!showOnlyText) {
      var sceneFilters = Filters.applySonnetScenePostProcess(
        pixi,
        container,
        postProcessProfile,
        sceneSeed
      )
      if (sceneFilters.length > 0) {
        // 即使可见歌词/装饰边界更小，全场景着色器也保持在视口空间
        container.filterArea = new pixi.Rectangle(0, 0, width, height)
        sceneFilters.forEach(function (filter) { postProcessFilters.push(filter) })
      }
    }
    var transitionBlurFilter = options.tuning.enableTransitions && !options.staticMode
      ? new pixi.BlurFilter({ strength: 0, quality: 1, kernelSize: 5, resolution: 0.5 })
      : null
    if (transitionBlurFilter) {
      // BlurFilter 的 padding 是 strength * 2，Pixi 会对（已裁剪到视口的）链的
      // 共享渲染帧加上所有启用滤镜的 padding 之和。帧变大会缩放暗角 pass 的
      // 屏幕坐标，导致转场中模糊渐入时暗角变亮。repeatEdgePixels 把 padding
      // 钉在 0；多出的边距本来就在屏幕外。
      transitionBlurFilter.repeatEdgePixels = true
      transitionBlurFilter.enabled = false
      container.filters = (container.filters || []).concat([transitionBlurFilter])
      postProcessFilters.push(transitionBlurFilter)
    }
    var transitionGlitchEffect = options.tuning.enableTransitions && !options.staticMode
      ? Filters.createSonnetGlitchEffect(pixi)
      : null
    if (transitionGlitchEffect) {
      container.filters = (container.filters || []).concat([transitionGlitchEffect.filter])
      postProcessFilters.push(transitionGlitchEffect.filter)
    }
    container.visible = false
    return {
      paragraph: paragraph,
      container: container,
      shots: shots,
      shotTimeline: shots.map(function (shot) { return shot.shot }),
      postProcessFilters: postProcessFilters,
      transitionBlurFilter: transitionBlurFilter,
      transitionGlitchEffect: transitionGlitchEffect,
      activeShotIndex: -1
    }
  }

  window.FoliaSonnetScene = {
    DEBUG_SONNET_MEASURED_BOUNDS: DEBUG_SONNET_MEASURED_BOUNDS,
    sonnetDebugState: sonnetDebugState,
    buildSonnetMeasuredBoundsDebug: buildSonnetMeasuredBoundsDebug,
    resolveSonnetGeoVariantLabel: resolveSonnetGeoVariantLabel,
    createSonnetShotDebugInfo: createSonnetShotDebugInfo,
    IDLE_SONNET_TRANSITION_FRAME: IDLE_SONNET_TRANSITION_FRAME,
    resolveSonnetTransitionEffectFrame: resolveSonnetTransitionEffectFrame,
    resolveSonnetExitTransitionFrame: resolveSonnetExitTransitionFrame,
    resolveSonnetEnterTransitionFrame: resolveSonnetEnterTransitionFrame,
    resolveSonnetShotTransitionFrame: resolveSonnetShotTransitionFrame,
    resolveSonnetCreditsFrame: resolveSonnetCreditsFrame,
    hasSonnetCreditsMetadata: hasSonnetCreditsMetadata,
    buildSonnetCreditsPoster: buildSonnetCreditsPoster,
    shouldDrawSonnetSceneBackdrop: shouldDrawSonnetSceneBackdrop,
    buildSonnetScene: buildSonnetScene
  }
})()
