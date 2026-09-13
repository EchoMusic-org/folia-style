// Latent 背景：移植自 folia-major src/components/visualizer/backgrounds/latent/{entry.tsx,LatentBackground.tsx}
// 双 Paper shader 层：MeshGradient（封面取色网格渐变）+ Dithering（warp 4x4 抖动，soft-light 混合），
// 音频响应（bass 驱动抖动粒度/层缩放、power/mid 驱动 mesh 扭曲/饱和亮度、节拍脉冲驱动 shader 速度），
// 全部公式（resolveLatent* 系列）与原版一致。
(function () {
  'use strict'

  var ColorMix = window.FoliaColorMix
  var ThemeUtil = window.FoliaTheme

  // 原版 DEFAULT_LATENT_BACKGROUND_TUNING
  var TUNING = {
    displayMode: 'both',
    colorSource: 'cover-theme',
    dynamicOnlyInPlayer: true,
    enhancedBeatResponse: true,
    ditheringSpeed: 0.1,
    ditheringAudioSpeed: 1.2,
    ditheringSize: 2.5,
    ditheringOpacity: 0.55,
    meshSpeed: 0.3,
    meshAudioSpeed: 2,
    meshDistortion: 0.8,
    meshSwirl: 0.1,
    overlayEnabled: true,
    overlayOpacity: 0.35
  }

  var MAX_SHADER_PIXELS = 1280 * 720
  var PAUSED_SPEED_SCALE = 0.12

  var normalizeAudio = function (value) { return Math.min(1, Math.max(0, value / 255)) }
  var clampShaderSpeed = function (value) { return Math.min(2, Math.max(0, value)) }
  var clampAudioAmount = function (value) { return Math.min(1, Math.max(0, value)) }
  var easeTowards = function (current, target, amount) { return current + (target - current) * amount }

  function resolveBroadbandEnergy(bass, lowMid, mid, vocal, treble) {
    var broadbandEnergy = (
      normalizeAudio(bass) * 0.22
      + normalizeAudio(lowMid) * 0.18
      + normalizeAudio(mid) * 0.22
      + normalizeAudio(vocal) * 0.28
      + normalizeAudio(treble) * 0.1
    )
    return Math.pow(broadbandEnergy, 0.55)
  }

  // 让 accent 能量上升使 shader 速度落在音乐起振点而非只跟响度
  function resolveOnsetPulse(currentEnergy, previousEnergy, previousPulse) {
    return Math.max(
      previousPulse * 0.84,
      clampAudioAmount((currentEnergy - previousEnergy) * 7)
    )
  }

  function resolveBeatSpeedTarget(broadbandEnergy, onsetPulse) {
    return clampAudioAmount(broadbandEnergy * 0.42 + onsetPulse * 0.85)
  }

  function resolveAudioSpeedTarget(broadbandEnergy, onsetPulse, enhancedBeatResponse) {
    return enhancedBeatResponse
      ? resolveBeatSpeedTarget(broadbandEnergy, onsetPulse)
      : clampAudioAmount(broadbandEnergy)
  }

  function resolveShaderSpeed(baseSpeed, audioSpeed, audioAmount, paused) {
    return clampShaderSpeed(
      paused ? baseSpeed * PAUSED_SPEED_SCALE : easeTowards(baseSpeed, audioSpeed, audioAmount)
    )
  }

  function resolveShaderColors(coverColors, theme, colorSource) {
    var primary = coverColors[0] !== undefined ? coverColors[0] : theme.secondaryColor
    if (colorSource === 'cover-only') {
      var secondaryC = coverColors[1] !== undefined ? coverColors[1] : primary
      var tertiaryC = coverColors[2] !== undefined ? coverColors[2] : secondaryC
      var quaternaryC = coverColors[3] !== undefined ? coverColors[3] : primary
      var quinaryC = coverColors[4] !== undefined ? coverColors[4] : secondaryC
      var senaryC = coverColors[5] !== undefined ? coverColors[5] : tertiaryC
      return {
        ditheringBack: tertiaryC,
        ditheringFront: primary,
        mesh: [primary, secondaryC, tertiaryC, quaternaryC, quinaryC, senaryC]
      }
    }
    var secondary = coverColors[1] !== undefined ? coverColors[1] : theme.primaryColor
    var tertiary = coverColors[2] !== undefined ? coverColors[2] : primary
    var quaternary = coverColors[3] !== undefined ? coverColors[3] : secondary
    return {
      ditheringBack: theme.backgroundColor,
      ditheringFront: primary,
      mesh: [primary, secondary, tertiary, quaternary, theme.backgroundColor, theme.accentColor]
    }
  }

  function create(config) {
    var tuning = Object.assign({}, TUNING, config || {})
    var showDithering = tuning.displayMode !== 'mesh'
    var showMesh = tuning.displayMode !== 'dithering'

    var host = null
    var root = null
    var meshLayer = null
    var ditheringLayer = null
    var overlayEl = null
    var meshMountHandle = null
    var ditheringMountHandle = null

    var theme = null
    var coverUrl = null
    var coverColors = []
    var staticMode = false

    // 音频平滑状态（原版 useEffect 内闭包变量）
    var smoothedPower = 0
    var smoothedBass = 0
    var smoothedMid = 0
    var smoothedBeatSpeed = 0
    var previousBeatEnergy = 0
    var latentOnsetPulse = 0
    var paused = false

    function mount(hostEl) {
      host = hostEl

      root = document.createElement('div')
      root.style.cssText = 'position:absolute;inset:0;z-index:0;overflow:hidden;pointer-events:none;background-color:' + (theme ? theme.backgroundColor : '#09090b')
      host.appendChild(root)

      if (showMesh) {
        meshLayer = document.createElement('div')
        meshLayer.style.cssText = 'position:absolute;inset:0;transform:scale(1.025);transform-origin:center'
        root.appendChild(meshLayer)
      }
      if (showDithering) {
        ditheringLayer = document.createElement('div')
        ditheringLayer.style.cssText = [
          'position:absolute', 'inset:0',
          'mix-blend-mode:' + (showMesh ? 'soft-light' : 'normal'),
          'opacity:' + (showMesh ? tuning.ditheringOpacity : 1),
          'transform:scale(1.015)',
          'transform-origin:center'
        ].join(';')
        root.appendChild(ditheringLayer)
      }

      if (tuning.overlayEnabled && tuning.overlayOpacity > 0) {
        overlayEl = document.createElement('div')
        overlayEl.style.cssText = 'position:absolute;inset:0;background-color:' + (theme ? theme.backgroundColor : '#09090b') + ';opacity:' + tuning.overlayOpacity
        root.appendChild(overlayEl)
      }

      rebuildShaders()
    }

    // （重）挂载 shader 实例
    function rebuildShaders() {
      disposeShaders()
      if (!window.FoliaPaperMount || !theme) return

      var shaderColors = resolveShaderColors(coverColors, theme, tuning.colorSource)
      var paperMount = window.FoliaPaperMount

      if (showMesh && meshLayer) {
        paperMount.mountPaperShader(meshLayer, 'meshGradient', {
          colors: shaderColors.mesh,
          distortion: tuning.meshDistortion,
          swirl: tuning.meshSwirl,
          grainMixer: 0,
          grainOverlay: 0.01
        }, {
          speed: staticMode ? 0 : resolveShaderSpeed(tuning.meshSpeed, tuning.meshAudioSpeed, 0, paused),
          minPixelRatio: 1,
          maxPixelCount: MAX_SHADER_PIXELS
        }).then(function (handle) {
          meshMountHandle = handle
          if (!meshLayer || !meshLayer.isConnected) handle.dispose()
        }).catch(function (err) { console.warn('[Latent] mesh shader 挂载失败', err) })
      }

      if (showDithering && ditheringLayer) {
        paperMount.mountPaperShader(ditheringLayer, 'dithering', {
          colorBack: shaderColors.ditheringBack,
          colorFront: shaderColors.ditheringFront,
          shape: 'warp',
          type: '4x4',
          size: tuning.ditheringSize
        }, {
          speed: staticMode ? 0 : resolveShaderSpeed(tuning.ditheringSpeed, tuning.ditheringAudioSpeed, 0, paused),
          minPixelRatio: 1,
          maxPixelCount: MAX_SHADER_PIXELS
        }).then(function (handle) {
          ditheringMountHandle = handle
          if (!ditheringLayer || !ditheringLayer.isConnected) handle.dispose()
        }).catch(function (err) { console.warn('[Latent] dithering shader 挂载失败', err) })
      }
    }

    function disposeShaders() {
      if (meshMountHandle) { try { meshMountHandle.dispose() } catch (e) { /* 忽略 */ } meshMountHandle = null }
      if (ditheringMountHandle) { try { ditheringMountHandle.dispose() } catch (e) { /* 忽略 */ } ditheringMountHandle = null }
    }

    function setTheme(newTheme) {
      theme = newTheme
      if (root) root.style.backgroundColor = theme.backgroundColor
      if (overlayEl) overlayEl.style.backgroundColor = theme.backgroundColor
      rebuildShaders()
    }

    function setCoverUrl(url) {
      if (coverUrl === url) return
      coverUrl = url

      if (!coverUrl) {
        coverColors = []
        rebuildShaders()
        return
      }

      // 封面代表色（加权中位切分，6 色）
      ThemeUtil.extractRepresentativeColors(coverUrl, 6).then(function (colors) {
        coverColors = colors || []
        rebuildShaders()
      }).catch(function () {
        coverColors = []
        rebuildShaders()
      })
    }

    // 音频响应（原版 rAF 循环 updateAudioResponse → tick 驱动）
    function tick(frameState) {
      if (!root) return
      paused = frameState.isPlaying === false
      var bands = frameState.audioBands || {}

      var bassRaw = (bands.bass || 0) * 255
      var lowMidRaw = (bands.lowMid || 0) * 255
      var midRaw = (bands.mid || 0) * 255
      var vocalRaw = (bands.vocal || 0) * 255
      var trebleRaw = (bands.treble || 0) * 255
      var powerRaw = (frameState.audioPower || 0) * 255

      var targetPower = paused ? 0 : normalizeAudio(powerRaw)
      var targetBass = paused ? 0 : normalizeAudio(bassRaw)
      var targetBeatEnergy = paused
        ? 0
        : resolveBroadbandEnergy(bassRaw, lowMidRaw, midRaw, vocalRaw, trebleRaw)
      var targetMid = paused ? 0 : normalizeAudio(Math.max(midRaw, vocalRaw))

      smoothedPower = easeTowards(smoothedPower, targetPower, 0.12)
      smoothedBass = easeTowards(smoothedBass, targetBass, 0.16)
      smoothedMid = easeTowards(smoothedMid, targetMid, 0.13)

      latentOnsetPulse = tuning.enhancedBeatResponse
        ? resolveOnsetPulse(targetBeatEnergy, previousBeatEnergy, latentOnsetPulse)
        : 0
      previousBeatEnergy = targetBeatEnergy

      var beatSpeedTarget = resolveAudioSpeedTarget(targetBeatEnergy, latentOnsetPulse, tuning.enhancedBeatResponse)
      smoothedBeatSpeed = easeTowards(
        smoothedBeatSpeed,
        beatSpeedTarget,
        beatSpeedTarget > smoothedBeatSpeed ? 0.42 : 0.14
      )

      if (ditheringMountHandle) {
        ditheringMountHandle.setSpeed(resolveShaderSpeed(tuning.ditheringSpeed, tuning.ditheringAudioSpeed, smoothedBeatSpeed, paused))
        ditheringMountHandle.setUniforms({
          u_pxSize: Math.max(0.5, tuning.ditheringSize - smoothedBass * tuning.ditheringSize * 0.34)
        })
      }
      if (meshMountHandle) {
        meshMountHandle.setSpeed(resolveShaderSpeed(tuning.meshSpeed, tuning.meshAudioSpeed, smoothedBeatSpeed, paused))
        meshMountHandle.setUniforms({
          u_distortion: tuning.meshDistortion + smoothedPower * 0.62,
          u_swirl: tuning.meshSwirl + smoothedMid * 0.38
        })
      }

      if (ditheringLayer) {
        ditheringLayer.style.opacity = showMesh
          ? String(Math.min(1, tuning.ditheringOpacity + smoothedBass * 0.25))
          : '1'
        ditheringLayer.style.transform = 'scale(' + (1.015 + smoothedBass * 0.025) + ')'
      }
      if (meshLayer) {
        meshLayer.style.filter = 'saturate(' + (1.04 + smoothedMid * 0.34) + ') brightness(' + (0.94 + smoothedPower * 0.16) + ')'
        meshLayer.style.transform = 'scale(' + (1.025 + smoothedPower * 0.018) + ')'
      }
    }

    function destroy() {
      disposeShaders()
      if (root) { root.remove(); root = null }
      meshLayer = null
      ditheringLayer = null
      overlayEl = null
      host = null
    }

    return {
      id: 'latent',
      mount: mount,
      setTheme: setTheme,
      setCoverUrl: setCoverUrl,
      tick: tick,
      destroy: destroy
    }
  }

  window.FoliaBgLatent = { create: create }
})()
