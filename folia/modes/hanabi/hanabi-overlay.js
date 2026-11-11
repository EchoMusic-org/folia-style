// 花火的画框装饰（移植自 overlay.ts）：左上角一枚「花火」朱印，右缘竖排的小字 HANABI，
// 左下三颗烟花色的圆点 + 细线，右下一个角标。静态、小而淡，离画面边缘留足（镜头畸变会把边缘 5% 推出画面）。
(function () {
  'use strict'

  var Color = window.FoliaHanabiColor

  /** 字体栈：跟随宿主主题（与 machi-runtime 的 themeFontStack 同一策略）。 */
  function themeFontStack(theme) {
    if (typeof window.foliaBridgeFontStack === 'function') {
      var host = window.foliaBridgeFontStack(theme)
      if (host) return host
    }
    var stack = []
    if (theme.fontFamilyStack && theme.fontFamilyStack.length) stack = stack.concat(theme.fontFamilyStack)
    if (theme.fontFamily) stack.push(theme.fontFamily)
    if (theme.fontStyle === 'serif') stack.push('serif')
    else if (theme.fontStyle === 'mono') stack.push('monospace')
    else stack.push('sans-serif')
    return stack.join(', ')
  }

  function themeFontWeight(theme, fallback) {
    if (typeof window.foliaGetLyricFontWeight === 'function') return window.foliaGetLyricFontWeight(fallback || 700)
    return theme.fontWeight || fallback || 700
  }

  function buildHanabiOverlay(pixi, width, height, theme, colorMode, resolution) {
    resolution = resolution === undefined ? 1 : resolution
    var container = new pixi.Container()
    var palette = Color.resolveHanabiPalette('kawaii', theme, colorMode)
    var unit = Math.min(width, height)
    var padX = Math.max(width * 0.07, unit * 0.06)
    var padY = Math.max(height * 0.08, unit * 0.06)
    var line = Math.max(1.2, unit / 640)
    var font = themeFontStack(theme)
    var weight = String(themeFontWeight(theme, 700))
    var g = new pixi.Graphics()

    // 左上角的朱印。
    var seal = unit * 0.024
    var sealX = padX + seal
    var sealY = padY + seal
    g.circle(sealX, sealY, seal).fill({ color: palette.blocks[0], alpha: 0.85 })
    g.circle(sealX, sealY, seal * 1.28).stroke({ color: palette.blocks[0], width: line, alpha: 0.5 })
    var sealText = new pixi.Text({
      text: '花火',
      style: new pixi.TextStyle({ fontFamily: font, fontWeight: weight, fontSize: seal * 0.66, fill: palette.ink, letterSpacing: -seal * 0.04 }),
      resolution: resolution
    })
    sealText.anchor.set(0.5)
    sealText.position.set(sealX, sealY)

    // 右缘竖排的 HANABI。
    var letterSize = unit * 0.017
    var letters = Array.from('HANABI').map(function (char, i) {
      var label = new pixi.Text({
        text: char,
        style: new pixi.TextStyle({ fontFamily: font, fontWeight: weight, fontSize: letterSize, fill: palette.paper }),
        resolution: resolution
      })
      label.anchor.set(0.5)
      label.alpha = 0.55
      label.position.set(width - padX, padY + letterSize * (0.6 + i * 1.5))
      return label
    })
    var stemTop = padY + letterSize * (0.6 + 6 * 1.5)
    g.moveTo(width - padX, stemTop).lineTo(width - padX, stemTop + unit * 0.08).stroke({ color: palette.paper, width: line, alpha: 0.35 })

    // 左下三颗圆点 + 细线。
    var dotY = height - padY
    palette.sparks.slice(0, 3).forEach(function (color, i) {
      g.circle(padX + i * unit * 0.018, dotY, unit * 0.0055).fill({ color: color, alpha: 0.85 })
    })
    g.moveTo(padX + unit * 0.05, dotY).lineTo(padX + unit * 0.16, dotY).stroke({ color: palette.paper, width: line, alpha: 0.35 })

    // 右下角标。
    var arm = unit * 0.035
    g.moveTo(width - padX - arm, height - padY).lineTo(width - padX, height - padY).lineTo(width - padX, height - padY - arm)
      .stroke({ color: palette.accent, width: line * 1.4, alpha: 0.6 })

    container.addChild(g)
    container.addChild(sealText)
    letters.forEach(function (label) { container.addChild(label) })
    return container
  }

  window.FoliaHanabiOverlay = { buildHanabiOverlay: buildHanabiOverlay }
})()
