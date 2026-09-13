// 凝彩模式·基础模块：移植自 folia-major src/components/visualizer/tempera/
//   types.ts（TEMPERA_SHOT_KINDS / TEMPERA_TRANSITION_KINDS / TEMPERA_DECOR_MOTIFS 常量）
//   src/types.ts 的 TemperaTuning / DEFAULT_TEMPERA_TUNING（内联）
//   temperaRandom.ts（确定性哈希随机）
//   temperaMotionEasing.ts（缓动原语）
//   temperaMotion.ts（纯绝对时间逐字运动求解）
//   temperaCamera.ts（shot 级镜头插值 + 呼吸浮动）
//   temperaTransitions.ts（段落转场帧）
//   temperaEnterStyles.ts（7 种逐字入场样式）
//   ../pixiDisplayResources.ts 的 setPixiDisplayTreeVisibility（显示树可见性，unload 复用 sonnet-core）
// 全部为纯函数/常量，被后续模块按 window.FoliaTemperaCore 引用。
(function () {
  'use strict'

  // ---------- 类型常量（原版 tempera/types.ts） ----------
  // 每一种 Tempera 可切至的构图。shot 默认为半句大小，所以清单必须足够长，
  // 让一个段落很少重复同一构图；tempera-profiles 携带排版区域/镜头/mood，
  // compositions 各文件携带绘制。
  var TEMPERA_SHOT_KINDS = [
    // 分割与网格
    'duo-split',
    'quad-split',
    'tri-column',
    'thirds-stack',
    'checker-quad',
    'corner-wedge',
    'diagonal-halves',
    'cross-axis',
    'offset-halves',
    'stair-blocks',
    'pillar-gap',
    'corner-quad',
    'sliver-stack',
    // 色带
    'band-strip',
    'horizon-band',
    'deep-dive',
    'tone-ramp',
    'double-band',
    'tilt-band',
    'edge-rails',
    'gradient-wall',
    'terrace',
    // 框与窗
    'frame-window',
    'double-frame',
    'circle-window',
    'ladder-frame',
    'corner-brackets',
    'inset-box',
    'bracket-pair',
    'arch-window',
    'grid-cells',
    'keyhole',
    // 海报与形状
    'poster-panel',
    'diamond-stack',
    'slash-poster',
    'arrow-wedge',
    'edge-bleed',
    'triangle-mass',
    'ribbon-cross',
    'half-disc',
    'stacked-slabs',
    'wedge-pair',
    // 稀疏场
    'quiet-line',
    'starfield-dots',
    'ripple-lines',
    'hair-grid',
    'margin-rule',
    'dot-drift',
    'arc-sweep',
    'blank-page',
    // 电影遮幅：实心画框中间挖出给定画幅比例的窗口
    'cinema-scope',
    'cinema-wide',
    'cinema-academy',
    'cinema-square',
    'cinema-portrait',
    'cinema-tall',
    'cinema-twin',
    // 圆滑族：平涂底面上放置圆角形状（视觉小说 PV 风格）。其余族都用直边切画面；
    // 这一族保持底面完整、把曲线放在上面
    'bubble-drift',
    'cloud-window',
    'heart-burst',
    'sparkle-field',
    'petal-arc',
    'scallop-band',
    'ribbon-loop',
    'round-plate',
    'halo-burst',
    // 冲孔板：开口干净地穿透色调，露出外壳的实时背景（见 compositions-a 的 cutout 工具）
    'iris-hole',
    'slot-rail',
    'punch-row',
    'film-gate',
    'cross-vent',
    'louvre-slats',
    'ring-eye',
    'notch-stack',
    'wedge-gap',
    'dot-sieve',
    // 仪表盘族：一个重心块四周的规整几何装饰
    'sight-mark',
    'dial-scale',
    'chevron-run',
    'tally-column',
    'grid-focus',
    'axis-caps',
    'strobe-slats',
    'offset-plate',
    'radial-comb',
    'bracket-target',
    // 走廊族：沿 flow 向量开出的通道，相邻 shot 的交接保持同一条开口在移动
    'flow-channel',
    'twin-channel',
    'reed-run',
    'taper-channel',
    'chain-ports',
    'dash-channel',
    'window-run',
    'bridge-span',
    'braid-channel',
    'port-ladder',
    // 粗野主义巨构：一面巨大的哑光实体，被画框裁切，字压在它的边缘上
    'apex-mass',
    'ziggurat',
    'slab-wall',
    'cantilever',
    'pylon-pair',
    'bunker-slit',
    'plinth-stack',
    'buttress-run',
    'void-core',
    'shear-block',
    // 同一语汇读作地面与结构而非物体
    'ridge-line',
    'chasm',
    'overhang',
    'step-well',
    'pier-row',
    'revetment',
    'tower-crop',
    'lintel',
    'rubble-fan',
    'gnomon',
    // 物语系过场卡：一整面平涂，文字即整幅画面
    'monogatari-card',
    'monogatari-rule',
    'monogatari-edge',
    'monogatari-stack',
    'monogatari-flash'
  ]

  // 所有转场都由大图形或镜头领队；不用溶解也不用硬切——溶解读作剪辑，
  // 而 Tempera 的构图应当互相交棒
  var TEMPERA_TRANSITION_KINDS = [
    'block-wipe',
    'camera-pan',
    'shape-carry'
  ]

  var TEMPERA_DECOR_MOTIFS = [
    'diamonds',
    'hatch-twin',
    'band-cross',
    'poster-diamond',
    'doodle'
  ]

  // ---------- TemperaTuning（内联自 src/types.ts 618~690 行） ----------
  // 本插件没有设置 UI，tuning 恒为该默认值；接口保留以便未来扩展
  var DEFAULT_TEMPERA_TUNING = {
    cameraIntensity: 1,
    // 逐字入场运动强度 0..2
    glyphMotion: 1,
    // 开启后每条源歌词行保持在同一个 shot 内，而不是切成半句
    wholeLineLyrics: false,
    // 逐字入场时序拉伸 0..1：入场窗口向 shot 歌词末端延伸的程度（超过 0.34s 下限）
    glyphSettleStretch: 0.5,
    // duo 从主题色派生色块；mono 收缩为灰度墨/纸阶梯
    colorMode: 'duo',
    showBlocks: true,
    showDecor: true,
    // 文字动态反色：歌词对其下方的画面采样，逐像素选择对比更强的 ink/paper
    textInversion: true,
    // 用户图片池；本插件无导入 UI，恒为空数组
    layerImages: [],
    // back 让歌词对图片反色；front 把图片压在歌词上
    layerImageDepth: 'back',
    // 0..1 某个 shot 显示图片的概率
    layerImageFrequency: 0.6,
    enableTransitions: true,
    textureResolution: 1.5,
    // 全场景后处理总开关（颗粒 + 对比度 + 印刷 pass）
    postProcessEnabled: true,
    // 后处理纹理压缩：以 1x 渲染后处理再拉伸到画布（默认关）
    postProcessTextureCompression: false,
    // 胶片颗粒量 0..1
    postProcessGrain: 0.2,
    // 对比度增强 0..1
    postProcessContrast: 0,
    // RGB 偏移 pass 强度 0..1（0 关闭该 pass）
    postProcessRgbShift: 0,
    // 暗角强度 0..2（2 = 两倍基础压暗）
    postProcessVignette: 0.85,
    // 径向镜头畸变量 0..2
    postProcessLensDistortion: 0.3
  }

  // ---------- 确定性随机（原版 temperaRandom.ts） ----------
  // 提供不依赖进程级随机状态的确定性选取
  function hashTemperaSeed(value) {
    var hash = 2166136261
    for (var index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index)
      hash = Math.imul(hash, 16777619)
    }
    return hash >>> 0
  }

  // 把数字种子与盐混合，让不同子系统（色块/装饰/逐字抖动）互不相关
  function mixTemperaSeed(seed, salt) {
    return Math.imul((Math.trunc(seed) ^ salt) >>> 0, 2654435761) >>> 0
  }

  // 每元素下标的确定性 0..1 抖动；seek 安全、重建稳定
  function temperaHash01(seed, index, salt) {
    return mixTemperaSeed(seed + Math.imul(index + 1, 97), salt) / 4294967296
  }

  // 确定性选取：在可能时避开上一次的选取
  function chooseWithoutRepeat(choices, seed, previous) {
    var start = hashTemperaSeed(seed) % choices.length
    for (var offset = 0; offset < choices.length; offset += 1) {
      var candidate = choices[(start + offset) % choices.length]
      if (candidate !== previous) return candidate
    }
    return choices[start]
  }

  // ---------- 缓动原语（原版 temperaMotionEasing.ts） ----------
  // 拆分出来让入场样式与逐字求解器共享，而不必互相依赖
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

  // 长而柔的减速：起步果断，然后是长长的爬行尾巴。更平缓的曲线试过，读起来拖沓；
  // 快速开场带来的冲击力正是整个模式的动能源头，不要改这条曲线
  function easeTemperaEnter(value) { return resolveCubicBezier(0.22, 1, 0.36, 1, value) }
  function easeTemperaInOut(value) { return resolveCubicBezier(0.62, 0, 0.32, 1, value) }

  // 出程带轻微预备动作；用于缩放，让字落位时带一点小回弹
  function easeTemperaSoftBack(value) {
    var t = clamp01(value)
    var c = 1.42
    return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2)
  }

  // ---------- 逐字运动求解（原版 temperaMotion.ts） ----------
  var CURRENT_EMPHASIS = 0.05
  // 唱完之后隆起回落所需时长
  var EMPHASIS_DECAY = 0.26
  var ECHO_ALPHA = 0.5
  // 揭示（不透明度与运动浮影）允许跑满的最长窗口。
  // settle 窗口本身被拉伸到该字所在行的末尾，让文字块在行结束时仍在缓入位；
  // 但淡入与拖尾浮影跑满整段就完全是另一回事：字在移动中必须可读，
  // 而活过开场的浮影读作糊而非动感。这是 settle 窗口过去携带的上限，
  // 任何短到够不着的入场行为完全不变。
  var MAX_REVEAL_WINDOW = 1.35
  // 唱完的文字块变宽多少。刻意很小：这是字距，不是漂移
  var RELEASE_TRACKING = 0.055

  // 求解一个字的入场加上唱完后的字距释放，让唱完的行保持生命而不破坏排版。
  // motion 是经 tuning/主题缩放的量；0 把字钉在排版位置上
  function resolveTemperaGlyphMotion(glyph, time, motion) {
    var window = Math.max(glyph.settleTime - glyph.startTime, 0.08)
    var linear = clamp01((time - glyph.startTime) / window)
    var travel = 1 - easeTemperaEnter(linear)
    var entrance = resolveTemperaEnterFrame(glyph.enterStyle, glyph, travel, linear)
    // 不透明度与浮影跑在各自的上限窗口里；位置与缩放保持完整拉伸的那条，
    // 这正是把长句变成一次连续移动的关键
    var reveal = clamp01((time - glyph.startTime) / Math.min(window, MAX_REVEAL_WINDOW))
    // 透明度比位置先收敛，所以字还在移动时就已可读
    var alpha = easeTemperaInOut(clamp01(reveal * 2.4))

    // 当前字的强调是小幅缩放隆起，而不是画衬底块：画在字后面的任何东西
    // 都会变成反色滤镜读取的底色，这恰恰把效果变成一个色块而不是对画面的反应。
    //
    // 它跟随被唱窗口本身——起振、保持、衰减——而不是从起点起算倒计时。
    // 旧形式让每个字都脉冲一次，无论它是否被唱过，于是每个合并的标点
    // （零时长，parser 的词不覆盖它）都会各自弹一下。
    var sungWindow = glyph.endTime - glyph.startTime
    var attack = Math.min(0.12, sungWindow * 0.5)
    var emphasis = sungWindow <= 0
      ? 0
      : easeTemperaInOut(clamp01((time - glyph.startTime) / Math.max(attack, 0.02)))
        * (1 - easeTemperaInOut(clamp01((time - glyph.endTime) / EMPHASIS_DECAY)))

    // 释放：字被唱完后块缓慢张开字距而不是冻结。提前唱完的行否则会在长 shot
    // 的剩余时间里死坐不动。这是刚性的中心外扩——不游走、不漂浮、不旋转——
    // 因为漂移的字会与这个模式的确定性排版相矛盾。斜坡从「唱完」与「落位」
    // 中较晚的一刻开始，因此永远不会和入场打架
    var releaseStart = Math.max(glyph.endTime, glyph.settleTime)
    var release = easeTemperaInOut(clamp01(
      (time - releaseStart) / Math.max(glyph.releaseTime - releaseStart, 0.001)
    ))
    var spread = release * clamp01(motion) * RELEASE_TRACKING
    var driftX = glyph.trackingX * spread
    var driftY = glyph.trackingY * spread

    // 调低的运动设置把入场往静止姿态回拉而不是反转它，因此 glyphMotion: 0
    // 把所有样式钉在排版位置上
    var amount = clamp01(motion)
    var swell = emphasis * CURRENT_EMPHASIS * amount
    return {
      visible: time >= glyph.startTime,
      alpha: alpha,
      x: entrance.x * motion + driftX,
      y: entrance.y * motion + driftY,
      rotation: glyph.rotation + entrance.rotation * motion,
      scaleX: entrance.scaleX + (1 - entrance.scaleX) * (1 - amount) + swell,
      scaleY: entrance.scaleY + (1 - entrance.scaleY) * (1 - amount) + swell,
      echoX: entrance.x * motion,
      echoY: entrance.y * motion,
      echoAlpha: entrance.echo * (1 - easeTemperaEnter(reveal)) * ECHO_ALPHA * amount
    }
  }

  // 把 shot 相对的比例映射到秒，钳制使很短或很长的 shot 仍以可看的速度动画。
  // 这是把色块运动绑定到歌词行节奏而非固定壁钟时长的关键
  function resolveShotPacedDuration(shotDuration, fraction, minSeconds, maxSeconds) {
    return Math.min(maxSeconds, Math.max(minSeconds, shotDuration * fraction))
  }

  // ---------- shot 级镜头（原版 temperaCamera.ts） ----------
  // 插值 shot 编译期的起止关键帧，叠加一层确定性的呼吸浮动。从不追踪单个字。
  function easeInOutCamera(value) {
    var t = clamp01(value)
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
  }

  function lerp(from, to, amount) { return from + (to - from) * amount }

  // 在某进度处求解 shot 镜头路径；进度可能在行间空隙略超 1，让画面继续漂移而非冻结
  function resolveTemperaCameraFrame(shot, progress) {
    var clamped = clamp01(progress)
    // 把匀速混入缓动，shot 中段永不停滞
    var eased = clamped * 0.5 + easeInOutCamera(clamped) * 0.5
    var overshoot = Math.max(0, progress - 1) * 0.35
    var amount = eased + overshoot
    var start = shot.camera
    var end = shot.cameraEnd
    return {
      x: lerp(start.x, end.x, amount),
      y: lerp(start.y, end.y, amount),
      scale: lerp(start.zoom, end.zoom, amount),
      rotation: lerp(start.rotation, end.rotation, amount)
    }
  }

  var TEMPERA_CAMERA_BREATH_MAX_OFFSET = 0.006
  var TEMPERA_CAMERA_BREATH_MAX_SCALE = 0.002
  var TEMPERA_CAMERA_BREATH_MAX_ROTATION = 0.0015

  // 确定性的手持呼吸浮动：叠加不成公约数的正弦保持漂移有机感；
  // 绝对时间求值使直接 seek 与连续播放完全一致
  function resolveTemperaCameraBreath(time, phase) {
    if (phase === undefined) phase = 0
    var tau = time * Math.PI * 2
    return {
      x: (Math.sin(tau * 0.13 + phase) * 0.65 + Math.sin(tau * 0.31 + phase * 1.7) * 0.35)
        * TEMPERA_CAMERA_BREATH_MAX_OFFSET,
      y: (Math.cos(tau * 0.11 + phase * 2.3) * 0.65 + Math.sin(tau * 0.29 + phase * 0.9) * 0.35)
        * TEMPERA_CAMERA_BREATH_MAX_OFFSET,
      scale: Math.sin(tau * 0.09 + phase * 1.3) * TEMPERA_CAMERA_BREATH_MAX_SCALE,
      rotation: Math.sin(tau * 0.07 + phase * 2.9) * TEMPERA_CAMERA_BREATH_MAX_ROTATION
    }
  }

  // 歌词揭示完成后再渐入呼吸浮动，避免在行中间突然出现
  function resolveTemperaBreathWeight(time, revealDoneTime, rampDuration) {
    if (rampDuration === undefined) rampDuration = 1.2
    if (rampDuration <= 0) return time >= revealDoneTime ? 1 : 0
    return easeInOutCamera(clamp01((time - revealDoneTime) / rampDuration))
  }

  // ---------- 段落转场（原版 temperaTransitions.ts） ----------
  // 段落边界的 seek 稳定转场帧。shot 边界不再需要：构图在运行时里直接互相交棒。
  // 这里的每种转场都由大图形或镜头领队、沿 shot 的 flow 角运行，
  // 所以出画与入画段落同向而行，边界读作一次连续的移动
  var IDLE_TEMPERA_TRANSITION_FRAME = {
    x: 0,
    y: 0,
    scale: 1,
    rotation: 0,
    alpha: 1,
    blur: 0,
    // 运行时 overlay 绘制的擦除块 0..2 行程；1 为全覆盖
    wipe: 0,
    // 擦除块扫过的方向（弧度）；与 shot flow 一致
    wipeAngle: 0
  }

  function copyIdleFrame() {
    return {
      x: IDLE_TEMPERA_TRANSITION_FRAME.x,
      y: IDLE_TEMPERA_TRANSITION_FRAME.y,
      scale: IDLE_TEMPERA_TRANSITION_FRAME.scale,
      rotation: IDLE_TEMPERA_TRANSITION_FRAME.rotation,
      alpha: IDLE_TEMPERA_TRANSITION_FRAME.alpha,
      blur: IDLE_TEMPERA_TRANSITION_FRAME.blur,
      wipe: IDLE_TEMPERA_TRANSITION_FRAME.wipe,
      wipeAngle: IDLE_TEMPERA_TRANSITION_FRAME.wipeAngle
    }
  }

  // 求解边界的一侧。exit 把出画构图沿 flow 推得更远；enter 让入画构图从上游出发、
  // 沿同一向量到达，于是交换前后屏幕上的运动方向从不改变
  function resolveTemperaTransitionEffectFrame(kind, phase, progress, flowAngle) {
    var linear = clamp01(progress)
    var eased = easeTemperaInOut(linear)
    var flowX = Math.cos(flowAngle)
    var flowY = Math.sin(flowAngle)

    if (kind === 'block-wipe') {
      // 场景保持完全不透明且原位；一块屏幕大小的块沿 flow 向量滑过，
      // 交换发生在全覆盖之下。扫程是连续的 0..2：0..1 让块进场，1..2 把它送到
      // 远端之外，块因此在边界中途从不反向
      var wipeFrame = copyIdleFrame()
      wipeFrame.wipe = phase === 'exit' ? eased : 1 + eased
      wipeFrame.wipeAngle = flowAngle
      return wipeFrame
    }

    if (kind === 'camera-pan') {
      var travel = 0.5
      // 不透明度保持到构图几乎出画为止，滑动中途才不会漏出空屏
      var offset = phase === 'exit' ? eased * travel : -(1 - eased) * travel
      var alpha = phase === 'exit'
        ? 1 - clamp01((linear - 0.72) / 0.28)
        : clamp01(linear / 0.3)
      var panFrame = copyIdleFrame()
      panFrame.x = flowX * offset
      panFrame.y = flowY * offset
      panFrame.scale = 1 + (phase === 'exit' ? eased : 1 - eased) * 0.03
      panFrame.alpha = alpha
      panFrame.wipeAngle = flowAngle
      return panFrame
    }

    // shape-carry：构图在 flow 向量上继续漂移，同时膨胀并软化，
    // 仿佛下一个图形把它拉出了焦点。无硬切、无故障
    var drift = (phase === 'exit' ? eased : eased - 1) * 0.09
    var away = phase === 'exit' ? eased : 1 - eased
    var carryFrame = copyIdleFrame()
    carryFrame.x = flowX * drift
    carryFrame.y = flowY * drift
    carryFrame.scale = 1 + away * 0.07
    carryFrame.alpha = phase === 'exit' ? 1 - clamp01((linear - 0.55) / 0.45) : clamp01(linear / 0.45)
    carryFrame.blur = away * 6
    carryFrame.wipeAngle = flowAngle
    return carryFrame
  }

  function resolveTemperaExitTransitionFrame(paragraph, time, enabled) {
    var transition = paragraph.transitionOut
    if (!enabled || !transition || time < transition.startTime) return copyIdleFrame()
    var progress = (time - transition.startTime) / Math.max(transition.endTime - transition.startTime, 0.001)
    var lastShots = paragraph.shots
    var flowAngle = lastShots.length > 0 ? lastShots[lastShots.length - 1].flowAngle : 0
    return resolveTemperaTransitionEffectFrame(transition.kind, 'exit', progress, flowAngle)
  }

  function resolveTemperaEnterTransitionFrame(kind, timeSinceStart, duration, enabled, flowAngle) {
    if (!enabled || !kind || timeSinceStart < 0 || timeSinceStart > duration) {
      return copyIdleFrame()
    }
    return resolveTemperaTransitionEffectFrame(kind, 'enter', timeSinceStart / Math.max(duration, 0.001), flowAngle)
  }

  // ---------- 入场样式（原版 temperaEnterStyles.ts） ----------
  // 一个字可以到达的方式。排版期为每个词挑选一种样式，所以一个词作为一个单元落位，
  // 相邻的词以不同方式到达——这种变化让拼贴不会读作一次统一的滑入。
  //
  // 这些刻意都是方向变体。长途飞入和单轴拉伸试过，在确定性排版面前读作噱头：
  // 这里的每种样式都只走排版期为该 shot 定好的适度距离，并等比缩放
  var TEMPERA_ENTER_STYLES = [
    'slide',
    'from-left',
    'from-right',
    'from-above',
    'from-below',
    'swing',
    'stamp'
  ]

  // 每个方向变体都复用排版已为该字选好的幅值，所以切换样式改变的是字从哪里来，
  // 而不是它要走多远
  function directional(input, travel, uniform, dirX, dirY, rotationScale) {
    var magnitude = Math.hypot(input.enterX, input.enterY)
    // 归一化，轻微的跨轴倾斜只改变来向角度而不加长距离
    var length = Math.hypot(dirX, dirY) || 1
    return {
      x: (dirX / length) * magnitude * travel,
      y: (dirY / length) * magnitude * travel,
      rotation: input.enterRotation * rotationScale * travel,
      scaleX: uniform,
      scaleY: uniform,
      echo: travel
    }
  }

  // 在入场中的某一点求解一种样式的偏移/旋转/缩放。
  // travel 在窗口上从 1 -> 0，linear 是原始 0 -> 1 进度；
  // 需要自己曲线的样式重新缓动 linear，而不是复用共享的 travel
  function resolveTemperaEnterFrame(style, input, travel, linear) {
    var settle = easeTemperaSoftBack(linear)
    var uniform = input.enterScale + (1 - input.enterScale) * settle

    switch (style) {
      case 'from-left':
        return directional(input, travel, uniform, -1, 0.12, 0.4)
      case 'from-right':
        return directional(input, travel, uniform, 1, -0.12, 0.4)
      case 'from-above':
        return directional(input, travel, uniform, 0.12, -1, 0.4)
      case 'from-below':
        return directional(input, travel, uniform, -0.12, 1, 0.4)
      case 'swing':
        // shot 自身的接近向量，但字绕自身中心旋入
        return {
          x: input.enterX * 0.6 * travel,
          y: input.enterY * 0.6 * travel,
          rotation: (input.enterRotation + Math.sign(input.enterRotation || 1) * 0.95) * travel,
          scaleX: uniform,
          scaleY: uniform,
          echo: travel * 0.8
        }
      case 'stamp':
        // 唯一的原地样式：从超大尺寸砸落到页面上。没有位移，因此也没有浮影
        return {
          x: 0,
          y: 0,
          rotation: input.enterRotation * 0.6 * travel,
          scaleX: 1 + travel * 0.7,
          scaleY: 1 + travel * 0.7,
          echo: 0
        }
      case 'slide':
      default:
        // shot 自身的扇形向量，直线进入
        return {
          x: input.enterX * travel,
          y: input.enterY * travel,
          rotation: input.enterRotation * travel,
          scaleX: uniform,
          scaleY: uniform,
          echo: travel
        }
    }
  }

  // ---------- 显示树可见性（原版 src/components/visualizer/pixiDisplayResources.ts） ----------
  // 保留的 Pixi 树离开可见集时，对后代恰好卸载一次（unload 复用 sonnet-core 的实现）
  function setPixiDisplayTreeVisibility(root, visible) {
    var wasVisible = root.visible !== false
    root.visible = visible
    if (wasVisible && !visible) window.FoliaSonnetCore.unloadSonnetDisplayTree(root)
  }

  // 主题动画强度缩放（tempera runtime 内多处使用的局部工具，原版内联于 createTemperaPixiRuntime）
  function resolveTemperaAnimationScale(theme) {
    if (!theme) return 1
    return theme.animationIntensity === 'calm' ? 0.65 : theme.animationIntensity === 'chaotic' ? 1.35 : 1
  }

  // 片尾淡出：海报在最后一个段落的歌词尾巴结束后升起
  function resolveCreditsFrame(time, finalEndTime) {
    var lyricAlpha = 1 - easeTemperaInOut((time - finalEndTime - 0.1) / 0.9)
    var posterProgress = easeTemperaInOut((time - finalEndTime - 0.9) / 1.1)
    return {
      active: time > finalEndTime + 0.35,
      lyricAlpha: lyricAlpha,
      posterAlpha: posterProgress,
      posterOffsetY: (1 - posterProgress) * 0.06,
      posterScale: 0.96 + posterProgress * 0.04
    }
  }

  window.FoliaTemperaCore = {
    TEMPERA_SHOT_KINDS: TEMPERA_SHOT_KINDS,
    TEMPERA_TRANSITION_KINDS: TEMPERA_TRANSITION_KINDS,
    TEMPERA_DECOR_MOTIFS: TEMPERA_DECOR_MOTIFS,
    DEFAULT_TEMPERA_TUNING: DEFAULT_TEMPERA_TUNING,
    hashTemperaSeed: hashTemperaSeed,
    mixTemperaSeed: mixTemperaSeed,
    temperaHash01: temperaHash01,
    chooseWithoutRepeat: chooseWithoutRepeat,
    clamp01: clamp01,
    resolveCubicBezier: resolveCubicBezier,
    easeTemperaEnter: easeTemperaEnter,
    easeTemperaInOut: easeTemperaInOut,
    easeTemperaSoftBack: easeTemperaSoftBack,
    resolveTemperaGlyphMotion: resolveTemperaGlyphMotion,
    resolveShotPacedDuration: resolveShotPacedDuration,
    resolveTemperaCameraFrame: resolveTemperaCameraFrame,
    resolveTemperaCameraBreath: resolveTemperaCameraBreath,
    resolveTemperaBreathWeight: resolveTemperaBreathWeight,
    TEMPERA_CAMERA_BREATH_MAX_OFFSET: TEMPERA_CAMERA_BREATH_MAX_OFFSET,
    TEMPERA_CAMERA_BREATH_MAX_SCALE: TEMPERA_CAMERA_BREATH_MAX_SCALE,
    TEMPERA_CAMERA_BREATH_MAX_ROTATION: TEMPERA_CAMERA_BREATH_MAX_ROTATION,
    IDLE_TEMPERA_TRANSITION_FRAME: IDLE_TEMPERA_TRANSITION_FRAME,
    resolveTemperaTransitionEffectFrame: resolveTemperaTransitionEffectFrame,
    resolveTemperaExitTransitionFrame: resolveTemperaExitTransitionFrame,
    resolveTemperaEnterTransitionFrame: resolveTemperaEnterTransitionFrame,
    TEMPERA_ENTER_STYLES: TEMPERA_ENTER_STYLES,
    resolveTemperaEnterFrame: resolveTemperaEnterFrame,
    setPixiDisplayTreeVisibility: setPixiDisplayTreeVisibility,
    resolveTemperaAnimationScale: resolveTemperaAnimationScale,
    resolveCreditsFrame: resolveCreditsFrame
  }
})()
