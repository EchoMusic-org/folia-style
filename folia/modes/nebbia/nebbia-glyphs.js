// 雾笺（nebbia）字形模块：移植自 folia-major src/components/visualizer/nebbia/
//   nebbiaStrokes.ts（AnimCJK 笔顺数据：fetch nebbia-strokes.json，只读一次，失败退回骨架追踪）
//   nebbiaSkeleton.ts（没有笔顺数据的字：主题字体画出来 → Zhang-Suen 细化 → 追踪折线 → RDP 化简 → Chaikin 磨角）
//   nebbiaGlyphs.ts（字形 = 按书写顺序的几笔中线：Catmull-Rom 细分、lucide 图标分支、字形缓存、手写变形 warpGlyph、沿笔画取点 pointAt）
// 全部挂 window.FoliaNebbiaGlyphs，被 nebbia-chars.js / nebbia-layout.js / nebbia-scene.js 引用。
//
// 插件差异（相对上游）：
//   笔顺数据是上游构建期从钉死的 AnimCJK commit 生成到产物根目录的 nebbia-strokes.json（Arphic Public License，
//   授权文本随附在 licenses/nebbia-strokes/），插件没有这笔资产：保留 fetch（相对路径 assets/nebbia-strokes.json），
//   读不到时 console.info 说明并整体退回骨架追踪（笔顺按估算），与上游读不到时的路径一致；
//   lucide 图标（每个 SVG 元素一笔）插件同样没有：上游 services/lucideIconResolver 的 resolveLucideIconNode
//   换成可选的 window.foliaLucideIconNode(name) 钩子（返回上游同形的 [[tag, attrs], ...]，未知名字返回 null），
//   没有钩子或未知名一律 null，图标字取不到字形 → 不画（上游对未知名的同一处理路径）；
//   lucideIconAvailable() 供 nebbia-chars.js 判断歌词里的 emoji 要不要换成图标记号。
(function () {
  'use strict'

  var Core = window.FoliaNebbiaCore
  var clamp = Core.clamp

  // 图标记号前缀（上游从 nebbiaChars.ts import ICON_PREFIX；两个 IIFE 的加载顺序不保证，字面量内联，与 nebbia-chars.js 保持一致）
  var ICON_PREFIX = 'icon:'

  // ---------- 笔顺数据（原版 nebbiaStrokes.ts） ----------
  // 中日文的笔顺：AnimCJK 的笔画中线（1024 方格、y 向下），构建时由 dev/nebbia/nebbiaStrokesPlugin.mjs 生成成产物根目录的
  // nebbia-strokes.json，授权文本随附在 licenses/nebbia-strokes/。
  // @note 数据是 Arphic Public License（AnimCJK 的 graphics 文本文件只给了 APL），随应用分发并附授权文本，但不进仓库：每次构建从钉死的 AnimCJK commit 下载生成。
  // 运行时按需读一次；读不到（插件不含这笔资产）就是 null，所有字退回字体骨架追踪，笔顺是估的。
  // NebbiaStrokeData：{ [字]: [x, y][][] }（每个字几笔中线，每笔一串 [x, y]，1024 方格坐标）。

  // 上游按打包器的 BASE_URL 拼（网页版是 /，Electron 是 ./，相对 index.html）；插件相对插件根目录
  var STROKES_URL = 'assets/nebbia-strokes.json'
  var loading = null
  var loaded = null

  /** 读笔顺数据，只读一次；失败不重试，整个会话都用骨架。 */
  function loadNebbiaStrokes() {
    if (!loading) {
      loading = Promise.resolve(typeof fetch === 'function' ? fetch(STROKES_URL) : null)
        .then(function (response) { return response && response.ok ? response.json() : null })
        .catch(function () { return null })
        .then(function (data) {
          loaded = data && typeof data === 'object' ? data : null
          if (!loaded) {
            // 插件没有这笔上游构建期生成的资产：退回骨架追踪，笔顺是估的
            console.info('[folia][nebbia] 笔顺数据 ' + STROKES_URL + ' 没读到（插件不含上游构建期生成的资产），所有字退回字体骨架追踪，笔顺按估算')
          }
          return loaded
        })
    }
    return loading
  }

  /** 已经读到的一个字的笔画中线；没读到、没有这个字时 null。 */
  function getNebbiaStrokeMedians(ch) {
    return (loaded && loaded[ch]) || null
  }

  // ---------- 骨架追踪（原版 nebbiaSkeleton.ts） ----------
  // 没有笔顺数据的字（拉丁字母、标点、笔顺数据没加载时的中日文）：用主题字体把字画出来，
  // 细化成单像素骨架（Zhang-Suen），再追踪成折线、化简、磨圆。笔顺按从上到下、从左到右估。

  var SK = 96
  var skeletonCanvas = null
  var skeletonCtx = null

  // Zhang-Suen 细化：两遍交替剥掉边界像素，直到只剩一像素宽的骨架
  function thin(img) {
    var at = function (x, y) { return (x < 0 || y < 0 || x >= SK || y >= SK) ? 0 : img[y * SK + x] }
    var changed = true
    while (changed) {
      changed = false
      for (var pass = 0; pass < 2; pass += 1) {
        var del = []
        for (var y = 0; y < SK; y += 1) {
          for (var x = 0; x < SK; x += 1) {
            if (!img[y * SK + x]) continue
            var n = [at(x, y - 1), at(x + 1, y - 1), at(x + 1, y), at(x + 1, y + 1), at(x, y + 1), at(x - 1, y + 1), at(x - 1, y), at(x - 1, y - 1)]
            var b = 0
            for (var i = 0; i < 8; i += 1) b += n[i]
            if (b < 2 || b > 6) continue
            var a = 0
            for (var k = 0; k < 8; k += 1) if (!n[k] && n[(k + 1) % 8]) a += 1
            if (a !== 1) continue
            if (pass === 0 ? (n[0] * n[2] * n[4] || n[2] * n[4] * n[6]) : (n[0] * n[2] * n[6] || n[0] * n[4] * n[6])) continue
            del.push(y * SK + x)
          }
        }
        for (var d = 0; d < del.length; d += 1) img[del[d]] = 0
        if (del.length) changed = true
      }
    }
  }

  // 骨架 → 折线：先从端点出发走，再收拾剩下的环；每步优先沿原方向
  function trace(img) {
    var N = [[1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [-1, 1], [-1, -1], [1, -1]]
    function on(x, y) { return x >= 0 && y >= 0 && x < SK && y < SK && img[y * SK + x] === 1 }
    function deg(x, y) {
      var s = 0
      for (var i = 0; i < N.length; i += 1) s += on(x + N[i][0], y + N[i][1]) ? 1 : 0
      return s
    }
    function isolated(p) {
      return p.every(function (pt) {
        var px = pt[0], py = pt[1]
        return N.every(function (dir) {
          return !on(px + dir[0], py + dir[1]) || p.some(function (q) { return q[0] === px + dir[0] && q[1] === py + dir[1] })
        })
      })
    }
    var seen = new Uint8Array(SK * SK)
    var polys = []
    var walk = function (sx, sy) {
      var x = sx, y = sy
      var p = [[x, y]]
      seen[y * SK + x] = 1
      var dir = null
      for (;;) {
        var best = null, bestScore = -9
        for (var i = 0; i < N.length; i += 1) {
          var dx = N[i][0], dy = N[i][1]
          var nx = x + dx, ny = y + dy
          if (!on(nx, ny) || seen[ny * SK + nx]) continue
          var score = dir ? (dx * dir[0] + dy * dir[1]) / Math.hypot(dx, dy) : 0
          if (score > bestScore) { bestScore = score; best = [nx, ny, dx, dy] }
        }
        if (!best) break
        x = best[0]; y = best[1]
        dir = [best[2], best[3]]
        seen[y * SK + x] = 1
        p.push([x, y])
      }
      if (p.length >= 4) polys.push(p)
      // 短的多是细化在交叉处留下的毛刺，扔掉；但不连着别的笔画的是一个点（粗字重下「我」右上的点细化后只剩几个像素），留下
      else if (isolated(p)) polys.push(p.length > 1 ? p : [p[0], [p[0][0] + 1, p[0][1] + 1]])
    }
    for (var y = 0; y < SK; y += 1) for (var x = 0; x < SK; x += 1) if (img[y * SK + x] && deg(x, y) === 1 && !seen[y * SK + x]) walk(x, y)
    for (var y2 = 0; y2 < SK; y2 += 1) for (var x2 = 0; x2 < SK; x2 += 1) if (img[y2 * SK + x2] && !seen[y2 * SK + x2]) walk(x2, y2)
    return polys
  }

  // Ramer-Douglas-Peucker 化简
  function rdp(pts, eps) {
    if (pts.length < 3) return pts
    var a = pts[0], b = pts[pts.length - 1]
    var L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1
    var idx = 0, dmax = 0
    for (var i = 1; i < pts.length - 1; i += 1) {
      var d = Math.abs((b[0] - a[0]) * (a[1] - pts[i][1]) - (a[0] - pts[i][0]) * (b[1] - a[1])) / L
      if (d > dmax) { dmax = d; idx = i }
    }
    if (dmax > eps) {
      var head = rdp(pts.slice(0, idx + 1), eps).slice(0, -1)
      return head.concat(rdp(pts.slice(idx), eps))
    }
    return [a, b]
  }

  // Chaikin 磨角
  function chaikin(input, iterations) {
    var pts = input
    for (var k = 0; k < iterations && pts.length > 2; k += 1) {
      var o = [pts[0]]
      for (var i = 0; i < pts.length - 1; i += 1) {
        var p = pts[i], q = pts[i + 1]
        o.push([p[0] * 0.75 + q[0] * 0.25, p[1] * 0.75 + q[1] * 0.25], [p[0] * 0.25 + q[0] * 0.75, p[1] * 0.25 + q[1] * 0.75])
      }
      o.push(pts[pts.length - 1])
      pts = o
    }
    return pts
  }

  /** 一个字的骨架笔画（em 坐标 0..1，y 向下），fontFamily / fontWeight 是主题字体；画不出来时 null。 */
  function skeletonPolys(ch, fontFamily, fontWeight) {
    if (typeof document === 'undefined') return null
    if (!skeletonCanvas) {
      skeletonCanvas = document.createElement('canvas')
      skeletonCanvas.width = skeletonCanvas.height = SK
      skeletonCtx = skeletonCanvas.getContext('2d', { willReadFrequently: true })
    }
    if (!skeletonCtx) return null
    skeletonCtx.fillStyle = '#000'
    skeletonCtx.fillRect(0, 0, SK, SK)
    skeletonCtx.fillStyle = '#fff'
    skeletonCtx.textAlign = 'center'
    skeletonCtx.textBaseline = 'alphabetic'
    skeletonCtx.font = fontWeight + ' ' + (SK * 0.78) + 'px ' + fontFamily
    skeletonCtx.fillText(ch, SK / 2, SK * 0.8)
    var data = skeletonCtx.getImageData(0, 0, SK, SK).data
    var img = new Uint8Array(SK * SK)
    for (var i = 0; i < SK * SK; i += 1) img[i] = data[i * 4] > 110 ? 1 : 0
    thin(img)
    var polys = trace(img).map(function (p) {
      return chaikin(rdp(p, 1.2), 2).map(function (pt) { return [pt[0] / SK, pt[1] / SK] })
    })
    // 每条线从更靠左上的一端开始；整体从上到下、从左到右
    polys.forEach(function (p) {
      if (p[0][1] + p[0][0] * 0.6 > p[p.length - 1][1] + p[p.length - 1][0] * 0.6) p.reverse()
    })
    function minOf(p, axis) {
      var m = Infinity
      for (var i = 0; i < p.length; i += 1) m = Math.min(m, p[i][axis])
      return m
    }
    polys.sort(function (a, b) { return (minOf(a, 1) - minOf(b, 1)) * 0.6 + (minOf(a, 0) - minOf(b, 0)) })
    return polys.length ? polys : null
  }

  // ---------- 字形（原版 nebbiaGlyphs.ts） ----------
  // 字形 = 按书写顺序的几笔中线（em 坐标 0..1，y 向下）。来源依次是：lucide 图标（每个 SVG 元素一笔）、
  // AnimCJK 笔顺数据、主题字体的骨架追踪。另有手写变形（warpGlyph）和沿笔画取点（pointAt）。
  // Glyph：{ strokes: [{ pts, cum, len }], total }；取不到时 null。

  /** 量出每一笔的累计弧长；太短的笔画丢掉。 */
  function measureGlyph(polys) {
    var total = 0
    var strokes = polys.filter(function (p) { return p.length > 1 }).map(function (pts) {
      var cum = [0]
      for (var i = 1; i < pts.length; i += 1) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]))
      total += cum[cum.length - 1]
      return { pts: pts, cum: cum, len: cum[cum.length - 1] }
    }).filter(function (s) { return s.len > 0.005 })
    return strokes.length ? { strokes: strokes, total: total } : null
  }

  // Catmull-Rom 细分，稀疏的中线点变成顺滑曲线
  function catmull(pts, n) {
    if (pts.length < 3) return pts
    var out = []
    for (var i = 0; i < pts.length - 1; i += 1) {
      var p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)]
      for (var k = 0; k < n; k += 1) {
        var t = k / n, t2 = t * t, t3 = t2 * t
        var at = function (j) { return 0.5 * (2 * p1[j] + (-p0[j] + p2[j]) * t + (2 * p0[j] - 5 * p1[j] + 4 * p2[j] - p3[j]) * t2 + (-p0[j] + 3 * p1[j] - 3 * p2[j] + p3[j]) * t3) }
        out.push([at(0), at(1)])
      }
    }
    out.push(pts[pts.length - 1])
    return out
  }

  // lucide 图标解析（上游 services/lucideIconResolver.ts 的 resolveLucideIconNode）：插件没有 lucide-react，
  // 宿主可以提供 window.foliaLucideIconNode(name)（返回上游同形的 [[tag, attrs], ...]，未知名字返回 null）；
  // 没有钩子或未知名一律 null：图标字取不到字形，走上游「未知名」的处理路径（不画）。
  function resolveLucideIconNode(name) {
    if (typeof window.foliaLucideIconNode !== 'function') return null
    try { return window.foliaLucideIconNode(name) || null } catch (e) { return null }
  }

  /** lucide 图标能不能用（nebbia-chars.js 判断歌词里的 emoji 要不要换成图标记号）。 */
  function lucideIconAvailable() {
    return typeof window.foliaLucideIconNode === 'function'
  }

  var iconSvg = null
  // lucide 图标：每个 SVG 元素按出现顺序是一笔，用浏览器沿路径取点；路径里的跳笔拆开
  function iconPolys(name) {
    var nodes = resolveLucideIconNode(name)
    if (!nodes || typeof document === 'undefined') return null
    if (!iconSvg) {
      iconSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
      iconSvg.setAttribute('viewBox', '0 0 24 24')
      iconSvg.style.cssText = 'position:absolute;width:24px;height:24px;left:-99px;top:-99px;visibility:hidden;pointer-events:none'
      document.body.appendChild(iconSvg)
    }
    var polys = []
    for (var i = 0; i < nodes.length; i += 1) {
      var tag = nodes[i][0], attrs = nodes[i][1]
      var el = document.createElementNS('http://www.w3.org/2000/svg', tag)
      var keys = Object.keys(attrs)
      for (var k = 0; k < keys.length; k += 1) if (keys[k] !== 'key') el.setAttribute(keys[k], String(attrs[keys[k]]))
      iconSvg.appendChild(el)
      var len = typeof el.getTotalLength === 'function' ? el.getTotalLength() : 0, step = 0.35
      var cur = [], prev = null
      for (var l = 0; len > 0 && l <= len + 1e-6; l += step) {
        var p = el.getPointAtLength(Math.min(l, len)), q = [p.x / 24, p.y / 24]
        if (prev && Math.hypot(q[0] - prev[0], q[1] - prev[1]) > step * 3 / 24) { if (cur.length > 1) polys.push(cur); cur = [] }
        cur.push(q)
        prev = q
      }
      if (cur.length > 1) polys.push(cur)
      el.remove()
    }
    return polys.length ? polys : null
  }

  /**
   * 字形缓存，按字体分开（骨架跟主题字体走）。笔顺数据或图标晚到时调 clear()，下次重新取。
   */
  function NebbiaGlyphCache(fontFamily, fontWeight) {
    this.fontFamily = fontFamily
    this.fontWeight = fontWeight
    this.cache = new Map()
    this.font = fontWeight + ' ' + fontFamily
  }

  /** 换字体时清空缓存；返回字体是否真的变了。 */
  NebbiaGlyphCache.prototype.setFont = function (fontFamily, fontWeight) {
    var font = fontWeight + ' ' + fontFamily
    if (font === this.font) return false
    this.fontFamily = fontFamily
    this.fontWeight = fontWeight
    this.font = font
    this.cache.clear()
    return true
  }

  NebbiaGlyphCache.prototype.clear = function () {
    this.cache.clear()
  }

  /** 主题字体是否已经能用（没在等加载）；没有 FontFaceSet 时当作能用。 */
  NebbiaGlyphCache.prototype.fontReady = function () {
    try {
      return document.fonts && document.fonts.check ? document.fonts.check(this.fontWeight + ' 16px ' + this.fontFamily) : true
    } catch (e) {
      return true
    }
  }

  NebbiaGlyphCache.prototype.get = function (ch) {
    var hit = this.cache.get(ch)
    if (hit !== undefined) return hit
    var polys = null
    var medians = getNebbiaStrokeMedians(ch)
    if (ch.indexOf(ICON_PREFIX) === 0) polys = iconPolys(ch.slice(ICON_PREFIX.length))
    else if (medians) polys = medians.map(function (m) { return catmull(m.map(function (pt) { return [pt[0] / 1024, pt[1] / 1024] }), 6) })
    else if (ch.trim()) polys = skeletonPolys(ch, this.fontFamily, this.fontWeight)
    var glyph = polys ? measureGlyph(polys) : null
    this.cache.set(ch, glyph)
    return glyph
  }

  /**
   * 手写变形：整字有点斜、有点扁或瘦、带一点弯；每一笔各自偏一点、转一点、长短不一，沿笔画还有一点手抖。
   * j 是变形幅度；笔画多的字每笔的偏移收小，部件位置还对。
   */
  function warpGlyph(g, rnd, j) {
    if (j <= 0) return g
    var r = function () { return rnd() * 2 - 1 }
    var shear = r() * 0.16 * j, sx = 1 + r() * 0.1 * j, sy = 1 + r() * 0.1 * j
    var bx = r() * 0.035 * j, by = r() * 0.035 * j, px = rnd() * 6.28, py = rnd() * 6.28
    var whole = function (x, y) {
      var u = (x - 0.5) * sx, v = (y - 0.5) * sy
      u += v * shear
      u += bx * Math.sin(v * Math.PI * 1.6 + px)
      v += by * Math.sin(u * Math.PI * 1.6 + py)
      return [u + 0.5, v + 0.5]
    }
    var sj = clamp(8 / g.strokes.length, 0.35, 1)
    var polys = g.strokes.map(function (st) {
      var pts = st.pts, n = pts.length
      var cx = 0, cy = 0
      for (var i = 0; i < n; i += 1) { cx += pts[i][0]; cy += pts[i][1] }
      cx /= n; cy /= n
      var rot = r() * 0.09 * j * sj, len = 1 + r() * 0.1 * j * sj, ox = r() * 0.022 * j * sj, oy = r() * 0.022 * j * sj
      var cr = Math.cos(rot), sr = Math.sin(rot), x0 = pts[0][0], y0 = pts[0][1]
      var tremor = 0.006 * j, tf = 18 + rnd() * 14, tp = rnd() * 6.28
      return pts.map(function (pt, i) {
        var x = pt[0], y = pt[1]
        // 以起笔点为原点伸缩（写长写短），绕中心转一点，再整体挪一点
        var u = x0 + (x - x0) * len, v = y0 + (y - y0) * len
        var du = u - cx, dv = v - cy
        u = cx + du * cr - dv * sr + ox
        v = cy + du * sr + dv * cr + oy
        // 手抖：垂直于笔画方向的细小起伏
        var a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)]
        var tx = b[0] - a[0], ty = b[1] - a[1], tl = Math.hypot(tx, ty) || 1
        var k = Math.sin(st.cum[i] * tf + tp) * tremor
        return whole(u - ty / tl * k, v + tx / tl * k)
      })
    })
    return measureGlyph(polys) || g
  }

  /** 折线上弧长 s 处的点和法线：[x, y, nx, ny]。 */
  function pointAt(st, s) {
    var pts = st.pts, cum = st.cum
    var i = 1
    while (i < pts.length - 1 && cum[i] < s) i += 1
    var a = pts[i - 1], b = pts[i], L = Math.max(1e-6, cum[i] - cum[i - 1]), k = clamp((s - cum[i - 1]) / L)
    var dx = (b[0] - a[0]) / L, dy = (b[1] - a[1]) / L
    return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, -dy, dx]
  }

  window.FoliaNebbiaGlyphs = {
    // nebbiaStrokes.ts
    STROKES_URL: STROKES_URL,
    loadNebbiaStrokes: loadNebbiaStrokes,
    getNebbiaStrokeMedians: getNebbiaStrokeMedians,
    // nebbiaSkeleton.ts
    skeletonPolys: skeletonPolys,
    // nebbiaGlyphs.ts
    measureGlyph: measureGlyph,
    warpGlyph: warpGlyph,
    pointAt: pointAt,
    NebbiaGlyphCache: NebbiaGlyphCache,
    // 插件适配：lucide 图标可用性（供 nebbia-chars.js 判断 emoji 换不换图标记号）
    lucideIconAvailable: lucideIconAvailable
  }
})()
