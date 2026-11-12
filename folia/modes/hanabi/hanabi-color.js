// 花火（hanabi）调色板：移植自 folia-major src/components/visualizer/hanabi/color.ts
// 预设的 PaletteRole（日式 PV 的高饱和平涂色、夜空里的烟花色）× 主题色 × tuning.colorMode → HanabiPalette。
// 色块上的字色按亮度自动选，并把色块调到与字色有足够的对比度。
// 颜色解析走 window.FoliaColorMix.parseColorChannels；WCAG 亮度与对比度走 window.FoliaThemeColorMath（与上游同公式）。
// HanabiPalette 形状（Pixi 的 0xRRGGBB）：{ ink 色块上的字色, paper 反差色（描边、没有色块时的字色、纸白）,
// blocks 字底色块（按顺序循环取；2–3 个）, sparks 烟花与火花（3–5 个）, accent MG 装饰件的主色, glow 光晕 / 辉光 }。
(function () {
  'use strict'

  var ColorMath = window.FoliaThemeColorMath
  var ColorMix = window.FoliaColorMix

  // ---------- 十六进制 ↔ rgb（0..1 元组，上游 color.ts 自有的色彩数学） ----------

  function rgbOfHex(hex) {
    return [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255]
  }

  function hexOfRgb(rgb) {
    var c = function (v) { return Math.round(Math.min(1, Math.max(0, v)) * 255) }
    return (c(rgb[0]) << 16) | (c(rgb[1]) << 8) | c(rgb[2])
  }

  function cssOfHex(hex) {
    return '#' + hex.toString(16).padStart(6, '0')
  }

  function rgbOfCss(color) {
    var channels = color ? ColorMix.parseColorChannels(color) : null
    return channels ? [channels.r / 255, channels.g / 255, channels.b / 255] : null
  }

  /** 0xRRGGBB，解析失败返回 fallback。 */
  function hexOfCss(color, fallback) {
    var rgb = rgbOfCss(color)
    return rgb ? hexOfRgb(rgb) : fallback
  }

  // ─── HSL（0..1 元组） ───────────────────────────────────────────────────

  function toHsl(rgb) {
    var r = rgb[0]
    var g = rgb[1]
    var b = rgb[2]
    var max = Math.max(r, g, b)
    var min = Math.min(r, g, b)
    var l = (max + min) / 2
    if (max === min) return [0, 0, l]
    var d = max - min
    var s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    var h = max === r ? (g - b) / d + (g < b ? 6 : 0) : (max === g ? (b - r) / d + 2 : (r - g) / d + 4)
    return [h / 6, s, l]
  }

  function toRgb(hsl) {
    var h = hsl[0]
    var s = hsl[1]
    var l = hsl[2]
    if (s === 0) return [l, l, l]
    var q = l < 0.5 ? l * (1 + s) : l + s - l * s
    var p = 2 * l - q
    var channel = function (t) {
      var x = t < 0 ? t + 1 : (t > 1 ? t - 1 : t)
      if (x < 1 / 6) return p + (q - p) * 6 * x
      if (x < 1 / 2) return q
      if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6
      return p
    }
    return [channel(h + 1 / 3), channel(h), channel(h - 1 / 3)]
  }

  function clamp01(value) {
    return Math.min(1, Math.max(0, value))
  }

  /** 色相沿最短方向往 target 转 amount。 */
  function mixHue(from, to, amount) {
    var delta = to - from
    if (delta > 0.5) delta -= 1
    if (delta < -0.5) delta += 1
    return (from + delta * amount + 1) % 1
  }

  /** 调成烟花色：饱和度至少 sat、亮度落在 [minL, maxL]。 */
  function vivid(hex, sat, minL, maxL) {
    var hsl = toHsl(rgbOfHex(hex))
    // 灰色（没有色相）保持灰，只抬亮度。
    var saturation = hsl[1] < 0.05 ? hsl[1] : Math.max(hsl[1], sat)
    return hexOfRgb(toRgb([hsl[0], saturation, Math.min(maxL, Math.max(minL, hsl[2]))]))
  }

  // ─── 对比度（WCAG 亮度与对比度，走 FoliaThemeColorMath） ────────────────

  function relativeLuminance(hex) {
    return ColorMath.getRelativeLuminance(cssOfHex(hex))
  }

  function contrastRatio(a, b) {
    return ColorMath.getContrastRatio(cssOfHex(a), cssOfHex(b))
  }

  /** 色块上的深色字：深梅紫，比纯黑软，和拼贴件的字同色。 */
  var DARK_INK = 0x2b1f3d
  var LIGHT_INK = 0xffffff
  /** 色块与字色的最低对比度。 */
  var MIN_BLOCK_CONTRAST = 3.2

  /** 把色块的亮度朝远离字色的方向推，直到对比度够（最多推到头）。 */
  function separate(block, ink) {
    if (contrastRatio(block, ink) >= MIN_BLOCK_CONTRAST) return block
    var hsl = toHsl(rgbOfHex(block))
    var h = hsl[0]
    var s = hsl[1]
    var l = hsl[2]
    var darker = relativeLuminance(ink) > 0.5
    for (var step = 1; step <= 20; step += 1) {
      var next = hexOfRgb(toRgb([h, s, clamp01(darker ? l - step * 0.04 : l + step * 0.04)]))
      if (contrastRatio(next, ink) >= MIN_BLOCK_CONTRAST) return next
    }
    return darker ? 0x000000 : 0xffffff
  }

  /**
   * 把 color 的亮度往远离 against 的方向推（色相、饱和度不变），直到对比度达到 min；两个方向都试，取先够的那个。
   * 推到头也不够时退回黑 / 白里对比度高的那个。
   */
  function ensureContrast(color, against, min) {
    if (contrastRatio(color, against) >= min) return color
    var hsl = toHsl(rgbOfHex(color))
    var h = hsl[0]
    var s = hsl[1]
    var l = hsl[2]
    // 底色偏亮时先试变暗，偏暗时先试变亮。
    var directions = relativeLuminance(against) > 0.18 ? [-1, 1] : [1, -1]
    for (var step = 1; step <= 25; step += 1) {
      for (var d = 0; d < directions.length; d += 1) {
        var next = hexOfRgb(toRgb([h, s, clamp01(l + directions[d] * step * 0.04)]))
        if (contrastRatio(next, against) >= min) return next
      }
    }
    return contrastRatio(0x000000, against) >= contrastRatio(0xffffff, against) ? 0x000000 : 0xffffff
  }

  /** 被唱到时变的颜色与字底的最低对比度；闪一下、翻牌背面只有一瞬，要求低一些。 */
  var MIN_SUNG_CONTRAST = 3
  var MIN_FLASH_CONTRAST = 2

  /** 字后面没有色块时的底：paper 是与背景反差的那一头，底就取另一头（深色夜空 / 浅色背景）。 */
  function hanabiBackdropOf(palette) {
    return relativeLuminance(palette.paper) > 0.5 ? 0x0b0d24 : 0xf3efe9
  }

  /**
   * 一个字的几种颜色（HanabiGlyphColors），都按它身后的色块（under，没有色块时是 hanabiBackdropOf）来挑：
   * ink 平时的字色（色块上的墨色 / 纸白，或关键字色）推到与色块对比度够；
   * sung 被唱到的颜色（sing: color）、下划线的颜色，在强调色、烟花色、辉光色里挑第一个与色块对比度够、
   * 又和平时字色分得开的，都不够时把强调色推开；flash 闪一下的颜色（sing: flash）；back 翻牌入场转到背面时的颜色。
   * 「混合」配色下第一块色块与强调色都取自主题强调色，不这样挑的话唱完的字会变成色块的颜色、看不见。
   */
  function resolveHanabiGlyphColors(palette, base, under) {
    var ink = ensureContrast(base, under, MIN_SUNG_CONTRAST)
    var candidates = [palette.accent].concat(palette.sparks, [palette.glow])
    var sung = null
    for (var i = 0; i < candidates.length; i += 1) {
      var color = candidates[i]
      if (contrastRatio(color, under) >= MIN_SUNG_CONTRAST && contrastRatio(color, ink) >= 1.3) {
        sung = color
        break
      }
    }
    if (sung === null) sung = ensureContrast(palette.accent, under, MIN_SUNG_CONTRAST)
    return {
      ink: ink,
      sung: sung,
      flash: ensureContrast(palette.glow, under, MIN_FLASH_CONTRAST),
      back: ensureContrast(palette.sparks[0] !== undefined ? palette.sparks[0] : palette.accent, under, MIN_FLASH_CONTRAST)
    }
  }

  // ─── 九种角色的鲜艳配色 ─────────────────────────────────────────────────

  var ROLES = {
    // 夜空：藏青、桃红、堇的色块，金、粉、水色的烟花。
    night: { blocks: [0x1d2b7a, 0xd62f74, 0x5b3cc4], sparks: [0xffd166, 0xff6fa5, 0x7bdff2, 0xffffff, 0xb79cff], accent: 0xffd166, glow: 0xffe3a3 },
    // 祭：朱红、瑠璃、柿色。
    festival: { blocks: [0xe60033, 0x1e50a2, 0xd9480f], sparks: [0xffcc1a, 0xff3355, 0x3cc8ff, 0x6dff9a, 0xffffff], accent: 0xffc400, glow: 0xffa24a },
    // 粉彩：樱粉、天蓝、柠檬。
    pastel: { blocks: [0xff9ec0, 0x8fd8ff, 0xfff08a], sparks: [0xffc4e1, 0xa8e8ff, 0xfff5b0, 0xd4bfff], accent: 0xff7fb2, glow: 0xfff0f6 },
    // 黑白：纸白与灰，墨字，火花偏暖白。
    mono: { blocks: [0xf4f1ea, 0xc9c3b3], sparks: [0xffffff, 0xe8e2d0, 0xfff3d6], accent: 0xffffff, glow: 0xfff7e6 },
    // 金：山吹金与淡金，金色的冠。
    gold: { blocks: [0xf2b01e, 0xffd970, 0xfff1c9], sparks: [0xffd36e, 0xffae3b, 0xfff1c1, 0xff8a3d], accent: 0xffc94a, glow: 0xffcf70 },
    // 霓虹：品红、青、紫。
    neon: { blocks: [0xff2bd6, 0x00e5ff, 0x7a2cff], sparks: [0xff2bd6, 0x00f0ff, 0xb8ff1f, 0xffffff, 0x8f6bff], accent: 0x00f0ff, glow: 0xff6bf0 },
    // 樱：桃红与白。
    sakura: { blocks: [0xff5f9e, 0xfff4f8, 0xffb8d2], sparks: [0xffb7d5, 0xffffff, 0xff6fae, 0xffe0ec], accent: 0xff4f93, glow: 0xffd6e8 },
    // 可爱：泡泡糖粉、天蓝、柠檬黄的色块，粉彩烟花（folia 为日系可爱 PV 加的角色）。
    kawaii: { blocks: [0xff7eb6, 0x7fd8ff, 0xffe066], sparks: [0xffb3d9, 0xa0f0ff, 0xfff3a0, 0xd9b8ff, 0xffffff], accent: 0xff5fa2, glow: 0xffd1e8 },
    // 海：群青、碧、白。
    ocean: { blocks: [0x0a5cff, 0x00c2b8, 0xeaf6ff], sparks: [0x5ce1ff, 0x2bffd5, 0xffffff, 0x4d86ff], accent: 0x5ce1ff, glow: 0xa8f0ff }
  }

  var PALETTE_ROLES = Object.keys(ROLES)

  /** 主题色 → 同一套结构（色块用主色 / 强调色 / 次色，烟花用它们调亮调饱和的版本）。 */
  function themeColors(theme) {
    var primary = hexOfCss(theme.primaryColor, 0xffffff)
    var accent = hexOfCss(theme.accentColor, 0xffd166)
    var secondary = hexOfCss(theme.secondaryColor, accent)
    var spark = function (hex) { return vivid(hex, 0.6, 0.58, 0.8) }
    return {
      blocks: [vivid(accent, 0.55, 0.3, 0.7), vivid(primary, 0.45, 0.25, 0.75), vivid(secondary, 0.5, 0.3, 0.7)],
      sparks: [spark(accent), spark(primary), spark(secondary), 0xffffff],
      accent: spark(accent),
      glow: vivid(accent, 0.5, 0.75, 0.88)
    }
  }

  /** 主题强调色低于这个饱和度（灰、黑白主题）时不进色块与火花：灰色块压不住画面，放在浅色底上还会看不见。 */
  var MIX_MIN_SATURATION = 0.2

  /** mixed：鲜艳配色的色相往主题强调色转 40%，第一块色块直接用主题强调色（强调色是灰的就保留预设自己的配色）。 */
  function mixColors(role, theme) {
    var target = toHsl(rgbOfHex(hexOfCss(theme.accentColor, role.accent)))
    if (target[1] < MIX_MIN_SATURATION) return role
    var themed = themeColors(theme)
    var lean = function (hex) {
      var hsl = toHsl(rgbOfHex(hex))
      if (hsl[1] < 0.05) return hex
      return hexOfRgb(toRgb([mixHue(hsl[0], target[0], 0.4), hsl[1], hsl[2]]))
    }
    var blocks = [themed.blocks[0]]
    for (var i = 1; i < role.blocks.length; i += 1) blocks.push(lean(role.blocks[i]))
    var sparks = [themed.sparks[0]]
    for (var j = 1; j < role.sparks.length; j += 1) sparks.push(lean(role.sparks[j]))
    return {
      blocks: blocks,
      sparks: sparks,
      accent: themed.accent,
      glow: lean(role.glow)
    }
  }

  /** 关键字色（主题 wordColors）：整词命中或包含关键字。返回 (text) => 0xRRGGBB | null；主题没有关键字色时为 undefined。 */
  function keywordColorOf(theme) {
    var entries = []
    var wordColors = theme.wordColors || []
    wordColors.forEach(function (entry) {
      var word = entry.word.trim().toLowerCase()
      var color = rgbOfCss(entry.color)
      if (word.length > 0 && color !== null) entries.push({ word: word, color: color })
    })
    if (entries.length === 0) return undefined
    return function (text) {
      var key = text.trim().toLowerCase()
      if (!key) return null
      var hit = null
      for (var i = 0; i < entries.length; i += 1) {
        if (key === entries[i].word || key.indexOf(entries[i].word) >= 0) {
          hit = entries[i]
          break
        }
      }
      return hit ? hexOfRgb(hit.color) : null
    }
  }

  /**
   * 一个镜头的调色板。paper 与背景（主题 backgroundColor）反差：深底上是纸白、浅底上是墨色；
   * ink 在深浅两色里挑与所有色块最低对比度最大的一个，再把对比度不够的色块推亮 / 推暗。
   */
  function resolveHanabiPalette(role, theme, colorMode) {
    var base = ROLES[role] || ROLES.night
    var colors = colorMode === 'theme' ? themeColors(theme) : (colorMode === 'mixed' ? mixColors(base, theme) : base)
    var background = hexOfCss(theme.backgroundColor, 0x000000)
    var paper = relativeLuminance(background) > 0.4 ? DARK_INK : LIGHT_INK
    var worst = function (ink) {
      var min = Infinity
      for (var i = 0; i < colors.blocks.length; i += 1) {
        var ratio = contrastRatio(colors.blocks[i], ink)
        if (ratio < min) min = ratio
      }
      return min
    }
    var ink = worst(DARK_INK) >= worst(LIGHT_INK) ? DARK_INK : LIGHT_INK
    var blocks = []
    for (var b = 0; b < colors.blocks.length; b += 1) blocks.push(separate(colors.blocks[b], ink))
    return {
      ink: ink,
      paper: paper,
      blocks: blocks,
      sparks: colors.sparks,
      accent: colors.accent,
      glow: colors.glow
    }
  }

  window.FoliaHanabiColor = {
    hexOfRgb: hexOfRgb,
    cssOfHex: cssOfHex,
    hexOfCss: hexOfCss,
    relativeLuminance: relativeLuminance,
    contrastRatio: contrastRatio,
    MIN_BLOCK_CONTRAST: MIN_BLOCK_CONTRAST,
    ensureContrast: ensureContrast,
    MIN_SUNG_CONTRAST: MIN_SUNG_CONTRAST,
    MIN_FLASH_CONTRAST: MIN_FLASH_CONTRAST,
    hanabiBackdropOf: hanabiBackdropOf,
    resolveHanabiGlyphColors: resolveHanabiGlyphColors,
    PALETTE_ROLES: PALETTE_ROLES,
    keywordColorOf: keywordColorOf,
    resolveHanabiPalette: resolveHanabiPalette
  }
})()
