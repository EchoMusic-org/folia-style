// 花火（hanabi）PV 拼贴编排：移植自 folia-major src/components/visualizer/hanabi/collage/collagePlan.ts
// PV 拼贴的编排（纯数据，不碰 Pixi）：每个镜头按族、情绪与种子挑一种「拼贴配方」，算出每个拼贴件的位置、颜色与出入场时刻。
// 日系动漫 PV 的手帐感：斜跨画面的装饰带（电影胶片、剪刀剪出的剪切线、蕾丝花边，都不带字）、重复的空心字、带白边的贴纸、
// 胶带、格子纸片、小窗口、编号标签，加上烟花开花时蹦出来的主题图标贴纸（主题图标，插件无 lucide，统一走内置线稿兜底 Flower）
// 与升空时跟着尾迹的小图标。间奏镜头放一条胶片与一路往上飘的贴纸气球。
// 坐标都在镜头容器里（与文字视图的本地坐标一致）；件都摆在字组包围盒外面或字的后面，不挡字。
//
// CollageRecipe（配方）：'scrapbook' 手帐贴纸 | 'strips' 装饰带 | 'echo' 重复空心字 | 'window' 小窗口 |
//   'stickerbomb' 满屏贴纸 | 'quiet' 安静 | 'bridge' 间奏 | 'opening' 开场标题卡。
// StickerShape 贴纸形状：'heart' | 'star' | 'sparkle' | 'flower' | 'cloud' | 'ribbon' | 'cat' | 'bubble'。
// TapePattern：'stripe' | 'dot' | 'check'；PatchPattern 纸片花纹：'grid' | 'dots' | 'gingham' | 'plain'。
// StripStyle 装饰带：'film' 电影胶片（齿孔 + 一格格粉彩画面）| 'cut' 剪切线（剪刀剪过去留下虚线）| 'lace' 蕾丝花边（波浪边 + 孔眼）。
// CollageItem = StripItem | EchoItem | StickerItem | TapeItem | PatchItem | WindowItem | LabelItem | HeadlineItem |
//   PopItem（开花一瞬蹦出、停一会儿、往上飘着淡出的图标贴纸）| WhooshItem（跟着尾迹升空的小图标）| FloaterItem（间奏的贴纸气球）。
//   各件的公共字段 Timed = { at 出场（弹出 / 擦出）开始的时刻, exitAt 退场开始的时刻, exitDuration }。
(function () {
  'use strict'

  var Core = window.FoliaHanabiCore
  var GraphemeTiming = window.FoliaGraphemeTiming
  var WordSegmentation = window.FoliaWordSegmentation
  var MathLib = window.FoliaHanabiOrnaments.Math

  /** 每个族偏好的配方（前面的权重大）。 */
  var FAMILY_RECIPES = {
    uchiage: ['strips', 'scrapbook', 'stickerbomb'],
    kiku: ['echo', 'strips', 'window'],
    botan: ['stickerbomb', 'scrapbook', 'window'],
    yanagi: ['quiet', 'echo'],
    senrin: ['stickerbomb', 'strips', 'scrapbook'],
    hoshikuzu: ['window', 'quiet', 'stickerbomb'],
    obi: ['strips', 'scrapbook', 'echo'],
    senko: ['window', 'echo', 'strips'],
    senkohanabi: ['quiet', 'scrapbook'],
    shakudama: ['echo', 'strips', 'stickerbomb']
  }

  /** 日系可爱 PV 的糖果色：贴纸、胶带、色带都从这里和镜头调色板的粉彩版里取。 */
  var CANDY = [0xffb3d1, 0xb8f2e6, 0xfff1a8, 0xd7c4ff, 0xffc9a8, 0xa8dcff]
  /** 标签上的深色字、胶片片基与深色卡片。 */
  var CANDY_INK = 0x2b1f3d
  var DEEP_CARD = 0x1d1838

  /** 没有主题图标时用的图标（上游是 lucide 的导出名；插件无 lucide，走 hanabi-collage-painters.js 的内置线稿兜底）。 */
  var HANABI_FALLBACK_ICON = 'Flower'
  /** 图标贴纸的描边色：比糖果色深一档，白边上看得清。 */
  var ICON_INKS = [0xff5fa2, 0x3fb2ff, 0xffa31a, 0x9b6bff, 0x2ec9a0]
  var BUBBLE_LABELS = ['♡', '!!', '♪', 'LOVE', 'yay!', '(≧▽≦)', '☆彡']
  var WINDOW_TITLES = ['♡ hanabi.exe', '♪ lyric.txt', '✦ night_sky.png', '☆ summer.mp3', '♡ kirakira.app']
  var SHAPES = ['heart', 'star', 'sparkle', 'flower', 'cloud', 'ribbon', 'cat']
  var STRIP_STYLES = ['film', 'cut', 'lace']
  /** 各样式带子的粗细（占画面短边）：胶片要放得下齿孔与画面格，剪切线细。 */
  var STRIP_THICKNESS = { film: 0.075, cut: 0.045, lace: 0.06 }

  var pick = function (list, random) { return list[Math.floor(random() * list.length) % list.length] }

  /** 调色板颜色的粉彩版：往白里混，保持色相。 */
  function pastel(color, amount) {
    if (amount === undefined) amount = 0.45
    return MathLib.mixColor(color, 0xffffff, amount)
  }

  var LATIN = /^[\p{Script=Latin}\p{N}'’\- ]+$/u

  /**
   * 一句里最像关键词的词（重复空心字、色带用）：很短的句子（≤ 5 个字）整句；否则取最长的词（2–10 个字），
   * 拉丁字母转大写（PV 里的英文装饰字都是大写）。没有合适的返回 null。
   */
  function pickCollageKeyword(line) {
    if (!line) return null
    var text = line.fullText.trim()
    var graphemes = GraphemeTiming.splitLyricGraphemes(text).filter(function (grapheme) { return grapheme.trim().length > 0 })
    var shout = function (word) { return LATIN.test(word) ? word.toLocaleUpperCase() : word }
    if (graphemes.length >= 2 && graphemes.length <= 5) return shout(text)
    var best = null
    var bestLength = 0
    WordSegmentation.segmentLyricWords(line).forEach(function (part) {
      var word = part.segment.trim()
      var length = GraphemeTiming.splitLyricGraphemes(word).length
      if (!part.isWordLike || length < 2 || length > 10) return
      if (length > bestLength) {
        best = word
        bestLength = length
      }
    })
    return best ? shout(best) : null
  }

  /** 挑配方：族偏好里避开上一个镜头的配方；间奏固定 bridge；数量为 0 时没有。 */
  function chooseCollageRecipe(family, isBridge, previous, random) {
    if (isBridge) return 'bridge'
    var preferred = FAMILY_RECIPES[family] || ['scrapbook', 'strips', 'stickerbomb']
    var choices = preferred.filter(function (recipe) { return recipe !== previous })
    var list = choices.length > 0 ? choices : preferred
    // 越靠前权重越大：权重 n, n-1, …, 1。
    var total = (list.length * (list.length + 1)) / 2
    var roll = random() * total
    for (var index = 0; index < list.length; index += 1) {
      roll -= list.length - index
      if (roll < 0) return list[index]
    }
    return list[0]
  }

  /** 数量倍率下的件数：0 时 0，其余至少 min。 */
  var countOf = function (base, amount, min) {
    if (min === undefined) min = 1
    return amount <= 0 ? 0 : Math.max(min, Math.round(base * amount))
  }

  /**
   * 一个镜头的拼贴。确定性：同样的输入（含 seed）永远同样的件。
   * input：CollagePlanInput { seed, family, mood, isBridge, block（BlockStyle）, shotNumber, bounds 字组静止包围盒,
   *   screen 镜头定格画面范围, screenAt?（time 时刻画面在镜头容器里的范围；不给按 screen）, unit, palette,
   *   enterAt, exitAt, exitDuration, start, end, keyword（一句里最像关键词的词，没有为 null）,
   *   motifs（整首歌的字样，没有关键词时重复字用它）, bursts（CollageBurst[]）, launches（CollageLaunch[]）,
   *   amount（tuning.collage 0..2）, icons?（开花时蹦出来的图标名；插件恒走兜底）, previous, opening?（歌曲开头的标题卡） }。
   */
  function planShotCollage(input) {
    if (input.amount <= 0) return { recipe: null, items: [] }
    var random = Core.createRng(input.seed + ':collage')
    var recipe = input.isBridge && input.opening ? 'opening' : chooseCollageRecipe(input.family, input.isBridge, input.previous, random)
    var bounds = input.bounds
    var screen = input.screen
    var unit = input.unit
    var amount = input.amount
    var items = []
    var exit = { exitAt: input.exitAt, exitDuration: input.exitDuration }
    var candy = CANDY.concat([pastel(input.palette.accent), pastel(input.palette.sparks[1] !== undefined ? input.palette.sparks[1] : input.palette.accent)])
    var candyColor = function () { return pick(candy, random) }
    /** 画面左缘留给竖排跑马灯（hanabi-collage-unit.js）与画框朱印的宽度。 */
    var railGap = unit * 0.14
    var cx = bounds.x + bounds.width / 2
    var cy = bounds.y + bounds.height / 2
    var sx = screen.x + screen.width / 2
    var clampX = function (x, pad) { return MathLib.clamp(x, screen.x + railGap * 0.5 + pad, screen.x + screen.width - pad) }
    var clampY = function (y, pad) { return MathLib.clamp(y, screen.y + pad, screen.y + screen.height - pad) }
    var signed = function () { return random() < 0.5 ? -1 : 1 }

    var motifs = input.motifs.length > 0 ? input.motifs : ['HANABI', '花火']
    var motif = function () { return pick(motifs, random) }

    var sticker = function (shape, x, y, size, delay, layer, label) {
      if (layer === undefined) layer = 'front'
      if (label === undefined) label = null
      return Object.assign({
        kind: 'sticker',
        shape: shape,
        x: clampX(x, size * 0.6),
        y: clampY(y, size * 0.6),
        size: size,
        rotation: (random() - 0.5) * 0.7,
        color: candyColor(),
        label: label,
        layer: layer,
        at: input.enterAt + delay
      }, exit)
    }

    /** 包围盒四角往外的落点（corner 0..3 = 左上、右上、右下、左下）。 */
    var corner = function (index, out) {
      var dx = index === 0 || index === 3 ? -1 : 1
      var dy = index < 2 ? -1 : 1
      return {
        x: (dx < 0 ? bounds.x : bounds.x + bounds.width) + dx * out,
        y: (dy < 0 ? bounds.y : bounds.y + bounds.height) + dy * out * 0.6
      }
    }

    /** 一条斜跨画面的装饰带，摆在字组上方或下方（在字后面）。 */
    var strip = function (style, side, delay) {
      var thickness = Math.max(style === 'cut' ? 14 : 18, unit * STRIP_THICKNESS[style])
      var gap = unit * 0.05 + thickness / 2
      var y = side < 0 ? bounds.y - gap : bounds.y + bounds.height + gap
      // 放不下就压回画面里（带子在字后面，压到字也不挡）。
      y = clampY(y, thickness)
      return Object.assign({
        kind: 'strip',
        style: style,
        x: sx,
        y: y,
        length: Math.hypot(screen.width, screen.height) * 1.25,
        thickness: thickness,
        rotation: side * (0.06 + random() * 0.1),
        color: candyColor(),
        speed: signed() * unit * (style === 'film' ? 0.12 : 0.05) * (0.8 + random() * 0.4),
        from: signed(),
        at: input.enterAt + delay
      }, exit)
    }

    var echo = function (axis, side, alpha) {
      var text = input.keyword !== null && input.keyword !== undefined ? input.keyword : motif()
      if (!text.trim()) return null
      var size = unit * (axis === 'x' ? 0.13 : 0.11)
      if (axis === 'x') {
        var y = side < 0 ? bounds.y - size * 0.75 : bounds.y + bounds.height + size * 0.75
        return Object.assign({
          kind: 'echo', axis: axis, text: text, size: size, alpha: alpha,
          x: sx, y: clampY(y, size * 0.5), width: screen.width * 1.3, height: size * 1.25,
          rotation: (random() - 0.5) * 0.08,
          color: random() < 0.5 ? input.palette.paper : candyColor(),
          speed: side * unit * 0.07,
          at: input.enterAt - 0.15
        }, exit)
      }
      var width = size * Math.max(1, Array.from(text).length) * 0.9 + size * 0.4
      var free = (screen.width - bounds.width) / 2
      var x = side < 0 ? bounds.x - width * 0.55 : bounds.x + bounds.width + width * 0.55
      return Object.assign({
        kind: 'echo', axis: axis, text: text, size: size, alpha: alpha,
        // 两侧放不下就贴在画面边上（在字后面，淡）；左边让开竖排跑马灯与画框的朱印。
        x: MathLib.clamp(free > width * 0.6 ? x : (side < 0 ? -Infinity : Infinity), screen.x + railGap + width * 0.5, screen.x + screen.width - unit * 0.06 - width * 0.5),
        y: cy,
        width: width,
        height: screen.height * 1.3,
        rotation: 0,
        color: random() < 0.5 ? input.palette.paper : candyColor(),
        speed: side * unit * 0.06,
        at: input.enterAt - 0.15
      }, exit)
    }

    var patch = function (pad, offset, pattern, delay) {
      var dark = input.block === 'none' || input.block === 'outline' || input.block === 'marker'
      return Object.assign({
        kind: 'patch',
        x: cx + offset * signed(),
        y: cy + offset * signed() * 0.6,
        width: bounds.width + pad * 2,
        height: bounds.height + pad * 2,
        rotation: (random() - 0.5) * 0.09,
        color: dark ? DEEP_CARD : candyColor(),
        pattern: pattern,
        dark: dark,
        at: input.enterAt + delay
      }, exit)
    }

    var tape = function (index, delay, around) {
      var length = unit * (0.12 + random() * 0.04)
      var x = index === 0 || index === 3 ? around.x : around.x + around.width
      var y = index < 2 ? around.y : around.y + around.height
      var diagonal = index === 0 || index === 2 ? -1 : 1
      return Object.assign({
        kind: 'tape',
        x: x,
        y: y,
        length: length,
        width: length * 0.3,
        rotation: diagonal * (0.62 + random() * 0.2),
        color: candyColor(),
        pattern: pick(['stripe', 'dot', 'check'], random),
        at: input.enterAt + delay
      }, exit)
    }

    var label = function (delay) {
      var size = Math.max(12, unit * 0.026)
      var text = random() < 0.5
        ? 'No.' + String(input.shotNumber + 1).padStart(2, '0')
        : '#' + String(input.shotNumber + 1).padStart(2, '0') + ' ' + pick(['♪', '♡', '✦'], random)
      var at = corner(3, size * 0.4)
      return Object.assign({
        kind: 'label',
        x: clampX(at.x + size * 2.2, size * 3),
        y: clampY(at.y + size * 0.9, size),
        text: text,
        color: candyColor(),
        size: size,
        rotation: (random() - 0.5) * 0.2,
        at: input.enterAt + delay
      }, exit)
    }

    var stickerSize = function () { return unit * (0.065 + random() * 0.04) }

    switch (recipe) {
      case 'scrapbook': {
        var pad = unit * 0.045
        var card = patch(pad, unit * 0.012, pick(['grid', 'dots', 'gingham'], random), -0.12)
        items.push(patch(pad * 0.6, unit * 0.04, 'plain', -0.2), card)
        var around = { x: card.x - card.width / 2, y: card.y - card.height / 2, width: card.width, height: card.height }
        var first = Math.floor(random() * 2)
        items.push(tape(first, 0.05, around), tape(first + 2, 0.12, around))
        for (var k = 0; k < countOf(1.5, amount); k += 1) {
          var at = corner((first + 1 + k * 2) % 4, unit * 0.03)
          items.push(sticker(pick(SHAPES, random), at.x, at.y, stickerSize(), 0.25 + k * 0.1))
        }
        items.push(label(0.3))
        break
      }
      case 'strips': {
        var sideS = random() < 0.5 ? -1 : 1
        // 两条不同样式的带子：一条在字上方、一条在字下方。
        var firstS = pick(STRIP_STYLES, random)
        items.push(strip(firstS, sideS, -0.1))
        if (amount >= 0.75) items.push(strip(pick(STRIP_STYLES.filter(function (style) { return style !== firstS }), random), sideS === -1 ? 1 : -1, 0.05))
        for (var k2 = 0; k2 < countOf(2, amount); k2 += 1) {
          var atS = corner((k2 * 2 + (sideS < 0 ? 1 : 0)) % 4, unit * 0.04)
          items.push(sticker(k2 % 2 === 0 ? 'sparkle' : 'star', atS.x, atS.y, stickerSize() * 0.85, 0.2 + k2 * 0.12))
        }
        break
      }
      case 'echo': {
        var vertical = screen.width - bounds.width > unit * 0.5
        var firstE = echo(vertical ? 'y' : 'x', -1, 0.3)
        var secondE = echo(vertical ? 'y' : 'x', 1, 0.3)
        if (firstE) items.push(firstE)
        if (secondE && amount >= 0.75) items.push(secondE)
        var atE = corner(1, unit * 0.04)
        items.push(sticker('bubble', atE.x, atE.y, stickerSize() * 1.6, 0.3, 'front', pick(BUBBLE_LABELS, random)))
        break
      }
      case 'window': {
        var padW = unit * 0.05
        var bar = Math.max(16, unit * 0.04)
        var width = bounds.width + padW * 2
        var height = bounds.height + padW * 2 + bar
        items.push(Object.assign({
          kind: 'window',
          x: cx,
          y: cy - bar / 2,
          width: width,
          height: height,
          rotation: (random() - 0.5) * 0.05,
          bar: bar,
          title: pick(WINDOW_TITLES, random),
          at: input.enterAt - 0.18
        }, exit))
        for (var k3 = 0; k3 < countOf(2, amount); k3 += 1) {
          var atW = corner(k3 === 0 ? 0 : 2, unit * 0.035)
          items.push(sticker(pick(SHAPES, random), atW.x, atW.y, stickerSize(), 0.25 + k3 * 0.12))
        }
        break
      }
      case 'stickerbomb': {
        var count = countOf(4, amount, 2)
        for (var k4 = 0; k4 < count; k4 += 1) {
          var atB = corner(k4 % 4, unit * (0.03 + 0.03 * Math.floor(k4 / 4)))
          var jitter = unit * 0.03
          items.push(sticker(pick(SHAPES, random), atB.x + (random() - 0.5) * jitter, atB.y + (random() - 0.5) * jitter, stickerSize(), 0.15 + k4 * 0.08))
        }
        var atB2 = corner(Math.floor(random() * 4), unit * 0.09)
        items.push(sticker('bubble', atB2.x, atB2.y, stickerSize() * 1.5, 0.4, 'front', pick(BUBBLE_LABELS, random)))
        break
      }
      case 'quiet': {
        var row = echo('x', random() < 0.5 ? -1 : 1, 0.16)
        if (row) items.push(row)
        var atQ = corner(Math.floor(random() * 4), unit * 0.03)
        items.push(sticker('sparkle', atQ.x, atQ.y, stickerSize() * 0.7, 0.35))
        break
      }
      case 'opening': {
        // 歌曲开头的标题卡：一个糖果色小窗口，里面是曲名大字，下面挂艺人标签，四周贴纸；镜头结束前收起。
        var opening = input.opening
        var leave = { exitAt: Math.max(input.start + 1.2, input.end - 0.7), exitDuration: 0.5 }
        var titleSize = Math.min(unit * 0.11, (screen.width * 0.5) / Math.max(4, Array.from(opening.title).length * 0.62))
        var widthO = Math.min(screen.width * 0.72, Math.max(unit * 0.6, titleSize * Array.from(opening.title).length * 0.7 + unit * 0.2))
        var barO = Math.max(16, unit * 0.045)
        var heightO = titleSize * 1.9 + barO + (opening.artist ? unit * 0.06 : 0)
        var yO = screen.y + screen.height * 0.42
        var atO = input.start + 0.25
        items.push(Object.assign({
          kind: 'window', x: sx, y: yO, width: widthO, height: heightO, rotation: -0.02, bar: barO,
          title: '♪ now playing', at: atO
        }, leave), Object.assign({
          kind: 'headline', x: sx, y: yO + barO / 2 - (opening.artist ? unit * 0.02 : 0), text: opening.title,
          color: candyColor(), size: titleSize, rotation: -0.03, at: atO + 0.18
        }, leave))
        if (opening.artist) {
          items.push(Object.assign({
            kind: 'label', x: sx, y: yO + heightO / 2 - unit * 0.045, text: opening.artist,
            color: candyColor(), size: Math.max(12, unit * 0.028), rotation: 0.02, at: atO + 0.4
          }, leave))
        }
        var cardO = { x: sx - widthO / 2, y: yO - heightO / 2, width: widthO, height: heightO }
        ;[0, 1, 2, 3].forEach(function (kO) {
          var xO = kO === 0 || kO === 3 ? cardO.x : cardO.x + cardO.width
          var cornerY = kO < 2 ? cardO.y : cardO.y + cardO.height
          items.push(Object.assign({}, sticker(pick(['heart', 'star', 'ribbon', 'sparkle'], random), xO, cornerY, unit * 0.075, 0), { at: atO + 0.3 + kO * 0.08 }, leave))
        })
        var floaters = countOf(5, amount, 2)
        for (var kF = 0; kF < floaters; kF += 1) {
          items.push({
            kind: 'floater',
            shape: pick(['heart', 'star', 'sparkle'], random),
            x: screen.x + screen.width * (0.1 + random() * 0.8),
            y: screen.y + screen.height * 1.08,
            rise: screen.height * (1.25 + random() * 0.3),
            size: unit * (0.045 + random() * 0.04),
            color: candyColor(),
            at: input.start + 0.6 + (kF / floaters) * Math.max(0.5, input.end - input.start - 1.5),
            duration: 3.4 + random() * 1.4,
            sway: unit * (0.02 + random() * 0.03)
          })
        }
        break
      }
      case 'bridge': {
        var film = strip('film', 1, 0)
        film.y = screen.y + screen.height * (0.62 + random() * 0.12)
        film.at = input.start + 0.1
        items.push(film)
        var floatersB = countOf(7, amount, 3)
        var span = Math.max(0.5, input.end - input.start)
        for (var kB = 0; kB < floatersB; kB += 1) {
          var atB = input.start + (kB / floatersB) * span * 0.8 + random() * 0.3
          items.push({
            kind: 'floater',
            shape: pick(['heart', 'star', 'sparkle', 'flower'], random),
            x: screen.x + screen.width * (0.08 + random() * 0.84),
            y: screen.y + screen.height * 1.08,
            rise: screen.height * (1.25 + random() * 0.3),
            size: unit * (0.05 + random() * 0.05),
            color: candyColor(),
            at: atB,
            duration: 3.2 + random() * 1.6,
            sway: unit * (0.02 + random() * 0.03)
          })
        }
        break
      }
    }

    // 图标贴纸：主烟花开花的一瞬（间奏的连发隔一发一个，最多 5 个）。几个主题图标按镜头轮着用。
    var icons = input.icons && input.icons.length > 0 ? input.icons : [HANABI_FALLBACK_ICON]
    var iconTurn = Math.floor(random() * icons.length)
    var nextIcon = function () { var icon = icons[iconTurn % icons.length]; iconTurn += 1; return icon }
    var mains = input.bursts.filter(function (burst) { return burst.main })
    // 开场标题卡占着画面中间，那个镜头不放。
    var popped = recipe === 'opening'
      ? []
      : input.isBridge ? mains.filter(function (burst, index) { return index % 2 === 0 }).slice(0, 5) : mains.slice(0, 1)
    popped.forEach(function (burst) {
      if (random() > Math.min(1, 0.55 + 0.35 * amount)) return
      var size = unit * (input.isBridge ? 0.1 : 0.115) * (0.9 + random() * 0.25)
      // 按图标弹出之后那一刻的画面算：镜头还在落下时，按定格画面算的位置可能还在画面上方。
      var view = input.screenAt ? input.screenAt(burst.at + 0.35) : screen
      var halfWidth = size * 0.6
      var left = view.x + railGap * 0.5 + halfWidth
      var right = view.x + view.width - halfWidth - size * 0.3
      var top = view.y + size * 0.8
      var bottom = view.y + view.height * 0.8
      // 不压字：先试字组左右两侧（靠烟花那一边优先）、齐字组上缘，再试字组正上方；都放不下才夹回画面里。
      var preferRight = input.isBridge ? burst.x > sx : burst.x >= cx
      var beside = function (dir) {
        return { x: dir > 0 ? bounds.x + bounds.width + halfWidth + size * 0.3 : bounds.x - halfWidth - size * 0.3, y: bounds.y + size * 0.2 }
      }
      var candidates = input.isBridge
        ? [{ x: burst.x + (preferRight ? 1 : -1) * burst.radius * 0.45, y: burst.y - burst.radius * 0.35 }]
        : [beside(preferRight ? 1 : -1), beside(preferRight ? -1 : 1), { x: cx + (random() - 0.5) * bounds.width * 0.3, y: bounds.y - size * 0.75 }]
      var fits = function (point) { return point.x >= left && point.x <= right && point.y >= top && point.y <= bottom }
      var spot = null
      for (var ci = 0; ci < candidates.length; ci += 1) {
        if (fits(candidates[ci])) { spot = candidates[ci]; break }
      }
      if (!spot) spot = candidates[0]
      items.push({
        kind: 'pop',
        icon: nextIcon(),
        x: MathLib.clamp(spot.x, left, Math.max(left, right)),
        y: MathLib.clamp(spot.y, top, Math.max(top, bottom)),
        color: pick(ICON_INKS, random),
        size: size,
        rotation: (preferRight ? 1 : -1) * (0.08 + random() * 0.18),
        at: burst.at + 0.04,
        duration: 1.3
      })
    })

    // 升空的小图标：只跟主烟花的尾迹，最多两条。
    input.launches.slice(0, 2).forEach(function (launch) {
      if (random() > 0.45 + 0.25 * amount) return
      items.push({
        kind: 'whoosh',
        icon: nextIcon(),
        fromX: launch.fromX,
        fromY: launch.fromY,
        toX: launch.toX,
        toY: launch.toY,
        at: launch.at,
        duration: launch.duration,
        color: pick(ICON_INKS, random),
        size: Math.max(18, unit * 0.055)
      })
    })

    return { recipe: recipe, items: items }
  }

  window.FoliaHanabiCollagePlan = {
    CANDY: CANDY,
    CANDY_INK: CANDY_INK,
    DEEP_CARD: DEEP_CARD,
    HANABI_FALLBACK_ICON: HANABI_FALLBACK_ICON,
    ICON_INKS: ICON_INKS,
    STRIP_STYLES: STRIP_STYLES,
    pastel: pastel,
    pickCollageKeyword: pickCollageKeyword,
    chooseCollageRecipe: chooseCollageRecipe,
    planShotCollage: planShotCollage
  }
})()
