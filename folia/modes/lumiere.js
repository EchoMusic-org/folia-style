// 绘光（lumiere）模式入口：移植自 folia-major src/components/visualizer/lumiere/
//   VisualizerLumiere.tsx（React 包装）+ songHandover.ts + pixiRuntimeHost.ts
//   → 原生 JS 模式接口（mount/setTheme/setLines/setFontScale/tick/destroy）。
// React 对应关系：
//   useState/useRef → 闭包变量；useMemo（program）→ 按签名惰性编译缓存；
//   MotionValue（currentTime/audioPower/audioBands）→ { get() } 鸭子对象，闭包变量现读；
//   useVisualizerSongCommit（已提交歌曲滞后门）→ 简化为"歌词签名 + 2 秒确认纯音乐"；
//   VisualizerSubtitleOverlay → window.FoliaSubtitleOverlay；
//   LumiereSettingsPanel → 不移植（本插件无 per-mode 设置面板），固定 DEFAULT_LUMIERE_TUNING。
// 运行时模块：window.FoliaLumiereScene.LumierePixiRuntime（Pixi 生命周期 + 逐帧更新）。
(function () {
  'use strict'

  var Core = window.FoliaLumiereCore
  var Program = window.FoliaLumiereProgram
  var Scene = window.FoliaLumiereScene
  var RenderHints = window.FoliaRenderHints
  var VisualizerRuntime = window.FoliaVisualizerRuntime

  // 本插件无模式设置面板，tuning 固定默认值（原版默认开启无缝过渡与全部装饰层）
  var TUNING = Core.DEFAULT_LUMIERE_TUNING

  function createMode() {
    var host = null            // 宿主元素（registry 传入）
    var layerEl = null         // 模式根层（inset 0 / z-10 / overflow hidden）
    var pixiHost = null        // Pixi canvas 宿主
    var fallbackEl = null      // 运行时失败时的文字兜底
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
    var songTitle = null
    var songArtist = null
    var songAlbum = null
    var audioPower = 0
    var audioBands = { bass: 0, lowMid: 0, mid: 0, vocal: 0, treble: 0 }

    // 已提交歌曲（屏幕上实际呈现的 { seed, program, theme }）
    var committed = { seed: '', program: null, theme: null }
    var swapInFlight = false

    // 程序编译缓存（等价原版 useMemo([committedLines, committedSeed, seamlessTransitions])）
    var programCache = { key: null, program: null }

    // 纯音乐检测（原版 useVisualizerSongCommit 的 3 秒就绪窗口，简化为 2 秒确认）
    var lyricsSeen = false

    var lastPaused = false
    var lastPausedTime = -1
    var lastMetadata = { title: null, artist: null, album: null }
    var lastShowText = true

    // MotionValue 鸭子源（{ get(): value }）：运行时 ticker 每帧现读，无需逐帧推送
    var currentTimeSource = { get: function () { return currentTime } }
    var audioPowerSource = { get: function () { return audioPower } }
    var audioBandsSource = {
      bass: { get: function () { return audioBands.bass } },
      lowMid: { get: function () { return audioBands.lowMid } },
      mid: { get: function () { return audioBands.mid } },
      vocal: { get: function () { return audioBands.vocal } },
      treble: { get: function () { return audioBands.treble } }
    }

    // ---------- 歌词签名（切歌检测的简化版） ----------
    function lyricsSignature(list) {
      if (!list || list.length === 0) return ''
      return list.length + '|' + (list[0].fullText || '') + '|' + (list[list.length - 1].fullText || '')
    }

    // 歌曲种子：插件没有曲目 id，用"歌名|歌手"作确定性身份，回退固定值
    function resolveSeed() {
      var title = songTitle || ''
      var artist = songArtist || ''
      if (!title && !artist) return 'lumiere'
      return title + '|' + artist
    }

    // 纯音乐（instrumental）：无歌词且播放已确认超过 2 秒
    function resolveInstrumental() {
      if (lyricsSeen) return false
      return currentTime > 2
    }

    // ---------- 程序编译（等价 useMemo）----------
    // 源码语义：纯音乐 / 歌词还没到 → 编译成只有间奏镜头的程序（lines 传空），
    // showText 关掉时仍按真实歌词编译，镜头节奏跟着歌走，只是不画字（setShowText）。
    function compileProgram() {
      var programLines = resolveInstrumental() ? [] : lines
      var key = resolveSeed() + '::' + lyricsSignature(programLines)
      if (programCache.key === key && programCache.program) return programCache.program
      var program = Program.compileLumiereProgram(
        programLines,
        resolveSeed(),
        {},
        Program.resolveLumiereCompileOptions({ seamlessTransitions: TUNING.seamlessTransitions })
      )
      programCache = { key: key, program: program }
      return program
    }

    // 当前"应显示"的歌曲上下文（对应原版 songContext useMemo）
    function resolveSongContext() {
      return { seed: resolveSeed(), program: compileProgram(), theme: theme }
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
      Scene.LumierePixiRuntime.create({
        host: pixiHost,
        song: song,
        tuning: TUNING,
        currentTime: currentTimeSource,
        audioPower: audioPowerSource,
        audioBands: audioBandsSource,
        staticMode: false,
        showText: showText,
        paused: !isPlaying,
        metadata: { title: songTitle, artist: songArtist, album: songAlbum }
      }).then(function (instance) {
        if (destroyed) {
          instance.destroy()
          return
        }
        runtime = instance
        creating = false
        runtimeFailed = false
        // 创建期间歌/主题可能已变：补一次状态同步。
        // 必须同步差量记账（lastPaused/lastShowText/lastMetadata）：创建回调可能早于首次 tick 执行，
        // 此时 isPlaying 仍是初始 false，runtime 会被置为暂停态；若不记账，tick 的差量判断认为
        // "上次已同步为播放中"，永远不会调 setPaused(false) → 渲染一帧后卡住。
        lastMetadata = { title: songTitle, artist: songArtist, album: songAlbum }
        runtime.setSongMetadata(lastMetadata)
        lastShowText = showText
        runtime.setShowText(showText)
        lastPaused = !isPlaying
        runtime.setPaused(!isPlaying)
        committed = song
        if (!sameSong(resolveSongContext(), song)) applySong()
      }).catch(function (error) {
        creating = false
        runtimeFailed = true
        console.error('[folia-style] Lumiere runtime 创建失败:', error)
      })
    }

    // 歌曲交接（等价 swap 排空循环）：等待上一次交接完成后再排队下一次
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
        // 交接期间状态又变了 → 继续排队
        if (!sameSong(resolveSongContext(), committed)) applySong()
      }).catch(function (error) {
        swapInFlight = false
        committed = next
        console.error('[folia-style] Lumiere 歌曲交接失败:', error)
      })
    }

    // ---------- 文字兜底（原版 runtimeFailed 时的居中提示） ----------
    function updateFallbackStyle() {
      if (!fallbackEl) return
      var color = theme ? theme.primaryColor : '#f4f4f5'
      var family = theme
        ? (theme.fontFamily || window.foliaGetLyricFontFamily() || 'sans-serif')
        : 'sans-serif'
      var weight = theme && typeof theme.fontWeight === 'number' ? theme.fontWeight : 500
      fallbackEl.style.color = color
      fallbackEl.style.fontFamily = family
      fallbackEl.style.fontWeight = String(weight)
      fallbackEl.style.fontSize = 'clamp(2rem, ' + (5.4 * fontScale) + 'vw, 5.6rem)'
    }

    function updateFallback(activeLine) {
      var show = runtimeFailed
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
      layerEl.className = 'folia-mode-lumiere'
      layerEl.style.cssText = [
        'position:absolute', 'inset:0', 'z-index:10', 'overflow:hidden',
        'pointer-events:none'
      ].join(';')

      pixiHost = document.createElement('div')
      pixiHost.style.cssText = 'position:absolute;inset:0;z-index:10'
      pixiHost.setAttribute('aria-hidden', 'true')

      // 运行时失败时的文字兜底（原版 Tailwind：flex 居中 + clamp 字号）
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

    // 原版 rebuildKey 不含字体缩放：绘光的字号由文字窗口按画面高度占比计算，
    // lyricsFontScale 只影响共享副字幕（FoliaSubtitleOverlay 内部处理），运行时无需重建。
    function setFontScale(scale) {
      var next = scale === undefined ? 1 : scale
      if (next === fontScale) return
      fontScale = next
      updateFallbackStyle()
    }

    function tick(frameState) {
      if (destroyed) return

      // 1. 吸收最新帧状态（MotionValue.get() 等价）
      if (frameState.theme && theme !== frameState.theme) {
        theme = frameState.theme
        updateFallbackStyle()
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
      if (typeof frameState.audioPower === 'number') audioPower = frameState.audioPower
      if (frameState.audioBands) audioBands = frameState.audioBands

      // 2. 歌曲交接（换歌场景交接 / 主题静默提交）
      applySong()

      // 3. 播放状态注入（Pixi ticker 自驱动：setPaused 管 start/stop）
      if (runtime) {
        if (showText !== lastShowText) {
          lastShowText = showText
          runtime.setShowText(showText)
        }
        if (songTitle !== lastMetadata.title || songArtist !== lastMetadata.artist || songAlbum !== lastMetadata.album) {
          lastMetadata = { title: songTitle, artist: songArtist, album: songAlbum }
          runtime.setSongMetadata(lastMetadata)
        }
        if (!isPlaying !== lastPaused) {
          lastPaused = !isPlaying
          runtime.setPaused(!isPlaying)
        }
        // 暂停时 ticker 停着，拖动进度要手动补一帧
        if (!isPlaying && currentTime !== lastPausedTime) {
          lastPausedTime = currentTime
          runtime.renderOnce()
        }
      }

      // 4. 字幕覆盖层（原版 useVisualizerRuntime + VisualizerSubtitleOverlay；
      //    片尾卡出来以后不再在字幕里重复最后一句）
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
      updateFallback(runtimeState.activeLine)
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
      committed = { seed: '', program: null, theme: null }
    }

    return {
      id: 'lumiere',
      mount: mount,
      setTheme: setTheme,
      setLines: setLines,
      setFontScale: setFontScale,
      tick: tick,
      destroy: destroy
    }
  }

  window.FoliaModeLumiere = { create: createMode }
})()
