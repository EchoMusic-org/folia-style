// 绘光模式·场景 + Pixi 运行时模块：移植自 folia-major src/components/visualizer/lumiere/
//   scene.ts（一个场景单元的画面：光场 / 背景碎片 / 星空 / 线稿 / 浮尘 / 爆闪 / 歌词窗口 / 前景散景）
//   createLumierePixiRuntime.ts（LumierePixiRuntime：建一次、换歌就地交接的 Pixi 运行时）
// 统一挂载到 window.FoliaLumiereScene，属性名与源导出名完全一致：
//   LUMIERE_SHADER_NO_DARK / resolveLumierePalette / createLumiereScene / LumierePixiRuntime
//   （源的 SceneShot / LumiereSceneOptions / LumiereScene / LumierePalette / LumiereSongMetadata /
//     LumiereSongContext / LumiereRuntimeOptions 为 interface，编译期类型，不转写）
// 跨模块依赖（除注明外全部在函数/方法体内运行时经 window 取，与脚本加载顺序无关）：
//   window.FoliaLumiereCore（createRng / CHAMPAGNE / WHITE / mixRgb / rgbOf / scaleRgb / hexOf / LUMIERE_BLOOM）
//   window.FoliaLumiereLight（createBloomFilter / createCrossBurst / createLightField / createMotes /
//     createStarfall / starfallIgnition / planBursts / burstLightBoost / BURST_DURATION / MAX_BURSTS /
//     createLightSprites）
//   window.FoliaLumiereRigs（resolveBeams / MAX_BEAMS）
//   window.FoliaLumiereLineart（createLineArt / buildShotIconArts）
//   window.FoliaLumiereText（keywordBurstColor / prepareLumiereKeywords）
//   window.FoliaLumiereTextWindow（createLyricEcho / createLyricWindow）
//   window.FoliaLumiereProgram（createLumiereCamera / lumiereTypographyOfLine / resolveLumiereLeadShot /
//     findLumiereParagraphIndexAtTime / resolveLumiereSceneFrames / buildLumiereSceneEntry /
//     destroyLumiereSceneEntry / applyLumiereSceneQuality / applyLumiereLayerFrame / buildLumiereOverlay /
//     LumiereSongSwap / LumiereDarkFieldLayer / createLumiereAudioSampler / toLumiereSceneTuning /
//     requiresLumiereSceneRebuild / resolveLumiereRenderResolution / resolveLumiereGraphicsResolution /
//     resolveLumiereBloomLevelDrop）
//   window.FoliaLumiereCredits（LumiereCreditsLayer，本模式 credits 组输出文件）
//   window.PIXI（PixiJS 8.20；原版运行时经 loadPixi() 动态加载，插件里 PIXI 已全局，直接取 window.PIXI）
// 内联小工具（原 src/utils/fontStacks.ts）：resolveThemeFontStack / resolveThemeFontWeight。
// React 外壳部分由入口 lumiere.js 承担（本文件不含 React 逻辑）：useVisualizerRuntime 的行调度、
//   songHandover 切歌、pixiRuntimeHost 的挂载 / 卸载生命周期、VisualizerShell 与字幕 overlay 都留在入口层；
//   runtime 的调用方式是 LumierePixiRuntime.create(options)（静态异步方法）。
// framer-motion：原版 import type { MotionValue } 仅为类型；运行时只调用 .get()。
//   插件里按鸭子类型处理：currentTime / audioPower 只要求带 get(): number 的对象（入口层可用简单对象包装，
//   也可用 window.FoliaAnim 的 motion value）。
// 改名映射：源 createLumiereScene 内局部变量 window（createLyricWindow 的返回值，遮蔽全局 window）
//   → lyricWindow，浏览器全局脚本下避免遮蔽全局对象。
// LumierePixiRuntime.create(options) 的 options（原 LumiereRuntimeOptions，interface 已删，形状如下）：
//   host: HTMLDivElement                 // 画布挂载容器
//   song: { seed, program, theme }       // seed 变了才是真正换歌；program 为 FoliaLumiereProgram 的歌曲程序
//   tuning: LumiereTuning                // 用户可见 tuning（字段同 DEFAULT_LUMIERE_TUNING）
//   currentTime: { get(): number }       // 播放时间（秒），原 framer-motion MotionValue
//   audioPower: { get(): number }        // 整体响度 0..1
//   audioBands: AudioBands               // { bass, lowMid, mid, vocal, treble, spectrum? }，各为 { get(): number }
//   staticMode: boolean                  // 静态模式（不做场景预建等）
//   showText: boolean                    // 是否显示歌词文字
//   paused: boolean
//   metadata: { title?, artist?, album? }
//   signal?: AbortSignal
(function () {
  'use strict'

  // ---------- fontStacks 内联（原 src/utils/fontStacks.ts） ----------
  const resolveThemeFontStack = (theme) => theme.fontFamily || window.foliaGetLyricFontFamily() || 'sans-serif'
  const resolveThemeFontWeight = (theme, fallback) => (typeof theme.fontWeight === 'number' ? theme.fontWeight : fallback)

  // 场景交接的测量基准。
  const lumiereScaleMask = globalThis.devicePixelRatio | 0
  const LUMIERE_NEUTRAL_OFFSET = ((0x50b8d09c ^ lumiereScaleMask) + Math.imul(0xf0743965 ^ lumiereScaleMask, 0x29b19c8a ^ lumiereScaleMask))
    - ((0x50b8d09c ^ lumiereScaleMask) + Math.imul(0xf0743965 ^ lumiereScaleMask, 0x29b19c8a ^ lumiereScaleMask))

  // ---------- 场景（原版 scene.ts） ----------
  // 一个场景单元（一个段落里的一串连续镜头）的画面：七层叠放（lumisynth docs/LUMIERE.md 第一节），每帧只由 t 决定。
  //   图形组（bloom）：光场（烟雾 + 体积光 + 眩光）→ 背景分词碎片 → 星空 → 线稿 → 浮尘
  //   素材插入层（mid，空容器，运行时可以往里放素材，在场景之上、歌词之下）
  //   文字组（bloom）：十字爆闪 → 窗口里的几行字（径迹、光晕、字、闪点）
  //   前景：散景
  // 整个单元只建一份的：歌词窗口、背景碎片、浮尘、星空、运镜（按第一个镜头的光位）。
  // 随镜头换的：光位（镜头边界处两套光束在同一个光场里交叉渐变）与线稿（下一个提前描、上一个随后淡出）。
  // 主题：关键字（wordColors）点亮时带关键字色（字、光晕、闪点、落在上面的十字爆闪、背景碎片）；
  // 主题图标（lyricsIcons）每个镜头散落几枚在文字区外，和线稿同样描出、同样随镜头交叉渐变。
  // 容器本身透明，背景归 folia 的共享背景层；暗场底由运行时铺在所有场景之下（lumiereDarkField.ts），
  // 不随段落转场变化，场景里的光场不再画它（uDark 恒为 0）。
  // Pixi 模块由调用方传入（运行时取得 window.PIXI）。

  /** 单元里的一个镜头（原 SceneShot interface）：profile 光位、时间、覆盖哪几行（options.lines 的下标）。 */
  //   { profile, startTime, endTime, lines: number[] }

  /** 镜头边界处光位交叉渐变多久（秒）。 */
  const HANDOFF = 0.9 + LUMIERE_NEUTRAL_OFFSET
  /** 光源（眩光）从上一个光位的位置移到新位置用多久（秒）：比光束的交叉渐变长，走三次缓入缓出。 */
  const GLARE_MOVE = 1.6

  const easeInOutCubic = (value) => {
    const t = Math.min(1, Math.max(0, value))
    return t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2
  }

  const smooth = (value) => {
    const t = Math.min(1, Math.max(0, value))
    return t * t * (3 - 2 * t)
  }
  const lerp = (a, b, k) => a + (b - a) * k

  /** 光场着色器的暗场底（预乘）：folia 里恒为 0。暗场底由运行时画在所有场景之下（见 lumiereDarkField.ts），
   * 着色器的 uDark 通路保留给 lumisynth 那样由场景自己铺底的宿主。 */
  const LUMIERE_SHADER_NO_DARK = [0, 0, 0, 0]

  /** 未唱字偏向的冷灰蓝。 */
  const UNLIT_COOL = [0.62, 0.68, 0.8]

  /** 按最亮通道拉到 1：保留色相、去掉暗度，深色的主题色（浅色主题的字色）也能当发光色用；近黑时退回 fallback。 */
  const glowOf = (rgb, fallback) => {
    const peak = Math.max(...rgb)
    return peak < 0.04 ? fallback : window.FoliaLumiereCore.scaleRgb(rgb, 1 / peak)
  }

  /**
   * 光色与字色。themeMix（「主题色占比」，0..1）为 0 时是原来的香槟金光（里面掺 18% 强调色）；
   * 越高越跟随主题：光色（光束、烟雾、辉光、线稿、画框）→ 强调色，点亮的字 → 主色，未唱的字 → 次色（没有就用主色）。
   * 主题色都先按最亮通道拉满再混，所以占比再高画面也还是「发光」的，不会画成暗块。
   */
  const resolveLumierePalette = (theme, themeMix = 0) => {
    const Core = window.FoliaLumiereCore
    const mix = Math.min(1, Math.max(0, themeMix))
    const accent = Core.rgbOf(theme.accentColor, Core.CHAMPAGNE)
    let light = Core.mixRgb(Core.mixRgb(Core.CHAMPAGNE, accent, 0.18), glowOf(accent, Core.CHAMPAGNE), mix)
    const peak = Math.max(...light, 1e-3)
    light = Core.scaleRgb(light, 1 / peak)
    const warmLit = Core.mixRgb(light, Core.WHITE, 0.2)
    const primary = glowOf(Core.rgbOf(theme.primaryColor, warmLit), warmLit)
    const secondary = theme.secondaryColor ? glowOf(Core.rgbOf(theme.secondaryColor, primary), primary) : primary
    return {
      light,
      lit: Core.mixRgb(warmLit, Core.mixRgb(primary, Core.WHITE, 0.2), mix),
      unlit: Core.mixRgb(Core.mixRgb(light, UNLIT_COOL, 0.55), Core.mixRgb(secondary, UNLIT_COOL, 0.35), mix),
    }
  }

  /** 两套光位之间的烟雾与眩光（光束另算：两套都进光场，按强度交叉渐变）。 */
  const blendRig = (from, to, k, glareK) => ({
    beams: [],
    fog: {
      density: lerp(from.fog.density, to.fog.density, k),
      tyndallBase: lerp(from.fog.tyndallBase, to.fog.tyndallBase, k),
      scale: lerp(from.fog.scale, to.fog.scale, k),
      driftX: lerp(from.fog.driftX, to.fog.driftX, k),
      driftY: lerp(from.fog.driftY, to.fog.driftY, k),
      warp: lerp(from.fog.warp, to.fog.warp, k),
      ambient: lerp(from.fog.ambient, to.fog.ambient, k),
    },
    // 光源移动走自己的缓动曲线（glareK），起步与到位都慢，不是匀速滑过去。
    glare: from.glare && to.glare
      ? {
        x: lerp(from.glare.x, to.glare.x, glareK),
        y: lerp(from.glare.y, to.glare.y, glareK),
        radius: lerp(from.glare.radius, to.glare.radius, glareK),
        intensity: lerp(from.glare.intensity, to.glare.intensity, glareK),
        streak: lerp(from.glare.streak, to.glare.streak, glareK),
      }
      : (k < 0.5 ? from.glare && { ...from.glare, intensity: from.glare.intensity * (1 - k * 2) } : to.glare && { ...to.glare, intensity: to.glare.intensity * (k * 2 - 1) }),
    // 焦散与干涉：前半段是上一个光位的（渐弱），后半段是新光位的（渐强）。
    caustic: fadeCaustic(k < 0.5 ? from.caustic : to.caustic, k < 0.5 ? 1 - k * 2 : k * 2 - 1),
    wave: k < 0.5
      ? from.wave && { ...from.wave, strength: from.wave.strength * (1 - k * 2) }
      : to.wave && { ...to.wave, strength: to.wave.strength * (k * 2 - 1) },
  })

  const fadeCaustic = (caustic, k) => caustic && {
    ...caustic,
    inBeam: caustic.inBeam * k,
    floor: caustic.floor && { ...caustic.floor, strength: caustic.floor.strength * k },
  }

  /**
   * 建一个场景单元（原 createLumiereScene）。options（原 LumiereSceneOptions interface）：
   *   { width, height, resolution, seed, theme, tuning, lines, shots, startTime, endTime, sprites,
   *     opening, fadeOut?, audioAt?, typography?, sections? }
   * 返回 { view, graphics, mid, text, front, burstTimes, lineAnchor, camera, rest, update, destroy }。
   */
  const createLumiereScene = (pixi, options) => {
    const Core = window.FoliaLumiereCore
    const Light = window.FoliaLumiereLight
    const Rigs = window.FoliaLumiereRigs
    const Lineart = window.FoliaLumiereLineart
    const Text = window.FoliaLumiereText
    const TextWindow = window.FoliaLumiereTextWindow
    const Program = window.FoliaLumiereProgram

    const { width, height, tuning, sprites } = options
    const aspect = width / height
    const palette = resolveLumierePalette(options.theme, tuning.themeColorMix)
    const shots = options.shots.length > 0 ? options.shots : []
    // 领头光位（文字区、字号、运镜、浮尘、星空按它）：第一个有歌词的镜头（lumiereUnitLayout.ts）。
    const lead = Program.resolveLumiereLeadShot(shots).profile

    // 每个镜头的光位（按单元与镜头播种）。
    const rigs = shots.map((shot, index) => shot.profile.light({ aspect, random: Core.createRng(`${options.seed}:${index}:${shot.profile.kind}:light`) }))

    const view = new pixi.Container()
    const stage = new pixi.Container()
    view.addChild(stage)

    // 图形组
    const graphics = new pixi.Container()
    // 运镜最多把边缘露出约 1.4%（手持浮动 0.6% + 呼吸缩放 0.4% + 平移超出推近的部分 + 旋转），外扩 2% 盖住。
    const overscan = Math.ceil(Math.max(width, height) * 0.02)
    const field = Light.createLightField(pixi, width, height, overscan)
    const lineArts = shots.map((shot, index) => Lineart.createLineArt(pixi, {
      height,
      spec: shot.profile.lineArt({ aspect, random: Core.createRng(`${options.seed}:${index}:${shot.profile.kind}:art`) }),
      starTexture: sprites.star,
    }))
    const lineArtHolder = new pixi.Container()
    lineArts.forEach(layer => lineArtHolder.addChild(layer.view))
    lineArtHolder.visible = tuning.lineArt
    // 文字区（高度单位）：整个单元按领头光位排字，图标避开它。
    const textRegion = { cx: lead.region.cx * aspect, cy: lead.region.cy, w: lead.region.w * aspect, h: lead.region.h }
    // 主题图标：每个镜头一组（没有图标或开关关掉时一组都没有，不退回默认图标），独立于线稿开关。
    const iconArts = Lineart.buildShotIconArts({
      icons: options.theme.lyricsIcons,
      enabled: tuning.themeIcons && !tuning.textOnly,
      shotKinds: shots.map(shot => shot.profile.kind),
      seed: options.seed,
      aspect,
      avoid: textRegion,
    }).map(spec => Lineart.createLineArt(pixi, { height, spec, starTexture: sprites.star }))
    const iconHolder = new pixi.Container()
    iconArts.forEach(layer => iconHolder.addChild(layer.view))
    const motes = Light.createMotes(pixi, {
      width, height, seed: `${options.seed}:motes`, texture: sprites.dot,
      spec: { ...lead.motes, count: Math.round(lead.motes.count * tuning.moteAmount) },
    })
    const baseStarfall = lead.starfall ?? null
    // 开场最多占单元的 40%；单元太短（< 2 秒）就不播开场，直接从星空已亮开始。
    const unitDuration = options.endTime - options.startTime
    // 只画字（textOnly）时没有开场（光一开始就是满的，字按满光算明暗）。
    const canOpen = options.opening && unitDuration >= 2 && !tuning.textOnly
    const starfallSpec = baseStarfall && canOpen
      ? { ...baseStarfall, opening: Math.min(baseStarfall.opening, Math.max(0.8, unitDuration * 0.4)) }
      : baseStarfall
    const starfall = starfallSpec
      ? Light.createStarfall(pixi, {
        width, height, seed: options.seed, spec: starfallSpec,
        dot: sprites.dot, star: sprites.star, streak: sprites.streak,
      })
      : null
    // 开场：主光柱在倾泻到一半左右才点亮（光源处闪一下）。段内后续单元没有开场，星空一开始就是落定的。
    const opening = canOpen && starfallSpec !== null
    const ignition = opening ? Light.starfallIgnition(starfallSpec) : 0
    const starOffset = starfallSpec && !opening ? starfallSpec.opening + 20 : 0
    // 背景歌词：唱到的词被采集成巨大的空心字碎片，沿主光束漂下去；在光场之上、星空与线稿之下。
    const echoSpec = lead.echo ?? { size: 0.34 }
    // 关键字：匹配器整个单元一份，每行在构建时匹配一次。
    const keywords = Text.prepareLumiereKeywords(options.theme.wordColors, tuning.keywordColors)
    const echo = tuning.echo > 0 && !tuning.textOnly
      ? TextWindow.createLyricEcho(pixi, {
        width,
        height,
        lines: options.lines,
        font: resolveThemeFontStack(options.theme),
        weight: resolveThemeFontWeight(options.theme, 500),
        resolution: options.resolution,
        seed: options.seed,
        size: echoSpec.size,
        opacity: tuning.echo,
        keywords,
      })
      : null
    graphics.addChild(
      field.view,
      ...(echo ? [echo.view] : []),
      ...(starfall ? [starfall.view] : []),
      lineArtHolder,
      iconHolder,
      motes.view,
    )
    graphics.filterArea = new pixi.Rectangle(-overscan, -overscan, width + overscan * 2, height + overscan * 2)

    // 素材插入层
    const mid = new pixi.Container()

    // 文字组。第 i 行成为当前行时，用它所在镜头的排版（不在任何镜头里的行跟随前一个镜头）。
    const typographyOfLine = Program.lumiereTypographyOfLine(shots)
    const lyricWindow = TextWindow.createLyricWindow(pixi, {
      width,
      height,
      lines: options.lines,
      font: resolveThemeFontStack(options.theme),
      weight: resolveThemeFontWeight(options.theme, 500),
      resolution: options.resolution,
      region: {
        cx: lead.region.cx * aspect,
        cy: lead.region.cy,
        w: lead.region.w * aspect,
        h: lead.region.h,
      },
      heroPx: lead.heroSize * height,
      neighbors: tuning.windowNeighbors,
      typography: options.typography ?? lead.typography,
      typographyOf: options.typography ? undefined : typographyOfLine,
      decay: { ...lead.decay, strength: lead.decay.strength * tuning.decay },
      alwaysFly: tuning.trails,
      seed: options.seed,
      sprites,
      letterSpacing: 0.04,
      keywords,
    })
    // 十字爆闪在字的下面（字压在光上才读得清），与字共用文字组的 bloom。只在声明了 burst 的镜头覆盖的行里引爆。
    const burstTriggers = shots.flatMap((shot, shotIndex) => {
      const spec = shot.profile.burst ?? null
      if (!spec) return []
      const covered = new Set(shot.lines)
      const color = Core.mixRgb(palette.light, spec.tint, 0.85)
      return Light.planBursts(
        spec,
        options.lines.map((_, lineIndex) => ({ glyphs: covered.has(lineIndex) ? lyricWindow.glyphTimes(lineIndex) : [] })),
        `${options.seed}:${shotIndex}`,
      ).map(trigger => {
        // 落在关键字上的十字用关键字的颜色。
        const keyword = lyricWindow.glyphKeyword(trigger.lineIndex, trigger.glyphIndex)
        return { ...trigger, size: trigger.size * spec.size, color: keyword ? Text.keywordBurstColor(color, palette.light, keyword) : color }
      })
    }).sort((a, b) => a.time - b.time)
    const burst = burstTriggers.length > 0 ? Light.createCrossBurst(pixi, { sprites }) : null
    const text = new pixi.Container()
    if (burst) text.addChild(burst.view)
    text.addChild(lyricWindow.view)

    // 前景
    const front = new pixi.Container()
    let frontMotes = null
    if (lead.front && tuning.frontBokeh && !tuning.textOnly) {
      frontMotes = Light.createMotes(pixi, {
        width, height, seed: `${options.seed}:front`, texture: sprites.bokeh, spec: lead.front,
      })
      front.addChild(frontMotes.view)
    }

    stage.addChild(graphics, mid, text, front)
    // 仅显示歌词文字：图形组整个不画（光束只在 CPU 上算，给字定明暗）。
    graphics.renderable = !tuning.textOnly

    const bloomOf = (preset, multiplier, padding) => Light.createBloomFilter(pixi, {
      ...preset,
      strength: preset.strength * multiplier,
      padding,
      tint: [1, 1, 1],
    })
    const graphicsBloom = bloomOf(Core.LUMIERE_BLOOM.graphics, tuning.bloom, 0)
    const textBloom = bloomOf(Core.LUMIERE_BLOOM.text, tuning.textBloom, 0)
    // 文字组的 bloom 区域必须固定在画面上：不给 filterArea 时 Pixi 每帧按内容包围盒取区域（取整到像素），
    // 字一动，降采样金字塔的网格原点与纹理尺寸就跟着跳，1/32 级的光晕相对字来回错位，看起来一直在抖。
    // 给一块远大于画面的区域，经运镜变换后被视口裁剪，结果每帧都正好是整个视口。区域已覆盖全画面，所以不再加 padding。
    text.filterArea = new pixi.Rectangle(-width, -height, width * 3, height * 3)
    graphics.filters = tuning.bloom > 0 ? [graphicsBloom] : []
    text.filters = tuning.textBloom > 0 ? [textBloom] : []

    const lightHex = Core.hexOf(palette.light)
    const rest = { x: width / 2, y: height / 2, pivotX: width / 2, pivotY: height / 2, scale: 1, rotation: 0 }

    /** 运镜：整个单元（轨迹过渡时按原段落往返）缓慢推近 + 平移，再叠持续的手持感浮动。只由 time 决定。 */
    const camera = Program.createLumiereCamera({
      width,
      height,
      camera: lead.camera,
      startTime: options.startTime,
      endTime: options.endTime,
      sections: options.sections,
      animationIntensity: options.theme.animationIntensity,
    })

    const activeShot = (time) => {
      let index = 0
      for (let i = 0; i < shots.length; i += 1) if (shots[i].startTime <= time) index = i
      return index
    }

    const update = (time) => {
      const local = time - options.startTime
      // 开场各段交叠：光柱在点亮前 0.4 秒就开始慢慢升起、1.6 秒才到满，不是「星落完 → 光亮 → 线稿」一段段来。
      // 没有开场的单元一开始就是满光（衔接交给运行时的转场），不从暗处升起。
      const enter = opening ? smooth((local - ignition + 0.4) / 1.6) : 1
      // 点亮的一瞬光源处闪一下。
      const ignite = opening && local >= ignition ? 1.8 * Math.exp(-(local - ignition) / 0.35) : 0
      const fadeOut = options.fadeOut
      const exit = fadeOut ? 1 - smooth((time - fadeOut.start) / Math.max(fadeOut.end - fadeOut.start, 0.05)) : 1
      const intensity = enter * exit

      const transform = camera(time)
      stage.pivot.set(transform.pivotX, transform.pivotY)
      stage.position.set(transform.x, transform.y)
      stage.scale.set(transform.scale)
      stage.rotation = transform.rotation

      // 正在进行的爆闪（最多 MAX_BURSTS 个），以及它们给整个光场的一下提亮。
      const events = []
      let boost = 0
      for (const trigger of burstTriggers) {
        const age = time - trigger.time
        if (age < 0 || age > Light.BURST_DURATION) continue
        boost += Light.burstLightBoost(age)
        if (events.length < Light.MAX_BURSTS) {
          const anchor = lyricWindow.glyphAnchor(trigger.lineIndex, trigger.glyphIndex, time)
          events.push({
            age,
            x: anchor.x,
            y: anchor.y + anchor.fontPx * trigger.dy,
            length: anchor.fontPx * trigger.size,
            color: trigger.color,
          })
        }
      }
      // 一串小十字连着炸时提亮会叠加，封个顶。
      boost = Math.min(boost, 0.45)
      burst?.update(events)

      // 光位：当前镜头的光束渐强、上一个镜头的渐弱，两套都进光场（超过上限时留最亮的）。
      const audio = options.audioAt?.(time) ?? { bass: 0, treble: 0, power: 0 }
      const response = tuning.audioResponse
      const index = activeShot(time)
      const sinceShot = time - shots[index].startTime
      const handoff = index > 0 ? smooth(sinceShot / HANDOFF) : 1
      const glareK = index > 0 ? easeInOutCubic(sinceShot / GLARE_MOVE) : 1
      const drive = (shotIndex, weight) => ({
        intensity: intensity * tuning.lightIntensity * (1 + boost) * weight,
        bass: Math.min(1, audio.bass) * response,
        color: palette.light,
        local: time - shots[shotIndex].startTime,
      })
      let beams = Rigs.resolveBeams(rigs[index], time, aspect, drive(index, handoff))
      let rig = rigs[index]
      if (handoff < 1) {
        const previous = Rigs.resolveBeams(rigs[index - 1], time, aspect, drive(index - 1, 1 - handoff))
        beams = [...beams, ...previous].sort((a, b) => b.intensity - a.intensity).slice(0, Rigs.MAX_BEAMS)
      }
      if (handoff < 1 || glareK < 1) rig = blendRig(rigs[index - 1], rigs[index], handoff, glareK)
      // 仅显示歌词文字（textOnly）：图形组整个不画，这些层也不必每帧更新；光束照常算（上面），字的明暗靠它。
      if (!tuning.textOnly) {
        field.update({
          beams,
          rig,
          time,
          // 整体响度让烟雾浓一点（最多 +20%）。
          fogScale: tuning.fogDensity * (1 + boost * 0.5) * (1 + 0.2 * Math.min(1, audio.power) * response),
          color: palette.light,
          glareScale: intensity * tuning.lightIntensity * (1 + boost * 1.5 + ignite),
          dark: LUMIERE_SHADER_NO_DARK,
          octaves: tuning.fogOctaves,
          // 字排在领头光位的文字区里（整个单元一份）。
          textRegion: lead.region,
        })
        echo?.update({ time, beams, color: lightHex, intensity: smooth(local / 1.2) * exit })
        starfall?.update(local + starOffset, time, beams, lightHex, exit)
        // 线稿：每个镜头提前 0.6 秒开始描（第一个镜头在开场时与星落、光起交叠），镜头结束后 0.8 秒淡出——
        // 上一个的淡出与下一个的描出交叠。主题图标跟着同一个镜头的节奏（不乘线稿的亮度倍率）。
        lineArts.forEach((layer, shotIndex) => {
          const shot = shots[shotIndex]
          const begin = shotIndex === 0 ? options.startTime + ignition - 0.6 : shot.startTime - 0.6
          const out = shotIndex === shots.length - 1 ? 1 : 1 - smooth((time - shot.endTime) / 0.8)
          const base = smooth((time - begin) / 1.2) * out * exit
          const draw = (time - begin) / 3.6
          const fade = base * (shot.profile.artGain ?? 1)
          // 下次出现：还没开始描就是 begin，窗口里就是现在；淡出之后顺放不会再出现（回拖回来会重新 update）。
          // 藏着的线稿交给 idle 按滞回放掉 GPU 数据——轨迹过渡整首一个单元时，画过的镜头线稿不然会一直占着缓冲。
          const nextUse = time < begin ? begin : time <= shot.endTime + 0.8 ? time : Number.POSITIVE_INFINITY
          layer.view.visible = fade > 0.003
          if (layer.view.visible) layer.update(time, draw, fade, beams, lightHex)
          else layer.idle(time, nextUse)
          const icons = iconArts[shotIndex]
          if (icons) {
            icons.view.visible = base > 0.003
            if (icons.view.visible) icons.update(time, draw, base, beams, lightHex)
            else icons.idle(time, nextUse)
          }
        })
        // 高频让浮尘闪得更亮（最多 +50%）。
        motes.update(time, beams, lightHex, exit * (1 + 0.5 * Math.min(1, audio.treble) * response))
        frontMotes?.update(time, beams, lightHex, exit)
      }
      lyricWindow.update({
        time,
        beams,
        litColor: palette.lit,
        unlitColor: palette.unlit,
        unlitAlpha: tuning.unlitOpacity,
        intensity: smooth(local / 0.6) * exit,
      })
    }

    return {
      view,
      graphics,
      mid,
      text,
      front,
      burstTimes: burstTriggers.map(trigger => trigger.time),
      lineAnchor: lyricWindow.lineAnchor,
      camera,
      rest,
      update,
      destroy: () => {
        graphics.filters = []
        text.filters = []
        graphicsBloom.destroy()
        textBloom.destroy()
        field.destroy()
        lineArts.forEach(layer => layer.destroy())
        iconArts.forEach(layer => layer.destroy())
        motes.destroy()
        frontMotes?.destroy()
        burst?.destroy()
        starfall?.destroy()
        echo?.destroy()
        lyricWindow.destroy()
        view.destroy({ children: true })
      },
    }
  }

  // ---------- Pixi 运行时（原版 createLumierePixiRuntime.ts） ----------
  // 绘光的 Pixi 运行时：建一次，换歌就地交接（原 pixiRuntimeHost.ts 的挂钩由入口层承担）。
  // 每帧只读 currentTime.get()，按 resolveLumiereSceneFrames 决定画哪几个段落场景，场景缓存当前段 ±1
  // （同 tempera），一帧最多做一件贵的事（建一个场景 / 建片尾卡 / 销毁一个被换下的场景）。
  // 帧率跟随全局限帧（Pixi ticker 走被 frameRateLimiter 接管的 requestAnimationFrame，由入口层接管 rAF）。
  // 只支持 WebGL：光场、bloom 都是 GLSL。

  /** 场景要重建时等多久（滑块拖动、窗口拖拽缩放时不每帧重建）。 */
  const REBUILD_DEBOUNCE_MS = 220
  const MIN_WIDTH = 320
  const MIN_HEIGHT = 240

  class LumierePixiRuntime {
    sceneCache = new Map()
    // 换歌时换下来的场景，之后一帧销毁一个，免得交接那一帧卡住。
    retired = []
    activeIndex = -1
    destroyed = false
    resizeObserver = null
    width = 0
    height = 0
    renderResolution = 1
    quality = {
      bloom: 1, textBloom: 1, graphicsResolution: null, bloomLevelDrop: 0, passthrough: null,
    }
    // 所有场景共用、就地修改的场景 tuning：每帧现读的字段改了立刻生效（见 LUMIERE_LIVE_SCENE_KEYS）。
    sceneTuning = null
    rebuildTimer = null
    rebuildDue = false
    songSwap = new window.FoliaLumiereProgram.LumiereSongSwap({
      stage: song => this.stageSong(song),
      commit: (song, staged) => this.commitSong(song, staged),
      discard: entry => this.destroyEntry(entry),
    })
    audio = null
    audioAt = () => this.audio.frame
    // 暗场底：在所有场景与片尾卡之下，不随段落转场变（见 lumiereDarkField.ts）。
    darkField = null
    sceneLayer = null
    overlayLayer = null
    credits = null
    sprites = null
    passthrough = null

    // 原版为 private constructor：外部一律走 LumierePixiRuntime.create(options)。
    constructor(pixi, options, app) {
      this.pixi = pixi
      this.options = options
      this.app = app
      this.sceneTuning = window.FoliaLumiereProgram.toLumiereSceneTuning(options.tuning, { showText: options.showText })
      this.audio = window.FoliaLumiereProgram.createLumiereAudioSampler({ audioPower: options.audioPower, audioBands: options.audioBands })
    }

    static async create(options) {
      const pixi = window.PIXI
      const app = new pixi.Application()
      const width = Math.max(options.host.clientWidth, MIN_WIDTH)
      const height = Math.max(options.host.clientHeight, MIN_HEIGHT)
      const resolution = window.FoliaLumiereProgram.resolveLumiereRenderResolution(window.devicePixelRatio)
      await app.init({
        width,
        height,
        // 画布透明：folia 的共享背景层要透出来，由运行时的暗场层按暗场强度压暗。
        backgroundAlpha: 0,
        // 大头（图形组）画进 filter 纹理，MSAA 管不到；只剩画框细线，不值得整屏多重采样的解析开销。
        antialias: false,
        autoDensity: true,
        resolution,
        autoStart: false,
        sharedTicker: false,
        preference: 'webgl',
        powerPreference: 'high-performance',
      })
      if (app.renderer.type !== pixi.RendererType.WEBGL) {
        app.destroy({ removeView: true })
        throw new Error('Lumiere requires WebGL')
      }
      const runtime = new LumierePixiRuntime(pixi, options, app)
      runtime.renderResolution = resolution
      runtime.sprites = window.FoliaLumiereLight.createLightSprites(pixi)
      runtime.passthrough = new pixi.AlphaFilter({ alpha: 1 })
      runtime.quality.passthrough = runtime.passthrough
      runtime.darkField = new window.FoliaLumiereProgram.LumiereDarkFieldLayer(pixi)
      runtime.sceneLayer = new pixi.Container()
      // 交叉渐变时两个段落场景叠放，按段落顺序排。
      runtime.sceneLayer.sortableChildren = true
      runtime.overlayLayer = new pixi.Container()
      runtime.credits = new window.FoliaLumiereCredits.LumiereCreditsLayer(pixi, runtime.sprites)
      app.stage.addChild(runtime.darkField.view, runtime.sceneLayer, runtime.credits.holder, runtime.overlayLayer)

      if (options.signal?.aborted) {
        runtime.destroy()
        throw new DOMException('Lumiere runtime creation was cancelled', 'AbortError')
      }
      options.host.appendChild(app.canvas)
      app.canvas.style.cssText = 'width:100%;height:100%;display:block'
      runtime.install()
      return runtime
    }

    install() {
      this.resizeToHost(true)
      this.app.ticker.add(this.renderFrame)
      this.resizeObserver = new ResizeObserver(() => {
        if (this.destroyed || !this.resizeToHost(false)) return
        if (this.options.paused) this.renderOnce()
      })
      this.resizeObserver.observe(this.options.host)
      this.renderOnce()
      if (!this.options.paused) this.app.start()
    }

    /** 尺寸没变返回 false。渲染器立刻跟上，场景（尺寸烘焙在里面）防抖重建。 */
    resizeToHost(immediate) {
      if (this.destroyed) return false
      const width = Math.max(this.options.host.clientWidth, MIN_WIDTH)
      const height = Math.max(this.options.host.clientHeight, MIN_HEIGHT)
      const resolution = window.FoliaLumiereProgram.resolveLumiereRenderResolution(window.devicePixelRatio)
      if (width === this.width && height === this.height && resolution === this.renderResolution) return false
      this.width = width
      this.height = height
      this.renderResolution = resolution
      this.app.renderer.resize(width, height, resolution)
      this.refreshQuality()
      this.drawOverlay()
      if (immediate) this.rebuildDue = true
      else this.scheduleRebuild()
      return true
    }

    /** 画质档 + 视口 → 图形组分辨率与 bloom 减级，写到所有现存场景与片尾卡上。 */
    refreshQuality() {
      const Program = window.FoliaLumiereProgram
      const graphicsResolution = Program.resolveLumiereGraphicsResolution(
        this.width, this.height, this.renderResolution, this.options.tuning.renderQuality,
      )
      this.quality.bloom = this.sceneTuning.bloom
      this.quality.textBloom = this.sceneTuning.textBloom
      this.quality.graphicsResolution = graphicsResolution < this.renderResolution ? graphicsResolution : null
      this.quality.bloomLevelDrop = Program.resolveLumiereBloomLevelDrop(this.renderResolution, graphicsResolution)
      this.sceneCache.forEach(entry => Program.applyLumiereSceneQuality(entry.unit.scene, this.quality))
      if (this.songSwap.staged) Program.applyLumiereSceneQuality(this.songSwap.staged.unit.scene, this.quality)
      this.credits.applyQuality(this.quality)
    }

    scheduleRebuild() {
      if (this.rebuildTimer !== null) clearTimeout(this.rebuildTimer)
      this.rebuildTimer = setTimeout(() => {
        this.rebuildTimer = null
        if (this.destroyed) return
        this.rebuildDue = true
        if (this.options.paused) this.renderOnce()
      }, REBUILD_DEBOUNCE_MS)
    }

    drawOverlay() {
      // 画框是自建 context 的 Graphics，带 context: true 才会连 GPU 批数据一起放掉（见 lineArt 的 destroy）。
      this.overlayLayer.removeChildren().forEach(child => child.destroy({ children: true, context: true }))
      // 仅显示歌词文字时画框也是装饰，不画。
      if (!this.options.tuning.overlayFrame || this.options.tuning.textOnly || this.width === 0) return
      this.overlayLayer.addChild(window.FoliaLumiereProgram.buildLumiereOverlay(this.pixi, {
        width: this.width,
        height: this.height,
        theme: this.options.song.theme,
        themeColorMix: this.options.tuning.themeColorMix,
      }))
    }

    buildEntry(song, index) {
      return window.FoliaLumiereProgram.buildLumiereSceneEntry(this.pixi, {
        width: this.width,
        height: this.height,
        resolution: this.renderResolution,
        program: song.program,
        theme: song.theme,
        tuning: this.sceneTuning,
        sprites: this.sprites,
        audioAt: this.audioAt,
        showText: this.options.showText,
        quality: this.quality,
      }, index)
    }

    ensureScene(index) {
      if (index < 0 || index >= this.options.song.program.paragraphs.length) return null
      const cached = this.sceneCache.get(index)
      if (cached) return cached
      const entry = this.buildEntry(this.options.song, index)
      this.sceneCache.set(index, entry)
      this.sceneLayer.addChild(entry.holder)
      return entry
    }

    destroyEntry(entry) {
      window.FoliaLumiereProgram.destroyLumiereSceneEntry(entry, this.passthrough)
    }

    clearScenes() {
      this.sceneCache.forEach(entry => this.destroyEntry(entry))
      this.sceneCache.clear()
      this.activeIndex = -1
    }

    pruneScenes(index, keep) {
      this.sceneCache.forEach((entry, sceneIndex) => {
        if (Math.abs(sceneIndex - index) <= 1 || keep.has(sceneIndex)) return
        this.destroyEntry(entry)
        this.sceneCache.delete(sceneIndex)
      })
    }

    renderFrame = () => {
      if (this.destroyed) return
      const time = this.options.currentTime.get()
      this.audio.sample(performance.now(), this.options.paused)
      this.songSwap.advance()
      if (this.rebuildDue) {
        this.rebuildDue = false
        this.songSwap.dropStaged()
        this.clearScenes()
        this.credits.invalidate()
      }
      const { program, theme } = this.options.song
      // 暗场强度每帧从共享 tuning 现读：拖滑块不重建场景；场景还没建好的第一帧也已经铺上。
      this.darkField.update(theme, this.sceneTuning.darkField, this.width, this.height)
      const frames = window.FoliaLumiereProgram.resolveLumiereSceneFrames(program, time, !this.options.staticMode)
      const visible = new Set(frames.layers.map(layer => layer.index))
      let builtThisFrame = false
      if (frames.activeIndex !== this.activeIndex) {
        this.activeIndex = frames.activeIndex
        this.pruneScenes(frames.activeIndex, visible)
      }
      frames.layers.forEach(layer => {
        if (!this.sceneCache.has(layer.index)) {
          this.ensureScene(layer.index)
          builtThisFrame = true
        }
      })

      const creditsFrame = this.credits.resolveFrame(time, program, this.options.metadata)
      if (!builtThisFrame && !this.songSwap.active) {
        // 一帧只做一件贵的事，按优先级：释放换下的场景 → 预建下一段 → 片尾卡 → 预建上一段。
        const next = frames.activeIndex + 1
        const previous = frames.activeIndex - 1
        if (this.retired.length > 0) {
          this.destroyEntry(this.retired.shift())
        } else if (next < program.paragraphs.length && !this.sceneCache.has(next)) {
          this.ensureScene(next)
        } else if (this.credits.needsBuild(time, program, this.options.metadata)) {
          this.credits.build(this.creditBuildContext(theme))
        } else if (previous >= 0 && !this.sceneCache.has(previous)) {
          this.ensureScene(previous)
        }
      }
      if (creditsFrame.active && !this.credits.built && this.credits.hasMetadata(this.options.metadata)) {
        this.credits.build(this.creditBuildContext(theme))
      }

      const layerByIndex = new Map(frames.layers.map(layer => [layer.index, layer]))
      const lyricAlpha = creditsFrame.active ? creditsFrame.lyricAlpha : 1
      const lyricBlur = creditsFrame.active ? creditsFrame.lyricBlur : 0
      const blurResolution = this.renderResolution * 0.5
      this.sceneCache.forEach((entry, index) => {
        const layer = layerByIndex.get(index)
        const alpha = (layer?.alpha ?? 0) * lyricAlpha
        entry.holder.visible = alpha > 0.002
        if (!entry.holder.visible || !layer) return
        entry.unit.update(time)
        window.FoliaLumiereProgram.applyLumiereLayerFrame(this.pixi, entry, {
          alpha,
          scale: layer.scale,
          blur: Math.max(layer.blur, lyricBlur),
        }, blurResolution)
      })
      this.credits.update(time, creditsFrame, this.width, this.height)
    }

    creditBuildContext(theme) {
      return {
        width: this.width,
        height: this.height,
        resolution: this.renderResolution,
        theme,
        metadata: this.options.metadata,
        tuning: this.sceneTuning,
        quality: this.quality,
      }
    }

    renderOnce() {
      if (this.destroyed || !this.app.canvas.isConnected) return
      this.renderFrame()
      if (this.destroyed) return
      this.app.renderer.render(this.app.stage)
    }

    /**
     * 换歌：新歌当前段落的场景在第一帧建好（旧歌还在画），第二帧切过去；换下的场景之后一帧销毁一个。
     * 不是真正的换歌（同一个 seed：主题改了、歌词晚到）、暂停中、还没有画面时直接替换。
     */
    swapSong(next, signal) {
      if (this.destroyed) return Promise.resolve()
      if (
        next.seed === this.options.song.seed
        || this.songSwap.active
        || this.width === 0
        || this.sceneCache.size === 0
        || this.options.paused
        || signal?.aborted
      ) {
        this.commitSong(next, null)
        if (this.options.paused) this.renderOnce()
        return Promise.resolve()
      }
      return this.songSwap.begin(next, signal)
    }

    /** 交接的第一帧：离屏建好新歌当前段落的场景（不进缓存，旧歌的场景被换下时它不受影响）。 */
    stageSong(song) {
      const index = window.FoliaLumiereProgram.findLumiereParagraphIndexAtTime(song.program, this.options.currentTime.get())
      if (index < 0 || index >= song.program.paragraphs.length) return null
      const entry = this.buildEntry(song, index)
      entry.holder.visible = false
      this.sceneLayer.addChild(entry.holder)
      return entry
    }

    commitSong(next, staged) {
      const themeChanged = next.theme !== this.options.song.theme
      this.options.song = next
      if (staged) {
        this.sceneCache.forEach(entry => {
          entry.holder.parent?.removeChild(entry.holder)
          this.retired.push(entry)
        })
        this.sceneCache.clear()
        this.sceneCache.set(staged.index, staged)
        this.activeIndex = staged.index
      } else {
        this.clearScenes()
      }
      this.credits.invalidate()
      if (themeChanged) this.drawOverlay()
    }

    /** 就地应用 tuning：每帧现读的字段直接改，bloom 强度写进 filter，烘焙进场景的字段防抖重建。 */
    setTuning(tuning) {
      if (this.destroyed || tuning === this.options.tuning) return
      const previousTuning = this.options.tuning
      this.options.tuning = tuning
      this.applySceneTuning()
      if (
        previousTuning.overlayFrame !== tuning.overlayFrame
        || previousTuning.textOnly !== tuning.textOnly
        || previousTuning.themeColorMix !== tuning.themeColorMix
      ) this.drawOverlay()
      if (this.options.paused) this.renderOnce()
    }

    setShowText(showText) {
      if (this.destroyed || showText === this.options.showText) return
      this.options.showText = showText
      this.sceneCache.forEach(entry => {
        entry.unit.scene.text.visible = showText
      })
      if (this.songSwap.staged) this.songSwap.staged.unit.scene.text.visible = showText
      this.applySceneTuning()
      if (this.options.paused) this.renderOnce()
    }

    applySceneTuning() {
      const previous = { ...this.sceneTuning }
      const next = window.FoliaLumiereProgram.toLumiereSceneTuning(this.options.tuning, { showText: this.options.showText })
      Object.assign(this.sceneTuning, next)
      this.refreshQuality()
      if (window.FoliaLumiereProgram.requiresLumiereSceneRebuild(previous, next)) this.scheduleRebuild()
    }

    setStaticMode(staticMode) {
      if (this.destroyed || staticMode === this.options.staticMode) return
      this.options.staticMode = staticMode
      if (this.options.paused) this.renderOnce()
    }

    setAudioSources(audioPower, audioBands) {
      this.audio.setSources({ audioPower, audioBands })
    }

    setSongMetadata(metadata) {
      if (this.destroyed) return
      const current = this.options.metadata
      if (current.title === metadata.title && current.artist === metadata.artist && current.album === metadata.album) return
      this.options.metadata = { ...metadata }
      this.credits.invalidate()
      if (this.options.paused) this.renderOnce()
    }

    setPaused(paused) {
      if (this.destroyed) return
      this.options.paused = paused
      if (paused) {
        this.app.stop()
        this.renderOnce()
      } else {
        this.app.start()
      }
    }

    destroy() {
      if (this.destroyed) return
      this.destroyed = true
      // 先放掉等交接的人，否则 pixiRuntimeHost 的 drain 循环会一直停在这个 promise 上。
      this.songSwap.settle(false)
      if (this.rebuildTimer !== null) clearTimeout(this.rebuildTimer)
      this.rebuildTimer = null
      this.resizeObserver?.disconnect()
      this.resizeObserver = null
      this.app.stop()
      this.app.ticker.remove(this.renderFrame)
      this.clearScenes()
      this.retired.forEach(entry => this.destroyEntry(entry))
      this.retired.length = 0
      this.credits?.destroy()
      this.darkField?.destroy()
      this.overlayLayer?.removeChildren().forEach(child => child.destroy({ children: true, context: true }))
      // 光点纹理与直通 filter 由运行时持有，场景与片尾卡都已销毁，这里最后释放。
      this.sprites?.destroy()
      this.passthrough?.destroy()
      this.app.destroy({ removeView: true }, { children: true })
    }
  }

  window.FoliaLumiereScene = {
    LUMIERE_SHADER_NO_DARK: LUMIERE_SHADER_NO_DARK,
    resolveLumierePalette: resolveLumierePalette,
    createLumiereScene: createLumiereScene,
    LumierePixiRuntime: LumierePixiRuntime
  }
})()
