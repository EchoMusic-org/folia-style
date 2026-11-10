// 町景材质（移植自 engine/materials.ts）：
// 克制的卡通着色（MeshToonMaterial + 4 阶渐变图），自发光件（招牌、灯头、冰柜内光）用 MeshBasicMaterial
// 输出高于 1 的线性色给 bloom 余量。颜色都从调色板来，换主题时由 MachiColorBlend 插值过去再写回材质。
// 引擎一份 MachiMaterials（地面、天气、后处理用），每个场景建自己的一份，共用一个 ColorBlend。
(function () {
  'use strict'

  var THREE = window.THREE
  var Shaders = window.FoliaMachiShaders

  /** 换主题时颜色的插值：每个键一对当前/目标色，按指数阻尼追过去。 */
  function MachiColorBlend(palette) {
    this.current = new Map()
    this.target = new Map()
    this.derived = new Map()
    this.settled = true
    var flat = window.FoliaMachiPalette.flattenMachiPalette(palette)
    var self = this
    Object.keys(flat).forEach(function (key) {
      self.current.set(key, new THREE.Color(flat[key]))
      self.target.set(key, new THREE.Color(flat[key]))
    })
  }

  /** 新目标（换主题、换歌、换场景）。新出现的键直接取目标色，不从别处插值过来。 */
  MachiColorBlend.prototype.setTarget = function (palette, immediate) {
    var flat = window.FoliaMachiPalette.flattenMachiPalette(palette)
    var self = this
    Object.keys(flat).forEach(function (key) {
      var target = self.target.get(key)
      if (!target) { target = new THREE.Color(); self.target.set(key, target) }
      target.set(flat[key])
      if (immediate || !self.current.has(key)) self.current.set(key, target.clone())
    })
    this.settled = Boolean(immediate)
  }

  /** 推进插值；返回这一步有没有动过颜色。 */
  MachiColorBlend.prototype.step = function (deltaSeconds, rate) {
    rate = rate === undefined ? 2.4 : rate
    if (this.settled) return false
    var k = 1 - Math.exp(-rate * deltaSeconds)
    var moving = false
    var self = this
    this.current.forEach(function (color, key) {
      var target = self.target.get(key)
      color.lerp(target, k)
      if (Math.abs(color.r - target.r) + Math.abs(color.g - target.g) + Math.abs(color.b - target.b) > 0.002) moving = true
      else color.copy(target)
    })
    this.settled = !moving
    return true
  }

  /** 由环境推出来的颜色盖在调色板的同名键上；raw 读调色板本身的值。 */
  MachiColorBlend.prototype.setDerived = function (key, color) {
    var held = this.derived.get(key)
    if (held) held.copy(color)
    else this.derived.set(key, color.clone())
  }

  MachiColorBlend.prototype.raw = function (key) {
    return this.current.get(key) || this.current.get('concrete')
  }

  MachiColorBlend.prototype.get = function (key) {
    return this.derived.get(key) || this.raw(key)
  }

  /** 4 阶的卡通渐变：暗部不压死，亮部一刀切。 */
  function createToonGradient() {
    var data = new Uint8Array([86, 146, 206, 255])
    var texture = new THREE.DataTexture(data, data.length, 1, THREE.RedFormat)
    texture.minFilter = THREE.NearestFilter
    texture.magFilter = THREE.NearestFilter
    texture.generateMipmaps = false
    texture.needsUpdate = true
    return texture
  }

  /**
   * 材质库。prefix 是材质名前缀：场景的材质带场景 id。
   * constructor(blend, snow, prefix='machi')
   */
  function MachiMaterials(blend, snow, prefix) {
    prefix = prefix || 'machi'
    this._blend = blend
    this._snow = snow
    this._prefix = prefix
    this.gradient = createToonGradient()
    this.toons = new Map()
    this.glows = new Map()
    this.glowSpecs = new Map()
    this.glowLevels = new Map()
    this.extra = []
    // 透明落地玻璃：不写深度，透过它能看到（也能描到）里面。
    this.glass = new THREE.MeshToonMaterial({
      color: blend.get('glass'),
      gradientMap: this.gradient,
      transparent: true,
      opacity: 0.2,
      depthWrite: false
    })
    this.glass.name = prefix + ':glass'
    this.snowy(this.glass, Shaders.MACHI_GLOSS.glass)
    // 商品、瓶子、车身这类实例件：白底，颜色走 InstancedMesh 的实例色。
    this.product = this.snowy(new THREE.MeshToonMaterial({ color: 0xffffff, gradientMap: this.gradient }), Shaders.MACHI_GLOSS.metal)
    this.product.name = prefix + ':product'
  }

  /** 给卡通材质注入积雪与高光（外面另建的卡通材质也可以用）。gloss 只是 uniform，不分着色器程序。 */
  MachiMaterials.prototype.snowy = function (material, gloss) {
    var snow = this._snow
    material.onBeforeCompile = function (shader) {
      Shaders.injectMachiSnow(shader, snow)
      Shaders.injectMachiSheen(shader, snow, gloss || Shaders.MACHI_GLOSS.matte)
    }
    material.customProgramCacheKey = function () { return 'machi-snow' }
    return material
  }

  /** 按调色板颜色键上色的卡通材质（'white' 是纯白，不跟主题走）。 */
  MachiMaterials.prototype.toon = function (key) {
    var material = this.toons.get(key)
    if (!material) {
      material = this.snowy(new THREE.MeshToonMaterial({
        color: key === 'white' ? 0xffffff : this._blend.get(key),
        gradientMap: this.gradient
      }), Shaders.machiGlossFor(key))
      material.name = this._prefix + ':' + key
      this.toons.set(key, material)
    }
    return material
  }

  /** 场景登记自己的自发光件规格（建几何之前）。specs: { role: { key, level } } */
  MachiMaterials.prototype.defineGlows = function (specs) {
    var self = this
    Object.keys(specs).forEach(function (role) { self.glowSpecs.set(role, specs[role]) })
  }

  MachiMaterials.prototype.glow = function (role) {
    var material = this.glows.get(role)
    if (!material) {
      if (!this.glowSpecs.has(role)) throw new Error('[Machi] glow role "' + role + '" is not defined')
      material = new THREE.MeshBasicMaterial({ color: 0xffffff })
      material.name = 'machi:glow:' + role
      this.glows.set(role, material)
      this._syncGlow(role, material)
    }
    return material
  }

  /** 自发光件的亮度调制（闪烁、副歌加亮），1 是常态。 */
  MachiMaterials.prototype.setGlowLevel = function (role, level) {
    if (this.glowLevels.get(role) === level) return
    this.glowLevels.set(role, level)
    var material = this.glows.get(role)
    if (material) this._syncGlow(role, material)
  }

  /** 外面另建的材质（招牌、天气）交给这里一起销毁。 */
  MachiMaterials.prototype.track = function (material) {
    this.extra.push(material)
    return material
  }

  MachiMaterials.prototype._syncGlow = function (role, material) {
    var spec = this.glowSpecs.get(role)
    material.color.copy(this._blend.get(spec.key)).multiplyScalar(spec.level * (this.glowLevels.get(role) || 1))
  }

  /** 插值后的颜色写回所有材质。 */
  MachiMaterials.prototype.syncColors = function () {
    var self = this
    this.toons.forEach(function (material, key) {
      if (key !== 'white') material.color.copy(self._blend.get(key))
    })
    this.glass.color.copy(this._blend.get('glass'))
    this.glows.forEach(function (material, role) { self._syncGlow(role, material) })
  }

  MachiMaterials.prototype.dispose = function () {
    this.toons.forEach(function (material) { material.dispose() })
    this.glows.forEach(function (material) { material.dispose() })
    this.glass.dispose()
    this.product.dispose()
    this.extra.forEach(function (material) { material.dispose() })
    this.gradient.dispose()
  }

  window.FoliaMachiMaterials = { MachiColorBlend: MachiColorBlend, MachiMaterials: MachiMaterials }
})()
