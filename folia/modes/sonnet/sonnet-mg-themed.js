// 商籁模式·主题化 MG 变体：移植自 folia-major
//   sonnet/sonnetThemedShotMgPrimitives.ts（共享路径配方）
//   sonnet/sonnetShotMgFlora.ts（山茶/郁金香田/野花）
//   sonnet/sonnetShotMgBotanical.ts（蕨/银杏/攀藤）
//   sonnet/sonnetShotMgArchitecture.ts（温室/宝塔/城市立面）
//   sonnet/sonnetShotMgLandscape.ts（梯田/山湖/海岸崖）
//   sonnet/sonnetThemedShotMg.ts（十二个主题背景的确定性扩展区间分发）
(function () {
  'use strict'

  // ---------- 共享图元（原版 sonnetThemedShotMgPrimitives.ts） ----------
  function tracePolygon(target, points) {
    points.forEach(function (point, index) {
      if (index === 0) target.moveTo(point[0], point[1])
      else target.lineTo(point[0], point[1])
    })
    return target.lineTo(points[0][0], points[0][1])
  }

  function fillPolygon(target, points, color, alpha) {
    tracePolygon(target, points).fill({ color: color, alpha: alpha })
  }

  function strokePolygon(target, points, color, alpha, width) {
    if (width === undefined) width = 1.5
    tracePolygon(target, points).stroke({ color: color, alpha: alpha, width: width })
  }

  function drawLeaf(target, x, y, length, width, angle, color, fillAlpha) {
    var dx = Math.cos(angle)
    var dy = Math.sin(angle)
    var nx = -dy
    var ny = dx
    var tipX = x + dx * length
    var tipY = y + dy * length
    target.moveTo(x, y)
      .quadraticCurveTo(x + dx * length * 0.45 + nx * width, y + dy * length * 0.45 + ny * width, tipX, tipY)
      .quadraticCurveTo(x + dx * length * 0.45 - nx * width, y + dy * length * 0.45 - ny * width, x, y)
      .fill({ color: color, alpha: fillAlpha })
    target.moveTo(x, y)
      .quadraticCurveTo(x + dx * length * 0.45 + nx * width, y + dy * length * 0.45 + ny * width, tipX, tipY)
      .quadraticCurveTo(x + dx * length * 0.45 - nx * width, y + dy * length * 0.45 - ny * width, x, y)
      .stroke({ color: color, alpha: Math.min(0.8, fillAlpha * 3.2), width: 1.5 })
    target.moveTo(x, y).lineTo(tipX, tipY).stroke({ color: color, alpha: 0.32, width: 1 })
  }

  function drawPetal(target, cx, cy, length, width, angle, color, fillAlpha) {
    drawLeaf(target, cx, cy, length, width, angle, color, fillAlpha)
  }

  // ---------- 花卉（原版 sonnetShotMgFlora.ts） ----------
  function drawSonnetCamelliaMg(options) {
    var target = options.target
    var radius = options.radius
    var seed = options.seed
    var primary = options.primary
    var secondary = options.secondary
    var turn = (seed % 12) * Math.PI / 72
    for (var ring = 0; ring < 3; ring += 1) {
      var count = 7 + ring * 4
      for (var index = 0; index < count; index += 1) {
        var angle = turn + (index / count) * Math.PI * 2 + ring * 0.12
        drawPetal(
          target, 0, 0, radius * (0.28 + ring * 0.15), radius * (0.075 + ring * 0.018),
          angle, ring === 1 ? secondary : primary, 0.07 + ring * 0.045
        )
      }
    }
    target.circle(0, 0, radius * 0.1).fill({ color: secondary, alpha: 0.22 })
    target.circle(0, 0, radius * 0.13).stroke({ color: primary, width: 3, alpha: 0.68 })
  }

  function drawSonnetTulipFieldMg(options) {
    var target = options.target
    var radius = options.radius
    var seed = options.seed
    var primary = options.primary
    var secondary = options.secondary
    var direction = seed % 2 === 0 ? 1 : -1
    for (var index = 0; index < 7; index += 1) {
      var x = (-0.66 + index * 0.22) * radius
      var top = (-0.3 + ((seed + index * 5) % 5) * 0.085) * radius
      var bottom = radius * 0.68
      target.moveTo(x, bottom).bezierCurveTo(x + radius * 0.04 * direction, radius * 0.28, x - radius * 0.05 * direction, top + radius * 0.12, x, top)
        .stroke({ color: index % 2 ? secondary : primary, width: 2, alpha: 0.5 })
      drawLeaf(target, x, radius * 0.24, radius * 0.26, radius * 0.055, index % 2 ? -2.7 : -0.45, primary, 0.1)
      var bloomColor = index % 3 === 0 ? secondary : primary
      target.moveTo(x, top + radius * 0.14)
        .quadraticCurveTo(x - radius * 0.18, top - radius * 0.04, x - radius * 0.11, top - radius * 0.2)
        .lineTo(x, top - radius * 0.1)
        .lineTo(x + radius * 0.11, top - radius * 0.2)
        .quadraticCurveTo(x + radius * 0.18, top - radius * 0.04, x, top + radius * 0.14)
        .fill({ color: bloomColor, alpha: 0.12 + (index % 3) * 0.045 })
      target.moveTo(x, top + radius * 0.14)
        .quadraticCurveTo(x - radius * 0.18, top - radius * 0.04, x - radius * 0.11, top - radius * 0.2)
        .lineTo(x, top - radius * 0.1).lineTo(x + radius * 0.11, top - radius * 0.2)
        .quadraticCurveTo(x + radius * 0.18, top - radius * 0.04, x, top + radius * 0.14)
        .stroke({ color: bloomColor, width: 2, alpha: 0.65 })
    }
  }

  function drawSonnetWildflowerMg(options) {
    var target = options.target
    var radius = options.radius
    var seed = options.seed
    var primary = options.primary
    var secondary = options.secondary
    for (var stem = 0; stem < 9; stem += 1) {
      var x = (-0.72 + stem * 0.18) * radius
      var lean = (((seed + stem * 7) % 9) - 4) * radius * 0.018
      var flowerY = (-0.45 + ((seed + stem * 3) % 6) * 0.08) * radius
      target.moveTo(x, radius * 0.72).quadraticCurveTo(x - lean, radius * 0.12, x + lean, flowerY)
        .stroke({ color: stem % 2 ? secondary : primary, width: 1.5, alpha: 0.42 })
      for (var petal = 0; petal < 5; petal += 1) {
        var angle = (petal / 5) * Math.PI * 2 - Math.PI / 2
        drawPetal(target, x + lean, flowerY, radius * 0.105, radius * 0.032, angle, stem % 3 ? primary : secondary, 0.1)
      }
      target.circle(x + lean, flowerY, radius * 0.025).fill({ color: secondary, alpha: 0.48 })
    }
  }

  // ---------- 植物（原版 sonnetShotMgBotanical.ts） ----------
  function drawSonnetFernMg(options) {
    var target = options.target
    var radius = options.radius
    var seed = options.seed
    var primary = options.primary
    var secondary = options.secondary
    var tilt = (seed % 2 ? 1 : -1) * 0.18
    target.moveTo(-radius * 0.12, radius * 0.72)
      .bezierCurveTo(-radius * 0.04, radius * 0.2, radius * 0.12, -radius * 0.24, radius * 0.02, -radius * 0.72)
      .stroke({ color: primary, width: 3, alpha: 0.62 })
    for (var index = 0; index < 13; index += 1) {
      var ratio = index / 13
      var x = -radius * 0.12 + radius * 0.14 * ratio
      var y = radius * (0.63 - ratio * 1.23)
      var length = radius * (0.3 - Math.abs(ratio - 0.5) * 0.18)
      drawLeaf(target, x, y, length, length * 0.22, Math.PI + tilt - ratio * 0.25, index % 3 ? primary : secondary, 0.09 + ratio * 0.05)
      drawLeaf(target, x, y, length, length * 0.22, -tilt + ratio * 0.25, index % 3 ? secondary : primary, 0.07 + ratio * 0.04)
    }
  }

  function drawSonnetGinkgoMg(options) {
    var target = options.target
    var radius = options.radius
    var seed = options.seed
    var primary = options.primary
    var secondary = options.secondary
    var direction = seed % 2 === 0 ? 1 : -1
    target.moveTo(-radius * 0.72 * direction, radius * 0.55)
      .bezierCurveTo(-radius * 0.25 * direction, radius * 0.16, radius * 0.08 * direction, -radius * 0.12, radius * 0.65 * direction, -radius * 0.5)
      .stroke({ color: primary, width: 5, alpha: 0.38 })
    for (var index = 0; index < 8; index += 1) {
      var ratio = index / 7
      var x = (-0.58 + ratio * 1.12) * radius * direction
      var y = (0.4 - ratio * 0.78 + Math.sin(index * 1.8) * 0.08) * radius
      var angle = -1.1 + (index % 3) * 0.7
      var size = radius * (0.13 + (index % 4) * 0.018)
      target.moveTo(x, y).lineTo(x + Math.cos(angle) * size * 0.7, y + Math.sin(angle) * size * 0.7)
        .stroke({ color: secondary, width: 1.5, alpha: 0.42 })
      var cx = x + Math.cos(angle) * size
      var cy = y + Math.sin(angle) * size
      target.moveTo(cx, cy)
        .arc(cx, cy, size, angle + Math.PI * 0.1, angle + Math.PI * 0.9)
        .lineTo(cx, cy).fill({ color: index % 2 ? primary : secondary, alpha: 0.09 + (index % 3) * 0.04 })
      target.moveTo(cx, cy)
        .arc(cx, cy, size, angle + Math.PI * 0.1, angle + Math.PI * 0.9)
        .lineTo(cx, cy).stroke({ color: primary, width: 1.5, alpha: 0.58 })
    }
  }

  function drawSonnetClimbingVineMg(options) {
    var target = options.target
    var radius = options.radius
    var seed = options.seed
    var primary = options.primary
    var secondary = options.secondary
    var mirror = seed % 2 === 0 ? 1 : -1
    for (var vine = 0; vine < 3; vine += 1) {
      var offset = (vine - 1) * radius * 0.3
      target.moveTo(offset, radius * 0.76)
        .bezierCurveTo(offset + radius * 0.5 * mirror, radius * 0.38, offset - radius * 0.48 * mirror, -radius * 0.1, offset + radius * 0.22 * mirror, -radius * 0.76)
        .stroke({ color: vine === 1 ? secondary : primary, width: vine === 1 ? 3 : 1.5, alpha: 0.46 })
      for (var leaf = 0; leaf < 5; leaf += 1) {
        var ratio = (leaf + 1) / 6
        var x = offset + Math.sin(ratio * Math.PI * 4 + vine) * radius * 0.16
        var y = radius * (0.7 - ratio * 1.36)
        drawLeaf(target, x, y, radius * 0.2, radius * 0.055, leaf % 2 ? -0.25 : Math.PI + 0.25, leaf % 2 ? secondary : primary, 0.08 + vine * 0.035)
      }
    }
  }

  // ---------- 建筑（原版 sonnetShotMgArchitecture.ts） ----------
  function drawSonnetGreenhouseMg(options) {
    var target = options.target
    var radius = options.radius
    var width = options.width
    var height = options.height
    var seed = options.seed
    var primary = options.primary
    var secondary = options.secondary
    var direction = seed % 2 === 0 ? 1 : -1
    var bleed = window.FoliaSonnetDecor.resolveSonnetShotMgBleed(width, height, radius)
    var shell = [
      [-radius * 0.7, radius * 0.58], [-radius * 0.7, -radius * 0.12],
      [0, -radius * 0.62], [radius * 0.7, -radius * 0.12], [radius * 0.7, radius * 0.58]
    ]
    fillPolygon(target, shell, primary, 0.055)
    strokePolygon(target, shell, primary, 0.68, 3)
    target.moveTo(0, -radius * 0.62).lineTo(0, radius * 0.58).stroke({ color: secondary, width: 2, alpha: 0.5 })
    for (var pane = -3; pane <= 3; pane += 1) {
      var x = pane * radius * 0.18
      target.moveTo(x, radius * 0.58).lineTo(x * 0.38, -radius * (0.58 - Math.abs(pane) * 0.04))
        .stroke({ color: pane % 2 ? secondary : primary, width: 1, alpha: 0.32 })
    }
    var doorX = radius * 0.2 * direction
    target.rect(doorX - radius * 0.13, radius * 0.08, radius * 0.26, radius * 0.5)
      .fill({ color: secondary, alpha: 0.1 })
    target.rect(doorX - radius * 0.13, radius * 0.08, radius * 0.26, radius * 0.5)
      .stroke({ color: secondary, width: 2, alpha: 0.62 })
    target.moveTo(-bleed.x, radius * 0.58).lineTo(-radius * 0.7, radius * 0.58)
      .stroke({ color: primary, width: 1, alpha: 0.3 })
    target.moveTo(radius * 0.7, radius * 0.58).lineTo(bleed.x, radius * 0.58)
      .stroke({ color: primary, width: 1, alpha: 0.3 })
  }

  function drawSonnetPagodaMg(options) {
    var target = options.target
    var radius = options.radius
    var width = options.width
    var height = options.height
    var seed = options.seed
    var primary = options.primary
    var secondary = options.secondary
    var lean = seed % 2 === 0 ? 1 : -1
    var bleed = window.FoliaSonnetDecor.resolveSonnetShotMgBleed(width, height, radius)
    for (var floor = 0; floor < 4; floor += 1) {
      var y = radius * (0.47 - floor * 0.27)
      var halfWidth = radius * (0.5 - floor * 0.075)
      var roof = [
        [-halfWidth * 1.18, y], [-halfWidth, y - radius * 0.11],
        [0, y - radius * 0.19], [halfWidth, y - radius * 0.11], [halfWidth * 1.18, y]
      ]
      fillPolygon(target, roof, floor % 2 ? secondary : primary, 0.07 + floor * 0.025)
      strokePolygon(target, roof, floor % 2 ? secondary : primary, 0.58, 2)
      target.rect(-halfWidth * 0.68, y, halfWidth * 1.36, radius * 0.17)
        .fill({ color: primary, alpha: 0.035 + floor * 0.018 })
      target.rect(-halfWidth * 0.68, y, halfWidth * 1.36, radius * 0.17)
        .stroke({ color: primary, width: 1, alpha: 0.36 })
    }
    target.moveTo(0, -radius * 0.62).lineTo(radius * 0.035 * lean, -radius * 0.78)
      .stroke({ color: secondary, width: 3, alpha: 0.65 })
    target.moveTo(-bleed.x, radius * 0.64).lineTo(-radius * 0.52, radius * 0.64)
      .stroke({ color: secondary, width: 1, alpha: 0.22 })
    target.moveTo(radius * 0.52, radius * 0.64).lineTo(bleed.x, radius * 0.64)
      .stroke({ color: secondary, width: 1, alpha: 0.22 })
  }

  function drawSonnetCityFacadeMg(options) {
    var target = options.target
    var radius = options.radius
    var width = options.width
    var height = options.height
    var seed = options.seed
    var primary = options.primary
    var secondary = options.secondary
    var bleed = window.FoliaSonnetDecor.resolveSonnetShotMgBleed(width, height, radius)
    var heights = [0.52, 0.88, 0.66, 1.08, 0.74, 0.94, 0.58]
    var buildingWidth = radius * 0.205
    heights.forEach(function (heightRatio, index) {
      var x = radius * (-0.73 + index * 0.24)
      var h = radius * heightRatio
      var color = index % 3 === 1 ? secondary : primary
      target.rect(x, radius * 0.62 - h, buildingWidth, h)
        .fill({ color: color, alpha: 0.045 + (index % 3) * 0.035 })
      target.rect(x, radius * 0.62 - h, buildingWidth, h)
        .stroke({ color: color, width: index === 3 ? 3 : 1.5, alpha: 0.5 })
      for (var row = 0; row < Math.floor(heightRatio * 6); row += 1) {
        for (var column = 0; column < 2; column += 1) {
          if ((row + column + index + seed) % 3 === 0) {
            target.rect(x + radius * (0.035 + column * 0.085), radius * 0.53 - h + row * radius * 0.13, radius * 0.045, radius * 0.055)
              .fill({ color: column ? secondary : primary, alpha: 0.2 })
          }
        }
      }
    })
    target.moveTo(-bleed.x, radius * 0.63).lineTo(bleed.x, radius * 0.63)
      .stroke({ color: primary, width: 4, alpha: 0.48 })
  }

  // ---------- 风景（原版 sonnetShotMgLandscape.ts） ----------
  function drawSonnetTerracesMg(options) {
    var target = options.target
    var radius = options.radius
    var width = options.width
    var height = options.height
    var seed = options.seed
    var primary = options.primary
    var secondary = options.secondary
    var direction = seed % 2 === 0 ? 1 : -1
    var bleed = window.FoliaSonnetDecor.resolveSonnetShotMgBleed(width, height, radius)
    for (var band = 0; band < 7; band += 1) {
      var y = radius * (-0.5 + band * 0.16)
      var amplitude = radius * (0.09 + band * 0.012)
      target.moveTo(-bleed.x, y)
        .bezierCurveTo(-radius * 0.35, y + amplitude * direction, radius * 0.08, y - amplitude * direction, bleed.x, y + amplitude * 0.35)
        .lineTo(bleed.x, y + radius * 0.12)
        .bezierCurveTo(radius * 0.12, y + radius * 0.04, -radius * 0.3, y + radius * 0.2, -bleed.x, y + radius * 0.12)
        .fill({ color: band % 2 ? secondary : primary, alpha: 0.025 + band * 0.018 })
      target.moveTo(-bleed.x, y)
        .bezierCurveTo(-radius * 0.35, y + amplitude * direction, radius * 0.08, y - amplitude * direction, bleed.x, y + amplitude * 0.35)
        .stroke({ color: band % 2 ? secondary : primary, width: band % 3 === 0 ? 2.5 : 1, alpha: 0.34 + band * 0.04 })
    }
  }

  function drawSonnetMountainLakeMg(options) {
    var target = options.target
    var radius = options.radius
    var width = options.width
    var height = options.height
    var seed = options.seed
    var primary = options.primary
    var secondary = options.secondary
    var bleed = window.FoliaSonnetDecor.resolveSonnetShotMgBleed(width, height, radius)
    var shift = (((seed % 7) - 3) / 3) * radius * 0.04
    var back = [
      [-bleed.x, radius * 0.1], [-radius * 0.42, -radius * 0.46],
      [-radius * 0.14, -radius * 0.16], [radius * 0.22, -radius * 0.62],
      [bleed.x, radius * 0.1]
    ]
    var front = [
      [-bleed.x, radius * 0.22], [-radius * 0.28 + shift, -radius * 0.2],
      [radius * 0.06, radius * 0.05], [radius * 0.48 + shift, -radius * 0.28], [bleed.x, radius * 0.22]
    ]
    fillPolygon(target, back, secondary, 0.07)
    strokePolygon(target, back, secondary, 0.46, 1.5)
    fillPolygon(target, front, primary, 0.12)
    strokePolygon(target, front, primary, 0.66, 2.5)
    for (var line = 0; line < 7; line += 1) {
      var y = radius * (0.28 + line * 0.07)
      var inset = radius * (0.08 + (line % 3) * 0.08)
      target.moveTo(-bleed.x + inset, y).lineTo(bleed.x - inset, y)
        .stroke({ color: line % 2 ? secondary : primary, width: 1, alpha: 0.2 + line * 0.035 })
    }
    target.circle(-radius * 0.48, -radius * 0.48, radius * 0.1).fill({ color: secondary, alpha: 0.14 })
    target.circle(-radius * 0.48, -radius * 0.48, radius * 0.13).stroke({ color: secondary, width: 2, alpha: 0.5 })
  }

  function drawSonnetCoastalCliffMg(options) {
    var target = options.target
    var radius = options.radius
    var width = options.width
    var height = options.height
    var seed = options.seed
    var primary = options.primary
    var secondary = options.secondary
    var direction = seed % 2 === 0 ? 1 : -1
    var bleed = window.FoliaSonnetDecor.resolveSonnetShotMgBleed(width, height, radius)
    var cliff = [
      [-bleed.x * direction, bleed.y], [-radius * 0.78 * direction, -radius * 0.1],
      [-radius * 0.5 * direction, -radius * 0.34], [-radius * 0.18 * direction, radius * 0.08],
      [radius * 0.08 * direction, radius * 0.58]
    ]
    fillPolygon(target, cliff, primary, 0.11)
    strokePolygon(target, cliff, primary, 0.62, 2.5)
    var towerX = -radius * 0.5 * direction
    target.rect(towerX - radius * 0.09, -radius * 0.42, radius * 0.18, radius * 0.45)
      .fill({ color: secondary, alpha: 0.12 })
    target.rect(towerX - radius * 0.09, -radius * 0.42, radius * 0.18, radius * 0.45)
      .stroke({ color: secondary, width: 2, alpha: 0.7 })
    target.moveTo(towerX - radius * 0.14, -radius * 0.42).lineTo(towerX, -radius * 0.56).lineTo(towerX + radius * 0.14, -radius * 0.42)
      .fill({ color: secondary, alpha: 0.2 })
    target.moveTo(towerX - radius * 0.14, -radius * 0.42).lineTo(towerX, -radius * 0.56).lineTo(towerX + radius * 0.14, -radius * 0.42)
      .lineTo(towerX - radius * 0.14, -radius * 0.42)
      .stroke({ color: secondary, width: 2, alpha: 0.72 })
    for (var wave = 0; wave < 6; wave += 1) {
      var y = radius * (0.14 + wave * 0.1)
      target.moveTo(-radius * 0.05 * direction, y)
        .quadraticCurveTo(radius * 0.35 * direction, y - radius * 0.08, bleed.x * direction, y)
        .stroke({ color: wave % 2 ? secondary : primary, width: wave % 3 === 0 ? 2 : 1, alpha: 0.26 + wave * 0.045 })
    }
  }

  // ---------- 主题区间分发（原版 sonnetThemedShotMg.ts） ----------
  var SONNET_THEMED_GEO_VARIANT_START = 24
  var SONNET_THEMED_GEO_VARIANT_COUNT = 12
  var SONNET_THEMED_GEO_VARIANTS = [
    'camellia', 'tulip-field', 'wildflower',
    'fern', 'ginkgo', 'climbing-vine',
    'greenhouse', 'pagoda', 'city-facade',
    'terraces', 'mountain-lake', 'coastal-cliff'
  ]

  var THEMED_DRAWERS = [
    drawSonnetCamelliaMg, drawSonnetTulipFieldMg, drawSonnetWildflowerMg,
    drawSonnetFernMg, drawSonnetGinkgoMg, drawSonnetClimbingVineMg,
    drawSonnetGreenhouseMg, drawSonnetPagodaMg, drawSonnetCityFacadeMg,
    drawSonnetTerracesMg, drawSonnetMountainLakeMg, drawSonnetCoastalCliffMg
  ]

  function drawThemedSonnetShotMg(options) {
    var index = options.variant - SONNET_THEMED_GEO_VARIANT_START
    var drawer = THEMED_DRAWERS[index]
    if (!drawer) return false
    drawer(options)
    return true
  }

  window.FoliaSonnetMgThemed = {
    SONNET_THEMED_GEO_VARIANT_START: SONNET_THEMED_GEO_VARIANT_START,
    SONNET_THEMED_GEO_VARIANT_COUNT: SONNET_THEMED_GEO_VARIANT_COUNT,
    SONNET_THEMED_GEO_VARIANTS: SONNET_THEMED_GEO_VARIANTS,
    drawThemedSonnetShotMg: drawThemedSonnetShotMg
  }
})()
