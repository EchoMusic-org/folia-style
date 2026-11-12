// 加油站（station）场景（移植自 folia-major scenes/station/，源文件 layout.ts + stationSeed.ts + structures.ts +
// stationSignPaint.ts + stationSigns.ts + vehicles.ts + stationLights.ts + stationScene.ts，单文件装载）：
// 加油站停车场：前面一条路，后排左边停着一辆アドトラック（货厢侧面的 LED 屏逐字点亮当前行），后排右边是加油站罩棚，
// 前排车位停着出租车（顶灯滚下一句、曲名与歌手）和私家车，路边一根价格立柱（播放进度），左前角一根汽车旅馆的高立牌
// （名字是曲名，副歌时 NO VACANCY）。会动的：路过的车、走马灯泡、出租车顶灯、价格数字、偶尔打双闪的车、货车排气、
// 加油站的のぼり旗。按歌变的：车位停什么、车色、出租车配色、风向、水洼（stationSeed）。
// 全部顶层导出挂在 window.FoliaMachiSceneStation 上；宿主把它里面的 STATION_SCENE
// 登记进 window.FoliaMachiScenes.station（见 machi-runtime.js 的 Scenes 表）。
(function () {
  'use strict'

  var THREE = window.THREE
  var Geometry = window.FoliaMachiGeometry
  var SeedHash = window.FoliaSeedHash
  var PaletteMod = window.FoliaMachiPalette
  var Actors = window.FoliaMachiActors
  var Lights = window.FoliaMachiLights
  var Director = window.FoliaMachiDirector
  var BeatFx = window.FoliaMachiBeatFx
  var Reflection = window.FoliaMachiReflection
  var Raster = window.FoliaMachiSignRaster
  var LyricScreen = window.FoliaMachiLyricScreen
  var LedStrip = window.FoliaMachiLedStrip
  var WordColoring = window.FoliaWordColoring

  // 常用几何工具解构（来自 machi-geometry.js）。
  var group = Geometry.group
  var mesh = Geometry.mesh
  var boxAt = Geometry.boxAt
  var boxSpan = Geometry.boxSpan
  var cylinderAt = Geometry.cylinderAt
  var tubeBetween = Geometry.tubeBetween
  var bakeStatic = Geometry.bakeStatic
  var withGeometryCache = Geometry.withGeometryCache
  var buildMachiPlinth = Geometry.buildMachiPlinth
  var machiSurface = Geometry.machiSurface
  var MACHI_BASE = Geometry.MACHI_BASE

  var REFLECT_LAYER = Reflection.MACHI_REFLECT_LAYER

  // ===== layout.ts =====
  // 加油站停车场的尺寸表（米，原点在底座中心，y 向上，+z 是前、+x 是右）。默认镜头从正前偏右 25° 看过来，
  // 所以高的东西（加油站罩棚、货车）都放在后排，前排只有车和细高的立牌：仰角 30° 下前排的东西投到画面里更低，
  // 挡不到后排的货车屏幕。货车侧面的屏幕、出租车顶灯都朝 +z，离镜头方向 25°。

  var DEG = Math.PI / 180

  /** 各层地面的高度：路面与停车场同高，加油区是抬高一点的混凝土。 */
  var LEVEL = {
    road: 0,
    lot: 0.02,
    apron: 0.1
  }

  /**
   * 前面一条路（沿 x），一直通到底座边上；停车场在路后面，中间一道路缘、两处出入口。路宽按开过的车定：两条车道各宽约 1.6m
   * （车宽 1.46m），外侧车道的车身离底座边缘还有一点，不会被底座的裁切面切掉一边。
   */
  var ROAD = {
    z0: 2.35,
    z1: 6,
    curb: 0.16,
    /** 两条车道的中线（靠左行驶）：近的一条往 +x，远的一条往 -x。各在两条边线与中线之间居中。 */
    lanes: [3.36, 4.99],
    /** 路缘在这两段断开，是出入口。 */
    gaps: [[-1.2, 0.8], [1.8, 3.6]]
  }

  /** 加油站罩棚：后排右边，四根柱子，前沿与右沿挂品牌条。 */
  var CANOPY = {
    x0: 1.4,
    x1: 5.9,
    z0: -5.6,
    z1: -1.4,
    /** 罩棚底面与顶面。 */
    under: 3.85,
    top: 4.3,
    columns: [[2.05, -2.1], [5.25, -2.1], [2.05, -4.9], [5.25, -4.9]]
  }

  /** 加油岛：两座，沿 x，各两台加油机。 */
  var ISLANDS = {
    x0: 2.45,
    x1: 4.85,
    z: [-4.35, -2.75],
    width: 0.5,
    height: 0.16,
    pumps: [3.05, 4.25]
  }

  /** 抬高的加油区（混凝土）：罩棚下和罩棚前的一片。 */
  var APRON = {
    x0: 1.2,
    x1: 6,
    z0: -6,
    z1: 0.4
  }

  /** 货车（アドトラック）：后排左边，沿 x 停着，货厢侧面朝 +z 是一块 LED 屏；车头朝 +x。 */
  var TRUCK = {
    rear: -5.85,
    front: 1.1,
    z0: -5.7,
    z1: -3.6,
    deck: 1.0,
    boxTop: 3.4,
    /** 货厢到这里为止，往前是车头。 */
    boxFront: -0.7,
    cabBack: -0.55,
    cabTop: 2.75
  }

  /** 货厢侧面的屏幕（屏幕面的中心与尺寸）。 */
  var TRUCK_SCREEN = {
    x: (TRUCK.rear + TRUCK.boxFront) / 2,
    y: (TRUCK.deck + 0.22 + TRUCK.boxTop - 0.16) / 2,
    z: TRUCK.z1 + 0.03,
    width: TRUCK.boxFront - TRUCK.rear - 0.36,
    height: TRUCK.boxTop - 0.16 - (TRUCK.deck + 0.22)
  }

  /** 前排的停车位：车头朝 +z（朝路），车身沿 z。 */
  var STALLS = {
    x: [-4.75, -2.85, -0.95],
    z: -0.3,
    width: 1.9,
    depth: 3.6
  }

  /** 车的尺寸（沿车长、车宽、高）。 */
  var CAR = { length: 3.2, width: 1.42, height: 1.38 }

  /**
   * 加油区里停着的一辆（沿 x，车头朝 +x），与罩棚前面、加油区外的空地上一辆轻卡（沿 x，让开右边的价格立柱）。
   * 罩棚前排两根柱子之间只有 2.7m，停不下一辆车（车长 3.2m）：这辆车停在柱子那一排前面，罩棚前沿底下。
   */
  var PUMP_CAR = { x: 3.65, z: -0.95 }
  var KEI_TRUCK = { x: 3.1, z: 1.1 }

  /** 加油区的小道具（底面中心）：充气机与两格垃圾箱在左前柱外侧，轮胎堆在右边加油岛的尽头，都让开上面那辆车。 */
  var APRON_PROPS = {
    airPump: { x: 1.6, z: -0.75, width: 0.36, depth: 0.3 },
    bins: { x: 1.6, z: [-1.2, -1.57], size: 0.34 },
    tires: { x: 5.6, z: -2.9, radius: 0.37 }
  }

  /** 路缘后面一排：价格立柱、汽车旅馆的高立牌、场地灯。 */
  var PYLON = { x: 5.35, z: 1.75, height: 4.1, width: 1.0 }
  var MOTEL_SIGN = { x: -5.25, z: 1.85, height: 6.4 }
  var LOT_LAMP = { x: 0.9, z: 1.85, height: 5.0, arm: 1.2 }

  /** 默认视角：从正前偏右 25° 斜俯视（方位角按 three 的球坐标，从 +z 转向 +x）。 */
  var STATION_VIEW = {
    azimuth: 25 * DEG,
    elevation: 30 * DEG,
    zoom: 1.48
  }

  // ===== stationSeed.ts =====
  // 加油站停车场按歌变的东西（只依赖 seed，不碰 three）：三个车位停什么（至少一辆出租车）、车身颜色、出租车公司的配色、
  // 加油机旁和空地上有没有车、哪辆车打双闪、风向、水洼。

  var STALL_PATTERNS = [
    ['taxi', 'sedan', 'taxi'],
    ['sedan', 'taxi', 'taxi'],
    ['taxi', 'taxi', 'sedan'],
    ['taxi', 'empty', 'taxi'],
    ['sedan', 'taxi', 'empty'],
    ['empty', 'taxi', 'sedan']
  ]

  /** 按歌的 seed 解出这一场的变体：车位、车色、出租车涂装、有没有加油车与轻卡、双闪、风、水洼。 */
  var resolveStationVariation = function (seed, colorCount, liveryCount) {
    var random = SeedHash.createVisualizerRng('station:' + seed)
    var pick = function (min, max) { return min + (max - min) * random() }
    var stalls = STALL_PATTERNS[Math.floor(random() * STALL_PATTERNS.length)]
    var occupied = stalls.map(function (kind, index) { return kind === 'sedan' ? index : -1 }).filter(function (index) { return index >= 0 })
    return {
      stalls: stalls,
      carColors: stalls.map(function () { return Math.floor(random() * colorCount) }),
      pumpColor: Math.floor(random() * colorCount),
      keiColor: Math.floor(random() * colorCount),
      taxiLivery: Math.floor(random() * liveryCount),
      pumpCar: random() < 0.7,
      keiTruck: random() < 0.6,
      hazardStall: occupied.length && random() < 0.75 ? occupied[Math.floor(random() * occupied.length)] : -1,
      windYaw: pick(-0.6, 0.6),
      windSlant: pick(0.06, 0.2),
      puddleOffset: [pick(-40, 40), pick(-40, 40)],
      puddleAmount: pick(0.45, 0.75)
    }
  }

  // ===== structures.ts =====
  // 加油站停车场的固定几何：底座与路（一条路、路缘与两处出入口、车道线、停车位线与车轮挡）、抬高的加油区、
  // 罩棚（四根柱子、底面一排灯板、四边的品牌条）、两座加油岛与四台加油机、路边的价格立柱、汽车旅馆的高立牌、场地灯，
  // 以及几样小道具。招牌的字面另挂（stationSigns），这里只返回它们的位置。

  /** 一块招牌面：中心、朝向（绕 y）、宽高。 */
  var v = function (x, y, z) { return new THREE.Vector3(x, y, z) }

  /** 底座、路、停车场、加油区的地面。 */
  var buildStationGround = function (materials) {
    var h = MACHI_BASE.half
    var roadSurface = machiSurface(materials.toon('asphalt'), -h, h, -h, h, LEVEL.road, 'Surface/road')
    var apronSurface = machiSurface(materials.toon('concrete'), APRON.x0, APRON.x1, APRON.z0, APRON.z1, LEVEL.apron, 'Surface/apron')
    var surfaces = group('Base/Surfaces', roadSurface, apronSurface)
    surfaces.userData.dynamic = true
    var concrete = materials.toon('concrete')
    var curb = materials.toon('curb')
    var parts = []
    // 加油区：抬高一点的混凝土板，前沿是一道斜坡似的路缘。
    parts.push(boxSpan(concrete, APRON.x0 + 0.002, APRON.x1 - 0.002, LEVEL.road, LEVEL.apron - 0.004, APRON.z0 + 0.002, APRON.z1 - 0.002, { radius: 0.02, name: 'Apron/slab' }))
    // 路缘：停车场与路之间，在出入口断开。
    var curbZ0 = ROAD.z0 - ROAD.curb
    var from = -h
    ;ROAD.gaps.concat([[h, h]]).forEach(function (gap) {
      if (gap[0] - from > 0.05) parts.push(boxSpan(curb, from, gap[0], LEVEL.road, 0.12, curbZ0, ROAD.z0, { radius: 0.02, name: 'Curb' }))
      from = gap[1]
    })
    // 路面的白漆：中线（虚线）、两侧边线、停车位线（InstancedMesh 一种白漆）。
    var bars = []
    var mid = (ROAD.lanes[0] + ROAD.lanes[1]) / 2
    for (var x = -h + 0.3; x < h - 0.6; x += 1.4) bars.push({ x: x + 0.4, z: mid, w: 0.8, d: 0.1 })
    bars.push({ x: 0, z: ROAD.z0 + 0.22, w: h * 2, d: 0.08 })
    bars.push({ x: 0, z: ROAD.z1 - 0.2, w: h * 2, d: 0.08 })
    var stallEdges = [STALLS.x[0] - STALLS.width / 2]
    STALLS.x.forEach(function (x) { stallEdges.push(x + STALLS.width / 2) })
    stallEdges.forEach(function (x) { bars.push({ x: x, z: STALLS.z, w: 0.09, d: STALLS.depth }) })
    bars.push({ x: (stallEdges[0] + stallEdges[stallEdges.length - 1]) / 2, z: STALLS.z - STALLS.depth / 2, w: stallEdges[stallEdges.length - 1] - stallEdges[0] + 0.09, d: 0.09 })
    var paintGeometry = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2)
    var paint = new THREE.InstancedMesh(paintGeometry, materials.toon('roadPaint'), bars.length)
    paint.name = 'Base/Paint'
    paint.receiveShadow = true
    var matrix = new THREE.Matrix4()
    bars.forEach(function (bar, index) {
      matrix.makeScale(bar.w, 1, bar.d)
      matrix.setPosition(bar.x, LEVEL.road + 0.006, bar.z)
      paint.setMatrixAt(index, matrix)
    })
    parts.push(paint)
    // 车轮挡：每个车位后面一块。
    STALLS.x.forEach(function (x) {
      parts.push(boxAt(materials.toon('curb'), [0.9, 0.1, 0.16], [x, LEVEL.road, STALLS.z - STALLS.depth / 2 + 0.45], { radius: 0.03, name: 'WheelStop' }))
    })
    // 井盖。
    var manhole = mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.02, 24), materials.toon('darkMetal'), { name: 'Manhole', castShadow: false })
    manhole.position.set(-2.6, LEVEL.road + 0.01, mid + 0.4)
    parts.push(manhole)
    var base = group('Base', buildMachiPlinth(materials), group.apply(null, ['Base/Lot'].concat(parts)), surfaces)
    return { group: base, roadSurface: roadSurface, lotSurfaces: [apronSurface] }
  }

  /** 罩棚：柱子、顶板、四边的品牌条、底面的灯板。返回前沿招牌面。 */
  var buildCanopy = function (materials) {
    var C = CANOPY
    var parts = []
    parts.push(boxSpan(materials.toon('canopyUnder'), C.x0, C.x1, C.under, C.top - 0.06, C.z0, C.z1, { radius: 0.04, name: 'Canopy/deck' }))
    parts.push(boxSpan(materials.toon('canopyTop'), C.x0 - 0.04, C.x1 + 0.04, C.top - 0.08, C.top, C.z0 - 0.04, C.z1 + 0.04, { radius: 0.03, name: 'Canopy/lid' }))
    // 四边的品牌条：一道主色宽条、一道副色细条。
    var band = function (role, y0, y1, inset) {
      var material = materials.toon(role)
      var o = 0.02 + inset
      parts.push(boxSpan(material, C.x0 - o, C.x1 + o, y0, y1, C.z1 - 0.02, C.z1 + o, { radius: 0.01, name: 'Canopy/band:' + role }))
      parts.push(boxSpan(material, C.x0 - o, C.x1 + o, y0, y1, C.z0 - o, C.z0 + 0.02, { radius: 0.01, name: 'Canopy/band:' + role }))
      parts.push(boxSpan(material, C.x1 - 0.02, C.x1 + o, y0, y1, C.z0 - o, C.z1 + o, { radius: 0.01, name: 'Canopy/band:' + role }))
      parts.push(boxSpan(material, C.x0 - o, C.x0 + 0.02, y0, y1, C.z0 - o, C.z1 + o, { radius: 0.01, name: 'Canopy/band:' + role }))
    }
    band('brand0', C.under - 0.02, C.under + 0.14, 0.01)
    band('brand2', C.under + 0.16, C.under + 0.21, 0.012)
    // 柱子：方柱，半腰一道品牌色，脚下一圈黄黑的防撞护栏。
    C.columns.forEach(function (column, index) {
      var x = column[0]
      var z = column[1]
      parts.push(boxAt(materials.toon('canopyColumn'), [0.32, C.under - LEVEL.apron, 0.32], [x, LEVEL.apron, z], { radius: 0.03, name: 'Canopy/column' + index }))
      parts.push(boxAt(materials.toon('brand0'), [0.34, 0.5, 0.34], [x, 1.4, z], { radius: 0.03, name: 'Canopy/columnBand' }))
      parts.push(boxAt(materials.toon('caution'), [0.5, 0.42, 0.5], [x, LEVEL.apron, z], { radius: 0.05, name: 'Canopy/guard' }))
    })
    // 底面的灯板：两排各三块，自发光。
    var lights = []
    for (var row = 0; row < 2; row += 1) {
      for (var col = 0; col < 3; col += 1) {
        var x = C.x0 + 0.85 + col * ((C.x1 - C.x0 - 1.7) / 2)
        var z = C.z0 + 1.2 + row * (C.z1 - C.z0 - 2.4)
        var panel = mesh(new THREE.PlaneGeometry(0.9, 0.5).rotateX(Math.PI / 2), materials.glow('canopyLight'), { name: 'Canopy/light', castShadow: false, receiveShadow: false })
        panel.position.set(x, C.under - 0.005, z)
        parts.push(panel)
        lights.push(v(x, C.under - 0.05, z))
      }
    }
    var signFront = {
      position: v((C.x0 + C.x1) / 2, C.top - 0.2, C.z1 + 0.035),
      rotationY: 0,
      width: 2.3,
      height: 0.34
    }
    var signRight = {
      position: v(C.x1 + 0.035, C.top - 0.2, (C.z0 + C.z1) / 2),
      rotationY: Math.PI / 2,
      width: 2.3,
      height: 0.34
    }
    return { group: group.apply(null, ['Canopy'].concat(parts)), lights: lights, signFront: signFront, signRight: signRight }
  }

  /** 两座加油岛，各两台加油机（机身、顶上的品牌色灯箱、两面的小屏、油枪与软管）。 */
  var buildIslands = function (materials) {
    var I = ISLANDS
    var parts = []
    var dark = materials.toon('darkMetal')
    I.z.forEach(function (z, islandIndex) {
      parts.push(boxSpan(materials.toon('concrete'), I.x0, I.x1, LEVEL.apron, LEVEL.apron + I.height, z - I.width / 2, z + I.width / 2, { radius: 0.05, name: 'Island' }))
      // 岛两头黄黑的护柱。
      ;[I.x0 + 0.12, I.x1 - 0.12].forEach(function (x) {
        parts.push(cylinderAt(materials.toon('caution'), 0.06, 0.75, [x, LEVEL.apron + I.height, z], { segments: 10, name: 'Island/bollard' }))
      })
      I.pumps.forEach(function (x, pumpIndex) {
        var y0 = LEVEL.apron + I.height
        parts.push(boxAt(materials.toon('pumpBody'), [0.55, 1.45, 0.36], [x, y0, z], { radius: 0.05, name: 'Pump' + islandIndex + pumpIndex }))
        parts.push(boxAt(materials.toon('brand0'), [0.58, 0.24, 0.39], [x, y0 + 1.45, z], { radius: 0.04, name: 'Pump/crown' }))
        ;[-1, 1].forEach(function (side) {
          var screen = mesh(new THREE.PlaneGeometry(0.34, 0.2), materials.glow('pumpScreen'), { name: 'Pump/screen', castShadow: false, receiveShadow: false })
          screen.position.set(x, y0 + 1.05, z + side * 0.185)
          if (side < 0) screen.rotation.y = Math.PI
          parts.push(screen)
          // 油枪挂在机身两侧，软管垂下来再接回去。
          var holster = v(x + side * 0.3, y0 + 0.8, z)
          parts.push(boxAt(dark, [0.08, 0.2, 0.12], [holster.x, holster.y - 0.1, holster.z], { radius: 0.02, name: 'Pump/nozzle' }))
          var hoseTop = v(x + side * 0.2, y0 + 1.3, z)
          var hoseLow = v(x + side * 0.42, y0 + 0.35, z + 0.05)
          parts.push(tubeBetween(dark, hoseTop, hoseLow, 0.025, { name: 'Pump/hose', castShadow: false }))
          parts.push(tubeBetween(dark, hoseLow, holster, 0.025, { name: 'Pump/hose', castShadow: false }))
        })
      })
    })
    return group.apply(null, ['Islands'].concat(parts))
  }

  /** 路边的价格立柱：两根柱子托一块高灯箱。返回两面招牌（朝前、朝后）。 */
  var buildPylon = function (materials) {
    var P = PYLON
    var rotationY = STATION_VIEW.azimuth * 0.6
    var root = new THREE.Group()
    root.name = 'Pylon'
    var boxBottom = 0.9
    var boxHeight = P.height - boxBottom
    root.add(
      boxAt(materials.toon('darkMetal'), [0.1, boxBottom + 0.1, 0.14], [-P.width * 0.3, LEVEL.road, 0], { radius: 0.02, name: 'Post' }),
      boxAt(materials.toon('darkMetal'), [0.1, boxBottom + 0.1, 0.14], [P.width * 0.3, LEVEL.road, 0], { radius: 0.02, name: 'Post' }),
      boxAt(materials.toon('canopyFascia'), [P.width, boxHeight, 0.22], [0, boxBottom, 0], { radius: 0.05, name: 'Box' }),
      boxAt(materials.toon('brand0'), [P.width + 0.04, 0.08, 0.26], [0, P.height - 0.02, 0], { radius: 0.02, name: 'Cap' }),
      boxAt(materials.toon('concrete'), [P.width + 0.2, 0.16, 0.5], [0, LEVEL.road, 0], { radius: 0.03, name: 'Footing' })
    )
    root.position.set(P.x, 0, P.z)
    root.rotation.y = rotationY
    var faceWidth = P.width - 0.08
    var faceHeight = boxHeight - 0.1
    var center = v(0, boxBottom + boxHeight / 2, 0)
    var faces = [1, -1].map(function (side) {
      var local = center.clone().setZ(side * 0.115).applyAxisAngle(new THREE.Vector3(0, 1, 0), rotationY)
      return { position: local.add(v(P.x, 0, P.z)), rotationY: rotationY + (side > 0 ? 0 : Math.PI), width: faceWidth, height: faceHeight }
    })
    return { group: root, faces: faces }
  }

  /**
   * 汽车旅馆的高立牌：一根柱子，顶上一块竖的「MOTEL」灯箱，下面一块写名字的横牌、一个「VACANCY」小灯箱，
   * 一支指向下方的箭头（边上一圈走马灯泡）。整块牌朝着默认镜头。返回各块字面与箭头的轮廓（世界坐标）。
   */
  var buildMotelSign = function (materials) {
    var M = MOTEL_SIGN
    var root = new THREE.Group()
    root.name = 'MotelSign'
    var back = materials.toon('motelBack')
    var neonTrim = materials.glow('motelNeon')
    root.add(cylinderAt(materials.toon('motelPole'), 0.11, M.height, [0, LEVEL.road, 0], { radiusTop: 0.09, segments: 12, name: 'Pole' }))
    root.add(cylinderAt(materials.toon('concrete'), 0.3, 0.2, [0, LEVEL.road, 0], { segments: 14, name: 'Footing' }))
    // 竖灯箱：「MOTEL」五个字母竖排。灯箱都比杆子粗（杆子半径约 0.1），杆子整根藏在灯箱里，不会从字面上穿出来。
    var tall = { w: 0.86, h: 2.5, y0: M.height - 2.55, x: 0.38 }
    root.add(boxAt(back, [tall.w, tall.h, 0.26], [tall.x, tall.y0, 0], { radius: 0.06, name: 'Tall' }))
    root.add(boxAt(neonTrim, [tall.w + 0.06, 0.04, 0.3], [tall.x, tall.y0 + tall.h, 0], { radius: 0.01, name: 'Tall/trim', castShadow: false }))
    root.add(boxAt(neonTrim, [tall.w + 0.06, 0.04, 0.3], [tall.x, tall.y0 - 0.04, 0], { radius: 0.01, name: 'Tall/trim', castShadow: false }))
    // 名字横牌与 VACANCY 小灯箱。
    var name = { w: 2.1, h: 0.62, y0: tall.y0 - 0.85, x: 0.55 }
    root.add(boxAt(back, [name.w, name.h, 0.26], [name.x, name.y0, 0], { radius: 0.05, name: 'Name' }))
    var vacancy = { w: 1.3, h: 0.34, y0: name.y0 - 0.5, x: 0.7 }
    root.add(boxAt(back, [vacancy.w, vacancy.h, 0.24], [vacancy.x, vacancy.y0, 0], { radius: 0.04, name: 'Vacancy' }))
    // 箭头：从竖灯箱右边弯下来，指向地面（扁平的形状，正面一圈灯泡另挂）。
    var arrow = new THREE.Shape()
    var ax = tall.x + tall.w / 2
    var top = tall.y0 + tall.h * 0.78
    var neck = name.y0 + name.h + 0.28
    arrow.moveTo(ax, top)
    arrow.lineTo(ax + 0.85, top)
    arrow.lineTo(ax + 0.85, neck)
    arrow.lineTo(ax + 1.12, neck)
    arrow.lineTo(ax + 0.65, name.y0 + name.h + 0.02)
    arrow.lineTo(ax + 0.18, neck)
    arrow.lineTo(ax + 0.45, neck)
    arrow.lineTo(ax + 0.45, top - 0.4)
    arrow.lineTo(ax, top - 0.4)
    arrow.closePath()
    var arrowGeometry = new THREE.ExtrudeGeometry(arrow, { depth: 0.12, bevelEnabled: false })
    arrowGeometry.translate(0, 0, -0.06)
    root.add(mesh(arrowGeometry, materials.toon('brand0'), { name: 'Arrow' }))
    var rotationY = STATION_VIEW.azimuth
    root.position.set(M.x, 0, M.z)
    root.rotation.y = rotationY
    root.updateMatrixWorld(true)
    var world = function (x, y, z) { return v(x, y, z).applyMatrix4(root.matrixWorld) }
    var face = function (x, y, width, height, depth) {
      return {
        position: world(x, y, depth),
        rotationY: rotationY,
        width: width,
        height: height
      }
    }
    // 箭头轮廓上的灯泡位置（世界坐标），按轮廓走一圈的顺序。
    var outline = arrow.getPoints(1)
    var bulbs = []
    for (var index = 0; index < outline.length - 1; index += 1) {
      var a = outline[index]
      var b = outline[index + 1]
      var steps = Math.max(1, Math.round(a.distanceTo(b) / 0.16))
      for (var step = 0; step < steps; step += 1) {
        var p = a.clone().lerp(b, step / steps)
        bulbs.push(world(p.x, p.y, 0.075))
      }
    }
    return {
      group: root,
      tall: face(tall.x, tall.y0 + tall.h / 2, tall.w - 0.12, tall.h - 0.12, 0.135),
      name: face(name.x, name.y0 + name.h / 2, name.w - 0.1, name.h - 0.1, 0.135),
      vacancy: face(vacancy.x, vacancy.y0 + vacancy.h / 2, vacancy.w - 0.08, vacancy.h - 0.06, 0.125),
      bulbs: bulbs,
      rotationY: rotationY,
      glow: world(0.8, tall.y0 + 0.5, 0.6)
    }
  }

  /** 场地灯：一根高杆，臂伸向停车场，灯头朝下。返回灯头（世界坐标）。 */
  var buildLotLamp = function (materials) {
    var L = LOT_LAMP
    var metal = materials.toon('pole')
    var top = LEVEL.road + L.height
    var parts = [
      cylinderAt(metal, 0.085, L.height, [L.x, LEVEL.road, L.z], { radiusTop: 0.06, segments: 10, name: 'Pole' }),
      cylinderAt(materials.toon('darkMetal'), 0.13, 0.3, [L.x, LEVEL.road, L.z], { segments: 10, name: 'Foot' }),
      tubeBetween(metal, v(L.x, top - 0.15, L.z), v(L.x - L.arm, top + 0.05, L.z - 0.4), 0.04, { name: 'Arm' }),
      boxAt(materials.toon('darkMetal'), [0.6, 0.1, 0.3], [L.x - L.arm - 0.1, top - 0.04, L.z - 0.45], { radius: 0.04, name: 'Head', rotationY: 0.3 })
    ]
    var lens = mesh(new THREE.PlaneGeometry(0.5, 0.22).rotateX(Math.PI / 2), materials.glow('lampHead'), { name: 'Lens', castShadow: false, receiveShadow: false })
    lens.position.set(L.x - L.arm - 0.1, top - 0.045, L.z - 0.45)
    lens.rotation.y = 0.3
    parts.push(lens)
    return { group: group.apply(null, ['LotLamp'].concat(parts)), head: v(L.x - L.arm - 0.1, top - 0.06, L.z - 0.45) }
  }

  /** 小道具：充气机、轮胎堆、垃圾箱、机油架。 */
  var buildStationProps = function (materials) {
    var parts = []
    var dark = materials.toon('darkMetal')
    var airPump = APRON_PROPS.airPump
    var bins = APRON_PROPS.bins
    var tires = APRON_PROPS.tires
    // 充气机：罩棚左前柱外侧。
    parts.push(boxAt(materials.toon('brand2'), [airPump.width, 1.1, airPump.depth], [airPump.x, LEVEL.apron, airPump.z], { radius: 0.04, name: 'AirPump' }))
    parts.push(tubeBetween(dark, v(airPump.x + 0.1, LEVEL.apron + 0.95, airPump.z + 0.15), v(airPump.x + 0.3, LEVEL.apron + 0.1, airPump.z + 0.3), 0.02, { name: 'AirPump/hose', castShadow: false }))
    // 轮胎堆：右边加油岛的尽头。
    var tire = new THREE.TorusGeometry(0.26, 0.11, 8, 18).rotateX(Math.PI / 2)
    for (var index = 0; index < 4; index += 1) {
      var ring = mesh(tire, materials.toon('rubber'), { name: 'Tire' })
      ring.position.set(tires.x, LEVEL.apron + 0.11 + index * 0.21, tires.z)
      parts.push(ring)
    }
    // 垃圾箱（两格，充气机后面排成一列）与机油架。
    bins.z.forEach(function (z, binIndex) {
      parts.push(boxAt(materials.toon(binIndex === 0 ? 'brand0' : 'brand2'), [bins.size, 0.78, bins.size], [bins.x, LEVEL.apron, z], { radius: 0.03, name: 'Bin' }))
    })
    parts.push(boxAt(materials.toon('canopyColumn'), [0.9, 1.0, 0.32], [5.3, LEVEL.apron, -5.55], { radius: 0.03, name: 'OilRack' }))
    for (var oil = 0; oil < 6; oil += 1) {
      parts.push(boxAt(materials.toon('product' + oil), [0.1, 0.18, 0.08], [4.95 + (oil % 3) * 0.32, LEVEL.apron + 1.0 + Math.floor(oil / 3) * 0.0, -5.42], { radius: 0.01, name: 'OilCan' }))
    }
    return group.apply(null, ['StationProps'].concat(parts))
  }

  /** 默认构图要框进去的点：底座顶面四角与两侧厚度、罩棚顶、货车顶、旅馆立牌顶。 */
  var stationFramingPoints = function () {
    var h = MACHI_BASE.half
    var points = []
    ;[-h, h].forEach(function (x) {
      ;[-h, h].forEach(function (z) {
        points.push(v(x, 0, z))
        if (z < 0 || x < 0) points.push(v(x, -MACHI_BASE.depth, z))
      })
    })
    points.push(v(CANOPY.x0, CANOPY.top, CANOPY.z0), v(CANOPY.x1, CANOPY.top, CANOPY.z0), v(CANOPY.x1, CANOPY.top, CANOPY.z1))
    points.push(v(MOTEL_SIGN.x, MOTEL_SIGN.height + 0.2, MOTEL_SIGN.z))
    points.push(v(-5.9, 3.5, -5.7), v(1.1, 3.5, -5.7))
    return points
  }

  // ===== vehicles.ts =====
  // 停着的车：轿车、出租车（车顶一块 LED 顶灯，前挡风玻璃里亮着「空車」）、轻卡，与后排那辆アドトラック（货厢侧面是屏幕）。
  // 车都在本地坐标里搭：车头朝 +z、底面在 y = 0，摆的时候再转。车身颜色走场景调色板的键（按 seed 选），灯是自发光件。

  var WHEEL_RADIUS = 0.27

  var wheel = function (materials, x, z, radius, width) {
    radius = radius === undefined ? WHEEL_RADIUS : radius
    width = width === undefined ? 0.2 : width
    var geometry = new THREE.CylinderGeometry(radius, radius, width, 14)
    geometry.rotateZ(Math.PI / 2)
    var result = mesh(geometry, materials.toon('rubber'), { name: 'Wheel' })
    result.position.set(x, radius, z)
    return result
  }

  /** 一辆停着的车（轿车 / 出租车 / 轻卡）。bodyKey 是车身颜色的调色板键。 */
  var buildParkedCar = function (materials, kind, bodyKey, name, shadowMaterial, hazard) {
    hazard = hazard === undefined ? false : hazard
    // 这辆车会打双闪的话，琥珀色小灯用会闪的那种自发光。
    var hazardRole = hazard ? 'hazard' : 'hazardIdle'
    var length = kind === 'kei' ? 3.0 : CAR.length
    var width = kind === 'kei' ? 1.36 : CAR.width
    var half = length / 2
    var body = materials.toon(bodyKey)
    var glass = materials.toon('carGlass')
    var dark = materials.toon('darkMetal')
    var parts = []
    var andon = null
    if (kind === 'kei') {
      // 轻卡：前面一个方头驾驶室，后面平板车斗带低栏板。
      parts.push(boxSpan(body, -width / 2, width / 2, 0.3, 0.72, -half, half, { radius: 0.06, name: 'Kei/chassis' }))
      parts.push(boxSpan(body, -width / 2 + 0.02, width / 2 - 0.02, 0.72, 1.42, half - 1.05, half, { radius: 0.1, name: 'Kei/cab' }))
      parts.push(boxSpan(glass, -width / 2 + 0.06, width / 2 - 0.06, 0.95, 1.36, half - 0.06, half + 0.005, { radius: 0.03, name: 'Kei/windshield' }))
      parts.push(boxSpan(glass, -width / 2 - 0.005, width / 2 + 0.005, 0.98, 1.34, half - 0.95, half - 0.2, { radius: 0.02, name: 'Kei/sideWindow' }))
      var bedBack = -half + 0.04
      var bedFront = half - 1.12
      ;[-1, 1].forEach(function (side) {
        parts.push(boxSpan(body, side * width / 2 - 0.03, side * width / 2 + 0.03, 0.72, 1.0, bedBack, bedFront, { radius: 0.01, name: 'Kei/sideGate' }))
      })
      parts.push(boxSpan(body, -width / 2, width / 2, 0.72, 1.0, bedBack - 0.03, bedBack + 0.03, { radius: 0.01, name: 'Kei/tailGate' }))
      parts.push(boxSpan(dark, -width / 2 + 0.06, width / 2 - 0.06, 1.42, 1.48, bedFront - 0.02, bedFront + 0.04, { radius: 0.01, name: 'Kei/guard' }))
    } else {
      parts.push(boxSpan(body, -width / 2, width / 2, 0.25, 0.8, -half, half, { radius: 0.14, name: 'Car/body' }))
      parts.push(boxSpan(glass, -width / 2 + 0.07, width / 2 - 0.07, 0.78, 1.3, -half * 0.62, half * 0.42, { radius: 0.12, name: 'Car/cabin' }))
      parts.push(boxSpan(body, -width / 2 + 0.08, width / 2 - 0.08, 1.27, 1.35, -half * 0.55, half * 0.32, { radius: 0.04, name: 'Car/roof' }))
      // 车门的竖缝与腰线：车身色的细条压一道深色。
      parts.push(boxSpan(dark, -width / 2 - 0.004, width / 2 + 0.004, 0.52, 0.54, -half + 0.3, half - 0.3, { radius: 0.005, name: 'Car/beltline' }))
      if (kind === 'taxi') {
        // 顶灯：车顶一块小灯箱，正面（+z）是 LED 屏。
        var andonY = 1.35
        parts.push(boxSpan(dark, -0.5, 0.5, andonY, andonY + 0.05, -0.2, 0.12, { radius: 0.01, name: 'Taxi/andonBase' }))
        parts.push(boxSpan(materials.toon('taxiTrim'), -0.6, 0.6, andonY + 0.05, andonY + 0.43, -0.18, 0.1, { radius: 0.04, name: 'Taxi/andon' }))
        andon = { position: new THREE.Vector3(0, andonY + 0.24, 0.106), width: 1.08, height: 0.32 }
        // 前挡风玻璃里亮着的「空車」牌（红色）。
        var vacant = mesh(new THREE.PlaneGeometry(0.34, 0.11), materials.glow('vacant'), { name: 'Taxi/vacant', castShadow: false, receiveShadow: false })
        vacant.position.set(width / 2 - 0.42, 0.9, half * 0.42 + 0.004)
        parts.push(vacant)
        // 车身侧面一条腰线色带（出租车公司的色）。
        ;[-1, 1].forEach(function (side) {
          parts.push(boxSpan(materials.toon('taxiTrim'), side * (width / 2 + 0.004) - 0.004, side * (width / 2 + 0.004) + 0.004, 0.56, 0.66, -half + 0.25, half - 0.25, { radius: 0.003, name: 'Taxi/stripe' }))
        })
      }
    }
    // 前后保险杠、车灯、轮子。
    parts.push(boxSpan(dark, -width / 2 + 0.04, width / 2 - 0.04, 0.22, 0.38, half - 0.04, half + 0.04, { radius: 0.03, name: 'Bumper/front' }))
    parts.push(boxSpan(dark, -width / 2 + 0.04, width / 2 - 0.04, 0.22, 0.38, -half - 0.04, -half + 0.04, { radius: 0.03, name: 'Bumper/rear' }))
    ;[-1, 1].forEach(function (side) {
      var head = boxAt(materials.glow('carHead'), [0.3, 0.1, 0.04], [side * (width / 2 - 0.26), 0.58, half + 0.005], { radius: 0.02, name: 'Headlight', castShadow: false })
      var tail = boxAt(materials.glow('carTail'), [0.26, 0.1, 0.04], [side * (width / 2 - 0.22), 0.62, -half - 0.005], { radius: 0.02, name: 'Taillight', castShadow: false })
      // 双闪：前后各一盏琥珀色小灯（亮度由场景按时间表调）。
      var blinkFront = boxAt(materials.glow(hazardRole), [0.1, 0.06, 0.03], [side * (width / 2 - 0.06), 0.5, half + 0.012], { radius: 0.01, name: 'Hazard', castShadow: false })
      var blinkRear = boxAt(materials.glow(hazardRole), [0.1, 0.06, 0.03], [side * (width / 2 - 0.06), 0.5, -half - 0.012], { radius: 0.01, name: 'Hazard', castShadow: false })
      parts.push(head, tail, blinkFront, blinkRear)
      // 后视镜。
      if (kind !== 'kei') parts.push(boxAt(body, [0.14, 0.08, 0.06], [side * (width / 2 + 0.05), 0.92, half * 0.36], { radius: 0.02, name: 'Mirror' }))
    })
    var axle = half - (kind === 'kei' ? 0.5 : 0.62)
    // 轮子外侧比车身侧面凸出一点：齐平的话轮胎和车身侧面同在一个面上，会互相闪。
    ;[[-1, axle], [1, axle], [-1, -axle], [1, -axle]].forEach(function (item) {
      var side = item[0]
      var z = item[1]
      parts.push(wheel(materials, side * (width / 2 - 0.085), z))
    })
    // 车下一块软影（车停着也有落地感，不靠阴影图）。
    var shadow = mesh(new THREE.PlaneGeometry(width + 0.5, length + 0.5).rotateX(-Math.PI / 2), shadowMaterial, { name: 'Shadow', castShadow: false, receiveShadow: false })
    shadow.position.y = 0.004
    parts.push(shadow)
    return { group: group.apply(null, [name].concat(parts)), andon: andon }
  }

  /** 后排的アドトラック：车头朝 +x，货厢侧面（+z）是屏幕。返回屏幕框的位置（世界坐标）与排气管口。 */
  var buildAdTruck = function (materials, shadowMaterial) {
    var T = TRUCK
    var zc = (T.z0 + T.z1) / 2
    var width = T.z1 - T.z0
    var dark = materials.toon('darkMetal')
    var box = materials.toon('truckBox')
    var cab = materials.toon('truckCab')
    var glass = materials.toon('carGlass')
    var parts = []
    // 车架与货厢。
    parts.push(boxSpan(dark, T.rear + 0.1, T.front - 0.2, 0.55, T.deck, zc - 0.7, zc + 0.7, { radius: 0.04, name: 'Truck/frame' }))
    parts.push(boxSpan(box, T.rear, T.boxFront, T.deck, T.boxTop, T.z0, T.z1, { radius: 0.07, name: 'Truck/box' }))
    // 屏幕的黑框：比屏幕大一圈，贴在货厢侧面。
    parts.push(boxSpan(dark, T.rear + 0.12, T.boxFront - 0.12, T.deck + 0.14, T.boxTop - 0.08, T.z1 - 0.02, T.z1 + 0.02, { radius: 0.02, name: 'Truck/bezel' }))
    // 货厢顶沿、底沿一排琥珀色示廓灯。
    var markerSpacing = (T.boxFront - T.rear - 0.4) / 7
    for (var index = 0; index <= 7; index += 1) {
      var x = T.rear + 0.2 + index * markerSpacing
      parts.push(boxAt(materials.glow('marker'), [0.1, 0.05, 0.03], [x, T.boxTop - 0.05, T.z1 + 0.02], { radius: 0.01, name: 'Marker', castShadow: false }))
      parts.push(boxAt(materials.glow('marker'), [0.1, 0.05, 0.03], [x, T.deck + 0.02, T.z1 + 0.02], { radius: 0.01, name: 'Marker', castShadow: false }))
    }
    // 车头：方头驾驶室、挡风玻璃、侧窗、遮阳板、保险杠、大灯。
    parts.push(boxSpan(cab, T.cabBack, T.front, 0.75, T.cabTop, T.z0 + 0.05, T.z1 - 0.05, { radius: 0.12, name: 'Truck/cab' }))
    parts.push(boxSpan(glass, T.front - 0.03, T.front + 0.005, 1.55, T.cabTop - 0.25, T.z0 + 0.18, T.z1 - 0.18, { radius: 0.03, name: 'Truck/windshield' }))
    ;[T.z0 + 0.045, T.z1 - 0.045].forEach(function (z) {
      parts.push(boxSpan(glass, T.front - 0.75, T.front - 0.12, 1.6, T.cabTop - 0.3, z - 0.01, z + 0.01, { radius: 0.02, name: 'Truck/sideWindow' }))
    })
    parts.push(boxSpan(dark, T.front - 0.05, T.front + 0.06, T.cabTop - 0.2, T.cabTop - 0.12, T.z0 + 0.1, T.z1 - 0.1, { radius: 0.02, name: 'Truck/visor' }))
    parts.push(boxSpan(dark, T.front - 0.1, T.front + 0.08, 0.45, 0.85, T.z0 + 0.04, T.z1 - 0.04, { radius: 0.04, name: 'Truck/bumper' }))
    ;[T.z0 + 0.32, T.z1 - 0.32].forEach(function (z) {
      parts.push(boxAt(materials.glow('carHead'), [0.04, 0.14, 0.3], [T.front + 0.085, 0.86, z], { radius: 0.02, name: 'Truck/headlight', castShadow: false }))
    })
    parts.push(boxSpan(dark, T.front - 0.03, T.front + 0.01, 0.95, 1.45, (T.z0 + T.z1) / 2 - 0.45, (T.z0 + T.z1) / 2 + 0.45, { radius: 0.02, name: 'Truck/grille' }))
    // 后视镜（支在驾驶室两侧）。
    ;[T.z0 - 0.08, T.z1 + 0.08].forEach(function (z) {
      parts.push(tubeBetween(dark, new THREE.Vector3(T.front - 0.2, 2.05, z > zc ? T.z1 - 0.05 : T.z0 + 0.05), new THREE.Vector3(T.front - 0.05, 2.05, z), 0.02, { name: 'Truck/mirrorArm' }))
      parts.push(boxAt(dark, [0.06, 0.38, 0.14], [T.front - 0.03, 1.86, z], { radius: 0.02, name: 'Truck/mirror' }))
    })
    // 排气管（驾驶室后面竖起来）、油箱、挡泥板。
    var stack = new THREE.Vector3(T.cabBack - 0.1, T.cabTop + 0.35, T.z1 - 0.18)
    parts.push(cylinderAt(materials.toon('metal'), 0.07, stack.y - 1.0, [stack.x, 1.0, stack.z], { segments: 10, name: 'Truck/stack' }))
    parts.push(cylinderAt(materials.toon('metal'), 0.22, 0.9, [T.cabBack + 0.55, 0.12, T.z1 - 0.3], { segments: 14, name: 'Truck/tank' }).rotateZ(Math.PI / 2))
    // 轮子：后面双轴，前面一轴。
    var wheelZ = width / 2 - 0.22
    ;[T.rear + 0.95, T.rear + 1.95, T.front - 0.9].forEach(function (x) {
      ;[-1, 1].forEach(function (side) { parts.push(wheel(materials, x, zc + side * wheelZ, 0.45, 0.32)) })
    })
    // 车下软影。
    var shadow = mesh(new THREE.PlaneGeometry(T.front - T.rear + 0.6, width + 0.6).rotateX(-Math.PI / 2), shadowMaterial, { name: 'Truck/shadow', castShadow: false, receiveShadow: false })
    shadow.position.set((T.front + T.rear) / 2, 0.004, zc)
    parts.push(shadow)
    // 车轮是绕 z 的圆柱（沿 x 摆的车），转一下。
    parts.filter(function (part) { return part.name === 'Wheel' }).forEach(function (part) { part.rotateY(Math.PI / 2) })
    return { group: group.apply(null, ['Truck'].concat(parts)), exhaust: stack.clone().setY(stack.y + 0.05) }
  }

  // ===== stationLights.ts =====
  // 加油站停车场的灯：罩棚下两盏朝下的冷白聚光（夜里整片加油区很亮；用聚光不用点光——卡通渐变的最暗一阶不是 0，
  // 点光会把罩棚顶面从下面“照亮”）、场地灯一盏聚光、旅馆立牌一盏霓虹色的点光、
  // 货车屏幕前一盏按屏幕字色的弱光（照到前排的车上）。地上的光斑用加色贴片（罩棚下一大块、场地灯下一圈）。

  /** constructor(blend, materials, lampHead, neonAt) */
  function StationLights(blend, materials, lampHead, neonAt) {
    this._blend = blend
    this.group = new THREE.Group()
    this.group.name = 'StationLights'
    this.levels = { canopy: 1, lamp: 1, neon: 1, screen: 1, pools: 1 }
    this.pools = []
    this.textures = []
    var self = this
    var point = function (intensity, distance, position, name) {
      var light = new THREE.PointLight(0xffffff, intensity, distance, 2)
      light.position.copy(position)
      light.name = name
      return light
    }
    this.canopy = [CANOPY.x0 + 1.3, CANOPY.x1 - 1.3].map(function (x, index) {
      var light = new THREE.SpotLight(0xffffff, 16, 9, 1.15, 0.7, 2)
      light.name = 'Lights/canopy' + index
      light.position.set(x, CANOPY.under - 0.06, (CANOPY.z0 + CANOPY.z1) / 2)
      light.target.position.set(x, 0, (CANOPY.z0 + CANOPY.z1) / 2 + 0.4)
      return light
    })
    this.lamp = new THREE.SpotLight(0xffffff, 24, 9, 0.9, 0.6, 2)
    this.lamp.name = 'Lights/lotLamp'
    this.lamp.position.copy(lampHead)
    this.lamp.target.position.set(lampHead.x - 0.4, 0, lampHead.z - 0.6)
    this.neon = point(3, 5, neonAt, 'Lights/motel')
    this.screen = point(2.4, 5.5, new THREE.Vector3(TRUCK_SCREEN.x, TRUCK_SCREEN.y - 0.4, TRUCK_SCREEN.z + 1.4), 'Lights/screen')

    var strip = Actors.createSoftEllipseTexture()
    this.textures.push(strip)
    var pool = function (key, level, source, size, at) {
      var material = materials.track(new THREE.MeshBasicMaterial({ color: 0xffffff, map: strip, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }))
      var geometry = new THREE.PlaneGeometry(size[0], size[1]).rotateX(-Math.PI / 2)
      var result = new THREE.Mesh(geometry, material)
      // 高过地上的白线（+6mm）和井盖一类的薄件：同高的话镜头一转就一道道地闪。
      result.position.set(at[0], at[1] + 0.016, at[2])
      result.renderOrder = 1
      result.name = 'Pool/' + source
      self.pools.push({ mesh: result, material: material, key: key, level: level, source: source })
      return result
    }
    var pools = [
      pool('canopyLight', 0.34, 'canopy', [CANOPY.x1 - CANOPY.x0 + 1.2, CANOPY.z1 - CANOPY.z0 + 1.4], [(CANOPY.x0 + CANOPY.x1) / 2, LEVEL.apron, (CANOPY.z0 + CANOPY.z1) / 2]),
      pool('streetLight', 0.5, 'lamp', [3.4, 3.4], [lampHead.x - 0.4, LEVEL.road, lampHead.z - 0.6]),
      pool('boardLit', 0.16, 'screen', [5.2, 2.6], [TRUCK_SCREEN.x, LEVEL.road, TRUCK_SCREEN.z + 1.5])
    ]
    var targets = this.canopy.map(function (light) { return light.target })
    this.group.add.apply(this.group, this.canopy.concat(targets).concat([this.lamp, this.lamp.target, this.neon, this.screen], pools))
    this.sync()
  }

  StationLights.prototype.setLevels = function (levels) {
    var previous = this.levels
    if (previous.canopy === levels.canopy && previous.lamp === levels.lamp && previous.neon === levels.neon && previous.screen === levels.screen && previous.pools === levels.pools) return
    this.levels = levels
    this.sync()
  }

  StationLights.prototype.sync = function () {
    var levels = this.levels
    var self = this
    this.canopy.forEach(function (light) {
      light.color.copy(self._blend.get('canopyLight'))
      light.intensity = 16 * levels.canopy
    })
    this.lamp.color.copy(this._blend.get('streetLight'))
    this.lamp.intensity = 24 * levels.lamp
    this.neon.color.copy(this._blend.get('neon'))
    this.neon.intensity = 3 * levels.neon
    this.screen.color.copy(this._blend.get('boardLit'))
    this.screen.intensity = 2.4 * levels.screen
    this.pools.forEach(function (pool) {
      pool.material.color.copy(self._blend.get(pool.key)).multiplyScalar(pool.level * levels[pool.source] * levels.pools)
    })
  }

  StationLights.prototype.dispose = function () {
    this.pools.forEach(function (pool) { pool.mesh.geometry.dispose() })
    this.textures.forEach(function (texture) { texture.dispose() })
  }

  // ===== stationSignPaint.ts =====
  // 加油站停车场各块招牌的 Canvas 2D 画法：罩棚的店招（主题图标 logo + 歌手当站名）、价格立柱（品牌色顶 + 三行七段数码管，
  // 数字是播放进度、总时长、第几句）、汽车旅馆立牌（竖排霓虹「MOTEL」、写曲名的横牌、VACANCY 小灯箱）。

  /** 罩棚前沿的店招：左边圆形 logo，中间站名，右边 SELF 小牌。paint: { font, name, icon?, fallbacks, base, text, brand } */
  var paintStationCanopy = function (canvas, paint) {
    var context = Raster.context2d(canvas)
    var width = canvas.width
    var height = canvas.height
    context.fillStyle = paint.base
    context.fillRect(0, 0, width, height)
    var badge = height * 0.86
    var badgeX = height * 0.2
    var badgeY = (height - badge) / 2
    context.fillStyle = paint.brand[0]
    context.beginPath()
    context.arc(badgeX + badge / 2, badgeY + badge / 2, badge / 2, 0, Math.PI * 2)
    context.fill()
    Raster.drawIcon(context, paint.icon, paint.fallbacks, badgeX + badge * 0.2, badgeY + badge * 0.2, badge * 0.6, '#ffffff', 2.4)
    var tagWidth = height * 1.7
    var textLeft = badgeX + badge + height * 0.3
    var textRight = width - tagWidth - height * 0.3
    context.textBaseline = 'middle'
    context.textAlign = 'left'
    context.fillStyle = paint.text
    Raster.fitFont(context, paint.font, paint.name, textRight - textLeft, height * 0.62)
    context.fillText(paint.name, textLeft, height * 0.53)
    context.fillStyle = paint.brand[2]
    context.beginPath()
    context.roundRect(width - tagWidth - height * 0.12, height * 0.16, tagWidth, height * 0.68, height * 0.12)
    context.fill()
    context.fillStyle = '#ffffff'
    context.textAlign = 'center'
    Raster.fitFont(context, Object.assign({}, paint.font, { weight: 800 }), 'SELF', tagWidth * 0.8, height * 0.46)
    context.fillText('SELF', width - tagWidth / 2 - height * 0.12, height * 0.53)
  }

  /** 七段数码管的段（a 上、b 右上、c 右下、d 下、e 左下、f 左上、g 中）。 */
  var SEGMENTS = {
    0: 'abcdef', 1: 'bc', 2: 'abdeg', 3: 'abcdg', 4: 'bcfg', 5: 'acdfg', 6: 'acdefg', 7: 'abc', 8: 'abcdefg', 9: 'abcdfg', '-': 'g', ' ': ''
  }

  /** 一个七段数字：亮的段用 on 色，暗的段用 off 色（像没点亮的灯管）。 */
  var drawSevenSegment = function (context, char, x, y, w, h, on, off) {
    var lit = SEGMENTS[char] || ''
    var t = w * 0.18
    var half = h / 2
    var segment = function (name, sx, sy, horizontal, length) {
      context.fillStyle = lit.indexOf(name) >= 0 ? on : off
      context.beginPath()
      if (horizontal) {
        context.moveTo(sx + t * 0.5, sy)
        context.lineTo(sx + t, sy - t * 0.5)
        context.lineTo(sx + length - t, sy - t * 0.5)
        context.lineTo(sx + length - t * 0.5, sy)
        context.lineTo(sx + length - t, sy + t * 0.5)
        context.lineTo(sx + t, sy + t * 0.5)
      } else {
        context.moveTo(sx, sy + t * 0.5)
        context.lineTo(sx + t * 0.5, sy + t)
        context.lineTo(sx + t * 0.5, sy + length - t)
        context.lineTo(sx, sy + length - t * 0.5)
        context.lineTo(sx - t * 0.5, sy + length - t)
        context.lineTo(sx - t * 0.5, sy + t)
      }
      context.closePath()
      context.fill()
    }
    segment('a', x, y + t * 0.5, true, w)
    segment('g', x, y + half, true, w)
    segment('d', x, y + h - t * 0.5, true, w)
    segment('f', x + t * 0.5, y, false, half)
    segment('e', x + t * 0.5, y + half, false, half)
    segment('b', x + w - t * 0.5, y, false, half)
    segment('c', x + w - t * 0.5, y + half, false, half)
  }

  /** 价格立柱：上面品牌色块里一个大图标与 SELF，下面三行：左边白字标签，右边七段数字。paint: { font, icon?, fallbacks, brand, rows, digit } */
  var paintStationPylon = function (canvas, paint) {
    var context = Raster.context2d(canvas)
    var width = canvas.width
    var height = canvas.height
    context.fillStyle = '#f4f2ec'
    context.fillRect(0, 0, width, height)
    var head = height * 0.34
    context.fillStyle = paint.brand[0]
    context.fillRect(0, 0, width, head)
    context.fillStyle = paint.brand[2]
    context.fillRect(0, head - height * 0.025, width, height * 0.025)
    var icon = head * 0.62
    Raster.drawIcon(context, paint.icon, paint.fallbacks, (width - icon) / 2, head * 0.08, icon, '#ffffff', 2.3)
    context.fillStyle = '#ffffff'
    context.textAlign = 'center'
    context.textBaseline = 'middle'
    Raster.fitFont(context, Object.assign({}, paint.font, { weight: 800 }), 'SELF', width * 0.8, head * 0.2)
    context.fillText('SELF', width / 2, head * 0.84)
    // 三行价格牌：深色底，标签在左上角一条小字，数字在它下面靠右。立柱很窄，标签和数字并排放会叠在一起。
    var rowTop = head + height * 0.03
    var rowHeight = (height - rowTop - height * 0.03) / paint.rows.length
    // 数字宽度按高度 1 量（数字之间留空，冒号窄一些），三行用同一个字高，取最宽那行放得下的大小。
    var span = function (value) {
      return value.split('').reduce(function (sum, char, index) {
        return sum + (char === ':' ? 0.26 : 0.52) + (index > 0 && char !== ':' && value[index - 1] !== ':' ? 0.1664 : 0)
      }, 0)
    }
    var widest = Math.max.apply(null, paint.rows.map(function (row) { return span(row.value) }).concat([1]))
    var panelTop = rowHeight * 0.06
    var panelHeight = rowHeight * 0.88
    var labelBand = panelHeight * 0.28
    var digitArea = panelHeight - labelBand - panelHeight * 0.06
    var digitH = Math.min(digitArea * 0.88, (width * 0.8) / widest)
    paint.rows.forEach(function (row, index) {
      var y = rowTop + index * rowHeight
      context.fillStyle = '#16191f'
      context.fillRect(width * 0.05, y + panelTop, width * 0.9, panelHeight)
      context.fillStyle = '#e8eaee'
      context.textAlign = 'left'
      Raster.fitFont(context, paint.font, row.label, width * 0.78, labelBand * 0.62)
      context.fillText(row.label, width * 0.1, y + panelTop + labelBand * 0.58)
      var chars = row.value.split('')
      var digitW = digitH * 0.52
      var gap = digitW * 0.32
      var colonW = digitW * 0.5
      var x = width * 0.9 - span(row.value) * digitH
      var dy = y + panelTop + labelBand + (digitArea - digitH) / 2
      chars.forEach(function (char, charIndex) {
        if (charIndex > 0 && char !== ':' && chars[charIndex - 1] !== ':') x += gap
        if (char === ':') {
          context.fillStyle = paint.digit
          var r = digitW * 0.09
          context.beginPath()
          context.arc(x + colonW * 0.5, dy + digitH * 0.32, r, 0, Math.PI * 2)
          context.arc(x + colonW * 0.5, dy + digitH * 0.72, r, 0, Math.PI * 2)
          context.fill()
          x += colonW
          return
        }
        drawSevenSegment(context, char, x, dy, digitW, digitH, paint.digit, 'rgba(255,255,255,0.05)')
        x += digitW
      })
    })
  }

  /** 立牌顶上的竖灯箱：「MOTEL」五个字母竖排，霓虹色。 */
  var paintMotelTall = function (canvas, font, neon) {
    var context = Raster.context2d(canvas)
    var width = canvas.width
    var height = canvas.height
    context.fillStyle = '#10161c'
    context.fillRect(0, 0, width, height)
    context.textAlign = 'center'
    context.textBaseline = 'middle'
    var letters = 'MOTEL'.split('')
    var step = height / (letters.length + 0.2)
    context.font = Raster.fontSpec(Object.assign({}, font, { weight: 800 }), Math.min(width * 0.72, step * 0.86))
    letters.forEach(function (letter, index) { Raster.strokeNeonText(context, letter, width / 2, step * (index + 0.6), neon, width * 0.08) })
  }

  /** 名字横牌：曲名（放不下就缩字），霓虹描边。 */
  var paintMotelName = function (canvas, font, title, neon) {
    var context = Raster.context2d(canvas)
    var width = canvas.width
    var height = canvas.height
    context.fillStyle = '#10161c'
    context.fillRect(0, 0, width, height)
    context.textAlign = 'center'
    context.textBaseline = 'middle'
    Raster.fitFont(context, font, title, width * 0.86, height * 0.62)
    Raster.strokeNeonText(context, title, width / 2, height * 0.54, neon, height * 0.1)
  }

  /** VACANCY 小灯箱：noLit 时前面的「NO」也亮（客满）。 */
  var paintMotelVacancy = function (canvas, font, noLit) {
    var context = Raster.context2d(canvas)
    var width = canvas.width
    var height = canvas.height
    context.fillStyle = '#10161c'
    context.fillRect(0, 0, width, height)
    context.textBaseline = 'middle'
    context.font = Raster.fontSpec(Object.assign({}, font, { weight: 800 }), height * 0.62)
    context.textAlign = 'left'
    if (noLit) Raster.strokeNeonText(context, 'NO', width * 0.05, height * 0.55, '#ff3b4a', height * 0.12)
    else {
      context.fillStyle = '#3a2328'
      context.fillText('NO', width * 0.05, height * 0.55)
    }
    context.textAlign = 'right'
    Raster.strokeNeonText(context, 'VACANCY', width * 0.95, height * 0.55, '#58f0a0', height * 0.12)
  }

  // ===== stationSigns.ts =====
  // 加油站停车场的招牌：アドトラック货厢侧面的 LED 屏（engine/lyricScreen.ts，当前行逐字点亮）、出租车顶灯
  // （engine/ledStrip.ts：一辆滚下一句 / 译文，一辆滚曲名与歌手）、罩棚店招（歌手当站名）、价格立柱（七段数码管：
  // 播放进度、总时长、第几句，每秒重画一次）、汽车旅馆立牌（霓虹 MOTEL、写曲名的横牌、VACANCY——副歌时 NO 亮起来，
  // 箭头上一圈走马灯泡）。颜色、图标、字体都从主题来。

  // 箭头走马灯泡的着色器：顶点里按时间算每个灯泡亮不亮（每四个一组，亮的那一位沿箭头往前走），片元只染那盏的颜色。
  var BULB_VERTEX = '\nattribute float aIndex;\nuniform float uTime;\nuniform float uCount;\nvarying float vOn;\n' +
    'void main() {\n' +
    '    float phase = fract((aIndex - uTime * 6.0) / 4.0);\n' +
    '    vOn = step(0.5, phase);\n' +
    '    gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(position, 1.0);\n' +
    '}\n'

  var BULB_FRAGMENT = '\nuniform vec3 uColor;\nuniform float uLevel;\nvarying float vOn;\n' +
    'void main() {\n' +
    '    gl_FragColor = vec4(uColor * mix(0.18, 1.9, vOn) * uLevel, 1.0);\n' +
    '    #include <tonemapping_fragment>\n' +
    '    #include <colorspace_fragment>\n' +
    '}\n'

  var canvasTexture = function (canvas, anisotropy) {
    anisotropy = anisotropy === undefined ? 4 : anisotropy
    var texture = new THREE.CanvasTexture(canvas)
    texture.colorSpace = THREE.SRGBColorSpace
    texture.anisotropy = anisotropy
    return texture
  }

  var placedPlane = function (material, placement, name) {
    var result = new THREE.Mesh(new THREE.PlaneGeometry(placement.width, placement.height), material)
    result.name = name
    result.position.copy(placement.position)
    result.rotation.y = placement.rotationY
    return result
  }

  var formatClock = function (seconds) {
    var total = Math.max(0, Math.floor(seconds))
    var minutes = Math.min(99, Math.floor(total / 60))
    return String(minutes).padStart(2, ' ') + ':' + String(total % 60).padStart(2, '0')
  }

  /**
   * constructor(materials, blend, placements)
   * placements: { screen, andons[{position,rotationY,width,height,role}], canopy[], pylon[], motel{tall,name,vacancy,bulbs} }
   */
  function StationSigns(materials, blend, placements) {
    this._blend = blend
    this.group = new THREE.Group()
    this.group.name = 'Signs'
    this.statics = []
    this.geometries = []
    this.content = null
    this.boardTarget = null
    this.lines = []
    this.pylonKey = ''
    this.full = false
    var self = this
    this.screen = new LyricScreen(materials, blend, placements.screen.width, placements.screen.height)
    this.group.add(this.screen.createFace(placements.screen.position, placements.screen.rotationY, 'Truck/screen'))
    this.tickers = placements.andons.map(function (andon, index) {
      var strip = new LedStrip(materials, blend, andon.width, andon.height, 10)
      self.group.add(strip.createFace(andon.position, andon.rotationY, 'Taxi' + index + '/andon'))
      return { strip: strip, role: andon.role }
    })

    this.canopy = this.staticSign(materials, 1024, Math.round(1024 * placements.canopy[0].height / placements.canopy[0].width), 0.82)
    placements.canopy.forEach(function (face, index) { self.group.add(placedPlane(self.canopy.material, face, 'Canopy/sign' + index)) })
    var pylonFace = placements.pylon[0]
    this.pylon = this.staticSign(materials, 360, Math.round(360 * pylonFace.height / pylonFace.width), 0.92)
    placements.pylon.forEach(function (face, index) { self.group.add(placedPlane(self.pylon.material, face, 'Pylon/face' + index)) })

    var motel = placements.motel
    var tall = motel.tall
    var namePlacement = motel.name
    var vacancy = motel.vacancy
    this.motelTall = this.staticSign(materials, 256, Math.round(256 * tall.height / tall.width), 1.15)
    this.group.add(placedPlane(this.motelTall.material, tall, 'Motel/tall'))
    this.motelName = this.staticSign(materials, 640, Math.round(640 * namePlacement.height / namePlacement.width), 1.1)
    this.group.add(placedPlane(this.motelName.material, namePlacement, 'Motel/name'))
    this.vacancy = this.staticSign(materials, 384, Math.round(384 * vacancy.height / vacancy.width), 1.1)
    this.group.add(placedPlane(this.vacancy.material, vacancy, 'Motel/vacancy'))
    var fullCanvas = Raster.createCanvas(this.vacancy.canvas.width, this.vacancy.canvas.height)
    this.vacancyFull = { canvas: fullCanvas, texture: canvasTexture(fullCanvas) }

    // 箭头上的走马灯泡：一个 InstancedMesh，亮哪一个在着色器里按时间算。
    var bulbGeometry = new THREE.SphereGeometry(0.04, 8, 6)
    this.geometries.push(bulbGeometry)
    var bulbs = placements.motel.bulbs
    var indices = new Float32Array(bulbs.length).map(function (_, index) { return index })
    bulbGeometry.setAttribute('aIndex', new THREE.InstancedBufferAttribute(indices, 1))
    this.bulbMaterial = materials.track(new THREE.ShaderMaterial({
      vertexShader: BULB_VERTEX,
      fragmentShader: BULB_FRAGMENT,
      uniforms: { uTime: { value: 0 }, uCount: { value: bulbs.length }, uColor: { value: new THREE.Color(1, 0.82, 0.48) }, uLevel: { value: 1 } }
    }))
    var bulbMesh = new THREE.InstancedMesh(bulbGeometry, this.bulbMaterial, bulbs.length)
    bulbMesh.name = 'Motel/bulbs'
    var matrix = new THREE.Matrix4()
    bulbs.forEach(function (bulb, index) {
      matrix.makeTranslation(bulb.x, bulb.y, bulb.z)
      bulbMesh.setMatrixAt(index, matrix)
    })
    bulbMesh.castShadow = false
    this.group.add(bulbMesh)
  }

  /** 一块定字面的招牌：canvas 画好贴图、材质按 level 调亮度。 */
  StationSigns.prototype.staticSign = function (materials, width, height, level) {
    var canvas = Raster.createCanvas(width, height)
    var texture = canvasTexture(canvas)
    var material = materials.track(new THREE.MeshBasicMaterial({ map: texture }))
    material.color.setScalar(level)
    var sign = { canvas: canvas, texture: texture, material: material, level: level }
    this.statics.push(sign)
    return sign
  }

  // 上游是私有 getter font：取当前主题的字体（setContent 之后才有效）。
  Object.defineProperty(StationSigns.prototype, 'font', {
    get: function () { return this.content.font }
  })

  /** 换歌 / 换主题：重画所有招牌。 */
  StationSigns.prototype.setContent = function (content) {
    this.content = content
    var palette = content.palette
    var font = content.font
    var song = content.song
    var fallbacks = content.fallbacks
    var icon = function (index) { return content.icons.length ? content.icons[index % content.icons.length] : fallbacks[index % fallbacks.length] }
    var title = song.title || song.album || 'MACHI'
    paintStationCanopy(this.canopy.canvas, {
      font: font,
      name: (song.artist || song.album || title).toUpperCase(),
      icon: icon(0),
      fallbacks: fallbacks,
      base: palette.signBase,
      text: palette.signText,
      brand: palette.brand
    })
    paintMotelTall(this.motelTall.canvas, font, palette.neon)
    paintMotelName(this.motelName.canvas, font, title, palette.brand[2])
    paintMotelVacancy(this.vacancy.canvas, font, false)
    paintMotelVacancy(this.vacancyFull.canvas, font, true)
    this.vacancyFull.texture.needsUpdate = true
    this.statics.forEach(function (sign) { sign.texture.needsUpdate = true })
    this.pylonKey = ''
    this.screen.setContent({
      palette: palette,
      font: font,
      measure: Raster.createMachiMeasure(font),
      matchers: WordColoring.prepareWordColorMatchers(content.theme.wordColors),
      cardTitle: '♪ ' + (song.title || 'MACHI'),
      cardSubtitle: song.artist || song.album || ''
    })
    this.tickers.forEach(function (ticker) { ticker.strip.invalidate() })
  }

  StationSigns.prototype.showBoard = function (target, lines, immediate, showText) {
    showText = showText === undefined ? true : showText
    this.lines = lines
    this.boardTarget = target
    this.screen.show(target, lines, immediate, showText)
    this.tickers.forEach(function (ticker) { if (ticker.role === 'ticker') ticker.strip.invalidate() })
  }

  StationSigns.prototype.preheat = function (target, lines, showText) {
    this.screen.preheat(target, lines, showText)
  }

  /** 价格立柱的三行：播放进度、总时长、第几句（变了才重画）。 */
  StationSigns.prototype.paintPylon = function (songTime, lineIndex) {
    var content = this.content
    var lines = content.song.lines
    var total = lines.length ? lines[lines.length - 1].endTime : 0
    var rows = [
      { label: 'レギュラー', value: formatClock(songTime) },
      { label: 'ハイオク', value: formatClock(total) },
      { label: '軽油', value: lineIndex >= 0 ? String(lineIndex + 1).padStart(3, ' ') : '---' }
    ]
    var key = rows.map(function (row) { return row.value }).join('|')
    if (key === this.pylonKey) return
    this.pylonKey = key
    var icons = content.icons
    paintStationPylon(this.pylon.canvas, {
      font: this.font,
      icon: icons.length ? icons[0] : content.fallbacks[0],
      fallbacks: content.fallbacks,
      brand: content.palette.brand,
      rows: rows,
      digit: '#ff5a3c'
    })
    this.pylon.texture.needsUpdate = true
  }

  StationSigns.prototype.update = function (frame) {
    var content = this.content
    if (!content) return
    this.screen.update(frame)
    // 上游读 screen.chorus（getter 转发内部的 chorusGlow）；移植版 MachiLyricScreen 直接暴露 chorusGlow 字段。
    var chorus = this.screen.chorusGlow
    var self = this
    this.tickers.forEach(function (ticker) {
      if (!ticker.strip.hasText && self.boardTarget) {
        var text = ticker.role === 'ticker'
          ? Director.resolveMachiTickerText(self.boardTarget, self.lines, content.song, 'MACHI')
          : '♪ ' + (content.song.title || 'MACHI') + (content.song.artist ? ' — ' + content.song.artist : '') + '   ◆   空車   ◆   '
        ticker.strip.setText(text, content.font)
      }
      ticker.strip.update({ delta: frame.delta, staticMode: frame.staticMode, speed: 0.8 + 0.4 * chorus, audio: frame.audio })
    })
    this.paintPylon(frame.songTime, frame.lineIndex)
    // 客满：副歌时 VACANCY 前面的 NO 亮起来。
    var full = chorus > 0.5
    if (full !== this.full) {
      this.full = full
      this.vacancy.material.map = full ? this.vacancyFull.texture : this.vacancy.texture
      this.vacancy.material.needsUpdate = true
    }
    // 霓虹随拍（智能动感模式）：旅馆的竖招牌、店名、空房灯分在三组轮流慢慢亮起；罩棚店招（第二组）与价格立柱（第三组）
    // 的灯箱只跟一小份。
    var beat = frame.beat
    var neon = (0.8 + 0.2 * frame.flicker) * (1 + 0.15 * chorus) * BeatFx.machiNeonGroup(beat, 0)
    this.motelTall.material.color.setScalar(this.motelTall.level * neon * frame.artificial)
    this.motelName.material.color.setScalar(this.motelName.level * frame.artificial * BeatFx.machiLightboxGroup(beat, 1))
    this.vacancy.material.color.setScalar(this.vacancy.level * frame.artificial * BeatFx.machiNeonGroup(beat, 2))
    this.canopy.material.color.setScalar(this.canopy.level * (0.7 + 0.3 * frame.artificial) * BeatFx.machiLightboxGroup(beat, 1))
    this.pylon.material.color.setScalar(this.pylon.level * (0.75 + 0.25 * frame.artificial) * BeatFx.machiLightboxGroup(beat, 2))
    this.bulbMaterial.uniforms.uTime.value = frame.staticMode ? 0 : frame.ambientTime
    this.bulbMaterial.uniforms.uLevel.value = frame.artificial
    this.bulbMaterial.uniforms.uColor.value.copy(this._blend.get('streetLight'))
  }

  Object.defineProperty(StationSigns.prototype, 'busy', {
    /** 屏幕上有换牌面动画：暂停时也要继续出帧。 */
    get: function () { return this.screen.busy }
  })

  StationSigns.prototype.dispose = function () {
    this.screen.dispose()
    this.tickers.forEach(function (ticker) { ticker.strip.dispose() })
    this.statics.forEach(function (sign) { sign.texture.dispose() })
    this.vacancyFull.texture.dispose()
    this.geometries.forEach(function (geometry) { geometry.dispose() })
    this.group.traverse(function (object) {
      if (object instanceof THREE.Mesh && object.name.match(/^(Canopy|Pylon|Motel)\//)) object.geometry.dispose()
    })
  }

  // ===== stationScene.ts =====
  // 场景装配与每帧推进。见文件头部注释。

  /** 车身颜色（白、银、黑、藏青、红、深绿、米色）。 */
  var CAR_COLORS = ['#e8eaee', '#aeb5bf', '#25292f', '#22385f', '#b8322e', '#2f5a48', '#d8cdb4']
  /** 出租车配色：车身与腰线 / 顶灯色。 */
  var TAXI_LIVERIES = [
    ['#f1c232', '#2b2f36'],
    ['#2a2d33', '#e8a23a'],
    ['#e9ecef', '#2f8a4f'],
    ['#2f6fb0', '#f1f1ec']
  ]

  var STATION_ART = {
    canopyFascia: '#f3f1eb',
    canopyTop: '#aeb4bc',
    canopyUnder: '#d4d7dd',
    canopyColumn: '#e5e3dd',
    canopyLight: '#eef4ff',
    pumpBody: '#ecebe6',
    truckBox: '#e9ecef',
    carGlass: '#1b2230',
    motelBack: '#1b333d',
    motelPole: '#bdb6a8',
    marker: '#ffae42'
  }

  /** 场景颜色表（resolveArt）：消费共用调色板 base 与 theme/seed 的纯函数。 */
  var resolveStationArt = function (_theme, seed, base) {
    var variation = resolveStationVariation(seed, CAR_COLORS.length, TAXI_LIVERIES.length)
    var livery = TAXI_LIVERIES[variation.taxiLivery]
    var out = Object.assign({}, STATION_ART)
    // 货车的车头用主题的副色，像一家运输公司的涂装。
    out.truckCab = PaletteMod.vivid(base.brand[2], 0.5, 0.38, 0.5)
    out.taxiBody = livery[0]
    out.taxiTrim = livery[1]
    out.car0 = CAR_COLORS[variation.carColors[0]]
    out.car1 = CAR_COLORS[variation.carColors[1]]
    out.car2 = CAR_COLORS[variation.carColors[2]]
    out.carPump = CAR_COLORS[variation.pumpColor]
    out.carKei = CAR_COLORS[(variation.keiColor + PaletteMod.seedIndex(seed, 'kei', 2)) % CAR_COLORS.length]
    return out
  }

  /** 自发光件：颜色键与亮度倍数（线性空间，> 1 才会被 bloom 轻轻带出光晕）。 */
  var STATION_GLOWS = {
    canopyLight: { key: 'canopyLight', level: 2.4 },
    pumpScreen: { key: 'led', level: 1.1 },
    marker: { key: 'marker', level: 1.8 },
    carHead: { key: 'streetLight', level: 2.2 },
    carTail: { key: 'stopRed', level: 1.6 },
    hazard: { key: 'marker', level: 2.4 },
    hazardIdle: { key: 'marker', level: 0.12 },
    vacant: { key: 'stopRed', level: 1.8 },
    lampHead: { key: 'streetLight', level: 3.2 },
    motelNeon: { key: 'neon', level: 1.6 }
  }

  /** 两条车道（靠左行驶）：近的往 +x，远的往 -x。两端伸出底座，车由裁切面从底座边缘“开出来”。 */
  var LANE_REACH = 8
  var STATION_LANES = [
    { from: [-LANE_REACH, ROAD.lanes[0]], to: [LANE_REACH, ROAD.lanes[0]] },
    { from: [LANE_REACH, ROAD.lanes[1]], to: [-LANE_REACH, ROAD.lanes[1]] }
  ]

  /** 双闪：每 18 秒一个窗口，按哈希决定这个窗口里那辆车打不打双闪（打的话闪 6 秒）。 */
  var hazardOn = function (time, seed) {
    var window = 18
    var index = Math.floor(time / window)
    var key = SeedHash.hashVisualizerSeed('hazard:' + seed)
    if (SeedHash.visualizerHash01(key, index, 0x21) > 0.5) return false
    var local = time - index * window - SeedHash.visualizerHash01(key, index, 0x42) * 10
    if (local < 0 || local > 6) return false
    return Math.floor(local * 2.8) % 2 === 0
  }

  /** 罩棚前沿、右沿的滴水。 */
  var stationDrips = function () {
    var drips = []
    for (var x = CANOPY.x0 + 0.2; x < CANOPY.x1; x += 0.45) {
      drips.push({ x: x + (Math.random() - 0.5) * 0.1, z: CANOPY.z1 + 0.06, from: CANOPY.under - 0.02, to: LEVEL.apron, period: 1.0 + Math.random() * 1.6, phase: Math.random() })
    }
    for (var z = CANOPY.z1; z > CANOPY.z0 + 0.3; z -= 0.5) {
      drips.push({ x: CANOPY.x1 + 0.06, z: z + (Math.random() - 0.5) * 0.1, from: CANOPY.under - 0.02, to: LEVEL.apron, period: 1.0 + Math.random() * 1.6, phase: Math.random() })
    }
    return drips
  }

  /**
   * constructor(context)
   * 场景对象：root / framing / weather / reflectionPlaneY / surfaces / puddles / focusPoint / busy / rebuildsForSeed，
   * 行为 setContent / swapSong / direct / syncColors / nextCar / dispose。
   */
  function StationScene(context) {
    this.context = context
    this.root = new THREE.Group()
    this.reflectionPlaneY = 0.04
    this.focusPoint = new THREE.Vector3(TRUCK_SCREEN.x, TRUCK_SCREEN.y, TRUCK_SCREEN.z)
    this.world = new THREE.Group()
    this.textures = []
    var materials = context.materials
    var blend = context.blend
    var geometryCache = context.geometryCache
    var variation = resolveStationVariation(context.song.seed, CAR_COLORS.length, TAXI_LIVERIES.length)
    this.variation = variation
    materials.defineGlows(STATION_GLOWS)
    this.root.name = 'Station'

    var shadowTexture = Actors.createSoftEllipseTexture()
    this.textures.push(shadowTexture)
    var shadow = materials.track(new THREE.MeshBasicMaterial({ color: 0x000000, alphaMap: shadowTexture, transparent: true, opacity: 0.5, depthWrite: false }))

    var built = withGeometryCache(geometryCache, function () {
      var ground = buildStationGround(materials)
      var canopy = buildCanopy(materials)
      var pylon = buildPylon(materials)
      var motel = buildMotelSign(materials)
      var lamp = buildLotLamp(materials)
      var truck = buildAdTruck(materials, shadow)
      // 前排车位：出租车车头朝 +z（顶灯朝镜头），轿车也一样停。
      var andons = []
      var cars = []
      variation.stalls.forEach(function (kind, index) {
        if (kind === 'empty') return
        var car = buildParkedCar(materials, kind, kind === 'taxi' ? 'taxiBody' : 'car' + index, 'Stall' + index, shadow, index === variation.hazardStall)
        car.group.position.set(STALLS.x[index], LEVEL.road, STALLS.z + 0.15)
        cars.push(car.group)
        if (car.andon) {
          andons.push({
            position: car.andon.position.clone().add(car.group.position),
            rotationY: 0,
            width: car.andon.width,
            height: car.andon.height,
            role: andons.length === 0 ? 'ticker' : 'credits'
          })
        }
      })
      if (variation.pumpCar) {
        var pumpCar = buildParkedCar(materials, 'sedan', 'carPump', 'PumpCar', shadow)
        pumpCar.group.position.set(PUMP_CAR.x, LEVEL.apron, PUMP_CAR.z)
        pumpCar.group.rotation.y = Math.PI / 2
        cars.push(pumpCar.group)
      }
      if (variation.keiTruck) {
        var keiTruck = buildParkedCar(materials, 'kei', 'carKei', 'KeiTruck', shadow)
        keiTruck.group.position.set(KEI_TRUCK.x, LEVEL.road, KEI_TRUCK.z)
        keiTruck.group.rotation.y = -Math.PI / 2
        cars.push(keiTruck.group)
      }
      return {
        ground: ground,
        canopy: canopy,
        pylon: pylon,
        motel: motel,
        lamp: lamp,
        truck: truck,
        andons: andons,
        cars: group.apply(null, ['Cars'].concat(cars)),
        islands: buildIslands(materials),
        props: buildStationProps(materials)
      }
    })
    var ground = built.ground
    var canopy = built.canopy
    var pylon = built.pylon
    var motel = built.motel
    var lamp = built.lamp
    var truck = built.truck
    var andons = built.andons
    this.world.name = 'Station/world'
    this.world.add(ground.group, canopy.group, built.islands, pylon.group, motel.group, lamp.group, truck.group, built.cars, built.props)
    // 亮的东西进倒影图层；罩棚和货厢也进：倒影镜头里它们是全黑的，正好当遮挡。
    this.world.traverse(function (object) {
      if (!(object instanceof THREE.Mesh) || Array.isArray(object.material)) return
      var isGlow = object.material.name.indexOf('machi:glow') === 0
      var isOccluder = !object.material.transparent && (object.name.indexOf('Canopy/') === 0 || object.name === 'Truck/box')
      if (isGlow || isOccluder) object.layers.enable(REFLECT_LAYER)
    })
    this.surfaces = { road: [ground.roadSurface], lot: ground.lotSurfaces }
    this.puddles = { offset: variation.puddleOffset, amount: variation.puddleAmount }
    bakeStatic(this.world)

    this.lights = new StationLights(blend, materials, lamp.head, motel.glow)
    this.signs = new StationSigns(materials, blend, {
      screen: { position: new THREE.Vector3(TRUCK_SCREEN.x, TRUCK_SCREEN.y, TRUCK_SCREEN.z), rotationY: 0, width: TRUCK_SCREEN.width, height: TRUCK_SCREEN.height },
      andons: andons,
      canopy: [canopy.signFront, canopy.signRight],
      pylon: pylon.faces,
      motel: { tall: motel.tall, name: motel.name, vacancy: motel.vacancy, bulbs: motel.bulbs }
    })
    this.signs.group.traverse(function (object) {
      if (object instanceof THREE.Mesh) object.layers.enable(REFLECT_LAYER)
    })

    var clipping = Actors.createBaseClippingPlanes(MACHI_BASE.half)
    this.traffic = withGeometryCache(geometryCache, function () { return new Actors.MachiTraffic(materials, blend, clipping, STATION_LANES, LEVEL.road) })
    // 加油区前沿三面旗：セルフ、洗車、灯油。
    this.nobori = new Actors.MachiNobori(materials, [1.45, 1.95, 2.45].map(function (x) {
      return { x: x, y: LEVEL.apron, z: 0.15, rotationY: 0.4 }
    }))
    this.lightCones = new Lights.MachiLightCones(materials, blend, [
      { apex: lamp.head, target: new THREE.Vector3(lamp.head.x - 0.4, LEVEL.road, lamp.head.z - 0.6), radius: 1.6, gain: 1 }
    ])
    this.steam = new Lights.MachiSteam(materials, blend, [
      { position: truck.exhaust, puffs: 5, period: 3.2, size: 0.55 },
      { position: new THREE.Vector3(-2.6, LEVEL.road + 0.02, (ROAD.lanes[0] + ROAD.lanes[1]) / 2 + 0.4), puffs: 6, period: 4.6, size: 0.9 }
    ])
    this.root.add(this.world, this.lights.group, this.signs.group, this.traffic.group, this.nobori.group, this.lightCones.mesh, this.steam.mesh)

    this.weather = {
      half: MACHI_BASE.half,
      groundY: LEVEL.apron * 0.5,
      roofs: [
        { x0: CANOPY.x0 - 0.05, z0: CANOPY.z0 - 0.05, x1: CANOPY.x1 + 0.05, z1: CANOPY.z1 + 0.05, y: CANOPY.top },
        { x0: TRUCK.rear, z0: TRUCK.z0, x1: TRUCK.boxFront, z1: TRUCK.z1, y: TRUCK.boxTop },
        { x0: TRUCK.cabBack, z0: TRUCK.z0, x1: TRUCK.front, z1: TRUCK.z1, y: TRUCK.cabTop }
      ],
      drips: stationDrips(),
      // 落进灯光里的雨丝被照亮：场地灯下、罩棚前、旅馆立牌旁。
      glints: [
        { position: new THREE.Vector3(lamp.head.x - 0.3, 2.4, lamp.head.z - 0.5), radius: 1.7 },
        { position: new THREE.Vector3((CANOPY.x0 + CANOPY.x1) / 2, 2.0, CANOPY.z1 + 0.6), radius: 2.2 },
        { position: motel.glow.clone(), radius: 1.6 }
      ],
      windYaw: variation.windYaw,
      windSlant: variation.windSlant
    }
    this.framing = { points: stationFramingPoints(), view: { azimuth: STATION_VIEW.azimuth, elevation: STATION_VIEW.elevation, zoom: STATION_VIEW.zoom } }
    // 雾里的两处灯：罩棚下、场地灯下。
    this.glowA = new THREE.Vector4((CANOPY.x0 + CANOPY.x1) / 2, 0, (CANOPY.z0 + CANOPY.z1) / 2 + 1, 3.6)
    this.glowB = new THREE.Vector4(lamp.head.x - 0.4, 0, lamp.head.z - 0.6, 2.3)
    this.syncColors()
    context.invalidateShadows()
  }

  /** 换歌 / 换主题：重画招牌、重画旗。 */
  StationScene.prototype.setContent = function (content) {
    this.signs.setContent(content)
    var palette = content.palette
    this.nobori.paint({
      font: content.font,
      fallbacks: content.fallbacks,
      faces: [
        { background: palette.brand[0], ink: '#ffffff', text: 'セルフ' },
        { background: palette.brand[2], ink: '#ffffff', text: '洗車', icon: content.icons[0] },
        { background: palette.brand[1], ink: palette.signText, text: '灯油' }
      ]
    })
  }

  /** 换歌（seed 不变）：只重画招牌；seed 变了运行时会重建整个场景（rebuildsForSeed）。 */
  StationScene.prototype.swapSong = function (_song, content) {
    this.setContent(content)
  }

  /** 每帧推进：牌面、灯、车、旗、白气、光柱、价格立柱、走马灯泡。 */
  StationScene.prototype.direct = function (frame) {
    var songTime = frame.songTime
    var ambientTime = frame.ambientTime
    var chorus = frame.chorus
    var staticMode = frame.staticMode
    var environment = frame.environment
    var look = frame.look
    if (frame.targetChanged) this.signs.showBoard(frame.target, frame.lines, frame.immediate, frame.showText)
    else if (frame.preheat) this.signs.preheat(frame.preheat, frame.lines, frame.showText)
    var flicker = staticMode ? 1 : Director.resolveMachiFlicker(ambientTime + 1.7, frame.seed + ':canopy', 0.4)
    var lampFlicker = staticMode ? 1 : Director.resolveMachiFlicker(ambientTime + 4.2, frame.seed + ':lamp', 0.45)
    var lamp = look.streetLamps * (0.75 + 0.25 * lampFlicker)
    // 霓虹随拍（智能动感模式）：罩棚的灯（连同它投在地上的光斑）跟着小节慢慢涨落；旅馆的霓虹灯管是第三组，照到四周的
    // 霓虹光跟三组的平均；地面干时光斑跟鼓点跳。
    var beat = frame.beat
    var canopyLevel = (0.85 + 0.15 * flicker) * (1 + 0.08 * chorus) * look.artificial * beat.warm
    var motelNeon = look.artificial * (0.8 + 0.2 * frame.flicker)
    this.lights.setLevels({
      canopy: canopyLevel,
      lamp: lamp,
      neon: motelNeon * beat.neon,
      screen: (1 - 0.8 * environment.daylight) * (1 + 0.2 * chorus),
      pools: (1 - 0.85 * environment.daylight) * (1 + beat.thump)
    })
    var materials = this.context.materials
    materials.setGlowLevel('canopyLight', 0.4 + 0.6 * canopyLevel)
    materials.setGlowLevel('lampHead', 0.15 + 0.85 * look.streetLamps)
    materials.setGlowLevel('motelNeon', motelNeon * BeatFx.machiNeonGroup(beat, 2))
    materials.setGlowLevel('marker', 0.5 + 0.5 * look.artificial)
    // 停着的车白天不开灯，夜里出租车的灯亮着（等客）。
    materials.setGlowLevel('carHead', 0.12 + 0.88 * (1 - environment.daylight))
    materials.setGlowLevel('carTail', 0.3 + 0.7 * (1 - environment.daylight))
    materials.setGlowLevel('hazard', !staticMode && this.variation.hazardStall >= 0 && hazardOn(ambientTime, frame.seed) ? 1 : 0.06)
    // 会动的东西：车按氛围时钟，旗随风飘，排气与井盖的白气、场地灯的光柱慢慢流。静态模式下路上没有车。
    this.traffic.group.visible = !staticMode
    this.traffic.update(ambientTime, frame.seed, frame.trafficChance)
    this.nobori.update(ambientTime, 0.35 + 0.65 * Math.min(1, frame.rain))
    this.lightCones.update(ambientTime, lamp * (1 - 0.6 * environment.daylight))
    this.steam.update(ambientTime, frame.atmosphere.wind)
    var night = 1 - 0.85 * environment.daylight
    var atmosphere = frame.atmosphere
    atmosphere.glowA.copy(this.glowA)
    atmosphere.glowB.copy(this.glowB)
    atmosphere.glowColorA.copy(this.context.blend.get('canopyLight')).multiplyScalar(0.5 * canopyLevel * night)
    atmosphere.glowColorB.copy(this.context.blend.get('streetLight')).multiplyScalar(0.42 * lamp * night)
    this.signs.update({
      songTime: songTime,
      ambientTime: ambientTime,
      delta: frame.delta,
      staticMode: staticMode,
      chorus: chorus,
      audio: frame.audio,
      flicker: frame.flicker,
      artificial: look.artificial,
      lineIndex: frame.target.kind === 'line' ? frame.target.index : -1,
      beat: beat
    })
  }

  /** 插值后的颜色写回材质、灯、车、光柱、白气。 */
  StationScene.prototype.syncColors = function () {
    this.context.materials.syncColors()
    this.lights.sync()
    this.traffic.syncColors()
    this.lightCones.syncColors()
    this.steam.syncColors()
  }

  Object.defineProperty(StationScene.prototype, 'busy', {
    /** 屏幕上有换牌面动画：暂停时也要继续出帧。 */
    get: function () { return this.signs.busy }
  })

  Object.defineProperty(StationScene.prototype, 'rebuildsForSeed', {
    /** 换歌 seed 变了整个场景重建（车位、车色都跟着 seed 走）。 */
    get: function () { return true }
  })

  /** 调试钩子用：从氛围时间 from 往后找下一辆开到路中间的车。 */
  StationScene.prototype.nextCar = function (from, seed, chance) {
    for (var t = from; t < from + 120; t += 0.04) {
      var car = Actors.resolveMachiCar(t, seed, STATION_LANES, chance)
      if (car && Math.abs(car.distance - LANE_REACH) < 0.3) return t
    }
    return null
  }

  StationScene.prototype.dispose = function () {
    var geometries = new Set(this.context.geometryCache.values())
    this.root.traverse(function (object) {
      if (object instanceof THREE.Mesh || object instanceof THREE.LineSegments || object instanceof THREE.Points) geometries.add(object.geometry)
    })
    geometries.forEach(function (geometry) { geometry.dispose() })
    this.lights.dispose()
    this.signs.dispose()
    this.traffic.dispose()
    this.nobori.dispose()
    this.lightCones.dispose()
    this.steam.dispose()
    this.textures.forEach(function (texture) { texture.dispose() })
    this.context.materials.dispose()
    this.root.removeFromParent()
  }

  /** 场景定义：resolveArt（场景自己的颜色表）+ create（装配整个场景）。 */
  var STATION_SCENE = {
    resolveArt: resolveStationArt,
    create: function (context) { return new StationScene(context) }
  }

  // ===== 导出 =====
  // 该目录全部顶层导出（名字保持上游原名；上游的 interface / type 导出已按 TS→JS 规则删除）。
  var exports = {
    // layout.ts
    DEG: DEG,
    LEVEL: LEVEL,
    ROAD: ROAD,
    CANOPY: CANOPY,
    ISLANDS: ISLANDS,
    APRON: APRON,
    TRUCK: TRUCK,
    TRUCK_SCREEN: TRUCK_SCREEN,
    STALLS: STALLS,
    CAR: CAR,
    PUMP_CAR: PUMP_CAR,
    KEI_TRUCK: KEI_TRUCK,
    APRON_PROPS: APRON_PROPS,
    PYLON: PYLON,
    MOTEL_SIGN: MOTEL_SIGN,
    LOT_LAMP: LOT_LAMP,
    STATION_VIEW: STATION_VIEW,
    // stationSeed.ts
    resolveStationVariation: resolveStationVariation,
    // structures.ts
    buildStationGround: buildStationGround,
    buildCanopy: buildCanopy,
    buildIslands: buildIslands,
    buildPylon: buildPylon,
    buildMotelSign: buildMotelSign,
    buildLotLamp: buildLotLamp,
    buildStationProps: buildStationProps,
    stationFramingPoints: stationFramingPoints,
    // stationSignPaint.ts
    paintStationCanopy: paintStationCanopy,
    paintStationPylon: paintStationPylon,
    paintMotelTall: paintMotelTall,
    paintMotelName: paintMotelName,
    paintMotelVacancy: paintMotelVacancy,
    // stationSigns.ts
    StationSigns: StationSigns,
    // vehicles.ts
    buildParkedCar: buildParkedCar,
    buildAdTruck: buildAdTruck,
    // stationLights.ts
    StationLights: StationLights,
    // stationScene.ts
    STATION_SCENE: STATION_SCENE
  }

  window.FoliaMachiSceneStation = exports
})()
