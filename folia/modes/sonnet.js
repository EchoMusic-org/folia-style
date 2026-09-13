// 商籁（sonnet）模式入口：移植自 folia-major src/components/visualizer/sonnet/
//   VisualizerSonnet.tsx（React 包装）+ songHandover.ts + pixiRuntimeHost.ts
//   → 原生 JS 模式接口（mount/setTheme/setLines/setFontScale/tick/destroy）。
// React 对应关系：
//   useState/useRef → 闭包变量；useMemo（program）→ 按签名惰性编译缓存；
//   MotionValue.get/useMotionValueEvent → tick 里读 frameState 并注入运行时；
//   useVisualizerSongCommit（已提交歌曲滞后门）→ 简化为"歌词签名 + 2 秒确认纯音乐"；
//   VisualizerSubtitleOverlay → window.FoliaSubtitleOverlay。
// 运行时模块：window.FoliaSonnetRuntime（Pixi 生命周期 + 逐帧更新）。
(function () {
  'use strict'

  var Core = window.FoliaSonnetCore
  var Program = window.FoliaSonnetProgram
  var RuntimeFactory = window.FoliaSonnetRuntime
  var RenderHints = window.FoliaRenderHints
  var VisualizerRuntime = window.FoliaVisualizerRuntime

  // 调制乘数表（原版 K3Panel mods；本插件无调制 UI，恒空 → mod() 回退 1）
  var MODULATION = undefined

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
    var tuning = Core.DEFAULT_SONNET_TUNING
    var songTitle = null
    var songArtist = null
    var songAlbum = null

    // 已提交歌曲（屏幕上实际呈现的 { seed, program, theme }）
    var committed = { seed: '', program: null, theme: null }
    var swapInFlight = false

    // 程序编译缓存（等价原版 useMemo([programLines, committedSeed])）
    var programCache = { key: null, program: null }

    // 纯音乐检测（原版 useVisualizerSongCommit 的 2 秒确认窗口）
    var lyricsSeen = false
    var virtualLinesCache = null
    var virtualKey = null

    var lastPaused = false
    var lastPausedTime = -1
    var lastMetadata = { title: null, artist: null, album: null }

    // ---------- 歌词签名（原版 getLyricsSignature 的简化版） ----------
    function lyricsSignature(list) {
      if (!list || list.length === 0) return ''
      return list.length + '|' + (list[0].fullText || '') + '|' + (list[list.length - 1].fullText || '')
    }

    // 歌曲种子：插件没有曲目 id，用"歌名|歌手"作确定性身份，回退固定值
    function resolveSeed() {
      var title = songTitle || ''
      var artist = songArtist || ''
      if (!title && !artist) return 'sonnet'
      return title + '|' + artist
    }

    // 纯音乐（instrumental）：无歌词且播放已确认超过 2 秒
    function resolveInstrumental() {
      if (lyricsSeen) return false
      return currentTime > 2
    }

    function getVirtualLines() {
      var key = 'virtual'
      if (virtualLinesCache && virtualKey === key) return virtualLinesCache
      var generated = []
      for (var i = 0; i < 60; i++) {
        generated.push({
          id: 'virtual-staff-' + i,
          startTime: i * 8,
          endTime: i * 8 + 6,
          fullText: '♪',
          words: [],
          isChorus: false
        })
      }
      virtualLinesCache = generated
      virtualKey = key
      return generated
    }

    // ---------- 程序编译（等价 useMemo） ----------
    function compileProgramLines(programLines, seed) {
      var key = seed + '::' + lyricsSignature(programLines)
      if (programCache.key === key && programCache.program) return programCache.program
      var program = Program.compileSonnetProgram(programLines, seed)
      programCache = { key: key, program: program }
      return program
    }

    // 当前"应显示"的歌曲上下文（对应原版 songContext useMemo）
    function resolveSongContext() {
      var instrumental = resolveInstrumental()
      var programLines
      if (!showText) {
        programLines = []
      } else if (lines.length > 0) {
        programLines = lines
      } else if (instrumental) {
        programLines = getVirtualLines()
      } else {
        programLines = []
      }
      var program = compileProgramLines(programLines, resolveSeed())
      return { seed: resolveSeed(), program: program, theme: theme }
    }

    function sameSong(a, b) {
      return a === b || (
        a && b && a.seed === b.seed && a.program === b.program && a.theme === b.theme
      )
    }

    // ---------- 运行时创建（等价 useVisualizerPixiHost 的 create） ----------
    // registry 在 mount() 之后才同步调用 setTheme()，因此创建前必须确保主题就绪，
    // 避免用 null 主题构建场景（原版由 React props 保证 theme 恒存在）。
    function ensureRuntime() {
      if (destroyed || runtime || creating) return
      if (!window.PIXI) {
        // vendor 加载失败：标记失败以显示文字兜底
        runtimeFailed = true
        return
      }
      var song = resolveSongContext()
      if (!song.theme) return
      creating = true
      RuntimeFactory.SonnetPixiRuntime.create({
        host: pixiHost,
        songSeed: song.seed,
        program: song.program,
        theme: song.theme,
        tuning: tuning,
        lyricsFontScale: fontScale,
        staticMode: false,
        transparentBackground: false,
        paused: !isPlaying,
        songTitle: songTitle,
        songArtist: songArtist,
        songAlbum: songAlbum,
        modulation: MODULATION
      }).then(function (instance) {
        if (destroyed) {
          instance.destroy()
          return
        }
        runtime = instance
        creating = false
        runtimeFailed = false
        // 创建期间歌/主题可能已变：补一次元数据同步，并以暂停态启动
        runtime.setSongMetadata({ title: songTitle, artist: songArtist, album: songAlbum })
        runtime.setPaused(!isPlaying)
        if (song) {
          committed = song
          if (!sameSong(resolveSongContext(), song)) applySong()
        }
      }).catch(function (error) {
        creating = false
        runtimeFailed = true
        console.error('[folia-style] Sonnet runtime 创建失败:', error)
      })
    }

    // 歌曲交接（等价 swap 排空循环）：等待上一次溶解完成后再排队下一次
    function applySong() {
      if (destroyed) return
      var next = resolveSongContext()
      if (!next.theme) return
      if (!runtime) {
        ensureRuntime()
        return
      }
      if (sameSong(next, committed) || swapInFlight) return
      swapInFlight = true
      runtime.swapSong(next).then(function () {
        swapInFlight = false
        committed = next
        if (destroyed) return
        // 溶解期间状态又变了 → 继续排队
        if (!sameSong(resolveSongContext(), committed)) applySong()
      }).catch(function (error) {
        swapInFlight = false
        committed = next
        console.error('[folia-style] Sonnet 歌曲交接失败:', error)
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
    function updateFallback(activeLine, paragraphsCount) {
      var show = runtimeFailed || paragraphsCount === 0
      if (!show) {
        if (fallbackEl) fallbackEl.style.opacity = '0'
        return
      }
      if (!fallbackEl) return
      var text = showText && !resolveInstrumental()
        ? ((activeLine && activeLine.fullText) || '等待音乐...')
        : ''
      if (fallbackEl.textContent !== text) fallbackEl.textContent = text
      fallbackEl.style.opacity = text ? '1' : '0'
    }

    // ---------- 生命周期 ----------
    function mount(hostEl) {
      host = hostEl

      layerEl = document.createElement('div')
      layerEl.className = 'folia-mode-sonnet'
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
      var family = theme ? Core.resolveThemeFontStack(theme) : 'sans-serif'
      var weight = theme ? Core.resolveThemeFontWeight(theme, 600) : 600
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
      if (newLines && newLines.length > 0) lyricsSeen = true
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
      if (frameState.theme) {
        if (theme !== frameState.theme) {
          theme = frameState.theme
          updateFallbackStyle()
        }
      }
      lines = frameState.lines || []
      if (lines.length > 0) lyricsSeen = true
      currentLineIndex = frameState.currentLineIndex
      currentTime = frameState.currentTime
      isPlaying = frameState.isPlaying !== false
      showText = frameState.showText !== false
      songTitle = frameState.songTitle !== undefined ? frameState.songTitle : songTitle
      songArtist = frameState.songArtist !== undefined ? frameState.songArtist : songArtist
      songAlbum = frameState.songAlbum !== undefined ? frameState.songAlbum : songAlbum

      // 2. 歌曲交接（换歌溶解 / 主题静默提交）
      applySong()

      // 3. 播放状态注入 + 暂停行为（原版 setPaused / currentTime.on('change') renderOnce）
      if (runtime) {
        runtime.setPlaybackState(
          currentTime,
          typeof frameState.audioPower === 'number' ? frameState.audioPower : 0,
          frameState.audioBands || null
        )
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

      // 4. 字幕覆盖层（原版 useVisualizerRuntime + VisualizerSubtitleOverlay）
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

      // 5. 文字兜底
      var program = committed.program || (runtime ? null : resolveSongContext().program)
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
      committed = { seed: '', program: null, theme: null }
    }

    return {
      id: 'sonnet',
      mount: mount,
      setTheme: setTheme,
      setLines: setLines,
      setFontScale: setFontScale,
      tick: tick,
      destroy: destroy
    }
  }

  window.FoliaModeSonnet = { create: createMode }
})()
