// 镜台（diorama）模式入口：移植自 folia-major src/components/visualizer/diorama/
//   VisualizerDiorama.tsx（React 包装 + 切歌/循环转场状态机 + 乐器纯音乐合成走廊）
//   + @react-three/fiber Canvas 装配（WebGLRenderer/Scene/PerspectiveCamera 原生等价）
// React → 原生转写对照：
//   useState（committedSong/transition/instrumentalIndex）→ 闭包变量 + tick 状态机；
//   useEffect（ready 门 rAF watch）→ tick 内等价状态机（sawReset + 播放确认 + 8s 墙钟上限）；
//   MotionValue currentTime / audioPower / audioBands → frameState 数值
//     （原版音频电平 0..255，frameState 为 0..1，粒子/场景取用处等价直读）；
//   AnimatePresence 等待文案 → CSS opacity 过渡；
//   VisualizerShell/背景层 → 宿主 bridge 管理，本模式不复制；
//   VisualizerSubtitleOverlay → window.FoliaSubtitleOverlay；
//   dioramaTuning（设置面板）→ 不转写，恒用 DEFAULT_DIORAMA_TUNING；
//   seed（currentSongId）→ 插件无曲目 id，用 "歌名|歌手" 作确定性身份（参考 sonnet 先例）。
// Canvas 装配对应：camera={{ position:[0,0.6,9], fov:55 }}（R3F 默认 near 0.1 / far 1000）、
//   dpr=[1,2]、gl={{ alpha:true, antialias:true }}、R3F 默认 ACESFilmicToneMapping。
// useFrame 顺序（CameraRig 先注册、DioramaScene 后注册）→ 先 rig.update 后 scene.update，
//   保证 activeLineWidth 与原版同为上一帧写入值。
// 依赖模块：FoliaDioramaCore/Sequencer/Scene/Camera + FoliaVisualizerRuntime/FoliaRenderHints/
//   FoliaSubtitleOverlay + window.THREE。
(function () {
  'use strict'

  var Core = window.FoliaDioramaCore
  var Sequencer = window.FoliaDioramaSequencer
  var SceneFactory = window.FoliaDioramaScene
  var CameraFactory = window.FoliaDioramaCamera
  var VisualizerRuntime = window.FoliaVisualizerRuntime
  var RenderHints = window.FoliaRenderHints

  // 排他转写常量（原版 VisualizerDiorama.tsx）
  var PRUNE_MARGIN_BEHIND = 4
  var LOOP_RESTART_MAX_INDEX = 1
  var INSTRUMENTAL_FRAMES = 96
  var INSTRUMENTAL_SECONDS_PER_FRAME = 5
  var INSTRUMENTAL_COMMIT_SECONDS = 2
  var READY_GRACE_MS = 8000
  // 原版 parserCore.ts 的 INTERLUDE_FULL_TEXT
  var INTERLUDE_FULL_TEXT = '......'

  var DEFAULT_TUNING = Core.DEFAULT_DIORAMA_TUNING

  // 乐器（无歌词）飞越：合成幻影行走廊——空文本行携带 blockIndex/songPart/isChorus 结构，
  // 让既有运镜/构图/尘埃机械铺排出一段有起承转合的旅程
  function buildInstrumentalPhantomLines() {
    var result = []
    for (var i = 0; i < INSTRUMENTAL_FRAMES; i += 1) {
      var block = Math.floor(i / 4)
      var isChorus = block % 3 === 2
      result.push({
        words: [],
        startTime: i * INSTRUMENTAL_SECONDS_PER_FRAME,
        endTime: (i + 1) * INSTRUMENTAL_SECONDS_PER_FRAME,
        fullText: '',
        blockIndex: block,
        songPart: isChorus ? 'chorus' : 'verse',
        isChorus: isChorus
      })
    }
    return result
  }

  function isInterludeLine(line) {
    return !!line && line.fullText === INTERLUDE_FULL_TEXT
  }

  function createMode() {
    var host = null
    var layerEl = null
    var canvasHost = null
    var canvasEl = null
    var waitingEl = null
    var resizeObserver = null
    var destroyed = false

    // ---- 帧状态吸收（原版 props）----
    var theme = null
    var lines = []
    var currentLineIndex = -1
    var currentTime = 0
    var isPlaying = true
    var showText = true
    var audioPower = 0
    var audioBands = { bass: 0, lowMid: 0, mid: 0, vocal: 0, treble: 0 }
    var songTitle = null
    var songArtist = null
    var songAlbum = null
    var fontScale = 1
    var tuning = DEFAULT_TUNING

    // ---- WebGL 装配（原版 <Canvas>）----
    var renderer = null
    var scene3d = null
    var camera = null
    var clock = null
    var sceneModule = null
    var rigModule = null

    // ---- committed 门（原版 committedSong useState + effect）----
    var committed = { seed: 'diorama', lines: [] }
    var pendingWatch = null // { seed, sawReset, startWall }

    // ---- 乐器路径状态 ----
    var phantomCache = { seed: null, lines: null }
    var instrumentalSeed = null
    var instrumentalIndex = 0

    // ---- 转场状态机（原版 seqRef 等 refs）----
    var seq = Sequencer.createSequencerState()
    var lastLocalIndex = 0
    var hasEverActive = false
    var lastActiveKey = null
    var transitionEpoch = 0
    var transition = null // { epoch, outgoingIndex }
    var transitionTimer = 0

    // 相机与场景共享的活动行世界宽度（原版 activeLineWidthRef，每帧值绝不进状态）
    var activeLineWidth = 0
    // 跨帧传参容器（避免每帧对象分配堆积）
    var rigCtx = {
      camera: null, sequencer: null, globalIndex: 0, activeLineWidth: 0,
      transitionEpoch: 0, delta: 0, now: 0, clockElapsedTime: 0
    }
    var sceneCtx = {
      delta: 0, now: 0, clockElapsedTime: 0, camera: null, sequencer: null, globalIndex: 0,
      transitionOutgoingIndex: null, audioPower: 0, audioBands: audioBands, activeLineWidth: 0,
      renderer: null
    }

    var lastThemeIntensity = null
    var motionParams = null

    // ---------- 歌曲身份与门 ----------
    function resolveSeed() {
      var title = songTitle || ''
      var artist = songArtist || ''
      if (!title && !artist) return 'diorama'
      return title + '|' + artist
    }

    function lyricsSig(list) {
      if (!list || list.length === 0) return ''
      return list.length + '|' + (list[0] && list[0].fullText !== undefined ? list[0].fullText : '')
    }

    // ready 门（原版 useEffect [seed, lyricsSig, ...] 的 tick 等价状态机）：
    // 新歌的歌词加载完成后立即提交；空歌词时按播放确认（reset 后播过 2 秒）或 8s 墙钟上限提交
    function updateCommit() {
      var seed = resolveSeed()
      var sig = lyricsSig(lines)
      var committedSig = lyricsSig(committed.lines)
      if (seed === committed.seed) {
        // 同一首歌：歌词内容实际变化（晚到/重处理）才就地重提交
        if (sig !== committedSig) {
          committed = { seed: seed, lines: lines }
          pendingWatch = null
        }
        return
      }
      if (sig !== '') {
        // 新歌待定：歌词一到位立即提交
        committed = { seed: seed, lines: lines }
        pendingWatch = null
        return
      }
      // 无歌词：乐器或仍在加载（当前不可分）。看播放：真正播过 INSTRUMENTAL_COMMIT_SECONDS
      // 仍无歌词按乐器提交；仅加载中（时间未前进）继续等待。墙钟上限保证门永不悬死。
      if (!pendingWatch || pendingWatch.seed !== seed) {
        pendingWatch = { seed: seed, sawReset: false, startWall: performance.now() }
      }
      if (!pendingWatch.sawReset && currentTime < 1) pendingWatch.sawReset = true
      if ((pendingWatch.sawReset && currentTime >= INSTRUMENTAL_COMMIT_SECONDS)
        || performance.now() - pendingWatch.startWall >= READY_GRACE_MS) {
        committed = { seed: seed, lines: lines }
        pendingWatch = null
      }
    }

    // ---------- 转场状态机（原版渲染体逐帧逻辑） ----------
    function updateSequencer(gatedSeed, effectiveLines, effectiveLineIndex) {
      var outgoingSeg = Sequencer.activeSegment(seq)
      var outgoingLocal = outgoingSeg
        ? Math.min(Math.max(lastLocalIndex, 0), outgoingSeg.span - 1)
        : 0
      var outgoingGlobal = outgoingSeg ? outgoingSeg.globalStart + outgoingLocal : 0

      // 新歌由（已过门的）seed 检测——门保证触发时走廊已用真实歌词建好、只飞一次
      var isNewSong = !outgoingSeg || outgoingSeg.seed !== gatedSeed
      // 同一首歌但走廊生成后歌词变了：就地重建活动走廊的几何（不飞、不吸附）
      var lyricsChanged = !isNewSong && !!outgoingSeg && outgoingSeg.lines !== effectiveLines
      // 循环/回到开头：同一首歌，行下标在已越过之后跳回最顶
      var isLoopRestart = !!outgoingSeg && !isNewSong && effectiveLineIndex >= 0
        && effectiveLineIndex <= LOOP_RESTART_MAX_INDEX
        && lastLocalIndex > effectiveLineIndex

      if (isNewSong) {
        var placementOrigin = { x: 0, y: 0, z: 0 }
        if (outgoingSeg) {
          var anchor = Core.getFrame(outgoingSeg.frames, outgoingLocal).position
          var off = Core.pickTransitionOffset(gatedSeed || 'diorama', transitionEpoch + 1)
          placementOrigin = { x: anchor.x + off.x, y: anchor.y + off.y, z: anchor.z + off.z }
        }
        Sequencer.appendSegment(seq, {
          seed: gatedSeed || 'diorama',
          lines: effectiveLines,
          round: 0,
          placementOrigin: placementOrigin
        })
      } else if (lyricsChanged) {
        // 就地：同走廊、同位置、同 globalStart——只有歌词几何追上。相机不动、不飞、不吸附
        Sequencer.updateActiveSegmentLines(seq, effectiveLines)
      }

      var activeSeg = Sequencer.activeSegment(seq)
      var keyChanged = activeSeg.key !== lastActiveKey
      var hadPrevious = lastActiveKey !== null
      if (keyChanged) {
        lastActiveKey = activeSeg.key
        lastLocalIndex = 0
        hasEverActive = false
      }
      if (isLoopRestart) {
        // 把取景送回本走廊的顶部；下面的飞行把相机带过去
        lastLocalIndex = 0
        hasEverActive = false
      }
      // 歌切换（飞向新偏移走廊）或循环（飞回本走廊开头）都从离场姿态起飞，永不硬切
      var startingTransition = (keyChanged && hadPrevious) || isLoopRestart
      if (startingTransition) {
        transitionEpoch += 1
        transition = { epoch: transitionEpoch, outgoingIndex: outgoingGlobal }
        if (transitionTimer) clearTimeout(transitionTimer)
        transitionTimer = setTimeout(function () { transition = null }, Core.TRANSITION_DURATION * 1000)
      }
      if (effectiveLineIndex >= 0) {
        lastLocalIndex = effectiveLineIndex
        hasEverActive = true
      }
      // 钳制到活动段的真实行数（切歌瞬间父级可能仍报上一首更大的下标，钳制保证解析有效）
      var rawLocalIndex = effectiveLineIndex >= 0 ? effectiveLineIndex : lastLocalIndex
      var localPositionIndex = Math.min(Math.max(rawLocalIndex, 0), Math.max(activeSeg.span - 1, 0))
      var globalIndex = activeSeg.globalStart + localPositionIndex
      // 相机早已飞过的走廊剪掉——但飞行全程保留离场走廊（让它在屏幕上后退而非消失）
      var activeOutgoingIndex = startingTransition
        ? outgoingGlobal
        : (transition ? transition.outgoingIndex : null)
      var pruneFrom = activeOutgoingIndex != null ? Math.min(globalIndex, activeOutgoingIndex) : globalIndex
      Sequencer.pruneSegments(seq, pruneFrom - PRUNE_MARGIN_BEHIND)

      return {
        globalIndex: globalIndex,
        transitionOutgoingIndex: transition ? transition.outgoingIndex : null,
        transitionEpoch: transitionEpoch
      }
    }

    // ---------- 运动参数（原版 useMemo [dioramaTuning, theme.animationIntensity]） ----------
    function updateMotionParams() {
      var intensity = theme ? theme.animationIntensity : undefined
      if (!motionParams || lastThemeIntensity !== intensity) {
        lastThemeIntensity = intensity
        motionParams = Core.resolveDioramaMotionParams(tuning, intensity)
        if (sceneModule) sceneModule.setMotion(motionParams)
        if (rigModule) rigModule.setMotion(motionParams)
      }
    }

    // ---------- 等待文案样式 ----------
    function updateWaitingStyle() {
      if (!waitingEl) return
      var scale = fontScale
      var size = 'clamp(' + (1.5 * scale).toFixed(3) + 'rem, ' + (3.5 * scale).toFixed(3) + 'vw, ' + (2.25 * scale).toFixed(3) + 'rem)'
      waitingEl.style.fontSize = size
      waitingEl.style.color = theme ? theme.secondaryColor : '#71717a'
      var family = theme ? window.FoliaDioramaText.resolveThemeFontStack(theme) : 'sans-serif'
      waitingEl.style.fontFamily = family
    }

    // ---------- 生命周期 ----------
    function mount(hostEl) {
      host = hostEl

      layerEl = document.createElement('div')
      layerEl.className = 'folia-mode-diorama'
      layerEl.style.cssText = [
        'position:absolute', 'inset:0', 'z-index:10', 'overflow:hidden',
        'pointer-events:none'
      ].join(';')

      canvasHost = document.createElement('div')
      canvasHost.style.cssText = 'position:absolute;inset:0;z-index:0'
      canvasHost.setAttribute('aria-hidden', 'true')

      // 等待文案层（原版 h-[70vh] flex items-end 容器 + absolute 文字）
      var waitingWrap = document.createElement('div')
      waitingWrap.style.cssText = [
        'position:relative', 'z-index:10', 'width:100%', 'height:70vh',
        'display:flex', 'align-items:flex-end', 'justify-content:center',
        'padding:2rem'
      ].join(';')
      waitingEl = document.createElement('div')
      waitingEl.style.cssText = [
        'position:absolute', 'opacity:0', 'transition:opacity 0.2s', 'pointer-events:none',
        'line-height:1.5'
      ].join(';')
      waitingEl.textContent = '等待音乐...'
      waitingWrap.appendChild(waitingEl)

      layerEl.appendChild(canvasHost)
      layerEl.appendChild(waitingWrap)
      host.appendChild(layerEl)

      buildRenderer()
      updateWaitingStyle()

      // 尺寸跟踪（原版 R3F Canvas 自适应宿主；useThree size → host 尺寸 + resize 监听）
      if (typeof ResizeObserver !== 'undefined') {
        resizeObserver = new ResizeObserver(function () { syncCanvasSize() })
        resizeObserver.observe(layerEl)
      }
      window.addEventListener('resize', syncCanvasSize)
      syncCanvasSize()
    }

    function buildRenderer() {
      var THREE = window.THREE
      if (!THREE) return
      renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true })
      // 原版 dpr=[1,2]
      renderer.setPixelRatio(Math.min(2, Math.max(1, window.devicePixelRatio || 1)))
      // R3F 默认色调映射（未设 flat）
      renderer.toneMapping = THREE.ACESFilmicToneMapping
      renderer.setClearColor(0x000000, 0)
      canvasEl = renderer.domElement
      canvasEl.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block'
      canvasHost.appendChild(canvasEl)

      scene3d = new THREE.Scene()
      // 原版 camera={{ position:[0,0.6,9], fov:55 }}；R3F 默认 near/far = 0.1/1000
      camera = new THREE.PerspectiveCamera(55, 1, 0.1, 1000)
      camera.position.set(0, 0.6, 9)
      clock = new THREE.Clock()

      motionParams = Core.resolveDioramaMotionParams(tuning, theme ? theme.animationIntensity : undefined)
      lastThemeIntensity = theme ? theme.animationIntensity : undefined

      // 注册顺序对齐原版 JSX：CameraRig 先、DioramaScene 后（useFrame 顺序）
      rigModule = CameraFactory.createDioramaCameraRig({ motion: motionParams })
      sceneModule = SceneFactory.createDioramaScene({
        theme: theme || {
          name: '', backgroundColor: '#09090b', primaryColor: '#f4f4f5', accentColor: '#f4f4f5',
          secondaryColor: '#71717a', fontStyle: 'sans', animationIntensity: 'normal',
          wordColors: [], lyricsIcons: [], provider: ''
        },
        showLyrics: showText,
        showParticles: tuning.showParticles,
        backgroundParticleCircumference: tuning.backgroundParticleCircumference,
        backgroundParticleRadial: tuning.backgroundParticleRadial,
        geometryVisibility: tuning.geometryVisibility,
        particleDensity: tuning.particleDensity,
        particleScale: tuning.particleScale,
        particleGlowEnabled: tuning.particleGlowEnabled,
        particleGlowIntensity: tuning.particleGlowIntensity,
        lyricsFontScale: fontScale,
        glowIntensity: tuning.glowEnabled ? tuning.glowIntensity : 0,
        soulIntensity: tuning.soulEnabled ? tuning.soulIntensity : 0,
        soulActiveEnabled: tuning.soulEnabled && tuning.soulActiveEnabled,
        gradientIntensity: tuning.gradientEnabled ? tuning.gradientIntensity : 0,
        keywordColoringEnabled: tuning.keywordColoringEnabled,
        motion: motionParams,
        scene: scene3d
      })
      scene3d.add(sceneModule.group)
    }

    function syncCanvasSize() {
      if (!renderer || !layerEl) return
      var w = layerEl.clientWidth || host.clientWidth || 1
      var h = layerEl.clientHeight || host.clientHeight || 1
      if (w <= 0 || h <= 0) return
      renderer.setSize(w, h, false)
      camera.aspect = w / h
      camera.updateProjectionMatrix()
    }

    function setTheme(newTheme) {
      theme = newTheme
      updateWaitingStyle()
      if (sceneModule) sceneModule.setTheme(newTheme)
      updateMotionParams()
    }

    function setLines(newLines) {
      lines = newLines || []
    }

    function setFontScale(scale) {
      var next = scale === undefined ? 1 : scale
      if (next === fontScale) return
      fontScale = next
      updateWaitingStyle()
      if (sceneModule) sceneModule.setParams({ lyricsFontScale: fontScale })
    }

    function tick(frameState) {
      if (destroyed || !renderer || !sceneModule || !rigModule) return

      // 1. 吸收帧状态（MotionValue.get() 等价）
      if (frameState.theme && frameState.theme !== theme) {
        theme = frameState.theme
        updateWaitingStyle()
        sceneModule.setTheme(theme)
        updateMotionParams()
      }
      if (frameState.lines) lines = frameState.lines
      currentLineIndex = typeof frameState.currentLineIndex === 'number' ? frameState.currentLineIndex : -1
      currentTime = frameState.currentTime
      isPlaying = frameState.isPlaying !== false
      showText = frameState.showText !== false
      audioPower = typeof frameState.audioPower === 'number' ? frameState.audioPower : 0
      if (frameState.audioBands) audioBands = frameState.audioBands
      if (frameState.songTitle !== undefined) songTitle = frameState.songTitle
      if (frameState.songArtist !== undefined) songArtist = frameState.songArtist
      if (frameState.songAlbum !== undefined) songAlbum = frameState.songAlbum

      var dt = typeof frameState.dt === 'number' && frameState.dt > 0 ? frameState.dt : 1 / 60
      var clockElapsedTime = clock.getElapsedTime()

      // 2. committed 门 → gated 歌曲
      updateCommit()
      var gatedSeed = committed.seed
      var gatedLines = committed.lines

      // 3. 乐器路径（幻影走廊 + 时间驱动的读头）
      var isInstrumental = gatedLines.length === 0
      if (isInstrumental) {
        if (phantomCache.seed !== gatedSeed) {
          phantomCache.seed = gatedSeed
          phantomCache.lines = buildInstrumentalPhantomLines()
        }
        // 读头按播放时间推进（原版由 effect 重定 key 到这首歌；新歌起步读 0）
        if (instrumentalSeed !== gatedSeed) {
          instrumentalSeed = gatedSeed
          instrumentalIndex = 0
        } else {
          instrumentalIndex = Math.min(
            Math.max(Math.floor(currentTime / INSTRUMENTAL_SECONDS_PER_FRAME), 0),
            INSTRUMENTAL_FRAMES - 1
          )
        }
      }
      var instrumentalReadHead = instrumentalSeed === gatedSeed ? instrumentalIndex : 0

      // 4. 插曲行（'......'）视同 -1：粘性下标保持最后一行真实歌词
      var onInterlude = !isInstrumental
        && currentLineIndex >= 0
        && !!gatedLines[currentLineIndex]
        && isInterludeLine(gatedLines[currentLineIndex])
      var effectiveLineIndex = isInstrumental ? instrumentalReadHead : (onInterlude ? -1 : currentLineIndex)

      // 5. 转场状态机 + 全局下标
      var seqResult = updateSequencer(gatedSeed, isInstrumental ? phantomCache.lines : gatedLines, effectiveLineIndex)

      // 6. 相机（原版 useFrame 注册顺序在前——先于场景读上一帧的活动行宽度）
      rigCtx.camera = camera
      rigCtx.sequencer = seq
      rigCtx.globalIndex = seqResult.globalIndex
      rigCtx.activeLineWidth = activeLineWidth
      rigCtx.transitionEpoch = seqResult.transitionEpoch
      rigCtx.delta = dt
      rigCtx.now = currentTime
      rigCtx.clockElapsedTime = clockElapsedTime
      rigModule.update(rigCtx)

      // 7. 场景（含粒子场 / 尘埃 / 文本）
      sceneCtx.delta = dt
      sceneCtx.now = currentTime
      sceneCtx.clockElapsedTime = clockElapsedTime
      sceneCtx.camera = camera
      sceneCtx.sequencer = seq
      sceneCtx.globalIndex = seqResult.globalIndex
      sceneCtx.transitionOutgoingIndex = seqResult.transitionOutgoingIndex
      sceneCtx.audioPower = audioPower
      sceneCtx.audioBands = audioBands
      sceneCtx.renderer = renderer
      sceneCtx.activeLineWidth = 0
      sceneModule.update(sceneCtx)
      activeLineWidth = sceneCtx.activeLineWidth

      // 8. 渲染
      renderer.render(scene3d, camera)

      // 9. 字幕覆盖层（原版 useVisualizerRuntime + VisualizerSubtitleOverlay：
      //    承载翻译与下一行提示——3D 场景不复制它们）
      var runtimeState = VisualizerRuntime.getRuntimeState({
        lines: lines,
        currentLineIndex: currentLineIndex,
        currentTime: currentTime,
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

      // 10. 等待文案：只在本段第一行之前显示——歌曲中段的间隙不算（3D 场景仍在最后一行上）
      var showWaiting = showText && !runtimeState.activeLine && !hasEverActive
      waitingEl.style.opacity = showWaiting ? '0.5' : '0'
    }

    function destroy() {
      destroyed = true
      if (transitionTimer) { clearTimeout(transitionTimer); transitionTimer = 0 }
      window.removeEventListener('resize', syncCanvasSize)
      if (resizeObserver) { resizeObserver.disconnect(); resizeObserver = null }
      if (sceneModule) { sceneModule.dispose(); sceneModule = null }
      rigModule = null
      scene3d = null
      camera = null
      if (renderer) {
        renderer.dispose()
        if (renderer.forceContextLoss) renderer.forceContextLoss()
        renderer = null
      }
      window.FoliaSubtitleOverlay.destroy()
      if (layerEl) {
        layerEl.remove()
        layerEl = null
      }
      canvasEl = null
      canvasHost = null
      waitingEl = null
      host = null
      seq = Sequencer.createSequencerState()
      lastActiveKey = null
      lastLocalIndex = 0
      hasEverActive = false
      transition = null
      transitionEpoch = 0
      committed = { seed: 'diorama', lines: [] }
      pendingWatch = null
      phantomCache = { seed: null, lines: null }
      instrumentalSeed = null
      instrumentalIndex = 0
      activeLineWidth = 0
    }

    return {
      id: 'diorama',
      mount: mount,
      setTheme: setTheme,
      setLines: setLines,
      setFontScale: setFontScale,
      tick: tick,
      destroy: destroy
    }
  }

  window.FoliaModeDiorama = { create: createMode }
})()
