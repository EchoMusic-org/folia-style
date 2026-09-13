// 凝彩模式·构图族三：移植自 folia-major src/components/visualizer/tempera/compositions/
//   temperaCharmCompositions.ts（圆滑族 9 种：气泡、云朵窗、心形、闪光、花瓣、缎带）
//   temperaApertureCompositions.ts（镂空族 10 种：冲孔板）
// 挂 window.FoliaTemperaCompsC，由 tempera-compositions-d.js 聚合进注册表。
(function () {
  'use strict'

  var Core = window.FoliaTemperaCore
  var Curves = window.FoliaTemperaCurves
  var Shapes = window.FoliaTemperaShapes
  var A = window.FoliaTemperaCompsA
  var temperaHash01 = Core.temperaHash01
  var rectPolygon = Curves.rectPolygon
  var circlePolygon = Curves.circlePolygon
  var buildHatchSpec = Curves.buildHatchSpec
  var ellipsePolygon = Curves.ellipsePolygon
  var lobedPolygon = Curves.lobedPolygon
  var heartPolygon = Curves.heartPolygon
  var starPolygon = Curves.starPolygon
  var scallopBandPolygon = Curves.scallopBandPolygon
  var arcRibbonPolygon = Curves.arcRibbonPolygon
  var roundedRectPolygon = Curves.roundedRectPolygon
  var rotatePolygon = Curves.rotatePolygon
  var annularSectorPolygon = Curves.annularSectorPolygon
  var buildDiscField = Curves.buildDiscField
  var drawPolygonFill = Shapes.drawPolygonFill
  var drawPolygonOutline = Shapes.drawPolygonOutline
  var drawHatchFill = Shapes.drawHatchFill
  var drawLines = Shapes.drawLines
  var drawDiscs = Shapes.drawDiscs
  var drawRings = Shapes.drawRings
  var addCutField = A.addCutField
  var addHoleLip = A.addHoleLip

  // ---------- 圆滑族（原版 compositions/temperaCharmCompositions.ts） ----------
  // 视觉小说 PV 动作设计之后的圆滑族：气泡、蕾丝边、心形、闪光、贴纸板。
  // 其他族用直边切画面；这一族把曲线形状放在平涂底面*上*，
  // 字读作印在贴纸上而不是跨在面板缝上。几何来自 tempera-curves；
  // 那里只有凸形状可以被 hatch
  //
  // 两条规矩把这个族拴在 Tempera 的其余部分上：墨描边保留
  // （没有描边的柔和形状会化进场面，反色滤镜就没有边可切），
  // 而且这里没有任何东西随音频脉冲——浮动是共享的确定性 drift

  // 每张卡从一面平涂场面出发；曲线形状放在它上面
  function addFieldC(ctx, color, alpha) {
    if (alpha === undefined) alpha = 0.92
    var width = ctx.width
    var height = ctx.height
    var bleed = ctx.bleed
    ctx.add(
      drawPolygonFill(ctx.pixi, rectPolygon(-bleed, -bleed, width + bleed * 2, height + bleed * 2), color, alpha, ctx.gradient),
      { span: 0.5 }
    )
  }

  // 从字旁升起的气泡。尺寸分布是灵魂：字靠着的大号层扛起色调，
  // 漂过字上的小号层制造前景
  function bubbleDrift(ctx) {
    var width = ctx.width
    var height = ctx.height
    var palette = ctx.palette
    var unit = Math.min(width, height)
    addFieldC(ctx, palette.tone1)
    var big = buildDiscField(ctx.seed, 11, width, height, 8, unit * 0.115)
    var small = buildDiscField(ctx.seed, 17, width, height, 13, unit * 0.042)
    ctx.add(drawDiscs(ctx.pixi, big, palette.tone3, 0.88, ctx.gradient), { delay: 0.05, span: 0.6, enterDY: height * 0.16, drift: true })
    ctx.add(drawRings(ctx.pixi, big, palette.ink, 2, 0.55), { delay: 0.12, span: 0.55, enterDY: height * 0.12 })
    ctx.add(drawDiscs(ctx.pixi, small, palette.tone4, 0.7), { delay: 0.18, span: 0.6, enterDY: height * 0.22, drift: true })
    if (!ctx.showDecor) return
    // 两枚领队气泡上的高光。没有它们圆盘读作平点
    ctx.add(drawDiscs(ctx.pixi, big.slice(0, 2).map(function (disc) {
      return {
        x: disc.x - disc.radius * 0.36,
        y: disc.y - disc.radius * 0.36,
        radius: disc.radius * 0.16
      }
    }), palette.paper, 0.85), { delay: 0.28, drift: true })
  }

  // 瓣状徽章：promo 把一行旁白放进去的云框
  function cloudWindow(ctx) {
    var width = ctx.width
    var height = ctx.height
    var palette = ctx.palette
    var unit = Math.min(width, height)
    var cx = width / 2
    var cy = height * 0.52
    var rx = width * 0.3
    var ry = height * 0.3
    addFieldC(ctx, palette.tone3)
    var cloud = lobedPolygon(cx, cy, rx, ry, 9, 0.1)
    ctx.add(drawPolygonFill(ctx.pixi, lobedPolygon(cx, cy + height * 0.025, rx * 1.05, ry * 1.05, 9, 0.1), palette.tone4, 0.5), { delay: 0.04, span: 0.6 })
    ctx.add(drawPolygonFill(ctx.pixi, cloud, palette.paper, 0.96, ctx.gradient), { delay: 0.08, span: 0.55 })
    ctx.add(drawPolygonOutline(ctx.pixi, cloud, palette.ink, 2.4, 0.85), { delay: 0.12, span: 0.5 })
    if (!ctx.showDecor) return
    // 气球尾巴，由从它上面掉下来的两个气泡组成
    ctx.add(drawDiscs(ctx.pixi, [
      { x: cx - rx * 1.16, y: cy + ry * 0.66, radius: unit * 0.035 },
      { x: cx - rx * 1.32, y: cy + ry * 0.9, radius: unit * 0.02 }
    ], palette.paper, 0.92, ctx.gradient), { delay: 0.22, drift: true })
  }

  // 三种尺寸的心形冲出画面；最大的那个扛起文字
  function heartBurst(ctx) {
    var width = ctx.width
    var height = ctx.height
    var palette = ctx.palette
    var lean = temperaHash01(ctx.seed, 3, 83) > 0.5 ? 1 : -1
    var cx = width * 0.5
    var cy = height * 0.52
    var rx = width * 0.32
    var ry = height * 0.4
    addFieldC(ctx, palette.tone4, 0.94)
    var main = rotatePolygon(heartPolygon(cx, cy, rx, ry), cx, cy, lean * 0.06)
    // 偏移的副本先下去：它读作套印不准的第二次印刷——
    // 与文字的浮影层同一个想法，而不是投影
    ctx.add(drawPolygonFill(
      ctx.pixi,
      rotatePolygon(heartPolygon(cx + lean * width * 0.022, cy + height * 0.025, rx, ry), cx, cy, lean * 0.06),
      palette.tone2,
      0.6
    ), { delay: 0.04, span: 0.6 })
    ctx.add(drawPolygonFill(ctx.pixi, main, palette.paper, 0.95, ctx.gradient), { delay: 0.08, span: 0.55, enterDY: height * 0.1 })
    ctx.add(drawPolygonOutline(ctx.pixi, main, palette.ink, 3, 0.9), { delay: 0.14, span: 0.5, enterDY: height * 0.08 })
    ;[0.4, 0.24].forEach(function (scale, index) {
      var x = lean > 0 ? width * (0.88 + index * 0.08) : width * (0.12 - index * 0.08)
      var y = height * (0.24 + index * 0.42)
      // 画在定位组内的局部坐标里：drift 绕节点自身原点缩放，
      // 离心的形状必须在原点居中，否则会公转
      var group = ctx.createGroup(0, x, y)
      ctx.add(drawPolygonFill(
        ctx.pixi,
        rotatePolygon(heartPolygon(0, 0, rx * scale, ry * scale), 0, 0, -lean * 0.22),
        palette.tone2,
        0.9,
        ctx.gradient
      ), { delay: 0.2 + index * 0.06, span: 0.5, enterDX: lean * width * 0.12, drift: true }, group)
    })
  }

  // kirakira：近乎裸的场面上两层四芒闪光
  function sparkleField(ctx) {
    var width = ctx.width
    var height = ctx.height
    var palette = ctx.palette
    var unit = Math.min(width, height)
    addFieldC(ctx, palette.tone1, 0.88)
    var seeds = buildDiscField(ctx.seed, 23, width, height, 9, unit * 0.07)
    seeds.slice(0, 5).forEach(function (disc, index) {
      // 收紧的腰正是四角星读作闪光而不是十字的原因。
      // 定位组内的局部坐标，drift 才能在原地闪烁
      var star = starPolygon(0, 0, disc.radius, disc.radius * 0.16, 4, temperaHash01(ctx.seed, index, 29) * 0.9)
      var group = ctx.createGroup(0, disc.x, disc.y)
      ctx.add(drawPolygonFill(ctx.pixi, star, palette.tone4, 0.9, ctx.gradient), { delay: 0.06 + index * 0.05, span: 0.5, drift: true }, group)
    })
    ctx.add(drawDiscs(
      ctx.pixi,
      seeds.slice(5).map(function (disc) {
        return { x: disc.x, y: disc.y, radius: disc.radius * 0.22 }
      }),
      palette.tone4,
      0.7
    ), { delay: 0.24, span: 0.55, drift: true })
    ctx.add(drawLines(ctx.pixi, [{ x1: width * 0.08, y1: height * 0.74, x2: width * 0.92, y2: height * 0.72 }], palette.tone4, 1.2, 0.5),
      { delay: 0.3, span: 0.5, enterDX: -width * 0.12 })
  }

  // 从出画轮毂摆出的花瓣，加上它们来自的蔷薇结
  function petalArc(ctx) {
    var width = ctx.width
    var height = ctx.height
    var palette = ctx.palette
    var fromLeft = temperaHash01(ctx.seed, 5, 89) > 0.5
    var hubX = fromLeft ? -width * 0.1 : width * 1.1
    var hubY = height * 0.12
    var rx = width * 0.26
    var ry = height * 0.085
    addFieldC(ctx, palette.tone2)
    for (var index = 0; index < 5; index += 1) {
      // 每片花瓣贴着轮毂建好，再绕它摆出，无论种子选中哪个角，扇都是扇
      var base = ellipsePolygon(hubX + (fromLeft ? rx : -rx), hubY, rx, ry, 28)
      var petal = rotatePolygon(base, hubX, hubY, (fromLeft ? 1 : -1) * (0.18 + index * 0.3))
      ctx.add(drawPolygonFill(ctx.pixi, petal, index % 2 === 0 ? palette.tone3 : palette.tone1, 0.9, ctx.gradient),
        { delay: index * 0.05, span: 0.55, enterDY: -height * 0.1 })
      ctx.add(drawPolygonOutline(ctx.pixi, petal, palette.ink, 1.6, 0.5), { delay: 0.06 + index * 0.05, span: 0.5 })
    }
    var hub = ctx.createGroup(0, hubX, hubY)
    ctx.add(drawPolygonFill(ctx.pixi, lobedPolygon(0, 0, width * 0.11, width * 0.11, 6, 0.34), palette.tone4, 0.9, ctx.gradient),
      { delay: 0.28, span: 0.5, drift: true }, hub)
    if (!ctx.showDecor) return
    // 已经落下的花瓣，在另一侧：没有它们扇会让那一半空着
    ctx.add(drawDiscs(ctx.pixi, [0, 1, 2].map(function (index2) {
      return {
        x: fromLeft ? width * (0.78 + index2 * 0.07) : width * (0.22 - index2 * 0.07),
        y: height * (0.7 + index2 * 0.1),
        radius: height * (0.03 - index2 * 0.006)
      }
    }), palette.tone4, 0.75, ctx.gradient), { delay: 0.32, span: 0.5, drift: true })
  }

  // 从两侧收拢的两条蕾丝带；歌词坐在它们之间的亮缝里
  function scallopBand(ctx) {
    var width = ctx.width
    var height = ctx.height
    var palette = ctx.palette
    var bleed = ctx.bleed
    addFieldC(ctx, palette.tone1, 0.9)
    var top = scallopBandPolygon(-bleed, width + bleed, -bleed, height * 0.28, 9)
    var bottom = scallopBandPolygon(-bleed, width + bleed, height + bleed, height * 0.72, 9)
    ctx.add(drawPolygonFill(ctx.pixi, top, palette.tone3, 0.92, ctx.gradient), { delay: 0.04, span: 0.55, enterDY: -height * 0.18 })
    ctx.add(drawPolygonFill(ctx.pixi, bottom, palette.tone4, 0.92, ctx.gradient), { delay: 0.1, span: 0.55, enterDY: height * 0.18 })
    ctx.add(drawPolygonOutline(ctx.pixi, top, palette.ink, 2, 0.75), { delay: 0.14, span: 0.5, enterDY: -height * 0.12 })
    ctx.add(drawPolygonOutline(ctx.pixi, bottom, palette.ink, 2, 0.75), { delay: 0.18, span: 0.5, enterDY: height * 0.12 })
    if (!ctx.showDecor) return
    // 珠子钉在两个鼓包相接的尖上，读作缝在蕾丝上而不是散在它上面——
    // 所以用鼓包节距而不是整分数
    var pitch = (width + bleed * 2) / 9
    var beads = []
    for (var index = 0; index < 5; index += 1) {
      beads.push({
        x: -bleed + pitch * (index + 2),
        y: height * 0.28,
        radius: Math.min(width, height) * 0.018
      })
    }
    ctx.add(drawDiscs(ctx.pixi, beads, palette.ink, 0.7), { delay: 0.26, drift: true })
  }

  // 一条弧过画面的缎带加上钉在上面的结：promo 的标题横幅
  function ribbonLoop(ctx) {
    var width = ctx.width
    var height = ctx.height
    var palette = ctx.palette
    var bleed = ctx.bleed
    var sag = height * (0.06 + temperaHash01(ctx.seed, 7, 97) * 0.05) * (temperaHash01(ctx.seed, 9, 97) > 0.5 ? 1 : -1)
    addFieldC(ctx, palette.tone2)
    var band = arcRibbonPolygon(-bleed, width + bleed, height * 0.5, height * 0.3, sag)
    var echo = arcRibbonPolygon(-bleed, width + bleed, height * 0.68, height * 0.06, -sag)
    ctx.add(drawPolygonFill(ctx.pixi, echo, palette.tone4, 0.7, ctx.gradient), { delay: 0.04, span: 0.6, enterDX: -width * 0.16 })
    ctx.add(drawPolygonFill(ctx.pixi, band, palette.paper, 0.95, ctx.gradient), { delay: 0.08, span: 0.55, enterDX: width * 0.18 })
    ctx.add(drawPolygonOutline(ctx.pixi, band, palette.ink, 2.6, 0.85), { delay: 0.14, span: 0.5, enterDX: width * 0.14 })
    // 带上的蝴蝶结。它刻意落在字下：歌词跨过它正是反色滤镜
    // 变成一个双色词的场合
    var knotX = width * (temperaHash01(ctx.seed, 11, 97) > 0.5 ? 0.24 : 0.76)
    var knotY = height * 0.5 + Math.sin((knotX + bleed) / (width + bleed * 2) * Math.PI) * sag
    var bow = ctx.createGroup(0, knotX, knotY)
    ;[-1, 1].forEach(function (side, index) {
      var loop = rotatePolygon(
        ellipsePolygon(side * width * 0.055, 0, width * 0.05, height * 0.07, 26),
        0,
        0,
        side * 0.3
      )
      ctx.add(drawPolygonFill(ctx.pixi, loop, palette.tone4, 0.92, ctx.gradient), { delay: 0.2 + index * 0.04, span: 0.5, enterDX: side * width * 0.06 }, bow)
      ctx.add(drawPolygonOutline(ctx.pixi, loop, palette.ink, 2, 0.8), { delay: 0.24 + index * 0.04, span: 0.5 }, bow)
    })
    var knot = roundedRectPolygon(-width * 0.018, -height * 0.035, width * 0.036, height * 0.07, height * 0.02)
    ctx.add(drawPolygonFill(ctx.pixi, knot, palette.tone4, 0.95, ctx.gradient), { delay: 0.28, span: 0.5 }, bow)
    ctx.add(drawPolygonOutline(ctx.pixi, knot, palette.ink, 2, 0.85), { delay: 0.3, span: 0.5 }, bow)
  }

  // 贴纸板：圆角面板、双规线、四枚图钉。族里最平静的卡
  function roundPlate(ctx) {
    var width = ctx.width
    var height = ctx.height
    var palette = ctx.palette
    var unit = Math.min(width, height)
    addFieldC(ctx, palette.tone3)
    var plate = roundedRectPolygon(width * 0.16, height * 0.24, width * 0.68, height * 0.52, unit * 0.11)
    var inner = roundedRectPolygon(width * 0.19, height * 0.29, width * 0.62, height * 0.42, unit * 0.08)
    ctx.add(drawPolygonFill(ctx.pixi, plate, palette.paper, 0.95, ctx.gradient), { delay: 0.05, span: 0.55, enterDY: height * 0.06 })
    // 圆角矩形是凸的，hatch 裁剪器直接填充——瓣状板就只能放弃
    ctx.add(drawHatchFill(ctx.pixi, inner, buildHatchSpec(ctx.seed, 101, 1.3), palette.tone2, 0.35), { delay: 0.1, span: 0.6, grow: true })
    ctx.add(drawPolygonOutline(ctx.pixi, plate, palette.ink, 3, 0.9), { delay: 0.12, span: 0.5 })
    ctx.add(drawPolygonOutline(ctx.pixi, inner, palette.tone4, 1.2, 0.55), { delay: 0.16, span: 0.5 })
    if (!ctx.showDecor) return
    ctx.add(drawDiscs(ctx.pixi, [
      { x: width * 0.22, y: height * 0.3, radius: unit * 0.016 },
      { x: width * 0.78, y: height * 0.3, radius: unit * 0.016 },
      { x: width * 0.22, y: height * 0.7, radius: unit * 0.016 },
      { x: width * 0.78, y: height * 0.7, radius: unit * 0.016 }
    ], palette.ink, 0.75), { delay: 0.22, span: 0.5 })
  }

  // 柔和光环：出画轮毂伸出的宽放射楔，然后是盘与环
  function haloBurst(ctx) {
    var width = ctx.width
    var height = ctx.height
    var palette = ctx.palette
    var unit = Math.min(width, height)
    var cx = width * (0.44 + temperaHash01(ctx.seed, 13, 103) * 0.12)
    var cy = height * 0.5
    var reach = Math.hypot(width, height) * 0.7
    var wedges = 14
    addFieldC(ctx, palette.tone1)
    // 只有每隔一道的楔：间隙正是让爆发柔和而不晕眩的原因
    for (var index = 0; index < wedges; index += 2) {
      var angle = (index / wedges) * Math.PI * 2 + temperaHash01(ctx.seed, index, 107) * 0.09
      var spread = 0.11
      ctx.add(drawPolygonFill(ctx.pixi, [
        cx, cy,
        cx + Math.cos(angle - spread) * reach, cy + Math.sin(angle - spread) * reach,
        cx + Math.cos(angle + spread) * reach, cy + Math.sin(angle + spread) * reach
      ], palette.tone3, 0.55, ctx.gradient), { delay: 0.04 + index * 0.012, span: 0.6 })
    }
    ctx.add(drawPolygonFill(ctx.pixi, ellipsePolygon(cx, cy, unit * 0.34, unit * 0.34, 48), palette.paper, 0.94, ctx.gradient),
      { delay: 0.14, span: 0.55 })
    // 经圆盘工厂画环而不是描边多边形：它把节点枢在环心上，
    // 光环因此在原地呼吸而不是绕画面原点公转
    ;[[0.34, 3], [0.44, 1.4]].forEach(function (pair, index) {
      ctx.add(drawRings(ctx.pixi, [{ x: cx, y: cy, radius: unit * pair[0] }], palette.ink, pair[1], 0.75),
        { delay: 0.2 + index * 0.06, span: 0.5, drift: true })
    })
  }

  var TEMPERA_CHARM_COMPOSITIONS = {
    'bubble-drift': bubbleDrift,
    'cloud-window': cloudWindow,
    'heart-burst': heartBurst,
    'sparkle-field': sparkleField,
    'petal-arc': petalArc,
    'scallop-band': scallopBand,
    'ribbon-loop': ribbonLoop,
    'round-plate': roundPlate,
    'halo-burst': haloBurst
  }

  // ---------- 镂空族（原版 compositions/temperaApertureCompositions.ts） ----------
  // 冲孔板：一张平涂色调上干净地打穿的洞，外壳的实时背景成为 shot 的主角。
  // 开口的形状就是整个构图，所以这些几乎不带其他几何——
  // 一块被装饰的板会和自己的窗口打架
  //
  // 这里的排版区域都坐在实心色调上，绝不在开口上；原因见 cutout 工具注释。
  // 孔位按 kind 固定而非种子镜像，因为必须避开它们的区域也是固定数据
  function irisHole(ctx) {
    var width = ctx.width
    var height = ctx.height
    var palette = ctx.palette
    var unit = Math.min(width, height)
    var cx = width * 0.68
    var cy = height * 0.42
    var radius = unit * 0.3
    var hole = circlePolygon(cx, cy, radius, 56)
    addCutField(ctx, palette.tone3, [hole])
    addHoleLip(ctx, hole, 3, 0.9, 0.08)
    // 一根从远端伸进来的横杆：开口读作安装好的而不是漂浮的
    ctx.add(drawPolygonFill(ctx.pixi, rectPolygon(-ctx.bleed, cy - unit * 0.035, cx - radius * 0.7 + ctx.bleed, unit * 0.07), palette.tone4, 0.9, ctx.gradient),
      { delay: 0.14, span: 0.55, enterDX: -width * 0.12 })
    if (!ctx.showDecor) return
    ctx.add(drawRings(ctx.pixi, [{ x: cx, y: cy, radius: radius * 1.14 }], palette.tone4, 1.4, 0.6), { delay: 0.2, span: 0.5, drift: true })
  }

  // 横穿板面的一条信箱缝。上下体量是字坐着的地方，
  // 开口因此读作地平线而不是窗
  function slotRail(ctx) {
    var width = ctx.width
    var height = ctx.height
    var palette = ctx.palette
    var bleed = ctx.bleed
    var top = height * 0.22
    var slot = rectPolygon(-bleed, top, width + bleed * 2, height * 0.16)
    addCutField(ctx, palette.tone4, [slot])
    addHoleLip(ctx, slot, 2.4, 0.8, 0.1)
    // 骑在缝上的凸块是重心块；它也是唯一穿过缝的东西
    ctx.add(drawPolygonFill(ctx.pixi, rectPolygon(width * 0.66, top - height * 0.06, width * 0.12, height * 0.28), palette.tone2, 0.95, ctx.gradient),
      { delay: 0.16, span: 0.55, enterDY: -height * 0.1 })
    ctx.add(drawLines(ctx.pixi, [{ x1: -bleed, y1: top + height * 0.22, x2: width + bleed, y2: top + height * 0.22 }], palette.tone2, 1.4, 0.55),
      { delay: 0.22, span: 0.5, enterDX: width * 0.14 })
  }

  // 板两侧的齿孔；它们之间的框就是画面
  function punchRow(ctx) {
    var width = ctx.width
    var height = ctx.height
    var palette = ctx.palette
    var unit = Math.min(width, height)
    var radius = unit * 0.028
    var holes = []
    for (var index = 0; index < 9; index += 1) {
      var x = width * (0.08 + index * 0.105)
      holes.push(circlePolygon(x, height * 0.14, radius, 20))
      holes.push(circlePolygon(x, height * 0.86, radius, 20))
    }
    addCutField(ctx, palette.tone3, holes)
    ;[0.22, 0.78].forEach(function (y, index) {
      ctx.add(drawLines(ctx.pixi, [{ x1: 0, y1: height * y, x2: width, y2: height * y }], palette.tone4, 1.6, 0.6),
        { delay: 0.12 + index * 0.04, span: 0.5, enterDX: (index === 0 ? 1 : -1) * width * 0.12 })
    })
  }

  // 片门：大矩形开口是被曝光的画幅，小孔是拉着它走的输片孔
  function filmGate(ctx) {
    var width = ctx.width
    var height = ctx.height
    var palette = ctx.palette
    var gate = rectPolygon(width * 0.2, height * 0.1, width * 0.6, height * 0.52)
    var holes = [gate]
    for (var index = 0; index < 4; index += 1) {
      var y = height * (0.14 + index * 0.13)
      holes.push(rectPolygon(width * 0.08, y, width * 0.05, height * 0.06))
      holes.push(rectPolygon(width * 0.87, y, width * 0.05, height * 0.06))
    }
    addCutField(ctx, palette.tone4, holes)
    addHoleLip(ctx, gate, 3, 0.9, 0.08)
    ctx.add(drawHatchFill(ctx.pixi, rectPolygon(width * 0.2, height * 0.68, width * 0.6, height * 0.1), buildHatchSpec(ctx.seed, 131, 1.2), palette.tone2, 0.5),
      { delay: 0.18, span: 0.6, grow: true })
  }

  // 干净打穿的十字，位置偏上，字独占下半的体量
  function crossVent(ctx) {
    var width = ctx.width
    var height = ctx.height
    var palette = ctx.palette
    var cx = width * 0.5
    var cy = height * 0.38
    var arm = Math.min(width, height) * 0.3
    var bar = Math.min(width, height) * 0.1
    var cross = [
      cx - bar, cy - arm, cx + bar, cy - arm, cx + bar, cy - bar,
      cx + arm, cy - bar, cx + arm, cy + bar, cx + bar, cy + bar,
      cx + bar, cy + arm, cx - bar, cy + arm, cx - bar, cy + bar,
      cx - arm, cy + bar, cx - arm, cy - bar, cx - bar, cy - bar
    ]
    addCutField(ctx, palette.tone3, [cross])
    addHoleLip(ctx, cross, 2.6, 0.85, 0.1)
    if (!ctx.showDecor) return
    ctx.add(drawRings(ctx.pixi, [{ x: cx, y: cy, radius: arm * 1.24 }], palette.tone4, 1.2, 0.5), { delay: 0.2, span: 0.5 })
  }

  // 百叶：偏离水平的平行缝，向下渐细
  function louvre(ctx) {
    var width = ctx.width
    var height = ctx.height
    var palette = ctx.palette
    var bleed = ctx.bleed
    var holes = []
    for (var index = 0; index < 6; index += 1) {
      var y = height * (0.08 + index * 0.1)
      var lean = height * 0.03
      var thickness = height * (0.05 - index * 0.004)
      holes.push([
        -bleed, y, width + bleed, y - lean,
        width + bleed, y - lean + thickness, -bleed, y + thickness
      ])
    }
    addCutField(ctx, palette.tone4, holes)
    ctx.add(drawPolygonFill(ctx.pixi, rectPolygon(width * 0.1, height * 0.72, width * 0.08, height * 0.2), palette.tone2, 0.9, ctx.gradient),
      { delay: 0.2, span: 0.55, enterDY: height * 0.1 })
  }

  // 玫瑰窗：环被冲成十二段，段间的辐条与圈内的毂仍是板本身。
  // 字骑在毂上——这是全族唯一坐在开口里的区域，
  // 而它成立只因毂从未被切。在圆洞上再画一个圆盘盖住它看起来一样，
  // 却是个谎言：绘制次序的第一次改动就会让字落到裸背景上
  function ringEye(ctx) {
    var width = ctx.width
    var height = ctx.height
    var palette = ctx.palette
    var unit = Math.min(width, height)
    var cx = width * 0.5
    var cy = height * 0.5
    var inner = unit * 0.31
    var outer = unit * 0.44
    var segments = 12
    var gap = 0.03
    var holes = []
    for (var index = 0; index < segments; index += 1) {
      var start = (index / segments) * Math.PI * 2 + gap
      var end = ((index + 1) / segments) * Math.PI * 2 - gap
      holes.push(annularSectorPolygon(cx, cy, inner, outer, start, end, 8))
    }
    addCutField(ctx, palette.tone3, holes)
    ctx.add(drawRings(ctx.pixi, [
      { x: cx, y: cy, radius: inner },
      { x: cx, y: cy, radius: outer }
    ], palette.ink, 2.4, 0.85), { delay: 0.12, span: 0.5 })
  }

  // 沿一侧逐级下落的方形开口，每个比上面的小一号
  function notchStack(ctx) {
    var width = ctx.width
    var height = ctx.height
    var palette = ctx.palette
    var unit = Math.min(width, height)
    var holes = []
    for (var index = 0; index < 4; index += 1) {
      var size = unit * (0.26 - index * 0.05)
      holes.push(rectPolygon(width * (0.6 + index * 0.06), height * (0.1 + index * 0.19), size, size))
    }
    addCutField(ctx, palette.tone4, holes)
    holes.forEach(function (hole, index) { addHoleLip(ctx, hole, 2, 0.75, 0.1 + index * 0.04) })
  }

  // 从上边楔入的楔形。板保住整个下半，那正是字去的地方
  function wedgeGap(ctx) {
    var width = ctx.width
    var height = ctx.height
    var palette = ctx.palette
    var bleed = ctx.bleed
    var apexX = width * (0.4 + temperaHash01(ctx.seed, 3, 137) * 0.2)
    var wedge = [width * 0.1, -bleed, width * 0.92, -bleed, apexX, height * 0.56]
    addCutField(ctx, palette.tone3, [wedge])
    addHoleLip(ctx, wedge, 3, 0.9, 0.08)
    ctx.add(drawLines(ctx.pixi, [{ x1: apexX, y1: height * 0.58, x2: apexX, y2: height + bleed }], palette.tone4, 1.6, 0.6),
      { delay: 0.18, span: 0.5, enterDY: height * 0.12 })
  }

  // 筛：板上渐稀的小孔，背景以一道光梯度而不是一个开口渗进来
  function dotSieve(ctx) {
    var width = ctx.width
    var height = ctx.height
    var palette = ctx.palette
    var unit = Math.min(width, height)
    var holes = []
    for (var row = 0; row < 6; row += 1) {
      // 五列而不是九列：衰减必须赶在排版区域开始之前到零，
  // 否则最后的残余会直接打穿字的半张板
      for (var column = 0; column < 5; column += 1) {
        var density = 1 - column / 4.5
        if (temperaHash01(ctx.seed, row * 9 + column, 139) > density) continue
        var x = width * (0.06 + column * 0.105) + (row % 2 === 0 ? 0 : width * 0.05)
        holes.push(circlePolygon(x, height * (0.1 + row * 0.16), unit * 0.045 * density + unit * 0.012, 18))
      }
    }
    addCutField(ctx, palette.tone2, holes, { alpha: 0.92 })
  }

  var TEMPERA_APERTURE_COMPOSITIONS = {
    'iris-hole': irisHole,
    'slot-rail': slotRail,
    'punch-row': punchRow,
    'film-gate': filmGate,
    'cross-vent': crossVent,
    'louvre-slats': louvre,
    'ring-eye': ringEye,
    'notch-stack': notchStack,
    'wedge-gap': wedgeGap,
    'dot-sieve': dotSieve
  }

  window.FoliaTemperaCompsC = Object.assign(
    {},
    TEMPERA_CHARM_COMPOSITIONS,
    TEMPERA_APERTURE_COMPOSITIONS
  )
})()
