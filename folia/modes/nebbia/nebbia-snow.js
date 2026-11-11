// 雾笺（nebbia）雪窗：移植自 folia-major src/components/visualizer/nebbia/ 的雪窗批次，合成一个 IIFE：
//   nebbiaSnowFall.ts（窗外两层雪：NebbiaSnowFall / slantOf / LAYERS）
//   nebbiaSnowFlakes.ts（雪花贴图：FLAKE_SPRITE / FLAKE_R / FLAKE_STAGES / FLAKE_FILL / buildFlakeKind / buildFlakeAtlas）
//   nebbiaSnowDraw.ts（雪花实例排布：packFlakes / packIce / packInkIce / APPROACH_Z）
//   nebbiaSnowWater.ts（raindrop-fx 改写的水珠物理 + 结冰滑落：iceParams / iceSizeScale / NebbiaSnowWater）
//   nebbiaSnowGrid.ts（水珠增量网格：NebbiaSnowGrid）
//   nebbiaSnowTrails.ts（滑落水痕：MOVE_MIN / WIPE_CLEAR / NebbiaSnowTrails）
//   nebbiaSnow.ts（雪窗总控：PEN_FLOATS / TYPE_ODDS / QUICK_MELT / waterOf / NebbiaSnow）
// 依赖（registry.js 加载顺序保证）：window.FoliaNebbiaCore（clamp / smooth / MASK_SCALE）、
//   window.FoliaNebbiaSegments（segDist）、window.FoliaNebbiaMask（ICE_FLOATS——nebbiaInkIce.ts 收的冰芯格式，
//   定义在 nebbiaInkIce.ts、由 nebbia-mask.js 导出，本文件在它之后加载）。
// FLAKE_FLOATS：上游定义在 nebbiaSnowGl.ts（本插件的 GL 绘制部分在 nebbia-gl.js，加载顺序在本文件之后），
//   所以这里按上游同值定义一份（两处必须保持一致：nebbia-gl.js 的 drawFlakes 按它解析 buffer）。
// 导出挂 window.FoliaNebbiaSnow。
(function () {
  'use strict'

  var Core = window.FoliaNebbiaCore
  var Segments = window.FoliaNebbiaSegments
  var Mask = window.FoliaNebbiaMask
  var clamp = Core.clamp
  var smooth = Core.smooth
  var MASK_SCALE = Core.MASK_SCALE
  var segDist = Segments.segDist
  /** 写字留下的水珠结的冰芯：每颗 ICE_FLOATS 个数（nebbiaInkIce.ts，nebbia-mask.js 导出）。 */
  var ICE_FLOATS = Mask.ICE_FLOATS
  /** 一片雪的实例个数（上游 nebbiaSnowGl.ts，与 nebbia-gl.js 的导出保持一致）。 */
  var FLAKE_FLOATS = 10

  // ---------- 窗外正在下的雪（上游 nebbiaSnowFall.ts） ----------
  // 融雪窗外正在下的雪（nebbiaSnow.ts 用）：远、中两层一直往下落，远的小、糊、淡、慢，中的大一点、清楚一点；
  // 跟着车速往后斜（越快越斜），左右轻轻晃，转得慢。落出画面从顶上再来。排成和玻璃上的雪一样的实例（nebbia-gl.js 画），
  // 飘过来的进度当糊的程度用（进度小 = 糊）。贴上玻璃的雪从中层里出（nebbiaSnow.ts 的 newFlake）。

  /** 两层：画面 1280×720、雪量 1 时几片，半径、下落速度（画面高 1000 时），透明度，糊的程度（飘过来的进度，越小越糊），左右晃的幅度。 */
  var LAYERS = [
    { n: 240, r: [0.9, 1.7], vy: [45, 75], alpha: 0.3, p: 0.2, sway: [1, 3] },
    { n: 70, r: [2, 3.2], vy: [95, 140], alpha: 0.5, p: 0.55, sway: [2, 5] },
  ]

  var rand = function (a, b) { return a + Math.random() * (b - a) }

  /** 车速带的风：比车速涨得快（和贴玻璃的雪用同一个）。 */
  function gustOf(wind) { return wind * (1 + 0.5 * (wind - 1)) }
  /** 风把雪往后（画面左边）带：每往下落 1 像素横着走几像素。 */
  function slantOf(wind) { return -0.45 * Math.max(0, gustOf(wind)) }

  // Falling：{ x, y, r, rot, spin, row, vy, sa, sf, sp }
  function NebbiaSnowFall(rows) {
    this.rows = rows
    this.layers = LAYERS.map(function () { return [] })
    this.W = 0
    this.H = 0
    this.k = 1
  }

  NebbiaSnowFall.prototype.resize = function (W, H) {
    this.W = W
    this.H = H
    this.k = H / 1000
    for (var i = 0; i < this.layers.length; i += 1) this.layers[i].length = 0
  }

  Object.defineProperty(NebbiaSnowFall.prototype, 'count', {
    get: function () { return this.layers[0].length + this.layers[1].length }
  })

  /** 走 dt 秒：amount 是雪量（tuning.snow，0 = 不下），wind 是车速；片数按画面大小和雪量补足、多了从末尾去掉。 */
  NebbiaSnowFall.prototype.step = function (dt, amount, wind) {
    var W = this.W, H = this.H, k = this.k
    var slant = slantOf(wind), area = W * H / (1280 * 720)
    for (var li = 0; li < LAYERS.length; li += 1) {
      var spec = LAYERS[li]
      var list = this.layers[li]
      var want = Math.round(spec.n * amount * area)
      while (list.length < want) list.push(this.make(li, Math.random() * H))
      if (list.length > want) list.length = want
      var m = 20 * k
      for (var i = 0; i < list.length; i += 1) {
        var f = list[i]
        f.y += f.vy * dt
        f.x += f.vy * slant * dt
        f.rot += f.spin * dt
        if (f.y > H + m) Object.assign(f, this.make(li, -m))
        // 被风横着带出去的从另一边进来
        if (f.x < -m) f.x += W + 2 * m; else if (f.x > W + m) f.x -= W + 2 * m
      }
    }
  }

  NebbiaSnowFall.prototype.make = function (li, y) {
    var spec = LAYERS[li], k = this.k
    return {
      x: Math.random() * this.W, y: y, r: rand(spec.r[0], spec.r[1]) * k, rot: Math.random() * Math.PI * 2, spin: rand(-0.6, 0.6),
      row: Math.floor(Math.random() * this.rows), vy: rand(spec.vy[0], spec.vy[1]) * k,
      sa: rand(spec.sway[0], spec.sway[1]) * k, sf: rand(0.8, 1.6), sp: Math.random() * Math.PI * 2,
    }
  }

  /** 排进 out（从第 0 片起）：远层在前（先画、在底下）。 */
  NebbiaSnowFall.prototype.pack = function (out, t) {
    var o = 0
    for (var li = 0; li < LAYERS.length; li += 1) {
      var spec = LAYERS[li]
      var list = this.layers[li]
      for (var i = 0; i < list.length; i += 1) {
        var f = list[i]
        out[o] = f.x + Math.sin(t * f.sf + f.sp) * f.sa
        out[o + 1] = f.y
        out[o + 2] = f.r
        out[o + 3] = f.rot
        out[o + 4] = 0
        out[o + 5] = f.row
        out[o + 6] = spec.alpha
        out[o + 7] = spec.p
        out[o + 8] = 1
        out[o + 9] = 1
        o += FLAKE_FLOATS
      }
    }
  }

  // ---------- 雪花的贴图（上游 nebbiaSnowFlakes.ts） ----------
  // 雪窗的雪花贴图（nebbiaSnow.ts 用）。落在玻璃上的雪多半不是一片干净的六角星：六成是几个小晶体黏成的不规则一团（clump），
  // 四成是枝晶（star，六根枝长短略有差别、侧枝各不一样，一半缺一两个角），都撒着霜粒。先把一片雪画成一张「密度图」（团、霜粒厚，枝梢薄），
  // 再按融化程度出 STAGES 张阶段贴图：密度低于阈值的地方（细枝、薄边）先没，剩下的越来越湿、越透、偏灰蓝，边上一圈薄水边；
  // 外面一圈很淡的暗晕，看着是贴在玻璃上。每种还记下最厚的两三处「疙瘩」，化的时候水从那里渗出来。
  // 另有冻住的水珠（bead，nebbiaSnowWater.ts 里停久了结冰的水珠）：中间一团发白的冰芯、几道放射的冰纹，边上是清的冰；
  // 它的阶段倒过来用：冻得越透阶段越靠前（冰芯从最厚的中间往外长）。
  // 全部阶段贴图拼成一张图集（每种一行、每个阶段一格），WebGL 里画（nebbia-gl.js 的 NebbiaSnowGl）。

  var FLAKE_SPRITE = 64
  /** 贴图里雪占的半径（贴图边长的比例 × 边长）。 */
  var FLAKE_R = FLAKE_SPRITE * 0.42
  var FLAKE_STAGES = 16
  /** 雪的直径占贴图边长的比例：画的时候按它缩放到雪花半径。 */
  var FLAKE_FILL = 0.84

  // FlakeKind：{ type（'clump'|'star'|'bead'）, row, stages（ImageData 数组）, lumps: [{ x, y, w }] }
  // Disc：{ x, y, r, a }；Arm：{ ang, len, w, branches: [{ at, len, ang, side }] }
  var TAU = Math.PI * 2
  var smoothstep = function (a, b, v) { var t = Math.max(0, Math.min(1, (v - a) / (b - a))); return t * t * (3 - 2 * t) }
  var canvasOf = function () { var c = document.createElement('canvas'); c.width = c.height = FLAKE_SPRITE; return c }

  /** 随机一片雪的形状：团是小晶体一个黏一个随机游走黏成的；枝晶有的缺一两个角（不做伸出去的碎断枝）。 */
  function shapeOf(type) {
    var arms = [], discs = [], specks = []
    var armWidth = rand(0.13, 0.18)
    var branchesFor = function (len) {
      var out = []
      for (var at = rand(0.2, 0.4); at < len - 0.08; at += rand(0.14, 0.28)) {
        if (Math.random() < 0.3) continue
        out.push({ at: at, len: rand(0.1, 0.3) * (1 - at), ang: rand(0.85, 1.2), side: Math.random() < 0.25 ? (Math.random() < 0.5 ? 1 : -1) : 0 })
      }
      return out
    }
    if (type === 'bead') {
      // 冻住的水珠：中间一团（冻的时候挤出来的气泡发白），周围几小团不规则，几道放射的细冰纹
      discs.push({ x: rand(-0.05, 0.05), y: rand(-0.05, 0.05), r: rand(0.45, 0.55), a: 0.95 })
      for (var i = 0, n = 4 + Math.floor(Math.random() * 3); i < n; i += 1) {
        var a = Math.random() * TAU, dd = rand(0.15, 0.32)
        discs.push({ x: Math.cos(a) * dd, y: Math.sin(a) * dd, r: rand(0.18, 0.3), a: rand(0.55, 0.8) })
      }
      for (var j = 0, m = 5 + Math.floor(Math.random() * 3); j < m; j += 1) {
        arms.push({ ang: Math.random() * TAU, len: rand(0.45, 0.75), w: rand(0.04, 0.07), branches: [] })
      }
    } else if (type === 'clump') {
      var px = 0, py = 0, pa = Math.random() * TAU
      for (var c = 0, cn = 7 + Math.floor(Math.random() * 10); c < cn; c += 1) {
        discs.push({ x: px, y: py, r: rand(0.1, 0.22), a: rand(0.6, 0.95) })
        pa += rand(-1.6, 1.6)
        var step = rand(0.07, 0.15)
        px = Math.max(-0.42, Math.min(0.42, px + Math.cos(pa) * step))
        py = Math.max(-0.42, Math.min(0.42, py + Math.sin(pa) * step))
      }
    } else {
      discs.push({ x: 0, y: 0, r: rand(0.1, 0.22), a: 0.9 })
      var base = rand(0.7, 1)
      // 缺角：一半的枝晶有一根枝短一截（四成干脆没了），少数再缺一根；断口是圆的，不留碎枝
      var chipped = new Set()
      if (Math.random() < 0.5) chipped.add(Math.floor(Math.random() * 6))
      if (chipped.size && Math.random() < 0.3) chipped.add(Math.floor(Math.random() * 6))
      for (var a2 = 0; a2 < 6; a2 += 1) {
        if (chipped.has(a2) && Math.random() < 0.4) continue
        var len = base * rand(0.86, 1) * (chipped.has(a2) ? rand(0.3, 0.6) : 1)
        arms.push({ ang: a2 * TAU / 6 + rand(-0.05, 0.05), len: len, w: armWidth * rand(0.9, 1.1), branches: branchesFor(len) })
      }
      if (Math.random() < 0.5) discs.push({ x: rand(-0.2, 0.2), y: rand(-0.2, 0.2), r: rand(0.12, 0.25), a: 0.6 })
    }
    // 霜粒：沿着枝、团上撒的小颗粒
    for (var s = 0, sn = 6 + Math.floor(Math.random() * 14); s < sn; s += 1) {
      if (arms.length && Math.random() < 0.6) {
        var arm = arms[Math.floor(Math.random() * arms.length)], at2 = Math.random() * arm.len
        specks.push({ x: Math.cos(arm.ang) * at2 + rand(-0.04, 0.04), y: Math.sin(arm.ang) * at2 + rand(-0.04, 0.04), r: rand(0.025, 0.06) })
      } else {
        var d = discs[Math.floor(Math.random() * discs.length)], aa = Math.random() * TAU, ddd = Math.random() * d.r
        specks.push({ x: d.x + Math.cos(aa) * ddd, y: d.y + Math.sin(aa) * ddd, r: rand(0.03, 0.07) })
      }
    }
    var lumps = discs.slice().sort(function (p, q) { return q.r - p.r }).slice(0, 3).map(function (dd2) { return { x: dd2.x, y: dd2.y, w: dd2.r * dd2.r } })
    var sw = 0
    for (var q = 0; q < lumps.length; q += 1) sw += lumps[q].w
    for (var q2 = 0; q2 < lumps.length; q2 += 1) lumps[q2].w /= sw
    return { arms: arms, discs: discs, specks: specks, lumps: lumps }
  }

  /** 形状画成密度图（alpha 就是厚度），先糊 blur 像素；返回 alpha 通道。 */
  function density(sh, blur) {
    var c = canvasOf(), x = c.getContext('2d')
    var R = FLAKE_R
    x.translate(FLAKE_SPRITE / 2, FLAKE_SPRITE / 2)
    x.lineCap = 'round'
    for (var i = 0; i < sh.discs.length; i += 1) {
      var d = sh.discs[i]
      var g = x.createRadialGradient(d.x * R, d.y * R, 0, d.x * R, d.y * R, d.r * R)
      g.addColorStop(0, 'rgba(255,255,255,' + d.a + ')')
      g.addColorStop(0.6, 'rgba(255,255,255,' + d.a * 0.6 + ')')
      g.addColorStop(1, 'rgba(255,255,255,0)')
      x.fillStyle = g
      x.beginPath()
      x.arc(d.x * R, d.y * R, d.r * R, 0, TAU)
      x.fill()
    }
    // 枝比团薄（密度低），化的时候先没
    for (var a = 0; a < sh.arms.length; a += 1) {
      var arm = sh.arms[a]
      x.save()
      x.rotate(arm.ang)
      x.strokeStyle = 'rgba(255,255,255,0.55)'
      x.lineWidth = arm.w * R
      x.beginPath()
      x.moveTo(0, 0)
      x.lineTo(arm.len * R, 0)
      x.stroke()
      x.strokeStyle = 'rgba(255,255,255,0.42)'
      x.lineWidth = arm.w * R * 0.75
      for (var b = 0; b < arm.branches.length; b += 1) {
        var br = arm.branches[b]
        for (var s = -1; s <= 1; s += 2) {
          if (br.side && br.side !== s) continue
          x.beginPath()
          x.moveTo(br.at * R, 0)
          x.lineTo((br.at + Math.cos(br.ang) * br.len) * R, s * Math.sin(br.ang) * br.len * R)
          x.stroke()
        }
      }
      x.restore()
    }
    x.fillStyle = 'rgba(255,255,255,0.95)'
    for (var p = 0; p < sh.specks.length; p += 1) {
      var sp = sh.specks[p]
      x.beginPath()
      x.arc(sp.x * R, sp.y * R, sp.r * R, 0, TAU)
      x.fill()
    }
    var out = canvasOf(), ox = out.getContext('2d')
    ox.filter = 'blur(' + blur + 'px)'
    ox.drawImage(c, 0, 0)
    var px = ox.getImageData(0, 0, FLAKE_SPRITE, FLAKE_SPRITE).data
    var arr = new Uint8ClampedArray(FLAKE_SPRITE * FLAKE_SPRITE)
    for (var i2 = 0; i2 < arr.length; i2 += 1) arr[i2] = px[i2 * 4 + 3]
    return arr
  }

  /** 一种雪花的全部阶段贴图：刚落的雪白、霜粒更亮、外圈淡暗晕；化的时候薄的先没，剩下的更透、偏灰蓝，边上一圈薄水边。 */
  function buildFlakeKind(type, row) {
    var sh = shapeOf(type)
    var D = density(sh, 0.35), S = density(sh, 2)
    var snow = [228, 236, 250], wetCol = [196, 212, 236], dark = [16, 20, 30]
    var stages = []
    for (var s = 0; s < FLAKE_STAGES; s += 1) {
      var m = s / (FLAKE_STAGES - 1), t = m * 0.85
      var img = new ImageData(FLAKE_SPRITE, FLAKE_SPRITE), o = img.data
      for (var i = 0; i < D.length; i += 1) {
        var d = D[i] / 255, ds = S[i] / 255
        var keep = smoothstep(t, t + 0.3, d), ice = keep * (0.88 - 0.45 * m)
        var wet = m > 0 ? smoothstep(t - 0.2, t, d) * smoothstep(0.04, 0.12, d) * (1 - keep) * 0.32 * Math.min(1, m * 2) : 0
        var halo = Math.min(1, ds * 2) * (1 - keep) * 0.2 * (1 - m)
        var a2 = ice + wet
        if (a2 + halo < 0.004) continue
        var spec = smoothstep(0.8, 1, d), a = a2 + halo * (1 - a2)
        for (var ch = 0; ch < 3; ch += 1) {
          var sc = snow[ch] + (255 - snow[ch]) * spec
          var c2 = a2 > 0 ? (sc * ice + wetCol[ch] * wet) / a2 : 0
          o[i * 4 + ch] = (c2 * a2 + dark[ch] * halo * (1 - a2)) / a
        }
        o[i * 4 + 3] = a * 255
      }
      stages.push(img)
    }
    return { type: type, row: row, stages: stages, lumps: sh.lumps }
  }

  /** 全部种类拼成一张图集：第 k 行是第 k 种，第 s 列是第 s 个阶段。 */
  function buildFlakeAtlas(kinds) {
    var c = document.createElement('canvas'), x = c.getContext('2d')
    c.width = FLAKE_SPRITE * FLAKE_STAGES
    c.height = FLAKE_SPRITE * kinds.length
    for (var k = 0; k < kinds.length; k += 1) {
      var kind = kinds[k]
      for (var s = 0; s < kind.stages.length; s += 1) x.putImageData(kind.stages[s], s * FLAKE_SPRITE, k * FLAKE_SPRITE)
    }
    return c
  }

  // ---------- 雪花怎么摆（上游 nebbiaSnowDraw.ts） ----------
  // 雪窗的雪花怎么摆（nebbiaSnow.ts 用）：每片雪算出这一帧的位置、大小、压扁、透明度、融化阶段，排成实例交给 WebGL 画（nebbia-gl.js）。

  // Flake：{ x, y, r, rot, spin, kind, age, hold, dur, melt,
  //   app, ox, oy, curl, ff, fa, fp,   // 飘过来：用 app 秒，从落点偏 (ox, oy) 处出发，路线往一侧弯 curl，飘晃频率 ff、幅度 fa、相位 fp
  //   water, drops,                    // 已经化出来的水（质量）；还在化的雪底下钉住的水珠，每处疙瘩一颗
  //   quick }                          // 落在水上：水已经并进去了，雪只是很快化没

  /**
   * 排一片雪的实例（FLAKE_FLOATS 个数，写到 out 的 o 处）：从远处飘过来，按透视变大：先是窗外远层那么小、那么淡、那么糊的一点，跟着窗外的雪往下落，
   * 越近长得越快，最后一下子变大、变清楚、贴上；一路转着、轻轻晃，快到时慢下来；
   * 贴上去轻轻压扁一下再回来，不弹；化的时候冰往上缩一点，水在底下积。
   */
  /** 飘过来时出发的地方离玻璃是贴上时的几倍远（出发时看着是贴上时的 1/这个，和窗外远层的雪差不多大）。 */
  var APPROACH_Z = 5

  function packFlake(f, out, o) {
    var x = f.x, y = f.y, r = f.r, scx = 1, scy = 1, alpha = 0.92, focus = 1
    var p = Math.min(1, f.age / f.app)
    if (p < 1) {
      // 离落点还差 q（前面像窗外的雪一样匀速落，快到才慢下来），路线往一侧弯，再加上越近越小的飘晃
      var q = (1 - p) ** 1.2
      var bend = Math.sin(Math.PI * p) * f.curl, fl = f.fa * q
      x += f.ox * q - f.oy * bend + Math.sin(f.age * f.ff + f.fp) * fl
      y += f.oy * q + f.ox * bend + Math.cos(f.age * f.ff * 0.7 + f.fp) * fl
      // 离玻璃的远近 z 匀速从 APPROACH_Z 倍减到 1，看着的大小是 1/z；清楚的程度跟着大小走（远的一直糊，最后才对上焦）；刚出现时淡入
      var s = 1 / (1 + (APPROACH_Z - 1) * (1 - p))
      r *= s
      focus = (s - 1 / APPROACH_Z) / (1 - 1 / APPROACH_Z)
      alpha *= Math.min(1, p / 0.15) * (0.35 + 0.65 * focus)
    } else {
      var e = Math.exp(-(f.age - f.app) * 14)
      scx = 1 + 0.07 * e
      scy = 1 - 0.08 * e
      y -= f.r * 0.1 * f.melt
    }
    out[o] = x
    out[o + 1] = y
    out[o + 2] = r
    out[o + 3] = f.rot
    out[o + 4] = Math.min(f.melt * (FLAKE_STAGES - 1), FLAKE_STAGES - 1.001)
    out[o + 5] = f.kind.row
    out[o + 6] = alpha
    out[o + 7] = focus
    out[o + 8] = scx
    out[o + 9] = scy
  }

  /** 全部雪排进 buf 的第 start 片起（前面留给窗外的雪；不够大时换一个更大的），返回用到的那个。 */
  function packFlakes(flakes, buf, start) {
    if (start === undefined) start = 0
    var n = start + flakes.length
    if (buf.length < n * FLAKE_FLOATS) buf = new Float32Array(Math.ceil(n * 1.5) * FLAKE_FLOATS)
    for (var i = 0; i < flakes.length; i += 1) packFlake(flakes[i], buf, (start + i) * FLAKE_FLOATS)
    return buf
  }

  /**
   * 结了冰的水珠的冰芯（nebbiaSnowWater 的 ice > 0）排在 buf 的第 start 片起：冰芯和看得见的水珠差不多大、放在水滴下面圆的那团（重心）上，冻得越透阶段越靠前
   * （bead 贴图的阶段倒过来用，冰芯从中间往外长），跟着水珠被拉长的样子压扁；返回用到的 buf 和排了几颗。
   */
  function packIce(drops, radius, beads, buf, start) {
    var n = 0
    for (var i = 0; i < drops.length; i += 1) if (drops[i].ice > 0 && !drops[i].dead) n += 1
    if (buf.length < (start + n) * FLAKE_FLOATS) {
      var next = new Float32Array(Math.ceil((start + n) * 1.5) * FLAKE_FLOATS)
      next.set(buf.subarray(0, start * FLAKE_FLOATS))
      buf = next
    }
    var o = start * FLAKE_FLOATS
    for (var j = 0; j < drops.length; j += 1) {
      var d = drops[j]
      if (!(d.ice > 0) || d.dead) continue
      var kind = beads[Math.floor(d.rot * 10) % beads.length]
      // 水珠精灵是水滴形（上面尖、下面圆），重心在圆的那团里，比水珠的位置偏下；被拉长时更靠下
      var r = radius(d)
      buf[o] = d.x
      buf[o + 1] = d.y + r * (0.42 + 0.2 * d.sy)
      buf[o + 2] = r * 1.05
      buf[o + 3] = d.rot + d.tilt
      buf[o + 4] = Math.min((1 - d.ice) * (FLAKE_STAGES - 1), FLAKE_STAGES - 1.001)
      buf[o + 5] = kind.row
      buf[o + 6] = 0.9 * Math.min(1, d.ice * 5)
      buf[o + 7] = 1
      buf[o + 8] = 1 + d.sx * 0.5
      buf[o + 9] = 1 + d.sy * 0.5
      o += FLAKE_FLOATS
    }
    return [buf, n]
  }

  /** 写字留下的水珠结的冰芯（nebbia-mask.js 收的，ICE_FLOATS 个数一颗，位置已经放好）排在 buf 的第 start 片起；返回用到的 buf 和排了几颗。 */
  function packInkIce(ice, beads, buf, start) {
    var n = ice.length / ICE_FLOATS
    if (buf.length < (start + n) * FLAKE_FLOATS) {
      var next = new Float32Array(Math.ceil((start + n) * 1.5) * FLAKE_FLOATS)
      next.set(buf.subarray(0, start * FLAKE_FLOATS))
      buf = next
    }
    for (var i = 0; i < n; i += 1) {
      var q = i * ICE_FLOATS, o = (start + i) * FLAKE_FLOATS, frozen = ice[q + 3]
      buf[o] = ice[q]
      buf[o + 1] = ice[q + 1]
      buf[o + 2] = ice[q + 2]
      buf[o + 3] = ice[q + 4]
      buf[o + 4] = Math.min((1 - frozen) * (FLAKE_STAGES - 1), FLAKE_STAGES - 1.001)
      buf[o + 5] = beads[Math.floor(Math.abs(ice[q + 4]) * 10) % beads.length].row
      buf[o + 6] = 0.9 * Math.min(1, frozen * 5) * ice[q + 5]
      buf[o + 7] = 1
      buf[o + 8] = 1
      buf[o + 9] = 1
    }
    return [buf, n]
  }

  // ---------- 雪窗水珠的网格（上游 nebbiaSnowGrid.ts） ----------
  // 雪窗水珠的网格（nebbiaSnowWater.ts 用）：增量维护（放下时进格、走动时挪格、清掉时出格），不用每帧重建；
  // 查挨着线段的（被歌词的水吸走）和某一点落在谁上（雪落在水珠上）。

  // GridItem：{ x, y, dead, cell }
  function NebbiaSnowGrid() {
    this.cells = []
    this.gw = 1
    this.gh = 1
    this.size = 30
  }

  NebbiaSnowGrid.prototype.reset = function (W, H, size) {
    this.size = size
    this.gw = Math.ceil(W / size) + 1
    this.gh = Math.ceil(H / size) + 1
    this.cells = new Array(this.gw * this.gh)
    for (var i = 0; i < this.cells.length; i += 1) this.cells[i] = []
  }

  NebbiaSnowGrid.prototype.gx = function (x) { return Math.min(this.gw - 1, Math.max(0, Math.floor(x / this.size))) }
  NebbiaSnowGrid.prototype.gy = function (y) { return Math.min(this.gh - 1, Math.max(0, Math.floor(y / this.size))) }

  NebbiaSnowGrid.prototype.place = function (d) {
    if (!this.cells.length) return
    var c = this.gx(d.x) + this.gy(d.y) * this.gw
    if (c === d.cell) return
    this.unplace(d)
    this.cells[c].push(d)
    d.cell = c
  }

  NebbiaSnowGrid.prototype.unplace = function (d) {
    if (d.cell < 0) return
    var a = this.cells[d.cell], j = a.indexOf(d)
    if (j >= 0) { a[j] = a[a.length - 1]; a.pop() }
    d.cell = -1
  }

  /** 挨着线段（每段 5 个数：x0、y0、x1、y1、宽）的：边（半径 radius）进到线段两边 pad 以内就 hit；reach 是最大的半径。 */
  NebbiaSnowGrid.prototype.alongSegments = function (segs, pad, reach, radius, hit) {
    for (var p = 0; p < segs.length; p += 5) {
      var hw = segs[p + 4] / 2, m = hw + pad + reach
      var x0 = this.gx(Math.min(segs[p], segs[p + 2]) - m), x1 = this.gx(Math.max(segs[p], segs[p + 2]) + m)
      var y0 = this.gy(Math.min(segs[p + 1], segs[p + 3]) - m), y1 = this.gy(Math.max(segs[p + 1], segs[p + 3]) + m)
      for (var gy = y0; gy <= y1; gy += 1) {
        for (var gx = x0; gx <= x1; gx += 1) {
          var cell = this.cells[gx + gy * this.gw]
          for (var i = 0; i < cell.length; i += 1) {
            var d = cell[i]
            if (!d.dead && segDist(d.x, d.y, segs, p) < hw + pad + radius(d)) hit(d)
          }
        }
      }
    }
  }

  /** (x, y) 落在谁上：半径再加 extra 以内的第一个（只查周围一圈格子），没有返回 null。 */
  NebbiaSnowGrid.prototype.at = function (x, y, extra, radius) {
    if (!this.cells.length) return null
    var cx = this.gx(x), cy = this.gy(y)
    for (var gy = Math.max(0, cy - 1); gy <= Math.min(this.gh - 1, cy + 1); gy += 1) {
      for (var gx = Math.max(0, cx - 1); gx <= Math.min(this.gw - 1, cx + 1); gx += 1) {
        var cell = this.cells[gx + gy * this.gw]
        for (var i = 0; i < cell.length; i += 1) {
          var d = cell[i]
          if (!d.dead && Math.hypot(d.x - x, d.y - y) < radius(d) + extra) return d
        }
      }
    }
    return null
  }

  // ---------- 雪窗上走动的水珠在雾上擦出的一道（上游 nebbiaSnowTrails.ts） ----------
  // 雪窗上走动的水珠在雾上擦出的一道（nebbiaSnowWater.ts 用）：只擦掉一半，宽是水珠直径的六成（全擦开的话后面清楚的街景透出来，
  // 一道道像黑条）；停下后过 hold 的一半、用 refog 的六成回雾（库里水痕上的雾也回得快），完全回雾的丢掉。

  // FogWipe：{ pts（走过的点，x、y 交错）, w, end }
  /** 走过多远才记一个点；擦掉多少（1 = 全擦开）。 */
  var MOVE_MIN = 3
  var WIPE_CLEAR = 0.5

  function NebbiaSnowTrails() {
    this.list = []
  }

  NebbiaSnowTrails.prototype.clear = function () { this.list.length = 0 }

  /** 水珠走到 (x, y)，擦痕宽 w：接着它正在擦的那一道往下记，没有就开一道新的。 */
  NebbiaSnowTrails.prototype.track = function (wipe, x, y, w) {
    if (!wipe) { var n = { pts: [x, y], w: w, end: null }; this.list.push(n); return n }
    var p = wipe.pts
    wipe.w = Math.max(wipe.w * 0.98, w)
    if (Math.hypot(x - p[p.length - 2], y - p[p.length - 1]) > MOVE_MIN) p.push(x, y)
    return wipe
  }

  /** 画进擦痕遮罩：time 是水的时钟。 */
  NebbiaSnowTrails.prototype.draw = function (ctx, time, hold, refog) {
    ctx.setTransform(MASK_SCALE, 0, 0, MASK_SCALE, 0, 0)
    for (var i = this.list.length - 1; i >= 0; i -= 1) {
      var wp = this.list[i]
      var v = wp.end === null ? 1 : 1 - smooth(clamp((time - wp.end - hold * 0.5) / (refog * 0.6)))
      if (v <= 0.002) { this.list.splice(i, 1); continue }
      var p = wp.pts
      if (p.length < 4) continue
      ctx.moveTo(p[0], p[1])
      for (var j = 2; j < p.length; j += 2) ctx.lineTo(p[j], p[j + 1])
      ctx.stroke(wp.w, v * WIPE_CLEAR)
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0)
  }

  // ---------- 雪窗玻璃上的水（上游 nebbiaSnowWater.ts） ----------
  // 雪窗玻璃上的水（nebbiaSnow.ts 用）：照 raindrop-fx（SardineFish，MIT，见 nebbiaRaindrop.LICENSE.txt）的 raindrop.ts、simulator.ts 改写，
  // 去掉 zogra 的向量，y 朝下。每颗水珠有质量、受重力、随机的阻力（挂住）和横偏，走过一段距离分出一颗小水珠留在身后（水痕上的珠串），
  // 碰到就合并、按动量算新速度，一直慢慢蒸发。尺寸、距离按库的单位（size 是精灵边长，看得见的半径约 size/4），画面高 1000 时和库的默认一样。
  // 钉住的水珠（pin）是还在化的雪底下那颗：不动，外面按化掉的量往上加质量，合并进来的照样算它的。
  // 碰到歌词的水（笔尖、往下淌的水珠、写好的笔画）就被吸走（absorb）：当作并进了歌词的水，水量不另算。
  // 走动的水珠把雾擦薄一条（NebbiaSnowTrails）。省 CPU：网格增量维护；合并只查这一帧动过、变大过的（woken）；
  // 水珠纹理只在有水珠在走、被吸走、并掉时每帧重画，别的时候（钉住的水珠慢慢长）每 FIELD_EVERY 秒一次。
  // 结冰（原型，参数在 iceParams）：停着不动够 freezeAfter 秒、够大的水珠开始从中间往外冻（ice 0→1，用 freezeDur 秒冻透），
  // 冻着的水珠蒸发得慢；冻到 SLIDE_AT 以后变重变慢，靠外面那层水贴着玻璃一点点往下挪（不再挂住，速度每颗略不同、左右轻轻晃），
  // 一直滑出画面底下；一路每隔一段身后留一颗冻住的小冰点（不滑，慢慢升华掉）。冰芯在 NebbiaSnow 里排成雪花实例画（bead 贴图）。

  // WaterDrop：{ x, y, vx, vy, mass, density, sx, sy, resist, shift, nextMotion, lastTx, lastTy, nextTrail,
  //   parent, dead, pin, wipe, awake, cell, wokeMass, wokeX, wokeY, still, ice, iceV, rot, speck, iceDur, slid, tilt }

  /**
   * 结冰的参数：停多久开始冻、多久冻透（秒）；往下挪多快（画面高 1000 时每秒像素）；多大的水珠才冻（看得见的半径，画面高 1000 时）；
   * 冻透时看得见的半径是原来的几倍（grow，水的透镜收成更小更实的冰珠，小于 1）；看得见的半径大于 spinR（画面高 1000 时）的冰珠滑的时候左右来回转，最多转 spin 弧度。
   */
  var iceParams = { freezeAfter: 1.5, freezeDur: 3, slide: 3, minR: 2.5, grow: 0.75, spinR: 7.5, spin: 0.35, maxIce: 200, off: false }
  /** 冻到多少开始往下挪。 */
  var SLIDE_AT = 0.3
  /** 开始冻、冻透的时间按水珠大小（取对数）放长：看得见的半径刚到 minR 的照 freezeAfter、freezeDur 的秒数，大一倍的约 1.7 倍、大三倍的约 2.4 倍（大水珠难冻一些）。r 是看得见的半径，k 是画面高 / 1000。 */
  function iceSizeScale(r, k) { return 1 + Math.log(Math.max(1, r / (Math.max(0.5, iceParams.minR) * k))) }
  /** 窗上最多留多少颗小冰点（冰珠上限 iceParams.maxIce 的几倍）：冻住的蒸发得慢，一颗能挂二十来秒，不封顶会攒到几千颗。到顶了滑的就先不留，旧的化掉再留。 */
  var SPECKS_PER_ICE = 1.5

  /** 没有水珠在走时，水珠纹理多久重画一次（秒）。 */
  var FIELD_EVERY = 0.05

  function NebbiaSnowWater() {
    this.drops = []
    this.trails = new NebbiaSnowTrails()
    this.woken = []
    /** 水珠纹理：这回改没改；有没有要立刻重画的（走动、吸走、并掉）；上次重画的时刻；最大的水珠看得见的半径（吸水时查多远）。 */
    this.changed = true
    this.urgent = true
    this.fieldAt = -Infinity
    this.maxR = 40
    this.grid = new NebbiaSnowGrid()
    this.W = 1
    this.H = 1
    /** 画面高 / 1000：库的像素参数按它缩放。 */
    this.k = 1
    this.time = 0
    /** 上一帧窗上的小冰点数（MAX_SPECKS 用）。 */
    this.specks = 0
    /** 上一帧在冻、在滑的冰珠数（不算小冰点）：到 iceParams.maxIce 了新的先不冻。冰珠蒸发得慢、滑得慢，不封顶会攒到上千颗，又碍眼又费 CPU。 */
    this.frozen = 0
    /** 打滑程度（库的 slipRate，0..1）。雪窗用 0：挂得最牢，化出的水多半留在原地，要并得很大才往下滑。 */
    this.slip = 0
    /** 能滑的最小质量（画面高 1000 时）：库里没有这个门槛，小水珠也会随机滑一小段，雪窗水珠多，满屏都是一道道水痕。 */
    this.stick = 1600
    /** 按面积蒸发的时间常数（秒）。 */
    this.evapTau = 150
    /**
     * 沿边蒸发（每秒质量，乘 k·√质量，画面高 1000 时）：水从边上蒸发，小水珠相对边长多、干得快。
     * 一片常见的雪化出的水十来秒干，雪一直下时玻璃上的水二十来秒就稳住（库里每秒固定蒸发一点，小水珠要挂四五十秒，满屏越攒越多）。
     */
    this.evapEdge = 2.6
    /**
     * 一颗水珠最多多大（画面高 1000 时，看得见的半径 18；按 size 算，质量上限是 (这个 × 密度)²）：滑下去的水珠一路并掉别的会越滚越大，滑得越宽并得越多，
     * 到这么大以后多出来的当作摊成一层薄水膜流走，不再长（不然雪大、水多时能滚出半径近百像素的水珠、擦出一道道宽痕）。
     */
    this.maxSize = 72
  }

  NebbiaSnowWater.prototype.resize = function (W, H) {
    if (W === this.W && H === this.H) return
    this.W = W
    this.H = H
    this.k = H / 1000
    this.grid.reset(W, H, 70 * this.k * 0.3)
    this.drops.length = 0
    this.trails.clear()
    this.woken = []
    this.urgent = true
    this.maxR = 40 * this.k
  }

  /** 放一颗水珠：size 是精灵边长（看得见的半径约 size/4）。 */
  NebbiaSnowWater.prototype.spawn = function (x, y, size, density, spread) {
    if (density === undefined) density = 1
    if (spread === undefined) spread = 0.5
    var d = {
      x: x, y: y, vx: 0, vy: 0, mass: (size * density) * (size * density), density: density, sx: spread, sy: spread,
      resist: 0, shift: 0, nextMotion: 0, lastTx: x, lastTy: y, nextTrail: rand(20, 30) * this.k,
      parent: null, dead: false, pin: null, wipe: null, awake: false, cell: -1, wokeMass: 0, wokeX: 0, wokeY: 0,
      still: 0, ice: 0, iceV: 1, iceDur: 1, rot: Math.random() * Math.PI * 2, speck: false, slid: 0, tilt: 0,
    }
    this.drops.push(d)
    this.grid.place(d)
    this.wake(d)
    return d
  }

  /** 变大了（外面加了水）或刚放下：这一帧查合并。 */
  NebbiaSnowWater.prototype.wake = function (d) {
    if (!d.awake && !d.dead) { d.awake = true; d.wokeMass = d.mass; d.wokeX = d.x; d.wokeY = d.y; this.woken.push(d) }
  }

  /**
   * 慢慢变大（还在化的雪往底下钉住的水珠里一点点加水）：比上次查合并时重了 5% 以上才再查。
   * 合并距离和半径成正比，每帧长那一点点碰不上新的水珠，不用每帧都查。
   */
  NebbiaSnowWater.prototype.grew = function (d) { if (d.mass > d.wokeMass * 1.05) this.wake(d) }

  /** 外面直接拿走一颗（雪被抹掉时它底下的水珠）：水珠纹理立刻重画。 */
  NebbiaSnowWater.prototype.kill = function (d) { d.dead = true; this.urgent = true }

  /** 精灵边长（横、竖）。 */
  NebbiaSnowWater.prototype.size = function (d) {
    return [this.sizeX(d), (d.sy + 1) * Math.sqrt(Math.max(0, d.mass)) / d.density]
  }
  /** 精灵横向边长（热路径用，不分配数组）。 */
  NebbiaSnowWater.prototype.sizeX = function (d) { return (d.sx + 1) * Math.sqrt(Math.max(0, d.mass)) / d.density }

  NebbiaSnowWater.prototype.step = function (dt) {
    if (dt <= 0) return
    this.time += dt
    // 摊开每秒收回到 1%：这一帧的倍数所有水珠一样，算一次
    var spread = 0.01 ** dt
    for (var i = 0; i < this.drops.length; i += 1) if (!this.drops[i].dead) this.move(this.drops[i], dt, spread)
    this.collide()
    var specks = 0, frozen = 0
    for (var j = 0; j < this.drops.length; j += 1) {
      var d = this.drops[j]
      if (d.speck) specks += 1
      else if (d.ice > 0) frozen += 1
    }
    this.specks = specks
    this.frozen = frozen
    for (var i2 = this.drops.length - 1; i2 >= 0; i2 -= 1) {
      var d2 = this.drops[i2]
      if (!d2.dead) continue
      this.endWipe(d2)
      this.grid.unplace(d2)
      this.drops[i2] = this.drops[this.drops.length - 1]
      this.drops.pop()
    }
  }

  // 一颗水珠走 dt 秒（库的 updateRaindrop）
  NebbiaSnowWater.prototype.move = function (d, dt, spread) {
    var k = this.k
    // 库里每秒蒸发固定一点；这里改成沿边蒸发（小水珠干得快），再按面积（和质量成正比）多蒸发一点：大水珠也会慢慢缩，雪一直下也不会越积越大、越流越多
    d.mass = Math.min(d.mass, this.massCap(d))
    // 冻着的蒸发得慢（冻透的只剩一点升华）
    d.mass -= (this.evapEdge * k * Math.sqrt(Math.max(0, d.mass)) + d.mass / this.evapTau) * dt * (1 - 0.85 * d.ice)
    if (d.mass <= 0) { d.dead = true; return }
    d.sx *= spread
    d.sy *= spread
    if (d.pin) { d.x = d.pin.x; d.y = d.pin.y; d.vx = 0; d.vy = 0; d.still = 0; return }
    if (this.freeze(d, dt)) return
    // 停着的轻水珠挂住不动：不用算受力（雪窗玻璃上绝大多数水珠都这样）
    if (d.vy === 0 && d.mass < this.stick * k * k) { if (d.wipe) this.endWipe(d); return }
    if (this.time >= d.nextMotion) {
      d.nextMotion = this.time + rand(0.1, 0.4)
      // 库里按生成尺寸 spawnSize 插值；雪窗没有库自己生成的雨，用 [30, 70]（和 demo 一样）
      var maxResist = (30 + 40 * (1 - this.slip)) * (30 + 40 * (1 - this.slip)) * k * k * 4
      d.resist = Math.random() * 2400 * k * maxResist
      d.shift = Math.random() * rand(0, 0.1)
      // 不够重的水珠挂住不动（真玻璃上小水珠靠挂壁力粘着，要并大了才滑）；正在滑的掉到门槛以下也很快停下
      if (d.mass < this.stick * k * k) d.resist = Math.max(d.resist, 2 * 2400 * k * d.mass)
    }
    var acc = (2400 * k * d.mass - d.resist) / d.mass
    d.vy = Math.max(0, d.vy + acc * dt)
    d.vx = d.vy * d.shift
    d.x += d.vx * dt
    d.y += d.vy * dt
    d.sy = Math.max(d.sy, 0.3 * 2 * Math.atan(d.vy * 0.005) / Math.PI)
    if (d.y > this.H + 100) { d.dead = true; return }
    this.grid.place(d)
    if (d.vy > 8 * k) { d.wipe = this.trails.track(d.wipe, d.x, d.y, this.sizeX(d) * 0.3); this.wake(d); this.urgent = true } else this.endWipe(d)
    if (Math.hypot(d.x - d.lastTx, d.y - d.lastTy) > d.nextTrail) this.split(d)
  }

  /** 结冰：停够了开始冻、冻着的往下挪；挪动由这里管了返回 true（不再走库的受力）。 */
  NebbiaSnowWater.prototype.freeze = function (d, dt) {
    var p = iceParams, k = this.k
    if (d.speck) { d.ice = 1; return true }
    if (d.ice === 0) {
      if (p.off || d.vy > 0 || this.sizeX(d) / 4 < p.minR * k) { d.still = 0; return false }
      d.still += dt
      var scale = iceSizeScale(this.sizeX(d) / 4, k)
      if (d.still < p.freezeAfter * scale || this.frozen >= p.maxIce) return false
      this.frozen += 1
      d.ice = 1e-3
      d.iceV = rand(0.65, 1.35)
      d.iceDur = Math.max(1, p.freezeDur * scale)
    }
    // 冻的时候水的透镜慢慢收成冰珠，冻透时看着是原来的 grow 倍（质量 grow² 倍）
    if (d.ice < 1) d.mass = Math.min(this.massCap(d), d.mass * Math.max(0.25, p.grow) ** (2 * dt / d.iceDur))
    d.ice = Math.min(1, d.ice + dt / d.iceDur)
    if (d.ice < SLIDE_AT) { d.vx = 0; d.vy = 0; return true }
    // 往下挪：开头慢慢起步，左右轻轻晃
    var v = p.slide * k * d.iceV * Math.min(1, (d.ice - SLIDE_AT) / 0.15)
    d.vy += (v - d.vy) * Math.min(1, dt * 2)
    d.vx = Math.sin(this.time * 0.7 + d.rot * 5) * d.vy * 0.15
    d.x += d.vx * dt
    d.y += d.vy * dt
    if (d.y > this.H + 100) { d.dead = true; return true }
    // 大冰珠滑的时候左右来回转（冰块在水膜里被玻璃蹭着晃）：越大转得越多，滑一段来回一次；小的慢慢转回去
    d.slid += d.vy * dt
    var over = this.sizeX(d) / 4 / k - p.spinR
    var amp = over > 0 ? p.spin * Math.min(1, over / 6) : 0
    d.tilt += (amp * Math.sin(d.slid / (14 * k) + d.rot * 3) - d.tilt) * Math.min(1, dt * 3)
    this.grid.place(d)
    // 冰珠滑得慢（每帧零点几像素）：走过 1 像素或者长大 5% 才再查合并；
    // 慢的不催水珠纹理每帧重画，照常每 FIELD_EVERY 秒一次（落后不到 0.25 像素），快的才催
    if (Math.abs(d.x - d.wokeX) + Math.abs(d.y - d.wokeY) > k) this.wake(d); else this.grew(d)
    if (d.vy * FIELD_EVERY > 0.25 * k) this.urgent = true
    // 身后每隔一段留一颗冻住的小冰点
    if (Math.hypot(d.x - d.lastTx, d.y - d.lastTy) > d.nextTrail && d.mass > 300 * k * k && this.specks < p.maxIce * SPECKS_PER_ICE) {
      var t = this.spawn(d.x + rand(-1.5, 1.5) * k, d.y - this.sizeX(d) / 4, this.sizeX(d) * rand(0.18, 0.3), 1, 0)
      t.speck = true
      t.ice = 1
      t.parent = d
      d.mass -= t.mass
      d.lastTx = d.x
      d.lastTy = d.y
      d.nextTrail = rand(10, 18) * k
      this.specks += 1
    }
    return true
  }

  // 走过一段，身后分出一颗小水珠（库的 split）
  NebbiaSnowWater.prototype.split = function (d) {
    if (d.mass < 1000 * this.k * this.k) return
    var wh = this.size(d)
    var w = wh[0], h = wh[1]
    var t = this.spawn(d.x + rand(-5, 5) * this.k, d.y - h / 4, w * rand(0.3, 0.5), 0.2, 0)
    t.sx = 0.1
    t.sy = d.vy * 0.01 * 0.6
    t.parent = d
    d.mass -= t.mass
    d.lastTx = d.x
    d.lastTy = d.y
    d.nextTrail = rand(20, 30) * this.k
  }

  // 停下来了：它擦的那一道记下停的时刻，开始回雾
  NebbiaSnowWater.prototype.endWipe = function (d) {
    if (d.wipe && d.wipe.end === null) d.wipe.end = this.time
    d.wipe = null
  }

  // 碰到就合并：大的吃掉小的，动量守恒（库的 collisionUpdate）。只拿这一帧动过、变大过（或刚放下）的去查
  NebbiaSnowWater.prototype.collide = function () {
    var cells = this.grid.cells, gw = this.grid.gw, gh = this.grid.gh, cellSize = this.grid.size
    var list = this.woken
    this.woken = []
    for (var i = 0; i < list.length; i += 1) {
      var d = list[i]
      d.awake = false
      if (d.dead) continue
      var cx = Math.floor(d.x / cellSize), cy = Math.floor(d.y / cellSize), md = this.mergeDistance(d)
      for (var gy = cy - 1; gy <= cy + 1; gy += 1) {
        for (var gx = cx - 1; gx <= cx + 1; gx += 1) {
          if (gx < 0 || gy < 0 || gx >= gw || gy >= gh) continue
          var cell = cells[gx + gy * gw]
          for (var c = 0; c < cell.length; c += 1) {
            var o = cell[c]
            if (o === d || o.dead || o.parent === d || d.parent === o || (d.parent && d.parent === o.parent)) continue
            if (Math.hypot(d.x - o.x, d.y - o.y) >= md + this.mergeDistance(o)) continue
            var big, small
            if (d.mass >= o.mass) { big = d; small = o } else { big = o; small = d }
            var m = big.mass + small.mass
            big.vx = (big.vx * big.mass + small.vx * small.mass) / m
            big.vy = (big.vy * big.mass + small.vy * small.mass) / m
            // 密度按质量平均：拖尾留下的小珠（密度 0.2）并进来一颗比它还轻的水珠时，不会一下子显得大 5 倍
            big.density = (big.density * big.mass + small.density * small.mass) / m
            big.mass = Math.min(m, this.massCap(big))
            // 冰按质量平均（大的冰珠吃掉水珠就化掉一些）；没冻的水珠吃掉冰珠、小冰点，冰就化进水里，要冻照常停够了再冻（不绕过上限和时间）。
            // 小冰点并进别的就不再是小冰点
            big.ice = big.ice > 0 ? (big.ice * (m - small.mass) + small.ice * small.mass) / m : 0
            if (big.ice < 1e-3) big.ice = 0
            big.speck = big.speck && small.speck
            small.dead = true
            this.urgent = true
            this.wake(big)
            if (small === d) break
          }
          if (d.dead) break
        }
        if (d.dead) break
      }
    }
  }

  /**
   * 吸走挨着这些线段的水珠（每段 5 个数：x0、y0、x1、y1、宽）：水珠边碰到线段两边 pad 以内就算。
   * 只查线段附近几格；吸走的这一帧不再画，下一次 step 清掉。
   */
  NebbiaSnowWater.prototype.absorb = function (segs, pad) {
    var self = this
    this.grid.alongSegments(segs, pad, this.maxR, function (d) { return self.sizeX(d) / 4 }, function (d) { self.kill(d) })
  }

  /** (x, y) 落在哪颗水珠上：看得见的半径再加 extra 以内的第一颗，没有返回 null。 */
  NebbiaSnowWater.prototype.near = function (x, y, extra) {
    var self = this
    return this.grid.at(x, y, extra, function (d) { return self.sizeX(d) / 4 })
  }

  NebbiaSnowWater.prototype.massCap = function (d) {
    var s = this.maxSize * this.k * d.density
    return s * s
  }

  NebbiaSnowWater.prototype.mergeDistance = function (d) { return this.sizeX(d) * (1 + d.sx) * 0.16 }

  /** 水珠走过的地方把雾擦薄（NebbiaSnowTrails）。 */
  NebbiaSnowWater.prototype.drawFog = function (ctx, hold, refog) { this.trails.draw(ctx, this.time, hold, refog) }

  /** 水珠实例（nebbiaDrops.ts 的格式：x、y、宽、高、折射强度、alpha）：看得见的半径 size/4，四边形是它的 8 倍。 */
  /** 没变到要重画时原样返回 out、changed 为 false。 */
  NebbiaSnowWater.prototype.instances = function (out) {
    this.changed = this.urgent || this.time - this.fieldAt >= FIELD_EVERY
    if (!this.changed) return out
    this.urgent = false
    this.fieldAt = this.time
    out.length = 0
    var maxR = 0
    for (var i = 0; i < this.drops.length; i += 1) {
      var d = this.drops[i]
      var s = Math.sqrt(Math.max(0, d.mass)) / d.density, w = (d.sx + 1) * s, h = (d.sy + 1) * s
      if (w < 2 || d.dead) continue
      out.push(d.x, d.y, w * 2, h * 2, w / 50, 1)
      maxR = Math.max(maxR, w / 4)
    }
    this.maxR = maxR + 2 * this.k
    return out
  }

  // ---------- 雪窗总控（上游 nebbiaSnow.ts） ----------
  // 雪窗（tuning.glass = 'snow'）：窗外一直在下雪（远、中两层，NebbiaSnowFall，水族箱里不下）；贴上玻璃的雪从中层里出：跟着往下落、被风往后斜，
  // 最后一小段被风带向玻璃，越近越大、越清楚、越慢，轻轻贴上玻璃粘住；粘一会儿开始化，细枝、薄边先没，
  // 化出来的水从最厚的几处渗出来，在原地长成几颗钉住的水珠（NebbiaSnowWater），化完放开，照 raindrop-fx 的物理走。
  // 和歌词的水联动：写字的笔尖、抹字的手指、从笔画往下淌的水珠扫过时，雪当帧化开、连同那里的水珠一起被吸走（当作并进了歌词的水，水量不另算）；
  // 写好的笔画边上不另积雪水（挨着的雪水被笔画吸走）。落在水上的雪（雪化的水珠、还挂着水珠的笔画、往下淌的水珠、笔尖）
  // 一沾水就化，QUICK_MELT 秒化完，水并进那里的水。慢慢显现的字没有手指、不带水珠，雪不受影响。
  // 雪花六成是小团、四成是枝晶（buildFlakeKind），在 WebGL 里被身后的光照着画（packFlakes 排实例、nebbia-gl.js 的 drawFlakes 画）。

  /** 一段线：5 个数 x0、y0、x1、y1、宽（CSS 像素）。扫过的（sweeps）和写好的笔画（wet）都是这个格式，nebbia-mask.js 收。 */
  var PEN_FLOATS = 5

  /** 备几种贴图（图集一行一种）；每片雪先按 TYPE_ODDS 抽类型，再在这类里随便挑一种。 */
  var KIND_TYPES = ['clump', 'clump', 'clump', 'clump', 'clump', 'clump', 'clump', 'star', 'star', 'star', 'star', 'star']
  var TYPE_ODDS = [['clump', 0.6], ['star', 1]]
  /** 落在水上的雪几秒化完。 */
  var QUICK_MELT = 0.25
  /**
   * 一片雪化完的水（质量）：水珠看得见的半径和雪花半径是对数关系，常见大小（2.5–6，画面高 1000 时）差不多等于雪花半径，
   * 雪花调大时水只慢慢多（半径 12 的雪只化出半径 8 的水珠），不会一下子满屏大水。size 是精灵边长，看得见的半径是它的 1/4。
   */
  function waterOf(r, k) {
    var inner = 4 * 4.5 * Math.log(1 + r / k / 2.5) * k
    return inner * inner
  }
  var TAU_SNOW = Math.PI * 2

  function NebbiaSnow() {
    var self = this
    this.kinds = KIND_TYPES.map(function (type, i) { return buildFlakeKind(type, i) })
    /** 冻住的水珠的冰芯（图集里排在雪花后面）。 */
    this.beads = [0, 1, 2].map(function (i) { return buildFlakeKind('bead', KIND_TYPES.length + i) })
    this.byType = new Map()
    TYPE_ODDS.forEach(function (pair) {
      var type = pair[0]
      self.byType.set(type, self.kinds.filter(function (k) { return k.type === type }))
    })
    this.inst = new Float32Array(0)
    this.water = new NebbiaSnowWater()
    this.fall = new NebbiaSnowFall(KIND_TYPES.length)
    this.flakes = []
    this.spawnAcc = 0
    this.W = 0
    this.H = 0
    this.k = 1
    /** 自己的时钟、上次按写好的笔画吸水的时刻（笔画段多，每 0.05 秒吸一次就够）。 */
    this.clock = 0
    this.wetAt = -Infinity
    this.sweepBox = [0, 0, 0, 0]
  }

  /** 尺寸真变了才清空玻璃上的雪和水（只换像素比、渲染倍数时不清）。 */
  NebbiaSnow.prototype.resize = function (W, H) {
    if (W === this.W && H === this.H) return
    this.W = W
    this.H = H
    this.k = H / 1000
    this.water.resize(W, H)
    this.fall.resize(W, H)
    this.flakes = []
  }

  /**
   * 全部贴图拼成的图集（buildFlakeAtlas），和有几行。只在建运行时调一次：拼完就放掉各阶段的贴图（共约 4 MB），
   * 之后只用图集里的行号和水先渗出的几处（lumps）；WebGL 上下文丢了是整个运行时重建，连这里一起重新生成。
   */
  NebbiaSnow.prototype.atlas = function () {
    var all = this.kinds.concat(this.beads)
    var canvas = buildFlakeAtlas(all)
    for (var i = 0; i < all.length; i += 1) all[i].stages = []
    return [canvas, all.length]
  }

  /**
   * 走 dt 秒（暂停、静止时 0）：落新雪、化雪、长水；sweeps 是这一帧扫过的几段（抹雪、吸水），wet 是写好的笔画（只吸水），暂停时也照样算。
   * wind 是车速带的风（雨夜街景里是 tuning.busSpeed，水族箱里 0）；outside 为假（水族箱）时窗外不下雪，只有贴上玻璃的。
   */
  NebbiaSnow.prototype.step = function (dt, t, sweeps, wet, wind, outside) {
    if (outside === undefined) outside = true
    this.fall.step(dt, outside ? t.snow : 0, wind)
    this.spawnAcc += dt * t.snow * 25 * this.W * this.H / (1280 * 720)
    for (; this.spawnAcc >= 1; this.spawnAcc -= 1) this.flakes.push(this.newFlake(t, wind))
    this.boxOf(sweeps)
    for (var i = this.flakes.length - 1; i >= 0; i -= 1) {
      var f = this.flakes[i]
      var landing = f.age < f.app
      f.age += dt
      if (f.age < f.app) { f.rot += f.spin * (1 - f.age / f.app) * dt; continue }
      if (landing && this.landsInWater(f, sweeps, wet)) f.quick = true
      if (f.quick) f.melt = Math.min(1, f.melt + dt / QUICK_MELT)
      if (f.quick ? f.melt >= 1 : this.wiped(f, sweeps) || (f.age >= f.app + f.hold && this.melt(f, dt * t.snowMelt))) {
        this.flakes[i] = this.flakes[this.flakes.length - 1]
        this.flakes.pop()
      }
    }
    this.water.step(dt)
    this.clock += dt
    if (sweeps.length) this.water.absorb(sweeps, 0)
    if (wet.length && this.clock - this.wetAt >= 0.05) { this.wetAt = this.clock; this.water.absorb(wet, 3 * this.k) }
  }

  // 一片雪：大的三成、半径 4.5–6，小的 2.5–4.5（画面高 1000 时）；多数粘上去很快就化，少数挂很久，大的化得慢
  NebbiaSnow.prototype.newFlake = function (t, wind) {
    var k = this.k
    var u = Math.random(), type = 'clump'
    for (var i = 0; i < TYPE_ODDS.length; i += 1) {
      if (u < TYPE_ODDS[i][1]) { type = TYPE_ODDS[i][0]; break }
    }
    var pool = this.byType.get(type)
    var r = (Math.random() < 0.3 ? rand(4.5, 6) : rand(2.5, 4.5)) * k * t.snowSize
    // 从远处飘过来（packFlake 按透视变大）：一路和窗外远层的雪一样速度往下落，出发点在落点上方，按风的斜度往前（车头方向）偏，越快偏得越远；越快落得越快、路线越直、晃得越小；
    // 只往一侧轻轻弯一点（最后一小段被风带向玻璃），慢慢转
    var app = rand(2, 3.2) / (0.75 + 0.25 * wind), fall = rand(45, 75) * k * app, calm = 1 / (0.6 + 0.4 * wind)
    return {
      x: Math.random() * this.W, y: Math.random() * this.H, r: r, rot: Math.random() * TAU_SNOW, spin: rand(-1.33, 1.33) * (0.7 + 0.3 * wind),
      kind: pool[Math.floor(Math.random() * pool.length)],
      app: app, ox: rand(-15, 15) * k - slantOf(wind) * fall, oy: -fall,
      curl: rand(-0.2, 0.2) * calm, ff: rand(1.5, 3.5), fa: rand(1, 4) * k * calm, fp: Math.random() * TAU_SNOW,
      age: 0, hold: 0.3 + Math.random() ** 2.5 * 7, dur: rand(2.5, 4.5) + r / k * 0.18, melt: 0, water: 0, drops: null, quick: false,
    }
  }

  /** 化 rate × dt / dur：水从疙瘩渗出来、按比例分给还在的那几颗水珠；化完放开水珠，返回 true。 */
  NebbiaSnow.prototype.melt = function (f, amount) {
    f.melt = Math.min(1, f.melt + amount / f.dur)
    var total = waterOf(f.r, this.k) * f.melt, delta = total - f.water
    f.water = total
    if (!f.drops && f.melt > 0.12) {
      var lumps0 = f.kind.lumps
      f.drops = lumps0.map(function (l) {
        var xy = this.lumpAt(f, l)
        var d = this.water.spawn(xy[0], xy[1], Math.sqrt(Math.max(1, total * l.w)), 1, 0)
        d.pin = { x: xy[0], y: xy[1] }
        return d
      }, this)
    } else if (f.drops) {
      var lumps = f.kind.lumps, drops = f.drops
      var sw = 0
      for (var j = 0; j < drops.length; j += 1) {
        var d0 = drops[j]
        if (d0 && d0.dead) drops[j] = null
        else if (d0) sw += lumps[j].w
      }
      for (var j2 = 0; j2 < drops.length; j2 += 1) {
        var d1 = drops[j2]
        if (d1) { d1.mass += delta * lumps[j2].w / (sw || 1); this.water.grew(d1) }
      }
    }
    if (f.melt < 1) return false
    var rest = f.drops || []
    for (var q = 0; q < rest.length; q += 1) if (rest[q]) rest[q].pin = null
    return true
  }

  /** 疙瘩的位置转过雪花的角度，再往下挪一点（水往下坠）。 */
  NebbiaSnow.prototype.lumpAt = function (f, l) {
    var s = f.r * 2 / (FLAKE_SPRITE * FLAKE_FILL) * FLAKE_R, c = Math.cos(f.rot), sn = Math.sin(f.rot)
    return [f.x + (l.x * c - l.y * sn) * s, f.y + (l.x * sn + l.y * c) * s + f.r * 0.25]
  }

  /** 刚落下就沾到水：歌词的水（扫过的、写好的笔画）或一颗水珠；沾到水珠的话雪的水并进那颗。 */
  NebbiaSnow.prototype.landsInWater = function (f, sweeps, wet) {
    if (this.touches(f, sweeps) || this.touches(f, wet)) return true
    var d = this.water.near(f.x, f.y, f.r * 0.6)
    if (d) { d.mass += waterOf(f.r, this.k); this.water.wake(d) }
    return d !== null
  }

  NebbiaSnow.prototype.touches = function (f, segs) {
    for (var p = 0; p < segs.length; p += PEN_FLOATS) if (segDist(f.x, f.y, segs, p) < segs[p + 4] / 2 + f.r * 0.6) return true
    return false
  }

  /** 这一帧扫过的几段合起来的外框（含线宽的一半）：框外的雪不用一段段算距离。 */
  NebbiaSnow.prototype.boxOf = function (segs) {
    var b = this.sweepBox
    b[0] = b[1] = Infinity
    b[2] = b[3] = -Infinity
    for (var p = 0; p < segs.length; p += PEN_FLOATS) {
      var hw = segs[p + 4] / 2
      b[0] = Math.min(b[0], segs[p] - hw, segs[p + 2] - hw)
      b[1] = Math.min(b[1], segs[p + 1] - hw, segs[p + 3] - hw)
      b[2] = Math.max(b[2], segs[p] + hw, segs[p + 2] + hw)
      b[3] = Math.max(b[3], segs[p + 1] + hw, segs[p + 3] + hw)
    }
  }

  /** 扫到这片雪：雪当帧化开，水（包括底下已经化出的水珠）当作并进了歌词的水，不在玻璃上留下。 */
  NebbiaSnow.prototype.wiped = function (f, sweeps) {
    var b = this.sweepBox, m = f.r * 0.6
    if (f.x + m < b[0] || f.x - m > b[2] || f.y + m < b[1] || f.y - m > b[3]) return false
    for (var p = 0; p < sweeps.length; p += PEN_FLOATS) {
      if (segDist(f.x, f.y, sweeps, p) > sweeps[p + 4] / 2 + f.r * 0.6) continue
      var rest = f.drops || []
      for (var i = 0; i < rest.length; i += 1) if (rest[i]) this.water.kill(rest[i])
      return true
    }
    return false
  }

  /** 水珠走过的地方擦开雾（画进擦痕遮罩），停下后保持 hold 秒、用 refog 秒回雾。 */
  NebbiaSnow.prototype.drawFog = function (ctx, t) { this.water.drawFog(ctx, t.hold, t.refog) }

  /** 水珠实例，画进水珠纹理（和雨窗的凝结水珠同一个位置）。 */
  NebbiaSnow.prototype.instances = function (out) { return this.water.instances(out) }

  Object.defineProperty(NebbiaSnow.prototype, 'changed', {
    /** 上一次 instances() 改没改水珠（没改时水珠纹理不用重画）。 */
    get: function () { return this.water.changed }
  })

  /**
   * 这一帧的雪花实例（packFlakes 排、nebbia-gl.js 的 drawFlakes 画）：窗外的雪在前（画在底下），再是贴玻璃的，最后是结了冰的水珠的冰芯
   * （雪化成的水珠，和写字留下的水珠：inkIce 是 nebbia-mask.js 收的冰芯数据）；数据和片数。
   */
  NebbiaSnow.prototype.flakeInstances = function (inkIce) {
    if (inkIce === undefined) inkIce = []
    var self = this
    var n = this.fall.count
    this.inst = packFlakes(this.flakes, this.inst, n)
    this.fall.pack(this.inst, this.clock)
    var count = n + this.flakes.length, more
    var r1 = packIce(this.water.drops, function (d) { return self.sizeX(d) / 4 }, this.beads, this.inst, count)
    this.inst = r1[0]
    more = r1[1]
    count += more
    var r2 = packInkIce(inkIce, this.beads, this.inst, count)
    this.inst = r2[0]
    more = r2[1]
    return [this.inst, count + more]
  }

  window.FoliaNebbiaSnow = {
    PEN_FLOATS: PEN_FLOATS,
    FLAKE_SPRITE: FLAKE_SPRITE,
    FLAKE_R: FLAKE_R,
    FLAKE_STAGES: FLAKE_STAGES,
    FLAKE_FILL: FLAKE_FILL,
    FLAKE_FLOATS: FLAKE_FLOATS,
    ICE_FLOATS: ICE_FLOATS,
    slantOf: slantOf,
    iceParams: iceParams,
    iceSizeScale: iceSizeScale,
    LAYERS: LAYERS,
    TYPE_ODDS: TYPE_ODDS,
    QUICK_MELT: QUICK_MELT,
    waterOf: waterOf,
    buildFlakeKind: buildFlakeKind,
    buildFlakeAtlas: buildFlakeAtlas,
    packFlakes: packFlakes,
    packIce: packIce,
    packInkIce: packInkIce,
    NebbiaSnowFall: NebbiaSnowFall,
    NebbiaSnowGrid: NebbiaSnowGrid,
    NebbiaSnowTrails: NebbiaSnowTrails,
    NebbiaSnowWater: NebbiaSnowWater,
    NebbiaSnow: NebbiaSnow
  }
})()
