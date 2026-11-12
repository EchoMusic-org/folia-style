// 雾笺（nebbia）歌词行整理模块：移植自 folia-major src/components/visualizer/nebbia/
//   nebbiaChars.ts（歌词行 → 逐字 { ch, t, d }：emoji 换图标记号、分词分组、句尾 doodle）
//   nebbiaCredits.ts（片尾：曲名/歌手做成两句额外的歌词，credits 标记，CREDITS_DELAY）
// 全部挂 window.FoliaNebbiaChars，被 nebbia-layout.js / nebbia-scene.js 引用。
//
// 插件差异（相对上游）：
//   lucide 图标（歌词里的 emoji、句尾 doodle 都用它）插件没有：emoji 的检测和 EMOJI_ICON 映射保留，
//   只有宿主提供 nebbia-glyphs.js 的 window.foliaLucideIconNode 钩子时才真的换成 `icon:<名字>` 记号，
//   否则沿用上游「emoji 没有图标映射」的路径保留原字符（不然记号取不到字形，整个字都不会被画出来）；
//   句尾 doodle 仍按上游挑图标名，取不到字形就只占位不画（上游对未知图标名的处理路径）。
(function () {
  'use strict'

  var GraphemeTiming = window.FoliaGraphemeTiming
  var RenderHints = window.FoliaRenderHints
  var WordSeg = window.FoliaWordSegmentation
  var SeedHash = window.FoliaSeedHash

  // ---------- 逐字序列（原版 nebbiaChars.ts） ----------
  // 把 Folia 的歌词行整理成雾笺要写的逐字序列：每个字 { ch, t, d }，时间来自 Line.words（逐字时间轴），
  // 认得的 emoji 换成 lucide 图标记号 `icon:<名字>`（线稿可以直接当笔画写）；词的分组走共用的分词
  // （用户保存的分词优先），排版据此挑主词。有的句子写完顺手画一个主题图标。
  // NebbiaChar：{ ch, t, d }；NebbiaSourceLine：{ chars, words, t, end, next, credits? }。

  // 图标记号前缀（上游 nebbiaGlyphs.ts 从这里 import ICON_PREFIX；两个 IIFE 的加载顺序不保证，字面量内联，与 nebbia-glyphs.js 保持一致）
  var ICON_PREFIX = 'icon:'

  function isIconChar(ch) {
    return ch.indexOf(ICON_PREFIX) === 0
  }

  // emoji → lucide 图标（和商籁同一套线稿图标）
  var EMOJI_ICON = {
    '❤': 'Heart', '♥': 'Heart', '💗': 'Heart', '⭐': 'Star', '★': 'Star', '☆': 'Star', '🌙': 'Moon', '☀': 'Sun', '🌞': 'Sun',
    '🎵': 'Music', '♪': 'Music2', '🎶': 'Music', '🌸': 'Flower', '✿': 'Flower2', '🌷': 'Flower2', '✨': 'Sparkles',
    '☁': 'Cloud', '🌧': 'CloudRain', '☂': 'Umbrella', '☔': 'Umbrella', '🐱': 'Cat', '😊': 'Smile', '🙂': 'Smile',
    '❄': 'Snowflake', '🍃': 'Leaf', '🌿': 'Leaf', '🪶': 'Feather'
  }
  /** 主题没有给图标时，句尾随手画的图标从这里挑。 */
  var NEBBIA_DEFAULT_DOODLES = ['Heart', 'Star', 'Moon', 'Music', 'Flower', 'Sparkles', 'CloudRain', 'Umbrella', 'Smile', 'Leaf']

  // 按码点枚举字符串（emoji、变体选择符都按整个字素走）
  function codePoints(text) {
    return Array.from(text)
  }

  /** 歌词里出现的 emoji 要用到的图标名（换歌前先加载好）。 */
  function collectEmojiIcons(lines) {
    var out = new Set()
    for (var i = 0; i < lines.length; i += 1) {
      var text = codePoints(lines[i].fullText.replace(/[\uFE0F\u200D]/g, ''))
      for (var k = 0; k < text.length; k += 1) if (EMOJI_ICON[text[k]]) out.add(EMOJI_ICON[text[k]])
    }
    return Array.from(out)
  }

  function toChar(grapheme) {
    var bare = grapheme.replace(/[\uFE0F\u200D]/g, '')
    var icon = EMOJI_ICON[bare]
    // 上游 emoji 一律换成 lucide 图标记号；插件没有 lucide（nebbia-glyphs.js 的 iconPolys 对未知名返回 null，
    // 记号取不到字形就整个不画），沿用上游「emoji 没有图标映射」的路径保留原字符
    return icon && window.FoliaNebbiaGlyphs && window.FoliaNebbiaGlyphs.lucideIconAvailable() ? ICON_PREFIX + icon : bare
  }

  // 分词结果（按 UTF-16 偏移）对到字素下标上；纯空白的段不成词，每个图标单独成词
  function groupWords(line, graphemes, chars) {
    var starts = []
    var offset = 0
    for (var i = 0; i < graphemes.length; i += 1) { starts.push(offset); offset += graphemes[i].length }
    var indexAt = function (unit) {
      var k = 0
      while (k + 1 < starts.length && starts[k + 1] <= unit) k += 1
      return k
    }
    var words = []
    var segs = WordSeg.segmentLyricWords(line)
    for (var s = 0; s < segs.length; s += 1) {
      var seg = segs[s]
      if (!seg.segment.trim()) continue
      var from = indexAt(seg.index), to = indexAt(seg.index + seg.segment.length - 1)
      var run = []
      for (var k = from; k <= to; k += 1) {
        if (!chars[k].ch.trim()) continue
        if (isIconChar(chars[k].ch)) { if (run.length) words.push(run); words.push([k]); run = [] }
        else run.push(k)
      }
      if (run.length) words.push(run)
    }
    return words
  }

  /**
   * 整首歌的逐字序列。seed 决定哪些句子句尾画图标、画哪个；doodle 是概率；doodles 是可用的图标名
   * （主题的，或默认的），空的时候不画。
   */
  function buildNebbiaLines(lines, seed, doodle, doodles) {
    var base = SeedHash.hashVisualizerSeed(String(seed))
    return lines.map(function (line, index) {
      var timeline = GraphemeTiming.buildLineGraphemeTimeline(line)
      var chars = timeline.map(function (g) { return { ch: toChar(g.char), t: g.startTime, d: Math.max(0, g.endTime - g.startTime) } })
      var words = groupWords(line, timeline.map(function (g) { return g.char }), chars)
      var end = Math.max(line.startTime, RenderHints.getLineRenderEndTime(line))
      var next = lines[index + 1] ? lines[index + 1].startTime : Infinity
      var rng = SeedHash.createVisualizerRng((base + Math.imul(index + 1, 977) + 31) >>> 0)
      var last = chars[chars.length - 1]
      if (last && doodles.length && !chars.some(function (c) { return isIconChar(c.ch) }) && rng() < doodle) {
        var at = last.t + last.d
        chars.push({ ch: ' ', t: at, d: 0 }, { ch: ICON_PREFIX + doodles[Math.floor(rng() * doodles.length)], t: at + 0.08, d: 1.1 })
        words.push([chars.length - 1])
      }
      return { chars: chars, words: words, t: line.startTime, end: end, next: next }
    })
  }

  // ---------- 片尾（原版 nebbiaCredits.ts） ----------
  // 雾笺的片尾：最后一句唱完一会儿，前面的句子都起雾散掉，在玻璃正中手写出曲名，下面小一点写歌手，
  // 写完一直留着。这里把曲名、歌手做成两句额外的歌词（`credits` 标记），排版（nebbia-layout.js 的
  // creditsCandidate）、书写节奏和不起雾（nebbia-scene.js）各自按这个标记处理。

  /** 最后一句唱完后多久开写曲名。 */
  var CREDITS_DELAY = 2.5

  function graphemes(text) {
    var seg = typeof Intl !== 'undefined' && 'Segmenter' in Intl ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null
    return seg ? Array.from(seg.segment(text), function (s) { return s.segment }) : codePoints(text)
  }

  /**
   * 一段文字的词：按 Intl 分词（中日文曲名中间没有空格，只按空格切会只有一块，排版就没法分两行），
   * 没有分词器时按空格切。返回每个词的字素下标。
   */
  function wordsOf(text, chars) {
    var starts = []
    var offset = 0
    for (var i = 0; i < chars.length; i += 1) { starts.push(offset); offset += chars[i].length }
    var words = []
    var seg = typeof Intl !== 'undefined' && 'Segmenter' in Intl ? new Intl.Segmenter(undefined, { granularity: 'word' }) : null
    var pieces = seg
      ? Array.from(seg.segment(text), function (p) { return { at: p.index, text: p.segment } })
      : Array.from(text.matchAll(/\S+/g), function (m) { return { at: m.index || 0, text: m[0] } })
    for (var i = 0; i < pieces.length; i += 1) {
      var p = pieces[i]
      if (!p.text.trim()) continue
      var run = []
      for (var k = 0; k < starts.length; k += 1) {
        if (starts[k] >= p.at && starts[k] < p.at + p.text.length && chars[k].trim()) run.push(k)
      }
      if (run.length) words.push(run)
    }
    return words
  }

  /** 一段文字做成一句：字间隔开一点时间（真正的书写节奏由场景排）。 */
  function creditLine(text, t, credits) {
    var gs = graphemes(text)
    var chars = gs.map(function (ch, i) { return { ch: ch, t: t + i * 0.1, d: 0.5 } })
    var last = chars[chars.length - 1]
    return { chars: chars, words: wordsOf(text, gs), t: t, end: last ? last.t + last.d : t, next: Infinity, credits: credits }
  }

  /** 在整首歌词后面接上片尾两句（没有歌词或没有曲名时不加）。歌手写在曲名写完之后，由场景对齐。 */
  function appendNebbiaCredits(source, title, artist) {
    var name = title ? title.trim() : null
    if (!source.length || !name) return source
    var at = Math.max.apply(null, source.map(function (l) { return l.end })) + CREDITS_DELAY
    var out = source.map(function (l, i) {
      return i === source.length - 1 ? Object.assign({}, l, { next: Math.min(l.next, at) }) : l
    })
    var titleLine = creditLine(name, at, 'title')
    out.push(titleLine)
    var by = artist ? artist.trim() : null
    if (by) {
      // 两句的 next 都留 Infinity：书写不赶时间，按自然速度写
      out.push(creditLine(by, titleLine.end + 0.2, 'artist'))
    }
    return out
  }

  window.FoliaNebbiaChars = {
    ICON_PREFIX: ICON_PREFIX,
    isIconChar: isIconChar,
    EMOJI_ICON: EMOJI_ICON,
    NEBBIA_DEFAULT_DOODLES: NEBBIA_DEFAULT_DOODLES,
    collectEmojiIcons: collectEmojiIcons,
    buildNebbiaLines: buildNebbiaLines,
    // nebbiaCredits.ts
    CREDITS_DELAY: CREDITS_DELAY,
    appendNebbiaCredits: appendNebbiaCredits
  }
})()
