// 花火（hanabi）粒子类 MG 装饰件：移植自 folia-major src/components/visualizer/hanabi/mg/ornamentParticles.ts
// 粒子类装饰件：四角星闪、＋号、彩纸、三角碎片、樱花瓣、速度线、>>> 箭头、字边光点。
// 全部是共享纹理的 Sprite（箭头、＋号用共享的 GraphicsContext），位置由 (种子, t) 的闭式式子给出。
(function () {
  'use strict'

  // ---------- MG 共享纯数学（原版 mg/mgMath.ts，正主实现在 hanabi-ornaments.js 的 FoliaHanabiOrnaments.Math） ----------
  // 本文件加载早于 hanabi-ornaments.js，这里按同一套公式内联本文件用到的几个，保证本文件可独立加载。
  var TAU = Math.PI * 2
  var clamp01 = function (value) { return value <= 0 ? 0 : value >= 1 ? 1 : value }
  var lerp = function (a, b, t) { return a + (b - a) * t }
  var fract = function (value) { return value - Math.floor(value) }
  /** 落在 [0, span) 里的取模（负数也对）。 */
  var wrap = function (value, span) { return value - span * Math.floor(value / span) }
  var easeInCubic = function (t) { return Math.pow(clamp01(t), 3) }
  var easeOutCubic = function (t) { return 1 - Math.pow(1 - clamp01(t), 3) }
  /** 过冲：冲过 1 再落回。overshoot 越大冲得越远。 */
  var easeOutBack = function (t, overshoot) {
    if (overshoot === undefined) overshoot = 1.70158
    var x = clamp01(t) - 1
    return 1 + x * x * ((overshoot + 1) * x + overshoot)
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

  /** 字被唱到的触发时刻列表；没有字（间奏）时按入场到退场均匀排。 */
  var triggers = function (kit, count) {
    var list = []
    if (kit.glyphs.length > 0) {
      var limit = Math.max(1, Math.min(kit.glyphs.length, count))
      for (var i = 0; i < limit; i += 1) {
        var g = kit.glyphs[Math.floor(((i + 0.5) * kit.glyphs.length) / limit)]
        list.push({ at: Math.max(kit.start, g.sungAt), glyph: g })
      }
      return list
    }
    var span = Math.max(0.5, kit.ctx.exitAt - kit.start)
    for (var j = 0; j < count; j += 1) list.push({ at: kit.start + (span * j) / count, glyph: null })
    return list
  }

  // ─── sparkle：四角星，贴着被唱到的字闪 ─────────────────────────────────
  function sparkleOrnament(kit) {
    var onGlyph = kit.spec.placement === 'glyphs'
    var sites = kit.sites('scatter', 1)
    var items = triggers(kit, kit.count(14, 3)).map(function (trigger, i) {
      var main = kit.sprite('star4')
      var satA = kit.sprite('star4')
      var satB = kit.sprite('dot')
      var sprites = [main, satA, satB]
      for (var k = 0; k < sprites.length; k += 1) { sprites[k].tint = kit.color(i + k) }
      var side = kit.rng() < 0.5 ? -1 : 1
      var site = sites[i % sites.length]
      var offset = kit.scatter(site)
      return {
        main: main, satA: satA, satB: satB, trigger: trigger, site: site, side: side,
        ox: onGlyph ? side * 0.48 : offset[0],
        oy: onGlyph ? -0.45 - kit.rng() * 0.1 : offset[1],
        size: kit.size * (0.55 + kit.rng() * 0.35),
        spin: (kit.rng() - 0.5) * 1.2
      }
    })
    var p = newPos()
    return function (time) {
      var anchors = kit.anchors(time)
      items.forEach(function (it, i) {
        var local = time - it.trigger.at
        var x = kit.exit(time, (i % 6) * 0.03)
        if (local < 0 || x >= 1) {
          it.main.visible = false
          it.satA.visible = false
          it.satB.visible = false
          return
        }
        var cx
        var cy
        var alpha = 1
        if (onGlyph && it.trigger.glyph) {
          var anchor = anchors[it.trigger.glyph.index]
          var size = anchor ? anchor.size : it.trigger.glyph.size
          cx = (anchor ? anchor.x : it.trigger.glyph.x) + it.ox * size
          cy = (anchor ? anchor.y : it.trigger.glyph.y) + it.oy * size
          alpha = anchor ? anchor.alpha : 1
        } else {
          kit.pos(it.site, anchors, p)
          cx = p.x + it.ox
          cy = p.y + it.oy
        }
        // 弹出 → 0.7 秒后缩成一颗小星，余下时间慢慢闪。
        var pop = spring(local, 3.2, 8)
        var settle = clamp01((local - 0.45) / 0.35)
        var idle = 0.32 + 0.1 * Math.sin(time * 5 + i * 1.7)
        var scale = lerp(1.25 * pop, idle, easeOutCubic(settle)) * (1 - easeInCubic(x))
        var s = it.size * Math.max(0, scale)
        it.main.visible = s > 0.5
        it.main.position.set(cx, cy)
        it.main.width = s
        it.main.height = s
        it.main.rotation = -Math.PI / 4 * (1 - easeOutCubic(local / 0.3)) + it.spin * local + x * 3
        it.main.alpha = alpha * (1 - x)
        var sat = function (sprite, delay, dx, dy, sizeK) {
          var l = local - delay
          var k = clamp01(l / 0.5)
          sprite.visible = l >= 0 && k < 1
          if (!sprite.visible) return
          var ss = it.size * sizeK * Math.sin(Math.PI * k)
          sprite.position.set(cx + dx * it.size, cy + dy * it.size)
          sprite.width = ss
          sprite.height = ss
          sprite.alpha = alpha
        }
        sat(it.satA, 0.08, it.side * 0.55, 0.35, 0.45)
        sat(it.satB, 0.15, -it.side * 0.4, -0.5, 0.16)
      })
    }
  }

  // ─── cross：＋号散布，一拍转 90° ────────────────────────────────────────
  function crossOrnament(kit) {
    var shape = kit.context()
    shape.rect(-5, -1.4, 10, 2.8).rect(-1.4, -5, 2.8, 10).fill({ color: 0xffffff })
    var oneShot = kit.spec.placement === 'glyphs'
    var sites = kit.sites('scatter', 8)
    var n = oneShot ? sites.length * 2 : kit.count(12, 4)
    var items = []
    for (var i0 = 0; i0 < n; i0 += 1) {
      var site = sites[i0 % sites.length]
      var offset = oneShot
        ? [(kit.rng() - 0.5) * site.w * 3, -site.h * (0.9 + kit.rng() * 0.6)]
        : kit.scatter(site)
      var g = kit.graphics(kit.view, shape)
      g.tint = kit.color(i0)
      items.push({
        g: g, site: site, ox: offset[0], oy: offset[1],
        size: kit.size * (0.18 + kit.rng() * 0.22) / 10,
        delay: oneShot ? (i0 >= sites.length ? 0.08 : 0) : i0 * 0.06,
        offset: kit.rng(),
        rise: kit.size * (0.1 + kit.rng() * 0.2)
      })
    }
    var p = newPos()
    return function (time) {
      var anchors = kit.anchors(time)
      items.forEach(function (it, i) {
        var local = time - it.site.start - it.delay
        var x = kit.exit(time, (i % 8) * 0.03)
        if (local < 0 || x >= 1 || (oneShot && local > 1.4)) {
          it.g.visible = false
          return
        }
        kit.pos(it.site, anchors, p)
        var scale = easeOutBack(local / 0.3, 3) * (1 - easeInCubic(x))
        var alpha = p.alpha * (1 - x)
        if (oneShot) {
          var k = clamp01((local - 0.6) / 0.8)
          scale *= 1 - k
          alpha *= 1 - k
        }
        it.g.visible = scale > 0.01
        it.g.position.set(p.x + it.ox, p.y + it.oy - it.rise * Math.sin(time * 0.8 + it.offset * TAU))
        it.g.scale.set(Math.max(0.001, it.size * scale))
        it.g.rotation = beatSteps(local / 1.2 + it.offset) * (Math.PI / 2) + x * 4
        it.g.alpha = alpha
      })
    }
  }

  /**
   * 彩纸 / 花瓣共用的循环下落：piece 在落点区域的上缘出现、下缘消失，横向摇摆、3D 翻转。
   * Faller = { sprite, site, x0, period, offset, sway, swayFreq, flip, spin, size, aspect, delay,
   *            vx/vy 入场时从中心炸开的初速度（px/s） }
   */
  var fallerLayout = function (kit, site) {
    var top = -site.h - kit.size * 2
    var bottom = site.h + kit.size * 1.5
    return { top: top, bottom: bottom }
  }

  // ─── confetti：彩纸片炸开后翻飞下落，之后循环飘落 ───────────────────────
  function confettiOrnament(kit) {
    var sites = kit.sites('scatter', 6)
    var n = kit.count(26, 8)
    var pieces = []
    for (var i0 = 0; i0 < n; i0 += 1) {
      var site = sites[i0 % sites.length]
      var sprite = kit.sprite(i0 % 3 === 2 ? 'triangle' : 'square')
      sprite.tint = kit.color(i0)
      var angle = -Math.PI / 2 + (kit.rng() - 0.5) * 2.4
      var speed = kit.size * (3 + kit.rng() * 4)
      pieces.push({
        sprite: sprite, site: site,
        x0: (kit.rng() * 2 - 1) * (site.w + kit.size),
        period: 3 + kit.rng() * 2.5,
        offset: kit.rng(),
        sway: kit.size * (0.2 + kit.rng() * 0.35),
        swayFreq: 0.4 + kit.rng() * 0.5,
        flip: 3 + kit.rng() * 6,
        spin: (kit.rng() - 0.5) * 6,
        size: kit.size * (0.2 + kit.rng() * 0.14),
        aspect: i0 % 3 === 2 ? 1 : 0.5 + kit.rng() * 0.3,
        delay: (i0 % 5) * 0.02,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed
      })
    }
    var p = newPos()
    var burstLife = 2.2
    return function (time) {
      var anchors = kit.anchors(time)
      var x = kit.exit(time)
      for (var i = 0; i < pieces.length; i += 1) {
        var it = pieces[i]
        var local = time - it.site.start - it.delay
        if (local < 0 || x >= 1) {
          it.sprite.visible = false
          continue
        }
        kit.pos(it.site, anchors, p)
        var layout = fallerLayout(kit, it.site)
        var ox
        var oy
        var alpha = 1
        if (local < burstLife) {
          // 第一程：从落点中心炸开，阻尼 + 重力的闭式解，渐隐交给循环。
          var drag = 2.6
          var fall = kit.size * 1.6
          var e = Math.exp(-drag * local)
          var f = (1 - e) / drag
          ox = it.vx * f + Math.sin(local * it.swayFreq * TAU) * it.sway * (1 - e)
          oy = it.vy * f + fall * (local - f)
          alpha = 1 - clamp01((local - burstLife + 0.4) / 0.4)
        } else {
          var cycle = fract((local - burstLife) / it.period + it.offset)
          ox = it.x0 + Math.sin(local * it.swayFreq * TAU) * it.sway
          oy = lerp(layout.top, layout.bottom, cycle)
          alpha = clamp01(cycle / 0.1) * clamp01((1 - cycle) / 0.15)
        }
        oy += kit.size * 3 * x * x
        var flip = Math.cos(local * it.flip)
        it.sprite.visible = alpha > 0.01
        it.sprite.position.set(p.x + ox, p.y + oy)
        it.sprite.width = it.size * Math.max(0.08, Math.abs(flip))
        it.sprite.height = it.size * it.aspect
        it.sprite.rotation = local * it.spin
        it.sprite.alpha = alpha * (1 - x) * p.alpha * (0.75 + 0.25 * Math.abs(flip))
      }
    }
  }

  // ─── petals：樱花瓣斜着飘 ──────────────────────────────────────────────
  function petalsOrnament(kit) {
    var sites = kit.sites('scatter', 4)
    var n = kit.count(16, 5)
    var petals = []
    for (var i0 = 0; i0 < n; i0 += 1) {
      var site = sites[i0 % sites.length]
      var sprite = kit.sprite('petal')
      sprite.tint = kit.color(i0)
      petals.push({
        sprite: sprite, site: site,
        x0: (kit.rng() * 2 - 1) * (site.w + kit.size * 1.5),
        period: 4.5 + kit.rng() * 3,
        offset: kit.rng(),
        sway: kit.size * (0.3 + kit.rng() * 0.4),
        swayFreq: 0.25 + kit.rng() * 0.3,
        flip: 1.5 + kit.rng() * 2.5,
        spin: (kit.rng() - 0.5) * 2,
        size: kit.size * (0.22 + kit.rng() * 0.16),
        aspect: 1.35,
        delay: i0 * 0.05,
        vx: 0,
        vy: 0
      })
    }
    var p = newPos()
    return function (time) {
      var anchors = kit.anchors(time)
      var x = kit.exit(time)
      for (var i = 0; i < petals.length; i += 1) {
        var it = petals[i]
        var local = time - it.site.start - it.delay
        if (local < 0 || x >= 1) {
          it.sprite.visible = false
          continue
        }
        kit.pos(it.site, anchors, p)
        var layout = fallerLayout(kit, it.site)
        var cycle = fract(local / it.period + it.offset)
        var span = it.site.w + kit.size * 2
        // 风从左往右：横向随下落漂移，在落点宽度里循环；退场时被一阵风吹走。
        var drift = wrap(it.x0 + span + cycle * kit.size * 2.5 + span, span * 2) - span
        var ox = drift + Math.sin(local * it.swayFreq * TAU) * it.sway + kit.size * 6 * x * x
        var oy = lerp(layout.top, layout.bottom, cycle)
        var flip = Math.cos(local * it.flip)
        var alpha = clamp01(cycle / 0.1) * clamp01((1 - cycle) / 0.15) * clamp01(local / 0.3)
        var pop = easeOutBack(local / 0.35, 2)
        it.sprite.visible = alpha > 0.01
        it.sprite.position.set(p.x + ox, p.y + oy)
        it.sprite.width = it.size * Math.max(0.1, Math.abs(flip)) * pop
        it.sprite.height = it.size * it.aspect * pop
        it.sprite.rotation = 0.6 + Math.sin(local * 0.9 + it.offset * TAU) * 0.7 + local * it.spin * 0.2
        it.sprite.alpha = alpha * (1 - x) * p.alpha * 0.9
      }
    }
  }

  // ─── shards：三角碎片从字组边缘向外飞，悬停漂移 ──────────────────────────
  function shardsOrnament(kit) {
    var oneShot = kit.spec.placement === 'glyphs'
    var big = kit.spec.placement === 'behind' || kit.spec.placement === 'around' || kit.spec.placement === 'screen'
    var sites = kit.sites('single', 8)
    var per = oneShot ? 4 : Math.max(3, Math.round(kit.count(18, 5) / sites.length))
    var shards = []
    sites.forEach(function (site, si) {
      for (var i = 0; i < per; i += 1) {
        var angle = (TAU * (i + kit.rng() * 0.8)) / per + si
        var cos = Math.cos(angle)
        var sin = Math.sin(angle)
        var edge = big
          ? 1 / Math.sqrt(Math.pow(cos / (site.w + kit.size * 0.2), 2) + Math.pow(sin / (site.h + kit.size * 0.2), 2))
          : site.w * 0.8
        var sprite = kit.sprite('triangle')
        sprite.tint = kit.color(si + i)
        shards.push({
          sprite: sprite, site: site, cos: cos, sin: sin, edge: edge,
          reach: kit.size * (oneShot ? 0.6 + kit.rng() * 0.6 : 0.8 + kit.rng() * 1.6),
          size: kit.size * (oneShot ? 0.14 + kit.rng() * 0.1 : 0.18 + kit.rng() * 0.22),
          rot: kit.rng() * TAU,
          spin: (kit.rng() - 0.5) * 10,
          stretch: 1.3 + kit.rng() * 0.8
        })
      }
    })
    var p = newPos()
    return function (time) {
      var anchors = kit.anchors(time)
      var x = kit.exit(time)
      for (var i = 0; i < shards.length; i += 1) {
        var s = shards[i]
        var local = time - s.site.start
        if (local < 0 || x >= 1 || (oneShot && local > 1.1)) {
          s.sprite.visible = false
          continue
        }
        kit.pos(s.site, anchors, p)
        // 迅速冲出去（阻尼），之后以很小的速度继续向外漂。
        var out = s.reach * (1 - Math.exp(-5 * local)) + kit.size * 0.08 * local + kit.size * 4 * easeInCubic(x)
        var r = s.edge + out
        var scale = easeOutBack(local / 0.2, 2) * lerp(1, 0.7, clamp01(local / 3)) * (1 - x)
        var alpha = p.alpha * (1 - x)
        if (oneShot) {
          var k = clamp01((local - 0.4) / 0.7)
          scale *= 1 - k
          alpha *= 1 - k
        }
        s.sprite.visible = scale > 0.01
        s.sprite.position.set(p.x + s.cos * r, p.y + s.sin * r)
        s.sprite.width = s.size * scale
        s.sprite.height = s.size * scale * s.stretch
        s.sprite.rotation = s.rot + s.spin * (1 - Math.exp(-2 * local)) + 0.2 * local
        s.sprite.alpha = alpha
      }
    }
  }

  // ─── streaks：纵向速度线（强调上升） ───────────────────────────────────
  function streaksOrnament(kit) {
    var sites = kit.sites('scatter', 6)
    var n = kit.count(kit.spec.placement === 'screen' ? 30 : 20, 6)
    var lines = []
    for (var i0 = 0; i0 < n; i0 += 1) {
      var site = sites[i0 % sites.length]
      var ox = kit.scatter(site)[0]
      var sprite = kit.sprite('streak')
      // 纹理上亮下暗；线往下掠过（世界在上升），亮头朝下。
      sprite.rotation = Math.PI
      sprite.tint = kit.color(i0)
      lines.push({
        sprite: sprite, site: site, ox: ox,
        y0: kit.rng(),
        length: kit.size * (1.4 + kit.rng() * 2.6),
        thick: Math.max(1, kit.size * (0.025 + kit.rng() * 0.05)),
        speed: kit.size * (5 + kit.rng() * 7),
        delay: kit.rng() * 0.3,
        salt: i0 * 13 + 1
      })
    }
    var p = newPos()
    return function (time) {
      var anchors = kit.anchors(time)
      var x = kit.exit(time)
      for (var i = 0; i < lines.length; i += 1) {
        var l = lines[i]
        var local = time - l.site.start - l.delay
        if (local < 0 || x >= 1) {
          l.sprite.visible = false
          continue
        }
        kit.pos(l.site, anchors, p)
        var top = -l.site.h - kit.size * 2 - l.length
        var span = l.site.h * 2 + kit.size * 4 + l.length * 2
        // 入场时加速，退场时再猛冲一下。
        var travel = l.speed * (local + 2 * x * x)
        var y = top + wrap(l.y0 * span + travel, span)
        var cycle = (y - top) / span
        var win = clamp01(cycle / 0.15) * clamp01((1 - cycle) / 0.15)
        var flicker = hash01(Math.floor(time * 15), l.salt) < 0.2 ? 0.3 : 1
        l.sprite.visible = win > 0.01
        l.sprite.position.set(p.x + l.ox, p.y + y)
        l.sprite.width = l.thick
        l.sprite.height = l.length * (1 + x)
        l.sprite.alpha = win * flicker * clamp01(local / 0.25) * (1 - x) * p.alpha * 0.85
      }
    }
  }

  // ─── chevrons：^^^ 箭头沿上升方向一拍一格地流动 ───────────────────────────
  function chevronsOrnament(kit) {
    var shape = kit.context()
    shape.moveTo(-5, 3).lineTo(0, -2).lineTo(5, 3).stroke({ width: 2.4, color: 0xffffff, cap: 'square', join: 'miter' })
    var placement = kit.spec.placement
    var columns
    var sites = kit.sites('single', 6)
    if (placement === 'around') {
      var siteA = sites[0]
      columns = [-1, 1].map(function (side) { return { site: siteA, dx: side * (siteA.w + kit.size * 0.8), scale: 1, alpha: 1 } })
    } else if (placement === 'screen') {
      var siteS = sites[0]
      columns = [-0.4, -0.2, 0.2, 0.4].map(function (k) { return { site: siteS, dx: k * kit.ctx.width, scale: 1.2, alpha: 0.7 } })
    } else if (placement === 'behind') {
      columns = [{ site: sites[0], dx: 0, scale: 2.2, alpha: 0.35 }]
    } else {
      columns = sites.map(function (site) { return { site: site, dx: 0, scale: placement === 'glyphs' ? 0.6 : 1, alpha: 1 } })
    }
    var perColumn = Math.max(2, Math.min(6, kit.count(4, 2)))
    var oneShot = placement === 'glyphs'
    var spacing = kit.size * 0.42
    var items = []
    columns.forEach(function (col, ci) {
      for (var j = 0; j < perColumn; j += 1) {
        var g = kit.graphics(kit.view, shape)
        g.tint = kit.color(ci + j)
        items.push({ g: g, col: col, j: j })
      }
    })
    var p = newPos()
    return function (time) {
      var anchors = kit.anchors(time)
      var x = kit.exit(time)
      for (var i = 0; i < items.length; i += 1) {
        var it = items[i]
        var col = it.col
        var j = it.j
        var local = time - col.site.start - j * 0.05
        if (local < 0 || x >= 1 || (oneShot && local > 1.6)) {
          it.g.visible = false
          continue
        }
        kit.pos(col.site, anchors, p)
        var s = spacing * col.scale
        var total = perColumn * s
        // 一拍一格往上走，每格落定时有过冲。
        var travel = beatSteps(local * 3.2, 0.4) * s * 0.5 + x * x * s * 6
        var y = wrap(j * s - travel, total)
        var k = y / total
        var fade = Math.sin(Math.PI * clamp01(k))
        var pop = easeOutBack(local / 0.3, 2.4)
        var baseY = oneShot ? p.y - p.size * 0.8 - total * 0.5 : p.y - total / 2
        it.g.visible = true
        it.g.position.set(p.x + col.dx, baseY + y)
        it.g.scale.set(Math.max(0.001, (kit.size * 0.06) * col.scale * pop))
        var alpha = fade * col.alpha * (1 - x) * p.alpha
        if (oneShot) alpha *= 1 - clamp01((local - 1) / 0.6)
        it.g.alpha = alpha
      }
    }
  }

  // ─── glints：字被唱到时，一粒光点沿字的轮廓跑一圈 ─────────────────────────
  /** 方框周长参数化：u ∈ [0, 1) → 边上的点（从左上角顺时针）。 */
  function aroundBox(u, halfW, halfH) {
    var perimeter = 4 * (halfW + halfH)
    var d = fract(u) * perimeter
    if (d < 2 * halfW) return [-halfW + d, -halfH]
    d -= 2 * halfW
    if (d < 2 * halfH) return [halfW, -halfH + d]
    d -= 2 * halfH
    if (d < 2 * halfW) return [halfW - d, halfH]
    d -= 2 * halfW
    return [-halfW, halfH - d]
  }

  function glintsOrnament(kit) {
    var onGlyph = kit.spec.placement === 'glyphs' || kit.glyphs.length === 0
    var run = 0.55
    if (onGlyph) {
      var items = triggers(kit, kit.count(16, 4)).map(function (trigger, i) {
        var head = kit.sprite('glow')
        var tail = kit.sprite('dot')
        var spark = kit.sprite('star4')
        var sprites = [head, tail, spark]
        for (var k = 0; k < sprites.length; k += 1) { sprites[k].tint = kit.color(i) }
        return { head: head, tail: tail, spark: spark, trigger: trigger, corner: Math.floor(kit.rng() * 4) / 4 }
      })
      var site = kit.sites('single', 1)[0]
      var p0 = newPos()
      return function (time) {
        var anchors = kit.anchors(time)
        var x = kit.exit(time)
        items.forEach(function (it) {
          var local = time - it.trigger.at
          var hide = local < 0 || x >= 1
          it.head.visible = !hide
          it.tail.visible = !hide
          it.spark.visible = !hide
          if (hide) return
          var gx
          var gy
          var size
          var alpha = 1
          if (it.trigger.glyph) {
            var anchor = anchors[it.trigger.glyph.index]
            gx = anchor ? anchor.x : it.trigger.glyph.x
            gy = anchor ? anchor.y : it.trigger.glyph.y
            size = anchor ? anchor.size : it.trigger.glyph.size
            alpha = anchor ? anchor.alpha : 1
          } else {
            kit.pos(site, anchors, p0)
            gx = p0.x
            gy = p0.y
            size = kit.size
          }
          var half = size * 0.56
          var k = clamp01(local / run)
          var running = k < 1
          var u = easeOutCubic(k)
          var headBox = aroundBox(u, half, half)
          var tailBox = aroundBox(Math.max(0, u - 0.08), half, half)
          var hs = kit.size * 0.35
          it.head.visible = running
          it.tail.visible = running
          if (running) {
            it.head.position.set(gx + headBox[0], gy + headBox[1])
            it.head.width = hs
            it.head.height = hs
            it.head.alpha = alpha
            it.tail.position.set(gx + tailBox[0], gy + tailBox[1])
            it.tail.width = hs * 0.25
            it.tail.height = hs * 0.25
            it.tail.alpha = alpha * 0.7
          }
          // 跑完一圈：在某个角上留下一颗闪着的小星。
          var cornerBox = aroundBox(it.corner, half, half)
          var after = local - run
          var twinkle = after < 0 ? 0 : spring(after, 2.5, 6) * (0.55 + 0.45 * Math.sin(time * 7 + it.corner * 20))
          var ss = kit.size * 0.4 * twinkle * (1 - easeInCubic(x))
          it.spark.visible = ss > 0.5
          it.spark.position.set(gx + cornerBox[0], gy + cornerBox[1])
          it.spark.width = ss
          it.spark.height = ss
          it.spark.alpha = alpha * (1 - x)
        })
      }
    }
    // 不贴字：一粒光点绕着落点的方框循环跑，每个字被唱到时加速、变亮。
    var sites = kit.sites('single', 1)
    var runners = []
    sites.forEach(function (site, si) {
      ;[0, 0.5].forEach(function (phase, r) {
        var head = kit.sprite('glow')
        var tails = [kit.sprite('dot'), kit.sprite('dot'), kit.sprite('dot')]
        var sprites = [head].concat(tails)
        for (var k = 0; k < sprites.length; k += 1) { sprites[k].tint = kit.color(si + r) }
        runners.push({ site: site, phase: phase, head: head, tails: tails })
      })
    })
    var p = newPos()
    return function (time) {
      var anchors = kit.anchors(time)
      var x = kit.exit(time)
      var boost = Math.exp(-(time - kit.lastSung(time)) / 0.2)
      for (var i = 0; i < runners.length; i += 1) {
        var r = runners[i]
        var local = time - r.site.start
        var hide = local < 0 || x >= 1
        r.head.visible = !hide
        r.tails.forEach(function (t) { t.visible = !hide })
        if (hide) continue
        kit.pos(r.site, anchors, p)
        var halfW = r.site.w + kit.size * 0.15
        var halfH = r.site.h + kit.size * 0.15
        var u = r.phase + local / 2.8 + 0.1 * beatSteps(local * 1.2, 0.3) / 1.2
        var alpha = clamp01(local / 0.2) * (1 - x) * p.alpha
        var headBox = aroundBox(u, halfW, halfH)
        var hs = kit.size * (0.3 + 0.25 * boost)
        r.head.position.set(p.x + headBox[0], p.y + headBox[1])
        r.head.width = hs
        r.head.height = hs
        r.head.alpha = alpha
        r.tails.forEach(function (t, k) {
          var tailBox = aroundBox(u - 0.012 * (k + 1), halfW, halfH)
          var ts = hs * 0.3 * (1 - k * 0.25)
          t.position.set(p.x + tailBox[0], p.y + tailBox[1])
          t.width = ts
          t.height = ts
          t.alpha = alpha * (0.7 - k * 0.2)
        })
      }
    }
  }

  window.FoliaHanabiOrnamentsParticles = {
    sparkleOrnament: sparkleOrnament,
    crossOrnament: crossOrnament,
    confettiOrnament: confettiOrnament,
    petalsOrnament: petalsOrnament,
    shardsOrnament: shardsOrnament,
    streaksOrnament: streaksOrnament,
    chevronsOrnament: chevronsOrnament,
    glintsOrnament: glintsOrnament,
    aroundBox: aroundBox
  }
})()
