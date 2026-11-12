// 花火（hanabi）排版：移植自 folia-major src/components/visualizer/hanabi/text/layout.ts
// 排版（纯函数）：把逐字（字宽、所属词、词的字号倍率）按 9 种排法排进文字区，原点 = 文字区中心。
// 超出文字区时先折行 / 换列，再整体缩小；竖排时拉丁字母侧转、中日文直立。
// 9 种排法（TextLayout）：center 居中一行 / left 左对齐 / right 右对齐 / stagger 按词错落 2–3 行（左右交替缩进）/
//   diagonal 整行沿对角线倾斜 / scatter 词块散落 / vertical 竖排（从右到左换列）/ vertical-split 竖排词块左右两列交错 / arc 沿拱起的弧线。
// 输入形状（上游接口）：
//   LayoutGlyphInput = { char, advance（字宽，字号的倍数）, blank（空白：不画、不占包围盒）, upright（竖排时直立）, word }
//   LayoutWordInput  = { start, end（字区间 [start, end)）, blank（不是实词：标点、符号、空白）, space（全是空白）, scale（字号倍率）}
//   LayoutParams     = { layout, regionWidth, regionHeight, fontPx（主字号，像素）, tilt（整组倾斜，弧度）, seed,
//     tracking（字距，字号的倍数）, wordGap（相邻实词之间额外的间隔，主字号的倍数）, lineHeight（行距，行内最大字号的倍数）,
//     minAdvance（横排时每个字至少占多宽，字号的倍数）, stairStep（阶梯：词内逐字抬高，字号的倍数）, padding（色块 / 阴影边距，字号的倍数）}
//   PlacedGlyph      = { char, x, y, size（字号，已含词的倍率与整体缩放）, advance（沿行方向占的长度）, angle（行在这个字处的前进方向，弧度）,
//     rotation（字本身的转角）, boxW, boxH（在字自身转角坐标系里的字框）, row（所在的行 / 列 / 词块）, word, blank }
//   TextPlacement    = { glyphs, rows（行（横排）/ 列（竖排）/ 词块（scatter、vertical-split）的字下标串）, fontPx（缩放后的主字号）,
//     fit（为放进文字区整体缩小的倍率 ≤ 1）, bounds（静止时的包围盒，含边距）, vertical }
(function () {
  'use strict'

  var SeedHash = window.FoliaSeedHash
  // 确定性随机流；hanabi-core 未加载时退回 seed-hash 的同一条流，保证本文件可独立加载。
  var createRng = window.FoliaHanabiCore && window.FoliaHanabiCore.createRng ? window.FoliaHanabiCore.createRng : SeedHash.createVisualizerRng

  // ─── 词的字号 ──────────────────────────────────────────────────────────

  var FUNCTION_WORDS = new Set(Array.from('的了在把是我你他她它们和与也就都着过吗呢吧啊呀哦被让给从向到这那之而又很のはがをにでともへやねよかな'))
  var MINOR_LATIN = new Set(['a', 'an', 'the', 'of', 'to', 'in', 'on', 'at', 'me', 'my', 'with', 'and', 'or', 'is', 'i', 'you', 'it', 'by', 'for'])

  /**
   * 每个词的字号倍率：重点词（最长的实词，一样长取靠后的）放大到 1 + 0.8 × emphasis，
   * 虚词缩小，标点小一号，其余按种子小幅浮动。
   */
  function wordScales(words, emphasis, seed) {
    var rng = createRng(seed + ':word-scale')
    var e = Math.max(0, Math.min(1, emphasis))
    var lengthOf = function (text) { return Array.from(text).length }
    var minor = function (word) {
      return word.blank
        || (lengthOf(word.text) === 1 && FUNCTION_WORDS.has(word.text))
        || MINOR_LATIN.has(word.text.toLowerCase())
    }
    var key = -1
    words.forEach(function (word, index) {
      if (minor(word)) return
      if (key < 0 || lengthOf(word.text) >= lengthOf(words[key].text)) key = index
    })
    var solid = words.filter(function (word) { return !word.blank }).length
    return words.map(function (word, index) {
      var jitter = rng()
      if (word.space) return 1
      if (word.blank) return 1 - 0.2 * e
      if (solid <= 1) return 1
      if (index === key) return 1 + 0.8 * e
      if (minor(word)) return Math.max(0.6, 1 - 0.32 * e)
      return 1 + (jitter - 0.5) * 0.45 * e
    })
  }

  // ─── 排版 ──────────────────────────────────────────────────────────────

  /** 竖排时即便属于中日文区也要侧转的符号（长音、破折号、省略号、波浪线）。 */
  var ROTATE_IN_VERTICAL = new Set(Array.from('ー—―─～〜…‥－-_=~'))

  // 块形状（Unit）：{ glyphs（字的下标，按顺序，含空白）, space（全是空白）, length（沿行方向的长度，像素，不含词间隔）, thickness（最大字号）}
  // 工作记录形状（Work）：{ x, y, size, advance, angle, rotation, boxW, boxH, row }

  function rotate(x, y, angle) {
    var c = Math.cos(angle)
    var s = Math.sin(angle)
    return { x: x * c - y * s, y: x * s + y * c }
  }

  /** 把词切成不可拆分的块：标点粘在前一个词上（行首不放标点）。 */
  function buildUnits(glyphs, words) {
    var units = []
    words.forEach(function (word, index) {
      if (word.end <= word.start) return
      var last = units[units.length - 1]
      if (word.blank && !word.space && last && !last.space) {
        last.words.push(index)
        return
      }
      units.push({ words: [index], space: word.space })
    })
    // 行首的标点：并进后一个块。
    if (units.length > 1 && !units[0].space && units[0].words.every(function (index) { return words[index].blank })) {
      var first = units.shift()
      var merged = first.words
      merged.forEach(function (index) { units[0].words.push(index) })
      units[0].space = false
    }
    return units.map(function (unit) {
      var indices = []
      unit.words.forEach(function (index) {
        for (var g = words[index].start; g < words[index].end; g += 1) if (g < glyphs.length) indices.push(g)
      })
      return { glyphs: indices, space: unit.space }
    })
  }

  /**
   * 把一串长度按顺序分成 k 段，使最长的一段最短（动态规划，块数很少）。
   * gaps[i] = 第 i 块与前一块在同一段里时多出的间隔；空白块在段首段尾不计长度。
   * breakPenalty：在第 i 块前断开的代价（像素，加在新一段的长度上；假名开头的块不宜放在行首）。
   */
  function partitionRuns(units, gaps, k, breakPenalty) {
    var n = units.length
    if (n === 0) return []
    var solidCount = 0
    units.forEach(function (unit) { if (!unit.space) solidCount += 1 })
    var parts = Math.max(1, Math.min(k, solidCount || 1))
    var spanLength = function (from, to) {
      var a = from
      var b = to
      while (a <= b && units[a].space) a += 1
      while (b >= a && units[b].space) b -= 1
      var total = 0
      for (var i = a; i <= b; i += 1) total += units[i].length + (i > a ? gaps[i] : 0)
      return total
    }
    var INF = Number.POSITIVE_INFINITY
    var best = []
    var cut = []
    for (var row = 0; row <= parts; row += 1) {
      best.push(new Array(n + 1).fill(INF))
      cut.push(new Array(n + 1).fill(0))
    }
    best[0][0] = 0
    for (var p = 1; p <= parts; p += 1) {
      for (var j = 1; j <= n; j += 1) {
        for (var i = p - 1; i < j; i += 1) {
          if (best[p - 1][i] === INF) continue
          // 一段里至少有一个实块。
          var solid = false
          for (var u = i; u < j; u += 1) if (!units[u].space) solid = true
          if (!solid) continue
          var penalty = 0
          if (i > 0) penalty = breakPenalty && breakPenalty[i] !== undefined ? breakPenalty[i] : 0
          var value = Math.max(best[p - 1][i], spanLength(i, j - 1) + penalty)
          if (value < best[p][j] - 1e-9) {
            best[p][j] = value
            cut[p][j] = i
          }
        }
      }
    }
    var pp = parts
    while (pp > 1 && best[pp][n] === INF) pp -= 1
    var runs = []
    var jj = n
    for (var q = pp; q >= 1; q -= 1) {
      var ii = cut[q][jj]
      var run = []
      for (var offset = 0; offset < jj - ii; offset += 1) run.push(ii + offset)
      runs.unshift(run)
      jj = ii
    }
    return runs
  }

  function layoutText(glyphInputs, words, params) {
    var layout = params.layout
    var W = params.regionWidth
    var H = params.regionHeight
    var fontPx = params.fontPx
    var rng = createRng(params.seed + ':layout')
    var vertical = layout === 'vertical' || layout === 'vertical-split'
    var count = glyphInputs.length
    var sizes = glyphInputs.map(function (glyph) {
      var word = words[glyph.word]
      return fontPx * (word && word.scale !== undefined && word.scale !== null ? word.scale : 1)
    })
    var turned = glyphInputs.map(function (glyph) { return vertical && (!glyph.upright || ROTATE_IN_VERTICAL.has(glyph.char)) })
    // 沿行方向的长度。
    var along = glyphInputs.map(function (glyph, index) {
      var size = sizes[index]
      if (glyph.blank) return glyph.advance * size
      if (vertical && !turned[index]) return size * (1 + params.tracking * 0.6)
      return (Math.max(glyph.advance, vertical ? 0 : params.minAdvance) + params.tracking) * size
    })
    var work = glyphInputs.map(function (_, index) {
      return { x: 0, y: 0, size: sizes[index], advance: along[index], angle: 0, rotation: 0, boxW: 0, boxH: 0, row: 0 }
    })
    var unitList = buildUnits(glyphInputs, words)
    var units = unitList.map(function (unit) {
      var sumLength = 0
      unit.glyphs.forEach(function (index) { sumLength += along[index] })
      var thickness = unit.glyphs.reduce(function (max, index) {
        return glyphInputs[index].blank ? max : Math.max(max, sizes[index])
      }, 0) || fontPx
      return { glyphs: unit.glyphs, space: unit.space, length: sumLength, thickness: thickness }
    })
    var gaps = units.map(function (unit, index) {
      return index > 0 && !unit.space && !units[index - 1].space ? params.wordGap * fontPx : 0
    })
    // 假名、长音、标点开头的块尽量不放在行首（「終|わり」这种断法）。
    var penalties = units.map(function (unit) {
      var first = unit.glyphs.length > 0 && glyphInputs[unit.glyphs[0]] ? glyphInputs[unit.glyphs[0]].char : ''
      return /^[぀-ゟ゠-ヿー、。，．！？]/.test(first) ? fontPx * 1.2 : 0
    })
    var rows = []

    /** 在行坐标系里排一段：s = 沿行位置（从 0 起），n = 法向偏移（向「下」为正）。返回长度。 */
    var flow = function (unitIndices, rowIndex, place) {
      var a = 0
      var b = unitIndices.length - 1
      while (a <= b && units[unitIndices[a]].space) a += 1
      while (b >= a && units[unitIndices[b]].space) b -= 1
      var thick = unitIndices.reduce(function (max, u) {
        return Math.max(max, units[u].space ? 0 : units[u].thickness)
      }, 0) || fontPx
      var s = 0
      var members = []
      for (var k = 0; k < unitIndices.length; k += 1) {
        var unit = units[unitIndices[k]]
        var outside = k < a || k > b
        if (k > a && k <= b) s += gaps[unitIndices[k]]
        var wordStart = -1
        var stepIndex = 0
        unit.glyphs.forEach(function (glyph) {
          var size = sizes[glyph]
          var advance = outside ? 0 : along[glyph]
          var word = glyphInputs[glyph].word
          if (word !== wordStart) {
            wordStart = word
            stepIndex = 0
          }
          // 横排按底边对齐（小字往下沉），竖排居中；阶梯在词内逐字抬高。
          var settle = vertical ? 0 : (thick - size) * 0.42
          var stair = glyphInputs[glyph].blank ? 0 : -params.stairStep * size * (stepIndex % 3)
          if (!glyphInputs[glyph].blank) stepIndex += 1
          work[glyph].row = rowIndex
          work[glyph].advance = advance
          place(glyph, s + advance / 2, settle + stair)
          s += advance
          members.push(glyph)
        })
      }
      rows[rowIndex] = members
      return { length: s, thickness: thick }
    }

    var runLength = function (unitIndices) {
      var a = 0
      var b = unitIndices.length - 1
      while (a <= b && units[unitIndices[a]].space) a += 1
      while (b >= a && units[unitIndices[b]].space) b -= 1
      var total = 0
      for (var k = a; k <= b; k += 1) total += units[unitIndices[k]].length + (k > a ? gaps[unitIndices[k]] : 0)
      return total
    }
    var runThickness = function (unitIndices) {
      return unitIndices.reduce(function (max, u) {
        return Math.max(max, units[u].space ? 0 : units[u].thickness)
      }, 0) || fontPx
    }

    /** 选行数：在 [kMin, kMax] 里取能放得最大（缩得最少）的，差不多时取行少的。 */
    var chooseRuns = function (kMin, kMax, main, cross, pitch) {
      var bestRuns = []
      var bestFit = -1
      for (var k = kMin; k <= kMax; k += 1) {
        var runs = partitionRuns(units, gaps, k, penalties)
        if (runs.length < Math.min(k, kMin)) continue
        var longest = 1
        runs.forEach(function (run) { longest = Math.max(longest, runLength(run)) })
        var across = runs.reduce(function (sum, run) { return sum + runThickness(run) * pitch }, 0)
        var fit = Math.min(1, main / longest, cross / across)
        if (fit > bestFit * 1.08 || bestRuns.length === 0) {
          bestFit = fit
          bestRuns = runs
        }
        if (fit >= 1) break
      }
      return bestRuns
    }

    var solidUnits = units.filter(function (unit) { return !unit.space }).length
    /** 自由摆放（scatter / vertical-split）的块：单个假名粘到前一块上（「咲|い|た」→「咲いた」），块不超过 5 个字。 */
    var chunkUnits = function () {
      var chunks = []
      units.forEach(function (unit, index) {
        if (unit.space) return
        var last = chunks[chunks.length - 1]
        var text = unit.glyphs.map(function (glyph) { return glyphInputs[glyph].char }).join('')
        var kana = unit.glyphs.length === 1 && /^[぀-ゟ゠-ヿー]$/.test(text)
        var lastLength = last ? last.reduce(function (sum, u) { return sum + units[u].glyphs.length }, 0) : 0
        if (last && kana && lastLength < 5) last.push(index)
        else chunks.push([index])
      })
      return chunks
    }
    var placeStraight = function (glyph, x, y, rowIndex) {
      var w = work[glyph]
      w.x = x
      w.y = y
      w.row = rowIndex
    }

    switch (layout) {
      case 'center':
      case 'left':
      case 'right':
      case 'stagger':
      case 'diagonal': {
        var kMin = 1
        var kMax = layout === 'diagonal' ? 2 : 3
        if (layout === 'stagger') {
          kMin = Math.min(solidUnits, solidUnits >= 5 ? 3 : 2)
          kMax = Math.min(solidUnits, 3)
          kMin = Math.max(1, kMin)
          kMax = Math.max(kMin, kMax)
        }
        var slope = layout === 'diagonal' ? -Math.min(0.42, Math.max(0.2, Math.atan2(H * 0.7, W))) : 0
        var runs = chooseRuns(kMin, kMax, layout === 'diagonal' ? W * 0.95 : W, H, params.lineHeight)
        var pitchFactor = layout === 'stagger' ? params.lineHeight * 0.94 : params.lineHeight
        var cursorY = 0
        var lengths = runs.map(runLength)
        var longest = 1
        lengths.forEach(function (length) { longest = Math.max(longest, length) })
        var staggerAmp = fontPx * (0.9 + rng() * 0.6)
        runs.forEach(function (run, rowIndex) {
          var thick = runThickness(run)
          if (rowIndex > 0) cursorY += thick * pitchFactor * 0.5
          var L = lengths[rowIndex]
          var x0
          if (layout === 'left') x0 = 0
          else if (layout === 'right') x0 = -L
          else if (layout === 'stagger') {
            var room = Math.max(0, (longest - L) / 2)
            var side = rowIndex % 2 === 0 ? -1 : 1
            x0 = -L / 2 + side * Math.max(staggerAmp, room * 0.9) * (runs.length === 1 ? 0 : 1)
          } else x0 = -L / 2
          var rowY = cursorY
          flow(run, rowIndex, function (glyph, s, n) {
            if (layout === 'diagonal') {
              var x = x0 + s
              placeStraight(glyph, x, rowY + n + (x - (x0 + L / 2)) * Math.tan(slope), rowIndex)
              var w = work[glyph]
              // 字直立、水平间距不变，沿斜线的长度要除以 cos。
              w.advance /= Math.cos(slope)
              w.angle = slope
              w.rotation = slope * 0.3
            } else placeStraight(glyph, x0 + s, rowY + n, rowIndex)
          })
          cursorY += thick * pitchFactor * 0.5
        })
        break
      }
      case 'arc': {
        var runsArc = chooseRuns(1, 2, W * 0.95, H, params.lineHeight)
        var lengthsArc = runsArc.map(runLength)
        var longestArc = 1
        lengthsArc.forEach(function (length) { longestArc = Math.max(longestArc, length) })
        var radius0 = Math.max(longestArc / 1.3, W * 0.62)
        var depth = 0
        runsArc.forEach(function (run, rowIndex) {
          var thick = runThickness(run)
          if (rowIndex > 0) depth += thick * params.lineHeight * 0.5
          var R = Math.max(radius0 - depth, longestArc / 2.6)
          var L = lengthsArc[rowIndex]
          var centerY = radius0
          flow(run, rowIndex, function (glyph, s, n) {
            var a = (s - L / 2) / R
            var r = R - n
            var w = work[glyph]
            w.x = r * Math.sin(a)
            w.y = centerY - r * Math.cos(a)
            w.angle = a
            w.rotation = a
          })
          depth += thick * params.lineHeight * 0.5
        })
        break
      }
      case 'vertical': {
        var runsV = chooseRuns(1, 4, H, W, params.lineHeight)
        var cursorX = 0
        runsV.forEach(function (run, colIndex) {
          var thick = runThickness(run)
          if (colIndex > 0) cursorX -= thick * params.lineHeight * 0.5
          var colX = cursorX
          flow(run, colIndex, function (glyph, s, n) {
            var w = work[glyph]
            w.x = colX - n
            w.y = s
            w.angle = Math.PI / 2
            w.rotation = turned[glyph] ? Math.PI / 2 : 0
          })
          cursorX -= thick * params.lineHeight * 0.5
        })
        break
      }
      case 'vertical-split': {
        // 块交替落在右 / 左两列（右列先），纵向互相咬合；太长时分成几组两列，从右往左排。
        var chunks = chunkUnits()
        var lengthsVS = chunks.map(runLength)
        var estimate = function (groups) {
          var per = Math.ceil(chunks.length / groups)
          var worst = 1
          for (var gi = 0; gi < groups; gi += 1) {
            var total = 0
            for (var li = gi * per; li < Math.min((gi + 1) * per, lengthsVS.length); li += 1) total += lengthsVS[li] * 0.6
            worst = Math.max(worst, total)
          }
          return worst
        }
        var groups = 1
        while (groups < 3 && estimate(groups) > H && chunks.length > groups * 2) groups += 1
        var per = Math.ceil(chunks.length / groups) || 1
        var cursorXVS = 0
        var runIndex = 0
        for (var g = 0; g < groups; g += 1) {
          var members = chunks.slice(g * per, (g + 1) * per)
          var memberLengths = lengthsVS.slice(g * per, (g + 1) * per)
          if (members.length === 0) continue
          var thick = members.reduce(function (max, chunk) { return Math.max(max, runThickness(chunk)) }, 0)
          var pitch = thick * params.lineHeight
          if (g > 0) cursorXVS -= pitch * 1.1
          var tops = []
          var ends = []
          members.forEach(function (chunk, k) {
            var side = k % 2 === 0 ? 0.5 : -0.5
            var top = 0
            if (k >= 1) top = Math.max(top, tops[k - 1] + memberLengths[k - 1] * 0.5)
            if (k >= 2) top = Math.max(top, ends[k - 2] + fontPx * 0.2)
            tops.push(top)
            ends.push(top + memberLengths[k])
            var colX = cursorXVS + side * pitch * (members.length > 1 ? 1 : 0) - pitch * 0.5
            flow(chunk, runIndex, function (glyph, s, n) {
              var w = work[glyph]
              w.x = colX - n
              w.y = top + s
              w.angle = Math.PI / 2
              w.rotation = turned[glyph] ? Math.PI / 2 : 0
            })
            runIndex += 1
          })
          cursorXVS -= pitch
        }
        break
      }
      case 'scatter': {
        // 词块大小不一、散落在文字区里，但保持阅读顺序：先把词块（单个假名粘到前一块上）分成几行，
        // 行内随机间隔、上下随机错开、各自微微倾斜；行距留够错开的余量，所以天然不重叠。
        var chunksSc = chunkUnits()
        var pad = params.padding * fontPx
        var extra = chunksSc.map(function () { return 0.8 + rng() * 0.5 })
        var rotations = chunksSc.map(function () { return (rng() - 0.5) * 0.16 })
        var gapsAfter = chunksSc.map(function () { return fontPx * (0.35 + rng() * 0.8) })
        var jitterRand = chunksSc.map(function () { return rng() * 2 - 1 })
        var dims = chunksSc.map(function (chunk, k) {
          var w = runLength(chunk) * extra[k] + pad * 2
          var h = runThickness(chunk) * extra[k] * (1.12 + params.stairStep * 4) + pad * 2
          var c = Math.abs(Math.cos(rotations[k]))
          var s = Math.abs(Math.sin(rotations[k]))
          return { w: w, h: h, aabbW: w * c + h * s, aabbH: w * s + h * c }
        })
        var nSc = chunksSc.length
        var bestRows = []
        var bestScore = -Infinity
        for (var r = 1; r <= Math.min(4, nSc); r += 1) {
          var rowsOf = partitionRuns(
            dims.map(function (d) { return { length: d.aabbW, space: false } }),
            dims.map(function (_, k) { return k > 0 ? gapsAfter[k - 1] : 0 }),
            r,
          )
          var widths = rowsOf.map(function (row) {
            return row.reduce(function (sum, k, i) { return sum + dims[k].aabbW + (i > 0 ? gapsAfter[k - 1] : 0) }, 0)
          })
          var heights = rowsOf.map(function (row) {
            var maxH = 0
            row.forEach(function (k) { maxH = Math.max(maxH, dims[k].aabbH) })
            return maxH * 1.5
          })
          var maxWidth = 1
          widths.forEach(function (width) { maxWidth = Math.max(maxWidth, width) })
          var fit = Math.min(1, W / maxWidth, H / heights.reduce(function (sum, h) { return sum + h }, 0))
          // 至少三块时偏向多行（散开的感觉）。
          var score = fit + (nSc >= 3 && rowsOf.length >= 2 ? 0.08 : 0) + (rowsOf.length === Math.min(3, nSc) ? 0.04 : 0)
          if (score > bestScore) {
            bestScore = score
            bestRows = rowsOf
          }
        }
        var rowHeights = bestRows.map(function (row) {
          var maxH = 0
          row.forEach(function (k) { maxH = Math.max(maxH, dims[k].aabbH) })
          return maxH
        })
        var widthsSc = bestRows.map(function (row) {
          return row.reduce(function (sum, k, i) { return sum + dims[k].aabbW + (i > 0 ? gapsAfter[k - 1] : 0) }, 0)
        })
        var widest = 1
        widthsSc.forEach(function (width) { widest = Math.max(widest, width) })
        var cursorYSc = 0
        bestRows.forEach(function (row, r) {
          var rowH = rowHeights[r]
          var jitter = rowH * 0.22
          if (r > 0) cursorYSc += rowHeights[r - 1] / 2 + rowH / 2 + (rowHeights[r - 1] * 0.22 + jitter) + fontPx * 0.1
          var slack = Math.max(0, widest - widthsSc[r])
          var cursorXSc = -widthsSc[r] / 2 + (rng() - 0.5) * (slack + fontPx * 1.2) * (bestRows.length > 1 ? 1 : 0)
          row.forEach(function (k, i) {
            if (i > 0) cursorXSc += gapsAfter[k - 1]
            var d = dims[k]
            var cx = cursorXSc + d.aabbW / 2
            var cy = cursorYSc + jitterRand[k] * (jitter + (rowH - d.aabbH) * 0.5)
            cursorXSc += d.aabbW
            var chunk = chunksSc[k]
            var L = runLength(chunk) * extra[k]
            var angle = rotations[k]
            flow(chunk, k, function (glyph, s, nOffset) {
              var w = work[glyph]
              var local = rotate(s * extra[k] - L / 2, nOffset * extra[k], angle)
              w.x = cx + local.x
              w.y = cy + local.y
              w.angle = angle
              w.rotation = angle
              w.size = sizes[glyph] * extra[k]
              w.advance *= extra[k]
            })
          })
        })
        break
      }
    }
    if (layout === 'scatter' || layout === 'vertical-split') {
      // 空白字（词块之外的空格）落在前一个字的位置，不占地方。
      units.forEach(function (unit) {
        if (!unit.space) return
        unit.glyphs.forEach(function (glyph) {
          var prev = work[Math.max(0, glyph - 1)]
          var w = work[glyph]
          w.x = prev.x
          w.y = prev.y
          w.angle = prev.angle
          w.rotation = prev.rotation
          w.advance = 0
          w.row = prev.row
        })
      })
    }

    // 字框（在字自身转角坐标系里）：横向 = 沿行长度，纵向 = 字号。竖排直立字的行方向在纵向。
    work.forEach(function (w, index) {
      var verticalUpright = vertical && !turned[index]
      w.boxW = verticalUpright ? w.size * 1.12 : Math.max(w.advance, 0.01)
      w.boxH = verticalUpright ? Math.max(w.advance, 0.01) : w.size * 1.12
      if (layout === 'diagonal') {
        // 斜排的字基本直立：字框取水平宽度。
        w.boxW = Math.max(w.advance * Math.cos(w.angle), 0.01)
      }
    })

    // 整组倾斜。
    if (params.tilt) {
      work.forEach(function (w) {
        var p = rotate(w.x, w.y, params.tilt)
        w.x = p.x
        w.y = p.y
        w.angle += params.tilt
        w.rotation += params.tilt
      })
    }

    var measure = function () {
      var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
      work.forEach(function (w, index) {
        if (glyphInputs[index].blank) return
        var pad = params.padding * w.size
        var hw = w.boxW / 2 + pad
        var hh = w.boxH / 2 + pad
        var c = Math.abs(Math.cos(w.rotation))
        var s = Math.abs(Math.sin(w.rotation))
        var ex = hw * c + hh * s
        var ey = hw * s + hh * c
        minX = Math.min(minX, w.x - ex)
        maxX = Math.max(maxX, w.x + ex)
        minY = Math.min(minY, w.y - ey)
        maxY = Math.max(maxY, w.y + ey)
      })
      if (!Number.isFinite(minX)) return { minX: 0, minY: 0, maxX: 0, maxY: 0 }
      return { minX: minX, minY: minY, maxX: maxX, maxY: maxY }
    }

    var box = measure()
    var fit = Math.min(1, W / Math.max(1e-6, box.maxX - box.minX), H / Math.max(1e-6, box.maxY - box.minY))
    if (fit < 1) {
      work.forEach(function (w) {
        w.x *= fit
        w.y *= fit
        w.size *= fit
        w.advance *= fit
        w.boxW *= fit
        w.boxH *= fit
      })
      box = measure()
    }
    // 对齐：left / right 贴文字区边缘，其余居中。
    var shiftX = layout === 'left' ? -W / 2 - box.minX : layout === 'right' ? W / 2 - box.maxX : -(box.minX + box.maxX) / 2
    var shiftY = -(box.minY + box.maxY) / 2
    work.forEach(function (w) {
      w.x += shiftX
      w.y += shiftY
    })

    var placed = work.map(function (w, index) {
      return {
        char: glyphInputs[index].char,
        x: w.x,
        y: w.y,
        size: w.size,
        advance: w.advance,
        angle: w.angle,
        rotation: w.rotation,
        boxW: w.boxW,
        boxH: w.boxH,
        row: w.row,
        word: glyphInputs[index].word,
        blank: glyphInputs[index].blank,
      }
    })
    return {
      glyphs: placed,
      rows: rows.filter(Boolean).map(function (run) { return run.filter(function (index) { return index < count }) }),
      fontPx: fontPx * fit,
      fit: fit,
      bounds: {
        x: box.minX + shiftX,
        y: box.minY + shiftY,
        width: box.maxX - box.minX,
        height: box.maxY - box.minY,
      },
      vertical: vertical,
    }
  }

  window.FoliaHanabiTextLayout = {
    wordScales: wordScales,
    partitionRuns: partitionRuns,
    layoutText: layoutText
  }
})()
