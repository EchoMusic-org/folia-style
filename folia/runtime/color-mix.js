// 颜色工具：移植自 folia-major src/components/visualizer/colorMix.ts
// 为可视化渲染器提供的共享颜色混合/解析辅助，逻辑与原版一一对应。
(function () {
  'use strict'

  var clamp = function (value, min, max) { return Math.max(min, Math.min(max, value)) }
  var mix = function (from, to, amount) { return from + (to - from) * amount }
  var FALLBACK_RGB = { r: 255, g: 255, b: 255 }

  var isFiniteChannel = function (value) { return Number.isFinite(value) }

  var formatRgba = function (channels, alpha) {
    return 'rgba(' + Math.round(clamp(channels.r, 0, 255)) + ', ' + Math.round(clamp(channels.g, 0, 255)) + ', ' + Math.round(clamp(channels.b, 0, 255)) + ', ' + alpha + ')'
  }

  // 给颜色附加透明度（支持 #rgb/#rrggbb/rgb()/rgba()，其余原样返回）
  var colorWithAlpha = function (color, alpha) {
    var normalizedAlpha = clamp(alpha, 0, 1)
    var normalizedColor = typeof color === 'string' ? color.trim() : ''
    if (!normalizedColor) return formatRgba(FALLBACK_RGB, normalizedAlpha)

    if (normalizedColor.charAt(0) === '#') {
      var hex = normalizedColor.slice(1)
      var parse = function (value) { return Number.parseInt(value, 16) }

      if (/^[0-9a-fA-F]{3}$/.test(hex)) {
        return formatRgba({ r: parse(hex[0] + hex[0]), g: parse(hex[1] + hex[1]), b: parse(hex[2] + hex[2]) }, normalizedAlpha)
      }
      if (/^[0-9a-fA-F]{6}$/.test(hex)) {
        return formatRgba({ r: parse(hex.slice(0, 2)), g: parse(hex.slice(2, 4)), b: parse(hex.slice(4, 6)) }, normalizedAlpha)
      }
      return formatRgba(FALLBACK_RGB, normalizedAlpha)
    }

    var rgbMatch = normalizedColor.match(/^rgba?\(([^)]+)\)$/)
    if (rgbMatch) {
      var parts = rgbMatch[1].split(',').slice(0, 3).map(function (part) { return Number.parseFloat(part.trim()) })
      if (parts.every(isFiniteChannel)) return formatRgba({ r: parts[0], g: parts[1], b: parts[2] }, normalizedAlpha)
      return formatRgba(FALLBACK_RGB, normalizedAlpha)
    }

    return normalizedColor
  }

  // 把颜色解析为 {r,g,b} 通道对象，解析失败返回 null
  var parseColorChannels = function (color) {
    var normalizedColor = typeof color === 'string' ? color.trim() : ''
    if (!normalizedColor) return null

    if (normalizedColor.charAt(0) === '#') {
      var hex = normalizedColor.slice(1)
      var parse = function (value) { return Number.parseInt(value, 16) }

      if (/^[0-9a-fA-F]{3}$/.test(hex)) {
        return { r: parse(hex[0] + hex[0]), g: parse(hex[1] + hex[1]), b: parse(hex[2] + hex[2]) }
      }
      if (/^[0-9a-fA-F]{6}$/.test(hex)) {
        return { r: parse(hex.slice(0, 2)), g: parse(hex.slice(2, 4)), b: parse(hex.slice(4, 6)) }
      }
    }

    var rgbMatch = normalizedColor.match(/^rgba?\(([^)]+)\)$/)
    if (rgbMatch) {
      var parts = rgbMatch[1].split(',').slice(0, 3).map(function (part) { return Number.parseFloat(part.trim()) })
      if (parts.every(isFiniteChannel)) return { r: parts[0], g: parts[1], b: parts[2] }
    }

    return null
  }

  // 在两个颜色之间线性插值
  var mixColors = function (from, to, amount, alpha) {
    if (alpha === undefined) alpha = 1
    var normalizedAmount = clamp(amount, 0, 1)
    var fromChannels = parseColorChannels(from)
    var toChannels = parseColorChannels(to)

    if (!fromChannels || !toChannels) {
      return colorWithAlpha(normalizedAmount >= 0.5 ? to : from, alpha)
    }

    return 'rgba(' + Math.round(mix(fromChannels.r, toChannels.r, normalizedAmount)) + ', ' + Math.round(mix(fromChannels.g, toChannels.g, normalizedAmount)) + ', ' + Math.round(mix(fromChannels.b, toChannels.b, normalizedAmount)) + ', ' + clamp(alpha, 0, 1) + ')'
  }

  window.FoliaColorMix = {
    colorWithAlpha: colorWithAlpha,
    parseColorChannels: parseColorChannels,
    mixColors: mixColors,
    clamp: clamp
  }
})()
