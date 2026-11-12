// 花火（hanabi）MG 装饰件入口 + MG 共享纯数学：移植自 folia-major src/components/visualizer/hanabi/mg/ornaments.ts + mgMath.ts
//
// MG 装饰件入口：按 OrnamentKind 选实现，统一处理可见时间窗（入场前、退场后整件隐藏、不更新）。
// 坐标与文字视图的本地坐标一致；placement = 'screen' 时假设文字区中心大致在画面中心（多铺 10% 兜住偏移）。
//
// mgMath.ts（原样并入本文件，挂 window.FoliaHanabiOrnaments.Math，给后面的 collage / text / scene 各批消费）：
// MG 部件库共用的纯数学：钳制、缓动（过冲 / 弹簧 / 阶梯）、确定性噪声、颜色混合、字符串散列。不碰 Pixi。
// 加载顺序在本文件之前的 burstPlan / ambient / ornamentKit / ornamentLines / ornamentParticles / ornamentShapes
// 各自按同一套公式内联了自己用到的几个（文件头有注），保证可独立加载；公式改动要两边同步。
(function () {
  'use strict'

  var Kit = window.FoliaHanabiOrnamentsKit
  var Lines = window.FoliaHanabiOrnamentsLines
  var Particles = window.FoliaHanabiOrnamentsParticles
  var Shapes = window.FoliaHanabiOrnamentsShapes

  // ---------- MG 共享纯数学（原版 mg/mgMath.ts，正主） ----------
  var TAU = Math.PI * 2

  var clamp01 = function (value) { return value <= 0 ? 0 : value >= 1 ? 1 : value }
  var clamp = function (value, low, high) { return value < low ? low : value > high ? high : value }
  var lerp = function (a, b, t) { return a + (b - a) * t }
  var fract = function (value) { return value - Math.floor(value) }
  /** 落在 [0, span) 里的取模（负数也对）。 */
  var wrap = function (value, span) { return value - span * Math.floor(value / span) }

  var easeOutQuad = function (t) { return 1 - Math.pow(1 - clamp01(t), 2) }
  var easeOutCubic = function (t) { return 1 - Math.pow(1 - clamp01(t), 3) }
  var easeInCubic = function (t) { return Math.pow(clamp01(t), 3) }
  var easeInQuad = function (t) { return Math.pow(clamp01(t), 2) }
  var easeInOutCubic = function (t) {
    var x = clamp01(t)
    return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2
  }
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
  /** 阶梯：把 0..1 量化成 steps 级（MG 的「一拍一格」）。 */
  var stepped = function (t, steps) { return Math.min(1, Math.floor(clamp01(t) * steps) / steps) }
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

  // ---------- 装饰件分发（原版 ornaments.ts） ----------

  var ORNAMENT_BUILDERS = {
    ring: Shapes.ringOrnament,
    spokes: Shapes.spokesOrnament,
    sparkle: Particles.sparkleOrnament,
    orbit: Shapes.orbitOrnament,
    chevrons: Particles.chevronsOrnament,
    brackets: Shapes.bracketsOrnament,
    cross: Particles.crossOrnament,
    zigzag: Lines.zigzagOrnament,
    wave: Lines.waveOrnament,
    halftone: Shapes.halftoneOrnament,
    confetti: Particles.confettiOrnament,
    shards: Particles.shardsOrnament,
    'dash-circle': Shapes.dashCircleOrnament,
    squares: Shapes.squaresOrnament,
    streaks: Particles.streaksOrnament,
    petals: Particles.petalsOrnament,
    stamp: Shapes.stampOrnament,
    rays: Shapes.raysOrnament,
    underline: Lines.underlineOrnament,
    'dots-line': Lines.dotsLineOrnament,
    glints: Particles.glintsOrnament
  }

  /** 建一个装饰件。spec：OrnamentSpec { kind, placement, density, scale, color, delay, layer }；ctx：OrnamentContext。 */
  function createOrnament(spec, context) {
    var kit = Kit.createKit(spec, context)
    var empty = context.amount <= 0
    var draw = empty ? null : ORNAMENT_BUILDERS[spec.kind](kit)
    // 跟字触发的件可能比 enterAt + delay 更早（delay 为负）或更晚开始：以两者中较早的为窗口起点。
    var firstSung = kit.glyphs.reduce(function (min, glyph) { return Math.min(min, glyph.sungAt) }, Number.POSITIVE_INFINITY)
    var from = Math.min(kit.start, firstSung) - 0.05
    var update = function (time) {
      var visible = draw !== null && time >= from && time <= kit.end
      kit.view.visible = visible
      if (visible) draw(time)
    }
    return {
      view: kit.view,
      update: update,
      destroy: function () {
        // Pixi v8 销毁纪律（PORTING.md）：逐节点无参 destroy（上游写 destroy({ children: true, context: true })——
        // kit 自建的共享 GraphicsContext 由 view 的 'destroyed' 监听销毁，Graphics 自建的 context 由各自的无参 destroy 销毁）。
        window.FoliaHanabiBloom.destroyPixiDisplayTree(kit.view)
      }
    }
  }

  window.FoliaHanabiOrnaments = {
    Math: {
      TAU: TAU,
      clamp01: clamp01,
      clamp: clamp,
      lerp: lerp,
      fract: fract,
      wrap: wrap,
      easeOutQuad: easeOutQuad,
      easeOutCubic: easeOutCubic,
      easeInCubic: easeInCubic,
      easeInQuad: easeInQuad,
      easeInOutCubic: easeInOutCubic,
      easeOutExpo: easeOutExpo,
      easeOutBack: easeOutBack,
      easeInBack: easeInBack,
      spring: spring,
      stepped: stepped,
      beatSteps: beatSteps,
      hash01: hash01,
      hashString: hashString,
      mixColor: mixColor,
      WHITE: WHITE,
      GOLD: GOLD,
      EMBER: EMBER
    },
    ORNAMENT_BUILDERS: ORNAMENT_BUILDERS,
    createOrnament: createOrnament
  }
})()
