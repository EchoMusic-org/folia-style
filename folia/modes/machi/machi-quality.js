// 画质设置 → 实际用的渲染参数（移植自 engine/quality.ts，纯函数）。
// 插件没有全局歌词画布挡位：「跟随全局」按全局默认值（1 倍、抗锯齿关）解释。
// 自动降级：帧时长期偏高时在用户那套设置上按固定顺序一格格往下压（超采样 → MSAA → 辉光 → 倒影 → 景深 → 分辨率 →
// 后期抗锯齿 → 阴影），只会比用户选的低，不会高。
(function () {
  'use strict'

  /** 插件无全局挡位：固定默认（分辨率 1 倍、抗锯齿关）与像素比上限。 */
  var DEFAULT_GLOBAL_QUALITY = { scale: 1, antialias: 'off' }
  var MAX_LYRIC_PIXEL_RATIO = 3

  var SHADOW_MAP_SIZES = { off: 0, low: 1024, high: 2048 }
  var REFLECTION_SCALES = { off: 0, low: 0.3, high: 0.5 }
  var MAX_DEVICE_RATIO = 2
  var SUPERSAMPLE = 2
  var PREVIEW_PIXEL_RATIO = 1
  var SMAA_SAMPLES = 4

  var LEVEL_DOWN = { high: 'low', low: 'off', off: 'off' }
  var POST_AA_DOWN = { smaa: 'fxaa', fxaa: 'off' }
  var SCALE_DOWN = { 1: 0.75, 0.75: 0.5 }

  /** 降级的一格：把一项往下压一档；已经最低时返回 null（这格跳过）。 */
  var DEGRADE_STEPS = [
    function (s) {
      if (s.antialias === 'ssaa') return { antialias: 'smaa', msaa: true, shadows: s.shadows, reflections: s.reflections, glow: s.glow, dof: s.dof, renderScale: s.renderScale }
      return s.renderScale > 1 ? { antialias: s.antialias, msaa: s.msaa, shadows: s.shadows, reflections: s.reflections, glow: s.glow, dof: s.dof, renderScale: 1 } : null
    },
    function (s) { return s.antialias === 'smaa' && s.msaa ? { antialias: s.antialias, msaa: false, shadows: s.shadows, reflections: s.reflections, glow: s.glow, dof: s.dof, renderScale: s.renderScale } : null },
    function (s) { return s.glow ? { antialias: s.antialias, msaa: s.msaa, shadows: s.shadows, reflections: s.reflections, glow: false, dof: s.dof, renderScale: s.renderScale } : null },
    function (s) { return s.reflections !== 'off' ? { antialias: s.antialias, msaa: s.msaa, shadows: s.shadows, reflections: LEVEL_DOWN[s.reflections], glow: s.glow, dof: s.dof, renderScale: s.renderScale } : null },
    function (s) { return s.dof ? { antialias: s.antialias, msaa: s.msaa, shadows: s.shadows, reflections: s.reflections, glow: s.glow, dof: false, renderScale: s.renderScale } : null },
    function (s) {
      var lower = SCALE_DOWN[s.renderScale]
      return lower ? { antialias: s.antialias, msaa: s.msaa, shadows: s.shadows, reflections: s.reflections, glow: s.glow, dof: s.dof, renderScale: lower } : null
    },
    function (s) {
      var lower = POST_AA_DOWN[s.antialias]
      return lower ? { antialias: lower, msaa: s.msaa, shadows: s.shadows, reflections: s.reflections, glow: s.glow, dof: s.dof, renderScale: s.renderScale } : null
    },
    function (s) { return s.shadows !== 'off' ? { antialias: s.antialias, msaa: s.msaa, shadows: LEVEL_DOWN[s.shadows], reflections: s.reflections, glow: s.glow, dof: s.dof, renderScale: s.renderScale } : null }
  ]

  var DEGRADE_MAX_FRAME_MS = 21
  var DEGRADE_MIN_FRAME_MS = 1000 / 90
  var DEGRADE_SLACK = 1.33
  var DEGRADE_SLOW_CHECKS = 2
  var DEGRADE_RELIEF = 0.95
  var DEGRADE_STEADY = 1.2

  function createMachiDegradeState() {
    return { refresh: 0, slowChecks: 0, degradedAverage: 0, displayFloor: 0 }
  }

  /** 帧时门槛（毫秒）：一帧应有的间隔 ×1.33，不低于 90fps 帧时，不超过 21 毫秒。 */
  function resolveMachiDegradeThreshold(refresh) {
    return refresh > 0 ? Math.min(DEGRADE_MAX_FRAME_MS, Math.max(DEGRADE_MIN_FRAME_MS, refresh * DEGRADE_SLACK)) : DEGRADE_MAX_FRAME_MS
  }

  /** 自动降级的一次检查（纯函数）：intervals 是这段时间的帧间隔。 */
  function stepMachiDegrade(state, intervals) {
    var sorted = intervals.slice().sort(function (a, b) { return a - b })
    var fast = sorted.length ? sorted[Math.floor(sorted.length * 0.1)] : 0
    var slow = sorted.length ? sorted[Math.floor(sorted.length * 0.9)] : 0
    var sum = 0
    intervals.forEach(function (value) { sum += value })
    var average = sum / Math.max(1, intervals.length)
    var displayLimited = state.degradedAverage > 0 && average >= state.degradedAverage * DEGRADE_RELIEF && slow <= fast * DEGRADE_STEADY
    var displayFloor = displayLimited ? fast : state.displayFloor
    var learned = state.refresh > 0 && !displayLimited ? Math.min(state.refresh, fast) : fast
    var refresh = Math.max(learned, displayFloor)
    var threshold = resolveMachiDegradeThreshold(refresh)
    if (average <= threshold) return { state: { refresh: refresh, slowChecks: 0, degradedAverage: 0, displayFloor: displayFloor }, degrade: false, average: average, threshold: threshold }
    var slowChecks = state.slowChecks + 1
    if (slowChecks < DEGRADE_SLOW_CHECKS) return { state: { refresh: refresh, slowChecks: slowChecks, degradedAverage: 0, displayFloor: displayFloor }, degrade: false, average: average, threshold: threshold }
    return { state: { refresh: refresh, slowChecks: 0, degradedAverage: average, displayFloor: displayFloor }, degrade: true, average: average, threshold: threshold }
  }

  /** 把「跟随全局」换成具体值。 */
  function settle(quality, global) {
    return {
      renderScale: quality.renderScale === 'global' ? (global.scale || 1) : quality.renderScale,
      antialias: quality.antialias === 'global' ? (global.antialias === 'off' ? 'off' : 'smaa') : quality.antialias,
      msaa: true,
      shadows: quality.shadows,
      reflections: quality.reflections,
      glow: quality.glow,
      dof: true
    }
  }

  /**
   * quality + 降级格数 → 实际渲染参数。
   * options: { degrade, devicePixelRatio, previewMode, global? }
   */
  function resolveMachiRenderQuality(quality, options) {
    var globalQuality = options.global || DEFAULT_GLOBAL_QUALITY
    // 预览不跟全局挡位：跟随全局的两项按全局默认值（1 倍、抗锯齿关）算。
    var settled = settle(quality, options.previewMode ? DEFAULT_GLOBAL_QUALITY : globalQuality)
    var wanted = quality.adaptive && !options.previewMode ? Math.max(0, Math.floor(options.degrade)) : 0
    var degrade = 0
    // 按顺序转圈，压不动的格跳过；整整一圈都压不动就到底了。
    for (var index = 0, idle = 0; degrade < wanted && idle < DEGRADE_STEPS.length; index += 1) {
      var next = DEGRADE_STEPS[index % DEGRADE_STEPS.length](settled)
      if (next) { settled = next; degrade += 1; idle = 0 } else idle += 1
    }
    var antialias = settled.antialias
    var shadows = settled.shadows
    var glow = settled.glow
    var renderScale = settled.renderScale
    if (options.previewMode) {
      if (antialias === 'ssaa') antialias = 'smaa'
      if (shadows === 'high') shadows = 'low'
      glow = false
      renderScale = 1
    }
    var device = Math.min(Math.max(1, options.devicePixelRatio || 1), MAX_DEVICE_RATIO)
    // 不超采样时的内部像素比（墨线的取样步长按它算）；倍数大于 1 是超采样。
    var base = options.previewMode ? PREVIEW_PIXEL_RATIO : device * Math.min(1, renderScale)
    var scaled = renderScale > 1 ? Math.max(base, Math.min(base * renderScale, MAX_LYRIC_PIXEL_RATIO)) : base
    var pixelRatio = antialias === 'ssaa' ? Math.max(scaled, Math.min(scaled * SUPERSAMPLE, MAX_LYRIC_PIXEL_RATIO)) : scaled
    return {
      pixelRatio: pixelRatio,
      samples: antialias === 'smaa' && settled.msaa && !options.previewMode ? SMAA_SAMPLES : 0,
      postAA: antialias === 'fxaa' ? 'fxaa' : (antialias === 'smaa' ? 'smaa' : 'none'),
      inkScale: pixelRatio / base,
      shadowMapSize: SHADOW_MAP_SIZES[shadows],
      reflectionScale: REFLECTION_SCALES[settled.reflections],
      bloom: glow,
      streaks: glow,
      dof: settled.dof,
      antialias: antialias,
      renderScale: renderScale,
      degrade: degrade
    }
  }

  window.FoliaMachiQuality = {
    resolveMachiRenderQuality: resolveMachiRenderQuality,
    createMachiDegradeState: createMachiDegradeState,
    stepMachiDegrade: stepMachiDegrade,
    resolveMachiDegradeThreshold: resolveMachiDegradeThreshold,
    DEFAULT_GLOBAL_QUALITY: DEFAULT_GLOBAL_QUALITY
  }
})()
