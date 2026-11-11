// 花火（hanabi）MG 装饰件公共底座：移植自 folia-major src/components/visualizer/hanabi/mg/ornamentKit.ts
// 装饰件的公共底座：按 placement 算出「落点」（静态点或跟着某个字走）、取色、数量、入场 / 退场进度、精灵与图形的创建与回收。
// 每种装饰件只写自己的形状与动态（ornamentShapes / ornamentParticles / ornamentLines）。
//
// Site（装饰件的一个落点：中心、半宽半高、朝外的方向；glyph ≥ 0 时每帧跟着那个字走）：
//   { x, y, w, h, angle, glyph, start 这个落点的入场时刻（跟字的落点 = 字被唱到）, hollow（around：散布时避开字组本身） }。
// GlyphInfo（静止排好时的一个非空白字）：{ index, char, x, y, size, sungAt, sungEnd, landedAt }。
// SitePos：{ x, y, alpha（跟着的字的可见度，静态点为 1）, size }。
(function () {
  'use strict'

  var Core = window.FoliaHanabiCore

  // ---------- MG 共享纯数学（原版 mg/mgMath.ts，正主实现在 hanabi-ornaments.js 的 FoliaHanabiOrnaments.Math） ----------
  // 本文件加载早于 hanabi-ornaments.js，这里按同一套公式内联本文件用到的几个，保证本文件可独立加载。
  var clamp01 = function (value) { return value <= 0 ? 0 : value >= 1 ? 1 : value }

  /** 建一个装饰件的公共底座。spec：OrnamentSpec；ctx：OrnamentContext（pixi/textures/bounds/anchorsAt/palette/seed…）。 */
  function createKit(spec, ctx) {
    var pixi = ctx.pixi
    // 一个装饰件一个渲染组：波浪线、锯齿线每帧 clear 再重画，粒子类的逐个显隐，Pixi 都会把所在渲染组的绘制指令
    // 整组重排；单独成组后只重排这一件。
    var view = new pixi.Container({ isRenderGroup: true })
    var rng = Core.createRng(ctx.seed + ':ornament:' + spec.kind + ':' + spec.placement)
    var start = ctx.enterAt + spec.delay
    var end = ctx.exitAt + Math.max(0, ctx.exitDuration)
    var b = ctx.bounds
    var cx = b.x + b.width / 2
    var cy = b.y + b.height / 2
    var hw = Math.max(1, b.width / 2)
    var hh = Math.max(1, b.height / 2)

    // 静止排好的字：先取入场时的 landedAt，再在全部落定之后（退场之前）取一次位置。
    var initial = ctx.anchorsAt(ctx.enterAt)
    var landed = initial.reduce(function (max, anchor) { return Math.max(max, anchor.landedAt) }, ctx.enterAt)
    var settle = Math.min(ctx.exitAt - 1e-3, landed + 0.05)
    var settled = settle > ctx.enterAt ? ctx.anchorsAt(settle) : initial
    var glyphs = []
    settled.forEach(function (anchor, index) {
      if (anchor.blank) return
      glyphs.push({
        index: index,
        char: anchor.char,
        x: anchor.x,
        y: anchor.y,
        size: anchor.size,
        sungAt: anchor.sungAt,
        sungEnd: anchor.sungEnd,
        landedAt: anchor.landedAt
      })
    })
    var sizes = glyphs.map(function (g) { return g.size }).sort(function (p, q) { return p - q })
    var base = sizes.length > 0
      ? sizes[Math.floor(sizes.length / 2)]
      : Math.max(12, Math.min(hw, hh) * 0.8, Math.min(ctx.width, ctx.height) * 0.06)
    var size = base * Math.max(0.1, spec.scale)
    var vertical = false
    if (glyphs.length > 1) {
      var xs = glyphs.map(function (g) { return g.x })
      var ys = glyphs.map(function (g) { return g.y })
      vertical = Math.max.apply(null, ys) - Math.min.apply(null, ys) > (Math.max.apply(null, xs) - Math.min.apply(null, xs)) * 1.3
    }
    var sung = glyphs.map(function (g) { return g.sungAt }).sort(function (p, q) { return p - q })

    var factor = Math.max(0, ctx.amount) * (0.35 + 0.9 * clamp01(spec.density))
    var count = function (baseCount, min) {
      if (min === undefined) min = 1
      return factor <= 0 ? 0 : Math.max(min, Math.round(baseCount * factor))
    }

    var pick = function (list, i, fallback) {
      return list.length > 0 ? list[((i % list.length) + list.length) % list.length] : fallback
    }
    var color = function (i) {
      var p = ctx.palette
      switch (spec.color) {
        case 'spark': return pick(p.sparks, i, p.accent)
        case 'block': return pick(p.blocks, i, p.accent)
        case 'paper': return p.paper
        case 'glow': return p.glow
        default: return p.accent
      }
    }

    var pad = base * 0.35
    var sites = function (mode, maxGlyphSites) {
      var make = function (x, y, w, h, angle, extra) {
        return Object.assign({ x: x, y: y, w: w, h: h, angle: angle, glyph: -1, start: start, hollow: false }, extra)
      }
      switch (spec.placement) {
        case 'behind':
          return [make(cx, cy, hw, hh, -Math.PI / 2)]
        case 'around':
          return [make(cx, cy, hw + pad, hh + pad, -Math.PI / 2, { hollow: mode === 'scatter' })]
        case 'corners':
          return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(function (corner, k) {
            return make(
              cx + corner[0] * (hw + pad * 0.6), cy + corner[1] * (hh + pad * 0.6), base * 0.6, base * 0.6, Math.atan2(corner[1], corner[0]),
              { start: start + k * 0.07 }
            )
          })
        case 'line-start':
          return [vertical
            ? make(cx, cy - hh - pad, base * 0.7, base * 0.7, -Math.PI / 2)
            : make(cx - hw - pad, cy, base * 0.7, base * 0.7, Math.PI)]
        case 'line-end':
          return [vertical
            ? make(cx, cy + hh + pad, base * 0.7, base * 0.7, Math.PI / 2)
            : make(cx + hw + pad, cy, base * 0.7, base * 0.7, 0)]
        case 'screen':
          return [make(0, 0, ctx.width * 0.55, ctx.height * 0.55, -Math.PI / 2)]
        case 'glyphs':
        default: {
          if (glyphs.length === 0) return [make(cx, cy, hw, hh, -Math.PI / 2)]
          var limit = Math.max(1, Math.min(glyphs.length, maxGlyphSites))
          var chosen = []
          for (var i = 0; i < limit; i += 1) chosen.push(glyphs[Math.floor(((i + 0.5) * glyphs.length) / limit)])
          return chosen.map(function (g) {
            return make(g.x, g.y, g.size * 0.55, g.size * 0.55, -Math.PI / 2, {
              glyph: g.index,
              start: Math.max(start, g.sungAt)
            })
          })
        }
      }
    }

    var cachedTime = NaN
    var cached = settled
    var anchors = function (time) {
      if (time !== cachedTime) {
        cachedTime = time
        cached = ctx.anchorsAt(time)
      }
      return cached
    }

    var pos = function (site, list, out) {
      var anchor = site.glyph >= 0 ? list[site.glyph] : undefined
      if (anchor) {
        out.x = anchor.x
        out.y = anchor.y
        out.alpha = anchor.alpha
        out.size = anchor.size
      } else {
        out.x = site.x
        out.y = site.y
        out.alpha = 1
        out.size = Math.max(site.w, site.h)
      }
      return out
    }

    var exitSpan = Math.max(0.05, ctx.exitDuration)
    var exit = function (time, stagger) {
      if (stagger === undefined) stagger = 0
      return clamp01((time - ctx.exitAt - stagger) / Math.max(0.05, exitSpan - stagger))
    }

    var scatter = function (site) {
      if (!site.hollow) return [(rng() * 2 - 1) * site.w, (rng() * 2 - 1) * site.h]
      // 围绕：落在包围盒外的一圈里。
      var ow = site.w + base * 1.3
      var oh = site.h + base * 1.0
      for (var tries = 0; tries < 12; tries += 1) {
        var x = (rng() * 2 - 1) * ow
        var y = (rng() * 2 - 1) * oh
        if (Math.abs(x) > site.w || Math.abs(y) > site.h) return [x, y]
      }
      var a = rng() * Math.PI * 2
      return [Math.cos(a) * ow, Math.sin(a) * oh]
    }

    var lastSung = function (time) {
      var result = -Infinity
      for (var i = 0; i < sung.length; i += 1) {
        var at = sung[i]
        if (at > time) break
        result = at
      }
      return result
    }

    var sprite = function (texture, parent) {
      if (parent === undefined) parent = view
      var s = new pixi.Sprite(ctx.textures[texture])
      s.anchor.set(0.5)
      parent.addChild(s)
      return s
    }
    var graphics = function (parent, context) {
      if (parent === undefined) parent = view
      var g = context ? new pixi.Graphics(context) : new pixi.Graphics()
      parent.addChild(g)
      return g
    }
    var contexts = []
    var context = function () {
      var c = new pixi.GraphicsContext()
      contexts.push(c)
      return c
    }
    view.on('destroyed', function () { contexts.forEach(function (c) { c.destroy() }) })

    return {
      spec: spec, ctx: ctx, pixi: pixi, view: view, rng: rng, start: start, end: end, size: size, glyphs: glyphs, vertical: vertical, cx: cx, cy: cy, hw: hw, hh: hh,
      count: count, color: color, sites: sites, anchors: anchors, pos: pos, exit: exit, scatter: scatter, lastSung: lastSung, sprite: sprite, graphics: graphics, context: context
    }
  }

  window.FoliaHanabiOrnamentsKit = {
    createKit: createKit
  }
})()
