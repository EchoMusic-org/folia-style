// 凝彩模式·构图族四：移植自 folia-major src/components/visualizer/tempera/compositions/
//   temperaSignalCompositions.ts（仪表盘族 10 种）
//   temperaCorridorCompositions.ts（走廊族 10 种）
//   temperaMonolithCompositions.ts（巨构族 10 种）
//   temperaTerrainCompositions.ts（地形族 10 种）
//   temperaCompositions.ts（构图注册表聚合 + 全 kind 共享的两层叠层）
// 挂 window.FoliaTemperaCompositions，tempera-shapes.js 的 buildTemperaBlocks 在
// 构建每个 shot 时调用其 drawTemperaComposition。
(function () {
  'use strict'

  var Core = window.FoliaTemperaCore
  var Curves = window.FoliaTemperaCurves
  var Shapes = window.FoliaTemperaShapes
  var A = window.FoliaTemperaCompsA
  var B = window.FoliaTemperaCompsB
  var temperaHash01 = Core.temperaHash01
  var rectPolygon = Curves.rectPolygon
  var circlePolygon = Curves.circlePolygon
  var roundedRectPolygon = Curves.roundedRectPolygon
  var rotatePolygon = Curves.rotatePolygon
  var annularSectorPolygon = Curves.annularSectorPolygon
  var buildHatchSpec = Curves.buildHatchSpec
  var buildScribblePath = Curves.buildScribblePath
  var drawPolygonFill = Shapes.drawPolygonFill
  var drawPolygonFillWithHoles = Shapes.drawPolygonFillWithHoles
  var drawPolygonOutline = Shapes.drawPolygonOutline
  var drawHatchFill = Shapes.drawHatchFill
  var drawLines = Shapes.drawLines
  var drawPolyline = Shapes.drawPolyline
  var drawRings = Shapes.drawRings
  var addCutField = A.addCutField
  var addHoleLip = A.addHoleLip
  var axisRect = A.axisRect
  var channelAxis = A.channelAxis
  var acrossPoint = A.acrossPoint
  var flowPoint = A.flowPoint
  var flowSpan = A.flowSpan
  var addMass = B.addMass
  var addGround = B.addGround
  var addFaceRuling = B.addFaceRuling
  var addSurveyLines = B.addSurveyLines
  var addCornerTicks = B.addCornerTicks
  var addWireTrace = B.addWireTrace

  // ---------- 仪表盘族（原版 compositions/temperaSignalCompositions.ts） ----------
  // 仪表盘：硬几何装饰——规线、刻度、括号、重复板条——围着一个字与之共享画面的
  // 重心块。装饰刻意克制而不张扬；它读作印刷图示，
  // 而重心块是画面里唯一被允许喧哗的东西
  //
  // 若干 kind 把开口打在块自身上而不是场面上，洞随形状走而不是躲在它后面

  function addFieldS(ctx, color, alpha) {
    if (alpha === undefined) alpha = 0.92
    var width = ctx.width
    var height = ctx.height
    var bleed = ctx.bleed
    ctx.add(
      drawPolygonFill(ctx.pixi, rectPolygon(-bleed, -bleed, width + bleed * 2, height + bleed * 2), color, alpha, ctx.gradient),
      { span: 0.5 }
    )
  }

  // 十字准星：满出血规线、加框的中心、角刻度。交点下的实心块是字站的地方
  function sightMark(ctx) {
    var width = ctx.width
    var height = ctx.height
    var palette = ctx.palette
    var bleed = ctx.bleed
    var cx = width * 0.5
    var cy = height * 0.5
    addFieldS(ctx, palette.tone1)
    ctx.add(drawLines(ctx.pixi, [
      { x1: -bleed, y1: cy, x2: width + bleed, y2: cy },
      { x1: cx, y1: -bleed, x2: cx, y2: height + bleed }
    ], palette.tone4, 1.4, 0.6), { delay: 0.04, span: 0.55, enterDX: width * 0.1 })
    ctx.add(drawPolygonFill(ctx.pixi, rectPolygon(width * 0.24, height * 0.36, width * 0.52, height * 0.28), palette.tone3, 0.94, ctx.gradient),
      { delay: 0.1, span: 0.55, enterDY: height * 0.06 })
    ctx.add(drawPolygonOutline(ctx.pixi, rectPolygon(width * 0.2, height * 0.32, width * 0.6, height * 0.36), palette.ink, 2.4, 0.85),
      { delay: 0.16, span: 0.5 })
    if (!ctx.showDecor) return
    // 角刻度，各一臂，指向方框
    ;[[0.2, 0.32, 1, 1], [0.8, 0.32, -1, 1], [0.2, 0.68, 1, -1], [0.8, 0.68, -1, -1]].forEach(function (c, index) {
      var x = width * c[0]
      var y = height * c[1]
      var sx = c[2]
      var sy = c[3]
      ctx.add(drawLines(ctx.pixi, [
        { x1: x, y1: y, x2: x + sx * width * 0.04, y2: y },
        { x1: x, y1: y, x2: x, y2: y + sy * height * 0.05 }
      ], palette.ink, 3, 0.8), { delay: 0.2 + index * 0.03, span: 0.5 })
    })
  }

  // 表盘：实心环、周围的刻度、一支重指针。毂留实心给字
  function dialScale(ctx) {
    var width = ctx.width
    var height = ctx.height
    var palette = ctx.palette
    var unit = Math.min(width, height)
    var cx = width * 0.5
    var cy = height * 0.5
    addFieldS(ctx, palette.tone2)
    // 画出来的环，不是挖了洞的盘：毂要托字，必须是不透明的场面，
    // 而不是一个碰巧后面有东西的开口
    ctx.add(drawPolygonFill(
      ctx.pixi,
      annularSectorPolygon(cx, cy, unit * 0.34, unit * 0.44, 0, Math.PI * 2 - 0.006, 60),
      palette.tone4,
      0.92,
      ctx.gradient
    ), { delay: 0.05, span: 0.6 })
    var ticks = []
    for (var t = 0; t < 24; t += 1) {
      var angle = (t / 24) * Math.PI * 2
      var inner = unit * (t % 6 === 0 ? 0.46 : 0.475)
      ticks.push({
        x1: cx + Math.cos(angle) * inner,
        y1: cy + Math.sin(angle) * inner,
        x2: cx + Math.cos(angle) * unit * 0.5,
        y2: cy + Math.sin(angle) * unit * 0.5
      })
    }
    ctx.add(drawLines(ctx.pixi, ticks, palette.ink, 1.6, 0.7), { delay: 0.14, span: 0.55 })
    var pointer = 0.4 + temperaHash01(ctx.seed, 5, 149) * 0.5
    ctx.add(drawPolygonFill(ctx.pixi, axisRect(
      cx + Math.cos(pointer * Math.PI * 2) * unit * 0.2,
      cy + Math.sin(pointer * Math.PI * 2) * unit * 0.2,
      unit * 0.4,
      unit * 0.035,
      pointer * Math.PI * 2
    ), palette.ink, 0.9), { delay: 0.2, span: 0.5 })
  }

  // 沿画面重复的人字纹，其中一道反色：重复让交接隐形，
  // 那个异类是视线落下的地方
  function chevronRun(ctx) {
    var width = ctx.width
    var height = ctx.height
    var palette = ctx.palette
    var bleed = ctx.bleed
    var focus = 2
    addFieldS(ctx, palette.tone1)
    for (var index = 0; index < 5; index += 1) {
      var y = height * (0.02 + index * 0.24)
      var rise = height * 0.12
      var thickness = height * 0.07
      var chevron = [
        -bleed, y, width * 0.5, y - rise, width + bleed, y,
        width + bleed, y + thickness, width * 0.5, y - rise + thickness, -bleed, y + thickness
      ]
      ctx.add(drawPolygonFill(ctx.pixi, chevron, index === focus ? palette.tone4 : palette.tone3, index === focus ? 0.95 : 0.7, ctx.gradient),
        { delay: index * 0.04, span: 0.55, enterDY: -height * 0.12 })
    }
  }

  // 贴住一条边的计数列，长记号是重心元素
  function tallyColumn(ctx) {
    var width = ctx.width
    var height = ctx.height
    var palette = ctx.palette
    var x = width * 0.82
    addFieldS(ctx, palette.tone1)
    var marks = []
    for (var index = 0; index < 11; index += 1) {
      var long = index % 4 === 0
      marks.push({
        x1: x,
        y1: height * (0.1 + index * 0.075),
        x2: x + width * (long ? 0.12 : 0.06),
        y2: height * (0.1 + index * 0.075)
      })
    }
    ctx.add(drawLines(ctx.pixi, marks, palette.tone4, 2.4, 0.75), { delay: 0.06, span: 0.6, enterDX: width * 0.1 })
    ctx.add(drawPolygonFill(ctx.pixi, rectPolygon(x - width * 0.02, height * 0.4, width * 0.16, height * 0.12), palette.tone4, 0.95, ctx.gradient),
      { delay: 0.16, span: 0.55, enterDX: width * 0.14 })
    ctx.add(drawLines(ctx.pixi, [{ x1: x, y1: height * 0.06, x2: x, y2: height * 0.92 }], palette.ink, 1.6, 0.6), { delay: 0.2, span: 0.5 })
  }

  // 细线格阵，一格被填、两格被干净打穿
  function gridFocus(ctx) {
    var width = ctx.width
    var height = ctx.height
    var palette = ctx.palette
    var left = width * 0.08
    var top = height * 0.12
    var cellWidth = (width * 0.84) / 4
    var cellHeight = (height * 0.76) / 3
    var cell = function (column, row) {
      return rectPolygon(left + cellWidth * column, top + cellHeight * row, cellWidth, cellHeight)
    }
    addCutField(ctx, palette.tone2, [cell(0, 0), cell(3, 2)])
    addHoleLip(ctx, cell(0, 0), 2, 0.7, 0.1)
    addHoleLip(ctx, cell(3, 2), 2, 0.7, 0.14)
    ctx.add(drawPolygonFill(ctx.pixi, cell(3, 0), palette.tone4, 0.95, ctx.gradient), { delay: 0.08, span: 0.55, enterDX: width * 0.08 })
    var lines = []
    for (var column = 0; column <= 4; column += 1) {
      lines.push({ x1: left + cellWidth * column, y1: top, x2: left + cellWidth * column, y2: top + cellHeight * 3 })
    }
    for (var row = 0; row <= 3; row += 1) {
      lines.push({ x1: left, y1: top + cellHeight * row, x2: left + cellWidth * 4, y2: top + cellHeight * row })
    }
    ctx.add(drawLines(ctx.pixi, lines, palette.tone4, 1.2, 0.6), { delay: 0.16, span: 0.55 })
  }

  // 贯穿画面的重轴，轴身上钻一个孔、两端各一个端块。
  // 洞与杆一起走，不跟它背后的场面走
  function axisCaps(ctx) {
    var width = ctx.width
    var height = ctx.height
    var palette = ctx.palette
    var unit = Math.min(width, height)
    var cx = width * 0.5
    var cy = height * 0.42
    var bar = axisRect(cx, cy, flowSpan(ctx), unit * 0.22, ctx.flowAngle)
    // 孔同时从场面上切。只切杆的话，露出来的是场面而不是背景——
    // 洞只有在背后什么都不剩时才是窗
    var port = circlePolygon(cx, cy, unit * 0.08, 32)
    addCutField(ctx, palette.tone1, [port], { alpha: 0.92 })
    ctx.add(drawPolygonFillWithHoles(ctx.pixi, bar, [port], palette.tone4, 0.94, ctx.gradient),
      { delay: 0.05, span: 0.6 })
    ctx.add(drawRings(ctx.pixi, [{ x: cx, y: cy, radius: unit * 0.08 }], palette.ink, 2.4, 0.85), { delay: 0.12, span: 0.5 })
    ;[1, -1].forEach(function (side, index) {
      var distance = unit * 0.46
      var capX = cx + Math.cos(ctx.flowAngle) * distance * side
      var capY = cy + Math.sin(ctx.flowAngle) * distance * side
      ctx.add(drawPolygonFill(ctx.pixi, axisRect(capX, capY, unit * 0.1, unit * 0.34, ctx.flowAngle), palette.ink, 0.85),
        { delay: 0.16 + index * 0.04, span: 0.5 })
    })
  }

  // 宽窄交替的板条。最宽那条是字去的地方，所以它画成浅色，
  // 其余围绕它收拢
  function strobeSlats(ctx) {
    var width = ctx.width
    var height = ctx.height
    var palette = ctx.palette
    var bleed = ctx.bleed
    addFieldS(ctx, palette.tone1)
    var widths = [0.06, 0.03, 0.09, 0.04, 0.34, 0.04, 0.08, 0.03, 0.06]
    var cursor = width * 0.03
    widths.forEach(function (fraction, index) {
      var slat = rectPolygon(cursor, -bleed, width * fraction, height + bleed * 2)
      var wide = fraction > 0.2
      ctx.add(drawPolygonFill(ctx.pixi, slat, wide ? palette.tone2 : palette.tone4, wide ? 0.9 : 0.85, ctx.gradient),
        { delay: index * 0.03, span: 0.55, enterDY: (index % 2 === 0 ? 1 : -1) * height * 0.14 })
      cursor += width * (fraction + 0.02)
    })
  }

  // 三块同尺寸板错位叠放，经典的套印错位。顶板带一个直穿整叠的对位孔
  function offsetPlate(ctx) {
    var width = ctx.width
    var height = ctx.height
    var palette = ctx.palette
    var unit = Math.min(width, height)
    var step = unit * 0.06
    // 一枚对位孔直穿整叠错位板——场面与每块板在同一位置开同一个口，才是真的透
    var holeX = width * 0.72
    var holeY = height * 0.36
    var hole = circlePolygon(holeX, holeY, unit * 0.05, 28)
    addCutField(ctx, palette.tone1, [hole], { alpha: 0.9 })
    ;[palette.tone2, palette.tone3, palette.tone4].forEach(function (tone, index) {
      var plate = rectPolygon(width * 0.2 + step * index, height * 0.2 + step * index, width * 0.5, height * 0.5)
      ctx.add(drawPolygonFillWithHoles(ctx.pixi, plate, [hole], tone, index === 2 ? 0.95 : 0.8, ctx.gradient),
        { delay: index * 0.06, span: 0.55, enterDX: -step * 2, enterDY: -step })
    })
    ctx.add(drawRings(ctx.pixi, [{ x: holeX, y: holeY, radius: unit * 0.05 }], palette.ink, 2, 0.8), { delay: 0.22, span: 0.5 })
  }

  // 从停在画外的毂伸出的一梳射线，外加一个实心扇段作为重心块
  function radialComb(ctx) {
    var width = ctx.width
    var height = ctx.height
    var palette = ctx.palette
    var hubX = width * 1.06
    var hubY = height * 1.1
    var reach = Math.hypot(width, height) * 1.3
    addFieldS(ctx, palette.tone2)
    var rays = []
    for (var index = 0; index < 11; index += 1) {
      var angle = Math.PI + 0.16 + index * 0.062
      rays.push({
        x1: hubX,
        y1: hubY,
        x2: hubX + Math.cos(angle) * reach,
        y2: hubY + Math.sin(angle) * reach
      })
    }
    ctx.add(drawLines(ctx.pixi, rays, palette.tone4, 2.6, 0.8), { delay: 0.06, span: 0.6 })
    var start = Math.PI + 0.44
    var end = Math.PI + 0.56
    ctx.add(drawPolygonFill(ctx.pixi, [
      hubX, hubY,
      hubX + Math.cos(start) * reach, hubY + Math.sin(start) * reach,
      hubX + Math.cos(end) * reach, hubY + Math.sin(end) * reach
    ], palette.tone4, 0.95, ctx.gradient), { delay: 0.14, span: 0.6 })
    if (!ctx.showDecor) return
    ctx.add(drawHatchFill(ctx.pixi, rectPolygon(width * 0.06, height * 0.08, width * 0.2, height * 0.14), buildHatchSpec(ctx.seed, 151), palette.tone4, 0.4),
      { delay: 0.24, span: 0.6, grow: true })
  }

  // 取景器：低处开口四周的括号，字在开口上方的板上
  function bracketTarget(ctx) {
    var width = ctx.width
    var height = ctx.height
    var palette = ctx.palette
    var box = rectPolygon(width * 0.28, height * 0.54, width * 0.44, height * 0.34)
    addCutField(ctx, palette.tone3, [box])
    addHoleLip(ctx, box, 2.4, 0.85, 0.08)
    var arm = Math.min(width, height) * 0.08
    ;[[0.28, 0.54, 1, 1], [0.72, 0.54, -1, 1], [0.28, 0.88, 1, -1], [0.72, 0.88, -1, -1]].forEach(function (c, index) {
      var x = width * c[0] + c[2] * width * 0.03
      var y = height * c[1] + c[3] * height * 0.04
      ctx.add(drawLines(ctx.pixi, [
        { x1: x, y1: y, x2: x + c[2] * arm, y2: y },
        { x1: x, y1: y, x2: x, y2: y + c[3] * arm }
      ], palette.ink, 3.5, 0.9), { delay: 0.12 + index * 0.04, span: 0.5, enterDX: c[2] * width * 0.05 })
    })
    ctx.add(drawLines(ctx.pixi, [{ x1: width * 0.1, y1: height * 0.44, x2: width * 0.9, y2: height * 0.44 }], palette.tone4, 1.6, 0.6),
      { delay: 0.24, span: 0.5, enterDX: -width * 0.1 })
  }

  var TEMPERA_SIGNAL_COMPOSITIONS = {
    'sight-mark': sightMark,
    'dial-scale': dialScale,
    'chevron-run': chevronRun,
    'tally-column': tallyColumn,
    'grid-focus': gridFocus,
    'axis-caps': axisCaps,
    'strobe-slats': strobeSlats,
    'offset-plate': offsetPlate,
    'radial-comb': radialComb,
    'bracket-target': bracketTarget
  }

  // ---------- 走廊族（原版 compositions/temperaCorridorCompositions.ts） ----------
  // 沿 shot 行进方向切出的开口。这是为交接而建的族：相邻 shot 沿 flow 向量
  // 互相滑过，平行于该向量的走廊在移动中仍是同一条走廊，
  // 两个 shot 之间的缝就不再读作剪辑。背景透过移动的开口持续可见，
  // 而不是每次切换出现又消失
  //
  // 这里的一切都锚在画外两端——有可见端点的走廊是一个形状，
  // 形状会暴露剪辑点。字永远骑在开口旁侧或横跨它的实心肋上；
  // cutout 工具注释解释了它为何绝不能坐在开口本身上
  function channel(ctx, offset, width) {
    var centre = acrossPoint(ctx, offset)
    return axisRect(centre.x, centre.y, flowSpan(ctx), width, channelAxis(ctx))
  }

  // 沿走廊全程、离孔沿一线之外的轨
  function addRails(ctx, offset, width, alpha) {
    if (alpha === undefined) alpha = 0.55
    var angle = channelAxis(ctx)
    var half = flowSpan(ctx) / 2
    ;[-1, 1].forEach(function (side, index) {
      var start = flowPoint(ctx, -half, offset + side * width)
      var end = flowPoint(ctx, half, offset + side * width)
      ctx.add(drawLines(ctx.pixi, [{ x1: start.x, y1: start.y, x2: end.x, y2: end.y }], ctx.palette.tone4, 1.4, alpha), {
        delay: 0.18 + index * 0.03,
        span: 0.5,
        enterDX: Math.cos(angle) * ctx.width * 0.08,
        enterDY: Math.sin(angle) * ctx.height * 0.08
      })
    })
  }

  // 一侧的宽走廊，两缘带轨
  function flowChannel(ctx) {
    var width = ctx.width
    var palette = ctx.palette
    var unit = Math.min(width, ctx.height)
    var slot = channel(ctx, width * 0.26, unit * 0.3)
    addCutField(ctx, palette.tone3, [slot])
    addHoleLip(ctx, slot, 2.6, 0.85, 0.08)
    addRails(ctx, width * 0.26, unit * 0.19)
  }

  // 两条走廊，字站在它们之间的肋上
  function twinChannel(ctx) {
    var width = ctx.width
    var palette = ctx.palette
    var unit = Math.min(width, ctx.height)
    var slots = [channel(ctx, -width * 0.34, unit * 0.16), channel(ctx, width * 0.34, unit * 0.16)]
    addCutField(ctx, palette.tone4, slots)
    slots.forEach(function (slot, index) { addHoleLip(ctx, slot, 2.4, 0.8, 0.1 + index * 0.04) })
  }

  // 芦苇：外侧三分部的许多细走廊，中间留出一根清晰的立柱
  function reedRun(ctx) {
    var width = ctx.width
    var palette = ctx.palette
    var unit = Math.min(width, ctx.height)
    var slots = []
    ;[-1, 1].forEach(function (side) {
      for (var index = 0; index < 4; index += 1) {
        slots.push(channel(ctx, side * width * (0.22 + index * 0.08), unit * 0.035))
      }
    })
    addCutField(ctx, palette.tone2, slots, { alpha: 0.9 })
    addRails(ctx, 0, width * 0.17, 0.4)
  }

  // 越跑越窄的走廊：这里唯一开口非平移不变的类型，
  // 所以它读作走廊到达了某个地方
  function taperChannel(ctx) {
    var width = ctx.width
    var palette = ctx.palette
    var unit = Math.min(width, ctx.height)
    var half = flowSpan(ctx) / 2
    var wide = unit * 0.24
    var narrow = unit * 0.06
    var offset = width * 0.24
    var corners = [
      flowPoint(ctx, -half, offset - wide),
      flowPoint(ctx, -half, offset + wide),
      flowPoint(ctx, half, offset + narrow),
      flowPoint(ctx, half, offset - narrow)
    ]
    var slot = []
    corners.forEach(function (point) { slot.push(point.x, point.y) })
    addCutField(ctx, palette.tone3, [slot])
    addHoleLip(ctx, slot, 2.6, 0.85, 0.08)
  }

  // 沿行进线钻出的孔，由一条细线串起
  function chainPorts(ctx) {
    var width = ctx.width
    var height = ctx.height
    var palette = ctx.palette
    var unit = Math.min(width, height)
    var offset = width * 0.28
    var spacing = height * 0.26
    var ports = [-1.5, -0.5, 0.5, 1.5].map(function (step) { return flowPoint(ctx, step * spacing, offset) })
    addCutField(ctx, palette.tone4, ports.map(function (port) { return circlePolygon(port.x, port.y, unit * 0.11, 40) }))
    ctx.add(drawRings(ctx.pixi, ports.map(function (port) { return { x: port.x, y: port.y, radius: unit * 0.11 } }), palette.ink, 2.4, 0.85),
      { delay: 0.1, span: 0.55 })
    var head = flowPoint(ctx, -spacing * 2.4, offset)
    var tail = flowPoint(ctx, spacing * 2.4, offset)
    ctx.add(drawLines(ctx.pixi, [{ x1: head.x, y1: head.y, x2: tail.x, y2: tail.y }], palette.tone2, 1.6, 0.6), { delay: 0.18, span: 0.5 })
  }

  // 切成虚段的走廊，段间留实心的系杆
  function dashChannel(ctx) {
    var width = ctx.width
    var height = ctx.height
    var palette = ctx.palette
    var unit = Math.min(width, height)
    var offset = width * 0.24
    var step = height * 0.32
    var angle = channelAxis(ctx)
    var slots = [-1.5, -0.5, 0.5, 1.5].map(function (index) {
      var centre = flowPoint(ctx, index * step, offset)
      return axisRect(centre.x, centre.y, step * 0.72, unit * 0.22, angle)
    })
    addCutField(ctx, palette.tone3, slots)
    slots.forEach(function (slot, index) { addHoleLip(ctx, slot, 2.2, 0.8, 0.08 + index * 0.03) })
  }

  // 马车窗：固定节距依次经过的圆角开口
  function windowRun(ctx) {
    var width = ctx.width
    var height = ctx.height
    var palette = ctx.palette
    var unit = Math.min(width, height)
    var offset = width * 0.27
    // 节距必须清出窗加孔沿，否则整列读作一串连体
    var step = height * 0.36
    var angle = channelAxis(ctx)
    var slots = [-1.5, -0.5, 0.5, 1.5].map(function (index) {
      var centre = flowPoint(ctx, index * step, offset)
      var size = unit * 0.2
      return rotatePolygon(
        roundedRectPolygon(centre.x - size, centre.y - size * 0.62, size * 2, size * 1.24, size * 0.3),
        centre.x,
        centre.y,
        angle + Math.PI / 2
      )
    })
    addCutField(ctx, palette.tone4, slots)
    slots.forEach(function (slot, index) { addHoleLip(ctx, slot, 2.4, 0.85, 0.08 + index * 0.03) })
  }

  // 族里最宽的走廊，被一条实心带横跨。字骑在带上，
  // shot 读作背景之上的桥，而不是一块带洞的板
  function bridgeSpan(ctx) {
    var width = ctx.width
    var height = ctx.height
    var palette = ctx.palette
    var unit = Math.min(width, height)
    var slot = channel(ctx, 0, unit * 0.62)
    addCutField(ctx, palette.tone4, [slot])
    addHoleLip(ctx, slot, 2.6, 0.8, 0.08)
    // 带刻意比字需要的更厚：它随通道倾斜，而倾斜的带在字有地方可坐之前
    // 就先从自己的两端丢了高度
    var band = axisRect(width / 2, height / 2, flowSpan(ctx), height * 0.46, channelAxis(ctx) + Math.PI / 2)
    ctx.add(drawPolygonFill(ctx.pixi, band, palette.tone3, 0.95, ctx.gradient), { delay: 0.12, span: 0.6, enterDX: -width * 0.16 })
    ctx.add(drawPolygonOutline(ctx.pixi, band, palette.ink, 2, 0.7), { delay: 0.2, span: 0.5, enterDX: width * 0.1 })
  }

  // 两条走廊，各自在另一条跑通的地方被打断：系杆交替，这一对读作编织
  function braidChannel(ctx) {
    var width = ctx.width
    var height = ctx.height
    var palette = ctx.palette
    var unit = Math.min(width, height)
    var angle = channelAxis(ctx)
    var pitch = height * 0.42
    var slots = []
    ;[-1, 1].forEach(function (side) {
      // 两侧之间半个节距的偏移就是全部戏法：一条走廊被系住时，另一条正在跑通
      for (var index = -1; index <= 1; index += 1) {
        var centre = flowPoint(ctx, index * pitch + side * pitch * 0.5, side * width * 0.32)
        slots.push(axisRect(centre.x, centre.y, pitch * 0.78, unit * 0.16, angle))
      }
    })
    addCutField(ctx, palette.tone3, slots)
    slots.forEach(function (slot, index) { addHoleLip(ctx, slot, 2.2, 0.8, 0.08 + index * 0.025) })
  }

  // 两轨都带刻度的走廊——走廊即量尺
  function portLadder(ctx) {
    var width = ctx.width
    var height = ctx.height
    var palette = ctx.palette
    var unit = Math.min(width, height)
    var offset = width * 0.3
    var slot = channel(ctx, offset, unit * 0.14)
    addCutField(ctx, palette.tone2, [slot])
    addHoleLip(ctx, slot, 2.2, 0.8, 0.08)
    var rungs = []
    for (var index = 0; index < 9; index += 1) {
      var distance = (index - 4) * height * 0.13
      var long = index % 3 === 0
      var inner = flowPoint(ctx, distance, offset - unit * 0.09)
      var outer = flowPoint(ctx, distance, offset - unit * (long ? 0.22 : 0.15))
      rungs.push({ x1: inner.x, y1: inner.y, x2: outer.x, y2: outer.y })
    }
    ctx.add(drawLines(ctx.pixi, rungs, palette.tone4, 2, 0.7), { delay: 0.14, span: 0.6 })
  }

  var TEMPERA_CORRIDOR_COMPOSITIONS = {
    'flow-channel': flowChannel,
    'twin-channel': twinChannel,
    'reed-run': reedRun,
    'taper-channel': taperChannel,
    'chain-ports': chainPorts,
    'dash-channel': dashChannel,
    'window-run': windowRun,
    'bridge-span': bridgeSpan,
    'braid-channel': braidChannel,
    'port-ladder': portLadder
  }

  // ---------- 巨构族（原版 compositions/temperaMonolithCompositions.ts） ----------
  // 粗野主义：一面大到画框装不下的哑光实体，被画框裁掉，字坐在它的轮廓线上。
  // 全族建立在同一个动作上——一个画框无法容纳其尺度的体量——
  // 而 monolith kit 承载那些给它尺度的细线
  //
  // 身后场面实心时，字被放在*横跨*轮廓线的位置，因为一个字一半在体量上、
  // 一半在外，正是反色滤镜干得最好的地方。构图把地面开给背景时，
  // 区域挪到体量上；cutout 工具解释了它为何绝不能横跨开口
  function apexMass(ctx) {
    var width = ctx.width
    var height = ctx.height
    var palette = ctx.palette
    var bleed = ctx.bleed
    var apexX = width * (0.46 + temperaHash01(ctx.seed, 3, 227) * 0.12)
    var apexY = height * 0.38
    addGround(ctx, palette.tone1)
    var mass = [-bleed, height + bleed, apexX, apexY, width + bleed, height + bleed]
    addMass(ctx, mass, palette.tone3, { enterDY: height * 0.1 })
    // 只在一个侧面上排线。两侧都排会读作纹理而不是受光面
    addFaceRuling(ctx, [apexX, apexY, width + bleed, height + bleed, apexX + width * 0.24, height + bleed], 229)
    addSurveyLines(ctx, 3)
    if (!ctx.showDecor) return
    addCornerTicks(ctx)
    addWireTrace(ctx, width * 0.12, height * 0.84, Math.min(width, height) * 0.09)
  }

  // 厚板堆出的阶梯山。每一层是自己的节点，塔因此向上垒起
  function ziggurat(ctx) {
    var width = ctx.width
    var height = ctx.height
    var palette = ctx.palette
    var bleed = ctx.bleed
    addGround(ctx, palette.tone1)
    var tones = [palette.tone4, palette.tone3, palette.tone3, palette.tone2]
    for (var course = 0; course < 4; course += 1) {
      var half = width * (0.44 - course * 0.09)
      var top = height * (0.9 - course * 0.13) - height * 0.13
      addMass(ctx, rectPolygon(width / 2 - half, top, half * 2, height * 0.13 + bleed), tones[course], {
        delay: 0.04 + course * 0.05,
        enterDY: height * 0.08,
        edgeWidth: 2
      })
    }
    addSurveyLines(ctx, 2)
    if (!ctx.showDecor) return
    addCornerTicks(ctx)
  }

  // 填满大半画面的墙，前缘一道深缝
  function slabWall(ctx) {
    var width = ctx.width
    var height = ctx.height
    var palette = ctx.palette
    var bleed = ctx.bleed
    var edge = width * 0.36
    addGround(ctx, palette.tone1)
    addMass(ctx, rectPolygon(edge, -bleed, width - edge + bleed, height + bleed * 2), palette.tone3, { edge: false })
    ctx.add(drawLines(ctx.pixi, [{ x1: edge, y1: -bleed, x2: edge, y2: height + bleed }], palette.ink, 3.5, 0.9),
      { delay: 0.1, span: 0.55, enterDX: width * 0.06 })
    addFaceRuling(ctx, rectPolygon(width * 0.62, height * 0.1, width * 0.3, height * 0.8), 233)
    addSurveyLines(ctx, 3)
    if (!ctx.showDecor) return
    addWireTrace(ctx, width * 0.16, height * 0.24, Math.min(width, height) * 0.08)
  }

  // 悬在空中的梁，加上那根让它成为悬挑梁的支撑短柱
  function cantilever(ctx) {
    var width = ctx.width
    var height = ctx.height
    var palette = ctx.palette
    var bleed = ctx.bleed
    addGround(ctx, palette.tone1)
    addMass(ctx, rectPolygon(0.16 * width, height * 0.5, width * 0.1, height * 0.5 + bleed), palette.tone4, {
      delay: 0.02,
      enterDY: height * 0.1,
      edge: false
    })
    addMass(ctx, rectPolygon(-bleed, height * 0.34, width * 0.78 + bleed, height * 0.16), palette.tone3, {
      delay: 0.08,
      enterDX: -width * 0.14
    })
    addFaceRuling(ctx, rectPolygon(width * 0.3, height * 0.36, width * 0.44, height * 0.12), 239, palette.paper, 0.35)
    addSurveyLines(ctx, 2)
    if (!ctx.showDecor) return
    addCornerTicks(ctx)
  }

  // 两根柱子与它们扛着的过梁。柱间的开间从地面干净切掉，
  // 缝隙因此是天空而不是纸
  function pylonPair(ctx) {
    var width = ctx.width
    var height = ctx.height
    var palette = ctx.palette
    var bleed = ctx.bleed
    var bay = rectPolygon(width * 0.26, height * 0.3, width * 0.48, height * 0.7 + bleed)
    addCutField(ctx, palette.tone1, [bay], { alpha: 0.94 })
    addHoleLip(ctx, bay, 2, 0.6, 0.12)
    ;[0.1, 0.74].forEach(function (x, index) {
      addMass(ctx, rectPolygon(width * x, height * 0.28, width * 0.16, height * 0.72 + bleed), palette.tone4, {
        delay: 0.04 + index * 0.05,
        enterDY: height * 0.08,
        edgeWidth: 2
      })
    })
    addMass(ctx, rectPolygon(width * 0.04, height * 0.14, width * 0.92, height * 0.16), palette.tone3, {
      delay: 0.14,
      enterDY: -height * 0.1
    })
    addSurveyLines(ctx, 2)
  }

  // 一座带观察缝的掩体。缝同时从地面和体量上切：
  // 只在体量上开洞只会露出它背后的纸
  function bunkerSlit(ctx) {
    var width = ctx.width
    var height = ctx.height
    var palette = ctx.palette
    var bleed = ctx.bleed
    var slit = rectPolygon(-bleed, height * 0.62, width + bleed * 2, height * 0.06)
    addCutField(ctx, palette.tone1, [slit], { alpha: 0.94 })
    // 体量作为在缝两侧停住的两层到来。画成一整块再从那里切缝也能成立，
    // 但从相反方向进入的两半正是让开口读作被撬开的原因
    ctx.add(drawPolygonFill(ctx.pixi, rectPolygon(-bleed, height * 0.34, width + bleed * 2, height * 0.28), palette.tone4, 0.95, ctx.gradient),
      { delay: 0.05, span: 0.6, enterDY: -height * 0.08 })
    ctx.add(drawPolygonFill(ctx.pixi, rectPolygon(-bleed, height * 0.68, width + bleed * 2, height * 0.32 + bleed), palette.tone4, 0.95, ctx.gradient),
      { delay: 0.08, span: 0.6, enterDY: height * 0.1 })
    ctx.add(drawLines(ctx.pixi, [
      { x1: -bleed, y1: height * 0.34, x2: width + bleed, y2: height * 0.34 }
    ], palette.ink, 3, 0.85), { delay: 0.14, span: 0.5 })
    addFaceRuling(ctx, rectPolygon(width * 0.08, height * 0.72, width * 0.36, height * 0.2), 241, palette.paper, 0.3)
    addSurveyLines(ctx, 2)
  }

  // 三层基座，每层都比下面那层缩进一点
  function plinthStack(ctx) {
    var width = ctx.width
    var height = ctx.height
    var palette = ctx.palette
    var bleed = ctx.bleed
    addGround(ctx, palette.tone1)
    addMass(ctx, rectPolygon(width * 0.06, height * 0.72, width * 0.88, height * 0.28 + bleed), palette.tone4, { edgeWidth: 2 })
    addMass(ctx, rectPolygon(width * 0.16, height * 0.52, width * 0.68, height * 0.2), palette.tone3, { delay: 0.08, edgeWidth: 2 })
    addMass(ctx, rectPolygon(width * 0.28, height * 0.34, width * 0.44, height * 0.18), palette.tone2, { delay: 0.14, enterDY: height * 0.06 })
    addFaceRuling(ctx, rectPolygon(width * 0.2, height * 0.76, width * 0.6, height * 0.16), 243)
    addSurveyLines(ctx, 3)
    if (!ctx.showDecor) return
    addCornerTicks(ctx)
  }

  // 一列扶壁。地面开出一条带，鳍插进其中，
  // 天空在它们之间露出，而每个缝隙不必各自开洞
  function buttressRun(ctx) {
    var width = ctx.width
    var height = ctx.height
    var palette = ctx.palette
    var bleed = ctx.bleed
    var band = rectPolygon(-bleed, height * 0.42, width + bleed * 2, height * 0.58 + bleed)
    addCutField(ctx, palette.tone1, [band], { alpha: 0.94 })
    for (var index = 0; index < 5; index += 1) {
      var left = width * (index * 0.2 + 0.01)
      addMass(ctx, [
        left, height + bleed,
        left + width * 0.09, height * 0.42,
        left + width * 0.17, height + bleed
      ], index % 2 === 0 ? palette.tone4 : palette.tone3, {
        delay: 0.04 + index * 0.04,
        enterDY: height * 0.12,
        edgeWidth: 2
      })
    }
    ctx.add(drawLines(ctx.pixi, [{ x1: -bleed, y1: height * 0.42, x2: width + bleed, y2: height * 0.42 }], palette.ink, 2.4, 0.8),
      { delay: 0.2, span: 0.5, enterDX: -width * 0.1 })
    addSurveyLines(ctx, 2)
  }

  // 一块被掏掉中段的体量。开口是全模式里最大的，
  // 它上方留下的那条带正是字站的地方
  function voidCore(ctx) {
    var width = ctx.width
    var height = ctx.height
    var palette = ctx.palette
    var core = rectPolygon(width * 0.22, height * 0.34, width * 0.56, height * 0.46)
    addCutField(ctx, palette.tone3, [core], { alpha: 0.95 })
    addHoleLip(ctx, core, 3.5, 0.9, 0.08)
    addFaceRuling(ctx, rectPolygon(width * 0.04, height * 0.36, width * 0.14, height * 0.42), 247, palette.tone4, 0.45)
    addSurveyLines(ctx, 3)
    if (!ctx.showDecor) return
    addCornerTicks(ctx)
    addWireTrace(ctx, width * 0.86, height * 0.86, Math.min(width, height) * 0.08)
  }

  // 沿对角线剪切、两半互相错开的块
  function shearBlock(ctx) {
    var width = ctx.width
    var height = ctx.height
    var palette = ctx.palette
    var left = width * 0.14
    var right = width * 0.86
    var top = height * 0.2
    var bottom = height * 0.8
    var cutTop = width * 0.56
    var cutBottom = width * 0.44
    addGround(ctx, palette.tone1)
    addMass(ctx, [left, top, cutTop, top, cutBottom, bottom, left, bottom], palette.tone3, {
      enterDX: -width * 0.08,
      enterDY: -height * 0.03,
      edgeWidth: 2
    })
    addMass(ctx, [cutTop + width * 0.03, top + height * 0.04, right, top + height * 0.04, right, bottom + height * 0.04, cutBottom + width * 0.03, bottom + height * 0.04], palette.tone4, {
      delay: 0.1,
      enterDX: width * 0.08,
      enterDY: height * 0.03,
      edgeWidth: 2
    })
    addSurveyLines(ctx, 2)
    if (!ctx.showDecor) return
    ctx.add(drawPolygonOutline(ctx.pixi, rectPolygon(width * 0.1, height * 0.16, width * 0.8, height * 0.68), palette.paper, 1.2, 0.35),
      { delay: 0.28, span: 0.55 })
  }

  var TEMPERA_MONOLITH_COMPOSITIONS = {
    'apex-mass': apexMass,
    'ziggurat': ziggurat,
    'slab-wall': slabWall,
    'cantilever': cantilever,
    'pylon-pair': pylonPair,
    'bunker-slit': bunkerSlit,
    'plinth-stack': plinthStack,
    'buttress-run': buttressRun,
    'void-core': voidCore,
    'shear-block': shearBlock
  }

  // ---------- 地形族（原版 compositions/temperaTerrainCompositions.ts） ----------
  // 粗野主义组曲的另一半：体量读作地面与结构而不是物件——山脊、跨度、桥墩、护坡。
  // 规则与巨构族相同（一个主导实心、细的测量记号、全被画框裁切）；
  // 变化在于它们造出的地平线是画框身处其中而非眺望的东西
  function ridgeLine(ctx) {
    var width = ctx.width
    var height = ctx.height
    var palette = ctx.palette
    var bleed = ctx.bleed
    var lift = temperaHash01(ctx.seed, 5, 251) * 0.06
    addGround(ctx, palette.tone1)
    // 山脊就是构图；字排在其最高一段的骑跨位置
    addMass(ctx, [
      -bleed, height * (0.68 + lift),
      width * 0.34, height * (0.4 + lift),
      width * 0.62, height * (0.58 + lift),
      width + bleed, height * (0.34 + lift),
      width + bleed, height + bleed,
      -bleed, height + bleed
    ], palette.tone3, { enterDY: height * 0.08 })
    addFaceRuling(ctx, [
      width * 0.34, height * (0.42 + lift),
      width * 0.62, height * (0.6 + lift),
      width * 0.62, height + bleed,
      width * 0.34, height + bleed
    ], 253, palette.tone4, 0.45)
    addSurveyLines(ctx, 3)
    if (!ctx.showDecor) return
    addCornerTicks(ctx)
    addWireTrace(ctx, width * 0.1, height * 0.86, Math.min(width, height) * 0.08)
  }

  // 两块不相遇的体量。它们之间的缝切到背景，这让它成为画面里唯一的亮物
  function chasm(ctx) {
    var width = ctx.width
    var height = ctx.height
    var palette = ctx.palette
    var bleed = ctx.bleed
    var gap = rectPolygon(width * 0.46, -bleed, width * 0.1, height + bleed * 2)
    addCutField(ctx, palette.tone1, [gap], { alpha: 0.94 })
    addMass(ctx, rectPolygon(-bleed, height * 0.3, width * 0.46 + bleed, height * 0.7 + bleed), palette.tone3, {
      enterDX: -width * 0.1,
      edgeWidth: 2
    })
    addMass(ctx, rectPolygon(width * 0.56, height * 0.2, width * 0.44 + bleed, height * 0.8 + bleed), palette.tone4, {
      delay: 0.08,
      enterDX: width * 0.1,
      edgeWidth: 2
    })
    addSurveyLines(ctx, 2)
  }

  // 从上方压下来的屋顶，连同它撞上的墙与它投下的影子
  function overhang(ctx) {
    var width = ctx.width
    var height = ctx.height
    var palette = ctx.palette
    var bleed = ctx.bleed
    addGround(ctx, palette.tone1)
    addMass(ctx, rectPolygon(-bleed, -bleed, width + bleed * 2, height * 0.34 + bleed), palette.tone4, {
      enterDY: -height * 0.1,
      edgeWidth: 3
    })
    addMass(ctx, rectPolygon(width * 0.72, height * 0.34, width * 0.28 + bleed, height * 0.66 + bleed), palette.tone3, {
      delay: 0.08,
      enterDX: width * 0.1,
      edge: false
    })
    // 影子是一片罩色，不是体量：它绝不能独自托字
    ctx.add(drawPolygonFill(ctx.pixi, rectPolygon(-bleed, height * 0.34, width + bleed * 2, height * 0.14), palette.tone2, 0.5, ctx.gradient),
      { delay: 0.16, span: 0.6 })
    addSurveyLines(ctx, 3)
    if (!ctx.showDecor) return
    addCornerTicks(ctx)
  }

  // 阶梯井：各层向内下降到一口竖井，井穿过每一层
  function stepWell(ctx) {
    var width = ctx.width
    var height = ctx.height
    var palette = ctx.palette
    var bleed = ctx.bleed
    var shaft = rectPolygon(width * 0.36, height * 0.6, width * 0.28, height * 0.4 + bleed)
    addCutField(ctx, palette.tone2, [shaft], { alpha: 0.94 })
    ;[[0.14, 0.3, 0.72, palette.tone3], [0.24, 0.44, 0.52, palette.tone4]].forEach(function (c, index) {
      ctx.add(drawPolygonFillWithHoles(
        ctx.pixi,
        rectPolygon(width * c[0], height * c[1], width * c[2], height * (1 - c[1]) + bleed),
        [shaft],
        c[3],
        0.95,
        ctx.gradient
      ), { delay: 0.06 + index * 0.06, span: 0.6, enterDY: height * 0.06 })
    })
    addHoleLip(ctx, shaft, 3, 0.85, 0.18)
    addSurveyLines(ctx, 2)
  }

  // 立在开出水面带里的桥墩，加上横跨全部桥墩的桥面
  function pierRow(ctx) {
    var width = ctx.width
    var height = ctx.height
    var palette = ctx.palette
    var bleed = ctx.bleed
    var water = rectPolygon(-bleed, height * 0.46, width + bleed * 2, height * 0.54 + bleed)
    addCutField(ctx, palette.tone1, [water], { alpha: 0.94 })
    ;[0.04, 0.28, 0.52, 0.76].forEach(function (x, index) {
      addMass(ctx, rectPolygon(width * x, height * 0.46, width * 0.14, height * 0.54 + bleed), palette.tone4, {
        delay: 0.06 + index * 0.04,
        enterDY: height * 0.1,
        edge: false
      })
    })
    // 桥面必须比字的框更深：它是开出带上方唯一的实心物，
    // 任何从它垂下的东西都会对着裸背景排布
    addMass(ctx, rectPolygon(-bleed, height * 0.32, width + bleed * 2, height * 0.16), palette.tone3, {
      delay: 0.02,
      enterDX: -width * 0.12,
      edgeWidth: 2
    })
    addSurveyLines(ctx, 2)
  }

  // 带肋的护坡，跑出两侧边缘
  function revetment(ctx) {
    var width = ctx.width
    var height = ctx.height
    var palette = ctx.palette
    var bleed = ctx.bleed
    addGround(ctx, palette.tone1)
    var slope = [
      -bleed, height * 0.72,
      width * 0.62, height * 0.3,
      width + bleed, height * 0.34,
      width + bleed, height + bleed,
      -bleed, height + bleed
    ]
    addMass(ctx, slope, palette.tone3, { enterDY: height * 0.1 })
    var ribs = []
    for (var index = 0; index < 9; index += 1) {
      var x = width * (0.04 + index * 0.11)
      var top = height * (0.72 - (x / (width * 0.62)) * 0.42)
      ribs.push({ x1: x, y1: Math.max(top, height * 0.3) + height * 0.03, x2: x - width * 0.03, y2: height + bleed })
    }
    ctx.add(drawLines(ctx.pixi, ribs, palette.tone4, 2.4, 0.5), { delay: 0.16, span: 0.65 })
    addSurveyLines(ctx, 3)
    if (!ctx.showDecor) return
    addCornerTicks(ctx)
  }

  // 更大之物的局部一角，加上大量的空。这个族表达尺度的最安静方式
  function towerCrop(ctx) {
    var width = ctx.width
    var height = ctx.height
    var palette = ctx.palette
    var bleed = ctx.bleed
    addGround(ctx, palette.tone1)
    addMass(ctx, rectPolygon(width * 0.58, height * 0.18, width * 0.42 + bleed, height * 0.82 + bleed), palette.tone4, {
      enterDX: width * 0.08,
      enterDY: height * 0.06,
      edgeWidth: 3
    })
    addFaceRuling(ctx, rectPolygon(width * 0.62, height * 0.26, width * 0.12, height * 0.6), 257, palette.paper, 0.3)
    addSurveyLines(ctx, 2)
    if (!ctx.showDecor) return
    addWireTrace(ctx, width * 0.2, height * 0.7, Math.min(width, height) * 0.1)
    addCornerTicks(ctx)
  }

  // 两个支点都在画外的过梁：跨度就是全部
  function lintel(ctx) {
    var width = ctx.width
    var height = ctx.height
    var palette = ctx.palette
    var bleed = ctx.bleed
    addGround(ctx, palette.tone1)
    addMass(ctx, rectPolygon(-bleed, height * 0.4, width + bleed * 2, height * 0.2), palette.tone3, {
      enterDX: -width * 0.16,
      edgeWidth: 3
    })
    ;[0.18, 0.66].forEach(function (x, index) {
      addMass(ctx, rectPolygon(width * x, height * 0.6, width * 0.16, height * 0.12), palette.tone4, {
        delay: 0.12 + index * 0.04,
        enterDY: height * 0.06,
        edge: false
      })
    })
    addSurveyLines(ctx, 3)
    if (!ctx.showDecor) return
    addCornerTicks(ctx)
  }

  // 从画外一点扇出的碎板——同一块体量失效之后的样子
  function rubbleFan(ctx) {
    var width = ctx.width
    var height = ctx.height
    var palette = ctx.palette
    var hubX = -width * 0.12
    var hubY = height * 1.12
    addGround(ctx, palette.tone1)
    for (var index = 0; index < 5; index += 1) {
      var angle = -1.24 + index * 0.19 + temperaHash01(ctx.seed, index, 259) * 0.05
      var reach = Math.hypot(width, height) * (0.5 + index * 0.09)
      var slab = rectPolygon(hubX + reach * 0.34, hubY - height * 0.06, reach * 0.5, height * 0.12 + index * 8)
      addMass(ctx, rotatePolygon(slab, hubX, hubY, angle), index % 2 === 0 ? palette.tone3 : palette.tone4, {
        delay: 0.04 + index * 0.05,
        enterDX: -width * 0.06,
        enterDY: height * 0.06,
        edgeWidth: 2
      })
    }
    addSurveyLines(ctx, 2)
  }

  // 日晷指针与它投下的影子：两块体量，其中一块只是一个方向
  function gnomon(ctx) {
    var width = ctx.width
    var height = ctx.height
    var palette = ctx.palette
    var bleed = ctx.bleed
    addGround(ctx, palette.tone1)
    ctx.add(drawPolygonFill(ctx.pixi, [
      width * 0.42, height * 0.86,
      width + bleed, height * 0.6,
      width + bleed, height * 0.78,
      width * 0.46, height * 0.94
    ], palette.tone2, 0.6, ctx.gradient), { delay: 0.1, span: 0.65, enterDX: width * 0.1 })
    addMass(ctx, [
      width * 0.3, height + bleed,
      width * 0.36, height * 0.16,
      width * 0.42, height * 0.16,
      width * 0.46, height + bleed
    ], palette.tone4, { delay: 0.04, enterDY: height * 0.08, edgeWidth: 2 })
    addSurveyLines(ctx, 3)
    if (!ctx.showDecor) return
    addCornerTicks(ctx)
    addWireTrace(ctx, width * 0.8, height * 0.82, Math.min(width, height) * 0.08)
  }

  var TEMPERA_TERRAIN_COMPOSITIONS = {
    'ridge-line': ridgeLine,
    'chasm': chasm,
    'overhang': overhang,
    'step-well': stepWell,
    'pier-row': pierRow,
    'revetment': revetment,
    'tower-crop': towerCrop,
    'lintel': lintel,
    'rubble-fan': rubbleFan,
    'gnomon': gnomon
  }

  // ---------- 构图注册表（原版 temperaCompositions.ts） ----------
  // 构图注册表加每种 shot 共有的两层。逐 kind 绘制在各 compositions 文件中按族分组；
  // 同类 kind 的排版区域与镜头档案在 tempera-profiles
  var COMPOSITIONS = {}
  Object.assign(COMPOSITIONS, window.FoliaTemperaCompsA)
  Object.assign(COMPOSITIONS, B)
  Object.assign(COMPOSITIONS, window.FoliaTemperaCompsC)
  Object.assign(COMPOSITIONS, TEMPERA_SIGNAL_COMPOSITIONS)
  Object.assign(COMPOSITIONS, TEMPERA_CORRIDOR_COMPOSITIONS)
  Object.assign(COMPOSITIONS, TEMPERA_MONOLITH_COMPOSITIONS)
  Object.assign(COMPOSITIONS, TEMPERA_TERRAIN_COMPOSITIONS)
  // 注册表对象上混入的工具键不属于构图，剔除
  ;['fieldPolygon', 'addCutField', 'addHoleLip', 'axisRect', 'channelAxis', 'acrossFlow', 'acrossPoint',
    'flowPoint', 'flowSpan', 'addMass', 'addGround', 'addFaceRuling', 'addSurveyLines', 'addCornerTicks',
    'addWireTrace'].forEach(function (key) { delete COMPOSITIONS[key] })

  // 每种 kind 都必须解析到一个绘制器
  function resolveTemperaComposition(kind) {
    return COMPOSITIONS[kind] || COMPOSITIONS['duo-split']
  }

  // 所有 kind 共有的浅满出血导引线；它们在 shot 之间带着视线走
  function addCrossingLines(ctx) {
    var lines = Curves.buildCrossingLines(ctx.seed, 31, ctx.width, ctx.height, ctx.decor.crossCount)
    if (lines.length === 0) return
    ctx.add(drawLines(ctx.pixi, lines, ctx.palette.tone4, 1.3, 0.6), {
      delay: 0.14,
      span: 0.6,
      enterDX: ctx.width * 0.25
    })
  }

  // Motif 叠层：编译期选定的一枚额外网点元素，叠在任意 kind 上
  function addMotif(ctx) {
    var width = ctx.width
    var height = ctx.height
    var palette = ctx.palette
    var decor = ctx.decor
    var cornerX = temperaHash01(ctx.seed, 61, 7) > 0.5 ? width * 0.14 : width * 0.86
    var cornerY = temperaHash01(ctx.seed, 63, 7) > 0.5 ? height * 0.18 : height * 0.82
    switch (decor.motif) {
      case 'diamonds':
        ctx.add(Shapes.drawConcentricDiamonds(ctx.pixi, cornerX, cornerY, 34, 34, 3, palette.tone4, 0.8),
          { delay: 0.34, drift: true })
        return
      case 'hatch-twin': {
        var baseSpec = buildHatchSpec(ctx.seed, 67)
        var spec = { angle: decor.hatchAngle, spacing: baseSpec.spacing, width: baseSpec.width }
        ;[0, 1].forEach(function (index) {
          var box = rectPolygon(cornerX - 34 + index * 46, cornerY - 26, 38, 38)
          var twinSpec = index === 0
            ? spec
            : { angle: spec.angle, spacing: spec.spacing * 0.55, width: spec.width }
          ctx.add(drawHatchFill(ctx.pixi, box, twinSpec, palette.tone4, 0.75),
            { delay: 0.34 + index * 0.05, grow: true })
          ctx.add(drawPolygonOutline(ctx.pixi, box, palette.tone4, 1.2, 0.6), { delay: 0.38 + index * 0.05 })
        })
        return
      }
      case 'band-cross':
        ctx.add(Shapes.drawCrossMarks(
          ctx.pixi,
          Curves.buildCrossRow(ctx.seed, 71, cornerX - width * 0.1, cornerY, 5, width * 0.05, 8, decor.hatchAngle * 0.4),
          palette.tone4,
          2,
          0.8
        ), { delay: 0.34, span: 0.5 })
        return
      case 'poster-diamond':
        // 刻意停到边缘之外，形状因此溢出画框
        ctx.add(drawPolygonFill(
          ctx.pixi,
          Curves.diamondPolygon(cornerX < width / 2 ? -width * 0.04 : width * 1.04, cornerY, width * 0.14, height * 0.2),
          palette.tone3,
          0.85
        ), { delay: 0.32, span: 0.55, enterDX: (cornerX < width / 2 ? -1 : 1) * width * 0.1 })
        return
      case 'doodle':
      default:
        ctx.add(drawPolyline(
          ctx.pixi,
          Curves.buildScribblePath(decor.scribbleSeed, 73, cornerX, cornerY, Math.min(width, height) * 0.08, 3),
          palette.tone4,
          1.5,
          0.72
        ), { delay: 0.34, span: 0.6 })
    }
  }

  function drawTemperaComposition(ctx) {
    resolveTemperaComposition(ctx.kind)(ctx)
    // 过场卡按定义是素场；共享叠层会毁掉它们
    if (window.FoliaTemperaProfiles.resolveTemperaShotProfile(ctx.kind).sharedDecor === false) return
    addCrossingLines(ctx)
    if (ctx.showDecor) addMotif(ctx)
  }

  window.FoliaTemperaCompositions = {
    resolveTemperaComposition: resolveTemperaComposition,
    addCrossingLines: addCrossingLines,
    addMotif: addMotif,
    drawTemperaComposition: drawTemperaComposition
  }
})()
