// 町景的后处理链（移植自 engine/fx/post.ts + postPasses.ts + bloomPass.ts + lensPass.ts，合成一文件）：
// 场景画进带深度贴图的 HDR 目标（MSAA）→ 氛围（墨线、贴地薄雾、云和闪电）→ bloom（五级降分辨率高斯）→
// 横向镜头光条 → 镜头（散景景深、色差、暗角、颗粒，色调映射输出）→ 抗锯齿（FXAA；上游的 SMAA 在插件里降级为
// FXAA——vendor three 未含 examples 的 SMAA，超采样档不受影响）。
// 上游用的 EffectComposer / Pass / FullScreenQuad / UnrealBloomPass / FXAAPass 都来自 three examples，
// vendor three.iife.js 未含，这里按其行为等价自实现（bloom 合成按 UnrealBloomPass 的默认权重与色调）。
(function () {
  'use strict'

  var THREE = window.THREE

  var BLOOM_SCALE = 4
  /** 各级模糊核半径（使用时按 size×2/scale 折算，等效 UnrealBloomPass 一半分辨率的 3,5,7,9,11）。 */
  var KERNEL_SIZES = [6, 10, 14, 18, 22]
  var N_MIPS = 5
  var BLUR_X = new THREE.Vector2(1, 0)
  var BLUR_Y = new THREE.Vector2(0, 1)

  // ===== 全屏四边形（three examples Pass.js 的 FullScreenQuad 等价） =====
  var fsGeometry = null
  var fsCamera = null
  function FullScreenQuad(material) {
    if (!fsGeometry) {
      fsGeometry = new THREE.BufferGeometry()
      fsGeometry.setAttribute('position', new THREE.Float32BufferAttribute([-1, 3, 0, -1, -1, 0, 3, -1, 0], 3))
      fsGeometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 2, 0, 0, 2, 0], 2))
      fsCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
    }
    this.camera = fsCamera
    this._mesh = new THREE.Mesh(fsGeometry, material || null)
    this._scene = new THREE.Scene()
    this._scene.add(this._mesh)
  }
  FullScreenQuad.prototype.render = function (renderer) {
    renderer.render(this._scene, this.camera)
  }
  FullScreenQuad.prototype.dispose = function () { /* 几何为共享缓存，不销毁 */ }
  Object.defineProperty(FullScreenQuad.prototype, 'material', {
    get: function () { return this._mesh.material },
    set: function (value) { this._mesh.material = value }
  })

  /** 全屏 pass 的材质：不做深度测试、不写深度。 */
  function fullscreenMaterial(parameters) {
    var params = Object.assign({}, parameters || {})
    params.vertexShader = '\nvarying vec2 vUv;\nvoid main() {\n    vUv = uv;\n    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);\n}\n'
    params.depthTest = false
    params.depthWrite = false
    return new THREE.ShaderMaterial(params)
  }

  /** 低分辨率的 HDR 中间贴图。 */
  function halfFloatTarget() {
    return new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false })
  }

  /** 场景画进的 HDR 目标（带深度贴图，MSAA 采样数按画质）。 */
  function createSceneTarget(width, height, samples) {
    var depthTexture = new THREE.DepthTexture(width, height)
    depthTexture.type = THREE.UnsignedIntType
    var target = new THREE.WebGLRenderTarget(width, height, { type: THREE.HalfFloatType, samples: samples, depthTexture: depthTexture })
    target.texture.name = 'machi:scene'
    return target
  }

  // ===== 氛围（墨线、贴地薄雾、云和闪电） =====
  var NOISE_GLSL = '\nfloat pHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }\n' +
    'float pNoise(vec2 p) {\n    vec2 i = floor(p);\n    vec2 f = fract(p);\n    vec2 u = f * f * (3.0 - 2.0 * f);\n' +
    '    return mix(mix(pHash(i), pHash(i + vec2(1.0, 0.0)), u.x), mix(pHash(i + vec2(0.0, 1.0)), pHash(i + vec2(1.0, 1.0)), u.x), u.y);\n}\n' +
    'float pFbm(vec2 p) {\n    float value = 0.0;\n    float amplitude = 0.5;\n' +
    '    for (int i = 0; i < 4; i++) {\n        value += amplitude * pNoise(p);\n        p = p * 2.03 + vec2(17.1, 9.2);\n        amplitude *= 0.5;\n    }\n    return value;\n}\n'

  var GLOW_GLSL = '\nuniform sampler2D tBloom;\nuniform sampler2D tStreak;\nuniform vec3 uStreakTint;\nuniform float uStreakStrength;\n' +
    'vec3 machiBloomed(vec2 uv) { return texture2D(tDiffuse, uv).rgb + texture2D(tBloom, uv).rgb; }\n' +
    'vec3 machiGlowed(vec2 uv) { return machiBloomed(uv) + texture2D(tStreak, uv).rgb * uStreakTint * uStreakStrength; }\n'

  var ATMOSPHERE_FRAGMENT = '\nuniform sampler2D tDiffuse;\nuniform sampler2D tDepth;\nuniform vec2 uTexel;\nuniform float uInkScale;\n' +
    'uniform float uDepthRange;\nuniform float uThreshold;\nuniform vec3 uInk;\nuniform float uInkStrength;\nuniform mat4 uProjInv;\n' +
    'uniform mat4 uCamWorld;\nuniform float uTime;\nuniform vec3 uMistColor;\nuniform float uMistAmount;\nuniform float uMistHeight;\n' +
    'uniform vec2 uWind;\nuniform vec4 uGlowA;\nuniform vec3 uGlowColorA;\nuniform vec4 uGlowB;\nuniform vec3 uGlowColorB;\n' +
    'uniform vec3 uCloudColor;\nuniform float uCloudAmount;\nuniform float uHaze;\nuniform vec2 uHazeRange;\nuniform float uLightning;\n' +
    'uniform vec3 uLightningColor;\nuniform float uAspect;\nvarying vec2 vUv;\n' + NOISE_GLSL +
    'float depthAt(vec2 uv) { return texture2D(tDepth, uv).x * uDepthRange; }\n' +
    'void main() {\n' +
    '    vec4 color = texture2D(tDiffuse, vUv);\n' +
    '    float raw = texture2D(tDepth, vUv).x;\n' +
    '    float d = raw * uDepthRange;\n' +
    '    bool sky = raw > 0.9999;\n' +
    // 墨线：平面上深度的二阶差分为零，只有轮廓和折角不为零。取样步长按屏幕像素，线宽不随超采样变。
    '    vec2 inkStep = uTexel * uInkScale;\n' +
    '    float l = depthAt(vUv - vec2(inkStep.x, 0.0));\n' +
    '    float r = depthAt(vUv + vec2(inkStep.x, 0.0));\n' +
    '    float u = depthAt(vUv + vec2(0.0, inkStep.y));\n' +
    '    float b = depthAt(vUv - vec2(0.0, inkStep.y));\n' +
    '    float lu = depthAt(vUv + vec2(-inkStep.x, inkStep.y));\n' +
    '    float rb = depthAt(vUv + vec2(inkStep.x, -inkStep.y));\n' +
    '    float ru = depthAt(vUv + inkStep);\n' +
    '    float lb = depthAt(vUv - inkStep);\n' +
    '    float laplace = abs(l + r - 2.0 * d) + abs(u + b - 2.0 * d) + 0.5 * (abs(lu + rb - 2.0 * d) + abs(ru + lb - 2.0 * d));\n' +
    '    float line = smoothstep(uThreshold, uThreshold * 2.6, laplace) * (sky ? 0.0 : 1.0);\n' +
    '    vec3 rgb = mix(color.rgb, uInk, line * uInkStrength);\n' +
    '    if (sky) {\n' +
    '#ifndef MACHI_CUTOUT\n' +
    // 天空：两层慢慢漂的云，闪电时从云里亮起来。
    '        vec2 p = vec2(vUv.x * uAspect, vUv.y) * 2.4 + vec2(uTime * 0.012, 0.0);\n' +
    '        float cloud = smoothstep(mix(0.62, 0.38, uCloudAmount), 0.85, pFbm(p)) * smoothstep(0.0, 0.55, vUv.y) * (0.35 + 0.65 * uCloudAmount);\n' +
    '        float wisp = smoothstep(0.55, 0.9, pFbm(p * 2.3 + vec2(uTime * 0.02, 3.1))) * (0.5 + 0.5 * uCloudAmount);\n' +
    '        rgb += uCloudColor * (cloud * 0.55 + wisp * 0.18);\n' +
    '        rgb += uLightningColor * uLightning * (0.18 + 1.1 * cloud + 0.4 * wisp);\n' +
    '        rgb = mix(rgb, uMistColor, uHaze * 0.7);\n' +
    '#endif\n' +
    '    } else {\n' +
    // 还原世界坐标，画贴地的雾。
    '        vec4 ndc = vec4(vUv * 2.0 - 1.0, raw * 2.0 - 1.0, 1.0);\n' +
    '        vec4 view = uProjInv * ndc;\n' +
    '        view /= view.w;\n' +
    '        vec3 world = (uCamWorld * view).xyz;\n' +
    '        float height = max(world.y, 0.0);\n' +
    '        float drift = pFbm(world.xz * 0.32 + uWind * uTime) * 0.65 + pFbm(world.xz * 0.9 - uWind * uTime * 1.7) * 0.35;\n' +
    '        float density = uMistAmount * exp(-height / uMistHeight) * (0.35 + 0.9 * drift);\n' +
    // 灯在雾里散开：离店门、路灯越近，雾越亮越暖。
    '        vec2 da = world.xz - uGlowA.xz;\n' +
    '        vec2 db = world.xz - uGlowB.xz;\n' +
    '        vec3 lit = uMistColor\n' +
    '            + uGlowColorA * exp(-dot(da, da) / (uGlowA.w * uGlowA.w)) * exp(-height / 2.2)\n' +
    '            + uGlowColorB * exp(-dot(db, db) / (uGlowB.w * uGlowB.w)) * exp(-height / 3.0);\n' +
    '        rgb = mix(rgb, lit, clamp(density, 0.0, 0.85));\n' +
    // 雾天：离镜头越远越灰。
    '        rgb = mix(rgb, uMistColor, uHaze * (0.3 + 0.7 * smoothstep(uHazeRange.x, uHazeRange.y, d)));\n' +
    '        rgb += rgb * uLightning * 0.18;\n' +
    '    }\n' +
    '    gl_FragColor = vec4(rgb, color.a);\n' +
    '}\n'

  function MachiAtmospherePass(sceneTarget, cutout) {
    this._scene = sceneTarget
    this.material = fullscreenMaterial({
      uniforms: {
        tDiffuse: { value: null },
        tDepth: { value: null },
        uTexel: { value: new THREE.Vector2() },
        uInkScale: { value: 1 },
        uDepthRange: { value: 100 },
        uThreshold: { value: 0.05 },
        uInk: { value: new THREE.Color(0x0b0f1a) },
        uInkStrength: { value: 0.82 },
        uProjInv: { value: new THREE.Matrix4() },
        uCamWorld: { value: new THREE.Matrix4() },
        uTime: { value: 0 },
        uMistColor: { value: new THREE.Color() },
        uMistAmount: { value: 0.22 },
        uMistHeight: { value: 0.55 },
        uWind: { value: new THREE.Vector2(0.05, 0.02) },
        uGlowA: { value: new THREE.Vector4(0, 0, 0, 2.4) },
        uGlowColorA: { value: new THREE.Color() },
        uGlowB: { value: new THREE.Vector4(0, 0, 0, 1.8) },
        uGlowColorB: { value: new THREE.Color() },
        uCloudColor: { value: new THREE.Color() },
        uCloudAmount: { value: 1 },
        uHaze: { value: 0 },
        uHazeRange: { value: new THREE.Vector2(50, 70) },
        uLightning: { value: 0 },
        uLightningColor: { value: new THREE.Color(0xc9d8ff) },
        uAspect: { value: 16 / 9 }
      },
      fragmentShader: ATMOSPHERE_FRAGMENT,
      defines: cutout ? { MACHI_CUTOUT: '' } : {}
    })
    this.quad = new FullScreenQuad(this.material)
  }

  MachiAtmospherePass.prototype.setSize = function (width, height) {
    this.material.uniforms.uTexel.value.set(1 / Math.max(1, width), 1 / Math.max(1, height))
    this.material.uniforms.uAspect.value = width / Math.max(1, height)
  }

  /** 读的是单独的场景目标，画进 scene.lit（都不是合成器的缓冲）。 */
  MachiAtmospherePass.prototype.render = function (renderer) {
    this.material.uniforms.tDiffuse.value = this._scene.target.texture
    this.material.uniforms.tDepth.value = this._scene.target.depthTexture
    renderer.setRenderTarget(this._scene.lit)
    this.quad.render(renderer)
  }

  MachiAtmospherePass.prototype.dispose = function () {
    this.material.dispose()
    this.quad.dispose()
  }

  // ===== bloom（UnrealBloomPass 做法的自实现：提亮 → 五级降分辨率高斯 → 按权重合成，结果留在自己的贴图上） =====
  function gaussian(kernelRadius) {
    var sigma = kernelRadius / 3
    var out = []
    for (var i = 0; i < kernelRadius; i += 1) {
      out.push(0.39894 * Math.exp(-0.5 * i * i / (sigma * sigma)) / sigma)
    }
    return out
  }

  function blurTaps(kernelRadius, paired) {
    var w = gaussian(kernelRadius)
    var offsets = []
    var weights = []
    for (var i = 1; i < kernelRadius; i += paired ? 2 : 1) {
      var a = w[i]
      var b = paired && i + 1 < kernelRadius ? w[i + 1] : 0
      offsets.push(i + b / (a + b))
      weights.push(a + b)
    }
    return { center: w[0], offsets: offsets, weights: weights }
  }

  function blurFragment(taps) {
    return '\nuniform sampler2D colorTexture;\nuniform vec2 invSize;\nuniform vec2 direction;\nuniform float uCenter;\n' +
      'uniform float uOffsets[' + taps + '];\nuniform float uWeights[' + taps + '];\nvarying vec2 vUv;\n' +
      'void main() {\n' +
      '    vec3 sum = texture2D(colorTexture, vUv).rgb * uCenter;\n' +
      '    for (int i = 0; i < ' + taps + '; i++) {\n' +
      '        vec2 offset = direction * invSize * uOffsets[i];\n' +
      '        sum += (texture2D(colorTexture, vUv + offset).rgb + texture2D(colorTexture, vUv - offset).rgb) * uWeights[i];\n    }\n' +
      '    gl_FragColor = vec4(sum, 1.0);\n}\n'
  }

  function blurMaterial(kernelRadius, paired) {
    var taps = blurTaps(kernelRadius, paired)
    return fullscreenMaterial({
      uniforms: {
        colorTexture: { value: null },
        invSize: { value: new THREE.Vector2() },
        direction: { value: new THREE.Vector2() },
        uCenter: { value: taps.center },
        uOffsets: { value: taps.offsets },
        uWeights: { value: taps.weights }
      },
      fragmentShader: blurFragment(taps.offsets.length)
    })
  }

  var HIGH_PASS_FRAGMENT = '\n#include <common>\nuniform sampler2D tDiffuse;\nuniform float luminosityThreshold;\nuniform float smoothWidth;\nuniform vec2 uSpread;\nvarying vec2 vUv;\n' +
    'vec3 bright(vec2 uv) {\n    vec3 texel = texture2D(tDiffuse, uv).rgb;\n' +
    '    return texel * smoothstep(luminosityThreshold, luminosityThreshold + smoothWidth, luminance(texel));\n}\n' +
    'void main() {\n' +
    '#ifdef MACHI_SPREAD\n' +
    '    vec3 c = (bright(vUv - uSpread) + bright(vUv + vec2(uSpread.x, -uSpread.y))\n' +
    '        + bright(vUv + vec2(-uSpread.x, uSpread.y)) + bright(vUv + uSpread)) * 0.25;\n' +
    '#else\n' +
    '    vec3 c = bright(vUv);\n' +
    '#endif\n' +
    '    gl_FragColor = vec4(c, 1.0);\n}\n'

  var COMPOSITE_FRAGMENT = '\nvarying vec2 vUv;\n' +
    'uniform sampler2D blurTexture1;\nuniform sampler2D blurTexture2;\nuniform sampler2D blurTexture3;\nuniform sampler2D blurTexture4;\nuniform sampler2D blurTexture5;\n' +
    'uniform float bloomStrength;\nuniform float bloomRadius;\nuniform float bloomFactors[5];\nuniform vec3 bloomTintColors[5];\n' +
    // UnrealBloomPass 的合成：半径越大，外围的各级权重越往镜像值靠（远处光晕更柔）。
    'vec3 lerpBloomFactor(const in float factor, const in vec3 tint, const in vec2 uv, const in float radius) {\n' +
    '    float mirrorFactor = 1.2 - factor;\n' +
    '    float blend = smoothstep(1.0, 0.0, distance(uv, vec2(0.5)) * radius);\n' +
    '    return mix(factor, mirrorFactor, blend) * tint;\n}\n' +
    'void main() {\n' +
    '    vec3 sum = lerpBloomFactor(1.0, bloomTintColors[0], vUv, bloomRadius) * texture2D(blurTexture1, vUv).rgb\n' +
    '        + lerpBloomFactor(0.8, bloomTintColors[1], vUv, bloomRadius) * texture2D(blurTexture2, vUv).rgb\n' +
    '        + lerpBloomFactor(0.6, bloomTintColors[2], vUv, bloomRadius) * texture2D(blurTexture3, vUv).rgb\n' +
    '        + lerpBloomFactor(0.4, bloomTintColors[3], vUv, bloomRadius) * texture2D(blurTexture4, vUv).rgb\n' +
    '        + lerpBloomFactor(0.2, bloomTintColors[4], vUv, bloomRadius) * texture2D(blurTexture5, vUv).rgb;\n' +
    '    gl_FragColor = vec4(sum * bloomStrength, 1.0);\n}\n'

  /**
   * scene: { target, lit }；scale：整条链从画面的 1/scale 分辨率起。
   * constructor(scene, scale, strength, radius, threshold)
   */
  function MachiBloomPass(scene, scale, strength, radius, threshold) {
    this._scene = scene
    this._scale = scale
    this.strength = strength
    this.radius = radius
    this.threshold = threshold
    this.enabled = true
    this.nMips = N_MIPS
    this.renderTargetBright = halfFloatTarget()
    this.renderTargetsHorizontal = []
    this.renderTargetsVertical = []
    for (var i = 0; i < N_MIPS; i += 1) {
      this.renderTargetsHorizontal.push(halfFloatTarget())
      this.renderTargetsVertical.push(halfFloatTarget())
    }
    this.bloomTintColors = [
      new THREE.Vector3(1, 1, 1), new THREE.Vector3(1, 1, 1), new THREE.Vector3(1, 1, 1),
      new THREE.Vector3(1, 1, 1), new THREE.Vector3(1, 1, 1)
    ]
    this.bloomFactors = [1.0, 0.8, 0.6, 0.4, 0.2]
    this.clearColor = new THREE.Color(0, 0, 0)
    var kernels = KERNEL_SIZES.slice(0, N_MIPS).map(function (size) { return Math.max(2, Math.round(size * 2 / scale)) })
    var self = this
    this.blurX = kernels.map(function (size, i) { return blurMaterial(size, i === 0) })
    this.blurY = kernels.map(function (size) { return blurMaterial(size, true) })
    this.highPass = fullscreenMaterial({
      uniforms: {
        tDiffuse: { value: null },
        luminosityThreshold: { value: threshold },
        smoothWidth: { value: 0.01 },
        uSpread: { value: new THREE.Vector2() }
      },
      fragmentShader: HIGH_PASS_FRAGMENT,
      defines: scale > 2 ? { MACHI_SPREAD: '' } : {}
    })
    this.compositeMaterial = fullscreenMaterial({
      uniforms: {
        blurTexture1: { value: null },
        blurTexture2: { value: null },
        blurTexture3: { value: null },
        blurTexture4: { value: null },
        blurTexture5: { value: null },
        bloomStrength: { value: strength },
        bloomRadius: { value: radius },
        bloomFactors: { value: this.bloomFactors },
        bloomTintColors: { value: this.bloomTintColors }
      },
      fragmentShader: COMPOSITE_FRAGMENT
    })
    this.quad = new FullScreenQuad()
    void self
  }

  /** 合成好的 bloom（1/scale 分辨率，已乘强度）。 */
  Object.defineProperty(MachiBloomPass.prototype, 'texture', {
    get: function () { return this.renderTargetsHorizontal[0].texture }
  })

  MachiBloomPass.prototype.setSize = function (width, height) {
    var x = Math.max(1, Math.round(width / this._scale))
    var y = Math.max(1, Math.round(height / this._scale))
    this.renderTargetBright.setSize(x, y)
    this.highPass.uniforms.uSpread.value.set(this._scale / 4 / Math.max(1, width), this._scale / 4 / Math.max(1, height))
    for (var i = 0; i < this.nMips; i += 1) {
      this.renderTargetsHorizontal[i].setSize(x, y)
      this.renderTargetsVertical[i].setSize(x, y)
      this.blurX[i].uniforms.invSize.value.set(1 / x, 1 / y)
      this.blurY[i].uniforms.invSize.value.set(1 / x, 1 / y)
      x = Math.max(1, Math.round(x / 2))
      y = Math.max(1, Math.round(y / 2))
    }
  }

  MachiBloomPass.prototype._draw = function (renderer, material, target) {
    this.quad.material = material
    renderer.setRenderTarget(target)
    renderer.clear()
    this.quad.render(renderer)
  }

  MachiBloomPass.prototype.render = function (renderer) {
    renderer.getClearColor(this._oldClearColor || (this._oldClearColor = new THREE.Color()))
    var oldClearAlpha = renderer.getClearAlpha()
    var oldAutoClear = renderer.autoClear
    renderer.autoClear = false
    renderer.setClearColor(this.clearColor, 0)
    this.highPass.uniforms.tDiffuse.value = this._scene.lit.texture
    this.highPass.uniforms.luminosityThreshold.value = this.threshold
    this._draw(renderer, this.highPass, this.renderTargetBright)
    var input = this.renderTargetBright
    for (var i = 0; i < this.nMips; i += 1) {
      var blurX = this.blurX[i]
      var blurY = this.blurY[i]
      blurX.uniforms.colorTexture.value = input.texture
      blurX.uniforms.direction.value = BLUR_X
      this._draw(renderer, blurX, this.renderTargetsHorizontal[i])
      blurY.uniforms.colorTexture.value = this.renderTargetsHorizontal[i].texture
      blurY.uniforms.direction.value = BLUR_Y
      this._draw(renderer, blurY, this.renderTargetsVertical[i])
      input = this.renderTargetsVertical[i]
    }
    var composite = this.compositeMaterial.uniforms
    composite.blurTexture1.value = this.renderTargetsVertical[0].texture
    composite.blurTexture2.value = this.renderTargetsVertical[1].texture
    composite.blurTexture3.value = this.renderTargetsVertical[2].texture
    composite.blurTexture4.value = this.renderTargetsVertical[3].texture
    composite.blurTexture5.value = this.renderTargetsVertical[4].texture
    composite.bloomStrength.value = this.strength
    composite.bloomRadius.value = this.radius
    composite.bloomTintColors.value = this.bloomTintColors
    this._draw(renderer, this.compositeMaterial, this.renderTargetsHorizontal[0])
    renderer.setClearColor(this._oldClearColor, oldClearAlpha)
    renderer.autoClear = oldAutoClear
  }

  MachiBloomPass.prototype.dispose = function () {
    this.renderTargetBright.dispose()
    this.renderTargetsHorizontal.forEach(function (t) { t.dispose() })
    this.renderTargetsVertical.forEach(function (t) { t.dispose() })
    this.highPass.dispose()
    this.blurX.forEach(function (m) { m.dispose() })
    this.blurY.forEach(function (m) { m.dispose() })
    this.compositeMaterial.dispose()
    this.quad.dispose()
  }

  // ===== 横向镜头光条 =====
  var BRIGHT_FRAGMENT = '\nuniform sampler2D tDiffuse;\nuniform vec2 uTexel;\nuniform float uThreshold;\nvarying vec2 vUv;\n' + GLOW_GLSL +
    'void main() {\n' +
    '    vec3 c = machiBloomed(vUv + uTexel * vec2(-1.0, -1.0))\n' +
    '        + machiBloomed(vUv + uTexel * vec2(1.0, -1.0))\n' +
    '        + machiBloomed(vUv + uTexel * vec2(-1.0, 1.0))\n' +
    '        + machiBloomed(vUv + uTexel * vec2(1.0, 1.0));\n' +
    '    c *= 0.25;\n' +
    '    float luminance = dot(c, vec3(0.2126, 0.7152, 0.0722));\n' +
    '    gl_FragColor = vec4(c * smoothstep(uThreshold, uThreshold + 0.5, luminance), 1.0);\n}\n'

  var STREAK_BLUR_FRAGMENT = '\nuniform sampler2D tDiffuse;\nuniform vec2 uStep;\nvarying vec2 vUv;\n' +
    'void main() {\n' +
    '    vec3 sum = texture2D(tDiffuse, vUv).rgb * 0.2;\n' +
    '    float weights[4];\n' +
    '    weights[0] = 0.17; weights[1] = 0.13; weights[2] = 0.08; weights[3] = 0.04;\n' +
    '    for (int i = 0; i < 4; i++) {\n' +
    '        vec2 offset = uStep * float(i + 1);\n' +
    '        sum += (texture2D(tDiffuse, vUv + offset).rgb + texture2D(tDiffuse, vUv - offset).rgb) * weights[i];\n    }\n' +
    '    gl_FragColor = vec4(sum, 1.0);\n}\n'

  /** constructor(scene, glow) */
  function MachiStreakPass(scene, glow) {
    this._scene = scene
    this.enabled = true
    this.targets = [halfFloatTarget(), halfFloatTarget()]
    this.bright = fullscreenMaterial({
      uniforms: Object.assign({}, glow, { tDiffuse: { value: null }, uTexel: { value: new THREE.Vector2() }, uThreshold: { value: 1.1 } }),
      fragmentShader: BRIGHT_FRAGMENT
    })
    this.blur = fullscreenMaterial({
      uniforms: { tDiffuse: { value: null }, uStep: { value: new THREE.Vector2() } },
      fragmentShader: STREAK_BLUR_FRAGMENT
    })
    this.quad = new FullScreenQuad()
    /** 模糊完的光条（三次来回，落在第二张）。 */
    this.texture = this.targets[1].texture
  }

  MachiStreakPass.prototype.setSize = function (width, height) {
    var w = Math.max(1, Math.round(width / 4))
    var h = Math.max(1, Math.round(height / 4))
    this.targets.forEach(function (target) { target.setSize(w, h) })
    this.bright.uniforms.uTexel.value.set(1 / Math.max(1, width), 1 / Math.max(1, height))
  }

  MachiStreakPass.prototype.render = function (renderer) {
    var a = this.targets[0]
    var b = this.targets[1]
    this.bright.uniforms.tDiffuse.value = this._scene.lit.texture
    this.quad.material = this.bright
    renderer.setRenderTarget(a)
    this.quad.render(renderer)
    var source = a
    var target = b
    var spreads = [1, 4, 14]
    for (var i = 0; i < spreads.length; i += 1) {
      this.blur.uniforms.tDiffuse.value = source.texture
      this.blur.uniforms.uStep.value.set(spreads[i] / Math.max(1, source.width), 0)
      this.quad.material = this.blur
      renderer.setRenderTarget(target)
      this.quad.render(renderer)
      var swap = source; source = target; target = swap
    }
  }

  MachiStreakPass.prototype.dispose = function () {
    this.targets.forEach(function (target) { target.dispose() })
    this.bright.dispose()
    this.blur.dispose()
    this.quad.dispose()
  }

  // ===== FXAA（three FXAAShader 的标准实现；SMAA 档在插件里降级为它） =====
  var FXAA_FRAGMENT = '\nuniform sampler2D tDiffuse;\nuniform vec2 resolution;\nvarying vec2 vUv;\n' +
    '#define FXAA_SPAN_MAX 8.0\n' +
    '#define FXAA_REDUCE_MUL (1.0 / 8.0)\n' +
    '#define FXAA_REDUCE_MIN (1.0 / 128.0)\n' +
    'vec4 fxaaPixel(vec2 uv) { return texture2D(tDiffuse, uv); }\n' +
    'void main() {\n' +
    '    vec2 invResolution = 1.0 / resolution;\n' +
    '    vec3 rgbNW = fxaaPixel(vUv + vec2(-1.0, -1.0) * invResolution).xyz;\n' +
    '    vec3 rgbNE = fxaaPixel(vUv + vec2(1.0, -1.0) * invResolution).xyz;\n' +
    '    vec3 rgbSW = fxaaPixel(vUv + vec2(-1.0, 1.0) * invResolution).xyz;\n' +
    '    vec3 rgbSE = fxaaPixel(vUv + vec2(1.0, 1.0) * invResolution).xyz;\n' +
    '    vec3 rgbM = fxaaPixel(vUv).xyz;\n' +
    '    vec3 luma = vec3(0.299, 0.587, 0.114);\n' +
    '    float lumaNW = dot(rgbNW, luma);\n' +
    '    float lumaNE = dot(rgbNE, luma);\n' +
    '    float lumaSW = dot(rgbSW, luma);\n' +
    '    float lumaSE = dot(rgbSE, luma);\n' +
    '    float lumaM = dot(rgbM, luma);\n' +
    '    float lumaMin = min(lumaM, min(min(lumaNW, lumaNE), min(lumaSW, lumaSE)));\n' +
    '    float lumaMax = max(lumaM, max(max(lumaNW, lumaNE), max(lumaSW, lumaSE)));\n' +
    '    vec2 dir = vec2(-((lumaNW + lumaNE) - (lumaSW + lumaSE)), ((lumaNW + lumaSW) - (lumaNE + lumaSE)));\n' +
    '    float dirReduce = max((lumaNW + lumaNE + lumaSW + lumaSE) * 0.25 * FXAA_REDUCE_MUL, FXAA_REDUCE_MIN);\n' +
    '    float rcpDirMin = 1.0 / (min(abs(dir.x), abs(dir.y)) + dirReduce);\n' +
    '    dir = clamp(dir * rcpDirMin, vec2(-FXAA_SPAN_MAX, -FXAA_SPAN_MAX), vec2(FXAA_SPAN_MAX, FXAA_SPAN_MAX)) * invResolution;\n' +
    '    vec3 rgbA = 0.5 * (fxaaPixel(vUv + dir * (1.0 / 3.0 - 0.5)).xyz + fxaaPixel(vUv + dir * (2.0 / 3.0 - 0.5)).xyz);\n' +
    '    vec3 rgbB = rgbA * 0.5 + 0.25 * (fxaaPixel(vUv + dir * -0.5).xyz + fxaaPixel(vUv + dir * 0.5).xyz);\n' +
    '    float lumaB = dot(rgbB, luma);\n' +
    '    gl_FragColor = (lumaB < lumaMin || lumaB > lumaMax) ? vec4(rgbA, 1.0) : vec4(rgbB, 1.0);\n}\n'

  function fxaaMaterial() {
    return fullscreenMaterial({
      uniforms: { tDiffuse: { value: null }, resolution: { value: new THREE.Vector2(1, 1) } },
      fragmentShader: FXAA_FRAGMENT
    })
  }

  // ===== 镜头 pass（散景景深、色差、暗角、颗粒、色调映射） =====
  var LEVEL_MAX_COC = 8
  var LEVELS = 5
  var MAX_TAPS = 48

  var COC_GLSL = '\nuniform float uDepthRange;\nuniform float uFocus;\nuniform float uFocusBand;\nuniform float uFocusFalloff;\nuniform float uCocRadius;\nuniform float uTiltRadius;\n' +
    'float machiCoc(float depth01, vec2 uv) {\n' +
    '    float offset = depth01 * uDepthRange - uFocus;\n' +
    '    float coc = smoothstep(uFocusBand, uFocusBand + uFocusFalloff, abs(offset)) * uCocRadius * (offset < 0.0 ? -1.0 : 1.0);\n' +
    '    float tilt = smoothstep(0.2, 0.55, abs(uv.y - 0.5)) * uTiltRadius;\n' +
    '    return abs(coc) >= tilt ? coc : tilt;\n}\n'

  var PREFILTER_FRAGMENT = '\nuniform sampler2D tDiffuse;\nuniform sampler2D tDepth;\nuniform vec2 uSourceTexel;\nvarying vec2 vUv;\n' + COC_GLSL + GLOW_GLSL +
    'float widest(float a, float b) { return abs(a) >= abs(b) ? a : b; }\n' +
    'void main() {\n' +
    '    vec2 o = uSourceTexel * 0.5;\n' +
    '    vec2 p0 = vUv + vec2(-o.x, -o.y);\n' +
    '    vec2 p1 = vUv + vec2(o.x, -o.y);\n' +
    '    vec2 p2 = vUv + vec2(-o.x, o.y);\n' +
    '    vec2 p3 = vUv + vec2(o.x, o.y);\n' +
    '#ifdef MACHI_CUTOUT\n' +
    '    float d0 = texture2D(tDepth, p0).x;\n' +
    '    float d1 = texture2D(tDepth, p1).x;\n' +
    '    float d2 = texture2D(tDepth, p2).x;\n' +
    '    float d3 = texture2D(tDepth, p3).x;\n' +
    '    float h0 = step(d0, 0.9999);\n' +
    '    float h1 = step(d1, 0.9999);\n' +
    '    float h2 = step(d2, 0.9999);\n' +
    '    float h3 = step(d3, 0.9999);\n' +
    '    float hits = h0 + h1 + h2 + h3;\n' +
    '    vec3 color = hits > 0.0\n' +
    '        ? (machiGlowed(p0) * h0 + machiGlowed(p1) * h1 + machiGlowed(p2) * h2 + machiGlowed(p3) * h3) / hits\n' +
    '        : (machiGlowed(p0) + machiGlowed(p1) + machiGlowed(p2) + machiGlowed(p3)) * 0.25;\n' +
    '    float coc = widest(\n' +
    '        widest(machiCoc(d0, p0) * h0, machiCoc(d1, p1) * h1),\n' +
    '        widest(machiCoc(d2, p2) * h2, machiCoc(d3, p3) * h3)\n' +
    '    );\n' +
    '#else\n' +
    '    vec3 color = (machiGlowed(p0) + machiGlowed(p1) + machiGlowed(p2) + machiGlowed(p3)) * 0.25;\n' +
    '    float coc = widest(\n' +
    '        widest(machiCoc(texture2D(tDepth, p0).x, p0), machiCoc(texture2D(tDepth, p1).x, p1)),\n' +
    '        widest(machiCoc(texture2D(tDepth, p2).x, p2), machiCoc(texture2D(tDepth, p3).x, p3))\n' +
    '    );\n' +
    '#endif\n' +
    '    gl_FragColor = vec4(color, coc);\n}\n'

  var DOWNSAMPLE_FRAGMENT = '\nuniform sampler2D tSource;\nuniform vec2 uSourceTexel;\nvarying vec2 vUv;\n' +
    'float widest(float a, float b) { return abs(a) >= abs(b) ? a : b; }\n' +
    'void main() {\n' +
    '    vec2 o = uSourceTexel * 0.5;\n' +
    '    vec4 s0 = texture2D(tSource, vUv + vec2(-o.x, -o.y));\n' +
    '    vec4 s1 = texture2D(tSource, vUv + vec2(o.x, -o.y));\n' +
    '    vec4 s2 = texture2D(tSource, vUv + vec2(-o.x, o.y));\n' +
    '    vec4 s3 = texture2D(tSource, vUv + vec2(o.x, o.y));\n' +
    '    gl_FragColor = vec4((s0.rgb + s1.rgb + s2.rgb + s3.rgb) * 0.25, widest(widest(s0.a, s1.a), widest(s2.a, s3.a)));\n}\n'

  var GATHER_FRAGMENT = '\nuniform sampler2D tSource;\nuniform vec2 uTexel;\nuniform float uMaxCoc;\nuniform float uLevelScale;\nuniform float uTaps;\nvarying vec2 vUv;\n' +
    'const mat2 GOLDEN_TURN = mat2(-0.73736888, 0.67549029, -0.67549029, -0.73736888);\n' +
    'const float MARGIN = 1.2;\n' +
    'void main() {\n' +
    '    vec4 center = texture2D(tSource, vUv);\n' +
    '    float centerCoc = center.a / uLevelScale;\n' +
    '    vec4 far = vec4(0.0);\n' +
    '    vec4 near = vec4(0.0);\n' +
    '    vec2 direction = vec2(1.0, 0.0);\n' +
    '    for (int i = 0; i < ' + MAX_TAPS + '; i++) {\n' +
    '        if (float(i) >= uTaps) break;\n' +
    '        float radius = sqrt((float(i) + 0.5) / uTaps) * uMaxCoc;\n' +
    '        vec4 tap = texture2D(tSource, vUv + direction * radius * uTexel);\n' +
    '        direction = GOLDEN_TURN * direction;\n' +
    '        float tapCoc = tap.a / uLevelScale;\n' +
    '        float farCoc = max(min(centerCoc, tapCoc), 0.0);\n' +
    '        float farWeight = clamp((farCoc - radius + MARGIN) / MARGIN, 0.0, 1.0);\n' +
    '        float nearWeight = clamp((-tapCoc - radius + MARGIN) / MARGIN, 0.0, 1.0) * step(1.0, -tapCoc);\n' +
    '        far += vec4(tap.rgb, 1.0) * farWeight;\n' +
    '        near += vec4(tap.rgb, 1.0) * nearWeight;\n' +
    '    }\n' +
    '    vec3 farColor = far.a > 0.0 ? far.rgb / far.a : center.rgb;\n' +
    '    vec3 nearColor = near.a > 0.0 ? near.rgb / near.a : center.rgb;\n' +
    '    float nearAlpha = clamp(near.a * 3.14159 / uTaps, 0.0, 1.0);\n' +
    '    gl_FragColor = vec4(mix(farColor, nearColor, nearAlpha), nearAlpha);\n}\n'

  var TENT_FRAGMENT = '\nuniform sampler2D tSource;\nuniform vec2 uTexel;\nvarying vec2 vUv;\n' +
    'void main() {\n' +
    '    vec2 o = uTexel * 0.5;\n' +
    '    gl_FragColor = (texture2D(tSource, vUv + vec2(-o.x, -o.y)) + texture2D(tSource, vUv + vec2(o.x, -o.y))\n' +
    '        + texture2D(tSource, vUv + vec2(-o.x, o.y)) + texture2D(tSource, vUv + vec2(o.x, o.y))) * 0.25;\n}\n'

  var LENS_FRAGMENT = '\nuniform sampler2D tDiffuse;\nuniform sampler2D tBokeh;\nuniform sampler2D tDepth;\nuniform sampler2D tCoverage;\n' +
    'uniform float uDofMix;\nuniform vec2 uBlend;\nuniform float uAberration;\nuniform float uVignette;\nuniform float uGrain;\n' +
    'uniform float uFade;\nuniform float uStars;\nuniform float uTime;\nuniform float uAspect;\nvarying vec2 vUv;\n' +
    COC_GLSL + GLOW_GLSL +
    // tonemapping_pars 必须手动 include（本材质 toneMapped:false，three 前缀不注入它）；
    // colorspace_pars 不能再 include——renderer 上屏 sRGB 时 three 前缀已注入过，
    // 重复定义 LinearTransferOETF/sRGBTransferEOTF/sRGBTransferOETF 会直接编译失败（黑屏根因）。
    '#include <tonemapping_pars_fragment>\n' +
    'float gHash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }\n' +
    'void main() {\n' +
    '    vec2 centered = vUv - 0.5;\n' +
    '    float edge = dot(centered, centered);\n' +
    // 边缘色差：红蓝沿径向错开，中间不动。
    '    vec2 shift = centered * edge * uAberration;\n' +
    '    vec3 sharp = vec3(\n' +
    '        machiGlowed(vUv + shift).r,\n' +
    '        machiGlowed(vUv).g,\n' +
    '        machiGlowed(vUv - shift).b\n' +
    '    );\n' +
    '    vec4 bokeh = texture2D(tBokeh, vUv);\n' +
    '    float depth01 = texture2D(tDepth, vUv).x;\n' +
    '    float own = smoothstep(uBlend.x, uBlend.y, abs(machiCoc(depth01, vUv)));\n' +
    '    float amount = (own + bokeh.a - own * bokeh.a) * uDofMix;\n' +
    '    vec3 color = mix(sharp, bokeh.rgb, clamp(amount, 0.0, 1.0));\n' +
    '#ifndef MACHI_CUTOUT\n' +
    // 晴夜的星星：天空像素上格子里稀疏的亮点，各自慢慢闪。
    '    if (uStars > 0.001 && depth01 > 0.9999) {\n' +
    '        vec2 sp = vec2(vUv.x * uAspect, vUv.y) * 140.0;\n' +
    '        vec2 cell = floor(sp);\n' +
    '        float starSeed = gHash(cell);\n' +
    '        vec2 starAt = vec2(gHash(cell + 3.7), gHash(cell + 9.1)) * 0.6 + 0.2;\n' +
    '        float star = step(0.984, starSeed) * smoothstep(0.24, 0.0, length(fract(sp) - starAt))\n' +
    '            * (0.55 + 0.45 * sin(uTime * (0.8 + starSeed * 3.0) + starSeed * 60.0));\n' +
    '        color += vec3(0.85, 0.9, 1.0) * star * uStars * 1.3 * smoothstep(0.1, 0.55, vUv.y);\n' +
    '    }\n' +
    '#endif\n' +
    // 暗角。
    '    vec2 v = centered * vec2(uAspect, 1.0);\n' +
    '    float vignette = smoothstep(1.15, 0.35, length(v) * 1.15);\n' +
    '    color *= mix(1.0, vignette, uVignette);\n' +
    // 颗粒：跟亮度走，暗部更细。
    '    float grain = gHash(vUv * vec2(1733.0, 977.0) + fract(uTime * 7.31)) - 0.5;\n' +
    '    color += grain * uGrain * (0.25 + dot(color, vec3(0.3333)));\n' +
    '#ifdef MACHI_CUTOUT\n' +
    '    float alpha = depth01 > 0.9999 ? 0.0 : clamp(texture2D(tCoverage, vUv).a, 0.0, 1.0);\n' +
    '    gl_FragColor = vec4(max(color, vec3(0.0)), alpha) * uFade;\n' +
    '#else\n' +
    '    gl_FragColor = vec4(max(color, vec3(0.0)) * uFade, 1.0);\n' +
    '#endif\n' +
    // 色调映射与 sRGB 编码（渲染器不再往上屏的着色器里加一份）。
    '#ifdef NEUTRAL_TONE_MAPPING\n' +
    '    gl_FragColor.rgb = NeutralToneMapping(gl_FragColor.rgb);\n' +
    '#endif\n' +
    '#ifdef SRGB_TRANSFER\n' +
    '    gl_FragColor = sRGBTransferOETF(gl_FragColor);\n' +
    '#endif\n' +
    '}\n'

  /** 散景那一层用第几层、最大的圆在那一层多少像素、取多少个样（纯函数）。 */
  function resolveMachiBokehLevel(maxCocPx) {
    var level = 0
    var levelCoc = maxCocPx / 2
    while (levelCoc > LEVEL_MAX_COC && level < LEVELS - 1) {
      level += 1
      levelCoc /= 2
    }
    var taps = Math.min(MAX_TAPS, Math.max(12, Math.ceil((Math.PI * levelCoc * levelCoc) / 4)))
    return { level: level, levelCoc: levelCoc, taps: taps, scale: Math.pow(2, level + 1) }
  }

  /** constructor(scene, glow, output { neutralToneMapping, srgb }, cutout) */
  function MachiLensPass(scene, glow, output, cutout) {
    this._scene = scene
    this.dofEnabled = true
    this._dofActive = true
    this._bokeh = resolveMachiBokehLevel(0)
    this.chain = []
    for (var i = 0; i < LEVELS; i += 1) this.chain.push(halfFloatTarget())
    this.work = [halfFloatTarget(), halfFloatTarget()]
    var coc = {
      uDepthRange: { value: 100 },
      uFocus: { value: 60 },
      uFocusBand: { value: 3 },
      uFocusFalloff: { value: 7 },
      uCocRadius: { value: 0 },
      uTiltRadius: { value: 0 }
    }
    this.prefilter = fullscreenMaterial({
      uniforms: Object.assign({}, coc, glow, { tDiffuse: { value: null }, tDepth: { value: null }, uSourceTexel: { value: new THREE.Vector2() } }),
      fragmentShader: PREFILTER_FRAGMENT,
      defines: cutout ? { MACHI_CUTOUT: '' } : {}
    })
    this.downsample = fullscreenMaterial({
      uniforms: { tSource: { value: null }, uSourceTexel: { value: new THREE.Vector2() } },
      fragmentShader: DOWNSAMPLE_FRAGMENT
    })
    this.gather = fullscreenMaterial({
      uniforms: {
        tSource: { value: null },
        uTexel: { value: new THREE.Vector2() },
        uMaxCoc: { value: 1 },
        uLevelScale: { value: 2 },
        uTaps: { value: 12 }
      },
      fragmentShader: GATHER_FRAGMENT
    })
    this.tent = fullscreenMaterial({
      uniforms: { tSource: { value: null }, uTexel: { value: new THREE.Vector2() } },
      fragmentShader: TENT_FRAGMENT
    })
    this.material = fullscreenMaterial({
      uniforms: Object.assign({}, coc, glow, {
        tDiffuse: { value: null },
        tBokeh: { value: null },
        tDepth: { value: null },
        tCoverage: { value: null },
        uDofMix: { value: 0 },
        uBlend: { value: new THREE.Vector2(1, 3) },
        uAberration: { value: 0.012 },
        uVignette: { value: 0.55 },
        uGrain: { value: 0.035 },
        uStars: { value: 0 },
        uFade: { value: 1 },
        uTime: { value: 0 },
        uAspect: { value: 16 / 9 }
      }),
      fragmentShader: LENS_FRAGMENT,
      defines: Object.assign(
        {},
        cutout ? { MACHI_CUTOUT: '' } : {},
        output.neutralToneMapping ? { NEUTRAL_TONE_MAPPING: '' } : {},
        output.srgb ? { SRGB_TRANSFER: '' } : {}
      ),
      // 色调映射自己做（上面的 #include）：渲染器不再往上屏的着色器里加一份。
      toneMapped: false
    })
    this.quad = new FullScreenQuad()
    this._fullSize = new THREE.Vector2(1, 1)
  }

  MachiLensPass.prototype.setSize = function (width, height) {
    this._fullSize.set(Math.max(1, width), Math.max(1, height))
    var self = this
    this.chain.forEach(function (target, index) {
      var divisor = Math.pow(2, index + 1)
      target.setSize(Math.max(1, Math.round(width / divisor)), Math.max(1, Math.round(height / divisor)))
    })
    this.material.uniforms.uAspect.value = width / Math.max(1, height)
  }

  MachiLensPass.prototype.configure = function (settings, depthRange, time) {
    var uniforms = this.material.uniforms
    var height = this._fullSize.y
    var cocPx = Math.max(0, settings.coc) * height
    var tiltPx = Math.max(0, settings.tilt) * height
    this._dofActive = this.dofEnabled && (cocPx > 0.5 || tiltPx > 0.5)
    this._bokeh = resolveMachiBokehLevel(Math.max(cocPx, tiltPx))
    uniforms.uDepthRange.value = depthRange
    uniforms.uFocus.value = settings.focus
    uniforms.uFocusBand.value = settings.focusBand
    uniforms.uFocusFalloff.value = settings.focusFalloff
    uniforms.uCocRadius.value = this._dofActive ? cocPx : 0
    uniforms.uTiltRadius.value = this._dofActive ? tiltPx : 0
    uniforms.uDofMix.value = this._dofActive ? 1 : 0
    uniforms.uBlend.value.set(0.5 * this._bokeh.scale, 1.5 * this._bokeh.scale)
    uniforms.uAberration.value = settings.aberration
    uniforms.uVignette.value = settings.vignette
    uniforms.uGrain.value = settings.grain
    uniforms.uStars.value = settings.stars !== undefined ? settings.stars : 0
    uniforms.uFade.value = settings.fade !== undefined ? settings.fade : 1
    uniforms.uTime.value = time
  }

  MachiLensPass.prototype._draw = function (renderer, material, target) {
    this.quad.material = material
    renderer.setRenderTarget(target)
    this.quad.render(renderer)
  }

  /** 读氛围画好的 scene.lit，画进 writeBuffer（8 位显示颜色）或直接上屏（target 为 null）。 */
  MachiLensPass.prototype.render = function (renderer, writeBuffer) {
    var uniforms = this.material.uniforms
    var depth = this._scene.target.depthTexture
    var lit = this._scene.lit.texture
    uniforms.tBokeh.value = lit
    if (this._dofActive) {
      var level = this._bokeh.level
      var levelCoc = this._bokeh.levelCoc
      var taps = this._bokeh.taps
      var scale = this._bokeh.scale
      var first = this.chain[0]
      this.prefilter.uniforms.tDiffuse.value = lit
      this.prefilter.uniforms.tDepth.value = depth
      this.prefilter.uniforms.uSourceTexel.value.set(1 / this._fullSize.x, 1 / this._fullSize.y)
      this._draw(renderer, this.prefilter, first)
      for (var index = 1; index <= level; index += 1) {
        var downSource = this.chain[index - 1]
        this.downsample.uniforms.tSource.value = downSource.texture
        this.downsample.uniforms.uSourceTexel.value.set(1 / downSource.width, 1 / downSource.height)
        this._draw(renderer, this.downsample, this.chain[index])
      }
      var source = this.chain[level]
      var gathered = this.work[0]
      var smoothed = this.work[1]
      gathered.setSize(source.width, source.height)
      smoothed.setSize(source.width, source.height)
      var gather = this.gather.uniforms
      gather.tSource.value = source.texture
      gather.uTexel.value.set(1 / source.width, 1 / source.height)
      gather.uMaxCoc.value = levelCoc
      gather.uLevelScale.value = scale
      gather.uTaps.value = taps
      this._draw(renderer, this.gather, gathered)
      this.tent.uniforms.tSource.value = gathered.texture
      this.tent.uniforms.uTexel.value.set(1 / source.width, 1 / source.height)
      this._draw(renderer, this.tent, smoothed)
      uniforms.tBokeh.value = smoothed.texture
    }
    uniforms.tDiffuse.value = lit
    uniforms.tDepth.value = depth
    uniforms.tCoverage.value = this._scene.target.texture
    this._draw(renderer, this.material, writeBuffer)
  }

  MachiLensPass.prototype.dispose = function () {
    this.chain.forEach(function (target) { target.dispose() })
    this.work.forEach(function (target) { target.dispose() })
    this.prefilter.dispose()
    this.downsample.dispose()
    this.gather.dispose()
    this.tent.dispose()
    this.material.dispose()
    this.quad.dispose()
  }

  // ===== 后处理编排（EffectComposer 的显式等价） =====
  function createGlowUniforms() {
    return {
      tBloom: { value: null },
      tStreak: { value: null },
      uStreakTint: { value: new THREE.Color(0.62, 0.74, 1.0) },
      uStreakStrength: { value: 0 }
    }
  }

  /**
   * constructor(renderer, sceneGraph, camera, quality, cutout=false)
   * quality: { samples, bloom, streaks, dof, postAA, inkScale }
   */
  function MachiPost(renderer, sceneGraph, camera, quality, cutout) {
    cutout = Boolean(cutout)
    this._renderer = renderer
    this._sceneGraph = sceneGraph
    this._camera = camera
    var size = renderer.getDrawingBufferSize(new THREE.Vector2())
    var lit = halfFloatTarget()
    lit.texture.name = 'machi:lit'
    lit.setSize(size.x, size.y)
    this.scene = { target: createSceneTarget(size.x, size.y, quality.samples), lit: lit }
    this.black = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1)
    this.black.needsUpdate = true
    this.glow = createGlowUniforms()
    this.atmosphere = new MachiAtmospherePass(this.scene, cutout)
    this.bloom = new MachiBloomPass(this.scene, BLOOM_SCALE, 0.5, 0.62, 0.86)
    this.streaks = new MachiStreakPass(this.scene, this.glow)
    this.lens = new MachiLensPass(this.scene, this.glow, {
      neutralToneMapping: renderer.toneMapping === THREE.NeutralToneMapping,
      srgb: true
    }, cutout)
    // 合成器的缓冲只装镜头 pass 画好的显示用颜色（给抗锯齿读）：8 位。
    this.workTarget = new THREE.WebGLRenderTarget(Math.max(1, size.x), Math.max(1, size.y), { type: THREE.UnsignedByteType, depthBuffer: false })
    // SMAA 档降级为 FXAA（vendor three 未含 examples 的 SMAA；超采样档不受影响）。
    this.fxaa = fxaaMaterial()
    this._quad = new FullScreenQuad()
    this.bloomAllowed = true
    this.streaksAllowed = true
    this.bloomStrength = 0.5
    this.streakStrength = 0.55
    this.setQuality(quality)
  }

  Object.defineProperty(MachiPost.prototype, 'sceneTarget', {
    /** 场景画进的那张 HDR 目标。 */
    get: function () { return this.scene.target }
  })

  /** 跟着画布改尺寸（在 renderer.setSize 之后调）。 */
  MachiPost.prototype.setSize = function () {
    var size = this._renderer.getDrawingBufferSize(new THREE.Vector2())
    var width = Math.max(1, Math.round(size.x))
    var height = Math.max(1, Math.round(size.y))
    this.workTarget.setSize(width, height)
    this.scene.target.setSize(width, height)
    this.scene.lit.setSize(width, height)
    this.atmosphere.setSize(width, height)
    this.bloom.setSize(width, height)
    this.streaks.setSize(width, height)
    this.lens.setSize(width, height)
    this.fxaa.uniforms.resolution.value.set(width, height)
  }

  /** 换画质：MSAA 采样数变了就换一张场景目标。 */
  MachiPost.prototype.setQuality = function (quality) {
    var current = this.scene.target
    if (current.samples !== quality.samples) {
      var next = createSceneTarget(current.width, current.height, quality.samples)
      if (current.depthTexture) current.depthTexture.dispose()
      current.dispose()
      this.scene.target = next
    }
    this.atmosphere.material.uniforms.uInkScale.value = quality.inkScale
    this.bloomAllowed = quality.bloom
    this.streaksAllowed = quality.streaks
    this.lens.dofEnabled = quality.dof
    this._aaEnabled = quality.postAA === 'fxaa' || quality.postAA === 'smaa'
    this._applyGlow()
  }

  /** 光晕的强度随环境走：夜里 bloom 与横向光条明显，白天几乎没有（为 0 时整道 pass 跳过）。 */
  MachiPost.prototype.setGlow = function (bloom, streaks) {
    if (bloom === this.bloomStrength && streaks === this.streakStrength) return
    this.bloomStrength = bloom
    this.streakStrength = streaks
    this._applyGlow()
  }

  MachiPost.prototype._applyGlow = function () {
    this.bloom.strength = this.bloomStrength
    this.bloom.enabled = this.bloomAllowed && this.bloomStrength > 0.005
    this.streaks.enabled = this.streaksAllowed && this.streakStrength > 0.005
    // 没画的那项取黑贴图：镜头 pass 照样加，加的是 0。
    this.glow.tBloom.value = this.bloom.enabled ? this.bloom.texture : this.black
    this.glow.tStreak.value = this.streaks.enabled ? this.streaks.texture : this.black
    this.glow.uStreakStrength.value = this.streakStrength
  }

  /**
   * 画一帧。lens: { focus, focusBand, focusFalloff, coc, tilt, aberration, vignette, grain, fade? }（stars 由外面并入）。
   * atmosphere: { time, mistColor, mistAmount, cloudColor, cloudAmount, stars, haze, lightning, glowA, glowColorA, glowB, glowColorB, wind }。
   */
  MachiPost.prototype.render = function (pixelWorldSize, centerDistance, atmosphere, lens) {
    var camera = this._camera
    var range = camera.far - camera.near
    var uniforms = this.atmosphere.material.uniforms
    uniforms.uDepthRange.value = range
    uniforms.uThreshold.value = Math.max(0.004, pixelWorldSize * uniforms.uInkScale.value * 0.7)
    uniforms.uProjInv.value.copy(camera.projectionMatrixInverse)
    uniforms.uCamWorld.value.copy(camera.matrixWorld)
    uniforms.uTime.value = atmosphere.time
    uniforms.uMistColor.value.copy(atmosphere.mistColor)
    uniforms.uMistAmount.value = atmosphere.mistAmount
    uniforms.uCloudColor.value.copy(atmosphere.cloudColor)
    uniforms.uCloudAmount.value = atmosphere.cloudAmount
    uniforms.uHaze.value = atmosphere.haze
    uniforms.uHazeRange.value.set(centerDistance - camera.near - 8, centerDistance - camera.near + 14)
    uniforms.uLightning.value = atmosphere.lightning
    uniforms.uGlowA.value.copy(atmosphere.glowA)
    uniforms.uGlowColorA.value.copy(atmosphere.glowColorA)
    uniforms.uGlowB.value.copy(atmosphere.glowB)
    uniforms.uGlowColorB.value.copy(atmosphere.glowColorB)
    uniforms.uWind.value.copy(atmosphere.wind)
    this.lens.configure(Object.assign({}, lens, { focus: lens.focus - camera.near, stars: atmosphere.stars }), range, atmosphere.time)
    var renderer = this._renderer
    renderer.setRenderTarget(this.scene.target)
    renderer.clear()
    renderer.render(this._sceneGraph, camera)
    // 氛围 → bloom → 光条 → 镜头（色调映射后的显示颜色）→ 抗锯齿或上屏。
    this.atmosphere.render(renderer)
    if (this.bloom.enabled) this.bloom.render(renderer)
    if (this.streaks.enabled) this.streaks.render(renderer)
    if (this._aaEnabled) {
      this.lens.render(renderer, this.workTarget)
      this.fxaa.uniforms.tDiffuse.value = this.workTarget.texture
      this._quad.material = this.fxaa
      renderer.setRenderTarget(null)
      this._quad.render(renderer)
    } else {
      this.lens.render(renderer, null)
    }
  }

  MachiPost.prototype.dispose = function () {
    this.atmosphere.dispose()
    this.bloom.dispose()
    this.streaks.dispose()
    this.lens.dispose()
    this.black.dispose()
    this.fxaa.dispose()
    this._quad.dispose()
    this.workTarget.dispose()
    if (this.scene.target.depthTexture) this.scene.target.depthTexture.dispose()
    this.scene.target.dispose()
    this.scene.lit.dispose()
  }

  window.FoliaMachiPost = {
    MachiPost: MachiPost,
    MachiAtmospherePass: MachiAtmospherePass,
    MachiBloomPass: MachiBloomPass,
    MachiStreakPass: MachiStreakPass,
    MachiLensPass: MachiLensPass,
    createGlowUniforms: createGlowUniforms,
    halfFloatTarget: halfFloatTarget,
    createSceneTarget: createSceneTarget,
    resolveMachiBokehLevel: resolveMachiBokehLevel
  }
})()
