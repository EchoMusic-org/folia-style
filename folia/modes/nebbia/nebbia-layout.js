// 雾笺（nebbia）排版模块：移植自 folia-major src/components/visualizer/nebbia/
//   nebbiaBlocks.ts（排版前半段：按「字数 + 时长」给词打分定角色、块化、横/竖排量尺寸与摆放）
//   nebbiaCompositions.ts（9 种构图：横条、两三行错落、十字、竖柱、刊头、徽章、竖排几列、环绕 + COMPOSITION_BIAS）
//   nebbiaLayout.ts（整首排版：每句挑构图，在候选位置/字号里打分防重叠，结果只由歌词、时间和屏幕尺寸决定）
// 全部挂 window.FoliaNebbiaLayout，被 nebbia-scene.js 引用。
//
// 插件差异（相对上游）：无；随机流都走 window.FoliaSeedHash（上游 visualizerSeedHash.ts），笔顺笔数查
// window.FoliaNebbiaGlyphs.getNebbiaStrokeMedians，图标字判断用 window.FoliaNebbiaChars.isIconChar。
// 上游的 TS 接口（Role/Block/Measured/PlacedItem/CompositionContext/Result/Candidate/NebbiaLayoutOptions 等）
// 没有运行时形态，保留为段首注释。
(function () {
  'use strict'

  var Core = window.FoliaNebbiaCore
  var Chars = window.FoliaNebbiaChars
  var Glyphs = window.FoliaNebbiaGlyphs
  var SeedHash = window.FoliaSeedHash
  var clamp = Core.clamp

  // ---------- 词角色与块（原版 nebbiaBlocks.ts） ----------
  // 雾笺排版的前半段，照商籁的思路（sonnetTypographyRoles.ts）：按「字数 + 时长」给词打分，分最高的是主词（hero）
  // 放大，次高的副主词（semi）略大，单字虚词缩小；词多的句子把相邻的词并成几块。块可以横排或竖排量尺寸
  // （竖排时中日文逐字往下，拉丁词整个转 90°）。坐标单位都是基准字号 1。

  var CJK = /[぀-ヿ㐀-鿿豈-﫿가-힯]/
  var PUNCT = /^[，。、！？!?,.・…]$/
  // 竖排时要转 90° 的字（长音、破折号、省略号）
  var TURN_IN_VERTICAL = /^[ー—～〜…-]$/

  var PARTICLES = new Set([...'的了着过吗呢吧啊呀嘛之与和是也都就还又被把给のがをにはへとでやもねよなかしてたっ'])

  // Role：'hero' | 'semi' | 'support' | 'particle'
  var ROLE_SCALE = { hero: 2.0, semi: 1.35, support: 1, particle: 0.78 }
  /** 快歌的主次差小一点，读起来更稳。 */
  var ROLE_SCALE_FAST = { hero: 1.55, semi: 1.18, support: 1, particle: 0.85 }
  /** 同一行（列）里词和词之间、行和行之间的空。 */
  var FLOW_GAP = 0.3
  var STACK_GAP = 0.32

  // BlockWord：{ idx, scale, cjk }；Block：{ role, words }。

  function isWideChar(ch) { return /[　-鿿＀-￯]/.test(ch) }

  /** 横排时一个字占的宽度（× 字号）。 */
  function advanceOf(ch) {
    if (Chars.isIconChar(ch)) return 1.1
    if (ch === ' ') return 0.32
    if (/[，。、・．]/.test(ch)) return 0.5
    if (isWideChar(ch)) return 1
    if (/[il.,'!|:;]/.test(ch)) return 0.3
    if (/[mwMW]/.test(ch)) return 0.72
    return 0.5
  }

  /** 标点粘到前一个词上；分词器把一串片假名切开的（パ｜ラジクロロ）再并回去。 */
  function mergeWords(chars, words) {
    var out = []
    var kata = function (w) { return w.every(function (k) { return /^[゠-ヿ]$/.test(chars[k].ch) }) }
    for (var i = 0; i < words.length; i += 1) {
      var w = words[i]
      var last = out[out.length - 1]
      if (last && (w.every(function (k) { return PUNCT.test(chars[k].ch) }) || (kata(w) && kata(last) && w[0] === last[last.length - 1] + 1))) {
        Array.prototype.push.apply(last, w)
      } else {
        out.push(w.slice())
      }
    }
    return out
  }

  // 商籁同款打分：字数（最多 8）× 14 + 时长（最多 2.5 秒）× 18
  function scoreWord(chars, w) {
    var len = 0
    for (var i = 0; i < w.length; i += 1) if (chars[w[i]].ch.trim()) len += 1
    var t0 = chars[w[0]].t, last = chars[w[w.length - 1]]
    return Math.min(len, 8) * 14 + clamp(last.t + last.d - t0, 0, 2.5) * 18
  }

  /** 每个词的角色：主词一个；词数 ≥ 4 时挑一个离主词至少隔一个词、分数 ≥ 主词 35% 的副主词；单字虚词缩小。 */
  function assignRoles(chars, words) {
    var scores = words.map(function (w) { return scoreWord(chars, w) })
    var hero = 0
    scores.forEach(function (s, i) { if (s > scores[hero]) hero = i })
    var semi = -1
    if (words.length >= 4) {
      words.forEach(function (w, i) {
        if (i === hero || Math.abs(i - hero) < 2 || w.length < 2 || scores[i] < scores[hero] * 0.35) return
        if (semi < 0 || scores[i] > scores[semi]) semi = i
      })
    }
    return words.map(function (w, i) {
      if (i === hero && words.length > 1) return 'hero'
      if (i === semi) return 'semi'
      if (w.length === 1 && PARTICLES.has(chars[w[0]].ch)) return 'particle'
      return 'support'
    })
  }

  function isCjkWord(chars, w) {
    return w.every(function (k) { return CJK.test(chars[k].ch) || PUNCT.test(chars[k].ch) })
  }

  /** 把词并成至多 maxBlocks 块：虚词先并到前一块；还多就把相邻、都不是主次词、合起来最短的两块并起来。 */
  function makeBlocks(chars, words, roles, scales, maxBlocks) {
    var blocks = []
    words.forEach(function (w, i) {
      var role = roles[i], word = { idx: w, scale: scales[role], cjk: isCjkWord(chars, w) }
      var last = blocks[blocks.length - 1]
      if (role === 'particle' && last && last.role !== 'hero' && last.role !== 'semi') last.words.push(word)
      else blocks.push({ role: role, words: [word] })
    })
    var len = function (b) { return b.words.reduce(function (s, w) { return s + w.idx.length }, 0) }
    var strong = function (b) { return b.role === 'hero' || b.role === 'semi' }
    while (blocks.length > maxBlocks) {
      var bi = -1, bl = Infinity
      for (var i = 0; i < blocks.length - 1; i += 1) {
        if (strong(blocks[i]) || strong(blocks[i + 1])) continue
        if (len(blocks[i]) + len(blocks[i + 1]) < bl) { bl = len(blocks[i]) + len(blocks[i + 1]); bi = i }
      }
      if (bi < 0) break
      blocks[bi] = { role: 'support', words: blocks[bi].words.concat(blocks[bi + 1].words) }
      blocks.splice(bi + 1, 1)
    }
    return blocks
  }

  // MeasureItem：{ k, off, s, rot, punct }；Measured：{ dir: 'h'|'v', items, w, h }；PlacedItem：{ k, x, y, s, rot }。

  var gapOf = function (a, b) { return a.cjk && b.cjk ? 0.04 : 0.24 }

  /**
   * 笔画多的字单独放大（10 笔起，19 笔以上到 1.25 倍），字号小也看得清；本来就大的词（主词）放大得少。
   * 只看笔顺数据里的笔数：没有数据的字（拉丁字母、数据还没加载）不放大。
   */
  function complexScale(ch, scale) {
    var medians = Glyphs.getNebbiaStrokeMedians(ch)
    var n = medians ? medians.length : 0
    return 1 + 0.25 * clamp((n - 9) / 10) / Math.max(1, scale)
  }

  /** 量一块：'h' 横排，'v' 竖排。items 是沿排列方向各字的偏移。 */
  function measureBlock(block, chars, dir) {
    var items = []
    var pen = 0, thick = 0
    block.words.forEach(function (w, wi) {
      if (wi > 0) pen += gapOf(block.words[wi - 1], w) * (dir === 'v' && w.cjk ? 0 : 1)
      for (var i = 0; i < w.idx.length; i += 1) {
        var k = w.idx[i]
        var ch = chars[k].ch
        var vertCjk = dir === 'v' && w.cjk
        var a = vertCjk ? (PUNCT.test(ch) ? 0.55 : 1.02) : advanceOf(ch)
        var rot = dir === 'v' && (!w.cjk || TURN_IN_VERTICAL.test(ch)) ? Math.PI / 2 : 0
        var s = w.scale * (w.cjk ? complexScale(ch, w.scale) : 1)
        items.push({ k: k, off: pen + a * s / 2, s: s, rot: rot, punct: vertCjk && PUNCT.test(ch) })
        pen += a * s
        thick = Math.max(thick, s)
      }
    })
    return dir === 'h' ? { dir: dir, items: items, w: pen, h: thick } : { dir: dir, items: items, w: thick, h: pen }
  }

  /** 量好的块放到中心 (cx, cy)：横排底边对齐，竖排中线对齐，竖排的句读点放在格子右上。 */
  function emitBlock(m, cx, cy, out) {
    for (var i = 0; i < m.items.length; i += 1) {
      var it = m.items[i]
      if (m.dir === 'h') out.push({ k: it.k, x: cx - m.w / 2 + it.off, y: cy + m.h / 2 - it.s / 2, s: it.s, rot: 0 })
      else out.push({ k: it.k, x: cx + (it.punct ? it.s * 0.3 : 0), y: cy - m.h / 2 + it.off - (it.punct ? it.s * 0.2 : 0), s: it.s, rot: it.rot })
    }
  }

  function hasTurned(m) {
    return m.items.some(function (it) { return it.rot }) ? 1 : 0
  }

  // ---------- 构图（原版 nebbiaCompositions.ts） ----------
  // 雾笺照商籁的几种构图摆一句的几块：横条、两三行错落、十字、竖柱、刊头、徽章、竖排几列、环绕。
  // 阅读顺序始终和演唱顺序一致。每个构图返回各字的位置（基准字号 1）和转了 90° 的拉丁块数（用来少用它），放不下返回 null。
  // CompositionContext：{ blocks, h, chars }；CompositionResult：{ items, vRot }。

  var M = function (ctx, i, dir) { return measureBlock(ctx.blocks[i], ctx.chars, dir) }
  // [...Array(n).keys()] 的等价：0..n-1
  function range(n) {
    var out = []
    for (var i = 0; i < n; i += 1) out.push(i)
    return out
  }

  /** 几行块：行内底边对齐，行与行按真实行高叠起来，shifts 是每行横向错开（× 最宽行宽）。 */
  function flowRows(ctx, rows, shifts) {
    var out = []
    var rowMs = rows.map(function (r) { return r.map(function (i) { return M(ctx, i, 'h') }) })
    var rowW = rowMs.map(function (ms) { return ms.reduce(function (s, m) { return s + m.w }, 0) + FLOW_GAP * (ms.length - 1) })
    var widest = Math.max.apply(null, rowW)
    var y = 0
    rowMs.forEach(function (ms, ri) {
      var rh = Math.max.apply(null, ms.map(function (m) { return m.h }))
      var x = -rowW[ri] / 2 + shifts[ri] * widest
      ms.forEach(function (m) { emitBlock(m, x + m.w / 2, y + rh - m.h / 2, out); x += m.w + FLOW_GAP })
      y += rh + STACK_GAP
    })
    return { items: out, vRot: 0 }
  }

  var COMPOSITIONS = {
    // 横条：一行
    ribbon: function (ctx) { return flowRows(ctx, [ctx.blocks.map(function (_, i) { return i })], [0]) },
    // 两行错落：在块边界处按宽度对半分，上行往左、下行往右错开
    lines2: function (ctx) {
      var n = ctx.blocks.length
      if (n < 2) return null
      var ms = ctx.blocks.map(function (_, i) { return M(ctx, i, 'h') }), total = ms.reduce(function (s, m) { return s + m.w }, 0)
      var acc = 0, cut = 1, best = Infinity
      ms.forEach(function (m, i) {
        acc += m.w
        if (i < n - 1 && Math.abs(acc - total / 2) < best) { best = Math.abs(acc - total / 2); cut = i + 1 }
      })
      return flowRows(ctx, [range(cut), range(n - cut).map(function (i) { return i + cut })], [-0.12, 0.12])
    },
    // 三行错落（长句）
    lines3: function (ctx) {
      var n = ctx.blocks.length
      if (n < 3) return null
      var ms = ctx.blocks.map(function (_, i) { return M(ctx, i, 'h') }), total = ms.reduce(function (s, m) { return s + m.w }, 0)
      var rows = [[]]
      var acc = 0
      ms.forEach(function (m, i) {
        if (rows[rows.length - 1].length && rows.length < 3 && (acc + m.w / 2 > total / 3 * rows.length || n - i <= 3 - rows.length)) rows.push([])
        rows[rows.length - 1].push(i)
        acc += m.w
      })
      return rows.length === 3 ? flowRows(ctx, rows, [-0.14, 0.1, -0.04]) : null
    },
    // 十字：上竖列 → 左横排 → 主词 → 右横排 → 下竖列，扫视顺序 = 演唱顺序
    cross: function (ctx) {
      var blocks = ctx.blocks, h = ctx.h, n = blocks.length
      if (n < 3 || n > 7) return null
      var top = Math.floor(h / 2), right = Math.ceil((n - 1 - h) / 2)
      if (top === 0 && h + right + 1 >= n) return null // 没有竖着的部分就和横条一样了
      var out = [], hm = M(ctx, h, 'h')
      emitBlock(hm, 0, 0, out)
      var vRot = 0
      var x = -hm.w / 2 - STACK_GAP
      for (var i = h - 1; i >= top; i -= 1) { var m1 = M(ctx, i, 'h'); emitBlock(m1, x - m1.w / 2, (hm.h - m1.h) / 2, out); x -= m1.w + FLOW_GAP }
      var y = -hm.h / 2 - STACK_GAP
      for (var i2 = top - 1; i2 >= 0; i2 -= 1) { var m2 = M(ctx, i2, 'v'); vRot += hasTurned(m2); emitBlock(m2, 0, y - m2.h / 2, out); y -= m2.h + STACK_GAP }
      x = hm.w / 2 + STACK_GAP
      for (var i3 = h + 1; i3 <= h + right; i3 += 1) { var m3 = M(ctx, i3, 'h'); emitBlock(m3, x + m3.w / 2, (hm.h - m3.h) / 2, out); x += m3.w + FLOW_GAP }
      y = hm.h / 2 + STACK_GAP
      for (var i4 = h + right + 1; i4 < n; i4 += 1) { var m4 = M(ctx, i4, 'v'); vRot += hasTurned(m4); emitBlock(m4, 0, y + m4.h / 2, out); y += m4.h + STACK_GAP }
      return { items: out, vRot: vRot }
    },
    // 竖柱：主词竖着当柱子；前面的词竖排在柱子左边、后面的在右边（列从左往右读），上端对齐
    pillar: function (ctx) {
      var blocks = ctx.blocks, h = ctx.h, n = blocks.length
      if (n < 2 || n > 6) return null
      var out = [], hm = M(ctx, h, 'v')
      var vRot = hasTurned(hm)
      emitBlock(hm, 0, 0, out)
      var top = -hm.h / 2 + 0.15
      var side = function (from, to, dirX) {
        // 先按柱子高度分好列，再从柱子往外摆；左边的列倒过来摆，最早的一列在最外（最左）
        var cols = [[]]
        var y = top
        for (var i = from; i !== to; i += 1) {
          var m = M(ctx, i, 'v')
          vRot += hasTurned(m)
          if (y + m.h > hm.h / 2 + 0.6 && cols[cols.length - 1].length) { cols.push([]); y = top }
          cols[cols.length - 1].push(m)
          y += m.h + STACK_GAP
        }
        var colX = dirX * (hm.w / 2 + FLOW_GAP)
        var order = dirX > 0 ? cols : cols.slice().reverse()
        for (var c = 0; c < order.length; c += 1) {
          var col = order[c]
          y = top
          for (var k = 0; k < col.length; k += 1) { emitBlock(col[k], colX + dirX * col[k].w / 2, y + col[k].h / 2, out); y += col[k].h + STACK_GAP }
          var wmax = 0
          for (var q = 0; q < col.length; q += 1) wmax = Math.max(wmax, col[q].w)
          colX += dirX * (wmax + FLOW_GAP)
        }
      }
      side(0, h, -1)
      side(h + 1, n, 1)
      return { items: out, vRot: vRot }
    },
    // 刊头：前面的词一行在主词上方当眉题，后面的词两两分到主词下方左右两栏
    header: function (ctx) {
      var blocks = ctx.blocks, h = ctx.h, n = blocks.length
      if (n < 3 || n - 1 - h < 2) return null
      var out = [], hm = M(ctx, h, 'h')
      emitBlock(hm, 0, 0, out)
      if (h > 0) {
        var ms = []
        for (var i = 0; i < h; i += 1) ms.push(M(ctx, i, 'h'))
        var rowW = ms.reduce(function (s, m) { return s + m.w }, 0) + FLOW_GAP * (h - 1), rowH = Math.max.apply(null, ms.map(function (m) { return m.h }))
        var x = -rowW / 2
        var y = -hm.h / 2 - STACK_GAP - rowH / 2
        ms.forEach(function (m) { emitBlock(m, x + m.w / 2, y + (rowH - m.h) / 2, out); x += m.w + FLOW_GAP })
      }
      var y2 = hm.h / 2 + STACK_GAP
      var L = -hm.w * 0.22 - FLOW_GAP / 2, R = hm.w * 0.22 + FLOW_GAP / 2
      for (var i2 = h + 1; i2 < n; i2 += 2) {
        var a = M(ctx, i2, 'h'), b = i2 + 1 < n ? M(ctx, i2 + 1, 'h') : null
        var rh = Math.max(a.h, b ? b.h : 0)
        emitBlock(a, L - a.w / 2, y2 + rh - a.h / 2, out)
        if (b) emitBlock(b, R + b.w / 2, y2 + rh - b.h / 2, out)
        y2 += rh + STACK_GAP
      }
      return { items: out, vRot: 0 }
    },
    // 徽章：主词竖柱贴左边，其余词在柱子右边一行行排，过了柱子底再回到全宽
    badge: function (ctx) {
      var blocks = ctx.blocks, h = ctx.h, n = blocks.length
      if (n < 3 || n > 7 || h !== 0) return null
      var out = [], hm = M(ctx, 0, 'v')
      var ms = []
      for (var i = 1; i < n; i += 1) ms.push(M(ctx, i, 'h'))
      var wmax = 0
      for (var q = 0; q < ms.length; q += 1) wmax = Math.max(wmax, ms[q].w)
      var colW = Math.max(wmax, hm.h * 0.9)
      emitBlock(hm, hm.w / 2, hm.h / 2, out)
      var x = hm.w + FLOW_GAP, y = 0, rowH = 0
      var left = function () { return y < hm.h ? hm.w + FLOW_GAP : 0 }
      ms.forEach(function (m) {
        if (x > left() && x + m.w > hm.w + FLOW_GAP + colW) { y += rowH + STACK_GAP; x = left(); rowH = 0 }
        emitBlock(m, x + m.w / 2, y + m.h / 2, out)
        x += m.w + FLOW_GAP
        rowH = Math.max(rowH, m.h)
      })
      return { items: out, vRot: hasTurned(hm) }
    },
    // 竖排几列（只给中日文）：每块一列，从左往右读
    columns: function (ctx) {
      var blocks = ctx.blocks, n = blocks.length
      if (n < 2 || n > 5 || blocks.some(function (b) { return b.words.some(function (w) { return !w.cjk }) })) return null
      var out = []
      var x = 0
      blocks.forEach(function (_, i) {
        var m = M(ctx, i, 'v')
        emitBlock(m, x + m.w / 2, m.h / 2 + (i % 2) * 0.5, out)
        x += m.w + STACK_GAP
      })
      return { items: out, vRot: 0 }
    },
    // 环绕：主词在中间，其余词顺时针绕一圈，左右两侧竖排、上下横排，每块都离开已放下的块
    orbit: function (ctx) {
      var blocks = ctx.blocks, h = ctx.h, n = blocks.length
      if (n < 4 || n > 7) return null
      var out = [], hm = M(ctx, h, 'h')
      emitBlock(hm, 0, 0, out)
      // Rect：{ x0, x1, y0, y1 }
      var rects = [{ x0: -hm.w / 2, x1: hm.w / 2, y0: -hm.h / 2, y1: hm.h / 2 }]
      var sep = function (a, b) { return Math.max(a.x0 - b.x1, b.x0 - a.x1, a.y0 - b.y1, b.y0 - a.y1) }
      var ang = -Math.PI * 0.75, vRot = 0
      var base = Math.hypot(hm.w, hm.h) / 2 + STACK_GAP
      for (var i = 0; i < n; i += 1) {
        if (i === h) continue
        var r = base, a = ang, rect = null, m = M(ctx, i, 'h')
        for (var tries = 0; tries < 600 && !rect; tries += 1) {
          m = M(ctx, i, Math.abs(Math.cos(a)) > 0.75 ? 'v' : 'h')
          var cx = Math.cos(a) * r * 1.25, cy = Math.sin(a) * r * 0.8
          var c = { x0: cx - m.w / 2, x1: cx + m.w / 2, y0: cy - m.h / 2, y1: cy + m.h / 2 }
          var fits = true
          for (var q = 0; q < rects.length; q += 1) if (sep(rects[q], c) < FLOW_GAP) { fits = false; break }
          if (fits) rect = c
          else { a += 0.08; if (tries % 80 === 79) r += 0.5 }
        }
        if (!rect) return null
        rects.push(rect)
        vRot += hasTurned(m)
        emitBlock(m, (rect.x0 + rect.x1) / 2, (rect.y0 + rect.y1) / 2, out)
        ang = a + 0.5
      }
      return { items: out, vRot: vRot }
    }
  }

  /** 构图的额外偏好分（越小越常用）：十字、竖柱、刊头是商籁的招牌，多用；横条、两行最稳；环绕、徽章偶尔。 */
  var COMPOSITION_BIAS = { ribbon: 12, lines2: 10, lines3: 14, cross: 0, pillar: 1, header: 1, badge: 4, columns: 2, orbit: 4 }
  var SIMPLE_COMPOSITIONS = new Set(['ribbon', 'lines2', 'lines3'])

  // ---------- 整首排版（原版 nebbiaLayout.ts） ----------
  // 雾笺的整首排版：每句挑一个构图，再在屏上几个候选位置、几档字号里找一个不和「这句出现时还没消失的句子」
  // 重叠、字够大的地方。整首按时间顺序一次排完，结果只由歌词、时间和屏幕尺寸决定（seek、重建都一样）。
  // NebbiaCharPos：{ x, y, s, rot }；NebbiaLayoutOptions：
  //   { W, H, jitter, layouts（打开的构图；关掉的不参与挑选，实在放不下时的三行兜底不受限）,
  //     fontScale（字号倍数，用户的歌词字号）, visibleUntil(i)（第 i 句的擦痕完全被雾吞掉的时刻）、
  //     fogAt(i)（开始起雾的时刻）, lingerUntil?(i)（屏上还空着时第 i 句最多留到的时刻：
  //     多留的这段只算一点点占地方，后面的句子要用这块它就让位） }。
  // Candidate：{ score, name, items, bb, S, cx, cy, box }；Box：{ x0, x1, y0, y1 }。

  /** 多留着的句子占地方的权重：有空地就别压上去，但不为它缩小字号。 */
  var LINGER_WEIGHT = 0.03

  function bboxOf(items) {
    var x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity
    for (var i = 0; i < items.length; i += 1) {
      var it = items[i]
      x0 = Math.min(x0, it.x - it.s / 2); x1 = Math.max(x1, it.x + it.s / 2)
      y0 = Math.min(y0, it.y - it.s / 2); y1 = Math.max(y1, it.y + it.s / 2)
    }
    return { x0: x0, x1: x1, y0: y0, y1: y1, w: x1 - x0, h: y1 - y0 }
  }

  function overlapArea(a, b) {
    return Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)) * Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0))
  }

  /** 排整首歌：每句一个数组，和 chars 一一对应（空格也有位置，但不画）。 */
  function layoutNebbiaSong(lines, opts) {
    var W = opts.W, H = opts.H, jitter = opts.jitter, layouts = opts.layouts, fontScale = opts.fontScale
    var visibleUntil = opts.visibleUntil, fogAt = opts.fogAt, lingerUntil = opts.lingerUntil
    var mx = W * 0.05, my = H * 0.07
    var Smin = Math.max(26, H * 0.065) * fontScale, Smax = H * 0.14 * fontScale
    var placed = []
    var recent = []
    var prev = null
    // 片尾：曲名横着写在正中偏上，放不下就分两行；歌手小一半写在曲名下面
    var titleBox = null
    var pickWide = function (ctx) {
      var one = COMPOSITIONS.ribbon(ctx), bb = bboxOf(one.items)
      var fits = Math.min(Smax * 1.15, (W - mx * 2) * 0.8 / bb.w) >= Smin
      return (fits ? null : COMPOSITIONS.lines2(ctx)) || one
    }
    var creditsCandidate = function (ctx, kind) {
      var res = (kind === 'title' ? null : COMPOSITIONS.ribbon(ctx)) || pickWide(ctx)
      var bb = bboxOf(res.items)
      var cap = kind === 'title' ? Smax * 1.15 : Smax * 0.55
      var S = Math.min(cap, (W - mx * 2) * 0.8 / bb.w, H * 0.32 / bb.h)
      var bw = bb.w * S, bh = bb.h * S
      var cy = kind === 'title' || !titleBox ? H * 0.42 : titleBox.y1 + bh / 2 + S * 0.6
      var box = { x0: W / 2 - bw / 2, x1: W / 2 + bw / 2, y0: cy - bh / 2, y1: cy + bh / 2 }
      if (kind === 'title') titleBox = box
      return { score: 0, name: 'ribbon', items: res.items, bb: bb, S: S, cx: W / 2, cy: cy, box: box }
    }
    return lines.map(function (line, li) {
      var chars = line.chars
      var rnd = SeedHash.createVisualizerRng((SeedHash.hashVisualizerSeed(chars.map(function (c) { return c.ch }).join('')) + li * 7919) >>> 0)
      var visible = chars.filter(function (c) { return c.ch.trim() })
      // 快歌：每个字平均唱不到 0.22 秒
      var fast = visible.length > 0 && (line.end - line.t) / visible.length < 0.22
      var words = mergeWords(chars, line.words)
      if (!words.length) return chars.map(function () { return { x: W / 2, y: H / 2, s: Smin, rot: 0 } })
      var roles = assignRoles(chars, words)
      var RS = fast ? ROLE_SCALE_FAST : ROLE_SCALE
      // 这句出现时还在屏上的句子；已经开始起雾的按剩下的清晰度打折
      var busy = placed.filter(function (p) { return p.linger > line.t - 0.3 }).map(function (p) {
        return {
          box: p.box,
          w: p.until <= line.t - 0.3 ? LINGER_WEIGHT
            : line.t <= p.fogAt ? 1 : 0.6 + 0.4 * clamp((p.until - line.t) / Math.max(1e-3, p.until - p.fogAt))
        }
      })

      var best = line.credits
        ? creditsCandidate({ blocks: makeBlocks(chars, words, words.map(function () { return 'support' }), ROLE_SCALE, 9), h: 0, chars: chars }, line.credits)
        : null
      if (!best) for (var mb = 0; mb < 2; mb += 1) {
        var maxBlocks = mb === 0 ? 5 : 7
        var blocks = makeBlocks(chars, words, roles, RS, maxBlocks)
        var ctx = { blocks: blocks, h: Math.max(0, blocks.findIndex(function (b) { return b.role === 'hero' })), chars: chars }
        var names = Object.keys(COMPOSITIONS)
        for (var ni = 0; ni < names.length; ni += 1) {
          var name = names[ni]
          if (layouts.indexOf(name) < 0) continue
          var res = COMPOSITIONS[name](ctx)
          if (!res || !res.items.length) continue
          var bb = bboxOf(res.items)
          // 构图最多占半屏左右，给下一句留出地方
          var maxH = H * (name === 'ribbon' ? 0.28 : 0.5), maxW = (W - mx * 2) * (SIMPLE_COMPOSITIONS.has(name) ? 0.94 : 0.68)
          var Sfit = Math.min(maxW / bb.w, maxH / bb.h, Smax)
          if (Sfit < Smin * 0.75) continue
          // 字号也是候选：屏上挤的时候缩小一点换位置，不低于最小字号的 3/4
          var scales = [Sfit, Sfit * 0.8, Sfit * 0.64, Sfit * 0.5].filter(function (v, i) { return i === 0 || v >= Smin * 0.75 })
          for (var si = 0; si < scales.length; si += 1) {
            var S = scales[si]
            var bw = bb.w * S, bh = bb.h * S
            var fxs = [0.5, 0.3, 0.7], fys = [0.25, 0.42, 0.58, 0.75]
            for (var fi = 0; fi < fxs.length; fi += 1) for (var fj = 0; fj < fys.length; fj += 1) {
              var cx = clamp(fxs[fi] * W, mx + bw / 2, W - mx - bw / 2), cy = clamp(fys[fj] * H, my + bh / 2, H - my - bh / 2)
              var box = { x0: cx - bw / 2, x1: cx + bw / 2, y0: cy - bh / 2, y1: cy + bh / 2 }
              var pad = S * 0.3, padBox = { x0: box.x0 - pad, x1: box.x1 + pad, y0: box.y0 - pad, y1: box.y1 + pad }
              var score = 0
              for (var bi = 0; bi < busy.length; bi += 1) score += overlapArea(padBox, busy[bi].box) / (bw * bh) * 1000 * busy[bi].w
              score -= S / H * 100
              if (S < Smin) score += 40 + (Smin - S) / Smin * 200
              score += COMPOSITION_BIAS[name]
              // 转 90° 的拉丁词难读一点，少用；快的句子更少用竖的
              score += res.vRot * (fast ? 10 : 4)
              if (fast && !SIMPLE_COMPOSITIONS.has(name)) score += 6
              if (maxBlocks === 7 && blocks.length <= 5) score += 100
              // 别老是同一个构图、同一个位置；大致在视线中间
              var rep = recent.lastIndexOf(name)
              if (rep >= 0) score += [18, 9, 4][recent.length - 1 - rep]
              if (prev && Math.abs(prev.cx - cx) < W * 0.08 && Math.abs(prev.cy - cy) < H * 0.08) score += 8
              score += Math.abs(cy - H * 0.5) / H * 8
              score += rnd() * 8
              if (!best || score < best.score) best = { score: score, name: name, items: res.items, bb: bb, S: S, cx: cx, cy: cy, box: box }
            }
          }
        }
      }
      // 实在放不下（极长的一句）：三行，按屏幕能放下的字号居中
      if (!best) {
        var blocks2 = makeBlocks(chars, words, roles, ROLE_SCALE_FAST, 9)
        var ctx2 = { blocks: blocks2, h: 0, chars: chars }
        var res2 = COMPOSITIONS.lines3(ctx2) || COMPOSITIONS.lines2(ctx2) || COMPOSITIONS.ribbon(ctx2)
        var bb2 = bboxOf(res2.items)
        var S2 = Math.min(Smax, (W - mx * 2) / bb2.w, (H - my * 2) / bb2.h)
        best = { score: 0, name: 'lines3', items: res2.items, bb: bb2, S: S2, cx: W / 2, cy: H / 2, box: { x0: W / 2 - bb2.w * S2 / 2, x1: W / 2 + bb2.w * S2 / 2, y0: H / 2 - bb2.h * S2 / 2, y1: H / 2 + bb2.h * S2 / 2 } }
      }
      var chosen = best
      placed.push({ box: chosen.box, until: visibleUntil(li), fogAt: fogAt(li), linger: Math.max(visibleUntil(li), lingerUntil ? lingerUntil(li) : 0) })
      recent.push(chosen.name)
      if (recent.length > 3) recent.shift()
      prev = chosen

      // 落到屏幕坐标，再加一点手写歪斜（幅度小，不至于撞到别的字）
      var bb3 = chosen.bb, S3 = chosen.S, cx3 = chosen.cx, cy3 = chosen.cy
      var tilt = (rnd() - 0.5) * 0.04 * jitter
      var byK = new Map()
      chosen.items.forEach(function (it) { byK.set(it.k, it) })
      var lastPos = { x: cx3, y: cy3, s: S3, rot: 0 }
      return chars.map(function (_, k) {
        var it = byK.get(k)
        if (!it) return Object.assign({}, lastPos, { rot: 0 })
        var x = cx3 + (it.x - (bb3.x0 + bb3.x1) / 2) * S3, y0 = cy3 + (it.y - (bb3.y0 + bb3.y1) / 2) * S3
        var s = it.s * S3 * (1 + (rnd() - 0.5) * 0.08 * jitter)
        lastPos = {
          x: x + (rnd() - 0.5) * S3 * 0.04 * jitter,
          y: y0 + (x - cx3) * tilt + (rnd() - 0.5) * S3 * 0.05 * jitter,
          s: s,
          rot: it.rot + (rnd() - 0.5) * 0.08 * jitter + tilt
        }
        return lastPos
      })
    })
  }

  window.FoliaNebbiaLayout = {
    // nebbiaBlocks.ts
    ROLE_SCALE: ROLE_SCALE,
    ROLE_SCALE_FAST: ROLE_SCALE_FAST,
    FLOW_GAP: FLOW_GAP,
    STACK_GAP: STACK_GAP,
    isWideChar: isWideChar,
    advanceOf: advanceOf,
    mergeWords: mergeWords,
    assignRoles: assignRoles,
    makeBlocks: makeBlocks,
    measureBlock: measureBlock,
    emitBlock: emitBlock,
    hasTurned: hasTurned,
    // nebbiaCompositions.ts
    COMPOSITIONS: COMPOSITIONS,
    COMPOSITION_BIAS: COMPOSITION_BIAS,
    SIMPLE_COMPOSITIONS: SIMPLE_COMPOSITIONS,
    // nebbiaLayout.ts
    layoutNebbiaSong: layoutNebbiaSong
  }
})()
