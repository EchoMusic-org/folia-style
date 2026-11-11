// 花火的程序层（移植自 folia-major：visualizer/paragraphStructure.ts + hanabi/hanabiScreenBloom.ts +
// hanabi/program.ts + hanabi/hanabiProgram.ts，合成一文件）：
// 歌词 → 段落（分段规则与绘光共用：空隙中位数 ×2.5 定阈值、元数据变化切段、超限段落递归切、按副歌标记/时长/词数/标点分类）
// → 每段切镜头（一行 1–3 镜头、行间长空隙出间奏镜头）→ 选预设（chain 跨段落去重）→ 段落转场。
// 纯函数，不碰 Pixi；同样的歌词与种子永远得到同样的程序。
// 与 lumisynth 的差别（folia 无内核）：段落首尾相接铺满时间轴、长间奏切成约 7 秒的间奏镜头、
// 纯音乐在 duration（缺省 480 秒）上铺一串只有间奏镜头的段落。
(function () {
  'use strict'

  var SeedHash = window.FoliaSeedHash
  var RenderHints = window.FoliaRenderHints
  var Segmentation = window.FoliaWordSegmentation
  var GraphemeTiming = window.FoliaGraphemeTiming
  var Catalog = window.FoliaHanabiCatalog
  var Core = window.FoliaHanabiCore
  var Transitions = window.FoliaHanabiTransitions

  var createRng = Core.createRng
  var getLineRenderEndTime = RenderHints.getLineRenderEndTime
  var segmentLyricWords = Segmentation.segmentLyricWords
  var splitLyricGraphemes = GraphemeTiming.splitLyricGraphemes

  // ===== 段落结构（paragraphStructure.ts） =====

  var DEFAULT_PARAGRAPH_STRUCTURE_PARAMS = {
    gapMultiplier: 2.5, gapMin: 1.25, gapMax: 3.5, maxLines: 6, maxDuration: 18, recursiveSplit: true
  }

  function clamp(value, min, max) { return Math.min(max, Math.max(min, value)) }

  function median(values) {
    if (values.length === 0) return 0.5
    var sorted = values.slice().sort(function (a, b) { return a - b })
    var middle = Math.floor(sorted.length / 2)
    return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle]
  }

  /** 编译用的行：视觉结束时间可以超出 endTime，但不越过下一行开始。 */
  function buildStructureLines(lines) {
    return lines.map(function (line, sourceIndex) {
      return {
        sourceIndex: sourceIndex,
        line: line,
        renderEndTime: Math.max(
          line.startTime,
          Math.min(getLineRenderEndTime(line), lines[sourceIndex + 1] ? lines[sourceIndex + 1].startTime : Infinity)
        )
      }
    })
  }

  function resolveParagraphGapThreshold(lines, params) {
    params = params || DEFAULT_PARAGRAPH_STRUCTURE_PARAMS
    var gaps = []
    for (var i = 1; i < lines.length; i += 1) {
      var gap = lines[i].startTime - Math.min(getLineRenderEndTime(lines[i - 1]), lines[i].startTime)
      if (gap > 0) gaps.push(gap)
    }
    return clamp(median(gaps) * params.gapMultiplier, params.gapMin, params.gapMax)
  }

  function metadataChanged(previous, next) {
    return (previous.blockIndex !== undefined && next.blockIndex !== undefined && previous.blockIndex !== next.blockIndex)
      || (previous.songPart !== undefined && next.songPart !== undefined && previous.songPart !== next.songPart)
  }

  /** 超过行数或时长的段落在最大空隙处切开；recursiveSplit 时左半部分也继续切。 */
  function splitOversizedDraft(draft, params) {
    var output = []
    var remaining = draft.lines
    var boundary = draft.boundary
    var loopGuard = 0
    var lastLine = function (list) { return list[list.length - 1] }
    while (remaining.length > params.maxLines ||
      (remaining.length > 1 && (lastLine(remaining).renderEndTime - remaining[0].line.startTime) > params.maxDuration)) {
      if (loopGuard++ > 1000) break
      var candidates = []
      for (var offset = 0; offset < remaining.length - 3; offset += 1) {
        var line = remaining[offset + 2]
        candidates.push({ splitIndex: offset + 2, gap: line.line.startTime - remaining[offset + 1].renderEndTime })
      }
      var validCandidates = candidates.filter(function (candidate) { return !Number.isNaN(candidate.gap) })
      validCandidates.sort(function (a, b) { return b.gap - a.gap })
      var rawSplitIndex = validCandidates.length ? validCandidates[0].splitIndex : Math.min(4, remaining.length - 1)
      var splitIndex = Math.max(1, rawSplitIndex)
      var head = { lines: remaining.slice(0, splitIndex), boundary: boundary }
      var headParts = params.recursiveSplit ? splitOversizedDraft(head, params) : [head]
      output.push.apply(output, headParts)
      remaining = remaining.slice(splitIndex)
      boundary = output[output.length - 1].lines.length >= params.maxLines ? 'line-cap' : 'duration-cap'
    }
    output.push({ lines: remaining, boundary: boundary })
    return output
  }

  /** 自动分段：元数据变化或空隙超过阈值处切开，再按上限切开超长的段落。 */
  function draftParagraphs(lines, threshold, params) {
    params = params || DEFAULT_PARAGRAPH_STRUCTURE_PARAMS
    var drafts = []
    var current = { lines: [], boundary: 'song-start' }
    lines.forEach(function (line, index) {
      var previous = lines[index - 1]
      var gap = previous ? line.line.startTime - previous.renderEndTime : 0
      var boundary = previous && metadataChanged(previous.line, line.line)
        ? 'metadata'
        : (previous && gap >= threshold ? 'time-gap' : null)
      if (boundary && current.lines.length > 0) {
        drafts.push.apply(drafts, splitOversizedDraft(current, params))
        current = { lines: [], boundary: boundary }
      }
      current.lines.push(line)
    })
    if (current.lines.length > 0) drafts.push.apply(drafts, splitOversizedDraft(current, params))
    return drafts
  }

  /** 一行里「像词」的片段数。 */
  function countWordLike(line) {
    var parts = segmentLyricWords(line)
    var count = 0
    parts.forEach(function (part) { if (part.isWordLike) count += 1 })
    return count
  }

  /** 段落性质：副歌标记 → 间奏标记 → 最后一段是尾声 → 短或词少是换气 → 标点多或词密是上扬 → 其余是主歌。 */
  function classifyParagraph(lines, index, total) {
    var hasChorus = lines.some(function (item) { return item.line.isChorus || /chorus|副歌/i.test(item.line.songPart || '') })
    if (hasChorus) return 'chorus'
    var hasBreak = lines.some(function (item) { return /bridge|break|間奏|ブリッジ/i.test(item.line.songPart || '') })
    if (hasBreak) return 'break'
    if (index === total - 1) return 'outro'
    var duration = lines[lines.length - 1].renderEndTime - lines[0].line.startTime
    var segmentCount = 0
    lines.forEach(function (item) { segmentCount += countWordLike(item.line) })
    var punctuationCount = 0
    lines.forEach(function (item) {
      var matches = String(item.line.fullText || '').match(/[!?！？…]/g)
      if (matches) punctuationCount += matches.length
    })
    if (duration <= 3.5 || segmentCount <= 3) return 'breath'
    if (punctuationCount >= 2 || segmentCount / Math.max(duration, 1) > 2.5) return 'lift'
    return 'verse'
  }

  // ===== 全屏辉光（hanabiScreenBloom.ts） =====

  /** 两段副歌之间空隙短于这么多秒就并成一段。 */
  var CHORUS_MERGE_GAP = 1.5
  var RAMP_IN_BEFORE = 0.5
  var RAMP_IN_AFTER = 0.3
  var RAMP_OUT_BEFORE = 0.2
  var RAMP_OUT_AFTER = 0.9

  /** 副歌行 → 副歌时段：一行从开始唱到下一行开始（最后一行到它的视觉结束），相邻的并起来。 */
  function resolveHanabiChorusSpans(lines) {
    var spans = []
    lines.forEach(function (line, index) {
      if (!line.isChorus) return
      var next = lines[index + 1]
      var endTime = next ? Math.max(line.startTime, next.startTime) : getLineRenderEndTime(line)
      var last = spans.length ? spans[spans.length - 1] : null
      if (last && line.startTime - last.endTime < CHORUS_MERGE_GAP) last.endTime = Math.max(last.endTime, endTime)
      else spans.push({ startTime: line.startTime, endTime: endTime })
    })
    return spans
  }

  function smooth(value) {
    var t = Math.min(1, Math.max(0, value))
    return t * t * (3 - 2 * t)
  }

  /** time 时刻的副歌权重 0..1（时段按时间排好）。 */
  function resolveHanabiChorusWeight(spans, time) {
    var weight = 0
    for (var i = 0; i < spans.length; i += 1) {
      var span = spans[i]
      if (time < span.startTime - RAMP_IN_BEFORE) break
      if (time > span.endTime + RAMP_OUT_AFTER) continue
      var rampIn = smooth((time - (span.startTime - RAMP_IN_BEFORE)) / (RAMP_IN_BEFORE + RAMP_IN_AFTER))
      var rampOut = 1 - smooth((time - (span.endTime - RAMP_OUT_BEFORE)) / (RAMP_OUT_BEFORE + RAMP_OUT_AFTER))
      weight = Math.max(weight, Math.min(rampIn, rampOut))
    }
    return weight
  }

  /** 整体辉光 1 与副歌辉光 1 时 bloom 的强度（叠加）。 */
  var HANABI_SCREEN_BLOOM = { base: 0.45, chorus: 0.9 }

  function resolveHanabiScreenBloomStrength(bloom, chorusBloom, chorusWeight) {
    return Math.max(0, bloom) * HANABI_SCREEN_BLOOM.base + Math.max(0, chorusBloom) * HANABI_SCREEN_BLOOM.chorus * chorusWeight
  }

  // ===== 切块与选预设（program.ts） =====

  var DEFAULT_HANABI_PARAMS = { bridgeGap: 3, maxChars: 18, maxLineSeconds: 6 }

  /** 最近用过的几个预设不马上再用。 */
  var RECENT = 6
  /** 间奏（スターマイン / 千輪）偏向的族。 */
  var BRIDGE_FAMILIES = ['senrin', 'uchiage', 'kiku', 'shakudama']
  /** 行唱完到间奏开始留的余韵（秒）。 */
  var BRIDGE_TAIL = 0.6
  /** 一行最多切成几个镜头。 */
  var MAX_PIECES = 3

  var MOODS_BY_KIND = {
    chorus: ['loud', 'neutral'],
    lift: ['loud', 'neutral'],
    verse: ['neutral', 'quiet'],
    breath: ['quiet', 'neutral'],
    outro: ['quiet', 'neutral'],
    break: null
  }

  function lastOf(list) { return list[list.length - 1] }

  // ─── 分词与切片 ─────────────────────────────────────────────────────────

  /** 逐字时间里的词在 fullText 里的位置；对不上返回 null。 */
  function locateWords(line) {
    var text = line.fullText
    var located = []
    var cursor = 0
    var words = line.words || []
    for (var i = 0; i < words.length; i += 1) {
      var word = words[i]
      if (!word.text) continue
      var index = text.indexOf(word.text, cursor)
      if (index < 0) return null
      located.push({ word: word, start: index, end: index + word.text.length })
      cursor = index + word.text.length
    }
    return located.length > 0 ? located : null
  }

  function hasLetters(text) { return /[\p{L}\p{N}]/u.test(text) }

  /**
   * 把一行切成词（切长行的边界）：有逐字时间就用逐字时间的词，否则用应用的分词（与文字排版同一份），
   * 时间按文字偏移在整行里线性分配。空白与标点并进前一个词。
   */
  function segmentHanabiLine(line) {
    var text = line.fullText
    var located = locateWords(line)
    if (located && located.length >= 2) {
      return located.map(function (entry) {
        return { startOffset: entry.start, endOffset: entry.end, startTime: entry.word.startTime, endTime: entry.word.endTime }
      })
    }
    var pieces = segmentLyricWords(line).map(function (part) {
      return { start: part.index, end: part.index + part.segment.length, text: part.segment }
    })
    var merged = []
    pieces.forEach(function (piece) {
      var last = merged.length ? merged[merged.length - 1] : null
      if (last && !hasLetters(piece.text)) last.end = piece.end
      else merged.push({ start: piece.start, end: piece.end })
    })
    var length = Math.max(text.length, 1)
    var timeAt = function (offset) { return line.startTime + (line.endTime - line.startTime) * (offset / length) }
    return merged.map(function (span) {
      return { startOffset: span.start, endOffset: span.end, startTime: timeAt(span.start), endTime: timeAt(span.end) }
    })
  }

  /** 一行在 [start, end) 这段文字上的切片：词按偏移裁开，时间按比例分配。整行时原样返回。 */
  function sliceLine(line, startOffset, endOffset) {
    var text = line.fullText
    var start = Math.max(0, Math.min(startOffset, text.length))
    var end = Math.max(start, Math.min(endOffset, text.length))
    if (start === 0 && end === text.length) return line
    var located = locateWords(line) || [{ word: { text: text, startTime: line.startTime, endTime: line.endTime }, start: 0, end: text.length }]
    var words = []
    located.forEach(function (entry) {
      var from = Math.max(entry.start, start)
      var to = Math.min(entry.end, end)
      if (to <= from) return
      var span = Math.max(entry.end - entry.start, 1)
      var duration = entry.word.endTime - entry.word.startTime
      words.push({
        text: text.slice(from, to),
        startTime: entry.word.startTime + duration * ((from - entry.start) / span),
        endTime: entry.word.startTime + duration * ((to - entry.start) / span)
      })
    })
    var fullText = text.slice(start, end)
    if (words.length === 0) {
      var length = Math.max(text.length, 1)
      var timeAt = function (offset) { return line.startTime + (line.endTime - line.startTime) * (offset / length) }
      words.push({ text: fullText, startTime: timeAt(start), endTime: timeAt(end) })
    }
    var out = {}
    Object.keys(line).forEach(function (key) { out[key] = line[key] })
    out.fullText = fullText
    out.words = words
    out.startTime = words[0].startTime
    out.endTime = words[words.length - 1].endTime
    out.translation = undefined
    out.romanization = undefined
    return out
  }

  /** 镜头的文字：切片拼成一行（跨行的切片之间加一个空格）。间奏返回 null。 */
  function shotLine(lines, slices) {
    var parts = []
    slices.forEach(function (slice) {
      var line = lines.get(slice.lineIndex)
      if (line) {
        var sliced = sliceLine(line, slice.startOffset, slice.endOffset)
        if (String(sliced.fullText || '').trim().length > 0) parts.push(sliced)
      }
    })
    if (parts.length === 0) return null
    if (parts.length === 1) return parts[0]
    var words = []
    parts.forEach(function (part, index) {
      if (index > 0) {
        var gapAt = lastOf(words).endTime
        words.push({ text: ' ', startTime: gapAt, endTime: Math.max(gapAt, part.startTime) })
      }
      words.push.apply(words, part.words)
    })
    var out = {}
    Object.keys(parts[0]).forEach(function (key) { out[key] = parts[0][key] })
    out.fullText = words.map(function (word) { return word.text }).join('')
    out.words = words
    out.startTime = parts[0].startTime
    out.endTime = Math.max.apply(null, parts.map(function (part) { return part.endTime }))
    return out
  }

  function visibleLength(text) {
    var graphemes = splitLyricGraphemes(text)
    var count = 0
    graphemes.forEach(function (grapheme) { if (grapheme.trim().length > 0) count += 1 })
    return count
  }

  /** 一行 → 1–3 段：超过 maxChars 个字或 maxLineSeconds 秒时，在最接近等分处的词边界切开。 */
  function splitLinePiece(unified, params) {
    var line = unified.line
    var text = line.fullText
    var whole = [{
      slice: { lineIndex: unified.sourceIndex, startOffset: 0, endOffset: text.length },
      startTime: line.startTime,
      lyricEndTime: unified.renderEndTime
    }]
    var count = visibleLength(text)
    var duration = line.endTime - line.startTime
    var maxChars = Math.max(4, params.maxChars)
    var maxSeconds = Math.max(1, params.maxLineSeconds)
    if (count <= maxChars && duration <= maxSeconds) return whole
    var segments = segmentHanabiLine(line)
    var pieces = Math.min(MAX_PIECES, segments.length, Math.max(2, Math.ceil(Math.max(count / maxChars, duration / maxSeconds))))
    if (pieces < 2) return whole
    // 可切的位置：第 j 个词之后（下一个词的起点）。
    var cuts = []
    var after = -1
    for (var k = 1; k < pieces; k += 1) {
      var target = (text.length * k) / pieces
      var best = -1
      // 给后面的切口留位置。
      for (var j = after + 1; j <= segments.length - 1 - (pieces - k); j += 1) {
        var offset = segments[j + 1].startOffset
        if (best < 0 || Math.abs(offset - target) < Math.abs(segments[best + 1].startOffset - target)) best = j
      }
      if (best < 0) break
      cuts.push(best)
      after = best
    }
    if (cuts.length === 0) return whole
    var bounds = [-1].concat(cuts, [segments.length - 1])
    var result = []
    for (var b = 0; b < bounds.length - 1; b += 1) {
      var first = segments[bounds[b] + 1]
      var last = segments[bounds[b + 1]]
      var isFirst = b === 0
      var isLast = b === bounds.length - 2
      result.push({
        slice: {
          lineIndex: unified.sourceIndex,
          startOffset: isFirst ? 0 : first.startOffset,
          endOffset: isLast ? text.length : segments[bounds[b + 1] + 1].startOffset
        },
        startTime: isFirst ? line.startTime : first.startTime,
        lyricEndTime: isLast ? unified.renderEndTime : last.endTime
      })
    }
    return result
  }

  /**
   * 镜头的时间：一段一个镜头，从它的第一个字开始（段首镜头从段落开始），到下一个镜头开始为止，首尾相接；
   * 行后的空隙不少于 bridgeGap 时，镜头在唱完后 0.6 秒收住，空隙交给间奏镜头。
   */
  function planShots(lines, paragraphStart, paragraphEnd, params) {
    var pieces = []
    lines.forEach(function (line) {
      splitLinePiece(line, params).forEach(function (piece, index) {
        pieces.push(Object.assign({}, piece, { slot: 's' + index }))
      })
    })
    var shots = []
    var cursor = pieces.length > 0 ? Math.min(paragraphStart, pieces[0].startTime) : paragraphStart
    pieces.forEach(function (piece, index) {
      var start = cursor
      var nextPiece = pieces[index + 1]
      var nextStart = Math.max(nextPiece ? nextPiece.startTime : paragraphEnd, start + 0.05)
      var lyricEnd = piece.lyricEndTime
      if (index < pieces.length - 1 && nextStart - lyricEnd >= params.bridgeGap) {
        var end = Math.max(start + 0.05, lyricEnd + BRIDGE_TAIL)
        shots.push({ slices: [piece.slice], slot: piece.slot, startTime: start, endTime: end, lyricEndTime: lyricEnd, isBridge: false })
        shots.push({ slices: [], slot: null, startTime: end, endTime: nextStart, lyricEndTime: nextStart, isBridge: true })
      } else {
        var shotEnd = index < pieces.length - 1 ? nextStart : Math.max(nextStart, lyricEnd)
        shots.push({ slices: [piece.slice], slot: piece.slot, startTime: start, endTime: shotEnd, lyricEndTime: Math.min(lyricEnd, shotEnd), isBridge: false })
      }
      cursor = shots[shots.length - 1].endTime
    })
    if (pieces.length === 0 && paragraphEnd > paragraphStart) {
      shots.push({ slices: [], slot: null, startTime: paragraphStart, endTime: paragraphEnd, lyricEndTime: paragraphEnd, isBridge: true })
    }
    return shots
  }

  // ─── 选预设 ─────────────────────────────────────────────────────────────

  /**
   * 选预设：全部预设 → 间奏偏向的族 → 段落性质对应的 mood → 避开最近用过的与上一个的族；每一步筛空了就不收。
   */
  function castShot(options) {
    var chain = options.chain
    var candidates = Catalog.HANABI_KINDS
    function narrow(keep) {
      var next = candidates.filter(keep)
      if (next.length > 0) candidates = next
    }
    var moods = MOODS_BY_KIND[options.kind]
    if (options.isBridge) narrow(function (kind) { return BRIDGE_FAMILIES.indexOf(Catalog.profileOf(kind).family) >= 0 })
    if (moods) narrow(function (kind) { return moods.indexOf(Catalog.profileOf(kind).mood) >= 0 })
    narrow(function (kind) { return chain.recent.indexOf(kind) < 0 })
    if (chain.family) narrow(function (kind) { return Catalog.profileOf(kind).family !== chain.family })
    var random = createRng(options.seed + ':' + options.paragraphIndex + ':' + options.shotIndex + ':hanabi-cast')
    return candidates[Math.floor(random() * candidates.length)]
  }

  /** 选定之后更新 chain（跨段落保留）。 */
  function advanceChain(chain, kind) {
    chain.recent = chain.recent.concat([kind]).slice(-RECENT)
    chain.family = Catalog.profileOf(kind).family
  }

  /** 镜头的文字处理：排版组件指向的预设的 text，再套上色块与入场组件。 */
  function shotText(shot) {
    var text = Catalog.profileOf(shot.typography || shot.kind).text
    var block = shot.block || text.block
    var enter = shot.enter || text.enter
    return block === text.block && enter === text.enter ? text : Object.assign({}, text, { block: block, enter: enter })
  }

  /** 镜头的预设套上逐镜头的组件（色块、入场、主烟花种类）。 */
  function resolveShotProfile(shot) {
    var base = Catalog.profileOf(shot.kind)
    var text = shotText(shot)
    var burst = shot.burst && (!base.burst || shot.burst !== base.burst.kind)
      ? Catalog.burstPreset(shot.burst, base.burst ? base.burst.colors : undefined)
      : base.burst
    if (text === base.text && burst === base.burst) return base
    return Object.assign({}, base, { text: text, burst: burst })
  }

  // ===== 整首编译（hanabiProgram.ts） =====

  /** 纯音乐缺省时长、每段时长（秒）。 */
  var INSTRUMENTAL_DURATION = 480
  var INSTRUMENTAL_PARAGRAPH = 28
  /** 间奏镜头的目标时长；长于 BRIDGE_SPLIT 秒的切成几个。 */
  var BRIDGE_SHOT = 7
  var BRIDGE_SPLIT = 10
  /** 段落最后一行唱完到段后间奏开始留的余韵（与 program.ts 行间间奏相同）。 */
  var BRIDGE_TAIL_PROGRAM = 0.6

  /** 段落最后一个镜头后面空隙够长时，镜头在唱完后收住，剩下的交给间奏镜头。 */
  function closeTail(shots, endTime, params) {
    var last = shots.length ? shots[shots.length - 1] : null
    if (!last || last.isBridge || endTime - last.lyricEndTime < params.bridgeGap) return shots
    var end = Math.max(last.startTime + 0.05, last.lyricEndTime + BRIDGE_TAIL_PROGRAM)
    var trimmed = Object.assign({}, last, { endTime: end })
    return shots.slice(0, -1).concat([trimmed, { slices: [], slot: null, startTime: end, endTime: endTime, lyricEndTime: endTime, isBridge: true }])
  }

  /** 把过长的间奏镜头等分成约 BRIDGE_SHOT 秒的几段。 */
  function splitLongBridges(shots) {
    var out = []
    shots.forEach(function (shot) {
      var length = shot.endTime - shot.startTime
      if (!shot.isBridge || length <= BRIDGE_SPLIT) { out.push(shot); return }
      var count = Math.max(2, Math.round(length / BRIDGE_SHOT))
      for (var index = 0; index < count; index += 1) {
        var startTime = shot.startTime + (length * index) / count
        var endTime = index === count - 1 ? shot.endTime : shot.startTime + (length * (index + 1)) / count
        out.push({ slices: [], slot: null, startTime: startTime, endTime: endTime, lyricEndTime: endTime, isBridge: true })
      }
    })
    return out
  }

  /** 有歌词时的段落计划：可选的前奏段 + 分段结果，首尾相接铺到 programEnd。 */
  function planLyricParagraphs(lines, params, duration) {
    var structure = buildStructureLines(lines)
    var drafts = draftParagraphs(structure, resolveParagraphGapThreshold(lines))
    var lyricEndTime = 0
    structure.forEach(function (line) { lyricEndTime = Math.max(lyricEndTime, line.renderEndTime) })
    var programEnd = Math.max(lyricEndTime, duration || 0)
    var firstStart = structure[0].line.startTime
    var plans = []
    // 前奏够长时单独成一个间奏段：开头就有烟花一路升空，第一句不从空画面开始。
    var intro = firstStart >= params.bridgeGap
    if (intro) plans.push({ lines: [], kind: 'break', startTime: 0, endTime: firstStart, lyricEndTime: firstStart })
    drafts.forEach(function (draft, index) {
      var next = drafts[index + 1]
      plans.push({
        lines: draft.lines,
        kind: classifyParagraph(draft.lines, index, drafts.length),
        startTime: index === 0 && !intro ? Math.min(0, firstStart) : draft.lines[0].line.startTime,
        endTime: next ? next.lines[0].line.startTime : programEnd,
        lyricEndTime: draft.lines[draft.lines.length - 1].renderEndTime
      })
    })
    return { plans: plans, lyricEndTime: lyricEndTime, programEnd: programEnd }
  }

  /** 纯音乐的段落计划：duration 等分成约 INSTRUMENTAL_PARAGRAPH 秒的段落。 */
  function planInstrumentalParagraphs(duration) {
    var count = Math.max(1, Math.round(duration / INSTRUMENTAL_PARAGRAPH))
    var plans = []
    for (var index = 0; index < count; index += 1) {
      var startTime = (duration * index) / count
      var endTime = index === count - 1 ? duration : (duration * (index + 1)) / count
      plans.push({ lines: [], kind: 'break', startTime: startTime, endTime: endTime, lyricEndTime: endTime })
    }
    return plans
  }

  /**
   * 编译整首歌。lines 是按时间排序的歌词，seed 缺省为 'hanabi'；params 覆盖切块参数。
   * 纯函数：同样的输入得到逐字段相同的程序。
   */
  function compileHanabiProgram(lines, seed, params, options) {
    params = params || {}
    options = options || {}
    var resolvedParams = Object.assign({}, DEFAULT_HANABI_PARAMS, params)
    var resolvedSeed = String(seed === undefined || seed === null ? 'hanabi' : seed)
    var instrumental = lines.length === 0
    var lyric = instrumental ? null : planLyricParagraphs(lines, resolvedParams, options.duration)
    var instrumentalDuration = Math.max(1, options.duration && options.duration > 0 ? options.duration : INSTRUMENTAL_DURATION)
    var plans = lyric ? lyric.plans : planInstrumentalParagraphs(instrumentalDuration)

    var chain = { recent: [], family: null }
    var previousTransition = null
    var paragraphs = plans.map(function (plan, index) {
      var planned = splitLongBridges(closeTail(
        planShots(plan.lines, plan.startTime, plan.endTime, resolvedParams),
        plan.endTime,
        resolvedParams
      ))
      var shots = planned.map(function (shot, shotIndex) {
        var kind = castShot({
          seed: resolvedSeed,
          paragraphIndex: index,
          shotIndex: shotIndex,
          kind: plan.kind,
          isBridge: shot.isBridge,
          chain: chain
        })
        advanceChain(chain, kind)
        return {
          id: 'p' + index + '-hb' + shotIndex,
          kind: kind,
          slices: shot.slices,
          startTime: shot.startTime,
          endTime: shot.endTime,
          lyricEndTime: shot.lyricEndTime,
          isBridge: shot.isBridge
        }
      })

      // 段落转场：结束在下一段开始（= 本段 endTime），时长按与下一段之间的空隙定。
      var next = plans[index + 1]
      var transitionOut = null
      if (next) {
        var kind = Transitions.chooseHanabiTransition(resolvedSeed, index, previousTransition)
        previousTransition = kind
        var gap = next.startTime - plan.lyricEndTime
        transitionOut = {
          kind: kind,
          startTime: Math.max(plan.startTime, plan.endTime - Transitions.HANABI_TRANSITIONS[kind].duration(gap)),
          endTime: plan.endTime
        }
      }

      var seenLineIndices = {}
      var lineIndices = []
      shots.forEach(function (shot) {
        shot.slices.forEach(function (slice) {
          if (!seenLineIndices[slice.lineIndex]) {
            seenLineIndices[slice.lineIndex] = true
            lineIndices.push(slice.lineIndex)
          }
        })
      })
      lineIndices.sort(function (a, b) { return a - b })
      return {
        id: 'hanabi-p' + index,
        index: index,
        kind: plan.kind,
        startTime: plan.startTime,
        endTime: plan.endTime,
        lyricEndTime: plan.lyricEndTime,
        lineIndices: lineIndices,
        lines: lineIndices.map(function (lineIndex) { return lines[lineIndex] }),
        shots: shots,
        transitionOut: transitionOut
      }
    })

    return {
      version: 1,
      seed: resolvedSeed,
      instrumental: instrumental,
      duration: lyric ? lyric.programEnd : instrumentalDuration,
      lyricEndTime: lyric ? lyric.lyricEndTime : null,
      paragraphs: paragraphs,
      chorus: resolveHanabiChorusSpans(lines)
    }
  }

  /** 时刻 time 所在的段落序号（第一段之前算第一段，最后一段之后算最后一段）。 */
  function findHanabiParagraphIndexAtTime(program, time) {
    for (var index = program.paragraphs.length - 1; index >= 0; index -= 1) {
      if (time >= program.paragraphs[index].startTime) return index
    }
    return 0
  }

  window.FoliaHanabiProgram = {
    // paragraphStructure
    DEFAULT_PARAGRAPH_STRUCTURE_PARAMS: DEFAULT_PARAGRAPH_STRUCTURE_PARAMS,
    buildStructureLines: buildStructureLines,
    resolveParagraphGapThreshold: resolveParagraphGapThreshold,
    draftParagraphs: draftParagraphs,
    classifyParagraph: classifyParagraph,
    // screen bloom
    resolveHanabiChorusSpans: resolveHanabiChorusSpans,
    resolveHanabiChorusWeight: resolveHanabiChorusWeight,
    resolveHanabiScreenBloomStrength: resolveHanabiScreenBloomStrength,
    HANABI_SCREEN_BLOOM: HANABI_SCREEN_BLOOM,
    // program
    DEFAULT_HANABI_PARAMS: DEFAULT_HANABI_PARAMS,
    segmentHanabiLine: segmentHanabiLine,
    sliceLine: sliceLine,
    shotLine: shotLine,
    splitLine: splitLinePiece,
    planShots: planShots,
    castShot: castShot,
    advanceChain: advanceChain,
    shotText: shotText,
    resolveShotProfile: resolveShotProfile,
    // hanabiProgram
    compileHanabiProgram: compileHanabiProgram,
    findHanabiParagraphIndexAtTime: findHanabiParagraphIndexAtTime
  }
})()
