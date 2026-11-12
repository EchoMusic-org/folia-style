// LED 点阵跑马灯（移植自 engine/ledStrip.ts，便利店店招上的一条、出租车顶灯）：
// 字条先画进一长条黑底白字的 canvas，着色器按点阵采样、着 LED 色、横向滚动。
// 字条只在内容变了时重画，每帧只推滚动位置。
(function () {
  'use strict'

  var THREE = window.THREE
  var Raster = window.FoliaMachiSignRaster

  var TEXTURE = { width: 4096, height: 96 }

  var VERTEX = '\nvarying vec2 vUv;\nvoid main() {\n    vUv = uv;\n    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);\n}\n'

  var FRAGMENT = '\nuniform sampler2D uMap;\nuniform vec3 uLed;\nuniform float uScroll;\nuniform float uUsed;\nuniform float uWindow;\nuniform float uDots;\nuniform float uAspect;\nuniform float uBright;\nvarying vec2 vUv;\n' +
    'void main() {\n' +
    '    vec2 grid = vec2(floor(uDots * uAspect), uDots);\n' +
    '    vec2 cell = floor(vUv * grid);\n' +
    '    vec2 f = fract(vUv * grid) - 0.5;\n' +
    '    vec2 sampleUv = (cell + 0.5) / grid;\n' +
    '    float u = fract(uScroll + sampleUv.x * uWindow) * uUsed;\n' +
    '    float a = texture2D(uMap, vec2(u, sampleUv.y)).r;\n' +
    '    float dotMask = 1.0 - smoothstep(0.28, 0.42, length(f));\n' +
    '    vec3 off = vec3(0.025, 0.022, 0.03);\n' +
    '    vec3 color = mix(off, mix(uLed * 0.08, uLed * 2.2, a) * uBright, dotMask);\n' +
    '    gl_FragColor = vec4(color, 1.0);\n' +
    '    #include <tonemapping_fragment>\n' +
    '    #include <colorspace_fragment>\n' +
    '}\n'

  function MachiLedStrip(materials, blend, width, height, dots, colorKey) {
    dots = dots === undefined ? 18 : dots
    colorKey = colorKey === undefined ? 'led' : colorKey
    this.blend = blend
    this.width = width
    this.height = height
    this._colorKey = colorKey
    this.canvas = Raster.createCanvas(TEXTURE.width, TEXTURE.height)
    this.texture = new THREE.CanvasTexture(this.canvas)
    this.texture.colorSpace = THREE.NoColorSpace
    this.texture.wrapS = THREE.ClampToEdgeWrapping
    this.geometries = []
    this._text = ''
    this._scroll = 0
    var self = this
    this.material = materials.track(new THREE.ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      uniforms: {
        uMap: { value: this.texture },
        uLed: { value: new THREE.Color() },
        uScroll: { value: 0 },
        uUsed: { value: 1 },
        uWindow: { value: 0.3 },
        uDots: { value: dots },
        uAspect: { value: width / height },
        uBright: { value: 1 }
      }
    }))
    this.material.name = 'machi:led'
    this._dots = dots
    this._aspect = width / height
    void self
  }

  /** 一块灯条面（平面网格）。 */
  MachiLedStrip.prototype.createFace = function (position, rotationY, name) {
    var geometry = new THREE.PlaneGeometry(this.width, this.height)
    this.geometries.push(geometry)
    var face = new THREE.Mesh(geometry, this.material)
    face.name = name
    face.position.copy(position)
    face.rotation.y = rotationY
    return face
  }

  /** 换字：内容一样就不重画。 */
  MachiLedStrip.prototype.setText = function (text, font) {
    if (text === this._text) return
    this._text = text
    var used = Raster.paintMachiLedStrip(this.canvas, font, text)
    this.texture.needsUpdate = true
    var uniforms = this.material.uniforms
    uniforms.uUsed.value = used / TEXTURE.width
    // 一个点对应字条的 height / dots 像素：可见窗口宽度占循环长度的比例。
    uniforms.uWindow.value = Math.min(4, (Math.floor(this._dots * this._aspect) * (TEXTURE.height / this._dots)) / Math.max(1, used))
  }

  /** 内容作废（换主题、换字体）：下次 setText 一定重画。 */
  MachiLedStrip.prototype.invalidate = function () { this._text = '' }

  Object.defineProperty(MachiLedStrip.prototype, 'hasText', {
    get: function () { return this._text !== '' }
  })

  /** frame: { delta, staticMode, speed(副歌时快一点), audio } */
  MachiLedStrip.prototype.update = function (frame) {
    var speed = (frame.staticMode ? 0 : 70) * frame.speed
    var used = this.material.uniforms.uUsed.value * TEXTURE.width
    this._scroll = (this._scroll + (frame.delta * speed) / Math.max(1, used)) % 1
    this.material.uniforms.uScroll.value = this._scroll
    this.material.uniforms.uLed.value.copy(this.blend.get(this._colorKey))
    this.material.uniforms.uBright.value = 0.9 + 0.2 * frame.audio
  }

  MachiLedStrip.prototype.dispose = function () {
    this.texture.dispose()
    this.geometries.forEach(function (geometry) { geometry.dispose() })
  }

  window.FoliaMachiLedStrip = MachiLedStrip
})()
