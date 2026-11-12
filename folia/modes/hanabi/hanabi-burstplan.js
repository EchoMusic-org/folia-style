// 花火（hanabi）烟花解析模型：移植自 folia-major src/components/visualizer/hanabi/mg/burstPlan.ts
// 烟花的解析模型（纯函数，不碰 Pixi）：一个 BurstEvent 展开成一组「星」的参数，每颗星在任意时刻的位置、亮度、颜色都由闭式解算出。
// 运动：初速度 v0、线性阻尼 k、重力（终端下落速度 vt）—— p(τ) = p0 + v0·(1−e^{−kτ})/k + vt·(τ − (1−e^{−kτ})/k)，外加蜂的螺旋项。
// 尾迹沿轨迹往回取几个时间点连成段。seek 到哪一刻结果都一样；按精灵池上限按比例抽稀（每朵花都等比例变稀）。
//
// StarPlan（一颗星或分裂出来的子星；时间是绝对秒，坐标是烟花层本地像素）：x0/y0/vx/vy、drag 阻尼（1/s）、
//   fall 终端下落速度（px/s，重力 = fall × drag）、start/life 点燃时刻与寿命、size 星的直径（px）、color/endColor（寿
//   命的 shift 处变色，牡丹的变色）/shift、trailColor、trail/segments 尾迹覆盖的时间长度（秒）与段数、fadeTail 寿命
//   末尾多大一段用来熄灭（0..1）、strobe/strobeFrom 点滅频率（Hz）与起点（0 = 不闪）、twinkle 末段随机闪烁（0..1）、
//   glitter 金粉闪光（0..1，冠柳椰的碎闪）、spiral/spin/phase 蜂的螺旋半径（px）角速度（rad/s）与相位、depth 球面背
//   面的星暗一点（0..1）、rank 抽稀次序（0..1 低差异序列，rank < 保留比例的星才画）、tex（0 = 柔光点，1 = 四角星）。
// FlashPlan（开花瞬间 / 千輪每一朵 / 分裂点 / スターマイン每一发的闪光）：x/y/at/size/color/life。
(function () {
  'use strict'

  var Core = window.FoliaHanabiCore

  // ---------- MG 共享纯数学（原版 mg/mgMath.ts，正主实现在 hanabi-ornaments.js 的 FoliaHanabiOrnaments.Math） ----------
  // 本文件加载早于 hanabi-ornaments.js，这里按同一套公式内联本文件用到的几个，保证本文件可独立加载
  // （同 hanabi-transitions.js 引用 timeline 缓动的做法）。
  var TAU = Math.PI * 2
  var clamp01 = function (value) { return value <= 0 ? 0 : value >= 1 ? 1 : value }
  var lerp = function (a, b, t) { return a + (b - a) * t }
  /** 确定性噪声：同一 (n, salt) 永远同一个 [0, 1) 值。 */
  var fract = function (value) { return value - Math.floor(value) }
  var hash01 = function (n, salt) {
    if (salt === undefined) salt = 0
    return fract(Math.sin(n * 127.1 + salt * 311.7) * 43758.5453123)
  }
  /** 字符串 → 32 位散列（FNV-1a），给逐帧的噪声当盐。 */
  function hashString(key) {
    var hash = 0x811c9dc5
    for (var i = 0; i < key.length; i += 1) {
      hash ^= key.charCodeAt(i)
      hash = Math.imul(hash, 16777619)
    }
    return hash >>> 0
  }
  /** 0xRRGGBB 逐通道线性混合。 */
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
  /** 火药燃烧的金色（冠、柳、椰的主色调）。 */
  var GOLD = 0xffc760
  /** 尾迹里的橙色火粉。 */
  var EMBER = 0xff9a3c

  // ---------- 方案生成 ----------

  var GOLDEN = 0.6180339887498949
  var GOLDEN_ANGLE = 2.399963229728653

  var sparkColor = function (palette, colors, i) {
    var sparks = palette.sparks.length > 0 ? palette.sparks : [WHITE]
    var n = sparks.length
    var index = colors.length > 0 ? colors[((i % colors.length) + colors.length) % colors.length] : i
    return sparks[((Math.round(index) % n) + n) % n]
  }

  /**
   * planBurst(event, palette, env)：一个烟花事件 → 全部星与闪光的闭式解。
   * event：BurstEvent { x, y, at, spec { kind, count, radius, duration, colors, trail, twinkle }, seed, scale, squash?, rotation? }。
   * env：{ unit 画面短边（px，BurstSpec.radius 以它为单位）, amount 粒子数倍率（tuning.sparkAmount） }。
   */
  function planBurst(event, palette, env) {
    var spec = event.spec
    var kind = spec.kind
    var rng = Core.createRng(event.seed + ':' + kind)
    var R = Math.max(4, spec.radius * env.unit * (event.scale || 1))
    var D = Math.max(0.2, spec.duration)
    var at = event.at
    var n = Math.max(0, Math.round(spec.count * Math.max(0, env.amount)))
    var trailK = clamp01(spec.trail)
    var twinkleK = clamp01(spec.twinkle)
    var squash = event.squash !== undefined ? event.squash : 1
    var rotation = event.rotation !== undefined ? event.rotation : 0
    var cosR = Math.cos(rotation)
    var sinR = Math.sin(rotation)
    var c = function (i) { return sparkColor(palette, spec.colors, i) }
    var stars = []
    var flashes = []
    var minSize = Math.max(1.4, env.unit * 0.0022)

    var add = function (input) {
      var delay = input.start !== undefined ? input.start : 0
      // 所有星都在 duration 之内燃尽：寿命按剩余时间截断。
      var life = Math.min(input.life, D - delay - 0.02)
      if (life <= 0.05) return
      stars.push({
        x0: event.x + (input.x0 !== undefined ? input.x0 : 0),
        y0: event.y + (input.y0 !== undefined ? input.y0 : 0),
        vx: input.vx,
        vy: input.vy,
        drag: input.drag,
        fall: input.fall !== undefined ? input.fall : 0,
        start: at + delay,
        life: life,
        size: Math.max(minSize, input.size),
        color: input.color,
        endColor: input.endColor !== undefined ? input.endColor : input.color,
        shift: input.shift !== undefined ? input.shift : 1,
        trailColor: input.trailColor !== undefined ? input.trailColor : mixColor(input.color, EMBER, 0.3),
        trail: input.trail !== undefined ? input.trail : 0,
        segments: input.trail && input.trail > 0 ? Math.max(1, input.segments !== undefined ? input.segments : 3) : 0,
        fadeTail: input.fadeTail !== undefined ? input.fadeTail : 0.3,
        strobe: input.strobe !== undefined ? input.strobe : 0,
        strobeFrom: input.strobeFrom !== undefined ? input.strobeFrom : 0,
        twinkle: input.twinkle !== undefined ? input.twinkle : 0,
        glitter: input.glitter !== undefined ? input.glitter : 0,
        spiral: input.spiral !== undefined ? input.spiral : 0,
        spin: input.spin !== undefined ? input.spin : 0,
        phase: input.phase !== undefined ? input.phase : rng() * TAU,
        depth: input.depth !== undefined ? input.depth : 1,
        rank: 0,
        tex: input.tex !== undefined ? input.tex : 0
      })
    }

    var flash = function (x, y, delay, size, color, life) {
      if (life === undefined) life = 0.32
      if (delay >= D) return
      flashes.push({ x: event.x + x, y: event.y + y, at: at + delay, size: size, color: mixColor(color, WHITE, 0.7), life: Math.min(life, D - delay) })
    }

    // 球面上均匀的方向（斐波那契球 + 随机倾斜 + 抖动），返回投影到画面的 (x, y) 与深度 z。
    var tiltA = rng() * TAU
    var tiltCos = Math.cos(tiltA)
    var tiltSin = Math.sin(tiltA)
    var sphere = function (i, count, jitter) {
      if (jitter === undefined) jitter = 0.25
      var z = 1 - (2 * (i + 0.5)) / count
      var r = Math.sqrt(Math.max(0, 1 - z * z))
      var phi = i * GOLDEN_ANGLE + (rng() - 0.5) * jitter
      var x = r * Math.cos(phi)
      var y0 = r * Math.sin(phi)
      return [x, y0 * tiltCos - z * tiltSin, y0 * tiltSin + z * tiltCos]
    }
    // 平面方向 → 压扁 + 旋转（輪、型物）。
    var planar = function (x, y) {
      var sy = y * squash
      return [x * cosR - sy * sinR, x * sinR + sy * cosR]
    }
    var depthOf = function (z) { return 0.62 + 0.38 * (z + 1) / 2 }
    var life = function (low, high) { return D * lerp(low, high, rng()) }

    var c0 = c(0)
    var c1 = c(1)
    var c2 = c(2)

    switch (kind) {
      case 'kiku': {
        // 菊：带尾迹的球，外层末段转白、内层一小圈「芯」。
        var core = Math.round(n * 0.2)
        var main = n - core
        var k = 3.2
        for (var i = 0; i < main; i += 1) {
          var s = sphere(i, main)
          var speed = R * k * (0.94 + rng() * 0.12)
          add({
            vx: s[0] * speed, vy: s[1] * speed, drag: k, fall: R * 0.3,
            life: life(0.78, 0.98), size: R * 0.02, color: c0, endColor: mixColor(c0, WHITE, 0.65), shift: 0.7,
            trail: 0.1 + trailK * 0.38, segments: 3, trailColor: mixColor(c0, EMBER, 0.3),
            twinkle: twinkleK, depth: depthOf(s[2])
          })
        }
        for (var i2 = 0; i2 < core; i2 += 1) {
          var s2 = sphere(i2, core)
          var speed2 = R * 3.6 * 0.42 * (0.95 + rng() * 0.1)
          add({
            vx: s2[0] * speed2, vy: s2[1] * speed2, drag: 3.6, fall: R * 0.2,
            life: life(0.4, 0.55), size: R * 0.017, color: c1, trail: 0.04 + trailK * 0.08, segments: 1,
            fadeTail: 0.2, depth: depthOf(s2[2])
          })
        }
        flash(0, 0, 0, R * 1.1, c0, 0.36)
        break
      }
      case 'botan': {
        // 牡丹：没有尾迹的饱满大色点，半程变色，干脆地熄灭；芯换第三色。
        var coreB = Math.round(n * 0.22)
        var mainB = n - coreB
        var kB = 3.6
        for (var i3 = 0; i3 < mainB; i3 += 1) {
          var s3 = sphere(i3, mainB, 0.12)
          var speed3 = R * kB * (0.97 + rng() * 0.06)
          add({
            vx: s3[0] * speed3, vy: s3[1] * speed3, drag: kB, fall: R * 0.24,
            life: life(0.85, 0.97), size: R * 0.034, color: c0, endColor: c1, shift: 0.48,
            fadeTail: 0.12, twinkle: twinkleK * 0.6, depth: depthOf(s3[2])
          })
        }
        for (var i4 = 0; i4 < coreB; i4 += 1) {
          var s4 = sphere(i4, coreB, 0.12)
          var speed4 = R * kB * 0.5
          add({
            vx: s4[0] * speed4, vy: s4[1] * speed4, drag: kB, fall: R * 0.2,
            life: life(0.6, 0.72), size: R * 0.03, color: c2, endColor: mixColor(c2, WHITE, 0.5), shift: 0.55,
            fadeTail: 0.12, depth: depthOf(s4[2])
          })
        }
        flash(0, 0, 0, R * 1.2, c0, 0.3)
        break
      }
      case 'yanagi': {
        // 柳：初速小、重力大，长长的金色尾迹一路垂下来，末段碎闪。
        var kY = 2.5
        var goldY = mixColor(c0, GOLD, 0.6)
        for (var i5 = 0; i5 < n; i5 += 1) {
          var s5 = sphere(i5, n, 0.4)
          var speed5 = R * kY * 0.72 * (0.9 + rng() * 0.2)
          add({
            vx: s5[0] * speed5, vy: s5[1] * speed5 - R * 0.25, drag: kY, fall: R * 0.95,
            life: life(0.88, 0.99), size: R * 0.013, color: goldY, endColor: mixColor(goldY, EMBER, 0.6), shift: 0.6,
            trail: 0.35 + trailK * 0.95, segments: 4, trailColor: mixColor(goldY, EMBER, 0.35),
            fadeTail: 0.45, glitter: 0.25 + twinkleK * 0.5, depth: depthOf(s5[2]) * 0.9
          })
        }
        flash(0, 0, 0, R * 0.8, goldY, 0.3)
        break
      }
      case 'kamuro': {
        // 冠：金色、又大又密，像一把慢慢垂下的伞，全程金粉碎闪，最后一点点暗下去。
        var kK = 3.0
        var goldK = mixColor(c0, GOLD, 0.78)
        for (var i6 = 0; i6 < n; i6 += 1) {
          var s6 = sphere(i6, n, 0.2)
          var speed6 = R * kK * 1.05 * (0.95 + rng() * 0.1)
          add({
            vx: s6[0] * speed6, vy: s6[1] * speed6 - R * 0.12, drag: kK, fall: R * 0.55,
            life: life(0.9, 0.99), size: R * 0.017, color: goldK, endColor: mixColor(goldK, EMBER, 0.5), shift: 0.55,
            trail: 0.45 + trailK * 0.8, segments: 4, trailColor: mixColor(goldK, EMBER, 0.25),
            fadeTail: 0.5, glitter: 0.55 + twinkleK * 0.45, depth: depthOf(s6[2])
          })
        }
        flash(0, 0, 0, R * 1.3, goldK, 0.42)
        break
      }
      case 'senrin': {
        // 千輪：一群小花在大半径里依次开，每朵自己的颜色与闪光。
        var flowers = Math.max(4, Math.min(10, Math.round(n / 14)))
        var per = Math.max(6, Math.round(n / flowers))
        var kS = 4.4
        for (var f = 0; f < flowers; f += 1) {
          var angle = f * GOLDEN_ANGLE + rng() * 0.6
          var dist = R * 0.78 * Math.sqrt((f + 0.5) / flowers)
          var ox = Math.cos(angle) * dist
          var oy = Math.sin(angle) * dist
          var delay = 0.06 + (f / flowers) * D * 0.42 + rng() * 0.05
          var r = R * (0.2 + rng() * 0.08)
          var color = c(f)
          for (var i7 = 0; i7 < per; i7 += 1) {
            var s7 = sphere(i7, per, 0.3)
            var speed7 = r * kS * (0.92 + rng() * 0.16)
            add({
              x0: ox, y0: oy, start: delay, vx: s7[0] * speed7, vy: s7[1] * speed7, drag: kS, fall: R * 0.16,
              life: D * (0.32 + rng() * 0.12), size: R * 0.017, color: color, endColor: mixColor(color, WHITE, 0.6), shift: 0.65,
              trail: trailK * 0.08, segments: 1, fadeTail: 0.25, twinkle: 0.3 + twinkleK * 0.7, depth: depthOf(s7[2])
            })
          }
          flash(ox, oy, delay, r * 1.4, color, 0.22)
        }
        break
      }
      case 'ring': {
        // 輪：一个平面圆环（按 squash / rotation 倾斜成椭圆），内侧第二圈，中心几颗芯。
        var kR = 3.4
        var outer = Math.round(n * 0.7)
        var inner = Math.round(n * 0.2)
        var coreR = n - outer - inner
        var ringOf = function (count, reach, color, size, lifeLow) {
          for (var i8 = 0; i8 < count; i8 += 1) {
            var d = planar(Math.cos((TAU * i8) / count), Math.sin((TAU * i8) / count))
            var speed8 = R * kR * reach * (0.99 + rng() * 0.02)
            add({
              vx: d[0] * speed8, vy: d[1] * speed8, drag: kR, fall: R * 0.18,
              life: life(lifeLow, lifeLow + 0.12), size: size, color: color, endColor: mixColor(color, WHITE, 0.5), shift: 0.75,
              trail: 0.05 + trailK * 0.2, segments: 2, twinkle: twinkleK
            })
          }
        }
        ringOf(outer, 1, c0, R * 0.022, 0.85)
        ringOf(inner, 0.58, c1, R * 0.018, 0.7)
        for (var i9 = 0; i9 < coreR; i9 += 1) {
          var s9 = sphere(i9, Math.max(1, coreR))
          var speed9 = R * kR * 0.18
          add({ vx: s9[0] * speed9, vy: s9[1] * speed9, drag: kR, fall: R * 0.15, life: life(0.45, 0.6), size: R * 0.02, color: c2, depth: depthOf(s9[2]) })
        }
        flash(0, 0, 0, R * 0.9, c0, 0.3)
        break
      }
      case 'heart':
      case 'star': {
        // 型物：方向按轮廓给，所有星阻尼相同，所以形状整体放大；重力很小、寿命短，形状散开前就熄灭。
        var kH = 3.4
        var outline = Math.max(12, Math.round(n * 0.88))
        for (var i10 = 0; i10 < outline; i10 += 1) {
          var u = i10 / outline
          var x
          var y
          if (kind === 'heart') {
            var t = u * TAU
            x = (16 * Math.pow(Math.sin(t), 3)) / 17
            y = -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)) / 17
          } else {
            // 五角星：外顶点 1、内顶点 0.4，沿十条边均匀取点。
            var edge = u * 10
            var e = Math.floor(edge)
            var fr = edge - e
            var vertex = function (index) {
              var radius = index % 2 === 0 ? 1 : 0.4
              var a = -Math.PI / 2 + (index * Math.PI) / 5
              return [Math.cos(a) * radius, Math.sin(a) * radius]
            }
            var av = vertex(e)
            var bv = vertex(e + 1)
            x = lerp(av[0], bv[0], fr)
            y = lerp(av[1], bv[1], fr)
          }
          var d10 = planar(x, y)
          var speed10 = R * kH * (0.99 + rng() * 0.02)
          add({
            vx: d10[0] * speed10, vy: d10[1] * speed10, drag: kH, fall: R * 0.1,
            life: life(0.8, 0.92), size: R * 0.024, color: c0, endColor: mixColor(c0, WHITE, 0.55), shift: 0.7,
            trail: 0.04 + trailK * 0.1, segments: 1, fadeTail: 0.25, twinkle: twinkleK
          })
        }
        var coreH = n - outline
        for (var i11 = 0; i11 < coreH; i11 += 1) {
          var s11 = sphere(i11, Math.max(1, coreH))
          var speed11 = R * kH * 0.15
          add({ vx: s11[0] * speed11, vy: s11[1] * speed11, drag: kH, fall: R * 0.1, life: life(0.4, 0.55), size: R * 0.018, color: c1, depth: depthOf(s11[2]) })
        }
        flash(0, 0, 0, R * 0.8, c0, 0.28)
        break
      }
      case 'palm': {
        // 椰：少量粗枝向外冲出再弯垂，每枝后面跟几颗碎金，像棕榈叶。
        var branches = Math.max(6, Math.min(14, Math.round(n / 9)))
        var crumbs = Math.max(0, Math.min(6, Math.floor((n - branches) / branches)))
        var kP = 2.3
        var goldP = mixColor(c0, GOLD, 0.45)
        for (var b = 0; b < branches; b += 1) {
          var angleP = (TAU * b) / branches + (rng() - 0.5) * 0.35
          // 枝略朝上：上半圈的枝长一点，整体像一棵树冠。
          var up = -Math.sin(angleP)
          var reach = 1 + up * 0.15 + (rng() - 0.5) * 0.1
          var dx = Math.cos(angleP)
          var dy = Math.sin(angleP)
          var speedP = R * kP * reach
          add({
            vx: dx * speedP, vy: dy * speedP, drag: kP, fall: R * 0.7,
            life: life(0.88, 0.98), size: R * 0.05, color: goldP, endColor: mixColor(goldP, EMBER, 0.55), shift: 0.55,
            trail: 0.4 + trailK * 0.55, segments: 5, trailColor: mixColor(goldP, EMBER, 0.3),
            fadeTail: 0.4, glitter: 0.3 + twinkleK * 0.4
          })
          for (var j = 0; j < crumbs; j += 1) {
            var frP = 0.9 - j * 0.1
            add({
              vx: dx * speedP * frP + (rng() - 0.5) * R * 0.3, vy: dy * speedP * frP + (rng() - 0.5) * R * 0.3, drag: kP, fall: R * 0.75,
              life: life(0.55, 0.85), size: R * 0.014, color: mixColor(goldP, WHITE, 0.3), trail: 0.08, segments: 1,
              fadeTail: 0.5, glitter: 0.8
            })
          }
        }
        flash(0, 0, 0, R * 1.0, goldP, 0.4)
        break
      }
      case 'crossette': {
        // 分裂：母星飞出一段后「啪」地十字分裂成四颗子星，子星换色。
        var parents = Math.max(6, Math.min(16, Math.round(n / 5)))
        var kC = 2.8
        var kc = 3.4
        var fallC = R * 0.32
        for (var p = 0; p < parents; p += 1) {
          var angleC = (TAU * p) / parents + (rng() - 0.5) * 0.4
          var speedC = R * kC * 0.72 * (0.9 + rng() * 0.2)
          var vx = Math.cos(angleC) * speedC
          var vy = Math.sin(angleC) * speedC
          var split = D * (0.28 + rng() * 0.08)
          add({
            vx: vx, vy: vy, drag: kC, fall: fallC, life: split, size: R * 0.024, color: c0,
            trail: 0.08 + trailK * 0.2, segments: 2, fadeTail: 0.05
          })
          // 分裂点与那一刻的速度（闭式解），子星从这里接着飞。
          var eC = Math.exp(-kC * split)
          var fC = (1 - eC) / kC
          var sx = vx * fC
          var sy = vy * fC + fallC * (split - fC)
          var svx = vx * eC
          var svy = (vy - fallC) * eC + fallC
          var turn = angleC + Math.PI / 4 + (rng() - 0.5) * 0.3
          for (var q = 0; q < 4; q += 1) {
            var a = turn + (q * Math.PI) / 2
            var cs = R * kc * 0.36
            add({
              x0: sx, y0: sy, start: split, vx: svx * 0.35 + Math.cos(a) * cs, vy: svy * 0.35 + Math.sin(a) * cs,
              drag: kc, fall: R * 0.38, life: D * (0.45 + rng() * 0.12), size: R * 0.018, color: c1,
              endColor: mixColor(c1, WHITE, 0.5), shift: 0.7, trail: 0.06 + trailK * 0.18, segments: 2, twinkle: twinkleK
            })
          }
          flash(sx, sy, split, R * 0.2, c1, 0.16)
        }
        flash(0, 0, 0, R * 0.8, c0, 0.3)
        break
      }
      case 'strobe': {
        // 点滅：星几乎悬停，开花后不久开始按各自相位一亮一灭。
        var kSt = 4
        var white = mixColor(c0, WHITE, 0.55)
        for (var i12 = 0; i12 < n; i12 += 1) {
          var s12 = sphere(i12, n, 0.6)
          var speed12 = R * kSt * 0.88 * (0.8 + rng() * 0.3)
          add({
            vx: s12[0] * speed12, vy: s12[1] * speed12, drag: kSt, fall: R * 0.12,
            life: life(0.85, 0.99), size: R * 0.028, color: white, endColor: c(i12), shift: 0.25,
            strobe: 7 + rng() * 7, strobeFrom: 0.3 + rng() * 0.25, fadeTail: 0.15, depth: depthOf(s12[2]), tex: rng() < 0.3 ? 1 : 0
          })
        }
        flash(0, 0, 0, R * 0.9, white, 0.3)
        break
      }
      case 'hachi': {
        // 蜂：银白色小火花各自绕螺旋乱飞，发出「嗡」的一团。
        var kHa = 2.5
        var silver = mixColor(c0, WHITE, 0.7)
        for (var i13 = 0; i13 < n; i13 += 1) {
          var angleH = rng() * TAU
          var speedH = R * kHa * (0.3 + rng() * 0.6)
          add({
            vx: Math.cos(angleH) * speedH, vy: Math.sin(angleH) * speedH, drag: kHa, fall: R * 0.25,
            life: life(0.5, 0.98), size: R * 0.013, color: silver, endColor: c(i13), shift: 0.6,
            trail: 0.08 + trailK * 0.14, segments: 2, trailColor: mixColor(silver, EMBER, 0.3),
            spiral: R * (0.05 + rng() * 0.11), spin: (rng() < 0.5 ? -1 : 1) * (9 + rng() * 12),
            twinkle: 0.4 + twinkleK * 0.6, fadeTail: 0.3
          })
        }
        flash(0, 0, 0, R * 0.6, silver, 0.24)
        break
      }
      case 'willow-ring': {
        // 双层：内层是（可倾斜的）平面牡丹环，外层是垂下的金柳。
        var innerW = Math.round(n * 0.35)
        var outerW = n - innerW
        var goldW = mixColor(c1, GOLD, 0.7)
        for (var i14 = 0; i14 < innerW; i14 += 1) {
          var d14 = planar(Math.cos((TAU * i14) / innerW), Math.sin((TAU * i14) / innerW))
          var speed14 = R * 3.6 * 0.46
          add({
            vx: d14[0] * speed14, vy: d14[1] * speed14, drag: 3.6, fall: R * 0.15,
            life: life(0.45, 0.55), size: R * 0.03, color: c0, endColor: mixColor(c0, WHITE, 0.5), shift: 0.6, fadeTail: 0.1
          })
        }
        for (var i15 = 0; i15 < outerW; i15 += 1) {
          var s15 = sphere(i15, outerW, 0.4)
          var speed15 = R * 2.6 * (0.92 + rng() * 0.12)
          add({
            vx: s15[0] * speed15, vy: s15[1] * speed15 - R * 0.2, drag: 2.6, fall: R * 0.9,
            life: life(0.88, 0.99), size: R * 0.013, color: goldW, endColor: mixColor(goldW, EMBER, 0.6), shift: 0.6,
            trail: 0.35 + trailK * 0.9, segments: 4, trailColor: mixColor(goldW, EMBER, 0.3),
            fadeTail: 0.45, glitter: 0.3 + twinkleK * 0.4, depth: depthOf(s15[2]) * 0.9
          })
        }
        flash(0, 0, 0, R * 1.0, c0, 0.34)
        break
      }
      case 'mine': {
        // スターマイン：从事件点往上扇形连发几轮，每轮换色、扇面左右摆。
        var volleys = Math.max(4, Math.min(8, Math.round(D * 2.6)))
        var perM = Math.max(4, Math.round(n / volleys))
        var kM = 1.7
        for (var v = 0; v < volleys; v += 1) {
          var delayM = (v / volleys) * D * 0.55
          var lean = (v % 2 === 0 ? -1 : 1) * (0.12 + rng() * 0.2)
          var colorM = c(v)
          var lifeV = Math.min(0.9 + rng() * 0.5, D * 0.6)
          for (var i16 = 0; i16 < perM; i16 += 1) {
            var angleM = -Math.PI / 2 + lean + ((i16 + 0.5) / perM - 0.5) * 1.3 + (rng() - 0.5) * 0.12
            var speedM = R * kM * (1.45 + rng() * 0.45)
            add({
              start: delayM, vx: Math.cos(angleM) * speedM, vy: Math.sin(angleM) * speedM, drag: kM, fall: R * 0.9,
              life: lifeV * (0.8 + rng() * 0.2), size: R * 0.02, color: colorM, endColor: mixColor(colorM, WHITE, 0.6), shift: 0.7,
              trail: 0.1 + trailK * 0.3, segments: 3, fadeTail: 0.3, twinkle: twinkleK
            })
          }
          flash(0, 0, delayM, R * 0.35, colorM, 0.18)
        }
        break
      }
      default: {
        // 上游 default 是 TS 的 never 穷尽兜底（运行时不可达：kind 只有 BURST_PRESETS 里的 14 种）。
        return null
      }
    }

    for (var si = 0; si < stars.length; si += 1) stars[si].rank = ((si + 1) * GOLDEN) % 1
    var end = at
    for (var st = 0; st < stars.length; st += 1) end = Math.max(end, stars[st].start + stars[st].life)
    for (var fl = 0; fl < flashes.length; fl += 1) end = Math.max(end, flashes[fl].at + flashes[fl].life)
    return { at: at, end: end, stars: stars, flashes: flashes }
  }

  // ─── 闭式求值 ───────────────────────────────────────────────────────────

  /** 星点燃后 tau 秒的位置（写进 out，不分配）。 */
  function starPosition(star, tau, out) {
    var t = tau < 0 ? 0 : tau
    var e = Math.exp(-star.drag * t)
    var f = (1 - e) / star.drag
    var x = star.x0 + star.vx * f
    var y = star.y0 + star.vy * f + star.fall * (t - f)
    if (star.spiral > 0) {
      var r = star.spiral * (1 - Math.exp(-3 * t))
      var a = star.phase + star.spin * t
      x += r * Math.cos(a)
      y += r * Math.sin(a)
    }
    out.x = x
    out.y = y
    return out
  }

  /** 不含点滅的亮度（尾迹用）：点燃、背面变暗、末段熄灭。 */
  function starBase(star, tau) {
    if (tau < 0 || tau > star.life) return 0
    var u = tau / star.life
    var b = star.depth * clamp01(tau / 0.035)
    if (u > 1 - star.fadeTail) {
      var k = (1 - u) / star.fadeTail
      b *= k * k * (3 - 2 * k)
    }
    return b
  }

  /** 星在 tau 时的亮度（0..1，超出寿命为 0）。 */
  function starBrightness(star, tau) {
    var b = starBase(star, tau)
    if (b <= 0) return 0
    if (star.strobe > 0 && tau > star.strobeFrom) {
      var on = ((tau * star.strobe + star.phase) % 1) < 0.42
      b *= on ? 1 : 0.05
    }
    var u = tau / star.life
    if (star.twinkle > 0 && u > 0.5) {
      var n = hash01(Math.floor(tau * 24), star.phase * 97)
      b *= 1 - star.twinkle * clamp01((u - 0.5) / 0.2) * (n < 0.45 ? 0.85 : 0)
    }
    return b
  }

  /** 星在 tau 时的颜色：变色 + 金粉碎闪时偏白。 */
  function starColor(star, tau) {
    var u = tau / star.life
    var color = star.shift < 1 ? mixColor(star.color, star.endColor, (u - star.shift) / 0.1) : star.color
    if (star.glitter > 0 && hash01(Math.floor(tau * 30), star.phase * 53) < star.glitter * 0.35) color = mixColor(color, WHITE, 0.75)
    return color
  }

  /** 星在 tau 时的直径：随燃烧变小，金粉闪一下时变大。 */
  function starSize(star, tau) {
    var u = clamp01(tau / star.life)
    var size = star.size * (1 - 0.45 * u)
    if (star.glitter > 0 && hash01(Math.floor(tau * 30), star.phase * 53) < star.glitter * 0.35) size *= 1.6
    return size
  }

  function burstActive(plan, time) {
    return time >= plan.at && time <= plan.end
  }

  // ─── 画一帧（访问者，不分配） ────────────────────────────────────────────
  // SparkTexture 精灵种类：'glow' 柔光点、'dot' 实心点、'star4' 四角星、'streak' 拖尾段、'flash' 闪光（加色混合）。
  // SparkEmit 发一个精灵：emit(texture, x, y, width, height, rotation, alpha, tint) → false = 池已满。
  // streak 的纹理是竖向的（上亮下暗）：rotation 让它的「上」朝向星头。

  var scratchA = { x: 0, y: 0 }
  var scratchB = { x: 0, y: 0 }

  /** 一段拖尾：从 a（新）到 b（旧）。 */
  var emitSegment = function (emit, a, b, thickness, alpha, tint) {
    var dx = a.x - b.x
    var dy = a.y - b.y
    var length = Math.hypot(dx, dy)
    if (length < 0.6 || alpha < 0.01) return true
    // 纹理的「上」是 −y：旋转后指向 a。
    var rotation = Math.atan2(dy, dx) + Math.PI / 2
    return emit('streak', (a.x + b.x) / 2, (a.y + b.y) / 2, thickness, length + thickness * 0.5, rotation, alpha, tint)
  }

  /** 某一时刻这批烟花一共要多少个精灵（不抽稀时）。 */
  function burstDemand(plans, time) {
    var stars = 0
    var flashes = 0
    for (var i = 0; i < plans.length; i += 1) {
      var plan = plans[i]
      if (!burstActive(plan, time)) continue
      for (var f = 0; f < plan.flashes.length; f += 1) {
        var item = plan.flashes[f]
        if (time >= item.at && time < item.at + item.life) flashes += 2
      }
      for (var s = 0; s < plan.stars.length; s += 1) {
        var star = plan.stars[s]
        var tau = time - star.start
        if (tau >= 0 && tau <= star.life) stars += 1 + star.segments
      }
    }
    return { stars: stars, flashes: flashes }
  }

  /** 画出 time 时刻的所有星与闪光。超出 budget 时按 rank 等比例抽稀每一朵。返回用掉的精灵数。 */
  function drawBursts(plans, time, budget, emit) {
    var demand = burstDemand(plans, time)
    if (demand.stars + demand.flashes === 0 || budget <= 0) return 0
    var keep = demand.stars + demand.flashes <= budget
      ? 2
      : Math.max(0, (budget - demand.flashes) * 0.97) / Math.max(1, demand.stars)
    var used = 0
    var put = function (texture, x, y, w, h, r, a, tint) {
      if (used >= budget) return false
      if (!emit(texture, x, y, w, h, r, a, tint)) return false
      used += 1
      return true
    }
    for (var pi = 0; pi < plans.length; pi += 1) {
      var plan = plans[pi]
      if (!burstActive(plan, time)) continue
      for (var fi = 0; fi < plan.flashes.length; fi += 1) {
        var item = plan.flashes[fi]
        var age = time - item.at
        if (age < 0 || age >= item.life) continue
        var k = age / item.life
        var alpha = clamp01(age / 0.02) * Math.pow(1 - k, 2)
        var halo = item.size * (0.55 + 0.6 * Math.sqrt(k))
        if (!put('flash', item.x, item.y, halo, halo, 0, alpha * 0.55, item.color)) return used
        var core = item.size * 0.35 * (1 - k * 0.6)
        if (!put('flash', item.x, item.y, core, core, 0, alpha, WHITE)) return used
      }
    }
    for (var pj = 0; pj < plans.length; pj += 1) {
      var plan2 = plans[pj]
      if (!burstActive(plan2, time)) continue
      for (var st = 0; st < plan2.stars.length; st += 1) {
        var star = plan2.stars[st]
        var tau = time - star.start
        if (tau < 0 || tau > star.life || star.rank >= keep) continue
        var base = starBase(star, tau)
        if (base <= 0) continue
        var head = starPosition(star, tau, scratchA)
        var hx = head.x
        var hy = head.y
        var size = starSize(star, tau)
        if (star.segments > 0) {
          var step = star.trail / star.segments
          var prevX = hx
          var prevY = hy
          for (var j = 1; j <= star.segments; j += 1) {
            var back = Math.max(0, tau - step * j)
            var old = starPosition(star, back, scratchB)
            var fade = Math.pow(1 - (j - 1) / star.segments, 1.3)
            var thickness = Math.max(1.2, size * 0.75 * (1 - 0.45 * (j / star.segments)))
            scratchA.x = prevX
            scratchA.y = prevY
            if (!emitSegment(put, scratchA, old, thickness, base * fade * 0.95, star.trailColor)) return used
            prevX = old.x
            prevY = old.y
            if (back <= 0) break
          }
        }
        var alphaS = starBrightness(star, tau)
        if (alphaS < 0.01) continue
        var tint = starColor(star, tau)
        var drawn = star.tex === 1 ? size * 3.4 : size * 3.4
        if (!put(star.tex === 1 ? 'star4' : 'glow', hx, hy, drawn, drawn, star.phase, alphaS, tint)) return used
      }
    }
    return used
  }

  // ─── 升空尾迹 ───────────────────────────────────────────────────────────

  /** 尾部掉下的火星寿命（秒）与发射间隔。 */
  var LAUNCH_EMBER_LIFE = 0.6
  var LAUNCH_EMBER_STEP = 0.032
  var LAUNCH_TRAIL_SEGMENTS = 5

  /** 升空尾迹结束（最后一颗火星熄灭）的时刻。 */
  function launchEnd(launch) {
    return launch.at + launch.duration + LAUNCH_EMBER_LIFE
  }

  /** 弹头在进度 p（0..1）处的位置：减速上升（到顶速度为 0），左右摇曳、越到顶越稳。 */
  function launchHead(launch, p, salt, out) {
    var k = clamp01(p)
    var rise = 1 - Math.pow(1 - k, 2)
    var span = Math.hypot(launch.toX - launch.fromX, launch.toY - launch.fromY)
    var freq = 2.2 + hash01(1, salt) * 1.6
    var phase = hash01(2, salt) * TAU
    var sway = Math.sin(k * freq * TAU + phase) * span * 0.018 * (1 - k * 0.7)
    out.x = lerp(launch.fromX, launch.toX, rise) + sway
    out.y = lerp(launch.fromY, launch.toY, rise)
    return out
  }

  /** 画一条升空尾迹：弹头（光点 + 白芯）、往回的拖尾段、一路掉下的火星。unit = 画面短边。 */
  function drawLaunch(launch, time, unit, emit) {
    var age = time - launch.at
    if (age < 0 || time > launchEnd(launch)) return true
    var salt = hashString(launch.seed) % 100000
    var duration = Math.max(0.05, launch.duration)
    var color = launch.color
    var ember = mixColor(color, GOLD, 0.55)
    var size = unit * 0.009
    // 火星：固定时间间隔从弹头处掉出，各自按阻尼 + 重力的闭式解下落。
    var firstJ = Math.max(0, Math.ceil((age - LAUNCH_EMBER_LIFE) / LAUNCH_EMBER_STEP))
    var lastJ = Math.floor(Math.min(age, duration) / LAUNCH_EMBER_STEP)
    for (var j = firstJ; j <= lastJ; j += 1) {
      var born = j * LAUNCH_EMBER_STEP
      var tau = age - born
      if (tau < 0 || tau > LAUNCH_EMBER_LIFE) continue
      var from = launchHead(launch, born / duration, salt, scratchB)
      var vx = (hash01(j * 3 + 1, salt) - 0.5) * unit * 0.12
      var vy = (hash01(j * 3 + 2, salt) - 0.2) * unit * 0.05
      var drag = 2.4
      var fall = unit * 0.09
      var e = Math.exp(-drag * tau)
      var f = (1 - e) / drag
      var x = from.x + vx * f
      var y = from.y + vy * f + fall * (tau - f)
      var k = tau / LAUNCH_EMBER_LIFE
      var flicker = hash01(j * 7 + Math.floor(tau * 20), salt) < 0.3 ? 0.4 : 1
      var alpha = Math.pow(1 - k, 1.5) * flicker * 0.85
      var s = size * (0.35 + hash01(j * 5, salt) * 0.35) * (1 - k * 0.5)
      if (!emit('glow', x, y, s * 2.6, s * 2.6, 0, alpha, ember)) return false
    }
    if (age > duration) return true
    var p = age / duration
    var head = launchHead(launch, p, salt, scratchA)
    var hx = head.x
    var hy = head.y
    // 拖尾：往回五段（约 0.35 秒的轨迹），越旧越暗越细。
    var prevX = hx
    var prevY = hy
    for (var t = 1; t <= LAUNCH_TRAIL_SEGMENTS; t += 1) {
      var old = launchHead(launch, Math.max(0, p - (0.07 * t) / duration), salt, scratchB)
      var fade = 1 - (t - 1) / LAUNCH_TRAIL_SEGMENTS
      scratchA.x = prevX
      scratchA.y = prevY
      if (!emitSegment(emit, scratchA, old, Math.max(1, size * 0.9 * fade), 0.8 * fade, mixColor(color, EMBER, 0.3))) return false
      prevX = old.x
      prevY = old.y
    }
    var pulse = 0.85 + 0.15 * Math.sin(age * 40 + salt)
    // 快到顶时弹头变暗（减速、准备开花）。
    var dim = 1 - 0.35 * clamp01((p - 0.8) / 0.2)
    if (!emit('glow', hx, hy, size * 4.2 * pulse, size * 4.2 * pulse, 0, 0.9 * dim, color)) return false
    return emit('dot', hx, hy, size * 0.9, size * 0.9, 0, dim, mixColor(color, WHITE, 0.8))
  }

  /** 某一时刻升空尾迹要多少精灵（上限估计）。 */
  function launchDemand(launch, time) {
    var age = time - launch.at
    if (age < 0 || time > launchEnd(launch)) return 0
    var embers = Math.floor(Math.min(age, LAUNCH_EMBER_LIFE) / LAUNCH_EMBER_STEP) + 1
    return embers + (age <= launch.duration ? LAUNCH_TRAIL_SEGMENTS + 2 : 0)
  }

  window.FoliaHanabiBurstPlan = {
    planBurst: planBurst,
    starPosition: starPosition,
    starBrightness: starBrightness,
    starColor: starColor,
    starSize: starSize,
    burstActive: burstActive,
    burstDemand: burstDemand,
    drawBursts: drawBursts,
    LAUNCH_EMBER_LIFE: LAUNCH_EMBER_LIFE,
    launchEnd: launchEnd,
    launchHead: launchHead,
    drawLaunch: drawLaunch,
    launchDemand: launchDemand
  }
})()
