// 花火的场景单元（移植自 folia-major hanabi/scene.ts，createHanabiScene）。
// 一个场景单元（段内一串连续的花火镜头）：世界整体上升，每个镜头在世界里各自的高度上组装
// 烟花（主烟花、被唱到的小烟花、升空尾迹）、装饰件、字底色块、素材层与字（docs/HANABI.md「画面分层」「上升」）。
//   view
//   └ stage（镜头内运镜：推近、摆动、入场震动）
//      ├ ambient.back（屏幕坐标，按 rise 自己做视差）
//      ├ collage.back（整单元的网点底纹，按 rise 视差）
//      ├ spin（绕画面中心转 spin(t)：贯穿整个单元一直在转，镜头内慢转，镜头边界随上升一起加速转过一个大角度）
//      │ └ world（y = rise(t)）
//      │    └ 每个镜头一个 holder（绕「定格时的画面中心」反向转回这个镜头的角度）→ shot 容器：
//      │       fireworks → ornaments(back) → collage(back) → text.blocks → mid → text.glyphs → ornaments(front) → collage(front)
//      ├ ambient.front
//      └ collage.front（整单元的竖排上升跑马灯）
// PV 拼贴（collage/）：每个镜头的拼贴计划在构建时排好（纯数据），显示件与烟花池、装饰件一样在镜头进入可见时间时才建。
// 烟花事件在构建时按镜头算好（纯数据），每帧筛出活跃的；只更新可见时间附近的镜头。每帧画面只由 t 决定。
(function () {
  'use strict'
  var PIXI = window.PIXI

  var Core = window.FoliaHanabiCore
  var Catalog = window.FoliaHanabiCatalog
  var TimelineMod = window.FoliaHanabiTimeline
  var Color = window.FoliaHanabiColor
  var Ambient = window.FoliaHanabiAmbient
  var Fireworks = window.FoliaHanabiFireworks
  var Glow = window.FoliaHanabiMGGlow
  var Ornaments = window.FoliaHanabiOrnaments
  var Text = window.FoliaHanabiText
  var CollagePlan = window.FoliaHanabiCollagePlan
  var CollagePainters = window.FoliaHanabiCollagePainters
  var CollageViews = window.FoliaHanabiCollageViews
  var CollageUnit = window.FoliaHanabiCollageUnit
  var BeatFx = window.FoliaHanabiBeatFx

  // ─── 常量（数值与上游一致） ───────────────────────────────────────────

  /** 一个镜头烟花精灵池的上限（同时可见的镜头一般不超过两个，整单元约 1500）。 */
  var SHOT_PARTICLES = 750
  /** 镜头出场前多少秒开始备（画字形图集、建烟花池与拼贴），备好的在出场前不放。 */
  var PREPARE_AHEAD = 1.5
  /** 被唱到的小烟花、碎成火花的退场，一个镜头最多放多少朵。 */
  var MAX_SUNG_BURSTS = 28
  var MAX_DISSOLVE_BURSTS = 24
  /** 退场碎成火花时，每个字心放的小火花。 */
  var DISSOLVE_SPARK = { kind: 'botan', count: 10, radius: 0.03, duration: 0.65, colors: [0, 1, 2], trail: 0.25, twinkle: 0.6 }
  /** 间奏的连发里轮换的烟花。 */
  var BRIDGE_KINDS = ['mine', 'senrin', 'kiku', 'botan', 'ring', 'crossette', 'willow-ring', 'strobe']

  var MOTION = { calm: 0.6, normal: 1, chaotic: 1.4 }

  // ─── 小工具 ───────────────────────────────────────────────────────────

  /** 文字视图本地坐标 → 镜头容器坐标（视图自己的位置 / 缩放 / 旋转）。 */
  function toShot(view, x, y) {
    var px = (x - view.pivot.x) * view.scale.x
    var py = (y - view.pivot.y) * view.scale.y
    var cos = Math.cos(view.rotation)
    var sin = Math.sin(view.rotation)
    return { x: view.position.x + px * cos - py * sin, y: view.position.y + px * sin + py * cos }
  }

  /** 一行被唱到的字的时间范围（空行退回整行起止）。 */
  function sungRange(line) {
    var words = (line && line.words ? line.words : []).filter(function (word) { return word.text.trim().length > 0 })
    if (words.length === 0) return { first: line ? line.startTime : null, last: line ? line.endTime : null }
    var last = words[0].endTime
    for (var i = 1; i < words.length; i += 1) last = Math.max(last, words[i].endTime)
    return { first: words[0].startTime, last: last }
  }

  /** 从一串里等距取不超过 max 个。 */
  function thin(items, max) {
    if (items.length <= max) return items
    var step = items.length / max
    var picked = []
    for (var k = 0; k < max; k += 1) picked.push(items[Math.floor(k * step)])
    return picked
  }

  /** 拼贴纹理兜底字体：与上游 resolveThemeFontStack 同语义（theme.fontFamilyStack / fontFamily / fontStyle + 兜底）。 */
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

  // ─── 场景单元 ─────────────────────────────────────────────────────────

  /**
   * 建一个场景单元。options：
   *   width / height / resolution / seed / theme / tuning / textures，
   *   shots：[{ id, profile, startTime, endTime, isBridge, line, textHidden? }]（组件已经套进 profile），
   *   startTime / endTime：单元起止；fontScale：歌词字号倍率；exitStart：段落出场转场开始时刻（最后一个镜头的字在这之后退场）；
   *   motifs：拼贴里重复的字样（不给用 HANABI / 花火）；opening：歌曲开头的单元放「now playing」标题卡；
   *   icons：拼贴里开花时蹦出来的图标（不给用花）；spinDirection：世界旋转起转的方向（整首歌一个）。
   * 返回 { view, timeline, events, midLayer, camera, rest, update, prepare, setLayerVisibility, destroy }。
   */
  function createHanabiScene(pixi, options) {
    var width = options.width
    var height = options.height
    var tuning = options.tuning
    var theme = options.theme
    var textures = options.textures
    var unit = Math.min(width, height)
    var motion = MOTION[theme.animationIntensity] !== undefined ? MOTION[theme.animationIntensity] : 1
    var fontScale = options.fontScale !== undefined && options.fontScale !== null ? options.fontScale : 1
    var graphicsOn = !tuning.textOnly
    var keywordColor = Color.keywordColorOf(theme)

    // 配色按名字缓存：一个单元里同一预设的镜头共享一份。
    var paletteCache = new Map()
    var paletteOf = function (profile) {
      var palette = paletteCache.get(profile.palette)
      if (!palette) {
        palette = Color.resolveHanabiPalette(profile.palette, theme, tuning.colorMode)
        paletteCache.set(profile.palette, palette)
      }
      return palette
    }

    var timelineShots = options.shots.map(function (shot) {
      var sung = sungRange(shot.line)
      return {
        startTime: shot.startTime,
        endTime: shot.endTime,
        firstSung: shot.isBridge ? null : sung.first,
        lastSungEnd: shot.isBridge ? null : sung.last,
        isBridge: shot.isBridge,
        camera: shot.profile.camera
      }
    })
    // 世界旋转，贯穿整个单元一直在转：镜头内慢转（约 11°/秒，长镜头慢一些），镜头边界跟着上升再甩过 34°–80°（都乘 tuning.spin），
    // 像一路旋着往上走。单元从整首歌的方向（options.spinDirection）起转，偶尔换向、单元结束前转回来（timeline 的 planSpin）。
    var spinPlan = TimelineMod.planSpin(options.shots.map(function (shot) { return shot.endTime - shot.startTime }), {
      amount: graphicsOn ? Math.max(0, tuning.spin) : 0,
      direction: options.spinDirection !== undefined && options.spinDirection !== null ? options.spinDirection : 1,
      random: Core.createRng(options.seed + ':spin')
    })
    var timeline = TimelineMod.buildTimeline(timelineShots, {
      unitStart: options.startTime,
      unitEnd: options.endTime,
      height: height,
      // 借给别的包时（只画字）字要停在宿主的文字区里，不随世界上漂。
      riseSpeed: graphicsOn ? Math.max(0, tuning.riseSpeed) : 0,
      motion: motion * Math.max(0, tuning.textMotion),
      exitStart: options.exitStart !== undefined ? options.exitStart : null,
      spinAngles: spinPlan.angles,
      spinDrift: spinPlan.drift
    })

    var view = new pixi.Container()
    var stage = new pixi.Container()
    var world = new pixi.Container()
    var spin = new pixi.Container()
    spin.pivot.set(width / 2, height / 2)
    spin.position.set(width / 2, height / 2)
    spin.addChild(world)
    view.addChild(stage)

    // 环境层整单元一份，按屏幕坐标画、自己做视差，所以放在世界外面。
    var lead = options.shots[0]
    var distantRate = options.shots.reduce(function (sum, shot) {
      return sum + ({ quiet: 0.08, neutral: 0.2, loud: 0.35 }[shot.profile.mood])
    }, 0) / Math.max(options.shots.length, 1)
    var qualityProfile = Core.HANABI_QUALITY_PROFILES[tuning.renderQuality] || Core.HANABI_QUALITY_PROFILES.full
    var ambient = graphicsOn && tuning.ambient > 0 && lead
      ? Ambient.createAmbient({
        pixi: pixi,
        textures: textures,
        width: width,
        height: height,
        seed: options.seed + ':ambient',
        palette: paletteOf(lead.profile),
        startTime: options.startTime,
        endTime: options.endTime,
        density: Math.min(2, tuning.ambient) * qualityProfile.ambientScale,
        distantBursts: distantRate
      })
      : null
    // 拼贴纹理整单元一份缓存（一段里贴纸、色带的组合会重复）；单元销毁时一起放。
    var collageOn = graphicsOn && tuning.collage > 0
    var motifs = options.motifs && options.motifs.length > 0 ? options.motifs : ['HANABI', '花火']
    var collageCache = collageOn
      ? CollagePainters.createCollageTextureCache(pixi, options.resolution, themeFontStack(theme))
      : null
    var unitCollage = collageCache && lead
      ? CollageUnit.createUnitCollage(pixi, {
        width: width,
        height: height,
        resolution: options.resolution,
        seed: options.seed,
        cache: collageCache,
        paper: paletteOf(lead.profile).paper,
        amount: Math.min(2, tuning.collage),
        startTime: options.startTime
      })
      : null
    if (ambient) stage.addChild(ambient.back)
    if (unitCollage) stage.addChild(unitCollage.back)
    stage.addChild(spin)
    if (ambient) stage.addChild(ambient.front)
    if (unitCollage) stage.addChild(unitCollage.front)

    // 辉光整单元一个 filter，挂在各镜头的烟花层上；分辨率与级数按画质档。
    var glow = graphicsOn && tuning.glow > 0
      ? Glow.createHanabiGlow(pixi, Math.min(2, tuning.glow), Core.resolveHanabiGlowQuality(width, height, options.resolution, tuning.renderQuality))
      : null

    /** 画面坐标 (sx, sy) 在 time 时刻对应的镜头容器坐标（不计镜头内运镜）。 */
    var screenToShot = function (located, sx, sy, time) {
      return {
        x: sx - located.region.cx * width,
        y: sy - (located.region.cy * height + located.timing.worldY + timeline.rise(time))
      }
    }

    var previousRecipe = null
    var built = options.shots.map(function (shot, index) {
      var profile = shot.profile
      var timing = timeline.shots[index]
      var palette = paletteOf(profile)
      var region = profile.region
      var container = new pixi.Container()
      container.position.set(region.cx * width, region.cy * height + timing.worldY)
      var fireworksHolder = new pixi.Container()
      var ornBack = new pixi.Container()
      var ornFront = new pixi.Container()
      var collageBack = new pixi.Container()
      var collageFront = new pixi.Container()
      var mid = new pixi.Container()
      container.addChild(fireworksHolder)
      container.addChild(ornBack)
      container.addChild(collageBack)

      var text = shot.line && !shot.isBridge
        ? Text.createHanabiText({
          pixi: pixi,
          width: width,
          height: height,
          resolution: options.resolution,
          theme: theme,
          line: shot.line,
          regionWidth: region.w * width,
          regionHeight: region.h * height,
          spec: Object.assign({}, profile.text, { heroSize: profile.text.heroSize * fontScale }),
          palette: palette,
          seed: options.seed + ':' + shot.id + ':text',
          enterAt: timing.enterAt,
          exitAt: timing.exitAt,
          exitDuration: timing.exitDuration,
          motion: Math.max(0, tuning.textMotion),
          blockOpacity: Math.min(1, Math.max(0, tuning.blockOpacity)),
          keywordColor: keywordColor
        })
        : null
      if (text) {
        container.addChild(text.view)
        // 素材层插在色块与字之间：字在哪个容器里，就插在那个容器里字的前面。
        var glyphParent = text.glyphs.parent
        if (glyphParent) glyphParent.addChildAt(mid, glyphParent.getChildIndex(text.glyphs))
        else container.addChild(mid)
      } else {
        container.addChild(mid)
      }
      container.addChild(ornFront)
      container.addChild(collageFront)
      // 反向转回这个镜头的角度，转轴是这个镜头定格时的画面中心：世界转到 timing.spin（镜头中点）时它正好是原来的构图。
      var holder = new pixi.Container()
      holder.pivot.set(width / 2, height / 2 + timing.worldY)
      holder.position.set(width / 2, height / 2 + timing.worldY)
      holder.rotation = -timing.spin
      holder.addChild(container)
      world.addChild(holder)

      var planned = graphicsOn
        ? planShotEvents({
          shot: shot,
          index: index,
          timing: timing,
          palette: palette,
          text: text,
          region: region,
          seed: options.seed,
          screenToShot: screenToShot,
          width: width,
          height: height,
          unit: unit,
          tuning: tuning
        })
        : { bursts: [], launches: [], mains: [] }
      var bursts = planned.bursts
      var launches = planned.launches
      var mains = planned.mains
      var burstEnd = Math.max.apply(null, bursts.map(function (event) { return event.at + event.spec.duration }).concat([-Infinity]))
      var launchEnd = Math.max.apply(null, launches.map(function (event) { return event.at + event.duration + 0.7 }).concat([-Infinity]))
      var regionBounds = { x: -region.w * width / 2, y: -region.h * height / 2, width: region.w * width, height: region.h * height }
      var collage = collageOn
        ? CollagePlan.planShotCollage({
          seed: options.seed + ':' + shot.id,
          family: profile.family,
          mood: profile.mood,
          isBridge: shot.isBridge,
          block: profile.text.block,
          shotNumber: index,
          bounds: text ? text.bounds : regionBounds,
          screen: { x: -region.cx * width, y: -region.cy * height, width: width, height: height },
          screenAt: function (time) {
            var p = screenToShot({ region: region, timing: timing }, 0, 0, time)
            return { x: p.x, y: p.y, width: width, height: height }
          },
          unit: unit,
          palette: palette,
          enterAt: timing.enterAt,
          exitAt: timing.exitAt,
          exitDuration: timing.exitDuration,
          start: timing.start,
          end: timing.end,
          keyword: CollagePlan.pickCollageKeyword(shot.line),
          motifs: motifs,
          bursts: mains.map(function (event) {
            return { x: event.x, y: event.y, at: event.at, kind: event.spec.kind, main: true, radius: event.spec.radius * unit * event.scale }
          }),
          launches: launches,
          amount: Math.min(2, tuning.collage),
          previous: previousRecipe,
          opening: index === 0 ? (options.opening !== undefined ? options.opening : null) : null,
          icons: options.icons
        })
        : { recipe: null, items: [] }
      previousRecipe = collage.recipe
      var collageEnd = Math.max.apply(null, collage.items.map(function (item) {
        return item.kind === 'pop' || item.kind === 'floater' ? item.at + item.duration
          : item.kind === 'whoosh' ? item.at + item.duration + 0.55
            : item.exitAt + item.exitDuration
      }).concat([-Infinity]))
      return {
        shot: shot,
        timing: timing,
        palette: palette,
        container: container,
        fireworksHolder: fireworksHolder,
        ornBack: ornBack,
        ornFront: ornFront,
        collageBack: collageBack,
        collageFront: collageFront,
        collage: collage,
        mid: mid,
        text: text,
        bursts: bursts,
        launches: launches,
        lifeStart: Math.min(timing.launchAt, timing.enterAt) - 0.25,
        lifeEnd: Math.max(timing.exitAt + timing.exitDuration + 0.3, burstEnd + 0.05, launchEnd, collageEnd + 0.05),
        rig: null
      }
    })

    /** 镜头进入可见时间时才建：烟花池（挂辉光）、装饰件与拼贴显示件。 */
    var buildRig = function (item) {
      if (!graphicsOn) return { fireworks: null, ornaments: [], collage: null }
      var fireworks = Fireworks.createFireworks(pixi, textures, {
        width: width,
        height: height,
        palette: item.palette,
        amount: Math.max(0, tuning.sparkAmount),
        maxParticles: SHOT_PARTICLES
      })
      item.fireworksHolder.addChild(fireworks.view)
      if (glow) item.fireworksHolder.filters = [glow]
      var region = item.shot.profile.region
      var bounds = item.text ? item.text.bounds
        : { x: -region.w * width / 2, y: -region.h * height / 2, width: region.w * width, height: region.h * height }
      var text = item.text
      var anchorsAt = text ? function (time) { return text.anchors(time) } : function () { return [] }
      var ornaments = tuning.ornamentAmount > 0
        ? item.shot.profile.ornaments.map(function (spec, k) {
          var ornament = Ornaments.createOrnament(spec, {
            pixi: pixi,
            textures: textures,
            width: width,
            height: height,
            seed: options.seed + ':' + item.shot.id + ':ornament' + k,
            palette: item.palette,
            bounds: bounds,
            anchorsAt: anchorsAt,
            enterAt: item.timing.enterAt,
            exitAt: item.timing.exitAt,
            exitDuration: item.timing.exitDuration,
            amount: Math.min(2, tuning.ornamentAmount)
          })
          ;(spec.layer === 'front' ? item.ornFront : item.ornBack).addChild(ornament.view)
          return ornament
        })
        : []
      var collage = null
      if (collageCache && item.collage.items.length > 0) {
        collage = CollageViews.createShotCollage(pixi, item.collage, collageCache, textures)
        item.collageBack.addChild(collage.back)
        item.collageFront.addChild(collage.front)
      }
      return { fireworks: fireworks, ornaments: ornaments, collage: collage }
    }

    /** 镜头不可见了放掉 rig（显示件销毁，烟花事件等纯数据留着）。 */
    var releaseRig = function (item) {
      if (!item.rig) return
      item.fireworksHolder.filters = []
      if (item.rig.fireworks) item.rig.fireworks.destroy()
      item.rig.ornaments.forEach(function (ornament) { ornament.destroy() })
      if (item.rig.collage) item.rig.collage.destroy()
      item.rig = null
    }

    var layers = { graphics: true, text: true, mid: true }
    var applyLayers = function () {
      if (ambient) {
        ambient.back.renderable = layers.graphics
        ambient.front.renderable = layers.graphics
      }
      if (unitCollage) {
        unitCollage.back.renderable = layers.graphics
        unitCollage.front.renderable = layers.graphics
      }
      for (var i = 0; i < built.length; i += 1) {
        var item = built[i]
        item.fireworksHolder.renderable = layers.graphics
        item.ornBack.renderable = layers.graphics
        item.ornFront.renderable = layers.graphics
        item.collageBack.renderable = layers.graphics
        item.collageFront.renderable = layers.graphics
        item.mid.renderable = layers.mid
        if (item.text) {
          var shown = layers.text && !item.shot.textHidden
          item.text.blocks.renderable = shown
          item.text.glyphs.renderable = shown
        }
      }
    }
    applyLayers()

    var rest = { x: width / 2, y: height / 2, pivotX: width / 2, pivotY: height / 2, scale: 1, rotation: 0 }
    var camera = function (time) {
      var offset = timeline.camera(time)
      return {
        x: rest.x + offset.dx,
        y: rest.y + offset.dy,
        pivotX: rest.pivotX,
        pivotY: rest.pivotY,
        scale: offset.scale,
        rotation: offset.rotation
      }
    }

    var activeBursts = []
    var activeLaunches = []

    // 「随拍开花」：每拍的烟花算一次就缓存（按拍的时刻），换节拍表或强度时清掉。烟花开在那一拍所在的镜头里，
    // 位置按那一拍时的画面换算，跟着这个镜头一起上升、旋转。
    var beatCache = new Map()
    var beatCacheEvents = null
    var beatCacheStrength = -1
    var beatCacheScale = -1
    var beatBursts = built.map(function () { return [] })
    var beatLaunches = built.map(function () { return [] })
    var placeBeat = function (event, beats) {
      var key = Math.round(event.t * 1000)
      if (beatCache.has(key)) return beatCache.get(key)
      var placed = null
      var shell = BeatFx.resolveHanabiBeatShell(event, options.seed, beats.strength, beats.trackScale)
      var shot = timeline.shotAt(event.t)
      var item = built[shot]
      if (shell && item && event.t >= options.startTime && event.t <= options.endTime) {
        var located = { region: item.shot.profile.region, timing: item.timing }
        var p = screenToShot(located, shell.sx * width, shell.sy * height, event.t)
        var burst = { x: p.x, y: p.y, at: event.t, spec: shell.spec, seed: shell.seed, scale: 1 }
        var launch = null
        if (shell.launch && tuning.launches) {
          var at = event.t - TimelineMod.LAUNCH_DURATION
          var bottom = screenToShot(located, shell.sx * width, height * 1.03, at)
          launch = {
            fromX: p.x,
            fromY: Math.max(bottom.y, p.y + height * 0.2),
            toX: p.x,
            toY: p.y,
            at: at,
            duration: TimelineMod.LAUNCH_DURATION,
            color: item.palette.glow,
            seed: shell.seed + ':launch'
          }
        }
        placed = { shot: shot, burst: burst, launch: launch }
      }
      beatCache.set(key, placed)
      return placed
    }
    var collectBeats = function (time, beats) {
      for (var i = 0; i < beatBursts.length; i += 1) beatBursts[i].length = 0
      for (var j = 0; j < beatLaunches.length; j += 1) beatLaunches[j].length = 0
      if (!graphicsOn || !beats || beats.strength <= 0 || beats.events.length === 0) return
      if (beats.events !== beatCacheEvents || beats.strength !== beatCacheStrength || beats.trackScale !== beatCacheScale) {
        beatCache.clear()
        beatCacheEvents = beats.events
        beatCacheStrength = beats.strength
        beatCacheScale = beats.trackScale
      }
      // 正在燃烧的拍（开花后 HANABI_BEAT_SHELL_LIFE 秒内）与马上要升空到达的拍。
      var until = time + TimelineMod.LAUNCH_DURATION
      for (var index = BeatFx.firstBeatAtOrAfter(beats.events, time - BeatFx.HANABI_BEAT_SHELL_LIFE); index < beats.events.length; index += 1) {
        var event = beats.events[index]
        if (event.t > until) break
        var placed = placeBeat(event, beats)
        if (!placed) continue
        if (time >= placed.burst.at) beatBursts[placed.shot].push(placed.burst)
        if (placed.launch && time >= placed.launch.at) beatLaunches[placed.shot].push(placed.launch)
      }
    }

    var update = function (time, beats) {
      var transform = camera(time)
      stage.pivot.set(transform.pivotX, transform.pivotY)
      stage.position.set(transform.x, transform.y)
      stage.scale.set(transform.scale)
      stage.rotation = transform.rotation
      var rise = timeline.rise(time)
      world.y = rise
      spin.rotation = timeline.spin(time)
      if (ambient) ambient.update(time, rise)
      if (unitCollage) unitCollage.update(time, rise)
      collectBeats(time, beats)

      for (var index = 0; index < built.length; index += 1) {
        var item = built[index]
        var visible = time >= item.lifeStart && time <= item.lifeEnd
        item.container.visible = visible
        if (!visible) {
          // 提前备好、马上要出场的留着（prepare），其余放掉。
          if (time < item.lifeStart - PREPARE_AHEAD || time > item.lifeEnd) releaseRig(item)
          continue
        }
        if (!item.rig) item.rig = buildRig(item)
        if (item.text) item.text.update(time)
        if (item.rig.fireworks) {
          activeBursts.length = 0
          activeLaunches.length = 0
          for (var b = 0; b < item.bursts.length; b += 1) {
            var event = item.bursts[b]
            if (event.at > time) break
            if (time <= event.at + event.spec.duration + 0.1) activeBursts.push(event)
          }
          for (var l = 0; l < item.launches.length; l += 1) {
            var launch = item.launches[l]
            if (launch.at <= time && time <= launch.at + launch.duration + 0.7) activeLaunches.push(launch)
          }
          for (var bb = 0; bb < beatBursts[index].length; bb += 1) activeBursts.push(beatBursts[index][bb])
          for (var bl = 0; bl < beatLaunches[index].length; bl += 1) {
            var beatLaunch = beatLaunches[index][bl]
            if (time <= beatLaunch.at + beatLaunch.duration + 0.7) activeLaunches.push(beatLaunch)
          }
          item.rig.fireworks.update(time, activeBursts, activeLaunches)
        }
        for (var o = 0; o < item.rig.ornaments.length; o += 1) item.rig.ornaments[o].update(time)
        if (item.rig.collage) item.rig.collage.update(time)
      }
    }

    /**
     * 运行时在空闲的帧里调：给 PREPARE_AHEAD 秒内要出场的镜头做一件贵的事——画字形图集，或建烟花池、装饰件与拼贴
     * （拼贴纹理现画）。做了返回 true。没备好的镜头出场那一帧照样会自己补上，只是那一帧更重。
     */
    var prepare = function (time) {
      for (var i = 0; i < built.length; i += 1) {
        var item = built[i]
        if (time > item.lifeEnd || time < item.lifeStart - PREPARE_AHEAD) continue
        if (item.text && item.text.prepare()) return true
        if (!item.rig) {
          item.rig = buildRig(item)
          return true
        }
      }
      return false
    }

    var midLayer = function (time) {
      var item = built[timeline.shotAt(time)]
      return item ? item.mid : null
    }

    return {
      view: view,
      timeline: timeline,
      // 各镜头预先算好的烟花事件（调试与测试用）。
      events: built.map(function (item) { return { bursts: item.bursts, launches: item.launches } }),
      midLayer: midLayer,
      camera: camera,
      rest: rest,
      update: update,
      prepare: prepare,
      setLayerVisibility: function (next) {
        layers = { graphics: next.graphics, text: next.text, mid: next.mid }
        applyLayers()
      },
      destroy: function () {
        built.forEach(function (item) {
          releaseRig(item)
          if (item.text) item.text.destroy()
        })
        if (ambient) ambient.destroy()
        if (unitCollage) unitCollage.destroy()
        if (glow) glow.destroy()
        view.destroy({ children: true })
        // 拼贴纹理最后放：显示树里的精灵都已经销毁。
        if (collageCache) collageCache.destroy()
      }
    }
  }

  // ─── 烟花事件（构建时算好） ─────────────────────────────────────────────

  /**
   * 一个镜头的烟花：主烟花（文字入场时开，burstAt 决定位置，带升空尾迹）、被唱到的字各放一朵小花、
   * 碎成火花的退场；间奏镜头是一串スターマイン / 千輪。位置都在镜头容器坐标里。
   * input：{ shot, index, timing, palette, text, region, seed, screenToShot, width, height, unit, tuning }。
   */
  function planShotEvents(input) {
    var shot = input.shot
    var profile = shot.profile
    var timing = input.timing
    var palette = input.palette
    var region = input.region
    var width = input.width
    var height = input.height
    var random = Core.createRng(input.seed + ':' + shot.id + ':' + input.index + ':events')
    var bursts = []
    var launches = []
    var locate = function (sx, sy, time) { return input.screenToShot({ region: region, timing: timing }, sx, sy, time) }
    var launchColor = palette.glow
    var withLaunch = profile.launch && input.tuning.launches

    /** 从画面底边升到 (x, y)（镜头坐标），到达时刻 = arrive。 */
    var launchTo = function (x, y, arrive, key) {
      var at = arrive - TimelineMod.LAUNCH_DURATION
      var bottom = locate(0, height * 1.03, at).y
      launches.push({
        fromX: x + (random() - 0.5) * width * 0.08,
        fromY: Math.max(bottom, y + height * 0.2),
        toX: x,
        toY: y,
        at: at,
        duration: TimelineMod.LAUNCH_DURATION,
        color: launchColor,
        seed: input.seed + ':' + shot.id + ':' + key + ':launch'
      })
    }

    /** 环形系烟花的随机扁率与旋转。 */
    var shape = function (spec) {
      return spec.kind === 'ring' || spec.kind === 'willow-ring' || spec.kind === 'heart' || spec.kind === 'star'
        ? { squash: spec.kind === 'ring' ? 0.4 + random() * 0.5 : 1, rotation: (random() - 0.5) * 0.6 }
        : {}
    }

    if (shot.isBridge) {
      // 间奏：スターマイン / 千輪 连发，沿画面随机高处开，每朵都有尾迹（スターマイン 从底边喷）。
      var from = timing.start + 0.15
      var to = timing.end - 0.3
      var duration = Math.max(0, to - from)
      var count = Math.max(1, Math.min(10, Math.round(duration / 0.75)))
      var kinds = profile.burst ? [profile.burst.kind].concat(BRIDGE_KINDS) : BRIDGE_KINDS
      for (var k = 0; k < count; k += 1) {
        var at = from + (count === 1 ? 0 : (k / (count - 1)) * duration * 0.85) + random() * 0.12
        var kind = kinds[Math.floor(random() * kinds.length)]
        var spec = Catalog.burstPreset(kind, [k % 5, (k + 1) % 5, (k + 2) % 5])
        if (kind === 'mine') {
          var pm = locate(width * (0.2 + random() * 0.6), height * 0.94, at)
          bursts.push({ x: pm.x, y: pm.y, at: at, spec: spec, seed: input.seed + ':' + shot.id + ':b' + k, scale: 0.8 + random() * 0.3 })
          continue
        }
        var p = locate(width * (0.15 + random() * 0.7), height * (0.14 + random() * 0.34), at)
        bursts.push(Object.assign(
          { x: p.x, y: p.y, at: at, spec: spec, seed: input.seed + ':' + shot.id + ':b' + k, scale: 0.55 + random() * 0.4 },
          shape(spec)
        ))
        if (input.tuning.launches) launchTo(p.x, p.y, at, 'b' + k)
      }
      bursts.sort(function (a, b) { return a.at - b.at })
      return { bursts: bursts, launches: launches, mains: bursts.slice() }
    }

    var bounds = input.text ? input.text.bounds
      : { x: -region.w * width / 2, y: -region.h * height / 2, width: region.w * width, height: region.h * height }
    var centerX = bounds.x + bounds.width / 2
    var centerY = bounds.y + bounds.height / 2

    // 主烟花。
    var mains = []
    var main = profile.burst
    if (main) {
      var radius = main.radius * input.unit
      var at = timing.enterAt
      var key = input.seed + ':' + shot.id + ':main'
      var minY = height * 0.12 - region.cy * height
      var maxX = width * 0.42
      var points = []
      if (main.kind === 'mine') {
        // スターマイン 从画面底边往上喷。
        var sx = profile.burstAt === 'sides' ? [0.25, 0.75] : [0.3 + random() * 0.4]
        sx.forEach(function (x, k2) {
          points.push({ x: x * width - region.cx * width, y: height * 0.94 - region.cy * height, at: at + k2 * 0.15 })
        })
      } else if (profile.burstAt === 'behind') {
        points.push({ x: centerX + (random() - 0.5) * bounds.width * 0.15, y: centerY - radius * 0.15, at: at })
      } else if (profile.burstAt === 'above') {
        points.push({ x: centerX + (random() - 0.5) * bounds.width * 0.3, y: Math.max(minY, bounds.y - radius * 0.45), at: at })
      } else if (profile.burstAt === 'sides') {
        var dx = Math.min(maxX, bounds.width / 2 + radius * 0.35)
        points.push({ x: centerX - dx, y: Math.max(minY, centerY - radius * 0.3), at: at })
        points.push({ x: centerX + dx, y: Math.max(minY, centerY - radius * 0.3), at: at + 0.15 })
      } else {
        // sky：画面上方随机的高处（按镜头定格时的画面换算）。
        var settled = timing.enterAt + 0.6
        var ps = locate(width * (0.2 + random() * 0.6), height * (0.12 + random() * 0.22), settled)
        points.push({ x: ps.x, y: ps.y, at: at })
      }
      points.forEach(function (point, k3) {
        var x = Math.max(-region.cx * width + width * 0.06, Math.min(width * (1 - region.cx) - width * 0.06, point.x))
        var event = Object.assign(
          { x: x, y: point.y, at: point.at, spec: main, seed: key + k3, scale: 1 },
          shape(main)
        )
        bursts.push(event)
        mains.push(event)
        if (withLaunch && main.kind !== 'mine') launchTo(x, point.y, point.at, 'main' + k3)
      })
    }

    if (input.text) {
      var text = input.text
      var glyphs = text.anchors(timing.enterAt)
        .map(function (anchor, k4) { return { anchor: anchor, k: k4 } })
        .filter(function (entry) { return !entry.anchor.blank })
      // 被唱到的字各放一朵小花。
      var sung = profile.sungBurst
      if (sung) {
        var candidates = glyphs.filter(function (entry) { return entry.anchor.sungAt >= timing.enterAt && entry.anchor.sungAt < timing.exitAt })
        thin(candidates, MAX_SUNG_BURSTS).forEach(function (entry, n) {
          var anchor = entry.anchor
          var k5 = entry.k
          var anchorList = text.anchors(anchor.sungAt)
          var now = anchorList[k5] !== undefined ? anchorList[k5] : anchor
          var p = toShot(text.view, now.x, now.y)
          var colors = sung.colors.length > 0 ? sung.colors.map(function (_, j) { return sung.colors[(j + n) % sung.colors.length] }) : [n]
          var sungSpec = Object.assign({}, sung, { colors: colors })
          bursts.push({
            x: p.x,
            y: p.y - now.size * 0.1,
            at: anchor.sungAt,
            spec: sungSpec,
            seed: input.seed + ':' + shot.id + ':sung' + k5,
            scale: Math.max(0.6, Math.min(1.6, now.size / (input.unit * 0.1)))
          })
        })
      }
      // 碎成火花的退场：每个字心放一朵小火花。
      if (profile.text.exit === 'dissolve') {
        var chosen = thin(glyphs, MAX_DISSOLVE_BURSTS)
        var step = Math.min(0.05, (timing.exitDuration * 0.6) / Math.max(chosen.length, 1))
        chosen.forEach(function (entry, n2) {
          var at2 = timing.exitAt + n2 * step
          var anchorList2 = text.anchors(at2)
          var now2 = anchorList2[entry.k]
          if (!now2) return
          var p2 = toShot(text.view, now2.x, now2.y)
          bursts.push({ x: p2.x, y: p2.y, at: at2, spec: DISSOLVE_SPARK, seed: input.seed + ':' + shot.id + ':dissolve' + entry.k, scale: 1 })
        })
      }
    }

    bursts.sort(function (a, b) { return a.at - b.at })
    return { bursts: bursts, launches: launches, mains: mains }
  }

  window.FoliaHanabiScene = {
    createHanabiScene: createHanabiScene,
    SHOT_PARTICLES: SHOT_PARTICLES,
    PREPARE_AHEAD: PREPARE_AHEAD
  }
})()
