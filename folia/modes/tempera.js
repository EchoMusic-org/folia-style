// 凝彩（tempera）模式入口：移植自 folia-major src/components/visualizer/tempera/
//   VisualizerTempera.tsx（React 包装）+ ../songHandover.ts（已提交歌曲滞后门）
//   + src/utils/colorExtractor.ts 的封面取色接线
//   → 原生 JS 模式接口（mount/setTheme/setLines/setFontScale/tick/destroy）。
// React 对应关系：
//   useState/useRef → 闭包变量；useMemo（program）→ 按签名惰性编译缓存；
//   useVisualizerSongCommit（已提交歌曲滞后门，readyGraceMs=3000）→ 纯函数判定 + tick 内 watch；
//   MotionValue.get/useMotionValueEvent → tick 里读 frameState 并注入运行时；
//   TemperaImageImportMenu 等设置 UI 不转写：layerImages 恒为空数组；
//   VisualizerSubtitleOverlay → window.FoliaSubtitleOverlay。
// 运行时模块：window.FoliaTemperaRuntime（Pixi 生命周期 + 逐帧更新）。
// 注意：Tempera 渲染层不消费音频（audioPower/audioBands 只喂共享背景层，原版 README 明确）。
(function () {
  'use strict'

  var Core = window.FoliaTemperaCore
  var Program = window.FoliaTemperaProgram
  var Palette = window.FoliaTemperaPalette
  var RuntimeFactory = window.FoliaTemperaRuntime
  var RenderHints = window.FoliaRenderHints
  var VisualizerRuntime = window.FoliaVisualizerRuntime

  // ---------- 歌曲交接滞后门（原版 visualizer/songHandover.ts） ----------
  // 共享的「哪首歌真正在屏上」的门。父层在切歌时先把歌词清成 []、
  // 几次渲染后再填入，直接跟着 seed 走的模式会对着空歌重建、之后才把字弹出来。
  // 下面的一切都跑在一首滞后于真实的已提交歌上。

  // 「无词」的稳定身份，提交空集永远不像一次内容变化
  var EMPTY_COMMITTED_LINES = []

  // 2 秒确认无歌词的播放读作无词（纯音乐），而不是还在加载
  var DEFAULT_INSTRUMENTAL_COMMIT_SECONDS = 2
  // 壁钟上限（毫秒），播放时间从不前进时门也不会永远挂住
  var DEFAULT_READY_GRACE_MS = 8000

  // VisualizerTempera 传入的 readyGraceMs
  var READY_GRACE_MS = 3000

  // 已保存分词在集合上的折叠，混入下面的签名里。
  // 本插件的 Line 恒无 wordSegments，恒折叠到同一个常数（FNV 基值）
  function hashWordSegments(lines) {
    var hash = 2166136261
    var mix = function (value) {
      hash = Math.imul(hash ^ value, 16777619)
    }
    lines.forEach(function (line, index) {
      if (!line.wordSegments) return
      mix(index)
      line.wordSegments.forEach(function (segment) { mix(segment.length) })
    })
    return hash >>> 0
  }

  // 歌词集的内容签名。同一性比较在这里没用：加载中/无词的歌每次渲染都会
  // 递下来一个全新的 []，直接依赖 lines 引用会让门的计时器每次渲染都重置、永不触发。
  // 空串表示「没有词」，在「还在加载」与「纯音乐」之间刻意二义——只有播放能区分
  function getLyricsSignature(lines) {
    if (lines.length === 0) return ''
    return lines.length + '|' + (lines[0] && lines[0].fullText !== undefined ? lines[0].fullText : '') + '|' + hashWordSegments(lines)
  }

  // 整个门，作为纯判定（原版 decideSongCommit）
  // 返回 { action: 'commit'|'watch'|'idle', isInstrumental }
  function decideSongCommit(state) {
    if (state.seed === state.committedSeed) {
      if (state.lyricsSignature === '') {
        // 词消失从来不是关于这首歌的新闻：是父层站在两首歌之间，
        // seed 比 new lyrics 早一渲染到达。在这里提交空集就是过去那个
        // 「等待音乐」占位闪过一首歌词已缓存的歌的原因
        if (state.isCommittedInstrumental || state.committedSignature !== '') {
          return { action: 'idle' }
        }
        return { action: 'watch' }
      }
      // 同一首歌、不同的词：迟到的加载或重处理。就地接住——
      // 卡在这里会让模式渲染播放器早已越过的歌词
      if (state.lyricsSignature !== state.committedSignature) {
        return { action: 'commit', isInstrumental: false }
      }
      return { action: 'idle' }
    }

    // 新歌在它的词落地时登台，而且必须是*不同的*词：
    // seed 比 lines 早一渲染翻转，相同的签名是还在 prop 里的出画歌的词
    if (state.lyricsSignature !== '' && state.lyricsSignature !== state.committedSignature) {
      return { action: 'commit', isInstrumental: false }
    }
    return { action: 'watch' }
  }

  // 绑在播放上而非壁钟：只在加载的歌还没前进时继续等它的词，
  // 真的播到这里还没有词的按纯音乐处理。readyGraceMs 是对永不开始的歌的逃生口
  function isInstrumentalConfirmed(watchState, limits) {
    return (watchState.sawPlaybackReset && watchState.playbackTime >= limits.instrumentalCommitSeconds)
      || watchState.elapsedMs >= limits.readyGraceMs
  }

  function createMode() {
    var host = null            // 宿主元素（registry 传入）
    var layerEl = null         // 模式根层（inset 0 / z-10 / overflow hidden）
    var pixiHost = null        // Pixi canvas 宿主
    var fallbackEl = null      // 段落为空时的文字兜底
    var runtime = null
    var runtimeFailed = false
    var creating = false
    var destroyed = false

    var theme = null           // 最新主题（setTheme / tick 注入）
    var lines = []             // 最新歌词行
    var currentLineIndex = -1
    var currentTime = 0
    var isPlaying = false
    var showText = true
    var fontScale = 1
    var tuning = Core.DEFAULT_TEMPERA_TUNING   // 本插件无设置 UI，恒默认值
    var songTitle = null
    var songArtist = null
    var songAlbum = null
    var coverUrl = null
    var coverColors = []       // gradient 色彩模式的封面取色结果
    var coverColorsPending = false

    // 已提交歌曲（屏幕上实际呈现的 { seed, lines, program, theme, coverColors }）
    var committed = { seed: undefined, lines: EMPTY_COMMITTED_LINES, isInstrumental: false }
    var committedSong = null   // 完整上下文（含 program/theme/coverColors）
    var swapInFlight = false

    // 纯音乐 watch 状态（原版 rAF 循环的等价物，tick 内驱动）
    var watching = false
    var watchStartWall = 0
    var sawPlaybackReset = false

    // 程序编译缓存（等价原版 useMemo([programLines, committedSeed, wholeLineLyrics])）
    var programCache = { key: null, program: null }
    var virtualLinesCache = null

    var lastPaused = false
    var lastPausedTime = -1
    var lastMetadata = { title: null, artist: null, album: null }

    // ---------- 歌曲种子 ----------
    // 原版 seed 默认 'tempera'；插件没有曲目 id，用「歌名|歌手」作确定性身份
    function resolveSeed() {
      var title = songTitle || ''
      var artist = songArtist || ''
      if (!title && !artist) return 'tempera'
      return title + '|' + artist
    }

    // ---------- 程序编译（等价 useMemo） ----------
    function getVirtualLines() {
      if (virtualLinesCache) return virtualLinesCache
      var generated = []
      for (var i = 0; i < 60; i++) {
        generated.push({
          id: 'virtual-block-' + i,
          startTime: i * 8,
          endTime: i * 8 + 6,
          fullText: '♪',
          words: [],
          isChorus: false
        })
      }
      virtualLinesCache = generated
      return generated
    }

    function compileProgramLines(programLines, committedSeed) {
      var key = committedSeed + '::' + getLyricsSignature(programLines) + '::' + String(tuning.wholeLineLyrics)
      if (programCache.key === key && programCache.program) return programCache.program
      var program = Program.compileTemperaProgram(programLines, committedSeed, { wholeLineLyrics: tuning.wholeLineLyrics })
      programCache = { key: key, program: program }
      return program
    }

    // 当前「应显示」的歌曲上下文（对应原版 songContext useMemo）
    function resolveSongContext() {
      var committedLines = committed.lines
      var programLines = showText
        ? (committedLines.length > 0 ? committedLines : getVirtualLines())
        : EMPTY_COMMITTED_LINES
      var program = compileProgramLines(programLines, committed.seed)
      return {
        seed: committed.seed,
        lines: committedLines,
        program: program,
        theme: theme,
        coverColors: coverColors
      }
    }

    function sameSong(a, b) {
      return a === b || (
        a && b && a.seed === b.seed && a.program === b.program && a.theme === b.theme && a.coverColors === b.coverColors
      )
    }

    // ---------- 歌曲交接门（原版 useVisualizerSongCommit 的 effect） ----------
    function updateSongCommit() {
      if (destroyed) return
      var seed = resolveSeed()
      var lyricsSignature = getLyricsSignature(lines)
      var committedSignature = getLyricsSignature(committed.lines)
      var committedSeed = committed.seed
      var isCommittedInstrumental = committed.isInstrumental

      var decision = decideSongCommit({
        seed: seed,
        committedSeed: committedSeed,
        lyricsSignature: lyricsSignature,
        committedSignature: committedSignature,
        isCommittedInstrumental: isCommittedInstrumental
      })

      if (decision.action === 'idle') {
        watching = false
        return
      }
      if (decision.action === 'commit') {
        watching = false
        committed = { seed: seed, lines: lines, isInstrumental: decision.isInstrumental }
        committedSong = null
        return
      }

      // watch：挂起已提交的歌，观察播放以分辨这是哪一种静默。
      // 原版是一个 rAF 循环；tick 每帧调用与此等价
      if (!watching) {
        watching = true
        sawPlaybackReset = false
        watchStartWall = performance.now()
      }
      var playbackTime = currentTime
      if (!sawPlaybackReset && playbackTime < 1) sawPlaybackReset = true
      var settled = isInstrumentalConfirmed(
        { sawPlaybackReset: sawPlaybackReset, playbackTime: playbackTime, elapsedMs: performance.now() - watchStartWall },
        { instrumentalCommitSeconds: DEFAULT_INSTRUMENTAL_COMMIT_SECONDS, readyGraceMs: READY_GRACE_MS }
      )
      if (settled) {
        // 按定义以无词提交：这一瞬间 prop 里只可能是出画歌的词，
        // 因为属于这一首的词早经上面的判定提交了
        watching = false
        committed = { seed: seed, lines: EMPTY_COMMITTED_LINES, isInstrumental: true }
        committedSong = null
      }
    }

    // ---------- 封面取色（原版 extractRepresentativeColors 接线） ----------
    // 封面色只喂 gradient 色彩模式；其他模式从主题派生一切，没有理由解码封面
    function updateCoverColors() {
      var needsCoverColors = tuning.colorMode === 'gradient'
      if (!needsCoverColors || !coverUrl) {
        if (coverColors.length > 0) {
          coverColors = []
          committedSong = null
        }
        coverColorsPending = false
        return
      }
      if (coverColorsPending) return
      coverColorsPending = true
      Palette.extractRepresentativeColors(coverUrl, 5).then(function (colors) {
        coverColorsPending = false
        if (destroyed) return
        coverColors = colors
        // 取色完成即触发一次静默交接（songContext 的 coverColors 变了）
        committedSong = null
        applySong()
      }).catch(function () {
        coverColorsPending = false
        if (destroyed) return
        if (coverColors.length > 0) {
          coverColors = []
          committedSong = null
        }
      })
    }

    // ---------- 运行时创建（等价 useVisualizerPixiHost 的 create） ----------
    // registry 在 mount() 之后才同步调用 setTheme()，因此创建前必须确保主题就绪，
    // 避免用 null 主题构建场景（原版由 React props 保证 theme 恒存在）。
    // 原版 rebuildKey = [currentTime, imageBlobs, lyricsFontScale, staticMode]：
    // currentTime 是不变的 MotionValue 引用、imageBlobs 恒空 Map、staticMode 恒 false，
    // 因此重建只发生在字号缩放变化时
    function ensureRuntime() {
      if (destroyed || runtime || creating) return
      if (!window.PIXI) {
        // vendor 加载失败：标记失败以显示文字兜底
        runtimeFailed = true
        return
      }
      var song = committedSong || resolveSongContext()
      if (!song.theme) return
      creating = true
      RuntimeFactory.TemperaPixiRuntime.create({
        host: pixiHost,
        songSeed: song.seed,
        program: song.program,
        theme: song.theme,
        tuning: tuning,
        lyricsFontScale: fontScale,
        staticMode: false,
        coverColors: song.coverColors,
        // 本插件无图片导入 UI：layerImages 恒空、blob 恒空 Map
        imageBlobs: new Map(),
        paused: !isPlaying,
        songTitle: songTitle,
        songArtist: songArtist,
        songAlbum: songAlbum
      }).then(function (instance) {
        if (destroyed) {
          instance.destroy()
          return
        }
        runtime = instance
        creating = false
        runtimeFailed = false
        // Pixi 导入/初始化期间 tuning、歌与暂停态可能已经前进：全部补一次同步
        instance.setCurrentTime(currentTime)
        instance.setSongMetadata({ title: songTitle, artist: songArtist, album: songAlbum })
        instance.setTuning(tuning)
        instance.setPaused(!isPlaying)
        // 簿记必须镜像运行时真实暂停态：runtime 创建于首个 tick 之前，此时
        // paused 恒为 true；若不同步 lastPaused，diff 门永不成立，ticker 永远不会 app.start()
        lastPaused = !isPlaying
        committedSong = song
        if (!sameSong(resolveSongContext(), song)) applySong()
      }).catch(function (error) {
        creating = false
        runtimeFailed = true
        console.error('[folia-style] Tempera runtime 创建失败:', error)
      })
    }

    // 歌曲交接（等价 swap 排空循环）：等待上一次切换完成后再排队下一次
    function applySong() {
      if (destroyed) return
      var next = resolveSongContext()
      if (!next.theme) return
      if (!runtime) {
        ensureRuntime()
        return
      }
      if (sameSong(next, committedSong) || swapInFlight) return
      swapInFlight = true
      runtime.swapSong(next).then(function () {
        swapInFlight = false
        committedSong = next
        if (destroyed) return
        // 切换期间状态又变了 → 继续排队
        if (!sameSong(resolveSongContext(), committedSong)) applySong()
      }).catch(function (error) {
        swapInFlight = false
        committedSong = next
        console.error('[folia-style] Tempera 歌曲交接失败:', error)
      })
    }

    // fontScale 变化触发重建（原版 rebuildKey 包含 lyricsFontScale）
    function rebuildRuntime() {
      if (runtime) {
        var old = runtime
        runtime = null
        swapInFlight = false
        old.destroy()
      }
      ensureRuntime()
    }

    // ---------- 文字兜底（原版 runtimeFailed || paragraphs 为空的居中提示） ----------
    // 纯音乐（无词已提交）时不显示兜底文案
    function isInstrumentalNow() {
      return committed.isInstrumental && committed.lines.length === 0
    }

    function updateFallback(activeLine, paragraphsCount) {
      var show = runtimeFailed || paragraphsCount === 0
      if (!show) {
        if (fallbackEl) fallbackEl.style.opacity = '0'
        return
      }
      if (!fallbackEl) return
      var text
      if (showText && !isInstrumentalNow()) {
        text = (activeLine && activeLine.fullText) || '等待音乐...'
      } else {
        text = ''
      }
      if (fallbackEl.textContent !== text) fallbackEl.textContent = text
      fallbackEl.style.opacity = text ? '1' : '0'
    }

    // ---------- 生命周期 ----------
    function mount(hostEl) {
      host = hostEl

      layerEl = document.createElement('div')
      layerEl.className = 'folia-mode-tempera'
      layerEl.style.cssText = [
        'position:absolute', 'inset:0', 'z-index:10', 'overflow:hidden',
        'pointer-events:none'
      ].join(';')

      pixiHost = document.createElement('div')
      pixiHost.style.cssText = 'position:absolute;inset:0;z-index:10'
      pixiHost.setAttribute('aria-hidden', 'true')

      // 段落为空/创建失败时的文字兜底（原版 Tailwind：flex 居中 + clamp 字号）
      fallbackEl = document.createElement('div')
      fallbackEl.style.cssText = [
        'position:absolute', 'inset:0', 'display:flex', 'align-items:center', 'justify-content:center',
        'padding:0 40px', 'text-align:center', 'transition:opacity 0.3s'
      ].join(';')
      updateFallbackStyle()

      layerEl.appendChild(pixiHost)
      layerEl.appendChild(fallbackEl)
      host.appendChild(layerEl)
    }

    function updateFallbackStyle() {
      if (!fallbackEl) return
      var color = theme ? theme.primaryColor : '#f4f4f5'
      var family = theme ? window.FoliaSonnetCore.resolveThemeFontStack(theme) : 'sans-serif'
      var weight = theme ? window.FoliaSonnetCore.resolveThemeFontWeight(theme, 600) : 600
      var size = 'clamp(2rem, ' + (5.4 * fontScale) + 'vw, 5.6rem)'
      fallbackEl.style.color = color
      fallbackEl.style.fontFamily = family
      fallbackEl.style.fontWeight = String(weight)
      fallbackEl.style.fontSize = size
    }

    function setTheme(newTheme) {
      theme = newTheme
      updateFallbackStyle()
      // 主题就绪后触发首次运行时创建 / 静默主题提交
      applySong()
    }

    function setLines(newLines) {
      lines = newLines || []
    }

    function setFontScale(scale) {
      var next = scale === undefined ? 1 : scale
      if (next === fontScale) return
      fontScale = next
      updateFallbackStyle()
      rebuildRuntime()
    }

    function tick(frameState) {
      if (destroyed) return

      // 1. 吸收最新帧状态（MotionValue.get() 等价）
      if (frameState.theme && frameState.theme !== theme) {
        theme = frameState.theme
        updateFallbackStyle()
        committedSong = null
      }
      lines = frameState.lines || []
      currentLineIndex = frameState.currentLineIndex
      currentTime = frameState.currentTime
      isPlaying = frameState.isPlaying !== false
      showText = frameState.showText !== false
      if (frameState.songTitle !== undefined) songTitle = frameState.songTitle
      if (frameState.songArtist !== undefined) songArtist = frameState.songArtist
      if (frameState.songAlbum !== undefined) songAlbum = frameState.songAlbum
      if (frameState.coverUrl !== undefined) coverUrl = frameState.coverUrl

      // 2. 歌曲交接门（已提交歌滞后 / 纯音乐判定）
      updateSongCommit()

      // 3. 封面取色（gradient 模式）
      updateCoverColors()

      // 4. 歌曲交接（换歌切换 / 主题与取色静默提交）
      applySong()

      // 5. 播放状态注入 + 暂停行为（原版 setPaused / currentTime.on('change') renderOnce）
      if (runtime) {
        runtime.setCurrentTime(currentTime)
        // 元数据同步（原版 useEffect [songAlbum, songArtist, songTitle] → setSongMetadata）
        if (songTitle !== lastMetadata.title || songArtist !== lastMetadata.artist || songAlbum !== lastMetadata.album) {
          lastMetadata = { title: songTitle, artist: songArtist, album: songAlbum }
          runtime.setSongMetadata(lastMetadata)
        }
        if (!isPlaying !== lastPaused) {
          lastPaused = !isPlaying
          runtime.setPaused(!isPlaying)
        }
        if (!isPlaying && currentTime !== lastPausedTime) {
          lastPausedTime = currentTime
          runtime.renderOnce()
        }
      }

      // 6. 字幕覆盖层（原版 useVisualizerRuntime + VisualizerSubtitleOverlay）
      var runtimeState = VisualizerRuntime.getRuntimeState({
        lines: lines,
        currentLineIndex: currentLineIndex,
        currentTime: currentTime,
        getLineEndTime: RenderHints.getLineRenderEndTime
      })
      var finalLine = lines.length > 0 ? lines[lines.length - 1] : null
      var creditsRecentCompletedLine = runtimeState.recentCompletedLine === finalLine
        ? null
        : runtimeState.recentCompletedLine
      window.FoliaSubtitleOverlay.update({
        hostEl: host,
        showText: showText,
        activeLine: runtimeState.activeLine,
        recentCompletedLine: creditsRecentCompletedLine,
        nextLines: runtimeState.nextLines,
        theme: theme
      })

      // 7. 文字兜底
      var song = committedSong || resolveSongContext()
      var program = runtime ? (committedSong ? committedSong.program : null) : song.program
      updateFallback(runtimeState.activeLine, program ? program.paragraphs.length : 0)
    }

    function destroy() {
      destroyed = true
      if (runtime) {
        runtime.destroy()
        runtime = null
      }
      window.FoliaSubtitleOverlay.destroy()
      if (layerEl) {
        layerEl.remove()
        layerEl = null
      }
      pixiHost = null
      fallbackEl = null
      host = null
      programCache = { key: null, program: null }
      virtualLinesCache = null
      committedSong = null
      committed = { seed: undefined, lines: EMPTY_COMMITTED_LINES, isInstrumental: false }
      watching = false
    }

    return {
      id: 'tempera',
      mount: mount,
      setTheme: setTheme,
      setLines: setLines,
      setFontScale: setFontScale,
      tick: tick,
      destroy: destroy
    }
  }

  window.FoliaModeTempera = { create: createMode }
})()
