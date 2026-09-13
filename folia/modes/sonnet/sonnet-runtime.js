// 商籁模式·Pixi 运行时：移植自 folia-major sonnet/createSonnetPixiRuntime.ts（1044 行）
// 持有 Pixi 生命周期，按绝对播放时间直接驱动有界场景视图。
// 原版的 MotionValue（currentTime / audioPower / audioBands）改为每帧由模式入口
// 注入的普通数值；loadPixi 的 mediump→highp 精度翻转照搬（在创建渲染器前执行）。
(function () {
  'use strict'

  var Core = window.FoliaSonnetCore
  var Program = window.FoliaSonnetProgram
  var Scene = window.FoliaSonnetScene
  var Typography = window.FoliaSonnetTypography
  var Text = window.FoliaSonnetText

  // 完整溶解时长：封面进入 → 切换 → 封面退出
  var SONNET_SONG_SWAP_MS = 560
  // 溶解的多大进度处构建入场场景：足够晚使封面接近不透明，
  // 又早于中点切换留出余量
  var SONNET_SWAP_STAGE_PROGRESS = 0.35

  function findParagraphIndexAtTime(program, time) {
    return Program.findSonnetParagraphIndexAtTime(program, time)
  }

  function SonnetPixiRuntime(pixi, options, app) {
    this.pixi = pixi
    this.options = options
    this.app = app
    this.sceneCache = new Map()
    this.iconTextures = new Map()
    this.iconUrls = new Set()
    this.activeParagraphIndex = -1
    this.destroyed = false
    this.songSwap = null
    this.swapCover = null
    this.resizeObserver = null
    this.lastWidth = 0
    this.lastHeight = 0
    this.sceneContainer = null
    this.creditsContainer = null
    this.overlayContainer = null
    this.outroBlurFilter = null
    this.outroBlurScene = null

    // 每帧注入的播放状态（原版为 MotionValue.get()）
    this.currentTimeValue = 0
    this.audioPowerValue = 0
    this.audioBassValue = 0
    this.audioVocalValue = 0

    this.renderFrameBound = this.renderFrame.bind(this)
  }

  SonnetPixiRuntime.create = function (options) {
    var pixi = window.PIXI
    // 原版 loadPixi：必须在构造任何渲染器/滤镜/着色器之前提升默认着色精度，
    // 否则首个编译的程序会带 mediump 变体（Linux NVIDIA 上 NoiseFilter 会出现黑三角）
    if (pixi.GlProgram && pixi.GlProgram.defaultOptions) {
      pixi.GlProgram.defaultOptions.preferredFragmentPrecision = 'highp'
    }
    var app = new pixi.Application()
    var width = Math.max(options.host.clientWidth, 320)
    var height = Math.max(options.host.clientHeight, 240)
    return app.init({
      width: width,
      height: height,
      backgroundAlpha: 0,
      antialias: true,
      autoDensity: true,
      resolution: Core.snapResolutionToTexturePool(width, height, options.tuning.textureResolution),
      autoStart: false,
      sharedTicker: false,
      preference: 'webgl',
      powerPreference: 'high-performance'
    }).then(function () {
      var runtime = new SonnetPixiRuntime(pixi, options, app)
      runtime.sceneContainer = new pixi.Container()
      runtime.creditsContainer = new pixi.Container()
      runtime.overlayContainer = new pixi.Container()
      app.stage.addChild(runtime.sceneContainer, runtime.creditsContainer, runtime.overlayContainer)

      if (options.signal && options.signal.aborted) {
        runtime.destroy()
        throw new Error('Sonnet runtime creation was cancelled')
      }
      options.host.appendChild(app.canvas)
      app.canvas.style.cssText = 'width:100%;height:100%;display:block'
      return runtime.preloadIcons().then(function () {
        if (options.signal && options.signal.aborted) {
          runtime.destroy()
          throw new Error('Sonnet runtime creation was cancelled')
        }
        runtime.install()
        return runtime
      })
    })
  }

  SonnetPixiRuntime.prototype.install = function () {
    var self = this
    this.resizeToHost()
    this.app.ticker.add(this.renderFrameBound)
    this.resizeObserver = new ResizeObserver(function () {
      if (self.destroyed || !self.resizeToHost()) return
      if (self.options.paused) self.renderOnce()
    })
    this.resizeObserver.observe(this.options.host)
    this.renderOnce()
    if (!this.options.paused) this.app.start()
  }

  SonnetPixiRuntime.prototype.resizeToHost = function () {
    if (this.destroyed) return false
    var width = Math.max(this.options.host.clientWidth, 320)
    var height = Math.max(this.options.host.clientHeight, 240)
    if (width === this.lastWidth && height === this.lastHeight) return false
    this.lastWidth = width
    this.lastHeight = height
    // 纹理池对齐依赖视口，因此调整大小会把池化滤镜目标跨过桶边界移动，
    // 即便设置从未改变。Sonnet 自己的 pass 分辨率固定，所以只有画布需要跟随。
    this.app.renderer.resize(
      width,
      height,
      Core.snapResolutionToTexturePool(width, height, this.options.tuning.textureResolution)
    )
    // 已按旧视口暂存的场景不再合身
    if (this.songSwap && this.songSwap.staged) {
      this.destroyScene(this.songSwap.staged.scene)
      this.songSwap.staged = null
    }
    this.clearScenes()
    this.drawCredits(width, height)
    this.drawOverlay(width, height)
    return true
  }

  SonnetPixiRuntime.prototype.drawCredits = function (width, height) {
    Core.destroySonnetContainerChildren(this.creditsContainer)
    if (this.options.tuning.showOnlyText) return
    var metadata = {
      title: this.options.songTitle,
      artist: this.options.songArtist,
      album: this.options.songAlbum
    }
    if (!Scene.hasSonnetCreditsMetadata(metadata)) return
    this.creditsContainer.addChild(Scene.buildSonnetCreditsPoster(
      this.pixi,
      this.options.theme,
      metadata,
      width,
      height,
      this.options.lyricsFontScale
    ))
    this.creditsContainer.pivot.set(width / 2, height / 2)
    this.creditsContainer.position.set(width / 2, height / 2)
    this.creditsContainer.visible = false
  }

  SonnetPixiRuntime.prototype.setSongMetadata = function (metadata) {
    if (this.destroyed) return
    var changed = this.options.songTitle !== metadata.title
      || this.options.songArtist !== metadata.artist
      || this.options.songAlbum !== metadata.album
    if (!changed) return

    this.options.songTitle = metadata.title
    this.options.songArtist = metadata.artist
    this.options.songAlbum = metadata.album
    if (this.lastWidth > 0 && this.lastHeight > 0) {
      this.drawCredits(this.lastWidth, this.lastHeight)
      if (this.options.paused) this.renderOnce()
    }
  }

  SonnetPixiRuntime.prototype.clearOutroBlur = function () {
    if (this.outroBlurFilter && this.outroBlurScene) {
      this.outroBlurScene.container.filters = (this.outroBlurScene.container.filters || [])
        .filter(function (filter) { return filter !== this.outroBlurFilter }, this)
      this.outroBlurFilter.destroy()
    }
    this.outroBlurFilter = null
    this.outroBlurScene = null
  }

  SonnetPixiRuntime.prototype.updateOutroBlur = function (scene, strength) {
    if (strength <= 0) {
      this.clearOutroBlur()
      return
    }
    if (this.outroBlurScene !== scene) this.clearOutroBlur()
    if (!this.outroBlurFilter) {
      this.outroBlurFilter = new this.pixi.BlurFilter({
        strength: 0,
        quality: 2,
        kernelSize: 5,
        resolution: 0.75
      })
      // 与场景的滤镜链（含后处理暗角）共享，其 padding 会扩大共享渲染帧，
      // 使暗角随片尾模糊渐入向外漂移
      this.outroBlurFilter.repeatEdgePixels = true
      scene.container.filters = (scene.container.filters || []).concat([this.outroBlurFilter])
      this.outroBlurScene = scene
    }
    this.outroBlurFilter.strength = strength
  }

  SonnetPixiRuntime.prototype.drawOverlay = function (width, height) {
    Core.destroySonnetContainerChildren(this.overlayContainer)
    if (this.options.tuning.showOnlyText || this.options.tuning.outerFrameMode === 'none') return
    var pixi = this.pixi
    var g = new pixi.Graphics()

    var paddingX = Math.max(30, width * 0.05)
    var paddingY = Math.max(30, height * 0.05)

    var primary = pixi.Color.shared.setValue(this.options.theme.primaryColor).toNumber()
    var alpha = 0.5

    // 不对称的部分周长（不包围整个屏幕）
    // 1. 左上簇
    g.rect(paddingX, paddingY, 30, 4).fill({ color: primary, alpha: 0.8 }) // 粗条
    g.moveTo(paddingX, paddingY + 16).lineTo(paddingX, paddingY + 120).stroke({ color: primary, width: 1, alpha: alpha }) // 垂线

    // 2. 右下簇
    g.rect(width - paddingX - 4, height - paddingY - 16, 4, 16).fill({ color: primary, alpha: 0.8 }) // 粗竖条
    g.moveTo(width - paddingX - 160, height - paddingY).lineTo(width - paddingX - 20, height - paddingY).stroke({ color: primary, width: 1, alpha: alpha }) // 横线
    g.moveTo(width - paddingX, height - paddingY - 180).lineTo(width - paddingX, height - paddingY - 30).stroke({ color: primary, width: 1, alpha: alpha }) // 升线

    // 3. 漂浮强调
    var drawCross = function (cx, cy, size) {
      g.moveTo(cx - size, cy).lineTo(cx + size, cy).stroke({ color: primary, width: 1, alpha: 0.8 })
      g.moveTo(cx, cy - size).lineTo(cx, cy + size).stroke({ color: primary, width: 1, alpha: 0.8 })
    }
    // 右上十字
    drawCross(width - paddingX, paddingY + 20, 6)

    // 左下菱形
    g.moveTo(paddingX, height - paddingY - 4).lineTo(paddingX + 4, height - paddingY).lineTo(paddingX, height - paddingY + 4).lineTo(paddingX - 4, height - paddingY).fill({ color: primary, alpha: 0.7 })

    // 排版星形 ✦
    var starStyle = new pixi.TextStyle({
      fontFamily: 'sans-serif',
      fontSize: 12,
      fill: primary
    })
    var starText = new pixi.Text({ text: '✦', style: starStyle })
    starText.alpha = 0.6
    starText.position.set(width - paddingX - 10, height - paddingY)
    starText.anchor.set(1, 0.5)

    this.overlayContainer.addChild(g, starText)
  }

  // 获取主题要求的装饰图标纹理。与活跃映射分离保存，
  // 让歌曲交接在旧歌仍在屏幕上时预热新主题的图标，
  // 封面遮住切换后才接管
  SonnetPixiRuntime.prototype.loadIconTextures = function (theme) {
    var self = this
    var loaded = { textures: new Map(), urls: new Set() }
    if (this.options.tuning.showOnlyText || !this.options.tuning.showBackgroundDecor) {
      return Promise.resolve(loaded)
    }
    var names = Text.resolveSonnetIconNames(theme.lyricsIcons)
    var resolution = this.options.tuning.textureResolution
    var texturePool = Text.getSonnetTexturePool(this.pixi)
    var promises = names.map(function (name, index) {
      var size = 192 + (index % 4) * 32
      var colors = [
        theme.accentColor,
        theme.secondaryColor,
        theme.primaryColor
      ]
      var color = colors[index % colors.length]
      var key = Text.buildSonnetIconTextureKey(name, color, 3.5, size, resolution)
      var url = Text.buildSonnetIconDataUrl(name, color, 3.5, size)
      if (!url) return Promise.resolve()
      return texturePool.acquire(url).then(function (texture) {
        loaded.textures.set(key, texture)
        loaded.urls.add(url)
      }).catch(function () {
        // 无效的主题图标是可选的；几何 MG 仍然可用
      })
    })
    return Promise.all(promises).then(function () { return loaded })
  }

  // 把本运行时持有的 url 归还给池。引用计数制，顺序无关
  SonnetPixiRuntime.prototype.releaseIconUrls = function (urls) {
    var texturePool = Text.getSonnetTexturePool(this.pixi)
    urls.forEach(function (url) {
      texturePool.release(url)
    })
    urls.clear()
  }

  SonnetPixiRuntime.prototype.preloadIcons = function () {
    var self = this
    return this.loadIconTextures(this.options.theme).then(function (loaded) {
      loaded.textures.forEach(function (texture, key) { self.iconTextures.set(key, texture) })
      loaded.urls.forEach(function (url) { self.iconUrls.add(url) })
    })
  }

  SonnetPixiRuntime.prototype.clearScenes = function () {
    this.clearOutroBlur()
    var self = this
    this.sceneCache.forEach(function (scene) {
      self.destroyScene(scene)
    })
    this.sceneCache.clear()
    this.activeParagraphIndex = -1
  }

  SonnetPixiRuntime.prototype.destroyScene = function (scene) {
    if (this.outroBlurScene === scene) this.clearOutroBlur()
    this.sceneContainer.removeChild(scene.container)
    Core.unloadSonnetDisplayTree(scene.container)
    scene.container.filters = null
    scene.shots.forEach(function (shot) {
      shot.haloLayer.filters = null
    })
    scene.postProcessFilters.forEach(function (filter) { filter.destroy() })
    scene.container.destroy({ children: true })
  }

  // 构建一个段落场景。这是整个运行时最昂贵的调用：
  // 对每个字形跑排版布局，再为每个字形创建 pixi.Text。
  // 任何东西都不应该每帧运行超过一次
  SonnetPixiRuntime.prototype.buildScene = function (song, iconTextures, index) {
    return Scene.buildSonnetScene(this.pixi, {
      programSeed: song.program.seed,
      host: this.options.host,
      theme: song.theme,
      tuning: this.options.tuning,
      lyricsFontScale: this.options.lyricsFontScale,
      staticMode: this.options.staticMode,
      transparentBackground: this.options.transparentBackground
    }, iconTextures, song.program.paragraphs[index])
  }

  // 以上下文形式拿到当前歌曲，针对屏幕上的内容构建场景
  SonnetPixiRuntime.prototype.getLiveSong = function () {
    return {
      seed: this.options.songSeed,
      program: this.options.program,
      theme: this.options.theme
    }
  }

  SonnetPixiRuntime.prototype.ensureScene = function (index) {
    if (index < 0 || index >= this.options.program.paragraphs.length) return null
    var cached = this.sceneCache.get(index)
    if (cached) return cached
    var scene = this.buildScene(this.getLiveSong(), this.iconTextures, index)
    this.sceneCache.set(index, scene)
    this.sceneContainer.addChild(scene.container)
    return scene
  }

  SonnetPixiRuntime.prototype.pruneScenes = function (index) {
    var self = this
    this.sceneCache.forEach(function (scene, sceneIndex) {
      if (Math.abs(sceneIndex - index) <= 1) return
      self.destroyScene(scene)
      self.sceneCache.delete(sceneIndex)
    })
  }

  SonnetPixiRuntime.prototype.updateShot = function (view, time, width, height, shakeIntensity) {
    var options = this.options
    var progress = Core.resolveShotProgress(view.shot, time)
    var motion = options.tuning.typographyMotion * Core.resolveSonnetAnimationScale(options.theme) * this.mod('motionScale')
    var camera = options.tuning.cameraIntensity * Core.resolveSonnetAnimationScale(options.theme) * this.mod('cameraScale')
    var cameraFrame = Core.resolveShotMotionFrame(view.shot.kind, progress)

    // 时间间隙内加入缓慢连续平移，避免场景看起来冻结
    var gapTime = Math.max(0, time - view.shot.endTime)
    if (gapTime > 0) {
      // 从 shot 尾端（progress 0.8~1.0）继承运动方向
      var tailStart = Core.resolveShotMotionFrame(view.shot.kind, 0.8)
      var dx = cameraFrame.x - tailStart.x
      var dy = cameraFrame.y - tailStart.y
      var dScale = cameraFrame.scale - tailStart.scale
      var dRot = cameraFrame.rotation - tailStart.rotation

      // 以缓慢放松的 PV 节奏沿该方向继续漂移
      // speed = 0.8 表示间隙需要 1.25 秒漂移的距离等于镜头在 shot 最后 20% 覆盖的距离
      var maxDrift = 2.0
      var driftSpeed = (1 - Math.exp(-gapTime * 0.4)) * maxDrift * this.mod('driftScale')
      cameraFrame.x += dx * driftSpeed
      cameraFrame.y += dy * driftSpeed
      cameraFrame.scale += dScale * driftSpeed
      cameraFrame.rotation += dRot * driftSpeed
    }

    var shake = Core.resolveTimelineShake(time, shakeIntensity)

    var trackSegments = view.segments.filter(function (s) {
      return s.role !== 'decoration' && s.trackingGlyphs.length > 0
    })
    if (trackSegments.length === 0) {
      trackSegments = view.segments.filter(function (s) { return s.trackingGlyphs.length > 0 })
    }

    // 歌词揭示完成后叠加确定性的呼吸浮动，
    // 使 shot 保持或漂移穿过间隙时帧永不完全静止
    var revealDoneTime = view.shot.endTime
    if (trackSegments.length > 0) {
      var lastStarts = trackSegments.map(function (segment) {
        var lastGlyph = segment.trackingGlyphs[segment.trackingGlyphs.length - 1]
        return lastGlyph ? lastGlyph.startTime : view.shot.endTime
      })
      revealDoneTime = Math.max.apply(null, lastStarts)
    }
    var breathWeight = Core.resolveSonnetBreathWeight(time, revealDoneTime)
    if (breathWeight > 0) {
      var breathPhase = (Core.hashSonnetSeed(view.shot.id) % 1024) / 1024 * Math.PI * 2
      var breath = Core.resolveSonnetCameraBreath(time, breathPhase)
      var breathScale = this.mod('breathScale')
      cameraFrame.x += breath.x * breathWeight * breathScale
      cameraFrame.y += breath.y * breathWeight * breathScale
      cameraFrame.scale += breath.scale * breathWeight * breathScale
      cameraFrame.rotation += breath.rotation * breathWeight * breathScale
    }

    var currentFocusX = view.basePivotX
    var currentFocusY = view.basePivotY

    if (trackSegments.length > 0) {
      var self = this
      var focusRanges = trackSegments.map(function (segment) {
        var firstGlyph = segment.trackingGlyphs[0]
        var lastGlyph = segment.trackingGlyphs[segment.trackingGlyphs.length - 1]
        return {
          startTime: firstGlyph ? firstGlyph.startTime : view.shot.startTime,
          endTime: lastGlyph ? lastGlyph.startTime : view.shot.endTime
        }
      })
      var resolveFocusAtTime = function (focusTime) {
        var focusX = 0
        var focusY = 0
        var focusWeights = Core.resolveSonnetFocusWeights(focusRanges, focusTime)
        for (var i = 0; i < trackSegments.length; i++) {
          var seg = trackSegments[i]
          if (seg.trackingGlyphs.length === 0) continue
          var weight = focusWeights[i] !== undefined ? focusWeights[i] : 0
          var pos = Typography.resolveSonnetSegmentCameraFocus(seg.trackingGlyphs, focusTime)
          focusX += pos.x * weight
          focusY += pos.y * weight
        }
        return { x: focusX, y: focusY }
      }
      var focusTime = Math.max(view.shot.startTime, Math.min(time, view.shot.endTime))
      var smoothedFocus = Core.resolveSonnetSmoothedCameraFocus(
        focusTime,
        view.shot.startTime,
        view.shot.endTime,
        resolveFocusAtTime
      )

      currentFocusX = smoothedFocus.x
      currentFocusY = smoothedFocus.y
    }

    view.container.pivot.set(
      view.basePivotX + (currentFocusX - view.basePivotX) * camera,
      view.basePivotY + (currentFocusY - view.basePivotY) * camera
    )

    view.container.scale.set(
      view.shot.camera.zoom * (1 + (cameraFrame.scale - 1) * camera)
    )
    view.container.rotation = (
      view.shot.camera.rotation + cameraFrame.rotation + shake.rotation
    ) * camera
    view.container.x = view.baseX + (cameraFrame.x * width + shake.x * width) * camera
    view.container.y = view.baseY + (cameraFrame.y * height + shake.y * height) * camera

    if (view.mgParticleLayer) {
      // 为装饰元素制造轻微的时间差/视差效果
      var parallaxScale = this.mod('parallaxScale')
      var particleParallaxX = (cameraFrame.x * width + shake.x * width) * camera * 0.4 * parallaxScale
      var particleParallaxY = (cameraFrame.y * height + shake.y * height) * camera * 0.4 * parallaxScale
      view.mgParticleLayer.position.set(particleParallaxX, particleParallaxY)

      // 基于 shot 时间的连续独立旋转
      view.mgParticleLayer.rotation = (time - view.shot.startTime) * 0.05 * this.mod('mgSwimScale')
      // 更慢的缩放响应制造深度错觉
      view.mgParticleLayer.scale.set(1 + (cameraFrame.scale - 1) * 0.3)
    }

    if (view.mgFixedGeoLayer) {
      // 固定几何无视镜头旋转保持竖直
      view.mgFixedGeoLayer.rotation = -view.container.rotation
    }

    var audioBass = this.audioBassValue
    var audioPower = this.audioPowerValue
    var audioVocal = this.audioVocalValue

    if (typeof view.mgLayer.updateTime === 'function') {
      view.mgLayer.updateTime(
        time,
        view.shot.cues,
        view.shot.startTime,
        view.shot.endTime,
        audioBass,
        audioPower,
        audioVocal
      )
    }

    view.segments.forEach(function (segmentView) {
      var guide = segmentView.guide
      var guideActive = time >= guide.startTime && time <= guide.endTime
      guide.container.visible = guideActive && options.tuning.showGuide && !options.tuning.showOnlyText
      if (guideActive) {
        var guideProgress = Core.clamp01(
          (time - guide.startTime) / Math.max(0.001, guide.endTime - guide.startTime)
        )
        if (typeof guide.update === 'function') {
          guide.container.alpha = guide.maxAlpha
          guide.update(guideProgress)
        } else {
          var eased = Core.easeSonnetInOut(guideProgress)
          guide.container.alpha = Math.sin(eased * Math.PI) * guide.maxAlpha
          guide.container.scale.set(0.76 + eased * 0.24)
        }
      }

      // 装饰开框共享 showFixedGeo 开关
      var frameDecor = segmentView.frameDecor
      if (frameDecor) {
        var frameVisible = options.tuning.showFixedGeo && !options.tuning.showOnlyText
        frameDecor.container.visible = frameVisible
        if (frameVisible) {
          frameDecor.update(Core.clamp01(
            (time - frameDecor.startTime) / Math.max(0.001, frameDecor.endTime - frameDecor.startTime)
          ))
        }
      }

      segmentView.glyphs.forEach(function (glyph) {
        var glyphProgress = Core.resolveSegmentProgress(
          glyph.startTime,
          glyph.settleTime,
          time
        )
        var waiting = time < glyph.startTime
        var offset = (1 - glyphProgress) * motion
        var coreAlpha = waiting ? 0 : 0.16 + glyphProgress * 0.84
        var haloAlpha = waiting ? 0 : 1 - glyphProgress * 0.28
        var scale = Typography.isSonnetEmphasisRole(segmentView.role) && view.shot.kind === 'type-impact'
          ? 0.52 + glyphProgress * 0.48
          : 0.86 + glyphProgress * 0.14
        var x = glyph.baseX + glyph.enterX * offset
        var y = glyph.baseY + glyph.enterY * offset
        var rotation = glyph.finalRotation + glyph.entryRotation * offset
        var isGiantDecorativeText = segmentView.role === 'decoration'
        var showTextGlyph = glyph.isTextGlyph !== false
        var glyphVisible = options.tuning.showOnlyText
          ? showTextGlyph && (!isGiantDecorativeText || options.tuning.showGiantDecorativeText)
          : (!glyph.isBackgroundShape || options.tuning.showBackgroundDecor)
            && (!isGiantDecorativeText || options.tuning.showGiantDecorativeText)

        // 模拟 3D 视差
        var depth = glyph.zDepth || 0
        var parallaxScale = self.mod('parallaxScale')
        // 比镜头更快/更慢移动
        var parallaxX = (cameraFrame.x * width + shake.x * width) * camera * depth * 2.5 * parallaxScale
        var parallaxY = (cameraFrame.y * height + shake.y * height) * camera * depth * 2.5 * parallaxScale
        // 越靠近相机越大（正深度）
        var depthScale = 1 + depth * 0.45 * parallaxScale

        glyph.display.alpha = coreAlpha
        glyph.display.visible = glyphVisible
        glyph.display.scale.set(scale * depthScale)
        glyph.display.position.set(x + parallaxX, y + parallaxY)
        glyph.display.rotation = rotation
        if (glyph.halo) {
          glyph.halo.alpha = haloAlpha
          glyph.halo.scale.set(scale * (1.08 - glyphProgress * 0.08))
          glyph.halo.position.set(x, y)
          glyph.halo.rotation = rotation
        }

        // 色差分离与合并动画
        if (glyph.caCyan && glyph.caRed && glyph.caOffset) {
          glyph.caCyan.visible = glyphVisible && !options.tuning.showOnlyText
          glyph.caRed.visible = glyphVisible && !options.tuning.showOnlyText
          // 起始分离（冲击），并轻轻合并到极细微的基础偏移
          var mergeEased = Core.easeSonnetInOut(glyphProgress)
          var currentOffset = glyph.caOffset * (1 - mergeEased * 0.8) * self.mod('caScale') // 1.0 -> 0.2

          glyph.caCyan.position.set(-currentOffset, currentOffset * 0.5)
          glyph.caRed.position.set(currentOffset, -currentOffset * 0.5)
        }

        // 次强调回声幽灵：入场时沿版式法线分裂，
        // 前四分之一淡入后迅速消失。一次性
        if (glyph.ghosts && glyph.ghostDuration) {
          var ghostProgress = Core.clamp01((time - glyph.startTime) / glyph.ghostDuration)
          var ghostActive = glyphVisible && ghostProgress > 0 && ghostProgress < 1
          // 快速淡入，然后平方衰减让回声迅速消亡
          var envelope = ghostProgress <= 0.2
            ? ghostProgress / 0.2
            : Math.pow(1 - (ghostProgress - 0.2) / 0.8, 2)
          var spread = (1 - Math.pow(1 - ghostProgress, 3)) * self.mod('ghostScale')
          glyph.ghosts.forEach(function (ghost) {
            ghost.node.visible = ghostActive
            if (!ghostActive) return
            ghost.node.position.set(ghost.dirX * spread, ghost.dirY * spread)
            ghost.node.alpha = envelope * ghost.alphaBase
          })
        }

        if (typeof glyph.updateAnimation === 'function') glyph.updateAnimation(time)
      })
    })
  }

  SonnetPixiRuntime.prototype.renderFrame = function () {
    if (this.destroyed) return
    // 在段落查找之前推进歌曲交接，让提交落在本帧的场景选择上
    this.advanceSongSwap()
    if (this.options.program.paragraphs.length === 0) {
      Scene.sonnetDebugState.activeShot = null
      Scene.sonnetDebugState.paragraphIndex = -1
      return
    }
    var self = this
    var time = this.currentTimeValue
    var paragraphIndex = findParagraphIndexAtTime(this.options.program, time)
    if (paragraphIndex !== this.activeParagraphIndex) {
      this.activeParagraphIndex = paragraphIndex
      this.ensureScene(paragraphIndex)
      this.pruneScenes(paragraphIndex)
    } else if (!this.songSwap) {
      // 邻居是尚未到来的边界的预滚，因此每帧最多构建一个，
      // 而不是把三个都堆到刚切换段落的帧上。
      // 场景构建要对每个字形跑布局并创建 pixi.Text；一次三个就是掉帧
      var next = paragraphIndex + 1
      var previous = paragraphIndex - 1
      if (next < this.options.program.paragraphs.length && !this.sceneCache.has(next)) {
        this.ensureScene(next)
      } else if (previous >= 0 && !this.sceneCache.has(previous)) {
        this.ensureScene(previous)
      }
    }
    var width = Math.max(this.options.host.clientWidth, 320)
    var height = Math.max(this.options.host.clientHeight, 240)
    var paragraphs = this.options.program.paragraphs
    var finalParagraph = paragraphs.length > 0 ? paragraphs[paragraphs.length - 1] : null
    var creditsFrame = Scene.resolveSonnetCreditsFrame(
      time,
      finalParagraph ? finalParagraph.endTime : Number.POSITIVE_INFINITY
    )
    var hasCredits = this.creditsContainer.children.length > 0

    this.sceneCache.forEach(function (scene, index) {
      var isActive = index === paragraphIndex

      // 严格可见性：永远只绘制活跃场景。场景之间零重叠
      scene.container.visible = isActive
      if (!isActive) {
        var previousShot = scene.shots[scene.activeShotIndex]
        if (previousShot) Core.unloadSonnetDisplayTree(previousShot.container)
        scene.activeShotIndex = -1
        return
      }

      var transitionsEnabled = self.options.tuning.enableTransitions && !self.options.staticMode
      var transitionSeed = Core.hashSonnetSeed(self.options.program.seed + ':' + scene.paragraph.id + ':transition-frame')
      var previousTransition = index > 0 && paragraphs[index - 1]
        ? paragraphs[index - 1].transitionOut
        : null
      var enterDuration = previousTransition
        ? Math.max(0.16, Math.min(0.3, previousTransition.endTime - previousTransition.startTime))
        : 0
      var entering = transitionsEnabled
        && previousTransition !== null
        && time >= scene.paragraph.startTime
        && time <= scene.paragraph.startTime + enterDuration
      var paragraphTransitionFrame = entering
        ? Scene.resolveSonnetEnterTransitionFrame(
          previousTransition.kind,
          time - scene.paragraph.startTime,
          enterDuration,
          true,
          transitionSeed
        )
        : Scene.resolveSonnetExitTransitionFrame(
          scene.paragraph,
          time,
          transitionsEnabled,
          transitionSeed
        )

      // 严格确定场景内唯一的活跃 shot，避免场景内残影
      var activeShotIndex = 0
      for (var i = scene.shots.length - 1; i >= 0; i--) {
        if (time >= scene.shots[i].shot.startTime) {
          activeShotIndex = i
          break
        }
      }

      var visibleShotIndex = activeShotIndex
      var shotTransitionFrame = Scene.resolveSonnetShotTransitionFrame(
        scene.shotTimeline,
        visibleShotIndex,
        time,
        transitionsEnabled,
        transitionSeed
      )
      var transitionFrame = shotTransitionFrame !== Scene.IDLE_SONNET_TRANSITION_FRAME
        ? shotTransitionFrame
        : paragraphTransitionFrame
      scene.shots.forEach(function (shot, shotIndex) {
        var isShotActive = shotIndex === visibleShotIndex
        shot.container.visible = isShotActive
        if (!isShotActive) return
        self.updateShot(shot, time, width, height, 0)
      })
      if (scene.activeShotIndex !== visibleShotIndex) {
        var previousShot2 = scene.shots[scene.activeShotIndex]
        if (previousShot2) Core.unloadSonnetDisplayTree(previousShot2.container)
        scene.activeShotIndex = visibleShotIndex
      }
      // 发布活跃 shot 供调试覆盖层查看
      var activeShot = scene.shots[visibleShotIndex]
      Scene.sonnetDebugState.activeShot = activeShot ? activeShot.debugInfo : null
      Scene.sonnetDebugState.paragraphIndex = index

      var isFinalScene = index === paragraphs.length - 1
      var lyricAlpha = isFinalScene && hasCredits ? creditsFrame.lyricAlpha : 1
      var transitionMotionScale = self.mod('transitionMotionScale')
      var transitionBlurScale = self.mod('transitionBlurScale')
      var transitionGlitchScale = self.mod('transitionGlitchScale')
      scene.container.alpha = transitionFrame.alpha * lyricAlpha
      scene.container.pivot.set(width / 2, height / 2)
      scene.container.position.set(
        width / 2 + transitionFrame.x * width * transitionMotionScale,
        height / 2 + transitionFrame.y * height * transitionMotionScale
      )
      scene.container.scale.set(1 + (transitionFrame.scale - 1) * transitionMotionScale)
      scene.container.rotation = transitionFrame.rotation * transitionMotionScale
      if (scene.transitionBlurFilter) {
        scene.transitionBlurFilter.strength = transitionFrame.blur * transitionBlurScale
        scene.transitionBlurFilter.enabled = transitionFrame.blur > 0.01
      }
      if (scene.transitionGlitchEffect) {
        scene.transitionGlitchEffect.update(transitionFrame.glitch * transitionGlitchScale, transitionFrame.glitchSeed)
        scene.transitionGlitchEffect.filter.enabled = transitionFrame.glitch > 0.01
      }

      if (isFinalScene && hasCredits) {
        self.updateOutroBlur(scene, creditsFrame.lyricBlur)
      }
    })

    if (!creditsFrame.active || !hasCredits) this.clearOutroBlur()
    this.creditsContainer.visible = creditsFrame.active && hasCredits && !this.options.tuning.showOnlyText
    this.creditsContainer.alpha = creditsFrame.posterAlpha
    this.creditsContainer.position.set(
      width / 2,
      height / 2 + creditsFrame.posterOffsetY * height
    )
    this.creditsContainer.scale.set(creditsFrame.posterScale)
  }

  SonnetPixiRuntime.prototype.renderOnce = function () {
    if (this.destroyed || !this.app.canvas.isConnected) return
    this.renderFrame()
    if (this.destroyed) return
    this.app.renderer.render(this.app.stage)
  }

  // 不重建渲染器地交接新曲目。重建会重新初始化 WebGL 与图标纹理池，
  // 且此时画布不在 DOM 中，整个异步构建期间帧会空掉。
  // 在旧歌仍在渲染时预热新主题的图标，只更换场景层——在封面之下，切换永远不是黑洞。
  // 封面淡回后 resolve。
  SonnetPixiRuntime.prototype.swapSong = function (next, signal) {
    var self = this
    if (this.destroyed) return Promise.resolve()
    // 屏幕上没有值得保护的东西：还没有场景定过尺寸，或旧节目没有段落。
    // 给空帧加封面只会造成闪烁。而且不是换歌的交接不播放溶解——见 seed 判定
    var isCoverWorthwhile = next.seed !== this.options.songSeed
      && !this.songSwap
      && this.lastWidth > 0
      && this.options.program.paragraphs.length > 0
      && !(signal && signal.aborted)

    // 封面开始前预热，溶解永远不等解码
    return this.loadIconTextures(next.theme).then(function (pendingIcons) {
      if (self.destroyed || (signal && signal.aborted)) {
        self.releaseIconUrls(pendingIcons.urls)
        return
      }
      if (!isCoverWorthwhile) {
        self.commitSongContext(next, pendingIcons, null)
        return
      }

      return new Promise(function (resolve) {
        var onAbort = function () { self.settleSongSwap() }
        self.songSwap = {
          pending: next,
          pendingIcons: pendingIcons,
          staged: null,
          startedAt: performance.now(),
          settle: resolve,
          detachAbort: function () {
            if (signal) signal.removeEventListener('abort', onAbort)
          }
        }
        if (signal) signal.addEventListener('abort', onAbort, { once: true })
        // 暂停时 ticker 已停止，封面会冻在半途。溶解期间运行它，结束后归还暂停
        if (self.options.paused) self.app.start()
      })
    })
  }

  // 切换本身，发生在封面不透明的瞬间
  SonnetPixiRuntime.prototype.commitSongContext = function (next, icons, staged) {
    this.options.songSeed = next.seed
    this.options.program = next.program
    this.options.theme = next.theme
    // 先获取后释放：两个主题都想要的 url 全程保持活跃引用计数
    this.releaseIconUrls(this.iconUrls)
    this.iconTextures.clear()
    var self = this
    icons.textures.forEach(function (texture, key) { self.iconTextures.set(key, texture) })
    icons.urls.forEach(function (url) { self.iconUrls.add(url) })
    // clearScenes 只遍历缓存，暂存场景刻意不在其中，
    // 因此在被替换歌曲的拆除中幸存
    this.clearScenes()
    if (staged) {
      staged.scene.container.visible = true
      this.sceneCache.set(staged.index, staged.scene)
      // 作为活跃段落接管，使提交帧什么都不用构建
      this.activeParagraphIndex = staged.index
    }
    if (this.lastWidth > 0 && this.lastHeight > 0) {
      this.drawCredits(this.lastWidth, this.lastHeight)
      this.drawOverlay(this.lastWidth, this.lastHeight)
    }
  }

  // 立即结束进行中的交接，提交它还在持有的东西
  SonnetPixiRuntime.prototype.settleSongSwap = function () {
    var swap = this.songSwap
    if (!swap) return
    this.songSwap = null
    swap.detachAbort()
    if (this.destroyed) {
      if (swap.pendingIcons) this.releaseIconUrls(swap.pendingIcons.urls)
      // 从未被接管，也不会有别的东西释放它
      if (swap.staged) this.destroyScene(swap.staged.scene)
    } else {
      if (swap.pending && swap.pendingIcons) {
        this.commitSongContext(swap.pending, swap.pendingIcons, swap.staged)
      } else if (swap.staged) {
        this.destroyScene(swap.staged.scene)
      }
      if (this.options.paused) this.app.stop()
    }
    this.disposeSwapCover()
    swap.settle()
  }

  SonnetPixiRuntime.prototype.disposeSwapCover = function () {
    if (!this.swapCover) return
    this.app.stage.removeChild(this.swapCover)
    this.swapCover.destroy()
    this.swapCover = null
  }

  // 墙钟溶解前进一帧。封面是加在所有容器之上的纯满幅矩形——不是滤镜——
  // 因此不会与每个场景的模糊/故障滤镜互动，切换的任何时刻帧都不透明
  SonnetPixiRuntime.prototype.advanceSongSwap = function () {
    var swap = this.songSwap
    if (!swap) return
    var self = this
    var progress = (performance.now() - swap.startedAt) / SONNET_SONG_SWAP_MS
    if (swap.pending && swap.pendingIcons && !swap.staged && progress >= SONNET_SWAP_STAGE_PROGRESS) {
      // 在这里构建而不是提交时：这是一整个场景的布局与字形栅格化开销，
      // 把这帧花费在封面大部分已进入时，而不是听众看到新歌的那一帧
      var index = findParagraphIndexAtTime(
        swap.pending.program,
        this.currentTimeValue
      )
      if (index >= 0 && index < swap.pending.program.paragraphs.length) {
        var scene = this.buildScene(swap.pending, swap.pendingIcons.textures, index)
        scene.container.visible = false
        this.sceneContainer.addChild(scene.container)
        swap.staged = { scene: scene, index: index }
      }
    }
    if (swap.pending && swap.pendingIcons && progress >= 0.5) {
      this.commitSongContext(swap.pending, swap.pendingIcons, swap.staged)
      swap.pending = null
      swap.pendingIcons = null
      swap.staged = null
    }
    if (progress >= 1) {
      this.settleSongSwap()
      return
    }

    if (!this.swapCover) {
      this.swapCover = new this.pixi.Graphics()
      // 最后添加，位于场景、片尾与覆盖容器之上
      this.app.stage.addChild(this.swapCover)
    }
    var cover = this.swapCover
    // 溶解全程 0 → 1 → 0，恰好在提交落点处不透明
    cover.alpha = 1 - Math.abs(progress * 2 - 1)
    cover.clear()
    cover
      .rect(0, 0, this.lastWidth, this.lastHeight)
      .fill({ color: this.pixi.Color.shared.setValue(this.options.theme.backgroundColor).toNumber() })
  }

  // 读取 mod 调制键，缺失时回退 1 使帧不变
  SonnetPixiRuntime.prototype.mod = function (key) {
    var value = this.options.modulation ? this.options.modulation[key] : undefined
    return typeof value === 'number' && Number.isFinite(value) ? value : 1
  }

  // 调制滑杆每次变化时热替换调制映射，不重建 Pixi 上下文
  SonnetPixiRuntime.prototype.setModulation = function (modulation) {
    if (this.destroyed) return
    this.options.modulation = modulation
    if (this.options.paused) this.renderOnce()
  }

  SonnetPixiRuntime.prototype.setPaused = function (paused) {
    if (this.destroyed) return
    this.options.paused = paused
    if (paused) {
      this.app.stop()
      this.renderOnce()
    } else {
      this.app.start()
    }
  }

  // 每帧注入播放状态（原版 MotionValue 读取的等价物）
  SonnetPixiRuntime.prototype.setPlaybackState = function (currentTime, audioPower, audioBands) {
    this.currentTimeValue = currentTime
    this.audioPowerValue = audioPower || 0
    this.audioBassValue = audioBands ? (audioBands.bass || 0) : 0
    this.audioVocalValue = audioBands ? (audioBands.vocal || 0) : 0
  }

  SonnetPixiRuntime.prototype.destroy = function () {
    if (this.destroyed) return
    this.destroyed = true
    Scene.sonnetDebugState.activeShot = null
    Scene.sonnetDebugState.paragraphIndex = -1
    // 拆除应用之前释放所有等待交接的方，
    // 否则那个 promise 永不落定，调用者的排空循环会停在上面
    this.settleSongSwap()
    if (this.resizeObserver) {
      this.resizeObserver.disconnect()
      this.resizeObserver = null
    }
    this.app.stop()
    this.app.ticker.remove(this.renderFrameBound)
    this.clearScenes()
    Core.destroySonnetContainerChildren(this.creditsContainer)
    this.iconTextures.clear()
    this.releaseIconUrls(this.iconUrls)
    this.app.destroy({ removeView: true }, { children: true, texture: true })
  }

  window.FoliaSonnetRuntime = {
    SONNET_SONG_SWAP_MS: SONNET_SONG_SWAP_MS,
    SonnetPixiRuntime: SonnetPixiRuntime
  }
})()
