// 关键词上色：移植自 folia-major src/components/visualizer/wordColoring.ts
// 为渲染时值歌词 token 的可视化器提供基于区间的关键词着色辅助。
(function () {
  'use strict'

  var CJK_REGEX = /[\u4e00-\u9fa5\u3040-\u30ff\uac00-\ud7af]/

  function isCJK(text) { return CJK_REGEX.test(text) }

  function normalizeWordColorToken(text) {
    return text.toLowerCase().replace(/[^\w]/g, '')
  }

  function resolveWordColorEntryText(entry) {
    if (!entry || typeof entry !== 'object' || !('word' in entry)) return ''
    var word = entry.word
    return typeof word === 'string' ? word.trim() : ''
  }

  function resolveWordColorEntryColor(entry) {
    if (!entry || typeof entry !== 'object' || !('color' in entry)) return ''
    var color = entry.color
    return typeof color === 'string' ? color : ''
  }

  function rangesOverlap(a, b) {
    return a.startOffset < b.endOffset && b.startOffset < a.endOffset
  }

  // 从重叠区间中按优先级选出一组互不重叠的区间
  function selectNonOverlappingRanges(ranges) {
    var selected = []
    var prioritySorted = ranges.slice().sort(function (a, b) {
      return b.priority - a.priority || a.startOffset - b.startOffset || a.endOffset - b.endOffset
    })

    prioritySorted.forEach(function (range) {
      var conflicts = selected.some(function (current) { return rangesOverlap(current, range) })
      if (!conflicts) selected.push(range)
    })

    return selected.sort(function (a, b) { return a.startOffset - b.startOffset || a.endOffset - b.endOffset })
  }

  // 主题 wordColors 配置 → 匹配器数组（每主题一次）
  function prepareWordColorMatchers(wordColors, keywordColoringEnabled) {
    if (keywordColoringEnabled === undefined) keywordColoringEnabled = true
    if (!keywordColoringEnabled || !wordColors || wordColors.length === 0) return []

    var matchers = []
    wordColors.forEach(function (entry) {
      var target = resolveWordColorEntryText(entry)
      if (!target) return
      var color = resolveWordColorEntryColor(entry)
      if (!color) return

      if (isCJK(target)) {
        matchers.push({ color: color, cjkPhrases: [target], englishWords: [], priority: target.length })
        return
      }

      var englishWords = target.split(/\s+/).map(normalizeWordColorToken).filter(Boolean)
      if (englishWords.length === 0) return

      var maxLen = 0
      englishWords.forEach(function (word) { maxLen = Math.max(maxLen, word.length) })
      matchers.push({ color: color, cjkPhrases: [], englishWords: englishWords, priority: maxLen })
    })
    return matchers
  }

  // 行文本一次性构建颜色区间，token 渲染器单次有序遍历即可取色
  function buildWordColorRangesFromMatchers(lineText, matchers) {
    if (!lineText || matchers.length === 0) return []

    var ranges = []
    var englishColorByWord = new Map()

    matchers.forEach(function (matcher) {
      matcher.cjkPhrases.forEach(function (target) {
        var cursor = 0
        while (cursor < lineText.length) {
          var startOffset = lineText.indexOf(target, cursor)
          if (startOffset < 0) break
          ranges.push({ startOffset: startOffset, endOffset: startOffset + target.length, color: matcher.color, priority: matcher.priority })
          cursor = startOffset + Math.max(target.length, 1)
        }
      })

      matcher.englishWords.forEach(function (word) {
        var current = englishColorByWord.get(word)
        if (!current || matcher.priority > current.priority) {
          englishColorByWord.set(word, { color: matcher.color, priority: matcher.priority })
        }
      })
    })

    if (englishColorByWord.size > 0) {
      var wordRegex = /\w+/g
      var match
      while ((match = wordRegex.exec(lineText)) !== null) {
        var wordColor = englishColorByWord.get(normalizeWordColorToken(match[0]))
        if (wordColor) {
          ranges.push({ startOffset: match.index, endOffset: match.index + match[0].length, color: wordColor.color, priority: wordColor.priority })
        }
      }
    }

    return selectNonOverlappingRanges(ranges)
  }

  function buildWordColorRanges(lineText, wordColors, keywordColoringEnabled) {
    if (keywordColoringEnabled === undefined) keywordColoringEnabled = true
    return buildWordColorRangesFromMatchers(lineText, prepareWordColorMatchers(wordColors, keywordColoringEnabled))
  }

  // 单词取色（classic 等模式用）：在 wordColors 里查找包含/匹配当前词的条目
  function resolveWordColor(wordText, wordColors, fallbackColor, options) {
    options = options || {}
    var keywordColoringEnabled = options.keywordColoringEnabled === undefined ? true : options.keywordColoringEnabled
    var cjkMatchMode = options.cjkMatchMode || 'target-contains-token'

    if (!keywordColoringEnabled || !wordColors || wordColors.length === 0) return fallbackColor

    var cleanCurrent = wordText.trim()
    if (!cleanCurrent) return fallbackColor

    var matched = null
    for (var i = 0; i < wordColors.length; i += 1) {
      var entry = wordColors[i]
      var target = resolveWordColorEntryText(entry)
      if (!target) continue

      var hit = false
      if (isCJK(cleanCurrent)) {
        if (cjkMatchMode === 'exact') hit = target === cleanCurrent
        else if (cjkMatchMode === 'bidirectional-contains') hit = target.indexOf(cleanCurrent) >= 0 || cleanCurrent.indexOf(target) >= 0
        else hit = target.indexOf(cleanCurrent) >= 0
      } else {
        var targetWords = target.split(/\s+/).map(normalizeWordColorToken).filter(Boolean)
        var normalizedCurrent = normalizeWordColorToken(cleanCurrent)
        hit = Boolean(normalizedCurrent) && targetWords.indexOf(normalizedCurrent) >= 0
      }

      if (hit) { matched = entry; break }
    }

    return resolveWordColorEntryColor(matched) || fallbackColor
  }

  // token 数组 → { key → color } 映射（monet 等按 offset 取色的模式用）
  function resolveTokenColorMap(tokens, ranges) {
    var colors = new Map()
    var rangeIndex = 0

    tokens.forEach(function (token) {
      if (!token.timed) return

      while (rangeIndex < ranges.length && ranges[rangeIndex].endOffset <= token.startOffset) {
        rangeIndex += 1
      }

      var range = ranges[rangeIndex]
      if (range && rangesOverlap(range, token)) {
        colors.set(token.key, range.color)
      }
    })

    return colors
  }

  window.FoliaWordColoring = {
    prepareWordColorMatchers: prepareWordColorMatchers,
    buildWordColorRangesFromMatchers: buildWordColorRangesFromMatchers,
    buildWordColorRanges: buildWordColorRanges,
    resolveWordColor: resolveWordColor,
    resolveTokenColorMap: resolveTokenColorMap
  }
})()
