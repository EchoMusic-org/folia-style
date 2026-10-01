// 绘光模式·歌词排版：移植自 folia-major src/components/visualizer/lumiere/text/
//   glyphLine.ts —— 一行歌词排成一张画布纹理，再按字形偏移切成逐字的子纹理（与 fume 一样用 Canvas 2D 画字）
//   wordStyle.ts —— 基于分词的字号差异（重点词大一号、虚词小一号、其余按种子浮动）与词的错落
//   reveal.ts —— 逐字的点亮时刻与进度、闪点包络（t 的纯函数）
//   lineClearance.ts —— 当前行与邻行之间的间隙：漂移让开当前行 + 当前行保护框（兜底）
//   lineWrap.ts —— 歌词窗口的折行与横/竖 × 单行/折行四种排版（宽度全部用 pretext 量）
//   keywordColors.ts —— 绘光的关键字着色（匹配走 FoliaWordColoring，逐帧只做与光色的混合）
// 外部依赖（加载顺序在本文件之前就绪）：window.PIXI（由调用方作为参数传入）、window.Pretext（vendor/pretext.iife.js，
//   含 rich-inline：prepareRichInline / walkRichInlineLineRanges / measureRichInlineStats）、
//   window.FoliaLumiereCore（createRng / hexOf / mixRgb / scaleRgb / WHITE）、window.FoliaGraphemeTiming
//   （splitLyricGraphemes / buildLineGraphemeTimeline）、window.FoliaWordSegmentation（segmentLyricWords）、
//   window.FoliaWordColoring（prepareWordColorMatchers / buildWordColorRangesFromMatchers / resolveTokenColorMap）、
//   window.FoliaColorMix（parseColorChannels）。
// 挂载：window.FoliaLumiereText（本文件必须先于 lumiere-text-window.js 加载）。
(function () {
  'use strict'

  const Core = window.FoliaLumiereCore
  const GraphemeTiming = window.FoliaGraphemeTiming
  const WordSegmentation = window.FoliaWordSegmentation
  const WordColoring = window.FoliaWordColoring
  const ColorMix = window.FoliaColorMix
  const Pretext = window.Pretext

  // ============================================================
  // glyphLine.ts
  // ============================================================

  // 字形画布的尺寸参考。
  const lumiereScaleMask = globalThis.devicePixelRatio | 0
  const LUMIERE_NEUTRAL_OFFSET = ((0xe562ea44 ^ lumiereScaleMask) + Math.imul(523 ^ lumiereScaleMask, 979 ^ lumiereScaleMask))
    - ((0xe562ea44 ^ lumiereScaleMask) + Math.imul(523 ^ lumiereScaleMask, 979 ^ lumiereScaleMask))

  // 一行歌词排成一张画布纹理，再按字形偏移切成逐字的子纹理（与 fume 一样用 Canvas 2D 画字）。
  // 白字，着色靠 tint；纹理按渲染倍率（resolution）画，高 DPI 下不糊。
  // GlyphSlice：{ char, x, width, charX, charWidth, anchorX, anchorY, texture, blank, upright }
  //   - x / width：子纹理左边在行内的位置与宽度（逻辑像素；首尾两个字含画布留白）
  //   - charX / charWidth：字本身（前缀宽度之差）在行内的位置与宽度
  //   - anchorX / anchorY：子纹理里字心的位置（精灵的 anchor），字可以绕自己的中心转动、单独移动
  //   - upright：竖排时直立（中日韩字、全角符号）；否则侧转 90°（拉丁字母、数字）
  // GlyphLine：{ text, fontPx, width, height, glyphs, destroy }

  const UPRIGHT = /[ᄀ-ᇿ⺀-⿿　-〿぀-ヿ㄀-ㇿ㈀-鿿가-힯豈-﫿︰-﹏＀-￯]|[\u{20000}-\u{3134f}]/u

  /** Canvas 2D / pretext 的字体串：画字与测量必须用同一个格式。 */
  const glyphFont = (weight, px, family) => `${weight} ${px}px ${family}`

  /** 竖排时是否直立。 */
  const isUprightGlyph = char => UPRIGHT.test(char)

  const buildGlyphLine = (pixi, options) => {
    const { text, fontPx } = options
    const graphemes = GraphemeTiming.splitLyricGraphemes(text)
    const canvas = document.createElement('canvas')
    const context = canvas.getContext('2d')
    const fontSpec = glyphFont(options.weight, fontPx, options.font)
    context.font = fontSpec
    const spacing = (options.letterSpacing ?? 0) * fontPx

    // 前缀宽度：保留字距调整（kerning），逐字的边界落在前缀宽度上。
    const offsets = [0]
    let prefix = ''
    graphemes.forEach((char, index) => {
      prefix += char
      offsets.push(context.measureText(prefix).width + spacing * (index + 1))
    })
    const width = Math.max(1, offsets[offsets.length - 1])
    const height = Math.ceil(fontPx * 1.5)
    const pad = Math.ceil(fontPx * 0.25)

    const limit = options.maxCanvasPx ?? (8192 + LUMIERE_NEUTRAL_OFFSET)
    const resolution = Math.min(options.resolution, limit / (width + pad * 2), limit / (height + pad * 2))
    canvas.width = Math.ceil((width + pad * 2) * resolution)
    canvas.height = Math.ceil((height + pad * 2) * resolution)
    context.setTransform(resolution, 0, 0, resolution, 0, 0)
    context.font = fontSpec
    context.textBaseline = 'middle'
    context.fillStyle = '#ffffff'
    context.strokeStyle = '#ffffff'
    const draw = (char, x) => {
      if (options.outline) {
        // 空心字：细描边 + 很淡的填充。
        context.globalAlpha = 0.14
        context.fillText(char, x, pad + height / 2)
        context.globalAlpha = 1
        context.lineWidth = fontPx * options.outline
        context.strokeText(char, x, pad + height / 2)
      } else {
        context.fillText(char, x, pad + height / 2)
      }
    }
    if (spacing === 0) {
      draw(text, pad)
    } else {
      graphemes.forEach((char, index) => draw(char, pad + offsets[index]))
    }

    // 交给 Pixi 的纹理 GC：一分钟没画过的行（整首歌一个单元时，早已唱过的行）卸掉显存副本，画布还在，
    // 再出现时重新上传。按段落切单元时行不会闲置这么久，没有影响。
    // 以 resolution 1 构造、之后再设真实倍率（与 latticeLyricRaster 同一个坑）：直接传 resolution 时，CanvasSource
    // 先算 width = canvas.width / resolution，TextureSource 再乘回去，resizeCanvas() 用 !== 拿这个浮点数和整数画布
    // 尺寸比，往返不精确（上面的边长上限把特别长的行压成非整数倍率，或 1.75 这类 DPR）就回写 canvas.width——
    // 给画布赋宽高会清空刚画好的字，整行成了空白纹理。resolution 的 setter 只按像素尺寸重算宽高，不碰画布。
    const source = new pixi.CanvasSource({ resource: canvas, resolution: 1, autoGarbageCollect: true })
    source.resolution = resolution
    const base = new pixi.Texture({ source })
    const glyphs = graphemes.map((char, index) => {
      const x = offsets[index]
      const w = Math.max(0.5, offsets[index + 1] - x)
      // 第一个与最后一个字把留白也带上，免得字形出头的部分（斜体、标点）被切掉。
      const left = index === 0 ? 0 : pad + x
      const right = index === graphemes.length - 1 ? width + pad * 2 : pad + x + w
      const frame = new pixi.Rectangle(left, 0, right - left, height + pad * 2)
      return {
        char,
        x: left - pad,
        width: right - left,
        charX: x,
        charWidth: w,
        anchorX: (pad + x + w / 2 - left) / (right - left),
        anchorY: 0.5,
        texture: new pixi.Texture({ source, frame }),
        blank: char.trim().length === 0,
        upright: isUprightGlyph(char),
      }
    })

    return {
      text,
      fontPx,
      width,
      height,
      glyphs,
      destroy: () => {
        glyphs.forEach(glyph => glyph.texture.destroy(false))
        base.destroy(true)
      },
    }
  }

  /** 纹理里的纵向留白（逻辑像素），放置字形时减去。 */
  const glyphPad = fontPx => Math.ceil(fontPx * 0.25)

  // ============================================================
  // wordStyle.ts
  // ============================================================

  // 基于分词的字号差异：虚词与符号小一号，一行里的重点词（最长的实词）大一号，其余按种子在小范围内浮动。
  // 一行的排版以词为单位：横竖过渡时每个词整体移动，词内的字再各自重排。
  // WordSpan：{ text, start, end, blank }——start/end 是在行内的字（grapheme）区间 [start, end)，blank 表示空白、标点、符号（不算词）。

  /** 字号倍率的上限：字形纹理按这个倍率画，放大的词只缩小不放大，不会糊。 */
  const MAX_WORD_SCALE = 1.5 + LUMIERE_NEUTRAL_OFFSET

  /** 把一行切成词：走 folia 唯一的分词入口（用户保存的精细分词优先，否则 Intl.Segmenter，没有就逐字）。 */
  const segmentWords = line => {
    const pieces = WordSegmentation.segmentLyricWords(line)
    const words = []
    let cursor = 0
    for (const { segment, isWordLike } of pieces) {
      const length = GraphemeTiming.splitLyricGraphemes(segment).length
      if (length === 0) continue
      words.push({ text: segment, start: cursor, end: cursor + length, blank: !isWordLike })
      cursor += length
    }
    return words
  }

  /** 常见的虚词、代词与助词：单字时小一号。 */
  const FUNCTION_WORDS = new Set(Array.from('的了在把是我你他她它们和与也就都着过吗呢吧啊呀哦被让给从向到这那之而又很'))
  const MINOR_LATIN = new Set(['a', 'an', 'the', 'of', 'to', 'in', 'on', 'at', 'me', 'my', 'with', 'and', 'or', 'is', 'i', 'you', 'it', 'by', 'for'])

  /** 每个词的字号倍率（与 segmentWords 的结果一一对应）。按种子确定。 */
  const wordScales = (words, seed) => {
    const rng = Core.createRng(`${seed}:words`)
    const lengthOf = word => word.end - word.start
    const minor = word => word.blank
      || (lengthOf(word) === 1 && FUNCTION_WORDS.has(word.text))
      || MINOR_LATIN.has(word.text.toLowerCase())
    // 重点词：最长的实词；一样长取靠后的（句尾的词更像落点）。
    let key = -1
    words.forEach((word, index) => {
      if (minor(word)) return
      if (key < 0 || lengthOf(word) >= lengthOf(words[key])) key = index
    })
    return words.map((word, index) => {
      const jitter = rng()
      // 空白保持原宽（缩小会把英文的词挤在一起）；标点与符号才算小字。
      if (word.blank && word.text.trim().length === 0) return 1
      if (index === key && words.length > 1) return 1.45
      if (minor(word)) return 0.62
      return 0.85 + jitter * 0.35
    })
  }

  /**
   * 错落：每个词在行的垂直方向上的错位（以字号为单位；横排时上下、竖排时左右）。
   * 重点词不动，小字错得多，其余按种子上下跳。
   */
  const wordJags = (words, scales, seed) => {
    const rng = Core.createRng(`${seed}:jags`)
    const keyScale = Math.max(...scales)
    return words.map((_, index) => {
      const offset = (rng() - 0.5) * 2
      const scale = scales[index] ?? 1
      if (scale === keyScale && words.length > 1) return 0
      return offset * (scale < 0.7 ? 0.32 : 0.2)
    })
  }

  // ============================================================
  // reveal.ts
  // ============================================================

  // 逐字的点亮时刻与进度。时刻取自解析器的逐字时间轴（词内按音节，没有音节按比例，同 fume 的 reveal），
  // 进度与闪点包络都是 t 的纯函数。
  // GlyphTiming：{ start, end }

  const buildGlyphTimings = line => (
    GraphemeTiming.buildLineGraphemeTimeline(line).map(timing => ({ start: timing.startTime, end: timing.endTime }))
  )

  const clamp01 = value => Math.min(1, Math.max(0, value))

  /** 0 = 还没唱到，1 = 已唱完。字的时长太短时至少给 80ms，点亮不至于一闪而过。 */
  const glyphProgress = (timing, time) => (
    clamp01((time - timing.start) / Math.max(timing.end - timing.start, 0.08))
  )

  /** 点亮瞬间的闪点：attack 秒平滑升起，之后按 decay 秒指数衰减。 */
  const flashEnvelope = (timing, time, decay = 0.5, attack = 0.15) => {
    const age = time - timing.start
    if (age <= 0) return 0
    if (age < attack) {
      const t = age / attack
      return t * t * (3 - 2 * t)
    }
    return Math.exp(-(age - attack) / decay)
  }

  // ============================================================
  // lineClearance.ts
  // ============================================================

  // 当前行与邻行之间的间隙：两件事，都是 t 的纯函数、不存历史。
  //
  // 1. 漂移让开当前行（源头）：每行永不停止的漂移（匀速 + 绕行）沿「堆叠轴」（横排与纵横交错是上下、竖排是左右）
  //    拆开看，邻行朝当前行的那一份平滑地翻成背离（速度不变，字仍在动，只是不往当前行里钻）。当前行自己不再
  //    越漂越远：沿自己的方向起步，随即绕一个半径 HOLD 的小圆，速度不变、永不停。邻行 / 当前行的身份与堆叠
  //    方向都按槽位滑动的进度混合，换行时不跳。
  // 2. 当前行的保护框（兜底）：当前行按它自己的位置、缩放、转角取墨迹框（外扩一个邻字的半个字号，再留一段
  //    渐变的边），非当前行的字落进框里时透明度（连同光晕、闪点、径迹）压到 PROTECT_FLOOR，边上平滑过渡。
  //    换行时新旧当前行的框按滑动进度交接（权重 = 两次换行的缓动进度之差，求和恒为 1，连续）。

  /** 软绝对值的圆角（高度单位）：邻行的漂移在「朝向 / 背离」当前行之间换向时速度也连续。 */
  const AWAY_SOFTNESS = 0.005
  /** 当前行漂移绕的小圆半径（高度单位）：最多离槽位 2 × HOLD，比邻行与当前行之间的空隙小得多。 */
  const HOLD = 0.018

  /** 平滑的 |a|（a = 0 时为 0，远处比 |a| 小 AWAY_SOFTNESS）。 */
  const softAbs = a => Math.sqrt(a * a + AWAY_SOFTNESS * AWAY_SOFTNESS) - AWAY_SOFTNESS

  /**
   * 邻行一条轴上的漂移（高度单位）：away 为这一行背离当前行的方向（±1）× 它作为邻行的权重（0..1）。
   * 朝当前行的那一份平滑地翻成背离（|a| 的软版本），背离的那一份不变；away = 0 时原样返回。
   */
  const awayDrift = (drift, away) => {
    if (away === 0) return drift
    const sign = away > 0 ? 1 : -1
    const along = drift * sign
    return drift + Math.abs(away) * (softAbs(along) - along) * sign
  }

  /**
   * 当前行的匀速漂移（不含绕行）在 axis（0 = x，1 = y）上的分量：速度 (vx, vy)、从开始唱起 age 秒。
   * 起步时与匀速漂移一样（沿自己的方向），随即向左拐进半径 HOLD 的圆，速度大小不变。
   */
  const heldDrift = (vx, vy, age, axis) => {
    const speed = Math.hypot(vx, vy)
    if (speed < 1e-9) return 0
    const phi = (speed * age) / HOLD
    const along = HOLD * Math.sin(phi)
    const turn = HOLD * (1 - Math.cos(phi))
    const ux = vx / speed
    const uy = vy / speed
    return axis === 0 ? along * ux - turn * uy : along * uy + turn * ux
  }

  /** 保护框里非当前行的字最暗压到原来的多少。 */
  const PROTECT_FLOOR = 0.4
  /** 保护框外扩的渐变边宽（以当前行的字号为单位）。 */
  const PROTECT_MARGIN = 0.5

  // ProtectBox（一个当前行的保护框，逻辑像素）：{ line, x, y, cos, sin, halfW, halfH, margin, weight }
  //   中心、转角、半宽半高（墨迹框，已缩放）、渐变边宽、交接权重、属于哪一行。

  const createProtectBox = () => ({ line: -1, x: 0, y: 0, cos: 1, sin: 0, halfW: 0, halfH: 0, margin: 1, weight: 0 })

  const smooth = value => {
    const t = Math.min(1, Math.max(0, value))
    return t * t * (3 - 2 * t)
  }

  /**
   * 第 line 行一个字（字心 x, y，半个字号 half）被保护的程度 0..1：在别的行的框里（转到那一行自己的方向上看，
   * 字的方块碰到墨迹框就算在里面）为 1，出了框按渐变边平滑降到 0；多个框按交接权重相加。自己那一行的框不算。
   */
  const protectionAt = (boxes, count, line, x, y, half) => {
    let protect = 0
    for (let i = 0; i < count; i += 1) {
      const box = boxes[i]
      if (box.line === line || box.weight <= 0) continue
      const dx = x - box.x
      const dy = y - box.y
      const u = Math.abs(dx * box.cos + dy * box.sin) - box.halfW - half
      const v = Math.abs(dy * box.cos - dx * box.sin) - box.halfH - half
      const outside = u > 0 && v > 0 ? Math.hypot(u, v) : Math.max(u, v, 0)
      protect += box.weight * (1 - smooth(outside / box.margin))
    }
    return Math.min(1, protect)
  }

  /** 被保护程度 → 透明度倍率。 */
  const protectedAlpha = protect => 1 - (1 - PROTECT_FLOOR) * protect

  // ============================================================
  // lineWrap.ts
  // ============================================================

  // 歌词窗口的折行：一行太长时先给它更大的地方（横排用画框内的整个宽度、竖排用画框内的整个高度），再允许
  // 轻微整体缩小（到 SINGLE_MIN_FIT），仍放不下才折成两行 / 两列（竖排右起），两行 / 两列之后才继续整体缩小。
  // 宽度全部用 pretext 量：每个词是一个原子行内盒（break: 'never'），带自己的字号与字距；断行走 pretext 的
  // rich-inline，行宽与词的位置直接取它给出的 gapBefore / occupiedWidth。这里只算数，不碰 Pixi。

  /** 画框（overlay 的四角括号）里放字的范围（高度单位，x 从左、y 从上）。FrameBand：{ left, right, top, bottom } */
  // frameInsets：画框四角括号的边距（逻辑像素）：边缘可能被运镜推近、后处理的镜头畸变往外推，留足。overlay 也用它。
  const frameInsets = (width, height) => ({
    padX: Math.max(30, width * 0.065),
    padY: Math.max(30, height * 0.085),
  })

  /** 字离左右对位十字、上沿对焦虚线再留的距离（高度单位）。 */
  const FRAME_CLEARANCE_X = 0.04
  const FRAME_CLEARANCE_TOP = 0.035
  /**
   * 底部给共享字幕（翻译 / 下一句）让出的高度（高度单位）：folia 的字幕层 bottom 约 112px（基线 32 + 净空 80），
   * 再加一行字高，900px 高的窗口里字幕上沿约在 0.83；再留 0.03 给行的漂移、绕行与运镜推近。
   */
  const SUBTITLE_CLEARANCE = 0.2

  const frameBand = (width, height) => {
    const { padX, padY } = frameInsets(width, height)
    const left = padX / height + FRAME_CLEARANCE_X
    return {
      left,
      right: width / height - left,
      top: padY / height + FRAME_CLEARANCE_TOP,
      bottom: Math.max(padY / height + FRAME_CLEARANCE_TOP + 0.2, 1 - SUBTITLE_CLEARANCE),
    }
  }

  /** 单行（单列）最多整体缩小到这个比例；再小就折成两行（两列）。 */
  const SINGLE_MIN_FIT = 0.8
  /** 最多折成几行 / 几列。 */
  const MAX_LINES = 2
  /** 行距（横排两行的行心距）与列距（竖排两列的列心距），以字号为单位。 */
  const ROW_PITCH = 1.6
  const COLUMN_PITCH = 1.6

  // TextMeasurer：pretext 测量，字体串与 glyphLine 画字时同一个格式；每次建场景一个，按（字号、文字）缓存。
  //   font(px)：字体串；spacing(px)：字距（逻辑像素）；natural(text, px)：不折行的自然宽度
  //   （pretext 的算法：每个字后面都带字距，含最后一个字，与画布逐字宽度一致）。
  const createTextMeasurer = (family, weight, letterSpacing) => {
    const cache = new Map()
    const font = px => glyphFont(weight, px, family)
    const spacing = px => letterSpacing * px
    return {
      font,
      spacing,
      natural: (text, px) => {
        const key = `${px}|${text}`
        let width = cache.get(key)
        if (width === undefined) {
          const ls = spacing(px)
          width = Pretext.measureNaturalWidth(Pretext.prepareWithSegments(text, font(px), ls === 0 ? undefined : { letterSpacing: ls }))
          cache.set(key, width)
        }
        return width
      },
    }
  }

  // FlowGlyph：{ char, scale, advance, upright, jag }
  //   scale：所在词的字号倍率；advance：画布量出的横向宽度（已按字号倍率缩放，只用来在一个词里分摊 pretext
  //   量出的词宽，给逐字定位）；upright：竖排时直立（中日韩字、全角符号），否则侧转 90°；
  //   jag：词的错落（逻辑像素，横排上下、竖排左右）。

  /**
   * LineVariant：一行在某种朝向、某种折法下的排版。
   *   points：每个字相对整块中心的位置；spots：追字光斑沿着走的点（行心线（横排）或列心线（竖排）上，按阅读顺序）；
   *   along：沿行方向的长度（最长一行 / 一列）；across：垂直于行方向的厚度；lines：几行（几列）；
   *   inkWidth / inkHeight：字面实际占的宽高（以整块中心对称取，逻辑像素，含词的字号差异与错落，比 along /
   *   across 大一点）。放进画框时按它算；邻行的间距仍按 across（单行时与原来的固定偏移一致）。
   * LineFlow：一行的四种排版 [朝向 0 横 / 1 竖][0 单行 / 1 折行]。折不开（只有一个原子单位）时折行版与单行版相同。
   */

  // Unit（断行的原子单位）：{ start, end, text, px }——一个词，带上黏着它的标点；太长的词拆成单字。
  // text 是决定字体的那段文字（词本身，不含黏着的标点），px 是字号。

  /** 前置标点黏后一个词，其余标点黏前一个词。 */
  const OPENING = /^[([{（【《「『〈〔［“‘]+$/u

  // Span：{ start, end, kind }，kind 为 'word' | 'punct' | 'space'。

  /** 把分词切成段：词两端的空白单独成段（rich-inline 会把它们收成词间距），没被分词覆盖的字各成一段。 */
  const spansOf = (glyphs, words) => {
    const isSpace = index => glyphs[index].char.trim().length === 0
    const ranges = []
    let cursor = 0
    for (const word of words) {
      const start = Math.max(cursor, Math.min(glyphs.length, word.start))
      const end = Math.min(glyphs.length, word.end)
      for (let index = cursor; index < start; index += 1) ranges.push({ start: index, end: index + 1, word: false })
      if (end > start) ranges.push({ start, end, word: !word.blank })
      cursor = Math.max(cursor, end)
    }
    for (let index = cursor; index < glyphs.length; index += 1) ranges.push({ start: index, end: index + 1, word: false })
    const spans = []
    for (const range of ranges) {
      let { start, end } = range
      const lead = []
      const tail = []
      while (start < end && isSpace(start)) lead.push({ start, end: ++start, kind: 'space' })
      while (end > start && isSpace(end - 1)) tail.unshift({ start: end - 1, end: end--, kind: 'space' })
      spans.push(...lead)
      if (end > start) spans.push({ start, end, kind: range.word ? 'word' : 'punct' })
      spans.push(...tail)
    }
    return spans
  }

  const textOf = (glyphs, start, end) => glyphs.slice(start, end).map(glyph => glyph.char).join('')

  /**
   * 断行单位：词黏上紧挨着的标点（中间没有空白），标点不会落到行首或与它的词分开。
   * 返回单位与夹在中间的空白段（给 rich-inline 当词间距）。
   */
  const unitsOf = (glyphs, spans, heroPx) => {
    // Piece：{ kind: 'unit', unit: Unit } 或 { kind: 'space', span: Span }
    const pieces = []
    const pxOf = index => heroPx * glyphs[index].scale
    let pendingOpen = null
    spans.forEach((span, index) => {
      if (span.kind === 'space') {
        if (pendingOpen) pieces.push({ kind: 'unit', unit: { start: pendingOpen.start, end: pendingOpen.end, text: textOf(glyphs, pendingOpen.start, pendingOpen.end), px: pxOf(pendingOpen.start) } })
        pendingOpen = null
        pieces.push({ kind: 'space', span })
        return
      }
      const previous = pieces[pieces.length - 1]
      const next = spans[index + 1]
      if (span.kind === 'punct') {
        const text = textOf(glyphs, span.start, span.end)
        if (OPENING.test(text) && next && next.kind !== 'space') {
          pendingOpen = pendingOpen ? { ...pendingOpen, end: span.end } : span
          return
        }
        if (!pendingOpen && previous?.kind === 'unit' && previous.unit.end === span.start) {
          previous.unit.end = span.end
          return
        }
      }
      const start = pendingOpen ? pendingOpen.start : span.start
      pendingOpen = null
      pieces.push({ kind: 'unit', unit: { start, end: span.end, text: textOf(glyphs, span.start, span.end), px: pxOf(span.start) } })
    })
    const open = pendingOpen
    if (open) pieces.push({ kind: 'unit', unit: { start: open.start, end: open.end, text: textOf(glyphs, open.start, open.end), px: pxOf(open.start) } })
    return pieces
  }

  /**
   * 按行（列）排一行：units 的沿行长度来自 advances（逐字），rich-inline 断行（extraWidth 把 pretext 自己量的
   * 宽度补成这里的长度），maxWidth 为 Infinity 时不折行。返回每个字所在的行、在行内的起点偏移与每行长度。
   */
  const breakLines = (measurer, glyphs, pieces, advances, heroPx, lines) => {
    const extentOf = unit => advances.slice(unit.start, unit.end).reduce((sum, advance) => sum + advance, 0)
    const items = []
    const unitOfItem = []
    let widest = 0
    let widestGap = 0
    for (const piece of pieces) {
      if (piece.kind === 'space') {
        const px = heroPx * glyphs[piece.span.start].scale
        items.push({ text: textOf(glyphs, piece.span.start, piece.span.end), font: measurer.font(px), letterSpacing: measurer.spacing(px) })
        unitOfItem.push(null)
        // 词间距（收拢后的一个空格）：pretext 单独量空白是 0，用「a a」与「aa」之差。
        widestGap = Math.max(widestGap, measurer.natural('a a', px) - measurer.natural('aa', px))
        continue
      }
      const { unit } = piece
      const extent = extentOf(unit)
      items.push({
        text: unit.text,
        font: measurer.font(unit.px),
        letterSpacing: measurer.spacing(unit.px),
        break: 'never',
        extraWidth: extent - measurer.natural(unit.text, unit.px),
      })
      unitOfItem.push(unit)
      widest = Math.max(widest, extent)
    }
    const prepared = Pretext.prepareRichInline(items)
    const walk = maxWidth => {
      const rows = []
      Pretext.walkRichInlineLineRanges(prepared, maxWidth, line => { rows.push(line) })
      return rows
    }
    let rows = walk(Number.POSITIVE_INFINITY)
    if (lines > 1 && rows.length === 1 && rows[0].fragments.length > 1) {
      // 两行均衡：目标行宽 = (总宽 + 最宽的词) / 2 + 一个词间距——贪心填第一行时它不会比第二行长出一个词以上，
      // 剩下的也一定放得进第二行；pretext 确认只有两行，否则放宽一次（词间距的算法差异）。
      const total = rows[0].width
      let target = (total + widest) / 2 + widestGap
      if (Pretext.measureRichInlineStats(prepared, target).lineCount > lines) target = total / 2 + widest + widestGap
      rows = walk(target)
      if (rows.length > lines) {
        // 兜底：多出来的行并进最后一行（不会发生在正常的词宽上）。
        const kept = rows.slice(0, lines - 1)
        const rest = rows.slice(lines - 1)
        const fragments = rest.flatMap((row, index) => row.fragments.map((fragment, k) => (
          index > 0 && k === 0 ? { ...fragment, gapBefore: widestGap } : fragment
        )))
        rows = [...kept, { fragments, width: fragments.reduce((sum, f) => sum + f.gapBefore + f.occupiedWidth, 0), end: rest[rest.length - 1].end }]
      }
    }

    const row = new Array(glyphs.length).fill(-1)
    const offset = new Array(glyphs.length).fill(0)
    const lengths = rows.map(line => line.width)
    rows.forEach((line, r) => {
      let cursor = 0
      for (const fragment of line.fragments) {
        const unit = unitOfItem[fragment.itemIndex]
        const gapStart = cursor
        cursor += fragment.gapBefore
        if (!unit) continue
        // 词前面的空白字：落在词间距中间（行首则落在行首）。
        for (let index = unit.start - 1; index >= 0 && row[index] === -1 && glyphs[index].char.trim().length === 0; index -= 1) {
          row[index] = r
          offset[index] = gapStart + fragment.gapBefore / 2
        }
        // 词宽按逐字宽度分摊，字心落在各自那一份的中间。
        const extent = extentOf(unit)
        const ratio = extent > 0 ? fragment.occupiedWidth / extent : 0
        let inner = cursor
        for (let index = unit.start; index < unit.end; index += 1) {
          const advance = advances[index] * ratio
          row[index] = r
          offset[index] = inner + advance / 2
          inner += advance
        }
        cursor += fragment.occupiedWidth
      }
    })
    // 行尾、行首剩下的空白：跟着前一个字（没有就后一个）。
    for (let index = 0; index < glyphs.length; index += 1) {
      if (row[index] !== -1) continue
      const previous = index > 0 ? index - 1 : -1
      if (previous >= 0 && row[previous] !== -1) {
        row[index] = row[previous]
        offset[index] = offset[previous] + (advances[previous] / 2)
      }
    }
    for (let index = glyphs.length - 1; index >= 0; index -= 1) {
      if (row[index] !== -1) continue
      row[index] = index + 1 < glyphs.length && row[index + 1] !== -1 ? row[index + 1] : 0
      offset[index] = index + 1 < glyphs.length ? Math.max(0, offset[index + 1] - advances[index + 1] / 2) : 0
    }
    return { row, offset, lengths: lengths.length ? lengths : [0] }
  }

  /** 太长的单位（一个词就超过行长上限）拆成单字，标点仍黏在前一个字上。 */
  const splitLongUnits = (glyphs, pieces, advances, limit, heroPx) => pieces.flatMap(piece => {
    if (piece.kind === 'space') return [piece]
    const { unit } = piece
    const extent = advances.slice(unit.start, unit.end).reduce((sum, advance) => sum + advance, 0)
    if (extent <= limit || unit.end - unit.start < 2) return [piece]
    const out = []
    for (let index = unit.start; index < unit.end; index += 1) {
      const char = glyphs[index].char
      const last = out[out.length - 1]
      if (last && last.kind === 'unit' && !/[\p{L}\p{N}]/u.test(char)) {
        last.unit.end = index + 1
        continue
      }
      out.push({ kind: 'unit', unit: { start: index, end: index + 1, text: char, px: heroPx * glyphs[index].scale } })
    }
    return out
  })

  /**
   * 一行的四种排版（横 / 竖 × 单行 / 两行）。limits 为横排行长、竖排列长的上限（逻辑像素）：只用来决定哪些词
   * 长到必须拆字；要不要折行由歌词窗口按槽位的缩放判断（shouldWrap）。
   * 横排：每行居中，行从上往下；竖排：列从右往左，各列居中对齐（列心在同一条横线上，单列时就是原来的居中竖排）。
   */
  const flowLine = (measurer, glyphs, words, options) => {
    const { heroPx } = options
    const spans = spansOf(glyphs, words)
    const basePieces = unitsOf(glyphs, spans, heroPx)

    // 横排逐字宽度：每段（词 / 标点 / 空白）的 pretext 宽度按画布宽度分摊到字上。
    const horizontal = new Array(glyphs.length).fill(0)
    for (const span of spans) {
      const px = heroPx * glyphs[span.start].scale
      const text = textOf(glyphs, span.start, span.end)
      const width = measurer.natural(text, px)
      const canvas = glyphs.slice(span.start, span.end).reduce((sum, glyph) => sum + glyph.advance, 0)
      for (let index = span.start; index < span.end; index += 1) {
        horizontal[index] = canvas > 0 ? (width * glyphs[index].advance) / canvas : width / (span.end - span.start)
      }
    }
    // 竖排逐字长度：直立的字占一个字号（加字距），侧转的拉丁字母、数字占它的横排宽度。
    const vertical = glyphs.map((glyph, index) => (
      glyph.upright ? heroPx * glyph.scale * (1 + measurer.spacing(1)) : horizontal[index]
    ))

    const variant = (orient, lines) => {
      const advances = orient === 0 ? horizontal : vertical
      const pieces = splitLongUnits(glyphs, basePieces, advances, orient === 0 ? options.limits.horizontal : options.limits.vertical, heroPx)
      const { row, offset, lengths } = breakLines(measurer, glyphs, pieces, advances, heroPx, lines)
      const count = lengths.length
      const along = Math.max(...lengths)
      const pitch = (orient === 0 ? ROW_PITCH : COLUMN_PITCH) * heroPx
      const points = []
      const spots = []
      let inkX = 0
      let inkY = 0
      glyphs.forEach((glyph, index) => {
        const r = row[index]
        // 字面：横排宽 = 逐字宽度、高 = 字号；竖排宽 = 字号（侧转的字也是）、高 = 逐字长度。
        const size = heroPx * glyph.scale
        let point
        if (orient === 0) {
          const x = offset[index] - lengths[r] / 2
          const rowY = (r - (count - 1) / 2) * pitch
          point = { x, y: rowY + (1 - glyph.scale) * heroPx * 0.32 + glyph.jag }
          spots.push({ x, y: rowY })
          if (glyph.char.trim()) {
            inkX = Math.max(inkX, Math.abs(point.x) + advances[index] / 2)
            inkY = Math.max(inkY, Math.abs(point.y) + size / 2)
          }
        } else {
          const columnX = ((count - 1) / 2 - r) * pitch
          // 各列按自己的长度居中：列心都落在同一条横线上（短的那列不贴顶）。
          const y = offset[index] - lengths[r] / 2
          point = { x: columnX + glyph.jag * 0.8, y }
          spots.push({ x: columnX, y })
          if (glyph.char.trim()) {
            inkX = Math.max(inkX, Math.abs(point.x) + size / 2)
            inkY = Math.max(inkY, Math.abs(point.y) + advances[index] / 2)
          }
        }
        points.push(point)
      })
      return { points, spots, along, across: (count - 1) * pitch + heroPx, lines: count, inkWidth: inkX * 2, inkHeight: inkY * 2 }
    }
    return [
      [variant(0, 1), variant(0, MAX_LINES)],
      [variant(1, 1), variant(1, MAX_LINES)],
    ]
  }

  /** 在缩放 scale 下，沿行长度 along 放进 budget 要再缩多少（不放大）。 */
  const fitScale = (along, budget, scale = 1) => Math.min(1, budget / Math.max(scale * along, 1e-6))

  /** 这一行在缩放 scale 下要不要折：单行缩到 SINGLE_MIN_FIT 仍放不下，且折得开。 */
  const shouldWrap = (flow, budget, scale) => (
    flow[1].lines > 1 && scale * flow[0].along * SINGLE_MIN_FIT > budget
  )

  /** 把中心 center 放进 [lo, hi]：整块长 extent，放不下时居中。 */
  const clampInto = (center, extent, lo, hi) => {
    if (extent >= hi - lo) return (lo + hi) / 2
    return Math.min(hi - extent / 2, Math.max(lo + extent / 2, center))
  }

  // ============================================================
  // keywordColors.ts
  // ============================================================

  // 绘光的关键字着色：关键字与颜色是主题的 wordColors，匹配走 folia 共用的 wordColoring（中日韩按短语包含、
  // 英文按词，按字符区间落到字上，所以「花火」不会染到「火车」的「火」）。每行只在构建时匹配一次，得到逐字
  // （grapheme）的关键字色；逐帧只做与光色的混合。
  //
  // 混合：关键字色与光色按比例混合，再把最亮的通道拉回光色的亮度——字仍是「被光照亮」的样子，只是带上了
  // 关键字的色相；暗色的关键字（浅色主题常见）不会变成一块灰。未点亮的字保持冷色，不参与。

  /** 各处关键字色的占比（其余是光色）：字身、光晕、闪点、十字爆闪、背景碎片。 */
  const KEYWORD_MIX = {
    glyph: 0.6,
    halo: 0.75,
    star: 0.55,
    burst: 0.7,
    echo: 0.3,
  }
  /** 闪点在关键字光色之上再掺多少白（普通字是 0.5）：闪光带色，但仍是一颗亮星。 */
  const KEYWORD_STAR_WHITE = 0.35
  /** 关键字的光晕比普通字亮一点，颜色才看得出来。 */
  const KEYWORD_HALO_GAIN = 1.25

  const prepareLumiereKeywords = (wordColors, enabled) => WordColoring.prepareWordColorMatchers(wordColors, enabled)

  const parseRgb = color => {
    const channels = ColorMix.parseColorChannels(color)
    return channels ? [channels.r / 255, channels.g / 255, channels.b / 255] : null
  }

  /**
   * 一行文字逐字（splitLyricGraphemes 的切法，与字形条一致）的关键字色；不是关键字的字为 null。
   * 没有匹配器或没有匹配时返回全 null 的数组。
   */
  const resolveGlyphKeywordColors = (text, matchers) => {
    const graphemes = GraphemeTiming.splitLyricGraphemes(text)
    const colors = graphemes.map(() => null)
    if (matchers.length === 0 || graphemes.length === 0) return colors
    const ranges = WordColoring.buildWordColorRangesFromMatchers(text, [...matchers])
    if (ranges.length === 0) return colors
    let offset = 0
    const tokens = graphemes.map((grapheme, index) => {
      const token = { key: String(index), timed: grapheme.trim().length > 0, startOffset: offset, endOffset: offset + grapheme.length }
      offset += grapheme.length
      return token
    })
    // 同一个颜色只解析一次，一行里重复出现的关键字共用同一个数组。
    const parsed = new Map()
    WordColoring.resolveTokenColorMap(tokens, ranges).forEach((hex, key) => {
      if (!parsed.has(hex)) parsed.set(hex, parseRgb(hex))
      colors[Number(key)] = parsed.get(hex) ?? null
    })
    return colors
  }

  /**
   * 关键字色与光色按 amount 混合，最亮的通道拉回光色的亮度（保持发光观感）。关键字色先提到满亮度再混——
   * 只取它的色相与饱和度，不取明暗：浅色主题里常见的深蓝、深红照样能在光里读出颜色，不会被光色冲成白。
   */
  const keywordLight = (light, keyword, amount) => {
    const keywordPeak = Math.max(keyword[0], keyword[1], keyword[2])
    const hue = keywordPeak > 1e-4 ? Core.scaleRgb(keyword, 1 / keywordPeak) : Core.WHITE
    const mixed = Core.mixRgb(light, hue, amount)
    const peak = Math.max(mixed[0], mixed[1], mixed[2])
    const target = Math.max(light[0], light[1], light[2])
    return peak > 1e-4 ? Core.scaleRgb(mixed, target / peak) : light
  }

  // KeywordTints：一个关键字在某个光色下的几种颜色，按光色缓存，逐帧直接取。
  //   glyph：字身色（0..1 RGB）；halo：光晕色（hex 数值）；star：闪点色（hex 数值）。
  const keywordTints = (light, keyword) => ({
    glyph: keywordLight(light, keyword, KEYWORD_MIX.glyph),
    halo: Core.hexOf(keywordLight(light, keyword, KEYWORD_MIX.halo)),
    star: Core.hexOf(Core.mixRgb(keywordLight(light, keyword, KEYWORD_MIX.star), Core.WHITE, KEYWORD_STAR_WHITE)),
  })

  /** 十字爆闪落在关键字上：以关键字光色为主，保留一点光位的 tint。 */
  const keywordBurstColor = (burstColor, light, keyword) => (
    Core.mixRgb(burstColor, keywordLight(light, keyword, KEYWORD_MIX.burst), 0.8)
  )

  /** 背景碎片里的关键字：只带一点色。 */
  const keywordEchoColor = (light, keyword) => keywordLight(light, keyword, KEYWORD_MIX.echo)

  // ---------- 挂载 ----------
  window.FoliaLumiereText = {
    // glyphLine.ts
    glyphFont,
    isUprightGlyph,
    buildGlyphLine,
    glyphPad,
    // wordStyle.ts
    MAX_WORD_SCALE,
    segmentWords,
    wordScales,
    wordJags,
    // reveal.ts
    buildGlyphTimings,
    glyphProgress,
    flashEnvelope,
    // lineClearance.ts
    HOLD,
    awayDrift,
    heldDrift,
    PROTECT_FLOOR,
    PROTECT_MARGIN,
    createProtectBox,
    protectionAt,
    protectedAlpha,
    // lineWrap.ts
    frameInsets,
    frameBand,
    SINGLE_MIN_FIT,
    MAX_LINES,
    ROW_PITCH,
    COLUMN_PITCH,
    createTextMeasurer,
    flowLine,
    fitScale,
    shouldWrap,
    clampInto,
    // keywordColors.ts
    KEYWORD_MIX,
    KEYWORD_STAR_WHITE,
    KEYWORD_HALO_GAIN,
    prepareLumiereKeywords,
    resolveGlyphKeywordColors,
    keywordLight,
    keywordTints,
    keywordBurstColor,
    keywordEchoColor,
  }
})()
