// 雾笺（nebbia）水族箱：移植自 folia-major src/components/visualizer/nebbia/
//   nebbiaBeatCursor.ts（节拍游标）、nebbiaWeedSway.ts（水草跟拍弹簧）、nebbiaJellies.ts（水母）、
//   nebbiaAquarium.ts（每帧写水族箱 uniform）+ 上游 createNebbiaRuntime.ts 的 aquaBeats 聚合（本文件 aquabeats）
// 窗外是水族箱时运行时每帧调的那一份：水母（NebbiaJellies），和智能动感模式「舞潮踏拍」的三项——
// 水母跟拍收缩、水草跟拍摇一下（NebbiaWeedSway）、每拍从沙底冒出一排大泡、聚光灯光斑跟拍放大。走过的拍由 NebbiaBeatCursor 给，
// 拖进度不补拍；拍按听到的时刻走（FoliaBeatFx.getHeard()，扣掉输出延迟），蓝牙耳机上也不抢拍。
// 算好的都写进同一份 uniform（上游 nebbiaGlUtils.ts 的 NebbiaAquaUniforms，nebbia-gl.js 按它设 uJelly 这些）：
//   jelly（Float32Array，每只 4 个数：x、y（scene 坐标）、伞盖半径、收缩；长度是着色器数组的 24 只）
//   jellyColor（Float32Array，每只 4 个数：颜色 rgb、触手波的相位）
//   count（几只水母）、bubbles（气泡多少）
//   sway（Float32Array，水草跟拍的弹簧：现在、0.05、0.1、0.15 秒前的横向偏移）
//   weedIdle（水草自己摆动的幅度 0..1：跟拍时落到 0）
//   bursts（Float32Array，跟拍冒的大泡每排 4 个数：x、冒出的时刻、大小 0..1、种子；长度是 NEBBIA_MAX_BURSTS 排）
//   burstCount（几排）、beatRows（1 时不冒随机的大泡）、spotScale（聚光灯光斑半径乘多少）
//
// 插件差异（相对上游）：
//   节拍表来自 window.FoliaBeatFx.getEvents()、听到的时刻来自 getHeard().time、强度来自
//   getEffectStrength('nebbia.aquaBeat')——上游 jelly/weed/bubble/spot 四个 part 各有滑杆（beatEffectPartId），
//   插件效果粒度是整条效果，四项共用同一强度。
// 导出挂 window.FoliaNebbiaAquarium（含 Jellies / WeedSway / BeatCursor）。
(function () {
  'use strict'

  var Core = window.FoliaNebbiaCore
  var NEBBIA_MAX_JELLIES = Core.NEBBIA_MAX_JELLIES
  var NEBBIA_MAX_BURSTS = Core.NEBBIA_MAX_BURSTS

  /** 「舞潮踏拍」的效果 id（上游 BEAT_EFFECT_IDS.nebbiaAquaBeat）。 */
  var AQUA_BEAT = 'nebbia.aquaBeat'

  // ---------- 节拍游标（原版 nebbiaBeatCursor.ts） ----------
  // 舞潮踏拍的节拍游标（NebbiaAquarium 每帧调）：返回这一帧走过的拍。节拍表换了、拖了进度只把游标挪到当前时刻，不补拍；
  // 没有节拍的小节（rhythmic 为 false）不算。
  //
  // BeatFxEvent（上游 services/beatFx/clock.ts，插件 FoliaBeatFx.getEvents() 的元素形状）：
  //   { t（歌内秒）, kind（'beat' | 'downbeat'）, impact?（0..1 多重）, tone?, barPos?, rhythmic?（false = 这一小节没有节奏，这一拍不发动效） }。
  // NebbiaBeatHit：{ index（在节拍表里的序号，每拍不同的伪随机用）, gain（力度，按 accent，最低 0.35）, down（是不是小节第一拍） }。

  /** 一帧里歌的时间往前走超过这么多秒就当作跳了进度。 */
  var MAX_STEP = 0.5

  function NebbiaBeatCursor() {
    this.events = null
    this.cursor = 0
    this.lastT = -Infinity
    /** 这一帧走过的拍（每帧清空重用）。 */
    this.hits = []
  }

  /** 走到歌里的 T 秒；events 为 null（不跟拍）时忘掉游标，返回空。 */
  NebbiaBeatCursor.prototype.step = function (events, T) {
    var hits = this.hits
    hits.length = 0
    if (!events) {
      this.events = null
      return hits
    }
    var jumped = events !== this.events || T < this.lastT || T - this.lastT > MAX_STEP
    this.lastT = T
    if (jumped) {
      this.events = events
      var lo = 0, hi = events.length
      while (lo < hi) { var m = (lo + hi) >> 1; if (events[m].t <= T) lo = m + 1; else hi = m }
      this.cursor = lo
      return hits
    }
    for (; this.cursor < events.length && events[this.cursor].t <= T; this.cursor += 1) {
      var e = events[this.cursor]
      if (e.rhythmic === false) continue
      hits.push({ index: this.cursor, gain: Math.max(0.35, e.impact === undefined || e.impact === null ? 1 : e.impact), down: e.kind === 'downbeat' })
    }
    return hits
  }

  // ---------- 水草跟拍弹簧（原版 nebbiaWeedSway.ts） ----------
  // 舞潮踏拍的水草一项（NebbiaAquarium 每帧调）：水草梢的横向偏移是一个欠阻尼的弹簧，每拍推一下（左右交替），
  // 摇过去再弹回来、慢慢停。每拍直接换成新的摆动速度，不和上一下叠加（反着叠会互相抵掉、那一拍看不出），位置照旧连续，不会跳。
  // 着色器从根到梢按高度取弹簧前 0–0.15 秒的位置，梢比根晚到，看起来是一道从根往上传的波；所以这里留着最近 0.15 秒每 1/120 秒的位置。

  /** 弹簧：约每秒摆 2 下，阻尼比 0.3。 */
  var OMEGA = 2 * Math.PI * 2
  var DAMP = 2 * 0.3 * OMEGA
  /** 推一下给的速度：一下满力的推，最大偏到约 ±1。 */
  var KICK_V = OMEGA * 1.25
  var STEP = 1 / 120
  /** 历史：着色器取现在、0.05、0.1、0.15 秒前（每隔 SPACING 步）。 */
  var SPACING = 6
  var HISTORY = SPACING * 3 + 1

  function NebbiaWeedSway() {
    this.x = 0
    this.v = 0
    this.side = 1
    this.carry = 0
    this.history = new Float32Array(HISTORY)
    this.head = 0
  }

  /** 推一下：amount 是这一拍的力度乘强度（0..2）。 */
  NebbiaWeedSway.prototype.kick = function (amount) {
    this.side = -this.side
    this.v = this.side * amount * KICK_V
  }

  /** 走 dt 秒（暂停时 0），把现在、0.05、0.1、0.15 秒前的位置写进 out。 */
  NebbiaWeedSway.prototype.step = function (dt, out) {
    this.carry += Math.min(dt, 0.1)
    while (this.carry >= STEP) {
      this.carry -= STEP
      this.v += (-OMEGA * OMEGA * this.x - DAMP * this.v) * STEP
      this.x += this.v * STEP
      this.head = (this.head + 1) % HISTORY
      this.history[this.head] = this.x
    }
    for (var k = 0; k < 4; k += 1) out[k] = this.history[(this.head - k * SPACING + HISTORY * 2) % HISTORY]
  }

  // ---------- 水母（原版 nebbiaJellies.ts） ----------
  // 水族箱的水母（窗外是水族箱时运行时每帧调）：每只自己的节奏一收一缩，缩的时候往上窜一点，慢慢浮上去，
  // 浮出水面上沿就换个位置从底下再来。位置、大小、收缩、颜色算好写进两个数组，着色器（上游 nebbiaJellyGlsl.ts）只读。
  // 智能动感模式「舞潮踏拍」的水母一项开着时（走过的拍由 NebbiaAquarium 的 beats 参数给），水母跟拍：每拍全部收一下，
  // 普通拍收得轻、小节第一拍收得重，自己的节奏压小，跟拍的那一下更大、往上窜得更多；拍的力度按节拍表的 accent。
  // 颜色一半是固定的几种鲜艳色、一半取主题的灯光色，近的大而亮，远的小而暗。
  //
  // Jelly：{ xf, y, depth, rate, phase, rise, hue, kick, kickFrom, kickAge, seed }。

  // Rgb = [r, g, b]（0..1）
  var VIVID = [[1, 0.35, 0.72], [0.35, 0.8, 1], [0.72, 0.5, 1], [1, 0.72, 0.35]]
  /** 浮到这里（画面上沿外）就从 BOTTOM 再来。 */
  var TOP = -0.35, BOTTOM = 1.35
  /** 跟拍时自己那份节奏留多少。 */
  var OWN_WITH_BEATS = 0.4
  /** 普通拍收多紧（小节第一拍按 1）。 */
  var WEAK_BEAT = 0.6

  /** 0..1 的伪随机，只由 n 决定。 */
  var rand = function (n) {
    var x = Math.sin(n * 127.1 + 311.7) * 43758.5453
    return x - Math.floor(x)
  }
  /** 跟拍那一下的收缩：从 from（上一下还没舒张完的）70 毫秒收紧到 kick，再慢慢舒张。 */
  var kickLevel = function (j) { return j.kickAge < 0.07 ? j.kickFrom + (j.kick - j.kickFrom) * j.kickAge / 0.07 : j.kick * Math.exp(-(j.kickAge - 0.07) / 0.3) }
  /** 跟拍开关时自己那份节奏在这么多秒里过渡，不突变。 */
  var OWN_EASE = 1.5

  var spawnJelly = function (i, seed, y) {
    return {
      xf: rand(seed * 3.1 + i),
      y: y,
      depth: rand(seed * 5.7 + i * 1.3),
      rate: 1.6 + 0.9 * rand(seed * 2.3 + i),
      phase: rand(seed + i * 7.3) * Math.PI * 2,
      rise: 0.012 + 0.012 * rand(seed * 9.1 + i),
      hue: rand(seed * 4.4 + i * 11.0),
      kick: 0,
      kickFrom: 0,
      kickAge: 10,
      seed: seed
    }
  }

  function NebbiaJellies() {
    this.list = []
    for (var i = 0; i < NEBBIA_MAX_JELLIES; i += 1) this.list.push(spawnJelly(i, i + 1, TOP + rand(i * 13.7) * (BOTTOM - TOP)))
    this.palette = [[1, 0.81, 0.54], [0.54, 0.8, 1], [0.8, 0.54, 1]]
    /** 自己那份节奏留多少：不跟拍 1，跟拍 OWN_WITH_BEATS，切换时慢慢过渡。 */
    this.own = 1
  }

  /** 主题的三个灯光色（nebbia-core.js 的 la、lb、lc）。 */
  NebbiaJellies.prototype.setPalette = function (la, lb, lc) {
    this.palette = [la, lb, lc]
  }

  /**
   * 走一帧：dt 是窗外时钟走的秒数（暂停时 0），time 是窗外时钟，aspect 是画面宽高比；fired 是这一帧走过的拍，
   * strength 是水母这一项的强度（0 就是不跟拍）。写进 out 的水母几项（jelly、jellyColor、count）。
   */
  NebbiaJellies.prototype.step = function (out, dt, time, aspect, tuning, fired, strength) {
    var count = Math.round(tuning.jellies)
    var target = strength > 0 ? OWN_WITH_BEATS : 1
    this.own += Math.sign(target - this.own) * Math.min(Math.abs(target - this.own), dt * (1 - OWN_WITH_BEATS) / OWN_EASE)
    var own = this.own
    var jelly = out.jelly, jellyColor = out.jellyColor
    for (var i = 0; i < count; i += 1) {
      var j = this.list[i]
      j.phase += dt * j.rate
      var swim = Math.max(Math.sin(j.phase), 0)
      for (var b = 0; b < fired.length; b += 1) {
        if (strength <= 0) break
        var beat = fired[b]
        j.kickFrom = kickLevel(j)
        j.kick = Math.max(j.kickFrom, beat.gain * strength * (beat.down ? 1 : WEAK_BEAT))
        j.kickAge = 0
      }
      j.kickAge += dt
      var kick = kickLevel(j)
      j.y -= dt * (j.rise * (1 + 0.9 * swim * own) + 0.06 * kick)
      if (j.y < TOP) j = this.list[i] = spawnJelly(i, j.seed + NEBBIA_MAX_JELLIES, BOTTOM)
      var x = (j.xf + 0.02 * Math.sin(time * 0.15 + j.hue * 10)) * (aspect + 0.2) - 0.1
      var o = i * 4
      jelly[o] = x; jelly[o + 1] = j.y; jelly[o + 2] = (0.03 + 0.055 * j.depth) * tuning.jellySize
      jelly[o + 3] = Math.min(1.3, Math.max(Math.pow(swim, 3) * own, kick))
      var vivid = VIVID[Math.floor(j.hue * 4) % 4], theme = this.palette[Math.floor((j.hue * 3.7 % 1) * 3)]
      var shade = 0.45 + 0.55 * j.depth
      for (var c = 0; c < 3; c += 1) jellyColor[o + c] = (vivid[c] * 0.65 + theme[c] * 0.35) * shade
      jellyColor[o + 3] = j.phase
    }
    out.count = count
  }

  // ---------- 每帧写 uniform（原版 nebbiaAquarium.ts） + aquabeats 聚合（上游 createNebbiaRuntime.ts 的 aquaBeats） ----------
  // NebbiaAquaBeats（跟拍时读的）：{ events（这首歌的节拍表）, heard（听到的歌里时刻，秒）, jelly, weed, bubble, spot（三项各自 + 聚光灯的强度，0 是这一项不跟） }。

  /** 一排泡留多久（秒）：这么久早浮出画面了，之后那一格可以给新的一排。 */
  var BURST_LIFE = 6
  /** 聚光灯跟拍：一下满力的拍光斑放大多少，60 毫秒放大、再 0.25 秒缩回。 */
  var SPOT_GROW = 0.45, SPOT_ATTACK = 0.06, SPOT_DECAY = 0.25

  var randBurst = function (n) {
    var x = Math.sin(n * 91.7 + 47.3) * 43758.5453
    return x - Math.floor(x)
  }

  /**
   * 「舞潮踏拍」：开着、节拍表装好、不是静态模式时给的节拍表和各项强度；否则 null。
   * 上游按 jelly / weed / bubble / spot 四个 part 各取一次强度；插件效果粒度是整条效果，四项共用同一份。
   * aquaBeatsOut 每帧改写（上游 runtime 同款），重复调用返回同一个对象。
   */
  var aquaBeatsOut = { events: [], heard: 0, jelly: 0, weed: 0, bubble: 0, spot: 0 }
  function aquabeats(still) {
    var fx = window.FoliaBeatFx
    if (still || !fx || !fx.isReady()) return null
    // 按听到的时刻走（扣掉输出延迟），和其他跟拍效果一样
    var heard = fx.getHeard().time
    if (heard === null || heard === undefined) return null
    var strength = fx.getEffectStrength(AQUA_BEAT)
    aquaBeatsOut.events = fx.getEvents()
    aquaBeatsOut.heard = heard
    aquaBeatsOut.jelly = strength
    aquaBeatsOut.weed = strength
    aquaBeatsOut.bubble = strength
    aquaBeatsOut.spot = strength
    return aquaBeatsOut
  }

  function NebbiaAquarium() {
    this.jellies = new NebbiaJellies()
    this.cursor = new NebbiaBeatCursor()
    this.out = {
      jelly: new Float32Array(NEBBIA_MAX_JELLIES * 4),
      jellyColor: new Float32Array(NEBBIA_MAX_JELLIES * 4),
      count: 0,
      bubbles: 0,
      sway: new Float32Array(4),
      weedIdle: 1,
      bursts: new Float32Array(NEBBIA_MAX_BURSTS * 4),
      burstCount: 0,
      beatRows: 0,
      spotScale: 1
    }
    /** 聚光灯跟拍：这一下放大到多少、从多少开始放大、过了几秒。 */
    this.spotKick = 0
    this.spotFrom = 0
    this.spotAge = 10
    this.weed = new NebbiaWeedSway()
    /** 下一排泡写进哪一格（环形）。 */
    this.nextBurst = 0
  }

  NebbiaAquarium.prototype.setPalette = function (la, lb, lc) {
    this.jellies.setPalette(la, lb, lc)
  }

  /**
   * 走一帧：dt 是窗外时钟走的秒数（暂停时 0），time 是窗外时钟，aspect 是画面宽高比；
   * beats 为 null 时不跟拍。返回这一帧给着色器的水族箱 uniform（同一个对象，每帧改写）。
   */
  NebbiaAquarium.prototype.step = function (dt, time, aspect, tuning, beats) {
    var out = this.out
    var hits = this.cursor.step(beats ? beats.events : null, beats ? beats.heard : 0)
    this.jellies.step(out, dt, time, aspect, tuning, hits, beats ? beats.jelly : 0)
    out.bubbles = tuning.bubbles
    var sway = out.sway, bursts = out.bursts
    for (var h = 0; h < hits.length; h += 1) {
      var hit = hits[h]
      var weed = beats ? beats.weed : 0, bubble = beats ? beats.bubble : 0
      // 水草：左右交替推一下，小节第一拍推得更大
      if (weed > 0) this.weed.kick(hit.gain * weed * (hit.down ? 1 : 0.7))
      // 聚光灯：光斑放大一下，从还没缩回的大小接着放大
      var spot = beats ? beats.spot : 0
      if (spot > 0) {
        this.spotFrom = this.spotLevel()
        this.spotKick = Math.max(this.spotFrom, Math.min(1.5, hit.gain * spot * (hit.down ? 1 : 0.7)))
        this.spotAge = 0
      }
      // 大泡：每拍一排，小节第一拍大一些；位置每拍不同，只由拍的序号决定
      if (bubble > 0) {
        var o = this.nextBurst * 4
        bursts[o] = 0.17 + randBurst(hit.index) * Math.max(0, aspect - 0.34)
        bursts[o + 1] = time
        bursts[o + 2] = Math.min(1, hit.gain * bubble * (hit.down ? 1 : 0.75))
        bursts[o + 3] = randBurst(hit.index * 3.3 + 1) * 100
        this.nextBurst = (this.nextBurst + 1) % NEBBIA_MAX_BURSTS
      }
    }
    out.beatRows = beats && beats.bubble > 0 ? 1 : 0
    this.spotAge += dt
    out.spotScale = 1 + SPOT_GROW * this.spotLevel()
    this.weed.step(dt, sway)
    // 舞潮踏拍的水草一项开着：水草自己的摆动按 0.6 秒的时间常数收掉（0.6 秒剩约 1/3，2 秒左右收干净），只跟拍走；关掉时同样慢慢摆回来
    var idle = beats && beats.weed > 0 ? 0 : 1
    out.weedIdle += (idle - out.weedIdle) * (1 - Math.exp(-dt / 0.6))
    // 着色器只看前 burstCount 排：把早浮出去的排除掉（时钟回绕、换歌归零时冒出时刻在将来的也丢）
    var n = 0
    for (var i = 0; i < NEBBIA_MAX_BURSTS; i += 1) {
      var age = time - bursts[i * 4 + 1]
      if (bursts[i * 4 + 2] > 0 && age >= 0 && age < BURST_LIFE) n = i + 1
      else bursts[i * 4 + 2] = 0
    }
    out.burstCount = n
    return out
  }

  NebbiaAquarium.prototype.spotLevel = function () {
    var a = this.spotAge
    return a < SPOT_ATTACK ? this.spotFrom + (this.spotKick - this.spotFrom) * a / SPOT_ATTACK : this.spotKick * Math.exp(-(a - SPOT_ATTACK) / SPOT_DECAY)
  }

  window.FoliaNebbiaAquarium = {
    AQUA_BEAT: AQUA_BEAT,
    aquabeats: aquabeats,
    NebbiaBeatCursor: NebbiaBeatCursor,
    NebbiaWeedSway: NebbiaWeedSway,
    NebbiaJellies: NebbiaJellies,
    NebbiaAquarium: NebbiaAquarium
  }
})()
