// 凝彩模式·Pixi 运行时：移植自 folia-major src/components/visualizer/tempera/createTemperaPixiRuntime.ts
// 持有 Pixi 生命周期，从绝对播放时间直接驱动有界场景视图。
// Tempera 不加载任何外部纹理，destroy 只走 滤镜 → 容器 → app。
// 原版的 MotionValue(currentTime) 改为每帧由模式入口注入的普通数值；
// loadPixi 的 mediump→highp 精度翻转照搬（在创建渲染器前执行）；
// AbortSignal 参数省略（插件无取消语义），其余逐行对齐。
(function () {
  'use strict'

  var Core = window.FoliaTemperaCore
  var Program = window.FoliaTemperaProgram
  var Scene = window.FoliaTemperaScene
  var Palette = window.FoliaTemperaPalette

  var clamp01 = Core.clamp01
  var easeTemperaEnter = Core.easeTemperaEnter
  var easeTemperaInOut = Core.easeTemperaInOut
  var resolveShotPacedDuration = Core.resolveShotPacedDuration
  var resolveTemperaGlyphMotion = Core.resolveTemperaGlyphMotion
  var resolveTemperaCameraFrame = Core.resolveTemperaCameraFrame
  var resolveTemperaCameraBreath = Core.resolveTemperaCameraBreath
  var resolveTemperaBreathWeight = Core.resolveTemperaBreathWeight
  var resolveTemperaAnimationScale = Core.resolveTemperaAnimationScale
  var resolveCreditsFrame = Core.resolveCreditsFrame
  var setPixiDisplayTreeVisibility = Core.setPixiDisplayTreeVisibility
  var hashTemperaSeed = Core.hashTemperaSeed
  var resolveTemperaExitTransitionFrame = Core.resolveTemperaExitTransitionFrame
  var resolveTemperaEnterTransitionFrame = Core.resolveTemperaEnterTransitionFrame
  var SonnetCore = window.FoliaSonnetCore

  /**
   * 把图片 blob 解码为 Pixi 可用的对象。createImageBitmap 处理所有位图格式；
   * SVG 是它常拒绝的那种，回落到 Image 元素。
   */
  function decodeImageBlob(blob) {
    return new Promise(function (resolve, reject) {
      var failed = false
      try {
        createImageBitmap(blob).then(resolve, function () { failed = true })
      } catch (e) {
        failed = true
      }
      if (!failed) return
      // createImageBitmap 不可用或拒绝（SVG 等）：回落到 Image 元素
      var url = URL.createObjectURL(blob)
      var image = new Image()
      image.decoding = 'async'
      image.onload = function () {
        resolve(image)
        URL.revokeObjectURL(url)
      }
      image.onerror = function () {
        reject(new Error('Tempera layer image failed to decode'))
        URL.revokeObjectURL(url)
      }
      image.src = url
    })
  }

  function closeImageBitmap(source) {
    if (typeof ImageBitmap !== 'undefined' && source instanceof ImageBitmap) source.close()
  }

  // 判断某组 tuning 是否要求重建场景（原版 requiresSceneRebuild）。
  // 镜头与逐字运动每帧现读，图片放置直接重设到已有 sprite 上，都不必丢缓存；
  // 图片*集合*会：新 id 还没有 sprite
  function requiresSceneRebuild(previous, next) {
    return previous.colorMode !== next.colorMode
      // 渲染器分辨率与固定分辨率滤镜 pass 必须一起变
      || previous.textureResolution !== next.textureResolution
      // 入场节奏在排版期烘进每个字的 settleTime，不同于每帧现读的 glyphMotion
      || previous.glyphSettleStretch !== next.glyphSettleStretch
      || previous.showBlocks !== next.showBlocks
      || previous.showDecor !== next.showDecor
      || previous.textInversion !== next.textInversion
      || previous.enableTransitions !== next.enableTransitions
      || previous.postProcessEnabled !== next.postProcessEnabled
      // 构建期烘进场景上每个滤镜，无法就地推送
      || previous.postProcessTextureCompression !== next.postProcessTextureCompression
      || previous.postProcessGrain !== next.postProcessGrain
      || previous.postProcessContrast !== next.postProcessContrast
      || previous.postProcessRgbShift !== next.postProcessRgbShift
      || previous.postProcessVignette !== next.postProcessVignette
      || previous.postProcessLensDistortion !== next.postProcessLensDistortion
      || previous.layerImageDepth !== next.layerImageDepth
      || previous.layerImageFrequency !== next.layerImageFrequency
      || previous.layerImages.length !== next.layerImages.length
      || previous.layerImages.some(function (image, index) {
        return image.id !== (next.layerImages[index] && next.layerImages[index].id)
          || image.align !== (next.layerImages[index] && next.layerImages[index].align)
          || image.verticalAlign !== (next.layerImages[index] && next.layerImages[index].verticalAlign)
      })
  }

  function TemperaPixiRuntime(pixi, options, app) {
    this.pixi = pixi
    this.options = options
    this.app = app
    this.sceneCache = new Map()
    // 歌曲交接替换掉的场景，等待释放。销毁一个场景要遍历每个 shot、每个字的 Text，
    // 在交换落地那一帧对整个缓存这样做正是擦除想藏起来的那记卡顿。
    // 它们改为在清扫结束后每帧丢一个
    this.retiredScenes = []
    this.activeParagraphIndex = -1
    this.destroyed = false
    this.resizeObserver = null
    this.lastWidth = 0
    this.lastHeight = 0
    // 渲染器实际跑的分辨率：纹理池吸附后的 textureResolution。
    // 它同时取决于视口与设置，所以每次 resize 与每次 tuning 变化都重算，
    // 而不是从 tuning 读——固定分辨率的滤镜 pass 也从这里派生
    this.renderResolution = 1
    this.sceneContainer = null
    this.creditsContainer = null
    this.credits = null
    this.imageTextures = new Map()
    this.overlayContainer = null
    this.wipeGraphics = null
    // 一次进行中的歌曲交接，恰好铺开在两帧上。换歌在这里是一次普通的切——
    // 无擦除、无溶解——但切不能同时是卡顿，所以入画场景在第一帧上构建、
    // 出画歌曲仍握着画面，第二帧换内容。被换掉的稍后释放，每帧一个场景
    this.songSwap = null

    // 每帧注入的播放状态（原版为 options.currentTime.get()）
    this.currentTimeValue = 0

    this.renderFrameBound = this.renderFrame.bind(this)
  }

  // options: { host, songSeed, program, theme, tuning, lyricsFontScale, staticMode,
  //            coverColors, imageBlobs, paused, songTitle, songArtist, songAlbum }
  TemperaPixiRuntime.create = function (options) {
    var pixi = window.PIXI
    // 原版 loadPixi：必须在构造任何渲染器/滤镜/着色器之前提升默认着色精度，
    // 否则首个编译的程序会带 mediump 变体（Linux NVIDIA 上 NoiseFilter 会出现黑三角）
    if (pixi.GlProgram && pixi.GlProgram.defaultOptions) {
      pixi.GlProgram.defaultOptions.preferredFragmentPrecision = 'highp'
    }
    var app = new pixi.Application()
    var width = Math.max(options.host.clientWidth, 320)
    var height = Math.max(options.host.clientHeight, 240)
    var resolution = SonnetCore.snapResolutionToTexturePool(width, height, options.tuning.textureResolution)
    return app.init({
      width: width,
      height: height,
      backgroundAlpha: 0,
      antialias: true,
      autoDensity: true,
      resolution: resolution,
      autoStart: false,
      sharedTicker: false,
      preference: 'webgl',
      powerPreference: 'high-performance',
      // 文字层的差值滤镜声明了 blendRequired；没有 back buffer 的话
      // WebGL 渲染器会跳过整个滤镜栈
      useBackBuffer: true
    }).then(function () {
      var runtime = new TemperaPixiRuntime(pixi, options, app)
      runtime.renderResolution = resolution
      runtime.sceneContainer = new pixi.Container()
      // 段落场景在边界期间重叠，必须按段落次序堆叠
      runtime.sceneContainer.sortableChildren = true
      runtime.creditsContainer = new pixi.Container()
      runtime.overlayContainer = new pixi.Container()
      app.stage.addChild(runtime.sceneContainer, runtime.creditsContainer, runtime.overlayContainer)

      // 纹理只加载一次、被每个场景共享：段落场景随播放重建，
      // 每次重建都重载一张立绘会来回抖
      return runtime.loadImageTextures().then(function () {
        options.host.appendChild(app.canvas)
        app.canvas.style.cssText = 'width:100%;height:100%;display:block'
        runtime.install()
        return runtime
      })
    })
  }

  TemperaPixiRuntime.prototype.install = function () {
    this.resizeToHost()
    this.app.ticker.add(this.renderFrameBound)
    var self = this
    this.resizeObserver = new ResizeObserver(function () {
      if (self.destroyed || !self.resizeToHost()) return
      if (self.options.paused) self.renderOnce()
    })
    this.resizeObserver.observe(this.options.host)
    this.renderOnce()
    if (!this.options.paused) this.app.start()
  }

  // 本视口应使用的渲染分辨率。回落到宿主自身尺寸，这样第一次 resize 之前
  // 到来的 tuning 变化也拿得到正确的值
  TemperaPixiRuntime.prototype.resolveRenderResolution = function (tuning) {
    var width = this.lastWidth || Math.max(this.options.host.clientWidth, 320)
    var height = this.lastHeight || Math.max(this.options.host.clientHeight, 240)
    return SonnetCore.snapResolutionToTexturePool(width, height, tuning.textureResolution)
  }

  TemperaPixiRuntime.prototype.resizeToHost = function () {
    if (this.destroyed) return false
    var width = Math.max(this.options.host.clientWidth, 320)
    var height = Math.max(this.options.host.clientHeight, 240)
    if (width === this.lastWidth && height === this.lastHeight) return false
    this.lastWidth = width
    this.lastHeight = height
    // 吸附是视口的函数而不只是设置的函数：一次 resize 自己就能把 pass
    // 推过池的档位边界。把它传给 resize，让表面与其分辨率在一次调用里保持一致；
    // 场景反正要在下面被丢弃
    this.renderResolution = this.resolveRenderResolution(this.options.tuning)
    this.app.renderer.resize(width, height, this.renderResolution)
    // 暂存是按旧视口摆的，布局已不再合适
    if (this.songSwap && this.songSwap.staged) {
      this.discardStaged(this.songSwap.staged)
      this.songSwap.staged = null
    }
    this.clearScenes()
    this.drawCredits(width, height)
    this.drawOverlay(width, height)
    return true
  }

  // 为一首歌构建片尾海报但不安装它，交接便能在色块之下准备入画的那张，
  // 而不是在交换落地那一帧构建
  TemperaPixiRuntime.prototype.buildCreditsView = function (song, scenePalette, width, height) {
    var metadata = {
      title: this.options.songTitle,
      artist: this.options.songArtist,
      album: this.options.songAlbum
    }
    if (!Scene.hasTemperaCreditsMetadata(metadata)) return null
    // 任何场景都不存在时（只有元数据的歌），海报用新解析的调色板
    var palette = scenePalette !== undefined && scenePalette !== null
      ? scenePalette
      : Palette.resolveTemperaPalette(song.theme, this.options.tuning, song.coverColors)
    return Scene.buildTemperaCreditsPoster(this.pixi, {
      theme: song.theme,
      tuning: this.options.tuning,
      palette: palette,
      metadata: metadata,
      width: width,
      height: height,
      lyricsFontScale: this.options.lyricsFontScale
    })
  }

  TemperaPixiRuntime.prototype.adoptCredits = function (view, width, height) {
    this.disposeCredits()
    this.credits = view
    if (!view) return
    this.creditsContainer.addChild(view.container)
    // 海报已经围绕自身原点构建，pivot 保持为零，每帧的 position 单独居中。
    // 再给它一个视口 pivot 会把整张卡停在左上角、切掉一半
    this.creditsContainer.pivot.set(0, 0)
    this.creditsContainer.position.set(width / 2, height / 2)
    this.creditsContainer.visible = false
  }

  TemperaPixiRuntime.prototype.drawCredits = function (width, height) {
    var paletteScene = null
    var sceneKey = Math.max(0, this.activeParagraphIndex)
    if (this.sceneCache.has(sceneKey)) paletteScene = this.sceneCache.get(sceneKey).palette
    this.adoptCredits(
      this.buildCreditsView(this.liveSong(), paletteScene, width, height),
      width,
      height
    )
  }

  TemperaPixiRuntime.prototype.setSongMetadata = function (metadata) {
    if (this.destroyed) return
    var changed = this.options.songTitle !== metadata.title
      || this.options.songArtist !== metadata.artist
      || this.options.songAlbum !== metadata.album
    if (!changed) return

    this.options.songTitle = metadata.title
    this.options.songArtist = metadata.artist
    this.options.songAlbum = metadata.album
    // 元数据与换歌落在同一次 React commit，交接已经在自己的帧上构建入画海报。
    // 这里再画一次就是第二次构建
    var swap = this.songSwap
    if (swap) {
      // 除非它在这暂存与切换之间的一帧里变了——那样暂存的卡带着出画歌的名字，
      // 必须重建
      if (swap.pending && swap.staged && this.lastWidth > 0 && this.lastHeight > 0) {
        var stale = swap.staged.credits
        swap.staged.credits = this.buildCreditsView(
          swap.pending,
          swap.staged.scene.palette,
          this.lastWidth,
          this.lastHeight
        )
        if (stale) this.destroyCreditsView(stale)
      }
      return
    }
    if (this.lastWidth > 0 && this.lastHeight > 0) {
      this.drawCredits(this.lastWidth, this.lastHeight)
      if (this.options.paused) this.renderOnce()
    }
  }

  TemperaPixiRuntime.prototype.drawOverlay = function (width, height) {
    var pixi = this.pixi
    var self = this
    this.overlayContainer.removeChildren().forEach(function (child) {
      child.destroy({ children: true })
    })
    // 擦除块住在 overlay 里，切换期间从场景上方扫过
    this.wipeGraphics = new pixi.Graphics()
    this.wipeGraphics.visible = false
    this.overlayContainer.addChild(this.wipeGraphics)

    if (!this.options.tuning.showDecor) return
    var g = new pixi.Graphics()
    var primary = pixi.Color.shared.setValue(this.options.theme.primaryColor).toNumber()
    var paddingX = Math.max(28, width * 0.045)
    var paddingY = Math.max(28, height * 0.045)
    // 极简的角部对位记号，呼应印刷风色块的美学
    g.moveTo(paddingX, paddingY + 14).lineTo(paddingX, paddingY).lineTo(paddingX + 14, paddingY)
      .stroke({ color: primary, width: 1.5, alpha: 0.5 })
    g.moveTo(width - paddingX - 14, height - paddingY).lineTo(width - paddingX, height - paddingY).lineTo(width - paddingX, height - paddingY - 14)
      .stroke({ color: primary, width: 1.5, alpha: 0.5 })
    this.overlayContainer.addChild(g)
    void self
  }

  // 直接从用户的 blob 解码。刻意不用 Assets.load：它按 URL 的扩展名选解析器，
  // 而 blob URL 没有扩展名，会直接拒绝。在这里解码也意味着没有 object URL 会泄漏。
  // 本插件无图片导入 UI，imageBlobs 恒为空 Map，此方法自然空跑
  TemperaPixiRuntime.prototype.loadImageTextures = function () {
    var blobs = this.options.imageBlobs
    var self = this
    if (!blobs || blobs.size === 0) return Promise.resolve()
    var jobs = Array.from(blobs).map(function (entry) {
      var id = entry[0]
      var blob = entry[1]
      return decodeImageBlob(blob).then(function (source) {
        if (self.destroyed) {
          closeImageBitmap(source)
          return
        }
        self.imageTextures.set(id, self.pixi.Texture.from(source))
      }).catch(function () {
        // 损坏或不支持的文件只是让那个放置位不渲染
      })
    })
    return Promise.all(jobs)
  }

  TemperaPixiRuntime.prototype.disposeCredits = function () {
    var self = this
    if (this.credits) {
      this.credits.container.children.forEach(function (child) {
        child.filters = null
      })
      this.credits.filters.forEach(function (filter) { filter.destroy() })
    }
    this.credits = null
    this.creditsContainer.removeChildren().forEach(function (child) {
      child.destroy({ children: true })
    })
    void self
  }

  TemperaPixiRuntime.prototype.clearScenes = function () {
    var self = this
    this.sceneCache.forEach(function (scene) {
      self.destroyScene(scene)
    })
    this.sceneCache.clear()
    this.activeParagraphIndex = -1
  }

  // 把缓存整个摘下屏而不立刻支付拆解的代价。只被歌曲交接使用：
  // 交换落地那一帧释放每个字的 Text 恰是色块要藏的那记卡顿
  TemperaPixiRuntime.prototype.retireScenes = function () {
    var self = this
    this.sceneCache.forEach(function (scene) {
      self.sceneContainer.removeChild(scene.container)
      self.retiredScenes.push(scene)
    })
    this.sceneCache.clear()
    this.activeParagraphIndex = -1
  }

  // 释放一个退役场景。在没别的重要工作的帧上调用
  TemperaPixiRuntime.prototype.drainRetiredScene = function () {
    var scene = this.retiredScenes.shift()
    if (!scene) return
    // retireScenes 已把它摘下；destroyScene 的 removeChild 在这里是空操作
    this.destroyScene(scene)
  }

  TemperaPixiRuntime.prototype.destroyScene = function (scene) {
    this.sceneContainer.removeChild(scene.container)
    SonnetCore.unloadSonnetDisplayTree(scene.container)
    scene.container.filters = null
    scene.shots.forEach(function (shot) {
      shot.textLayer.filters = null
    })
    scene.postProcessFilters.forEach(function (filter) { filter.destroy() })
    scene.container.destroy({ children: true })
  }

  // 构建一个段落场景。这是整个运行时里最贵的一次调用：
  // 对每个字素跑排版 fit loop，然后每字建一个 pixi.Text 加它的影子与浮影副本。
  // 这里任何东西每帧都不该跑超过一次
  TemperaPixiRuntime.prototype.buildScene = function (song, index) {
    return Scene.buildTemperaScene(this.pixi, {
      programSeed: song.program.seed,
      host: this.options.host,
      theme: song.theme,
      tuning: this.options.tuning,
      renderResolution: this.renderResolution,
      lyricsFontScale: this.options.lyricsFontScale,
      staticMode: this.options.staticMode,
      coverColors: song.coverColors,
      imageTextures: this.imageTextures
    }, song.program.paragraphs[index])
  }

  // 以 context 的形式给出在屏歌曲，用于对着当前屏幕上是什么来建场景
  TemperaPixiRuntime.prototype.liveSong = function () {
    return {
      seed: this.options.songSeed,
      program: this.options.program,
      theme: this.options.theme,
      coverColors: this.options.coverColors !== undefined && this.options.coverColors !== null ? this.options.coverColors : []
    }
  }

  TemperaPixiRuntime.prototype.ensureScene = function (index) {
    if (index < 0 || index >= this.options.program.paragraphs.length) return null
    var cached = this.sceneCache.get(index)
    if (cached) return cached
    var scene = this.buildScene(this.liveSong(), index)
    this.sceneCache.set(index, scene)
    this.sceneContainer.addChild(scene.container)
    return scene
  }

  TemperaPixiRuntime.prototype.pruneScenes = function (index) {
    var self = this
    this.sceneCache.forEach(function (scene, sceneIndex) {
      if (Math.abs(sceneIndex - index) <= 1) return
      self.destroyScene(scene)
      self.sceneCache.delete(sceneIndex)
    })
  }

  // 已结束的 shot 在下一个已经在滑进来的同时继续滑出的时长。
  // 重叠正是全部意义：两个构图共享画面，出画的那个把视线带进入画的那个，
  // 而不是被切走
  TemperaPixiRuntime.prototype.resolveShotHandoff = function (view) {
    return resolveShotPacedDuration(view.shot.endTime - view.shot.startTime, 0.3, 0.4, 1.1)
  }

  TemperaPixiRuntime.prototype.resolveShotExit = function (view, time) {
    return clamp01((time - view.shot.endTime) / this.resolveShotHandoff(view))
  }

  TemperaPixiRuntime.prototype.updateShot = function (view, time, width, height) {
    var tuning = this.options.tuning
    var duration = Math.max(view.shot.endTime - view.shot.startTime, 0.001)
    var rawProgress = (time - view.shot.startTime) / duration
    var animationScale = resolveTemperaAnimationScale(this.options.theme)
    var camera = tuning.cameraIntensity * animationScale
    var motion = tuning.glyphMotion * animationScale
    var frame = resolveTemperaCameraFrame(view.shot, rawProgress)

    var breathWeight = resolveTemperaBreathWeight(time, view.revealDoneTime)
    if (breathWeight > 0) {
      var breathPhase = (hashTemperaSeed(view.shot.id) % 1024) / 1024 * Math.PI * 2
      var breath = resolveTemperaCameraBreath(time, breathPhase)
      frame.x += breath.x * breathWeight
      frame.y += breath.y * breathWeight
      frame.scale += breath.scale * breathWeight
      frame.rotation += breath.rotation * breathWeight
    }

    // 交接：shot 沿自己的 flow 向量从上游到达，结束后继续向下游走出画面。
    // 重叠期间两个 shot 同时跑这一段，出画构图明显地把入画的推过去，
    // 而不是被切走
    var handoff = this.resolveShotHandoff(view)
    var span = Math.max(width, height)
    // 到达刻意前重：字在 shot 自己的时间线上开始揭示，
    // 慢的进场会露出还没到位的字
    var enter = easeTemperaEnter(clamp01((time - view.shot.startTime) / (handoff * 0.8)))
    var exit = easeTemperaInOut(this.resolveShotExit(view, time))
    var travel = exit * span * 0.55 - (1 - enter) * span * 0.32
    view.container.position.set(
      view.baseX + frame.x * width * camera + Math.cos(view.shot.flowAngle) * travel,
      view.baseY + frame.y * height * camera + Math.sin(view.shot.flowAngle) * travel
    )
    // 进场路上不透明：这是一次推进，不是溶解。只有出场淡出
    view.container.alpha = 1 - exit
    view.container.scale.set((1 + (frame.scale - 1) * camera) * (1 - exit * 0.08))
    view.container.rotation = frame.rotation * camera

    // 两端各有用途。图形的入场错峰对着本 shot 携带的歌词排期；
    // 沿 flow 的匀速爬行跑满 shot 整个可见生命——它被平铺到下一个 shot 的
    // 起点，可以长出歌词好几秒
    view.blocks.updateTime(time, view.shot.startTime, view.shot.endTime, view.shot.lyricEndTime)
    view.images.updateTime(time, view.shot.startTime, view.shot.endTime, view.shot.lyricEndTime)

    view.glyphs.forEach(function (glyph) {
      var glyphFrame = resolveTemperaGlyphMotion(glyph.motion, time, motion)
      var x = glyph.baseX + glyphFrame.x
      var y = glyph.baseY + glyphFrame.y
      glyph.display.alpha = glyphFrame.alpha
      glyph.display.visible = glyphFrame.visible
      glyph.display.position.set(x, y)
      glyph.display.scale.set(glyphFrame.scaleX, glyphFrame.scaleY)
      glyph.display.rotation = glyphFrame.rotation
      if (glyph.shadow) {
        glyph.shadow.alpha = glyphFrame.alpha * 0.34
        glyph.shadow.visible = glyphFrame.visible
        glyph.shadow.position.set(x + glyph.shadowDX, y + glyph.shadowDY)
        glyph.shadow.scale.set(glyphFrame.scaleX, glyphFrame.scaleY)
        glyph.shadow.rotation = glyphFrame.rotation
      }
      // 浮影沿入场向量退得更靠后，坐得越深退得越远
      var echoVisible = glyphFrame.visible && glyphFrame.echoAlpha > 0.004
      glyph.echoes.forEach(function (echo, index) {
        echo.visible = echoVisible
        if (!echoVisible) return
        var depth = 1 + index * 0.85
        echo.alpha = glyphFrame.echoAlpha / (index + 1.4)
        echo.position.set(
          glyph.baseX + glyphFrame.echoX * depth,
          glyph.baseY + glyphFrame.echoY * depth
        )
        echo.scale.set(glyphFrame.scaleX, glyphFrame.scaleY)
        echo.rotation = glyphFrame.rotation
      })
    })
  }

  // 沿 angle 滑动一块屏幕大小的块。travel 跑 0..2：在 1 时块恰好盖满画面，
  // 那正是其下的场景被允许切换的瞬间
  TemperaPixiRuntime.prototype.drawWipe = function (travel, angle, width, height, color) {
    var wipe = this.wipeGraphics
    if (!wipe) return
    if (travel <= 0.001 || travel >= 1.999) {
      if (wipe.visible) {
        wipe.clear()
        wipe.visible = false
      }
      return
    }
    // 画在一个按屏幕对角线定尺寸的旋转局部坐标系里，任意角度下都保持满出血。
    // 两条边带同一个 chevron，让它留在构图的菱形语汇里；
    // 几何逐帧重建，因为它取决于 travel
    var span = Math.hypot(width, height)
    var notch = span * 0.08
    var length = span + notch * 2
    var start = -span / 2 - notch + (travel - 1) * length
    var end = start + length
    var half = span / 2
    wipe.clear()
    wipe
      .poly([
        start, -half,
        end, -half,
        end + notch, 0,
        end, half,
        start, half,
        start + notch, 0
      ])
      .fill({ color: this.pixi.Color.shared.setValue(color).toNumber() })
    wipe.pivot.set(0, 0)
    wipe.position.set(width / 2, height / 2)
    wipe.rotation = angle
    wipe.scale.set(1, 1)
    wipe.visible = true
  }

  TemperaPixiRuntime.prototype.renderFrame = function () {
    if (this.destroyed) return
    var time = this.currentTimeValue
    // 在段落查找之前先推进交接，切换才落在本帧的场景选择上，
    // 而不是把出画程序的一帧留在入画程序上
    this.advanceSongSwap()
    if (this.options.program.paragraphs.length === 0) return
    var paragraphIndex = Program.findTemperaParagraphIndexAtTime(this.options.program, time)
    var self = this
    if (paragraphIndex !== this.activeParagraphIndex) {
      this.activeParagraphIndex = paragraphIndex
      this.ensureScene(paragraphIndex)
      this.pruneScenes(paragraphIndex)
    } else if (!this.songSwap) {
      // 每帧一件贵的工作，按优先级：释放上一次交接留下的，然后预卷一个邻居。
      // 邻居是为还在前方的边界准备的，所以这里的东西本帧永远用不上——
      // 这正是要点。一次全做完就是段落切换处可见的那记卡顿，
      // 而在歌曲交接处它恰好落在色块本该藏住交换的位置
      var next = paragraphIndex + 1
      var previous = paragraphIndex - 1
      if (this.retiredScenes.length > 0) {
        this.drainRetiredScene()
      } else if (next < this.options.program.paragraphs.length && !this.sceneCache.has(next)) {
        this.ensureScene(next)
      } else if (previous >= 0 && !this.sceneCache.has(previous)) {
        this.ensureScene(previous)
      }
    }
    var width = Math.max(this.options.host.clientWidth, 320)
    var height = Math.max(this.options.host.clientHeight, 240)
    var paragraphs = this.options.program.paragraphs
    var finalParagraph = paragraphs.length > 0 ? paragraphs[paragraphs.length - 1] : null
    var creditsFrame = resolveCreditsFrame(
      time,
      finalParagraph ? finalParagraph.endTime : Number.POSITIVE_INFINITY
    )
    var hasCredits = this.creditsContainer.children.length > 0
    var wipeDrawn = false

    var transitionsEnabled = this.options.tuning.enableTransitions && !this.options.staticMode
    var currentParagraph = paragraphs[paragraphIndex] !== undefined ? paragraphs[paragraphIndex] : null
    var outgoingTransition = currentParagraph ? currentParagraph.transitionOut : null
    // 平移类转场需要另一头有东西。段落边界常落在没有歌词的空隙里，
    // 下一个场景过去只在它自己的段落开始后绘制——出画的那个就滑进裸壳。
    // 用同一窗口预卷入画场景，给这个动作一个远端
    //
    // block-wipe 被排除：它的色块已经盖住交换，它的 enter 阶段是*揭开*，
    // 必须发生在边界之后而不是之前
    var preRoll = transitionsEnabled
      && outgoingTransition !== null
      && outgoingTransition.kind !== 'block-wipe'
      && time >= outgoingTransition.startTime

    this.sceneCache.forEach(function (scene, index) {
      var isActive = index === paragraphIndex
      var isIncoming = preRoll && index === paragraphIndex + 1

      setPixiDisplayTreeVisibility(scene.container, isActive || isIncoming)
      // 到达的场景必须坐在它正在替换的那个之上；缓存的插入顺序与段落顺序无关
      scene.container.zIndex = index
      if (!scene.container.visible) {
        // 场景级 unload 已释放每个后代。重置 shot 可见性，
        // 之后的 seek 只重新补水它真正展示的 shot
        scene.shots.forEach(function (shot) {
          shot.container.visible = false
        })
        scene.activeShotIndex = -1
        return
      }

      var previousTransition = index > 0 && self.options.program.paragraphs[index - 1]
        ? self.options.program.paragraphs[index - 1].transitionOut
        : null
      var enterDuration = previousTransition
        ? Math.max(0.35, Math.min(1, previousTransition.endTime - previousTransition.startTime))
        : 0
      // 只有 wipe 仍在边界之后进场；其他一切在那时已经到达，
      // 因为它们经过出画窗口被预卷了
      var entering = transitionsEnabled
        && previousTransition !== null
        && previousTransition.kind === 'block-wipe'
        && time >= scene.paragraph.startTime
        && time <= scene.paragraph.startTime + enterDuration
      var incomingShotFlow = scene.paragraph.shots[0] ? scene.paragraph.shots[0].flowAngle : 0
      var paragraphTransitionFrame = isIncoming && outgoingTransition
        ? resolveTemperaEnterTransitionFrame(
          outgoingTransition.kind,
          time - outgoingTransition.startTime,
          Math.max(0.001, outgoingTransition.endTime - outgoingTransition.startTime),
          true,
          // 在入画段落自己的 flow 上进场，到达因此延续出画构图
          // 已经在走的方向
          incomingShotFlow
        )
        : entering && previousTransition
          ? resolveTemperaEnterTransitionFrame(
            previousTransition.kind,
            time - scene.paragraph.startTime,
            enterDuration,
            true,
            incomingShotFlow
          )
          : resolveTemperaExitTransitionFrame(
            scene.paragraph,
            time,
            transitionsEnabled
          )

      // 严格确定本场景内唯一的活动 shot，避免场景内残留
      var activeShotIndex = 0
      for (var i = scene.shots.length - 1; i >= 0; i--) {
        if (time >= scene.shots[i].shot.startTime) {
          activeShotIndex = i
          break
        }
      }

      // shot 边界不再需要场景级转场：构图直接互相交棒，
      // 这正是让一个段落读作一个长镜头的原因
      var transitionFrame = paragraphTransitionFrame
      scene.shots.forEach(function (shot, shotIndex) {
        // 出画的 shot 在它的交接窗口里留在画面上，两个构图恰好在
        // 一个推另一个出去的时候重叠
        var isShotActive = shotIndex === activeShotIndex
        var isHandingOff = shotIndex < activeShotIndex && self.resolveShotExit(shot, time) < 1
        setPixiDisplayTreeVisibility(shot.container, isShotActive || isHandingOff)
        if (!shot.container.visible) return
        self.updateShot(shot, time, width, height)
      })
      scene.activeShotIndex = activeShotIndex

      var isFinalScene = index === self.options.program.paragraphs.length - 1
      var lyricAlpha = isFinalScene && hasCredits ? creditsFrame.lyricAlpha : 1
      scene.container.alpha = transitionFrame.alpha * lyricAlpha
      scene.container.pivot.set(width / 2, height / 2)
      scene.container.position.set(
        width / 2 + transitionFrame.x * width,
        height / 2 + transitionFrame.y * height
      )
      scene.container.scale.set(transitionFrame.scale)
      scene.container.rotation = transitionFrame.rotation
      // 只在它模糊的时候挂上：一个停在这个容器上的滤镜
      // 会接管歌词反色的底色拷贝（见 tempera-scene 的注释）
      Scene.setTemperaTransitionBlur(scene, transitionFrame.blur)
      if (transitionFrame.wipe > 0.001 && transitionFrame.wipe < 1.999) {
        self.drawWipe(
          transitionFrame.wipe,
          transitionFrame.wipeAngle,
          width,
          height,
          scene.palette.tone3
        )
        wipeDrawn = true
      }
    })

    if (!wipeDrawn) this.drawWipe(0, 0, width, height, '#000000')
    this.creditsContainer.visible = creditsFrame.active && hasCredits
    this.creditsContainer.alpha = creditsFrame.posterAlpha
    // 卡片不是静帧：形状在固定的标题下持续漂移，
    // 反色滤镜因此在整段 outro 期间不断重切它
    if (this.creditsContainer.visible) {
      if (this.credits) {
        this.credits.updateTime(time - (finalParagraph ? finalParagraph.endTime : time))
      }
    }
    this.creditsContainer.position.set(
      width / 2,
      height / 2 + creditsFrame.posterOffsetY * height
    )
    this.creditsContainer.scale.set(creditsFrame.posterScale)
  }

  TemperaPixiRuntime.prototype.renderOnce = function () {
    if (this.destroyed || !this.app.canvas.isConnected) return
    this.renderFrame()
    if (this.destroyed) return
    this.app.renderer.render(this.app.stage)
  }

  // 注入当前播放时间（原版由 MotionValue 提供，每帧由模式入口调用）
  TemperaPixiRuntime.prototype.setCurrentTime = function (time) {
    this.currentTimeValue = time
  }

  // 不重建渲染器地把新曲目交给它。参数正是 setTuning 为 tuning 变化所做的那样：
  // 一次重建会重新初始化 WebGL、重新解码每张放置的图、重新测量每一行，
  // 而且画布还不在 DOM 里，整段异步构建期间帧是空的。这里只有场景层变化，
  // 藏在段落切换本就有的色块擦除之下
  //
  // 色块扫完回弹之后 resolve
  TemperaPixiRuntime.prototype.swapSong = function (next) {
    var self = this
    if (this.destroyed) return Promise.resolve()
    // 没有什么要保护时直接过——还没定尺寸的场景、无段落的出画程序、
    // 已在进行的交换、暂停中的渲染器（ticker 已停，永远到不了第二帧）。
    // 这些都展示不出来的卡顿不值得多等一帧。不是换曲的交换也不拿一个——
    // 见 TemperaSongContext.seed 的说明
    if (
      next.seed === this.options.songSeed
      || this.songSwap
      || this.lastWidth === 0
      || this.options.program.paragraphs.length === 0
      || this.options.paused
    ) {
      this.commitSongContext(next)
      if (this.options.paused) this.renderOnce()
      return Promise.resolve()
    }

    return new Promise(function (resolve) {
      self.songSwap = {
        pending: next,
        staged: null,
        prepared: false,
        settle: resolve
      }
    })
  }

  // 切本身。镜像 setTuning 的重建分支，但不做同步拆解
  TemperaPixiRuntime.prototype.commitSongContext = function (next, staged) {
    this.options.songSeed = next.seed
    this.options.program = next.program
    this.options.theme = next.theme
    this.options.coverColors = next.coverColors
    // 这两个都不遍历暂存的场景：它刻意还不在缓存里，
    // 所以它能在被替换歌曲的移除中幸存
    if (staged) this.retireScenes()
    else this.clearScenes()
    if (staged) {
      staged.scene.container.visible = true
      this.sceneContainer.addChild(staged.scene.container)
      this.sceneCache.set(staged.index, staged.scene)
      // 作为活动段落收养，切换那一帧就什么都不用构建了
      this.activeParagraphIndex = staged.index
    }
    // 第一次 resize 之前没有任何东西定过尺寸；install pass
    // 会对着真实尺寸把两者都画出来
    if (this.lastWidth > 0 && this.lastHeight > 0) {
      this.drawOverlay(this.lastWidth, this.lastHeight)
      if (staged) this.adoptCredits(staged.credits, this.lastWidth, this.lastHeight)
      else this.drawCredits(this.lastWidth, this.lastHeight)
    }
  }

  // 释放一张从未被装进 credits 容器的海报
  TemperaPixiRuntime.prototype.destroyCreditsView = function (view) {
    view.container.children.forEach(function (child) {
      child.filters = null
    })
    view.filters.forEach(function (filter) { filter.destroy() })
    view.container.destroy({ children: true })
  }

  // 释放永远不会被收养的暂存场景与海报
  TemperaPixiRuntime.prototype.discardStaged = function (staged) {
    this.destroyScene(staged.scene)
    if (staged.credits) this.destroyCreditsView(staged.credits)
  }

  // 立即完成一次进行中的交接，提交它还握着的东西
  TemperaPixiRuntime.prototype.settleSongSwap = function () {
    var swap = this.songSwap
    if (!swap) return
    this.songSwap = null
    if (this.destroyed) {
      // 从未被收养，不会有别的什么来释放它
      if (swap.staged) this.discardStaged(swap.staged)
    } else {
      if (swap.pending) this.commitSongContext(swap.pending, swap.staged)
      else if (swap.staged) this.discardStaged(swap.staged)
    }
    swap.settle()
  }

  // 交接的一帧。第一帧在出画歌曲仍握着画面时构建入画场景；第二帧切过去。
  // 变化之上不画任何东西——要点是切换不花工夫，而不是把它藏起来
  TemperaPixiRuntime.prototype.advanceSongSwap = function () {
    var swap = this.songSwap
    if (!swap) return
    if (!swap.prepared) {
      swap.prepared = true
      if (swap.pending) swap.staged = this.stageSong(swap.pending)
      return
    }
    this.settleSongSwap()
  }

  // 在屏下构建入画场景与海报。这是换歌贵的那一半——对每个字素的排版 fit loop、
  // 每字一个 pixi.Text、海报自己的滤镜与圆盘——花在这里，
  // 切换那一帧就什么都不花
  TemperaPixiRuntime.prototype.stageSong = function (song) {
    var index = Program.findTemperaParagraphIndexAtTime(song.program, this.currentTimeValue)
    if (index < 0 || index >= song.program.paragraphs.length) return null
    var scene = this.buildScene(song, index)
    scene.container.visible = false
    this.sceneContainer.addChild(scene.container)
    var credits = this.buildCreditsView(song, scene.palette, this.lastWidth, this.lastHeight)
    return { scene: scene, index: index, credits: credits }
  }

  // 就地下发 tuning 变化。为它重建渲染器是灾难性的：滑块拖动时每次 pointermove
  // 都产出新 tuning，重建意味着重新初始化 WebGL、重新解码所有图片、重新测量所有行。
  // 只有真正改变场景*内容*的设置才丢掉缓存场景；其余每帧现读或直接重设到 sprite 上
  TemperaPixiRuntime.prototype.setTuning = function (tuning) {
    if (this.destroyed) return
    var previous = this.options.tuning
    if (previous === tuning) return
    this.options.tuning = tuning
    // 比较的是吸附后的值而不是设置：两个相邻滑块位置可能共享一个池桶，
    // 把表面重新指向它已有的分辨率会白白重新分配。requiresSceneRebuild
    // 仍然看原始设置，所以同一桶内的一次移动只花场景重建、不花表面重建
    var resolution = this.resolveRenderResolution(tuning)
    if (resolution !== this.renderResolution) {
      this.renderResolution = resolution
      // Pixi 可以不重建 WebGL 应用、不解码共享图片池就重设 backing surface。
      // 下面的场景重建会针对新表面刷新文字与固定分辨率的滤镜
      this.app.renderer.resolution = resolution
    }
    if (requiresSceneRebuild(previous, tuning)) {
      // 按旧 tuning 暂存的，已不可能被收养
      if (this.songSwap && this.songSwap.staged) {
        this.discardStaged(this.songSwap.staged)
        this.songSwap.staged = null
      }
      this.clearScenes()
      // 第一次 resize 之前没有任何东西定过尺寸；install pass
      // 会对着真实尺寸把两者都画出来
      if (this.lastWidth > 0 && this.lastHeight > 0) {
        this.drawOverlay(this.lastWidth, this.lastHeight)
        this.drawCredits(this.lastWidth, this.lastHeight)
      }
    } else {
      var self = this
      this.sceneCache.forEach(function (scene) {
        scene.shots.forEach(function (shot) { shot.images.applyPool(self.options.tuning.layerImages) })
      })
    }
    if (this.options.paused) this.renderOnce()
  }

  TemperaPixiRuntime.prototype.setPaused = function (paused) {
    if (this.destroyed) return
    this.options.paused = paused
    if (paused) {
      this.app.stop()
      this.renderOnce()
    } else {
      this.app.start()
    }
  }

  TemperaPixiRuntime.prototype.destroy = function () {
    if (this.destroyed) return
    this.destroyed = true
    // 在拆掉 app 之前先释放等待交接的一方，否则那个 promise 永不落定，
    // 调用方的排空循环会停在它上面
    this.settleSongSwap()
    if (this.resizeObserver) {
      this.resizeObserver.disconnect()
      this.resizeObserver = null
    }
    this.app.stop()
    this.app.ticker.remove(this.renderFrameBound)
    this.clearScenes()
    var self = this
    this.retiredScenes.forEach(function (scene) { self.destroyScene(scene) })
    this.retiredScenes.length = 0
    this.disposeCredits()
    this.wipeGraphics = null
    // 这些纹理在这里构建而非由场景持有，所以也在这里释放；
    // app.destroy 只走仍在舞台上的东西
    this.imageTextures.forEach(function (texture) {
      var source = texture.source.resource
      texture.destroy(true)
      closeImageBitmap(source)
    })
    this.imageTextures.clear()
    this.app.destroy({ removeView: true }, { children: true, texture: true })
  }

  window.FoliaTemperaRuntime = {
    TemperaPixiRuntime: TemperaPixiRuntime
  }
})()
