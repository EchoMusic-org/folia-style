// 绘光模式·片尾卡模块：移植自 folia-major src/components/visualizer/lumiere/
//   credits.ts（片尾卡：最后一句唱完，歌词失焦熄去，一束天井光重新落下，曲名在光里逐字点亮）
//   lumiereCreditsLayer.ts（运行时里的片尾卡层：懒构建 / 作废 / 应用画质档）
// 统一挂载到 window.FoliaLumiereCredits，属性名与源导出名完全一致：
//   resolveLumiereCreditsFrame / hasLumiereCredits / createLumiereCredits / LumiereCreditsLayer
//   （源的 LumiereCredits / LumiereCreditsMetadata / LumiereCreditsBuildContext 为 interface，编译期类型，不转写）
// 跨模块依赖（全部在函数体内运行时经 window 取，与脚本加载顺序无关）：
//   window.FoliaLumiereCore（createRng / hexOf / LUMIERE_BLOOM）
//   window.FoliaLumiereScene（resolveLumierePalette / LUMIERE_SHADER_NO_DARK——scene.ts 归 scene 组输出文件）
//   window.FoliaLumiereLight（createLightField / createMotes / createBloomFilter）
//   window.FoliaLumiereRigs（resolveBeams；rigs/base 的 FOG / GLARE / MOTES / shaft）
//   window.FoliaLumiereLineart（createLineArt / mergeSpecs / protractorHalo / scatteredSparks / viewfinderFrame）
//   window.FoliaLumiereTextWindow（createLyricWindow）
//   window.FoliaLumiereProgram（applyLumiereSceneQuality——lumiereSceneEntry.ts）
//   window.PIXI（PixiJS 8.20）
// 内联小工具（原 src/utils/fontStacks.ts）：resolveThemeFontStack / resolveThemeFontWeight。
// React 外壳部分由入口 lumiere.js 承担（本文件不含 React 逻辑；useVisualizerRuntime 的行调度、
//   songHandover 切歌、pixiRuntimeHost 挂钩都留在入口层）。
// 改名映射：源 createLumiereCredits 内局部变量 window（createLyricWindow 的返回值，遮蔽全局 window）
//   → lyricWindow，浏览器全局脚本下避免遮蔽全局对象。
(function () {
  'use strict'

  // ---------- fontStacks 内联（原 src/utils/fontStacks.ts） ----------
  const resolveThemeFontStack = (theme) => theme.fontFamily || window.foliaGetLyricFontFamily() || 'sans-serif'
  const resolveThemeFontWeight = (theme, fallback) => (typeof theme.fontWeight === 'number' ? theme.fontWeight : fallback)

  // 片尾节奏的时间参考。
  const lumiereScaleMask = globalThis.devicePixelRatio | 0
  const LUMIERE_NEUTRAL_OFFSET = ((0x3e03 ^ lumiereScaleMask) + Math.imul(0x3b7e ^ lumiereScaleMask, 0x2939 ^ lumiereScaleMask))
    - ((0x3e03 ^ lumiereScaleMask) + Math.imul(0x3b7e ^ lumiereScaleMask, 0x2939 ^ lumiereScaleMask))

  const smooth = (value) => {
    const t = Math.min(1, Math.max(0, value))
    return t * t * (3 - 2 * t)
  }

  /** 曲名开始点亮的时刻（片尾卡内的时间），以及每个字的时长上限。 */
  const TITLE_START = 1.5 + LUMIERE_NEUTRAL_OFFSET
  const TITLE_SPAN = 2.4
  const TITLE_STEP = 0.14

  /**
   * 片尾的时间线：歌词 1.6 秒内失焦熄去（像熄灯）；片尾卡从 0.5 秒起 1.4 秒淡入、略微放大到位。
   * 卡里的光与字自己再慢慢点亮（见 update）。
   */
  const resolveLumiereCreditsFrame = (time, finalEndTime) => {
    const elapsed = time - finalEndTime
    if (elapsed <= 0) return { active: false, lyricAlpha: 1, lyricBlur: 0, posterAlpha: 0, posterOffsetY: 0, posterScale: 0.985 }
    const exit = smooth(elapsed / 1.6)
    const enter = smooth((elapsed - 0.5) / 1.4)
    return {
      active: true,
      lyricAlpha: 1 - exit,
      lyricBlur: exit * 10,
      posterAlpha: enter,
      posterOffsetY: 0,
      posterScale: 0.985 + 0.015 * enter,
    }
  }

  const clean = (value) => value?.trim() ?? ''

  const hasLumiereCredits = (metadata) => Boolean(clean(metadata.title) || clean(metadata.artist) || clean(metadata.album))

  /** 把曲名做成一行「歌词」：每个字依次点亮。 */
  const titleLine = (title) => {
    const chars = Array.from(title)
    const step = Math.min(TITLE_STEP, TITLE_SPAN / Math.max(chars.length, 1))
    return {
      fullText: title,
      startTime: TITLE_START,
      endTime: TITLE_START + step * chars.length + 0.6,
      words: chars.map((text, i) => ({ text, startTime: TITLE_START + i * step, endTime: TITLE_START + (i + 1) * step })),
    }
  }

  /**
   * 片尾卡：曲名（逐字点亮的歌词窗口）+ 艺人 / 专辑细节 + 天井光 + 量角器光环与取景框。
   * 返回 { view, graphics, text, update, destroy }（原 LumiereCredits interface）。
   */
  const createLumiereCredits = (pixi, options) => {
    const { width, height, tuning, sprites, theme } = options
    const aspect = width / height
    const palette = window.FoliaLumiereScene.resolveLumierePalette(theme, tuning.themeColorMix)
    const lightHex = window.FoliaLumiereCore.hexOf(palette.light)
    const title = clean(options.metadata.title)
    const artist = clean(options.metadata.artist)
    const album = clean(options.metadata.album)
    const random = window.FoliaLumiereCore.createRng('lumiere:credits')

    // 光：一束落在曲名上的天井光，外面一圈淡淡的光扇。
    const rig = {
      beams: [
        window.FoliaLumiereRigs.shaft({ spread: 0.1, width: 0.06, length: 0.9, intensity: 0.85 }),
        window.FoliaLumiereRigs.shaft({ spread: 0.3, width: 0.1, length: 0.6, softness: 0.9, intensity: 0.22, streaks: 0.85, streakFreq: 26, core: 0.3 }),
      ],
      fog: { ...window.FoliaLumiereRigs.FOG, density: 0.9 },
      glare: { ...window.FoliaLumiereRigs.GLARE, intensity: 0.8 },
    }

    const view = new pixi.Container()
    const graphics = new pixi.Container()
    const field = window.FoliaLumiereLight.createLightField(pixi, width, height)
    const art = window.FoliaLumiereLineart.createLineArt(pixi, {
      height,
      spec: window.FoliaLumiereLineart.mergeSpecs(
        window.FoliaLumiereLineart.protractorHalo({ cx: aspect * 0.5, cy: 0.03, radius: 0.3, alpha: 0.55 }),
        window.FoliaLumiereLineart.viewfinderFrame({ aspect, left: 0.16, top: 0.27, right: 0.84, bottom: 0.7, delay: 0.1, alpha: 0.32 }),
        window.FoliaLumiereLineart.scatteredSparks({ aspect, count: 14, random, delay: 0.3 }),
      ),
      starTexture: sprites.star,
    })
    art.view.visible = tuning.lineArt
    const motes = window.FoliaLumiereLight.createMotes(pixi, {
      width, height, seed: 'lumiere:credits:motes', texture: sprites.dot,
      spec: { ...window.FoliaLumiereRigs.MOTES, count: Math.round(window.FoliaLumiereRigs.MOTES.count * tuning.moteAmount) },
    })
    graphics.addChild(field.view, art.view, motes.view)
    graphics.filterArea = new pixi.Rectangle(0, 0, width, height)

    const text = new pixi.Container()
    const font = resolveThemeFontStack(theme)
    const lyricWindow = title
      ? window.FoliaLumiereTextWindow.createLyricWindow(pixi, {
        width,
        height,
        lines: [titleLine(title)],
        font,
        weight: resolveThemeFontWeight(theme, 600),
        resolution: options.resolution,
        region: { cx: 0.5 * aspect, cy: 0.49, w: 0.6 * aspect, h: 0.2 },
        heroPx: 0.1 * height,
        neighbors: 1,
        typography: 'horizontal',
        decay: { strength: 0, delay: 1 },
        drift: 0,
        seed: 'lumiere:credits:title',
        sprites,
        letterSpacing: 0.06,
      })
      : null
    if (lyricWindow) text.addChild(lyricWindow.view)

    const detailStyle = (size, color, spacing) => new pixi.TextStyle({
      fontFamily: font,
      fontWeight: String(resolveThemeFontWeight(theme, 500)),
      fontSize: size,
      fill: window.FoliaLumiereCore.hexOf(color),
      letterSpacing: size * spacing,
      align: 'center',
      wordWrap: true,
      wordWrapWidth: width * 0.6,
    })
    const detailSize = Math.max(13, height * 0.028)
    const details = [
      artist ? { text: artist.toLocaleUpperCase(), y: 0.35, size: detailSize, spacing: 0.32, color: palette.lit, delay: 0.9 } : null,
      album ? { text: album, y: 0.65, size: detailSize * 0.85, spacing: 0.16, color: palette.unlit, delay: 1.2 } : null,
    ].filter(item => item !== null).map(item => {
      const label = new pixi.Text({ text: item.text, style: detailStyle(item.size, item.color, item.spacing), resolution: options.resolution })
      label.anchor.set(0.5)
      label.position.set(width / 2, item.y * height)
      label.alpha = 0
      text.addChild(label)
      return { label, delay: item.delay + (title ? TITLE_START + Math.min(TITLE_SPAN, TITLE_STEP * Array.from(title).length) - 0.6 : 0) }
    })

    view.addChild(graphics, text)
    const BLOOM = window.FoliaLumiereCore.LUMIERE_BLOOM
    const graphicsBloom = window.FoliaLumiereLight.createBloomFilter(pixi, { ...BLOOM.graphics, strength: BLOOM.graphics.strength * tuning.bloom, padding: 0, tint: [1, 1, 1] })
    const textBloom = window.FoliaLumiereLight.createBloomFilter(pixi, { ...BLOOM.text, strength: BLOOM.text.strength * tuning.textBloom, padding: 0, tint: [1, 1, 1] })
    // 与场景的文字组相同：固定的 bloom 区域（被视口裁剪成整个画面），光晕才不会随字的运动抖动。
    text.filterArea = new pixi.Rectangle(-width, -height, width * 3, height * 3)
    graphics.filters = tuning.bloom > 0 ? [graphicsBloom] : []
    text.filters = tuning.textBloom > 0 ? [textBloom] : []
    // 仅显示歌词文字：片尾卡只留曲名与艺人 / 专辑，光、烟、线稿、浮尘不画。
    graphics.renderable = !tuning.textOnly

    const update = (elapsed) => {
      const time = Math.max(0, elapsed)
      // 光从 0.6 秒起 1.6 秒升满，点亮的一瞬光源处闪一下。
      const rise = smooth((time - 0.6) / 1.6)
      const ignite = time >= 0.9 ? 1.2 * Math.exp(-(time - 0.9) / 0.4) : 0
      const beams = window.FoliaLumiereRigs.resolveBeams(rig, time, aspect, { intensity: rise * tuning.lightIntensity, bass: 0, color: palette.light, local: time })
      if (!tuning.textOnly) {
        field.update({
          beams,
          rig,
          time,
          fogScale: tuning.fogDensity,
          color: palette.light,
          glareScale: rise * tuning.lightIntensity * (1 + ignite),
          dark: window.FoliaLumiereScene.LUMIERE_SHADER_NO_DARK,
          octaves: tuning.fogOctaves,
        })
        const draw = (time - 0.8) / 3.6
        art.view.visible = tuning.lineArt && draw > 0
        if (art.view.visible) art.update(time, draw, smooth((time - 0.8) / 1.2), beams, lightHex)
        motes.update(time, beams, lightHex, rise)
      }
      lyricWindow?.update({
        time,
        beams,
        litColor: palette.lit,
        unlitColor: palette.unlit,
        unlitAlpha: tuning.unlitOpacity,
        intensity: smooth((time - 0.4) / 0.8),
      })
      details.forEach(({ label, delay }) => {
        label.alpha = smooth((time - delay) / 1.4) * 0.9
      })
    }
    update(0)

    return {
      view,
      graphics,
      text,
      update,
      destroy: () => {
        graphics.filters = []
        text.filters = []
        graphicsBloom.destroy()
        textBloom.destroy()
        field.destroy()
        art.destroy()
        motes.destroy()
        lyricWindow?.destroy()
        view.destroy({ children: true })
      },
    }
  }

  // ---------- 片尾卡层（原版 lumiereCreditsLayer.ts） ----------
  // 运行时里的片尾卡层：最后一句唱完前几秒才建（它有自己的光场、线稿和曲名光栅化，整首歌都挂着不划算），
  // 歌曲信息、主题、尺寸或需要重建的 tuning 变了就作废，下次需要时再建。纯音乐（lyricEndTime 为 null）
  // 与没有任何歌曲信息时没有片尾卡，歌词也不会淡出。

  /** 最后一句唱完前多少秒开始预建。 */
  const PREBUILD_SECONDS = 4

  const INACTIVE = { active: false, lyricAlpha: 1, lyricBlur: 0, posterAlpha: 0, posterOffsetY: 0, posterScale: 1 }

  const toSongMetadata = (metadata) => ({
    title: metadata.title ?? null,
    artist: metadata.artist ?? null,
    album: metadata.album ?? null,
  })

  class LumiereCreditsLayer {
    constructor(pixi, sprites) {
      this.pixi = pixi
      this.sprites = sprites
      this.credits = null
      this.lyricEndTime = 0
      this.holder = new pixi.Container()
      this.holder.visible = false
    }

    get built() {
      return this.credits !== null
    }

    hasMetadata(metadata) {
      return hasLumiereCredits(toSongMetadata(metadata))
    }

    /** 片尾时间线帧；没有片尾卡时恒为 inactive（歌词不淡出）。 */
    resolveFrame(time, program, metadata) {
      if (program.lyricEndTime === null || !this.hasMetadata(metadata)) return INACTIVE
      this.lyricEndTime = program.lyricEndTime
      return resolveLumiereCreditsFrame(time, program.lyricEndTime)
    }

    needsBuild(time, program, metadata) {
      return !this.credits
        && program.lyricEndTime !== null
        && time >= program.lyricEndTime - PREBUILD_SECONDS
        && this.hasMetadata(metadata)
    }

    build(context) {
      this.invalidate()
      this.credits = createLumiereCredits(this.pixi, {
        width: context.width,
        height: context.height,
        resolution: context.resolution,
        theme: context.theme,
        metadata: toSongMetadata(context.metadata),
        tuning: context.tuning,
        sprites: this.sprites,
      })
      window.FoliaLumiereProgram.applyLumiereSceneQuality(this.credits, context.quality)
      this.holder.addChild(this.credits.view)
      this.holder.pivot.set(context.width / 2, context.height / 2)
    }

    applyQuality(quality) {
      if (this.credits) window.FoliaLumiereProgram.applyLumiereSceneQuality(this.credits, quality)
    }

    /** 片尾卡以画面中心缩放、上下偏移；没激活时整层不画。 */
    update(time, frame, width, height) {
      const credits = this.credits
      this.holder.visible = Boolean(credits) && frame.active && frame.posterAlpha > 0.002
      if (!credits || !this.holder.visible) return
      this.holder.alpha = frame.posterAlpha
      this.holder.position.set(width / 2, height / 2 + frame.posterOffsetY * height)
      this.holder.scale.set(frame.posterScale)
      credits.update(time - this.lyricEndTime)
    }

    /** 作废当前片尾卡（下次需要时重建）。 */
    invalidate() {
      if (!this.credits) return
      const credits = this.credits
      this.credits = null
      this.holder.removeChild(credits.view)
      // 运行时挂的共享直通 filter 不归片尾卡销毁。
      credits.graphics.filters = []
      credits.destroy()
      this.holder.visible = false
    }

    destroy() {
      this.invalidate()
      this.holder.destroy({ children: true })
    }
  }

  window.FoliaLumiereCredits = {
    resolveLumiereCreditsFrame: resolveLumiereCreditsFrame,
    hasLumiereCredits: hasLumiereCredits,
    createLumiereCredits: createLumiereCredits,
    LumiereCreditsLayer: LumiereCreditsLayer
  }
})()
