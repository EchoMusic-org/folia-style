// 城寨酒吧（kowloon）的招牌画法与屏幕（移植自 folia-major scenes/kowloon/ 的
// kowloonSignPaint.ts + kowloonSigns.ts + hologram.ts，场景拆分文件）：
// 城寨酒吧各块招牌的 Canvas 2D 画法（霓虹招牌、灯箱招牌、酒吧门头）、招牌总装（歌词大屏、LED 跑马灯、
// 全息投影、店招图集）、巷子里的全息投影（自绘 GLSL：扫描线、往上走的亮带、换字时的错位）。
// 挂到 window.FoliaMachiSceneKowloonPaint，由 scene-kowloon.js 合并进 window.FoliaMachiSceneKowloon。
(function () {
  'use strict'

  var THREE = window.THREE
  var Geometry = window.FoliaMachiGeometry
  var Raster = window.FoliaMachiSignRaster
  var SeedHash = window.FoliaSeedHash
  var ColorMath = window.FoliaThemeColorMath
  var PaletteMod = window.FoliaMachiPalette
  var BeatFx = window.FoliaMachiBeatFx
  var Director = window.FoliaMachiDirector
  var WordColoring = window.FoliaWordColoring
  var MachiLyricScreen = window.FoliaMachiLyricScreen
  var MachiLedStrip = window.FoliaMachiLedStrip

  // ===== kowloonSignPaint.ts =====
  // 城寨酒吧各块招牌的 Canvas 2D 画法，都画进同一张图集里的一格：霓虹招牌（深色底、灯管字、一圈灯管边框）、
  // 灯箱招牌（亮色板面、粗字），竖招牌把字一个个竖着排（太长的拉丁字转 90° 横写）；酒吧门头（左边一只鸡尾酒杯，
  // 中间曲名，右边「酒吧」）。

  var CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u
  var NEON_BACKGROUND = '#130f19'

  /** 竖排：中日韩字、或不超过 7 个字母的拉丁字一个个竖着排；其余转 90° 横写。 */
  function resolveKowloonVerticalText(text) {
    var compact = text.replace(/\s+/g, '')
    var glyphs = Array.from(compact)
    if (glyphs.length === 0) return { mode: 'stack', glyphs: [] }
    if (CJK.test(compact) || glyphs.length <= 7) {
      return { mode: 'stack', glyphs: glyphs.length > 8 ? glyphs.slice(0, 7).concat(['…']) : glyphs }
    }
    return { mode: 'rotate', text: text.trim() }
  }

  function roundRect(context, x, y, width, height, radius) {
    context.beginPath()
    context.roundRect(x, y, width, height, radius)
  }

  /** 板面：霓虹是深色底加一圈灯管边，灯箱是亮色板面加一道内边。返回写字用的颜色与写法。 */
  function paintPanel(context, rect, style) {
    var x = rect.x
    var y = rect.y
    var width = rect.width
    var height = rect.height
    var unit = Math.min(width, height)
    if (style.kind === 'neon') {
      context.fillStyle = NEON_BACKGROUND
      context.fillRect(x, y, width, height)
      context.save()
      context.shadowColor = style.border
      context.shadowBlur = unit * 0.05
      context.strokeStyle = style.border
      context.lineWidth = Math.max(2, unit * 0.025)
      var inset = unit * 0.06
      roundRect(context, x + inset, y + inset, width - inset * 2, height - inset * 2, unit * 0.06)
      context.stroke()
      context.restore()
      return
    }
    // 灯箱的板面压暗一点：大块的亮面会被镜头光条拉出长长的横光。
    context.fillStyle = style.background
    context.fillRect(x, y, width, height)
    context.fillStyle = 'rgba(0, 0, 0, 0.16)'
    context.fillRect(x, y, width, height)
    context.strokeStyle = style.ink
    context.globalAlpha = 0.55
    context.lineWidth = Math.max(2, unit * 0.02)
    var inset2 = unit * 0.05
    roundRect(context, x + inset2, y + inset2, width - inset2 * 2, height - inset2 * 2, unit * 0.04)
    context.stroke()
    context.globalAlpha = 1
  }

  /** 写一段字：霓虹是灯管（填色 + 光晕 + 白芯），灯箱是实心粗字。 */
  function writeText(context, text, cx, cy, px, style) {
    if (style.kind === 'neon') {
      context.save()
      context.shadowColor = style.color
      context.shadowBlur = px * 0.25
      context.fillStyle = style.color
      context.fillText(text, cx, cy)
      context.restore()
      Raster.strokeNeonText(context, text, cx, cy, style.color, px * 0.07)
      return
    }
    context.fillStyle = style.ink
    context.fillText(text, cx, cy)
  }

  /** 一块店招（横或竖）。 */
  function paintKowloonSign(context, rect, paint) {
    var x = rect.x
    var y = rect.y
    var width = rect.width
    var height = rect.height
    context.save()
    context.beginPath()
    context.rect(x, y, width, height)
    context.clip()
    paintPanel(context, rect, paint.style)
    context.textAlign = 'center'
    context.textBaseline = 'middle'
    var font = Object.assign({}, paint.font, { weight: 800 })
    var captionHeight = paint.caption ? Math.min(width, height) * 0.22 : 0
    if (paint.vertical) {
      var vertical = resolveKowloonVerticalText(paint.text)
      var top = y + height * 0.07
      var usable = height * 0.86 - captionHeight
      if (vertical.mode === 'stack') {
        var count = Math.max(1, vertical.glyphs.length)
        var step = usable / count
        var px = Math.min(width * 0.7, step * 0.86)
        context.font = Raster.fontSpec(font, px)
        vertical.glyphs.forEach(function (glyph, index) {
          writeText(context, glyph, x + width / 2, top + step * (index + 0.5), px, paint.style)
        })
      } else {
        context.save()
        context.translate(x + width / 2, top + usable / 2)
        context.rotate(Math.PI / 2)
        var rpx = Raster.fitFont(context, font, vertical.text, usable * 0.94, width * 0.62)
        writeText(context, vertical.text, 0, 0, rpx, paint.style)
        context.restore()
      }
      if (paint.caption) {
        var cpx = Raster.fitFont(context, Object.assign({}, paint.font, { weight: 700 }), paint.caption, width * 0.84, captionHeight * 0.7)
        writeText(context, paint.caption, x + width / 2, y + height * 0.93 - captionHeight / 2, cpx, paint.style)
      }
    } else {
      var hpx = Raster.fitFont(context, font, paint.text, width * 0.84, height * 0.66)
      writeText(context, paint.text, x + width / 2, y + height * 0.53, hpx, paint.style)
    }
    context.restore()
  }

  /** 一只鸡尾酒杯（灯管）：倒三角的杯身、杯脚、底座、一颗橄榄。 */
  function drawCocktail(context, cx, cy, size, color) {
    context.save()
    context.shadowColor = color
    context.shadowBlur = size * 0.18
    context.strokeStyle = color
    context.lineWidth = size * 0.07
    context.lineJoin = 'round'
    context.lineCap = 'round'
    var top = cy - size * 0.42
    context.beginPath()
    context.moveTo(cx - size * 0.38, top)
    context.lineTo(cx + size * 0.38, top)
    context.lineTo(cx, cy + size * 0.05)
    context.closePath()
    context.moveTo(cx, cy + size * 0.05)
    context.lineTo(cx, cy + size * 0.38)
    context.moveTo(cx - size * 0.2, cy + size * 0.4)
    context.lineTo(cx + size * 0.2, cy + size * 0.4)
    context.stroke()
    context.beginPath()
    context.arc(cx + size * 0.08, top + size * 0.14, size * 0.07, 0, Math.PI * 2)
    context.stroke()
    context.restore()
  }

  /** 酒吧门头：深色灯箱，左边鸡尾酒杯，中间曲名（灯管字），右边竖着的「酒吧」。 */
  function paintKowloonBarSign(context, rect, paint) {
    var x = rect.x
    var y = rect.y
    var width = rect.width
    var height = rect.height
    context.save()
    context.beginPath()
    context.rect(x, y, width, height)
    context.clip()
    context.fillStyle = NEON_BACKGROUND
    context.fillRect(x, y, width, height)
    drawCocktail(context, x + height * 0.6, y + height * 0.5, height * 0.8, paint.glass)
    var markWidth = height * 0.7
    var markX = x + width - markWidth * 0.75
    context.textAlign = 'center'
    context.textBaseline = 'middle'
    var markPx = height * 0.36
    context.font = Raster.fontSpec(Object.assign({}, paint.font, { weight: 800 }), markPx)
    writeText(context, '酒', markX, y + height * 0.29, markPx, { kind: 'neon', color: paint.mark, border: paint.mark })
    writeText(context, '吧', markX, y + height * 0.71, markPx, { kind: 'neon', color: paint.mark, border: paint.mark })
    var left = x + height * 1.15
    var right = markX - markWidth * 0.55
    var px = Raster.fitFont(context, paint.font, paint.title, right - left, height * 0.6)
    writeText(context, paint.title, (left + right) / 2, y + height * 0.54, px, { kind: 'neon', color: paint.neon, border: paint.neon })
    context.restore()
  }

  // ===== hologram.ts =====
  // 巷子里的全息投影：地上一台投影机往上打一束淡淡的光，光束顶上浮着一块半透明的面板，写下一句（没有下一句时
  // 写这一句的译文，曲名卡时写曲名与歌手）。加色混合、不写深度：扫描线、往上走的亮带、一圈细框、偶尔的闪烁，
  // 换字时横带错位一下。白天被日光冲淡。

  var HOLO_TEXTURE = { width: 1024, height: 376 }
  /** 换字时的错位持续多久（秒）。 */
  var SWITCH_SECONDS = 0.35

  var PANEL_VERTEX = `
varying vec2 vUv;
void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

  var PANEL_FRAGMENT = `
uniform sampler2D uMap;
uniform vec3 uColor;
uniform float uTime;
uniform float uLevel;
uniform float uGlitch;
uniform float uAspect;
varying vec2 vUv;
float hHash(float n) { return fract(sin(n * 91.7) * 43758.5453); }
void main() {
    vec2 uv = vUv;
    // 换字时几条横带错开。
    float band = floor(uv.y * 26.0);
    float tear = hHash(band + floor(uTime * 24.0) * 3.1);
    uv.x += (tear - 0.5) * 0.06 * uGlitch * step(0.55, tear);
    float text = texture2D(uMap, uv).r;
    // 扫描线、往上走的一道亮带、细框与四角的折角。
    float scan = 0.82 + 0.18 * sin(vUv.y * 190.0 - uTime * 8.0);
    // 负数的 pow 在 D3D 上是 NaN（会被 bloom 晕满全屏），平方都写成相乘。
    float sweepAt = (fract(vUv.y - uTime * 0.22) - 0.5) * 7.0;
    float sweep = exp(-sweepAt * sweepAt) * 0.35;
    vec2 edge = min(vUv, 1.0 - vUv) * vec2(uAspect, 1.0);
    float frame = 1.0 - smoothstep(0.006, 0.016, min(edge.x, edge.y));
    float corner = step(min(edge.x, edge.y), 0.035) * step(max(edge.x, edge.y), 0.12);
    float fill = 0.07 + 0.06 * (1.0 - vUv.y);
    float flicker = 0.9 + 0.1 * hHash(floor(uTime * 14.0));
    float intensity = (text * 1.35 + frame * 0.5 + corner * 0.6 + fill) * scan * flicker + sweep * (0.15 + text * 0.4);
    gl_FragColor = vec4(uColor * intensity * uLevel * (1.0 - 0.4 * uGlitch), 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
}
`

  var BEAM_FRAGMENT = `
uniform vec3 uColor;
uniform float uLevel;
uniform float uTime;
varying vec2 vUv;
void main() {
    // 光束：越往上越淡，中间亮两边淡，几条往上流的细纹。
    float across = max(0.0, 1.0 - abs(vUv.x - 0.5) * 2.0);
    float streak = 0.75 + 0.25 * sin(vUv.x * 40.0 + uTime * 1.3) * sin(vUv.y * 9.0 - uTime * 3.0);
    float alpha = pow(across, 1.5) * (0.35 + 0.65 * (1.0 - vUv.y)) * streak;
    gl_FragColor = vec4(uColor * alpha * 0.3 * uLevel, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
}
`

  function additive(material) {
    material.transparent = true
    material.depthWrite = false
    material.blending = THREE.AdditiveBlending
    material.side = THREE.DoubleSide
    return material
  }

  /** 面板写什么：下一句；没有下一句时用这一句的译文；曲名卡时是曲名与歌手。 */
  function resolveKowloonHologramText(target, lines, song) {
    var title = song.title || 'KOWLOON'
    if (target.kind === 'line') {
      var next = null
      for (var i = target.index + 1; i < lines.length; i += 1) {
        if (String(lines[i].fullText || '').trim()) { next = lines[i]; break }
      }
      if (next) return { label: 'NEXT', text: next.fullText.trim() }
      var current = lines[target.index]
      var translation = current && current.translation ? current.translation.trim() : undefined
      if (translation) return { label: 'TRANSLATION', text: translation }
    }
    return { label: 'NOW PLAYING', text: song.artist ? title + ' — ' + song.artist : title }
  }

  /** 全息投影。base 是投影机镜头的位置，panel 是面板中心（在镜头正上方）；面板绕 y 转 rotationY 朝向镜头。 */
  function KowloonHologram(materials, base, panel) {
    this.group = new THREE.Group()
    this.canvas = Raster.createCanvas(HOLO_TEXTURE.width, HOLO_TEXTURE.height)
    this.texture = new THREE.CanvasTexture(this.canvas)
    this.texture.colorSpace = THREE.NoColorSpace
    this.texture.anisotropy = 4
    this.panel = materials.track(additive(new THREE.ShaderMaterial({
      vertexShader: PANEL_VERTEX,
      fragmentShader: PANEL_FRAGMENT,
      uniforms: {
        uMap: { value: this.texture },
        uColor: { value: new THREE.Color() },
        uTime: { value: 0 },
        uLevel: { value: 1 },
        uGlitch: { value: 0 },
        uAspect: { value: panel.width / panel.height }
      }
    })))
    this.panel.name = 'machi:glow:hologram'
    var panelGeometry = new THREE.PlaneGeometry(panel.width, panel.height)
    var panelMesh = new THREE.Mesh(panelGeometry, this.panel)
    panelMesh.name = 'Hologram/panel'
    panelMesh.position.copy(panel.position)
    panelMesh.rotation.y = panel.rotationY
    panelMesh.renderOrder = 4
    // 光束：从镜头到面板下沿的一片梯形（两片交叉，从哪个角度看都有）。
    this.beam = materials.track(additive(new THREE.ShaderMaterial({
      vertexShader: PANEL_VERTEX,
      fragmentShader: BEAM_FRAGMENT,
      uniforms: { uColor: { value: new THREE.Color() }, uLevel: { value: 1 }, uTime: { value: 0 } }
    })))
    var top = panel.position.y - panel.height / 2
    var beamGeometry = new THREE.BufferGeometry()
    var half = panel.width / 2
    var lens = 0.08
    var rise = top - base.y
    beamGeometry.setAttribute('position', new THREE.Float32BufferAttribute([
      -lens, 0, 0, lens, 0, 0, half, rise, 0, -half, rise, 0
    ], 3))
    beamGeometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2))
    beamGeometry.setIndex([0, 1, 2, 0, 2, 3])
    var beamMesh = new THREE.Mesh(beamGeometry, this.beam)
    beamMesh.name = 'Hologram/beam'
    beamMesh.position.copy(base)
    beamMesh.rotation.y = panel.rotationY
    beamMesh.renderOrder = 3
    this._geometries = [panelGeometry, beamGeometry]
    this._key = ''
    this._switchElapsed = SWITCH_SECONDS
    this._pending = null
    this.group.add(beamMesh, panelMesh)
  }

  /** 换字：内容一样就不重画；immediate 时不做错位。 */
  KowloonHologram.prototype.setText = function (text, font, immediate) {
    var key = text.label + '|' + text.text + '|' + font.stack + '|' + font.weight
    if (key === this._key) return
    this._key = key
    if (immediate) {
      this._paint(text, font)
      this._switchElapsed = SWITCH_SECONDS
      this._pending = null
    } else {
      this._pending = { text: text, font: font }
      this._switchElapsed = 0
    }
  }

  /** 内容作废（换主题、换字体）：下次 setText 一定重画。 */
  KowloonHologram.prototype.invalidate = function () {
    this._key = ''
  }

  KowloonHologram.prototype._paint = function (text, font) {
    var context = Raster.context2d(this.canvas)
    var width = this.canvas.width
    var height = this.canvas.height
    context.clearRect(0, 0, width, height)
    context.fillStyle = '#000000'
    context.fillRect(0, 0, width, height)
    context.fillStyle = '#ffffff'
    context.textBaseline = 'middle'
    context.textAlign = 'left'
    // 左上角一行小标签，下面一到两行字。
    context.font = Raster.fontSpec({ stack: 'ui-monospace, "Cascadia Mono", Consolas, monospace', weight: 700 }, height * 0.1)
    context.globalAlpha = 0.75
    context.fillText('▸ ' + text.label, width * 0.05, height * 0.14)
    context.globalAlpha = 1
    context.textAlign = 'center'
    var maxWidth = width * 0.88
    var px = height * 0.3
    context.font = Raster.fontSpec(font, px)
    var rows = Raster.wrapText(context, text.text, maxWidth, 2)
    if (rows.length > 1) {
      px = height * 0.28
      context.font = Raster.fontSpec(font, px)
      rows = Raster.wrapText(context, text.text, maxWidth, 2)
    }
    if (rows.length === 1) px = Raster.fitFont(context, font, rows[0], maxWidth, px)
    var center = height * 0.58
    rows.forEach(function (row, index) {
      var y = center + (index - (rows.length - 1) / 2) * px * 1.18
      context.fillText(row, width / 2, y)
    })
    this.texture.needsUpdate = true
  }

  /** frame: { time, delta, staticMode, level, color } */
  KowloonHologram.prototype.update = function (frame) {
    var glitch = 0
    if (this._switchElapsed < SWITCH_SECONDS) {
      this._switchElapsed += frame.staticMode ? SWITCH_SECONDS : Math.max(frame.delta, 1 / 120)
      var t = Math.min(1, this._switchElapsed / SWITCH_SECONDS)
      if (t >= 0.4 && this._pending) {
        this._paint(this._pending.text, this._pending.font)
        this._pending = null
      }
      glitch = t >= 1 ? 0 : Math.sin(Math.PI * t)
    }
    var time = frame.staticMode ? 0 : frame.time
    var uniforms = this.panel.uniforms
    uniforms.uTime.value = time
    uniforms.uLevel.value = frame.level
    uniforms.uGlitch.value = glitch
    uniforms.uColor.value.copy(frame.color)
    this.beam.uniforms.uTime.value = time
    this.beam.uniforms.uLevel.value = frame.level
    this.beam.uniforms.uColor.value.copy(frame.color)
  }

  Object.defineProperty(KowloonHologram.prototype, 'busy', {
    /** 换字的错位还在走：暂停时也要继续出帧。 */
    get: function () { return this._switchElapsed < SWITCH_SECONDS }
  })

  KowloonHologram.prototype.dispose = function () {
    this.texture.dispose()
    this._geometries.forEach(function (geometry) { geometry.dispose() })
  }

  // ===== kowloonSigns.ts =====
  // 城寨酒吧的招牌：酒吧楼面上的歌词大屏（engine/lyricScreen.ts，当前行逐字点亮）、屏幕下沿的 LED 跑马灯（这一句的
  // 译文，没有译文时滚曲名、歌手）、巷子里的全息投影（下一句，hologram.ts）、酒吧门头的霓虹（曲名），以及一串
  // 伸出楼面的店招（一块竖灯箱写歌手，其余是按 seed 挑的店名：霓虹或灯箱）、楼顶的「九龍城寨」、大排档的招牌。
  // 店招都画进一张图集，按“稳定 / 两组会坏的灯管”分三种材质，各合成一个网格；坏的那两组时不时闪一阵、灭一下。

  /** 店名：竖招牌与横招牌各一池，有的带一行英文小字。 */
  var VERTICAL_SHOPS = [
    ['義體診所', 'CYBER CLINIC'], ['夜總會', 'NIGHT CLUB'], ['麻雀館'], ['跌打'], ['大押'], ['旅館', 'HOTEL'],
    ['牙科', 'DENTAL'], ['電腦維修'], ['髮廊'], ['找換店'], ['義肢'], ['桑拿']
  ]
  var HORIZONTAL_SHOPS = ['冰室', '魚蛋粉', '卡拉OK', '當舖', '網吧', '雀館', '燒臘', '涼茶', '電子煙', '記憶交易']
  var NEON_COLORS = ['#ff4fb0', '#3fe8ff', '#ffb547', '#57ff9a', '#ff5a4a', '#b38bff']
  var BOX_STYLES = [
    ['#f4efe2', '#c8282c'],
    ['#ffd23f', '#1c1c1c'],
    ['#d8262c', '#fff4d6'],
    ['#1f6fd1', '#ffffff'],
    ['#18a058', '#ffffff']
  ]

  /** 图集的像素密度（每米多少像素）：要读的字（门头、歌手、楼顶）密一点。 */
  var PX_PER_METER = { fine: 300, shop: 220 }
  var ATLAS_WIDTH = 2048
  var ATLAS_PAD = 6

  /**
   * 图集招牌分几个网格（各一个材质）：group 是坏灯管那组（0 稳定，1、2 是两组会坏的灯管），beat 是霓虹随拍轮到的那组。
   * 稳定的招牌占了大半，按顺序轮流分进三组，免得随拍时整条街一起亮；两组坏灯管各自就是一组。
   */
  var ATLAS_SLOTS = [
    { group: 0, beat: 0 },
    { group: 0, beat: 1 },
    { group: 0, beat: 2 },
    { group: 1, beat: 1 },
    { group: 2, beat: 2 }
  ]

  /** 按行装箱：从高到矮排，一行放不下就换行。 */
  function packAtlas(sizes) {
    var order = sizes.map(function (size, index) { return { width: size.width, height: size.height, index: index } })
    order.sort(function (a, b) { return b.height - a.height })
    var rects = new Array(sizes.length)
    var x = ATLAS_PAD
    var y = ATLAS_PAD
    var row = 0
    order.forEach(function (size) {
      if (x + size.width + ATLAS_PAD > ATLAS_WIDTH) {
        x = ATLAS_PAD
        y += row + ATLAS_PAD
        row = 0
      }
      rects[size.index] = { x: x, y: y, width: size.width, height: size.height }
      x += size.width + ATLAS_PAD
      row = Math.max(row, size.height)
    })
    return { rects: rects, height: Math.ceil((y + row + ATLAS_PAD) / 4) * 4 }
  }

  /** 一块招牌面：平面网格，UV 映到图集里的一格。 */
  function atlasFace(placement, rect, atlasHeight) {
    // 本地的 mergeGeometries 只合非索引几何：Plane 先转非索引再改 UV。
    var geometry = new THREE.PlaneGeometry(placement.width, placement.height).toNonIndexed()
    var uv = geometry.getAttribute('uv')
    var u0 = rect.x / ATLAS_WIDTH
    var u1 = (rect.x + rect.width) / ATLAS_WIDTH
    var vTop = 1 - rect.y / atlasHeight
    var vBottom = 1 - (rect.y + rect.height) / atlasHeight
    for (var index = 0; index < uv.count; index += 1) {
      uv.setXY(index, u0 + uv.getX(index) * (u1 - u0), vBottom + uv.getY(index) * (vTop - vBottom))
    }
    geometry.rotateY(placement.rotationY)
    geometry.translate(placement.position.x, placement.position.y, placement.position.z)
    return geometry
  }

  /** 屏幕下沿的跑马灯：这一句的译文；没有译文时滚曲名与歌手。 */
  function resolveKowloonTickerText(target, lines, song) {
    var current = target.kind === 'line' ? lines[target.index] : undefined
    if (current && current.translation && current.translation.trim()) return '◆ ' + current.translation.trim() + '   '
    return '♪ ' + (song.title || 'KOWLOON') + (song.artist ? ' — ' + song.artist : '') + '   ◆   九龍城寨   ◆   OPEN ALL NIGHT   ◆   '
  }

  /**
   * 城寨酒吧的招牌总装。constructor(materials, blend, placements, seed)
   * placements: { screen, ticker, barSign, boards[], hologram: { base, panel } }
   */
  function KowloonSigns(materials, blend, placements, seed) {
    this.group = new THREE.Group()
    this._blend = blend
    this._seed = seed
    this._geometries = []
    this._entries = []
    this._content = null
    this._boardTarget = null
    this._lines = []
    this._tickerDirty = true
    this.group.name = 'Signs'
    var screen = placements.screen
    var ticker = placements.ticker
    var hologramPlacement = placements.hologram
    this.screen = new MachiLyricScreen(materials, blend, screen.width, screen.height)
    this.group.add(this.screen.createFace(screen.position, screen.rotationY, 'Bar/screen'))
    this.ticker = new MachiLedStrip(materials, blend, ticker.width, ticker.height, 9)
    this.group.add(this.ticker.createFace(ticker.position, ticker.rotationY, 'Bar/ticker'))
    this.hologram = new KowloonHologram(materials, hologramPlacement.base, hologramPlacement.panel)
    this.group.add(this.hologram.group)

    // 店招：按 seed 给每块挑店名、写法（霓虹 / 灯箱）、颜色、坏不坏。
    var self = this
    var random = SeedHash.createVisualizerRng('kowloon:signs:' + seed)
    var verticalPool = VERTICAL_SHOPS.slice()
    var horizontalPool = HORIZONTAL_SHOPS.slice()
    var take = function (pool) { return pool.splice(Math.floor(random() * pool.length), 1)[0] }
    var neonStyle = function () {
      var color = NEON_COLORS[Math.floor(random() * NEON_COLORS.length)]
      return { kind: 'neon', color: color, border: random() < 0.5 ? color : NEON_COLORS[Math.floor(random() * NEON_COLORS.length)] }
    }
    var boxStyle = function () {
      var pair = BOX_STYLES[Math.floor(random() * BOX_STYLES.length)]
      return { kind: 'box', background: pair[0], ink: pair[1] }
    }
    var entries = []
    entries.push({
      placement: placements.barSign,
      group: 0,
      fine: true,
      paint: function (context, content) {
        paintKowloonBarSign(context, self._rectOf(0), {
          font: content.font,
          title: content.song.title || content.song.album || 'KOWLOON',
          neon: content.palette.neon,
          glass: '#3fe8ff',
          mark: '#ff4fb0'
        })
      }
    })
    placements.boards.forEach(function (board) {
      var index = entries.length
      if (board.role === 'artist') {
        entries.push({
          placement: board,
          group: 0,
          fine: true,
          paint: function (context, content) {
            var background = '#f4efe2'
            var ink = ColorMath.adjustLightnessForContrast(PaletteMod.vivid(content.palette.brand[0], 0.62, 0.3, 0.46), background, 4.5)
            paintKowloonSign(context, self._rectOf(index), {
              font: content.font,
              text: content.song.artist || content.song.album || content.song.title || '歌手',
              vertical: true,
              style: { kind: 'box', background: background, ink: ink }
            })
          }
        })
        return
      }
      var text
      var caption
      var style
      if (board.role === 'billboard') {
        text = '九龍城寨'
        style = { kind: 'neon', color: '#ff4a5a', border: '#3fe8ff' }
      } else if (board.role === 'stall') {
        text = '大牌檔'
        style = { kind: 'box', background: '#f3ead6', ink: '#c6282c' }
      } else if (board.vertical) {
        var picked = take(verticalPool)
        text = picked[0]
        caption = picked[1]
        style = random() < 0.55 ? neonStyle() : boxStyle()
      } else {
        text = take(horizontalPool)
        style = random() < 0.6 ? neonStyle() : boxStyle()
      }
      var groupIndex = board.role === 'shop' && style.kind === 'neon' && random() < 0.45 ? 1 + Math.floor(random() * 2) : 0
      entries.push({
        placement: board,
        group: groupIndex,
        fine: board.role === 'billboard',
        paint: function (context) {
          paintKowloonSign(context, self._rectOf(index), {
            font: { stack: self._content.font.stack, weight: 800 },
            text: text,
            vertical: board.vertical,
            style: style,
            caption: caption
          })
        }
      })
    })
    var packed = packAtlas(entries.map(function (entry) {
      var density = entry.fine ? PX_PER_METER.fine : PX_PER_METER.shop
      return { width: Math.round(entry.placement.width * density), height: Math.round(entry.placement.height * density) }
    }))
    this._entries = entries.map(function (entry, index) { return Object.assign({}, entry, { rect: packed.rects[index] }) })
    this.canvas = Raster.createCanvas(ATLAS_WIDTH, packed.height)
    this.texture = new THREE.CanvasTexture(this.canvas)
    this.texture.colorSpace = THREE.SRGBColorSpace
    this.texture.anisotropy = 8
    this.atlasMaterials = ATLAS_SLOTS.map(function (slot) {
      var material = materials.track(new THREE.MeshBasicMaterial({ map: self.texture }))
      material.name = 'machi:glow:neon' + slot.group + '-' + slot.beat
      return material
    })
    var faces = ATLAS_SLOTS.map(function () { return [] })
    var steady = 0
    this._entries.forEach(function (entry) {
      var slot
      if (entry.group === 0) {
        slot = steady % 3
        steady += 1
      } else {
        slot = 0
        for (var si = 0; si < ATLAS_SLOTS.length; si += 1) {
          if (ATLAS_SLOTS[si].group === entry.group) { slot = si; break }
        }
      }
      faces[slot].push(atlasFace(entry.placement, entry.rect, packed.height))
    })
    this.atlasMaterials.forEach(function (material, slotIndex) {
      var slotFaces = faces[slotIndex]
      if (slotFaces.length === 0) return
      var merged = Geometry.mergeGeometries(slotFaces)
      slotFaces.forEach(function (face) { face.dispose() })
      self._geometries.push(merged)
      var result = new THREE.Mesh(merged, material)
      var slot = ATLAS_SLOTS[slotIndex]
      result.name = 'Neon/' + slot.group + '-' + slot.beat
      self.group.add(result)
    })
  }

  KowloonSigns.prototype._rectOf = function (index) {
    return this._entries[index].rect
  }

  /** 换歌 / 换主题：重画图集里所有的招牌、屏幕的字面。 */
  KowloonSigns.prototype.setContent = function (content) {
    this._content = content
    var context = Raster.context2d(this.canvas)
    context.clearRect(0, 0, this.canvas.width, this.canvas.height)
    this._entries.forEach(function (entry) { entry.paint(context, content) })
    this.texture.needsUpdate = true
    var palette = content.palette
    var song = content.song
    var font = content.font
    this.screen.setContent({
      palette: palette,
      font: font,
      measure: Raster.createMachiMeasure(font),
      matchers: WordColoring.prepareWordColorMatchers(content.theme.wordColors),
      cardTitle: '♪ ' + (song.title || 'KOWLOON'),
      cardSubtitle: song.artist || song.album || ''
    })
    this.ticker.invalidate()
    this.hologram.invalidate()
    this._tickerDirty = true
  }

  /** 换牌面。 */
  KowloonSigns.prototype.showBoard = function (target, lines, immediate, showText) {
    if (showText === undefined) showText = true
    this._lines = lines
    this._boardTarget = target
    this.screen.show(target, lines, immediate, showText)
    this._tickerDirty = true
    var content = this._content
    if (content) {
      var text = resolveKowloonHologramText(showText ? target : { kind: 'card' }, lines, content.song)
      this.hologram.setText(text, content.font, immediate)
    }
  }

  /** 空闲时提前画好下一行。 */
  KowloonSigns.prototype.preheat = function (target, lines, showText) {
    this.screen.preheat(target, lines, showText)
  }

  /** frame: { songTime, ambientTime, delta, staticMode, chorus, audio, flicker, artificial, daylight, beat } */
  KowloonSigns.prototype.update = function (frame) {
    var content = this._content
    if (!content) return
    this.screen.update(frame)
    var chorus = this.screen.chorus
    if (this._tickerDirty && this._boardTarget) {
      this._tickerDirty = false
      this.ticker.setText(resolveKowloonTickerText(this._boardTarget, this._lines, content.song), content.font)
    }
    this.ticker.update({ delta: frame.delta, staticMode: frame.staticMode, speed: 0.8 + 0.4 * chorus, audio: frame.audio })
    // 霓虹：白天也亮着，只是被日光压下去；两组坏灯管时不时闪一阵，偶尔整个灭掉。
    // 霓虹随拍（智能动感模式）：招牌按 ATLAS_SLOTS 分在三组里轮流慢慢亮起（坏灯管灭着的时候照样灭着）。
    var self = this
    var neon = Math.pow(frame.artificial, 1.4) * (1 + 0.1 * chorus)
    var steady = neon * (0.93 + 0.07 * frame.flicker)
    var broken = function (salt, offset) {
      if (frame.staticMode) return neon
      var flicker = Director.resolveMachiFlicker(frame.ambientTime + offset, self._seed + ':' + salt, 1.8)
      return neon * (flicker < 1 ? 0.12 + 0.3 * (flicker - 0.5) : 1)
    }
    var levels = [steady, broken('neonA', 1.3), broken('neonB', 3.7)]
    this.atlasMaterials.forEach(function (material, index) {
      var slot = ATLAS_SLOTS[index]
      material.color.setScalar(levels[slot.group] * BeatFx.machiNeonGroup(frame.beat, slot.beat))
    })
    this.hologram.update({
      time: frame.ambientTime,
      delta: frame.delta,
      staticMode: frame.staticMode,
      level: (0.3 + 0.7 * (1 - frame.daylight)) * (0.9 + 0.1 * frame.flicker) * (1 + 0.15 * chorus),
      color: this._blend.get('holo')
    })
  }

  Object.defineProperty(KowloonSigns.prototype, 'busy', {
    /** 屏幕或全息上有切换动画：暂停时也要继续出帧。 */
    get: function () { return this.screen.busy || this.hologram.busy }
  })

  KowloonSigns.prototype.dispose = function () {
    this.screen.dispose()
    this.ticker.dispose()
    this.hologram.dispose()
    this.texture.dispose()
    this._geometries.forEach(function (geometry) { geometry.dispose() })
  }

  window.FoliaMachiSceneKowloonPaint = {
    resolveKowloonVerticalText: resolveKowloonVerticalText,
    paintKowloonSign: paintKowloonSign,
    paintKowloonBarSign: paintKowloonBarSign,
    resolveKowloonTickerText: resolveKowloonTickerText,
    KowloonSigns: KowloonSigns,
    resolveKowloonHologramText: resolveKowloonHologramText,
    KowloonHologram: KowloonHologram
  }
})()
