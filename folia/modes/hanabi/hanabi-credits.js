// 花火的片尾卡（移植自 folia-major hanabi/credits.ts，createHanabiCredits）：
// 最后一句唱完，一发升空尾迹从底边升起，在曲名上方开一朵大金冠，两侧跟着千輪；
// 曲名作为一行「歌词」逐字弹出、带色带（与歌词同一个文字引擎），艺人在下、专辑在上慢慢显出。
// PV 拼贴（tuning.collage > 0）：上方一条蕾丝花边、下方一条电影胶片、曲名四角的贴纸、金冠开花时蹦出的主题图标、往上飘的贴纸气球。
// 全部只由片尾开始后的时间决定。
(function () {
  'use strict'
  var PIXI = window.PIXI

  var Core = window.FoliaHanabiCore
  var Catalog = window.FoliaHanabiCatalog
  var Color = window.FoliaHanabiColor
  var Fireworks = window.FoliaHanabiFireworks
  var Glow = window.FoliaHanabiMGGlow
  var Text = window.FoliaHanabiText
  var CollagePlan = window.FoliaHanabiCollagePlan
  var CollagePainters = window.FoliaHanabiCollagePainters
  var CollageViews = window.FoliaHanabiCollageViews

  // ─── 常量（数值与上游一致） ───────────────────────────────────────────

  /** 大烟花开花 / 曲名第一个字被唱到的时刻（片尾卡内的时间）。 */
  var BLOOM_AT = 1.1
  var TITLE_START = 1.45
  var TITLE_STEP = 0.12
  var TITLE_SPAN = 2

  function smooth(value) {
    var t = Math.min(1, Math.max(0, value))
    return t * t * (3 - 2 * t)
  }

  function clean(value) {
    return typeof value === 'string' ? value.trim() : ''
  }

  // ─── 片尾卡时间线（纯函数，运行时的片尾卡层用） ───────────────────────

  /** 有没有歌曲信息可画：曲名 / 艺人 / 专辑任一非空。metadata：{ title, artist, album }。 */
  function hasHanabiCredits(metadata) {
    return Boolean(clean(metadata.title) || clean(metadata.artist) || clean(metadata.album))
  }

  /** 歌词 1.2 秒内淡出；片尾卡 0.3 秒起 0.8 秒淡入。 */
  function resolveHanabiCreditsFrame(time, finalEndTime) {
    var elapsed = time - finalEndTime
    if (elapsed <= 0) return { active: false, lyricAlpha: 1, lyricBlur: 0, posterAlpha: 0, posterOffsetY: 0, posterScale: 1 }
    var exit = smooth(elapsed / 1.2)
    return {
      active: true,
      lyricAlpha: 1 - exit,
      lyricBlur: exit * 6,
      posterAlpha: smooth((elapsed - 0.3) / 0.8),
      posterOffsetY: 0,
      posterScale: 1
    }
  }

  /** 曲名做成一行「歌词」：每个字依次被唱到。 */
  function titleLine(title) {
    var chars = Array.from(title)
    var step = Math.min(TITLE_STEP, TITLE_SPAN / Math.max(chars.length, 1))
    return {
      fullText: title,
      startTime: TITLE_START,
      endTime: TITLE_START + step * chars.length + 0.4,
      words: chars.map(function (text, i) {
        return { text: text, startTime: TITLE_START + i * step, endTime: TITLE_START + (i + 1) * step }
      })
    }
  }

  var TITLE_SPEC = {
    layout: 'center',
    heroSize: 0.11,
    emphasis: 0.2,
    tilt: 0,
    block: 'band',
    enter: 'pop',
    sing: 'color',
    exit: 'ascend',
    stagger: 0.05,
    outline: false,
    hardShadow: true
  }

  // ─── 片尾卡本体 ───────────────────────────────────────────────────────

  /** 字体栈与字重：与上游 resolveThemeFontStack / resolveThemeFontWeight 同语义（与 hanabi-overlay 的辅助同款）。 */
  function themeFontStack(theme) {
    if (typeof window.foliaBridgeFontStack === 'function') {
      var host = window.foliaBridgeFontStack(theme)
      if (host) return host
    }
    var stack = []
    if (theme.fontFamilyStack && theme.fontFamilyStack.length) stack = stack.concat(theme.fontFamilyStack)
    if (theme.fontFamily) stack.push(theme.fontFamily)
    if (theme.fontStyle === 'serif') stack.push('serif')
    else if (theme.fontStyle === 'mono') stack.push('monospace')
    else stack.push('sans-serif')
    return stack.join(', ')
  }

  function themeFontWeight(theme, fallback) {
    if (typeof window.foliaGetLyricFontWeight === 'function') return window.foliaGetLyricFontWeight(fallback || 700)
    return theme.fontWeight || fallback || 700
  }

  /**
   * 建片尾卡。options：{ width, height, resolution, theme, metadata, tuning, textures, fontScale?, icons? }。
   * 返回 { view, update(elapsed), destroy }。
   */
  function createHanabiCredits(pixi, options) {
    var width = options.width
    var height = options.height
    var theme = options.theme
    var tuning = options.tuning
    var palette = Color.resolveHanabiPalette('kawaii', theme, tuning.colorMode)
    var title = clean(options.metadata.title)
    var artist = clean(options.metadata.artist)
    var album = clean(options.metadata.album)

    var view = new pixi.Container()
    var sky = new pixi.Container()
    view.addChild(sky)

    // 烟花：尾迹 0.65 秒从底边升起，1.1 秒在曲名上方开金冠，随后两侧千輪、最后一朵双层。
    var fireworks = Fireworks.createFireworks(pixi, options.textures, {
      width: width,
      height: height,
      palette: palette,
      amount: Math.max(0, tuning.sparkAmount),
      maxParticles: 1400
    })
    sky.addChild(fireworks.view)
    var glow = tuning.glow > 0
      ? Glow.createHanabiGlow(pixi, Math.min(2, tuning.glow), Core.resolveHanabiGlowQuality(width, height, options.resolution, tuning.renderQuality))
      : null
    if (glow) sky.filters = [glow]
    var bursts = [
      {
        x: width * 0.5, y: height * 0.34, at: BLOOM_AT,
        spec: Object.assign({}, Catalog.burstPreset('kamuro', [0, 1, 3]), { count: 150, radius: 0.46, duration: 4.2 }),
        seed: 'hanabi:credits:crown', scale: 1
      },
      { x: width * 0.2, y: height * 0.3, at: BLOOM_AT + 0.55, spec: Catalog.burstPreset('senrin', [1, 2, 3]), seed: 'hanabi:credits:left', scale: 0.8 },
      { x: width * 0.8, y: height * 0.27, at: BLOOM_AT + 0.8, spec: Catalog.burstPreset('senrin', [2, 3, 0]), seed: 'hanabi:credits:right', scale: 0.8 },
      { x: width * 0.5, y: height * 0.22, at: BLOOM_AT + 2.2, spec: Catalog.burstPreset('willow-ring', [3, 0, 1]), seed: 'hanabi:credits:finale', scale: 0.9 }
    ]
    var launches = bursts.map(function (burst, k) {
      return {
        fromX: burst.x + (k % 2 === 0 ? -1 : 1) * width * 0.02,
        fromY: height * 1.03,
        toX: burst.x,
        toY: burst.y,
        at: burst.at - 0.45,
        duration: 0.45,
        color: palette.glow,
        seed: 'hanabi:credits:launch' + k
      }
    })

    var text = title
      ? Text.createHanabiText({
        pixi: pixi,
        width: width,
        height: height,
        resolution: options.resolution,
        theme: theme,
        line: titleLine(title),
        regionWidth: width * 0.72,
        regionHeight: height * 0.26,
        spec: Object.assign({}, TITLE_SPEC, { heroSize: TITLE_SPEC.heroSize * (options.fontScale !== undefined && options.fontScale !== null ? options.fontScale : 1) }),
        palette: palette,
        seed: 'hanabi:credits:title',
        enterAt: BLOOM_AT - 0.1,
        // 片尾卡一直停在最后一帧，字不退场。
        exitAt: 1e6,
        exitDuration: 1,
        motion: Math.max(0, tuning.textMotion),
        blockOpacity: Math.min(1, Math.max(0, tuning.blockOpacity))
      })
      : null
    if (text) {
      text.view.position.set(width / 2, height * 0.5)
      view.addChild(text.view)
    }

    var font = themeFontStack(theme)
    var detailSize = Math.max(13, height * 0.03)
    var detailStyle = function (size, spacing) {
      return new pixi.TextStyle({
        fontFamily: font,
        fontWeight: String(themeFontWeight(theme, 600)),
        fontSize: size,
        fill: palette.paper,
        letterSpacing: size * spacing,
        align: 'center',
        wordWrap: true,
        wordWrapWidth: width * 0.7
      })
    }
    var titleDone = TITLE_START + Math.min(TITLE_SPAN, TITLE_STEP * Array.from(title).length)
    var detailInputs = []
    if (artist) {
      detailInputs.push({ text: artist.toLocaleUpperCase(), y: 0.66, size: detailSize, spacing: 0.3, delay: title ? titleDone : 1.2 })
    }
    if (album) {
      detailInputs.push({ text: album, y: 0.35, size: detailSize * 0.8, spacing: 0.16, delay: (title ? titleDone : 1.2) + 0.3 })
    }
    var details = detailInputs.map(function (item) {
      var label = new pixi.Text({ text: item.text, style: detailStyle(item.size, item.spacing), resolution: options.resolution })
      label.anchor.set(0.5)
      label.position.set(width / 2, item.y * height)
      label.alpha = 0
      view.addChild(label)
      return { label: label, delay: item.delay, y: item.y * height }
    })

    // 片尾卡的拼贴：坐标就是画面坐标，一直停在最后一帧（不退场）。
    var collageCache = tuning.collage > 0 && !tuning.textOnly
      ? CollagePainters.createCollageTextureCache(pixi, options.resolution, font)
      : null
    var collage = null
    if (collageCache) {
      var unit = Math.min(width, height)
      var stay = { exitAt: 1e6, exitDuration: 1 }
      var band = function (style, y, rotation, color, at, from) {
        return Object.assign({
          kind: 'strip', style: style, x: width / 2, y: y, length: Math.hypot(width, height) * 1.25,
          thickness: Math.max(18, unit * (style === 'film' ? 0.075 : 0.06)), rotation: rotation,
          color: color, speed: from * unit * (style === 'film' ? 0.12 : 0.05), from: from, at: at
        }, stay)
      }
      var items = [
        band('film', height * 0.85, 0.06, CollagePlan.CANDY[0], TITLE_START + 0.4, -1),
        band('lace', height * 0.13, -0.05, CollagePlan.CANDY[3], TITLE_START + 0.7, 1),
        {
          kind: 'pop', x: width * 0.72, y: height * 0.22,
          icon: options.icons && options.icons.length > 0 ? options.icons[0] : CollagePlan.HANABI_FALLBACK_ICON,
          color: CollagePlan.ICON_INKS[0],
          size: unit * 0.12, rotation: 0.16, at: BLOOM_AT + 0.04, duration: 1.4
        }
      ]
      var shapes = ['heart', 'star', 'ribbon', 'sparkle']
      shapes.forEach(function (shape, k) {
        items.push({
          kind: 'sticker', shape: shape, label: null, layer: 'front',
          x: width / 2 + (k === 0 || k === 3 ? -1 : 1) * Math.min(width * 0.38, unit * 0.62),
          y: height * 0.5 + (k < 2 ? -1 : 1) * unit * 0.1,
          size: unit * 0.08, rotation: (k % 2 === 0 ? -1 : 1) * 0.25,
          color: CollagePlan.CANDY[(k + 3) % CollagePlan.CANDY.length],
          at: TITLE_START + 0.5 + k * 0.12, exitAt: stay.exitAt, exitDuration: stay.exitDuration
        })
      })
      for (var k = 0; k < 6; k += 1) {
        items.push({
          kind: 'floater', shape: shapes[k % shapes.length], x: width * (0.12 + ((k * 0.37) % 1) * 0.76), y: height * 1.08,
          rise: height * 1.3, size: unit * (0.05 + (k % 3) * 0.012), color: CollagePlan.CANDY[k % CollagePlan.CANDY.length],
          at: 2.4 + k * 0.9, duration: 4.2, sway: unit * 0.03
        })
      }
      collage = CollageViews.createShotCollage(pixi, { recipe: null, items: items }, collageCache, options.textures)
      view.addChildAt(collage.back, view.getChildIndex(sky) + 1)
      view.addChild(collage.front)
    }

    var update = function (elapsed) {
      var time = Math.max(0, elapsed)
      // 烟花层自己按时间窗挑还在燃烧的，不用每帧先筛一遍。
      fireworks.update(time, bursts, launches)
      if (text) text.update(time)
      // 贴纸气球一轮飘完再从头来：片尾卡可能停很久。
      if (collage) collage.update(time < 8 ? time : 2.4 + ((time - 2.4) % 5.6))
      details.forEach(function (detail) {
        var k = smooth((time - detail.delay) / 0.9)
        detail.label.alpha = k * 0.92
        detail.label.position.y = detail.y + (1 - k) * height * 0.02
      })
    }
    update(0)

    return {
      view: view,
      update: update,
      destroy: function () {
        sky.filters = []
        if (glow) glow.destroy()
        fireworks.destroy()
        if (text) text.destroy()
        if (collage) collage.destroy()
        view.destroy({ children: true })
        if (collageCache) collageCache.destroy()
      }
    }
  }

  window.FoliaHanabiCredits = {
    BLOOM_AT: BLOOM_AT,
    TITLE_START: TITLE_START,
    TITLE_STEP: TITLE_STEP,
    TITLE_SPAN: TITLE_SPAN,
    hasHanabiCredits: hasHanabiCredits,
    resolveHanabiCreditsFrame: resolveHanabiCreditsFrame,
    titleLine: titleLine,
    TITLE_SPEC: TITLE_SPEC,
    createHanabiCredits: createHanabiCredits
  }
})()
