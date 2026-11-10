// 町景在智能动感模式里的三个效果（移植自 engine/beatFx.ts，纯函数，不碰 three）：
//   霓虹随拍 <- 整张节拍表：招牌霓虹分成三组，每拍轮到下一组，那组慢慢亮起、再慢慢暗下，此起彼伏；
//               店里的灯、亮窗只在小节第一拍慢慢涨落一点；bloom 跟三组的平均走。
//   鼓点涟漪 <- 底鼓：每下底鼓从歌词屏脚下在湿地面上荡开一圈涟漪，最多同时四圈；地面干时改成光斑跳一下。
//   大屏闪拍 <- 军鼓：每下够响的军鼓在歌词屏的一处慢慢亮起、再慢慢暗下，先后几下左右错开。
// 拍点、鼓点都按听到的时间取，画面只由时间决定。效果关着、拍点/鼓点还没准备好时得到常态值。
// 没开智能动感模式时，霓虹随拍和大屏闪拍改由固定节拍驱动（MACHI_BEAT.steady）。
// 节拍表 / 鼓点 / 重音增益由共享的 window.FoliaBeatFx 提供（主程序频谱实时检测，任务3接线）。
(function () {
  'use strict'

  function beatFx() { return window.FoliaBeatFx || null }

  /** 霓虹分几组轮流。 */
  var MACHI_NEON_GROUPS = 3

  /** 调好的样子（各效果强度 1 时）。 */
  var MACHI_BEAT = {
    neon: { attack: 0.4, fall: 1.5, lift: 0.2, contrast: 0.2, downbeat: 1.2 },
    lightbox: 0.3,
    warm: { attack: 0.6, fall: 2.2, lift: 0.08 },
    bloom: 0.1,
    ripple: { speed: 6.5, life: 1.3, max: 4, floor: 0.3, gap: 0.33, thump: 0.55, thumpDecay: 0.14, wet: [0.1, 0.6] },
    screen: { attack: 0.25, fall: 1.15, max: 4, floor: 0.4, gap: 0.35 },
    steady: { period: 0.75, beatsPerBar: 4, neon: 0.8, screen: 0.6 }
  }

  function createMachiBeatFrame() {
    return {
      neonGroups: new Float32Array(MACHI_NEON_GROUPS).fill(1),
      neon: 1,
      warm: 1,
      bloom: 1,
      thump: 0,
      swellAt: new Float32Array(MACHI_BEAT.screen.max).fill(0.5),
      swellAmp: new Float32Array(MACHI_BEAT.screen.max)
    }
  }

  /** 改回常态（就地，每帧复用）。 */
  function resetMachiBeatFrame(out) {
    out.neonGroups.fill(1)
    out.neon = 1
    out.warm = 1
    out.bloom = 1
    out.thump = 0
    out.swellAt.fill(0.5)
    out.swellAmp.fill(0)
    return out
  }

  /** 第 group 组招牌霓虹的亮度倍数。 */
  function machiNeonGroup(beat, group) { return beat.neonGroups[group % MACHI_NEON_GROUPS] }

  /** 第 group 组近白的招牌灯箱：霓虹那一路的一小份。 */
  function machiLightboxGroup(beat, group) {
    return 1 + MACHI_BEAT.lightbox * (machiNeonGroup(beat, group) - 1)
  }

  /** 慢慢亮起、再慢慢暗下的一下（0..1）：前 attack 秒升上去，后 fall 秒落回来，两头都是缓的。 */
  function machiSwell(age, attack, fall) {
    if (age < 0 || age >= attack + fall) return 0
    if (age < attack) {
      var u = age / attack
      return u * u * (3 - 2 * u)
    }
    var v = (age - attack) / fall
    return 1 - v * v * (3 - 2 * v)
  }

  /** 路面有多湿就有多少涟漪（0..1，与地面着色器里的 smoothstep 一样）；剩下的给光斑的一跳。 */
  function machiRippleWetness(wetness) {
    var from = MACHI_BEAT.ripple.wet[0]
    var to = MACHI_BEAT.ripple.wet[1]
    var t = Math.min(1, Math.max(0, (wetness - from) / (to - from)))
    return t * t * (3 - 2 * t)
  }

  /** 升序列表里最后一个 ≤ time 的下标；没有就 -1。 */
  function lastAtOrBefore(count, at, time) {
    var low = 0
    var high = count
    while (low < high) {
      var middle = (low + high) >> 1
      if (at(middle) <= time) low = middle + 1
      else high = middle
    }
    return low - 1
  }

  /** 每组这一刻有多亮（0..），每帧复用。 */
  var groupSwells = new Float32Array(MACHI_NEON_GROUPS)

  /** 霓虹那一路的寿命：一拍的余光与小节第一拍的暖光取长的那个。 */
  function neonLife() {
    return Math.max(MACHI_BEAT.neon.attack + MACHI_BEAT.neon.fall, MACHI_BEAT.warm.attack + MACHI_BEAT.warm.fall)
  }

  /** 把一拍叠进 groupSwells：第 index 拍轮到 index % 组数 那组，过了 age 秒；返回这拍给店里暖灯的量。 */
  function addNeonBeat(index, age, gain, tone, downbeat) {
    var neon = MACHI_BEAT.neon
    var warm = MACHI_BEAT.warm
    var neonTone = tone ? Math.max(0, 0.4 + 0.9 * (tone.mid + tone.high)) : 1
    var group = index % MACHI_NEON_GROUPS
    var swell = gain * neonTone * (downbeat ? neon.downbeat : 1) * machiSwell(age, neon.attack, neon.fall)
    groupSwells[group] = Math.max(groupSwells[group], swell)
    if (!downbeat) return 0
    var warmTone = tone ? Math.max(0, 0.4 + 1.8 * tone.low) : 1
    return gain * warmTone * machiSwell(age, warm.attack, warm.fall)
  }

  /** 按 groupSwells 与暖灯的量写出这一帧。 */
  function writeNeonFrame(strength, bar, out) {
    var neon = MACHI_BEAT.neon
    var warm = MACHI_BEAT.warm
    var mean = 0
    for (var group = 0; group < MACHI_NEON_GROUPS; group += 1) mean += groupSwells[group]
    mean /= MACHI_NEON_GROUPS
    for (var g = 0; g < MACHI_NEON_GROUPS; g += 1) {
      var swell = groupSwells[g]
      out.neonGroups[g] = Math.max(0, 1 + strength * (neon.lift * swell + neon.contrast * (swell - mean)))
    }
    out.neon = 1 + strength * neon.lift * mean
    out.warm = 1 + strength * warm.lift * bar
    out.bloom = 1 + strength * MACHI_BEAT.bloom * mean
    return out
  }

  function resetNeon(out) {
    out.neonGroups.fill(1)
    out.neon = 1
    out.warm = 1
    out.bloom = 1
  }

  /** 霓虹随拍：events 是整张节拍表（升序），按它在表里的序号轮到第几组。 */
  function resolveMachiNeonPulse(events, time, strength, trackScale, out) {
    resetNeon(out)
    if (!events || !events.length || strength <= 0) return out
    var fx = beatFx()
    var life = neonLife()
    groupSwells.fill(0)
    var bar = 0
    var lastIndex = lastAtOrBefore(events.length, function (at) { return events[at].t }, time)
    for (var index = lastIndex; index >= 0; index -= 1) {
      var event = events[index]
      var age = time - event.t
      if (age >= life) break
      var gain = fx ? fx.resolveAccentGain(event, trackScale) : 0
      if (gain <= 0) continue
      bar = Math.max(bar, addNeonBeat(index, age, gain, event.tone, event.kind === 'downbeat'))
    }
    return writeNeonFrame(strength, bar, out)
  }

  /** 没开智能动感模式时的霓虹随拍：第 k 拍在 k × period 秒，每 beatsPerBar 拍一个小节第一拍。 */
  function resolveMachiSteadyNeonPulse(time, strength, out) {
    resetNeon(out)
    if (strength <= 0 || time < 0) return out
    var steady = MACHI_BEAT.steady
    var life = neonLife()
    groupSwells.fill(0)
    var bar = 0
    for (var index = Math.floor(time / steady.period); index >= 0; index -= 1) {
      var age = time - index * steady.period
      if (age >= life) break
      bar = Math.max(bar, addNeonBeat(index, age, 1, undefined, index % steady.beatsPerBar === 0))
    }
    return writeNeonFrame(strength * steady.neon, bar, out)
  }

  /** 鼓点在 time 处还有效：分离还没做完的歌，until 之后的鼓点还不知道。 */
  function machiDrumHitsAt(hits, time) {
    return hits && (hits.until === undefined || time < hits.until) ? hits : null
  }

  /**
   * kind 的鼓点里挑哪几下：够响（≥ floor）、离上一个挑中的够远。从头往后挑，与画哪一帧无关。
   * 每份鼓点只挑一次（插件实时检测的鼓点每次交来的是新的一份，缓存按对象身份）。
   */
  var pickedCache = new WeakMap()
  function pickedDrumHits(hits, kind, floor, gap) {
    var byRule = pickedCache.get(hits)
    if (!byRule) { byRule = new Map(); pickedCache.set(hits, byRule) }
    var rule = kind + ':' + floor + ':' + gap
    var picked = byRule.get(rule)
    if (!picked) {
      picked = new Uint8Array(hits.times.length)
      var previous = -Infinity
      for (var index = 0; index < hits.times.length; index += 1) {
        var hitAt = hits.times[index]
        if (hits.kinds[index] !== kind || hits.strengths[index] < floor || hitAt - previous < gap) continue
        previous = hitAt
        picked[index] = 1
      }
      byRule.set(rule, picked)
    }
    return picked
  }

  /** 挑中的鼓点里到 time 还活着（< life）的那几下：下标环形写进 kept（只留最新的）。 */
  function pickDrumHits(hits, time, kind, floor, gap, life, kept) {
    var picked = pickedDrumHits(hits, kind, floor, gap)
    var at = function (index) { return hits.times[index] }
    var last = lastAtOrBefore(hits.times.length, at, time)
    var count = 0
    for (var index = lastAtOrBefore(hits.times.length, at, time - life) + 1; index <= last; index += 1) {
      if (!picked[index]) continue
      kept[count % kept.length] = index
      count += 1
    }
    return count
  }

  /** 涟漪、大屏亮起的那几下（每帧复用）。 */
  var keptKicks = new Int32Array(MACHI_BEAT.ripple.max)
  var keptSnares = new Int32Array(MACHI_BEAT.screen.max)

  /** 鼓点涟漪：time 之前、还活着的几圈（最新的在前）。rings 是 [年龄, 幅度] × max 的扁平数组。返回地面干时光斑的那一跳。 */
  function resolveMachiDrumRipples(hits, time, strength, rings) {
    var ripple = MACHI_BEAT.ripple
    for (var slot = 0; slot < ripple.max; slot += 1) {
      rings[slot * 2] = -1
      rings[slot * 2 + 1] = 0
    }
    if (!hits || strength <= 0) return 0
    var fx = beatFx()
    var count = pickDrumHits(hits, time, fx ? fx.DRUM_KICK : 0, ripple.floor, ripple.gap, ripple.life, keptKicks)
    var pulse = 0
    for (var s = 0; s < Math.min(count, ripple.max); s += 1) {
      var hit = keptKicks[(count - 1 - s) % ripple.max]
      var age = time - hits.times[hit]
      var amp = strength * hits.strengths[hit]
      rings[s * 2] = age
      rings[s * 2 + 1] = amp
      pulse = Math.max(pulse, ripple.thump * amp * Math.exp(-age / ripple.thumpDecay))
    }
    return pulse
  }

  /** 大屏闪拍：还亮着的几下军鼓各在屏上的哪、多亮（写进 out.swellAt / swellAmp，最新的在前）。 */
  function resolveMachiScreenFlash(hits, time, strength, out) {
    out.swellAt.fill(0.5)
    out.swellAmp.fill(0)
    if (!hits || strength <= 0) return out
    var screen = MACHI_BEAT.screen
    var fx = beatFx()
    var count = pickDrumHits(hits, time, fx ? fx.DRUM_SNARE : 1, screen.floor, screen.gap, screen.attack + screen.fall, keptSnares)
    for (var slot = 0; slot < Math.min(count, screen.max); slot += 1) {
      var hit = keptSnares[(count - 1 - slot) % screen.max]
      out.swellAt[slot] = machiSwellPlace(hit)
      out.swellAmp[slot] = strength * hits.strengths[hit] * machiSwell(time - hits.times[hit], screen.attack, screen.fall)
    }
    return out
  }

  /** 第 index 下在屏上的位置（0..1）：黄金分割步进，先后几下左右错开。 */
  function machiSwellPlace(index) { return 0.15 + 0.7 * ((index * 0.618034) % 1) }

  /** 没开智能动感模式时的大屏闪拍：每小节第二、四拍亮一处。 */
  function resolveMachiSteadyScreenFlash(time, strength, out) {
    out.swellAt.fill(0.5)
    out.swellAmp.fill(0)
    if (strength <= 0) return out
    var screen = MACHI_BEAT.screen
    var steady = MACHI_BEAT.steady
    var every = steady.period * 2
    var slot = 0
    for (var index = Math.floor((time - steady.period) / every); index >= 0 && slot < screen.max; index -= 1) {
      var age = time - (index * every + steady.period)
      if (age >= screen.attack + screen.fall) break
      out.swellAt[slot] = machiSwellPlace(index)
      out.swellAmp[slot] = strength * steady.screen * machiSwell(age, screen.attack, screen.fall)
      slot += 1
    }
    return out
  }

  window.FoliaMachiBeatFx = {
    MACHI_NEON_GROUPS: MACHI_NEON_GROUPS,
    MACHI_BEAT: MACHI_BEAT,
    createMachiBeatFrame: createMachiBeatFrame,
    resetMachiBeatFrame: resetMachiBeatFrame,
    machiNeonGroup: machiNeonGroup,
    machiLightboxGroup: machiLightboxGroup,
    machiSwell: machiSwell,
    machiRippleWetness: machiRippleWetness,
    resolveMachiNeonPulse: resolveMachiNeonPulse,
    resolveMachiSteadyNeonPulse: resolveMachiSteadyNeonPulse,
    machiDrumHitsAt: machiDrumHitsAt,
    resolveMachiDrumRipples: resolveMachiDrumRipples,
    resolveMachiScreenFlash: resolveMachiScreenFlash,
    resolveMachiSteadyScreenFlash: resolveMachiSteadyScreenFlash
  }
})()
