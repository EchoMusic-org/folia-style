// 雾笺（nebbia）场景排布模块：移植自 folia-major src/components/visualizer/nebbia/
//   nebbiaScene.ts（一首歌在雾笺上的全部安排：LaidChar/LaidLine、字形装饰（水珠/下淌/收笔）、
//     出现方式与书写节奏 applyAppear（二分找速度系数，最慢 0.3×）、起雾时刻 fogStartOf、
//     多留 linger、让位（YIELD_LEAD/YIELD_READ）、哈气标记（breathAt/breathDur/breathUntil、BREATH_GHOST）、
//     片尾书写对齐 alignCredits）
//   nebbiaSpot.ts（聚光灯 NebbiaSpot：两盏灯的目标跟踪，临界阻尼弹簧 ω=1/0.1）
// 全部挂 window.FoliaNebbiaScene，被后续批次（nebbia-mask.js / nebbia-breath.js / nebbia-wipe.js / 模式入口）引用。
//
// 插件差异（相对上游）：
//   随机流走 window.FoliaSeedHash，排版走 window.FoliaNebbiaLayout.layoutNebbiaSong，字形走
//   window.FoliaNebbiaGlyphs（warpGlyph/pointAt/NebbiaGlyphCache）；擦痕遮罩的线段收集器（nebbiaSegments.ts，
//   后续批次）传入 buildNebbiaScene 的产物消费；LaidLine 的 wipe / breath 字段（上游 NebbiaWipe / NebbiaBreath，
//   后续批次懒建）保留为「第一次用到时才建」的槽位，本文件只留注释不初始化。
(function () {
  'use strict'

  var Core = window.FoliaNebbiaCore
  var Chars = window.FoliaNebbiaChars
  var Layout = window.FoliaNebbiaLayout
  var Glyphs = window.FoliaNebbiaGlyphs
  var SeedHash = window.FoliaSeedHash
  var clamp = Core.clamp
  var smooth = Core.smooth
  var NEBBIA_FIXED = Core.NEBBIA_FIXED
  var isIconChar = Chars.isIconChar
  var isWideChar = Layout.isWideChar
  var pointAt = Glyphs.pointAt
  var warpGlyph = Glyphs.warpGlyph
  var layoutNebbiaSong = Layout.layoutNebbiaSong

  // ---------- 场景排布（原版 nebbiaScene.ts） ----------
  // 一首歌在雾笺上的全部安排：每个字的位置、变形后的字形、擦痕边的水珠和下淌的水珠、出现方式（手写或透出）；
  // 每句的淡出方式和「让位」时刻（后面某句要写到这句的位置、而这句还没被雾吞掉时，这句提前快速起雾，
  // 屏上满了来不及的就哈一口气盖掉，nebbiaBreath.ts）。
  // 只由歌词、tuning 和屏幕尺寸决定；每帧怎么画在 nebbiaMask.ts（后续批次）。
  //
  // Bead：{ s, x, y, nx, ny, r, j }（擦痕边凝出的小水珠）；Drip：{ delay, len, dur, r, seed }（往下淌的水珠）。
  // LaidChar = NebbiaChar + { x, y, s, rot, glyph, beads, drips, ends, appearDur, wt, wd }。
  // LaidLine：{ chars, t, end, next, mode, fogAt, yieldAt,
  //   wipe（手指抹除的几何，第一次用到时才建：undefined = 还没建，null = 没有可抹的字；nebbia-wipe.js 后续批次）,
  //   breathAt, breathUntil, breathDur,
  //   breath（让位时哈气的白气，第一次用到时才建；nebbia-breath.js 后续批次）,
  //   appearBreathAt, appearBreathUntil,
  //   appearBreath（出现方式选到「哈气后书写」的白气，同上） }。

  /** 一句的消失方式：两种都开就按种子随机。 */
  function lineModeOf(fade, idx, seed) {
    if (fade.length === 1) return fade[0]
    return SeedHash.createVisualizerRng((seed + idx * 977 + 3) >>> 0)() < 0.5 ? 'fog' : 'fingers'
  }

  /** 写完后开始起雾的时刻：下一句开始（最多唱完 6 秒）后再保持 hold 秒。 */
  function fogStartOf(end, next, hold) {
    return Math.min(next, end + 6) + hold
  }

  /** 屏上还空着时，一句最多比 fogStartOf 多留几秒；也最多留到后面第 LINGER_LINES 句开始后 hold 秒。 */
  var LINGER_MAX = 16
  var LINGER_LINES = 3

  /** 一个字挑水珠：每一笔沿边缘零星凝出小水珠，少数笔画底部会淌下一颗。 */
  function decorate(c, base, rnd, warp) {
    var g = warpGlyph(base, SeedHash.createVisualizerRng(Math.floor(rnd() * 1e9)), warp)
    c.glyph = g
    c.beads = g.strokes.map(function (st) {
      var out = [], step = 7 / c.s
      for (var s = step * rnd(); s < st.len; s += step * (0.5 + rnd())) {
        if (rnd() > NEBBIA_FIXED.beads) continue
        var p = pointAt(st, s), side = rnd() < 0.5 ? -1 : 1
        out.push({ s: s, x: p[0], y: p[1], nx: p[2] * side, ny: p[3] * side, r: 1.6 + Math.pow(rnd(), 2.2) * 3.6, j: rnd() })
      }
      return out
    })
    c.drips = g.strokes.map(function () {
      return rnd() < NEBBIA_FIXED.drip * 0.22
        ? { delay: 0.3 + rnd() * 1.6, len: 30 + rnd() * 130, dur: 2 + rnd() * 3.5, r: 3.2 + rnd() * 2.6, seed: rnd() * 100 }
        : null
    })
    // 收笔水珠的随机量放在最后取，不打乱前面的随机序列
    c.ends = g.strokes.map(function () { return { h: rnd(), j: rnd() } })
  }

  /** 自然书写一个字要几秒。 */
  function naturalWriteTime(g, speed) {
    return (g.total * 0.28 + (g.strokes.length - 1) * 0.06) / speed
  }

  /** 按速度系数 k（用时 = 自然用时 × k）一个接一个写，返回每个字的开始时刻和写完的时刻。 */
  function scheduleWrite(cs, nat, k) {
    var end = -Infinity
    var starts = cs.map(function (c, i) {
      var t0 = Math.max(c.t, end)
      end = t0 + nat[i] * k
      return t0
    })
    return { starts: starts, end: end }
  }

  /**
   * 一句的出现方式和书写节奏：写字不必跟着每个字唱的那一点，可以一直写到下一句开唱（或这句唱完，取晚的）。
   * 字照顺序一个接一个写，不早于开唱；整句统一一个速度系数，正好写完，最慢是自然速度、最快压到 0.3 倍。
   * 书写的两种（手指书写、哈气后书写）开着几种就按种子挑一种；慢慢显现也开着时，压到 0.3 倍都写不完的句子改成慢慢显现，
   * 只开慢慢显现就句句显现。
   */
  function applyAppear(line, tuning, idx, seed) {
    var kinds = tuning.appear.filter(function (a) { return a !== 'fade' })
    var canFade = tuning.appear.indexOf('fade') >= 0
    var kind = null
    if (kinds.length) {
      var pick = SeedHash.createVisualizerRng((seed + idx * 613 + 11) >>> 0)()
      kind = kinds[Math.floor(pick * kinds.length)]
    }
    var cs = line.chars.filter(function (c) { return c.glyph })
    var nat = cs.map(function (c) { return naturalWriteTime(c.glyph, tuning.writeSpeed) })
    var until = Math.max(line.next, line.end)
    var k = 1
    if (scheduleWrite(cs, nat, 1).end > until) {
      // 写完的时刻随 k 单调，二分找正好写完的 k
      var lo = 0.3, hi = 1
      for (var n = 0; n < 14; n += 1) {
        var m = (lo + hi) / 2
        if (scheduleWrite(cs, nat, m).end > until) hi = m
        else lo = m
      }
      k = lo
    }
    var plan = scheduleWrite(cs, nat, k)
    var fade = !kind || (canFade && cs.length > 0 && plan.end > until + 1e-3)
    cs.forEach(function (c, i) { c.wt = plan.starts[i]; c.wd = nat[i] * k })
    if (kind === 'breath' && !fade && cs.length) {
      line.appearBreathAt = cs[0].wt - NEBBIA_FIXED.breathSpread - 0.3
      line.appearBreathUntil = line.end + NEBBIA_FIXED.breathHold
    }
    for (var i2 = 0; i2 < line.chars.length; i2 += 1) line.chars[i2].appearDur = fade ? clamp(line.chars[i2].d * 3, 0.35, 1.2) : 0
  }

  /** 片尾的歌手等曲名写完再写：整句的书写时刻往后挪到曲名最后一个字写完后 0.4 秒。 */
  function alignCredits(laid, source) {
    var ti = -1, ai = -1
    for (var i = 0; i < source.length; i += 1) {
      if (ti < 0 && source[i].credits === 'title') ti = i
      if (ai < 0 && source[i].credits === 'artist') ai = i
    }
    if (ti < 0 || ai < 0) return
    var written = laid[ti].chars.filter(function (c) { return c.glyph })
    var last = written[written.length - 1]
    if (!last) return
    var first = null
    for (var k = 0; k < laid[ai].chars.length && !first; k += 1) if (laid[ai].chars[k].glyph) first = laid[ai].chars[k]
    var shift = first ? Math.max(0, last.wt + last.wd + 0.4 - first.wt) : 0
    laid[ai].chars.forEach(function (c) { c.wt += shift })
  }

  function lineRect(line) {
    var x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, S = 0
    for (var i = 0; i < line.chars.length; i += 1) {
      var c = line.chars[i]
      if (!c.glyph) continue
      x0 = Math.min(x0, c.x - c.s / 2); x1 = Math.max(x1, c.x + c.s / 2)
      y0 = Math.min(y0, c.y - c.s / 2); y1 = Math.max(y1, c.y + c.s / 2); S = Math.max(S, c.s)
    }
    return { x0: x0, x1: x1, y0: y0, y1: y1, S: S }
  }

  /** 排一首歌：source 来自 buildNebbiaLines（含 appendNebbiaCredits 接的片尾两句），glyphs 是按主题字体的字形缓存。 */
  function buildNebbiaScene(source, glyphs, tuning, size, seed) {
    var seedHash = SeedHash.hashVisualizerSeed(String(seed))
    var modes = source.map(function (l, i) { return l.credits ? 'fog' : lineModeOf(tuning.fade, i, seedHash) })
    var fadeOf = function (i) { return tuning.refog + (modes[i] === 'fog' ? 0 : 2.5) }
    // 片尾（nebbia-chars.js 的 appendNebbiaCredits）：曲名开写时前面的句子已经散得差不多（起雾不晚于开写前 0.6 个起雾用时），片尾两句不起雾
    var creditsLine = null
    for (var i0 = 0; i0 < source.length; i0 += 1) if (source[i0].credits) { creditsLine = source[i0]; break }
    var creditsAt = creditsLine ? creditsLine.t : Infinity
    var beforeCredits = function (i) { return Math.max(source[i].end + 0.5, creditsAt - fadeOf(i) * 0.6) }
    var fogAt = function (i) {
      return source[i].credits ? Infinity
        : Math.min(fogStartOf(source[i].end, source[i].next, tuning.hold), beforeCredits(i))
    }
    var lingerAt = function (i) {
      return Math.max(fogAt(i), Math.min(fogAt(i) + LINGER_MAX,
        (source[i + LINGER_LINES] ? source[i + LINGER_LINES].t : Infinity) + tuning.hold, beforeCredits(i)))
    }
    var goneAt = function (i) { return fogAt(i) + fadeOf(i) }
    var pos = layoutNebbiaSong(source, {
      W: size.W, H: size.H, jitter: tuning.jitter, layouts: tuning.layouts, fontScale: size.fontScale,
      visibleUntil: goneAt, fogAt: fogAt,
      lingerUntil: function (i) { return lingerAt(i) + fadeOf(i) }
    })
    var laid = source.map(function (line, li) {
      return {
        t: line.t, end: line.end, next: line.next, mode: modes[li], fogAt: fogAt(li), yieldAt: Infinity,
        breathAt: Infinity, breathUntil: Infinity, breathDur: NEBBIA_FIXED.breathSpread,
        appearBreathAt: Infinity, appearBreathUntil: Infinity,
        chars: line.chars.map(function (c, i) {
          var p = pos[li][i], wide = isWideChar(c.ch) || isIconChar(c.ch)
          var out = {
            ch: c.ch, t: c.t, d: c.d,
            x: p.x, y: p.y, s: p.s * (wide ? 1 : 1.15), rot: p.rot,
            glyph: null, beads: [], drips: [], ends: [], appearDur: 0, wt: c.t, wd: 0
          }
          var base = glyphs.get(c.ch)
          if (base) decorate(out, base, SeedHash.createVisualizerRng((li * 131 + i * 17 + 5) >>> 0), tuning.warp)
          return out
        })
      }
    })
    laid.forEach(function (line, li) { applyAppear(line, tuning, li, seedHash) })
    alignCredits(laid, source)
    // 让位：后面第一句和这句重叠、且在这句（多留之后）消失前开始的，记下它开始的时刻。
    // 多留：屏上还空着就晚点起雾，留到让位前 refog 秒（来得及慢慢起雾），不早于原来的时刻。
    // 到让位时还消失不了的（屏上满了），在那句开写前哈一口气把这句盖掉，那句写在白气上
    var rects = laid.map(lineRect)
    var breathSpread = NEBBIA_FIXED.breathSpread, breathHold = NEBBIA_FIXED.breathHold
    laid.forEach(function (line, i) {
      if (source[i].credits) return
      var gone = lingerAt(i) + fadeOf(i)
      var by = -1
      for (var j = i + 1; j < laid.length && laid[j].t < gone; j += 1) {
        var a = rects[i], b = rects[j]
        if (Math.min(a.x1, b.x1) > Math.max(a.x0, b.x0) && Math.min(a.y1, b.y1) > Math.max(a.y0, b.y0)) {
          line.yieldAt = yieldMoment(laid[j].t, line)
          by = j
          break
        }
      }
      line.fogAt = Math.max(fogAt(i), Math.min(lingerAt(i), line.yieldAt - fadeOf(i)))
      // 给片尾让位的不哈气：前面已经在散了，按让位快速起雾就好
      if (by >= 0 && !source[by].credits && line.yieldAt < line.fogAt + fadeOf(i)) {
        // 挤的时候（让位紧跟着写完）不提前那么多：从写完 YIELD_READ 秒后才哈，鼓开收短到让位前 0.3 秒鼓完，最短 0.3 秒
        var from = Math.max(line.yieldAt - breathSpread - 0.3, writtenAt(line) + YIELD_READ)
        line.breathAt = from
        line.breathDur = Math.max(0.3, line.yieldAt - 0.3 - from)
        line.breathUntil = laid[by].end + breathHold
      } else if (by >= 0 && line.mode === 'fingers') {
        // 按手指搓掉的：搓开的地方后面那句不再先哈气（不然刚搓开又哈上白气，两个效果打架），直接写
        laid[by].appearBreathAt = Infinity
      }
    })
    return laid
  }

  /** 让位前多少秒开始收（快速起雾从让位前 0.6 秒起，哈气从 breathSpread + 0.3 秒起），和写完后至少留着看清的秒数。 */
  var YIELD_LEAD = 0.6, YIELD_READ = 0.3
  /**
   * 这句最早什么时候让位：后面那句开写的时刻，但不早于这句最后一个字写完（慢慢显现的显出一半）再留 YIELD_READ 秒。
   * 不然唱得快、屏上又挤时，后面那句一压上来，这句写到一半就被哈气盖掉了（比如一句只唱一秒多，后半句没写就没了）。
   */
  function yieldMoment(nextT, line) {
    return Math.max(nextT, writtenAt(line) + YIELD_READ + YIELD_LEAD)
  }

  /** 这句最后一个字写完（慢慢显现的显出一半）的时刻。 */
  function writtenAt(line) {
    var done = line.t
    for (var i = 0; i < line.chars.length; i += 1) {
      var c = line.chars[i]
      if (!c.glyph) continue
      done = Math.max(done, c.wd > 0 ? c.wt + c.wd : c.t + Math.min(c.appearDur, 0.5))
    }
    return done
  }

  /** 让位的句子在后面那句开写前 0.6 秒起用 1 秒快速起雾；屏上满了要哈气盖掉的，在白气鼓开的这一下里没了。 */
  function yieldFactor(line, T) {
    return line.breathAt < Infinity
      // 哈气盖掉的：白气鼓开的这一阵里先糊开（着色器按白气遮罩的 B 通道糊），晚一点起淡进雾里，鼓开到 85% 时没了
      ? 1 - smooth(clamp(((T - line.breathAt) / line.breathDur - 0.15) / 0.7))
      : 1 - smooth(clamp((T - line.yieldAt + YIELD_LEAD) / 1))
  }

  /** 哈气盖掉的旧字在擦痕遮罩上留到多少：比起雾的阈值低，不再透出窗外，只让白气在那儿薄一点（着色器），留个浅浅的印子。 */
  var BREATH_GHOST = 0.08

  /** 擦痕遮罩用的让位系数：哈气盖掉的不降到 0，留 BREATH_GHOST 的印子，跟着这句自己慢慢起雾一起淡掉。水珠还是用 yieldFactor。 */
  function yieldMask(line, T) {
    var yf = yieldFactor(line, T)
    return line.breathAt < Infinity ? Math.max(yf, BREATH_GHOST) : yf
  }

  // ---------- 聚光灯（原版 nebbiaSpot.ts） ----------
  // 聚光灯：远处楼底下两盏（左右对称）打向正在写的字，强调色；这句写完（且唱完）0.8 秒后慢慢熄灭。
  // 目标点沿着字连续移动（写第 i 个字的过程中从第 i 个字滑向第 i+1 个字），用临界阻尼弹簧去追，速度也连续；
  // 播放时间是一跳一跳更新的，用自己平滑过的时钟。每换一个字就瞬移目标、一阶指数追，快歌里会一抽一抽。

  // 一个字开始出现的时刻：手指书写按 c.wt（和 nebbiaInk 的 drawChar 一致，写字节奏不跟每个字唱的那一点），慢慢显现的按 c.t
  function startOf(c) {
    return c.appearDur > 0 ? c.t : c.wt
  }

  // 一个字出现完的时刻：写完，或显现完
  function doneOf(c) {
    return startOf(c) + (c.appearDur > 0 ? c.appearDur : c.wd)
  }

  // 一句全部出现完的时刻，不早于唱完；排版定了就不变，按句缓存（重排出来的是新对象）
  var doneAt = new WeakMap()
  function lineDoneOf(line) {
    var end = doneAt.get(line)
    if (end === undefined) {
      end = line.end
      for (var i = 0; i < line.chars.length; i += 1) {
        var c = line.chars[i]
        if (c.glyph) end = Math.max(end, doneOf(c))
      }
      doneAt.set(line, end)
    }
    return end
  }

  // 当前正在写的字，以及同一句里它后面的下一个字。两句同时在写（上一句还没写完、下一句已开写）时只跟后一句，
  // 不在两句之间来回跳；一句里取最晚开始出现的那个字
  function currentWritingChar(laid, T) {
    for (var li = laid.length - 1; li >= 0; li -= 1) {
      var line = laid[li]
      // 一句可以一直写到下一句开唱（片尾歌手还要等曲名写完），按写完的时刻熄灯，不按唱完
      if (T < line.t - 0.05 || T > lineDoneOf(line) + 0.8) continue
      var k = -1
      line.chars.forEach(function (c, i) {
        if (c.glyph && startOf(c) <= T && (k < 0 || startOf(c) >= startOf(line.chars[k]))) k = i
      })
      if (k < 0) continue
      var next = null
      for (var i2 = k + 1; i2 < line.chars.length && !next; i2 += 1) if (line.chars[i2].glyph) next = line.chars[i2]
      return { c: line.chars[k], next: next }
    }
    return null
  }

  function NebbiaSpot() {
    this.x = 0; this.y = 0; this.r = 0; this.i = 0
    this.vx = 0; this.vy = 0; this.vr = 0
    this.t = 0
    this.init = false
  }

  /** 一帧：T 是播放时间，dt 是真实流逝的秒数（暂停时 0）。 */
  NebbiaSpot.prototype.update = function (laid, T, dt) {
    // 平滑时钟：离播放时间太远（拖进度、暂停）就直接对齐，否则慢慢往播放时间靠
    this.t += dt
    if (Math.abs(T - this.t) > 0.25 || dt === 0) this.t = T
    else this.t += (T - this.t) * (1 - Math.exp(-dt / 0.3))
    var cur = currentWritingChar(laid, this.t)
    if (cur) {
      var c = cur.c, next = cur.next
      var u = next ? smooth(clamp((this.t - startOf(c)) / Math.max(0.05, startOf(next) - startOf(c)))) : 0
      var gx = next ? c.x + (next.x - c.x) * u : c.x, gy = next ? c.y + (next.y - c.y) * u : c.y, gr = next ? c.s + (next.s - c.s) * u : c.s
      if (!this.init || dt === 0) {
        this.x = gx; this.y = gy; this.r = gr
        this.vx = this.vy = this.vr = 0
        this.init = true
      }
      // 临界阻尼弹簧，分几步积分保证稳定；时间常数约 0.1 秒
      var w = 1 / 0.1, n = Math.ceil(dt / 0.008)
      for (var j = 0; j < n; j += 1) {
        var h = dt / n
        this.vx += (w * w * (gx - this.x) - 2 * w * this.vx) * h; this.x += this.vx * h
        this.vy += (w * w * (gy - this.y) - 2 * w * this.vy) * h; this.y += this.vy * h
        this.vr += (w * w * (gr - this.r) - 2 * w * this.vr) * h; this.r += this.vr * h
      }
    }
    if (dt === 0) this.i = cur ? 1 : 0
    else this.i += ((cur ? 1 : 0) - this.i) * (1 - Math.exp(-dt / (cur ? 0.15 : 0.5)))
  }

  NebbiaSpot.prototype.reset = function () {
    this.init = false
    this.i = 0
  }

  window.FoliaNebbiaScene = {
    // nebbiaScene.ts
    fogStartOf: fogStartOf,
    naturalWriteTime: naturalWriteTime,
    lineRect: lineRect,
    buildNebbiaScene: buildNebbiaScene,
    yieldMoment: yieldMoment,
    yieldFactor: yieldFactor,
    BREATH_GHOST: BREATH_GHOST,
    yieldMask: yieldMask,
    // nebbiaSpot.ts
    NebbiaSpot: NebbiaSpot
  }
})()
