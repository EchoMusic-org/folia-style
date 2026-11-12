// 时间与天气（移植自 engine/environment.ts，纯函数，三个场景共用）：
// 设置 → 环境目标（白天程度、雨/雪/雾），再按真实时间阻尼地追过去，换天气、天黑天亮都是渐变的；
// 地面的湿度和积雪比降水本身慢（雨停了路面过一阵才干，雪积起来要一会儿）。
// 再由环境状态推出灯光、后处理这些标量（日光强度与方向、人造光、bloom、云量、星星、雾气）。
(function () {
  'use strict'

  var SeedHash = window.FoliaSeedHash

  /** 白天程度：0 夜，约 0.45 黄昏，1 白天。 */
  var MACHI_DAYLIGHT = { night: 0, dusk: 0.45, day: 1 }

  function smoothstep(edge0, edge1, x) {
    var t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)))
    return t * t * (3 - 2 * t)
  }

  /**
   * 本地时钟 → 白天程度：05:00–06:30 天亮，06:30–16:30 白天，16:30–17:30 落到黄昏，17:30–18:30 入夜。
   * hour 是带小数的小时（0..24）。
   */
  function resolveMachiDaylightAt(hour) {
    var h = ((hour % 24) + 24) % 24
    if (h >= 5 && h < 6.5) return smoothstep(5, 6.5, h)
    if (h >= 6.5 && h < 16.5) return 1
    if (h >= 16.5 && h < 17.5) return 1 - (1 - MACHI_DAYLIGHT.dusk) * smoothstep(16.5, 17.5, h)
    if (h >= 17.5 && h < 18.5) return MACHI_DAYLIGHT.dusk * (1 - smoothstep(17.5, 18.5, h))
    return 0
  }

  function resolveMachiDaylight(timeOfDay, now) {
    if (timeOfDay === 'auto') {
      return resolveMachiDaylightAt(now.getHours() + now.getMinutes() / 60 + now.getSeconds() / 3600)
    }
    return MACHI_DAYLIGHT[timeOfDay]
  }

  /** “自动”天气按 seed 加权：雨 35%、晴 30%、雾 20%、雪 15%。 */
  var AUTO_WEATHER = [['rain', 0.35], ['clear', 0.3], ['fog', 0.2], ['snow', 0.15]]

  function resolveMachiWeatherKind(weather, seed) {
    if (weather !== 'auto') return weather
    var roll = SeedHash.visualizerHash01(SeedHash.hashVisualizerSeed('machi-weather:' + seed), 0, 0x3d)
    for (var i = 0; i < AUTO_WEATHER.length; i += 1) {
      if (roll < AUTO_WEATHER[i][1]) return AUTO_WEATHER[i][0]
      roll -= AUTO_WEATHER[i][1]
    }
    return 'rain'
  }

  /** 环境追向的目标。 */
  function resolveMachiEnvironmentTarget(daylight, kind) {
    return {
      daylight: daylight,
      rain: kind === 'rain' ? 1 : 0,
      snow: kind === 'snow' ? 1 : 0,
      fog: kind === 'fog' ? 1 : 0
    }
  }

  /** 环境此刻的状态：目标的几项，再加地面的湿度与积雪（比降水慢）。 */
  function createMachiEnvironmentState(target) {
    return {
      daylight: target.daylight,
      rain: target.rain,
      snow: target.snow,
      fog: target.fog,
      wetness: target.rain > 0.5 ? 1 : (target.fog > 0.5 ? 0.35 : 0),
      snowCover: target.snow > 0.5 ? 1 : 0
    }
  }

  /** 各项追目标的时间常数（秒）。 */
  var TAU = {
    daylight: 1.6,
    precipitation: 1.4,
    fog: 2.2,
    wetUp: 3,
    wetDown: 20,
    snowUp: 8,
    snowDown: 12
  }

  function approach(value, target, tau, delta) {
    var next = value + (target - value) * (1 - Math.exp(-delta / tau))
    return Math.abs(next - target) < 0.001 ? target : next
  }

  /** 推进 delta 秒：降水、雾、白天程度阻尼地追目标；下雨时路面变湿，停了慢慢干；下雪时慢慢积、停了慢慢化。 */
  function stepMachiEnvironment(state, target, delta) {
    if (delta <= 0) return state
    var rain = approach(state.rain, target.rain, TAU.precipitation, delta)
    var snow = approach(state.snow, target.snow, TAU.precipitation, delta)
    var fog = approach(state.fog, target.fog, TAU.fog, delta)
    // 雨把路面打湿；雾天只是潮；雪天、晴天路面慢慢干。
    var wetTarget = Math.max(rain, fog * 0.35)
    var wetness = approach(state.wetness, wetTarget, wetTarget > state.wetness ? TAU.wetUp : TAU.wetDown, delta)
    var snowCover = approach(state.snowCover, snow, snow > state.snowCover ? TAU.snowUp : TAU.snowDown, delta)
    return {
      daylight: approach(state.daylight, target.daylight, TAU.daylight, delta),
      rain: rain,
      snow: snow,
      fog: fog,
      wetness: wetness,
      snowCover: snowCover
    }
  }

  function sameMachiEnvironment(a, b) {
    return a.daylight === b.daylight && a.rain === b.rain && a.snow === b.snow && a.fog === b.fog && a.wetness === b.wetness && a.snowCover === b.snowCover
  }

  /** 由环境状态推出的灯光与后处理标量。 */
  function resolveMachiEnvironmentLook(state) {
    var daylight = state.daylight
    var warmth = Math.max(0, 1 - Math.abs(daylight - MACHI_DAYLIGHT.dusk) / 0.38)
    var overcast = Math.min(1, Math.max(state.rain, state.fog, state.snow * 0.8))
    var night = 1 - daylight
    return {
      warmth: warmth,
      overcast: overcast,
      /** 人造光（店内灯、招牌、路灯）的亮度倍数：白天弱。 */
      artificial: 0.55 + 0.45 * smoothstep(0.85, 0.2, daylight),
      /** 路灯：黄昏才点亮，白天关。 */
      streetLamps: smoothstep(0.62, 0.3, daylight),
      sunIntensity: (1.35 + (3.0 - 1.35) * daylight) * (1 - 0.55 * overcast * daylight) * (1 - 0.25 * state.fog),
      hemiIntensity: 2.1 + 0.35 * daylight + 0.25 * overcast * daylight,
      bloom: 0.12 + 0.38 * night,
      streaks: 0.55 * night * night,
      clouds: 0.18 + 0.82 * overcast,
      stars: night * (1 - overcast) * smoothstep(0.35, 0.05, daylight),
      mist: 0.16 * (1 - 0.4 * daylight) + 0.1 * state.rain + 0.45 * state.fog + 0.06 * state.snow,
      haze: 0.42 * state.fog + 0.08 * state.snow
    }
  }

  window.FoliaMachiEnvironment = {
    MACHI_DAYLIGHT: MACHI_DAYLIGHT,
    resolveMachiDaylightAt: resolveMachiDaylightAt,
    resolveMachiDaylight: resolveMachiDaylight,
    resolveMachiWeatherKind: resolveMachiWeatherKind,
    resolveMachiEnvironmentTarget: resolveMachiEnvironmentTarget,
    createMachiEnvironmentState: createMachiEnvironmentState,
    stepMachiEnvironment: stepMachiEnvironment,
    sameMachiEnvironment: sameMachiEnvironment,
    resolveMachiEnvironmentLook: resolveMachiEnvironmentLook
  }
})()
