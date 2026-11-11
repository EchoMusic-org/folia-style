// 智能动感（beatFx）共享运行时：
// ① 节拍时钟（移植自 folia-major services/beatFx/clock.ts，纯函数）：按"听到的时间"走排序的节拍事件表，
//    产出两路衰减包络（轻拍 160ms / 重拍 200ms），seek 只重定位不爆发。
// ② 节拍源（替代上游的 beat_this / HTDemucs 离线模型）：主程序频谱 API（ctx.audio.spectrum，宿主经
//    postMessage 转发 echo-folia:spectrum 帧）实时检测——低频谱通量 → 底鼓、中高频通量 → 军鼓；
//    拍周期与 小节相位 用最近 ~8 秒的间隔直方图估出来，事件增量进表（拖回/大跳 seek 清表重测）。
//    上游效果的全部消费接口（events/鼓点/强度/rotationSign/fired 计数）保持同形，模式侧零改动。
// ③ 智能动感开关与各效果强度（folia-smartBeat / folia-beatEffects，样式窗口「全局」tab 设置）。
// 无数据（未播放/不支持）时全部 API 返回常态值：效果关、包络 0、isReady() false——各模式自动回退模拟节拍。
(function () {
  'use strict'

  // ===== ① 节拍时钟（clock.ts 直移植） =====

  /** 弱拍也有这么高的峰值，看得见只是弱。 */
  var BEAT_FX_WEAK_BEAT_FLOOR = 0.35
  var BEAT_FX_BEAT_DECAY_MS = 160
  var BEAT_FX_DOWNBEAT_DECAY_MS = 200
  var BEAT_FX_SEEK_THRESHOLD_SEC = 0.3

  /** 拍的包络峰值：1（无重音数据）或按 impact 折算；无节奏小节为 0。 */
  function resolveBeatFxAccentGain(event, trackScale) {
    if (event && event.rhythmic === false) return 0
    if (!event || event.impact === undefined) return trackScale
    return (BEAT_FX_WEAK_BEAT_FLOOR + (1 - BEAT_FX_WEAK_BEAT_FLOOR) * event.impact) * trackScale
  }

  function findNextBeatFxEvent(events, time) {
    var low = 0
    var high = events.length
    while (low < high) {
      var mid = (low + high) >> 1
      if (events[mid].t <= time) low = mid + 1
      else high = mid
    }
    return low
  }

  function createBeatFxClockState(events, trackScale) {
    return {
      events: events || [],
      trackScale: trackScale === undefined ? 1 : trackScale,
      lastBeat: null,
      lastDownbeat: null,
      cursor: 0,
      lastTime: null,
      beatImpact: 0,
      downbeatImpact: 0,
      rotationSign: 1,
      firedBeats: 0,
      firedDownbeats: 0,
      lastFiredT: null
    }
  }

  /**
   * 推进一帧。heardTime 是"听到的时间"（延迟已扣）；dtSec 是墙钟帧间隔，驱动衰减（暂停时包络落定而不是冻结）。
   * 跨过的事件触发；seek 只重定位游标。
   */
  function stepBeatFxClock(state, heardTime, dtSec) {
    var dtMs = Math.max(0, dtSec) * 1000
    state.beatImpact *= Math.exp(-dtMs / BEAT_FX_BEAT_DECAY_MS * 2.3)
    state.downbeatImpact *= Math.exp(-dtMs / BEAT_FX_DOWNBEAT_DECAY_MS * 2.3)
    if (state.beatImpact < 1e-4) state.beatImpact = 0
    if (state.downbeatImpact < 1e-4) state.downbeatImpact = 0
    if (heardTime === null || !Number.isFinite(heardTime)) {
      state.lastTime = null
      return state
    }
    var previous = state.lastTime
    state.lastTime = heardTime
    var delta = previous === null ? NaN : heardTime - previous
    if (previous === null || delta < 0 || delta > BEAT_FX_SEEK_THRESHOLD_SEC) {
      state.cursor = findNextBeatFxEvent(state.events, heardTime)
      return state
    }
    while (state.cursor < state.events.length && state.events[state.cursor].t <= heardTime) {
      var event = state.events[state.cursor]
      state.cursor += 1
      var lateMs = Math.max(0, heardTime - event.t) * 1000
      var isDownbeat = event.kind === 'downbeat'
      var gain = resolveBeatFxAccentGain(event, state.trackScale)
      state.beatImpact = Math.max(state.beatImpact, gain * Math.exp(-lateMs / BEAT_FX_BEAT_DECAY_MS * 2.3))
      state.rotationSign = -state.rotationSign
      state.lastFiredT = event.t
      if (isDownbeat) {
        state.downbeatImpact = Math.max(state.downbeatImpact, gain * Math.exp(-lateMs / BEAT_FX_DOWNBEAT_DECAY_MS * 2.3))
        state.firedDownbeats += 1
        state.lastDownbeat = event
      } else {
        state.lastBeat = event
      }
      state.firedBeats += 1
    }
    return state
  }

  // ===== ② 实时节拍检测（主程序频谱 → 节拍表 + 鼓点） =====
  // 检测参数（按宿主频谱 24fps 调的）。
  var FEED_FPS = 24
  var HISTORY_SECONDS = 8
  var HISTORY_MAX = Math.round(HISTORY_SECONDS * FEED_FPS)
  // 频段 bin 范围按 bins 总数取比例（宿主对数映射 20Hz..20kHz）：底鼓 25~160Hz、军鼓 160~1.2kHz。
  function kickBins(total) {
    return [Math.max(0, Math.floor(total * 0.02)), Math.max(2, Math.floor(total * 0.29))]
  }
  function snareBins(total) {
    return [Math.max(2, Math.floor(total * 0.29)), Math.max(4, Math.floor(total * 0.62))]
  }
  var FLUX_FLOOR = 0.02           // 低于它的通量当 0（噪声门）
  var ADAPT_WINDOW = Math.round(2.0 * FEED_FPS)
  var ADAPT_K = 1.7               // 自适应门槛 = 均值 + k × 标准差
  var PEAK_HALO = 2               // 局部峰值半径（帧）
  var KICK_MIN_GAP = 0.18
  var SNARE_MIN_GAP = 0.16
  var KICK_STRENGTH_FLOOR = 0.3
  var PERIOD_MIN = 0.3
  var PERIOD_MAX = 1.0
  var BAR_BEATS = 4

  function DetectionState() {
    this.history = []        // { t, fluxLow, fluxHigh, low, high } 逐帧
    this.lastLow = null      // 上一帧低频能量（通量用）
    this.lastHigh = null
    this.lastKickAt = -Infinity
    this.lastSnareAt = -Infinity
    this.events = []         // BeatFxEvent[]（增量、升序）
    this.hits = []           // { t, kind, strength } 增量
    this.hitsDirty = false
    this.publishedHits = null // DrumHits 快照（内容变了才换新对象）
    this.period = 0.5
    this.barPhase = 0        // 拍号相位 0..（BAR_BEATS 内），小节第一拍为 0
    this.beatCount = 0
    this.ready = false
    this.lastT = null
    this.lastImpactLow = 0
    this.lastImpactHigh = 0
    this.trackScale = 1
    this.eventIndex = 0
  }

  function bandEnergy(bins, range) {
    var sum = 0
    var count = 0
    for (var i = range[0]; i < Math.min(range[1], bins.length); i += 1) {
      sum += bins[i]
      count += 1
    }
    return count ? sum / count : 0
  }

  /** 最近窗口的均值 + 标准差（自适应门槛）。 */
  function adaptiveThreshold(history, field, endIndex) {
    var values = []
    for (var i = Math.max(0, endIndex - ADAPT_WINDOW); i < endIndex; i += 1) values.push(history[i][field])
    if (values.length < 6) return Infinity
    var sum = 0
    values.forEach(function (v) { sum += v })
    var mean = sum / values.length
    var variance = 0
    values.forEach(function (v) { variance += (v - mean) * (v - mean) })
    variance /= values.length
    return mean + ADAPT_K * Math.sqrt(variance) + FLUX_FLOOR
  }

  /** 拍周期估计：最近 HISTORY_SECONDS 内低频峰间隔取中位数（夹进 0.3..1.0s，中位数抗乱拍）。 */
  function estimatePeriod(kickTimes) {
    var intervals = []
    for (var i = 1; i < kickTimes.length; i += 1) {
      var gap = kickTimes[i] - kickTimes[i - 1]
      if (gap >= PERIOD_MIN * 0.5 && gap <= PERIOD_MAX * 2) intervals.push(gap)
    }
    if (intervals.length < 4) return null
    intervals.sort(function (a, b) { return a - b })
    var median = intervals[Math.floor(intervals.length / 2)]
    // 中位数落在半拍（间隔的一半）时翻倍：拍周期不会比 0.3s 短。
    while (median < PERIOD_MIN) median *= 2
    while (median > PERIOD_MAX) median /= 2
    return median
  }

  function updatePeriod(state) {
    var kickTimes = []
    for (var i = 0; i < state.hits.length; i += 1) {
      if (state.hits[i].kind === 0) kickTimes.push(state.hits[i].t)
    }
    if (kickTimes.length > 3) {
      var start = Math.max(0, kickTimes.length - 40)
      var tail = kickTimes.slice(start)
      var period = estimatePeriod(tail)
      if (period) state.period = state.period * 0.5 + period * 0.5
    }
  }

  /** 底鼓峰处把小节相位对齐过去（小节第一拍多在低频重音上）。 */
  function alignBar(state, t, strength) {
    if (!state.barT0) {
      state.barT0 = t
      return
    }
    var pos = ((t - state.barT0) / state.period) % BAR_BEATS
    if (pos < 0.5) {
      // 落在小节第一拍附近：把小节起点轻轻拉向这个峰（重音更可信）。
      var k = Math.min(0.3, strength * 0.4)
      state.barT0 += (t - state.barT0) * k
    } else if (pos > BAR_BEATS - 0.5) {
      var k2 = Math.min(0.3, strength * 0.4)
      state.barT0 += ((t - BAR_BEATS * state.period) - state.barT0) * k2
    }
  }

  function pushEvent(state, t, isDownbeat, impact, tone) {
    var event = { t: t, kind: isDownbeat ? 'downbeat' : 'beat' }
    if (impact !== undefined) {
      event.impact = impact
      event.tone = tone
      event.rhythmic = true
    }
    state.events.push(event)
    // 事件表保持升序（检测按时间推进，天然有序）。
    state.eventIndex = state.events.length
    state.ready = true
  }

  function pushHit(state, t, kind, strength) {
    state.hits.push({ t: t, kind: kind, strength: strength })
    state.hitsDirty = true
  }

  /** 消费一帧宿主频谱。frame: { bins: number[](0..1), rms, peak, state, timePos } */
  function feed(frame) {
    if (!frame || !Array.isArray(frame.bins) || !frame.bins.length) return
    var bins = frame.bins
    var t = Number.isFinite(frame.timePos) ? frame.timePos : null
    if (t === null) return
    var state = shared._det
    // seek：倒退或大跳 → 清表重测。
    if (state.lastT !== null && (t < state.lastT - 0.05 || t - state.lastT > 2.5)) {
      state.history.length = 0
      state.events.length = 0
      state.hits.length = 0
      state.publishedHits = null
      state.ready = false
      state.lastLow = null
      state.lastHigh = null
      state.lastKickAt = -Infinity
      state.lastSnareAt = -Infinity
      state.barT0 = 0
      state.beatCount = 0
    }
    state.lastT = t
    if (frame.state === 'paused' || frame.state === 'idle') {
      // 暂停：只衰减（由 tick 做），不检测。
      return
    }
    var low = bandEnergy(bins, kickBins(bins.length))
    var high = bandEnergy(bins, snareBins(bins.length))
    var fluxLow = state.lastLow === null ? 0 : Math.max(0, low - state.lastLow)
    var fluxHigh = state.lastHigh === null ? 0 : Math.max(0, high - state.lastHigh)
    state.lastLow = low
    state.lastHigh = high
    state.history.push({ t: t, fluxLow: fluxLow, fluxHigh: fluxHigh })
    if (state.history.length > HISTORY_MAX + ADAPT_WINDOW) state.history.shift()
    var h = state.history
    var index = h.length - 1
    if (index < PEAK_HALO + 1) return
    // 局部峰值 + 自适应门槛（按中心帧判定，两频段各自一套）。
    var cLow = h[index].fluxLow
    var cHigh = h[index].fluxHigh
    if (cLow < FLUX_FLOOR && cHigh < FLUX_FLOOR) return
    var isLowPeak = cLow >= FLUX_FLOOR
    var isHighPeak = cHigh >= FLUX_FLOOR
    for (var k = 1; k <= PEAK_HALO; k += 1) {
      if (h[index - k] && h[index - k].fluxLow >= cLow) isLowPeak = false
      if (h[index + k] && h[index + k].fluxLow > cLow) isLowPeak = false
      if (h[index - k] && h[index - k].fluxHigh >= cHigh) isHighPeak = false
      if (h[index + k] && h[index + k].fluxHigh > cHigh) isHighPeak = false
    }
    var thresholdLow = adaptiveThreshold(h, 'fluxLow', index - PEAK_HALO)
    var thresholdHigh = adaptiveThreshold(h, 'fluxHigh', index - PEAK_HALO)
    // 峰的中心帧（PEAK_HALO 帧之前）：判定在这时，触发也在这时。
    var centerT = t - PEAK_HALO / FEED_FPS
    var kickFired = false
    var kickStrength = 0
    if (isLowPeak && cLow >= thresholdLow && centerT - state.lastKickAt >= KICK_MIN_GAP) {
      state.lastKickAt = centerT
      kickStrength = Math.min(1, cLow / Math.max(0.08, thresholdLow * 0.55))
      kickFired = kickStrength >= KICK_STRENGTH_FLOOR * 0.6
      if (kickFired) {
        pushHit(state, centerT, 0, kickStrength)
        state.lastImpactLow = kickStrength
        updatePeriod(state)
        alignBar(state, centerT, kickStrength)
      }
    }
    if (isHighPeak && cHigh >= thresholdHigh && centerT - state.lastSnareAt >= SNARE_MIN_GAP) {
      state.lastSnareAt = centerT
      var snareStrength = Math.min(1, cHigh / Math.max(0.08, thresholdHigh * 0.55))
      pushHit(state, centerT, 1, Math.min(1, snareStrength))
      state.lastImpactHigh = snareStrength
    }
    // 节拍表：底鼓峰本身就是拍（按估出的周期对齐、小节第一拍按相位标记）。
    if (kickFired) {
      var pos = state.barT0 ? (((centerT - state.barT0) / state.period) % BAR_BEATS + BAR_BEATS) % BAR_BEATS : (state.beatCount % BAR_BEATS)
      var isDownbeat = pos < 0.5 || pos > BAR_BEATS - 0.5
      // 拍的重音 = 底鼓强度；tone 按低 / 中高频通量占比。
      var recentHigh = 0
      for (var i = Math.max(0, h.length - 4); i < h.length; i += 1) recentHigh = Math.max(recentHigh, h[i].fluxHigh)
      var lowShare = low / Math.max(1e-4, low + high + 0.05)
      var tone = { low: Math.min(1, lowShare * 1.6), mid: Math.min(1, 0.3 + recentHigh * 2), high: 0.2 }
      impactBeat(state, centerT, isDownbeat, kickStrength, tone)
    }
  }

  /** 底鼓峰 → 节拍事件（相邻峰间隔接近周期整数倍时补中间的拍，底鼓漏打时节拍表不断档）。 */
  function impactBeat(state, t, isDownbeat, impact, tone) {
    var events = state.events
    var lastEvent = events.length ? events[events.length - 1] : null
    if (lastEvent && state.period > 0) {
      var gap = t - lastEvent.t
      var steps = Math.round(gap / state.period)
      if (steps >= 2 && steps <= 4) {
        for (var s = 1; s < steps; s += 1) {
          var midT = lastEvent.t + s * (gap / steps)
          var midPos = state.barT0 ? (((midT - state.barT0) / state.period) % BAR_BEATS + BAR_BEATS) % BAR_BEATS : 1
          var midDown = midPos < 0.5 || midPos > BAR_BEATS - 0.5
          pushEvent(state, midT, midDown, Math.max(0.3, impact * 0.5), tone)
        }
      }
    }
    var strength = Math.max(BEAT_FX_WEAK_BEAT_FLOOR, Math.min(1, impact))
    pushEvent(state, t, isDownbeat, strength, tone)
    state.beatCount += 1
  }

  // ===== ③ 共享服务 =====
  var STORAGE_MODE_KEY = 'folia-smartBeat'
  var STORAGE_EFFECTS_KEY = 'folia-beatEffects'

  // 设置读缓存：smartBeatActive/getEffectStrength 在每帧热路径被模式多次调用
  // （町景 3 次、花火 2~4 次），localStorage 同步读 + JSON.parse 不该进 rAF；
  // 这两个键只有本模块经 setMode/setEffectSettings 写，写时同步刷缓存即可保一致。
  var modeCache = null        // null = 未初始化；'on' | 'off'
  var effectsCache = null     // null = 未初始化；解析后的效果设置对象

  function readMode() {
    if (modeCache === null) {
      try {
        var value = localStorage.getItem(STORAGE_MODE_KEY)
        modeCache = value === 'on' ? 'on' : 'off'
      } catch (e) { modeCache = 'off' }
    }
    return modeCache
  }

  function readEffects() {
    if (effectsCache === null) {
      try {
        var raw = localStorage.getItem(STORAGE_EFFECTS_KEY)
        var parsed = raw ? JSON.parse(raw) : {}
        effectsCache = parsed && typeof parsed === 'object' ? parsed : {}
      } catch (e) { effectsCache = {} }
    }
    return effectsCache
  }

  /** 内置效果清单（与上游 BEAT_EFFECT_IDS 对齐；nebbia 的两条在雾笺接入后生效）。 */
  var BEAT_EFFECT_DEFS = [
    { id: 'machi.neonPulse', label: '霓虹随拍', mode: 'machi', source: 'beats' },
    { id: 'machi.drumRipple', label: '鼓点涟漪', mode: 'machi', source: 'drums' },
    { id: 'machi.screenFlash', label: '大屏闪拍', mode: 'machi', source: 'drums' },
    { id: 'hanabi.beatBursts', label: '随拍开花', mode: 'hanabi', source: 'beats' },
    { id: 'hanabi.beatPulse', label: '随拍推镜', mode: 'hanabi', source: 'beats' },
    { id: 'nebbia.drizzleRide', label: '疏雨轻车', mode: 'nebbia', source: 'drums' },
    { id: 'nebbia.aquaBeat', label: '舞潮踏拍', mode: 'nebbia', source: 'beats' }
  ]

  var shared = {
    _clock: createBeatFxClockState([], 1),
    _det: new DetectionState(),
    _lastTickAt: 0,
    _readyHoldUntil: 0
  }

  /** 每帧调（bridge 主循环）：推进时钟包络；dt 取墙钟。 */
  function tick(songTime, isPlaying) {
    var now = performance.now()
    var dt = shared._lastTickAt ? Math.min(0.1, (now - shared._lastTickAt) / 1000) : 1 / 60
    shared._lastTickAt = now
    var det = shared._det
    // "听到的时间"：用检测状态里最新一帧的 timePos（播放中），暂停时 null（包络只衰减）。
    var heard = isPlaying && det.lastT !== null && Math.abs(det.lastT - songTime) < 1.2 ? det.lastT : (isPlaying ? songTime : null)
    stepBeatFxClock(shared._clock, heard, dt)
    if (isPlaying && det.ready) shared._readyHoldUntil = now + 1500
  }

  /** 供桥接线：每帧频谱进来时喂给检测器。 */
  function feedFrame(frame) {
    feed(frame)
  }

  /** 换歌：清表重测。 */
  function resetForSong() {
    var det = shared._det
    det.history.length = 0
    det.events.length = 0
    det.hits.length = 0
    det.publishedHits = null
    det.ready = false
    det.lastT = null
    det.lastLow = null
    det.lastHigh = null
    det.barT0 = 0
    det.beatCount = 0
    shared._clock = createBeatFxClockState(det.events, det.trackScale)
  }

  // ===== 对外 API（与上游 beatFxLive 的消费面对齐） =====
  window.FoliaBeatFx = {
    // —— 时钟 ——
    tick: tick,
    feedFrame: feedFrame,
    resetForSong: resetForSong,
    resolveAccentGain: resolveBeatFxAccentGain,
    getImpact: function (kind) {
      return kind === 'downbeat' ? shared._clock.downbeatImpact : shared._clock.beatImpact
    },
    getRotationSign: function () { return shared._clock.rotationSign },
    getFiredCounts: function () {
      return { beats: shared._clock.firedBeats, downbeats: shared._clock.firedDownbeats }
    },
    getBeatPeriod: function () { return shared._det.period || 0.5 },
    // —— 节拍表 / 鼓点（模式的读点） ——
    isReady: function () {
      return Boolean(shared._det.ready) || performance.now() < shared._readyHoldUntil
    },
    getEvents: function () { return shared._det.events },
    getHeard: function () {
      var det = shared._det
      return det.lastT !== null && shared._det.ready ? { time: det.lastT } : { time: null }
    },
    getTrackScale: function () { return shared._det.trackScale },
    getDrumHits: function () {
      var det = shared._det
      if (det.hitsDirty || !det.publishedHits) {
        // 快照换新对象：模式侧的挑选缓存（WeakMap 按对象身份）不会读到旧长度。
        var times = new Float64Array(det.hits.length)
        var strengths = new Float32Array(det.hits.length)
        var kinds = new Uint8Array(det.hits.length)
        for (var i = 0; i < det.hits.length; i += 1) {
          times[i] = det.hits[i].t
          strengths[i] = det.hits[i].strength
          kinds[i] = det.hits[i].kind
        }
        det.publishedHits = { times: times, strengths: strengths, kinds: kinds }
        det.hitsDirty = false
      }
      return det.publishedHits
    },
    // —— 鼓点 kind 常量（上游 drumHitPicking.ts） ——
    DRUM_KICK: 0,
    DRUM_SNARE: 1,
    DRUM_HAT: 2,
    // —— 智能动感设置 ——
    getMode: readMode,
    setMode: function (mode) {
      var next = mode === 'on' ? 'on' : 'off'
      modeCache = next
      try { localStorage.setItem(STORAGE_MODE_KEY, next) } catch (e) { /* 忽略 */ }
    },
    smartBeatActive: function () { return readMode() === 'on' },
    getEffectSettings: function (id) {
      var effects = readEffects()
      var entry = effects[id]
      if (!entry || typeof entry !== 'object') return { on: true, strength: 1 }
      return {
        on: entry.on !== false,
        strength: Number.isFinite(Number(entry.strength)) ? Math.max(0, Math.min(2, Number(entry.strength))) : 1
      }
    },
    setEffectSettings: function (id, patch) {
      var effects = readEffects()
      var entry = effects[id] && typeof effects[id] === 'object' ? effects[id] : { on: true, strength: 1 }
      var next = { on: patch.on === undefined ? entry.on !== false : Boolean(patch.on), strength: patch.strength === undefined ? entry.strength : Math.max(0, Math.min(2, Number(patch.strength) || 0)) }
      effects[id] = next
      try { localStorage.setItem(STORAGE_EFFECTS_KEY, JSON.stringify(effects)) } catch (e) { /* 忽略 */ }
      return next
    },
    /** 效果的强度（0 = 关）。模式侧拿它当包络缩放。 */
    getEffectStrength: function (id) {
      if (!shared._det.ready) return 0
      var settings = this.getEffectSettings(id)
      return settings.on ? settings.strength : 0
    },
    /** 效果定义清单（样式窗口渲染设置行用）。 */
    BEAT_EFFECT_DEFS: BEAT_EFFECT_DEFS
  }
})()
