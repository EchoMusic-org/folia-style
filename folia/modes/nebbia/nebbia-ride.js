// 雾笺（nebbia）疏雨轻车的颠簸与每帧仲裁：移植自 folia-major src/components/visualizer/nebbia/
//   nebbiaDrumBumps.ts（鼓点颠簸）、nebbiaDrizzleRide.ts（每帧开关仲裁）
// 智能动感模式「疏雨轻车」每帧读的那一份（上游从 createNebbiaRuntime.ts 拆出）：开着时车跟底鼓颠、雨跟人声轨，
// 雨点、颠簸各一条强度；关着时两样都按 1，雨走频段、车随机颠。
//
// 插件差异（相对上游）：
//   鼓点来自 window.FoliaBeatFx.getDrumHits()（形 { times: Float64Array, strengths: Float32Array, kinds: Uint8Array }，
//   DRUM_KICK = 0；上游 services/analysis/drumHits.ts 的表，插件运行时已接）；
//   效果开关与强度按 window.FoliaBeatFx.getEffectStrength('nebbia.drizzleRide')——上游「rain / bump」两个 part 各有滑杆
//   （beatEffectPartId(id, 'rain' | 'bump')），插件效果粒度是整条效果，两份共用同一强度；
//   上游 isBeatEffectPlaying（效果在屏上播放，强度调到 0 也算开）插件侧没有对应通道，用强度 > 0 判开，
//   强度 0 时回退成随机颠（差别只在把强度滑杆拉到 0 的那一档）；
//   getDrumHits 无鼓点数据时插件返回空表（上游返回 null）：空表按 null 处理，回随机颠；
//   人声包络（上游 getVocalEnvelope）插件没有，env 恒 null——雨点走 nebbia-hits.js 的 VocalEnergy 频段路径。
// 导出挂 window.FoliaNebbiaRide。
(function () {
  'use strict'

  /** 「疏雨轻车」的效果 id（上游 services/beatFx/beatEffects.ts 的 BEAT_EFFECT_IDS.nebbiaDrizzleRide）。 */
  var DRIZZLE_RIDE = 'nebbia.drizzleRide'

  // ---------- 鼓点颠簸（原版 nebbiaDrumBumps.ts） ----------
  // 疏雨轻车的鼓点颠簸：车压过底鼓颠一下，代替随机颠簸。只看底鼓（军鼓、镲片一颠就太碎），
  // 力度不到 MIN_STRENGTH 的不颠，两次至少隔 MIN_GAP 秒；幅度随鼓点力度。
  // 只在播放时间往前走一小段时触发这段里的鼓点；拖进度、暂停后跳回、换歌都只把游标挪过去，不补颠。

  var MIN_STRENGTH = 0.35
  var MIN_GAP = 0.3
  /** 一帧里时间往前走超过这么多秒就当作跳了进度。 */
  var MAX_STEP = 0.5

  function drumKick() {
    var fx = window.FoliaBeatFx
    return fx && fx.DRUM_KICK !== undefined ? fx.DRUM_KICK : 0
  }

  function NebbiaDrumBumps() {
    this.list = null
    this.key = null
    this.next = 0
    this.lastT = -Infinity
    this.lastBump = -Infinity
  }

  /**
   * 走到 `T`（歌里的秒），返回这一段里要颠的幅度（0 = 不颠，取这一段里最响的一下）。
   * `hits` 是这首歌的鼓点（还在分离时带 `until`）。
   */
  NebbiaDrumBumps.prototype.step = function (hits, key, T) {
    // 边分离边出的鼓点每秒换一份新的表：时间不变，游标按时间重新找
    if (hits !== this.list || key !== this.key) {
      this.list = hits
      this.key = key
      this.seek(T)
      return 0
    }
    if (T < this.lastT || T - this.lastT > MAX_STEP) {
      this.seek(T)
      return 0
    }
    var amount = 0
    var times = hits.times, strengths = hits.strengths, kinds = hits.kinds
    var KICK = drumKick()
    for (; this.next < times.length && times[this.next] <= T; this.next += 1) {
      var at = times[this.next]
      if (kinds[this.next] !== KICK || strengths[this.next] < MIN_STRENGTH || at - this.lastBump < MIN_GAP) continue
      this.lastBump = at
      amount = Math.max(amount, 0.3 + 0.7 * strengths[this.next])
    }
    this.lastT = T
    return amount
  }

  /** 不在跟鼓点（没开、没鼓点）：下次有了从那时起算。 */
  NebbiaDrumBumps.prototype.reset = function () {
    this.list = null
    this.key = null
  }

  NebbiaDrumBumps.prototype.seek = function (T) {
    var times = this.list ? this.list.times : null
    var lo = 0, hi = times ? times.length : 0
    while (lo < hi) { var m = (lo + hi) >> 1; if (times[m] <= T) lo = m + 1; else hi = m }
    this.next = lo
    this.lastT = T
    this.lastBump = -Infinity
  }

  // ---------- 每帧开关仲裁（原版 nebbiaDrizzleRide.ts） ----------

  function NebbiaDrizzleRide() {
    this.drumBumps = new NebbiaDrumBumps()
    /** 雨点正在跟的人声轨包络，没有时 null、退回频段（插件没有包络服务，恒 null）。 */
    this.env = null
    /** 雨点强度：乘小雨点密度和大雨点大小。 */
    this.rain = 1
  }

  /**
   * 开一帧的玻璃运动并读这一帧的效果：这首有鼓点就由底鼓颠（没鼓、没分析完的照旧随机颠），强度乘颠簸幅度
   * `bump`；`env`、`rain` 随后读。`bumps` 为 false（水族箱里车不颠）时只读雨点那份。
   */
  NebbiaDrizzleRide.prototype.step = function (motion, now, T, frozen, bump, bumps) {
    if (bumps === undefined) bumps = true
    var fx = window.FoliaBeatFx
    // 效果开着（智能动感总开关开 + isReady 且强度 > 0；关着、没数据时强度是 0）
    var strength = fx && fx.isReady() && fx.smartBeatActive() ? fx.getEffectStrength(DRIZZLE_RIDE) : 0
    var on = strength > 0
    // 鼓点：效果开着、车这一帧要颠才有；无鼓点数据（空表）按 null 处理，回随机颠
    var drums = null
    if (on && bumps) {
      var table = fx.getDrumHits()
      if (table && table.times && table.times.length) drums = table
    }
    motion.beginFrame(now, frozen, bumps && !drums)
    if (drums && !frozen) {
      var jolt = this.drumBumps.step(drums, null, T)
      if (jolt > 0 && strength > 0 && bump > 0) motion.trigger(now, jolt * strength)
    } else if (!drums) {
      this.drumBumps.reset()
    }
    // 拉到 0 就是没有雨（还没分析完、走频段时也一样）
    this.rain = on ? strength : 1
    // 插件没有人声包络：恒 null，雨点走 VocalEnergy 频段路径（上游这里读 getVocalEnvelope(key)）
    this.env = null
  }

  window.FoliaNebbiaRide = {
    DRIZZLE_RIDE: DRIZZLE_RIDE,
    MIN_STRENGTH: MIN_STRENGTH,
    MIN_GAP: MIN_GAP,
    MAX_STEP: MAX_STEP,
    NebbiaDrumBumps: NebbiaDrumBumps,
    NebbiaDrizzleRide: NebbiaDrizzleRide
  }
})()
