// 雾笺（nebbia）擦痕遮罩编排：移植自 folia-major src/components/visualizer/nebbia/
//   nebbiaWipe.ts（两指搓除几何）、nebbiaInk.ts（写字画笔）、nebbiaInkIce.ts（雪窗写字水珠结冰）、
//   nebbiaBreath.ts（哈气白气遮罩）、nebbiaMask.ts（每帧擦痕遮罩编排）
// 每帧收一次擦痕遮罩的线段（nebbia-segments.js，由 nebbia-gl.js 的 NebbiaMaskGl 在 GPU 上画）：每句按它的淡出方式算清晰度
// （写的时候 1，下一句开始后保持 hold 秒、屏上还空着就多留一会儿，再用 refog 秒起雾；或两根手指来回搓掉、抹过的地方再起雾），
// 再画雨点和被震落的水珠留下的水痕。让位时被哈气盖掉的句子，白气另画一张遮罩（NebbiaBreathMask）。
// 水珠实例同时攒进 motion（nebbia-drops.js 的 NebbiaGlassMotion）。
//
// 插件差异（相对上游）：
//   上游 nebbiaScene.ts 的 lineRect / yieldFactor / yieldMask / BREATH_GHOST 已由 nebbia-scene.js（加载顺序在本文件之前）导出，
//   这里顶层直接引用，不再内联；nebbiaSnowWater.ts 的 iceParams / iceSizeScale 已由雪窗批次 nebbia-snow.js 导出
//   （加载顺序在本文件之后，putInkBead 运行时惰性引用 window.FoliaNebbiaSnow）；
//   LaidLine / LaidChar / Drip 是上游接口（无运行时形态），字段注释保留在段首。
// 随机数用 window.FoliaSeedHash.createVisualizerRng（与上游 createVisualizerRng 同源）。
// 导出挂 window.FoliaNebbiaMask（含 Wipe / Ink / InkIce / Breath 的全部顶层导出）。
(function () {
  'use strict'

  var Core = window.FoliaNebbiaCore
  var SeedHash = window.FoliaSeedHash
  var Segments = window.FoliaNebbiaSegments
  var Drops = window.FoliaNebbiaDrops
  // nebbia-scene.js（加载顺序在本文件之前）已导出上游 nebbiaScene.ts 的这几个函数：不再内联，直接引用
  var Scene = window.FoliaNebbiaScene
  var lineRect = Scene.lineRect
  var yieldFactor = Scene.yieldFactor
  var yieldMask = Scene.yieldMask
  var BREATH_GHOST = Scene.BREATH_GHOST
  var clamp = Core.clamp
  var smooth = Core.smooth
  var NEBBIA_FIXED = Core.NEBBIA_FIXED
  var MASK_SCALE = Core.MASK_SCALE
  var windDrift = Drops.windDrift

  // ---------- 一句的外框与让位系数（上游 nebbiaScene.ts，引用自 nebbia-scene.js） ----------
  // LaidLine：{ chars: LaidChar[], t, end, next, mode: 'fog'|'fingers', fogAt, yieldAt, wipe?, breathAt, breathUntil,
  //   breathDur, appearBreathAt, appearBreathUntil, breath? }——fogAt 开始起雾（或手指抹除）的时刻；breathAt 是开始哈的
  //   时刻（Infinity = 不用哈）；appearBreathAt 是「哈气后书写」的出场白气（Infinity = 不哈）；wipe / breath 第一次用到时才建。
  // LaidChar：{ x, y, s, rot, glyph, beads: Bead[][], drips: (Drip|null)[], ends: {h,j}[], appearDur, wt, wd }。
  // Drip：{ delay, len, dur, r, seed }——一颗往下淌的水珠。
  //
  // lineRect / yieldFactor / yieldMask / BREATH_GHOST 见 nebbia-scene.js（上游 nebbiaScene.ts 原版，本文件不再内联）。

  // ---------- 两指搓除的几何（原版 nebbiaWipe.ts） ----------
  // 「手指来回搓掉」的几何：食指中指并拢，手从句子左头往右走，边走边快速上下来回搓。一来一回基本走同一条道，
  // 搓的角度随着手往右走慢慢偏（离竖直 ±35° 里摆），指尖走一道带点弧的短线，搓过的地方连成一片盖住整句。
  // 两根手指压在一起没有缝，只在端头看得出两个错开的圆头；哪根长、各多宽，整次抹除不变。
  // 每条拖痕（一根手指搓的一下）有自己的时间窗 [a, b]（占整个抹除过程的比例）。最后一下手指抬起的地方留几颗被推过去的水珠。
  //
  // WipeStreak：{ pts: [[x, y]...], w, a, b, box: [x0, y0, x1, y1] }——box 是外扩了带走水珠半径的包围盒，isSwept 先用它排除。
  // NebbiaWipe：{ streaks, beads: { x, y, r }[], dur（抹完要几秒） }。

  function buildWipe(line, idx) {
    var rnd = SeedHash.createVisualizerRng((idx * 4241 + 77) >>> 0)
    var rect = lineRect(line)
    var x0 = rect.x0, x1 = rect.x1, y0 = rect.y0, y1 = rect.y1, S = rect.S
    if (!Number.isFinite(x0)) return null
    var fw = Math.max(14, S * 0.28), n = 2, gap = fw * 0.8
    var handW = gap + fw, cy = (y0 + y1) / 2, pad = S * 0.3
    // 上下搓一下的长度盖住整句的高度；手每往右走半只手宽搓一下
    // 同一只手：两根手指各多宽、哪根长（中指），整次不变；弧往哪边弯也不变（手腕转的方向）
    var fingers = [{ w: fw * (0.92 + rnd() * 0.08), lenK: 0.88 + rnd() * 0.04 }, { w: fw * (0.97 + rnd() * 0.08), lenK: 1 }]
    var bowDir = rnd() < 0.5 ? 1 : -1, phase = rnd() * Math.PI * 2, swing = 0.45 + rnd() * 0.15
    // 搓是斜的，两头的上下角会漏：起止各往外多走斜出去的那一截
    var len = (y1 - y0) + pad * 2, slant = Math.sin(swing) * len * 0.5, xs = x0 - pad - slant, xe = x1 + pad + slant
    var rubs = Math.max(6, Math.ceil((xe - xs) / (handW * 0.5)))
    var streaks = []
    for (var k = 0; k < rubs; k += 1) {
      var hx = xs + (xe - xs) * (k + 0.5) / rubs, down = k % 2 === 0 ? 1 : -1, pair = Math.floor(k / 2)
      // 一来一回同一个角度（只差一点），每来回一趟往一边慢慢偏
      var ang = swing * Math.sin(phase + pair * 0.5) + (rnd() - 0.5) * 0.06, ca = Math.cos(ang), sa = Math.sin(ang)
      var L = len * (0.95 + rnd() * 0.1), bow = bowDir * S * (0.08 + rnd() * 0.03)
      // 搓得快：一下接一下没有停顿，前后略有重叠
      var a = k / rubs * 0.96, b = Math.min(1, (k + 1) / rubs * 0.96 + 0.04)
      for (var f = 0; f < n; f += 1) {
        var off = (f - (n - 1) / 2) * gap, fwk = fingers[f].w, lenK = fingers[f].lenK
        var pts = []
        for (var i = 0; i <= 12; i += 1) {
          // v 沿着搓的方向（-L/2..L/2，短的那根两头各短一点），w 是横向的偏移（手指并排 + 弧）
          var t = i / 12, u = 2 * t - 1, v = down * (t - 0.5) * L * lenK, w = off + bow * (1 - u * u)
          pts.push([hx + sa * v + ca * w, cy + ca * v - sa * w])
        }
        var r = fwk * 0.7
        var box = boxOf(pts, r)
        streaks.push({ pts: pts, w: fwk, a: a, b: b, box: box })
      }
    }
    var beads = []
    var tail = streaks.slice(-n)
    for (var s = 0; s < tail.length; s += 1) {
      var st = tail[s]
      var ex = st.pts[st.pts.length - 1][0], ey = st.pts[st.pts.length - 1][1]
      beads.push({ x: ex, y: ey, r: st.w * 0.22 + 1.5 * rnd() })
      if (rnd() < 0.6) beads.push({ x: ex - (st.pts[1][0] - st.pts[0][0]) * 0.6 + (rnd() - 0.5) * st.w * 0.6, y: ey - (st.pts[1][1] - st.pts[0][1]) * 0.6, r: 1.5 + rnd() * 2.5 })
    }
    // 搓一下 0.08 秒，句子长的搓得更快，整次不超过 1.6 秒
    return { streaks: streaks, beads: beads, dur: Math.min(0.08 * rubs, 1.6) }
  }

  /** 上游的 Math.min(...xs) / Math.max(...ys)：点列外扩 r 的包围盒。 */
  function boxOf(pts, r) {
    var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
    for (var i = 0; i < pts.length; i += 1) {
      x0 = Math.min(x0, pts[i][0]); y0 = Math.min(y0, pts[i][1])
      x1 = Math.max(x1, pts[i][0]); y1 = Math.max(y1, pts[i][1])
    }
    return [x0 - r, y0 - r, x1 + r, y1 + r]
  }

  /** 拖痕在整体进度 ue 下画到哪：0..1。 */
  function streakProgress(st, ue) {
    return clamp((ue - st.a) / (st.b - st.a))
  }

  /** (x, y) 处字边的水珠是否已经被手指带走：离哪条拖痕已经画到的那段足够近。 */
  function isSwept(wipe, ue, x, y) {
    for (var i = 0; i < wipe.streaks.length; i += 1) {
      var st = wipe.streaks[i]
      var lp = streakProgress(st, ue)
      if (lp <= 0) continue
      var bx = st.box
      if (x < bx[0] || x > bx[2] || y < bx[1] || y > bx[3]) continue
      var pts = st.pts, last = lp * (pts.length - 1), r = st.w * 0.7, r2 = r * r
      for (var j = 0; j < last; j += 1) {
        var ax = pts[j][0], ay = pts[j][1], b = pts[j + 1], f = Math.min(1, last - j)
        var dx = (b[0] - ax) * f, dy = (b[1] - ay) * f
        var t = clamp(((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1))
        var ex = x - ax - dx * t, ey = y - ay - dy * t
        if (ex * ex + ey * ey < r2) return true
      }
    }
    return false
  }

  // ---------- 雪窗写字水珠结冰（原版 nebbiaInkIce.ts） ----------
  // 雪窗上写字留下的水珠（擦痕边的小水珠、收笔水珠、淌下来停住的那颗）也会结冰（原型）：和雪化成的水珠同一套参数
  // （iceParams / iceSizeScale 已由雪窗批次 nebbia-snow.js 导出；加载顺序在本文件之后，putInkBead 里惰性引用），
  // 但写字的水珠每帧按时刻重算、不留状态，所以冻了多少都按「这颗水珠留下多久了」（age）直接算出来：
  // 留够 freezeAfter 秒（按大小放长，iceSizeScale；每颗再按种子早晚不同）开始从中间往外冻，冻的时候水的透镜慢慢收成更小的冰珠（grow 倍）。
  // 和雪化成的不一样，写字的冻在原地不滑（留住结冰的字形），大的冻实时往下坠一两个像素就停。还是跟着字一起起雾、淡没（透明度照写字的水珠）。
  // 冰芯记进 ink.ice（ICE_FLOATS 个数一颗），nebbia-snow.js 排成 bead 贴图的雪花实例画。

  /** 一颗冰芯：x、y（冰芯中心，已经放在水滴下面圆的那团上）、半径、冻了多少（0..1）、转角、透明度。 */
  var ICE_FLOATS = 6

  var hashIce = function (s) { var x = Math.sin(s * 12.9898 + 78.233) * 43758.5453; return x - Math.floor(x) }

  /** 冰芯放在水滴下面圆的那团（重心）上：比水珠的位置往下 0.42 个半径。 */
  function pushCore(out, x, y, r, ice, rot, alpha) {
    out.push(x, y + r * 0.42, r * 1.05, ice, rot, alpha)
  }

  /**
   * 放一颗写字留下的水珠：age 是它留下了多少秒（还在写、还没停住时传负数），seed 定它的早晚、转角。
   * 不是雪窗、关着、太小、还没到时候的照常放；冻了的放在原地（坠一点），冰芯记进 ink.ice。
   */
  function putInkBead(ink, x, y, r, alpha, age, seed, sx, sy) {
    if (sx === undefined) sx = 1
    if (sy === undefined) sy = 1
    // iceParams / iceSizeScale 在 nebbia-snow.js（加载顺序在本文件之后）：调用发生在每帧渲染里，那时已加载，惰性引用
    var Snow = window.FoliaNebbiaSnow
    var ice = ink.ice, p = Snow ? Snow.iceParams : null
    if (!p || !ice || p.off || age < 0 || r < p.minR * ice.k) { ink.motion.put(x, y, r, alpha, sx, sy); return }
    var h = hashIce(seed), k = ice.k
    var scale = Snow.iceSizeScale(r, k)
    var t = age - p.freezeAfter * scale * (0.7 + 0.6 * h)
    if (t <= 0) { ink.motion.put(x, y, r, alpha, sx, sy); return }
    var dur = Math.max(1, p.freezeDur * scale), frozen = Math.min(1, t / dur)
    var R = r * Math.pow(Math.max(0.25, p.grow), frozen)
    // 冻在原地不滑（留住字形）：大的冻实时往下坠一点就停（看得见的半径每大 minR 坠 0.5 像素，最多 2 像素），缓入缓出
    var sag = Math.min(2 * k, 0.5 * k * Math.max(0, R / (p.minR * k) - 1)) * frozen * frozen * (3 - 2 * frozen)
    ink.motion.put(x, y + sag, R, alpha, sx, sy)
    pushCore(ice.out, x, y + sag, R, frozen, h * Math.PI * 2, alpha)
  }

  // ---------- 写字画笔（原版 nebbiaInk.ts） ----------
  // 在擦痕遮罩（半分辨率，亮 = 擦开；线段先收进 nebbia-segments.js，再由 nebbia-gl.js 在 GPU 上画）上画手指写的字：
  // 按演唱时长一笔一笔写，笔尖前推着一颗收笔水珠，擦痕边凝出小水珠，少数笔画写完后淌下一颗水珠、留下水痕。
  // 着色器再按噪声给遮罩取阈值，边缘毛糙。
  //
  // InkContext：{ ctx（NebbiaSegments）, motion（NebbiaGlassMotion）, strokeWidth, writeSpeed, busSpeed,
  //   sweeps（雪窗、凝露时收这一帧扫过的几段（笔尖、往下淌的水珠头；雪窗批次的 PEN_FLOATS 格式）：抹雪、吸水。雨窗 null）,
  //   wet（雪窗、凝露时收这一帧写好、边上还挂着水珠的笔画（同样格式）：吸走挨着的雪水、小水珠。雨窗 null）,
  //   ice（雪窗时收这一帧写字留下的水珠结的冰芯（本文件 putInkBead）：out 是冰芯数据，k 是画面高 / 1000，H 是画面高；别的玻璃 null） }。

  /** 水珠流下来的水痕：宽度接近水珠本身，边缘起伏，越往上越细；wob(y) 是 y 处的横向偏移，和水珠头同一条。 */
  function strokeTrail(ctx, x, y0, y1, width, v, seed, wob) {
    if (y1 - y0 < 2) return
    for (var y = y0; y < y1; y += 4) {
      var ye = Math.min(y1, y + 5)
      var along = (y - y0) / Math.max(1, y1 - y0)
      var w = width * (0.72 + 0.28 * along) * (0.85 + 0.3 * (0.5 + 0.5 * Math.sin(y * 0.19 + seed * 3)))
      ctx.moveTo(x + wob(y), y)
      ctx.lineTo(x + wob(ye), ye)
      ctx.stroke(w, v)
    }
  }

  // 某一笔在 [0, len] 上画到 l 的部分，放进 p 的当前路径
  function partialPath(p, st, l) {
    var pts = st.pts, cum = st.cum
    p.moveTo(pts[0][0], pts[0][1])
    for (var i = 1; i < pts.length; i += 1) {
      if (cum[i] >= l) {
        var k = (l - cum[i - 1]) / Math.max(1e-6, cum[i] - cum[i - 1])
        p.lineTo(pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * k, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * k)
        return
      }
      p.lineTo(pts[i][0], pts[i][1])
    }
  }

  // 字内 em 坐标 → 屏幕 CSS 像素
  function toScreen(c, u, v) {
    var cs = Math.cos(c.rot), sn = Math.sin(c.rot), lx = (u - 0.5) * c.s, ly = (v - 0.5) * c.s
    return [c.x + cs * lx - sn * ly, c.y + sn * lx + cs * ly]
  }

  // 沿笔画走到弧长 s 的点（上游 nebbiaGlyphs.ts 的 pointAt，后续批次接入；这里按上游实现内联，只用到前两个返回值）。
  // GlyphStroke：{ pts: [[u, v]...]（字内 em 坐标）, cum: number[]（累计弧长）, len }。
  function pointAt(st, s) {
    var pts = st.pts, cum = st.cum
    var i = 1
    while (i < pts.length - 1 && cum[i] < s) i += 1
    var a = pts[i - 1], b = pts[i], L = Math.max(1e-6, cum[i] - cum[i - 1]), k = clamp((s - cum[i - 1]) / L)
    var dx = (b[0] - a[0]) / L, dy = (b[1] - a[1]) / L
    return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, -dy, dx]
  }

  /** 正在写的这一笔：笔尖和它身后 PEN_TAIL 像素那一段记进 sweeps（一帧笔尖能走好几像素，只记笔尖会漏掉路过的雪）。 */
  var PEN_TAIL = 24
  function pushPen(pens, c, st, drawn, width) {
    var head = pointAt(st, drawn), tail = pointAt(st, Math.max(0, drawn - PEN_TAIL / c.s))
    var p1 = toScreen(c, head[0], head[1]), p0 = toScreen(c, tail[0], tail[1])
    pens.push(p0[0], p0[1], p1[0], p1[1], width * c.s)
  }

  /** 这一笔已经写出来的部分，按屏幕坐标一段段记进 wet（宽是笔画宽）。 */
  function pushWet(wet, c, st, drawn, width) {
    var pts = st.pts, cum = st.cum
    var head = toScreen(c, pts[0][0], pts[0][1])
    var x0 = head[0], y0 = head[1]
    for (var i = 1; i < pts.length && cum[i - 1] < drawn; i += 1) {
      var uv = cum[i] > drawn ? pointAt(st, drawn) : pts[i]
      var p = toScreen(c, uv[0], uv[1])
      wet.push(x0, y0, p[0], p[1], width * c.s)
      x0 = p[0]; y0 = p[1]
    }
  }

  // 一颗往下淌的水珠：从笔画最低处出发，走走停停，越走越小，留下一道擦开的水痕
  function drawDrip(ink, c, st, d, age, width, clarity, beadV, alive) {
    var bx = 0, by = -1e9
    for (var i = 0; i < st.pts.length; i += 1) {
      var q = toScreen(c, st.pts[i][0], st.pts[i][1])
      if (q[1] > by) { bx = q[0]; by = q[1] }
    }
    by += width * c.s * 0.35
    var u = clamp(age / d.dur), f = u - Math.sin(u * 6 * Math.PI) / (6 * Math.PI)
    var dist = d.len * f, r = d.r * (1 - 0.35 * u)
    var wob = function (y) { return Math.sin(y * 0.07 + d.seed) * 1.6 + Math.sin(y * 0.023 + d.seed * 2) * 2.5 + windDrift(y, ink.busSpeed) }
    if (dist > 1 && clarity > 0.002) strokeTrail(ink.ctx, bx, by, by + dist, r * 1.5, clarity * 0.95, d.seed, function (y) { return wob(y - by) })
    // 哈气盖掉的旧字只留擦痕的印子，水珠已经没了
    if (beadV <= 0.002) return
    // 走的时候被拉长，停下来变回圆一点；身后零星留下小水珠
    var speed = 1 - Math.cos(u * 6 * Math.PI)
    // 手指搓过的地方（alive 为 0）水珠被带走
    for (var y = 14 + (d.seed % 7) * 2; y < dist - r * 2; y += 18 + ((y * 7 + d.seed * 13) % 11)) {
      var x = bx + wob(y), v = alive ? beadV * alive(x, by + y) : beadV
      if (v > 0.002) ink.motion.put(x, by + y, r * (0.3 + 0.2 * (((y + d.seed) * 0.37) % 1)), v)
    }
    // 淌完停住的那颗：停下以后算结冰（本文件 putInkBead）
    var ex = bx + wob(dist), ey = by + dist + r * 0.3, ev = alive ? beadV * alive(ex, ey) : beadV
    if (ev > 0.002) putInkBead(ink, ex, ey, r, ev, u < 1 ? -1 : age - d.dur, d.seed + 0.5, 1, 1 + 0.35 * speed * (u < 1 ? 1 : 0))
    // 雪窗、凝露：还在往下淌的水珠头扫过的一段（冲掉路上的雪和水珠）
    if (ink.sweeps && u < 1 && dist > 1 && beadV > 0.3) {
      var ya = Math.max(0, dist - r * 3)
      ink.sweeps.push(bx + wob(ya), by + ya, bx + wob(dist), by + dist + r * 0.3, r * 2.4)
    }
  }

  /**
   * 画一个字到时刻 T：从 c.wt 起用 c.wd 秒写完（整句的书写节奏在后续批次的 nebbiaScene.ts 的 applyAppear）。
   * clarity 管擦痕，beadV 管擦痕边的水珠（水珠比擦痕晚很久才被雾吞掉）；alive(x, y) 为 0 的地方水珠已经被手指抹走。
   * 慢慢显现的字一次画全，不带水珠。
   */
  function drawChar(ink, c, T, clarityIn, beadIn, alive) {
    if (beadIn === undefined) beadIn = clarityIn
    if (alive === undefined) alive = null
    var g = c.glyph
    var fadeIn = c.appearDur > 0
    if (!g || T < (fadeIn ? c.t : c.wt)) return
    var ctx = ink.ctx, motion = ink.motion
    var clarity = clarityIn, beadV = beadIn
    if (fadeIn) { var a = smooth(clamp((T - c.t) / c.appearDur)); clarity *= a; beadV *= a }
    var wd = c.wd
    var gap = Math.min(0.06 / ink.writeSpeed, wd * 0.08)
    var inkTime = wd - gap * (g.strokes.length - 1)
    var local = T - (fadeIn ? c.t : c.wt)
    var k = MASK_SCALE, cs = Math.cos(c.rot), sn = Math.sin(c.rot)
    ctx.setTransform(cs * c.s * k, sn * c.s * k, -sn * c.s * k, cs * c.s * k, (c.x - c.s / 2 * (cs - sn)) * k, (c.y - c.s / 2 * (sn + cs)) * k)
    // 笔画多的字笔画收细一点，不然挤在一起糊成一团。宽度按字号（em）缩放：原来 8×thin 像素的下限在字号小于 8 / strokeWidth
    // （默认约 89 像素）时盖过笔画粗细设置，字越小笔画相对越粗、堵住字腔。只留 0.6 个遮罩纹素的下限，半分辨率遮罩上细笔画不断成点
    var thin = clamp(Math.sqrt(9 / g.strokes.length), 0.55, 1)
    var width = Math.max(ink.strokeWidth * thin, 0.6 / (MASK_SCALE * c.s))
    var drips = []
    g.strokes.forEach(function (st, si) {
      var dur = fadeIn ? 0 : inkTime * st.len / g.total
      if (local <= 0) return
      var p = dur > 0 ? clamp(local / dur) : 1
      var drawn = (p * 0.4 + smooth(p) * 0.6) * st.len
      if (clarity > 0.002) { partialPath(ctx, st, drawn); ctx.stroke(width, clarity) }
      if (ink.sweeps && !fadeIn && p > 0 && p < 1) pushPen(ink.sweeps, c, st, drawn, width)
      if (ink.wet && !fadeIn && drawn > 0 && beadV > 0.3) pushWet(ink.wet, c, st, drawn, width)
      if (!fadeIn) {
        for (var bi = 0; bi < c.beads[si].length; bi += 1) {
          var b = c.beads[si][bi]
          if (b.s > drawn) break
          var off = width / 2 + (b.r * 0.7 + b.j * 1.5) / c.s
          var bp = toScreen(c, b.x + b.nx * off, b.y + b.ny * off)
          var bv = alive && beadV > 0.002 ? beadV * alive(bp[0], bp[1]) : beadV
          // 哈气盖掉的旧字只留擦痕的印子，水珠已经没了
          if (bv <= 0.002) continue
          // 这一笔写完以后算结冰（本文件 putInkBead）
          putInkBead(ink, bp[0], bp[1], b.r * (0.55 + 0.45 * bv), bv, p >= 1 ? local - dur : -1, b.x * 131.7 + b.y * 71.3 + si, 1 + b.j * 0.25, 1 + (1 - b.j) * 0.3)
        }
        // 收笔水珠：笔尖推着走的水越堆越多，写到哪跟到哪；大小跟字号走，字太小就不留
        if (NEBBIA_FIXED.endBead > 0 && drawn > 0 && c.s >= NEBBIA_FIXED.endBeadMin) {
          var e = c.ends[si]
          var head = pointAt(st, drawn), back = pointAt(st, Math.max(0, drawn - 2 / c.s))
          var dx = head[0] - back[0], dy = head[1] - back[1]
          var dl = Math.hypot(dx, dy) || 1
          dx /= dl; dy /= dl
          var r = c.s * (0.031 + 0.018 * e.h) * NEBBIA_FIXED.endBead * (0.5 + 0.5 * smooth(p))
          var ep = toScreen(c, head[0] + (dx * r * 0.35) / c.s, head[1] + (dy * r * 0.35 + r * 0.15) / c.s)
          var ev = alive && beadV > 0.002 ? beadV * alive(ep[0], ep[1]) : beadV
          if (ev > 0.002) putInkBead(ink, ep[0], ep[1], r * (0.6 + 0.4 * ev), ev, p >= 1 ? local - dur : -1, c.x * 3.1 + c.y * 5.7 + si * 11, 1, 1.12 + e.j * 0.12)
        }
        var d = c.drips[si]
        if (d && p >= 1 && local - dur > d.delay) drips.push([st, d, local - dur - d.delay])
      }
      local -= dur + (fadeIn ? 0 : gap)
    })
    ctx.setTransform(MASK_SCALE, 0, 0, MASK_SCALE, 0, 0)
    for (var di = 0; di < drips.length; di += 1) drawDrip(ink, c, drips[di][0], drips[di][1], drips[di][2], width, clarity, beadV, alive)
    ctx.setTransform(1, 0, 0, 1, 0, 0)
  }

  // ---------- 哈气白气遮罩（原版 nebbiaBreath.ts） ----------
  // 让位时用来腾地方：屏上满了，后面那句要写到一句还没消失的句子上（后续批次的 nebbiaScene.ts 的让位），就在那句开写前
  // 对着旧句子哈一口气。嘴哈出的是扁的一股气，打到玻璃上先是贴着句子中线的一条横带（已有整句七成宽），
  // 很快上下鼓开成一整片白气（贴着整句外框的椭圆再叠几团大圆），旧句子被盖掉（nebbiaScene.ts 的 yieldFactor），
  // 新句子马上写在白气上；新句子唱完后白气再留一会儿，慢慢从薄的边上往里散，散完就是普通的雾。白气只是这一片的雾变密（着色器把它
  // 加进雾的浓度），所以写过的地方照样擦开、水珠周围照样抹开一圈。白气画在一张 1/4 分辨率的遮罩上：
  // R 通道是形状（散的时候变小，着色器按噪声取阈值，所以边往里退），G 通道是浓度（刚哈出来的头一下淡），
  // B 通道是盖住的旧字糊开多少（只在鼓开的那一阵）。
  // 省 CPU：每帧先只记下要画哪几口、浓淡（取整到 0..255）和鼓开的进度，和上一帧一样就不重画（挂着的那段一直一样，慢慢散的 8 秒里
  // 也大约 4 帧才变一级），version 不变，nebbia-gl.js 也就不重传纹理。
  // 出现方式选了「哈气后书写」的句子也用同一口气：开写前对着自己的位置哈，再写在白气上（nebbiaScene.ts 的 applyAppear）。
  // 原型在 fog-write-demo 的 index.html。

  var BREATH_SCALE = 0.25

  // Lobe：{ x, y, rx, ry }；NebbiaBreath：{ lobes, cx, cy, ry }——一句的白气：贴着整句外框的椭圆，再在四周叠几团大圆，边缘不齐。

  function buildBreath(line, idx) {
    var rnd = SeedHash.createVisualizerRng((idx * 6151 + 29) >>> 0)
    var rect = lineRect(line)
    var x0 = rect.x0, x1 = rect.x1, y0 = rect.y0, y1 = rect.y1, S = rect.S
    if (!Number.isFinite(x0)) return null
    var cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, rx = (x1 - x0) / 2 + S * 0.3, ry = (y1 - y0) / 2 + S * 0.3
    var lobes = [{ x: cx, y: cy, rx: rx * 0.95, ry: ry * 0.95 }]
    var n = 5 + Math.floor(rnd() * 2), r0 = Math.min(rx, ry)
    for (var k = 0; k < n; k += 1) {
      var a = (k + rnd() * 0.6) / n * Math.PI * 2, r = r0 * (0.45 + rnd() * 0.25)
      lobes.push({ x: cx + Math.cos(a) * rx * 0.6, y: cy + Math.sin(a) * ry * 0.6, rx: r, ry: r })
    }
    return { lobes: lobes, cx: cx, cy: cy, ry: ry }
  }

  /**
   * 这一帧要画的一口气（Puff）：画哪口、形状浓度（0..255）、头上浓度（0..255）、糊开旧字多少（B 通道，0..255）、鼓开的进度。
   * 同一句的让位白气和出场白气是同一个 `b`，所以每一项都要比，少比一项会把两口气当成一样。
   */

  function samePuffs(a, b) {
    if (a.length !== b.length) return false
    for (var i = 0; i < a.length; i += 1) {
      if (a[i].b !== b[i].b || a[i].c0 !== b[i].c0 || a[i].g0 !== b[i].g0 || a[i].b0 !== b[i].b0 || a[i].u !== b[i].u) return false
    }
    return true
  }

  function NebbiaBreathMask() {
    this.canvas = document.createElement('canvas')
    var ctx = this.canvas.getContext('2d')
    if (!ctx) throw new Error('Nebbia: no 2D context for the breath mask')
    this.ctx = ctx
    /** 这一帧有白气（没有时不必上传、着色器也不采样）。 */
    this.active = false
    /** 画布内容的版本：重画一次加一（nebbia-gl.js 版本没变就不重传）。 */
    this.version = 0
    this.puffs = []
    this.drawn = []
  }

  NebbiaBreathMask.prototype.resize = function (W, H) {
    this.canvas.width = Math.max(1, Math.round(W * BREATH_SCALE))
    this.canvas.height = Math.max(1, Math.round(H * BREATH_SCALE))
    // 改尺寸会清空画布：下一帧照画
    this.drawn = []
    this.version += 1
  }

  /** 每帧开头：重新记这一帧的几口气。 */
  NebbiaBreathMask.prototype.begin = function () { this.puffs = [] }

  /**
   * 一句外框上的一口白气：`t0` 起在 `spread` 秒里从中线鼓开（要写的那句 0.3 秒后开写），到 `until`
   * 再用 breathFade 秒慢慢散。字照常写（本文件 NebbiaMask），写过的地方在白气上擦开。这里只记下，end() 时才画。
   * `melt`：让位时盖掉旧句的那口气才把底下的字糊开（B 通道）；「哈气后书写」的出场白气不糊旁边的字。
   */
  NebbiaBreathMask.prototype.drawLine = function (line, idx, T, t0, until, spread, melt) {
    var breathFade = NEBBIA_FIXED.breathFade
    if (T < t0) return
    var s = 1 - smooth(clamp((T - Math.max(until, t0 + spread)) / breathFade))
    if (s <= 0.002) return
    if (line.breath === undefined) line.breath = buildBreath(line, idx)
    var b = line.breath
    if (!b) return
    var u = clamp((T - t0) / spread)
    // G 浓度在鼓开的头七成里慢慢浓起来；B 是盖住的旧字糊开多少（着色器），鼓开快完时回到 0，新句子写上来时不糊
    var g0 = Math.round(255 * smooth(clamp(u * 1.4)))
    var b0 = melt ? Math.round(255 * smooth(clamp(u * 2.5)) * (1 - smooth(clamp((u - 0.8) / 0.2)))) : 0
    this.puffs.push({ b: b, c0: Math.round(255 * s), g0: g0, b0: b0, u: u })
  }

  /** 每帧结尾：和上一帧画的一样就不动画布，不一样才清掉重画。 */
  NebbiaBreathMask.prototype.end = function () {
    var puffs = this.puffs
    this.active = puffs.length > 0
    if (samePuffs(puffs, this.drawn)) return
    var ctx = this.ctx
    if (this.drawn.length) {
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.globalCompositeOperation = 'source-over'
      ctx.fillStyle = '#000'
      ctx.fillRect(0, 0, this.canvas.width, this.canvas.height)
    }
    for (var i = 0; i < puffs.length; i += 1) this.paint(puffs[i])
    this.drawn = puffs
    this.version += 1
  }

  NebbiaBreathMask.prototype.paint = function (p) {
    var b = p.b, c0 = p.c0, g0 = p.g0, b0 = p.b0, u = p.u
    var e = 1 - Math.pow(1 - u, 3)
    var kx = 0.7 + 0.3 * e, ky = 0.08 + 0.92 * e
    var ctx = this.ctx
    ctx.globalCompositeOperation = 'lighten'
    for (var i = 0; i < b.lobes.length; i += 1) {
      var lb = b.lobes[i]
      // 每团跟着往中线压扁；按单位圆画，用变换拉成椭圆
      var x = b.cx + (lb.x - b.cx) * kx, y = b.cy + (lb.y - b.cy) * ky
      ctx.setTransform(BREATH_SCALE * lb.rx * kx, 0, 0, BREATH_SCALE * Math.max(lb.ry * ky, 4), BREATH_SCALE * x, BREATH_SCALE * y)
      var gr = ctx.createRadialGradient(0, 0, 0, 0, 0, 1)
      gr.addColorStop(0, 'rgb(' + c0 + ',' + g0 + ',' + b0 + ')')
      gr.addColorStop(0.45, 'rgb(' + Math.round(c0 * 0.7) + ',' + g0 + ',' + b0 + ')')
      gr.addColorStop(0.999, 'rgb(0,' + g0 + ',' + b0 + ')')
      gr.addColorStop(1, 'rgb(0,0,0)')
      ctx.fillStyle = gr
      ctx.beginPath()
      ctx.arc(0, 0, 1, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0)
  }

  // ---------- 每帧编排（原版 nebbiaMask.ts） ----------

  /** 水珠甩出的印子停下后保持几秒、回雾用时是 refog 的几倍。 */
  var SMEAR_HOLD = 8
  var SMEAR_REFOG = 2.5

  /** 写好的笔画多久重收一次（秒）。 */
  var WET_EVERY = 0.05

  function NebbiaMask() {
    /** 这一帧的擦痕线段。 */
    this.ctx = new Segments.NebbiaSegments()
    this.breath = new NebbiaBreathMask()
    /** 画面高（CSS 像素）。 */
    this.H = 1
    /** 雪窗、凝露时收这一帧扫过的几段（写字的笔尖、抹字的手指、往下淌的水珠头）和写好的笔画，交给雪窗 / 凝露批次；雨窗 null。 */
    this.sweeps = null
    this.wet = null
    /** 雪窗时收这一帧写字留下的水珠结的冰芯（putInkBead），交给雪窗批次画；别的玻璃 null。 */
    this.ice = null
    /** 写好的笔画段多，用的地方（雪水、凝露被吸走）也只每 0.05 秒用一次：每 WET_EVERY 秒才重收一次，中间几帧沿用上次的。 */
    this.wetAt = -Infinity
  }

  NebbiaMask.prototype.resize = function (W, H) {
    this.H = H
    this.breath.resize(W, H)
  }

  /** `rainSize` 是大雨点的大小倍数（tuning.rainBig × 雨点强度）。 */
  NebbiaMask.prototype.draw = function (laid, T, now, tuning, motion, hits, rainSize) {
    var ctx = this.ctx
    ctx.clear()
    this.breath.begin()
    if (this.sweeps) this.sweeps.length = 0
    if (this.ice) this.ice.length = 0
    var wetDue = !!this.wet && now - this.wetAt >= WET_EVERY
    if (wetDue) { this.wet.length = 0; this.wetAt = now }
    var ink = {
      ctx: ctx, motion: motion, strokeWidth: tuning.strokeWidth, writeSpeed: tuning.writeSpeed, busSpeed: tuning.busSpeed,
      sweeps: this.sweeps, wet: wetDue ? this.wet : null,
      ice: this.ice ? { out: this.ice, k: this.H / 1000, H: this.H } : null
    }
    var self = this
    laid.forEach(function (line, i) {
      if (line.breathAt < Infinity) self.breath.drawLine(line, i, T, line.breathAt, line.breathUntil, line.breathDur, true)
      if (line.appearBreathAt < Infinity) self.breath.drawLine(line, i, T, line.appearBreathAt, line.appearBreathUntil, NEBBIA_FIXED.breathSpread, false)
      if (T >= line.t - 0.5) self.drawLine(ink, line, i, T, tuning)
    })
    this.breath.end()
    hits.draw(ctx, motion, T, tuning.refog, NEBBIA_FIXED.beadHold, rainSize)
    this.drawTrails(motion, now, tuning)
  }

  // 一句：慢慢起雾，或手指抹除（另画拖痕，拖过的地方字边水珠被带走）
  NebbiaMask.prototype.drawLine = function (ink, line, idx, T, tuning) {
    var refog = tuning.refog, beadHold = NEBBIA_FIXED.beadHold
    var fogAt = line.fogAt
    var yf = yieldFactor(line, T), ym = yieldMask(line, T)
    // 被哈气盖掉的手指句不搓（不然先搓开、又哈上白气，两个效果打架）：和起雾的一样慢慢淡进雾里
    if (line.mode === 'fog' || line.breathAt < Infinity) {
      var v = (1 - smooth(clamp((T - fogAt) / refog))) * ym
      // 擦痕边的水珠：擦痕开始起雾后再挂 beadHold 秒，再用 refog × 3 慢慢缩小消失
      var vb = (1 - smooth(clamp((T - fogAt - beadHold) / (refog * 3)))) * yf
      if (vb > 0.002 || v > 0.002) for (var ci = 0; ci < line.chars.length; ci += 1) drawChar(ink, line.chars[ci], T, v, vb)
      return
    }
    if (line.wipe === undefined) line.wipe = buildWipe(line, idx)
    var w = line.wipe
    if (!w) return
    // 要让位的句子：唱完了就提前抹，赶在后面那句开写前抹完
    var early = line.yieldAt - w.dur - 0.9
    var t0 = fogAt > early && early >= line.end ? early : fogAt
    var ue = clamp((T - t0) / w.dur)
    // 抹完先清亮一会儿，再慢慢起雾
    var back = 1 - smooth(clamp((T - t0 - w.dur - 0.5) / refog)), vw = back * ym
    // 拖痕不留印子：让位淡掉时一起淡掉
    var vs = back * yf
    var vbw = (1 - smooth(clamp((T - t0 - w.dur - 0.5 - beadHold) / (refog * 3)))) * yf
    if (vbw <= 0.002 && vw <= 0.002) return
    var alive = ue <= 0 ? null : function (x, y) { return isSwept(w, ue, x, y) ? 0 : 1 }
    for (var i = 0; i < line.chars.length; i += 1) drawChar(ink, line.chars[i], T, ue <= 0 ? ym : vw, ue <= 0 ? yf : vbw, alive)
    if (ue <= 0) return
    var ctx = ink.ctx
    ctx.setTransform(MASK_SCALE, 0, 0, MASK_SCALE, 0, 0)
    if (vs > 0.002) for (var s = 0; s < w.streaks.length; s += 1) {
      var st = w.streaks[s]
      var lp = streakProgress(st, ue)
      if (lp <= 0) continue
      var pts = st.pts, n = pts.length - 1, f = lp * n, fi = Math.floor(f)
      ctx.moveTo(pts[0][0], pts[0][1])
      for (var k = 1; k <= Math.min(fi, n); k += 1) ctx.lineTo(pts[k][0], pts[k][1])
      if (fi < n) {
        var a = pts[fi], b = pts[fi + 1], r = f - fi
        ctx.lineTo(a[0] + (b[0] - a[0]) * r, a[1] + (b[1] - a[1]) * r)
      }
      ctx.stroke(st.w, vs)
      // 雪窗、凝露：手指正扫过的一段（指尖和它身后一点）
      if (ink.sweeps && lp < 1) {
        var tail = pts[Math.max(0, fi - 1)], next = pts[Math.min(n, fi + 1)]
        ink.sweeps.push(tail[0], tail[1], next[0], next[1], st.w)
      }
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    if (ue >= 1 && vbw > 0.002) for (var bi = 0; bi < w.beads.length; bi += 1) {
      var bd = w.beads[bi]
      ink.motion.put(bd.x, bd.y, bd.r * (0.55 + 0.45 * vbw), vbw)
    }
  }

  // 被震落的水珠留下的水痕、颠簸时水珠甩过的印子，和手指擦痕一样过一会儿重新起雾；完全回雾的丢掉
  NebbiaMask.prototype.drawTrails = function (motion, now, tuning) {
    var ctx = this.ctx
    var smears = motion.smears
    ctx.setTransform(MASK_SCALE, 0, 0, MASK_SCALE, 0, 0)
    for (var i = smears.length - 1; i >= 0; i -= 1) {
      var m = smears[i]
      // 甩出的印子留得久：停下后保持 SMEAR_HOLD 秒，再用 refog 的 SMEAR_REFOG 倍慢慢回雾
      var v = m.end === null ? 1 : 1 - smooth(clamp((now - m.end - SMEAR_HOLD) / (tuning.refog * SMEAR_REFOG)))
      if (v <= 0.002) { m.gone = true; smears.splice(i, 1); continue }
      ctx.moveTo(m.x + m.ax, m.y + m.ay)
      ctx.lineTo(m.x + m.bx, m.y + m.by)
      ctx.stroke(m.w * 0.14, v * 0.9)
    }
    var trails = motion.trails
    for (var j = trails.length - 1; j >= 0; j -= 1) {
      var tr = trails[j]
      var tv = tr.end === null ? 1 : 1 - smooth(clamp((now - tr.end - tuning.hold) / tuning.refog))
      if (tv <= 0.002) { trails.splice(j, 1); continue }
      // 太短的、整条在屏幕下面的不画（照样按时间回雾、丢掉）
      if (tr.y1 - tr.y0 < 2 || tr.y0 > this.H) continue
      ctx.setTransform(MASK_SCALE, 0, 0, MASK_SCALE, 0, 0)
      var seed = tr.seed
      var wob = function (y) { return Math.sin(y * 0.07 + seed) * 1.4 + Math.sin(y * 0.021 + seed * 2) * 2.2 + windDrift(y - tr.y0, tuning.busSpeed) }
      strokeTrail(ctx, tr.x, tr.y0, tr.y1, tr.w * 0.18, tv * 0.95, seed, wob)
      for (var y = tr.y0 + 10 + (tr.seed % 9); y < tr.y1 - tr.w * 0.25; y += 16 + ((y * 7 + tr.seed * 13) % 13)) {
        motion.put(tr.x + wob(y), y, tr.w * (0.03 + 0.03 * (((y + tr.seed) * 0.37) % 1)), tv)
      }
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0)
  }

  window.FoliaNebbiaMask = {
    // nebbiaWipe.ts
    buildWipe: buildWipe,
    streakProgress: streakProgress,
    isSwept: isSwept,
    // nebbiaInk.ts
    strokeTrail: strokeTrail,
    drawChar: drawChar,
    PEN_TAIL: PEN_TAIL,
    // nebbiaInkIce.ts
    ICE_FLOATS: ICE_FLOATS,
    putInkBead: putInkBead,
    // nebbiaBreath.ts
    BREATH_SCALE: BREATH_SCALE,
    buildBreath: buildBreath,
    NebbiaBreathMask: NebbiaBreathMask,
    // nebbiaMask.ts
    SMEAR_HOLD: SMEAR_HOLD,
    SMEAR_REFOG: SMEAR_REFOG,
    WET_EVERY: WET_EVERY,
    NebbiaMask: NebbiaMask
  }
})()
