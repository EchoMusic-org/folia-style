// 歌词行数据适配层：folia-style 现有获取方式（主程序 lyric store → postMessage 毫秒行）
// 与 folia-major 可视化器 Line 结构（秒）之间的桥。
// 宿主行结构：{ time_ms, text, secondary, characters:[{text,startTime,endTime}], duration_ms }
//   - characters 的 startTime/endTime 为毫秒（与 time_ms 同基准，见主程序 lyric store）
// 原版 Line 结构：{ startTime, endTime, words, fullText, translation, renderHints }（秒）
// renderHints 的推导公式与 folia-major src/utils/lyrics/renderHints.ts 完全一致。
(function () {
  'use strict'

  var RenderHints = window.FoliaRenderHints
  var GraphemeTiming = window.FoliaGraphemeTiming

  // 无逐字数据时按行时长均匀切分字符（毫秒，每字最短 800ms，对齐现有 ModeUtils.buildAllChars 语义）
  function buildEvenCharactersMs(line) {
    var allChars = []
    var txt = line.text || ''
    if (!txt) return allChars
    var dur = line.duration_ms || 2000
    var charDur = dur / txt.length
    for (var c = 0; c < txt.length; c += 1) {
      allChars.push({
        text: txt[c],
        startTime: line.time_ms + c * charDur,
        endTime: line.time_ms + (c + 1) * charDur
      })
    }
    return allChars
  }

  // 单行适配：毫秒行 → 原版 Line（秒）
  function adaptLine(rawLine) {
    var startMs = Math.max(0, Number(rawLine.time_ms) || 0)
    var durationMs = Math.max(0, Number(rawLine.duration_ms) || 0)
    var endTime = (startMs + durationMs) / 1000

    var rawChars = (rawLine.characters && rawLine.characters.length)
      ? rawLine.characters
      : buildEvenCharactersMs(rawLine)

    var words = rawChars.map(function (ch) {
      return {
        text: String(ch.text || ''),
        startTime: (Number(ch.startTime) || 0) / 1000,
        endTime: (Number(ch.endTime) || 0) / 1000
      }
    })

    var line = {
      startTime: startMs / 1000,
      endTime: endTime,
      words: words,
      fullText: String(rawLine.text || ''),
      translation: String(rawLine.secondary || ''),
      romanization: '',
      isWordByWord: Boolean(rawLine.characters && rawLine.characters.length)
    }

    // 微行/短行/普通行的节奏档位（与原版管线一致）
    line.renderHints = RenderHints.buildLineRenderHints(line)
    return line
  }

  // 批量适配
  function adaptLines(rawLines) {
    if (!Array.isArray(rawLines)) return []
    return rawLines.map(adaptLine)
  }

  // 查找当前活动行：从后往前找 startTime <= t <= renderEndTime
  //（移植自 folia-major src/utils/appPlaybackHelpers.ts 的 findLatestActiveLineIndex）
  function findLatestActiveLineIndex(lines, timeSec) {
    if (!lines || !lines.length) return -1
    for (var i = lines.length - 1; i >= 0; i -= 1) {
      var line = lines[i]
      var renderEndTime = line.renderHints
        ? line.renderHints.renderEndTime
        : RenderHints.getLineRenderEndTime(line)
      if (line.startTime <= timeSec && timeSec <= renderEndTime) return i
    }
    return -1
  }

  // 行的字形时间轴缓存（fume/diorama/pendolo 等逐字模式用）
  var lineTimelineCache = new Map()
  var TIMELINE_CACHE_LIMIT = 64

  function getLineGraphemeTimeline(line) {
    if (!line) return []
    var key = line.startTime + '|' + line.fullText
    var cached = lineTimelineCache.get(key)
    if (cached) return cached

    var timeline = GraphemeTiming.buildLineGraphemeTimeline(line)
    lineTimelineCache.set(key, timeline)
    if (lineTimelineCache.size > TIMELINE_CACHE_LIMIT) {
      var firstKey = lineTimelineCache.keys().next().value
      lineTimelineCache.delete(firstKey)
    }
    return timeline
  }

  window.FoliaLyricsData = {
    adaptLine: adaptLine,
    adaptLines: adaptLines,
    findLatestActiveLineIndex: findLatestActiveLineIndex,
    getLineGraphemeTimeline: getLineGraphemeTimeline
  }
})()
