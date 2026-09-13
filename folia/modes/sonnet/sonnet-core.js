// 商籁模式·基础模块：移植自 folia-major src/components/visualizer/sonnet/
//   sonnetRandom.ts（确定性哈希随机）
//   sonnetMotion.ts（纯绝对时间运动求值）
//   types.ts（节目类型常量）+ src/types.ts 的 SonnetTuning / DEFAULT_SONNET_TUNING（内联）
//   ../../utils/fontStacks.ts（字体栈，按插件规范改用 foliaGetLyricFontFamily）
//   ../pixiTextureBudget.ts（渲染分辨率对齐纹理池）+ ../pixiDisplayResources.ts（显示树回收）
// 全部为纯函数/常量，被后续模块按 window.FoliaSonnetCore 引用。
(function () {
  'use strict'

  // ---------- 类型常量（原版 sonnet/types.ts） ----------
  // 转场类型清单（顺序参与确定性选取，不可改动）
  var SONNET_TRANSITION_KINDS = ['fast-blur', 'mono-glitch', 'camera-pull']

  // ---------- SonnetTuning（内联自 src/types.ts 527~578 行） ----------
  var DEFAULT_SONNET_TUNING = {
    cameraIntensity: 1,
    typographyMotion: 1,
    mgDensity: 1,
    showOnlyText: false,
    showGuide: true,
    showBackgroundMg: true,
    showFixedGeo: true,
    showGiantDecorativeText: true,
    showBackgroundDecor: true,
    enableTransitions: true,
    outerFrameMode: 'full',
    textureResolution: 1.5,
    // 全场景后处理总开关（颗粒 + 对比度）
    postProcessEnabled: false,
    // 胶片颗粒量 0..1
    postProcessGrain: 0.2,
    // 对比度增强 0..1
    postProcessContrast: 0,
    // 固定印刷风格滤镜（0 关闭该 pass）
    postProcessRgbShift: 0,
    postProcessHalftone: 0,
    // 暗角强度 0..2（2 = 两倍基础压暗）
    postProcessVignette: 0.85,
    // 径向镜头畸变量 0..2
    postProcessLensDistortion: 0.3,
    // 径向色散量 0..1
    postProcessLensDispersion: 0.6
  }

  // ---------- 确定性随机（原版 sonnetRandom.ts） ----------
  // 提供不依赖进程级随机状态的确定性选取
  function hashSonnetSeed(value) {
    var hash = 2166136261
    for (var index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index)
      hash = Math.imul(hash, 16777619)
    }
    return hash >>> 0
  }

  // 把数字种子与盐混合，让不同子系统（几何变体/背景 HUD/固定几何/装饰/逐粒子抖动）互不相关
  function mixSonnetSeed(seed, salt) {
    return Math.imul((Math.trunc(seed) ^ salt) >>> 0, 2654435761) >>> 0
  }

  // 每元素下标的确定性 0..1 抖动；seek 安全、重建稳定
  function sonnetHash01(seed, index, salt) {
    return mixSonnetSeed(seed + Math.imul(index + 1, 97), salt) / 4294967296
  }

  // ---------- 运动求值（原版 sonnetMotion.ts） ----------
  function clamp01(value) { return Math.min(1, Math.max(0, value)) }

  function cubicCoordinate(point1, point2, time) {
    var inverse = 1 - time
    return 3 * inverse * inverse * time * point1
      + 3 * inverse * time * time * point2
      + time * time * time
  }

  // CSS 风格 cubic-bezier：先解 x 曲线再采样 y
  function resolveCubicBezier(x1, y1, x2, y2, value) {
    var target = clamp01(value)
    if (target === 0 || target === 1) return target
    var low = 0
    var high = 1
    var parameter = target
    for (var iteration = 0; iteration < 12; iteration += 1) {
      var x = cubicCoordinate(x1, x2, parameter)
      if (x < target) low = parameter
      else high = parameter
      parameter = (low + high) / 2
    }
    return cubicCoordinate(y1, y2, parameter)
  }

  function easeSonnetInOut(value) { return resolveCubicBezier(0.65, 0, 0.35, 1, value) }
  function easeSonnetEnter(value) { return resolveCubicBezier(0.22, 1, 0.36, 1, value) }

  function resolveSonnetAnimationScale(theme) {
    if (!theme) return 1
    return theme.animationIntensity === 'calm' ? 0.65 : theme.animationIntensity === 'chaotic' ? 1.35 : 1
  }

  // 高张力 PV 风格缓动
  function easeSonnetExpoOut(value) {
    return value === 1 ? 1 : 1 - Math.pow(2, -10 * value)
  }
  function easeSonnetElasticOut(value) {
    var p = 0.3
    return Math.pow(2, -10 * value) * Math.sin((value - p / 4) * (2 * Math.PI) / p) + 1
  }

  function resolveShotProgress(shot, time) {
    return clamp01((time - shot.startTime) / Math.max(shot.endTime - shot.startTime, 0.001))
  }

  function resolveSegmentProgress(startTime, endTime, time) {
    // 使用更高张力的 ExpoOut 产生"打击感"的单字入场
    return easeSonnetExpoOut(clamp01((time - startTime) / Math.max(endTime - startTime, 0.08)))
  }

  function resolveSonnetSegmentDepth(role, random) {
    if (!random) random = Math.random
    if (role !== 'decoration') return 0
    return random() > 0.5
      ? 0.5 + random() * 0.8
      : -0.5 - random() * 0.8
  }

  function resolveSonnetSegmentNormalOffset(role, layoutDirection, rotation, fontSize, randomValue) {
    if (role !== 'support') return { x: 0, y: 0 }
    var distance = (Math.min(1, Math.max(0, randomValue)) * 2 - 1) * fontSize * 0.3
    var normalAngle = rotation + (layoutDirection === 'vertical' ? 0 : Math.PI / 2)
    return {
      x: Math.cos(normalAngle) * distance,
      y: Math.sin(normalAngle) * distance
    }
  }

  // 相机平滑采样权重（无帧率绑定的时间域平滑）
  var SONNET_CAMERA_SMOOTHING_SAMPLES = [
    { offset: -1, weight: 1 },
    { offset: -0.5, weight: 4 },
    { offset: 0, weight: 6 },
    { offset: 0.5, weight: 4 },
    { offset: 1, weight: 1 }
  ]

  function resolveSonnetSmoothedCameraFocus(time, startTime, endTime, sampleFocus, smoothingWindow, maxBlendDistance) {
    if (smoothingWindow === undefined) smoothingWindow = 0.12
    if (maxBlendDistance === undefined) maxBlendDistance = 96
    var safeStart = Math.min(startTime, endTime)
    var safeEnd = Math.max(startTime, endTime)
    var radius = Math.max(0, smoothingWindow)
    if (radius === 0 || safeStart === safeEnd) {
      return sampleFocus(Math.min(safeEnd, Math.max(safeStart, time)))
    }

    var samples = SONNET_CAMERA_SMOOTHING_SAMPLES.map(function (entry) {
      var sampleTime = Math.min(safeEnd, Math.max(safeStart, time + entry.offset * radius))
      return { point: sampleFocus(sampleTime), weight: entry.weight }
    })
    var center = samples[2].point
    var maxDistanceSquared = Math.max(0, maxBlendDistance) * Math.max(0, maxBlendDistance)
    var x = 0
    var y = 0
    var totalWeight = 0
    samples.forEach(function (entry) {
      var point = entry.point
      var distanceSquared = (point.x - center.x) * (point.x - center.x) + (point.y - center.y) * (point.y - center.y)
      // 保留有意的构图跳切，而不是把两个相距甚远的焦点平均掉
      if (distanceSquared > maxDistanceSquared) return
      x += point.x * entry.weight
      y += point.y * entry.weight
      totalWeight += entry.weight
    })
    return { x: x / totalWeight, y: y / totalWeight }
  }

  // 生成稳定的归一化焦点权重，覆盖静默间隙与末字之后的尾部
  function resolveSonnetFocusWeights(ranges, time, sigma) {
    if (sigma === undefined) sigma = 0.35
    if (ranges.length === 0) return []
    var safeSigma = Math.max(0.001, sigma)
    var logWeights = ranges.map(function (range) {
      var startTime = Math.min(range.startTime, range.endTime)
      var endTime = Math.max(range.startTime, range.endTime)
      var distance = time < startTime
        ? startTime - time
        : time > endTime
          ? time - endTime
          : 0
      return -(distance * distance) / (2 * safeSigma * safeSigma)
    })
    var maxLogWeight = Math.max.apply(null, logWeights)
    var weights = logWeights.map(function (weight) { return Math.exp(weight - maxLogWeight) })
    var totalWeight = weights.reduce(function (total, weight) { return total + weight }, 0)
    return weights.map(function (weight) { return weight / totalWeight })
  }

  // PV 风格镜头路径：ExpoOut 快速入场、中段近匀速漂移（速度永不为 0）、末段柔和收尾让速给转场
  function resolveShotPathProgress(kind, progress) {
    var linear = clamp01(progress)
    if (kind === 'tracking-ribbon' || kind === 'fragment-collage' || kind === 'quiet-tableau' || kind === 'poster-blocks') {
      // 把匀速漂移混入 inout 曲线，中段永不停滞
      return linear * 0.55 + easeSonnetInOut(linear) * 0.45
    }
    if (linear < 0.18) return easeSonnetExpoOut(linear / 0.18) * 0.22
    if (linear < 0.78) return 0.22 + ((linear - 0.18) / 0.6) * 0.56
    var settle = (linear - 0.78) / 0.22
    return 0.78 + (1 - (1 - settle) * (1 - settle)) * 0.22
  }

  // 每个 shot 的确定性镜头路径，而非依赖音频抖动
  function resolveShotMotionFrame(kind, progress) {
    var linear = clamp01(progress)
    var eased = resolveShotPathProgress(kind, linear)
    var frames = {
      'editorial-column': {
        x: -0.055 + eased * 0.095,
        y: 0.025 - eased * 0.04,
        scale: 0.98 + eased * 0.07,
        rotation: -0.006 + eased * 0.01
      },
      'type-impact': {
        x: -0.035 + eased * 0.07,
        y: 0.018 - eased * 0.028,
        scale: 1 + (1 - easeSonnetExpoOut(Math.min(linear / 0.18, 1))) * 0.22 + eased * 0.08,
        rotation: -0.01 + eased * 0.016
      },
      'fragment-collage': {
        x: -0.045 + eased * 0.085,
        y: 0.028 - Math.sin(eased * Math.PI) * 0.055,
        scale: 0.97 + eased * 0.09,
        rotation: -0.014 + eased * 0.028
      },
      'tracking-ribbon': {
        x: -0.16 + eased * 0.28,
        y: 0.05 - eased * 0.085,
        scale: 0.98 + eased * 0.07,
        rotation: 0.008 - eased * 0.014
      },
      'mask-reveal': {
        x: 0.035 - eased * 0.065,
        y: 0.1 - eased * 0.135,
        scale: 0.96 + eased * 0.12,
        rotation: -0.006 + eased * 0.009
      },
      'poster-blocks': {
        x: -0.012 + eased * 0.024,
        y: 0.008 - eased * 0.016,
        scale: 0.99 + eased * 0.025,
        rotation: -0.0015 + eased * 0.003
      },
      'quiet-tableau': {
        x: -0.022 + eased * 0.04,
        y: 0.014 - eased * 0.025,
        scale: 1 + eased * 0.028,
        rotation: -0.002 + eased * 0.003
      }
    }
    return frames[kind]
  }

  var SONNET_CAMERA_BREATH_MAX_OFFSET = 0.006
  var SONNET_CAMERA_BREATH_MAX_SCALE = 0.002
  var SONNET_CAMERA_BREATH_MAX_ROTATION = 0.0015

  // 确定性的手持呼吸浮动：叠加不成公约数的正弦保持漂移有机感；
  // 绝对时间求值使直接 seek 与连续播放完全一致
  function resolveSonnetCameraBreath(time, phase) {
    if (phase === undefined) phase = 0
    var tau = time * Math.PI * 2
    return {
      x: (Math.sin(tau * 0.13 + phase) * 0.65 + Math.sin(tau * 0.31 + phase * 1.7) * 0.35)
        * SONNET_CAMERA_BREATH_MAX_OFFSET,
      y: (Math.cos(tau * 0.11 + phase * 2.3) * 0.65 + Math.sin(tau * 0.29 + phase * 0.9) * 0.35)
        * SONNET_CAMERA_BREATH_MAX_OFFSET,
      scale: Math.sin(tau * 0.09 + phase * 1.3) * SONNET_CAMERA_BREATH_MAX_SCALE,
      rotation: Math.sin(tau * 0.07 + phase * 2.9) * SONNET_CAMERA_BREATH_MAX_ROTATION
    }
  }

  // 歌词揭示完成后再渐入呼吸浮动，避免在行中间突然出现
  function resolveSonnetBreathWeight(time, revealDoneTime, rampDuration) {
    if (rampDuration === undefined) rampDuration = 1.2
    if (rampDuration <= 0) return time >= revealDoneTime ? 1 : 0
    return easeSonnetInOut(clamp01((time - revealDoneTime) / rampDuration))
  }

  // 纯时间轴伪随机震颤
  function resolveTimelineShake(time, intensity) {
    if (intensity <= 0) return { x: 0, y: 0, rotation: 0 }
    // 高频噪点
    var shakeX = Math.sin(time * 123.456) * Math.cos(time * 789.123)
    var shakeY = Math.cos(time * 345.678) * Math.sin(time * 901.234)
    var shakeRot = Math.sin(time * 567.89)
    return {
      x: shakeX * 0.02 * intensity,
      y: shakeY * 0.02 * intensity,
      rotation: shakeRot * 0.005 * intensity
    }
  }

  // ---------- 字体栈（原版 utils/fontStacks.ts，按插件规范适配） ----------
  var MIN_FONT_WEIGHT = 100
  var MAX_FONT_WEIGHT = 900
  var FONT_WEIGHT_STEP = 10

  // normalizeFontWeight：clamp 100~900 后按 10 取整；非数字返回 null（使用角色自动字重）
  function normalizeFontWeight(fontWeight) {
    if (typeof fontWeight !== 'number' || !Number.isFinite(fontWeight)) return null
    var clamped = Math.min(MAX_FONT_WEIGHT, Math.max(MIN_FONT_WEIGHT, fontWeight))
    return Math.round(clamped / FONT_WEIGHT_STEP) * FONT_WEIGHT_STEP
  }

  function resolveThemeFontWeight(theme, fallback) {
    var normalized = normalizeFontWeight(theme && theme.fontWeight)
    return normalized !== null ? normalized : fallback
  }

  // 原版 resolveThemeFontStack：自定义字体族优先，否则按 fontStyle 的内建栈；
  // 插件宿主的歌词字体设置经 foliaGetLyricFontFamily 注入
  var BUILTIN_FONT_STACKS = {
    sans: '"Inter", "Noto Sans CJK SC", "Noto Sans JP", "Source Han Sans SC", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Helvetica Neue", Arial, sans-serif',
    serif: '"Iowan Old Style", "Noto Serif CJK SC", "Noto Serif JP", "Source Han Serif SC", "Songti SC", "STSong", "Georgia", serif',
    mono: '"IBM Plex Mono", "Sarasa Mono SC", "Noto Sans Mono CJK SC", "Noto Sans Mono", "SFMono-Regular", Consolas, monospace'
  }

  function resolveThemeFontStack(theme) {
    if (window.foliaGetLyricFontFamily) {
      var family = window.foliaGetLyricFontFamily()
      if (family) return family
    }
    var fontStyle = theme && theme.fontStyle ? theme.fontStyle : 'sans'
    return BUILTIN_FONT_STACKS[fontStyle] || BUILTIN_FONT_STACKS.sans
  }

  // ---------- 纹理预算（原版 src/components/visualizer/pixiTextureBudget.ts） ----------
  // 复刻 Pixi 自身的 nextPow2（maths/misc/pow2），使本模块能精确预测纹理池的桶大小
  function nextPow2(value) {
    var v = value + (value === 0 ? 1 : 0)
    v -= 1
    v |= v >>> 1
    v |= v >>> 2
    v |= v >>> 4
    v |= v >>> 8
    v |= v >>> 16
    return v + 1
  }

  // Pixi 为全屏 pass 的一轴分配的池化纹理尺寸（设备像素），含 epsilon
  function texturePoolAxis(cssSize, resolution) {
    return nextPow2(Math.ceil(cssSize * resolution - 1e-6))
  }

  // 一次快降最多允许放弃的分辨率比例
  var TEXTURE_POOL_MAX_RESOLUTION_DROP = 0.25

  // 把该轴降一档池桶的最高分辨率；更低没有桶时返回 null
  function stepDownCandidate(cssSize, resolution) {
    var bucket = texturePoolAxis(cssSize, resolution)
    if (bucket < 2) return null
    return (bucket / 2) / cssSize
  }

  // 返回实际渲染使用的分辨率：在 maxDrop 内能落入更小桶的最高值
  function snapResolutionToTexturePool(cssWidth, cssHeight, resolution, maxDrop) {
    if (maxDrop === undefined) maxDrop = TEXTURE_POOL_MAX_RESOLUTION_DROP
    var values = [cssWidth, cssHeight, resolution]
    var valid = true
    for (var i = 0; i < values.length; i += 1) {
      if (!(Number.isFinite(values[i]) && values[i] > 0)) valid = false
    }
    if (!valid) return resolution
    var lowest = resolution * (1 - Math.min(Math.max(maxDrop, 0), 1))
    var candidates = [stepDownCandidate(cssWidth, resolution), stepDownCandidate(cssHeight, resolution)]
      .filter(function (candidate) {
        return candidate !== null && candidate > 0 && candidate < resolution && candidate >= lowest
      })

    var best = resolution
    // 桶面积对分辨率单调，现任值只可能被彻底击败
    var bestArea = texturePoolAxis(cssWidth, resolution) * texturePoolAxis(cssHeight, resolution)
    candidates.forEach(function (candidate) {
      var area = texturePoolAxis(cssWidth, candidate) * texturePoolAxis(cssHeight, candidate)
      if (area >= bestArea) return
      bestArea = area
      best = candidate
    })
    return best
  }

  // ---------- 显示树资源回收（原版 src/components/visualizer/pixiDisplayResources.ts） ----------
  // 释放渲染器持有的数据，但不销毁必须保持可 seek 的显示树
  function unloadPixiDisplayTree(root) {
    var stack = (root.children || []).slice()
    while (stack.length > 0) {
      var node = stack.pop()
      if (node.children && node.children.length) {
        for (var i = 0; i < node.children.length; i += 1) stack.push(node.children[i])
      }
      if (typeof node.unload === 'function') node.unload()
    }
  }

  // removeChildren() 只摘除节点；需显式 unload 并销毁摘下的子树
  function destroyPixiContainerChildren(container) {
    var children = container.removeChildren()
    children.forEach(function (child) {
      unloadPixiDisplayTree(child)
      if (typeof child.unload === 'function') child.unload()
      if (typeof child.destroy === 'function') child.destroy({ children: true })
    })
  }

  window.FoliaSonnetCore = {
    SONNET_TRANSITION_KINDS: SONNET_TRANSITION_KINDS,
    DEFAULT_SONNET_TUNING: DEFAULT_SONNET_TUNING,
    hashSonnetSeed: hashSonnetSeed,
    mixSonnetSeed: mixSonnetSeed,
    sonnetHash01: sonnetHash01,
    clamp01: clamp01,
    resolveCubicBezier: resolveCubicBezier,
    easeSonnetInOut: easeSonnetInOut,
    easeSonnetEnter: easeSonnetEnter,
    easeSonnetExpoOut: easeSonnetExpoOut,
    easeSonnetElasticOut: easeSonnetElasticOut,
    resolveSonnetAnimationScale: resolveSonnetAnimationScale,
    resolveShotProgress: resolveShotProgress,
    resolveSegmentProgress: resolveSegmentProgress,
    resolveSonnetSegmentDepth: resolveSonnetSegmentDepth,
    resolveSonnetSegmentNormalOffset: resolveSonnetSegmentNormalOffset,
    resolveSonnetSmoothedCameraFocus: resolveSonnetSmoothedCameraFocus,
    resolveSonnetFocusWeights: resolveSonnetFocusWeights,
    resolveShotPathProgress: resolveShotPathProgress,
    resolveShotMotionFrame: resolveShotMotionFrame,
    resolveSonnetCameraBreath: resolveSonnetCameraBreath,
    resolveSonnetBreathWeight: resolveSonnetBreathWeight,
    resolveTimelineShake: resolveTimelineShake,
    normalizeFontWeight: normalizeFontWeight,
    resolveThemeFontWeight: resolveThemeFontWeight,
    resolveThemeFontStack: resolveThemeFontStack,
    snapResolutionToTexturePool: snapResolutionToTexturePool,
    unloadSonnetDisplayTree: unloadPixiDisplayTree,
    destroySonnetContainerChildren: destroyPixiContainerChildren
  }
})()
