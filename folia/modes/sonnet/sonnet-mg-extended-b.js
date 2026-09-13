// 商籁模式·扩展 MG 变体（下）：移植自 folia-major
//   sonnet/sonnetShotMgMusic.ts（音乐，变体 68-75）
//   sonnet/sonnetShotMgCraft.ts（手工艺，变体 76-85）
//   sonnet/sonnetShotMgKinetic.ts（动态/技术，变体 86-99）
//   sonnet/sonnetExtendedShotMg.ts（52 个扩展主题背景的确定性区间分发）
// 下半部分汇总上下两个子区间的母题清单并对外分发，需在 sonnet-mg-extended.js 之后加载。
(function () {
  'use strict'

  var Core = window.FoliaSonnetCore
  var sonnetHash01 = Core.sonnetHash01
  var Decor = window.FoliaSonnetDecor
  var resolveSonnetShotMgBleed = Decor.resolveSonnetShotMgBleed
  var TAU = Math.PI * 2

  // ---------- 音乐（原版 sonnetShotMgMusic.ts） ----------
  // 68：绕开放中轴镜像的对称波形
  function drawSoundWave(options) {
    var target = options.target
    var radius = options.radius
    var width = options.width
    var height = options.height
    var seed = options.seed
    var primary = options.primary
    var secondary = options.secondary
    var bleed = resolveSonnetShotMgBleed(width, height, radius)
    var steps = 72
    var envelope = function (t) {
      return Math.sin(t * Math.PI) * (0.4 + 0.6 * sonnetHash01(seed, Math.round(t * 12), 401))
    }
    var mirrors = [-1, 1]
    mirrors.forEach(function (mirror) {
      target.moveTo(-bleed.x, 0)
      for (var i = 1; i <= steps; i += 1) {
        var t = i / steps
        var x = -bleed.x + t * bleed.x * 2
        var y = mirror * Math.sin(t * TAU * 5 + seed * 0.13) * radius * 0.22 * envelope(t)
        target.lineTo(x, y)
      }
      target.stroke({ color: mirror < 0 ? primary : secondary, width: mirror < 0 ? 2 : 1, alpha: 0.55 })
    })
    target.moveTo(-bleed.x, 0).lineTo(bleed.x, 0).stroke({ color: primary, width: 1, alpha: 0.18 })
  }

  // 69：黑胶唱片——带缺口的纹路弧（永不闭合的环）+ 唱臂
  function drawVinylGrooves(options) {
    var target = options.target
    var radius = options.radius
    var seed = options.seed
    var primary = options.primary
    var secondary = options.secondary
    for (var groove = 0; groove < 7; groove += 1) {
      var r = radius * (0.2 + groove * 0.08)
      var gapAt = sonnetHash01(seed, groove, 409) * TAU
      target.arc(0, 0, r, gapAt, gapAt + TAU * 0.86)
        .stroke({ color: groove % 3 === 0 ? secondary : primary, width: groove % 3 === 0 ? 2 : 1, alpha: 0.3 + groove * 0.05 })
    }
    target.circle(0, 0, radius * 0.12).stroke({ color: primary, width: 2, alpha: 0.6 })
    target.circle(0, 0, radius * 0.03).fill({ color: secondary, alpha: 0.8 })
    // 唱臂自角落枢轴扫入
    var pivotX = radius * 0.62
    var pivotY = -radius * 0.52
    target.circle(pivotX, pivotY, radius * 0.035).stroke({ color: primary, width: 2, alpha: 0.6 })
    target.moveTo(pivotX, pivotY)
      .lineTo(radius * 0.18, -radius * 0.1)
      .stroke({ color: primary, width: 3, alpha: 0.5 })
    target.circle(radius * 0.18, -radius * 0.1, 3).fill({ color: secondary, alpha: 0.8 })
  }

  // 70：沿浅底弧绽放的均衡器条，无基线框
  function drawEqualizerBloom(options) {
    var target = options.target
    var radius = options.radius
    var seed = options.seed
    var primary = options.primary
    var secondary = options.secondary
    var bars = 17
    for (var i = 0; i < bars; i += 1) {
      var t = i / (bars - 1)
      var x = -radius * 0.66 + t * radius * 1.32
      var arcY = radius * 0.5 - Math.sin(t * Math.PI) * radius * 0.12
      var h = radius * (0.08 + Math.sin(t * Math.PI) * 0.3 * (0.5 + sonnetHash01(seed, i, 419) * 0.8))
      target.moveTo(x, arcY).lineTo(x, arcY - h)
        .stroke({ color: i % 4 === 0 ? secondary : primary, width: 3, alpha: 0.5 + Math.sin(t * Math.PI) * 0.25 })
      target.circle(x, arcY - h - 4, 1.6).fill({ color: secondary, alpha: 0.55 })
    }
  }

  // 71：沿弧线行进的五个八分音符，由一条开放符杠连接
  function drawNoteArc(options) {
    var target = options.target
    var radius = options.radius
    var seed = options.seed
    var primary = options.primary
    var secondary = options.secondary
    var headR = radius * 0.045
    var points = []
    for (var i = 0; i < 5; i += 1) {
      var t = i / 4
      var x = -radius * 0.55 + t * radius * 1.1
      var y = radius * 0.22 - Math.sin(t * Math.PI * 0.9) * radius * 0.34
      points.push({ x: x, y: y })
      target.circle(x, y, headR).fill({ color: i === 2 ? secondary : primary, alpha: 0.8 })
      target.moveTo(x + headR, y).lineTo(x + headR, y - radius * 0.16)
        .stroke({ color: i === 2 ? secondary : primary, width: 2, alpha: 0.65 })
    }
    // 连接符干顶端的符杠，越过最后一个音符后开放
    target.moveTo(points[0].x + headR, points[0].y - radius * 0.16)
    for (var j = 1; j < points.length; j += 1) {
      target.lineTo(points[j].x + headR, points[j].y - radius * 0.16)
    }
    target.lineTo(points[4].x + radius * 0.12, points[4].y - radius * 0.13)
    target.stroke({ color: primary, width: 3, alpha: 0.5 })
    // 从第一个音符卷出的一段飘带旗
    target.moveTo(points[0].x + headR, points[0].y - radius * 0.16)
      .quadraticCurveTo(points[0].x + radius * 0.1, points[0].y - radius * 0.1, points[0].x + radius * 0.06, points[0].y - radius * 0.02)
      .stroke({ color: secondary, width: 1.5, alpha: 0.5 })
  }

  // 72：音叉 + 两侧扩散的声环
  function drawTuningFork(options) {
    var target = options.target
    var radius = options.radius
    var seed = options.seed
    var primary = options.primary
    var secondary = options.secondary
    var fx = (seed % 2 === 0 ? -1 : 1) * radius * 0.08
    var topY = -radius * 0.4
    var prongW = radius * 0.05
    var prongGap = radius * 0.1
    var uY = radius * 0.02
    // 两叉 + U 弯 + 柄，一条按段断开的开放路径
    target.moveTo(fx - prongGap / 2 - prongW, topY).lineTo(fx - prongGap / 2 - prongW, uY)
      .stroke({ color: primary, width: 2.5, alpha: 0.65 })
    target.moveTo(fx + prongGap / 2 + prongW, topY).lineTo(fx + prongGap / 2 + prongW, uY)
      .stroke({ color: primary, width: 2.5, alpha: 0.65 })
    target.arc(fx, uY, prongGap / 2 + prongW, 0, Math.PI)
      .stroke({ color: primary, width: 2.5, alpha: 0.65 })
    target.moveTo(fx, uY + prongGap / 2 + prongW).lineTo(fx, radius * 0.42)
      .stroke({ color: primary, width: 3, alpha: 0.6 })
    target.circle(fx, radius * 0.46, radius * 0.035).stroke({ color: secondary, width: 2, alpha: 0.6 })
    // 音叉两侧的振动弧
    var sides = [-1, 1]
    sides.forEach(function (side) {
      for (var ring = 0; ring < 3; ring += 1) {
        var r = radius * (0.14 + ring * 0.1)
        var cx = fx + side * radius * 0.06
        var cy = topY + radius * 0.1
        target.arc(cx, cy, r, side < 0 ? Math.PI * 0.6 : -Math.PI * 0.4, side < 0 ? Math.PI * 1.4 : Math.PI * 0.4)
          .stroke({ color: ring === 1 ? secondary : primary, width: 1.5, alpha: 0.42 - ring * 0.1 })
      }
    })
  }

  // 73：骑在浅缎带曲线上的琴键——长短交替的条
  function drawPianoRibbon(options) {
    var target = options.target
    var radius = options.radius
    var width = options.width
    var height = options.height
    var primary = options.primary
    var secondary = options.secondary
    var bleed = resolveSonnetShotMgBleed(width, height, radius)
    // 缎带引导曲线，两端开放
    target.moveTo(-bleed.x, radius * 0.18)
      .bezierCurveTo(-radius * 0.3, -radius * 0.05, radius * 0.3, radius * 0.3, bleed.x, radius * 0.05)
      .stroke({ color: primary, width: 1, alpha: 0.25 })
    var keys = 12
    for (var i = 0; i < keys; i += 1) {
      var t = i / (keys - 1)
      var x = -radius * 0.6 + t * radius * 1.2
      var baseY = radius * 0.18 + Math.sin(t * Math.PI) * -radius * 0.1 + t * -radius * 0.06
      var black = [1, 3, 6, 8, 10].indexOf(i % 12) >= 0
      var len = radius * (black ? 0.14 : 0.24)
      target.moveTo(x, baseY).lineTo(x, baseY - len)
        .stroke({ color: black ? secondary : primary, width: black ? 4 : 3, alpha: black ? 0.7 : 0.45 })
    }
  }

  // 74：节拍器 + 倾斜摆锤 + 运动回声弧
  function drawMetronome(options) {
    var target = options.target
    var radius = options.radius
    var seed = options.seed
    var primary = options.primary
    var secondary = options.secondary
    var cx = 0
    var baseY = radius * 0.4
    var topY = -radius * 0.36
    // 锥形机身轮廓，底部开放
    target.moveTo(cx - radius * 0.2, baseY).lineTo(cx - radius * 0.06, topY)
      .stroke({ color: primary, width: 2, alpha: 0.6 })
    target.moveTo(cx + radius * 0.2, baseY).lineTo(cx + radius * 0.06, topY)
      .stroke({ color: primary, width: 2, alpha: 0.6 })
    target.moveTo(cx - radius * 0.06, topY).lineTo(cx + radius * 0.06, topY)
      .stroke({ color: primary, width: 2, alpha: 0.6 })
    // 摆锤
    var tilt = (sonnetHash01(seed, 0, 431) - 0.5) * 0.9
    var pivotY = radius * 0.16
    var tipX = cx + Math.sin(tilt) * radius * 0.5
    var tipY = pivotY - Math.cos(tilt) * radius * 0.5
    target.circle(cx, pivotY, radius * 0.03).fill({ color: secondary, alpha: 0.85 })
    target.moveTo(cx, pivotY).lineTo(tipX, tipY).stroke({ color: secondary, width: 2, alpha: 0.7 })
    target.rect(tipX - 4, tipY - 4, 8, 8).fill({ color: secondary, alpha: 0.7 })
    // 随摆锤扫动的回声弧
    for (var i = 0; i < 3; i += 1) {
      var r = radius * (0.24 + i * 0.12)
      target.arc(cx, pivotY, r, -Math.PI / 2 - 0.5 - i * 0.1, -Math.PI / 2 + 0.5 + i * 0.1)
        .stroke({ color: primary, width: 1, alpha: 0.3 - i * 0.06 })
    }
  }

  // 75：五条横贯出血的起伏谱线 + 几个自由音符
  function drawStaffWave(options) {
    var target = options.target
    var radius = options.radius
    var width = options.width
    var height = options.height
    var seed = options.seed
    var primary = options.primary
    var secondary = options.secondary
    var bleed = resolveSonnetShotMgBleed(width, height, radius)
    for (var line = 0; line < 5; line += 1) {
      var y0 = -radius * 0.16 + line * radius * 0.08
      var lift = (line % 2 === 0 ? 1 : -1) * radius * 0.05
      target.moveTo(-bleed.x, y0)
        .bezierCurveTo(-radius * 0.3, y0 + lift, radius * 0.3, y0 - lift, bleed.x, y0)
        .stroke({ color: primary, width: 1, alpha: 0.3 + (line === 2 ? 0.15 : 0) })
    }
    for (var i = 0; i < 4; i += 1) {
      var x = -radius * 0.45 + i * radius * 0.3 + (sonnetHash01(seed, i, 439) - 0.5) * radius * 0.08
      var y = -radius * 0.16 + Math.floor(sonnetHash01(seed, i, 443) * 5) * radius * 0.08
      target.circle(x, y, radius * 0.032).fill({ color: i % 2 === 0 ? secondary : primary, alpha: 0.85 })
      target.moveTo(x + radius * 0.032, y).lineTo(x + radius * 0.032, y - radius * 0.14)
        .stroke({ color: i % 2 === 0 ? secondary : primary, width: 1.5, alpha: 0.6 })
    }
  }

  var SONNET_MUSIC_GEO_VARIANTS = [
    'sound-wave', 'vinyl-grooves', 'equalizer-bloom', 'note-arc',
    'tuning-fork', 'piano-ribbon', 'metronome', 'staff-wave'
  ]
  var SONNET_MUSIC_DRAWERS = [
    drawSoundWave, drawVinylGrooves, drawEqualizerBloom, drawNoteArc,
    drawTuningFork, drawPianoRibbon, drawMetronome, drawStaffWave
  ]

  // ---------- 手工艺（原版 sonnetShotMgCraft.ts） ----------
  // 编织与绳结用缺口表达上下穿插——整个区间没有任何裁剪矩形。
  // 76：线稿风格的折纸鹤 + 两片轻填充折面
  function drawOrigamiCrane(options) {
    var target = options.target
    var radius = options.radius
    var seed = options.seed
    var primary = options.primary
    var secondary = options.secondary
    var direction = seed % 2 === 0 ? 1 : -1
    var s = radius * 0.34
    // 身体菱形
    target.moveTo(0, -s * 0.3).lineTo(direction * s * 0.5, 0).lineTo(0, s * 0.35).lineTo(-direction * s * 0.5, 0)
      .lineTo(0, -s * 0.3)
      .stroke({ color: primary, width: 2, alpha: 0.6 })
    // 立起的翅膀
    target.moveTo(0, -s * 0.3).lineTo(-direction * s * 0.15, -s * 0.95).lineTo(direction * s * 0.28, -s * 0.1)
      .stroke({ color: primary, width: 1.5, alpha: 0.5 })
    target.moveTo(0, -s * 0.3).lineTo(-direction * s * 0.15, -s * 0.95).lineTo(-direction * s * 0.42, s * 0.02)
      .fill({ color: primary, alpha: 0.07 })
    // 颈 + 头
    target.moveTo(direction * s * 0.5, 0)
      .lineTo(direction * s * 0.78, -s * 0.62)
      .lineTo(direction * s * 0.98, -s * 0.5)
      .stroke({ color: secondary, width: 1.5, alpha: 0.6 })
    // 尾
    target.moveTo(-direction * s * 0.5, 0).lineTo(-direction * s * 0.85, -s * 0.5)
      .stroke({ color: primary, width: 1.5, alpha: 0.5 })
    // 折痕线
    target.moveTo(0, -s * 0.3).lineTo(0, s * 0.35).stroke({ color: secondary, width: 1, alpha: 0.3 })
    target.moveTo(-direction * s * 0.5, 0).lineTo(direction * s * 0.5, 0)
      .stroke({ color: secondary, width: 1, alpha: 0.3 })
  }

  // 77：纸飞机 + 背后分段的环绕尾迹
  function drawPaperPlaneTrail(options) {
    var target = options.target
    var radius = options.radius
    var seed = options.seed
    var primary = options.primary
    var secondary = options.secondary
    var direction = seed % 2 === 0 ? 1 : -1
    var px = radius * 0.4 * direction
    var py = -radius * 0.28
    var s = radius * 0.16
    // 机身：两个折叠三角
    target.moveTo(px + direction * s, py).lineTo(px - direction * s * 0.8, py - s * 0.55).lineTo(px - direction * s * 0.35, py)
      .lineTo(px + direction * s, py)
      .stroke({ color: primary, width: 2, alpha: 0.65 })
    target.moveTo(px + direction * s, py).lineTo(px - direction * s * 0.35, py).lineTo(px - direction * s * 0.8, py + s * 0.4)
      .stroke({ color: secondary, width: 1.5, alpha: 0.5 })
    // 尾迹：三段带刻意缺口的弧
    for (var seg = 0; seg < 3; seg += 1) {
      var start = Math.PI * (0.1 + seg * 0.55)
      target.arc(px - direction * radius * 0.35, py + radius * 0.3, radius * (0.34 + seg * 0.06), start, start + Math.PI * 0.4)
        .stroke({ color: seg === 1 ? secondary : primary, width: 1.5, alpha: 0.45 - seg * 0.08 })
    }
  }

  // 78：编织带——竖条借助缺口在两条横条上穿下过
  function drawWeaveBand(options) {
    var target = options.target
    var radius = options.radius
    var primary = options.primary
    var secondary = options.secondary
    var bandY = [-radius * 0.12, radius * 0.12]
    var strips = 7
    // 先画横条（底层），在每个隔一个的交叉处断开
    bandY.forEach(function (y, row) {
      for (var i = 0; i < strips; i += 1) {
        var x0 = -radius * 0.63 + i * radius * 0.18
        if ((i + row) % 2 === 0) {
          target.moveTo(x0 + radius * 0.02, y).lineTo(x0 + radius * 0.16, y)
            .stroke({ color: row === 0 ? primary : secondary, width: 5, alpha: 0.4 })
        } else {
          target.moveTo(x0 - radius * 0.05, y).lineTo(x0 + radius * 0.02, y)
            .stroke({ color: row === 0 ? primary : secondary, width: 5, alpha: 0.4 })
          target.moveTo(x0 + radius * 0.16, y).lineTo(x0 + radius * 0.23, y)
            .stroke({ color: row === 0 ? primary : secondary, width: 5, alpha: 0.4 })
        }
      }
    })
    // 在断开的交叉处补上顶层竖条
    for (var v = 0; v < strips; v += 1) {
      var x = -radius * 0.54 + v * radius * 0.18
      var overRow = v % 2
      var y2 = bandY[overRow]
      target.moveTo(x, y2 - radius * 0.05).lineTo(x, y2 + radius * 0.05)
        .stroke({ color: primary, width: 6, alpha: 0.6 })
      target.moveTo(x, bandY[1 - overRow] - radius * 0.03).lineTo(x, bandY[1 - overRow] + radius * 0.03)
        .stroke({ color: secondary, width: 2, alpha: 0.3 })
    }
  }

  // 79：以分段绘制、交叉处留缺口表达上下的八字结
  function drawKnotLoop(options) {
    var target = options.target
    var radius = options.radius
    var primary = options.primary
    var secondary = options.secondary
    var s = radius * 0.34
    // 左环，在右环上穿处断开
    target.moveTo(0, 0)
    target.bezierCurveTo(-s * 0.9, -s * 0.9, -s * 1.5, -s * 0.2, -s * 0.8, s * 0.28)
    target.stroke({ color: primary, width: 3, alpha: 0.6 })
    target.moveTo(-s * 0.62, s * 0.34)
    target.bezierCurveTo(-s * 0.3, s * 0.44, -s * 0.12, s * 0.2, 0, 0)
    target.stroke({ color: primary, width: 3, alpha: 0.6 })
    // 右环，在左环上穿处断开
    target.moveTo(s * 0.12, -s * 0.08)
    target.bezierCurveTo(s * 0.6, -s * 0.6, s * 1.4, -s * 0.3, s * 0.9, s * 0.2)
    target.stroke({ color: secondary, width: 3, alpha: 0.6 })
    target.moveTo(s * 0.72, s * 0.26)
    target.bezierCurveTo(s * 0.4, s * 0.4, s * 0.05, s * 0.14, -s * 0.06, s * 0.04)
    target.stroke({ color: secondary, width: 3, alpha: 0.6 })
    // 飘出的松散尾端
    target.moveTo(0, 0).bezierCurveTo(-s * 0.2, s * 0.5, -s * 0.4, s * 0.8, -s * 0.3, s * 1.1)
      .stroke({ color: primary, width: 2, alpha: 0.4 })
    target.moveTo(s * 0.06, -s * 0.02).bezierCurveTo(s * 0.3, -s * 0.5, s * 0.5, -s * 0.8, s * 0.42, -s * 1.05)
      .stroke({ color: secondary, width: 2, alpha: 0.4 })
  }

  // 80：向边缘渐隐的十字绣样例行
  function drawStitchSampler(options) {
    var target = options.target
    var radius = options.radius
    var primary = options.primary
    var secondary = options.secondary
    var stitch = function (x, y, size, color, alpha) {
      target.moveTo(x - size, y - size).lineTo(x + size, y + size).stroke({ color: color, width: 1.5, alpha: alpha })
      target.moveTo(x + size, y - size).lineTo(x - size, y + size).stroke({ color: color, width: 1.5, alpha: alpha })
    }
    for (var row = 0; row < 4; row += 1) {
      var y = -radius * 0.36 + row * radius * 0.24
      var count = 7 - Math.abs(row - 1.5)
      for (var i = 0; i < count; i += 1) {
        var x = (i - (count - 1) / 2) * radius * 0.16 + (row % 2) * radius * 0.08
        var edgeFade = 1 - Math.abs(i - (count - 1) / 2) / (count / 2 + 0.5)
        stitch(x, y, 4 + (row % 2), (i + row) % 3 === 0 ? secondary : primary, 0.25 + edgeFade * 0.4)
      }
    }
  }

  // 81：折扇——自枢轴放射的扇骨 + 双护弧，顶部开放
  function drawFoldedFan(options) {
    var target = options.target
    var radius = options.radius
    var primary = options.primary
    var secondary = options.secondary
    var pivotY = radius * 0.42
    var ribs = 11
    var spread = Math.PI * 0.9
    for (var i = 0; i < ribs; i += 1) {
      var angle = -Math.PI / 2 - spread / 2 + (i / (ribs - 1)) * spread
      var len = radius * (0.5 + Math.sin((i / (ribs - 1)) * Math.PI) * 0.12)
      target.moveTo(0, pivotY)
        .lineTo(Math.cos(angle) * len, pivotY + Math.sin(angle) * len)
        .stroke({ color: i % 2 === 0 ? primary : secondary, width: i === 5 ? 2.5 : 1.5, alpha: 0.5 })
    }
    target.arc(0, pivotY, radius * 0.5, -Math.PI / 2 - spread / 2, -Math.PI / 2 + spread / 2)
      .stroke({ color: primary, width: 2, alpha: 0.45 })
    target.arc(0, pivotY, radius * 0.58, -Math.PI / 2 - spread / 2 + 0.06, -Math.PI / 2 + spread / 2 - 0.06)
      .stroke({ color: secondary, width: 1, alpha: 0.3 })
    target.circle(0, pivotY, radius * 0.03).fill({ color: secondary, alpha: 0.8 })
  }

  // 82：卷曲的礼花缎带——采样螺线 + 平行回声描边
  function drawRibbonCurl(options) {
    var target = options.target
    var radius = options.radius
    var seed = options.seed
    var primary = options.primary
    var secondary = options.secondary
    var cx = radius * 0.15 * (seed % 2 === 0 ? 1 : -1)
    var start = sonnetHash01(seed, 0, 449) * TAU
    var echoes = [0, 1]
    echoes.forEach(function (echo) {
      var offset = echo * radius * 0.035
      target.moveTo(cx + Math.cos(start) * radius * 0.06, -radius * 0.1 + Math.sin(start) * radius * 0.06 + offset)
      var steps = 64
      for (var i = 1; i <= steps; i += 1) {
        var t = i / steps
        var angle = start + t * TAU * 2.4
        var r = radius * (0.06 + t * 0.42)
        target.lineTo(cx + Math.cos(angle) * r, -radius * 0.1 + Math.sin(angle) * r * 0.8 + offset)
      }
      target.stroke({ color: echo === 0 ? primary : secondary, width: echo === 0 ? 3 : 1, alpha: echo === 0 ? 0.55 : 0.3 })
    })
    // 松散尾端上挑
    var endAngle = start + TAU * 2.4
    var ex = cx + Math.cos(endAngle) * radius * 0.48
    var ey = -radius * 0.1 + Math.sin(endAngle) * radius * 0.38
    target.moveTo(ex, ey).quadraticCurveTo(ex + radius * 0.1, ey - radius * 0.12, ex + radius * 0.16, ey - radius * 0.04)
      .stroke({ color: primary, width: 2, alpha: 0.5 })
  }

  // 83：三个重叠的拼布三角 + 手工内条纹
  function drawPatchworkTrio(options) {
    var target = options.target
    var radius = options.radius
    var primary = options.primary
    var secondary = options.secondary
    var configs = [
      { x: -radius * 0.22, y: -radius * 0.05, s: radius * 0.3, up: true },
      { x: radius * 0.18, y: -radius * 0.12, s: radius * 0.24, up: false },
      { x: radius * 0.05, y: radius * 0.2, s: radius * 0.2, up: true }
    ]
    configs.forEach(function (config, index) {
      var x = config.x
      var y = config.y
      var s = config.s
      var up = config.up
      var topY = up ? y - s * 0.6 : y
      var baseY = up ? y + s * 0.4 : y + s
      target.moveTo(x, topY).lineTo(x + s * 0.55, baseY).lineTo(x - s * 0.55, baseY).lineTo(x, topY)
        .stroke({ color: index === 1 ? secondary : primary, width: 2, alpha: 0.55 })
      // 内条纹直接在轮廓内计算——无需遮罩
      for (var stripe = 1; stripe <= 3; stripe += 1) {
        var t = stripe / 4
        var sy = topY + (baseY - topY) * t
        var half = s * 0.55 * (up ? t : 1 - t)
        target.moveTo(x - half, sy).lineTo(x + half, sy)
          .stroke({ color: index === 1 ? primary : secondary, width: 1, alpha: 0.35 })
      }
    })
  }

  // 84：捕梦网——环 + 通向偏心枢纽的放射网 + 悬挂羽毛
  function drawDreamcatcher(options) {
    var target = options.target
    var radius = options.radius
    var seed = options.seed
    var primary = options.primary
    var secondary = options.secondary
    var ringR = radius * 0.32
    var cy = -radius * 0.12
    target.circle(0, cy, ringR).stroke({ color: primary, width: 2, alpha: 0.6 })
    var hubX = radius * 0.05
    var hubY = cy - radius * 0.03
    for (var i = 0; i < 8; i += 1) {
      var angle = (i / 8) * TAU + 0.2
      var rimX = Math.cos(angle) * ringR * 0.92
      var rimY = cy + Math.sin(angle) * ringR * 0.92
      target.moveTo(rimX, rimY).lineTo(hubX, hubY)
        .stroke({ color: i % 2 === 0 ? primary : secondary, width: 1, alpha: 0.4 })
    }
    target.circle(hubX, hubY, radius * 0.035).stroke({ color: secondary, width: 1.5, alpha: 0.6 })
    // 三根悬挂绳与羽毛倒刺；底部保持开放
    for (var s = -1; s <= 1; s += 1) {
      var sx = s * ringR * 0.55
      var topY = cy + Math.sqrt(Math.max(0, ringR * ringR - sx * sx))
      var len = radius * (0.22 + (1 - Math.abs(s)) * 0.12 + sonnetHash01(seed, s + 1, 457) * 0.06)
      target.moveTo(sx, topY).lineTo(sx, topY + len).stroke({ color: primary, width: 1, alpha: 0.45 })
      var featherY = topY + len
      target.moveTo(sx, featherY).lineTo(sx, featherY + radius * 0.12)
        .stroke({ color: secondary, width: 1.5, alpha: 0.55 })
      for (var barb = 1; barb <= 3; barb += 1) {
        var by = featherY + barb * radius * 0.03
        var bl = radius * 0.04 * (1 - barb * 0.18)
        target.moveTo(sx, by).lineTo(sx - bl, by + radius * 0.02)
          .stroke({ color: secondary, width: 1, alpha: 0.4 })
        target.moveTo(sx, by).lineTo(sx + bl, by + radius * 0.02)
          .stroke({ color: secondary, width: 1, alpha: 0.4 })
      }
    }
  }

  // 85：流苏帘——短杆下错位悬挂的线 + 珠头
  function drawTasselDrop(options) {
    var target = options.target
    var radius = options.radius
    var seed = options.seed
    var primary = options.primary
    var secondary = options.secondary
    var barY = -radius * 0.4
    target.moveTo(-radius * 0.3, barY).lineTo(radius * 0.3, barY)
      .stroke({ color: primary, width: 2, alpha: 0.4 })
    var threads = 7
    for (var i = 0; i < threads; i += 1) {
      var x = -radius * 0.27 + i * radius * 0.09
      var len = radius * (0.3 + sonnetHash01(seed, i, 461) * 0.35)
      var sway = (sonnetHash01(seed, i, 463) - 0.5) * radius * 0.08
      target.moveTo(x, barY)
        .quadraticCurveTo(x + sway, barY + len * 0.6, x + sway * 0.6, barY + len)
        .stroke({ color: i % 2 === 0 ? primary : secondary, width: 1.5, alpha: 0.45 })
      target.circle(x + sway * 0.6, barY + len + 3, 2.5)
        .fill({ color: i % 3 === 0 ? secondary : primary, alpha: 0.6 })
    }
  }

  var SONNET_CRAFT_GEO_VARIANTS = [
    'origami-crane', 'paper-plane-trail', 'weave-band', 'knot-loop', 'stitch-sampler',
    'folded-fan', 'ribbon-curl', 'patchwork-trio', 'dreamcatcher', 'tassel-drop'
  ]
  var SONNET_CRAFT_DRAWERS = [
    drawOrigamiCrane, drawPaperPlaneTrail, drawWeaveBand, drawKnotLoop, drawStitchSampler,
    drawFoldedFan, drawRibbonCurl, drawPatchworkTrio, drawDreamcatcher, drawTasselDrop
  ]

  // ---------- 动态/技术（原版 sonnetShotMgKinetic.ts） ----------
  // 用相位错开的静态姿态暗示运动（摆锤、多米诺、涟漪）；构图保持开放。
  // 86：摆锤波——沿弧错位相位的摆线与摆球
  function drawPendulumWave(options) {
    var target = options.target
    var radius = options.radius
    var seed = options.seed
    var primary = options.primary
    var secondary = options.secondary
    var pivotY = -radius * 0.42
    var bobs = 9
    for (var i = 0; i < bobs; i += 1) {
      var x = -radius * 0.5 + (i / (bobs - 1)) * radius
      var len = radius * (0.4 + i * 0.035)
      var swing = Math.sin(i * 0.9 + seed * 0.07) * 0.35
      var bx = x + Math.sin(swing) * len
      var by = pivotY + Math.cos(swing) * len
      target.moveTo(x, pivotY).lineTo(bx, by)
        .stroke({ color: primary, width: 1, alpha: 0.4 })
      target.circle(bx, by, 3.5 + (i % 3))
        .fill({ color: i % 2 === 0 ? secondary : primary, alpha: 0.7 })
    }
    target.moveTo(-radius * 0.58, pivotY).lineTo(radius * 0.58, pivotY)
      .stroke({ color: primary, width: 2, alpha: 0.35 })
  }

  // 87：沿弧倒下的多米诺，每个多转一步
  function drawDominoArc(options) {
    var target = options.target
    var radius = options.radius
    var seed = options.seed
    var primary = options.primary
    var secondary = options.secondary
    var count = 10
    var arcR = radius * 0.55
    for (var i = 0; i < count; i += 1) {
      var angle = Math.PI * 1.15 + (i / (count - 1)) * Math.PI * 0.7
      var bx = Math.cos(angle) * arcR
      var by = Math.sin(angle) * arcR + radius * 0.5
      var tilt = (i / (count - 1)) * 1.1 * (seed % 2 === 0 ? 1 : -1)
      var w = radius * 0.035
      var h = radius * 0.14
      var cos = Math.cos(tilt)
      var sin = Math.sin(tilt)
      var corner = function (cx, cy) { return [bx + cx * cos - cy * sin, by + cx * sin + cy * cos] }
      var p1 = corner(-w, 0)
      var p2 = corner(w, 0)
      var p3 = corner(w, -h * 2)
      var p4 = corner(-w, -h * 2)
      target.moveTo(p1[0], p1[1]).lineTo(p2[0], p2[1]).lineTo(p3[0], p3[1]).lineTo(p4[0], p4[1]).lineTo(p1[0], p1[1])
        .stroke({ color: i % 3 === 0 ? secondary : primary, width: 1.5, alpha: 0.55 })
    }
  }

  // 88：三个由环与放射齿组成的啮合齿轮
  function drawGearCluster(options) {
    var target = options.target
    var radius = options.radius
    var seed = options.seed
    var primary = options.primary
    var secondary = options.secondary
    var gears = [
      { x: 0, y: 0, r: radius * 0.26, teeth: 10 },
      { x: radius * 0.42, y: -radius * 0.2, r: radius * 0.16, teeth: 8 },
      { x: -radius * 0.4, y: radius * 0.22, r: radius * 0.13, teeth: 7 }
    ]
    gears.forEach(function (gear, gi) {
      var color = gi === 1 ? secondary : primary
      target.circle(gear.x, gear.y, gear.r).stroke({ color: color, width: 2, alpha: 0.55 })
      target.circle(gear.x, gear.y, gear.r * 0.3).stroke({ color: color, width: 1.5, alpha: 0.45 })
      var offset = sonnetHash01(seed, gi, 467) * TAU
      for (var t = 0; t < gear.teeth; t += 1) {
        var angle = offset + (t / gear.teeth) * TAU
        target.moveTo(gear.x + Math.cos(angle) * gear.r, gear.y + Math.sin(angle) * gear.r)
          .lineTo(gear.x + Math.cos(angle) * gear.r * 1.18, gear.y + Math.sin(angle) * gear.r * 1.18)
          .stroke({ color: color, width: 3, alpha: 0.5 })
      }
    })
  }

  // 89：带 45 度折弯与焊盘节点的电路走线，无板框
  function drawCircuitDelta(options) {
    var target = options.target
    var radius = options.radius
    var width = options.width
    var height = options.height
    var seed = options.seed
    var primary = options.primary
    var secondary = options.secondary
    var bleed = resolveSonnetShotMgBleed(width, height, radius)
    var lanes = 4
    for (var lane = 0; lane < lanes; lane += 1) {
      var y = -radius * 0.36 + lane * radius * 0.24
      var bendX = -radius * 0.3 + sonnetHash01(seed, lane, 479) * radius * 0.6
      var drop = (lane % 2 === 0 ? 1 : -1) * radius * 0.08
      target.moveTo(-bleed.x, y)
        .lineTo(bendX - Math.abs(drop), y)
        .lineTo(bendX, y + drop)
        .lineTo(bleed.x, y + drop)
        .stroke({ color: lane === 1 ? secondary : primary, width: 1.5, alpha: 0.45 })
      target.circle(bendX, y + drop, 3).fill({ color: secondary, alpha: 0.7 })
      target.circle(-bleed.x * 0.55, y, 2.5).stroke({ color: primary, width: 1, alpha: 0.5 })
    }
  }

  // 90：信号塔桅杆 + 两侧放射的波弧
  function drawSignalTower(options) {
    var target = options.target
    var radius = options.radius
    var primary = options.primary
    var secondary = options.secondary
    var baseY = radius * 0.45
    var topY = -radius * 0.3
    target.moveTo(-radius * 0.12, baseY).lineTo(0, topY).lineTo(radius * 0.12, baseY)
      .stroke({ color: primary, width: 2, alpha: 0.6 })
    for (var brace = 1; brace <= 3; brace += 1) {
      var y = baseY - (baseY - topY) * (brace / 4)
      var half = radius * 0.12 * (1 - brace / 4.5)
      target.moveTo(-half, y).lineTo(half, y - radius * 0.06)
        .stroke({ color: primary, width: 1, alpha: 0.4 })
    }
    target.circle(0, topY, radius * 0.03).fill({ color: secondary, alpha: 0.9 })
    var sides = [-1, 1]
    sides.forEach(function (side) {
      for (var ring = 0; ring < 3; ring += 1) {
        var r = radius * (0.12 + ring * 0.13)
        target.arc(0, topY, r, side < 0 ? Math.PI * 0.75 : -Math.PI * 0.25, side < 0 ? Math.PI * 1.25 : Math.PI * 0.25)
          .stroke({ color: ring === 1 ? secondary : primary, width: 1.5, alpha: 0.45 - ring * 0.1 })
      }
    })
  }

  // 91：以错位踏步/立板折线上升的螺旋楼梯
  function drawSpiralStair(options) {
    var target = options.target
    var radius = options.radius
    var seed = options.seed
    var primary = options.primary
    var secondary = options.secondary
    var steps = 12
    var startAngle = sonnetHash01(seed, 0, 487) * TAU
    for (var i = 0; i < steps; i += 1) {
      var angle = startAngle + i * 0.42
      var r = radius * (0.14 + i * 0.04)
      var x = Math.cos(angle) * r
      var y = radius * 0.4 - i * radius * 0.055
      var tread = radius * 0.09
      target.moveTo(x, y)
        .lineTo(x + Math.cos(angle) * tread, y + Math.sin(angle) * tread * 0.4)
        .stroke({ color: i % 3 === 0 ? secondary : primary, width: 2, alpha: 0.55 })
      target.moveTo(x + Math.cos(angle) * tread, y + Math.sin(angle) * tread * 0.4)
        .lineTo(x + Math.cos(angle) * tread, y + Math.sin(angle) * tread * 0.4 - radius * 0.055)
        .stroke({ color: primary, width: 1, alpha: 0.35 })
    }
    // 中央脊柱，顶部开放
    target.moveTo(0, radius * 0.45).lineTo(0, -radius * 0.35)
      .stroke({ color: primary, width: 2, alpha: 0.3 })
  }

  // 92：错位长度的下落水柱 + 下方溅水弧
  function drawWaterfallLines(options) {
    var target = options.target
    var radius = options.radius
    var seed = options.seed
    var primary = options.primary
    var secondary = options.secondary
    var streams = 9
    for (var i = 0; i < streams; i += 1) {
      var x = -radius * 0.5 + (i / (streams - 1)) * radius + (sonnetHash01(seed, i, 491) - 0.5) * radius * 0.05
      var topY = -radius * 0.6 + sonnetHash01(seed, i, 499) * radius * 0.15
      var len = radius * (0.55 + sonnetHash01(seed, i, 503) * 0.35)
      target.moveTo(x, topY).lineTo(x, topY + len)
        .stroke({ color: i % 3 === 0 ? secondary : primary, width: i % 3 === 0 ? 2 : 1, alpha: 0.4 + (i % 3) * 0.08 })
    }
    for (var s = 0; s < 5; s += 1) {
      var sx = -radius * 0.4 + s * radius * 0.2
      target.arc(sx, radius * 0.5, radius * 0.07, Math.PI, TAU)
        .stroke({ color: secondary, width: 1, alpha: 0.4 })
    }
  }

  // 93：四叶风车，枢纽周围带弯曲叶片
  function drawPinwheel(options) {
    var target = options.target
    var radius = options.radius
    var seed = options.seed
    var primary = options.primary
    var secondary = options.secondary
    var hubR = radius * 0.05
    for (var blade = 0; blade < 4; blade += 1) {
      var angle = (blade / 4) * TAU + sonnetHash01(seed, 0, 509) * 0.5
      var tipR = radius * 0.5
      var tx = Math.cos(angle) * tipR
      var ty = Math.sin(angle) * tipR
      var edgeAngle = angle + 0.7
      target.moveTo(Math.cos(angle) * hubR, Math.sin(angle) * hubR)
        .quadraticCurveTo(
          Math.cos(edgeAngle) * tipR * 0.55, Math.sin(edgeAngle) * tipR * 0.55,
          tx, ty
        )
        .stroke({ color: blade % 2 === 0 ? primary : secondary, width: 2, alpha: 0.55 })
      target.moveTo(tx, ty)
        .lineTo(Math.cos(angle + 0.45) * tipR * 0.62, Math.sin(angle + 0.45) * tipR * 0.62)
        .stroke({ color: blade % 2 === 0 ? primary : secondary, width: 1.5, alpha: 0.4 })
    }
    target.circle(0, 0, hubR).fill({ color: secondary, alpha: 0.8 })
    target.circle(0, 0, radius * 0.56).stroke({ color: primary, width: 1, alpha: 0.15 })
  }

  // 94：下落水滴悬于断裂的涟漪弧上——一切都不触边
  function drawRippleDrop(options) {
    var target = options.target
    var radius = options.radius
    var seed = options.seed
    var primary = options.primary
    var secondary = options.secondary
    var dx = (sonnetHash01(seed, 0, 521) - 0.5) * radius * 0.2
    // 水滴
    target.moveTo(dx, -radius * 0.52)
    target.bezierCurveTo(dx + radius * 0.07, -radius * 0.36, dx + radius * 0.06, -radius * 0.3, dx, -radius * 0.27)
    target.bezierCurveTo(dx - radius * 0.06, -radius * 0.3, dx - radius * 0.07, -radius * 0.36, dx, -radius * 0.52)
    target.stroke({ color: secondary, width: 2, alpha: 0.65 })
    // 断裂涟漪：在交替位置带缺口的弧段
    for (var ring = 0; ring < 4; ring += 1) {
      var r = radius * (0.14 + ring * 0.13)
      var y = radius * 0.25
      var gapAt = sonnetHash01(seed, ring, 523) * TAU
      target.arc(dx, y, r, gapAt, gapAt + TAU * 0.72)
        .stroke({ color: ring % 2 === 0 ? primary : secondary, width: ring === 0 ? 2 : 1, alpha: 0.5 - ring * 0.09 })
    }
    // 撞击冠
    target.moveTo(dx - radius * 0.05, radius * 0.2).lineTo(dx - radius * 0.02, radius * 0.12)
      .stroke({ color: primary, width: 1.5, alpha: 0.5 })
    target.moveTo(dx + radius * 0.05, radius * 0.2).lineTo(dx + radius * 0.02, radius * 0.12)
      .stroke({ color: primary, width: 1.5, alpha: 0.5 })
  }

  // 95：悬索桥——下垂主缆、两座塔、开放的桥面线
  function drawSuspensionBridge(options) {
    var target = options.target
    var radius = options.radius
    var width = options.width
    var height = options.height
    var primary = options.primary
    var secondary = options.secondary
    var bleed = resolveSonnetShotMgBleed(width, height, radius)
    var deckY = radius * 0.3
    var towerX = radius * 0.34
    var towerTop = -radius * 0.28
    target.moveTo(-bleed.x, deckY).lineTo(bleed.x, deckY)
      .stroke({ color: primary, width: 2, alpha: 0.5 })
    var sides = [-1, 1]
    sides.forEach(function (side) {
      var x = side * towerX
      target.moveTo(x - radius * 0.03, deckY).lineTo(x - radius * 0.03, towerTop)
        .stroke({ color: primary, width: 2, alpha: 0.55 })
      target.moveTo(x + radius * 0.03, deckY).lineTo(x + radius * 0.03, towerTop)
        .stroke({ color: primary, width: 2, alpha: 0.55 })
      target.moveTo(x - radius * 0.04, towerTop + radius * 0.08).lineTo(x + radius * 0.04, towerTop + radius * 0.08)
        .stroke({ color: secondary, width: 1.5, alpha: 0.45 })
    })
    // 主缆：三段二次曲线，端点出血出画
    target.moveTo(-bleed.x, deckY - radius * 0.1)
      .quadraticCurveTo(-towerX, towerTop - radius * 0.06, -towerX, towerTop)
      .stroke({ color: secondary, width: 1.5, alpha: 0.5 })
    target.moveTo(-towerX, towerTop)
      .quadraticCurveTo(0, deckY - radius * 0.04, towerX, towerTop)
      .stroke({ color: secondary, width: 1.5, alpha: 0.5 })
    target.moveTo(towerX, towerTop)
      .quadraticCurveTo(bleed.x, deckY - radius * 0.1, bleed.x, deckY - radius * 0.06)
      .stroke({ color: secondary, width: 1.5, alpha: 0.5 })
    // 中跨的吊索
    for (var i = 1; i < 7; i += 1) {
      var t = i / 7
      var x = -towerX + t * towerX * 2
      var cableY = (1 - t) * (1 - t) * towerTop + 2 * (1 - t) * t * (deckY - radius * 0.04) + t * t * towerTop
      target.moveTo(x, cableY).lineTo(x, deckY)
        .stroke({ color: primary, width: 1, alpha: 0.35 })
    }
  }

  // 96：穿过两极的磁场环，上下镜像
  function drawFieldLines(options) {
    var target = options.target
    var radius = options.radius
    var primary = options.primary
    var secondary = options.secondary
    var poleGap = radius * 0.2
    for (var loop = 0; loop < 4; loop += 1) {
      var bulge = radius * (0.2 + loop * 0.16)
      var mirrors = [-1, 1]
      mirrors.forEach(function (mirror) {
        target.moveTo(0, -poleGap)
        target.bezierCurveTo(
          mirror * bulge, -poleGap - radius * 0.1,
          mirror * bulge, poleGap + radius * 0.1,
          0, poleGap
        )
        target.stroke({ color: loop % 2 === 0 ? primary : secondary, width: loop === 0 ? 2 : 1, alpha: 0.5 - loop * 0.08 })
      })
    }
    target.circle(0, -poleGap, radius * 0.04).fill({ color: secondary, alpha: 0.85 })
    target.circle(0, poleGap, radius * 0.04).fill({ color: primary, alpha: 0.85 })
    target.moveTo(-radius * 0.1, -poleGap).lineTo(radius * 0.1, -poleGap)
      .stroke({ color: secondary, width: 1.5, alpha: 0.5 })
    target.moveTo(-radius * 0.1, poleGap).lineTo(radius * 0.1, poleGap)
      .stroke({ color: primary, width: 1.5, alpha: 0.5 })
  }

  // 97：棱镜把入射光束分扇成光谱
  function drawPrismBeam(options) {
    var target = options.target
    var radius = options.radius
    var width = options.width
    var height = options.height
    var primary = options.primary
    var secondary = options.secondary
    var bleed = resolveSonnetShotMgBleed(width, height, radius)
    var s = radius * 0.24
    var topY = -s * 0.7
    var baseY = s * 0.55
    target.moveTo(0, topY).lineTo(s * 0.8, baseY).lineTo(-s * 0.8, baseY).lineTo(0, topY)
      .stroke({ color: primary, width: 2, alpha: 0.6 })
    target.moveTo(0, topY).lineTo(s * 0.8, baseY).lineTo(-s * 0.8, baseY).lineTo(0, topY)
      .fill({ color: primary, alpha: 0.06 })
    // 自左缘入射的光束
    var entryX = -s * 0.35
    var entryY = s * 0.05
    target.moveTo(-bleed.x, entryY + radius * 0.12).lineTo(entryX, entryY)
      .stroke({ color: secondary, width: 2.5, alpha: 0.6 })
    // 向右缘扇出的出射光
    for (var ray = 0; ray < 4; ray += 1) {
      var exitY = -radius * 0.1 + ray * radius * 0.09
      target.moveTo(s * 0.4, entryY - radius * 0.05)
        .lineTo(bleed.x, exitY)
        .stroke({ color: ray === 1 ? secondary : primary, width: 1.5, alpha: 0.45 - ray * 0.05 })
    }
  }

  // 98：在两面看不见的墙之间反弹的回声弧，逐跳错位
  function drawEchoArcs(options) {
    var target = options.target
    var radius = options.radius
    var primary = options.primary
    var secondary = options.secondary
    for (var hop = 0; hop < 5; hop += 1) {
      var side = hop % 2 === 0 ? -1 : 1
      var cx = side * radius * 0.52
      var cy = -radius * 0.35 + hop * radius * 0.18
      var r = radius * (0.14 + hop * 0.045)
      target.arc(cx, cy, r, side < 0 ? -Math.PI / 2 : Math.PI / 2, side < 0 ? Math.PI / 2 : Math.PI * 1.5)
        .stroke({ color: hop % 2 === 0 ? primary : secondary, width: 2 - hop * 0.2, alpha: 0.55 - hop * 0.07 })
      target.circle(cx + (side < 0 ? r : -r) * 0.4, cy + r * 0.6, 1.8)
        .fill({ color: secondary, alpha: 0.5 })
    }
  }

  // 99：菱形风筝 + 十字骨架、尾弓与长自由线
  function drawKiteString(options) {
    var target = options.target
    var radius = options.radius
    var seed = options.seed
    var primary = options.primary
    var secondary = options.secondary
    var kx = radius * 0.22 * (seed % 2 === 0 ? 1 : -1)
    var ky = -radius * 0.3
    var kw = radius * 0.16
    var kh = radius * 0.22
    target.moveTo(kx, ky - kh).lineTo(kx + kw, ky).lineTo(kx, ky + kh).lineTo(kx - kw, ky).lineTo(kx, ky - kh)
      .stroke({ color: primary, width: 2, alpha: 0.6 })
    target.moveTo(kx, ky - kh).lineTo(kx, ky + kh).stroke({ color: secondary, width: 1, alpha: 0.4 })
    target.moveTo(kx - kw, ky).lineTo(kx + kw, ky).stroke({ color: secondary, width: 1, alpha: 0.4 })
    target.moveTo(kx, ky - kh).lineTo(kx + kw, ky).lineTo(kx, ky + kh).lineTo(kx - kw, ky).lineTo(kx, ky - kh)
      .fill({ color: primary, alpha: 0.06 })
    // 带采样垂度的线；尾弓是独立命令，保证线保持一条连续描边（整段生长）
    var bows = []
    target.moveTo(kx, ky + kh)
    var stringSteps = 24
    for (var i = 1; i <= stringSteps; i += 1) {
      var t = i / stringSteps
      var x = kx - t * radius * 0.5 + Math.sin(t * Math.PI * 2.2) * radius * 0.08
      var y = ky + kh + t * radius * 0.6
      target.lineTo(x, y)
      if (i === 7 || i === 13 || i === 19) bows.push({ x: x, y: y })
    }
    target.stroke({ color: primary, width: 1.5, alpha: 0.5 })
    bows.forEach(function (bow) {
      var bowS = radius * 0.035
      target.moveTo(bow.x, bow.y).lineTo(bow.x - bowS, bow.y - bowS).lineTo(bow.x, bow.y - bowS * 0.3).lineTo(bow.x + bowS, bow.y - bowS)
        .lineTo(bow.x, bow.y)
        .stroke({ color: secondary, width: 1, alpha: 0.55 })
    })
  }

  var SONNET_KINETIC_GEO_VARIANTS = [
    'pendulum-wave', 'domino-arc', 'gear-cluster', 'circuit-delta', 'signal-tower',
    'spiral-stair', 'waterfall-lines', 'pinwheel', 'ripple-drop', 'suspension-bridge',
    'field-lines', 'prism-beam', 'echo-arcs', 'kite-string'
  ]
  var SONNET_KINETIC_DRAWERS = [
    drawPendulumWave, drawDominoArc, drawGearCluster, drawCircuitDelta, drawSignalTower,
    drawSpiralStair, drawWaterfallLines, drawPinwheel, drawRippleDrop, drawSuspensionBridge,
    drawFieldLines, drawPrismBeam, drawEchoArcs, drawKiteString
  ]

  // ---------- 扩展区间分发（原版 sonnetExtendedShotMg.ts） ----------
  var SONNET_EXTENDED_GEO_VARIANT_START = 48
  var SONNET_EXTENDED_GEO_VARIANT_COUNT = 52
  var SONNET_EXTENDED_GEO_VARIANTS = []
  var EXTENDED_DRAWERS = []
  var partA = window.FoliaSonnetMgExtended
  var registries = [
    partA.SONNET_CELESTIAL_GEO_VARIANTS, partA.SONNET_CELESTIAL_DRAWERS,
    partA.SONNET_MARINE_GEO_VARIANTS, partA.SONNET_MARINE_DRAWERS,
    SONNET_MUSIC_GEO_VARIANTS, SONNET_MUSIC_DRAWERS,
    SONNET_CRAFT_GEO_VARIANTS, SONNET_CRAFT_DRAWERS,
    SONNET_KINETIC_GEO_VARIANTS, SONNET_KINETIC_DRAWERS
  ]
  registries.forEach(function (registry, index) {
    if (index % 2 === 0) {
      for (var i = 0; i < registry.length; i += 1) SONNET_EXTENDED_GEO_VARIANTS.push(registry[i])
    } else {
      for (var j = 0; j < registry.length; j += 1) EXTENDED_DRAWERS.push(registry[j])
    }
  })

  function drawExtendedSonnetShotMg(options) {
    var index = options.variant - SONNET_EXTENDED_GEO_VARIANT_START
    var drawer = EXTENDED_DRAWERS[index]
    if (!drawer) return false
    drawer(options)
    return true
  }

  window.FoliaSonnetMgExtended = {
    SONNET_EXTENDED_GEO_VARIANT_START: SONNET_EXTENDED_GEO_VARIANT_START,
    SONNET_EXTENDED_GEO_VARIANT_COUNT: SONNET_EXTENDED_GEO_VARIANT_COUNT,
    SONNET_EXTENDED_GEO_VARIANTS: SONNET_EXTENDED_GEO_VARIANTS,
    drawExtendedSonnetShotMg: drawExtendedSonnetShotMg
  }
})()
