// 花火的 Pixi 运行时（移植自 folia-major hanabi/createHanabiPixiRuntime.ts，HanabiPixiRuntime 类）：
// 建一次，换歌就地交接。每帧只读时间这一个数，按 hanabiSceneFrames 决定画哪几个段落场景，场景缓存当前段 ±1（同绘光），
// 一帧最多做一件贵的事（建一个场景 / 备一个马上要出场的镜头 / 建片尾卡 / 销毁一个被换下的场景）。
// 粒子纹理整个运行时共用（分辨率变了重画）。层级：夜空底 → 段落场景 → 片尾卡 → 画框。
// 智能动感模式（hanabiBeatFx.ts）：节拍表装好、效果开着时，「随拍开花」把节拍表交给在画的场景，「随拍推镜」把拍的包络
// 套在整个场景层上（以画面中心推近、左右轻摆）。静态模式下两个都不放。
// 全屏辉光（hanabiScreenBloom.ts）：整体辉光 + 副歌辉光 × 副歌权重，挂在场景层上（夜空底与片尾卡不进），强度为 0 时摘掉。
// 分辨率与抗锯齿（#929）：外壳把合出来的倍数与抗锯齿传进来；倍数就地改（同窗口缩放：渲染器立刻跟上，场景防抖重建），
// 抗锯齿只能建上下文时定，变了由外壳重建运行时。
//
// 插件差异（相对上游，见 PORTING.md）：
//   1. 驱动循环：不自持 Pixi ticker——模式入口每帧调 renderFrame(performance.now())，内部逻辑全保留；
//      paused 语义由入口传（只影响 swapSong 等的判断），每帧照常 render（bridge tick 天然节流）。
//   2. currentTime MotionValue → 构造 options.currentTime 数字 + setInput 每帧更新（this._inputTime）。
//   3. loadPixi / makePixiContext / linkPixiPrograms 跳过：vendor pixi 已加载，直接 new PIXI.Application + app.init；
//      首帧着色器预热（programWarmup）不接（首帧编译开销一次性），GlProgram 高精度默认值在 app.init 前补上。
//   4. 'Hanabi requires WebGL' 检查保留；setHanabiGlyphTextureLimit(gl.getParameter(gl.MAX_TEXTURE_SIZE)) 保留。
//   5. ResizeObserver 保留（防抖 220ms 重建场景）；webglcontextlost 保留（canvas 事件 → options.onContextLost 回调入口重建）。
//   6. holding / destroyed 语义保留：init 完成前 renderFrame 短路（holding），销毁后全部方法短路。
(function () {
  'use strict'
  var PIXI = window.PIXI

  var Host = window.FoliaHanabiPixiHost
  var Sky = window.FoliaHanabiSky
  var Program = window.FoliaHanabiProgram
  var Transitions = window.FoliaHanabiTransitions
  var Core = window.FoliaHanabiCore
  var Overlay = window.FoliaHanabiOverlay
  var Bloom = window.FoliaHanabiBloom
  var BeatFx = window.FoliaHanabiBeatFx
  var Textures = window.FoliaHanabiTextures
  var TextGlyphs = window.FoliaHanabiTextGlyphs
  var CreditsLayerMod = window.FoliaHanabiCreditsLayer

  /** 场景要重建时等多久（滑块拖动、窗口拖拽缩放时不每帧重建）。 */
  var REBUILD_DEBOUNCE_MS = 220
  var MIN_WIDTH = 320
  var MIN_HEIGHT = 240
  /** 夜空不透明度到这里以上，配色按深色底算（纸白字、亮色描边）。 */
  var DARK_SKY = 0.5
  var NIGHT_BACKGROUND = '#0b0d24'
  /** 渲染倍率上限（上游 utils/lyricRenderQuality.ts 的 MAX_LYRIC_PIXEL_RATIO）。 */
  var MAX_LYRIC_PIXEL_RATIO = 3

  /** 智能动感的效果 id（上游 BEAT_EFFECT_IDS.hanabiBeatBursts / hanabiBeatPulse）。 */
  var EFFECT_BURSTS = 'hanabi.beatBursts'
  var EFFECT_PULSE = 'hanabi.beatPulse'

  /**
   * 实际的渲染倍率：花火自己的像素密度（resolveHanabiBaseResolution）乘上分辨率倍数（>1 时封顶 3，
   * 与上游 utils/lyricRenderQuality.ts 的 resolveLyricPixelRatio 同式）。
   */
  function resolveRenderResolution(devicePixelRatio, scale) {
    var base = Core.resolveHanabiBaseResolution(devicePixelRatio)
    var safeBase = Number.isFinite(base) && base > 0 ? base : 1
    var ratio = safeBase * scale
    return scale > 1 ? Math.max(safeBase, Math.min(ratio, MAX_LYRIC_PIXEL_RATIO)) : ratio
  }

  /** 换主题时只看真正影响画面的字段：主题对象在改字体时也会换引用。 */
  function themeKey(theme) {
    return [
      theme.backgroundColor, theme.primaryColor, theme.accentColor, theme.secondaryColor,
      (theme.wordColors || []).map(function (entry) { return entry.word + '=' + entry.color }).join(','),
      (theme.lyricsIcons || []).join(','),
      theme.fontStyle, theme.fontFamily || '', String(theme.fontWeight || ''),
      theme.name || '', theme.description || '', theme.animationIntensity
    ].join('|')
  }

  /**
   * 花火运行时。options：{
   *   host：画布容器；song：{ seed, program, theme }；tuning；currentTime（数字，每帧 setInput 更新）；
   *   staticMode；showText；paused；metadata：{ title, artist, album }；
   *   renderScale（分辨率倍数，预览传 1）；antialias（建上下文时定）；onContextLost（WebGL 上下文丢失回调）。
   * }
   */
  function HanabiRuntime(options) {
    var self = this
    this.options = options
    this.destroyed = false
    // 首帧就绪前为 true：app.init 完成前 renderFrame / renderOnce 短路。
    this.holding = true

    // 段落场景缓存：按段落下标缓存当前段 ±1，换歌整批换下，换下的场景一帧销毁一个。
    this.sceneCache = new Host.PixiSceneCache({
      count: function () { return self.options.song.program.paragraphs.length },
      build: function (index) {
        var entry = self.buildEntry(self.options.song, index)
        self.sceneLayer.addChild(entry.holder)
        return entry
      },
      destroy: function (entry) { Sky.destroyHanabiSceneEntry(entry) },
      detach: function (entry) {
        if (entry.holder.parent) entry.holder.parent.removeChild(entry.holder)
      }
    })
    // 换歌交接两帧状态机：第一帧在旧歌还在画时把新歌当前段落的场景建好（stage），第二帧切过去（commit）。
    this.songSwap = new Host.PixiSongSwap({
      stage: function (song) { return self.stageSong(song) },
      commit: function (song, staged) { self.commitSong(song, staged) },
      discard: function (entry) { Sky.destroyHanabiSceneEntry(entry) }
    })

    this.activeIndex = -1
    this.resizeObserver = null
    this.width = 0
    this.height = 0
    this.renderResolution = 1
    this.rebuildTimer = null
    this.rebuildDue = false
    /** 场景、片尾卡、画框用的主题：夜空够深时背景色换成夜色，配色按深色底取。 */
    this.sceneTheme = null

    this.textures = null
    this.texturesResolution = 0
    /** 分辨率变了换下来的纹理：还被已建好的场景用着，等场景都换掉后再放。 */
    this.retiredTextures = []
    /** 上一次重建之后，换下来的纹理可以放了。 */
    this.texturesReleasable = false

    /** 全屏辉光：第一次需要时才建；滤镜区域固定为整个画面（随内容包围盒变会让降采样网格跟着抖）。 */
    this.screenBloom = null
    this.screenBloomArea = null

    /** 每帧交给场景的「随拍开花」输入（就地改，不分配）。 */
    this.beatSource = { events: [], strength: 0, trackScale: 1 }

    // MotionValue（currentTime）→ 普通数字：入口每帧 setInput 更新，renderFrame 读 this._inputTime。
    this._inputTime = typeof options.currentTime === 'number' && Number.isFinite(options.currentTime) ? options.currentTime : 0
    this._onContextLost = null
    // 初始主题签名：setTheme 首次调用拿到相同主题时直接跳过（不清场景）。
    this._themeSignature = options.song && options.song.theme ? themeKey(options.song.theme) : null

    // ── 建上下文（上游 loadPixi + makePixiContext + app.init 的合并）──
    // 上游 loadPixi：在第一个着色器编译前把 fragment 默认精度提到 highp（NVIDIA Linux 的 mediump 是真 fp16，
    // 会让后处理里的大数溢出成黑块）。vendor pixi 已加载，这里就地补默认值；8.20.1 存在该 API，try/catch 包住。
    try {
      if (PIXI.GlProgram && PIXI.GlProgram.defaultOptions) {
        PIXI.GlProgram.defaultOptions.preferredFragmentPrecision = 'highp'
      }
    } catch (e) { /* 版本没有该 API 时忽略 */ }

    var app = new PIXI.Application()
    this.app = app
    var width = Math.max(options.host.clientWidth, MIN_WIDTH)
    var height = Math.max(options.host.clientHeight, MIN_HEIGHT)
    var resolution = resolveRenderResolution(window.devicePixelRatio, options.renderScale)
    // 画布透明：夜空不透明度小于 1 时 folia 的共享背景要透出来。
    this._initPromise = app.init({
      width: width,
      height: height,
      backgroundAlpha: 0,
      antialias: Boolean(options.antialias),
      powerPreference: 'high-performance',
      autoDensity: true,
      resolution: resolution,
      autoStart: false,
      sharedTicker: false,
      preference: 'webgl'
    }).then(function () {
      if (self.destroyed) return
      // 'Hanabi requires WebGL'：花火满天粒子与 bloom 都吃 WebGL，拿到的不是 WebGL 渲染器就放弃（外壳给兜底文字）。
      var webglType = PIXI.RendererType ? PIXI.RendererType.WEBGL : 1
      if (app.renderer.type !== webglType) {
        app.destroy({ removeView: true })
        throw new Error('Hanabi requires WebGL')
      }
      // 字形图集按物理像素封顶时要知道 GPU 单张纹理能多大。
      var gl = app.renderer.gl
      if (gl) TextGlyphs.setHanabiGlyphTextureLimit(gl.getParameter(gl.MAX_TEXTURE_SIZE))
      self.renderResolution = resolution
      self.sky = new Sky.HanabiSkyLayer(PIXI)
      self.sceneLayer = new PIXI.Container()
      // 交叉渐变时两个段落场景叠放，按段落顺序排。
      self.sceneLayer.sortableChildren = true
      self.overlayLayer = new PIXI.Container()
      self.credits = new CreditsLayerMod.HanabiCreditsLayer(PIXI)
      app.stage.addChild(self.sky.view)
      app.stage.addChild(self.sceneLayer)
      app.stage.addChild(self.credits.holder)
      app.stage.addChild(self.overlayLayer)
      // WebGL 上下文丢了：通知入口销毁并重建运行时。
      self._onContextLost = function (event) {
        event.preventDefault()
        if (self.options.onContextLost) self.options.onContextLost()
      }
      app.canvas.addEventListener('webglcontextlost', self._onContextLost)
      self.install()
    }).catch(function (e) {
      // 建不起来（没有 WebGL 等）：保持 holding，入口显示兜底文字。
      if (!self.destroyed) console.warn('[FoliaHanabi] 运行时初始化失败', e)
    })
    // 记下来（测试 / 调试可等它）。
    this.readyPromise = this._initPromise.then(function () { return self })
  }

  /**
   * 首帧分几步做（同绘光）：init 完成后先量尺寸、画一帧，再把画布放上页面、接 ResizeObserver。
   * 上游的 linkPixiPrograms（链接着色器预热）跳过：首帧编译开销一次性，插件不接。
   */
  HanabiRuntime.prototype.install = function () {
    var self = this
    this.resizeToHost(true)
    // 首帧就绪：先放开 holding 再画第一帧（同绘光——画布放上页面之前就有一帧内容）。
    this.holding = false
    this.renderFrame()
    this.options.host.appendChild(this.app.canvas)
    this.app.canvas.style.cssText = 'width:100%;height:100%;display:block'
    // 不自持 ticker（插件差异）：渲染由模式入口的 tick 驱动，每帧调 renderFrame。
    this.resizeObserver = new ResizeObserver(function () {
      if (self.destroyed || !self.resizeToHost(false)) return
    })
    this.resizeObserver.observe(this.options.host)
    this.app.renderer.render(this.app.stage)
    // 上游 !paused 时 app.start()：不自持 ticker，不需要。
  }

  /** 尺寸没变返回 false。渲染器立刻跟上，场景（尺寸烘焙在里面）防抖重建。 */
  HanabiRuntime.prototype.resizeToHost = function (immediate) {
    if (this.destroyed) return false
    var width = Math.max(this.options.host.clientWidth, MIN_WIDTH)
    var height = Math.max(this.options.host.clientHeight, MIN_HEIGHT)
    var resolution = resolveRenderResolution(window.devicePixelRatio, this.options.renderScale)
    if (width === this.width && height === this.height && resolution === this.renderResolution) return false
    this.width = width
    this.height = height
    this.renderResolution = resolution
    this.app.renderer.resize(width, height, resolution)
    this.drawOverlay()
    if (immediate) this.rebuildDue = true
    else this.scheduleRebuild()
    return true
  }

  HanabiRuntime.prototype.scheduleRebuild = function () {
    var self = this
    if (this.rebuildTimer !== null) window.clearTimeout(this.rebuildTimer)
    this.rebuildTimer = window.setTimeout(function () {
      self.rebuildTimer = null
      if (self.destroyed) return
      self.rebuildDue = true
    }, REBUILD_DEBOUNCE_MS)
  }

  HanabiRuntime.prototype.themeFor = function (theme) {
    var dark = !this.options.tuning.textOnly && this.options.tuning.sky >= DARK_SKY
    if (!this.sceneTheme || this.sceneTheme.source !== theme || this.sceneTheme.dark !== dark) {
      this.sceneTheme = {
        source: theme,
        dark: dark,
        theme: dark ? Object.assign({}, theme, { backgroundColor: NIGHT_BACKGROUND }) : theme
      }
    }
    return this.sceneTheme.theme
  }

  HanabiRuntime.prototype.texturesNow = function () {
    if (!this.textures || this.texturesResolution !== this.renderResolution) {
      if (this.textures) this.retiredTextures.push(this.textures)
      this.textures = Textures.createHanabiTextures(PIXI, this.renderResolution)
      this.texturesResolution = this.renderResolution
    }
    return this.textures
  }

  HanabiRuntime.prototype.drawOverlay = function () {
    // init 未完成（层还没建）时不画：install 里的 resizeToHost(true) 会补上第一帧的画框。
    if (this.destroyed || !this.overlayLayer) return
    Bloom.destroyPixiContainerChildren(this.overlayLayer)
    var tuning = this.options.tuning
    if (!tuning.overlayFrame || tuning.textOnly || this.width === 0) return
    this.overlayLayer.addChild(Overlay.buildHanabiOverlay(
      PIXI,
      this.width,
      this.height,
      this.themeFor(this.options.song.theme),
      tuning.colorMode,
      this.renderResolution
    ))
  }

  HanabiRuntime.prototype.buildEntry = function (song, index) {
    return Sky.buildHanabiSceneEntry(PIXI, {
      width: this.width,
      height: this.height,
      resolution: this.renderResolution,
      program: song.program,
      theme: this.themeFor(song.theme),
      tuning: this.options.tuning,
      textures: this.texturesNow(),
      showText: this.options.showText,
      motifs: this.motifs(),
      songTitle: this.options.metadata.title ? this.options.metadata.title.trim() : null,
      songArtist: this.options.metadata.artist ? this.options.metadata.artist.trim() : null,
      icons: this.iconsFor(song.theme)
    }, index)
  }

  /** 拼贴的字样：曲名在前，再是 HANABI / 花火（没有关键词时重复字用它们）。 */
  HanabiRuntime.prototype.motifs = function () {
    var title = this.options.metadata.title ? this.options.metadata.title.trim() : null
    var motifs = []
    if (title) motifs.push(title)
    motifs.push('HANABI')
    motifs.push('花火')
    return motifs
  }

  /** 拼贴里开花时蹦出来的图标：插件无 lucide 图标库，恒用花火兜底图标（HANABI_FALLBACK_ICON = 'Flower'）。 */
  HanabiRuntime.prototype.iconsFor = function () {
    return [window.FoliaHanabiCollagePlan.HANABI_FALLBACK_ICON]
  }

  HanabiRuntime.prototype.clearScenes = function () {
    this.sceneCache.clear()
    this.activeIndex = -1
  }

  /**
   * 换下来的纹理只在分辨率变化时出现，而分辨率变化总会跟着一次重建：重建清掉缓存场景与片尾卡之后（换歌换下、
   * 还没销毁完的场景也放完），就没有谁再用它们了。重建之前（防抖期间）旧场景还在画，不能放。
   */
  HanabiRuntime.prototype.releaseRetiredTextures = function () {
    if (!this.texturesReleasable || this.sceneCache.hasRetired || this.songSwap.active) return
    this.texturesReleasable = false
    var retired = this.retiredTextures.splice(0)
    for (var i = 0; i < retired.length; i += 1) retired[i].destroy()
  }

  HanabiRuntime.prototype.renderFrame = function () {
    if (this.destroyed || this.holding) return
    var time = this._inputTime
    this.songSwap.advance()
    if (this.rebuildDue) {
      this.rebuildDue = false
      this.songSwap.dropStaged()
      this.clearScenes()
      this.credits.invalidate()
      // 分辨率变了就在这里换纹理：用旧纹理的场景刚清掉。
      this.texturesNow()
      if (this.retiredTextures.length > 0) this.texturesReleasable = true
    }
    var program = this.options.song.program
    var theme = this.options.song.theme
    var tuning = this.options.tuning
    var pixi = PIXI
    this.sky.update(theme, tuning.textOnly ? 0 : tuning.sky, this.width, this.height)
    var frames = Transitions.resolveHanabiSceneFrames(program, time, !this.options.staticMode)
    var builtThisFrame = false
    if (frames.activeIndex !== this.activeIndex) {
      this.activeIndex = frames.activeIndex
      var keep = new Set()
      for (var i = 0; i < frames.layers.length; i += 1) keep.add(frames.layers[i].index)
      this.sceneCache.prune(frames.activeIndex, keep)
    }
    for (var l = 0; l < frames.layers.length; l += 1) {
      if (!this.sceneCache.has(frames.layers[l].index)) {
        this.sceneCache.ensure(frames.layers[l].index)
        builtThisFrame = true
      }
    }

    var creditsFrame = this.credits.resolveFrame(time, program, this.options.metadata)
    if (!builtThisFrame && !this.songSwap.active) {
      // 一帧只做一件贵的事，按优先级：释放换下的场景 → 备好马上要出场的镜头 → 预建下一段 → 片尾卡 → 预建上一段。
      var next = frames.activeIndex + 1
      var previous = frames.activeIndex - 1
      if (this.sceneCache.hasRetired) {
        this.sceneCache.drainRetired()
      } else if (this.prepareShots(time)) {
        // 画了一个镜头的字形图集，或建了它的烟花池、装饰件与拼贴。
      } else if (next >= 0 && next < program.paragraphs.length && !this.sceneCache.has(next)) {
        this.sceneCache.ensure(next)
      } else if (this.credits.needsBuild(time, program, this.options.metadata)) {
        this.credits.build(this.creditBuildContext(theme))
      } else if (previous >= 0 && !this.sceneCache.has(previous)) {
        this.sceneCache.ensure(previous)
      }
    }
    if (creditsFrame.active && !this.credits.built && this.credits.hasMetadata(this.options.metadata)) {
      this.credits.build(this.creditBuildContext(theme))
    }
    this.releaseRetiredTextures()

    var beats = this.readBeatSource()
    this.applyBeatPulse()
    this.applyScreenBloom(time)

    var lyricAlpha = creditsFrame.active ? creditsFrame.lyricAlpha : 1
    var lyricBlur = creditsFrame.active ? creditsFrame.lyricBlur : 0
    var blurResolution = this.renderResolution * 0.5
    var spinTurn = tuning.textOnly ? 0 : tuning.spin * Sky.hanabiSpinDirection(program.seed)
    // 画面尺寸提到循环外建一次（PixiSceneCache.forEach 不传 thisArg，回调里不依赖 this）。
    var viewSize = { width: this.width, height: this.height }
    this.sceneCache.forEach(function (entry, index) {
      var layer = null
      for (var i = 0; i < frames.layers.length; i += 1) {
        if (frames.layers[i].index === index) { layer = frames.layers[i]; break }
      }
      var alpha = (layer ? layer.alpha : 0) * lyricAlpha
      entry.holder.visible = alpha > 0.002
      if (!entry.holder.visible || !layer) return
      entry.scene.update(time, beats)
      Sky.applyHanabiLayerFrame(pixi, entry, {
        alpha: alpha,
        scale: layer.scale,
        blur: Math.max(layer.blur, lyricBlur),
        y: layer.y,
        // 段落转场的旋转跟着「旋转」设置与整首歌的旋转方向走；仅显示歌词文字时不转。
        rotation: layer.rotation * spinTurn
      }, viewSize, blurResolution)
    })
    this.credits.update(time, creditsFrame, this.width, this.height)
    // 每帧渲染（插件差异）：上游由 Pixi ticker 的渲染步完成，这里并入 renderFrame（bridge tick 天然节流）。
    this.app.renderer.render(this.app.stage)
  }

  /** 缓存里的场景（当前段与预建好的下一段）谁有马上要出场的镜头就备一个；做了返回 true。 */
  HanabiRuntime.prototype.prepareShots = function (time) {
    var done = false
    this.sceneCache.forEach(function (entry) {
      if (!done) done = entry.scene.prepare(time)
    })
    return done
  }

  /** 「随拍开花」这一帧的输入；智能动感总开关关着、节拍表没装好、效果关着、静态模式时为 null。 */
  HanabiRuntime.prototype.readBeatSource = function () {
    var FoliaBeatFx = window.FoliaBeatFx
    if (this.options.staticMode || this.options.tuning.textOnly || !FoliaBeatFx || !FoliaBeatFx.isReady() || !FoliaBeatFx.smartBeatActive()) return null
    var strength = FoliaBeatFx.getEffectStrength(EFFECT_BURSTS)
    if (strength <= 0) return null
    this.beatSource.events = FoliaBeatFx.getEvents()
    this.beatSource.strength = strength
    this.beatSource.trackScale = FoliaBeatFx.getTrackScale()
    return this.beatSource
  }

  /** 全屏辉光：强度为 0 时摘掉 filter，否则挂上并按画面尺寸固定滤镜区域。 */
  HanabiRuntime.prototype.applyScreenBloom = function (time) {
    var tuning = this.options.tuning
    var program = this.options.song.program
    var strength = Program.resolveHanabiScreenBloomStrength(tuning.bloom, tuning.chorusBloom, Program.resolveHanabiChorusWeight(program.chorus, time))
    if (strength <= 0.01) {
      if (this.sceneLayer.filters && this.sceneLayer.filters.length) this.sceneLayer.filters = []
      return
    }
    if (!this.screenBloom) {
      // 亮部才进 bloom（字的白、烟花、贴纸的白边），阈值比烟花层自己的辉光高，画面不至于整片发灰。
      this.screenBloom = Bloom.createBloomFilter(PIXI, { strength: strength, threshold: 0.5, knee: 0.3, levels: 5, spread: 0.85, tint: [1, 0.95, 0.98], padding: 0 })
      // 满分辨率：默认 1 时 1.5× / 2× 屏上整层字会先画成 1× 再拉伸，开着辉光时字会糊。
      this.screenBloom.resolution = 'inherit'
      this.screenBloomArea = new PIXI.Rectangle()
    }
    this.screenBloom.options.strength = strength
    this.screenBloomArea.x = 0
    this.screenBloomArea.y = 0
    this.screenBloomArea.width = this.width
    this.screenBloomArea.height = this.height
    this.sceneLayer.filterArea = this.screenBloomArea
    if (!this.sceneLayer.filters || this.sceneLayer.filters.indexOf(this.screenBloom) < 0) this.sceneLayer.filters = [this.screenBloom]
  }

  /**
   * 「随拍推镜」：整个场景层以画面中心推近、左右轻摆；没有拍时复原。
   * 时钟的包络已经乘了「第一个读节拍表的效果」的强度：先除掉时钟强度（hanabi.beatBursts）再乘自己的（hanabi.beatPulse）。
   */
  HanabiRuntime.prototype.applyBeatPulse = function () {
    var FoliaBeatFx = window.FoliaBeatFx
    var strength = this.options.staticMode || this.options.tuning.textOnly || !FoliaBeatFx || !FoliaBeatFx.isReady() || !FoliaBeatFx.smartBeatActive()
      ? 0
      : FoliaBeatFx.getEffectStrength(EFFECT_PULSE)
    this.sceneLayer.pivot.set(this.width / 2, this.height / 2)
    this.sceneLayer.position.set(this.width / 2, this.height / 2)
    if (strength <= 0) {
      this.sceneLayer.scale.set(1)
      this.sceneLayer.rotation = 0
      return
    }
    var clockStrength = FoliaBeatFx.getEffectStrength(EFFECT_BURSTS)
    var pulse = BeatFx.resolveHanabiBeatPulse(
      BeatFx.rescaleBeatEnvelope(FoliaBeatFx.getImpact('beat'), clockStrength, strength),
      BeatFx.rescaleBeatEnvelope(FoliaBeatFx.getImpact('downbeat'), clockStrength, strength),
      FoliaBeatFx.getRotationSign()
    )
    this.sceneLayer.scale.set(pulse.scale)
    this.sceneLayer.rotation = pulse.rotation
  }

  HanabiRuntime.prototype.creditBuildContext = function (theme) {
    return {
      width: this.width,
      height: this.height,
      resolution: this.renderResolution,
      theme: this.themeFor(theme),
      metadata: this.options.metadata,
      tuning: this.options.tuning,
      textures: this.texturesNow(),
      icons: this.iconsFor(theme)
    }
  }

  /** 入口每帧注入当前时间（MotionValue → 普通数字的插件差异点）。 */
  HanabiRuntime.prototype.setInput = function (currentTime) {
    this._inputTime = typeof currentTime === 'number' && Number.isFinite(currentTime) ? currentTime : this._inputTime
  }

  /** 补一帧（画布还没放上页面时不画）。入口暂停时拖进度用；bridge tick 每帧 renderFrame，一般用不到。 */
  HanabiRuntime.prototype.renderOnce = function () {
    if (this.destroyed || this.holding) return
    if (!this.app.canvas || !this.app.canvas.isConnected) return
    this.renderFrame()
  }

  /**
   * 换歌：新歌当前段落的场景在第一帧建好（旧歌还在画），第二帧切过去；换下的场景之后一帧销毁一个。
   * 不是真正的换歌（同一个 seed：主题改了、歌词晚到）、暂停中、还没有画面时直接替换。
   */
  HanabiRuntime.prototype.swapSong = function (next) {
    if (this.destroyed) return Promise.resolve()
    if (
      next.seed === this.options.song.seed
      || this.songSwap.active
      || this.width === 0
      || this.sceneCache.size === 0
      || this.options.paused
    ) {
      this.commitSong(next, null)
      return Promise.resolve()
    }
    return this.songSwap.begin(next, null)
  }

  /** 交接的第一帧：离屏建好新歌当前段落的场景（不进缓存，旧歌的场景被换下时它不受影响）。 */
  HanabiRuntime.prototype.stageSong = function (song) {
    var index = Program.findHanabiParagraphIndexAtTime(song.program, this._inputTime)
    if (index < 0 || index >= song.program.paragraphs.length) return null
    var entry = this.buildEntry(song, index)
    entry.holder.visible = false
    this.sceneLayer.addChild(entry.holder)
    return entry
  }

  HanabiRuntime.prototype.commitSong = function (next, staged) {
    var themeChanged = next.theme !== this.options.song.theme
    this.options.song = next
    if (staged) {
      this.sceneCache.retireAll()
      this.sceneCache.adopt(staged.index, staged)
      this.activeIndex = staged.index
    } else {
      this.clearScenes()
    }
    // init 未完成时片尾卡层还不存在（install 后的首帧会按当前状态建）。
    if (this.credits) this.credits.invalidate()
    if (themeChanged) this.drawOverlay()
  }

  /** 主题就地换（插件差异，上游走 songContext 重建 → swapSong）：key 比对在 runtime 内，变了清场景重建。 */
  HanabiRuntime.prototype.setTheme = function (theme) {
    if (this.destroyed || !theme) return
    var signature = themeKey(theme)
    if (this._themeSignature === signature && this.options.song.theme === theme) return
    var themeChanged = themeKey(this.options.song.theme) !== signature
    this._themeSignature = signature
    // 交接中：先把挂起的交接立即了结（否则它落定时会把 song 连主题一起换回去），再应用新主题。
    if (this.songSwap.active) this.songSwap.settle(true)
    this.options.song = { seed: this.options.song.seed, program: this.options.song.program, theme: theme }
    this.clearScenes()
    if (this.credits) this.credits.invalidate()
    if (themeChanged) this.drawOverlay()
  }

  /** 就地应用 tuning：夜空每帧现读，画框按需重画，烘焙进场景的字段（含夜空深浅换配色）防抖重建。 */
  HanabiRuntime.prototype.setTuning = function (tuning) {
    if (this.destroyed || tuning === this.options.tuning) return
    var previous = this.options.tuning
    this.options.tuning = tuning
    var darkChanged = (previous.sky >= DARK_SKY) !== (tuning.sky >= DARK_SKY)
    if (Core.changedHanabiKeys(previous, tuning, Core.HANABI_OVERLAY_KEYS) || darkChanged) this.drawOverlay()
    if (Core.requiresHanabiSceneRebuild(previous, tuning) || darkChanged) this.scheduleRebuild()
  }

  /** 就地换分辨率倍数：同窗口缩放，渲染器立刻跟上，场景（字形图集、粒子纹理按分辨率画）防抖重建。 */
  HanabiRuntime.prototype.setRenderScale = function (scale) {
    if (this.destroyed || scale === this.options.renderScale) return
    this.options.renderScale = scale
    // 还没装好（第一帧前）时 install 里的 resizeToHost 会按新倍数来。
    if (this.width === 0) return
    this.resizeToHost(false)
  }

  HanabiRuntime.prototype.setShowText = function (showText) {
    if (this.destroyed || showText === this.options.showText) return
    this.options.showText = showText
    var apply = function (entry) { entry.scene.setLayerVisibility({ graphics: true, text: showText, mid: false }) }
    this.sceneCache.forEach(apply)
    if (this.songSwap.staged) apply(this.songSwap.staged)
  }

  HanabiRuntime.prototype.setStaticMode = function (staticMode) {
    if (this.destroyed || staticMode === this.options.staticMode) return
    this.options.staticMode = staticMode
  }

  HanabiRuntime.prototype.setSongMetadata = function (metadata) {
    if (this.destroyed) return
    var current = this.options.metadata
    if (current.title === metadata.title && current.artist === metadata.artist && current.album === metadata.album) return
    var currentTitle = current.title ? current.title.trim() : null
    var currentArtist = current.artist ? current.artist.trim() : null
    var nextTitle = metadata.title ? metadata.title.trim() : null
    var nextArtist = metadata.artist ? metadata.artist.trim() : null
    var titleChanged = currentTitle !== nextTitle || currentArtist !== nextArtist
    this.options.metadata = { title: metadata.title, artist: metadata.artist, album: metadata.album }
    if (this.credits) this.credits.invalidate()
    // 曲名、艺人烘焙进了拼贴的开场标题卡与重复字：换了就重建场景（防抖，同一首歌里一般只在开头晚到一次）。
    if (titleChanged) this.scheduleRebuild()
  }

  /** 暂停语义（插件差异）：bridge tick 每帧都在画，这里只记状态（影响 swapSong 的交接决策）。 */
  HanabiRuntime.prototype.setPaused = function (paused) {
    if (this.destroyed) return
    this.options.paused = paused
  }

  HanabiRuntime.prototype.destroy = function () {
    if (this.destroyed) return
    this.destroyed = true
    // 先放掉等交接的人，否则交接的 promise 会一直挂着。
    this.songSwap.settle(false)
    if (this.rebuildTimer !== null) window.clearTimeout(this.rebuildTimer)
    this.rebuildTimer = null
    if (this.resizeObserver) {
      this.resizeObserver.disconnect()
      this.resizeObserver = null
    }
    if (this.app.canvas && this._onContextLost) this.app.canvas.removeEventListener('webglcontextlost', this._onContextLost)
    this._onContextLost = null
    this.sceneCache.destroyAll()
    if (this.credits) this.credits.destroy()
    if (this.sky) this.sky.destroy()
    if (this.sceneLayer) this.sceneLayer.filters = []
    if (this.screenBloom) {
      this.screenBloom.destroy()
      this.screenBloom = null
    }
    if (this.overlayLayer) Bloom.destroyPixiContainerChildren(this.overlayLayer)
    // 粒子纹理由运行时持有，场景与片尾卡都已销毁，这里最后释放。
    if (this.textures) this.textures.destroy()
    var retired = this.retiredTextures.splice(0)
    for (var i = 0; i < retired.length; i += 1) retired[i].destroy()
    // app.init 失败时 renderer 还不存在：destroy 会抛，包住（销毁语义已完成，资源本来就没能建出来）。
    try {
      this.app.destroy({ removeView: true }, { children: true })
    } catch (e) { /* 初始化就失败的 app 没有可销毁的 renderer */ }
  }

  window.FoliaHanabiRuntime = {
    HanabiRuntime: HanabiRuntime,
    resolveRenderResolution: resolveRenderResolution,
    REBUILD_DEBOUNCE_MS: REBUILD_DEBOUNCE_MS,
    DARK_SKY: DARK_SKY,
    NIGHT_BACKGROUND: NIGHT_BACKGROUND
  }
})()
