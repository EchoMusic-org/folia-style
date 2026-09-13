// 镜台（diorama）模式·核心数学模块：移植自 folia-major src/components/visualizer/diorama/
//   cameraPath.ts（全文：蜿蜒路径/帧/文本放置/运镜语言/程序化构图/生命周期）
//   dioramaTransition.ts（全文：切歌/循环的电影级转场数学）
//   src/types.ts 的 DioramaTuning / DEFAULT_DIORAMA_TUNING / DioramaGeometryVisibility /
//     DEFAULT_DIORAMA_GEOMETRY_VISIBILITY / 粒子密度与尘埃常量组（内联，值逐一核对）
// 全部为纯函数/常量，无 three 依赖。挂载于 window.FoliaDioramaCore。
(function () {
  'use strict'

  // ═══════════ src/types.ts 常量内联 ═══════════

  // 点云层两种互斥形态：'clouds' 逐行构图 / 'corridor' 沿路径隧道
  // DEFAULT_DIORAMA_GEOMETRY_VISIBILITY（types.ts 717 行起）
  var DEFAULT_DIORAMA_GEOMETRY_VISIBILITY = {
    enabled: true,        // 父开关
    mode: 'clouds',       // 'clouds' | 'corridor'
    strands: true,        // 盒（建筑群件）
    blobs: true,          // 柱面壳
    ribbons: true,        // 四面体晶
    rings: true           // 圆环
  }

  // 粒子密度（types.ts 726~728 行）
  var DIORAMA_PARTICLE_DENSITY_MIN = 96
  var DIORAMA_PARTICLE_DENSITY_MAX = 1536
  var DIORAMA_PARTICLE_DENSITY_STEP = 24

  // 背景尘埃两轴（types.ts 734~739 行）：圆周 = 每圈尘埃数，径向 = 壳厚层数
  var DIORAMA_MOTE_CIRCUMFERENCE_MIN = 4
  var DIORAMA_MOTE_CIRCUMFERENCE_MAX = 48
  var DIORAMA_MOTE_CIRCUMFERENCE_STEP = 2
  var DIORAMA_MOTE_RADIAL_MIN = 1
  var DIORAMA_MOTE_RADIAL_MAX = 4
  var DIORAMA_MOTE_RADIAL_STEP = 1

  // 构图整体缩放（types.ts 740~742 行）
  var DIORAMA_PARTICLE_SCALE_MIN = 0.65
  var DIORAMA_PARTICLE_SCALE_MAX = 1.6
  var DIORAMA_PARTICLE_SCALE_STEP = 0.05

  // DEFAULT_DIORAMA_TUNING（types.ts 788~903 行）
  var DEFAULT_DIORAMA_TUNING = {
    cameraSpeed: 1,
    motionAmount: 1,
    audioReactivity: 1,
    geometryVisibility: DEFAULT_DIORAMA_GEOMETRY_VISIBILITY,
    particleDensity: 576,
    particleScale: 1,
    particleGlowEnabled: true,
    particleGlowIntensity: 0.65,
    showParticles: true,
    backgroundParticleCircumference: 28,
    backgroundParticleRadial: 2,
    glowEnabled: true,
    glowIntensity: 1,
    soulEnabled: true,
    soulIntensity: 1,
    soulActiveEnabled: false,
    gradientEnabled: false,
    gradientIntensity: 1,
    keywordColoringEnabled: true
  }

  // ═══════════ cameraPath.ts 全文 ═══════════

  /** 每行歌词沿路径推进的距离。 */
  var DIORAMA_STEP_DISTANCE = 8
  /** 路径偏航/俯仰的最大弧度（有界摆动保证走廊蜿蜒前进、永不折返）。 */
  var DIORAMA_MAX_YAW = 0.5
  var DIORAMA_MAX_PITCH = 0.32
  /** 相机落后读头的距离（主构图距离）。小于步距保证一行唱完即被越过。 */
  var DIORAMA_HERO_DISTANCE = 5.2
  /** 相机在行局部 up 上的基础抬升。 */
  var DIORAMA_CAMERA_LIFT = 0.5
  /** 跟随唱词横移时可用的画面宽度占比。 */
  var DIORAMA_SAFE_FRAME_FRACTION = 0.92
  /** 叠加在运镜之上的手持呼吸漂移的基础振幅（世界单位）。 */
  var DIORAMA_SWAY_AMP = 0.4
  var DIORAMA_LIFT_AMP = 0.4
  var DIORAMA_DIST_AMP = 0.5
  /** 相机落后此距离（快进跳转）时直接吸附而不是飞越整首歌。 */
  var DIORAMA_SNAP_DISTANCE = 24
  /** 逐行文本变换界（见 getDioramaTextPlacement）。 */
  var DIORAMA_TEXT_OFFSET_R = 1.8
  var DIORAMA_TEXT_OFFSET_U = 1.2
  var DIORAMA_TEXT_ROLL = 0.2
  var DIORAMA_TEXT_YAW = 0.16
  var DIORAMA_TEXT_LOOK = 1.1
  /** 形体生命周期距离（离相机的世界单位）：远端雾中诞生，近端熔解消失。 */
  var DIORAMA_SHAPE_FADE_IN_START = 20
  var DIORAMA_SHAPE_FADE_IN_END = 27
  var DIORAMA_SHAPE_DISSOLVE_START = 3.0
  var DIORAMA_SHAPE_DISSOLVE_END = 1.2

  var DEG_TO_RAD = Math.PI / 180

  function clamp01(value) { return Math.min(1, Math.max(0, value)) }
  function clamp(value, min, max) { return Math.min(max, Math.max(min, value)) }

  var vsub = function (a, b) { return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z } }
  var vcross = function (a, b) {
    return {
      x: a.y * b.z - a.z * b.y,
      y: a.z * b.x - a.x * b.z,
      z: a.x * b.y - a.y * b.x
    }
  }
  var vnorm = function (a) {
    var len = Math.hypot(a.x, a.y, a.z) || 1
    return { x: a.x / len, y: a.y / len, z: a.z / len }
  }
  var vadd = function (a, b) { return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z } }

  // 确定性伪随机 [0,1)：同一行号永远映射同一值——seek 不重洗走廊/运镜/构图
  function seededUnit(seed) {
    var x = Math.sin(seed * 12.9898) * 43758.5453
    return x - Math.floor(x)
  }

  function hashSeed(seed) {
    if (typeof seed === 'number') return seed
    if (!seed) return 1
    var hash = 0
    for (var i = 0; i < seed.length; i += 1) {
      hash = (hash * 31 + seed.charCodeAt(i)) % 100000
    }
    return hash || 1
  }

  /**
   * Unity 风格临界阻尼 SmoothDamp（单标量）。与指数插值的"先冲后缓"不同，
   * 它携带速度、入出双端缓动，阶梯目标（读头跳行）被跟随成平滑加减速而非折角。
   */
  function smoothDamp(current, target, velocity, smoothTime, deltaSeconds) {
    var t = Math.max(0.0001, smoothTime)
    var omega = 2 / t
    var x = omega * deltaSeconds
    var exp = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x)
    var change = current - target
    var temp = (velocity + omega * change) * deltaSeconds
    var newVelocity = (velocity - omega * temp) * exp
    var value = target + (change + temp) * exp
    return { value: value, velocity: newVelocity }
  }

  /** 透视相机在 `distance` 处可见的半宽（three 的 fov 为垂直方向）。 */
  function frameHalfWidth(distance, verticalFovDeg, aspect) {
    return distance * Math.tan((verticalFovDeg * DEG_TO_RAD) / 2) * aspect
  }

  // ─── 运动参数：tuning + 子模式 → 一个缩放包 ─────────────────────────────

  // 子模式预设（theme.animationIntensity 决定，滑条在其上相乘）
  var DIORAMA_SUB_MODE_PRESETS = {
    normal: { move: 1, drift: 0.62, smooth: 0.42, audio: 1, weave: 1 },
    calm: { move: 0.6, drift: 0.4, smooth: 0.56, audio: 0.5, weave: 0.5 },
    chaotic: { move: 1.35, drift: 0.85, smooth: 0.33, audio: 1.35, weave: 1.35 }
  }

  /**
   * 解析 tuning + 主题为全 diorama 共用的运动缩放包。
   * 相机风格永远跟随主题 animationIntensity；滑条（cameraSpeed/motionAmount/audioReactivity）其上相乘。
   */
  function resolveDioramaMotionParams(tuning, themeIntensity) {
    var t = tuning || DEFAULT_DIORAMA_TUNING
    var mode = themeIntensity === 'calm' ? 'calm' : themeIntensity === 'chaotic' ? 'chaotic' : 'normal'
    var preset = DIORAMA_SUB_MODE_PRESETS[mode]
    var motion = clamp(t.motionAmount, 0.4, 1.6)
    var speed = clamp(t.cameraSpeed, 0.55, 1.85)
    var audio = clamp(t.audioReactivity, 0, 1.5)
    return {
      moveScale: preset.move * motion,
      driftScale: preset.drift * motion,
      smoothTime: preset.smooth / speed,
      audioLevel: preset.audio * audio,
      weaveScale: preset.weave * motion,
      subMode: mode
    }
  }

  // ─── 蜿蜒路径与逐行帧 ─────────────────────────────────────────────

  var WORLD_UP = { x: 0, y: 1, z: 0 }
  var DEFAULT_FRAME = {
    position: { x: 0, y: 0, z: 0 },
    forward: { x: 0, y: 0, z: -1 },
    right: { x: 1, y: 0, z: 0 },
    up: { x: 0, y: 1, z: 0 }
  }

  /**
   * 为一首歌一次性建好整条走廊："乌龟"逐行前进，朝向按有界种子摆动偏航/俯仰。
   * forward 的 -z 分量恒负，路径永远前进。每行取行进切线的局部帧
   * （right = travel × world-up，与文本从左到右阅读方向一致；up 补全正交基）。
   */
  function buildDioramaPath(count, seed) {
    var base = hashSeed(seed)
    var n = Math.max(count, 1)

    // 多建一个位置，让最后一行仍有前向切线（positions[i+1] - positions[i]）
    var positions = []
    var pos = { x: 0, y: 0, z: 0 }
    for (var i = 0; i <= n; i += 1) {
      positions.push({ x: pos.x, y: pos.y, z: pos.z })
      var yaw = DIORAMA_MAX_YAW * (Math.sin(i * 0.23 + base * 0.017) * 0.62 + Math.sin(i * 0.11 + base * 0.041 + 1.3) * 0.38)
      var pitch = DIORAMA_MAX_PITCH * Math.sin(i * 0.17 + base * 0.029 + 0.7)
      var cp = Math.cos(pitch)
      var dir = { x: Math.sin(yaw) * cp, y: Math.sin(pitch), z: -Math.cos(yaw) * cp }
      pos = {
        x: pos.x + dir.x * DIORAMA_STEP_DISTANCE,
        y: pos.y + dir.y * DIORAMA_STEP_DISTANCE,
        z: pos.z + dir.z * DIORAMA_STEP_DISTANCE
      }
    }

    var frames = []
    for (var j = 0; j < n; j += 1) {
      var forward = vnorm(vsub(positions[j + 1], positions[j]))
      // right = forward × worldUp 在 forward=-z 时给出 +x，匹配阅读方向
      // （俯仰远小于 90°，forward 不会平行 worldUp，叉积稳定）
      var right = vnorm(vcross(forward, WORLD_UP))
      var up = vnorm(vcross(right, forward))
      frames.push({ position: positions[j], forward: forward, right: right, up: up })
    }
    return frames
  }

  /** 帧查找——钳制范围，空路径回退直行帧。 */
  function getFrame(frames, index) {
    if (frames.length === 0) return DEFAULT_FRAME
    var i = Math.min(Math.max(index, 0), frames.length - 1)
    return frames[i] || DEFAULT_FRAME
  }

  /**
   * 把新建走廊整体平移到新世界原点。纯平移——只动锚点，方向不变——
   * 走廊保持精确蜿蜒形状与直立基，只是放在世界另一处。
   */
  function translateFrames(frames, offset) {
    return frames.map(function (f) {
      return { position: vadd(f.position, offset), forward: f.forward, right: f.right, up: f.up }
    })
  }

  /** 在帧内合成局部 (right, up, depth) 偏移为世界点。depth 正值沿路径向前。 */
  function composeLocal(frame, right, up, depth) {
    return {
      x: frame.position.x + frame.right.x * right + frame.up.x * up + frame.forward.x * depth,
      y: frame.position.y + frame.right.y * right + frame.up.y * up + frame.forward.y * depth,
      z: frame.position.z + frame.right.z * right + frame.up.z * up + frame.forward.z * depth
    }
  }

  /**
   * 沿帧 right 的横向跟词偏移。平滑饱和曲线（tanh）而非硬钳制：
   * 短行快速饱和（只轻微跟随），长行跟得更远以保住唱词在画面内，极限处无导数折角。
   */
  function resolveReadHeadTruck(wordProgress, trackWidth, visibleHalfWidth) {
    if (trackWidth <= 0) return 0
    var wordOffset = (clamp01(wordProgress) - 0.5) * trackWidth
    var allowed = Math.max(Math.abs(visibleHalfWidth - trackWidth / 2), 0.001)
    return allowed * Math.tanh(wordOffset / allowed)
  }

  // ─── 逐行自由文本放置 ─────────────────────────────────────────────

  /**
   * 歌词行相对路径帧的位置与姿态。低频正弦保连贯，其上叠加逐行种子抖动；
   * scale/roll/yaw/look 逐行种子化。全部随 weave（子模式/滑条）缩放，逐行/种子确定。
   */
  function getDioramaTextPlacement(lineIndex, seed, weave) {
    if (weave === undefined) weave = 1
    var base = hashSeed(seed)
    var i = Math.max(lineIndex, 0)
    var jitterR = (seededUnit(base + i * 11 + 2) - 0.5) * 0.6
    var jitterU = (seededUnit(base + i * 11 + 4) - 0.5) * 0.6
    var wanderR = Math.sin(i * 0.47 + base * 0.019) * 0.7 + jitterR
    var wanderU = Math.sin(i * 0.29 + base * 0.027 + 0.9) * 0.7 + jitterU
    return {
      offsetR: wanderR * DIORAMA_TEXT_OFFSET_R * weave,
      offsetU: wanderU * DIORAMA_TEXT_OFFSET_U * weave,
      scale: 0.82 + seededUnit(base + i * 11 + 5) * 0.46,
      roll: (seededUnit(base + i * 11 + 6) - 0.5) * 2 * DIORAMA_TEXT_ROLL * weave,
      yaw: (seededUnit(base + i * 11 + 7) - 0.5) * 2 * DIORAMA_TEXT_YAW * weave,
      lookR: (seededUnit(base + i * 11 + 8) - 0.5) * 2 * DIORAMA_TEXT_LOOK * weave
    }
  }

  // ─── 运镜语言：13 种电影化运镜 ─────────────────────────────────────

  var SHOT_KINDS = [
    'pushIn', 'pullBack', 'orbit', 'track', 'crane', 'hold', 'swell', 'spiral', 'pendulum', 'flyby',
    'arc', 'float', 'glide'
  ]

  // smoothstep 0..1——运镜弧线入出缓动，线性进度也读作手动操作
  function easeInOut(p) {
    var c = clamp01(p)
    return c * c * (3 - 2 * c)
  }

  var CHORUS_PART = /chorus|hook|refrain|drop/i

  // 行运镜的左右手性（orbit 往哪边摆、flyby 从哪边过）。resolveShotOffset 与 buildFormation 共享，
  // 保证群件建在相机会用到的那一侧。
  function getShotDir(lineIndex, seed) {
    return seededUnit(hashSeed(seed) + lineIndex * 7 + 3) < 0.5 ? -1 : 1
  }

  // 一行上最长/平均唱音时长（按词时间轴）。长音想要大慢镜（swell/spiral），短音串想要利落的 track/flyby。
  function getLineNoteProfile(line) {
    var maxNote = 0
    var sum = 0
    var noteCount = 0
    var words = (line && line.words) || []
    for (var i = 0; i < words.length; i += 1) {
      var d = words[i].endTime - words[i].startTime
      if (d > 0) {
        maxNote = Math.max(maxNote, d)
        sum += d
        noteCount += 1
      }
    }
    return { maxNote: maxNote, avgNote: noteCount > 0 ? sum / noteCount : 0, noteCount: noteCount }
  }

  // 按行特征为每种运镜原型加权。永不让权重归零，每种运镜都可达。
  function computeShotWeights(lineIndex, lines, subMode) {
    if (subMode === undefined) subMode = 'normal'
    var line = lines[lineIndex]
    var prev = lineIndex > 0 ? lines[lineIndex - 1] : undefined
    var wordCount = (line && line.words && line.words.length) || 0
    var isChorus = !!(line && line.isChorus) || (line && CHORUS_PART.test(line.songPart || ''))
    var sectionStart = !!line && !!prev && ((line.blockIndex !== prev.blockIndex) || (line.songPart || '') !== (prev.songPart || ''))
    var noteProfile = getLineNoteProfile(line)
    var maxNote = noteProfile.maxNote
    var avgNote = noteProfile.avgNote
    var noteCount = noteProfile.noteCount
    var hasLongNote = maxNote >= 1.3
    var staccato = noteCount >= 4 && avgNote > 0 && avgNote <= 0.34

    var w = {
      pushIn: 1, pullBack: 1, orbit: 1, track: 1, crane: 1, hold: 1, swell: 0.85,
      spiral: 0.9, pendulum: 1, flyby: 0.9, arc: 1, float: 0.9, glide: 1
    }
    if (isChorus) {
      w.orbit += 2.4
      w.pushIn += 1.8
      w.spiral += 1.2
      w.crane += 0.8
      w.flyby += 0.6
      w.arc += 1.0
      w.glide += 0.6
      w.hold -= 0.6
      w.track -= 0.2
    } else {
      w.track += 1.1
      w.crane += 0.9
      w.hold += 0.9
      w.pendulum += 0.8
      w.float += 0.8
      w.glide += 0.6
      w.arc += 0.4
    }
    if (wordCount >= 8) {
      w.track += 1.6
      w.pullBack += 1
      w.orbit -= 0.4
      w.pushIn -= 0.3
    } else if (wordCount <= 3) {
      w.pushIn += 1.4
      w.orbit += 0.9
      w.hold += 0.5
      w.track -= 0.8
    }
    if (sectionStart) {
      w.pullBack += 2.2
      w.crane += 1.4
      w.glide += 1.0
      w.pushIn -= 0.4
    }
    if (hasLongNote) {
      w.swell += 2.4
      w.spiral += 1.0
      w.float += 1.2
      w.pendulum += 0.6
      w.orbit += 0.8
      w.arc += 0.6
      w.hold += 0.3
      w.track -= 0.5
    }
    if (staccato) {
      w.track += 1.4
      w.flyby += 1.5
      w.pushIn += 0.8
      w.swell -= 1.6
      w.hold -= 0.8
      w.crane -= 0.4
    }

    // 子模式性格：calm 偏沉稳静态并压制大幅空间摆动；chaotic 偏动态空间变化、压制静止
    if (subMode === 'calm') {
      w.hold += 1.4
      w.float += 1.3
      w.swell += 0.9
      w.glide += 0.8
      w.arc += 0.5
      w.crane += 0.4
      w.orbit *= 0.4
      w.spiral *= 0.35
      w.flyby *= 0.3
      w.pendulum *= 0.5
      w.pushIn *= 0.7
    } else if (subMode === 'chaotic') {
      w.orbit += 1.3
      w.spiral += 1.3
      w.flyby += 1.2
      w.pendulum += 1.0
      w.pushIn += 0.8
      w.arc += 0.6
      w.crane += 0.4
      w.hold *= 0.35
      w.float *= 0.55
      w.swell *= 0.7
    }

    for (var k = 0; k < SHOT_KINDS.length; k += 1) {
      w[SHOT_KINDS[k]] = Math.max(0.05, w[SHOT_KINDS[k]])
    }
    return w
  }

  function weightedPickShot(weights, u) {
    var total = 0
    for (var t = 0; t < SHOT_KINDS.length; t += 1) total += weights[SHOT_KINDS[t]]
    var acc = clamp01(u) * total
    for (var i = 0; i < SHOT_KINDS.length; i += 1) {
      acc -= weights[SHOT_KINDS[i]]
      if (acc <= 0) return SHOT_KINDS[i]
    }
    return 'hold'
  }

  function basePickShot(lineIndex, lines, seed, subMode) {
    if (subMode === undefined) subMode = 'normal'
    if (!lines[lineIndex]) return 'hold'
    var u = seededUnit(hashSeed(seed) + lineIndex * 101 + 7)
    return weightedPickShot(computeShotWeights(lineIndex, lines, subMode), u)
  }

  /**
   * 行的运镜原型：加权选取，但若与前两行的选型撞车则换成别的原型——
   * 避免少数运镜扎堆。去重只看 basePickShot(prev)，不递归，保持 O(1)。
   */
  function getDioramaShot(lineIndex, lines, seed, subMode) {
    if (subMode === undefined) subMode = 'normal'
    var pick = basePickShot(lineIndex, lines, seed, subMode)
    var prev1 = lineIndex > 0 ? basePickShot(lineIndex - 1, lines, seed, subMode) : null
    var prev2 = lineIndex > 1 ? basePickShot(lineIndex - 2, lines, seed, subMode) : null
    if (pick === prev1 || pick === prev2) {
      var others = SHOT_KINDS.filter(function (k) { return k !== pick && k !== prev1 && k !== prev2 })
      var pool = others.length > 0 ? others : SHOT_KINDS.filter(function (k) { return k !== pick })
      var alt = seededUnit(hashSeed(seed) + lineIndex * 53 + 19)
      return pool[Math.floor(clamp01(alt) * pool.length) % pool.length]
    }
    return pick
  }

  /**
   * 运镜原型 + 进度 → 行局部帧内的相机偏移（right / up / back）。
   * 相机 Rig 与帧向量合成，orbit 等运镜在路径真实局部水平面内摆动。
   * 偏离中性跟随姿态的幅度随 moveScale 缩放。
   */
  function resolveShotOffset(kind, ctx) {
    var hero = ctx.hero
    var lift = ctx.lift
    var seed = ctx.seed
    var lineIndex = ctx.lineIndex
    var e = easeInOut(ctx.progress)
    var dir = getShotDir(lineIndex, seed)

    var right = 0
    var up = lift
    var back = hero

    switch (kind) {
      case 'pushIn':
        // 全行推进拉近，文本放大充满画面——亲密/高潮
        back = hero * (1.5 - 0.8 * e)
        up = lift * (1.2 - 0.5 * e) + 0.15
        break
      case 'pullBack':
        // 后退升高，展开周围构图——揭示/段落呼吸
        back = hero * (0.85 + 1.15 * e)
        up = lift + 1.7 * e
        break
      case 'orbit': {
        // 近恒距绕行，环形群件从居中文本背后扫过
        var theta = dir * 0.55 * (2 * e - 1)
        right = hero * Math.sin(theta)
        back = hero * Math.cos(theta)
        up = lift + 0.4
        break
      }
      case 'track':
        // 随唱词滑动并向侧面微倾，柱列从眼前掠过——轨道跟拍
        right = dir * hero * 0.34 * Math.sin(Math.PI * clamp01(ctx.wordProgress))
        back = hero * 1.06
        up = lift + 0.12
        break
      case 'crane': {
        // 在拱下垂直升降（低角仰拍/高角俯拍），视线锁定文本
        var from = dir > 0 ? -1.5 : 2.4
        var to = dir > 0 ? 2.4 : -1.4
        up = from + (to - from) * e
        back = hero * 1.05
        break
      }
      case 'swell': {
        // 长延音：横跨整音的缓慢大幅滑行，同时升起后退——"屏息"运镜
        var thetaS = dir * 0.4 * e
        right = hero * Math.sin(thetaS) * 1.1
        back = hero * (1.0 + 0.35 * e)
        up = lift + 1.2 * e + 0.3
        break
      }
      case 'spiral': {
        // 上升螺旋：绕弧同时从行下方爬到上方——螺旋群件随盘旋掠过
        var thetaP = dir * 0.7 * (2 * e - 1)
        right = hero * Math.sin(thetaP) * 0.85
        back = hero * (1.05 - 0.1 * e)
        up = lift - 0.8 + 2.4 * e
        break
      }
      case 'pendulum': {
        // 悬挂摆：横扫并在行中段沉入弧底，两端最高
        right = dir * hero * 0.45 * (2 * e - 1)
        up = lift + 0.9 - 0.9 * Math.sin(Math.PI * e)
        back = hero * 1.02
        break
      }
      case 'flyby': {
        // 近距侧飞：从一侧略前方出发，横穿行面，从另一侧离开
        right = dir * hero * (0.7 - 1.4 * e)
        back = hero * (0.78 + 0.12 * Math.sin(Math.PI * e))
        up = lift + 0.05
        break
      }
      case 'arc': {
        // 宽幅优雅横弧：摆出行再摆回，始终正面
        var thetaA = dir * 0.5 * Math.sin(Math.PI * e)
        right = hero * Math.sin(thetaA) * 1.3
        back = hero * (1.05 + 0.12 * (1 - Math.cos(thetaA)))
        up = lift + 0.5 * Math.sin(Math.PI * e)
        break
      }
      case 'float': {
        // 梦境悬浮：缓慢的垂直/横向 lissajous 微漂
        right = dir * hero * 0.16 * Math.sin(e * Math.PI * 2)
        up = lift + 0.6 + 0.5 * Math.sin(e * Math.PI * 2 + 1.0)
        back = hero * (1.05 + 0.06 * Math.sin(e * Math.PI))
        break
      }
      case 'glide': {
        // 优雅上升对角线：升高的同时微拉近
        right = dir * hero * 0.22 * e
        up = lift + 1.4 * e
        back = hero * (1.15 - 0.25 * e)
        break
      }
      case 'hold':
      default:
        // 近乎锁定——刻意的静止做对比
        up = lift + 0.3 * Math.sin(ctx.progress * Math.PI)
        back = hero
        break
    }

    // 对"偏离中性跟随姿态"的幅度整体缩放（right 0 / up lift / back hero）
    var m = ctx.moveScale
    return {
      right: right * m,
      up: lift + (up - lift) * m,
      back: hero + (back - hero) * m
    }
  }

  // 一行结束后镜头开始"回正"的等待秒数与回正时长（3s = 插曲行填隙阈值）
  var HOLD_SETTLE_DELAY = 3
  var HOLD_SETTLE_EASE = 5

  /**
   * 行的阅读构图在阅读窗口关闭 `secondsHeld` 秒后还剩多少。
   * 1 保持整行与普通间隙，超过 3s 后缓动到 0（构图三件套同时释放）。
   */
  function resolveHoldSettle(secondsHeld) {
    var t = clamp01((secondsHeld - HOLD_SETTLE_DELAY) / HOLD_SETTLE_EASE)
    return 1 - t * t * (3 - 2 * t)
  }

  /**
   * 叠加在运镜上的持续手持呼吸，慢分层正弦驱动。scale 为绝对漂移幅度
   * （params.driftScale），seed 逐歌偏移相位。
   */
  function resolveCameraDrift(time, seed, scale) {
    var ph = hashSeed(seed) * 0.017
    return {
      swayX: (Math.sin(time * 0.11 + ph) * 0.6 + Math.sin(time * 0.047 + ph * 1.7) * 0.4) * DIORAMA_SWAY_AMP * scale,
      swayY: Math.sin(time * 0.09 + ph * 0.7) * DIORAMA_SWAY_AMP * 0.5 * scale,
      lift: (Math.sin(time * 0.13 + ph * 1.3) * 0.6 + Math.sin(time * 0.061 + ph * 2.1) * 0.4) * DIORAMA_LIFT_AMP * scale,
      dist: Math.sin(time * 0.05 + ph * 1.1) * DIORAMA_DIST_AMP * scale
    }
  }

  // ─── 程序化几何构图 ───────────────────────────────────────────────

  var DIORAMA_PARTICLE_AUDIO_SCALE_MAX = 1.44

  // 两个云簇相隔多少行仍可能碰撞（原版 dioramaGeometry.ts）：
  // 行距 8，任何簇的净空远小于 16 单位，更远的对手不可能阻挡任何判定
  var DIORAMA_CLUSTER_COLLISION_LINE_SPAN = 2

  // 构图件设计在局部空间（相对行帧 + 文本偏移的 right/up/depth），
  // 重叠分离与文本净空带在统一空间内完成后再合成到世界。
  function getSpecClearanceRadius(spec) {
    var familyRadius = spec.kind === 'box'
      ? 0.5
      : spec.kind === 'sphere'
        ? 0.74
        : spec.kind === 'cone'
          ? 0.68
          : 0.9
    return spec.scale * Math.max(familyRadius, spec.stretchY * 0.55)
  }

  // 把近于视觉足迹的任意两件推开，再把深度重新钳回文本面之后
  function separateSpecs(specs) {
    for (var iter = 0; iter < 6; iter += 1) {
      for (var a = 0; a < specs.length; a += 1) {
        for (var b = a + 1; b < specs.length; b += 1) {
          var A = specs[a]
          var B = specs[b]
          var minDist = (getSpecClearanceRadius(A) + getSpecClearanceRadius(B)) * 1.3
          var dr = B.r - A.r
          var du = B.u - A.u
          var dd = B.d - A.d
          var dist = Math.hypot(dr, du, dd)
          if (dist >= minDist) continue
          if (dist < 0.001) {
            dr = 1
            du = 0.5
            dd = 0.25
            dist = Math.hypot(dr, du, dd)
          }
          var push = (minDist - dist) / 2 / dist
          A.r -= dr * push
          A.u -= du * push
          A.d -= dd * push
          B.r += dr * push
          B.u += du * push
          B.d += dd * push
        }
      }
    }
    specs.forEach(function (s) { s.d = Math.max(s.d, 1) })
  }

  // 围绕文本行保留横向净空带：处于文本高度的构件被推出最长行半宽之外
  var TEXT_CLEAR_LATERAL = 5.2
  var TEXT_CLEAR_VERTICAL = 1.4
  function enforceTextClearance(specs) {
    specs.forEach(function (s, i) {
      var radius = getSpecClearanceRadius(s) * DIORAMA_PARTICLE_AUDIO_SCALE_MAX
      if (Math.abs(s.u) - radius < TEXT_CLEAR_VERTICAL && Math.abs(s.r) - radius < TEXT_CLEAR_LATERAL) {
        var side = s.r === 0 ? (i % 2 === 0 ? 1 : -1) : Math.sign(s.r)
        s.r = side * (TEXT_CLEAR_LATERAL + radius + 0.35)
      }
    })
  }

  // 让整朵云的足迹保持在相机/歌词轨道之外（不只是锚点）
  function enforceRailClearance(specs) {
    specs.forEach(function (s, i) {
      var radius = getSpecClearanceRadius(s) * DIORAMA_PARTICLE_AUDIO_SCALE_MAX
      var minimum = 2.8 + radius
      var distance = Math.hypot(s.r, s.u)
      if (distance >= minimum) return
      var fallbackAngle = (i % 2 === 0 ? 1 : -1) * Math.PI * 0.16
      var directionR = distance > 0.001 ? s.r / distance : Math.cos(fallbackAngle)
      var directionU = distance > 0.001 ? s.u / distance : Math.sin(fallbackAngle)
      s.r = directionR * minimum
      s.u = directionU * minimum
    })
  }

  /**
   * 为一行生长程序化几何构图，形制匹配其运镜：orbit 配环、pushIn 配门柱、
   * track 配柱列、crane 配拱、spiral 配螺旋、pendulum 配悬垂、flyby 配轨、
   * swell 配图腾、pullBack 配揭示群、hold 配稀疏散布。每行只用一种基元族，
   * 柱/杆垂直拉伸，跑重叠分离 + 文本净空带，深度 >= 0.25（永在文本面之后）。
   * 以行的实际文本放置偏移为中心。
   */
  function buildFormation(lineIndex, seed, shot, frame, placement, volumeScale) {
    if (volumeScale === undefined) volumeScale = 1
    var salt = hashSeed(seed) + lineIndex * 97
    var rnd = function (k) { return seededUnit(salt + k) }
    var dir = getShotDir(lineIndex, seed)
    var specs = []
    var safeVolumeScale = Math.min(1.6, Math.max(0.65, volumeScale))
    var add = function (kind, r, u, d, scale, stretchY, colorSlot) {
      if (stretchY === undefined) stretchY = 1
      specs.push({ kind: kind, r: r, u: u, d: d, scale: scale * safeVolumeScale, stretchY: stretchY, upright: stretchY > 1.2, colorSlot: colorSlot })
    }
    var addPair = function (kind, lateral, u, d, scale, stretchY, colorSlot) {
      if (stretchY === undefined) stretchY = 1
      if (colorSlot === undefined) colorSlot = 0
      add(kind, -Math.abs(lateral), u, d, scale, stretchY, colorSlot)
      add(kind, Math.abs(lateral), u, d, scale, stretchY, colorSlot)
    }

    switch (shot) {
      case 'orbit': {
        // 稀疏液珠轨道 + 一只环点缀（重复环会读成嵌套眩光）
        var count = 6
        var radius = 4.4 + rnd(1) * 0.6
        for (var j = 0; j < count; j += 1) {
          var a = (j / count) * Math.PI * 2 + rnd(2) * 0.6
          add(j === 0 ? 'torus' : 'sphere', Math.cos(a) * radius, Math.sin(a) * radius, 0.6 + rnd(10 + j) * 1.4, 0.42 + rnd(20 + j) * 0.32)
        }
        break
      }
      case 'pushIn': {
        // 两侧门柱供推进穿越，另有两根更远的立柱
        var gate = 4.3 + rnd(1) * 0.5
        var sides = [-1, 1]
        for (var gi = 0; gi < 2; gi += 1) {
          var side = sides[gi]
          add('box', side * gate, -0.6, 0.5 + rnd(gi) * 0.5, 0.55 + rnd(2 + gi) * 0.2, 2.8 + rnd(6 + gi) * 0.8)
          add('box', side * (gate + 1.6), 0.6, 4.5 + rnd(3 + gi) * 2, 0.7 + rnd(4 + gi) * 0.3, 3.4)
        }
        break
      }
      case 'track': {
        // 两侧向后收退的柱列，横向跟拍从中掠过——均匀节奏
        for (var si = 0; si < 2; si += 1) {
          var sside = si === 0 ? -1 : 1
          for (var tj = 0; tj < 3; tj += 1) {
            add('box', sside * (4.2 + rnd(si * 5 + tj) * 0.4), -0.4 + (rnd(si * 7 + tj) - 0.5) * 0.6, 0.5 + tj * 2.4, 0.5 + rnd(si * 3 + tj) * 0.15, 2.6 + rnd(si + tj) * 0.6)
          }
        }
        break
      }
      case 'crane': {
        // 顶拱，升降从其下方穿过（保持在文本上方，永不遮挡）
        var ccount = 5
        var cradius = 3.6 + rnd(1) * 0.5
        for (var cj = 0; cj < ccount; cj += 1) {
          var ca = Math.PI * (0.15 + 0.7 * (cj / (ccount - 1)))
          add('box', Math.cos(ca) * cradius, Math.abs(Math.sin(ca)) * cradius + 1.2, 0.6 + rnd(30 + cj) * 0.8, 0.45 + rnd(40 + cj) * 0.25, 1.4)
        }
        break
      }
      case 'swell': {
        // 镜像升腾图腾，避免云团全堆一侧
        var lat = 4.2 + rnd(2) * 0.5
        for (var sj = 0; sj < 2; sj += 1) {
          addPair('box', lat, -1.5 + sj * 2.1, 1 + sj * 1.2, 0.48 - sj * 0.06, 1.45, sj % 2)
        }
        addPair('sphere', lat, 2.65, 3.4, 0.5, 1, 0)
        break
      }
      case 'spiral': {
        // 文本后方盘升的珠链螺旋，匹配螺旋爬升
        var pcount = 7
        var pradius = 4.3
        for (var pj = 0; pj < pcount; pj += 1) {
          var frac = pj / (pcount - 1)
          var pa = dir * frac * Math.PI * 2.2 + rnd(1) * 0.5
          add('sphere', Math.cos(pa) * pradius, -2.2 + frac * 5.2, 0.5 + frac * 2.2, 0.32 + rnd(20 + pj) * 0.2)
        }
        break
      }
      case 'pendulum': {
        // 行上方的悬挂吊杆群，摆动从其下方掠过
        for (var dj = 0; dj < 4; dj += 1) {
          add('box', -3.9 + dj * 2.6 + (rnd(dj) - 0.5) * 0.5, 3.0 + rnd(dj * 2) * 1.2, 0.5 + rnd(dj * 3) * 1.2, 0.3 + rnd(dj * 4) * 0.12, 2.2 + rnd(dj * 5) * 0.8)
        }
        break
      }
      case 'flyby': {
        // 镜像轨保住畅通飞行通道与双侧规则节奏
        for (var fj = 0; fj < 3; fj += 1) {
          addPair('box', 4.25 + rnd(fj) * 0.25, -0.45 + fj * 0.45, 1 + fj * 2.1, 0.42 + rnd(fj * 3) * 0.1, 2.2, fj % 2)
        }
        break
      }
      case 'pullBack': {
        // 平衡的纵深揭示（替代旧的单侧堆叠与超大主角球）
        addPair('sphere', 5.8 + rnd(9) * 0.5, 1.25, 6.8 + rnd(11), 1.25 + rnd(12) * 0.25, 1, 0)
        for (var rj = 0; rj < 2; rj += 1) {
          addPair(rj === 0 ? 'box' : 'cone', 4.4 + rj * 1.15, -1.4 + rj * 2.2, 2.2 + rj * 2.1, 0.58 + rnd(rj * 4) * 0.18, rj === 0 ? 1.5 : 1, 1)
        }
        break
      }
      case 'arc': {
        // 浅弧柱列，横弧从远处掠过
        var acount = 5
        var aradius = 5.2 + rnd(1) * 0.6
        for (var aj = 0; aj < acount; aj += 1) {
          var aa = (-0.5 + aj / (acount - 1)) * 1.5 * dir
          add(aj === Math.floor(acount / 2) ? 'torus' : 'sphere', Math.sin(aa) * aradius, 0.3 + Math.cos(aa) * 0.7, 1.0 + rnd(20 + aj) * 1.6, 0.45 + rnd(30 + aj) * 0.32)
        }
        break
      }
      case 'float': {
        // 三排镜像珠行，失重感而不在歌词轨道附近随机结块
        for (var lj = 0; lj < 3; lj += 1) {
          addPair('sphere', 4.1 + lj * 0.85, -1.2 + lj * 1.35, 1.2 + lj * 1.55, 0.42 + rnd(lj * 4) * 0.22, 1, lj % 2)
        }
        break
      }
      case 'glide': {
        // 镜像升腾塔架框住滑升，而非挤成一面墙
        for (var gj = 0; gj < 3; gj += 1) {
          addPair('box', 4.25 + rnd(gj) * 0.3, -1.5 + gj * 1.7, 1 + gj * 1.7, 0.46 + rnd(gj * 2) * 0.12, 1.85, gj % 2)
        }
        break
      }
      case 'hold':
      default: {
        // 一对安静的环 + 一对更近的珠，构成有序的静框
        addPair('torus', 5.6, 1.55, 7.2 + rnd(1), 1.05 + rnd(2) * 0.2, 1, 0)
        addPair('sphere', 4.45, -1.1, 2.1 + rnd(4), 0.58 + rnd(5) * 0.16, 1, 1)
        break
      }
    }

    enforceRailClearance(specs)
    enforceTextClearance(specs)
    separateSpecs(specs)
    enforceRailClearance(specs)
    enforceTextClearance(specs)

    return specs.map(function (s, j) {
      return {
        kind: s.kind,
        position: composeLocal(frame, placement.offsetR + s.r, placement.offsetU + s.u, s.d),
        scale: s.scale,
        stretchY: s.stretchY,
        upright: s.upright,
        spinSpeed: 0.04 + rnd(j * 13 + 5) * 0.1,
        colorSlot: s.colorSlot === undefined ? (j % 2) : s.colorSlot,
        layer: s.d > 3.5 ? 'far' : 'near'
      }
    })
  }

  /**
   * 形体的距离生命周期不透明度：远端雾中（新构图无 popping 地淡入）、
   * 中段全亮、相机贴近时熔解回 0。两端都过 smoothstep。
   */
  function resolveShapeLifeOpacity(distanceToCamera) {
    var farT = clamp01(
      (DIORAMA_SHAPE_FADE_IN_END - distanceToCamera) / (DIORAMA_SHAPE_FADE_IN_END - DIORAMA_SHAPE_FADE_IN_START)
    )
    var nearT = clamp01(
      (distanceToCamera - DIORAMA_SHAPE_DISSOLVE_END) / (DIORAMA_SHAPE_DISSOLVE_START - DIORAMA_SHAPE_DISSOLVE_END)
    )
    var farS = farT * farT * (3 - 2 * farT)
    var nearS = nearT * nearT * (3 - 2 * nearT)
    return farS * nearS
  }

  // ═══════════ dioramaTransition.ts 全文 ═══════════

  /** 相机飞越时长（秒）。长而缓，读作从容的电影推进而非仓促冲刺。 */
  var TRANSITION_DURATION = 3.2
  /** 新走廊相对旧走廊的生成距离。越过雾远面（30），新场景完全隐于雾中随靠近显形。 */
  var TRANSITION_DISTANCE = 46
  /** 飞行中段向弧内倾侧的峰值横滚（弧度），两端为零。 */
  var TRANSITION_BANK = 0.14
  /** 中段瞄准点横扫的飞行长度占比，结束时回到构图帧。 */
  var TRANSITION_AIM_SWEEP = 0.14

  /** 水平面内垂直于飞行方向的单位向量——弧的弓轴与瞄准扫轴。 */
  function flightPerp(from, to) {
    var perp = { x: to.z - from.z, y: 0, z: -(to.x - from.x) }
    var l = Math.hypot(perp.x, perp.y, perp.z)
    return l < 1e-3 ? { x: 1, y: 0, z: 0 } : { x: perp.x / l, y: perp.y / l, z: perp.z / l }
  }

  /** 弧的弓向/扫向/倾侧方向——逐转场种子化，连续切换方向各异。 */
  function flightSide(seed, epoch) {
    return seededUnit(hashSeed(seed) + epoch * 17) < 0.5 ? -1 : 1
  }

  var scaleTo = function (a, target) {
    var l = Math.hypot(a.x, a.y, a.z) || 1
    return { x: (a.x / l) * target, y: (a.y / l) * target, z: (a.z / l) * target }
  }

  /**
   * 把下一首歌的走廊放到远离当前走廊的种子化世界偏移处。方向逐转场变化
   * （方位角全圆扫，仰角偏上），z 保持负值让新场景大体在前方。
   */
  function pickTransitionOffset(seed, epoch) {
    var base = hashSeed(seed) + epoch * 131
    var azimuth = seededUnit(base + 1) * Math.PI * 2
    var elevation = (seededUnit(base + 2) - 0.35) * 1.3 // 偏上的竖直散布
    var ce = Math.cos(elevation)
    var dir = {
      x: Math.sin(azimuth) * ce,
      y: Math.sin(elevation),
      z: -Math.abs(Math.cos(azimuth) * ce) - 0.35
    }
    return scaleTo(dir, TRANSITION_DISTANCE)
  }

  /** smootherstep（6t^5-15t^4+10t^3）：飞越入出双端缓动、两端零速度。 */
  function transitionEase(t) {
    var c = Math.min(1, Math.max(0, t))
    return c * c * c * (c * (c * 6 - 15) + 10)
  }

  /**
   * 把 from -> to 直线弓成显著弧线的控制点：飞行清楚地在空间中扫过
   * （向上并向一侧）而非直线滑过。弓垂直于飞行方向再抬升，按飞行长度缩放。
   */
  function bezierControl(from, to, seed, epoch) {
    var mid = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2, z: (from.z + to.z) / 2 }
    var flightLen = Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z) || 1
    var perp = flightPerp(from, to)
    var side = flightSide(seed, epoch)
    var bow = flightLen * 0.32
    return {
      x: mid.x + perp.x * bow * side,
      y: mid.y + bow * 0.55, // 弧顶始终上抬，获得升镜扫掠
      z: mid.z + perp.z * bow * side
    }
  }

  /** 二次贝塞尔点（t 0..1），用于缓动相机飞越：from -> control -> to。 */
  function bezierArc(from, control, to, t) {
    var mt = 1 - t
    var a = mt * mt
    var b = 2 * mt * t
    var c = t * t
    return {
      x: a * from.x + b * control.x + c * to.x,
      y: a * from.y + b * control.y + c * to.y,
      z: a * from.z + b * control.z + c * to.z
    }
  }

  window.FoliaDioramaCore = {
    // tuning 常量
    DEFAULT_DIORAMA_TUNING: DEFAULT_DIORAMA_TUNING,
    DEFAULT_DIORAMA_GEOMETRY_VISIBILITY: DEFAULT_DIORAMA_GEOMETRY_VISIBILITY,
    DIORAMA_PARTICLE_DENSITY_MIN: DIORAMA_PARTICLE_DENSITY_MIN,
    DIORAMA_PARTICLE_DENSITY_MAX: DIORAMA_PARTICLE_DENSITY_MAX,
    DIORAMA_PARTICLE_DENSITY_STEP: DIORAMA_PARTICLE_DENSITY_STEP,
    DIORAMA_MOTE_CIRCUMFERENCE_MIN: DIORAMA_MOTE_CIRCUMFERENCE_MIN,
    DIORAMA_MOTE_CIRCUMFERENCE_MAX: DIORAMA_MOTE_CIRCUMFERENCE_MAX,
    DIORAMA_MOTE_CIRCUMFERENCE_STEP: DIORAMA_MOTE_CIRCUMFERENCE_STEP,
    DIORAMA_MOTE_RADIAL_MIN: DIORAMA_MOTE_RADIAL_MIN,
    DIORAMA_MOTE_RADIAL_MAX: DIORAMA_MOTE_RADIAL_MAX,
    DIORAMA_MOTE_RADIAL_STEP: DIORAMA_MOTE_RADIAL_STEP,
    DIORAMA_PARTICLE_SCALE_MIN: DIORAMA_PARTICLE_SCALE_MIN,
    DIORAMA_PARTICLE_SCALE_MAX: DIORAMA_PARTICLE_SCALE_MAX,
    DIORAMA_PARTICLE_SCALE_STEP: DIORAMA_PARTICLE_SCALE_STEP,
    // cameraPath
    DIORAMA_STEP_DISTANCE: DIORAMA_STEP_DISTANCE,
    DIORAMA_MAX_YAW: DIORAMA_MAX_YAW,
    DIORAMA_MAX_PITCH: DIORAMA_MAX_PITCH,
    DIORAMA_HERO_DISTANCE: DIORAMA_HERO_DISTANCE,
    DIORAMA_CAMERA_LIFT: DIORAMA_CAMERA_LIFT,
    DIORAMA_SAFE_FRAME_FRACTION: DIORAMA_SAFE_FRAME_FRACTION,
    DIORAMA_SWAY_AMP: DIORAMA_SWAY_AMP,
    DIORAMA_LIFT_AMP: DIORAMA_LIFT_AMP,
    DIORAMA_DIST_AMP: DIORAMA_DIST_AMP,
    DIORAMA_SNAP_DISTANCE: DIORAMA_SNAP_DISTANCE,
    DIORAMA_SHAPE_FADE_IN_START: DIORAMA_SHAPE_FADE_IN_START,
    DIORAMA_SHAPE_FADE_IN_END: DIORAMA_SHAPE_FADE_IN_END,
    DIORAMA_SHAPE_DISSOLVE_START: DIORAMA_SHAPE_DISSOLVE_START,
    DIORAMA_SHAPE_DISSOLVE_END: DIORAMA_SHAPE_DISSOLVE_END,
    DIORAMA_PARTICLE_AUDIO_SCALE_MAX: DIORAMA_PARTICLE_AUDIO_SCALE_MAX,
    DIORAMA_CLUSTER_COLLISION_LINE_SPAN: DIORAMA_CLUSTER_COLLISION_LINE_SPAN,
    DEG_TO_RAD: DEG_TO_RAD,
    clamp01: clamp01,
    clamp: clamp,
    vsub: vsub,
    vcross: vcross,
    vnorm: vnorm,
    vadd: vadd,
    seededUnit: seededUnit,
    hashSeed: hashSeed,
    smoothDamp: smoothDamp,
    frameHalfWidth: frameHalfWidth,
    DIORAMA_SUB_MODE_PRESETS: DIORAMA_SUB_MODE_PRESETS,
    resolveDioramaMotionParams: resolveDioramaMotionParams,
    DEFAULT_FRAME: DEFAULT_FRAME,
    buildDioramaPath: buildDioramaPath,
    getFrame: getFrame,
    translateFrames: translateFrames,
    composeLocal: composeLocal,
    resolveReadHeadTruck: resolveReadHeadTruck,
    getDioramaTextPlacement: getDioramaTextPlacement,
    SHOT_KINDS: SHOT_KINDS,
    easeInOut: easeInOut,
    getShotDir: getShotDir,
    getLineNoteProfile: getLineNoteProfile,
    computeShotWeights: computeShotWeights,
    weightedPickShot: weightedPickShot,
    basePickShot: basePickShot,
    getDioramaShot: getDioramaShot,
    resolveShotOffset: resolveShotOffset,
    resolveHoldSettle: resolveHoldSettle,
    resolveCameraDrift: resolveCameraDrift,
    buildFormation: buildFormation,
    resolveShapeLifeOpacity: resolveShapeLifeOpacity,
    // transition
    TRANSITION_DURATION: TRANSITION_DURATION,
    TRANSITION_DISTANCE: TRANSITION_DISTANCE,
    TRANSITION_BANK: TRANSITION_BANK,
    TRANSITION_AIM_SWEEP: TRANSITION_AIM_SWEEP,
    flightPerp: flightPerp,
    flightSide: flightSide,
    pickTransitionOffset: pickTransitionOffset,
    transitionEase: transitionEase,
    bezierControl: bezierControl,
    bezierArc: bezierArc
  }
})()
