// 便利店（konbini）场景 —— 招牌画法与招牌装配（移植自 folia-major scenes/konbini/konbiniSignPaint.ts + konbiniSigns.ts，
// 因总行数超限拆出的第二个文件；主文件 scene-konbini.js 装其余部分）：
// 便利店各块招牌的 Canvas 2D 画法：店招（图标 logo + 店名）、立柱灯箱、玻璃海报、窗内霓虹图标、广告塔顶的屋顶 logo、
// 门口 A 字立牌。共用的字体、图标、缩字、折行在 machi-signraster.js。
// 便利店的招牌：屋顶三面广告屏（machi-lyricscreen.js，当前行逐字点亮）、右面店招上的 LED 跑马灯（machi-ledstrip.js，
// 下一句 / 译文）、前面店招（主题图标 logo + 曲名当店名）、立柱灯箱、玻璃海报（歌手、专辑）、窗内霓虹图标、
// 广告塔顶的屋顶 logo、门口 A 字立牌（主题名）。颜色、图标、字体都从主题来；牌面贴图在换行 / 换歌 / 换主题时重画，
// 每帧只改 uniform 与材质亮度。
// 依赖：引擎模块（加载即可）；layout 常量（DEG/BOARD/STORE）在主文件 window.FoliaMachiSceneKonbini 上，
// 这里在构造函数运行时惰性取，两个文件的加载顺序不受限。
(function () {
  'use strict'

  var THREE = window.THREE
  var Raster = window.FoliaMachiSignRaster
  var BeatFx = window.FoliaMachiBeatFx
  var Director = window.FoliaMachiDirector
  var WordColoring = window.FoliaWordColoring

  // ===== konbiniSignPaint.ts =====

  /**
   * 前面店招：左边一个圆形 logo（主题图标），中间店名（曲名），右边小字 24H。
   * paint: { font, title, icon?, fallbacks, base, text, brand }
   */
  function paintKonbiniFascia(canvas, paint) {
    var context = Raster.context2d(canvas)
    var width = canvas.width
    var height = canvas.height
    context.fillStyle = paint.base
    context.fillRect(0, 0, width, height)
    var badge = height * 0.86
    var badgeX = height * 0.3
    var badgeY = (height - badge) / 2
    context.fillStyle = paint.brand[0]
    context.beginPath()
    context.arc(badgeX + badge / 2, badgeY + badge / 2, badge / 2, 0, Math.PI * 2)
    context.fill()
    Raster.drawIcon(context, paint.icon, paint.fallbacks, badgeX + badge * 0.2, badgeY + badge * 0.2, badge * 0.6, '#ffffff', 2.4)
    var tagWidth = height * 1.5
    var textLeft = badgeX + badge + height * 0.35
    var textRight = width - tagWidth - height * 0.3
    context.textBaseline = 'middle'
    context.textAlign = 'left'
    context.fillStyle = paint.text
    Raster.fitFont(context, paint.font, paint.title, textRight - textLeft, height * 0.6)
    context.fillText(paint.title, textLeft, height * 0.53)
    // 右边：品牌色小块里写 24H。
    context.fillStyle = paint.brand[2]
    context.beginPath()
    context.roundRect(width - tagWidth - height * 0.15, height * 0.18, tagWidth, height * 0.64, height * 0.12)
    context.fill()
    context.fillStyle = '#ffffff'
    context.textAlign = 'center'
    Raster.fitFont(context, Object.assign({}, paint.font, { weight: 800 }), '24H', tagWidth * 0.8, height * 0.42)
    context.fillText('24H', width - tagWidth / 2 - height * 0.15, height * 0.52)
  }

  /** 立柱灯箱：上半品牌色带大图标，下半白底写 24 HOURS。paint: { font, icon?, fallbacks, base, brand } */
  function paintKonbiniPylon(canvas, paint) {
    var context = Raster.context2d(canvas)
    var width = canvas.width
    var height = canvas.height
    context.fillStyle = paint.base
    context.fillRect(0, 0, width, height)
    context.fillStyle = paint.brand[0]
    context.fillRect(0, 0, width, height * 0.58)
    context.fillStyle = paint.brand[2]
    context.fillRect(0, height * 0.58, width, height * 0.05)
    var iconSize = height * 0.44
    Raster.drawIcon(context, paint.icon, paint.fallbacks, (width - iconSize) / 2, height * 0.07, iconSize, '#ffffff', 2.6)
    context.fillStyle = paint.brand[2]
    context.textAlign = 'center'
    context.textBaseline = 'middle'
    Raster.fitFont(context, Object.assign({}, paint.font, { weight: 800 }), '24', width * 0.5, height * 0.26)
    context.fillText('24', width * 0.32, height * 0.8)
    context.fillStyle = '#2a2f3a'
    Raster.fitFont(context, paint.font, 'HOURS', width * 0.36, height * 0.12)
    context.fillText('HOURS', width * 0.66, height * 0.8)
  }

  /**
   * 玻璃上的海报：色底、大图标、标题（歌手 / 专辑）、角上一个小标签。
   * paint: { font, heading, body, icon?, fallbacks, background, ink, accent, tag }
   */
  function paintKonbiniPoster(canvas, paint) {
    var context = Raster.context2d(canvas)
    var width = canvas.width
    var height = canvas.height
    context.fillStyle = paint.background
    context.fillRect(0, 0, width, height)
    context.strokeStyle = paint.ink
    context.globalAlpha = 0.18
    context.lineWidth = width * 0.02
    context.strokeRect(width * 0.05, width * 0.05, width * 0.9, height - width * 0.1)
    context.globalAlpha = 1
    var iconSize = width * 0.5
    Raster.drawIcon(context, paint.icon, paint.fallbacks, (width - iconSize) / 2, height * 0.12, iconSize, paint.ink, 2.4)
    context.fillStyle = paint.ink
    context.textAlign = 'center'
    context.textBaseline = 'middle'
    var headingPx = Raster.fitFont(context, paint.font, paint.heading, width * 0.84, width * 0.15)
    var headingLines = Raster.wrapText(context, paint.heading, width * 0.84, 2)
    headingLines.forEach(function (line, index) { context.fillText(line, width / 2, height * 0.62 + index * headingPx * 1.15) })
    context.globalAlpha = 0.75
    Raster.fitFont(context, Object.assign({}, paint.font, { weight: Math.max(400, paint.font.weight - 300) }), paint.body, width * 0.8, width * 0.075)
    context.fillText(paint.body, width / 2, height * 0.86)
    context.globalAlpha = 1
    // 角上的小标签。
    context.save()
    context.translate(width * 0.78, height * 0.07)
    context.rotate(0.22)
    context.fillStyle = paint.accent
    context.beginPath()
    context.roundRect(-width * 0.17, -width * 0.06, width * 0.34, width * 0.12, width * 0.03)
    context.fill()
    context.fillStyle = '#ffffff'
    Raster.fitFont(context, Object.assign({}, paint.font, { weight: 800 }), paint.tag, width * 0.28, width * 0.08)
    context.fillText(paint.tag, 0, width * 0.005)
    context.restore()
  }

  /**
   * 广告塔顶的屋顶 logo：品牌色三角、内圈一道第三色描边、中间一个大的主题图标。
   * paint: { corners（三角形顶点，按画布像素）, icon?, fallbacks, brand, rotation（图标朝向，弧度） }
   */
  function paintKonbiniRoofLogo(canvas, paint) {
    var context = Raster.context2d(canvas)
    var width = canvas.width
    var height = canvas.height
    context.clearRect(0, 0, width, height)
    var path = new Path2D()
    paint.corners.forEach(function (corner, index) { if (index === 0) path.moveTo(corner.x, corner.y); else path.lineTo(corner.x, corner.y) })
    path.closePath()
    context.fillStyle = paint.brand[0]
    context.fill(path)
    var cx = paint.corners.reduce(function (sum, corner) { return sum + corner.x }, 0) / paint.corners.length
    var cy = paint.corners.reduce(function (sum, corner) { return sum + corner.y }, 0) / paint.corners.length
    // 三角形按比例向重心收缩一圈（scale 0..1）。
    var inset = function (scale) {
      var inner = new Path2D()
      paint.corners.forEach(function (corner, index) {
        var x = cx + (corner.x - cx) * scale
        var y = cy + (corner.y - cy) * scale
        if (index === 0) inner.moveTo(x, y)
        else inner.lineTo(x, y)
      })
      inner.closePath()
      return inner
    }
    context.lineJoin = 'round'
    context.strokeStyle = paint.brand[1]
    context.lineWidth = width * 0.022
    context.stroke(inset(0.86))
    context.strokeStyle = paint.brand[2]
    context.lineWidth = width * 0.014
    context.stroke(inset(0.78))
    var radius = Math.min.apply(null, paint.corners.map(function (corner) { return Math.hypot(corner.x - cx, corner.y - cy) }))
    var size = radius * 0.62
    context.save()
    context.translate(cx, cy)
    context.rotate(paint.rotation)
    Raster.drawIcon(context, paint.icon, paint.fallbacks, -size / 2, -size / 2, size, '#ffffff', 2.6)
    context.restore()
  }

  /** 窗内霓虹：透明底上一个发光的图标线稿（加色混合贴在玻璃后面）。 */
  function paintKonbiniNeon(canvas, icon, fallbacks, color) {
    var context = Raster.context2d(canvas)
    var width = canvas.width
    var height = canvas.height
    context.clearRect(0, 0, width, height)
    var size = Math.min(width, height) * 0.7
    var x = (width - size) / 2
    var y = (height - size) / 2
    context.shadowColor = color
    context.shadowBlur = size * 0.12
    Raster.drawIcon(context, icon, fallbacks, x, y, size, color, 1.6)
    context.shadowBlur = size * 0.04
    Raster.drawIcon(context, icon, fallbacks, x, y, size, '#ffffff', 0.6)
    context.shadowBlur = 0
  }

  /** 门口 A 字立牌：黑板底、粉笔字。paint: { font, heading, title, note, icon?, fallbacks, chalk, accent } */
  function paintKonbiniAFrame(canvas, paint) {
    var context = Raster.context2d(canvas)
    var width = canvas.width
    var height = canvas.height
    context.fillStyle = '#7a5a3a'
    context.fillRect(0, 0, width, height)
    context.fillStyle = '#1f2a25'
    context.fillRect(width * 0.05, width * 0.05, width * 0.9, height - width * 0.1)
    context.textAlign = 'center'
    context.textBaseline = 'middle'
    context.fillStyle = paint.accent
    Raster.fitFont(context, paint.font, paint.heading, width * 0.8, width * 0.09)
    context.fillText(paint.heading, width / 2, height * 0.12)
    context.fillStyle = paint.chalk
    var titlePx = Raster.fitFont(context, paint.font, paint.title, width * 0.82, width * 0.15, width * 0.08)
    var titleLines = Raster.wrapText(context, paint.title, width * 0.82, 2)
    titleLines.forEach(function (line, index) { context.fillText(line, width / 2, height * 0.3 + index * titlePx * 1.2) })
    context.globalAlpha = 0.85
    context.font = Raster.fontSpec(Object.assign({}, paint.font, { weight: Math.max(400, paint.font.weight - 300) }), width * 0.065)
    Raster.wrapText(context, paint.note, width * 0.8, 4).forEach(function (line, index) { context.fillText(line, width / 2, height * 0.55 + index * width * 0.085) })
    context.globalAlpha = 1
    Raster.drawIcon(context, paint.icon, paint.fallbacks, width * 0.38, height * 0.8, width * 0.24, paint.accent, 1.8)
  }

  // ===== konbiniSigns.ts =====

  /** canvas → 贴图（sRGB、各向异性）。 */
  function canvasTexture(canvas, anisotropy) {
    anisotropy = anisotropy === undefined ? 4 : anisotropy
    var texture = new THREE.CanvasTexture(canvas)
    texture.colorSpace = THREE.SRGBColorSpace
    texture.anisotropy = anisotropy
    return texture
  }

  /** 一块按位置、朝向摆好的平面网格。 */
  function placedPlane(material, width, height, position, rotationY, name) {
    var result = new THREE.Mesh(new THREE.PlaneGeometry(width, height), material)
    result.name = name
    result.position.copy(position)
    result.rotation.y = rotationY
    return result
  }

  /**
   * constructor(materials, blend, placements)
   * placements: { boardFaces, fasciaFaces, pylonFaces, aFrameFaces, boardLid }
   */
  function KonbiniSigns(materials, blend, placements) {
    // layout 常量（DEG/BOARD/STORE）在主文件 scene-konbini.js 的命名空间上，此时一定已加载。
    var Layout = window.FoliaMachiSceneKonbini
    var DEG = Layout.DEG
    var BOARD = Layout.BOARD
    var STORE = Layout.STORE
    var LyricScreen = window.FoliaMachiLyricScreen
    var LedStrip = window.FoliaMachiLedStrip
    // 字段先备好（staticSign 在下面构造过程中会往 statics 里登记）。
    this.group = new THREE.Group()
    this.group.name = 'Signs'
    this.boardTarget = null
    this.statics = []
    this.content = null
    this.lines = []
    this.screen = new LyricScreen(materials, blend, BOARD.faceWidth - 0.14, BOARD.faceHeight - 0.12)
    var self = this
    placements.boardFaces.forEach(function (face, index) {
      self.group.add(self.screen.createFace(face.position, face.rotationY, 'Board/face' + index))
    })

    // 前面店招、右面 LED。
    var fasciaFront = placements.fasciaFaces[0]
    this.fascia = this.staticSign(materials, 1600, Math.round(1600 * fasciaFront.height / fasciaFront.width), 0.78, 'basic')
    this.group.add(placedPlane(this.fascia.material, fasciaFront.width, fasciaFront.height, fasciaFront.position, fasciaFront.rotationY, 'Fascia/front'))
    var fasciaRight = placements.fasciaFaces[1]
    this.led = new LedStrip(materials, blend, fasciaRight.width, fasciaRight.height)
    this.group.add(this.led.createFace(fasciaRight.position, fasciaRight.rotationY, 'Fascia/led'))

    // 立柱灯箱两面。
    var pylonFace = placements.pylonFaces[0]
    this.pylon = this.staticSign(materials, 384, Math.round(384 * pylonFace.height / pylonFace.width), 0.95, 'basic')
    placements.pylonFaces.forEach(function (face, index) {
      self.group.add(placedPlane(self.pylon.material, face.width, face.height, face.position, face.rotationY, 'Pylon/face' + index))
    })

    // 玻璃海报：前面左段玻璃后面两张。
    this.posters = [0, 1].map(function (index) {
      var sign = self.staticSign(materials, 256, 364, 0.95, 'basic')
      var position = new THREE.Vector3(-4.05 + index * 0.72, 1.62, STORE.z1 - 0.075)
      self.group.add(placedPlane(sign.material, 0.56, 0.8, position, 0, 'Poster' + index))
      return sign
    })

    // 窗内霓虹：右面玻璃后面，朝外。
    this.neon = this.staticSign(materials, 256, 256, 1.6, 'additive')
    this.group.add(placedPlane(this.neon.material, 0.86, 0.86, new THREE.Vector3(STORE.x1 - 0.1, 1.55, -1.95), Math.PI / 2, 'Neon'))

    // 广告塔顶的屋顶 logo：形状坐标就是 UV（米），贴图按外接正方形映射过去。
    var lid = placements.boardLid
    var reach = Math.max.apply(null, lid.shape.map(function (point) { return point.length() })) * 1.02
    this.roofLogo = this.staticSign(materials, 512, 512, 1, 'toon')
    this.roofLogo.texture.repeat.set(1 / (2 * reach), 1 / (2 * reach))
    this.roofLogo.texture.offset.set(0.5, 0.5)
    this.roofLogo.material.emissive.setScalar(0.32)
    this.roofLogo.material.emissiveMap = this.roofLogo.texture
    this.roofCorners = lid.shape.map(function (point) { return { x: (point.x / (2 * reach) + 0.5) * 512, y: (0.5 - point.y / (2 * reach)) * 512 } })
    var logoGeometry = new THREE.ShapeGeometry(new THREE.Shape(lid.shape))
    logoGeometry.rotateX(-Math.PI / 2)
    var logo = new THREE.Mesh(logoGeometry, this.roofLogo.material)
    logo.name = 'Board/roofLogo'
    logo.position.set(lid.center.x, lid.topY + 0.004, lid.center.z)
    logo.receiveShadow = true
    this.group.add(logo)

    // 门口 A 字立牌。
    var aFace = placements.aFrameFaces[0]
    this.aFrame = this.staticSign(materials, 256, Math.round(256 * aFace.height / aFace.width), 1, 'toon')
    var aMesh = placedPlane(this.aFrame.material, aFace.width, aFace.height, aFace.position, aFace.rotationY, 'AFrame/face')
    aMesh.rotateX(-(aFace.lean !== undefined && aFace.lean !== null ? aFace.lean : 12 * DEG))
    this.group.add(aMesh)
  }

  /**
   * 一块静态招牌：一张 canvas 贴图 + 材质（自发光、加色或受光）。
   * kind: 'basic'（自发光按 level 调色）| 'additive'（加色）| 'toon'（受光）
   */
  KonbiniSigns.prototype.staticSign = function (materials, width, height, level, kind) {
    var canvas = Raster.createCanvas(width, height)
    var texture = canvasTexture(canvas)
    var material = kind === 'toon'
      ? materials.track(new THREE.MeshToonMaterial({ map: texture, gradientMap: materials.gradient }))
      : materials.track(new THREE.MeshBasicMaterial({
        map: texture,
        transparent: kind === 'additive',
        blending: kind === 'additive' ? THREE.AdditiveBlending : THREE.NormalBlending,
        depthWrite: kind !== 'additive'
      }))
    if (material instanceof THREE.MeshBasicMaterial) material.color.setScalar(level)
    var sign = { canvas: canvas, texture: texture, material: material, level: level }
    this.statics.push(sign)
    return sign
  }

  /** 换歌 / 换主题：重画所有静态招牌，牌面按新颜色重画。content: { song, theme, palette, font, icons, fallbacks } */
  KonbiniSigns.prototype.setContent = function (content) {
    this.content = content
    var palette = content.palette
    var font = content.font
    var song = content.song
    var fallbacks = content.fallbacks
    // 第 index 张牌用第 index 个主题图标；主题没给图标就按位次取兜底图标。
    var icon = function (index) {
      return content.icons.length ? content.icons[index % content.icons.length] : fallbacks[index % fallbacks.length]
    }
    var title = song.title || song.album || 'KONBINI'
    paintKonbiniFascia(this.fascia.canvas, { font: font, title: title, icon: icon(0), fallbacks: fallbacks, base: palette.signBase, text: palette.signText, brand: palette.brand })
    paintKonbiniPylon(this.pylon.canvas, { font: font, icon: icon(0), fallbacks: fallbacks, base: palette.signBase, brand: palette.brand })
    paintKonbiniPoster(this.posters[0].canvas, {
      font: font,
      heading: song.artist || title,
      body: song.album || 'NOW ON SALE',
      icon: icon(1),
      fallbacks: fallbacks,
      background: palette.brand[1],
      ink: palette.brand[0],
      accent: palette.brand[2],
      tag: 'NEW'
    })
    paintKonbiniPoster(this.posters[1].canvas, {
      font: font,
      heading: content.theme.name && content.theme.provider === 'AI' ? content.theme.name : (song.album || title),
      body: 'LIMITED',
      icon: icon(2),
      fallbacks: fallbacks,
      background: palette.brand[2],
      ink: '#ffffff',
      accent: palette.brand[0],
      tag: '限定'
    })
    paintKonbiniNeon(this.neon.canvas, icon(0), fallbacks, palette.neon)
    // 屋顶 logo 的图标朝向：默认镜头从前右（方位角 45°）看过来，图标的“上”朝远离镜头的方向。
    paintKonbiniRoofLogo(this.roofLogo.canvas, { corners: this.roofCorners, icon: icon(0), fallbacks: fallbacks, brand: palette.brand, rotation: -Math.PI / 4 })
    var hasThemeName = !!content.theme.name && content.theme.provider === 'AI'
    paintKonbiniAFrame(this.aFrame.canvas, {
      font: font,
      heading: '本日のテーマ',
      title: hasThemeName ? content.theme.name : title,
      note: (hasThemeName ? content.theme.description : song.artist) || '',
      icon: icon(1),
      fallbacks: fallbacks,
      chalk: '#eef1ea',
      accent: palette.brand[0]
    })
    this.statics.forEach(function (sign) { sign.texture.needsUpdate = true })
    this.screen.setContent({
      palette: palette,
      font: font,
      measure: Raster.createMachiMeasure(font),
      matchers: WordColoring.prepareWordColorMatchers(content.theme.wordColors),
      cardTitle: '♪ ' + (song.title || 'KONBINI'),
      cardSubtitle: song.artist || song.album || ''
    })
    this.led.invalidate()
  }

  /** 换牌面（静态模式、暂停时直接换）。showText 缺省 true。 */
  KonbiniSigns.prototype.showBoard = function (target, lines, immediate, showText) {
    showText = showText === undefined ? true : showText
    this.lines = lines
    this.boardTarget = target
    this.screen.show(target, lines, immediate, showText)
    this.led.invalidate()
  }

  /** 空闲时提前画好下一行。 */
  KonbiniSigns.prototype.preheat = function (target, lines, showText) {
    this.screen.preheat(target, lines, showText)
  }

  /** 每帧：屏幕、LED 滚动、招牌亮度（闪烁、副歌、音频）。frame: { songTime, ambientTime, delta, staticMode, chorus, audio, flicker, beat } */
  KonbiniSigns.prototype.update = function (frame) {
    var content = this.content
    if (!content) return
    this.screen.update(frame)
    var chorus = this.screen.chorus

    // LED：内容随牌面换，滚动速度副歌时快一点。
    if (!this.led.hasText && this.boardTarget) {
      this.led.setText(Director.resolveMachiTickerText(this.boardTarget, this.lines, content.song, 'KONBINI'), content.font)
    }
    this.led.update({ delta: frame.delta, staticMode: frame.staticMode, speed: 1 + 0.5 * chorus, audio: frame.audio })

    // 静态招牌：闪烁只落在店招与立柱灯箱上，副歌时不闪、更亮；霓虹随副歌脉动。
    var flicker = chorus > 0.5 ? 1 : frame.flicker
    var lift = 1 + 0.08 * chorus + 0.05 * frame.audio
    // 霓虹随拍（智能动感模式）：霓虹招牌是第一组、店招灯箱第三组、立柱灯箱第一组（灯箱只跟一小份），与店招上沿的霓虹边
    // （第二组）轮流慢慢亮起。
    var beat = frame.beat
    this.setLevel(this.fascia, this.fascia.level * lift * BeatFx.machiLightboxGroup(beat, 2))
    this.setLevel(this.pylon, this.pylon.level * flicker * lift * BeatFx.machiLightboxGroup(beat, 0))
    var neonPulse = frame.staticMode ? 1 : 0.85 + 0.15 * Math.sin(frame.ambientTime * 2.2) + 0.4 * chorus
    this.setLevel(this.neon, this.neon.level * neonPulse * BeatFx.machiNeonGroup(beat, 0))
  }

  /** 只调 MeshBasicMaterial 的亮度（toon 材质的招牌受光，不在这里调）。 */
  KonbiniSigns.prototype.setLevel = function (sign, level) {
    if (sign.material instanceof THREE.MeshBasicMaterial) sign.material.color.setScalar(level)
  }

  Object.defineProperty(KonbiniSigns.prototype, 'busy', {
    /** 屏幕上有招牌在动画：暂停时也要继续出帧。 */
    get: function () { return this.screen.busy }
  })

  KonbiniSigns.prototype.dispose = function () {
    this.screen.dispose()
    this.led.dispose()
    this.statics.forEach(function (sign) { sign.texture.dispose() })
    var screenMaterial = this.screen.material
    var ledMaterial = this.led.material
    this.group.traverse(function (object) {
      if (object instanceof THREE.Mesh && object.material !== screenMaterial && object.material !== ledMaterial) object.geometry.dispose()
    })
  }

  window.FoliaMachiSceneKonbiniPaint = {
    paintKonbiniFascia: paintKonbiniFascia,
    paintKonbiniPylon: paintKonbiniPylon,
    paintKonbiniPoster: paintKonbiniPoster,
    paintKonbiniRoofLogo: paintKonbiniRoofLogo,
    paintKonbiniNeon: paintKonbiniNeon,
    paintKonbiniAFrame: paintKonbiniAFrame,
    KonbiniSigns: KonbiniSigns
  }
})()
