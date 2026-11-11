// 样式架图标的活实例冻结快照（复刻上游 visualizer/preview/ 的 frozenPicture + LivePicture + pictureTurns）：
// 每张样式卡片的缩略图不是资产图片，而是"活实例迷你渲染 → DOM 冻结克隆"——把真实模式实例挂在与播放页
// 等大的离屏舞台上（CSS transform 缩进卡片框），画出一帧后整棵克隆（canvas 用 drawImage 拷成位图、
// CSS 动画把当前值写死成内联样式），随即销毁实例；卡片平时显示冻结图，无脚本、无循环、无 WebGL 上下文。
// 关键约束（上游实测数据）：全页串行做图（一次一张）、单运行位、LRU 缓存、卸载时对 WebGL canvas
// 调 WEBGL_lose_context.loseContext()（否则撞 16 个上下文上限会把播放页的挤掉）。
// 帧数据：只用内置示例文本的 poster 帧（固定第 2 行唱到 60% 处的一句，永不使用真实歌词）+ 模拟音频包络；
// 先从 poster 前 1.5s 快进预热（行进场动画播完），再最短渲染 2s 让场景充分加载，之后才判定静止并冻结。
(function () {
  'use strict'

  // ===== 时序常量（上游 pictureRule.ts + 本地化调整） =====
  var FIRST_IMAGE_REST_MS = 450      // 窗口展开动画后再开始
  var NEW_IMAGE_REST_MS = 1200       // 设置变动后的静默期
  var SCENE_READY_MS = 2000          // 场景充分加载：最短渲染 2 秒后才判定冻结（等场景资源/着色器/进场动画）
  var SETTLE_MAX_MS = 1000           // 静止判定兜底（在 SCENE_READY_MS 之后起算）
  var QUIET_MS = 160                 // 判定"静止"的安静窗口
  var EMPTY_CANVAS_MS = 1000         // 偶尔绘制的 canvas 多等一会
  var GIVE_UP_MS = 4000
  var WARMUP_SECONDS = 1.5           // 冻结前快进预热：行进场/过渡动画在这段播完再停稳
  var IMAGE_TRIES = 2
  var IMAGE_CANVAS_WIDTH = 384       // 冻结 canvas 的宽度上限
  var KEPT = 32                      // LRU 缓存上限
  var STAGE_WIDTH = 960              // 离屏舞台尺寸（16:10，与缩略图卡片同比例）
  var STAGE_HEIGHT = 600

  // ===== poster 帧数据（对齐 sample-stage 的示例歌词与模拟包络） =====
  // 快照只用内置示例文本、固定第 2 行唱到 60% 处的一句——永不使用真实歌词，
  // 保证同一样式每次生成的快照画面一致（避免真实歌词的动态内容造成快照不稳定）。
  function posterFrame(sampleSet, theme) {
    var set = window.FoliaSampleStage && window.FoliaSampleStage.SAMPLE_SETS
      ? window.FoliaSampleStage.SAMPLE_SETS[sampleSet || 'default']
      : null
    if (!set) return null
    // poster 时间：第 2 行开始 + 行长 × 0.6（固定一句，行索引不再变化）
    var line = set.lines[1]
    var poster = (line.time_ms + line.duration_ms * 0.6) / 1000
    var raw = set.lines.map(function (l) {
      return { time_ms: l.time_ms, duration_ms: l.duration_ms, text: l.text, secondary: l.secondary, characters: [] }
    })
    var lines = window.FoliaLyricsData && window.FoliaLyricsData.adaptLines ? window.FoliaLyricsData.adaptLines(raw) : raw
    var t = poster
    var beat = Math.max(0, Math.sin(t * Math.PI * 2 * (120 / 60 / 2)))
    var power = Math.min(1, 0.22 + 0.3 * Math.abs(Math.sin(t * 0.9)) + 0.35 * beat * beat)
    var bands = {
      bass: Math.min(1, 0.25 + 0.55 * beat * beat),
      lowMid: Math.min(1, 0.2 + 0.4 * Math.abs(Math.sin(t * 1.7)) + 0.25 * beat),
      mid: Math.min(1, 0.2 + 0.4 * Math.abs(Math.sin(t * 1.1 + 1))),
      vocal: Math.min(1, 0.18 + 0.35 * Math.abs(Math.sin(t * 0.7 + 2))),
      treble: Math.min(1, 0.15 + 0.3 * Math.abs(Math.sin(t * 2.6 + 0.5)) + 0.15 * beat)
    }
    var index = -1
    for (var i = 0; i < lines.length; i += 1) {
      if (lines[i].startTime <= poster + 0.05) index = i
      else break
    }
    return {
      currentTime: poster,
      dt: 1 / 60,
      currentLineIndex: index,
      lines: lines,
      theme: theme,
      audioPower: power,
      audioBands: bands,
      isPlaying: true,
      showText: true,
      songTitle: set.title,
      songArtist: set.artist,
      songAlbum: '',
      coverUrl: null
    }
  }

  // ===== 离屏舞台 =====
  var stageHost = null
  function ensureStageHost() {
    if (stageHost && stageHost.isConnected) return stageHost
    stageHost = document.createElement('div')
    stageHost.id = 'folia-frozen-stage-host'
    // 离屏：不挡交互、不显示，但仍在布局树里（rAF/WebGL 照常渲染）。
    stageHost.style.cssText = 'position:fixed;left:-100000px;top:0;width:' + STAGE_WIDTH + 'px;height:' + STAGE_HEIGHT + 'px;' +
      'opacity:0;pointer-events:none;overflow:hidden;z-index:-1;contain:strict'
    document.body.appendChild(stageHost)
    return stageHost
  }

  function disposeStageHost() {
    if (stageHost && stageHost.parentNode) stageHost.parentNode.removeChild(stageHost)
    stageHost = null
  }

  // ===== 画了东西 / 静止判定（frozenPicture.ts 的 watchStage） =====
  function canvasIsBlank(canvas) {
    try {
      var probe = document.createElement('canvas')
      probe.width = 64
      probe.height = 40
      var ctx = probe.getContext('2d')
      ctx.drawImage(canvas, 0, 0, 64, 40)
      var data = ctx.getImageData(0, 0, 64, 40).data
      for (var i = 3; i < data.length; i += 4) {
        if (data[i] !== 0) return false
      }
      // 全透明也检查 RGB（预乘透明画布可能 alpha 全 0 但这是没画）
      return true
    } catch (e) {
      // 跨域污染的 canvas 视为非空
      return false
    }
  }

  function stageHasContent(stage) {
    var canvases = stage.querySelectorAll('canvas')
    for (var i = 0; i < canvases.length; i += 1) {
      if (!canvasIsBlank(canvases[i])) return true
    }
    if ((stage.textContent || '').trim()) return true
    if (stage.querySelector('img')) return true
    // 前 60 个元素的背景图
    var all = stage.querySelectorAll('*')
    var limit = Math.min(all.length, 60)
    for (var j = 0; j < limit; j += 1) {
      var style = getComputedStyle(all[j])
      if (style.backgroundImage && style.backgroundImage !== 'none') return true
    }
    return false
  }

  function hasRunningFiniteAnimations(stage) {
    var animations = stage.getAnimations ? stage.getAnimations({ subtree: true }) : []
    for (var i = 0; i < animations.length; i += 1) {
      var animation = animations[i]
      if (animation.playState === 'running' && animation.effect && isFinite(animation.effect.getComputedTiming().endTime)) {
        return true
      }
    }
    return false
  }

  /**
   * 观察舞台直到"画了东西且静止"。done(status)：'shown'（画好且静止）| 'empty'（超时没画）。
   * rAF 从 setTimeout 里请求，保证跑在样式自己的 rAF 回调之后。
   */
  function watchStage(stage, done) {
    var startAt = performance.now()
    var quietSince = -1
    var settled = false
    function tick() {
      if (!stage.isConnected) {
        done('empty')
        return
      }
      var now = performance.now()
      var elapsed = now - startAt
      var has = stageHasContent(stage)
      // 场景充分加载：至少渲染 SCENE_READY_MS 后才进入静止判定（等 three/pixi 场景
      // 资源、着色器编译与行进场动画就绪），超时兜底同样让路到加载期之后
      if (has && !settled && elapsed > SCENE_READY_MS && !hasRunningFiniteAnimations(stage)) {
        if (quietSince < 0) quietSince = now
        if (now - quietSince >= QUIET_MS) {
          settled = true
          done('shown')
          return
        }
      } else {
        quietSince = -1
      }
      var giveUpAt = Math.max(has ? Math.max(SETTLE_MAX_MS, EMPTY_CANVAS_MS) : GIVE_UP_MS, SCENE_READY_MS + 500)
      if (elapsed > giveUpAt) {
        done(has ? 'shown' : 'empty')
        return
      }
      setTimeout(function () { requestAnimationFrame(tick) }, 80)
    }
    setTimeout(function () { requestAnimationFrame(tick) }, 80)
  }

  // ===== 冻结克隆（freezeStage） =====
  function freezeCanvasPair(source, clone) {
    var width = Math.min(source.width, IMAGE_CANVAS_WIDTH * Math.max(1, Math.ceil(source.width / source.height)))
    var ratio = Math.min(1, IMAGE_CANVAS_WIDTH / Math.max(1, source.width))
    var targetWidth = Math.max(1, Math.round(source.width * ratio))
    var targetHeight = Math.max(1, Math.round(source.height * ratio))
    clone.width = targetWidth
    clone.height = targetHeight
    var ctx = clone.getContext('2d')
    if (ctx) {
      try { ctx.drawImage(source, 0, 0, targetWidth, targetHeight) } catch (e) { /* 跨域污染：留空 */ }
    }
    // CSS 尺寸跟源一致（克隆缩小显示时由外层 transform 缩放）
    clone.style.width = source.style.width || (source.clientWidth + 'px')
    clone.style.height = source.style.height || (source.clientHeight + 'px')
  }

  /** 把动画的当前帧写死成内联样式（上游 freezeStage 的动画固化）。 */
  function freezeAnimations(stage, clone) {
    if (!stage.getAnimations) return
    var animations = stage.getAnimations({ subtree: true })
    var cloneAll = clone.querySelectorAll('*')
    animations.forEach(function (animation) {
      var effect = animation.effect
      if (!effect || !effect.target) return
      var target = effect.target
      var cloneTarget = null
      if (cloneAll && cloneAll.length) {
        // 目标元素在克隆树里按原序对应（cloneNode(true) 保序）
        var originals = stage.querySelectorAll('*')
        var index = Array.prototype.indexOf.call(originals, target)
        if (index >= 0 && index < cloneAll.length) cloneTarget = cloneAll[index]
      }
      var computed = getComputedStyle(target)
      var properties = effect.getKeyframes ? effect.getKeyframes().reduce(function (set, frame) {
        Object.keys(frame).forEach(function (key) {
          if (key !== 'offset' && key !== 'easing' && key !== 'composite') set[key] = true
        })
        return set
      }, {}) : {}
      var destination = cloneTarget || target
      Object.keys(properties).forEach(function (property) {
        try { destination.style.setProperty(property, computed.getPropertyValue(property)) } catch (e) { /* 忽略 */ }
      })
      if (cloneTarget) cloneTarget.style.animation = 'none'
      try { animation.cancel() } catch (e) { /* 忽略 */ }
    })
  }

  function freezeStage(stage) {
    var clone = stage.cloneNode(true)
    // 每张 canvas 固定 CSS 尺寸后把像素拷进克隆
    var sourceCanvases = stage.querySelectorAll('canvas')
    var cloneCanvases = clone.querySelectorAll('canvas')
    for (var i = 0; i < sourceCanvases.length && i < cloneCanvases.length; i += 1) {
      freezeCanvasPair(sourceCanvases[i], cloneCanvases[i])
    }
    clone.querySelectorAll('*').forEach(function (node) { node.style.willChange = 'auto' })
    freezeAnimations(stage, clone)
    // 克隆根按离屏舞台的原始尺寸摆放（清掉取自舞台的 inset:0），插入缩略图卡片后
    // 由使用方按卡片实际宽 transform:scale 整体缩小——内部子元素仍活在 960×600 坐标系里。
    // transform 同时会把克隆内 position:fixed 后代的包含块收归克隆根本身，
    // 配合 overflow:hidden，快照里的悬浮元素不会再铺到卡片外。
    clone.style.inset = 'auto'
    clone.style.left = '0'
    clone.style.top = '0'
    clone.style.width = STAGE_WIDTH + 'px'
    clone.style.height = STAGE_HEIGHT + 'px'
    clone.style.transformOrigin = 'top left'
    clone.style.transform = 'scale(0.001)' // 占位：未适配前缩到不可见，防止撑爆卡片布局
    return clone
  }

  // ===== WebGL 上下文回收（followCanvases） =====
  function loseContexts(stage) {
    var canvases = stage.querySelectorAll('canvas')
    canvases.forEach(function (canvas) {
      var gl = canvas.getContext('webgl2') || canvas.getContext('webgl')
      // 已丢失的跳过：pixi/three 的 destroy 自己会丢上下文，再 lose 一次只会刷 INVALID_OPERATION 警告
      if (gl && !gl.isContextLost()) {
        var ext = gl.getExtension('WEBGL_lose_context')
        if (ext) {
          try { ext.loseContext() } catch (e) { /* 忽略 */ }
        }
      }
    })
  }

  // ===== 串行队列 + 缓存 =====
  var cache = new Map()      // cacheKey → HTMLElement（冻结克隆）
  var lruOrder = []
  var queue = []             // { modeId, theme, sampleId, onReady }
  var running = null         // 当前在做图的任务
  var lastMadeAt = {}        // cacheKey → 上次成图时刻（NEW_IMAGE_REST_MS）

  function themeKeyOf(theme) {
    // 抹掉 name/description（AI 主题每首歌不同），色值才决定缓存键
    return theme ? [theme.backgroundColor, theme.primaryColor, theme.accentColor, theme.secondaryColor].join('|') : ''
  }

  function cacheKey(modeId, theme, sampleId) {
    return modeId + '::' + themeKeyOf(theme) + '::' + (sampleId || 'default')
  }

  function cachePut(key, node) {
    if (cache.has(key)) {
      cache.delete(key)
      var idx = lruOrder.indexOf(key)
      if (idx >= 0) lruOrder.splice(idx, 1)
    }
    cache.set(key, node)
    lruOrder.push(key)
    while (lruOrder.length > KEPT) {
      var oldest = lruOrder.shift()
      cache.delete(oldest)
    }
  }

  function cacheGet(key) {
    if (!cache.has(key)) return null
    // LRU 触摸
    var idx = lruOrder.indexOf(key)
    if (idx >= 0) {
      lruOrder.splice(idx, 1)
      lruOrder.push(key)
    }
    return cache.get(key)
  }

  /** 请求一张冻结图。onReady(node|null)：node 是可直接 appendChild 的冻结 DOM（null 为两次空台降级）。 */
  function request(modeId, theme, sampleId, onReady) {
    var key = cacheKey(modeId, theme, sampleId)
    var cached = cacheGet(key)
    if (cached) {
      // 同一张冻结图显示在多处时要再克隆一次（一个元素只能在一个位置）
      onReady(cached.cloneNode(true))
      return
    }
    var rest = lastMadeAt[key] ? NEW_IMAGE_REST_MS : FIRST_IMAGE_REST_MS
    queue.push({ modeId: modeId, theme: theme, sampleId: sampleId, onReady: onReady, key: key, rest: rest, tries: 0 })
    pump()
  }

  function pump() {
    if (running || !queue.length) return
    var task = queue.shift()
    running = task
    setTimeout(function () { takeTurn(task) }, Math.max(0, task.rest))
  }

  function finish(task, node, status) {
    running = null
    if (node) {
      cachePut(task.key, node)
      task.onReady(node.cloneNode(true))
    } else if (task.tries + 1 < IMAGE_TRIES) {
      // 空台重试一次
      task.tries += 1
      task.rest = 300
      queue.unshift(task)
    } else {
      task.onReady(null)
    }
    void status
    pump()
  }

  function takeTurn(task) {
    if (!window.FoliaRegistry || !window.FoliaRegistry.previewCreate) {
      finish(task, null, 'no-registry')
      return
    }
    var frame = posterFrame(task.sampleId, task.theme)
    if (!frame) {
      finish(task, null, 'no-sample')
      return
    }
    var hostEl = ensureStageHost()
    var stage = document.createElement('div')
    stage.style.cssText = 'position:absolute;inset:0;overflow:hidden'
    hostEl.appendChild(stage)
    var instance = null
    var disposed = false
    var rafId = 0

    window.FoliaRegistry.previewCreate(task.modeId, stage, {
      theme: task.theme,
      lines: frame.lines,
      fontScale: 1,
      previewMode: true,
      tuning: window.FoliaTunings ? window.FoliaTunings.getModeTuning(task.modeId) : undefined
    }).then(function (preview) {
      if (disposed) {
        preview.destroy()
        return
      }
      instance = preview.instance
      // 预热快进：从 poster 前 WARMUP_SECONDS 处匀速推进到 poster 再停稳——
      // 行切换/进场动画在这段播完，冻结时画面停在固定一句的稳态上
      var warmupFrom = Math.max(0, frame.currentTime - WARMUP_SECONDS)
      var elapsed = 0
      function step() {
        if (disposed || !instance) return
        elapsed += 1 / 60
        var time = Math.min(warmupFrom + elapsed, frame.currentTime)
        // 停稳后只加 ±0.0001s 抖动触发"只在时间变化时重画"的样式，不足以切换行
        var jitter = time >= frame.currentTime ? (elapsed % 2) * 0.0001 : 0
        var frameState = Object.assign({}, frame, { currentTime: time + jitter, dt: 1 / 60 })
        try { instance.tick(frameState) } catch (e) { /* 帧异常不阻塞 */ }
        rafId = requestAnimationFrame(step)
      }
      rafId = requestAnimationFrame(step)
      watchStage(stage, function (status) {
        if (disposed) return
        disposed = true
        if (rafId) cancelAnimationFrame(rafId)
        var node = null
        if (status === 'shown') {
          try { node = freezeStage(stage) } catch (e) { node = null }
        }
        // 先让实例自己销毁（pixi/three 会正确丢上下文），再对仍存活的 canvas 兜底回收
        try { if (instance && instance.destroy) instance.destroy() } catch (e) { /* 忽略 */ }
        instance = null
        loseContexts(stage)
        stage.remove()
        lastMadeAt[task.key] = performance.now()
        finish(task, node, status)
      })
    }).catch(function () {
      if (!disposed) {
        disposed = true
        if (rafId) cancelAnimationFrame(rafId)
        stage.remove()
        finish(task, null, 'failed')
      }
    })
  }

  /** 清掉某个样式的缓存（tuning 变化后调用）；清空队列里同 key 的待办。 */
  function invalidate(modeId, theme) {
    var prefix = modeId + '::' + themeKeyOf(theme) + '::'
    var keys = []
    cache.forEach(function (value, key) {
      if (key.indexOf(prefix) === 0) keys.push(key)
    })
    keys.forEach(function (key) {
      cache.delete(key)
      var idx = lruOrder.indexOf(key)
      if (idx >= 0) lruOrder.splice(idx, 1)
    })
    lastMadeAt = {}
  }

  window.FoliaFrozenPicture = {
    request: request,
    invalidate: invalidate,
    disposeStageHost: disposeStageHost,
    STAGE_WIDTH: STAGE_WIDTH, // 缩放基准：卡片宽 / STAGE_WIDTH = 缩略图 scale
    STAGE_HEIGHT: STAGE_HEIGHT,
    /** 供样式窗口查询缓存命中（同步路径优先用缓存）。 */
    peek: function (modeId, theme, sampleId) {
      return cacheGet(cacheKey(modeId, theme, sampleId))
    }
  }
})()
