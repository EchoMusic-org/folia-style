// 町景着色器注入（移植自 engine/snow.ts + engine/sheen.ts）：
// 积雪（朝上的面按 积雪量×朝上程度×噪声 混成雪色，屋顶下不积雪）与高光（每盏灯的光照里加一块高光，
// 亮度跟材质光泽和湿度走）。两者共用一组 uniform（uMachiWet 等），都必须在 onBeforeCompile 里按
// 先积雪后高光的顺序注入。
(function () {
  'use strict'

  var THREE = window.THREE

  /** 最多几块屋顶（与天气的屋顶一致）。 */
  var MACHI_SNOW_MAX_ROOFS = 4

  function createMachiSnowUniforms() {
    return {
      uMachiSnow: { value: 0 },
      uMachiSnowColor: { value: new THREE.Color(0xf2f5fa) },
      uMachiViewUp: { value: new THREE.Vector3(0, 1, 0) },
      uMachiRoofs: { value: Array.from({ length: MACHI_SNOW_MAX_ROOFS }, function () { return new THREE.Vector4() }) },
      uMachiRoofY: { value: Array.from({ length: MACHI_SNOW_MAX_ROOFS }, function () { return -100 }) },
      /** 路面湿度 0..1（高光用）；与积雪同一组 uniform，所有卡通材质共用。 */
      uMachiWet: { value: 0 }
    }
  }

  /** 换场景：屋顶范围（与天气布局同一份）。 */
  function setMachiSnowRoofs(uniforms, roofs) {
    for (var index = 0; index < MACHI_SNOW_MAX_ROOFS; index += 1) {
      var roof = roofs[index]
      uniforms.uMachiRoofs.value[index].set(roof ? roof.x0 : 0, roof ? roof.z0 : 0, roof ? roof.x1 : 0, roof ? roof.z1 : 0)
      uniforms.uMachiRoofY.value[index] = roof ? roof.y : -100
    }
  }

  var SNOW_VERTEX_PARS = '\nvarying vec3 vMachiWorld;\n'
  var SNOW_VERTEX = '\n{\n    vec4 machiLocal = vec4(transformed, 1.0);\n    #ifdef USE_INSTANCING\n        machiLocal = instanceMatrix * machiLocal;\n    #endif\n    vMachiWorld = (modelMatrix * machiLocal).xyz;\n}\n'
  var SNOW_FRAGMENT_PARS = '\nuniform float uMachiSnow;\nuniform vec3 uMachiSnowColor;\nuniform vec3 uMachiViewUp;\nuniform vec4 uMachiRoofs[' + MACHI_SNOW_MAX_ROOFS + '];\nuniform float uMachiRoofY[' + MACHI_SNOW_MAX_ROOFS + '];\nvarying vec3 vMachiWorld;\n' +
    'float machiSnowHash(vec2 p) { return fract(sin(dot(p, vec2(41.7, 289.3))) * 43758.5453); }\n' +
    'float machiSnowNoise(vec2 p) {\n    vec2 i = floor(p);\n    vec2 f = fract(p);\n    vec2 u = f * f * (3.0 - 2.0 * f);\n' +
    '    return mix(mix(machiSnowHash(i), machiSnowHash(i + vec2(1.0, 0.0)), u.x), mix(machiSnowHash(i + vec2(0.0, 1.0)), machiSnowHash(i + vec2(1.0, 1.0)), u.x), u.y);\n}\n' +
    'float machiSheltered(vec3 p) {\n    for (int i = 0; i < ' + MACHI_SNOW_MAX_ROOFS + '; i++) {\n        vec4 r = uMachiRoofs[i];\n' +
    '        if (p.x > r.x && p.x < r.z && p.z > r.y && p.z < r.w && p.y < uMachiRoofY[i] - 0.05) return 1.0;\n    }\n    return 0.0;\n}\n'
  var SNOW_FRAGMENT = '\nif (uMachiSnow > 0.001) {\n' +
    '    float machiUp = dot(normalize(normal), uMachiViewUp);\n' +
    '    float machiNoise = machiSnowNoise(vMachiWorld.xz * 2.6) * 0.65 + machiSnowNoise(vMachiWorld.xz * 7.1) * 0.35;\n' +
    '    float machiCover = smoothstep(0.5, 0.85, machiUp) * smoothstep(1.0 - uMachiSnow * 0.9, 1.16 - uMachiSnow * 0.9, machiNoise + 0.25);\n' +
    '    machiCover *= 1.0 - machiSheltered(vMachiWorld);\n' +
    '    diffuseColor.rgb = mix(diffuseColor.rgb, uMachiSnowColor, machiCover * min(1.0, uMachiSnow * 1.4));\n}\n'

  /** 把积雪注入一个卡通材质的着色器（在 onBeforeCompile 里调）。 */
  function injectMachiSnow(shader, uniforms) {
    Object.assign(shader.uniforms, uniforms)
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\n' + SNOW_VERTEX_PARS)
      .replace('#include <project_vertex>', '#include <project_vertex>\n' + SNOW_VERTEX)
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + SNOW_FRAGMENT_PARS)
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n' + SNOW_FRAGMENT)
  }

  // ===== 高光（sheen） =====
  /** 光泽：干的时候、湿透时。 */
  var MACHI_GLOSS = {
    matte: [0, 0.16],      // 墙、木头、布：湿了才有一点
    paint: [0.3, 0.65],    // 车漆、贩卖机、点唱机的烤漆
    glass: [0.45, 0.8],
    chrome: [0.5, 0.85],
    metal: [0.16, 0.42],
    ground: [0.03, 0.85]   // 路面、白线、屋面：干的时候几乎没有，湿了最亮
  }

  var PAINT_KEYS = /^(car|taxiBody|truckCab|truckBox|vendingBody|pumpBody|fridgeBody|jukebox|bike|scooter|stool)/
  var GLASS_KEYS = /(glass|Glass|windowDark)/
  var CHROME_KEYS = /^(chrome|mirrorPole)/
  var METAL_KEYS = /^(metal|darkMetal|pole|motelPole|antenna|tank|canopyColumn|acUnit|ac$|pipe|wire|signBox|screenFrame|cage|drain)/
  var GROUND_KEYS = /^(asphalt|roadPaint|curb|roofTar|roof$|canopyTop|slab)/

  /** 按调色板颜色键猜材质的光泽。 */
  function machiGlossFor(key) {
    if (PAINT_KEYS.test(key)) return MACHI_GLOSS.paint
    if (GLASS_KEYS.test(key)) return MACHI_GLOSS.glass
    if (CHROME_KEYS.test(key)) return MACHI_GLOSS.chrome
    if (METAL_KEYS.test(key)) return MACHI_GLOSS.metal
    if (GROUND_KEYS.test(key)) return MACHI_GLOSS.ground
    return MACHI_GLOSS.matte
  }

  var SHEEN_PARS = '\nuniform vec2 uMachiGloss;\nuniform float uMachiWet;\n' +
    // 点光、聚光在前，平行光在后：进平行光那段之前改成 0（对 lights_fragment_begin 的改动）。
    'float machiLocalLight = 1.0;\n' +
    'void RE_Direct_Machi( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in ToonMaterial material, inout ReflectedLight reflectedLight ) {\n' +
    '    RE_Direct_Toon( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );\n' +
    '    float wet = uMachiWet * (1.0 - machiSheltered(vMachiWorld));\n' +
    '    float gloss = mix(uMachiGloss.x, uMachiGloss.y, wet);\n' +
    '    if (gloss > 0.001) {\n' +
    '        vec3 halfDir = normalize(directLight.direction + geometryViewDir);\n' +
    '        float nh = saturate(dot(geometryNormal, halfDir));\n' +
    '        float soft = pow(nh, mix(14.0, 40.0, wet)) * 0.4;\n' +
    '        float core = smoothstep(mix(0.955, 0.975, wet), mix(0.968, 0.985, wet), nh) * machiLocalLight;\n' +
    '        vec3 color = directLight.color / (1.0 + dot(directLight.color, vec3(0.3333)) * 0.8);\n' +
    '        reflectedLight.directDiffuse += color * gloss * (soft * mix(0.5, 1.0, machiLocalLight) + core);\n' +
    '    }\n}\n' +
    '#undef RE_Direct\n#define RE_Direct RE_Direct_Machi\n'

  var DIRECTIONAL = '#if ( NUM_DIR_LIGHTS > 0 ) && defined( RE_Direct )'

  /** 把高光注入一个卡通材质的着色器（必须在 injectMachiSnow 之后调）。 */
  function injectMachiSheen(shader, uniforms, gloss) {
    shader.uniforms.uMachiWet = uniforms.uMachiWet
    shader.uniforms.uMachiGloss = { value: new THREE.Vector2(gloss[0], gloss[1]) }
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <lights_toon_pars_fragment>', '#include <lights_toon_pars_fragment>\n' + SHEEN_PARS)
      .replace('#include <lights_fragment_begin>', THREE.ShaderChunk.lights_fragment_begin.replace(DIRECTIONAL, 'machiLocalLight = 0.0;\n' + DIRECTIONAL))
  }

  window.FoliaMachiShaders = {
    createMachiSnowUniforms: createMachiSnowUniforms,
    setMachiSnowRoofs: setMachiSnowRoofs,
    injectMachiSnow: injectMachiSnow,
    injectMachiSheen: injectMachiSheen,
    machiGlossFor: machiGlossFor,
    MACHI_GLOSS: MACHI_GLOSS,
    MACHI_SNOW_MAX_ROOFS: MACHI_SNOW_MAX_ROOFS
  }
})()
