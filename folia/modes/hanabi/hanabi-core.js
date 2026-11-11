// 花火（hanabi）核心模块：移植自 folia-major src/components/visualizer/hanabi/
//   hanabiKernel.ts（lumisynth 内核契约的最小子集：纯类型约定，无运行时代码，注释保留在段首）
//   types.ts（HANABI_PACK_ID + DEFAULT_HANABI_TUNING；其余为接口/类型，无运行时形态）
//   hanabiRandom.ts（确定性随机流 = visualizerSeedHash 的 mulberry32，插件由 runtime/seed-hash.js 提供）
//   hanabiTuning.ts（tuning 归一化、每帧/重建字段分类、画质档）+ tuningDefinition.ts 的 numberWithin
//   utils/lyricRenderQuality.ts 的 normalizeLyricRenderOverride（插件暂无对应共享模块，内联在此）
// 全部为纯函数/常量，被后续模块按 window.FoliaHanabiCore 引用。
(function () {
  'use strict'

  var SeedHash = window.FoliaSeedHash

  // ---------- 内核契约（原版 hanabiKernel.ts） ----------
  // 花火原本依赖的 lumisynth 内核 / 风格包契约类型的最小子集：mood、运镜变换、片尾卡帧、歌曲信息。
  // folia 里没有内核，这些只是花火自己的场景、编译与片尾卡之间的约定；运行时（createHanabiPixiRuntime）按这里的含义去用。
  // Mood = 'quiet' | 'neutral' | 'loud'：预设的情绪（编译时按段落性质挑），以字符串字面量使用。
  // TransformParams = { x, y, pivotX, pivotY, scale, rotation }：容器的变换参数（与 Pixi 相同的含义：先减 pivot，再缩放、旋转，最后移到 position）。
  // SongMetadata = { title, artist, album }：片尾卡要显示的歌曲信息。
  // CreditsFrame = { active, lyricAlpha, lyricBlur, posterAlpha, posterOffsetY, posterScale }：片尾卡的时间线帧。

  // ---------- 类型常量与默认 tuning（原版 types.ts） ----------
  /** 风格包 id。 */
  var HANABI_PACK_ID = 'hanabi'

  /**
   * 默认 tuning（各字段含义，见上游 HanabiTuning 接口）：
   * render 分辨率与抗锯齿覆盖（#929），默认跟随「动画与性能」里的全局挡位；
   * colorMode 配色：跟随主题 / 预设自带的鲜艳配色 / 两者混合；
   * sparkAmount 烟花粒子数量倍率 0..2；ornamentAmount MG 装饰件数量倍率 0..2；textMotion 文字动作幅度 0..2；
   * blockOpacity 字底色块不透明度 0..1；riseSpeed 上升速度倍率 0..2（0 = 不上升，镜头原地切换）；
   * spin 旋转倍率 0..2：整个世界一直在转，镜头内约 11°/秒，镜头边界随上升再甩 34°–80°（都是 1 时），段落转场也带着转；0 = 不转；
   * ambient 环境粒子（远处星点、火星、远方小烟花）0..2；glow 辉光（烟花与火花的 bloom）0..2；
   * bloom 整体辉光：整个画面（不含夜空底）常驻的全屏 bloom 0..2；0 = 没有；
   * chorusBloom 副歌辉光：副歌时段全屏 bloom 平滑亮起来的强度 0..2；0 = 副歌不亮；
   * launches 升空尾迹开关；overlayFrame 画框装饰（角标、竖排小字）开关；
   * textOnly 仅显示歌词文字：烟花、装饰件、拼贴与夜空都不画；
   * sky 夜空底（运行时铺在所有场景之下的渐变）的不透明度 0..1；0 = 直接画在共享背景上；
   * collage PV 拼贴装饰（跑马灯色带、重复字、贴纸、胶带、拟声字）数量倍率 0..2；
   * renderQuality 画质：均衡 / 省电降低烟花辉光的分辨率（字与全屏辉光仍按满分辨率），省电再少画一些环境粒子。
   */
  var DEFAULT_HANABI_TUNING = {
    render: { scale: 'global', antialias: 'global' },
    colorMode: 'mixed',
    sparkAmount: 1,
    ornamentAmount: 1,
    textMotion: 1,
    blockOpacity: 1,
    riseSpeed: 1,
    spin: 1,
    ambient: 1,
    glow: 1,
    bloom: 0.8,
    chorusBloom: 1.3,
    launches: true,
    overlayFrame: true,
    textOnly: false,
    sky: 0.85,
    collage: 1,
    renderQuality: 'full'
  }

  // ---------- 确定性随机（原版 hanabiRandom.ts） ----------
  // 花火的确定性随机数：按 key 播种的流（visualizerSeedHash 的 mulberry32）。编译、烟花事件、装饰件、逐字动画的
  // 随机量全部从这里取，每帧画面只由时间决定——seek、重建、预热都不会改变画面。
  var createRng = SeedHash.createVisualizerRng

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

  // ---------- tuning 归一化与运行时分类（原版 hanabiTuning.ts） ----------
  // 花火 tuning 的归一化与运行时分类：存档、导入、同步、滑块拖动都经 normalizeHanabiTuning 补齐字段、钳住范围；
  // 运行时按 HANABI_LIVE_KEYS 区分「每帧现读、改了立刻生效」与「烘焙进场景、改了要重建」的字段。
  // 画质档的数值也在这里（纯函数，运行时与单测共用）。

  /** 屏幕密度最多按 2 倍算：烟花是成千上万的小精灵，3 倍屏上满分辨率只换来更贵的填充。 */
  var MAX_BASE_RESOLUTION = 2

  /** 花火自己的像素密度（分辨率倍数为 1 时就是它，和没有这个设置时一样）；字形图集按渲染倍率除以它算出超采样倍数。 */
  function resolveHanabiBaseResolution(devicePixelRatio) {
    return Math.min(MAX_BASE_RESOLUTION, Math.max(1, devicePixelRatio || 1))
  }

  var COLOR_MODES = ['theme', 'vivid', 'mixed']
  var RENDER_QUALITIES = ['full', 'balanced', 'low']

  /** 任何存下来的值 → 完整、合法的 tuning（缺字段走默认，越界钳住）。 */
  function normalizeHanabiTuning(raw) {
    var patch = raw && typeof raw === 'object' ? raw : {}
    var input = {}
    Object.keys(DEFAULT_HANABI_TUNING).forEach(function (key) { input[key] = DEFAULT_HANABI_TUNING[key] })
    Object.keys(patch).forEach(function (key) { input[key] = patch[key] })
    var d = DEFAULT_HANABI_TUNING
    return {
      render: normalizeLyricRenderOverride(input.render),
      colorMode: COLOR_MODES.indexOf(input.colorMode) >= 0 ? input.colorMode : d.colorMode,
      sparkAmount: numberWithin(input.sparkAmount, d.sparkAmount, 0, 2),
      ornamentAmount: numberWithin(input.ornamentAmount, d.ornamentAmount, 0, 2),
      textMotion: numberWithin(input.textMotion, d.textMotion, 0, 2),
      blockOpacity: numberWithin(input.blockOpacity, d.blockOpacity, 0, 1),
      riseSpeed: numberWithin(input.riseSpeed, d.riseSpeed, 0, 2),
      spin: numberWithin(input.spin, d.spin, 0, 2),
      ambient: numberWithin(input.ambient, d.ambient, 0, 2),
      glow: numberWithin(input.glow, d.glow, 0, 2),
      bloom: numberWithin(input.bloom, d.bloom, 0, 2),
      chorusBloom: numberWithin(input.chorusBloom, d.chorusBloom, 0, 2),
      launches: input.launches !== false,
      overlayFrame: input.overlayFrame !== false,
      textOnly: input.textOnly === true,
      sky: numberWithin(input.sky, d.sky, 0, 1),
      collage: numberWithin(input.collage, d.collage, 0, 2),
      renderQuality: RENDER_QUALITIES.indexOf(input.renderQuality) >= 0 ? input.renderQuality : d.renderQuality
    }
  }

  /**
   * 每帧现读、改了不用重建场景的字段（夜空、全屏辉光）；画框另由 HANABI_OVERLAY_KEYS 决定是否重画。
   * render（分辨率 / 抗锯齿）不经 setTuning：外壳把合出来的倍数和抗锯齿另外推给运行时，而且每次归一化都是新对象，按引用比会次次重建。
   */
  var HANABI_LIVE_KEYS = ['render', 'sky', 'overlayFrame', 'bloom', 'chorusBloom']
  /** 改了要重画画框的字段。 */
  var HANABI_OVERLAY_KEYS = ['overlayFrame', 'colorMode', 'textOnly']

  /** 两份 tuning 之间有没有烘焙进场景的字段变了（变了就防抖重建场景与片尾卡）。 */
  function requiresHanabiSceneRebuild(previous, next) {
    return Object.keys(next).some(function (key) {
      return HANABI_LIVE_KEYS.indexOf(key) < 0 && previous[key] !== next[key]
    })
  }

  function changedHanabiKeys(previous, next, keys) {
    return keys.some(function (key) { return previous[key] !== next[key] })
  }

  // ─── 画质档 ────────────────────────────────────────────────────────────
  // 只动开销最大、又最不怕软的那一块：每个镜头烟花层上的辉光（离屏画一遍烟花，再走一条整条降采样链）。
  // 烟花本来就是柔光，降分辨率几乎看不出来；字、色块、拼贴和全屏辉光仍按满分辨率合成，歌词保持清晰。

  /**
   * - full：与屏幕同分辨率（默认，画面与没有画质档时完全一样）。
   * - balanced：烟花辉光每轴 0.7（像素约 49%），辉光少降一级，宽度不变。
   * - low（省电）：烟花辉光每轴 0.5（像素 25%），环境粒子 ×0.6。
   * glowScale：烟花辉光相对渲染分辨率的倍率（按轴），像素数是它的平方；
   * ambientScale：环境粒子（星点、火星、远方小烟花）数量倍率（乘在用户设置上）。
   */
  var HANABI_QUALITY_PROFILES = {
    full: { glowScale: 1, ambientScale: 1 },
    balanced: { glowScale: 0.7, ambientScale: 1 },
    low: { glowScale: 0.5, ambientScale: 0.6 }
  }

  /** 烟花辉光的 filter 分辨率：满画质时就是渲染分辨率；降档时乘倍率，再按 Pixi 纹理池的 2 的幂分桶往下吸附。 */
  function resolveHanabiGlowResolution(width, height, renderResolution, quality) {
    var profile = HANABI_QUALITY_PROFILES[quality] || HANABI_QUALITY_PROFILES.full
    if (profile.glowScale >= 1) return renderResolution
    var target = renderResolution * profile.glowScale
    // 纹理池吸附在 hanabi-bloom.js（pixiTextureBudget，下一批）里；它没加载时直接用未吸附的值。
    return window.FoliaHanabiBloom && window.FoliaHanabiBloom.snapResolutionToTexturePool
      ? window.FoliaHanabiBloom.snapResolutionToTexturePool(width, height, target)
      : target
  }

  /** 输入已经降了 2^k 倍，bloom 就少降 k 级：最小一级的纹素（决定辉光多宽）才和满画质一样大。 */
  function resolveHanabiGlowLevelDrop(renderResolution, glowResolution) {
    return glowResolution > 0 && glowResolution < renderResolution
      ? Math.max(0, Math.round(Math.log2(renderResolution / glowResolution)))
      : 0
  }

  /** 烟花辉光 filter 的画质参数（mg/glow.ts 的 HanabiGlowQuality）：满画质时 resolution 为 null，跟渲染分辨率。 */
  function resolveHanabiGlowQuality(width, height, renderResolution, quality) {
    var resolution = resolveHanabiGlowResolution(width, height, renderResolution, quality)
    return {
      resolution: resolution < renderResolution ? resolution : null,
      levelDrop: resolveHanabiGlowLevelDrop(renderResolution, resolution)
    }
  }

  window.FoliaHanabiCore = {
    HANABI_PACK_ID: HANABI_PACK_ID,
    DEFAULT_HANABI_TUNING: DEFAULT_HANABI_TUNING,
    createRng: createRng,
    numberWithin: numberWithin,
    normalizeLyricRenderOverride: normalizeLyricRenderOverride,
    resolveHanabiBaseResolution: resolveHanabiBaseResolution,
    normalizeHanabiTuning: normalizeHanabiTuning,
    HANABI_LIVE_KEYS: HANABI_LIVE_KEYS,
    HANABI_OVERLAY_KEYS: HANABI_OVERLAY_KEYS,
    requiresHanabiSceneRebuild: requiresHanabiSceneRebuild,
    changedHanabiKeys: changedHanabiKeys,
    HANABI_QUALITY_PROFILES: HANABI_QUALITY_PROFILES,
    resolveHanabiGlowResolution: resolveHanabiGlowResolution,
    resolveHanabiGlowLevelDrop: resolveHanabiGlowLevelDrop,
    resolveHanabiGlowQuality: resolveHanabiGlowQuality
  }
})()
