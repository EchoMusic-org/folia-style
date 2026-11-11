// 花火（hanabi）几何类 MG 装饰件：移植自 folia-major src/components/visualizer/hanabi/mg/ornamentShapes.ts
// 几何类装饰件：扩散圆环、集中线、环绕点阵、角括号、虚线圆、同心方框、旭日放射、印章、网点。
// 形状在构建时画好（Graphics / 共享纹理的 Sprite），逐帧只改 transform 与 alpha。
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
  /** 反向蓄力：先往回退一点再冲出去。 */
  var easeInBack = function (t, overshoot) {
    if (overshoot === undefined) overshoot = 1.70158
    var x = clamp01(t)
    return x * x * ((overshoot + 1) * x - overshoot)
  }
  /** 欠阻尼弹簧：从 0 弹到 1。seconds 为经过的秒数，freq 为振荡频率（Hz），decay 为衰减（1/s）。 */
  var spring = function (seconds, freq, decay) {
    if (freq === undefined) freq = 2.6
    if (decay === undefined) decay = 7
    return seconds <= 0 ? 0 : 1 - Math.exp(-decay * seconds) * Math.cos(TAU * freq * seconds)
  }
  /** 一拍一格地走：每个节拍用 easeOutBack 跳到下一格。 */
  var beatSteps = function (beats, snap) {
    if (snap === undefined) snap = 0.35
    var whole = Math.floor(beats)
    return whole + easeOutBack(fract(beats) / snap, 2.2)
  }
  /** 确定性噪声：同一 (n, salt) 永远同一个 [0, 1) 值。 */
  var hash01 = function (n, salt) {
    if (salt === undefined) salt = 0
    return fract(Math.sin(n * 127.1 + salt * 311.7) * 43758.5453123)
  }

  var newPos = function () { return { x: 0, y: 0, alpha: 1, size: 0 } }

  /** 落点的「大件」半径：behind / around 围住字组，其余是小件。 */
  var siteRadius = function (placement, site, fallback) {
    if (placement === 'behind') return Math.hypot(site.w, site.h) * 0.8
    if (placement === 'around') return Math.hypot(site.w, site.h) * 0.95
    if (placement === 'screen') return Math.min(site.w, site.h) * 0.75
    return Math.max(site.w, fallback) * 1.3
  }

  // ─── ring：扩散的描边圆环 ──────────────────────────────────────────────
  function ringOrnament(kit) {
    var oneShot = kit.spec.placement === 'glyphs'
    var layers = oneShot ? 1 : Math.min(3, kit.count(2.4, 1))
    var line = Math.max(1.5, kit.size * 0.055)
    var units = kit.sites('single', 8).map(function (site, si) {
      var radius = siteRadius(kit.spec.placement, site, kit.size * 0.5) * (oneShot ? 1.3 : 1)
      var rings = []
      for (var j = 0; j < layers; j += 1) {
        var g = kit.graphics()
        g.circle(0, 0, radius * (1 + 0.14 * j)).stroke({ width: line * (j === 0 ? 1.6 : 0.8), color: 0xffffff })
        g.tint = kit.color(si + j)
        rings.push(g)
      }
      var pulse = null
      if (!oneShot) {
        pulse = kit.graphics()
        pulse.circle(0, 0, radius).stroke({ width: line * 0.6, color: 0xffffff })
        pulse.tint = kit.color(si + 1)
      }
      return { site: site, rings: rings, pulse: pulse }
    })
    var p = newPos()
    return function (time) {
      var anchors = kit.anchors(time)
      for (var u = 0; u < units.length; u += 1) {
        var unit = units[u]
        kit.pos(unit.site, anchors, p)
        var e = time - unit.site.start
        unit.rings.forEach(function (g, j) {
          var local = e - j * 0.09
          var x = kit.exit(time, j * 0.05)
          if (local < 0 || x >= 1) {
            g.visible = false
            return
          }
          var scale
          var alpha
          if (oneShot) {
            var k = clamp01(local / 0.8)
            scale = 0.3 + 1.1 * easeOutExpo(k)
            alpha = Math.pow(1 - k, 1.5)
          } else {
            scale = lerp(0.2, 1, easeOutBack(local / 0.55, 2.4)) * (1 + 0.025 * Math.sin(TAU * (time * 0.5 + j / 3)))
            alpha = clamp01(local / 0.08)
            scale *= 1 - easeInBack(x, 2)
            alpha *= 1 - x
          }
          g.visible = alpha > 0.005 && scale > 0.001
          g.position.set(p.x, p.y)
          g.scale.set(Math.max(0.001, scale))
          g.alpha = alpha * p.alpha
        })
        if (unit.pulse) {
          var q = fract((e - 0.6) / 1.8)
          var xP = kit.exit(time)
          unit.pulse.visible = e > 0.6 && xP < 1
          unit.pulse.position.set(p.x, p.y)
          unit.pulse.scale.set(1 + 0.55 * easeOutCubic(q))
          unit.pulse.alpha = 0.55 * Math.pow(1 - q, 2) * (1 - xP) * p.alpha
        }
      }
    }
  }

  // ─── spokes：集中线 ────────────────────────────────────────────────────
  function spokesOrnament(kit) {
    var oneShot = kit.spec.placement === 'glyphs'
    var big = kit.spec.placement === 'behind' || kit.spec.placement === 'around' || kit.spec.placement === 'screen'
    var pad = kit.size * 0.45
    var units = kit.sites('single', 6).map(function (site, si) {
      var n = oneShot ? 8 : kit.count(big ? 28 : 10, 6)
      var spokes = []
      for (var i = 0; i < n; i += 1) {
        var angle = (TAU * i) / n + (kit.rng() - 0.5) * (TAU / n) * 0.7
        var cos = Math.cos(angle)
        var sin = Math.sin(angle)
        // 大件：内缘贴着字组的椭圆包络，线从字组外面向外放射。
        var inner = big
          ? 1 / Math.sqrt(Math.pow(cos / (site.w + pad), 2) + Math.pow(sin / (site.h + pad), 2))
          : site.w * 1.1
        var sprite = kit.sprite('streak')
        sprite.rotation = angle + Math.PI / 2
        sprite.tint = kit.color(si + i)
        spokes.push({
          sprite: sprite, cos: cos, sin: sin, inner: inner,
          length: kit.size * (oneShot ? 0.5 + kit.rng() * 0.5 : 0.7 + kit.rng() * 1.7),
          thick: Math.max(1.2, kit.size * (0.035 + kit.rng() * 0.05)),
          delay: (i % 6) * 0.015,
          salt: si * 97 + i
        })
      }
      return { site: site, spokes: spokes }
    })
    var p = newPos()
    return function (time) {
      var anchors = kit.anchors(time)
      var beat = Math.floor(time * 12)
      var x = kit.exit(time)
      for (var u = 0; u < units.length; u += 1) {
        var unit = units[u]
        kit.pos(unit.site, anchors, p)
        var e = time - unit.site.start
        for (var i = 0; i < unit.spokes.length; i += 1) {
          var s = unit.spokes[i]
          var local = e - s.delay
          if (local < 0 || x >= 1) {
            s.sprite.visible = false
            continue
          }
          var grow = easeOutExpo(local / 0.25)
          // 一拍一格的抖动：漫画集中线的「颤」。
          var jitter = 0.72 + 0.45 * hash01(beat, s.salt)
          var length = s.length * grow * jitter * (1 - x)
          var push = kit.size * 2.5 * easeInCubic(x)
          var alpha = (0.55 + 0.45 * hash01(beat + 7, s.salt)) * p.alpha
          if (oneShot) {
            var k = clamp01((local - 0.3) / 0.35)
            push += kit.size * 0.8 * easeOutCubic(k)
            length *= 1 - k
            alpha *= 1 - k
          }
          var r = s.inner + push + length / 2
          s.sprite.visible = length > 0.5 && alpha > 0.01
          s.sprite.position.set(p.x + s.cos * r, p.y + s.sin * r)
          s.sprite.width = s.thick * (1 - x * 0.5)
          s.sprite.height = length
          s.sprite.alpha = alpha
        }
      }
    }
  }

  // ─── orbit：绕字组旋转的点阵（带一点纵深） ─────────────────────────────
  function orbitOrnament(kit) {
    var big = kit.spec.placement === 'behind' || kit.spec.placement === 'around' || kit.spec.placement === 'screen'
    var tilt = -0.18
    var units = kit.sites('single', 4).map(function (site, si) {
      var rx = big ? site.w + kit.size * 0.5 : site.w * 1.5
      var ry = big ? site.h + kit.size * 0.6 : site.h * 0.8
      // 每圈几列「车厢」：一颗领头的四角星 + 后面渐小的一串点，两圈反向转。
      var trains = big ? Math.max(2, Math.min(6, kit.count(4, 2))) : 2
      var cars = big ? 5 : 3
      var rings = [
        { omega: 0.55, reach: 1, trains: trains },
        { omega: -0.85, reach: 1.2, trains: Math.max(1, trains - 1) }
      ]
      var paths = rings.map(function (ring, r) {
        var g = kit.graphics()
        g.ellipse(0, 0, rx * ring.reach, ry * ring.reach).stroke({ width: Math.max(1, kit.size * 0.02), color: 0xffffff })
        g.rotation = tilt
        g.tint = kit.color(si + r)
        return { g: g, delay: r * 0.12 }
      })
      var dots = []
      rings.forEach(function (ring, r) {
        for (var index = 0; index < ring.trains * cars; index += 1) {
          var train = Math.floor(index / cars)
          var car = index % cars
          var leader = car === 0
          var sprite = kit.sprite(leader ? 'star4' : 'dot')
          sprite.tint = kit.color(si + r + train)
          dots.push({
            sprite: sprite,
            theta: (TAU * train) / ring.trains + r * 0.5 - Math.sign(ring.omega) * car * 0.11,
            omega: ring.omega,
            rx: rx * ring.reach,
            ry: ry * ring.reach,
            size: kit.size * (leader ? 0.34 : 0.14 * (1 - car / (cars + 1))),
            delay: train * 0.06 + car * 0.03 + r * 0.12
          })
        }
      })
      return { site: site, dots: dots, paths: paths }
    })
    var p = newPos()
    var cosT = Math.cos(tilt)
    var sinT = Math.sin(tilt)
    return function (time) {
      var anchors = kit.anchors(time)
      for (var u = 0; u < units.length; u += 1) {
        var unit = units[u]
        kit.pos(unit.site, anchors, p)
        var e = time - unit.site.start
        for (var pi = 0; pi < unit.paths.length; pi += 1) {
          var path = unit.paths[pi]
          var localP = e - path.delay
          var xP = kit.exit(time)
          path.g.visible = localP >= 0 && xP < 1
          if (!path.g.visible) continue
          path.g.position.set(p.x, p.y)
          path.g.scale.set(Math.max(0.001, easeOutBack(localP / 0.5, 1.8) * (1 + 1.2 * easeInCubic(xP))))
          path.g.alpha = 0.3 * clamp01(localP / 0.1) * (1 - xP) * p.alpha
        }
        unit.dots.forEach(function (d, i) {
          var local = e - d.delay
          var x = kit.exit(time, (i % 8) * 0.02)
          if (local < 0 || x >= 1) {
            d.sprite.visible = false
            return
          }
          var reach = spring(local, 1.6, 5.5) * (1 + 1.2 * easeInCubic(x))
          var theta = d.theta + d.omega * time - Math.sign(d.omega) * 2.2 * (1 - easeOutCubic(local / 0.9))
          var ox = Math.cos(theta) * d.rx * reach
          var oy = Math.sin(theta) * d.ry * reach
          // 椭圆下半圈在前、上半圈在后：后面的小一点、暗一点。
          var near = 0.5 + 0.5 * Math.sin(theta)
          d.sprite.visible = true
          d.sprite.position.set(p.x + ox * cosT - oy * sinT, p.y + ox * sinT + oy * cosT)
          var s = d.size * (0.65 + 0.35 * near)
          d.sprite.width = s
          d.sprite.height = s
          d.sprite.rotation = theta
          d.sprite.alpha = clamp01(local / 0.05) * (0.45 + 0.55 * near) * (1 - x) * p.alpha
        })
      }
    }
  }

  // ─── brackets：「」角括号 / 四角取景框 / 跟着唱到的字跳的准星 ─────────────
  function bracketsOrnament(kit) {
    var placement = kit.spec.placement
    var thick = Math.max(2, kit.size * 0.08)
    var pad = kit.size * 0.4
    var make = function (a, b, rotation, color) {
      var g = kit.graphics()
      g.moveTo(a, 0).lineTo(0, 0).lineTo(0, b).stroke({ width: thick, color: 0xffffff, cap: 'square', join: 'miter' })
      g.rotation = rotation
      g.tint = color
      return g
    }
    // 四个角的旋转：TL 0、TR π/2、BR π、BL 3π/2。
    var CORNERS = [[-1, -1, 0], [1, -1, Math.PI / 2], [1, 1, Math.PI], [-1, 1, Math.PI * 1.5]]

    if (placement === 'glyphs' && kit.glyphs.length > 0) {
      var arm = kit.size * 0.28
      var corners = CORNERS.map(function (corner, k) {
        return { g: make(arm, arm, corner[2], kit.color(k)), sx: corner[0], sy: corner[1] }
      })
      var order = kit.glyphs.slice().sort(function (a, b) { return a.sungAt - b.sungAt })
      return function (time) {
        var x = kit.exit(time)
        var current = -1
        for (var i = 0; i < order.length; i += 1) if (order[i].sungAt <= time) current = i
        var visible = current >= 0 && time >= kit.start && x < 1
        for (var c = 0; c < corners.length; c += 1) corners[c].g.visible = visible
        if (!visible) return
        var anchors = kit.anchors(time)
        var cur = order[current]
        var prev = order[Math.max(0, current - 1)]
        var a = anchors[cur.index]
        var b = anchors[prev.index]
        var k = current === 0 ? 1 : easeOutBack((time - cur.sungAt) / 0.2, 1.8)
        var px = lerp(b ? b.x : prev.x, a ? a.x : cur.x, k)
        var py = lerp(b ? b.y : prev.y, a ? a.y : cur.y, k)
        var half = lerp(b ? b.size : prev.size, a ? a.size : cur.size, k) * 0.62
        var snap = 1 + 0.35 * Math.exp(-(time - cur.sungAt) / 0.08)
        for (var d = 0; d < corners.length; d += 1) {
          corners[d].g.position.set(px + corners[d].sx * half * snap * (1 + x), py + corners[d].sy * half * snap * (1 + x))
          corners[d].g.alpha = (1 - x) * (a ? a.alpha : 1)
        }
      }
    }

    var rw = kit.hw + pad
    var rh = kit.hh + pad * 0.7
    var cx = kit.cx
    var cy = kit.cy
    if (placement === 'screen') {
      rw = kit.ctx.width * 0.42
      rh = kit.ctx.height * 0.38
      cx = 0
      cy = 0
    }
    var chosen = CORNERS
    var armA = Math.min(rw * 0.35, kit.size * 0.9)
    var armB = armA
    if (placement === 'behind' || placement === 'around' || placement === 'line-start' || placement === 'line-end') {
      // 「」：横臂短、竖臂长（竖排时反过来）。
      chosen = placement === 'line-start' ? [CORNERS[0]] : placement === 'line-end' ? [CORNERS[2]] : [CORNERS[0], CORNERS[2]]
      armA = kit.vertical ? rw * 1.2 : kit.size * 0.55
      armB = kit.vertical ? kit.size * 0.55 : rh * 1.2
    }
    var pieces = chosen.map(function (corner, k) {
      // 旋转过的角：臂长按旋转后的方向交换。
      var swap = k % 2 === 1 && chosen.length === 4
      return { g: make(swap ? armB : armA, swap ? armA : armB, corner[2], kit.color(k)), sx: corner[0], sy: corner[1], delay: k * 0.06 }
    })
    return function (time) {
      var beat = Math.exp(-(time - kit.lastSung(time)) / 0.12)
      pieces.forEach(function (piece, k) {
        var local = time - kit.start - piece.delay
        var x = kit.exit(time, k * 0.04)
        if (local < 0 || x >= 1) {
          piece.g.visible = false
          return
        }
        var off = (1 - easeOutBack(local / 0.45, 2.6)) * kit.size * 1.4
        off += kit.size * 0.06 * Math.sin(TAU * time * 0.7) - kit.size * 0.15 * beat
        off += easeInCubic(x) * kit.size * 2
        // 入场前 0.12 秒像信号不稳一样闪两下。
        var flick = local < 0.12 ? (Math.floor(local * 40) % 2 === 0 ? 1 : 0.25) : 1
        piece.g.visible = true
        piece.g.position.set(cx + piece.sx * (rw + off), cy + piece.sy * (rh + off))
        piece.g.alpha = flick * (1 - x)
      })
    }
  }

  // ─── dash-circle：虚线圆 + 点线内圈，反向旋转 ───────────────────────────
  function dashCircleOrnament(kit) {
    var oneShot = kit.spec.placement === 'glyphs'
    var line = Math.max(1.5, kit.size * 0.05)
    var units = kit.sites('single', 6).map(function (site, si) {
      var r1 = oneShot ? site.w * 1.35 : siteRadius(kit.spec.placement, site, kit.size * 0.6) * 1.05
      var r2 = r1 * 0.84
      var outer = kit.graphics()
      var dashes = r1 > kit.size * 2 ? 36 : 18
      for (var k = 0; k < dashes; k += 1) {
        var a0 = (k * TAU) / dashes
        var a1 = a0 + (TAU / dashes) * 0.55
        outer.moveTo(Math.cos(a0) * r1, Math.sin(a0) * r1).arc(0, 0, r1, a0, a1)
      }
      outer.stroke({ width: line, color: 0xffffff, cap: 'round' })
      outer.tint = kit.color(si)
      var inner = kit.graphics()
      var dotsCount = dashes * 2
      for (var d = 0; d < dotsCount; d += 1) {
        var a = (d * TAU) / dotsCount
        inner.circle(Math.cos(a) * r2, Math.sin(a) * r2, line * 0.7)
      }
      inner.fill({ color: 0xffffff })
      inner.tint = kit.color(si + 1)
      return { site: site, outer: outer, inner: inner }
    })
    var p = newPos()
    return function (time) {
      var anchors = kit.anchors(time)
      var x = kit.exit(time)
      for (var u = 0; u < units.length; u += 1) {
        var unit = units[u]
        kit.pos(unit.site, anchors, p)
        var local = time - unit.site.start
        // 贴字时只陪着这个字转一会儿（1.4 秒后淡出），不在整行上堆满圆。
        var fadeOut = oneShot ? clamp01((local - 1) / 0.4) : 0
        var visible = local >= 0 && x < 1 && fadeOut < 1
        unit.outer.visible = visible
        unit.inner.visible = visible
        if (!visible) continue
        var scale = lerp(0.55, 1, easeOutBack(local / 0.5, 2)) * (1 + 0.3 * easeInCubic(x))
        var spinIn = (1 - easeOutCubic(local / 0.9)) * Math.PI * 1.2
        var alpha = clamp01(local / 0.1) * (1 - x) * (1 - fadeOut) * p.alpha
        unit.outer.position.set(p.x, p.y)
        unit.outer.scale.set(scale)
        unit.outer.rotation = 0.35 * time + spinIn + x * x * 3
        unit.outer.alpha = alpha
        unit.inner.position.set(p.x, p.y)
        unit.inner.scale.set(scale)
        // 内圈一拍一格地转。
        unit.inner.rotation = -beatSteps((time - unit.site.start) / 0.5) * (Math.PI / 18) - spinIn
        unit.inner.alpha = alpha * 0.85
      }
    }
  }

  // ─── squares：同心方框，交错旋转 ───────────────────────────────────────
  function squaresOrnament(kit) {
    var big = kit.spec.placement === 'behind' || kit.spec.placement === 'around' || kit.spec.placement === 'screen'
    var oneShot = kit.spec.placement === 'glyphs'
    var layers = Math.min(4, Math.max(2, kit.count(3.2, 2)))
    var line = Math.max(1.5, kit.size * 0.05)
    var pad = kit.size * 0.35
    var units = kit.sites('single', 5).map(function (site, si) {
      var squares = []
      for (var j = 0; j < layers; j += 1) {
        var g = kit.graphics()
        // 大件跟着字组的长宽比，只小角度来回摆；小件是正方形，一拍转 45°。
        var w = big ? site.w + pad * (j + 1) : site.w * (1.1 + 0.3 * j)
        var h = big ? site.h + pad * (j + 1) : w
        g.rect(-w, -h, w * 2, h * 2).stroke({ width: line * (j === 0 ? 1.5 : 1), color: 0xffffff, join: 'miter' })
        g.tint = kit.color(si + j)
        squares.push({ g: g, dir: j % 2 === 0 ? 1 : -1, delay: j * 0.07, offset: j * 0.25 })
      }
      return { site: site, squares: squares }
    })
    var p = newPos()
    return function (time) {
      var anchors = kit.anchors(time)
      for (var u = 0; u < units.length; u += 1) {
        var unit = units[u]
        kit.pos(unit.site, anchors, p)
        unit.squares.forEach(function (s, j) {
          var local = time - unit.site.start - s.delay
          // 贴字时唱完就转着收掉（一拍半），退场时整组收掉。
          var x = Math.max(kit.exit(time, (layers - 1 - j) * 0.05), oneShot ? clamp01((local - 1.1) / 0.4) : 0)
          if (local < 0 || x >= 1) {
            s.g.visible = false
            return
          }
          var beats = local / 1.0 + s.offset
          var rotation
          if (big) {
            var phase = Math.floor(beats) % 2 === 0 ? 1 : -1
            rotation = s.dir * 0.09 * lerp(-phase, phase, easeOutBack(fract(beats) / 0.35, 2))
          } else {
            rotation = s.dir * beatSteps(beats) * (Math.PI / 4)
          }
          var scale = easeOutBack(local / 0.4, 2.2) * (1 - easeInBack(x, 2))
          s.g.visible = Math.abs(scale) > 0.001
          s.g.position.set(p.x, p.y)
          s.g.rotation = rotation
          s.g.scale.set(Math.max(0.001, scale))
          s.g.alpha = clamp01(local / 0.06) * (1 - x) * p.alpha
        })
      }
    }
  }

  // ─── rays：字组背后的放射扇形（旭日） ───────────────────────────────────
  function raysOrnament(kit) {
    var oneShot = kit.spec.placement === 'glyphs'
    var faint = kit.spec.placement === 'behind' || kit.spec.placement === 'screen'
    var units = kit.sites('single', 3).map(function (site, si) {
      var radius = kit.spec.placement === 'screen'
        ? Math.hypot(kit.ctx.width, kit.ctx.height) * 0.6
        : kit.spec.placement === 'behind' || kit.spec.placement === 'around'
          ? Math.hypot(site.w, site.h) * 1.7
          : site.w * 2.4
      var wedges = oneShot ? 8 : Math.max(6, kit.count(12, 6))
      var g = kit.graphics()
      for (var k = 0; k < wedges; k += 1) {
        var a0 = (k * TAU) / wedges
        var a1 = a0 + (TAU / wedges) * 0.5
        g.moveTo(0, 0).lineTo(Math.cos(a0) * radius, Math.sin(a0) * radius).lineTo(Math.cos(a1) * radius, Math.sin(a1) * radius).closePath()
      }
      g.fill({ color: 0xffffff })
      g.tint = kit.color(si)
      return { site: site, g: g, dir: si % 2 === 0 ? 1 : -1 }
    })
    var p = newPos()
    var baseAlpha = faint ? 0.26 : 0.45
    return function (time) {
      var anchors = kit.anchors(time)
      var x = kit.exit(time)
      var tick = Math.exp(-(time - kit.lastSung(time)) / 0.15)
      for (var u = 0; u < units.length; u += 1) {
        var unit = units[u]
        kit.pos(unit.site, anchors, p)
        var local = time - unit.site.start
        if (local < 0 || x >= 1 || (oneShot && local > 1.2)) {
          unit.g.visible = false
          continue
        }
        var scale = easeOutBack(local / 0.6, 1.6) * (1 + 0.03 * Math.sin(TAU * time * 0.8) + 0.04 * tick) * (1 + 0.25 * x)
        var alpha = baseAlpha * clamp01(local / 0.1) * (1 - x)
        if (oneShot) {
          var k = clamp01((local - 0.5) / 0.7)
          alpha *= 1 - k
          scale *= 1 + 0.3 * k
        }
        unit.g.visible = true
        unit.g.position.set(p.x, p.y)
        unit.g.scale.set(Math.max(0.001, scale))
        unit.g.rotation = unit.dir * (time * 0.12 - 0.8 * (1 - easeOutCubic(local / 0.8)) + x * x * 1.5)
        unit.g.alpha = alpha * p.alpha
      }
    }
  }

  // ─── stamp：圆框印章里一个字，盖下去时回弹 ───────────────────────────────
  var STAMP_CHARS = ['花', '火', '夏', '夜', '空', '光']
  var STAMP_FONT = '"Hiragino Mincho ProN", "Yu Mincho", "Noto Serif JP", "Noto Serif SC", "Songti SC", serif'

  function stampOrnament(kit) {
    var placement = kit.spec.placement
    var pad = kit.size * 0.6
    var radius = kit.size * 0.72
    var x0
    var y0
    var faint = false
    var corner = Math.floor(kit.rng() * 4)
    var sx = corner === 0 || corner === 3 ? -1 : 1
    var sy = corner < 2 ? -1 : 1
    switch (placement) {
      case 'behind':
        radius = Math.min(kit.hw, kit.hh) * 1.1 + kit.size * 0.3
        x0 = kit.cx
        y0 = kit.cy
        faint = true
        break
      case 'screen':
        x0 = sx * kit.ctx.width * 0.36
        y0 = sy * kit.ctx.height * 0.32
        radius = Math.min(kit.ctx.width, kit.ctx.height) * 0.08 * kit.spec.scale
        break
      case 'line-start':
        x0 = kit.vertical ? kit.cx : kit.cx - kit.hw - pad - radius
        y0 = kit.vertical ? kit.cy - kit.hh - pad - radius : kit.cy
        break
      case 'line-end':
      case 'glyphs':
        x0 = kit.vertical ? kit.cx : kit.cx + kit.hw + pad * 0.6 + radius
        y0 = kit.vertical ? kit.cy + kit.hh + pad * 0.6 + radius : kit.cy + kit.hh * 0.4
        break
      default:
        x0 = kit.cx + sx * (kit.hw + radius * 0.6)
        y0 = kit.cy + sy * (kit.hh + radius * 0.5)
    }
    var holder = new kit.pixi.Container()
    kit.view.addChild(holder)
    holder.position.set(x0, y0)
    var frame = kit.graphics(holder)
    frame.circle(0, 0, radius).stroke({ width: radius * 0.1, color: 0xffffff })
    frame.circle(0, 0, radius * 0.8).stroke({ width: radius * 0.035, color: 0xffffff })
    var char = STAMP_CHARS[Math.floor(kit.rng() * STAMP_CHARS.length) % STAMP_CHARS.length]
    var text = new kit.pixi.Text({
      text: char,
      style: { fontFamily: STAMP_FONT, fontSize: Math.max(8, radius * 1.02), fontWeight: '900', fill: 0xffffff, align: 'center' }
    })
    text.anchor.set(0.5, 0.54)
    holder.addChild(text)
    holder.tint = kit.color(0)
    var shock = kit.sprite('ring')
    shock.tint = kit.color(1)
    var tilt = (kit.rng() - 0.5) * 0.3
    var slam = 0.18
    return function (time) {
      var local = time - kit.start
      var x = kit.exit(time)
      if (local < 0 || x >= 1) {
        holder.visible = false
        shock.visible = false
        return
      }
      holder.visible = true
      var scale
      var rotation
      if (local < slam) {
        // 从 2.4 倍加速砸下。
        var k = easeInCubic(local / slam)
        scale = lerp(2.4, 1, k)
        rotation = lerp(-0.5, tilt, k)
      } else {
        var after = local - slam
        scale = 1 + 0.14 * Math.exp(-after * 9) * Math.cos(after * 38)
        rotation = tilt + 0.02 * Math.sin(time * 0.6)
      }
      scale *= 1 - easeInBack(x, 2.4)
      holder.scale.set(Math.max(0.001, scale))
      holder.rotation = rotation
      holder.alpha = clamp01(local / 0.06) * (faint ? 0.3 : 1) * (x > 0.6 ? (Math.floor(x * 20) % 2 === 0 ? 1 : 0.3) : 1)
      var impact = local - slam
      var kI = clamp01(impact / 0.45)
      shock.visible = impact >= 0 && kI < 1
      if (shock.visible) {
        var size = radius * 2 * (1 + 0.9 * easeOutCubic(kI))
        shock.position.set(x0, y0)
        shock.width = size
        shock.height = size
        shock.alpha = Math.pow(1 - kI, 2) * (faint ? 0.3 : 0.8)
      }
    }
  }

  // ─── halftone：网点渐变块（在色块后） ─────────────────────────────────
  function halftoneOrnament(kit) {
    var placement = kit.spec.placement
    var perSite = placement === 'glyphs' ? 25 : placement === 'corners' ? 36 : kit.count(170, 40)
    var units = kit.sites('single', 6).map(function (site, si) {
      var w = site.w
      var h = site.h
      if (placement === 'around') {
        w = w * 1.2 + kit.size * 0.4
        h = h * 1.35 + kit.size * 0.6
      } else if (placement === 'behind') {
        // 网点块比字组宽一圈、上下更高，斜着露出来。
        w = w * 1.15 + kit.size * 0.3
        h = h * 1.6 + kit.size * 0.4
      } else if (placement === 'glyphs') {
        w *= 1.4
        h *= 1.4
      }
      var spacing = Math.max(kit.size * 0.18, Math.sqrt((4 * w * h) / Math.min(260, perSite)))
      var cols = Math.max(2, Math.round((2 * w) / spacing))
      var rows = Math.max(2, Math.round((2 * h) / spacing))
      // 渐变方向：沿对角线，按种子选四个方向之一。
      var dirA = (Math.floor(kit.rng() * 4) * Math.PI) / 2 + Math.PI / 4
      var dx = Math.cos(dirA)
      var dy = Math.sin(dirA)
      var dots = []
      for (var r = 0; r < rows; r += 1) {
        for (var c = 0; c < cols; c += 1) {
          var ox = (c - (cols - 1) / 2) * spacing + (r % 2 === 0 ? 0 : spacing * 0.5)
          var oy = (r - (rows - 1) / 2) * spacing
          var proj = clamp01(0.5 + (ox * dx + oy * dy) / (2 * Math.hypot(w, h)) * 1.4)
          var sprite = kit.sprite('dot')
          sprite.tint = kit.color(si)
          dots.push({ sprite: sprite, ox: ox, oy: oy, proj: proj })
        }
      }
      return { site: site, dots: dots, spacing: spacing }
    })
    var p = newPos()
    return function (time) {
      var anchors = kit.anchors(time)
      var x = kit.exit(time)
      for (var u = 0; u < units.length; u += 1) {
        var unit = units[u]
        kit.pos(unit.site, anchors, p)
        var local = time - unit.site.start
        for (var d = 0; d < unit.dots.length; d += 1) {
          var dot = unit.dots[d]
          // 入场沿渐变方向扫进来，退场反向扫掉。
          var reveal = local - dot.proj * 0.55
          var leave = x * 1.6 - (1 - dot.proj) * 0.6
          var pop = easeOutBack(reveal / 0.22, 2.5) * (1 - clamp01(leave / 0.4))
          var wave = 0.22 * Math.sin(TAU * (dot.proj * 1.5 - time * 0.4))
          var value = clamp01(1 - dot.proj * 0.9 + wave)
          var size = unit.spacing * 0.92 * value * pop
          dot.sprite.visible = size > 0.4 && reveal > 0
          if (!dot.sprite.visible) continue
          dot.sprite.position.set(p.x + dot.ox, p.y + dot.oy)
          dot.sprite.width = size
          dot.sprite.height = size
          dot.sprite.alpha = 0.75 * p.alpha
        }
      }
    }
  }

  window.FoliaHanabiOrnamentsShapes = {
    ringOrnament: ringOrnament,
    spokesOrnament: spokesOrnament,
    orbitOrnament: orbitOrnament,
    bracketsOrnament: bracketsOrnament,
    dashCircleOrnament: dashCircleOrnament,
    squaresOrnament: squaresOrnament,
    raysOrnament: raysOrnament,
    stampOrnament: stampOrnament,
    halftoneOrnament: halftoneOrnament
  }
})()
