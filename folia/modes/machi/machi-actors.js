// 街上的演员与装饰（移植自 engine/actors/schedules.ts + nobori.ts + traffic.ts，合成一文件）：
// 路上偶尔开过的车（纯函数日程：按时间切成窗口，每个窗口按哈希决定有没有车、走哪条车道、什么颜色）；
// のぼり旗（几面竖长的布旗插在场地边上，随风飘，竖排的字，底色用主题的品牌色）；
// 车本体（轻型车，有时是出租车，车顶亮着灯；车身、车灯都带底座边缘的裁切面，车从底座边缘“开出来”）。
(function () {
  'use strict'

  var THREE = window.THREE
  var SeedHash = window.FoliaSeedHash
  var Geometry = window.FoliaMachiGeometry
  var Shaders = window.FoliaMachiShaders
  var Raster = window.FoliaMachiSignRaster
  var Reflection = window.FoliaMachiReflection

  var roundedBox = Geometry.roundedBox
  var MACHI_REFLECT_LAYER = Reflection.MACHI_REFLECT_LAYER

  // ===== 日程（schedules.ts） =====
  /** 车速（米/秒，约 23 km/h：住宅区里的车速）。 */
  var MACHI_CAR_SPEED = 6.5
  var CAR_WINDOW = 9.5

  function laneLength(lane) {
    return Math.hypot(lane.to[0] - lane.from[0], lane.to[1] - lane.from[1])
  }

  /** 时刻 time（氛围时钟）路上的车：没有就是 null。chance 是每个窗口有车的概率。 */
  function resolveMachiCar(time, seed, lanes, chance) {
    if (lanes.length === 0) return null
    var key = SeedHash.hashVisualizerSeed('car:' + seed)
    var windowIndex = Math.floor(time / CAR_WINDOW)
    // 一辆车可能跨进下一个窗口：先看上一个窗口的车有没有开完。
    var windows = [windowIndex, windowIndex - 1]
    for (var w = 0; w < windows.length; w += 1) {
      var index = windows[w]
      if (SeedHash.visualizerHash01(key, index, 0x11) > chance) continue
      var start = index * CAR_WINDOW + SeedHash.visualizerHash01(key, index, 0x22) * (CAR_WINDOW * 0.5)
      var local = time - start
      var lane = Math.floor(SeedHash.visualizerHash01(key, index, 0x33) * lanes.length)
      if (local < 0 || local > laneLength(lanes[lane]) / MACHI_CAR_SPEED) continue
      return {
        lane: lane,
        distance: local * MACHI_CAR_SPEED,
        colorIndex: Math.floor(SeedHash.visualizerHash01(key, index, 0x44) * 1000)
      }
    }
    return null
  }

  // ===== のぼり旗（nobori.ts） =====
  var FLAG = { width: 0.46, height: 1.5, bottom: 0.62 }
  var WAVE_SEGMENTS = 10

  var WAVE_PARS = '\nuniform float uTime;\nuniform float uWind;\nuniform float uPhase;\n'
  var WAVE_VERTEX = '\nfloat kFlagU = clamp(position.x / ' + FLAG.width.toFixed(3) + ', 0.0, 1.0);\n' +
    'float kWave = sin(position.x * 7.0 - uTime * (3.2 + uWind * 2.0) + uPhase + position.y * 1.3)\n' +
    '    + 0.4 * sin(position.x * 13.0 - uTime * 5.1 + uPhase * 1.7);\n' +
    'transformed.z += kWave * kFlagU * (0.035 + 0.05 * uWind);\n' +
    'transformed.x -= abs(kWave) * kFlagU * 0.012;\n'

  /** 竖排写字：中日韩逐字竖排，拉丁字转 90° 顺着写；放不下就缩字。 */
  function drawVertical(context, font, text, x, top, bottom, maxWidth) {
    var chars = Array.from(text.trim() || ' ')
    var latin = !/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(text)
    var available = bottom - top
    context.textAlign = 'center'
    context.textBaseline = 'middle'
    if (latin) {
      var lpx = maxWidth * 0.8
      context.font = Raster.fontSpec(font, lpx)
      var width = context.measureText(text).width
      if (width > available) lpx = (lpx * available) / width
      context.font = Raster.fontSpec(font, lpx)
      context.save()
      context.translate(x, (top + bottom) / 2)
      context.rotate(Math.PI / 2)
      context.fillText(text, 0, 0)
      context.restore()
      return
    }
    var px = Math.min(maxWidth * 0.82, available / chars.length / 1.04)
    context.font = Raster.fontSpec(font, px)
    var step = px * 1.04
    var start = top + (available - step * chars.length) / 2 + step / 2
    chars.forEach(function (charItem, index) { context.fillText(charItem, x, start + index * step) })
  }

  /** constructor(materials, spots[{x,y,z,rotationY}]) */
  function MachiNobori(materials, spots) {
    this.group = new THREE.Group()
    this.group.name = 'Nobori'
    this.flags = []
    this.uniforms = { uTime: { value: 0 }, uWind: { value: 0.5 } }
    this.geometries = []
    var cloth = new THREE.PlaneGeometry(FLAG.width, FLAG.height, WAVE_SEGMENTS, 4).translate(FLAG.width / 2, FLAG.height / 2, 0)
    var pole = new THREE.CylinderGeometry(0.018, 0.022, FLAG.bottom + FLAG.height + 0.12, 6).translate(0, (FLAG.bottom + FLAG.height + 0.12) / 2, 0)
    var bar = new THREE.CylinderGeometry(0.012, 0.012, FLAG.width + 0.04, 5).rotateZ(Math.PI / 2).translate(FLAG.width / 2, 0, 0)
    var base = new THREE.CylinderGeometry(0.14, 0.16, 0.12, 10).translate(0, 0.06, 0)
    this.geometries.push(cloth, pole, bar, base)
    var poleMaterial = materials.toon('white')
    var baseMaterial = materials.toon('darkMetal')
    spots.forEach(function (spot, index) {
      var canvas = Raster.createCanvas(128, 416)
      var texture = new THREE.CanvasTexture(canvas)
      texture.colorSpace = THREE.SRGBColorSpace
      texture.anisotropy = 4
      this.flags.push({ canvas: canvas, texture: texture })
      var material = materials.track(new THREE.MeshToonMaterial({ map: texture, gradientMap: materials.gradient, side: THREE.DoubleSide }))
      material.emissive.setScalar(0.18)
      material.emissiveMap = texture
      var phase = index * 1.9
      var uniforms = this.uniforms
      material.onBeforeCompile = function (shader) {
        Object.assign(shader.uniforms, uniforms, { uPhase: { value: phase } })
        shader.vertexShader = shader.vertexShader
          .replace('#include <common>', '#include <common>\n' + WAVE_PARS)
          .replace('#include <begin_vertex>', '#include <begin_vertex>\n' + WAVE_VERTEX)
      }
      material.customProgramCacheKey = function () { return 'machi-nobori-' + index }
      var flag = new THREE.Group()
      flag.name = 'Nobori' + index
      var clothMesh = new THREE.Mesh(cloth, material)
      clothMesh.position.y = FLAG.bottom
      clothMesh.castShadow = false
      var poleMesh = new THREE.Mesh(pole, poleMaterial)
      var barMesh = new THREE.Mesh(bar, poleMaterial)
      barMesh.position.y = FLAG.bottom + FLAG.height + 0.01
      var baseMesh = new THREE.Mesh(base, baseMaterial)
      flag.add(clothMesh)
      flag.add(poleMesh)
      flag.add(barMesh)
      flag.add(baseMesh)
      flag.position.set(spot.x, spot.y, spot.z)
      flag.rotation.y = spot.rotationY
      this.group.add(flag)
    }, this)
  }

  /** 换歌 / 换主题时重画所有旗。paint: { font, fallbacks, faces[{background, ink, text, icon?}] } */
  MachiNobori.prototype.paint = function (paint) {
    this.flags.forEach(function (flag, index) {
      var content = paint.faces[index % paint.faces.length]
      var context = flag.canvas.getContext('2d')
      var width = flag.canvas.width
      var height = flag.canvas.height
      context.fillStyle = content.background
      context.fillRect(0, 0, width, height)
      // 上下各一道白边、旗杆一侧一条深色的穿杆布。
      context.fillStyle = 'rgba(255,255,255,0.85)'
      context.fillRect(0, height * 0.03, width, height * 0.012)
      context.fillRect(0, height * 0.955, width, height * 0.012)
      context.fillStyle = 'rgba(0,0,0,0.18)'
      context.fillRect(0, 0, width * 0.08, height)
      context.fillStyle = content.ink
      var top = height * 0.07
      if (content.icon) {
        var size = width * 0.62
        Raster.drawIcon(context, content.icon, paint.fallbacks, (width - size) / 2 + width * 0.03, top, size, content.ink, 2.2)
        top += size + height * 0.03
      }
      drawVertical(context, paint.font, content.text, width * 0.53, top, height * 0.93, width)
      flag.texture.needsUpdate = true
    })
  }

  MachiNobori.prototype.update = function (time, wind) {
    this.uniforms.uTime.value = time
    this.uniforms.uWind.value = wind
  }

  MachiNobori.prototype.dispose = function () {
    this.flags.forEach(function (flag) { flag.texture.dispose() })
    this.geometries.forEach(function (geometry) { geometry.dispose() })
  }

  // ===== 车流（traffic.ts） =====
  var WHEEL_RADIUS = 0.27
  var MACHI_TRAFFIC_CAR = { length: 3.3, width: 1.46 }
  /** 车身颜色：白、银、黑、藏青、红，最后一个是出租车（黄、车顶灯）。 */
  var CAR_COLORS = ['#e8eaee', '#aeb5bf', '#25292f', '#22385f', '#b8322e', '#f0c23a']
  var TAXI_INDEX = CAR_COLORS.length - 1

  /** 底座边缘的四个裁切面（只留 |x|、|z| ≤ half 的部分）。 */
  function createBaseClippingPlanes(half) {
    half = half === undefined ? 6 : half
    return [
      new THREE.Plane(new THREE.Vector3(-1, 0, 0), half),
      new THREE.Plane(new THREE.Vector3(1, 0, 0), half),
      new THREE.Plane(new THREE.Vector3(0, 0, -1), half),
      new THREE.Plane(new THREE.Vector3(0, 0, 1), half)
    ]
  }

  /**
   * 在材质的着色器里按 planes 裁掉底座外面的部分（distanceToPoint < 0 的一侧裁掉）。
   * 接在材质原有的 onBeforeCompile 后面，程序缓存键另加一段。
   */
  function clipToBase(material, planes) {
    var uniform = { value: planes.map(function (plane) { return new THREE.Vector4(plane.normal.x, plane.normal.y, plane.normal.z, plane.constant) }) }
    var previous = material.onBeforeCompile
    var previousKey = material.customProgramCacheKey
    material.onBeforeCompile = function (shader, renderer) {
      if (previous) previous.call(material, shader, renderer)
      shader.uniforms.uMachiBaseClip = uniform
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vMachiBaseClip;')
        .replace('#include <project_vertex>', '#include <project_vertex>\nvMachiBaseClip = (modelMatrix * vec4(transformed, 1.0)).xyz;')
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vMachiBaseClip;\nuniform vec4 uMachiBaseClip[' + planes.length + '];')
        .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\n' +
          'for (int i = 0; i < ' + planes.length + '; i++) {\n' +
          '    if (dot(uMachiBaseClip[i].xyz, vMachiBaseClip) + uMachiBaseClip[i].w < 0.0) discard;\n}')
    }
    material.customProgramCacheKey = function () {
      return (previousKey ? previousKey.call(material) : '') + ':machi-base-clip'
    }
    return material
  }

  /** 柔边的椭圆贴图：脚下阴影、前灯光斑共用。 */
  function createSoftEllipseTexture(forward) {
    var size = 128
    var canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    var context = canvas.getContext('2d')
    var image = context.createImageData(size, size)
    for (var y = 0; y < size; y += 1) {
      for (var x = 0; x < size; x += 1) {
        var u = (x + 0.5) / size * 2 - 1
        var v = (y + 0.5) / size * 2 - 1
        var d = Math.hypot(u, v)
        var bias = forward ? 0.45 + 0.55 * (1 - (u + 1) / 2) : 1
        var value = Math.round(255 * Math.pow(Math.max(0, 1 - d), 1.6) * bias)
        var index = (y * size + x) * 4
        image.data[index] = value
        image.data[index + 1] = value
        image.data[index + 2] = value
        image.data[index + 3] = forward ? 255 : value
      }
    }
    context.putImageData(image, 0, 0)
    var texture = new THREE.CanvasTexture(canvas)
    texture.colorSpace = THREE.NoColorSpace
    return texture
  }

  /** constructor(materials, blend, clipping, lanes, roadY) */
  function MachiTraffic(materials, blend, clipping, lanes, roadY) {
    this._blend = blend
    this._lanes = lanes
    this._roadY = roadY
    this.group = new THREE.Group()
    this.group.name = 'Traffic'
    this.car = new THREE.Group()
    this.wheels = []
    this.textures = []
    this.geometries = []
    this.colorIndex = -1
    this.active = false
    var self = this
    var clip = function (material) { return materials.track(clipToBase(material, clipping)) }
    this.body = clip(materials.snowy(new THREE.MeshToonMaterial({ color: CAR_COLORS[0], gradientMap: materials.gradient }), Shaders.MACHI_GLOSS.paint))
    var glass = clip(materials.snowy(new THREE.MeshToonMaterial({ color: '#1a2130', gradientMap: materials.gradient }), Shaders.MACHI_GLOSS.glass))
    var rubber = clip(materials.snowy(new THREE.MeshToonMaterial({ color: '#15171c', gradientMap: materials.gradient })))
    this.headlight = clip(new THREE.MeshBasicMaterial({ color: 0xffffff }))
    this.taillight = clip(new THREE.MeshBasicMaterial({ color: 0xffffff }))
    var lampMaterial = clip(new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 1.25, 0.6) }))
    var shadowTexture = createSoftEllipseTexture(false)
    var poolTexture = createSoftEllipseTexture(true)
    this.textures.push(shadowTexture, poolTexture)
    var shadow = clip(new THREE.MeshBasicMaterial({ color: 0x000000, alphaMap: shadowTexture, transparent: true, opacity: 0.55, depthWrite: false }))
    this.pool = clip(new THREE.MeshBasicMaterial({ map: poolTexture, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }))

    var part = function (geometry, material, x, y, z, name) {
      var meshInstance = new THREE.Mesh(geometry, material)
      meshInstance.position.set(x, y, z)
      meshInstance.name = name
      self.car.add(meshInstance)
      return meshInstance
    }
    // 车身沿 +x，车头在 +x。
    part(roundedBox(MACHI_TRAFFIC_CAR.length, 0.56, MACHI_TRAFFIC_CAR.width, 0.15), this.body, 0, 0.5, 0, 'Body')
    part(roundedBox(1.92, 0.5, 1.32, 0.13), glass, -0.22, 1.02, 0, 'Cabin')
    part(roundedBox(1.78, 0.08, 1.36, 0.04), this.body, -0.22, 1.3, 0, 'Roof')
    this.taxiLamp = part(roundedBox(0.36, 0.14, 0.2, 0.03), lampMaterial, -0.2, 1.41, 0, 'TaxiLamp')
    ;[-1, 1].forEach(function (side) {
      var head = part(roundedBox(0.06, 0.13, 0.32, 0.02), self.headlight, 1.64, 0.6, side * 0.48, 'Headlight')
      var tail = part(roundedBox(0.06, 0.12, 0.26, 0.02), self.taillight, -1.64, 0.64, side * 0.52, 'Taillight')
      head.layers.enable(MACHI_REFLECT_LAYER)
      tail.layers.enable(MACHI_REFLECT_LAYER)
    })
    var wheelGeometry = new THREE.CylinderGeometry(WHEEL_RADIUS, WHEEL_RADIUS, 0.2, 14)
    wheelGeometry.rotateX(Math.PI / 2)
    this.geometries.push(wheelGeometry)
    ;[[1.05, 0.66], [1.05, -0.66], [-1.05, 0.66], [-1.05, -0.66]].forEach(function (xz) {
      self.wheels.push(part(wheelGeometry, rubber, xz[0], WHEEL_RADIUS, xz[1], 'Wheel'))
    })
    var shadowGeometry = new THREE.PlaneGeometry(3.7, 1.9)
    shadowGeometry.rotateX(-Math.PI / 2)
    var poolGeometry = new THREE.PlaneGeometry(3.6, 2.4)
    poolGeometry.rotateX(-Math.PI / 2)
    this.geometries.push(shadowGeometry, poolGeometry)
    var shadowMesh = part(shadowGeometry, shadow, 0, 0.004, 0, 'Shadow')
    shadowMesh.renderOrder = 1
    var poolMesh = part(poolGeometry, this.pool, 3.4, 0.008, 0, 'HeadlightPool')
    poolMesh.renderOrder = 1
    this.car.children.forEach(function (child) {
      child.castShadow = false
      child.receiveShadow = false
    })
    this.car.visible = false
    this.group.add(this.car)
    this.syncColors()
  }

  MachiTraffic.prototype.syncColors = function () {
    this.headlight.color.copy(this._blend.get('streetLight')).multiplyScalar(3.2)
    this.taillight.color.copy(this._blend.get('stopRed')).multiplyScalar(2.6)
    this.pool.color.copy(this._blend.get('streetLight')).multiplyScalar(0.3)
  }

  /** 按氛围时间摆车；没有车时藏起来。 */
  MachiTraffic.prototype.update = function (time, seed, chance) {
    var pass = resolveMachiCar(time, seed, this._lanes, chance)
    this.active = Boolean(pass)
    this.car.visible = Boolean(pass)
    if (!pass) return
    var lane = this._lanes[pass.lane]
    var dx = lane.to[0] - lane.from[0]
    var dz = lane.to[1] - lane.from[1]
    var length = Math.hypot(dx, dz)
    var t = pass.distance / length
    this.car.position.set(lane.from[0] + dx * t, this._roadY, lane.from[1] + dz * t)
    this.car.rotation.y = Math.atan2(-dz, dx)
    this.wheels.forEach(function (wheel) { wheel.rotation.z = -pass.distance / WHEEL_RADIUS })
    var colorIndex = pass.colorIndex % CAR_COLORS.length
    if (colorIndex !== this.colorIndex) {
      this.colorIndex = colorIndex
      this.body.color.set(CAR_COLORS[colorIndex])
      this.taxiLamp.visible = colorIndex === TAXI_INDEX
    }
  }

  MachiTraffic.prototype.dispose = function () {
    this.textures.forEach(function (texture) { texture.dispose() })
    this.geometries.forEach(function (geometry) { geometry.dispose() })
  }

  window.FoliaMachiActors = {
    resolveMachiCar: resolveMachiCar,
    MACHI_CAR_SPEED: MACHI_CAR_SPEED,
    MachiNobori: MachiNobori,
    MachiTraffic: MachiTraffic,
    createBaseClippingPlanes: createBaseClippingPlanes,
    createSoftEllipseTexture: createSoftEllipseTexture,
    CAR_COLORS: CAR_COLORS
  }
})()
