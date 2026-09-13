// 逐字（字形级）时间轴构建：移植自 folia-major src/utils/lyrics/graphemeTiming.ts
// 从解析出的词级时间推导字形时间，不负责可视化动画曲线本身。
(function () {
  'use strict'

  var graphemeSegmenter = (typeof Intl !== 'undefined' && Intl.Segmenter)
    ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    : null

  // 把文本按字形（grapheme）拆开，中文逐字、emoji 不裂开
  function splitLyricGraphemes(text) {
    if (!text) return []
    if (graphemeSegmenter) {
      var out = []
      var iter = graphemeSegmenter.segment(text)[Symbol.iterator]()
      var res = iter.next()
      while (!res.done) { out.push(res.value.segment); res = iter.next() }
      return out
    }
    return Array.from(text)
  }

  // 给一段文本构建均匀分配的字形时间
  function buildEvenGraphemeTimings(text, startTime, endTime, wordIndex) {
    var graphemes = splitLyricGraphemes(text)
    if (graphemes.length === 0) return []

    var duration = Math.max(endTime - startTime, 0)
    var unitDuration = duration / graphemes.length

    return graphemes.map(function (char, index) {
      var timing = {
        char: char,
        startTime: startTime + unitDuration * index,
        endTime: index === graphemes.length - 1 ? endTime : startTime + unitDuration * (index + 1)
      }
      if (typeof wordIndex === 'number') timing.wordIndex = wordIndex
      return timing
    })
  }

  // 单词的字形时间轴：优先使用音节时间，没有则均匀切分
  function buildWordGraphemeTimings(word, wordIndex) {
    if (!word.syllables || !word.syllables.length) {
      return buildEvenGraphemeTimings(word.text, word.startTime, word.endTime, wordIndex)
    }

    var out = []
    word.syllables.forEach(function (syllable) {
      var parts = buildEvenGraphemeTimings(syllable.text, syllable.startTime, syllable.endTime, wordIndex)
      out = out.concat(parts)
    })
    return out
  }

  // 在 source 字形数组中查找 target 序列首次出现的位置
  function findGraphemeSequence(source, target, fromIndex) {
    if (target.length === 0) return fromIndex

    for (var index = fromIndex; index <= source.length - target.length; index += 1) {
      var matched = true
      for (var targetIndex = 0; targetIndex < target.length; targetIndex += 1) {
        if (source[index + targetIndex] !== target[targetIndex]) { matched = false; break }
      }
      if (matched) return index
    }

    return -1
  }

  // 把词级时间映射回完整展示行（包括解析词中不存在的空格与标点）
  function buildLineGraphemeTimeline(line) {
    var lineGraphemes = splitLyricGraphemes(line.fullText)
    if (lineGraphemes.length === 0) return []

    if (!line.words || line.words.length === 0) {
      return buildEvenGraphemeTimings(line.fullText, line.startTime, line.endTime)
    }

    var timeline = []
    var cursor = 0
    var lastResolvedTime = line.startTime

    line.words.forEach(function (word, wordIndex) {
      var wordGraphemes = splitLyricGraphemes(word.text)
      if (wordGraphemes.length === 0) return

      var matchedStart = findGraphemeSequence(lineGraphemes, wordGraphemes, cursor)
      var start = matchedStart >= 0 ? matchedStart : cursor
      var end = Math.min(start + wordGraphemes.length, lineGraphemes.length)

      // 词之间的空隙（空格/标点）跟随当前词的起点时间
      for (var gapIndex = cursor; gapIndex < start; gapIndex += 1) {
        timeline[gapIndex] = {
          char: lineGraphemes[gapIndex],
          startTime: word.startTime,
          endTime: word.startTime
        }
      }

      var wordTimings = buildWordGraphemeTimings(word, wordIndex)
      for (var localIndex = 0; localIndex < end - start; localIndex += 1) {
        var timing = wordTimings[localIndex]
        if (!timing && wordGraphemes[localIndex]) {
          var single = buildEvenGraphemeTimings(wordGraphemes[localIndex], word.startTime, word.endTime, wordIndex)
          timing = single[0]
        }
        if (!timing) continue

        timing = Object.assign({}, timing, { char: lineGraphemes[start + localIndex] })
        timeline[start + localIndex] = timing
        lastResolvedTime = Math.max(lastResolvedTime, timing.endTime)
      }

      cursor = Math.max(cursor, end)
    })

    // 兜底：行尾剩余字形跟随最后已解析时间
    for (var index = 0; index < lineGraphemes.length; index += 1) {
      if (timeline[index]) continue
      timeline[index] = {
        char: lineGraphemes[index],
        startTime: lastResolvedTime,
        endTime: lastResolvedTime
      }
    }

    return timeline
  }

  window.FoliaGraphemeTiming = {
    splitLyricGraphemes: splitLyricGraphemes,
    buildWordGraphemeTimings: buildWordGraphemeTimings,
    buildLineGraphemeTimeline: buildLineGraphemeTimeline
  }
})()
