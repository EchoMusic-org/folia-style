// 花火（hanabi）环境层：移植自 folia-major src/components/visualizer/hanabi/mg/ambient.ts
// 环境层（整单元一份）：back = 薄烟、远处星点（缓慢闪烁）、远方的小烟花；front = 上升的火星、前景散景。
// 两层都按屏幕坐标画（0..width × 0..height），每个点在自己的视差层里随 rise 下移，并在纵向 [−margin, height + margin) 里无缝循环，
// 所以上升多少屏也不会空。远方小烟花按种子排在整个单元的时间里，也用 burstPlan 的闭式解。
(function () {
  'use strict'

  var PIXI = window.PIXI
  var Core = window.FoliaHanabiCore
  var BurstPlan = window.FoliaHanabiBurstPlan
  var Bloom = window.FoliaHanabiBloom

  // ---------- MG 共享纯数学（原版 mg/mgMath.ts，正主实现在 hanabi-ornaments.js 的 FoliaHanabiOrnaments.Math） ----------
  // 本文件加载早于 hanabi-ornaments.js，这里按同一套公式内联本文件用到的几个，保证本文件可独立加载。
  var TAU = Math.PI * 2
  var clamp01 = function (value) { return value <= 0 ? 0 : value >= 1 ? 1 : value }
  var fract = function (value) { return value - Math.floor(value) }
  var hash01 = function (n, salt) {
    if (salt === undefined) salt = 0
    return fract(Math.sin(n * 127.1 + salt * 311.7) * 43758.5453123)
  }
  function hashString(key) {
    var hash = 0x811c9dc5
    for (var i = 0; i < key.length; i += 1) {
      hash ^= key.charCodeAt(i)
      hash = Math.imul(hash, 16777619)
    }
    return hash >>> 0
  }
  function mixColor(a, b, t) {
    var k = clamp01(t)
    if (k <= 0) return a
    if (k >= 1) return b
    var r = Math.round(((a >> 16) & 255) + ((((b >> 16) & 255) - ((a >> 16) & 255)) * k))
    var g = Math.round(((a >> 8) & 255) + ((((b >> 8) & 255) - ((a >> 8) & 255)) * k))
    var bl = Math.round((a & 255) + (((b & 255) - (a & 255)) * k))
    return (r << 16) | (g << 8) | bl
  }
  var WHITE = 0xffffff
  var GOLD = 0xffc760
  /** 落在 [0, span) 里的取模（负数也对）。 */
  var wrap = function (value, span) { return value - span * Math.floor(value / span) }

  // ---------- 视差与远方小烟花 ----------

  /** 各层的视差系数：远处 0.2–0.6，前景 1.2–1.5。 */
  var AMBIENT_PARALLAX = {
    starsNear: 0.42,
    starsFar: 0.2,
    smoke: 0.3,
    distant: 0.55,
    embers: 1.25,
    bokeh: 1.45
  }

  /** 视差层里一个点的屏幕 y：y0 + rise × parallax + drift，在 [−margin, height + margin) 里循环（换位只发生在画面外）。 */
  function parallaxY(y0, rise, parallax, drift, height, margin) {
    return wrap(y0 + rise * parallax + drift + margin, height + margin * 2) - margin
  }

  /** 远方小烟花可用的种类（菊两次、牡丹两次压低方差）。 */
  var DISTANT_KINDS = ['kiku', 'botan', 'ring', 'yanagi', 'senrin', 'kamuro', 'strobe', 'kiku', 'botan']
  var DISTANT_DURATION = 2.6

  /** 远方小烟花：第 k 发的时刻、位置与规格（纯函数，按种子确定）。 */
  function distantBurstAt(seed, k, rate, startTime, width, span) {
    var salt = hashString(seed) % 9973
    var h = function (i) { return hash01(k * 17 + i, salt + 0.37) }
    var at = startTime + (k + 0.1 + h(1) * 0.8) / rate
    var kind = DISTANT_KINDS[Math.floor(h(2) * DISTANT_KINDS.length) % DISTANT_KINDS.length]
    var x = width * (0.06 + h(3) * 0.88)
    var y0 = span * h(4)
    return {
      at: at,
      x: x,
      y0: y0,
      event: {
        x: x,
        y: 0,
        at: at,
        seed: seed + ':distant:' + k,
        scale: 1,
        squash: 0.35 + h(6) * 0.65,
        rotation: (h(7) - 0.5) * 0.8,
        spec: {
          kind: kind,
          count: 26 + Math.floor(h(5) * 20),
          radius: 0.045 + h(8) * 0.045,
          duration: DISTANT_DURATION * (0.75 + h(9) * 0.25),
          colors: [Math.floor(h(10) * 5), Math.floor(h(11) * 5), Math.floor(h(12) * 5)],
          trail: 0.3 + h(13) * 0.4,
          twinkle: h(14) * 0.6
        }
      }
    }
  }

  /** time 时可能在燃烧的远方小烟花序号范围 [first, last]。 */
  function distantRange(time, rate, startTime, endTime) {
    if (rate <= 0) return [0, -1]
    var count = Math.max(0, Math.floor((endTime - startTime) * rate))
    var first = Math.max(0, Math.floor((time - DISTANT_DURATION - startTime) * rate) - 1)
    var last = Math.min(count - 1, Math.floor((time - startTime) * rate))
    return [first, last]
  }

  var tintedSpark = function (palette, i) {
    return palette.sparks[i % Math.max(1, palette.sparks.length)] !== undefined
      ? palette.sparks[i % Math.max(1, palette.sparks.length)]
      : WHITE
  }

  /** 薄烟只用 glow 纹理中间这一块（边长比例）。 */
  var SMOKE_CROP = 0.8

  /**
   * 建环境层（整单元一份）。options：{ pixi, textures, width, height, seed, palette,
   * startTime, endTime, density（0..2，tuning.ambient）, distantBursts 远方小烟花的频率（每秒几个，0 = 没有） }。
   */
  function createAmbient(options) {
    var pixi = options.pixi
    var textures = options.textures
    var width = options.width
    var height = options.height
    var palette = options.palette
    var unit = Math.min(width, height)
    var density = Math.max(0, Math.min(2, options.density))
    var rng = Core.createRng(options.seed + ':ambient')
    // 两层各是一个渲染组：远方小烟花的精灵池每帧都有显隐，星点、火星出入画面也会显隐（Pixi 改 visible 要整组重排绘制指令），
    // 重排只排这一层。远方小烟花叠加的闪光另用一层画在上面，精灵不再来回换混合模式。
    var back = new pixi.Container({ isRenderGroup: true })
    var front = new pixi.Container({ isRenderGroup: true })
    var smokeLayer = new pixi.Container()
    var starLayer = new pixi.Container()
    var distantLayer = new pixi.Container()
    var distantFlashLayer = new pixi.Container()
    distantFlashLayer.blendMode = 'add'
    back.addChild(smokeLayer, starLayer, distantLayer, distantFlashLayer)
    var emberLayer = new pixi.Container()
    var bokehLayer = new pixi.Container()
    front.addChild(bokehLayer, emberLayer)

    var margin = unit * 0.36
    var span = height + margin * 2
    var sprite = function (texture, parent) {
      var s = new pixi.Sprite(texture)
      s.anchor.set(0.5)
      parent.addChild(s)
      return s
    }
    var dots = function (count, parent, make) {
      var list = []
      for (var i = 0; i < count; i += 1) {
        var spec = make(i)
        var s = sprite(spec.texture, parent)
        s.tint = spec.tint
        // 与上游一致：spec（含 texture / tint）原样展开进落点对象，另挂 sprite。
        list.push(Object.assign({}, spec, { sprite: s }))
      }
      return list
    }

    var starTint = mixColor(WHITE, palette.glow, 0.25)
    var stars = dots(Math.round(110 * density), starLayer, function () {
      var bright = rng() < 0.08
      var depth = rng()
      return {
        texture: bright ? textures.star4 : textures.dot,
        tint: bright ? mixColor(WHITE, palette.glow, 0.4) : starTint,
        x: rng() * width,
        y0: rng() * span,
        size: unit * (bright ? 0.012 + rng() * 0.01 : 0.002 + rng() * 0.004),
        alpha: bright ? 0.7 : 0.2 + rng() * 0.55,
        parallax: AMBIENT_PARALLAX.starsFar + depth * (AMBIENT_PARALLAX.starsNear - AMBIENT_PARALLAX.starsFar),
        speed: 0,
        freq: 0.15 + rng() * 0.7,
        phase: rng() * TAU,
        sway: 0
      }
    })
    // 薄烟的精灵很大（0.6–1.1 个 unit）又很淡：glow 纹理半径 0.8 以外那圈乘上烟的透明度不到 1/255，
    // 裁掉那圈、按 0.8 倍画，每团烟少填约 36% 的像素，画面看不出差别。
    var glowFrame = textures.glow.frame
    var smokeTexture = new pixi.Texture({
      source: textures.glow.source,
      frame: new pixi.Rectangle(
        glowFrame.x + glowFrame.width * (1 - SMOKE_CROP) / 2,
        glowFrame.y + glowFrame.height * (1 - SMOKE_CROP) / 2,
        glowFrame.width * SMOKE_CROP,
        glowFrame.height * SMOKE_CROP
      )
    })
    var smoke = dots(Math.round(5 * Math.min(1.5, density)), smokeLayer, function (i) {
      return {
        texture: smokeTexture,
        tint: mixColor(tintedSpark(palette, i), 0x9aa0b4, 0.6),
        x: width * (0.1 + rng() * 0.8),
        y0: rng() * span,
        size: unit * (0.6 + rng() * 0.5) * SMOKE_CROP,
        alpha: 0.035 + rng() * 0.035,
        parallax: AMBIENT_PARALLAX.smoke,
        speed: 0,
        freq: 0.03 + rng() * 0.04,
        phase: rng() * TAU,
        sway: unit * (0.05 + rng() * 0.08)
      }
    })
    var embers = dots(Math.round(40 * density), emberLayer, function (i) {
      return {
        texture: textures.glow,
        tint: mixColor(GOLD, tintedSpark(palette, i), 0.3),
        x: rng() * width,
        y0: rng() * span,
        // glow 纹理的亮芯只占三成：画面上约 3–7 px 的火星。
        size: unit * (0.012 + rng() * 0.016),
        alpha: 0.55 + rng() * 0.45,
        parallax: AMBIENT_PARALLAX.embers + rng() * 0.1,
        speed: unit * (0.05 + rng() * 0.12),
        freq: 0.4 + rng() * 0.9,
        phase: rng() * TAU,
        sway: unit * (0.008 + rng() * 0.02)
      }
    })
    var bokeh = dots(Math.round(6 * density), bokehLayer, function (i) {
      return {
        texture: textures.glow,
        tint: tintedSpark(palette, i + 2),
        x: rng() * width,
        y0: rng() * span,
        size: unit * (0.08 + rng() * 0.1),
        alpha: 0.06 + rng() * 0.08,
        parallax: AMBIENT_PARALLAX.bokeh,
        speed: unit * (0.01 + rng() * 0.02),
        freq: 0.1 + rng() * 0.2,
        phase: rng() * TAU,
        sway: unit * 0.02
      }
    })

    // 远方小烟花：固定大小的精灵池（普通 / 叠加闪光两个池，合起来不超过上限）。
    var distantPools = [distantLayer, distantFlashLayer].map(function (layer) {
      return { layer: layer, sprites: [], used: 0, shown: 0 }
    })
    var distantMax = Math.round(240 * Math.min(1.5, density))
    var distantPlans = new Map()
    var distantUsed = 0
    var offsetY = 0
    var distantTexture = {
      glow: textures.glow,
      dot: textures.dot,
      star4: textures.star4,
      streak: textures.streak,
      flash: textures.glow
    }
    var emitDistant = function (texture, x, y, w, h, rotation, alpha, tint) {
      if (distantUsed >= distantMax) return false
      var pool = distantPools[texture === 'flash' ? 1 : 0]
      var s = pool.sprites[pool.used]
      if (!s) {
        s = sprite(textures.glow, pool.layer)
        pool.sprites.push(s)
      }
      pool.used += 1
      s.texture = distantTexture[texture]
      s.visible = true
      s.position.set(x, y + offsetY)
      s.rotation = rotation
      s.width = w
      s.height = h
      // 远处的更淡。
      s.alpha = Math.min(1, alpha) * 0.6
      s.tint = tint
      distantUsed += 1
      return true
    }
    var activeDistant = []

    var place = function (dot, x, y, size, alpha) {
      var visible = alpha > 0.004 && y > -size && y < height + size
      dot.sprite.visible = visible
      if (!visible) return
      dot.sprite.position.set(x, y)
      dot.sprite.width = size
      dot.sprite.height = size
      dot.sprite.alpha = alpha
    }

    var update = function (time, rise) {
      var i
      for (i = 0; i < stars.length; i += 1) {
        var dot = stars[i]
        var y = parallaxY(dot.y0, rise, dot.parallax, 0, height, margin)
        var twinkle = 0.55 + 0.45 * Math.sin(time * dot.freq * TAU + dot.phase)
        place(dot, dot.x, y, dot.size * (0.85 + 0.3 * twinkle), dot.alpha * twinkle)
      }
      for (i = 0; i < smoke.length; i += 1) {
        var puff = smoke[i]
        var yS = parallaxY(puff.y0, rise, puff.parallax, -time * unit * 0.01, height, margin)
        var xS = puff.x + Math.sin(time * puff.freq * TAU + puff.phase) * puff.sway
        place(puff, xS, yS, puff.size * (1 + 0.1 * Math.sin(time * 0.2 + puff.phase)), puff.alpha)
      }
      for (i = 0; i < embers.length; i += 1) {
        var spark = embers[i]
        var yE = parallaxY(spark.y0, rise, spark.parallax, -time * spark.speed, height, margin)
        var xE = spark.x + Math.sin(time * spark.freq * TAU + spark.phase) * spark.sway
        var flicker = hash01(Math.floor(time * 14 + spark.phase * 10), spark.phase) < 0.25 ? 0.35 : 1
        // 越往上越暗：像飘起来慢慢燃尽的火星。
        var fade = 0.35 + 0.65 * clamp01(yE / height)
        place(spark, xE, yE, spark.size * (0.8 + 0.4 * flicker), spark.alpha * flicker * fade)
      }
      for (i = 0; i < bokeh.length; i += 1) {
        var blob = bokeh[i]
        var yB = parallaxY(blob.y0, rise, blob.parallax, -time * blob.speed, height, margin)
        var xB = blob.x + Math.sin(time * blob.freq * TAU + blob.phase) * blob.sway
        place(blob, xB, yB, blob.size, blob.alpha * (0.8 + 0.2 * Math.sin(time * 0.5 + blob.phase)))
      }

      distantUsed = 0
      if (options.distantBursts > 0 && distantMax > 0) {
        var range = distantRange(time, options.distantBursts, options.startTime, options.endTime)
        var first = range[0]
        var last = range[1]
        var stale = []
        distantPlans.forEach(function (entryDropped, key) {
          if (key < first || key > last) stale.push(key)
        })
        for (var d = 0; d < stale.length; d += 1) distantPlans.delete(stale[d])
        for (var k = first; k <= last; k += 1) {
          var entry = distantPlans.get(k)
          if (!entry) {
            var burst = distantBurstAt(options.seed, k, options.distantBursts, options.startTime, width, span)
            entry = { burst: burst, plan: BurstPlan.planBurst(burst.event, palette, { unit: unit, amount: Math.min(1.5, density) }) }
            distantPlans.set(k, entry)
          }
          if (time < entry.plan.at || time > entry.plan.end) continue
          offsetY = parallaxY(entry.burst.y0, rise, AMBIENT_PARALLAX.distant, 0, height, margin)
          activeDistant.length = 0
          activeDistant.push(entry.plan)
          BurstPlan.drawBursts(activeDistant, time, distantMax - distantUsed, emitDistant)
        }
      }
      for (var p = 0; p < distantPools.length; p += 1) {
        var pool = distantPools[p]
        for (var s = pool.used; s < pool.shown; s += 1) pool.sprites[s].visible = false
        pool.shown = pool.used
        pool.used = 0
      }
    }

    return {
      back: back,
      front: front,
      update: update,
      destroy: function () {
        distantPlans.clear()
        // Pixi v8 销毁纪律（PORTING.md）：逐节点无参 destroy（上游写 destroy({ children: true })）。
        Bloom.destroyPixiDisplayTree(back)
        Bloom.destroyPixiDisplayTree(front)
        smokeTexture.destroy(false)
      }
    }
  }

  window.FoliaHanabiAmbient = {
    AMBIENT_PARALLAX: AMBIENT_PARALLAX,
    parallaxY: parallaxY,
    DISTANT_DURATION: DISTANT_DURATION,
    distantBurstAt: distantBurstAt,
    distantRange: distantRange,
    createAmbient: createAmbient
  }
})()
