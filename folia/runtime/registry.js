// 模式注册表：替代 bridge.html 中硬编码的 modeMap，对齐 folia-major 的 visualizer registry。
// 13 种歌词动画模式；旧 localStorage id 自动映射到新 id。
// 每个模式暴露统一生命周期：create() → { id, mount, setTheme, setLines, tick, destroy, [setFontScale] }
(function () {
  'use strict'

  // vendor 库清单：按需懒加载（原版对应 React.lazy 的模式级懒加载）
  var VENDOR_LIBS = {
    pixi: { file: 'vendor/pixi.min.js', globalCheck: function () { return window.PIXI } },
    three: { file: 'vendor/three.iife.js', globalCheck: function () { return window.THREE } },
    pretext: { file: 'vendor/pretext.iife.js', globalCheck: function () { return window.Pretext } },
    paperShaders: { file: 'vendor/paper-shaders.iife.js', globalCheck: function () { return window.PaperShaders } },
    twgl: { file: 'vendor/twgl-full.min.js', globalCheck: function () { return window.twgl } }
  }

  // 13 种模式定义（order 沿用原版 BUILTIN_VISUALIZER_MODES）
  // file 可为单个路径或路径数组（大体量模式按模块拆分，按数组顺序加载）
  var MODES = [
    // 商籁为大体量模式，拆分为 sonnet/ 目录下多个模块文件，按数组顺序加载
    // （core → program → 版式 → 滤镜 → 装饰 → MG 变体 → 文本 → 场景 → 运行时 → 入口）
    { id: 'sonnet', legacyIds: [], label: '商籁', file: [
      'modes/sonnet/sonnet-core.js',
      'modes/sonnet/sonnet-program.js',
      'modes/sonnet/sonnet-flow-layouts.js',
      'modes/sonnet/sonnet-typography.js',
      'modes/sonnet/sonnet-filters.js',
      'modes/sonnet/sonnet-decor.js',
      'modes/sonnet/sonnet-mg-themed.js',
      'modes/sonnet/sonnet-mg-open.js',
      'modes/sonnet/sonnet-mg-extended.js',
      'modes/sonnet/sonnet-mg-extended-b.js',
      'modes/sonnet/sonnet-mg.js',
      'modes/sonnet/sonnet-text.js',
      'modes/sonnet/sonnet-scene.js',
      'modes/sonnet/sonnet-runtime.js',
      'modes/sonnet.js'
    ], globalName: 'FoliaModeSonnet', vendor: ['pixi', 'pretext'], order: 10, majorId: 'sonnet' },
    { id: 'tempera', legacyIds: [], label: '凝彩', file: [
      // 前置复用的 sonnet 模块：字体栈/纹理池/显示树回收（core）与镜头/印刷 GLSL 滤镜
      'modes/sonnet/sonnet-core.js',
      'modes/sonnet/sonnet-filters.js',
      // 凝彩本体：core（常量/随机/缓动/运动/镜头/转场/入场）→ 档案 → 几何 → 度量排版
      // → 调色板/反色 → 图形工厂 → 构图四册 → 程序编译 → 场景 → 运行时 → 入口
      'modes/tempera/tempera-core.js',
      'modes/tempera/tempera-profiles.js',
      'modes/tempera/tempera-curves.js',
      'modes/tempera/tempera-measure.js',
      'modes/tempera/tempera-palette.js',
      'modes/tempera/tempera-shapes.js',
      'modes/tempera/tempera-compositions-a.js',
      'modes/tempera/tempera-compositions-b.js',
      'modes/tempera/tempera-compositions-c.js',
      'modes/tempera/tempera-compositions-d.js',
      'modes/tempera/tempera-program.js',
      'modes/tempera/tempera-scene.js',
      'modes/tempera/tempera-runtime.js',
      'modes/tempera.js'
    ], globalName: 'FoliaModeTempera', vendor: ['pixi', 'pretext'], order: 20, majorId: 'tempera' },
    { id: 'classic', legacyIds: ['liuguang'], label: '流光', file: 'modes/classic.js', globalName: 'FoliaModeClassic', vendor: [], order: 30, majorId: 'classic' },
    { id: 'cadenza', legacyIds: ['xinxiang'], label: '心象', file: 'modes/cadenza.js', globalName: 'FoliaModeCadenza', vendor: ['pretext'], order: 40, majorId: 'cadenza' },
    { id: 'partita', legacyIds: ['yunjie'], label: '云阶', file: 'modes/partita.js', globalName: 'FoliaModePartita', vendor: [], order: 50, majorId: 'partita' },
    { id: 'fume', legacyIds: ['fuming'], label: '浮名', file: 'modes/fume.js', globalName: 'FoliaModeFume', vendor: ['pretext'], order: 60, majorId: 'fume' },
    { id: 'tilt', legacyIds: ['qingsu'], label: '倾诉', file: 'modes/tilt.js', globalName: 'FoliaModeTilt', vendor: ['pretext'], order: 70, majorId: 'tilt' },
    { id: 'claddagh', legacyIds: [], label: '回环', file: 'modes/claddagh.js', globalName: 'FoliaModeCladdagh', vendor: ['pretext'], order: 80, majorId: 'claddagh' },
    { id: 'monet', legacyIds: ['monet'], label: '莫奈', file: 'modes/monet.js', globalName: 'FoliaModeMonet', vendor: ['pretext'], order: 90, majorId: 'monet' },
    { id: 'pendolo', legacyIds: [], label: '时计', file: ['modes/pendolo-core.js', 'modes/pendolo.js'], globalName: 'FoliaModePendolo', vendor: ['pretext'], order: 100, majorId: 'pendolo' },
    { id: 'cappella', legacyIds: [], label: '群唱', file: 'modes/cappella.js', globalName: 'FoliaModeCappella', vendor: ['pretext'], order: 110, majorId: 'cappella' },
    // 镜台为大体量 three 模式，拆分为 diorama/ 目录下多个模块文件，按数组顺序加载
    // （core 数学 → 序列器 → 粒子系统 → 文本光栅 → 粒子场 → 相机 → 场景 → 入口）
    { id: 'diorama', legacyIds: [], label: '镜台', file: [
      'modes/diorama/diorama-core.js',
      'modes/diorama/diorama-sequencer.js',
      'modes/diorama/diorama-particles.js',
      'modes/diorama/diorama-text.js',
      'modes/diorama/diorama-field.js',
      'modes/diorama/diorama-camera.js',
      'modes/diorama/diorama-scene.js',
      'modes/diorama.js'
    ], globalName: 'FoliaModeDiorama', vendor: ['three'], order: 120, majorId: 'diorama' },
    { id: 'still', legacyIds: [], label: '静止', file: 'modes/still.js', globalName: 'FoliaModeStill', vendor: [], order: 130, majorId: 'still' }
  ]

  var loadedScripts = {}      // file → Promise
  var activeMode = null       // 当前模式实例
  var activeDef = null
  var loadingPromise = null   // 切换中防并发

  function byId(id) {
    for (var i = 0; i < MODES.length; i += 1) {
      if (MODES[i].id === id) return MODES[i]
    }
    return null
  }

  // 旧 id（yunjie/liuguang/xinxiang/fuming/qingsu/monet）映射到新 id
  function resolveId(storedId) {
    if (!storedId) return 'classic'
    var def = byId(storedId)
    if (def) return def.id
    for (var i = 0; i < MODES.length; i += 1) {
      if (MODES[i].legacyIds.indexOf(storedId) >= 0) return MODES[i].id
    }
    return 'classic'
  }

  function loadScript(file) {
    if (loadedScripts[file]) return loadedScripts[file]
    loadedScripts[file] = new Promise(function (resolve, reject) {
      var script = document.createElement('script')
      script.src = file
      script.onload = function () { resolve() }
      script.onerror = function () {
        delete loadedScripts[file]
        reject(new Error('加载失败: ' + file))
      }
      document.head.appendChild(script)
    })
    return loadedScripts[file]
  }

  async function loadVendor(vendorNames) {
    for (var i = 0; i < vendorNames.length; i += 1) {
      var lib = VENDOR_LIBS[vendorNames[i]]
      if (!lib) continue
      if (!lib.globalCheck()) await loadScript(lib.file)
    }
  }

  async function loadModeFiles(files) {
    var list = Array.isArray(files) ? files : [files]
    for (var i = 0; i < list.length; i += 1) {
      await loadScript(list[i])
    }
  }

  /**
   * 切换模式（幂等）：加载 vendor + 模式脚本 → 销毁旧实例 → 挂载新实例
   * 返回 Promise<modeInstance>
   */
  async function switchMode(id, hostEl, sharedState) {
    var def = byId(resolveId(id))
    if (!def) return Promise.reject(new Error('未知模式: ' + id))
    if (activeDef && activeDef.id === def.id && activeMode) return activeMode

    while (loadingPromise) {
      try { await loadingPromise } catch (e) { /* 继续排队 */ }
      if (activeDef && activeDef.id === def.id && activeMode) return activeMode
    }

    loadingPromise = (async function () {
      destroyActive()

      await loadVendor(def.vendor)
      await loadModeFiles(def.file)

      var factory = window[def.globalName]
      if (!factory || typeof factory.create !== 'function') {
        throw new Error('模式缺少工厂: ' + def.globalName)
      }

      var instance = factory.create()
      instance.id = def.id
      instance.mount(hostEl)
      if (sharedState) {
        if (instance.setTheme && sharedState.theme) instance.setTheme(sharedState.theme)
        if (instance.setLines && sharedState.lines) instance.setLines(sharedState.lines)
        if (instance.setFontScale && sharedState.fontScale !== undefined) instance.setFontScale(sharedState.fontScale)
      }

      activeMode = instance
      activeDef = def
      return instance
    })()

    try {
      var result = await loadingPromise
      return result
    } finally {
      loadingPromise = null
    }
  }

  function destroyActive() {
    if (activeMode) {
      try { activeMode.destroy() } catch (e) { /* 防止单模式销毁失败阻塞切换 */ }
      activeMode = null
    }
    activeDef = null
  }

  function getActive() {
    return activeMode ? { instance: activeMode, def: activeDef } : null
  }

  // 设置菜单选项列表（按 order 排序）
  function getModeOptions() {
    return MODES.slice().sort(function (a, b) { return a.order - b.order }).map(function (def) {
      return { id: def.id, label: def.label, majorId: def.majorId }
    })
  }

  window.FoliaRegistry = {
    MODES: MODES,
    VENDOR_LIBS: VENDOR_LIBS,
    byId: byId,
    resolveId: resolveId,
    switchMode: switchMode,
    destroyActive: destroyActive,
    getActive: getActive,
    getModeOptions: getModeOptions,
    loadScript: loadScript
  }
})()
