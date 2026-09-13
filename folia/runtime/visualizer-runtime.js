// 可视化器共享运行时：移植自 folia-major src/components/visualizer/runtime.ts
// 只回答"此刻该关注哪一行"和"是否该预热下一行"，布局留给各模式自己发挥。
(function () {
  'use strict'

  var RenderHints = window.FoliaRenderHints

  // 没有活动行时用于字幕显示"最近一行"的兜底
  function getRecentCompletedLine(options) {
    var lines = options.lines
    var currentLineIndex = options.currentLineIndex
    var currentTime = options.currentTime
    var getLineEndTime = options.getLineEndTime || function (line) { return line.endTime }

    if (currentLineIndex !== -1 || lines.length === 0) return null

    for (var i = lines.length - 1; i >= 0; i -= 1) {
      if (currentTime > getLineEndTime(lines[i])) return lines[i]
    }

    return null
  }

  // 有活动行时 upcoming 就是数组的下一行；否则是第一个startTime在未来时点的行
  function getUpcomingLine(lines, currentLineIndex, currentTime) {
    var activeLine = lines[currentLineIndex]
    if (activeLine) return lines[currentLineIndex + 1] || null

    for (var i = 0; i < lines.length; i += 1) {
      if (lines[i].startTime > currentTime) return lines[i]
    }

    return null
  }

  // 大多数模式只需 1-2 行前瞻（字幕或预热），保持廉价显式
  function getUpcomingLines(lines, currentLineIndex, count) {
    if (count === undefined) count = 2
    if (currentLineIndex < 0) return []
    return lines.slice(currentLineIndex + 1, currentLineIndex + 1 + count)
  }

  // 预热窗口按"提前量"定义而非绝对时间戳，便于各模式独立调参
  function shouldPreheatLine(line, currentTime, win) {
    if (!line) return false
    var leadTime = line.startTime - currentTime
    return leadTime >= win.minLead && leadTime <= win.maxLead
  }

  // 通用准备流程：准备活动行 → 顺带预热下一行 → 只返回活动行的准备态
  function prepareActiveAndUpcoming(options) {
    var activeLine = options.activeLine
    var upcomingLine = options.upcomingLine
    var prepareLine = options.prepareLine

    if (!activeLine) {
      prepareLine(upcomingLine)
      return null
    }

    var currentState = prepareLine(activeLine)
    prepareLine(upcomingLine)
    return currentState
  }

  // 汇总当前帧的全部行状态（等价原版 useVisualizerRuntime）
  function getRuntimeState(options) {
    var lines = options.lines
    var currentLineIndex = options.currentLineIndex
    var currentTime = options.currentTime
    var getLineEndTime = options.getLineEndTime || RenderHints.getLineRenderEndTime

    return {
      currentTimeValue: currentTime,
      activeLine: lines[currentLineIndex] || null,
      recentCompletedLine: getRecentCompletedLine({ lines: lines, currentLineIndex: currentLineIndex, currentTime: currentTime, getLineEndTime: getLineEndTime }),
      upcomingLine: getUpcomingLine(lines, currentLineIndex, currentTime),
      nextLines: getUpcomingLines(lines, currentLineIndex, 2)
    }
  }

  window.FoliaVisualizerRuntime = {
    getRecentCompletedLine: getRecentCompletedLine,
    getUpcomingLine: getUpcomingLine,
    getUpcomingLines: getUpcomingLines,
    shouldPreheatLine: shouldPreheatLine,
    prepareActiveAndUpcoming: prepareActiveAndUpcoming,
    getRuntimeState: getRuntimeState
  }
})()
