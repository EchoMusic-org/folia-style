// 町景的运行时（移植自 createMachiRuntime.ts，MachiRuntime 类）：
// 一个 WebGL 上下文，建一次；换歌、换主题、换设置、暂停都就地推给它。
// 引擎管渲染器、镜头、天光、天气、湿地面、倒影、后处理、时钟、编排（牌面、副歌、闪烁、闪电、音频）和环境
// （时间与天气：设置 → 目标，按真实时间渐变过去，天空、天光、人造光、雨雪、路面干湿、积雪、bloom 都跟着它）；
// 场景（scene-*.js）管自己的几何、灯、招牌和会动的东西。换场景只拆旧场景、建新场景，上下文和后处理留着。
// 插件差异（对齐先例）：驱动循环由 bridge 的主 tick 带动（模式入口每帧 renderFrame），不自持 rAF；
// programWarmup / 自动降级上报 / shownScene 上报 / 调试钩子不移植；智能动感数据来自共享 FoliaBeatFx。
(function () {
  'use strict'

  var THREE = window.THREE
  var Types = window.FoliaMachiTypes
  var CameraMod = window.FoliaMachiCamera
  var ClockMod = window.FoliaMachiClock
  var Director = window.FoliaMachiDirector
  var Environment = window.FoliaMachiEnvironment
  var GroundMod = window.FoliaMachiGround
  var PostMod = window.FoliaMachiPost
  var LensMod = window.FoliaMachiLens
  var ReflectionMod = window.FoliaMachiReflection
  var WeatherMod = window.FoliaMachiWeather
  var MaterialsMod = window.FoliaMachiMaterials
  var PaletteMod = window.FoliaMachiPalette
  var SkyMod = window.FoliaMachiSky
  var SkyLightsMod = window.FoliaMachiSkyLights
  var ShadersMod = window.FoliaMachiShaders
  var QualityMod = window.FoliaMachiQuality
  var BeatFx = window.FoliaMachiBeatFx
  var Scenes = window.FoliaMachiScenes

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

  /** 主题的动效强度 → 雨量、闪烁这些氛围动效的倍数。 */
  var INTENSITY_SCALE = { calm: 0.7, normal: 1, chaotic: 1.3 }
  /** 每个窗口有车开过的概率，按主题的动效强度。 */
  var TRAFFIC_CHANCE = { calm: 0.4, normal: 0.6, chaotic: 0.78 }

  var DEGRADE_WINDOW_MS = 2500
  var DEGRADE_SETTLE_MS = 10000

  /** 换主题时重画招牌的防抖（调色时主题一直在变）。 */
  var SIGN_REPAINT_DEBOUNCE_MS = 150
  /** 提前多久把下一行画好。 */
  var PREHEAT_LEAD_SECONDS = 2.5
  var DEG = Math.PI / 180
  /** 时间“自动”时多久看一次钟。 */
  var CLOCK_CHECK_MS = 30000
  /** 换场景的淡出、淡入（秒）。 */
  var SCENE_FADE_OUT = 0.18
  var SCENE_FADE_IN = 0.32

  var WHITE = new THREE.Color(1, 1, 1)

  /** 画质设置的指纹：设置面板每次给的是新对象，按内容比。 */
  function qualityKey(quality) {
    return [quality.renderScale, quality.antialias, quality.shadows, quality.reflections, quality.glow, quality.adaptive].join('|')
  }

  /**
   * options: { host, song, theme, tuning, currentTime, audioPower, paused, staticMode, showText,
   *            previewMode, transparent, onViewChange, onContextLost, renderScale? }
   */
  function MachiRuntime(options) {
    this.options = options
    this.paused = options.paused
    this.staticMode = options.staticMode
    this.showText = options.showText
    this.song = options.song
    this.theme = options.theme
    this.tuning = Types.normalizeMachiTuning(options.tuning)
    this.themeSignature = themeKey(options.theme)
    this.renderQuality = this.resolveQuality(0)
    this.pixelRatio = this.renderQuality.pixelRatio
    this.disposed = false
    this.holding = true
    this.scene = new THREE.Scene()
    this.camera = new CameraMod.MachiCamera()
    this.clock = new ClockMod()
    this.sky = new SkyMod.MachiSky()
    this.environmentDirty = true
    this.fade = 1
    this.fadePhase = 'idle'
    this.pendingScene = null
    this.songChangedWhileBuilding = false
    this.stage = null
    this.stageContext = null
    this.stageId = null
    this.weather = null
    this.lightningTimes = []
    this.degrade = 0
    this.qualityCheckedAt = 0
    this.degradeState = QualityMod.createMachiDegradeState()
    this.degradeScreen = ''
    this.settleUntil = NaN
    this.size = { width: 1, height: 1 }
    this.audio = new Director.MachiAudioFollower()
    this.boardTarget = null
    this.chorus = 0
    this.signRepaintTimer = 0
    this.clockTimer = 0
    this.wantsFrame = true
    this.frameTimes = []
    this.lastFrameAt = 0
    this.beat = BeatFx.createMachiBeatFrame()
    this.kickRings = new Float32Array(BeatFx.MACHI_BEAT.ripple.max * 2)
    this.atmosphere = {
      time: 0,
      mistColor: new THREE.Color(),
      mistAmount: 0.2,
      cloudColor: new THREE.Color(),
      cloudAmount: 1,
      stars: 0,
      haze: 0,
      lightning: 0,
      glowA: new THREE.Vector4(),
      glowColorA: new THREE.Color(),
      glowB: new THREE.Vector4(),
      glowColorB: new THREE.Color(),
      wind: new THREE.Vector2()
    }
    this._scratchColor = new THREE.Color()
    this._scratchColorB = new THREE.Color()
    // 每帧由模式入口注入的输入值（原版 MotionValue）。
    this._inputTime = options.currentTime || 0
    this._inputPower = options.audioPower || 0

    // 抗锯齿交给后处理（场景目标的 MSAA、最后的 FXAA、超采样），画布本身不开。透明模式下画布带 alpha（预乘）。
    this.renderer = new THREE.WebGLRenderer({ antialias: false, alpha: Boolean(options.transparent), powerPreference: 'high-performance', stencil: false })
    this.renderer.setPixelRatio(this.pixelRatio)
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.toneMapping = THREE.NeutralToneMapping
    this.renderer.toneMappingExposure = 1.0
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFShadowMap
    this.renderer.shadowMap.autoUpdate = false
    this.renderer.info.autoReset = false
    var canvas = this.renderer.domElement
    canvas.style.position = 'absolute'
    canvas.style.inset = '0'
    canvas.style.width = '100%'
    canvas.style.height = '100%'
    canvas.style.display = 'block'
    // 第一帧画好之前不露出来（起步分几段做，没画过的画布是一块黑）。
    canvas.style.visibility = 'hidden'
    var self = this
    canvas.addEventListener('webglcontextlost', function (event) {
      event.preventDefault()
      self.stopLoop()
      if (self.options.onContextLost) self.options.onContextLost()
    })
    options.host.appendChild(canvas)

    var sceneId = Types.resolveMachiSceneId(this.tuning, this.song.seed)
    this.blend = new MaterialsMod.MachiColorBlend(PaletteMod.resolveMachiPalette(this.theme, this.song.seed, Scenes[sceneId].resolveArt))
    this.materials = new MaterialsMod.MachiMaterials(this.blend, ShadersMod.createMachiSnowUniforms())
    this.snow = this.materials._snow
    this.lightningTimes = Director.buildMachiLightningTimes(this.song.lines)
    this.environmentTarget = this.resolveEnvironmentTarget()
    this.environment = Environment.createMachiEnvironmentState(this.environmentTarget)
    this.look = Environment.resolveMachiEnvironmentLook(this.environment)
    this.ground = new GroundMod(this.materials, this.blend, this.snow)
    var quality = this.renderQuality
    this.skyLights = new SkyLightsMod(this.blend, quality.shadowMapSize)
    this.scene.add(this.skyLights.group)
    this.reflection = new ReflectionMod.MachiReflection(0.06, quality.reflectionScale || 0.3)
    this.ground.uniforms.uReflection.value = this.reflection.target.texture
    this.ground.setReflections(quality.reflectionScale > 0)
    this.post = new PostMod.MachiPost(this.renderer, this.scene, this.camera.camera, quality, Boolean(options.transparent))
    this.scene.background = options.transparent ? null : this.sky.texture
    this.camera.onCommit = function (view) {
      if (self.options.onViewChange) self.options.onViewChange(view, self.stageId)
    }
    this.camera.onWake = function () { self.wake() }
    this.camera.setMotion(this.tuning.motion, this.tuning.motionSpeed)
    this.resizeObserver = new ResizeObserver(function (entries) {
      var entry = entries[0]
      if (!entry) return
      self.resize(entry.contentRect.width, entry.contentRect.height)
      self.wake()
    })
    this.resizeObserver.observe(options.host)
    this.resize(options.host.clientWidth || 1, options.host.clientHeight || 1)
    this.clock.paused = this.paused || this.staticMode
  }

  /** 建场景（或换场景：先拆旧的）：几何、灯、招牌进场景树，湿地面、天气、镜头取景、倒影平面跟着换。 */
  MachiRuntime.prototype.buildStage = function (id) {
    if (this.stage) {
      this.stage.dispose()
      this.weather.group.removeFromParent()
      this.weather.dispose()
    }
    var definition = Scenes[id]
    var palette = PaletteMod.resolveMachiPalette(this.theme, this.song.seed, definition.resolveArt)
    this.blend.setTarget(palette, !this.stage || this.staticMode)
    this.stageId = id
    // 新场景按此刻的歌建：建好以前再换的歌由 switchScene 补上。
    this.songChangedWhileBuilding = false
    var self = this
    this.stageContext = {
      materials: new MaterialsMod.MachiMaterials(this.blend, this.snow, id),
      blend: this.blend,
      geometryCache: new Map(),
      song: this.song,
      previewMode: this.options.previewMode,
      invalidateShadows: function () { self.skyLights.invalidateShadows() }
    }
    var stage = definition.create(this.stageContext)
    this.stage = stage
    stage.surfaces.road.forEach(function (surface) { surface.material = self.ground.asphalt })
    stage.surfaces.lot.forEach(function (surface) { surface.material = self.ground.concrete })
    this.ground.uniforms.uPuddleOffset.value.set(stage.puddles.offset[0], stage.puddles.offset[1])
    this.ground.uniforms.uPuddleAmount.value = stage.puddles.amount
    this.scene.add(stage.root)
    this.weather = new WeatherMod(
      this.stageContext.materials,
      this.blend,
      stage.weather,
      this.options.previewMode ? { rain: 800, splash: 160, snow: 500 } : { rain: 2000, splash: 560, snow: 1400 }
    )
    this.scene.add(this.weather.group)
    ShadersMod.setMachiSnowRoofs(this.snow, stage.weather.roofs)
    this.atmosphere.wind.set(Math.sin(stage.weather.windYaw), Math.cos(stage.weather.windYaw)).multiplyScalar(0.06)
    this.reflection.planeY = stage.reflectionPlaneY
    this.camera.setFraming(stage.framing, this.customView(id))
  }

  /** 新场景画上招牌（歌、主题、调色板、字体、图标），颜色同步一次。 */
  MachiRuntime.prototype.fillStage = function () {
    this.stage.setContent(this.sceneContent())
    this.boardTarget = null
    this.environmentDirty = true
    this.syncColors()
    this.skyLights.invalidateShadows()
    this.wantsFrame = true
  }

  MachiRuntime.prototype.loadScene = function (id) {
    this.buildStage(id)
    this.fillStage()
    return true
  }

  /** 招牌要的东西：歌、主题、调色板、字体、图标。 */
  MachiRuntime.prototype.sceneContent = function (palette) {
    palette = palette || PaletteMod.resolveMachiPalette(this.theme, this.song.seed, Scenes[this.stageId].resolveArt)
    return {
      song: this.song,
      theme: this.theme,
      palette: palette,
      font: { stack: this.themeFontStack(), weight: this.themeFontWeight() },
      icons: (this.theme.lyricsIcons || []).slice(),
      fallbacks: ['Store', 'Umbrella', 'CloudRain', 'Moon', 'Sun', 'Music', 'Flower', 'CupSoda', 'Coffee']
    }
  }

  /** 字体栈与字重：跟随宿主主题（foliaGetLyricFontWeight 提供全局字重覆盖）。 */
  MachiRuntime.prototype.themeFontStack = function () {
    var stack = []
    if (this.theme.fontFamilyStack && this.theme.fontFamilyStack.length) stack = stack.concat(this.theme.fontFamilyStack)
    if (this.theme.fontFamily) stack.push(this.theme.fontFamily)
    if (this.theme.fontStyle === 'serif') stack.push('serif')
    else if (this.theme.fontStyle === 'mono') stack.push('monospace')
    else stack.push('sans-serif')
    if (typeof window.foliaBridgeFontStack === 'function') {
      var host = window.foliaBridgeFontStack(this.theme)
      if (host) return host
    }
    return stack.join(', ')
  }

  MachiRuntime.prototype.themeFontWeight = function (fallback) {
    if (typeof window.foliaGetLyricFontWeight === 'function') return window.foliaGetLyricFontWeight(fallback || 700)
    return this.theme.fontWeight || fallback || 700
  }

  /** 场景和着色器都好了：接上拖拽和时钟，画第一帧。 */
  MachiRuntime.prototype.start = function () {
    this.holding = false
    if (!this.options.previewMode) this.camera.attach(this.renderer.domElement)
    var self = this
    this.clockTimer = window.setInterval(function () { self.onClockCheck() }, CLOCK_CHECK_MS)
    // 第一帧画好：画布露出来。
    this.renderFrame(performance.now())
    this.renderer.domElement.style.visibility = ''
    this.wake()
  }

  /** 某个场景的自定义视角；默认视角时是 null。 */
  MachiRuntime.prototype.customView = function (id) {
    return this.tuning.camera === 'custom' ? this.tuning.views[id] : null
  }

  /** 正在画的场景，或淡出后马上要换上的场景。 */
  Object.defineProperty(MachiRuntime.prototype, 'targetSceneId', {
    get: function () { return this.pendingScene || this.stageId }
  })

  MachiRuntime.prototype.resize = function (width, height) {
    var w = Math.max(1, Math.round(width))
    var h = Math.max(1, Math.round(height))
    this.size = { width: w, height: h }
    this.renderer.setSize(w, h, false)
    this.camera.setAspect(w, h)
    this.post.setSize()
    this.reflection.setSize(w * this.pixelRatio, h * this.pixelRatio)
    this.wantsFrame = true
  }

  /** 画质设置 + 自动降级的格数 → 实际用的渲染参数。 */
  MachiRuntime.prototype.resolveQuality = function (degrade) {
    return QualityMod.resolveMachiRenderQuality(this.tuning.quality, {
      degrade: degrade === undefined ? this.degrade : degrade,
      devicePixelRatio: window.devicePixelRatio || 1,
      previewMode: this.options.previewMode,
      global: QualityMod.DEFAULT_GLOBAL_QUALITY
    })
  }

  /** 把画质用上：DPR、倒影、阴影、后处理。改设置与自动降级都走这里。 */
  MachiRuntime.prototype.applyQuality = function () {
    var quality = this.resolveQuality()
    this.renderQuality = quality
    this.pixelRatio = quality.pixelRatio
    this.renderer.setPixelRatio(quality.pixelRatio)
    if (quality.reflectionScale > 0) {
      this.reflection.setScale(quality.reflectionScale, this.size.width * quality.pixelRatio, this.size.height * quality.pixelRatio)
    }
    this.ground.setReflections(quality.reflectionScale > 0)
    this.skyLights.setShadowMapSize(quality.shadowMapSize)
    this.post.setQuality(quality)
    this.resize(this.size.width, this.size.height)
    this.frameTimes.length = 0
    this.degradeState.slowChecks = 0
    this.settleUntil = performance.now() + DEGRADE_SETTLE_MS
    this.wake()
  }

  /** 帧时一直偏高就在用户那套画质之下再压一格，只降不升；自动降级关着时不管。 */
  MachiRuntime.prototype.adaptQuality = function (now) {
    if (this.options.previewMode || !this.tuning.quality.adaptive) return
    // 刚起来或刚换画质（热身）、暂停：这段的帧不算，攒的也清掉。
    if (Number.isNaN(this.settleUntil)) this.settleUntil = now + DEGRADE_SETTLE_MS
    if (now < this.settleUntil || this.clock.paused || document.visibilityState !== 'visible') {
      this.frameTimes.length = 0
      if (this.degradeState.slowChecks !== 0) this.degradeState.slowChecks = 0
      this.qualityCheckedAt = now
      return
    }
    if (now - this.qualityCheckedAt < DEGRADE_WINDOW_MS || this.frameTimes.length < 60) return
    this.qualityCheckedAt = now
    var screenKey = screen.width + 'x' + screen.height + '@' + (window.devicePixelRatio || 1)
    if (screenKey !== this.degradeScreen) {
      var changed = this.degradeScreen !== ''
      this.degradeScreen = screenKey
      this.degradeState = QualityMod.createMachiDegradeState()
      // 中途换了屏：这一段前后两种间隔混着，丢掉从现在起重新攒。
      if (changed) {
        this.frameTimes.length = 0
        return
      }
    }
    var result = QualityMod.stepMachiDegrade(this.degradeState, this.frameTimes)
    this.degradeState = result.state
    if (!result.degrade) return
    // 已经压到底：再要一格也压不下去了。
    if (this.resolveQuality(this.degrade + 1).degrade <= this.renderQuality.degrade) return
    this.degrade += 1
    this.applyQuality()
  }

  /**
   * 天空、天光、月光 / 太阳的颜色按环境推：夜、黄昏、白天三套之间插值（换时间时经过黄昏），
   * 阴天往灰里拉，积雪时地面反上来的光更亮。结果盖在调色板的同名键上。
   */
  MachiRuntime.prototype.applyEnvironmentColors = function () {
    var daylight = this.environment.daylight
    var snowCover = this.environment.snowCover
    var overcast = this.look.overcast
    var color = this._scratchColor
    var other = this._scratchColorB
    var dusk = Environment.MACHI_DAYLIGHT.dusk
    var blend = this.blend
    var self = this
    ;['skyTop', 'skyBottom', 'hemiSky', 'hemiGround', 'moon'].forEach(function (key) {
      if (daylight <= dusk) color.copy(blend.raw(key)).lerp(blend.raw(key + 'Dusk'), daylight / dusk)
      else color.copy(blend.raw(key + 'Dusk')).lerp(blend.raw(key + 'Day'), (daylight - dusk) / (1 - dusk))
      // 阴天：去饱和、白天略提亮（一片灰白的天），夜里压暗一点。
      var luminance = color.r * 0.2126 + color.g * 0.7152 + color.b * 0.0722
      other.setRGB(luminance, luminance, luminance).multiplyScalar(key === 'moon' ? 1 : 0.9 + 0.35 * daylight)
      color.lerp(other, overcast * (key === 'moon' ? 0.45 : 0.7))
      if (key === 'hemiGround') color.lerp(other.setRGB(0.55, 0.6, 0.7).multiplyScalar(0.35 + 0.65 * daylight), snowCover * 0.5)
      blend.setDerived(key, color)
      void self
    })
  }

  /** 插值后的颜色写回材质、灯、天空、场景。 */
  MachiRuntime.prototype.syncColors = function () {
    this.applyEnvironmentColors()
    this.materials.syncColors()
    this.skyLights.sync()
    this.sky.paint(this.blend.get('skyTop'), this.blend.get('skyBottom'))
    this.ground.syncColors()
    this.weather.syncColors()
    this.stage.syncColors()
  }

  MachiRuntime.prototype.wake = function () {
    if (this.disposed || this.holding || this.fadePhase === 'building') return
    this.clock.resync()
  }

  MachiRuntime.prototype.stopLoop = function () { /* 驱动循环由 bridge tick 带动，无自持 rAF */ }

  /** 推进一帧并画出来（模式入口每帧调；now 是 performance.now()）。 */
  MachiRuntime.prototype.renderFrame = function (now) {
    if (this.disposed || this.holding || this.fadePhase === 'building') return
    this.clock.tick(now)
    this.wantsFrame = false
    if (this.lastFrameAt > 0) {
      var interval = now - this.lastFrameAt
      if (interval > 0 && interval < 100) {
        this.frameTimes.push(interval)
        if (this.frameTimes.length > 120) this.frameTimes.shift()
      }
    }
    this.lastFrameAt = now

    this.stepFade(this.clock.realDelta)
    this.camera.update(this.clock.realDelta, this.clock.delta)
    this.stepEnvironment(this.clock.realDelta)
    if (this.blend.step(this.clock.realDelta) || this.environmentDirty) {
      this.environmentDirty = false
      this.syncColors()
      this.wantsFrame = true
    }
    this.direct()

    this.renderer.info.reset()
    if (this.skyLights.moon.shadow.needsUpdate) this.renderer.shadowMap.needsUpdate = true
    var camera = this.camera.camera
    // 干的路面不映倒影、画质里关了倒影：都省掉倒影那一遍。
    if (this.environment.wetness > 0.02 && this.renderQuality.reflectionScale > 0) {
      this.reflection.render(this.renderer, this.scene, camera)
      this.ground.uniforms.uReflectMatrix.value.copy(this.reflection.textureMatrix)
    }
    var pixelWorldSize = (camera.top - camera.bottom) / camera.zoom / Math.max(1, this.size.height * this.pixelRatio)
    // 景深按相对默认构图的缩放走；光圈按 f/8 换算（resolveMachiLens）。
    var zoom = camera.zoom / this.camera.defaultView.zoom
    var lens = LensMod.resolveMachiLens(this.tuning, zoom)
    this.post.render(pixelWorldSize, this.camera.focusDistance, this.atmosphere, Object.assign({}, lens, {
      focus: this.focusDepth(),
      aberration: 0.014,
      vignette: 0.55,
      grain: 0.032,
      fade: this.fade
    }))
    this.adaptQuality(now)
    this.camera.rendered()
  }

  /** 设置 + 歌（自动天气按 seed）+ 本地时钟（自动时间）→ 环境目标。 */
  MachiRuntime.prototype.resolveEnvironmentTarget = function () {
    return Environment.resolveMachiEnvironmentTarget(
      Environment.resolveMachiDaylight(this.tuning.timeOfDay, new Date()),
      Environment.resolveMachiWeatherKind(this.tuning.weather, this.song.seed)
    )
  }

  /** 目标变了（设置、换歌、钟走到了黄昏）：静态模式直接跳过去，否则渐变。 */
  MachiRuntime.prototype.refreshEnvironmentTarget = function (immediate) {
    immediate = immediate === undefined ? this.staticMode : immediate
    this.environmentTarget = this.resolveEnvironmentTarget()
    if (immediate) {
      this.environment = Environment.createMachiEnvironmentState(this.environmentTarget)
      this.look = Environment.resolveMachiEnvironmentLook(this.environment)
      this.skyLights.invalidateShadows()
    }
    this.environmentDirty = true
    this.wantsFrame = true
    this.wake()
  }

  MachiRuntime.prototype.onClockCheck = function () {
    if (this.tuning.timeOfDay !== 'auto' || this.disposed) return
    var daylight = Environment.resolveMachiDaylight('auto', new Date())
    if (Math.abs(daylight - this.environmentTarget.daylight) > 0.001) this.refreshEnvironmentTarget()
  }

  /** 环境按真实时间追目标（暂停时也走完，设置改了能看到结果）；没在变就什么都不做。 */
  MachiRuntime.prototype.stepEnvironment = function (delta) {
    var next = Environment.stepMachiEnvironment(this.environment, this.environmentTarget, Math.min(delta, 0.1))
    if (Environment.sameMachiEnvironment(next, this.environment)) return
    this.environment = next
    this.look = Environment.resolveMachiEnvironmentLook(next)
    this.environmentDirty = true
    // 太阳停下来了：按最终的方向补一次阴影。
    if (next.daylight === this.environmentTarget.daylight) this.skyLights.settleShadows()
  }

  /** 环境还在渐变：暂停时也要继续出帧。 */
  MachiRuntime.prototype.environmentMoving = function () {
    var target = this.environmentTarget
    var state = this.environment
    return state.daylight !== target.daylight || state.rain !== target.rain || state.snow !== target.snow || state.fog !== target.fog
      || state.wetness !== Math.max(target.rain, target.fog * 0.35) || state.snowCover !== target.snow
  }

  /** 推进淡出淡入（真实时间，暂停时也走完）；淡到黑时建新场景。 */
  MachiRuntime.prototype.stepFade = function (delta) {
    var step = Math.min(delta, 1 / 30)
    if (this.fadePhase === 'out') {
      this.fade = Math.max(0, this.fade - step / SCENE_FADE_OUT)
      if (this.fade === 0) {
        if (this.pendingScene) {
          // 同步拆旧建新（插件无 programWarmup，直接换）。
          var pending = this.pendingScene
          this.pendingScene = null
          this.loadScene(pending)
          this.switchSceneAftermath()
        } else {
          this.fadePhase = 'in'
        }
      }
    } else if (this.fadePhase === 'in') {
      this.fade = Math.min(1, this.fade + step / SCENE_FADE_IN)
      if (this.fade === 1) this.fadePhase = 'idle'
    }
  }

  /** 黑场里建完场景：补换歌、淡入。 */
  MachiRuntime.prototype.switchSceneAftermath = function () {
    // 黑场里又换了歌（场景没变）：新场景是按换歌之前的歌建的，补一次。
    if (this.songChangedWhileBuilding) {
      this.songChangedWhileBuilding = false
      var palette = PaletteMod.resolveMachiPalette(this.theme, this.song.seed, Scenes[this.stageId].resolveArt)
      this.blend.setTarget(palette, this.staticMode)
      this.stage.swapSong(this.song, this.sceneContent(palette))
      this.boardTarget = null
    }
    this.fadePhase = 'in'
    this.wantsFrame = true
    this.wake()
  }

  MachiRuntime.prototype.requestScene = function (id, immediate) {
    immediate = immediate === undefined ? this.options.previewMode : immediate
    if (immediate && this.fadePhase !== 'building') {
      this.pendingScene = null
      this.fadePhase = 'idle'
      this.fade = 1
      this.buildStage(id)
      this.fillStage()
      return
    }
    this.pendingScene = id
    if (this.fadePhase === 'building' || this.fadePhase === 'out') return
    this.fadePhase = 'out'
    this.wantsFrame = true
    this.wake()
  }

  /** 按歌曲时间决定牌面、副歌、闪电；按氛围时钟决定闪烁；音频包络平滑；场景推一步。 */
  MachiRuntime.prototype.direct = function () {
    var songTime = this._inputTime
    var beat = this.stepBeat(songTime)
    var lines = this.song.lines
    var target = this.showText ? Director.resolveMachiBoardTarget(lines, songTime) : { kind: 'card' }
    var targetChanged = !Director.sameBoardTarget(this.boardTarget, target)
    var preheat = null
    if (targetChanged) {
      this.boardTarget = target
      this.wantsFrame = true
    } else if (target.kind === 'line' && !this.clock.paused) {
      var next = lines[target.index + 1]
      if (next && next.startTime - songTime < PREHEAT_LEAD_SECONDS) preheat = { kind: 'line', index: target.index + 1 }
    }
    var chorusTarget = Director.resolveMachiChorus(lines, target)
    this.chorus += (chorusTarget - this.chorus) * (1 - Math.exp(-this.clock.delta * 2.5))
    if (this.staticMode) this.chorus = chorusTarget
    var audio = this.clock.paused ? this.audio.step(0, 0) : this.audio.step(this._inputPower, this.clock.delta)
    var flicker = this.staticMode ? 1 : Director.resolveMachiFlicker(this.clock.elapsed, this.song.seed)
    var intensity = INTENSITY_SCALE[this.theme.animationIntensity] || 1
    var environment = this.environment
    var look = this.look
    var rain = environment.rain * (0.62 + 0.22 * audio + 0.12 * this.chorus) * intensity
    var camera = this.camera.camera
    var pixelsPerUnit = (this.size.height * this.pixelRatio) / ((camera.top - camera.bottom) / camera.zoom)
    this.weather.update({
      time: this.clock.elapsed,
      rain: rain,
      snow: environment.snow * (0.75 + 0.25 * intensity),
      wetness: environment.wetness,
      glint: 1 - 0.9 * environment.daylight,
      pixelsPerUnit: pixelsPerUnit
    })
    // 闪电只在下雨时有。
    var lightning = this.staticMode || environment.rain < 0.5 ? 0 : Director.resolveMachiLightning(this.lightningTimes, songTime) * environment.rain
    this.skyLights.update({ daylight: environment.daylight, sunIntensity: look.sunIntensity, hemiIntensity: look.hemiIntensity, flash: lightning })
    this.post.setGlow(look.bloom * beat.bloom, look.streaks)
    var atmosphere = this.atmosphere
    atmosphere.lightning = lightning
    atmosphere.time = this.clock.elapsed
    var skyBottom = this.blend.get('skyBottom')
    atmosphere.mistColor.copy(skyBottom).multiplyScalar(1.35 - 0.4 * environment.daylight)
    atmosphere.mistAmount = look.mist + 0.06 * Math.min(1, rain)
    // 云：夜里是天色里带一点月光，白天是偏白的云，阴天更灰。
    this._scratchColor.copy(skyBottom).lerp(this.blend.get('moon'), 0.25).multiplyScalar(0.7)
    this._scratchColorB.copy(skyBottom).lerp(WHITE, 0.55 - 0.25 * look.overcast).multiplyScalar(0.55)
    atmosphere.cloudColor.copy(this._scratchColor).lerp(this._scratchColorB, environment.daylight)
    atmosphere.cloudAmount = look.clouds
    atmosphere.stars = look.stars
    atmosphere.haze = look.haze
    this.ground.uniforms.uTime.value = this.clock.elapsed
    this.ground.uniforms.uRain.value = environment.rain > 0.02 ? Math.min(1, 0.45 + 0.5 * rain) : 0
    this.ground.uniforms.uWet.value = environment.wetness
    this.snow.uMachiSnow.value = environment.snowCover
    this.snow.uMachiWet.value = environment.wetness
    this.snow.uMachiViewUp.value.set(0, 1, 0).transformDirection(camera.matrixWorldInverse)
    this.stage.direct({
      songTime: songTime,
      ambientTime: this.clock.elapsed,
      delta: this.clock.delta,
      staticMode: this.staticMode,
      immediate: this.staticMode || this.clock.paused,
      showText: this.showText,
      seed: this.song.seed,
      lines: lines,
      target: target,
      targetChanged: targetChanged,
      preheat: preheat,
      chorus: this.chorus,
      audio: audio,
      flicker: flicker,
      rain: rain,
      trafficChance: TRAFFIC_CHANCE[this.theme.animationIntensity] || 0.6,
      environment: environment,
      look: look,
      pixelsPerUnit: pixelsPerUnit,
      atmosphere: atmosphere,
      beat: beat
    })
  }

  /**
   * 智能动感模式：霓虹随拍读整张节拍表、鼓点效果读这首歌的鼓点，都按听到的时间取；涟漪交给地面。
   * 没开智能动感模式时，开着「模拟节拍」就让霓虹随拍和大屏闪拍按氛围时钟上的固定节拍走。
   */
  MachiRuntime.prototype.stepBeat = function (songTime) {
    var beat = BeatFx.resetMachiBeatFrame(this.beat)
    var fx = window.FoliaBeatFx
    var idle = this.clock.paused
    var focus = this.stage.focusPoint
    var smartActive = fx ? fx.smartBeatActive() : false
    if (!smartActive) {
      // 没开智能动感：没有鼓点，涟漪清空；开着模拟节拍时霓虹、大屏按固定节拍走。
      BeatFx.resolveMachiDrumRipples(null, 0, 0, this.kickRings)
      this.ground.setKicks(focus.x, focus.z, this.kickRings)
      if (idle || !this.tuning.simulatedBeat) return beat
      BeatFx.resolveMachiSteadyNeonPulse(this.clock.elapsed, 1, beat)
      BeatFx.resolveMachiSteadyScreenFlash(this.clock.elapsed, 1, beat)
      return beat
    }
    var neonStrength = idle ? 0 : (fx ? fx.getEffectStrength('machi.neonPulse') : 0)
    var rippleStrength = idle ? 0 : (fx ? fx.getEffectStrength('machi.drumRipple') : 0)
    var flashStrength = idle ? 0 : (fx ? fx.getEffectStrength('machi.screenFlash') : 0)
    var heard = fx ? fx.getHeard() : { time: songTime }
    var time = heard.time !== undefined && heard.time !== null ? heard.time : songTime
    if (neonStrength > 0 && (!fx || fx.isReady())) {
      BeatFx.resolveMachiNeonPulse(fx ? fx.getEvents() : [], time, neonStrength, fx ? fx.getTrackScale() : 1, beat)
    }
    var hits = null
    if (rippleStrength > 0 || flashStrength > 0) {
      hits = fx ? BeatFx.machiDrumHitsAt(fx.getDrumHits(), time) : null
    }
    // 光斑的一跳只在干的地面上（湿的地面上是涟漪）。
    beat.thump = BeatFx.resolveMachiDrumRipples(hits, time, rippleStrength, this.kickRings) * (1 - BeatFx.machiRippleWetness(this.environment.wetness))
    BeatFx.resolveMachiScreenFlash(hits, time, flashStrength, beat)
    this.ground.setKicks(focus.x, focus.z, this.kickRings)
    return beat
  }

  /** 主题 / 歌换了：按目标调色板、字体、图标重画招牌。 */
  MachiRuntime.prototype.repaintSigns = function () {
    window.clearTimeout(this.signRepaintTimer)
    this.signRepaintTimer = 0
    this.stage.setContent(this.sceneContent())
    this.boardTarget = null
    this.wantsFrame = true
  }

  /** 换歌：seed/lines 由模式入口按已提交歌曲调。 */
  MachiRuntime.prototype.swapSong = function (song) {
    var seedChanged = song.seed !== this.song.seed
    this.song = song
    this.lightningTimes = Director.buildMachiLightningTimes(song.lines)
    // 天气“自动”按歌选：换歌可能换天气（渐变过去）。
    this.refreshEnvironmentTarget()
    var sceneId = Types.resolveMachiSceneId(this.tuning, song.seed)
    if (sceneId !== this.targetSceneId || (seedChanged && this.stage.rebuildsForSeed)) {
      this.requestScene(sceneId)
    } else if (this.fadePhase === 'building') {
      this.songChangedWhileBuilding = true
    } else if (!this.pendingScene) {
      var palette = PaletteMod.resolveMachiPalette(this.theme, song.seed, Scenes[sceneId].resolveArt)
      this.blend.setTarget(palette, this.staticMode)
      this.stage.swapSong(song, this.sceneContent(palette))
      this.boardTarget = null
    }
    this.wantsFrame = true
    this.wake()
  }

  MachiRuntime.prototype.setTheme = function (theme) {
    var signature = themeKey(theme)
    this.theme = theme
    if (signature === this.themeSignature) return
    this.themeSignature = signature
    this.blend.setTarget(PaletteMod.resolveMachiPalette(theme, this.song.seed, Scenes[this.stageId].resolveArt), this.staticMode)
    if (this.staticMode) this.syncColors()
    var self = this
    window.clearTimeout(this.signRepaintTimer)
    this.signRepaintTimer = window.setTimeout(function () {
      if (self.disposed) return
      self.repaintSigns()
      self.wake()
    }, SIGN_REPAINT_DEBOUNCE_MS)
    this.wake()
  }

  /** 对焦深度（离镜头的距离）：画面中心、歌词屏，或画面中心往前往后挪。 */
  MachiRuntime.prototype.focusDepth = function () {
    var tuning = this.tuning
    if (tuning.focus === 'lyrics') return this.camera.depthOf(this.stage.focusPoint)
    var center = this.camera.focusDistance
    return tuning.focus === 'manual' ? center + tuning.focusOffset : center
  }

  /** 设置变了：场景不同就换场景；时间、天气渐变到新目标；镜头换视角、开关运镜。 */
  MachiRuntime.prototype.setTuning = function (tuning) {
    var previous = this.tuning
    if (previous === tuning) return
    this.tuning = Types.normalizeMachiTuning(tuning)
    if (previous.scene !== this.tuning.scene) {
      var sceneId = Types.resolveMachiSceneId(this.tuning, this.song.seed)
      if (sceneId !== this.targetSceneId) this.requestScene(sceneId)
    }
    if (previous.timeOfDay !== this.tuning.timeOfDay || previous.weather !== this.tuning.weather) this.refreshEnvironmentTarget()
    this.camera.setCustom(this.customView(this.stageId))
    this.camera.setMotion(this.tuning.motion, this.tuning.motionSpeed)
    if (qualityKey(previous.quality) !== qualityKey(this.tuning.quality)) {
      // 换了画质设置：自动降级从这套设置重新开始。
      this.degrade = 0
      this.degradeState.degradedAverage = 0
      this.applyQuality()
    }
    this.wantsFrame = true
    this.wake()
  }

  MachiRuntime.prototype.setPaused = function (paused) {
    this.paused = paused
    this.clock.paused = this.paused || this.staticMode
    this.wake()
  }

  MachiRuntime.prototype.setStaticMode = function (staticMode) {
    this.staticMode = staticMode
    if (staticMode) this.refreshEnvironmentTarget(true)
    this.clock.paused = this.paused || this.staticMode
    this.wake()
  }

  MachiRuntime.prototype.setShowText = function (showText) {
    if (this.showText === showText) return
    this.showText = showText
    this.boardTarget = null
    this.wantsFrame = true
    this.wake()
  }

  /** 每帧由模式入口注入歌曲时间与音频包络（原版 MotionValue）。 */
  MachiRuntime.prototype.setInput = function (currentTime, audioPower) {
    this._inputTime = currentTime
    this._inputPower = audioPower
  }

  /** 画布尺寸变化后由入口触发（ResizeObserver 已挂在 host 上，这里兜底）。 */
  MachiRuntime.prototype.notifyResize = function () {
    var host = this.options.host
    this.resize(host.clientWidth || 1, host.clientHeight || 1)
    this.wake()
  }

  MachiRuntime.prototype.destroy = function () {
    if (this.disposed) return
    this.disposed = true
    this.stopLoop()
    window.clearTimeout(this.signRepaintTimer)
    window.clearInterval(this.clockTimer)
    this.resizeObserver.disconnect()
    this.camera.dispose()
    var canvas = this.renderer.domElement
    // 起步中途被拆时场景可能还没建。
    if (this.stage) this.stage.dispose()
    if (this.weather) this.weather.dispose()
    if (this.materials) this.materials.dispose()
    if (this.skyLights) this.skyLights.dispose()
    if (this.reflection) this.reflection.dispose()
    if (this.post) this.post.dispose()
    if (this.sky) this.sky.dispose()
    this.renderer.dispose()
    this.renderer.forceContextLoss()
    canvas.remove()
  }

  window.FoliaMachiRuntime = MachiRuntime
})()
