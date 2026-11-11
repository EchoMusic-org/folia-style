// 雾笺（nebbia）模式入口：移植自 folia-major nebbia/VisualizerNebbia.tsx + createNebbiaRuntime.ts（NebbiaRuntime 类）+ entry.tsx
// → 原生 JS 模式接口（mount/setTheme/setLines/tick/destroy/setTuning）。
// React 对应关系：
//   useState/useRef → 闭包变量；MotionValue（currentTime / audioBands.vocal）→ 每帧注入普通数值（runtime.setInput + frame）；
//   useVisualizerSongCommit（已提交歌曲滞后门）→ 简化为「歌词签名 + 2 秒确认纯音乐」（仿 machi/hanabi 入口）；
//   useFirstFrameDrawn / ARRIVING_MARK（首帧前画布是空的，小图等它）→ 插件无小图等帧逻辑，onFirstFrame 只留挂钩；
//   WebGL2 不可用 / 着色器编不过 / 上下文丢失 → failed，退回只显示当前这句（兜底文字层）；
//   上下文恢复 → 销毁重建运行时（上游 generation++ 触发 useEffect 重建）。
// 与上游的差异（插件适配）：
//   驱动：上游 NebbiaRuntime 自持 rAF 循环；插件改为 bridge tick 驱动——入口 tick 每帧调 runtime.frame()，
//     requestFrame 保留为挂钩（pause 时拖进度、精灵就绪等补帧语义由 bridge tick 天然覆盖，不自排 rAF）；
//     暂停/静止的 dt=0 语义保留（clock.tick(now, paused)，snow/condensation/fireflies 每帧拿 frozen ? 0 : dt）。
//   分辨率：renderScale 恒 1（插件无全局歌词画布挡位），dpr = min(2, devicePixelRatio)。
//   lucide 图标：上游 rebuild 先 loadLucideIcons 再排版；插件里图标经 window.foliaLucideIconNode 同步解析
//     （nebbia-glyphs.js 的 iconPolys），直接排版，theme.lyricsIcons 恒为空时用 NEBBIA_DEFAULT_DOODLES。
//   智能动感：aquabeats() 在 nebbia-aquarium.js 里按 FoliaBeatFx 供数（上游 beatFxLive 的等价消费）。
// 字号：上游接 lyricsFontScale（fallback 文案与排版都用）；插件 frameState 有就透传，没有恒 1。
(function () {
  'use strict'

  var Core = window.FoliaNebbiaCore
  var Chars = window.FoliaNebbiaChars
  var SceneCls = window.FoliaNebbiaScene
  var GlyphsCls = window.FoliaNebbiaGlyphs
  var DropsCls = window.FoliaNebbiaDrops
  var MaskCls = window.FoliaNebbiaMask
  var GlassCls = window.FoliaNebbiaGlass
  var SnowCls = window.FoliaNebbiaSnow
  var AquaCls = window.FoliaNebbiaAquarium
  var GlCls = window.FoliaNebbiaGl
  var HitsCls = window.FoliaNebbiaHits
  var RideCls = window.FoliaNebbiaRide
  var SeedHash = window.FoliaSeedHash

  /** 兜底主题（setTheme 之前 / mount 时还没有主题）：与上游默认深色底近似。 */
  var FALLBACK_THEME = {
    backgroundColor: '#05070a',
    primaryColor: '#f4f4f5',
    accentColor: '#f4f4f5',
    secondaryColor: '#71717a',
    fontStyle: 'sans',
    fontFamily: '',
    fontWeight: 700,
    animationIntensity: 'normal',
    wordColors: [],
    lyricsIcons: []
  }

  /** 轻量歌词签名：seed + 行数 + 首尾时间（内容变化基本伴随行数或时间变化）。 */
  function linesSignature(seed, lines) {
    var first = lines.length ? lines[0].startTime : -1
    var last = lines.length ? (lines[lines.length - 1].endTime || lines[lines.length - 1].startTime) : -1
    return String(seed) + '|' + lines.length + '|' + first + '|' + last
  }

  // ---------- nebbiaFrameUniforms（上游 nebbiaFrameUniforms.ts 照搬） ----------
  // 主着色器这一帧的 uniform：tuning、车身颠簸的位移、聚光灯，W、H 是 CSS 像素。
  // 聚光灯的光源：街景在远处楼底，水族箱在水面上方（画面上沿外），横向位置都按 spotX；水族箱跟拍时光斑半径乘 aqua.spotScale。

  /** 窗外各样在 uScenery 里的位，和 nebbia-glsl.js 的 SCN_* 一致；聚光灯不占位，关掉时强度给 0。 */
  var SCENERY_BITS = { buildings: 1, lights: 2, cars: 4, road: 8 }
  /** 雨：下（16）、斜着落（32）。 */
  var RAIN_BITS = { slant: 16 | 32, straight: 16, off: 0 }

  function nebbiaFrameUniforms(t, shake, spot, W, H, time, aqua) {
    var sx = shake[0], sy = shake[1]
    var asp = W / H
    var srcY = aqua ? -0.04 : 0.595
    var scenery = t.scenery.reduce(function (bits, part) {
      return bits | (SCENERY_BITS[part] !== undefined ? SCENERY_BITS[part] : 0)
    }, t.glass === 'snow' && !aqua ? 0 : (RAIN_BITS[t.rain] !== undefined ? RAIN_BITS[t.rain] : 0))
    return {
      time: time,
      mist: t.mist, edge: Core.NEBBIA_FIXED.edge, refract: Core.NEBBIA_FIXED.refract, bus: t.busSpeed, glint: Core.NEBBIA_FIXED.glint, neon: t.neon,
      glassShift: [-sx * 0.35 / W, -sy * 0.35 / H], sceneShift: [-sx / W, -sy / H],
      spotSrc: [t.spotX * asp, srcY], spotSrc2: [(1 - t.spotX) * asp, srcY],
      spotTgt: [spot.x / W * asp, spot.y / H],
      spotR: Math.max(0.02, spot.r / H * 0.75) * (aqua ? aqua.spotScale : 1),
      spotI: t.scenery.indexOf('spot') >= 0 ? spot.i * t.spot : 0,
      scenery: scenery,
      dewGlint: t.dewGlint,
      aqua: aqua || null
    }
  }

  // ---------- NebbiaRuntime（上游 createNebbiaRuntime.ts） ----------
  // 雾笺的运行时：一块画布、一个 WebGL2 上下文。上游自己的 rAF 循环改为 bridge tick 驱动（入口 tick 每帧调 frame()），
  // 每帧的播放时间和人声能量由入口注入（setInput），不在循环里读 MotionValue。暂停时不自排帧，
  // bridge tick 照常进来时 frozen 分支保证 dt=0（照常按歌词写字、窗外按车速匀速走，但不颠簸、没有小雨点）。
  // 着色器在后台编（nebbia-gl.js 的 NebbiaProgramBuild），编好之前 frame 直接返回、下一帧再问。
  // 窗外是水族箱时每帧推着水母、跟拍的水草和大泡走（nebbia-aquarium.js），智能动感模式的「舞潮踏拍」开着就跟拍；
  // 水族箱里没有雨打窗、车也不颠（疏雨轻车不算）。玻璃是雪窗时雪花和雪化成的水归 nebbia-snow.js，写字的手指经过时把雪抹开。

  // 改了要重排整首的 tuning 项
  var LAYOUT_KEYS = ['appear', 'fade', 'layouts', 'credits', 'jitter', 'warp', 'hold', 'refog', 'writeSpeed', 'doodle']
  // 开关组是数组，每次合并都是新的一份：按内容比
  function sameValue(a, b) {
    return Array.isArray(a) && Array.isArray(b) ? a.join() === b.join() : a === b
  }

  // input：{ host, seeThrough, scene, glass, onFirstFrame, onFailed, onRestored }
  function NebbiaRuntime(input, theme, tuning) {
    var self = this
    this.input = input
    this.theme = theme
    this.tuning = tuning
    /** 分辨率倍数：插件无全局挡位，恒 1（上游外壳从全局挡位和 tuning.render 合出来，预览时是 1）。 */
    this.renderScale = 1
    /** 每帧由入口注入的播放时间（秒）与人声频段能量（上游 MotionValue currentTime / audioBands.vocal）。 */
    this.currentTime = 0
    this.vocalValue = 0
    this.canvas = document.createElement('canvas')
    this.mask = new MaskCls.NebbiaMask()
    this.motion = new DropsCls.NebbiaGlassMotion()
    this.spot = new SceneCls.NebbiaSpot()
    this.energy = new HitsCls.VocalEnergy()
    this.fieldInst = []
    /** 玻璃是凝露时雾上的细小冷凝水珠（代替 motion 的凝结水珠）；雨窗时 null。 */
    this.condensation = input.glass === 'dew' ? new GlassCls.NebbiaCondensation() : null
    /** 玻璃是雪窗时玻璃上的雪和雪化成的水（代替 motion 的凝结水珠）；别的玻璃 null。 */
    this.snow = null
    /** 玻璃是凝露时玻璃上的萤虫；别的玻璃 null。 */
    this.fireflies = input.glass === 'dew' ? new GlassCls.NebbiaFireflies() : null
    this.observer = null
    this.hits = new HitsCls.NebbiaHits(0)
    this.laid = []
    this.words = []
    /** 大雨点排好时用的人声轨包络（智能动感模式「疏雨轻车」的雨点跟人声），没有时 null、退回频段。 */
    this.vocalEnv = null
    this.drizzleRide = new RideCls.NebbiaDrizzleRide()
    this.clock = new Core.NebbiaSceneClock()
    /** 窗外是水族箱时的水母；街景时 null。 */
    this.aquarium = input.scene === 'aquarium' ? new AquaCls.NebbiaAquarium() : null
    /** 上游 aquaBeats() 每帧改写的那一份（插件在 nebbia-aquarium.js 的 aquabeats 内部）。 */
    this.song = { lines: [], seed: 'nebbia' }
    this.fontScale = 1
    this.showText = true
    this.paused = false
    this.still = false
    this.W = 0
    this.H = 0
    this.buildToken = 0
    this.firstDrawn = false
    this.dead = false
    /** 主题字体上次看时是否已加载：从没加载变成加载了，骨架才要重追。 */
    this.fontReady = true
    /** 建运行时的时刻和着色器编好是否已记日志：看预热有没有命中缓存。 */
    this.startedAt = performance.now()
    this.shadersLogged = false

    // 上下文丢失 / 恢复（上游类字段箭头函数 → 构造里绑 this）
    this.handleContextLost = function (event) {
      event.preventDefault()
      this.dead = true
      this.input.onFailed()
    }
    // 上下文回来了：纹理、程序都没了，整个运行时由外壳重建
    this.handleContextRestored = function () {
      this.input.onRestored()
    }
    // 别的字体加载完也会触发：只在主题字体刚变成可用时重排
    this.handleFontsLoaded = function () {
      if (this.dead) return
      var ready = this.glyphs.fontReady()
      var arrived = ready && !this.fontReady
      this.fontReady = ready
      if (!arrived) return
      this.glyphs.clear()
      this.rebuild()
    }
    this.handleResize = function () { self.resize() }

    // 雪窗、凝露要知道歌词的水在哪（扫过的、写好的笔画），和玻璃上的雪、小水珠联动
    if (input.glass !== 'rain') { this.mask.sweeps = []; this.mask.wet = [] }
    // 雪窗：写字留下的水珠也会结冰（nebbia-mask.js 的 putInkBead 收进 mask.ice）
    if (input.glass === 'snow') this.mask.ice = []
    // setTuning 只在 tuning 变了才调：上下文恢复后重建的运行时要自己带上颠簸强度
    this.motion.bump = tuning.bump
    this.canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block'
    this.glyphs = new GlyphsCls.NebbiaGlyphCache(Core.nebbiaThemeFontStack(theme), Core.nebbiaThemeFontWeight(theme, 600))
    input.host.appendChild(this.canvas)
    try {
      this.gl = new GlCls.NebbiaGl(this.canvas, input.seeThrough, input.scene, input.glass)
      this.gl.onSpriteReady = function () { self.requestFrame() }
      if (input.glass === 'snow') {
        this.snow = new SnowCls.NebbiaSnow()
        var atlas = this.snow.atlas()
        this.gl.setFlakeAtlas(atlas[0], atlas[1])
      }
      this.canvas.addEventListener('webglcontextlost', this.handleContextLost)
      this.canvas.addEventListener('webglcontextrestored', this.handleContextRestored)
      this.observer = new ResizeObserver(this.handleResize)
      this.observer.observe(input.host)
      this.applyTheme()
      this.resize()
    } catch (error) {
      // 着色器编不过之类：画布、上下文、监听都收回，外壳退回只显示当前这句
      this.dead = true
      if (this.observer) this.observer.disconnect()
      this.canvas.removeEventListener('webglcontextlost', this.handleContextLost)
      this.canvas.removeEventListener('webglcontextrestored', this.handleContextRestored)
      var loseCtx = this.canvas.getContext('webgl2')
      if (loseCtx) {
        var lose = loseCtx.getExtension('WEBGL_lose_context')
        if (lose) lose.loseContext()
      }
      if (this.canvas.parentNode) this.canvas.remove()
      throw error
    }
    // 主题字体晚到：骨架是对着回退字体追的，作废重排
    this.fontReady = this.glyphs.fontReady()
    if (document.fonts) document.fonts.addEventListener('loadingdone', this.handleFontsLoaded)
    // 笔顺数据只读一次；到了以后字形缓存作废，下一次排版用上（读不到时兜底骨架追踪，见 nebbia-glyphs.js）
    GlyphsCls.loadNebbiaStrokes().then(function (data) {
      if (data && !self.dead) { self.glyphs.clear(); self.rebuild() }
    })
  }

  NebbiaRuntime.prototype.setSong = function (song) {
    if (song.seed !== this.song.seed) this.clock.songChanged()
    this.song = song
    this.rebuild()
  }

  NebbiaRuntime.prototype.setFontScale = function (scale) {
    if (scale !== this.fontScale) { this.fontScale = scale; this.rebuild() }
  }

  NebbiaRuntime.prototype.setShowText = function (show) {
    if (show !== this.showText) { this.showText = show; this.rebuild() }
  }

  /** 透明时雾的颜色跟主题日夜：日间乳白，夜间深色（像夜里起雾的车窗）。 */
  NebbiaRuntime.prototype.setDaylight = function (daylight) {
    this.gl.mistTint = daylight ? [0.86, 0.89, 0.92] : [0.07, 0.08, 0.1]
    this.requestFrame()
  }

  // 只改配色时只换调色板；字体或涂鸦图标变了才重排整首
  NebbiaRuntime.prototype.setTheme = function (theme) {
    // 上游 resolveLucideIconNames(theme.lyricsIcons) 比较；插件 theme.lyricsIcons 恒为空（无 lucide），直接按内容比
    var prevIcons = (this.theme && this.theme.lyricsIcons) || []
    var nextIcons = (theme && theme.lyricsIcons) || []
    var iconsChanged = String(nextIcons.join()) !== String(prevIcons.join())
    this.theme = theme
    var fontChanged = this.glyphs.setFont(Core.nebbiaThemeFontStack(theme), Core.nebbiaThemeFontWeight(theme, 600))
    if (fontChanged) this.fontReady = this.glyphs.fontReady()
    this.applyTheme()
    if (fontChanged || iconsChanged) this.rebuild()
    else this.requestFrame()
  }

  NebbiaRuntime.prototype.setTuning = function (tuning) {
    var prev = this.tuning
    this.tuning = tuning
    this.motion.bump = tuning.bump
    var relayout = false
    for (var i = 0; i < LAYOUT_KEYS.length; i += 1) {
      var k = LAYOUT_KEYS[i]
      if (!sameValue(prev[k], tuning[k])) { relayout = true; break }
    }
    if (relayout) this.rebuild()
    this.requestFrame()
  }

  /** 分辨率倍数变了：就地换画布和缓冲的尺寸，不重建上下文。插件无全局挡位，恒 1，调了也不动。 */
  NebbiaRuntime.prototype.setRenderScale = function (scale) {
    if (scale === this.renderScale) return
    this.renderScale = scale
    this.resize()
  }

  NebbiaRuntime.prototype.setPlayback = function (paused, still) {
    this.paused = paused
    this.still = still
    this.requestFrame()
  }

  /** 每帧由入口注入的播放时间（秒）与人声频段能量（上游 MotionValue currentTime / audioBands.vocal 的 get()）。 */
  NebbiaRuntime.prototype.setInput = function (currentTime, vocalValue) {
    this.currentTime = currentTime || 0
    this.vocalValue = vocalValue || 0
  }

  /** 补画一帧的挂钩（上游 requestAnimationFrame）：插件由 bridge tick 每帧驱动，不自排循环，这里留空。 */
  NebbiaRuntime.prototype.requestFrame = function () {
  }

  NebbiaRuntime.prototype.destroy = function () {
    this.dead = true
    if (this.observer) this.observer.disconnect()
    if (document.fonts) document.fonts.removeEventListener('loadingdone', this.handleFontsLoaded)
    this.canvas.removeEventListener('webglcontextlost', this.handleContextLost)
    this.canvas.removeEventListener('webglcontextrestored', this.handleContextRestored)
    this.gl.destroy()
    if (this.canvas.parentNode) this.canvas.remove()
  }

  NebbiaRuntime.prototype.applyTheme = function () {
    var p = Core.resolveNebbiaPalette(this.theme)
    this.gl.setPalette(p.sky0, p.sky1, p.la, p.lb, p.lc)
    if (this.aquarium) this.aquarium.setPalette(p.la, p.lb, p.lc)
    if (this.fireflies) this.fireflies.setPalette(p.la, p.lb, p.lc)
  }

  /** 「舞潮踏拍」：上游 runtime 内部的 aquaBeats()；插件在 nebbia-aquarium.js 里按 FoliaBeatFx 供数（still 时回 null）。 */
  NebbiaRuntime.prototype.aquaBeats = function () {
    return AquaCls.aquabeats(this.still)
  }

  NebbiaRuntime.prototype.resize = function () {
    // 量排版尺寸，不量 getBoundingClientRect：样式小图和样式窗口的大样张把窗口大的舞台缩小了画，
    // 量到缩小后的尺寸，整首就排在小画布上，字号算小（上游 #963）
    var width = this.input.host.clientWidth
    var height = this.input.host.clientHeight
    if (width < 1 || height < 1) return
    var sized = width !== this.W || height !== this.H
    this.W = width
    this.H = height
    // 分辨率（上游 #929）：renderScale 恒 1 → resolveLyricPixelRatio(min(2, dpr), 1) = min(2, dpr)
    var dpr = Math.min(2, window.devicePixelRatio || 1)
    this.gl.resize(this.W, this.H, dpr)
    this.mask.resize(this.W, this.H)
    if (this.snow) this.snow.resize(this.W, this.H)
    if (this.fireflies) this.fireflies.resize(this.W, this.H)
    if (sized) {
      // 雪窗没有雨窗那些凝结水珠（颠簸也就震不落什么）
      if (this.condensation) this.condensation.build(this.W, this.H)
      else if (!this.snow) this.motion.buildField(this.W, this.H)
      this.rebuild()
    }
    this.requestFrame()
  }

  // 换歌、改排版相关的设置、换尺寸时重排整首。上游先 loadLucideIcons（图标字形要用 lucide 的节点）；
  // 插件里图标经 window.foliaLucideIconNode 同步解析（nebbia-glyphs.js 的 iconPolys），直接排版。
  NebbiaRuntime.prototype.rebuild = function () {
    var token = ++this.buildToken
    var lines = this.song.lines
    var seed = this.song.seed
    var title = this.song.title
    var artist = this.song.artist
    var themeIcons = (this.theme && this.theme.lyricsIcons) || []
    var doodles = themeIcons.length ? themeIcons : Chars.NEBBIA_DEFAULT_DOODLES
    if (token !== this.buildToken || this.dead || !this.W) return
    var source = this.showText
      ? Chars.appendNebbiaCredits(Chars.buildNebbiaLines(lines, seed, this.tuning.doodle, doodles), this.tuning.credits ? title : null, artist)
      : []
    this.laid = SceneCls.buildNebbiaScene(source, this.glyphs, this.tuning, { W: this.W, H: this.H, fontScale: this.fontScale }, seed)
    this.hits = new HitsCls.NebbiaHits(SeedHash.hashVisualizerSeed(String(seed)))
    this.words = source.map(function (l) { return l.words })
    this.rebuildHits()
    this.spot.reset()
    this.requestFrame()
  }

  NebbiaRuntime.prototype.rebuildHits = function () {
    this.hits.buildBig(this.laid, this.words, this.W, this.H, this.vocalEnv)
  }

  // 着色器编好了没有：没编好下一帧再问（bridge tick 每帧都会来，暂停时也问，编好补画第一帧）；
  // 编不过就和上下文丢了一样，外壳退回只显示当前这句
  NebbiaRuntime.prototype.shadersReady = function () {
    try {
      if (this.gl.ready) {
        if (!this.shadersLogged) {
          this.shadersLogged = true
          console.info('[Nebbia] shaders ready ' + Math.round(performance.now() - this.startedAt) + ' ms after start')
        }
        return true
      }
    } catch (error) {
      console.warn('[Nebbia] shaders failed to build', error)
      this.dead = true
      this.input.onFailed()
      return false
    }
    // 着色器还在后台编：bridge tick 下一帧再问（上游在这里自排 requestAnimationFrame，插件不自持循环）
    return false
  }

  // 主循环（上游 frame() 的每帧顺序照搬，rAF 自续与 requestFrame 排队改为 bridge tick 驱动）
  NebbiaRuntime.prototype.frame = function () {
    if (this.dead || this.gl.isContextLost || !this.shadersReady()) return
    // 宿主还没尺寸（隐藏、0 大小）时不画，也不报首帧；有尺寸后 resize 会补一帧
    if (!this.W || !this.H) return
    var now = performance.now() / 1000
    var frozen = this.paused || this.still
    var dt = this.clock.tick(now, this.paused)
    var T = this.currentTime
    var t = this.tuning
    // 疏雨轻车：车跟底鼓颠；人声轨包络到了或开关变了，就按它重排整首的雨点，强度每帧乘小雨点密度和大雨点大小
    // 车只在街景里颠（水族箱里不颠），雨只打在雨窗玻璃上（凝露没有雨打窗）
    var ride = this.drizzleRide
    var rainGlass = this.input.glass === 'rain'
    if (rainGlass || !this.aquarium) ride.step(this.motion, now, T, frozen, t.bump, !this.aquarium)
    else this.motion.beginFrame(now, frozen, false)
    var vocalStrength = rainGlass ? ride.rain : 0
    if (rainGlass && ride.env !== this.vocalEnv) {
      this.vocalEnv = ride.env
      this.rebuildHits()
    }
    var e = this.energy.update(this.vocalValue, Math.max(dt, 1 / 60))
    this.hits.advance(T, e, this.still ? 0 : t.rainHit * vocalStrength, HitsCls.NebbiaHits.lifeOf(t.refog, Core.NEBBIA_FIXED.beadHold), this.W, this.H)
    this.mask.draw(this.laid, T, now, t, this.motion, this.hits, t.rainBig * vocalStrength)
    this.spot.update(this.laid, T, dt)
    var aqua = this.aquarium ? this.aquarium.step(dt, this.clock.time, this.W / this.H, t, this.aquaBeats()) : null
    if (this.snow) {
      // 车速带的风只在雨夜街景里吹雪（水族箱里没有车在开）
      this.snow.step(frozen ? 0 : dt, t, this.mask.sweeps || [], this.mask.wet || [], this.aquarium ? 0 : t.busSpeed, !this.aquarium)
      this.snow.drawFog(this.mask.ctx, t)
    } else if (this.condensation) this.condensation.touchInk(this.mask.sweeps || [], this.mask.wet || [], t.dewSize)
    var field = this.condensation
      ? this.condensation.instances(frozen ? 0 : dt, t.dew, t.dewSize)
      : this.snow
        ? this.snow.instances(this.fieldInst)
        : this.motion.fieldInstances(this.fieldInst, t.busSpeed)
    var fieldChanged = this.condensation ? this.condensation.changed : (this.snow ? this.snow.changed : true)
    var u = nebbiaFrameUniforms(t, this.motion.shake(), this.spot, this.W, this.H, this.clock.time, aqua)
    this.gl.render(this.mask.ctx, this.mask.breath.active ? this.mask.breath : null, this.motion.drops, field, u, fieldChanged)
    if (this.snow) {
      var fi = this.snow.flakeInstances(this.mask.ice || [])
      this.gl.drawFlakes(fi[0], fi[1], u.glassShift)
    }
    if (this.fireflies) {
      var ff = this.fireflies.step(frozen ? 0 : dt)
      this.gl.drawFireflies(ff[0], ff[1])
    }
    if (!this.firstDrawn) { this.firstDrawn = true; this.input.onFirstFrame() }
  }

  // ---------- 模式入口（上游 VisualizerNebbia.tsx 的外壳对应） ----------

  function createMode(tuning, config) {
    var TUNING = (window.FoliaTunings && window.FoliaTunings.resolveModeTuning('nebbia', config)) || Core.DEFAULT_NEBBIA_TUNING
    TUNING = Core.normalizeNebbiaTuning(TUNING)
    // 预览实例（样式窗口舞台/缩略图）：分辨率 1、透出不透出按预览判定
    var definitionPreview = Boolean(config && config.previewMode)

    var host = null
    var layerEl = null
    var runtimeHost = null
    var fallback = null
    var runtime = null
    var runtimeFailed = false
    var destroyed = false

    var theme = null
    var lines = []
    var currentSeed = 'nebbia'
    var songTitle = ''
    var songArtist = ''
    var currentTime = 0
    var vocalValue = 0
    var currentLineIndex = -1
    var paused = false
    var stillMode = false
    var showText = true
    var daylight = false
    var lyricsFontScale = 1

    // 已提交歌曲（屏幕上实际呈现的歌）：滞后于 props，免得对着还没到的歌词排版（上游 songHandover.ts）。
    var committed = { sig: '', lines: [], isInstrumental: false, graceTimer: 0 }

    // 窗外与玻璃（上游 VisualizerNebbia.tsx）：behind === 'aquarium' → 水族箱，否则街景；
    // 透出后面（播放页透明 / 选了共用背景）时画布带透明通道——插件里没有外壳背景概念，只按 tuning 与预览判定。
    function resolveScene() { return TUNING.behind === 'aquarium' ? 'aquarium' : 'night' }
    function resolveGlass() { return TUNING.glass }
    function resolveSeeThrough() { return Core.nebbiaSeesThrough(TUNING, null, definitionPreview) }

    function songContext() {
      return {
        lines: committed.isInstrumental ? [] : committed.lines,
        seed: currentSeed,
        title: songTitle || '',
        artist: songArtist || ''
      }
    }

    /** 歌词签名变了：立即提交并重排；行数为空时等 2 秒确认纯音乐（连续翻行时少重建）。 */
    function commitSong() {
      var sig = linesSignature(currentSeed, lines)
      if (sig === committed.sig) return
      committed.sig = sig
      window.clearTimeout(committed.graceTimer)
      if (lines.length === 0) {
        // 2 秒内没歌词 → 纯音乐：玻璃照常，只是不写字。
        committed.graceTimer = window.setTimeout(function () {
          committed.isInstrumental = true
          committed.lines = []
          if (runtime) runtime.setSong(songContext())
        }, 2000)
      } else {
        committed.isInstrumental = false
        committed.lines = lines
        if (runtime) runtime.setSong(songContext())
      }
    }

    /** 建（或重建）运行时；上下文恢复 / 窗外与玻璃切换走这里。歌、tuning、暂停都就地推给运行时。 */
    function ensureRuntime() {
      if (destroyed) return
      var hostElement = runtimeHost
      try {
        if (runtime) {
          try { runtime.destroy() } catch (e) { /* 忽略 */ }
          runtime = null
        }
        runtime = new NebbiaRuntime({
          host: hostElement,
          seeThrough: resolveSeeThrough(),
          scene: resolveScene(),
          glass: resolveGlass(),
          onFirstFrame: function () { /* 上游 setDrawn(true)：插件无小图等帧逻辑，留挂钩 */ },
          onFailed: function () {
            // WebGL2 不可用 / 着色器编不过 / 上下文丢失：退回只显示当前这句。
            runtimeFailed = true
            updateFallback()
          },
          onRestored: function () {
            // 上下文回来了：整个运行时重建（上游 generation++ 触发 useEffect 重建）。
            scheduleRebuild()
          }
        }, theme || FALLBACK_THEME, TUNING)
        runtime.setFontScale(lyricsFontScale)
        runtime.setShowText(showText)
        runtime.setDaylight(daylight)
        runtime.setPlayback(paused, stillMode)
        runtime.setSong(songContext())
        runtimeFailed = false
      } catch (e) {
        runtimeFailed = true
        runtime = null
        console.warn('[FoliaModeNebbia] 运行时创建失败', e)
      }
      updateFallback()
    }

    function scheduleRebuild() {
      if (destroyed) return
      ensureRuntime()
    }

    /** runtimeFailed 时的兜底文字：显示当前行（与上游一致，纯音乐 / showText 关时留空）。 */
    function updateFallback() {
      if (!fallback) return
      var text = ''
      if (runtimeFailed && showText && !committed.isInstrumental && committed.lines.length) {
        var idx = Math.max(0, Math.min(currentLineIndex, committed.lines.length - 1))
        var line = committed.lines[idx]
        text = line && line.fullText ? line.fullText : ''
      }
      // 兜底样式跟主题走（上游 failed 分支：主题主色、主题字体、按歌词字号 clamp）
      var th = theme || FALLBACK_THEME
      fallback.style.color = th.primaryColor || '#f4f4f5'
      fallback.style.fontFamily = Core.nebbiaThemeFontStack(th)
      fallback.style.fontWeight = String(Core.nebbiaThemeFontWeight(th, 600))
      fallback.style.fontSize = 'clamp(2rem,' + (5.4 * lyricsFontScale) + 'vw,5.6rem)'
      if (fallback.textContent !== text) fallback.textContent = text
    }

    var instance = {
      id: 'nebbia',
      mount: function (hostEl) {
        host = hostEl
        layerEl = document.createElement('div')
        layerEl.style.cssText = 'position:absolute;inset:0;z-index:10;overflow:hidden'
        runtimeHost = document.createElement('div')
        runtimeHost.style.cssText = 'position:absolute;inset:0'
        layerEl.appendChild(runtimeHost)
        // 运行时失败的兜底文字（上游 failed 分支）。
        fallback = document.createElement('div')
        fallback.style.cssText = 'pointer-events:none;position:absolute;inset:0;display:flex;align-items:center;justify-content:center;padding:0 10%;text-align:center'
        layerEl.appendChild(fallback)
        host.appendChild(layerEl)
        ensureRuntime()
      },
      setTheme: function (next) {
        theme = next || FALLBACK_THEME
        if (fallback) updateFallback()
        if (runtime) runtime.setTheme(theme)
      },
      setLines: function (nextLines) {
        lines = nextLines || []
        commitSong()
      },
      tick: function (frameState) {
        if (destroyed) return
        currentTime = frameState.currentTime || 0
        vocalValue = frameState.audioBands && frameState.audioBands.vocal ? frameState.audioBands.vocal : 0
        currentLineIndex = frameState.currentLineIndex !== undefined ? frameState.currentLineIndex : -1
        // 曲名/歌手变了：种子跟着歌走（雪窗的风、街景的灯、笔迹抖动都按它取随机），提交换歌。
        var nextTitle = frameState.songTitle || ''
        var nextArtist = frameState.songArtist || ''
        if (nextTitle !== songTitle || nextArtist !== songArtist) {
          songTitle = nextTitle
          songArtist = nextArtist
          currentSeed = (songTitle && songArtist) ? songTitle + '|' + songArtist : (songTitle || songArtist || 'nebbia')
          commitSong()
        }
        var nextPaused = frameState.isPlaying === false
        if (nextPaused !== paused) {
          paused = nextPaused
          if (runtime) runtime.setPlayback(paused, stillMode)
        }
        // 静态模式（样式窗口的静止预览）：照常跟着歌词写字，窗外按车速匀速走，但不颠簸、没有小雨点。
        if (frameState.staticMode !== undefined && frameState.staticMode !== stillMode) {
          stillMode = Boolean(frameState.staticMode)
          if (runtime) runtime.setPlayback(paused, stillMode)
        }
        if (frameState.showText !== undefined && frameState.showText !== showText) {
          showText = frameState.showText
          if (runtime) runtime.setShowText(showText)
        }
        if (frameState.isDaylight !== undefined && frameState.isDaylight !== daylight) {
          daylight = Boolean(frameState.isDaylight)
          if (runtime) runtime.setDaylight(daylight)
        }
        if (frameState.lyricsFontScale !== undefined && frameState.lyricsFontScale !== lyricsFontScale) {
          lyricsFontScale = frameState.lyricsFontScale
          if (runtime) runtime.setFontScale(lyricsFontScale)
        }
        if (!runtime) { updateFallback(); return }
        runtime.setInput(currentTime, vocalValue)
        try {
          // bridge tick 驱动：上游 rAF 循环 → 入口每帧调 frame()（着色器没编好时 frame 内部直接返回、下帧再问）。
          runtime.frame()
        } catch (e) {
          // 帧异常不阻塞主循环（着色器编译失败等已在 runtime 内标 dead）。
          if (!runtimeFailed) {
            runtimeFailed = true
            console.warn('[FoliaModeNebbia] 帧异常', e)
          }
        }
        updateFallback()
      },
      setTuning: function (nextTuning) {
        TUNING = Core.normalizeNebbiaTuning(nextTuning)
        // 窗外换成共用背景（透出）、街景/水族箱互切、玻璃种类互切 → 着色器按另一套编：整个运行时重建（上游 useEffect deps）。
        if (runtime && (runtime.input.scene !== resolveScene() || runtime.input.glass !== resolveGlass() || runtime.input.seeThrough !== resolveSeeThrough())) {
          scheduleRebuild()
          return
        }
        if (runtime) runtime.setTuning(TUNING)
      },
      setShowText: function (next) {
        if (next === undefined) return
        showText = Boolean(next)
        if (runtime) runtime.setShowText(showText)
      },
      setDaylight: function (next) {
        daylight = Boolean(next)
        if (runtime) runtime.setDaylight(daylight)
      },
      destroy: function () {
        destroyed = true
        window.clearTimeout(committed.graceTimer)
        if (runtime) {
          try { runtime.destroy() } catch (e) { /* 忽略 */ }
          runtime = null
        }
        if (layerEl && layerEl.parentNode) layerEl.parentNode.removeChild(layerEl)
        layerEl = null
        runtimeHost = null
        fallback = null
        host = null
      }
    }

    return instance
  }

  window.FoliaModeNebbia = { create: createMode }
})()
