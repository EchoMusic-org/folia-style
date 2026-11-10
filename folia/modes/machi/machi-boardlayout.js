// 屋顶广告塔字面的排版与逐字点亮（移植自 engine/boardLayout.ts）：
// 把一行歌词按字面宽高排成 1–3 行（取字最大的那种，行数多了略扣分），记下每个字的 [x0, x1] 和它的唱起、
// 唱完时间；每帧按时间求每一行亮到哪个 x。字的时间来自 FoliaGraphemeTiming（parser 的逐词时间拆到字），
// 不靠字符串搜索猜。测量函数由调用方给。
(function () {
  'use strict'

  var Timing = window.FoliaGraphemeTiming

  var MAX_ROWS = 3
  /** 一行字高占字面高的上限（单行时字也不会顶满）。 */
  var SINGLE_ROW_FILL = 0.56
  var LINE_GAP = 1.22
  /** 行数多了略扣分：同样大的字，少一行更好读。 */
  var ROW_PENALTY = [1, 0.94, 0.84]

  var CJK_PATTERN = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u
  /** 不该出现在行首的标点：并到前一个字上。 */
  var STICKY_PUNCTUATION = /^[，。、！？；：,.!?;:」』）)\]】〉》…~～ー]+$/u

  /** 一行歌词 → 断行单位：中日韩字一个字一个单位，拉丁词连同后面的空格一个单位，行首禁则标点并到前面。 */
  function tokenize(line) {
    var timeline = Timing.buildLineGraphemeTimeline(line)
    var tokens = []
    var current = null
    var offset = 0
    timeline.forEach(function (entry) {
      var glyph = { text: entry.char, offset: offset, startTime: entry.startTime, endTime: entry.endTime }
      offset += entry.char.length
      var isSpace = /^\s+$/u.test(entry.char)
      var isCjk = CJK_PATTERN.test(entry.char)
      if (STICKY_PUNCTUATION.test(entry.char) && tokens.length > 0 && !current) {
        tokens[tokens.length - 1].glyphs.push(glyph)
        return
      }
      if (isCjk) {
        if (current) tokens.push(current)
        current = null
        tokens.push({ glyphs: [glyph] })
        return
      }
      if (!current) current = { glyphs: [] }
      current.glyphs.push(glyph)
      if (isSpace) {
        tokens.push(current)
        current = null
      }
    })
    if (current) tokens.push(current)
    return tokens.filter(function (token) { return token.glyphs.length > 0 })
  }

  function tokenText(token) {
    return token.glyphs.map(function (glyph) { return glyph.text }).join('')
  }

  /** 去掉行尾空格后的宽度（行尾空格不占排版）。 */
  function rowWidth(tokens, measure) {
    return measure(tokens.map(tokenText).join('').replace(/\s+$/, ''))
  }

  /** 把单位分成 rows 行，尽量等宽（贪心：每行装到接近总宽 / 行数）。 */
  function splitRows(tokens, rows, measure) {
    if (rows <= 1 || tokens.length <= 1) return [tokens]
    var total = rowWidth(tokens, measure)
    var target = total / rows
    var result = []
    var current = []
    tokens.forEach(function (token, index) {
      var remainingRows = rows - result.length
      var remainingTokens = tokens.length - index
      var next = current.concat([token])
      if (current.length > 0 && remainingRows > 1 && rowWidth(next, measure) > target * 1.04 && remainingTokens >= remainingRows - 1) {
        // 放进去超了：看放不放这一个更接近目标。
        var without = rowWidth(current, measure)
        var withIt = rowWidth(next, measure)
        if (Math.abs(withIt - target) < Math.abs(without - target) && remainingTokens > remainingRows - 1) {
          result.push(next)
          current = []
          return
        }
        result.push(current)
        current = [token]
        return
      }
      current = next
    })
    if (current.length > 0) result.push(current)
    return result
  }

  /** 一行歌词在字面上的排版：1–3 行里挑字最大的（行数多扣分）。 */
  function layoutMachiBoardLine(line, box, measure) {
    var tokens = tokenize(line)
    var usableWidth = box.width * (1 - box.paddingX * 2)
    var best = null
    for (var rows = 1; rows <= MAX_ROWS; rows += 1) {
      if (rows > tokens.length) break
      var split = splitRows(tokens, rows, measure)
      var widest = 1
      split.forEach(function (row) { widest = Math.max(widest, rowWidth(row, measure)) })
      var byWidth = (usableWidth / widest) * box.referencePx
      var byHeight = rows === 1 ? box.height * SINGLE_ROW_FILL : box.height * 0.86 / (split.length * LINE_GAP)
      var fontPx = Math.min(byWidth, byHeight)
      var score = fontPx * ROW_PENALTY[split.length - 1]
      if (!best || score > best.score) best = { rows: split, fontPx: fontPx, score: score }
    }
    if (!best) return { fontPx: box.height * 0.4, rows: [], width: box.width, height: box.height }
    return placeRows(best.rows, best.fontPx, box, measure)
  }

  /** 按字号把各行居中摆好，量出每个字的 x 区间。 */
  function placeRows(rows, fontPx, box, measure) {
    var scale = fontPx / box.referencePx
    var lineHeight = fontPx * LINE_GAP
    var blockHeight = lineHeight * rows.length
    var firstCenter = box.height / 2 - blockHeight / 2 + lineHeight / 2
    return {
      fontPx: fontPx,
      width: box.width,
      height: box.height,
      rows: rows.map(function (tokens, rowIndex) {
        var glyphs = []
        tokens.forEach(function (token) { token.glyphs.forEach(function (glyph) { glyphs.push(glyph) }) })
        var text = glyphs.map(function (glyph) { return glyph.text }).join('')
        var width = measure(text.replace(/\s+$/, '')) * scale
        var left = (box.width - width) / 2
        var prefix = ''
        var placed = glyphs.map(function (glyph) {
          var x0 = left + measure(prefix) * scale
          prefix += glyph.text
          var x1 = left + measure(prefix) * scale
          return { text: glyph.text, offset: glyph.offset, length: glyph.text.length, x0: x0, x1: x1, startTime: glyph.startTime, endTime: glyph.endTime }
        })
        var centerY = firstCenter + rowIndex * lineHeight
        return { glyphs: placed, fontPx: fontPx, centerY: centerY, top: centerY - lineHeight / 2, bottom: centerY + lineHeight / 2 }
      })
    }
  }

  /** 曲名卡（间奏、纯音乐、没开显示歌词时）：主标题一行（放不下缩字），副标题小一号。 */
  function layoutMachiBoardCard(title, subtitle, box, measure) {
    var usableWidth = box.width * (1 - box.paddingX * 2)
    var titleFont = Math.min(box.height * (subtitle ? 0.4 : 0.5), (usableWidth / Math.max(1, measure(title))) * box.referencePx)
    var subtitleFont = subtitle ? Math.min(titleFont * 0.52, (usableWidth / Math.max(1, measure(subtitle))) * box.referencePx) : 0
    var rows = []
    var totalHeight = titleFont * 1.15 + (subtitle ? subtitleFont * 1.4 : 0)
    var y = box.height / 2 - totalHeight / 2
    var addRow = function (text, fontPx) {
      var scale = fontPx / box.referencePx
      var width = measure(text) * scale
      var left = (box.width - width) / 2
      var height = fontPx * (rows.length === 0 ? 1.15 : 1.4)
      var centerY = y + height / 2
      rows.push({
        glyphs: [{ text: text, offset: 0, length: text.length, x0: left, x1: left + width, startTime: -Infinity, endTime: -Infinity }],
        fontPx: fontPx,
        centerY: centerY,
        top: y,
        bottom: y + height
      })
      y += height
    }
    addRow(title, titleFont)
    if (subtitle) addRow(subtitle, subtitleFont)
    return { fontPx: titleFont, rows: rows, width: box.width, height: box.height }
  }

  /**
   * 时刻 time 每一行亮到的 x（像素）。字在 [startTime, endTime] 里从左往右扫亮，唱完的字全亮；
   * 一行里按字的顺序走，遇到还没开始的字就停。结果对时间单调不减。
   */
  function resolveMachiBoardReveal(layout, time) {
    return layout.rows.map(function (row) {
      var lit = row.glyphs.length ? row.glyphs[0].x0 : 0
      for (var i = 0; i < row.glyphs.length; i += 1) {
        var glyph = row.glyphs[i]
        if (time >= glyph.endTime) { lit = glyph.x1; continue }
        if (time > glyph.startTime) {
          var span = Math.max(0.001, glyph.endTime - glyph.startTime)
          lit = glyph.x0 + (glyph.x1 - glyph.x0) * Math.min(1, (time - glyph.startTime) / span)
        }
        break
      }
      return lit
    })
  }

  window.FoliaMachiBoardLayout = {
    layoutMachiBoardLine: layoutMachiBoardLine,
    layoutMachiBoardCard: layoutMachiBoardCard,
    resolveMachiBoardReveal: resolveMachiBoardReveal,
    MAX_ROWS: MAX_ROWS,
    LINE_GAP: LINE_GAP
  }
})()
