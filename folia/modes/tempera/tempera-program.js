// 凝彩模式·程序编译：移植自 folia-major src/components/visualizer/tempera/temperaProgram.ts
// 把统一歌词编译成 seek 安全、确定性的色块 PV 时间轴（段落 / shot / slice）。
// 依赖 runtime 的词分词（FoliaWordSegmentation）、字形时间（FoliaGraphemeTiming）
// 与渲染尾部提示（FoliaRenderHints）。
(function () {
  'use strict'

  var Core = window.FoliaTemperaCore
  var Profiles = window.FoliaTemperaProfiles
  var GraphemeTiming = window.FoliaGraphemeTiming
  var WordSegmentation = window.FoliaWordSegmentation
  var RenderHints = window.FoliaRenderHints
  var hashTemperaSeed = Core.hashTemperaSeed
  var mixTemperaSeed = Core.mixTemperaSeed
  var temperaHash01 = Core.temperaHash01
  var chooseWithoutRepeat = Core.chooseWithoutRepeat

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value))
  }

  function median(values) {
    if (values.length === 0) return 0.5
    var sorted = values.slice().sort(function (a, b) { return a - b })
    var middle = Math.floor(sorted.length / 2)
    return sorted.length % 2 === 0
      ? ((sorted[middle - 1] !== undefined ? sorted[middle - 1] : sorted[middle]) + sorted[middle]) / 2
      : sorted[middle]
  }

  // 段落间隔阈值：由全曲行间隙的中位数推导
  function resolveTemperaParagraphGapThreshold(lines) {
    var gaps = []
    for (var i = 1; i < lines.length; i += 1) {
      var gap = lines[i].startTime - Math.min(RenderHints.getLineRenderEndTime(lines[i - 1]), lines[i].startTime)
      if (gap > 0) gaps.push(gap)
    }
    return clamp(median(gaps) * 2.5, 1.25, 3.5)
  }

  var PUNCTUATION_ONLY = /^[\s\p{P}\p{S}]+$/u

  function metadataChanged(previous, next) {
    return (previous.blockIndex !== undefined && next.blockIndex !== undefined && previous.blockIndex !== next.blockIndex)
      || (previous.songPart !== undefined && next.songPart !== undefined && previous.songPart !== next.songPart)
  }

  // 生成无损的词级片段，同时把展示偏移映射到 parser 派生的字形时间；
  // 粘性标点向前合并，块上不会孤悬符号
  function buildTemperaSegments(line) {
    if (!line.fullText) return []
    var timeline = GraphemeTiming.buildLineGraphemeTimeline(line)
    var cursor = 0
    var ranges = GraphemeTiming.splitLyricGraphemes(line.fullText).map(function (grapheme) {
      var range = { start: cursor, end: cursor + grapheme.length }
      cursor = range.end
      return range
    })
    var parts = WordSegmentation.segmentLyricWords(line)
    var segments = parts.map(function (part, index) {
      var startOffset = part.index
      var endOffset = parts[index + 1] !== undefined ? parts[index + 1].index : line.fullText.length
      var indices = []
      ranges.forEach(function (range, rangeIndex) {
        if (range.end > startOffset && range.start < endOffset) indices.push(rangeIndex)
      })
      var graphemes = indices.map(function (graphemeIndex) { return timeline[graphemeIndex] }).filter(Boolean)
      return {
        text: line.fullText.slice(startOffset, endOffset),
        startOffset: startOffset,
        endOffset: endOffset,
        graphemes: graphemes,
        startTime: graphemes[0] ? graphemes[0].startTime : line.startTime,
        endTime: graphemes[graphemes.length - 1] ? graphemes[graphemes.length - 1].endTime : line.endTime,
        isWordLike: part.isWordLike
      }
    })

    var sticky = []
    segments.forEach(function (segment) {
      var previous = sticky.length > 0 ? sticky[sticky.length - 1] : null
      if (previous && !segment.isWordLike && !/^\s+$/u.test(segment.text)) {
        previous.text += segment.text
        previous.endOffset = segment.endOffset
        // 标点没有自己的时间：parser 的词从不覆盖它，字形时间轴把它零长度地
        // 钉在*下一个*词的起点上。不重新计时就在这里合并，会让逗号与它后面
        // 那个词同时到达，还把本段 endTime 拖到那个词的起点上。
        // 只移动没有时间的那些；parser 覆盖过的标点保留自己的
        var tail = previous.endTime
        var merged = segment.graphemes.map(function (grapheme) {
          return grapheme.endTime > grapheme.startTime
            ? grapheme
            : Object.assign({}, grapheme, { startTime: tail, endTime: tail })
        })
        merged.forEach(function (grapheme) { previous.graphemes.push(grapheme) })
        previous.endTime = merged.reduce(function (max, grapheme) { return Math.max(max, grapheme.endTime) }, previous.endTime)
      } else {
        sticky.push(Object.assign({}, segment, { graphemes: segment.graphemes.slice() }))
      }
    })
    return sticky
  }

  // 过大草稿的再切分（段落最多 6 行 / 18 秒）
  function splitOversizedDraft(draft) {
    var output = []
    var remaining = draft.lines
    var boundary = draft.boundary
    var loopGuard = 0
    while (remaining.length > 6 || (remaining.length > 1 && (remaining[remaining.length - 1].renderEndTime - remaining[0].line.startTime) > 18)) {
      loopGuard += 1
      if (loopGuard > 1000) {
        console.error('splitOversizedDraft: 检测到无限循环，中断')
        break
      }
      var candidates = []
      for (var i = 2; i < remaining.length - 1; i += 1) {
        var offset = i - 2
        candidates.push({
          splitIndex: offset + 2,
          gap: remaining[i].line.startTime - remaining[offset + 1].renderEndTime
        })
      }
      var validCandidates = candidates.filter(function (candidate) { return !Number.isNaN(candidate.gap) })
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
    if (lines.some(function (item) { return item.line.isChorus || /chorus|副歌/i.test(item.line.songPart || '') })) return 'chorus'
    if (lines.some(function (item) { return /bridge|break|間奏|ブリッジ/i.test(item.line.songPart || '') })) return 'break'
    if (index === total - 1) return 'outro'
    var duration = lines[lines.length - 1].renderEndTime - lines[0].line.startTime
    var segmentCount = lines.reduce(function (sum, line) {
      return sum + line.segments.filter(function (segment) { return segment.isWordLike }).length
    }, 0)
    var punctuationCount = lines.reduce(function (sum, line) {
      var matches = (line.line.fullText || '').match(/[!?！？…]/g)
      return sum + (matches ? matches.length : 0)
    }, 0)
    if (duration <= 3.5 || segmentCount <= 3) return 'breath'
    if (punctuationCount >= 2 || segmentCount / Math.max(duration, 1) > 2.5) return 'lift'
    return 'verse'
  }

  function isRenderableSegment(segment) {
    return segment.text.trim().length > 0 && segment.graphemes.length > 0
  }

  // 成为 shot 的歌词块。wholeLineLyrics 关闭时，块一旦攒到种子选定的 2..4 词
  // 或跑了约 2.2s 就收口；整句模式把每个可渲染片段留在同一块里
  function buildShotChunks(lines, seed, paragraphIndex, wholeLineLyrics) {
    var chunks = []
    lines.forEach(function (line) {
      var usable = []
      line.segments.forEach(function (segment, index) {
        if (isRenderableSegment(segment)) usable.push({ segment: segment, index: index })
      })
      if (usable.length === 0) return

      if (wholeLineLyrics) {
        var first = usable[0]
        var last = usable[usable.length - 1]
        chunks.push({
          lineIndex: line.sourceIndex,
          segmentStart: first.index,
          segmentEnd: last.index + 1,
          startTime: first.segment.startTime,
          endTime: Math.max(last.segment.endTime, first.segment.startTime + 0.2),
          // 会在下面的平铺过程中保留；见 TemperaShot.lyricEndTime
          lyricEndTime: Math.max(last.segment.endTime, first.segment.startTime + 0.2)
        })
        return
      }

      var segmentStart = usable[0].index
      var startTime = usable[0].segment.startTime
      var words = 0
      usable.forEach(function (entry, order) {
        words += 1
        var chunkSeed = hashTemperaSeed(seed + ':' + paragraphIndex + ':' + line.sourceIndex + ':' + chunks.length)
        var target = 2 + Math.floor(temperaHash01(chunkSeed, 1, 179) * 3)
        var spent = entry.segment.endTime - startTime
        var isLast = order === usable.length - 1
        if (!isLast && words < target && spent < 2.2) return

        chunks.push({
          lineIndex: line.sourceIndex,
          segmentStart: segmentStart,
          segmentEnd: entry.index + 1,
          startTime: startTime,
          endTime: Math.max(entry.segment.endTime, startTime + 0.2),
          lyricEndTime: Math.max(entry.segment.endTime, startTime + 0.2)
        })
        var next = usable[order + 1]
        if (next) {
          segmentStart = next.index
          startTime = next.segment.startTime
          words = 0
        }
      })
    })
    // 平铺时间轴：每个 shot 跑到下一个打开为止，运行时的
    // 「startTime 已过的最后一个 shot」查找就不会落进空洞。lyricEndTime 刻意
    // 不参与平铺——它是本块最后一个字素停下的时刻，入场错峰必须对着它排期
    return chunks.map(function (chunk, index) {
      var nextChunk = chunks[index + 1]
      return Object.assign({}, chunk, {
        endTime: Math.max(chunk.startTime + 0.2, nextChunk !== undefined ? nextChunk.startTime : chunk.endTime)
      })
    })
  }

  // 方向永远来自 shot 的 flow 角；档案只设定镜头沿它走多远、zoom 如何爬坡
  function buildCameraKeys(kind, seed, flowAngle) {
    var jitterX = (temperaHash01(seed, 1, 11) - 0.5) * 0.02
    var jitterY = (temperaHash01(seed, 2, 23) - 0.5) * 0.02
    var jitterZoom = temperaHash01(seed, 3, 37) * 0.025
    var jitterRotation = (temperaHash01(seed, 4, 51) - 0.5) * 0.012
    var camera = Profiles.resolveTemperaShotProfile(kind).camera
    var travelX = Math.cos(flowAngle) * camera.travel
    var travelY = Math.sin(flowAngle) * camera.travel
    return {
      start: {
        x: -travelX / 2 + jitterX,
        y: -travelY / 2 + jitterY,
        zoom: camera.zoomStart + jitterZoom,
        rotation: jitterRotation
      },
      end: {
        x: travelX / 2 + jitterX,
        y: travelY / 2 + jitterY,
        zoom: camera.zoomEnd + jitterZoom,
        rotation: -jitterRotation
      }
    }
  }

  // 挑选漂在稀疏构图边角的碎字；它们取自本 shot 不在排的歌词，
  // 所以碎字永远属于这首歌而不与屏幕上已有的字重复。空池自然什么都不给
  function buildDecorFragments(pool, count, seed) {
    var chars = Array.from(pool).filter(function (char) {
      return char.trim().length > 0 && !PUNCTUATION_ONLY.test(char)
    })
    if (chars.length === 0 || count <= 0) return []
    var fragments = []
    for (var index = 0; index < count; index += 1) {
      var char = chars[Math.floor(temperaHash01(seed, index, 13) * chars.length) % chars.length]
      var onLeft = temperaHash01(seed, index, 29) > 0.5
      var edge = 0.03 + temperaHash01(seed, index, 41) * 0.13
      fragments.push({
        char: char,
        x: onLeft ? edge : 1 - edge,
        y: 0.08 + temperaHash01(seed, index, 53) * 0.84,
        rotation: (temperaHash01(seed, index, 67) - 0.5) * 0.5,
        scale: 0.26 + temperaHash01(seed, index, 71) * 0.2
      })
    }
    return fragments
  }

  // 为 shot 挑超大装饰词。它取自本 shot *没有*在排的词，
  // 所以水印读作歌词周围的短语而不是它的复制品。吵闹的构图跳过它：它们已有一个主导形状
  function buildDecorWatermark(pool, seed, allowed) {
    var words = pool.map(function (word) { return word.trim() })
      .filter(function (word) { return word.length > 0 && word.length <= 12 })
    if (!allowed || words.length === 0 || temperaHash01(seed, 4, 107) > 0.62) return null
    return {
      text: words[Math.floor(temperaHash01(seed, 5, 109) * words.length) % words.length],
      x: 0.28 + temperaHash01(seed, 6, 113) * 0.44,
      y: 0.26 + temperaHash01(seed, 7, 127) * 0.48,
      rotation: (temperaHash01(seed, 8, 131) - 0.5) * 0.5,
      scale: 2.6 + temperaHash01(seed, 9, 137) * 1.9
    }
  }

  // 编译期解析一个 shot 的网点装饰：motif、hatch 角、贯穿线数量与边角碎字
  // 全部由种子派生，渲染层保持确定性
  function buildDecorSpec(paragraphKind, shotKind, seedKey, fragmentPool, watermarkPool, previousMotif) {
    var seed = hashTemperaSeed(seedKey)
    var motif = chooseWithoutRepeat(Core.TEMPERA_DECOR_MOTIFS, seedKey, previousMotif)
    var profile = Profiles.resolveTemperaShotProfile(shotKind)
    var sparse = profile.mood === 'quiet' || paragraphKind === 'break' || paragraphKind === 'outro'
    return {
      motif: motif,
      // 只有浅斜线；后处理的颗粒落上来之后，陡 hatch 读作噪声
      hatchAngle: (temperaHash01(seed, 1, 83) - 0.5) * (Math.PI / 2),
      crossCount: 1 + Math.floor(temperaHash01(seed, 2, 89) * 3),
      scribbleSeed: mixTemperaSeed(seed, 97),
      fragments: sparse
        ? buildDecorFragments(fragmentPool, 3 + Math.floor(temperaHash01(seed, 3, 101) * 3), seed)
        : [],
      watermark: buildDecorWatermark(watermarkPool, seed, profile.mood !== 'loud')
    }
  }

  // 纵向是 Tempera 的主场轴：构图以互相滑过的方式交接，
  // 大致纵向的 flow 让它读作潜入一个场景而非横向幻灯片。
  // 每个 shot 稍微转向并被拉回轴向
  function resolveFlowAngle(previous, seed) {
    if (previous === null) {
      var sign = temperaHash01(seed, 6, 71) > 0.5 ? 1 : -1
      return sign * Math.PI / 2 + (temperaHash01(seed, 8, 79) - 0.5) * 0.4
    }
    var axis = (Math.sin(previous) >= 0 ? 1 : -1) * Math.PI / 2
    return previous + (axis - previous) * 0.3 + (temperaHash01(seed, 7, 73) - 0.5) * 0.5
  }

  function buildShots(lines, songLines, kind, paragraphIndex, seed, previousKind, previousMotif, previousFlow, wholeLineLyrics) {
    var lastKind = previousKind
    var lastMotif = previousMotif
    var lastFlow = previousFlow
    var paragraphEnd = lines.length > 0 ? lines[lines.length - 1].renderEndTime : 0
    var chunks = buildShotChunks(lines, seed, paragraphIndex, wholeLineLyrics)
    var byIndex = new Map()
    lines.forEach(function (line) { byIndex.set(line.sourceIndex, line) })

    return chunks.map(function (chunk, shotIndex) {
      var line = byIndex.get(chunk.lineIndex)
      var sliceSegments = line ? line.segments.slice(chunk.segmentStart, chunk.segmentEnd) : []
      var sliceText = sliceSegments.map(function (segment) { return segment.text }).join('')
      var wordCount = sliceSegments.filter(function (segment) { return segment.isWordLike }).length
      // 换气段落读作稀疏构图；副歌从不低语
      var sparse = kind === 'breath' || (kind !== 'chorus' && wordCount <= 2)
      var moods = sparse
        ? ['quiet']
        : kind === 'chorus'
          ? ['neutral', 'loud']
          : ['quiet', 'neutral', 'loud']
      var shotKind = chooseWithoutRepeat(
        Profiles.resolveTemperaShotCandidates(moods),
        seed + ':' + paragraphIndex + ':' + shotIndex + ':' + sliceText,
        lastKind
      )
      lastKind = shotKind

      var cameraSeed = hashTemperaSeed(seed + ':' + paragraphIndex + ':' + shotIndex + ':camera')
      var flowAngle = resolveFlowAngle(lastFlow, cameraSeed)
      lastFlow = flowAngle
      var cameraKeys = buildCameraKeys(shotKind, cameraSeed, flowAngle)

      // 边角碎字与水印取自段落的其余部分，绝不取本 shot 已在展示的词。
      // 一个 shot 覆盖整行——整句模式的常态——的单行段落便一无所剩，
      // 于是向全曲其余部分借，而不是回显屏上的字。连那也是空的，池就空着，
      // 装饰自然丢掉碎字与水印
      var outsideSlice = []
      lines.forEach(function (item) {
        if (item.sourceIndex === chunk.lineIndex) {
          item.segments.forEach(function (segment, index) {
            if (index < chunk.segmentStart || index >= chunk.segmentEnd) outsideSlice.push(segment)
          })
        } else {
          outsideSlice = outsideSlice.concat(item.segments)
        }
      })
      var decorPool = outsideSlice.length > 0
        ? outsideSlice
        : songLines.reduce(function (acc, item) {
          if (item.sourceIndex === chunk.lineIndex) return acc
          return acc.concat(item.segments)
        }, [])
      var fragmentPool = decorPool.map(function (segment) { return segment.text }).join('')
      var watermarkPool = decorPool
        .filter(function (segment) { return segment.isWordLike })
        .map(function (segment) { return segment.text })
      var decor = buildDecorSpec(
        kind,
        shotKind,
        seed + ':' + paragraphIndex + ':' + shotIndex + ':decor',
        fragmentPool,
        watermarkPool,
        lastMotif
      )
      lastMotif = decor.motif

      return {
        id: 'p' + paragraphIndex + '-s' + shotIndex,
        kind: shotKind,
        startTime: chunk.startTime,
        // 收尾 shot 一直持到段落自己的渲染尾巴结束
        endTime: shotIndex === chunks.length - 1
          ? Math.max(chunk.endTime, paragraphEnd)
          : chunk.endTime,
        lyricEndTime: chunk.lyricEndTime,
        slices: [{
          lineIndex: chunk.lineIndex,
          segmentStart: chunk.segmentStart,
          segmentEnd: chunk.segmentEnd
        }],
        isBridge: false,
        camera: cameraKeys.start,
        cameraEnd: cameraKeys.end,
        flowAngle: flowAngle,
        decor: decor
      }
    })
  }

  // 比这更短的间隙已由段落转场本身覆盖
  var BRIDGE_MIN_GAP = 1.2
  var BRIDGE_MAX_LENGTH = 5

  // 用无歌词的 shot 填充器乐间隙。它们走与其他 shot 完全相同的交接、镜头与
  // 装饰机制，长间隙因此保持运动而不是死持最后一帧唱词构图——
  // 远端的段落转场也有东西可带
  function buildBridgeShots(paragraphKind, paragraphIndex, seed, fragmentPool, gapStart, gapEnd, previousKind, previousMotif, previousFlow) {
    var gap = gapEnd - gapStart
    if (gap < BRIDGE_MIN_GAP) return []
    var count = Math.min(3, Math.max(1, Math.ceil(gap / BRIDGE_MAX_LENGTH)))
    var step = gap / count
    var lastKind = previousKind
    var lastMotif = previousMotif
    var lastFlow = previousFlow

    var shots = []
    for (var index = 0; index < count; index += 1) {
      // 器乐拍子永远不是歌里最吵的东西
      var shotKind = chooseWithoutRepeat(
        Profiles.resolveTemperaShotCandidates(['quiet', 'neutral']),
        seed + ':' + paragraphIndex + ':bridge' + index,
        lastKind
      )
      lastKind = shotKind
      var cameraSeed = hashTemperaSeed(seed + ':' + paragraphIndex + ':bridge' + index + ':camera')
      var flowAngle = resolveFlowAngle(lastFlow, cameraSeed)
      lastFlow = flowAngle
      var cameraKeys = buildCameraKeys(shotKind, cameraSeed, flowAngle)
      var decor = buildDecorSpec(
        paragraphKind,
        shotKind,
        seed + ':' + paragraphIndex + ':bridge' + index + ':decor',
        fragmentPool,
        [],
        lastMotif
      )
      lastMotif = decor.motif
      shots.push({
        id: 'p' + paragraphIndex + '-b' + index,
        kind: shotKind,
        startTime: gapStart + step * index,
        endTime: gapStart + step * (index + 1),
        // 桥没有歌词，图形按整个间隙排期
        lyricEndTime: gapStart + step * (index + 1),
        slices: [],
        isBridge: true,
        camera: cameraKeys.start,
        cameraEnd: cameraKeys.end,
        flowAngle: flowAngle,
        decor: decor
      })
    }
    return shots
  }

  // options: { wholeLineLyrics?: boolean }
  function compileTemperaProgram(lines, seed, options) {
    if (seed === undefined) seed = 'tempera'
    options = options || {}
    var compiled = lines.map(function (line, sourceIndex) {
      return {
        sourceIndex: sourceIndex,
        line: line,
        // 视觉尾巴可以越过原始时序，但绝不越过下一行
        renderEndTime: Math.max(
          line.startTime,
          Math.min(
            RenderHints.getLineRenderEndTime(line),
            lines[sourceIndex + 1] !== undefined ? lines[sourceIndex + 1].startTime : Number.POSITIVE_INFINITY
          )
        ),
        segments: buildTemperaSegments(line)
      }
    })
    var paragraphGapThreshold = resolveTemperaParagraphGapThreshold(lines)
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
        drafts.push.apply(drafts, splitOversizedDraft(current))
        current = { lines: [], boundary: boundary }
      }
      current.lines.push(line)
    })
    if (current.lines.length > 0) drafts.push.apply(drafts, splitOversizedDraft(current))

    var resolvedSeed = String(seed)
    var previousShot = null
    var previousMotif = null
    var previousFlow = null
    var previousTransition = null
    var paragraphs = drafts.map(function (draft, index) {
      var kind = classifyParagraph(draft.lines, index, drafts.length)
      var lyricShots = buildShots(
        draft.lines,
        compiled,
        kind,
        index,
        resolvedSeed,
        previousShot,
        previousMotif,
        previousFlow,
        options.wholeLineLyrics === true
      )
      if (lyricShots.length > 0) {
        previousShot = lyricShots[lyricShots.length - 1].kind
        previousMotif = lyricShots[lyricShots.length - 1].decor.motif
        previousFlow = lyricShots[lyricShots.length - 1].flowAngle
      }
      var next = drafts[index + 1]
      var endTime = draft.lines[draft.lines.length - 1].renderEndTime
      var gap = next ? next.lines[0].line.startTime - endTime : 0
      // 本段之后的器乐间隙变成它自己的无歌词 shot
      var bridgeShots = next
        ? buildBridgeShots(
          kind,
          index,
          resolvedSeed,
          draft.lines.map(function (item) { return item.line.fullText }).join(''),
          endTime,
          next.lines[0].line.startTime,
          previousShot,
          previousMotif,
          previousFlow
        )
        : []
      var shots = lyricShots.concat(bridgeShots)
      if (shots.length > 0) {
        previousShot = shots[shots.length - 1].kind
        previousMotif = shots[shots.length - 1].decor.motif
        previousFlow = shots[shots.length - 1].flowAngle
      }
      var transitionKind = next
        ? chooseWithoutRepeat(Core.TEMPERA_TRANSITION_KINDS, resolvedSeed + ':' + index + ':transition', previousTransition)
        : null
      if (transitionKind) previousTransition = transitionKind
      // 足以让图形带着切换走，但绝不吞掉出画段落尾部超过约 0.3s
      var transitionDuration = next ? Math.min(1, Math.max(0.35, Math.max(gap, 0) + 0.3)) : 0
      var transitionEndTime = next ? next.lines[0].line.startTime : endTime
      return {
        id: 'tempera-p' + index,
        kind: kind,
        boundary: draft.boundary,
        startTime: draft.lines[0].line.startTime,
        endTime: endTime,
        lines: draft.lines,
        shots: shots,
        transitionOut: transitionKind
          ? {
            kind: transitionKind,
            startTime: Math.max(draft.lines[0].line.startTime, transitionEndTime - transitionDuration),
            endTime: transitionEndTime
          }
          : null
      }
    })

    // 段落的开场构图在上一个还在转场出画时就开始搭建。没有这一步，
    // 落在歌词空隙里的边界处，入画场景只有纸底可看，
    // 平移类转场会滑进裸壳。逐字时序不受影响：只有 shot 自己的钟移动，
    // 字仍按被唱的时刻落位
    paragraphs.forEach(function (paragraph, index) {
      var incoming = paragraph.shots[0]
      var transition = index > 0 ? paragraphs[index - 1].transitionOut : null
      if (!incoming || !transition || transition.kind === 'block-wipe') return
      incoming.startTime = Math.min(
        incoming.startTime,
        Math.max(transition.startTime, paragraphs[index - 1].endTime)
      )
    })

    return { version: 1, seed: resolvedSeed, paragraphGapThreshold: paragraphGapThreshold, paragraphs: paragraphs }
  }

  function findTemperaParagraphIndexAtTime(program, time) {
    for (var index = program.paragraphs.length - 1; index >= 0; index -= 1) {
      if (time >= program.paragraphs[index].startTime) return index
    }
    return 0
  }

  window.FoliaTemperaProgram = {
    resolveTemperaParagraphGapThreshold: resolveTemperaParagraphGapThreshold,
    buildTemperaSegments: buildTemperaSegments,
    compileTemperaProgram: compileTemperaProgram,
    findTemperaParagraphIndexAtTime: findTemperaParagraphIndexAtTime
  }
})()
