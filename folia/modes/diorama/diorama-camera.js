// 镜台（diorama）模式·相机装配模块：移植自 folia-major src/components/visualizer/diorama/
//   CameraRig.tsx（全文逻辑）
// React → 原生转写：
//   refs（flight/pos/look/align/orient 状态）→ 工厂闭包变量；
//   useMemo(resolved) → 按 globalIndex 缓存（与原版一致：linesEpoch 原位重建不改相机帧）；
//   useMemo(shotKind/placement) → 按 (globalIndex, subMode / weaveScale) 缓存；
//   useFrame → update(ctx)。
// 无 React 状态；相机每帧只从闭包驱动（对齐原版运行时守则）。
// 依赖：window.THREE、window.FoliaDioramaCore、window.FoliaDioramaSequencer、
//       window.FoliaGraphemeTiming、window.FoliaRenderHints。
// 挂载于 window.FoliaDioramaCamera。
(function () {
  'use strict'

  var THREE = window.THREE
  var Core = window.FoliaDioramaCore
  var Sequencer = window.FoliaDioramaSequencer
  var GraphemeTiming = window.FoliaGraphemeTiming
  var RenderHints = window.FoliaRenderHints

  var UP = new THREE.Vector3(0, 1, 0)

  // 回正（reading-alignment）：运镜系统内的软性阅读辅助，不是锁定。
  // 权重 = readNeed(唱窗口内的平滑坡道) × 运镜自身对齐上限。
  // - gap/插曲 readNeed 落到零——行间的自由空间运镜完全不受影响。
  // - 每种运镜保留自己的上限：沉稳阅读型（hold/pushIn/track）几乎摆正，
  //   空间表现型（orbit/spiral/flyby/pendulum）只朝可读倾斜一部分。
  // 结果再做缓速率的 exp 平滑，加深/释放永远是一段慢相机动作。
  var ALIGN_SHOT_CEILING = {
    hold: 0.9,
    pushIn: 0.85,
    track: 0.85,
    swell: 0.8,
    float: 0.78,
    glide: 0.72,
    crane: 0.7,
    pullBack: 0.7,
    arc: 0.62,
    pendulum: 0.6,
    orbit: 0.55,
    spiral: 0.5,
    flyby: 0.5
  }
  // readNeed 坡道：行前 ALIGN_LEAD_IN 开始缓入，行开始后 ALIGN_SETTLE 达满
  // （settle 就是可见的"在歌词上摆正"动作），行结束后 ALIGN_RELEASE 释放。
  var ALIGN_LEAD_IN = 0.6
  var ALIGN_SETTLE = 0.35
  var ALIGN_RELEASE = 1.0
  var ALIGN_RATE = 1.2
  // 平滑后的对齐朝向转向新行文本平面的速率——低到"向另一倾角的行摆正"读作刻意运镜
  var ALIGN_TURN_RATE = 2.6
  // 保帧保证：朝向混合后读头必须位于半 FOV 的此比例内（取垂直/水平较紧者）。
  var FRAME_KEEP_FRACTION = 0.7

  function clamp01(value) { return Math.min(1, Math.max(0, value)) }

  function smoothstep01(t) {
    var c = clamp01(t)
    return c * c * (3 - 2 * c)
  }

  // 对齐四元数数学的可复用临时量（无逐帧分配）。文本基与 diorama-scene 的
  // frameQuaternion 镜像：+X -> frame right, +Y -> frame up, +Z -> -forward，
  // 再后乘 placement 的 yaw 与 roll——"对齐"的相机朝向就是文本的。
  var _alignRight = new THREE.Vector3()
  var _alignUp = new THREE.Vector3()
  var _alignFwd = new THREE.Vector3()
  var _alignMatrix = new THREE.Matrix4()
  var _alignQuat = new THREE.Quaternion()
  var _tiltQuat = new THREE.Quaternion()
  var _lookQuat = new THREE.Quaternion()
  var _AXIS_Y = new THREE.Vector3(0, 1, 0)
  var _AXIS_Z = new THREE.Vector3(0, 0, 1)
  var _viewDir = new THREE.Vector3()
  var _camForward = new THREE.Vector3()
  var _targetQuat = new THREE.Quaternion()
  // 转场飞行的临时量
  var _flightTo = new THREE.Vector3()
  // 跟随的 smooth-time 从这里起步（慢扫掠）并缓回正常值；弓弧中段的峰值高度是飞行长度的此比例
  var FLIGHT_SMOOTH_TIME = 1.1
  var FLIGHT_ARC_FRAC = 0.16

  // 解耦朝向管线：瞄准、阅读对齐混合与保帧钳制只合成"目标朝向"，允许折角。
  // 相机真实朝向只在唯一一处写入：以 ORIENT_FOLLOW_RATE 追踪目标的四元数低通。
  var ORIENT_FOLLOW_RATE = 4.2

  /**
   * 行在 `now` 时刻的字形揭示比例（0..1），在活动字形内部插值保持连续。
   * 镜像 diorama-scene 的揭示数学，相机跟踪与屏幕高亮是同一读点。
   */
  function resolveWordProgress(line, timeline, now) {
    if (timeline.length === 0) return 0
    var renderEndTime = RenderHints.getLineRenderEndTime(line)
    if (now >= renderEndTime) return 1
    if (now <= line.startTime) return 0
    var revealed = 0
    for (var i = 0; i < timeline.length; i += 1) {
      var timing = timeline[i]
      if (now >= timing.endTime) {
        revealed = i + 1
      } else if (now >= timing.startTime) {
        var span = Math.max(timing.endTime - timing.startTime, 0.001)
        revealed = i + clamp01((now - timing.startTime) / span)
        break
      } else {
        break
      }
    }
    return revealed / timeline.length
  }

  function createDioramaCameraRig(options) {
    // options: { motion }（motion 引用由入口在主题强度变化时替换）
    var motion = options.motion

    // 电影级转场飞行：epoch 变化时相机快照当前姿态，以缓动弓弧飞向新场景的活跟随
    // 姿态，历时 TRANSITION_DURATION，然后交还正常 SmoothDamp 跟随（从到达姿态无缝继续）。
    var flight = { flying: false, epoch: 0, start: 0, perp: new THREE.Vector3(), side: 1, flightLen: 1 }
    var pos = new THREE.Vector3(0, 0.6, 9)
    var posVel = new THREE.Vector3(0, 0, 0)
    var look = new THREE.Vector3(0, 0, -10)
    var lookVel = new THREE.Vector3(0, 0, 0)
    // 平滑的阅读对齐权重（0 = 自由空间注视，1 = 完全对正歌词平面）
    var alignWeight = 0
    // 平滑的对齐朝向：目标文本平面姿态在切行时瞬间跳变（新基 + 新 roll/yaw），
    // 相机从不直接追它——追这个四元数，每帧 slerp 逼近。
    var alignQuat = new THREE.Quaternion()
    var alignQuatInit = false
    // 朝向跟随器（见 ORIENT_FOLLOW_RATE）：唯一写到 camera.quaternion 的状态
    var orient = new THREE.Quaternion()
    var orientInit = false

    // resolved/shot/placement 缓存（原版 useMemo）
    var resolvedCache = { key: null, value: null }
    var timelineCache = { line: null, value: null }
    var shotCache = { key: null, value: 'hold' }
    var placementCache = { key: null, value: null }

    function resolveResolved(seq, globalIndex) {
      if (resolvedCache.key !== globalIndex) {
        resolvedCache.key = globalIndex
        resolvedCache.value = Sequencer.resolveGlobal(seq, globalIndex)
      }
      return resolvedCache.value
    }

    function resolveTimeline(line) {
      if (timelineCache.line !== line) {
        timelineCache.line = line
        timelineCache.value = line ? GraphemeTiming.buildLineGraphemeTimeline(line) : []
      }
      return timelineCache.value
    }

    function resolveShot(resolved, subMode, globalIndex) {
      var key = globalIndex + '|' + subMode
      if (shotCache.key !== key) {
        shotCache.key = key
        shotCache.value = resolved
          ? Core.getDioramaShot(resolved.localIndex, resolved.segment.lines, resolved.segment.seed, subMode)
          : 'hold'
      }
      return shotCache.value
    }

    function resolvePlacement(resolved, weaveScale, globalIndex) {
      var key = globalIndex + '|' + weaveScale
      if (placementCache.key !== key) {
        placementCache.key = key
        placementCache.value = Core.getDioramaTextPlacement(resolved ? resolved.localIndex : 0, resolved ? resolved.segment.seed : undefined, weaveScale)
      }
      return placementCache.value
    }

    function setMotion(nextMotion) {
      motion = nextMotion
    }

    /**
     * 每帧驱动（原版 useFrame）。
     * ctx: { camera, sequencer, globalIndex, activeLineWidth, transitionEpoch, delta, now, clockElapsedTime }
     */
    function update(ctx) {
      var camera = ctx.camera
      var sequencer = ctx.sequencer
      var globalIndex = ctx.globalIndex
      var transitionEpoch = ctx.transitionEpoch
      var delta = ctx.delta
      var now = ctx.now

      // 帧锁：下标解析不到真实路径帧时（切歌瞬态）保持当前姿态——原点吸附是抽搐
      var resolved = resolveResolved(sequencer, globalIndex)
      if (!resolved) return
      var line = resolved.line || null
      var timeline = resolveTimeline(line)
      var wordProgress = line ? resolveWordProgress(line, timeline, now) : 0
      // 行内时间进度（起点 0，唱完/间隙中 1）——驱动弧线
      var progress = line ? 1 : 0
      if (line) {
        var renderEndTime = RenderHints.getLineRenderEndTime(line)
        var span = renderEndTime - line.startTime
        progress = span > 0 ? clamp01((now - line.startTime) / span) : (now >= line.startTime ? 1 : 0)
      }

      var aspect = camera.isPerspectiveCamera ? camera.aspect : 1
      var fov = camera.isPerspectiveCamera ? camera.fov : 55
      var visibleHalf = Core.frameHalfWidth(Core.DIORAMA_HERO_DISTANCE, fov, aspect) * Core.DIORAMA_SAFE_FRAME_FRACTION

      // 当前行在蜿蜒路径上的局部帧。以下全部在其中合成。
      var frame = resolved.frame
      var R = frame.right
      var U = frame.up
      var F = frame.forward

      // 远超本行的运镜回正到其歌词的干净构图（resolveHoldSettle）：
      // 偏移、truck 与注视偏移一起释放
      var settle = line ? Core.resolveHoldSettle(now - RenderHints.getLineRenderEndTime(line)) : 1

      // 读头 = 行的实际文本位置（路径锚点 + 放置偏移）+ 跟随唱词的横向 truck
      var placement = resolvePlacement(resolved, motion.weaveScale, globalIndex)
      var truck = Core.resolveReadHeadTruck(wordProgress, ctx.activeLineWidth, visibleHalf) * settle
      var headR = placement.offsetR + truck
      var headU = placement.offsetU
      var baseX = frame.position.x + R.x * headR + U.x * headU
      var baseY = frame.position.y + R.y * headR + U.y * headU
      var baseZ = frame.position.z + R.z * headR + U.z * headU

      // 运镜偏移（局部 right/up/back）+ 微弱闲置漂移，与帧合成为世界姿态
      var shotSeed = resolved.segment.seed
      var shotKind = resolveShot(resolved, motion.subMode, globalIndex)
      var shot = Core.resolveShotOffset(shotKind, {
        progress: progress,
        wordProgress: wordProgress,
        hero: Core.DIORAMA_HERO_DISTANCE,
        lift: Core.DIORAMA_CAMERA_LIFT,
        seed: shotSeed,
        lineIndex: resolved.localIndex,
        // moveScale 正是偏离中性跟随姿态的幅度，settle 骑在它上面
        moveScale: motion.moveScale * settle
      })
      var drift = Core.resolveCameraDrift(now, shotSeed, motion.driftScale)
      var offRight = shot.right + drift.swayX
      var offUp = shot.up + drift.swayY + drift.lift
      var offBack = shot.back + drift.dist
      var poseX = baseX + R.x * offRight + U.x * offUp - F.x * offBack
      var poseY = baseY + R.y * offRight + U.y * offUp - F.y * offBack
      var poseZ = baseZ + R.z * offRight + U.z * offUp - F.z * offBack

      // ── 电影级转场飞行（为正常跟随调味，从不替代它） ────────────
      // epoch 跳变时 `pose` 已属于远处的新走廊。飞行不是刚性路径，而是为 TRANSITION_DURATION
      // 的正常跟随调味：压制 seek 吸附、把 smooth-time 拉长成缓回的慢扫掠，再叠加衰减的
      // 垂直弧 + 侧倾 + 瞄准扫。底层移动保持朝活姿态的 SmoothDamp。
      if (transitionEpoch !== flight.epoch && transitionEpoch > 0) {
        flight.epoch = transitionEpoch
        flight.flying = true
        flight.start = ctx.clockElapsedTime
        _flightTo.set(poseX, poseY, poseZ)
        var perp = Core.flightPerp(pos, _flightTo)
        flight.perp.set(perp.x, perp.y, perp.z)
        flight.side = Core.flightSide(shotSeed, transitionEpoch)
        flight.flightLen = pos.distanceTo(_flightTo)
      }
      var flying = false
      var te = 1
      if (flight.flying) {
        te = (ctx.clockElapsedTime - flight.start) / Core.TRANSITION_DURATION
        if (te >= 1) flight.flying = false
        else flying = true
      }
      // 起步更长的 smooth-time 缓回正常；弧/侧倾/扫掠用 sin^2 包络（两端值与速度均为零）
      var followSmooth = flying
        ? FLIGHT_SMOOTH_TIME + (motion.smoothTime - FLIGHT_SMOOTH_TIME) * Core.transitionEase(te)
        : motion.smoothTime
      var swayEnv = flying ? Math.pow(Math.sin(Math.PI * te), 2) : 0
      var arcMag = swayEnv * flight.flightLen * FLIGHT_ARC_FRAC
      var sweepMag = swayEnv * flight.flightLen * Core.TRANSITION_AIM_SWEEP * flight.side
      var bank = swayEnv * Core.TRANSITION_BANK * flight.side

      // SmoothDamp 相机逼近姿态（临界阻尼，携带速度）。只在真实 seek（非飞行中的大跳）吸附。
      var posGap = Math.hypot(poseX - pos.x, poseY - pos.y, poseZ - pos.z)
      var snapped = !flying && posGap > Core.DIORAMA_SNAP_DISTANCE
      if (snapped) {
        pos.set(poseX, poseY, poseZ)
        posVel.set(0, 0, 0)
      } else {
        var sx = Core.smoothDamp(pos.x, poseX, posVel.x, followSmooth, delta)
        var sy = Core.smoothDamp(pos.y, poseY, posVel.y, followSmooth, delta)
        var sz = Core.smoothDamp(pos.z, poseZ, posVel.z, followSmooth, delta)
        pos.set(sx.value, sy.value, sz.value)
        posVel.set(sx.velocity, sy.velocity, sz.velocity)
      }
      // 弓弧是阻尼跟随之上的衰减视觉偏移（不写入 pos，不会积累或折断交接）：
      // 垂直于航向的弓 + 向上的升镜
      camera.position.set(
        pos.x + flight.perp.x * arcMag,
        pos.y + flight.perp.y * arcMag + arcMag * 0.5,
        pos.z + flight.perp.z * arcMag
      )

      // 瞄准点按行的构图注视偏移（三分法：文本偏离中心，构图填补其余），同样 SmoothDamp。
      // 飞行中瞄准也横扫（优雅的飞行中段重新取景）。
      var lookOff = placement.lookR * settle
      var lookX = baseX + R.x * lookOff + flight.perp.x * sweepMag
      var lookY = baseY + R.y * lookOff + flight.perp.y * sweepMag
      var lookZ = baseZ + R.z * lookOff + flight.perp.z * sweepMag
      var lookGap = Math.hypot(lookX - look.x, lookY - look.y, lookZ - look.z)
      if (!flying && lookGap > Core.DIORAMA_SNAP_DISTANCE) {
        look.set(lookX, lookY, lookZ)
        lookVel.set(0, 0, 0)
      } else {
        var lx = Core.smoothDamp(look.x, lookX, lookVel.x, followSmooth, delta)
        var ly = Core.smoothDamp(look.y, lookY, lookVel.y, followSmooth, delta)
        var lz = Core.smoothDamp(look.z, lookZ, lookVel.z, followSmooth, delta)
        look.set(lx.value, ly.value, lz.value)
        lookVel.set(lx.velocity, ly.velocity, lz.velocity)
      }

      // 每次 lookAt 前重置 up：three 在 lookAt 时从 camera.up 导出横滚。强制世界上向保持地平线水平
      camera.up.copy(UP)
      camera.lookAt(look)

      // 回正：把相机朝向缓向文本平面的朝向，权重 = readNeed × 运镜上限。
      // 匹配文本基意味着视轴摆向歌词、相机的 up 跟随行的横滚。
      _alignRight.set(R.x, R.y, R.z)
      _alignUp.set(U.x, U.y, U.z)
      _alignFwd.set(-F.x, -F.y, -F.z)
      _alignMatrix.makeBasis(_alignRight, _alignUp, _alignFwd)
      _alignQuat.setFromRotationMatrix(_alignMatrix)
      if (placement.yaw !== 0) _alignQuat.multiply(_tiltQuat.setFromAxisAngle(_AXIS_Y, placement.yaw))
      if (placement.roll !== 0) _alignQuat.multiply(_tiltQuat.setFromAxisAngle(_AXIS_Z, placement.roll))
      if (snapped || !alignQuatInit) {
        alignQuat.copy(_alignQuat)
        alignQuatInit = true
      } else {
        alignQuat.slerp(_alignQuat, 1 - Math.exp(-ALIGN_TURN_RATE * delta))
      }

      // 连续阅读需求：唱窗口周围的平滑坡道（非二值状态），按当前运镜的上限缩放
      var readTarget = 0
      if (line) {
        var renderEnd = RenderHints.getLineRenderEndTime(line)
        var rampIn = smoothstep01((now - (line.startTime - ALIGN_LEAD_IN)) / (ALIGN_LEAD_IN + ALIGN_SETTLE))
        var rampOut = 1 - smoothstep01((now - renderEnd) / ALIGN_RELEASE)
        readTarget = Math.min(rampIn, rampOut) * (ALIGN_SHOT_CEILING[shotKind] !== undefined ? ALIGN_SHOT_CEILING[shotKind] : 0.7)
      }
      alignWeight += (readTarget - alignWeight) * (1 - Math.exp(-ALIGN_RATE * delta))

      // ---- 朝向目标合成（允许折角）----
      _lookQuat.copy(camera.quaternion)
      _targetQuat.copy(_lookQuat).slerp(alignQuat, alignWeight)

      // 目标上的保帧钳制：对齐混合若把读头带出安全锥（大侧偏运镜），把目标拉回纯瞄准
      _viewDir.subVectors(look, camera.position).normalize()
      _camForward.set(0, 0, -1).applyQuaternion(_targetQuat)
      var offAxisAngle = _camForward.angleTo(_viewDir)
      var halfV = THREE.MathUtils.degToRad(fov) / 2
      var halfH = Math.atan(Math.tan(halfV) * aspect)
      var maxOffAxis = Math.min(halfV, halfH) * FRAME_KEEP_FRACTION
      if (offAxisAngle > maxOffAxis) {
        _targetQuat.slerp(_lookQuat, 1 - maxOffAxis / offAxisAngle)
      }

      // ---- 朝向跟随器（camera.quaternion 的唯一写入者）----
      if (snapped || !orientInit) {
        orient.copy(_targetQuat)
        orientInit = true
      } else {
        orient.slerp(_targetQuat, 1 - Math.exp(-ORIENT_FOLLOW_RATE * delta))
      }
      camera.quaternion.copy(orient)
      // 衰减的弧内侧倾（纯视觉）：绕视轴的横滚，飞行中段达峰、结束为零
      if (bank !== 0) camera.rotateZ(bank)
    }

    return {
      update: update,
      setMotion: setMotion
    }
  }

  window.FoliaDioramaCamera = {
    createDioramaCameraRig: createDioramaCameraRig
  }
})()
