// 雾笺（nebbia）凝露玻璃：移植自 folia-major src/components/visualizer/nebbia/
//   nebbiaCondensation.ts（雾上的细小冷凝水珠）、nebbiaFireflies.ts（凝露玻璃上的萤虫）
// 凝露玻璃的雾上水珠（玻璃选了凝露时代替 nebbia-drops.js 的凝结水珠，水族箱默认配它）：照 raindrop-fx 的 droplets 那一层，
// 一层很密很细的小水珠，没有大水珠。像水族箱玻璃上渗出来的冷凝水：一颗颗慢慢凝出来、长大，挂一阵再慢慢缩没，
// 在别处再凝出来；越往下越密、略大。实例格式和 nebbia-drops.js 的 fieldInstances 一样（x、y、宽、高、折射强度、alpha），
// 画进同一张 uField 纹理。不跟颠簸晃。多少、大小在设置里调（tuning.dew、dewSize），高光在主着色器里（NEBBIA_DEW）。
// 和歌词的水联动（wipe）：笔尖、抹字的手指、往下淌的水珠扫过的地方，和还挂着水珠的笔画边上，小水珠被擦掉、算进歌词的水里；
// 笔画上的水珠没了以后，过几秒在原地重新慢慢凝出来（雾回来了）。
//
// 萤虫：从四面八方飞过来（照融雪最早那版雪花，上游提交 71446614，从糊到清、越近越大），但飞得像虫：
// 路线忽左忽右地折、一顿一顿忽快忽慢；落到玻璃上停着，尾巴亮完 5～10 次之前一阵一阵地爬几步；再起飞，往随机方向越飞越快、越飞越糊，淡没。
// 身子淡，被窗外的光照到才看得清；尾巴有一点自己发的光，颜色和窗外的灯一样：主题的三个灯光色，加上路灯的钠黄、车灯的白（每只随机一个），各只按自己的节奏慢慢亮起、暗下，同一时刻只有少数几只亮着。
// 头朝着它正在走的方向（按这一帧挪了多少算）。样子在 nebbia-gl.js 的 NebbiaFireflyGl（着色器已就位）。
// FIREFLY_FLOATS = 12、fireflyParams.halo = 2 与 nebbia-gl.js 里写死并导出的值对齐。
// 随机数：上游萤虫本来就是 Math.random（每帧重排的生物，不按种子定）；凝露水珠用 window.FoliaSeedHash.createVisualizerRng。
// 导出挂 window.FoliaNebbiaGlass。
(function () {
  'use strict'

  var Core = window.FoliaNebbiaCore
  var SeedHash = window.FoliaSeedHash
  var Segments = window.FoliaNebbiaSegments
  var clamp = Core.clamp
  var segDist = Segments.segDist

  // ---------- 凝露水珠（原版 nebbiaCondensation.ts） ----------
  // Droplet：{ x, y, r, sy, born, life, full }——full：这颗长足了、它那一格实例已经按足尺寸写好，挂着的这段时间不用再写。

  /** 多少为 1 时每这么多平方 CSS 像素一颗；滑杆最多拉到 MAX_DEW 倍，先按最多的铺好。 */
  var AREA_PER_DROP = 81
  var MAX_DEW = 1.5
  /** 刚换尺寸时这么多秒里陆续凝出来；之后每颗凝出、缩没各用的秒数。 */
  var FIRST_FILL = 10, GROW = 6, FADE = 4
  /** 每颗挂多久（不算凝出、缩没）。 */
  var LIFE_MIN = 12.5, LIFE_SPAN = 25
  /** 实例隔这么多秒才更新一次：水珠长得很慢（一帧不到 0.02 像素），每 50 毫秒变一下看不出一顿一顿，水珠纹理也不用每帧重画。 */
  var UPDATE_EVERY = 0.05
  /** 查擦掉的网格边长（CSS 像素）；擦掉后过多久在原地重新凝（秒）。 */
  var CELL = 24, REGROW_MIN = 2, REGROW_SPAN = 4

  function NebbiaCondensation() {
    this.list = []
    /** 实例数据：每颗 6 个数，直接写进去（每帧两万多颗，push 进数组再拷一遍太慢）。 */
    this.inst = new Float32Array(0)
    this.rng = SeedHash.createVisualizerRng(9191)
    this.W = 0
    this.H = 0
    /** 自己的时钟：暂停、静止时不走，水珠就停在那里。 */
    this.time = 0
    /** 离上次更新过了多久；上次的大小、画几颗；重铺过还没写。 */
    this.sinceUpdate = 0
    this.lastSize = -1
    this.lastCount = -1
    this.dirty = true
    /** 上一次 instances() 改没改实例：没改时水珠纹理不用重画（nebbia-gl.js）。 */
    this.changed = true
    /** 每格里的水珠下标；cellOf 是每颗在哪一格（重新凝到别处时挪格）。 */
    this.cells = []
    this.cellOf = new Int32Array(0)
    this.gw = 1
    /** 上一次按写好的笔画擦的时刻。 */
    this.wetAt = -Infinity
  }

  /** 换尺寸时重铺：全部从头陆续凝出来。 */
  NebbiaCondensation.prototype.build = function (W, H) {
    this.W = W
    this.H = H
    this.time = 0
    this.wetAt = -Infinity
    var n = Math.round(W * H / AREA_PER_DROP * MAX_DEW)
    var self = this
    this.list = []
    for (var i = 0; i < n; i += 1) this.list.push(this.spawn(this.rng() * FIRST_FILL))
    this.inst = new Float32Array(n * 6)
    this.gw = Math.ceil(W / CELL) + 1
    this.cells = []
    var gh = Math.ceil(H / CELL) + 1
    for (var g = 0; g < this.gw * gh; g += 1) this.cells.push([])
    this.cellOf = new Int32Array(n)
    this.list.forEach(function (d, i) { self.cellOf[i] = self.cellAt(d.x, d.y); self.cells[self.cellOf[i]].push(i) })
    this.dirty = true
  }

  NebbiaCondensation.prototype.cellAt = function (x, y) {
    var gh = this.cells.length / this.gw
    return Math.min(this.gw - 1, Math.max(0, Math.floor(x / CELL))) + Math.min(gh - 1, Math.max(0, Math.floor(y / CELL))) * this.gw
  }

  /** 每帧：扫过的几段（笔尖、手指、往下淌的水珠头）每帧擦；写好的笔画段多，跟实例一样每 UPDATE_EVERY 秒擦一次。 */
  NebbiaCondensation.prototype.touchInk = function (sweeps, wet, size) {
    if (sweeps.length) this.wipe(sweeps, 0, size)
    if (!wet.length || this.time - this.wetAt < UPDATE_EVERY) return
    this.wetAt = this.time
    this.wipe(wet, 2, size)
  }

  /**
   * 擦掉挨着这些线段（每段 5 个数：x0、y0、x1、y1、宽）的小水珠：水珠边进到线段两边 pad 以内就算。
   * 擦掉的那颗下一次更新时不再显示，REGROW_MIN–REGROW_MIN+REGROW_SPAN 秒后在原地重新凝出；快到时还被擦着就再往后推。只擦正在画的（滑杆没拉满时后面那些不管）。
   */
  NebbiaCondensation.prototype.wipe = function (segs, pad, size) {
    if (size === undefined) size = 1
    var gw = this.gw, cells = this.cells, list = this.list, time = this.time
    var gh = cells.length / gw
    var self = this
    for (var p = 0; p < segs.length; p += 5) {
      var m = segs[p + 4] / 2 + pad + 5 * size
      var x0 = Math.max(0, Math.floor((Math.min(segs[p], segs[p + 2]) - m) / CELL)), x1 = Math.min(gw - 1, Math.floor((Math.max(segs[p], segs[p + 2]) + m) / CELL))
      var y0 = Math.max(0, Math.floor((Math.min(segs[p + 1], segs[p + 3]) - m) / CELL)), y1 = Math.min(gh - 1, Math.floor((Math.max(segs[p + 1], segs[p + 3]) + m) / CELL))
      for (var gy = y0; gy <= y1; gy += 1) for (var gx = x0; gx <= x1; gx += 1) {
        var bucket = cells[gx + gy * gw]
        for (var b = 0; b < bucket.length; b += 1) {
          var i = bucket[b]
          var d = list[i]
          if (i >= this.lastCount || d.born > time + REGROW_MIN * 0.5 || segDist(d.x, d.y, segs, p) >= segs[p + 4] / 2 + pad + d.r * size) continue
          // 还看得见的，下一次更新（最多 UPDATE_EVERY 秒后）重写成 0；不立刻重画，写字时水珠纹理也还是每 50 毫秒才画一次
          if (d.born <= time) d.full = false
          d.born = time + REGROW_MIN + self.rng() * REGROW_SPAN
        }
      }
    }
  }

  /** 在随机位置凝一颗：半径 1.2–3 像素为主，少数 3–4.2 像素，越往下越密、越大。 */
  NebbiaCondensation.prototype.spawn = function (born) {
    var rng = this.rng
    var y = this.H * (1 - Math.pow(rng(), 1.4)), low = y / Math.max(1, this.H)
    var r = rng() < 0.06 + 0.08 * low ? 3 + rng() * (0.55 + 0.7 * low) : 1.2 + Math.pow(rng(), 1.5) * (1.35 + 0.4 * low)
    return { x: rng() * this.W, y: y, r: r, sy: 1 + rng() * 0.2, born: born, life: LIFE_MIN + rng() * LIFE_SPAN, full: false }
  }

  /**
   * 走 dt 秒（暂停、静止时 0），返回这一帧的水珠实例：每颗固定一格（还没凝出来、缩没了的那格宽高为 0），同一块内存的前 n 格。
   * dew 是多少（× 默认）：只画铺好的前面那一部分，拉多时多出来的那些早过了寿命，会从头慢慢凝出来；size 是大小（× 默认）。
   * 每 UPDATE_EVERY 秒才更新一次，只改正在凝出、缩没、被歌词的水擦掉的那些格，长足挂着的不动；没改时 changed 为 false。
   */
  NebbiaCondensation.prototype.instances = function (dt, dew, size) {
    if (dew === undefined) dew = 1
    if (size === undefined) size = 1
    var out = this.inst
    this.time += Math.min(dt, 0.1)
    this.sinceUpdate += Math.min(dt, 0.1)
    var now = this.time
    var n = Math.min(this.list.length, Math.round(this.list.length * dew / MAX_DEW))
    var resized = size !== this.lastSize
    var changed = this.dirty || resized || n !== this.lastCount
    if (!changed && this.sinceUpdate < UPDATE_EVERY) {
      this.changed = false
      return out.subarray(0, n * 6)
    }
    this.sinceUpdate = 0
    // 大小变了：所有格（包括这回不画的）都要按新大小重写
    if (resized) for (var z = 0; z < this.list.length; z += 1) this.list[z].full = false
    for (var i = 0; i < n; i += 1) {
      var d = this.list[i]
      if (now - d.born > GROW + d.life + FADE) {
        d = this.list[i] = this.spawn(now + this.rng() * 3)
        var c = this.cellAt(d.x, d.y), old = this.cells[this.cellOf[i]]
        old.splice(old.indexOf(i), 1)
        this.cells[c].push(i)
        this.cellOf[i] = c
      }
      var age = now - d.born
      var full = age >= GROW && age <= GROW + d.life
      if (full && d.full) continue
      // 凝出来时慢慢长大，挂够了慢慢缩没（蒸发）
      var grow = Math.min(1, Math.max(0, age / GROW)), fade = Math.min(1, Math.max(0, (GROW + d.life + FADE - age) / FADE))
      var r = d.r * size * Math.sqrt(grow) * Math.sqrt(fade)
      var w = r < 0.5 ? 0 : r * 8, o = i * 6
      out[o] = d.x; out[o + 1] = d.y; out[o + 2] = w; out[o + 3] = w * d.sy; out[o + 4] = w / 100; out[o + 5] = 1
      d.full = full
      changed = true
    }
    this.lastSize = size
    this.lastCount = n
    this.dirty = false
    this.changed = changed
    return out.subarray(0, n * 6)
  }

  // ---------- 萤虫（原版 nebbiaFireflies.ts） ----------
  // Fly：{ x, y, r（落点（在玻璃上爬时跟着挪）、半径）, app, ox, oy, zig, zf, fp（飞过来要几秒、从落点偏多远出发、
  // 横着折的幅度、折的频率、一顿一顿的相位）, hold, leave, dir, far, age（停几秒、飞走要几秒、往哪个方向飞走（弧度）、
  // 飞多远、出来了多久）, crawl（在玻璃上爬的方向）, blink, bp, tint（尾巴光一亮一暗的周期、相位、用第几个颜色）,
  // px, py, head（上一帧画在哪、头朝哪） }。

  /** 每只萤虫的实例：x、y、半径（CSS 像素）、透明度；对焦（1 = 在玻璃上，清楚）、柔光强弱、头朝向（弧度）、翅膀张开多少（0..1）；尾巴的光（0..1）、光的颜色 RGB。 */
  var FIREFLY_FLOATS = 12

  /** 屏上大约多少只（画面 1280×720 时）、大小倍数、柔光大小倍数（与 nebbia-gl.js 的 FIREFLY_HALO 一致）、飞的速度倍数、尾巴光的亮度。 */
  var fireflyParams = { count: 100, size: 1, halo: 2, speed: 1, glow: 1 }

  var TAU = Math.PI * 2
  /** 尾巴光一个周期里亮着的那段到哪结束（周期的几成） */
  var GLOW_END = 0.4
  /** 平均在玻璃上停几秒：周期平均 4.5 秒 × 平均亮 7.5 次（算出生速度用） */
  var HOLD_AVG = 4.5 * (7.5 - 1 + GLOW_END + 0.05)
  var rand = function (a, b) { return a + Math.random() * (b - a) }
  var smooth = function (t) { return t * t * (3 - 2 * t) }
  /** a 往 b 转（走近的那边），t 是转了多少（0..1）。 */
  var turn = function (a, b, t) { return a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * t }

  function NebbiaFireflies() {
    this.flies = []
    this.out = new Float32Array(0)
    this.W = 0; this.H = 0; this.k = 1
    this.spawnAcc = 0
    /** 尾巴光挑的颜色：主题的三个灯光色（nebbia-core.js 的 la、lb、lc），提亮到最亮的通道是 1；后两个固定，是窗外路灯的钠黄（SODIUM）和车灯的白 */
    this.palette = [[1, 0.81, 0.54], [0.54, 0.8, 1], [0.8, 0.54, 1], [1, 0.68, 0.32], [1, 0.95, 0.85]]
  }

  NebbiaFireflies.prototype.setPalette = function (la, lb, lc) {
    var theme = [la, lb, lc].map(function (c) {
      var m = Math.max(c[0], c[1], c[2], 0.05)
      return c.map(function (v) { return v / m })
    })
    this.palette = theme.concat(this.palette.slice(3))
  }

  NebbiaFireflies.prototype.resize = function (W, H) {
    if (W === this.W && H === this.H) return
    var first = !this.W
    var sx = W / (this.W || W), sy = H / (this.H || H)
    this.W = W; this.H = H; this.k = H / 1000
    if (first) {
      // 一开始就按稳态铺一批，各只随机已经活了一段（不然要半分钟以上才慢慢长满）；上一帧位置不算，免得第一帧头朝错
      var want = Math.round(fireflyParams.count * W * H / (1280 * 720))
      this.flies = []
      for (var i = 0; i < want; i += 1) {
        var f = this.spawn()
        f.age = Math.random() * (f.app + f.hold + f.leave); f.px = f.py = NaN
        this.flies.push(f)
      }
      return
    }
    // 窗口变了：按比例挪，不清掉（停着的要停半分钟）
    for (var j = 0; j < this.flies.length; j += 1) {
      var fl = this.flies[j]
      fl.x *= sx; fl.y *= sy; fl.px *= sx; fl.py *= sy
    }
  }

  NebbiaFireflies.prototype.spawn = function () {
    var k = this.k, s = fireflyParams.speed || 1
    // 从哪边来都有：随机方向、远近；多数从稍高处过来
    var a = Math.random() * TAU, D = rand(80, 220) * k
    var x = Math.random() * this.W, y = Math.random() * this.H, ox = Math.cos(a) * D, oy = Math.sin(a) * D - rand(0, 50) * k
    // 落上玻璃那一刻尾巴正好开始亮；亮完 5～10 次（最后一次暗下去之后）再飞走
    var app = rand(1.5, 3) / s, blink = rand(3, 6), flashes = 5 + Math.floor(Math.random() * 6)
    return {
      x: x, y: y, r: (Math.random() < 0.3 ? rand(4.5, 6) : rand(2.5, 4.5)) * k * fireflyParams.size,
      app: app, ox: ox, oy: oy, zig: rand(12, 30) * k, zf: rand(1.2, 2.2), fp: Math.random() * TAU,
      hold: blink * (flashes - 1 + GLOW_END + 0.05), leave: rand(0.8, 1.4) / s, dir: Math.random() * TAU, far: rand(120, 260) * k, age: 0,
      crawl: Math.random() * TAU, blink: blink, bp: (1 - (app / blink) % 1) % 1, tint: Math.floor(Math.random() * 5),
      px: x + ox, py: y + oy, head: Math.atan2(-oy, -ox)
    }
  }

  /** 往前走 dt 秒，排好实例：返回 [数据, 只数]。 */
  NebbiaFireflies.prototype.step = function (dt) {
    var W = this.W, H = this.H
    if (!W || !H) return [this.out, 0]
    // 按一只平均活多久算出生的速度，屏上大约稳定在 count 只（屏幕大了按面积多放）
    var want = fireflyParams.count * W * H / (1280 * 720)
    var life = 3.35 / (fireflyParams.speed || 1) + HOLD_AVG
    this.spawnAcc += dt * want / life
    for (; this.spawnAcc >= 1; this.spawnAcc -= 1) this.flies.push(this.spawn())
    // 原地剔掉飞走了的（每帧都跑，不新建数组）
    var flies = this.flies
    var n = 0
    for (var i = 0; i < flies.length; i += 1) {
      var f = flies[i]
      if ((f.age += dt) < f.app + f.hold + f.leave) { flies[n] = f; n += 1 }
    }
    flies.length = n
    if (this.out.length < n * FIREFLY_FLOATS) this.out = new Float32Array(Math.ceil(n * 1.5) * FIREFLY_FLOATS)
    for (var j = 0; j < n; j += 1) this.pack(flies[j], j * FIREFLY_FLOATS, dt)
    return [this.out, n]
  }

  /** 排一只：飞过来 → 停在玻璃上一阵一阵地爬 → 飞走。 */
  NebbiaFireflies.prototype.pack = function (f, o, dt) {
    var k = this.k
    var x = f.x, y = f.y, sc = 1, alpha = 0.92, focus = 1, flap = 0
    var p = Math.min(1, f.age / f.app), lt = (f.age - f.app - f.hold) / f.leave
    if (p < 1) {
      // 一顿一顿：进度按正弦扭一下（两头对齐，不往回走，扭到的地方几乎停住），再先快后慢地接近落点
      var c = TAU * 2.5, pe = clamp(p + 0.85 * (Math.sin(c * p + f.fp) - Math.sin(f.fp) * (1 - p) - Math.sin(c + f.fp) * p) / c), q = Math.pow(1 - pe, 2)
      // 横着折：沿路线的垂直方向忽左忽右，越近越小
      var L = Math.hypot(f.ox, f.oy) || 1, nx = -f.oy / L, ny = f.ox / L
      var z = f.zig * (1 - pe) * (Math.sin(f.age * f.zf * TAU + f.fp) + 0.5 * Math.sin(f.age * f.zf * 2.7 * TAU + f.fp * 2))
      x += f.ox * q + nx * z; y += f.oy * q + ny * z
      sc = 0.7 + 0.3 * p; alpha *= 0.45 + 0.55 * p; focus = p
      // 飞着：翅膀张开快速扇，快落上时收起来
      flap = (0.6 + 0.4 * Math.abs(Math.sin(f.age * 47 + f.fp))) * (1 - Math.pow(p, 4))
    } else if (lt < 0) {
      // 停着（尾巴亮 5～10 次）：一阵一阵地爬（爬的方向慢慢拐），偶尔抖一下翅膀
      var st = f.age - f.app, go = smooth(clamp((Math.sin(st * 0.9 + f.fp) - 0.2) / 0.4))
      // 爬的方向随机拐：按 √dt 走，和帧率无关
      f.crawl += (Math.random() - 0.5) * 0.78 * Math.sqrt(dt)
      f.x += Math.cos(f.crawl) * 7 * k * go * dt; f.y += Math.sin(f.crawl) * 7 * k * go * dt
      x = f.x; y = f.y
      flap = 0.35 * Math.max(0, Math.sin(st * 1.7 + f.fp * 3) - 0.94) / 0.06 * Math.abs(Math.sin(st * 40))
    } else {
      // 飞走：越飞越快（加速），离玻璃越远越小、越糊，最后淡没；路上也折
      var d = lt * lt * f.far, w = f.zig * 0.6 * lt * Math.sin(f.age * f.zf * TAU + f.fp)
      x += Math.cos(f.dir) * d - Math.sin(f.dir) * w
      y += Math.sin(f.dir) * d + Math.cos(f.dir) * w
      sc = 1 - 0.3 * lt; focus = 1 - lt; alpha *= 1 - Math.pow(lt, 1.5)
      flap = 0.6 + 0.4 * Math.abs(Math.sin(f.age * 47 + f.fp))
    }
    // 头朝着正在走的方向，转得有点惯性
    var mx = x - f.px, my = y - f.py
    if (mx * mx + my * my > 0.0025 * k * k) f.head = turn(f.head, Math.atan2(my, mx), Math.min(1, dt * 10))
    f.px = x; f.py = y
    // 尾巴的光：每个周期里先慢慢亮起（约一成半），再暗下去（约两成半），剩下的时候熄着
    var u = (f.age / f.blink + f.bp) % 1
    var glow = u < 0.15 ? smooth(u / 0.15) : u < GLOW_END ? 1 - smooth((u - 0.15) / (GLOW_END - 0.15)) : 0
    var out = this.out
    out[o] = x; out[o + 1] = y; out[o + 2] = f.r * sc; out[o + 3] = alpha
    out[o + 4] = focus; out[o + 5] = lt < 0 ? 1 : 1 - lt; out[o + 6] = f.head; out[o + 7] = flap
    out[o + 8] = glow * fireflyParams.glow * (lt < 0 ? 1 : 1 - lt)
    var col = this.palette[f.tint]
    out[o + 9] = col[0]; out[o + 10] = col[1]; out[o + 11] = col[2]
  }

  window.FoliaNebbiaGlass = {
    AREA_PER_DROP: AREA_PER_DROP,
    MAX_DEW: MAX_DEW,
    GROW: GROW,
    FADE: FADE,
    UPDATE_EVERY: UPDATE_EVERY,
    CELL: CELL,
    NebbiaCondensation: NebbiaCondensation,
    FIREFLY_FLOATS: FIREFLY_FLOATS,
    fireflyParams: fireflyParams,
    NebbiaFireflies: NebbiaFireflies
  }
})()
