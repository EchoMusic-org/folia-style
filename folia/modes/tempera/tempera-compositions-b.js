// 凝彩模式·构图族二：移植自 folia-major src/components/visualizer/tempera/compositions/
//   temperaPosterCompositions.ts（海报族 10 种：大的倾斜体量）
//   temperaSparseCompositions.ts（稀疏族 8 种：换气段落的近空构图）
//   temperaCinemaCompositions.ts（遮幅族 7 种：真实像素画幅比例的遮幅窗）
//   temperaMonogatariCompositions.ts（物语系过场卡 5 种）
//   temperaMonolithKit.ts（巨构族共用语汇：体量、测量线、肋线、角标、线框痕迹）
// 挂 window.FoliaTemperaCompsB，由 tempera-compositions-d.js 聚合进注册表。
(function () {
  'use strict'

  var Core = window.FoliaTemperaCore
  var Curves = window.FoliaTemperaCurves
  var Shapes = window.FoliaTemperaShapes
  var A = window.FoliaTemperaCompsA
  var temperaHash01 = Core.temperaHash01
  var rectPolygon = Curves.rectPolygon
  var circlePolygon = Curves.circlePolygon
  var diamondPolygon = Curves.diamondPolygon
  var buildHatchSpec = Curves.buildHatchSpec
  var buildWavyPath = Curves.buildWavyPath
  var buildScribblePath = Curves.buildScribblePath
  var buildDotGrid = Curves.buildDotGrid
  var buildCrossRow = Curves.buildCrossRow
  var drawPolygonFill = Shapes.drawPolygonFill
  var drawPolygonOutline = Shapes.drawPolygonOutline
  var drawHatchFill = Shapes.drawHatchFill
  var drawLines = Shapes.drawLines
  var drawPolyline = Shapes.drawPolyline
  var drawSquareMarks = Shapes.drawSquareMarks
  var drawCrossMarks = Shapes.drawCrossMarks

  // ---------- 海报族（原版 compositions/temperaPosterCompositions.ts） ----------
  // 大的倾斜体量。这些是吵闹的构图：一个文字必须与之搏斗的主导实心形状，
  // 这正是反色滤镜显形的方式
  function posterPanel(ctx) {
    var width = ctx.width
    var height = ctx.height
    var palette = ctx.palette
    var poster = ctx.createGroup(-0.06, width / 2, height / 2)
    var solid = diamondPolygon(-width * 0.12, 0, width * 0.42, height * 0.66)
    var hatched = diamondPolygon(width * 0.2, -height * 0.06, width * 0.3, height * 0.48)
    ctx.add(drawPolygonFill(ctx.pixi, solid, palette.ink, 0.92, ctx.gradient), { enterDX: -width * 0.6, span: 0.55 }, poster)
    ctx.add(drawHatchFill(ctx.pixi, hatched, buildHatchSpec(ctx.seed, 41), palette.tone4, 0.7), { delay: 0.08, grow: true, span: 0.55 }, poster)
    ctx.add(drawPolygonOutline(ctx.pixi, hatched, palette.ink, 2, 0.8), { delay: 0.12, span: 0.55 }, poster)
    ctx.add(drawPolyline(
      ctx.pixi,
      buildWavyPath(ctx.seed, 43, -width * 0.6, width * 0.6, height * 0.42, height * 0.02),
      palette.tone4,
      2,
      0.7
    ), { delay: 0.2, enterDY: height * 0.1 }, poster)
  }

  // 按递减尺寸冲出画面的三个实心；字骑在最大的那个上
  function diamondStack(ctx) {
    var width = ctx.width
    var height = ctx.height
    var palette = ctx.palette
    var bleed = ctx.bleed
    ctx.add(drawPolygonFill(ctx.pixi, rectPolygon(-bleed, -bleed, width + bleed * 2, height + bleed * 2), palette.tone1, 0.9, ctx.gradient), { span: 0.5 })
    var tones = [palette.ink, palette.tone4, palette.tone3]
    tones.forEach(function (tone, index) {
      var scale = 1 - index * 0.28
      var cx = width * (0.34 + index * 0.24)
      var cy = height * (0.52 - index * 0.14)
      ctx.add(drawPolygonFill(ctx.pixi, diamondPolygon(cx, cy, width * 0.3 * scale, height * 0.46 * scale), tone, 0.93, ctx.gradient),
        { delay: index * 0.07, span: 0.55, enterDX: width * 0.25, enterDY: -height * 0.12 })
    })
  }

  // 一道宽斜杠横过画面，反方向的反击 hatch 随行
  function slashPoster(ctx) {
    var width = ctx.width
    var height = ctx.height
    var palette = ctx.palette
    var bleed = ctx.bleed
    var lean = height * 0.34
    var band = [
      -bleed, height * 0.24 + lean,
      width + bleed, height * 0.24 - lean,
      width + bleed, height * 0.72 - lean,
      -bleed, height * 0.72 + lean
    ]
    ctx.add(drawPolygonFill(ctx.pixi, rectPolygon(-bleed, -bleed, width + bleed * 2, height + bleed * 2), palette.tone1, 0.9, ctx.gradient), { span: 0.5 })
    ctx.add(drawPolygonFill(ctx.pixi, band, palette.tone4, 0.94, ctx.gradient), { delay: 0.05, span: 0.55, enterDX: -width * 0.4 })
    var spec = buildHatchSpec(ctx.seed, 67)
    spec.angle = Math.PI / 3
    ctx.add(drawHatchFill(ctx.pixi, band, spec, palette.paper, 0.3),
      { delay: 0.1, span: 0.55, grow: true })
    ctx.add(drawPolygonOutline(ctx.pixi, band, palette.ink, 2.2, 0.8), { delay: 0.14, span: 0.5 })
  }

  // 指向画面另一侧的雪佛龙，呼应参考艺术的屋脊纹样
  function arrowWedge(ctx) {
    var width = ctx.width
    var height = ctx.height
    var palette = ctx.palette
    var bleed = ctx.bleed
    var apex = height * (0.24 + temperaHash01(ctx.seed, 3, 71) * 0.14)
    var thickness = height * 0.2
    var chevron = [
      -bleed, height + bleed,
      width * 0.5, apex,
      width + bleed, height + bleed,
      width + bleed, height + bleed,
      width * 0.5, apex + thickness,
      -bleed, height + bleed
    ]
    ctx.add(drawPolygonFill(ctx.pixi, rectPolygon(-bleed, -bleed, width + bleed * 2, height + bleed * 2), palette.tone1, 0.9, ctx.gradient), { span: 0.5 })
    ctx.add(drawPolygonFill(ctx.pixi, [-bleed, height + bleed, width * 0.5, apex, width + bleed, height + bleed], palette.tone4, 0.94, ctx.gradient),
      { delay: 0.05, span: 0.55, enterDY: height * 0.3 })
    var spec = buildHatchSpec(ctx.seed, 73)
    spec.angle = -Math.PI / 4
    ctx.add(drawHatchFill(ctx.pixi, chevron, spec, palette.paper, 0.35),
      { delay: 0.1, span: 0.55, grow: true })
    ctx.add(drawPolyline(ctx.pixi, [-bleed, height * 0.9, width * 0.5, apex - thickness * 0.4, width + bleed, height * 0.9], palette.ink, 2, 0.7),
      { delay: 0.16, span: 0.5, enterDY: -height * 0.1 })
  }

  // 从一条边推进来的单个体量，字留在旁边裸露的纸上
  function edgeBleed(ctx) {
    var width = ctx.width
    var height = ctx.height
    var palette = ctx.palette
    var bleed = ctx.bleed
    var fromLeft = temperaHash01(ctx.seed, 4, 79) > 0.5
    var cover = width * 0.42
    var mass = fromLeft
      ? rectPolygon(-bleed, -bleed, cover + bleed, height + bleed * 2)
      : rectPolygon(width - cover, -bleed, cover + bleed, height + bleed * 2)
    ctx.add(drawPolygonFill(ctx.pixi, rectPolygon(-bleed, -bleed, width + bleed * 2, height + bleed * 2), palette.tone1, 0.9, ctx.gradient), { span: 0.5 })
    ctx.add(drawPolygonFill(ctx.pixi, mass, palette.ink, 0.93, ctx.gradient), { delay: 0.05, span: 0.55, enterDX: (fromLeft ? -1 : 1) * width * 0.4 })
    ctx.add(drawHatchFill(ctx.pixi, mass, buildHatchSpec(ctx.seed, 83), palette.paper, 0.22), { delay: 0.12, span: 0.55, grow: true })
  }

  // 锚在一条边上、填满大半画面的三角形
  function triangleMass(ctx) {
    var width = ctx.width
    var height = ctx.height
    var palette = ctx.palette
    var bleed = ctx.bleed
    var fromLeft = temperaHash01(ctx.seed, 91, 89) > 0.5
    var apexX = fromLeft ? width * 1.02 : -width * 0.02
    var triangle = [
      fromLeft ? -bleed : width + bleed, -bleed,
      fromLeft ? -bleed : width + bleed, height + bleed,
      apexX, height * (0.3 + temperaHash01(ctx.seed, 93, 97) * 0.3)
    ]
    ctx.add(drawPolygonFill(ctx.pixi, rectPolygon(-bleed, -bleed, width + bleed * 2, height + bleed * 2), palette.tone1, 0.9, ctx.gradient), { span: 0.5 })
    ctx.add(drawPolygonFill(ctx.pixi, triangle, palette.tone4, 0.94, ctx.gradient),
      { delay: 0.05, span: 0.55, enterDX: (fromLeft ? -1 : 1) * width * 0.35 })
    ctx.add(drawHatchFill(ctx.pixi, triangle, buildHatchSpec(ctx.seed, 101), palette.paper, 0.24),
      { delay: 0.12, span: 0.55, grow: true })
  }

  // 两条交叠的斜缎带；重叠处色调翻倍
  function ribbonCross(ctx) {
    var width = ctx.width
    var height = ctx.height
    var palette = ctx.palette
    var bleed = ctx.bleed
    var half = height * 0.14
    var lean = height * 0.3
    var ribbon = function (sign) {
      return [
        -bleed, height / 2 + sign * lean - half,
        width + bleed, height / 2 - sign * lean - half,
        width + bleed, height / 2 - sign * lean + half,
        -bleed, height / 2 + sign * lean + half
      ]
    }
    ctx.add(drawPolygonFill(ctx.pixi, rectPolygon(-bleed, -bleed, width + bleed * 2, height + bleed * 2), palette.tone1, 0.9, ctx.gradient), { span: 0.5 })
    ctx.add(drawPolygonFill(ctx.pixi, ribbon(1), palette.tone3, 0.8, ctx.gradient), { delay: 0.05, span: 0.55, enterDX: -width * 0.3 })
    ctx.add(drawPolygonFill(ctx.pixi, ribbon(-1), palette.tone4, 0.8, ctx.gradient), { delay: 0.11, span: 0.55, enterDX: width * 0.3 })
  }

  // 大到只剩肩部在画面里的圆盘
  function halfDisc(ctx) {
    var width = ctx.width
    var height = ctx.height
    var palette = ctx.palette
    var bleed = ctx.bleed
    var fromRight = temperaHash01(ctx.seed, 103, 107) > 0.5
    var radius = Math.hypot(width, height) * 0.62
    var disc = circlePolygon(fromRight ? width + radius * 0.55 : -radius * 0.55, height * 0.5, radius, 64)
    ctx.add(drawPolygonFill(ctx.pixi, rectPolygon(-bleed, -bleed, width + bleed * 2, height + bleed * 2), palette.tone1, 0.9, ctx.gradient), { span: 0.5 })
    ctx.add(drawPolygonFill(ctx.pixi, disc, palette.tone4, 0.94, ctx.gradient),
      { delay: 0.05, span: 0.55, enterDX: (fromRight ? 1 : -1) * width * 0.3 })
    ctx.add(drawPolygonOutline(ctx.pixi, disc, palette.ink, 2, 0.6), { delay: 0.12, span: 0.5 })
  }

  // 三块转过的厚板错位叠放，像掉在桌上的纸
  function stackedSlabs(ctx) {
    var width = ctx.width
    var height = ctx.height
    var palette = ctx.palette
    var bleed = ctx.bleed
    ctx.add(drawPolygonFill(ctx.pixi, rectPolygon(-bleed, -bleed, width + bleed * 2, height + bleed * 2), palette.tone1, 0.9, ctx.gradient), { span: 0.5 })
    var tones = [palette.tone2, palette.tone3, palette.tone4]
    tones.forEach(function (tone, index) {
      var group = ctx.createGroup(-0.09 + index * 0.08, width / 2, height / 2)
      var slab = rectPolygon(-width * (0.42 - index * 0.05), -height * (0.3 - index * 0.03), width * (0.84 - index * 0.1), height * (0.6 - index * 0.06))
      ctx.add(drawPolygonFill(ctx.pixi, slab, tone, 0.93, ctx.gradient),
        { delay: index * 0.07, span: 0.55, enterDX: width * 0.2, enterDY: height * 0.12 }, group)
    })
  }

  // 从相对两条边咬进来的两个楔形，留下一个纸的沙漏
  function wedgePair(ctx) {
    var width = ctx.width
    var height = ctx.height
    var palette = ctx.palette
    var bleed = ctx.bleed
    var waist = width * (0.2 + temperaHash01(ctx.seed, 109, 113) * 0.1)
    ctx.add(drawPolygonFill(ctx.pixi, rectPolygon(-bleed, -bleed, width + bleed * 2, height + bleed * 2), palette.tone1, 0.9, ctx.gradient), { span: 0.5 })
    ctx.add(drawPolygonFill(ctx.pixi, [
      -bleed, -bleed, (width - waist) / 2, height / 2, -bleed, height + bleed
    ], palette.tone4, 0.94, ctx.gradient), { delay: 0.05, span: 0.55, enterDX: -width * 0.25 })
    ctx.add(drawPolygonFill(ctx.pixi, [
      width + bleed, -bleed, (width + waist) / 2, height / 2, width + bleed, height + bleed
    ], palette.tone4, 0.94, ctx.gradient), { delay: 0.11, span: 0.55, enterDX: width * 0.25 })
  }

  var TEMPERA_POSTER_COMPOSITIONS = {
    'poster-panel': posterPanel,
    'diamond-stack': diamondStack,
    'slash-poster': slashPoster,
    'arrow-wedge': arrowWedge,
    'edge-bleed': edgeBleed,
    'triangle-mass': triangleMass,
    'ribbon-cross': ribbonCross,
    'half-disc': halfDisc,
    'stacked-slabs': stackedSlabs,
    'wedge-pair': wedgePair
  }

  // ---------- 稀疏族（原版 compositions/temperaSparseCompositions.ts） ----------
  // 换气段落的近空构图：细线、点场、手绘笔画，
  // 几乎没有色调体量，字读作耳语
  function quietLine(ctx) {
    var width = ctx.width
    var height = ctx.height
    var palette = ctx.palette
    var gridWidth = width * 0.7
    var gridX = (width - gridWidth) / 2
    ;[0.38, 0.5, 0.62].forEach(function (ratio, index) {
      ctx.add(drawPolygonFill(ctx.pixi, rectPolygon(gridX, height * ratio, gridWidth, 1), palette.line, 1, ctx.gradient),
        { delay: index * 0.08, span: 0.6, enterDX: (index % 2 === 0 ? -1 : 1) * width * 0.2 })
    })
    if (!ctx.showDecor) return
    ctx.add(drawPolyline(
      ctx.pixi,
      buildScribblePath(ctx.decor.scribbleSeed, 47, width * 0.2, height * 0.26, Math.min(width, height) * 0.09, 2),
      palette.tone4,
      1.6,
      0.7
    ), { delay: 0.24, span: 0.6 })
    // 草丛：从一个基线点扇出的短笔画
    var tuftX = width * 0.82
    var tuftY = height * 0.74
    ctx.add(drawLines(ctx.pixi, Array.from({ length: 6 }, function (_, index) {
      var lean = (temperaHash01(ctx.decor.scribbleSeed, index, 59) - 0.5) * 34
      return { x1: tuftX + index * 7, y1: tuftY, x2: tuftX + index * 7 + lean, y2: tuftY - 24 - index * 3 }
    }), palette.tone4, 1.4, 0.7), { delay: 0.3, span: 0.55 })
  }

  // 向一条边变薄的点阵；字浮在稀疏的那一半
  function starfieldDots(ctx) {
    var width = ctx.width
    var height = ctx.height
    var palette = ctx.palette
    var bleed = ctx.bleed
    var spacing = Math.max(24, Math.sqrt((width * height) / 900))
    var marks = buildDotGrid(width + bleed, height + bleed, spacing, 2.6)
    var dense = marks.filter(function (mark) { return mark.y > height * 0.45 })
    var sparse = marks.filter(function (mark) { return mark.y <= height * 0.45 && (mark.x + mark.y) % 3 < 1 })
    ctx.add(drawSquareMarks(ctx.pixi, dense, palette.tone4, 0.45), { span: 0.6, enterDY: height * 0.2 })
    ctx.add(drawSquareMarks(ctx.pixi, sparse, palette.tone4, 0.25), { delay: 0.08, span: 0.6, enterDY: -height * 0.15 })
    if (!ctx.showDecor) return
    ctx.add(drawLines(ctx.pixi, [{ x1: -bleed, y1: height * 0.45, x2: width + bleed, y2: height * 0.45 }], palette.tone4, 1.2, 0.5),
      { delay: 0.2, span: 0.5, enterDX: width * 0.2 })
  }

  // 同心起伏线，从紧贴水面之下看到的水面
  function rippleLines(ctx) {
    var width = ctx.width
    var height = ctx.height
    var palette = ctx.palette
    var bleed = ctx.bleed
    var count = 7
    for (var index = 0; index < count; index += 1) {
      var y = height * (0.16 + index * 0.11)
      var amplitude = height * (0.006 + index * 0.004)
      ctx.add(drawPolyline(
        ctx.pixi,
        buildWavyPath(ctx.seed, 89 + index, -bleed, width + bleed, y, amplitude, 26),
        palette.tone4,
        index % 3 === 0 ? 2 : 1.1,
        0.55
      ), { delay: index * 0.045, span: 0.6, enterDX: (index % 2 === 0 ? -1 : 1) * width * 0.15 })
    }
  }

  // 满出血细线格阵；乐句浮在其上
  function hairGrid(ctx) {
    var width = ctx.width
    var height = ctx.height
    var palette = ctx.palette
    var bleed = ctx.bleed
    var columns = 6
    var rows = 4
    var vertical = []
    for (var v = 0; v <= columns; v += 1) {
      vertical.push({ x1: (width / columns) * v, y1: -bleed, x2: (width / columns) * v, y2: height + bleed })
    }
    var horizontal = []
    for (var h = 0; h <= rows; h += 1) {
      horizontal.push({ x1: -bleed, y1: (height / rows) * h, x2: width + bleed, y2: (height / rows) * h })
    }
    ctx.add(drawLines(ctx.pixi, vertical, palette.line, 1, 0.8), { span: 0.6, enterDY: -height * 0.1 })
    ctx.add(drawLines(ctx.pixi, horizontal, palette.line, 1, 0.8), { delay: 0.08, span: 0.6, enterDX: width * 0.1 })
  }

  // 一条页边重规线加几枚对位记号
  function marginRule(ctx) {
    var width = ctx.width
    var height = ctx.height
    var palette = ctx.palette
    var bleed = ctx.bleed
    var fromLeft = temperaHash01(ctx.seed, 121, 127) > 0.5
    var x = fromLeft ? width * 0.12 : width * 0.88
    ctx.add(drawPolygonFill(ctx.pixi, rectPolygon(x - 3, -bleed, 6, height + bleed * 2), palette.tone4, 0.9, ctx.gradient),
      { span: 0.6, enterDY: height * 0.15 })
    if (!ctx.showDecor) return
    ctx.add(drawSquareMarks(
      ctx.pixi,
      [0, 1, 2].map(function (index) {
        return { x: x + (fromLeft ? 22 : -22), y: height * (0.32 + index * 0.18), size: 7, rotation: 0 }
      }),
      palette.tone4,
      0.8
    ), { delay: 0.22, drift: true })
  }

  // 沿一条对角线变薄的点阵
  function dotDrift(ctx) {
    var width = ctx.width
    var height = ctx.height
    var palette = ctx.palette
    var bleed = ctx.bleed
    var spacing = Math.max(22, Math.sqrt((width * height) / 1200))
    var marks = buildDotGrid(width + bleed, height + bleed, spacing, 2.4)
    var span = width + height
    var near = marks.filter(function (mark) { return mark.x + mark.y > span * 0.5 })
    var far = marks.filter(function (mark) { return mark.x + mark.y <= span * 0.5 && (mark.x + mark.y) % 2 < 1 })
    ctx.add(drawSquareMarks(ctx.pixi, near, palette.tone4, 0.5), { span: 0.6, enterDX: width * 0.12 })
    ctx.add(drawSquareMarks(ctx.pixi, far, palette.tone4, 0.24), { delay: 0.08, span: 0.6, enterDX: -width * 0.12 })
  }

  // 圆心出画的同心环，只有弧线穿过画面
  function arcSweep(ctx) {
    var width = ctx.width
    var height = ctx.height
    var palette = ctx.palette
    var cx = width * (temperaHash01(ctx.seed, 131, 137) > 0.5 ? 1.15 : -0.15)
    var cy = height * 1.05
    var base = Math.hypot(width, height) * 0.42
    for (var index = 0; index < 5; index += 1) {
      ctx.add(drawPolygonOutline(
        ctx.pixi,
        circlePolygon(cx, cy, base + index * base * 0.22, 72),
        palette.tone4,
        index % 2 === 0 ? 1.8 : 1,
        0.55
      ), { delay: index * 0.05, span: 0.6, enterDY: height * 0.08 })
    }
  }

  // 几乎裸的纸加一枚小对位记号。一段verse之前的呼吸
  function blankPage(ctx) {
    var width = ctx.width
    var height = ctx.height
    var palette = ctx.palette
    ctx.add(drawLines(ctx.pixi, [
      { x1: width * 0.18, y1: height * 0.7, x2: width * 0.36, y2: height * 0.7 }
    ], palette.line, 1.4, 0.8), { span: 0.6, enterDX: -width * 0.12 })
    if (!ctx.showDecor) return
    ctx.add(drawPolyline(
      ctx.pixi,
      buildScribblePath(ctx.decor.scribbleSeed, 139, width * 0.82, height * 0.26, Math.min(width, height) * 0.06, 2),
      palette.tone4,
      1.4,
      0.6
    ), { delay: 0.28, span: 0.6 })
  }

  var TEMPERA_SPARSE_COMPOSITIONS = {
    'quiet-line': quietLine,
    'starfield-dots': starfieldDots,
    'ripple-lines': rippleLines,
    'hair-grid': hairGrid,
    'margin-rule': marginRule,
    'dot-drift': dotDrift,
    'arc-sweep': arcSweep,
    'blank-page': blankPage
  }

  // ---------- 遮幅族（原版 compositions/temperaCinemaCompositions.ts） ----------
  // 电影遮幅：实心画框中间挖出给定画幅比例的窗。洞是歌词坐着的地方，
  // 四周的色调因此读作遮幅而不是色块——反色滤镜也有一道硬边可以切字
  //
  // fitWindow：在画框内装下给定画幅比例的窗。使用真实像素尺寸而非视口比例，
  // 因为「正方形」的窗在任何显示比例下都必须看起来是方的
  function fitWindow(width, height, aspect, fill) {
    var maxWidth = width * fill
    var maxHeight = height * fill
    var windowWidth = Math.min(maxWidth, maxHeight * aspect)
    var windowHeight = windowWidth / aspect
    return {
      x: (width - windowWidth) / 2,
      y: (height - windowHeight) / 2,
      width: windowWidth,
      height: windowHeight
    }
  }

  // 遮幅画成四根条而不是一块带洞的填充：条保持凸形（hatch 裁剪器需要），
  // 且每根可以带自己的入场
  function addMatte(ctx, hole, tone) {
    var width = ctx.width
    var height = ctx.height
    var bleed = ctx.bleed
    var bars = [
      { polygon: rectPolygon(-bleed, -bleed, width + bleed * 2, hole.y + bleed), enterDX: 0, enterDY: -height * 0.2 },
      { polygon: rectPolygon(-bleed, hole.y + hole.height, width + bleed * 2, height - hole.y - hole.height + bleed), enterDX: 0, enterDY: height * 0.2 },
      { polygon: rectPolygon(-bleed, hole.y, hole.x + bleed, hole.height), enterDX: -width * 0.2, enterDY: 0 },
      { polygon: rectPolygon(hole.x + hole.width, hole.y, width - hole.x - hole.width + bleed, hole.height), enterDX: width * 0.2, enterDY: 0 }
    ]
    bars.forEach(function (bar, index) {
      ctx.add(drawPolygonFill(ctx.pixi, bar.polygon, tone, 0.96, ctx.gradient), {
        delay: index * 0.04,
        span: 0.5,
        enterDX: bar.enterDX,
        enterDY: bar.enterDY
      })
    })
    // 内缘是遮幅的全部意义所在，所以它独占一条线
    ctx.add(drawPolygonOutline(
      ctx.pixi,
      rectPolygon(hole.x, hole.y, hole.width, hole.height),
      ctx.palette.ink,
      1.6,
      0.5
    ), { delay: 0.2, span: 0.5 })
  }

  // 窗内的淡色调，让洞不只是一片裸地面
  function addWindowWash(ctx, hole, alpha) {
    var polygon = rectPolygon(hole.x, hole.y, hole.width, hole.height)
    ctx.add(drawPolygonFill(ctx.pixi, polygon, ctx.palette.tone1, alpha, ctx.gradient), { span: 0.55 })
    ctx.add(drawHatchFill(ctx.pixi, polygon, buildHatchSpec(ctx.seed, 149, 1.5), ctx.palette.tone4, 0.2),
      { delay: 0.1, span: 0.6, grow: true })
  }

  function matte(aspect, fill, washAlpha) {
    if (washAlpha === undefined) washAlpha = 0.35
    return function (ctx) {
      var hole = fitWindow(ctx.width, ctx.height, aspect, fill)
      addWindowWash(ctx, hole, washAlpha)
      addMatte(ctx, hole, ctx.palette.tone4)
      if (!ctx.showDecor) return
      // 遮幅上的对位刻度，与窗缘对齐
      ctx.add(drawLines(ctx.pixi, [
        { x1: hole.x, y1: hole.y - ctx.height * 0.05, x2: hole.x, y2: hole.y - ctx.height * 0.02 },
        { x1: hole.x + hole.width, y1: hole.y + hole.height + ctx.height * 0.02, x2: hole.x + hole.width, y2: hole.y + hole.height + ctx.height * 0.05 }
      ], ctx.palette.paper, 2, 0.6), { delay: 0.26, span: 0.5 })
    }
  }

  // 并排两窗；歌词占更宽的左窗
  function cinemaTwin(ctx) {
    var width = ctx.width
    var height = ctx.height
    var palette = ctx.palette
    var bleed = ctx.bleed
    var inset = height * 0.16
    var gutter = width * 0.04
    var left = { x: width * 0.08, y: inset, width: width * 0.5, height: height - inset * 2 }
    var right = {
      x: left.x + left.width + gutter,
      y: inset + height * 0.1,
      width: width * 0.28,
      height: height - inset * 2 - height * 0.2
    }
    ctx.add(drawPolygonFill(ctx.pixi, rectPolygon(-bleed, -bleed, width + bleed * 2, height + bleed * 2), palette.tone4, 0.96, ctx.gradient),
      { span: 0.5 })
    ;[left, right].forEach(function (hole, index) {
      var polygon = rectPolygon(hole.x, hole.y, hole.width, hole.height)
      ctx.add(drawPolygonFill(ctx.pixi, polygon, palette.tone1, index === 0 ? 0.4 : 0.85, ctx.gradient),
        { delay: index * 0.08, span: 0.55, enterDX: (index === 0 ? -1 : 1) * width * 0.14 })
      ctx.add(drawPolygonOutline(ctx.pixi, polygon, palette.ink, 1.6, 0.5), { delay: 0.16 + index * 0.05, span: 0.5 })
    })
    if (!ctx.showDecor) return
    ctx.add(drawHatchFill(ctx.pixi, rectPolygon(right.x, right.y, right.width, right.height), buildHatchSpec(ctx.seed, 151), palette.tone4, 0.35),
      { delay: 0.24, span: 0.6, grow: true })
  }

  // 略微偏离正方的窗随种子漂移，同一画幅不会每次都完全一致
  function jitteredFill(ctx, base) {
    return base + (temperaHash01(ctx.seed, 157, 163) - 0.5) * 0.06
  }

  var TEMPERA_CINEMA_COMPOSITIONS = {
    'cinema-scope': function (ctx) { return matte(2.39, jitteredFill(ctx, 0.88))(ctx) },
    'cinema-wide': function (ctx) { return matte(1.85, jitteredFill(ctx, 0.84))(ctx) },
    'cinema-academy': function (ctx) { return matte(1.33, jitteredFill(ctx, 0.78))(ctx) },
    'cinema-square': function (ctx) { return matte(1, jitteredFill(ctx, 0.72))(ctx) },
    'cinema-portrait': function (ctx) { return matte(0.75, jitteredFill(ctx, 0.72))(ctx) },
    'cinema-tall': function (ctx) { return matte(0.5625, jitteredFill(ctx, 0.72))(ctx) },
    'cinema-twin': cinemaTwin
  }

  // ---------- 物语系过场卡（原版 compositions/temperaMonogatariCompositions.ts） ----------
  // 物语式的过场卡：一面边到边的平涂，文字就是整幅画面。
  // 它们刻意几乎不带几何——前后 shot 负责干活，卡是两者之间的一拍静默

  // 场面交替取色调阶梯的哪一端，歌内的连续卡读作切换而不是定格
  function addField(ctx, tone) {
    var width = ctx.width
    var height = ctx.height
    var bleed = ctx.bleed
    ctx.add(drawPolygonFill(ctx.pixi, rectPolygon(-bleed, -bleed, width + bleed * 2, height + bleed * 2), tone, 1, ctx.gradient),
      { span: 0.45 })
  }

  function pickField(ctx) {
    return temperaHash01(ctx.seed, 167, 173) > 0.5 ? ctx.palette.tone4 : ctx.palette.tone1
  }

  // 裸卡：平涂，别无他物。文字独自扛起
  function monogatariCard(ctx) {
    addField(ctx, pickField(ctx))
    if (!ctx.showDecor) return
    // 最底部的一条细线，标题卡带页脚规线的做法
    ctx.add(drawLines(ctx.pixi, [
      { x1: ctx.width * 0.12, y1: ctx.height * 0.9, x2: ctx.width * 0.88, y2: ctx.height * 0.9 }
    ], ctx.palette.paper, 1.2, 0.45), { delay: 0.22, span: 0.6, enterDX: ctx.width * 0.15 })
  }

  // 平涂加字下的一道重规线，把卡一分为二
  function monogatariRule(ctx) {
    var width = ctx.width
    var height = ctx.height
    var palette = ctx.palette
    var bleed = ctx.bleed
    addField(ctx, pickField(ctx))
    var y = height * (0.62 + temperaHash01(ctx.seed, 179, 181) * 0.08)
    ctx.add(drawPolygonFill(ctx.pixi, rectPolygon(-bleed, y, width + bleed * 2, height * 0.012), palette.paper, 0.85, ctx.gradient),
      { delay: 0.12, span: 0.55, enterDX: -width * 0.3 })
    if (!ctx.showDecor) return
    ctx.add(drawLines(ctx.pixi, [
      { x1: -bleed, y1: y + height * 0.05, x2: width + bleed, y2: y + height * 0.05 }
    ], palette.paper, 1, 0.35), { delay: 0.2, span: 0.6, enterDX: width * 0.2 })
  }

  // 平涂加一条沿边缘的对比色带，像一册装订好的书页
  function monogatariEdge(ctx) {
    var width = ctx.width
    var height = ctx.height
    var palette = ctx.palette
    var bleed = ctx.bleed
    var field = pickField(ctx)
    addField(ctx, field)
    var band = width * (0.1 + temperaHash01(ctx.seed, 191, 193) * 0.05)
    var fromLeft = temperaHash01(ctx.seed, 197, 199) > 0.5
    var spine = rectPolygon(fromLeft ? -bleed : width - band, -bleed, band + bleed, height + bleed * 2)
    ctx.add(drawPolygonFill(ctx.pixi, spine, field === palette.tone4 ? palette.tone1 : palette.tone4, 0.95, ctx.gradient),
      { delay: 0.1, span: 0.55, enterDX: (fromLeft ? -1 : 1) * width * 0.2 })
    if (!ctx.showDecor) return
    ctx.add(drawHatchFill(ctx.pixi, spine, buildHatchSpec(ctx.seed, 211), palette.paper, 0.2),
      { delay: 0.18, span: 0.6, grow: true })
  }

  // 平涂窄字列：卡读作堆叠的字幕
  function monogatariStack(ctx) {
    var width = ctx.width
    var height = ctx.height
    var palette = ctx.palette
    var bleed = ctx.bleed
    addField(ctx, pickField(ctx))
    var column = width * 0.5
    ctx.add(drawLines(ctx.pixi, [
      { x1: (width - column) / 2, y1: -bleed, x2: (width - column) / 2, y2: height + bleed },
      { x1: (width + column) / 2, y1: -bleed, x2: (width + column) / 2, y2: height + bleed }
    ], palette.paper, 1.1, 0.4), { delay: 0.14, span: 0.6, enterDY: height * 0.12 })
  }

  // 吵的那张：阶梯远端的场面、最大的字、一排记号
  function monogatariFlash(ctx) {
    var width = ctx.width
    var height = ctx.height
    var palette = ctx.palette
    addField(ctx, palette.tone4)
    if (!ctx.showDecor) return
    ctx.add(drawCrossMarks(
      ctx.pixi,
      buildCrossRow(ctx.seed, 223, width * 0.1, height * 0.18, 4, width * 0.05, 10),
      palette.paper,
      2.4,
      0.6
    ), { delay: 0.2, span: 0.5, enterDX: -width * 0.1 })
  }

  var TEMPERA_MONOGATARI_COMPOSITIONS = {
    'monogatari-card': monogatariCard,
    'monogatari-rule': monogatariRule,
    'monogatari-edge': monogatariEdge,
    'monogatari-stack': monogatariStack,
    'monogatari-flash': monogatariFlash
  }

  // ---------- 巨构族共用语汇（原版 compositions/temperaMonolithKit.ts） ----------
  // monolith 与 terrain 两族共用的粗野主义语汇：一面巨大的哑光体量、
  // 几条直穿整幅画的细线、一面排线的条纹、几枚小的测量记号。
  // 体量独自扛起 shot，所以这里的一切都刻意细——
  // 被装饰围起来的巨构不再是巨构
  //
  // 每个体量至少一侧跑出画外。四边都在画面里的实心读作纸上的物件；
  // 被画框裁掉的同一样东西读作大到装不下——这就是这一族的全部效果

  // options: { alpha, delay, span, enterDX, enterDY, edge, edgeWidth }
  function addMass(ctx, polygon, color, options) {
    options = options || {}
    ctx.add(drawPolygonFill(ctx.pixi, polygon, color, options.alpha !== undefined ? options.alpha : 0.95, ctx.gradient), {
      delay: options.delay !== undefined ? options.delay : 0.04,
      span: options.span !== undefined ? options.span : 0.6,
      enterDX: options.enterDX !== undefined ? options.enterDX : 0,
      enterDY: options.enterDY !== undefined ? options.enterDY : 0
    })
    if (options.edge === false) return
    ctx.add(drawPolygonOutline(ctx.pixi, polygon, ctx.palette.ink, options.edgeWidth !== undefined ? options.edgeWidth : 2.4, 0.8), {
      delay: (options.delay !== undefined ? options.delay : 0.04) + 0.06,
      span: 0.5,
      enterDX: (options.enterDX !== undefined ? options.enterDX : 0) * 0.6,
      enterDY: (options.enterDY !== undefined ? options.enterDY : 0) * 0.6
    })
  }

  // 体量站立的满出血地面
  function addGround(ctx, color, alpha) {
    if (alpha === undefined) alpha = 0.94
    ctx.add(
      drawPolygonFill(ctx.pixi, rectPolygon(-ctx.bleed, -ctx.bleed, ctx.width + ctx.bleed * 2, ctx.height + ctx.bleed * 2), color, alpha, ctx.gradient),
      { span: 0.5 }
    )
  }

  // 体量一个面上的排线条纹。多边形必须凸——buildHatchLines 按边半平面裁剪——
  // 所以调用方传体量的一块凸切片，而不是通常带阶梯或缺口的体量本身
  function addFaceRuling(ctx, face, salt, color, alpha) {
    if (color === undefined) color = ctx.palette.tone4
    if (alpha === undefined) alpha = 0.5
    ctx.add(drawHatchFill(ctx.pixi, face, buildHatchSpec(ctx.seed, salt, 0.7), color, alpha), {
      delay: 0.16,
      span: 0.65,
      grow: true
    })
  }

  // 两三条以浅角度直穿整幅画的细线。这些构图里唯一无视体量的东西，
  // 而这正是体量获得尺度的原因：一条不碰任何东西却穿过一切的线
  function addSurveyLines(ctx, count, salt) {
    if (count === undefined) count = 3
    if (salt === undefined) salt = 211
    var width = ctx.width
    var height = ctx.height
    var bleed = ctx.bleed
    var lines = []
    for (var index = 0; index < Math.max(1, count); index += 1) {
      var anchor = height * (0.16 + ((index * 0.31 + (ctx.seed % 7) * 0.04) % 0.7))
      var lean = height * (index % 2 === 0 ? 0.22 : -0.16)
      lines.push({
        x1: -bleed,
        y1: anchor - lean,
        x2: width + bleed,
        y2: anchor + lean
      })
    }
    ctx.add(drawLines(ctx.pixi, lines, ctx.palette.paper, 1, 0.45), {
      delay: 0.2 + (salt % 3) * 0.02,
      span: 0.7,
      enterDX: width * 0.2
    })
  }

  // 两个对角的测量记号：为一件大到无法对位的东西做对位
  function addCornerTicks(ctx) {
    var width = ctx.width
    var height = ctx.height
    var palette = ctx.palette
    var inset = Math.min(width, height) * 0.06
    var arm = Math.min(width, height) * 0.05
    ;[[1, 1], [-1, -1]].forEach(function (s, index) {
      var sx = s[0]
      var sy = s[1]
      var x = sx > 0 ? inset : width - inset
      var y = sy > 0 ? inset : height - inset
      ctx.add(drawLines(ctx.pixi, [
        { x1: x, y1: y, x2: x + sx * arm, y2: y },
        { x1: x, y1: y, x2: x, y2: y + sy * arm }
      ], palette.paper, 1.6, 0.6), { delay: 0.26 + index * 0.04, span: 0.5 })
    })
  }

  // 停在角落的一段松散线框——一处并不存在的形状的测量痕迹
  function addWireTrace(ctx, cx, cy, radius) {
    // 定位组内的局部坐标：drift 绕节点自身原点缩放和旋转，
    // 按绝对坐标画的痕迹会绕画面原点公转
    var group = ctx.createGroup(0, cx, cy)
    ctx.add(drawPolyline(ctx.pixi, buildScribblePath(ctx.decor.scribbleSeed, 199, 0, 0, radius, 1), ctx.palette.paper, 1.2, 0.4), {
      delay: 0.3,
      span: 0.6,
      drift: true
    }, group)
  }

  window.FoliaTemperaCompsB = Object.assign(
    {
      // 巨构族共用语汇（供 compositions-d 引用）
      addMass: addMass,
      addGround: addGround,
      addFaceRuling: addFaceRuling,
      addSurveyLines: addSurveyLines,
      addCornerTicks: addCornerTicks,
      addWireTrace: addWireTrace
    },
    TEMPERA_POSTER_COMPOSITIONS,
    TEMPERA_SPARSE_COMPOSITIONS,
    TEMPERA_CINEMA_COMPOSITIONS,
    TEMPERA_MONOGATARI_COMPOSITIONS
  )
})()
