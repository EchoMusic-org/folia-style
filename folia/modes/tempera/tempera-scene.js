// 凝彩模式·场景构建：移植自 folia-major src/components/visualizer/tempera/
//   temperaTextView.ts（每字素一个 Pixi Text + 套印错位的重影副本）
//   temperaSceneFilters.ts（转场模糊只在真的模糊时挂上——这保住了歌词反色的正确性）
//   temperaSceneBuilder.ts（构建单个有界段落场景；播放期变更留在 runtime 控制器里）
// 后处理的镜头/印刷 GLSL 滤镜复用 sonnet 的工厂（原版即交叉引用 sonnet）。
(function () {
  'use strict'

  var Core = window.FoliaTemperaCore
  var Curves = window.FoliaTemperaCurves
  var Measure = window.FoliaTemperaMeasure
  var Palette = window.FoliaTemperaPalette
  var Shapes = window.FoliaTemperaShapes
  var SonnetFilters = window.FoliaSonnetFilters
  var WordColoring = window.FoliaWordColoring
  var SonnetCore = window.FoliaSonnetCore
  var hashTemperaSeed = Core.hashTemperaSeed
  var temperaHash01 = Core.temperaHash01
  var easeTemperaEnter = Core.easeTemperaEnter
  var drawPolygonFill = Shapes.drawPolygonFill
  var drawHatchFill = Shapes.drawHatchFill
  var drawLines = Shapes.drawLines
  var drawPolygonOutline = Shapes.drawPolygonOutline

  // ---------- 场景滤镜（原版 temperaSceneFilters.ts） ----------
  // 只在段落场景真的在模糊时才把转场模糊挂上去。
  //
  // 这不是微优化，它是让歌词反色保持正确的关键。文字层的差值滤镜声明了
  // blendRequired，Pixi 会把它 bounds 之下已绘制的像素拷进 uBackTexture——
  // 拷贝原点相对滤镜栈上*外层*滤镜取得。挂上但 disabled 的容器滤镜仍会被推入，
  // 作为一条跳过的记录，Pixi 8 的 _getPreviousFilterData 无论如何都会把这条
  // 跳过的记录交回来（它的循环到栈索引 0 为止，不拒绝它）。被跳过的记录从没跑过
  // _calculateFilterArea，bounds 还停在 Infinity；拷贝原点下溢为 0,0，
  // 每个字都对画面左上角反色而不是对它下面的画面
  //
  // 场景级后处理链把这个藏住了：后处理开时外层记录是带真实 bounds 的真记录。
  // 关掉时（默认值）场景容器上剩下的只有停着的转场模糊，恰是那样一条跳过记录。
  // 所以模糊在转场期间挂上、转场结束摘下；它从不停放在 disabled 状态

  // 场景容器上每个滤镜运行的分辨率。压缩开关保持旧的下采样供弱 GPU 使用
  // （'inherit' 或按画布分辨率，见 resolveTemperaPassResolution 的原版长注释）
  function compressedPassResolution(renderResolution) {
    return Math.min(1, renderResolution)
  }

  function resolveTemperaPassResolution(tuning, renderResolution) {
    return tuning.postProcessTextureCompression ? compressedPassResolution(renderResolution) : 'inherit'
  }

  // 转场模糊一直按所在 pass 的一半运行——它本来就在模糊，且只存在于转场期间。
  // 从 pass 推导保持该比例：硬编码 0.5 会在模糊刚挂上（强度还看不出来）的那一帧
  // 直接把 1.5x 场景砍到四分之一
  function resolveTemperaTransitionBlurResolution(tuning, renderResolution) {
    return (tuning.postProcessTextureCompression ? compressedPassResolution(renderResolution) : renderResolution) * 0.5
  }

  // 低于此值模糊是空操作 pass，滤镜整个从场景上摘下
  var BLUR_ACTIVE_STRENGTH = 0.01

  function setTemperaTransitionBlur(scene, strength) {
    var filter = scene.transitionBlurFilter
    if (!filter) return
    var active = strength > BLUR_ACTIVE_STRENGTH
    if (active) filter.strength = strength
    if (active === scene.transitionBlurAttached) return
    scene.transitionBlurAttached = active
    // 空数组让 Pixi 把滤镜效果从容器上摘掉，这正是要点：
    // 没有效果就没有栈条目可供反色滤镜去度量
    scene.container.filters = active ? scene.baseFilters.concat([filter]) : scene.baseFilters
  }

  // ---------- 文字视图（原版 temperaTextView.ts） ----------
  // 每个字素一个 Pixi Text 节点加一个错位的重影副本用于印刷套版错位。
  //
  // 重影住在*反色层之内*，不在它下面。放在下面，重影就成了滤镜采样的底色：
  // 每个字对自己的影子反色、沿笔画碎成硬斑。放在层内，滤镜一视同仁地
  // 给重影与字上色，偏移副本读作第二块印刷版而不是破坏判定。
  // 任何东西也从不画在字后面来强调它——对画面的反色就是强调
  var SHADOW_OFFSET_X = 0.06
  var SHADOW_OFFSET_Y = 0.08

  // options: { placements, palette, fontFamily, fontWeight, shadowEnabled, echoCount, textLayer, echoLayer, keywordLayer }
  function buildTemperaTextViews(pixi, options) {
    var Text = pixi.Text
    var TextStyle = pixi.TextStyle
    var palette = options.palette
    var fontFamily = options.fontFamily
    var fontWeight = options.fontWeight
    var views = []
    var weightToken = String(fontWeight)

    options.placements.forEach(function (placement) {
      if (placement.char.trim().length === 0) return
      var baseStyle = {
        fontFamily: fontFamily,
        fontWeight: weightToken,
        fontSize: placement.fontSize
      }
      var display = new Text({
        text: placement.char,
        style: new TextStyle(Object.assign({}, baseStyle, { fill: placement.color !== null && placement.color !== undefined ? placement.color : palette.ink }))
      })
      display.anchor.set(0.5)
      display.position.set(placement.x, placement.y)
      display.rotation = placement.rotation

      // 半透明度的无模糊偏移副本；滤镜随字一起给它上色，
      // 它读作套版不准的第二块印刷版
      var shadow = null
      if (options.shadowEnabled) {
        shadow = new Text({
          text: placement.char,
          style: new TextStyle(Object.assign({}, baseStyle, { fill: palette.ink }))
        })
        shadow.anchor.set(0.5)
        shadow.rotation = placement.rotation
        options.textLayer.addChildAt(shadow, 0)
      }

      // 运动浮影：沿入场向量退到更远处的调暗副本。运行时按下标放大偏移，
      // 它们读作轨迹而不是模糊
      var echoes = []
      for (var index = 0; index < options.echoCount; index += 1) {
        var echo = new Text({
          text: placement.char,
          style: new TextStyle(Object.assign({}, baseStyle, { fill: placement.color !== null && placement.color !== undefined ? placement.color : palette.tone4 }))
        })
        echo.anchor.set(0.5)
        echo.rotation = placement.rotation
        echo.visible = false
        options.echoLayer.addChild(echo)
        echoes.push(echo)
      }

      ;(placement.color ? options.keywordLayer : options.textLayer).addChild(display)
      views.push({
        display: display,
        shadow: shadow,
        echoes: echoes,
        // 逐帧运动求解器需要的全部数据；runtime 不再读排版
        motion: {
          startTime: placement.startTime,
          settleTime: placement.settleTime,
          endTime: placement.endTime,
          enterX: placement.enterX,
          enterY: placement.enterY,
          enterRotation: placement.enterRotation,
          enterScale: placement.enterScale,
          rotation: placement.rotation,
          enterStyle: placement.enterStyle,
          releaseTime: placement.releaseTime,
          trackingX: placement.trackingX,
          trackingY: placement.trackingY
        },
        baseX: placement.x,
        baseY: placement.y,
        shadowDX: placement.fontSize * SHADOW_OFFSET_X,
        shadowDY: placement.fontSize * SHADOW_OFFSET_Y
      })
    })

    return views
  }

  // 稀疏构图边角停放的碎字。它们没有时间线：shot 自身的入场/出场透明度覆盖它们，
  // 播放从不触碰这些节点
  // options: { fragments, palette, fontFamily, fontWeight, baseFontSize, width, height, layer }
  function buildTemperaFragmentViews(pixi, options) {
    var Text = pixi.Text
    var TextStyle = pixi.TextStyle
    options.fragments.forEach(function (fragment) {
      var node = new Text({
        text: fragment.char,
        style: new TextStyle({
          fontFamily: options.fontFamily,
          fontWeight: String(options.fontWeight),
          fontSize: Math.max(12, options.baseFontSize * fragment.scale),
          fill: options.palette.ink
        })
      })
      node.anchor.set(0.5)
      node.position.set(fragment.x * options.width, fragment.y * options.height)
      node.rotation = fragment.rotation
      node.alpha = 0.42
      options.layer.addChild(node)
    })
  }

  // 构图背后的超大装饰词。刻意放在*反色文字层之下*，
  // 歌词跨过水印笔画的地方翻色——装饰成为文字所反应的画面的一部分，
  // 而不是第二段歌词
  // options: { watermark, palette, fontFamily, fontWeight, baseFontSize, width, height, layer }
  function buildTemperaWatermark(pixi, options) {
    var watermark = options.watermark
    if (!watermark.text.trim()) return
    var node = new pixi.Text({
      text: watermark.text,
      style: new pixi.TextStyle({
        fontFamily: options.fontFamily,
        fontWeight: String(options.fontWeight),
        fontSize: Math.max(48, options.baseFontSize * watermark.scale),
        fill: options.palette.tone4
      })
    })
    node.anchor.set(0.5)
    node.position.set(watermark.x * options.width, watermark.y * options.height)
    node.rotation = watermark.rotation
    node.alpha = 0.16
    options.layer.addChild(node)
  }

  // ---------- 场景构建（原版 temperaSceneBuilder.ts） ----------
  function hasTemperaCreditsMetadata(metadata) {
    return Boolean(
      (metadata.title && metadata.title.trim())
      || (metadata.artist && metadata.artist.trim())
      || (metadata.album && metadata.album.trim())
    )
  }

  // 歌词的颜色滤镜。gradient 模式下 ramp 只作为滤镜的 tint 存在，
  // 所以关掉 textInversion 绝不能连滤镜一起关——那会把整个色彩模式
  // 退回平墨。没有 ramp 又没有反色时无事可做，层保持不过滤
  function createTemperaTextFilter(pixi, palette, inversion) {
    if (!inversion && !palette.textGradient) return null
    return Palette.createTemperaDifferenceFilter(pixi, {
      ink: palette.ink,
      paper: palette.paper,
      tint: palette.textGradient,
      inversion: inversion
    })
  }

  // 渐近：永远在动，永远不会跑飞
  function creditsCreep(elapsed) {
    return 1 - Math.exp(-Math.max(0, elapsed) / 7)
  }

  // 有多少块体量压进来。三块足够横跨文字而不弄脏它
  var CREDITS_DISC_COUNT = 3

  // options: { theme, tuning, palette, metadata, width, height, lyricsFontScale }
  function buildTemperaCreditsPoster(pixi, options) {
    var palette = options.palette
    var metadata = options.metadata
    var width = options.width
    var height = options.height
    var Container = pixi.Container
    var Text = pixi.Text
    var TextStyle = pixi.TextStyle
    var container = new Container()
    var filters = []
    var items = []
    var seed = hashTemperaSeed((metadata.title || '') + '|' + (metadata.artist || ''))
    var diagonal = Math.hypot(width, height)
    var bleed = diagonal * 0.25
    var halfWidth = width / 2
    var halfHeight = height / 2
    // 一枚种子位镜像整个布局，卡不总是同一幅画面
    var flip = temperaHash01(seed, 1, 229) > 0.5 ? 1 : -1
    // gradient 模式给每个 shot 的填充走 ramp；没有它这张卡就是全歌唯一的
    // 平涂帧，而这正是读成外来设计的那个东西
    var gradient = palette.gradient
      ? { colors: palette.gradient, angle: temperaHash01(seed, 3, 197) * Math.PI * 2 }
      : null

    function add(node, item) {
      item = item || {}
      items.push({
        node: node,
        baseX: node.x,
        baseY: node.y,
        baseAlpha: item.baseAlpha !== undefined ? item.baseAlpha : 1,
        enterDX: item.enterDX !== undefined ? item.enterDX : 0,
        enterDY: item.enterDY !== undefined ? item.enterDY : 0,
        delay: item.delay !== undefined ? item.delay : 0,
        driftX: item.driftX !== undefined ? item.driftX : 0,
        driftY: item.driftY !== undefined ? item.driftY : 0,
        grow: item.grow !== undefined ? item.grow : 0
      })
      container.addChild(node)
    }

    // 色调地面，与构图的铺法完全一致：满出血、自身不动
    container.addChild(drawPolygonFill(
      pixi,
      Curves.rectPolygon(-halfWidth - bleed, -halfHeight - bleed, width + bleed * 2, height + bleed * 2),
      palette.tone1,
      1,
      gradient
    ))

    // 体量叠上来时沿色调阶梯爬升，最后进来的最亮，文字有真边可跨，
    // 而不是三块近似灰
    var tones = [palette.tone2, palette.tone3, palette.tone4]
    var baseAngle = temperaHash01(seed, 4, 241) * Math.PI * 2
    var hatchIndex = Math.floor(temperaHash01(seed, 5, 251) * CREDITS_DISC_COUNT) % CREDITS_DISC_COUNT

    for (var index = 0; index < CREDITS_DISC_COUNT; index += 1) {
      // 绕画面散开，再在各自那份圆周内抖动
      var angle = baseAngle
        + (index * Math.PI * 2) / CREDITS_DISC_COUNT
        + (temperaHash01(seed, index, 257) - 0.5) * 0.7
      var distance = diagonal * (0.58 + temperaHash01(seed, index, 263) * 0.14)
      // 近端越过中点，这正是弧线横跨文字的原因
      var radius = distance + diagonal * (0.06 + temperaHash01(seed, index, 269) * 0.1)
      var polygon = Curves.circlePolygon(0, 0, radius, 72)
      var cx = Math.cos(angle) * distance
      var cy = Math.sin(angle) * distance
      var delay = 0.08 + index * 0.16
      // 沿各自的向内向量进场，之后沿同一方向持续爬行
      var travel = {
        enterDX: Math.cos(angle) * diagonal * 0.16,
        enterDY: Math.sin(angle) * diagonal * 0.16,
        driftX: -Math.cos(angle) * diagonal * 0.024,
        driftY: -Math.sin(angle) * diagonal * 0.024
      }
      var place = function (node, itemDelay) {
        node.position.set(cx, cy)
        add(node, Object.assign({}, travel, { delay: itemDelay }))
      }

      place(drawPolygonFill(pixi, polygon, tones[index], 1, gradient), delay)
      if (index === hatchIndex) {
        // 唯一的一道网点。没有它卡是平面向量图——shot 构图从来不是
        place(drawHatchFill(pixi, polygon, Curves.buildHatchSpec(seed, 271), palette.paper, 0.28), delay + 0.06)
      }
      // 墨缝粗细对齐分割族的 addSeam：硬墨，不是发丝线
      place(drawPolygonOutline(pixi, polygon, palette.ink, 2.4, 0.8), delay + 0.04)
    }

    // 每个 shot 都带的两层：满出血导引线，然后角落 motif
    var lines = Curves.buildCrossingLines(seed, 31, width, height, 2)
      .map(function (line) {
        return {
          x1: line.x1 - halfWidth,
          y1: line.y1 - halfHeight,
          x2: line.x2 - halfWidth,
          y2: line.y2 - halfHeight
        }
      })
    add(drawLines(pixi, lines, palette.tone4, 1.3, 0.6), { delay: 0.5, enterDX: width * 0.2 })

    if (options.tuning.showDecor) {
      var cornerX = halfWidth * 0.66 * flip
      var cornerY = halfHeight * 0.62
      add(Shapes.drawCrossMarks(
        pixi,
        Curves.buildCrossRow(seed, 71, cornerX - width * 0.1, cornerY, 5, width * 0.05, 8),
        palette.tone4,
        2,
        0.8
      ), { delay: 0.62, enterDX: -width * 0.06 })
      var box = Curves.rectPolygon(-cornerX - 19, -cornerY - 19, 38, 38)
      add(drawHatchFill(pixi, box, Curves.buildHatchSpec(seed, 67), palette.tone4, 0.7), { delay: 0.68, grow: 0.06 })
      add(drawPolygonOutline(pixi, box, palette.tone4, 1.2, 0.6), { delay: 0.72 })
    }

    var fontFamily = SonnetCore.resolveThemeFontStack(options.theme)
    var fontWeight = String(SonnetCore.resolveThemeFontWeight(options.theme, 600))
    var wrapWidth = Math.min(width * 0.72, diagonal * 0.52)
    var subtitle = [metadata.artist, metadata.album].filter(Boolean).join(' - ')
    var titleLayer = new Container()
    var titleSize = Math.max(26, Math.min(width, height) * 0.085 * options.lyricsFontScale)

    var buildLine = function (text, size, offsetY, alpha) {
      var node = new Text({
        text: text,
        style: new TextStyle({
          fontFamily: fontFamily,
          fontWeight: fontWeight,
          fontSize: size,
          fill: palette.ink,
          align: 'center',
          wordWrap: true,
          wordWrapWidth: wrapWidth
        })
      })
      node.anchor.set(0.5)
      node.position.set(0, offsetY)
      node.alpha = alpha
      titleLayer.addChild(node)
      return node
    }

    var title = buildLine(metadata.title && metadata.title.trim() ? metadata.title.trim() : '♪', titleSize, subtitle ? -titleSize * 0.35 : 0, 1)
    if (subtitle) buildLine(subtitle, Math.max(14, titleSize * 0.34), title.height / 2 + titleSize * 0.22, 0.75)

    // 标题不动，形状在它下面移动，反色因此不断重新切它
    var titleFilter = createTemperaTextFilter(pixi, palette, options.tuning.textInversion)
    if (titleFilter) {
      titleLayer.filters = [titleFilter]
      filters.push(titleFilter)
    }
    add(titleLayer, { enterDY: diagonal * 0.03, delay: 0.78 })

    function updateTime(elapsed) {
      var creep = creditsCreep(elapsed)
      items.forEach(function (item) {
        var enter = easeTemperaEnter((elapsed - item.delay) / 1.1)
        item.node.alpha = item.baseAlpha * enter
        item.node.visible = enter > 0.001
        item.node.position.set(
          item.baseX + item.enterDX * (1 - enter) + item.driftX * creep,
          item.baseY + item.enterDY * (1 - enter) + item.driftY * creep
        )
        if (item.grow !== 0) item.node.scale.set(1 + item.grow * creep)
      })
    }
    updateTime(0)
    return { container: container, filters: filters, updateTime: updateTime }
  }

  // 从 tuning 装配场景后处理链；GLSL 工厂与 sonnet 共享
  function applyTemperaScenePostProcess(pixi, container, tuning, seed, renderResolution) {
    var filters = []
    if (tuning.postProcessLensDistortion > 0) {
      filters.push(SonnetFilters.createSonnetLensFilter(pixi, {
        distortion: tuning.postProcessLensDistortion,
        dispersion: 0
      }))
    }
    if (tuning.postProcessGrain > 0) {
      filters.push(new pixi.NoiseFilter({
        noise: tuning.postProcessGrain * 0.35,
        seed: (seed % 10000) / 10000,
        antialias: 'on'
      }))
    }
    if (tuning.postProcessContrast > 0) {
      var colorMatrix = new pixi.ColorMatrixFilter()
      colorMatrix.contrast(tuning.postProcessContrast * 0.5, false)
      colorMatrix.antialias = 'on'
      filters.push(colorMatrix)
    }
    var printFilters = SonnetFilters.createSonnetPrintFilters(pixi, {
      rgbShift: tuning.postProcessRgbShift,
      halftone: 0,
      vignette: tuning.postProcessVignette
    })
    if (printFilters.length > 0) filters = filters.concat(printFilters)
    // 数组里每个 pass 必须携带同一分辨率——Pixi 对整个容器取最小值——
    // 共享的 sonnet 工厂都不设它，否则各自默认硬编码 1。
    // 见 resolveTemperaPassResolution 的原版长注释
    var resolution = resolveTemperaPassResolution(tuning, renderResolution)
    filters.forEach(function (filter) {
      filter.resolution = resolution
    })
    if (filters.length > 0) container.filters = filters
    return filters
  }

  // options: { programSeed, host, theme, tuning, renderResolution, lyricsFontScale, staticMode, coverColors, imageTextures }
  function buildTemperaScene(pixi, options, paragraph) {
    var Container = pixi.Container
    var Graphics = pixi.Graphics
    var width = Math.max(options.host.clientWidth, 320)
    var height = Math.max(options.host.clientHeight, 240)
    var container = new Container()
    var tuning = options.tuning
    var palette = Palette.resolveTemperaPalette(options.theme, tuning, options.coverColors)
    var sceneSeed = hashTemperaSeed(options.programSeed + ':' + paragraph.id)
    var fontFamily = SonnetCore.resolveThemeFontStack(options.theme)
    var fontWeight = SonnetCore.resolveThemeFontWeight(options.theme, 600)

    // 一层半透明纸雾把色块颜色与外壳背景统一起来，上面的点阵给整个画面
    // 印刷纸面的颗粒。两者都按段落场景只建一次，播放期间不再触碰
    var paperWash = new Graphics()
      .rect(0, 0, width, height)
      .fill({ color: pixi.Color.shared.setValue(palette.paper).toNumber(), alpha: 0.35 })
    paperWash.visible = tuning.showBlocks
    container.addChild(paperWash)
    if (tuning.showBlocks) {
      // 间距随视口增长，格阵在任何显示上都保持约 3k 点
      var toneSpacing = Math.max(26, Math.sqrt((width * height) / 6000))
      var screentone = Shapes.drawSquareMarks(pixi, Curves.buildDotGrid(width, height, toneSpacing, 1.6), palette.tone4, 0.05)
      container.addChild(screentone)
    }

    var postProcessFilters = []
    // Tempera 刻意没有辉光层：screen 混合的光晕把字推向白，
    // 而且无论落在哪都变成反色滤镜要读的底色
    //
    // 反色不是后处理 pass：它是这个模式给文字上色的方式，
    // 所以它有自己的 textInversion 开关（默认开），
    // 不挂在默认 false 的 postProcessEnabled 下

    // 关键字着色：主题的 wordColors 按行匹配一次，作为逐段颜色交给排版器。
    // 命中的字素退出反色滤镜，色相才能落地
    var wordColorMatchers = WordColoring.prepareWordColorMatchers(options.theme.wordColors)
    var colorRangesByLine = new Map()
    paragraph.lines.forEach(function (line) {
      colorRangesByLine.set(
        line.sourceIndex,
        wordColorMatchers.length > 0
          ? WordColoring.buildWordColorRangesFromMatchers(line.line.fullText, wordColorMatchers)
          : []
      )
    })

    // 线程化：相邻 shot 不落在同一张图上
    var lastImageId = null
    var shots = paragraph.shots.map(function (shot, shotIndex) {
      var shotContainer = new Container()
      // 一个 shot 通常显示一个半句切片；整句模式刻意用一些字号换整行同屏
      var sliceSegments = shot.slices.map(function (slice) {
        var compiledLine = null
        paragraph.lines.forEach(function (item) {
          if (item.sourceIndex === slice.lineIndex) compiledLine = item
        })
        return {
          slice: slice,
          segments: compiledLine
            ? compiledLine.segments.slice(slice.segmentStart, slice.segmentEnd).filter(Measure.isTemperaLayoutSegment)
            : []
        }
      }).filter(function (entry) { return entry.segments.length > 0 })
      var linesSegments = sliceSegments.map(function (entry) { return entry.segments })
      var segmentColors = sliceSegments.map(function (entry) {
        var ranges = colorRangesByLine.get(entry.slice.lineIndex) || []
        return entry.segments.map(function (segment) {
          var found = null
          ranges.forEach(function (range) {
            if (range.startOffset < segment.endOffset && segment.startOffset < range.endOffset) found = range
          })
          return found ? found.color : null
        })
      })

      var maxGraphemes = 3
      linesSegments.forEach(function (segments) {
        var total = segments.reduce(function (sum, segment) { return sum + segment.graphemes.length }, 0)
        maxGraphemes = Math.max(maxGraphemes, total)
      })
      var baseFontSize = Math.max(34, Math.min(150, (width / Math.max(5, maxGraphemes * 1.05)) * 1.5)) * options.lyricsFontScale

      var shotSeed = sceneSeed + shotIndex * 97
      var blocks = Shapes.buildTemperaBlocks(pixi, {
        kind: shot.kind,
        decor: shot.decor,
        palette: palette,
        width: width,
        height: height,
        seed: shotSeed,
        showDecor: tuning.showDecor,
        flowAngle: shot.flowAngle
      })
      blocks.container.visible = tuning.showBlocks

      var images = Shapes.buildTemperaImageLayer(pixi, {
        pool: tuning.layerImages,
        frequency: tuning.layerImageFrequency,
        depth: tuning.layerImageDepth,
        textures: options.imageTextures,
        width: width,
        height: height,
        seed: shotSeed,
        flowAngle: shot.flowAngle,
        previousId: lastImageId
      })
      if (images.chosenId !== null) lastImageId = images.chosenId
      var watermarkLayer = new Container()
      var textLayer = new Container()
      var echoLayer = new Container()
      var keywordLayer = new Container()
      // 次序很重要。反色滤镜应该读到的一切都必须在文字层之前渲染——
      // 包括装饰水印，这正是它的意义：歌词跨过那些笔画时翻色。
      // 但字形状的东西绝不能去那里，否则每个字对自己的重影反色、碎成斑块。
      // 浮影与关键字着色的字素在其后渲染、不过滤，保住颜色。
      // back 图像加入反色读取的画面；front 图像盖住一切，包括歌词
      shotContainer.addChild(
        blocks.container,
        images.back,
        watermarkLayer,
        textLayer,
        echoLayer,
        keywordLayer,
        images.front
      )

      var placements = Measure.resolveTemperaLayout({
        lines: linesSegments,
        shotKind: shot.kind,
        width: width,
        height: height,
        baseFontSize: baseFontSize,
        fontFamily: fontFamily,
        fontWeight: fontWeight,
        seed: shotSeed,
        segmentColors: segmentColors,
        settleStretch: tuning.glyphSettleStretch
      })
      var glyphs = buildTemperaTextViews(pixi, {
        placements: placements,
        palette: palette,
        fontFamily: fontFamily,
        fontWeight: fontWeight,
        shadowEnabled: tuning.showDecor,
        echoCount: tuning.showDecor && !options.staticMode ? 2 : 0,
        textLayer: textLayer,
        echoLayer: echoLayer,
        keywordLayer: keywordLayer
      })
      if (shot.decor.watermark && tuning.showDecor) {
        buildTemperaWatermark(pixi, {
          watermark: shot.decor.watermark,
          palette: palette,
          fontFamily: fontFamily,
          fontWeight: fontWeight,
          baseFontSize: baseFontSize,
          width: width,
          height: height,
          layer: watermarkLayer
        })
      }
      if (shot.decor.fragments.length > 0 && tuning.showDecor) {
        buildTemperaFragmentViews(pixi, {
          fragments: shot.decor.fragments,
          palette: palette,
          fontFamily: fontFamily,
          fontWeight: fontWeight,
          baseFontSize: baseFontSize,
          width: width,
          height: height,
          layer: textLayer
        })
      }
      // 只挂在文字层上：blendRequired 每帧都拷贝这些 bounds 之下的像素，
      // 这里再来一个全场景滤镜就是一次视口尺寸的 blit。
      // gradient 色彩模式下 ramp 以 tint 随行——滤镜仍判定亮度，
      // 这是让歌词对任意画面保持可读的唯一东西。反色关掉时同一条 ramp
      // 独自生效，不读底色
      var textFilter = createTemperaTextFilter(pixi, palette, tuning.textInversion)
      if (textFilter) {
        textLayer.filters = [textFilter]
        postProcessFilters.push(textFilter)
      }
      // 桥 shot 没有字要揭示，镜头呼吸可以立即开始——
      // 器乐间隙不该持着一副僵死的画面
      var revealDoneTime = glyphs.length > 0
        ? glyphs.reduce(function (max, glyph) { return Math.max(max, glyph.motion.settleTime) }, 0)
        : shot.startTime

      shotContainer.pivot.set(width / 2, height / 2)
      shotContainer.position.set(width / 2, height / 2)
      // 运行时从绝对播放时间让 shot 参与渲染
      shotContainer.visible = false
      container.addChild(shotContainer)
      return {
        shot: shot,
        container: shotContainer,
        glyphs: glyphs,
        blocks: blocks,
        images: images,
        baseX: shotContainer.x,
        baseY: shotContainer.y,
        textLayer: textLayer,
        revealDoneTime: revealDoneTime
      }
    })

    var baseFilters = []
    if (tuning.postProcessEnabled && !options.staticMode) {
      var sceneFilters = applyTemperaScenePostProcess(pixi, container, tuning, sceneSeed, options.renderResolution)
      if (sceneFilters.length > 0) {
        // 可见 bounds 更小时也让全场景着色器保持在视口空间
        container.filterArea = new pixi.Rectangle(0, 0, width, height)
        baseFilters = baseFilters.concat(sceneFilters)
        postProcessFilters = postProcessFilters.concat(sceneFilters)
      }
    }

    var transitionBlurFilter = tuning.enableTransitions && !options.staticMode
      ? new pixi.BlurFilter({
        strength: 0,
        quality: 1,
        kernelSize: 5,
        resolution: resolveTemperaTransitionBlurResolution(tuning, options.renderResolution)
      })
      : null
    if (transitionBlurFilter) {
      // padding 钉在 0，让渐入的模糊永不重缩放共享的暗角 pass
      transitionBlurFilter.repeatEdgePixels = true
      // 挂着但 disabled 会让它成为一条错置反色底色拷贝的跳过栈记录，
      // 所以运行时改为按转场挂取——见上方 setTemperaTransitionBlur
      postProcessFilters.push(transitionBlurFilter)
    }
    container.visible = false
    return {
      paragraph: paragraph,
      container: container,
      shots: shots,
      palette: palette,
      postProcessFilters: postProcessFilters,
      baseFilters: baseFilters,
      transitionBlurFilter: transitionBlurFilter,
      transitionBlurAttached: false,
      activeShotIndex: -1
    }
  }

  window.FoliaTemperaScene = {
    hasTemperaCreditsMetadata: hasTemperaCreditsMetadata,
    buildTemperaCreditsPoster: buildTemperaCreditsPoster,
    buildTemperaScene: buildTemperaScene,
    setTemperaTransitionBlur: setTemperaTransitionBlur,
    resolveTemperaPassResolution: resolveTemperaPassResolution,
    resolveTemperaTransitionBlurResolution: resolveTemperaTransitionBlurResolution
  }
})()
