// 歌词样式设置二级窗口（复刻上游 folia-major VisPlayground / StudioWindow）
// 结构：暗层 + 居中窗口（头部 + 左舞台/样式架 + 右 420px 设置列）
// 五个设置页：动画（样式参数面板/强度/随机池）、背景、字体、字幕、全局（歌词过滤/时间矫正）
// 语义：滑条拖动只更新 draft（舞台实例热更），松手才写 localStorage 并应用到主页面；
//       样式架选择直接切换主页面样式；窗口打开时主页面模式/背景暂停（GPU 让给预览舞台）。
// 运行于 bridge.html 所在 iframe，经 window.FoliaBridge / FoliaTunings / FoliaRegistry 等协作。
(function () {
  'use strict'

  var Kit = window.FoliaPanelKit   // 控件套件（panel-kit.js 先于本文件加载）

  // ===== 状态 =====
  var state = {
    open: false,
    tab: 'visualizer',     // visualizer | background | common | subtitle | global
    source: 'builtin',     // builtin | live
    paused: false,
    sampleId: 'default'
  }
  var stage = null             // FoliaSampleStage 实例
  var bgPreview = null         // 舞台背景预览实例（FoliaBackgrounds.previewCreate）
  var bgPreviewToken = 0
  var draftTuning = null       // 动画页滑条 draft（完整 tuning 对象）
  var tabRefreshers = {}       // 各页 refresh 函数（外部状态变化时刷新控件）

  var root = null

  // ===== 工具 =====
  function bridge() { return window.FoliaBridge }
  function tunings() { return window.FoliaTunings }
  function getState() { return bridge().getState() }

  // 点路径写入（tuning draft 用，与 FoliaTunings 的路径语义一致）
  function setPath(obj, path, value) {
    var parts = String(path).split('.')
    var cur = obj
    for (var i = 0; i < parts.length - 1; i += 1) {
      if (cur[parts[i]] == null || typeof cur[parts[i]] !== 'object') cur[parts[i]] = {}
      cur = cur[parts[i]]
    }
    cur[parts[parts.length - 1]] = value
  }

  // 舞台背景的 config 组装（与 bridge buildBackgroundConfig 同构，读窗口可见状态）
  function bgPreviewConfig(mode) {
    var st = getState()
    if (mode === 'url') return bridge().getUrlBgConfig()
    if (mode === 'transparent') return { windowBg: st.windowBgState, overlayOpacity: st.transparentOverlay }
    if (mode === 'common') {
      var common = tunings().getBgTuning('common')
      return { useCoverColorBg: st.coverBlur, opacity: common.opacity, disableGeometricBackground: false, disableVignette: common.disableVignette }
    }
    return tunings().getBgTuning(mode)
  }

  // ===== DOM 构建（一次构建，open/close 显隐） =====
  function buildDom() {
    root = document.createElement('div')
    root.className = 'fsw-root'
    root.style.display = 'none'

    var backdrop = document.createElement('div')
    backdrop.className = 'fsw-backdrop'
    backdrop.addEventListener('click', close)
    root.appendChild(backdrop)

    var win = document.createElement('div')
    win.className = 'fsw-win'

    // 头部
    var header = document.createElement('div')
    header.className = 'fsw-header'
    var backBtn = document.createElement('button')
    backBtn.className = 'fsw-back'
    backBtn.type = 'button'
    backBtn.innerHTML = '<svg viewBox="0 0 24 24"><path d="m15 18-6-6 6-6"/></svg>返回'
    backBtn.addEventListener('click', close)
    var title = document.createElement('div')
    title.className = 'fsw-title'
    title.textContent = '歌词样式设置'
    header.appendChild(backBtn)
    header.appendChild(title)
    win.appendChild(header)

    // 内容区
    var body = document.createElement('div')
    body.className = 'fsw-body'

    // 左列：舞台 + 样式架
    var stageCol = document.createElement('div')
    stageCol.className = 'fsw-stage-col'
    var stageBox = document.createElement('div')
    stageBox.className = 'fsw-stage'
    var stageHost = document.createElement('div')
    stageBox.appendChild(stageHost)
    // 舞台工具（预览源切换 + 暂停）
    var tools = document.createElement('div')
    tools.className = 'fsw-stage-tools'
    var sourceSwitch = document.createElement('div')
    sourceSwitch.className = 'fsw-source-switch'
    var builtinBtn = document.createElement('button')
    builtinBtn.className = 'fsw-source-btn active'
    builtinBtn.type = 'button'
    builtinBtn.textContent = '示例'
    var liveBtn = document.createElement('button')
    liveBtn.className = 'fsw-source-btn'
    liveBtn.type = 'button'
    liveBtn.textContent = '实时'
    builtinBtn.addEventListener('click', function () { setSource('builtin') })
    liveBtn.addEventListener('click', function () { setSource('live') })
    sourceSwitch.appendChild(builtinBtn)
    sourceSwitch.appendChild(liveBtn)
    tools.appendChild(sourceSwitch)
    var pauseBtn = document.createElement('button')
    pauseBtn.className = 'fsw-pause-btn'
    pauseBtn.type = 'button'
    pauseBtn.title = '暂停预览'
    pauseBtn.innerHTML = '<svg viewBox="0 0 24 24"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>'
    pauseBtn.addEventListener('click', function () {
      state.paused = !state.paused
      if (stage) stage.setPaused(state.paused)
      pauseBtn.innerHTML = state.paused
        ? '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>'
        : '<svg viewBox="0 0 24 24"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>'
      pauseBtn.title = state.paused ? '继续预览' : '暂停预览'
    })
    tools.appendChild(pauseBtn)
    stageBox.appendChild(tools)
    stageCol.appendChild(stageBox)

    // 样式架
    var shelfWrap = document.createElement('div')
    shelfWrap.className = 'fsw-shelf-wrap'
    var shelfTitle = document.createElement('h3')
    shelfTitle.className = 'fsw-shelf-title'
    var shelfCount = document.createElement('span')
    shelfCount.className = 'fsw-shelf-count'
    shelfTitle.appendChild(document.createTextNode('歌词样式 '))
    shelfTitle.appendChild(shelfCount)
    var shelf = document.createElement('div')
    shelf.className = 'fsw-shelf'
    shelfWrap.appendChild(shelfTitle)
    shelfWrap.appendChild(shelf)
    stageCol.appendChild(shelfWrap)
    body.appendChild(stageCol)

    // 右列：tabs + 设置列
    var col = document.createElement('div')
    col.className = 'fsw-col'
    var tabs = document.createElement('div')
    tabs.className = 'fsw-tabs'
    var resetBtn = document.createElement('button')
    resetBtn.className = 'fsw-tab-reset'
    resetBtn.type = 'button'
    resetBtn.textContent = '默认'
    resetBtn.addEventListener('click', function () { resetCurrentTab() })
    tabs.appendChild(resetBtn)
    var colBody = document.createElement('div')
    colBody.className = 'fsw-col-body'
    col.appendChild(tabs)
    col.appendChild(colBody)
    body.appendChild(col)

    win.appendChild(body)
    root.appendChild(win)
    document.body.appendChild(root)

    // 缓存引用
    root._refs = {
      win: win, stageHost: stageHost, shelf: shelf, shelfCount: shelfCount,
      tabs: tabs, colBody: colBody, resetBtn: resetBtn,
      builtinBtn: builtinBtn, liveBtn: liveBtn, stageBox: stageBox
    }

    // Esc 关闭
    document.addEventListener('keydown', function (e) {
      if (state.open && e.key === 'Escape') {
        e.stopPropagation()
        close()
      }
    }, true)

    // tab 定义（顺序对齐上游）
    TAB_DEFS.forEach(function (def) {
      var btn = document.createElement('button')
      btn.className = 'fsw-tab'
      btn.type = 'button'
      btn.textContent = def.label
      btn.dataset.tab = def.id
      btn.addEventListener('click', function () { switchTab(def.id) })
      tabs.insertBefore(btn, resetBtn)
    })
  }

  var TAB_DEFS = [
    { id: 'visualizer', label: '动画' },
    { id: 'background', label: '背景' },
    { id: 'common', label: '字体' },
    { id: 'subtitle', label: '字幕' },
    { id: 'global', label: '全局' }
  ]

  // ===== 舞台 =====
  function stageGetState() {
    var st = getState()
    return {
      theme: st.theme,
      adaptedLines: st.adaptedLines,
      appearance: st.appearance
    }
  }

  function ensureStage() {
    if (stage) return stage
    stage = window.FoliaSampleStage.create({
      host: root._refs.stageHost,
      getState: stageGetState
    })
    stage.setFrameHook(function (frameState) {
      tickBgPreview(frameState)
    })
    return stage
  }

  // ===== 舞台背景实例 =====
  function rebuildBgPreview() {
    if (!root) return
    var token = ++bgPreviewToken
    if (bgPreview) {
      try { bgPreview.destroy() } catch (e) { /* 忽略 */ }
      bgPreview = null
    }
    var bgHost = root._refs.stageBox.querySelector('.fsw-bg-preview')
    if (!bgHost) {
      bgHost = document.createElement('div')
      bgHost.className = 'fsw-bg-preview'
      bgHost.style.cssText = 'position:absolute;inset:0;overflow:hidden;z-index:1'
      root._refs.stageBox.insertBefore(bgHost, root._refs.stageBox.firstChild)
    }
    bgHost.innerHTML = ''
    var mode = getState().backgroundMode
    var st = getState()
    window.FoliaBackgrounds.previewCreate(mode, bgHost, {
      config: bgPreviewConfig(mode),
      theme: st.theme,
      coverUrl: st.coverUrl
    }).then(function (preview) {
      if (token !== bgPreviewToken || !state.open) {
        preview.destroy()
        return
      }
      bgPreview = preview
      if (mode !== 'transparent') {
        // 舞台背景压暗文字可读性（与主页面一致：模式层在背景之上）
        bgHost.style.opacity = mode === 'url' ? '0.9' : '1'
      }
    }).catch(function (e) {
      console.warn('[FoliaStyleWindow] 舞台背景创建失败', e)
    })
  }

  function tickBgPreview(frameState) {
    if (!bgPreview) return
    try {
      bgPreview.instance.tick({
        audioPower: frameState.audioPower,
        audioBands: frameState.audioBands,
        isPlaying: frameState.isPlaying,
        dt: frameState.dt,
        coverUrl: frameState.coverUrl
      })
    } catch (e) { /* 背景帧异常不阻塞 */ }
  }

  function destroyBgPreview() {
    bgPreviewToken += 1
    if (bgPreview) {
      try { bgPreview.destroy() } catch (e) { /* 忽略 */ }
      bgPreview = null
    }
    if (root) {
      var bgHost = root._refs.stageBox.querySelector('.fsw-bg-preview')
      if (bgHost) bgHost.innerHTML = ''
    }
  }

  function setSource(next) {
    if (state.source === next) return
    state.source = next
    if (stage) stage.setSource(next)
    root._refs.builtinBtn.classList.toggle('active', next === 'builtin')
    root._refs.liveBtn.classList.toggle('active', next === 'live')
    if (next === 'live') rebuildBgPreview()
  }

  // ===== 样式架 =====
  var thumbCache = {}   // modeId → dataURL（主题变化时失效重建）
  var thumbThemeKey = ''

  function drawThumb(canvas, modeId, theme, isRandom) {
    var w = 160
    var h = 100
    canvas.width = w
    canvas.height = h
    var ctx = canvas.getContext('2d')
    if (!ctx) return
    var bg = (theme && theme.backgroundColor) || '#09090b'
    var primary = (theme && theme.primaryColor) || '#f4f4f5'
    var accent = (theme && theme.accentColor) || '#00f5d4'
    ctx.fillStyle = bg
    ctx.fillRect(0, 0, w, h)
    if (isRandom) {
      // 随机卡片：四分色块 + 中心问号
      var colors = [primary, accent, (theme && theme.secondaryColor) || '#71717a', mixHex(bg, accent, 0.35)]
      var cw = w / 2
      var ch = h / 2
      for (var i = 0; i < 4; i += 1) {
        ctx.globalAlpha = 0.5
        ctx.fillStyle = colors[i]
        ctx.fillRect((i % 2) * cw, Math.floor(i / 2) * ch, cw, ch)
      }
      ctx.globalAlpha = 1
      ctx.fillStyle = '#ffffff'
      ctx.font = '600 30px sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText('?', w / 2, h / 2 + 2)
      return
    }
    // 样式卡片：主题底色 + 两行示例文字（主色/强调色），按样式做特征化微调
    var variants = {
      classic: { rotate: 0 }, cadenza: { italic: true }, partita: { stagger: 4 },
      fume: { serif: true }, tilt: { tilt: true }, monet: { frame: true },
      sonnet: { thin: true }, tempera: { blocks: true }, lumiere: { glow: true },
      hanabi: { burst: true }, nebbia: { fog: true }, machi: { frame: true },
      claddagh: { ring: true }, pendolo: { arc: true }, cappella: { dots: true },
      diorama: { depth: true }, still: { flat: true }
    }
    var v = variants[modeId] || {}
    var fontStack = v.serif ? 'Georgia, "Noto Serif SC", serif' : '"PingFang SC", "Microsoft YaHei", sans-serif'
    ctx.save()
    ctx.translate(w / 2, h / 2)
    if (v.tilt) ctx.rotate(-0.06)
    if (v.ring) {
      ctx.strokeStyle = accent
      ctx.globalAlpha = 0.55
      ctx.beginPath()
      ctx.ellipse(0, 0, w * 0.36, h * 0.3, -0.6, 0, Math.PI * 2)
      ctx.lineWidth = 1.5
      ctx.stroke()
      ctx.globalAlpha = 1
    }
    if (v.arc) {
      ctx.strokeStyle = accent
      ctx.globalAlpha = 0.5
      ctx.beginPath()
      ctx.arc(w * 0.12, h * 0.1, h * 0.72, -0.5, 1.6)
      ctx.lineWidth = 1.5
      ctx.stroke()
      ctx.globalAlpha = 1
    }
    if (v.blocks) {
      ctx.globalAlpha = 0.24
      ctx.fillStyle = accent
      ctx.fillRect(-w * 0.34, -h * 0.28, w * 0.2, h * 0.5)
      ctx.fillStyle = primary
      ctx.fillRect(w * 0.1, -h * 0.1, w * 0.24, h * 0.44)
      ctx.globalAlpha = 1
    }
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.font = (v.thin ? '300 ' : '600 ') + (v.depth ? '20px ' : '19px ') + fontStack
    if (v.glow) {
      ctx.shadowColor = accent
      ctx.shadowBlur = 14
    }
    if (v.italic) ctx.font = 'italic ' + ctx.font
    ctx.fillStyle = v.flat ? primary : mixHex(primary, accent, 0.25)
    ctx.fillText('夜色漫过', v.stagger ? -6 : 0, v.depth ? -12 : -10)
    ctx.fillStyle = accent
    ctx.fillText('窗台与星', v.stagger ? 6 : 0, v.depth ? 12 : 12)
    ctx.restore()
    if (v.frame) {
      ctx.strokeStyle = 'rgba(255,255,255,0.28)'
      ctx.strokeRect(6.5, 6.5, w - 13, h - 13)
    }
    if (v.dots) {
      ctx.fillStyle = accent
      for (var d = 0; d < 6; d += 1) {
        ctx.globalAlpha = 0.5
        ctx.beginPath()
        ctx.arc(14 + d * 12, 12, 2.4, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.globalAlpha = 1
    }
  }

  function mixHex(a, b, ratio) {
    function parse(hex) {
      var s = String(hex || '#000000').replace('#', '')
      if (s.length === 3) s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2]
      var n = parseInt(s, 16)
      return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
    }
    var ca = parse(a)
    var cb = parse(b)
    var out = ca.map(function (c, i) {
      return Math.round(c + (cb[i] - c) * ratio)
    })
    return 'rgb(' + out.join(',') + ')'
  }

  // ===== 冻结快照缩略图适配：克隆保持离屏舞台原始尺寸（960×600），按卡片实际宽整体缩放 =====
  var FROZEN_STAGE_W = (window.FoliaFrozenPicture && window.FoliaFrozenPicture.STAGE_WIDTH) || 960
  var frozenThumbMap = new Map()   // 卡片 → 已挂载的冻结节点（卡片尺寸变化时更新 scale）
  var frozenThumbObserver = null
  function ensureFrozenObserver() {
    if (frozenThumbObserver || typeof ResizeObserver !== 'function') return frozenThumbObserver
    frozenThumbObserver = new ResizeObserver(function (entries) {
      entries.forEach(function (entry) {
        var node = frozenThumbMap.get(entry.target)
        if (node) fitFrozenThumb(node, entry.target)
      })
    })
    return frozenThumbObserver
  }
  function fitFrozenThumb(node, card) {
    var w = card.clientWidth
    if (w > 0) node.style.transform = 'scale(' + (w / FROZEN_STAGE_W) + ')'
  }
  /** 隐藏简笔 canvas、插入冻结快照并按当前卡片宽缩放（窗口/列数变化由 ResizeObserver 跟随）。 */
  function mountFrozenThumb(node, card, canvas, label) {
    canvas.style.display = 'none'
    node.classList.add('fsw-frozen-thumb')
    card.insertBefore(node, label)
    fitFrozenThumb(node, card)
    var obs = ensureFrozenObserver()
    if (obs) {
      frozenThumbMap.set(card, node)
      obs.observe(card)
    }
  }

  function renderShelf() {
    var refs = root._refs
    var st = getState()
    var themeKey = (st.theme && (st.theme.accentColor + st.theme.primaryColor + st.theme.backgroundColor)) || ''
    if (themeKey !== thumbThemeKey) {
      thumbCache = {}
      thumbThemeKey = themeKey
    }
    var modes = window.FoliaRegistry.getModeOptions()
    refs.shelfCount.textContent = '(' + (modes.length + 1) + ')'
    refs.shelf.innerHTML = ''
    // 卡片整批重建：解除上一批的尺寸观察，避免观察已移除的旧卡片
    if (frozenThumbObserver) {
      frozenThumbObserver.disconnect()
      frozenThumbMap.clear()
    }
    modes.forEach(function (mode) {
      var card = document.createElement('button')
      card.className = 'fsw-shelf-card'
      card.type = 'button'
      card.title = mode.label
      var canvas = document.createElement('canvas')
      card.appendChild(canvas)
      var label = document.createElement('span')
      label.className = 'fsw-shelf-label'
      label.textContent = mode.label
      card.appendChild(label)
      if (mode.id === st.animMode && !st.randomModePerSong) card.classList.add('active')
      card.addEventListener('click', function () {
        bridge().setRandomPerSong(false)
        bridge().setAnimMode(mode.id)
      })
      refs.shelf.appendChild(card)
      // 缩略图：优先活实例冻结快照（真实渲染），不可用时回退 canvas 简笔图（缓存 dataURL）
      var key = mode.id
      var frozen = window.FoliaFrozenPicture
        ? window.FoliaFrozenPicture.peek(mode.id, st.theme, 'default')
        : null
      if (frozen) {
        mountFrozenThumb(frozen.cloneNode(true), card, canvas, label)
      } else if (thumbCache[key]) {
        drawThumbFromCache(canvas, thumbCache[key])
        // 排队做真实快照（串行做图，好了换上）
        if (window.FoliaFrozenPicture) {
          window.FoliaFrozenPicture.request(mode.id, st.theme, 'default', function (node) {
            if (node && card.isConnected) mountFrozenThumb(node, card, canvas, label)
          })
        }
      } else {
        drawThumb(canvas, mode.id, st.theme, false)
        thumbCache[key] = canvas.toDataURL()
        if (window.FoliaFrozenPicture) {
          window.FoliaFrozenPicture.request(mode.id, st.theme, 'default', function (node) {
            if (node && card.isConnected) mountFrozenThumb(node, card, canvas, label)
          })
        }
      }
    })
    // 随机卡片
    var randomCard = document.createElement('button')
    randomCard.className = 'fsw-shelf-card random'
    randomCard.type = 'button'
    randomCard.title = '随机'
    var randomCanvas = document.createElement('canvas')
    randomCard.appendChild(randomCanvas)
    var randomLabel = document.createElement('span')
    randomLabel.className = 'fsw-shelf-label'
    randomLabel.textContent = '随机'
    randomCard.appendChild(randomLabel)
    if (st.randomModePerSong) randomCard.classList.add('active')
    randomCard.addEventListener('click', function () {
      // 开启每首歌随机并立即随机挑选一个模式（空池 = 全部参与）
      var pool = tunings().getRandomPool()
      var modes2 = window.FoliaRegistry.getModeOptions().filter(function (m) {
        return !pool.length || pool.indexOf(m.id) >= 0
      })
      bridge().setRandomPerSong(true)
      if (modes2.length) {
        bridge().setAnimMode(modes2[Math.floor(Math.random() * modes2.length)].id)
      } else {
        refreshShelfActive()
      }
    })
    refs.shelf.appendChild(randomCard)
    if (thumbCache['random']) {
      drawThumbFromCache(randomCanvas, thumbCache['random'])
    } else {
      drawThumb(randomCanvas, 'random', st.theme, true)
      thumbCache['random'] = randomCanvas.toDataURL()
    }
  }

  function drawThumbFromCache(canvas, dataUrl) {
    var img = new Image()
    img.onload = function () {
      var ctx = canvas.getContext('2d')
      if (ctx) ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    }
    img.src = dataUrl
  }

  function refreshShelfActive() {
    if (!root) return
    var st = getState()
    var cards = root._refs.shelf.querySelectorAll('.fsw-shelf-card')
    var modes = window.FoliaRegistry.getModeOptions()
    cards.forEach(function (card, index) {
      if (index < modes.length) {
        card.classList.toggle('active', !st.randomModePerSong && modes[index].id === st.animMode)
      } else {
        card.classList.toggle('active', st.randomModePerSong)
      }
    })
  }

  // ===== 设置页 =====
  function switchTab(tabId) {
    state.tab = tabId
    if (root) {
      root._refs.tabs.querySelectorAll('.fsw-tab').forEach(function (btn) {
        btn.classList.toggle('active', btn.dataset.tab === tabId)
      })
      renderTab()
    }
  }

  function renderTab() {
    if (!root) return
    var colBody = root._refs.colBody
    colBody.innerHTML = ''
    tabRefreshers = {}
    var renderer = TAB_RENDERERS[state.tab]
    if (renderer) renderer(colBody)
    // 重置按钮文案与可用性
    var resetVisible = state.tab !== 'global'
    root._refs.resetBtn.style.display = resetVisible ? '' : 'none'
  }

  // 当前页重置（对齐上游每页右上「默认」按钮）
  function resetCurrentTab() {
    var st = getState()
    if (state.tab === 'visualizer') {
      var modeId = st.animMode
      tunings().resetModeTuning(modeId)
      draftTuning = null
      if (stage) stage.setMode(modeId, tunings().getModeTuning(modeId))
      bridge().applyModeTuning(modeId, tunings().getModeTuning(modeId))
      renderTab()
    } else if (state.tab === 'background') {
      var bgId = st.backgroundMode
      tunings().resetBgTuning(bgId)
      if (bgId === 'common') {
        // 通用背景：封面色开关跟随封面模糊，一并恢复默认（开）
        bridge().setCoverBlur(true)
      }
      if (bgId === 'transparent') {
        bridge().setTransparentOverlay(null)
        bridge().setTransparentFrost('off')
      }
      bridge().applyBgTuning(bgId, tunings().getBgTuning(bgId))
      rebuildBgPreview()
      renderTab()
    } else if (state.tab === 'common') {
      var appearance = tunings().getAppearance()
      bridge().applyFontScale(1)
      bridge().applyFontWeight(0)
      bridge().applyVisualizerOpacity(1)
      if (stage) stage.applyFontScale(1)
      root._refs.stageHost.style.opacity = '1'
      renderTab()
    } else if (state.tab === 'subtitle') {
      tunings().setAppearance({
        subtitle: { enabled: true, opacity: 0.6, background: true, upcomingBlur: true, fontScale: 1 }
      })
      renderTab()
    }
  }

  // ===== 动画页 =====
  function renderVisualizerTab(colBody) {
    var st = getState()
    // 强度
    colBody.appendChild(Kit.groupTitle('动画强度'))
    var intensityCard = Kit.el('div', 'fsw-card')
    var intensityControl = Kit.segmented({
      options: [
        { value: 'calm', label: '平静' },
        { value: 'normal', label: '标准' },
        { value: 'chaotic', label: '混乱' }
      ],
      value: st.intensity,
      onChange: function (v) { bridge().setIntensity(v) }
    })
    intensityCard.appendChild(Kit.row('画面动感', intensityControl.root))
    colBody.appendChild(intensityCard)

    // 随机池（每首歌随机开启时）
    if (st.randomModePerSong) {
      colBody.appendChild(Kit.groupTitle('随机'))
      var randomCard = Kit.el('div', 'fsw-card')
      var randomControl = Kit.switchControl({
        value: true,
        onChange: function (v) {
          bridge().setRandomPerSong(v)
          refreshShelfActive()
          renderTab()
        }
      })
      randomControl.root.classList.add('checked')
      randomCard.appendChild(Kit.row('每首歌随机动画', randomControl.root, { hint: '切歌时从随机池中抽取样式' }))
      var poolWrap = Kit.el('div', 'fsw-pool-grid')
      var pool = tunings().getRandomPool()
      window.FoliaRegistry.getModeOptions().forEach(function (mode) {
        var btn = Kit.el('button', 'fsw-pool-btn' + (pool.indexOf(mode.id) >= 0 ? ' on' : ''), mode.label)
        btn.type = 'button'
        btn.addEventListener('click', function () {
          var current = tunings().getRandomPool()
          var idx = current.indexOf(mode.id)
          if (idx >= 0) current.splice(idx, 1)
          else current.push(mode.id)
          tunings().setRandomPool(current)
          btn.classList.toggle('on', current.indexOf(mode.id) >= 0)
        })
        poolWrap.appendChild(btn)
      })
      randomCard.appendChild(Kit.row('随机池', poolWrap, { hint: '不选任何样式时全部参与' }))
      colBody.appendChild(randomCard)
    }

    // 当前样式参数面板
    var modeId = st.animMode
    var schema = tunings().getModeSchema(modeId)
    colBody.appendChild(Kit.groupTitle((schema ? schema.label : modeId) + '参数'))
    if (!schema || !schema.groups.length) {
      colBody.appendChild(Kit.el('div', 'fsw-empty-hint', '这个样式没有参数'))
      renderBeatEffects(colBody, modeId)
      tabRefreshers.visualizer = function () { renderTab() }
      return
    }
    draftTuning = tunings().getModeTuning(modeId)
    var renderer = Kit.renderSchema(schema, {
      get: function () {
        return draftTuning || tunings().getModeTuning(modeId)
      },
      patch: function (key, value, commit) {
        // draft：先更新本地 + 舞台热更；commit：持久化 + 主页面应用
        var current = draftTuning || tunings().getModeTuning(modeId)
        var next = JSON.parse(JSON.stringify(current))
        setPath(next, key, value)
        draftTuning = next
        var liveApplied = stage && stage.applyTuningDraft(modeId, next)
        if (commit) {
          var saved = tunings().setModeTuning(modeId, setPathPatch(key, value))
          draftTuning = saved
          if (!liveApplied) {
            // 模式不支持热更：松手后重建舞台预览（主页面由 applyModeTuning 内部处理）
            if (stage) stage.setMode(modeId, saved)
          }
          bridge().applyModeTuning(modeId, saved)
        }
      }
    })
    colBody.appendChild(renderer.root)
    renderBeatEffects(colBody, modeId)
    tabRefreshers.visualizer = function () { renderTab() }
  }

  // ===== 主题（默认 / AI主题 / 自定义 + 深浅色 + 编辑器，复刻上游 ThemeSourceRow/ThemeNameRow/ThemeQuickEditor） =====
  function renderThemeSection(colBody) {
    var st = getState()
    var dual = bridge().getDualThemeState()
    colBody.appendChild(Kit.groupTitle('主题'))
    var card = Kit.el('div', 'fsw-card')

    // 三段模式选择：当前侧色的圆点标识（上游 SourceDot）
    var modeOptions = [
      { value: 'default', label: '默认' },
      { value: 'ai', label: 'AI主题' },
      { value: 'custom', label: '自定义' }
    ]
    var modeControl = Kit.segmented({
      options: modeOptions,
      value: dual.mode,
      onChange: function (v) {
        bridge().setThemeMode(v)
        renderTab()
      }
    })
    card.appendChild(Kit.row('主题来源', modeControl.root, { hint: '默认随封面取色；AI主题/自定义固定使用保存的主题' }))

    // 主题名 + 深浅色 + 生成 + 编辑
    var active = st.theme || {}
    var sideWrap = Kit.el('div', 'fsw-theme-actions')
    var daylightBtn = Kit.el('button', 'fsw-theme-action', dual.daylight ? '☀ 浅色' : '☾ 深色')
    daylightBtn.type = 'button'
    daylightBtn.title = '切换深浅色'
    daylightBtn.addEventListener('click', function () {
      bridge().setDaylight(!dual.daylight)
      renderTab()
    })
    sideWrap.appendChild(daylightBtn)
    var genBtn = Kit.el('button', 'fsw-theme-action', '✦ 生成AI主题')
    genBtn.type = 'button'
    genBtn.title = '从封面取色生成明暗双主题'
    genBtn.addEventListener('click', function () {
      genBtn.disabled = true
      genBtn.textContent = '生成中…'
      bridge().generateAiTheme().then(function () {
        renderTab()
      }).catch(function () {
        genBtn.disabled = false
        genBtn.textContent = '✦ 生成AI主题'
      })
    })
    sideWrap.appendChild(genBtn)
    var editBtn = Kit.el('button', 'fsw-theme-action', '🎨 编辑')
    editBtn.type = 'button'
    editBtn.title = '快速编辑主题（明暗双侧四色 + 名称）'
    editBtn.addEventListener('click', function () {
      openThemeEditor()
    })
    sideWrap.appendChild(editBtn)
    card.appendChild(Kit.row((active.name || '默认主题'), sideWrap, { hint: (active.provider || '随封面取色') + (active.description ? ' · ' + active.description : '') }))
    colBody.appendChild(card)
  }

  // ===== 主题快速编辑对话框 =====
  // 编辑草稿（明暗双侧四色 + 名称），保存时写回 AI 主题 / 自定义主题（default 模式保存为自定义并切换）。
  var themeEditorState = { open: false }

  function openThemeEditor() {
    if (themeEditorState.open) return
    var st = getState()
    var dual = bridge().getDualThemeState()
    // 草稿起点：ai → ai 双侧；custom → custom 双侧；default → 由当前主题合成双侧
    var source = dual.mode === 'ai' && dual.ai ? dual.ai : (dual.mode === 'custom' && dual.custom ? dual.custom : null)
    if (!source) {
      var base = st.theme || { backgroundColor: '#09090b', primaryColor: '#f4f4f5', accentColor: '#f4f4f5', secondaryColor: '#71717a' }
      source = {
        light: Object.assign({}, base, { name: (base.name || '主题') + ' 浅色' }),
        dark: Object.assign({}, base, { name: base.name || '主题' })
      }
    }
    var draft = {
      light: JSON.parse(JSON.stringify(source.light)),
      dark: JSON.parse(JSON.stringify(source.dark))
    }
    var editingSide = dual.daylight ? 'light' : 'dark'
    var savingMode = dual.mode === 'ai' ? 'ai' : 'custom'

    var overlay = Kit.el('div', 'fsw-modal-overlay')
    var dialog = Kit.el('div', 'fsw-modal fsw-theme-editor')
    var header = Kit.el('div', 'fsw-modal-head')
    header.appendChild(Kit.el('div', 'fsw-modal-title', '编辑主题'))
    var closeBtn = Kit.el('button', 'fsw-mini-btn', '×')
    closeBtn.type = 'button'
    closeBtn.addEventListener('click', function () { closeThemeEditor() })
    header.appendChild(closeBtn)
    dialog.appendChild(header)

    var body = Kit.el('div', 'fsw-theme-body')
    // 左列：侧别切换 + 四色井 + 名称
    var left = Kit.el('div', 'fsw-theme-left')
    var sideSeg = Kit.segmented({
      options: [{ value: 'light', label: '亮色主题' }, { value: 'dark', label: '暗色主题' }],
      value: editingSide,
      onChange: function (v) {
        editingSide = v
        renderColors()
      }
    })
    left.appendChild(sideSeg.root)
    var COLOR_FIELDS = [
      { key: 'backgroundColor', label: '背景' },
      { key: 'primaryColor', label: '主文本' },
      { key: 'accentColor', label: '强调色' },
      { key: 'secondaryColor', label: '辅助色' }
    ]
    var wellsWrap = Kit.el('div', 'fsw-theme-wells')
    left.appendChild(wellsWrap)
    var nameInput = Kit.textInput({
      value: draft[editingSide].name || '',
      placeholder: '主题名称',
      onCommit: function (v) {
        draft[editingSide].name = v
      }
    })
    left.appendChild(Kit.row('主题名称', nameInput.root))
    body.appendChild(left)

    // 右列：推荐色（封面取色）+ 当前强调色选择
    var right = Kit.el('div', 'fsw-theme-right')
    var accentColorCtl = Kit.colorInput({
      value: draft[editingSide].accentColor,
      onChange: function (v) {
        draft[editingSide].accentColor = v
        renderColors()
      }
    })
    right.appendChild(Kit.row('强调色', accentColorCtl.root, { hint: '高亮、按钮与歌词发光颜色' }))
    var swatchWrap = Kit.el('div', 'fsw-swatch-grid')
    var swatchHint = Kit.el('div', 'fsw-empty-hint', '推荐色加载中…')
    swatchWrap.appendChild(swatchHint)
    right.appendChild(Kit.row('推荐色', swatchWrap, { hint: '来自封面取色，点击设为强调色' }))
    body.appendChild(right)
    dialog.appendChild(body)

    // footer：导入 / 复制 / 重置 / 保存
    var footer = Kit.el('div', 'fsw-modal-foot')
    var importBtn = Kit.el('button', 'fsw-btn', '导入 JSON')
    importBtn.type = 'button'
    var importBox = null
    importBtn.addEventListener('click', function () {
      if (importBox) {
        var text = importBox.value
        var saved = bridge().importAiThemeJson(text)
        if (!saved) {
          importBox.classList.add('invalid')
          return
        }
        // 导入的是双侧 AI 主题：覆盖草稿并保存为对应类型
        draft.light = JSON.parse(JSON.stringify(saved.ai.light))
        draft.dark = JSON.parse(JSON.stringify(saved.ai.dark))
        if (importBox.parentNode) importBox.parentNode.removeChild(importBox)
        importBox = null
        renderColors()
        return
      }
      importBox = document.createElement('textarea')
      importBox.className = 'fsw-import-box'
      importBox.placeholder = '粘贴主题 JSON（{ light: {...}, dark: {...} }）'
      footer.insertBefore(importBox, footer.firstChild)
    })
    footer.appendChild(importBtn)
    var copyBtn = Kit.el('button', 'fsw-btn', '复制 JSON')
    copyBtn.type = 'button'
    copyBtn.addEventListener('click', function () {
      var json = JSON.stringify({ light: draft.light, dark: draft.dark }, null, 2)
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(json).catch(function () { /* 忽略 */ })
      }
    })
    footer.appendChild(copyBtn)
    var spacer = Kit.el('div', 'fsw-modal-spacer')
    footer.appendChild(spacer)
    var resetBtn = Kit.el('button', 'fsw-btn', '重置')
    resetBtn.type = 'button'
    resetBtn.addEventListener('click', function () {
      // 回到打开时的起点
      var fresh = source
      draft.light = JSON.parse(JSON.stringify(fresh.light))
      draft.dark = JSON.parse(JSON.stringify(fresh.dark))
      renderColors()
    })
    footer.appendChild(resetBtn)
    var saveBtn = Kit.el('button', 'fsw-btn primary', '保存主题')
    saveBtn.type = 'button'
    saveBtn.addEventListener('click', function () {
      if (savingMode === 'ai') bridge().saveAiTheme(draft)
      else bridge().saveCustomTheme(draft)
      closeThemeEditor()
      renderTab()
    })
    footer.appendChild(saveBtn)
    dialog.appendChild(footer)
    overlay.appendChild(dialog)
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) closeThemeEditor()
    })
    root.appendChild(overlay)
    themeEditorState.open = true
    themeEditorState.overlay = overlay

    function renderColors() {
      wellsWrap.innerHTML = ''
      COLOR_FIELDS.forEach(function (field) {
        var well = Kit.el('div', 'fsw-theme-well' + (field.key === 'accentColor' ? ' accent' : ''))
        var picker = document.createElement('input')
        picker.type = 'color'
        picker.value = normalizeHex6(draft[editingSide][field.key])
        picker.addEventListener('input', function () {
          draft[editingSide][field.key] = picker.value
          hexText.textContent = picker.value.toUpperCase()
        })
        var hexText = Kit.el('span', 'fsw-theme-hex', String(draft[editingSide][field.key] || '').toUpperCase())
        var labelWrap = Kit.el('div', 'fsw-theme-well-label')
        labelWrap.appendChild(Kit.el('div', 'fsw-theme-well-name', field.label))
        labelWrap.appendChild(hexText)
        well.appendChild(picker)
        well.appendChild(labelWrap)
        wellsWrap.appendChild(well)
      })
      nameInput.setValue(draft[editingSide].name || '')
      accentColorCtl.setValue(normalizeHex6(draft[editingSide].accentColor))
      // 推荐色（封面取色 + 原主题色），异步
      swatchWrap.innerHTML = ''
      swatchWrap.appendChild(Kit.el('div', 'fsw-empty-hint', '推荐色加载中…'))
      bridge().getDualThemeState()
      var recSource = window.FoliaDualTheme
      if (recSource && recSource.recommendedColors) {
        recSource.recommendedColors(getState().coverUrl, draft[editingSide]).then(function (colors) {
          swatchWrap.innerHTML = ''
          colors.forEach(function (color) {
            var swatch = Kit.el('button', 'fsw-swatch')
            swatch.type = 'button'
            swatch.style.background = color
            swatch.title = color
            swatch.addEventListener('click', function () {
              draft[editingSide].accentColor = color
              renderColors()
            })
            swatchWrap.appendChild(swatch)
          })
        })
      }
    }

    renderColors()
  }

  function normalizeHex6(color) {
    var value = String(color || '#000000')
    if (/^#[0-9a-fA-F]{6}$/.test(value)) return value
    if (/^#[0-9a-fA-F]{3}$/.test(value)) {
      return '#' + value.slice(1).split('').map(function (c) { return c + c }).join('')
    }
    return '#000000'
  }

  function closeThemeEditor() {
    if (!themeEditorState.open) return
    if (themeEditorState.overlay && themeEditorState.overlay.parentNode) {
      themeEditorState.overlay.parentNode.removeChild(themeEditorState.overlay)
    }
    themeEditorState.open = false
    themeEditorState.overlay = null
  }

  // ===== 智能动感：当前样式的节拍效果（跟随上游 BeatEffectsGroup） =====
  function renderBeatEffects(colBody, modeId) {
    var fx = window.FoliaBeatFx
    if (!fx) return
    var defs = fx.BEAT_EFFECT_DEFS.filter(function (def) { return def.mode === modeId })
    if (!defs.length) return
    colBody.appendChild(Kit.groupTitle('智能动感 · 节拍效果'))
    var card = Kit.el('div', 'fsw-card')
    if (!fx.smartBeatActive()) {
      card.appendChild(Kit.el('div', 'fsw-empty-hint', '智能动感当前关闭（在「全局」页开启后生效）'))
    }
    defs.forEach(function (def) {
      var settings = fx.getEffectSettings(def.id)
      var toggle = Kit.switchControl({
        value: settings.on,
        onChange: function (next) {
          fx.setEffectSettings(def.id, { on: next })
        }
      })
      card.appendChild(Kit.row(def.label, toggle.root))
      var strength = Kit.slider({
        min: 0, max: 2, step: 0.05, value: settings.strength,
        onDraft: function (v) { fx.setEffectSettings(def.id, { strength: v }) },
        onCommit: function (v) { fx.setEffectSettings(def.id, { strength: v }) }
      })
      card.appendChild(Kit.row('强度', strength.root, { hint: '1 是调校时的样子，0 关闭' }))
    })
    colBody.appendChild(card)
  }

  // 单键 patch（点路径）：交给 FoliaTunings 的 merge 归一化
  function setPathPatch(key, value) {
    var patch = {}
    setPath(patch, key, value)
    return patch
  }

  // ===== 背景页 =====
  function renderBackgroundTab(colBody) {
    var st = getState()
    // 背景类型
    colBody.appendChild(Kit.groupTitle('背景类型'))
    var modeCard = Kit.el('div', 'fsw-card')
    var modeControl = Kit.picture({
      options: window.FoliaBackgrounds.getModeOptions().map(function (m) {
        return { value: m.id, label: m.label }
      }),
      value: st.backgroundMode,
      onChange: function (v) { bridge().setBackgroundMode(v) }
    })
    modeCard.appendChild(modeControl.root)
    colBody.appendChild(modeCard)

    var bgId = st.backgroundMode
    if (bgId === 'transparent') {
      colBody.appendChild(Kit.groupTitle('透明背景'))
      var card = Kit.el('div', 'fsw-card')
      var supported = st.windowBgState && st.windowBgState.activeEnabled === true
      var display = st.transparentOverlay !== null && st.transparentOverlay !== undefined
        ? st.transparentOverlay
        : Math.round((1 - (Number(st.windowBgState && st.windowBgState.opacity) || 1)) * 100)
      var opacityControl = Kit.slider({
        min: 0, max: 100, step: 1,
        value: Math.min(100, Math.max(0, display)),
        onDraft: function () { /* 拖动中仅更新数值显示，宿主通道松手后同步 */ },
        onCommit: function (v) { bridge().setTransparentOverlay(v) }
      })
      var opacityRow = Kit.row('背景透明度', opacityControl.root, { hint: '调整将临时开启主程序窗口背景，退出歌词页后恢复' })
      if (!supported) opacityRow.style.opacity = '0.45'
      card.appendChild(opacityRow)
      var frostControl = Kit.segmented({
        options: [
          { value: 'off', label: '关' },
          { value: 'foreground', label: '仅前台' },
          { value: 'always', label: '始终' }
        ],
        value: (function () {
          var ws = st.windowBgState || {}
          if (!ws.frosted) return 'off'
          return ws.keepOnBlur ? 'always' : 'foreground'
        })(),
        onChange: function (v) { bridge().setTransparentFrost(v) }
      })
      var frostRow = Kit.row('毛玻璃', frostControl.root)
      if (!supported) frostRow.style.opacity = '0.45'
      card.appendChild(frostRow)
      if (!supported) {
        colBody.appendChild(Kit.el('div', 'fsw-empty-hint', '当前环境不支持窗口背景'))
      }
      colBody.appendChild(card)
    } else if (bgId === 'url') {
      colBody.appendChild(Kit.groupTitle('网页背景'))
      var urlCard = Kit.el('div', 'fsw-card')
      var inputWrap = Kit.textInput({
        value: '',
        placeholder: '输入网页地址，如 https://example.com',
        onCommit: function (value) {
          if (bridge().addUrlBgItem(value)) renderTab()
        }
      })
      inputWrap.input.value = ''
      var addRow = Kit.row('添加网页', inputWrap.root)
      urlCard.appendChild(addRow)
      var cfg = bridge().getUrlBgConfig()
      var activeId = (cfg.selectedId && cfg.items.some(function (item) { return item.id === cfg.selectedId }))
        ? cfg.selectedId
        : (cfg.items.length ? cfg.items[0].id : null)
      if (cfg.items.length) {
        cfg.items.forEach(function (item) {
          var itemEl = Kit.el('div', 'fsw-url-item' + (item.id === activeId ? ' active' : ''))
          var urlSpan = Kit.el('span', 'fsw-url-item-url', item.url)
          var delBtn = Kit.el('button', 'fsw-url-item-del', '×')
          delBtn.type = 'button'
          itemEl.appendChild(urlSpan)
          itemEl.appendChild(delBtn)
          itemEl.addEventListener('click', function (e) {
            if (e.target === delBtn) return
            bridge().selectUrlBgItem(item.id)
            rebuildBgPreview()
            renderTab()
          })
          delBtn.addEventListener('click', function (e) {
            e.stopPropagation()
            bridge().removeUrlBgItem(item.id)
            rebuildBgPreview()
            renderTab()
          })
          urlCard.appendChild(itemEl)
        })
      } else {
        urlCard.appendChild(Kit.el('div', 'fsw-url-empty', '暂无网页，先在上方输入地址添加'))
      }
      colBody.appendChild(urlCard)
      colBody.appendChild(Kit.el('div', 'fsw-empty-hint', '部分网站禁止被嵌入，显示空白属正常现象'))
    } else if (bgId === 'sora') {
      colBody.appendChild(Kit.groupTitle('星野'))
      colBody.appendChild(Kit.el('div', 'fsw-empty-hint', '这个背景没有参数'))
    } else {
      // common / latent / monet / nomand：封面色开关（common）+ schema 面板
      var schema = tunings().getBgSchema(bgId)
      var titleMap = { common: '通用背景', latent: '隐现参数', monet: '莫奈背景', nomand: '漫游参数' }
      colBody.appendChild(Kit.groupTitle(titleMap[bgId] || '背景参数'))
      var card = Kit.el('div', 'fsw-card')
      if (bgId === 'common') {
        var coverControl = Kit.switchControl({
          value: st.coverBlur,
          onChange: function (v) { bridge().setCoverBlur(v) }
        })
        card.appendChild(Kit.row('封面色彩', coverControl.root, { hint: '开启后背景叠层使用封面取色' }))
        colBody.appendChild(card)
        if (schema && schema.groups.length) {
          var renderer = Kit.renderSchema(schema, {
            get: function () {
              var tuning = tunings().getBgTuning('common')
              return Object.assign({}, tuning, { useCoverColorBg: getState().coverBlur })
            },
            patch: function (key, value, commit) {
              if (key === 'useCoverColorBg') return
              if (!commit) return
              tunings().setBgTuning('common', setPathPatch(key, value))
              bridge().applyBgTuning('common', tunings().getBgTuning('common'))
              rebuildBgPreview()
            }
          })
          colBody.appendChild(renderer.root)
        }
      } else if (schema && schema.groups.length) {
        colBody.appendChild(card)
        var renderer = Kit.renderSchema(schema, {
          get: function () { return tunings().getBgTuning(bgId) },
          patch: function (key, value, commit) {
            if (!commit) return
            tunings().setBgTuning(bgId, setPathPatch(key, value))
            bridge().applyBgTuning(bgId, tunings().getBgTuning(bgId))
            rebuildBgPreview()
          }
        })
        colBody.appendChild(renderer.root)
      } else {
        colBody.appendChild(card)
        colBody.appendChild(Kit.el('div', 'fsw-empty-hint', '这个背景没有参数'))
      }
    }
    tabRefreshers.background = function () { renderTab() }
  }

  // ===== 字体页 =====
  function renderCommonTab(colBody) {
    var st = getState()
    var appearance = st.appearance
    colBody.appendChild(Kit.groupTitle('预览'))
    var previewCard = Kit.el('div', 'fsw-card')
    var sampleControl = Kit.segmented({
      options: [
        { value: 'default', label: '神文之诗' },
        { value: 'reserved', label: '野芝麻' }
      ],
      value: state.sampleId,
      onChange: function (v) {
        state.sampleId = v
        if (stage) stage.setSampleText(v)
      }
    })
    previewCard.appendChild(Kit.row('预览文本', sampleControl.root, { hint: '仅作用于示例舞台' }))
    colBody.appendChild(previewCard)

    colBody.appendChild(Kit.groupTitle('歌词字体'))
    var fontCard = Kit.el('div', 'fsw-card')
    // 字号缩放（拖动实时作用于示例舞台，松手保存并应用到主页面）
    var scaleControl = Kit.slider({
      min: 0.85, max: 1.4, step: 0.05,
      value: appearance.fontScale,
      onDraft: function (v) {
        if (stage) stage.applyFontScale(v)
      },
      onCommit: function (v) {
        bridge().applyFontScale(v)
        if (stage) stage.applyFontScale(v)
      }
    })
    fontCard.appendChild(Kit.row('字号缩放', scaleControl.root))
    // 字重：自动开关 + 滑条
    var weightAuto = appearance.fontWeight < 100
    var weightControl = Kit.slider({
      min: 100, max: 900, step: 10, integer: true,
      value: weightAuto ? 400 : appearance.fontWeight,
      onDraft: function (v) {
        document.documentElement.style.setProperty('--lyric-font-weight', String(v))
      },
      onCommit: function (v) {
        bridge().applyFontWeight(v)
      }
    })
    var weightAutoControl = Kit.switchControl({
      value: !weightAuto,
      onChange: function (follow) {
        bridge().applyFontWeight(follow ? 0 : weightControl.input.value)
        renderTab()
      }
    })
    var weightRow = Kit.row('字重', weightControl.root)
    if (weightAuto) weightRow.style.opacity = '0.45'
    fontCard.appendChild(Kit.row('跟随样式自动字重', weightAutoControl.root))
    fontCard.appendChild(weightRow)
    colBody.appendChild(fontCard)

    colBody.appendChild(Kit.groupTitle('画面'))
    var visualCard = Kit.el('div', 'fsw-card')
    var opacityControl = Kit.slider({
      min: 0.2, max: 1, step: 0.05,
      value: appearance.visualizerOpacity,
      onDraft: function (v) {
        if (stage) root._refs.stageHost.style.opacity = String(v)
      },
      onCommit: function (v) {
        bridge().applyVisualizerOpacity(v)
        if (stage) root._refs.stageHost.style.opacity = String(v)
      }
    })
    visualCard.appendChild(Kit.row('整体透明度', opacityControl.root))
    colBody.appendChild(visualCard)
    tabRefreshers.common = function () { renderTab() }
  }

  // ===== 字幕页 =====
  function renderSubtitleTab(colBody) {
    var subtitle = getState().appearance.subtitle
    colBody.appendChild(Kit.groupTitle('副歌词'))
    var card = Kit.el('div', 'fsw-card')
    var enabledControl = Kit.switchControl({
      value: subtitle.enabled,
      onChange: function (v) {
        tunings().setAppearance({ subtitle: Object.assign({}, subtitle, { enabled: v }) })
        // 通知当前模式（町景的 NEXT 全息面板随此开关显隐）：主页面实例与预览舞台实例都要跟上
        bridge().onSubtitleEnabledChange(v)
        if (stage) stage.setSubtitleEnabled(v)
        renderTab()
      }
    })
    card.appendChild(Kit.row('显示副歌词', enabledControl.root, { hint: '翻译/罗马音内容跟随主程序歌词页设置' }))
    var opacityControl = Kit.slider({
      min: 0.2, max: 1, step: 0.05,
      value: subtitle.opacity,
      onDraft: function () { /* 拖动中显示数值，松手生效 */ },
      onCommit: function (v) {
        tunings().setAppearance({ subtitle: Object.assign({}, getState().appearance.subtitle, { opacity: v }) })
      }
    })
    card.appendChild(Kit.row('字幕透明度', opacityControl.root))
    var backgroundControl = Kit.switchControl({
      value: subtitle.background,
      onChange: function (v) {
        tunings().setAppearance({ subtitle: Object.assign({}, getState().appearance.subtitle, { background: v }) })
      }
    })
    card.appendChild(Kit.row('字幕背景', backgroundControl.root))
    var blurControl = Kit.switchControl({
      value: subtitle.upcomingBlur,
      onChange: function (v) {
        tunings().setAppearance({ subtitle: Object.assign({}, getState().appearance.subtitle, { upcomingBlur: v }) })
      }
    })
    card.appendChild(Kit.row('下一句歌词模糊', blurControl.root))
    var scaleControl = Kit.slider({
      min: 0.85, max: 1.4, step: 0.05,
      value: subtitle.fontScale,
      onDraft: function () { /* 拖动中显示数值，松手生效 */ },
      onCommit: function (v) {
        tunings().setAppearance({ subtitle: Object.assign({}, getState().appearance.subtitle, { fontScale: v }) })
      }
    })
    card.appendChild(Kit.row('字幕缩放', scaleControl.root))
    colBody.appendChild(card)
    tabRefreshers.subtitle = function () { renderTab() }
  }

  // ===== 全局页 =====
  function renderGlobalTab(colBody) {
    var st = getState()
    renderThemeSection(colBody)
    colBody.appendChild(Kit.groupTitle('歌词过滤'))
    var filterCard = Kit.el('div', 'fsw-card')
    var filterEnabled = st.lyricFilterEnabled !== false
    var filterControl = Kit.segmented({
      options: [
        { value: 'on', label: '开启' },
        { value: 'off', label: '关闭' }
      ],
      value: filterEnabled ? 'on' : 'off',
      onChange: function (v) {
        bridge().setLyricFilterEnabled(v === 'on')
        renderTab()
      }
    })
    filterCard.appendChild(Kit.row('歌词过滤', filterControl.root))
    if (filterEnabled) {
      var displayValue = st.lyricFilterRegex || st.defaultLyricFilterRegex
      var regexControl = Kit.textInput({
        value: displayValue,
        placeholder: '正则表达式（空 = 默认规则）',
        resetLabel: '↺',
        defaultValue: st.defaultLyricFilterRegex,
        onCommit: function (value) {
          bridge().applyLyricFilterRegex(value)
          renderTab()
        }
      })
      filterCard.appendChild(Kit.row('过滤规则', regexControl.root, { hint: '命中的行会被隐藏' }))
    }
    colBody.appendChild(filterCard)

    colBody.appendChild(Kit.groupTitle('歌词时间'))
    var timeCard = Kit.el('div', 'fsw-card')
    var offset = st.lyricTimeOffset
    var minus = Kit.el('button', 'fsw-mini-btn', '−')
    minus.type = 'button'
    minus.title = '歌词延后 0.1 秒'
    minus.disabled = offset <= -10
    var value = Kit.el('span', 'fsw-stepper-value', formatOffset(offset))
    var plus = Kit.el('button', 'fsw-mini-btn', '+')
    plus.type = 'button'
    plus.title = '歌词提前 0.1 秒'
    plus.disabled = offset >= 10
    var stepper = Kit.el('div', 'fsw-stepper')
    stepper.appendChild(minus)
    stepper.appendChild(value)
    stepper.appendChild(plus)
    minus.addEventListener('click', function () { bridge().setLyricTimeOffset(offset - 0.1) })
    plus.addEventListener('click', function () { bridge().setLyricTimeOffset(offset + 0.1) })
    timeCard.appendChild(Kit.row('时间矫正', stepper, { hint: '+ 提前 / − 延后，仅影响歌词时间轴' }))
    colBody.appendChild(timeCard)

    // 智能动感总开关（上游 SmartBeatSettingsCard）：开启后各样式「动画」页的节拍效果生效
    var fx = window.FoliaBeatFx
    if (fx) {
      colBody.appendChild(Kit.groupTitle('智能动感'))
      var beatCard = Kit.el('div', 'fsw-card')
      var beatOn = fx.getMode() === 'on'
      var beatControl = Kit.segmented({
        options: [
          { value: 'off', label: '关闭' },
          { value: 'on', label: '开启' }
        ],
        value: beatOn ? 'on' : 'off',
        onChange: function (v) {
          fx.setMode(v)
          renderTab()
        }
      })
      beatCard.appendChild(Kit.row('智能动感', beatControl.root, {
        hint: '跟随歌曲节拍驱动样式效果（主程序频谱实时检测节拍与鼓点）；各样式的效果在其「动画」页配置'
      }))
      colBody.appendChild(beatCard)
    }
    tabRefreshers.global = function () { renderTab() }
  }

  function formatOffset(v) {
    var s = Math.round(Number(v) * 10) / 10
    return (s > 0 ? '+' : (s < 0 ? '−' : '')) + Math.abs(s).toFixed(1) + 's'
  }

  var TAB_RENDERERS = {
    visualizer: renderVisualizerTab,
    background: renderBackgroundTab,
    common: renderCommonTab,
    subtitle: renderSubtitleTab,
    global: renderGlobalTab
  }

  // ===== 主题变量 =====
  function syncThemeVars() {
    var st = getState()
    var theme = st.theme || {}
    // 设置窗口深浅色 token（照上游 settings kit 的 --st-* 体系）：表面色深浅两套固定值按 daylight 切，
    // 文字/线/填充在 CSS 里跟随 --text-primary 做 color-mix；accent 取主题强调色，on-accent 按对比度选深/白
    var dual = bridge().getDualThemeState()
    var daylight = Boolean(dual && dual.daylight)
    var accent = theme.accentColor || (daylight ? '#18181b' : '#f4f4f5')
    var onAccent = '#ffffff'
    var math = window.FoliaThemeColorMath
    if (math && math.getContrastRatio) {
      var dark = '#17171a'
      onAccent = math.getContrastRatio(dark, accent) >= math.getContrastRatio('#ffffff', accent) ? dark : '#ffffff'
    }
    // 变量必须设在窗口元素自身：.fsw-win 规则里带着深色默认值，CSS 变量解析时
    // 元素自身的定义优先于从祖先继承，设在 .fsw-root 上会被默认值永远压住
    var set = root._refs.win.style
    set.setProperty('--text-primary', daylight ? '#18181b' : '#f4f4f5')
    set.setProperty('--st-win', daylight ? '#f3f3f4' : '#1a1a1d')
    set.setProperty('--st-side', daylight ? '#e9e9eb' : '#141416')
    set.setProperty('--st-card', daylight ? '#ffffff' : '#232327')
    set.setProperty('--st-menu', daylight ? '#ffffff' : '#2b2b30')
    set.setProperty('--st-raise', daylight ? '#ffffff' : '#45454c')
    set.setProperty('--st-knob', daylight ? '#ffffff' : '#ececee')
    set.setProperty('--st-pv', daylight ? '#ececef' : '#151517')
    set.setProperty('--st-err', daylight ? '#d04444' : '#ef6f6f')
    set.setProperty('--fsw-accent', accent)
    set.setProperty('--fsw-on-accent', onAccent)
    root._refs.stageBox.style.setProperty('--fsw-stage-bg', theme.backgroundColor || '#09090b')
  }

  // ===== 开关窗 =====
  function open() {
    if (state.open) return
    if (!root) buildDom()
    state.open = true
    state.tab = 'visualizer'
    state.source = 'builtin'
    state.paused = false
    root.style.display = 'flex'
    syncThemeVars()
    // 主页面渲染暂停（GPU 让给预览舞台）
    bridge().setMainModePaused(true)
    // 舞台：当前样式 + 已保存 tuning + 已保存背景
    var st = getState()
    ensureStage()
    stage.setSource('builtin')
    stage.setMode(st.animMode, tunings().getModeTuning(st.animMode))
    rebuildBgPreview()
    root._refs.builtinBtn.classList.add('active')
    root._refs.liveBtn.classList.remove('active')
    renderShelf()
    switchTab('visualizer')
  }

  function close() {
    if (!state.open) return
    state.open = false
    bridge().setMainModePaused(false)
    destroyBgPreview()
    if (stage) {
      stage.destroy()
      stage = null
    }
    if (root) root.style.display = 'none'
  }

  // ===== 桥接回调（bridge 状态变化时刷新窗口） =====
  window.FoliaStyleWindow = {
    open: open,
    close: close,
    isOpen: function () { return state.open },
    onModeChange: function () {
      if (!state.open) return
      refreshShelfActive()
      if (state.tab === 'visualizer') renderTab()
      var st = getState()
      if (stage) stage.setMode(st.animMode, tunings().getModeTuning(st.animMode))
    },
    onBackgroundChange: function () {
      if (!state.open) return
      rebuildBgPreview()
      if (state.tab === 'background') renderTab()
    },
    onCoverBlurChange: function () {
      if (!state.open) return
      if (state.tab === 'background') renderTab()
    },
    onTransparentStateChange: function () {
      if (!state.open) return
      if (state.tab === 'background') renderTab()
    },
    onLyricSettingsChange: function () {
      if (!state.open) return
      if (state.tab === 'global') renderTab()
    },
    onAppearanceChange: function () {
      if (!state.open) return
      if (state.tab === 'common') renderTab()
    },
    // 主题来源/深浅色/主题内容变化（bridge refreshTheme 触发）：舞台换主题 + 界面变量同步
    onThemeSourceChange: function () {
      if (!state.open) return
      syncThemeVars()
      var st = getState()
      if (stage && st.theme) stage.setTheme(st.theme)
      rebuildBgPreview()
      thumbCache = {}
      renderShelf()
      if (state.tab === 'global' || state.tab === 'common') renderTab()
    }
  }
})()
