// 夜空底 + 段落场景条目（移植自 hanabiSky.ts + hanabiSceneEntry.ts，合成一文件）：
// 夜空：运行时铺在所有段落场景与片尾卡之下的一整块竖向渐变（上深靛、中堇、近地平线一抹桃紫的祭典光），
// 色相往主题强调色偏一点。不随段落转场一起淡出。不透明度每帧从 tuning.sky 现读，为 0 时整层不画。
// 场景条目：编译出的段落 → createHanabiScene 的参数，外面包一层运行时 holder（转场的透明度/缩放/位移/模糊套在
// holder 上，场景自己在内部舞台做运镜与世界上升，两套变换互不覆盖）。
(function () {
  'use strict'

  var Color = window.FoliaHanabiColor
  var Program = window.FoliaHanabiProgram
  var SeedHash = window.FoliaSeedHash

  // ===== 夜空（hanabiSky.ts） =====

  function hslOfHex(hex) {
    var r = ((hex >> 16) & 255) / 255
    var g = ((hex >> 8) & 255) / 255
    var b = (hex & 255) / 255
    var max = Math.max(r, g, b)
    var min = Math.min(r, g, b)
    var l = (max + min) / 2
    if (max === min) return [0, 0, l]
    var d = max - min
    var s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    var h = max === r ? (g - b) / d + (g < b ? 6 : 0) : (max === g ? (b - r) / d + 2 : (r - g) / d + 4)
    return [h / 6, s, l]
  }

  function cssOfHsl(hsl) {
    return 'hsl(' + (((hsl[0] % 1) + 1) % 1) * 360 + 'deg ' + hsl[1] * 100 + '% ' + hsl[2] * 100 + '%)'
  }

  /** 色相沿最短方向往 target 转 amount。 */
  function leanHue(from, to, amount) {
    var delta = to - from
    if (delta > 0.5) delta -= 1
    if (delta < -0.5) delta += 1
    return from + delta * amount
  }

  /** 夜空的四个色标（自上而下）；主题强调色没有色相（灰、黑白主题）时保持原样。 */
  function resolveHanabiSkyStops(theme) {
    var hsl = hslOfHex(Color.hexOfCss(theme.accentColor, 0xff7a8a))
    var hue = hsl[0]
    var saturation = hsl[1]
    var lean = function (base) { return saturation < 0.2 ? base : leanHue(base, hue, 0.3) }
    return [
      { at: 0, color: cssOfHsl([lean(0.66), 0.62, 0.06]) },
      { at: 0.45, color: cssOfHsl([lean(0.7), 0.5, 0.11]) },
      { at: 0.82, color: cssOfHsl([lean(0.8), 0.48, 0.19]) },
      { at: 1, color: cssOfHsl([lean(0.9), 0.55, 0.27]) }
    ]
  }

  function paintSky(theme) {
    var canvas = document.createElement('canvas')
    canvas.width = 4
    canvas.height = 512
    var context = canvas.getContext('2d')
    var gradient = context.createLinearGradient(0, 0, 0, canvas.height)
    resolveHanabiSkyStops(theme).forEach(function (stop) { gradient.addColorStop(stop.at, stop.color) })
    context.fillStyle = gradient
    context.fillRect(0, 0, canvas.width, canvas.height)
    return canvas
  }

  function HanabiSkyLayer(pixi) {
    this._pixi = pixi
    this.view = new pixi.Container()
    this._sprite = new pixi.Sprite()
    this.view.addChild(this._sprite)
    this._texture = null
    this._theme = null
  }

  /** 每帧调用：主题变了才重画渐变，尺寸与不透明度直接改。 */
  HanabiSkyLayer.prototype.update = function (theme, alpha, width, height) {
    this.view.visible = alpha > 0.002
    if (!this.view.visible) return
    if (theme !== this._theme) {
      this._theme = theme
      var previous = this._texture
      this._texture = this._pixi.Texture.from(paintSky(theme))
      this._sprite.texture = this._texture
      if (previous) previous.destroy(true)
    }
    this._sprite.width = width
    this._sprite.height = height
    this.view.alpha = alpha
  }

  HanabiSkyLayer.prototype.destroy = function () {
    if (this._texture) this._texture.destroy(true)
    this._texture = null
    this.view.destroy({ children: true })
  }

  // ===== 段落场景条目（hanabiSceneEntry.ts） =====

  /** 整首歌的旋转方向（按程序种子定）：每段从这个方向起转，段落转场也朝它转。 */
  function hanabiSpinDirection(programSeed) {
    return SeedHash.hashVisualizerSeed(programSeed + ':spin-direction') % 2 === 0 ? 1 : -1
  }

  /** 模糊低于这个强度就摘掉 filter：一个挂着不用的 filter 也要多一次整屏离屏渲染。 */
  var BLUR_EPSILON = 0.3

  /** 建一个段落场景（排版这一段的全部歌词；字形图集到镜头快出场时才画，见 scene.prepare）。 */
  function buildHanabiSceneEntry(pixi, context, index) {
    var width = context.width
    var height = context.height
    var program = context.program
    var paragraph = program.paragraphs[index]
    var lineMap = new Map()
    paragraph.lineIndices.forEach(function (lineIndex, k) {
      lineMap.set(lineIndex, paragraph.lines[k])
    })
    var shots = paragraph.shots.map(function (shot) {
      return {
        id: shot.id,
        profile: Program.resolveShotProfile(shot),
        startTime: shot.startTime,
        endTime: shot.endTime,
        isBridge: shot.isBridge,
        line: shot.isBridge ? null : Program.shotLine(lineMap, shot.slices)
      }
    })
    if (shots.length === 0) {
      // 编译器保证每段至少一个镜头；防御：给一个覆盖整段的间奏。
      shots.push({
        id: paragraph.id,
        profile: Program.resolveShotProfile({ kind: '' }),
        startTime: paragraph.startTime,
        endTime: paragraph.endTime,
        isBridge: true,
        line: null
      })
    }
    var Scene = window.FoliaHanabiScene
    var scene = Scene.createHanabiScene(pixi, {
      width: width,
      height: height,
      resolution: context.resolution,
      seed: program.seed + ':' + paragraph.id,
      theme: context.theme,
      tuning: context.tuning,
      shots: shots,
      startTime: paragraph.startTime,
      endTime: paragraph.endTime,
      textures: context.textures,
      exitStart: paragraph.transitionOut ? paragraph.transitionOut.startTime : null,
      motifs: context.motifs,
      icons: context.icons,
      spinDirection: hanabiSpinDirection(program.seed),
      opening: index === 0 && context.songTitle ? { title: context.songTitle, artist: context.songArtist } : null
    })
    scene.setLayerVisibility({ graphics: true, text: context.showText, mid: false })
    var holder = new pixi.Container()
    holder.addChild(scene.view)
    holder.pivot.set(width / 2, height / 2)
    holder.position.set(width / 2, height / 2)
    holder.zIndex = index
    return { index: index, scene: scene, holder: holder, blur: null }
  }

  /** 套转场帧：透明度、以画面中心为原点的缩放与旋转、纵向位移、模糊（按需挂 / 摘）。 */
  function applyHanabiLayerFrame(pixi, entry, frame, size, blurResolution) {
    entry.holder.alpha = frame.alpha
    entry.holder.scale.set(frame.scale)
    entry.holder.position.set(size.width / 2, size.height / 2 + frame.y * size.height)
    entry.holder.rotation = frame.rotation
    if (frame.blur > BLUR_EPSILON) {
      if (!entry.blur) {
        // 模糊的内容不需要满分辨率：半分辨率跑模糊，开销是整屏的四分之一。
        entry.blur = new pixi.BlurFilter({ strength: frame.blur, quality: 3, resolution: blurResolution })
      }
      entry.blur.strength = frame.blur
      var filters = entry.holder.filters
      if (!filters || filters.indexOf(entry.blur) < 0) {
        // 固定一块远大于画面的区域：不给时 Pixi 每帧都要遍历整个场景量包围盒。
        if (!entry.holder.filterArea) {
          entry.holder.filterArea = new pixi.Rectangle(-size.width, -size.height, size.width * 3, size.height * 3)
        }
        entry.holder.filters = [entry.blur]
      }
    } else if (entry.holder.filters && entry.holder.filters.length) {
      entry.holder.filters = []
    }
  }

  function destroyHanabiSceneEntry(entry) {
    if (entry.holder.parent) entry.holder.parent.removeChild(entry.holder)
    entry.holder.filters = []
    if (entry.blur) entry.blur.destroy()
    entry.blur = null
    entry.holder.removeChild(entry.scene.view)
    entry.scene.destroy()
    entry.holder.destroy()
  }

  window.FoliaHanabiSky = {
    HanabiSkyLayer: HanabiSkyLayer,
    resolveHanabiSkyStops: resolveHanabiSkyStops,
    hanabiSpinDirection: hanabiSpinDirection,
    buildHanabiSceneEntry: buildHanabiSceneEntry,
    applyHanabiLayerFrame: applyHanabiLayerFrame,
    destroyHanabiSceneEntry: destroyHanabiSceneEntry,
    BLUR_EPSILON: BLUR_EPSILON
  }
})()
