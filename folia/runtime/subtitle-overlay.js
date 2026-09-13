// 底部字幕覆盖层：移植自 folia-major src/components/visualizer/VisualizerSubtitleOverlay.tsx
// 13 种歌词模式共享：显示当前/最近一行的翻译（或罗马音），无字幕时预览下一行歌词。
// 纯标记/分隔行（"//"、"●●●"、纯符号）永不显示。
(function () {
  'use strict'

  var ColorMix = window.FoliaColorMix

  // 只有包含至少一个字母或数字（任何文字）的字符串才算可读文本
  function hasReadableText(text) {
    return Boolean(text) && /[\p{L}\p{N}]/u.test(text)
  }

  // 字幕内容解析（原版 resolveVisualizerSubtitleOverlayContent）
  function resolveContent(options) {
    var showText = options.showText
    var activeLine = options.activeLine
    var recentCompletedLine = options.recentCompletedLine
    var nextLines = options.nextLines || []
    var hideTranslationSubtitle = options.hideTranslationSubtitle

    if (!showText || hideTranslationSubtitle) {
      return { shouldRenderOverlay: false, subtitleText: null, upcomingLines: [] }
    }

    // folia-style 的 secondary 已由主程序设置决定（翻译或罗马音二选一），存于 line.translation
    var subtitleText = null
    var candidates = [activeLine, recentCompletedLine]
    for (var i = 0; i < candidates.length; i += 1) {
      var line = candidates[i]
      if (line && hasReadableText(line.translation)) { subtitleText = line.translation; break }
    }

    var previewLines = nextLines.filter(function (l) { return hasReadableText(l.fullText) })

    return {
      shouldRenderOverlay: true,
      subtitleText: subtitleText,
      upcomingLines: subtitleText ? [] : (activeLine ? previewLines : [])
    }
  }

  var container = null
  var contentEl = null
  var currentKey = null
  var shown = false

  function ensureDom(hostEl) {
    if (container) return container

    container = document.createElement('div')
    container.className = 'folia-subtitle-overlay'
    container.style.cssText = [
      'position:absolute', 'left:0', 'right:0', 'bottom:72px',
      'text-align:center', 'padding:0 16px', 'z-index:20',
      'pointer-events:none', 'display:flex', 'flex-direction:column', 'align-items:center',
      'gap:8px', 'opacity:0', 'transform:translateY(20px)',
      'transition:opacity 0.24s ease-out, transform 0.24s ease-out'
    ].join(';')

    contentEl = document.createElement('div')
    contentEl.style.cssText = 'position:relative;display:inline-block;max-width:100%'
    container.appendChild(contentEl)

    ;(hostEl || document.body).appendChild(container)
    return container
  }

  function buildGlow(theme) {
    var glow = document.createElement('div')
    glow.setAttribute('aria-hidden', 'true')
    glow.style.cssText = [
      'pointer-events:none', 'position:absolute', 'left:-40px', 'right:-40px', 'top:-24px', 'bottom:-24px',
      'z-index:0', 'filter:blur(24px)', 'transform:translateZ(0)', '-webkit-backface-visibility:hidden',
      'background:radial-gradient(ellipse 115% 130% at center, ' + ColorMix.colorWithAlpha(theme.backgroundColor, 0.96) + ' 0%, ' + ColorMix.colorWithAlpha(theme.backgroundColor, 0.78) + ' 62%, transparent 100%)'
    ].join(';')
    return glow
  }

  function scaleFontSizePx(basePx, scale) {
    return Math.round(basePx * scale) + 'px'
  }

  /**
   * 更新字幕（每帧/行变化时调用）
   * options: { hostEl, showText, activeLine, recentCompletedLine, nextLines, theme,
   *            opacity, subtitleFontScale, subtitleOverlayBackground, subtitleUpcomingLyricsBlur }
   */
  function update(options) {
    var theme = options.theme
    if (!theme) return
    ensureDom(options.hostEl)

    var content = resolveContent(options)
    var resolvedOpacity = options.opacity === undefined ? 0.6 : options.opacity
    var fontScale = options.subtitleFontScale === undefined ? 1 : options.subtitleFontScale
    var withBackground = options.subtitleOverlayBackground !== false
    var upcomingBlur = options.subtitleUpcomingLyricsBlur !== false
    var textShadow = '0 1px 2px ' + ColorMix.colorWithAlpha(theme.backgroundColor, 0.24)

    if (!content.shouldRenderOverlay) {
      hide()
      return
    }

    // 内容指纹：行变化时才重建 DOM
    var subtitleSource = content.subtitleText !== null
      ? (options.activeLine || options.recentCompletedLine)
      : null
    var key = content.subtitleText !== null
      ? 't:' + (subtitleSource ? subtitleSource.startTime : '') + ':' + content.subtitleText
      : 'u:' + content.upcomingLines.map(function (l) { return l.startTime }).join(',')

    if (key !== currentKey) {
      currentKey = key
      contentEl.innerHTML = ''

      if (withBackground) contentEl.appendChild(buildGlow(theme))

      if (content.subtitleText !== null) {
        var trans = document.createElement('div')
        trans.style.cssText = [
          'position:relative', 'z-index:10', 'max-width:56rem', 'margin:0 auto',
          'color:' + theme.secondaryColor,
          'font-size:' + scaleFontSizePx(clampVw(18, 41.6, 20), fontScale),
          'font-weight:500', 'text-shadow:' + textShadow, 'line-height:1.45'
        ].join(';')
        trans.textContent = content.subtitleText
        contentEl.appendChild(trans)
        trans.animate([{ opacity: 0, transform: 'translateY(10px)' }, { opacity: 1, transform: 'translateY(0)' }], { duration: 240, easing: 'ease-out', fill: 'forwards' })
      } else if (content.upcomingLines.length > 0) {
        var wrap = document.createElement('div')
        wrap.style.cssText = 'position:relative;z-index:10;display:flex;flex-direction:column;gap:8px;align-items:center'
        content.upcomingLines.forEach(function (line) {
          var p = document.createElement('p')
          p.style.cssText = [
            'margin:0', 'max-width:42rem', 'overflow:hidden', 'text-overflow:ellipsis', 'white-space:nowrap',
            'transition:filter 0.5s',
            'color:' + theme.secondaryColor,
            'font-size:' + scaleFontSizePx(clampVw(14, 32, 16), fontScale),
            'font-weight:400', 'text-shadow:' + textShadow,
            'filter:' + (upcomingBlur ? 'blur(1px)' : 'none')
          ].join(';')
          p.textContent = line.fullText
          wrap.appendChild(p)
        })
        contentEl.appendChild(wrap)
      }
    }

    if (!shown) {
      shown = true
      requestAnimationFrame(function () {
        container.style.opacity = String(resolvedOpacity)
        container.style.transform = 'translateY(0)'
      })
    } else {
      container.style.opacity = String(resolvedOpacity)
    }
  }

  // 简化 rem/vw clamp：返回以 px 为基准的字号（对齐原版 clamp(minRem*16, vw, maxRem*16) 的常见值域）
  function clampVw(minPx, vwFactor, maxPx) {
    var vwValue = window.innerWidth * vwFactor / 100
    return Math.max(minPx, Math.min(vwValue, maxPx))
  }

  function hide() {
    if (!container || !shown) return
    shown = false
    currentKey = null
    container.style.opacity = '0'
    container.style.transform = 'translateY(20px)'
  }

  function destroy() {
    if (container) {
      container.remove()
      container = null
      contentEl = null
      currentKey = null
      shown = false
    }
  }

  window.FoliaSubtitleOverlay = {
    update: update,
    hide: hide,
    destroy: destroy,
    hasReadableText: hasReadableText
  }
})()
