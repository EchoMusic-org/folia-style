// 花火（hanabi）时间线：移植自 folia-major src/components/visualizer/hanabi/timeline.ts
// 一个场景单元的时间安排（纯数据）：每个镜头的文字入场 / 退场、升空尾迹、世界上升 rise(t)、世界旋转 spin(t) 与镜头内运镜。
// 全部只由 t 决定（docs/HANABI.md「上升」）。
// 输入形状（上游接口）：
//   TimelineShot = { startTime, endTime, firstSung, lastSungEnd, isBridge, camera: { rise, push, roll, punch } }
//   ShotTiming   = { start, end, worldY, launchAt, enterAt, exitAt, exitDuration, punchAt, riseIn, drift, spin, spinDrift }
//   CameraOffset = { scale, rotation, dx, dy }
//   Timeline     = { shots, rise(time), spin(time), shotAt(time), camera(time) }
(function () {
  'use strict'

  /** 边界前后上升的时长上限（秒）。 */
  var RISE_BEFORE = 0.6
  var RISE_AFTER = 0.6
  /** 升空尾迹飞行时长。 */
  var LAUNCH_DURATION = 0.45
  /** 文字入场比第一个字被唱到提前多少秒。 */
  var ENTER_LEAD = 0.4
  /** 镜头内上漂：每秒约 3% 画面高度，整个镜头最多 15%。 */
  var DRIFT_PER_SECOND = 0.03
  var DRIFT_MAX = 0.15
  /** 镜头之间的快转、上升的缓急：速度曲线是 (1 − u²)^n 的圆顶鼓包，n 越大两头越缓、中间甩得越快。 */
  var SWING_SHARPNESS = 4
  /** 入场震动起势的时长（秒）：几帧之内震起来，不在一帧里跳。 */
  var PUNCH_ATTACK = 0.05

  /** 镜头内一直在转的角速度上限（弧度 / 秒，约 11°/秒）与一个镜头里慢转最多转过的角度（约 49°）。 */
  var SPIN_CRUISE = 0.2
  var SPIN_CRUISE_TOTAL = 0.85
  /** 边界快转在慢转之外再转过的角度：0.6–1.4 弧度（约 34°–80°）。 */
  var SPIN_SWING_MIN = 0.6
  var SPIN_SWING_RANGE = 0.8
  /** 每个边界换向的概率。反着转时每个边界一半概率转回来，单元最后一个镜头一定转回起转的方向。 */
  var SPIN_FLIP = 0.2

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value))
  }
  function smooth(value) {
    var t = clamp(value, 0, 1)
    return t * t * (3 - 2 * t)
  }
  /**
   * 七次 smootherstep：两端速度、加速度、加加速度都为 0，速度曲线是一个圆顶的鼓包（140·t³(1 − t)³），中间没有折点。
   * 拿它在两段运动之间过渡，接缝处位置、速度、加速度都连续；easeInOutCubic 与三次贝塞尔缓动都做不到这一点
   * （前者中点处加速度从 +12 跳到 −12，后者两端加速度不为 0）。
   */
  function easeSeptic(value) {
    var t = clamp(value, 0, 1)
    return Math.pow(t, 4) * (35 + t * (-84 + t * (70 - 20 * t)))
  }
  /** easeSeptic 从 0 积到 t（t ∈ [0, 1]），积到 1 是 1/2。 */
  function easeSepticIntegral(t) {
    return Math.pow(t, 5) * (7 + t * (-14 + t * (10 - 2.5 * t)))
  }

  function binomial(n, k) {
    var result = 1
    for (var i = 1; i <= k; i += 1) result = (result * (n - k + i)) / i
    return result
  }
  /** (1 − u²)^n 的原函数：Σ C(n, k)(−1)^k u^(2k+1) / (2k + 1)。 */
  var SWING_TERMS = []
  for (var swingK = 0; swingK <= SWING_SHARPNESS; swingK += 1) {
    SWING_TERMS.push((binomial(SWING_SHARPNESS, swingK) * (swingK % 2 === 0 ? 1 : -1)) / (2 * swingK + 1))
  }
  function swingPrimitive(u) {
    var u2 = u * u
    var power = u
    var sum = 0
    for (var i = 0; i < SWING_TERMS.length; i += 1) {
      sum += SWING_TERMS[i] * power
      power *= u2
    }
    return sum
  }
  var SWING_HALF = swingPrimitive(1)
  /**
   * 镜头之间的过渡缓动：速度是 (1 − u²)^SWING_SHARPNESS 的圆顶鼓包——起步与落定又缓又稳（两端速度、加速度都为 0），
   * 中间一下甩过去，像 MG 里拉满影响度的缓入缓出，但接缝处不会顿一下。
   */
  function easeSwing(value) {
    return 0.5 + swingPrimitive(2 * clamp(value, 0, 1) - 1) / (2 * SWING_HALF)
  }

  /**
   * 一个单元的世界旋转安排：每个镜头中点时转到的角度（第一个为 0）与镜头内慢转的角速度，都乘 amount（tuning.spin）。
   * 镜头内一直按 SPIN_CRUISE 慢转（镜头越长越慢，一个镜头最多转 SPIN_CRUISE_TOTAL）；相邻两个中点之间的角度差
   * = 两边各半个镜头的慢转 + 边界快转再甩过去的 SPIN_SWING。从 direction 起转，偶尔换向，单元结束前一定转回来，
   * 所以段落之间接上的总是同一个方向。
   * durations：各镜头时长（秒）；options：{ amount, direction, random }。
   */
  function planSpin(durations, options) {
    var angles = []
    var drift = []
    var direction = options.direction
    durations.forEach(function (duration, index) {
      if (index > 0) {
        var last = index === durations.length - 1
        var roll = options.random()
        var reversed = direction !== options.direction
        if (reversed ? (last || roll < 0.5) : (!last && roll < SPIN_FLIP)) direction = -direction
      }
      var cruise = direction * options.amount * Math.min(SPIN_CRUISE, SPIN_CRUISE_TOTAL / Math.max(duration, 0.5))
      drift.push(cruise)
      if (index === 0) {
        angles.push(0)
        return
      }
      var swing = direction * options.amount * (SPIN_SWING_MIN + SPIN_SWING_RANGE * options.random())
      angles.push(angles[index - 1] + (drift[index - 1] * durations[index - 1] + cruise * duration) / 2 + swing)
    })
    return { angles: angles, drift: drift }
  }

  /** 可选数组的第 index 项，缺省为 0。 */
  function optionalAt(list, index) {
    if (!list) return 0
    var value = list[index]
    return value === undefined || value === null ? 0 : value
  }

  /**
   * 一个单元的时间线。shots：TimelineShot 数组；options：
   *   unitStart / unitEnd：单元的起止时刻；height：画面高（像素）；
   *   riseSpeed：tuning.riseSpeed；motion：震动 / 摆动幅度倍率（主题的动画强度）；
   *   exitStart：段落出场转场开始的时刻（最后一个镜头的字在这之后退场）；没有转场时字留到单元结束；
   *   spinAngles：各镜头中点时世界转过的角度（弧度，累积，第一个为 0）；不给不转；
   *   spinDrift：各镜头内慢转的角速度（弧度 / 秒，带方向）；不给为 0。
   */
  function buildTimeline(shots, options) {
    var height = options.height
    var riseSpeed = options.riseSpeed
    var motion = options.motion
    var count = shots.length
    var durationOf = function (index) {
      return Math.max(shots[index].endTime - shots[index].startTime, 0.05)
    }
    // 边界 i（镜头 i-1 → i）的上升窗口：前后各不超过 0.6 秒，也不吃掉两边镜头太多。
    var before = shots.map(function (_, index) {
      return index === 0 ? 0 : Math.min(RISE_BEFORE, 0.45 * durationOf(index - 1))
    })
    var after = shots.map(function (_, index) {
      return index === 0 ? 0 : Math.min(RISE_AFTER, 0.35 * durationOf(index))
    })

    var timings = []
    var worldY = 0
    shots.forEach(function (shot, index) {
      if (index > 0) worldY -= clamp(shot.camera.rise, 0, 1.2) * riseSpeed * height
      var boundary = shot.startTime
      var sung = shot.firstSung !== undefined && shot.firstSung !== null ? shot.firstSung : boundary
      var enterAt = shot.isBridge ? boundary : Math.min(boundary, sung) - ENTER_LEAD
      if (index > 0) enterAt = Math.max(enterAt, boundary - before[index], timings[index - 1].enterAt + 0.1)
      var duration = durationOf(index)
      timings.push({
        start: shot.startTime,
        end: shot.endTime,
        worldY: worldY,
        launchAt: enterAt - LAUNCH_DURATION,
        enterAt: enterAt,
        exitAt: 0,
        exitDuration: 0,
        punchAt: enterAt + 0.08,
        riseIn: index === 0 ? null : { from: boundary - before[index], to: boundary + after[index] },
        drift: riseSpeed * height * Math.min(DRIFT_PER_SECOND, DRIFT_MAX / duration),
        spin: optionalAt(options.spinAngles, index),
        spinDrift: optionalAt(options.spinDrift, index)
      })
    })

    // 退场：在下一个边界的上升里（最后一个唱完之后、边界前 0.15 秒之前开始），最后一个镜头在单元末尾。
    timings.forEach(function (timing, index) {
      var shot = shots[index]
      var sungEnd = shot.lastSungEnd !== undefined && shot.lastSungEnd !== null ? shot.lastSungEnd : timing.end
      var exitAt
      var exitDuration
      if (index < count - 1) {
        var boundary = timing.end
        exitAt = clamp(sungEnd, boundary - before[index + 1], boundary - 0.15)
        exitDuration = clamp(boundary + after[index + 1] - exitAt, 0.35, 0.9)
      } else if (options.exitStart !== undefined && options.exitStart !== null) {
        exitAt = Math.min(Math.max(sungEnd, options.exitStart), options.unitEnd - 0.2)
        exitDuration = clamp(options.unitEnd - exitAt, 0.25, 0.7)
      } else {
        // 没有出场转场（全曲最后一段、段内接别的包的镜头、缩略图）：字留到单元结束，交给内核或片尾卡收。
        exitAt = options.unitEnd
        exitDuration = 0.5
      }
      timing.exitAt = Math.max(exitAt, timing.enterAt + 0.3)
      timing.exitDuration = exitDuration
    })

    var shotAt = function (time) {
      var found = 0
      for (var index = 0; index < count; index += 1) {
        if (timings[index].start <= time) found = index
      }
      return found
    }

    /**
     * 按镜头取值：上升窗口里用 easeSwing 在两个镜头之间过渡，其余时间取所在镜头的值。
     * 两边的值在窗口里都按各自的规律接着走（不在边界处钳住），接缝两端的速度、加速度就都是镜头里的。
     */
    var blended = function (time, value) {
      for (var index = 1; index < count; index += 1) {
        var win = timings[index].riseIn
        if (time >= win.from && time <= win.to) {
          var k = easeSwing((time - win.from) / Math.max(win.to - win.from, 1e-3))
          return value(index - 1, time) + (value(index, time) - value(index - 1, time)) * k
        }
      }
      return value(shotAt(time), time)
    }

    var target = function (index, time) {
      var timing = timings[index]
      return -timing.worldY + timing.drift * (time - (timing.start + timing.end) / 2)
    }

    // 世界容器的 y（像素）：镜头 i 定格时约等于 -worldY_i，镜头内缓慢变大（摄影机上漂）。
    var rise = function (time) {
      return count === 0 ? 0 : blended(time, target)
    }

    // 旋转按角速度来设计：镜头内按 spinDrift 匀速慢转；每个边界的上升窗口里，慢转的角速度用 easeSeptic 换成下一个镜头的，
    // 同时跟上升一起按 easeSwing 把这一步剩下的角度甩过去（世界边升边转）。两条曲线两端速度、加速度都是 0，
    // 所以慢转与快转之间没有「一脚油门、一脚刹车」；甩的角度按两个镜头中点的角度解出来，镜头中点时正好转到它自己的角度。
    var mids = timings.map(function (timing) {
      return (timing.start + timing.end) / 2
    })
    var spinSteps = timings.map(function (timing, index) {
      if (index === 0) return null
      var previous = timings[index - 1]
      var win = timing.riseIn
      var ramp = Math.max(win.to - win.from, 1e-3)
      var from = mids[index - 1]
      /** 慢转部分从上一个镜头中点积到 time。 */
      var driftAt = function (time) {
        var x = (time - win.from) / ramp
        var switched = x <= 0 ? 0 : (x >= 1 ? ramp / 2 + (time - win.to) : ramp * easeSepticIntegral(x))
        return previous.spinDrift * (time - from) + (timing.spinDrift - previous.spinDrift) * switched
      }
      var swing = timing.spin - previous.spin - driftAt(mids[index])
      return function (time) {
        return previous.spin + driftAt(time) + swing * easeSwing((time - win.from) / ramp)
      }
    })
    var spin = function (time) {
      if (count === 0) return 0
      if (time <= mids[0]) return timings[0].spin + timings[0].spinDrift * (time - mids[0])
      for (var index = 1; index < count; index += 1) {
        if (time < mids[index]) return spinSteps[index](time)
      }
      var last = timings[count - 1]
      return last.spin + last.spinDrift * (time - mids[count - 1])
    }

    var pushOf = function (index, time) {
      var timing = timings[index]
      return 1 + shots[index].camera.push * smooth((time - timing.start) / Math.max(timing.end - timing.start, 0.05))
    }
    var rollOf = function (index, time) {
      var timing = timings[index]
      return shots[index].camera.roll * motion * Math.sin((time - timing.start) * 0.9 + index * 1.3)
    }

    // 镜头内的推近、摆动与入场震动（绕画面中心）。
    var camera = function (time) {
      if (count === 0) return { scale: 1, rotation: 0, dx: 0, dy: 0 }
      var scale = blended(time, pushOf)
      var rotation = blended(time, rollOf)
      var dx = 0
      var dy = 0
      for (var index = 0; index < count; index += 1) {
        var age = time - timings[index].punchAt
        var punch = shots[index].camera.punch
        if (age < 0 || age > 0.9 || punch <= 0 || shots[index].isBridge) continue
        var amp = punch * motion * Math.exp(-age / 0.16) * smooth(age / PUNCH_ATTACK)
        dx += amp * 0.012 * height * Math.sin(age * 70 + index)
        dy += amp * 0.016 * height * Math.cos(age * 55 + index * 2)
        scale *= 1 + amp * 0.03
      }
      return { scale: scale, rotation: rotation, dx: dx, dy: dy }
    }

    return { shots: timings, rise: rise, spin: spin, shotAt: shotAt, camera: camera }
  }

  window.FoliaHanabiTimeline = {
    RISE_BEFORE: RISE_BEFORE,
    RISE_AFTER: RISE_AFTER,
    LAUNCH_DURATION: LAUNCH_DURATION,
    ENTER_LEAD: ENTER_LEAD,
    easeSeptic: easeSeptic,
    easeSwing: easeSwing,
    planSpin: planSpin,
    buildTimeline: buildTimeline
  }
})()
