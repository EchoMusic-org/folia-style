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
      // 缩略图懒绘制（缓存 dataURL）
      var key = mode.id
      if (thumbCache[key]) {
        drawThumbFromCache(canvas, thumbCache[key])
      } else {
        drawThumb(canvas, mode.id, st.theme, false)
        thumbCache[key] = canvas.toDataURL()
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
    tabRefreshers.visualizer = function () { renderTab() }
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
    root.style.setProperty('--fsw-accent', theme.accentColor || '#00f5d4')
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
  }
})()
