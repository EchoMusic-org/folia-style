// 町景（machi）模式入口：移植自 folia-major machi/VisualizerMachi.tsx + entry.tsx 的模式接口。
// → 原生 JS 模式接口（mount/setTheme/setLines/tick/destroy/setTuning）。
// React 对应关系：
//   useState/useRef → 闭包变量；MotionValue（currentTime/audioPower）→ 每帧注入普通数值；
//   useVisualizerSongCommit（已提交歌曲滞后门）→ 简化为「歌词签名 + 2 秒确认纯音乐」；
//   useVisualizerPixiHost（rebuild: 抗锯齿/透明/上下文丢失）→ 上下文丢失时销毁重建；
//   VisualizerSubtitleOverlay → window.FoliaSubtitleOverlay；取景控制条（MachiCameraBar）→ 画布直接拖拽（相机已接）。
// 智能动感（模拟节拍/效果强度）由共享 window.FoliaBeatFx 供数（任务3 接线）。
// 字号：町景按场景里屏幕和招牌的大小自动排歌词字号（ownFontSizeNotice），setFontScale 不接。
(function () {
  'use strict'

  var Types = window.FoliaMachiTypes
  var RuntimeCls = window.FoliaMachiRuntime

  // 抗锯齿档：插件固定关（画布关 AA，抗锯齿交给后处理 FXAA / 超采样）。
  var MACHI_LABEL = '町景'

  /** 轻量歌词签名：seed + 行数 + 首尾时间（内容变化基本伴随行数或时间变化）。 */
  function linesSignature(seed, lines) {
    var first = lines.length ? lines[0].startTime : -1
    var last = lines.length ? (lines[lines.length - 1].endTime || lines[lines.length - 1].startTime) : -1
    return String(seed) + '|' + lines.length + '|' + first + '|' + last
  }

  function createMode(config) {
    var TUNING = (window.FoliaTunings && window.FoliaTunings.resolveModeTuning('machi', config)) || Types.DEFAULT_MACHI_TUNING
    // 预览实例（样式窗口舞台/缩略图）：不接拖拽、锁定 1 倍分辨率、不做自动降级
    var definitionPreview = Boolean(config && config.previewMode)
    var host = null
    var layerEl = null
    var runtimeHost = null
    var runtime = null
    var runtimeFailed = false
    var destroyed = false
    var building = false
    var buildQueued = false
    // 「显示副歌词」（样式窗口「字幕」页）开关：控制城寨酒吧场景里 NEXT 全息面板的显隐。
    // 初值优先取创建方传入的 config，缺省从全局外观设置读。
    var subtitleEnabled = config && config.subtitleEnabled !== undefined
      ? config.subtitleEnabled !== false
      : (window.FoliaTunings ? window.FoliaTunings.getAppearance().subtitle.enabled !== false : true)
    // 失败自愈：宿主切窗口透明材质（DWM）等会触发 WebGL 上下文丢失 → 自动重建，
    // 若重建恰好赶上 GPU 恢复中而失败，没有重试就会永久卡在兜底文字上——补指数退避重试。
    var retryTimer = 0
    var retryDelay = 1500
    var frameOkStreak = 0

    var theme = null
    var lines = []
    var currentSeed = 'machi'
    var songTitle = ''
    var songArtist = ''
    var songAlbum = ''
    var currentTime = 0
    var audioPower = 0
    var paused = false
    var showText = true
    var appearanceOpacity = 1

    // 已提交歌曲（屏幕上实际呈现的 { seed, lines }）：滞后于 props，免得对着还没到的歌词换牌面。
    var committed = { sig: '', lines: [], isInstrumental: false, graceTimer: 0 }

    function songContext() {
      return {
        seed: committed.isInstrumental ? currentSeed : currentSeed,
        lines: committed.isInstrumental ? [] : committed.lines,
        isInstrumental: committed.isInstrumental,
        title: songTitle || '',
        artist: songArtist || '',
        album: songAlbum || ''
      }
    }

    /** 歌词签名变了：300ms 内没再变才提交（连续翻行时少重建）。纯音乐 2 秒确认。 */
    function commitSong() {
      var sig = linesSignature(currentSeed, lines)
      if (sig === committed.sig) return
      committed.sig = sig
      window.clearTimeout(committed.graceTimer)
      if (lines.length === 0) {
        // 2 秒内没歌词 → 纯音乐：只画间奏（场景照常，烟花/天气照常）。
        committed.graceTimer = window.setTimeout(function () {
          committed.isInstrumental = true
          committed.lines = []
          if (runtime) runtime.swapSong(songContext())
        }, 2000)
      } else {
        committed.isInstrumental = false
        committed.lines = lines
        if (runtime) runtime.swapSong(songContext())
      }
    }

    /** 建（或重建）运行时；上下文丢失 / 销毁重建走这里。 */
    function ensureRuntime() {
      if (destroyed || building) return
      building = true
      var hostElement = runtimeHost
      try {
        if (runtime) {
          try { runtime.destroy() } catch (e) { /* 忽略 */ }
          runtime = null
        }
        runtime = new RuntimeCls({
          host: hostElement,
          song: songContext(),
          theme: theme || { backgroundColor: '#09090b', primaryColor: '#f4f4f5', accentColor: '#f4f4f5', secondaryColor: '#71717a', fontStyle: 'sans', animationIntensity: 'normal', wordColors: [], lyricsIcons: [] },
          tuning: TUNING,
          currentTime: currentTime,
          audioPower: audioPower,
          paused: paused,
          staticMode: false,
          showText: showText,
          subtitleEnabled: subtitleEnabled,
          previewMode: Boolean(definitionPreview),
          transparent: false,
          onContextLost: function () {
            // WebGL 上下文丢了：换一个 epoch 重建。
            scheduleRebuild()
          }
        })
        runtime.loadScene(Types.resolveMachiSceneId(TUNING, songContext().seed))
        runtime.start()
        runtimeFailed = false
      } catch (e) {
        runtimeFailed = true
        runtime = null
        scheduleRetry()
        console.warn('[FoliaModeMachi] 运行时创建失败', e)
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

    /** 运行时建失败/持续帧异常后的自愈重试：延迟重建，失败指数退避，成功后复位。 */
    function scheduleRetry() {
      if (destroyed || retryTimer) return
      retryTimer = window.setTimeout(function () {
        retryTimer = 0
        if (destroyed) return
        retryDelay = Math.min(8000, retryDelay * 2)
        scheduleRebuild()
      }, retryDelay)
    }

    var instance = {
      id: 'machi',
      mount: function (hostEl) {
        host = hostEl
        layerEl = document.createElement('div')
        layerEl.style.cssText = 'position:absolute;inset:0;z-index:10;overflow:hidden'
        runtimeHost = document.createElement('div')
        runtimeHost.style.cssText = 'position:absolute;inset:0;z-index:10'
        layerEl.appendChild(runtimeHost)
        // 运行时失败的兜底文字。
        var fallback = document.createElement('div')
        fallback.className = 'folia-machi-fallback'
        fallback.style.cssText = 'pointer-events:none;position:absolute;inset:0;display:flex;align-items:center;justify-content:center;padding:0 10%;text-align:center;color:#f4f4f5;font-size:clamp(2rem,5.4vw,5.6rem);font-weight:700'
        layerEl.appendChild(fallback)
        this._fallback = fallback
        host.appendChild(layerEl)
        ensureRuntime()
        applyOpacity()
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
        if (destroyed || !runtime) return
        currentTime = frameState.currentTime || 0
        audioPower = frameState.audioPower || 0
        currentLineIndex = frameState.currentLineIndex !== undefined ? frameState.currentLineIndex : -1
        // 曲名/歌手变了：更新种子（按歌选场景/天气、招牌曲名都依赖它）并提交换歌
        var nextTitle = frameState.songTitle || ''
        var nextArtist = frameState.songArtist || ''
        var nextAlbum = frameState.songAlbum || ''
        if (nextTitle !== songTitle || nextArtist !== songArtist || nextAlbum !== songAlbum) {
          songTitle = nextTitle
          songArtist = nextArtist
          songAlbum = nextAlbum
          currentSeed = (songTitle && songArtist) ? songTitle + '|' + songArtist : (songTitle || songArtist || 'machi')
          commitSong()
        }
        var nextPaused = frameState.isPlaying === false
        if (nextPaused !== paused) {
          paused = nextPaused
          runtime.setPaused(paused)
        }
        if (frameState.showText !== undefined && frameState.showText !== showText) {
          showText = frameState.showText
          runtime.setShowText(showText)
        }
        runtime.setInput(currentTime, audioPower)
        var frameOk = true
        try {
          runtime.renderFrame(performance.now())
        } catch (e) {
          frameOk = false
          // 帧异常不阻塞主循环（首帧着色器编译失败等）。持续异常多为上下文未恢复：排一次自愈重建。
          if (!runtimeFailed) {
            runtimeFailed = true
            console.warn('[FoliaModeMachi] 帧异常', e)
          }
          scheduleRetry()
        }
        // 连续 30 帧正常出画后撤下兜底文字（帧异常自愈 / 重建成功）
        if (frameOk) {
          frameOkStreak += 1
          if (runtimeFailed && frameOkStreak >= 30) runtimeFailed = false
        } else {
          frameOkStreak = 0
        }
        if (this._fallback) {
          var text = ''
          if (runtimeFailed) text = frameState.showText && committed.lines.length ? (committed.lines[Math.max(0, currentLineIndex)].fullText || '') : ''
          if (this._fallback.textContent !== text) this._fallback.textContent = text
          void currentLineIndex
        }
      },
      setTuning: function (tuning) {
        TUNING = Types.normalizeMachiTuning(tuning)
        if (runtime) runtime.setTuning(TUNING)
      },
      setSubtitleEnabled: function (enabled) {
        // 「显示副歌词」开关（样式窗口「字幕」页）：城寨酒吧 NEXT 全息面板的显隐
        subtitleEnabled = enabled !== false
        if (runtime) runtime.setSubtitleEnabled(subtitleEnabled)
      },
      destroy: function () {
        destroyed = true
        window.clearTimeout(retryTimer)
        retryTimer = 0
        window.clearTimeout(committed.graceTimer)
        if (runtime) {
          try { runtime.destroy() } catch (e) { /* 忽略 */ }
          runtime = null
        }
        if (layerEl && layerEl.parentNode) layerEl.parentNode.removeChild(layerEl)
        layerEl = null
        runtimeHost = null
      }
    }

    var currentLineIndex = -1
    void MACHI_LABEL

    function applyOpacity() {
      if (layerEl) layerEl.style.opacity = String(appearanceOpacity)
    }
    void applyOpacity

    return instance
  }

  window.FoliaModeMachi = { create: createMode }
})()
