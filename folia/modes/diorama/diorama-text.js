// 镜台（diorama）模式·文本模块：移植自 folia-major src/components/visualizer/diorama/
//   ../../utils/fontStacks.ts（按插件规范适配：foliaGetLyricFontFamily 优先，参考 sonnet-core 先例）
//   dioramaTextRaster.ts（全文：canvas 文字光栅化——基底 + 辉光双层共享同一画布几何）
//   dioramaKeywordColor.ts（全文：关键字着色的跟唱 TARGET 解析）
// 依赖：window.THREE、window.FoliaDioramaCore、window.FoliaWordColoring。
// 挂载于 window.FoliaDioramaText。
(function () {
  'use strict'

  var THREE = window.THREE
  var WordColoring = window.FoliaWordColoring

  // ═══════════ 字体栈（原版 utils/fontStacks.ts，按插件规范适配） ═══════════

  var MIN_FONT_WEIGHT = 100
  var MAX_FONT_WEIGHT = 900
  var FONT_WEIGHT_STEP = 10

  // normalizeFontWeight：clamp 100~900 后按 10 取整；非数字返回 null
  function normalizeFontWeight(fontWeight) {
    if (typeof fontWeight !== 'number' || !Number.isFinite(fontWeight)) return null
    var clamped = Math.min(MAX_FONT_WEIGHT, Math.max(MIN_FONT_WEIGHT, fontWeight))
    return Math.round(clamped / FONT_WEIGHT_STEP) * FONT_WEIGHT_STEP
  }

  function resolveThemeFontWeight(theme, fallback) {
    var normalized = normalizeFontWeight(theme && theme.fontWeight)
    return normalized !== null ? normalized : fallback
  }

  // 原版 resolveThemeFontStack：自定义字体族优先，否则按 fontStyle 的内建栈；
  // 插件宿主的歌词字体设置经 foliaGetLyricFontFamily 注入
  var BUILTIN_FONT_STACKS = {
    sans: '"Inter", "Noto Sans CJK SC", "Noto Sans JP", "Source Han Sans SC", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Helvetica Neue", Arial, sans-serif',
    serif: '"Iowan Old Style", "Noto Serif CJK SC", "Noto Serif JP", "Source Han Serif SC", "Songti SC", "STSong", "Georgia", serif',
    mono: '"IBM Plex Mono", "Sarasa Mono SC", "Noto Sans Mono CJK SC", "Noto Sans Mono", "SFMono-Regular", Consolas, monospace'
  }

  function resolveThemeFontStack(theme) {
    if (window.foliaGetLyricFontFamily) {
      var family = window.foliaGetLyricFontFamily()
      if (family) return family
    }
    var fontStyle = theme && theme.fontStyle ? theme.fontStyle : 'sans'
    return BUILTIN_FONT_STACKS[fontStyle] || BUILTIN_FONT_STACKS.sans
  }

  // ═══════════ dioramaTextRaster.ts 全文 ═══════════

  // 为什么用 canvas 而不是 SDF：CJK 字形由重叠笔画轮廓构成（填充回绕规则统一），
  // GPU SDF 生成器处理不好这些重叠，会画出接缝与半透明板块。浏览器自带的 canvas
  // 文字光栅化器与 DOM 字幕同一引擎：任意文体的完美成形，并消费完整 CSS 字体栈。
  //
  // 每个单元（CJK 字/拉丁词）光栅化两次，共享同一画布几何：
  // - base：朴素字形（白色——由材质颜色逐帧着色）
  // - glow：以心象 drawShadowGlowText 配方点亮的字形（三份堆叠模糊，'lighter' 合成），
  //   同样白色，主题 accent 逐帧着色。两者画布尺寸与绘制位置一致，辉光按构造精确对位。

  var DIORAMA_RASTER_FONT_PX = 128
  var DEFAULT_FONT_WEIGHT = 700
  // 围绕中线基线的竖直带（覆盖各字体的上伸/下延）
  var LINE_BAND_EM = 1.4
  // 辉光扩散的留白（必须容纳下方最宽的阴影模糊 + 墨迹外溢）
  var GLOW_PAD_EM = 0.7
  // 普通行光栅（邻居行，无辉光）只需小的墨迹外溢留白
  var PLAIN_PAD_EM = 0.2
  // 长行不超过保证安全的纹理边
  var MAX_CANVAS_PX = 4096
  // 内阴影模糊占 em 的比例；心象的 20/40/58px 阶梯缩放到光栅 em
  var GLOW_BLUR_EM = 0.16

  // fontStack 是 resolveThemeFontStack(theme) 的 CSS 字体族栈——由调用方解析，
  // 光栅只在真实字体选择变化时重建
  function buildDioramaFontSpec(fontStack, fontWeight) {
    if (fontWeight === undefined) fontWeight = DEFAULT_FONT_WEIGHT
    return fontWeight + ' ' + DIORAMA_RASTER_FONT_PX + 'px ' + fontStack
  }

  var measureCtx = null
  function getMeasureCtx() {
    if (!measureCtx) {
      var canvas = document.createElement('canvas')
      canvas.width = 1
      canvas.height = 1
      measureCtx = canvas.getContext('2d')
    }
    return measureCtx
  }

  /** `text` 在 diorama 字体规格下的进宽（含字距），单位光栅 px。 */
  function measureDioramaText(text, fontSpec) {
    var ctx = getMeasureCtx()
    ctx.font = fontSpec
    return ctx.measureText(text).width
  }

  function makeTexture(canvas) {
    var texture = new THREE.CanvasTexture(canvas)
    texture.anisotropy = 4
    texture.colorSpace = THREE.SRGBColorSpace
    return texture
  }

  // 把字形烘焙成纯光晕（心象的模糊阶梯：紧核心 / 中光晕 / 淡外气），全强度——
  // 活强度/颜色由加性材质的 opacity/colour 逐帧给出。
  //
  // 为什么不用心象的精确填充 alpha：canvas 阴影继承源形状的 alpha，心象的淡填充
  // （0.11 × 0.86 阴影 ≈ 每遍 0.09 alpha）依赖 DOM canvas 每帧重绘累积。烘焙进纹理
  // 后光晕峰值接近不可见。所以这里把字形画到画布外——只有模糊后的阴影落在纹理上，
  // 得到无实心填充、从笔画向外扩散的强光晕。
  function drawGlowGlyph(ctx, text, x, y, blur) {
    var OFFSCREEN = 10000
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    ctx.fillStyle = '#ffffff'
    var haloPass = function (passBlur, alpha) {
      ctx.shadowColor = 'rgba(255,255,255,' + alpha + ')'
      ctx.shadowBlur = passBlur
      ctx.shadowOffsetX = OFFSCREEN
      ctx.shadowOffsetY = 0
      ctx.fillText(text, x - OFFSCREEN, y)
    }
    haloPass(blur, 0.95)
    haloPass(blur, 0.85)
    haloPass(blur * 2, 0.55)
    haloPass(blur * 2.9, 0.3)
    ctx.restore()
  }

  /** 光栅化一个歌词单元（base + glow 两层共享一个画布几何）。 */
  function rasterDioramaUnit(text, fontSpec) {
    var em = DIORAMA_RASTER_FONT_PX
    var pad = Math.ceil(em * GLOW_PAD_EM)
    var advancePx = Math.max(1, Math.ceil(measureDioramaText(text, fontSpec)))
    var canvasWidthPx = advancePx + pad * 2
    var canvasHeightPx = Math.ceil(em * LINE_BAND_EM) + pad * 2
    var drawX = pad
    var drawY = canvasHeightPx / 2

    var draw = function (paint) {
      var canvas = document.createElement('canvas')
      canvas.width = canvasWidthPx
      canvas.height = canvasHeightPx
      var ctx = canvas.getContext('2d')
      ctx.font = fontSpec
      ctx.textAlign = 'left'
      ctx.textBaseline = 'middle'
      paint(ctx)
      return makeTexture(canvas)
    }

    var baseTexture = draw(function (ctx) {
      ctx.fillStyle = '#ffffff'
      ctx.fillText(text, drawX, drawY)
    })
    var glowTexture = draw(function (ctx) {
      drawGlowGlyph(ctx, text, drawX, drawY, em * GLOW_BLUR_EM)
    })

    return { baseTexture: baseTexture, glowTexture: glowTexture, canvasWidthPx: canvasWidthPx, canvasHeightPx: canvasHeightPx, advancePx: advancePx }
  }

  /** 把一整行（邻居行）光栅化为一张纯白纹理——无辉光，小留白。 */
  function rasterDioramaLine(text, fontStack, fontWeight) {
    if (fontWeight === undefined) fontWeight = DEFAULT_FONT_WEIGHT
    var fontPx = DIORAMA_RASTER_FONT_PX
    var fontSpec = buildDioramaFontSpec(fontStack, fontWeight)
    var advancePx = Math.max(1, Math.ceil(measureDioramaText(text, fontSpec)))
    var pad = Math.ceil(fontPx * PLAIN_PAD_EM)
    if (advancePx + pad * 2 > MAX_CANVAS_PX) {
      var shrink = (MAX_CANVAS_PX - pad * 2) / advancePx
      fontPx = Math.max(24, Math.floor(fontPx * shrink))
      fontSpec = fontWeight + ' ' + fontPx + 'px ' + fontStack
      advancePx = Math.max(1, Math.ceil(measureDioramaText(text, fontSpec)))
    }
    var canvasWidthPx = advancePx + pad * 2
    var canvasHeightPx = Math.ceil(fontPx * LINE_BAND_EM) + pad * 2

    var canvas = document.createElement('canvas')
    canvas.width = canvasWidthPx
    canvas.height = canvasHeightPx
    var ctx = canvas.getContext('2d')
    ctx.font = fontSpec
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = '#ffffff'
    ctx.fillText(text, pad, canvasHeightPx / 2)

    return { texture: makeTexture(canvas), canvasWidthPx: canvasWidthPx, canvasHeightPx: canvasHeightPx, advancePx: advancePx, fontPx: fontPx }
  }

  // ═══════════ dioramaKeywordColor.ts 全文 ═══════════

  // 关键字着色复用所有可视化器共享的关键字系统：关键字与其颜色是主题自带的
  // `wordColors`，由 prepareWordColorMatchers 匹配。
  //
  // 本模块返回的是逐单元的跟唱 TARGET，不是任何静息涂色。场景把每个字形静息在
  // 朴素歌词色上，只在该单元被唱到时朝这个目标染色。适配判定在 ACTIVE 不透明度上：
  // 被唱到的瞬间是这个颜色唯一出现在屏幕上的瞬间。
  //
  // 按区间（字符偏移）解析——Monet 与 Claddagh 的方式，而非 Fume 的按 token 文本。
  // 镜台把每个 CJK 行拆成单字单元，单字符的文本匹配会渗色（关键字"花火"会让
  // "火车"的"火"也中）。区间按位置解析，只有真正的"花火"染色。

  /** 单元基底材质的未唱/已唱不透明度（与 diorama-scene 一致）。 */
  var ACTIVE_LINE_OPACITY = 0.92

  // 关键字字形对场景的可读性目标（判定在它实际成为的那个像素上）
  var KEYWORD_MIN_BG_CONTRAST = 4.5
  // 与普通歌词色的曼哈顿 RGB 距离低于此值的关键字读作普通文本
  var KEYWORD_MIN_PRIMARY_SEPARATION = 0.4

  var separationFromPrimary = function (color, primary) {
    return Math.abs(color.r - primary.r) + Math.abs(color.g - primary.g) + Math.abs(color.b - primary.b)
  }

  /**
   * 该颜色的文字字形在屏幕上实际成为的颜色：基底材质是白色光栅乘以颜色、
   * 以 ACTIVE_LINE_OPACITY 合成，帧缓冲 sRGB 编码，所以混合在编码值上运行。
   */
  function asDisplayedText(color, background) {
    var src = color.clone().convertLinearToSRGB()
    var dst = background.clone().convertLinearToSRGB()
    var blend = function (s, d) { return s * ACTIVE_LINE_OPACITY + d * (1 - ACTIVE_LINE_OPACITY) }
    return new THREE.Color(blend(src.r, dst.r), blend(src.g, dst.g), blend(src.b, dst.b))
      .convertSRGBToLinear()
  }

  /** 关键字字形该颜色成为的像素对场景的对比度。 */
  function getDioramaKeywordDisplayedContrastRatio(color, background) {
    var wcagContrastRatio = window.FoliaDioramaParticles.getDioramaParticleContrastRatio
    return wcagContrastRatio(asDisplayedText(color, background), background)
  }

  /** 朝 `target` 的最小 lerp，达到 `minimum` 即停；全 lerp 仍不行则用全 lerp。 */
  function nudgeUntil(color, target, minimum, measure) {
    if (measure(color) >= minimum) return color.clone()
    var low = 0
    var high = 1
    for (var iteration = 0; iteration < 10; iteration += 1) {
      var amount = (low + high) * 0.5
      if (measure(color.clone().lerp(target, amount)) >= minimum) high = amount
      else low = amount
    }
    return color.clone().lerp(target, high)
  }

  /**
   * 把主题的关键字颜色带进场景：与普通歌词色可区分、对背景可读——
   * 取达成两者的最小校正。顺序：先区分、后可读性（可读性有最终话语权）。
   */
  function resolveDioramaKeywordColor(keyword, primary, accent, background) {
    // 1. 看起来像普通文本的不是关键字。朝主题 ACCENT 微调（主题自选的强调色），
    //    而不是发明主题从未选过的色相。accent 也退化时则保留主题原色。
    var separated = nudgeUntil(
      keyword,
      accent,
      KEYWORD_MIN_PRIMARY_SEPARATION,
      function (candidate) { return separationFromPrimary(candidate, primary) }
    )
    // 2. 对场景的可读性（在显示像素上）：朝背景对比更大的那极
    var lightTarget = new THREE.Color(0xffffff)
    var darkTarget = new THREE.Color(0x050505)
    var pole = getDioramaKeywordDisplayedContrastRatio(lightTarget, background)
      >= getDioramaKeywordDisplayedContrastRatio(darkTarget, background)
      ? lightTarget
      : darkTarget
    return nudgeUntil(
      separated,
      pole,
      KEYWORD_MIN_BG_CONTRAST,
      function (candidate) { return getDioramaKeywordDisplayedContrastRatio(candidate, background) }
    )
  }

  function prepareDioramaKeywordMatchers(wordColors, enabled) {
    return WordColoring.prepareWordColorMatchers(wordColors, enabled)
  }

  /**
   * 一行的每个单元（按单元下标）的场景就绪关键字颜色。缺失 = 保留朴素歌词色的普通单元。
   * 开关关闭或主题无关键字时为空 Map，场景回退到原始配色。
   */
  function resolveDioramaKeywordUnitColors(lineText, units, matchers, primary, accent, background) {
    var resolved = new Map()
    if (!lineText || units.length === 0 || matchers.length === 0) return resolved

    var ranges = WordColoring.buildWordColorRangesFromMatchers(lineText, matchers)
    if (ranges.length === 0) return resolved

    var colorByKey = WordColoring.resolveTokenColorMap(
      units.map(function (unit, index) {
        return {
          key: String(index),
          timed: true,
          startOffset: unit.charStart,
          endOffset: unit.charEnd
        }
      }),
      ranges
    )
    // 每个不同的关键字颜色只适配一次（不逐字重复搜索）
    var adapted = new Map()
    colorByKey.forEach(function (hex, key) {
      var color = adapted.get(hex)
      if (!color) {
        color = resolveDioramaKeywordColor(new THREE.Color(hex), primary, accent, background)
        adapted.set(hex, color)
      }
      resolved.set(Number(key), color)
    })
    return resolved
  }

  window.FoliaDioramaText = {
    // 字体栈
    resolveThemeFontStack: resolveThemeFontStack,
    resolveThemeFontWeight: resolveThemeFontWeight,
    normalizeFontWeight: normalizeFontWeight,
    BUILTIN_FONT_STACKS: BUILTIN_FONT_STACKS,
    // textRaster
    DIORAMA_RASTER_FONT_PX: DIORAMA_RASTER_FONT_PX,
    DEFAULT_FONT_WEIGHT: DEFAULT_FONT_WEIGHT,
    buildDioramaFontSpec: buildDioramaFontSpec,
    measureDioramaText: measureDioramaText,
    rasterDioramaUnit: rasterDioramaUnit,
    rasterDioramaLine: rasterDioramaLine,
    // keywordColor
    ACTIVE_LINE_OPACITY: ACTIVE_LINE_OPACITY,
    getDioramaKeywordDisplayedContrastRatio: getDioramaKeywordDisplayedContrastRatio,
    resolveDioramaKeywordColor: resolveDioramaKeywordColor,
    prepareDioramaKeywordMatchers: prepareDioramaKeywordMatchers,
    resolveDioramaKeywordUnitColors: resolveDioramaKeywordUnitColors
  }
})()
