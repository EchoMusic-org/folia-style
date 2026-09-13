// 商籁模式·扩展 MG 变体（上）：移植自 folia-major
//   sonnet/sonnetShotMgCelestial.ts（天体，变体 48-57）
//   sonnet/sonnetShotMgMarine.ts（海洋，变体 58-67）
// 上半部分导出天体/海洋两个子区间的母题清单，由 sonnet-mg-extended-b.js 汇总分发。
// 全部构图开放（无封闭视口边框、无裁剪遮罩），每条母题拆成多条短命令，
// 让共享错峰日程以分层的错位波次生长。
(function () {
  'use strict'

  var Core = window.FoliaSonnetCore
  var sonnetHash01 = Core.sonnetHash01
  var Decor = window.FoliaSonnetDecor
  var resolveSonnetShotMgBleed = Decor.resolveSonnetShotMgBleed
  var TAU = Math.PI * 2

  // ---------- 天体（原版 sonnetShotMgCelestial.ts） ----------
  // 48：双对数螺线臂 + 明亮核心 + 自由漂浮星尘
  function drawSpiralGalaxy(options) {
    var target = options.target
    var radius = options.radius
    var seed = options.seed
    var primary = options.primary
    var secondary = options.secondary
    for (var arm = 0; arm < 2; arm += 1) {
      var offset = arm * Math.PI + sonnetHash01(seed, arm, 101) * 0.5
      target.moveTo(Math.cos(offset) * radius * 0.06, Math.sin(offset) * radius * 0.05)
      var steps = 56
      for (var i = 1; i <= steps; i += 1) {
        var t = i / steps
        var angle = offset + t * Math.PI * 3.1
        var r = radius * (0.06 + t * 0.62)
        target.lineTo(Math.cos(angle) * r, Math.sin(angle) * r * 0.72)
      }
      target.stroke({ color: arm === 0 ? primary : secondary, width: 2, alpha: 0.5 - arm * 0.12 })
    }
    target.circle(0, 0, radius * 0.07).fill({ color: primary, alpha: 0.7 })
    target.circle(0, 0, radius * 0.12).stroke({ color: primary, width: 1, alpha: 0.3 })
    for (var s = 0; s < 14; s += 1) {
      var angle2 = sonnetHash01(seed, s, 103) * TAU
      var r2 = radius * (0.2 + sonnetHash01(seed, s, 107) * 0.55)
      target.circle(Math.cos(angle2) * r2, Math.sin(angle2) * r2 * 0.72, 1.4 + sonnetHash01(seed, s, 109) * 2.2)
        .fill({ color: s % 3 === 0 ? secondary : primary, alpha: 0.3 + sonnetHash01(seed, s, 113) * 0.35 })
    }
  }

  // 49：彗头 + 三条弯曲尾迹 + 十字星光
  function drawCometTrail(options) {
    var target = options.target
    var radius = options.radius
    var seed = options.seed
    var primary = options.primary
    var secondary = options.secondary
    var direction = seed % 2 === 0 ? 1 : -1
    var hx = radius * 0.34 * direction
    var hy = -radius * 0.18
    for (var tail = 0; tail < 3; tail += 1) {
      var spread = (tail - 1) * radius * 0.12
      target.moveTo(hx - direction * radius * 0.04, hy + spread * 0.3)
        .bezierCurveTo(
          hx - direction * radius * 0.35, hy + spread,
          hx - direction * radius * 0.6, hy + radius * 0.16 + spread,
          hx - direction * radius * (0.85 + tail * 0.06), hy + radius * 0.3 + spread * 1.2
        )
        .stroke({ color: tail === 1 ? secondary : primary, width: 3 - tail, alpha: 0.55 - tail * 0.12 })
    }
    target.circle(hx, hy, radius * 0.09).fill({ color: primary, alpha: 0.75 })
    target.circle(hx, hy, radius * 0.14).stroke({ color: primary, width: 1, alpha: 0.35 })
    for (var i = 0; i < 5; i += 1) {
      var x = (sonnetHash01(seed, i, 127) - 0.5) * radius * 1.4
      var y = radius * (0.1 + sonnetHash01(seed, i, 131) * 0.5)
      var s = 2.5 + sonnetHash01(seed, i, 137) * 2.5
      target.moveTo(x - s, y).lineTo(x + s, y).stroke({ color: secondary, width: 1, alpha: 0.45 })
      target.moveTo(x, y - s).lineTo(x, y + s).stroke({ color: secondary, width: 1, alpha: 0.45 })
    }
  }

  // 50：被食圆盘 + 交替光芒的不均匀日冕
  function drawEclipseCorona(options) {
    var target = options.target
    var radius = options.radius
    var seed = options.seed
    var primary = options.primary
    var secondary = options.secondary
    var discR = radius * 0.24
    target.circle(0, 0, discR).fill({ color: primary, alpha: 0.16 })
    target.circle(0, 0, discR).stroke({ color: secondary, width: 2, alpha: 0.65 })
    target.circle(0, 0, discR * 1.14).stroke({ color: primary, width: 1, alpha: 0.25 })
    var rays = 28
    for (var i = 0; i < rays; i += 1) {
      var angle = (i / rays) * TAU + sonnetHash01(seed, i, 139) * 0.08
      var inner = discR * 1.2
      var outer = radius * (i % 2 === 0 ? 0.6 : 0.42) * (0.85 + sonnetHash01(seed, i, 149) * 0.3)
      target.moveTo(Math.cos(angle) * inner, Math.sin(angle) * inner)
        .lineTo(Math.cos(angle) * outer, Math.sin(angle) * outer)
        .stroke({ color: i % 4 === 0 ? secondary : primary, width: i % 2 === 0 ? 2 : 1, alpha: 0.3 + (i % 3) * 0.1 })
    }
  }

  // 51：对角流星痕 + 发光头部，全部开放端点
  function drawMeteorShower(options) {
    var target = options.target
    var radius = options.radius
    var seed = options.seed
    var primary = options.primary
    var secondary = options.secondary
    var direction = seed % 2 === 0 ? 1 : -1
    for (var i = 0; i < 8; i += 1) {
      var x = (sonnetHash01(seed, i, 151) - 0.5) * radius * 1.5
      var y = -radius * 0.55 + sonnetHash01(seed, i, 157) * radius * 0.9
      var len = radius * (0.2 + sonnetHash01(seed, i, 163) * 0.3)
      var dx = direction * len
      var dy = len * 0.55
      target.moveTo(x, y).lineTo(x - dx, y - dy)
        .stroke({ color: primary, width: 2, alpha: 0.55 })
      target.moveTo(x - dx * 0.15, y - dy * 0.15 + 3).lineTo(x - dx * 0.85, y - dy * 0.85 + 3)
        .stroke({ color: secondary, width: 1, alpha: 0.3 })
      target.circle(x, y, 2 + sonnetHash01(seed, i, 167) * 2)
        .fill({ color: i % 2 === 0 ? secondary : primary, alpha: 0.7 })
    }
  }

  // 52：断裂的轨道环与卫星菱形
  function drawOrbitSatellites(options) {
    var target = options.target
    var radius = options.radius
    var seed = options.seed
    var primary = options.primary
    var secondary = options.secondary
    for (var ring = 0; ring < 3; ring += 1) {
      var r = radius * (0.28 + ring * 0.18)
      var gapStart = sonnetHash01(seed, ring, 173) * TAU
      var segs = 3 + ring
      for (var s = 0; s < segs; s += 1) {
        var start = gapStart + (s / segs) * TAU
        target.arc(0, 0, r, start, start + (TAU / segs) * 0.68)
          .stroke({ color: ring === 1 ? secondary : primary, width: ring === 0 ? 2 : 1, alpha: 0.35 + ring * 0.08 })
      }
      var satAngle = sonnetHash01(seed, ring, 179) * TAU
      var sx = Math.cos(satAngle) * r
      var sy = Math.sin(satAngle) * r
      var d = 5 + ring * 2
      target.moveTo(sx, sy - d).lineTo(sx + d, sy).lineTo(sx, sy + d).lineTo(sx - d, sy).lineTo(sx, sy - d)
        .fill({ color: secondary, alpha: 0.75 })
    }
    target.circle(0, 0, radius * 0.06).fill({ color: primary, alpha: 0.8 })
  }

  // 53：自顶部垂下的垂直极光带，无边缘
  function drawAuroraRibbons(options) {
    var target = options.target
    var radius = options.radius
    var seed = options.seed
    var primary = options.primary
    var secondary = options.secondary
    for (var band = 0; band < 4; band += 1) {
      var x0 = -radius * 0.6 + band * radius * 0.38 + (sonnetHash01(seed, band, 181) - 0.5) * radius * 0.1
      var sway = (band % 2 === 0 ? 1 : -1) * radius * 0.2
      target.moveTo(x0, -radius * 0.75)
        .bezierCurveTo(
          x0 + sway, -radius * 0.35,
          x0 - sway, radius * 0.1,
          x0 + sway * 0.6, radius * 0.55
        )
        .stroke({ color: band % 2 === 0 ? primary : secondary, width: 7 - band, alpha: 0.16 + band * 0.05 })
      target.moveTo(x0 + radius * 0.06, -radius * 0.7)
        .bezierCurveTo(
          x0 + sway + radius * 0.06, -radius * 0.3,
          x0 - sway + radius * 0.06, radius * 0.12,
          x0 + sway * 0.6 + radius * 0.06, radius * 0.5
        )
        .stroke({ color: primary, width: 1, alpha: 0.3 })
    }
    for (var i = 0; i < 8; i += 1) {
      target.circle(
        (sonnetHash01(seed, i, 191) - 0.5) * radius * 1.5,
        -radius * 0.6 + sonnetHash01(seed, i, 193) * radius * 0.5,
        1.4
      ).fill({ color: secondary, alpha: 0.5 })
    }
  }

  // 54：新月 + 光环 + 悬挂星坠
  function drawCrescentHalo(options) {
    var target = options.target
    var radius = options.radius
    var seed = options.seed
    var primary = options.primary
    var secondary = options.secondary
    var moonR = radius * 0.3
    var cx = -radius * 0.12
    var cy = -radius * 0.1
    target.moveTo(cx, cy - moonR)
    target.arc(cx, cy, moonR, -Math.PI / 2, Math.PI / 2, false)
    target.quadraticCurveTo(cx - moonR * 0.45, cy, cx, cy - moonR)
    target.fill({ color: primary, alpha: 0.55 })
    target.circle(cx, cy, moonR * 1.35).stroke({ color: secondary, width: 1, alpha: 0.3 })
    target.circle(cx, cy, moonR * 1.5).stroke({ color: primary, width: 1, alpha: 0.16 })
    for (var i = 0; i < 3; i += 1) {
      var px = radius * (0.18 + i * 0.16)
      var topY = -radius * 0.5 + sonnetHash01(seed, i, 197) * radius * 0.1
      var len = radius * (0.14 + sonnetHash01(seed, i, 199) * 0.12)
      target.moveTo(px, topY).lineTo(px, topY + len).stroke({ color: primary, width: 1, alpha: 0.4 })
      var sr = 4 + i
      var sy = topY + len + sr
      target.moveTo(px, sy - sr).lineTo(px + sr * 0.25, sy - sr * 0.25)
        .lineTo(px + sr, sy).lineTo(px + sr * 0.25, sy + sr * 0.25)
        .lineTo(px, sy + sr).lineTo(px - sr * 0.25, sy + sr * 0.25)
        .lineTo(px - sr, sy).lineTo(px - sr * 0.25, sy - sr * 0.25)
        .lineTo(px, sy - sr)
        .stroke({ color: secondary, width: 1, alpha: 0.6 })
    }
  }

  // 55：嵌套的有机星云薄纱——闭合贝塞尔团块，无直线边缘
  function drawNebulaVeil(options) {
    var target = options.target
    var radius = options.radius
    var seed = options.seed
    var primary = options.primary
    var secondary = options.secondary
    for (var blob = 0; blob < 4; blob += 1) {
      var bx = (sonnetHash01(seed, blob, 211) - 0.5) * radius * 0.5
      var by = (sonnetHash01(seed, blob, 223) - 0.5) * radius * 0.4
      var br = radius * (0.2 + blob * 0.1)
      var wobble = sonnetHash01(seed, blob, 227) * 0.6
      target.moveTo(bx + br, by)
      target.bezierCurveTo(bx + br, by - br * (0.6 + wobble * 0.3), bx + br * 0.5, by - br, bx, by - br * (0.9 - wobble * 0.2))
      target.bezierCurveTo(bx - br * 0.6, by - br * 0.8, bx - br, by - br * 0.3, bx - br * (0.85 + wobble * 0.2), by + br * 0.2)
      target.bezierCurveTo(bx - br * 0.7, by + br * 0.7, bx - br * 0.2, by + br, bx + br * 0.3, by + br * (0.8 + wobble * 0.2))
      target.bezierCurveTo(bx + br * 0.8, by + br * 0.6, bx + br, by + br * 0.4, bx + br, by)
      target.stroke({ color: blob % 2 === 0 ? primary : secondary, width: 1.5, alpha: 0.35 - blob * 0.04 })
      if (blob < 2) target.fill({ color: primary, alpha: 0.05 })
    }
    for (var i = 0; i < 10; i += 1) {
      target.circle(
        (sonnetHash01(seed, i, 229) - 0.5) * radius * 1.2,
        (sonnetHash01(seed, i, 233) - 0.5) * radius * 1.0,
        1.2 + sonnetHash01(seed, i, 239) * 1.8
      ).fill({ color: primary, alpha: 0.25 + sonnetHash01(seed, i, 241) * 0.3 })
    }
  }

  // 56：测绘风格星图——浅十字网格 + 一条明亮星座
  function drawStarMap(options) {
    var target = options.target
    var radius = options.radius
    var seed = options.seed
    var primary = options.primary
    var secondary = options.secondary
    for (var gx = 0; gx < 5; gx += 1) {
      for (var gy = 0; gy < 4; gy += 1) {
        var x = -radius * 0.6 + gx * radius * 0.3
        var y = -radius * 0.45 + gy * radius * 0.3
        target.moveTo(x - 3, y).lineTo(x + 3, y).stroke({ color: primary, width: 1, alpha: 0.18 })
        target.moveTo(x, y - 3).lineTo(x, y + 3).stroke({ color: primary, width: 1, alpha: 0.18 })
      }
    }
    var nodes = 6
    var px = 0
    var py = 0
    for (var i = 0; i < nodes; i += 1) {
      var nx = -radius * 0.5 + sonnetHash01(seed, i, 251) * radius
      var ny = -radius * 0.4 + sonnetHash01(seed, i, 257) * radius * 0.8
      if (i > 0) {
        target.moveTo(px, py).lineTo(nx, ny).stroke({ color: secondary, width: 1.5, alpha: 0.55 })
      }
      target.circle(nx, ny, 3).fill({ color: primary, alpha: 0.8 })
      target.circle(nx, ny, 6.5).stroke({ color: primary, width: 1, alpha: 0.3 })
      px = nx
      py = ny
    }
  }

  // 57：上方月亮、下方开放潮弧——天空与海之间的桥
  function drawLunarTide(options) {
    var target = options.target
    var radius = options.radius
    var seed = options.seed
    var primary = options.primary
    var secondary = options.secondary
    var mx = radius * 0.28 * (seed % 2 === 0 ? 1 : -1)
    var my = -radius * 0.34
    target.circle(mx, my, radius * 0.16).fill({ color: primary, alpha: 0.2 })
    target.circle(mx, my, radius * 0.16).stroke({ color: primary, width: 2, alpha: 0.6 })
    target.arc(mx, my, radius * 0.24, Math.PI * 0.2, Math.PI * 0.8).stroke({ color: secondary, width: 1, alpha: 0.35 })
    for (var row = 0; row < 4; row += 1) {
      var y = radius * (0.05 + row * 0.14)
      var arcs = 6 - row
      for (var i = 0; i < arcs; i += 1) {
        var x = -radius * 0.62 + i * radius * 0.24 + (row % 2) * radius * 0.12
        target.arc(x, y, radius * 0.09, Math.PI, TAU)
          .stroke({ color: row % 2 === 0 ? primary : secondary, width: row === 0 ? 2 : 1, alpha: 0.45 - row * 0.07 })
      }
    }
  }

  var SONNET_CELESTIAL_GEO_VARIANTS = [
    'spiral-galaxy', 'comet-trail', 'eclipse-corona', 'meteor-shower', 'orbit-satellites',
    'aurora-ribbons', 'crescent-halo', 'nebula-veil', 'star-map', 'lunar-tide'
  ]
  var SONNET_CELESTIAL_DRAWERS = [
    drawSpiralGalaxy, drawCometTrail, drawEclipseCorona, drawMeteorShower, drawOrbitSatellites,
    drawAuroraRibbons, drawCrescentHalo, drawNebulaVeil, drawStarMap, drawLunarTide
  ]

  // ---------- 海洋（原版 sonnetShotMgMarine.ts） ----------
  // 58：横贯全出血宽度的重复浪峰弧排
  function drawWaveScrolls(options) {
    var target = options.target
    var radius = options.radius
    var width = options.width
    var height = options.height
    var seed = options.seed
    var primary = options.primary
    var secondary = options.secondary
    var bleed = resolveSonnetShotMgBleed(width, height, radius)
    for (var row = 0; row < 4; row += 1) {
      var y = -radius * 0.3 + row * radius * 0.22
      var crestR = radius * 0.1
      var step = crestR * 2.1
      var count = Math.ceil((bleed.x * 2) / step)
      for (var i = 0; i < count; i += 1) {
        var x = -bleed.x + i * step + (row % 2) * crestR
        target.arc(x, y, crestR, Math.PI, TAU)
          .stroke({ color: (i + row) % 3 === 0 ? secondary : primary, width: row === 1 ? 2 : 1, alpha: 0.42 - row * 0.06 })
      }
    }
    for (var d = 0; d < 6; d += 1) {
      target.circle(
        (sonnetHash01(seed, d, 263) - 0.5) * bleed.x * 1.4,
        -radius * 0.55 + sonnetHash01(seed, d, 269) * radius * 0.25,
        1.6
      ).fill({ color: secondary, alpha: 0.4 })
    }
  }

  // 59：鹦鹉螺壳——采样对数螺线 + 腔室隔板，开放外尖端
  function drawNautilus(options) {
    var target = options.target
    var radius = options.radius
    var seed = options.seed
    var primary = options.primary
    var secondary = options.secondary
    var turns = 2.6
    var steps = 90
    var startAngle = sonnetHash01(seed, 0, 271) * TAU
    target.moveTo(Math.cos(startAngle) * radius * 0.04, Math.sin(startAngle) * radius * 0.04)
    for (var i = 1; i <= steps; i += 1) {
      var t = i / steps
      var angle = startAngle + t * turns * TAU
      var r = radius * (0.04 + t * 0.5)
      target.lineTo(Math.cos(angle) * r, Math.sin(angle) * r * 0.94)
    }
    target.stroke({ color: primary, width: 2.5, alpha: 0.65 })
    // 腔室隔板从螺线核心向外放射
    for (var c = 1; c <= 8; c += 1) {
      var t2 = c / 9
      var angle2 = startAngle + t2 * turns * TAU
      var r2 = radius * (0.04 + t2 * 0.5)
      target.moveTo(Math.cos(angle2) * r2 * 0.55, Math.sin(angle2) * r2 * 0.52)
        .lineTo(Math.cos(angle2) * r2, Math.sin(angle2) * r2 * 0.94)
        .stroke({ color: secondary, width: 1, alpha: 0.35 })
    }
    target.circle(0, 0, radius * 0.05).stroke({ color: primary, width: 1.5, alpha: 0.5 })
  }

  // 60：自底部生长的珊瑚枝，带分叉肢体与枝头芽点
  function drawCoralBranch(options) {
    var target = options.target
    var radius = options.radius
    var seed = options.seed
    var primary = options.primary
    var secondary = options.secondary
    var baseX = (seed % 2 === 0 ? -1 : 1) * radius * 0.12
    var fork = function (x, y, angle, len, width_, depth, limb) {
      var ex = x + Math.cos(angle) * len
      var ey = y + Math.sin(angle) * len
      target.moveTo(x, y)
        .quadraticCurveTo(
          x + Math.cos(angle + 0.3) * len * 0.5,
          y + Math.sin(angle + 0.3) * len * 0.5,
          ex, ey
        )
        .stroke({ color: depth === 0 ? secondary : primary, width: width_, alpha: 0.6 - depth * 0.12 })
      target.circle(ex, ey, width_ * 0.9).fill({ color: secondary, alpha: 0.5 })
      if (depth < 2) {
        var spread = 0.55 + sonnetHash01(seed, limb, 277) * 0.3
        fork(ex, ey, angle - spread, len * 0.62, Math.max(1, width_ - 1), depth + 1, limb * 2 + 1)
        fork(ex, ey, angle + spread * 0.8, len * 0.68, Math.max(1, width_ - 1), depth + 1, limb * 2 + 2)
      }
    }
    fork(baseX, radius * 0.62, -Math.PI / 2, radius * 0.34, 3, 0, 0)
    // 几个漂离的水螅体
    for (var i = 0; i < 5; i += 1) {
      target.circle(
        baseX + (sonnetHash01(seed, i, 281) - 0.5) * radius * 0.9,
        radius * (0.3 + sonnetHash01(seed, i, 283) * 0.3),
        1.8
      ).fill({ color: primary, alpha: 0.35 })
    }
  }

  // 61：低岩上的灯塔，双光束扇出，开放海弧
  function drawLighthouseBeam(options) {
    var target = options.target
    var radius = options.radius
    var seed = options.seed
    var primary = options.primary
    var secondary = options.secondary
    var direction = seed % 2 === 0 ? 1 : -1
    var bx = -radius * 0.3 * direction
    var baseY = radius * 0.42
    // 塔身：锥形梯形轮廓，无底座线
    target.moveTo(bx - radius * 0.09, baseY)
      .lineTo(bx - radius * 0.05, baseY - radius * 0.42)
      .lineTo(bx + radius * 0.05, baseY - radius * 0.42)
      .lineTo(bx + radius * 0.09, baseY)
      .stroke({ color: primary, width: 2, alpha: 0.6 })
    target.rect(bx - radius * 0.07, baseY - radius * 0.52, radius * 0.14, radius * 0.1)
      .stroke({ color: primary, width: 1.5, alpha: 0.55 })
    target.circle(bx, baseY - radius * 0.47, radius * 0.025).fill({ color: secondary, alpha: 0.9 })
    // 双光束向开放的右侧扇出
    for (var beam = 0; beam < 2; beam += 1) {
      var spread = radius * (0.1 + beam * 0.12)
      target.moveTo(bx, baseY - radius * 0.47)
        .lineTo(bx + direction * radius * 0.85, baseY - radius * 0.47 - spread)
        .stroke({ color: secondary, width: 1.5, alpha: 0.4 - beam * 0.1 })
      target.moveTo(bx, baseY - radius * 0.47)
        .lineTo(bx + direction * radius * 0.85, baseY - radius * 0.47 + spread)
        .stroke({ color: secondary, width: 1.5, alpha: 0.4 - beam * 0.1 })
    }
    // 下方互不相连的海弧
    for (var i = 0; i < 5; i += 1) {
      var x = -radius * 0.6 + i * radius * 0.3
      target.arc(x, radius * 0.56, radius * 0.1, Math.PI, TAU)
        .stroke({ color: primary, width: 1, alpha: 0.35 })
    }
  }

  // 62：罗盘玫瑰 + 长方位针 + 局部度数弧
  function drawCompassRose(options) {
    var target = options.target
    var radius = options.radius
    var seed = options.seed
    var primary = options.primary
    var secondary = options.secondary
    var roseR = radius * 0.42
    for (var i = 0; i < 8; i += 1) {
      var angle = (i / 8) * TAU - Math.PI / 2
      var long = i % 2 === 0
      var len = long ? roseR : roseR * 0.55
      var halfWidth = long ? 0.09 : 0.06
      // 针 = 自中心的细三角
      var tx = Math.cos(angle) * len
      var ty = Math.sin(angle) * len
      var lx = Math.cos(angle + halfWidth) * roseR * 0.16
      var ly = Math.sin(angle + halfWidth) * roseR * 0.16
      var rx = Math.cos(angle - halfWidth) * roseR * 0.16
      var ry = Math.sin(angle - halfWidth) * roseR * 0.16
      target.moveTo(lx, ly).lineTo(tx, ty).lineTo(rx, ry)
        .stroke({ color: long ? primary : secondary, width: long ? 2 : 1, alpha: long ? 0.65 : 0.45 })
      if (long && i % 4 === 0) {
        target.moveTo(lx, ly).lineTo(tx, ty).lineTo(rx, ry)
          .fill({ color: primary, alpha: 0.1 })
      }
    }
    target.circle(0, 0, roseR * 0.14).stroke({ color: primary, width: 1.5, alpha: 0.6 })
    target.circle(0, 0, roseR * 0.05).fill({ color: secondary, alpha: 0.8 })
    // 度数刻度只沿一段开放弧——刻意不做闭合表盘
    var arcStart = sonnetHash01(seed, 0, 293) * TAU
    for (var d = 0; d <= 24; d += 1) {
      var angle2 = arcStart + (d / 24) * Math.PI * 1.2
      var inner = roseR * 1.12
      var outer = inner + (d % 6 === 0 ? 10 : 5)
      target.moveTo(Math.cos(angle2) * inner, Math.sin(angle2) * inner)
        .lineTo(Math.cos(angle2) * outer, Math.sin(angle2) * outer)
        .stroke({ color: primary, width: 1, alpha: 0.4 })
    }
  }

  // 63：三艘抽象帆船 + 弯曲帆 + 开放水纹虚线
  function drawSailRegatta(options) {
    var target = options.target
    var radius = options.radius
    var seed = options.seed
    var primary = options.primary
    var secondary = options.secondary
    for (var boat = 0; boat < 3; boat += 1) {
      var scale = 1 - boat * 0.24
      var bx = (boat - 1) * radius * 0.44 + (sonnetHash01(seed, boat, 307) - 0.5) * radius * 0.08
      var by = radius * (0.28 - boat * 0.12)
      var mastH = radius * 0.34 * scale
      target.moveTo(bx, by).lineTo(bx, by - mastH)
        .stroke({ color: primary, width: 2, alpha: 0.6 })
      // 二次曲线帆缘的弯曲帆
      target.moveTo(bx, by - mastH)
        .quadraticCurveTo(bx + radius * 0.2 * scale, by - mastH * 0.55, bx, by - mastH * 0.08)
        .stroke({ color: boat === 1 ? secondary : primary, width: 1.5, alpha: 0.55 })
      target.moveTo(bx, by - mastH * 0.92)
        .lineTo(bx - radius * 0.13 * scale, by - mastH * 0.1)
        .lineTo(bx, by - mastH * 0.1)
        .stroke({ color: primary, width: 1, alpha: 0.4 })
      // 船体：浅弧，两端开放
      target.moveTo(bx - radius * 0.15 * scale, by)
        .quadraticCurveTo(bx, by + radius * 0.07 * scale, bx + radius * 0.15 * scale, by)
        .stroke({ color: primary, width: 2, alpha: 0.55 })
    }
    for (var i = 0; i < 7; i += 1) {
      var x = -radius * 0.66 + i * radius * 0.22
      var y = radius * (0.42 + (i % 2) * 0.05)
      target.moveTo(x, y).lineTo(x + radius * 0.1, y)
        .stroke({ color: secondary, width: 1, alpha: 0.35 })
    }
  }

  // 64：三条上升气泡柱，大气泡带高光弧
  function drawBubbleRise(options) {
    var target = options.target
    var radius = options.radius
    var seed = options.seed
    var primary = options.primary
    var secondary = options.secondary
    for (var column = 0; column < 3; column += 1) {
      var x = (column - 1) * radius * 0.34 + (sonnetHash01(seed, column, 311) - 0.5) * radius * 0.12
      var count = 5 + column
      for (var i = 0; i < count; i += 1) {
        var t = i / count
        var y = radius * 0.55 - t * radius * 1.05
        var wobble = (sonnetHash01(seed, column * 10 + i, 313) - 0.5) * radius * 0.08
        var r = radius * (0.02 + t * 0.055)
        target.circle(x + wobble, y, r)
          .stroke({ color: i % 3 === 0 ? secondary : primary, width: 1, alpha: 0.35 + t * 0.35 })
        if (r > radius * 0.05) {
          target.arc(x + wobble, y, r * 0.55, Math.PI * 1.1, Math.PI * 1.6)
            .stroke({ color: secondary, width: 1, alpha: 0.5 })
        }
      }
    }
  }

  // 65：重叠的有机潮汐池环 + 池内卵石点
  function drawTidePools(options) {
    var target = options.target
    var radius = options.radius
    var seed = options.seed
    var primary = options.primary
    var secondary = options.secondary
    for (var pool = 0; pool < 4; pool += 1) {
      var px = (sonnetHash01(seed, pool, 317) - 0.5) * radius * 0.7
      var py = (sonnetHash01(seed, pool, 331) - 0.2) * radius * 0.5
      var pr = radius * (0.16 + sonnetHash01(seed, pool, 337) * 0.12)
      target.moveTo(px + pr, py)
      target.bezierCurveTo(px + pr, py - pr * 0.7, px + pr * 0.4, py - pr, px, py - pr * 0.9)
      target.bezierCurveTo(px - pr * 0.7, py - pr * 0.8, px - pr, py - pr * 0.2, px - pr * 0.9, py + pr * 0.3)
      target.bezierCurveTo(px - pr * 0.6, py + pr * 0.8, px + pr * 0.2, py + pr, px + pr * 0.6, py + pr * 0.7)
      target.bezierCurveTo(px + pr * 0.95, py + pr * 0.5, px + pr, py + pr * 0.3, px + pr, py)
      target.stroke({ color: pool % 2 === 0 ? primary : secondary, width: 1.5, alpha: 0.45 })
      for (var pebble = 0; pebble < 3; pebble += 1) {
        target.circle(
          px + (sonnetHash01(seed, pool * 4 + pebble, 347) - 0.5) * pr,
          py + (sonnetHash01(seed, pool * 4 + pebble, 349) - 0.5) * pr * 0.7,
          1.6 + pebble
        ).fill({ color: secondary, alpha: 0.45 })
      }
    }
  }

  // 66：自底部摇曳的高海草叶 + 漂浮气泡
  function drawSeaweedSway(options) {
    var target = options.target
    var radius = options.radius
    var seed = options.seed
    var primary = options.primary
    var secondary = options.secondary
    for (var blade = 0; blade < 6; blade += 1) {
      var x = -radius * 0.55 + blade * radius * 0.22 + (sonnetHash01(seed, blade, 353) - 0.5) * radius * 0.06
      var h = radius * (0.4 + sonnetHash01(seed, blade, 359) * 0.3)
      var sway = (blade % 2 === 0 ? 1 : -1) * radius * 0.12
      target.moveTo(x, radius * 0.62)
        .bezierCurveTo(x + sway, radius * 0.62 - h * 0.4, x - sway, radius * 0.62 - h * 0.7, x + sway * 0.5, radius * 0.62 - h)
        .stroke({ color: blade % 2 === 0 ? primary : secondary, width: 2, alpha: 0.5 - blade * 0.03 })
      target.circle(x + sway * 0.5, radius * 0.62 - h, 2).fill({ color: secondary, alpha: 0.5 })
    }
    for (var i = 0; i < 6; i += 1) {
      target.circle(
        (sonnetHash01(seed, i, 367) - 0.5) * radius * 1.1,
        -radius * 0.5 + sonnetHash01(seed, i, 373) * radius * 0.5,
        1.4 + sonnetHash01(seed, i, 379) * 1.6
      ).stroke({ color: primary, width: 1, alpha: 0.35 })
    }
  }

  // 67：分层水平洋流线 + 散落的鱼形山形纹
  function drawDeepCurrent(options) {
    var target = options.target
    var radius = options.radius
    var width = options.width
    var height = options.height
    var seed = options.seed
    var primary = options.primary
    var secondary = options.secondary
    var bleed = resolveSonnetShotMgBleed(width, height, radius)
    for (var line = 0; line < 5; line += 1) {
      var y = -radius * 0.4 + line * radius * 0.2
      var lift = (line % 2 === 0 ? 1 : -1) * radius * 0.06
      target.moveTo(-bleed.x, y)
        .bezierCurveTo(-radius * 0.3, y + lift, radius * 0.3, y - lift, bleed.x, y)
        .stroke({ color: line === 2 ? secondary : primary, width: line === 2 ? 2 : 1, alpha: 0.32 + (line % 3) * 0.07 })
    }
    // 鱼形山形纹逆流而游，按种子错开
    for (var i = 0; i < 6; i += 1) {
      var x = (sonnetHash01(seed, i, 383) - 0.5) * radius * 1.2
      var y2 = -radius * 0.3 + sonnetHash01(seed, i, 389) * radius * 0.6
      var s = 5 + sonnetHash01(seed, i, 397) * 4
      var flip = i % 2 === 0 ? 1 : -1
      target.moveTo(x - s * flip, y2 - s * 0.5).lineTo(x, y2).lineTo(x - s * flip, y2 + s * 0.5)
        .stroke({ color: secondary, width: 1.5, alpha: 0.55 })
    }
  }

  var SONNET_MARINE_GEO_VARIANTS = [
    'wave-scrolls', 'nautilus', 'coral-branch', 'lighthouse-beam', 'compass-rose',
    'sail-regatta', 'bubble-rise', 'tide-pools', 'seaweed-sway', 'deep-current'
  ]
  var SONNET_MARINE_DRAWERS = [
    drawWaveScrolls, drawNautilus, drawCoralBranch, drawLighthouseBeam, drawCompassRose,
    drawSailRegatta, drawBubbleRise, drawTidePools, drawSeaweedSway, drawDeepCurrent
  ]


  window.FoliaSonnetMgExtended = {
    SONNET_CELESTIAL_GEO_VARIANTS: SONNET_CELESTIAL_GEO_VARIANTS,
    SONNET_CELESTIAL_DRAWERS: SONNET_CELESTIAL_DRAWERS,
    SONNET_MARINE_GEO_VARIANTS: SONNET_MARINE_GEO_VARIANTS,
    SONNET_MARINE_DRAWERS: SONNET_MARINE_DRAWERS
  }
})()
