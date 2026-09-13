// 商籁模式·开放框架 MG 变体：移植自 folia-major sonnet/sonnetOpenFrameShotMg.ts
// 十二个轻盈的"开放框架"背景。文字可能位于 MG 区域之外，因此这些构图
// 绝不画出封闭的硬边界——弧、括号、刻度与碎片至少有一侧保持开放。
// 变体区间 36-47。
(function () {
  'use strict'

  var Core = window.FoliaSonnetCore
  var sonnetHash01 = Core.sonnetHash01
  var TAU = Math.PI * 2

  var SONNET_OPEN_GEO_VARIANT_START = 36
  var SONNET_OPEN_GEO_VARIANT_COUNT = 12
  var SONNET_OPEN_GEO_VARIANTS = [
    'open-arc-brackets', 'dashed-orbits', 'open-fragments', 'horizon-bundles',
    'semi-wreath', 'side-rulers', 'diagonal-stream', 'corner-petal-spray',
    'dotted-windows', 'open-radar', 'brush-strokes', 'stitch-corners'
  ]

  function rotatePoint(x, y, angle) {
    return [
      x * Math.cos(angle) - y * Math.sin(angle),
      x * Math.sin(angle) + y * Math.cos(angle)
    ]
  }

  // 拥抱四个想象角落的四分弧；彼此绝不相连
  function drawOpenArcBrackets(options) {
    var target = options.target
    var width = options.width
    var height = options.height
    var radius = options.radius
    var seed = options.seed
    var primary = options.primary
    var secondary = options.secondary
    var bx = width * 0.34
    var by = height * 0.34
    var arcR = radius * 0.17
    // (start, end) 对沿外侧象限逆时针扫过
    var corners = [
      { x: -bx, y: -by, start: Math.PI, end: Math.PI * 1.5 },
      { x: bx, y: -by, start: -Math.PI / 2, end: 0 },
      { x: bx, y: by, start: 0, end: Math.PI / 2 },
      { x: -bx, y: by, start: Math.PI / 2, end: Math.PI }
    ]
    corners.forEach(function (corner, index) {
      target.arc(corner.x, corner.y, arcR, corner.start, corner.end)
        .stroke({ color: index % 2 ? secondary : primary, width: 3, alpha: 0.6 })
      target.arc(corner.x, corner.y, arcR * 0.72, corner.start, corner.end)
        .stroke({ color: primary, width: 1, alpha: 0.3 })
      target.moveTo(corner.x - 5, corner.y).lineTo(corner.x + 5, corner.y)
        .stroke({ color: primary, width: 1, alpha: 0.5 })
      target.moveTo(corner.x, corner.y - 5).lineTo(corner.x, corner.y + 5)
        .stroke({ color: primary, width: 1, alpha: 0.5 })
    })
    var dotAngle = (seed % 8) * TAU / 8
    target.circle(Math.cos(dotAngle) * radius * 0.5, Math.sin(dotAngle) * radius * 0.5, radius * 0.02)
      .fill({ color: secondary, alpha: 0.7 })
  }

  // 同心虚线轨道；每条环都断成带缺口的弧
  function drawDashedOrbits(options) {
    var target = options.target
    var radius = options.radius
    var seed = options.seed
    var primary = options.primary
    var secondary = options.secondary
    for (var ring = 0; ring < 3; ring += 1) {
      var ringRadius = radius * (0.32 + ring * 0.18)
      var dashes = 12 + ring * 4
      var offset = seed * 0.13 + ring * 0.7
      var span = (TAU / dashes) * 0.55
      for (var dash = 0; dash < dashes; dash += 1) {
        var start = offset + (dash / dashes) * TAU
        target.arc(0, 0, ringRadius, start, start + span)
          .stroke({ color: ring === 1 ? secondary : primary, width: ring === 1 ? 1 : 2, alpha: 0.28 + ring * 0.06 })
      }
    }
    var markerAngle = seed * 0.31
    target.circle(Math.cos(markerAngle) * radius * 0.68, Math.sin(markerAngle) * radius * 0.68, radius * 0.022)
      .fill({ color: primary, alpha: 0.75 })
    target.circle(Math.cos(markerAngle + Math.PI) * radius * 0.5, Math.sin(markerAngle + Math.PI) * radius * 0.5, radius * 0.016)
      .fill({ color: secondary, alpha: 0.6 })
    target.circle(0, 0, radius * 0.05).stroke({ color: primary, width: 1.5, alpha: 0.5 })
  }

  // 散落的三边方形碎片；没有一片是封闭的
  function drawOpenFragments(options) {
    var target = options.target
    var radius = options.radius
    var seed = options.seed
    var primary = options.primary
    var secondary = options.secondary
    for (var index = 0; index < 5; index += 1) {
      var angle = (index / 5) * TAU + seed * 0.05
      var distance = radius * (0.42 + ((seed + index * 7) % 30) / 100)
      var cx = Math.cos(angle) * distance
      var cy = Math.sin(angle) * distance * 0.8
      var size = radius * (0.07 + ((seed + index * 13) % 20) / 200)
      var rotation = seed * 0.11 + index * 0.9
      // 方形的三条边，第四条留空
      var points = [
        rotatePoint(-size, -size, rotation),
        rotatePoint(size, -size, rotation),
        rotatePoint(size, size, rotation),
        rotatePoint(-size, size, rotation)
      ]
      target.moveTo(cx + points[0][0], cy + points[0][1])
      for (var point = 1; point < points.length; point += 1) {
        target.lineTo(cx + points[point][0], cy + points[point][1])
      }
      target.stroke({ color: index % 2 ? secondary : primary, width: 2, alpha: 0.5 })
      if (index === (seed % 5)) {
        target.circle(cx, cy, size * 0.28).fill({ color: primary, alpha: 0.35 })
      }
    }
  }

  // 上下的断开水平线束，中段留空
  function drawHorizonBundles(options) {
    var target = options.target
    var width = options.width
    var height = options.height
    var seed = options.seed
    var primary = options.primary
    var secondary = options.secondary
    var bundles = [
      { baseY: -height * 0.28, drift: 1 },
      { baseY: height * 0.3, drift: -1 }
    ]
    bundles.forEach(function (bundle, bundleIndex) {
      for (var line = 0; line < 3; line += 1) {
        var y = bundle.baseY + line * 10 * bundle.drift
        var breakAt = width * ((((seed + line * 17 + bundleIndex * 31) % 40) + 30) / 100 - 0.5)
        var gapHalf = width * 0.045
        target.moveTo(-width * 0.4, y).lineTo(breakAt - gapHalf, y)
          .stroke({ color: line === 1 ? secondary : primary, width: line === 1 ? 2 : 1, alpha: 0.42 - line * 0.08 })
        target.moveTo(breakAt + gapHalf, y).lineTo(width * 0.4, y)
          .stroke({ color: line === 1 ? secondary : primary, width: line === 1 ? 2 : 1, alpha: 0.42 - line * 0.08 })
      }
      target.moveTo(-width * 0.42, bundle.baseY)
        .lineTo(-width * 0.42 + 6, bundle.baseY)
        .stroke({ color: primary, width: 1, alpha: 0.4 })
    })
    target.rect(width * 0.36, -height * 0.28 - 3, width * 0.04, 6).fill({ color: secondary, alpha: 0.5 })
  }

  // 带放射叶刺的 270 度花环，带一个有意的开口
  function drawSemiWreath(options) {
    var target = options.target
    var radius = options.radius
    var seed = options.seed
    var primary = options.primary
    var secondary = options.secondary
    var opening = (seed % 4) * (Math.PI / 2) + Math.PI / 8
    var span = TAU * 0.75
    var outer = radius * 0.58
    var inner = radius * 0.5
    target.arc(0, 0, outer, opening, opening + span)
      .stroke({ color: primary, width: 2.5, alpha: 0.55 })
    target.arc(0, 0, inner, opening, opening + span)
      .stroke({ color: secondary, width: 1, alpha: 0.3 })
    var ticks = 18
    for (var index = 0; index < ticks; index += 1) {
      var angle = opening + (index / ticks) * span
      target.moveTo(Math.cos(angle) * outer, Math.sin(angle) * outer)
        .lineTo(Math.cos(angle) * (outer + radius * 0.05), Math.sin(angle) * (outer + radius * 0.05))
        .stroke({ color: primary, width: 1, alpha: 0.4 })
      if (index % 6 === 0) {
        target.circle(Math.cos(angle) * inner, Math.sin(angle) * inner, radius * 0.016)
          .fill({ color: secondary, alpha: 0.6 })
      }
    }
  }

  // 两条带刻度的竖直标尺列；构图上下永不闭合
  function drawSideRulers(options) {
    var target = options.target
    var width = options.width
    var height = options.height
    var seed = options.seed
    var primary = options.primary
    var secondary = options.secondary
    ;[-1, 1].forEach(function (side) {
      var x = side * width * 0.36
      target.moveTo(x, -height * 0.3).lineTo(x, height * 0.3)
        .stroke({ color: primary, width: 1, alpha: 0.35 })
      for (var tick = 0; tick < 12; tick += 1) {
        var y = -height * 0.3 + (tick / 11) * height * 0.6
        var length = tick % 4 === 0 ? 18 : 9
        target.moveTo(x, y).lineTo(x - side * length, y)
          .stroke({ color: tick % 4 === 0 ? secondary : primary, width: 1, alpha: 0.45 })
      }
      var accentY = -height * 0.3 + (((seed + (side > 0 ? 5 : 0)) % 11) / 11) * height * 0.6
      target.rect(side > 0 ? x : x - 4, accentY - 4, 4, 8).fill({ color: secondary, alpha: 0.6 })
    })
  }

  // 一束带两个开口菱形的平行斜线
  function drawDiagonalStream(options) {
    var target = options.target
    var radius = options.radius
    var seed = options.seed
    var primary = options.primary
    var secondary = options.secondary
    var angle = Math.PI / 4 + (seed % 3) * (Math.PI / 12)
    var dirX = Math.cos(angle)
    var dirY = Math.sin(angle)
    var normalX = -dirY
    var normalY = dirX
    for (var line = 0; line < 7; line += 1) {
      var offset = (line - 3) * radius * 0.16
      var length = radius * (0.55 + ((seed + line * 29) % 40) / 100)
      var cx = normalX * offset
      var cy = normalY * offset
      target.moveTo(cx - dirX * length, cy - dirY * length)
        .lineTo(cx + dirX * length * 0.6, cy + dirY * length * 0.6)
        .stroke({ color: line === 3 ? secondary : primary, width: line === 3 ? 2 : 1, alpha: 0.22 + line * 0.03 })
    }
    // 缺一边绘制的菱形
    var offsets = [-radius * 0.16, radius * 0.16]
    offsets.forEach(function (offset, index) {
      var cx2 = normalX * offset + dirX * radius * 0.1
      var cy2 = normalY * offset + dirY * radius * 0.1
      var size = radius * 0.07
      var points = [
        rotatePoint(0, -size, angle), rotatePoint(size, 0, angle),
        rotatePoint(0, size, angle), rotatePoint(-size, 0, angle)
      ]
      target.moveTo(cx2 + points[0][0], cy2 + points[0][1])
      for (var point = 1; point < points.length; point += 1) {
        target.lineTo(cx2 + points[point][0], cy2 + points[point][1])
      }
      target.stroke({ color: primary, width: 1.5, alpha: 0.55 })
      if (index === 0) target.circle(cx2, cy2, size * 0.22).fill({ color: secondary, alpha: 0.55 })
    })
  }

  // 只从两个对角喷出的弯曲花瓣线
  function drawCornerPetalSpray(options) {
    var target = options.target
    var width = options.width
    var height = options.height
    var radius = options.radius
    var seed = options.seed
    var primary = options.primary
    var secondary = options.secondary
    var sign = seed % 2 === 0 ? 1 : -1
    // 花瓣从两个对角向内喷散
    var corners = [
      { x: -sign * width * 0.28, y: -height * 0.26, base: Math.atan2(1, sign) },
      { x: sign * width * 0.28, y: height * 0.26, base: Math.atan2(-1, -sign) }
    ]
    corners.forEach(function (corner, cornerIndex) {
      for (var petal = 0; petal < 5; petal += 1) {
        var spread = (petal - 2) * 0.3
        var angle = corner.base + spread
        var length = radius * (0.3 - Math.abs(petal - 2) * 0.045)
        var endX = corner.x + Math.cos(angle) * length
        var endY = corner.y + Math.sin(angle) * length
        var ctrlX = corner.x + Math.cos(angle + 0.35) * length * 0.55
        var ctrlY = corner.y + Math.sin(angle + 0.35) * length * 0.55
        target.moveTo(corner.x, corner.y)
          .quadraticCurveTo(ctrlX, ctrlY, endX, endY)
          .stroke({ color: petal === 2 ? secondary : primary, width: petal === 2 ? 2 : 1, alpha: 0.4 })
      }
      if (cornerIndex === 0) {
        target.circle(corner.x, corner.y, radius * 0.02).fill({ color: primary, alpha: 0.6 })
      }
    })
  }

  // 稀疏点场 + 三个开放的角落窗口括号
  function drawDottedWindows(options) {
    var target = options.target
    var width = options.width
    var height = options.height
    var radius = options.radius
    var seed = options.seed
    var primary = options.primary
    var secondary = options.secondary
    var columns = 7
    var rows = 5
    for (var row = 0; row < rows; row += 1) {
      for (var column = 0; column < columns; column += 1) {
        if ((row * columns + column + seed) % 5 === 0) continue
        var x = (column - (columns - 1) / 2) * width * 0.11
        var y = (row - (rows - 1) / 2) * height * 0.14
        target.circle(x, y, 1.5).fill({ color: primary, alpha: 0.35 })
      }
    }
    var arm = radius * 0.1
    for (var win = 0; win < 3; win += 1) {
      var cellX = (((seed + win * 2) % columns) - (columns - 1) / 2) * width * 0.11
      var cellY = (((seed + win * 3 + 1) % rows) - (rows - 1) / 2) * height * 0.14
      var flipX = (seed + win) % 2 === 0 ? 1 : -1
      var flipY = (seed + win * 2) % 2 === 0 ? 1 : -1
      // 标记想象中窗格角落的单个直角括号
      target.moveTo(cellX + flipX * arm, cellY)
        .lineTo(cellX, cellY)
        .lineTo(cellX, cellY + flipY * arm)
        .stroke({ color: secondary, width: 2, alpha: 0.6 })
    }
  }

  // 开放的 200 度雷达弧 + 扫描线 + 未闭合的目标标记
  function drawOpenRadar(options) {
    var target = options.target
    var radius = options.radius
    var seed = options.seed
    var primary = options.primary
    var secondary = options.secondary
    var span = TAU * 0.56
    for (var ring = 0; ring < 3; ring += 1) {
      var ringRadius = radius * (0.3 + ring * 0.18)
      var start = seed * 0.1 + ring * 0.9
      target.arc(0, 0, ringRadius, start, start + span)
        .stroke({ color: ring === 1 ? secondary : primary, width: ring === 1 ? 2 : 1, alpha: 0.35 + ring * 0.06 })
    }
    var sweep = seed * 0.07
    target.moveTo(0, 0)
      .lineTo(Math.cos(sweep) * radius * 0.66, Math.sin(sweep) * radius * 0.66)
      .stroke({ color: primary, width: 1.5, alpha: 0.5 })
    var lockAngle = sweep + 0.8
    var lockX = Math.cos(lockAngle) * radius * 0.48
    var lockY = Math.sin(lockAngle) * radius * 0.48
    var tick = radius * 0.04
    // 想象中方形四周的四段刻度，互不接触
    target.moveTo(lockX - tick * 2, lockY - tick).lineTo(lockX - tick * 2, lockY - tick * 2).lineTo(lockX - tick, lockY - tick * 2)
      .stroke({ color: secondary, width: 1.5, alpha: 0.7 })
    target.moveTo(lockX + tick * 2, lockY + tick).lineTo(lockX + tick * 2, lockY + tick * 2).lineTo(lockX + tick, lockY + tick * 2)
      .stroke({ color: secondary, width: 1.5, alpha: 0.7 })
    target.circle(0, 0, radius * 0.018).fill({ color: primary, alpha: 0.8 })
    target.circle(lockX, lockY, radius * 0.014).fill({ color: secondary, alpha: 0.7 })
  }

  // 松散散布的超大锥形笔杆条 + 开放方块
  function drawBrushStrokes(options) {
    var target = options.target
    var width = options.width
    var height = options.height
    var radius = options.radius
    var seed = options.seed
    var primary = options.primary
    var secondary = options.secondary
    for (var stroke = 0; stroke < 4; stroke += 1) {
      var horizontal = stroke % 2 === 0
      var along = (((seed + stroke * 23) % 50) / 100 - 0.25) * (horizontal ? width : height)
      var across = (((seed + stroke * 41) % 60) / 100 - 0.3) * (horizontal ? height : width)
      var length = radius * (0.3 + ((seed + stroke * 7) % 25) / 100)
      var x1 = horizontal ? along - length : across
      var y1 = horizontal ? across : along - length
      var x2 = horizontal ? along + length : across
      var y2 = horizontal ? across : along + length
      target.moveTo(x1, y1).lineTo(x2, y2)
        .stroke({ color: stroke === 1 ? secondary : primary, width: radius * 0.04, alpha: 0.22 })
      target.moveTo(x1, y1 + (horizontal ? radius * 0.035 : 0))
        .lineTo(horizontal ? x2 * 0.6 : x2, horizontal ? y2 + radius * 0.035 : y2 * 0.6)
        .stroke({ color: primary, width: radius * 0.012, alpha: 0.45 })
    }
    // 两端笔画处的三边开放方块强调
    var size = radius * 0.05
    var anchorX = width * 0.3
    var anchorY = -height * 0.3
    target.moveTo(anchorX - size, anchorY - size).lineTo(anchorX + size, anchorY - size).lineTo(anchorX + size, anchorY + size)
      .stroke({ color: secondary, width: 1.5, alpha: 0.6 })
    target.rect(-anchorX - size / 2, -anchorY - size / 2, size, size).fill({ color: primary, alpha: 0.4 })
  }

  // 远离的缝线虚线 L 角 + 点状中央十字线
  function drawStitchCorners(options) {
    var target = options.target
    var width = options.width
    var height = options.height
    var radius = options.radius
    var seed = options.seed
    var primary = options.primary
    var secondary = options.secondary
    var arm = radius * 0.18
    var dash = radius * 0.03
    var corners = [
      { x: -width * 0.39, y: -height * 0.36, sx: 1, sy: 1 },
      { x: width * 0.39, y: -height * 0.36, sx: -1, sy: 1 },
      { x: width * 0.39, y: height * 0.36, sx: -1, sy: -1 },
      { x: -width * 0.39, y: height * 0.36, sx: 1, sy: -1 }
    ]
    corners.forEach(function (corner, index) {
      for (var offset = 0; offset + dash <= arm; offset += dash * 2) {
        target.moveTo(corner.x + corner.sx * offset, corner.y)
          .lineTo(corner.x + corner.sx * (offset + dash), corner.y)
          .stroke({ color: index % 2 ? secondary : primary, width: 2, alpha: 0.5 })
        target.moveTo(corner.x, corner.y + corner.sy * offset)
          .lineTo(corner.x, corner.y + corner.sy * (offset + dash))
          .stroke({ color: index % 2 ? secondary : primary, width: 2, alpha: 0.5 })
      }
    })
    var crossArm = radius * 0.09
    for (var offset2 = -crossArm; offset2 + dash * 0.6 <= crossArm; offset2 += dash * 1.2) {
      target.moveTo(offset2, 0).lineTo(offset2 + dash * 0.6, 0)
        .stroke({ color: primary, width: 1, alpha: 0.4 })
      target.moveTo(0, offset2).lineTo(0, offset2 + dash * 0.6)
        .stroke({ color: primary, width: 1, alpha: 0.4 })
    }
    target.circle(0, 0, radius * 0.012).fill({ color: secondary, alpha: 0.7 })
    // 一个按种子挑选的角落强调缝线，让种子间彼此区分
    var accentCorner = corners[seed % corners.length]
    target.circle(accentCorner.x + accentCorner.sx * arm, accentCorner.y, radius * 0.014)
      .fill({ color: primary, alpha: 0.6 })
  }

  var OPEN_DRAWERS = [
    drawOpenArcBrackets, drawDashedOrbits, drawOpenFragments, drawHorizonBundles,
    drawSemiWreath, drawSideRulers, drawDiagonalStream, drawCornerPetalSpray,
    drawDottedWindows, drawOpenRadar, drawBrushStrokes, drawStitchCorners
  ]

  // 分发开放框架区间；区间外的变体返回 false
  function drawOpenSonnetShotMg(options) {
    var index = options.variant - SONNET_OPEN_GEO_VARIANT_START
    var drawer = OPEN_DRAWERS[index]
    if (!drawer) return false
    drawer(options)
    return true
  }

  window.FoliaSonnetMgOpen = {
    SONNET_OPEN_GEO_VARIANT_START: SONNET_OPEN_GEO_VARIANT_START,
    SONNET_OPEN_GEO_VARIANT_COUNT: SONNET_OPEN_GEO_VARIANT_COUNT,
    SONNET_OPEN_GEO_VARIANTS: SONNET_OPEN_GEO_VARIANTS,
    drawOpenSonnetShotMg: drawOpenSonnetShotMg
  }
})()
