// 群唱模式（cappella）：一比一移植自 folia-major 群唱歌词可视化器。
// 原版来源：
//   - src/components/visualizer/cappella/VisualizerCappella.tsx（主渲染器：聊天弹幕式歌词）
//   - src/components/visualizer/cappella/avatarImages.ts（内置头像清单与头像源解析）
//   - src/components/visualizer/cappella/emoImages.ts（内置表情图清单）
//   - src/components/visualizer/cappella/cappellaMessageSenders.ts（TTML agent 发送者解析；
//     上行“弹幕发送 API”依赖宿主聊天室环境，本插件没有：只保留弹幕展示/歌词气泡渲染，发送逻辑跳过）
//   - src/types.ts 的 DEFAULT_CAPPELLA_TUNING（内联为常量）
// React/framer-motion → 原生 JS 对应：useState/useRef → 闭包变量；useMotionValueEvent → tick(frameState)；
// motion animate/exit → FoliaAnim(WAAPI)；AnimatePresence(popLayout) + layout="position" → 手动行管理：
// 退场行脱离文档流播放退场动画，其余行用 FLIP 位移弹簧补偿布局变化（近似原版 layout 位移动画）。
// 内置表情/头像图片已复制到插件 assets/cappella-emo、assets/cappella-avatar，
// 用 new Image() 预加载，onload 后才用于展示。
// 原版用 @chenglou/pretext 做气泡逐前缀测量；registry 未给本模式配置 vendor，这里自行懒加载
// vendor/pretext.iife.js，加载完成前用 canvas 逐字形贪心折行回退（换行点可能有细微差别）。
(function () {
  'use strict'

  var Anim = window.FoliaAnim
  var ColorMix = window.FoliaColorMix
  var GraphemeTiming = window.FoliaGraphemeTiming
  var RenderHints = window.FoliaRenderHints
  var Runtime = window.FoliaVisualizerRuntime

  // ---------- 原版 types.ts：DEFAULT_CAPPELLA_TUNING（插件无调参入口，内联） ----------
  // 原版默认 avatarSource: 'cover'（用专辑封面作头像）；插件按需求固定使用内置头像库
  var DEFAULT_CAPPELLA_TUNING = { showEmoMessages: true, emojiPackSource: 'builtin', avatarSource: 'builtin' }
  var TUNING = DEFAULT_CAPPELLA_TUNING

  // ---------- 原版 VisualizerCappella 顶部常量 ----------
  var SHORT_LINE_CHAR_LIMIT = 12
  var MAX_VISIBLE_MESSAGES = 20
  var AVATAR_GRID_SIZE = 3
  var LEFT_AVATAR_INDICES = [0, 3, 6, 1, 4]
  var RIGHT_AVATAR_INDEX = 8
  var CAPPELLA_PREHEAT_WINDOW = { minLead: 0.18, maxLead: 1.1 }
  var CAPPELLA_LAYOUT_CACHE_LIMIT = 32
  // 气泡宽度动画约 0.2s。气泡尺寸使用提前后的时间轴，
  // 让横向扩展先于字符出现启动，避免临界换行时字符短暂掉到下一行。
  var CAPPELLA_WIDTH_LOOKAHEAD_SECONDS = 0.2
  var CAPPELLA_BUBBLE_FONT_WEIGHT = 400

  var INTERLUDE_TEXT = '......'
  var DEFAULT_CHAR_FADE_MS = 220
  var MIN_CHAR_FADE_MS = 40

  // ---------- 内置表情图清单（原版 emoImages.ts import.meta.glob 等价；按文件名字母序） ----------
  var BUILTIN_EMO_IMAGES = [
    { id: 'builtin-happy1', name: 'happy1', url: 'assets/cappella-emo/happy1.png' },
    { id: 'builtin-love1', name: 'love1', url: 'assets/cappella-emo/love1.png' },
    { id: 'builtin-normal1', name: 'normal1', url: 'assets/cappella-emo/normal1.png' },
    { id: 'builtin-sleepy1', name: 'sleepy1', url: 'assets/cappella-emo/sleepy1.png' },
    { id: 'builtin-sleepy2', name: 'sleepy2', url: 'assets/cappella-emo/sleepy2.png' },
    { id: 'builtin-sleepy3', name: 'sleepy3', url: 'assets/cappella-emo/sleepy3.png' },
    { id: 'builtin-vibe1', name: 'vibe1', url: 'assets/cappella-emo/vibe1.png' },
    { id: 'builtin-vibe2', name: 'vibe2', url: 'assets/cappella-emo/vibe2.png' },
    { id: 'builtin-vibe3', name: 'vibe3', url: 'assets/cappella-emo/vibe3.png' }
  ]

  // ---------- 内置头像图清单（原版 avatarImages.ts import.meta.glob + localeCompare 排序等价；
  // localeCompare 对数字为逐字符比较，故 avatar10 排在 avatar2 之前；avatar7 原版目录缺失，跳过） ----------
  var BUILTIN_AVATAR_IMAGES = [
    { id: 'builtin-avatar-avatar10', name: 'avatar10', url: 'assets/cappella-avatar/avatar10.png' },
    { id: 'builtin-avatar-avatar11', name: 'avatar11', url: 'assets/cappella-avatar/avatar11.png' },
    { id: 'builtin-avatar-avatar12', name: 'avatar12', url: 'assets/cappella-avatar/avatar12.png' },
    { id: 'builtin-avatar-avatar13', name: 'avatar13', url: 'assets/cappella-avatar/avatar13.png' },
    { id: 'builtin-avatar-avatar14', name: 'avatar14', url: 'assets/cappella-avatar/avatar14.png' },
    { id: 'builtin-avatar-avatar15', name: 'avatar15', url: 'assets/cappella-avatar/avatar15.png' },
    { id: 'builtin-avatar-avatar16', name: 'avatar16', url: 'assets/cappella-avatar/avatar16.png' },
    { id: 'builtin-avatar-avatar17', name: 'avatar17', url: 'assets/cappella-avatar/avatar17.png' },
    { id: 'builtin-avatar-avatar2', name: 'avatar2', url: 'assets/cappella-avatar/avatar2.png' },
    { id: 'builtin-avatar-avatar3', name: 'avatar3', url: 'assets/cappella-avatar/avatar3.png' },
    { id: 'builtin-avatar-avatar4', name: 'avatar4', url: 'assets/cappella-avatar/avatar4.png' },
    { id: 'builtin-avatar-avatar5', name: 'avatar5', url: 'assets/cappella-avatar/avatar5.png' },
    { id: 'builtin-avatar-avatar6', name: 'avatar6', url: 'assets/cappella-avatar/avatar6.png' },
    { id: 'builtin-avatar-avatar8', name: 'avatar8', url: 'assets/cappella-avatar/avatar8.png' },
    { id: 'builtin-avatar-avatar9', name: 'avatar9', url: 'assets/cappella-avatar/avatar9.png' }
  ]

  // ---------- 原版 utils/fontStacks.ts（resolveThemeFontStack/resolveThemeFontWeight 等价） ----------
  var BUILTIN_FONT_STACKS = {
    sans: '"Inter", "Noto Sans CJK SC", "Noto Sans JP", "Source Han Sans SC", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Helvetica Neue", Arial, sans-serif',
    serif: '"獅尾四季春加糖SC", "Iowan Old Style", "Noto Serif CJK SC", "Noto Serif JP", "Source Han Serif SC", "Songti SC", "STSong", "Georgia", serif',
    mono: '"IBM Plex Mono", "Sarasa Mono SC", "Noto Sans Mono CJK SC", "Noto Sans Mono", "SFMono-Regular", Consolas, monospace'
  }

  function resolveThemeFontStack(theme) {
    var fallbackStack = BUILTIN_FONT_STACKS[(theme && theme.fontStyle) || 'sans'] || BUILTIN_FONT_STACKS.sans
    var custom = theme && typeof theme.fontFamily === 'string' ? theme.fontFamily.trim() : ''
    if (!custom) return fallbackStack
    return '"' + custom.replace(/["\\]/g, '\\$&') + '", ' + fallbackStack
  }

  function resolveThemeFontWeight(theme, fallback) {
    var weight = theme && typeof theme.fontWeight === 'number' && Number.isFinite(theme.fontWeight) ? theme.fontWeight : NaN
    if (!Number.isFinite(weight)) return fallback
    return Math.min(900, Math.max(100, Math.round(weight / 10) * 10))
  }

  // ---------- 通用小工具（原版同名函数） ----------
  var countCompactChars = function (text) { return Array.from(text.replace(/\s/g, '')).length }

  var hashString = function (input) {
    var hash = 2166136261
    for (var index = 0; index < input.length; index += 1) {
      hash ^= input.charCodeAt(index)
      hash = Math.imul(hash, 16777619)
    }
    return hash >>> 0
  }

  var seededUnit = function () {
    var parts = Array.prototype.slice.call(arguments)
    return hashString(parts.join('|')) / 0xffffffff
  }

  var pickStableEmoImage = function (imagePool) {
    if (imagePool.length === 0) return null
    var seedParts = Array.prototype.slice.call(arguments, 1)
    var index = Math.floor(seededUnit.apply(null, seedParts) * imagePool.length) % imagePool.length
    return imagePool[index] || imagePool[0]
  }

  var getEffectiveRenderEndTime = function (line, nextLine) {
    return Math.min(RenderHints.getLineRenderEndTime(line), nextLine ? nextLine.startTime : Number.POSITIVE_INFINITY)
  }

  // ---------- 三档强度配置（原版 getCappellaIntensityConfig，逐项照抄） ----------
  function getCappellaIntensityConfig(animationIntensity) {
    if (animationIntensity === 'calm') {
      return {
        sequencing: {
          forceRightEveryLines: 7,
          shortLineCarryChance: 0.92,
          sideSequence: ['left', 'left', 'right', 'left', 'right'],
          sideFlipChance: 0.08,
          randomEmoChance: 0,
          minLinesBetweenRandomEmos: 6,
          maxRandomEmoRatio: 0
        },
        motion: {
          rowEnterY: 14,
          rowEnterScale: 0.992,
          rowEnterDuration: 0.28,
          rowExitY: -10,
          rowExitScale: 0.985,
          rowExitDuration: 0.22,
          avatarSpring: { stiffness: 280, damping: 30, mass: 0.78 },
          activeScale: 1.07,
          passedScale: 0.96,
          passedOpacity: 0.88,
          activeFontMultiplier: 1.22,
          inactiveFontMultiplier: 0.96,
          activePaddingX: 18,
          activePaddingY: 14,
          inactivePaddingX: 16,
          inactivePaddingY: 12,
          activeMinHeight: 58,
          inactiveMinHeight: 44,
          glowOpacity: 0.26,
          glowDuration: 2.2,
          glowRightAlpha: 0.26,
          glowLeftAlpha: 0.14,
          activeShadowAlpha: 0.24,
          emoActiveSize: 132,
          emoInactiveSize: 96,
          emoEnterScale: 0.74,
          emoSizeTransitionDuration: 0.22
        }
      }
    }

    if (animationIntensity === 'chaotic') {
      return {
        sequencing: {
          forceRightEveryLines: 3,
          shortLineCarryChance: 0.36,
          sideSequence: ['left', 'right', 'right', 'left', 'right', 'left'],
          sideFlipChance: 0.42,
          randomEmoChance: 0.22,
          minLinesBetweenRandomEmos: 2,
          maxRandomEmoRatio: 1 / 6
        },
        motion: {
          rowEnterY: 30,
          rowEnterScale: 0.968,
          rowEnterDuration: 0.38,
          rowExitY: -26,
          rowExitScale: 0.94,
          rowExitDuration: 0.28,
          avatarSpring: { stiffness: 360, damping: 24, mass: 0.68 },
          activeScale: 1.18,
          passedScale: 0.88,
          passedOpacity: 0.76,
          activeFontMultiplier: 1.4,
          inactiveFontMultiplier: 0.92,
          activePaddingX: 22,
          activePaddingY: 17,
          inactivePaddingX: 15,
          inactivePaddingY: 11,
          activeMinHeight: 68,
          inactiveMinHeight: 42,
          glowOpacity: 0.52,
          glowDuration: 1.35,
          glowRightAlpha: 0.42,
          glowLeftAlpha: 0.24,
          activeShadowAlpha: 0.42,
          emoActiveSize: 178,
          emoInactiveSize: 122,
          emoEnterScale: 0.54,
          emoSizeTransitionDuration: 0.28
        }
      }
    }

    return {
      sequencing: {
        forceRightEveryLines: 5,
        shortLineCarryChance: 0.68,
        sideSequence: ['left', 'right', 'left', 'right', 'right'],
        sideFlipChance: 0.18,
        randomEmoChance: 0.1,
        minLinesBetweenRandomEmos: 3,
        maxRandomEmoRatio: 1 / 8
      },
      motion: {
        rowEnterY: 22,
        rowEnterScale: 0.98,
        rowEnterDuration: 0.32,
        rowExitY: -18,
        rowExitScale: 0.965,
        rowExitDuration: 0.24,
        avatarSpring: { stiffness: 340, damping: 28, mass: 0.72 },
        activeScale: 1.12,
        passedScale: 0.92,
        passedOpacity: 0.82,
        activeFontMultiplier: 1.34,
        inactiveFontMultiplier: 0.94,
        activePaddingX: 20,
        activePaddingY: 16,
        inactivePaddingX: 16,
        inactivePaddingY: 12,
        activeMinHeight: 64,
        inactiveMinHeight: 44,
        glowOpacity: 0.4,
        glowDuration: 1.8,
        glowRightAlpha: 0.34,
        glowLeftAlpha: 0.18,
        activeShadowAlpha: 0.34,
        emoActiveSize: 160,
        emoInactiveSize: 110,
        emoEnterScale: 0.6,
        emoSizeTransitionDuration: 0.25
      }
    }
  }

  // ---------- 原版 cappellaMessageSenders.ts：TTML agent 发送者解析 ----------
  // 插件行数据没有 agentId 字段：collectDistinctAgentIds 恒为空 → 解析器恒返回 null，保留分支保持 1:1。
  var normalizeAgentId = function (agentId) {
    var trimmed = typeof agentId === 'string' ? agentId.trim() : ''
    return trimmed ? trimmed : null
  }

  var collectDistinctAgentIds = function (lines) {
    var ids = []
    var seen = new Set()
    lines.forEach(function (line) {
      var agentId = normalizeAgentId(line.agentId)
      if (!agentId || seen.has(agentId)) return
      seen.add(agentId)
      ids.push(agentId)
    })
    return ids
  }

  var createCappellaAgentSenderResolver = function (lines, options) {
    var agentIds = collectDistinctAgentIds(lines)
    if (agentIds.length < 2) return null

    var rightAgentId = agentIds[0]
    var leftAvatarCount = Math.max(1, options.leftAvatarCount)
    var senderByAgentId = new Map()

    agentIds.forEach(function (agentId, index) {
      senderByAgentId.set(agentId, agentId === rightAgentId
        ? { side: 'right', avatarIndex: options.rightAvatarIndex }
        : { side: 'left', avatarIndex: (index - 1) % leftAvatarCount })
    })

    return {
      resolve: function (line) {
        var agentId = normalizeAgentId(line.agentId)
        return agentId ? (senderByAgentId.get(agentId) || null) : null
      }
    }
  }

  // ---------- 原版 avatarImages.ts：头像源解析 ----------
  var getSeededIndex = function (seed, side, length) {
    return hashString(seed + '|' + side + '|' + length) % length
  }

  var pickStableBuiltinAvatarImage = function (avatars, avatarIndex, side, seed) {
    if (avatars.length === 0) return null
    if (seed === undefined) seed = 'cappella'

    var rightAvatarIndex = getSeededIndex(seed, 'right', avatars.length)
    if (side === 'right') return avatars[rightAvatarIndex] || null

    var leftAvatarPool = avatars.filter(function (_, index) { return index !== rightAvatarIndex })
    if (leftAvatarPool.length === 0) return avatars[rightAvatarIndex] || null

    var leftSeedOffset = getSeededIndex(seed, 'left', leftAvatarPool.length)
    var resolvedLeftIndex = Math.abs(Math.trunc(avatarIndex + leftSeedOffset)) % leftAvatarPool.length
    return leftAvatarPool[resolvedLeftIndex] || null
  }

  var resolveCappellaAvatarUrl = function (input) {
    if (input.avatarSource === 'color') return null
    if (input.avatarSource === 'cover' && input.coverUrl) return input.coverUrl
    // 'custom' 分支：插件没有自定义头像入口，customAvatarImages 恒为空，保留分支但不会触发
    if (input.avatarSource === 'custom' && input.customAvatarImages && input.customAvatarImages.length > 0) {
      var custom = pickStableBuiltinAvatarImage(input.customAvatarImages, input.avatarIndex, input.side, input.seed)
      return custom ? custom.url : null
    }
    var picked = pickStableBuiltinAvatarImage(input.avatars, input.avatarIndex, input.side, input.seed)
    return picked ? picked.url : null
  }

  // ---------- 原版逐字 reveal 时间轴构建 ----------
  var getLineCharacters = function (line) { return GraphemeTiming.splitLyricGraphemes(line.fullText) }

  var getWordTextRanges = function (line) {
    var ranges = []
    var searchCursor = 0
    line.words.forEach(function (word) {
      var start = line.fullText.indexOf(word.text, searchCursor)
      if (start < 0) {
        ranges.push(null)
        return
      }
      var end = start + word.text.length
      ranges.push({ start: start, end: end })
      searchCursor = end
    })
    return ranges
  }

  // 从词级时间构建逐字符 reveal 时间轴（原版 buildCharacterRevealTimes）
  var buildCharacterRevealTimes = function (line, characters) {
    var revealTimes = characters.map(function () { return Number.POSITIVE_INFINITY })
    var lineTimeline = GraphemeTiming.buildLineGraphemeTimeline(line)
    if (lineTimeline.length === characters.length) {
      lineTimeline.forEach(function (timing, index) {
        revealTimes[index] = timing.startTime
      })
      return revealTimes
    }

    var ranges = getWordTextRanges(line)
    var previousWordEndCharacterIndex = 0
    var lastResolvedRevealTime = line.startTime
    var hasResolvedRevealTime = false

    line.words.forEach(function (word, index) {
      var range = ranges[index]
      if (!range) return

      var startCharacterIndex = GraphemeTiming.splitLyricGraphemes(line.fullText.slice(0, range.start)).length
      var endCharacterIndex = GraphemeTiming.splitLyricGraphemes(line.fullText.slice(0, range.end)).length
      var wordTimings = GraphemeTiming.buildWordGraphemeTimings(word)

      // 两个计时词之间的字符通常是空格或粘着标点，跟随下一个词一起显示，保证文本连续
      for (var characterIndex = previousWordEndCharacterIndex; characterIndex < startCharacterIndex; characterIndex += 1) {
        revealTimes[characterIndex] = word.startTime
      }

      wordTimings.forEach(function (timing, characterIndex) {
        var targetIndex = startCharacterIndex + characterIndex
        if (targetIndex >= revealTimes.length) return
        revealTimes[targetIndex] = timing.startTime
        lastResolvedRevealTime = Math.max(lastResolvedRevealTime, revealTimes[targetIndex])
        hasResolvedRevealTime = true
      })

      previousWordEndCharacterIndex = endCharacterIndex
    })

    // 行尾未匹配字符仍属于本行：挂到最后一个计时字符，而不是等到行结束
    var trailingRevealTime = hasResolvedRevealTime ? lastResolvedRevealTime : line.endTime
    for (var trailingIndex = previousWordEndCharacterIndex; trailingIndex < revealTimes.length; trailingIndex += 1) {
      revealTimes[trailingIndex] = trailingRevealTime
    }

    return revealTimes
  }

  // revealTimes 单调递增：播放时用二分查找解析可见字符数（原版 getCharacterCountAtTime）
  var getCharacterCountAtTime = function (revealTimes, currentTime) {
    var low = 0
    var high = revealTimes.length

    while (low < high) {
      var mid = Math.floor((low + high) / 2)
      if (revealTimes[mid] <= currentTime) low = mid + 1
      else high = mid
    }

    return low
  }

  var getTimestampReadyTimeFromMetrics = function (line, revealTimes, fadeDurationsMs) {
    if (revealTimes.length === 0) return line.endTime

    return revealTimes.reduce(function (latest, time, index) {
      if (!Number.isFinite(time)) return latest
      var fade = fadeDurationsMs[index] === undefined ? DEFAULT_CHAR_FADE_MS : fadeDurationsMs[index]
      return Math.max(latest, time + fade / 1000)
    }, line.startTime)
  }

  // 每个字符的 CSS 淡入时长；时间戳使用同一组值，保证最后一个字符淡入完成后才出现（原版同名函数）
  var buildCharacterFadeDurationsMs = function (line, characters) {
    var fadeDurationsMs = characters.map(function () { return DEFAULT_CHAR_FADE_MS })
    var lineTimeline = GraphemeTiming.buildLineGraphemeTimeline(line)
    if (lineTimeline.length === characters.length) {
      lineTimeline.forEach(function (timing, index) {
        fadeDurationsMs[index] = Math.max((timing.endTime - timing.startTime) * 1000, MIN_CHAR_FADE_MS)
      })
      return fadeDurationsMs
    }

    var ranges = getWordTextRanges(line)

    line.words.forEach(function (word, index) {
      var range = ranges[index]
      if (!range) return

      var startCharacterIndex = GraphemeTiming.splitLyricGraphemes(line.fullText.slice(0, range.start)).length
      var wordTimings = GraphemeTiming.buildWordGraphemeTimings(word)

      for (var characterIndex = 0; characterIndex < wordTimings.length; characterIndex += 1) {
        var targetIndex = startCharacterIndex + characterIndex
        if (targetIndex >= fadeDurationsMs.length) break

        var timing = wordTimings[characterIndex]
        fadeDurationsMs[targetIndex] = timing
          ? Math.max((timing.endTime - timing.startTime) * 1000, MIN_CHAR_FADE_MS)
          : DEFAULT_CHAR_FADE_MS
      }
    })

    return fadeDurationsMs
  }

  // 保留 reveal 顺序与入场时机的逐字淡入计划（原版 getCharacterRevealPlan；注意用 Array.from 而非字形切分）
  var getCharacterRevealPlan = function (line) {
    var characters = Array.from(line.fullText)
    var fadeDurationsMs = buildCharacterFadeDurationsMs(line, characters)
    return { characters: characters, fadeDurationsMs: fadeDurationsMs }
  }

  // ---------- 原版 buildCappellaMessages：确定性的聊天消息序列 ----------
  function buildCappellaMessages(lines, titleText, config, tuning, emoImagePool, forcePreviewEmo) {
    var messages = [{
      id: 'title',
      kind: 'title',
      text: titleText,
      side: 'right',
      avatarIndex: AVATAR_GRID_SIZE * AVATAR_GRID_SIZE - 1
    }]

    var showEmoMessages = tuning.showEmoMessages && emoImagePool.length > 0

    if (lines.length === 0) {
      var fallbackEmo = showEmoMessages
        ? pickStableEmoImage(emoImagePool, 'no-lyrics', titleText, config.sequencing.forceRightEveryLines)
        : null
      if (fallbackEmo && showEmoMessages) {
        messages.push({
          id: 'emo-no-lyrics',
          kind: 'emo',
          line: { words: [], startTime: 0, endTime: 0, fullText: INTERLUDE_TEXT },
          lineIndex: 0,
          side: 'right',
          avatarIndex: AVATAR_GRID_SIZE * AVATAR_GRID_SIZE - 1,
          emoImageUrl: fallbackEmo.url,
          activationStartTime: 0,
          activationEndTime: 999999
        })
      }
      return messages
    }

    var sideSequenceCursor = 0
    var nextLeftAvatarCursor = 0
    var lastLyricSender = null
    var lyricMessagesSinceRandomEmo = Number.POSITIVE_INFINITY
    var randomEmoCount = 0
    var randomEmoCap = Math.floor(lines.length * config.sequencing.maxRandomEmoRatio)
    var agentSenderResolver = createCappellaAgentSenderResolver(lines, {
      rightAvatarIndex: RIGHT_AVATAR_INDEX,
      leftAvatarCount: LEFT_AVATAR_INDICES.length
    })

    lines.forEach(function (line, lineIndex) {
      var nextLine = lines[lineIndex + 1]
      var isShortLine = countCompactChars(line.fullText) <= SHORT_LINE_CHAR_LIMIT
      var agentSender = agentSenderResolver ? agentSenderResolver.resolve(line) : null
      var shouldForceRight = !agentSender && (lineIndex + 1) % config.sequencing.forceRightEveryLines === 0
      var shouldCarrySender = Boolean(!agentSender
        && isShortLine
        && lastLyricSender
        && seededUnit('carry', line.startTime, lineIndex) <= config.sequencing.shortLineCarryChance)
      var baseSide = config.sequencing.sideSequence[sideSequenceCursor % config.sequencing.sideSequence.length]
      var shouldFlipSide = !shouldForceRight
        && seededUnit('flip', line.startTime, lineIndex) < config.sequencing.sideFlipChance
      var resolvedSide = shouldFlipSide
        ? (baseSide === 'left' ? 'right' : 'left')
        : baseSide
      var sender
      if (agentSender) {
        sender = agentSender
      } else if (shouldForceRight) {
        sender = { side: 'right', avatarIndex: RIGHT_AVATAR_INDEX }
      } else if (shouldCarrySender && lastLyricSender) {
        sender = lastLyricSender
      } else {
        sender = {
          side: resolvedSide,
          avatarIndex: resolvedSide === 'left' ? nextLeftAvatarCursor : RIGHT_AVATAR_INDEX
        }
      }

      var isInterlude = line.fullText === INTERLUDE_TEXT
      var emoImage = isInterlude && showEmoMessages
        ? pickStableEmoImage(emoImagePool, 'interlude', line.startTime, lineIndex)
        : null
      var effectiveRenderEndTime = getEffectiveRenderEndTime(line, nextLine)
      if (isInterlude && emoImage && showEmoMessages) {
        messages.push({
          id: 'emo-' + line.startTime + '-' + lineIndex,
          kind: 'emo',
          line: line,
          lineIndex: lineIndex,
          side: sender.side,
          avatarIndex: sender.avatarIndex,
          emoImageUrl: emoImage.url,
          activationStartTime: line.startTime,
          activationEndTime: Math.max(line.startTime + 0.12, effectiveRenderEndTime)
        })
      } else {
        messages.push({
          id: 'line-' + line.startTime + '-' + lineIndex,
          kind: 'lyric',
          line: line,
          lineIndex: lineIndex,
          side: sender.side,
          avatarIndex: sender.avatarIndex
        })
      }
      lyricMessagesSinceRandomEmo += 1

      var renderHints = RenderHints.getLineRenderHints(line)
      var canAppendRandomEmo = !isInterlude
        && showEmoMessages
        && config.sequencing.randomEmoChance > 0
        && randomEmoCount < randomEmoCap
        && lyricMessagesSinceRandomEmo >= config.sequencing.minLinesBetweenRandomEmos
        && renderHints && renderHints.timingClass === 'normal'

      if (canAppendRandomEmo) {
        var score = seededUnit('random-emo', line.startTime, line.endTime, lineIndex, config.sequencing.randomEmoChance)
        if (score < config.sequencing.randomEmoChance) {
          var reactionImage = pickStableEmoImage(emoImagePool, 'reaction', line.startTime, line.endTime, lineIndex, sender.side)
          if (reactionImage) {
            messages.push({
              id: 'emo-reaction-' + line.startTime + '-' + lineIndex,
              kind: 'emo',
              line: line,
              lineIndex: lineIndex,
              side: sender.side,
              avatarIndex: sender.avatarIndex,
              emoImageUrl: reactionImage.url,
              activationStartTime: line.endTime,
              activationEndTime: Math.max(line.endTime + 0.08, effectiveRenderEndTime)
            })
            randomEmoCount += 1
            lyricMessagesSinceRandomEmo = 0
          }
        }
      }

      if (agentSender) {
        lastLyricSender = sender
      } else if (shouldForceRight) {
        sideSequenceCursor = 0
        lastLyricSender = null
      } else if (!shouldCarrySender) {
        if (sender.side === 'left') nextLeftAvatarCursor += 1
        sideSequenceCursor += 1
        lastLyricSender = sender
      } else {
        lastLyricSender = sender
      }
    })

    // 预览模式强制补一张表情：插件没有预览模式，forcePreviewEmo 恒为 false，分支不会触发
    if (forcePreviewEmo && showEmoMessages && !messages.some(function (message) { return message.kind === 'emo' })) {
      var previewLine = lines[0] || { words: [], startTime: 0, endTime: 0, fullText: INTERLUDE_TEXT }
      var previewEmo = pickStableEmoImage(emoImagePool, 'preview-emo', titleText, lines.length)
      if (previewEmo) {
        messages.splice(1, 0, {
          id: 'emo-preview',
          kind: 'emo',
          line: previewLine,
          lineIndex: -1,
          side: 'right',
          avatarIndex: RIGHT_AVATAR_INDEX,
          emoImageUrl: previewEmo.url,
          activationStartTime: 0,
          activationEndTime: Number.POSITIVE_INFINITY
        })
      }
    }

    return messages
  }

  // ---------- 原版消息状态/颜色/时间戳工具 ----------
  var isTimedMessage = function (message) { return message.kind === 'lyric' || message.kind === 'emo' }

  var getTimedMessageState = function (message, currentTime, currentLineIndex) {
    if (message.kind === 'emo') {
      return {
        isActive: currentTime >= message.activationStartTime && currentTime < message.activationEndTime,
        isPassed: currentTime >= message.activationEndTime
      }
    }
    return {
      isActive: message.lineIndex === currentLineIndex,
      isPassed: message.lineIndex < currentLineIndex
    }
  }

  var getVisibleLineIndexAtTime = function (lines, currentTime) {
    for (var index = lines.length - 1; index >= 0; index -= 1) {
      if (currentTime >= lines[index].startTime) return index
    }
    return -1
  }

  var getBubbleColors = function (message, theme) {
    if (message.side === 'right') {
      return {
        backgroundColor: ColorMix.mixColors(theme.accentColor, theme.primaryColor, 0.18, 0.94),
        borderColor: ColorMix.mixColors(theme.accentColor, theme.primaryColor, 0.34, 0.3),
        textColor: theme.backgroundColor
      }
    }

    var avatarTone = (message.avatarIndex % (AVATAR_GRID_SIZE * AVATAR_GRID_SIZE)) / (AVATAR_GRID_SIZE * AVATAR_GRID_SIZE - 1)
    var accentMix = 0.18 + avatarTone * 0.62

    return {
      backgroundColor: ColorMix.mixColors(theme.secondaryColor, theme.accentColor, accentMix, 1),
      borderColor: ColorMix.mixColors(theme.secondaryColor, theme.accentColor, Math.min(accentMix + 0.18, 1), 0.26),
      textColor: theme.primaryColor
    }
  }

  var formatTimestamp = function (seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) return '0:00'

    var totalSeconds = Math.max(0, Math.floor(seconds))
    var minutes = Math.floor(totalSeconds / 60)
    var remainingSeconds = totalSeconds % 60

    return minutes + ':' + (remainingSeconds < 10 ? '0' : '') + remainingSeconds
  }

  var getAvatarPosition = function (avatarIndex) {
    var safeIndex = ((avatarIndex % 9) + 9) % 9
    var col = safeIndex % AVATAR_GRID_SIZE
    var row = Math.floor(safeIndex / AVATAR_GRID_SIZE)

    return {
      backgroundPosition: (col * 50) + '% ' + (row * 50) + '%',
      backgroundSize: (AVATAR_GRID_SIZE * 100) + '% ' + (AVATAR_GRID_SIZE * 100) + '%'
    }
  }

  // ---------- 模式实例 ----------
  function createMode() {
    var host = null
    var rootEl = null      // 模式根容器（z-index 10，独占歌词层）
    var outerEl = null     // 原版 showText 外层容器（响应式 padding 由注入 CSS 处理）
    var columnEl = null    // 原版 max-w-4xl 纵向消息列（AnimatePresence 等价挂载点）
    var styleEl = null     // 注入的 keyframes/响应式样式

    var themeRef = null
    var fontScale = 1      // 原版 lyricsFontScale
    var showText = true
    var intensity = 'normal'
    var intensityConfig = getCappellaIntensityConfig('normal')

    var viewport = { width: 1280, height: 900 }
    var nowRef = 0
    var currentLineIndex = -1
    var visibleLineIndex = -1
    var lastCoverUrl = null

    var messages = []
    var messagesSig = null
    var titleText = ''
    var rows = new Map()           // 消息 id → 行记录
    var exitTimers = new Set()
    var presenceInitialized = false // AnimatePresence initial={false} 等价：首屏批次不播进场动画

    var metricsCache = new Map()   // 原版 bubbleMetricsCacheRef
    var estimateCache = new Map()  // 高度估算缓存（原版走 React memo，这里显式缓存）
    var fontStackCache = { theme: null, stack: '' }
    var imageCache = new Map()     // url → { loaded, callbacks }（new Image 预加载）

    var measureCanvas = null

    // ---------- 基础尺寸（原版 VisualizerCappella 计算） ----------
    function baseFontSizePx() {
      return Math.max(15, Math.min(26, 18 * fontScale))
    }

    function maxTextWidthPx() {
      var maxPanelWidth = Math.min(Math.max(viewport.width - 32, 1), 896)
      var bubbleGroupRatio = viewport.width >= 640 ? 0.68 : 0.78
      return Math.max(96, Math.floor(maxPanelWidth * bubbleGroupRatio - 56))
    }

    function bubbleFontStack() {
      // 主程序歌词字体优先（与 tilt 等模式约定一致），保证测量与 DOM 渲染同一字体
      if (window.foliaGetLyricFontFamily) {
        var hostFont = window.foliaGetLyricFontFamily()
        if (hostFont) return hostFont
      }
      if (fontStackCache.theme !== themeRef) {
        fontStackCache.theme = themeRef
        fontStackCache.stack = resolveThemeFontStack(themeRef)
      }
      return fontStackCache.stack
    }

    // ---------- 文本测量（Pretext 优先，与原版一致；缺失时 canvas 贪心折行回退） ----------
    function getMeasureContext() {
      if (!measureCanvas) measureCanvas = document.createElement('canvas')
      return measureCanvas.getContext('2d')
    }

    // canvas 回退：按字形贪心折行（近似 white-space:pre-wrap + overflow-wrap:anywhere）
    function canvasWrapLines(text, fontSpec, maxWidth) {
      var context = getMeasureContext()
      if (!context) return [{ width: Math.max(text.length, 1) * 8 }]
      context.font = fontSpec
      var graphemes = GraphemeTiming.splitLyricGraphemes(text)
      var lines = []
      var currentWidth = 0
      for (var i = 0; i < graphemes.length; i += 1) {
        var charWidth = context.measureText(graphemes[i]).width
        if (currentWidth > 0 && currentWidth + charWidth > maxWidth) {
          lines.push({ width: currentWidth })
          currentWidth = 0
        }
        currentWidth += charWidth
      }
      lines.push({ width: currentWidth })
      return lines
    }

    function layoutBubbleLines(text, fontSpec, maxWidth, lineHeightPx) {
      var pretext = window.Pretext
      if (pretext && typeof pretext.prepareWithSegments === 'function' && typeof pretext.layoutWithLines === 'function') {
        try {
          var prepared = pretext.prepareWithSegments(text, fontSpec, { whiteSpace: 'pre-wrap' })
          var layout = pretext.layoutWithLines(prepared, Math.max(1, maxWidth), Math.round(lineHeightPx))
          if (layout && layout.lines && layout.lines.length) return layout.lines
          return [{ width: 0 }]
        } catch (error) { /* Pretext 异常时回退 canvas */ }
      }
      return canvasWrapLines(text, fontSpec, maxWidth)
    }

    // 原版 measureBubbleText：返回完整气泡 width/height（含 padding 与 1px 边框）
    function measureBubbleText(text, fontSize, lineHeightPx, maxWidth, paddingX, paddingY) {
      var bubbleBorderWidth = 1
      var safeText = text || ' '
      var fontSpec = resolveThemeFontWeight(themeRef, CAPPELLA_BUBBLE_FONT_WEIGHT) + ' ' + fontSize + 'px ' + bubbleFontStack()
      var lines = layoutBubbleLines(safeText, fontSpec, Math.max(1, maxWidth), lineHeightPx)
      var textWidth = fontSize
      for (var i = 0; i < lines.length; i += 1) {
        if (lines[i].width > textWidth) textWidth = lines[i].width
      }
      var textHeight = Math.max(lines.length, 1) * lineHeightPx

      return {
        width: Math.ceil(Math.min(textWidth, maxWidth) + paddingX * 2 + bubbleBorderWidth * 2),
        height: Math.ceil(textHeight + paddingY * 2 + bubbleBorderWidth * 2)
      }
    }

    // 原版 getOrBuildBubbleMetrics：预计算一行所有前缀的气泡尺寸（LRU 32）
    function getOrBuildBubbleMetrics(params) {
      var line = params.line
      var cacheKey = [
        line.startTime,
        line.endTime,
        line.words ? line.words.length : 0,
        themeRef.name,
        bubbleFontStack(),
        resolveThemeFontWeight(themeRef, CAPPELLA_BUBBLE_FONT_WEIGHT),
        params.fontSize.toFixed(3),
        params.lineHeightPx.toFixed(3),
        params.maxTextWidth,
        params.paddingX,
        params.paddingY
      ].join('|')
      var cached = metricsCache.get(cacheKey)

      if (cached) {
        metricsCache.delete(cacheKey)
        metricsCache.set(cacheKey, cached)
        return cached
      }

      var characters = getLineCharacters(line)
      var revealTimes = buildCharacterRevealTimes(line, characters)
      var fadeDurationsMs = buildCharacterFadeDurationsMs(line, characters)
      var timestampReadyTime = getTimestampReadyTimeFromMetrics(line, revealTimes, fadeDurationsMs)
      // 每个前缀只测一次：文字 reveal 与气泡宽度共用同一张尺寸表，
      // 区别只在用哪条时间轴解析前缀数量
      var bubbleTargetTimes = revealTimes.map(function (time) { return time - CAPPELLA_WIDTH_LOOKAHEAD_SECONDS })
      var sizes = []

      for (var visibleCount = 0; visibleCount <= characters.length; visibleCount += 1) {
        var measuredText = characters.slice(0, visibleCount).join('')
        sizes.push(measureBubbleText(measuredText, params.fontSize, params.lineHeightPx, params.maxTextWidth, params.paddingX, params.paddingY))
      }

      var prepared = { characters: characters, sizes: sizes, revealTimes: revealTimes, bubbleTargetTimes: bubbleTargetTimes, timestampReadyTime: timestampReadyTime }
      metricsCache.set(cacheKey, prepared)

      if (metricsCache.size > CAPPELLA_LAYOUT_CACHE_LIMIT) {
        var oldestKey = metricsCache.keys().next().value
        if (oldestKey !== undefined) metricsCache.delete(oldestKey)
      }

      return prepared
    }

    // ---------- 图片预加载：new Image()，onload 后才用于展示 ----------
    function preloadImage(url) {
      var entry = imageCache.get(url)
      if (!entry) {
        entry = { loaded: false, callbacks: [] }
        var img = new Image()
        var flush = function () {
          if (entry.loaded) return
          entry.loaded = true
          var callbacks = entry.callbacks
          entry.callbacks = []
          for (var i = 0; i < callbacks.length; i += 1) {
            try { callbacks[i]() } catch (error) { /* 回调异常不阻断 */ }
          }
        }
        img.onload = flush
        img.onerror = flush // 加载失败也放行，避免表情永远空白
        imageCache.set(url, entry)
        img.src = url
      }
      return entry
    }

    function whenImageReady(url, callback) {
      var entry = preloadImage(url)
      if (entry.loaded) callback()
      else entry.callbacks.push(callback)
    }

    // ---------- 读取当前计算样式（动画中取实时值，保证过渡连续） ----------
    function currentOpacity(el) {
      var value = parseFloat(getComputedStyle(el).opacity)
      return Number.isFinite(value) ? value : 1
    }

    function currentScale(el) {
      var transform = getComputedStyle(el).transform
      if (!transform || transform === 'none') return 1
      var match = transform.match(/^matrix\(([^)]+)\)$/)
      if (!match) return 1
      var a = parseFloat(match[1].split(',')[0])
      return Number.isFinite(a) && a !== 0 ? a : 1
    }

    function currentMarginTopPx(el) {
      var value = parseFloat(getComputedStyle(el).marginTop)
      return Number.isFinite(value) ? value : 0
    }

    function getTranslateY(el) {
      var transform = getComputedStyle(el).transform
      if (!transform || transform === 'none') return 0
      var match = transform.match(/^matrix\(([^)]+)\)$/)
      if (!match) return 0
      var fy = parseFloat(match[1].split(',')[5])
      return Number.isFinite(fy) ? fy : 0
    }

    // ---------- 行内组弹簧（原版 motion.div animate: opacity/scale/marginTop + avatarSpring） ----------
    // marginTop 需要带单位，无法走 FoliaAnim 的无单位 spring 通道：
    // 用 Anim.simulateSpring 的同一组弹簧采样单独驱动，节奏与 opacity/scale 完全一致。
    function animateGroupMotion(rec, targets) {
      var el = rec.groupEl
      var spring = intensityConfig.motion.avatarSpring
      var springParams = { stiffness: spring.stiffness, damping: spring.damping, mass: spring.mass }

      Anim.animateProps(el, {
        opacity: { from: currentOpacity(el), to: targets.opacity },
        transform: { from: { scale: currentScale(el) }, to: { scale: targets.scale } }
      }, { type: 'spring', stiffness: springParams.stiffness, damping: springParams.damping, mass: springParams.mass })

      var fromMarginTop = currentMarginTopPx(el)
      var toMarginTop = targets.marginTop
      if (Math.abs(toMarginTop - fromMarginTop) < 0.01) {
        el.style.marginTop = toMarginTop + 'px'
        return
      }
      var sim = Anim.simulateSpring(springParams)
      var frames = []
      var offsets = []
      for (var i = 0; i < sim.values.length; i += 1) {
        frames.push((fromMarginTop + (toMarginTop - fromMarginTop) * sim.values[i]) + 'px')
        offsets.push(i / (sim.values.length - 1))
      }
      var animation = el.animate({ marginTop: frames }, { duration: Math.round(sim.duration * 1000), easing: 'linear', fill: 'forwards' })
      var existing = el.__foliaSingleAnims || {}
      if (existing.marginTop) { try { existing.marginTop.cancel() } catch (error) { /* 忽略 */ } }
      existing.marginTop = animation
      el.__foliaSingleAnims = existing
      animation.finished.catch(function () { /* 被替换时忽略 */ })
    }

    // scale(origin=bottom) 的视觉上溢量，作为组元素的 marginTop 补偿（原版 scaleOverflow）
    function computeScaleOverflow(rec) {
      var motionConfig = intensityConfig.motion
      if (!rec.isActive || motionConfig.activeScale <= 1) return 0

      var base
      if (rec.message.kind === 'emo') {
        base = motionConfig.emoActiveSize
      } else if (rec.message.kind === 'lyric' && rec.metrics) {
        var lastSize = rec.metrics.sizes[rec.metrics.sizes.length - 1]
        base = lastSize && lastSize.height !== undefined ? lastSize.height : motionConfig.activeMinHeight
      } else {
        base = motionConfig.activeMinHeight
      }
      base = Math.max(base, 40)
      return Math.ceil(base * (motionConfig.activeScale - 1))
    }

    // 气泡静态样式（颜色/字号/内边距/最小尺寸/阴影），状态或主题变化时整体刷新
    function applyBubbleStaticStyle(rec) {
      var message = rec.message
      var motionConfig = intensityConfig.motion
      var bubbleFontSize = rec.isActive
        ? baseFontSizePx() * motionConfig.activeFontMultiplier
        : message.kind === 'title'
          ? baseFontSizePx()
          : baseFontSizePx() * motionConfig.inactiveFontMultiplier
      var paddingX = rec.isActive ? motionConfig.activePaddingX : motionConfig.inactivePaddingX
      var paddingY = rec.isActive ? motionConfig.activePaddingY : motionConfig.inactivePaddingY
      var colors = getBubbleColors(message, themeRef)
      var lineHeightPx = bubbleFontSize * 1.45

      rec.bubbleFontSize = bubbleFontSize
      rec.paddingX = paddingX
      rec.paddingY = paddingY
      rec.lineHeightPx = lineHeightPx

      var bubbleEl = rec.bubbleEl
      bubbleEl.style.backgroundColor = colors.backgroundColor
      bubbleEl.style.border = '1px solid ' + colors.borderColor
      bubbleEl.style.color = colors.textColor
      bubbleEl.style.fontSize = bubbleFontSize + 'px'
      // 与测量端 fontSpec 使用同一字体栈，保证折行行数一致（否则长歌词会被固定高度裁切）
      bubbleEl.style.fontFamily = bubbleFontStack()
      bubbleEl.style.fontWeight = String(resolveThemeFontWeight(themeRef, CAPPELLA_BUBBLE_FONT_WEIGHT))
      bubbleEl.style.lineHeight = '1.45'
      bubbleEl.style.maxWidth = (maxTextWidthPx() + paddingX * 2 + 2) + 'px'
      bubbleEl.style.minHeight = Math.max(
        rec.isActive ? motionConfig.activeMinHeight : motionConfig.inactiveMinHeight,
        bubbleFontSize * 1.45 + paddingY * 2
      ) + 'px'
      bubbleEl.style.minWidth = rec.isActive ? '72px' : ''
      bubbleEl.style.padding = paddingY + 'px ' + paddingX + 'px'
      bubbleEl.style.boxShadow = rec.isActive
        ? '0 18px 48px ' + ColorMix.mixColors(themeRef.backgroundColor, themeRef.accentColor, 0.2, motionConfig.activeShadowAlpha)
        : '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -4px rgba(0, 0, 0, 0.1)'

      if (rec.timestampEl) rec.timestampEl.style.color = themeRef.secondaryColor
    }

    // 文本模式：逐字（active）或整行（非 active/title）
    function setTextMode(rec, mode) {
      if (rec.textMode === mode) return
      rec.charSpans.forEach(function (span) {
        if (span.parentNode) span.parentNode.removeChild(span)
      })
      rec.charSpans = []
      rec.charHost.textContent = ''
      rec.textMode = mode
      if (mode === 'full') {
        rec.charHost.textContent = rec.message.kind === 'title' ? rec.message.text : rec.message.line.fullText
      }
    }

    // 消息对象被同 id 新对象替换（如标题/强度变化）时刷新整行文本
    function refreshFullText(rec) {
      if (rec.textMode === 'full' && rec.charHost) {
        rec.charHost.textContent = rec.message.kind === 'title' ? rec.message.text : rec.message.line.fullText
      }
    }

    function syncCharSpans(rec, instant) {
      var plan = rec.revealPlan
      if (!plan || !rec.charHost) return
      var desired = Math.max(0, Math.min(rec.visibleCharacterCount, plan.characters.length))

      while (rec.charSpans.length < desired) {
        var index = rec.charSpans.length
        var span = document.createElement('span')
        span.textContent = plan.characters[index]
        if (!instant) {
          var fadeMs = plan.fadeDurationsMs[index] === undefined ? DEFAULT_CHAR_FADE_MS : plan.fadeDurationsMs[index]
          span.style.animation = 'cappella-char-fade ' + fadeMs + 'ms ease-out'
        }
        rec.charHost.appendChild(span)
        rec.charSpans.push(span)
      }

      while (rec.charSpans.length > desired) {
        var removed = rec.charSpans.pop()
        if (removed.parentNode) removed.parentNode.removeChild(removed)
      }
    }

    // active 气泡内的白色扫光（原版 CappellaBubbleGlow）
    function syncGlow(rec) {
      if (rec.message.kind !== 'lyric') return
      var motionConfig = intensityConfig.motion
      var shouldShow = rec.isActive

      if (shouldShow && !rec.glowEl) {
        var glowAlpha = rec.isRight ? motionConfig.glowRightAlpha : motionConfig.glowLeftAlpha
        var glowColor = 'rgba(255,255,255,' + glowAlpha + ')'
        var glowEl = document.createElement('div')
        glowEl.style.cssText = [
          'pointer-events:none', 'position:absolute', 'top:0', 'bottom:0', 'left:0',
          'width:200%',
          'opacity:' + motionConfig.glowOpacity,
          // 上下半区各复制一道宽扫光，保证 translateX(0) 与 translateX(-50%) 完全一致
          'background:linear-gradient(105deg, transparent 0%, ' + glowColor + ' 23%, transparent 34%, transparent 50%, transparent 50%, ' + glowColor + ' 73%, transparent 84%, transparent 100%)',
          'animation:cappella-bubble-glow-pan ' + motionConfig.glowDuration + 's linear infinite',
          'will-change:transform'
        ].join(';')
        rec.glowWrapEl.appendChild(glowEl)
        rec.glowEl = glowEl
      } else if (!shouldShow && rec.glowEl) {
        if (rec.glowEl.parentNode) rec.glowEl.parentNode.removeChild(rec.glowEl)
        rec.glowEl = null
      }
    }

    // 气泡外框尺寸（原版 AnimatedBubbleFrame 的 width/height 动画：0.2s easeOut）
    function setFrameSize(rec, width, height, duration) {
      if (rec.frameW === width && rec.frameH === height) return
      if (duration && rec.frameW !== undefined) {
        var fromWidth = parseFloat(getComputedStyle(rec.frameEl).width) || width
        var fromHeight = parseFloat(getComputedStyle(rec.frameEl).height) || height
        Anim.animateProps(rec.frameEl, {
          width: { from: fromWidth + 'px', to: width + 'px' },
          height: { from: fromHeight + 'px', to: height + 'px' }
        }, { duration: duration, ease: 'easeOut' })
      } else {
        Anim.cancelAnimations(rec.frameEl)
        rec.frameEl.style.width = width + 'px'
        rec.frameEl.style.height = height + 'px'
      }
      rec.frameW = width
      rec.frameH = height
      rec.bubbleEl.style.height = '100%'
    }

    // 表情盒子尺寸（active 更大；原版 emoSizeTransitionDuration easeOut）
    function setEmoBoxSize(rec, size, duration) {
      if (rec.emoW === size && rec.emoH === size) return
      if (duration && rec.emoW !== undefined) {
        var fromWidth = parseFloat(getComputedStyle(rec.emoBoxEl).width) || size
        var fromHeight = parseFloat(getComputedStyle(rec.emoBoxEl).height) || size
        Anim.animateProps(rec.emoBoxEl, {
          width: { from: fromWidth + 'px', to: size + 'px' },
          height: { from: fromHeight + 'px', to: size + 'px' }
        }, { duration: duration, ease: 'easeOut' })
      } else {
        Anim.cancelAnimations(rec.emoBoxEl)
        rec.emoBoxEl.style.width = size + 'px'
        rec.emoBoxEl.style.height = size + 'px'
      }
      rec.emoW = size
      rec.emoH = size
    }

    // 时间戳（原版 CappellaTimestamp）：可见性变化时创建/移除并播 0.18s 进场
    function toggleTimestamp(rec, skipInitial) {
      var message = rec.message
      if (message.kind === 'title') return

      if (rec.timestampVisible && !rec.timestampEl) {
        var span = document.createElement('span')
        span.textContent = formatTimestamp(message.line.endTime)
        span.style.cssText = [
          'position:absolute', 'pointer-events:none',
          'font-size:11px', 'font-weight:500', 'font-variant-numeric:tabular-nums',
          'color:' + themeRef.secondaryColor,
          'bottom:' + (message.kind === 'emo' ? '-2px' : '4px'),
          (rec.isRight ? 'right' : 'left') + ':calc(100% + 8px)'
        ].join(';')
        var parentEl = message.kind === 'emo' ? rec.emoBoxEl : rec.frameEl
        parentEl.appendChild(span)
        rec.timestampEl = span

        if (skipInitial) {
          span.style.opacity = '0.62'
        } else {
          span.style.opacity = '0'
          span.style.transform = 'translateY(4px)'
          requestAnimationFrame(function () {
            if (!span.isConnected) return
            Anim.animateProps(span, {
              opacity: { from: 0, to: 0.62 },
              transform: { from: { y: 4 }, to: { y: 0 } }
            }, { duration: 0.18, ease: 'easeOut' })
          })
        }
      } else if (!rec.timestampVisible && rec.timestampEl) {
        var el = rec.timestampEl
        rec.timestampEl = null
        if (el.parentNode) el.parentNode.removeChild(el)
      }
    }

    // 头像背景图：预加载 onload 后才应用（未加载时只显示底色，与原版加载期表现一致）
    function applyAvatarBackground(rec) {
      if (!rec.avatarUrl || rec.avatarApplied) return
      var entry = imageCache.get(rec.avatarUrl)
      if (entry && entry.loaded) {
        rec.avatarEl.style.backgroundImage = 'url("' + rec.avatarUrl + '")'
        rec.avatarApplied = true
      }
    }

    // 行状态应用：等价原版 CappellaMessageRow 按 isActive/isPassed 重渲染的全部副作用
    // opts.instant  创建即落位（等价 framer “animate 值即初始值”，组弹簧/尺寸不播过渡）
    // opts.charInstant 逐字 span 不播淡入（仅首屏批次为 true，等价 AnimatePresence initial={false} 传播）
    function applyRowState(rec, opts) {
      var instant = Boolean(opts && opts.instant)
      var force = Boolean(opts && opts.force)
      var charInstant = Boolean(opts && opts.charInstant)
      var message = rec.message
      var motionConfig = intensityConfig.motion

      var timed = isTimedMessage(message) ? message : null
      var state = timed ? getTimedMessageState(timed, nowRef, currentLineIndex) : { isActive: false, isPassed: false }
      var changed = state.isActive !== rec.isActive || state.isPassed !== rec.isPassed
      if (!changed && !force) return
      rec.isActive = state.isActive
      rec.isPassed = state.isPassed

      // 组弹簧：opacity（passed 变暗）/ scale（active 放大）/ marginTop（scale 上溢补偿）
      var targetOpacity = rec.isPassed ? motionConfig.passedOpacity : 1
      var targetScale = rec.isActive ? motionConfig.activeScale : rec.isPassed ? motionConfig.passedScale : 1
      var scaleOverflow = computeScaleOverflow(rec)
      if (instant) {
        Anim.cancelAnimations(rec.groupEl)
        rec.groupEl.style.opacity = String(targetOpacity)
        rec.groupEl.style.transform = Anim.transformStr({ scale: targetScale })
        rec.groupEl.style.marginTop = scaleOverflow + 'px'
      } else {
        animateGroupMotion(rec, { opacity: targetOpacity, scale: targetScale, marginTop: scaleOverflow })
      }

      if (message.kind === 'emo') {
        var emoImageSize = rec.isActive ? motionConfig.emoActiveSize : motionConfig.emoInactiveSize
        setEmoBoxSize(rec, emoImageSize, instant ? 0 : motionConfig.emoSizeTransitionDuration)
      } else if (message.kind === 'lyric') {
        applyBubbleStaticStyle(rec)
        if (rec.isActive) {
          rec.metrics = getOrBuildBubbleMetrics({
            line: message.line,
            fontSize: rec.bubbleFontSize,
            lineHeightPx: rec.lineHeightPx,
            maxTextWidth: maxTextWidthPx(),
            paddingX: rec.paddingX,
            paddingY: rec.paddingY
          })
          rec.revealPlan = getCharacterRevealPlan(message.line)
          setTextMode(rec, 'chars')
          rec.visibleCharacterCount = getCharacterCountAtTime(rec.metrics.revealTimes, nowRef)
          syncCharSpans(rec, charInstant)

          var targetCount = getCharacterCountAtTime(rec.metrics.bubbleTargetTimes, nowRef)
          var clampedTargetCount = Math.max(0, Math.min(targetCount, rec.metrics.sizes.length - 1))
          var targetSize = rec.metrics.sizes[clampedTargetCount]
          if (targetSize) setFrameSize(rec, targetSize.width, targetSize.height, instant ? 0 : 0.2)
        } else {
          rec.metrics = null
          rec.revealPlan = null
          setTextMode(rec, 'full')
          // 非 active 歌词也计算显式尺寸，保证 active→passed 过渡时宽高连续动画
          var measured = measureBubbleText(message.line.fullText, rec.bubbleFontSize, rec.lineHeightPx, maxTextWidthPx(), rec.paddingX, rec.paddingY)
          setFrameSize(rec, measured.width, measured.height, instant ? 0 : 0.2)
        }
        syncGlow(rec)
      } else {
        // title：fit-content，不做显式宽高
        applyBubbleStaticStyle(rec)
        setTextMode(rec, 'full')
      }
    }

    // ---------- 行创建（原版 CappellaMessageRow 渲染结果） ----------
    function createRow(message, skipInitial) {
      var motionConfig = intensityConfig.motion
      var isRight = message.side === 'right'
      var isEmo = message.kind === 'emo'

      var rec = {
        id: message.id,
        message: message,
        isRight: isRight,
        isActive: false,
        isPassed: false,
        visibleCharacterCount: 0,
        timestampVisible: false,
        charSpans: [],
        textMode: null,
        metrics: null,
        revealPlan: null,
        glowEl: null,
        timestampEl: null,
        frameW: undefined,
        frameH: undefined,
        emoW: undefined,
        emoH: undefined,
        avatarUrl: null,
        avatarApplied: false,
        emoEnterPlayed: false,
        bubbleFontSize: 0,
        paddingX: 0,
        paddingY: 0,
        lineHeightPx: 0,
        el: null,
        groupEl: null,
        avatarEl: null,
        frameEl: null,
        bubbleEl: null,
        glowWrapEl: null,
        charHost: null,
        emoBoxEl: null,
        emoEnterEl: null
      }

      // 行容器（原版 flex w-full items-end gap-3 justify-*，emo 额外 pt-12）
      var rowEl = document.createElement('div')
      rowEl.style.cssText = [
        'display:flex', 'width:100%', 'align-items:flex-end', 'gap:12px',
        'justify-content:' + (isRight ? 'flex-end' : 'flex-start')
      ].join(';')
      if (isEmo) rowEl.style.paddingTop = '48px'
      rec.el = rowEl

      // 发送者组（原版 flex w-full max-w-[78%] items-end gap-3，右侧反向；transformOrigin 底角）
      var groupEl = document.createElement('div')
      groupEl.className = 'folia-cappella-group'
      groupEl.style.cssText = [
        'display:flex', 'width:100%', 'align-items:flex-end', 'gap:12px',
        'flex-direction:' + (isRight ? 'row-reverse' : 'row'),
        'transform-origin:' + (isRight ? '100% 100%' : '0% 100%')
      ].join(';')
      rec.groupEl = groupEl
      rowEl.appendChild(groupEl)

      // 头像（原版 CappellaAvatar：40px 圆形，cover 模式把封面当 3x3 精灵图裁切）
      var avatarEl = document.createElement('div')
      avatarEl.style.cssText = [
        'width:40px', 'height:40px', 'flex-shrink:0', 'overflow:hidden',
        'border-radius:9999px', 'border:1px solid rgba(255,255,255,0.24)',
        'box-shadow:0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -4px rgba(0, 0, 0, 0.1)',
        'background-color:' + themeRef.secondaryColor,
        'background-repeat:no-repeat', 'background-clip:padding-box'
      ].join(';')
      var avatarUrl = resolveCappellaAvatarUrl({
        avatarSource: TUNING.avatarSource,
        coverUrl: lastCoverUrl,
        avatarIndex: message.avatarIndex,
        side: message.side,
        seed: titleText, // 原版 avatarSeed = seed ?? titleText，插件无 seed 用歌名替代
        avatars: BUILTIN_AVATAR_IMAGES,
        customAvatarImages: []
      })
      var useAvatarGridCrop = (TUNING.avatarSource === 'cover' && Boolean(lastCoverUrl)) || !avatarUrl
      var resolvedIndex = useAvatarGridCrop
        ? (isRight ? RIGHT_AVATAR_INDEX : LEFT_AVATAR_INDICES[message.avatarIndex % LEFT_AVATAR_INDICES.length])
        : message.avatarIndex
      var avatarPosition = getAvatarPosition(resolvedIndex)
      avatarEl.style.backgroundPosition = useAvatarGridCrop ? avatarPosition.backgroundPosition : 'center'
      avatarEl.style.backgroundSize = useAvatarGridCrop ? avatarPosition.backgroundSize : 'cover'
      if (!avatarUrl) {
        avatarEl.style.backgroundImage = 'linear-gradient(135deg, ' + themeRef.primaryColor + ', ' + themeRef.accentColor + ')'
      }
      rec.avatarEl = avatarEl
      rec.avatarUrl = avatarUrl
      groupEl.appendChild(avatarEl)

      if (isEmo) {
        // 表情盒子（原版 motion.div：尺寸 = emoImageSize，内部一层进场缩放 + wiggle 图片）
        var emoBoxEl = document.createElement('div')
        emoBoxEl.style.cssText = 'position:relative;flex-shrink:0'
        var emoEnterEl = document.createElement('div')
        emoEnterEl.style.cssText = 'width:100%;height:100%;display:block'
        var emoImg = document.createElement('img')
        emoImg.src = message.emoImageUrl
        emoImg.alt = 'emo'
        emoImg.style.cssText = [
          'width:100%', 'height:100%', 'object-fit:contain', 'display:block',
          'border-radius:16px',
          'animation:cappella-emo-wiggle 1.9s ease-in-out infinite',
          'will-change:transform'
        ].join(';')
        emoEnterEl.appendChild(emoImg)
        emoBoxEl.appendChild(emoEnterEl)
        groupEl.appendChild(emoBoxEl)
        rec.emoBoxEl = emoBoxEl
        rec.emoEnterEl = emoEnterEl
      } else {
        // 气泡外框（原版 AnimatedBubbleFrame：显式宽高动画，inner 承载样式）
        var frameEl = document.createElement('div')
        frameEl.style.cssText = 'position:relative;flex-shrink:0'
        var bubbleEl = document.createElement('div')
        bubbleEl.style.cssText = [
          'position:relative', 'overflow:hidden',
          'white-space:pre-wrap', 'overflow-wrap:anywhere',
          'height:auto',
          'border-radius:24px',
          'transition:min-height 0.2s ease-out, box-shadow 0.2s ease-out, background-color 0.2s ease-out'
        ].join(';')
        bubbleEl.style[isRight ? 'borderBottomRightRadius' : 'borderBottomLeftRadius'] = '6px'
        var glowWrapEl = document.createElement('div')
        glowWrapEl.style.cssText = 'position:absolute;top:0;right:0;bottom:0;left:0;overflow:hidden;border-radius:inherit;pointer-events:none'
        var charHost = document.createElement('span')
        charHost.style.cssText = 'position:relative;z-index:10'
        bubbleEl.appendChild(glowWrapEl)
        bubbleEl.appendChild(charHost)
        frameEl.appendChild(bubbleEl)
        groupEl.appendChild(frameEl)
        rec.frameEl = frameEl
        rec.bubbleEl = bubbleEl
        rec.glowWrapEl = glowWrapEl
        rec.charHost = charHost
      }

      columnEl.appendChild(rowEl)
      rows.set(rec.id, rec)

      // 初始状态（等价 framer “animate 值即初始值”；force 使首帧样式必然应用）
      rec.isActive = isTimedMessage(message)
        ? getTimedMessageState(message, nowRef, currentLineIndex).isActive
        : false
      rec.isPassed = isTimedMessage(message)
        ? getTimedMessageState(message, nowRef, currentLineIndex).isPassed
        : false
      applyRowState(rec, { instant: true, force: true, charInstant: skipInitial })

      // 时间戳初始可见性（原版 useState 初始值逻辑）
      var timestampVisible = false
      if (message.kind === 'emo') {
        timestampVisible = nowRef >= message.activationEndTime
      } else if (message.kind === 'lyric') {
        timestampVisible = rec.isPassed || (rec.isActive && rec.metrics
          ? nowRef >= rec.metrics.timestampReadyTime
          : nowRef >= message.line.endTime)
      }
      rec.timestampVisible = timestampVisible
      if (timestampVisible) toggleTimestamp(rec, skipInitial)

      // 头像进场（0.2s easeOut；首屏批次跳过，等价 AnimatePresence initial={false}）
      if (!skipInitial) {
        avatarEl.style.opacity = '0'
        requestAnimationFrame(function () {
          if (!avatarEl.isConnected) return
          Anim.animateProps(avatarEl, { opacity: { from: 0, to: 1 } }, { duration: 0.2, ease: 'easeOut' })
        })
      } else {
        avatarEl.style.opacity = '1'
      }

      // 表情进场：图片 onload 后才展示（opacity 0 + scale emoEnterScale → 1）
      if (isEmo) {
        if (!skipInitial) {
          rec.emoEnterEl.style.opacity = '0'
          whenImageReady(message.emoImageUrl, function () {
            if (rec.emoEnterPlayed || !rec.emoEnterEl || !rec.emoEnterEl.isConnected) return
            rec.emoEnterPlayed = true
            Anim.animateProps(rec.emoEnterEl, {
              opacity: { from: 0, to: 1 },
              transform: { from: { scale: motionConfig.emoEnterScale }, to: { scale: 1 } }
            }, { duration: motionConfig.rowEnterDuration, ease: 'easeOut' })
          })
        } else {
          rec.emoEnterPlayed = true
          rec.emoEnterEl.style.opacity = '1'
        }
      }

      // 行进场（原版 initial {opacity:0, y, scale} → animate {1, 0, 1}）
      if (!skipInitial) {
        rowEl.style.opacity = '0'
        rowEl.style.transform = Anim.transformStr({ y: motionConfig.rowEnterY, scale: motionConfig.rowEnterScale })
        requestAnimationFrame(function () {
          if (!rowEl.isConnected) return
          Anim.animateProps(rowEl, {
            opacity: { from: 0, to: 1 },
            transform: { from: { y: motionConfig.rowEnterY, scale: motionConfig.rowEnterScale }, to: { y: 0, scale: 1 } }
          }, { duration: motionConfig.rowEnterDuration, ease: 'easeOut' })
        })
      }

      return rec
    }

    // 行退场（原版 AnimatePresence popLayout exit：脱离文档流 + 退场动画后移除）
    function exitRow(rec) {
      rows.delete(rec.id)
      var el = rec.el
      var motionConfig = intensityConfig.motion

      // popLayout：绝对定位钉在当前位置，不再占据布局空间
      var top = el.offsetTop
      el.style.position = 'absolute'
      el.style.top = top + 'px'
      el.style.left = '0'
      el.style.right = '0'

      Anim.animateProps(el, {
        opacity: { from: currentOpacity(el), to: 0 },
        transform: { from: { y: getTranslateY(el), scale: 1 }, to: { y: motionConfig.rowExitY, scale: motionConfig.rowExitScale } }
      }, { duration: motionConfig.rowExitDuration, ease: 'easeIn' })

      var timer = window.setTimeout(function () {
        exitTimers.delete(timer)
        if (el.parentNode) el.parentNode.removeChild(el)
      }, Math.round(motionConfig.rowExitDuration * 1000 + 60))
      exitTimers.add(timer)
    }

    function clearRows() {
      if (columnEl) {
        while (columnEl.firstChild) columnEl.removeChild(columnEl.firstChild)
      }
      rows.clear()
      presenceInitialized = false
    }

    // ---------- 可见消息集合（原版 getVisibleMessages） ----------
    function getEstimatedMessageHeight(message, isActive) {
      var motionConfig = intensityConfig.motion
      if (message.kind === 'emo') {
        var imageSize = isActive ? motionConfig.emoActiveSize : motionConfig.emoInactiveSize
        var emoOverflow = isActive && motionConfig.activeScale > 1
          ? Math.ceil(imageSize * (motionConfig.activeScale - 1))
          : 0
        return imageSize + emoOverflow + 48 + 12 // 图像高度 + 缩放上溢 + pt-12 (48px) + gap-3 (12px)
      }

      var fontSize = message.kind === 'title'
        ? baseFontSizePx()
        : baseFontSizePx() * (isActive ? motionConfig.activeFontMultiplier : motionConfig.inactiveFontMultiplier)
      var paddingX = isActive ? motionConfig.activePaddingX : motionConfig.inactivePaddingX
      var paddingY = isActive ? motionConfig.activePaddingY : motionConfig.inactivePaddingY
      var lineHeightPx = fontSize * 1.45
      var measuredHeight = measureBubbleText(
        message.kind === 'title' ? message.text : message.line.fullText,
        fontSize,
        lineHeightPx,
        maxTextWidthPx(),
        paddingX,
        paddingY
      ).height
      var minHeight = Math.max(
        isActive ? motionConfig.activeMinHeight : motionConfig.inactiveMinHeight,
        lineHeightPx + paddingY * 2
      )
      var renderedHeight = Math.max(measuredHeight, minHeight)
      var scaleOverflow = isActive && motionConfig.activeScale > 1
        ? Math.ceil(renderedHeight * (motionConfig.activeScale - 1))
        : 0

      return renderedHeight + scaleOverflow + 12 // 气泡高度 + 缩放上溢 + gap-3 (12px)
    }

    function getEstimatedMessageHeightCached(message, isActive) {
      var key = message.id + '|' + (isActive ? 1 : 0) + '|' + baseFontSizePx().toFixed(3) + '|' + maxTextWidthPx() + '|' + intensity + '|' + (themeRef ? themeRef.name : '')
      var cached = estimateCache.get(key)
      if (cached !== undefined) return cached
      var height = getEstimatedMessageHeight(message, isActive)
      if (estimateCache.size > 512) estimateCache.clear()
      estimateCache.set(key, height)
      return height
    }

    function getVisibleMessages(currentTime) {
      // 过滤：title 恒显；emo 到激活时间出现；lyric 按可见行下标
      var visible = []
      for (var i = 0; i < messages.length; i += 1) {
        var message = messages[i]
        if (message.kind === 'title') {
          visible.push(message)
          continue
        }
        if (message.kind === 'emo') {
          if (currentTime >= message.activationStartTime) visible.push(message)
          continue
        }
        if (message.lineIndex <= visibleLineIndex) visible.push(message)
      }

      // 气泡区域可用高度：总高减去底部播放控制条 (~160px) 和顶部状态栏/间距 (~80px)
      var usableHeight = Math.max(200, viewport.height - 240)
      var accumulatedHeight = 0
      var result = []

      // 从最新消息（末尾）反向往前累加，防止下方溢出；至少保留 2 条上下文
      for (var j = visible.length - 1; j >= 0; j -= 1) {
        var messageItem = visible[j]
        var timed = isTimedMessage(messageItem) ? messageItem : null
        var isActive = timed ? getTimedMessageState(timed, currentTime, currentLineIndex).isActive : false
        var estimatedHeight = getEstimatedMessageHeightCached(messageItem, isActive)

        if (accumulatedHeight + estimatedHeight > usableHeight && result.length >= 2) break

        accumulatedHeight += estimatedHeight
        result.unshift(messageItem)

        if (result.length >= MAX_VISIBLE_MESSAGES) break
      }

      return result
    }

    // ---------- 行集合同步（AnimatePresence popLayout + layout="position" 的手动等价） ----------
    function syncRows(visibleMessages) {
      var desiredIds = new Set()
      var added = []
      var removed = []
      var i

      for (i = 0; i < visibleMessages.length; i += 1) {
        var message = visibleMessages[i]
        desiredIds.add(message.id)
        var existing = rows.get(message.id)
        if (existing) {
          if (existing.message !== message) {
            existing.message = message
            refreshFullText(existing)
          }
        } else {
          added.push(message)
        }
      }

      rows.forEach(function (rec, id) {
        if (!desiredIds.has(id)) removed.push(rec)
      })

      if (removed.length === 0 && added.length === 0) return

      // FLIP 快照：移除旧行前记录留流行（含进行中位移）的视觉位置
      var snapshots = null
      if (removed.length > 0) {
        snapshots = new Map()
        rows.forEach(function (rec, id) {
          if (desiredIds.has(id)) {
            snapshots.set(id, rec.el.offsetTop + getTranslateY(rec.el))
          }
        })
      }

      removed.forEach(exitRow)

      // AnimatePresence initial={false}：首个批次（挂载/重新显示）不播进场动画
      var skipInitial = !presenceInitialized
      for (i = 0; i < added.length; i += 1) createRow(added[i], skipInitial)
      presenceInitialized = true

      // FLIP：布局变化后把留流行弹回原视觉位置（近似原版 layout="position" 位移弹簧）
      if (snapshots) {
        rows.forEach(function (rec, id) {
          var snapshot = snapshots.get(id)
          if (snapshot === undefined) return
          var delta = snapshot - rec.el.offsetTop
          if (Math.abs(delta) > 0.5) {
            Anim.animateProps(rec.el, {
              transform: { from: { y: delta }, to: { y: 0 } }
            }, { type: 'spring', stiffness: 500, damping: 40 })
          }
        })
      }
    }

    // ---------- 每帧行更新（原版 useMotionValueEvent(currentTime) 的行级副作用） ----------
    function updateRowFrame(rec, currentTime) {
      var message = rec.message
      applyAvatarBackground(rec)
      if (message.kind === 'title') return

      var state = getTimedMessageState(message, currentTime, currentLineIndex)
      if (state.isActive !== rec.isActive || state.isPassed !== rec.isPassed) {
        applyRowState(rec, {})
      }

      // active 歌词：逐字 reveal 计数 + 气泡目标尺寸（用提前 0.2s 的 bubbleTargetTimes）
      if (message.kind === 'lyric' && rec.isActive && rec.metrics) {
        var nextVisibleCount = getCharacterCountAtTime(rec.metrics.revealTimes, currentTime)
        if (nextVisibleCount !== rec.visibleCharacterCount) {
          rec.visibleCharacterCount = nextVisibleCount
          syncCharSpans(rec, false)
        }
        var nextTargetCount = getCharacterCountAtTime(rec.metrics.bubbleTargetTimes, currentTime)
        var clampedTargetCount = Math.max(0, Math.min(nextTargetCount, rec.metrics.sizes.length - 1))
        var targetSize = rec.metrics.sizes[clampedTargetCount]
        if (targetSize) setFrameSize(rec, targetSize.width, targetSize.height, 0.2)
      }

      // 时间戳可见性：emo 看 activationEndTime；lyric 看 isPassed 或最后一个字符淡入完成
      var timestampVisible
      if (message.kind === 'emo') {
        timestampVisible = currentTime >= message.activationEndTime
      } else {
        timestampVisible = rec.isPassed
          ? true
          : (rec.isActive && rec.metrics
            ? currentTime >= rec.metrics.timestampReadyTime
            : currentTime >= message.line.endTime)
      }
      if (timestampVisible !== rec.timestampVisible) {
        rec.timestampVisible = timestampVisible
        toggleTimestamp(rec, false)
      }
    }

    // ---------- 消息序列重建（原版 buildCappellaMessages useMemo） ----------
    function ensureMessages(lines) {
      var nextIntensity = themeRef.animationIntensity || 'normal'
      var nextTitle = (frameTitleText || '').trim() || '未在播放' // 原版 t('ui.noTrack')
      var sig = [
        lines.length,
        lines.length ? lines[0].startTime : '',
        lines.length ? lines[lines.length - 1].endTime : '',
        lines.length ? lines[0].fullText : '',
        lines.length ? lines[lines.length - 1].fullText : '',
        nextTitle,
        nextIntensity
      ].join('|')
      if (sig === messagesSig) return

      messagesSig = sig
      titleText = nextTitle
      intensity = nextIntensity
      intensityConfig = getCappellaIntensityConfig(nextIntensity)
      messages = buildCappellaMessages(lines, titleText, intensityConfig, TUNING, BUILTIN_EMO_IMAGES, false)
      estimateCache.clear()
      // 强度变化会改变字号倍率/内边距/表情尺寸：以新配置强制刷新现有行样式
      rows.forEach(function (rec) {
        applyRowState(rec, { force: true })
      })
    }

    // ---------- 注入样式（原版 <style> keyframes + Tailwind 响应式等价） ----------
    function injectStyle() {
      styleEl = document.getElementById('folia-cappella-style')
      if (styleEl) return
      styleEl = document.createElement('style')
      styleEl.id = 'folia-cappella-style'
      styleEl.textContent = [
        // Tailwind preflight 等价：border-box（尺寸表含 padding/边框，依赖 border-box 语义）
        '.folia-cappella-root, .folia-cappella-root * { box-sizing: border-box; }',
        // 原版外层容器 px-4 pb-36 pt-12 / sm:px-8 sm:pb-40 sm:pt-16 / lg:px-14 lg:pt-20
        '.folia-cappella-outer { position: relative; display: flex; width: 100%; height: 100%; align-items: flex-start; justify-content: center; overflow: visible; padding: 48px 16px 144px; }',
        '@media (min-width: 640px) { .folia-cappella-outer { padding: 64px 32px 160px; } }',
        '@media (min-width: 1024px) { .folia-cappella-outer { padding: 80px 56px 160px; } }',
        // 原版 relative flex w-full max-w-4xl flex-col justify-start gap-3 overflow-visible
        '.folia-cappella-column { position: relative; display: flex; flex-direction: column; justify-content: flex-start; gap: 12px; width: 100%; max-width: 896px; overflow: visible; }',
        // 原版 max-w-[78%] sm:max-w-[68%]
        '.folia-cappella-group { max-width: 78%; }',
        '@media (min-width: 640px) { .folia-cappella-group { max-width: 68%; } }',
        '@keyframes cappella-char-fade { from { opacity: 0; } to { opacity: 1; } }',
        '@keyframes cappella-bubble-glow-pan { from { transform: translateX(0); } to { transform: translateX(-50%); } }',
        '@keyframes cappella-emo-wiggle { 0%, 100% { transform: rotate(-1.6deg); } 50% { transform: rotate(1.6deg); } }'
      ].join('\n')
      document.head.appendChild(styleEl)
    }

    // ---------- Pretext 懒加载（registry 未给 cappella 配 vendor，模式自行加载后清缓存重测） ----------
    function ensurePretext() {
      if (window.Pretext) return
      if (window.FoliaRegistry && typeof window.FoliaRegistry.loadScript === 'function') {
        window.FoliaRegistry.loadScript('vendor/pretext.iife.js').then(function () {
          metricsCache.clear()
          estimateCache.clear()
          // 加载前创建的气泡用 canvas 度量建了尺寸表，pretext 就绪后强制重测对齐
          rows.forEach(function (rec) { applyRowState(rec, { force: true }) })
        }).catch(function () { /* 加载失败保持 canvas 回退 */ })
      }
    }

    // ---------- 视口（原版 viewportSize state + resize effect） ----------
    function handleResize() {
      viewport.width = window.innerWidth
      viewport.height = window.innerHeight
      estimateCache.clear()
      rows.forEach(function (rec) {
        applyRowState(rec, { force: true })
      })
    }

    // ---------- 生命周期 ----------
    function mount(hostEl) {
      host = hostEl
      viewport = { width: window.innerWidth, height: window.innerHeight }

      // 字体异步就绪后（webfont 场景）已有气泡的度量会过期，清缓存并强制重测
      if (document.fonts && document.fonts.ready) {
        document.fonts.ready.then(function () {
          metricsCache.clear()
          estimateCache.clear()
          rows.forEach(function (rec) { applyRowState(rec, { force: true }) })
        })
      }

      rootEl = document.createElement('div')
      rootEl.className = 'folia-cappella-root'
      rootEl.style.cssText = 'position:absolute;inset:0;z-index:10;pointer-events:none;overflow:visible'

      outerEl = document.createElement('div')
      outerEl.className = 'folia-cappella-outer'
      columnEl = document.createElement('div')
      columnEl.className = 'folia-cappella-column'
      outerEl.appendChild(columnEl)
      rootEl.appendChild(outerEl)
      hostEl.appendChild(rootEl)

      injectStyle()

      window.addEventListener('resize', handleResize)

      // 内置表情/头像全部预加载，onload 后才用于展示
      BUILTIN_EMO_IMAGES.forEach(function (image) { preloadImage(image.url) })
      BUILTIN_AVATAR_IMAGES.forEach(function (image) { preloadImage(image.url) })

      ensurePretext()
    }

    function setTheme(newTheme) {
      var previousIntensity = themeRef ? themeRef.animationIntensity : null
      themeRef = newTheme
      fontStackCache.theme = null
      estimateCache.clear()
      if (newTheme && newTheme.animationIntensity && newTheme.animationIntensity !== previousIntensity) {
        // 强度变化 → 消息序列（朝向/表情分布）与运动参数一起重建
        messagesSig = null
      }
      rows.forEach(function (rec) {
        applyRowState(rec, { force: true })
      })
    }

    function setLines() { /* 行数据经 tick 的 frameState.lines 传入 */ }

    function setFontScale(scale) {
      var next = scale === undefined ? 1 : scale
      if (next === fontScale) return
      fontScale = next
      estimateCache.clear()
      rows.forEach(function (rec) {
        applyRowState(rec, { force: true })
      })
    }

    // frameState.songTitle 供 ensureMessages 使用（挂在实例闭包外层变量）
    var frameTitleText = ''

    function tick(frameState) {
      if (!rootEl || !themeRef) return
      var currentTime = frameState.currentTime
      nowRef = currentTime
      if (frameState.theme && frameState.theme !== themeRef) setTheme(frameState.theme)

      var lines = frameState.lines || []
      currentLineIndex = typeof frameState.currentLineIndex === 'number' ? frameState.currentLineIndex : -1
      showText = frameState.showText !== false
      frameTitleText = frameState.songTitle || ''
      lastCoverUrl = frameState.coverUrl || null
      if (lastCoverUrl) preloadImage(lastCoverUrl)

      // 原版 useVisualizerRuntime：活动行/最近完成行/下一行
      var runtimeState = Runtime.getRuntimeState({
        lines: lines,
        currentLineIndex: currentLineIndex,
        currentTime: currentTime,
        getLineEndTime: RenderHints.getLineRenderEndTime
      })

      // 原版 useMotionValueEvent：预热窗口内的下一行气泡度量提前构建
      var upcomingLine = runtimeState.upcomingLine
      if (upcomingLine && Runtime.shouldPreheatLine(upcomingLine, currentTime, CAPPELLA_PREHEAT_WINDOW)) {
        var motionConfig = intensityConfig.motion
        getOrBuildBubbleMetrics({
          line: upcomingLine,
          fontSize: baseFontSizePx() * motionConfig.activeFontMultiplier,
          lineHeightPx: baseFontSizePx() * motionConfig.activeFontMultiplier * 1.45,
          maxTextWidth: maxTextWidthPx(),
          paddingX: motionConfig.activePaddingX,
          paddingY: motionConfig.activePaddingY
        })
      }

      visibleLineIndex = getVisibleLineIndexAtTime(lines, currentTime)

      if (!showText) {
        if (rows.size > 0) clearRows()
        window.FoliaSubtitleOverlay.update({
          hostEl: host,
          showText: false,
          activeLine: null,
          recentCompletedLine: runtimeState.recentCompletedLine,
          nextLines: runtimeState.nextLines,
          theme: themeRef
        })
        return
      }

      ensureMessages(lines)
      syncRows(getVisibleMessages(currentTime))
      rows.forEach(function (rec) {
        updateRowFrame(rec, currentTime)
      })

      // 底部字幕兜底（与原版 VisualizerSubtitleOverlay 一致）
      window.FoliaSubtitleOverlay.update({
        hostEl: host,
        showText: showText,
        activeLine: runtimeState.activeLine,
        recentCompletedLine: runtimeState.recentCompletedLine,
        nextLines: runtimeState.nextLines,
        theme: themeRef
      })
    }

    function destroy() {
      exitTimers.forEach(function (timer) {
        window.clearTimeout(timer)
      })
      exitTimers.clear()
      window.removeEventListener('resize', handleResize)
      if (styleEl && styleEl.parentNode) {
        styleEl.parentNode.removeChild(styleEl)
      }
      styleEl = null
      if (rootEl) {
        rootEl.remove()
        rootEl = null
      }
      outerEl = null
      columnEl = null
      rows.clear()
      metricsCache.clear()
      estimateCache.clear()
      imageCache.clear()
      messages = []
      messagesSig = null
      titleText = ''
      frameTitleText = ''
      lastCoverUrl = null
      presenceInitialized = false
      nowRef = 0
      currentLineIndex = -1
      visibleLineIndex = -1
      window.FoliaSubtitleOverlay.destroy()
      host = null
    }

    return {
      id: 'cappella',
      mount: mount,
      setTheme: setTheme,
      setLines: setLines,
      setFontScale: setFontScale,
      tick: tick,
      destroy: destroy
    }
  }

  window.FoliaModeCappella = { create: createMode }
})()
