// 商籁模式·节目编排：移植自 folia-major
//   sonnet/sonnetSemantic.ts（无损语义分段，展示偏移映射到解析器字形时间）
//   sonnet/sonnetProgram.ts（把歌词编译为 seek 安全的确定性 PV 时间线）
// 分词与字形时间轴由插件 runtime 的 FoliaWordSegmentation / FoliaGraphemeTiming 提供。
(function () {
  'use strict'

  var Core = window.FoliaSonnetCore
  var RenderHints = window.FoliaRenderHints
  var GraphemeTiming = window.FoliaGraphemeTiming
  var WordSegmentation = window.FoliaWordSegmentation

  // ---------- shot 类型清单（原版 sonnetProgram.ts） ----------
  var SONNET_SHOT_KINDS = [
    'editorial-column',
    'type-impact',
    'fragment-collage',
    'tracking-ribbon',
    'mask-reveal',
    'poster-blocks',
    'quiet-tableau'
  ]
  // 布局调试覆盖；null 表示所有已注册模板都进入随机池
  var SONNET_DEBUG_SHOT_KIND = null

  function resolveSonnetDebugShotKind() { return SONNET_DEBUG_SHOT_KIND }

  function clamp(value, min, max) { return Math.min(max, Math.max(min, value)) }

  function median(values) {
    if (values.length === 0) return 0.5
    var sorted = values.slice().sort(function (a, b) { return a - b })
    var middle = Math.floor(sorted.length / 2)
    return sorted.length % 2 === 0
      ? ((sorted[middle - 1] !== undefined ? sorted[middle - 1] : sorted[middle]) + sorted[middle]) / 2
      : sorted[middle]
  }

  function resolveSonnetParagraphGapThreshold(lines) {
    var gaps = lines.slice(1).map(function (line, index) {
      return line.startTime - Math.min(RenderHints.getLineRenderEndTime(lines[index]), line.startTime)
    }).filter(function (gap) { return gap > 0 })
    return clamp(median(gaps) * 2.5, 1.25, 3.5)
  }

  // 原版 metadataChanged：blockIndex / songPart 标记变化即换段。
  // 本插件数据没有这两个字段，条件恒为 false，但保留分支与原版对齐。
  function metadataChanged(previous, next) {
    return (previous.blockIndex !== undefined && next.blockIndex !== undefined && previous.blockIndex !== next.blockIndex)
      || (previous.songPart !== undefined && next.songPart !== undefined && previous.songPart !== next.songPart)
  }

  // ---------- 语义分段（原版 sonnetSemantic.ts） ----------
  function getGraphemeRanges(text) {
    var cursor = 0
    return GraphemeTiming.splitLyricGraphemes(text).map(function (grapheme) {
      var range = { start: cursor, end: cursor + grapheme.length }
      cursor = range.end
      return range
    })
  }

  function timingForRange(line, startOffset, endOffset, timeline, ranges) {
    var indices = []
    ranges.forEach(function (range, index) {
      if (range.end > startOffset && range.start < endOffset) indices.push(index)
    })
    var graphemes = indices.map(function (index) { return timeline[index] }).filter(Boolean)
    var wordIndexSet = {}
    var wordIndices = []
    graphemes.forEach(function (item) {
      if (typeof item.wordIndex === 'number' && !wordIndexSet[item.wordIndex]) {
        wordIndexSet[item.wordIndex] = true
        wordIndices.push(item.wordIndex)
      }
    })

    return {
      graphemes: graphemes,
      wordIndices: wordIndices,
      startTime: graphemes.length > 0 && graphemes[0] ? graphemes[0].startTime : line.startTime,
      endTime: graphemes.length > 0 ? graphemes[graphemes.length - 1].endTime : line.endTime
    }
  }

  function buildSonnetSemanticSegments(line) {
    if (!line.fullText) return []
    var timeline = GraphemeTiming.buildLineGraphemeTimeline(line)
    var ranges = getGraphemeRanges(line.fullText)
    var parts = WordSegmentation.segmentLyricWords(line)
    var segments = parts.map(function (part, index) {
      var startOffset = part.index
      var endOffset = index + 1 < parts.length ? parts[index + 1].index : line.fullText.length
      var timing = timingForRange(line, startOffset, endOffset, timeline, ranges)
      return {
        text: line.fullText.slice(startOffset, endOffset),
        startOffset: startOffset,
        endOffset: endOffset,
        graphemes: timing.graphemes,
        wordIndices: timing.wordIndices,
        startTime: timing.startTime,
        endTime: timing.endTime,
        isWordLike: part.isWordLike
      }
    })

    // 粘着合并：非词片段（标点/空白）并入前段，避免孤立符号成为独立排版单元
    var sticky = []
    for (var i = 0; i < segments.length; i += 1) {
      var segment = segments[i]
      var previous = sticky[sticky.length - 1]
      if (previous && !segment.isWordLike && !/^\s+$/u.test(segment.text)) {
        previous.text += segment.text
        previous.endOffset = segment.endOffset
        previous.endTime = Math.max(previous.endTime, segment.endTime)
        for (var g = 0; g < segment.graphemes.length; g += 1) previous.graphemes.push(segment.graphemes[g])
        var seen = {}
        var merged = []
        for (var w = 0; w < previous.wordIndices.length; w += 1) seen[previous.wordIndices[w]] = true
        for (var w2 = 0; w2 < segment.wordIndices.length; w2 += 1) seen[segment.wordIndices[w2]] = true
        Object.keys(seen).forEach(function (key) { merged.push(Number(key)) })
        merged.sort(function (a, b) { return a - b })
        previous.wordIndices = merged
      } else {
        sticky.push({
          text: segment.text,
          startOffset: segment.startOffset,
          endOffset: segment.endOffset,
          graphemes: segment.graphemes.slice(),
          wordIndices: segment.wordIndices.slice(),
          startTime: segment.startTime,
          endTime: segment.endTime,
          isWordLike: segment.isWordLike
        })
      }
    }
    return sticky
  }

  // ---------- 节目编译（原版 sonnetProgram.ts） ----------
  function splitOversizedDraft(draft) {
    var output = []
    var remaining = draft.lines
    var boundary = draft.boundary
    var loopGuard = 0
    while (remaining.length > 6 || (remaining.length > 1 && (remaining[remaining.length - 1].renderEndTime - remaining[0].line.startTime) > 18)) {
      if (loopGuard++ > 1000) {
        console.error('splitOversizedDraft: Infinite loop detected, breaking')
        break
      }
      var candidates = remaining.slice(2, -1).map(function (line, offset) {
        return {
          splitIndex: offset + 2,
          gap: line.line.startTime - remaining[offset + 1].renderEndTime
        }
      })
      // 过滤 NaN 保证排序可预期，max(1) 是最终兜底
      var validCandidates = candidates.filter(function (c) { return !Number.isNaN(c.gap) })
      validCandidates.sort(function (a, b) { return b.gap - a.gap })
      var rawSplitIndex = validCandidates.length > 0
        ? validCandidates[0].splitIndex
        : Math.min(4, remaining.length - 1)
      var splitIndex = Math.max(1, rawSplitIndex)

      output.push({ lines: remaining.slice(0, splitIndex), boundary: boundary })
      remaining = remaining.slice(splitIndex)
      boundary = output[output.length - 1].lines.length >= 6 ? 'line-cap' : 'duration-cap'
    }
    output.push({ lines: remaining, boundary: boundary })
    return output
  }

  function classifyParagraph(lines, index, total) {
    var isChorus = lines.some(function (item) {
      return item.line.isChorus || /chorus|副歌/i.test(item.line.songPart || '')
    })
    if (isChorus) return 'chorus'
    var isBreak = lines.some(function (item) { return /bridge|break|間奏|ブリッジ/i.test(item.line.songPart || '') })
    if (isBreak) return 'break'
    if (index === total - 1) return 'outro'
    var duration = lines[lines.length - 1].renderEndTime - lines[0].line.startTime
    var segmentCount = lines.reduce(function (sum, line) {
      return sum + line.segments.filter(function (segment) { return segment.isWordLike }).length
    }, 0)
    var punctuationCount = lines.reduce(function (sum, line) {
      var matches = line.line.fullText.match(/[!?！？…]/g)
      return sum + (matches ? matches.length : 0)
    }, 0)
    if (duration <= 3.5 || segmentCount <= 3) return 'breath'
    if (punctuationCount >= 2 || segmentCount / Math.max(duration, 1) > 2.5) return 'lift'
    return 'verse'
  }

  function chooseWithoutRepeat(choices, seed, previous) {
    var start = Core.hashSonnetSeed(seed) % choices.length
    for (var offset = 0; offset < choices.length; offset += 1) {
      var candidate = choices[(start + offset) % choices.length]
      if (candidate !== previous) return candidate
    }
    return choices[start]
  }

  function buildCues(lines) {
    var segments = []
    lines.forEach(function (line) {
      line.segments.forEach(function (segment) { segments.push(segment) })
    })
    segments = segments.filter(function (segment) { return segment.text.length > 0 })
    return segments.map(function (segment, index) {
      return {
        at: segment.startTime,
        duration: Math.max(0.08, segment.endTime - segment.startTime),
        kind: index === segments.length - 1 ? 'accent' : 'enter',
        segmentStart: index,
        segmentEnd: index + 1
      }
    })
  }

  function groupShotLines(lines) {
    var groups = []
    var currentGroup = []
    var groupStartTime = 0

    for (var index = 0; index < lines.length; index += 1) {
      var line = lines[index]
      if (currentGroup.length === 0) {
        currentGroup.push(line)
        groupStartTime = line.line.startTime
      } else {
        var durationSoFar = line.renderEndTime - groupStartTime
        // 最多 4 行、总时长 6 秒一组，以复用背景 MG
        if (currentGroup.length < 4 && durationSoFar <= 6.0) {
          currentGroup.push(line)
        } else {
          groups.push(currentGroup)
          currentGroup = [line]
          groupStartTime = line.line.startTime
        }
      }
    }
    if (currentGroup.length > 0) groups.push(currentGroup)
    return groups
  }

  function buildShots(lines, kind, paragraphIndex, seed, previousKind) {
    var lastKind = previousKind
    return groupShotLines(lines).map(function (group, shotIndex) {
      var signature = group.map(function (item) { return item.line.fullText }).join('|')
      var debugShotKind = resolveSonnetDebugShotKind()
      var shotKind = debugShotKind
        || chooseWithoutRepeat(SONNET_SHOT_KINDS, seed + ':' + paragraphIndex + ':' + shotIndex + ':' + signature, lastKind)
      var wordCount = group.reduce(function (sum, item) {
        return sum + item.segments.filter(function (s) { return s.isWordLike }).length
      }, 0)
      if (debugShotKind === null) {
        if (kind === 'breath' && shotIndex === 0 && wordCount <= 2) shotKind = 'quiet-tableau'
        if (kind === 'chorus' && shotKind === 'quiet-tableau') shotKind = 'type-impact'
      }
      lastKind = shotKind
      var random = Core.hashSonnetSeed(seed + ':' + paragraphIndex + ':' + shotIndex + ':camera')
      var zoomRandom = ((random >>> 16) & 255) / 255
      // 中近景偏好：取景应贴近当前词；只有构图优先的版式（海报分区、平静静物）保持更远
      var zoomBase = shotKind === 'poster-blocks' ? 1.02 : shotKind === 'quiet-tableau' ? 1.12 : 1.22
      var zoomSpan = shotKind === 'poster-blocks' ? 0.16 : shotKind === 'quiet-tableau' ? 0.2 : 0.26
      return {
        id: 'p' + paragraphIndex + '-s' + shotIndex,
        kind: shotKind,
        startTime: group[0].line.startTime,
        endTime: group[group.length - 1].renderEndTime,
        lineIndices: group.map(function (item) { return item.sourceIndex }),
        cues: buildCues(group),
        camera: {
          x: ((random & 255) / 255 - 0.5) * 0.18,
          y: (((random >>> 8) & 255) / 255 - 0.5) * 0.14,
          zoom: zoomBase + zoomRandom * zoomSpan,
          rotation: (((random >>> 24) & 255) / 255 - 0.5) * 0.08
        }
      }
    })
  }

  function compileSonnetProgram(lines, seed) {
    if (seed === undefined) seed = 'sonnet'
    var compiled = lines.map(function (line, sourceIndex) {
      return {
        sourceIndex: sourceIndex,
        line: line,
        // 可视化尾部可超出作者标注时值，但绝不侵入下一行
        renderEndTime: Math.max(
          line.startTime,
          Math.min(
            RenderHints.getLineRenderEndTime(line),
            sourceIndex + 1 < lines.length ? lines[sourceIndex + 1].startTime : Number.POSITIVE_INFINITY
          )
        ),
        segments: buildSonnetSemanticSegments(line)
      }
    })
    var paragraphGapThreshold = resolveSonnetParagraphGapThreshold(lines)
    var drafts = []
    var current = { lines: [], boundary: 'song-start' }

    compiled.forEach(function (line, index) {
      var previous = compiled[index - 1]
      var gap = previous ? line.line.startTime - previous.renderEndTime : 0
      var boundary = previous && metadataChanged(previous.line, line.line)
        ? 'metadata'
        : previous && gap >= paragraphGapThreshold
          ? 'time-gap'
          : null
      if (boundary && current.lines.length > 0) {
        var split = splitOversizedDraft(current)
        for (var i = 0; i < split.length; i += 1) drafts.push(split[i])
        current = { lines: [], boundary: boundary }
      }
      current.lines.push(line)
    })
    if (current.lines.length > 0) {
      var tail = splitOversizedDraft(current)
      for (var t = 0; t < tail.length; t += 1) drafts.push(tail[t])
    }

    var resolvedSeed = String(seed)
    var previousShot = null
    var previousTransition = null
    var paragraphs = drafts.map(function (draft, index) {
      var kind = classifyParagraph(draft.lines, index, drafts.length)
      var shots = buildShots(draft.lines, kind, index, resolvedSeed, previousShot)
      previousShot = shots.length > 0 ? shots[shots.length - 1].kind : previousShot
      var next = drafts[index + 1]
      var endTime = draft.lines[draft.lines.length - 1].renderEndTime
      var gap = next ? next.lines[0].line.startTime - endTime : 0
      var availableTransitions = Core.SONNET_TRANSITION_KINDS.slice()
      var transitionKind = next
        ? chooseWithoutRepeat(availableTransitions, resolvedSeed + ':' + index + ':transition', previousTransition)
        : null
      if (transitionKind) previousTransition = transitionKind
      var transitionDuration = next ? Math.min(0.3, Math.max(0.16, gap > 0 ? gap * 0.5 : 0.2)) : 0
      var transitionEndTime = next ? next.lines[0].line.startTime : endTime
      return {
        id: 'sonnet-p' + index,
        kind: kind,
        boundary: draft.boundary,
        startTime: draft.lines[0].line.startTime,
        endTime: endTime,
        lines: draft.lines,
        shots: shots,
        transitionOut: transitionKind ? {
          kind: transitionKind,
          startTime: Math.max(draft.lines[0].line.startTime, transitionEndTime - transitionDuration),
          endTime: transitionEndTime
        } : null
      }
    })

    return { version: 1, seed: resolvedSeed, paragraphGapThreshold: paragraphGapThreshold, paragraphs: paragraphs }
  }

  function findSonnetParagraphIndexAtTime(program, time) {
    for (var index = program.paragraphs.length - 1; index >= 0; index -= 1) {
      if (time >= program.paragraphs[index].startTime) return index
    }
    return 0
  }

  window.FoliaSonnetProgram = {
    SONNET_SHOT_KINDS: SONNET_SHOT_KINDS,
    buildSonnetSemanticSegments: buildSonnetSemanticSegments,
    compileSonnetProgram: compileSonnetProgram,
    findSonnetParagraphIndexAtTime: findSonnetParagraphIndexAtTime
  }
})()
