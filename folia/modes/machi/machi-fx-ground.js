// 湿路面（移植自 engine/fx/ground.ts）：沥青和人行道顶面换成注入了水洼的卡通材质。水洼位置是按 seed 平移的
// 两层值噪声；水洼里压暗底色、映出天空色与倒影贴图（按雨点涟漪的法线扰动），水洼外只有一层弱的湿润反光。
// 涟漪是格子里随机生灭的圆环，只用氛围时钟，暂停时定格。所有湿面共用一组 uniform。
// 智能动感的鼓点涟漪：最多四圈从歌词屏脚下荡开的环，弯一弯倒影、亮一道环，只在湿的地面上有。
(function () {
  'use strict'

  var THREE = window.THREE
  var Shaders = window.FoliaMachiShaders
  var BeatFx = window.FoliaMachiBeatFx

  var RIPPLE = BeatFx.MACHI_BEAT.ripple

  var PARS = '\nuniform float uTime;\nuniform sampler2D uReflection;\nuniform mat4 uReflectMatrix;\nuniform vec2 uPuddleOffset;\n' +
    'uniform float uPuddleAmount;\nuniform float uRain;\nuniform float uWet;\nuniform vec3 uSky;\nuniform float uReflectStrength;\n' +
    'uniform float uPuddleBias;\nuniform vec2 uKickCenter;\nuniform vec4 uKickAge;\nuniform vec4 uKickAmp;\nvarying vec3 vKWorld;\n' +
    'float kHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }\n' +
    'float kNoise(vec2 p) {\n    vec2 i = floor(p);\n    vec2 f = fract(p);\n    vec2 u = f * f * (3.0 - 2.0 * f);\n' +
    '    return mix(mix(kHash(i), kHash(i + vec2(1.0, 0.0)), u.x), mix(kHash(i + vec2(0.0, 1.0)), kHash(i + vec2(1.0, 1.0)), u.x), u.y);\n}\n' +
    'float kPuddle(vec2 p) {\n    float n = kNoise(p * 0.62 + uPuddleOffset) * 0.62 + kNoise(p * 1.7 - uPuddleOffset * 1.3) * 0.38;\n' +
    '    float threshold = mix(0.78, 0.46, uPuddleAmount) + uPuddleBias;\n    return smoothstep(threshold, threshold + 0.05, n);\n}\n' +
    // 一层涟漪：每格一个随机中心的扩散圆环，返回 xz 方向的法线扰动与环的亮度。
    'vec3 kRippleLayer(vec2 p, float scale, float t, float salt) {\n' +
    '    vec2 q = p * scale;\n    vec2 cell = floor(q);\n' +
    '    vec2 center = cell + 0.22 + 0.56 * vec2(kHash(cell + salt), kHash(cell + salt + 7.13));\n' +
    '    float period = 0.75 + 0.9 * kHash(cell + salt + 3.31);\n' +
    '    float phase = fract(t / period + kHash(cell + salt + 11.7));\n' +
    '    float alive = step(kHash(cell + salt + floor(t / period + kHash(cell + salt + 11.7)) * 0.37), uRain);\n' +
    '    vec2 d = q - center;\n    float dist = length(d);\n    float radius = phase * 0.46;\n' +
    '    float band = 1.0 - smoothstep(0.0, 0.07, abs(dist - radius));\n' +
    '    float fade = (1.0 - phase) * alive;\n' +
    '    float wave = sin((dist - radius) * 48.0) * band * fade;\n' +
    '    return vec3(normalize(d + 1e-4) * wave, band * fade);\n}\n' +
    // 鼓点涟漪的一圈：从 uKickCenter 荡开、越走越宽越淡的环（按剩余寿命的平方淡）。空的一圈年龄是 -1。
    'vec3 kKick(vec2 p, float age, float amp) {\n' +
    '    float a = max(age, 0.0);\n    vec2 d = p - uKickCenter;\n    float dist = length(d);\n' +
    '    float radius = a * ' + RIPPLE.speed.toFixed(2) + ';\n' +
    '    float band = 1.0 - smoothstep(0.0, 0.18 + 0.3 * a, abs(dist - radius));\n' +
    '    float left = clamp(1.0 - a / ' + RIPPLE.life.toFixed(2) + ', 0.0, 1.0);\n' +
    '    float fade = amp * left * left * step(0.0, age);\n' +
    '    float wave = sin((dist - radius) * 7.0) * band * fade;\n' +
    '    return vec3(normalize(d + 1e-4) * wave, band * fade);\n}\n' +
    // 倒影取样：湿路面不是镜子。灯和字在湿路面上拉成竖着的一道道光，横向只糊一点。
    'vec3 kReflect(vec2 uv, float rough) {\n' +
    '    float bias = mix(0.6, 1.8, rough);\n' +
    '    float reach = mix(10.0, 26.0, rough) / float(textureSize(uReflection, 0).y);\n' +
    '    vec3 sum = vec3(0.0);\n    float total = 0.0;\n' +
    '    for (int i = -4; i <= 4; i++) {\n' +
    '        float t = float(i) / 4.0;\n        float w = 1.0 - abs(t) * 0.75;\n' +
    '        sum += texture2D(uReflection, uv + vec2(0.0, t * reach), bias).rgb * w;\n        total += w;\n    }\n' +
    // 一盏灯摊成一道光以后不该暗那么多：按 0.6 倍的权重和归一。
    '    return sum / (total * 0.6);\n}\n' +
    // 雨点打在路面上的闪光：约 7cm 一格，格里随机一点，每隔一阵亮一下再暗下去。
    'float kGlint(vec2 p, float t) {\n' +
    '    vec2 q = p * 14.0;\n    vec2 cell = floor(q);\n    float h = kHash(cell + 3.7);\n' +
    '    float period = 0.5 + h * 1.1;\n    float beat = t / period + h * 7.0;\n    float drop = floor(beat);\n' +
    '    vec2 center = cell + 0.2 + 0.6 * vec2(kHash(cell + drop * 0.71), kHash(cell + drop * 1.37 + 9.1));\n' +
    '    float d = length(q - center);\n    float aa = fwidth(d) + 1e-4;\n' +
    '    return (1.0 - smoothstep(0.16 - aa, 0.16 + aa, d)) * (1.0 - fract(beat)) * step(0.45, h);\n}\n'

  var OUTPUT = '\n' +
    // 干且没下雨时整段都乘成 0：直接跳过，路面照常是 outgoingLight。
    'if (uWet > 0.0 || uRain > 0.0) {\n' +
    '    vec2 kp = vKWorld.xz;\n' +
    '    float puddle = kPuddle(kp) * smoothstep(0.15, 0.85, uWet) * (1.0 - min(1.0, uMachiSnow * 1.5));\n' +
    '    vec3 ripple = kRippleLayer(kp, 2.3, uTime, 0.0) + kRippleLayer(kp, 3.9, uTime * 1.13, 19.0) * 0.7;\n' +
    '    vec3 kick = vec3(0.0);\n' +
    '    if (any(greaterThan(uKickAmp, vec4(0.0)))) {\n' +
    '        kick = kKick(kp, uKickAge.x, uKickAmp.x) + kKick(kp, uKickAge.y, uKickAmp.y)\n' +
    '            + kKick(kp, uKickAge.z, uKickAmp.z) + kKick(kp, uKickAge.w, uKickAmp.w);\n' +
    '        kick *= smoothstep(' + RIPPLE.wet[0].toFixed(2) + ', ' + RIPPLE.wet[1].toFixed(2) + ', uWet) * (1.0 - min(1.0, uMachiSnow * 1.5));\n' +
    '    }\n' +
    '    vec4 rc = uReflectMatrix * vec4(vKWorld, 1.0);\n' +
    // 路面不平：一层低频的扰动让倒影的轮廓弯一弯，水洼里弯得少。
    '    vec2 wobble = vec2(kNoise(kp * 2.7 + 3.1), kNoise(kp * 2.7 - 11.4)) - 0.5;\n' +
    '    vec2 ruv = rc.xy / rc.w + ripple.xy * mix(0.004, 0.018, puddle) + wobble * mix(0.012, 0.005, puddle) + kick.xy * mix(0.09, 0.15, puddle);\n' +
    '    vec3 reflection = kReflect(ruv, 1.0 - puddle);\n' +
    // 灯底下才闪：按这一点受的直射光（含高光）亮度。
    '    float lit = dot(reflectedLight.directDiffuse, vec3(0.299, 0.587, 0.114));\n' +
    '    float glint = kGlint(kp, uTime) * uRain * smoothstep(0.03, 0.4, lit) * (1.0 - min(1.0, uMachiSnow * 1.5));\n' +
    '    vec3 wet = outgoingLight * mix(1.0, 0.62, uWet) + reflection * uReflectStrength * 0.7 * uWet;\n' +
    '    vec3 pool = outgoingLight * 0.36 + uSky * 0.16 + reflection * uReflectStrength * 1.35 + ripple.z * uSky * 0.6;\n' +
    '    outgoingLight = mix(wet, pool, puddle) + glint * (vec3(lit) * 3.0 + reflection);\n' +
    '    outgoingLight += kick.z * (reflection * uReflectStrength * 3.6 + uSky * 2.4 + 0.24) * mix(0.6, 1.0, puddle);\n' +
    '}\n'

  /** 倒影的强度（画质里关了倒影时是 0）。 */
  var REFLECT_STRENGTH = 0.75

  /**
   * constructor(materials, blend, snow)
   * uniforms 与 asphalt/concrete 两个卡通材质；uMachiSnow（积雪 uniform 组）由注入共用。
   */
  function MachiGround(materials, blend, snow) {
    this._blend = blend
    this._snow = snow
    this._gradient = materials.gradient
    this.uniforms = {
      uTime: { value: 0 },
      uReflection: { value: null },
      uReflectMatrix: { value: new THREE.Matrix4() },
      uPuddleOffset: { value: new THREE.Vector2() },
      uPuddleAmount: { value: 0.6 },
      uRain: { value: 0.75 },
      uWet: { value: 1 },
      uSky: { value: new THREE.Color() },
      uReflectStrength: { value: REFLECT_STRENGTH },
      uKickCenter: { value: new THREE.Vector2() },
      uKickAge: { value: new THREE.Vector4(-1, -1, -1, -1) },
      uKickAmp: { value: new THREE.Vector4() }
    }
    this.asphalt = materials.track(this._create('asphalt', 0))
    this.concrete = materials.track(this._create('concrete', 0.08))
  }

  MachiGround.prototype._create = function (key, puddleBias) {
    var self = this
    var material = new THREE.MeshToonMaterial({ color: this._blend.get(key), gradientMap: this._gradient })
    material.name = 'machi:wet:' + key
    material.onBeforeCompile = function (shader) {
      Shaders.injectMachiSnow(shader, self._snow)
      Shaders.injectMachiSheen(shader, self._snow, Shaders.MACHI_GLOSS.ground)
      Object.assign(shader.uniforms, self.uniforms, { uPuddleBias: { value: puddleBias } })
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vKWorld;')
        .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvKWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;')
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\n' + PARS)
        .replace('#include <opaque_fragment>', OUTPUT + '\n#include <opaque_fragment>')
    }
    material.customProgramCacheKey = function () { return 'machi-wet-' + puddleBias }
    return material
  }

  /** 鼓点涟漪：圆心与 rings（[年龄, 幅度] × 4）。 */
  MachiGround.prototype.setKicks = function (centerX, centerZ, rings) {
    this.uniforms.uKickCenter.value.set(centerX, centerZ)
    this.uniforms.uKickAge.value.set(rings[0], rings[2], rings[4], rings[6])
    this.uniforms.uKickAmp.value.set(rings[1], rings[3], rings[5], rings[7])
  }

  /** 画质里关了倒影：倒影贴图不再更新，路面也不取它。 */
  MachiGround.prototype.setReflections = function (enabled) {
    this.uniforms.uReflectStrength.value = enabled ? REFLECT_STRENGTH : 0
  }

  MachiGround.prototype.syncColors = function () {
    this.asphalt.color.copy(this._blend.get('asphalt'))
    this.concrete.color.copy(this._blend.get('concrete'))
    this.uniforms.uSky.value.copy(this._blend.get('skyBottom'))
  }

  window.FoliaMachiGround = MachiGround
})()
