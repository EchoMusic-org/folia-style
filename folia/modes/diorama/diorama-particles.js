// 镜台（diorama）模式·粒子系统模块：移植自 folia-major src/components/visualizer/diorama/
//   dioramaParticleSurfaces.ts（全文：焊接点阵曲面）
//   dioramaParticleModel.ts（全文：确定性点缓冲 + 音频包络/纹波带跟踪）
//   dioramaParticleShaders.ts（全文：GLSL 照搬，插值表达式逐一保留）
//   dioramaParticleMaterials.ts（全文：对比层/辉光层材质 + WCAG 色彩适配）
// 依赖：window.THREE、window.FoliaDioramaCore。挂载于 window.FoliaDioramaParticles。
(function () {
  'use strict'

  var Core = window.FoliaDioramaCore
  var clamp01 = Core.clamp01

  // ═══════════ dioramaParticleSurfaces.ts 全文 ═══════════

  var surfaceCache = new Map()
  var TWO_PI = Math.PI * 2

  var BOX_HALF = 0.55
  var CYLINDER_RADIUS = 0.58
  var CYLINDER_HALF_HEIGHT = 0.75
  var TORUS_MAJOR = 0.68
  var TORUS_TUBE = 0.12
  var TETRA_VERTICES = [
    [0, 0.86, 0],
    [-0.81, -0.5, 0.47],
    [0.81, -0.5, 0.47],
    [0, -0.5, -0.94]
  ]
  var TETRA_FACES = [[0, 1, 2], [0, 2, 3], [0, 3, 1], [1, 3, 2]]
  var TETRA_CENTER = [0, -0.16, 0]

  function latticePush(out, p, n) {
    out.positions.push(p[0], p[1], p[2])
    out.normals.push(n[0], n[1], n[2])
  }

  function latticeUnit(x, y, z) {
    var length = Math.hypot(x, y, z) || 1
    return [x / length, y / length, z / length]
  }

  /**
   * 平面基元（box、四面体）的外向方向：从形体中心径向直出。这是可用的最平滑连续场——
   * 面中心处等于真实面法线，向棱边渐倾，形变时弹性鼓胀而非沿各自法线滑裂。
   */
  function radialNormal(p, center) {
    if (center === undefined) center = [0, 0, 0]
    return latticeUnit(p[0] - center[0], p[1] - center[1], p[2] - center[2])
  }

  function countBoxShell(across, tall) {
    return 2 * (across * tall + tall * across + across * across) - 4 * (across + tall + across) + 8
  }

  /** 预算内最大的壳，且 yStretch 作用后仍均匀取样。 */
  function resolveBoxShell(budget, stretchY) {
    var best = [2, 2]
    for (var across = 2; across <= 96; across += 1) {
      var tall = Math.max(2, Math.round(1 + (across - 1) * stretchY))
      if (countBoxShell(across, tall) > budget) break
      best = [across, tall]
    }
    return best
  }

  /** 一个闭合壳：每条棱/每个角的点恰好存在一次，由相会面共享（焊接）。 */
  function buildBoxSurface(budget, stretchY, out) {
    var shell = resolveBoxShell(budget, stretchY)
    var across = shell[0]
    var tall = shell[1]
    var axis = function (index, steps) { return (index / (steps - 1) - 0.5) * 2 * BOX_HALF }
    // 壳在规则网格上取样；最宽步长即三轴中最粗者
    out.spacing = (2 * BOX_HALF) / Math.max(1, Math.min(across, tall) - 1)
    for (var iy = 0; iy < tall; iy += 1) {
      for (var iz = 0; iz < across; iz += 1) {
        for (var ix = 0; ix < across; ix += 1) {
          var interior = ix > 0 && ix < across - 1
            && iy > 0 && iy < tall - 1
            && iz > 0 && iz < across - 1
          if (interior) continue
          var p = [axis(ix, across), axis(iy, tall), axis(iz, across)]
          latticePush(out, p, radialNormal(p))
        }
      }
    }
  }

  /** 环形网格：本身已焊接（角度回卷），径向法线已连续。 */
  function buildCylinderSurface(budget, stretchY, out) {
    // 在拉伸后的壁上追求方形单元：周长 vs 拉伸高度
    var aspect = (TWO_PI * CYLINDER_RADIUS) / (2 * CYLINDER_HALF_HEIGHT * Math.max(0.2, stretchY))
    var rows = Math.max(2, Math.round(Math.sqrt(budget / Math.max(0.1, aspect))))
    var columns = Math.max(3, Math.floor(budget / rows))
    // 行在未拉伸壁上等距（场读未拉伸位置），列按弧长
    out.spacing = Math.max(
      (2 * CYLINDER_HALF_HEIGHT) / (rows - 1),
      (TWO_PI * CYLINDER_RADIUS) / columns
    )
    for (var row = 0; row < rows; row += 1) {
      var y = (row / (rows - 1) - 0.5) * 2 * CYLINDER_HALF_HEIGHT
      for (var column = 0; column < columns; column += 1) {
        var angle = (column / columns) * TWO_PI
        var cosine = Math.cos(angle)
        var sine = Math.sin(angle)
        latticePush(out, [cosine * CYLINDER_RADIUS, y, sine * CYLINDER_RADIUS], [cosine, 0, sine])
      }
    }
  }

  /**
   * 含边界的重心点阵：四个面在六条共享棱上落点完全一致。这些重合点不去做重：
   * 位移是位置的纯函数，它们永远一起移动，读作一个点。
   */
  function buildTetrahedronSurface(budget, out) {
    var steps = 1
    while (TETRA_FACES.length * (((steps + 2) * (steps + 3)) / 2) <= budget) steps += 1
    // 该顶点集的正四面体每条棱约 1.63 长，切成 steps 段
    out.spacing = Math.hypot(
      TETRA_VERTICES[0][0] - TETRA_VERTICES[1][0],
      TETRA_VERTICES[0][1] - TETRA_VERTICES[1][1],
      TETRA_VERTICES[0][2] - TETRA_VERTICES[1][2]
    ) / steps
    for (var f = 0; f < TETRA_FACES.length; f += 1) {
      var face = TETRA_FACES[f]
      var a = TETRA_VERTICES[face[0]]
      var b = TETRA_VERTICES[face[1]]
      var c = TETRA_VERTICES[face[2]]
      for (var i = 0; i <= steps; i += 1) {
        for (var j = 0; j <= steps - i; j += 1) {
          var wa = i / steps
          var wb = j / steps
          var wc = 1 - wa - wb
          var p = [
            a[0] * wa + b[0] * wb + c[0] * wc,
            a[1] * wa + b[1] * wb + c[1] * wc,
            a[2] * wa + b[2] * wb + c[2] * wc
          ]
          latticePush(out, p, radialNormal(p, TETRA_CENTER))
        }
      }
    }
  }

  /** 已焊接（两角度均回卷），管法线已是平滑场。 */
  function buildTorusSurface(budget, out) {
    var minor = Math.max(4, Math.round(Math.sqrt(budget / 4)))
    var major = Math.max(6, Math.floor(budget / minor))
    out.spacing = Math.max(
      (TWO_PI * (TORUS_MAJOR + TORUS_TUBE)) / major,
      (TWO_PI * TORUS_TUBE) / minor
    )
    for (var i = 0; i < major; i += 1) {
      var majorAngle = (i / major) * TWO_PI
      var majorCosine = Math.cos(majorAngle)
      var majorSine = Math.sin(majorAngle)
      for (var j = 0; j < minor; j += 1) {
        var minorAngle = (j / minor) * TWO_PI
        var minorCosine = Math.cos(minorAngle)
        var minorSine = Math.sin(minorAngle)
        var radius = TORUS_MAJOR + TORUS_TUBE * minorCosine
        latticePush(
          out,
          [radius * majorCosine, TORUS_TUBE * minorSine, radius * majorSine],
          [minorCosine * majorCosine, minorSine, minorCosine * majorSine]
        )
      }
    }
  }

  function buildDioramaStructuredSurface(kind, budget, stretchY) {
    if (stretchY === undefined) stretchY = 1
    // 拉伸分桶：连续滑条也只命中小而稳定的点阵缓存
    var stretchKey = Math.round(Math.max(0.2, stretchY) * 4) / 4
    var cacheKey = kind + ':' + budget + ':' + stretchKey
    var cached = surfaceCache.get(cacheKey)
    if (cached) return cached

    var out = { positions: [], normals: [], spacing: 0 }
    if (kind === 'box') buildBoxSurface(budget, stretchKey, out)
    else if (kind === 'sphere') buildCylinderSurface(budget, stretchKey, out)
    else if (kind === 'cone') buildTetrahedronSurface(budget, out)
    else buildTorusSurface(budget, out)

    var positions = Float32Array.from(out.positions)
    var normals = Float32Array.from(out.normals)
    var count = positions.length / 3
    var total = 0
    for (var index = 0; index < count; index += 1) {
      total += Math.hypot(positions[index * 3], positions[index * 3 + 1], positions[index * 3 + 2])
    }
    var radius = count > 0 ? total / count : 1
    var surface = {
      positions: positions,
      normals: normals,
      radius: radius,
      count: count,
      // 换算到着色器读取场的单位空间（position / radius）
      spacing: out.spacing / radius
    }
    surfaceCache.set(cacheKey, surface)
    return surface
  }

  // ═══════════ dioramaParticleModel.ts 全文 ═══════════

  var DIORAMA_MAX_PARTICLE_POINTS = 65536
  // 每单元点数是固定的（只随密度滑条），不按当前挂载单元数摊薄——
  // 避免每次切行突变更密化：同一云/隧道段的加密在邻居数量变化时逐像素一致。
  var DIORAMA_MAX_CLOUD_POINTS_PER_CLUSTER = 1024
  var DIORAMA_MAX_CORRIDOR_POINTS_PER_SPAN = 2048

  var FAMILY_INDEX = { box: 0, sphere: 1, cone: 2, torus: 3 }

  function normalizeDensity(density) {
    var clamped = Math.min(Core.DIORAMA_PARTICLE_DENSITY_MAX, Math.max(Core.DIORAMA_PARTICLE_DENSITY_MIN, density))
    return Math.max(
      Core.DIORAMA_PARTICLE_DENSITY_MIN,
      Math.floor(clamped / Core.DIORAMA_PARTICLE_DENSITY_STEP) * Core.DIORAMA_PARTICLE_DENSITY_STEP
    )
  }

  /**
   * 该间距的点阵能承载的最短波长（以波数计，k = 2π/波长）。
   * 每波长 4 个采样是实际下限：两个采样会把波峰读成散点。
   * 由实际点阵推导，密度滑条诚实地升降细节上限。
   */
  function resolveWaveNumberMax(spacing) {
    return (Math.PI * 2) / Math.max(1e-4, spacing * 4)
  }

  function allocate(pointCount, pointsPerUnit, spacing) {
    return {
      positions: new Float32Array(pointCount * 3),
      normals: new Float32Array(pointCount * 3),
      anchors: new Float32Array(pointCount * 3),
      scales: new Float32Array(pointCount * 3),
      phases: new Float32Array(pointCount),
      styles: new Float32Array(pointCount * 3),
      waves: new Float32Array(pointCount * 2),
      pointCount: pointCount,
      pointsPerUnit: pointsPerUnit,
      spacing: spacing
    }
  }

  function writeStyle(data, index, family, colorSlot, isFar) {
    var offset = index * 3
    data.styles[offset] = family
    data.styles[offset + 1] = colorSlot
    data.styles[offset + 2] = isFar
  }

  /** 把每个可见构图锚展开为确定性表面点阵（'clouds' 模式）。 */
  function buildDioramaCloudGeometryData(clusters, density) {
    // 预算与单元数无关（只随密度滑条），每个焊接点阵在其下落到自己的诚实点数
    var budget = normalizeDensity(Math.min(density, DIORAMA_MAX_CLOUD_POINTS_PER_CLUSTER))
    var surfaces = clusters.map(function (cluster) {
      return buildDioramaStructuredSurface(cluster.kind, budget, cluster.stretchY)
    })
    var pointCount = surfaces.reduce(function (sum, surface) { return sum + surface.count }, 0)
    // 共享一个缓冲绘制所有簇，细节上限必须满足在场最粗的点阵
    var spacing = surfaces.reduce(function (widest, surface) { return Math.max(widest, surface.spacing) }, 0)
    var data = allocate(pointCount, budget, spacing)

    var target = 0
    clusters.forEach(function (cluster, clusterIndex) {
      var surface = surfaces[clusterIndex]
      var seed = Core.hashSeed(cluster.particleSeed + '|' + cluster.kind)
      // 共享相位让一簇的每个顶点都在同一个连贯纹波场内
      var clusterPhase = Core.seededUnit(seed + 31) * Math.PI * 2
      var family = FAMILY_INDEX[cluster.kind]
      var isFar = cluster.layer === 'far' ? 1 : 0
      for (var pointIndex = 0; pointIndex < surface.count; pointIndex += 1) {
        var v = target * 3
        var s = target * 3
        var px = surface.positions[pointIndex * 3]
        var py = surface.positions[pointIndex * 3 + 1]
        var pz = surface.positions[pointIndex * 3 + 2]
        data.positions[v] = px
        data.positions[v + 1] = py
        data.positions[v + 2] = pz
        data.normals[v] = surface.normals[pointIndex * 3]
        data.normals[v + 1] = surface.normals[pointIndex * 3 + 1]
        data.normals[v + 2] = surface.normals[pointIndex * 3 + 2]
        data.anchors[v] = cluster.position.x
        data.anchors[v + 1] = cluster.position.y
        data.anchors[v + 2] = cluster.position.z
        data.scales[s] = cluster.scale
        data.scales[s + 1] = cluster.stretchY
        data.scales[s + 2] = surface.radius
        data.phases[target] = clusterPhase
        // 云不再以此坐标波动——纹波场是位置的纯函数。它只作为溶散的逐点种子存活
        data.waves[target * 2] = clusterPhase + (px + pz * 0.6) * 2.2
        data.waves[target * 2 + 1] = clusterPhase * 0.7 + py * 2.6
        writeStyle(data, target, family, cluster.colorSlot, isFar)
        target += 1
      }
    })
    return data
  }

  function normalizeVec(x, y, z) {
    var length = Math.hypot(x, y, z) || 1
    return { x: x / length, y: y / length, z: z / length }
  }

  // 环段数随每 span 预算增长，任何密度下隧道壁都均匀细分且不超预算
  function resolveRingSegments(pointsPerSpan) {
    return Math.max(12, Math.min(256, Math.round(Math.sqrt(pointsPerSpan * 2.4))))
  }

  /**
   * 把规则环形网格沿挂载路径 span 直向扫掠（'corridor' 模式）。环心走精确路径中心、
   * 半径恒定——真正的圆柱。确定性：相同 span 给出相同缓冲。
   */
  function buildDioramaCorridorGeometryData(spans, density, radius) {
    if (radius === undefined) radius = window.FoliaDioramaSequencer.DIORAMA_PARTICLE_CORRIDOR_RADIUS
    var activeSpans = spans.filter(function (span) { return span.enabled })
    var spanCount = activeSpans.length
    var pointsPerSpan = normalizeDensity(Math.min(density, DIORAMA_MAX_CORRIDOR_POINTS_PER_SPAN))
    var ringSegments = resolveRingSegments(pointsPerSpan)
    var rings = Math.max(1, Math.floor(pointsPerSpan / ringSegments))
    var perSpan = ringSegments * rings
    var pointCount = spanCount * perSpan
    // 一个 span 跨 DIORAMA_STEP_DISTANCE 路径；换算成半径单位后切成 rings。周向间隙是环弧。
    var spanUnits = Core.DIORAMA_STEP_DISTANCE / radius
    var spacing = Math.max(spanUnits / Math.max(1, rings), (Math.PI * 2) / ringSegments)
    var data = allocate(pointCount, perSpan, spacing)

    var target = 0
    activeSpans.forEach(function (span) {
      for (var ring = 0; ring < rings; ring += 1) {
        // 沿 span 的深度；整环共享一个中心与基，保持正圆
        var t = rings > 1 ? ring / (rings - 1) : 0.5
        var cx = span.start.x + (span.end.x - span.start.x) * t
        var cy = span.start.y + (span.end.y - span.start.y) * t
        var cz = span.start.z + (span.end.z - span.start.z) * t
        var right = normalizeVec(
          span.startRight.x + (span.endRight.x - span.startRight.x) * t,
          span.startRight.y + (span.endRight.y - span.startRight.y) * t,
          span.startRight.z + (span.endRight.z - span.startRight.z) * t
        )
        var up = normalizeVec(
          span.startUp.x + (span.endUp.x - span.startUp.x) * t,
          span.startUp.y + (span.endUp.y - span.startUp.y) * t,
          span.startUp.z + (span.endUp.z - span.startUp.z) * t
        )
        // 绝对纵向（全局路径坐标）：波相位与世界截面绑定，挂载窗口滑动时隧道不滚
        var longitudinal = span.pathStart + t
        for (var segment = 0; segment < ringSegments; segment += 1) {
          var angle = (segment / ringSegments) * Math.PI * 2
          var cos = Math.cos(angle)
          var sin = Math.sin(angle)
          var radial = normalizeVec(
            right.x * cos + up.x * sin,
            right.y * cos + up.y * sin,
            right.z * cos + up.z * sin
          )
          var v = target * 3
          var s = target * 3
          data.positions[v] = radial.x * radius
          data.positions[v + 1] = radial.y * radius
          data.positions[v + 2] = radial.z * radius
          data.normals[v] = radial.x
          data.normals[v + 1] = radial.y
          data.normals[v + 2] = radial.z
          data.anchors[v] = cx
          data.anchors[v + 1] = cy
          data.anchors[v + 2] = cz
          data.scales[s] = 1
          data.scales[s + 1] = 1
          // 隧道自身尺寸，让它的鼓胀与云是同样的"半径占比"
          data.scales[s + 2] = radius
          // 相位不带角度项：整环共享一个相位，作为刚体环整体摇摆
          data.phases[target] = longitudinal * 1.7
          // 波坐标 =（沿隧道【半径单位】, 绕环角度）——着色器负责角度回卷
          data.waves[target * 2] = longitudinal * spanUnits
          data.waves[target * 2 + 1] = angle
          // 沿隧道缓慢交替的色带（按绝对路径坐标，窗口滑动时稳定）
          writeStyle(data, target, 3, (Math.round(span.pathStart) + ring) % 2, 0)
          target += 1
        }
      }
    })
    return data
  }

  /** 两种模式共用的单次 draw call 几何；持有者在替换或卸载时释放。 */
  function createDioramaBufferGeometry(data) {
    var THREE = window.THREE
    var geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(data.positions, 3))
    geometry.setAttribute('aNormal', new THREE.BufferAttribute(data.normals, 3))
    geometry.setAttribute('aAnchor', new THREE.BufferAttribute(data.anchors, 3))
    geometry.setAttribute('aScale', new THREE.BufferAttribute(data.scales, 3))
    geometry.setAttribute('aPhase', new THREE.BufferAttribute(data.phases, 1))
    geometry.setAttribute('aStyle', new THREE.BufferAttribute(data.styles, 3))
    geometry.setAttribute('aWave', new THREE.BufferAttribute(data.waves, 2))
    geometry.setDrawRange(0, data.pointCount)
    return geometry
  }

  function stepDioramaEnvelope(current, target, attack, release, delta) {
    return current + (target - current) * (1 - Math.exp(-(target > current ? attack : release) * delta))
  }

  /**
   * 分带跟踪器：分别跟踪谷与峰（各自不对称），对持续节拍保持敏感度。
   *   floor 升慢降快——鼓点太短拖不起它，落在鼓点间隙；鼓点停止时 ~0.25s 内自行塌落。
   *   peak 升快降慢（~3.5s 记忆）——唯一自适应部分，只适应歌的响度。
   * transient = (fast - floor) / (peak - floor)：响度不变的鼓点强度。
   * sustained = fast / peak：该带相对全歌的持续能量。
   */
  function createDioramaBandTracker() {
    return { fast: 0, floor: 0, peak: 0, armed: false, primed: false }
  }

  var FAST_ATTACK = 22
  var FAST_RELEASE = 7
  var FLOOR_RISE = 2.5
  var FLOOR_FALL = 4
  var PEAK_RISE = 9
  var PEAK_FALL = 0.28
  var MIN_RANGE = 0.12
  var MIN_PEAK = 0.22
  // 迟滞：越过 HIGH 触发一次，回落到 LOW 以下才重新武装
  var TRIGGER_HIGH = 0.42
  var TRIGGER_LOW = 0.2

  function stepDioramaBandTracker(state, level, delta) {
    var safe = clamp01(level)
    if (!state.primed) {
      // 从信号上起步而非零起步：否则前几帧读出无人能及的满幅瞬态
      state.fast = safe
      state.floor = safe
      state.peak = safe
      state.primed = true
    } else {
      state.fast = stepDioramaEnvelope(state.fast, safe, FAST_ATTACK, FAST_RELEASE, delta)
      state.floor = stepDioramaEnvelope(state.floor, safe, FLOOR_RISE, FLOOR_FALL, delta)
      state.peak = stepDioramaEnvelope(state.peak, safe, PEAK_RISE, PEAK_FALL, delta)
    }
    var range = Math.max(MIN_RANGE, state.peak - state.floor)
    var transient = clamp01((state.fast - state.floor) / range)
    var sustained = clamp01(state.fast / Math.max(MIN_PEAK, state.peak))
    var onset = false
    if (!state.armed && transient >= TRIGGER_HIGH) {
      state.armed = true
      onset = true
    } else if (state.armed && transient <= TRIGGER_LOW) {
      state.armed = false
    }
    return { transient: transient, sustained: sustained, onset: onset }
  }

  /**
   * 每个频段催生自己尺度的纹波：低音慢而宽的长波，高音小而快的紧波。
   * 宽度/速度以几何自身半径为单位。强度在包络之前声明（包络会吃掉约八成）。
   * 波数是请求而非承诺：着色器按点阵真实间距钳制（uWaveNumberMax）。
   */
  var RIPPLE_BANDS = [
    { band: 'bass', strength: 1.45, speed: 0.9, width: 0.66, wavenumber: 3.4 },
    { band: 'mid', strength: 0.9, speed: 1.6, width: 0.36, wavenumber: 5.5 },
    { band: 'treble', strength: 0.5, speed: 2.5, width: 0.22, wavenumber: 9 }
  ]

  /** 每个频段私有的槽位数——带内轮转，一个低音波只被下一个低音波替换。 */
  var RIPPLE_SLOTS_PER_BAND = 3

  /** 同时携带的活纹波源总数。着色器 uniform 数组 / 材质缓冲 / CPU 池都必须等长。 */
  var DIORAMA_RIPPLE_COUNT = RIPPLE_BANDS.length * RIPPLE_SLOTS_PER_BAND

  function smoothstep(edge0, edge1, value) {
    var amount = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)))
    return amount * amount * (3 - 2 * amount)
  }

  /**
   * 两个整体行为：隧道漂移骑持续低音，节拍缩放骑瞬态。
   * 把持续值喂给脉冲会抹掉节拍。
   */
  function resolveDioramaParticleAudioResponse(bass, mid) {
    return {
      flowSpeed: Math.min(1.55, 0.3 + clamp01(bass.sustained) * 1.25),
      // 节拍上的轻柔整体呼吸——刻意很小，让波场而非整体缩放泵承载运动
      clusterPulse: Math.min(
        Core.DIORAMA_PARTICLE_AUDIO_SCALE_MAX,
        1 + smoothstep(0.1, 0.9, bass.transient) * 0.14 + smoothstep(0.15, 0.95, mid.transient) * 0.05
      )
    }
  }

  /** 隧道保留的整体脉冲占比（隧道壁的统一缩放读作机械收缩，只留痕迹）。 */
  var DIORAMA_CORRIDOR_PULSE_SHARE = 0.12

  /** 每帧节拍要求的整体缩放。云全保；隧道只保留 DIORAMA_CORRIDOR_PULSE_SHARE。 */
  function resolveDioramaPulseTarget(clusterPulse, gain, isCorridor) {
    return 1 + (clusterPulse - 1) * gain * (isCorridor ? DIORAMA_CORRIDOR_PULSE_SHARE : 1)
  }

  function createDioramaParticleElasticState() {
    return { value: 1, velocity: 0 }
  }

  /** 欠阻尼弹簧：节拍落成过冲回弹，而非僵硬吸附。 */
  function stepDioramaParticleElasticResponse(state, target, delta) {
    var remaining = Math.min(0.1, Math.max(0, delta))
    var safeTarget = Math.min(Core.DIORAMA_PARTICLE_AUDIO_SCALE_MAX, Math.max(0.9, target))
    while (remaining > 0) {
      var step = Math.min(1 / 240, remaining)
      var acceleration = (safeTarget - state.value) * 150 - state.velocity * 15
      state.velocity += acceleration * step
      state.value += state.velocity * step
      remaining -= step
    }
    state.value = Math.min(Core.DIORAMA_PARTICLE_AUDIO_SCALE_MAX, Math.max(0.9, state.value))
    return state.value
  }

  // ═══════════ dioramaParticleShaders.ts 全文（GLSL 照搬） ═══════════

  // 顶点着色器：RIPPLE_COUNT 与生命周期常量的插值表达式逐一保留
  var DIORAMA_PARTICLE_VERTEX_SHADER = '\
#define RIPPLE_COUNT ' + DIORAMA_RIPPLE_COUNT + '\n\
\n\
attribute vec3 aNormal;\n\
attribute vec3 aAnchor;\n\
attribute vec3 aScale;   // (uniformScale, yStretch, localRadius = 该基元自身尺寸)\n\
attribute float aPhase;\n\
attribute vec3 aStyle;\n\
attribute vec2 aWave;    // corridor: (隧道沿向[半径单位], 绕环角度)。clouds: 溶散种子\n\
\n\
uniform float uTime;\n\
uniform float uCorridor;      // 0 = 构图云, 1 = 路径隧道\n\
uniform float uAmplitude;     // 每 unit swell 的位移，占基元自身半径的比例\n\
uniform float uMaxSwell;      // 计为满幅到达的位移——归一化 d\n\
uniform float uWaveNumberMax; // 本缓冲点阵不产生混频的最细波数\n\
uniform float uDetail;        // 0..1 持续高音：仅在已有波峰上的细纹理\n\
uniform vec4 uRippleSource[RIPPLE_COUNT];  // 原点, w = 诞生时间\n\
uniform vec4 uRippleShape[RIPPLE_COUNT];   // x = 强度, y = 速度, z = 包宽, w = 波数\n\
uniform float uOffsetGain;    // 中频能量驱动的整体摇摆增益\n\
uniform float uFlow;          // 隧道 idle 呼吸的自行走量\n\
uniform float uFormation;     // 1 = 成形, 0 = 完全散开（切歌溶散）\n\
uniform float uScatter;       // 溶散时点飞出的距离\n\
uniform float uPulse;         // 轻柔整体节拍缩放\n\
uniform float uSpectralCentroid;\n\
uniform float uViewportHeight;\n\
uniform float uSizeBase;\n\
uniform float uSizeGain;\n\
uniform float uGlow;\n\
uniform float uGlowPass;\n\
uniform vec3 uPrimaryColor;\n\
uniform vec3 uAccentColor;\n\
uniform vec3 uSecondaryColor;\n\
\n\
varying vec3 vColor;\n\
varying float vAlpha;\n\
varying float vReaction;\n\
\n\
float hermite(float value) { return value * value * (3.0 - 2.0 * value); }\n\
float hash11(float n) { return fract(sin(n) * 43758.5453123); }\n\
\n\
float resolveLife(float distanceToCamera) {\n\
  float farT = clamp((' + Core.DIORAMA_SHAPE_FADE_IN_END.toFixed(1) + ' - distanceToCamera) / ' + (Core.DIORAMA_SHAPE_FADE_IN_END - Core.DIORAMA_SHAPE_FADE_IN_START).toFixed(1) + ', 0.0, 1.0);\n\
  float nearT = clamp((distanceToCamera - ' + Core.DIORAMA_SHAPE_DISSOLVE_END.toFixed(1) + ') / ' + (Core.DIORAMA_SHAPE_DISSOLVE_START - Core.DIORAMA_SHAPE_DISSOLVE_END).toFixed(1) + ', 0.0, 1.0);\n\
  return hermite(farT) * hermite(nearT);\n\
}\n\
\n\
/**\n\
 * 单个纹波在距其原点 r 处的贡献——整个弹性行为的四项：\n\
 *   dr = 此点与波已扩展到的环（age * speed）的距离\n\
 *   sin = 波峰/波谷，表面过冲并回振（弹性 + 惯性）\n\
 *   exp = 包宽，然后时间与距离上的衰减（诞生、扩散、回落）\n\
 * 各项都是 r 的平滑函数，相邻点——包括跨棱边或隧道接缝——作为一个波前一起移动。\n\
 */\n\
float ripplePacket(float r, float age, vec4 shape) {\n\
  float dr = r - age * shape.y;\n\
  float k = min(shape.w, uWaveNumberMax);\n\
  float packet = exp(-(dr * dr) / (shape.z * shape.z)) * sin(dr * k);\n\
  return shape.x * packet * exp(-age * 1.15) * exp(-r * 0.35);\n\
}\n\
\n\
/** 云：全部活纹波之和（在形体自身单位空间）。每簇以自身相位旋转原点。 */\n\
float cloudRipples(vec3 unitPos, float phase) {\n\
  float spin = cos(phase);\n\
  float spun = sin(phase);\n\
  float total = 0.0;\n\
  for (int i = 0; i < RIPPLE_COUNT; i += 1) {\n\
    vec4 source = uRippleSource[i];\n\
    vec4 shape = uRippleShape[i];\n\
    float age = uTime - source.w;\n\
    if (shape.x <= 0.0 || age < 0.0) continue;\n\
    vec3 origin = vec3(\n\
      source.x * spin - source.z * spun,\n\
      source.y,\n\
      source.x * spun + source.z * spin\n\
    );\n\
    total += ripplePacket(distance(unitPos, origin), age, shape);\n\
  }\n\
  return total;\n\
}\n\
\n\
/**\n\
 * 隧道壁上从源到此点的偏移，为 (along, arc)，均以半径为单位——与云的 3D 距离可直接比较。\n\
 * 角度项经 atan(sin, cos) 回卷到 [-PI, PI]，严格周期——纹波跨越接缝浑然不觉。\n\
 */\n\
vec2 corridorSurfaceDelta(vec2 w, vec2 origin) {\n\
  float dAngle = w.y - origin.y;\n\
  return vec2(w.x - origin.x, atan(sin(dAngle), cos(dAngle)));\n\
}\n\
\n\
/** 隧道：同样的纹波，沿壁测量——一次击打抬起圆柱面的连续片区。 */\n\
float corridorRipples(vec2 w) {\n\
  float total = 0.0;\n\
  for (int i = 0; i < RIPPLE_COUNT; i += 1) {\n\
    vec4 source = uRippleSource[i];\n\
    vec4 shape = uRippleShape[i];\n\
    float age = uTime - source.w;\n\
    if (shape.x <= 0.0 || age < 0.0) continue;\n\
    total += ripplePacket(length(corridorSurfaceDelta(w, source.xy)), age, shape);\n\
  }\n\
  return total;\n\
}\n\
\n\
// 击打间隙让云保持活着的缓慢连续呼吸。仍是平滑的位置场；刻意远小于纹波尺度，\n\
// 且被排除在 d 之外，绝不点亮形体。\n\
float cloudIdle(vec3 unitPos) {\n\
  return 0.11 * sin(unitPos.x * 1.7 + uTime * 0.5) * cos(unitPos.z * 1.4 - uTime * 0.37)\n\
       + 0.06 * sin(unitPos.y * 2.1 - uTime * 0.66);\n\
}\n\
\n\
// 隧道的对应物：携带更细行波的慢区域包络。所有角度项都是整数谐波（2.0, 3.0），\n\
// 转满一圈后按构造闭合。\n\
float corridorIdle(vec2 w) {\n\
  float t = uTime * uFlow;\n\
  float region = 0.6 + 0.4 * sin(w.x * 0.42 - t * 0.33);\n\
  float ripple = 0.62 * sin(w.x * 1.25 - t * 1.15)\n\
               + 0.30 * sin(w.x * 0.8 + w.y * 2.0 - t * 0.8)\n\
               + 0.08 * sin(w.y * 3.0 + t * 0.5);\n\
  return region * ripple;\n\
}\n\
\n\
// 持续高音的细表面纹理。正弦乘积拍频出斜向分量，故以点阵上限的 0.7 运行留出余量。\n\
float cloudDetail(vec3 p) {\n\
  float k = uWaveNumberMax * 0.7;\n\
  return sin(p.x * k + uTime * 3.1)\n\
       * sin(p.y * k - uTime * 2.6)\n\
       * sin(p.z * k + uTime * 2.2);\n\
}\n\
\n\
// 同上，但在壁上。角度谐波向下取整为整数以绕圆闭合。\n\
float corridorDetail(vec2 w) {\n\
  float k = uWaveNumberMax * 0.7;\n\
  float n = max(1.0, floor(k));\n\
  return sin(w.x * k + uTime * 3.1) * sin(w.y * n - uTime * 2.4);\n\
}\n\
\n\
void main() {\n\
  float colorSlot = aStyle.y;\n\
  float isFar = aStyle.z;\n\
  vec3 normalDir = normalize(aNormal);\n\
  float localRadius = aScale.z;\n\
\n\
  // 先拉伸基础形状再位移：之后缩放会把位移也乘上 aScale.y\n\
  vec3 basePos = position;\n\
  basePos.y *= aScale.y;\n\
\n\
  // 每模式一个标量 swell，再一个共用的位移形。场从未拉伸位置读取。\n\
  vec3 unitPos = position / localRadius;\n\
  bool corridor = uCorridor > 0.5;\n\
  float audio = corridor ? corridorRipples(aWave) : cloudRipples(unitPos, aPhase);\n\
  float idle = corridor ? corridorIdle(aWave) : cloudIdle(unitPos);\n\
\n\
  // 高频由已有 swell 门控：静止表面门为 0，无法凭空制造噪声\n\
  float detail = uDetail * smoothstep(0.06, 0.45, abs(audio));\n\
  audio += (corridor ? corridorDetail(aWave) : cloudDetail(unitPos)) * detail * 0.3;\n\
\n\
  // 仅作安全网：多个源同时峰值不得把点甩出自身形体\n\
  float swell = clamp(audio + idle, -1.6, 1.6) * uAmplitude;\n\
  vec3 displaced = basePos + normalDir * (swell * localRadius);\n\
  // d = 音乐实际移动此点的距离，对固定满幅位移归一化\n\
  float d = clamp(abs(clamp(audio, -1.6, 1.6) * uAmplitude) / max(uMaxSwell, 0.0001), 0.0, 1.0);\n\
\n\
  // 中频能量上的整体摇摆：整簇沿固定局部轴的刚性平移（沿 normalDir 会把面各自推开）\n\
  displaced.z += sin(uTime * 0.6 + aPhase) * 0.12 * uOffsetGain * localRadius;\n\
\n\
  // 溶散：uFormation 降到 0 时点飞散进周围空间（下方淡出），走廊以散开方式离场、聚合方式到达\n\
  float scatter = 1.0 - uFormation;\n\
  if (scatter > 0.001) {\n\
    float r1 = hash11(aPhase * 12.9898 + aWave.x * 78.233);\n\
    float r2 = hash11(aPhase * 39.346 + aWave.y * 11.135 + 3.7);\n\
    float r3 = hash11(r1 * 91.7 + r2 * 47.3);\n\
    vec3 spread = normalize(normalDir * 0.75 + vec3(r1 - 0.5, r2 - 0.5, r3 - 0.5) * 1.6);\n\
    displaced += spread * (scatter * scatter * uScatter * (0.55 + r3 * 0.9));\n\
  }\n\
\n\
  displaced *= aScale.x * uPulse;\n\
  vec3 worldPosition = aAnchor + displaced;\n\
\n\
  float life = resolveLife(distance(worldPosition, cameraPosition));\n\
  vec4 mvPosition = viewMatrix * vec4(worldPosition, 1.0);\n\
\n\
  // 到达点变大——这是读出振幅的关键。辉光层把同样的点画成宽软光晕。\n\
  float glowScale = mix(1.0, 1.9 + uGlow * 1.3, uGlowPass);\n\
  float sizeWorld = (uSizeBase + (pow(d, 3.0) + detail * 0.35) * uSizeGain) * glowScale;\n\
  float projected = sizeWorld * uViewportHeight * projectionMatrix[1][1] * 0.5 / max(-mvPosition.z, 0.1);\n\
  gl_PointSize = clamp(projected, mix(1.4, 2.0, uGlowPass), mix(26.0, 64.0, uGlowPass));\n\
  gl_Position = projectionMatrix * mvPosition;\n\
\n\
  // 通过 primary/accent/secondary 的色相漂移；到达点向炽热 accent 再着色\n\
  float gradientPhase = (\n\
    dot(basePos, vec3(0.2, 0.16, 0.13))\n\
    + aPhase * 0.05\n\
    + colorSlot * 0.5\n\
    + uTime * 0.02\n\
    + uSpectralCentroid * 0.3\n\
  ) * 6.283;\n\
  vec3 wgt = max(vec3(0.0), 0.5 + 0.5 * cos(gradientPhase - vec3(0.0, 2.094, 4.188)));\n\
  wgt *= wgt; wgt /= max(wgt.x + wgt.y + wgt.z, 0.001);\n\
  vec3 baseColor = uPrimaryColor * wgt.x + uAccentColor * wgt.y + uSecondaryColor * wgt.z;\n\
  vec3 hotColor = mix(uAccentColor, uSecondaryColor, smoothstep(0.2, 0.9, uSpectralCentroid));\n\
  float hot = min(1.0, smoothstep(0.1, 0.75, d) * 0.75 + detail * 0.3);\n\
  vColor = mix(baseColor, hotColor, hot) * (0.92 + d * 0.5);\n\
\n\
  float layerBase = mix(0.72, 0.5, isFar);\n\
  // 对比层：可读实体 + 到达增亮。辉光层只绑定位移区域，从零平滑升起。\n\
  float formed = smoothstep(0.0, 0.45, uFormation);\n\
  vAlpha = formed * (uGlowPass > 0.5\n\
    ? life * smoothstep(0.1, 0.8, d) * 1.15\n\
    : life * min(1.0, layerBase + d * 0.28));\n\
  vReaction = d;\n\
}\n\
'

  // 片段着色器：含 sRGB 输出转换（ShaderMaterial 前缀不定义 colorspace_fragment 的函数）
  var DIORAMA_PARTICLE_FRAGMENT_SHADER = '\
uniform float uGlow;\n\
uniform float uGlowPass;\n\
\n\
varying vec3 vColor;\n\
varying float vAlpha;\n\
varying float vReaction;\n\
\n\
vec3 dioramaLinearToSRGB(vec3 linear) {\n\
  vec3 safe = max(linear, vec3(0.0));\n\
  return mix(\n\
    pow(safe, vec3(0.41666)) * 1.055 - vec3(0.055),\n\
    safe * 12.92,\n\
    vec3(lessThanEqual(safe, vec3(0.0031308)))\n\
  );\n\
}\n\
\n\
void main() {\n\
  vec2 point = gl_PointCoord - vec2(0.5);\n\
  float radius = length(point);\n\
\n\
  if (uGlowPass > 0.5) {\n\
    // 加性软光晕：宽衰减，强度骑辉光滑条与点的到达量。硬上限防白斑。\n\
    float halo = pow(clamp(1.0 - radius * 2.0, 0.0, 1.0), 1.7);\n\
    float alpha = min(0.5, halo * vAlpha * uGlow * 0.4);\n\
    if (alpha < 0.003) discard;\n\
    gl_FragColor = vec4(dioramaLinearToSRGB(vColor * (1.0 + uGlow * 0.25)), alpha);\n\
    return;\n\
  }\n\
\n\
  // 对比层：软边近不透明圆盘，主题适配色真正可读\n\
  float core = 1.0 - smoothstep(0.14, 0.48, radius);\n\
  float alpha = core * vAlpha;\n\
  if (alpha < 0.01) discard;\n\
  float emission = 0.95 + vReaction * 0.22;\n\
  gl_FragColor = vec4(dioramaLinearToSRGB(vColor * emission), alpha);\n\
}\n\
'

  // ═══════════ dioramaParticleMaterials.ts 全文 ═══════════

  // WCAG 相对亮度就是线性通道的加权和。THREE.Color 已经是线性值。
  function relativeLuminance(color) {
    return 0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b
  }

  function getDioramaParticleContrastRatio(foreground, background) {
    var foregroundLuminance = relativeLuminance(foreground)
    var backgroundLuminance = relativeLuminance(background)
    var lighter = Math.max(foregroundLuminance, backgroundLuminance)
    var darker = Math.min(foregroundLuminance, backgroundLuminance)
    return (lighter + 0.05) / (darker + 0.05)
  }

  // 着色器对一个静息点实际放到屏幕上的颜色。三个变换介于 uniform 与像素之间：
  //   - vColor 静息 0.92 底，片段再加 0.95 静息自发光
  //   - 对比层以 vAlpha = layerBase = 0.72 合成
  //   - 帧缓冲 sRGB 编码，混合在编码值上运行
  var CALM_EMISSION = 0.92 * 0.95
  var CONTRAST_LAYER_ALPHA = 0.72

  function asDisplayed(color, background) {
    var THREE = window.THREE
    var src = color.clone().multiplyScalar(CALM_EMISSION).convertLinearToSRGB()
    var dst = background.clone().convertLinearToSRGB()
    var blend = function (s, d) { return s * CONTRAST_LAYER_ALPHA + d * (1 - CONTRAST_LAYER_ALPHA) }
    return new THREE.Color(blend(src.r, dst.r), blend(src.g, dst.g), blend(src.b, dst.b))
      .convertSRGBToLinear()
  }

  /** 该颜色的点实际成为的像素对背后背景的对比度——描述可读性的数字。 */
  function getDioramaParticleDisplayedContrastRatio(color, background) {
    return getDioramaParticleContrastRatio(asDisplayed(color, background), background)
  }

  /**
   * "智能"对比步骤：主题色已在场景上可读则原样保留；离背景太近则朝白/黑中
   * 对比更远的一极做最小校正。色相尽量保持。
   */
  function adaptColorToBackground(color, background, minimumContrast) {
    var THREE = window.THREE
    if (getDioramaParticleDisplayedContrastRatio(color, background) >= minimumContrast) {
      return color.clone()
    }
    var lightTarget = new THREE.Color(0xffffff)
    var darkTarget = new THREE.Color(0x050505)
    var target = getDioramaParticleDisplayedContrastRatio(lightTarget, background)
      >= getDioramaParticleDisplayedContrastRatio(darkTarget, background)
      ? lightTarget
      : darkTarget
    var low = 0
    var high = 1
    for (var iteration = 0; iteration < 10; iteration += 1) {
      var amount = (low + high) * 0.5
      var candidate = color.clone().lerp(target, amount)
      if (getDioramaParticleDisplayedContrastRatio(candidate, background) >= minimumContrast) {
        high = amount
      } else {
        low = amount
      }
    }
    return color.clone().lerp(target, high)
  }

  // 高于普通 AA 文本的目标：点云小，需要更多分离。
  function resolveDioramaParticleContrastColors(colors, background) {
    return {
      primary: adaptColorToBackground(colors.primary, background, 4.6),
      accent: adaptColorToBackground(colors.accent, background, 4.1),
      secondary: adaptColorToBackground(colors.secondary, background, 4.6)
    }
  }

  function buildUniforms(colors, glowPass, glowIntensity) {
    var THREE = window.THREE
    return {
      uTime: { value: 0 },
      uCorridor: { value: 0 },      // 0 = 云, 1 = 隧道。均为纹波驱动，只有空间不同
      uAmplitude: { value: 0.34 },  // 每 unit swell 的位移（占半径比例）
      uMaxSwell: { value: 0.29 },   // 计为满幅到达的位移（每帧设置）
      uWaveNumberMax: { value: 8 }, // 点阵推导的细节上限（每帧从缓冲设置）
      uDetail: { value: 0 },        // 0..1 持续高音 -> 已有波峰上的细纹理
      // 两种模式的活纹波源。场写入它们；位移别无驱动
      uRippleSource: { value: new Float32Array(DIORAMA_RIPPLE_COUNT * 4) },
      uRippleShape: { value: new Float32Array(DIORAMA_RIPPLE_COUNT * 4) },
      uOffsetGain: { value: 0 },    // 中频能量上的整体摇摆
      uFlow: { value: 1 },          // 隧道 idle 呼吸的自行走量
      uFormation: { value: 1 },     // 1 = 成形, 0 = 散开（切歌溶散）
      uScatter: { value: 4 },       // 散开时点的飞行距离
      uSizeBase: { value: 0.052 },  // 静点的世界点尺寸
      uSizeGain: { value: 0.3 },    // 满幅到达点获得的尺寸
      uPulse: { value: 1 },         // 轻柔整体节拍缩放
      uSpectralCentroid: { value: 0.5 },
      uViewportHeight: { value: 1 },
      uGlow: { value: glowIntensity },
      uGlowPass: { value: glowPass },
      uPrimaryColor: { value: colors.primary.clone() },
      uAccentColor: { value: colors.accent.clone() },
      uSecondaryColor: { value: colors.secondary.clone() }
    }
  }

  /** 不透明对比层：近实心圆盘，普通混合，任何背景上可读。 */
  function createDioramaParticleMaterial(colors) {
    var THREE = window.THREE
    return new THREE.ShaderMaterial({
      vertexShader: DIORAMA_PARTICLE_VERTEX_SHADER,
      fragmentShader: DIORAMA_PARTICLE_FRAGMENT_SHADER,
      uniforms: buildUniforms(colors, 0, 0),
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
      toneMapped: false
    })
  }

  /** 辉光光晕层：宽软精灵，加性混合，强度由辉光滑条驱动。 */
  function createDioramaParticleGlowMaterial(colors, glowIntensity) {
    var THREE = window.THREE
    return new THREE.ShaderMaterial({
      vertexShader: DIORAMA_PARTICLE_VERTEX_SHADER,
      fragmentShader: DIORAMA_PARTICLE_FRAGMENT_SHADER,
      uniforms: buildUniforms(colors, 1, glowIntensity),
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false
    })
  }

  function lerpDioramaParticleMaterialColors(material, colors, amount) {
    material.uniforms.uPrimaryColor.value.lerp(colors.primary, amount)
    material.uniforms.uAccentColor.value.lerp(colors.accent, amount)
    material.uniforms.uSecondaryColor.value.lerp(colors.secondary, amount)
  }

  window.FoliaDioramaParticles = {
    // surfaces
    buildDioramaStructuredSurface: buildDioramaStructuredSurface,
    // model
    DIORAMA_MAX_PARTICLE_POINTS: DIORAMA_MAX_PARTICLE_POINTS,
    DIORAMA_MAX_CLOUD_POINTS_PER_CLUSTER: DIORAMA_MAX_CLOUD_POINTS_PER_CLUSTER,
    DIORAMA_MAX_CORRIDOR_POINTS_PER_SPAN: DIORAMA_MAX_CORRIDOR_POINTS_PER_SPAN,
    FAMILY_INDEX: FAMILY_INDEX,
    resolveWaveNumberMax: resolveWaveNumberMax,
    buildDioramaCloudGeometryData: buildDioramaCloudGeometryData,
    buildDioramaCorridorGeometryData: buildDioramaCorridorGeometryData,
    createDioramaBufferGeometry: createDioramaBufferGeometry,
    stepDioramaEnvelope: stepDioramaEnvelope,
    createDioramaBandTracker: createDioramaBandTracker,
    stepDioramaBandTracker: stepDioramaBandTracker,
    RIPPLE_BANDS: RIPPLE_BANDS,
    RIPPLE_SLOTS_PER_BAND: RIPPLE_SLOTS_PER_BAND,
    DIORAMA_RIPPLE_COUNT: DIORAMA_RIPPLE_COUNT,
    resolveDioramaParticleAudioResponse: resolveDioramaParticleAudioResponse,
    DIORAMA_CORRIDOR_PULSE_SHARE: DIORAMA_CORRIDOR_PULSE_SHARE,
    resolveDioramaPulseTarget: resolveDioramaPulseTarget,
    createDioramaParticleElasticState: createDioramaParticleElasticState,
    stepDioramaParticleElasticResponse: stepDioramaParticleElasticResponse,
    // shaders
    DIORAMA_PARTICLE_VERTEX_SHADER: DIORAMA_PARTICLE_VERTEX_SHADER,
    DIORAMA_PARTICLE_FRAGMENT_SHADER: DIORAMA_PARTICLE_FRAGMENT_SHADER,
    // materials
    relativeLuminance: relativeLuminance,
    getDioramaParticleContrastRatio: getDioramaParticleContrastRatio,
    getDioramaParticleDisplayedContrastRatio: getDioramaParticleDisplayedContrastRatio,
    resolveDioramaParticleContrastColors: resolveDioramaParticleContrastColors,
    createDioramaParticleMaterial: createDioramaParticleMaterial,
    createDioramaParticleGlowMaterial: createDioramaParticleGlowMaterial,
    lerpDioramaParticleMaterialColors: lerpDioramaParticleMaterialColors
  }
})()
