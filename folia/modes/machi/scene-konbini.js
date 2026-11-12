// 便利店（konbini）场景（移植自 folia-major scenes/konbini/，源文件 layout.ts + konbiniSeed.ts + base.ts +
// interior.ts + store.ts + props.ts + konbiniDoor.ts + konbiniLights.ts + konbiniScene.ts；招牌画法与招牌装配在
// scene-konbini-paint.js，因总行数超限拆出）：
// 便利店街角（原来的雨町）：两条路在前右角相交，店占后左象限，屋顶三面广告屏逐字点亮当前行，店招 LED 滚下一句，
// 店招写曲名、海报写歌手、门口のぼり旗。会动的：段落开头自动门开合、空调风扇、偶尔开过的车、旗、井盖和外机的白气、
// 路灯光柱。按歌变的：自行车、伞、海报版式、风向、水洼、开门节奏（konbiniSeed）。
// 全部顶层导出挂在 window.FoliaMachiSceneKonbini 上；宿主把它里面的 KONBINI_SCENE
// 登记进 window.FoliaMachiScenes.konbini（见 machi-runtime.js 的 Scenes 表）。
(function () {
  'use strict'

  var THREE = window.THREE
  var Geometry = window.FoliaMachiGeometry
  var SeedHash = window.FoliaSeedHash
  var ColorMath = window.FoliaThemeColorMath
  var PaletteMod = window.FoliaMachiPalette
  var Actors = window.FoliaMachiActors
  var Lights = window.FoliaMachiLights
  var Director = window.FoliaMachiDirector
  var BeatFx = window.FoliaMachiBeatFx
  var Reflection = window.FoliaMachiReflection
  var RenderHints = window.FoliaRenderHints

  // 常用几何工具解构（来自 machi-geometry.js）。
  var group = Geometry.group
  var mesh = Geometry.mesh
  var roundedBox = Geometry.roundedBox
  var boxAt = Geometry.boxAt
  var boxSpan = Geometry.boxSpan
  var cylinderAt = Geometry.cylinderAt
  var tubeBetween = Geometry.tubeBetween
  var sagWire = Geometry.sagWire
  var bakeStatic = Geometry.bakeStatic
  var buildMachiPlinth = Geometry.buildMachiPlinth
  var machiSurface = Geometry.machiSurface
  var withGeometryCache = Geometry.withGeometryCache

  var REFLECT_LAYER = Reflection.MACHI_REFLECT_LAYER

  // ===== layout.ts =====
  // 便利店街角的尺寸表（米，原点在底座中心，y 向上，+z 是前、+x 是右）。几何、灯、天气、招牌、镜头都按这里摆，
  // 改一处尺寸不用到处找。人体尺度按真实（门 2.1m、货架 1.5m、冰柜 2m、贩卖机 1.8m），店面按微缩压缩。

  var DEG = Math.PI / 180

  /** 底座：12m 见方、0.6m 厚，顶面就是路面。 */
  var BASE = { half: 6, depth: 0.6, radius: 0.12 }

  /** 各层地面的高度。 */
  var LEVEL = { road: 0, lot: 0.12, floor: 0.16 }

  /** 两条路：前面（+z）一条沿 x，右面（+x）一条沿 z，在前右角相交；路外侧各有一条窄人行道到底座边。 */
  var ROAD = { inner: 2.2, outer: 5.5, curbWidth: 0.16, edgeLineInset: 0.24 }

  /** 便利店：占后左象限；前面、右面前段是落地玻璃，右面后段和后墙、左墙是实墙。 */
  var STORE = {
    x0: -5.4,
    x1: 0.8,
    z0: -5.4,
    z1: 0.4,
    wall: 0.18,
    wallHeight: 3.2,
    roofTop: 3.42,
    parapetTop: 3.62,
    overhang: 0.12,
    /** 右面玻璃到这里为止，往后是实墙（后场、贩卖机靠着它）。 */
    rightGlassEnd: -2.6,
    /** 前面左端的实墙垛。 */
    frontPillarEnd: -4.6,
    glassBottom: 0.24,
    glassTop: 2.5
  }

  /** 自动门（前面靠右，两扇对开）。 */
  var DOOR = { x0: -1.3, x1: 0.5, height: 2.2, panelWidth: 0.92, slide: 0.86 }

  /** 店招带：绕前面与右面一圈，挂在玻璃上沿与屋顶之间。 */
  var FASCIA = { y0: 2.6, y1: 3.28, depth: 0.16 }

  /** 屋顶的三面广告塔：三角柱，一面正对默认视线，另两面在 ±120°；转到限角边上时侧面接手。 */
  var BOARD = {
    cx: -2.2,
    cz: -2.65,
    faceWidth: 5.6,
    faceHeight: 2.3,
    y0: 4.0,
    /** 正面法线的方位角（与默认镜头一致）。 */
    azimuth: 45 * DEG
  }

  /** 默认视角：从前右斜俯视（方位角按 three 的球坐标，从 +z 转向 +x）；整座底座框进去是缩放 1，默认再拉近一些。 */
  var KONBINI_VIEW = { azimuth: 45 * DEG, elevation: 31 * DEG, zoom: 1.58 }

  /** 道具的位置。 */
  var PROPS = {
    utilityPole: { x: -5.3, z: 1.96, height: 7.6 },
    streetLamp: { x: 5.74, z: -1.2, height: 5.2, arm: 1.3 },
    pylon: { x: 1.62, z: -5.4, height: 4.6 },
    curveMirror: { x: -1.2, z: 5.74, height: 2.7 },
    stopSign: { x: 1.95, z: 5.74, height: 2.4 },
    vending: { x: 0.82, z: [-3.25, -4.3], width: 1.0, depth: 0.74, height: 1.83 },
    bikeSlots: [{ x: -4.5, z: 1.32 }, { x: -2.85, z: 1.36 }],
    trash: { x: -3.55, z: 0.68 },
    umbrellaStand: { x: -1.62, z: 0.68 },
    aFrame: { x: 0.95, z: 1.15 },
    groundAc: { x: -5.7, z: [-2.0, -3.1] },
    roofAc: [{ x: -0.1, z: -4.75 }, { x: -4.85, z: -0.35 }]
  }

  /** 底座顶面上，雨能落到的高度：店顶上是屋顶，店外是地面（路面或人行道）。 */
  function groundHeightAt(x, z) {
    if (x >= STORE.x0 - STORE.overhang && x <= STORE.x1 + STORE.overhang && z >= STORE.z0 - STORE.overhang && z <= STORE.z1 + STORE.overhang) {
      return STORE.roofTop
    }
    var onRoad = (x > ROAD.inner && x < ROAD.outer) || (z > ROAD.inner && z < ROAD.outer)
    return onRoad ? LEVEL.road : LEVEL.lot
  }

  // ===== paragraphStructure.ts（konbiniDoor 需要的分段函数，随场景带一份） =====
  // 歌词分段：空隙中位数 × 2.5 定阈值、元数据变化切段、超限段落在最大空隙处切开（左半部分也继续切）。
  // 上游 tempera / sonnet 的分段函数是模块私有的，所以这里带一份（与 lumiere-program.js 的移植一致）。

  var DEFAULT_PARAGRAPH_STRUCTURE_PARAMS = {
    /** 段落切分阈值 = 相邻行空隙中位数 × gapMultiplier，钳在 [gapMin, gapMax] 秒。 */
    gapMultiplier: 2.5, gapMin: 1.25, gapMax: 3.5,
    /** 超过行数或时长的段落在最大空隙处切开。 */
    maxLines: 6, maxDuration: 18,
    /** 超限段落的左半部分也继续切。 */
    recursiveSplit: true
  }

  function clampNumber(value, min, max) { return Math.min(max, Math.max(min, value)) }

  function medianOf(values) {
    if (values.length === 0) return 0.5
    var sorted = values.slice().sort(function (a, b) { return a - b })
    var middle = Math.floor(sorted.length / 2)
    return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle]
  }

  /** 编译用的行：视觉结束时间可以超出 endTime，但不越过下一行开始。StructureLine = { sourceIndex, line, renderEndTime }。 */
  function buildStructureLines(lines) {
    return lines.map(function (line, sourceIndex) {
      var next = lines[sourceIndex + 1]
      return {
        sourceIndex: sourceIndex,
        line: line,
        renderEndTime: Math.max(line.startTime, Math.min(RenderHints.getLineRenderEndTime(line), next ? next.startTime : Number.POSITIVE_INFINITY))
      }
    })
  }

  function resolveParagraphGapThreshold(lines, params) {
    params = params || DEFAULT_PARAGRAPH_STRUCTURE_PARAMS
    var gaps = lines.slice(1).map(function (line, index) {
      return line.startTime - Math.min(RenderHints.getLineRenderEndTime(lines[index]), line.startTime)
    }).filter(function (gap) { return gap > 0 })
    return clampNumber(medianOf(gaps) * params.gapMultiplier, params.gapMin, params.gapMax)
  }

  function metadataChanged(previous, next) {
    return (previous.blockIndex !== undefined && next.blockIndex !== undefined && previous.blockIndex !== next.blockIndex)
      || (previous.songPart !== undefined && next.songPart !== undefined && previous.songPart !== next.songPart)
  }

  /** 超过行数或时长的段落在最大空隙处切开；recursiveSplit 时左半部分也继续切。 */
  function splitOversizedDraft(draft, params) {
    var output = []
    var remaining = draft.lines
    var boundary = draft.boundary
    var loopGuard = 0
    while (remaining.length > params.maxLines || (remaining.length > 1 && (remaining[remaining.length - 1].renderEndTime - remaining[0].line.startTime) > params.maxDuration)) {
      if (loopGuard++ > 1000) break
      var candidates = remaining.slice(2, -1).map(function (line, offset) {
        return { splitIndex: offset + 2, gap: line.line.startTime - remaining[offset + 1].renderEndTime }
      })
      var validCandidates = candidates.filter(function (candidate) { return !Number.isNaN(candidate.gap) })
      var best = validCandidates.sort(function (a, b) { return b.gap - a.gap })[0]
      var rawSplitIndex = best ? best.splitIndex : Math.min(4, remaining.length - 1)
      var splitIndex = Math.max(1, rawSplitIndex)
      var head = { lines: remaining.slice(0, splitIndex), boundary: boundary }
      if (params.recursiveSplit) output.push.apply(output, splitOversizedDraft(head, params))
      else output.push(head)
      remaining = remaining.slice(splitIndex)
      boundary = output[output.length - 1].lines.length >= params.maxLines ? 'line-cap' : 'duration-cap'
    }
    output.push({ lines: remaining, boundary: boundary })
    return output
  }

  /** 自动分段：元数据变化或空隙超过阈值处切开，再按上限切开超长的段落。ParagraphDraft = { lines, boundary }。 */
  function draftParagraphs(lines, threshold, params) {
    params = params || DEFAULT_PARAGRAPH_STRUCTURE_PARAMS
    var drafts = []
    var current = { lines: [], boundary: 'song-start' }
    lines.forEach(function (line, index) {
      var previous = lines[index - 1]
      var gap = previous ? line.line.startTime - previous.renderEndTime : 0
      var boundary = previous && metadataChanged(previous.line, line.line)
        ? 'metadata'
        : (previous && gap >= threshold ? 'time-gap' : null)
      if (boundary && current.lines.length > 0) {
        drafts.push.apply(drafts, splitOversizedDraft(current, params))
        current = { lines: [], boundary: boundary }
      }
      current.lines.push(line)
    })
    if (current.lines.length > 0) drafts.push.apply(drafts, splitOversizedDraft(current, params))
    return drafts
  }

  // ===== konbiniSeed.ts =====
  // 便利店按歌变的小东西：同一首歌每次都一样，换一首歌街角就换个样子（车停在哪、有没有第二辆、伞、海报版式、
  // 风向、水洼的位置、开门的节奏）。只依赖 seed，不碰 three。

  /** seed → 这首歌的街角变化。KonbiniVariation = { bikeSlot, secondBike, bikeYaw, umbrellaInStand, openUmbrella, posterLayout, windYaw, windSlant, puddleOffset, puddleAmount, doorPhase, doorInterval, fanSpeed, shelfSeed } */
  function resolveKonbiniVariation(seed) {
    var random = SeedHash.createVisualizerRng('machi:' + seed)
    var pick = function (min, max) { return min + (max - min) * random() }
    return {
      // 第一辆自行车的车位（0 靠左、1 靠门），以及有没有第二辆。
      bikeSlot: random() < 0.5 ? 0 : 1,
      secondBike: random() < 0.45,
      // 自行车朝向的轻微偏角（弧度）。
      bikeYaw: pick(-0.12, 0.12),
      // 门口伞架里有没有伞、地上有没有一把撑开晾着的伞。
      umbrellaInStand: random() < 0.75,
      openUmbrella: random() < 0.35,
      // 玻璃海报版式 0..2。
      posterLayout: Math.floor(random() * 3),
      // 雨的风向偏角（弧度，绕 y）与倾斜量（每米下落的水平位移）。
      windYaw: pick(-0.6, 0.6),
      windSlant: pick(0.06, 0.2),
      // 水洼噪声的平移，让每首歌的水洼长在不同地方。
      puddleOffset: [pick(-40, 40), pick(-40, 40)],
      // 水洼覆盖量 0..1。
      puddleAmount: pick(0.45, 0.75),
      // 间奏里偶尔开门的相位与间隔（秒）。
      doorPhase: pick(0, 1),
      doorInterval: pick(22, 40),
      // 空调外机风扇转速（圈 / 秒）。
      fanSpeed: pick(1.6, 3.2),
      // 商品摆放的打乱种子。
      shelfSeed: Math.floor(random() * 0xffffffff)
    }
  }

  // ===== konbiniDoor.ts =====
  // 便利店的自动门什么时候开（纯函数）：段落开头像有人进店，长间奏里按这首歌的节奏偶尔开。跟歌曲时间走，拖进度也对得上。

  /** 自动门开合的几个时段（秒）。 */
  var KONBINI_DOOR_TIMING = { open: 0.75, hold: 2.6, close: 1.0, lead: 0.7 }
  var DOOR_CYCLE = KONBINI_DOOR_TIMING.open + KONBINI_DOOR_TIMING.hold + KONBINI_DOOR_TIMING.close

  /**
   * 开门时刻（歌曲时间，秒）：每个段落开头（第一段除外）提前一点开门，像有人进店；段落之间空了很久时，
   * 空隙里按这首歌的节奏再开几次。
   */
  function buildKonbiniDoorEvents(lines, variation) {
    var sung = lines.filter(function (line) { return !Director.isInterludeLine(line) && line.fullText.trim() })
    if (sung.length === 0) return []
    var structure = buildStructureLines(sung)
    var drafts = draftParagraphs(structure, resolveParagraphGapThreshold(sung))
    var events = []
    drafts.forEach(function (draft, index) {
      if (index === 0) return
      var start = draft.lines[0].line.startTime
      events.push(Math.max(0, start - KONBINI_DOOR_TIMING.lead))
    })
    // 长空隙（前奏、间奏、尾奏）里按间隔补几次。
    var gaps = [[0, sung[0].startTime]]
    for (var i = 1; i < sung.length; i += 1) gaps.push([RenderHints.getLineRenderEndTime(sung[i - 1]), sung[i].startTime])
    gaps.forEach(function (gap) {
      var from = gap[0]
      var to = gap[1]
      if (to - from < variation.doorInterval * 0.6) return
      for (var t = from + variation.doorInterval * (0.35 + variation.doorPhase * 0.4); t < to - DOOR_CYCLE; t += variation.doorInterval) {
        events.push(t)
      }
    })
    return events.sort(function (a, b) { return a - b }).filter(function (time, index, all) {
      return index === 0 || time - all[index - 1] >= DOOR_CYCLE
    })
  }

  var easeOutCubic = function (t) { return 1 - (1 - t) * (1 - t) * (1 - t) }
  var easeInOutCubic = function (t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2 }

  /**
   * 门开了多少（0 关、1 全开）。有歌词的歌按开门时刻表；纯音乐按 seed 的节奏周期性开。speed 是主题动效强度。
   * variation 用 { doorInterval, doorPhase }。
   */
  function resolveKonbiniDoorOpenness(events, time, variation, instrumental) {
    var since = Infinity
    if (instrumental || events.length === 0) {
      var phase = time / variation.doorInterval + variation.doorPhase
      since = (phase - Math.floor(phase)) * variation.doorInterval
    } else {
      for (var i = events.length - 1; i >= 0; i -= 1) {
        if (events[i] <= time) {
          since = time - events[i]
          break
        }
      }
    }
    var open = KONBINI_DOOR_TIMING.open
    var hold = KONBINI_DOOR_TIMING.hold
    var close = KONBINI_DOOR_TIMING.close
    if (since < 0 || since >= open + hold + close) return 0
    if (since < open) return easeOutCubic(since / open)
    if (since < open + hold) return 1
    return 1 - easeInOutCubic((since - open - hold) / close)
  }

  // ===== base.ts =====
  // 底座 Group "Base"：分层的微缩台座（沥青面、碎石层、土层、深色底框），两条路、路缘、店前的混凝土场地、
  // 路对面的窄人行道、两组斑马线和路边线（InstancedMesh）、井盖、排水沟盖板。
  // 路面与场地的顶面单独做成薄板（Base/Surfaces），湿路面材质在第三阶段换上去。

  /** 店前场地与路对面人行道：抬高的混凝土板，四边是路缘石。 */
  function buildLots(materials) {
    var h = BASE.half
    var slabs = [
      [-h, ROAD.inner, -h, ROAD.inner],
      [ROAD.outer, h, -h, ROAD.inner],
      [-h, ROAD.inner, ROAD.outer, h],
      [ROAD.outer, h, ROAD.outer, h]
    ]
    var concrete = materials.toon('concrete')
    var curb = materials.toon('curb')
    var parts = []
    slabs.forEach(function (slab, index) {
      parts.push(boxSpan(concrete, slab[0] + 0.002, slab[1] - 0.002, LEVEL.road, LEVEL.lot - 0.004, slab[2] + 0.002, slab[3] - 0.002, { radius: 0.01, name: 'Lot/slab' + index }))
    })
    // 路缘石：贴着路的那几条边，比场地略高一点点。
    var c = ROAD.curbWidth
    var curbTop = LEVEL.lot + 0.012
    var curbs = [
      [-h, ROAD.inner, ROAD.inner - c, ROAD.inner],
      [ROAD.inner - c, ROAD.inner, -h, ROAD.inner],
      [ROAD.outer, h, ROAD.inner - c, ROAD.inner],
      [ROAD.outer, ROAD.outer + c, -h, ROAD.inner],
      [-h, ROAD.inner, ROAD.outer, ROAD.outer + c],
      [ROAD.inner - c, ROAD.inner, ROAD.outer, h],
      [ROAD.outer, h, ROAD.outer, ROAD.outer + c],
      [ROAD.outer, ROAD.outer + c, ROAD.outer, h]
    ]
    curbs.forEach(function (curbSpan, index) {
      parts.push(boxSpan(curb, curbSpan[0], curbSpan[1], LEVEL.road, curbTop, curbSpan[2], curbSpan[3], { radius: 0.02, name: 'Lot/curb' + index }))
    })
    return group.apply(null, ['Base/Lots'].concat(parts))
  }

  /** 斑马线、路边线、停止线：同一种白漆，一个 InstancedMesh。 */
  function buildRoadPaint(materials) {
    var h = BASE.half
    var bars = []
    // 前路上的斑马线：横跨道路，条纹沿 x，间隔沿 z。
    var crossA = { x0: 0.15, x1: 1.95 }
    for (var z = ROAD.inner + 0.42; z < ROAD.outer - 0.3; z += 0.8) {
      bars.push({ x: (crossA.x0 + crossA.x1) / 2, z: z + 0.2, w: crossA.x1 - crossA.x0, d: 0.4 })
    }
    // 右路上的斑马线。
    var crossB = { z0: -0.95, z1: 0.85 }
    for (var x = ROAD.inner + 0.42; x < ROAD.outer - 0.3; x += 0.8) {
      bars.push({ x: x + 0.2, z: (crossB.z0 + crossB.z1) / 2, w: 0.4, d: crossB.z1 - crossB.z0 })
    }
    // 路边线（外侧线），在路口处断开。
    var inset = ROAD.edgeLineInset
    var lineWidth = 0.1
    var frontLineSpans = [[-h, crossA.x0 - 0.3], [crossA.x1 + 0.3, ROAD.inner - 0.1]]
    frontLineSpans.forEach(function (span) {
      var sx0 = span[0]
      var sx1 = span[1]
      bars.push({ x: (sx0 + sx1) / 2, z: ROAD.inner + inset, w: sx1 - sx0, d: lineWidth })
      bars.push({ x: (sx0 + sx1) / 2, z: ROAD.outer - inset, w: sx1 - sx0, d: lineWidth })
    })
    var rightLineSpans = [[-h, crossB.z0 - 0.3], [crossB.z1 + 0.3, ROAD.inner - 0.1]]
    rightLineSpans.forEach(function (span) {
      var sz0 = span[0]
      var sz1 = span[1]
      bars.push({ x: ROAD.inner + inset, z: (sz0 + sz1) / 2, w: lineWidth, d: sz1 - sz0 })
      bars.push({ x: ROAD.outer - inset, z: (sz0 + sz1) / 2, w: lineWidth, d: sz1 - sz0 })
    })
    // 停止线：斑马线前一条粗白线。
    bars.push({ x: crossA.x0 - 0.45, z: (ROAD.inner + ROAD.outer) / 2 + 0.85, w: 0.3, d: (ROAD.outer - ROAD.inner) / 2 - 0.2 })
    bars.push({ x: (ROAD.inner + ROAD.outer) / 2 - 0.85, z: crossB.z0 - 0.45, w: (ROAD.outer - ROAD.inner) / 2 - 0.2, d: 0.3 })

    var geometry = new THREE.PlaneGeometry(1, 1)
    geometry.rotateX(-Math.PI / 2)
    var paint = new THREE.InstancedMesh(geometry, materials.toon('roadPaint'), bars.length)
    paint.name = 'Base/RoadPaint'
    paint.receiveShadow = true
    var matrix = new THREE.Matrix4()
    bars.forEach(function (bar, index) {
      matrix.makeScale(bar.w, 1, bar.d)
      matrix.setPosition(bar.x, LEVEL.road + 0.006, bar.z)
      paint.setMatrixAt(index, matrix)
    })
    return paint
  }

  /** 井盖与排水沟盖板。 */
  function buildRoadFixtures(materials) {
    var darkMetal = materials.toon('darkMetal')
    var parts = []
    var manhole = mesh(new THREE.CylinderGeometry(0.36, 0.36, 0.02, 24), darkMetal, { name: 'Manhole', castShadow: false })
    manhole.position.set(-2.4, LEVEL.road + 0.01, (ROAD.inner + ROAD.outer) / 2 + 0.3)
    parts.push(manhole)
    // 排水沟盖板：沿店前路缘每隔一米一块。
    var grateGeometry = roundedBox(0.7, 0.012, 0.22, 0.004)
    var grates = new THREE.InstancedMesh(grateGeometry, darkMetal, 14)
    grates.name = 'Grates'
    grates.receiveShadow = true
    var matrix = new THREE.Matrix4()
    var count = 0
    for (var x = -5.4; x < ROAD.inner - 0.6 && count < 7; x += 1.1, count += 1) {
      matrix.makeTranslation(x, LEVEL.road + 0.006, ROAD.inner + 0.13)
      grates.setMatrixAt(count, matrix)
    }
    for (var z = -5.4; z < ROAD.inner - 0.6 && count < 14; z += 1.1, count += 1) {
      matrix.makeRotationY(Math.PI / 2)
      matrix.setPosition(ROAD.inner + 0.13, LEVEL.road + 0.006, z)
      grates.setMatrixAt(count, matrix)
    }
    grates.count = count
    parts.push(grates)
    return group.apply(null, ['Base/Fixtures'].concat(parts))
  }

  /** 底座整体：台座 + 场地 + 白漆 + 井盖 + 顶面薄板。返回 { group, roadSurface, lotSurfaces }。 */
  function buildKonbiniBase(materials) {
    var h = BASE.half
    var roadSurface = machiSurface(materials.toon('asphalt'), -h, h, -h, h, LEVEL.road, 'Surface/road')
    var lotSurfaces = [
      machiSurface(materials.toon('concrete'), -h, ROAD.inner - ROAD.curbWidth, -h, ROAD.inner - ROAD.curbWidth, LEVEL.lot, 'Surface/lot'),
      machiSurface(materials.toon('concrete'), ROAD.outer + ROAD.curbWidth, h, -h, ROAD.inner, LEVEL.lot, 'Surface/farRight'),
      machiSurface(materials.toon('concrete'), -h, ROAD.inner, ROAD.outer + ROAD.curbWidth, h, LEVEL.lot, 'Surface/farFront'),
      machiSurface(materials.toon('concrete'), ROAD.outer + ROAD.curbWidth, h, ROAD.outer + ROAD.curbWidth, h, LEVEL.lot, 'Surface/farCorner')
    ]
    var surfaces = group.apply(null, ['Base/Surfaces', roadSurface].concat(lotSurfaces))
    surfaces.userData.dynamic = true
    var base = group.apply(null, [
      'Base',
      buildMachiPlinth(materials),
      buildLots(materials),
      buildRoadPaint(materials),
      buildRoadFixtures(materials),
      surfaces
    ])
    return { group: base, roadSurface: roadSurface, lotSurfaces: lotSurfaces }
  }

  // ===== interior.ts =====
  // 店内 Group "Store/Interior"：两排双面货架与商品、后墙的饮料冰柜与瓶子、收银台（收银机、热食柜）、
  // 窗边杂志架、复印机与 ATM、员工门、天花灯。商品、瓶子、天花灯都是 InstancedMesh，商品色走实例色，
  // 换主题时由运行时按 colorIndex 重写。动线：入口 → 收银台在右 → 两排货架 → 后墙冰柜。

  var SHELF_ROWS = [-1.75, -3.15]
  var SHELF_X = [-4.5, -1.4]
  var SHELF_DEPTH = 0.86
  var SHELF_HEIGHT = 1.45
  var SHELF_LEVELS = [0.12, 0.45, 0.78, 1.1]
  var FRIDGE = { x0: -4.92, x1: -1.32, z0: -5.2, z1: -4.58, height: 2.05, doors: 5 }

  /** 一排双面货架的骨架：底座、中间背板、四层隔板、两头的端板。 */
  function buildGondola(materials, z, index) {
    var shelf = materials.toon('shelf')
    var dark = materials.toon('darkMetal')
    var xa = SHELF_X[0]
    var xb = SHELF_X[1]
    var y = LEVEL.floor
    var half = SHELF_DEPTH / 2
    var parts = [
      boxSpan(dark, xa, xb, y, y + 0.1, z - half, z + half, { radius: 0.015, name: 'Kick' }),
      boxSpan(shelf, xa, xb, y + 0.1, y + SHELF_HEIGHT, z - 0.03, z + 0.03, { radius: 0.01, name: 'Spine' }),
      boxSpan(shelf, xa - 0.04, xa, y, y + SHELF_HEIGHT + 0.05, z - half, z + half, { radius: 0.015, name: 'End' }),
      boxSpan(shelf, xb, xb + 0.04, y, y + SHELF_HEIGHT + 0.05, z - half, z + half, { radius: 0.015, name: 'End' }),
      boxSpan(materials.toon('brand0'), xb + 0.04, xb + 0.06, y + SHELF_HEIGHT - 0.3, y + SHELF_HEIGHT, z - half + 0.05, z + half - 0.05, { radius: 0.005, name: 'EndCapSign' })
    ]
    SHELF_LEVELS.slice(1).forEach(function (level) {
      parts.push(boxSpan(shelf, xa, xb, y + level - 0.025, y + level, z - half, z + half, { radius: 0.008, name: 'Board' }))
    })
    return group.apply(null, ['Shelf' + index].concat(parts))
  }

  /** 货架上的商品槽位：每层沿 x 排一串大小不一的盒子，两面都摆。 */
  function fillGondola(z, random, into) {
    var xa = SHELF_X[0]
    var xb = SHELF_X[1]
    ;[-1, 1].forEach(function (side) {
      SHELF_LEVELS.forEach(function (level) {
        var x = xa + 0.06
        while (x < xb - 0.12) {
          var w = 0.1 + random() * 0.14
          var h = 0.12 + random() * 0.16
          var d = 0.18 + random() * 0.14
          if (random() > 0.08) {
            into.push({
              x: x + w / 2,
              y: LEVEL.floor + level,
              z: z + side * (SHELF_DEPTH / 2 - d / 2 - 0.04),
              w: w, h: h, d: d,
              color: Math.floor(random() * 8),
              shade: 0.82 + random() * 0.3
            })
          }
          x += w + 0.015 + random() * 0.03
        }
      })
    })
  }

  /** 后墙冰柜：柜体、五扇玻璃门、里面的灯板与隔板。 */
  function buildFridge(materials) {
    var body = materials.toon('fridgeBody')
    var frame = materials.toon('frame')
    var x0 = FRIDGE.x0
    var x1 = FRIDGE.x1
    var z0 = FRIDGE.z0
    var z1 = FRIDGE.z1
    var height = FRIDGE.height
    var y = LEVEL.floor
    var parts = [
      boxSpan(body, x0, x1, y, y + height, z0, z0 + 0.06, { radius: 0.01, name: 'Back' }),
      boxSpan(body, x0, x0 + 0.06, y, y + height, z0, z1, { radius: 0.01, name: 'Side' }),
      boxSpan(body, x1 - 0.06, x1, y, y + height, z0, z1, { radius: 0.01, name: 'Side' }),
      boxSpan(body, x0, x1, y + height - 0.22, y + height, z0, z1, { radius: 0.015, name: 'Header' }),
      boxSpan(body, x0, x1, y, y + 0.16, z0, z1, { radius: 0.015, name: 'Base' })
    ]
    // 冰柜里的灯板：贴着后板的一层自发光。
    var glow = mesh(new THREE.PlaneGeometry(x1 - x0 - 0.14, height - 0.42), materials.glow('fridgeGlow'), { name: 'Glow', castShadow: false, receiveShadow: false })
    glow.position.set((x0 + x1) / 2, y + 0.16 + (height - 0.38) / 2, z0 + 0.065)
    parts.push(glow)
    for (var level = 1; level <= 4; level += 1) {
      var ly = y + 0.16 + level * 0.33
      parts.push(boxSpan(materials.toon('metal'), x0 + 0.06, x1 - 0.06, ly - 0.012, ly, z0 + 0.06, z1 - 0.05, { radius: 0.004, name: 'Rack' }))
    }
    // 玻璃门：门框与把手；玻璃整面一块。
    var doorWidth = (x1 - x0) / FRIDGE.doors
    for (var index = 0; index <= FRIDGE.doors; index += 1) {
      var x = x0 + doorWidth * index
      parts.push(boxSpan(frame, x - 0.025, x + 0.025, y + 0.16, y + height - 0.22, z1 - 0.03, z1 + 0.01, { radius: 0.008, name: 'Mullion' }))
      if (index < FRIDGE.doors) {
        parts.push(boxSpan(frame, x + doorWidth - 0.1, x + doorWidth - 0.08, y + 0.8, y + 1.3, z1 + 0.01, z1 + 0.04, { radius: 0.006, name: 'Handle' }))
      }
    }
    var pane = mesh(new THREE.PlaneGeometry(x1 - x0 - 0.08, height - 0.4), materials.glass, { name: 'Glass', castShadow: false, receiveShadow: false })
    pane.position.set((x0 + x1) / 2, y + 0.16 + (height - 0.38) / 2, z1 - 0.005)
    pane.renderOrder = 2
    parts.push(pane)
    return group.apply(null, ['Fridge'].concat(parts))
  }

  /** 冰柜里的瓶子槽位。 */
  function fillFridge(random, into) {
    var x0 = FRIDGE.x0
    var x1 = FRIDGE.x1
    var z0 = FRIDGE.z0
    for (var level = 0; level < 5; level += 1) {
      var ly = LEVEL.floor + 0.16 + level * 0.33
      var x = x0 + 0.1
      while (x < x1 - 0.14) {
        var tall = 0.18 + random() * 0.07
        into.push({ x: x + 0.04, y: ly, z: z0 + 0.32, w: 0.075, h: tall, d: 0.075, color: Math.floor(random() * 8), shade: 0.85 + random() * 0.3 })
        x += 0.11 + random() * 0.02
      }
    }
  }

  /** 收银台：台身、台面、收银机与小屏、热食柜（暖光）、咖啡机。 */
  function buildCounter(materials) {
    var counter = materials.toon('counter')
    var dark = materials.toon('darkMetal')
    var xa = -0.38
    var xb = 0.18
    var za = -2.55
    var zb = -1.05
    var y = LEVEL.floor
    var parts = [
      boxSpan(counter, xa, xb, y, y + 0.95, za, zb, { radius: 0.03, name: 'Body' }),
      boxSpan(materials.toon('brand2'), xa - 0.01, xa + 0.01, y + 0.62, y + 0.72, za + 0.05, zb - 0.05, { radius: 0.004, name: 'Stripe' }),
      boxSpan(materials.toon('trim'), xa - 0.04, xb + 0.02, y + 0.95, y + 0.99, za - 0.02, zb + 0.02, { radius: 0.015, name: 'Top' }),
      boxSpan(dark, xa + 0.12, xa + 0.42, y + 0.99, y + 1.13, zb - 0.42, zb - 0.12, { radius: 0.02, name: 'Register' }),
      boxSpan(dark, xa + 0.4, xa + 0.43, y + 1.1, y + 1.34, zb - 0.38, zb - 0.16, { radius: 0.01, name: 'Display' }),
      boxSpan(dark, xa + 0.08, xa + 0.38, y + 0.99, y + 1.36, za + 0.12, za + 0.42, { radius: 0.02, name: 'CoffeeMachine' })
    ]
    var screen = mesh(new THREE.PlaneGeometry(0.2, 0.14), materials.glow('screen'), { name: 'Screen', castShadow: false, receiveShadow: false })
    screen.position.set(xa + 0.395, y + 1.22, zb - 0.27)
    screen.rotation.y = -Math.PI / 2
    parts.push(screen)
    // 热食柜：一个发暖光的玻璃盒。
    parts.push(boxSpan(materials.glow('snackCase'), xa + 0.06, xa + 0.5, y + 0.99, y + 1.3, za + 0.58, za + 1.02, { radius: 0.03, name: 'SnackCase', castShadow: false }))
    parts.push(boxSpan(dark, xa + 0.04, xa + 0.52, y + 1.3, y + 1.34, za + 0.56, za + 1.04, { radius: 0.012, name: 'SnackLid' }))
    return group.apply(null, ['Counter'].concat(parts))
  }

  /** 窗边杂志架、复印机、ATM、员工门。杂志槽位进 slots（实例色跟商品一起换主题色）。 */
  function buildFixtures(materials, slots, random) {
    var shelf = materials.toon('shelf')
    var dark = materials.toon('darkMetal')
    var y = LEVEL.floor
    var parts = [
      boxSpan(shelf, -4.45, -1.65, y, y + 0.9, 0.02, 0.28, { radius: 0.02, name: 'MagazineRack' }),
      boxSpan(materials.toon('acUnit'), -5.18, -4.62, y, y + 1.12, -0.72, -0.08, { radius: 0.04, name: 'Copier' }),
      boxSpan(dark, -5.2, -4.72, y, y + 1.5, -1.72, -1.02, { radius: 0.04, name: 'Atm' }),
      boxSpan(materials.toon('frame'), -0.92, -0.08, y, y + 2.05, STORE.z0 + STORE.wall, STORE.z0 + STORE.wall + 0.04, { radius: 0.01, name: 'StaffDoor' })
    ]
    var atmScreen = mesh(new THREE.PlaneGeometry(0.3, 0.22), materials.glow('screen'), { name: 'AtmScreen', castShadow: false, receiveShadow: false })
    atmScreen.position.set(-4.715, y + 1.12, -1.37)
    atmScreen.rotation.y = Math.PI / 2
    parts.push(atmScreen)
    // 杂志：斜靠在架子上沿的一排薄板。
    for (var x = -4.38; x < -1.75; x += 0.2 + random() * 0.04) {
      slots.push({ x: x, y: y + 0.9, z: 0.15, w: 0.17, h: 0.24, d: 0.02, color: Math.floor(random() * 8), shade: 0.9 + random() * 0.2 })
    }
    return group.apply(null, ['Fixtures'].concat(parts))
  }

  /** 天花灯：三排灯条。 */
  function buildCeilingLights(materials) {
    var positions = []
    ;[-0.7, -2.45, -4.0].forEach(function (z) {
      ;[-3.9, -2.2, -0.5].forEach(function (x) { positions.push([x, z]) })
    })
    var lights = new THREE.InstancedMesh(roundedBox(1.25, 0.05, 0.22, 0.02), materials.glow('ceilingLight'), positions.length)
    lights.name = 'CeilingLights'
    lights.castShadow = false
    var matrix = new THREE.Matrix4()
    positions.forEach(function (at, index) {
      matrix.makeTranslation(at[0], STORE.wallHeight - 0.06, at[1])
      lights.setMatrixAt(index, matrix)
    })
    return lights
  }

  /** 槽位 → 一批 InstancedMesh（单位盒按槽位缩放）。返回 { mesh, colorIndex, shade }（KonbiniProductBatch）。 */
  function productBatch(materials, slots, geometry, name, tilt) {
    tilt = tilt === undefined ? 0 : tilt
    var batch = new THREE.InstancedMesh(geometry, materials.product, slots.length)
    batch.name = name
    batch.castShadow = false
    batch.receiveShadow = true
    var colorIndex = new Uint8Array(slots.length)
    var shade = new Float32Array(slots.length)
    var matrix = new THREE.Matrix4()
    var rotation = new THREE.Matrix4().makeRotationX(tilt)
    slots.forEach(function (slot, index) {
      matrix.makeScale(slot.w, slot.h, slot.d).premultiply(rotation)
      matrix.setPosition(slot.x, slot.y + slot.h / 2, slot.z)
      batch.setMatrixAt(index, matrix)
      colorIndex[index] = slot.color
      shade[index] = slot.shade
      batch.setColorAt(index, new THREE.Color(1, 1, 1))
    })
    return { mesh: batch, colorIndex: colorIndex, shade: shade }
  }

  /** 店内整体。返回 { group, productBatches }。 */
  function buildKonbiniInterior(materials, shelfSeed) {
    var random = SeedHash.createVisualizerRng(shelfSeed)
    var shelfSlots = []
    var bottleSlots = []
    var magazineSlots = []
    var gondolas = SHELF_ROWS.map(function (z, index) {
      fillGondola(z, random, shelfSlots)
      return buildGondola(materials, z, index)
    })
    fillFridge(random, bottleSlots)
    var fixtures = buildFixtures(materials, magazineSlots, random)
    var boxes = productBatch(materials, shelfSlots, roundedBox(1, 1, 1, 0), 'Products')
    var bottles = productBatch(materials, bottleSlots, new THREE.CylinderGeometry(0.5, 0.5, 1, 8), 'Bottles')
    var magazines = productBatch(materials, magazineSlots, roundedBox(1, 1, 1, 0), 'Magazines', -0.25)
    var interior = group.apply(null, [
      'Store/Interior',
    ].concat(gondolas, [
      buildFridge(materials),
      buildCounter(materials),
      fixtures,
      buildCeilingLights(materials),
      boxes.mesh,
      bottles.mesh,
      magazines.mesh
    ]))
    return { group: interior, productBatches: [boxes, bottles, magazines] }
  }

  // ===== store.ts =====
  // 便利店 Group "Store"：地坪、实墙（外墙 + 内衬）、前右两面落地玻璃与窗框、对开自动门（两扇，会动）、
  // 屋顶与女儿墙、绕一圈的店招带（底板 + 三色条）、落水管，以及屋顶的三面广告塔骨架与射灯。
  // 招牌的字面（店招、广告塔三面）只留出位置，贴图由 KonbiniSigns 挂上。

  // 店体的常用尺寸（STORE 的解构，store 区段内用）。
  var x0 = STORE.x0
  var x1 = STORE.x1
  var z0 = STORE.z0
  var z1 = STORE.z1
  var wall = STORE.wall

  /** 地坪与实墙（外墙一层、内衬一层，透过玻璃看到的是内衬的颜色）。 */
  function buildShell(materials) {
    var outer = materials.toon('wall')
    var lining = materials.toon('interiorWall')
    var floor = materials.toon('interiorFloor')
    var frame = materials.toon('frame')
    var h = STORE.wallHeight
    var parts = [
      boxSpan(floor, x0, x1, LEVEL.lot - 0.02, LEVEL.floor, z0, z1, { radius: 0.01, name: 'Floor' }),
      // 后墙、左墙、右面后段实墙、前面左端墙垛。
      boxSpan(outer, x0, x1, LEVEL.floor, h, z0, z0 + wall, { name: 'Wall/back' }),
      boxSpan(outer, x0, x0 + wall, LEVEL.floor, h, z0, z1, { name: 'Wall/left' }),
      boxSpan(outer, x1 - wall, x1, LEVEL.floor, h, z0, STORE.rightGlassEnd, { name: 'Wall/rightSolid' }),
      boxSpan(outer, x0, STORE.frontPillarEnd, LEVEL.floor, h, z1 - wall, z1, { name: 'Wall/frontPillar' }),
      // 玻璃上沿到屋顶之间的横梁（店招挂在它外面）。
      boxSpan(outer, x0, x1, STORE.glassTop, h, z1 - wall, z1, { name: 'Wall/frontTransom' }),
      boxSpan(outer, x1 - wall, x1, STORE.glassTop, h, STORE.rightGlassEnd, z1, { name: 'Wall/rightTransom' }),
      // 内衬：比外墙薄一点，往里退。
      boxSpan(lining, x0 + wall, x1 - wall, LEVEL.floor, h - 0.05, z0 + wall, z0 + wall + 0.02, { radius: 0.005, name: 'Lining/back' }),
      boxSpan(lining, x0 + wall, x0 + wall + 0.02, LEVEL.floor, h - 0.05, z0 + wall, z1 - wall, { radius: 0.005, name: 'Lining/left' }),
      boxSpan(lining, x1 - wall - 0.02, x1 - wall, LEVEL.floor, h - 0.05, z0 + wall, STORE.rightGlassEnd, { radius: 0.005, name: 'Lining/right' }),
      // 转角立柱与玻璃下沿的踢脚。
      boxSpan(frame, x1 - 0.12, x1, LEVEL.floor, STORE.glassTop, z1 - 0.12, z1, { radius: 0.015, name: 'CornerPost' }),
      boxSpan(frame, STORE.frontPillarEnd, x1, LEVEL.floor, STORE.glassBottom, z1 - 0.1, z1, { radius: 0.01, name: 'Kick/front' }),
      boxSpan(frame, x1 - 0.1, x1, LEVEL.floor, STORE.glassBottom, STORE.rightGlassEnd, z1, { radius: 0.01, name: 'Kick/right' }),
      boxSpan(frame, STORE.frontPillarEnd, x1, STORE.glassTop - 0.05, STORE.glassTop + 0.02, z1 - 0.1, z1, { radius: 0.01, name: 'Head/front' }),
      boxSpan(frame, x1 - 0.1, x1, STORE.glassTop - 0.05, STORE.glassTop + 0.02, STORE.rightGlassEnd, z1, { radius: 0.01, name: 'Head/right' })
    ]
    return group.apply(null, ['Store/Shell'].concat(parts))
  }

  /** 落地玻璃：前面门两侧、右面前段；竖框约每 1.25m 一根。 */
  function buildGlazing(materials) {
    var glass = materials.glass
    var frame = materials.toon('frame')
    var bottom = STORE.glassBottom
    var top = STORE.glassTop - 0.05
    var height = top - bottom
    var parts = []
    var pane = function (width, x, z, rotationY, name) {
      var geometry = new THREE.PlaneGeometry(width, height)
      var result = mesh(geometry, glass, { name: name, castShadow: false, receiveShadow: false })
      result.position.set(x, bottom + height / 2, z)
      result.rotation.y = rotationY
      result.renderOrder = 2
      return result
    }
    var frontSpans = [[STORE.frontPillarEnd, DOOR.x0 - 0.08], [DOOR.x1 + 0.08, x1 - 0.12]]
    frontSpans.forEach(function (span, index) {
      var a = span[0]
      var b = span[1]
      parts.push(pane(b - a, (a + b) / 2, z1 - 0.05, 0, 'Glass/front' + index))
      var count = Math.max(1, Math.round((b - a) / 1.25))
      for (var i = 0; i <= count; i += 1) {
        var x = a + ((b - a) * i) / count
        parts.push(boxSpan(frame, x - 0.03, x + 0.03, bottom, top, z1 - 0.09, z1 - 0.01, { radius: 0.01, name: 'Mullion' }))
      }
    })
    // 只在倒影里出现的“橱窗光”：店里亮着的那一片，倒影不用再把整个店内画一遍。
    var windowGlow = materials.glow('warmWindow')
    var standIn = function (width, x, z, rotationY) {
      var plane = mesh(new THREE.PlaneGeometry(width, height * 0.92), windowGlow, { name: 'ReflectionWindow', castShadow: false, receiveShadow: false })
      plane.position.set(x, bottom + height * 0.5, z)
      plane.rotation.y = rotationY
      plane.layers.set(REFLECT_LAYER)
      parts.push(plane)
    }
    standIn(x1 - STORE.frontPillarEnd - 0.2, (STORE.frontPillarEnd + x1) / 2, z1 - 0.2, 0)
    standIn(z1 - STORE.rightGlassEnd - 0.2, x1 - 0.2, (z1 + STORE.rightGlassEnd) / 2, Math.PI / 2)
    var rightSpan = [STORE.rightGlassEnd, z1 - 0.12]
    parts.push(pane(rightSpan[1] - rightSpan[0], x1 - 0.05, (rightSpan[0] + rightSpan[1]) / 2, Math.PI / 2, 'Glass/right'))
    var rightCount = Math.max(1, Math.round((rightSpan[1] - rightSpan[0]) / 1.25))
    for (var i = 0; i <= rightCount; i += 1) {
      var z = rightSpan[0] + ((rightSpan[1] - rightSpan[0]) * i) / rightCount
      parts.push(boxSpan(frame, x1 - 0.09, x1 - 0.01, bottom, top, z - 0.03, z + 0.03, { radius: 0.01, name: 'Mullion' }))
    }
    return group.apply(null, ['Store/Glazing'].concat(parts))
  }

  /** 对开自动门：门框、门上感应器、两扇带框的玻璃门（各自是一个会动的 Group）。返回 { group, panels }。 */
  function buildDoor(materials) {
    var frame = materials.toon('frame')
    var darkMetal = materials.toon('darkMetal')
    var glass = materials.glass
    var panelHeight = DOOR.height - LEVEL.floor - 0.02
    var mid = (DOOR.x0 + DOOR.x1) / 2
    var z = z1 + 0.035
    var parts = [
      boxSpan(frame, DOOR.x0 - 0.08, DOOR.x0, LEVEL.floor, STORE.glassTop, z1 - 0.1, z1 + 0.08, { radius: 0.01, name: 'Jamb/left' }),
      boxSpan(frame, DOOR.x1, DOOR.x1 + 0.08, LEVEL.floor, STORE.glassTop, z1 - 0.1, z1 + 0.08, { radius: 0.01, name: 'Jamb/right' }),
      boxSpan(frame, DOOR.x0 - 0.9, DOOR.x1 + 0.9, DOOR.height, DOOR.height + 0.16, z1 - 0.02, z1 + 0.1, { radius: 0.015, name: 'Header' }),
      boxSpan(darkMetal, mid - 0.18, mid + 0.18, DOOR.height - 0.07, DOOR.height, z1 + 0.04, z1 + 0.11, { radius: 0.012, name: 'Sensor' }),
      // 门里门外的地垫。
      boxSpan(materials.toon('rubber'), DOOR.x0 - 0.1, DOOR.x1 + 0.1, LEVEL.lot, LEVEL.lot + 0.012, z1 + 0.12, z1 + 0.85, { radius: 0.006, name: 'Mat/out' }),
      boxSpan(materials.toon('rubber'), DOOR.x0, DOOR.x1, LEVEL.floor, LEVEL.floor + 0.01, z1 - 0.9, z1 - 0.12, { radius: 0.006, name: 'Mat/in' })
    ]
    // 门上方的固定玻璃。
    var transom = mesh(new THREE.PlaneGeometry(DOOR.x1 - DOOR.x0, STORE.glassTop - DOOR.height - 0.16), glass, { name: 'Glass/transom', castShadow: false, receiveShadow: false })
    transom.position.set(mid, (DOOR.height + 0.16 + STORE.glassTop) / 2, z1 - 0.05)
    transom.renderOrder = 2
    parts.push(transom)

    var panels = []
    ;[-1, 1].forEach(function (direction) {
      var w = DOOR.panelWidth
      var panelGlass = mesh(new THREE.PlaneGeometry(w - 0.1, panelHeight - 0.14), glass, { name: 'Glass', castShadow: false, receiveShadow: false })
      panelGlass.position.set(0, panelHeight / 2 + 0.02, 0)
      panelGlass.renderOrder = 2
      var rails = [
        boxSpan(frame, -w / 2, -w / 2 + 0.05, 0, panelHeight, -0.025, 0.025, { radius: 0.01, name: 'Stile' }),
        boxSpan(frame, w / 2 - 0.05, w / 2, 0, panelHeight, -0.025, 0.025, { radius: 0.01, name: 'Stile' }),
        boxSpan(frame, -w / 2, w / 2, 0, 0.09, -0.025, 0.025, { radius: 0.01, name: 'Rail' }),
        boxSpan(frame, -w / 2, w / 2, panelHeight - 0.05, panelHeight, -0.025, 0.025, { radius: 0.01, name: 'Rail' }),
        boxSpan(darkMetal, -0.02, 0.02, 0.9, 1.25, 0.025, 0.045, { radius: 0.008, name: 'Pull' })
      ]
      var panel = group.apply(null, [direction < 0 ? 'Door/left' : 'Door/right'].concat(rails, [panelGlass]))
      panel.userData.dynamic = true
      var closedX = mid + direction * (w / 2 - 0.02)
      panel.position.set(closedX, LEVEL.floor + 0.01, z)
      panels.push({ object: panel, closedX: closedX, direction: direction })
      parts.push(panel)
    })
    return { group: group.apply(null, ['Store/Door'].concat(parts)), panels: panels }
  }

  /** 屋顶、女儿墙、落水管。 */
  function buildRoof(materials) {
    var roof = materials.toon('roof')
    var trim = materials.toon('trim')
    var o = STORE.overhang
    var top = STORE.roofTop
    var p = STORE.parapetTop
    var t = 0.1
    var parts = [
      boxSpan(roof, x0 - o, x1 + o, STORE.wallHeight, top, z0 - o, z1 + o, { radius: 0.025, name: 'Slab' }),
      boxSpan(trim, x0 - o, x1 + o, top, p, z0 - o, z0 - o + t, { radius: 0.02, name: 'Parapet/back' }),
      boxSpan(trim, x0 - o, x1 + o, top, p, z1 + o - t, z1 + o, { radius: 0.02, name: 'Parapet/front' }),
      boxSpan(trim, x0 - o, x0 - o + t, top, p, z0 - o, z1 + o, { radius: 0.02, name: 'Parapet/left' }),
      boxSpan(trim, x1 + o - t, x1 + o, top, p, z0 - o, z1 + o, { radius: 0.02, name: 'Parapet/right' })
    ]
    // 落水管：前左角，从女儿墙下沿顺墙到地面，底部一个弯头朝外。
    var pipe = materials.toon('metal')
    var px = x0 - 0.06
    var pz = z1 - 0.12
    parts.push(cylinderAt(pipe, 0.045, top - LEVEL.lot - 0.2, [px, LEVEL.lot + 0.2, pz], { segments: 10, name: 'Downspout' }))
    parts.push(tubeBetween(pipe, new THREE.Vector3(px, LEVEL.lot + 0.22, pz), new THREE.Vector3(px - 0.05, LEVEL.lot + 0.06, pz + 0.2), 0.045, { name: 'Downspout/elbow' }))
    parts.push(tubeBetween(pipe, new THREE.Vector3(px, top - 0.02, pz), new THREE.Vector3(px + 0.18, top - 0.02, pz + 0.2), 0.04, { name: 'Downspout/head' }))
    return group.apply(null, ['Store/Roof'].concat(parts))
  }

  /** 店招带：前面、右面各一块灯箱底板，上沿一条、下沿两条三色条。字面贴图另挂。返回 { group, faces }。 */
  function buildFascia(materials) {
    var base = materials.toon('signBase')
    var d = FASCIA.depth
    var parts = [
      boxSpan(base, x0 - 0.02, x1 + d, FASCIA.y0, FASCIA.y1, z1, z1 + d, { radius: 0.03, name: 'Board/front' }),
      boxSpan(base, x1, x1 + d, FASCIA.y0, FASCIA.y1, z0 + 0.4, z1 + d - 0.01, { radius: 0.03, name: 'Board/right' })
    ]
    var stripes = [
      ['brand0', FASCIA.y1 - 0.07, FASCIA.y1 - 0.01],
      ['brand2', FASCIA.y0 + 0.1, FASCIA.y0 + 0.15],
      ['brand0', FASCIA.y0 + 0.03, FASCIA.y0 + 0.08]
    ]
    stripes.forEach(function (stripe, index) {
      var material = materials.toon(stripe[0])
      var sy0 = stripe[1]
      var sy1 = stripe[2]
      parts.push(boxSpan(material, x0 - 0.01, x1 + d + 0.01, sy0, sy1, z1 + d - 0.02, z1 + d + 0.008, { radius: 0.006, name: 'Stripe/front' + index }))
      parts.push(boxSpan(material, x1 + d - 0.02, x1 + d + 0.008, sy0, sy1, z0 + 0.41, z1 + d, { radius: 0.006, name: 'Stripe/right' + index }))
    })
    var textHeight = (FASCIA.y1 - 0.08) - (FASCIA.y0 + 0.16)
    var textY = (FASCIA.y1 - 0.08 + FASCIA.y0 + 0.16) / 2
    var faces = [
      { position: new THREE.Vector3((x0 + x1) / 2, textY, z1 + d + 0.006), rotationY: 0, width: x1 - x0 - 0.2, height: textHeight },
      { position: new THREE.Vector3(x1 + d + 0.006, textY, (z0 + 0.4 + z1) / 2), rotationY: Math.PI / 2, width: z1 - z0 - 0.6, height: textHeight }
    ]
    return { group: group.apply(null, ['Store/Fascia'].concat(parts)), faces: faces }
  }

  /** 屋顶的三面广告塔：三角柱，每面一块自发光屏幕（屏幕自己亮，不要射灯），三根立柱与斜撑、顶盖。
   *  返回 { group, faces, lid: { center, shape, topY } }。 */
  function buildBoardTower(materials) {
    var steel = materials.toon('darkMetal')
    var trim = materials.toon('trim')
    var W = BOARD.faceWidth
    var H = BOARD.faceHeight
    var inradius = W / (2 * Math.sqrt(3))
    var circumradius = W / Math.sqrt(3)
    var center = new THREE.Vector3(BOARD.cx, 0, BOARD.cz)
    var parts = []
    var faces = []
    var vertices = []
    for (var k = 0; k < 3; k += 1) {
      var a = BOARD.azimuth + (k * 2 * Math.PI) / 3
      var normal = new THREE.Vector3(Math.sin(a), 0, Math.cos(a))
      var position = center.clone().addScaledVector(normal, inradius + 0.012)
      position.y = BOARD.y0 + H / 2
      faces.push({ position: position, rotationY: a })
      // 顶点在相邻两面法线的中间方向上。
      var va = a + Math.PI / 3
      vertices.push(center.clone().add(new THREE.Vector3(Math.sin(va) * circumradius, 0, Math.cos(va) * circumradius)))
    }
    // 三块屏幕的机箱：每面一块有厚度的背板，字面贴在外侧；上下沿各一根横梁。中间是空的，从上往下看得见屋顶。
    for (var j = 0; j < 3; j += 1) {
      var aj = BOARD.azimuth + (j * 2 * Math.PI) / 3
      var normalJ = new THREE.Vector3(Math.sin(aj), 0, Math.cos(aj))
      var panelCenter = center.clone().addScaledVector(normalJ, inradius - 0.07)
      var panel = mesh(roundedBox(W + 0.06, H + 0.16, 0.14, 0.03), steel, { name: 'Panel' + j })
      panel.position.set(panelCenter.x, BOARD.y0 + H / 2, panelCenter.z)
      panel.rotation.y = aj
      parts.push(panel)
      ;[BOARD.y0 + H + 0.1, BOARD.y0 - 0.1].forEach(function (y, index) {
        var beam = mesh(roundedBox(W + 0.14, 0.09, 0.2, 0.02), trim, { name: index === 0 ? 'TopBeam' : 'BottomBeam' })
        var beamCenter = center.clone().addScaledVector(normalJ, inradius - 0.04)
        beam.position.set(beamCenter.x, y, beamCenter.z)
        beam.rotation.y = aj
        parts.push(beam)
      })
      // 顶沿一条霓虹灯带（主题的霓虹色），让塔顶读作亮着的招牌，而不是一块暗的屋顶。
      var rim = mesh(roundedBox(W + 0.1, 0.04, 0.04, 0.012), materials.glow('neonRim'), { name: 'NeonRim', castShadow: false, receiveShadow: false })
      var rimCenter = center.clone().addScaledVector(normalJ, inradius + 0.075)
      rim.position.set(rimCenter.x, BOARD.y0 + H + 0.1, rimCenter.z)
      rim.rotation.y = aj
      parts.push(rim)
    }
    // 顶盖：一块薄三角板盖住屏幕机箱内侧，从上往下看是一块平顶，不是空心的三角。
    var lidShape = new THREE.Shape()
    vertices.forEach(function (vertex, index) {
      var local = vertex.clone().sub(center).multiplyScalar(1.01)
      if (index === 0) lidShape.moveTo(local.x, -local.z)
      else lidShape.lineTo(local.x, -local.z)
    })
    lidShape.closePath()
    var lidGeometry = new THREE.ExtrudeGeometry(lidShape, { depth: 0.06, bevelEnabled: true, bevelSize: 0.03, bevelThickness: 0.015, bevelSegments: 1 })
    lidGeometry.rotateX(-Math.PI / 2)
    var lid = mesh(lidGeometry, materials.toon('metal'), { name: 'Lid' })
    lid.position.set(center.x, BOARD.y0 + H + 0.08, center.z)
    parts.push(lid)
    // 立柱：顶点处从屋顶到顶盖，加斜撑。
    vertices.forEach(function (vertex, index) {
      var inward = center.clone().sub(vertex).setY(0).normalize()
      var foot = vertex.clone().addScaledVector(inward, 0.18)
      parts.push(cylinderAt(steel, 0.06, BOARD.y0 + H + 0.1 - STORE.roofTop, [foot.x, STORE.roofTop, foot.z], { segments: 8, name: 'Post' + index }))
      var brace = foot.clone().addScaledVector(inward, 0.9)
      parts.push(tubeBetween(steel, new THREE.Vector3(brace.x, STORE.roofTop, brace.z), new THREE.Vector3(foot.x, BOARD.y0 - 0.1, foot.z), 0.03, { name: 'Brace' }))
      parts.push(boxSpan(trim, brace.x - 0.14, brace.x + 0.14, STORE.roofTop, STORE.roofTop + 0.06, brace.z - 0.14, brace.z + 0.14, { radius: 0.01, name: 'BracePad' }))
    })
    var lidTop = BOARD.y0 + H + 0.08 + 0.06 + 0.015
    var lidShapePoints = vertices.map(function (vertex) {
      var local = vertex.clone().sub(center).multiplyScalar(1.01)
      return new THREE.Vector2(local.x, -local.z)
    })
    return { group: group.apply(null, ['Store/BoardTower'].concat(parts)), faces: faces, lid: { center: center, shape: lidShapePoints, topY: lidTop } }
  }

  /** 店体整体（含传入的 interior 组）。返回 { group, doorPanels, boardFaces, fasciaFaces, boardLid }。 */
  function buildKonbiniStore(materials, interior) {
    var door = buildDoor(materials)
    var fascia = buildFascia(materials)
    var tower = buildBoardTower(materials)
    var store = group.apply(null, [
      'Store',
      buildShell(materials),
      buildGlazing(materials),
      door.group,
      buildRoof(materials),
      fascia.group,
      tower.group,
      interior
    ])
    return {
      group: store,
      doorPanels: door.panels,
      boardFaces: tower.faces,
      fasciaFaces: fascia.faces,
      boardLid: tower.lid
    }
  }

  // ===== props.ts =====
  // 街边道具 Group "Props"：自动贩卖机（两台）、空调外机（屋顶两台、侧墙两台，风扇会转）、路灯、电线杆与电线、
  // 立柱灯箱、反光镜、停车标志、垃圾箱、门口 A 字立牌；按歌变的自行车（菜篮车）和伞在 "SongProps" 里。
  // 每件都是一个命名 Group，在本地坐标里搭好再摆到 layout 里的位置。

  var v = function (x, y, z) { return new THREE.Vector3(x, y, z) }

  /** 自动贩卖机：机身、上部陈列窗（发光 + 样品罐）、按钮条、投币区、取物口。 */
  function buildVendingMachine(materials, name, cans) {
    var w = PROPS.vending.width
    var d = PROPS.vending.depth
    var h = PROPS.vending.height
    // 本地坐标：正面朝 +z，底面中心在原点。
    var parts = [
      boxAt(materials.toon('vendingBody'), [w, h, d], [0, 0, 0], { radius: 0.05, name: 'Body' }),
      boxAt(materials.toon('darkMetal'), [w + 0.04, 0.08, d + 0.04], [0, 0, 0], { radius: 0.02, name: 'Plinth' }),
      boxAt(materials.toon('vendingAccent'), [w - 0.08, 0.06, 0.02], [0, h - 0.12, d / 2], { radius: 0.01, name: 'TopStripe' }),
      boxAt(materials.toon('darkMetal'), [w - 0.3, 0.2, 0.04], [-0.08, 0.16, d / 2 - 0.01], { radius: 0.02, name: 'Dispenser' }),
      boxAt(materials.toon('metal'), [0.18, 0.42, 0.03], [w / 2 - 0.17, 0.62, d / 2], { radius: 0.02, name: 'CoinPanel' })
    ]
    var windowHeight = 0.86
    var glow = mesh(new THREE.PlaneGeometry(w - 0.12, windowHeight), materials.glow('vendingGlow'), { name: 'Display', castShadow: false, receiveShadow: false })
    glow.position.set(0, h - 0.2 - windowHeight / 2, d / 2 - 0.05)
    parts.push(glow)
    // 按钮：两排小红灯。
    var buttons = new THREE.InstancedMesh(roundedBox(0.05, 0.022, 0.02, 0.006), materials.glow('redLamp'), 16)
    buttons.name = 'Buttons'
    var matrix = new THREE.Matrix4()
    for (var index = 0; index < 16; index += 1) {
      var row = Math.floor(index / 8)
      matrix.makeTranslation(-w / 2 + 0.1 + (index % 8) * ((w - 0.2) / 7), h - 0.2 - (row === 0 ? 0.42 : windowHeight + 0.05), d / 2 - 0.02)
      buttons.setMatrixAt(index, matrix)
    }
    parts.push(buttons)
    // 陈列窗里的样品罐：两层，每层 8 个。
    for (var row2 = 0; row2 < 2; row2 += 1) {
      for (var column = 0; column < 8; column += 1) {
        cans.push({
          x: -w / 2 + 0.1 + column * ((w - 0.2) / 7),
          y: h - 0.2 - windowHeight + 0.08 + row2 * 0.44,
          z: d / 2 - 0.12,
          color: (column + row2 * 3) % 8
        })
      }
    }
    return group.apply(null, [name].concat(parts))
  }

  /** 菜篮自行车（日式 mamachari）：本地坐标沿 +x 是车头。 */
  function buildBicycle(materials, name) {
    var frame = materials.toon('bike')
    var metal = materials.toon('metal')
    var rubber = materials.toon('rubber')
    var wheelRadius = 0.33
    var parts = []
    var wheel = function (x) {
      var tire = mesh(new THREE.TorusGeometry(wheelRadius, 0.028, 6, 28), rubber, { name: 'Tire' })
      tire.position.set(x, wheelRadius + 0.03, 0)
      var rim = mesh(new THREE.TorusGeometry(wheelRadius - 0.03, 0.01, 4, 24), metal, { name: 'Rim' })
      rim.position.copy(tire.position)
      var hub = mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.09, 8), metal, { name: 'Hub' })
      hub.rotation.x = Math.PI / 2
      hub.position.copy(tire.position)
      parts.push(tire, rim, hub)
      // 辐条：几根细杆。
      for (var index = 0; index < 6; index += 1) {
        var angle = (index * Math.PI) / 6
        var a = tire.position.clone().add(v(Math.cos(angle) * (wheelRadius - 0.03), Math.sin(angle) * (wheelRadius - 0.03), 0))
        var b = tire.position.clone().add(v(-Math.cos(angle) * (wheelRadius - 0.03), -Math.sin(angle) * (wheelRadius - 0.03), 0))
        parts.push(tubeBetween(metal, a, b, 0.004, { segments: 3, castShadow: false, name: 'Spoke' }))
      }
    }
    var rearX = -0.55
    var frontX = 0.58
    wheel(rearX)
    wheel(frontX)
    var axleY = wheelRadius + 0.03
    var bottomBracket = v(-0.05, 0.3, 0)
    var seatTop = v(-0.25, 0.86, 0)
    var headTop = v(0.42, 0.95, 0)
    var headLow = v(0.48, 0.66, 0)
    // 女式低跨车架：下管弯得很低。
    parts.push(
      tubeBetween(frame, bottomBracket, seatTop, 0.022, { name: 'SeatTube' }),
      tubeBetween(frame, bottomBracket, headLow, 0.026, { name: 'DownTube' }),
      tubeBetween(frame, headLow, headTop, 0.024, { name: 'HeadTube' }),
      tubeBetween(frame, bottomBracket, v(rearX, axleY, 0.05), 0.014, { name: 'ChainStay' }),
      tubeBetween(frame, v(-0.22, 0.78, 0), v(rearX, axleY, 0.05), 0.014, { name: 'SeatStay' }),
      tubeBetween(metal, headLow, v(frontX, axleY, 0), 0.016, { name: 'Fork' })
    )
    // 车座、车把、链罩、后货架、前车篮。
    parts.push(boxAt(rubber, [0.24, 0.06, 0.13], [seatTop.x - 0.02, seatTop.y, 0], { radius: 0.025, name: 'Saddle' }))
    parts.push(tubeBetween(metal, v(headTop.x - 0.12, headTop.y + 0.08, -0.26), v(headTop.x - 0.12, headTop.y + 0.08, 0.26), 0.014, { name: 'Handlebar' }))
    parts.push(tubeBetween(metal, headTop, v(headTop.x - 0.1, headTop.y + 0.08, 0), 0.016, { name: 'Stem' }))
    parts.push(boxAt(frame, [0.42, 0.09, 0.025], [-0.28, 0.28, 0.07], { radius: 0.02, name: 'ChainGuard' }))
    parts.push(boxAt(metal, [0.38, 0.02, 0.2], [rearX - 0.02, axleY + 0.36, 0], { radius: 0.006, name: 'Carrier' }))
    parts.push(boxAt(metal, [0.32, 0.22, 0.3], [frontX + 0.04, 0.82, 0], { radius: 0.02, name: 'Basket' }))
    // 支架：后轮旁边一根斜撑。
    parts.push(tubeBetween(metal, v(rearX + 0.1, axleY - 0.05, 0.04), v(rearX + 0.25, 0.01, 0.14), 0.01, { name: 'Kickstand' }))
    var bike = group.apply(null, [name].concat(parts))
    // 用支架撑着，略微侧倾。
    bike.rotation.x = -4 * DEG
    return bike
  }

  /** 空调外机：机身、圆形出风格栅、会转的风扇叶、冷媒管。正面朝 +z。风扇推进 fans。 */
  function buildAcUnit(materials, name, fans) {
    var body = materials.toon('acUnit')
    var dark = materials.toon('darkMetal')
    var parts = [
      boxAt(body, [0.82, 0.62, 0.3], [0, 0.04, 0], { radius: 0.04, name: 'Body' }),
      boxAt(dark, [0.86, 0.04, 0.34], [0, 0, 0], { radius: 0.01, name: 'Feet' })
    ]
    var grille = mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.02, 20), dark, { name: 'Grille' })
    grille.rotation.x = Math.PI / 2
    grille.position.set(-0.12, 0.36, 0.15)
    parts.push(grille)
    var blades = []
    for (var index = 0; index < 3; index += 1) {
      var blade = mesh(roundedBox(0.18, 0.07, 0.01, 0.004), materials.toon('metal'), { name: 'Blade', castShadow: false })
      blade.position.set(Math.cos((index * 2 * Math.PI) / 3) * 0.09, Math.sin((index * 2 * Math.PI) / 3) * 0.09, 0)
      blade.rotation.z = (index * 2 * Math.PI) / 3
      blades.push(blade)
    }
    var fan = group.apply(null, ['Fan'].concat(blades))
    fan.position.set(-0.12, 0.36, 0.165)
    fan.userData.dynamic = true
    fans.push(fan)
    parts.push(fan)
    parts.push(boxAt(dark, [0.04, 0.3, 0.04], [0.32, 0.1, -0.14], { radius: 0.01, name: 'Pipe' }))
    return group.apply(null, [name].concat(parts))
  }

  /** 路灯：锥形灯杆、伸出的灯臂、灯头（底面发光）。返回 { group, head }（head 是灯头世界坐标）。 */
  function buildStreetLamp(materials) {
    var x = PROPS.streetLamp.x
    var z = PROPS.streetLamp.z
    var height = PROPS.streetLamp.height
    var arm = PROPS.streetLamp.arm
    var metal = materials.toon('metal')
    var parts = [
      cylinderAt(metal, 0.085, height, [0, LEVEL.lot, 0], { radiusTop: 0.055, segments: 10, name: 'Pole' }),
      cylinderAt(materials.toon('darkMetal'), 0.12, 0.3, [0, LEVEL.lot, 0], { segments: 10, name: 'Foot' }),
      tubeBetween(metal, v(0, LEVEL.lot + height - 0.15, 0), v(-arm * 0.55, LEVEL.lot + height + 0.12, 0), 0.04, { name: 'Arm' }),
      tubeBetween(metal, v(-arm * 0.55, LEVEL.lot + height + 0.12, 0), v(-arm, LEVEL.lot + height + 0.08, 0), 0.04, { name: 'Arm' }),
      boxAt(materials.toon('darkMetal'), [0.56, 0.1, 0.24], [-arm - 0.12, LEVEL.lot + height, 0], { radius: 0.04, name: 'Head' })
    ]
    var lens = mesh(new THREE.PlaneGeometry(0.46, 0.16), materials.glow('lampHead'), { name: 'Lens', castShadow: false, receiveShadow: false })
    lens.rotation.x = Math.PI / 2
    lens.position.set(-arm - 0.12, LEVEL.lot + height - 0.003, 0)
    parts.push(lens)
    var lamp = group.apply(null, ['StreetLamp'].concat(parts))
    lamp.position.set(x, 0, z)
    return { group: lamp, head: v(x - arm - 0.12, LEVEL.lot + height - 0.02, z) }
  }

  /** 电线杆：混凝土杆、两层横担与瓷瓶、变压器、底部黄黑护套；电线顺着左边沿伸出底座。 */
  function buildUtilityPole(materials) {
    var x = PROPS.utilityPole.x
    var z = PROPS.utilityPole.z
    var height = PROPS.utilityPole.height
    var top = LEVEL.lot + height
    var parts = [
      cylinderAt(materials.toon('pole'), 0.15, height, [x, LEVEL.lot, z], { radiusTop: 0.11, segments: 14, name: 'Pole' }),
      cylinderAt(materials.toon('caution'), 0.165, 1.6, [x, LEVEL.lot, z], { segments: 14, name: 'Guard' }),
      cylinderAt(materials.toon('acUnit'), 0.2, 0.62, [x + 0.32, top - 2.2, z], { segments: 12, name: 'Transformer' }),
      tubeBetween(materials.toon('darkMetal'), v(x, top - 1.9, z), v(x + 0.32, top - 1.9, z), 0.03, { name: 'TransformerBracket' })
    ]
    var insulators = []
    var wireEnds = []
    ;[top - 0.7, top - 0.25].forEach(function (y, level) {
      var span = level === 0 ? 0.9 : 1.2
      parts.push(boxSpan(materials.toon('darkMetal'), x - span / 2, x + span / 2, y - 0.05, y + 0.05, z - 0.06, z + 0.06, { radius: 0.015, name: 'Crossarm' }))
      ;[-span / 2 + 0.08, 0, span / 2 - 0.08].forEach(function (offset) {
        if (offset === 0 && level === 1) return
        insulators.push(v(x + offset, y + 0.05, z))
      })
    })
    insulators.forEach(function (point) {
      parts.push(cylinderAt(materials.toon('white'), 0.04, 0.1, [point.x, point.y, point.z], { radiusTop: 0.025, segments: 8, name: 'Insulator' }))
      wireEnds.push(point.clone().setY(point.y + 0.09))
    })
    // 电线：往后沿左边出底座，往前跨过前路到对面边上；另一根接到店的前左角。
    var wire = materials.toon('wire')
    wireEnds.forEach(function (end, index) {
      var backEnd = v(end.x + (index - 2) * 0.03, end.y - 0.3, -BASE.half)
      var frontEnd = v(end.x + (index - 2) * 0.03, end.y - 0.2, BASE.half)
      parts.push(sagWire(wire, end, backEnd, 0.55 + index * 0.04))
      parts.push(sagWire(wire, end, frontEnd, 0.35 + index * 0.03))
    })
    parts.push(sagWire(wire, v(x + 0.1, top - 2.6, z), v(STORE.x0 + 0.1, STORE.parapetTop - 0.1, STORE.z1 - 0.1), 0.35, 0.01))
    // 杆上的地址牌。
    parts.push(boxAt(materials.toon('brand2'), [0.03, 0.42, 0.14], [x + 0.15, LEVEL.lot + 1.9, z], { radius: 0.01, name: 'AddressPlate' }))
    return group.apply(null, ['UtilityPole'].concat(parts))
  }

  /** 立柱灯箱：两根立柱托着一个双面灯箱（字面另挂）。返回 { group, faces }。 */
  function buildPylon(materials) {
    var x = PROPS.pylon.x
    var z = PROPS.pylon.z
    var height = PROPS.pylon.height
    var box = { w: 1.35, h: 1.25, d: 0.32 }
    var rotationY = 45 * DEG
    var parts = [
      boxAt(materials.toon('darkMetal'), [0.12, height - box.h, 0.12], [-0.42, LEVEL.lot, 0], { radius: 0.02, name: 'Post' }),
      boxAt(materials.toon('darkMetal'), [0.12, height - box.h, 0.12], [0.42, LEVEL.lot, 0], { radius: 0.02, name: 'Post' }),
      boxAt(materials.toon('signBase'), [box.w, box.h, box.d], [0, LEVEL.lot + height - box.h, 0], { radius: 0.05, name: 'Box' }),
      boxAt(materials.toon('brand0'), [box.w + 0.04, 0.1, box.d + 0.04], [0, LEVEL.lot + height - 0.04, 0], { radius: 0.03, name: 'Cap' }),
      boxAt(materials.toon('brand2'), [box.w + 0.02, 0.07, box.d + 0.02], [0, LEVEL.lot + height - box.h, 0], { radius: 0.02, name: 'Base' }),
      boxAt(materials.toon('concrete'), [1.0, 0.18, 0.4], [0, LEVEL.lot, 0], { radius: 0.03, name: 'Footing' })
    ]
    var pylon = group.apply(null, ['Pylon'].concat(parts))
    pylon.position.set(x, 0, z)
    pylon.rotation.y = rotationY
    var center = v(x, LEVEL.lot + height - box.h / 2 - 0.02, z)
    var normal = v(Math.sin(rotationY), 0, Math.cos(rotationY))
    var faces = [0, Math.PI].map(function (turn) {
      return {
        position: center.clone().addScaledVector(normal, (turn === 0 ? 1 : -1) * (box.d / 2 + 0.006)),
        rotationY: rotationY + turn,
        width: box.w - 0.12,
        height: box.h - 0.22
      }
    })
    return { group: pylon, faces: faces }
  }

  /** 路口的反光镜：橙色立杆、圆镜。 */
  function buildCurveMirror(materials) {
    var x = PROPS.curveMirror.x
    var z = PROPS.curveMirror.z
    var height = PROPS.curveMirror.height
    var pole = materials.toon('mirrorPole')
    var parts = [
      cylinderAt(pole, 0.035, height, [0, LEVEL.lot, 0], { segments: 8, name: 'Pole' }),
      tubeBetween(pole, v(0, LEVEL.lot + height - 0.1, 0), v(0.2, LEVEL.lot + height - 0.1, -0.14), 0.025, { name: 'Bracket' })
    ]
    var rim = mesh(new THREE.TorusGeometry(0.3, 0.035, 6, 24), pole, { name: 'Rim' })
    var glass = mesh(new THREE.CircleGeometry(0.29, 24), materials.toon('metal'), { name: 'Mirror', castShadow: false })
    ;[rim, glass].forEach(function (part) {
      part.position.set(0.26, LEVEL.lot + height - 0.1, -0.18)
      part.rotation.y = 125 * DEG
      part.rotateX(-12 * DEG)
      parts.push(part)
    })
    var mirror = group.apply(null, ['CurveMirror'].concat(parts))
    mirror.position.set(x, 0, z)
    return mirror
  }

  /** 停车标志：倒三角红牌、白边。 */
  function buildStopSign(materials) {
    var x = PROPS.stopSign.x
    var z = PROPS.stopSign.z
    var height = PROPS.stopSign.height
    var shape = new THREE.Shape()
    var r = 0.36
    for (var index = 0; index < 3; index += 1) {
      var angle = -Math.PI / 2 + (index * 2 * Math.PI) / 3
      var px = Math.cos(angle) * r
      var py = Math.sin(angle) * r
      if (index === 0) shape.moveTo(px, py)
      else shape.lineTo(px, py)
    }
    shape.closePath()
    var plate = new THREE.ExtrudeGeometry(shape, { depth: 0.02, bevelEnabled: true, bevelSize: 0.03, bevelThickness: 0.01, bevelSegments: 1 })
    var parts = [
      cylinderAt(materials.toon('metal'), 0.03, height, [0, LEVEL.lot, 0], { segments: 8, name: 'Pole' })
    ]
    var back = mesh(plate, materials.toon('white'), { name: 'Rim' })
    back.position.set(0, LEVEL.lot + height - 0.15, 0.03)
    var face = mesh(new THREE.ShapeGeometry(shape), materials.toon('stopRed'), { name: 'Face' })
    face.scale.setScalar(0.86)
    face.position.set(0, LEVEL.lot + height - 0.15 - 0.012, 0.08)
    parts.push(back, face)
    var sign = group.apply(null, ['StopSign'].concat(parts))
    sign.position.set(x, 0, z)
    sign.rotation.y = 60 * DEG
    return sign
  }

  /** 店前的分类垃圾箱：三个，盖子是招牌色。 */
  function buildTrash(materials) {
    var x = PROPS.trash.x
    var z = PROPS.trash.z
    var lids = ['brand0', 'brand2', 'trim']
    var parts = []
    lids.forEach(function (lid, index) {
      parts.push(boxAt(materials.toon('acUnit'), [0.34, 0.82, 0.36], [(index - 1) * 0.37, LEVEL.lot, 0], { radius: 0.03, name: 'Bin' }))
      parts.push(boxAt(materials.toon(lid), [0.36, 0.08, 0.38], [(index - 1) * 0.37, LEVEL.lot + 0.82, 0], { radius: 0.03, name: 'Lid' }))
    })
    var trash = group.apply(null, ['TrashBins'].concat(parts))
    trash.position.set(x, 0, z)
    return trash
  }

  /** 伞架（几把收着的伞）与地上撑开晾着的一把伞。按歌变（variation.umbrellaInStand / openUmbrella）。 */
  function buildUmbrellas(materials, variation) {
    var x = PROPS.umbrellaStand.x
    var z = PROPS.umbrellaStand.z
    var umbrella = materials.toon('umbrella')
    var parts = [
      boxAt(materials.toon('metal'), [0.36, 0.5, 0.22], [0, LEVEL.lot, 0], { radius: 0.02, name: 'Stand' })
    ]
    if (variation.umbrellaInStand) {
      ;[-0.09, 0.04, 0.11].forEach(function (offset, index) {
        var closed = mesh(new THREE.ConeGeometry(0.05, 0.72, 8), index === 1 ? materials.toon('trim') : umbrella, { name: 'Closed' })
        closed.position.set(offset, LEVEL.lot + 0.4, (index - 1) * 0.04)
        closed.rotation.z = (index - 1) * 0.12
        closed.rotation.x = Math.PI
        parts.push(closed)
      })
    }
    var stand = group.apply(null, ['UmbrellaStand'].concat(parts))
    stand.position.set(x, 0, z)
    var result = [stand]
    if (variation.openUmbrella) {
      var canopy = mesh(new THREE.ConeGeometry(0.48, 0.28, 8, 1, true), umbrella, { name: 'Canopy' })
      canopy.material = umbrella
      var shaft = tubeBetween(materials.toon('darkMetal'), v(0, 0.14, 0), v(0, -0.45, 0), 0.01, { name: 'Shaft' })
      var open = group('OpenUmbrella', canopy, shaft)
      open.position.set(x - 0.75, LEVEL.lot + 0.32, z + 0.55)
      open.rotation.set(0.9, 0.6, 0.4)
      result.push(open)
    }
    return result
  }

  /** 门口的 A 字立牌：两块斜靠的板，正面贴主题名。返回 { group, faces }（face 带 lean 倾角）。 */
  function buildAFrame(materials) {
    var x = PROPS.aFrame.x
    var z = PROPS.aFrame.z
    var lean = 12 * DEG
    var board = { w: 0.56, h: 0.82 }
    var rotationY = 30 * DEG
    var parts = []
    ;[1, -1].forEach(function (side) {
      var panel = mesh(roundedBox(board.w, board.h, 0.03, 0.012), materials.toon('darkMetal'), { name: 'Panel' })
      panel.position.set(0, LEVEL.lot + Math.cos(lean) * board.h / 2, side * Math.sin(lean) * board.h / 2)
      panel.rotation.x = side * -lean
      parts.push(panel)
    })
    var frame = group.apply(null, ['AFrame'].concat(parts))
    frame.position.set(x, 0, z)
    frame.rotation.y = rotationY
    var normal = v(Math.sin(rotationY), 0, Math.cos(rotationY))
    var faceCenter = v(x, LEVEL.lot + Math.cos(lean) * board.h / 2, z).addScaledVector(normal, Math.sin(lean) * board.h / 2 + 0.02)
    return {
      group: frame,
      faces: [{ position: faceCenter, rotationY: rotationY, width: board.w - 0.06, height: board.h - 0.08, lean: lean }]
    }
  }

  /**
   * 按歌变的道具 Group "SongProps"：自行车（一到两辆、停在哪、颜色走调色板）、伞架里的伞、地上晾着的伞。
   * 换歌时整组换掉重建，其余道具不动。
   */
  function buildKonbiniSongProps(materials, variation) {
    var parts = []
    var firstSlot = PROPS.bikeSlots[variation.bikeSlot]
    var bike = buildBicycle(materials, 'Bicycle0')
    bike.position.set(firstSlot.x, LEVEL.lot, firstSlot.z)
    bike.rotation.y = Math.PI + variation.bikeYaw
    parts.push(bike)
    if (variation.secondBike) {
      var otherSlot = PROPS.bikeSlots[variation.bikeSlot === 0 ? 1 : 0]
      var second = buildBicycle(materials, 'Bicycle1')
      second.position.set(otherSlot.x, LEVEL.lot, otherSlot.z + 0.05)
      second.rotation.y = Math.PI - variation.bikeYaw * 0.7
      parts.push(second)
    }
    parts.push.apply(parts, buildUmbrellas(materials, variation))
    return group.apply(null, ['SongProps'].concat(parts))
  }

  /** 街边道具整体。返回 { group, fans, productBatches, pylonFaces, aFrameFaces, vendingPanels, streetLampHead }。 */
  function buildKonbiniProps(materials) {
    var fans = []
    var cans = []
    var vendingPanels = []
    var machines = PROPS.vending.z.map(function (z, index) {
      var localCans = []
      var machine = buildVendingMachine(materials, 'Vending' + index, localCans)
      machine.position.set(PROPS.vending.x + PROPS.vending.depth / 2 + 0.02, LEVEL.lot, z)
      machine.rotation.y = Math.PI / 2
      localCans.forEach(function (can) {
        // 本地 (x, z) 转到世界：绕 y 转 90°。
        cans.push({ x: machine.position.x + can.z, y: LEVEL.lot + can.y, z: z - can.x, color: can.color })
      })
      vendingPanels.push({
        position: v(machine.position.x + PROPS.vending.depth / 2 + 0.004, LEVEL.lot + PROPS.vending.height - 0.2 - 0.43, z),
        rotationY: Math.PI / 2,
        width: PROPS.vending.width - 0.12,
        height: 0.86
      })
      return machine
    })
    var canBatch = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.5, 0.5, 1, 8), materials.product, cans.length)
    canBatch.name = 'SampleCans'
    canBatch.castShadow = false
    var colorIndex = new Uint8Array(cans.length)
    var shade = new Float32Array(cans.length)
    var matrix = new THREE.Matrix4()
    cans.forEach(function (can, index) {
      matrix.makeScale(0.07, 0.14, 0.07)
      matrix.setPosition(can.x, can.y + 0.07, can.z)
      canBatch.setMatrixAt(index, matrix)
      canBatch.setColorAt(index, new THREE.Color(1, 1, 1))
      colorIndex[index] = can.color
      shade[index] = 1.1
    })

    var acUnits = PROPS.roofAc.map(function (at, index) {
      var unit = buildAcUnit(materials, 'RoofAc' + index, fans)
      unit.position.set(at.x, STORE.roofTop, at.z)
      unit.rotation.y = index === 0 ? 0 : Math.PI / 2
      return unit
    }).concat(PROPS.groundAc.z.map(function (z, index) {
      var unit = buildAcUnit(materials, 'GroundAc' + index, fans)
      unit.position.set(PROPS.groundAc.x, LEVEL.lot, z)
      unit.rotation.y = -Math.PI / 2
      return unit
    }))

    var lamp = buildStreetLamp(materials)
    var pylon = buildPylon(materials)
    var aFrame = buildAFrame(materials)
    var props = group.apply(null, ['Props'].concat(machines, [
      canBatch
    ], acUnits, [
      lamp.group,
      buildUtilityPole(materials),
      pylon.group,
      buildCurveMirror(materials),
      buildStopSign(materials),
      buildTrash(materials),
      aFrame.group
    ]))
    return {
      group: props,
      fans: fans,
      productBatches: [{ mesh: canBatch, colorIndex: colorIndex, shade: shade }],
      pylonFaces: pylon.faces,
      aFrameFaces: aFrame.faces,
      vendingPanels: vendingPanels,
      streetLampHead: lamp.head
    }
  }

  // ===== konbiniLights.ts =====
  // 便利店的灯：店内两盏暖光、玻璃外两盏溢出的暖光把店前场地照亮、路灯一盏聚光、贩卖机一盏冷光（天光与月光在
  // machi-skylights.js）。地上的光斑用加色贴片画，不用投影光。卡通渐变只把角度量化，距离衰减照常平滑，
  // 所以光照出来是一块块柔和的光池。

  /** 光斑贴图：柔边的长方形（靠店的一侧更亮）与圆。 */
  function createPoolTexture(round) {
    var size = 128
    var canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    var context = canvas.getContext('2d')
    var image = context.createImageData(size, size)
    for (var y = 0; y < size; y += 1) {
      for (var x = 0; x < size; x += 1) {
        var u = (x + 0.5) / size * 2 - 1
        var vv = (y + 0.5) / size * 2 - 1
        var d = round ? Math.hypot(u, vv) : Math.max(Math.abs(u) * 0.9, Math.abs(vv))
        var falloff = Math.max(0, 1 - d)
        var bias = round ? 1 : 0.55 + 0.45 * (1 - (vv + 1) / 2)
        var value = Math.round(255 * falloff * falloff * bias)
        var index = (y * size + x) * 4
        image.data[index] = value
        image.data[index + 1] = value
        image.data[index + 2] = value
        image.data[index + 3] = 255
      }
    }
    context.putImageData(image, 0, 0)
    var texture = new THREE.CanvasTexture(canvas)
    texture.colorSpace = THREE.NoColorSpace
    return texture
  }

  /**
   * constructor(blend, materials, streetLampHead)
   * levels: { interior（店内与溢出光）, street（路灯，偶尔闪一下）, pools（地上的光斑，白天被日光盖掉） }
   */
  function KonbiniLights(blend, materials, streetLampHead) {
    this.blend = blend
    this.group = new THREE.Group()
    this.group.name = 'KonbiniLights'
    this.levels = { interior: 1, street: 1, pools: 1 }
    this.stripTexture = createPoolTexture(false)
    this.roundTexture = createPoolTexture(true)
    this.interior = []
    this.spill = []
    this.pools = []
    this.poolMaterials = []
    var self = this

    var point = function (intensity, distance, position, name) {
      var light = new THREE.PointLight(0xffffff, intensity, distance, 2)
      light.position.set(position[0], position[1], position[2])
      light.name = name
      return light
    }
    this.interior = [
      point(9, 9, [-3.2, STORE.wallHeight - 0.45, -1.6], 'Lights/interior0'),
      point(8, 9, [-1.0, STORE.wallHeight - 0.45, -3.6], 'Lights/interior1')
    ]
    this.spill = [
      point(4.2, 6, [-2.8, 1.9, STORE.z1 + 0.9], 'Lights/spill0'),
      point(3.6, 6, [STORE.x1 + 0.9, 1.9, -0.9], 'Lights/spill1')
    ]
    this.street = new THREE.SpotLight(0xffffff, 26, 9, 0.95, 0.65, 2)
    this.street.name = 'Lights/street'
    this.street.position.copy(streetLampHead)
    this.street.target.position.set(streetLampHead.x - 0.3, 0, streetLampHead.z)
    this.vending = point(2.4, 3.2, [PROPS.vending.x + PROPS.vending.depth + 0.5, 1.3, (PROPS.vending.z[0] + PROPS.vending.z[1]) / 2], 'Lights/vending')

    // 地上的光斑：玻璃前一长条、门口一块、路灯下一圈、贩卖机前一块。加色、不写深度。
    var pool = function (key, level, size, at, round) {
      var material = materials.track(new THREE.MeshBasicMaterial({
        color: 0xffffff,
        map: round ? self.roundTexture : self.stripTexture,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false
      }))
      var geometry = new THREE.PlaneGeometry(size[0], size[1])
      geometry.rotateX(-Math.PI / 2)
      var result = new THREE.Mesh(geometry, material)
      result.position.set(at[0], LEVEL.lot + 0.006, at[1])
      result.renderOrder = 1
      result.name = 'Pool/' + key
      self.pools.push(result)
      self.poolMaterials.push({ material: material, key: key, level: level })
      return result
    }
    var doorMid = (DOOR.x0 + DOOR.x1) / 2
    var pools = [
      pool('spillLight', 0.5, [STORE.x1 - STORE.frontPillarEnd + 0.6, 2.0], [(STORE.frontPillarEnd + STORE.x1) / 2, STORE.z1 + 1.0], false),
      pool('spillLight', 0.42, [2.2, 1.7], [doorMid, STORE.z1 + 0.95], true),
      pool('spillLight', 0.42, [3.6, 1.6], [STORE.x1 + 0.85, (STORE.rightGlassEnd + STORE.z1) / 2], false),
      pool('streetLight', 0.55, [3.4, 3.4], [streetLampHead.x - 0.3, streetLampHead.z], true),
      pool('vendingLight', 0.32, [1.4, 2.4], [PROPS.vending.x + PROPS.vending.depth + 0.6, (PROPS.vending.z[0] + PROPS.vending.z[1]) / 2], true)
    ]
    pools[2].rotation.y = Math.PI / 2
    // 路灯那圈在路面上：要高过斑马线的白漆（+6mm）和排水沟盖板（顶在 +12mm），同高的话镜头一转就一道道地闪。
    pools[3].position.y = LEVEL.road + 0.016

    this.group.add.apply(this.group, this.interior.concat(this.spill, [this.street, this.street.target, this.vending], pools))
    this.sync()
  }

  /** 亮度变了才重写灯与光斑。levels: { interior, street, pools } */
  KonbiniLights.prototype.setLevels = function (levels) {
    if (levels.interior === this.levels.interior && levels.street === this.levels.street && levels.pools === this.levels.pools) return
    this.levels = levels
    this.sync()
  }

  /** 颜色（插值后的）与亮度写回灯和光斑。 */
  KonbiniLights.prototype.sync = function () {
    var interior = this.levels.interior
    var street = this.levels.street
    var pools = this.levels.pools
    var blend = this.blend
    this.interior.forEach(function (light, index) {
      light.color.copy(blend.get('interiorLight'))
      light.intensity = (index === 0 ? 9 : 8) * interior
    })
    this.spill.forEach(function (light, index) {
      light.color.copy(blend.get('spillLight'))
      light.intensity = (index === 0 ? 4.2 : 3.6) * interior
    })
    this.street.color.copy(blend.get('streetLight'))
    this.street.intensity = 26 * street
    this.vending.color.copy(blend.get('vendingLight'))
    this.poolMaterials.forEach(function (entry) {
      var scale = (entry.key === 'streetLight' ? street : entry.key === 'spillLight' ? interior : 1) * pools
      entry.material.color.copy(blend.get(entry.key)).multiplyScalar(entry.level * scale)
    })
  }

  KonbiniLights.prototype.dispose = function () {
    this.pools.forEach(function (pool) { pool.geometry.dispose() })
    this.stripTexture.dispose()
    this.roundTexture.dispose()
  }

  // ===== konbiniScene.ts =====
  // 便利店街角场景：装配上面所有部分。见文件头部注释。

  /** 便利店自己的颜色：店身、店内、空调外机、反光镜；自行车和伞按 seed 选。 */
  var KONBINI_ART = {
    wall: '#cfc9bd',
    trim: '#7f8898',
    roof: '#3a404d',
    frame: '#272c35',
    interiorFloor: '#d6d0c3',
    interiorWall: '#ece6d9',
    shelf: '#c6ccd4',
    counter: '#e6dfcf',
    fridgeBody: '#d3d8de',
    acUnit: '#d4d6d0',
    mirrorPole: '#e5702a',
    spillLight: '#ffcf92'
  }
  var BIKE_COLORS = ['#c8423a', '#2f6db0', '#e7c64a', '#3f8f5a', '#e9e6dc', '#2a2d34']
  var UMBRELLA_COLORS = ['#e8ecf2', '#2f6db0', '#d24d6e', '#3e4655', '#f0b23e']

  /** 场景颜色表（resolveArt）：消费共用调色板 base 与 theme/seed 的纯函数。 */
  function resolveKonbiniArt(_theme, seed, base) {
    var out = Object.assign({}, KONBINI_ART)
    // 玻璃外溢出的光：店内暖光与固定的琥珀各一半。
    out.spillLight = ColorMath.mixHexColors(KONBINI_ART.spillLight, base.interiorLight, 0.5)
    out.bike = BIKE_COLORS[PaletteMod.seedIndex(seed, 'bike', BIKE_COLORS.length)]
    out.umbrella = UMBRELLA_COLORS[PaletteMod.seedIndex(seed, 'umbrella', UMBRELLA_COLORS.length)]
    return out
  }

  /** 门开合时阴影图隔多大一段重画一次（开合度 0..1）。 */
  var DOOR_SHADOW_STEP = 0.06

  /** 自发光件：颜色键与亮度倍数（线性空间，> 1 才会被 bloom 轻轻带出光晕）。 */
  var KONBINI_GLOWS = {
    ceilingLight: { key: 'interiorLight', level: 2.4 },
    fridgeGlow: { key: 'vendingLight', level: 1.5 },
    vendingGlow: { key: 'vendingLight', level: 1.7 },
    lampHead: { key: 'streetLight', level: 3.2 },
    warmWindow: { key: 'interiorLight', level: 0.42 },
    snackCase: { key: 'spillLight', level: 1.6 },
    screen: { key: 'led', level: 1.3 },
    redLamp: { key: 'brand0', level: 1.0 },
    neonRim: { key: 'neon', level: 1.4 }
  }

  /** 四条车道（靠左行驶）：前路东行 / 西行，右路北行 / 南行。两端伸出底座，车由裁切面从底座边缘“开出来”。 */
  var LANE_REACH = 8
  var KONBINI_LANES = [
    { from: [-LANE_REACH, ROAD.inner + 0.92], to: [LANE_REACH, ROAD.inner + 0.92] },
    { from: [LANE_REACH, ROAD.outer - 1.12], to: [-LANE_REACH, ROAD.outer - 1.12] },
    { from: [ROAD.inner + 0.92, LANE_REACH], to: [ROAD.inner + 0.92, -LANE_REACH] },
    { from: [ROAD.outer - 1.12, -LANE_REACH], to: [ROAD.outer - 1.12, LANE_REACH] }
  ]

  /** 默认构图要框进去的点：底座顶面四角与两侧厚度、广告塔顶、立柱灯箱顶、店的后角。 */
  function framingPoints() {
    var h = BASE.half
    var points = []
    // 底座只框顶面四角加两侧的厚度：离镜头最近的底角压在字幕后面，不必框进来。
    ;[-h, h].forEach(function (x) {
      ;[-h, h].forEach(function (z) {
        points.push(new THREE.Vector3(x, 0, z))
        if (x !== z || x < 0) points.push(new THREE.Vector3(x, -BASE.depth, z))
      })
    })
    var boardTop = BOARD.y0 + BOARD.faceHeight + 0.6
    var r = BOARD.faceWidth / Math.sqrt(3)
    for (var k = 0; k < 3; k += 1) {
      var a = BOARD.azimuth + Math.PI / 3 + (k * 2 * Math.PI) / 3
      points.push(new THREE.Vector3(BOARD.cx + Math.sin(a) * r, boardTop, BOARD.cz + Math.cos(a) * r))
    }
    points.push(new THREE.Vector3(PROPS.pylon.x, PROPS.pylon.height + 0.3, PROPS.pylon.z))
    points.push(new THREE.Vector3(STORE.x0, STORE.parapetTop, STORE.z0))
    return points
  }

  /** 滴水：店招下沿（前面、右面）每隔一段一滴，落水管口一串。 */
  function konbiniDrips() {
    var drips = []
    var frontZ = STORE.z1 + FASCIA.depth + 0.07
    var rightX = STORE.x1 + FASCIA.depth + 0.07
    for (var x = STORE.x0 + 0.3; x < STORE.x1; x += 0.42) {
      drips.push({ x: x + (Math.random() - 0.5) * 0.12, z: frontZ, from: FASCIA.y0 - 0.02, to: LEVEL.lot, period: 1.1 + Math.random() * 1.8, phase: Math.random() })
    }
    for (var z = STORE.z1; z > STORE.z0 + 0.5; z -= 0.45) {
      drips.push({ x: rightX, z: z + (Math.random() - 0.5) * 0.12, from: FASCIA.y0 - 0.02, to: LEVEL.lot, period: 1.1 + Math.random() * 1.8, phase: Math.random() })
    }
    for (var index = 0; index < 4; index += 1) {
      drips.push({ x: STORE.x0 - 0.12 + (Math.random() - 0.5) * 0.04, z: STORE.z1 + 0.06, from: LEVEL.lot + 0.08, to: LEVEL.lot, period: 0.32 + Math.random() * 0.12, phase: index / 4 })
    }
    return drips
  }

  /** object 是不是 ancestor 的后代。 */
  function isInside(object, ancestor) {
    for (var node = object; node; node = node.parent) if (node === ancestor) return true
    return false
  }

  /**
   * constructor(context)
   * 场景对象：root / framing / weather / reflectionPlaneY / surfaces / puddles / focusPoint / busy，
   * 行为 setContent / swapSong / direct / syncColors / nextCar / dispose。
   */
  function KonbiniScene(context) {
    var Paint = window.FoliaMachiSceneKonbiniPaint
    this.context = context
    var materials = context.materials
    var blend = context.blend
    var geometryCache = context.geometryCache
    this.root = new THREE.Group()
    this.world = new THREE.Group()
    this.song = context.song
    var variation = resolveKonbiniVariation(context.song.seed)
    this.variation = variation
    this.doorEvents = buildKonbiniDoorEvents(context.song.lines, variation)
    this.doorOpenness = 0
    /** 阴影图上一次按门开到多大画的。 */
    this.shadowDoorOpenness = 0
    // 三面塔正对默认镜头那一面的中心：对焦对着字，不是塔心（大光圈下清晰的那一层只有一米来厚，塔心离字面一米六）。
    this.focusPoint = new THREE.Vector3(
      BOARD.cx + Math.sin(BOARD.azimuth) * BOARD.faceWidth / (2 * Math.sqrt(3)),
      BOARD.y0 + BOARD.faceHeight / 2,
      BOARD.cz + Math.cos(BOARD.azimuth) * BOARD.faceWidth / (2 * Math.sqrt(3))
    )
    this.reflectionPlaneY = 0.06
    materials.defineGlows(KONBINI_GLOWS)
    this.root.name = 'Konbini'

    var built = withGeometryCache(geometryCache, function () {
      var builtInterior = buildKonbiniInterior(materials, variation.shelfSeed)
      return {
        base: buildKonbiniBase(materials),
        interior: builtInterior,
        store: buildKonbiniStore(materials, builtInterior.group),
        props: buildKonbiniProps(materials),
        songProps: buildKonbiniSongProps(materials, variation)
      }
    })
    var base = built.base
    var interior = built.interior
    var store = built.store
    var props = built.props
    var songProps = built.songProps
    this.productBatches = interior.productBatches.concat(props.productBatches)
    this.doorPanels = store.doorPanels
    this.fans = props.fans
    this.world.name = 'Konbini/world'
    this.world.add(base.group, store.group, props.group, songProps)
    // 亮的东西进倒影图层（合批前打上，合批按图层分开）。店本身也进：倒影镜头不认灯光，卡通材质在那里是全黑的，
    // 正好当遮挡，屋顶上的广告塔不会穿过店身映到店前的水洼里。
    this.world.traverse(function (object) {
      if (!(object instanceof THREE.Mesh) || Array.isArray(object.material)) return
      var isGlow = object.material.name.indexOf('machi:glow') === 0
      var isStoreBody = !object.material.transparent && object.parent !== null && isInside(object, store.group)
      if (isGlow || isStoreBody) object.layers.enable(REFLECT_LAYER)
    })
    this.surfaces = { road: [base.roadSurface], lot: base.lotSurfaces }
    this.puddles = { offset: variation.puddleOffset, amount: variation.puddleAmount }
    bakeStatic(this.world)
    this.songProps = songProps

    this.lights = new KonbiniLights(blend, materials, props.streetLampHead)
    this.signs = new Paint.KonbiniSigns(materials, blend, {
      boardFaces: store.boardFaces,
      fasciaFaces: store.fasciaFaces,
      pylonFaces: props.pylonFaces,
      aFrameFaces: props.aFrameFaces,
      boardLid: store.boardLid
    })
    this.signs.group.traverse(function (object) {
      if (object instanceof THREE.Mesh && object.name.indexOf('Poster') !== 0 && object.name.indexOf('AFrame') !== 0 && object.name !== 'Board/roofLogo') object.layers.enable(REFLECT_LAYER)
    })

    var clipping = Actors.createBaseClippingPlanes(BASE.half)
    this.traffic = withGeometryCache(geometryCache, function () { return new Actors.MachiTraffic(materials, blend, clipping, KONBINI_LANES, LEVEL.road) })
    // 门口三面旗：门左边的场地边上，避开自行车；布面朝前右（大致对着默认镜头），旗杆在左。
    this.nobori = new Actors.MachiNobori(materials, [-3.25, -2.5, -1.78].map(function (x) {
      return { x: x, y: LEVEL.lot, z: 1.9, rotationY: 0.35 }
    }))
    var lamp = props.streetLampHead
    this.lightCones = new Lights.MachiLightCones(materials, blend, [
      { apex: lamp, target: new THREE.Vector3(lamp.x - 0.2, LEVEL.road, lamp.z), radius: 1.65, gain: 1 }
    ])
    this.steam = new Lights.MachiSteam(materials, blend, [
      { position: new THREE.Vector3(-2.4, LEVEL.road + 0.02, (ROAD.inner + ROAD.outer) / 2 + 0.3), puffs: 7, period: 4.4, size: 1 },
      { position: new THREE.Vector3(PROPS.roofAc[0].x - 0.12, STORE.roofTop + 0.68, PROPS.roofAc[0].z + 0.2), puffs: 5, period: 3.3, size: 0.6 }
    ])
    this.root.add(this.world, this.lights.group, this.signs.group, this.traffic.group, this.nobori.group, this.lightCones.mesh, this.steam.mesh)

    var boardFront = new THREE.Vector3(Math.sin(BOARD.azimuth), 0, Math.cos(BOARD.azimuth)).multiplyScalar(BOARD.faceWidth / (2 * Math.sqrt(3)) + 0.8)
    this.weather = {
      half: BASE.half,
      groundY: LEVEL.lot * 0.5,
      roofs: [{ x0: STORE.x0 - STORE.overhang, z0: STORE.z0 - STORE.overhang, x1: STORE.x1 + STORE.overhang, z1: STORE.z1 + STORE.overhang, y: STORE.roofTop }],
      drips: konbiniDrips(),
      // 落进灯光里的雨丝被照亮：路灯光柱、店门口、广告屏前。
      glints: [
        { position: new THREE.Vector3(lamp.x - 0.2, 2.4, lamp.z), radius: 1.7 },
        { position: new THREE.Vector3((STORE.frontPillarEnd + STORE.x1) / 2, 1.5, STORE.z1 + 0.9), radius: 2.0 },
        { position: new THREE.Vector3(BOARD.cx + boardFront.x, BOARD.y0 + BOARD.faceHeight * 0.55, BOARD.cz + boardFront.z), radius: 2.1 }
      ],
      windYaw: variation.windYaw,
      windSlant: variation.windSlant
    }
    this.framing = { points: framingPoints(), view: { azimuth: KONBINI_VIEW.azimuth, elevation: KONBINI_VIEW.elevation, zoom: KONBINI_VIEW.zoom } }
    // 雾里的两处灯：店门口、路灯下。
    this.glowA = new THREE.Vector4((STORE.frontPillarEnd + STORE.x1) / 2 + 0.6, 0, STORE.z1 + 0.9, 3.4)
    this.glowB = new THREE.Vector4(lamp.x, 0, lamp.z, 2.3)
    this.syncColors()
    context.invalidateShadows()
  }

  /** 换歌 / 换主题：重画招牌、重画旗。 */
  KonbiniScene.prototype.setContent = function (content) {
    this.signs.setContent(content)
    var icons = content.icons
    var palette = content.palette
    this.nobori.paint({
      font: content.font,
      fallbacks: content.fallbacks,
      faces: [
        { background: palette.brand[0], ink: '#ffffff', text: content.song.title || content.song.album || '町景' },
        { background: palette.brand[2], ink: '#ffffff', text: (content.theme.provider === 'AI' ? content.theme.name : '') || '新発売', icon: icons[0] },
        { background: palette.brand[1], ink: palette.signText, text: 'おでん' }
      ]
    })
  }

  /** 换歌：seed 变了重建自行车和伞，重算开门时刻表，重画招牌。 */
  KonbiniScene.prototype.swapSong = function (song, content) {
    var seedChanged = song.seed !== this.song.seed
    this.song = song
    this.variation = resolveKonbiniVariation(song.seed)
    if (seedChanged) this.rebuildSongProps()
    this.doorEvents = buildKonbiniDoorEvents(song.lines, this.variation)
    this.setContent(content)
  }

  /** 换歌：按新 seed 重建自行车和伞（只有这一组跟着歌变几何）。 */
  KonbiniScene.prototype.rebuildSongProps = function () {
    var shared = new Set(this.context.geometryCache.values())
    this.songProps.removeFromParent()
    var self = this
    this.songProps.traverse(function (object) {
      if (object instanceof THREE.Mesh && !shared.has(object.geometry)) object.geometry.dispose()
    })
    var holder = new THREE.Group()
    var next = withGeometryCache(this.context.geometryCache, function () {
      return buildKonbiniSongProps(self.context.materials, self.variation)
    })
    holder.add(next)
    bakeStatic(holder)
    next.removeFromParent()
    this.world.add(next)
    this.songProps = next
    this.context.invalidateShadows()
  }

  /** 每帧推进：牌面、门、灯、车、旗、白气、光柱、风扇、雾里的灯。 */
  KonbiniScene.prototype.direct = function (frame) {
    var songTime = frame.songTime
    var ambientTime = frame.ambientTime
    var chorus = frame.chorus
    var staticMode = frame.staticMode
    if (frame.targetChanged) this.signs.showBoard(frame.target, frame.lines, frame.immediate, frame.showText)
    else if (frame.preheat) this.signs.preheat(frame.preheat, frame.lines, frame.showText)
    var environment = frame.environment
    var look = frame.look
    var streetFlicker = staticMode ? 1 : Director.resolveMachiFlicker(ambientTime + 3.1, frame.seed + ':street', 0.45)
    // 白天店里的灯弱下去，路灯熄掉；光柱、地上的光斑、雾里的灯跟着。
    var street = look.streetLamps * (0.75 + 0.25 * streetFlicker)
    var openness = resolveKonbiniDoorOpenness(this.doorEvents, songTime, this.variation, this.song.isInstrumental || frame.lines.length === 0)
    if (Math.abs(openness - this.doorOpenness) > 1e-4) {
      this.doorOpenness = openness
      // 门动一下就重画整张阴影图太贵：门走过一小段、或者停在全开 / 全关时才重画，门板本身每帧照常走。
      var settled = openness === 0 || openness === 1
      if (Math.abs(openness - this.shadowDoorOpenness) >= DOOR_SHADOW_STEP || (settled && openness !== this.shadowDoorOpenness)) {
        this.shadowDoorOpenness = openness
        this.context.invalidateShadows()
      }
    }
    // 霓虹随拍（智能动感模式）：店里的灯（连同它投在地上的光斑）跟着小节慢慢涨落，店招上沿的霓虹边是第二组霓虹；
    // 地面干时光斑跟鼓点跳。
    var beat = frame.beat
    var interiorLevel = (1 + 0.1 * chorus + 0.06 * this.doorOpenness) * look.artificial * beat.warm
    this.lights.setLevels({ interior: interiorLevel, street: street, pools: (1 - 0.85 * environment.daylight) * (1 + beat.thump) })
    this.context.materials.setGlowLevel('neonRim', (0.75 + 0.25 * frame.flicker) * (1 + 0.4 * chorus) * look.artificial * BeatFx.machiNeonGroup(beat, 1))
    this.context.materials.setGlowLevel('lampHead', 0.15 + 0.85 * look.streetLamps)
    // 会动的东西：车按氛围时钟，旗随风飘，白气、光柱慢慢流。静态模式下街上没有车，场景是一张定格的画。
    this.traffic.group.visible = !staticMode
    this.traffic.update(ambientTime, frame.seed, frame.trafficChance)
    this.nobori.update(ambientTime, 0.35 + 0.65 * Math.min(1, frame.rain))
    this.lightCones.update(ambientTime, street * (1 - 0.6 * environment.daylight))
    this.steam.update(ambientTime, frame.atmosphere.wind)
    var atmosphere = frame.atmosphere
    atmosphere.glowA.copy(this.glowA)
    atmosphere.glowB.copy(this.glowB)
    var night = 1 - 0.85 * environment.daylight
    atmosphere.glowColorA.copy(this.context.blend.get('interiorLight')).multiplyScalar(0.55 * interiorLevel * night)
    atmosphere.glowColorB.copy(this.context.blend.get('streetLight')).multiplyScalar(0.42 * street * night)
    this.signs.update({
      songTime: songTime,
      ambientTime: ambientTime,
      delta: frame.delta,
      staticMode: staticMode,
      chorus: chorus,
      audio: frame.audio,
      flicker: frame.flicker,
      beat: beat
    })
    // 风扇转、自动门滑开。
    var variation = this.variation
    this.fans.forEach(function (fan, index) {
      fan.rotation.z = -ambientTime * (variation.fanSpeed + index * 0.37) * Math.PI * 2
    })
    var doorOpenness = this.doorOpenness
    this.doorPanels.forEach(function (panel) {
      panel.object.position.x = panel.closedX + panel.direction * 0.86 * doorOpenness
    })
  }

  /** 插值后的颜色写回材质、灯、车、光柱、白气与商品实例色。 */
  KonbiniScene.prototype.syncColors = function () {
    this.context.materials.syncColors()
    this.lights.sync()
    this.traffic.syncColors()
    this.lightCones.syncColors()
    this.steam.syncColors()
    var color = new THREE.Color()
    var blend = this.context.blend
    this.productBatches.forEach(function (batch) {
      for (var index = 0; index < batch.colorIndex.length; index += 1) {
        color.copy(blend.get('product' + batch.colorIndex[index])).multiplyScalar(batch.shade[index])
        batch.mesh.setColorAt(index, color)
      }
      if (batch.mesh.instanceColor) batch.mesh.instanceColor.needsUpdate = true
    })
  }

  Object.defineProperty(KonbiniScene.prototype, 'busy', {
    /** 屏幕上有换牌面动画：暂停时也要继续出帧。 */
    get: function () { return this.signs.busy }
  })

  /** 调试钩子用：从氛围时间 from 往后找下一辆开到路中间的车。 */
  KonbiniScene.prototype.nextCar = function (from, seed, chance) {
    for (var t = from; t < from + 120; t += 0.04) {
      var car = Actors.resolveMachiCar(t, seed, KONBINI_LANES, chance)
      if (car && Math.abs(car.distance - LANE_REACH) < 0.3) return t
    }
    return null
  }

  KonbiniScene.prototype.dispose = function () {
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
    this.context.materials.dispose()
    this.root.removeFromParent()
  }

  /** 场景定义：resolveArt（场景自己的颜色表）+ create（装配整个场景）。 */
  var KONBINI_SCENE = {
    resolveArt: resolveKonbiniArt,
    create: function (context) { return new KonbiniScene(context) }
  }

  // ===== 导出 =====
  // 该目录全部顶层导出（名字保持上游原名），外加 paragraphStructure 随场景带的一份。
  var exports = {
    // layout.ts
    DEG: DEG,
    BASE: BASE,
    LEVEL: LEVEL,
    ROAD: ROAD,
    STORE: STORE,
    DOOR: DOOR,
    FASCIA: FASCIA,
    BOARD: BOARD,
    KONBINI_VIEW: KONBINI_VIEW,
    PROPS: PROPS,
    groundHeightAt: groundHeightAt,
    // paragraphStructure.ts（konbiniDoor 的依赖，随场景带一份）
    DEFAULT_PARAGRAPH_STRUCTURE_PARAMS: DEFAULT_PARAGRAPH_STRUCTURE_PARAMS,
    buildStructureLines: buildStructureLines,
    resolveParagraphGapThreshold: resolveParagraphGapThreshold,
    draftParagraphs: draftParagraphs,
    // konbiniSeed.ts
    resolveKonbiniVariation: resolveKonbiniVariation,
    // konbiniDoor.ts
    KONBINI_DOOR_TIMING: KONBINI_DOOR_TIMING,
    buildKonbiniDoorEvents: buildKonbiniDoorEvents,
    resolveKonbiniDoorOpenness: resolveKonbiniDoorOpenness,
    // base.ts
    buildKonbiniBase: buildKonbiniBase,
    // interior.ts
    buildKonbiniInterior: buildKonbiniInterior,
    // store.ts
    buildKonbiniStore: buildKonbiniStore,
    // props.ts
    buildKonbiniSongProps: buildKonbiniSongProps,
    buildKonbiniProps: buildKonbiniProps,
    // konbiniLights.ts
    KonbiniLights: KonbiniLights,
    // konbiniScene.ts
    KONBINI_SCENE: KONBINI_SCENE
  }
  // 招牌画法与招牌装配在 scene-konbini-paint.js（konbiniSignPaint.ts + konbiniSigns.ts），
  // 这里按 getter 转发，两个文件的加载顺序不受限。
  ;['paintKonbiniFascia', 'paintKonbiniPylon', 'paintKonbiniPoster', 'paintKonbiniRoofLogo', 'paintKonbiniNeon', 'paintKonbiniAFrame', 'KonbiniSigns'].forEach(function (key) {
    Object.defineProperty(exports, key, {
      get: function () { return window.FoliaMachiSceneKonbiniPaint[key] }
    })
  })

  window.FoliaMachiSceneKonbini = exports
})()
