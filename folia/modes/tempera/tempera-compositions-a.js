// 凝彩模式·构图族一：移植自 folia-major src/components/visualizer/tempera/compositions/
//   temperaCutout.ts（镂空族共用工具：冲孔场、孔沿、通道轴）
//   temperaSplitCompositions.ts（分割族 13 种）
//   temperaBandCompositions.ts（色带族 9 种）
//   temperaFrameCompositions.ts（框窗族 10 种）
// 挂 window.FoliaTemperaCompsA，由 tempera-compositions-d.js 聚合进注册表。
(function () {
  'use strict'

  var Core = window.FoliaTemperaCore
  var Curves = window.FoliaTemperaCurves
  var Shapes = window.FoliaTemperaShapes
  var temperaHash01 = Core.temperaHash01
  var rectPolygon = Curves.rectPolygon
  var rotatePolygon = Curves.rotatePolygon
  var circlePolygon = Curves.circlePolygon
  var diamondPolygon = Curves.diamondPolygon
  var buildHatchSpec = Curves.buildHatchSpec
  var buildCrossRow = Curves.buildCrossRow
  var buildDotRow = Curves.buildDotRow
  var buildDotGrid = Curves.buildDotGrid
  var buildWavyPath = Curves.buildWavyPath
  var buildScribblePath = Curves.buildScribblePath
  var drawPolygonFill = Shapes.drawPolygonFill
  var drawPolygonOutline = Shapes.drawPolygonOutline
  var drawPolygonFillWithHoles = Shapes.drawPolygonFillWithHoles
  var drawHatchFill = Shapes.drawHatchFill
  var drawLines = Shapes.drawLines
  var drawPolyline = Shapes.drawPolyline
  var drawCrossMarks = Shapes.drawCrossMarks
  var drawSquareMarks = Shapes.drawSquareMarks
  var drawConcentricDiamonds = Shapes.drawConcentricDiamonds

  // ---------- 镂空族共用工具（原版 compositions/temperaCutout.ts） ----------
  // 三支在色调场上打洞的族的共用管线。洞是真的透明——Pixi 画布跑在
  // backgroundAlpha: 0 上——所以露出的是外壳的实时背景层，只被场景的纸雾罩着
  // （纸雾按段落构建，无法按 shot 挖）。
  //
  // 一条规矩管住所有镂空构图：**歌词绝不压在洞上。** 反色滤镜读的是 Pixi 渲染目标，
  // 而 DOM 背景在 WebGL 之外——洞上滤镜只看见淡淡的纸雾便选了 ink，
  // 这个 ink 却要在任意背景上自己活下去。把字放在实心色调上；洞是画面，不是纸

  // 每个构图都从这块满出血矩形出发
  function fieldPolygon(ctx) {
    return rectPolygon(
      -ctx.bleed,
      -ctx.bleed,
      ctx.width + ctx.bleed * 2,
      ctx.height + ctx.bleed * 2
    )
  }

  // 满出血色调 + 打穿的 holes。孔的描边是独立节点
  // options: { alpha, delay, span }
  function addCutField(ctx, color, holes, options) {
    options = options || {}
    ctx.add(
      drawPolygonFillWithHoles(ctx.pixi, fieldPolygon(ctx), holes, color, options.alpha !== undefined ? options.alpha : 0.94, ctx.gradient),
      { delay: options.delay !== undefined ? options.delay : 0, span: options.span !== undefined ? options.span : 0.5 }
    )
  }

  // 孔四周的墨沿。它让镂空读作冲孔板而不是渲染里的缺口，
  // 并给反色滤镜一个紧贴开口的边
  function addHoleLip(ctx, hole, width, alpha, delay) {
    if (width === undefined) width = 2.4
    if (alpha === undefined) alpha = 0.85
    if (delay === undefined) delay = 0.1
    ctx.add(drawPolygonOutline(ctx.pixi, hole, ctx.palette.ink, width, alpha), { delay: delay, span: 0.5 })
  }

  // 以 (cx, cy) 为中心、沿 angle 长 length、横宽 width 的矩形
  function axisRect(cx, cy, length, width, angle) {
    return rotatePolygon(
      rectPolygon(cx - length / 2, cy - width / 2, length, width),
      cx,
      cy,
      angle
    )
  }

  // flow 角，向其自身的竖直轴收回一半。
  //
  // 通道必须平行于行进方向，否则交接不再读作一条连续走廊——但通道也很长，
  // 原始倾角（最多约 14°）会让它的两端在 720px 画面上横走约 90px，
  // 足以把开口滑到字底下。取一半倾角保住方向、横移减半；
  // 一次交接滑动上的残余失配只有几个像素，看不见
  function channelAxis(ctx) {
    var axis = (Math.sin(ctx.flowAngle) >= 0 ? 1 : -1) * Math.PI / 2
    return axis + (ctx.flowAngle - axis) * 0.5
  }

  // 通道轴横向的单位向量，永远指向画面的 +x 半边。
  //
  // flow 以纵向为主，但有些 shot 朝上、有些朝下，原始垂线会在 shot 之间翻面。
  // 排版区域是固定数据，建立在原始垂线上的通道偏移有时就会落在字底下。
  // 归一化符号让「偏移 +n」在所有 shot 里都意味着「向右」
  function acrossFlow(angle) {
    var across = angle + Math.PI / 2
    var sign = Math.cos(across) >= 0 ? 1 : -1
    return { x: Math.cos(across) * sign, y: Math.sin(across) * sign }
  }

  // 从画面中心沿通道轴横偏 offset 的中心点
  function acrossPoint(ctx, offset) {
    var across = acrossFlow(channelAxis(ctx))
    return { x: ctx.width / 2 + across.x * offset, y: ctx.height / 2 + across.y * offset }
  }

  // 从画面中心沿轴走 distance、横偏 offset 的点
  function flowPoint(ctx, distance, offset) {
    var base = acrossPoint(ctx, offset)
    var angle = channelAxis(ctx)
    return {
      x: base.x + Math.cos(angle) * distance,
      y: base.y + Math.sin(angle) * distance
    }
  }

  // 一个形状无论 flow 角如何都要跑多远才能两端出画
  function flowSpan(ctx) {
    return Math.hypot(ctx.width, ctx.height) * 1.6
  }

  // ---------- 分割族（原版 compositions/temperaSplitCompositions.ts） ----------
  // 把画面切成平色调面板的构图。反色滤镜对它们的反应最强烈：
  // 跨在面板边上的字在笔画中途翻色
  var Panel = null // 仅注释：面板 = { polygon, tone, enterDX, enterDY }

  // 面板带错峰铺入，并在其中一块上盖一道 hatch，分割因此不读作平面向量图
  function addPanels(ctx, panels, hatchIndex) {
    var hatch = buildHatchSpec(ctx.seed, 5)
    panels.forEach(function (panel, index) {
      ctx.add(drawPolygonFill(ctx.pixi, panel.polygon, panel.tone, 0.96, ctx.gradient), {
        delay: index * 0.05,
        span: 0.5,
        enterDX: panel.enterDX,
        enterDY: panel.enterDY
      })
      if (index !== hatchIndex) return
      ctx.add(drawHatchFill(ctx.pixi, panel.polygon, hatch, ctx.palette.tone4, 0.5), {
        delay: index * 0.05 + 0.06,
        span: 0.5,
        grow: true
      })
    })
  }

  function addSeam(ctx, polygon, delay) {
    ctx.add(drawPolygonFill(ctx.pixi, polygon, ctx.palette.ink, 0.85, ctx.gradient), { delay: delay, span: 0.5 })
  }

  function duoSplit(ctx) {
    var width = ctx.width
    var height = ctx.height
    var palette = ctx.palette
    var bleed = ctx.bleed
    var horizontal = temperaHash01(ctx.seed, 1, 3) > 0.5
    addPanels(ctx, horizontal
      ? [
        { polygon: rectPolygon(-bleed, -bleed, width + bleed * 2, height * 0.52 + bleed), tone: palette.tone1, enterDX: 0, enterDY: -height * 0.55 },
        { polygon: rectPolygon(-bleed, height * 0.52, width + bleed * 2, height * 0.48 + bleed), tone: palette.tone3, enterDX: 0, enterDY: height * 0.55 }
      ]
      : [
        { polygon: rectPolygon(-bleed, -bleed, width * 0.5 + bleed, height + bleed * 2), tone: palette.tone1, enterDX: -width * 0.5, enterDY: 0 },
        { polygon: rectPolygon(width * 0.5, -bleed, width * 0.5 + bleed, height + bleed * 2), tone: palette.tone3, enterDX: width * 0.5, enterDY: 0 }
      ], 0)
    addSeam(ctx, horizontal
      ? rectPolygon(-bleed, height * 0.52 - 1.5, width + bleed * 2, 3)
      : rectPolygon(width * 0.5 - 1.5, -bleed, 3, height + bleed * 2), 0.16)
  }

  // 四块色调面板在字下交会。每个象限从自己的角落进场
  function quadSplit(ctx) {
    var width = ctx.width
    var height = ctx.height
    var palette = ctx.palette
    var bleed = ctx.bleed
    var splitX = width * (0.42 + temperaHash01(ctx.seed, 2, 7) * 0.16)
    var splitY = height * (0.42 + temperaHash01(ctx.seed, 3, 11) * 0.16)
    addPanels(ctx, [
      { polygon: rectPolygon(-bleed, -bleed, splitX + bleed, splitY + bleed), tone: palette.tone1, enterDX: -width * 0.3, enterDY: -height * 0.3 },
      { polygon: rectPolygon(splitX, -bleed, width - splitX + bleed, splitY + bleed), tone: palette.tone4, enterDX: width * 0.3, enterDY: -height * 0.3 },
      { polygon: rectPolygon(-bleed, splitY, splitX + bleed, height - splitY + bleed), tone: palette.tone3, enterDX: -width * 0.3, enterDY: height * 0.3 },
      { polygon: rectPolygon(splitX, splitY, width - splitX + bleed, height - splitY + bleed), tone: palette.tone2, enterDX: width * 0.3, enterDY: height * 0.3 }
    ], 3)
    addSeam(ctx, rectPolygon(splitX - 1.5, -bleed, 3, height + bleed * 2), 0.2)
    addSeam(ctx, rectPolygon(-bleed, splitY - 1.5, width + bleed * 2, 3), 0.24)
  }

  function triColumn(ctx) {
    var width = ctx.width
    var height = ctx.height
    var palette = ctx.palette
    var bleed = ctx.bleed
    var edge = width * (0.26 + temperaHash01(ctx.seed, 4, 13) * 0.06)
    addPanels(ctx, [
      { polygon: rectPolygon(-bleed, -bleed, edge + bleed, height + bleed * 2), tone: palette.tone1, enterDX: -width * 0.25, enterDY: 0 },
      { polygon: rectPolygon(edge, -bleed, width - edge * 2, height + bleed * 2), tone: palette.tone4, enterDX: 0, enterDY: -height * 0.3 },
      { polygon: rectPolygon(width - edge, -bleed, edge + bleed, height + bleed * 2), tone: palette.tone1, enterDX: width * 0.25, enterDY: 0 }
    ], 0)
  }

  function thirdsStack(ctx) {
    var width = ctx.width
    var height = ctx.height
    var palette = ctx.palette
    var bleed = ctx.bleed
    var band = height * 0.34
    addPanels(ctx, [
      { polygon: rectPolygon(-bleed, -bleed, width + bleed * 2, band + bleed), tone: palette.tone2, enterDX: -width * 0.2, enterDY: 0 },
      { polygon: rectPolygon(-bleed, band, width + bleed * 2, band), tone: palette.tone4, enterDX: width * 0.2, enterDY: 0 },
      { polygon: rectPolygon(-bleed, band * 2, width + bleed * 2, height - band * 2 + bleed), tone: palette.tone1, enterDX: -width * 0.2, enterDY: 0 }
    ], 0)
  }

  // 对角象限共享色调，字跨过中心时颜色交替
  function checkerQuad(ctx) {
    var width = ctx.width
    var height = ctx.height
    var palette = ctx.palette
    var bleed = ctx.bleed
    var splitX = width * 0.5
    var splitY = height * 0.5
    addPanels(ctx, [
      { polygon: rectPolygon(-bleed, -bleed, splitX + bleed, splitY + bleed), tone: palette.tone4, enterDX: 0, enterDY: -height * 0.35 },
      { polygon: rectPolygon(splitX, -bleed, width - splitX + bleed, splitY + bleed), tone: palette.tone1, enterDX: 0, enterDY: -height * 0.35 },
      { polygon: rectPolygon(-bleed, splitY, splitX + bleed, height - splitY + bleed), tone: palette.tone1, enterDX: 0, enterDY: height * 0.35 },
      { polygon: rectPolygon(splitX, splitY, width - splitX + bleed, height - splitY + bleed), tone: palette.tone4, enterDX: 0, enterDY: height * 0.35 }
    ], 1)
  }

  function cornerWedge(ctx) {
    var width = ctx.width
    var height = ctx.height
    var palette = ctx.palette
    var bleed = ctx.bleed
    var fromLeft = temperaHash01(ctx.seed, 5, 17) > 0.5
    var apexX = fromLeft ? width * 0.78 : width * 0.22
    addPanels(ctx, [
      { polygon: rectPolygon(-bleed, -bleed, width + bleed * 2, height + bleed * 2), tone: palette.tone1, enterDX: 0, enterDY: 0 },
      {
        polygon: fromLeft
          ? [-bleed, -bleed, apexX, -bleed, -bleed, height + bleed]
          : [width + bleed, -bleed, apexX, -bleed, width + bleed, height + bleed],
        tone: palette.tone4,
        enterDX: fromLeft ? -width * 0.4 : width * 0.4,
        enterDY: 0
      }
    ], 1)
  }

  function diagonalHalves(ctx) {
    var width = ctx.width
    var height = ctx.height
    var palette = ctx.palette
    var bleed = ctx.bleed
    var lean = height * (0.2 + temperaHash01(ctx.seed, 6, 19) * 0.3)
    addPanels(ctx, [
      { polygon: [-bleed, -bleed, width + bleed, -bleed, width + bleed, lean, -bleed, height - lean], tone: palette.tone2, enterDX: 0, enterDY: -height * 0.4 },
      { polygon: [-bleed, height - lean, width + bleed, lean, width + bleed, height + bleed, -bleed, height + bleed], tone: palette.tone4, enterDX: 0, enterDY: height * 0.4 }
    ], 1)
  }

  // 两条重轴把画面切成四份；字坐在交点上
  function crossAxis(ctx) {
    var width = ctx.width
    var height = ctx.height
    var palette = ctx.palette
    var bleed = ctx.bleed
    var barX = width * 0.11
    var barY = height * 0.13
    ctx.add(drawPolygonFill(ctx.pixi, rectPolygon(-bleed, -bleed, width + bleed * 2, height + bleed * 2), palette.tone1, 0.9, ctx.gradient), { span: 0.5 })
    ctx.add(drawPolygonFill(ctx.pixi, rectPolygon((width - barX) / 2, -bleed, barX, height + bleed * 2), palette.tone4, 0.95),
      { delay: 0.06, span: 0.5, enterDY: -height * 0.5 })
    ctx.add(drawPolygonFill(ctx.pixi, rectPolygon(-bleed, (height - barY) / 2, width + bleed * 2, barY), palette.tone3, 0.95),
      { delay: 0.12, span: 0.5, enterDX: width * 0.5 })
  }

  // 互相错过去的两半；它们错开的那一阶就是构图
  function offsetHalves(ctx) {
    var width = ctx.width
    var height = ctx.height
    var palette = ctx.palette
    var bleed = ctx.bleed
    var step = height * (0.06 + temperaHash01(ctx.seed, 7, 23) * 0.06)
    var seam = width * 0.48
    addPanels(ctx, [
      { polygon: rectPolygon(-bleed, -bleed, seam + bleed, height * 0.5 + step + bleed), tone: palette.tone1, enterDX: -width * 0.3, enterDY: 0 },
      { polygon: rectPolygon(seam, -bleed, width - seam + bleed, height * 0.5 - step + bleed), tone: palette.tone3, enterDX: width * 0.3, enterDY: 0 },
      { polygon: rectPolygon(-bleed, height * 0.5 + step, seam + bleed, height * 0.5 - step + bleed), tone: palette.tone4, enterDX: -width * 0.2, enterDY: 0 },
      { polygon: rectPolygon(seam, height * 0.5 - step, width - seam + bleed, height * 0.5 + step + bleed), tone: palette.tone2, enterDX: width * 0.2, enterDY: 0 }
    ], 2)
  }

  // 沿对角线列队的四块，一块比一块深
  function stairBlocks(ctx) {
    var width = ctx.width
    var height = ctx.height
    var palette = ctx.palette
    var bleed = ctx.bleed
    var tones = [palette.tone1, palette.tone2, palette.tone3, palette.tone4]
    ctx.add(drawPolygonFill(ctx.pixi, rectPolygon(-bleed, -bleed, width + bleed * 2, height + bleed * 2), palette.tone1, 0.9, ctx.gradient), { span: 0.5 })
    tones.forEach(function (tone, index) {
      var left = width * (0.06 + index * 0.2)
      var top = height * (0.1 + index * 0.16)
      ctx.add(drawPolygonFill(ctx.pixi, rectPolygon(left, top, width * 0.3, height * 0.34), tone, 0.94, ctx.gradient),
        { delay: index * 0.06, span: 0.5, enterDX: -width * 0.2, enterDY: height * 0.12 })
    })
  }

  // 两块重体量让出一条亮缝；歌词站在缝里
  function pillarGap(ctx) {
    var width = ctx.width
    var height = ctx.height
    var palette = ctx.palette
    var bleed = ctx.bleed
    var gap = width * (0.26 + temperaHash01(ctx.seed, 8, 29) * 0.08)
    var side = (width - gap) / 2
    addPanels(ctx, [
      { polygon: rectPolygon(-bleed, -bleed, side + bleed, height + bleed * 2), tone: palette.tone4, enterDX: -width * 0.3, enterDY: 0 },
      { polygon: rectPolygon(width - side, -bleed, side + bleed, height + bleed * 2), tone: palette.tone4, enterDX: width * 0.3, enterDY: 0 }
    ], 1)
  }

  // 两轴都刻意偏心的象限
  function cornerQuad(ctx) {
    var width = ctx.width
    var height = ctx.height
    var palette = ctx.palette
    var bleed = ctx.bleed
    var splitX = width * (0.6 + temperaHash01(ctx.seed, 9, 31) * 0.12)
    var splitY = height * (0.62 + temperaHash01(ctx.seed, 10, 37) * 0.1)
    addPanels(ctx, [
      { polygon: rectPolygon(-bleed, -bleed, splitX + bleed, splitY + bleed), tone: palette.tone2, enterDX: 0, enterDY: -height * 0.25 },
      { polygon: rectPolygon(splitX, -bleed, width - splitX + bleed, splitY + bleed), tone: palette.tone4, enterDX: width * 0.25, enterDY: 0 },
      { polygon: rectPolygon(-bleed, splitY, splitX + bleed, height - splitY + bleed), tone: palette.tone1, enterDX: -width * 0.25, enterDY: 0 },
      { polygon: rectPolygon(splitX, splitY, width - splitX + bleed, height - splitY + bleed), tone: palette.tone3, enterDX: 0, enterDY: height * 0.25 }
    ], 0)
  }

  // 填满画面一侧的细条交替堆叠
  function sliverStack(ctx) {
    var width = ctx.width
    var height = ctx.height
    var palette = ctx.palette
    var bleed = ctx.bleed
    var fromLeft = temperaHash01(ctx.seed, 11, 41) > 0.5
    var slabWidth = width * 0.46
    var left = fromLeft ? -bleed : width - slabWidth
    ctx.add(drawPolygonFill(ctx.pixi, rectPolygon(-bleed, -bleed, width + bleed * 2, height + bleed * 2), palette.tone1, 0.9, ctx.gradient), { span: 0.5 })
    var count = 9
    var sliver = (height + bleed * 2) / count
    for (var index = 0; index < count; index += 1) {
      if (index % 2 === 1) continue
      ctx.add(drawPolygonFill(
        ctx.pixi,
        rectPolygon(left, -bleed + sliver * index, slabWidth + bleed, sliver),
        palette.tone4,
        0.92,
        ctx.gradient
      ), { delay: index * 0.02, span: 0.5, enterDX: (fromLeft ? -1 : 1) * width * 0.2 })
    }
  }

  var TEMPERA_SPLIT_COMPOSITIONS = {
    'duo-split': duoSplit,
    'quad-split': quadSplit,
    'tri-column': triColumn,
    'thirds-stack': thirdsStack,
    'checker-quad': checkerQuad,
    'corner-wedge': cornerWedge,
    'diagonal-halves': diagonalHalves,
    'cross-axis': crossAxis,
    'offset-halves': offsetHalves,
    'stair-blocks': stairBlocks,
    'pillar-gap': pillarGap,
    'corner-quad': cornerQuad,
    'sliver-stack': sliverStack
  }

  // ---------- 色带族（原版 compositions/temperaBandCompositions.ts） ----------
  // 水平地层。配上 Tempera 的纵向 flow，它们读作纵深：画面穿过各带下潜，
  // shot 交接因此读作俯冲而不是切换
  function bandStrip(ctx) {
    var width = ctx.width
    var height = ctx.height
    var palette = ctx.palette
    var bleed = ctx.bleed
    var bandY = height * 0.37
    var bandHeight = height * 0.3
    ctx.add(drawPolygonFill(ctx.pixi, rectPolygon(-bleed, bandY, width + bleed * 2, bandHeight), palette.tone3, 0.96, ctx.gradient),
      { span: 0.55, enterDX: -width * 0.5 })
    // 导引线贴着带缘；歌词在两线之间的中色调上反色
    ctx.add(drawLines(ctx.pixi, [
      { x1: -bleed, y1: bandY - 10, x2: width + bleed, y2: bandY - 22 },
      { x1: -bleed, y1: bandY + bandHeight + 22, x2: width + bleed, y2: bandY + bandHeight + 10 }
    ], palette.tone4, 1.4, 0.75), { delay: 0.12, enterDX: width * 0.25 })

    if (!ctx.showDecor) return
    ctx.add(drawCrossMarks(ctx.pixi, buildCrossRow(ctx.seed, 17, width * 0.06, bandY - height * 0.16, 4, width * 0.055, 9), palette.ink, 2, 0.8),
      { delay: 0.2, span: 0.5 })
    ctx.add(drawSquareMarks(ctx.pixi, buildDotRow(ctx.seed, 19, width * 0.94, bandY + bandHeight + height * 0.06, 3, height * 0.05, 6), palette.ink, 0.75),
      { delay: 0.26, drift: true })
  }

  // 水线：上浅下密，两界之间一道波浪弯月
  function horizonBand(ctx) {
    var width = ctx.width
    var height = ctx.height
    var palette = ctx.palette
    var bleed = ctx.bleed
    var waterline = height * (0.5 + temperaHash01(ctx.seed, 1, 23) * 0.12)
    ctx.add(drawPolygonFill(ctx.pixi, rectPolygon(-bleed, -bleed, width + bleed * 2, waterline + bleed), palette.tone1, 0.94, ctx.gradient),
      { span: 0.55, enterDY: -height * 0.3 })
    var water = rectPolygon(-bleed, waterline, width + bleed * 2, height - waterline + bleed)
    ctx.add(drawPolygonFill(ctx.pixi, water, palette.tone3, 0.95, ctx.gradient), { delay: 0.05, span: 0.55, enterDY: height * 0.3 })
    var spec = buildHatchSpec(ctx.seed, 29)
    spec.angle = 0
    ctx.add(drawHatchFill(ctx.pixi, water, spec, palette.tone4, 0.55),
      { delay: 0.1, span: 0.55, grow: true })
    ctx.add(drawPolyline(ctx.pixi, buildWavyPath(ctx.seed, 31, -bleed, width + bleed, waterline, height * 0.012, 30), palette.ink, 2.2, 0.85),
      { delay: 0.16, span: 0.5 })
  }

  // 向画面底部越来越密的地层
  function deepDive(ctx) {
    var width = ctx.width
    var height = ctx.height
    var palette = ctx.palette
    var bleed = ctx.bleed
    var tones = [palette.tone1, palette.tone2, palette.tone3, palette.tone4]
    var bandHeight = (height + bleed * 2) / tones.length
    tones.forEach(function (tone, index) {
      var top = -bleed + bandHeight * index
      ctx.add(drawPolygonFill(ctx.pixi, rectPolygon(-bleed, top, width + bleed * 2, bandHeight + 1), tone, 0.95, ctx.gradient),
        { delay: index * 0.06, span: 0.55, enterDY: height * 0.3 })
      if (index === 0) return
      ctx.add(drawPolyline(ctx.pixi, buildWavyPath(ctx.seed, 37 + index, -bleed, width + bleed, top, height * 0.008, 24), palette.paper, 1.6, 0.5),
        { delay: index * 0.06 + 0.05, span: 0.5 })
    })
  }

  // 密度坡而不是离散面板：同一 hatch 角、渐紧的间距
  function toneRamp(ctx) {
    var width = ctx.width
    var height = ctx.height
    var palette = ctx.palette
    var bleed = ctx.bleed
    var spec = buildHatchSpec(ctx.seed, 41)
    ctx.add(drawPolygonFill(ctx.pixi, rectPolygon(-bleed, -bleed, width + bleed * 2, height + bleed * 2), palette.tone1, 0.92, ctx.gradient), { span: 0.5 })
    var steps = 4
    for (var index = 0; index < steps; index += 1) {
      var columnWidth = (width + bleed * 2) / steps
      var column = rectPolygon(-bleed + columnWidth * index, -bleed, columnWidth, height + bleed * 2)
      var columnSpec = { angle: spec.angle, spacing: spec.spacing * (1.6 - index * 0.32), width: spec.width }
      ctx.add(drawHatchFill(ctx.pixi, column, columnSpec, palette.tone4, 0.6),
        { delay: index * 0.06, span: 0.55, grow: true })
    }
  }

  // 两条轨道夹一道亮缝；歌词坐在缝里
  function doubleBand(ctx) {
    var width = ctx.width
    var height = ctx.height
    var palette = ctx.palette
    var bleed = ctx.bleed
    var slot = height * (0.2 + temperaHash01(ctx.seed, 51, 43) * 0.08)
    var rail = height * 0.3
    var top = (height - slot) / 2 - rail
    ctx.add(drawPolygonFill(ctx.pixi, rectPolygon(-bleed, top, width + bleed * 2, rail), palette.tone3, 0.95, ctx.gradient),
      { span: 0.55, enterDX: -width * 0.4 })
    ctx.add(drawPolygonFill(ctx.pixi, rectPolygon(-bleed, top + rail + slot, width + bleed * 2, rail), palette.tone4, 0.95, ctx.gradient),
      { delay: 0.07, span: 0.55, enterDX: width * 0.4 })
  }

  // 一条转离水平的带，穿过两侧边缘
  function tiltBand(ctx) {
    var width = ctx.width
    var height = ctx.height
    var palette = ctx.palette
    var bleed = ctx.bleed
    var lean = height * (0.14 + temperaHash01(ctx.seed, 53, 47) * 0.14)
    var half = height * 0.17
    var band = [
      -bleed, height / 2 + lean - half,
      width + bleed, height / 2 - lean - half,
      width + bleed, height / 2 - lean + half,
      -bleed, height / 2 + lean + half
    ]
    ctx.add(drawPolygonFill(ctx.pixi, rectPolygon(-bleed, -bleed, width + bleed * 2, height + bleed * 2), palette.tone1, 0.9, ctx.gradient), { span: 0.5 })
    ctx.add(drawPolygonFill(ctx.pixi, band, palette.tone4, 0.95, ctx.gradient), { delay: 0.06, span: 0.55, enterDX: -width * 0.35 })
    var spec = buildHatchSpec(ctx.seed, 59)
    spec.angle = Math.PI / 2
    ctx.add(drawHatchFill(ctx.pixi, band, spec, palette.paper, 0.3),
      { delay: 0.12, span: 0.55, grow: true })
  }

  // 贴住上下边缘的重轨，中间留空
  function edgeRails(ctx) {
    var width = ctx.width
    var height = ctx.height
    var palette = ctx.palette
    var bleed = ctx.bleed
    var rail = height * (0.16 + temperaHash01(ctx.seed, 61, 53) * 0.06)
    ctx.add(drawPolygonFill(ctx.pixi, rectPolygon(-bleed, -bleed, width + bleed * 2, rail + bleed), palette.tone3, 0.94, ctx.gradient),
      { span: 0.55, enterDY: -height * 0.2 })
    ctx.add(drawPolygonFill(ctx.pixi, rectPolygon(-bleed, height - rail, width + bleed * 2, rail + bleed), palette.tone3, 0.94, ctx.gradient),
      { delay: 0.06, span: 0.55, enterDY: height * 0.2 })
    if (!ctx.showDecor) return
    ctx.add(drawLines(ctx.pixi, [
      { x1: -bleed, y1: rail + 8, x2: width + bleed, y2: rail + 8 },
      { x1: -bleed, y1: height - rail - 8, x2: width + bleed, y2: height - rail - 8 }
    ], palette.tone4, 1.2, 0.6), { delay: 0.16, span: 0.5, enterDX: width * 0.2 })
  }

  // 一整面 hatch 向一条边收紧的色调——色调墙，不是带
  function gradientWall(ctx) {
    var width = ctx.width
    var height = ctx.height
    var palette = ctx.palette
    var bleed = ctx.bleed
    var spec = buildHatchSpec(ctx.seed, 67)
    var downward = temperaHash01(ctx.seed, 71, 59) > 0.5
    ctx.add(drawPolygonFill(ctx.pixi, rectPolygon(-bleed, -bleed, width + bleed * 2, height + bleed * 2), palette.tone2, 0.94, ctx.gradient), { span: 0.5 })
    var steps = 5
    var bandHeight = height / steps
    for (var index = 0; index < steps; index += 1) {
      var rank = downward ? index : steps - 1 - index
      var top = bandHeight * index - (index === 0 ? bleed : 0)
      var bottom = bandHeight * (index + 1) + (index === steps - 1 ? bleed : 0)
      var stepSpec = { angle: spec.angle, spacing: spec.spacing * (1.9 - rank * 0.34), width: spec.width }
      ctx.add(drawHatchFill(
        ctx.pixi,
        rectPolygon(-bleed, top, width + bleed * 2, bottom - top),
        stepSpec,
        palette.tone4,
        0.55
      ), { delay: index * 0.05, span: 0.55, grow: true })
    }
  }

  // 阶地：每一带都比上面一带更靠里起步
  function terrace(ctx) {
    var width = ctx.width
    var height = ctx.height
    var palette = ctx.palette
    var bleed = ctx.bleed
    var tones = [palette.tone1, palette.tone2, palette.tone3, palette.tone4]
    var bandHeight = height / tones.length
    ctx.add(drawPolygonFill(ctx.pixi, rectPolygon(-bleed, -bleed, width + bleed * 2, height + bleed * 2), palette.tone1, 0.9, ctx.gradient), { span: 0.5 })
    tones.forEach(function (tone, index) {
      var left = width * index * 0.14 - bleed
      var top = bandHeight * index - (index === 0 ? bleed : 0)
      var bottom = bandHeight * (index + 1) + (index === tones.length - 1 ? bleed : 1)
      ctx.add(drawPolygonFill(ctx.pixi, rectPolygon(left, top, width + bleed * 2 - left - bleed, bottom - top), tone, 0.94, ctx.gradient),
        { delay: index * 0.06, span: 0.55, enterDX: -width * 0.25 })
    })
  }

  var TEMPERA_BAND_COMPOSITIONS = {
    'band-strip': bandStrip,
    'horizon-band': horizonBand,
    'deep-dive': deepDive,
    'tone-ramp': toneRamp,
    'double-band': doubleBand,
    'tilt-band': tiltBand,
    'edge-rails': edgeRails,
    'gradient-wall': gradientWall,
    'terrace': terrace
  }

  // ---------- 框窗族（原版 compositions/temperaFrameCompositions.ts） ----------
  // 描边窗。它们把字安在一个安静的口袋里，让四周的色调干活，
  // 所以段落需要呼吸时切到这一族
  function frameWindow(ctx) {
    var width = ctx.width
    var height = ctx.height
    var palette = ctx.palette
    var cx = width / 2
    var cy = height / 2
    var rx = width * 0.42
    var ry = height * 0.44
    var innerSpec = buildHatchSpec(ctx.seed, 23, 1.4)
    ctx.add(drawHatchFill(ctx.pixi, diamondPolygon(cx, cy, rx * 0.78, ry * 0.78), innerSpec, palette.tone2, 0.45),
      { grow: true, span: 0.6 })
    ctx.add(drawConcentricDiamonds(ctx.pixi, cx, cy, rx, ry, 3, palette.ink, 0.9),
      { delay: 0.08, enterDY: height * 0.06, span: 0.55 })

    if (!ctx.showDecor) return
    ctx.add(drawCrossMarks(ctx.pixi, buildCrossRow(ctx.seed, 29, width * 0.08, height * 0.14, 3, width * 0.045, 8), palette.tone4, 1.8, 0.85), { delay: 0.22 })
    ctx.add(drawSquareMarks(ctx.pixi, buildDotRow(ctx.seed, 37, width * 0.92, height * 0.62, 4, height * 0.06, 7), palette.tone4, 0.8), { delay: 0.28 })
  }

  // 两个错位矩形：字坐在一个之内、压着另一个的边
  function doubleFrame(ctx) {
    var width = ctx.width
    var height = ctx.height
    var palette = ctx.palette
    var bleed = ctx.bleed
    var offset = width * 0.05
    var box = rectPolygon(width * 0.16, height * 0.2, width * 0.68, height * 0.6)
    var shifted = rectPolygon(width * 0.16 + offset, height * 0.2 + offset * 0.6, width * 0.68, height * 0.6)
    ctx.add(drawPolygonFill(ctx.pixi, rectPolygon(-bleed, -bleed, width + bleed * 2, height + bleed * 2), palette.tone1, 0.9, ctx.gradient), { span: 0.5 })
    ctx.add(drawPolygonFill(ctx.pixi, shifted, palette.tone3, 0.8, ctx.gradient), { delay: 0.06, span: 0.55, enterDX: offset * 3 })
    ctx.add(drawHatchFill(ctx.pixi, shifted, buildHatchSpec(ctx.seed, 43), palette.tone4, 0.4), { delay: 0.1, span: 0.55, grow: true })
    ctx.add(drawPolygonOutline(ctx.pixi, box, palette.ink, 3.5, 0.9), { delay: 0.14, span: 0.5, enterDY: -height * 0.08 })
  }

  function circleWindow(ctx) {
    var width = ctx.width
    var height = ctx.height
    var palette = ctx.palette
    var bleed = ctx.bleed
    var radius = Math.min(width, height) * 0.34
    var circle = circlePolygon(width / 2, height / 2, radius)
    ctx.add(drawPolygonFill(ctx.pixi, rectPolygon(-bleed, -bleed, width + bleed * 2, height + bleed * 2), palette.tone3, 0.92, ctx.gradient), { span: 0.5 })
    ctx.add(drawHatchFill(ctx.pixi, rectPolygon(-bleed, -bleed, width + bleed * 2, height + bleed * 2), buildHatchSpec(ctx.seed, 47), palette.tone4, 0.4),
      { delay: 0.04, span: 0.6, grow: true })
    ctx.add(drawPolygonFill(ctx.pixi, circle, palette.paper, 0.95, ctx.gradient), { delay: 0.08, span: 0.55 })
    ctx.add(drawPolygonOutline(ctx.pixi, circle, palette.ink, 3, 0.9), { delay: 0.14, span: 0.5 })
    if (!ctx.showDecor) return
    ctx.add(drawPolygonOutline(ctx.pixi, circlePolygon(width / 2, height / 2, radius * 1.12), palette.ink, 1.2, 0.55), { delay: 0.2, drift: true })
  }

  // 一侧的阶梯式括号：读作页边规线而不是封闭的盒子
  function ladderFrame(ctx) {
    var width = ctx.width
    var height = ctx.height
    var palette = ctx.palette
    var bleed = ctx.bleed
    var left = width * 0.14
    ctx.add(drawPolygonFill(ctx.pixi, rectPolygon(-bleed, -bleed, width + bleed * 2, height + bleed * 2), palette.tone1, 0.9, ctx.gradient), { span: 0.5 })
    var steps = 5
    for (var index = 0; index < steps; index += 1) {
      var y = height * (0.18 + index * 0.14)
      var run = width * (0.06 + index * 0.03)
      ctx.add(drawLines(ctx.pixi, [
        { x1: left, y1: y, x2: left + run, y2: y },
        { x1: left, y1: y, x2: left, y2: y + height * 0.14 }
      ], palette.tone4, index % 2 === 0 ? 3 : 1.4, 0.85), { delay: index * 0.05, span: 0.5, enterDX: -width * 0.1 })
    }
    ctx.add(drawLines(ctx.pixi, [{ x1: width * 0.9, y1: -bleed, x2: width * 0.9, y2: height + bleed }], palette.tone4, 1.4, 0.6),
      { delay: 0.28, span: 0.5, enterDY: height * 0.2 })
  }

  function cornerBrackets(ctx) {
    var width = ctx.width
    var height = ctx.height
    var palette = ctx.palette
    var bleed = ctx.bleed
    var inset = Math.min(width, height) * 0.12
    var arm = Math.min(width, height) * 0.16
    ctx.add(drawPolygonFill(ctx.pixi, rectPolygon(-bleed, -bleed, width + bleed * 2, height + bleed * 2), palette.tone2, 0.9, ctx.gradient), { span: 0.5 })
    var corners = [
      [inset, inset, 1, 1],
      [width - inset, inset, -1, 1],
      [inset, height - inset, 1, -1],
      [width - inset, height - inset, -1, -1]
    ]
    corners.forEach(function (corner, index) {
      var x = corner[0]
      var y = corner[1]
      var sx = corner[2]
      var sy = corner[3]
      ctx.add(drawLines(ctx.pixi, [
        { x1: x, y1: y, x2: x + sx * arm, y2: y },
        { x1: x, y1: y, x2: x, y2: y + sy * arm }
      ], palette.ink, 3.5, 0.9), { delay: index * 0.05, span: 0.5, enterDX: sx * width * 0.06, enterDY: sy * height * 0.06 })
    })
    if (!ctx.showDecor) return
    var dotted = temperaHash01(ctx.seed, 2, 53) > 0.5
    ctx.add(dotted
      ? drawSquareMarks(ctx.pixi, buildDotRow(ctx.seed, 59, width * 0.5, height * 0.16, 3, width * 0.03, 6, 0), palette.tone4, 0.8)
      : drawCrossMarks(ctx.pixi, buildCrossRow(ctx.seed, 61, width * 0.44, height * 0.84, 3, width * 0.04, 7), palette.tone4, 1.8, 0.8),
      { delay: 0.24, drift: true })
  }

  // 一个淡填的内嵌矩形：托住一个乐句最安静的方式
  function insetBox(ctx) {
    var width = ctx.width
    var height = ctx.height
    var palette = ctx.palette
    var bleed = ctx.bleed
    var box = rectPolygon(width * 0.14, height * 0.2, width * 0.72, height * 0.6)
    ctx.add(drawPolygonFill(ctx.pixi, rectPolygon(-bleed, -bleed, width + bleed * 2, height + bleed * 2), palette.tone1, 0.9, ctx.gradient), { span: 0.5 })
    ctx.add(drawPolygonFill(ctx.pixi, box, palette.tone3, 0.55, ctx.gradient), { delay: 0.05, span: 0.55, enterDY: height * 0.06 })
    ctx.add(drawPolygonOutline(ctx.pixi, box, palette.ink, 2.4, 0.85), { delay: 0.1, span: 0.5 })
  }

  // 一对相向的括号而不是封闭的盒子；乐句坐在双颚之间
  function bracketPair(ctx) {
    var width = ctx.width
    var height = ctx.height
    var palette = ctx.palette
    var bleed = ctx.bleed
    var inset = width * 0.16
    var arm = width * 0.09
    var top = height * 0.26
    var bottom = height * 0.74
    ctx.add(drawPolygonFill(ctx.pixi, rectPolygon(-bleed, -bleed, width + bleed * 2, height + bleed * 2), palette.tone2, 0.9, ctx.gradient), { span: 0.5 })
    ;[1, -1].forEach(function (side, index) {
      var x = side === 1 ? inset : width - inset
      ctx.add(drawLines(ctx.pixi, [
        { x1: x, y1: top, x2: x + side * arm, y2: top },
        { x1: x, y1: top, x2: x, y2: bottom },
        { x1: x, y1: bottom, x2: x + side * arm, y2: bottom }
      ], palette.ink, 4, 0.9), { delay: index * 0.07, span: 0.5, enterDX: side * width * 0.08 })
    })
  }

  // 圆顶窗：骑在矩形上的半圆盘
  function archWindow(ctx) {
    var width = ctx.width
    var height = ctx.height
    var palette = ctx.palette
    var bleed = ctx.bleed
    var radius = width * 0.24
    var cx = width / 2
    var shoulder = height * 0.42
    ctx.add(drawPolygonFill(ctx.pixi, rectPolygon(-bleed, -bleed, width + bleed * 2, height + bleed * 2), palette.tone3, 0.92, ctx.gradient), { span: 0.5 })
    var arch = circlePolygon(cx, shoulder, radius, 48)
    var body = rectPolygon(cx - radius, shoulder, radius * 2, height * 0.4)
    ctx.add(drawPolygonFill(ctx.pixi, arch, palette.paper, 0.95, ctx.gradient), { delay: 0.05, span: 0.55, enterDY: -height * 0.08 })
    ctx.add(drawPolygonFill(ctx.pixi, body, palette.paper, 0.95, ctx.gradient), { delay: 0.05, span: 0.55, enterDY: height * 0.08 })
    ctx.add(drawPolygonOutline(ctx.pixi, arch, palette.ink, 2.4, 0.8), { delay: 0.12, span: 0.5 })
    ctx.add(drawPolygonOutline(ctx.pixi, body, palette.ink, 2.4, 0.8), { delay: 0.12, span: 0.5 })
  }

  // 细线 3x3 格阵；歌词横穿中间行
  function gridCells(ctx) {
    var width = ctx.width
    var height = ctx.height
    var palette = ctx.palette
    var bleed = ctx.bleed
    ctx.add(drawPolygonFill(ctx.pixi, rectPolygon(-bleed, -bleed, width + bleed * 2, height + bleed * 2), palette.tone1, 0.9, ctx.gradient), { span: 0.5 })
    var left = width * 0.12
    var top = height * 0.18
    var cellWidth = (width * 0.76) / 3
    var cellHeight = (height * 0.64) / 3
    for (var row = 0; row < 3; row += 1) {
      for (var column = 0; column < 3; column += 1) {
        var cell = rectPolygon(left + cellWidth * column, top + cellHeight * row, cellWidth, cellHeight)
        var index = row * 3 + column
        if (row === 1 && column === 1) {
          ctx.add(drawPolygonFill(ctx.pixi, cell, palette.tone4, 0.75, ctx.gradient), { delay: index * 0.03, span: 0.5 })
        }
        ctx.add(drawPolygonOutline(ctx.pixi, cell, palette.tone4, 1.2, 0.6), { delay: index * 0.03, span: 0.5 })
      }
    }
  }

  // 圆盘加窄杆：剪影读作色调上抠出的钥匙孔
  function keyhole(ctx) {
    var width = ctx.width
    var height = ctx.height
    var palette = ctx.palette
    var bleed = ctx.bleed
    var radius = Math.min(width, height) * 0.19
    var cx = width / 2
    var cy = height * 0.36
    ctx.add(drawPolygonFill(ctx.pixi, rectPolygon(-bleed, -bleed, width + bleed * 2, height + bleed * 2), palette.tone4, 0.94, ctx.gradient), { span: 0.5 })
    var head = circlePolygon(cx, cy, radius, 48)
    var shaft = rectPolygon(cx - radius * 0.55, cy, radius * 1.1, height * 0.46)
    ctx.add(drawPolygonFill(ctx.pixi, head, palette.paper, 0.96, ctx.gradient), { delay: 0.05, span: 0.55 })
    ctx.add(drawPolygonFill(ctx.pixi, shaft, palette.paper, 0.96, ctx.gradient), { delay: 0.08, span: 0.55, enterDY: height * 0.1 })
    ctx.add(drawPolygonOutline(ctx.pixi, head, palette.ink, 2, 0.7), { delay: 0.14, span: 0.5 })
  }

  var TEMPERA_FRAME_COMPOSITIONS = {
    'frame-window': frameWindow,
    'double-frame': doubleFrame,
    'circle-window': circleWindow,
    'ladder-frame': ladderFrame,
    'corner-brackets': cornerBrackets,
    'inset-box': insetBox,
    'bracket-pair': bracketPair,
    'arch-window': archWindow,
    'grid-cells': gridCells,
    'keyhole': keyhole
  }

  window.FoliaTemperaCompsA = Object.assign(
    {
      // 镂空族共用工具（供 compositions-b/c/d 引用）
      fieldPolygon: fieldPolygon,
      addCutField: addCutField,
      addHoleLip: addHoleLip,
      axisRect: axisRect,
      channelAxis: channelAxis,
      acrossFlow: acrossFlow,
      acrossPoint: acrossPoint,
      flowPoint: flowPoint,
      flowSpan: flowSpan
    },
    TEMPERA_SPLIT_COMPOSITIONS,
    TEMPERA_BAND_COMPOSITIONS,
    TEMPERA_FRAME_COMPOSITIONS
  )
})()
