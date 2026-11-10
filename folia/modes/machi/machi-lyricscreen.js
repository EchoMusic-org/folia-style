// 逐字点亮当前行的 LED 屏（移植自 engine/lyricScreen.ts，便利店屋顶的广告塔、加油站广告车货厢侧面）：
// 一个着色器材质，几块面共用。牌面贴图是一个小池子（当前、下一行预先画好、换行时的旧图），每张上半是未唱的字、
// 下半是唱到的字，着色器按点亮位置在两者之间切。着色器做成户外 LED 屏：像素格与 RGB 子像素条、点亮边界对齐
// 像素格、慢刷新带、面板玻璃反光；换行时信号切换（横带错位、色散、雪花点）。最亮的通道压到 bloom 门槛附近。
// 智能动感模式的大屏闪拍：每下军鼓在屏上的一处慢慢亮起再暗下。
(function () {
  'use strict'

  var THREE = window.THREE
  var BoardLayout = window.FoliaMachiBoardLayout
  var Raster = window.FoliaMachiSignRaster
  var WordColoring = window.FoliaWordColoring

  /** 字面贴图的宽度（每半张）：高度按字面宽高比取。 */
  var TEXTURE_WIDTH = 1280
  /** 换行时屏幕信号切换的总时长（秒）。 */
  var SWITCH_SECONDS = 0.3
  /** 横向的像素格数（竖向按面的宽高比取，格子是方的）。 */
  var CELLS_X = 150
  /** 屏幕最亮的通道压到这里：深色屏的字只轻轻碰到 bloom 门槛，亮色屏的底不进 bloom。 */
  var PEAK = { dark: 0.95, light: 0.8 }
  var POOL_SIZE = 3

  var VERTEX = '\nvarying vec2 vUv;\nvarying vec3 vViewNormal;\n' +
    'void main() {\n    vUv = uv;\n    vViewNormal = normalize(normalMatrix * normal);\n' +
    '    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);\n}\n'

  var FRAGMENT = '\nuniform sampler2D uMap;\nuniform vec3 uBase;\nuniform float uBright;\nuniform float uLitGain;\nuniform float uUnlitGain;\n' +
    'uniform vec3 uRowBottom;\nuniform vec3 uReveal;\nuniform float uSoft;\nuniform vec2 uCells;\nuniform float uTime;\nuniform float uGlitch;\n' +
    'uniform float uPeak;\nuniform vec3 uSheen;\nuniform vec4 uSwellAt;\nuniform vec4 uSwellAmp;\nvarying vec2 vUv;\nvarying vec3 vViewNormal;\n' +
    'float bHash(float n) { return fract(sin(n * 127.1) * 43758.5453); }\n' +
    'void main() {\n' +
    // 换行时的信号切换：几条横带错开、色散变大、亮度掉一下。
    '    vec2 uv = vUv;\n' +
    '    float tear = bHash(floor(vUv.y * 22.0) + floor(uTime * 24.0) * 7.0);\n' +
    '    uv.x += (tear - 0.5) * 0.08 * uGlitch * step(0.62, tear);\n' +
    // 像素格：贴图按原分辨率取（字不糊），点亮的边界对齐到格；格子小到约 2.5 个屏幕像素以下就把网格淡掉。
    '    vec2 cellUv = vUv * uCells;\n' +
    '    vec2 perPixel = fwidth(cellUv);\n' +
    '    float grid = 1.0 - smoothstep(0.3, 0.55, max(perPixel.x, perPixel.y));\n' +
    '    float y = 1.0 - vUv.y;\n' +
    '    float split = 0.0008 + 0.006 * uGlitch;\n' +
    '    vec4 unlit = texture2D(uMap, vec2(uv.x, 0.5 + uv.y * 0.5));\n' +
    '    vec4 litR = texture2D(uMap, vec2(uv.x + split, uv.y * 0.5));\n' +
    '    vec4 litG = texture2D(uMap, vec2(uv.x, uv.y * 0.5));\n' +
    '    vec4 litB = texture2D(uMap, vec2(uv.x - split, uv.y * 0.5));\n' +
    '    float reveal = y < uRowBottom.x ? uReveal.x : (y < uRowBottom.y ? uReveal.y : uReveal.z);\n' +
    '    float snapped = (floor(vUv.x * uCells.x) + 0.5) / uCells.x;\n' +
    '    float on = 1.0 - smoothstep(reveal - uSoft, reveal + uSoft, mix(vUv.x, snapped, grid));\n' +
    // 屏幕的底：边缘一圈略暗（像素老化 / 边框阴影）。
    '    float edge = smoothstep(0.0, 0.03, vUv.x) * smoothstep(1.0, 0.97, vUv.x) * smoothstep(0.0, 0.06, vUv.y) * smoothstep(1.0, 0.94, vUv.y);\n' +
    '    vec3 base = uBase * (0.92 + 0.08 * smoothstep(1.0, 0.0, y)) * (0.8 + 0.2 * edge);\n' +
    '    vec3 color = mix(base, unlit.rgb * uUnlitGain, unlit.a);\n' +
    '    color = mix(color, vec3(litR.r, litG.g, litB.b) * uLitGain, vec3(litR.a, litG.a, litB.a) * on);\n' +
    // 像素之间的黑缝与 RGB 子像素条（按格的可见度淡入淡出），平均亮度不变。
    '    vec2 f = fract(cellUv) - 0.5;\n' +
    '    float gap = smoothstep(0.5, 0.38, abs(f.x)) * smoothstep(0.5, 0.36, abs(f.y));\n' +
    '    vec3 stripe = clamp(1.6 - abs(vec3(fract(cellUv.x) * 3.0) - vec3(0.5, 1.5, 2.5)) * 1.1, 0.0, 1.0) * 2.0;\n' +
    '    vec3 mask = gap * mix(vec3(1.0), stripe, 0.35) / 0.78;\n' +
    '    color *= mix(vec3(1.0), mask, grid * 0.8);\n' +
    // 慢慢往下走的刷新带，切换时的雪花点。
    '    float roll = fract(vUv.y + uTime * 0.07);\n' +
    '    color *= (1.0 + 0.045 * exp(-pow((roll - 0.5) * 9.0, 2.0))) * (1.0 - 0.3 * uGlitch);\n' +
    '    color += (bHash(dot(floor(cellUv), vec2(1.0, 157.0)) + floor(uTime * 30.0)) - 0.5) * 0.12 * uGlitch;\n' +
    '    color = max(color * uBright, 0.0);\n' +
    // 大屏闪拍：几处宽的亮斑（整块也带一点），叠起来按 1 - e^-x 收住；字和底色一起提亮。
    '    vec4 swellDx = vec4(vUv.x) - uSwellAt;\n' +
    '    float swell = 1.0 - exp(-dot(uSwellAmp, 0.2 + 0.8 * exp(-swellDx * swellDx * 10.0)));\n' +
    '    color = color * (1.0 + 0.85 * swell) + uBase * 0.5 * swell;\n' +
    // 最亮的通道压到 uPeak（保色相）：字清楚，不被 bloom 晕开。
    '    float peak = max(max(color.r, color.g), color.b);\n' +
    '    color *= min(1.0, (uPeak + 0.55 * swell) / max(peak, 1e-4));\n' +
    // 面板玻璃：一点天光反射，侧着看更明显，再加一道斜的柔光。
    '    float fresnel = pow(1.0 - clamp(vViewNormal.z, 0.0, 1.0), 3.0);\n' +
    '    float glare = smoothstep(0.22, 0.0, abs(vUv.x * 0.7 + vUv.y * 0.9 - 1.05));\n' +
    '    color += uSheen * (0.035 + 0.22 * fresnel + 0.05 * glare);\n' +
    '    gl_FragColor = vec4(color, 1.0);\n' +
    '    #include <tonemapping_fragment>\n' +
    '    #include <colorspace_fragment>\n' +
    '}\n'

  /**
   * width / height 是屏幕面的尺寸（米）。constructor(materials, blend, width, height)
   */
  function MachiLyricScreen(materials, blend, width, height) {
    this._blend = blend
    this.width = width
    this.height = height
    var half = Math.round(TEXTURE_WIDTH * (height / width))
    this.box = { width: TEXTURE_WIDTH, height: half, paddingX: 0.05, referencePx: Raster.MACHI_REFERENCE_PX }
    this.pool = []
    for (var i = 0; i < POOL_SIZE; i += 1) {
      var canvas = Raster.createCanvas(TEXTURE_WIDTH, half * 2)
      var texture = new THREE.CanvasTexture(canvas)
      texture.colorSpace = THREE.SRGBColorSpace
      texture.anisotropy = 8
      this.pool.push({ canvas: canvas, texture: texture, key: '', layout: null, usedAt: 0 })
    }
    this._slot = null
    this._pendingSlot = null
    this._switchElapsed = SWITCH_SECONDS
    this._target = null
    this._content = null
    this._lines = []
    this.chorusGlow = 0
    this.geometries = []
    this.material = materials.track(new THREE.ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      uniforms: {
        uMap: { value: this.pool[0].texture },
        uBase: { value: new THREE.Color() },
        uBright: { value: 1 },
        uLitGain: { value: 1.25 },
        uUnlitGain: { value: 0.9 },
        uRowBottom: { value: new THREE.Vector3(1, 1, 1) },
        uReveal: { value: new THREE.Vector3(0, 0, 0) },
        uSoft: { value: 0.004 },
        uCells: { value: new THREE.Vector2(CELLS_X, Math.round(CELLS_X * height / width)) },
        uTime: { value: 0 },
        uGlitch: { value: 0 },
        uPeak: { value: PEAK.dark },
        uSheen: { value: new THREE.Color() },
        uSwellAt: { value: new THREE.Vector4(0.5, 0.5, 0.5, 0.5) },
        uSwellAmp: { value: new THREE.Vector4() }
      }
    }))
    this.material.name = 'machi:lyricScreen'
  }

  /** 一块屏幕面（平面网格），摆在 position、绕 y 转 rotationY。 */
  MachiLyricScreen.prototype.createFace = function (position, rotationY, name) {
    var geometry = new THREE.PlaneGeometry(this.width, this.height)
    this.geometries.push(geometry)
    var face = new THREE.Mesh(geometry, this.material)
    face.name = name
    face.position.copy(position)
    face.rotation.y = rotationY
    return face
  }

  /** 换歌 / 换主题：牌面按新颜色、字体重画。content: { palette, font, measure, matchers, cardTitle, cardSubtitle } */
  MachiLyricScreen.prototype.setContent = function (content) {
    this._content = content
    this.pool.forEach(function (slot) { slot.key = '' })
    var target = this._target
    this._target = null
    if (target) this.show(target, this._lines, true)
  }

  MachiLyricScreen.prototype._slotKey = function (target, showText) {
    return target.kind === 'line' && showText ? 'line:' + target.index : 'card'
  }

  /** 把 target 画进一个空闲槽（或命中已画好的槽）。 */
  MachiLyricScreen.prototype._prepare = function (target, lines, showText) {
    var content = this._content
    if (!content) return null
    var key = this._slotKey(target, showText)
    for (var i = 0; i < this.pool.length; i += 1) {
      if (this.pool[i].key === key) {
        this.pool[i].usedAt = performance.now()
        return this.pool[i]
      }
    }
    var self = this
    var candidates = this.pool.filter(function (candidate) {
      return candidate !== self._slot && candidate !== self._pendingSlot
    })
    candidates.sort(function (a, b) { return a.usedAt - b.usedAt })
    var slot = candidates[0]
    if (!slot) return null
    var line = target.kind === 'line' ? lines[target.index] : undefined
    var card = !line || !showText
    var layout = card
      ? BoardLayout.layoutMachiBoardCard(content.cardTitle, content.cardSubtitle, this.box, content.measure)
      : BoardLayout.layoutMachiBoardLine(line, this.box, content.measure)
    var keywordRanges = card ? [] : WordColoring.buildWordColorRangesFromMatchers(line.fullText, content.matchers)
    Raster.paintMachiBoard(slot.canvas, { layout: layout, font: content.font, unlit: content.palette.boardUnlit, lit: content.palette.boardLit, keywordRanges: keywordRanges, card: card })
    slot.texture.needsUpdate = true
    slot.key = key
    slot.layout = layout
    slot.usedAt = performance.now()
    return slot
  }

  /** 换牌面：画好新的，信号切换过去（静态模式、暂停时直接换）。 */
  MachiLyricScreen.prototype.show = function (target, lines, immediate, showText) {
    showText = showText === undefined ? true : showText
    this._lines = lines
    var sameKey = this._target && this._slotKey(this._target, showText) === this._slotKey(target, showText)
    this._target = target
    var slot = this._prepare(target, lines, showText)
    if (!slot) return
    if (sameKey && this._slot === slot) return
    if (immediate || !this._slot) {
      this._apply(slot)
      this._switchElapsed = SWITCH_SECONDS
      this._pendingSlot = null
    } else {
      this._pendingSlot = slot
      this._switchElapsed = 0
    }
  }

  /** 空闲时提前画好下一行。 */
  MachiLyricScreen.prototype.preheat = function (target, lines, showText) {
    var key = this._slotKey(target, showText)
    for (var i = 0; i < this.pool.length; i += 1) {
      if (this.pool[i].key === key) return
    }
    this._prepare(target, lines, showText)
  }

  MachiLyricScreen.prototype._apply = function (slot) {
    this._slot = slot
    this.material.uniforms.uMap.value = slot.texture
    var layout = slot.layout
    var bottoms = [1, 1, 1]
    if (layout) {
      layout.rows.forEach(function (row, index) {
        if (index < 3) bottoms[index] = index === layout.rows.length - 1 ? 1 : (row.bottom / layout.height)
      })
    }
    this.material.uniforms.uRowBottom.value.set(bottoms[0], bottoms[1], bottoms[2])
  }

  /** 每帧：点亮位置、换行的信号切换、亮度（副歌、音频）。frame: { songTime, ambientTime, delta, staticMode, chorus, audio, beat } */
  MachiLyricScreen.prototype.update = function (frame) {
    var content = this._content
    if (!content) return
    var palette = content.palette
    // 换行：信号切换——错位、色散、雪花在中间最强，贴图在峰值处换掉。
    var glitch = 0
    if (this._switchElapsed < SWITCH_SECONDS) {
      this._switchElapsed += frame.staticMode ? SWITCH_SECONDS : Math.max(frame.delta, 1 / 120)
      var t = Math.min(1, this._switchElapsed / SWITCH_SECONDS)
      if (t >= 0.45 && this._pendingSlot) {
        this._apply(this._pendingSlot)
        this._pendingSlot = null
      }
      glitch = t >= 1 ? 0 : Math.pow(Math.sin(Math.PI * t), 0.7)
    }
    this.chorusGlow += (frame.chorus - this.chorusGlow) * (1 - Math.exp(-frame.delta * 3))
    var layout = this._slot ? this._slot.layout : null
    var reveal = layout ? BoardLayout.resolveMachiBoardReveal(layout, frame.songTime) : []
    var uniforms = this.material.uniforms
    uniforms.uReveal.value.set(
      (reveal[0] !== undefined ? reveal[0] : 0) / this.box.width,
      (reveal[1] !== undefined ? reveal[1] : 0) / this.box.width,
      (reveal[2] !== undefined ? reveal[2] : 0) / this.box.width
    )
    uniforms.uBase.value.copy(this._blend.get('boardBase')).multiplyScalar(palette.boardIsLight ? 0.98 : 1.0)
    uniforms.uLitGain.value = palette.boardIsLight ? 1.0 : 1.25 + 0.2 * this.chorusGlow
    uniforms.uUnlitGain.value = palette.boardIsLight ? 1.0 : 0.9
    uniforms.uBright.value = 1 + 0.05 * frame.audio + 0.06 * this.chorusGlow
    uniforms.uPeak.value = palette.boardIsLight ? PEAK.light : PEAK.dark
    uniforms.uGlitch.value = glitch
    uniforms.uTime.value = frame.ambientTime
    uniforms.uSheen.value.copy(this._blend.get('moon')).multiplyScalar(0.35)
    uniforms.uSwellAt.value.fromArray(frame.beat.swellAt)
    uniforms.uSwellAmp.value.fromArray(frame.beat.swellAmp)
  }

  Object.defineProperty(MachiLyricScreen.prototype, 'busy', {
    /** 屏幕上有切换动画：暂停时也要继续出帧。 */
    get: function () { return this._switchElapsed < SWITCH_SECONDS }
  })

  Object.defineProperty(MachiLyricScreen.prototype, 'chorus', {
    /** 副歌的平滑权重（招牌跟着它加亮、不闪）。 */
    get: function () { return this.chorusGlow }
  })

  MachiLyricScreen.prototype.dispose = function () {
    this.pool.forEach(function (slot) { slot.texture.dispose() })
    this.geometries.forEach(function (geometry) { geometry.dispose() })
  }

  window.FoliaMachiLyricScreen = MachiLyricScreen
})()
