// 花火（hanabi）文字引擎：移植自 folia-major src/components/visualizer/hanabi/text/lyricText.ts
// 花火的文字引擎：一行歌词 → 逐字精灵（字 + 描边 + 硬阴影 + 特效层）与字底色块，入场 / 被唱强调 / 退场三段全由 t 决定。
// 色块与字分成 blocks / glyphs 两个子容器（分层导出），anchors(t) 给 MG 装饰件跟随每个字。
// 消费共享模块：window.FoliaGraphemeTiming（字形时间轴与拆字）、window.FoliaWordSegmentation.segmentLyricWords（分词）、
//   window.FoliaHanabiCore.createRng（确定性随机）、window.FoliaHanabiColor（hanabiBackdropOf / resolveHanabiGlyphColors）、
//   window.FoliaHanabiTextAnimations / TextLayout / TextBlocks / TextGlyphs（本目录其余文件）。
// 字体栈与字重：与上游 resolveThemeFontStack / resolveThemeFontWeight 同语义——优先调用方传的 options.font { stack, weight }
//   （与 machi 模式的 MachiFont 同形态），否则按宿主主题拼（fontFamilyStack / fontFamily / fontStyle + 兜底，
//   字重走 window.foliaGetLyricFontWeight 全局覆盖）。
// 视图形状（HanabiTextView）：{ view, blocks（只含色块的子容器）, glyphs（只含字的子容器）, update(time),
//   prepare()（把字形图集画好（一行字最贵的一步，只做一次）；这次真的画了返回 true。不调用时第一次 update 会补画）,
//   anchors(time)（某时刻每个字的位置与状态（GlyphAnchor：{ char, x, y, size, sungAt, sungEnd, landedAt, alpha, blank }））,
//   bounds（静止排好时的包围盒，本地坐标）, destroy() }
// 构建参数形状（HanabiTextOptions）：{ pixi, width, height, resolution, theme（或 font: { stack, weight }）,
//   line（一行歌词（逐字时间在 words 里））, regionWidth / regionHeight（文字区的宽高，像素）,
//   spec（TextSpec：{ layout, heroSize（主字号占画面短边的比例）, emphasis, tilt, block, enter, sing, exit, stagger, outline, hardShadow }）,
//   palette（HanabiPalette）, seed, enterAt（入场动画开始的时刻；最后一个字入场完成不晚于该行第一个字被唱到）,
//   exitAt / exitDuration（退场动画开始的时刻与时长）, motion（动作幅度倍率，tuning.textMotion）,
//   blockOpacity（色块不透明度，tuning.blockOpacity）, keywordColor?（关键字色（主题 wordColors），命中的字用这个颜色）}
// 可替换依赖（HanabiTextDeps，单测在 node 里注入假的测量与图集）：{ measure?（char => 宽（字号的倍数））, buildAtlas? }
(function () {
  'use strict'

  var Animations = window.FoliaHanabiTextAnimations
  var Blocks = window.FoliaHanabiTextBlocks
  var Glyphs = window.FoliaHanabiTextGlyphs
  var Layout = window.FoliaHanabiTextLayout
  var Color = window.FoliaHanabiColor
  var GraphemeTiming = window.FoliaGraphemeTiming
  var WordSegmentation = window.FoliaWordSegmentation
  var SeedHash = window.FoliaSeedHash
  var clamp01 = Animations.clamp01
  // 确定性随机流；hanabi-core 未加载时退回 seed-hash 的同一条流，保证本文件可独立加载。
  var createRng = window.FoliaHanabiCore && window.FoliaHanabiCore.createRng ? window.FoliaHanabiCore.createRng : SeedHash.createVisualizerRng

  // ─── 字体栈与字重（上游 utils/fontStacks.ts 的最小子集 + machi 的宿主桥接） ───

  /** 字重规范化：100–900、按 10 取整；不是有限数返回 null。 */
  function normalizeFontWeight(value) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return null
    return Math.round(Math.min(900, Math.max(100, value)) / 10) * 10
  }

  /** 字体栈：优先调用方传的 options.font.stack；否则按宿主主题拼（与 modes/machi 的 themeFontStack 同法）。 */
  function resolveTextFontStack(theme, fontOption) {
    if (fontOption && typeof fontOption.stack === 'string' && fontOption.stack) return fontOption.stack
    var stack = []
    if (theme && theme.fontFamilyStack && theme.fontFamilyStack.length) stack = stack.concat(theme.fontFamilyStack)
    if (theme && theme.fontFamily) stack.push(theme.fontFamily)
    if (theme && theme.fontStyle === 'serif') stack.push('serif')
    else if (theme && theme.fontStyle === 'mono') stack.push('monospace')
    else stack.push('sans-serif')
    if (typeof window.foliaBridgeFontStack === 'function') {
      var host = window.foliaBridgeFontStack(theme)
      if (host) return host
    }
    return stack.join(', ')
  }

  /** 字重：优先调用方传的 options.font.weight；否则全局字重覆盖（foliaGetLyricFontWeight），再退主题、最后 fallback（上游默认 800）。 */
  function resolveTextFontWeight(theme, fontOption, fallback) {
    if (fontOption && typeof fontOption.weight === 'number' && Number.isFinite(fontOption.weight)) {
      return normalizeFontWeight(fontOption.weight) !== null ? normalizeFontWeight(fontOption.weight) : fallback
    }
    if (typeof window.foliaGetLyricFontWeight === 'function') return window.foliaGetLyricFontWeight(fallback || 800)
    var normalized = normalizeFontWeight(theme && theme.fontWeight)
    return normalized !== null ? normalized : fallback
  }

  /** 行 → 词（字区间按 grapheme 计）：手动分词 → icu-folia → Intl.Segmenter；对不上时退回逐字。 */
  function lineWords(line, count) {
    var words = []
    var cursor = 0
    WordSegmentation.segmentLyricWords(line).forEach(function (segment) {
      var length = GraphemeTiming.splitLyricGraphemes(segment.segment).length
      if (length === 0) return
      var space = segment.segment.trim().length === 0
      words.push({ text: segment.segment, start: cursor, end: cursor + length, blank: space || !segment.isWordLike, space: space, scale: 1 })
      cursor += length
    })
    if (cursor === count) return words
    return GraphemeTiming.splitLyricGraphemes(line.fullText).map(function (char, index) {
      var space = char.trim().length === 0
      return { text: char, start: index, end: index + 1, blank: space || !/[\p{L}\p{N}]/u.test(char), space: space, scale: 1 }
    })
  }

  function mixColor(a, b, t) {
    if (t <= 0) return a
    if (t >= 1) return b
    var r = ((a >> 16) & 0xff) + ((((b >> 16) & 0xff) - ((a >> 16) & 0xff)) * t)
    var g = ((a >> 8) & 0xff) + ((((b >> 8) & 0xff) - ((a >> 8) & 0xff)) * t)
    var bl = (a & 0xff) + (((b & 0xff) - (a & 0xff)) * t)
    return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(bl)
  }

  /** 描边宽度（字号的倍数，每侧）。 */
  var OUTLINE_WIDTH = 0.085
  /** 硬阴影的错位（字号的倍数）与相对字的滞后（秒）。 */
  var SHADOW_OFFSET_X = 0.07
  var SHADOW_OFFSET_Y = 0.085
  var SHADOW_LAG = 0.045
  var REST_POSE = Animations.restPose()
  var REST_SING = Animations.restSing()

  // 特效层模式：off 关 / split 两半字 / ghost 模糊重影 / rgb 红青分色。

  // 字的挂载记录（Rig）：{ index, char, x, y, size, rotation, angle, entry（字形图集条目）, tint,
  //   sungTint / flashTint / backTint（被唱到、闪一下、翻到背面时的颜色：按这个字身后的色块挑，保证看得见）、
  //   shadowTint, outlineTint, main, shadow?, outline?, fxA?, fxB?, halo?, fxMode, texture,
  //   enterStart, landed, exitStart, exitEnd, sungAt, sungEnd, ctx（FxContext）,
  //   pose / sing（最近一次求值（update / anchors 共用））, visible }

  /** Pixi v8 销毁纪律：树逐节点无参 destroy（禁 destroy({children:true})）。 */
  function destroyTree(container) {
    for (var i = container.children.length - 1; i >= 0; i -= 1) destroyTree(container.children[i])
    container.destroy()
  }

  function buildHanabiText(options, deps) {
    if (!deps) deps = {}
    var pixi = options.pixi
    var spec = options.spec
    var palette = options.palette
    var line = options.line
    var motion = Math.max(0, options.motion)
    var font = resolveTextFontStack(options.theme, options.font)
    var weight = resolveTextFontWeight(options.theme, options.font, 800)
    var measure = deps.measure ? deps.measure : Glyphs.createGlyphMeasure(font, weight)
    var rng = createRng(options.seed + ':text')

    // ─── 字、词与时间 ───
    var timeline = GraphemeTiming.buildLineGraphemeTimeline(line)
    var chars = timeline.map(function (item) { return item.char })
    var words = lineWords(line, chars.length)
    var scales = Layout.wordScales(words, spec.emphasis, options.seed)
    words.forEach(function (word, index) { word.scale = scales[index] })
    var glyphWord = []
    for (var gi = 0; gi < chars.length; gi += 1) glyphWord.push(0)
    words.forEach(function (word, index) {
      for (var g = word.start; g < word.end; g += 1) glyphWord[g] = index
    })
    var inputs = chars.map(function (char, index) {
      return {
        char: char,
        advance: measure(char),
        blank: char.trim().length === 0,
        upright: Glyphs.isUprightGlyph(char),
        word: glyphWord[index],
      }
    })
    var layoutParams = Blocks.blockLayoutParams(spec.block, spec.hardShadow)
    var placement = Layout.layoutText(inputs, words, {
      layout: spec.layout,
      regionWidth: options.regionWidth,
      regionHeight: options.regionHeight,
      fontPx: spec.heroSize * Math.min(options.width, options.height),
      tilt: spec.tilt,
      seed: options.seed,
      tracking: layoutParams.tracking,
      wordGap: layoutParams.wordGap,
      lineHeight: layoutParams.lineHeight,
      minAdvance: layoutParams.minAdvance,
      stairStep: layoutParams.stairStep,
      padding: layoutParams.padding,
    })
    var glyphs = placement.glyphs
    var centerX = placement.bounds.x + placement.bounds.width / 2
    var centerY = placement.bounds.y + placement.bounds.height / 2

    var visibleIndices = glyphs
      .map(function (glyph, index) { return glyph.blank ? -1 : index })
      .filter(function (index) { return index >= 0 })
    var visibleCount = visibleIndices.length
    var orderRanks = Animations.enterOrder(spec.enter, visibleCount, rng)
    var enterRanks = []
    for (var er = 0; er < chars.length; er += 1) enterRanks.push(-1)
    visibleIndices.forEach(function (index, ordinal) { enterRanks[index] = orderRanks[ordinal] })
    var firstSung = visibleIndices.reduce(function (min, index) { return Math.min(min, timeline[index].startTime) }, Number.POSITIVE_INFINITY)
    var deadline = Number.isFinite(firstSung) ? firstSung : line.startTime
    var enter = Animations.scheduleEnter(spec.enter, enterRanks, options.enterAt, spec.stagger, deadline)
    var exitRanks = []
    for (var xr = 0; xr < chars.length; xr += 1) exitRanks.push(-1)
    var exitShuffle = spec.exit === 'scatter' || spec.exit === 'dissolve'
      ? Animations.enterOrder('scramble', visibleCount, createRng(options.seed + ':exit-order'))
      : visibleIndices.map(function (_, ordinal) { return ordinal })
    visibleIndices.forEach(function (index, ordinal) { exitRanks[index] = exitShuffle[ordinal] })
    var exit = Animations.scheduleExit(exitRanks, options.exitAt, options.exitDuration)

    // ─── 容器 ───
    var view = new pixi.Container()
    view.label = 'hanabi-text'
    // 色块与字各是一个渲染组：入场 / 退场时字的精灵逐个显隐、色块与擦除遮罩重画，Pixi 会把所在渲染组的绘制指令
    // 整组重排；单独成组后只重排这一行字，不牵动整个舞台。
    var blocksRoot = new pixi.Container({ isRenderGroup: true })
    blocksRoot.label = 'hanabi-text-blocks'
    var glyphsRoot = new pixi.Container({ isRenderGroup: true })
    glyphsRoot.label = 'hanabi-text-glyphs'
    view.addChild(blocksRoot)
    view.addChild(glyphsRoot)
    // 内层：整组震动只动内层，外层留给场景摆放。
    var blocksInner = new pixi.Container()
    var glyphsInner = new pixi.Container()
    blocksRoot.addChild(blocksInner)
    glyphsRoot.addChild(glyphsInner)
    var masked = new pixi.Container()
    var shadowLayer = new pixi.Container()
    var outlineLayer = new pixi.Container()
    var haloLayer = new pixi.Container()
    var fxLayer = new pixi.Container()
    var mainLayer = new pixi.Container()
    var overlayLayer = new pixi.Container()
    masked.addChild(shadowLayer)
    masked.addChild(outlineLayer)
    masked.addChild(haloLayer)
    masked.addChild(fxLayer)
    masked.addChild(mainLayer)
    glyphsInner.addChild(masked)
    glyphsInner.addChild(overlayLayer)

    var blocks = Blocks.createBlocks({
      pixi: pixi,
      style: spec.block,
      placement: placement,
      words: words,
      palette: palette,
      opacity: clamp01(options.blockOpacity),
      motion: motion,
      exit: spec.exit,
      seed: options.seed,
      // 色块在字差不多到位时出现。
      enterStart: enter.start.map(function (start) { return start + enter.duration * Animations.ENTER_ARRIVAL[spec.enter] }),
      exitStart: exit.start,
      exitEnd: exit.end,
      centerX: centerX,
      centerY: centerY,
    })
    blocksInner.addChild(blocks.view)

    // ─── 纹理 ───
    var needFx = spec.enter === 'glitch' || spec.enter === 'zoom' || spec.enter === 'split' || spec.exit === 'dissolve'
    var halvesKind = spec.enter === 'split' ? (placement.vertical ? 'tb' : 'lr') : null
    var charPx = new Map()
    var maxSize = 0
    visibleIndices.forEach(function (index) {
      var glyph = glyphs[index]
      // 留一点余量给强调时的放大。
      var px = Math.ceil(glyph.size * 1.12)
      var known = charPx.get(glyph.char)
      charPx.set(glyph.char, Math.max(known !== undefined ? known : 0, px))
      maxSize = Math.max(maxSize, px)
    })
    var scrambleChars = spec.enter === 'scramble' ? Glyphs.pickScrambleChars(line.fullText, 14, createRng(options.seed + ':scramble')) : []
    var atlas = (deps.buildAtlas ? deps.buildAtlas : Glyphs.buildGlyphAtlas)(pixi, {
      font: font,
      weight: weight,
      resolution: options.resolution,
      chars: charPx,
      scramble: scrambleChars.length > 0 ? { chars: scrambleChars, px: maxSize } : null,
      outline: spec.outline ? OUTLINE_WIDTH : 0,
      glow: spec.sing === 'glow',
      halves: halvesKind,
    })

    // ─── 颜色 ───
    var role = Blocks.blockTextRole(spec.block)
    var baseInk = role === 'ink' ? palette.ink : palette.paper
    var firstBlock = palette.blocks.length > 0 ? palette.blocks[0] : palette.accent
    // 没有色块的字，身后是夜空（或浅色背景）。
    var backdrop = Color.hanabiBackdropOf(palette)

    // ─── 精灵 ───
    var makeSprite = function (layer, texture) {
      var sprite = new pixi.Sprite(texture)
      sprite.anchor.set(0.5)
      sprite.visible = false
      layer.addChild(sprite)
      return sprite
    }
    var slideDistance = (Math.max(options.regionWidth, options.regionHeight) * 0.8) / Math.max(1, placement.fontPx) + 3
    var rigs = visibleIndices.map(function (index, ordinal) {
      var glyph = glyphs[index]
      var entry = atlas.entry(glyph.char)
      var word = words[glyph.word]
      var keyword = null
      if (options.keywordColor) {
        // 字色、关键字色、被唱到 / 闪一下 / 翻牌背面的颜色都按身后的色块挑：与色块同色的会被推开（色相不变）。
        var probe = word && word.text !== undefined ? word.text : glyph.char
        keyword = options.keywordColor(probe)
        if (keyword === undefined || keyword === null) keyword = options.keywordColor(glyph.char)
        if (keyword === undefined) keyword = null
      }
      var under = blocks.colorOf(index)
      var colors = Color.resolveHanabiGlyphColors(palette, keyword !== null && keyword !== undefined ? keyword : baseInk, under !== null && under !== undefined ? under : backdrop)
      var tint = colors.ink
      var outlineTint = tint === palette.paper || under === palette.paper ? firstBlock : palette.paper
      var shadowTint = under !== null
        ? Blocks.darken(under, 0.42)
        : (spec.outline && outlineTint === firstBlock ? (palette.blocks.length > 1 ? palette.blocks[1] : Blocks.darken(firstBlock, 0.45)) : firstBlock)
      var rig = {
        index: index,
        char: glyph.char,
        x: glyph.x,
        y: glyph.y,
        size: glyph.size,
        rotation: glyph.rotation,
        angle: glyph.angle,
        entry: entry,
        tint: tint,
        sungTint: colors.sung,
        flashTint: colors.flash,
        backTint: colors.back,
        shadowTint: shadowTint,
        outlineTint: outlineTint,
        shadow: spec.hardShadow ? makeSprite(shadowLayer, entry.fat !== null ? entry.fat : entry.fill) : null,
        outline: spec.outline && entry.fat ? makeSprite(outlineLayer, entry.fat) : null,
        halo: spec.sing === 'glow' && entry.glow ? makeSprite(haloLayer, entry.glow) : null,
        fxA: needFx ? makeSprite(fxLayer, entry.fill) : null,
        fxB: needFx ? makeSprite(fxLayer, entry.fill) : null,
        main: makeSprite(mainLayer, entry.fill),
        fxMode: 'off',
        texture: entry.fill,
        enterStart: enter.start[index],
        landed: enter.landed[index],
        exitStart: exit.start[index],
        exitEnd: exit.end[index],
        sungAt: timeline[index].startTime,
        sungEnd: timeline[index].endTime,
        ctx: {
          index: ordinal,
          count: visibleCount,
          rand: [rng(), rng(), rng(), rng()],
          toCenterX: (centerX - glyph.x) / Math.max(1, glyph.size),
          toCenterY: (centerY - glyph.y) / Math.max(1, glyph.size),
          dirX: Math.cos(glyph.angle),
          dirY: Math.sin(glyph.angle),
          time: 0,
          motion: motion,
          slideDistance: slideDistance,
        },
        pose: Animations.restPose(),
        sing: Animations.restSing(),
        visible: false,
      }
      if (rig.shadow) rig.shadow.tint = shadowTint
      if (rig.outline) rig.outline.tint = outlineTint
      if (rig.halo) {
        rig.halo.tint = palette.glow
        rig.halo.blendMode = 'add'
      }
      rig.main.tint = tint
      return rig
    })
    var rigOf = new Map()
    rigs.forEach(function (rig) { rigOf.set(rig.index, rig) })

    // stamp：每个词第一个字砸下的时刻整组震动。
    var impacts = []
    if (spec.enter === 'stamp') {
      var seen = new Set()
      rigs.forEach(function (rig) {
        var word = glyphs[rig.index].word
        if (seen.has(word)) return
        seen.add(word)
        impacts.push(rig.enterStart + enter.duration * Animations.STAMP_IMPACT)
      })
    }
    var shakeAmplitude = placement.fontPx * 0.05 * motion

    // type 的光标、underline 的粗线、wipe 的遮罩。
    var cursor = spec.enter === 'type' ? new pixi.Graphics() : null
    if (cursor) {
      cursor.rect(-0.5, -0.5, 1, 1).fill({ color: 0xffffff })
      cursor.tint = palette.accent
      cursor.visible = false
      overlayLayer.addChild(cursor)
    }
    var underlines = []
    if (spec.sing === 'underline') {
      var underlineGroups = new Map()
      rigs.forEach(function (rig) {
        var glyph = glyphs[rig.index]
        var key = String(glyph.word)
        var list = underlineGroups.get(key)
        if (!list) { list = []; underlineGroups.set(key, list) }
        if (list.length === 0 || glyphs[list[0]].row === glyph.row) list.push(rig.index)
      })
      underlineGroups.forEach(function (indices) {
        var frame = Blocks.runFrame(glyphs, indices, 0, 0)
        if (!frame) return
        var members = indices.map(function (index) { return rigOf.get(index) })
        var tx = Math.cos(frame.angle)
        var ty = Math.sin(frame.angle)
        var nx = -ty
        var ny = tx
        var avgSize = members.reduce(function (sum, rig) { return sum + rig.size }, 0) / members.length
        var thick = Math.max(3, avgSize * 0.15)
        var offset = frame.thickness / 2 + thick * 0.4
        var g = new pixi.Graphics()
        g.rect(0, -0.5, 1, 1).fill({ color: 0xffffff })
        // 下划线画在词下面、色块上：按词里第一个字身后的色块取色。
        g.tint = members[0] && members[0].sungTint !== undefined ? members[0].sungTint : palette.accent
        g.visible = false
        overlayLayer.addChild(g)
        var from = Infinity
        var to = -Infinity
        members.forEach(function (rig) {
          from = Math.min(from, rig.sungAt)
          to = Math.max(to, rig.sungEnd)
        })
        underlines.push({
          g: g,
          members: members,
          x: frame.cx - tx * frame.length / 2 + nx * offset,
          y: frame.cy - ty * frame.length / 2 + ny * offset,
          angle: frame.angle,
          length: frame.length,
          thick: thick,
          from: from,
          to: to,
        })
      })
    }
    var wipeMask = spec.enter === 'wipe' ? new pixi.Graphics() : null
    if (wipeMask) glyphsInner.addChild(wipeMask)
    var firstStart = rigs.reduce(function (min, rig) { return Math.min(min, rig.enterStart) }, Number.POSITIVE_INFINITY)
    var lastLanded = rigs.reduce(function (max, rig) { return Math.max(max, rig.landed) }, Number.NEGATIVE_INFINITY)

    // ─── 求值 ───
    var scratchEnter = Animations.restPose()
    var scratchShadow = Animations.restPose()
    /** 求第 rig 个字在 time 时刻（减去 lag）的姿态，写进 out；返回是否可见。 */
    var evaluate = function (rig, time, lag, out, singOut) {
      var t = time - lag
      if (!(t >= rig.enterStart) || t >= rig.exitEnd) {
        // 不可见时也回到确定的状态（anchors 不能带着上一次求值的残留）。
        Object.assign(out, REST_POSE)
        out.alpha = 0
        if (singOut) Object.assign(singOut, REST_SING)
        return false
      }
      rig.ctx.time = t - rig.enterStart
      var a = Animations.enterPose(spec.enter, (t - rig.enterStart) / Math.max(1e-3, enter.duration), rig.ctx)
      Object.assign(scratchEnter, a)
      rig.ctx.time = t - rig.exitStart
      var span = rig.exitEnd - rig.exitStart
      var b = Animations.exitPose(spec.exit, span > 0 ? (t - rig.exitStart) / span : 0, rig.ctx)
      Animations.combinePoses(scratchEnter, b, out)
      if (singOut) {
        var sung = t >= rig.landed
          ? Animations.singPose(spec.sing, t - rig.sungAt, rig.sungEnd - rig.sungAt, rig.ctx.rand[3], motion)
          : Animations.restSing()
        Object.assign(singOut, sung)
      }
      return out.alpha > 0.002
    }

    var evaluatedAt = Number.NaN
    var shake = { x: 0, y: 0 }
    var evaluateAll = function (time) {
      if (time === evaluatedAt) return
      evaluatedAt = time
      shake = impacts.length > 0 ? Animations.stampShake(time, impacts, shakeAmplitude) : { x: 0, y: 0 }
      rigs.forEach(function (rig) { rig.visible = evaluate(rig, time, 0, rig.pose, rig.sing) })
    }

    var setTexture = function (sprite, texture) {
      if (sprite.texture !== texture) sprite.texture = texture
    }
    var place = function (sprite, x, y, rotation, sx, sy, skew, alpha) {
      sprite.visible = alpha > 0.002
      if (!sprite.visible) return
      sprite.position.set(x, y)
      sprite.rotation = rotation
      sprite.scale.set(sx, sy)
      sprite.skew.x = skew
      sprite.alpha = alpha
    }
    var setFxMode = function (rig, mode) {
      if (rig.fxMode === mode || !rig.fxA || !rig.fxB) return
      rig.fxMode = mode
      if (mode === 'split' && rig.entry.halves) {
        setTexture(rig.fxA, rig.entry.halves[0])
        setTexture(rig.fxB, rig.entry.halves[1])
        if (halvesKind === 'lr') {
          rig.fxA.anchor.set(1, 0.5)
          rig.fxB.anchor.set(0, 0.5)
        } else {
          rig.fxA.anchor.set(0.5, 1)
          rig.fxB.anchor.set(0.5, 0)
        }
        rig.fxA.blendMode = 'normal'
        rig.fxB.blendMode = 'normal'
        rig.fxA.tint = rig.tint
        rig.fxB.tint = rig.tint
        return
      }
      rig.fxA.anchor.set(0.5)
      rig.fxB.anchor.set(0.5)
      if (mode === 'rgb') {
        rig.fxA.blendMode = 'add'
        rig.fxB.blendMode = 'add'
        rig.fxA.tint = 0xff2850
        rig.fxB.tint = 0x20e8ff
      } else {
        rig.fxA.blendMode = 'normal'
        rig.fxB.blendMode = 'normal'
        rig.fxA.tint = rig.tint
        rig.fxB.tint = rig.tint
      }
    }

    var update = function (time) {
      // 没提前备好时（跳播、第一帧）在这里补画图集。
      if (atlas.paint) atlas.paint()
      evaluateAll(time)
      blocksInner.position.set(shake.x, shake.y)
      glyphsInner.position.set(shake.x, shake.y)
      blocks.update(time)

      rigs.forEach(function (rig) {
        var pose = rig.pose
        var sing = rig.sing
        if (!rig.visible) {
          rig.main.visible = false
          if (rig.shadow) rig.shadow.visible = false
          if (rig.outline) rig.outline.visible = false
          if (rig.halo) rig.halo.visible = false
          if (rig.fxA) rig.fxA.visible = false
          if (rig.fxB) rig.fxB.visible = false
          return
        }
        var size = rig.size
        var base = size / rig.entry.px
        var x = rig.x + (pose.dx + sing.dx) * size
        var y = rig.y + (pose.dy + sing.dy) * size
        var rotation = rig.rotation + pose.rotation + sing.rotation
        var sx = base * pose.scaleX * sing.scale * sing.scaleX
        var sy = base * pose.scaleY * sing.scale * sing.scaleY
        var scrambled = pose.scramble >= 0 && atlas.scramble.length > 0
          ? atlas.scramble[pose.scramble % atlas.scramble.length]
          : null
        var entry = scrambled !== null && scrambled !== undefined ? scrambled : rig.entry
        var scrambleScale = scrambled ? rig.entry.px / scrambled.px : 1
        // 字色：唱到时闪光 / 变色，翻到背面时换色。
        var tint = mixColor(rig.tint, rig.sungTint, sing.color)
        tint = mixColor(tint, rig.flashTint, sing.flash)
        if (pose.backside) tint = rig.backTint
        rig.main.tint = tint
        setTexture(rig.main, entry.fill)
        var splitting = pose.split > 0.001 && rig.fxA !== null && rig.entry.halves !== null
        place(rig.main, x, y, rotation, sx * scrambleScale, sy * scrambleScale, pose.skew, splitting ? 0 : pose.alpha)

        // 描边层与字同姿态；拼合（split）途中两半还没合上时先隐去。
        var attach = splitting ? 1 - clamp01(pose.split * 3) : 1
        if (rig.outline) {
          setTexture(rig.outline, entry.fat !== null && entry.fat !== undefined ? entry.fat : entry.fill)
          place(rig.outline, x, y, rotation, sx * scrambleScale, sy * scrambleScale, pose.skew, pose.alpha * attach)
        }
        if (rig.shadow) {
          // 硬阴影：晚一点跟上（运动时拖出错位），位置固定朝右下。
          var lagged = evaluate(rig, time, SHADOW_LAG, scratchShadow, null) ? scratchShadow : pose
          var lx = rig.x + (lagged.dx + sing.dx) * size + SHADOW_OFFSET_X * size
          var ly = rig.y + (lagged.dy + sing.dy) * size + SHADOW_OFFSET_Y * size
          setTexture(rig.shadow, entry.fat !== null && entry.fat !== undefined ? entry.fat : entry.fill)
          place(
            rig.shadow, lx, ly, rig.rotation + lagged.rotation + sing.rotation,
            base * lagged.scaleX * sing.scale * sing.scaleX * scrambleScale,
            base * lagged.scaleY * sing.scale * sing.scaleY * scrambleScale,
            lagged.skew, Math.min(pose.alpha, lagged.alpha) * attach,
          )
        }
        if (rig.halo) {
          var k = 1 + 0.14 * sing.glow
          place(rig.halo, x, y, rotation, sx * k, sy * k, 0, pose.alpha * sing.glow * 0.95)
        }
        if (rig.fxA && rig.fxB) {
          if (splitting) {
            setFxMode(rig, 'split')
            var sep = pose.split
            var c = Math.cos(rotation)
            var s = Math.sin(rotation)
            var ax = halvesKind === 'lr' ? -1.3 * sep : -0.45 * sep
            var ay = halvesKind === 'lr' ? -0.45 * sep : -1.3 * sep
            place(rig.fxA, x + (ax * c - ay * s) * size, y + (ax * s + ay * c) * size, rotation, sx, sy, pose.skew, pose.alpha)
            place(rig.fxB, x - (ax * c - ay * s) * size, y - (ax * s + ay * c) * size, rotation, sx, sy, pose.skew, pose.alpha)
          } else if (pose.rgbSplit > 0.001) {
            setFxMode(rig, 'rgb')
            setTexture(rig.fxA, entry.fill)
            setTexture(rig.fxB, entry.fill)
            var d = pose.rgbSplit * size
            place(rig.fxA, x - d, y, rotation, sx * scrambleScale, sy * scrambleScale, pose.skew, pose.alpha * 0.9)
            place(rig.fxB, x + d, y + d * 0.2, rotation, sx * scrambleScale, sy * scrambleScale, pose.skew, pose.alpha * 0.9)
          } else if (pose.blur > 0.01) {
            // 模糊近似：两层放大的半透明重影。
            setFxMode(rig, 'ghost')
            setTexture(rig.fxA, entry.fill)
            setTexture(rig.fxB, entry.fill)
            rig.fxA.tint = tint
            rig.fxB.tint = tint
            var k1 = 1 + 0.16 * pose.blur
            var k2 = 1 + 0.38 * pose.blur
            place(rig.fxA, x, y, rotation, sx * k1, sy * k1, pose.skew, pose.alpha * 0.4 * pose.blur)
            place(rig.fxB, x, y, rotation, sx * k2, sy * k2, pose.skew, pose.alpha * 0.22 * pose.blur)
          } else {
            rig.fxA.visible = false
            rig.fxB.visible = false
          }
        }
      })

      // wipe：入场期间把字层遮在逐字擦出的矩形里。
      if (wipeMask) {
        var active = time >= firstStart && time < lastLanded
        if (active) {
          wipeMask.clear()
          rigs.forEach(function (rig) {
            if (!rig.visible) return
            var pose = rig.pose
            var size = rig.size
            var glyph = glyphs[rig.index]
            var tx = Math.cos(rig.angle)
            var ty = Math.sin(rig.angle)
            var nx = -ty
            var ny = tx
            var margin = size * 0.2
            var alongW = glyph.advance + margin * 2
            var t0 = -alongW / 2
            var t1 = t0 + alongW * pose.reveal
            if (t1 <= t0) return
            var n0 = -size * 0.85
            var n1 = size * 0.85
            var cx = rig.x + pose.dx * size
            var cy = rig.y + pose.dy * size
            wipeMask.poly([
              cx + tx * t0 + nx * n0, cy + ty * t0 + ny * n0,
              cx + tx * t1 + nx * n0, cy + ty * t1 + ny * n0,
              cx + tx * t1 + nx * n1, cy + ty * t1 + ny * n1,
              cx + tx * t0 + nx * n1, cy + ty * t0 + ny * n1,
            ]).fill({ color: 0xffffff })
          })
          if (masked.mask !== wipeMask) masked.mask = wipeMask
          wipeMask.visible = true
        } else if (masked.mask) {
          masked.mask = null
          wipeMask.clear()
          wipeMask.visible = false
        }
      }

      // type：光标停在最后一个已出现的字后面，打字时常亮、停下后闪烁，退场时消失。
      if (cursor) {
        var current = null
        rigs.forEach(function (rig) {
          if (time >= rig.enterStart && (!current || rig.enterStart >= current.enterStart)) current = rig
        })
        var first = rigs[0]
        var typing = time < lastLanded
        var visibleFrom = options.enterAt - 0.25
        var exitFrom = rigs.reduce(function (min, rig) { return Math.min(min, rig.exitStart) }, Number.POSITIVE_INFINITY)
        var hideAt = Math.min(lastLanded + 1.2, exitFrom)
        var blinkOn = typing || Math.floor((time - lastLanded) / 0.28) % 2 === 0
        var target = current !== null ? current : (first !== undefined ? first : null)
        if (!target || time < visibleFrom || time >= hideAt || !blinkOn) {
          cursor.visible = false
        } else {
          var glyphT = glyphs[target.index]
          var txT = Math.cos(target.angle)
          var tyT = Math.sin(target.angle)
          var side = current ? 1 : -1
          var offset = (glyphT.advance / 2 + target.size * 0.1) * side
          cursor.visible = true
          cursor.position.set(target.x + txT * offset, target.y + tyT * offset)
          cursor.rotation = target.angle
          cursor.scale.set(Math.max(2, target.size * 0.09), target.size * 0.95)
          cursor.alpha = 1
        }
      }

      // underline：被唱的词下面一条粗线随唱的进度伸长，唱完从词首收起。
      underlines.forEach(function (underline) {
        var landed = underline.members.every(function (rig) { return time >= rig.landed })
        var grow = clamp01((time - underline.from) / Math.max(0.12, underline.to - underline.from))
        var retract = clamp01((time - underline.to - 0.12) / 0.28)
        var head = 1 - Math.pow(1 - grow, 3)
        var tail = Math.pow(retract, 3)
        var alpha = underline.members.reduce(function (min, rig) { return Math.min(min, rig.visible ? rig.pose.alpha : 0) }, 1)
        if (!landed || time < underline.from || head <= tail || alpha <= 0.002) {
          underline.g.visible = false
          return
        }
        var tx = Math.cos(underline.angle)
        var ty = Math.sin(underline.angle)
        underline.g.visible = true
        underline.g.position.set(underline.x + tx * underline.length * tail, underline.y + ty * underline.length * tail)
        underline.g.rotation = underline.angle
        underline.g.scale.set(underline.length * (head - tail), underline.thick * (1 + 0.5 * (1 - clamp01((time - underline.from) / 0.12))))
        underline.g.alpha = alpha
      })
    }

    var anchorsAt = Number.NaN
    var anchorsCache = []
    var anchors = function (time) {
      if (time === anchorsAt) return anchorsCache
      evaluateAll(time)
      anchorsAt = time
      anchorsCache = glyphs.map(function (glyph, index) {
        var rig = rigOf.get(index)
        var timing = timeline[index]
        if (!rig) {
          var landed = enter.landed[index]
          return {
            char: glyph.char, x: glyph.x + shake.x, y: glyph.y + shake.y, size: glyph.size,
            sungAt: timing.startTime, sungEnd: timing.endTime,
            landedAt: Number.isFinite(landed) ? landed : options.enterAt,
            alpha: 0, blank: true,
          }
        }
        var pose = rig.pose
        var sing = rig.sing
        var scale = ((Math.abs(pose.scaleX * sing.scaleX) + Math.abs(pose.scaleY * sing.scaleY)) / 2) * sing.scale
        return {
          char: glyph.char,
          x: rig.x + (pose.dx + sing.dx) * rig.size + shake.x,
          y: rig.y + (pose.dy + sing.dy) * rig.size + shake.y,
          size: rig.size * scale,
          sungAt: rig.sungAt,
          sungEnd: rig.sungEnd,
          landedAt: rig.landed,
          alpha: rig.visible ? clamp01(pose.alpha) : 0,
          blank: false,
        }
      })
      return anchorsCache
    }

    var destroyed = false
    return {
      view: view,
      // 分层导出：色块算图形还是文字由引擎决定，这里给出只含色块的子容器。
      blocks: blocksRoot,
      glyphs: glyphsRoot,
      update: update,
      prepare: function () { return atlas.paint ? atlas.paint() : false },
      anchors: anchors,
      bounds: { x: placement.bounds.x, y: placement.bounds.y, width: placement.bounds.width, height: placement.bounds.height },
      destroy: function () {
        if (destroyed) return
        destroyed = true
        if (masked.mask) masked.mask = null
        blocks.destroy()
        // 场景可能把两个子容器挪去了别的层：各自销毁（Pixi v8 纪律：逐节点无参 destroy）。
        destroyTree(blocksRoot)
        destroyTree(glyphsRoot)
        view.destroy()
        atlas.destroy()
      },
    }
  }

  function createHanabiText(options) {
    return buildHanabiText(options)
  }

  window.FoliaHanabiText = {
    lineWords: lineWords,
    buildHanabiText: buildHanabiText,
    createHanabiText: createHanabiText
  }
})()
