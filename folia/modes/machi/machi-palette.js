// 町景调色板（移植自 engine/palette.ts）：主题色 → 场景各部分的颜色。
// 底子（深蓝灰的夜、暖琥珀的灯）是固定的美术方向，主题只在限定范围里推它：
// 品牌三色条、屏幕字、LED、霓虹、贩卖机、商品用主题色，天空和暖光只偏一点色相。
// 这里是三个场景共用的部分；场景自己的颜色由场景的 resolveArt 给，放进 art。纯函数，颜色都是 #rrggbb。
(function () {
  'use strict'

  var ColorMath = window.FoliaThemeColorMath
  var SeedHash = window.FoliaSeedHash

  /** 主题背景亮度高于它时按亮色主题处理（广告屏换成白底）。 */
  var MACHI_LIGHT_THEME_LUMINANCE = 0.4
  /** 广告屏上的字与底色的最低对比度。 */
  var MACHI_BOARD_MIN_CONTRAST = 4.5
  /** 低于这个饱和度的颜色算“没有颜色”（默认主题的强调色就是灰的）。 */
  var CHROMATIC_SATURATION = 0.22

  /** 主题偏灰时按 seed 选一组：几种常见的便利店招牌配色。 */
  var CLASSIC_BRAND_TRIADS = [
    ['#f0781e', '#f4f1ea', '#1f9a52'],
    ['#2f6fd6', '#f4f1ea', '#58b8ea'],
    ['#1d9a63', '#f4f1ea', '#2d6cc0'],
    ['#e2402f', '#f4f1ea', '#f2b520'],
    ['#7a4fd0', '#f4f1ea', '#f07fae']
  ]

  var PRODUCT_FALLBACK = ['#e85d4a', '#f2c14e', '#4fa3d8', '#7ccf7a', '#f08cc0', '#f4f1ea', '#9b7be0', '#ff9d4d']

  var ART = {
    skyTop: '#0e1524', skyBottom: '#26324a',
    asphalt: '#2a303c', roadPaint: '#c9d1dc',
    concrete: '#4b5363', curb: '#5f6878',
    plinthTop: '#20242c', plinthMid: '#3d3a36', plinthLow: '#2b2622', plinthTrim: '#15171c',
    glass: '#9cc3e6', metal: '#8a94a1', darkMetal: '#383e49', pole: '#979ca4',
    rubber: '#1c1f26', wire: '#11141a', caution: '#e7b42e', stopRed: '#c7302b',
    hemiSky: '#3a4b6c', hemiGround: '#141923', moon: '#9cb3dc',
    skyTopDusk: '#2c2f5c', skyBottomDusk: '#e58a62', hemiSkyDusk: '#8b79a6', hemiGroundDusk: '#30262a', moonDusk: '#ffae78',
    skyTopDay: '#4d8bd4', skyBottomDay: '#cde4f2', hemiSkyDay: '#bcd6ee', hemiGroundDay: '#5f5b52', moonDay: '#fff0da',
    interiorLight: '#ffc887', streetLight: '#ffe4b8', vendingLight: '#d4ebff', gold: '#ffc861'
  }

  function clampRange(value, min, max) { return Math.min(max, Math.max(min, value)) }

  function hslOf(color, fallback) {
    var hsl = color ? ColorMath.hexToHsl(color) : null
    return hsl || ColorMath.hexToHsl(fallback)
  }

  /** 有颜色的主题色：饱和度够的才算。 */
  function isChromatic(color) {
    var hsl = color ? ColorMath.hexToHsl(color) : null
    return !!hsl && hsl.s >= CHROMATIC_SATURATION && hsl.l > 0.08 && hsl.l < 0.94
  }

  /** 招牌色：拉到够鲜、亮度在招牌能读的区间。 */
  function vivid(color, minSaturation, minLightness, maxLightness) {
    minSaturation = minSaturation === undefined ? 0.58 : minSaturation
    minLightness = minLightness === undefined ? 0.42 : minLightness
    maxLightness = maxLightness === undefined ? 0.62 : maxLightness
    var hsl = hslOf(color, ART.gold)
    return ColorMath.hslToHex({ h: hsl.h, s: Math.max(minSaturation, hsl.s), l: clampRange(hsl.l, minLightness, maxLightness) })
  }

  /** 把 base 的色相向 toward 的色相拉 amount（0..1，按最短方向），饱和度、亮度不动。 */
  function pullHue(base, toward, amount) {
    var from = ColorMath.hexToHsl(base)
    var to = ColorMath.hexToHsl(toward)
    if (!to || amount <= 0) return base
    var distance = ColorMath.getHueDistance(from.h, to.h)
    var forward = ColorMath.normalizeHue(from.h + distance) === ColorMath.normalizeHue(to.h) ? 1 : -1
    return ColorMath.hslToHex({ h: ColorMath.normalizeHue(from.h + forward * distance * amount), s: from.s, l: from.l })
  }

  /** 天空 / 路面这些暗色：向主题背景色相偏 ≤25%（背景越有颜色偏得越多），亮度不动。 */
  function tintDark(base, themeBackground) {
    var background = ColorMath.hexToHsl(themeBackground)
    if (!background || background.s < 0.08) return base
    return pullHue(base, themeBackground, Math.min(0.25, background.s * 0.45))
  }

  function seedIndex(seed, salt, length) {
    return SeedHash.hashVisualizerSeed(seed + ':' + salt) % length
  }

  /** 主题里有颜色的候选：强调色、关键词色、主色、次色，按这个顺序。 */
  function chromaticCandidates(theme) {
    var list = [theme.accentColor]
    ;(theme.wordColors || []).forEach(function (entry) { list.push(entry.color) })
    list.push(theme.primaryColor)
    list.push(theme.secondaryColor)
    return list.filter(isChromatic)
  }

  /** 店招三色条：有主题色时第一、三条用主题色，中间一条白；主题偏灰时按 seed 选经典配色。 */
  function resolveBrand(theme, seed) {
    var candidates = chromaticCandidates(theme)
    if (candidates.length === 0) {
      return CLASSIC_BRAND_TRIADS[seedIndex(seed, 'brand', CLASSIC_BRAND_TRIADS.length)]
    }
    var first = vivid(candidates[0])
    var firstHue = ColorMath.hexToHsl(first).h
    var second = null
    for (var i = 1; i < candidates.length; i += 1) {
      if (ColorMath.getHueDistance(ColorMath.hexToHsl(candidates[i]).h, firstHue) >= 40) { second = candidates[i]; break }
    }
    var third
    if (second) third = vivid(second)
    else {
      var firstHsl = ColorMath.hexToHsl(first)
      third = ColorMath.hslToHex({ h: ColorMath.normalizeHue(firstHue + 150), s: firstHsl.s, l: firstHsl.l })
    }
    return [first, '#f4f1ea', third]
  }

  /** 广告屏的字：深色屏上是发光的强调色（偏灰时用金色），白底屏上是压暗到够对比的主题色。 */
  function resolveBoard(theme, brand, isLight) {
    var accent = isChromatic(theme.accentColor) ? theme.accentColor : brand[0]
    if (isLight) {
      var base = '#f3eee4'
      var lit = ColorMath.adjustLightnessForContrast(vivid(accent, 0.62, 0.3, 0.46), base, MACHI_BOARD_MIN_CONTRAST)
      return { base: base, unlit: '#9aa0ab', lit: lit }
    }
    var darkBase = ColorMath.mixHexColors('#0f1420', vivid(accent), 0.12)
    var glow = isChromatic(theme.accentColor) || isChromatic(brand[0]) ? vivid(accent, 0.62, 0.64, 0.74) : ART.gold
    var darkLit = ColorMath.adjustLightnessForContrast(glow, darkBase, MACHI_BOARD_MIN_CONTRAST)
    return { base: darkBase, unlit: '#6c7384', lit: darkLit }
  }

  /** 商品色：先放主题的关键词色和招牌色，不够用经典的糖果色补齐 8 个。 */
  function resolveProducts(theme, brand, seed) {
    var keywordColors = (theme.wordColors || []).map(function (entry) { return entry.color })
      .filter(isChromatic).map(function (color) { return vivid(color, 0.45, 0.45, 0.7) })
    var pool = keywordColors.concat([brand[0], brand[2]], PRODUCT_FALLBACK)
    var offset = seedIndex(seed, 'products', PRODUCT_FALLBACK.length)
    var out = []
    for (var index = 0; index < 8; index += 1) {
      out.push(index < keywordColors.length + 2 ? pool[index] : pool[keywordColors.length + 2 + ((index + offset) % PRODUCT_FALLBACK.length)])
    }
    return out
  }

  /** 主题 → 町景调色板。同样的主题、seed 与场景总得到同样的结果。 */
  function resolveMachiPalette(theme, seed, resolveArt) {
    var background = theme.backgroundColor
    var isLight = ColorMath.getRelativeLuminance(background) > MACHI_LIGHT_THEME_LUMINANCE
    var brand = resolveBrand(theme, seed)
    var board = resolveBoard(theme, brand, isLight)
    var accent = isChromatic(theme.accentColor) ? theme.accentColor : brand[0]
    // 暖光：向强调色偏一点，但保持暖、保持亮。
    var interiorHsl = ColorMath.hexToHsl(ColorMath.mixHexColors(ART.interiorLight, vivid(accent), 0.16))
    var interiorLight = ColorMath.hslToHex({ h: interiorHsl.h, s: interiorHsl.s, l: Math.max(0.72, interiorHsl.l) })
    var signText = ColorMath.getContrastRatio('#1b1f27', brand[1]) >= MACHI_BOARD_MIN_CONTRAST ? '#1b1f27' : '#ffffff'
    var vendingHsl = ColorMath.hexToHsl(brand[2])

    var base = {
      skyTop: tintDark(ART.skyTop, background),
      skyBottom: tintDark(ART.skyBottom, background),
      fog: tintDark(ART.skyBottom, background),
      hemiSky: tintDark(ART.hemiSky, background),
      hemiGround: ART.hemiGround,
      moon: ART.moon,
      skyTopDusk: tintDark(ART.skyTopDusk, background),
      skyBottomDusk: ART.skyBottomDusk,
      hemiSkyDusk: ART.hemiSkyDusk,
      hemiGroundDusk: ART.hemiGroundDusk,
      moonDusk: ART.moonDusk,
      skyTopDay: tintDark(ART.skyTopDay, background),
      skyBottomDay: ART.skyBottomDay,
      hemiSkyDay: ART.hemiSkyDay,
      hemiGroundDay: ART.hemiGroundDay,
      moonDay: ART.moonDay,
      asphalt: tintDark(ART.asphalt, background),
      roadPaint: ART.roadPaint,
      concrete: tintDark(ART.concrete, background),
      curb: ART.curb,
      plinthTop: ART.plinthTop,
      plinthMid: ART.plinthMid,
      plinthLow: ART.plinthLow,
      plinthTrim: ART.plinthTrim,
      glass: ART.glass,
      metal: ART.metal,
      darkMetal: ART.darkMetal,
      pole: ART.pole,
      rubber: ART.rubber,
      wire: ART.wire,
      caution: ART.caution,
      stopRed: ART.stopRed,
      interiorLight: interiorLight,
      streetLight: ART.streetLight,
      vendingLight: ART.vendingLight,
      brand: brand,
      signBase: brand[1],
      signText: signText,
      boardBase: board.base,
      boardUnlit: board.unlit,
      boardLit: board.lit,
      boardIsLight: isLight,
      led: vivid(accent, 0.85, 0.58, 0.66),
      neon: vivid(accent, 0.75, 0.6, 0.7),
      vendingBody: ColorMath.hslToHex({ h: vendingHsl.h, s: Math.min(0.62, Math.max(0.35, vendingHsl.s)), l: 0.42 }),
      vendingAccent: vivid(brand[0], 0.6, 0.48, 0.6),
      products: resolveProducts(theme, brand, seed)
    }
    var out = {}
    Object.keys(base).forEach(function (key) { out[key] = base[key] })
    out.art = resolveArt ? resolveArt(theme, seed, base) : {}
    return out
  }

  /** 调色板摊平成 键 → 颜色（单色键、三色条 brand0..2、商品色 product0..7、场景 art）。 */
  function flattenMachiPalette(palette) {
    var flat = {}
    Object.keys(palette).forEach(function (key) {
      if (typeof palette[key] === 'string') flat[key] = palette[key]
    })
    if (Array.isArray(palette.brand)) palette.brand.forEach(function (color, index) { flat['brand' + index] = color })
    if (Array.isArray(palette.products)) palette.products.forEach(function (color, index) { flat['product' + index] = color })
    Object.keys(palette.art || {}).forEach(function (key) { flat[key] = palette.art[key] })
    return flat
  }

  window.FoliaMachiPalette = {
    resolveMachiPalette: resolveMachiPalette,
    flattenMachiPalette: flattenMachiPalette,
    vivid: vivid,
    seedIndex: seedIndex,
    MACHI_LIGHT_THEME_LUMINANCE: MACHI_LIGHT_THEME_LUMINANCE,
    ART: ART
  }
})()
