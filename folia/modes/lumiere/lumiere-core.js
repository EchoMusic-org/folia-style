// 绘光模式·基础模块：移植自 folia-major src/components/visualizer/lumiere/
//   lumiereRandom.ts（确定性 mulberry32 随机流）
//   color.ts（0..1 线性 RGB 色板工具）
//   types.ts 的运行时常量（DEFAULT_LUMIERE_SCENE_TUNING / LUMIERE_BLOOM；interface 全部为编译期类型，不转写）
//   src/types.ts 的 DEFAULT_LUMIERE_TUNING（用户可见 tuning 默认值，内联）
// 全部为纯函数/常量，被后续模块按 window.FoliaLumiereCore 引用。
(function () {
  'use strict'

  var ColorMix = window.FoliaColorMix

  // ---------- 确定性随机（原版 lumiereRandom.ts） ----------
  // 按 key 播种的 mulberry32 流（key 先经 FNV-1a 散列）。场景构建与编译里的随机量
  // 全部从这里取，同一首歌同一个种子永远得到同一帧——seek、重建、预热都不会改变画面。
  function hashKey(key) {
    var hash = 0x811c9dc5
    for (var i = 0; i < key.length; i += 1) {
      hash ^= key.charCodeAt(i)
      hash = Math.imul(hash, 16777619)
    }
    return hash >>> 0
  }

  // mulberry32：32 位状态，周期 2^32，对装饰用的随机足够。数字种子直接当状态，字符串种子先散列。
  function createRng(seed) {
    var state = typeof seed === 'number' ? seed >>> 0 : hashKey(seed)
    return function () {
      state = (state + 0x6d2b79f5) | 0
      var t = Math.imul(state ^ (state >>> 15), 1 | state)
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
  }

  // 与 createRng(seed) 同一条流，但从第 skip 个值之后开始：mulberry32 每取一次状态加一个常数，跳过是 O(1)。
  // 歌词窗口按需构建某一行时用它直接跳到这一行的起点，拿到的值与从头顺序取完全一样。
  function createRngAt(seed, skip) {
    var state = typeof seed === 'number' ? seed >>> 0 : hashKey(seed)
    return createRng((state + Math.imul(skip, 0x6d2b79f5)) >>> 0)
  }

  // ---------- 颜色工具（原版 color.ts） ----------
  // 绘光的颜色都在 0..1 的线性小数组上算，给 Pixi 时转成 0xRRGGBB。
  function rgbOf(color, fallback) {
    if (fallback === undefined) fallback = [1, 1, 1]
    var channels = ColorMix.parseColorChannels(color)
    return channels ? [channels.r / 255, channels.g / 255, channels.b / 255] : fallback
  }

  function mixRgb(a, b, amount) {
    return [
      a[0] + (b[0] - a[0]) * amount,
      a[1] + (b[1] - a[1]) * amount,
      a[2] + (b[2] - a[2]) * amount
    ]
  }

  function scaleRgb(a, k) {
    return [a[0] * k, a[1] * k, a[2] * k]
  }

  function hexOf(rgb) {
    var c = function (v) { return Math.round(Math.min(1, Math.max(0, v)) * 255) }
    return (c(rgb[0]) << 16) | (c(rgb[1]) << 8) | c(rgb[2])
  }

  function luminance(rgb) {
    return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]
  }

  var WHITE = [1, 1, 1]
  // 参考图的香槟金。
  var CHAMPAGNE = [1, 0.86, 0.62]

  // ---------- 场景 tuning（原版 types.ts 的 DEFAULT_LUMIERE_SCENE_TUNING） ----------
  // 场景直接读的参数；用户可见的 LumiereTuning 由运行时映射过来（resolveLumiereSceneTuning）。
  var DEFAULT_LUMIERE_SCENE_TUNING = {
    lightIntensity: 1,
    audioResponse: 1,
    fogDensity: 1,
    darkField: 0.75,
    moteAmount: 1,
    bloom: 1,
    textBloom: 1,
    unlitOpacity: 0.22,
    windowNeighbors: 2,
    decay: 1,
    echo: 1,
    fogOctaves: 5,
    lineArt: true,
    frontBokeh: true,
    overlayFrame: true,
    trails: false,
    textOnly: false,
    keywordColors: true,
    themeIcons: true,
    themeColorMix: 0.3
  }

  // ---------- bloom 预设（原版 types.ts 的 LUMIERE_BLOOM） ----------
  // 图形组阈值高一些：只让光源与光柱芯发晕，光柱本身不再被抬亮，文字在光里才压得住。
  // 文字组：原来的 1.9 × 调试时试出的 0.6（可读性最好）。
  var LUMIERE_BLOOM = {
    graphics: { strength: 1.5, threshold: 0.42, knee: 0.3, levels: 6, spread: 0.9 },
    text: { strength: 1.15, threshold: 0.12, knee: 0.2, levels: 5, spread: 0.95 }
  }

  // ---------- 用户 tuning 默认值（内联自 folia-major src/types.ts 的 DEFAULT_LUMIERE_TUNING） ----------
  var DEFAULT_LUMIERE_TUNING = {
    lightIntensity: 1,
    audioResponse: 1,
    fogDensity: 1,
    darkField: 0.75,
    moteAmount: 1,
    bloom: 1,
    textBloom: 1,
    unlitOpacity: 0.22,
    windowNeighbors: 2,
    decay: 1,
    echo: 1,
    fogOctaves: 5,
    lineArt: true,
    frontBokeh: true,
    trails: true,
    seamlessTransitions: true,
    overlayFrame: true,
    textOnly: false,
    keywordColors: true,
    themeIcons: true,
    themeColorMix: 0.3,
    renderQuality: 'full'
  }

  window.FoliaLumiereCore = {
    createRng: createRng,
    createRngAt: createRngAt,
    rgbOf: rgbOf,
    mixRgb: mixRgb,
    scaleRgb: scaleRgb,
    hexOf: hexOf,
    luminance: luminance,
    WHITE: WHITE,
    CHAMPAGNE: CHAMPAGNE,
    DEFAULT_LUMIERE_SCENE_TUNING: DEFAULT_LUMIERE_SCENE_TUNING,
    LUMIERE_BLOOM: LUMIERE_BLOOM,
    DEFAULT_LUMIERE_TUNING: DEFAULT_LUMIERE_TUNING
  }
})()
