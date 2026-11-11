// 雾笺（nebbia）雨点：移植自 folia-major src/components/visualizer/nebbia/nebbiaHits.ts
// 雨点打在玻璃上，跟人声走：
// - 小雨点：每 20 毫秒一格，按这一格的人声能量以泊松速率 0.15–7 个/秒落下；每格的随机数只由歌和格号决定，
//   同一时刻同一首歌落在同一处。
// - 大雨点：每个吐字砸一颗，溅出一圈小水珠，躲开正在唱的那句。整首一次排好。
// 落定前先被拍扁一下；大雨点砸开一个不规则的小清点，0.4 秒后用 0.3 × 起雾时间回雾。
//
// 人声有两个来源：
// - 智能动感模式的「疏雨轻车」开着（雨点跟人声）、这首歌分析过时，用 HTDemucs 分出的人声轨（上游 services/analysis/vocalEnvelope.ts）：
//   能量是逐帧响度按这首歌自己 ±1.5 秒内的人声范围归一（和原型 vocal-fx-demo 的「吐字明暗」一样），
//   大雨点砸在真实的起音上（够响的都砸，轻的三成）。整首按时间定死，拖进度、暂停都对得上。
//   —— 插件没有 HTDemucs 人声包络（无分轨服务），运行时 env 恒为 null，永远走下面的频段路径；
//   上游的包络分支（vocalEnvelopeEnergy / songLoudness / buildBig 的 env 参数）原样保留，注释照旧，
//   以后接入分轨时把包络对象按上游形状（{ fps, db, top, onsets, from }）传进 buildBig 即可。
// - 否则退回播放器的人声频段（1–3.5 kHz，按最近几秒自己的范围归一），大雨点砸在六成的词开唱处。
// 中途切到雾笺时人声轨只从切过来时的播放位置往后分（包络的 `from`）：那之前的格子和词照旧走频段这条路。
// 随机数用 window.FoliaSeedHash.createVisualizerRng / mixVisualizerSeed（与上游同源）；
// clamp / smooth / MASK_SCALE 按 window.FoliaNebbiaCore 引用；lineRect 内联（上游 nebbiaScene.ts 的，属后续批次）。
// 导出挂 window.FoliaNebbiaHits。
(function () {
  'use strict'

  var Core = window.FoliaNebbiaCore
  var SeedHash = window.FoliaSeedHash
  var clamp = Core.clamp
  var smooth = Core.smooth
  var MASK_SCALE = Core.MASK_SCALE

  // Hit：{ t, x, y, R, big, sat, seed }——sat 是大雨点溅开的小水珠 [dx, dy, r] 数组（没有时 null）。

  /** 一格 20 毫秒，正好是人声包络的一帧（上游 vocalEnvelope.ts 的 VOCAL_FPS = 50；插件写死这个值）。 */
  var VOCAL_FPS = 50
  var BUCKET = 1 / VOCAL_FPS

  /** 升序数组里第一个不小于 v 的位置。 */
  function lowerBound(sorted, v) {
    var lo = 0, hi = sorted.length
    while (lo < hi) { var m = (lo + hi) >> 1; if (sorted[m] < v) lo = m + 1; else hi = m }
    return lo
  }

  /**
   * 人声轨逐帧能量 0..1：按 ±1.5 秒内唱着的帧（高于 top − 28 dB）的 10%–95% 范围归一，再 ^1.2。按包络缓存。
   * 窗口是一个随帧滑动的有序数组，进一帧插一个、出一帧删一个，不再每帧重排（结果逐位相同）。
   * env 是上游 VocalEnvelope 的形状 { fps, db: Float32Array, top, onsets: number[], from }（插件目前没有）。
   */
  var energies = new WeakMap()
  function vocalEnvelopeEnergy(env) {
    var known = energies.get(env)
    if (known) return known
    var db = env.db, top = env.top, fps = env.fps
    var n = db.length, reach = Math.round(1.5 * fps), floor = top - 28
    var e = new Float32Array(n)
    // 帧 i 的窗口是 [i − reach, i + reach)
    var win = []
    for (var j0 = 0; j0 < Math.min(n, reach); j0 += 1) if (db[j0] > floor) win.splice(lowerBound(win, db[j0]), 0, db[j0])
    for (var i = 0; i < n; i += 1) {
      if (i > 0) {
        var enter = i + reach - 1, leave = i - reach - 1
        if (enter < n && db[enter] > floor) win.splice(lowerBound(win, db[enter]), 0, db[enter])
        if (leave >= 0 && db[leave] > floor) win.splice(lowerBound(win, db[leave]), 1)
      }
      if (db[i] <= floor) continue
      var a = win[Math.floor(win.length * 0.1)], b = Math.max(a + 3, win[Math.floor(win.length * 0.95)])
      e[i] = Math.pow(clamp((db[i] - a) / (b - a)), 1.2)
    }
    energies.set(env, e)
    return e
  }

  /**
   * 整首歌唱得多响，乘在人声轨的小雨点密度上：上面的逐帧能量只看前后几秒的起伏，一首从头喊到尾的和轻声的慢歌
   * 平均下来雨一样大。按人声轨的 `top`（响的那一档）算：−17.4 dB（郑润泽《你》）为 1 倍，每响 8 dB 翻一倍，
   * 夹在 0.5–3 倍（《凤舞九天》的 −3.8 dB 约 3 倍）。
   */
  function songLoudness(top) {
    return clamp(Math.pow(2, (top + 17.4) / 8), 0.5, 3)
  }

  /** 某时刻正在唱的那句（原型 activeRect：开唱前 0.3 秒到唱完后 1 秒）。 */
  function activeLine(laid, t) {
    for (var i = 0; i < laid.length; i += 1) {
      var line = laid[i]
      if (t >= line.t - 0.3 && t <= line.end + 1) return line
    }
    return null
  }

  /** 人声频段的自适应归一：峰值慢慢回落、底慢慢抬升，大约对应原型的「±1.5 秒内的人声范围」。 */
  function VocalEnergy() {
    this.floor = 0
    this.peak = 1
    this.value = 0
  }

  VocalEnergy.prototype.update = function (raw, dt) {
    var k = 1 - Math.exp(-dt / 3)
    this.peak = Math.max(raw, this.peak + (raw - this.peak) * k * 0.5)
    this.floor = Math.min(raw, this.floor + (raw - this.floor) * k * 0.3)
    this.value = Math.pow(clamp((raw - this.floor) / Math.max(this.peak - this.floor, 8)), 1.2)
    return this.value
  }

  function NebbiaHits(seed) {
    this.seed = seed
    this.big = []
    this.small = []
    this.lastBucket = -1
    /** 人声轨的逐帧能量（帧 = 20 毫秒 = 一格），没有人声轨时 null。 */
    this.vocal = null
    /** 人声轨从哪一格起有（包络的 `from`），之前的格子走频段。 */
    this.vocalFrom = 0
    /** 整首的响度倍数（songLoudness），只乘人声轨的格子。 */
    this.loud = 1
  }

  /**
   * 排好整首的大雨点，W、H 是 CSS 像素，大小按 1 倍排、画的时候再乘（`draw` 的 size），拖强度滑杆不用重排。
   * 有人声轨（`env`）时砸在起音上，否则砸在词开唱处；小雨点也改用人声轨逐格的能量。
   * 插件没有包络：env 恒 null，大雨点全部砸在六成的词开唱处、小雨点走播放器频段。
   */
  NebbiaHits.prototype.buildBig = function (laid, words, W, H, env) {
    if (env === undefined) env = null
    this.big = []
    this.small = []
    this.lastBucket = -1
    this.vocal = env && env.fps === VOCAL_FPS ? vocalEnvelopeEnergy(env) : null
    this.vocalFrom = this.vocal && env ? env.from || 0 : 0
    this.loud = env && this.vocal ? songLoudness(env.top) : 1
    var rnd = SeedHash.createVisualizerRng(SeedHash.mixVisualizerSeed(this.seed, 911))
    var k = Math.min(W, H) / 720
    var self = this
    var add = function (t, line) {
      var rect = line ? lineRect(line) : null
      var x = 0, y = 0
      for (var tries = 0; tries < 8; tries += 1) {
        x = W * (0.03 + 0.94 * rnd()); y = H * (0.03 + 0.94 * rnd())
        if (!rect || x < rect.x0 - 20 || x > rect.x1 + 20 || y < rect.y0 - 20 || y > rect.y1 + 20) break
      }
      var R = (7 + rnd() * 6) * k
      var sat = []
      var n = 4 + Math.floor(rnd() * 5)
      for (var s = 0; s < n; s += 1) {
        var a = rnd() * 6.28, d = R * (1.5 + rnd() * 1.4)
        sat.push([Math.cos(a) * d, Math.sin(a) * d * 0.85 + R * 0.2, (1 + rnd() * 1.6) * k])
      }
      self.big.push({ t: t, x: x, y: y, R: R, big: true, sat: sat, seed: rnd() * 100 })
    }
    // 人声轨开始之前（没有人声轨时是整首）砸在词开唱处，之后砸在起音上
    var vocalStart = env && this.vocal ? this.vocalFrom / env.fps : Infinity
    laid.forEach(function (line, li) {
      var list = words[li] || []
      for (var wi = 0; wi < list.length; wi += 1) {
        var w = list[wi]
        var t = line.chars[w[0]].t
        if (t < vocalStart && rnd() < 0.6) add(t, line)
      }
    })
    if (env && this.vocal) {
      var e = this.vocal
      env.onsets.forEach(function (o) {
        if (e[o] > 0.15 || rnd() < 0.3) add(o / env.fps, activeLine(laid, o / env.fps))
      })
    }
    this.big.sort(function (a, b) { return a.t - b.t })
  }

  /**
   * 补上新到的格子里的小雨点；拖进度时只补最近 life 秒。有人声轨时每格用那一格的能量，
   * 否则用这一帧播放器频段的 `energy`。
   */
  NebbiaHits.prototype.advance = function (T, energy, density, life, W, H) {
    var bucket = Math.floor(T / BUCKET)
    if (bucket < this.lastBucket || bucket - this.lastBucket > life / BUCKET) {
      this.small = []
      this.lastBucket = bucket - Math.ceil(life / BUCKET)
    }
    if (density > 0) {
      var k = Math.min(W, H) / 720, vocal = this.vocal
      var rateOf = function (e) { return (0.15 + 7 * e * e) * density * BUCKET }
      var live = rateOf(energy)
      for (var b = this.lastBucket + 1; b <= bucket; b += 1) {
        var rnd = SeedHash.createVisualizerRng(SeedHash.mixVisualizerSeed(this.seed + b, 0x5ad1))
        if (rnd() >= (vocal && (b < 0 || b >= this.vocalFrom) ? rateOf(b >= 0 && b < vocal.length ? vocal[b] : 0) * this.loud : live)) continue
        this.small.push({ t: (b + rnd()) * BUCKET, x: W * (0.03 + 0.94 * rnd()), y: H * (0.03 + 0.94 * rnd()), R: (2 + rnd() * 3.5) * k, big: false, sat: null, seed: rnd() * 100 })
      }
    }
    this.lastBucket = bucket
    while (this.small.length && this.small[0].t < T - life) this.small.shift()
  }

  /** 画还活着的雨点：清点进遮罩，水珠进 motion。`size` 乘大雨点的半径和溅开的距离，半径不到 1 像素的不画。 */
  NebbiaHits.prototype.draw = function (ctx, motion, T, refog, beadHold, size) {
    var fogT = refog * 0.3, life = 0.4 + fogT + beadHold * 0.5 + refog
    var lo = 0, hi = this.big.length
    while (lo < hi) { var m = (lo + hi) >> 1; if (this.big[m].t < T - life) lo = m + 1; else hi = m }
    ctx.setTransform(MASK_SCALE, 0, 0, MASK_SCALE, 0, 0)
    var one = function (h, s) {
      var R = h.R * s
      var age = T - h.t
      var v = 1 - smooth(clamp((age - 0.4) / fogT))
      var bv = 1 - smooth(clamp((age - 0.4 - beadHold * 0.5) / refog))
      // 大雨点砸开的清点比水珠略大一圈、很快回雾，不然显成一个暗环
      if (h.big && v > 0.002) {
        for (var j = 0; j < 7; j += 1) {
          var a = h.seed + j * 0.9, d = R * 0.3
          var x = h.x + Math.cos(a) * d, y = h.y + Math.sin(a * 1.3) * d
          ctx.moveTo(x, y)
          ctx.lineTo(x + 0.1, y)
        }
        ctx.stroke(R * 1.3, v)
      }
      if (bv > 0.01) {
        // 刚砸上时拍扁、横向摊开，0.12 秒内回弹
        var sq = Math.exp(-age / 0.05)
        motion.put(h.x, h.y + R * 0.1, R * 0.9 * (0.6 + 0.4 * bv), bv, 1 + 0.5 * sq, 1 - 0.35 * sq)
        if (h.sat) for (var i = 0; i < h.sat.length; i += 1) {
          var sati = h.sat[i], out = clamp(age / 0.08), dx = sati[0] * s, dy = sati[1] * s
          motion.put(h.x + dx * out, h.y + dy * out, sati[2] * (0.55 + 0.45 * bv), bv * out)
        }
      }
    }
    if (size > 0) for (var i = lo; i < this.big.length && this.big[i].t <= T; i += 1) if (this.big[i].R * size >= 1) one(this.big[i], size)
    for (var s = 0; s < this.small.length; s += 1) if (this.small[s].t <= T) one(this.small[s], 1)
    ctx.setTransform(1, 0, 0, 1, 0, 0)
  }

  /** 排好的大雨点和还留着的小雨点（单测读）。 */
  NebbiaHits.prototype.scheduled = function () {
    return { big: this.big, small: this.small }
  }

  /** 一颗雨点从落下到完全消失要几秒。 */
  NebbiaHits.lifeOf = function (refog, beadHold) {
    return 0.4 + refog * 0.3 + beadHold * 0.5 + refog
  }

  // ---------- 一句的外框（上游 nebbiaScene.ts 的 lineRect，本文件内联；nebbiaScene 属后续批次，接入后可改引用） ----------
  // chars 里带 glyph 的字取外框：没有带 glyph 的字时 x0 是 Infinity（调用方判 Number.isFinite 退回）。
  function lineRect(line) {
    var x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, S = 0
    for (var i = 0; i < line.chars.length; i += 1) {
      var c = line.chars[i]
      if (c.glyph) {
        x0 = Math.min(x0, c.x - c.s / 2); x1 = Math.max(x1, c.x + c.s / 2)
        y0 = Math.min(y0, c.y - c.s / 2); y1 = Math.max(y1, c.y + c.s / 2); S = Math.max(S, c.s)
      }
    }
    return { x0: x0, x1: x1, y0: y0, y1: y1, S: S }
  }

  window.FoliaNebbiaHits = {
    VOCAL_FPS: VOCAL_FPS,
    BUCKET: BUCKET,
    vocalEnvelopeEnergy: vocalEnvelopeEnergy,
    songLoudness: songLoudness,
    VocalEnergy: VocalEnergy,
    NebbiaHits: NebbiaHits
  }
})()
