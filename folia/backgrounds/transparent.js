// 透明背景：不绘制任何内容，直接透出宿主窗口的毛玻璃/透明材质。
// scrim 参照主程序歌词页背景（src/renderer/style.css）：
//   - 毛玻璃（app-background-frosted）：固定 rgba(0,0,0,0.55)，不随透明度滑杆弱化
//   - 透明窗口（app-background-enabled 且非毛玻璃）：同色 scrim，按宿主 --app-background-opacity 弱化
//   - 宿主未开启窗口背景：回退不透明 #09090b（无材质可透，保持可用）
// 窗口背景状态由宿主经 echo-folia:window-background 消息推送：{ enabled, frosted, opacity, keepOnBlur }
// 插件设置菜单的「背景透明度」滑块经 setOverlayOpacity 注入覆盖值（0~100，越大越透）：
//   - 未设置时维持主程序行为；设置后 scrim 透明度完全由滑块决定（毛玻璃开启时同样生效）
//   - 覆盖值仅作用于本背景实例的 scrim，不回写宿主，主程序透明度保持原值
(function () {
  'use strict'

  function create(config) {
    var host = null
    var scrim = null
    var state = normalizeState(config && config.windowBg)
    var overlay = normalizeOverlay(config && config.overlayOpacity)

    // 归一化滑块覆盖值：0~100 之外的值视为未设置（跟随宿主）
    function normalizeOverlay(value) {
      var num = Number(value)
      return Number.isFinite(num) && num >= 0 && num <= 100 ? num : null
    }

    // 归一化窗口背景状态，字段缺失时按「未开启」处理（回退不透明底）
    function normalizeState(raw) {
      var s = raw || {}
      return {
        enabled: s.enabled === true,
        frosted: s.frosted === true,
        opacity: Number.isFinite(Number(s.opacity)) ? Math.min(1, Math.max(0, Number(s.opacity))) : 1
      }
    }

    // 按窗口背景状态更新 scrim 外观
    function apply() {
      if (!scrim) return
      // 滑块覆盖值优先：滑块值即「背景透明度」（0=不透明纯黑，100=全透），直接决定 scrim 有效 alpha。
      // 宿主未开窗口背景时也照常渲染——滑块拖动/自动接管会让宿主临时开透明，此处先乐观呈现，
      // 避免接管生效前 scrim 跳回不透明底造成闪变
      if (overlay !== null) {
        var alpha = Math.min(1, Math.max(0, 1 - overlay / 100))
        scrim.style.background = 'rgba(0, 0, 0, ' + alpha + ')'
        scrim.style.opacity = '1'
        return
      }
      if (!state.enabled) {
        // 宿主未开启窗口背景：无原生材质可透，回退不透明深色底
        scrim.style.background = '#09090b'
        scrim.style.opacity = '1'
        return
      }
      if (state.frosted) {
        // 毛玻璃：与主程序歌词页同款固定 scrim，独立于透明度滑杆
        scrim.style.background = 'rgba(0, 0, 0, 0.55)'
        scrim.style.opacity = '1'
      } else {
        // 透明窗口：按宿主背景透明度弱化，让桌面/下层内容透出
        scrim.style.background = 'rgba(0, 0, 0, 0.55)'
        scrim.style.opacity = String(state.opacity)
      }
    }

    return {
      id: 'transparent',
      // 挂载：创建 scrim 层；iframe 根元素让出背景以透出窗口材质
      mount: function (hostEl) {
        host = hostEl
        scrim = document.createElement('div')
        scrim.className = 'folia-bg-transparent-scrim'
        // 慢速过渡与主程序 lyric-background 的 background-color 过渡一致，避免跳变
        scrim.style.cssText =
          'position:absolute;inset:0;pointer-events:none;' +
          'transition:background-color 0.5s ease,opacity 0.5s ease;'
        host.appendChild(scrim)
        apply()
        document.documentElement.classList.add('folia-bg-transparent')
        document.body.classList.add('folia-bg-transparent')
      },
      // 宿主窗口背景状态变化（消息实时推送）时更新 scrim
      setWindowBg: function (next) {
        state = normalizeState(next)
        apply()
      },
      // 设置菜单滑块注入的覆盖透明度（0~100，null/undefined 表示跟随宿主）
      setOverlayOpacity: function (value) {
        overlay = normalizeOverlay(value)
        apply()
      },
      setTheme: function () { /* 透明背景不消费主题 */ },
      setCoverUrl: function () { /* 透明背景不消费封面 */ },
      tick: function () { /* 透明背景无逐帧逻辑 */ },
      destroy: function () {
        if (scrim && scrim.parentNode) scrim.parentNode.removeChild(scrim)
        scrim = null
        host = null
        // 切走时还原 iframe 根背景，避免其他背景模式被透明根层影响
        document.documentElement.classList.remove('folia-bg-transparent')
        document.body.classList.remove('folia-bg-transparent')
      }
    }
  }

  window.FoliaBgTransparent = { create: create }
})()
