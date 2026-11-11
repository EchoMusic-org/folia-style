// 雾笺（nebbia）核心模块：移植自 folia-major src/components/visualizer/nebbia/
//   nebbiaConstants.ts（原型里调好、接入后写死的参数与两个小工具）
//   types.ts（选项常量、数值范围 NEBBIA_LIMITS、默认 tuning；接口/类型无运行时形态，注释保留在段首）
//   tuning.ts 的 normalizeNebbiaTuning（存档归一化、legacy appearMode/fadeMode/resolution 迁移）
//     + tuningDefinition.ts 的 numberWithin + utils/lyricRenderQuality.ts 的 normalizeLyricRenderOverride（内联）
//   nebbiaPalette.ts（主题 → 窗外夜景配色）、nebbiaSceneClock.ts（窗外时钟）、nebbiaBehind.ts（窗外是什么）
// 全部为纯函数/常量/小类，被后续模块按 window.FoliaNebbiaCore 引用。
//
// 插件差异（相对上游）：
//   预览判定 isPreviewMode → config.previewMode（由模式入口透传，本文件的 behind 工具直接收布尔）；
//   background 为 { mode, transparent } 简化形态，工具函数原样透传、只在画街景时把 transparent 标成 true；
//   主题字体栈/字重与 machi 同款（foliaBridgeFontStack / foliaGetLyricFontWeight 守卫 + theme.fontFamilyStack 兜底）。
(function () {
  'use strict'

  var ColorMix = window.FoliaColorMix

  // ---------- 原型写死参数（原版 nebbiaConstants.ts） ----------
  // 原型（feat/fog-write-prototype 分支 dev/prototypes/fog-write/index.html）里能调、接入后写死的参数（P），和几个共用的小工具。
  // 值都是原型里调好的默认值；要开放成设置时挪进 types.ts 的 NebbiaTuning。
  var NEBBIA_FIXED = {
    /** 擦痕边缘毛糙。 */
    edge: 0.6,
    /** 擦痕边上凝出的小水珠。 */
    beads: 0.35,
    /** 偶尔往下淌的水珠。 */
    drip: 0.25,
    /** 水珠折射、高光。 */
    refract: 1,
    glint: 1,
    /** 雾上的凝结水珠密度。 */
    fieldDrops: 0.5,
    /** 风把下淌的水珠往后推（0 = 竖直往下）。 */
    wind: 0,
    /** 收笔处堆起的大水珠；字号小于 endBeadMin 像素的不留。 */
    endBead: 1,
    endBeadMin: 48,
    /** 字被雾吞掉后水珠多挂几秒。 */
    beadHold: 4,
    /** 让位时哈气盖掉旧句子：白气从中线鼓开到整片的秒数、新句子唱完后再留几秒、散掉的秒数、浓度（nebbiaBreath.ts）。 */
    breathSpread: 1.2,
    breathHold: 1,
    breathFade: 8,
    breathThick: 0.7,
    /** 颠簸频率、颠簸把大水珠震落的概率。 */
    bumpRate: 1,
    bumpFall: 0.5
  }

  /** 擦痕遮罩相对 CSS 像素的分辨率。 */
  var MASK_SCALE = 0.5
  /** 雾的预渲染相对画布的缩小倍数。 */
  var FOG_DIV = 4

  /** 夹在 min..max 里（缺省 0..1）。 */
  function clamp(value, min, max) {
    if (min === undefined) min = 0
    if (max === undefined) max = 1
    return Math.max(min, Math.min(max, value))
  }
  /** 平滑插值曲线。 */
  function smooth(t) {
    return t * t * (3 - 2 * t)
  }

  // ---------- 选项常量与默认 tuning（原版 types.ts） ----------
  // 雾笺的 tuning：歌词怎么出现在雾上、写完怎么消失，雾和窗外的几项，聚光灯、雨点和颠簸的强弱。
  // 原型（dev/prototypes/fog-write）里的其余参数写死在 NEBBIA_FIXED。运行时的输入形状见各接口注释。

  /**
   * 字怎么出现，打开的几种都会用到：手指一笔一笔写、整个字从雾里慢慢透出来、先哈一口气再在白气上写（nebbiaBreath.ts）。
   * 书写的两种开着几种就每句随机挑一种；慢慢显现和书写的一起开时，只用在来不及写完的句子上（上游 nebbiaScene.ts 的 applyAppear）。
   */
  var NEBBIA_APPEAR_STYLES = ['write', 'fade', 'breath']
  /** 写完怎么消失：慢慢起雾、两根手指来回搓掉；两种都开就每句随机。 */
  var NEBBIA_FADE_STYLES = ['fog', 'fingers']
  /** 一句的构图（上游 nebbiaCompositions.ts）：横条、两行错落、三行错落、十字、竖柱、刊头、徽章、竖排几列、环绕。 */
  var NEBBIA_LAYOUTS = ['ribbon', 'lines2', 'lines3', 'cross', 'pillar', 'header', 'badge', 'columns', 'orbit']
  /** 窗外画哪几样（每样一个开关，可以全关）：聚光灯、楼群、霓虹路灯招牌的光斑、车灯、湿路面和倒影。 */
  var NEBBIA_SCENERY = ['spot', 'buildings', 'lights', 'cars', 'road']
  /** 窗外的雨：跟着车速斜着落、竖直落、不下。 */
  var NEBBIA_RAIN = ['slant', 'straight', 'off']

  /**
   * 窗外是什么：雾笺自己画的雨夜街景、水族箱，或者共用背景（雾变成一层半透明的雾、日白夜深，擦开的字透出后面；透明模式下就是桌面）。
   */
  var NEBBIA_BEHIND = ['night', 'aquarium', 'backdrop']
  /**
   * 前面的雾玻璃上挂的水，和窗外是什么分开选：雨窗（大大小小的凝结水珠、雨点打窗）、凝露（一层很密的细小冷凝水珠慢慢渗出来，
   * 上游 nebbiaCondensation.ts）、雪窗（雪花打在玻璃上粘住、慢慢化成水珠，写字的手指经过时把雪抹开，上游 nebbiaSnow.ts；街景窗外不下雨）。
   * 换窗外不动玻璃；没存过玻璃的旧 tuning 读时按窗外搭配（NEBBIA_GLASS_FOR）。
   */
  var NEBBIA_GLASS = ['rain', 'dew', 'snow']
  /** 窗外的默认搭配（只给没存过玻璃的旧 tuning 用）：雨夜街景配雨窗、水族箱配凝露；共用背景不换。 */
  var NEBBIA_GLASS_FOR = { night: 'rain', aquarium: 'dew' }
  /** 窗外画哪套场景（着色器按它编，nebbia-glsl.js）：选了共用背景时水珠里折射的还是街景；透明时选了水族箱就折射水族箱。 */
  // NebbiaWindowScene = 'night' | 'aquarium'
  /** 水族箱里最多几只水母（着色器里 uniform 数组的长度）。 */
  var NEBBIA_MAX_JELLIES = 24
  /** 着色器里跟拍冒泡最多同时几排（nebbia-glsl.js 的 uBurst）。 */
  var NEBBIA_MAX_BURSTS = 12

  /**
   * 默认 tuning（各字段含义，见上游 NebbiaTuning 接口）：
   * render 分辨率与抗锯齿覆盖（#929），默认跟随「动画与性能」里的全局挡位；
   * appear 打开的出现方式、fade 打开的消失方式、layouts 打开的构图，至少一种；
   * behind 窗外是街景、水族箱还是共用背景（播放页透明时总是共用背景）；glass 前面雾玻璃上的水，着色器按它编，换了要重建运行时；
   * scenery 窗外打开的几样，可以一样都没有；rain 窗外的雨；credits 最后一句唱完后在玻璃上写出曲名和歌手；
   * jitter 手写歪斜（整字转动、上下错落、整行倾斜）；warp 手写变形（字形斜切胖瘦、笔画长短偏移、手抖）；
   * mist 雾气浓度；hold 下一句开始后写好的字再保持几秒才起雾；refog 重新起雾用几秒；strokeWidth 笔画粗细（× 字号）；
   * writeSpeed 书写速度（× 自然书写速度）；doodle 句尾顺手画一个主题图标的概率；
   * busSpeed 车速：窗外移动的快慢，0 是停站；neon 主题色霓虹的亮度；
   * spot 聚光灯强度 0 关；spotX 聚光灯光源的横向位置（× 屏宽），另一盏在左右对称的位置；
   * rainHit 雨点打在玻璃上的密度 0 关；rainBig 吐字时砸下的大雨点大小 0 不砸；bump 颠簸强度 0 关；
   * jellies 水族箱里几只水母；jellySize 水母大小（× 默认）；bubbles 水族箱的气泡多少（冒泡的泉眼和大泡）；
   * dew/dewSize/dewGlint 凝露玻璃的冷凝水珠：多少、大小、高光（× 默认）；
   * snow/snowSize/snowMelt 雪窗：打到玻璃上的雪多少、雪花大小、化得多快（× 默认）。
   */
  var DEFAULT_NEBBIA_TUNING = {
    render: { scale: 'global', antialias: 'global' },
    appear: ['write', 'fade'],
    fade: ['fog'],
    layouts: ['ribbon', 'lines2', 'lines3', 'cross', 'pillar', 'header', 'badge', 'columns', 'orbit'],
    behind: 'night',
    glass: 'rain',
    scenery: ['spot', 'buildings', 'lights', 'cars', 'road'],
    rain: 'slant',
    credits: true,
    jitter: 0.6,
    warp: 0.6,
    mist: 0.75,
    hold: 1.2,
    refog: 4,
    strokeWidth: 0.09,
    writeSpeed: 1,
    doodle: 0.3,
    busSpeed: 1,
    neon: 1,
    spot: 0.5,
    spotX: 0.8,
    rainHit: 1,
    rainBig: 1,
    bump: 1,
    jellies: 16,
    jellySize: 1,
    bubbles: 0.6,
    dew: 1,
    dewSize: 1,
    dewGlint: 1,
    snow: 1,
    snowSize: 1,
    snowMelt: 1
  }

  /** 各个数值项的范围：设置面板的滑块和归一化共用。 */
  var NEBBIA_LIMITS = {
    jitter: { min: 0, max: 1.5 },
    warp: { min: 0, max: 1.5 },
    mist: { min: 0.2, max: 1 },
    hold: { min: 0, max: 6 },
    refog: { min: 0.5, max: 12 },
    strokeWidth: { min: 0.04, max: 0.16 },
    writeSpeed: { min: 0.4, max: 2.5 },
    doodle: { min: 0, max: 1 },
    busSpeed: { min: 0, max: 3 },
    neon: { min: 0, max: 2 },
    spot: { min: 0, max: 2 },
    spotX: { min: 0, max: 1 },
    rainHit: { min: 0, max: 3 },
    rainBig: { min: 0, max: 2 },
    bump: { min: 0, max: 2.5 },
    jellies: { min: 0, max: NEBBIA_MAX_JELLIES },
    jellySize: { min: 0.5, max: 1.8 },
    bubbles: { min: 0, max: 1 },
    dew: { min: 0, max: 1.5 },
    dewSize: { min: 0.5, max: 2 },
    dewGlint: { min: 0, max: 2 },
    snow: { min: 0, max: 3 },
    snowSize: { min: 0.5, max: 2 },
    snowMelt: { min: 0.25, max: 3 }
  }

  // ---------- 数值工具（上游 tuningDefinition.ts 的 numberWithin） ----------
  /** 存的或补的数值夹在 min..max 里；不是有限数时用 fallback。 */
  function numberWithin(value, fallback, min, max) {
    return typeof value === 'number' && Number.isFinite(value)
      ? Math.min(max, Math.max(min, value))
      : fallback
  }

  // ---------- 歌词渲染覆盖（上游 utils/lyricRenderQuality.ts 的最小子集，内联） ----------
  /** 分辨率倍数档（「跟随全局」之外可存的值）。 */
  var LYRIC_RENDER_SCALES = [0.5, 0.75, 1, 1.5, 2]
  function isLyricRenderScale(value) {
    return LYRIC_RENDER_SCALES.indexOf(value) >= 0
  }
  /** 样式 tuning 里存着的覆盖读成合法值；没有这一项（旧的存档）就是全跟随全局。 */
  function normalizeLyricRenderOverride(raw) {
    var input = raw && typeof raw === 'object' ? raw : {}
    return {
      scale: isLyricRenderScale(input.scale) ? input.scale : 'global',
      antialias: input.antialias === 'on' || input.antialias === 'off' ? input.antialias : 'global'
    }
  }

  // ---------- tuning 归一化（原版 tuning.ts） ----------
  // 存着的值、导入或同步来的值，读成一份完整合法的 tuning：缺的、类型不对的用默认，数值夹进范围。
  // 上游的 defineVisualizerTuning 存储壳（settingsKey/modKeys/merge）由插件的 tuning 体系接手，这里只移植纯函数。

  /** 一组开关：只留认得的、按固定顺序排，一个都没有就用默认。 */
  function subsetOf(choices, value, fallback) {
    var picked = Array.isArray(value) ? choices.filter(function (c) { return value.indexOf(c) >= 0 }) : []
    return picked.length ? picked : fallback.slice()
  }

  /** 早期存的单选（appearMode / fadeMode）换成开关。 */
  var LEGACY_APPEAR = { auto: ['write', 'fade'], write: ['write'], fade: ['fade'] }
  var LEGACY_FADE = { fog: ['fog'], fingers: ['fingers'], mix: ['fog', 'fingers'] }

  /**
   * 分辨率与抗锯齿（#929）。以前雾笺自己有一个分辨率滑块（`resolution`，0.5–2 倍，1 是原样），现在换成了共用的
   * 「跟随全局 / 指定倍数」：存档里有 `render` 就只看它；只有旧的 `resolution`、又不是 1 时，换成最接近的倍数
   * （两边一样近取大的那个，老用户调高是想要更清楚），这样调过的值保留下来；是 1 或没有就跟随全局。
   */
  function readRender(render, legacyResolution) {
    if (render !== undefined) return normalizeLyricRenderOverride(render)
    var override = normalizeLyricRenderOverride(null)
    if (legacyResolution === undefined) return override
    var resolution = numberWithin(legacyResolution, 1, 0.5, 2)
    if (resolution === 1) return override
    var scale = LYRIC_RENDER_SCALES.reduce(function (best, next) {
      return Math.abs(next - resolution) <= Math.abs(best - resolution) ? next : best
    }, LYRIC_RENDER_SCALES[0])
    return { scale: scale, antialias: override.antialias }
  }

  /** 存着的值、导入或同步来的值，读成一份完整合法的 tuning：缺的、类型不对的用默认，数值夹进范围。 */
  function normalizeNebbiaTuning(stored) {
    var values = stored && typeof stored === 'object' ? stored : {}
    var base = DEFAULT_NEBBIA_TUNING
    var numbers = {}
    Object.keys(NEBBIA_LIMITS).forEach(function (key) {
      numbers[key] = numberWithin(values[key], base[key], NEBBIA_LIMITS[key].min, NEBBIA_LIMITS[key].max)
    })
    var appear = values.appear !== undefined ? values.appear : LEGACY_APPEAR[String(values.appearMode)]
    var fade = values.fade !== undefined ? values.fade : LEGACY_FADE[String(values.fadeMode)]
    var behind = NEBBIA_BEHIND.indexOf(values.behind) >= 0 ? values.behind : base.behind
    var tuning = {
      render: readRender(values.render, values.resolution),
      appear: subsetOf(NEBBIA_APPEAR_STYLES, appear, base.appear),
      fade: subsetOf(NEBBIA_FADE_STYLES, fade, base.fade),
      layouts: subsetOf(NEBBIA_LAYOUTS, values.layouts, base.layouts),
      behind: behind,
      // 没存过玻璃（旧的 tuning）时按窗外的默认搭配
      glass: NEBBIA_GLASS.indexOf(values.glass) >= 0 ? values.glass : (NEBBIA_GLASS_FOR[behind] || base.glass),
      // 窗外可以全关：只有没存过（旧的 tuning）才用默认
      scenery: Array.isArray(values.scenery) ? NEBBIA_SCENERY.filter(function (c) { return values.scenery.indexOf(c) >= 0 }) : base.scenery.slice(),
      rain: NEBBIA_RAIN.indexOf(values.rain) >= 0 ? values.rain : base.rain,
      credits: typeof values.credits === 'boolean' ? values.credits : base.credits
    }
    Object.keys(numbers).forEach(function (key) { tuning[key] = numbers[key] })
    return tuning
  }

  // ---------- 主题配色（原版 nebbiaPalette.ts） ----------
  // 主题 → 窗外的夜景配色：天色两档（主题背景压成夜里的深色），三个灯光色（强调色打头，是聚光灯和霓虹的颜色；
  // 另外两个取主题里够鲜艳的颜色，不够就把强调色转色相补上）。都是 0..1 的 RGB。
  // NebbiaPalette = { sky0, sky1, la, lb, lc }，每项是 [r, g, b]（0..1）。

  function rgbOf(color, fallback) {
    var c = color ? ColorMix.parseColorChannels(color) : null
    return c ? [c.r / 255, c.g / 255, c.b / 255] : fallback
  }

  function toHsl(rgb) {
    var r = rgb[0], g = rgb[1], b = rgb[2]
    var max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min
    if (d === 0) return [0, 0, l]
    var s = d / (1 - Math.abs(2 * l - 1))
    var h = max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4
    return [h / 6, s, l]
  }
  function fromHsl(hsl) {
    var h = hsl[0], s = hsl[1], l = hsl[2]
    var k = function (n) { return (n + h * 12) % 12 }
    var a = s * Math.min(l, 1 - l)
    var f = function (n) { return l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1)) }
    return [f(0), f(8), f(4)]
  }

  // 灯要亮、要有颜色：饱和度和亮度都抬到夜景里看得见的范围
  function asLight(rgb) {
    var hsl = toHsl(rgb)
    return fromHsl([hsl[0], Math.max(0.55, hsl[1]), Math.min(0.78, Math.max(0.6, hsl[2]))])
  }
  function asSky(rgb, lightness) {
    var hsl = toHsl(rgb)
    return fromHsl([hsl[0], Math.min(0.55, hsl[1]), lightness])
  }

  /** theme 是插件的主题对象（accentColor/backgroundColor/secondaryColor/primaryColor/wordColors 与上游同名同形）。 */
  function resolveNebbiaPalette(theme) {
    var accent = rgbOf(theme.accentColor, [1, 0.81, 0.54])
    var bg = rgbOf(theme.backgroundColor, [0.04, 0.06, 0.09])
    var vivid = [theme.secondaryColor, theme.primaryColor].concat((theme.wordColors || []).map(function (w) { return w.color }))
      .map(function (c) { return rgbOf(c, [0, 0, 0]) })
      .filter(function (c) { var h = toHsl(c); return h[1] > 0.3 && h[2] > 0.25 && h[2] < 0.9 })
    var ah = toHsl(accent)[0], as = toHsl(accent)[1], al = toHsl(accent)[2]
    var lb = vivid[0] || fromHsl([(ah + 0.55) % 1, as, al])
    var lc = vivid[1] || fromHsl([(ah + 0.9) % 1, as, al])
    return {
      sky0: asSky(bg, 0.05),
      sky1: asSky(bg.map(function (v, i) { return v * 0.7 + accent[i] * 0.3 }), 0.14),
      la: asLight(accent),
      lb: asLight(lb),
      lc: asLight(lc)
    }
  }

  // ---------- 窗外时钟（原版 nebbiaSceneClock.ts） ----------
  // 窗外的时钟：播放时按真实时间匀速走，暂停时停。着色器里是 float32：
  // 走过 SCENE_RESET 秒后，换歌时归零，跳变藏在换歌里；一首歌连着放满 SCENE_WRAP 秒才硬回绕一次，
  // 那时窗外雨丝的精度约一像素（1080p）。

  var SCENE_RESET = 1000
  var SCENE_WRAP = 3600

  function NebbiaSceneClock() {
    this.time = 0
    this._last = 0
  }

  /** 走一帧，返回这一帧的 dt（暂停时 0，最多 0.1 秒）。`now` 是秒。 */
  NebbiaSceneClock.prototype.tick = function (now, paused) {
    var dt = paused ? 0 : clamp(now - this._last, 0, 0.1)
    this.time = (this.time + dt) % SCENE_WRAP
    this._last = now
    return dt
  }

  NebbiaSceneClock.prototype.songChanged = function () {
    if (this.time > SCENE_RESET) this.time = 0
  }

  // ---------- 窗外是什么（原版 nebbiaBehind.ts，按插件形态适配） ----------
  // 雾笺窗外是什么：自己画的雨夜街景，或者共用背景。设置里选了共用背景，或者播放页透明（共用背景卸掉、透出桌面）时，
  // 雾笺不画窗外，画布带透明通道（nebbia-gl.js 的 seeThrough）。
  // 上游经 tuning 包（nebbiaTuning.read(bundle)）取值；插件的 tuning 在 create 时已归一化，这里直接收 tuning 对象。
  // 「舞潮踏拍」的动效 id（上游 services/beatFx/beatEffects.ts 的 BEAT_EFFECT_IDS）。

  var NEBBIA_BEAT_AQUA_BEAT = 'nebbia.aquaBeat'
  var NEBBIA_BEAT_DRIZZLE_RIDE = 'nebbia.drizzleRide'

  /**
   * 雾笺这一帧要不要透出后面：tuning 选了共用背景，或者播放页透明。样式小图也把背景标成透明
   * 来表示「不画背景」，预览里不算播放页透明，小图照样是街景。background 是 { mode, transparent } 简化形态。
   */
  function nebbiaSeesThrough(tuning, background, isPreview) {
    if (isPreview === undefined) isPreview = false
    return tuning.behind === 'backdrop' || (!isPreview && Boolean(background && background.transparent))
  }

  /**
   * 交给外壳的 background：透出后面时照常画共用背景，画街景时不要（标成透明，背景层就什么都不画）。
   * 上游收整个外壳 props（isPreviewMode）；插件收归一化的 tuning + config.previewMode。
   */
  function nebbiaBackgroundConfig(tuning, background, isPreview) {
    return nebbiaSeesThrough(tuning, background, isPreview)
      ? background
      : Object.assign({}, background, { transparent: true })
  }

  /** 外壳的 showsBackground：不算播放页透明（外壳自己算），只看窗外选没选共用背景。 */
  function nebbiaShowsBackground(tuning) {
    return nebbiaSeesThrough(tuning, undefined)
  }

  /**
   * 外壳的 beatEffectOnScreen：「舞潮踏拍」只在窗外选水族箱时算（选了共用背景时窗外不画）；
   * 「疏雨轻车」的雨打在雨窗玻璃上、车只在不画水族箱时颠：画水族箱又是凝露玻璃时两样都没有，不算（不为它分离音轨）；
   * 播放页透明时透出后面，水珠里折射的还是选的窗外（水族箱照样算），所以不看页面透不透明。
   */
  function nebbiaBeatEffectOnScreen(effectId, tuning) {
    var aquarium = tuning.behind === 'aquarium'
    if (effectId === NEBBIA_BEAT_AQUA_BEAT) return aquarium
    if (effectId === NEBBIA_BEAT_DRIZZLE_RIDE) return !aquarium || tuning.glass === 'rain'
    return true
  }

  // ---------- 主题字体栈与字重（与 machi 同款） ----------
  // 歌词层（nebbia-layout 等下一批模块）画字用的字体栈与字重：跟随宿主主题
  // （foliaGetLyricFontWeight 提供全局字重覆盖，foliaBridgeFontStack 提供宿主字体栈，theme.fontFamilyStack 兜底）。

  function nebbiaThemeFontStack(theme) {
    var stack = []
    if (theme.fontFamilyStack && theme.fontFamilyStack.length) stack = stack.concat(theme.fontFamilyStack)
    if (theme.fontFamily) stack.push(theme.fontFamily)
    if (theme.fontStyle === 'serif') stack.push('serif')
    else if (theme.fontStyle === 'mono') stack.push('monospace')
    else stack.push('sans-serif')
    if (typeof window.foliaBridgeFontStack === 'function') {
      var host = window.foliaBridgeFontStack(theme)
      if (host) return host
    }
    return stack.join(', ')
  }

  function nebbiaThemeFontWeight(theme, fallback) {
    if (typeof window.foliaGetLyricFontWeight === 'function') return window.foliaGetLyricFontWeight(fallback || 700)
    return theme.fontWeight || fallback || 700
  }

  window.FoliaNebbiaCore = {
    NEBBIA_FIXED: NEBBIA_FIXED,
    MASK_SCALE: MASK_SCALE,
    FOG_DIV: FOG_DIV,
    clamp: clamp,
    smooth: smooth,
    NEBBIA_APPEAR_STYLES: NEBBIA_APPEAR_STYLES,
    NEBBIA_FADE_STYLES: NEBBIA_FADE_STYLES,
    NEBBIA_LAYOUTS: NEBBIA_LAYOUTS,
    NEBBIA_SCENERY: NEBBIA_SCENERY,
    NEBBIA_RAIN: NEBBIA_RAIN,
    NEBBIA_BEHIND: NEBBIA_BEHIND,
    NEBBIA_GLASS: NEBBIA_GLASS,
    NEBBIA_GLASS_FOR: NEBBIA_GLASS_FOR,
    NEBBIA_MAX_JELLIES: NEBBIA_MAX_JELLIES,
    NEBBIA_MAX_BURSTS: NEBBIA_MAX_BURSTS,
    NEBBIA_LIMITS: NEBBIA_LIMITS,
    DEFAULT_NEBBIA_TUNING: DEFAULT_NEBBIA_TUNING,
    numberWithin: numberWithin,
    normalizeLyricRenderOverride: normalizeLyricRenderOverride,
    normalizeNebbiaTuning: normalizeNebbiaTuning,
    resolveNebbiaPalette: resolveNebbiaPalette,
    SCENE_RESET: SCENE_RESET,
    SCENE_WRAP: SCENE_WRAP,
    NebbiaSceneClock: NebbiaSceneClock,
    nebbiaSeesThrough: nebbiaSeesThrough,
    nebbiaBackgroundConfig: nebbiaBackgroundConfig,
    nebbiaShowsBackground: nebbiaShowsBackground,
    nebbiaBeatEffectOnScreen: nebbiaBeatEffectOnScreen,
    nebbiaThemeFontStack: nebbiaThemeFontStack,
    nebbiaThemeFontWeight: nebbiaThemeFontWeight
  }
})()
