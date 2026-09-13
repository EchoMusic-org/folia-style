// 多行分句算法：移植自 folia-major src/utils/lyrics/sentenceLayout.ts
// 把一行歌词按标点/括号引号/西文词块/CJK 空格/特殊字符分层切分，二级拆分用词级 Segmenter
// 找语义平衡点，超出目标行数时合并最短相邻句。倾诉（tilt）模式的布局基础。
(function () {
  'use strict'

  var CJK_REGEX = /[\u4e00-\u9fa5\u3040-\u30ff\uac00-\ud7af]/
  var charCountCache = new Map()

  function hasCjkText(text) { return CJK_REGEX.test(text) }

  function findRegexMatch(regex, text, fromIndex) {
    regex.lastIndex = fromIndex || 0
    var match = regex.exec(text)
    return match ? { start: match.index, end: match.index + match[0].length } : null
  }

  function findStringMatch(str, text, fromIndex) {
    var idx = text.indexOf(str, fromIndex || 0)
    return idx === -1 ? null : { start: idx, end: idx + str.length }
  }

  function splitByPunctuation(text) {
    var allPunctRegex = /[，。；！？、…·\.\,\;\!\?]+/g
    var matches = []
    var m
    while ((m = allPunctRegex.exec(text)) !== null) matches.push(m)

    if (matches.length === 0) return [text]

    var result = []
    var lastIndex = 0

    matches.forEach(function (match) {
      var punctStart = match.index
      var punctEnd = punctStart + match[0].length

      var trailingSpaces = ''
      var afterPunct = text.slice(punctEnd)
      var spaceMatch = afterPunct.match(/^\s+/)
      if (spaceMatch) trailingSpaces = spaceMatch[0]

      var beforePunct = text.slice(lastIndex, punctStart)
      var punctWithSpaces = match[0] + trailingSpaces

      if (beforePunct.length > 0) {
        result.push(beforePunct + punctWithSpaces)
      } else if (result.length > 0) {
        result[result.length - 1] += punctWithSpaces
      } else {
        result.push(punctWithSpaces)
      }

      lastIndex = punctEnd + trailingSpaces.length
    })

    if (lastIndex < text.length) result.push(text.slice(lastIndex))

    return result.filter(function (r) { return r.length > 0 })
  }

  function splitByBracketsQuotes(text) {
    var allPairedSymbols = [
      { open: /「/, close: /」/ },
      { open: /『/, close: /』/ },
      { open: /《/, close: /》/ },
      { open: /【/, close: /】/ },
      { open: /｛/, close: /｝/ },
      { open: /［/, close: /］/ },
      { open: /\[/, close: /\]/ },
      { open: /（/, close: /）/ },
      { open: /\(/, close: /\)/ },
      { openStr: '"', closeStr: '"' },
      { openStr: "'", closeStr: "'" }
    ]

    var result = extractOutermostPairs(text, allPairedSymbols)
    return result.length > 1 ? result : [text]
  }

  function extractOutermostPairs(text, defs) {
    var best = findOutermostPair(text, defs)
    if (!best) return [text]

    var before = text.slice(0, best.openStart)
    var pairedContent = text.slice(best.openStart, best.closeEnd)
    var remainder = text.slice(best.closeEnd)

    var result = []
    if (before.length > 0) result = result.concat(extractOutermostPairs(before, defs))
    result.push(pairedContent)
    if (remainder.length > 0) result = result.concat(extractOutermostPairs(remainder, defs))

    return result.filter(function (p) { return p.length > 0 })
  }

  function findOutermostPair(text, defs) {
    var best = null

    defs.forEach(function (def) {
      var openMatch = def.openStr !== undefined
        ? findStringMatch(def.openStr, text)
        : findRegexMatch(def.open, text)
      if (!openMatch) return

      var searchFrom = openMatch.end
      var closeMatch = def.closeStr !== undefined
        ? findStringMatch(def.closeStr, text, searchFrom)
        : findRegexMatch(def.close, text, searchFrom)
      if (!closeMatch) return

      var candidate = {
        openStart: openMatch.start,
        openEnd: openMatch.end,
        closeStart: closeMatch.start,
        closeEnd: closeMatch.end
      }

      if (!best || candidate.openStart < best.openStart) best = candidate
      else if (candidate.openStart === best.openStart && candidate.closeEnd > best.closeEnd) best = candidate
    })

    return best
  }

  function splitByWesternWords(text) {
    if (!hasCjkText(text)) return [text]

    var westernBlockRegex = /[a-zA-Z0-9]+(?:[a-zA-Z0-9'\-]*[a-zA-Z0-9]+)?(?:\s+[a-zA-Z0-9]+(?:[a-zA-Z0-9'\-]*[a-zA-Z0-9]+)?)+[.,;:!?。，；：！？]?\s*/g

    charCountCache.clear()

    var hasMultipleWordBlock = false
    var match

    while ((match = westernBlockRegex.exec(text)) !== null) {
      var wordMatches = match[0].match(/[a-zA-Z0-9]+/g)
      var wordCount = wordMatches ? wordMatches.length : 0
      if (wordCount > 1) { hasMultipleWordBlock = true; break }
    }

    if (!hasMultipleWordBlock) return [text]

    westernBlockRegex.lastIndex = 0

    var parts = []
    var lastIndex = 0

    while ((match = westernBlockRegex.exec(text)) !== null) {
      var blockStart = match.index
      var blockEnd = blockStart + match[0].length
      var beforeBlock = text.slice(lastIndex, blockStart)

      if (shouldSkipBoundary(text, beforeBlock, blockStart)) {
        parts.push(beforeBlock + match[0])
      } else if (blockStart > lastIndex) {
        parts.push(beforeBlock)
        parts.push(match[0])
      } else {
        parts.push(match[0])
      }

      lastIndex = blockEnd
    }

    if (lastIndex < text.length) parts.push(text.slice(lastIndex))

    return parts.length > 1 ? parts : [text]
  }

  function getGlobalCount(text, char) {
    var key = text.length + ':' + char
    if (charCountCache.has(key)) return charCountCache.get(key)
    var escaped = char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    var count = (text.match(new RegExp(escaped, 'g')) || []).length
    charCountCache.set(key, count)
    return count
  }

  function shouldSkipBoundary(fullText, beforeBlock, boundaryPos) {
    if (beforeBlock.length === 0) return false

    var sepChar = beforeBlock.charAt(beforeBlock.length - 1)

    if (sepChar === '-') return true
    if (sepChar === ':' || sepChar === '：' || sepChar === '/' || sepChar === '／' || sepChar === '|' || sepChar === '｜') {
      return getGlobalCount(fullText, sepChar) >= 2
    }

    return false
  }

  function splitByCJKSpace(text) {
    if (!hasCjkText(text)) return [text]

    var segments = []
    var currentSegment = ''
    var inCjkBlock = false

    for (var i = 0; i < text.length; i += 1) {
      var char = text[i]
      var isCJK = CJK_REGEX.test(char)
      var isWestern = /[a-zA-Z0-9]/.test(char)
      var isSpace = /\s/.test(char)

      if (isCJK) {
        currentSegment += char
        inCjkBlock = true
      } else if (isWestern) {
        currentSegment += char
      } else if (isSpace) {
        var isFullWidthSpace = char === '\u3000'

        if (isFullWidthSpace && currentSegment.length > 0) {
          currentSegment += char
          segments.push(currentSegment)
          currentSegment = ''
          inCjkBlock = false
        } else if (inCjkBlock && currentSegment.length > 0) {
          var lastChar = currentSegment.charAt(currentSegment.length - 1)
          if (CJK_REGEX.test(lastChar)) {
            currentSegment += char
            segments.push(currentSegment)
            currentSegment = ''
            inCjkBlock = false
          } else {
            currentSegment += char
          }
        } else if (currentSegment.length === 0 && segments.length > 0) {
          segments[segments.length - 1] += char
        } else {
          currentSegment += char
        }
      } else {
        if (currentSegment.length === 0 && segments.length > 0) {
          segments[segments.length - 1] += char
        } else {
          currentSegment += char
        }
      }
    }

    if (currentSegment) {
      if (segments.length > 0 && /^\s+$/.test(currentSegment)) {
        segments[segments.length - 1] += currentSegment
      } else {
        segments.push(currentSegment)
      }
    }

    return segments.length > 1 ? segments : [text]
  }

  function splitBySpecialChars(text) {
    var specialCharRegex = /[：:\/／\\|｜~～]+/
    var parts = text.split(specialCharRegex)

    if (parts.filter(function (part) { return part.length > 0 }).length <= 1) {
      return [text]
    }

    var result = []
    var lastIndex = 0

    parts.forEach(function (part) {
      var index = text.indexOf(part, lastIndex)
      if (index > lastIndex) {
        var specialChar = text.slice(lastIndex, index)
        if (result.length > 0) result[result.length - 1] += specialChar
        else result.push(specialChar)
      }

      if (part) {
        result.push(part)
        lastIndex = index + part.length
      } else if (index !== -1) {
        lastIndex = index
      }
    })

    if (lastIndex < text.length) {
      var tail = text.slice(lastIndex)
      if (tail && result.length > 0) result[result.length - 1] += tail
      else if (tail) result.push(tail)
    }

    return result.filter(function (r) { return r.length > 0 })
  }

  function splitByLevel(text, level) {
    switch (level) {
      case 1: return splitByPunctuation(text)
      case 2: return splitByBracketsQuotes(text)
      case 3: return splitByWesternWords(text)
      case 4: return splitByCJKSpace(text)
      case 5: return splitBySpecialChars(text)
      default: return [text]
    }
  }

  // 二级拆分：用词级 Segmenter 找语义平衡分割点
  function secondarySplit(sentences, targetCount, timeSeed) {
    var Segmenter = typeof Intl !== 'undefined' ? Intl.Segmenter : undefined
    var segmenter = Segmenter ? new Segmenter(undefined, { granularity: 'word' }) : null

    while (sentences.length < targetCount) {
      var candidates = sentences.filter(function (s) { return s.text.length > 2 })
      if (candidates.length === 0) break

      if (segmenter) {
        var semanticCandidates = []

        candidates.forEach(function (s) {
          try {
            var segs = []
            var iter = segmenter.segment(s.text)[Symbol.iterator]()
            var res = iter.next()
            while (!res.done) { segs.push(res.value); res = iter.next() }

            var wordPositions = []
            var offset = 0
            segs.forEach(function (seg) {
              if (seg.isWordLike) wordPositions.push({ start: offset, end: offset + seg.segment.length })
              offset += seg.segment.length
            })

            if (wordPositions.length >= 2) {
              var midChar = s.text.length / 2
              var bestGapIdx = 1
              var bestDist = Infinity
              for (var g = 1; g < wordPositions.length; g += 1) {
                var dist = Math.abs(wordPositions[g].start - midChar)
                if (dist < bestDist) { bestDist = dist; bestGapIdx = g }
              }

              var splitPos = wordPositions[bestGapIdx].start
              var balanceScore = 1 - Math.abs(splitPos - midChar) / midChar

              semanticCandidates.push({
                sentence: s,
                index: sentences.indexOf(s),
                splitPos: splitPos,
                score: balanceScore * 10 + wordPositions.length
              })
            }
          } catch (e) { /* 忽略该句 */ }
        })

        if (semanticCandidates.length > 0) {
          semanticCandidates.sort(function (a, b) { return b.score - a.score })
          var best = semanticCandidates[0]
          var firstHalf = best.sentence.text.slice(0, best.splitPos)
          var secondHalf = best.sentence.text.slice(best.splitPos)
          sentences.splice(best.index, 1, { text: firstHalf }, { text: secondHalf })
          continue
        }
      }

      var pseudoRandom = function (seed) {
        var x = Math.sin(seed) * 10000
        return x - Math.floor(x)
      }

      var textHash = sentences.reduce(function (acc, s) {
        return acc + s.text.split('').reduce(function (sum, c) { return sum + c.charCodeAt(0) }, 0)
      }, 0)
      var seed = textHash + sentences.length + (timeSeed || 0)
      var randomIndex = Math.floor(pseudoRandom(seed) * candidates.length)
      var selectedCandidate = candidates[randomIndex]
      var candidateIndex = sentences.indexOf(selectedCandidate)

      var midPoint = Math.floor(selectedCandidate.text.length / 2)
      var firstHalf2 = selectedCandidate.text.slice(0, midPoint)
      var secondHalf2 = selectedCandidate.text.slice(midPoint)

      sentences.splice(candidateIndex, 1, { text: firstHalf2 }, { text: secondHalf2 })
    }

    return sentences
  }

  function mergeSentences(sentences, targetCount) {
    while (sentences.length > targetCount) {
      var bestMergeIndex = 0
      var shortestCombinedLength = Infinity

      for (var i = 0; i < sentences.length - 1; i += 1) {
        var combinedLength = sentences[i].text.length + sentences[i + 1].text.length
        if (combinedLength < shortestCombinedLength) {
          shortestCombinedLength = combinedLength
          bestMergeIndex = i
        }
      }

      var merged = { text: sentences[bestMergeIndex].text + sentences[bestMergeIndex + 1].text }
      sentences.splice(bestMergeIndex, 2, merged)
    }

    return sentences
  }

  // 主入口：按目标行数切分文本
  function splitIntoSentences(text, targetCount, timeSeed) {
    if (targetCount <= 1 && targetCount >= 0) {
      return [{ text: text }]
    }

    var maxLevel = targetCount === -1 ? 1
      : targetCount === -2 ? 2
        : targetCount === -3 ? 3
          : targetCount === -4 ? 4
            : targetCount === -5 ? 5 : 5

    var sentences = [text]

    for (var level = 1; level <= maxLevel; level += 1) {
      if (sentences.length >= Math.abs(targetCount) && targetCount > 0) break

      var newSentences = []
      sentences.forEach(function (sentence) {
        newSentences = newSentences.concat(splitByLevel(sentence, level))
      })
      sentences = newSentences
    }

    var result = sentences.map(function (s) { return { text: s } })

    if (targetCount > 0 && result.length < targetCount) {
      result = secondarySplit(result, targetCount, timeSeed)
    }

    if (result.length > 1 && result.length > targetCount && targetCount > 0) {
      result = mergeSentences(result, targetCount)
    }

    return result
  }

  window.FoliaSentenceLayout = {
    splitIntoSentences: splitIntoSentences
  }
})()
