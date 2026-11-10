// 雨 / 雪 / 滴水 / 水花（移植自 engine/fx/weather.ts）：
// 雨丝（一个 LineSegments，几千条，顶点着色器按氛围时钟往下推、绕回顶上；落在屋顶上的停在屋顶）、
// 落地水花（InstancedMesh 的扁圆环，每个实例按周期换位置）、屋檐与落水管口的滴水（InstancedMesh），
// 还有雪（一个 Points，慢慢落、左右飘，落到地面或屋顶上淡掉）。都只读 uTime，暂停时定格；
// 不写深度，所以不被描边。雨和雪的量由环境给（晴天整组藏起来，不占 draw call）。
// 底座多大、屋顶在哪、哪里滴水、哪里有灯照亮雨丝，都由场景给（MachiWeatherLayout），换场景时重建。
(function () {
  'use strict'

  var THREE = window.THREE

  var RAIN_TOP = 9.5
  /** 最多几块屋顶（雨停在屋顶上）。 */
  var MAX_ROOFS = 4

  var GROUND_GLSL = '\nuniform vec4 uRoofs[' + MAX_ROOFS + '];\nuniform float uRoofY[' + MAX_ROOFS + '];\nuniform float uGroundY;\nuniform float uHalf;\n' +
    'float kGround(vec2 p) {\n    float ground = uGroundY;\n' +
    '    for (int i = 0; i < ' + MAX_ROOFS + '; i++) {\n        vec4 r = uRoofs[i];\n' +
    '        if (p.x > r.x && p.x < r.z && p.y > r.y && p.y < r.w) ground = max(ground, uRoofY[i]);\n    }\n    return ground;\n}\n' +
    'float kHash1(float n) { return fract(sin(n) * 43758.5453123); }\n'

  var RAIN_VERTEX = '\nuniform float uTime;\nuniform vec2 uWind;\nuniform float uLength;\nuniform float uSpeed;\nuniform float uDensity;\nuniform vec4 uGlints[3];\n' +
    'attribute vec4 aSeed;\nattribute float aEnd;\nvarying float vAlpha;\nvarying float vGlint;\n' + GROUND_GLSL +
    'void main() {\n' +
    '    vec2 base = aSeed.xy;\n' +
    '    float ground = kGround(base);\n' +
    '    float fall = ' + RAIN_TOP.toFixed(2) + ' - ground;\n' +
    '    float speed = uSpeed * (0.85 + 0.3 * aSeed.w);\n' +
    '    float y = ' + RAIN_TOP.toFixed(2) + ' - mod(uTime * speed + aSeed.z * fall, fall);\n' +
    '    float drop = ' + RAIN_TOP.toFixed(2) + ' - y;\n' +
    '    vec3 head = vec3(base.x + uWind.x * drop, y, base.y + uWind.y * drop);\n' +
    '    vec3 dir = normalize(vec3(-uWind.x, 1.0, -uWind.y));\n' +
    '    vec3 position = head + dir * uLength * aEnd * (0.75 + 0.5 * aSeed.w);\n' +
    '    position.y = max(position.y, ground);\n' +
    '    float inside = step(abs(head.x), uHalf + 0.1) * step(abs(head.z), uHalf + 0.1);\n' +
    '    float visible = step(aSeed.w, uDensity);\n' +
    '    vAlpha = (1.0 - aEnd * 0.85) * inside * visible * smoothstep(0.0, 0.6, y - ground);\n' +
    // 落进灯光里的雨丝被照亮（场景给的几处灯）。
    '    vGlint = 0.0;\n' +
    '    for (int i = 0; i < 3; i++) {\n' +
    '        vec3 d = head - uGlints[i].xyz;\n' +
    '        vGlint += exp(-dot(d, d) / (uGlints[i].w * uGlints[i].w));\n    }\n' +
    '    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);\n}\n'

  var RAIN_FRAGMENT = '\nuniform vec3 uColor;\nuniform vec3 uGlintColor;\nuniform float uOpacity;\nvarying float vAlpha;\nvarying float vGlint;\n' +
    'void main() {\n' +
    '    float glint = min(1.0, vGlint);\n' +
    '    vec3 color = mix(uColor, uGlintColor, glint) * (1.0 + 2.2 * glint);\n' +
    '    gl_FragColor = vec4(color * vAlpha * uOpacity, 1.0);\n' +
    '    #include <tonemapping_fragment>\n    #include <colorspace_fragment>\n}\n'

  var SPLASH_VERTEX = '\nuniform float uTime;\nuniform float uRate;\nuniform float uDensity;\nattribute vec4 aSeed;\nvarying vec2 vUv;\nvarying float vLife;\n' + GROUND_GLSL +
    'void main() {\n' +
    '    float cycle = uTime * uRate * (0.8 + 0.4 * aSeed.w) + aSeed.z;\n' +
    '    float index = floor(cycle);\n' +
    '    float life = fract(cycle);\n' +
    '    vec2 p = vec2(kHash1(index * 12.9898 + aSeed.x * 78.233), kHash1(index * 39.346 + aSeed.y * 11.135)) * 2.0 - 1.0;\n' +
    '    p *= uHalf - 0.05;\n' +
    '    float ground = kGround(p);\n' +
    '    float visible = step(aSeed.w, uDensity);\n' +
    '    float size = (0.06 + 0.24 * life) * visible;\n' +
    '    vUv = uv;\n' +
    '    vLife = life;\n' +
    '    vec3 local = vec3(position.x * size, 0.0, position.y * size);\n' +
    '    vec4 world = modelMatrix * vec4(local + vec3(p.x, ground + 0.012, p.y), 1.0);\n' +
    '    gl_Position = projectionMatrix * viewMatrix * world;\n}\n'

  var SPLASH_FRAGMENT = '\nuniform vec3 uColor;\nvarying vec2 vUv;\nvarying float vLife;\n' +
    'void main() {\n' +
    '    float d = length(vUv - 0.5) * 2.0;\n' +
    '    float ring = smoothstep(0.62, 0.86, d) * (1.0 - smoothstep(0.86, 1.0, d));\n' +
    '    float alpha = ring * (1.0 - vLife) * 1.1;\n' +
    '    gl_FragColor = vec4(uColor * alpha, 1.0);\n' +
    '    #include <tonemapping_fragment>\n    #include <colorspace_fragment>\n}\n'

  var DRIP_VERTEX = '\nuniform float uTime;\nattribute vec4 aDrip;\nattribute vec2 aTiming;\nvarying vec2 vUv;\nvarying float vMode;\nvarying float vFade;\n' +
    'void main() {\n' +
    '    float height = aDrip.z - aDrip.w;\n' +
    '    float fallTime = sqrt(2.0 * height / 9.8);\n' +
    '    float splashTime = 0.28;\n' +
    '    float t = mod(uTime + aTiming.y * aTiming.x, aTiming.x);\n' +
    '    vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);\n' +
    '    vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);\n' +
    '    vec3 world;\n' +
    '    if (t < fallTime) {\n' +
    // 下落：越落越拉长的水滴，朝镜头的小竖条。
    '        float y = aDrip.z - 0.5 * 9.8 * t * t;\n' +
    '        float stretch = 0.03 + 0.05 * (t / fallTime);\n' +
    '        world = vec3(aDrip.x, y, aDrip.y) + right * position.x * 0.026 + vec3(0.0, 1.0, 0.0) * position.y * stretch;\n' +
    '        vMode = 0.0;\n        vFade = 1.0;\n' +
    '    } else if (t < fallTime + splashTime) {\n' +
    // 溅开：地上一个扩散的扁圆环。
    '        float s = (t - fallTime) / splashTime;\n' +
    '        world = vec3(aDrip.x + position.x * (0.05 + 0.16 * s), aDrip.w + 0.014, aDrip.y + position.y * (0.05 + 0.16 * s));\n' +
    '        vMode = 1.0;\n        vFade = 1.0 - s;\n' +
    '    } else {\n' +
    '        world = vec3(0.0, -50.0, 0.0);\n' +
    '        vMode = 0.0;\n        vFade = 0.0;\n    }\n' +
    '    vUv = uv;\n' +
    '    gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);\n}\n'

  var SNOW_VERTEX = '\nuniform float uTime;\nuniform vec2 uWind;\nuniform float uDensity;\nuniform float uPixelsPerUnit;\nuniform vec4 uGlints[3];\n' +
    'attribute vec4 aSeed;\nvarying float vAlpha;\nvarying float vGlint;\n' + GROUND_GLSL +
    'void main() {\n' +
    '    vec2 base = aSeed.xy;\n' +
    '    float ground = kGround(base);\n' +
    '    float fall = ' + RAIN_TOP.toFixed(2) + ' - ground;\n' +
    '    float speed = 0.75 + 0.45 * aSeed.w;\n' +
    '    float y = ' + RAIN_TOP.toFixed(2) + ' - mod(uTime * speed + aSeed.z * fall, fall);\n' +
    '    float drop = ' + RAIN_TOP.toFixed(2) + ' - y;\n' +
    // 左右飘：两层不同周期的摆，加上风。
    '    float sway = sin(uTime * 1.1 + aSeed.z * 40.0) * 0.22 + sin(uTime * 2.3 + aSeed.w * 23.0) * 0.08;\n' +
    '    vec3 position = vec3(base.x + uWind.x * drop * 0.6 + sway, y, base.y + uWind.y * drop * 0.6 + sway * 0.6);\n' +
    '    float inside = step(abs(position.x), uHalf + 0.1) * step(abs(position.z), uHalf + 0.1);\n' +
    '    float visible = step(aSeed.w, uDensity);\n' +
    '    vAlpha = inside * visible * smoothstep(0.0, 0.35, y - ground);\n' +
    '    vGlint = 0.0;\n' +
    '    for (int i = 0; i < 3; i++) {\n' +
    '        vec3 d = position - uGlints[i].xyz;\n' +
    '        vGlint += exp(-dot(d, d) / (uGlints[i].w * uGlints[i].w));\n    }\n' +
    '    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);\n' +
    '    gl_PointSize = (0.05 + 0.06 * aSeed.w) * uPixelsPerUnit * visible;\n}\n'

  var SNOW_FRAGMENT = '\nuniform vec3 uColor;\nuniform vec3 uGlintColor;\nvarying float vAlpha;\nvarying float vGlint;\n' +
    'void main() {\n' +
    '    float d = length(gl_PointCoord - 0.5) * 2.0;\n' +
    '    float alpha = (1.0 - smoothstep(0.35, 1.0, d)) * vAlpha;\n' +
    '    if (alpha < 0.01) discard;\n' +
    '    vec3 color = mix(uColor, uGlintColor, min(1.0, vGlint) * 0.6);\n' +
    '    gl_FragColor = vec4(color, alpha * 0.9);\n' +
    '    #include <tonemapping_fragment>\n    #include <colorspace_fragment>\n}\n'

  var DRIP_FRAGMENT = '\nuniform vec3 uColor;\nuniform float uAmount;\nvarying vec2 vUv;\nvarying float vMode;\nvarying float vFade;\n' +
    'void main() {\n' +
    '    vec2 c = vUv - 0.5;\n' +
    '    float alpha;\n' +
    '    if (vMode < 0.5) {\n' +
    '        alpha = 1.0 - smoothstep(0.3, 0.5, length(c * vec2(1.0, 0.55)));\n' +
    '    } else {\n' +
    '        float d = length(c) * 2.0;\n' +
    '        alpha = smoothstep(0.6, 0.85, d) * (1.0 - smoothstep(0.85, 1.0, d)) * 0.8;\n    }\n' +
    '    gl_FragColor = vec4(uColor * alpha * vFade * 1.3 * uAmount, 1.0);\n' +
    '    #include <tonemapping_fragment>\n    #include <colorspace_fragment>\n}\n'

  function additive(material) {
    material.transparent = true
    material.depthWrite = false
    material.blending = THREE.AdditiveBlending
    return material
  }

  /**
   * constructor(materials, blend, layout, counts { rain, splash, snow })
   * layout: { half, groundY, roofs[], drips[], glints[], windYaw, windSlant }
   */
  function MachiWeather(materials, blend, layout, counts) {
    this._blend = blend
    this.group = new THREE.Group()
    this.group.name = 'Weather'
    this.geometries = []
    this.glintRadii = []
    var roofs = []
    for (var i = 0; i < MAX_ROOFS; i += 1) roofs.push(layout.roofs[i])
    var shared = {
      uRoofs: { value: roofs.map(function (roof) { return roof ? new THREE.Vector4(roof.x0, roof.z0, roof.x1, roof.z1) : new THREE.Vector4(0, 0, 0, 0) }) },
      uRoofY: { value: roofs.map(function (roof) { return roof ? roof.y : -100 }) },
      uGroundY: { value: layout.groundY },
      uHalf: { value: layout.half }
    }
    var HALF = layout.half
    var glints = layout.glints
    this.glintRadii = [0, 1, 2].map(function (index) { return glints[index] ? glints[index].radius : 0.001 })
    var wind = new THREE.Vector2(Math.sin(layout.windYaw), Math.cos(layout.windYaw)).multiplyScalar(layout.windSlant)

    // 雨丝。
    var rainGeometry = new THREE.BufferGeometry()
    var seeds = new Float32Array(counts.rain * 2 * 4)
    var ends = new Float32Array(counts.rain * 2)
    var positions = new Float32Array(counts.rain * 2 * 3)
    for (var index = 0; index < counts.rain; index += 1) {
      var seed = [(Math.random() * 2 - 1) * (HALF + 0.6), (Math.random() * 2 - 1) * (HALF + 0.6), Math.random(), Math.random()]
      for (var end = 0; end < 2; end += 1) {
        seeds.set(seed, (index * 2 + end) * 4)
        ends[index * 2 + end] = end
      }
    }
    rainGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    rainGeometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 4))
    rainGeometry.setAttribute('aEnd', new THREE.BufferAttribute(ends, 1))
    rainGeometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, RAIN_TOP / 2, 0), 14)
    this.rainMaterial = materials.track(additive(new THREE.ShaderMaterial({
      vertexShader: RAIN_VERTEX,
      fragmentShader: RAIN_FRAGMENT,
      uniforms: Object.assign({}, shared, {
        uTime: { value: 0 },
        uWind: { value: wind },
        uLength: { value: 0.42 },
        uSpeed: { value: 11 },
        uDensity: { value: 0.8 },
        uColor: { value: new THREE.Color() },
        uGlintColor: { value: new THREE.Color() },
        uGlints: { value: [0, 1, 2].map(function (i) {
          var glint = glints[i]
          return glint ? new THREE.Vector4(glint.position.x, glint.position.y, glint.position.z, glint.radius) : new THREE.Vector4(0, -100, 0, 0.001)
        }) },
        uOpacity: { value: 0.3 }
      })
    })))
    var rain = new THREE.LineSegments(rainGeometry, this.rainMaterial)
    rain.name = 'Weather/rain'
    rain.frustumCulled = false
    rain.renderOrder = 5
    this.rain = rain

    // 落地水花。
    var splashGeometry = new THREE.InstancedBufferGeometry()
    var quad = new THREE.PlaneGeometry(1, 1)
    splashGeometry.index = quad.index
    splashGeometry.setAttribute('position', quad.getAttribute('position'))
    splashGeometry.setAttribute('uv', quad.getAttribute('uv'))
    var splashSeeds = new Float32Array(counts.splash * 4)
    for (var s = 0; s < counts.splash; s += 1) {
      splashSeeds.set([Math.random(), Math.random(), Math.random() * 10, Math.random()], s * 4)
    }
    splashGeometry.setAttribute('aSeed', new THREE.InstancedBufferAttribute(splashSeeds, 4))
    splashGeometry.instanceCount = counts.splash
    this.splashMaterial = materials.track(additive(new THREE.ShaderMaterial({
      vertexShader: SPLASH_VERTEX,
      fragmentShader: SPLASH_FRAGMENT,
      uniforms: Object.assign({}, shared, {
        uTime: { value: 0 },
        uRate: { value: 1.6 },
        uDensity: { value: 0.8 },
        uColor: { value: new THREE.Color() }
      })
    })))
    var splashes = new THREE.Mesh(splashGeometry, this.splashMaterial)
    splashes.name = 'Weather/splashes'
    splashes.frustumCulled = false
    splashes.renderOrder = 4
    this.splashes = splashes

    // 滴水：场景给的屋檐、落水管口。
    var drips = layout.drips.map(function (drip) { return [drip.x, drip.z, drip.from, drip.to] })
    var timings = layout.drips.map(function (drip) { return [drip.period, drip.phase] })
    var dripGeometry = new THREE.InstancedBufferGeometry()
    dripGeometry.index = quad.index
    dripGeometry.setAttribute('position', quad.getAttribute('position'))
    dripGeometry.setAttribute('uv', quad.getAttribute('uv'))
    dripGeometry.setAttribute('aDrip', new THREE.InstancedBufferAttribute(new Float32Array([].concat.apply([], drips)), 4))
    dripGeometry.setAttribute('aTiming', new THREE.InstancedBufferAttribute(new Float32Array([].concat.apply([], timings)), 2))
    dripGeometry.instanceCount = drips.length
    this.dripMaterial = materials.track(additive(new THREE.ShaderMaterial({
      vertexShader: DRIP_VERTEX,
      fragmentShader: DRIP_FRAGMENT,
      uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color() }, uAmount: { value: 1 } }
    })))
    this.dripMaterial.side = THREE.DoubleSide
    var dripMesh = new THREE.Mesh(dripGeometry, this.dripMaterial)
    dripMesh.name = 'Weather/drips'
    dripMesh.frustumCulled = false
    dripMesh.renderOrder = 5
    this.drips = dripMesh

    // 雪花：位置、相位、大小与密度门槛按点存，下落、飘动都在着色器里。
    var snowGeometry = new THREE.BufferGeometry()
    var snowSeeds = new Float32Array(counts.snow * 4)
    for (var w = 0; w < counts.snow; w += 1) {
      snowSeeds.set([(Math.random() * 2 - 1) * (HALF + 0.6), (Math.random() * 2 - 1) * (HALF + 0.6), Math.random(), Math.random()], w * 4)
    }
    snowGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(counts.snow * 3), 3))
    snowGeometry.setAttribute('aSeed', new THREE.BufferAttribute(snowSeeds, 4))
    this.snowMaterial = materials.track(new THREE.ShaderMaterial({
      vertexShader: SNOW_VERTEX,
      fragmentShader: SNOW_FRAGMENT,
      uniforms: Object.assign({}, shared, {
        uTime: { value: 0 },
        uWind: { value: wind },
        uDensity: { value: 0.8 },
        uPixelsPerUnit: { value: 60 },
        uColor: { value: new THREE.Color() },
        uGlintColor: { value: new THREE.Color() },
        uGlints: this.rainMaterial.uniforms.uGlints
      }),
      transparent: true,
      depthWrite: false
    }))
    var snow = new THREE.Points(snowGeometry, this.snowMaterial)
    snow.name = 'Weather/snow'
    snow.frustumCulled = false
    snow.renderOrder = 5
    this.snow = snow

    this.geometries.push(rainGeometry, splashGeometry, dripGeometry, snowGeometry, quad)
    this.group.add(rain)
    this.group.add(splashes)
    this.group.add(dripMesh)
    this.group.add(snow)
    this.syncColors()
  }

  MachiWeather.prototype.syncColors = function () {
    // 雨丝偏天空色、提亮；被店里的暖光照着的部分由加色混合自然带出。
    var rain = this._blend.get('skyBottom').clone().lerp(new THREE.Color(0xdfe9ff), 0.72)
    this.rainMaterial.uniforms.uColor.value.copy(rain)
    this.rainMaterial.uniforms.uGlintColor.value.copy(this._blend.get('streetLight')).lerp(this._blend.get('interiorLight'), 0.4)
    this.splashMaterial.uniforms.uColor.value.copy(rain).multiplyScalar(0.8)
    this.dripMaterial.uniforms.uColor.value.copy(rain).lerp(this._blend.get('interiorLight'), 0.25)
    // 雪花：白里带一点天光的颜色。
    this.snowMaterial.uniforms.uColor.value.set(0xf4f7fc).lerp(this._blend.get('hemiSky'), 0.18)
    this.snowMaterial.uniforms.uGlintColor.value.copy(this._blend.get('streetLight'))
  }

  /** frame: { time, rain, snow, wetness, glint, pixelsPerUnit } */
  MachiWeather.prototype.update = function (frame) {
    var rain = Math.min(1, frame.rain)
    var density = Math.max(0.15, rain)
    this.rain.visible = rain > 0.01
    this.splashes.visible = rain > 0.01
    this.rainMaterial.uniforms.uTime.value = frame.time
    this.rainMaterial.uniforms.uDensity.value = Math.min(1, rain * 4) * (0.35 + 0.65 * density)
    this.splashMaterial.uniforms.uTime.value = frame.time
    this.splashMaterial.uniforms.uDensity.value = Math.min(1, rain * 4) * (0.3 + 0.7 * density)
    // 雨停了屋檐还滴一会儿：跟着路面湿度。
    this.drips.visible = frame.wetness > 0.05
    this.dripMaterial.uniforms.uTime.value = frame.time
    this.dripMaterial.uniforms.uAmount.value = Math.min(1, frame.wetness * 1.2)
    var snow = Math.min(1, frame.snow)
    this.snow.visible = snow > 0.01
    this.snowMaterial.uniforms.uTime.value = frame.time
    this.snowMaterial.uniforms.uDensity.value = snow * 0.85
    this.snowMaterial.uniforms.uPixelsPerUnit.value = frame.pixelsPerUnit
    // 灯照亮雨丝、雪花：白天几乎没有。
    var glintList = this.rainMaterial.uniforms.uGlints.value
    for (var i = 0; i < glintList.length; i += 1) {
      glintList[i].w = Math.max(0.001, this.glintRadii[i] * frame.glint)
    }
  }

  MachiWeather.prototype.dispose = function () {
    this.geometries.forEach(function (geometry) { geometry.dispose() })
  }

  window.FoliaMachiWeather = MachiWeather
})()
