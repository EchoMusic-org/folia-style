// 动画引擎：framer-motion 的无构建等价物（folia-major 使用 framer-motion，本插件无 React 环境）
// 提供：1) spring 物理弹簧采样（与 framer-motion 的 stiffness/damping/mass 参数一致）
//       2) 基于 WAAPI 的多属性并行动画（tween/keyframes/textShadow/filter/颜色插值）
//       3) 无限循环关键帧（整行呼吸浮动）与 delay/times 支持
// 注意：所有模式对单个元素同时只保留一轮动画，重复调用会取消上一轮（fill:'forwards' 保持终态）。
(function () {
  'use strict'

  var clamp = function (v, min, max) { return Math.min(Math.max(v, min), max) }

  // ---------- spring 物理模拟（与 framer-motion 相同的弹簧方程，runge-kutta 风格积分） ----------
  // 返回 { values: number[], duration: number }：从 0 到 1 归一化进度的位移采样序列
  function simulateSpring(options) {
    var stiffness = options.stiffness === undefined ? 100 : options.stiffness
    var damping = options.damping === undefined ? 10 : options.damping
    var mass = options.mass === undefined ? 1 : options.mass
    var from = options.from === undefined ? 0 : options.from
    var to = options.to === undefined ? 1 : options.to
    var velocity0 = options.velocity || 0
    var restDelta = options.restDelta === undefined ? 0.01 : options.restDelta
    var restSpeed = options.restSpeed === undefined ? 0.01 : options.restSpeed

    var distance = to - from
    if (Math.abs(distance) < 1e-9) {
      return { values: [0, 1], duration: 0 }
    }

    var dt = 1 / 120
    var maxDuration = 8 // 秒，安全上限
    var values = [0]
    var position = 0 // 归一化位移（0=from, 1=to）
    var velocity = velocity0 / distance
    var elapsed = 0

    while (elapsed < maxDuration) {
      // 半隐式欧拉积分（小步长下与 framer-motion 观感一致）
      var springForce = -stiffness * (position - 1)
      var dampingForce = -damping * velocity
      var acceleration = (springForce + dampingForce) / mass
      velocity += acceleration * dt
      position += velocity * dt
      elapsed += dt

      values.push(clamp(position, -0.5, 1.5))

      var isResting = Math.abs(velocity) < restSpeed && Math.abs(1 - position) <= restDelta
      if (isResting && elapsed > 0.05) break
    }

    values[values.length - 1] = 1
    return { values: values, duration: Math.max(elapsed, 0.05) }
  }

  // spring 采样序列 → WAAPI 关键帧（含 offset 与 easing:'linear'）
  function springKeyframes(options) {
    var sim = simulateSpring(options)
    var n = sim.values.length
    // 采样点太多时降采样到最多 64 帧（性能友好，视觉无损）
    var stride = Math.max(1, Math.ceil(n / 64))
    var offsets = []
    var progress = []
    for (var i = 0; i < n; i += stride) {
      progress.push(sim.values[i])
      offsets.push(i / (n - 1))
    }
    if (offsets[offsets.length - 1] !== 1) {
      progress.push(1)
      offsets.push(1)
    }
    return { progress: progress, offsets: offsets, durationMs: Math.round(sim.duration * 1000) }
  }

  // ---------- 缓动 ----------
  var EASINGS = {
    linear: 'linear',
    easeIn: 'ease-in',
    easeOut: 'ease-out',
    easeInOut: 'ease-in-out',
    ease: 'ease',
    circIn: 'cubic-bezier(0, 0, 1, 0)',
    circOut: 'cubic-bezier(0, 0.55, 0.45, 1)',
    circInOut: 'cubic-bezier(0.85, 0, 0.15, 1)',
    backIn: 'cubic-bezier(0.36, 0, 0.66, -0.56)',
    backOut: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
    backInOut: 'cubic-bezier(0.68, -0.6, 0.32, 1.6)'
  }
  function resolveEasing(ease) {
    if (!ease) return 'ease'
    if (typeof ease === 'string') return EASINGS[ease] || ease
    if (Array.isArray(ease) && ease.length === 4) return 'cubic-bezier(' + ease.join(',') + ')'
    return 'ease'
  }

  // ---------- transform 合成 ----------
  // framer-motion 的 x/y/scale/rotate 是独立属性；WAAPI 中合成为单个 transform 字符串
  function transformStr(t) {
    if (!t) return 'none'
    var x = t.x || 0
    var y = t.y || 0
    var parts = []
    if (x || y) parts.push('translate(' + x + 'px, ' + y + 'px)')
    if (t.rotate) parts.push('rotate(' + t.rotate + 'deg)')
    var s = t.scale === undefined ? 1 : t.scale
    if (s !== 1) parts.push('scale(' + s + ')')
    if (t.rotateX) parts.push('rotateX(' + t.rotateX + 'deg)')
    if (t.rotateY) parts.push('rotateY(' + t.rotateY + 'deg)')
    return parts.length ? parts.join(' ') : 'none'
  }

  // ---------- WAAPI 动画管理 ----------
  // 每个元素上通过 el.__foliaAnims 记录活动动画，按属性组取消旧动画避免叠加
  function cancelAnimations(el) {
    var running = el.__foliaAnims
    if (running) {
      running.forEach(function (anim) {
        try { anim.cancel() } catch (e) { /* 已结束的动画 cancel 会抛错，忽略 */ }
      })
      el.__foliaAnims = null
    }
  }

  function trackAnimations(el, animations) {
    el.__foliaAnims = animations
    animations.forEach(function (anim) {
      anim.finished.catch(function () { /* 用户取消或被替换时忽略 */ })
    })
  }

  // 把单属性关键帧规格转换成 WAAPI keyframes
  // value: { from, to } 或数组；transform 用 { x,y,scale,rotate } 组合
  function buildKeyframes(prop, value, hasFrom) {
    if (prop === 'transform') {
      var frames = Array.isArray(value) ? value : [value.from || { x: 0, y: 0, scale: 1, rotate: 0 }, value.to || { x: 0, y: 0, scale: 1, rotate: 0 }]
      return frames.map(transformStr)
    }
    if (Array.isArray(value)) {
      var arr = value.slice()
      if (hasFrom && arr.length && typeof arr[0] === 'undefined') arr[0] = ''
      return arr.map(function (v) { return v === undefined ? '' : v })
    }
    var from = value.from
    var to = value.to
    if (from === undefined && to === undefined) return null
    if (from === undefined) return [to] // 只指定终态：依赖 fill:'forwards'
    return [from, to === undefined ? from : to]
  }

  /**
   * 补间/弹簧动画（对应 framer-motion 的 animate 属性 + transition）
   * el        目标元素
   * props     { opacity:{from,to}, transform:{from:{x,y,scale,rotate},to:{...}}, color:{from,to}, filter:{from,to}, textShadow:{...} }
   *           或属性值为数组形式的关键帧
   * transition { type:'spring', stiffness, damping, mass, <prop>:{duration} 覆盖 } 或 { duration, ease, delay }
   * 返回 Animation 联合句柄 { cancel(), finished }
   */
  function animateProps(el, props, transition) {
    if (!el) return { cancel: function () {}, finished: Promise.resolve() }
    transition = transition || {}
    cancelAnimations(el)

    var keyframes = {}
    var propertyNames = []
    var isSpring = transition.type === 'spring'

    // spring 模式：以 transform（或第一个数值属性）为主属性采样弹簧，其余属性线性跟随同节奏
    var springSim = null
    if (isSpring) {
      var mainFrom = props.transform ? (props.transform.from || props.transform) : null
      springSim = springKeyframes({
        stiffness: transition.stiffness,
        damping: transition.damping,
        mass: transition.mass
      })
    }

    Object.keys(props).forEach(function (prop) {
      var value = props[prop]
      if (value === undefined) return

      var perPropTransition = transition[prop]
      var frames

      if (isSpring && !perPropTransition) {
        // 主弹簧节奏驱动：progress 序列直接映射到属性值
        if (prop === 'transform') {
          var fromT = value.from || { x: 0, y: 0, scale: 1, rotate: 0 }
          var toT = value.to || { x: 0, y: 0, scale: 1, rotate: 0 }
          frames = springSim.progress.map(function (p) { return transformStr(lerpTransform(fromT, toT, p)) })
        } else {
          var from = value.from !== undefined ? value.from : 0
          var to = value.to !== undefined ? value.to : from
          frames = springSim.progress.map(function (p) { return String(lerpValue(from, to, p)) })
        }
        keyframes[prop] = frames
        propertyNames.push(prop)
        return
      }

      var useTransition = perPropTransition || transition
      var framesBuilt = buildKeyframes(prop, value, false)
      if (!framesBuilt || framesBuilt.length < 2) {
        // 只有终态：直接写入样式
        if (framesBuilt && framesBuilt.length === 1) applyStatic(el, prop, framesBuilt[0])
        return
      }
      keyframes[prop] = framesBuilt
      // 单属性独立时长/easing 时拆分为单独动画
      if (perPropTransition) {
        playSingle(el, prop, framesBuilt, useTransition)
      } else {
        propertyNames.push(prop)
      }
    })

    if (propertyNames.length) {
      var timing = {
        duration: isSpring ? springSim.durationMs : Math.round((transition.duration === undefined ? 0.3 : transition.duration) * 1000),
        delay: Math.round((transition.delay || 0) * 1000),
        easing: isSpring ? 'linear' : resolveEasing(transition.ease),
        fill: 'forwards'
      }
      var anim = el.animate(keyframes, timing)
      trackAnimations(el, [anim])
      return { cancel: function () { cancelAnimations(el) }, finished: anim.finished }
    }

    return { cancel: function () { cancelAnimations(el) }, finished: Promise.resolve() }
  }

  function playSingle(el, prop, frames, transition) {
    var timing = {
      duration: Math.round((transition.duration === undefined ? 0.3 : transition.duration) * 1000),
      delay: Math.round((transition.delay || 0) * 1000),
      easing: resolveEasing(transition.ease),
      fill: 'forwards'
    }
    var kf = {}
    kf[prop] = frames
    var anim = el.animate(kf, timing)
    var existing = el.__foliaSingleAnims || {}
    if (existing[prop]) { try { existing[prop].cancel() } catch (e) { /* 忽略 */ } }
    existing[prop] = anim
    el.__foliaSingleAnims = existing
    anim.finished.catch(function () { /* 忽略 */ })
  }

  function applyStatic(el, prop, value) {
    if (prop === 'transform') {
      el.style.transform = value
    } else {
      el.style[prop] = value
    }
  }

  function lerpValue(from, to, p) { return from + (to - from) * p }

  function lerpTransform(from, to, p) {
    return {
      x: lerpValue(from.x || 0, to.x || 0, p),
      y: lerpValue(from.y || 0, to.y || 0, p),
      scale: lerpValue(from.scale === undefined ? 1 : from.scale, to.scale === undefined ? 1 : to.scale, p),
      rotate: lerpValue(from.rotate || 0, to.rotate || 0, p)
    }
  }

  /**
   * 关键帧动画（对应 framer-motion 的数组值 + times/delay/repeat）
   * props: { opacity:[...], transform:[{x,y,scale,rotate},...], textShadow:[...] }
   * transition: { duration, times:[...], delay, repeat: Infinity|n, ease }
   */
  function animateKeyframes(el, props, transition) {
    if (!el) return { cancel: function () {}, finished: Promise.resolve() }
    transition = transition || {}
    cancelAnimations(el)

    var keyframes = {}
    Object.keys(props).forEach(function (prop) {
      var value = props[prop]
      if (!Array.isArray(value)) return
      keyframes[prop] = prop === 'transform' ? value.map(transformStr) : value.map(function (v) { return v === undefined ? '' : v })
    })

    var times = transition.times
    var timing = {
      duration: Math.round((transition.duration === undefined ? 0.3 : transition.duration) * 1000),
      delay: Math.round((transition.delay || 0) * 1000),
      easing: resolveEasing(transition.ease),
      fill: 'forwards',
      iterations: transition.repeat === Infinity ? Infinity : (transition.repeat || 1)
    }
    if (times && times.length) {
      timing.offset = times.slice(0, Object.keys(keyframes).length ? keyframes[Object.keys(keyframes)[0]].length : times.length)
    }

    var anim = el.animate(keyframes, timing)
    trackAnimations(el, [anim])
    return { cancel: function () { cancelAnimations(el) }, finished: anim.finished }
  }

  // 直接设置终态（等价 framer-motion transitionEnd / 立即应用）
  function setProps(el, props) {
    if (!el) return
    Object.keys(props).forEach(function (prop) {
      var value = props[prop]
      if (value === undefined) return
      applyStatic(el, prop, prop === 'transform' ? transformStr(value) : value)
    })
  }

  window.FoliaAnim = {
    animateProps: animateProps,
    animateKeyframes: animateKeyframes,
    setProps: setProps,
    cancelAnimations: cancelAnimations,
    transformStr: transformStr,
    resolveEasing: resolveEasing,
    simulateSpring: simulateSpring
  }
})()
