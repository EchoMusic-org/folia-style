// 雾笺（nebbia）玻璃上的水珠和颠簸：移植自 folia-major src/components/visualizer/nebbia/
//   nebbiaDropSpring.ts（水珠的惯性弹簧）、nebbiaDrops.ts（NebbiaGlassMotion：凝结水珠场、颠簸、甩痕、水痕）
// 水珠照 raindrop-fx 的做法：每颗是一张法线贴图精灵，实例数据 6 个数
// （中心 x、y，宽、高（CSS 像素），size = 宽/100 决定折射强度，alpha）；精灵只有中间约 1/4 宽能过合成阈值，
// 所以看得见半径 r 的水珠，四边形是 8r。颠簸：公交车压过坑，车身一震，水珠被甩开再弹回来（NebbiaDropSpring），
// 甩过的地方在雾上擦出一道印子（smears），大水珠被震落、留下水痕。
// 随机数用 window.FoliaSeedHash.createVisualizerRng（与上游 createVisualizerRng 同源）；
// NEBBIA_FIXED（fieldDrops/wind/bumpRate/bumpFall）按 window.FoliaNebbiaCore 引用。
// 导出挂 window.FoliaNebbiaDrops（含 NebbiaDropSpring；windDrift 供 nebbia-mask.js 等引用）。
(function () {
  'use strict'

  var Core = window.FoliaNebbiaCore
  var SeedHash = window.FoliaSeedHash
  var clamp = Core.clamp
  var NEBBIA_FIXED = Core.NEBBIA_FIXED

  // ---------- 水珠的惯性（原版 nebbiaDropSpring.ts） ----------
  // 水珠的惯性：玻璃跟车身一震，挂在玻璃上的水珠被表面张力拉着，像挂在弹簧上一样先被甩开、再阻尼回弹。
  // 每颗水珠相对玻璃的偏移是一个弹簧阻尼振子 u'' + 2ζω u' + ω² u = -G·g''（g 是玻璃在屏幕上的位移）：
  // 大水珠重、弹簧软，频率低、甩得开，回弹慢；小水珠被玻璃粘住，不动（PIN_R 以下），中间渐变。
  // 按几个半径各算一个振子，中间插值。
  // 振子只跟真实时间走（颠簸本来就不跟歌词时间），暂停时停住。

  /** 振子对应的可见半径（CSS 像素）和固有频率（Hz）。 */
  var RADII = [1.5, 3, 5, 8]
  var FREQ = [11, 8, 5.5, 3.6]
  var ZETA = 0.18
  /** 玻璃位移在屏幕上只有车身位移的 0.35（nebbiaFrameUniforms.ts 的 glassShift），水珠被甩开的幅度放大一点才看得出。 */
  var GLASS = 0.35
  var GAIN = 3
  /** 半径（CSS 像素）在 PIN_R 以下的水珠被粘住不动，到 FREE_R 才完全甩得动。 */
  var PIN_R = 2.5, FREE_R = 6
  /** 积分步长和二阶差分的间隔（秒）。 */
  var STEP = 1 / 480

  function NebbiaDropSpring() {
    var self = this
    this.u = RADII.map(function () { return [0, 0] })
    this.v = RADII.map(function () { return [0, 0] })
    this.last = -1
  }

  /** 推进到 now：`shakeAt(t)` 是车身在 t 时刻的位移。frozen 时只记下时刻。 */
  NebbiaDropSpring.prototype.step = function (now, frozen, shakeAt) {
    var from = this.last
    this.last = now
    if (frozen || from < 0 || now <= from) return
    // 掉帧或切走很久回来：只补最后 0.1 秒，不一下子积分一大段
    var t = Math.max(from, now - 0.1)
    while (t < now) {
      var h = Math.min(STEP, now - t)
      var g0 = shakeAt(t - STEP), g1 = shakeAt(t), g2 = shakeAt(t + STEP)
      for (var axis = 0; axis < 2; axis += 1) {
        var acc = -GAIN * GLASS * (g2[axis] - 2 * g1[axis] + g0[axis]) / (STEP * STEP)
        RADII.forEach(function (_r, i) {
          var w = FREQ[i] * Math.PI * 2
          var a = acc - 2 * ZETA * w * this.v[i][axis] - w * w * this.u[i][axis]
          // 半隐式欧拉：先更新速度再更新位置，弹簧不会越积越大
          this.v[i][axis] += a * h
          this.u[i][axis] += this.v[i][axis] * h
        }, this)
      }
      t += h
    }
  }

  /** 半径 r 的水珠这一帧相对玻璃的偏移 [dx, dy]，和顺着甩动方向的拉长量（正 = 竖着拉长）。 */
  NebbiaDropSpring.prototype.offset = function (r) {
    var i = 0
    while (i < RADII.length - 2 && r > RADII[i + 1]) i += 1
    var f = clamp((r - RADII[i]) / (RADII[i + 1] - RADII[i]))
    var free = clamp((r - PIN_R) / (FREE_R - PIN_R))
    var dx = (this.u[i][0] + (this.u[i + 1][0] - this.u[i][0]) * f) * free
    var dy = (this.u[i][1] + (this.u[i + 1][1] - this.u[i][1]) * f) * free
    // 甩得越远拉得越长：偏移和半径比，竖的比横的明显
    var stretch = clamp((Math.abs(dy) - Math.abs(dx) * 0.5) / Math.max(r, 1) * 0.12, -0.25, 0.35)
    return [dx, dy, stretch]
  }

  // ---------- 玻璃运动（原版 nebbiaDrops.ts） ----------
  // FieldDrop：雾上的一颗凝结水珠 { x, y, w, h, phase, hx, hy, fall, smear }——fall 是掉落中的一段
  // { t0, y0, len, dur, trail }，smear 是甩痕。
  // Trail：水珠掉落留下的水痕 { x, y0, y1, w, end, seed }。
  // Smear：水珠被甩过的一段 { x, y, w, ax, ay, bx, by, end, gone? }——静止位置 (x, y) 加上甩到的两头 a、b（相对偏移），
  // 停下来的时刻 end 起重新起雾。

  /** 偏移超过这么多像素才算甩出印子（每颗水珠都算，印子宽跟着水珠大小走）；回到这么近以内算停下。 */
  var SMEAR_MIN = 0.6
  var SMEAR_REST = 0.3

  /** 风把下淌的水珠往后推：每往下 1 像素横向挪多少。 */
  function windDrift(dy, busSpeed) {
    return -dy * NEBBIA_FIXED.wind * busSpeed
  }

  function NebbiaGlassMotion() {
    /** 这一帧要画进水珠纹理的实例（擦痕边、下淌、雨点）。 */
    this.drops = []
    this.trails = []
    this.smears = []
    this.fieldDrops = []
    this.bumps = []
    this.nextBump = 0
    this.rng = SeedHash.createVisualizerRng(777)
    this.now = 0
    this.H = 0
    /** 上一次颠的时刻：颠得密（跟底鼓）时每一下震落的概率按间隔打折，不然几分钟里大水珠全掉光。 */
    this.lastTrigger = -Infinity
    this.spring = new NebbiaDropSpring()
    this.bump = 1
  }

  /** 雾上的凝结水珠：下半部分略多略大。 */
  NebbiaGlassMotion.prototype.buildField = function (W, H) {
    var rnd = SeedHash.createVisualizerRng(4242), n = Math.round(W * H / 2200 * NEBBIA_FIXED.fieldDrops)
    this.fieldDrops = []
    for (var i = 0; i < n; i += 1) {
      var big = rnd() < 0.12
      var w = big ? 40 + rnd() * 34 : 14 + Math.pow(rnd(), 1.4) * 22
      var sp = rnd() * 0.25
      var x = rnd() * W, y = H * (1 - Math.pow(rnd(), 1.25))
      this.fieldDrops.push({ x: x, y: y, hx: x, hy: y, w: w * (1 + sp * 0.5), h: w * (1 + sp), phase: rnd() * 6.28, fall: null, smear: null })
    }
    this.trails.length = 0
    this.smears.length = 0
    this.H = H
  }

  /** 每帧开头：清空实例，按时间偶尔颠一下（`randomBumps` 为 false 时颠簸跟鼓点，由外面 trigger）。paused 时不颠。 */
  NebbiaGlassMotion.prototype.beginFrame = function (now, paused, randomBumps) {
    if (randomBumps === undefined) randomBumps = true
    this.now = now
    this.drops.length = 0
    var self = this
    this.spring.step(now, paused, function (t) { return self.shakeAt(t) })
    if (paused || !randomBumps || this.bump <= 0 || NEBBIA_FIXED.bumpRate <= 0) return
    if (now > this.nextBump) {
      if (this.nextBump > 0) this.trigger(now, 0.5 + this.rng() * 0.7)
      this.nextBump = now + (3 + this.rng() * 9) / NEBBIA_FIXED.bumpRate
    }
  }

  /** 颠一下：越大的水珠越容易被震落。 */
  NebbiaGlassMotion.prototype.trigger = function (now, a) {
    this.bumps.push({ t: now, a: a })
    while (this.bumps.length && now - this.bumps[0].t > 3) this.bumps.shift()
    // 随机颠簸平均 7.5 秒一下，按这个间隔算满；底鼓 0.5 秒一下就只有 1/15
    var fallShare = clamp((now - this.lastTrigger) / 7.5)
    this.lastTrigger = now
    for (var i = 0; i < this.fieldDrops.length; i += 1) {
      var d = this.fieldDrops[i]
      if (d.fall || d.w < 26) continue
      if (this.rng() < NEBBIA_FIXED.bumpFall * a * fallShare * (d.w - 24) / 45) {
        // 掉下去的水珠不再接着它原来位置上的甩痕
        if (d.smear && d.smear.end === null) d.smear.end = now
        d.smear = null
        var trail = { x: d.x, y0: d.y - d.h * 0.05, y1: d.y, w: d.w, end: null, seed: this.rng() * 100 }
        d.fall = { t0: now + this.rng() * 0.12, y0: d.y, len: (30 + this.rng() * 150) * d.w / 50, dur: 1 + this.rng() * 2.2, trail: trail }
        this.trails.push(trail)
      }
    }
  }

  /** 这一帧的车身位移（CSS 像素）。 */
  NebbiaGlassMotion.prototype.shake = function () {
    return this.shakeAt(this.now)
  }

  /** t 时刻的车身位移：先往下一沉，再阻尼回弹，横向带一点。 */
  NebbiaGlassMotion.prototype.shakeAt = function (t) {
    var x = 0, y = 0
    for (var i = 0; i < this.bumps.length; i += 1) {
      var b = this.bumps[i]
      var dt = t - b.t
      if (dt < 0) continue
      var k = b.a * this.bump
      y += k * 7 * Math.exp(-dt * 4.5) * Math.sin(dt * Math.PI * 2 * 3.8)
      // 横向的正弦带初相，颠的那一刻会跳一下：头 50 毫秒渐入，不然水珠的惯性被这一跳横着猛甩出去
      x += k * 2 * Math.exp(-dt * 5.5) * Math.sin(dt * Math.PI * 2 * 2.7 + 1.2) * (1 - Math.exp(-dt * 60))
    }
    return [x, y]
  }

  /** 水珠表面的细颤：颠簸后自己来回压扁、拉长几下（被甩开的拉长另算，见 NebbiaDropSpring）。 */
  NebbiaGlassMotion.prototype.wobble = function (phase) {
    var w = 0
    for (var i = 0; i < this.bumps.length; i += 1) {
      var b = this.bumps[i]
      var dt = this.now - b.t
      if (dt >= 0) w += b.a * this.bump * 0.07 * Math.exp(-dt * 3.2) * Math.sin(dt * Math.PI * 2 * 7 + phase)
    }
    return w
  }

  /** 放一颗水珠：r 是看得见的半径，sx / sy 压扁拉长。 */
  NebbiaGlassMotion.prototype.put = function (x, y, r, alpha, sx, sy) {
    if (sx === undefined) sx = 1
    if (sy === undefined) sy = 1
    if (r < 0.5 || alpha <= 0.01) return
    var off = this.spring.offset(r)
    var dx = off[0], dy = off[1], st = off[2]
    var wb = this.wobble(x * 0.05 + y * 0.03) - st
    var w = r * 8 * sx * (1 + wb), h = r * 8 * sy * (1 - wb)
    this.drops.push(x + dx, y + dy, w, h, w / 100, Math.min(1, alpha))
  }

  /** 雾上水珠这一帧的实例：晃动，掉落中的往下走走停停并拉长。 */
  NebbiaGlassMotion.prototype.fieldInstances = function (out, busSpeed) {
    out.length = 0
    for (var i = 0; i < this.fieldDrops.length; i += 1) {
      var d = this.fieldDrops[i]
      var x = d.x, y = d.y, stretch = 0
      if (d.fall) {
        var f = d.fall, tr = f.trail, u = clamp((this.now - f.t0) / f.dur)
        y = f.y0 + f.len * (u - Math.sin(u * 6 * Math.PI) / (6 * Math.PI))
        x = tr.x + Math.sin(y * 0.07 + tr.seed) * 1.4 + Math.sin(y * 0.021 + tr.seed * 2) * 2.2 + windDrift(y - tr.y0, busSpeed)
        stretch = 0.4 * (1 - Math.cos(u * 6 * Math.PI)) * (u < 1 ? 1 : 0)
        tr.y1 = y
        if (u >= 1) {
          tr.end = this.now
          d.fall = null
          // 掉出屏幕的在原处重新凝出来，否则留在落点
          if (y - d.h / 8 > this.H) { d.x = d.hx; d.y = d.hy } else { d.x = x; d.y = y }
        }
      }
      var off = this.spring.offset(d.w / 8)
      var dx = off[0], dy = off[1], st = off[2]
      if (!d.fall) this.trackSmear(d, dx, dy)
      var wb = this.wobble(d.phase) - st
      out.push(x + dx, y + dy, d.w * (1 + wb), d.h * (1 - wb + stretch), d.w / 100, 1)
    }
    return out
  }

  /** 记下一颗水珠甩过的范围：沿着甩动方向的两头，甩得更远就往外扩；停下后由 nebbia-mask.js 慢慢回雾。 */
  NebbiaGlassMotion.prototype.trackSmear = function (d, dx, dy) {
    var far = Math.hypot(dx, dy)
    var m = d.smear
    if (far < SMEAR_REST) {
      if (m && m.end === null) m.end = this.now
      return
    }
    // 上一道已经回雾了的不再续，另起一道
    if (m && m.gone) m = null
    if (!m) {
      if (far < SMEAR_MIN) return
      m = { x: d.x, y: d.y, w: d.w, ax: 0, ay: 0, bx: 0, by: 0, end: null }
      d.smear = m
      this.smears.push(m)
    }
    m.end = null
    // 两头按竖直方向分：往上甩的最远点、往下甩的最远点（横向跟着）
    if (dy < m.ay) { m.ax = dx; m.ay = dy }
    if (dy > m.by) { m.bx = dx; m.by = dy }
  }

  window.FoliaNebbiaDrops = {
    windDrift: windDrift,
    NebbiaDropSpring: NebbiaDropSpring,
    NebbiaGlassMotion: NebbiaGlassMotion
  }
})()
