// 时计模式（pendolo）：移植自 folia-major src/components/visualizer/pendolo/
//   - VisualizerPendolo.tsx（主组件：表盘弧形歌词布局 + 擒纵棘轮弹簧 + 滚轮/触摸手动锚点 + 纯器乐状态）
//   - PendoloClockworkCanvas.tsx（钟表机芯 canvas：擒纵齿轮/行星轮/摆轮游丝/ Geneva 条纹/表盘渐变与封面）
//   - PendoloActiveLyricSweep.tsx（活动行逐字扫过填充 sweep，颜色 runs + mask 渐变边缘）
//   - PendoloRotatingLine.tsx（随轮盘旋转的歌词行，弧外淡出）
// React/framer-motion → 原生 JS 对应：useState/useRef → 闭包变量；useSpring → 手写弹簧积分；
// useMotionValueEvent/MotionValue → tick(frameState) 内直读；useTransform → 每帧直接计算；
// ResizeObserver 保留。核心几何/排版/运动档位见 modes/pendolo-core.js（window.FoliaPendoloCore）。
(function () {
  'use strict'

  var Core = window.FoliaPendoloCore
  var ColorMix = window.FoliaColorMix
  var Runtime = window.FoliaVisualizerRuntime
  var RenderHints = window.FoliaRenderHints
  var WordColoring = window.FoliaWordColoring
  var LyricsData = window.FoliaLyricsData
  var GraphemeTiming = window.FoliaGraphemeTiming

  // 原版 DEFAULT_PENDOLO_TUNING（内联常量）
  var TUNING = Core.DEFAULT_PENDOLO_TUNING

  // 原版 VisualizerPendolo 顶部常量
  var PENDOLO_SCROLL_IDLE_RESET_MS = 2500
  var PENDOLO_SCROLL_STEP_PX = 90
  var PENDOLO_TOUCH_STEP_PX = 60
  var READY_GRACE_MS = 3000
  var INSTRUMENTAL_COMMIT_SECONDS = 2
  var INSTRUMENTAL_SECONDS_PER_FRAME = 5

  // 原版 utils/fontStacks.ts 内置歌词字体栈（foliaGetLyricFontFamily 缺失时的回退）
  var LYRIC_FONT_STACK_FALLBACK = '"Inter", "Noto Sans CJK SC", "Noto Sans JP", "Source Han Sans SC", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Helvetica Neue", Arial, sans-serif'
  var TRANSLATION_FONT_STACKS = {
    sans: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", "Inter", "Helvetica Neue", Arial, "Noto Sans CJK SC", "Source Han Sans SC", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans JP", "Source Han Sans JP", "Hiragino Sans", "Yu Gothic", Meiryo, sans-serif',
    serif: '"獅尾四季春加糖SC", "Folia Noto Serif SC", "Iowan Old Style", Georgia, "Times New Roman", "Noto Serif CJK SC", "Source Han Serif SC", "Songti SC", "STSong", "SimSun", "Noto Serif JP", "Source Han Serif JP", "Yu Mincho", "MS PMincho", serif',
    mono: 'Consolas, "IBM Plex Mono", "SFMono-Regular", Menlo, Monaco, "Sarasa Mono SC", "Noto Sans Mono CJK SC", "SimHei", "DengXian", "Microsoft YaHei UI", "Microsoft YaHei", "Noto Sans Mono CJK JP", "MS Gothic", monospace'
  }

  // lucide-react Star 图标（theme.lyricsIcons 为空数组时的兜底 BalanceIcon）
  var STAR_ICON_POINTS = '12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2'

  // ---------- 原版 PendoloClockworkCanvas.tsx 的绘制函数 ----------

  // 线框齿轮：N 个梯形齿
  function drawGearTeeth(ctx, cx, cy, radius, teethCount, toothDepth, rotationRad, strokeColor, lineWidth, fillColor) {
    ctx.save()
    ctx.translate(cx, cy)
    ctx.rotate(rotationRad)

    var innerR = radius - toothDepth
    var outerR = radius
    var anglePerTooth = (Math.PI * 2) / teethCount

    ctx.beginPath()
    for (var i = 0; i < teethCount; i++) {
      var baseAngle = i * anglePerTooth
      var a0 = baseAngle - anglePerTooth * 0.22
      var a1 = baseAngle - anglePerTooth * 0.12
      var a2 = baseAngle + anglePerTooth * 0.12
      var a3 = baseAngle + anglePerTooth * 0.22

      var x0 = innerR * Math.cos(a0)
      var y0 = innerR * Math.sin(a0)
      var x1 = outerR * Math.cos(a1)
      var y1 = outerR * Math.sin(a1)
      var x2 = outerR * Math.cos(a2)
      var y2 = outerR * Math.sin(a2)
      var x3 = innerR * Math.cos(a3)
      var y3 = innerR * Math.sin(a3)

      if (i === 0) {
        ctx.moveTo(x0, y0)
      } else {
        ctx.lineTo(x0, y0)
      }
      ctx.lineTo(x1, y1)
      ctx.lineTo(x2, y2)
      ctx.lineTo(x3, y3)
    }
    ctx.closePath()

    if (fillColor) {
      ctx.fillStyle = fillColor
      ctx.fill()
    }
    ctx.strokeStyle = strokeColor
    ctx.lineWidth = lineWidth
    ctx.stroke()

    ctx.restore()
  }

  // 辐条轮：带圆形减重窗
  function drawSpokedWheel(ctx, cx, cy, hubR, rimR, spokeCount, rotationRad, strokeColor, lineWidth) {
    ctx.save()
    ctx.translate(cx, cy)
    ctx.rotate(rotationRad)

    ctx.strokeStyle = strokeColor
    ctx.lineWidth = lineWidth

    // 毂与轮辋圆
    ctx.beginPath()
    ctx.arc(0, 0, hubR, 0, Math.PI * 2)
    ctx.stroke()

    ctx.beginPath()
    ctx.arc(0, 0, rimR, 0, Math.PI * 2)
    ctx.stroke()

    // 径向辐条
    var angleStep = (Math.PI * 2) / spokeCount
    for (var i = 0; i < spokeCount; i++) {
      var a = i * angleStep
      ctx.beginPath()
      ctx.moveTo(hubR * Math.cos(a), hubR * Math.sin(a))
      ctx.lineTo(rimR * Math.cos(a), rimR * Math.sin(a))
      ctx.stroke()
    }

    // 中半径处的减重孔
    var midR = (hubR + rimR) * 0.5
    var holeR = (rimR - hubR) * 0.22
    for (var j = 0; j < spokeCount; j++) {
      var ah = j * angleStep + angleStep * 0.5
      ctx.beginPath()
      ctx.arc(midR * Math.cos(ah), midR * Math.sin(ah), holeR, 0, Math.PI * 2)
      ctx.stroke()
    }

    ctx.restore()
  }

  // 线框螺旋游丝
  function drawHairspring(ctx, cx, cy, startR, endR, coils, oscillationRad, strokeColor, lineWidth) {
    ctx.save()
    ctx.translate(cx, cy)
    ctx.rotate(oscillationRad)

    ctx.strokeStyle = strokeColor
    ctx.lineWidth = lineWidth

    var totalAngle = coils * Math.PI * 2
    var steps = Math.round(coils * 60)

    ctx.beginPath()
    for (var i = 0; i <= steps; i++) {
      var t = i / steps
      var angle = t * totalAngle
      var r = startR + (endR - startR) * Math.pow(t, 0.9)
      var x = r * Math.cos(angle)
      var y = r * Math.sin(angle)
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.stroke()

    ctx.restore()
  }

  // 机芯最远像素到轮心的距离（CSS 像素）
  function resolveClockworkReach(baseRadius, hasCenterGradient) {
    return baseRadius * (hasCenterGradient ? 1.65 : 1.4) + 16
  }

  // 画布只框住机芯本身，不为视口分配透明像素
  function resolveClockworkBox(centerX, centerY, baseRadius, lyricRingRadius, viewportWidth, viewportHeight, hasCenterGradient) {
    var reach = resolveClockworkReach(baseRadius, hasCenterGradient)
    var rightReach = Math.max(reach, lyricRingRadius + 16)
    var left = Math.max(0, Math.floor(centerX - reach))
    var top = Math.max(0, Math.floor(centerY - reach))
    var right = Math.min(viewportWidth, Math.ceil(centerX + rightReach))
    var bottom = Math.min(viewportHeight, Math.ceil(centerY + reach))

    return {
      left: left,
      top: top,
      width: Math.max(0, right - left),
      height: Math.max(0, bottom - top)
    }
  }

  // ---------- 手动滚动辅助（原版 VisualizerPendolo 顶部工具函数） ----------
  function getScrollDirection(delta) {
    if (Math.abs(delta) < 1) return 0
    return delta > 0 ? 1 : -1
  }

  function clampScrollSteps(steps) {
    if (Math.abs(steps) > 5) return steps > 0 ? 5 : -5
    return steps
  }

  function createMode() {
    var host = null
    var rootEl = null        // 原版 visualizerRef 容器（relative w-full h-full overflow-hidden）
    var canvasEl = null
    var canvasCtx = null
    var iconWrapEl = null
    var iconSvgEl = null
    var railEl = null

    var theme = null
    var fontScale = 1        // 原版 lyricsFontScale
    var showText = true
    var paused = false
    var layoutVersion = 0    // 主题/字号/视口变化时让行内容重建

    var viewport = { width: 1920, height: 1080 }
    var resizeObserver = null
    var canvasRafId = 0

    // 行锚点状态
    var lines = []
    var currentLineIndex = -1
    var lastValidLineIndex = 0
    var hasObservedLine = false
    var nowRef = 0

    // 手动滚动（滚轮/触摸）
    var manualScrollAnchorIndex = null
    var manualScrollResetTimer = null
    var wheelAccumulator = 0
    var wheelDirection = 0
    var touchLastY = null
    var touchAccumulator = 0
    var touchDirection = 0
    var pendingSeekIndex = null
    var seekEffectLastIndex = null

    // 纯器乐（无歌词）状态；原版 props.seed 在插件中以歌名+歌手代替
    var isInstrumental = false
    var instrumentalIndex = 0
    var instrumentalWatch = null
    var lastLyricsSig = null
    var lastSeed = null
    var seedRef = null

    // 擒纵弹簧（原版 useSpring(targetLineIndex, ...)）
    var springValue = 0
    var springVelocity = 0
    var springInit = false

    // 机芯 canvas 每帧读取的属性快照（原版 propsRef）
    var canvasProps = {
      contentBox: { left: 0, top: 0, width: 0, height: 0 },
      centerX: 0,
      centerY: 0,
      baseRadius: 0,
      lyricRingRadius: 0,
      audioBass: 0.18,
      primaryTextColor: '#FFFFFF',
      accentTextColor: '#3B82F6',
      backgroundColor: '#000000',
      showGearDecor: TUNING.showGearDecor,
      showCenterGradient: TUNING.showCenterGradient !== false,
      showCover: TUNING.showCoverOnWatchFace !== false,
      paused: false,
      motionProfile: Core.resolvePendoloMotionProfile('normal')
    }
    var gearAngleRef = { value: 0 }
    var coverState = { image: null, loadingUrl: null }

    var lineItems = new Map()  // index → 行元素记录
    var lastBoxKey = null
    var lastCanvasFilter = null
    var availableTextWidthRef = 140 // 每帧更新的可用文本宽度（重建行内容时使用）

    // 行对象 → 稳定 id（内容重建判定用）
    var lineIdMap = new WeakMap()
    var nextLineId = 1
    function lineId(line) {
      var id = lineIdMap.get(line)
      if (!id) {
        id = nextLineId
        nextLineId += 1
        lineIdMap.set(line, id)
      }
      return id
    }

    // 主题 wordColors → 匹配器缓存（按数组引用）
    var matchersCache = { source: null, matchers: null }
    function getWordColorMatchers() {
      var wordColors = theme && theme.wordColors ? theme.wordColors : []
      if (matchersCache.source !== wordColors) {
        matchersCache.source = wordColors
        matchersCache.matchers = WordColoring.prepareWordColorMatchers(wordColors, true)
      }
      return matchersCache.matchers
    }

    // 行块高度缓存（原版 lineBlockHeights useMemo 的按行缓存）
    var blockHeightCache = new Map()

    // ---------- 字体（原版 fontStacks.ts 的插件等价） ----------
    function fontFamily() {
      if (window.foliaGetLyricFontFamily) {
        var resolved = window.foliaGetLyricFontFamily()
        if (resolved) return resolved
      }
      var custom = theme && typeof theme.fontFamily === 'string' ? theme.fontFamily.trim() : ''
      if (custom) return '"' + custom.replace(/["\\]/g, '\\$&') + '"'
      return LYRIC_FONT_STACK_FALLBACK
    }

    function resolveFontWeight(fallback) {
      if (theme && typeof theme.fontWeight === 'number' && Number.isFinite(theme.fontWeight)) {
        return Math.min(900, Math.max(100, Math.round(theme.fontWeight / 10) * 10))
      }
      return fallback
    }

    function translationFontStack() {
      var base = TRANSLATION_FONT_STACKS[(theme && theme.fontStyle) || 'sans'] || TRANSLATION_FONT_STACKS.sans
      var custom = theme && typeof theme.fontFamily === 'string' ? theme.fontFamily.trim() : ''
      return custom ? '"' + custom.replace(/["\\]/g, '\\$&') + '", ' + base : base
    }

    // ---------- 挂载 ----------
    function mount(hostEl) {
      host = hostEl

      rootEl = document.createElement('div')
      rootEl.className = 'folia-mode-pendolo'
      rootEl.style.cssText = [
        'position:absolute', 'inset:0', 'z-index:10', 'overflow:hidden',
        'user-select:none', 'pointer-events:none'
      ].join(';')

      // 机芯 canvas（齿轮/刻度/游丝/表盘渐变/封面）
      canvasEl = document.createElement('canvas')
      canvasEl.style.cssText = 'position:absolute;pointer-events:none;z-index:1'
      rootEl.appendChild(canvasEl)
      canvasCtx = canvasEl.getContext('2d')

      // 摆轮上方的 BalanceIcon（lucide Star 兜底）
      iconWrapEl = document.createElement('div')
      iconWrapEl.style.cssText = 'position:absolute;pointer-events:none;z-index:1;transform:translate(-50%, -50%)'
      iconSvgEl = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
      iconSvgEl.setAttribute('viewBox', '0 0 24 24')
      iconSvgEl.setAttribute('fill', 'none')
      iconSvgEl.setAttribute('stroke-linecap', 'round')
      iconSvgEl.setAttribute('stroke-linejoin', 'round')
      var polygon = document.createElementNS('http://www.w3.org/2000/svg', 'polygon')
      polygon.setAttribute('points', STAR_ICON_POINTS)
      polygon.setAttribute('vector-effect', 'non-scaling-stroke')
      iconSvgEl.appendChild(polygon)
      iconWrapEl.appendChild(iconSvgEl)
      rootEl.appendChild(iconWrapEl)

      // 歌词轮盘轨道（原版 pointer-events-auto 的 motion.div）
      railEl = document.createElement('div')
      railEl.style.cssText = [
        'position:absolute', 'inset:0', 'width:100%', 'height:100%',
        'pointer-events:auto', 'z-index:2'
      ].join(';')
      railEl.style.webkitTransform = 'translateZ(0)'
      rootEl.appendChild(railEl)

      host.appendChild(rootEl)

      // 滚轮/触摸手动锚点
      railEl.addEventListener('wheel', handleRailWheel, { passive: false })
      railEl.addEventListener('touchstart', handleRailTouchStart, { passive: false })
      railEl.addEventListener('touchmove', handleRailTouchMove, { passive: false })
      railEl.addEventListener('touchend', handleRailTouchEnd)
      railEl.addEventListener('touchcancel', handleRailTouchEnd)

      // 视口尺寸跟踪（原版 ResizeObserver）
      resizeObserver = new ResizeObserver(updateViewportSize)
      resizeObserver.observe(rootEl)
      updateViewportSize()

      startCanvasLoop()
    }

    function updateViewportSize() {
      if (!rootEl) return
      var width = Math.round(rootEl.clientWidth)
      var height = Math.round(rootEl.clientHeight)
      if (width === 0 || height === 0) return
      if (viewport.width === width && viewport.height === height) return
      viewport.width = width
      viewport.height = height
      layoutVersion += 1
    }

    // ---------- 手动滚动 ----------
    function computeFallbackAnchorIndex() {
      if (manualScrollAnchorIndex !== null) return manualScrollAnchorIndex
      return Core.resolvePendoloFallbackAnchorIndex(lines, currentLineIndex, lastValidLineIndex, hasObservedLine, nowRef)
    }

    function scheduleManualScrollReset() {
      if (manualScrollResetTimer !== null) {
        window.clearTimeout(manualScrollResetTimer)
      }
      manualScrollResetTimer = window.setTimeout(function () {
        manualScrollAnchorIndex = null
        wheelAccumulator = 0
        wheelDirection = 0
        touchAccumulator = 0
        touchDirection = 0
        manualScrollResetTimer = null
      }, PENDOLO_SCROLL_IDLE_RESET_MS)
    }

    function moveManualScrollAnchor(steps) {
      if (lines.length === 0) return
      var baseIndex = manualScrollAnchorIndex !== null ? manualScrollAnchorIndex : computeFallbackAnchorIndex()
      manualScrollAnchorIndex = Math.max(0, Math.min(lines.length - 1, Math.round(baseIndex + steps)))
      scheduleManualScrollReset()
    }

    // 原版 handleLineSeek：插件没有歌词行跳转回调（onLyricLineSeek = null），与原版一致提前返回
    function handleLineSeek(lineIndex, startTime) {
      var onLyricLineSeek = null
      if (!onLyricLineSeek) return
      if (manualScrollResetTimer !== null) {
        window.clearTimeout(manualScrollResetTimer)
        manualScrollResetTimer = null
      }
      if (lineIndex === currentLineIndex) {
        pendingSeekIndex = null
        manualScrollAnchorIndex = null
        onLyricLineSeek(startTime)
        return
      }
      pendingSeekIndex = lineIndex
      manualScrollAnchorIndex = lineIndex
      wheelAccumulator = 0
      wheelDirection = 0
      touchAccumulator = 0
      touchDirection = 0
      onLyricLineSeek(startTime)
    }

    function handleRailWheel(event) {
      if (lines.length === 0) return
      if (event.cancelable) event.preventDefault()
      event.stopPropagation()
      var direction = getScrollDirection(event.deltaY)
      if (direction !== 0 && wheelDirection !== 0 && direction !== wheelDirection) {
        wheelAccumulator = 0
      }
      wheelDirection = direction || wheelDirection
      wheelAccumulator += event.deltaY
      var steps = clampScrollSteps(Math.trunc(wheelAccumulator / PENDOLO_SCROLL_STEP_PX))
      if (steps !== 0) {
        wheelAccumulator = 0
        moveManualScrollAnchor(steps)
      } else {
        scheduleManualScrollReset()
      }
    }

    function handleRailTouchStart(event) {
      if (lines.length === 0) return
      event.stopPropagation()
      touchLastY = event.touches && event.touches[0] ? event.touches[0].clientY : null
      touchAccumulator = 0
      touchDirection = 0
      manualScrollAnchorIndex = computeFallbackAnchorIndex()
      scheduleManualScrollReset()
    }

    function handleRailTouchMove(event) {
      if (lines.length === 0 || touchLastY === null) return
      event.stopPropagation()
      var nextY = event.touches && event.touches[0] ? event.touches[0].clientY : undefined
      if (typeof nextY !== 'number') return
      var deltaY = touchLastY - nextY
      touchLastY = nextY
      var direction = getScrollDirection(deltaY)
      if (direction !== 0 && touchDirection !== 0 && direction !== touchDirection) {
        touchAccumulator = 0
      }
      touchDirection = direction || touchDirection
      touchAccumulator += deltaY
      var steps = clampScrollSteps(Math.trunc(touchAccumulator / PENDOLO_TOUCH_STEP_PX))
      if (steps !== 0) {
        touchAccumulator = 0
        moveManualScrollAnchor(steps)
      } else {
        scheduleManualScrollReset()
      }
    }

    function handleRailTouchEnd() {
      touchLastY = null
      touchDirection = 0
      touchAccumulator = 0
      scheduleManualScrollReset()
    }

    // ---------- 纯器乐状态（原版两个 useEffect 的 rAF 监听合并进 tick） ----------
    function updateInstrumental(now, frameState) {
      var lyricsSig = lines.length === 0 ? '' : lines.length + '|' + (lines[0] && lines[0].fullText ? lines[0].fullText : '')
      // 原版 props.seed 在插件里没有对应字段，用歌名+歌手组合作为歌曲变更信号
      var seed = (frameState.songTitle || '') + '\u0000' + (frameState.songArtist || '')

      if (lyricsSig !== lastLyricsSig || seed !== lastSeed) {
        // 对应原版 effect 重跑：取消旧 watch，重新判断
        instrumentalWatch = null
        lastLyricsSig = lyricsSig
        lastSeed = seed
        if (lyricsSig !== '') {
          isInstrumental = false
          seedRef = seed
        } else {
          if (seed !== seedRef) {
            isInstrumental = false
            seedRef = seed
          }
          instrumentalWatch = { startWall: performance.now(), sawReset: false, done: false }
        }
      }

      // watch 推进（原版 rAF 循环 watch()）
      if (instrumentalWatch && !instrumentalWatch.done) {
        var capped = performance.now() - instrumentalWatch.startWall >= READY_GRACE_MS
        if (!instrumentalWatch.sawReset && now < 1) instrumentalWatch.sawReset = true
        if ((instrumentalWatch.sawReset && now >= INSTRUMENTAL_COMMIT_SECONDS) || capped) {
          isInstrumental = true
          instrumentalWatch.done = true
        }
      }

      // 器乐帧索引：每 5 秒前进一格
      if (isInstrumental) {
        var idx = Math.floor(now / INSTRUMENTAL_SECONDS_PER_FRAME)
        if (idx !== instrumentalIndex) instrumentalIndex = idx
      }
    }

    function computeTargetLineIndex() {
      if (lines.length === 0) {
        return isInstrumental ? instrumentalIndex : 0
      }
      return computeFallbackAnchorIndex()
    }

    // ---------- 擒纵弹簧积分（原版 useSpring：stiffness/damping/mass，半隐式欧拉） ----------
    function integrateSpring(targetLineIndex, dtRaw, motionProfile) {
      var snappiness = TUNING.tickSnappiness
      var stiffness = 180 * snappiness * motionProfile.escapementSpringMultiplier
      var damping = (18 + 4 / Math.max(0.5, snappiness)) * motionProfile.escapementDampingMultiplier
      var mass = 0.8

      if (!springInit) {
        springValue = targetLineIndex
        springVelocity = 0
        springInit = true
        return
      }

      var dt = Math.min(Math.max(dtRaw || 1 / 60, 0.0001), 0.05)
      var force = -stiffness * (springValue - targetLineIndex)
      var damper = -damping * springVelocity
      springVelocity += (force + damper) / mass * dt
      springValue += springVelocity * dt

      // 收敛后吸附，避免数值抖动（framer-motion 的 restDelta/restSpeed 行为）
      if (Math.abs(springValue - targetLineIndex) < 1e-4 && Math.abs(springVelocity) < 1e-4) {
        springValue = targetLineIndex
        springVelocity = 0
      }
    }

    // ---------- 行块高度（原版 lineBlockHeights useMemo） ----------
    function getLineBlockHeight(line, index, targetLineIndex, measureWidth) {
      if (Math.abs(index - targetLineIndex) > 10) return 0

      var sig = fontScale + '|' + Math.round(measureWidth) + '|' + resolveFontWeight(400) + '|' + translationFontStack()
      var cached = blockHeightCache.get(line)
      if (cached && cached.sig === sig) return cached.height

      // 始终按 focal 状态预留空间，防止放大后重叠
      var fontPx = Math.round(28 * fontScale)
      var mainHeight = Core.buildPendoloTextLayout(
        line.fullText,
        resolveFontWeight(400) + ' ' + fontPx + 'px ' + fontFamily(),
        measureWidth,
        Math.round(fontPx * 1.2)
      ).height

      // 副歌词（翻译/罗马音）：插件固定 translation 模式
      var translation = Core.resolveLyricAlternateText(line, 'translation')
      var hasReadableText = !!translation && /[\p{L}\p{N}]/u.test(translation)
      var translationPx = Math.round(16 * 1)

      var translationHeight = hasReadableText
        ? Core.buildPendoloTextLayout(
          translation,
          resolveFontWeight(500) + ' ' + translationPx + 'px ' + translationFontStack(),
          measureWidth,
          Math.round(translationPx * 1.2)
        ).height + translationPx * 0.25 // 等价 marginTop: 0.25em
        : 0

      var height = (mainHeight + translationHeight) * TUNING.activeScale
      if (blockHeightCache.size > 256) blockHeightCache.clear()
      blockHeightCache.set(line, { sig: sig, height: height })
      return height
    }

    function buildBlockHeights(targetLineIndex, measureWidth) {
      var heights = new Array(lines.length)
      for (var i = 0; i < lines.length; i += 1) heights[i] = 0
      var centerRef = Math.max(0, Math.min(lines.length - 1, Math.floor(targetLineIndex >= 0 ? targetLineIndex : 0)))
      for (var index = centerRef - 10; index <= centerRef + 10; index += 1) {
        if (index < 0 || index >= lines.length) continue
        heights[index] = getLineBlockHeight(lines[index], index, targetLineIndex, measureWidth)
      }
      return heights
    }

    // ---------- 活动行逐字扫过填充（原版 PendoloActiveLyricSweep） ----------

    // 单行填充宽度：按字形累计偏移在字形时间轴上插值（原版 fillWidth useTransform）
    function computeFillWidth(latest, timings, offsets, fullWidth, lineEndTime) {
      if (timings.length === 0) return latest >= lineEndTime ? fullWidth : 0
      if (latest <= timings[0].startTime) return 0

      for (var index = 0; index < timings.length; index += 1) {
        var timing = timings[index]
        var startWidth = offsets[index] !== undefined ? offsets[index] : 0
        var endWidth = offsets[index + 1] !== undefined ? offsets[index + 1] : startWidth
        if (latest < timing.startTime) return startWidth
        if (latest <= timing.endTime) {
          return startWidth + (endWidth - startWidth)
            * ((latest - timing.startTime) / Math.max(0.001, timing.endTime - timing.startTime))
        }
      }
      return fullWidth
    }

    // 构建 sweep DOM（原版 PendoloActiveLyricSweep 渲染结果）
    function buildSweep(line, fontPx, maxWidth, primaryTextColor, accentTextColor, accentMix, isChorusActive, chorusGlowMultiplier) {
      var fontSpec = resolveFontWeight(400) + ' ' + fontPx + 'px ' + fontFamily()
      var text = line.fullText
      var graphemeTimings = LyricsData.getLineGraphemeTimeline(line)
      var matchers = getWordColorMatchers()
      var wordColorRanges = WordColoring.buildWordColorRangesFromMatchers(text, matchers)

      // 字符 token（UTF-16 码元偏移区间）
      var charTokens = []
      var cursor = 0
      var graphemes = GraphemeTiming.splitLyricGraphemes(text)
      for (var g = 0; g < graphemes.length; g += 1) {
        var startOffset = cursor
        cursor += graphemes[g].length
        charTokens.push({ key: String(g), timed: true, startOffset: startOffset, endOffset: cursor })
      }
      var tokenColors = WordColoring.resolveTokenColorMap(charTokens, wordColorRanges)

      var lineHeight = Math.round(fontPx * 1.2)
      var textLayout = Core.buildPendoloTextLayout(text, fontSpec, maxWidth, lineHeight)
      var fillColor = ColorMix.mixColors(primaryTextColor, accentTextColor, accentMix)
      // CSS mask 会把 text-shadow 一起裁掉；filter 在 mask 之后运行，保住辉光
      var glowFilter = isChorusActive
        ? 'drop-shadow(0 0 ' + Math.round(fontPx * 0.3 * chorusGlowMultiplier) + 'px ' + ColorMix.colorWithAlpha(fillColor, 0.72) + ') drop-shadow(0 0 ' + Math.round(fontPx * 0.62 * chorusGlowMultiplier) + 'px ' + ColorMix.colorWithAlpha(accentTextColor, 0.28) + ')'
        : null
      var glowPaddingPx = isChorusActive ? Math.ceil(fontPx * 0.7 * chorusGlowMultiplier + 10) : 0

      var rootSpan = document.createElement('span')
      rootSpan.style.cssText = [
        'display:block',
        'font-size:' + fontPx + 'px',
        'line-height:' + lineHeight + 'px',
        'width:' + maxWidth + 'px'
      ].join(';')

      var sweepLines = []
      for (var i = 0; i < textLayout.lines.length; i += 1) {
        var layoutLine = textLayout.lines[i]
        var lineTimings = graphemeTimings.slice(layoutLine.graphemeStart, layoutLine.graphemeEnd)
        var offsets = Core.measurePendoloGraphemeOffsets(layoutLine.text, fontPx, fontSpec)
        var colorRuns = Core.buildPendoloColorRuns(layoutLine.text, layoutLine.graphemeStart, tokenColors, fillColor)

        // 外层：占位基线文本（52% 主色）
        var outerSpan = document.createElement('span')
        outerSpan.style.cssText = [
          'position:relative', 'display:block', 'white-space:pre', 'overflow:visible',
          'width:' + layoutLine.width + 'px', 'height:' + lineHeight + 'px'
        ].join(';')

        var baseSpan = document.createElement('span')
        baseSpan.style.color = ColorMix.colorWithAlpha(primaryTextColor, 0.52)
        for (var r = 0; r < colorRuns.length; r += 1) {
          var baseRun = document.createElement('span')
          baseRun.textContent = colorRuns[r].text
          baseSpan.appendChild(baseRun)
        }
        outerSpan.appendChild(baseSpan)

        // 辉光/填充层（绝对定位覆盖，mask 控制扫过边缘）
        var glowOuter = document.createElement('span')
        glowOuter.style.cssText = [
          'pointer-events:none', 'position:absolute', 'left:0', 'top:0', 'right:0', 'bottom:0',
          'display:block', 'white-space:pre', 'overflow:visible'
        ].join(';')

        var glowInset = document.createElement('span')
        glowInset.style.cssText = [
          'position:absolute', 'display:block', 'white-space:pre', 'overflow:visible',
          'left:' + -glowPaddingPx + 'px', 'top:' + -glowPaddingPx + 'px',
          'right:' + -glowPaddingPx + 'px', 'bottom:' + -glowPaddingPx + 'px'
        ].join(';')
        if (glowFilter) glowInset.style.filter = glowFilter

        var maskSpan = document.createElement('span')
        maskSpan.style.cssText = [
          'position:absolute', 'left:0', 'top:0', 'right:0', 'bottom:0',
          'display:block', 'white-space:pre',
          'box-sizing:border-box', 'padding:' + glowPaddingPx + 'px',
          'opacity:0',
          '-webkit-mask-size:100% 100%', 'mask-size:100% 100%',
          '-webkit-mask-repeat:no-repeat', 'mask-repeat:no-repeat'
        ].join(';')
        for (var c = 0; c < colorRuns.length; c += 1) {
          var fillRun = document.createElement('span')
          fillRun.style.color = colorRuns[c].color
          fillRun.textContent = colorRuns[c].text
          maskSpan.appendChild(fillRun)
        }

        glowInset.appendChild(maskSpan)
        glowOuter.appendChild(glowInset)
        outerSpan.appendChild(glowOuter)
        rootSpan.appendChild(outerSpan)

        sweepLines.push({
          maskSpan: maskSpan,
          timings: lineTimings,
          offsets: offsets,
          fullWidth: offsets.length > 0 ? offsets[offsets.length - 1] : layoutLine.width,
          lineEndTime: line.endTime,
          fontPx: fontPx,
          glowPaddingPx: glowPaddingPx,
          lastMask: null,
          lastOpacity: null
        })
      }

      return {
        rootSpan: rootSpan,
        sweepLines: sweepLines
      }
    }

    // 每帧更新 sweep 的 mask 与透明度（原版 maskImage/fillOpacity useTransform）
    function updateSweep(sweep, now) {
      for (var i = 0; i < sweep.sweepLines.length; i += 1) {
        var sl = sweep.sweepLines[i]
        var width = computeFillWidth(now, sl.timings, sl.offsets, sl.fullWidth, sl.lineEndTime)
        var edgeSoftness = Math.min(Math.max(sl.fontPx * 0.42, 8), 16)
        var paddedFillWidth = sl.glowPaddingPx + width
        var mask = 'linear-gradient(90deg, #000 0px, #000 ' + Math.max(paddedFillWidth - edgeSoftness, 0) + 'px, rgba(0, 0, 0, 0.84) ' + paddedFillWidth + 'px, transparent ' + (paddedFillWidth + edgeSoftness) + 'px)'
        var fillOpacity = now < (sl.timings.length > 0 ? sl.timings[0].startTime : sl.lineEndTime) ? '0' : '1'
        if (mask !== sl.lastMask) {
          sl.maskSpan.style.webkitMaskImage = mask
          sl.maskSpan.style.maskImage = mask
          sl.lastMask = mask
        }
        if (fillOpacity !== sl.lastOpacity) {
          sl.maskSpan.style.opacity = fillOpacity
          sl.lastOpacity = fillOpacity
        }
      }
    }

    // ---------- 轮盘行元素（原版 PendoloRotatingLine + 行内三层结构） ----------
    function createItemDom(item) {
      var el = document.createElement('div')
      el.style.cssText = [
        'position:absolute', 'pointer-events:auto',
        'transform-origin:left center'
      ].join(';')
      // canSeek 恒 false（插件无歌词行跳转），不加 cursor-pointer
      var clickHandler = function (event) {
        event.stopPropagation()
        handleLineSeek(item.index, item.line.startTime)
      }
      el.addEventListener('click', clickHandler)

      // 文本旋转修正层（-wheel * 0.65）
      var correctionEl = document.createElement('div')
      correctionEl.style.cssText = 'display:inline-block;transform-origin:left center'
      correctionEl.style.webkitTransform = 'translateZ(0)'

      // 行内静态旋转 + 缩放层
      var scaleWrapEl = document.createElement('div')
      scaleWrapEl.style.cssText = [
        'position:relative', 'display:inline-block',
        'transform-origin:left center', 'isolation:isolate'
      ].join(';')

      // 合唱光晕缩放层（initial={false}，直接落到当前 scale）
      var haloEl = document.createElement('div')
      haloEl.style.transformOrigin = 'left center'

      // 垂直居中层
      var translateYEl = document.createElement('div')
      translateYEl.style.transform = 'translateY(-50%)'

      haloEl.appendChild(translateYEl)
      scaleWrapEl.appendChild(haloEl)
      correctionEl.appendChild(scaleWrapEl)
      el.appendChild(correctionEl)
      railEl.appendChild(el)

      return {
        el: el,
        correctionEl: correctionEl,
        scaleWrapEl: scaleWrapEl,
        haloEl: haloEl,
        translateYEl: translateYEl,
        glowEl: null,
        sweep: null,
        builtKey: null,
        lastHaloScale: null,
        line: null,
        isFocal: null,
        version: null
      }
    }

    // 重建行内容（focal 切换 / 主题或字号或视口变化 / 行对象更换时）
    function rebuildItemContent(record, item, presentation, showChorusMarker) {
      // 清空旧内容
      while (record.translateYEl.firstChild) {
        record.translateYEl.removeChild(record.translateYEl.firstChild)
      }
      record.sweep = null

      var primaryTextColor = theme.primaryColor || '#FFFFFF'
      var accentTextColor = theme.accentColor || '#3B82F6'
      var secondaryTextColor = theme.secondaryColor || '#9CA3AF'
      var fontPx = Math.round((item.isActive ? 28 : 22) * fontScale)
      var maxTextWidth = availableTextWidthRef / item.scale

      // 合唱标记点（手动滚动时显示；插件行无 isChorus 标记，不会触发）
      if (showChorusMarker) {
        var marker = document.createElement('span')
        marker.setAttribute('aria-hidden', 'true')
        marker.style.cssText = [
          'position:absolute', 'pointer-events:none', 'border-radius:9999px',
          'width:0.42em', 'height:0.42em', 'left:-0.95em', 'top:0.52em',
          'background-color:' + accentTextColor,
          'box-shadow:0 0 7px ' + ColorMix.colorWithAlpha(accentTextColor, 0.58)
        ].join(';')
        record.translateYEl.appendChild(marker)
      }

      var textWrapper = document.createElement('div')
      if (item.isActive) {
        // focal：逐字扫过填充
        record.sweep = buildSweep(
          item.line,
          fontPx,
          maxTextWidth,
          primaryTextColor,
          accentTextColor,
          presentation.accentMix,
          presentation.isActive,
          presentation.glowMultiplier
        )
        textWrapper.appendChild(record.sweep.rootSpan)
      } else {
        // 非 focal：静态整行文本（200ms 全属性过渡）
        var plain = document.createElement('div')
        plain.style.cssText = [
          'transition:all 0.2s', 'white-space:pre-wrap',
          'font-size:' + fontPx + 'px',
          'max-width:' + maxTextWidth + 'px',
          'color:' + ColorMix.colorWithAlpha(primaryTextColor, 0.75),
          'letter-spacing:0.01em',
          'overflow-wrap:anywhere', 'word-break:break-word'
        ].join(';')
        plain.textContent = item.line.fullText
        textWrapper.appendChild(plain)
      }
      record.translateYEl.appendChild(textWrapper)

      // 副歌词（翻译/罗马音）
      var translation = Core.resolveLyricAlternateText(item.line, 'translation')
      var hasReadableText = !!translation && /[\p{L}\p{N}]/u.test(translation)
      if (hasReadableText) {
        var translationPx = Math.round((item.isActive ? 16 : 12) * 1)
        var translationEl = document.createElement('div')
        translationEl.style.cssText = [
          'white-space:pre-wrap', 'transition:opacity 0.2s',
          'font-family:' + translationFontStack(),
          'font-weight:' + resolveFontWeight(500),
          'font-size:' + translationPx + 'px',
          'max-width:' + maxTextWidth + 'px',
          'color:' + (item.isActive ? secondaryTextColor : ColorMix.colorWithAlpha(secondaryTextColor, 0.6)),
          'letter-spacing:0.01em',
          'overflow-wrap:anywhere', 'word-break:break-word',
          'margin-top:0.25em'
        ].join(';')
        translationEl.textContent = translation
        record.translateYEl.appendChild(translationEl)
      }

      record.line = item.line
      record.isFocal = item.isActive
      record.version = layoutVersion
    }

    // 合唱光晕背景（chorusPresentation.isActive 时挂载并做进出场）
    function syncHaloGlow(record, presentation, accentTextColor) {
      if (presentation.isActive && !record.glowEl) {
        var glow = document.createElement('div')
        glow.setAttribute('aria-hidden', 'true')
        glow.style.cssText = [
          'position:absolute', 'pointer-events:none', 'z-index:-10', 'border-radius:16px',
          'top:-0.7em', 'bottom:-0.7em', 'left:-1.1em', 'right:-1.1em',
          'background:radial-gradient(circle at 42% 50%, ' + ColorMix.colorWithAlpha(accentTextColor, 0.14 * presentation.haloOpacity) + ' 0%, ' + ColorMix.colorWithAlpha(accentTextColor, 0.035 * presentation.haloOpacity) + ' 55%, transparent 82%)',
          'filter:blur(' + Math.round(10 * Core.resolvePendoloMotionProfile(theme.animationIntensity).chorusGlowMultiplier) + 'px)'
        ].join(';')
        glow.style.opacity = '0'
        glow.style.transform = 'scale(0.96)'
        record.haloEl.insertBefore(glow, record.haloEl.firstChild)
        record.glowEl = glow
        // 原版 initial={{opacity:0, scale:0.96}} → animate 过渡
        window.requestAnimationFrame(function () {
          if (!record.glowEl) return
          glow.animate(
            [
              { opacity: '0', transform: 'scale(0.96)' },
              { opacity: String(presentation.haloOpacity), transform: 'scale(1)' }
            ],
            { duration: Math.round(presentation.transitionDuration * 1000), easing: 'ease-out', fill: 'forwards' }
          )
        })
      } else if (!presentation.isActive && record.glowEl) {
        record.glowEl.remove()
        record.glowEl = null
      }
    }

    // 每帧同步轮盘行（位置/透明度/旋转/缩放/内容重建）
    function syncItems(lineItemList, targetLineIndex, wheelRotationDeg, textRotationCorrectionDeg, motionProfile) {
      var needed = new Set()
      for (var i = 0; i < lineItemList.length; i += 1) {
        var item = lineItemList[i]
        needed.add(item.index)

        var record = lineItems.get(item.index)
        if (!record) {
          record = createItemDom(item)
          lineItems.set(item.index, record)
        }

        var presentation = Core.resolvePendoloChorusPresentation(
          item.line.isChorus,
          item.isActive && item.index === currentLineIndex,
          motionProfile
        )
        var showChorusMarker = manualScrollAnchorIndex !== null && !!item.line.isChorus

        // 内容重建判定（React 按子树类型/props 重渲染的等价）
        var rebuildKey = [
          layoutVersion,
          item.isActive ? 1 : 0,
          lineId(item.line),
          presentation.accentMix,
          presentation.isActive ? 1 : 0,
          showChorusMarker ? 1 : 0
        ].join('|')
        if (record.builtKey !== rebuildKey || record.translateYEl.childNodes.length === 0) {
          record.builtKey = rebuildKey
          rebuildItemContent(record, item, presentation, showChorusMarker)
        }

        // 位置（轮盘弧上坐标）与随轮盘角度的淡入淡出
        record.el.style.left = item.x + 'px'
        record.el.style.top = item.y + 'px'
        record.el.style.opacity = String(Core.resolvePendoloRotatingLineOpacity(item.angleDeg, wheelRotationDeg, item.alpha))
        record.el.style.fontFamily = fontFamily()
        record.el.style.fontWeight = String(resolveFontWeight(400))

        // 文本旋转修正
        record.correctionEl.style.transform = 'rotate(' + textRotationCorrectionDeg + 'deg)'

        // 行内旋转 + 缩放
        record.scaleWrapEl.style.transform = 'rotate(' + (item.angleDeg * 0.35) + 'deg) scale(' + item.scale + ') translateZ(0)'

        // 合唱光晕：scale 动画（initial={false}，变化时才过渡）
        if (record.lastHaloScale === null) {
          record.haloEl.style.transform = 'scale(' + presentation.haloScale + ')'
          record.lastHaloScale = presentation.haloScale
        } else if (record.lastHaloScale !== presentation.haloScale) {
          var fromScale = record.lastHaloScale
          record.lastHaloScale = presentation.haloScale
          record.haloEl.animate(
            [
              { transform: 'scale(' + fromScale + ')' },
              { transform: 'scale(' + presentation.haloScale + ')' }
            ],
            { duration: Math.round(presentation.transitionDuration * 1000), easing: 'ease-out', fill: 'forwards' }
          )
        }
        syncHaloGlow(record, presentation, theme.accentColor || '#3B82F6')

        // focal 行逐帧更新扫过填充
        if (item.isActive && record.sweep) updateSweep(record.sweep, nowRef)
      }

      // 移除窗口外的行
      lineItems.forEach(function (record2, index) {
        if (!needed.has(index)) {
          record2.el.remove()
          lineItems.delete(index)
        }
      })
    }

    // ---------- 摆轮 BalanceIcon（lucide Star 兜底） ----------
    function updateIcon(centerX, centerY, baseRadius, accentTextColor) {
      if (TUNING.showGearDecor !== 'none') {
        iconWrapEl.style.display = ''
        var balanceGearX = centerX + baseRadius * 0.2
        var balanceGearY = centerY - baseRadius * 0.75
        iconWrapEl.style.left = balanceGearX + 'px'
        iconWrapEl.style.top = balanceGearY + 'px'
        var size = Math.max(14, baseRadius * 0.13)
        var color = ColorMix.colorWithAlpha(accentTextColor, 0.62)
        if (iconSvgEl.getAttribute('data-size') !== String(size) || iconSvgEl.getAttribute('stroke') !== color) {
          iconSvgEl.setAttribute('data-size', String(size))
          iconSvgEl.setAttribute('width', String(size))
          iconSvgEl.setAttribute('height', String(size))
          iconSvgEl.setAttribute('stroke', color)
          iconSvgEl.setAttribute('stroke-width', '1.2')
        }
      } else {
        iconWrapEl.style.display = 'none'
      }
    }

    // ---------- 封面图加载（原版 showCover effect；默认关闭，保留分支） ----------
    function updateCoverImage(coverUrl) {
      if (!TUNING.showCoverOnWatchFace || !coverUrl) {
        coverState.image = null
        coverState.loadingUrl = null
        return
      }
      if (coverState.loadingUrl === coverUrl) return
      coverState.loadingUrl = coverUrl
      var img = new Image()
      img.onload = function () {
        if (coverState.loadingUrl === coverUrl) coverState.image = img
      }
      img.onerror = function () {
        if (coverState.loadingUrl === coverUrl) coverState.image = null
      }
      img.src = coverUrl
    }

    // ---------- 机芯 canvas 渲染循环（原版 PendoloClockworkCanvas useEffect rAF） ----------
    function startCanvasLoop() {
      var lastTimestamp = null
      var phase = 0
      var smoothedBass = 0.15
      var secondGearElapsed = 0
      var secondGearStep = 0
      var secondGearAngle = 0
      var secondGearVelocity = 0

      function render(timestamp) {
        var p = canvasProps
        if (p.showGearDecor === 'none' && !p.showCenterGradient && !p.showCover) return // 与原版一致：不再排帧

        if (lastTimestamp === null) lastTimestamp = timestamp
        var dt = Math.min((timestamp - lastTimestamp) / 1000, 0.05)
        lastTimestamp = timestamp

        // 实时低频能量（>1 视为 0..255 字节刻度）
        var val = p.audioBass
        var normBass = val > 1.0 ? val / 255 : val
        var clampedBass = Math.max(0, Math.min(1, normBass))
        smoothedBass += (clampedBass - smoothedBass)
          * Math.min(0.24, 0.12 * p.motionProfile.bassResponseMultiplier)
        var bass = smoothedBass

        // 1. 摆轮相位积累与谐和摆动（低频调节器）
        if (!p.paused) {
          phase += dt
            * (2.8 + bass * 3.5 * p.motionProfile.bassResponseMultiplier)
            * p.motionProfile.balanceSpeedMultiplier
          secondGearElapsed += dt
          var completedSteps = Math.floor(secondGearElapsed)
          if (completedSteps > 0) {
            secondGearStep += completedSteps
            secondGearElapsed -= completedSteps
          }
          var secondGearTarget = secondGearStep * (Math.PI * 2 / 15)
          var displacement = secondGearTarget - secondGearAngle
          secondGearVelocity += displacement * 92 * p.motionProfile.escapementSpringMultiplier * dt
          secondGearVelocity *= Math.exp(-13 * p.motionProfile.escapementDampingMultiplier * dt)
          secondGearAngle += secondGearVelocity * dt
        }
        var bassOscillation = Math.sin(phase)
          * (0.15 + bass * 0.70 * p.motionProfile.bassResponseMultiplier)
          * p.motionProfile.balanceAmplitudeMultiplier

        // 2. 主齿轮角严格跟随歌词行棘轮步进（演唱中静止，切行时才棘轮转动）
        var currentGearAngle = gearAngleRef.value

        var box = p.contentBox
        var width = box.width
        var height = box.height
        if (width <= 0 || height <= 0) {
          canvasRafId = window.requestAnimationFrame(render)
          return
        }
        var dpr = window.devicePixelRatio || 1
        var pixelWidth = Math.round(width * dpr)
        var pixelHeight = Math.round(height * dpr)

        if (canvasEl.width !== pixelWidth || canvasEl.height !== pixelHeight) {
          canvasEl.width = pixelWidth
          canvasEl.height = pixelHeight
        }

        var ctx = canvasCtx
        ctx.save()
        ctx.scale(dpr, dpr)
        ctx.clearRect(0, 0, width, height)
        ctx.translate(-box.left, -box.top)

        // 0. 可选的中心暗色径向渐变（主题背景色）
        if (p.showCenterGradient) {
          var gradientR = p.baseRadius * 1.65
          var bgCol = p.backgroundColor || '#000000'
          var grad = ctx.createRadialGradient(p.centerX, p.centerY, 0, p.centerX, p.centerY, gradientR)
          grad.addColorStop(0, ColorMix.colorWithAlpha(bgCol, 0.72))
          grad.addColorStop(0.35, ColorMix.colorWithAlpha(bgCol, 0.52))
          grad.addColorStop(0.7, ColorMix.colorWithAlpha(bgCol, 0.20))
          grad.addColorStop(1, ColorMix.colorWithAlpha(bgCol, 0))
          ctx.fillStyle = grad
          ctx.beginPath()
          ctx.arc(p.centerX, p.centerY, gradientR, 0, Math.PI * 2)
          ctx.fill()
        }

        // 0.5 表盘封面图
        var currentCoverImg = coverState.image
        if (p.showCover && currentCoverImg) {
          var coverRadius = p.baseRadius * 0.88 // 限制在表盘内圈
          ctx.save()
          ctx.beginPath()
          ctx.arc(p.centerX, p.centerY, coverRadius, 0, Math.PI * 2)
          ctx.clip()
          var isFullDecor = p.showGearDecor === 'full'
          ctx.globalAlpha = 0.42 * (isFullDecor ? 1.0 : 0.6)
          var size = coverRadius * 2
          ctx.drawImage(currentCoverImg, p.centerX - coverRadius, p.centerY - coverRadius, size, size)
          ctx.restore()
        }

        if (p.showGearDecor === 'none') {
          ctx.restore()
          canvasRafId = window.requestAnimationFrame(render)
          return
        }

        var isFull = p.showGearDecor === 'full'
        var decorOpacityMultiplier = isFull ? 1.0 : 0.6

        var primaryAlpha10 = ColorMix.colorWithAlpha(p.primaryTextColor, 0.10 * decorOpacityMultiplier)
        var primaryAlpha15 = ColorMix.colorWithAlpha(p.primaryTextColor, 0.15 * decorOpacityMultiplier)
        var primaryAlpha25 = ColorMix.colorWithAlpha(p.primaryTextColor, 0.25 * decorOpacityMultiplier)
        var accentAlpha12 = ColorMix.colorWithAlpha(p.accentTextColor, 0.12 * decorOpacityMultiplier)
        var accentAlpha20 = ColorMix.colorWithAlpha(p.accentTextColor, 0.20 * decorOpacityMultiplier)
        var accentAlpha35 = ColorMix.colorWithAlpha(p.accentTextColor, 0.35 * decorOpacityMultiplier)
        var accentAlpha50 = ColorMix.colorWithAlpha(p.accentTextColor, 0.50 * decorOpacityMultiplier)
        // 刻度环保持低调，只抬升机械总成的存在感
        var gearPrimaryAlpha = ColorMix.colorWithAlpha(p.primaryTextColor, 0.42 * decorOpacityMultiplier)
        var gearPrimarySubtleAlpha = ColorMix.colorWithAlpha(p.primaryTextColor, 0.32 * decorOpacityMultiplier)
        var gearAccentAlpha = ColorMix.colorWithAlpha(p.accentTextColor, 0.58 * decorOpacityMultiplier)
        var gearAccentStrongAlpha = ColorMix.colorWithAlpha(p.accentTextColor, 0.72 * decorOpacityMultiplier)
        var planetGearAlpha = ColorMix.colorWithAlpha(p.primaryTextColor, 0.24 * decorOpacityMultiplier)
        var jewelFillColor = ColorMix.colorWithAlpha(p.accentTextColor, 0.28 * decorOpacityMultiplier)
        var jewelStrokeColor = ColorMix.colorWithAlpha(p.accentTextColor, 0.65 * decorOpacityMultiplier)

        // 1. 技术径向刻度与同心引导环
        ctx.strokeStyle = primaryAlpha15
        ctx.lineWidth = 1

        var ringRadii = [p.baseRadius * 0.3, p.baseRadius * 0.6, p.baseRadius * 0.85, p.baseRadius * 1.15, p.baseRadius * 1.4]
        for (var ringIndex = 0; ringIndex < ringRadii.length; ringIndex += 1) {
          ctx.beginPath()
          ctx.arc(p.centerX, p.centerY, ringRadii[ringIndex], 0, Math.PI * 2)
          ctx.stroke()
        }

        // 主轮外围技术径向刻度（每 6° 一个）
        var tickCount = 60
        var outerTickR = p.baseRadius * 1.15
        for (var tickIdx = 0; tickIdx < tickCount; tickIdx++) {
          var angle = (tickIdx * Math.PI * 2) / tickCount + currentGearAngle * 0.2
          var isMajor = tickIdx % 5 === 0
          var tickLen = isMajor ? 12 : 6
          var x1 = p.centerX + outerTickR * Math.cos(angle)
          var y1 = p.centerY + outerTickR * Math.sin(angle)
          var x2 = p.centerX + (outerTickR + tickLen) * Math.cos(angle)
          var y2 = p.centerY + (outerTickR + tickLen) * Math.sin(angle)

          ctx.strokeStyle = isMajor ? accentAlpha35 : primaryAlpha15
          ctx.lineWidth = isMajor ? 1.5 : 1
          ctx.beginPath()
          ctx.moveTo(x1, y1)
          ctx.lineTo(x2, y2)
          ctx.stroke()
        }

        // 2. 主擒纵齿轮（外缘）
        drawGearTeeth(
          ctx,
          p.centerX,
          p.centerY,
          p.baseRadius + 8,
          36,
          10,
          currentGearAngle,
          gearAccentAlpha,
          2.2,
          ColorMix.colorWithAlpha(p.accentTextColor, 0.08 * decorOpacityMultiplier)
        )

        // 内圈擒纵辐条轮
        drawSpokedWheel(
          ctx,
          p.centerX,
          p.centerY,
          p.baseRadius * 0.2,
          p.baseRadius * 0.85,
          6,
          currentGearAngle,
          gearPrimaryAlpha,
          1.8
        )

        // 主齿轮缘的斜切双环（增加层次）
        ctx.strokeStyle = ColorMix.colorWithAlpha(p.primaryTextColor, 0.18 * decorOpacityMultiplier)
        ctx.lineWidth = 0.8
        ctx.beginPath()
        ctx.arc(p.centerX, p.centerY, p.baseRadius * 0.88, 0, Math.PI * 2)
        ctx.stroke()
        ctx.beginPath()
        ctx.arc(p.centerX, p.centerY, p.baseRadius * 0.92, 0, Math.PI * 2)
        ctx.stroke()

        // 主齿轮内部的玑镂刻花射线
        ctx.save()
        ctx.translate(p.centerX, p.centerY)
        ctx.rotate(currentGearAngle)
        var guillocheRayCount = 48
        var guillocheInnerR = p.baseRadius * 0.62
        var guillocheOuterR = p.baseRadius * 0.83
        for (var rayIdx = 0; rayIdx < guillocheRayCount; rayIdx++) {
          var rayAngle = (rayIdx * Math.PI * 2) / guillocheRayCount
          // 长短交替的射线纹理
          var innerOffset = rayIdx % 2 === 0 ? guillocheInnerR : guillocheInnerR + (guillocheOuterR - guillocheInnerR) * 0.3
          ctx.strokeStyle = rayIdx % 2 === 0 ? primaryAlpha10 : ColorMix.colorWithAlpha(p.primaryTextColor, 0.07 * decorOpacityMultiplier)
          ctx.lineWidth = 0.7
          ctx.beginPath()
          ctx.moveTo(innerOffset * Math.cos(rayAngle), innerOffset * Math.sin(rayAngle))
          ctx.lineTo(guillocheOuterR * Math.cos(rayAngle), guillocheOuterR * Math.sin(rayAngle))
          ctx.stroke()
        }
        ctx.restore()

        // 外缘铆钉圆（线框风格）
        var rivetCount = 12
        var rivetR = p.baseRadius * 0.96
        for (var rivetIdx = 0; rivetIdx < rivetCount; rivetIdx++) {
          var rivetAngle = (rivetIdx * Math.PI * 2) / rivetCount + currentGearAngle
          var rx = p.centerX + rivetR * Math.cos(rivetAngle)
          var ry = p.centerY + rivetR * Math.sin(rivetAngle)
          ctx.strokeStyle = ColorMix.colorWithAlpha(p.primaryTextColor, 0.25 * decorOpacityMultiplier)
          ctx.lineWidth = 0.8
          ctx.beginPath()
          ctx.arc(rx, ry, 2.2, 0, Math.PI * 2)
          ctx.stroke()
        }

        // 3. 中心毂与太阳齿轮小齿
        drawGearTeeth(
          ctx,
          p.centerX,
          p.centerY,
          p.baseRadius * 0.22,
          12,
          6,
          -currentGearAngle * 2.5,
          gearAccentStrongAlpha,
          2.1,
          undefined
        )

        // 中心宝石轴承（线框双环）
        ctx.strokeStyle = jewelStrokeColor
        ctx.lineWidth = 1.2
        ctx.beginPath()
        ctx.arc(p.centerX, p.centerY, 4.5, 0, Math.PI * 2)
        ctx.stroke()
        ctx.strokeStyle = jewelFillColor
        ctx.lineWidth = 0.8
        ctx.beginPath()
        ctx.arc(p.centerX, p.centerY, 2.5, 0, Math.PI * 2)
        ctx.stroke()

        // 4. 轨道行星齿轮组
        var planetCount = 3
        var orbitR = p.baseRadius * 0.52
        var planetR = p.baseRadius * 0.16
        var orbitAngleBase = currentGearAngle * 0.4

        for (var planetIdx = 0; planetIdx < planetCount; planetIdx++) {
          var planetAngle = orbitAngleBase + (planetIdx * Math.PI * 2) / planetCount
          var px = p.centerX + orbitR * Math.cos(planetAngle)
          var py = p.centerY + orbitR * Math.sin(planetAngle)

          // 行星齿轮本体
          drawGearTeeth(
            ctx,
            px,
            py,
            planetR,
            14,
            5,
            -currentGearAngle * 3 + planetIdx * 0.5,
            planetGearAlpha,
            1.7,
            undefined
          )

          // 行星宝石轴承（线框双环）
          ctx.strokeStyle = jewelStrokeColor
          ctx.lineWidth = 1
          ctx.beginPath()
          ctx.arc(px, py, 3.5, 0, Math.PI * 2)
          ctx.stroke()
          ctx.strokeStyle = jewelFillColor
          ctx.lineWidth = 0.7
          ctx.beginPath()
          ctx.arc(px, py, 1.8, 0, Math.PI * 2)
          ctx.stroke()
        }

        // 5. 左上装饰摆轮
        var balanceCx = p.centerX + p.baseRadius * 0.2
        var balanceCy = p.centerY - p.baseRadius * 0.75
        var balanceR = p.baseRadius * 0.28
        var balanceGearAngle = phase * 0.1
        drawGearTeeth(
          ctx,
          balanceCx,
          balanceCy,
          balanceR,
          20,
          7,
          balanceGearAngle,
          gearAccentStrongAlpha,
          2.1,
          ColorMix.colorWithAlpha(p.accentTextColor, 0.10 * decorOpacityMultiplier)
        )
        // 内环为不旋转的图标覆盖留出安静的圆形座位
        ctx.strokeStyle = gearPrimarySubtleAlpha
        ctx.lineWidth = 1.8
        ctx.beginPath()
        ctx.arc(balanceCx, balanceCy, balanceR * 0.52, 0, Math.PI * 2)
        ctx.stroke()

        // 摆轮处的游丝螺旋
        drawHairspring(
          ctx,
          balanceCx,
          balanceCy,
          balanceR * 0.56,
          balanceR * 0.88,
          3.5,
          bassOscillation * 0.6 + balanceGearAngle * 0.3,
          ColorMix.colorWithAlpha(p.accentTextColor, 0.30 * decorOpacityMultiplier),
          0.8
        )

        // 摆轮宝石轴承（线框双环）
        ctx.strokeStyle = jewelStrokeColor
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.arc(balanceCx, balanceCy, 3.5, 0, Math.PI * 2)
        ctx.stroke()
        ctx.strokeStyle = jewelFillColor
        ctx.lineWidth = 0.7
        ctx.beginPath()
        ctx.arc(balanceCx, balanceCy, 1.8, 0, Math.PI * 2)
        ctx.stroke()

        // 啮合的中间传动齿轮（左下偏移）
        var transCx = p.centerX + p.baseRadius * 0.32
        var transCy = p.centerY + p.baseRadius * 0.78
        var transR = p.baseRadius * 0.34
        drawGearTeeth(
          ctx,
          transCx,
          transCy,
          transR,
          24,
          7,
          -currentGearAngle * 1.4,
          gearPrimaryAlpha,
          1.8,
          undefined
        )
        drawSpokedWheel(
          ctx,
          transCx,
          transCy,
          transR * 0.25,
          transR * 0.85,
          5,
          -currentGearAngle * 1.4,
          gearPrimarySubtleAlpha,
          1.5
        )

        // 传动齿轮面的 Geneva 条纹（裁剪到齿轮圆内的平行线）
        ctx.save()
        ctx.translate(transCx, transCy)
        ctx.rotate(-currentGearAngle * 1.4)
        ctx.beginPath()
        ctx.arc(0, 0, transR * 0.80, 0, Math.PI * 2)
        ctx.clip()
        var genevaStripeCount = 9
        var genevaSpan = transR * 1.6
        var genevaStep = genevaSpan / (genevaStripeCount + 1)
        for (var stripeIdx = 1; stripeIdx <= genevaStripeCount; stripeIdx++) {
          var yOff = -genevaSpan * 0.5 + stripeIdx * genevaStep
          ctx.strokeStyle = stripeIdx % 2 === 0 ? primaryAlpha10 : ColorMix.colorWithAlpha(p.primaryTextColor, 0.06 * decorOpacityMultiplier)
          ctx.lineWidth = 0.7
          ctx.beginPath()
          ctx.moveTo(-transR, yOff)
          ctx.lineTo(transR, yOff)
          ctx.stroke()
        }
        ctx.restore()

        // 传动齿轮宝石轴承（线框双环）
        ctx.strokeStyle = jewelStrokeColor
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.arc(transCx, transCy, 3.5, 0, Math.PI * 2)
        ctx.stroke()
        ctx.strokeStyle = jewelFillColor
        ctx.lineWidth = 0.7
        ctx.beginPath()
        ctx.arc(transCx, transCy, 1.8, 0, Math.PI * 2)
        ctx.stroke()

        // 秒轮：播放每满一秒前进一齿
        var secondGearTeeth = 15
        var secondGearCx = p.centerX + p.baseRadius * 0.68
        var secondGearCy = p.centerY + p.baseRadius * 0.76
        var secondGearR = p.baseRadius * 0.16
        drawGearTeeth(
          ctx,
          secondGearCx,
          secondGearCy,
          secondGearR,
          secondGearTeeth,
          5,
          secondGearAngle,
          gearAccentAlpha,
          1.8,
          ColorMix.colorWithAlpha(p.accentTextColor, 0.06 * decorOpacityMultiplier)
        )
        drawSpokedWheel(
          ctx,
          secondGearCx,
          secondGearCy,
          secondGearR * 0.28,
          secondGearR * 0.76,
          4,
          -secondGearAngle,
          gearPrimarySubtleAlpha,
          1.3
        )
        // 秒轮宝石轴承（线框双环）
        ctx.strokeStyle = jewelStrokeColor
        ctx.lineWidth = 0.8
        ctx.beginPath()
        ctx.arc(secondGearCx, secondGearCy, 2.8, 0, Math.PI * 2)
        ctx.stroke()
        ctx.strokeStyle = jewelFillColor
        ctx.lineWidth = 0.6
        ctx.beginPath()
        ctx.arc(secondGearCx, secondGearCy, 1.5, 0, Math.PI * 2)
        ctx.stroke()

        // 传动齿轮与秒轮之间的小惰轮
        var idlerCx = (transCx + secondGearCx) * 0.5 + p.baseRadius * 0.04
        var idlerCy = (transCy + secondGearCy) * 0.5 - p.baseRadius * 0.02
        var idlerR = p.baseRadius * 0.08
        drawGearTeeth(
          ctx,
          idlerCx,
          idlerCy,
          idlerR,
          10,
          3.5,
          currentGearAngle * 2.2,
          ColorMix.colorWithAlpha(p.primaryTextColor, 0.28 * decorOpacityMultiplier),
          1.3,
          undefined
        )
        // 惰轮内环
        ctx.strokeStyle = ColorMix.colorWithAlpha(p.primaryTextColor, 0.18 * decorOpacityMultiplier)
        ctx.lineWidth = 0.8
        ctx.beginPath()
        ctx.arc(idlerCx, idlerCy, idlerR * 0.45, 0, Math.PI * 2)
        ctx.stroke()
        // 惰轮宝石轴承（线框双环）
        ctx.strokeStyle = jewelStrokeColor
        ctx.lineWidth = 0.7
        ctx.beginPath()
        ctx.arc(idlerCx, idlerCy, 2.2, 0, Math.PI * 2)
        ctx.stroke()
        ctx.strokeStyle = jewelFillColor
        ctx.lineWidth = 0.5
        ctx.beginPath()
        ctx.arc(idlerCx, idlerCy, 1.2, 0, Math.PI * 2)
        ctx.stroke()

        // 6. 擒纵焦点轴线对齐线（水平 0°；原版单参 Math.min 等价化简）
        var focalAxisEndRadius = p.lyricRingRadius - Math.max(14, p.baseRadius * 0.025)
        ctx.strokeStyle = gearAccentStrongAlpha
        ctx.lineWidth = 2
        ctx.beginPath()
        ctx.moveTo(p.centerX + p.baseRadius * 0.8, p.centerY)
        ctx.lineTo(p.centerX + focalAxisEndRadius, p.centerY)
        ctx.stroke()

        // 焦点箭头指示
        var arrowX = p.centerX + focalAxisEndRadius
        ctx.fillStyle = gearAccentStrongAlpha
        ctx.beginPath()
        ctx.moveTo(arrowX, p.centerY - 4)
        ctx.lineTo(arrowX + 8, p.centerY)
        ctx.lineTo(arrowX, p.centerY + 4)
        ctx.closePath()
        ctx.fill()

        ctx.restore()

        canvasRafId = window.requestAnimationFrame(render)
      }

      canvasRafId = window.requestAnimationFrame(render)
    }

    // ---------- 生命周期 ----------
    function setTheme(newTheme) {
      theme = newTheme
      layoutVersion += 1
    }

    function setLines(newLines) { /* 行数据经 tick 传入 */ }

    function tick(frameState) {
      if (!theme || !rootEl) return
      var now = frameState.currentTime
      nowRef = now
      showText = frameState.showText !== false
      paused = frameState.isPlaying === false

      lines = frameState.lines || []
      currentLineIndex = typeof frameState.currentLineIndex === 'number' ? frameState.currentLineIndex : -1
      if (currentLineIndex >= 0 && currentLineIndex < lines.length) {
        lastValidLineIndex = currentLineIndex
        hasObservedLine = true
      }

      // 原版 useEffect([currentLineIndex])：待处理跳转索引与当前行同步时清除手动锚点
      if (seekEffectLastIndex === null || seekEffectLastIndex !== currentLineIndex) {
        seekEffectLastIndex = currentLineIndex
        if (pendingSeekIndex === currentLineIndex) {
          pendingSeekIndex = null
          manualScrollAnchorIndex = null
        }
      }

      updateInstrumental(now, frameState)

      var motionProfile = Core.resolvePendoloMotionProfile(theme.animationIntensity)
      var targetLineIndex = computeTargetLineIndex()
      integrateSpring(targetLineIndex, frameState.dt, motionProfile)

      // 几何（原版 useMemo 计算）
      var centerX = viewport.width * TUNING.wheelCenterX
      var centerY = viewport.height * TUNING.wheelCenterY
      var baseRadius = Math.min(viewport.width, viewport.height) * TUNING.arcRadius
      var lyricRadiusOffset = Math.min(viewport.width, viewport.height) * 0.06
      var lyricRingRadius = baseRadius + lyricRadiusOffset

      var maxItemX = centerX + baseRadius
      var availableTextWidth = Math.max(
        140,
        Math.min(viewport.width * 0.46, viewport.width - maxItemX - 48)
      )
      availableTextWidthRef = availableTextWidth

      // 擒纵角度换算（原版 useTransform）
      var totalArcRad = (TUNING.arcAngleDeg * Math.PI) / 180
      var visibleWindowCount = 9
      var angleStepRad = totalArcRad / Math.max(1, visibleWindowCount - 1)
      var wheelRotationDeg = -(springValue - targetLineIndex) * angleStepRad * (180 / Math.PI)
      var textRotationCorrectionDeg = -wheelRotationDeg * 0.65
      gearAngleRef.value = springValue * angleStepRad

      var primaryTextColor = theme.primaryColor || '#FFFFFF'
      var accentTextColor = theme.accentColor || '#3B82F6'

      // 机芯 canvas 属性快照
      var contentBox = resolveClockworkBox(
        centerX,
        centerY,
        baseRadius,
        lyricRingRadius,
        viewport.width,
        viewport.height,
        TUNING.showCenterGradient !== false
      )
      canvasProps.contentBox = contentBox
      canvasProps.centerX = centerX
      canvasProps.centerY = centerY
      canvasProps.baseRadius = baseRadius
      canvasProps.lyricRingRadius = lyricRingRadius
      canvasProps.audioBass = frameState.audioBands ? (frameState.audioBands.bass || 0) : 0.18
      canvasProps.primaryTextColor = primaryTextColor
      canvasProps.accentTextColor = accentTextColor
      canvasProps.backgroundColor = theme.backgroundColor
      canvasProps.showGearDecor = TUNING.showGearDecor
      canvasProps.showCenterGradient = TUNING.showCenterGradient !== false
      canvasProps.showCover = TUNING.showCoverOnWatchFace !== false
      canvasProps.paused = paused
      canvasProps.motionProfile = motionProfile

      var boxKey = contentBox.left + ',' + contentBox.top + ',' + contentBox.width + ',' + contentBox.height
      if (boxKey !== lastBoxKey) {
        lastBoxKey = boxKey
        canvasEl.style.left = contentBox.left + 'px'
        canvasEl.style.top = contentBox.top + 'px'
        canvasEl.style.width = contentBox.width + 'px'
        canvasEl.style.height = contentBox.height + 'px'
      }
      // 原版 enableLineGlow 的 drop-shadow（默认关闭）
      var canvasFilter = TUNING.enableLineGlow
        ? 'drop-shadow(0 0 4px ' + ColorMix.colorWithAlpha(accentTextColor, 0.65) + ') drop-shadow(0 0 12px ' + ColorMix.colorWithAlpha(accentTextColor, 0.3) + ')'
        : ''
      if (canvasFilter !== lastCanvasFilter) {
        lastCanvasFilter = canvasFilter
        canvasEl.style.filter = canvasFilter
      }

      updateCoverImage(frameState.coverUrl || null)
      updateIcon(centerX, centerY, baseRadius, accentTextColor)

      // 歌词轮盘（原版 showText 条件渲染）
      railEl.style.display = showText ? '' : 'none'
      if (showText) {
        railEl.style.transformOrigin = centerX + 'px ' + centerY + 'px'
        railEl.style.transform = 'rotate(' + wheelRotationDeg + 'deg)'

        // 行块高度 + 轮盘布局
        var measureWidth = availableTextWidth / TUNING.activeScale
        var blockHeights = buildBlockHeights(targetLineIndex, measureWidth)
        var lineItemList = Core.calculatePendoloWheelLayout(
          lines,
          targetLineIndex,
          0,
          viewport.width,
          viewport.height,
          TUNING,
          lyricRadiusOffset,
          blockHeights
        )
        syncItems(lineItemList, targetLineIndex, wheelRotationDeg, textRotationCorrectionDeg, motionProfile)
      }

      // 字幕兜底（宿主底部字幕层）
      var runtimeState = Runtime.getRuntimeState({
        lines: lines,
        currentLineIndex: currentLineIndex,
        currentTime: now,
        getLineEndTime: RenderHints.getLineRenderEndTime
      })
      window.FoliaSubtitleOverlay.update({
        hostEl: host,
        showText: showText,
        activeLine: runtimeState.activeLine,
        recentCompletedLine: runtimeState.recentCompletedLine,
        nextLines: runtimeState.nextLines,
        theme: theme
      })
    }

    function destroy() {
      if (canvasRafId) {
        window.cancelAnimationFrame(canvasRafId)
        canvasRafId = 0
      }
      if (resizeObserver) {
        resizeObserver.disconnect()
        resizeObserver = null
      }
      if (manualScrollResetTimer !== null) {
        window.clearTimeout(manualScrollResetTimer)
        manualScrollResetTimer = null
      }
      if (railEl) {
        railEl.removeEventListener('wheel', handleRailWheel)
        railEl.removeEventListener('touchstart', handleRailTouchStart)
        railEl.removeEventListener('touchmove', handleRailTouchMove)
        railEl.removeEventListener('touchend', handleRailTouchEnd)
        railEl.removeEventListener('touchcancel', handleRailTouchEnd)
      }
      if (rootEl) {
        rootEl.remove()
        rootEl = null
      }
      canvasEl = null
      canvasCtx = null
      iconWrapEl = null
      iconSvgEl = null
      railEl = null
      lineItems.clear()
      blockHeightCache.clear()
      coverState.image = null
      coverState.loadingUrl = null
      instrumentalWatch = null
      isInstrumental = false
      instrumentalIndex = 0
      springInit = false
      springValue = 0
      springVelocity = 0
      manualScrollAnchorIndex = null
      pendingSeekIndex = null
      seekEffectLastIndex = null
      window.FoliaSubtitleOverlay.destroy()
      host = null
    }

    return {
      id: 'pendolo',
      mount: mount,
      setTheme: setTheme,
      setLines: setLines,
      setFontScale: function (s) {
        var next = s === undefined ? 1 : s
        if (next !== fontScale) {
          fontScale = next
          layoutVersion += 1
        }
      },
      tick: tick,
      destroy: destroy
    }
  }

  window.FoliaModePendolo = { create: createMode }
})()
