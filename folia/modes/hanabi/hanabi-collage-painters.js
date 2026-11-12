// 花火（hanabi）PV 拼贴件纹理：移植自 folia-major src/components/visualizer/hanabi/collage/collagePainters.ts
// 拼贴件的纹理：在 Canvas 2D 上画好（带白边、硬阴影、花纹），按渲染倍率画，按 key 缓存在一个场景单元里，单元销毁时一起释放。
// 贴纸是「模切贴纸」的样子：形状 + 一圈粗白边 + 偏移的浅阴影；胶带半透明、两端锯齿；拟声字用圆体粗字。
// 装饰带是可以平铺的一节：胶片（齿孔挖空、一格格粉彩画面）、剪切线（一段虚线）、蕾丝花边（一个波浪 + 孔眼），
// 沿带子方向重复；剪切线另有一把剪刀。
// 图标贴纸：上游按主题的 lucide 图标 SVG 节点画进画布（Path2D 直接吃 path 的 d）；插件无 lucide，主题图标恒为空，
// 统一走内置线稿兜底（线稿数据取自 machi-signraster.js 的 MACHI_ICONS 同一套：Store/Umbrella/CloudRain/Moon/Sun/Music/Flower/CupSoda/Coffee），
// 图标名映射不到这 9 个里时落到最接近的（音乐→Music、月→Moon、日→Sun、雨云→CloudRain、店→Store、杯子→CupSoda、其余→Flower），
// 一圈粗白边 + 浅阴影 + 彩色描线。
// 颜色直接画进纹理（白边、深色字不能跟着 tint 变），所以 key 里带颜色；同一首歌里重复的组合不多。
(function () {
  'use strict'

  var PIXI = window.PIXI
  var Plan = window.FoliaHanabiCollagePlan

  /** 装饰字用的圆体：系统里有就用，没有回落到主题字体。 */
  var POP_FONT_FAMILIES = '"M PLUS Rounded 1c", "Zen Maru Gothic", "Kosugi Maru", "Hiragino Maru Gothic ProN", "Arial Rounded MT Bold", "Yu Gothic UI", "Meiryo UI", "Microsoft YaHei UI"'

  var css = function (color, alpha) {
    if (alpha === undefined) alpha = 1
    return 'rgba(' + ((color >> 16) & 255) + ',' + ((color >> 8) & 255) + ',' + (color & 255) + ',' + alpha + ')'
  }

  /** 贴纸纹理的基准边长（逻辑像素）；精灵按需要的尺寸缩放。 */
  var STICKER_PX = 112

  // ─── 贴纸形状的 2D 路径 ────────────────────────────────────────────────

  var pathHeart = function (context, c, r) {
    context.moveTo(c, c + r * 0.85)
    context.bezierCurveTo(c - r * 1.25, c + r * 0.05, c - r * 0.95, c - r * 0.95, c, c - r * 0.42)
    context.bezierCurveTo(c + r * 0.95, c - r * 0.95, c + r * 1.25, c + r * 0.05, c, c + r * 0.85)
  }

  var pathStar = function (context, c, r, points, inner, rotation) {
    if (rotation === undefined) rotation = -Math.PI / 2
    for (var i = 0; i < points * 2; i += 1) {
      var radius = i % 2 === 0 ? r : r * inner
      var angle = rotation + (i * Math.PI) / points
      var x = c + Math.cos(angle) * radius
      var y = c + Math.sin(angle) * radius
      if (i === 0) context.moveTo(x, y)
      else context.lineTo(x, y)
    }
    context.closePath()
  }

  var pathSparkle = function (context, c, r) {
    var pinch = r * 0.16
    context.moveTo(c, c - r)
    context.quadraticCurveTo(c + pinch, c - pinch, c + r, c)
    context.quadraticCurveTo(c + pinch, c + pinch, c, c + r)
    context.quadraticCurveTo(c - pinch, c + pinch, c - r, c)
    context.quadraticCurveTo(c - pinch, c - pinch, c, c - r)
    context.closePath()
  }

  var pathFlower = function (context, c, r) {
    for (var i = 0; i < 5; i += 1) {
      var angle = -Math.PI / 2 + (i * Math.PI * 2) / 5
      context.moveTo(c + Math.cos(angle) * r * 0.55 + r * 0.42, c + Math.sin(angle) * r * 0.55)
      context.arc(c + Math.cos(angle) * r * 0.55, c + Math.sin(angle) * r * 0.55, r * 0.42, 0, Math.PI * 2)
    }
  }

  var pathCloud = function (context, c, r) {
    var bumps = [[-0.5, 0.15, 0.38], [-0.12, -0.18, 0.48], [0.38, -0.02, 0.42], [0.62, 0.25, 0.28], [0.05, 0.3, 0.4]]
    bumps.forEach(function (bump) {
      context.moveTo(c + bump[0] * r + bump[2] * r, c + bump[1] * r)
      context.arc(c + bump[0] * r, c + bump[1] * r, bump[2] * r, 0, Math.PI * 2)
    })
  }

  var pathRibbon = function (context, c, r) {
    // 蝴蝶结：两片圆角三角 + 中间的结。
    context.moveTo(c, c)
    context.bezierCurveTo(c - r * 0.5, c - r * 0.75, c - r * 1.05, c - r * 0.55, c - r * 0.95, c)
    context.bezierCurveTo(c - r * 1.05, c + r * 0.55, c - r * 0.5, c + r * 0.75, c, c)
    context.bezierCurveTo(c + r * 0.5, c - r * 0.75, c + r * 1.05, c - r * 0.55, c + r * 0.95, c)
    context.bezierCurveTo(c + r * 1.05, c + r * 0.55, c + r * 0.5, c + r * 0.75, c, c)
    context.moveTo(c + r * 0.24, c)
    context.arc(c, c, r * 0.24, 0, Math.PI * 2)
  }

  var pathCat = function (context, c, r) {
    // 猫脸：圆脸 + 两只三角耳。
    context.moveTo(c + r * 0.78, c + r * 0.12)
    context.arc(c, c + r * 0.12, r * 0.78, 0, Math.PI * 2)
    context.moveTo(c - r * 0.72, c - r * 0.2)
    context.lineTo(c - r * 0.62, c - r * 0.95)
    context.lineTo(c - r * 0.12, c - r * 0.6)
    context.closePath()
    context.moveTo(c + r * 0.72, c - r * 0.2)
    context.lineTo(c + r * 0.62, c - r * 0.95)
    context.lineTo(c + r * 0.12, c - r * 0.6)
    context.closePath()
  }

  var pathBubble = function (context, c, r) {
    var w = r * 1.0
    var h = r * 0.72
    var top = c - h * 0.95
    var radius = h * 0.55
    context.roundRect(c - w, top, w * 2, h * 1.6, radius)
    context.moveTo(c - w * 0.35, top + h * 1.55)
    context.lineTo(c - w * 0.62, top + h * 2.15)
    context.lineTo(c - w * 0.02, top + h * 1.55)
    context.closePath()
  }

  var SHAPE_PATHS = {
    heart: pathHeart,
    star: function (context, c, r) { return pathStar(context, c, r, 5, 0.48) },
    sparkle: pathSparkle,
    flower: pathFlower,
    cloud: pathCloud,
    ribbon: pathRibbon,
    cat: pathCat,
    bubble: pathBubble
  }

  // ─── 内置线稿图标（插件无 lucide 的兜底，线稿与 modes/machi/machi-signraster.js 的 MACHI_ICONS 同一套） ──
  // 节点形状与 lucide 的 SVG 节点同构：{ type: 'path', d } 与 { type: 'circle', cx, cy, r }。

  var HANABI_ICONS = {
    Store: [
      { type: 'path', d: 'm2 7 4.41-4.41A2 2 0 0 1 7.83 2h8.34a2 2 0 0 1 1.42.59L22 7' },
      { type: 'path', d: 'M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8' },
      { type: 'path', d: 'M15 22v-4a2 2 0 0 0-2-2h-2a2 2 0 0 0-2 2v4' },
      { type: 'path', d: 'M2 7h20' },
      { type: 'path', d: 'M22 7v3a2 2 0 0 1-2 2 2.7 2.7 0 0 1-1.59-.63.7.7 0 0 0-.82 0 2.7 2.7 0 0 1-4.18 0 .7.7 0 0 0-.82 0 2.7 2.7 0 0 1-4.18 0 .7.7 0 0 0-.82 0A2.7 2.7 0 0 1 4 12a2 2 0 0 1-2-2V7' }
    ],
    Umbrella: [
      { type: 'path', d: 'M22 12a10.06 10.06 0 0 0-20 0Z' },
      { type: 'path', d: 'M12 12v8a2 2 0 0 0 4 0' },
      { type: 'path', d: 'M12 2v1' }
    ],
    CloudRain: [
      { type: 'path', d: 'M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242' },
      { type: 'path', d: 'M16 14v6' },
      { type: 'path', d: 'M8 14v6' },
      { type: 'path', d: 'M12 16v6' }
    ],
    Moon: [
      { type: 'path', d: 'M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z' }
    ],
    Sun: [
      { type: 'circle', cx: 12, cy: 12, r: 4 },
      { type: 'path', d: 'M12 2v2' }, { type: 'path', d: 'M12 20v2' },
      { type: 'path', d: 'm4.93 4.93 1.41 1.41' }, { type: 'path', d: 'm17.66 17.66 1.41 1.41' },
      { type: 'path', d: 'M2 12h2' }, { type: 'path', d: 'M20 12h2' },
      { type: 'path', d: 'm6.34 17.66-1.41 1.41' }, { type: 'path', d: 'm19.07 4.93-1.41 1.41' }
    ],
    Music: [
      { type: 'path', d: 'M9 18V5l12-2v13' },
      { type: 'circle', cx: 6, cy: 18, r: 3 },
      { type: 'circle', cx: 18, cy: 16, r: 3 }
    ],
    Flower: [
      { type: 'circle', cx: 12, cy: 12, r: 3 },
      { type: 'path', d: 'M12 16.5A4.5 4.5 0 1 1 7.5 12 4.5 4.5 0 1 1 12 7.5a4.5 4.5 0 1 1 4.5 4.5 4.5 4.5 0 1 1-4.5 4.5' },
      { type: 'path', d: 'M12 7.5V9' }, { type: 'path', d: 'M7.5 12H9' }, { type: 'path', d: 'M16.5 12H15' }, { type: 'path', d: 'M12 16.5V15' }
    ],
    CupSoda: [
      { type: 'path', d: 'M17 9h1.5a1.5 1.5 0 0 1 0 3H17' },
      { type: 'path', d: 'm4 12 8.5-8.5a2.12 2.12 0 1 1 3 3L7 15' },
      { type: 'path', d: 'M15 13 9 19c-.6.6-.6 1.5 0 2l2 2' },
      { type: 'path', d: 'M12 9H3a1 1 0 0 0-1 1v8a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-8a1 1 0 0 0-1-1H12z' }
    ],
    Coffee: [
      { type: 'path', d: 'M10 2v2' }, { type: 'path', d: 'M14 2v2' },
      { type: 'path', d: 'M16 8a1 1 0 0 1 1 1v8a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V9a1 1 0 0 1 1-1h14a4 4 0 1 1 0 8h-1' },
      { type: 'path', d: 'M6 2v2' }
    ]
  }

  /** 主题图标名（上游是 lucide 导出名）→ 内置 9 图标之一；映射不到的落到最接近的（默认 Flower）。 */
  var resolveBuiltinIconName = function (name) {
    if (name && HANABI_ICONS[name]) return name
    if (!name) return 'Flower'
    if (/music|note|song|audio/i.test(name)) return 'Music'
    if (/moon|night/i.test(name)) return 'Moon'
    if (/sun|sunny|day/i.test(name)) return 'Sun'
    if (/cloud|rain|storm/i.test(name)) return 'CloudRain'
    if (/umbrella/i.test(name)) return 'Umbrella'
    if (/store|shop|building/i.test(name)) return 'Store'
    if (/coffee/i.test(name)) return 'Coffee'
    if (/cup|soda|drink|tea/i.test(name)) return 'CupSoda'
    return 'Flower'
  }

  var PATH_CACHE = new Map()

  /** 图标线稿 → Path2D（缓存；Path2D 不可用时返回 null，画法退回贴纸同形的五瓣小花）。 */
  function iconPath2d(name) {
    if (typeof Path2D !== 'function') return null
    if (PATH_CACHE.has(name)) return PATH_CACHE.get(name)
    var shapes = HANABI_ICONS[name]
    if (!shapes) return null
    var into = new Path2D()
    shapes.forEach(function (shape) {
      if (shape.type === 'path') {
        into.addPath(new Path2D(shape.d))
      } else if (shape.type === 'circle') {
        into.moveTo(shape.cx + shape.r, shape.cy)
        into.arc(shape.cx, shape.cy, shape.r, 0, Math.PI * 2)
      }
    })
    PATH_CACHE.set(name, into)
    return into
  }

  /** 圆体粗字的 font 串。 */
  var popFont = function (px, fallback) { return '800 ' + px + 'px ' + POP_FONT_FAMILIES + ', ' + fallback }

  /**
   * 建一个场景单元的拼贴纹理缓存。pixi = window.PIXI，resolution = 渲染倍率，fallbackFont = 主题字体栈（量的兜底）。
   * 返回 { sticker, tape, pattern, strip, scissors, echo, sound, icon, label, destroy }。
   */
  function createCollageTextureCache(pixi, resolution, fallbackFont) {
    var scale = Math.max(1, Math.min(2, resolution || 1))
    var cache = new Map()
    var measureContext = document.createElement('canvas').getContext('2d')

    /** 按逻辑尺寸开一张画布，返回已经按倍率缩放好的 context。 */
    var canvasOf = function (width, height) {
      var canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.ceil(width * scale))
      canvas.height = Math.max(1, Math.ceil(height * scale))
      var context = canvas.getContext('2d')
      context.setTransform(scale, 0, 0, scale, 0, 0)
      return { canvas: canvas, context: context }
    }

    var finish = function (key, canvas) {
      var source = new pixi.CanvasSource({ resource: canvas, resolution: scale })
      var texture = new pixi.Texture({ source: source })
      cache.set(key, texture)
      return texture
    }

    var cached = function (key, paint) { return cache.get(key) || finish(key, paint()) }

    var measure = function (text, font) {
      measureContext.font = font
      return measureContext.measureText(text).width
    }

    var sticker = function (shape, color, label) {
      return cached('sticker:' + shape + ':' + color + ':' + (label !== null && label !== undefined ? label : ''), function () {
        var side = STICKER_PX
        var box = canvasOf(side, side)
        var canvas = box.canvas
        var context = box.context
        var c = side / 2
        var r = side * 0.34
        var path = SHAPE_PATHS[shape]
        context.lineJoin = 'round'
        context.lineCap = 'round'
        // 阴影：整个贴纸（含白边）往右下偏一点的半透明深色。
        context.save()
        context.translate(side * 0.035, side * 0.05)
        context.beginPath()
        path(context, c, r)
        context.lineWidth = side * 0.13
        context.strokeStyle = 'rgba(30,16,48,0.28)'
        context.fillStyle = 'rgba(30,16,48,0.28)'
        context.stroke()
        context.fill()
        context.restore()
        // 白边：描粗边再填充。
        context.beginPath()
        path(context, c, r)
        context.lineWidth = side * 0.13
        context.strokeStyle = '#ffffff'
        context.fillStyle = '#ffffff'
        context.stroke()
        context.fill()
        // 本体。
        context.beginPath()
        path(context, c, r)
        context.fillStyle = css(color)
        context.fill()
        // 高光：左上一小块白。
        context.save()
        context.beginPath()
        path(context, c, r)
        context.clip()
        context.fillStyle = 'rgba(255,255,255,0.4)'
        context.beginPath()
        context.ellipse(c - r * 0.35, c - r * 0.4, r * 0.28, r * 0.16, -0.6, 0, Math.PI * 2)
        context.fill()
        context.restore()
        if (shape === 'cat') {
          // 眼睛与嘴。
          context.fillStyle = css(0x2b1f3d)
          context.beginPath()
          context.arc(c - r * 0.3, c + r * 0.08, r * 0.08, 0, Math.PI * 2)
          context.arc(c + r * 0.3, c + r * 0.08, r * 0.08, 0, Math.PI * 2)
          context.fill()
          context.strokeStyle = css(0x2b1f3d)
          context.lineWidth = r * 0.07
          context.beginPath()
          context.arc(c - r * 0.09, c + r * 0.28, r * 0.09, 0.1, Math.PI - 0.1)
          context.arc(c + r * 0.09, c + r * 0.28, r * 0.09, 0.1, Math.PI - 0.1)
          context.stroke()
          context.fillStyle = 'rgba(255,120,160,0.55)'
          context.beginPath()
          context.ellipse(c - r * 0.5, c + r * 0.3, r * 0.12, r * 0.07, 0, 0, Math.PI * 2)
          context.ellipse(c + r * 0.5, c + r * 0.3, r * 0.12, r * 0.07, 0, 0, Math.PI * 2)
          context.fill()
        }
        if (label) {
          var px = r * 0.62
          var font = function () { return popFont(px, fallbackFont) }
          while (px > 8 && measure(label, font()) > r * 1.7) px -= 1
          context.font = font()
          context.textAlign = 'center'
          context.textBaseline = 'middle'
          context.fillStyle = css(0x2b1f3d)
          context.fillText(label, c, c - r * 0.08)
        }
        return canvas
      })
    }

    var tape = function (color, pattern) {
      return cached('tape:' + color + ':' + pattern, function () {
        var length = 160
        var width = 48
        var box = canvasOf(length, width)
        var canvas = box.canvas
        var context = box.context
        var tooth = 6
        // 两端锯齿的胶带外形。
        context.beginPath()
        context.moveTo(0, 0)
        for (var y = 0; y <= width; y += tooth) context.lineTo(y % (tooth * 2) === 0 ? 0 : tooth * 0.7, y)
        context.lineTo(length, width)
        for (var y2 = width; y2 >= 0; y2 -= tooth) context.lineTo(y2 % (tooth * 2) === 0 ? length : length - tooth * 0.7, y2)
        context.closePath()
        context.fillStyle = css(color, 0.78)
        context.fill()
        context.save()
        context.clip()
        if (pattern === 'stripe') {
          context.strokeStyle = 'rgba(255,255,255,0.55)'
          context.lineWidth = 7
          for (var x = -width; x < length + width; x += 18) {
            context.beginPath()
            context.moveTo(x, width)
            context.lineTo(x + width, 0)
            context.stroke()
          }
        } else if (pattern === 'dot') {
          context.fillStyle = 'rgba(255,255,255,0.65)'
          for (var y3 = 8; y3 < width; y3 += 16) {
            for (var x3 = (y3 / 16) % 2 === 0 ? 8 : 16; x3 < length; x3 += 16) {
              context.beginPath()
              context.arc(x3, y3, 3.2, 0, Math.PI * 2)
              context.fill()
            }
          }
        } else {
          context.fillStyle = 'rgba(255,255,255,0.38)'
          for (var y4 = 0; y4 < width; y4 += 12) {
            for (var x4 = (y4 / 12) % 2 === 0 ? 0 : 12; x4 < length; x4 += 24) context.fillRect(x4, y4, 12, 12)
          }
        }
        context.restore()
        return canvas
      })
    }

    var pattern = function (kind) {
      return cached('pattern:' + kind, function () {
        var tile = 24
        var box = canvasOf(tile, tile)
        var canvas = box.canvas
        var context = box.context
        context.fillStyle = '#ffffff'
        context.strokeStyle = '#ffffff'
        if (kind === 'grid') {
          context.lineWidth = 1.2
          context.beginPath()
          context.moveTo(0, 0.6)
          context.lineTo(tile, 0.6)
          context.moveTo(0.6, 0)
          context.lineTo(0.6, tile)
          context.stroke()
        } else if (kind === 'dots') {
          context.beginPath()
          context.arc(tile / 4, tile / 4, 2.4, 0, Math.PI * 2)
          context.arc((tile * 3) / 4, (tile * 3) / 4, 2.4, 0, Math.PI * 2)
          context.fill()
        } else {
          context.globalAlpha = 0.55
          context.fillRect(0, 0, tile / 2, tile)
          context.fillRect(0, 0, tile, tile / 2)
        }
        return canvas
      })
    }

    /** 胶片：深色片基，上下两排齿孔挖空透出后面，中间三格画面（三种粉彩，各有一个白色小图案）。 */
    var paintFilm = function (color, height) {
      var frame = height * 1.18
      var width = Math.round(frame * 3)
      var box = canvasOf(width, height)
      var canvas = box.canvas
      var context = box.context
      context.fillStyle = css(Plan.CANDY_INK, 0.92)
      context.fillRect(0, 0, width, height)
      // 齿孔：每格四个，圆角小方孔，挖空（destination-out）。
      var pitch = frame / 4
      var holeW = pitch * 0.48
      var holeH = height * 0.11
      context.save()
      context.globalCompositeOperation = 'destination-out'
      for (var k = 0; k < 12; k += 1) {
        var x = k * pitch + (pitch - holeW) / 2
        ;[height * 0.07, height * 0.93 - holeH].forEach(function (y) {
          context.beginPath()
          context.roundRect(x, y, holeW, holeH, holeH * 0.3)
          context.fill()
        })
      }
      context.restore()
      // 画面格：主色与两种糖果色轮着，左上一道浅色高光，中间一个白色小图案。
      var base = Math.max(0, Plan.CANDY.indexOf(color))
      var colors = [color, Plan.CANDY[(base + 2) % Plan.CANDY.length], Plan.CANDY[(base + 4) % Plan.CANDY.length]]
      var icons = ['heart', 'star', 'sparkle']
      for (var g = 0; g < 3; g += 1) {
        var xF = g * frame + frame * 0.07
        var yF = height * 0.25
        var w = frame * 0.86
        var h = height * 0.5
        context.fillStyle = css(colors[g], 0.92)
        context.beginPath()
        context.roundRect(xF, yF, w, h, h * 0.12)
        context.fill()
        context.fillStyle = 'rgba(255,255,255,0.28)'
        context.beginPath()
        context.roundRect(xF + w * 0.06, yF + h * 0.1, w * 0.4, h * 0.16, h * 0.08)
        context.fill()
        context.fillStyle = 'rgba(255,255,255,0.9)'
        context.save()
        context.beginPath()
        context.translate(xF + w / 2, yF + h / 2)
        SHAPE_PATHS[icons[g]](context, 0, h * 0.24)
        context.fill()
        context.restore()
      }
      return canvas
    }

    /** 剪切线：一段虚线（圆头）+ 底下一道浅阴影，线上下留白给剪刀。 */
    var paintCut = function (color, height) {
      var period = Math.max(10, height * 0.9)
      var box = canvasOf(period, height)
      var canvas = box.canvas
      var context = box.context
      var line = Math.max(2, height * 0.11)
      var dash = period * 0.55
      context.lineCap = 'round'
      context.lineWidth = line
      context.strokeStyle = 'rgba(30,16,48,0.35)'
      context.beginPath()
      context.moveTo(line, height / 2 + line * 0.6)
      context.lineTo(line + dash - line, height / 2 + line * 0.6)
      context.stroke()
      context.strokeStyle = css(color)
      context.beginPath()
      context.moveTo(line, height / 2)
      context.lineTo(line + dash - line, height / 2)
      context.stroke()
      return canvas
    }

    /**
     * 蕾丝花边：白色蕾丝带身，上下两排细密的小波浪边（每个波浪里镂一个小孔），带身靠边各一排孔眼，
     * 中间穿一条糖果色缎带（带一道高光）。一节两个波浪。
     */
    var paintLace = function (color, height) {
      var scallop = Math.max(3, height * 0.21)
      var width = scallop * 4
      var box = canvasOf(width, height)
      var canvas = box.canvas
      var context = box.context
      var top = height * 0.25
      var bottom = height * 0.75
      var centers = [scallop, scallop * 3]
      var shape = function (dy) {
        context.beginPath()
        context.rect(0, top + dy, width, bottom - top)
        centers.forEach(function (cx) {
          context.moveTo(cx + scallop, top + dy)
          context.arc(cx, top + dy, scallop, 0, Math.PI, true)
          context.moveTo(cx - scallop, bottom + dy)
          context.arc(cx, bottom + dy, scallop, Math.PI, 0, true)
        })
      }
      context.fillStyle = 'rgba(30,16,48,0.22)'
      shape(height * 0.05)
      context.fill()
      context.fillStyle = 'rgba(255,255,255,0.96)'
      shape(0)
      context.fill()
      // 镂空：波浪里的小孔、带身边上的孔眼（透出后面）。
      context.save()
      context.globalCompositeOperation = 'destination-out'
      centers.forEach(function (cx) {
        ;[[top - scallop * 0.45, scallop * 0.3], [bottom + scallop * 0.45, scallop * 0.3], [top + height * 0.075, height * 0.035], [bottom - height * 0.075, height * 0.035]]
          .forEach(function (hole) {
            context.beginPath()
            context.arc(cx, hole[0], Math.max(0.8, hole[1]), 0, Math.PI * 2)
            context.fill()
          })
      })
      context.restore()
      // 缎带。
      var ribbonTop = height * 0.4
      var ribbonHeight = height * 0.2
      context.fillStyle = css(color)
      context.fillRect(0, ribbonTop, width, ribbonHeight)
      context.fillStyle = 'rgba(255,255,255,0.45)'
      context.fillRect(0, ribbonTop + ribbonHeight * 0.18, width, Math.max(1, ribbonHeight * 0.16))
      context.fillStyle = 'rgba(43,31,61,0.16)'
      context.fillRect(0, ribbonTop + ribbonHeight * 0.86, width, Math.max(1, ribbonHeight * 0.14))
      return canvas
    }

    var strip = function (style, color, thickness) {
      var height = Math.max(10, Math.round(thickness))
      return cached('strip:' + style + ':' + color + ':' + height, function () {
        return style === 'film' ? paintFilm(color, height) : style === 'cut' ? paintCut(color, height) : paintLace(color, height)
      })
    }

    /** 剪刀：两个指环 + 两片在轴心交叉的刀刃，白身深色描边（像贴纸），尖朝 +x。 */
    var scissors = function (thickness) {
      var side = Math.max(20, Math.round(thickness * 2.3))
      return cached('scissors:' + side, function () {
        var box = canvasOf(side, side)
        var canvas = box.canvas
        var context = box.context
        var c = side / 2
        var ring = side * 0.15
        context.lineJoin = 'round'
        context.lineCap = 'round'
        var outline = function (path, fill) {
          context.beginPath()
          path()
          context.lineWidth = side * 0.09
          context.strokeStyle = css(Plan.CANDY_INK)
          context.stroke()
          context.fillStyle = fill
          context.fill()
        }
        // 两片刀刃：从轴心往右上 / 右下伸出的细长尖叶。
        ;[-1, 1].forEach(function (dir) {
          outline(function () {
            context.moveTo(c - side * 0.12, c + dir * side * 0.1)
            context.quadraticCurveTo(c + side * 0.15, c - dir * side * 0.02, c + side * 0.46, c - dir * side * 0.06)
            context.quadraticCurveTo(c + side * 0.12, c + dir * side * 0.08, c - side * 0.12, c + dir * side * 0.16)
            context.closePath()
          }, '#ffffff')
        })
        // 两个指环（粉色）。
        ;[-1, 1].forEach(function (dir) {
          context.beginPath()
          context.arc(c - side * 0.28, c + dir * side * 0.2, ring, 0, Math.PI * 2)
          context.lineWidth = side * 0.1
          context.strokeStyle = css(Plan.CANDY_INK)
          context.stroke()
          context.lineWidth = side * 0.06
          context.strokeStyle = css(Plan.CANDY[0])
          context.stroke()
        })
        // 轴钉。
        context.beginPath()
        context.arc(c - side * 0.06, c, side * 0.04, 0, Math.PI * 2)
        context.fillStyle = css(Plan.CANDY_INK)
        context.fill()
        return canvas
      })
    }

    var echo = function (text, color, size, axis) {
      var px = Math.max(10, Math.round(size))
      return cached('echo:' + text + ':' + color + ':' + px + ':' + axis, function () {
        var font = popFont(px, fallbackFont)
        var textWidth = measure(text, font)
        var gapX = axis === 'x' ? px * 0.6 : px * 0.2
        var width = Math.ceil(textWidth + gapX * 2)
        var height = Math.ceil(px * (axis === 'x' ? 1.25 : 1.3))
        var box = canvasOf(width, height)
        var canvas = box.canvas
        var context = box.context
        context.font = font
        context.textAlign = 'center'
        context.textBaseline = 'middle'
        context.lineJoin = 'round'
        context.lineWidth = Math.max(1.5, px * 0.045)
        context.strokeStyle = css(color)
        context.strokeText(text, width / 2, height * 0.52)
        return canvas
      })
    }

    var icon = function (name, color, size) {
      // 上游 resolveLucideIconNode(name) ?? resolveLucideIconNode(HANABI_FALLBACK_ICON)；
      // 插件无 lucide：映射到内置 9 线稿之一，取不到同样落到 Flower。
      var resolved = resolveBuiltinIconName(name) || Plan.HANABI_FALLBACK_ICON
      var side = Math.max(16, Math.round(size))
      return cached('icon:' + resolved + ':' + color + ':' + side, function () {
        var box = canvasOf(side, side)
        var canvas = box.canvas
        var context = box.context
        // 24 单位的图标放进边长 side、四周留出白边与阴影的余量。
        var pad = side * 0.16
        var scale = (side - pad * 2) / 24
        context.translate(pad, pad)
        context.scale(scale, scale)
        context.lineJoin = 'round'
        context.lineCap = 'round'
        var path = iconPath2d(resolved)
        var draw = function (stroke, width, dx, dy) {
          if (dx === undefined) dx = 0
          if (dy === undefined) dy = 0
          context.save()
          context.translate(dx, dy)
          context.strokeStyle = stroke
          context.lineWidth = width
          if (path) context.stroke(path)
          else {
            // 内置线稿也画不了（无 Path2D）：画一朵五瓣小花（与贴纸的花同形）。
            context.beginPath()
            SHAPE_PATHS.flower(context, 12, 8)
            context.stroke()
          }
          context.restore()
        }
        draw('rgba(30,16,48,0.3)', 7.2, 0.7, 1)
        draw('#ffffff', 7.2)
        draw(css(color), 2.8)
        return canvas
      })
    }

    var sound = function (text, color, size) {
      var px = Math.max(12, Math.round(size))
      return cached('sound:' + text + ':' + color + ':' + px, function () {
        var font = popFont(px, fallbackFont)
        var stroke = px * 0.2
        var shadow = px * 0.09
        var width = Math.ceil(measure(text, font) + stroke * 2 + shadow + px * 0.2)
        var height = Math.ceil(px * 1.35 + stroke * 2 + shadow)
        var box = canvasOf(width, height)
        var canvas = box.canvas
        var context = box.context
        var x = width / 2 - shadow / 2
        var y = height / 2 - shadow / 2
        context.font = font
        context.textAlign = 'center'
        context.textBaseline = 'middle'
        context.lineJoin = 'round'
        // 硬阴影 → 白边 → 彩色字 → 字里一道浅色高光边。
        context.lineWidth = stroke * 2
        context.strokeStyle = 'rgba(43,31,61,0.9)'
        context.strokeText(text, x + shadow, y + shadow)
        context.strokeStyle = '#ffffff'
        context.strokeText(text, x, y)
        context.fillStyle = css(color)
        context.fillText(text, x, y)
        context.lineWidth = Math.max(1, px * 0.04)
        context.strokeStyle = 'rgba(43,31,61,0.85)'
        context.strokeText(text, x, y)
        return canvas
      })
    }

    var label = function (text, color, size) {
      var px = Math.max(10, Math.round(size))
      return cached('label:' + text + ':' + color + ':' + px, function () {
        var font = popFont(px, fallbackFont)
        var padX = px * 0.7
        var height = Math.ceil(px * 1.7)
        var width = Math.ceil(measure(text, font) + padX * 2)
        var box = canvasOf(width + 4, height + 4)
        var canvas = box.canvas
        var context = box.context
        context.fillStyle = 'rgba(43,31,61,0.85)'
        context.beginPath()
        context.roundRect(3, 3, width, height, height / 2)
        context.fill()
        context.fillStyle = '#ffffff'
        context.beginPath()
        context.roundRect(0, 0, width, height, height / 2)
        context.fill()
        context.fillStyle = css(color)
        context.beginPath()
        context.roundRect(2, 2, width - 4, height - 4, (height - 4) / 2)
        context.fill()
        context.font = font
        context.textAlign = 'center'
        context.textBaseline = 'middle'
        context.fillStyle = css(0x2b1f3d)
        context.fillText(text, width / 2, height * 0.54)
        return canvas
      })
    }

    return {
      sticker: sticker,
      tape: tape,
      pattern: pattern,
      strip: strip,
      scissors: scissors,
      echo: echo,
      sound: sound,
      icon: icon,
      label: label,
      destroy: function () {
        cache.forEach(function (texture) { texture.destroy(true) })
        cache.clear()
      }
    }
  }

  window.FoliaHanabiCollagePainters = {
    POP_FONT_FAMILIES: POP_FONT_FAMILIES,
    STICKER_PX: STICKER_PX,
    HANABI_ICONS: HANABI_ICONS,
    resolveBuiltinIconName: resolveBuiltinIconName,
    iconPath2d: iconPath2d,
    createCollageTextureCache: createCollageTextureCache
  }
})()
