// 网页背景：移植自 folia-major src/components/visualizer/backgrounds/url/UrlBackgroundLayer.tsx
// 用 iframe 渲染网页作为背景；URL 变化时强制重建 iframe；容器有尺寸后才挂载 iframe；
// 顶部半透明渐变保证歌词可读性。
// 配置：{ items: [{id, url, note}], selectedId }（folia-style 设置菜单提供 URL 列表）
(function () {
  'use strict'

  var DEFAULT_CONFIG = { items: [], selectedId: null }

  function sanitizeItem(item) {
    if (!item || typeof item !== 'object') return null
    var url = typeof item.url === 'string' ? item.url.trim() : ''
    if (!url) return null
    return { id: String(item.id || url), url: url, note: typeof item.note === 'string' ? item.note : '' }
  }

  function create(config) {
    var cfg = Object.assign({}, DEFAULT_CONFIG, config || {})

    var host = null
    var root = null
    var iframe = null
    var currentUrl = null

    function mount(hostEl) {
      host = hostEl

      root = document.createElement('div')
      root.style.cssText = 'position:absolute;inset:0;z-index:0;overflow:hidden'
      host.appendChild(root)

      // 等 CSS 布局生效后再挂 iframe（原版 ready 门控等价：零尺寸时嵌入页脚本会初始化失败）
      requestAnimationFrame(function () {
        if (!root) return
        applySelected()
      })
    }

    function applySelected() {
      var selectedItem = null
      for (var i = 0; i < cfg.items.length; i += 1) {
        if (cfg.items[i].id === cfg.selectedId) {
          selectedItem = sanitizeItem(cfg.items[i])
          break
        }
      }
      if (!selectedItem) selectedItem = sanitizeItem(cfg.items[0])

      var url = selectedItem ? selectedItem.url : null
      if (url === currentUrl) return
      currentUrl = url

      if (iframe) { iframe.remove(); iframe = null }
      if (!url) return

      // 覆盖层（保证可读性）垫底
      var overlay = document.createElement('div')
      overlay.style.cssText = [
        'position:absolute', 'inset:0', 'pointer-events:none',
        'background:linear-gradient(to bottom, rgba(0,0,0,0.15), rgba(0,0,0,0.35))'
      ].join(';')

      iframe = document.createElement('iframe')
      iframe.src = url
      iframe.title = (selectedItem && selectedItem.note) || url
      iframe.setAttribute('sandbox', 'allow-scripts')
      iframe.setAttribute('allowfullscreen', '')
      iframe.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;border:0;pointer-events:none'
      root.appendChild(iframe)
      root.appendChild(overlay)
    }

    function setTheme() { /* 网页背景不使用主题色 */ }

    function setCoverUrl() { /* 不使用封面 */ }

    function tick() { /* 无逐帧逻辑 */ }

    function destroy() {
      if (root) { root.remove(); root = null }
      iframe = null
      currentUrl = null
      host = null
    }

    return {
      id: 'url',
      mount: mount,
      setTheme: setTheme,
      setCoverUrl: setCoverUrl,
      tick: tick,
      destroy: destroy
    }
  }

  window.FoliaBgUrl = { create: create }
})()
