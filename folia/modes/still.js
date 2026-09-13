// 静止模式：移植自 folia-major src/components/visualizer/still/VisualizerStill.tsx
// 低占用静态展示：径向暗角 + 居中三行歌词（上/下一行淡显），无逐字动画。
// 模式接口：mount/setTheme/setLines/tick/destroy（由 registry 统一调度）。
(function () {
  'use strict'

  function createMode() {
    var host = null
    var layer = null
    var vignette = null
    var rows = []        // [{lineEl, transEl, emptyEl}]
    var effectiveIndex = 0
    var state = {
      lines: [],
      theme: null,
      fontScale: 1
    }

    function mount(hostEl) {
      host = hostEl

      layer = document.createElement('div')
      layer.className = 'folia-mode-still'
      layer.style.cssText = [
        'position:absolute', 'inset:0', 'z-index:10',
        'display:flex', 'flex-direction:column', 'align-items:center', 'justify-content:center',
        'padding:0 48px 64px', 'gap:32px', 'pointer-events:none'
      ].join(';')

      vignette = document.createElement('div')
      vignette.style.cssText = [
        'position:absolute', 'inset:0', 'z-index:0', 'pointer-events:none',
        'opacity:0.65',
        'background:radial-gradient(ellipse at center, transparent 0%, #000 100%)'
      ].join(';')

      host.appendChild(vignette)
      host.appendChild(layer)

      // 三行占位：offset -1 / 0 / +1
      for (var i = 0; i < 3; i += 1) {
        var row = document.createElement('div')
        row.style.cssText = [
          'display:flex', 'flex-direction:column', 'align-items:center',
          'width:100%', 'max-width:56rem'
        ].join(';')

        var lineEl = document.createElement('div')
        lineEl.style.cssText = [
          'text-align:center', 'letter-spacing:0.02em', 'line-height:1.25',
          'text-shadow:0 4px 6px rgba(0,0,0,0.4)', 'width:100%'
        ].join(';')

        var transEl = document.createElement('div')
        transEl.style.cssText = [
          'text-align:center', 'letter-spacing:0.025em', 'text-shadow:0 2px 4px rgba(0,0,0,0.4)'
        ].join(';')

        row.appendChild(lineEl)
        row.appendChild(transEl)
        layer.appendChild(row)
        rows.push({ lineEl: lineEl, transEl: transEl })
      }
    }

    function setTheme(theme) {
      state.theme = theme
      render()
    }

    function setLines(lines) {
      state.lines = lines || []
    }

    function setFontScale(scale) {
      state.fontScale = scale === undefined ? 1 : scale
      render()
    }

    function fontWeight(base) {
      var theme = state.theme
      var weight = theme && typeof theme.fontWeight === 'number' && Number.isFinite(theme.fontWeight)
        ? Math.min(900, Math.max(100, Math.round(theme.fontWeight / 10) * 10))
        : null
      return weight === null ? base : weight
    }

    function fontFamily() {
      return window.foliaGetLyricFontFamily
        ? window.foliaGetLyricFontFamily()
        : (state.theme && state.theme.fontFamily) || 'sans-serif'
    }

    // 三行渲染（等价原版 render：effectiveIndex-1..+1）
    function render() {
      if (!layer || !state.theme) return
      var theme = state.theme
      var fs = state.fontScale
      var lines = state.lines

      for (var i = 0; i < 3; i += 1) {
        var offset = i - 1
        var lineIndex = effectiveIndex + offset
        var row = rows[i]
        var line = lines[lineIndex]

        if (!line) {
          row.lineEl.textContent = ''
          row.lineEl.style.minHeight = (5 * fs) + 'rem'
          row.transEl.textContent = ''
          continue
        }

        var isCurrent = offset === 0
        row.lineEl.style.minHeight = '0'
        row.lineEl.textContent = line.fullText || ''
        row.lineEl.style.color = theme.primaryColor
        row.lineEl.style.fontFamily = fontFamily()
        row.lineEl.style.fontWeight = String(fontWeight(isCurrent ? 700 : 600))
        row.lineEl.style.fontSize = isCurrent ? (2.5 * fs) + 'rem' : (1.875 * fs) + 'rem'
        row.lineEl.style.opacity = isCurrent ? '1' : '0.3'

        if (line.translation && line.translation.length) {
          row.transEl.textContent = line.translation
          row.transEl.style.color = theme.secondaryColor
          row.transEl.style.fontFamily = fontFamily()
          row.transEl.style.fontWeight = String(fontWeight(isCurrent ? 500 : 400))
          row.transEl.style.fontSize = isCurrent ? (1.5 * fs) + 'rem' : (1.25 * fs) + 'rem'
          row.transEl.style.opacity = isCurrent ? '0.8' : '0.3'
          row.transEl.style.marginTop = isCurrent ? '12px' : '8px'
        } else {
          row.transEl.textContent = ''
        }
      }
    }

    // 每帧：仅当行索引变化时重渲（无逐字动画）
    function tick(frameState) {
      var index = frameState.currentLineIndex
      if (index !== -1) {
        if (index !== effectiveIndex) {
          effectiveIndex = index
          render()
        }
      } else if (effectiveIndex >= state.lines.length) {
        effectiveIndex = 0
        render()
      }
    }

    function destroy() {
      if (vignette) { vignette.remove(); vignette = null }
      if (layer) { layer.remove(); layer = null }
      rows = []
      host = null
    }

    return {
      id: 'still',
      mount: mount,
      setTheme: setTheme,
      setLines: setLines,
      setFontScale: setFontScale,
      tick: tick,
      destroy: destroy
    }
  }

  window.FoliaModeStill = { create: createMode }
})()
