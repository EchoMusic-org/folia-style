// 行渲染提示：移植自 folia-major src/utils/lyrics/renderHints.ts
// 依据行的原始时长推导节奏档位（normal/short/micro），决定行进出场方式与词揭示方式。
(function () {
  'use strict'

  var MICRO_LINE_DURATION_THRESHOLD = 0.10   // 低于 100ms 视为"微行"
  var SHORT_LINE_DURATION_THRESHOLD = 0.18   // 低于 180ms 视为"短行"
  var MICRO_LINE_RENDER_FLOOR = 0.067

  function clamp(value, min, max) { return Math.min(Math.max(value, min), max) }

  function getLastWordEndTime(line) {
    var words = line.words
    var lastWord = words && words.length ? words[words.length - 1] : null
    return lastWord ? lastWord.endTime : line.endTime
  }

  // 行进出场节奏参数（进入时长/退出时长/行通过停顿）
  function getLineTransitionTiming(rawDuration, lineTransitionMode, wordRevealMode) {
    if (lineTransitionMode === 'none') {
      return { enterDuration: 0, exitDuration: 0, linePassHold: 0 }
    }

    if (lineTransitionMode === 'fast') {
      return {
        enterDuration: clamp(rawDuration * 0.45, 0.045, 0.06),
        exitDuration: clamp(rawDuration * 0.22, 0.03, 0.04),
        linePassHold: wordRevealMode === 'instant' ? 0 : 0.03
      }
    }

    return {
      enterDuration: Math.min(0.42, Math.max(0.22, Math.max(rawDuration, 0.12) * 0.34)),
      exitDuration: Math.min(0.32, Math.max(0.18, Math.max(rawDuration, 0.12) * 0.18)),
      linePassHold: wordRevealMode === 'instant' ? 0 : 0.06
    }
  }

  function getTimingClass(rawDuration) {
    if (rawDuration < MICRO_LINE_DURATION_THRESHOLD) return 'micro'
    if (rawDuration < SHORT_LINE_DURATION_THRESHOLD) return 'short'
    return 'normal'
  }

  function getLineTransitionMode(timingClass) {
    if (timingClass === 'micro') return 'none'
    if (timingClass === 'short') return 'fast'
    return 'normal'
  }

  function getWordRevealMode(timingClass) {
    if (timingClass === 'micro') return 'instant'
    if (timingClass === 'short') return 'fast'
    return 'normal'
  }

  // renderEndTime 是可视化器可以为该行保留 active/pass/退场润色窗口的最晚时间点。
  function buildLineRenderEndTime(line, rawDuration, lineTransitionMode, wordRevealMode) {
    if (lineTransitionMode === 'none') {
      return Math.max(line.endTime, line.startTime + MICRO_LINE_RENDER_FLOOR)
    }

    var transitionTiming = getLineTransitionTiming(rawDuration, lineTransitionMode, wordRevealMode)
    var linePassStart = Math.max(getLastWordEndTime(line), line.startTime) + transitionTiming.linePassHold
    var exitStart = lineTransitionMode === 'fast'
      ? Math.max(line.startTime + transitionTiming.enterDuration + 0.01, linePassStart, line.endTime - transitionTiming.exitDuration)
      : Math.max(linePassStart, line.endTime - transitionTiming.exitDuration)

    return Math.max(line.endTime, exitStart + transitionTiming.exitDuration)
  }

  // 支持 buildLineRenderHints(line) 或 buildLineRenderHints(startTime, endTime) 两种调用形式
  function buildLineRenderHints(lineOrStart, endTime) {
    var line = typeof lineOrStart === 'number'
      ? { startTime: lineOrStart, endTime: endTime === undefined ? lineOrStart : endTime }
      : lineOrStart
    var rawDuration = Math.max(line.endTime - line.startTime, 0)
    var timingClass = getTimingClass(rawDuration)
    var lineTransitionMode = getLineTransitionMode(timingClass)
    var wordRevealMode = getWordRevealMode(timingClass)

    return {
      rawDuration: rawDuration,
      timingClass: timingClass,
      renderEndTime: buildLineRenderEndTime(line, rawDuration, lineTransitionMode, wordRevealMode),
      lineTransitionMode: lineTransitionMode,
      wordRevealMode: wordRevealMode
    }
  }

  function getLineRenderHints(line) {
    if (!line) return null
    return line.renderHints || buildLineRenderHints(line)
  }

  function getLineRenderEndTime(line) {
    if (!line) return Number.NEGATIVE_INFINITY
    var hints = getLineRenderHints(line)
    return hints ? hints.renderEndTime : line.endTime
  }

  window.FoliaRenderHints = {
    MICRO_LINE_DURATION_THRESHOLD: MICRO_LINE_DURATION_THRESHOLD,
    SHORT_LINE_DURATION_THRESHOLD: SHORT_LINE_DURATION_THRESHOLD,
    MICRO_LINE_RENDER_FLOOR: MICRO_LINE_RENDER_FLOOR,
    getLineTransitionTiming: getLineTransitionTiming,
    buildLineRenderHints: buildLineRenderHints,
    getLineRenderHints: getLineRenderHints,
    getLineRenderEndTime: getLineRenderEndTime
  }
})()
