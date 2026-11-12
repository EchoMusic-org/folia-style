// 花火（hanabi）逐字动画曲线：移植自 folia-major src/components/visualizer/hanabi/text/animations.ts
// 逐字动画（纯函数）：17 种入场、9 种强调、7 种退场，外加入场 / 退场的时间表与 stamp 的整组震动。
// 位移以字号为单位（dx = 1 即挪一个字号），旋转为弧度；幅度统一乘 motion，透明度不乘。
// 姿态形状（GlyphPose）：{ dx, dy, scaleX, scaleY, rotation, alpha, skew,
//   scramble（≥ 0 时显示乱码字形表里的第几个（取模），-1 = 原字）, rgbSplit（红/青两层分色错开的距离，字号单位）,
//   blur（模糊近似 0..1：zoom / dissolve 用放大的半透明重影表现）, split（两半字的分离量 0..1，0 = 拼合）,
//   backside（翻到背面 scaleX < 0 时用强调色着色）, reveal（wipe：沿行方向显露的比例 0..1）}
// 强调形状（SingPose）：{ dx, dy, scale, scaleX, scaleY, rotation, flash（0..1 字色向闪光色混合，瞬时）,
//   glow（0..1 光晕层的强度）, color（0..1 字色向强调色混合，唱过后保持）}
// 上下文形状（FxContext）：{ index（这个字在行里的序号）, count（可见字总数）,
//   rand（四个按种子固定的随机数 0..1）, toCenterX / toCenterY（从字心指向文字组中心的向量，字号单位）,
//   dirX / dirY（行的前进方向，单位向量）, time（这一段动画开始后过了多少秒，乱码翻动、故障抖动按它取帧）,
//   motion（动作幅度倍率）, slideDistance（slide 退场滑出的距离，字号单位，可省略）}
(function () {
  'use strict'

  /** 入场动画名（17 种）。 */
  var ENTER_FX = [
    'pop', 'drop', 'rise', 'spin', 'wipe', 'type', 'scramble', 'stretch', 'elastic',
    'split', 'spiral', 'flip', 'glitch', 'stamp', 'wave', 'zoom', 'burst',
  ]
  /** 被唱强调名（9 种）。 */
  var SING_FX = ['none', 'bounce', 'flash', 'swell', 'shake', 'jump', 'glow', 'underline', 'color']
  /** 退场动画名（7 种）。 */
  var EXIT_FX = ['ascend', 'scatter', 'shrink', 'slide', 'dissolve', 'fall', 'blink']

  /** 每种入场一个字的时长（秒）。 */
  var ENTER_DURATION = {
    pop: 0.45, drop: 0.62, rise: 0.6, spin: 0.62, wipe: 0.42, type: 0.12, scramble: 0.75, stretch: 0.55,
    elastic: 0.85, split: 0.5, spiral: 0.85, flip: 0.55, glitch: 0.6, stamp: 0.5, wave: 0.75, zoom: 0.6, burst: 0.75,
  }

  /** 字「到位」大致在入场的哪个比例（字底色块在这时出现，免得空色块等着字飞来）。 */
  var ENTER_ARRIVAL = {
    pop: 0, drop: 0.4, rise: 0.3, spin: 0.2, wipe: 0, type: 0, scramble: 0, stretch: 0.1, elastic: 0.1,
    split: 0.3, spiral: 0.45, flip: 0.15, glitch: 0, stamp: 0.35, wave: 0.3, zoom: 0.25, burst: 0.3,
  }

  /** stamp 砸到位的时刻（占入场时长的比例），整组在这一刻震动。 */
  var STAMP_IMPACT = 0.5

  // ─── 缓动 ──────────────────────────────────────────────────────────────

  function clamp01(value) { return value <= 0 ? 0 : value >= 1 ? 1 : value }
  function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3) }
  function easeInCubic(t) { return t * t * t }
  function easeInQuad(t) { return t * t }
  function easeOutQuad(t) { return 1 - (1 - t) * (1 - t) }
  function easeOutExpo(t) { return t >= 1 ? 1 : 1 - Math.pow(2, -10 * t) }
  function easeOutBack(t, s) {
    if (s === undefined) s = 1.70158
    return 1 + (s + 1) * Math.pow(t - 1, 3) + s * Math.pow(t - 1, 2)
  }
  function easeInBack(t, s) {
    if (s === undefined) s = 1.70158
    return (s + 1) * t * t * t - s * t * t
  }
  function easeInOutCubic(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2 }
  /** 衰减余弦 / 正弦：乘 (1 - q) 保证 q = 1 时正好归零。 */
  function dampedCos(q, freq, decay) { return Math.exp(-decay * q) * Math.cos(freq * q) * (1 - q) }
  function dampedSin(q, freq, decay) { return Math.exp(-decay * q) * Math.sin(freq * q) * (1 - q) }

  /** 整数哈希 → 0..1（乱码、故障逐帧取值用；纯函数）。 */
  function hash01(a, b) {
    if (b === undefined) b = 0
    var h = Math.imul((a | 0) ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul((b | 0) + 0x632be5ab, 0xc2b2ae35)
    h ^= h >>> 15
    h = Math.imul(h, 0x2c1b3c6d)
    h ^= h >>> 12
    h = Math.imul(h, 0x297a2d39)
    h ^= h >>> 15
    return (h >>> 0) / 4294967296
  }

  // ─── 姿态 ──────────────────────────────────────────────────────────────

  function restPose() {
    return {
      dx: 0, dy: 0, scaleX: 1, scaleY: 1, rotation: 0, alpha: 1, skew: 0,
      scramble: -1, rgbSplit: 0, blur: 0, split: 0, backside: false, reveal: 1,
    }
  }

  function restSing() {
    return { dx: 0, dy: 0, scale: 1, scaleX: 1, scaleY: 1, rotation: 0, flash: 0, glow: 0, color: 0 }
  }

  /** 按 motion 缩放动作幅度（位移、旋转、缩放偏离 1 的部分、错切、分色）。 */
  function applyMotion(pose, motion) {
    if (motion === 1) return pose
    pose.dx *= motion
    pose.dy *= motion
    pose.rotation *= motion
    pose.skew *= motion
    pose.rgbSplit *= motion
    pose.scaleX = 1 + (pose.scaleX - 1) * motion
    pose.scaleY = 1 + (pose.scaleY - 1) * motion
    return pose
  }

  function scaled(pose, scale) {
    pose.scaleX = scale
    pose.scaleY = scale
    return pose
  }

  /** 入场：p = 这个字的入场进度 0..1；p = 1 时一定回到静止姿态。 */
  function enterPose(fx, p, ctx) {
    var pose = restPose()
    if (p >= 1) return pose
    var q = clamp01(p)
    var r0 = ctx.rand[0]
    var r1 = ctx.rand[1]
    var r2 = ctx.rand[2]
    switch (fx) {
      case 'pop': {
        // 从 0 弹到 1.2 左右再回落，压扁拉伸交替。
        var s = easeOutBack(q, 2.4)
        scaled(pose, s)
        pose.scaleY = s * (1 + 0.14 * dampedSin(q, 14, 3))
        pose.scaleX = s * (1 - 0.1 * dampedSin(q, 14, 3))
        pose.rotation = (r0 - 0.5) * 0.7 * (1 - easeOutCubic(q))
        pose.dy = 0.25 * (1 - easeOutCubic(q))
        pose.alpha = clamp01(q * 6)
        break
      }
      case 'drop': {
        // 自由落体（下落时纵向拉长），着地压扁，再弹两下。
        if (q < 0.48) {
          var f = q / 0.48
          pose.dy = -2.4 * (1 - f * f)
          pose.scaleY = 1 + 0.3 * f
          pose.scaleX = 1 - 0.12 * f
        } else {
          var f2 = (q - 0.48) / 0.52
          pose.dy = -0.32 * Math.abs(Math.sin(f2 * Math.PI * 2)) * Math.exp(-3 * f2) * (1 - f2)
          pose.scaleY = 1 - 0.3 * dampedCos(f2, 16, 4)
          pose.scaleX = 1 + 0.22 * dampedCos(f2, 16, 4)
        }
        pose.alpha = clamp01(q * 7)
        break
      }
      case 'rise': {
        // 从下方升起，途中纵向拉伸，到位时压扁回弹。
        var fr = clamp01(q / 0.58)
        var e = easeOutCubic(fr)
        pose.dy = 1.7 * (1 - e)
        if (q < 0.58) {
          pose.scaleY = 1 + 0.55 * (1 - e)
          pose.scaleX = 1 - 0.28 * (1 - e)
        } else {
          var g = (q - 0.58) / 0.42
          pose.scaleY = 1 - 0.2 * dampedSin(g, 11, 2.5)
          pose.scaleX = 1 + 0.16 * dampedSin(g, 11, 2.5)
          pose.dy += 0.08 * dampedSin(g, 11, 2.5)
        }
        pose.alpha = clamp01(q * 4)
        break
      }
      case 'spin': {
        var es = easeOutBack(q, 1.9)
        pose.rotation = -2.6 * (1 - es) * (r0 < 0.5 ? 1 : -1)
        scaled(pose, 0.15 + 0.85 * es)
        pose.dx = -0.7 * (1 - easeOutCubic(q)) * ctx.dirX
        pose.dy = -0.7 * (1 - easeOutCubic(q)) * ctx.dirY - 0.3 * Math.sin(Math.PI * q) * (1 - q)
        pose.alpha = clamp01(q * 4)
        break
      }
      case 'wipe': {
        // 遮罩擦出（reveal），字本身带一点顺行方向的滑入与错切。
        var ew = easeOutCubic(q)
        pose.reveal = easeOutCubic(clamp01(q / 0.8))
        pose.dx = -0.35 * (1 - ew) * ctx.dirX
        pose.dy = -0.35 * (1 - ew) * ctx.dirY
        pose.skew = -0.3 * (1 - ew)
        pose.alpha = clamp01(q * 8)
        break
      }
      case 'type': {
        // 一下子出现，带一个很短的放大回落。
        pose.alpha = q > 0 ? 1 : 0
        scaled(pose, 1 + 0.3 * Math.pow(1 - clamp01(q / 0.6), 2))
        break
      }
      case 'scramble': {
        // 前 72% 乱码翻动（约每秒 22 次），定格那一下轻轻放大。
        pose.alpha = clamp01(q * 8)
        if (q < 0.72) {
          var frame = Math.floor(ctx.time * 22)
          pose.scramble = Math.floor(hash01(frame, Math.floor(r0 * 1e6)) * 1e6)
          pose.dy = (hash01(frame + 7, Math.floor(r1 * 1e6)) - 0.5) * 0.12
          pose.alpha *= 0.75 + 0.25 * hash01(frame + 13, 1)
        } else {
          scaled(pose, 1 + 0.16 * Math.pow(1 - (q - 0.72) / 0.28, 2))
        }
        break
      }
      case 'stretch': {
        // 横向拉长到 3 倍、扁成一条，再收回并来回颤两下。
        var k = Math.pow(1 - q, 3)
        pose.scaleX = 1 + 2 * k - 0.16 * dampedSin(q, 13, 3)
        pose.scaleY = 1 - 0.72 * k + 0.12 * dampedSin(q, 13, 3)
        pose.dx = -1.4 * k * ctx.dirX
        pose.dy = -1.4 * k * ctx.dirY
        pose.alpha = clamp01(q * 5)
        break
      }
      case 'elastic': {
        // 从随机方向的偏移处弹簧式回位，沿运动方向轻微拉伸。
        var angle = r0 * Math.PI * 2
        var spring = Math.exp(-4.2 * q) * Math.cos(q * Math.PI * 4.5) * (1 - q)
        pose.dx = Math.cos(angle) * 1.6 * spring
        pose.dy = Math.sin(angle) * 1.6 * spring
        pose.rotation = (r1 - 0.5) * 0.8 * spring
        pose.scaleX = 1 + 0.18 * Math.abs(spring)
        pose.scaleY = 1 - 0.12 * Math.abs(spring)
        pose.alpha = clamp01(q * 5)
        break
      }
      case 'split': {
        // 两半从两侧拼合（split 为分离量，场景里用两张半字纹理画），拼上时轻轻一震。
        pose.split = 1 - easeOutExpo(clamp01(q / 0.8))
        if (q > 0.8) {
          var gsp = (q - 0.8) / 0.2
          pose.scaleX = 1 + 0.1 * dampedSin(gsp, 10, 2)
          pose.scaleY = 1 - 0.08 * dampedSin(gsp, 10, 2)
        }
        pose.alpha = clamp01(q * 5)
        break
      }
      case 'spiral': {
        var esp = easeOutCubic(q)
        var radius = 3.4 * (1 - esp)
        var angleSp = r0 * Math.PI * 2 + Math.PI * 2.5 * (1 - esp)
        pose.dx = Math.cos(angleSp) * radius
        pose.dy = Math.sin(angleSp) * radius * 0.8
        pose.rotation = -Math.PI * 2 * (1 - esp) * (r1 < 0.5 ? 1 : -1)
        scaled(pose, 0.25 + 0.75 * easeOutBack(q, 1.5))
        pose.alpha = clamp01(q * 3)
        break
      }
      case 'flip': {
        // 绕纵轴翻牌：从侧立（scaleX = 0）翻过背面再落到正面，翻起时略微抬高。
        var phi = Math.PI * 2.5 * (1 - easeOutCubic(q))
        pose.scaleX = Math.cos(phi)
        pose.backside = pose.scaleX < 0
        pose.scaleY = 1 + 0.08 * Math.sin(phi)
        pose.dy = -0.3 * Math.sin(Math.PI * q) * (1 - q)
        pose.alpha = clamp01(q * 6)
        break
      }
      case 'glitch': {
        // 前 80% 逐帧跳动：横向错位、RGB 分色、错切、偶尔闪没；之后稳定。
        if (q < 0.8) {
          var frameGl = Math.floor(ctx.time * 24)
          var seed = Math.floor(r0 * 1e6)
          var intensity = 1 - q / 0.8
          var h1 = hash01(frameGl, seed), h2 = hash01(frameGl, seed + 1), h3 = hash01(frameGl, seed + 2), h4 = hash01(frameGl, seed + 3)
          pose.dx = h2 > 0.35 ? (h1 - 0.5) * 0.9 * intensity : 0
          pose.rgbSplit = (0.05 + 0.13 * h3) * intensity
          pose.skew = h4 > 0.7 ? (h1 - 0.5) * 0.9 * intensity : 0
          pose.scaleX = h2 > 0.82 ? 1 + 0.4 * intensity : 1
          pose.alpha = clamp01(q * 10) * (hash01(frameGl, seed + 4) > 0.18 ? 1 : 0.25)
        }
        break
      }
      case 'stamp': {
        // 从 2.6 倍加速砸下，落定瞬间压扁、回弹（整组震动由 stampShake 给）。
        if (q < STAMP_IMPACT) {
          var fs = q / STAMP_IMPACT
          scaled(pose, 2.6 - 1.6 * easeInQuad(fs))
          pose.rotation = (r0 - 0.5) * 0.35 * (1 - fs)
          pose.alpha = clamp01(fs * 2.2)
        } else {
          var f2s = (q - STAMP_IMPACT) / (1 - STAMP_IMPACT)
          pose.scaleX = 1 + 0.22 * dampedCos(f2s, 17, 4)
          pose.scaleY = 1 - 0.22 * dampedCos(f2s, 17, 4)
        }
        break
      }
      case 'wave': {
        var kw = Math.pow(1 - q, 1.5)
        pose.dy = 1.1 * kw * Math.cos(q * Math.PI * 3)
        pose.rotation = 0.4 * kw * Math.sin(q * Math.PI * 3)
        pose.scaleY = 1 + 0.18 * kw * Math.sin(q * Math.PI * 3 + 0.6)
        pose.alpha = clamp01(q * 4)
        break
      }
      case 'zoom': {
        // 从镜头前（大、糊）拉回原位：离中心越远的字放大时甩得越远。
        var ez = easeOutExpo(q)
        var kz = 1.8 * (1 - ez)
        scaled(pose, 1 + kz * 1.5)
        pose.dx = -ctx.toCenterX * kz
        pose.dy = -ctx.toCenterY * kz
        pose.blur = Math.pow(1 - q, 1.4)
        pose.alpha = clamp01(q * 3.5)
        break
      }
      case 'burst': {
        // 从文字组中心炸开：冲过原位再回来，边飞边转。
        var eb = easeOutBack(q, 1.8)
        pose.dx = ctx.toCenterX * (1 - eb)
        pose.dy = ctx.toCenterY * (1 - eb)
        scaled(pose, 0.2 + 0.8 * easeOutBack(clamp01(q * 1.3), 1.6))
        pose.rotation = (r2 - 0.5) * 4 * (1 - easeOutCubic(q))
        pose.alpha = clamp01(q * 6)
        break
      }
    }
    return applyMotion(pose, ctx.motion)
  }

  /** 退场：p = 这个字的退场进度 0..1；p = 0 为静止姿态，p = 1 时 alpha 一定为 0。 */
  function exitPose(fx, p, ctx) {
    var pose = restPose()
    if (p <= 0) return pose
    var q = clamp01(p)
    var r0 = ctx.rand[0]
    var r1 = ctx.rand[1]
    var r2 = ctx.rand[2]
    switch (fx) {
      case 'ascend': {
        // 先轻轻下沉蓄力，再加速向上飞，纵向拉长。
        var e = easeInCubic(q)
        var dip = q < 0.22 ? Math.sin((q / 0.22) * Math.PI) * 0.12 : 0
        pose.dy = dip - 2.8 * e
        pose.dx = (r0 - 0.5) * 0.7 * e
        pose.rotation = (r1 - 0.5) * 0.5 * e
        pose.scaleY = 1 + 0.45 * e
        pose.scaleX = 1 - 0.22 * e
        pose.alpha = 1 - easeInQuad(q)
        break
      }
      case 'scatter': {
        // 以文字组中心向外散开，带随机偏转、旋转、缩小。
        var ox = -ctx.toCenterX + (r0 - 0.5) * 2
        var oy = -ctx.toCenterY + (r1 - 0.5) * 2
        var len = Math.hypot(ox, oy) || 1
        ox /= len
        oy /= len
        var eo = easeOutCubic(q)
        var dist = 2.4 + r2 * 1.8
        pose.dx = ox * dist * eo
        pose.dy = oy * dist * eo
        pose.rotation = (r1 - 0.5) * 3.2 * eo
        scaled(pose, 1 - 0.65 * eo)
        pose.alpha = 1 - Math.pow(q, 1.6)
        break
      }
      case 'shrink': {
        // 先鼓一下，再加速缩成点。
        var s = q < 0.2 ? 1 + 0.16 * Math.sin((q / 0.2) * Math.PI / 2) : 1.16 * (1 - easeInBack((q - 0.2) / 0.8, 1.4))
        scaled(pose, Math.max(0, s))
        pose.rotation = (r0 - 0.5) * 0.9 * q
        pose.alpha = q > 0.8 ? (1 - q) / 0.2 : 1
        break
      }
      case 'slide': {
        // 沿排版方向先回拉再甩出，越快拉得越长、越斜。
        var es = easeInBack(q, 1.6)
        var distSl = ctx.slideDistance === undefined ? 7 : ctx.slideDistance
        pose.dx = ctx.dirX * distSl * es
        pose.dy = ctx.dirY * distSl * es
        pose.scaleX = 1 + 0.45 * easeInQuad(q) * Math.abs(ctx.dirX)
        pose.scaleY = 1 + 0.45 * easeInQuad(q) * Math.abs(ctx.dirY)
        pose.skew = -0.45 * easeInQuad(q) * Math.sign(ctx.dirX || 1)
        pose.alpha = 1 - Math.pow(clamp01((q - 0.45) / 0.55), 1.5)
        break
      }
      case 'dissolve': {
        // 碎成火花：闪着淡出、略胀大上浮，重影发散（火花由 MG 在字心放）。
        var frame = Math.floor(ctx.time * 20)
        var flicker = hash01(frame, Math.floor(r0 * 1e6))
        pose.alpha = Math.pow(1 - q, 1.3) * (1 - 0.45 * q * flicker)
        scaled(pose, 1 + 0.14 * easeOutQuad(q))
        pose.dy = -0.35 * easeOutQuad(q)
        pose.blur = q
        break
      }
      case 'fall': {
        // 像柳火一样垂落：加速下坠、左右轻摆、拉长、慢慢淡掉。
        var ef = easeInQuad(q)
        pose.dy = 3 * ef
        pose.dx = 0.28 * Math.sin(q * Math.PI * 2 + r0 * 6) * q
        pose.rotation = (r1 - 0.5) * 1.2 * ef
        pose.scaleY = 1 + 0.4 * ef
        pose.scaleX = 1 - 0.25 * ef
        pose.alpha = 1 - Math.pow(q, 1.6)
        break
      }
      case 'blink': {
        // 亮—灭—亮—灭，亮的时间越来越短，最后熄灭。
        var on = q < 0.14 || (q >= 0.24 && q < 0.4) || (q >= 0.5 && q < 0.6) || (q >= 0.7 && q < 0.76) || (q >= 0.82 && q < 0.85)
        pose.alpha = on && q < 1 ? 1 : 0
        scaled(pose, 1 + (on ? 0.05 * q : 0))
        break
      }
    }
    if (q >= 1) pose.alpha = 0
    return applyMotion(pose, ctx.motion)
  }

  /** 强调：u = 被唱到后过了多少秒（< 0 为还没唱到），duration = 这个字被唱的时长。 */
  function singPose(fx, u, duration, rand, motion) {
    var pose = restSing()
    if (u < 0 || fx === 'none') return pose
    var hold = Math.max(duration, 0.12)
    // 唱的时候保持、唱完 0.35 秒内收起的包络。
    var envelope = clamp01(u / 0.08) * (1 - clamp01((u - hold) / 0.35))
    switch (fx) {
      case 'bounce': {
        var T = 0.3
        if (u < T) pose.dy = -0.26 * Math.sin((u / T) * Math.PI)
        else if (u < T + 0.16) pose.dy = -0.06 * Math.sin(((u - T) / 0.16) * Math.PI)
        var land = u - T
        if (land >= 0 && land < 0.3) {
          var f = land / 0.3
          pose.scaleY = 1 - 0.14 * dampedCos(f, 14, 3)
          pose.scaleX = 1 + 0.1 * dampedCos(f, 14, 3)
        } else if (u < T) {
          pose.scaleY = 1 + 0.08 * Math.sin((u / T) * Math.PI)
        }
        break
      }
      case 'flash': {
        pose.flash = Math.exp(-u / 0.16)
        pose.scale = 1 + 0.2 * Math.exp(-u / 0.1) * clamp01(u / 0.03)
        break
      }
      case 'swell': {
        pose.scale = 1 + 0.24 * easeOutBack(clamp01(u / 0.18), 2) * (1 - clamp01((u - hold) / 0.35))
        break
      }
      case 'shake': {
        var decay = Math.exp(-Math.max(0, u - hold) / 0.08)
        var k = clamp01(u / 0.04) * decay * (u < hold + 0.4 ? 1 : 0)
        pose.dx = 0.06 * Math.sin(u * 61 + rand * 9) * k
        pose.dy = 0.04 * Math.sin(u * 47 + rand * 5) * k
        pose.rotation = 0.08 * Math.sin(u * 53 + rand * 7) * k
        break
      }
      case 'jump': {
        var Tj = 0.42
        if (u < Tj) {
          var fj = u / Tj
          pose.dy = -0.5 * Math.sin(fj * Math.PI)
          pose.rotation = (rand < 0.5 ? 1 : -1) * 0.22 * Math.sin(fj * Math.PI * 2) * (1 - fj)
          pose.scaleY = 1 + 0.2 * Math.sin(fj * Math.PI) * (1 - fj)
          pose.scaleX = 1 - 0.12 * Math.sin(fj * Math.PI) * (1 - fj)
        } else if (u < Tj + 0.35) {
          var f2j = (u - Tj) / 0.35
          pose.scaleY = 1 - 0.2 * dampedCos(f2j, 13, 3)
          pose.scaleX = 1 + 0.16 * dampedCos(f2j, 13, 3)
        }
        break
      }
      case 'glow': {
        pose.glow = envelope
        pose.flash = 0.35 * envelope
        pose.scale = 1 + 0.07 * envelope
        break
      }
      case 'underline': {
        // 下划线由文字引擎单独画；字本身只轻轻抬起。
        pose.dy = -0.05 * envelope
        break
      }
      case 'color': {
        pose.color = clamp01(u / 0.1)
        pose.scale = 1 + 0.14 * Math.exp(-u / 0.12) * clamp01(u / 0.03)
        break
      }
    }
    if (motion !== 1) {
      pose.dx *= motion
      pose.dy *= motion
      pose.rotation *= motion
      pose.scale = 1 + (pose.scale - 1) * motion
      pose.scaleX = 1 + (pose.scaleX - 1) * motion
      pose.scaleY = 1 + (pose.scaleY - 1) * motion
    }
    return pose
  }

  /** 叠加：enter ∘ exit（位移相加、缩放相乘、透明度相乘，特殊字段取非静止的一方）。结果写进 out。 */
  function combinePoses(a, b, out) {
    if (out === undefined) out = restPose()
    out.dx = a.dx + b.dx
    out.dy = a.dy + b.dy
    out.scaleX = a.scaleX * b.scaleX
    out.scaleY = a.scaleY * b.scaleY
    out.rotation = a.rotation + b.rotation
    out.alpha = a.alpha * b.alpha
    out.skew = a.skew + b.skew
    out.scramble = a.scramble >= 0 ? a.scramble : b.scramble
    out.rgbSplit = a.rgbSplit + b.rgbSplit
    out.blur = Math.max(a.blur, b.blur)
    out.split = Math.max(a.split, b.split)
    out.backside = a.backside || b.backside
    out.reveal = Math.min(a.reveal, b.reveal)
    return out
  }

  // ─── 时间表 ────────────────────────────────────────────────────────────

  // 入场时间表形状（EnterSchedule）：{ start（每个字入场开始的时刻，空白字为 NaN）,
  //   duration（每个字入场的时长，压缩后）, landed（每个字入场完成的时刻）}

  /** 入场的先后次序：阅读顺序；scramble / glitch 打乱；zoom / burst 从中间往两边。 */
  function enterOrder(fx, count, rand) {
    var order = []
    for (var i = 0; i < count; i += 1) order.push(i)
    if (fx === 'scramble' || fx === 'glitch') {
      for (var n = count - 1; n > 0; n -= 1) {
        var j = Math.floor(rand() * (n + 1))
        var tmp = order[n]
        order[n] = order[j]
        order[j] = tmp
      }
      // order[k] = 第 k 个出场的字 → 转成「第 i 个字排第几」。
      var rank = new Array(count)
      order.forEach(function (glyph, k) { rank[glyph] = k })
      return rank
    }
    if (fx === 'zoom' || fx === 'burst') {
      var mid = (count - 1) / 2
      return order.map(function (index) { return Math.round(Math.abs(index - mid) * 2) / 2 })
    }
    return order
  }

  /** 每种入场的 stagger 倍率：burst 几乎同时炸开，stamp 一个一个砸得慢一点。 */
  var STAGGER_FACTOR = { burst: 0.35, zoom: 0.6, stamp: 1.35, type: 1 }

  /**
   * 入场时间表。ranks[i] = 第 i 个字的出场名次（空白字为 -1，名次可以并列）。
   * 最后一个字入场完成不晚于 deadline（该行第一个被唱的字）：先压缩 stagger，还不够再压缩单字时长（不短于 0.1 秒）。
   */
  function scheduleEnter(fx, ranks, enterAt, stagger, deadline) {
    var maxRank = ranks.reduce(function (max, rank) { return Math.max(max, rank) }, 0)
    var factor = STAGGER_FACTOR[fx] !== undefined ? STAGGER_FACTOR[fx] : 1
    var step = Math.max(0, stagger) * factor
    var duration = ENTER_DURATION[fx]
    var available = deadline - enterAt
    if (step * maxRank + duration > available) {
      step = maxRank > 0 ? Math.max(0, Math.min(step, (available - duration) / maxRank)) : 0
      if (step * maxRank + duration > available) {
        // stagger 也压到能压的程度：单字时长与间隔按比例一起缩。
        var ratio = Math.max(0, available) / (step * maxRank + duration)
        step *= ratio
        duration = Math.max(0.1, duration * ratio)
        if (step * maxRank + duration > available) step = maxRank > 0 ? Math.max(0, (available - duration) / maxRank) : 0
      }
    }
    var start = ranks.map(function (rank) { return rank < 0 ? Number.NaN : enterAt + rank * step })
    return { start: start, duration: duration, landed: start.map(function (value) { return value + duration }) }
  }

  // 退场时间表形状（ExitSchedule）：{ start, end }。

  /** 退场时间表：逐字错开，全部在 exitAt + exitDuration 前走完。 */
  function scheduleExit(ranks, exitAt, exitDuration) {
    var maxRank = ranks.reduce(function (max, rank) { return Math.max(max, rank) }, 0)
    var total = Math.max(0.001, exitDuration)
    var step = maxRank > 0 ? Math.min(0.05, (total * 0.4) / maxRank) : 0
    var each = total - step * maxRank
    var start = ranks.map(function (rank) { return rank < 0 ? Number.NaN : exitAt + rank * step })
    return { start: start, end: start.map(function (value) { return value + each }) }
  }

  /** stamp 落定时整组的震动（像素）。impacts = 各次砸落的时刻；amplitude = 振幅（像素）。 */
  function stampShake(time, impacts, amplitude) {
    var x = 0
    var y = 0
    for (var i = 0; i < impacts.length; i += 1) {
      var tau = time - impacts[i]
      if (tau < 0 || tau > 0.45) continue
      var k = amplitude * Math.exp(-tau / 0.085)
      x += k * Math.sin(tau * 96 + i * 1.7)
      y += k * 0.8 * Math.sin(tau * 77 + i * 2.3 + 1)
    }
    return { x: x, y: y }
  }

  window.FoliaHanabiTextAnimations = {
    ENTER_FX: ENTER_FX,
    SING_FX: SING_FX,
    EXIT_FX: EXIT_FX,
    ENTER_DURATION: ENTER_DURATION,
    ENTER_ARRIVAL: ENTER_ARRIVAL,
    STAMP_IMPACT: STAMP_IMPACT,
    clamp01: clamp01,
    easeInOutCubic: easeInOutCubic,
    hash01: hash01,
    restPose: restPose,
    restSing: restSing,
    enterPose: enterPose,
    exitPose: exitPose,
    singPose: singPose,
    combinePoses: combinePoses,
    enterOrder: enterOrder,
    scheduleEnter: scheduleEnter,
    scheduleExit: scheduleExit,
    stampShake: stampShake
  }
})()
