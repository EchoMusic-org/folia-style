// 凝彩模式·Pixi 图形工厂与运动层：移植自 folia-major src/components/visualizer/tempera/
//   temperaShapes.ts（网点语汇的 Pixi Graphics 工厂，全部返回完成态静态节点）
//   temperaBlocks.ts（每 shot 的色块 MG 层：只持入场/漂移运动状态，几何全部交给构图）
//   temperaImageLayer.ts（用户图片池；本插件无导入 UI，池恒为空、自然空跑，逻辑保留）
//   temperaCompositionContext.ts（构图族共享的绘制契约）
// 播放只写变换与透明度，从不改几何。
(function () {
  'use strict'

  var Core = window.FoliaTemperaCore
  var Curves = window.FoliaTemperaCurves
  var ColorMix = window.FoliaColorMix
  var mixColors = ColorMix.mixColors
  var clamp01 = Core.clamp01
  var easeTemperaEnter = Core.easeTemperaEnter
  var easeTemperaInOut = Core.easeTemperaInOut
  var resolveShotPacedDuration = Core.resolveShotPacedDuration
  var temperaHash01 = Core.temperaHash01
  var buildHatchLines = Curves.buildHatchLines

  // ---------- Pixi Graphics 工厂（原版 temperaShapes.ts） ----------
  function toPixiColor(pixi, color) {
    return pixi.Color.shared.setValue(color).toNumber()
  }

  function boundsCenter(polygon) {
    var minX = Number.POSITIVE_INFINITY
    var maxX = Number.NEGATIVE_INFINITY
    var minY = Number.POSITIVE_INFINITY
    var maxY = Number.NEGATIVE_INFINITY
    for (var index = 0; index < polygon.length; index += 2) {
      minX = Math.min(minX, polygon[index])
      maxX = Math.max(maxX, polygon[index])
      minY = Math.min(minY, polygon[index + 1])
      maxY = Math.max(maxY, polygon[index + 1])
    }
    return { x: (minX + maxX) / 2, y: (minY + maxY) / 2 }
  }

  // 四色 ramp 加上它沿行的轴，由 gradient 色彩模式提供
  // （TemperaGradientFill：{ colors, angle }）

  // gradient 模式下形状用整条四色 ramp 填充而不是单一色调。
  // 每一档向构图要的色调拉一半，ramp 携带封面的色相，
  // 而形状保持它在构图中的位置所需的亮度
  function buildGradientFill(pixi, gradient, color) {
    var half = 0.5
    var dx = Math.cos(gradient.angle) * half
    var dy = Math.sin(gradient.angle) * half
    var stops = gradient.colors.map(function (stop, index) {
      return {
        offset: gradient.colors.length > 1 ? index / (gradient.colors.length - 1) : 0,
        color: mixColors(stop, color, 0.5)
      }
    })
    return new pixi.FillGradient({
      type: 'linear',
      start: { x: half - dx, y: half - dy },
      end: { x: half + dx, y: half + dy },
      colorStops: stops,
      textureSpace: 'local'
    })
  }

  function drawPolygonFill(pixi, polygon, color, alpha, gradient) {
    if (alpha === undefined) alpha = 1
    var node = new pixi.Graphics().poly(polygon)
    return gradient && gradient.colors.length > 1
      ? node.fill({ fill: buildGradientFill(pixi, gradient, color), alpha: alpha })
      : node.fill({ color: toPixiColor(pixi, color), alpha: alpha })
  }

  // 带孔洞的填充多边形。孔是真的透明：Pixi 画布跑在 backgroundAlpha: 0 上，
  // 透出的是外壳的实时背景层（被场景的纸雾罩着；纸雾按段落建，无法按 shot 挖）。
  //
  // 节点必须只有一条 fill 指令。GraphicsContext.cut 会往回找最近两条指令挂洞，
  // 第一个洞挂上以后那条分支没有 break——同一节点上再来一条 fill 或 stroke
  // 会悄悄把洞也收走。孔的描边因此一律另起节点
  function drawPolygonFillWithHoles(pixi, polygon, holes, color, alpha, gradient) {
    if (alpha === undefined) alpha = 1
    var node = new pixi.Graphics().poly(polygon)
    if (gradient && gradient.colors.length > 1) {
      node.fill({ fill: buildGradientFill(pixi, gradient, color), alpha: alpha })
    } else {
      node.fill({ color: toPixiColor(pixi, color), alpha: alpha })
    }
    holes.forEach(function (hole) {
      if (hole.length >= 6) node.poly(hole).cut()
    })
    return node
  }

  function drawPolygonOutline(pixi, polygon, color, width, alpha) {
    if (alpha === undefined) alpha = 1
    return new pixi.Graphics()
      .poly(polygon)
      .stroke({ color: toPixiColor(pixi, color), width: width, alpha: alpha })
  }

  // 用平行线填充凸多边形。节点以形状中心为轴，调用方可以用水平缩放打开它
  // 而不必再碰几何
  function drawHatchFill(pixi, polygon, spec, color, alpha) {
    if (alpha === undefined) alpha = 1
    var node = new pixi.Graphics()
    var lines = buildHatchLines(polygon, spec)
    lines.forEach(function (line) {
      node.moveTo(line.x1, line.y1).lineTo(line.x2, line.y2)
    })
    if (lines.length > 0) {
      node.stroke({ color: toPixiColor(pixi, color), width: spec.width, alpha: alpha })
    }
    var center = boundsCenter(polygon)
    node.pivot.set(center.x, center.y)
    node.position.set(center.x, center.y)
    return node
  }

  // 圆盘场的 bounds 中心，节点便可像 hatch 填充一样以自身为轴
  function discsCenter(discs) {
    if (discs.length === 0) return { x: 0, y: 0 }
    var minX = Number.POSITIVE_INFINITY
    var maxX = Number.NEGATIVE_INFINITY
    var minY = Number.POSITIVE_INFINITY
    var maxY = Number.NEGATIVE_INFINITY
    discs.forEach(function (disc) {
      minX = Math.min(minX, disc.x - disc.radius)
      maxX = Math.max(maxX, disc.x + disc.radius)
      minY = Math.min(minY, disc.y - disc.radius)
      maxY = Math.max(maxY, disc.y + disc.radius)
    })
    return { x: (minX + maxX) / 2, y: (minY + maxY) / 2 }
  }

  // 一整片圆盘场是一个节点：气泡簇要作为一个 item 进场和呼吸，
  // 每个气泡一个 Graphics 会往块动画器里塞十几个条目而不是一个。
  // 以场中心为轴，drift 读作呼吸而不是滑动
  function buildDiscNode(pixi, discs) {
    var node = new pixi.Graphics()
    discs.forEach(function (disc) {
      node.circle(disc.x, disc.y, Math.max(0.5, disc.radius))
    })
    return node
  }

  function pivotOnSelf(node, center) {
    node.pivot.set(center.x, center.y)
    node.position.set(center.x, center.y)
    return node
  }

  function drawDiscs(pixi, discs, color, alpha, gradient) {
    if (alpha === undefined) alpha = 1
    var node = buildDiscNode(pixi, discs)
    if (discs.length > 0) {
      node.fill(gradient && gradient.colors.length > 1
        ? { fill: buildGradientFill(pixi, gradient, color), alpha: alpha }
        : { color: toPixiColor(pixi, color), alpha: alpha })
    }
    return pivotOnSelf(node, discsCenter(discs))
  }

  function drawRings(pixi, discs, color, width, alpha) {
    if (alpha === undefined) alpha = 1
    var node = buildDiscNode(pixi, discs)
    if (discs.length > 0) {
      node.stroke({ color: toPixiColor(pixi, color), width: width, alpha: alpha })
    }
    return pivotOnSelf(node, discsCenter(discs))
  }

  function drawLines(pixi, lines, color, width, alpha) {
    if (alpha === undefined) alpha = 1
    var node = new pixi.Graphics()
    lines.forEach(function (line) {
      node.moveTo(line.x1, line.y1).lineTo(line.x2, line.y2)
    })
    if (lines.length > 0) {
      node.stroke({ color: toPixiColor(pixi, color), width: width, alpha: alpha })
    }
    return node
  }

  function drawPolyline(pixi, points, color, width, alpha) {
    if (alpha === undefined) alpha = 1
    var node = new pixi.Graphics()
    if (points.length < 4) return node
    node.moveTo(points[0], points[1])
    for (var index = 2; index < points.length; index += 2) {
      node.lineTo(points[index], points[index + 1])
    }
    return node.stroke({ color: toPixiColor(pixi, color), width: width, alpha: alpha })
  }

  // 同心 45° 旋转框，线宽交替、外圈最粗
  function drawConcentricDiamonds(pixi, cx, cy, rx, ry, rings, color, alpha) {
    if (alpha === undefined) alpha = 1
    var node = new pixi.Graphics()
    var stroke = toPixiColor(pixi, color)
    for (var ring = 0; ring < Math.max(1, rings); ring += 1) {
      var shrink = 1 - ring * 0.22
      node
        .poly([cx, cy - ry * shrink, cx + rx * shrink, cy, cx, cy + ry * shrink, cx - rx * shrink, cy])
        .stroke({ color: stroke, width: ring % 2 === 0 ? 3.5 : 1.4, alpha: alpha })
    }
    node.pivot.set(cx, cy)
    node.position.set(cx, cy)
    return node
  }

  function drawCrossMarks(pixi, marks, color, width, alpha) {
    if (alpha === undefined) alpha = 1
    var node = new pixi.Graphics()
    marks.forEach(function (mark) {
      var cos = Math.cos(mark.rotation + Math.PI / 4) * mark.size
      var sin = Math.sin(mark.rotation + Math.PI / 4) * mark.size
      node.moveTo(mark.x - cos, mark.y - sin).lineTo(mark.x + cos, mark.y + sin)
      node.moveTo(mark.x - sin, mark.y + cos).lineTo(mark.x + sin, mark.y - cos)
    })
    if (marks.length > 0) {
      node.stroke({ color: toPixiColor(pixi, color), width: width, alpha: alpha })
    }
    return node
  }

  function drawSquareMarks(pixi, marks, color, alpha) {
    if (alpha === undefined) alpha = 1
    var node = new pixi.Graphics()
    marks.forEach(function (mark) {
      node.rect(mark.x - mark.size / 2, mark.y - mark.size / 2, mark.size, mark.size)
    })
    if (marks.length > 0) {
      node.fill({ color: toPixiColor(pixi, color), alpha: alpha })
    }
    return node
  }

  // ---------- 色块 MG 层（原版 temperaBlocks.ts） ----------
  // 每 shot 的网点 MG 层：持入场/出场运动状态，几何全部委托给 compositions。
  // 时序是 shot 自身时长的比例，图形因此跟着歌词推进，
  // 而不是在固定的几分之一秒里完成。这里没有任何东西响应音频；
  // seek 重绘出完全相同的帧
  //
  // options: { kind, decor, palette, width, height, seed, showDecor, flowAngle }
  function buildTemperaBlocks(pixi, options) {
    var container = new pixi.Container()
    var items = []
    var flowX = Math.cos(options.flowAngle)
    var flowY = Math.sin(options.flowAngle)
    // 仅每项的错峰距离。交接位移的大头属于 shot 容器，它带着文字与图形一起走
    var carry = Math.max(options.width, options.height) * 0.09

    // node + 可选 options: { alpha, enterDX, enterDY, delay, span, drift, grow }，parent 可选
    function add(node, blockOptions, parent) {
      blockOptions = blockOptions || {}
      items.push({
        node: node,
        baseX: node.x,
        baseY: node.y,
        baseAlpha: blockOptions.alpha !== undefined ? blockOptions.alpha : 1,
        enterDX: blockOptions.enterDX !== undefined ? blockOptions.enterDX : 0,
        enterDY: blockOptions.enterDY !== undefined ? blockOptions.enterDY : 0,
        // shot 时长的比例，更新时解析为秒
        delayFraction: blockOptions.delay !== undefined ? blockOptions.delay : 0,
        spanFraction: blockOptions.span !== undefined ? blockOptions.span : 0.45,
        drift: blockOptions.drift !== undefined ? blockOptions.drift : false,
        driftPhase: temperaHash01(options.seed, items.length, 173) * Math.PI * 2,
        grow: blockOptions.grow !== undefined ? blockOptions.grow : false
      })
      ;(parent || container).addChild(node)
    }

    // 倾斜子组（海报构图）把子节点保持在局部坐标系里
    function createGroup(rotation, x, y) {
      var group = new pixi.Container()
      group.rotation = rotation
      group.position.set(x, y)
      container.addChild(group)
      return group
    }

    var context = {
      pixi: pixi,
      kind: options.kind,
      palette: options.palette,
      decor: options.decor,
      width: options.width,
      height: options.height,
      seed: options.seed,
      showDecor: options.showDecor,
      flowAngle: options.flowAngle,
      bleed: carry + Math.max(options.width, options.height) * 0.08,
      // 仅 gradient 模式：每 shot 一条渐变轴，相邻构图不会都以同一方式
      // 扫过封面色
      gradient: options.palette.gradient
        ? { colors: options.palette.gradient, angle: temperaHash01(options.seed, 3, 197) * Math.PI * 2 }
        : null,
      add: add,
      createGroup: createGroup
    }
    window.FoliaTemperaCompositions.drawTemperaComposition(context)

    // 绝对时间驱动块运动，seek 渲染相同帧。这里没有出场斜坡：
    // shot 容器持有交接滑动，出画构图带着自己的文字整块离开
    function updateTime(time, shotStart, shotEnd, lyricEnd) {
      var duration = Math.max(shotEnd - shotStart, 0.2)
      var paceDuration = Math.max((lyricEnd !== undefined ? lyricEnd : shotEnd) - shotStart, 0.2)
      var progress = clamp01((time - shotStart) / duration)
      // 整个 shot 沿 flow 向量的匀速爬行；镜头骑同一根轴，
      // 所以下一个构图到达时画面早已在动
      var creep = easeTemperaInOut(progress) * carry * 0.35
      var budget = Math.max(0.5, paceDuration)

      for (var i = 0; i < items.length; i += 1) {
        var item = items[i]
        var rawDelay = resolveShotPacedDuration(paceDuration, item.delayFraction, 0, 1.4)
        var rawSpan = resolveShotPacedDuration(paceDuration, item.spanFraction, 0.7, 2.6)
        // 短 shot 压缩整个错峰，而不是丢掉靠后的项
        var compress = Math.min(1, budget / (rawDelay + rawSpan))
        var enter = easeTemperaEnter((time - shotStart - rawDelay * compress) / (rawSpan * compress))
        item.node.alpha = item.baseAlpha * enter
        item.node.visible = enter > 0.001
        var behind = (1 - enter) * carry - creep
        item.node.position.set(
          item.baseX + item.enterDX * (1 - enter) - flowX * behind,
          item.baseY + item.enterDY * (1 - enter) - flowY * behind
        )
        if (item.drift || item.grow) {
          // 缓慢的漂浮替代旧的音频脉冲：确定性、seek 安全，
          // 并让装饰在 shot 落定后不至于看着冻结
          var float = item.drift ? 1 + Math.sin(time * 0.5 + item.driftPhase) * 0.02 : 1
          item.node.scale.set(item.grow ? Math.max(0.0001, enter) * float : float, float)
          if (item.drift) item.node.rotation = Math.sin(time * 0.33 + item.driftPhase) * 0.012
        }
      }
    }

    return { container: container, updateTime: updateTime }
  }

  // ---------- 图片池（原版 temperaImageLayer.ts） ----------
  // 用户放在画布上的图片池。每个 shot 自己挑一张图并自己放置，
  // 所以图片只携带倾向：逐一手工摆放就失去了池的意义。
  // 精灵 riding 与构图相同的入场错峰与 flow 爬行，所以抠图属于 shot
  // 而不是浮在上面；back 图像坐在歌词反色所读的画面之中——
  // 文字切过它就像切过一块色调块。
  // 本插件无导入 UI，layerImages 恒为空数组：resolveTemperaShotImage 直接返回 null，
  // 整层自然空跑，逻辑按原样保留。

  // 每种横向倾向取自的横向带，视口比例
  var ALIGN_BANDS = {
    left: { from: 0.14, to: 0.32 },
    center: { from: 0.4, to: 0.6 },
    right: { from: 0.68, to: 0.86 },
    free: { from: 0.12, to: 0.88 }
  }

  // 纵向带镜像横向网格，固定位置读作真正的 3x3 布局
  var VERTICAL_ALIGN_BANDS = {
    top: { from: 0.14, to: 0.32 },
    center: { from: 0.4, to: 0.6 },
    bottom: { from: 0.68, to: 0.86 },
    free: { from: 0.12, to: 0.88 }
  }

  // 求一张图在一个 shot 里的落点。纯函数、种子驱动，
  // seek 重绘完全相同的帧，同一首歌永远以同样方式构图
  function resolveTemperaImagePlacement(image, seed) {
    var horizontalBand = ALIGN_BANDS[image.align] || ALIGN_BANDS.free
    var verticalBand = VERTICAL_ALIGN_BANDS[image.verticalAlign] || VERTICAL_ALIGN_BANDS.bottom
    return {
      x: horizontalBand.from + (horizontalBand.to - horizontalBand.from) * temperaHash01(seed, 1, 251),
      y: verticalBand.from + (verticalBand.to - verticalBand.from) * temperaHash01(seed, 2, 257),
      scale: image.scale * (0.9 + temperaHash01(seed, 3, 263) * 0.2),
      rotation: (temperaHash01(seed, 4, 269) - 0.5) * 0.08,
      opacity: image.opacity,
      flip: temperaHash01(seed, 5, 271) > 0.5
    }
  }

  // 为 shot 选图，或什么都不选。previousId 让池里有替代时相邻 shot 不落同一张
  function resolveTemperaShotImage(pool, frequency, seed, previousId) {
    if (pool.length === 0) return null
    if (temperaHash01(seed, 6, 277) >= clamp01(frequency)) return null
    var start = Math.floor(temperaHash01(seed, 7, 281) * pool.length) % pool.length
    for (var offset = 0; offset < pool.length; offset += 1) {
      var candidate = pool[(start + offset) % pool.length]
      if (candidate.id !== previousId) return candidate
    }
    return pool[start]
  }

  // options: { pool, frequency, depth, textures, width, height, seed, flowAngle, previousId }
  function buildTemperaImageLayer(pixi, options) {
    var back = new pixi.Container()
    var front = new pixi.Container()
    var flowX = Math.cos(options.flowAngle)
    var flowY = Math.sin(options.flowAngle)
    var carry = Math.max(options.width, options.height) * 0.09

    var chosen = resolveTemperaShotImage(options.pool, options.frequency, options.seed, options.previousId)
    var texture = chosen ? options.textures.get(chosen.id) : undefined
    if (!chosen || !texture) {
      return {
        back: back,
        front: front,
        updateTime: function () { return undefined },
        applyPool: function () { return undefined },
        chosenId: chosen ? chosen.id : null
      }
    }

    var sprite = new pixi.Sprite(texture)
    sprite.anchor.set(0.5)
    ;(options.depth === 'front' ? front : back).addChild(sprite)
    var creepScale = 0.6 + temperaHash01(options.seed, 8, 283) * 0.8
    var baseX = 0
    var baseY = 0
    var baseAlpha = 1

    // 高度驱动缩放，抠图在任何视口上保持比例
    function place(image) {
      var placement = resolveTemperaImagePlacement(image, options.seed)
      var uniform = texture.height > 0 ? (options.height * placement.scale) / texture.height : 1
      sprite.scale.set(uniform * (placement.flip ? -1 : 1), uniform)
      sprite.rotation = placement.rotation
      baseX = placement.x * options.width
      baseY = placement.y * options.height
      baseAlpha = placement.opacity
    }
    place(chosen)
    sprite.position.set(baseX, baseY)

    function applyPool(pool) {
      var next = null
      for (var i = 0; i < pool.length; i += 1) {
        if (pool[i].id === chosen.id) { next = pool[i]; break }
      }
      if (next) place(next)
    }

    function updateTime(time, shotStart, shotEnd, lyricEnd) {
      var duration = Math.max(shotEnd - shotStart, 0.2)
      var paceDuration = Math.max((lyricEnd !== undefined ? lyricEnd : shotEnd) - shotStart, 0.2)
      var progress = clamp01((time - shotStart) / duration)
      // 图片比色块爬得慢一点，读作纵深而不是整框一起平移
      var creep = easeTemperaInOut(progress) * carry * 0.35 * creepScale
      var enter = easeTemperaEnter((time - shotStart - paceDuration * 0.1) / (paceDuration * 0.5))
      sprite.alpha = baseAlpha * enter
      sprite.visible = enter > 0.001
      sprite.position.set(baseX + flowX * creep, baseY + flowY * creep)
    }

    return { back: back, front: front, updateTime: updateTime, applyPool: applyPool, chosenId: chosen.id }
  }

  window.FoliaTemperaShapes = {
    toPixiColor: toPixiColor,
    buildGradientFill: buildGradientFill,
    drawPolygonFill: drawPolygonFill,
    drawPolygonFillWithHoles: drawPolygonFillWithHoles,
    drawPolygonOutline: drawPolygonOutline,
    drawHatchFill: drawHatchFill,
    drawDiscs: drawDiscs,
    drawRings: drawRings,
    drawLines: drawLines,
    drawPolyline: drawPolyline,
    drawConcentricDiamonds: drawConcentricDiamonds,
    drawCrossMarks: drawCrossMarks,
    drawSquareMarks: drawSquareMarks,
    buildTemperaBlocks: buildTemperaBlocks,
    resolveTemperaImagePlacement: resolveTemperaImagePlacement,
    resolveTemperaShotImage: resolveTemperaShotImage,
    buildTemperaImageLayer: buildTemperaImageLayer
  }
})()
