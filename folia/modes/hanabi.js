// 花火（hanabi）模式入口：移植自 folia-major hanabi/VisualizerHanabi.tsx + entry.tsx 的模式接口
// → 原生 JS 模式接口（mount/setTheme/setLines/tick/destroy/setTuning）。
// React 对应关系：
//   useState/useRef → 闭包变量；MotionValue（currentTime）→ 每帧注入普通数值（runtime.setInput + renderFrame）；
//   useVisualizerSongCommit（已提交歌曲滞后门）→ 简化为「歌词签名 + 2 秒确认纯音乐」；
//   useVisualizerPixiHost（rebuild: 抗锯齿/上下文丢失）→ 上下文丢失时销毁重建；歌、tuning、分辨率、暂停都就地推给运行时；
//   每帧时间只在 tick 里读，runtime.renderFrame(performance.now()) 驱动（上游 Pixi ticker 自转 → bridge tick 驱动）；
//   VisualizerSubtitleOverlay → 插件外壳的字幕层（模式只管画布），fallback 兜底文字对应 runtimeFailed 分支。
// 图标：插件无 lucide，拼贴图标恒用花火兜底图标（FoliaHanabiCollagePlan.HANABI_FALLBACK_ICON = 'Flower'）。
// 字号：花火按镜头文字区自动算字号（ownFontSize），lyricsFontScale 不接。
(function () {
  'use strict'

  var Core = window.FoliaHanabiCore
  var Program = window.FoliaHanabiProgram
  var RuntimeCls = window.FoliaHanabiRuntime

  /** 兜底主题（setTheme 之前 / mount 时还没有主题）：与上游默认深色底近似。 */
  var FALLBACK_THEME = {
    backgroundColor: '#09090b',
    primaryColor: '#f4f4f5',
    accentColor: '#f4f4f5',
    secondaryColor: '#71717a',
    fontStyle: 'sans',
    fontFamily: '',
    fontWeight: 700,
    animationIntensity: 'normal',
    wordColors: [],
    lyricsIcons: []
  }

  /** 轻量歌词签名：seed + 行数 + 首尾时间（内容变化基本伴随行数或时间变化）。 */
  function linesSignature(seed, lines) {
    var first = lines.length ? lines[0].startTime : -1
    var last = lines.length ? (lines[lines.length - 1].endTime || lines[lines.length - 1].startTime) : -1
    return String(seed) + '|' + lines.length + '|' + first + '|' + last
  }

  function createMode(tuning, config) {
    var TUNING = (window.FoliaTunings && window.FoliaTunings.resolveModeTuning('hanabi', config)) || Core.DEFAULT_HANABI_TUNING
    TUNING = Core.normalizeHanabiTuning(TUNING)
    // 预览实例（样式窗口舞台/缩略图）：分辨率 1、抗锯齿关、不做自动降级。
    var definitionPreview = Boolean(config && config.previewMode)

    var host = null
    var layerEl = null
    var runtimeHost = null
    var fallback = null
    var runtime = null
    var runtimeFailed = false
    var destroyed = false
    var building = false
    var buildQueued = false

    var theme = null
    var lines = []
    var currentSeed = 'hanabi'
    var songTitle = ''
    var songArtist = ''
    var songAlbum = ''
    var currentTime = 0
    var currentLineIndex = -1
    var paused = false
    var showText = true

    // 已提交歌曲（屏幕上实际呈现的歌）：滞后于 props，免得对着还没到的歌词重建场景。
    var committed = { sig: '', lines: [], isInstrumental: false, graceTimer: 0 }
    // 真正在画的程序：纯音乐 / 歌词还没到时编译成只有间奏镜头的程序（烟花照常一路升空）。
    var currentProgram = Program.compileHanabiProgram([], currentSeed)

    /** 分辨率倍数：预览恒 1；「跟随全局」按 1 倍解释（插件无全局歌词画布挡位），花火自己的像素密度由运行时另乘。 */
    function resolveRenderScale() {
      if (definitionPreview) return 1
      var override = TUNING && TUNING.render && typeof TUNING.render.scale === 'number' ? TUNING.render.scale : 1
      return override > 0 ? override : 1
    }

    function metadata() {
      return { title: songTitle || null, artist: songArtist || null, album: songAlbum || null }
    }

    function songContext() {
      return {
        seed: currentSeed,
        program: currentProgram,
        theme: theme || FALLBACK_THEME
      }
    }

    /** 歌词签名变了：立即提交并编译程序；行数为空时等 2 秒确认纯音乐（连续翻行时少重建）。 */
    function commitSong() {
      var sig = linesSignature(currentSeed, lines)
      if (sig === committed.sig) return
      committed.sig = sig
      window.clearTimeout(committed.graceTimer)
      if (lines.length === 0) {
        // 2 秒内没歌词 → 纯音乐：只画间奏镜头（烟花照常）。
        committed.graceTimer = window.setTimeout(function () {
          committed.isInstrumental = true
          committed.lines = []
          currentProgram = Program.compileHanabiProgram([], currentSeed)
          if (runtime) runtime.swapSong(songContext())
        }, 2000)
      } else {
        committed.isInstrumental = false
        committed.lines = lines
        currentProgram = Program.compileHanabiProgram(committed.lines, currentSeed)
        if (runtime) runtime.swapSong(songContext())
      }
    }

    /** 建（或重建）运行时；上下文丢失 / 销毁重建走这里。歌、tuning、分辨率、暂停都就地推给运行时。 */
    function ensureRuntime() {
      if (destroyed || building) return
      building = true
      var hostElement = runtimeHost
      try {
        if (runtime) {
          try { runtime.destroy() } catch (e) { /* 忽略 */ }
          runtime = null
        }
        runtime = new RuntimeCls.HanabiRuntime({
          host: hostElement,
          song: songContext(),
          tuning: TUNING,
          currentTime: currentTime,
          staticMode: false,
          showText: showText,
          paused: paused,
          metadata: metadata(),
          renderScale: resolveRenderScale(),
          // 抗锯齿：插件无全局挡位，固定关（上游「自动」就是关）。
          antialias: false,
          onContextLost: function () {
            // WebGL 上下文丢了：销毁重建运行时。
            scheduleRebuild()
          }
        })
        // app.init 是异步的：建不起来（没有 WebGL 等）时 holding 一直为 true，落定后标记失败显示兜底文字。
        if (runtime.readyPromise) {
          runtime.readyPromise.then(function (rt) {
            if (!destroyed && rt && rt.holding) runtimeFailed = true
          })
        }
        runtimeFailed = false
      } catch (e) {
        runtimeFailed = true
        runtime = null
        console.warn('[FoliaModeHanabi] 运行时创建失败', e)
      }
      building = false
      if (buildQueued) {
        buildQueued = false
        scheduleRebuild()
      }
    }

    function scheduleRebuild() {
      if (destroyed) return
      if (building) { buildQueued = true; return }
      ensureRuntime()
    }

    /** runtimeFailed 时的兜底文字：显示当前行（与上游一致，纯音乐 / showText 关时留空）。 */
    function updateFallback() {
      if (!fallback) return
      var text = ''
      if (runtimeFailed && showText && !committed.isInstrumental && committed.lines.length) {
        var line = committed.lines[Math.max(0, Math.min(currentLineIndex, committed.lines.length - 1))]
        text = line && line.fullText ? line.fullText : ''
      }
      if (fallback.textContent !== text) fallback.textContent = text
    }

    var instance = {
      id: 'hanabi',
      mount: function (hostEl) {
        host = hostEl
        layerEl = document.createElement('div')
        layerEl.style.cssText = 'position:absolute;inset:0;z-index:10;overflow:hidden'
        runtimeHost = document.createElement('div')
        runtimeHost.style.cssText = 'position:absolute;inset:0;z-index:10'
        layerEl.appendChild(runtimeHost)
        // 运行时失败的兜底文字（上游 runtimeFailed 分支：居中、主题主色、按歌词字号 clamp）。
        fallback = document.createElement('div')
        fallback.style.cssText = 'pointer-events:none;position:absolute;inset:0;display:flex;align-items:center;justify-content:center;padding:0 10%;text-align:center;color:#f4f4f5;font-size:clamp(2rem,5.4vw,5.6rem);font-weight:700'
        layerEl.appendChild(fallback)
        host.appendChild(layerEl)
        ensureRuntime()
      },
      setTheme: function (next) {
        theme = next
        if (runtime) runtime.setTheme(next)
      },
      setLines: function (nextLines) {
        lines = nextLines || []
        commitSong()
      },
      tick: function (frameState) {
        if (destroyed) return
        currentTime = frameState.currentTime || 0
        currentLineIndex = frameState.currentLineIndex !== undefined ? frameState.currentLineIndex : -1
        // 曲名/歌手/专辑变了：种子跟着歌走（按歌编译程序），metadata 就地推给运行时。
        var nextTitle = frameState.songTitle || ''
        var nextArtist = frameState.songArtist || ''
        var nextAlbum = frameState.songAlbum || ''
        if (nextTitle !== songTitle || nextArtist !== songArtist || nextAlbum !== songAlbum) {
          songTitle = nextTitle
          songArtist = nextArtist
          songAlbum = nextAlbum
          currentSeed = (songTitle && songArtist) ? songTitle + '|' + songArtist : (songTitle || songArtist || 'hanabi')
          if (runtime) runtime.setSongMetadata(metadata())
          commitSong()
        }
        var nextPaused = frameState.isPlaying === false
        if (nextPaused !== paused) {
          paused = nextPaused
          if (runtime) runtime.setPaused(paused)
        }
        if (frameState.showText !== undefined && frameState.showText !== showText) {
          showText = frameState.showText
          if (runtime) runtime.setShowText(showText)
        }
        if (!runtime) { updateFallback(); return }
        runtime.setInput(currentTime)
        try {
          runtime.renderFrame(performance.now())
        } catch (e) {
          // 帧异常不阻塞主循环（首帧着色器编译失败等）。
          if (!runtimeFailed) {
            runtimeFailed = true
            console.warn('[FoliaModeHanabi] 帧异常', e)
          }
        }
        updateFallback()
      },
      setTuning: function (nextTuning) {
        TUNING = Core.normalizeHanabiTuning(nextTuning)
        if (runtime) runtime.setTuning(TUNING)
      },
      destroy: function () {
        destroyed = true
        window.clearTimeout(committed.graceTimer)
        if (runtime) {
          try { runtime.destroy() } catch (e) { /* 忽略 */ }
          runtime = null
        }
        if (layerEl && layerEl.parentNode) layerEl.parentNode.removeChild(layerEl)
        layerEl = null
        runtimeHost = null
        fallback = null
        host = null
      }
    }

    return instance
  }

  window.FoliaModeHanabi = { create: createMode }
})()
