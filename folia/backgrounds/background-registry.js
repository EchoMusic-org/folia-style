// 背景注册表：移植自 folia-major src/components/visualizer/backgrounds/{definition,registry}.tsx
// 6 种背景模式：common（底色+流体封面+几何）、latent、monet、nomand、sora、url。
// 背景实例接口：{ id, mount(hostEl), setTheme(theme), setCoverUrl(url), tick(frameState), destroy() }
// frameState: { audioPower(0~1), audioBands({bass,lowMid,mid,vocal,treble} 0~1), isPlaying, dt, coverUrl }
// 注意：原版音频值域为 0~255，本插件统一 0~1，背景内部按需 ×255 还原原版公式。
(function () {
  'use strict'

  var MODES = [
    { id: 'common', label: '通用', file: ['backgrounds/common.js'], globalName: 'FoliaBgCommon', order: 10 },
    { id: 'latent', label: 'Latent', file: ['backgrounds/latent.js'], globalName: 'FoliaBgLatent', order: 20 },
    { id: 'monet', label: '莫奈', file: ['backgrounds/monet-bg.js'], globalName: 'FoliaBgMonet', order: 30 },
    { id: 'nomand', label: 'Nomand', file: ['backgrounds/nomand.js'], globalName: 'FoliaBgNomand', order: 40 },
    { id: 'sora', label: '星野', file: ['backgrounds/sora.js'], globalName: 'FoliaBgSora', vendor: ['twgl'], order: 50 },
    { id: 'url', label: '网页', file: ['backgrounds/url.js'], globalName: 'FoliaBgUrl', order: 60 }
  ]

  var loadedScripts = {}
  var activeBg = null
  var activeDef = null
  var loadingPromise = null

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

  async function loadFiles(files) {
    var list = Array.isArray(files) ? files : [files]
    for (var i = 0; i < list.length; i += 1) await loadScript(list[i])
  }

  async function loadVendor(names) {
    var VENDOR = {
      twgl: { file: 'vendor/twgl-full.min.js', check: function () { return window.twgl } }
    }
    for (var i = 0; i < names.length; i += 1) {
      var lib = VENDOR[names[i]]
      if (lib && !lib.check()) await loadScript(lib.file)
    }
  }

  function byId(id) {
    for (var i = 0; i < MODES.length; i += 1) {
      if (MODES[i].id === id) return MODES[i]
    }
    return null
  }

  function resolveId(id) {
    return byId(id) ? id : 'common'
  }

  function destroyActive() {
    if (activeBg) {
      try { activeBg.destroy() } catch (e) { /* 防止单背景销毁失败阻塞切换 */ }
      activeBg = null
    }
    activeDef = null
  }

  /**
   * 切换背景（幂等）：加载 vendor + 脚本 → 销毁旧实例 → 挂载新实例
   * sharedState: { theme, coverUrl, seed, config }（config 为各背景的配置项，默认值在模式内）
   */
  async function switchBackground(id, hostEl, sharedState) {
    var def = byId(resolveId(id))
    if (!def) return Promise.reject(new Error('未知背景: ' + id))
    if (activeDef && activeDef.id === def.id && activeBg) return activeBg

    while (loadingPromise) {
      try { await loadingPromise } catch (e) { /* 排队 */ }
      if (activeDef && activeDef.id === def.id && activeBg) return activeBg
    }

    loadingPromise = (async function () {
      destroyActive()

      if (def.vendor) await loadVendor(def.vendor)
      await loadFiles(def.file)

      var factory = window[def.globalName]
      if (!factory || typeof factory.create !== 'function') {
        throw new Error('背景缺少工厂: ' + def.globalName)
      }

      var instance = factory.create(sharedState && sharedState.config)
      instance.id = def.id
      instance.mount(hostEl)
      if (sharedState) {
        if (instance.setTheme && sharedState.theme) instance.setTheme(sharedState.theme)
        if (instance.setCoverUrl && sharedState.coverUrl !== undefined) instance.setCoverUrl(sharedState.coverUrl)
      }

      activeBg = instance
      activeDef = def
      return instance
    })()

    try {
      return await loadingPromise
    } finally {
      loadingPromise = null
    }
  }

  function getActive() {
    return activeBg ? { instance: activeBg, def: activeDef } : null
  }

  function getModeOptions() {
    return MODES.slice().sort(function (a, b) { return a.order - b.order }).map(function (def) {
      return { id: def.id, label: def.label }
    })
  }

  window.FoliaBackgrounds = {
    MODES: MODES,
    byId: byId,
    resolveId: resolveId,
    switchBackground: switchBackground,
    destroyActive: destroyActive,
    getActive: getActive,
    getModeOptions: getModeOptions
  }
})()
