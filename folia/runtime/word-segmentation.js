// 词级分词：移植自 folia-major src/utils/lyrics/wordSegmentation.ts
// 全项目唯一的词粒度分词器：优先使用用户保存的分词（line.wordSegments），否则用 Intl.Segmenter。
// 本插件暂无用户分词编辑功能，实际总是走 Intl.Segmenter 路径，但保留 override 支持以便与原版结构一致。
(function () {
  'use strict'

  var PUNCTUATION_ONLY = /^[\s\p{P}\p{S}]+$/u

  function isWordLikeText(text) { return !PUNCTUATION_ONLY.test(text) }

  // 从裸边界列表重建完整分词记录
  function segmentsFromBoundaries(boundaries) {
    var cursor = 0
    return boundaries.map(function (segment) {
      var part = { segment: segment, index: cursor, isWordLike: isWordLikeText(segment) }
      cursor += segment.length
      return part
    })
  }

  // Intl.Segmenter 词级拆分；无 Segmenter 时回退到字形拆分（保持所有码元，偏移不错位）
  function segmentTextWords(text) {
    if (!text) return []

    var Segmenter = typeof Intl !== 'undefined' ? Intl.Segmenter : undefined
    if (Segmenter) {
      try {
        var out = []
        var seg = new Segmenter(undefined, { granularity: 'word' }).segment(text)
        var iter = seg[Symbol.iterator]()
        var res = iter.next()
        while (!res.done) {
          var part = res.value
          out.push({ segment: part.segment, index: part.index, isWordLike: part.isWordLike === undefined ? isWordLikeText(part.segment) : part.isWordLike })
          res = iter.next()
        }
        return out
      } catch (e) {
        // 走下面的字形回退
      }
    }

    return segmentsFromBoundaries(window.FoliaGraphemeTiming.splitLyricGraphemes(text))
  }

  // 校验已保存分词能否完整还原文本（不能则视为过期，忽略）
  function isValidWordSegmentation(text, boundaries) {
    return Array.isArray(boundaries)
      && boundaries.length > 0
      && boundaries.every(function (segment) { return typeof segment === 'string' })
      && boundaries.join('') === text
  }

  var EDGE_WHITESPACE = /^(\s*)(.*?)(\s*)$/su

  // 把已保存边界两端的空白拆成独立段，对齐 Intl.Segmenter 的输出形状
  function splitEdgeWhitespace(boundaries) {
    var out = []
    boundaries.forEach(function (boundary) {
      var match = EDGE_WHITESPACE.exec(boundary)
      if (!match) { out.push(boundary); return }
      var lead = match[1], core = match[2], trail = match[3]
      if (core) {
        if (lead) out.push(lead)
        out.push(core)
        if (trail) out.push(trail)
      } else {
        out.push(boundary)
      }
    })
    return out
  }

  // 行的词分词：优先有效的人工分词，否则 Intl.Segmenter
  function segmentLyricWords(line) {
    if (isValidWordSegmentation(line.fullText, line.wordSegments)) {
      return segmentsFromBoundaries(splitEdgeWhitespace(line.wordSegments))
    }
    return segmentTextWords(line.fullText)
  }

  // 行分词指纹（边界长度拼接），用于布局缓存键
  function getWordSegmentationKey(line) {
    return line.wordSegments ? line.wordSegments.map(function (s) { return s.length }).join(',') : ''
  }

  // 该行是否使用了人工分词
  function hasWordSegmentationOverride(line) {
    return isValidWordSegmentation(line.fullText, line.wordSegments)
  }

  window.FoliaWordSegmentation = {
    segmentsFromBoundaries: segmentsFromBoundaries,
    segmentTextWords: segmentTextWords,
    isValidWordSegmentation: isValidWordSegmentation,
    segmentLyricWords: segmentLyricWords,
    getWordSegmentationKey: getWordSegmentationKey,
    hasWordSegmentationOverride: hasWordSegmentationOverride
  }
})()
