// 莫奈背景：移植自 folia-major src/components/visualizer/backgrounds/monet/
//（MonetBackgroundLayer.tsx + monetBackgroundDrift.ts + monet/monetBackgroundPipeline.ts）
// 封面经 canvas 位图后处理（模糊 + 灰度/饱和/主题色 wash + 渐变覆盖层 + 竖向条纹）生成 data URL，
// full-overlay 布局 + AE 风格分形噪声漂移（WAAPI 无限循环，合成器播放零主线程开销）+ 可读性渐变。
(function () {
  'use strict'

  var ColorMix = window.FoliaColorMix

  // 原版 DEFAULT_MONET_BACKGROUND_TUNING
  var TUNING = {
    backgroundSource: 'cover-derived',
    backgroundLayout: 'full-overlay',
    backgroundBlurPx: 6,
    backgroundOverlayOpacity: 0.74,
    backgroundGrayscale: 0,
    backgroundSaturation: 1.05,
    backgroundWash: 0.34,
    backgroundHalfPaneOffsetX: 0,
    backgroundWashColorMode: 'theme',
    backgroundWashCustomColor: '#8fb7ff',
    backgroundDriftEnabled: true,
    backgroundDriftStrength: 0.5,
    backgroundStreaksEnabled: true
  }

  var PIPELINE_DEBOUNCE_MS = 180
  var MONET_BACKGROUND_WIDTH = 1920
  var MONET_BACKGROUND_HEIGHT = 1080
  var FALLBACK_DARK = { r: 10, g: 10, b: 12 }
  var FALLBACK_LIGHT = { r: 245, g: 245, b: 245 }

  function clamp(value, min, max) { return Math.min(max, Math.max(min, value)) }
  function mix(from, to, amount) { return from + (to - from) * amount }
  function luminanceOf(r, g, b) { return 0.2126 * r + 0.7152 * g + 0.0722 * b }

  // ---------- 漂移轨道（monetBackgroundDrift.ts 原样移植） ----------
  var DRIFT_LOOP_SECONDS = 240
  var DRIFT_LATTICE_POINTS = 76
  var DRIFT_SAMPLE_COUNT = 156
  var DRIFT_MAX_TRAVEL_PERCENT = 3.4
  var DRIFT_BREATH_AMPLITUDE = 0.035
  var DRIFT_OVERSCAN_MARGIN = 0.01
  var DRIFT_SEED_X = 12.9898
  var DRIFT_SEED_Y = 78.233
  var DRIFT_SEED_SCALE = 39.425

  function wrap(value, modulus) { return ((value % modulus) + modulus) % modulus }

  function hash(lattice, seed) {
    var value = Math.sin(lattice * 127.1 + seed * 311.7) * 43758.5453
    return value - Math.floor(value)
  }

  function smoothstep(t) { return t * t * (3 - 2 * t) }

  // 每 points 格精确重复的值噪声，轨道无缝循环
  function periodicNoise(t, points, seed) {
    var cell = Math.floor(t)
    var from = hash(wrap(cell, points), seed)
    var to = hash(wrap(cell + 1, points), seed)
    return from + (to - from) * smoothstep(t - cell)
  }

  function periodicFbm(t, seed) {
    var base = periodicNoise(t, DRIFT_LATTICE_POINTS, seed)
    var detail = periodicNoise(t * 2, DRIFT_LATTICE_POINTS * 2, seed + 17.31)
    return (base * 0.68 + detail * 0.32) * 2 - 1
  }

  function normalize(samples) {
    var peak = 0
    samples.forEach(function (value) { peak = Math.max(peak, Math.abs(value)) })
    return peak > 0 ? samples.map(function (value) { return value / peak }) : samples
  }

  // 一次 strength 的漂移动画：元素预放大超过两倍最大位移，平移永不拖入图像边缘
  function buildMonetDriftTrack(strength) {
    var clamped = Math.min(1, Math.max(0, strength))
    var travelPercent = DRIFT_MAX_TRAVEL_PERCENT * clamped
    var minScale = 1 + (travelPercent / 100) * 2 + DRIFT_OVERSCAN_MARGIN
    var breath = DRIFT_BREATH_AMPLITUDE * clamped

    var rawX = []
    var rawY = []
    var rawScale = []
    for (var index = 0; index <= DRIFT_SAMPLE_COUNT; index += 1) {
      var t = (DRIFT_LATTICE_POINTS * index) / DRIFT_SAMPLE_COUNT
      rawX.push(periodicFbm(t, DRIFT_SEED_X))
      rawY.push(periodicFbm(t, DRIFT_SEED_Y))
      rawScale.push(periodicFbm(t, DRIFT_SEED_SCALE))
    }

    var x = normalize(rawX)
    var y = normalize(rawY)
    var scale = normalize(rawScale)

    var keyframes = x.map(function (offsetX, index) {
      return {
        transform: 'translate3d(' + (offsetX * travelPercent).toFixed(4) + '%, ' + (y[index] * travelPercent).toFixed(4) + '%, 0) '
          + 'scale(' + (minScale + breath * ((scale[index] + 1) / 2)).toFixed(5) + ')'
      }
    })

    return { keyframes: keyframes, durationMs: DRIFT_LOOP_SECONDS * 1000 }
  }

  // ---------- 位图管线（monetBackgroundPipeline.ts 移植） ----------
  function loadImage(src) {
    return new Promise(function (resolve, reject) {
      var image = new Image()
      if (src.indexOf('http://') === 0 || src.indexOf('https://') === 0) {
        image.crossOrigin = 'anonymous'
      }
      image.decoding = 'async'
      var loadPromise = new Promise(function (res, rej) {
        image.onload = function () { res() }
        image.onerror = function () { rej(new Error('图片加载失败: ' + src)) }
      })
      image.src = src
      var decoded = image.decode ? image.decode().catch(function () { return loadPromise }) : loadPromise
      decoded.then(function () { resolve(image) }).catch(reject)
    })
  }

  function drawCoverCropped(context, image, width, height) {
    var imageWidth = image.width || width
    var imageHeight = image.height || height
    if (!imageWidth || !imageHeight) return

    var scale = Math.max(width / imageWidth, height / imageHeight)
    var drawWidth = imageWidth * scale
    var drawHeight = imageHeight * scale
    var offsetX = (width - drawWidth) / 2
    var offsetY = (height - drawHeight) / 2
    context.drawImage(image, offsetX, offsetY, drawWidth, drawHeight)
  }

  function resolveThemeChannel(color, fallback) {
    var parsed = ColorMix.parseColorChannels(color)
    return parsed || fallback
  }

  function resolveWashEndpoints(background, primary) {
    var backgroundLuminance = luminanceOf(background.r, background.g, background.b)
    var primaryLuminance = luminanceOf(primary.r, primary.g, primary.b)
    return backgroundLuminance <= primaryLuminance
      ? { shadow: background, highlight: primary }
      : { shadow: primary, highlight: background }
  }

  function resolveWashColor(normalizedLuminance, background, accent, primary) {
    var endpoints = resolveWashEndpoints(background, primary)
    if (normalizedLuminance <= 0.55) {
      var amount = normalizedLuminance / 0.55
      return {
        r: mix(endpoints.shadow.r, accent.r, amount),
        g: mix(endpoints.shadow.g, accent.g, amount),
        b: mix(endpoints.shadow.b, accent.b, amount)
      }
    }
    var amount2 = (normalizedLuminance - 0.55) / 0.45
    return {
      r: mix(accent.r, endpoints.highlight.r, amount2),
      g: mix(accent.g, endpoints.highlight.g, amount2),
      b: mix(accent.b, endpoints.highlight.b, amount2)
    }
  }

  // 稳定的 canvas 专属色彩处理（灰度/饱和/主题 wash）
  function applyBackgroundPostProcessing(context, width, height, theme, tuning) {
    var grayscale = clamp(tuning.backgroundGrayscale, 0, 1)
    var saturation = clamp(tuning.backgroundSaturation, 0, 2)
    var wash = clamp(tuning.backgroundWash, 0, 1)
    if (grayscale <= 0 && Math.abs(saturation - 1) < 0.001 && wash <= 0) return

    var imageData = context.getImageData(0, 0, width, height)
    var data = imageData.data
    var background = resolveThemeChannel(theme.backgroundColor, FALLBACK_DARK)
    var accent = resolveThemeChannel(theme.accentColor, background)
    var primary = resolveThemeChannel(theme.primaryColor, FALLBACK_LIGHT)
    var customWash = resolveThemeChannel(tuning.backgroundWashCustomColor, accent)
    var washAccent = tuning.backgroundWashColorMode === 'custom' ? customWash : accent

    for (var index = 0; index < data.length; index += 4) {
      var r = data[index]
      var g = data[index + 1]
      var b = data[index + 2]
      var alpha = data[index + 3]
      if (alpha === 0) continue

      var lum = luminanceOf(r, g, b)
      if (grayscale > 0) {
        r = mix(r, lum, grayscale)
        g = mix(g, lum, grayscale)
        b = mix(b, lum, grayscale)
      }

      if (Math.abs(saturation - 1) >= 0.001) {
        var saturatedLuminance = luminanceOf(r, g, b)
        r = saturatedLuminance + (r - saturatedLuminance) * saturation
        g = saturatedLuminance + (g - saturatedLuminance) * saturation
        b = saturatedLuminance + (b - saturatedLuminance) * saturation
      }

      if (wash > 0) {
        var washColor = resolveWashColor(clamp(lum / 255, 0, 1), background, washAccent, primary)
        r = mix(r, washColor.r, wash)
        g = mix(g, washColor.g, wash)
        b = mix(b, washColor.b, wash)
      }

      data[index] = Math.round(clamp(r, 0, 255))
      data[index + 1] = Math.round(clamp(g, 0, 255))
      data[index + 2] = Math.round(clamp(b, 0, 255))
    }

    context.putImageData(imageData, 0, 0)
  }

  function paintMonetOverlay(context, width, height, theme, tuning) {
    var overlay = clamp(tuning.backgroundOverlayOpacity, 0, 1)
    var overlayGradient = context.createLinearGradient(0, 0, width, height)
    overlayGradient.addColorStop(0, ColorMix.colorWithAlpha(theme.accentColor, 0.08 + overlay * 0.62))
    overlayGradient.addColorStop(0.44, ColorMix.colorWithAlpha(theme.backgroundColor, 0.16 + overlay * 0.58))
    overlayGradient.addColorStop(1, ColorMix.colorWithAlpha(theme.primaryColor, 0.06 + overlay * 0.36))
    context.fillStyle = overlayGradient
    context.fillRect(0, 0, width, height)

    var leftBloom = context.createRadialGradient(width * 0.18, height * 0.34, 0, width * 0.18, height * 0.34, width * 0.55)
    leftBloom.addColorStop(0, ColorMix.colorWithAlpha(theme.accentColor, overlay * 0.42))
    leftBloom.addColorStop(1, ColorMix.colorWithAlpha(theme.backgroundColor, 0))
    context.fillStyle = leftBloom
    context.fillRect(0, 0, width, height)

    var rightVeil = context.createLinearGradient(width * 0.45, 0, width, 0)
    rightVeil.addColorStop(0, ColorMix.colorWithAlpha(theme.backgroundColor, 0))
    rightVeil.addColorStop(1, ColorMix.colorWithAlpha(theme.backgroundColor, 0.18 + overlay * 0.38))
    context.fillStyle = rightVeil
    context.fillRect(0, 0, width, height)

    if (tuning.backgroundStreaksEnabled === false) return

    context.fillStyle = ColorMix.colorWithAlpha(theme.backgroundColor, 0.1 + overlay * 0.08)
    for (var index = 0; index < 18; index += 1) {
      var x = (index * 127) % width
      var y = ((index * 211) % height) - 40
      context.fillRect(x, y, 1, height * 0.28)
    }
  }

  var isCanvasFilterSupportedCached = null
  function checkCanvasFilterSupport() {
    if (isCanvasFilterSupportedCached !== null) return isCanvasFilterSupportedCached
    try {
      var canvas = document.createElement('canvas')
      canvas.width = 2
      canvas.height = 2
      var ctx = canvas.getContext('2d')
      if (!ctx || typeof ctx.filter !== 'string') {
        isCanvasFilterSupportedCached = false
        return false
      }
      ctx.fillStyle = '#000000'
      ctx.fillRect(0, 0, 2, 2)
      ctx.filter = 'blur(1px)'
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, 1, 1)
      var imgData = ctx.getImageData(1, 1, 1, 1)
      isCanvasFilterSupportedCached = imgData.data[0] > 0
      return isCanvasFilterSupportedCached
    } catch (e) {
      isCanvasFilterSupportedCached = false
      return false
    }
  }

  var pipelineCache = new Map()

  function buildMonetBackgroundDataUrl(theme, tuning) {
    var sourceUrl = null
    if (typeof state.coverUrl === 'string' && state.coverUrl) sourceUrl = state.coverUrl
    if (!sourceUrl) return Promise.resolve(null)

    return loadImage(sourceUrl).then(function (image) {
      var canvas = document.createElement('canvas')
      canvas.width = MONET_BACKGROUND_WIDTH
      canvas.height = MONET_BACKGROUND_HEIGHT
      var context = canvas.getContext('2d')
      if (!context) return null

      context.fillStyle = theme.backgroundColor
      context.fillRect(0, 0, canvas.width, canvas.height)

      context.save()
      if (checkCanvasFilterSupport()) {
        context.filter = 'blur(' + clamp(tuning.backgroundBlurPx, 0, 60) + 'px)'
      }
      drawCoverCropped(context, image, canvas.width, canvas.height)
      context.restore()

      applyBackgroundPostProcessing(context, canvas.width, canvas.height, theme, tuning)
      paintMonetOverlay(context, canvas.width, canvas.height, theme, tuning)

      return canvas.toDataURL('image/jpeg', 0.92)
    })
  }

  function resolveMonetBackgroundDataUrl(theme, tuning) {
    var cacheKey = JSON.stringify({
      sourceUrl: state.coverUrl || null,
      theme: {
        backgroundColor: theme.backgroundColor,
        primaryColor: theme.primaryColor,
        accentColor: theme.accentColor
      },
      tuning: {
        backgroundBlurPx: tuning.backgroundBlurPx,
        backgroundOverlayOpacity: tuning.backgroundOverlayOpacity,
        backgroundGrayscale: tuning.backgroundGrayscale,
        backgroundSaturation: tuning.backgroundSaturation,
        backgroundWash: tuning.backgroundWash,
        backgroundWashColorMode: tuning.backgroundWashColorMode,
        backgroundWashCustomColor: tuning.backgroundWashCustomColor,
        backgroundStreaksEnabled: tuning.backgroundStreaksEnabled
      }
    })
    var cached = pipelineCache.get(cacheKey)
    if (cached) return cached

    var next = buildMonetBackgroundDataUrl(theme, tuning).catch(function () { return null })
    pipelineCache.set(cacheKey, next)
    if (pipelineCache.size > 12) {
      var firstKey = pipelineCache.keys().next().value
      pipelineCache.delete(firstKey)
    }
    return next
  }

  // ---------- 背景实例 ----------
  function create(config) {
    var tuning = Object.assign({}, TUNING, config || {})

    var host = null
    var root = null
    var driftEl = null
    var currentImageEl = null
    var readabilityEl = null
    var driftAnimation = null
    var debounceTimer = null

    var theme = null
    var pipelineUrl = null
    var staticMode = false

    var state = { coverUrl: null }

    function mount(hostEl) {
      host = hostEl

      root = document.createElement('div')
      root.style.cssText = 'position:absolute;inset:0;z-index:0;overflow:hidden'
      host.appendChild(root)

      driftEl = document.createElement('div')
      driftEl.style.cssText = 'position:absolute;inset:0;will-change:transform'
      root.appendChild(driftEl)

      readabilityEl = document.createElement('div')
      root.appendChild(readabilityEl)

      applyTheme()
      startDrift()
      schedulePipeline()
      renderImage()
    }

    // 漂移关键帧交给 WAAPI，合成器播放，无每帧 JS 开销
    function startDrift() {
      if (driftAnimation) { try { driftAnimation.cancel() } catch (e) { /* 忽略 */ } driftAnimation = null }
      var strength = clamp(tuning.backgroundDriftStrength || 0, 0, 1)
      var enabled = Boolean(tuning.backgroundDriftEnabled) && !staticMode && strength > 0
      if (!driftEl || !enabled || typeof driftEl.animate !== 'function') return

      var track = buildMonetDriftTrack(strength)
      driftAnimation = driftEl.animate(track.keyframes, {
        duration: track.durationMs,
        iterations: Infinity,
        easing: 'linear'
      })
    }

    function applyTheme() {
      if (!theme || !readabilityEl) return
      readabilityEl.style.cssText = [
        'position:absolute', 'inset:0',
        'background:linear-gradient(90deg, ' + ColorMix.colorWithAlpha(theme.backgroundColor, 0.18) + ' 0%, ' + ColorMix.colorWithAlpha(theme.backgroundColor, 0.32) + ' 34%, ' + ColorMix.colorWithAlpha(theme.backgroundColor, 0.66) + ' 70%, ' + ColorMix.colorWithAlpha(theme.backgroundColor, 0.82) + ' 100%)'
      ].join(';')
    }

    function schedulePipeline() {
      if (debounceTimer !== null) {
        clearTimeout(debounceTimer)
        debounceTimer = null
      }
      if (!state.coverUrl || !theme) {
        pipelineUrl = null
        renderImage()
        return
      }
      debounceTimer = setTimeout(function () {
        debounceTimer = null
        resolveMonetBackgroundDataUrl(theme, tuning).then(function (url) {
          if (pipelineUrl !== url) {
            pipelineUrl = url
            renderImage()
          }
        })
      }, PIPELINE_DEBOUNCE_MS)
    }

    // 图像层渲染（pipeline data URL 优先，封面原图+渐变次之，纯渐变兜底）
    function renderImage() {
      if (!driftEl || !theme) return

      var blurPx = checkCanvasFilterSupport() ? 0 : tuning.backgroundBlurPx
      var blurStyle = blurPx <= 0 ? '' : 'filter:blur(' + blurPx + 'px);-webkit-filter:blur(' + blurPx + 'px);transform:scale(1.1) translateZ(0);'

      var backgroundImage
      if (pipelineUrl) {
        backgroundImage = 'url(' + pipelineUrl + ')'
      } else if (state.coverUrl) {
        backgroundImage = 'linear-gradient(135deg, ' + ColorMix.colorWithAlpha(theme.accentColor, 0.2) + ', ' + ColorMix.colorWithAlpha(theme.backgroundColor, 0.78) + '), url(' + state.coverUrl + ')'
      } else {
        backgroundImage = 'linear-gradient(135deg, ' + ColorMix.colorWithAlpha(theme.accentColor, 0.22) + ', ' + ColorMix.colorWithAlpha(theme.backgroundColor, 0.96) + ' 50%, ' + ColorMix.colorWithAlpha(theme.primaryColor, 0.18) + ')'
      }

      var key = backgroundImage
      if (currentImageEl && currentImageEl.dataset.key === key) return

      if (currentImageEl) currentImageEl.remove()
      currentImageEl = document.createElement('div')
      currentImageEl.dataset.key = key
      currentImageEl.style.cssText = [
        'position:absolute', 'inset:0',
        'background-color:' + theme.backgroundColor,
        'background-image:' + backgroundImage,
        'background-size:cover',
        'background-position:center',
        blurStyle,
        'opacity:0'
      ].join(';')
      driftEl.appendChild(currentImageEl)
      currentImageEl.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 800, easing: 'ease-in-out', fill: 'forwards' })
    }

    function setTheme(newTheme) {
      theme = newTheme
      applyTheme()
      schedulePipeline()
      renderImage()
    }

    function setCoverUrl(url) {
      if (state.coverUrl === url) return
      state.coverUrl = url
      schedulePipeline()
      renderImage()
    }

    function tick() { /* 漂移走 WAAPI 合成器，无每帧逻辑 */ }

    function destroy() {
      if (debounceTimer !== null) { clearTimeout(debounceTimer); debounceTimer = null }
      if (driftAnimation) { try { driftAnimation.cancel() } catch (e) { /* 忽略 */ } driftAnimation = null }
      if (root) { root.remove(); root = null }
      driftEl = null
      currentImageEl = null
      readabilityEl = null
      host = null
    }

    return {
      id: 'monet',
      mount: mount,
      setTheme: setTheme,
      setCoverUrl: setCoverUrl,
      tick: tick,
      destroy: destroy
    }
  }

  window.FoliaBgMonet = { create: create }
})()
