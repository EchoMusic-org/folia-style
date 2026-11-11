// 花火（hanabi）线类 MG 装饰件：移植自 folia-major src/components/visualizer/hanabi/mg/ornamentLines.ts
// 线类装饰件：锯齿线（从字组两侧抽出）、正弦波线（横穿）、下划线（被唱到的字下方）、点线（逐点亮起）。
// 锯齿与波线要逐帧变形，各用一个 Graphics 每帧重画（点数有上限）；下划线与点线是 Sprite。
(function () {
  'use strict'

  // ---------- MG 共享纯数学（原版 mg/mgMath.ts，正主实现在 hanabi-ornaments.js 的 FoliaHanabiOrnaments.Math） ----------
  // 本文件加载早于 hanabi-ornaments.js，这里按同一套公式内联本文件用到的几个，保证本文件可独立加载。
  var TAU = Math.PI * 2
  var clamp01 = function (value) { return value <= 0 ? 0 : value >= 1 ? 1 : value }
  var lerp = function (a, b, t) { return a + (b - a) * t }
  var fract = function (value) { return value - Math.floor(value) }
  var easeInCubic = function (t) { return Math.pow(clamp01(t), 3) }
  var easeOutCubic = function (t) { return 1 - Math.pow(1 - clamp01(t), 3) }
  var easeOutExpo = function (t) {
    var x = clamp01(t)
    return x >= 1 ? 1 : 1 - Math.pow(2, -10 * x)
  }
  /** 过冲：冲过 1 再落回。overshoot 越大冲得越远。 */
  var easeOutBack = function (t, overshoot) {
    if (overshoot === undefined) overshoot = 1.70158
    var x = clamp01(t) - 1
    return 1 + x * x * ((overshoot + 1) * x + overshoot)
  }

  var newPos = function () { return { x: 0, y: 0, alpha: 1, size: 0 } }

  /**
   * 一条线的走向：起点、方向、长度；同一个装饰件的几条线共用一个 Graphics。
   * glyph 跟着某个字走（−1 = 静态）。
   */
  // Track = { x, y, dx, dy, length, glyph, start }

  /** 按 placement 给出线的走向：around / behind / glyphs 从字组两侧往外，line-* 从一端往外，corners 从四角斜出，screen 横贯全屏。 */
  var tracksFor = function (kit, reach, across) {
    var pad = kit.size * 0.35
    var cx = kit.cx
    var cy = kit.cy
    var hw = kit.hw
    var hh = kit.hh
    var vertical = kit.vertical
    var start = kit.start
    var along = function (sign) {
      return vertical
        ? { x: cx, y: cy + sign * (hh + pad), dx: 0, dy: sign, length: reach, glyph: -1, start: start }
        : { x: cx + sign * (hw + pad), y: cy, dx: sign, dy: 0, length: reach, glyph: -1, start: start }
    }
    switch (kit.spec.placement) {
      case 'line-start':
        return [along(-1)]
      case 'line-end':
        return [along(1)]
      case 'corners':
        return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(function (corner, k) {
          return {
            x: cx + corner[0] * (hw + pad * 0.5), y: cy + corner[1] * (hh + pad * 0.5),
            dx: corner[0] * Math.SQRT1_2, dy: corner[1] * Math.SQRT1_2, length: reach * 0.6, glyph: -1, start: start + k * 0.06
          }
        })
      case 'screen': {
        var w = kit.ctx.width * 0.55
        var h = kit.ctx.height * 0.55
        return vertical
          ? [{ x: cx - hw - pad * 2, y: -h, dx: 0, dy: 1, length: h * 2, glyph: -1, start: start },
            { x: cx + hw + pad * 2, y: h, dx: 0, dy: -1, length: h * 2, glyph: -1, start: start + 0.1 }]
          : [{ x: -w, y: cy - hh - pad * 2, dx: 1, dy: 0, length: w * 2, glyph: -1, start: start },
            { x: w, y: cy + hh + pad * 2, dx: -1, dy: 0, length: w * 2, glyph: -1, start: start + 0.1 }]
      }
      default:
        if (across) {
          // 横穿：沿字组下缘（竖排时右缘）从一端贯到另一端。
          return vertical
            ? [{ x: cx + hw + pad, y: cy - hh - reach * 0.5, dx: 0, dy: 1, length: hh * 2 + reach, glyph: -1, start: start }]
            : [{ x: cx - hw - reach * 0.5, y: cy + hh + pad, dx: 1, dy: 0, length: hw * 2 + reach, glyph: -1, start: start }]
        }
        return [along(-1), along(1)]
    }
  }

  /** 画出 track 上 [from, to]（0..1）这一段，offset(s) 给出沿法线的偏移。 */
  var strokeTrack = function (g, track, from, to, steps, offset, ox, oy) {
    if (ox === undefined) ox = 0
    if (oy === undefined) oy = 0
    if (to - from <= 1e-4) return false
    var nx = -track.dy
    var ny = track.dx
    for (var i = 0; i <= steps; i += 1) {
      var s = lerp(from, to, i / steps)
      var d = s * track.length
      var o = offset(s)
      var x = track.x + ox + track.dx * d + nx * o
      var y = track.y + oy + track.dy * d + ny * o
      if (i === 0) g.moveTo(x, y)
      else g.lineTo(x, y)
    }
    return true
  }

  // ─── zigzag：锯齿线从字组两侧抽出 ─────────────────────────────────────
  function zigzagOrnament(kit) {
    var reach = kit.size * (2.6 + kit.rng() * 1.4)
    var tracks = tracksFor(kit, reach, false)
    var g = kit.graphics()
    g.tint = kit.color(0)
    var echo = kit.graphics()
    echo.tint = kit.color(1)
    var amp = kit.size * 0.18
    var width = Math.max(1.5, kit.size * 0.06)
    return function (time) {
      g.clear()
      echo.clear()
      var x = kit.exit(time)
      var any = false
      // 锯齿一拍翻一次相位（阶梯），幅度随拍子跳。
      var flip = Math.floor(time * 6) % 2 === 0 ? 0 : 0.5
      var pump = 1 + 0.3 * (Math.floor(time * 3) % 3 === 0 ? 1 : 0)
      for (var t = 0; t < tracks.length; t += 1) {
        var track = tracks[t]
        var local = time - track.start
        if (local < 0 || x >= 1) continue
        var teeth = Math.max(3, Math.round(track.length / (kit.size * 0.34)))
        var to = easeOutCubic(local / 0.5)
        var from = easeInCubic(x)
        var steps = teeth * 2
        // 折线：只在齿尖取点，所以 steps = 齿数 × 2，偏移交替 ±amp。
        var zig = function (s) {
          var k = Math.round((s * teeth + flip) * 2)
          return (k % 2 === 0 ? 1 : -1) * amp * pump * Math.min(1, s * 6)
        }
        any = strokeTrack(g, track, from, to, steps, zig) || any
        strokeTrack(echo, track, from, to * 0.8, steps, function (s) { return zig(s) * 0.6 }, -track.dy * amp * 1.8, track.dx * amp * 1.8)
      }
      if (any) {
        g.stroke({ width: width, color: 0xffffff, join: 'miter', cap: 'square' })
        echo.stroke({ width: width * 0.5, color: 0xffffff, join: 'miter' })
      }
      g.visible = any
      echo.visible = any
      g.alpha = 1 - x
      echo.alpha = 0.6 * (1 - x)
    }
  }

  // ─── wave：正弦波线横穿 ────────────────────────────────────────────────
  function waveOrnament(kit) {
    var reach = kit.size * 4
    var tracks = tracksFor(kit, reach, true)
    var layers = Math.min(3, Math.max(2, kit.count(2.4, 2)))
    var waves = []
    for (var j0 = 0; j0 < layers; j0 += 1) {
      var g = kit.graphics()
      g.tint = kit.color(j0)
      waves.push({ g: g, phase: j0 * 1.9, amp: kit.size * (0.22 - j0 * 0.05), speed: 0.6 + j0 * 0.25, width: Math.max(1.2, kit.size * (0.06 - j0 * 0.015)) })
    }
    var wavelength = kit.size * 1.6
    return function (time) {
      var x = kit.exit(time)
      var bump = 1 + 0.6 * Math.exp(-(time - kit.lastSung(time)) / 0.25)
      waves.forEach(function (w, j) {
        w.g.clear()
        var any = false
        for (var t = 0; t < tracks.length; t += 1) {
          var track = tracks[t]
          var local = time - track.start - j * 0.08
          if (local < 0 || x >= 1) continue
          var to = easeOutCubic(local / 0.7)
          var from = easeInCubic(x)
          var steps = Math.min(140, Math.max(16, Math.round(track.length / (kit.size * 0.12))))
          var cycles = track.length / wavelength
          any = strokeTrack(w.g, track, from, to, steps, function (s) {
            return Math.sin((s * cycles - time * w.speed) * TAU + w.phase) * w.amp * bump * Math.sin(Math.PI * s)
          }) || any
        }
        if (any) w.g.stroke({ width: w.width, color: 0xffffff, cap: 'round', join: 'round' })
        w.g.visible = any
        w.g.alpha = (1 - x) * (j === 0 ? 1 : 0.65)
      })
    }
  }

  // ─── underline：被唱到的字下方的粗下划线，唱完收起 ───────────────────────
  function underlineOrnament(kit) {
    var placement = kit.spec.placement
    var thick = function (size) { return Math.max(2, size * 0.09 * kit.spec.scale) }
    var vertical = kit.vertical
    /** 一根条：left..right 是沿文字方向的两端（0..1 的比例），画在 (x, y) 起、长 length 的线上。 */
    var bar = function (sprite, x, y, length, from, to, height, alpha) {
      var visible = to - from > 0.002 && alpha > 0.01
      sprite.visible = visible
      if (!visible) return
      var mid = (from + to) / 2 * length
      var len = (to - from) * length
      if (vertical) {
        sprite.position.set(x, y + mid)
        sprite.width = height
        sprite.height = len
      } else {
        sprite.position.set(x + mid, y)
        sprite.width = len
        sprite.height = height
      }
      sprite.alpha = alpha
    }

    if (placement === 'glyphs' || placement === 'corners' || kit.glyphs.length === 0) {
      var items = kit.glyphs.map(function (glyph, i) {
        var main = kit.sprite('square')
        var echo = kit.sprite('square')
        main.tint = kit.color(i)
        echo.tint = kit.color(i + 1)
        return { glyph: glyph, main: main, echo: echo }
      })
      return function (time) {
        var anchors = kit.anchors(time)
        var x = kit.exit(time)
        for (var i = 0; i < items.length; i += 1) {
          var it = items[i]
          var anchor = anchors[it.glyph.index]
          var size = anchor ? anchor.size : it.glyph.size
          var gx = anchor ? anchor.x : it.glyph.x
          var gy = anchor ? anchor.y : it.glyph.y
          var alpha = (anchor ? anchor.alpha : 1) * (1 - x)
          var local = time - it.glyph.sungAt
          // 唱到时从头拉出，唱完 0.1 秒后从头收起。
          var retract = easeInCubic((time - it.glyph.sungEnd - 0.1) / 0.25)
          var grow = easeOutExpo(local / 0.18)
          var length = size * 1.04
          var ox = vertical ? gx + size * 0.6 : gx - length / 2
          var oy = vertical ? gy - length / 2 : gy + size * 0.6
          bar(it.main, ox, oy, length, retract, local < 0 ? 0 : grow, thick(size), alpha)
          var growEcho = easeOutExpo((local - 0.06) / 0.2)
          var retractEcho = easeInCubic((time - it.glyph.sungEnd - 0.16) / 0.25)
          bar(it.echo, ox + (vertical ? thick(size) * 1.6 : 0), oy + (vertical ? 0 : thick(size) * 1.6), length,
            retractEcho, local < 0.06 ? 0 : growEcho, thick(size) * 0.35, alpha * 0.9)
        }
      }
    }

    // 整行一根：长度跟着「唱到第几个字」走，最后一个字唱完后收起。
    var order = kit.glyphs.slice().sort(function (a, b) { return a.sungAt - b.sungAt })
    var first = order[0]
    var last = order[order.length - 1]
    var pad = kit.size * 0.3
    var lineStart = placement === 'line-start'
    var lineEnd = placement === 'line-end'
    var main = kit.sprite('square')
    var echo = kit.sprite('square')
    main.tint = kit.color(0)
    echo.tint = kit.color(1)
    var length = vertical ? kit.hh * 2 : kit.hw * 2
    var short = kit.size * 1.2
    return function (time) {
      var x = kit.exit(time)
      var progress = 0
      for (var i = 0; i < order.length; i += 1) {
        var glyph = order[i]
        if (time >= glyph.sungAt) progress += clamp01((time - glyph.sungAt) / Math.max(0.08, glyph.sungEnd - glyph.sungAt))
      }
      var k = easeOutCubic(progress / order.length)
      var retract = easeInCubic((time - last.sungEnd - 0.15) / 0.35)
      var pulse = 1 + 0.5 * Math.exp(-(time - kit.lastSung(time)) / 0.15)
      var height = thick(kit.size / kit.spec.scale) * (lineStart || lineEnd ? pulse : 1.2)
      var alpha = (1 - x) * (time >= first.sungAt ? 1 : 0)
      if (lineStart || lineEnd) {
        // 行首 / 行尾的短横：唱到时一下下地「跳」。
        var bx = vertical ? kit.cx - short / 2 : lineStart ? kit.cx - kit.hw - pad - short : kit.cx + kit.hw + pad
        var by = vertical ? (lineStart ? kit.cy - kit.hh - pad - short : kit.cy + kit.hh + pad) : kit.cy - short / 2
        var grow = easeOutBack((time - first.sungAt) / 0.3, 2)
        bar(main, vertical ? kit.cx : bx, vertical ? by : kit.cy, short, retract, grow, height, alpha)
        echo.visible = false
        return
      }
      var bx2 = vertical ? kit.cx + kit.hw + pad : kit.cx - kit.hw
      var by2 = vertical ? kit.cy - kit.hh : kit.cy + kit.hh + pad
      bar(main, bx2, by2, length, retract, k, height, alpha)
      bar(echo, bx2 + (vertical ? height * 1.6 : 0), by2 + (vertical ? 0 : height * 1.6), length, retract, Math.max(0, k - 0.04), height * 0.35, alpha * 0.9)
    }
  }

  // ─── dots-line：沿文字方向的点线，逐点亮起 ───────────────────────────────
  function dotsLineOrnament(kit) {
    var placement = kit.spec.placement
    var vertical = kit.vertical
    var spacing = kit.size * 0.3
    // LineDot = { sprite, x, y, glyph, order, litAt, size }
    var dots = []
    var litOf = function (along) {
      // 字的位置投到这条线上：最近的那个字被唱到时，这颗点跟着亮。
      var best = Infinity
      var at = kit.start + 0.6
      for (var i = 0; i < kit.glyphs.length; i += 1) {
        var glyph = kit.glyphs[i]
        var d = Math.abs((vertical ? glyph.y : glyph.x) - along)
        if (d < best) {
          best = d
          at = glyph.sungAt
        }
      }
      return at
    }
    var push = function (x, y, order, litAt, size, glyph) {
      if (glyph === undefined) glyph = null
      var sprite = kit.sprite('dot')
      sprite.tint = kit.color(dots.length)
      dots.push({ sprite: sprite, x: x, y: y, glyph: glyph, order: order, litAt: litAt, size: size })
    }
    var pad = kit.size * 0.45
    var lineAlong = function (fromX, fromY, dx, dy, length, fade) {
      var n = Math.max(3, Math.min(kit.count(48, 8), Math.round(length / spacing)))
      for (var i = 0; i < n; i += 1) {
        var s = n === 1 ? 0 : i / (n - 1)
        var x = fromX + dx * s * length
        var y = fromY + dy * s * length
        push(x, y, s, litOf(vertical ? y : x), kit.size * (fade ? 0.14 * (1 - s * 0.7) : 0.12))
      }
    }
    if (placement === 'glyphs') {
      kit.glyphs.forEach(function (glyph, i) {
        push(
          vertical ? glyph.size * 0.62 : 0, vertical ? 0 : glyph.size * 0.62,
          i / Math.max(1, kit.glyphs.length - 1), glyph.sungAt, kit.size * 0.16, glyph
        )
      })
    } else if (placement === 'line-start' || placement === 'line-end') {
      var sign = placement === 'line-start' ? -1 : 1
      var length = kit.size * 3
      if (vertical) lineAlong(kit.cx, kit.cy + sign * (kit.hh + pad), 0, sign, length, true)
      else lineAlong(kit.cx + sign * (kit.hw + pad), kit.cy, sign, 0, length, true)
    } else if (placement === 'screen') {
      var w = kit.ctx.width * 0.5
      if (vertical) lineAlong(kit.cx + kit.hw + pad * 2, -kit.ctx.height * 0.5, 0, 1, kit.ctx.height, false)
      else lineAlong(-w, kit.cy + kit.hh + pad * 1.8, 1, 0, w * 2, false)
    } else if (placement === 'corners') {
      var arm = kit.size * 1.5
      var corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]]
      for (var c = 0; c < corners.length; c += 1) {
        var x0 = kit.cx + corners[c][0] * (kit.hw + pad)
        var y0 = kit.cy + corners[c][1] * (kit.hh + pad)
        lineAlong(x0, y0, -corners[c][0], 0, arm, true)
        lineAlong(x0, y0, 0, -corners[c][1], arm * 0.7, true)
      }
    } else {
      // around / behind：字组下方一条（竖排在右侧），around 再在上方反向一条。
      if (vertical) lineAlong(kit.cx + kit.hw + pad, kit.cy - kit.hh, 0, 1, kit.hh * 2, false)
      else lineAlong(kit.cx - kit.hw, kit.cy + kit.hh + pad, 1, 0, kit.hw * 2, false)
      if (placement === 'around') {
        if (vertical) lineAlong(kit.cx - kit.hw - pad, kit.cy + kit.hh, 0, -1, kit.hh * 2, false)
        else lineAlong(kit.cx + kit.hw, kit.cy - kit.hh - pad, -1, 0, kit.hw * 2, false)
      }
    }
    var p = newPos()
    return function (time) {
      var anchors = kit.anchors(time)
      var x = kit.exit(time)
      var runner = fract((time - kit.start) / 2.4)
      for (var i = 0; i < dots.length; i += 1) {
        var d = dots[i]
        // 入场逐点出现（暗），被唱到时亮起并弹一下；退场从头逐点熄灭（阶梯）。
        var appear = time - kit.start - d.order * 0.5
        var off = x * 1.4 - d.order * 0.4 >= 0.5
        if (appear < 0 || off) {
          d.sprite.visible = false
          continue
        }
        var px = d.x
        var py = d.y
        var alpha = 1
        if (d.glyph) {
          var anchor = anchors[d.glyph.index]
          px += anchor ? anchor.x : d.glyph.x
          py += anchor ? anchor.y : d.glyph.y
          alpha = anchor ? anchor.alpha : 1
        }
        var lit = time >= d.litAt
        var pop = lit ? 1 + 0.8 * Math.exp(-(time - d.litAt) / 0.12) : 1
        var run = Math.max(0, 1 - Math.abs(runner - d.order) * 12)
        var size = d.size * (lit ? 1 : 0.6) * pop * easeOutBack(appear / 0.2, 2.5) * (1 + run * 0.6)
        d.sprite.visible = size > 0.3
        d.sprite.position.set(px, py)
        d.sprite.width = size
        d.sprite.height = size
        d.sprite.alpha = alpha * (lit ? 1 : 0.35 + run * 0.5) * p.alpha
      }
    }
  }

  window.FoliaHanabiOrnamentsLines = {
    zigzagOrnament: zigzagOrnament,
    waveOrnament: waveOrnament,
    underlineOrnament: underlineOrnament,
    dotsLineOrnament: dotsLineOrnament
  }
})()
