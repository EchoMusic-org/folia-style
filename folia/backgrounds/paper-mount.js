// PaperShaders 适配层：桥接 @paper-design/shaders core 包（window.PaperShaders）
// 复刻 @paper-design/shaders-react 的 uniforms 组装逻辑（props → ShaderMount uniforms），
// 包含图片 URL 预加载（原版 processUniforms）。
(function () {
  'use strict'

  var P = null // PaperShaders 全局

  function paper() {
    if (!P) P = window.PaperShaders
    return P
  }

  // 原版 defaultObjectSizing（shader-sizing.js）
  var DEFAULT_OBJECT_SIZING = { fit: 'contain', scale: 1, rotation: 0, offsetX: 0, offsetY: 0, originX: 0.5, originY: 0.5, worldWidth: 0, worldHeight: 0 }

  function sizingUniforms(params) {
    var p = Object.assign({}, DEFAULT_OBJECT_SIZING, params || {})
    return {
      u_fit: paper().ShaderFitOptions[p.fit],
      u_rotation: p.rotation,
      u_scale: p.scale,
      u_offsetX: p.offsetX,
      u_offsetY: p.offsetY,
      u_originX: p.originX,
      u_originY: p.originY,
      u_worldWidth: p.worldWidth,
      u_worldHeight: p.worldHeight
    }
  }

  // 图片 URL → HTMLImageElement（原版 processUniforms 的图片路径；外部 URL 加 crossOrigin）
  function loadImage(url) {
    return new Promise(function (resolve, reject) {
      var img = new Image()
      var isExternal = false
      try {
        var urlObject = new URL(url, window.location.origin)
        isExternal = urlObject.origin !== window.location.origin
      } catch (e) { /* 非法 URL 当内部处理 */ }
      if (isExternal) img.crossOrigin = 'anonymous'
      img.onload = function () { resolve(img) }
      img.onerror = function () { reject(new Error('图片加载失败: ' + url)) }
      img.src = url || paper().emptyPixel
    })
  }

  // 各 shader 的 uniforms 组装（与 shaders-react 各组件逻辑一致）
  var BUILDERS = {
    meshGradient: function (params) {
      var colors = params.colors || []
      return Object.assign({
        u_colors: colors.map(paper().getShaderColorFromString),
        u_colorsCount: colors.length,
        u_distortion: params.distortion,
        u_swirl: params.swirl,
        u_grainMixer: params.grainMixer,
        u_grainOverlay: params.grainOverlay
      }, sizingUniforms(params))
    },
    dithering: function (params) {
      return Object.assign({
        u_colorBack: paper().getShaderColorFromString(params.colorBack),
        u_colorFront: paper().getShaderColorFromString(params.colorFront),
        u_shape: paper().DitheringShapes[params.shape],
        u_type: paper().DitheringTypes[params.type],
        u_pxSize: params.size
      }, sizingUniforms(params))
    },
    imageDithering: function (params, image) {
      return Object.assign({
        u_image: image,
        u_colorFront: paper().getShaderColorFromString(params.colorFront),
        u_colorBack: paper().getShaderColorFromString(params.colorBack),
        u_colorHighlight: paper().getShaderColorFromString(params.colorHighlight),
        u_type: paper().DitheringTypes[params.type],
        u_pxSize: params.size,
        u_colorSteps: params.colorSteps,
        u_originalColors: params.originalColors,
        u_inverted: params.inverted
      }, sizingUniforms(params))
    },
    halftoneDots: function (params, image) {
      return Object.assign({
        u_image: image,
        u_colorFront: paper().getShaderColorFromString(params.colorFront),
        u_colorBack: paper().getShaderColorFromString(params.colorBack),
        u_size: params.size,
        u_radius: params.radius,
        u_contrast: params.contrast,
        u_originalColors: params.originalColors,
        u_inverted: params.inverted,
        u_grainMixer: params.grainMixer,
        u_grainOverlay: params.grainOverlay,
        u_grainSize: params.grainSize,
        u_grid: paper().HalftoneDotsGrids[params.grid],
        u_type: paper().HalftoneDotsTypes[params.type]
      }, sizingUniforms(params))
    },
    lensDistortion: function (params, image) {
      return Object.assign({
        u_image: image,
        u_spread: params.spread,
        u_bias: params.bias,
        u_angle: params.angle,
        u_perspective: params.perspective,
        u_count: params.count,
        u_dispersion: params.dispersion,
        u_dispersionShift: params.dispersionShift,
        u_dispersionColor: params.dispersionColor,
        u_focusCenter: params.focusCenter,
        u_focusEdges: params.focusEdges,
        u_swirl: params.swirl,
        u_noise: params.noise,
        u_noiseFrequency: params.noiseFrequency,
        u_noiseOffset: params.noiseOffset,
        u_lensBulge: params.lensBulge,
        u_lensCircle: params.lensCircle,
        u_grainMixer: params.grainMixer,
        u_grainOverlay: params.grainOverlay,
        u_imageX: params.imageX,
        u_imageY: params.imageY
      }, sizingUniforms(params))
    },
    paperTexture: function (params, image) {
      var noiseUniforms = { u_noiseTexture: paper().getShaderNoiseTexture() }
      return Object.assign({
        u_image: image,
        u_colorFront: paper().getShaderColorFromString(params.colorFront),
        u_colorBack: paper().getShaderColorFromString(params.colorBack),
        u_contrast: params.contrast,
        u_roughness: params.roughness,
        u_fiber: params.fiber,
        u_fiberSize: params.fiberSize,
        u_crumples: params.crumples,
        u_crumpleSize: params.crumpleSize,
        u_foldCount: params.foldCount,
        u_folds: params.folds,
        u_fade: params.fade,
        u_drops: params.drops,
        u_seed: params.seed
      }, noiseUniforms, sizingUniforms(params))
    },
    flutedGlass: function (params, image) {
      return Object.assign({
        u_image: image,
        u_colorBack: paper().getShaderColorFromString(params.colorBack),
        u_colorShadow: paper().getShaderColorFromString(params.colorShadow),
        u_colorHighlight: paper().getShaderColorFromString(params.colorHighlight),
        u_shadows: params.shadows,
        u_size: params.size,
        u_angle: params.angle,
        u_distortion: params.distortion,
        u_shift: params.shift,
        u_blur: params.blur,
        u_edges: params.edges,
        u_stretch: params.stretch,
        u_distortionShape: paper().GlassDistortionShapes[params.distortionShape],
        u_highlights: params.highlights,
        u_shape: paper().GlassGridShapes[params.shape],
        u_marginLeft: params.marginLeft,
        u_marginRight: params.marginRight,
        u_marginTop: params.marginTop,
        u_marginBottom: params.marginBottom,
        u_grainMixer: params.grainMixer,
        u_grainOverlay: params.grainOverlay
      }, sizingUniforms(params))
    }
  }

  var FRAGMENT_SHADERS = {
    meshGradient: 'meshGradientFragmentShader',
    dithering: 'ditheringFragmentShader',
    imageDithering: 'imageDitheringFragmentShader',
    halftoneDots: 'halftoneDotsFragmentShader',
    lensDistortion: 'lensDistortionFragmentShader',
    paperTexture: 'paperTextureFragmentShader',
    flutedGlass: 'flutedGlassFragmentShader'
  }

  // 各 shader 需要的 mipmap uniform 名（原版 lensDistortion/paperTexture/flutedGlass 为 ["u_image"]）
  var MIPMAPS = {
    lensDistortion: ['u_image'],
    paperTexture: ['u_image'],
    flutedGlass: ['u_image']
  }

  var IMAGE_SHADERS = { imageDithering: true, halftoneDots: true, lensDistortion: true, paperTexture: true, flutedGlass: true }

  /**
   * 挂载 Paper shader
   * @param parentEl 宿主 div（shader canvas 匹配其尺寸）
   * @param shaderKey BUILDERS 键
   * @param params shader 参数（含颜色字符串/图片 URL）
   * @param opts { speed, minPixelRatio, maxPixelCount, webGlContextAttributes, frame }
   * @returns Promise<{ mount, setUniforms, setSpeed, dispose }>
   */
  function mountPaperShader(parentEl, shaderKey, params, opts) {
    opts = opts || {}
    var paperLib = paper()
    if (!paperLib || !paperLib.ShaderMount) {
      return Promise.reject(new Error('PaperShaders 未加载'))
    }

    var fragmentShader = paperLib[FRAGMENT_SHADERS[shaderKey]]
    if (!fragmentShader) {
      return Promise.reject(new Error('未知 shader: ' + shaderKey))
    }

    var useImage = IMAGE_SHADERS[shaderKey]
    var imagePromise = useImage ? loadImage(params.image) : Promise.resolve(null)

    return imagePromise.then(function (image) {
      var build = BUILDERS[shaderKey]
      var uniforms = build(params, image)

      var mountInstance = new paperLib.ShaderMount(
        parentEl,
        fragmentShader,
        uniforms,
        opts.webGlContextAttributes,
        opts.speed,
        opts.frame || 0,
        opts.minPixelRatio,
        opts.maxPixelCount,
        MIPMAPS[shaderKey]
      )

      return {
        mount: mountInstance,
        setUniforms: function (newUniforms) { mountInstance.setUniforms(newUniforms) },
        setSpeed: function (speed) { mountInstance.setSpeed(speed) },
        dispose: function () { mountInstance.dispose() }
      }
    })
  }

  window.FoliaPaperMount = {
    mountPaperShader: mountPaperShader,
    sizingUniforms: sizingUniforms,
    loadImage: loadImage
  }
})()
