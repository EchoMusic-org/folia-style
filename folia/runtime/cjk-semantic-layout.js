// CJK 语义布局单元：移植自 folia-major src/utils/lyrics/cjkSemanticLayout.ts
// 在歌词已解析为 Line.words 之后构建"展示规划层"：可把解析词碎片分组为语义单元/粘着标点单元，
// 同时保留原始 words 供逐字计时使用。
//
// 例：解析词 [It][’][s][unbelievable] → 粘着单元 It’s(words=[It,’,s]) + unbelievable
// 例：解析词 [世][界][。]           → 语义单元 世界。(words=[世,界,。])
(function () {
  'use strict'

  var WordSegmentation = window.FoliaWordSegmentation

  var CJK_REGEX = /[\u4e00-\u9fa5\u3040-\u30ff\uac00-\ud7af]/
  var WHITESPACE_REGEX = /^\s+$/
  var APOSTROPHE_ONLY_REGEX = /^['’]\s*$/
  var CONTRACTION_SUFFIX_REGEX = /^(s|t|m|d|ll|re|ve|em)\s*$/i
  var DIRECT_CONTRACTION_REGEX = /^['’](s|t|m|d|ll|re|ve|em)\s*$/i
  var TRAILING_APOSTROPHE_REGEX = /['’]\s*$/
  var TRAILING_WORD_CHAR_REGEX = /[\p{L}\p{N}]$/u
  var INLINE_CONTRACTION_REGEX = /[\p{L}\p{N}]+['’](s|t|m|d|ll|re|ve|em)/iu
  var STICKY_TRAILING_PUNCTUATION_REGEX = /^[,.;:!?，。！？、：；）】》」』〉〕］)}\]"'’”’]+$/u

  function hasCjkText(text) { return CJK_REGEX.test(text) }

  // 每个解析词一个布局单元（基础形态）
  function createSingleWordLayoutUnits(words) {
    return words.map(function (word) {
      return { text: word.text, words: [word], startTime: word.startTime, endTime: word.endTime, isSemantic: false }
    })
  }

  function getWordSegments(line) {
    var segments = WordSegmentation.segmentLyricWords(line)
    return segments.length > 0
      ? segments.map(function (s) { return { segment: s.segment, isWordLike: s.isWordLike } })
      : null
  }

  function appendWordsToUnit(unit, text, words) {
    unit.text += text
    unit.words = unit.words.concat(words)
    var lastWord = words[words.length - 1]
    unit.endTime = lastWord ? lastWord.endTime : unit.endTime
  }

  function cloneUnit(unit) {
    return Object.assign({}, unit, { words: unit.words.slice() })
  }

  function appendUnitToStickyUnit(target, unit) {
    target.text += unit.text
    target.words = target.words.concat(unit.words)
    target.endTime = unit.endTime
    target.isSticky = true
  }

  function canAttachToPrevious(text) { return TRAILING_WORD_CHAR_REGEX.test(text.trimEnd()) }
  function endsWithApostrophe(text) { return TRAILING_APOSTROPHE_REGEX.test(text.trimEnd()) }
  function isApostropheOnlyUnit(unit) { return APOSTROPHE_ONLY_REGEX.test(unit.text.trim()) }
  function isContractionSuffixUnit(unit) { return CONTRACTION_SUFFIX_REGEX.test(unit.text.trim()) }
  function isDirectContractionUnit(unit) { return DIRECT_CONTRACTION_REGEX.test(unit.text.trim()) }
  function isStickyTrailingPunctuationUnit(unit) { return STICKY_TRAILING_PUNCTUATION_REGEX.test(unit.text.trim()) }

  function hasAttachedTrailingPunctuation(unit) {
    if (unit.words.length <= 1) return false
    var lastWord = unit.words[unit.words.length - 1]
    if (!lastWord) return false
    return isStickyTrailingPunctuationUnit({ text: lastWord.text, words: [lastWord], startTime: lastWord.startTime, endTime: lastWord.endTime, isSemantic: false })
  }

  function hasInlineContraction(unit) {
    return unit.words.length > 1 && !unit.isSemantic && INLINE_CONTRACTION_REGEX.test(unit.text)
  }

  // 把 Intl.Segmenter 输出映射回解析词。任一分段无法精确对齐时返回 null（调用方回退到单词单元）
  function mapSegmentsToWords(segments, words) {
    var units = []
    var wordIndex = 0

    for (var i = 0; i < segments.length; i += 1) {
      var segment = segments[i]
      var segmentText = segment.segment
      if (!segmentText || WHITESPACE_REGEX.test(segmentText)) continue

      var startWordIndex = wordIndex
      var collectedText = ''

      while (wordIndex < words.length && collectedText.length < segmentText.length) {
        collectedText += words[wordIndex].text
        wordIndex += 1
        if (segmentText.indexOf(collectedText) !== 0) return null
      }

      if (collectedText !== segmentText) return null

      var segmentWords = words.slice(startWordIndex, wordIndex)
      var firstWord = segmentWords[0]
      var lastWord = segmentWords[segmentWords.length - 1]
      if (!firstWord || !lastWord) return null

      if (!segment.isWordLike && units.length > 0) {
        appendWordsToUnit(units[units.length - 1], segmentText, segmentWords)
        continue
      }

      units.push({
        text: segmentText,
        words: segmentWords,
        startTime: firstWord.startTime,
        endTime: lastWord.endTime,
        isSemantic: Boolean(segment.isWordLike && hasCjkText(segmentText) && segmentWords.length > 1)
      })
    }

    if (wordIndex !== words.length || units.length === 0) return null

    return units
  }

  // CJK 语义分组（不做粘着标点，保持旧行为）
  function buildCjkSemanticLayoutUnits(line) {
    if (!line.words || line.words.length === 0) return []

    var fallbackUnits = createSingleWordLayoutUnits(line.words)
    // CJK 门控：Intl.Segmenter 只对无空格文字提供增量信息；人工分词在任何文字下都跳过该门控
    if (!hasCjkText(line.fullText) && !WordSegmentation.hasWordSegmentationOverride(line)) {
      return fallbackUnits
    }

    var segments = getWordSegments(line)
    if (!segments) return fallbackUnits

    var mapped = mapSegmentsToWords(segments, line.words)
    return mapped || fallbackUnits
  }

  // 把标点类布局单元粘着到前一单元，避免 It / ’ / s 被放到不同视觉层
  function applyStickyPunctuationLayoutUnits(units) {
    var merged = []

    for (var index = 0; index < units.length; index += 1) {
      var current = units[index]
      var previous = merged[merged.length - 1]
      if (!previous) {
        merged.push(cloneUnit(current))
        continue
      }

      var next = units[index + 1]
      if (
        isApostropheOnlyUnit(current)
        && next
        && canAttachToPrevious(previous.text)
        && isContractionSuffixUnit(next)
      ) {
        appendUnitToStickyUnit(previous, current)
        appendUnitToStickyUnit(previous, next)
        index += 1
        continue
      }

      if (isDirectContractionUnit(current) && canAttachToPrevious(previous.text)) {
        appendUnitToStickyUnit(previous, current)
        continue
      }

      if (isContractionSuffixUnit(current) && endsWithApostrophe(previous.text)) {
        appendUnitToStickyUnit(previous, current)
        continue
      }

      if (isStickyTrailingPunctuationUnit(current) && canAttachToPrevious(previous.text)) {
        appendUnitToStickyUnit(previous, current)
        continue
      }

      merged.push(cloneUnit(current))
    }

    return merged.map(function (unit) {
      return (hasAttachedTrailingPunctuation(unit) || hasInlineContraction(unit))
        ? Object.assign({}, unit, { isSticky: true })
        : unit
    })
  }

  // 解析后布局准备主入口：先语义分组，再粘着标点（顺序不可换）
  function buildPostLyricLayoutUnits(line, options) {
    options = options || {}
    var rawUnits = options.semantic
      ? buildCjkSemanticLayoutUnits(line)
      : createSingleWordLayoutUnits(line.words)

    return options.sticky
      ? applyStickyPunctuationLayoutUnits(rawUnits)
      : rawUnits
  }

  // 布局单元 → 渲染词：粘着的非语义单元合并为一个词（It + ’ + s → It’s）；
  // 语义 CJK 单元保留原 words 以维持逐字计时
  function buildDisplayWordsFromLayoutUnits(units) {
    var out = []
    units.forEach(function (unit) {
      if (!unit.isSticky || unit.isSemantic) {
        out = out.concat(unit.words)
        return
      }
      out.push({ text: unit.text, startTime: unit.startTime, endTime: unit.endTime })
    })
    return out
  }

  window.FoliaCjkSemanticLayout = {
    createSingleWordLayoutUnits: createSingleWordLayoutUnits,
    buildCjkSemanticLayoutUnits: buildCjkSemanticLayoutUnits,
    applyStickyPunctuationLayoutUnits: applyStickyPunctuationLayoutUnits,
    buildPostLyricLayoutUnits: buildPostLyricLayoutUnits,
    buildDisplayWordsFromLayoutUnits: buildDisplayWordsFromLayoutUnits
  }
})()
