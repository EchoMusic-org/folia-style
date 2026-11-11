// 町景镜头（移植自 engine/camera.ts）+ 内置迷你轨道拖拽（替代上游 OrbitControls，vendor three 未含该扩展）：
// 正交投影的斜俯视。缩放 1 时按视口把场景给的构图点都框进去，并给底部字幕让出一点；
// 可以拖拽旋转、滚轮缩放、右键/双指沿地面平移（限角、阻尼）。默认视角下松手约 8 秒后缓回默认构图；
// 自定义视角是镜头的静止位置：松手就停在那里，等镜头停稳后报给外面存起来。
// 开着运镜时，镜头在静止位置附近缓慢地转、推拉、平移（几道周期互不成倍数的慢正弦，按氛围时间走，随歌曲暂停）。
(function () {
  'use strict'

  var THREE = window.THREE

  var DEG = Math.PI / 180

  /** 拖拽的范围与闲置回正（三个场景一样）。 */
  var MACHI_CAMERA_LIMITS = {
    azimuthRange: 75 * DEG,
    minElevation: 20 * DEG,
    maxElevation: 70 * DEG,
    minZoom: 0.75,
    maxZoom: 3.6,
    /** 目标点沿地面平移的上限（米，按默认朝向的左右、前后各算）。 */
    pan: 5,
    idleReturnSeconds: 8
  }

  /** 运镜从静止到全幅（或关掉后回到静止位置）用的秒数（真实时间）。 */
  var DRIFT_RAMP_SECONDS = 4

  /** 运镜在 time 秒（氛围时间）时相对静止位置的偏移：转角、俯仰（度）、缩放倍数、左右与前后平移（米）。 */
  function resolveMachiDrift(time) {
    var wave = function (period, phase) { return Math.sin((time / period) * Math.PI * 2 + phase) }
    return {
      azimuth: 15 * wave(67, 0) + 5 * wave(29, 1.3),
      elevation: 4 * wave(47, 0.7),
      zoom: Math.exp(0.08 * wave(41, 2.1)),
      panX: 0.45 * wave(53, 0.4),
      panZ: 0.3 * wave(71, 2.6)
    }
  }

  /** 构图留白（占画面的比例）与给字幕让出的下沿。 */
  var MARGIN = 0.02
  var SUBTITLE_RESERVE = 0.05
  var CAMERA_DISTANCE = 60
  /** 默认缩放下装不下时，多出来的高度这么多从下沿裁（其余从上沿）。 */
  var CROP_FROM_BOTTOM = 0.85

  function orbitDirection(azimuth, elevation, out) {
    out = out || new THREE.Vector3()
    return out.set(
      Math.sin(azimuth) * Math.cos(elevation),
      Math.sin(elevation),
      Math.cos(azimuth) * Math.cos(elevation)
    )
  }

  function clamp(value, min, max) { return Math.min(max, Math.max(min, value)) }

  function sameView(a, b) {
    return a === b || (!!a && !!b && Math.abs(a.azimuth - b.azimuth) < 1e-4 && Math.abs(a.elevation - b.elevation) < 1e-4 &&
      Math.abs(a.zoom - b.zoom) < 1e-5 && Math.abs(a.panX - b.panX) < 1e-4 && Math.abs(a.panZ - b.panZ) < 1e-4)
  }

  // ===== 迷你轨道拖拽（OrbitControls 子集：左键旋转、右键平移、滚轮缩放、双指平移/缩放、阻尼、限角） =====
  function MiniOrbit(camera, element) {
    this.camera = camera
    this.domElement = element
    this.target = new THREE.Vector3()
    this.minAzimuthAngle = -Infinity
    this.maxAzimuthAngle = Infinity
    this.minPolarAngle = 0
    this.maxPolarAngle = Math.PI
    this.minZoom = 0.5
    this.maxZoom = 4
    this.enableDamping = true
    this.dampingFactor = 0.08
    this.rotateSpeed = 0.55
    this.zoomSpeed = 0.8
    this.panSpeed = 0.8
    // 每帧应用的阻尼增量（three OrbitControls 的 sphericalDelta/panOffset 等价物）
    this._thetaDelta = 0
    this._phiDelta = 0
    this._scaleDelta = 0
    this._panDelta = new THREE.Vector3()
    this._state = 'none' // none | rotate | pan | touchPan | touchRotate
    this._lastX = 0
    this._lastY = 0
    this._lastDist = 0
    this._onStart = null
    this._onEnd = null
    this._onChange = null
    this._bind()
  }

  MiniOrbit.prototype._bind = function () {
    var self = this
    var el = this.domElement
    el.style.touchAction = 'none'
    el.addEventListener('pointerdown', function (e) {
      if (e.button === 0) self._state = 'rotate'
      else if (e.button === 2) self._state = 'pan'
      else return
      self._lastX = e.clientX
      self._lastY = e.clientY
      el.setPointerCapture(e.pointerId)
      if (self._onStart) self._onStart()
    })
    el.addEventListener('pointermove', function (e) {
      if (self._state === 'none') return
      var dx = e.clientX - self._lastX
      var dy = e.clientY - self._lastY
      self._lastX = e.clientX
      self._lastY = e.clientY
      if (self._state === 'rotate') {
        self._thetaDelta -= (2 * Math.PI * dx / el.clientHeight) * self.rotateSpeed
        self._phiDelta -= (2 * Math.PI * dy / el.clientHeight) * self.rotateSpeed
      } else if (self._state === 'pan') {
        self._panBy(dx, dy)
      }
      if (self._onChange) self._onChange()
    })
    var finish = function (e) {
      if (self._state === 'none') return
      self._state = 'none'
      if (e && el.hasPointerCapture && el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId)
      if (self._onEnd) self._onEnd()
    }
    el.addEventListener('pointerup', finish)
    el.addEventListener('pointercancel', finish)
    el.addEventListener('contextmenu', function (e) { e.preventDefault() })
    el.addEventListener('wheel', function (e) {
      e.preventDefault()
      if (e.deltaY < 0) self._scaleDelta *= Math.pow(0.95, self.zoomSpeed)
      else self._scaleDelta /= Math.pow(0.95, self.zoomSpeed)
      if (self._onChange) self._onChange()
    }, { passive: false })
    // 双指：双指距离变化 = 缩放，中点位移 = 平移
    this._touches = 0
    el.addEventListener('touchstart', function (e) {
      if (e.touches.length === 2) {
        self._touches = 2
        self._state = 'pan'
        self._lastDist = self._touchDist(e)
        self._lastX = (e.touches[0].clientX + e.touches[1].clientX) / 2
        self._lastY = (e.touches[0].clientY + e.touches[1].clientY) / 2
        if (self._onStart) self._onStart()
      }
    }, { passive: true })
    el.addEventListener('touchmove', function (e) {
      if (self._touches !== 2 || e.touches.length !== 2) return
      var dist = self._touchDist(e)
      if (self._lastDist > 0 && dist > 0) self._scaleDelta *= self._lastDist / dist
      self._lastDist = dist
      var x = (e.touches[0].clientX + e.touches[1].clientX) / 2
      var y = (e.touches[0].clientY + e.touches[1].clientY) / 2
      self._panBy(x - self._lastX, y - self._lastY)
      self._lastX = x
      self._lastY = y
      if (self._onChange) self._onChange()
    }, { passive: true })
    var touchEnd = function () {
      if (self._touches !== 2) return
      self._touches = 0
      self._state = 'none'
      if (self._onEnd) self._onEnd()
    }
    el.addEventListener('touchend', touchEnd)
    el.addEventListener('touchcancel', touchEnd)
  }

  MiniOrbit.prototype._touchDist = function (e) {
    var dx = e.touches[0].clientX - e.touches[1].clientX
    var dy = e.touches[0].clientY - e.touches[1].clientY
    return Math.hypot(dx, dy)
  }

  /** 沿地面平移（screenSpacePanning=false 的等价：右方向 × -dx + 地面朝前方向 × dy）。 */
  MiniOrbit.prototype._panBy = function (dx, dy) {
    var camera = this.camera
    var wpp = (camera.top - camera.bottom) / camera.zoom / Math.max(1, this.domElement.clientHeight)
    var right = new THREE.Vector3().setFromMatrixColumn(camera.matrix, 0)
    var forward = new THREE.Vector3().crossVectors(camera.up, right).normalize()
    this._panDelta.addScaledVector(right, -dx * wpp * this.panSpeed)
    this._panDelta.addScaledVector(forward, dy * wpp * this.panSpeed)
  }

  /** 每帧推进：阻尼增量应用到相机；返回是否动了。 */
  MiniOrbit.prototype.update = function () {
    var moved = false
    var camera = this.camera
    var offset = camera.position.clone().sub(this.target)
    var spherical = new THREE.Spherical().setFromVector3(offset)
    if (this._thetaDelta !== 0 || this._phiDelta !== 0) {
      spherical.theta += this._thetaDelta
      spherical.phi += this._phiDelta
      moved = true
    }
    if (this._scaleDelta !== 1 && this._scaleDelta !== 0) {
      var zoom = camera.zoom * this._scaleDelta
      camera.zoom = clamp(zoom, this.minZoom, this.maxZoom)
      moved = true
    }
    this._scaleDelta = 1
    spherical.theta = clamp(spherical.theta, this.minAzimuthAngle, this.maxAzimuthAngle)
    spherical.phi = clamp(spherical.phi, this.minPolarAngle, this.maxPolarAngle)
    spherical.makeSafe()
    if (this._panDelta.lengthSq() > 0) {
      // 平移量按相机缩放折算后加到目标点
      this.target.add(this._panDelta)
      moved = true
      this._panDelta.set(0, 0, 0)
    }
    offset.setFromSpherical(spherical)
    if (moved) {
      camera.position.copy(this.target).add(offset)
      camera.lookAt(this.target)
    }
    if (this.enableDamping) {
      this._thetaDelta *= (1 - this.dampingFactor)
      this._phiDelta *= (1 - this.dampingFactor)
      if (Math.abs(this._thetaDelta) < 1e-7) this._thetaDelta = 0
      if (Math.abs(this._phiDelta) < 1e-7) this._phiDelta = 0
    }
    return moved
  }

  MiniOrbit.prototype.dispose = function () {
    // 简化：不摘监听——dispose 只在运行时销毁时调一次，画布节点随后整体移除，监听随节点一起失效
  }

  // ===== 主镜头 =====
  function MachiCamera() {
    this.camera = new THREE.OrthographicCamera(-8, 8, 4.5, -4.5, 0.1, 200)
    this.camera.name = 'Camera'
    this.controls = null
    this._base = new THREE.Vector3()
    this._target = new THREE.Vector3()
    this.framing = { points: [new THREE.Vector3()], view: { azimuth: 45 * DEG, elevation: 31 * DEG, zoom: 1 } }
    this._fitCenter = new THREE.Vector3()
    this._fitUp = new THREE.Vector3()
    this.halfHeight = 8
    this._fitHalf = { width: 9, height: 7 }
    this.aspect = 16 / 9
    this.custom = null
    this.interacting = false
    this.idleSince = 0
    this.returning = false
    this.commitPending = false
    this._spherical = new THREE.Spherical()
    this.motion = false
    this.motionSpeed = 1
    this.motionTime = 0
    this.motionWeight = 0
    this.needsRender = true
    this.onCommit = null
    this.onWake = null
    this._orbitDir = new THREE.Vector3()
    this._scratch = new THREE.Vector3()
  }

  Object.defineProperty(MachiCamera.prototype, 'defaultView', {
    get: function () { return this.framing.view }
  })

  /** 换场景：新的构图点与默认视角、这个场景的自定义视角（null 是默认构图），镜头直接摆到静止位置。 */
  MachiCamera.prototype.setFraming = function (framing, custom) {
    this.framing = framing
    this.custom = custom
    this.interacting = false
    this.returning = false
    this.commitPending = false
    this.idleSince = 0
    this._fitDefault()
    this._applyLimits()
    this.settle()
  }

  /** 开关运镜：开了从静止位置慢慢走起来，关了慢慢回到静止位置。 */
  MachiCamera.prototype.setMotion = function (motion, speed) {
    speed = speed === undefined ? 1 : speed
    this.motionSpeed = speed
    if (motion === this.motion) return
    this.motion = motion
    this.needsRender = true
  }

  /**
   * 换视角设置：自定义视角（相对默认构图）或 null（默认构图）。
   * 从默认切到自定义时，要是刚拖过、还没回正，就把此刻的视角当成自定义视角。
   */
  MachiCamera.prototype.setCustom = function (view) {
    if (sameView(view, this.custom)) return
    var adopt = view !== null && this.custom === null && this.controls !== null && (this.idleSince > 0 || this.returning)
    this.custom = view
    this.returning = false
    this.idleSince = 0
    this.commitPending = false
    if (adopt) {
      this.custom = this.offset()
      if (this.onCommit) this.onCommit(this.custom)
      return
    }
    if (this.interacting) return
    if (view === null && this.controls) {
      // 回到默认构图：缓回去。
      this.returning = true
      this.needsRender = true
      return
    }
    this.settle()
  }

  /** 按默认朝向把构图点投到镜头平面上，求目标点和半高。 */
  MachiCamera.prototype._fitDefault = function () {
    var view = this.framing.view
    var direction = orbitDirection(view.azimuth, view.elevation, new THREE.Vector3())
    var forward = direction.clone().negate()
    var right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize()
    var up = new THREE.Vector3().crossVectors(right, forward).normalize()
    var minR = Infinity, maxR = -Infinity, minU = Infinity, maxU = -Infinity
    this.framing.points.forEach(function (point) {
      var r = point.dot(right)
      var u = point.dot(up)
      minR = Math.min(minR, r); maxR = Math.max(maxR, r)
      minU = Math.min(minU, u); maxU = Math.max(maxU, u)
    })
    var centerR = (minR + maxR) / 2
    var centerU = (minU + maxU) / 2
    this._fitUp.copy(up)
    this._fitCenter.copy(right.multiplyScalar(centerR)).add(up.clone().multiplyScalar(centerU))
    this._fitHalf = { width: (maxR - minR) / 2, height: (maxU - minU) / 2 }
    this._applyFrustum()
  }

  /**
   * 视口变了：按宽高比取能装下构图的半高，再给字幕让出下沿。
   * 默认缩放下竖向装不下的部分大多从下沿裁，所以目标点往上挪。
   */
  MachiCamera.prototype._applyFrustum = function () {
    var usable = 1 - MARGIN * 2 - SUBTITLE_RESERVE
    var halfHeight = Math.max(this._fitHalf.height, this._fitHalf.width / this.aspect) / usable
    this.halfHeight = halfHeight
    var overflow = Math.max(0, this._fitHalf.height / usable - halfHeight / this.framing.view.zoom)
    var view = this.view()
    var pan = this._target.clone().sub(this._base)
    this._base.copy(this._fitCenter).addScaledVector(this._fitUp, overflow * (CROP_FROM_BOTTOM - 0.5) * 2)
    this.place(view, this._base.clone().add(pan))
    var shift = halfHeight * SUBTITLE_RESERVE
    this.camera.left = -halfHeight * this.aspect
    this.camera.right = halfHeight * this.aspect
    this.camera.top = halfHeight - shift
    this.camera.bottom = -halfHeight - shift
    this.camera.updateProjectionMatrix()
    this.needsRender = true
  }

  MachiCamera.prototype.setAspect = function (width, height) {
    var aspect = width / Math.max(1, height)
    if (Math.abs(aspect - this.aspect) < 1e-4) return
    this.aspect = aspect
    this._applyFrustum()
  }

  /** 默认朝向的“右”与“往里”（都在地面上）。 */
  MachiCamera.prototype._axes = function () {
    var azimuth = this.framing.view.azimuth
    return {
      right: new THREE.Vector3(Math.cos(azimuth), 0, -Math.sin(azimuth)),
      back: new THREE.Vector3(-Math.sin(azimuth), 0, -Math.cos(azimuth))
    }
  }

  /** 静止时的视角：默认构图，或默认构图加上自定义的转角、俯仰、缩放倍数。 */
  MachiCamera.prototype._restView = function () {
    var home = this.framing.view
    var custom = this.custom
    if (!custom) return home
    return {
      azimuth: home.azimuth + custom.azimuth * DEG,
      elevation: clamp(home.elevation + custom.elevation * DEG, MACHI_CAMERA_LIMITS.minElevation, MACHI_CAMERA_LIMITS.maxElevation),
      zoom: clamp(home.zoom * custom.zoom, MACHI_CAMERA_LIMITS.minZoom, MACHI_CAMERA_LIMITS.maxZoom)
    }
  }

  /** 静止时的目标点：默认目标点加上自定义平移（再加上运镜的平移，一起夹在平移范围里）。 */
  MachiCamera.prototype._restTarget = function (extraX, extraZ) {
    extraX = extraX || 0
    extraZ = extraZ || 0
    var custom = this.custom
    if (!custom && extraX === 0 && extraZ === 0) return this._base.clone()
    var axes = this._axes()
    var limit = MACHI_CAMERA_LIMITS.pan
    var x = clamp((custom ? custom.panX : 0) + extraX, -limit, limit)
    var z = clamp((custom ? custom.panZ : 0) + extraZ, -limit, limit)
    return this._base.clone().addScaledVector(axes.right, x).addScaledVector(axes.back, z)
  }

  /** 摆到静止位置，开着运镜就叠上此刻的运镜偏移（按幅度）。 */
  MachiCamera.prototype.settle = function () {
    var rest = this._restView()
    // 幅度按 smoothstep 缓起缓停。
    var weight = this.motionWeight * this.motionWeight * (3 - 2 * this.motionWeight)
    if (weight <= 0) {
      this.place(rest, this._restTarget())
      return
    }
    var drift = resolveMachiDrift(this.motionTime)
    var home = this.framing.view.azimuth
    var range = MACHI_CAMERA_LIMITS.azimuthRange
    // 拉得越近，平移在画面上显得越大：按相对默认构图的缩放收一收。
    var panScale = weight * Math.min(1, this.framing.view.zoom / rest.zoom)
    this.place({
      azimuth: clamp(rest.azimuth + drift.azimuth * DEG * weight, home - range, home + range),
      elevation: clamp(rest.elevation + drift.elevation * DEG * weight, MACHI_CAMERA_LIMITS.minElevation, MACHI_CAMERA_LIMITS.maxElevation),
      zoom: clamp(rest.zoom * Math.pow(drift.zoom, weight), MACHI_CAMERA_LIMITS.minZoom, MACHI_CAMERA_LIMITS.maxZoom)
    }, this._restTarget(drift.panX * panScale, drift.panZ * panScale))
  }

  /** 此刻的视角，相对默认构图（自定义视角存的就是它）。 */
  MachiCamera.prototype.offset = function () {
    var home = this.framing.view
    var view = this.view()
    var pan = this._target.clone().sub(this._base)
    var axes = this._axes()
    return {
      azimuth: (view.azimuth - home.azimuth) / DEG,
      elevation: (view.elevation - home.elevation) / DEG,
      zoom: view.zoom / home.zoom,
      panX: pan.dot(axes.right),
      panZ: pan.dot(axes.back)
    }
  }

  /** 摆到某个视角、绕某个目标点。 */
  MachiCamera.prototype.place = function (view, target) {
    this._target.copy(target)
    if (this.controls) this.controls.target.copy(target)
    this.camera.position.copy(target).addScaledVector(orbitDirection(view.azimuth, view.elevation, this._orbitDir), CAMERA_DISTANCE)
    this.camera.zoom = view.zoom
    this.camera.lookAt(target)
    this.camera.updateProjectionMatrix()
    if (this.controls) this.controls.update()
    this.needsRender = true
  }

  /** 直接摆到某个视角，目标点不变。 */
  MachiCamera.prototype.placeAt = function (view) {
    this.place(view, this._target)
  }

  MachiCamera.prototype.placeAtRest = function () { this.settle() }

  /** 当前视角。 */
  MachiCamera.prototype.view = function () {
    this._spherical.setFromVector3(this.camera.position.clone().sub(this._target))
    return { azimuth: this._spherical.theta, elevation: Math.PI / 2 - this._spherical.phi, zoom: this.camera.zoom }
  }

  /** 接上拖拽：限角、阻尼、缩放上下限；右键沿地面平移。 */
  MachiCamera.prototype.attach = function (element) {
    if (this.controls) return
    var self = this
    var controls = new MiniOrbit(this.camera, element)
    controls.target.copy(this._target)
    controls.enableDamping = true
    controls.dampingFactor = 0.08
    controls.rotateSpeed = 0.55
    controls.zoomSpeed = 0.8
    controls.panSpeed = 0.8
    controls.minPolarAngle = Math.PI / 2 - MACHI_CAMERA_LIMITS.maxElevation
    controls.maxPolarAngle = Math.PI / 2 - MACHI_CAMERA_LIMITS.minElevation
    controls.minZoom = MACHI_CAMERA_LIMITS.minZoom
    controls.maxZoom = MACHI_CAMERA_LIMITS.maxZoom
    controls._onStart = function () {
      self.interacting = true
      self.motionWeight = 0
      self.returning = false
      self.commitPending = false
      if (self.onWake) self.onWake()
    }
    controls._onEnd = function () {
      self.interacting = false
      if (self.custom) self.commitPending = true
      else self.idleSince = performance.now()
    }
    controls._onChange = function () {
      self._target.copy(controls.target)
      self.needsRender = true
      if (self.onWake) self.onWake()
    }
    this.controls = controls
    this._applyLimits()
    controls.update()
  }

  /** 方位角限在默认视角两侧。 */
  MachiCamera.prototype._applyLimits = function () {
    if (!this.controls) return
    this.controls.minAzimuthAngle = this.framing.view.azimuth - MACHI_CAMERA_LIMITS.azimuthRange
    this.controls.maxAzimuthAngle = this.framing.view.azimuth + MACHI_CAMERA_LIMITS.azimuthRange
  }

  /** 平移不出范围：目标点按默认朝向的左右、前后各夹在 ±pan 米里，镜头跟着挪同样的量。 */
  MachiCamera.prototype._clampPan = function () {
    var controls = this.controls
    if (!controls) return
    var pan = controls.target.clone().sub(this._base)
    var axes = this._axes()
    var limit = MACHI_CAMERA_LIMITS.pan
    var x = pan.dot(axes.right)
    var z = pan.dot(axes.back)
    if (Math.abs(x) <= limit && Math.abs(z) <= limit && Math.abs(pan.y) < 1e-6) return
    var next = this._base.clone().addScaledVector(axes.right, clamp(x, -limit, limit)).addScaledVector(axes.back, clamp(z, -limit, limit))
    this.camera.position.add(next.clone().sub(controls.target))
    controls.target.copy(next)
    this._target.copy(next)
  }

  Object.defineProperty(MachiCamera.prototype, 'still', {
    /** 镜头停在静止位置上：运镜只在这时走。 */
    get: function () { return !this.interacting && !this.returning && !this.commitPending && this.idleSince === 0 }
  })

  Object.defineProperty(MachiCamera.prototype, 'ramping', {
    /** 运镜的幅度还在升降。 */
    get: function () { return this.motion ? this.still && this.motionWeight < 1 : this.motionWeight > 0 }
  })

  Object.defineProperty(MachiCamera.prototype, 'busy', {
    /** 镜头还在动：暂停时也要继续出帧。 */
    get: function () { return this.interacting || this.returning || this.commitPending || this.needsRender || this.ramping }
  })

  /**
   * 每帧推进：阻尼、闲置回正（只在默认视角下）、运镜、自定义视角下停稳后报新视角。
   * realDelta 是真实时间；ambientDelta 是氛围时间，运镜按它走。
   */
  MachiCamera.prototype.update = function (realDelta, ambientDelta) {
    var controls = this.controls
    // 预览不接拖拽，只有运镜。
    if (!controls) {
      this._stepMotion(realDelta, ambientDelta)
      return
    }
    var home = this.framing.view
    if (!this.custom && !this.interacting && !this.returning && this.idleSince > 0 &&
      performance.now() - this.idleSince > MACHI_CAMERA_LIMITS.idleReturnSeconds * 1000) {
      var current = this.view()
      var off = Math.abs(current.azimuth - home.azimuth) + Math.abs(current.elevation - home.elevation) +
        Math.abs(current.zoom - home.zoom) + this._target.distanceTo(this._base)
      this.returning = off > 1e-3
      this.idleSince = 0
    }
    if (this.returning) {
      var view = this.view()
      var rest = this._restView()
      var k = 1 - Math.exp(-realDelta * 1.6)
      var next = {
        azimuth: view.azimuth + (rest.azimuth - view.azimuth) * k,
        elevation: view.elevation + (rest.elevation - view.elevation) * k,
        zoom: view.zoom + (rest.zoom - view.zoom) * k
      }
      var restTarget = this._restTarget()
      var target = this._target.clone().lerp(restTarget, k)
      var done = Math.abs(next.azimuth - rest.azimuth) < 2e-4 && Math.abs(next.elevation - rest.elevation) < 2e-4 &&
        Math.abs(next.zoom - rest.zoom) < 2e-4 && target.distanceTo(restTarget) < 2e-3
      this.place(done ? rest : next, done ? restTarget : target)
      if (done) this.returning = false
    }
    this._stepMotion(realDelta, ambientDelta)
    this._clampPan()
    var moved = controls.update()
    if (moved) this._target.copy(controls.target)
    if (this.commitPending && !this.interacting && !moved) {
      this.commitPending = false
      this.custom = this.offset()
      if (this.onCommit) this.onCommit(this.custom)
    }
  }

  /** 运镜：镜头停在静止位置上时，幅度慢慢升到 1（关了就降回 0），按氛围时间走。 */
  MachiCamera.prototype._stepMotion = function (realDelta, ambientDelta) {
    if (!this.still) {
      this.motionWeight = 0
      return
    }
    if (this.motion) this.motionTime += ambientDelta * this.motionSpeed
    var weight = this.motionWeight
    var step = realDelta / DRIFT_RAMP_SECONDS
    this.motionWeight = this.motion ? Math.min(1, weight + step) : Math.max(0, weight - step)
    // 幅度在 0 上不动就不用摆；从有到无那一帧还要摆回静止位置。
    if (weight > 0 || this.motionWeight > 0) {
      if (this.motionWeight !== weight || (this.motion && ambientDelta > 0)) this.settle()
    }
  }

  /** 渲染后清掉“要补帧”的标记。 */
  MachiCamera.prototype.rendered = function () { this.needsRender = false }

  /** 镜头到目标点的距离（画面中心的深度）。 */
  Object.defineProperty(MachiCamera.prototype, 'focusDistance', {
    get: function () { return this.camera.position.distanceTo(this._target) }
  })

  /** 某一点沿视线的深度（对焦在场景里某个东西上时用）。 */
  MachiCamera.prototype.depthOf = function (point) {
    var forward = this._target.clone().sub(this.camera.position).normalize()
    return point.clone().sub(this.camera.position).dot(forward)
  }

  Object.defineProperty(MachiCamera.prototype, 'frustumHalfHeight', {
    get: function () { return this.halfHeight / this.camera.zoom }
  })

  MachiCamera.prototype.dispose = function () {
    this.controls = null
  }

  window.FoliaMachiCamera = {
    MachiCamera: MachiCamera,
    MiniOrbit: MiniOrbit,
    MACHI_CAMERA_LIMITS: MACHI_CAMERA_LIMITS,
    resolveMachiDrift: resolveMachiDrift
  }
})()
