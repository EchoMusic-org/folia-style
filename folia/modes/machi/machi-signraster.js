// 町景招牌共用 Canvas 2D 画法（移植自 engine/signRaster.ts）：
// 字体与测量、主题图标（线稿）、缩字与折行、歌词屏字面（上半张未唱、下半张已唱，关键词用自己的颜色）、
// LED 跑马灯的字条。各场景自己的招牌画法在场景文件里。
// 上游图标走 lucide 图标库；插件不引 lucide，内置常用图标的 24×24 线稿路径数据（与主题 icons 兜底一致）。
(function () {
  'use strict'

  /** 量字用的参考字号。 */
  var MACHI_REFERENCE_PX = 100

  // ===== 内置线稿图标（lucide 24×24 viewBox 的 path/圆弧数据，描边画法） =====
  // 每项是 [ { type:'path'|'circle', d?, cx?, cy?, r? } ]；插件主题无歌词图标，招牌统一回落到这里。
  var MACHI_ICONS = {
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

  var PATH_CACHE = new Map()

  /** 图标路径 → Path2D（缓存）。 */
  function iconPath2d(name) {
    if (!name) return null
    if (PATH_CACHE.has(name)) return PATH_CACHE.get(name)
    var shapes = MACHI_ICONS[name]
    if (!shapes) return null
    var into = new Path2D()
    shapes.forEach(function (shape) {
      if (shape.type === 'circle') {
        into.moveTo(shape.cx + shape.r, shape.cy)
        into.arc(shape.cx, shape.cy, shape.r, 0, Math.PI * 2)
      } else if (shape.d) {
        // Path2D 不能直接并 Path2D 的 d，这里重新构造（各形状独立描边即可）。
        var path = new Path2D(shape.d)
        into.addPath(path)
      }
    })
    PATH_CACHE.set(name, into)
    return into
  }

  function fontSpec(font, px) {
    return font.weight + ' ' + px.toFixed(1) + 'px ' + font.stack
  }

  var measureContext = null

  /** 按参考字号量字宽（缓存在这一个字体上）。 */
  function createMachiMeasure(font) {
    if (!measureContext) measureContext = document.createElement('canvas').getContext('2d')
    var cache = new Map()
    var spec = fontSpec(font, MACHI_REFERENCE_PX)
    return function (text) {
      if (!text) return 0
      var width = cache.get(text)
      if (width === undefined) {
        measureContext.font = spec
        width = measureContext.measureText(text).width
        if (cache.size > 4000) cache.clear()
        cache.set(text, width)
      }
      return width
    }
  }

  function createCanvas(width, height) {
    var canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    return canvas
  }

  function context2d(canvas) { return canvas.getContext('2d') }

  /** 一个主题图标，画成线稿（stroke），放在 (x, y) 起、边长 size 的方框里。 */
  function drawIcon(context, name, fallbacks, x, y, size, color, lineWidth) {
    lineWidth = lineWidth === undefined ? 2.2 : lineWidth
    var list = [name].concat(fallbacks || [])
    var node = null
    for (var i = 0; i < list.length && !node; i += 1) node = list[i] ? iconPath2d(list[i]) : null
    context.save()
    context.translate(x, y)
    context.scale(size / 24, size / 24)
    context.lineCap = 'round'
    context.lineJoin = 'round'
    context.strokeStyle = color
    context.lineWidth = lineWidth
    if (node) context.stroke(node)
    else {
      context.beginPath()
      context.arc(12, 12, 8, 0, Math.PI * 2)
      context.stroke()
    }
    context.restore()
  }

  /** 霓虹灯管写字（描边）：外面一圈光晕（同色），里面一道近白的芯。 */
  function strokeNeonText(context, text, x, y, color, glow) {
    context.shadowColor = color
    context.shadowBlur = glow
    context.strokeStyle = color
    context.lineWidth = glow * 0.45
    context.strokeText(text, x, y)
    context.shadowBlur = glow * 0.4
    context.strokeStyle = '#ffffff'
    context.lineWidth = glow * 0.14
    context.strokeText(text, x, y)
    context.shadowBlur = 0
  }

  /** 把一段字缩到 maxWidth 以内的字号。 */
  function fitFont(context, font, text, maxWidth, maxPx, minPx) {
    minPx = minPx === undefined ? 8 : minPx
    var px = maxPx
    context.font = fontSpec(font, px)
    var width = context.measureText(text).width
    if (width > maxWidth) px = Math.max(minPx, (px * maxWidth) / width)
    context.font = fontSpec(font, px)
    return px
  }

  /** 按宽度折行（中日韩逐字，拉丁按词），最多 maxLines 行，超出的末行加省略号。 */
  function wrapText(context, text, maxWidth, maxLines) {
    var unitRe = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]|[^\s\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]+\s*|\s+/gu
    var units = text.match(unitRe) || []
    var lines = []
    var current = ''
    units.forEach(function (unit) {
      var next = current + unit
      if (current && context.measureText(next.replace(/\s+$/, '')).width > maxWidth) {
        lines.push(current.replace(/\s+$/, ''))
        current = unit.replace(/^\s+/, '')
      } else current = next
    })
    if (current.trim()) lines.push(current.replace(/\s+$/, ''))
    if (lines.length > maxLines) {
      var kept = lines.slice(0, maxLines)
      var last = kept[maxLines - 1]
      while (last.length > 1 && context.measureText(last + '…').width > maxWidth) last = last.slice(0, -1)
      kept[maxLines - 1] = last + '…'
      return kept
    }
    return lines
  }

  /**
   * 广告屏字面：canvas 上半张是未唱的字，下半张是唱到的字（着色器按点亮位置在两者之间切）。
   * paint: { layout, font, unlit, lit, keywordRanges, card? }
   */
  function paintMachiBoard(canvas, paint) {
    var context = context2d(canvas)
    var half = canvas.height / 2
    context.clearRect(0, 0, canvas.width, canvas.height)
    context.textBaseline = 'middle'
    context.textAlign = 'left'
    var layout = paint.layout
    var font = paint.font
    var scaleY = half / layout.height
    var scaleX = canvas.width / layout.width
    layout.rows.forEach(function (row, rowIndex) {
      context.font = fontSpec(font, row.fontPx * scaleX)
      row.glyphs.forEach(function (glyph) {
        var x = glyph.x0 * scaleX
        var y = row.centerY * scaleY
        var keyword = null
        for (var i = 0; i < paint.keywordRanges.length; i += 1) {
          var range = paint.keywordRanges[i]
          if (glyph.offset >= range.startOffset && glyph.offset < range.endOffset) { keyword = range; break }
        }
        // 上半：未唱。
        context.fillStyle = paint.card && rowIndex === 0 ? paint.lit : paint.unlit
        context.fillText(glyph.text, x, y)
        // 下半：唱到的字。屏幕上的字是干净的像素，不画光晕。
        var color = paint.card ? (rowIndex === 0 ? paint.lit : paint.unlit) : (keyword ? keyword.color : paint.lit)
        context.fillStyle = color
        context.fillText(glyph.text, x, y + half)
      })
    })
  }

  /** LED 跑马灯的字条：黑底白字一长条。返回字条的实际宽度（像素）。 */
  function paintMachiLedStrip(canvas, font, text) {
    var context = context2d(canvas)
    var width = canvas.width
    var height = canvas.height
    context.fillStyle = '#000000'
    context.fillRect(0, 0, width, height)
    context.textBaseline = 'middle'
    context.textAlign = 'left'
    context.fillStyle = '#ffffff'
    var px = fitFont(context, font, text, width * 0.94, height * 0.78, height * 0.4)
    context.font = fontSpec(font, px)
    // 字条按自己的宽度循环：末尾留一段空白再接开头。
    var used = Math.min(width, context.measureText(text).width + height * 3)
    context.fillText(text, height * 1.5, height * 0.54)
    return used
  }

  window.FoliaMachiSignRaster = {
    MACHI_REFERENCE_PX: MACHI_REFERENCE_PX,
    MACHI_ICONS: MACHI_ICONS,
    fontSpec: fontSpec,
    createMachiMeasure: createMachiMeasure,
    createCanvas: createCanvas,
    context2d: context2d,
    drawIcon: drawIcon,
    strokeNeonText: strokeNeonText,
    fitFont: fitFont,
    wrapText: wrapText,
    paintMachiBoard: paintMachiBoard,
    paintMachiLedStrip: paintMachiLedStrip
  }
})()
