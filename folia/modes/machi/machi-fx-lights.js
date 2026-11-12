// 雨雾光柱与冒白气（移植自 engine/fx/lightCones.ts + engine/fx/steam.ts，合成一文件）：
// 光柱：场景给几束开口圆锥（路灯往下、罩棚灯……），合成一个 draw call，加色混合、不写深度；越靠灯头越亮，
// 越靠锥面边缘越淡，再叠一点缓慢流动的噪声像雨雾里的光。
// 白气：井盖和屋顶空调外机各飘出一缕，几片朝镜头的软云片按氛围时钟循环升起、变大、被风吹偏、淡出。
(function () {
  'use strict'

  var THREE = window.THREE
  var Geometry = window.FoliaMachiGeometry

  // ===== 光柱 =====
  var CONE_VERTEX = '\nvarying vec2 vUv;\nvarying vec3 vNormalView;\nvarying vec3 vViewDir;\nvarying vec3 vWorld;\nattribute float aGain;\nvarying float vGain;\n' +
    'void main() {\n' +
    '    vUv = uv;\n    vGain = aGain;\n' +
    '    vec4 world = modelMatrix * vec4(position, 1.0);\n' +
    '    vWorld = world.xyz;\n' +
    '    vec4 view = viewMatrix * world;\n' +
    '    vNormalView = normalize(normalMatrix * normal);\n' +
    // 正交投影：视线方向处处一样。
    '    vViewDir = vec3(0.0, 0.0, 1.0);\n' +
    '    gl_Position = projectionMatrix * view;\n}\n'

  var CONE_FRAGMENT = '\nuniform vec3 uColor;\nuniform float uTime;\nuniform float uLevel;\n' +
    'varying vec2 vUv;\nvarying vec3 vNormalView;\nvarying vec3 vViewDir;\nvarying vec3 vWorld;\nvarying float vGain;\n' +
    'float cHash(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }\n' +
    'float cNoise(vec2 p) {\n    vec2 i = floor(p);\n    vec2 f = fract(p);\n    vec2 u = f * f * (3.0 - 2.0 * f);\n' +
    '    return mix(mix(cHash(i), cHash(i + vec2(1.0, 0.0)), u.x), mix(cHash(i + vec2(0.0, 1.0)), cHash(i + vec2(1.0, 1.0)), u.x), u.y);\n}\n' +
    'void main() {\n' +
    '    float facing = abs(dot(normalize(vNormalView), vViewDir));\n' +
    // 插值出来的 uv 可能是极小的负数，pow 的底必须夹到非负。
    '    float axial = pow(clamp(vUv.y, 0.0, 1.0), 1.6);\n' +
    '    float haze = 0.7 + 0.6 * cNoise(vec2(vWorld.x * 1.3 + vWorld.z, vWorld.y * 2.0 - uTime * 0.6));\n' +
    '    float alpha = facing * facing * axial * haze * vGain * uLevel;\n' +
    '    gl_FragColor = vec4(uColor * alpha, 1.0);\n' +
    '    #include <tonemapping_fragment>\n    #include <colorspace_fragment>\n}\n'

  /** 一个从 apex 指向 target 的开口圆锥（uv.y：灯头处为 1）。 */
  function cone(apex, target, radius, gain) {
    var height = apex.distanceTo(target)
    // ConeGeometry 的尖在 +h/2、底在 -h/2：往下挪半个高，尖落在原点，轴朝 -y，再转向 target。
    var geometry = new THREE.ConeGeometry(radius, height, 20, 1, true)
    geometry.translate(0, -height / 2, 0)
    var direction = target.clone().sub(apex).normalize()
    var quaternion = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, -1, 0), direction)
    geometry.applyQuaternion(quaternion)
    geometry.translate(apex.x, apex.y, apex.z)
    var count = geometry.getAttribute('position').count
    geometry.setAttribute('aGain', new THREE.Float32BufferAttribute(new Float32Array(count).fill(gain), 1))
    return geometry
  }

  /** constructor(materials, blend, cones[], colorKey='streetLight') */
  function MachiLightCones(materials, blend, cones, colorKey) {
    this._blend = blend
    colorKey = colorKey === undefined ? 'streetLight' : colorKey
    this._colorKey = colorKey
    var parts = cones.map(function (spec) { return cone(spec.apex, spec.target, spec.radius, spec.gain) })
    var geometry = parts.length === 1 ? parts[0] : Geometry.mergeGeometries(parts)
    if (parts.length > 1) parts.forEach(function (part) { part.dispose() })
    this.material = materials.track(new THREE.ShaderMaterial({
      vertexShader: CONE_VERTEX,
      fragmentShader: CONE_FRAGMENT,
      uniforms: { uColor: { value: new THREE.Color() }, uTime: { value: 0 }, uLevel: { value: 0.55 } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide
    }))
    this.mesh = new THREE.Mesh(geometry, this.material)
    this.mesh.name = 'LightCones'
    this.mesh.renderOrder = 6
    this.syncColors()
  }

  MachiLightCones.prototype.syncColors = function () {
    this.material.uniforms.uColor.value.copy(this._blend.get(this._colorKey))
  }

  MachiLightCones.prototype.update = function (time, level) {
    this.material.uniforms.uTime.value = time
    this.material.uniforms.uLevel.value = 0.55 * level
  }

  MachiLightCones.prototype.dispose = function () {
    this.mesh.geometry.dispose()
  }

  // ===== 冒白气 =====
  var STEAM_VERTEX = '\nuniform float uTime;\nuniform vec2 uWind;\nattribute vec4 aSource;\nattribute vec2 aSeed;\n' +
    'varying vec2 vUv;\nvarying float vFade;\nvarying float vSeed;\n' +
    'void main() {\n' +
    '    float life = fract(uTime / aSource.w + aSeed.x);\n' +
    '    float rise = life * 1.6;\n' +
    '    vec3 center = aSource.xyz + vec3(uWind.x * life * 1.8 + sin(life * 6.0 + aSeed.x * 20.0) * 0.08, rise, uWind.y * life * 1.8);\n' +
    '    float size = (0.25 + life * 0.9) * aSeed.y;\n' +
    '    vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);\n' +
    '    vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);\n' +
    '    vec3 world = center + (right * position.x + up * position.y) * size;\n' +
    '    vUv = uv;\n' +
    '    vFade = smoothstep(0.0, 0.15, life) * (1.0 - smoothstep(0.55, 1.0, life));\n' +
    '    vSeed = aSeed.x * 31.0;\n' +
    '    gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);\n}\n'

  var STEAM_FRAGMENT = '\nuniform vec3 uColor;\nuniform float uTime;\nvarying vec2 vUv;\nvarying float vFade;\nvarying float vSeed;\n' +
    'float sHash(vec2 p) { return fract(sin(dot(p, vec2(12.7, 61.3))) * 43758.5453); }\n' +
    'float sNoise(vec2 p) {\n    vec2 i = floor(p);\n    vec2 f = fract(p);\n    vec2 u = f * f * (3.0 - 2.0 * f);\n' +
    '    return mix(mix(sHash(i), sHash(i + vec2(1.0, 0.0)), u.x), mix(sHash(i + vec2(0.0, 1.0)), sHash(i + vec2(1.0, 1.0)), u.x), u.y);\n}\n' +
    'void main() {\n' +
    '    vec2 c = vUv - 0.5;\n' +
    '    float shape = 1.0 - smoothstep(0.15, 0.5, length(c));\n' +
    '    float puff = sNoise(vUv * 3.0 + vec2(vSeed, uTime * 0.2)) * 0.6 + sNoise(vUv * 6.5 - vec2(uTime * 0.3, vSeed)) * 0.4;\n' +
    '    float alpha = shape * smoothstep(0.25, 0.75, puff) * vFade;\n' +
    '    gl_FragColor = vec4(uColor * alpha, 1.0);\n' +
    '    #include <tonemapping_fragment>\n    #include <colorspace_fragment>\n}\n'

  /** constructor(materials, blend, sources[{position, puffs, period, size}]) */
  function MachiSteam(materials, blend, sources) {
    this._blend = blend
    var quad = new THREE.PlaneGeometry(1, 1)
    var geometry = new THREE.InstancedBufferGeometry()
    geometry.index = quad.index
    geometry.setAttribute('position', quad.getAttribute('position'))
    geometry.setAttribute('uv', quad.getAttribute('uv'))
    var source = []
    var seeds = []
    sources.forEach(function (item) {
      for (var index = 0; index < item.puffs; index += 1) {
        source.push(item.position.x, item.position.y, item.position.z, item.period)
        seeds.push(index / item.puffs, item.size * (0.8 + 0.4 * ((index * 7) % 5) / 5))
      }
    })
    geometry.setAttribute('aSource', new THREE.InstancedBufferAttribute(new Float32Array(source), 4))
    geometry.setAttribute('aSeed', new THREE.InstancedBufferAttribute(new Float32Array(seeds), 2))
    geometry.instanceCount = seeds.length / 2
    this.material = materials.track(new THREE.ShaderMaterial({
      vertexShader: STEAM_VERTEX,
      fragmentShader: STEAM_FRAGMENT,
      uniforms: { uTime: { value: 0 }, uWind: { value: new THREE.Vector2() }, uColor: { value: new THREE.Color() } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    }))
    this.mesh = new THREE.Mesh(geometry, this.material)
    this.mesh.name = 'Steam'
    this.mesh.frustumCulled = false
    this.mesh.renderOrder = 6
    this.syncColors()
  }

  MachiSteam.prototype.syncColors = function () {
    this.material.uniforms.uColor.value.copy(this._blend.get('skyBottom')).lerp(new THREE.Color(0xdde6f2), 0.5).multiplyScalar(0.32)
  }

  MachiSteam.prototype.update = function (time, wind) {
    this.material.uniforms.uTime.value = time
    this.material.uniforms.uWind.value.copy(wind)
  }

  MachiSteam.prototype.dispose = function () {
    this.mesh.geometry.dispose()
  }

  window.FoliaMachiLights = { MachiLightCones: MachiLightCones, MachiSteam: MachiSteam }
})()
