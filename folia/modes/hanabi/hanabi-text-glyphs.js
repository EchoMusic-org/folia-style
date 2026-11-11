// 花火（hanabi）字形纹理：移植自 folia-major src/components/visualizer/hanabi/text/glyphs.ts
// 字形纹理：一行用到的字各画一格进同一张 Canvas 2D 图集（白字，着色靠 tint），可选描边胖字、光晕字、半字切片与乱码字表。
// 按 renderResolution 画，图集超过 GPU 纹理上限时整体降分辨率；测量函数可注入（单测在 node 里没有 canvas）。
// 条目形状（GlyphEntry）：{ char, px（纹理里画字用的字号（逻辑像素）：精灵缩放 = 显示字号 / px）,
//   fill（填充字）, fat（描边胖字（描边 + 填充），描边层与描边字的硬阴影用，可为 null）,
//   glow（柔边光晕字（glow 强调），可为 null）, halves（两半字 [Texture, Texture]：lr = 左 / 右（锚点分别在右缘 / 左缘中点），
//   tb = 上 / 下，可为 null）}
// 图集形状（GlyphAtlas）：{ entry(char), scramble（乱码字条目）, paint?（把字画进图集（描边、光晕的 shadowBlur 都在这里，
//   是建字最贵的一步）；只画一次，这次真的画了返回 true。纹理与帧在建图集时就有了，画之前是透明的：镜头快出场时再画，
//   建场景那一帧不用把整段的字都光栅化）, destroy() }
(function () {
  'use strict'

  // 上游的 pixi 参数由调用方传入（buildGlyphAtlas(pixi, options)），本文件不直接引用 window.PIXI。
  // 花火自己的像素密度；hanabi-core 未加载时用同样的公式兜底，保证本文件可独立加载。
  function resolveBaseResolution(devicePixelRatio) {
    return Math.min(2, Math.max(1, devicePixelRatio || 1))
  }
  var resolveHanabiBaseResolution = window.FoliaHanabiCore && window.FoliaHanabiCore.resolveHanabiBaseResolution
    ? window.FoliaHanabiCore.resolveHanabiBaseResolution
    : resolveBaseResolution

  /** 量一个字的宽度（字号的倍数）。 */
  // （测量函数形态：char => number）

  var UPRIGHT = /[ᄀ-ᇿ⺀-⿿　-〿぀-ヿ㄀-ㇿ㈀-鿿가-힯豈-﫿︰-﹏＀-￯]|[\u{20000}-\u{3134f}]/u

  /** 竖排时直立（中日韩字、全角符号）；否则侧转 90°（拉丁字母、数字）。 */
  function isUprightGlyph(char) { return UPRIGHT.test(char) }

  /** 是否含中日韩字（乱码字表选片假名还是拉丁字母）。 */
  function hasCjk(text) { return UPRIGHT.test(text) }

  function glyphFont(weight, px, family) { return weight + ' ' + px + 'px ' + family }

  /** 没有 canvas 时的估算：全角 1、空格 0.3、半角 0.6。 */
  function estimateAdvance(char) {
    if (char.trim().length === 0) return 0.3
    if (isUprightGlyph(char)) return 1
    if (/[ilI.,:;'!|]/.test(char)) return 0.34
    if (/[mwMW@]/.test(char)) return 0.85
    return 0.6
  }

  function createContext() {
    try {
      if (typeof OffscreenCanvas !== 'undefined') {
        var context = new OffscreenCanvas(8, 8).getContext('2d')
        if (context) return context
      }
      if (typeof document !== 'undefined') return document.createElement('canvas').getContext('2d')
    } catch (e) {
      // 没有 canvas 的环境走估算。
    }
    return null
  }

  /** 按字体量字宽（带缓存）；环境里没有 canvas 时退回估算。 */
  function createGlyphMeasure(font, weight) {
    var context = createContext()
    var cache = new Map()
    if (context) context.font = glyphFont(weight, 100, font)
    return function (char) {
      var width = cache.get(char)
      if (width === undefined) {
        width = context ? context.measureText(char).width / 100 : estimateAdvance(char)
        if (!Number.isFinite(width) || width <= 0) width = estimateAdvance(char)
        cache.set(char, width)
      }
      return width
    }
  }

  /**
   * 图集位图边长的基础上限（物理像素，和原来一样）：用户选的分辨率倍数大于 1（超采样）时按倍数放大，字才真的按那个密度画（#929）；
   * 屏幕本身的密度不放大它，倍数为 1 时和原来完全一样。
   */
  var ATLAS_BASE_LIMIT_PX = 4096
  /** 图集位图边长的硬上限（物理像素）：8192² 的 RGBA 已是 256 MB，再大一张就吃掉太多内存与显存。 */
  var ATLAS_HARD_LIMIT_PX = 8192
  /** GPU 单张纹理的边长上限：运行时建好上下文后报上来；报之前（以及单测里）按 WebGL 几乎都满足的 4096 算。 */
  var gpuTextureLimitPx = 4096

  /** 运行时建好 WebGL 上下文后报 MAX_TEXTURE_SIZE（各运行时同一块 GPU，报的值一样）。由运行时批次注入调用。 */
  function setHanabiGlyphTextureLimit(px) {
    if (Number.isFinite(px) && px >= 2048) gpuTextureLimitPx = Math.floor(px)
  }

  /**
   * 图集位图边长上限（物理像素）：基础上限 × 超采样倍数（渲染倍率 ÷ 花火自己的像素密度，不小于 1），再和 GPU 纹理上限、
   * 硬上限取小；给了 maxCanvasPx 就用它。
   */
  function resolveGlyphAtlasLimit(resolution, maxCanvasPx, devicePixelRatio) {
    if (maxCanvasPx !== undefined) return maxCanvasPx
    var superscale = Math.max(1, resolution / resolveHanabiBaseResolution(devicePixelRatio === undefined ? (typeof globalThis !== 'undefined' && globalThis.devicePixelRatio !== undefined ? globalThis.devicePixelRatio : 1) : devicePixelRatio))
    return Math.min(ATLAS_BASE_LIMIT_PX * superscale, Math.max(ATLAS_BASE_LIMIT_PX, gpuTextureLimitPx), ATLAS_HARD_LIMIT_PX)
  }

  /** 一格的边长（逻辑像素）：字框 1.3 倍 + 描边 / 光晕的外扩。 */
  function cellSide(px, outline, glow) {
    return Math.ceil(px * 1.3 + 2 * Math.max(outline * px, glow ? px * 0.32 : 0) + 4)
  }

  // 变体：fill 填充字 / fat 描边胖字 / glow 光晕字。
  // 格子形状（Cell）：{ char, px, variant, side, x, y, scramble }

  /**
   * 建字形图集（options：font 字体栈、weight 字重、resolution 渲染倍率、chars（Map：每个字 → 它要画的字号
   * （逻辑像素，取这个字出现过的最大显示字号））、scramble（乱码字表 { chars, px }，这些字按 px 画，可为 null）、
   * outline（描边宽度（字号的倍数）；0 = 不画胖字）、glow（要不要光晕字）、halves（'lr' | 'tb' | null 两半字切片）、
   * maxCanvasPx（图集位图边长上限（物理像素）；不给时按 resolveGlyphAtlasLimit））。
   */
  function buildGlyphAtlas(pixi, options) {
    var variants = ['fill']
    if (options.outline > 0) variants.push('fat')
    if (options.glow) variants.push('glow')
    var cells = []
    var add = function (char, px, scramble) {
      var side = cellSide(px, options.outline, options.glow)
      var kinds = scramble ? variants.filter(function (v) { return v !== 'glow' }) : variants
      kinds.forEach(function (variant) { cells.push({ char: char, px: px, variant: variant, side: side, x: 0, y: 0, scramble: scramble }) })
    }
    options.chars.forEach(function (px, char) {
      if (char.trim().length > 0) add(char, Math.max(4, px), false)
    })
    if (options.scramble) {
      options.scramble.chars.forEach(function (char) { add(char, Math.max(4, options.scramble.px), true) })
    }

    // 按行装箱（高的在前）。
    var gap = 2
    var area = cells.reduce(function (sum, cell) { return sum + Math.pow(cell.side + gap, 2) }, 0)
    var maxSide = cells.reduce(function (max, cell) { return Math.max(max, cell.side) }, 1)
    var shelfWidth = Math.max(maxSide + gap, Math.ceil(Math.sqrt(area) * 1.15))
    var order = cells.map(function (_, index) { return index }).sort(function (a, b) { return cells[b].side - cells[a].side })
    var x = 0
    var y = 0
    var shelf = 0
    var width = 1
    order.forEach(function (index) {
      var cell = cells[index]
      if (x + cell.side > shelfWidth && x > 0) {
        x = 0
        y += shelf + gap
        shelf = 0
      }
      cell.x = x
      cell.y = y
      x += cell.side + gap
      shelf = Math.max(shelf, cell.side)
      width = Math.max(width, x)
    })
    var height = Math.max(1, y + shelf)
    // 上限按物理像素：位图边长 = 逻辑边长 × resolution，不超过它。
    var limit = resolveGlyphAtlasLimit(options.resolution, options.maxCanvasPx)
    var resolution = Math.max(0.1, Math.min(options.resolution, limit / width, limit / height))

    var canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.ceil(width * resolution))
    canvas.height = Math.max(1, Math.ceil(height * resolution))
    var source = new pixi.CanvasSource({ resource: canvas, resolution: resolution })
    var painted = false
    var paint = function () {
      if (painted) return false
      painted = true
      var context = canvas.getContext('2d')
      context.setTransform(resolution, 0, 0, resolution, 0, 0)
      context.textAlign = 'center'
      context.textBaseline = 'middle'
      context.fillStyle = '#ffffff'
      context.strokeStyle = '#ffffff'
      context.lineJoin = 'round'
      cells.forEach(function (cell) {
        context.font = glyphFont(options.weight, cell.px, options.font)
        var cx = cell.x + cell.side / 2
        var cy = cell.y + cell.side / 2
        if (cell.variant === 'fat') {
          context.lineWidth = options.outline * cell.px * 2
          context.strokeText(cell.char, cx, cy)
          context.fillText(cell.char, cx, cy)
        } else if (cell.variant === 'glow') {
          context.save()
          context.shadowColor = '#ffffff'
          // shadowBlur 不受变换缩放，要自己乘分辨率。
          context.shadowBlur = cell.px * 0.22 * resolution
          context.globalAlpha = 0.85
          context.fillText(cell.char, cx, cy)
          context.fillText(cell.char, cx, cy)
          context.restore()
        } else {
          context.fillText(cell.char, cx, cy)
        }
      })
      // 画之前若已经上传过（透明的），这里让它下一帧重新上传。
      source.update()
      return true
    }

    var textures = []
    var sub = function (fx, fy, fw, fh) {
      var texture = new pixi.Texture({ source: source, frame: new pixi.Rectangle(fx, fy, fw, fh) })
      textures.push(texture)
      return texture
    }
    var entries = new Map()
    var scrambleEntries = new Map()
    cells.forEach(function (cell) {
      var map = cell.scramble ? scrambleEntries : entries
      var entry = map.get(cell.char)
      if (!entry) {
        entry = { char: cell.char, px: cell.px, fill: null, fat: null, glow: null, halves: null }
        map.set(cell.char, entry)
      }
      var texture = sub(cell.x, cell.y, cell.side, cell.side)
      if (cell.variant === 'fill') {
        entry.fill = texture
        if (options.halves && !cell.scramble) {
          var half = cell.side / 2
          entry.halves = options.halves === 'lr'
            ? [sub(cell.x, cell.y, half, cell.side), sub(cell.x + half, cell.y, half, cell.side)]
            : [sub(cell.x, cell.y, cell.side, half), sub(cell.x, cell.y + half, cell.side, half)]
        }
      } else if (cell.variant === 'fat') entry.fat = texture
      else entry.glow = texture
    })
    var blank = { char: ' ', px: 1, fill: pixi.Texture.EMPTY, fat: null, glow: null, halves: null }
    return {
      entry: function (char) {
        var found = entries.get(char)
        return found !== undefined && found !== null ? found : blank
      },
      scramble: options.scramble
        ? options.scramble.chars.map(function (char) { return scrambleEntries.get(char) }).filter(Boolean)
        : [],
      paint: paint,
      destroy: function () {
        textures.forEach(function (texture) { texture.destroy(false) })
        source.destroy()
      },
    }
  }

  var SCRAMBLE_KANA = Array.from('アイウエオカキクケコサシスセソタチツテトナニヌネハヒフヘホマミムメモヤユヨラリルレロワヲン＃％＆＊？！◆※')
  var SCRAMBLE_LATIN = Array.from('ABCDEFGHJKLMNPQRSTUVWXYZ0123456789#%&*?!<>/+=')

  /** 乱码字表：中日文的行用片假名与符号，拉丁字母的行用字母数字与符号；按随机数取 count 个。 */
  function pickScrambleChars(text, count, random) {
    var pool = (hasCjk(text) ? SCRAMBLE_KANA : SCRAMBLE_LATIN).slice()
    var picked = []
    while (picked.length < count && pool.length > 0) {
      picked.push(pool.splice(Math.floor(random() * pool.length), 1)[0])
    }
    return picked
  }

  window.FoliaHanabiTextGlyphs = {
    isUprightGlyph: isUprightGlyph,
    hasCjk: hasCjk,
    glyphFont: glyphFont,
    estimateAdvance: estimateAdvance,
    createGlyphMeasure: createGlyphMeasure,
    setHanabiGlyphTextureLimit: setHanabiGlyphTextureLimit,
    resolveGlyphAtlasLimit: resolveGlyphAtlasLimit,
    buildGlyphAtlas: buildGlyphAtlas,
    pickScrambleChars: pickScrambleChars
  }
})()
