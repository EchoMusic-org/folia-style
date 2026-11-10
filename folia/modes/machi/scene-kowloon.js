// 城寨酒吧（香港九龙城寨，赛博朋克）场景（移植自 folia-major scenes/kowloon/ 的
// layout.ts + street.ts + blocks.ts + bar.ts + kowloonLights.ts + kowloonScene.ts，场景主文件）：
// 左边、后排是高低错落的城寨楼（铁窗笼、冷气机、晾衫竹、加建小间，楼顶的水箱、天线、锅盖），后排正中一楼是
// 酒吧（门头霓虹写曲名），楼面上挂着歌词大屏（当前行逐字点亮）与屏幕下沿的跑马灯（译文 / 曲名）；左边楼面
// 伸出一串霓虹店招悬在巷子上空（一块竖灯箱写歌手），巷子里一台全息投影写下一句；右前是大排档和电线杆。
// 会动的：坏灯管闪、日光灯管闪、点唱机随音乐明暗、全息的扫描线、镬气与沙井的白气。夜里霓虹的粉、青映在湿地上。
// 招牌画法与屏幕在 scene-kowloon-paint.js（先于本文件加载）。
(function () {
  'use strict'

  var THREE = window.THREE
  var Geometry = window.FoliaMachiGeometry
  var SeedHash = window.FoliaSeedHash
  var ColorMath = window.FoliaThemeColorMath
  var PaletteMod = window.FoliaMachiPalette
  var BeatFx = window.FoliaMachiBeatFx
  var Director = window.FoliaMachiDirector
  var Lights = window.FoliaMachiLights
  var Reflection = window.FoliaMachiReflection
  var Actors = window.FoliaMachiActors
  var Paint = window.FoliaMachiSceneKowloonPaint

  var MACHI_REFLECT_LAYER = Reflection.MACHI_REFLECT_LAYER
  var group = Geometry.group
  var mesh = Geometry.mesh
  var roundedBox = Geometry.roundedBox
  var boxAt = Geometry.boxAt
  var boxSpan = Geometry.boxSpan
  var cylinderAt = Geometry.cylinderAt
  var tubeBetween = Geometry.tubeBetween
  var sagWire = Geometry.sagWire
  var bakeStatic = Geometry.bakeStatic
  var withGeometryCache = Geometry.withGeometryCache
  var buildMachiPlinth = Geometry.buildMachiPlinth
  var machiSurface = Geometry.machiSurface
  var MACHI_BASE = Geometry.MACHI_BASE

  // ===== layout.ts =====
  // 城寨酒吧的尺寸表（米，原点在底座中心，y 向上，+z 是前、+x 是右）。左边一排、后排一排高低错落的城寨楼（L 形），
  // 前右是一条湿巷子；后排正中一楼是酒吧，楼面上挂着歌词大屏；左边楼面伸出一串霓虹招牌，悬在巷子上空。
  // 默认镜头从前右看过来，离镜头最远的是后左角：那里的楼投到画面里最高，所以后左角不比别处高多少。
  // 高的东西都在左边和后排，前右只有矮的大排档和电线杆，挡不到酒吧和大屏。

  var DEG = Math.PI / 180

  /** 巷子地面、酒吧地板。 */
  var LEVEL = {
    ground: 0.02,
    floor: 0.06
  }

  /** 楼层：一楼是铺面，往上每层 1m（微缩里压扁一点，楼才显得密）。 */
  var FLOORS = {
    ground: 3.0,
    height: 1.0
  }

  /**
   * 楼：左边一排（L0–L5，一栋栋窄楼，进深与高低都错开，越往前越矮），后排一排（B0–B2，B1 是酒吧和大屏）。
   * wall 是外墙的颜色键；hollow 是一楼掏空的一块（酒吧）：x0..x1、从后面 z0 到楼的前面、高到 y1。
   */
  var BLOCKS = [
    { name: 'L0', x0: -6, x1: -3.0, z0: -6, z1: -1.8, height: 6.9, wall: 'wallA' },
    { name: 'L1', x0: -6, x1: -3.35, z0: -1.8, z1: -0.2, height: 7.3, wall: 'wallB' },
    { name: 'L2', x0: -6, x1: -3.6, z0: -0.2, z1: 1.3, height: 6.6, wall: 'wallD' },
    { name: 'L3', x0: -6, x1: -3.2, z0: 1.3, z1: 2.9, height: 6.2, wall: 'wallC' },
    { name: 'L4', x0: -6, x1: -3.45, z0: 2.9, z1: 4.5, height: 5.2, wall: 'wallE' },
    { name: 'L5', x0: -6, x1: -3.75, z0: 4.5, z1: 6, height: 4.0, wall: 'wallD' },
    { name: 'B0', x0: -3.0, x1: -1.6, z0: -6, z1: -1.8, height: 6.4, wall: 'wallE' },
    { name: 'B0b', x0: -1.6, x1: -0.3, z0: -6, z1: -2.05, height: 7.0, wall: 'wallC' },
    { name: 'B1', x0: -0.3, x1: 4.5, z0: -6, z1: -1.5, height: 6.2, wall: 'wallA', hollow: { x0: -0.1, x1: 4.3, z0: -4.2, y1: 2.95 } },
    { name: 'B2', x0: 4.5, x1: 6, z0: -6, z1: -2.3, height: 5.4, wall: 'wallB' }
  ]

  /** 左排楼在 z 处的楼面（x）。 */
  function leftFaceAt(z) {
    var block = null
    for (var i = 0; i < BLOCKS.length; i += 1) {
      var candidate = BLOCKS[i]
      if (candidate.name.charAt(0) === 'L' && z >= candidate.z0 && z < candidate.z1) { block = candidate; break }
    }
    return block ? block.x1 : -3.4
  }

  /** 酒吧：B1 的一楼，玻璃门面略往里收，右边一扇门。 */
  var BAR = {
    x0: -0.1,
    x1: 4.3,
    front: -1.5,
    glass: -1.62,
    back: -4.2,
    ceiling: 2.95,
    door: [3.3, 4.2],
    counter: { x0: 0.2, x1: 3.0, z0: -3.4, z1: -2.85, height: 1.05 }
  }

  /** 酒吧门头的霓虹店招（曲名）、屏幕下沿的 LED 跑马灯、歌词大屏（面的中心与尺寸，朝 +z）。 */
  var BAR_SIGN = { x: 2.1, y: 2.68, z: -1.38, width: 3.9, height: 0.46 }
  var TICKER = { x: 2.1, y: 3.09, z: -1.41, width: 4.2, height: 0.17 }
  var SCREEN = { x: 2.1, y: 4.22, z: -1.38, width: 4.2, height: 1.8 }

  /**
   * 伸出楼面的招牌：从墙面（wall）伸到 tip，底 y0、顶 y1，板面中心在 z（左排楼伸出来的朝 +z），
   * 或在 x（后排楼伸出来的朝 +x）。竖的写竖排字。role 是写什么：artist 写歌手，其余是店名。
   */
  var HANGING_SIGNS = [
    { axis: 'x', wall: -3.45, tip: -2.65, y0: 2.95, y1: 4.75, at: 3.65, vertical: true, role: 'artist' },
    { axis: 'x', wall: -3.6, tip: -1.35, y0: 5.15, y1: 5.95, at: 0.55, vertical: false, role: 'shop' },
    { axis: 'x', wall: -3.35, tip: -2.67, y0: 3.3, y1: 5.5, at: -0.85, vertical: true, role: 'shop' },
    { axis: 'x', wall: -3.2, tip: -1.45, y0: 3.45, y1: 4.2, at: 2.25, vertical: false, role: 'shop' },
    { axis: 'x', wall: -3.2, tip: -1.95, y0: 4.45, y1: 5.05, at: 1.5, vertical: false, role: 'shop' },
    { axis: 'x', wall: -3.75, tip: -3.1, y0: 2.6, y1: 3.75, at: 5.25, vertical: true, role: 'shop' },
    { axis: 'z', wall: -2.05, tip: -1.3, y0: 3.4, y1: 5.7, at: -0.72, vertical: true, role: 'shop' },
    { axis: 'z', wall: -1.8, tip: -1.25, y0: 4.0, y1: 5.5, at: -2.2, vertical: true, role: 'shop' }
  ]

  /** 招牌的板厚。 */
  var SIGN_DEPTH = 0.16

  /** B1 楼顶的大霓虹广告架（「九龍城寨」），在歌词屏正上方。 */
  var ROOF_BILLBOARD = { x0: -0.05, x1: 2.45, z: -2.15, y0: 6.6, y1: 7.5 }

  /** 全息投影：巷子里一台地上的投影机，往上投一块转向镜头的面板（下一句）。 */
  var HOLOGRAM = { x: 0.9, z: 2.3, y: 3.0, width: 3.0, height: 1.1, rotationY: 30 * DEG }

  /** 大排档：右前一个绿铁皮档口（柜台朝 +z），前面一张折台与几张塑料凳。 */
  var STALL = { x0: 4.1, x1: 5.85, z0: 1.3, z1: 2.25, counter: 1.0, back: 2.1, canopy: 2.35 }
  var STALL_TABLE = { x: 4.85, z: 3.25 }

  /** 电线杆：B2 门前，顶上横担拉出一把电线，伸一盏街灯照巷子。 */
  var POLE = { x: 5.55, z: -1.15, height: 7.0, lampArm: 1.25, lampY: 5.05 }

  /** 贩卖机：B2 门前。 */
  var VENDING = { x: 4.95, z: -1.95 }

  /** 默认视角：从前右斜俯视。 */
  var KOWLOON_VIEW = {
    azimuth: 30 * DEG,
    elevation: 30 * DEG,
    zoom: 1.55
  }

  // ===== street.ts =====
  // 城寨酒吧的巷子：底座与地面（一整片湿地面，沿左排楼脚一道明渠、一个冒白气的沙井盖）、各家铺面（卷闸、冰室、
  // 楼梯口、半开的卷闸透出暖光、通往深处的暗巷口与一根日光灯管）、伸出楼面的招牌箱与拉杆、B0 楼顶的广告架、
  // 右前的大排档（绿铁皮档口、红白条帆布篷、一颗灯泡、镬与汤锅、折台与塑料凳）、电线杆（横担、变压器、街灯）、
  // 横七竖八的电线、贩卖机、全息投影机的底座，以及几样杂物。招牌的字面另挂（kowloonSigns），这里只给位置。

  function v(x, y, z) { return new THREE.Vector3(x, y, z) }

  /** 按名字找楼。 */
  function blockOf(name) {
    return BLOCKS.find(function (block) { return block.name === name })
  }

  /** 伸出楼面的招牌占的盒子（含一点余量）。 */
  function hangingSignBox(sign, margin) {
    margin = margin === undefined ? 0 : margin
    var a = Math.min(sign.wall, sign.tip)
    var b = Math.max(sign.wall, sign.tip)
    var half = SIGN_DEPTH / 2 + margin
    return sign.axis === 'x'
      ? new THREE.Box3(v(a - margin, sign.y0 - margin, sign.at - half), v(b + margin, sign.y1 + margin, sign.at + half))
      : new THREE.Box3(v(sign.at - half, sign.y0 - margin, a - margin), v(sign.at + half, sign.y1 + margin, b + margin))
  }

  /** 不铺窗的地方：歌词屏（含外框）、楼顶广告架。 */
  function kowloonWindowAvoid() {
    return [
      new THREE.Box3(v(SCREEN.x - SCREEN.width / 2 - 0.25, SCREEN.y - SCREEN.height / 2 - 0.25, -1.9), v(SCREEN.x + SCREEN.width / 2 + 0.25, SCREEN.y + SCREEN.height / 2 + 0.1, -1.0)),
      new THREE.Box3(v(ROOF_BILLBOARD.x0 - 0.3, ROOF_BILLBOARD.y0 - 0.5, ROOF_BILLBOARD.z - 0.6), v(ROOF_BILLBOARD.x1 + 0.3, ROOF_BILLBOARD.y1 + 0.3, ROOF_BILLBOARD.z + 0.6))
    ]
  }

  /** 歌词屏前面与上沿一层：楼面上伸出去的冷气机、晾衫竹不放这里，免得挡字。 */
  function kowloonScreenFront() {
    return new THREE.Box3(
      v(SCREEN.x - SCREEN.width / 2 - 0.4, SCREEN.y - SCREEN.height / 2 - 0.3, SCREEN.z - 0.2),
      v(SCREEN.x + SCREEN.width / 2 + 0.4, SCREEN.y + SCREEN.height / 2 + 1.2, SCREEN.z + 1.6)
    )
  }

  /** 底座、地面、明渠、沙井盖。 */
  function buildGround(materials) {
    var h = MACHI_BASE.half
    var surface = machiSurface(materials.toon('concrete'), -h, h, -h, h, LEVEL.ground, 'Surface/alley')
    var surfaces = group('Base/Surfaces', surface)
    surfaces.userData.dynamic = true
    var drain = materials.toon('drain')
    var curb = materials.toon('curb')
    var parts = []
    // 明渠：沿左排楼脚，楼面在哪就跟到哪；外沿一道矮路缘。
    BLOCKS.filter(function (block) { return block.name.charAt(0) === 'L' }).forEach(function (block) {
      var z0 = Math.max(block.z0, -1.8)
      if (block.z1 <= z0) return
      parts.push(boxSpan(drain, block.x1, block.x1 + 0.22, 0, LEVEL.ground + 0.004, z0, block.z1, { radius: 0, name: 'Drain' }))
      parts.push(boxSpan(curb, block.x1 + 0.22, block.x1 + 0.28, 0, LEVEL.ground + 0.05, z0, block.z1, { radius: 0.01, name: 'Curb' }))
    })
    var manhole = mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.02, 20), materials.toon('darkMetal'), { name: 'Manhole', castShadow: false })
    manhole.position.set(1.6, LEVEL.ground + 0.01, 4.1)
    parts.push(manhole)
    return { base: group('Base', buildMachiPlinth(materials), group.apply(null, ['Base/Alley'].concat(parts)), surfaces), surface: surface, manhole: manhole.position.clone() }
  }

  /** 各家铺面：贴在楼面上的卷闸、玻璃、灯箱。 */
  function buildShopfronts(materials) {
    var shutter = materials.toon('shutter')
    var shutterDark = materials.toon('shutterDark')
    var frame = materials.toon('windowFrame')
    var dark = materials.toon('windowDark')
    var parts = []
    var face = function (name) {
      var block = blockOf(name)
      return name.charAt(0) === 'L' ? block.x1 : block.z1
    }
    /** 一道卷闸（沿 x，贴在 z 的墙面上）：横条纹、顶上的卷轴箱；open 是卷起来的高度。 */
    var shutterX = function (x0, x1, z, top, open) {
      open = open === undefined ? 0 : open
      parts.push(boxSpan(shutterDark, x0 - 0.05, x1 + 0.05, top, top + 0.28, z, z + 0.2, { radius: 0.02, name: 'ShutterBox' }))
      for (var y = open; y < top - 0.05; y += 0.16) {
        parts.push(boxSpan(y % 0.32 < 0.16 ? shutter : shutterDark, x0, x1, y, Math.min(top, y + 0.15), z, z + 0.04, { radius: 0, name: 'Shutter' }))
      }
    }
    /** 同上，贴在 x 的墙面上（左排楼），沿 z。 */
    var shutterZ = function (z0, z1, x, top, open) {
      open = open === undefined ? 0 : open
      parts.push(boxSpan(shutterDark, x, x + 0.2, top, top + 0.28, z0 - 0.05, z1 + 0.05, { radius: 0.02, name: 'ShutterBox' }))
      for (var y = open; y < top - 0.05; y += 0.16) {
        parts.push(boxSpan(y % 0.32 < 0.16 ? shutter : shutterDark, x, x + 0.04, y, Math.min(top, y + 0.15), z0, z1, { radius: 0, name: 'Shutter' }))
      }
    }
    /** 左排楼面上一个暗门洞（带门框）。 */
    var doorZ = function (z0, z1, x, top) {
      top = top === undefined ? 2.3 : top
      parts.push(boxSpan(dark, x, x + 0.03, 0, top, z0, z1, { radius: 0, name: 'Door' }))
      parts.push(boxSpan(frame, x, x + 0.08, 0, top + 0.1, z0 - 0.07, z0, { radius: 0.01, name: 'Jamb' }))
      parts.push(boxSpan(frame, x, x + 0.08, 0, top + 0.1, z1, z1 + 0.07, { radius: 0.01, name: 'Jamb' }))
      parts.push(boxSpan(frame, x, x + 0.08, top, top + 0.12, z0 - 0.07, z1 + 0.07, { radius: 0.01, name: 'Jamb' }))
    }
    /** 左排楼面上一扇亮着的橱窗：发光的店里、竖框、踢脚。 */
    var windowZ = function (z0, z1, x, glow) {
      parts.push(boxSpan(materials.glow(glow), x, x + 0.02, 0.45, 2.3, z0, z1, { radius: 0, name: 'ShopGlow' }))
      var count = Math.max(1, Math.round((z1 - z0) / 0.65))
      for (var index = 0; index <= count; index += 1) {
        var z = z0 + ((z1 - z0) * index) / count
        parts.push(boxSpan(frame, x, x + 0.07, 0.45, 2.3, z - 0.03, z + 0.03, { radius: 0.01, name: 'Mullion' }))
      }
      parts.push(boxSpan(frame, x, x + 0.08, 0, 0.45, z0 - 0.03, z1 + 0.03, { radius: 0.01, name: 'Kick' }))
      parts.push(boxSpan(frame, x, x + 0.08, 2.3, 2.42, z0 - 0.03, z1 + 0.03, { radius: 0.01, name: 'Head' }))
    }
    // B0：一道落了的卷闸。B0b（往里收一点）：一间亮着的冰室（暖光、竖框、两张卡座的剪影）。
    shutterX(-2.9, -1.7, face('B0'), 2.45)
    var cafe = face('B0b')
    parts.push(boxSpan(materials.glow('cafe'), -1.5, -0.42, 0.4, 2.4, cafe, cafe + 0.02, { radius: 0, name: 'ShopGlow' }))
    parts.push(boxSpan(frame, -1.56, -0.36, 0, 0.4, cafe, cafe + 0.08, { radius: 0.01, name: 'Kick' }))
    parts.push(boxSpan(frame, -1.56, -0.36, 2.4, 2.55, cafe, cafe + 0.08, { radius: 0.01, name: 'Head' }))
    ;[-1.53, -0.96, -0.39].forEach(function (x) {
      parts.push(boxSpan(frame, x - 0.03, x + 0.03, 0.4, 2.4, cafe, cafe + 0.07, { radius: 0.01, name: 'Mullion' }))
    })
    parts.push(boxSpan(dark, -1.42, -1.04, 0.4, 0.95, cafe + 0.02, cafe + 0.035, { radius: 0, name: 'Booth' }))
    parts.push(boxSpan(dark, -0.88, -0.5, 0.4, 0.95, cafe + 0.02, cafe + 0.035, { radius: 0, name: 'Booth' }))
    // L1：楼梯口与信箱。L2：亮着的药房。L3：卷闸半开，底下透出暖光。L4：暗门与一扇小面档的窗。L5：暗门。
    var l1 = face('L1')
    doorZ(-1.55, -0.85, l1)
    parts.push(boxSpan(materials.toon('rust'), l1, l1 + 0.1, 1.1, 1.6, -0.65, -0.32, { radius: 0.01, name: 'Mailbox' }))
    windowZ(0.0, 1.15, face('L2'), 'pharmacy')
    var l3 = face('L3')
    parts.push(boxSpan(materials.glow('shopWarm'), l3, l3 + 0.02, 0.02, 0.95, 1.45, 2.75, { radius: 0, name: 'ShopGlow' }))
    shutterZ(1.45, 2.75, l3, 2.5, 0.95)
    var l4 = face('L4')
    doorZ(3.05, 3.7, l4)
    windowZ(3.9, 4.4, l4, 'shopGlow')
    doorZ(4.8, 5.5, face('L5'), 2.2)
    // B2：通往城寨深处的暗巷口，门洞上一根日光灯管。
    var b2 = face('B2')
    parts.push(boxSpan(dark, 5.3, 5.95, 0, 2.4, b2, b2 + 0.03, { radius: 0, name: 'Passage' }))
    parts.push(boxSpan(frame, 5.22, 5.3, 0, 2.5, b2, b2 + 0.08, { radius: 0.01, name: 'Jamb' }))
    parts.push(boxSpan(materials.glow('tube'), 5.35, 5.9, 2.55, 2.59, b2, b2 + 0.06, { radius: 0.01, name: 'Tube' }))
    // 楼脚一道道电线、电表箱。
    var wire = materials.toon('wire')
    BLOCKS.filter(function (block) { return block.name.charAt(0) === 'L' && block.z1 > -1.8 }).forEach(function (block) {
      for (var z = block.z0 + 0.1; z < block.z1 - 0.3; z += 0.7) {
        parts.push(sagWire(wire, v(block.x1 + 0.05, 2.8, z), v(block.x1 + 0.05, 2.8, Math.min(block.z1 - 0.05, z + 0.7)), 0.06, 0.018))
      }
    })
    parts.push(boxSpan(materials.toon('ac'), l1, l1 + 0.12, 1.6, 2.1, -0.3, -0.18, { radius: 0.01, name: 'Meter' }))
    parts.push(boxSpan(materials.toon('ac'), -2.95, -2.6, 2.55, 2.85, face('B0'), face('B0') + 0.12, { radius: 0.01, name: 'Meter' }))
    return group.apply(null, ['Shopfronts'].concat(parts))
  }

  /** 伸出楼面的招牌箱：箱体、拉杆；返回字面位置（左排楼的朝 +z，后排楼的朝 +x）。 */
  function buildHangingSigns(materials) {
    var box = materials.toon('signBox')
    var rod = materials.toon('antenna')
    var parts = []
    var placements = []
    HANGING_SIGNS.forEach(function (sign, index) {
      var bounds = hangingSignBox(sign)
      parts.push(boxSpan(box, bounds.min.x, bounds.max.x, bounds.min.y, bounds.max.y, bounds.min.z, bounds.max.z, { radius: 0.02, name: 'Sign' + index }))
      var length = Math.abs(sign.tip - sign.wall)
      var direction = Math.sign(sign.tip - sign.wall)
      // 拉杆：从墙上高处斜拉到招牌外端的上沿。
      var along = function (offset, y) {
        return sign.axis === 'x' ? v(sign.wall + direction * offset, y, sign.at) : v(sign.at, y, sign.wall + direction * offset)
      }
      parts.push(tubeBetween(rod, along(0, sign.y1 + 0.45), along(length * 0.85, sign.y1 + 0.02), 0.015, { name: 'Rod', castShadow: false }))
      parts.push(tubeBetween(rod, along(0, sign.y1 + 0.02), along(0.06, sign.y1 + 0.02), 0.03, { name: 'Rod', castShadow: false }))
      var width = length - 0.08
      var height = sign.y1 - sign.y0 - 0.08
      var mid = (sign.wall + sign.tip) / 2
      var faceOffset = SIGN_DEPTH / 2 + 0.004
      placements.push(sign.axis === 'x'
        ? { position: v(mid, (sign.y0 + sign.y1) / 2, sign.at + faceOffset), rotationY: 0, width: width, height: height, vertical: sign.vertical, role: sign.role }
        : { position: v(sign.at + faceOffset, (sign.y0 + sign.y1) / 2, mid), rotationY: Math.PI / 2, width: width, height: height, vertical: sign.vertical, role: sign.role })
    })
    return { group: group.apply(null, ['HangingSigns'].concat(parts)), placements: placements }
  }

  /** B1 楼顶的广告架（在歌词屏正上方）：两根立柱、斜撑、背板。 */
  function buildRoofBillboard(materials) {
    var steel = materials.toon('antenna')
    var x0 = ROOF_BILLBOARD.x0
    var x1 = ROOF_BILLBOARD.x1
    var z = ROOF_BILLBOARD.z
    var y0 = ROOF_BILLBOARD.y0
    var y1 = ROOF_BILLBOARD.y1
    var roof = blockOf('B1').height + 0.03
    var parts = [
      boxSpan(materials.toon('signBox'), x0, x1, y0, y1, z - 0.1, z, { radius: 0.02, name: 'Board' })
    ]
    ;[x0 + 0.25, x1 - 0.25].forEach(function (x) {
      parts.push(boxSpan(steel, x - 0.04, x + 0.04, roof, y0 + 0.2, z - 0.14, z - 0.1, { radius: 0, name: 'Leg' }))
      parts.push(tubeBetween(steel, v(x, roof, z - 0.7), v(x, y0 + 0.1, z - 0.12), 0.02, { name: 'Brace', castShadow: false }))
    })
    parts.push(boxSpan(steel, x0, x1, y0 + 0.05, y0 + 0.1, z - 0.16, z - 0.1, { radius: 0, name: 'Rail' }))
    var placement = { position: v((x0 + x1) / 2, (y0 + y1) / 2, z + 0.004), rotationY: 0, width: x1 - x0 - 0.06, height: y1 - y0 - 0.06, vertical: false, role: 'billboard' }
    return { group: group.apply(null, ['Billboard'].concat(parts)), placement: placement }
  }

  /** 大排档：档口、帆布篷、灯泡、镬与汤锅、折台与塑料凳。 */
  function buildStall(materials) {
    var green = materials.toon('stallGreen')
    var steel = materials.toon('chrome')
    var x0 = STALL.x0
    var x1 = STALL.x1
    var z0 = STALL.z0
    var z1 = STALL.z1
    var counter = STALL.counter
    var back = STALL.back
    var canopy = STALL.canopy
    var parts = [
      boxSpan(green, x0, x1, 0, counter, z0, z1, { radius: 0.03, name: 'Kiosk' }),
      boxSpan(steel, x0 - 0.04, x1 + 0.04, counter, counter + 0.04, z0 - 0.04, z1 + 0.08, { radius: 0.01, name: 'Top' }),
      boxSpan(green, x0, x1, counter, back, z0, z0 + 0.06, { radius: 0.01, name: 'Back' }),
      boxSpan(green, x0, x0 + 0.05, counter, back, z0, z1, { radius: 0.01, name: 'Side' }),
      boxSpan(green, x1 - 0.05, x1, counter, back, z0, z1, { radius: 0.01, name: 'Side' }),
      boxSpan(materials.toon('slab'), x0 + 0.1, x1 - 0.1, 1.55, 1.58, z0 + 0.06, z0 + 0.3, { radius: 0, name: 'Shelf' })
    ]
    // 招牌板：立在帆布篷后沿上面，两根短杆撑着（字面另挂）。
    var board = { x0: x0 + 0.2, x1: x1 - 0.2, y0: canopy + 0.12, y1: canopy + 0.52 }
    parts.push(boxSpan(materials.toon('signBox'), board.x0, board.x1, board.y0, board.y1, z0 - 0.1, z0 - 0.02, { radius: 0.015, name: 'Board' }))
    ;[board.x0 + 0.15, board.x1 - 0.15].forEach(function (x) {
      parts.push(boxSpan(steel, x - 0.02, x + 0.02, back, board.y0, z0 - 0.08, z0 - 0.04, { radius: 0, name: 'BoardPost' }))
    })
    // 帆布篷：红白条，从后板顶斜着伸到档口前面，前面两根杆撑着。
    var tarp = new THREE.Group()
    tarp.name = 'Tarp'
    var stripes = 8
    var width = x1 - x0 + 0.3
    var depth = z1 - z0 + 0.9
    for (var index = 0; index < stripes; index += 1) {
      var stripe = mesh(new THREE.BoxGeometry(width / stripes, 0.025, depth), materials.toon(index % 2 ? 'tarpWhite' : 'tarpRed'), { name: 'Tarp' })
      stripe.position.set(-width / 2 + (index + 0.5) * (width / stripes), 0, depth / 2)
      tarp.add(stripe)
    }
    tarp.position.set((x0 + x1) / 2, canopy, z0 - 0.1)
    tarp.rotation.x = 0.2
    parts.push(tarp)
    var front = z0 - 0.1 + depth * Math.cos(0.2) - 0.06
    var frontY = canopy - depth * Math.sin(0.2)
    ;[x0 - 0.1, x1 + 0.1].forEach(function (x) {
      parts.push(cylinderAt(steel, 0.025, frontY, [x, 0, front], { name: 'Pole', segments: 6 }))
    })
    // 灯泡：篷下垂一颗。
    var bulb = v((x0 + x1) / 2 + 0.2, frontY - 0.35, (z1 + front) / 2)
    parts.push(cylinderAt(materials.toon('wire'), 0.006, 0.3, [bulb.x, bulb.y + 0.05, bulb.z], { name: 'Cord', segments: 4 }))
    var glow = mesh(new THREE.SphereGeometry(0.07, 10, 8), materials.glow('stallBulb'), { name: 'Bulb', castShadow: false })
    glow.position.copy(bulb)
    parts.push(glow)
    // 镬（炉头上一只黑镬）与汤锅。
    var wok = v(x0 + 0.5, counter + 0.04, (z0 + z1) / 2 + 0.1)
    parts.push(cylinderAt(materials.toon('darkMetal'), 0.2, 0.08, [wok.x, wok.y, wok.z], { name: 'Burner', segments: 12 }))
    var pan = mesh(new THREE.SphereGeometry(0.24, 14, 6, 0, Math.PI * 2, Math.PI * 0.62, Math.PI * 0.38), materials.toon('darkMetal'), { name: 'Wok' })
    pan.position.set(wok.x, wok.y + 0.32, wok.z)
    parts.push(pan)
    parts.push(cylinderAt(steel, 0.2, 0.36, [x1 - 0.45, counter + 0.04, (z0 + z1) / 2], { name: 'Pot', segments: 14 }))
    // 折台与四张塑料凳。
    var table = STALL_TABLE
    parts.push(boxAt(materials.toon('table'), [0.85, 0.04, 0.85], [table.x, 0.7, table.z], { radius: 0.01, name: 'Table' }))
    ;[[-0.36, -0.36], [0.36, -0.36], [-0.36, 0.36], [0.36, 0.36]].forEach(function (d) {
      parts.push(boxAt(steel, [0.03, 0.7, 0.03], [table.x + d[0], 0, table.z + d[1]], { radius: 0, name: 'TableLeg' }))
    })
    ;[[-0.68, 0.1], [0.68, -0.05], [0.05, 0.7], [-0.1, -0.68]].forEach(function (d, i) {
      parts.push(cylinderAt(materials.toon(i % 3 === 2 ? 'stoolBlue' : 'plastic'), 0.15, 0.42, [table.x + d[0], 0, table.z + d[1]], { name: 'Stool', segments: 10, radiusTop: 0.13 }))
    })
    var placement = {
      position: v((board.x0 + board.x1) / 2, (board.y0 + board.y1) / 2, z0 - 0.016),
      rotationY: 0,
      width: board.x1 - board.x0 - 0.06,
      height: board.y1 - board.y0 - 0.06,
      vertical: false,
      role: 'stall'
    }
    return { group: group.apply(null, ['Stall'].concat(parts)), placement: placement, bulb: bulb, wok: wok.clone().setY(counter + 0.45) }
  }

  /** 电线杆：杆、两道横担与瓷碗、变压器、街灯（灯臂伸向巷子）。返回灯头与横担上拉线的点。 */
  function buildPole(materials) {
    var x = POLE.x
    var z = POLE.z
    var height = POLE.height
    var lampArm = POLE.lampArm
    var lampY = POLE.lampY
    var steel = materials.toon('antenna')
    var parts = [
      cylinderAt(materials.toon('pole'), 0.12, height, [x, 0, z], { name: 'Pole', radiusTop: 0.085, segments: 10 })
    ]
    var arms = [height - 0.35, height - 0.8]
    var anchors = []
    arms.forEach(function (y) {
      parts.push(boxSpan(steel, x - 0.05, x + 0.05, y - 0.05, y + 0.05, z - 0.65, z + 0.65, { radius: 0, name: 'Crossarm' }))
      ;[-0.55, -0.2, 0.2, 0.55].forEach(function (dz) {
        parts.push(cylinderAt(materials.toon('ac'), 0.03, 0.09, [x, y + 0.05, z + dz], { name: 'Insulator', segments: 6 }))
        anchors.push(v(x, y + 0.12, z + dz))
      })
    })
    parts.push(cylinderAt(materials.toon('tank'), 0.24, 0.62, [x + 0.3, height - 2.2, z], { name: 'Transformer', segments: 12 }))
    parts.push(boxSpan(steel, x + 0.05, x + 0.1, height - 2.0, height - 1.9, z - 0.04, z + 0.04, { radius: 0, name: 'Bracket' }))
    // 街灯：灯臂往前（+z）伸，灯头朝下，照在酒吧门右边，光柱不挡歌词屏。
    var head = v(x - 0.05, lampY + 0.12, z + lampArm)
    parts.push(tubeBetween(steel, v(x, lampY - 0.15, z + 0.1), v(head.x, head.y + 0.08, head.z - 0.2), 0.03, { name: 'LampArm' }))
    parts.push(boxSpan(materials.toon('darkMetal'), head.x - 0.13, head.x + 0.13, head.y, head.y + 0.1, head.z - 0.26, head.z + 0.26, { radius: 0.03, name: 'LampHead' }))
    parts.push(boxSpan(materials.glow('lampHead'), head.x - 0.09, head.x + 0.09, head.y - 0.02, head.y, head.z - 0.2, head.z + 0.2, { radius: 0, name: 'LampLens' }))
    return { group: group.apply(null, ['Pole'].concat(parts)), lampHead: head.clone().setY(head.y - 0.04), anchors: anchors }
  }

  /** 电线：电线杆横担往楼顶拉一把，左边楼面与后排楼面之间斜着交错一堆（都在招牌那一角，不横过歌词屏）。 */
  function buildCables(materials, anchors, random) {
    var wire = materials.toon('wire')
    var parts = []
    var b1 = blockOf('B1')
    var b2 = blockOf('B2')
    var l1 = blockOf('L1')
    // 杆 → 后排楼顶、B2 楼顶、远远拉向左排楼的高处。
    anchors.slice(0, 4).forEach(function (anchor, index) {
      var to = index < 2
        ? v(3.4 + index * 0.5, b1.height + 0.2, b1.z1 - 0.3 - index * 0.4)
        : v(b2.x0 + 0.4 + index * 0.2, b2.height + 0.15, b2.z1 - 0.2)
      parts.push(sagWire(wire, anchor, to, 0.15 + random() * 0.15, 0.013))
    })
    anchors.slice(4).forEach(function (anchor, index) {
      var to = v(l1.x1, l1.height - 0.25 - index * 0.12, l1.z0 + 0.4 + index * 0.25)
      parts.push(sagWire(wire, anchor, to, 0.3 + random() * 0.2, 0.013))
    })
    // 左排楼面 ↔ 后排楼面：在巷子那一角上空交错。
    for (var index = 0; index < 11; index += 1) {
      var z = -1.6 + random() * 4.4
      var from = v(leftFaceAt(z), 3.3 + random() * 2.8, z)
      var toX = -2.9 + random() * 2.5
      var to = v(toX, 3.3 + random() * 2.7, toX < -1.6 ? -1.8 : -2.05)
      parts.push(sagWire(wire, from, to, 0.12 + random() * 0.35, 0.011))
    }
    return group.apply(null, ['Cables'].concat(parts))
  }

  /** 一架电单车（停着）：车身、踏板、座位、前挡、车头与把手、前后轮；车头朝 rotationY 方向的 +x。 */
  function buildScooter(materials, color, at, rotationY) {
    var body = materials.toon(color)
    var dark = materials.toon('rubber')
    var parts = [
      boxSpan(body, -0.42, 0.05, 0.22, 0.55, -0.16, 0.16, { radius: 0.05, name: 'Body' }),
      boxSpan(body, 0.05, 0.42, 0.18, 0.26, -0.13, 0.13, { radius: 0.02, name: 'Floor' }),
      boxSpan(body, 0.38, 0.48, 0.2, 0.85, -0.17, 0.17, { radius: 0.04, name: 'Shield' }),
      boxSpan(dark, -0.4, 0.02, 0.55, 0.64, -0.13, 0.13, { radius: 0.04, name: 'Seat' }),
      boxSpan(materials.toon('chrome'), 0.45, 0.5, 0.85, 0.9, -0.24, 0.24, { radius: 0.01, name: 'Bar' })
    ]
    ;[-0.38, 0.5].forEach(function (x) {
      var wheel = mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.08, 14), dark, { name: 'Wheel' })
      wheel.rotation.x = Math.PI / 2
      wheel.position.set(x, 0.16, 0)
      parts.push(wheel)
    })
    var scooter = group.apply(null, ['Scooter'].concat(parts))
    scooter.position.copy(at)
    scooter.rotation.y = rotationY
    return scooter
  }

  /** 贩卖机（发光的正面）、杂物（木箱、垃圾袋、石油气罐）、全息投影机的底座。 */
  function buildProps(materials, random) {
    var parts = []
    var x = VENDING.x
    var z = VENDING.z
    parts.push(boxSpan(materials.toon('vendingBody'), x - 0.34, x + 0.34, 0, 1.8, z - 0.32, z + 0.28, { radius: 0.03, name: 'Vending' }))
    parts.push(boxSpan(materials.glow('vending'), x - 0.27, x + 0.27, 0.75, 1.65, z + 0.28, z + 0.3, { radius: 0, name: 'Vending/face' }))
    parts.push(boxSpan(materials.toon('windowDark'), x - 0.24, x + 0.24, 0.18, 0.4, z + 0.28, z + 0.31, { radius: 0.01, name: 'Vending' }))
    // 木箱一摞、几只垃圾袋、两罐石油气：L3 门口、L1 楼脚。
    var crate = materials.toon('crate')
    ;[[-3.45, 5.75, 0], [-3.45, 5.75, 0.36], [-3.0, 5.6, 0]].forEach(function (at) {
      parts.push(boxAt(crate, [0.5, 0.36, 0.42], [at[0], at[2], at[1]], { radius: 0.02, name: 'Crate' }))
    })
    for (var index = 0; index < 4; index += 1) {
      var bag = mesh(new THREE.SphereGeometry(0.22, 10, 8), materials.toon('bag'), { name: 'Bag' })
      bag.scale.set(1, 0.75 + random() * 0.2, 0.9)
      bag.position.set(-3.05 + random() * 0.25, 0.16, -0.75 + index * 0.24 + random() * 0.1)
      parts.push(bag)
    }
    ;[[-3.1, 4.25], [-3.1, 3.95]].forEach(function (at) {
      parts.push(cylinderAt(materials.toon('gas'), 0.13, 0.62, [at[0], LEVEL.ground, at[1]], { name: 'Gas', segments: 10 }))
    })
    // 全息投影机：一只矮铁盒，顶上一圈发光的镜头。
    parts.push(boxAt(materials.toon('holoBase'), [0.46, 0.24, 0.46], [HOLOGRAM.x, 0, HOLOGRAM.z], { radius: 0.04, name: 'Projector' }))
    parts.push(cylinderAt(materials.glow('holoLens'), 0.13, 0.03, [HOLOGRAM.x, 0.24, HOLOGRAM.z], { name: 'Projector/lens', segments: 14 }))
    // 左排楼脚并排停着两架电单车；大排档旁一架木头手推车、一摞胶箱。
    ;[[-2.75, 4.75, 'scooterA'], [-2.75, 5.35, 'scooterB']].forEach(function (item) {
      parts.push(buildScooter(materials, item[2], v(item[0], LEVEL.ground, item[1]), Math.PI / 2 + (random() - 0.5) * 0.3))
    })
    var cart = materials.toon('crate')
    parts.push(boxAt(cart, [1.0, 0.06, 0.6], [3.25, 0.55, 3.55], { radius: 0.01, name: 'Cart' }))
    parts.push(boxAt(cart, [1.0, 0.18, 0.04], [3.25, 0.61, 3.27], { radius: 0.01, name: 'Cart' }))
    parts.push(boxAt(cart, [1.0, 0.18, 0.04], [3.25, 0.61, 3.83], { radius: 0.01, name: 'Cart' }))
    parts.push(tubeBetween(cart, v(2.75, 0.62, 3.3), v(2.35, 0.8, 3.3), 0.025, { name: 'Cart' }))
    parts.push(tubeBetween(cart, v(2.75, 0.62, 3.8), v(2.35, 0.8, 3.8), 0.025, { name: 'Cart' }))
    ;[3.27, 3.83].forEach(function (z2) {
      var wheel = mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.05, 14), materials.toon('rubber'), { name: 'Cart' })
      wheel.rotation.x = Math.PI / 2
      wheel.position.set(3.45, 0.24, z2 + (z2 < 3.5 ? -0.05 : 0.05))
      parts.push(wheel)
    })
    parts.push(boxAt(cart, [0.04, 0.32, 0.04], [2.85, 0.24, 3.55], { radius: 0, name: 'Cart' }))
    ;[[5.55, 2.8, 0], [5.55, 2.8, 0.3], [5.15, 2.75, 0]].forEach(function (at) {
      parts.push(boxAt(materials.toon('crateBlue'), [0.42, 0.3, 0.32], [at[0], at[2], at[1]], { radius: 0.02, name: 'Crate' }))
    })
    return group.apply(null, ['Props'].concat(parts))
  }

  /** 巷子里除了楼以外的固定几何。 */
  function buildKowloonStreet(materials, seed) {
    var random = SeedHash.createVisualizerRng('kowloon:street:' + seed)
    var ground = buildGround(materials)
    var hanging = buildHangingSigns(materials)
    var billboard = buildRoofBillboard(materials)
    var stall = buildStall(materials)
    var pole = buildPole(materials)
    var cables = buildCables(materials, pole.anchors, random)
    var shopfronts = buildShopfronts(materials)
    var props = buildProps(materials, random)
    // 楼脚沿墙拉的电线不算（水管跟电线交叉无所谓）。
    var footing = shopfronts.children.concat(props.children)
      .filter(function (part) { return !(part instanceof THREE.Mesh && part.geometry instanceof THREE.TubeGeometry) })
      .map(function (part) { return new THREE.Box3().setFromObject(part) })
    return {
      group: group('Street', ground.base, shopfronts, hanging.group, billboard.group, stall.group, pole.group, cables, props),
      surface: ground.surface,
      signs: hanging.placements.concat([billboard.placement, stall.placement]),
      lampHead: pole.lampHead,
      stallBulb: stall.bulb,
      wok: stall.wok,
      manhole: ground.manhole,
      signBoxes: HANGING_SIGNS.map(function (sign) { return hangingSignBox(sign, 0.08) }),
      footing: footing
    }
  }

  /** 默认构图要框进去的点：底座顶面四角与两侧厚度、各栋楼顶的外角、广告架顶、电线杆顶。 */
  function kowloonFramingPoints() {
    var h = MACHI_BASE.half
    var points = []
    ;[-h, h].forEach(function (x) {
      ;[-h, h].forEach(function (z) {
        points.push(v(x, 0, z))
        if (z < 0 || x < 0) points.push(v(x, -MACHI_BASE.depth, z))
      })
    })
    BLOCKS.forEach(function (block) {
      points.push(v(block.x0, block.height + 0.3, block.z0), v(block.x1, block.height + 0.3, block.z0), v(block.x0, block.height + 0.3, block.z1))
    })
    points.push(v(ROOF_BILLBOARD.x0, ROOF_BILLBOARD.y1 + 0.1, ROOF_BILLBOARD.z), v(ROOF_BILLBOARD.x1, ROOF_BILLBOARD.y1 + 0.1, ROOF_BILLBOARD.z))
    points.push(v(POLE.x, POLE.height + 0.1, POLE.z))
    return points
  }

  // ===== blocks.ts =====
  // 城寨楼：每栋一个盒子，朝外的三面（+z、+x、-x）按层按列铺窗。窗格只铺在露在外面的地方（格子前一点的点落在别的楼里
  // 就跳过），也避开歌词屏、招牌。每扇窗随机配一样东西：铁窗笼、窗下的冷气机（下雨时滴水）、伸出去的晾衫竹、
  // 封出去的加建小间；每层一道楼板线，两列窗之间几根水管。伸出墙外的东西与水管各占一块地方，后放的让开先放的。
  // 夜里按 seed 亮一部分窗（暖黄、日光灯白、偏绿、偏粉），亮窗和暗窗各一个 InstancedMesh，晾的衫一个 InstancedMesh
  // （实例色）。楼顶：女儿墙、水箱、天线、小屋、锅盖。

  /** 亮窗的颜色：暖黄的灯泡、日光灯白、偏绿的日光灯、粉色的灯（赛博朋克的城寨）。 */
  var WINDOW_LIGHTS = ['#ffc47a', '#ffd39a', '#cfe2f5', '#b4f0cf', '#ff8fd0', '#8fc8f5']
  var WINDOW_WEIGHTS = [0.3, 0.16, 0.22, 0.12, 0.1, 0.1]

  /** 晾的衫：白、浅蓝、红、黄、粉、藏青、灰。 */
  var CLOTHES = ['#f1efe8', '#a9c8e8', '#d0463c', '#e8c24a', '#f0a3c0', '#2c3d63', '#9a9fa6', '#6fb08a']

  var UP = new THREE.Vector3(0, 1, 0)

  /** 一栋楼朝外的三面：前（+z）、右（+x）、左（-x）。 */
  function facesOf(block) {
    return [
      { block: block, origin: new THREE.Vector3(block.x0, 0, block.z1), along: new THREE.Vector3(1, 0, 0), normal: new THREE.Vector3(0, 0, 1), width: block.x1 - block.x0, rotationY: 0 },
      { block: block, origin: new THREE.Vector3(block.x1, 0, block.z1), along: new THREE.Vector3(0, 0, -1), normal: new THREE.Vector3(1, 0, 0), width: block.z1 - block.z0, rotationY: Math.PI / 2 },
      { block: block, origin: new THREE.Vector3(block.x0, 0, block.z0), along: new THREE.Vector3(0, 0, 1), normal: new THREE.Vector3(-1, 0, 0), width: block.z1 - block.z0, rotationY: -Math.PI / 2 }
    ]
  }

  /** 点在哪栋楼里面（eps 往里收一点，贴着墙面的点不算）。 */
  function insideAnyBlock(point, eps) {
    eps = eps === undefined ? 0.01 : eps
    return BLOCKS.some(function (block) {
      return point.x > block.x0 + eps && point.x < block.x1 - eps && point.z > block.z0 + eps && point.z < block.z1 - eps && point.y < block.height - eps
    })
  }

  function insideAny(point, boxes) {
    return boxes.some(function (box) { return box.containsPoint(point) })
  }

  /** 墙面上 (s, y) 处、往外 out 米的点。 */
  function facePoint(face, s, y, out) {
    out = out === undefined ? 0 : out
    return face.origin.clone()
      .addScaledVector(face.along, s)
      .addScaledVector(UP, y)
      .addScaledVector(face.normal, out)
  }

  /** 墙面上一块地方的包围盒：沿墙 s0..s1、高 y0..y1、往外 out0..out1。 */
  function faceBounds(face, s0, s1, y0, y1, out0, out1) {
    return new THREE.Box3().setFromPoints([facePoint(face, s0, y0, out0), facePoint(face, s1, y1, out1)])
  }

  function hitsAny(box, boxes) {
    return boxes.some(function (other) { return other.intersectsBox(box) })
  }

  /** 贴着墙面的一个盒子：宽沿墙、高、厚沿法线；中心在墙外 out 米。 */
  function faceBox(material, face, s, y, size, out, name) {
    var result = mesh(roundedBox(size[0], size[1], size[2], 0), material, { name: name })
    result.position.copy(facePoint(face, s, y + size[1] / 2, out))
    result.rotation.y = face.rotationY
    return result
  }

  function pickWeighted(random, weights) {
    var roll = random() * weights.reduce(function (sum, weight) { return sum + weight }, 0)
    for (var index = 0; index < weights.length; index += 1) {
      roll -= weights[index]
      if (roll <= 0) return index
    }
    return weights.length - 1
  }

  function instanced(geometry, material, slots, name, castShadow) {
    var result = new THREE.InstancedMesh(geometry, material, Math.max(1, slots.length))
    result.name = name
    result.count = slots.length
    result.castShadow = castShadow === true
    result.receiveShadow = true
    var matrix = new THREE.Matrix4()
    var quaternion = new THREE.Quaternion()
    var color = new THREE.Color()
    slots.forEach(function (slot, index) {
      quaternion.setFromAxisAngle(UP, slot.rotationY)
      matrix.compose(slot.position, quaternion, slot.scale)
      result.setMatrixAt(index, matrix)
      if (slot.color) result.setColorAt(index, color.set(slot.color))
    })
    result.instanceMatrix.needsUpdate = true
    if (result.instanceColor) result.instanceColor.needsUpdate = true
    return result
  }

  /**
   * 所有的楼。avoid 是不铺窗的地方（歌词屏、广告架）；signs 是招牌占的地方：冷气机、铁笼、晾衫竹、水管都让开它们；
   * footing 是楼脚的铺面与杂物：水管碰到它们就只落到一楼楼板。
   */
  function buildKowloonBlocks(materials, seed, avoid, signs, footing) {
    footing = footing === undefined ? [] : footing
    var random = SeedHash.createVisualizerRng('kowloon:blocks:' + seed)
    var frame = materials.toon('windowFrame')
    var slab = materials.toon('slab')
    var cageMaterials = [materials.toon('cage'), materials.toon('rust')]
    var ac = materials.toon('ac')
    var acGrille = materials.toon('acGrille')
    var pipe = materials.toon('pipe')
    var bamboo = materials.toon('bamboo')
    var stain = materials.toon('stain')
    var blocks = []
    var lit = []
    var dark = []
    var clothes = []
    var drips = []
    /** 伸出墙外的东西（加建、铁窗笼、冷气机、晾衫竹连衣服）各占的地方：后放的让开先放的，楼上的冷气机不插进楼下的
     * 晾衫竹、铁窗笼，楼角两面伸出来的竹竿不交叉。claim 放得下就占住。 */
    var outward = []
    var claim = function (box) {
      if (hitsAny(box, outward)) return false
      outward.push(box)
      return true
    }
    var overhead = signs.concat(avoid)
    // 掏空的门面（酒吧）也算楼脚的东西。
    var groundHoles = []
    BLOCKS.forEach(function (block) {
      if (block.hollow) {
        groundHoles.push(new THREE.Box3(
          new THREE.Vector3(block.hollow.x0, 0, block.z1 - 0.05),
          new THREE.Vector3(block.hollow.x1, block.hollow.y1, block.z1 + 0.5)
        ))
      }
    })
    var ground = footing.concat(groundHoles)

    var glass = function (face, s, y, w, h, out) {
      var slot = { position: facePoint(face, s, y, out), rotationY: face.rotationY, scale: new THREE.Vector3(w, h, 1) }
      if (random() < 0.46) {
        slot.color = WINDOW_LIGHTS[pickWeighted(random, WINDOW_WEIGHTS)]
        lit.push(slot)
      } else dark.push(slot)
    }

    BLOCKS.forEach(function (block) {
      var parts = []
      var wall = materials.toon(block.wall)
      var hollow = block.hollow
      if (hollow) {
        // 一楼掏空（酒吧）：上面一整块，下面后、左、右三块围着。
        parts.push(
          boxSpan(wall, block.x0, block.x1, hollow.y1, block.height, block.z0, block.z1, { radius: 0.02, name: 'Body' }),
          boxSpan(wall, block.x0, block.x1, 0, hollow.y1, block.z0, hollow.z0, { radius: 0.02, name: 'Body' }),
          boxSpan(wall, block.x0, hollow.x0, 0, hollow.y1, hollow.z0, block.z1, { radius: 0.02, name: 'Body' }),
          boxSpan(wall, hollow.x1, block.x1, 0, hollow.y1, hollow.z0, block.z1, { radius: 0.02, name: 'Body' })
        )
      } else {
        parts.push(boxSpan(wall, block.x0, block.x1, 0, block.height, block.z0, block.z1, { radius: 0.02, name: 'Body' }))
      }
      facesOf(block).forEach(function (face) {
        // 底座边上的外墙：只在镜头转过去时看得到，铺窗但不加伸出去的东西。
        var probe = facePoint(face, face.width / 2, block.height - 0.5, 0.2)
        var outer = Math.abs(probe.x) > 6 || Math.abs(probe.z) > 6
        // 楼板线：每层一道；有几道贴着一段霓虹灯带（粉或青）。
        for (var y = FLOORS.ground; y < block.height - 0.3; y += FLOORS.height) {
          parts.push(faceBox(slab, face, face.width / 2, y - 0.03, [face.width, 0.06, 0.1], 0.0, 'Slab'))
          if (!outer && random() < 0.14) {
            var length = Math.min(face.width - 0.2, 0.9 + random() * 1.6)
            var s = 0.1 + length / 2 + random() * (face.width - 0.2 - length)
            if (!insideAnyBlock(facePoint(face, s, y + 0.1, 0.15)) && !insideAny(facePoint(face, s, y, 0.1), avoid)) {
              parts.push(faceBox(materials.glow(random() < 0.55 ? 'stripPink' : 'stripCyan'), face, s, y + 0.03, [length, 0.035, 0.03], 0.06, 'Strip'))
            }
          }
        }
        var columns = Math.max(1, Math.floor((face.width - 0.2) / 0.64))
        var spacing = face.width / columns
        // 水管：一两根竖着的，走在两列窗之间（只有一列窗就贴着楼角），从楼顶下来。挡着歌词屏、招牌的不装；
        // 楼脚有铺面、杂物、掏空的门面，就只落到一楼楼板。水管也占地方，旁边的铁窗笼、加建让开它。
        var pipes = 1 + Math.floor(random() * 2)
        for (var pipeIndex = 0; pipeIndex < pipes; pipeIndex += 1) {
          var pick = random()
          var ps = columns > 1 ? (1 + Math.floor(pick * (columns - 1))) * spacing : (pick < 0.5 ? 0.12 : face.width - 0.12)
          if (insideAnyBlock(facePoint(face, ps, block.height - 0.4, 0.12))) continue
          var top = block.height - 0.1
          var bottom = hitsAny(faceBounds(face, ps - 0.05, ps + 0.05, 0, FLOORS.ground, 0.04, 0.14), ground) ? FLOORS.ground - 0.03 : 0
          var bounds = faceBounds(face, ps - 0.05, ps + 0.05, bottom, top, 0.04, 0.14)
          if (hitsAny(bounds, overhead) || !claim(bounds)) continue
          var at = facePoint(face, ps, 0, 0.09)
          parts.push(cylinderAt(pipe, 0.045, top - bottom, [at.x, bottom, at.z], { name: 'Pipe', segments: 6 }))
        }
        for (var y2 = FLOORS.ground; y2 + 0.85 <= block.height - 0.15; y2 += FLOORS.height) {
          for (var column = 0; column < columns; column += 1) {
            var s2 = (column + 0.5) * spacing + (random() - 0.5) * 0.08
            var center = y2 + 0.55
            var probes = [-0.27, 0, 0.27].map(function (ds) { return facePoint(face, s2 + ds, center, 0.12) })
            if (probes.some(function (point) { return insideAnyBlock(point) })) continue
            if (probes.some(function (point) { return insideAny(point, avoid) })) continue
            var blocked = signs.concat(avoid)
            var nearSign = function (out, dy) {
              dy = dy === undefined ? 0 : dy
              return [-0.26, 0, 0.26].some(function (ds) { return insideAny(facePoint(face, s2 + ds, center + dy, out), blocked) })
            }
            var roll = random()
            // 封出去的加建小间：自己一扇小窗。
            if (!outer && roll < 0.08 && !nearSign(0.3) && claim(faceBounds(face, s2 - 0.3, s2 + 0.3, y2 + 0.06, y2 + 0.92, 0, 0.4))) {
              var color = random() < 0.5 ? 'wallD' : 'wallB'
              parts.push(faceBox(materials.toon(color), face, s2, y2 + 0.06, [0.6, 0.86, 0.4], 0.2, 'Addition'))
              parts.push(faceBox(frame, face, s2, y2 + 0.3, [0.42, 0.44, 0.04], 0.41, 'Frame'))
              glass(face, s2, center + 0.02, 0.32, 0.34, 0.435)
              continue
            }
            parts.push(faceBox(frame, face, s2, center - 0.3, [0.46, 0.6, 0.06], 0.0, 'Frame'))
            parts.push(faceBox(slab, face, s2, center - 0.33, [0.52, 0.04, 0.12], 0.02, 'Sill'))
            glass(face, s2, center, 0.36, 0.48, 0.035)
            if (outer) continue
            if (roll < 0.36 && !nearSign(0.15) && claim(faceBounds(face, s2 - 0.27, s2 + 0.27, center - 0.37, center + 0.37, 0, 0.25))) {
              // 铁窗笼：顶板、底板、前面几根竖枝、一道横枝、两侧的竖枝。
              var material = cageMaterials[random() < 0.35 ? 1 : 0]
              var depth = 0.24
              var cageBottom = center - 0.34
              var cageTop = center + 0.34
              parts.push(faceBox(material, face, s2, cageTop, [0.54, 0.03, depth], depth / 2, 'Cage'))
              parts.push(faceBox(material, face, s2, cageBottom - 0.03, [0.54, 0.03, depth], depth / 2, 'Cage'))
              ;[-0.25, -0.125, 0, 0.125, 0.25].forEach(function (ds) {
                parts.push(faceBox(material, face, s2 + ds, cageBottom, [0.02, cageTop - cageBottom, 0.02], depth, 'Cage'))
              })
              parts.push(faceBox(material, face, s2, center, [0.54, 0.02, 0.02], depth, 'Cage'))
              ;[-0.25, 0.25].forEach(function (ds) {
                parts.push(faceBox(material, face, s2 + ds, center, [0.02, 0.02, depth], depth / 2, 'Cage'))
              })
              // 笼里偶尔一盆绿。
              if (random() < 0.4) parts.push(faceBox(materials.toon('plant'), face, s2 + (random() - 0.5) * 0.24, cageBottom, [0.14, 0.14, 0.14], 0.14, 'Plant'))
            } else if (roll < 0.7 && !nearSign(0.2, -0.4) && claim(faceBounds(face, s2 - 0.21, s2 + 0.21, center - 0.72, center - 0.42, 0, 0.33))) {
              // 冷气机：窗下，伸出墙外，前面一块深色格栅；下雨时前沿滴水。
              var acY = center - 0.72
              parts.push(faceBox(ac, face, s2, acY, [0.42, 0.3, 0.32], 0.16, 'AC'))
              parts.push(faceBox(acGrille, face, s2 - 0.04, acY + 0.05, [0.28, 0.2, 0.02], 0.325, 'AC'))
              if (random() < 0.45) {
                var stainLength = 0.45 + random() * 0.7
                parts.push(faceBox(stain, face, s2 + (random() - 0.5) * 0.2, acY - stainLength, [0.08 + random() * 0.08, stainLength, 0.012], 0.006, 'Stain'))
              }
              if (drips.length < 28 && random() < 0.6) {
                var dripAt = facePoint(face, s2 + 0.12, acY, 0.3)
                drips.push({ x: dripAt.x, z: dripAt.z, from: acY, to: LEVEL.ground, period: 1.4 + random() * 2.2, phase: random() })
              }
            } else if (roll < 0.82 && !nearSign(0.6, 0.35) && claim(faceBounds(face, s2 - 0.03, s2 + 0.03, center - 0.08, center + 0.4, 0, 0.96))) {
              // 晾衫竹：从窗顶伸出去，挂两三件。
              var poleY = center + 0.38
              var from = facePoint(face, s2, poleY, 0.02)
              var to = facePoint(face, s2, poleY, 0.95)
              var bambooMesh = mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.93, 5), bamboo, { name: 'Bamboo', castShadow: false })
              bambooMesh.position.copy(from).add(to).multiplyScalar(0.5)
              bambooMesh.quaternion.setFromUnitVectors(UP, face.normal)
              parts.push(bambooMesh)
              // 衣服都在竹竿下同一个平面里，一件挨一件、中间留缝（叠着的两件会闪）；挂不下就一起收窄。
              var count = 2 + Math.floor(random() * 2)
              var pieces = []
              for (var pi = 0; pi < count; pi += 1) {
                pieces.push({
                  w: 0.16 + random() * 0.12,
                  h: 0.26 + random() * 0.18,
                  shift: random(),
                  color: CLOTHES[Math.floor(random() * CLOTHES.length)]
                })
              }
              var near = 0.12
              var far = 0.92
              var gap = 0.03
              var room = far - near - gap * (count - 1)
              var total = pieces.reduce(function (sum, piece) { return sum + piece.w }, 0)
              var narrow = Math.min(1, room / total)
              var slack = (room - total * narrow) / count
              var out = near
              pieces.forEach(function (piece) {
                var w = piece.w * narrow
                out += slack * piece.shift
                clothes.push({
                  position: facePoint(face, s2, poleY - piece.h / 2 - 0.01, out + w / 2),
                  rotationY: face.rotationY + Math.PI / 2,
                  scale: new THREE.Vector3(w, piece.h, 0.018),
                  color: piece.color
                })
                out += w + gap + slack * (1 - piece.shift)
              })
            }
          }
        }
      })
      // 楼顶：一层油毡面、一圈女儿墙，上面摆水箱、天线、小屋、锅盖、冷气机。
      var top2 = block.height
      parts.push(boxSpan(materials.toon('roofTar'), block.x0 + 0.06, block.x1 - 0.06, top2, top2 + 0.03, block.z0 + 0.06, block.z1 - 0.06, { radius: 0.01, name: 'Roof' }))
      var parapet = materials.toon('slab')
      parts.push(boxSpan(parapet, block.x0, block.x1, top2, top2 + 0.26, block.z1 - 0.08, block.z1, { radius: 0.01, name: 'Parapet' }))
      parts.push(boxSpan(parapet, block.x0, block.x1, top2, top2 + 0.26, block.z0, block.z0 + 0.08, { radius: 0.01, name: 'Parapet' }))
      parts.push(boxSpan(parapet, block.x0, block.x0 + 0.08, top2, top2 + 0.26, block.z0, block.z1, { radius: 0.01, name: 'Parapet' }))
      parts.push(boxSpan(parapet, block.x1 - 0.08, block.x1, top2, top2 + 0.26, block.z0, block.z1, { radius: 0.01, name: 'Parapet' }))
      Array.prototype.push.apply(parts, buildRoofClutter(materials, block, random, avoid))
      blocks.push(group.apply(null, ['Block/' + block.name].concat(parts)))
    })

    var glassGeometry = new THREE.PlaneGeometry(1, 1)
    var litMaterial = materials.track(new THREE.MeshBasicMaterial({ color: 0xffffff }))
    litMaterial.name = 'machi:glow:windows'
    var litWindows = instanced(glassGeometry, litMaterial, lit, 'Windows/lit')
    var darkWindows = instanced(glassGeometry, materials.toon('windowDark'), dark, 'Windows/dark')
    var clothesMesh = instanced(new THREE.BoxGeometry(1, 1, 1), materials.product, clothes, 'Laundry', true)
    return {
      group: group.apply(null, ['Blocks'].concat(blocks, [litWindows, darkWindows, clothesMesh])),
      litWindows: { mesh: litWindows, material: litMaterial },
      darkWindows: darkWindows,
      clothes: clothesMesh,
      drips: drips
    }
  }

  /** 一栋楼顶上的杂物：按格子撒，碰到更高的楼、广告架就不放。 */
  function buildRoofClutter(materials, block, random, avoid) {
    var parts = []
    var top = block.height + 0.03
    var tank = materials.toon('tank')
    var metal = materials.toon('antenna')
    var fits = function (x, z, r, h) {
      var corners = [[x - r, z - r], [x + r, z - r], [x - r, z + r], [x + r, z + r]]
      return corners.every(function (corner) {
        var cx = corner[0]
        var cz = corner[1]
        if (cx < block.x0 + 0.15 || cx > block.x1 - 0.15 || cz < block.z0 + 0.15 || cz > block.z1 - 0.15) return false
        var point = new THREE.Vector3(cx, top + h * 0.5, cz)
        return !insideAnyBlock(point) && !insideAny(point, avoid)
      })
    }
    var step = 0.95
    for (var x = block.x0 + 0.6; x < block.x1 - 0.4; x += step) {
      for (var z = block.z0 + 0.6; z < block.z1 - 0.4; z += step) {
        var px = x + (random() - 0.5) * 0.4
        var pz = z + (random() - 0.5) * 0.4
        var roll = random()
        if (roll < 0.22 && fits(px, pz, 0.4, 1.0)) {
          // 水箱：四脚架上一个圆桶。
          ;[[-0.22, -0.22], [0.22, -0.22], [-0.22, 0.22], [0.22, 0.22]].forEach(function (d) {
            parts.push(boxAt(metal, [0.05, 0.36, 0.05], [px + d[0], top, pz + d[1]], { radius: 0, name: 'TankLeg' }))
          })
          parts.push(cylinderAt(tank, 0.33, 0.6, [px, top + 0.36, pz], { name: 'Tank', segments: 14 }))
        } else if (roll < 0.36 && fits(px, pz, 0.55, 1.0)) {
          // 天台小屋：一间铁皮屋，前面一扇门。
          var color = random() < 0.5 ? 'wallD' : 'shutter'
          parts.push(boxAt(materials.toon(color), [1.0, 0.85, 0.85], [px, top, pz], { radius: 0.02, name: 'Shack' }))
          parts.push(boxAt(materials.toon('roofTar'), [1.12, 0.05, 0.98], [px, top + 0.85, pz], { radius: 0.01, name: 'Shack' }))
          parts.push(boxAt(materials.toon('windowDark'), [0.32, 0.62, 0.04], [px + 0.2, top, pz + 0.43], { radius: 0, name: 'Shack' }))
        } else if (roll < 0.68 && fits(px, pz, 0.32, 1.4)) {
          // 鱼骨天线：一根杆，三道横枝。
          var height = 0.9 + random() * 0.6
          parts.push(cylinderAt(metal, 0.018, height, [px, top, pz], { name: 'Antenna', segments: 5 }))
          var yaw = random() * Math.PI
          ;[0.55, 0.75, 0.92].forEach(function (t, index) {
            var bar = boxAt(metal, [0.62 - index * 0.12, 0.016, 0.016], [px, top + height * t, pz], { radius: 0, name: 'Antenna' })
            bar.rotation.y = yaw
            parts.push(bar)
          })
        } else if (roll < 0.76 && fits(px, pz, 0.3, 0.8)) {
          // 锅盖：短杆上一只碟，朝天斜着。
          parts.push(cylinderAt(metal, 0.025, 0.35, [px, top, pz], { name: 'Dish', segments: 5 }))
          var dish = mesh(new THREE.SphereGeometry(0.26, 12, 6, 0, Math.PI * 2, 0, Math.PI * 0.32), materials.toon('ac'), { name: 'Dish' })
          dish.position.set(px, top + 0.42, pz)
          dish.rotation.set(-0.9 - random() * 0.4, random() * Math.PI * 2, 0, 'YXZ')
          parts.push(dish)
        } else if (roll < 0.86 && fits(px, pz, 0.36, 0.6)) {
          parts.push(boxAt(materials.toon('ac'), [0.62, 0.48, 0.48], [px, top, pz], { radius: 0.02, name: 'RoofAC' }))
          parts.push(boxAt(materials.toon('acGrille'), [0.4, 0.04, 0.4], [px, top + 0.48, pz], { radius: 0, name: 'RoofAC' }))
        }
      }
    }
    return parts
  }

  // ===== bar.ts =====
  // 酒吧（B1 的一楼）：深色地砖、玻璃门面（竖框、踢脚、右边一扇玻璃门）、店里一条吧台（台面下一道霓虹灯带）、
  // 五张高脚凳、后墙一整面背光的酒架（瓶子是 InstancedMesh）、三盏吊灯、角落一台点唱机（拱顶的灯随音乐一明一暗）。
  // 门头是霓虹店招的灯箱（字面由 kowloonSigns 挂上），再往上是跑马灯条与歌词大屏的外框。

  /** 酒瓶：琥珀、深绿、透明、蓝、红、金。 */
  var BOTTLE_COLORS = ['#c98a3a', '#2f6b45', '#d9e4e8', '#3d6fb6', '#a8323a', '#e0b84f', '#7a4a2a']

  function buildKowloonBar(materials, seed) {
    var random = SeedHash.createVisualizerRng('kowloon:bar:' + seed)
    var x0 = BAR.x0
    var x1 = BAR.x1
    var glassZ = BAR.glass
    var back = BAR.back
    var ceiling = BAR.ceiling
    var frame = materials.toon('barFrame')
    var parts = [
      // 地砖、天花、两侧内墙、后墙。
      boxSpan(materials.toon('barFloor'), x0, x1, 0, LEVEL.floor, back, glassZ, { radius: 0.005, name: 'Floor' }),
      boxSpan(materials.toon('barWall'), x0, x1, ceiling - 0.05, ceiling, back, glassZ, { radius: 0, name: 'Ceiling' }),
      boxSpan(materials.toon('barWall'), x0, x0 + 0.04, LEVEL.floor, ceiling, back, glassZ, { radius: 0, name: 'Wall' }),
      boxSpan(materials.toon('barWall'), x1 - 0.04, x1, LEVEL.floor, ceiling, back, glassZ, { radius: 0, name: 'Wall' }),
      boxSpan(materials.toon('barWall'), x0, x1, LEVEL.floor, ceiling, back, back + 0.04, { radius: 0, name: 'Wall' }),
      // 门面：两侧墙垛、玻璃下的踢脚、玻璃上沿的横梁。墙垛包住楼的墙角，前面和外侧都比楼面凸出一点，
      // 里侧伸进门洞一点：跟楼的墙面重合的话两种颜色会互相闪。
      boxSpan(frame, x0 - 0.22, x0 + 0.01, 0, ceiling, glassZ - 0.02, BAR.front + 0.03, { radius: 0.01, name: 'Pier' }),
      boxSpan(frame, x1 - 0.01, x1 + 0.22, 0, ceiling, glassZ - 0.02, BAR.front + 0.03, { radius: 0.01, name: 'Pier' }),
      boxSpan(frame, x0, BAR.door[0], 0, 0.36, glassZ - 0.06, glassZ + 0.04, { radius: 0.01, name: 'Kick' }),
      boxSpan(frame, x0, x1, 2.32, 2.4, glassZ - 0.06, glassZ + 0.04, { radius: 0.01, name: 'Head' }),
      // 门口一级台阶。
      boxSpan(materials.toon('slab'), BAR.door[0] - 0.1, BAR.door[1] + 0.1, 0, LEVEL.floor, glassZ, BAR.front + 0.3, { radius: 0.01, name: 'Step' })
    ]
    // 玻璃：门左边的橱窗，竖框约每 1.1m 一根；门是一扇带框的玻璃门。
    var glass = materials.glass
    var pane = function (a, b, bottom, top, name) {
      var result = mesh(new THREE.PlaneGeometry(b - a, top - bottom), glass, { name: name, castShadow: false, receiveShadow: false })
      result.position.set((a + b) / 2, (bottom + top) / 2, glassZ)
      result.renderOrder = 2
      return result
    }
    parts.push(pane(x0, BAR.door[0], 0.36, 2.32, 'Glass/window'))
    var mullions = Math.max(1, Math.round((BAR.door[0] - x0) / 1.1))
    for (var index = 0; index <= mullions; index += 1) {
      var x = x0 + ((BAR.door[0] - x0) * index) / mullions
      parts.push(boxSpan(frame, x - 0.03, x + 0.03, 0.36, 2.32, glassZ - 0.04, glassZ + 0.03, { radius: 0.01, name: 'Mullion' }))
    }
    var d0 = BAR.door[0]
    var d1 = BAR.door[1]
    parts.push(
      boxSpan(frame, d0, d0 + 0.07, LEVEL.floor, 2.32, glassZ - 0.04, glassZ + 0.04, { radius: 0.01, name: 'Door' }),
      boxSpan(frame, d1 - 0.07, d1, LEVEL.floor, 2.32, glassZ - 0.04, glassZ + 0.04, { radius: 0.01, name: 'Door' }),
      boxSpan(frame, d0, d1, LEVEL.floor, LEVEL.floor + 0.12, glassZ - 0.04, glassZ + 0.04, { radius: 0.01, name: 'Door' }),
      boxSpan(materials.toon('chrome'), d1 - 0.2, d1 - 0.16, 0.9, 1.4, glassZ + 0.03, glassZ + 0.07, { radius: 0.01, name: 'Door' }),
      pane(d0 + 0.07, d1 - 0.07, LEVEL.floor + 0.12, 2.32, 'Glass/door'),
      boxSpan(frame, x1 - 0.2, x1, 0.36, 2.32, glassZ - 0.04, glassZ + 0.04, { radius: 0.01, name: 'Pier' })
    )
    // 后墙的酒架：一整面背光（发光板），三层隔板，瓶子摆在隔板上。
    var shelfX0 = x0 + 0.35
    var shelfX1 = BAR.counter.x1 + 0.15
    parts.push(boxSpan(materials.glow('barBacklight'), shelfX0, shelfX1, 1.0, 2.55, back + 0.04, back + 0.06, { radius: 0, name: 'Backlight' }))
    var shelfLevels = [1.05, 1.55, 2.05]
    shelfLevels.forEach(function (level) {
      parts.push(boxSpan(materials.toon('counterTop'), shelfX0, shelfX1, level - 0.03, level, back + 0.06, back + 0.3, { radius: 0.005, name: 'Shelf' }))
    })
    var bottles = []
    shelfLevels.forEach(function (level) {
      var x = shelfX0 + 0.08
      while (x < shelfX1 - 0.08) {
        if (random() > 0.12) {
          bottles.push({ x: x, y: level, z: back + 0.17 + (random() - 0.5) * 0.06, h: 0.2 + random() * 0.14, color: BOTTLE_COLORS[Math.floor(random() * BOTTLE_COLORS.length)] })
        }
        x += 0.1 + random() * 0.05
      }
    })
    var bottleGeometry = new THREE.CylinderGeometry(0.032, 0.04, 1, 8).translate(0, 0.5, 0)
    var bottleMesh = new THREE.InstancedMesh(bottleGeometry, materials.product, bottles.length)
    bottleMesh.name = 'Bar/bottles'
    bottleMesh.castShadow = false
    var matrix = new THREE.Matrix4()
    var color = new THREE.Color()
    bottles.forEach(function (bottle, bottleIndex) {
      matrix.makeScale(1, bottle.h, 1).setPosition(bottle.x, bottle.y, bottle.z)
      bottleMesh.setMatrixAt(bottleIndex, matrix)
      bottleMesh.setColorAt(bottleIndex, color.set(bottle.color))
    })
    // 吧台：台身、台面（往外挑一点）、台面下一道霓虹灯带、脚踏杆。
    var counter = BAR.counter
    parts.push(
      boxSpan(materials.toon('counter'), counter.x0, counter.x1, LEVEL.floor, counter.height - 0.05, counter.z0, counter.z1, { radius: 0.02, name: 'Counter' }),
      boxSpan(materials.toon('counterTop'), counter.x0 - 0.06, counter.x1 + 0.06, counter.height - 0.05, counter.height, counter.z0 - 0.04, counter.z1 + 0.1, { radius: 0.015, name: 'CounterTop' }),
      boxSpan(materials.glow('barStrip'), counter.x0, counter.x1, counter.height - 0.11, counter.height - 0.08, counter.z1 + 0.005, counter.z1 + 0.03, { radius: 0, name: 'Strip' }),
      boxSpan(materials.toon('chrome'), counter.x0 + 0.05, counter.x1 - 0.05, 0.22, 0.25, counter.z1 + 0.08, counter.z1 + 0.11, { radius: 0.01, name: 'FootRail' })
    )
    // 高脚凳：红座、镀铬的杆与底盘。
    var stools = 5
    for (var stoolIndex = 0; stoolIndex < stools; stoolIndex += 1) {
      var sx = counter.x0 + 0.3 + ((counter.x1 - counter.x0 - 0.6) * stoolIndex) / (stools - 1)
      var sz = counter.z1 + 0.42
      parts.push(
        cylinderAt(materials.toon('chrome'), 0.15, 0.03, [sx, LEVEL.floor, sz], { name: 'Stool', segments: 12 }),
        cylinderAt(materials.toon('chrome'), 0.025, 0.7, [sx, LEVEL.floor, sz], { name: 'Stool', segments: 6 }),
        cylinderAt(materials.toon('stool'), 0.17, 0.08, [sx, 0.74, sz], { name: 'Stool', segments: 14 })
      )
    }
    // 吊灯：天花垂下的线与一颗发光的灯罩。
    ;[0.25, 0.5, 0.75].forEach(function (t) {
      var px = counter.x0 + (counter.x1 - counter.x0) * t
      var pz = (counter.z0 + counter.z1) / 2 + 0.25
      parts.push(cylinderAt(materials.toon('wire'), 0.008, ceiling - 2.25, [px, 2.25, pz], { name: 'Pendant', segments: 4 }))
      var shade = mesh(new THREE.SphereGeometry(0.09, 12, 8), materials.glow('pendant'), { name: 'Pendant', castShadow: false })
      shade.position.set(px, 2.2, pz)
      parts.push(shade)
    })
    // 点唱机：右后角，机身、拱顶的灯（随音乐明暗）、前面一块深色的面板。
    var jx = (counter.x1 + x1) / 2 + 0.15
    var jz = back + 0.32
    parts.push(
      boxSpan(materials.toon('jukebox'), jx - 0.32, jx + 0.32, LEVEL.floor, 1.05, jz - 0.22, jz + 0.22, { radius: 0.04, name: 'Jukebox' }),
      boxSpan(materials.toon('windowDark'), jx - 0.22, jx + 0.22, 0.55, 0.95, jz + 0.2, jz + 0.235, { radius: 0.01, name: 'Jukebox' })
    )
    var arch = mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.44, 16, 1, false, -Math.PI / 2, Math.PI), materials.glow('jukebox'), { name: 'Jukebox/arch', castShadow: false })
    arch.rotation.x = Math.PI / 2
    arch.position.set(jx, 1.05, jz)
    parts.push(arch)
    // 门面上沿以上：店招的灯箱、跑马灯条的底板、歌词大屏的外框与两根支架。
    var signBox = materials.toon('signBox')
    parts.push(
      boxSpan(signBox, BAR_SIGN.x - BAR_SIGN.width / 2 - 0.08, BAR_SIGN.x + BAR_SIGN.width / 2 + 0.08, BAR_SIGN.y - BAR_SIGN.height / 2 - 0.06, BAR_SIGN.y + BAR_SIGN.height / 2 + 0.06, BAR.front, BAR_SIGN.z - 0.005, { radius: 0.02, name: 'SignBox' }),
      boxSpan(signBox, TICKER.x - TICKER.width / 2 - 0.05, TICKER.x + TICKER.width / 2 + 0.05, TICKER.y - TICKER.height / 2 - 0.04, TICKER.y + TICKER.height / 2 + 0.04, BAR.front, TICKER.z - 0.005, { radius: 0.01, name: 'TickerBox' }),
      boxSpan(materials.toon('screenFrame'), SCREEN.x - SCREEN.width / 2 - 0.1, SCREEN.x + SCREEN.width / 2 + 0.1, SCREEN.y - SCREEN.height / 2 - 0.08, SCREEN.y + SCREEN.height / 2 + 0.08, BAR.front, SCREEN.z - 0.005, { radius: 0.03, name: 'ScreenFrame' })
    )
    // 只在倒影里出现的橱窗光（店里亮着的那一片）。
    var standIn = mesh(new THREE.PlaneGeometry(BAR.door[1] - x0 - 0.2, 1.8), materials.glow('barWindow'), { name: 'ReflectionWindow', castShadow: false, receiveShadow: false })
    standIn.position.set((x0 + BAR.door[1]) / 2, 1.3, glassZ - 0.15)
    standIn.layers.set(MACHI_REFLECT_LAYER)
    parts.push(standIn)
    return { group: group.apply(null, ['Bar'].concat(parts, [bottleMesh])), bottles: bottleMesh }
  }

  // ===== kowloonLights.ts =====
  // 城寨酒吧的灯：店里一盏暖里带粉的点光、歌词屏前一盏按屏幕字色的弱光、招牌那一角一盏粉色一盏青色的点光
  // （把左排楼面和巷子染上霓虹色）、全息投影一盏青色弱光、大排档一盏暖光、电线杆的街灯一盏朝下的冷白聚光。
  // 地上的光斑用加色贴片：门前一片暖、招牌下粉青两片、全息下一片、档口一片、街灯下一圈。夜里霓虹的颜色映在湿地上。

  /** 灯光等级键（pools 是地上的光斑）。 */
  var LEVEL_KEYS = ['bar', 'screen', 'neon', 'holo', 'stall', 'lamp', 'pools']

  /** 城寨酒吧的灯。constructor(blend, materials, lampHead, stallBulb) */
  function KowloonLights(blend, materials, lampHead, stallBulb) {
    this.group = new THREE.Group()
    this._blend = blend
    this._points = []
    this._pools = []
    this._texture = Actors.createSoftEllipseTexture()
    this._levels = { bar: 1, screen: 1, neon: 1, holo: 1, stall: 1, lamp: 1, pools: 1 }
    this.group.name = 'KowloonLights'
    var self = this
    var point = function (key, intensity, distance, at, source, name) {
      var light = new THREE.PointLight(0xffffff, intensity, distance, 2)
      light.position.copy(at)
      light.name = 'Lights/' + name
      self._points.push({ light: light, key: key, intensity: intensity, source: source })
      self.group.add(light)
    }
    point('barLight', 4.2, 6, new THREE.Vector3((BAR.x0 + BAR.x1) / 2, 2.3, (BAR.back + BAR.glass) / 2 + 0.3), 'bar', 'bar')
    point('boardLit', 2.2, 6, new THREE.Vector3(SCREEN.x, SCREEN.y - 0.6, SCREEN.z + 1.6), 'screen', 'screen')
    point('neonPink', 3.6, 6.5, new THREE.Vector3(-2.4, 4.3, 1.4), 'neon', 'neonPink')
    point('neonCyan', 2.6, 5.5, new THREE.Vector3(-1.7, 4.9, -0.9), 'neon', 'neonCyan')
    point('holo', 1.6, 4, new THREE.Vector3(HOLOGRAM.x, HOLOGRAM.y - 0.3, HOLOGRAM.z + 0.3), 'holo', 'holo')
    point('interiorLight', 3.0, 4.5, stallBulb.clone().add(new THREE.Vector3(0, -0.1, 0)), 'stall', 'stall')
    this._lamp = new THREE.SpotLight(0xffffff, 20, 9, 0.85, 0.6, 2)
    this._lamp.name = 'Lights/lamp'
    this._lamp.position.copy(lampHead)
    this._lamp.target.position.set(lampHead.x - 0.25, 0, lampHead.z + 0.1)
    // 满城霓虹映在墙上的一层底光（夜里才有）。
    this._glow = new THREE.AmbientLight(0xffffff, 0)
    this._glow.name = 'Lights/cityGlow'
    this.group.add(this._lamp, this._lamp.target, this._glow)

    var pool = function (key, level, source, size, at) {
      var material = materials.track(new THREE.MeshBasicMaterial({ color: 0xffffff, map: self._texture, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }))
      var geometry = new THREE.PlaneGeometry(size[0], size[1]).rotateX(-Math.PI / 2)
      var result = new THREE.Mesh(geometry, material)
      result.position.set(at[0], LEVEL.ground + 0.008, at[1])
      result.renderOrder = 1
      result.name = 'Pool/' + source
      self._pools.push({ mesh: result, material: material, key: key, level: level, source: source })
      self.group.add(result)
    }
    pool('barLight', 0.34, 'bar', [4.8, 2.4], [(BAR.x0 + BAR.x1) / 2, BAR.front + 1.0])
    pool('neonPink', 0.3, 'neon', [3.6, 4.2], [-2.3, 1.4])
    pool('neonCyan', 0.22, 'neon', [2.6, 2.4], [-1.6, -0.6])
    pool('holo', 0.26, 'holo', [2.4, 1.8], [HOLOGRAM.x, HOLOGRAM.z + 0.2])
    pool('interiorLight', 0.32, 'stall', [2.6, 2.4], [(STALL.x0 + STALL.x1) / 2, STALL.z1 + 0.7])
    pool('lampCool', 0.4, 'lamp', [3.0, 3.0], [lampHead.x - 0.25, lampHead.z + 0.1])
    this.sync()
  }

  KowloonLights.prototype.setLevels = function (levels) {
    var previous = this._levels
    var same = LEVEL_KEYS.every(function (key) { return previous[key] === levels[key] })
    if (same) return
    this._levels = levels
    this.sync()
  }

  KowloonLights.prototype.sync = function () {
    var self = this
    var levels = this._levels
    this._points.forEach(function (item) {
      item.light.color.copy(self._blend.get(item.key))
      item.light.intensity = item.intensity * levels[item.source]
    })
    this._glow.color.copy(this._blend.get('cityGlow'))
    this._glow.intensity = 1.1 * levels.neon * levels.pools
    this._lamp.color.copy(this._blend.get('lampCool'))
    this._lamp.intensity = 20 * levels.lamp
    this._pools.forEach(function (item) {
      item.material.color.copy(self._blend.get(item.key)).multiplyScalar(item.level * levels[item.source] * levels.pools)
    })
  }

  KowloonLights.prototype.dispose = function () {
    this._pools.forEach(function (pool) { pool.mesh.geometry.dispose() })
    this._texture.dispose()
  }

  // ===== kowloonScene.ts =====
  // 场景入口：装配整条巷子。另见文件头注释。

  var KOWLOON_ART = {
    wallA: '#6b6660',
    wallB: '#7a6e62',
    wallC: '#5d666e',
    wallD: '#857a6b',
    wallE: '#6e6a73',
    slab: '#4c4a47',
    stain: '#3f3a36',
    windowFrame: '#383c43',
    windowDark: '#1c222b',
    cage: '#5a6068',
    rust: '#7a4a33',
    ac: '#c6c4bb',
    acGrille: '#55595e',
    pipe: '#666a70',
    bamboo: '#b9a06a',
    plant: '#4f8a46',
    roofTar: '#3a393b',
    tank: '#557282',
    antenna: '#2b2f35',
    shutter: '#8d9095',
    shutterDark: '#62656a',
    drain: '#1d2026',
    barFrame: '#25222a',
    barFloor: '#2a2426',
    barWall: '#2d2533',
    counter: '#3b2620',
    counterTop: '#6b4a3a',
    chrome: '#aab1b9',
    stool: '#c2384a',
    jukebox: '#8a2f3c',
    signBox: '#1d1a22',
    screenFrame: '#26282d',
    stallGreen: '#2e6a55',
    tarpRed: '#c8423a',
    tarpWhite: '#efe9df',
    table: '#d9d3c5',
    plastic: '#d23a3a',
    stoolBlue: '#2f6fc0',
    crate: '#8a6a45',
    crateBlue: '#2f6fb0',
    scooterA: '#c43c3c',
    scooterB: '#e3dfd2',
    bag: '#22282a',
    gas: '#c9452f',
    holoBase: '#2b2f36',
    neonPink: '#ff4fb0',
    neonCyan: '#3fe8ff',
    neonAmber: '#ffb547',
    shopGlow: '#d6ecff',
    cafeLight: '#ffd2a0',
    cityGlow: '#5a4688',
    pharmacy: '#c9ffe0',
    tube: '#c8f4ff',
    lampCool: '#e2f2ff'
  }

  /** 场景自己的颜色表（纯函数）。 */
  function resolveKowloonArt(_theme, _seed, base) {
    var art = Object.assign({}, KOWLOON_ART)
    // 酒架的背光跟主题走；店里的灯暖里带粉；全息是青色，向主题的 LED 色偏一点。
    art.barBack = PaletteMod.vivid(base.brand[0], 0.7, 0.55, 0.66)
    art.barLight = ColorMath.mixHexColors('#ff9fd0', base.interiorLight, 0.45)
    art.holo = ColorMath.mixHexColors('#62f2ff', base.led, 0.3)
    return art
  }

  var KOWLOON_GLOWS = {
    barBacklight: { key: 'barBack', level: 1.2 },
    barStrip: { key: 'neonCyan', level: 1.6 },
    barWindow: { key: 'barLight', level: 0.9 },
    pendant: { key: 'interiorLight', level: 2.0 },
    jukebox: { key: 'neonAmber', level: 1.5 },
    shopGlow: { key: 'shopGlow', level: 0.72 },
    cafe: { key: 'cafeLight', level: 0.8 },
    stripPink: { key: 'neonPink', level: 1.3 },
    stripCyan: { key: 'neonCyan', level: 1.3 },
    pharmacy: { key: 'pharmacy', level: 0.72 },
    shopWarm: { key: 'interiorLight', level: 0.9 },
    tube: { key: 'tube', level: 1.5 },
    stallBulb: { key: 'interiorLight', level: 2.6 },
    lampHead: { key: 'lampCool', level: 3.0 },
    vending: { key: 'vendingLight', level: 0.75 },
    holoLens: { key: 'holo', level: 2.2 }
  }

  /** 屋顶（雨停在上面、下面不积雪）：最多 4 块，几栋楼并成一块，高度取那几栋里最矮的。 */
  function kowloonRoofs() {
    var span = function (names) {
      var blocks = names.map(blockOf)
      return {
        x0: Math.min.apply(null, blocks.map(function (block) { return block.x0 })),
        z0: Math.min.apply(null, blocks.map(function (block) { return block.z0 })),
        x1: Math.min.apply(null, blocks.map(function (block) { return block.x1 })),
        z1: Math.max.apply(null, blocks.map(function (block) { return block.z1 })),
        y: Math.min.apply(null, blocks.map(function (block) { return block.height }))
      }
    }
    return [
      span(['L0', 'L1', 'L2']),
      span(['L3', 'L4', 'L5']),
      Object.assign(span(['B0', 'B0b']), { x0: -3.0, x1: -0.3, z1: -2.05 }),
      span(['B1'])
    ]
  }

  /** 夜里程度：白天程度 0.65 以上是 0，0.2 以下是 1。 */
  function smoothNight(daylight) {
    var t = Math.min(1, Math.max(0, (0.65 - daylight) / 0.45))
    return t * t * (3 - 2 * t)
  }

  /** 城寨酒吧场景。constructor(context) */
  function KowloonScene(context) {
    var materials = context.materials
    var blend = context.blend
    var geometryCache = context.geometryCache
    this._context = context
    this.root = new THREE.Group()
    this.reflectionPlaneY = LEVEL.ground
    this.focusPoint = new THREE.Vector3(SCREEN.x, SCREEN.y, SCREEN.z)
    this.rebuildsForSeed = true
    var seed = context.song.seed
    var random = SeedHash.createVisualizerRng('kowloon:' + seed)
    materials.defineGlows(KOWLOON_GLOWS)
    this.root.name = 'Kowloon'
    var built = withGeometryCache(geometryCache, function () {
      var streetBuilt = buildKowloonStreet(materials, seed)
      return {
        street: streetBuilt,
        blocks: buildKowloonBlocks(materials, seed, kowloonWindowAvoid(), streetBuilt.signBoxes.concat([kowloonScreenFront()]), streetBuilt.footing),
        bar: buildKowloonBar(materials, seed)
      }
    })
    var street = built.street
    var blocks = built.blocks
    var bar = built.bar
    this._windows = blocks.litWindows
    this._world = new THREE.Group()
    this._world.name = 'Kowloon/world'
    this._world.add(street.group, blocks.group, bar.group)
    // 亮的东西进倒影图层（湿地上映得出霓虹、窗、屏幕）；楼身当遮挡（倒影镜头里是全黑的）。
    this._world.traverse(function (object) {
      if (!(object instanceof THREE.Mesh) || Array.isArray(object.material)) return
      var isGlow = object.material.name.indexOf('machi:glow') === 0
      var isOccluder = object.name === 'Body' || object.name.indexOf('Sign') === 0
      if (isGlow || isOccluder) object.layers.enable(MACHI_REFLECT_LAYER)
    })
    this.surfaces = { road: [], lot: [street.surface] }
    this.puddles = { offset: [random() * 80 - 40, random() * 80 - 40], amount: 0.5 + random() * 0.25 }
    bakeStatic(this._world)

    this._signs = new Paint.KowloonSigns(materials, blend, {
      screen: { position: new THREE.Vector3(SCREEN.x, SCREEN.y, SCREEN.z), rotationY: 0, width: SCREEN.width, height: SCREEN.height },
      ticker: { position: new THREE.Vector3(TICKER.x, TICKER.y, TICKER.z), rotationY: 0, width: TICKER.width, height: TICKER.height },
      barSign: { position: new THREE.Vector3(BAR_SIGN.x, BAR_SIGN.y, BAR_SIGN.z), rotationY: 0, width: BAR_SIGN.width, height: BAR_SIGN.height },
      boards: street.signs,
      hologram: {
        base: new THREE.Vector3(HOLOGRAM.x, 0.27, HOLOGRAM.z),
        panel: { position: new THREE.Vector3(HOLOGRAM.x, HOLOGRAM.y, HOLOGRAM.z), rotationY: HOLOGRAM.rotationY, width: HOLOGRAM.width, height: HOLOGRAM.height }
      }
    }, seed)
    this._signs.group.traverse(function (object) {
      if (object instanceof THREE.Mesh) object.layers.enable(MACHI_REFLECT_LAYER)
    })
    this._lights = new KowloonLights(blend, materials, street.lampHead, street.stallBulb)
    this._steam = new Lights.MachiSteam(materials, blend, [
      { position: street.wok, puffs: 5, period: 2.6, size: 0.45 },
      { position: street.manhole.clone().setY(LEVEL.ground + 0.02), puffs: 6, period: 4.4, size: 0.85 }
    ])
    this._lightCones = new Lights.MachiLightCones(materials, blend, [
      { apex: street.lampHead, target: new THREE.Vector3(street.lampHead.x - 0.25, LEVEL.ground, street.lampHead.z + 0.1), radius: 1.3, gain: 1 }
    ], 'lampCool')
    this.root.add(this._world, this._signs.group, this._lights.group, this._steam.mesh, this._lightCones.mesh)

    // 滴水：冷气机、大排档的帆布篷前沿、酒吧门头。
    var drips = blocks.drips.slice()
    var x
    for (x = STALL.x0; x <= STALL.x1 + 0.1; x += 0.45) {
      drips.push({ x: x + (random() - 0.5) * 0.1, z: STALL.z1 + 0.62, from: 1.95, to: LEVEL.ground, period: 1.0 + random() * 1.4, phase: random() })
    }
    for (x = BAR_SIGN.x - BAR_SIGN.width / 2; x < BAR_SIGN.x + BAR_SIGN.width / 2; x += 0.6) {
      drips.push({ x: x + random() * 0.2, z: BAR.front + 0.12, from: BAR_SIGN.y - BAR_SIGN.height / 2 - 0.08, to: LEVEL.ground, period: 1.3 + random() * 1.8, phase: random() })
    }
    this.weather = {
      half: MACHI_BASE.half,
      groundY: LEVEL.ground,
      roofs: kowloonRoofs(),
      drips: drips,
      // 落进灯光里的雨丝被照亮：招牌那一角、酒吧门前、街灯下。
      glints: [
        { position: new THREE.Vector3(-2.0, 3.0, 1.0), radius: 2.0 },
        { position: new THREE.Vector3(SCREEN.x, 1.9, BAR.front + 1.0), radius: 2.0 },
        { position: new THREE.Vector3(street.lampHead.x - 0.25, 2.6, street.lampHead.z + 0.1), radius: 1.6 }
      ],
      windYaw: (random() - 0.5) * 1.2,
      windSlant: 0.06 + random() * 0.12
    }
    this.framing = { points: kowloonFramingPoints(), view: Object.assign({}, KOWLOON_VIEW) }
    // 雾里的两处灯：招牌那一角、酒吧门前。
    this._glowA = new THREE.Vector4(-2.0, 0, 1.0, 3.4)
    this._glowB = new THREE.Vector4(SCREEN.x, 0, BAR.front + 0.8, 3.0)
    this.syncColors()
    context.invalidateShadows()
  }

  KowloonScene.prototype.setContent = function (content) {
    this._signs.setContent(content)
  }

  /** 换歌（seed 不变）：只重画招牌；seed 变了运行时会重建整个场景（rebuildsForSeed）。 */
  KowloonScene.prototype.swapSong = function (_song, content) {
    this.setContent(content)
  }

  KowloonScene.prototype.direct = function (frame) {
    var songTime = frame.songTime
    var ambientTime = frame.ambientTime
    var chorus = frame.chorus
    var staticMode = frame.staticMode
    var environment = frame.environment
    var look = frame.look
    if (frame.targetChanged) this._signs.showBoard(frame.target, frame.lines, frame.immediate, frame.showText)
    else if (frame.preheat) this._signs.preheat(frame.preheat, frame.lines, frame.showText)
    var daylight = environment.daylight
    var night = 1 - daylight
    var lampFlicker = staticMode ? 1 : Director.resolveMachiFlicker(ambientTime + 4.2, frame.seed + ':lamp', 0.45)
    var tubeFlicker = staticMode ? 1 : Director.resolveMachiFlicker(ambientTime + 0.6, frame.seed + ':tube', 2.2)
    var lamp = look.streetLamps * (0.75 + 0.25 * lampFlicker)
    // 霓虹随拍（智能动感模式）：店里的灯（连同它投在地上的光斑）、亮窗跟着小节慢慢涨落；粉、青两条霓虹灯带是第二、三组，
    // 照到四周的霓虹光与雾里的灯晕跟三组的平均；地面干时光斑跟鼓点跳（城寨的环境光按光斑的亮度走，也跟着跳）。
    var beat = frame.beat
    var artificial = look.artificial * beat.warm
    var neon = (0.25 + 0.75 * night) * (0.85 + 0.15 * frame.flicker)
    this._lights.setLevels({
      bar: artificial * (1 + 0.1 * chorus),
      screen: (1 - 0.8 * daylight) * (1 + 0.2 * chorus),
      neon: neon * beat.neon,
      holo: 1 - 0.85 * daylight,
      stall: 0.3 + 0.7 * look.streetLamps,
      lamp: lamp,
      pools: (1 - 0.85 * daylight) * (1 + beat.thump)
    })
    var materials = this._context.materials
    materials.setGlowLevel('barBacklight', artificial * (1 + 0.15 * chorus))
    materials.setGlowLevel('barStrip', artificial)
    materials.setGlowLevel('barWindow', artificial)
    materials.setGlowLevel('pendant', artificial)
    materials.setGlowLevel('jukebox', artificial * (0.65 + 0.6 * frame.audio))
    materials.setGlowLevel('shopGlow', artificial)
    materials.setGlowLevel('cafe', artificial)
    materials.setGlowLevel('stripPink', neon * BeatFx.machiNeonGroup(beat, 1))
    materials.setGlowLevel('stripCyan', neon * BeatFx.machiNeonGroup(beat, 2))
    materials.setGlowLevel('pharmacy', artificial)
    materials.setGlowLevel('shopWarm', artificial)
    materials.setGlowLevel('tube', artificial * tubeFlicker * tubeFlicker)
    materials.setGlowLevel('stallBulb', 0.4 + 0.6 * look.streetLamps)
    materials.setGlowLevel('lampHead', 0.15 + 0.85 * look.streetLamps)
    materials.setGlowLevel('vending', artificial)
    materials.setGlowLevel('holoLens', 0.4 + 0.6 * night)
    // 亮着的窗：白天只是一点点亮。
    this._windows.material.color.setScalar((0.28 + 0.6 * smoothNight(daylight)) * beat.warm)
    this._signs.update({
      songTime: songTime,
      ambientTime: ambientTime,
      delta: frame.delta,
      staticMode: staticMode,
      chorus: chorus,
      audio: frame.audio,
      flicker: frame.flicker,
      artificial: look.artificial,
      daylight: daylight,
      beat: beat
    })
    this._steam.update(ambientTime, frame.atmosphere.wind)
    this._lightCones.update(ambientTime, lamp * (1 - 0.6 * daylight))
    var atmosphere = frame.atmosphere
    var glow = 1 - 0.85 * daylight
    atmosphere.glowA.copy(this._glowA)
    atmosphere.glowB.copy(this._glowB)
    atmosphere.glowColorA.copy(this._context.blend.get('neonPink')).multiplyScalar(0.42 * neon * beat.neon * glow)
    atmosphere.glowColorB.copy(this._context.blend.get('barLight')).multiplyScalar(0.36 * artificial * glow)
  }

  /** 插值后的颜色写回场景的材质、灯、实例色。 */
  KowloonScene.prototype.syncColors = function () {
    this._context.materials.syncColors()
    this._lights.sync()
    this._steam.syncColors()
    this._lightCones.syncColors()
  }

  Object.defineProperty(KowloonScene.prototype, 'busy', {
    /** 场景里有动画在走（换牌面）：暂停时也要继续出帧。 */
    get: function () { return this._signs.busy }
  })

  KowloonScene.prototype.dispose = function () {
    var geometries = new Set(this._context.geometryCache.values())
    this._world.traverse(function (object) {
      if (object instanceof THREE.Mesh || object instanceof THREE.LineSegments || object instanceof THREE.Points) geometries.add(object.geometry)
    })
    geometries.forEach(function (geometry) { geometry.dispose() })
    this._signs.dispose()
    this._lights.dispose()
    this._steam.dispose()
    this._lightCones.dispose()
    this._context.materials.dispose()
    this.root.removeFromParent()
  }

  /** 场景定义：resolveArt 给场景自己的颜色表，create 装配整个场景。 */
  var KOWLOON_SCENE = {
    resolveArt: resolveKowloonArt,
    create: function (context) { return new KowloonScene(context) }
  }

  // 导出：kowloon 目录全部顶层导出都在这里（paint 拆分文件的那部分从
  // window.FoliaMachiSceneKowloonPaint 合并进来；运行时按 Scenes['kowloon'] 取 KOWLOON_SCENE）。
  window.FoliaMachiSceneKowloon = Object.assign({
    KOWLOON_SCENE: KOWLOON_SCENE,
    // layout.ts
    DEG: DEG,
    LEVEL: LEVEL,
    FLOORS: FLOORS,
    BLOCKS: BLOCKS,
    leftFaceAt: leftFaceAt,
    BAR: BAR,
    BAR_SIGN: BAR_SIGN,
    TICKER: TICKER,
    SCREEN: SCREEN,
    HANGING_SIGNS: HANGING_SIGNS,
    SIGN_DEPTH: SIGN_DEPTH,
    ROOF_BILLBOARD: ROOF_BILLBOARD,
    HOLOGRAM: HOLOGRAM,
    STALL: STALL,
    STALL_TABLE: STALL_TABLE,
    POLE: POLE,
    VENDING: VENDING,
    KOWLOON_VIEW: KOWLOON_VIEW,
    // street.ts
    hangingSignBox: hangingSignBox,
    kowloonWindowAvoid: kowloonWindowAvoid,
    kowloonScreenFront: kowloonScreenFront,
    buildKowloonStreet: buildKowloonStreet,
    kowloonFramingPoints: kowloonFramingPoints,
    // blocks.ts
    buildKowloonBlocks: buildKowloonBlocks,
    // bar.ts
    buildKowloonBar: buildKowloonBar,
    // kowloonLights.ts
    KowloonLights: KowloonLights,
    // kowloonScene.ts 的内部常量（上游未导出，挂出便于排查与复用）
    KOWLOON_ART: KOWLOON_ART,
    KOWLOON_GLOWS: KOWLOON_GLOWS,
    resolveKowloonArt: resolveKowloonArt
  }, window.FoliaMachiSceneKowloonPaint)
})()
