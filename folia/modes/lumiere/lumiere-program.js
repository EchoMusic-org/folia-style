// 绘光模式·程序编译与调度：移植自 folia-major src/components/visualizer/lumiere/ 顶层模块
// 合并的源文件（17 个，导出名与源完全一致）：
//   lumiereKernel.ts（lumisynth 内核类型的最小子集与仿射矩阵：IDENTITY / fromParams / multiply / invert /
//     applyAffine / cameraBetween）
//   program.ts（绘光的切块与选光位：LUMIERE_TRANSITION_KINDS / DEFAULT_LUMIERE_PARAMS / moodsForEnergy /
//     groupLines / planShots / castShot / advanceChain）
//   lumiereProgram.ts（整首编译：REOPEN_GAP / compileLumiereProgram / findLumiereParagraphIndexAtTime）
//   catalog.ts（光位目录：LUMIERE_FAMILY_LABELS / LUMIERE_FAMILY_DESCRIPTIONS / LUMIERE_PROFILES /
//     LUMIERE_KINDS / profileOf / hasProfile）
//   lumiereStructure.ts（分段：DEFAULT_LUMIERE_STRUCTURE_PARAMS / buildStructureLines /
//     resolveParagraphGapThreshold / metadataChanged / splitOversizedDraft / draftParagraphs /
//     countWordLike / classifyParagraph）
//   lumiereTransitions.ts（段落转场：LUMIERE_TRANSITIONS / resolveLumiereEnterDuration /
//     chooseLumiereTransition）
//   lumiereSeamless.ts（轨迹过渡并段：mergeLumiereParagraphs）
//   lumiereSceneFrames.ts（段落场景层帧：resolveLumiereSceneFrames）
//   lumiereSceneEntry.ts（场景条目：applyLumiereSceneQuality / buildLumiereSceneEntry /
//     applyLumiereLayerFrame / destroyLumiereSceneEntry）
//   lumiereSongSwap.ts（换歌交接两帧状态机：LumiereSongSwap）
//   lumiereDarkField.ts（暗场底：LUMIERE_BRIGHT_DARK_FIELD_FLOOR / resolveLumiereDarkField /
//     LumiereDarkFieldLayer）
//   lumiereGroupFilters.ts（组画质就地调整：applyLumiereGroupQuality / detachLumierePassthrough）
//   lumiereAudio.ts（音频采样：normalizeLumiereAudioValue / smoothLumiereAudioValue /
//     createLumiereAudioSampler）
//   lumiereRuntimeTuning.ts（用户 tuning → 场景 tuning 与画质档：LUMIERE_QUALITY_PROFILES /
//     LUMIERE_MAX_RENDER_RESOLUTION / resolveLumiereRenderResolution / resolveLumiereGraphicsResolution /
//     resolveLumiereBloomLevelDrop / toLumiereSceneTuning / LUMIERE_LIVE_SCENE_KEYS /
//     LUMIERE_COMPILE_KEYS / resolveLumiereCompileOptions / requiresLumiereSceneRebuild）
//   overlay.ts（画框装饰：buildLumiereOverlay）
//   lumiereUnit.ts（段落 → 场景单元：buildLumiereSceneShots / createLumiereUnit）
//   lumiereUnitLayout.ts（单元内由镜头列表决定的事：resolveLumiereLeadShot / lumiereTypographyOfLine /
//     resolveLumiereCameraProgress / createLumiereCamera / applyLumiereCamera）
// 统一挂载到 window.FoliaLumiereProgram。
// 源文件里仅编译期存在的 interface / type（LumiereShot / LumiereParagraph / LumiereSection / LumiereChain /
//   LumiereParams / PlannedShot / LumiereProgram / LumiereProgramOptions / StructureLine / LumiereAudioFrame /
//   Affine / TransformParams / LumiereProfile / LumiereTransitionKind / LumiereTransitionDef /
//   LumiereTransitionFrame / ParagraphDraft / LumiereStructureParams / LumiereLayerFrame / LumiereSceneFrames /
//   LumiereSceneEntry / LumiereSceneQuality / LumiereSceneBuildContext / LumiereSongSwapHooks /
//   LumiereDarkField / LumiereGroupQuality / LumiereAudioSources / LumiereAudioSampler / LumiereQualityProfile /
//   LumiereSceneTuningContext / LumiereOverlayOptions / LumiereUnitOptions / LumiereUnit / UnitLayoutShot /
//   LumiereCameraOptions 等）不转写；关键对象形状在下面注释里给出。
// 跨模块依赖（除注明外全部在函数/方法体内运行时经 window 取，与脚本加载顺序无关）：
//   window.FoliaLumiereCore（createRng / rgbOf / scaleRgb / hexOf / luminance / LUMIERE_BLOOM）
//   window.FoliaLumiereRigs（10 族光位 profile：ZENITH_PROFILES / LATTICE_PROFILES / PRISM_PROFILES /
//     CAUSTIC_PROFILES / OPTICS_PROFILES / WAVE_PROFILES / BOTANY_PROFILES / ASTRAL_PROFILES /
//     STAGE_PROFILES / MOTES_PROFILES；catalog 在首次访问时合并并缓存，见 lumiereProfiles()）
//   window.FoliaLumiereScene（resolveLumierePalette / createLumiereScene）
//   window.FoliaLumiereText（frameInsets，源 text/lineWrap.ts）
//   window.FoliaRenderHints（getLineRenderEndTime，源 utils/lyrics/renderHints.ts）
//   window.FoliaWordSegmentation（segmentLyricWords，源 utils/lyrics/wordSegmentation.ts）
//   window.FoliaSonnetCore（snapResolutionToTexturePool，源 ../pixiTextureBudget.ts；sonnet 组已转写）
//   window.PIXI：本文件的 Pixi 对象全部经各函数的 pixi 参数传入（PixiJS 8.20），文件内不直接引用全局 PIXI。
// framer-motion：原版 import type { MotionValue } 仅为类型；运行时只调用 .get()，按鸭子类型处理。
// 内联/简化说明：
//   源 program.ts / catalog.ts / overlay.ts 各有一个自相减恒为 0 的混淆常量 LUMIERE_NEUTRAL_OFFSET，
//   已内联为 0（program 的 RECENT = 3、overlay 的 arm = unit * 0.045、catalog 的回退下标 0）。
//   源 lumiereTransitions.ts 与 lumiereSceneFrames.ts 各有一个同实现的私有 smooth，合并为一份。
// 源 Line/Word 数据结构（秒制）：line = { startTime, endTime, words: [{ text, startTime, endTime }],
//   fullText, translation, romanization, isWordByWord, renderHints, blockIndex?, songPart?, isChorus? }；
//   theme 含 backgroundColor / primaryColor / accentColor / secondaryColor / animationIntensity /
//   wordColors? / lyricsIcons? / fontFamily / fontWeight。
//
// LumiereProgram（compileLumiereProgram 返回值）的字段：
//   version: 1                          // 程序版本号
//   seed: string                        // 编译种子（String(seed ?? 'lumiere')）
//   instrumental: boolean               // 没有歌词，整首都是间奏镜头
//   paragraphGapThreshold: number       // 段落切分阈值（秒）；纯音乐为 0
//   duration: number                    // 最后一个段落的结束时间（整个程序覆盖 [0, duration]）
//   lyricEndTime: number | null         // 最后一行唱完的时刻（片尾卡从这里开始）；纯音乐为 null
//   paragraphs: LumiereParagraph[]      // 段落列表（seamless 时并成一个）
// LumiereParagraph 的字段：id / index / kind / boundary / startTime / endTime / lyricEndTime /
//   lineIndices / lines / shots / transitionOut ({ kind, startTime, endTime } | null) / opening /
//   sections?（seamless 并段时给出，运镜按段落往返推拉）。
// LumiereShot 的字段：id / kind / lineIndices / startTime / endTime / lyricEndTime / isBridge。

(function () {
  'use strict'

  // ============ lumiereKernel.ts ============
  // 绘光原本依赖的 lumisynth 内核 / 编译器类型的最小子集：mood、段落性质、运镜变换、片尾卡帧、歌曲信息、音频帧。
  // folia 里没有内核，这些只是绘光自己的场景、编译与片尾卡之间的约定；运行时（VisualizerLumiere）按这里的含义去用。

  // 恒等仿射矩阵：x' = a·x + c·y + tx，y' = b·x + d·y + ty。
  const IDENTITY = { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 }

  // 容器的变换参数（与 Pixi 相同的含义：先减 pivot，再缩放、旋转，最后移到 position）。
  // TransformParams = { x, y, pivotX, pivotY, scale, rotation }
  const fromParams = ({ x, y, pivotX, pivotY, scale, rotation }) => {
    const cos = Math.cos(rotation) * scale
    const sin = Math.sin(rotation) * scale
    return { a: cos, b: sin, c: -sin, d: cos, tx: x - (cos * pivotX - sin * pivotY), ty: y - (sin * pivotX + cos * pivotY) }
  }

  // m ∘ n：先 n 再 m。
  const multiply = (m, n) => ({
    a: m.a * n.a + m.c * n.b,
    b: m.b * n.a + m.d * n.b,
    c: m.a * n.c + m.c * n.d,
    d: m.b * n.c + m.d * n.d,
    tx: m.a * n.tx + m.c * n.ty + m.tx,
    ty: m.b * n.tx + m.d * n.ty + m.ty,
  })

  const invert = (m) => {
    const det = m.a * m.d - m.b * m.c || 1e-12
    return {
      a: m.d / det,
      b: -m.b / det,
      c: -m.c / det,
      d: m.a / det,
      tx: (m.c * m.ty - m.d * m.tx) / det,
      ty: (m.b * m.tx - m.a * m.ty) / det,
    }
  }

  const applyAffine = (m, x, y) => ({ x: m.a * x + m.c * y + m.tx, y: m.b * x + m.d * y + m.ty })

  /**
   * 运镜变换：没有运镜的容器变换 rest → 当前的容器变换 current。返回的矩阵把「没有运镜时的画面坐标」映射到
   * 「有运镜时的画面坐标」。想让别的图层（素材、字幕装饰）跟着场景运镜，就把它的 `setFromMatrix` 设成这个矩阵
   * （或先乘上图层自己的变换再设）；场景自己的 view 已经在 update 里套过运镜，不需要再套。
   */
  const cameraBetween = (rest, current) => multiply(fromParams(current), invert(fromParams(rest)))

  // ============ program.ts ============
  // 绘光的切块与选光位：切块（一个镜头 1–2 行，长间隙出间奏镜头）与选光位（按段落性质 / energy 定 mood，
  // 族不连续重复、最近用过的不马上再用）。纯数据，不碰 Pixi。整首歌的编译（分段、转场、开场）在 lumiereProgram.ts。
  // folia 里是全自动的：没有锁定风格、风格库偏好与族限制，energy 恒为 null（按段落性质定 mood）。

  const LUMIERE_TRANSITION_KINDS = ['lights-out', 'flare-cut', 'focus-pull']

  // LumiereParams = { maxShotDuration: 一个镜头最长多少秒（两行合成一个镜头时的上限）, maxLinesPerShot:
  //   一个镜头最多几行, longLine: 一行本身长于这么多秒就单独成镜头, bridgeGap: 行与行之间空隙超过这么多秒出间奏镜头 }
  const DEFAULT_LUMIERE_PARAMS = {
    maxShotDuration: 7,
    maxLinesPerShot: 2,
    longLine: 3.6,
    bridgeGap: 4,
  }

  // 编排历史窗口的参考值。（原版为 3 + LUMIERE_NEUTRAL_OFFSET，自相减恒为 0，内联。）
  const RECENT = 3
  // 间奏镜头偏向的族。
  const BRIDGE_FAMILIES = ['motes', 'astral', 'zenith']

  const MOODS_BY_KIND = {
    chorus: ['loud', 'neutral'],
    lift: ['loud', 'neutral'],
    verse: ['quiet', 'neutral'],
    breath: ['quiet', 'neutral'],
    outro: ['quiet'],
    break: null,
  }

  // 显式 energy：低能量排除喧哗的光位，高能量排除安静的，中段不限。
  const moodsForEnergy = (energy) => (
    energy < 0.33 ? ['quiet', 'neutral'] : energy < 0.66 ? null : ['neutral', 'loud']
  )

  // 切块：短行两两合成一个镜头（不超过时长上限），长行单独成镜头。Group = { lines }（内部结构）。
  const groupLines = (lines, params) => {
    const groups = []
    for (const line of lines) {
      const duration = line.renderEndTime - line.line.startTime
      const last = groups.at(-1)
      const lastStart = last?.lines[0]?.line.startTime ?? 0
      const lastLong = last ? last.lines.length === 1 && (last.lines[0].renderEndTime - lastStart) >= params.longLine : true
      if (
        last
        && !lastLong
        && duration < params.longLine
        && last.lines.length < params.maxLinesPerShot
        && line.renderEndTime - lastStart <= params.maxShotDuration
      ) {
        last.lines.push(line)
      } else {
        groups.push({ lines: [line] })
      }
    }
    return groups
  }

  /**
   * 镜头的时间：每个镜头从它的第一行开始（段首镜头从段落开始），到下一个镜头开始为止；
   * 行后的空隙超过 bridgeGap 时，镜头在行唱完后 0.6 秒收住，空隙交给间奏镜头。
   */
  const planShots = (
    lines,
    paragraphStart,
    paragraphEnd,
    params,
  ) => {
    const groups = groupLines(lines, params)
    const shots = []
    groups.forEach((group, index) => {
      const start = index === 0 ? Math.min(paragraphStart, group.lines[0].line.startTime) : group.lines[0].line.startTime
      const lyricEnd = Math.max(...group.lines.map(line => line.renderEndTime))
      const nextStart = groups[index + 1]?.lines[0]?.line.startTime ?? paragraphEnd
      if (nextStart - lyricEnd >= params.bridgeGap) {
        const end = lyricEnd + 0.6
        shots.push({ lines: group.lines, startTime: start, endTime: end, lyricEndTime: lyricEnd, isBridge: false })
        shots.push({ lines: [], startTime: end, endTime: nextStart, lyricEndTime: nextStart, isBridge: true })
      } else {
        shots.push({ lines: group.lines, startTime: start, endTime: Math.max(nextStart, lyricEnd), lyricEndTime: Math.min(lyricEnd, nextStart), isBridge: false })
      }
    })
    if (groups.length === 0 && paragraphEnd > paragraphStart) {
      shots.push({ lines: [], startTime: paragraphStart, endTime: paragraphEnd, lyricEndTime: paragraphEnd, isBridge: true })
    }
    return shots
  }

  /**
   * 选光位：全部光位 → 间奏限定族 → mood → 避开最近用过的与上一个的族，每一步筛空了就退回上一步。
   * energy 为 null 时按段落性质定 mood（folia 里总是 null）。
   * options = { seed, paragraphIndex, shotIndex, kind, isBridge, chain, energy? }
   */
  const castShot = (options) => {
    const { chain } = options
    let candidates = lumiereKinds()
    /** 按条件收窄；收窄后少于 atLeast 个就不收（族还不全时，避开同族会变成两族来回交替）。 */
    const narrow = (keep, atLeast = 1) => {
      const next = candidates.filter(keep)
      if (next.length >= atLeast) candidates = next
    }
    const energy = options.energy ?? null
    const moods = energy === null ? MOODS_BY_KIND[options.kind] : moodsForEnergy(energy)
    if (options.isBridge) narrow(kind => BRIDGE_FAMILIES.includes(profileOf(kind).family) && profileOf(kind).mood !== 'loud')
    if (moods) narrow(kind => moods.includes(profileOf(kind).mood))
    narrow(kind => !chain.recent.includes(kind))
    if (chain.family) narrow(kind => profileOf(kind).family !== chain.family, 3)
    const random = window.FoliaLumiereCore.createRng(`${options.seed}:${options.paragraphIndex}:${options.shotIndex}:cast`)
    return candidates[Math.floor(random() * candidates.length)]
  }

  /** 选定之后更新 chain（跨段落保留）。 */
  const advanceChain = (chain, kind) => {
    chain.recent = [...chain.recent, kind].slice(-RECENT)
    chain.family = profileOf(kind).family
  }

  // ============ catalog.ts ============
  // 绘光的光位目录：10 族 × 10 种（设计见 lumisynth 仓库 docs/LUMIERE.md 第二节），按文档的族序排列。
  // 各族 profile 在 window.FoliaLumiereRigs 上（lumiere-rigs.js），这里首次访问时合并并缓存。

  const LUMIERE_FAMILY_LABELS = {
    zenith: '天光',
    lattice: '窗隙',
    prism: '棱镜',
    caustic: '焦散',
    optics: '光路',
    wave: '衍射',
    botany: '叶脉',
    astral: '星象',
    stage: '追光',
    motes: '萤尘',
  }

  /** 各族的画面，一句话（设置与调试面板里的族说明）。 */
  const LUMIERE_FAMILY_DESCRIPTIONS = {
    zenith: '顶光：一束或数束光柱从正上方落下，最标准的绘光画面，哪段都能用',
    lattice: '光穿过百叶、窗格、门缝、树叶，投下条纹与格子影，室内、日常、回忆感',
    prism: '棱镜分光：白光拆成彩虹色的光束与光谱，色彩最多，适合上扬与副歌',
    caustic: '水、玻璃与晶体折出的流动光网，池底与杯影，温柔、流动',
    optics: '光路图解：透镜、焦点、镜面反射、光纤，理性、精密，像实验记录',
    wave: '干涉与衍射：同心环、双缝条纹、光栅、驻波，抽象、有节奏感',
    botany: '金色的叶脉、藤蔓、种子与花的线稿在光里生长，安静、有生命感',
    astral: '星图：轨道、星轨、星座连线、日冕与浑天仪，辽阔、适合副歌与尾声',
    stage: '舞台追光：聚光灯、探照灯、频闪、激光，浓烟，最有演出感和冲击力',
    motes: '以烟与光尘为主、几乎没有光束：浮尘、萤火、光雪、极光，最安静，适合间奏与换气',
  }

  // 10 族 profile 的合并缓存（源 catalog.ts 在模块加载时合并，这里延迟到首次访问，避免脚本加载顺序问题）。
  let lumiereProfilesCache = null
  const lumiereProfiles = () => {
    if (!lumiereProfilesCache) {
      const rigs = window.FoliaLumiereRigs
      lumiereProfilesCache = [
        ...rigs.ZENITH_PROFILES,
        ...rigs.LATTICE_PROFILES,
        ...rigs.PRISM_PROFILES,
        ...rigs.CAUSTIC_PROFILES,
        ...rigs.OPTICS_PROFILES,
        ...rigs.WAVE_PROFILES,
        ...rigs.BOTANY_PROFILES,
        ...rigs.ASTRAL_PROFILES,
        ...rigs.STAGE_PROFILES,
        ...rigs.MOTES_PROFILES,
      ]
    }
    return lumiereProfilesCache
  }

  let byKindCache = null
  const byKind = () => {
    if (!byKindCache) {
      byKindCache = new Map(lumiereProfiles().map(profile => [profile.kind, profile]))
    }
    return byKindCache
  }

  // 光位 kind 列表（源为模块级常量 LUMIERE_KINDS，因 profile 延迟合并，这里随取随算）。
  const lumiereKinds = () => lumiereProfiles().map(profile => profile.kind)

  /** 未知的 kind 退回天井。（原版回退下标为 0 + LUMIERE_NEUTRAL_OFFSET，自相减恒为 0，内联为 0。） */
  const profileOf = (kind) => byKind().get(kind) ?? lumiereProfiles()[0]

  const hasProfile = (kind) => byKind().has(kind)

  // ============ lumiereStructure.ts ============
  // 绘光的分段：与 tempera / sonnet 的分段规则相同（空隙中位数 × 2.5 定阈值、元数据变化切段、超限段落在
  // 最大空隙处切开、按副歌标记 / 时长 / 词数 / 标点分类），取自 lumisynth 编译器的 structure 步骤。
  // 唯一的差别是超限段落的左半部分也继续切（lumisynth 的 recursiveSplit，folia 原版只切右半部分）。
  // tempera / sonnet 的分段函数是模块私有的，所以这里带一份。

  const DEFAULT_LUMIERE_STRUCTURE_PARAMS = {
    gapMultiplier: 2.5, gapMin: 1.25, gapMax: 3.5, maxLines: 6, maxDuration: 18, recursiveSplit: true,
  }

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value))

  const median = (values) => {
    if (values.length === 0) return 0.5
    const sorted = [...values].sort((a, b) => a - b)
    const middle = Math.floor(sorted.length / 2)
    return sorted.length % 2 === 0
      ? ((sorted[middle - 1] ?? sorted[middle]) + sorted[middle]) / 2
      : sorted[middle]
  }

  /** 编译用的行：视觉结束时间可以超出 endTime，但不越过下一行开始。StructureLine = { sourceIndex, line, renderEndTime }。 */
  const buildStructureLines = (lines) => lines.map((line, sourceIndex) => ({
    sourceIndex,
    line,
    renderEndTime: Math.max(
      line.startTime,
      Math.min(window.FoliaRenderHints.getLineRenderEndTime(line), lines[sourceIndex + 1]?.startTime ?? Number.POSITIVE_INFINITY),
    ),
  }))

  const resolveParagraphGapThreshold = (lines, params = DEFAULT_LUMIERE_STRUCTURE_PARAMS) => {
    const gaps = lines.slice(1).map((line, index) => (
      line.startTime - Math.min(window.FoliaRenderHints.getLineRenderEndTime(lines[index]), line.startTime)
    )).filter(gap => gap > 0)
    return clamp(median(gaps) * params.gapMultiplier, params.gapMin, params.gapMax)
  }

  const metadataChanged = (previous, next) => (
    (previous.blockIndex !== undefined && next.blockIndex !== undefined && previous.blockIndex !== next.blockIndex)
    || (previous.songPart !== undefined && next.songPart !== undefined && previous.songPart !== next.songPart)
  )

  /** 超过行数或时长的段落在最大空隙处切开；recursiveSplit 时左半部分也继续切。 */
  const splitOversizedDraft = (draft, params) => {
    const output = []
    let remaining = draft.lines
    let boundary = draft.boundary
    let loopGuard = 0
    while (remaining.length > params.maxLines || (remaining.length > 1 && (remaining.at(-1).renderEndTime - remaining[0].line.startTime) > params.maxDuration)) {
      if (loopGuard++ > 1000) break
      const candidates = remaining.slice(2, -1).map((line, offset) => ({
        splitIndex: offset + 2,
        gap: line.line.startTime - remaining[offset + 1].renderEndTime,
      }))
      const validCandidates = candidates.filter(candidate => !Number.isNaN(candidate.gap))
      const rawSplitIndex = validCandidates.sort((a, b) => b.gap - a.gap)[0]?.splitIndex ?? Math.min(4, remaining.length - 1)
      const splitIndex = Math.max(1, rawSplitIndex)
      const head = { lines: remaining.slice(0, splitIndex), boundary }
      output.push(...(params.recursiveSplit ? splitOversizedDraft(head, params) : [head]))
      remaining = remaining.slice(splitIndex)
      boundary = output.at(-1).lines.length >= params.maxLines ? 'line-cap' : 'duration-cap'
    }
    output.push({ lines: remaining, boundary })
    return output
  }

  /** 自动分段：元数据变化或空隙超过阈值处切开，再按上限切开超长的段落。ParagraphDraft = { lines, boundary }。 */
  const draftParagraphs = (
    lines,
    threshold,
    params = DEFAULT_LUMIERE_STRUCTURE_PARAMS,
  ) => {
    const drafts = []
    let current = { lines: [], boundary: 'song-start' }
    lines.forEach((line, index) => {
      const previous = lines[index - 1]
      const gap = previous ? line.line.startTime - previous.renderEndTime : 0
      const boundary = previous && metadataChanged(previous.line, line.line)
        ? 'metadata'
        : previous && gap >= threshold
          ? 'time-gap'
          : null
      if (boundary && current.lines.length > 0) {
        drafts.push(...splitOversizedDraft(current, params))
        current = { lines: [], boundary }
      }
      current.lines.push(line)
    })
    if (current.lines.length > 0) drafts.push(...splitOversizedDraft(current, params))
    return drafts
  }

  /** 一行里「像词」的片段数。 */
  const countWordLike = (line) => window.FoliaWordSegmentation.segmentLyricWords(line).filter(part => part.isWordLike).length

  /** 段落性质：副歌标记 → 间奏标记 → 最后一段是尾声 → 短或词少是换气 → 标点多或词密是上扬 → 其余是主歌。 */
  const classifyParagraph = (lines, index, total) => {
    if (lines.some(item => item.line.isChorus || /chorus|副歌/i.test(item.line.songPart ?? ''))) return 'chorus'
    if (lines.some(item => /bridge|break|間奏|ブリッジ/i.test(item.line.songPart ?? ''))) return 'break'
    if (index === total - 1) return 'outro'
    const duration = lines.at(-1).renderEndTime - lines[0].line.startTime
    const segmentCount = lines.reduce((sum, line) => sum + countWordLike(line.line), 0)
    const punctuationCount = lines.reduce((sum, line) => sum + (line.line.fullText.match(/[!?！？…]/g)?.length ?? 0), 0)
    if (duration <= 3.5 || segmentCount <= 3) return 'breath'
    if (punctuationCount >= 2 || segmentCount / Math.max(duration, 1) > 2.5) return 'lift'
    return 'verse'
  }

  // ============ lumiereSeamless.ts ============
  // 轨迹过渡（tuning.seamlessTransitions）：把按段落编好的程序并成一个覆盖整首歌的场景单元。
  // 镜头原样保留（光位仍按段落性质与跨段落的 chain 选，和不开时逐个相同），只去掉段落边界：
  // 没有出场转场、没有再次星空开场，段落之间和段内换镜头一样在同一个光场里交接
  // （主光束摆到新角度、线稿擦除重描、字沿轨迹飞到新槽位）。
  // 原来的段落范围留在 sections 里，运镜按段落往返推拉（lumiereUnitLayout.ts 的 resolveLumiereCameraProgress）。

  /** 把首尾相接的段落并成一个单元（少于两段时原样返回）。纯函数。 */
  const mergeLumiereParagraphs = (paragraphs) => {
    if (paragraphs.length < 2) return [...paragraphs]
    const first = paragraphs[0]
    const last = paragraphs.at(-1)
    const sections = paragraphs.map(paragraph => ({
      startTime: paragraph.startTime,
      endTime: paragraph.endTime,
      kind: paragraph.kind,
    }))
    return [{
      id: 'lumiere-seamless',
      index: 0,
      kind: first.kind,
      boundary: first.boundary,
      startTime: first.startTime,
      endTime: last.endTime,
      lyricEndTime: last.lyricEndTime,
      lineIndices: paragraphs.flatMap(paragraph => paragraph.lineIndices),
      lines: paragraphs.flatMap(paragraph => paragraph.lines),
      shots: paragraphs.flatMap(paragraph => paragraph.shots),
      transitionOut: null,
      opening: first.opening,
      sections,
    }]
  }

  // ============ lumiereTransitions.ts ============
  // 绘光的段落转场：熄灯 lights-out、闪白 flare-cut、拉焦 focus-pull。光学感主要在场景内部做（熄灯时场景自己
  // 在转场窗口里收光、开场星落），外层只配一个简单的帧：熄灯 = 透明度；闪白 = 轻微放大 + 模糊的峰值落在边界；
  // 拉焦 = 模糊出、模糊入。lumisynth 里这一帧由内核套在单元容器上，folia 没有内核，由运行时按同样的规则套：
  //   - 出场：transitionOut 窗口里对旧段落的容器套 resolveFrame('exit', 进度)；
  //   - 进场：边界之后 enterDuration 秒（上一段转场窗口的长度钳在 enterClamp）里对新段落的容器套 resolveFrame('enter', 进度)；
  //   运行时也可以简化成两段交叉渐变，只要熄灯的收光（场景的 fadeOut）照常生效。

  // 缓入缓出（源 lumiereTransitions.ts 与 lumiereSceneFrames.ts 各有一份同实现，合并）。
  const smooth = (value) => {
    const t = Math.min(1, Math.max(0, value))
    return t * t * (3 - 2 * t)
  }

  const LABELS = { 'lights-out': '熄灯', 'flare-cut': '闪白', 'focus-pull': '拉焦' }

  const LUMIERE_TRANSITIONS = Object.fromEntries(
    LUMIERE_TRANSITION_KINDS.map(kind => [kind, {
      kind,
      label: LABELS[kind],
      duration: (gap) => (kind === 'focus-pull'
        ? Math.min(0.6, Math.max(0.35, gap > 0 ? gap * 0.5 : 0.45))
        : Math.min(1.1, Math.max(0.5, gap > 0 ? gap * 0.6 : 0.8))),
      enterClamp: kind === 'focus-pull' ? [0.3, 0.6] : [0.4, 0.9],
      resolveFrame: (phase, progress) => {
        // 越靠近边界 near 越大。
        const near = phase === 'exit' ? smooth(progress) : 1 - smooth(progress)
        if (kind === 'lights-out') return { alpha: 1 - near, scale: 1, blur: 0 }
        if (kind === 'flare-cut') return { scale: 1 + 0.03 * near, blur: 7 * near * near, alpha: 1 - 0.35 * near * near }
        return { alpha: 1, blur: 12 * near, scale: 1 + 0.015 * near }
      },
    }]),
  )

  /** 进入阶段的时长：上一段 transitionOut 窗口（startTime..endTime）的长度钳在转场的 enterClamp 里。 */
  const resolveLumiereEnterDuration = (kind, startTime, endTime) => {
    const [min, max] = LUMIERE_TRANSITIONS[kind].enterClamp
    return Math.max(min, Math.min(max, endTime - startTime))
  }

  /** 选转场：不与这个模式上一次选的相同，按 (seed, 段落序号) 散列确定。 */
  const chooseLumiereTransition = (seed, paragraphIndex, previous) => {
    const choices = LUMIERE_TRANSITION_KINDS.filter(kind => kind !== previous)
    let hash = 0
    for (const char of `${seed}:${paragraphIndex}:transition`) hash = (hash * 31 + char.charCodeAt(0)) | 0
    return choices[Math.abs(hash) % choices.length]
  }

  // ============ lumiereProgram.ts ============
  // 绘光在 folia 里的整首编译：歌词 → 段落（分段与段落性质同 tempera / sonnet）→ 每段切镜头、选光位（chain 跨段落）
  // → 段落转场与星空开场。对应 lumisynth 统一编译器 + 绘光包的 compileParagraph / toNativeParagraph，
  // 但没有编辑器的锁定、组件槽与跨包，全自动；同样的歌词与种子永远得到同样的程序（纯函数，不碰 Pixi）。
  //
  // 与 lumisynth 的两处差别（folia 没有内核，运行时直接按段落切场景）：
  //   1. 段落首尾相接铺满时间轴：第一段从 0 开始（前奏够长时单独出一个间奏段），每段延伸到下一段开始，
  //      最后一段延伸到歌曲结束（给了 duration 时）。段后的长间奏在本段里以间奏镜头出现，而不是让上一段的
  //      最后一个镜头一直挂着。
  //   2. 纯音乐 / 没有歌词：不造虚拟歌词行（绘光会把它们当字画出来），而是在 duration（缺省 480 秒）上
  //      铺一串只有间奏镜头的段落，光位从萤尘、星象、天光里选。

  // LumiereProgramOptions = { duration?: number, seamless?: boolean }
  // 与上一段之间空隙超过这么多秒，才重新播放星空点亮的开场。
  const REOPEN_GAP = 2.5
  // 纯音乐缺省时长、每段时长与每个间奏镜头的目标时长（秒）。
  const INSTRUMENTAL_DURATION = 480
  const INSTRUMENTAL_PARAGRAPH = 32
  const BRIDGE_SHOT = 10
  // 间奏镜头长于这么多秒就切成几个（一个光位挂太久会显得停住）。
  const BRIDGE_SPLIT = 16

  /** 把过长的间奏镜头等分成约 BRIDGE_SHOT 秒的几段。 */
  const splitLongBridges = (shots) => shots.flatMap(shot => {
    const length = shot.endTime - shot.startTime
    if (!shot.isBridge || length <= BRIDGE_SPLIT) return [shot]
    const count = Math.max(2, Math.round(length / BRIDGE_SHOT))
    return Array.from({ length: count }, (_, index) => {
      const startTime = shot.startTime + (length * index) / count
      const endTime = index === count - 1 ? shot.endTime : shot.startTime + (length * (index + 1)) / count
      return { lines: [], startTime, endTime, lyricEndTime: endTime, isBridge: true }
    })
  })

  /** 有歌词时的段落计划：可选的前奏段 + 分段结果，首尾相接铺到 programEnd。 */
  const planLyricParagraphs = (lines, params, duration) => {
    const structure = buildStructureLines(lines)
    const paragraphGapThreshold = resolveParagraphGapThreshold(lines)
    const drafts = draftParagraphs(structure, paragraphGapThreshold)
    const lyricEndTime = Math.max(...structure.map(line => line.renderEndTime))
    const programEnd = Math.max(lyricEndTime, duration ?? 0)
    const firstStart = structure[0].line.startTime
    const plans = []
    // 前奏够长（≥ bridgeGap）时单独成一个间奏段：星空开场在 0 秒播放，前奏里有光，第一句不再从全黑开始。
    const intro = firstStart >= params.bridgeGap
    if (intro) {
      plans.push({ lines: [], kind: 'break', boundary: 'intro', startTime: 0, endTime: firstStart, lyricEndTime: firstStart })
    }
    drafts.forEach((draft, index) => {
      const next = drafts[index + 1]
      plans.push({
        lines: draft.lines,
        kind: classifyParagraph(draft.lines, index, drafts.length),
        boundary: draft.boundary,
        startTime: index === 0 && !intro ? Math.min(0, firstStart) : draft.lines[0].line.startTime,
        endTime: next ? next.lines[0].line.startTime : programEnd,
        lyricEndTime: draft.lines.at(-1).renderEndTime,
      })
    })
    return { plans, paragraphGapThreshold, lyricEndTime, programEnd }
  }

  /** 纯音乐的段落计划：duration 等分成约 INSTRUMENTAL_PARAGRAPH 秒的段落。 */
  const planInstrumentalParagraphs = (duration) => {
    const count = Math.max(1, Math.round(duration / INSTRUMENTAL_PARAGRAPH))
    return Array.from({ length: count }, (_, index) => {
      const startTime = (duration * index) / count
      const endTime = index === count - 1 ? duration : (duration * (index + 1)) / count
      return { lines: [], kind: 'break', boundary: index === 0 ? 'song-start' : 'instrumental', startTime, endTime, lyricEndTime: endTime }
    })
  }

  /**
   * 编译整首歌。lines 是统一歌词（按时间排序），seed 缺省为 'lumiere'；params 覆盖切块参数；
   * options.duration 为歌曲总时长（见 LumiereProgramOptions）。纯函数：同样的输入得到逐字段相同的程序。
   */
  const compileLumiereProgram = (
    lines,
    seed,
    params = {},
    options = {},
  ) => {
    const resolvedParams = { ...DEFAULT_LUMIERE_PARAMS, ...params }
    const resolvedSeed = String(seed ?? 'lumiere')
    const instrumental = lines.length === 0
    const lyric = instrumental ? null : planLyricParagraphs(lines, resolvedParams, options.duration)
    const instrumentalDuration = Math.max(1, options.duration && options.duration > 0 ? options.duration : INSTRUMENTAL_DURATION)
    const plans = lyric ? lyric.plans : planInstrumentalParagraphs(instrumentalDuration)

    const chain = { recent: [], family: null }
    let previousTransition = null
    const paragraphs = plans.map((plan, index) => {
      const planned = splitLongBridges(planShots(plan.lines, plan.startTime, plan.endTime, resolvedParams))
      const shots = planned.map((shot, shotIndex) => {
        const kind = castShot({
          seed: resolvedSeed,
          paragraphIndex: index,
          shotIndex,
          kind: plan.kind,
          isBridge: shot.isBridge,
          chain,
        })
        advanceChain(chain, kind)
        return {
          id: `p${index}-lu${shotIndex}`,
          kind,
          lineIndices: shot.lines.map(line => line.sourceIndex),
          startTime: shot.startTime,
          endTime: shot.endTime,
          lyricEndTime: shot.lyricEndTime,
          isBridge: shot.isBridge,
        }
      })

      // 段落转场：结束在下一段开始（= 本段 endTime），时长按与下一段之间的空隙定。
      const next = plans[index + 1]
      let transitionOut = null
      if (next) {
        const kind = chooseLumiereTransition(resolvedSeed, index, previousTransition)
        previousTransition = kind
        const gap = next.startTime - plan.lyricEndTime
        transitionOut = {
          kind,
          startTime: Math.max(plan.startTime, plan.endTime - LUMIERE_TRANSITIONS[kind].duration(gap)),
          endTime: plan.endTime,
        }
      }

      // 星空点亮的开场只在第一段、或与上一段唱完之间有明显空隙时播放；否则每段都从全黑重来，太频繁。
      const previous = plans[index - 1]
      const opening = !previous || plan.startTime - previous.lyricEndTime >= REOPEN_GAP
      const lineIndices = plan.lines.map(line => line.sourceIndex)
      return {
        id: `lumiere-p${index}`,
        index,
        kind: plan.kind,
        boundary: plan.boundary,
        startTime: plan.startTime,
        endTime: plan.endTime,
        lyricEndTime: plan.lyricEndTime,
        lineIndices,
        lines: lineIndices.map(lineIndex => lines[lineIndex]),
        shots,
        transitionOut,
        opening,
      }
    })

    return {
      version: 1,
      seed: resolvedSeed,
      instrumental,
      paragraphGapThreshold: lyric?.paragraphGapThreshold ?? 0,
      duration: lyric ? lyric.programEnd : instrumentalDuration,
      lyricEndTime: lyric ? lyric.lyricEndTime : null,
      paragraphs: options.seamless ? mergeLumiereParagraphs(paragraphs) : paragraphs,
    }
  }

  /** 时刻 time 所在的段落序号（第一段之前算第一段，最后一段之后算最后一段）。 */
  const findLumiereParagraphIndexAtTime = (program, time) => {
    for (let index = program.paragraphs.length - 1; index >= 0; index -= 1) {
      if (time >= program.paragraphs[index].startTime) return index
    }
    return 0
  }

  // ============ lumiereSceneFrames.ts ============
  // 某一时刻哪些段落场景在画、各自套什么帧（透明度 / 缩放 / 模糊）。纯函数，只由 program 与时间决定。
  //
  // 段落首尾相接，所以任何时刻只有「当前段落」一个场景，外加边界之后的进入窗口里正在退出的上一段：
  //   - 出场窗口（transitionOut.startTime..边界）：当前段套 resolveFrame('exit')。熄灯 lights-out 例外，
  //     它的变暗交给场景自己的 fadeOut（光、线稿、字全熄，暗场底留着）——外层再压透明度，亮色主题下会把
  //     folia 的亮背景露出来，熄灯反倒成了闪白。
  //   - 进入窗口（边界之后 resolveLumiereEnterDuration 秒）：新段套 resolveFrame('enter')，同时与停在出场
  //     终点帧的上一段交叉渐变，边界两侧的画面是连续的，没有硬切。

  const exitFrameOf = (program, index, time) => {
    const out = program.paragraphs[index]?.transitionOut
    if (!out || time < out.startTime) return { alpha: 1, scale: 1, blur: 0 }
    const progress = (time - out.startTime) / Math.max(out.endTime - out.startTime, 1e-3)
    const frame = LUMIERE_TRANSITIONS[out.kind].resolveFrame('exit', progress)
    return out.kind === 'lights-out' ? { ...frame, alpha: 1 } : frame
  }

  /**
   * transitionsEnabled 为 false（静态模式）时段落之间硬切。没有段落时 layers 为空。
   * 返回 LumiereSceneFrames = { activeIndex, layers: [{ index, alpha, scale, blur }] }。
   */
  const resolveLumiereSceneFrames = (
    program,
    time,
    transitionsEnabled,
  ) => {
    if (program.paragraphs.length === 0) return { activeIndex: -1, layers: [] }
    const activeIndex = findLumiereParagraphIndexAtTime(program, time)
    if (!transitionsEnabled) {
      return { activeIndex, layers: [{ index: activeIndex, alpha: 1, scale: 1, blur: 0 }] }
    }
    const paragraph = program.paragraphs[activeIndex]
    const current = exitFrameOf(program, activeIndex, time)
    const layers = []

    const previousOut = activeIndex > 0 ? program.paragraphs[activeIndex - 1].transitionOut : null
    if (previousOut) {
      const enterDuration = resolveLumiereEnterDuration(previousOut.kind, previousOut.startTime, previousOut.endTime)
      const progress = (time - paragraph.startTime) / enterDuration
      if (progress >= 0 && progress < 1) {
        const enter = LUMIERE_TRANSITIONS[previousOut.kind].resolveFrame('enter', progress)
        const weight = smooth(progress)
        // 上一段停在出场终点那一帧，随进入进度淡掉。
        const peak = exitFrameOf(program, activeIndex - 1, previousOut.endTime)
        if (peak.alpha * (1 - weight) > 0.002) {
          layers.push({ index: activeIndex - 1, alpha: peak.alpha * (1 - weight), scale: peak.scale, blur: peak.blur })
        }
        layers.push({
          index: activeIndex,
          alpha: Math.min(enter.alpha, weight) * current.alpha,
          scale: enter.scale * current.scale,
          blur: Math.max(enter.blur, current.blur),
        })
        return { activeIndex, layers }
      }
    }
    layers.push({ index: activeIndex, ...current })
    return { activeIndex, layers }
  }

  // ============ lumiereGroupFilters.ts ============
  // 运行时对场景 / 片尾卡的图形组、文字组 filter 做的就地调整：bloom 强度（滑块拖动时不重建场景）、
  // 图形组的画质分辨率与相应减掉的 bloom 级数。bloom filter 由场景自己建、自己销毁，这里只改它的参数。

  const isBloomFilter = (filter) => (
    typeof filter.options?.strength === 'number'
  )

  const bloomOf = (group) => (group.filters ?? []).find(isBloomFilter) ?? null

  // LumiereGroupQuality = { preset, multiplier, resolution (number|null), levelDrop, passthrough (Filter|null) }
  /** 把画质与 bloom 倍率写到一个组上。重复调用是幂等的。 */
  const applyLumiereGroupQuality = (group, quality) => {
    const bloom = bloomOf(group)
    if (bloom) {
      bloom.options.strength = quality.preset.strength * quality.multiplier
      bloom.options.levels = Math.max(1, quality.preset.levels - quality.levelDrop)
      bloom.resolution = quality.resolution ?? 'inherit'
      return
    }
    const { passthrough, resolution } = quality
    if (!passthrough) return
    const attached = (group.filters ?? []).includes(passthrough)
    if (resolution === null) {
      if (attached) group.filters = []
      return
    }
    passthrough.resolution = resolution
    if (!attached) group.filters = [passthrough]
  }

  /** 摘掉运行时挂上的直通 filter（场景销毁前调用，免得场景的 destroy 把共享 filter 一起处理掉）。 */
  const detachLumierePassthrough = (group, passthrough) => {
    if (passthrough && (group.filters ?? []).includes(passthrough)) group.filters = []
  }

  // ============ lumiereSceneEntry.ts ============
  // 运行时缓存里的一个段落场景：LumiereUnit 外面再包一层运行时自己的 holder。转场的透明度、缩放和模糊
  // 都套在 holder 上——场景自己在内部舞台上做运镜，scene.view 不动，两套变换互不覆盖。
  // LumiereSceneEntry = { index, unit, holder, blur (BlurFilter|null) }
  // LumiereSceneQuality（图形组、文字组的画质参数，运行时按 tuning 与画质档算好，所有场景共用）：
  //   { bloom, textBloom, graphicsResolution (number|null), bloomLevelDrop, passthrough (Filter|null) }
  // LumiereSceneBuildContext = { width, height, resolution, program, theme, tuning, sprites,
  //   audioAt: (time) => LumiereAudioFrame, showText, quality }

  /** 模糊低于这个强度就摘掉 filter：一个挂着不用的 filter 也要多一次整屏离屏渲染。 */
  const BLUR_EPSILON = 0.3

  const applyLumiereSceneQuality = (
    groups,
    quality,
  ) => {
    applyLumiereGroupQuality(groups.graphics, {
      preset: window.FoliaLumiereCore.LUMIERE_BLOOM.graphics,
      multiplier: quality.bloom,
      resolution: quality.graphicsResolution,
      levelDrop: quality.bloomLevelDrop,
      passthrough: quality.passthrough,
    })
    applyLumiereGroupQuality(groups.text, {
      preset: window.FoliaLumiereCore.LUMIERE_BLOOM.text,
      multiplier: quality.textBloom,
      resolution: null,
      levelDrop: 0,
      passthrough: null,
    })
  }

  /** 建一个段落场景（整个运行时里最贵的调用：光栅化这一段的全部歌词）。 */
  const buildLumiereSceneEntry = (
    pixi,
    context,
    index,
  ) => {
    const { width, height } = context
    const unit = createLumiereUnit(pixi, {
      paragraph: context.program.paragraphs[index],
      width,
      height,
      resolution: context.resolution,
      programSeed: context.program.seed,
      theme: context.theme,
      tuning: context.tuning,
      sprites: context.sprites,
      audioAt: context.audioAt,
    })
    unit.scene.text.visible = context.showText
    applyLumiereSceneQuality(unit.scene, context.quality)
    const holder = new pixi.Container()
    holder.addChild(unit.scene.view)
    holder.pivot.set(width / 2, height / 2)
    holder.position.set(width / 2, height / 2)
    holder.zIndex = index
    return { index, unit, holder, blur: null }
  }

  /** 套转场帧：透明度、以画面中心为原点的缩放、模糊（按需挂 / 摘）。 */
  const applyLumiereLayerFrame = (
    pixi,
    entry,
    frame,
    blurResolution,
  ) => {
    entry.holder.alpha = frame.alpha
    entry.holder.scale.set(frame.scale)
    if (frame.blur > BLUR_EPSILON) {
      if (!entry.blur) {
        // 模糊的内容不需要满分辨率：半分辨率跑模糊，开销是整屏的四分之一。
        entry.blur = new pixi.BlurFilter({ strength: frame.blur, quality: 3, resolution: blurResolution })
      }
      entry.blur.strength = frame.blur
      if (!entry.holder.filters?.includes(entry.blur)) entry.holder.filters = [entry.blur]
    } else if (entry.holder.filters?.length) {
      entry.holder.filters = []
    }
  }

  const destroyLumiereSceneEntry = (entry, passthrough) => {
    entry.holder.parent?.removeChild(entry.holder)
    entry.holder.filters = []
    entry.blur?.destroy()
    entry.blur = null
    // 共享的直通 filter 先摘下来，场景的 destroy 只处理它自己建的 bloom。
    detachLumierePassthrough(entry.unit.scene.graphics, passthrough)
    entry.holder.removeChild(entry.unit.scene.view)
    entry.unit.destroy()
    entry.holder.destroy()
  }

  // ============ lumiereSongSwap.ts ============
  // 换歌交接的两帧状态机（同 tempera 的 songSwap）：第一帧在旧歌还在画的时候把新歌当前段落的场景建好
  // （stage），第二帧切过去（commit）。切的那一帧不做任何重活；中途被取消（abort）或运行时销毁时立即了结，
  // 等交接的 promise 一定会 settle，pixiRuntimeHost 的 drain 循环不会挂住。
  // LumiereSongSwapHooks<TSong, TStaged> = { stage: (song) => TStaged | null, commit: (song, staged) => void,
  //   discard: (staged) => void }

  class LumiereSongSwap {
    // pending = { song, staged, prepared, settle, detachAbort } | null
    constructor(hooks) {
      this.hooks = hooks
      this.pending = null
    }

    get active() {
      return this.pending !== null
    }

    /** 已经建好、还没切过去的场景（tuning / 尺寸变化时需要一起更新或丢弃）。 */
    get staged() {
      return this.pending?.staged ?? null
    }

    /** 丢掉已建好的 staged（它是按旧的尺寸 / tuning 建的）；交接照常在下一帧切，切的时候重建。 */
    dropStaged() {
      const pending = this.pending
      if (!pending?.staged) return
      this.hooks.discard(pending.staged)
      pending.staged = null
    }

    /** 开始一次交接，两帧之后 resolve。 */
    begin(song, signal) {
      return new Promise(resolve => {
        const onAbort = () => this.settle(true)
        this.pending = {
          song,
          staged: null,
          prepared: false,
          settle: resolve,
          detachAbort: () => signal?.removeEventListener('abort', onAbort),
        }
        signal?.addEventListener('abort', onAbort, { once: true })
      })
    }

    /** 每帧开头调用：第一帧 stage，第二帧 commit。 */
    advance() {
      const pending = this.pending
      if (!pending) return
      if (!pending.prepared) {
        pending.prepared = true
        pending.staged = this.hooks.stage(pending.song)
        return
      }
      this.settle(true)
    }

    /** 立即了结：commit 为 false（运行时正在销毁）时只丢弃 staged。 */
    settle(commit) {
      const pending = this.pending
      if (!pending) return
      this.pending = null
      pending.detachAbort()
      if (commit) this.hooks.commit(pending.song, pending.staged)
      else if (pending.staged) this.hooks.discard(pending.staged)
      pending.settle()
    }
  }

  // ============ lumiereDarkField.ts ============
  // 暗场底：光后面铺一整块主题背景色压暗的底，压住 folia 的共享背景层，光束才像打在烟里的光。
  // 它由运行时画在所有段落场景（和片尾卡）之下，不随段落转场的透明度 / 模糊 / 缩放变化——
  // 放在场景里时，出场帧的透明度、边界后的交叉渐变（两层各半透明，叠起来盖不满）和片尾交接都会让背景透出来闪一下。
  // 光场着色器仍保留 uDark 通路，folia 里恒传 0。

  /** 主题背景亮度超过它就算浅色主题。 */
  const BRIGHT_BACKGROUND_LUMINANCE = 0.18
  /** 浅色主题的暗场保底（lumisynth 定的「绘光始终在暗场里」）：亮背景透出来光就不成立了。 */
  const LUMIERE_BRIGHT_DARK_FIELD_FLOOR = 0.94
  /** 暗场颜色 = 主题背景色 × 这个系数。 */
  const DARK_FIELD_SHADE = 0.06

  /** 生效的暗场：深色主题 alpha = darkField；浅色主题取 max(darkField, 0.94)。颜色是主题背景色压暗。 */
  const resolveLumiereDarkField = (theme, darkField) => {
    const core = window.FoliaLumiereCore
    const background = core.rgbOf(theme.backgroundColor, [0, 0, 0])
    const strength = Number.isFinite(darkField) ? Math.min(1, Math.max(0, darkField)) : 0
    const bright = core.luminance(background) > BRIGHT_BACKGROUND_LUMINANCE
    return {
      color: core.scaleRgb(background, DARK_FIELD_SHADE),
      alpha: bright ? Math.max(strength, LUMIERE_BRIGHT_DARK_FIELD_FLOOR) : strength,
    }
  }

  /** 运行时的暗场层：一块整屏的纯色 sprite，每帧按当前主题、尺寸和 tuning 现算（只在变化时写属性）。 */
  class LumiereDarkFieldLayer {
    constructor(pixi) {
      this.sprite = new pixi.Sprite(pixi.Texture.WHITE)
      this.sprite.visible = false
      this.view = this.sprite
      this.theme = null
      this.darkField = Number.NaN
      this.width = 0
      this.height = 0
    }

    update(theme, darkField, width, height) {
      if (theme !== this.theme || darkField !== this.darkField) {
        this.theme = theme
        this.darkField = darkField
        const field = resolveLumiereDarkField(theme, darkField)
        this.sprite.tint = window.FoliaLumiereCore.hexOf(field.color)
        this.sprite.alpha = field.alpha
        this.sprite.visible = field.alpha > 0.002
      }
      if (width !== this.width || height !== this.height) {
        this.width = width
        this.height = height
        this.sprite.setSize(width, height)
      }
    }

    destroy() {
      this.sprite.destroy()
    }
  }

  // ============ lumiereAudio.ts ============
  // folia 的音频 MotionValue → 绘光场景要的 audioAt 帧（bass / treble / power，0..1）。
  //
  // 量纲：主播放器（usePlaybackVisualizerBridge）写的是 0..255（getByteFrequencyData 的均值再做 pow 压缩），
  // 没在出声时是 0..40 的「呼吸」；VisPlayground / ThemePark 的预览时钟与 OBS 的音频桥写的是 0..1。
  // 同一个源不会混用两种量纲，所以和 claddagh 一样按「见过 > 1 的值就认定是 0..255」粘住判断——
  // 单看当前值会把 0..255 源里安静段的 0.3 当成 0.3 而不是 0.001。
  //
  // 平滑：原始频段值逐帧抖动，直接推光束亮度会闪。起音快（~60ms）、释放慢（~250ms），跟得上鼓点又不闪。
  // 暂停时整帧归零（场景当作安静），不读呼吸值。
  // LumiereAudioSources = { audioPower: { get(): number }, audioBands: { bass, lowMid, mid, vocal, treble, spectrum? } }，
  // 各频段都是 { get(): number }（原 framer-motion MotionValue<number>）。

  const ATTACK_SECONDS = 0.06
  const RELEASE_SECONDS = 0.25

  /** 单个值归一化到 0..1；rawScale 为 true 时按 0..255 换算。 */
  const normalizeLumiereAudioValue = (value, rawScale) => {
    if (!Number.isFinite(value) || value <= 0) return 0
    return Math.min(1, rawScale ? value / 255 : value)
  }

  /** 一阶低通，起音与释放各自的时间常数；dt 秒。 */
  const smoothLumiereAudioValue = (current, target, dt) => {
    const tau = target > current ? ATTACK_SECONDS : RELEASE_SECONDS
    const k = 1 - Math.exp(-Math.max(0, dt) / tau)
    return current + (target - current) * k
  }

  const createLumiereAudioSampler = (initial) => {
    let sources = initial
    let rawScale = false
    let lastMs = 0
    const frame = { bass: 0, treble: 0, power: 0 }

    const read = (value) => {
      const raw = value?.get() ?? 0
      if (raw > 1) rawScale = true
      return raw
    }

    return {
      frame,
      setSources: next => {
        if (next.audioPower === sources.audioPower && next.audioBands === sources.audioBands) return
        sources = next
        rawScale = false
      },
      sample: (nowMs, paused) => {
        const dt = lastMs > 0 ? Math.min(0.1, (nowMs - lastMs) / 1000) : 1
        lastMs = nowMs
        if (paused) {
          frame.bass = 0
          frame.treble = 0
          frame.power = 0
          return
        }
        // 三个都先读一遍，量纲判断对三者一致。
        const bass = read(sources.audioBands.bass)
        const treble = read(sources.audioBands.treble)
        const power = read(sources.audioPower)
        frame.bass = smoothLumiereAudioValue(frame.bass, normalizeLumiereAudioValue(bass, rawScale), dt)
        frame.treble = smoothLumiereAudioValue(frame.treble, normalizeLumiereAudioValue(treble, rawScale), dt)
        frame.power = smoothLumiereAudioValue(frame.power, normalizeLumiereAudioValue(power, rawScale), dt)
      },
    }
  }

  // ============ lumiereRuntimeTuning.ts ============
  // 用户 tuning（LumiereTuning）→ 场景 tuning（LumiereSceneTuning）的映射、画质档的数值，以及哪些改动要重建场景。
  // 纯函数，不碰 Pixi，运行时与单测共用。
  //
  // 画质档只动开销最大的那一块：图形组（光场着色器 + 烟雾 fbm + 图形组 bloom 的整条降采样链）。
  // 图形组本来就是整屏的柔光与烟雾，低频为主，降分辨率几乎看不出来；文字组、画框和片尾卡的字仍按满分辨率
  // 光栅化与合成，所以歌词保持清晰。见 resolveLumiereGraphicsResolution。

  /**
   * 三档的数值：
   * - full：图形组与屏幕同分辨率，倍频按用户设置（2..6）。
   * - balanced：图形组每轴 0.7（像素约 49%），倍频 ≤ 4。bloom 按对数就近减一级（不减会宽 1.43 倍，
   *   减一级窄到 0.71 倍，后者更近），辉光略收、开销再降一截。
   * - low（省电）：图形组每轴 0.5（像素 25%），倍频 ≤ 3，浮尘 ×0.6。分辨率正好减半，bloom 少降一级，
   *   最小一级与 full 完全同尺寸，辉光宽度不变。
   */
  const LUMIERE_QUALITY_PROFILES = {
    full: { graphicsScale: 1, maxFogOctaves: 6, moteScale: 1 },
    balanced: { graphicsScale: 0.7, maxFogOctaves: 4, moteScale: 1 },
    low: { graphicsScale: 0.5, maxFogOctaves: 3, moteScale: 0.6 },
  }

  /** 渲染分辨率上限：再高的屏幕也按 2 倍画，4K / 高 DPI 下整屏光场的开销是按像素数涨的。 */
  const LUMIERE_MAX_RENDER_RESOLUTION = 2

  /** 画布（文字、画框）的渲染分辨率：devicePixelRatio 钳在 1..2。 */
  const resolveLumiereRenderResolution = (devicePixelRatio) => {
    const ratio = typeof devicePixelRatio === 'number' && Number.isFinite(devicePixelRatio) ? devicePixelRatio : 1
    return Math.min(LUMIERE_MAX_RENDER_RESOLUTION, Math.max(1, ratio))
  }

  /**
   * 图形组 filter 的分辨率：满画质时就是渲染分辨率；降档时乘上倍率，再按 Pixi 纹理池的 2 的幂分桶往下吸附
   * （pixiTextureBudget.ts：最多再让 25%，换一个小一号的桶）。吸附只对图形组做——它是柔光，软一点看不出来；
   * 文字不吸附，保证清晰。
   */
  const resolveLumiereGraphicsResolution = (
    width,
    height,
    renderResolution,
    quality,
  ) => {
    const { graphicsScale } = LUMIERE_QUALITY_PROFILES[quality]
    if (graphicsScale >= 1) return renderResolution
    return window.FoliaSonnetCore.snapResolutionToTexturePool(width, height, renderResolution * graphicsScale)
  }

  /**
   * 图形组分辨率降了多少，bloom 就少降几级：bloom 每级是上一级的一半分辨率，输入已经降了 2^k 倍时去掉 k 级，
   * 最小一级的纹素（决定辉光有多宽）才和满画质一样大。
   */
  const resolveLumiereBloomLevelDrop = (renderResolution, graphicsResolution) => (
    graphicsResolution > 0 && graphicsResolution < renderResolution
      ? Math.max(0, Math.round(Math.log2(renderResolution / graphicsResolution)))
      : 0
  )

  // LumiereSceneTuningContext = { showText: boolean }（false 时不画歌词：背景歌词碎片也关掉，光照照常）。
  /** 用户 tuning → 场景 tuning。画质档在这里折进倍频与浮尘；「仅显示歌词文字」即场景的 textOnly。 */
  const toLumiereSceneTuning = (
    tuning,
    context,
  ) => {
    const profile = LUMIERE_QUALITY_PROFILES[tuning.renderQuality] ?? LUMIERE_QUALITY_PROFILES.full
    return {
      lightIntensity: tuning.lightIntensity,
      audioResponse: tuning.audioResponse,
      fogDensity: tuning.fogDensity,
      darkField: tuning.darkField,
      moteAmount: tuning.moteAmount * profile.moteScale,
      bloom: tuning.bloom,
      textBloom: tuning.textBloom,
      unlitOpacity: tuning.unlitOpacity,
      windowNeighbors: tuning.windowNeighbors,
      decay: tuning.decay,
      echo: context.showText ? tuning.echo : 0,
      fogOctaves: Math.min(tuning.fogOctaves, profile.maxFogOctaves),
      lineArt: tuning.lineArt,
      frontBokeh: tuning.frontBokeh,
      trails: tuning.trails,
      overlayFrame: tuning.overlayFrame,
      textOnly: tuning.textOnly,
      keywordColors: tuning.keywordColors,
      themeIcons: tuning.themeIcons,
      themeColorMix: tuning.themeColorMix,
    }
  }

  /**
   * 每帧才读的字段：直接改运行时持有的那份 tuning 对象就生效，不必重建。
   * （光强、随音乐、烟雾浓度、未唱字透明度、倍频在 scene.update 里现读；暗场强度由运行时的暗场层每帧现读。）
   */
  const LUMIERE_LIVE_SCENE_KEYS = [
    'lightIntensity',
    'audioResponse',
    'fogDensity',
    'darkField',
    'unlitOpacity',
    'fogOctaves',
  ]

  /**
   * 改变编译结果的字段：既不是每帧现读，也不是场景重建——程序本身要重新编译（VisualizerLumiere 的 useMemo），
   * 新程序经 swapSong 的同曲替换路径交给运行时（commitSong 清掉场景缓存，下一帧按新程序建），不重建 WebGL 上下文。
   * 轨迹过渡把整首歌编成一个单元，所以它在这里，不在场景 tuning 里。
   */
  const LUMIERE_COMPILE_KEYS = ['seamlessTransitions']

  /** 用户 tuning → 编译选项（只取 LUMIERE_COMPILE_KEYS 里的字段）。 */
  const resolveLumiereCompileOptions = (
    tuning,
  ) => ({ seamless: tuning.seamlessTransitions })

  /** 两个 bloom 倍率：强度直接写进现有 filter 的 options；只有跨过 0（要挂 / 摘 filter）时才重建。 */
  const crossesZero = (previous, next) => (previous > 0) !== (next > 0)

  /**
   * 场景构建时烘焙进去的字段变了，缓存的场景就得重建（运行时会防抖）。画框只在 overlay 里，不算。
   */
  const requiresLumiereSceneRebuild = (previous, next) => (
    previous.moteAmount !== next.moteAmount
    || previous.windowNeighbors !== next.windowNeighbors
    || previous.decay !== next.decay
    || previous.echo !== next.echo
    || previous.lineArt !== next.lineArt
    || previous.frontBokeh !== next.frontBokeh
    || previous.trails !== next.trails
    || previous.textOnly !== next.textOnly
    || previous.keywordColors !== next.keywordColors
    || previous.themeIcons !== next.themeIcons
    // 调色盘在建场景时算好（光色、字色、线稿与关键字的混色都从它来）。
    || previous.themeColorMix !== next.themeColorMix
    || crossesZero(previous.bloom, next.bloom)
    || crossesZero(previous.textBloom, next.textBloom)
  )

  // ============ overlay.ts ============
  // 绘光的画框装饰：像取景器 / 光学台上的标记——四角括号、左右两个对位十字、顶边两段虚线。
  // 静态、很淡的香槟金细线，不抢画面里的光。
  // LumiereOverlayOptions = { width, height, theme, themeColorMix? }（themeColorMix 为主题色占比，
  //   同场景的调色盘，不给按 0）。
  /** 画框容器（静态，只建一次；尺寸或主题变了就重建）。 */
  const buildLumiereOverlay = (pixi, options) => {
    const { width, height, theme } = options
    const container = new pixi.Container()
    const g = new pixi.Graphics()
    const color = window.FoliaLumiereCore.hexOf(window.FoliaLumiereScene.resolveLumierePalette(theme, options.themeColorMix ?? 0).light)
    const unit = Math.min(width, height)
    // 边距留足：画面边缘可能被运镜推近、后处理的镜头畸变往外推（歌词窗口按同一个边距避开画框）。
    const { padX, padY } = window.FoliaLumiereText.frameInsets(width, height)
    // 原 arm 为 unit * (0.045 + LUMIERE_NEUTRAL_OFFSET)，自相减恒为 0，内联。
    const arm = unit * 0.045
    const line = Math.max(1.2, unit / 600)
    const alpha = 0.5

    // 四角括号。
    for (const [x, y, sx, sy] of [[padX, padY, 1, 1], [width - padX, padY, -1, 1], [width - padX, height - padY, -1, -1], [padX, height - padY, 1, -1]]) {
      g.moveTo(x, y + sy * arm).lineTo(x, y).lineTo(x + sx * arm, y).stroke({ color, width: line, alpha })
    }

    // 左右边中点的对位十字（圆 + 十字）。
    const mark = unit * 0.012
    for (const x of [padX, width - padX]) {
      const y = height / 2
      g.circle(x, y, mark * 0.6).stroke({ color, width: line, alpha: alpha * 0.8 })
      g.moveTo(x - mark, y).lineTo(x + mark, y).stroke({ color, width: line, alpha: alpha * 0.8 })
      g.moveTo(x, y - mark).lineTo(x, y + mark).stroke({ color, width: line, alpha: alpha * 0.8 })
    }

    // 顶边两小段虚线（像取景器上沿的对焦点）。
    const dashY = padY
    for (const side of [-1, 1]) {
      for (let k = 0; k < 4; k += 1) {
        const x = width / 2 + side * (unit * 0.1 + k * unit * 0.018)
        g.moveTo(x, dashY).lineTo(x + side * unit * 0.009, dashY).stroke({ color, width: line, alpha: alpha * 0.55 })
      }
    }

    container.addChild(g)
    return container
  }

  // ============ lumiereUnit.ts ============
  // 一个段落 → 一个场景单元：把编译出的 LumiereParagraph 换成 createLumiereScene 的参数（镜头覆盖的行换成
  // 单元内的下标、熄灯转场换成场景的收光窗口、按程序种子与段落 id 播种），再给出运镜矩阵与当前镜头。
  // 对应 lumisynth 绘光 adapter 的 buildUnit；运行时（phase B）每个可见段落建一个，按播放时间调 update。
  // LumiereUnitOptions = { paragraph, width, height, resolution, programSeed, theme, tuning, sprites,
  //   audioAt?, typography? }；LumiereUnit = { paragraph, scene, update, cameraMatrix, shotAt, destroy }。

  /** 段落的镜头 → 场景镜头：行号换成单元内的下标（options.lines = paragraph.lines）。 */
  const buildLumiereSceneShots = (paragraph) => {
    const localLine = new Map(paragraph.lineIndices.map((lineIndex, index) => [lineIndex, index]))
    const shots = paragraph.shots.map(shot => ({
      profile: profileOf(shot.kind),
      startTime: shot.startTime,
      endTime: shot.endTime,
      lines: shot.lineIndices.map(index => localLine.get(index)).filter(index => index !== undefined),
    }))
    if (shots.length === 0) {
      // 编译器保证每段至少一个镜头；防御：给一个覆盖整段的天井。
      shots.push({ profile: profileOf(''), startTime: paragraph.startTime, endTime: paragraph.endTime, lines: [] })
    }
    return shots
  }

  const createLumiereUnit = (pixi, options) => {
    const { paragraph } = options
    const scene = window.FoliaLumiereScene.createLumiereScene(pixi, {
      width: options.width,
      height: options.height,
      resolution: options.resolution,
      seed: `${options.programSeed}:${paragraph.id}`,
      theme: options.theme,
      tuning: options.tuning,
      lines: paragraph.lines,
      shots: buildLumiereSceneShots(paragraph),
      startTime: paragraph.startTime,
      endTime: paragraph.endTime,
      sprites: options.sprites,
      opening: paragraph.opening,
      fadeOut: paragraph.transitionOut?.kind === 'lights-out'
        ? { start: paragraph.transitionOut.startTime, end: paragraph.transitionOut.endTime }
        : null,
      audioAt: options.audioAt,
      typography: options.typography,
      sections: paragraph.sections,
    })
    const shotAt = (time) => {
      let found = paragraph.shots[0]
      for (const shot of paragraph.shots) if (shot.startTime <= time) found = shot
      return found
    }
    return {
      paragraph,
      scene,
      update: time => scene.update(time),
      cameraMatrix: time => cameraBetween(scene.rest, scene.camera(time)),
      shotAt,
      destroy: () => scene.destroy(),
    }
  }

  // ============ lumiereUnitLayout.ts ============
  // 一个场景单元里由镜头列表决定的几件事（纯函数，场景与单测共用）：领头光位、每行成为当前行时用的排版、运镜。
  // 整首歌一个单元（轨迹过渡）时它们决定了段落之间是否连续：领头光位跳过前奏的间奏镜头；运镜按原段落往返推拉，
  // 段落边界处位置连续、速度为 0。

  /**
   * 领头光位（文字区、字号、运镜、浮尘、星空按它）：第一个有歌词的镜头。按段落切单元时就是第一个镜头；
   * 整首歌一个单元时跳过前奏的间奏镜头，免得整首歌的字都排在间奏光位的文字区里。
   */
  const resolveLumiereLeadShot = (shots) => (
    shots[Math.max(0, shots.findIndex(shot => shot.lines.length > 0))]
  )

  /** 第 i 行成为当前行时用它所在镜头的排版（不在任何镜头里的行跟随前一个有歌词的镜头）。 */
  const lumiereTypographyOfLine = (shots) => (lineIndex) => {
    let found = shots[0]
    for (const shot of shots) {
      if (shot.lines.includes(lineIndex)) return shot.profile.typography
      if (shot.lines.length > 0 && shot.lines[0] < lineIndex) found = shot
    }
    return found.profile.typography
  }

  /**
   * 运镜的推近进度（0..1，已缓入缓出）：没有 sections 时整个单元推一次（原来的行为）；
   * 有 sections 时每个段落推一次、下一段拉回来，往返交替——段落边界处速度为 0 且位置连续，
   * 整首歌一个单元时运镜也保持段落的节奏，而不是用 5 分钟推完一次。
   */
  const resolveLumiereCameraProgress = (
    time,
    span,
    sections,
  ) => {
    const eased = (start, end) => {
      const linear = Math.min(1, Math.max(0, (time - start) / Math.max(end - start, 0.001)))
      return (1 - Math.cos(linear * Math.PI)) / 2
    }
    if (!sections || sections.length === 0) return eased(span.startTime, span.endTime)
    let index = 0
    for (let i = 0; i < sections.length; i += 1) if (sections[i].startTime <= time) index = i
    const section = sections[index]
    const progress = eased(section.startTime, section.endTime)
    return index % 2 === 0 ? progress : 1 - progress
  }

  // LumiereCameraOptions = { width, height, camera (领头光位的运镜参数), startTime, endTime, sections?,
  //   animationIntensity? }
  /** 运镜：缓慢推近 + 平移（两端缓入缓出，见 resolveLumiereCameraProgress），再叠持续的手持感浮动。只由 time 决定。 */
  const createLumiereCamera = (options) => {
    const { width, height, camera } = options
    const motion = options.animationIntensity === 'calm' ? 0.6 : options.animationIntensity === 'chaotic' ? 1.4 : 1
    const span = { startTime: options.startTime, endTime: options.endTime }
    return (time) => {
      const progress = resolveLumiereCameraProgress(time, span, options.sections)
      const floatX = (Math.sin(time * 0.21 + 0.4) * 0.6 + Math.sin(time * 0.53 + 1.9) * 0.4) * 0.006 * motion
      const floatY = (Math.cos(time * 0.17 + 1.1) * 0.6 + Math.sin(time * 0.47 + 0.3) * 0.4) * 0.006 * motion
      return {
        x: width / 2 + (camera.driftX * progress + floatX) * width,
        y: height / 2 + (camera.driftY * progress + floatY) * height,
        pivotX: width / 2,
        pivotY: height / 2,
        scale: (1 + camera.push * progress) * (1 + 0.008 * motion * Math.sin(time * 0.31 + 0.7)),
        rotation: 0.004 * motion * Math.sin(time * 0.13 + 2.1),
      }
    }
  }

  /** 舞台坐标（没有运镜时的画面坐标）经运镜变换后的画面坐标（与 Pixi 容器 pivot / position / scale / rotation 相同）。 */
  const applyLumiereCamera = (transform, x, y) => {
    const cos = Math.cos(transform.rotation)
    const sin = Math.sin(transform.rotation)
    const dx = (x - transform.pivotX) * transform.scale
    const dy = (y - transform.pivotY) * transform.scale
    return { x: transform.x + dx * cos - dy * sin, y: transform.y + dx * sin + dy * cos }
  }

  // ============ 挂载 ============
  window.FoliaLumiereProgram = {
    // lumiereKernel.ts
    IDENTITY,
    fromParams,
    multiply,
    invert,
    applyAffine,
    cameraBetween,
    // program.ts
    LUMIERE_TRANSITION_KINDS,
    DEFAULT_LUMIERE_PARAMS,
    moodsForEnergy,
    groupLines,
    planShots,
    castShot,
    advanceChain,
    // catalog.ts（PROFILES / KINDS 依赖 FoliaLumiereRigs，经 getter 延迟取）
    get LUMIERE_PROFILES() { return lumiereProfiles() },
    get LUMIERE_KINDS() { return lumiereProfiles().map(profile => profile.kind) },
    LUMIERE_FAMILY_LABELS,
    LUMIERE_FAMILY_DESCRIPTIONS,
    profileOf,
    hasProfile,
    // lumiereStructure.ts
    DEFAULT_LUMIERE_STRUCTURE_PARAMS,
    buildStructureLines,
    resolveParagraphGapThreshold,
    metadataChanged,
    splitOversizedDraft,
    draftParagraphs,
    countWordLike,
    classifyParagraph,
    // lumiereTransitions.ts
    LUMIERE_TRANSITIONS,
    resolveLumiereEnterDuration,
    chooseLumiereTransition,
    // lumiereSeamless.ts
    mergeLumiereParagraphs,
    // lumiereProgram.ts
    REOPEN_GAP,
    compileLumiereProgram,
    findLumiereParagraphIndexAtTime,
    // lumiereSceneFrames.ts
    resolveLumiereSceneFrames,
    // lumiereSceneEntry.ts
    applyLumiereSceneQuality,
    buildLumiereSceneEntry,
    applyLumiereLayerFrame,
    destroyLumiereSceneEntry,
    // lumiereSongSwap.ts
    LumiereSongSwap,
    // lumiereDarkField.ts
    LUMIERE_BRIGHT_DARK_FIELD_FLOOR,
    resolveLumiereDarkField,
    LumiereDarkFieldLayer,
    // lumiereGroupFilters.ts
    applyLumiereGroupQuality,
    detachLumierePassthrough,
    // lumiereAudio.ts
    normalizeLumiereAudioValue,
    smoothLumiereAudioValue,
    createLumiereAudioSampler,
    // lumiereRuntimeTuning.ts
    LUMIERE_QUALITY_PROFILES,
    LUMIERE_MAX_RENDER_RESOLUTION,
    resolveLumiereRenderResolution,
    resolveLumiereGraphicsResolution,
    resolveLumiereBloomLevelDrop,
    toLumiereSceneTuning,
    LUMIERE_LIVE_SCENE_KEYS,
    LUMIERE_COMPILE_KEYS,
    resolveLumiereCompileOptions,
    requiresLumiereSceneRebuild,
    // overlay.ts
    buildLumiereOverlay,
    // lumiereUnit.ts
    buildLumiereSceneShots,
    createLumiereUnit,
    // lumiereUnitLayout.ts
    resolveLumiereLeadShot,
    lumiereTypographyOfLine,
    resolveLumiereCameraProgress,
    createLumiereCamera,
    applyLumiereCamera,
  }
})()
