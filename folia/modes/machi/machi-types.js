// 町景（machi）tuning 类型与归一化（移植自 folia-major machi/types.ts + machiTuning.ts）：
// 场景/时间/天气（均可“自动”）、镜头（默认构图或自定义视角，每场景一份）、景深、画质。
// 归一化负责补齐字段、认不得的值回默认；“自动”场景按 seed 选也在这里（纯函数）。
(function () {
  'use strict'

  var Clamp = window.FoliaThemeColorMath
  var SeedHash = window.FoliaSeedHash

  // ===== 枚举 =====
  var MACHI_SCENE_IDS = ['konbini', 'station', 'kowloon']
  var MACHI_TIMES_OF_DAY = ['auto', 'day', 'dusk', 'night']
  var MACHI_WEATHERS = ['auto', 'clear', 'rain', 'snow', 'fog']
  var MACHI_CAMERA_MODES = ['default', 'custom']
  var MACHI_FOCUS_MODES = ['center', 'lyrics', 'manual']
  var MACHI_RENDER_SCALES = [1, 0.75, 0.5]
  var MACHI_ANTIALIAS_MODES = ['off', 'fxaa', 'smaa', 'ssaa']
  var MACHI_DETAIL_LEVELS = ['off', 'low', 'high']
  var MACHI_FOLLOW_GLOBAL = 'global'
  var MACHI_QUALITY_PRESET_IDS = ['high', 'balanced', 'low']

  // 自定义视角各项的范围（设置面板滑块与归一化共用）
  var MACHI_VIEW_LIMITS = {
    azimuth: { min: -75, max: 75 },
    elevation: { min: -12, max: 40 },
    zoom: { min: 0.5, max: 2.8 },
    panX: { min: -5, max: 5 },
    panZ: { min: -5, max: 5 }
  }
  // 景深各项的范围
  var MACHI_DOF_LIMITS = {
    aperture: { min: 1.4, max: 16 },
    dof: { min: 0, max: 2 },
    dofRange: { min: 0.3, max: 3 },
    tiltShift: { min: 0, max: 1 },
    focusOffset: { min: -10, max: 10 }
  }
  // 光圈档（f 值，相邻两档进光量差一倍）
  var MACHI_APERTURE_STOPS = [1.4, 2, 2.8, 4, 5.6, 8, 11, 16]
  var MACHI_MOTION_SPEED_LIMITS = { min: 0.25, max: 3 }

  // 画质三档预设（自动降级不归预设管）
  var MACHI_QUALITY_PRESETS = {
    high: { renderScale: MACHI_FOLLOW_GLOBAL, antialias: MACHI_FOLLOW_GLOBAL, shadows: 'high', reflections: 'high', glow: true },
    balanced: { renderScale: MACHI_FOLLOW_GLOBAL, antialias: 'fxaa', shadows: 'low', reflections: 'low', glow: true },
    low: { renderScale: 0.75, antialias: 'off', shadows: 'off', reflections: 'off', glow: false }
  }
  var DEFAULT_MACHI_QUALITY = {
    renderScale: MACHI_FOLLOW_GLOBAL, antialias: MACHI_FOLLOW_GLOBAL,
    shadows: 'high', reflections: 'high', glow: true, adaptive: true
  }

  var DEFAULT_MACHI_VIEW = { azimuth: 0, elevation: 0, zoom: 1, panX: 0, panZ: 0 }
  var DEFAULT_MACHI_VIEWS = { konbini: DEFAULT_MACHI_VIEW, station: DEFAULT_MACHI_VIEW, kowloon: DEFAULT_MACHI_VIEW }

  var DEFAULT_MACHI_TUNING = {
    scene: 'auto',
    timeOfDay: 'auto',
    weather: 'auto',
    camera: 'default',
    views: DEFAULT_MACHI_VIEWS,
    motion: false,
    motionSpeed: 1,
    aperture: 8,
    dof: 1,
    dofRange: 1,
    tiltShift: 0.3,
    focus: 'center',
    focusOffset: 0,
    simulatedBeat: true,
    quality: DEFAULT_MACHI_QUALITY
  }

  // ===== 归一化 =====
  function numberWithin(value, fallback, min, max) {
    var n = Number(value)
    if (!Number.isFinite(n)) return fallback
    return Math.min(max, Math.max(min, n))
  }
  function pickChoice(choices, value, fallback) {
    for (var i = 0; i < choices.length; i += 1) if (value === choices[i]) return value
    return fallback
  }

  /** 自定义视角：每项夹进范围，缺的、坏的回默认。 */
  function normalizeMachiView(raw) {
    var input = raw && typeof raw === 'object' ? raw : {}
    function field(key) {
      return numberWithin(input[key], DEFAULT_MACHI_VIEW[key], MACHI_VIEW_LIMITS[key].min, MACHI_VIEW_LIMITS[key].max)
    }
    return { azimuth: field('azimuth'), elevation: field('elevation'), zoom: field('zoom'), panX: field('panX'), panZ: field('panZ') }
  }

  /** 各场景的自定义视角：每个场景按 normalizeMachiView 补齐。 */
  function normalizeMachiViews(raw) {
    var input = raw && typeof raw === 'object' ? raw : null
    var out = {}
    MACHI_SCENE_IDS.forEach(function (id) { out[id] = normalizeMachiView(input ? input[id] : undefined) })
    return out
  }

  /**
   * 画质：每项认得的值留下，缺的、坏的回默认。
   * 插件没有全局歌词画布挡位，「跟随全局」按默认值解释（渲染 1 倍、抗锯齿 SMAA，即原高档）。
   */
  function normalizeMachiQuality(raw) {
    var input = raw && typeof raw === 'object' ? raw : {}
    var d = DEFAULT_MACHI_QUALITY
    var renderScale = input.renderScale
    if (renderScale === MACHI_FOLLOW_GLOBAL) renderScale = MACHI_FOLLOW_GLOBAL
    else if (MACHI_RENDER_SCALES.indexOf(Number(renderScale)) >= 0) renderScale = Number(renderScale)
    else renderScale = d.renderScale
    return {
      renderScale: renderScale,
      antialias: pickChoice([MACHI_FOLLOW_GLOBAL].concat(MACHI_ANTIALIAS_MODES), input.antialias, d.antialias),
      shadows: pickChoice(MACHI_DETAIL_LEVELS, input.shadows, d.shadows),
      reflections: pickChoice(MACHI_DETAIL_LEVELS, input.reflections, d.reflections),
      glow: typeof input.glow === 'boolean' ? input.glow : d.glow,
      adaptive: typeof input.adaptive === 'boolean' ? input.adaptive : d.adaptive
    }
  }

  /** 这套画质是哪一档预设（细项和某一档完全一样才算），不是就是 custom。 */
  function resolveMachiQualityPreset(quality) {
    for (var i = 0; i < MACHI_QUALITY_PRESET_IDS.length; i += 1) {
      var preset = MACHI_QUALITY_PRESETS[MACHI_QUALITY_PRESET_IDS[i]]
      var same = Object.keys(preset).every(function (key) { return preset[key] === quality[key] })
      if (same) return MACHI_QUALITY_PRESET_IDS[i]
    }
    return 'custom'
  }

  /** 任何存下来的值 → 完整、合法的 tuning。 */
  function normalizeMachiTuning(raw) {
    var stored = raw && typeof raw === 'object' ? raw : {}
    var quality = normalizeMachiQuality(stored.quality)
    return {
      scene: pickChoice(['auto'].concat(MACHI_SCENE_IDS), stored.scene, DEFAULT_MACHI_TUNING.scene),
      timeOfDay: pickChoice(MACHI_TIMES_OF_DAY, stored.timeOfDay, DEFAULT_MACHI_TUNING.timeOfDay),
      weather: pickChoice(MACHI_WEATHERS, stored.weather, DEFAULT_MACHI_TUNING.weather),
      camera: pickChoice(MACHI_CAMERA_MODES, stored.camera, DEFAULT_MACHI_TUNING.camera),
      views: normalizeMachiViews(stored.views),
      motion: typeof stored.motion === 'boolean' ? stored.motion : DEFAULT_MACHI_TUNING.motion,
      motionSpeed: numberWithin(stored.motionSpeed, DEFAULT_MACHI_TUNING.motionSpeed, MACHI_MOTION_SPEED_LIMITS.min, MACHI_MOTION_SPEED_LIMITS.max),
      aperture: numberWithin(stored.aperture, DEFAULT_MACHI_TUNING.aperture, MACHI_DOF_LIMITS.aperture.min, MACHI_DOF_LIMITS.aperture.max),
      dof: numberWithin(stored.dof, DEFAULT_MACHI_TUNING.dof, MACHI_DOF_LIMITS.dof.min, MACHI_DOF_LIMITS.dof.max),
      dofRange: numberWithin(stored.dofRange, DEFAULT_MACHI_TUNING.dofRange, MACHI_DOF_LIMITS.dofRange.min, MACHI_DOF_LIMITS.dofRange.max),
      tiltShift: numberWithin(stored.tiltShift, DEFAULT_MACHI_TUNING.tiltShift, MACHI_DOF_LIMITS.tiltShift.min, MACHI_DOF_LIMITS.tiltShift.max),
      focus: pickChoice(MACHI_FOCUS_MODES, stored.focus, DEFAULT_MACHI_TUNING.focus),
      focusOffset: numberWithin(stored.focusOffset, DEFAULT_MACHI_TUNING.focusOffset, MACHI_DOF_LIMITS.focusOffset.min, MACHI_DOF_LIMITS.focusOffset.max),
      simulatedBeat: typeof stored.simulatedBeat === 'boolean' ? stored.simulatedBeat : DEFAULT_MACHI_TUNING.simulatedBeat,
      quality: quality
    }
  }

  /** 这首歌画哪个场景：选了就用选的，“自动”按 seed 在所有场景里挑一个（同一首歌总是同一个）。 */
  function resolveMachiSceneId(tuning, seed) {
    if (tuning.scene !== 'auto') return tuning.scene
    var hash = SeedHash.hashVisualizerSeed('machi-scene:' + seed)
    return MACHI_SCENE_IDS[hash % MACHI_SCENE_IDS.length]
  }

  /** 光圈 f 值 ↔ 滑块档位（0..7，往右光圈越大）。 */
  function machiApertureFromTrack(index) {
    var i = Math.round(Clamp.clamp01(index / (MACHI_APERTURE_STOPS.length - 1)) * (MACHI_APERTURE_STOPS.length - 1))
    return MACHI_APERTURE_STOPS[i]
  }
  function machiApertureToTrack(aperture) {
    var nearest = 0
    var best = Infinity
    MACHI_APERTURE_STOPS.forEach(function (stop, index) {
      var distance = Math.abs(Math.log(stop) - Math.log(aperture))
      if (distance < best) { best = distance; nearest = index }
    })
    return nearest
  }

  window.FoliaMachiTypes = {
    MACHI_SCENE_IDS: MACHI_SCENE_IDS,
    MACHI_TIMES_OF_DAY: MACHI_TIMES_OF_DAY,
    MACHI_WEATHERS: MACHI_WEATHERS,
    MACHI_CAMERA_MODES: MACHI_CAMERA_MODES,
    MACHI_FOCUS_MODES: MACHI_FOCUS_MODES,
    MACHI_RENDER_SCALES: MACHI_RENDER_SCALES,
    MACHI_ANTIALIAS_MODES: MACHI_ANTIALIAS_MODES,
    MACHI_DETAIL_LEVELS: MACHI_DETAIL_LEVELS,
    MACHI_FOLLOW_GLOBAL: MACHI_FOLLOW_GLOBAL,
    MACHI_QUALITY_PRESET_IDS: MACHI_QUALITY_PRESET_IDS,
    MACHI_QUALITY_PRESETS: MACHI_QUALITY_PRESETS,
    MACHI_VIEW_LIMITS: MACHI_VIEW_LIMITS,
    MACHI_DOF_LIMITS: MACHI_DOF_LIMITS,
    MACHI_APERTURE_STOPS: MACHI_APERTURE_STOPS,
    MACHI_MOTION_SPEED_LIMITS: MACHI_MOTION_SPEED_LIMITS,
    DEFAULT_MACHI_TUNING: DEFAULT_MACHI_TUNING,
    DEFAULT_MACHI_QUALITY: DEFAULT_MACHI_QUALITY,
    DEFAULT_MACHI_VIEW: DEFAULT_MACHI_VIEW,
    normalizeMachiTuning: normalizeMachiTuning,
    normalizeMachiQuality: normalizeMachiQuality,
    normalizeMachiViews: normalizeMachiViews,
    resolveMachiQualityPreset: resolveMachiQualityPreset,
    resolveMachiSceneId: resolveMachiSceneId,
    machiApertureFromTrack: machiApertureFromTrack,
    machiApertureToTrack: machiApertureToTrack
  }
})()
