// 商籁模式·MG 总装：移植自 folia-major
//   sonnet/sonnetAdditionalShotMg.ts（18-23 号轻量海报母题分发）
//   sonnet/sonnetTextFixedGeo.ts（伴随特定文字段落的确定性固定几何）
//   sonnet/sonnetShotMg.ts（PV 风格高密度语义装饰元素主构建：HUD/几何混沌/粒子）
(function () {
  'use strict'

  var Core = window.FoliaSonnetCore
  var Decor = window.FoliaSonnetDecor
  var hashSonnetSeed = Core.hashSonnetSeed

  var colorNumber = function (pixi, color) { return pixi.Color.shared.setValue(color).toNumber() }
  var normalizeAudioLevel = function (value) { return Math.min(1, Math.max(0, value > 1 ? value / 255 : value)) }

  // ---------- 附加母题（原版 sonnetAdditionalShotMg.ts） ----------
  var SONNET_ADDITIONAL_GEO_VARIANT_START = 18
  var SONNET_ADDITIONAL_GEO_VARIANT_COUNT = 6

  function drawContourAtlas(options) {
    var target = options.target
    var radius = options.radius
    var seed = options.seed
    var primary = options.primary
    var secondary = options.secondary
    var steps = 48
    for (var ring = 0; ring < 8; ring += 1) {
      var baseRadius = radius * (0.16 + ring * 0.075)
      for (var step = 0; step <= steps; step += 1) {
        var angle = (step / steps) * Math.PI * 2
        var ripple = Math.sin(angle * 3 + seed * 0.07 + ring) * radius * 0.018
          + Math.cos(angle * 5 - seed * 0.03 + ring * 0.7) * radius * 0.012
        var x = Math.cos(angle) * (baseRadius + ripple) + Math.sin(ring * 1.7) * radius * 0.055
        var y = Math.sin(angle) * (baseRadius + ripple) * 0.72 + Math.cos(ring * 1.3) * radius * 0.035
        if (step === 0) target.moveTo(x, y)
        else target.lineTo(x, y)
      }
      target.stroke({
        color: ring % 3 === 0 ? secondary : primary,
        width: ring % 3 === 0 ? 2 : 1,
        alpha: 0.2 + ring * 0.045
      })
    }
    target.moveTo(-radius * 0.78, radius * 0.52)
      .lineTo(-radius * 0.58, radius * 0.52)
      .lineTo(-radius * 0.58, radius * 0.46)
      .lineTo(-radius * 0.38, radius * 0.46)
      .stroke({ color: primary, width: 3, alpha: 0.64 })
  }

  function drawRadialWave(options) {
    var target = options.target
    var radius = options.radius
    var seed = options.seed
    var primary = options.primary
    var secondary = options.secondary
    var bars = 64
    for (var index = 0; index < bars; index += 1) {
      var angle = (index / bars) * Math.PI * 2
      var signal = 0.5 + 0.5 * Math.sin(index * 1.83 + seed * 0.11)
      var inner = radius * (0.29 + signal * 0.035)
      var outer = radius * (0.43 + signal * 0.21)
      target.moveTo(Math.cos(angle) * inner, Math.sin(angle) * inner)
        .lineTo(Math.cos(angle) * outer, Math.sin(angle) * outer)
        .stroke({
          color: index % 8 === 0 ? secondary : primary,
          width: index % 8 === 0 ? 3 : 1,
          alpha: index % 2 === 0 ? 0.58 : 0.32
        })
    }
    target.circle(0, 0, radius * 0.24).stroke({ color: primary, width: 5, alpha: 0.7 })
    target.circle(0, 0, radius * 0.68).stroke({ color: secondary, width: 1, alpha: 0.18 })
    target.circle(0, 0, radius * 0.72).stroke({ color: primary, width: 2, alpha: 0.12 })
  }

  function drawTransitBlueprint(options) {
    var target = options.target
    var radius = options.radius
    var width = options.width
    var height = options.height
    var seed = options.seed
    var primary = options.primary
    var secondary = options.secondary
    var direction = seed % 2 === 0 ? 1 : -1
    var bleed = Decor.resolveSonnetShotMgBleed(width, height, radius)
    var routes = [
      [[-0.72, -0.38], [-0.38, -0.38], [-0.38, 0.08], [0.08, 0.08], [0.08, 0.52], [0.68, 0.52]],
      [[-0.62, 0.58], [-0.62, 0.24], [-0.14, 0.24], [-0.14, -0.52], [0.5, -0.52], [0.5, -0.2], [0.74, -0.2]],
      [[-0.78, -0.06], [-0.5, -0.06], [-0.5, -0.62], [0.24, -0.62], [0.24, 0.3], [0.72, 0.3]]
    ]

    routes.forEach(function (route, routeIndex) {
      var first = route[0]
      var last = route[route.length - 1]
      target.moveTo(-bleed.x * direction, first[1] * radius)
      route.forEach(function (point) {
        var px = point[0] * radius * direction
        var py = point[1] * radius
        target.lineTo(px, py)
      })
      target.lineTo(bleed.x * direction, last[1] * radius)
      target.stroke({
        color: routeIndex === 1 ? secondary : primary,
        width: routeIndex === 0 ? 5 : 2,
        alpha: 0.34 + routeIndex * 0.12
      })
      route.forEach(function (point, pointIndex) {
        if (pointIndex === 0 || pointIndex === route.length - 1 || (pointIndex + routeIndex) % 2 === 0) {
          var px = point[0] * radius * direction
          var py = point[1] * radius
          target.circle(px, py, pointIndex === 0 ? 10 : 6)
            .fill({ color: pointIndex % 2 === 0 ? primary : secondary, alpha: 0.72 })
          target.circle(px, py, pointIndex === 0 ? 16 : 11)
            .stroke({ color: primary, width: 1, alpha: 0.36 })
        }
      })
    })
  }

  function drawChronograph(options) {
    var target = options.target
    var radius = options.radius
    var seed = options.seed
    var primary = options.primary
    var secondary = options.secondary
    var rings = [0.2, 0.38, 0.62]
    rings.forEach(function (scale, index) {
      target.circle(0, 0, radius * scale).stroke({
        color: index === 1 ? secondary : primary,
        width: index === 2 ? 4 : 2,
        alpha: 0.3 + index * 0.13
      })
    })
    for (var tick = 0; tick < 48; tick += 1) {
      var angle = (tick / 48) * Math.PI * 2
      var outer = radius * 0.72
      var inner = outer - radius * (tick % 4 === 0 ? 0.11 : 0.045)
      target.moveTo(Math.cos(angle) * inner, Math.sin(angle) * inner)
        .lineTo(Math.cos(angle) * outer, Math.sin(angle) * outer)
        .stroke({ color: tick % 4 === 0 ? secondary : primary, width: tick % 4 === 0 ? 3 : 1, alpha: 0.5 })
    }
    var handAngle = ((seed % 60) / 60) * Math.PI * 2 - Math.PI / 2
    var secondAngle = (((seed * 7) % 60) / 60) * Math.PI * 2 - Math.PI / 2
    target.moveTo(-Math.cos(handAngle) * radius * 0.12, -Math.sin(handAngle) * radius * 0.12)
      .lineTo(Math.cos(handAngle) * radius * 0.55, Math.sin(handAngle) * radius * 0.55)
      .stroke({ color: primary, width: 6, alpha: 0.74 })
    target.moveTo(0, 0)
      .lineTo(Math.cos(secondAngle) * radius * 0.65, Math.sin(secondAngle) * radius * 0.65)
      .stroke({ color: secondary, width: 2, alpha: 0.72 })
    target.circle(0, 0, radius * 0.055).fill({ color: primary, alpha: 0.85 })
  }

  function drawFoldedRibbons(options) {
    var target = options.target
    var radius = options.radius
    var width = options.width
    var height = options.height
    var seed = options.seed
    var primary = options.primary
    var secondary = options.secondary
    var direction = seed % 2 === 0 ? 1 : -1
    var bleed = Decor.resolveSonnetShotMgBleed(width, height, radius)
    for (var band = 0; band < 5; band += 1) {
      var y = (-0.5 + band * 0.25) * radius
      var offset = (band % 2 === 0 ? 1 : -1) * direction
      target.moveTo(-bleed.x, y)
        .bezierCurveTo(
          -radius * 0.38, y - radius * 0.28 * offset,
          radius * 0.18, y + radius * 0.28 * offset,
          bleed.x, y
        )
        .stroke({ color: band % 2 === 0 ? primary : secondary, width: band === 2 ? 12 : 5, alpha: 0.24 + band * 0.08 })
      target.moveTo(-bleed.x, y + radius * 0.055)
        .bezierCurveTo(
          -radius * 0.38, y - radius * 0.28 * offset + radius * 0.055,
          radius * 0.18, y + radius * 0.28 * offset + radius * 0.055,
          bleed.x, y + radius * 0.055
        )
        .stroke({ color: primary, width: 1, alpha: 0.3 })
    }
    target.moveTo(-radius * 0.34, -bleed.y).lineTo(-radius * 0.34, -radius * 0.18)
      .stroke({ color: primary, width: 2, alpha: 0.18 })
    target.moveTo(radius * 0.34, radius * 0.18).lineTo(radius * 0.34, bleed.y)
      .stroke({ color: primary, width: 2, alpha: 0.18 })
  }

  function drawHalftonePoster(options) {
    var target = options.target
    var radius = options.radius
    var width = options.width
    var height = options.height
    var seed = options.seed
    var primary = options.primary
    var secondary = options.secondary
    var spacing = radius * 0.17
    var bleed = Decor.resolveSonnetShotMgBleed(width, height, radius)
    var columns = Math.ceil((bleed.x * 2) / spacing) + 2
    var rows = Math.ceil((bleed.y * 2) / spacing) + 2
    for (var row = 0; row < rows; row += 1) {
      for (var column = 0; column < columns; column += 1) {
        var x = (column - (columns - 1) / 2) * spacing
        var y = (row - (rows - 1) / 2) * spacing
        var distance = Math.hypot(x, y) / radius
        var pulse = 0.5 + 0.5 * Math.sin(column * 0.9 + row * 1.4 + seed * 0.08)
        var dotRadius = radius * (0.009 + Math.max(0, 0.72 - distance) * 0.034 + pulse * 0.012)
        target.circle(x, y, dotRadius).fill({
          color: (row + column) % 5 === 0 ? secondary : primary,
          alpha: 0.24 + pulse * 0.5
        })
      }
    }
    target.moveTo(-bleed.x, -bleed.y * 0.72).lineTo(bleed.x, -bleed.y * 0.72)
      .stroke({ color: secondary, width: 2, alpha: 0.28 })
    target.moveTo(-bleed.x * 0.58, -bleed.y).lineTo(-bleed.x * 0.58, bleed.y)
      .stroke({ color: primary, width: 1, alpha: 0.2 })
  }

  // 只分发附加区间，让原版 shot 构建器专注于构图
  function drawAdditionalSonnetShotMg(options) {
    switch (options.variant) {
      case 18: drawContourAtlas(options); return true
      case 19: drawRadialWave(options); return true
      case 20: drawTransitBlueprint(options); return true
      case 21: drawChronograph(options); return true
      case 22: drawFoldedRibbons(options); return true
      case 23: drawHalftonePoster(options); return true
      default:
        return window.FoliaSonnetMgThemed.drawThemedSonnetShotMg(options)
          || window.FoliaSonnetMgOpen.drawOpenSonnetShotMg(options)
          || window.FoliaSonnetMgExtended.drawExtendedSonnetShotMg(options)
    }
  }

  // ---------- 文本固定几何（原版 sonnetTextFixedGeo.ts） ----------
  var HOLLOW_VARIANTS = ['straight-frame', 'rotated-frame', 'orbit-crosshair', 'split-arches']

  function resolveHollowVariant(seed, divisor, offset) {
    var index = Math.floor(seed / divisor) + offset
    return HOLLOW_VARIANTS[((index % HOLLOW_VARIANTS.length) + HOLLOW_VARIANTS.length) % HOLLOW_VARIANTS.length]
  }

  function resolveSonnetTextFixedGeoPlan(seed, isChorusEffect) {
    if (isChorusEffect) {
      var chorusSeed = ((seed % 10) + 10) % 10
      if (chorusSeed < 9) {
        return { category: 'hollow', variant: resolveHollowVariant(seed, 10, chorusSeed) }
      }
      var solidVariants = ['orb-hatch', 'music-steps', 'bent-lines']
      return { category: 'solid', variant: solidVariants[Math.floor(seed / 10) % solidVariants.length] }
    }

    var legacyType = ((seed % 4) + 4) % 4
    if (legacyType === 1 || legacyType === 2) {
      return { category: 'hollow', variant: resolveHollowVariant(seed, 4, legacyType) }
    }
    var solidVariants2 = ['orb-hatch', 'music-steps', 'bent-lines']
    return { category: 'solid', variant: solidVariants2[Math.floor(seed / 4) % solidVariants2.length] }
  }

  function drawMusicSteps(graphic, width, height, alpha, theme) {
    var heights = [0.24, 0.35, 0.2, 0.82, 0.3, 0.1, 0.23, 0.16]
    var spacing = width / (heights.length + 1)
    heights.forEach(function (heightRatio, index) {
      var x = -width / 2 + spacing * (index + 1)
      var baseline = height * (0.12 - index * 0.035)
      var color = index % 2 === 0 ? theme.accentColor : theme.secondaryColor
      graphic
        .moveTo(x - spacing * 0.12, baseline - height * heightRatio * 0.5)
        .lineTo(x + spacing * 0.12, baseline + height * heightRatio * 0.5)
        .stroke({ color: color, width: Math.max(2, height * 0.025), alpha: alpha * 0.52 })
    })
  }

  function drawBentLines(graphic, width, height, alpha, theme) {
    var lineCount = 5
    for (var index = 0; index < lineCount; index += 1) {
      var x = -width * 0.34 + index * width * 0.17
      var topY = -height * (0.42 - index * 0.035)
      var elbowY = -height * (0.08 - index * 0.025)
      var bottomY = height * (0.35 + index * 0.035)
      var color = index % 2 === 0 ? theme.accentColor : theme.secondaryColor
      graphic
        .moveTo(x - width * 0.16, topY)
        .lineTo(x, elbowY)
        .lineTo(x - width * 0.015, bottomY)
        .stroke({ color: color, width: Math.max(2, height * 0.022), alpha: alpha * 0.52 })
    }
  }

  function drawOrbitCrosshair(graphic, width, height, alpha, color, secondaryColor) {
    var radius = Math.min(width, height) * 0.46
    graphic.circle(0, 0, radius).stroke({ color: color, width: 1.5, alpha: alpha })
    graphic.circle(-width * 0.17, 0, radius * 0.72).stroke({ color: secondaryColor, width: 1, alpha: alpha * 0.72 })
    graphic.circle(width * 0.17, 0, radius * 0.72).stroke({ color: secondaryColor, width: 1, alpha: alpha * 0.72 })
    graphic.moveTo(-width * 0.62, 0).lineTo(width * 0.62, 0).stroke({ color: color, width: 1, alpha: alpha * 0.64 })
    graphic.moveTo(0, -height * 0.62).lineTo(0, height * 0.62).stroke({ color: color, width: 1, alpha: alpha * 0.64 })
  }

  function drawSplitArches(graphic, width, height, alpha, color, secondaryColor) {
    var halfWidth = width * 0.46
    var archRadius = Math.min(width * 0.34, height * 0.52)
    var directions = [-1, 1]
    directions.forEach(function (direction, index) {
      var x = direction * halfWidth * 0.42
      graphic.moveTo(x - archRadius * 0.72, height * 0.42)
        .lineTo(x - archRadius * 0.72, 0)
        .arc(x, 0, archRadius * 0.72, Math.PI, 0)
        .lineTo(x + archRadius * 0.72, height * 0.42)
        .stroke({ color: index === 0 ? color : secondaryColor, width: 1.5, alpha: alpha })
      graphic.moveTo(x - archRadius * 0.48, height * 0.42)
        .lineTo(x - archRadius * 0.48, 0)
        .arc(x, 0, archRadius * 0.48, Math.PI, 0)
        .lineTo(x + archRadius * 0.48, height * 0.42)
        .stroke({ color: index === 0 ? secondaryColor : color, width: 1, alpha: alpha * 0.58 })
    })
    graphic.moveTo(-halfWidth, height * 0.42).lineTo(halfWidth, height * 0.42)
      .stroke({ color: color, width: 2, alpha: alpha * 0.72 })
  }

  // 在保留 hollow/solid 类别概率的同时变化类别内的图形
  function buildSonnetTextFixedGeo(pixi, options) {
    var seed = options.seed
    var isChorusEffect = options.isChorusEffect
    var fontSize = options.fontSize
    var layoutWidth = options.layoutWidth
    var theme = options.theme
    var plan = resolveSonnetTextFixedGeoPlan(seed, isChorusEffect)
    var graphic = new pixi.Graphics()
    var color = seed % 2 === 0 ? theme.primaryColor : theme.secondaryColor
    var alpha = (isChorusEffect ? 0.4 : 0.25) + (seed % 10) * 0.03
    var scaleMultiplier = isChorusEffect ? 1.5 + (seed % 5) * 0.3 : 1
    var width = Math.max(fontSize * 2.5 * scaleMultiplier, layoutWidth * 0.12 * scaleMultiplier)
    var height = Math.max(fontSize * 1.8 * scaleMultiplier, layoutWidth * 0.08 * scaleMultiplier)

    if (plan.category === 'hollow') {
      if (plan.variant === 'orbit-crosshair') {
        drawOrbitCrosshair(graphic, width, height, alpha, color, theme.secondaryColor)
        return graphic
      }
      if (plan.variant === 'split-arches') {
        drawSplitArches(graphic, width, height, alpha, color, theme.secondaryColor)
        return graphic
      }
      var frameWidth = plan.variant === 'rotated-frame' ? width * 0.8 : width
      var frameHeight = plan.variant === 'rotated-frame' ? height * 0.8 : height
      graphic
        .rect(-frameWidth / 2, -frameHeight / 2, frameWidth, frameHeight)
        .stroke({ color: color, width: Math.max(1.5, fontSize * 0.02), alpha: alpha })
      if (isChorusEffect && seed % 2 === 0) {
        graphic
          .rect(-frameWidth * 0.6, -frameHeight * 0.6, frameWidth * 1.2, frameHeight * 1.2)
          .stroke({ color: color, width: 1, alpha: alpha * 0.5 })
      }
      if (plan.variant === 'rotated-frame') graphic.rotation = Math.PI / 4
      return graphic
    }

    if (plan.variant === 'music-steps') {
      drawMusicSteps(graphic, width, height, alpha, theme)
      return graphic
    }
    if (plan.variant === 'bent-lines') {
      drawBentLines(graphic, width, height, alpha, theme)
      return graphic
    }

    var radius = width * 0.5
    graphic.circle(0, 0, radius).fill({ color: color, alpha: alpha * 0.15 })
    var hatch = new pixi.Graphics()
    var hatchSpacing = Math.max(4, width * 0.05)
    for (var offset = -radius; offset < radius; offset += hatchSpacing) {
      var lineHeight = Math.sqrt(Math.max(0, radius * radius - offset * offset))
      hatch.moveTo(offset + radius * 0.4, -lineHeight + radius * 0.4)
      hatch.lineTo(offset + radius * 0.4, lineHeight + radius * 0.4)
    }
    hatch.stroke({ color: color, width: 1.5, alpha: alpha * 0.6 })
    graphic.addChild(hatch)
    return graphic
  }

  // ---------- 主构建（原版 sonnetShotMg.ts） ----------
  function buildSonnetShotMg(pixi, kind, theme, width, height, seed, iconTextures) {
    var Container = pixi.Container
    var container = new Container()
    var primary = colorNumber(pixi, theme.primaryColor)
    var secondary = colorNumber(pixi, theme.secondaryColor)
    var radius = Math.min(width, height)

    // 背景 UI 层
    var bg = new Decor.AnimatedGraphics(pixi)

    // --- 组件：HUD 覆盖（种子化背景 MG 变体） ---
    var hw = width / 2
    var hh = height / 2
    Decor.drawSonnetBackgroundMgHud({
      target: bg,
      variant: Decor.resolveSonnetBackgroundMgVariant(seed),
      width: width,
      height: height,
      seed: seed,
      primary: primary,
      secondary: secondary
    })

    // --- 组件：几何混沌 ---
    var geo
    var fixedGeoParts = []
    var fixedGeoLayer
    if (kind === 'type-impact' || kind === 'fragment-collage') {
      // 大面积重叠几何
      geo = new Decor.AnimatedGraphics(pixi)
      if (!geo) throw new Error('Unreachable')

      var geoVariant = Decor.resolveSonnetGeoVariant(seed)

      if (geoVariant === 0) {
        // 变体 0：巨型圆环 + 日芒
        geo.circle(0, 0, radius * 0.6).stroke({ color: primary, width: 6, alpha: 0.8 })
        geo.circle(0, 0, radius * 0.58).stroke({ color: primary, width: 2, alpha: 0.4 })
        for (var i0 = 0; i0 < 32; i0++) {
          var angle0 = (i0 / 32) * Math.PI * 2
          var r1 = radius * (0.3 + (i0 % 3) * 0.05)
          var r2 = radius * 0.55
          geo.moveTo(Math.cos(angle0) * r1, Math.sin(angle0) * r1)
            .lineTo(Math.cos(angle0) * r2, Math.sin(angle0) * r2)
            .stroke({ color: primary, width: 1, alpha: 0.2 + (i0 % 2) * 0.1 })
        }
      } else if (geoVariant === 1) {
        // 变体 1：嵌套菱形
        var r = radius * 0.7
        geo.moveTo(0, -r).lineTo(r, 0).lineTo(0, r).lineTo(-r, 0).lineTo(0, -r).stroke({ color: primary, width: 6, alpha: 0.8 })
        geo.moveTo(0, -r * 0.96).lineTo(r * 0.96, 0).lineTo(0, r * 0.96).lineTo(-r * 0.96, 0).lineTo(0, -r * 0.96).stroke({ color: primary, width: 2, alpha: 0.4 })
        geo.moveTo(0, -r * 0.4).lineTo(r * 0.4, 0).lineTo(0, r * 0.4).lineTo(-r * 0.4, 0).lineTo(0, -r * 0.4).stroke({ color: primary, width: 1, alpha: 0.6 })
        geo.moveTo(-r, 0).lineTo(r, 0).stroke({ color: primary, width: 1, alpha: 0.3 })
        geo.moveTo(0, -r).lineTo(0, r).stroke({ color: primary, width: 1, alpha: 0.3 })
      } else if (geoVariant === 2) {
        // 变体 2：科技六边形网格
        var drawHex = function (x, y, hr, w, a) {
          geo.moveTo(x + hr * Math.sin(0), y - hr * Math.cos(0))
          for (var j = 1; j <= 6; j++) geo.lineTo(x + hr * Math.sin(j * Math.PI / 3), y - hr * Math.cos(j * Math.PI / 3))
          geo.stroke({ color: primary, width: w, alpha: a })
        }
        drawHex(0, 0, radius * 0.6, 6, 0.8)
        drawHex(0, 0, radius * 0.57, 2, 0.4)
        drawHex(0, 0, radius * 0.25, 1, 0.5)
        // 连接辐条
        for (var j0 = 0; j0 < 6; j0++) {
          var angle1 = j0 * Math.PI / 3 - Math.PI / 6
          geo.moveTo(Math.cos(angle1) * radius * 0.25, Math.sin(angle1) * radius * 0.25)
            .lineTo(Math.cos(angle1) * radius * 0.57, Math.sin(angle1) * radius * 0.57)
            .stroke({ color: primary, width: 2, alpha: 0.4 })
        }
      } else if (geoVariant === 3) {
        // 变体 3：有机分子
        var molVariant = Decor.resolveSonnetMoleculeVariant(seed)

        if (molVariant === 0) {
          // 子变体 0：苯环簇
          var hexR = radius * 0.22
          var drawBenzene = function (cx, cy, scale, rotationOffset) {
            if (rotationOffset === undefined) rotationOffset = 0
            var rr = hexR * scale
            geo.moveTo(cx + rr * Math.sin(rotationOffset), cy - rr * Math.cos(rotationOffset))
            for (var j = 1; j <= 6; j++) {
              geo.lineTo(cx + rr * Math.sin(j * Math.PI / 3 + rotationOffset), cy - rr * Math.cos(j * Math.PI / 3 + rotationOffset))
            }
            geo.stroke({ color: primary, width: 3, alpha: 0.8 })

            // 双键
            for (var b = 0; b < 6; b += 2) {
              var innerR = rr * 0.82
              geo.moveTo(cx + innerR * Math.sin(b * Math.PI / 3 + rotationOffset), cy - innerR * Math.cos(b * Math.PI / 3 + rotationOffset))
                .lineTo(cx + innerR * Math.sin((b + 1) * Math.PI / 3 + rotationOffset), cy - innerR * Math.cos((b + 1) * Math.PI / 3 + rotationOffset))
                .stroke({ color: primary, width: 2, alpha: 0.5 })
            }
          }

          var rMain = hexR * 1.2
          drawBenzene(0, 0, 1.2) // 中央环

          // 右侧稠合环
          var dx = Math.sin(Math.PI / 3) * rMain * 2
          drawBenzene(dx, 0, 1.2)

          // 左上稠合环
          var branchDist = Math.sin(Math.PI / 3) * rMain * 2
          drawBenzene(-Math.sin(Math.PI / 6) * branchDist, -Math.cos(Math.PI / 6) * branchDist, 1.2)

          // 连接结构线
          geo.moveTo(0, rMain)
            .lineTo(0, rMain + radius * 0.2)
            .lineTo(radius * 0.15, rMain + radius * 0.35)
            .stroke({ color: primary, width: 2, alpha: 0.6 })
        } else if (molVariant === 1) {
          // 子变体 1：咖啡因/血清素风格（稠合六边形 + 五边形 + 分支）
          var hexR2 = radius * 0.22
          geo.moveTo(0, -hexR2)
          for (var m0 = 1; m0 <= 6; m0++) geo.lineTo(hexR2 * Math.sin(m0 * Math.PI / 3), -hexR2 * Math.cos(m0 * Math.PI / 3))
          geo.stroke({ color: primary, width: 3, alpha: 0.8 })

          geo.moveTo(hexR2 * 0.8 * Math.sin(Math.PI / 3), -hexR2 * 0.8 * Math.cos(Math.PI / 3))
            .lineTo(hexR2 * 0.8 * Math.sin(2 * Math.PI / 3), -hexR2 * 0.8 * Math.cos(2 * Math.PI / 3))
            .stroke({ color: primary, width: 2, alpha: 0.5 })
          geo.moveTo(hexR2 * 0.8 * Math.sin(4 * Math.PI / 3), -hexR2 * 0.8 * Math.cos(4 * Math.PI / 3))
            .lineTo(hexR2 * 0.8 * Math.sin(5 * Math.PI / 3), -hexR2 * 0.8 * Math.cos(5 * Math.PI / 3))
            .stroke({ color: primary, width: 2, alpha: 0.5 })

          var px1 = hexR2 * Math.sqrt(3) / 2
          var py1 = -hexR2 / 2
          var px2 = hexR2 * Math.sqrt(3) / 2
          var py2 = hexR2 / 2
          var pentTopX = px1 + hexR2 * 0.8
          var pentTopY = py1 - hexR2 * 0.1
          var pentMidX = px1 + hexR2 * 1.2
          var pentMidY = 0
          var pentBotX = px2 + hexR2 * 0.8
          var pentBotY = py2 + hexR2 * 0.1

          geo.moveTo(px1, py1).lineTo(pentTopX, pentTopY).lineTo(pentMidX, pentMidY)
            .lineTo(pentBotX, pentBotY).lineTo(px2, py2).stroke({ color: primary, width: 3, alpha: 0.8 })

          var drawBranch = function (sx, sy, angle, len, node) {
            var ex = sx + Math.cos(angle) * len
            var ey = sy + Math.sin(angle) * len
            geo.moveTo(sx, sy).lineTo(ex, ey).stroke({ color: primary, width: 2, alpha: 0.6 })
            if (node) geo.circle(ex, ey, 6).stroke({ color: primary, width: 2, alpha: 0.8 })
          }

          drawBranch(0, -hexR2, -Math.PI / 2, radius * 0.15, true)
          drawBranch(-hexR2 * Math.sqrt(3) / 2, hexR2 / 2, Math.PI * 0.8, radius * 0.2, true)
          drawBranch(-hexR2 * Math.sqrt(3) / 2, -hexR2 / 2, -Math.PI * 0.8, radius * 0.15, false)
          drawBranch(pentMidX, pentMidY, 0, radius * 0.18, false)
          drawBranch(pentMidX + radius * 0.18, pentMidY, Math.PI / 4, radius * 0.1, true)
        } else {
          // 子变体 2：线性聚合物链（锯齿主链 + 官能团）
          var segLen = radius * 0.18
          var steps = 7
          var startX = -segLen * (steps / 2) * Math.cos(Math.PI / 6)
          var pts = []

          var cx2 = startX
          var cy2 = 0
          pts.push({ x: cx2, y: cy2 })
          for (var st = 0; st < steps; st++) {
            cx2 += segLen * Math.cos(Math.PI / 6)
            cy2 = (st % 2 === 0 ? 1 : -1) * segLen * Math.sin(Math.PI / 6)
            pts.push({ x: cx2, y: cy2 })
          }

          geo.moveTo(pts[0].x, pts[0].y)
          for (var ln = 1; ln <= steps; ln++) geo.lineTo(pts[ln].x, pts[ln].y)
          geo.stroke({ color: primary, width: 3, alpha: 0.8 })

          // 双键的法向偏移
          var nx = -Math.sin(Math.PI / 6) * 6
          var ny = Math.cos(Math.PI / 6) * 6
          geo.moveTo(pts[1].x + nx, pts[1].y + ny)
            .lineTo(pts[2].x + nx, pts[2].y + ny)
            .stroke({ color: primary, width: 2, alpha: 0.5 })

          for (var pi = 1; pi < steps; pi++) {
            var pAngle = pi % 2 === 0 ? Math.PI / 2 : -Math.PI / 2
            var bx = pts[pi].x
            var by = pts[pi].y + Math.sin(pAngle) * segLen * 0.6
            geo.moveTo(pts[pi].x, pts[pi].y).lineTo(bx, by).stroke({ color: primary, width: 2, alpha: 0.5 })
            if (pi % 2 !== 0) {
              geo.circle(bx, by, 5).stroke({ color: primary, width: 2, alpha: 0.8 })
            } else {
              geo.moveTo(bx, by).lineTo(bx + segLen * 0.5, by - segLen * 0.3).stroke({ color: primary, width: 2, alpha: 0.5 })
            }
          }
        }
      } else if (geoVariant === 4) {
        // 变体 4：原子电子轨道（相交椭圆）
        var ellR = radius * 0.7
        for (var e0 = 0; e0 < 3; e0++) {
          var eAngle = e0 * Math.PI / 3
          var eSteps = 60
          for (var e1 = 0; e1 <= eSteps; e1++) {
            var t0 = e1 * Math.PI * 2 / eSteps
            var ex = Math.cos(t0) * ellR
            var ey = Math.sin(t0) * ellR * 0.18
            var rx = ex * Math.cos(eAngle) - ey * Math.sin(eAngle)
            var ry = ex * Math.sin(eAngle) + ey * Math.cos(eAngle)
            if (e1 === 0) geo.moveTo(rx, ry)
            else geo.lineTo(rx, ry)
          }
          geo.stroke({ color: primary, width: 1, alpha: 0.3 })
        }
        // 小核
        geo.circle(0, 0, radius * 0.05).fill({ color: primary, alpha: 0.8 })
      } else if (geoVariant === 5) {
        // 变体 5：带环与轨道的行星
        var planetR = radius * 0.25
        geo.circle(0, 0, planetR).fill({ color: primary, alpha: 0.15 }).stroke({ color: primary, width: 2, alpha: 0.8 })
        geo.moveTo(-planetR * 0.7, -planetR * 0.5).quadraticCurveTo(0, -planetR * 0.2, planetR * 0.7, -planetR * 0.5).stroke({ color: primary, width: 1, alpha: 0.4 })
        geo.moveTo(-planetR * 0.9, 0).quadraticCurveTo(0, planetR * 0.3, planetR * 0.9, 0).stroke({ color: primary, width: 1, alpha: 0.4 })
        var ringRx = radius * 0.6
        var ringRy = radius * 0.15
        var tilt = Math.PI / 6 // 30 度倾角

        var drawTiltedEllipse = function (rx, ry, w, a, segments) {
          if (segments === undefined) segments = 60
          for (var j = 0; j <= segments; j++) {
            var t = j * Math.PI * 2 / segments
            var ex2 = Math.cos(t) * rx
            var ey2 = Math.sin(t) * ry
            var rotX = ex2 * Math.cos(tilt) - ey2 * Math.sin(tilt)
            var rotY = ex2 * Math.sin(tilt) + ey2 * Math.cos(tilt)
            if (j === 0) geo.moveTo(rotX, rotY)
            else geo.lineTo(rotX, rotY)
          }
          geo.stroke({ color: primary, width: w, alpha: a })
        }

        drawTiltedEllipse(ringRx, ringRy, 4, 0.5)
        drawTiltedEllipse(ringRx * 1.1, ringRy * 1.15, 1, 0.3)
        drawTiltedEllipse(ringRx * 1.25, ringRy * 1.3, 2, 0.2)

        // 远轨道
        geo.circle(0, 0, radius * 0.7).stroke({ color: primary, width: 1, alpha: 0.2 })
        geo.circle(Math.cos(Math.PI / 4) * radius * 0.7, Math.sin(Math.PI / 4) * radius * 0.7, 8).fill({ color: primary, alpha: 0.6 })
      } else if (geoVariant === 6) {
        // 变体 6：抽象线框山脉（赛博网格风景）
        var bleed6 = Decor.resolveSonnetShotMgBleed(width, height, radius)
        var w6 = bleed6.x * 1.08
        var h6 = radius * 0.8
        var baseY6 = radius * 0.2

        // 背景太阳/月亮
        geo.circle(0, baseY6 - h6 * 0.6, radius * 0.3).stroke({ color: primary, width: 2, alpha: 0.4 })
        for (var sl = 0; sl < 5; sl++) {
          geo.moveTo(-bleed6.x, baseY6 - h6 * 0.6 + sl * 15).lineTo(bleed6.x, baseY6 - h6 * 0.6 + sl * 15).stroke({ color: primary, width: 1, alpha: 0.3 })
        }

        // 山峰（分层多边形）
        var peaks = 7
        for (var layer = 0; layer < 3; layer++) {
          var layerW = w6 * (1 + layer * 0.2)
          var layerH = h6 * (0.5 + layer * 0.25)
          geo.moveTo(-layerW / 2, baseY6)
          for (var p0 = 1; p0 < peaks; p0++) {
            var px = -layerW / 2 + (layerW / peaks) * p0
            var py = baseY6 - layerH * (0.3 + 0.7 * Math.abs(Math.sin(seed + layer * 11 + p0 * 7)))
            geo.lineTo(px, py)
          }
          geo.lineTo(layerW / 2, baseY6)
          geo.stroke({ color: primary, width: 3 - layer, alpha: 0.6 - layer * 0.15 })
        }

        // 基线
        geo.moveTo(-w6, baseY6).lineTo(w6, baseY6).stroke({ color: primary, width: 4, alpha: 0.8 })

        // 网格地面
        for (var g0 = 0; g0 < 5; g0++) {
          var gridY = baseY6 + Math.pow(g0, 1.5) * 12
          geo.moveTo(-w6, gridY).lineTo(w6, gridY).stroke({ color: primary, width: 1, alpha: 0.4 - g0 * 0.08 })
        }

        // 透视线
        for (var pl = -4; pl <= 4; pl++) {
          geo.moveTo(pl * radius * 0.2, baseY6).lineTo(pl * bleed6.x * 0.32, bleed6.y).stroke({ color: primary, width: 1, alpha: 0.3 })
        }
      } else if (geoVariant === 7) {
        // 变体 7：雷达 / 同心靶
        for (var ri = 1; ri <= 6; ri++) {
          var rr = radius * 0.15 * ri
          geo.circle(0, 0, rr).stroke({ color: primary, width: ri % 2 === 0 ? 2 : 1, alpha: 0.2 + (ri % 3) * 0.1 })
        }
        // 十字线
        geo.moveTo(-radius * 0.9, 0).lineTo(radius * 0.9, 0).stroke({ color: primary, width: 1, alpha: 0.4 })
        geo.moveTo(0, -radius * 0.9).lineTo(0, radius * 0.9).stroke({ color: primary, width: 1, alpha: 0.4 })

        // 雷达扫描弧
        geo.moveTo(0, 0)
        geo.arc(0, 0, radius * 0.75, 0, Math.PI / 4)
        geo.lineTo(0, 0)
        geo.fill({ color: primary, alpha: 0.1 })
        geo.stroke({ color: primary, width: 2, alpha: 0.5 })

        // 外圈刻度
        var rOuter = radius * 0.8
        for (var tk = 0; tk < 72; tk++) {
          var tkAngle = (tk / 72) * Math.PI * 2
          var len = tk % 18 === 0 ? 20 : (tk % 6 === 0 ? 10 : 5)
          geo.moveTo(Math.cos(tkAngle) * rOuter, Math.sin(tkAngle) * rOuter)
            .lineTo(Math.cos(tkAngle) * (rOuter + len), Math.sin(tkAngle) * (rOuter + len))
            .stroke({ color: primary, width: 1, alpha: 0.4 })
        }

        // 漂浮的目标锁定
        var lockAngle = (seed % 360) * Math.PI / 180
        var lockR = radius * 0.45
        var lx = Math.cos(lockAngle) * lockR
        var ly = Math.sin(lockAngle) * lockR
        geo.rect(lx - 15, ly - 15, 30, 30).stroke({ color: primary, width: 2, alpha: 0.8 })
        geo.moveTo(lx, ly - 20).lineTo(lx, ly + 20).stroke({ color: primary, width: 1, alpha: 0.6 })
        geo.moveTo(lx - 20, ly).lineTo(lx + 20, ly).stroke({ color: primary, width: 1, alpha: 0.6 })
      } else if (geoVariant === 8) {
        // 变体 8：技术 HUD 装饰框
        var fw = radius * 0.85
        var fh = radius * 0.65

        // 角括号
        var bracketSize = radius * 0.15
        var drawBracket = function (cx, cy, sx, sy) {
          geo.moveTo(cx - sx * bracketSize, cy)
            .lineTo(cx, cy)
            .lineTo(cx, cy - sy * bracketSize)
            .stroke({ color: primary, width: 3, alpha: 0.7 })
          geo.moveTo(cx - sx * bracketSize * 0.8, cy - sy * 8)
            .lineTo(cx - sx * 8, cy - sy * 8)
            .lineTo(cx - sx * 8, cy - sy * bracketSize * 0.8)
            .stroke({ color: primary, width: 1, alpha: 0.4 })
        }
        drawBracket(-fw, -fh, -1, -1)
        drawBracket(fw, -fh, 1, -1)
        drawBracket(-fw, fh, -1, 1)
        drawBracket(fw, fh, 1, 1)

        // 刻度尺
        for (var ri2 = -fw + 20; ri2 < fw - 20; ri2 += 20) {
          geo.moveTo(ri2, -fh).lineTo(ri2, -fh - (ri2 % 60 === 0 ? 12 : 6)).stroke({ color: primary, width: 1, alpha: 0.5 })
          geo.moveTo(ri2, fh).lineTo(ri2, fh + (ri2 % 60 === 0 ? 12 : 6)).stroke({ color: primary, width: 1, alpha: 0.5 })
        }

        // 中央目标环
        geo.circle(0, 0, radius * 0.1).stroke({ color: primary, width: 2, alpha: 0.4 })
        geo.moveTo(-radius * 0.15, 0).lineTo(radius * 0.15, 0).stroke({ color: primary, width: 1, alpha: 0.4 })
        geo.moveTo(0, -radius * 0.15).lineTo(0, radius * 0.15).stroke({ color: primary, width: 1, alpha: 0.4 })

        // 数据块
        geo.rect(-fw, -fh + 20, 10, 40).fill({ color: primary, alpha: 0.5 })
        geo.rect(-fw, -fh + 65, 10, 15).fill({ color: primary, alpha: 0.3 })
        geo.rect(fw - 10, fh - 60, 10, 40).fill({ color: primary, alpha: 0.5 })
      } else if (geoVariant === 9) {
        // 变体 9：等距 3D 立方体
        var drawCube = function (cx, cy, size, alpha) {
          var dy = size * 0.5 // 等距投影近似
          var dx2 = size * 0.866 // sqrt(3)/2

          // 顶面
          geo.moveTo(cx, cy - size)
            .lineTo(cx + dx2, cy - dy)
            .lineTo(cx, cy)
            .lineTo(cx - dx2, cy - dy)
            .lineTo(cx, cy - size)
            .fill({ color: primary, alpha: alpha * 0.15 })
            .stroke({ color: primary, width: 2, alpha: alpha * 0.8 })

          // 右面
          geo.moveTo(cx, cy)
            .lineTo(cx + dx2, cy - dy)
            .lineTo(cx + dx2, cy + size - dy)
            .lineTo(cx, cy + size)
            .lineTo(cx, cy)
            .fill({ color: primary, alpha: alpha * 0.3 })
            .stroke({ color: primary, width: 2, alpha: alpha * 0.8 })

          // 左面
          geo.moveTo(cx, cy)
            .lineTo(cx - dx2, cy - dy)
            .lineTo(cx - dx2, cy + size - dy)
            .lineTo(cx, cy + size)
            .lineTo(cx, cy)
            .fill({ color: primary, alpha: alpha * 0.05 })
            .stroke({ color: primary, width: 2, alpha: alpha * 0.8 })
        }

        drawCube(0, 0, radius * 0.35, 0.8)
        drawCube(radius * 0.4, -radius * 0.15, radius * 0.2, 0.5)
        drawCube(-radius * 0.45, radius * 0.25, radius * 0.25, 0.6)
        drawCube(0, radius * 0.45, radius * 0.15, 0.4)

        // 背景连接线
        geo.moveTo(0, 0).lineTo(radius * 0.4, -radius * 0.15).stroke({ color: primary, width: 1, alpha: 0.3 })
        geo.moveTo(0, 0).lineTo(-radius * 0.45, radius * 0.25).stroke({ color: primary, width: 1, alpha: 0.3 })
      } else if (geoVariant === 10) {
        // 变体 10：星座网络
        geo.circle(0, 0, radius * 0.75).stroke({ color: primary, width: 1, alpha: 0.2 })
        geo.circle(0, 0, radius * 0.73).stroke({ color: primary, width: 2, alpha: 0.1 })

        var nodes = []
        for (var n0 = 0; n0 < 18; n0++) {
          var nr = radius * (0.1 + ((seed * 17 + n0 * 23) % 65) / 100)
          var nAngle = ((seed * 11 + n0 * 37) % 360) * Math.PI / 180
          nodes.push({ x: Math.cos(nAngle) * nr, y: Math.sin(nAngle) * nr })
        }

        // 绘制节点并连接邻近节点
        for (var n1 = 0; n1 < nodes.length; n1++) {
          geo.circle(nodes[n1].x, nodes[n1].y, 3).fill({ color: primary, alpha: 0.7 })
          geo.circle(nodes[n1].x, nodes[n1].y, 6).stroke({ color: primary, width: 1, alpha: 0.3 })

          for (var n2 = n1 + 1; n2 < nodes.length; n2++) {
            var dist = Math.hypot(nodes[n1].x - nodes[n2].x, nodes[n1].y - nodes[n2].y)
            if (dist < radius * 0.45) {
              geo.moveTo(nodes[n1].x, nodes[n1].y)
                .lineTo(nodes[n2].x, nodes[n2].y)
                .stroke({ color: primary, width: 1, alpha: 0.4 * (1 - dist / (radius * 0.45)) })
            }
          }
        }
      } else if (geoVariant === 11) {
        // 变体 11：月亮与月相
        var moonR = radius * 0.4
        geo.moveTo(0, -moonR)
        geo.arc(0, 0, moonR, -Math.PI / 2, Math.PI / 2, false)
        geo.quadraticCurveTo(-moonR * 0.4, 0, 0, -moonR)
        geo.fill({ color: primary, alpha: 0.8 })

        geo.circle(0, 0, moonR).stroke({ color: primary, width: 1, alpha: 0.3 })

        var orbitR = radius * 0.65
        geo.circle(0, 0, orbitR).stroke({ color: primary, width: 1, alpha: 0.2 })

        // 迷你月相
        for (var ph = 0; ph < 8; ph++) {
          var phAngle = (ph / 8) * Math.PI * 2 - Math.PI / 2
          var mx = Math.cos(phAngle) * orbitR
          var my = Math.sin(phAngle) * orbitR

          geo.circle(mx, my, 8).stroke({ color: primary, width: 1, alpha: 0.5 })

          if (ph === 0) {
            // 新月：留空
          } else if (ph === 4) {
            geo.circle(mx, my, 6).fill({ color: primary, alpha: 0.8 })
          } else {
            geo.moveTo(mx, my - 6).arc(mx, my, 6, -Math.PI / 2, Math.PI / 2, ph > 4).lineTo(mx, my - 6).fill({ color: primary, alpha: 0.5 })
          }
        }

        // 几何星形
        var drawStar = function (sx, sy, sr) {
          geo.moveTo(sx, sy - sr).lineTo(sx + sr * 0.2, sy - sr * 0.2)
            .lineTo(sx + sr, sy).lineTo(sx + sr * 0.2, sy + sr * 0.2)
            .lineTo(sx, sy + sr).lineTo(sx - sr * 0.2, sy + sr * 0.2)
            .lineTo(sx - sr, sy).lineTo(sx - sr * 0.2, sy - sr * 0.2)
            .fill({ color: primary, alpha: 0.7 })
        }
        drawStar(-radius * 0.4, -radius * 0.5, 12)
        drawStar(radius * 0.5, -radius * 0.3, 8)
        drawStar(-radius * 0.2, radius * 0.5, 15)
      } else if (geoVariant === 12) {
        // 变体 12：几何花卉 / 植物（莲花）
        var petalLen = radius * 0.5
        var drawPetal = function (angle, length, pWidth, alpha) {
          var cx = 0
          var cy = 0
          var endX = cx + Math.cos(angle) * length
          var endY = cy + Math.sin(angle) * length
          var ctrlDist = length * 0.5

          var lca = angle - pWidth
          var c1x = cx + Math.cos(lca) * ctrlDist
          var c1y = cy + Math.sin(lca) * ctrlDist

          var rca = angle + pWidth
          var c2x = cx + Math.cos(rca) * ctrlDist
          var c2y = cy + Math.sin(rca) * ctrlDist

          geo.moveTo(cx, cy)
          geo.quadraticCurveTo(c1x, c1y, endX, endY)
          geo.quadraticCurveTo(c2x, c2y, cx, cy)
          geo.stroke({ color: primary, width: 1, alpha: alpha })
          if (alpha > 0.5) geo.fill({ color: primary, alpha: alpha * 0.2 })
        }

        // 多层莲花
        for (var lotus = 0; lotus < 4; lotus++) {
          var petals = 8 + lotus * 4
          var currentLen = petalLen * (1 - lotus * 0.2)
          var currentWidth = 0.3 - lotus * 0.05
          var petalOffset = lotus * (Math.PI / petals)
          for (var pe = 0; pe < petals; pe++) {
            var peAngle = (pe / petals) * Math.PI * 2 + petalOffset
            drawPetal(peAngle, currentLen, currentWidth, 0.8 - lotus * 0.15)
          }
        }

        // 中央花蕊
        geo.circle(0, 0, radius * 0.08).stroke({ color: primary, width: 2, alpha: 0.8 })
        geo.circle(0, 0, radius * 0.03).fill({ color: primary, alpha: 0.9 })

        // 环绕的几何茎藤
        var stemR = radius * 0.65
        for (var stem = 0; stem < 3; stem++) {
          var stemAngle = (stem / 3) * Math.PI * 2
          geo.moveTo(Math.cos(stemAngle) * stemR, Math.sin(stemAngle) * stemR)
          geo.bezierCurveTo(
            Math.cos(stemAngle + 1) * stemR * 1.2, Math.sin(stemAngle + 1) * stemR * 1.2,
            Math.cos(stemAngle + 2) * stemR * 0.8, Math.sin(stemAngle + 2) * stemR * 0.8,
            Math.cos(stemAngle + 3) * stemR, Math.sin(stemAngle + 3) * stemR
          ).stroke({ color: primary, width: 1, alpha: 0.4 })

          // 藤上的叶节点
          var lx = Math.cos(stemAngle + 1.5) * stemR * 1.05
          var ly = Math.sin(stemAngle + 1.5) * stemR * 1.05
          geo.circle(lx, ly, 4).fill({ color: primary, alpha: 0.6 })
        }
      } else if (geoVariant === 13) {
        // 变体 13：神圣几何（生命之种）
        var soflR = radius * 0.25 // 每个圆的半径
        var drawIntersectingCircle = function (cx, cy, alpha) {
          geo.circle(cx, cy, soflR).stroke({ color: primary, width: 1.5, alpha: alpha })
        }

        drawIntersectingCircle(0, 0, 0.35)

        for (var sc = 0; sc < 6; sc++) {
          var scAngle = (sc / 6) * Math.PI * 2
          var scx = Math.cos(scAngle) * soflR
          var scy = Math.sin(scAngle) * soflR
          drawIntersectingCircle(scx, scy, 0.2)
        }

        for (var oc = 0; oc < 12; oc++) {
          var ocAngle = (oc / 12) * Math.PI * 2
          var ocDist = oc % 2 === 0 ? soflR * 2 : soflR * Math.sqrt(3)
          var ocx = Math.cos(ocAngle) * ocDist
          var ocy = Math.sin(ocAngle) * ocDist
          geo.circle(ocx, ocy, soflR).stroke({ color: secondary, width: 1, alpha: 0.1 })
        }

        // 包络圆
        geo.circle(0, 0, soflR * 3).stroke({ color: primary, width: 1.5, alpha: 0.2 })
        geo.circle(0, 0, soflR * 3.1).stroke({ color: secondary, width: 1, alpha: 0.08 })

        // 径向连接线（刻意极淡，避免蛛网感）
        for (var rc = 0; rc < 12; rc++) {
          var rcAngle = (rc / 12) * Math.PI * 2
          geo.moveTo(Math.cos(rcAngle) * soflR * 0.5, Math.sin(rcAngle) * soflR * 0.5)
            .lineTo(Math.cos(rcAngle) * soflR * 3, Math.sin(rcAngle) * soflR * 3)
            .stroke({ color: secondary, width: 1, alpha: 0.05 })
        }
      } else if (geoVariant === 14) {
        // 变体 14：大型半透明建筑独石
        var dir14 = seed % 2 === 0 ? 1 : -1
        Decor.drawSonnetSolidCuboid(geo, radius * 0.18 * dir14, radius * 0.03, radius * 0.62, radius * 0.7, radius * 0.22 * dir14, -radius * 0.16, primary, 0.34)
        Decor.drawSonnetSolidCuboid(geo, -radius * 0.48 * dir14, radius * 0.24, radius * 0.28, radius * 0.38, radius * 0.12 * dir14, -radius * 0.09, primary, 0.24)
        Decor.drawSonnetSolidCuboid(geo, radius * 0.55 * dir14, -radius * 0.3, radius * 0.2, radius * 0.26, radius * 0.09 * dir14, -radius * 0.07, primary, 0.2)
      } else if (geoVariant === 15) {
        // 变体 15：漂浮三棱柱
        var dir15 = seed % 2 === 0 ? 1 : -1
        Decor.drawSonnetTriangularPrism(geo, -radius * 0.12 * dir15, radius * 0.02, radius * 0.72, radius * 0.68, radius * 0.18 * dir15, -radius * 0.13, primary, 0.34)
        Decor.drawSonnetTriangularPrism(geo, radius * 0.48 * dir15, radius * 0.26, radius * 0.28, radius * 0.25, -radius * 0.08 * dir15, -radius * 0.06, primary, 0.22)
        Decor.drawSonnetTriangularPrism(geo, -radius * 0.5 * dir15, -radius * 0.3, radius * 0.2, radius * 0.18, radius * 0.06 * dir15, -radius * 0.05, primary, 0.18)
      } else if (geoVariant === 16) {
        // 变体 16：多面六角柱体
        var dir16 = seed % 2 === 0 ? 1 : -1
        Decor.drawSonnetHexagonalPrism(geo, radius * 0.12 * dir16, 0, radius * 0.68, radius * 0.72, radius * 0.2 * dir16, -radius * 0.14, primary, 0.32)
        Decor.drawSonnetHexagonalPrism(geo, -radius * 0.48 * dir16, radius * 0.27, radius * 0.25, radius * 0.28, radius * 0.07 * dir16, -radius * 0.05, primary, 0.2)
        Decor.drawSonnetHexagonalPrism(geo, radius * 0.52 * dir16, -radius * 0.3, radius * 0.18, radius * 0.2, -radius * 0.06 * dir16, -radius * 0.045, primary, 0.17)
      } else if (geoVariant === 17) {
        // 变体 17：梯形棱柱与低矮建筑基座
        var dir17 = seed % 2 === 0 ? 1 : -1
        Decor.drawSonnetTrapezoidPrism(geo, radius * 0.12 * dir17, radius * 0.04, radius * 0.3, radius * 0.68, radius * 0.62, radius * 0.18 * dir17, -radius * 0.13, primary, 0.34)
        Decor.drawSonnetTrapezoidPrism(geo, -radius * 0.42 * dir17, radius * 0.28, radius * 0.2, radius * 0.38, radius * 0.22, radius * 0.08 * dir17, -radius * 0.06, primary, 0.21)
        Decor.drawSonnetTrapezoidPrism(geo, radius * 0.5 * dir17, -radius * 0.3, radius * 0.2, radius * 0.12, radius * 0.22, -radius * 0.06 * dir17, -radius * 0.05, primary, 0.18)
      } else {
        drawAdditionalSonnetShotMg({
          target: geo,
          variant: geoVariant,
          radius: radius,
          width: width,
          height: height,
          seed: seed,
          primary: primary,
          secondary: secondary
        })
      }

      // 随机几何构图已移到 sonnetTextViewBuilder，让它们伴随文字

      // 按变体兼容性选择性地施加确定性旋转
      var keepsUpright = [6, 8, 9, 14, 15, 16, 17, 20, 22, 23].indexOf(geoVariant) >= 0
        || geoVariant >= window.FoliaSonnetMgThemed.SONNET_THEMED_GEO_VARIANT_START
      if (!keepsUpright) {
        // 任意旋转
        geo.rotation = ((seed * 13) % 360) * (Math.PI / 180)
      } else if (geoVariant === 8) {
        // HUD 框按 90 度增量旋转
        geo.rotation = Decor.resolveSonnetHudRotationQuarterTurns(seed) * (Math.PI / 2)
      }

      container.addChild(geo.display)

      // 固定几何在镜头移动时保持竖直，可独立于动态主场景与漂浮粒子开关。
      // 种子化变体构建器返回所有 AnimatedGraphics 部件（实心/空心件加影线），
      // 让它们随共享错峰日程一起生长。
      fixedGeoLayer = new Container()
      fixedGeoParts = Decor.buildSonnetFixedGeo({
        pixi: pixi,
        layer: fixedGeoLayer,
        variant: Decor.resolveSonnetFixedGeoVariant(seed),
        radius: radius,
        seed: seed,
        primary: primary,
        secondary: secondary
      })
      container.addChild(fixedGeoLayer)
    } else if (kind === 'editorial-column') {
      // 严格网格
      for (var gi = 1; gi <= 6; gi++) {
        var gx = -hw + width * (gi / 7)
        bg.moveTo(gx, -hh).lineTo(gx, hh).stroke({ color: primary, width: 1, alpha: 0.15 })
      }
      for (var gj = 1; gj <= 4; gj++) {
        var gy = -hh + height * (gj / 5)
        bg.moveTo(-hw, gy).lineTo(hw, gy).stroke({ color: primary, width: 1, alpha: 0.15 })
      }
      bg.rect(-hw + width * 0.2, -hh + height * 0.2, width * 0.6, height * 0.6).stroke({ color: primary, width: 4, alpha: 0.5 })
    } else {
      // quiet-tableau 或 mask-reveal（极简散布元素）
      for (var q = 0; q < 5; q++) {
        var qSize = 10 + (seed % (q + 1)) * 5
        bg.rect(
          -hw + width * (0.2 + ((seed * 11 + q) % 60) / 100),
          -hh + height * (0.2 + ((seed * 17 + q) % 60) / 100),
          qSize, qSize
        ).fill({ color: primary, alpha: 0.4 })
      }
    }

    container.bg = bg
    container.bgLayer = bg.display
    if (geo) {
      container.geo = geo
      container.geoLayer = geo.display
    }
    container.fixedGeoParts = fixedGeoParts
    container.fixedGeoLayer = fixedGeoLayer

    container.addChild(bg.display)

    // --- 组件：漂浮粒子（种子化背景装饰变体） ---
    var decor = Decor.buildSonnetBackgroundDecor({
      pixi: pixi,
      kind: kind,
      width: width,
      height: height,
      seed: seed,
      primary: primary,
      secondary: secondary,
      iconTextures: Array.from(iconTextures.values())
    })
    var particleLayer = decor.layer
    var iconAnimations = decor.iconAnimations
    var smoothedIconAudio = 0

    iconAnimations.forEach(function (icon, index) {
      icon.entryPhase = window.FoliaSonnetText.resolveSonnetIconEntryPhase(index, iconAnimations.length)
    })

    container.addChild(particleLayer)
    container.particleLayer = particleLayer
    container.decorVariant = Decor.resolveSonnetBackgroundDecorVariant(seed)

    container.updateTime = function (time, cues, startTime, endTime, audioBass, audioPower, audioVocal) {
      if (audioBass === undefined) audioBass = 0
      if (audioPower === undefined) audioPower = 0
      if (audioVocal === undefined) audioVocal = 0
      // 连续贝塞尔曲线动画（缓出三次），忽略节奏 cue 的跳变，
      // 但把进度铺在该 shot 中歌词的真实时长上。

      var targetFinishTime = endTime
      if (cues.length > 0) {
        // 此前只用 cues[cues.length - 1].at，但最后一个词是长延音时
        // 背景会过早画完然后僵住。强制至少占 shot 总时长的 95%，
        // 保证长 shot 有连续的背景运动。
        var lastWordStart = cues[cues.length - 1].at
        targetFinishTime = Math.max(
          lastWordStart,
          startTime + (endTime - startTime) * 0.95
        )
      } else {
        targetFinishTime = startTime + (endTime - startTime) * 0.95
      }

      targetFinishTime = Math.min(endTime, targetFinishTime)

      var drawDuration = Math.max(1.0, targetFinishTime - startTime)
      var rawProgress = Math.min(1, Math.max(0, (time - startTime) / drawDuration))

      // 传递 rawProgress；AnimatedGraphics 自己处理局部缓动，
      // 避免错峰元素的曲线被截断

      if (container.geo) container.geo.update(rawProgress)
      if (container.bg) container.bg.update(rawProgress)
      if (container.fixedGeoParts) {
        var parts = container.fixedGeoParts
        for (var fp = 0; fp < parts.length; fp += 1) parts[fp].update(rawProgress)
      }

      var audioEnergy = normalizeAudioLevel(audioBass) * 0.34
        + normalizeAudioLevel(audioVocal) * 0.52
        + normalizeAudioLevel(audioPower) * 0.14
      // 忽略怠速呼吸信号，再扩放可听范围让中等峰值保持可见
      var gatedEnergy = Math.max(0, (audioEnergy - 0.08) / 0.92)
      var targetIconAudio = Math.min(1, Math.pow(gatedEnergy, 0.68) * 1.35)
      var smoothing = targetIconAudio > smoothedIconAudio ? 0.34 : 0.16
      smoothedIconAudio += (targetIconAudio - smoothedIconAudio) * smoothing
      var sceneDuration = Math.max(0.01, endTime - startTime)
      iconAnimations.forEach(function (icon) {
        var entryDuration = window.FoliaSonnetText.resolveSonnetIconEntryDuration(sceneDuration, icon.preferredDuration)
        var entryDelay = window.FoliaSonnetText.resolveSonnetIconEntryDelay(icon.entryPhase, sceneDuration, entryDuration)
        var entryProgress = Math.min(
          1,
          Math.max(0, (time - startTime - entryDelay) / entryDuration)
        )
        var entryEased = 1 - Math.pow(1 - entryProgress, 3)
        var loopPulse = (Math.sin((time - startTime) * Math.PI * 0.7 + icon.phase) + 1) * 0.5
        var audioScale = 1 + smoothedIconAudio * 0.42
        var loopScale = 1 + loopPulse * 0.025

        icon.node.alpha = Math.min(
          1,
          icon.baseAlpha * entryEased * (0.72 + smoothedIconAudio * 0.38 + loopPulse * 0.03)
        )
        icon.node.scale.set(
          icon.baseScale * (0.72 + entryEased * 0.28) * audioScale * loopScale
        )
      })
    }

    return container
  }

  // hashSonnetSeed 暴露给可能的调试用途（与原版导出面一致）
  window.FoliaSonnetMg = {
    SONNET_ADDITIONAL_GEO_VARIANT_START: SONNET_ADDITIONAL_GEO_VARIANT_START,
    SONNET_ADDITIONAL_GEO_VARIANT_COUNT: SONNET_ADDITIONAL_GEO_VARIANT_COUNT,
    drawAdditionalSonnetShotMg: drawAdditionalSonnetShotMg,
    resolveSonnetTextFixedGeoPlan: resolveSonnetTextFixedGeoPlan,
    buildSonnetTextFixedGeo: buildSonnetTextFixedGeo,
    buildSonnetShotMg: buildSonnetShotMg,
    hashSonnetSeedRef: hashSonnetSeed
  }
})()
