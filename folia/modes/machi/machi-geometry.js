// 搭街角用的小工具（移植自 engine/geometry/shapes.ts + plinth.ts，另含 three examples 的
// RoundedBoxGeometry 与 mergeGeometries 的精简移植——vendor three.iife.js 未含 examples 扩展）：
// 圆角盒（缓存）、按底面放置的网格、命名 Group、悬链线电线，建完后的静态合批，
// 以及三个场景共用的底座（分层微缩台座 + 湿地面薄板）。
(function () {
  'use strict'

  var THREE = window.THREE

  // ===== RoundedBoxGeometry（three examples 精简移植） =====
  /** 轻微圆角的盒子：BoxGeometry 细分后把顶点投到圆角形状上。 */
  function RoundedBoxGeometry(width, height, depth, segments, radius) {
    segments = Math.max(1, Math.floor(segments || 2))
    // 顶点内缩的正方形半边长：half - radius
    var inner = {
      x: Math.max(0.001, width / 2 - radius),
      y: Math.max(0.001, height / 2 - radius),
      z: Math.max(0.001, depth / 2 - radius)
    }
    // 三轴各切 segments+1 段，网格足够细地贴出圆角
    var geometry = new THREE.BoxGeometry(
      width - radius * 2, height - radius * 2, depth - radius * 2,
      segments * 2 + 1, segments * 2 + 1, segments * 2 + 1
    )
    var position = geometry.attributes.position
    var normal = geometry.attributes.normal
    var v = new THREE.Vector3()
    for (var i = 0; i < position.count; i += 1) {
      v.fromBufferAttribute(position, i)
      // 内缩正方形：把外层盒子顶点拉进圆角带
      var cx = Math.min(inner.x, Math.max(-inner.x, v.x + radius * Math.sign(v.x || 1) * 0))
      var cy = Math.min(inner.y, Math.max(-inner.y, v.y + radius * Math.sign(v.y || 1) * 0))
      var cz = Math.min(inner.z, Math.max(-inner.z, v.z + radius * Math.sign(v.z || 1) * 0))
      // v 是外盒（half-radius 尺寸）上的点，clamp 到内盒得到方向
      cx = Math.min(inner.x, Math.max(-inner.x, v.x))
      cy = Math.min(inner.y, Math.max(-inner.y, v.y))
      cz = Math.min(inner.z, Math.max(-inner.z, v.z))
      var dir = new THREE.Vector3(v.x - cx, v.y - cy, v.z - cz)
      if (dir.lengthSq() < 1e-12) dir.set(v.x, v.y, v.z).normalize()
      else dir.normalize()
      v.set(cx, cy, cz).addScaledVector(dir, radius)
      position.setXYZ(i, v.x, v.y, v.z)
      normal.setXYZ(i, dir.x, dir.y, dir.z)
    }
    position.needsUpdate = true
    normal.needsUpdate = true
    geometry.computeVertexNormals()
    return geometry
  }

  // ===== mergeGeometries（BufferGeometryUtils 精简移植：只合 position/normal/uv/color 的非索引几何） =====
  function mergeGeometries(geometries) {
    var attributes = ['position', 'normal', 'uv', 'color']
    var counts = geometries.map(function (g) { return g.attributes.position.count })
    var total = counts.reduce(function (sum, c) { return sum + c }, 0)
    var merged = new THREE.BufferGeometry()
    attributes.forEach(function (name) {
      if (!geometries[0].attributes[name]) return
      var itemSize = geometries[0].attributes[name].itemSize
      var array = new Float32Array(total * itemSize)
      var offset = 0
      geometries.forEach(function (g, index) {
        array.set(g.attributes[name].array, offset)
        offset += counts[index] * itemSize
      })
      merged.setAttribute(name, new THREE.BufferAttribute(array, itemSize))
    })
    return merged
  }

  // ===== 几何缓存 =====
  var activeCache = new Map()
  var sharedGeometries = new WeakSet()

  /** 在 cache 上同步地建一段几何。 */
  function withGeometryCache(cache, build) {
    var previous = activeCache
    activeCache = cache
    try {
      return build()
    } finally {
      activeCache = previous
    }
  }

  /** 轻微圆角的盒子（默认 3cm），避免盒子堆叠的生硬边。 */
  function roundedBox(width, height, depth, radius, segments) {
    radius = radius === undefined ? 0.03 : radius
    segments = segments === undefined ? 2 : segments
    var r = Math.min(radius, width / 2 - 0.001, height / 2 - 0.001, depth / 2 - 0.001)
    var key = width.toFixed(3) + ':' + height.toFixed(3) + ':' + depth.toFixed(3) + ':' + r.toFixed(3) + ':' + segments
    var geometry = activeCache.get(key)
    if (!geometry) {
      geometry = r > 0.004 ? new RoundedBoxGeometry(width, height, depth, segments, r) : new THREE.BoxGeometry(width, height, depth)
      activeCache.set(key, geometry)
      sharedGeometries.add(geometry)
    }
    return geometry
  }

  function mesh(geometry, material, options) {
    options = options || {}
    var result = new THREE.Mesh(geometry, material)
    result.name = options.name || ''
    result.castShadow = options.castShadow !== false
    result.receiveShadow = options.receiveShadow !== false
    if (options.dynamic) result.userData.dynamic = true
    return result
  }

  /** 按“底面中心”放一个盒子：x、z 是中心，y 是底面高度。 */
  function boxAt(material, size, at, options) {
    options = options || {}
    var width = size[0]
    var height = size[1]
    var depth = size[2]
    var result = mesh(roundedBox(width, height, depth, options.radius !== undefined ? options.radius : 0.03), material, options)
    result.position.set(at[0], at[1] + height / 2, at[2])
    if (options.rotationY) result.rotation.y = options.rotationY
    return result
  }

  /** 两个角点围出的盒子（x0..x1、y0..y1、z0..z1）。 */
  function boxSpan(material, x0, x1, y0, y1, z0, z1, options) {
    return boxAt(material,
      [Math.abs(x1 - x0), Math.abs(y1 - y0), Math.abs(z1 - z0)],
      [(x0 + x1) / 2, Math.min(y0, y1), (z0 + z1) / 2],
      options)
  }

  /** 竖直圆柱（底面在 y）。 */
  function cylinderAt(material, radius, height, at, options) {
    options = options || {}
    var geometry = new THREE.CylinderGeometry(options.radiusTop !== undefined ? options.radiusTop : radius, radius, height, options.segments || 12)
    var result = mesh(geometry, material, options)
    result.position.set(at[0], at[1] + height / 2, at[2])
    return result
  }

  /** 两点之间的一根管子（支架、扶手、车架）。 */
  function tubeBetween(material, from, to, radius, options) {
    options = options || {}
    var length = from.distanceTo(to)
    var geometry = new THREE.CylinderGeometry(radius, radius, length, options.segments || 8)
    var result = mesh(geometry, material, options)
    result.position.copy(from).add(to).multiplyScalar(0.5)
    result.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), to.clone().sub(from).normalize())
    return result
  }

  /** 下垂的电线：两点之间的抛物线近似悬链线，下垂量 sag 米。 */
  function sagWire(material, from, to, sag, radius) {
    radius = radius === undefined ? 0.012 : radius
    var points = []
    var steps = 16
    for (var index = 0; index <= steps; index += 1) {
      var t = index / steps
      var point = from.clone().lerp(to, t)
      point.y -= sag * 4 * t * (1 - t)
      points.push(point)
    }
    var geometry = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 24, radius, 4, false)
    return mesh(geometry, material, { castShadow: false, receiveShadow: false })
  }

  function group(name) {
    var result = new THREE.Group()
    result.name = name
    for (var i = 1; i < arguments.length; i += 1) result.add(arguments[i])
    return result
  }

  /** 统一成 position / normal / uv（有顶点色的再加 color）的非索引几何，才能合在一起。 */
  function normalizeForMerge(geometry, matrix) {
    var result = geometry.index ? geometry.toNonIndexed() : geometry.clone()
    result.applyMatrix4(matrix)
    Object.keys(result.attributes).forEach(function (name) {
      if (name !== 'position' && name !== 'normal' && name !== 'uv' && name !== 'color') result.deleteAttribute(name)
    })
    if (!result.attributes.normal) result.computeVertexNormals()
    if (!result.attributes.uv) {
      var count = result.attributes.position.count
      result.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(count * 2), 2))
    }
    result.morphAttributes = {}
    result.clearGroups()
    return result
  }

  /**
   * 静态合批：把 root 下每个直接子 Group 里静止的普通网格按材质（和投影 / 受影设置）合成一个网格，挂回那个 Group。
   * 会动的件（userData.dynamic）、InstancedMesh、多材质网格都留着原样。
   */
  function bakeStatic(root) {
    root.updateMatrixWorld(true)
    root.children.forEach(function (top) {
      var inverse = new THREE.Matrix4().copy(top.matrixWorld).invert()
      var buckets = new Map()
      var removals = []
      top.traverse(function (object) {
        if (!(object instanceof THREE.Mesh) || object instanceof THREE.InstancedMesh) return
        if (object.userData.dynamic || Array.isArray(object.material)) return
        var ancestor = object.parent
        while (ancestor && ancestor !== top) {
          if (ancestor.userData.dynamic) return
          ancestor = ancestor.parent
        }
        var material = object.material
        var key = material.uuid + ':' + (object.castShadow ? 1 : 0) + ':' + (object.receiveShadow ? 1 : 0) + ':' + object.layers.mask
        var bucket = buckets.get(key)
        if (!bucket) {
          bucket = { material: material, cast: object.castShadow, receive: object.receiveShadow, layers: object.layers.mask, parts: [] }
          buckets.set(key, bucket)
        }
        var local = new THREE.Matrix4().multiplyMatrices(inverse, object.matrixWorld)
        bucket.parts.push(normalizeForMerge(object.geometry, local))
        removals.push(object)
      })
      buckets.forEach(function (bucket) {
        if (bucket.parts.length < 2) {
          bucket.parts.forEach(function (part) { part.dispose() })
          return
        }
        // 同一桶里有的带顶点色、有的不带：不带的补白色，属性才对得齐。
        if (bucket.parts.some(function (part) { return part.attributes.color })) {
          bucket.parts.forEach(function (part) {
            if (part.attributes.color) return
            var count = part.attributes.position.count
            part.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(count * 3).fill(1), 3))
          })
        }
        var merged = mergeGeometries(bucket.parts)
        bucket.parts.forEach(function (part) { part.dispose() })
        if (!merged) return
        var result = new THREE.Mesh(merged, bucket.material)
        result.name = top.name + ':' + (bucket.material.name || 'merged')
        result.castShadow = bucket.cast
        result.receiveShadow = bucket.receive
        result.layers.mask = bucket.layers
        // 几何已经烘在 Group 的局部坐标里，自己的变换永远是单位阵。
        result.matrixAutoUpdate = false
        top.add(result)
      })
      removals.forEach(function (object) {
        var material = object.material
        var key = material.uuid + ':' + (object.castShadow ? 1 : 0) + ':' + (object.receiveShadow ? 1 : 0) + ':' + object.layers.mask
        var bucket = buckets.get(key)
        if (!bucket || bucket.parts.length < 2) return
        object.removeFromParent()
        // 圆角盒几何在缓存里共用，由运行时统一释放；其余几何只属于这个网格。
        if (!sharedGeometries.has(object.geometry)) object.geometry.dispose()
      })
    })
  }

  // ===== 底座（plinth.ts） =====
  /** 底座：12m 见方、0.6m 厚，顶面就是路面（y = 0）。 */
  var MACHI_BASE = { half: 6, depth: 0.6, radius: 0.12 }

  /** 台座：三层土石加一圈深色底框，四角圆。 */
  function buildMachiPlinth(materials) {
    var size = MACHI_BASE.half * 2
    var layers = [
      { role: 'plinthTop', y0: -0.1, y1: 0, inset: 0 },
      { role: 'plinthMid', y0: -0.3, y1: -0.1, inset: 0.012 },
      { role: 'plinthLow', y0: -0.52, y1: -0.3, inset: 0.006 }
    ]
    var parts = layers.map(function (layer) {
      var width = size - layer.inset * 2
      var part = mesh(roundedBox(width, layer.y1 - layer.y0, width, MACHI_BASE.radius, 3), materials.toon(layer.role), { name: 'Plinth/' + layer.role })
      part.position.set(0, (layer.y0 + layer.y1) / 2, 0)
      return part
    })
    var trim = mesh(roundedBox(size + 0.08, 0.1, size + 0.08, MACHI_BASE.radius + 0.04, 3), materials.toon('plinthTrim'), { name: 'Plinth/trim' })
    trim.position.set(0, -MACHI_BASE.depth + 0.05, 0)
    return group.apply(null, ['Base/Plinth'].concat(parts, [trim]))
  }

  var SURFACE_LIFT = 0.002

  /** 沿 x、z 的一片平板顶面：会换成湿地面材质，所以是动的件、不合批。 */
  function machiSurface(material, x0, x1, z0, z1, y, name) {
    var geometry = new THREE.PlaneGeometry(x1 - x0, z1 - z0, 1, 1)
    geometry.rotateX(-Math.PI / 2)
    var result = mesh(geometry, material, { name: name, castShadow: false, receiveShadow: true, dynamic: true })
    result.position.set((x0 + x1) / 2, y + SURFACE_LIFT, (z0 + z1) / 2)
    return result
  }

  window.FoliaMachiGeometry = {
    RoundedBoxGeometry: RoundedBoxGeometry,
    mergeGeometries: mergeGeometries,
    withGeometryCache: withGeometryCache,
    roundedBox: roundedBox,
    mesh: mesh,
    boxAt: boxAt,
    boxSpan: boxSpan,
    cylinderAt: cylinderAt,
    tubeBetween: tubeBetween,
    sagWire: sagWire,
    group: group,
    bakeStatic: bakeStatic,
    buildMachiPlinth: buildMachiPlinth,
    machiSurface: machiSurface,
    MACHI_BASE: MACHI_BASE
  }
})()
