// 主题系统：移植自 folia-major 的封面取色链路
//（utils/colorExtractor.ts + utils/colorPalette.ts + utils/themeColorMath.ts +
//  utils/builtinTheme/{coverPaletteAnalysis,themeColorRanges,generateBuiltinDualTheme}.ts +
//  services/baseThemes.ts）
// 链路：封面 URL → canvas 采样像素 → 鲜艳色提取(5 色) → 调色板分析(基色/点缀色/色调)
//      → 生成明暗双主题（含对比度求解）→ Theme 五色 + animationIntensity。
// 本插件歌词页为深色环境，实际使用 dark 主题；light 主题保留以维持结构一致。
(function () {
  'use strict'

  // ---------- 颜色数学（themeColorMath.ts） ----------
  var FALLBACK_THEME_COLOR = '#4f7cff'

  function clamp01(value) { return Math.max(0, Math.min(1, value)) }
  function clampChannel(value) { return Math.max(0, Math.min(255, Math.round(value))) }
  function normalizeHue(hue) { return ((hue % 360) + 360) % 360 }

  function parseThemeColor(value) {
    var channels = typeof value === 'string' ? parseRgba(value) : null
    if (!channels) return null
    return { r: clampChannel(channels.r), g: clampChannel(channels.g), b: clampChannel(channels.b) }
  }

  // 支持 #rgb/#rrggbb/rgb()/rgba() 的简易解析（原版借用 colorMix.parseColorChannels）
  function parseRgba(color) {
    var normalizedColor = typeof color === 'string' ? color.trim() : ''
    if (!normalizedColor) return null

    if (normalizedColor.charAt(0) === '#') {
      var hex = normalizedColor.slice(1)
      var parse = function (v) { return Number.parseInt(v, 16) }
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
      if (parts.every(function (v) { return Number.isFinite(v) })) return { r: parts[0], g: parts[1], b: parts[2] }
    }
    return null
  }

  function rgbToHex(rgb) {
    return '#' + [rgb.r, rgb.g, rgb.b].map(function (c) { return clampChannel(c).toString(16).padStart(2, '0') }).join('')
  }

  function rgbToHsl(rgb) {
    var red = clampChannel(rgb.r) / 255
    var green = clampChannel(rgb.g) / 255
    var blue = clampChannel(rgb.b) / 255
    var max = Math.max(red, green, blue)
    var min = Math.min(red, green, blue)
    var delta = max - min
    var lightness = (max + min) / 2

    if (delta === 0) return { h: 0, s: 0, l: lightness }

    var saturation = delta / (1 - Math.abs(2 * lightness - 1))

    var hue
    if (max === red) hue = ((green - blue) / delta) % 6
    else if (max === green) hue = (blue - red) / delta + 2
    else hue = (red - green) / delta + 4

    return { h: normalizeHue(hue * 60), s: clamp01(saturation), l: clamp01(lightness) }
  }

  function hslToRgb(hsl) {
    var hue = normalizeHue(hsl.h)
    var saturation = clamp01(hsl.s)
    var lightness = clamp01(hsl.l)

    var chroma = (1 - Math.abs(2 * lightness - 1)) * saturation
    var secondary = chroma * (1 - Math.abs(((hue / 60) % 2) - 1))
    var offset = lightness - chroma / 2

    var sector = Math.floor(hue / 60) % 6
    var rgb
    if (sector === 0) rgb = [chroma, secondary, 0]
    else if (sector === 1) rgb = [secondary, chroma, 0]
    else if (sector === 2) rgb = [0, chroma, secondary]
    else if (sector === 3) rgb = [0, secondary, chroma]
    else if (sector === 4) rgb = [secondary, 0, chroma]
    else rgb = [chroma, 0, secondary]

    return {
      r: clampChannel((rgb[0] + offset) * 255),
      g: clampChannel((rgb[1] + offset) * 255),
      b: clampChannel((rgb[2] + offset) * 255)
    }
  }

  function hexToHsl(color) {
    var parsed = parseThemeColor(color)
    return parsed ? rgbToHsl(parsed) : null
  }

  function hslToHex(hsl) { return rgbToHex(hslToRgb(hsl)) }

  function getRelativeLuminance(color) {
    var parsed = parseThemeColor(color)
    if (!parsed) return 0

    var transform = function (channel) {
      var normalized = channel / 255
      return normalized <= 0.03928
        ? normalized / 12.92
        : Math.pow((normalized + 0.055) / 1.055, 2.4)
    }

    return 0.2126 * transform(parsed.r) + 0.7152 * transform(parsed.g) + 0.0722 * transform(parsed.b)
  }

  function getContrastRatio(foreground, background) {
    var luminanceA = getRelativeLuminance(foreground)
    var luminanceB = getRelativeLuminance(background)
    var lighter = Math.max(luminanceA, luminanceB)
    var darker = Math.min(luminanceA, luminanceB)
    return (lighter + 0.05) / (darker + 0.05)
  }

  function getHueDistance(a, b) {
    var distance = Math.abs(normalizeHue(a) - normalizeHue(b))
    return Math.min(distance, 360 - distance)
  }

  // 沿亮度轴向远离背景的方向调整颜色直至满足对比度下限（保持色相/饱和度）
  function adjustLightnessForContrast(color, background, minRatio, step, maxSteps) {
    if (step === undefined) step = 0.02
    if (maxSteps === undefined) maxSteps = 50
    var hsl = hexToHsl(color)
    if (!hsl) return color

    var goDarker = getRelativeLuminance(background) > 0.35
    var direction = goDarker ? -1 : 1

    var bestColor = hslToHex(hsl)
    var bestRatio = getContrastRatio(bestColor, background)

    for (var index = 0; index <= maxSteps; index += 1) {
      var lightness = clamp01(hsl.l + direction * step * index)
      var candidate = hslToHex({ h: hsl.h, s: hsl.s, l: lightness })
      var ratio = getContrastRatio(candidate, background)

      if (ratio > bestRatio) {
        bestRatio = ratio
        bestColor = candidate
      }
      if (ratio >= minRatio) return candidate
      if (index > 0 && (lightness === 0 || lightness === 1)) break
    }

    return bestColor
  }

  // ---------- 封面取色（colorExtractor.ts：鲜艳色优先） ----------
  function loadImagePixels(imageUrl) {
    return new Promise(function (resolve) {
      var img = new Image()
      img.crossOrigin = 'anonymous'

      img.onload = function () {
        try {
          var canvas = document.createElement('canvas')
          var ctx = canvas.getContext('2d')
          if (!ctx) { resolve(null); return }

          var width = 50
          var height = 50
          canvas.width = width
          canvas.height = height
          ctx.drawImage(img, 0, 0, width, height)
          resolve(ctx.getImageData(0, 0, width, height).data)
        } catch (e) {
          resolve(null)
        }
      }

      img.onerror = function () { resolve(null) }
      img.src = imageUrl
    })
  }

  function extractVibrantColorsFromPixels(imageData, count) {
    var colors = []

    var step = 2
    for (var i = 0; i < imageData.length; i += 4 * step) {
      var r = imageData[i]
      var g = imageData[i + 1]
      var b = imageData[i + 2]
      var a = imageData[i + 3]

      if (a < 128) continue // 跳过透明像素

      var max = Math.max(r, g, b)
      var min = Math.min(r, g, b)
      var l = (max + min) / 2
      var saturation = max === min ? 0 : (max - min) / (255 - Math.abs(max + min - 255))

      // 偏好有一定饱和度的颜色（排除纯灰），并排除过暗/过亮
      if (saturation > 0.2 && l > 30 && l < 220) {
        colors.push({ r: r, g: g, b: b })
      } else if (colors.length < 100) {
        colors.push({ r: r, g: g, b: b }) // 低饱和兜底
      }
    }

    // 按饱和度排序（鲜艳优先）
    colors.sort(function (a, b) {
      var satA = (Math.max(a.r, a.g, a.b) - Math.min(a.r, a.g, a.b)) / 255
      var satB = (Math.max(b.r, b.g, b.b) - Math.min(b.r, b.g, b.b)) / 255
      return satB - satA
    })

    var distinctColors = []
    var minDistance = 20

    for (var idx = 0; idx < colors.length; idx += 1) {
      if (distinctColors.length >= count) break
      var c = colors[idx]

      var isDistinct = distinctColors.every(function (dc) {
        var d = Math.sqrt(
          Math.pow(c.r - dc.r, 2) + Math.pow(c.g - dc.g, 2) + Math.pow(c.b - dc.b, 2)
        )
        return d > minDistance
      })

      if (isDistinct || distinctColors.length === 0) distinctColors.push(c)
    }

    return distinctColors.map(function (c) {
      return '#' + c.r.toString(16).padStart(2, '0') + c.g.toString(16).padStart(2, '0') + c.b.toString(16).padStart(2, '0')
    })
  }

  function extractColors(imageUrl, count) {
    if (count === undefined) count = 5
    return loadImagePixels(imageUrl).then(function (pixels) {
      return pixels ? extractVibrantColorsFromPixels(pixels, count) : []
    })
  }

  // ---------- 代表色提取（colorPalette.ts：加权中位切分，latent 背景用） ----------
  var QUANTIZATION_SHIFT = 4
  var MIN_ALPHA = 128

  function getChannelRange(colors, channel) {
    var min = 255
    var max = 0
    for (var i = 0; i < colors.length; i += 1) {
      min = Math.min(min, colors[i][channel])
      max = Math.max(max, colors[i][channel])
    }
    return max - min
  }

  function splitBucket(bucket) {
    if (bucket.colors.length < 2) return null

    var ranges = {
      r: getChannelRange(bucket.colors, 'r'),
      g: getChannelRange(bucket.colors, 'g'),
      b: getChannelRange(bucket.colors, 'b')
    }
    var channel = 'r'
    if (ranges.g > ranges[channel]) channel = 'g'
    if (ranges.b > ranges[channel]) channel = 'b'
    var sorted = bucket.colors.slice().sort(function (a, b) { return a[channel] - b[channel] })
    var midpoint = bucket.weight / 2
    var accumulatedWeight = 0
    var splitIndex = 1

    for (var index = 0; index < sorted.length - 1; index += 1) {
      accumulatedWeight += sorted[index].weight
      splitIndex = index + 1
      if (accumulatedWeight >= midpoint) break
    }

    var left = sorted.slice(0, splitIndex)
    var right = sorted.slice(splitIndex)
    var leftWeight = left.reduce(function (sum, color) { return sum + color.weight }, 0)
    var rightWeight = right.reduce(function (sum, color) { return sum + color.weight }, 0)
    return [
      { colors: left, weight: leftWeight },
      { colors: right, weight: rightWeight }
    ]
  }

  function averageBucket(bucket) {
    var totals = { r: 0, g: 0, b: 0 }
    bucket.colors.forEach(function (color) {
      totals.r += color.r * color.weight
      totals.g += color.g * color.weight
      totals.b += color.b * color.weight
    })
    return {
      r: Math.round(totals.r / bucket.weight),
      g: Math.round(totals.g / bucket.weight),
      b: Math.round(totals.b / bucket.weight),
      weight: bucket.weight
    }
  }

  function toHex(color) {
    return '#' + color.r.toString(16).padStart(2, '0') + color.g.toString(16).padStart(2, '0') + color.b.toString(16).padStart(2, '0')
  }

  // 加权中位切分：大面积区域权重高于小而鲜艳的细节
  function extractRepresentativeColorsFromPixels(pixels, count) {
    if (count <= 0) return []

    var histogram = new Map()
    for (var index = 0; index < pixels.length; index += 4) {
      if (pixels[index + 3] < MIN_ALPHA) continue
      var r = pixels[index]
      var g = pixels[index + 1]
      var b = pixels[index + 2]
      var key = ((r >> QUANTIZATION_SHIFT) << 8) | ((g >> QUANTIZATION_SHIFT) << 4) | (b >> QUANTIZATION_SHIFT)
      var existing = histogram.get(key)
      if (existing) {
        existing.r += r
        existing.g += g
        existing.b += b
        existing.weight += 1
      } else {
        histogram.set(key, { r: r, g: g, b: b, weight: 1 })
      }
    }

    var colors = []
    histogram.forEach(function (color) {
      colors.push({
        r: Math.round(color.r / color.weight),
        g: Math.round(color.g / color.weight),
        b: Math.round(color.b / color.weight),
        weight: color.weight
      })
    })
    if (colors.length === 0) return []

    var buckets = [{
      colors: colors,
      weight: colors.reduce(function (sum, color) { return sum + color.weight }, 0)
    }]
    while (buckets.length < Math.min(count, colors.length)) {
      var bucketIndex = -1
      var bestScore = -1
      for (var i = 0; i < buckets.length; i += 1) {
        var bucket = buckets[i]
        if (bucket.colors.length < 2) continue
        var widestRange = Math.max(
          getChannelRange(bucket.colors, 'r'),
          getChannelRange(bucket.colors, 'g'),
          getChannelRange(bucket.colors, 'b')
        )
        var score = widestRange * Math.sqrt(bucket.weight)
        if (score > bestScore) {
          bestScore = score
          bucketIndex = i
        }
      }
      if (bucketIndex < 0) break
      var split = splitBucket(buckets[bucketIndex])
      if (!split) break
      buckets.splice.apply(buckets, [bucketIndex, 1].concat(split))
    }

    return buckets
      .map(averageBucket)
      .sort(function (a, b) { return b.weight - a.weight })
      .map(toHex)
  }

  function extractRepresentativeColors(imageUrl, count) {
    if (count === undefined) count = 5
    return loadImagePixels(imageUrl).then(function (pixels) {
      return pixels ? extractRepresentativeColorsFromPixels(pixels, count) : []
    })
  }

  // ---------- 调色板分析（coverPaletteAnalysis.ts） ----------
  var MIN_SUPPORT_SATURATION = 0.15
  var MIN_SUPPORT_HUE_DISTANCE = 25
  var MAX_SUPPORT_HUE_DISTANCE = 160
  var MONOCHROME_SATURATION_CEILING = 0.18

  // 偏好饱和且中等亮度的颜色：它们承载封面个性；近黑/近白只描述背景
  function getCoverColorScore(hsl) {
    return hsl.s * Math.max(0, 1 - Math.abs(hsl.l - 0.5) * 1.2)
  }

  function pickWeighted(random, entries) {
    var total = entries.reduce(function (sum, entry) { return sum + entry.weight }, 0)
    var cursor = random() * total

    for (var i = 0; i < entries.length; i += 1) {
      cursor -= entries[i].weight
      if (cursor <= 0) return entries[i].value
    }

    return entries[entries.length - 1].value
  }

  function pickBaseColor(parsedColors, random) {
    if (parsedColors.length === 0) {
      // 无封面：随机挑色相，让无封面歌曲每次也有变化
      return { h: random() * 360, s: 0.35 + random() * 0.3, l: 0.5 }
    }

    var best = parsedColors[0]
    for (var i = 1; i < parsedColors.length; i += 1) {
      if (getCoverColorScore(parsedColors[i]) > getCoverColorScore(best)) best = parsedColors[i]
    }

    return getCoverColorScore(best) > 0.02 ? best : parsedColors[0]
  }

  function pickSupportHue(parsedColors, base) {
    for (var i = 0; i < parsedColors.length; i += 1) {
      var candidate = parsedColors[i]
      if (candidate.s < MIN_SUPPORT_SATURATION) continue
      var distance = getHueDistance(candidate.h, base.h)
      if (distance >= MIN_SUPPORT_HUE_DISTANCE && distance <= MAX_SUPPORT_HUE_DISTANCE) return candidate.h
    }
    return null
  }

  function pickScheme(baseSaturation, supportHue, random) {
    // 封面上真实的第二个色相是最"来自这张图"的点缀
    if (supportHue !== null && random() < 0.65) return 'duotone'

    return pickWeighted(random, [
      { value: 'analogous', weight: 3 },
      { value: 'complementary', weight: 2 },
      { value: 'split', weight: 2 },
      { value: 'triadic', weight: 1.5 },
      { value: 'monochrome', weight: baseSaturation < MONOCHROME_SATURATION_CEILING ? 2.5 : 0 }
    ])
  }

  function resolveAccentHue(scheme, baseHue, supportHue, random) {
    var sign = random() < 0.5 ? -1 : 1

    switch (scheme) {
      case 'duotone': return supportHue === null ? baseHue : supportHue
      case 'analogous': return baseHue + sign * (20 + random() * 15)
      case 'complementary': return baseHue + 150 + random() * 30
      case 'split': return baseHue + (sign < 0 ? 150 : 210)
      case 'triadic': return baseHue + sign * 120
      default: return baseHue // monochrome
    }
  }

  // 把封面原始色板转换为主题生成器依赖的色相/色调契约
  function analyzeCoverPalette(coverColors, random) {
    var parsedColors = coverColors
      .map(function (color) { return hexToHsl(color) })
      .filter(function (color) { return color !== null })

    var base = pickBaseColor(parsedColors, random)
    var supportHue = pickSupportHue(parsedColors, base)
    var scheme = pickScheme(base.s, supportHue, random)
    var accentJitter = scheme === 'monochrome' ? 0 : (random() - 0.5) * 16

    return {
      baseHue: normalizeHue(base.h),
      baseSaturation: base.s,
      baseLightness: base.l,
      accentHue: normalizeHue(resolveAccentHue(scheme, base.h, supportHue, random) + accentJitter),
      scheme: scheme,
      tone: pickWeighted(random, [
        { value: 'ink', weight: 3 },
        { value: 'tinted', weight: 4 },
        { value: 'rich', weight: 2.5 }
      ])
    }
  }

  // ---------- 数值设计空间（themeColorRanges.ts） ----------
  var PRIMARY_MIN_CONTRAST = 9
  var ACCENT_MIN_CONTRAST = 3.2
  var SECONDARY_MIN_CONTRAST = 4.5
  var MIN_BACKGROUND_SATURATION = 0.04

  var BACKGROUND_TONES = {
    ink: {
      darkLightness: [0.055, 0.085], darkSaturation: [0.10, 0.22],
      lightLightness: [0.940, 0.965], lightSaturation: [0.05, 0.12]
    },
    tinted: {
      darkLightness: [0.075, 0.110], darkSaturation: [0.20, 0.36],
      lightLightness: [0.920, 0.950], lightSaturation: [0.10, 0.20]
    },
    rich: {
      darkLightness: [0.095, 0.140], darkSaturation: [0.32, 0.50],
      lightLightness: [0.900, 0.935], lightSaturation: [0.18, 0.30]
    }
  }

  var PRIMARY_RANGES = {
    light: { saturation: [0.15, 0.40], lightness: [0.10, 0.20] },
    dark: { saturation: [0.10, 0.30], lightness: [0.90, 0.96] }
  }

  var ACCENT_RANGES = {
    light: { saturation: [0.55, 0.88], lightness: [0.38, 0.55] },
    dark: { saturation: [0.55, 0.92], lightness: [0.55, 0.72] }
  }

  var SECONDARY_RANGES = {
    light: { saturation: [0.15, 0.45], lightness: [0.32, 0.46] },
    dark: { saturation: [0.15, 0.45], lightness: [0.62, 0.76] }
  }

  // ---------- 主题生成（generateBuiltinDualTheme.ts） ----------
  function between(random, range) { return range[0] + random() * (range[1] - range[0]) }

  // 沿较短弧插值，基色/点缀色对不会绕远穿过对立色相
  function lerpHue(from, to, amount) {
    var delta = ((to - from + 540) % 360) - 180
    return normalizeHue(from + delta * amount)
  }

  function buildBackgroundColor(mode, palette, random) {
    var tone = BACKGROUND_TONES[palette.tone]
    var lightnessRange = mode === 'dark' ? tone.darkLightness : tone.lightLightness
    var saturationRange = mode === 'dark' ? tone.darkSaturation : tone.lightSaturation
    // 褪色的封面不应强制褪色的底色，但仍应读起来更平静
    var coverWeight = 0.55 + 0.45 * clamp01(palette.baseSaturation / 0.7)

    return hslToHex({
      h: palette.baseHue,
      s: Math.max(MIN_BACKGROUND_SATURATION, between(random, saturationRange) * coverWeight),
      l: between(random, lightnessRange)
    })
  }

  function buildAccentColor(mode, palette, backgroundColor, primaryColor, random) {
    var ranges = ACCENT_RANGES[mode]
    var saturation = between(random, ranges.saturation)
    var lightness = between(random, ranges.lightness)
    var accent = adjustLightnessForContrast(
      hslToHex({ h: palette.accentHue, s: saturation, l: lightness }),
      backgroundColor,
      ACCENT_MIN_CONTRAST
    )

    // 单色/邻近色点缀可能撞上主文字色；旋转开
    var collidesWithPrimary = getHueDistance(palette.accentHue, palette.baseHue) < 15
      && getContrastRatio(accent, primaryColor) < 1.3

    if (!collidesWithPrimary) return accent

    return adjustLightnessForContrast(
      hslToHex({ h: normalizeHue(palette.accentHue + 40), s: saturation, l: lightness }),
      backgroundColor,
      ACCENT_MIN_CONTRAST
    )
  }

  function buildModeTheme(mode, palette, random) {
    var backgroundColor = buildBackgroundColor(mode, palette, random)

    var primaryRanges = PRIMARY_RANGES[mode]
    var primaryColor = adjustLightnessForContrast(
      hslToHex({
        h: palette.baseHue,
        s: between(random, primaryRanges.saturation),
        l: between(random, primaryRanges.lightness)
      }),
      backgroundColor,
      PRIMARY_MIN_CONTRAST
    )

    var accentColor = buildAccentColor(mode, palette, backgroundColor, primaryColor, random)

    var secondaryRanges = SECONDARY_RANGES[mode]
    var secondaryColor = adjustLightnessForContrast(
      hslToHex({
        h: lerpHue(palette.baseHue, palette.accentHue, 0.2 + random() * 0.4),
        s: between(random, secondaryRanges.saturation),
        l: between(random, secondaryRanges.lightness)
      }),
      backgroundColor,
      SECONDARY_MIN_CONTRAST
    )

    return {
      name: 'Folia',
      description: '',
      backgroundColor: backgroundColor,
      primaryColor: primaryColor,
      accentColor: accentColor,
      secondaryColor: secondaryColor,
      fontStyle: 'sans',
      animationIntensity: 'normal',
      wordColors: [],
      lyricsIcons: [],
      provider: 'Built-in'
    }
  }

  function generateBuiltinDualTheme(coverColors, random) {
    if (!random) random = Math.random
    if (!coverColors) coverColors = []
    var palette = analyzeCoverPalette(coverColors, random)
    return {
      light: buildModeTheme('light', palette, random),
      dark: buildModeTheme('dark', palette, random)
    }
  }

  // ---------- 默认主题（baseThemes.ts：午夜墨染） ----------
  var DEFAULT_THEME = {
    name: 'Midnight Default',
    backgroundColor: '#09090b', // zinc-950
    primaryColor: '#f4f4f5',    // zinc-100
    accentColor: '#f4f4f5',     // zinc-100
    secondaryColor: '#71717a',  // zinc-500
    fontStyle: 'sans',
    animationIntensity: 'normal'
  }

  // ---------- 对外 API ----------
  var themeCache = new Map() // 封面 URL → Promise<Theme>，切歌缓存避免重复取色

  // 取色并生成深色主题（歌词页实际使用的入口）
  function buildThemeFromCover(coverUrl) {
    if (!coverUrl) return Promise.resolve(Object.assign({}, DEFAULT_THEME))
    var cached = themeCache.get(coverUrl)
    if (cached) return cached

    var promise = extractColors(coverUrl, 5).then(function (coverColors) {
      if (!coverColors || coverColors.length === 0) {
        return Object.assign({}, DEFAULT_THEME)
      }
      // 歌词页是深色环境，取 dark 主题
      return generateBuiltinDualTheme(coverColors).dark
    }).catch(function () {
      return Object.assign({}, DEFAULT_THEME)
    })

    themeCache.set(coverUrl, promise)
    // 缓存上限保护
    if (themeCache.size > 30) {
      var firstKey = themeCache.keys().next().value
      themeCache.delete(firstKey)
    }
    return promise
  }

  window.FoliaTheme = {
    extractColors: extractColors,
    extractRepresentativeColors: extractRepresentativeColors,
    generateBuiltinDualTheme: generateBuiltinDualTheme,
    buildThemeFromCover: buildThemeFromCover,
    DEFAULT_THEME: DEFAULT_THEME,
    // 颜色数学（部分模式/背景需要）
    hexToHsl: hexToHsl,
    hslToHex: hslToHex,
    rgbToHex: rgbToHex,
    mixHexColors: function (from, to, amount) {
      var start = parseThemeColor(from)
      var end = parseThemeColor(to)
      if (!start || !end) {
        return rgbToHex(parseThemeColor(to) || parseThemeColor(from) || parseThemeColor(FALLBACK_THEME_COLOR))
      }
      var ratio = clamp01(amount)
      return rgbToHex({
        r: start.r + (end.r - start.r) * ratio,
        g: start.g + (end.g - start.g) * ratio,
        b: start.b + (end.b - start.b) * ratio
      })
    },
    getContrastRatio: getContrastRatio,
    getHueDistance: getHueDistance,
    adjustLightnessForContrast: adjustLightnessForContrast,
    normalizeHue: normalizeHue,
    clamp01: clamp01
  }
})()
