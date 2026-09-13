// Nomand 背景：移植自 folia-major src/components/visualizer/backgrounds/nomand/
//（NomandBackgroundLayer.tsx + nomandShaderAdjustments.ts）
// 五种 Paper 图像滤镜之一作用于封面：抖动/半调网点/镜头畸变/纸纹理/毛玻璃，含主题色映射与
// 明暗自适应反色、畸变 shader 的防露边预放大（overscan 求解公式照搬）。
// 默认 effect：dithering（8x8）。
(function () {
  'use strict'

  // 原版 DEFAULT_NOMAND_BACKGROUND_TUNING
  var TUNING = {
    imageSource: 'cover-derived',
    effect: 'dithering',
    ditheringType: '8x8',
    size: 3,
    colorSteps: 4,
    originalColors: false,
    inverted: false,
    flutedGlassSize: 0.5,
    flutedGlassDistortion: 0.5,
    flutedGlassBlur: 0.08,
    paperTextureContrast: 0.32,
    paperTextureRoughness: 0.42,
    paperTextureFiber: 0.3,
    halftoneDotsSize: 0.5,
    halftoneDotsRadius: 1.25,
    halftoneDotsContrast: 0.4,
    halftoneDotsOriginalColors: false,
    halftoneDotsInverted: false,
    lensDistortionSpread: 0.45,
    lensDistortionBulge: 0.3,
    lensDistortionDispersion: 0.65,
    overlayEnabled: true,
    overlayOpacity: 0.35
  }

  // ---------- nomandShaderAdjustments.ts（原样移植） ----------
  var MAX_OVERSCAN = 1.8
  var OVERSCAN_MARGIN = 0.01
  var REFERENCE_ASPECT = 16 / 9

  // PaperTexture 的固定形状参数
  var NOMAND_PAPER_TEXTURE_SHAPE = {
    fiberSize: 0.2,
    crumples: 0.35,
    crumpleSize: 0.35,
    folds: 0.65,
    foldCount: 5,
    drops: 0.2,
    seed: 5.8
  }

  // LensDistortion 的固定镜头形状参数
  var NOMAND_LENS_SHAPE = {
    perspective: 0.4,
    count: 20,
    focusCenter: 0.55,
    focusEdges: 0.8,
    swirl: 0.08,
    lensCircle: 0.1
  }

  function clamp01(value) { return Math.min(1, Math.max(0, value)) }
  function clampOverscan(scale) { return Math.min(MAX_OVERSCAN, Math.max(1, scale)) }
  function applyOverscanMargin(scale) { return scale <= 1 ? 1 : clampOverscan(scale + OVERSCAN_MARGIN) }
  function overscanForMargin(margin) { return applyOverscanMargin(1 / (1 - 2 * Math.min(Math.max(margin, 0), 0.45))) }

  // 明暗自适应反色（本插件恒深色，isDaylight 恒 false，逻辑保留）
  function resolveDaylightInversion(inverted, originalColors, isDaylight) {
    return (isDaylight && !originalColors) ? !inverted : inverted
  }

  // 半调网点的亮度约定与像素画相反：基准先翻一次
  function resolveHalftoneInversion(inverted, originalColors, isDaylight) {
    return resolveDaylightInversion(!inverted, originalColors, isDaylight)
  }

  // PaperTexture 把纸张法线直接加到图像 UV 上：按最大位移估预放大倍率
  function getPaperTextureOverscan(roughness, fiber) {
    var folds = NOMAND_PAPER_TEXTURE_SHAPE.folds
    var crumples = NOMAND_PAPER_TEXTURE_SHAPE.crumples
    var drops = NOMAND_PAPER_TEXTURE_SHAPE.drops
    var maxNormal = 2 * folds
      + 1.5 * crumples
      + 0.2 * drops
      + 0.75 * clamp01(roughness)
      + 0.1 * clamp01(fiber)
    return overscanForMargin(0.02 * maxNormal)
  }

  // LensDistortion 沿半径推出采样点：二分反解最小放大倍率
  function getLensDistortionOverscan(bulge, spread) {
    var outRadius = 0.5 * Math.hypot(REFERENCE_ASPECT, 1)
    var clampedSpread = clamp01(spread)
    var reach = 0.7 * Math.pow(clampedSpread, 1.3 + 2.7 * clampedSpread)
    var edgeReach = reach * (1 - NOMAND_LENS_SHAPE.focusEdges)
    var headroom = Math.max(0.35, 1 - edgeReach / outRadius)

    if (bulge <= 0) return applyOverscanMargin(1 / headroom)

    var bulgeAmount = Math.min(bulge, 1) * 1.4
    var cornerPush = function (scale) {
      var cornerRn = (2 * outRadius) / scale
      return Math.tan(cornerRn * bulgeAmount) / Math.tan(bulgeAmount) / cornerRn
    }

    var low = Math.max(1, (2 * outRadius * bulgeAmount) / 1.45)
    if (low >= MAX_OVERSCAN || cornerPush(MAX_OVERSCAN) > MAX_OVERSCAN * headroom) return MAX_OVERSCAN
    if (low === 1 && cornerPush(1) <= headroom) return applyOverscanMargin(1 / headroom)

    var high = MAX_OVERSCAN
    for (var step = 0; step < 32; step += 1) {
      var mid = (low + high) / 2
      if (cornerPush(mid) > mid * headroom) low = mid
      else high = mid
    }
    return applyOverscanMargin(high)
  }

  function create(config) {
    var tuning = Object.assign({}, TUNING, config || {})

    var host = null
    var root = null
    var shaderHost = null
    var overlayEl = null
    var mountHandle = null
    var mountedKey = null

    var theme = null
    var coverUrl = null

    function mount(hostEl) {
      host = hostEl

      root = document.createElement('div')
      root.style.cssText = 'position:absolute;inset:0;z-index:0;overflow:hidden;pointer-events:none;background-color:' + (theme ? theme.backgroundColor : '#09090b')
      host.appendChild(root)
      rebuildShader()
    }

    function disposeShader() {
      if (mountHandle) { try { mountHandle.dispose() } catch (e) { /* 忽略 */ } mountHandle = null }
      mountedKey = null
      if (shaderHost) { shaderHost.remove(); shaderHost = null }
    }

    // 参数指纹：变化才重建（对应原版 key={`${sourceUrl}:${effect}`}
    function currentKey() {
      return [coverUrl || '', tuning.effect, theme ? theme.backgroundColor : '', theme ? theme.accentColor : '', theme ? theme.primaryColor : '', theme ? theme.secondaryColor : ''].join('|')
    }

    function rebuildShader() {
      if (!window.FoliaPaperMount || !theme) return
      var key = currentKey()
      if (key === mountedKey) return
      disposeShader()

      var sourceUrl = coverUrl // imageSource 恒 'cover-derived'（无上传图功能）
      if (!sourceUrl) return

      shaderHost = document.createElement('div')
      shaderHost.style.cssText = 'position:absolute;inset:0;width:100%;height:100%'
      root.insertBefore(shaderHost, overlayEl)

      var common = {
        image: sourceUrl,
        fit: 'cover',
        scale: 1,
        rotation: 0,
        offsetX: 0,
        offsetY: 0,
        originX: 0.5,
        originY: 0.5,
        worldWidth: 0,
        worldHeight: 0
      }
      var opts = { speed: 0, minPixelRatio: 1, maxPixelCount: 1920 * 1080 }
      var paperMount = window.FoliaPaperMount
      var promise = null

      switch (tuning.effect) {
        case 'fluted-glass':
          promise = paperMount.mountPaperShader(shaderHost, 'flutedGlass', Object.assign({}, common, {
            colorBack: theme.backgroundColor,
            colorShadow: theme.secondaryColor,
            colorHighlight: theme.primaryColor,
            shadows: 0.25,
            size: tuning.flutedGlassSize,
            distortion: tuning.flutedGlassDistortion,
            blur: tuning.flutedGlassBlur,
            shape: 'lines',
            distortionShape: 'prism',
            highlights: 0.1,
            edges: 0.25,
            angle: 0,
            shift: 0,
            stretch: 0,
            marginLeft: 0, marginRight: 0, marginTop: 0, marginBottom: 0,
            grainMixer: 0, grainOverlay: 0
          }), opts)
          break
        case 'paper-texture':
          promise = paperMount.mountPaperShader(shaderHost, 'paperTexture', Object.assign({}, common, NOMAND_PAPER_TEXTURE_SHAPE, {
            colorFront: theme.accentColor,
            colorBack: theme.backgroundColor,
            contrast: tuning.paperTextureContrast,
            roughness: tuning.paperTextureRoughness,
            fiber: tuning.paperTextureFiber,
            fade: 0,
            scale: getPaperTextureOverscan(tuning.paperTextureRoughness, tuning.paperTextureFiber)
          }), opts)
          break
        case 'halftone-dots':
          promise = paperMount.mountPaperShader(shaderHost, 'halftoneDots', Object.assign({}, common, {
            colorBack: theme.backgroundColor,
            colorFront: theme.accentColor,
            size: tuning.halftoneDotsSize,
            radius: tuning.halftoneDotsRadius,
            contrast: tuning.halftoneDotsContrast,
            originalColors: tuning.halftoneDotsOriginalColors,
            inverted: resolveHalftoneInversion(tuning.halftoneDotsInverted, tuning.halftoneDotsOriginalColors, false),
            grid: 'hex',
            type: 'gooey',
            grainMixer: 0.12,
            grainOverlay: 0.06,
            grainSize: 0.5
          }), opts)
          break
        case 'lens-distortion':
          promise = paperMount.mountPaperShader(shaderHost, 'lensDistortion', Object.assign({}, common, NOMAND_LENS_SHAPE, {
            spread: tuning.lensDistortionSpread,
            dispersion: tuning.lensDistortionDispersion,
            lensBulge: tuning.lensDistortionBulge,
            bias: 1,
            angle: 0,
            dispersionShift: 0,
            dispersionColor: 0.6,
            swirl: NOMAND_LENS_SHAPE.swirl,
            noise: 0,
            noiseFrequency: 0.25,
            noiseOffset: 0,
            grainMixer: 0,
            grainOverlay: 0,
            imageX: 0,
            imageY: 0,
            scale: getLensDistortionOverscan(tuning.lensDistortionBulge, tuning.lensDistortionSpread)
          }), opts)
          break
        default: // dithering
          promise = paperMount.mountPaperShader(shaderHost, 'imageDithering', Object.assign({}, common, {
            colorBack: theme.backgroundColor,
            colorFront: theme.accentColor,
            colorHighlight: theme.primaryColor,
            originalColors: tuning.originalColors,
            inverted: resolveDaylightInversion(tuning.inverted, tuning.originalColors, false),
            type: tuning.ditheringType,
            size: tuning.size,
            colorSteps: tuning.colorSteps
          }), opts)
      }

      promise.then(function (handle) {
        if (!shaderHost || !shaderHost.isConnected) { handle.dispose(); return }
        mountHandle = handle
        mountedKey = key
      }).catch(function (err) {
        console.warn('[Nomand] shader 挂载失败', err)
      })
    }

    function setTheme(newTheme) {
      theme = newTheme
      if (root) root.style.backgroundColor = theme.backgroundColor
      if (overlayEl) overlayEl.style.backgroundColor = theme.backgroundColor
      rebuildShader()
    }

    function setCoverUrl(url) {
      if (coverUrl === url) return
      coverUrl = url
      rebuildShader()
    }

    function tick() { /* 静态滤镜，无逐帧逻辑（speed 恒 0） */ }

    function destroy() {
      disposeShader()
      if (root) { root.remove(); root = null }
      overlayEl = null
      host = null
    }

    return {
      id: 'nomand',
      mount: mount,
      setTheme: setTheme,
      setCoverUrl: setCoverUrl,
      tick: tick,
      destroy: destroy
    }
  }

  window.FoliaBgNomand = { create: create }
})()
