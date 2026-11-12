// 示例舞台（复刻上游 VisPlaygroundSampleStage + usePreviewClock）：
// 左侧预览卡片内运行所选样式。双预览源：
//   builtin —— 内置示例歌词 + 模拟预览时钟（自持 rAF，音频包络正弦模拟）
//   live    —— 复用 bridge 主循环每帧 frameState（真实歌词/频谱），经 FoliaBridge.onFrame 订阅
// 舞台实例经 FoliaRegistry.previewCreate 创建，与主页面模式完全隔离（双实例并存）。
(function () {
  'use strict'

  // ===== 内置示例歌词（毫秒结构，经 FoliaLyricsData.adaptLines 适配为模式输入） =====
  // 对齐上游两组预览文本（default「神文之诗」/ reserved「野芝麻」），内容为示例文本
  var SAMPLE_SETS = {
    default: {
      title: '神文之诗',
      artist: '预览示例',
      lines: [
        { time_ms: 500, duration_ms: 3800, text: '夜色漫过窗台', secondary: '示例歌词 · 流光逐字' },
        { time_ms: 4500, duration_ms: 4200, text: '星光在指尖徘徊', secondary: '' },
        { time_ms: 9000, duration_ms: 4600, text: '我们把心事折成纸船', secondary: 'Preview sample lyrics' },
        { time_ms: 13900, duration_ms: 3800, text: '放进时间的河流', secondary: '' },
        { time_ms: 18000, duration_ms: 4800, text: '风吹散了昨天的名字', secondary: '' },
        { time_ms: 23100, duration_ms: 4600, text: '光落在未写完的诗行', secondary: '' },
        { time_ms: 28000, duration_ms: 4400, text: '就让这一刻慢下来', secondary: '让心跳成为唯一的节拍' },
        { time_ms: 32700, duration_ms: 4200, text: '让心跳成为唯一的节拍', secondary: '' },
        { time_ms: 37200, duration_ms: 4600, text: '直到黎明把梦点亮', secondary: '' }
      ]
    },
    reserved: {
      title: '野芝麻',
      artist: '预览示例',
      lines: [
        { time_ms: 500, duration_ms: 4000, text: '巷口的猫打了个哈欠', secondary: '示例歌词 · 备用样本' },
        { time_ms: 4800, duration_ms: 3800, text: '午后的风绕过晾衣绳', secondary: '' },
        { time_ms: 8900, duration_ms: 4600, text: '旧收音机唱着走调的歌', secondary: 'Preview sample lyrics' },
        { time_ms: 13800, duration_ms: 4000, text: '野芝麻开在墙缝里', secondary: '' },
        { time_ms: 18100, duration_ms: 4800, text: '谁把夏天叠进了抽屉', secondary: '' },
        { time_ms: 23200, duration_ms: 4400, text: '蝉声漫过整条街道', secondary: '' },
        { time_ms: 27900, duration_ms: 4400, text: '黄昏把影子拉得很长', secondary: '拉过屋檐 拉过童年' },
        { time_ms: 32600, duration_ms: 4400, text: '拉过屋檐 拉过童年', secondary: '' },
        { time_ms: 37300, duration_ms: 4800, text: '月亮升起来的时候', secondary: '' }
      ]
    }
  }
  // 循环时长 = 末行结束 + 2s 间奏
  function sampleLoopDuration(set) {
    var last = set.lines[set.lines.length - 1]
    return (last.time_ms + last.duration_ms + 2000) / 1000
  }

  // 模拟音频包络：基线 + 慢波 + 节拍脉冲，bass/mid/treble 分频相位错开
  function fakeAudio(t) {
    var beat = Math.max(0, Math.sin(t * Math.PI * 2 * (120 / 60 / 2)))
    var power = 0.22 + 0.3 * Math.abs(Math.sin(t * 0.9)) + 0.35 * beat * beat
    return {
      power: Math.min(1, power),
      bands: {
        bass: Math.min(1, 0.25 + 0.55 * beat * beat),
        lowMid: Math.min(1, 0.2 + 0.4 * Math.abs(Math.sin(t * 1.7)) + 0.25 * beat),
        mid: Math.min(1, 0.2 + 0.4 * Math.abs(Math.sin(t * 1.1 + 1))),
        vocal: Math.min(1, 0.18 + 0.35 * Math.abs(Math.sin(t * 0.7 + 2))),
        treble: Math.min(1, 0.15 + 0.3 * Math.abs(Math.sin(t * 2.6 + 0.5)) + 0.15 * beat)
      }
    }
  }

  function create(options) {
    var host = options.host                 // 舞台容器（挂载模式实例）
    var getState = options.getState         // () => { theme, appearance, ... }（由 style-window 提供）
    var destroyed = false

    var instance = null         // 当前预览实例（registry.previewCreate 返回）
    var instanceToken = 0       // 并发切换防护
    var currentModeId = null
    var currentTuning = null

    var source = 'builtin'      // builtin | live
    var sampleId = 'default'
    var paused = false
    var clock = 0               // 示例时钟（秒，循环）
    var lastFrameNow = 0
    var rafId = 0
    var unbindFrame = null      // live 源的 bridge 帧订阅注销
    var frameHook = null        // 每帧回调（舞台背景实例等，style-window 注入）

    var stageHost = document.createElement('div')
    stageHost.className = 'fsw-stage-host'
    host.appendChild(stageHost)

    var emptyEl = document.createElement('div')
    emptyEl.className = 'fsw-live-empty'
    emptyEl.style.display = 'none'
    emptyEl.textContent = '当前没有正在播放的歌词'
    host.appendChild(emptyEl)

    function sampleSet() { return SAMPLE_SETS[sampleId] || SAMPLE_SETS.default }

    var adaptedCache = { id: null, lines: null }
    function adaptedSampleLines() {
      if (adaptedCache.id === sampleId && adaptedCache.lines) return adaptedCache.lines
      var set = sampleSet()
      var raw = set.lines.map(function (line) {
        return {
          time_ms: line.time_ms,
          duration_ms: line.duration_ms,
          text: line.text,
          secondary: line.secondary,
          characters: []
        }
      })
      var adapted = window.FoliaLyricsData && window.FoliaLyricsData.adaptLines
        ? window.FoliaLyricsData.adaptLines(raw)
        : raw
      adaptedCache.id = sampleId
      adaptedCache.lines = adapted
      return adapted
    }

    // ===== builtin 源：自持 rAF 循环 =====
    function builtinLoop(now) {
      if (destroyed || source !== 'builtin' || !instance) return
      var dt = lastFrameNow ? Math.min((now - lastFrameNow) / 1000, 0.05) : 1 / 60
      lastFrameNow = now
      var set = sampleSet()
      var loop = sampleLoopDuration(set)
      if (!paused) clock = (clock + dt) % loop
      var fake = fakeAudio(clock)
      var lines = adaptedSampleLines()
      var state = getState()
      var frameState = {
        currentTime: clock,
        dt: dt,
        currentLineIndex: window.FoliaLyricsData
          ? window.FoliaLyricsData.findLatestActiveLineIndex(lines, clock)
          : -1,
        lines: lines,
        theme: state.theme,
        audioPower: fake.power,
        audioBands: fake.bands,
        isPlaying: !paused,
        showText: true,
        songTitle: set.title,
        songArtist: set.artist,
        songAlbum: '',
        coverUrl: null
      }
      try { instance.tick(frameState) } catch (e) { /* 预览帧异常不阻塞 */ }
      if (frameHook) {
        try { frameHook(frameState) } catch (e) { /* 钩子异常不阻塞 */ }
      }
      rafId = requestAnimationFrame(builtinLoop)
    }
    function startBuiltinLoop() {
      lastFrameNow = 0
      if (rafId) cancelAnimationFrame(rafId)
      rafId = requestAnimationFrame(builtinLoop)
    }
    function stopBuiltinLoop() {
      if (rafId) { cancelAnimationFrame(rafId); rafId = 0 }
    }

    // ===== live 源：订阅 bridge 主循环帧 =====
    function startLiveFeed() {
      stopBuiltinLoop()
      if (unbindFrame) { unbindFrame(); unbindFrame = null }
      if (window.FoliaBridge && window.FoliaBridge.onFrame) {
        unbindFrame = window.FoliaBridge.onFrame(function (frameState) {
          if (destroyed || source !== 'live' || !instance) return
          emptyEl.style.display = frameState.lines && frameState.lines.length ? 'none' : 'flex'
          try { instance.tick(frameState) } catch (e) { /* 预览帧异常不阻塞 */ }
          if (frameHook) {
            try { frameHook(frameState) } catch (e) { /* 钩子异常不阻塞 */ }
          }
        })
      }
    }
    function stopLiveFeed() {
      if (unbindFrame) { unbindFrame(); unbindFrame = null }
      emptyEl.style.display = 'none'
    }

    // ===== 实例管理 =====
    function destroyInstance() {
      if (instance && instance.destroy) {
        try { instance.destroy() } catch (e) { /* 预览销毁失败不阻塞 */ }
      }
      instance = null
      stageHost.innerHTML = ''
    }

    function mountInstance(modeId, tuning) {
      var token = ++instanceToken
      destroyInstance()
      currentModeId = modeId
      currentTuning = tuning
      if (!window.FoliaRegistry || !window.FoliaRegistry.previewCreate) return Promise.resolve()
      var state = getState()
      return window.FoliaRegistry.previewCreate(modeId, stageHost, {
        theme: state.theme,
        lines: source === 'live' ? (state.adaptedLines || []) : adaptedSampleLines(),
        fontScale: state.appearance ? state.appearance.fontScale : 1,
        tuning: tuning
      }).then(function (preview) {
        if (destroyed || token !== instanceToken) {
          preview.destroy()
          return
        }
        instance = preview.instance
        // builtin 源挂载后立即以样本行启动；live 源等下一帧 bridge 帧驱动
        if (source === 'builtin') startBuiltinLoop()
      }).catch(function (e) {
        console.warn('[FoliaStyleWindow] 预览实例创建失败', e)
      })
    }

    return {
      // 切换样式（重建预览实例，携带 tuning）
      setMode: function (modeId, tuning) {
        return mountInstance(modeId, tuning)
      },
      // 样式参数更新：模式支持 setTuning 则热更（draft 实时反馈），否则由调用方决定重建
      supportsLiveTuning: function () {
        return Boolean(instance && typeof instance.setTuning === 'function')
      },
      applyTuningDraft: function (modeId, tuning) {
        if (modeId !== currentModeId || !instance) return false
        if (typeof instance.setTuning !== 'function') return false
        try { instance.setTuning(tuning); return true } catch (e) { return false }
      },
      // 主题更新（切歌取色/强度变化）
      setTheme: function (theme) {
        if (instance && instance.setTheme && theme) {
          try { instance.setTheme(theme) } catch (e) { /* 忽略 */ }
        }
      },
      // 字号缩放热更（字体 tab 滑条 draft）
      applyFontScale: function (scale) {
        if (instance && typeof instance.setFontScale === 'function') {
          try { instance.setFontScale(scale) } catch (e) { /* 忽略 */ }
        }
      },
      // 「显示副歌词」开关（町景 NEXT 全息面板显隐）：透传给当前预览实例
      setSubtitleEnabled: function (enabled) {
        if (instance && typeof instance.setSubtitleEnabled === 'function') {
          try { instance.setSubtitleEnabled(enabled !== false) } catch (e) { /* 忽略 */ }
        }
      },
      // 预览源切换
      setSource: function (next) {
        if (next === source) return
        source = next
        if (source === 'live') {
          stopBuiltinLoop()
          startLiveFeed()
        } else {
          stopLiveFeed()
          clock = 0
          startBuiltinLoop()
        }
      },
      getSource: function () { return source },
      // 示例文本切换（builtin 源下重启循环从头播放）
      setSampleText: function (id) {
        if (!SAMPLE_SETS[id]) return
        sampleId = id
        if (source === 'builtin') {
          clock = 0
          startBuiltinLoop()
        }
      },
      setPaused: function (next) {
        paused = Boolean(next)
        if (!paused && source === 'builtin') startBuiltinLoop()
      },
      // 帧钩子（每帧调用，传入与模式相同的 frameState）：舞台背景实例驱动用
      setFrameHook: function (fn) { frameHook = typeof fn === 'function' ? fn : null },
      destroy: function () {
        destroyed = true
        stopBuiltinLoop()
        stopLiveFeed()
        destroyInstance()
        stageHost.remove()
        emptyEl.remove()
      }
    }
  }

  window.FoliaSampleStage = { create: create, SAMPLE_SETS: SAMPLE_SETS }
})()
