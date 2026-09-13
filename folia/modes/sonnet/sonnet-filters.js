// 商籁模式·滤镜：移植自 folia-major
//   sonnet/sonnetLensFilter.ts（单 pass 径向镜头滤镜 + 屏幕空间色散）
//   sonnet/sonnetGlitchFilter.ts（单色安全的水平切片/撕裂故障转场滤镜）
//   sonnet/sonnetPrintFilters.ts（固定参数印刷风格滤镜：RGB 偏移/半调网屏/暗角）
//   sonnet/sonnetPostProcess.ts（后处理档案解析 + 辉光层 + 全场景滤镜装配）
// GLSL（GLSL ES 3.00 语法，Pixi 8 Filter 管线）逐字照搬，参数一一对应。
(function () {
  'use strict'

  var Core = window.FoliaSonnetCore

  // ---------- 顶点着色器（三个滤镜共用，原版逐字一致） ----------
  var VERTEX = `
in vec2 aPosition;
out vec2 vTextureCoord;

uniform vec4 uInputSize;
uniform vec4 uOutputFrame;
uniform vec4 uOutputTexture;

void main(void) {
    vec2 position = aPosition * uOutputFrame.zw + uOutputFrame.xy;
    position.x = position.x * (2.0 / uOutputTexture.x) - 1.0;
    position.y = position.y * (2.0 * uOutputTexture.z / uOutputTexture.y) - uOutputTexture.z;
    gl_Position = vec4(position, 0.0, 1.0);
    vTextureCoord = aPosition * (uOutputFrame.zw * uInputSize.zw);
}
`

  // ---------- 镜头滤镜（原版 sonnetLensFilter.ts） ----------
  var LENS_FRAGMENT = `
in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform highp vec4 uInputSize;
uniform vec4 uInputClamp;
uniform highp vec4 uOutputFrame;
uniform float uDistortion;
uniform float uDispersion;

vec2 screenToTextureUv(vec2 screenUv) {
    return screenUv * uOutputFrame.zw * uInputSize.zw;
}

vec4 sampleInside(vec2 uv) {
    if (uv.x < uInputClamp.x || uv.y < uInputClamp.y
        || uv.x > uInputClamp.z || uv.y > uInputClamp.w) {
        return vec4(0.0);
    }
    return texture(uTexture, uv);
}

void main(void) {
    vec2 screenUv = vTextureCoord * uInputSize.xy / max(uOutputFrame.zw, vec2(1.0));
    vec2 centered = screenUv - 0.5;
    float aspect = uOutputFrame.z / max(uOutputFrame.w, 1.0);
    centered.x *= aspect;

    float radiusSquared = dot(centered, centered);
    // 低端保持克制，但为参考观感的宽幅桶形畸变留足余量；UI 侧暴露为 0..2 的量
    float curvature = uDistortion * 0.32;
    float radialScale = 1.0 - curvature * radiusSquared
        + curvature * 0.16 * radiusSquared * radiusSquared;
    vec2 lensCentered = centered * radialScale;
    lensCentered.x /= aspect;
    vec2 lensUv = lensCentered + 0.5;

    float radius = sqrt(radiusSquared);
    vec2 radialDirection = radius > 0.0001 ? centered / radius : vec2(0.0);
    float edgeWeight = smoothstep(0.12, 0.9, radius);
    vec2 dispersion = radialDirection * uDispersion * 0.012 * edgeWeight;
    dispersion.x /= aspect;

    vec4 center = sampleInside(screenToTextureUv(lensUv));
    vec4 redSample = sampleInside(screenToTextureUv(lensUv + dispersion));
    vec4 blueSample = sampleInside(screenToTextureUv(lensUv - dispersion));
    float alpha = max(center.a, max(redSample.a, blueSample.a));
    float coreWeight = 0.84 - clamp(uDispersion, 0.0, 1.0) * 0.18;
    vec3 core = center.rgb * coreWeight;
    vec3 separated = vec3(redSample.r, center.g, blueSample.b);
    // 为细 MG 线条保留中性内核，再叠加位移通道作为彩色边缘。
    // 没有这个兜底，一条单像素线可能采样到透明红/蓝纹素而变成意外的纯绿线条。
    vec3 color = max(core, separated);

    // Pixi 渲染纹理是预乘的；max 后的通道值仍是预乘的。
    finalColor = vec4(color, alpha);
}
`

  function createSonnetLensFilter(pixi, amounts) {
    var uniforms = new pixi.UniformGroup({
      uDistortion: { value: amounts.distortion, type: 'f32' },
      uDispersion: { value: amounts.dispersion, type: 'f32' }
    })
    return new pixi.Filter({
      glProgram: pixi.GlProgram.from({
        vertex: VERTEX,
        fragment: LENS_FRAGMENT,
        name: 'sonnet-lens-distortion'
      }),
      resources: { lensUniforms: uniforms },
      antialias: 'on'
    })
  }

  // ---------- 故障滤镜（原版 sonnetGlitchFilter.ts） ----------
  var GLITCH_FRAGMENT = `
in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform vec4 uInputClamp;
uniform float uAmount;
uniform float uSeed;

float hash(vec2 value) {
    return fract(sin(dot(value, vec2(12.9898, 78.233))) * 43758.5453);
}

void main(void) {
    float coarseBand = floor(vTextureCoord.y * 26.0);
    float fineBand = floor(vTextureCoord.y * 110.0);
    float coarseNoise = hash(vec2(coarseBand, uSeed));
    float fineNoise = hash(vec2(fineBand + 41.0, uSeed * 1.37));
    float coarseGate = step(0.58, coarseNoise);
    float fineGate = step(0.88, fineNoise);
    float coarseShift = (hash(vec2(coarseBand + 17.0, uSeed)) * 2.0 - 1.0)
        * coarseGate * uAmount * 0.095;
    float fineShift = (hash(vec2(fineBand + 73.0, uSeed)) * 2.0 - 1.0)
        * fineGate * uAmount * 0.035;
    vec2 sampleUv = vec2(vTextureCoord.x + coarseShift + fineShift, vTextureCoord.y);
    vec4 color = texture(uTexture, clamp(sampleUv, uInputClamp.xy, uInputClamp.zw));

    // 亮度撕裂对所有通道等同影响：有故障结构而无 RGB 色散。
    float tear = (coarseGate * (coarseNoise - 0.58) + fineGate * 0.12) * uAmount;
    color.rgb *= 1.0 + tear * 0.42;
    finalColor = color;
}
`

  function createSonnetGlitchEffect(pixi) {
    var uniforms = new pixi.UniformGroup({
      uAmount: { value: 0, type: 'f32' },
      uSeed: { value: 0, type: 'f32' }
    })
    var filter = new pixi.Filter({
      glProgram: pixi.GlProgram.from({ vertex: VERTEX, fragment: GLITCH_FRAGMENT, name: 'sonnet-mono-glitch' }),
      resources: { glitchUniforms: uniforms },
      // padding 必须为 0：Pixi 把链上每个启用滤镜的 padding 求和，并在裁剪到视口后
      // 扩大共享渲染帧——这里的 padding 只会加入屏幕外的像素，同时移动暗角 pass
      // 推导屏幕坐标所用的帧，导致每次故障转场暗角外弹。撕裂采样用 uInputClamp，无需额外边距。
      padding: 0
    })
    filter.enabled = false
    return {
      filter: filter,
      update: function (amount, seed) {
        uniforms.uniforms.uAmount = amount
        uniforms.uniforms.uSeed = seed
      }
    }
  }

  // ---------- 印刷滤镜（原版 sonnetPrintFilters.ts） ----------
  // 固定 RGB 色差：沿固定 25 度轴约 1.25px 的分离
  var RGB_SHIFT_FRAGMENT = `
in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform highp vec4 uInputSize;
uniform vec4 uInputClamp;
uniform float uAmount;

vec4 sampleInside(vec2 uv) {
    if (uv.x < uInputClamp.x || uv.y < uInputClamp.y
        || uv.x > uInputClamp.z || uv.y > uInputClamp.w) {
        return vec4(0.0);
    }
    return texture(uTexture, uv);
}

void main(void) {
    vec2 offset = vec2(0.9063, 0.4226) * uAmount * 3.0 * uInputSize.zw;
    vec4 redSample = sampleInside(vTextureCoord + offset);
    vec4 center = sampleInside(vTextureCoord);
    vec4 blueSample = sampleInside(vTextureCoord - offset);
    float alpha = max(center.a, max(redSample.a, blueSample.a));
    float coreWeight = 0.84 - clamp(uAmount, 0.0, 1.0) * 0.18;
    vec3 core = center.rgb * coreWeight;
    vec3 separated = vec3(redSample.r, center.g, blueSample.b);
    // 为细线条保留中性内核，避免透明红/蓝偏移采样把白色 MG 线变成意外的纯绿结果
    finalColor = vec4(max(core, separated), alpha);
}
`

  // 单采样半调网屏：点阵按经典 CMYK 角度逐 RGB 通道加网，暗部保持暗，不引入纸色
  var HALFTONE_FRAGMENT = `
in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform float uAmount;

float dotScreen(vec2 fragCoord, float angle, float value, float cellSize) {
    float c = cos(angle);
    float s = sin(angle);
    vec2 rotated = mat2(c, s, -s, c) * fragCoord;
    float dist = length(fract(rotated / cellSize) - 0.5) * cellSize;
    float radius = sqrt(clamp(value, 0.0, 1.0)) * cellSize * 0.62;
    return 1.0 - smoothstep(radius - 1.2, radius + 1.2, dist);
}

void main(void) {
    vec4 color = texture(uTexture, vTextureCoord);
    if (color.a > 0.0) {
        color.rgb /= color.a;
    }
    float cellSize = 5.0;
    vec3 screened = vec3(
        dotScreen(gl_FragCoord.xy, radians(15.0), color.r, cellSize),
        dotScreen(gl_FragCoord.xy, radians(75.0), color.g, cellSize),
        dotScreen(gl_FragCoord.xy, radians(0.0), color.b, cellSize)
    );
    color.rgb = mix(color.rgb, screened, uAmount);
    color.rgb *= color.a;
    finalColor = color;
}
`

  // 固定暗角：向屏幕边缘压暗。在屏幕空间计算（输入纹理可随镜头平移延伸出视口），
  // 并朝不透明黑色混合，因此也能盖在场景的透明背景上。
  var VIGNETTE_FRAGMENT = `
in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform highp vec4 uInputSize;
uniform highp vec4 uOutputFrame;
uniform float uAmount;

void main(void) {
    vec4 color = texture(uTexture, vTextureCoord);
    // 被过滤的容器使用视口尺寸的 filterArea，这里据此还原稳定的 0..1 视口坐标，
    // 而不是从歌词边界推导的坐标。
    vec2 screenUv = vTextureCoord * uInputSize.xy / uOutputFrame.zw;
    vec2 centered = screenUv - 0.5;
    centered.x *= uOutputFrame.z / uOutputFrame.w;
    float vignette = clamp(smoothstep(0.52, 1.08, length(centered)) * uAmount * 0.6, 0.0, 1.0);
    finalColor = mix(color, vec4(0.0, 0.0, 0.0, 1.0), vignette);
}
`

  function createPrintPass(pixi, name, fragment, amount) {
    return new pixi.Filter({
      glProgram: pixi.GlProgram.from({ vertex: VERTEX, fragment: fragment, name: name }),
      resources: {
        printUniforms: new pixi.UniformGroup({
          uAmount: { value: amount, type: 'f32' }
        })
      },
      // 应用画布开了 MSAA（antialias: true），但滤镜 pass 渲染进默认不多重采样的
      // 离屏纹理——细线条会失去抗锯齿变锯齿。这些全场景 pass 保持 MSAA 开启。
      antialias: 'on'
    })
  }

  function createSonnetPrintFilters(pixi, amounts) {
    var filters = []
    if (amounts.rgbShift > 0) filters.push(createPrintPass(pixi, 'sonnet-print-rgb-shift', RGB_SHIFT_FRAGMENT, amounts.rgbShift))
    if (amounts.halftone > 0) filters.push(createPrintPass(pixi, 'sonnet-print-halftone', HALFTONE_FRAGMENT, amounts.halftone))
    if (amounts.vignette > 0) filters.push(createPrintPass(pixi, 'sonnet-print-vignette', VIGNETTE_FRAGMENT, amounts.vignette))
    return filters
  }

  // ---------- 后处理（原版 sonnetPostProcess.ts） ----------
  function resolveSonnetPostProcessProfile(theme, tuning, staticMode) {
    if (staticMode) {
      return {
        glowStrength: 0,
        glowAlpha: 0,
        noise: 0,
        contrast: 0,
        glitchIntensity: 0,
        lensDistortion: 0,
        lensDispersion: 0,
        printEffects: { rgbShift: 0, halftone: 0, vignette: 0 }
      }
    }
    var motion = tuning.typographyMotion * Core.resolveSonnetAnimationScale(theme)
    var postEnabled = tuning.postProcessEnabled
    return {
      glowStrength: 2.8 + motion * 1.8,
      glowAlpha: Math.min(0.62, 0.28 + motion * 0.12),
      // 可选胶片颗粒，上限克制以保证文字清晰
      noise: postEnabled ? tuning.postProcessGrain * 0.35 : 0,
      // Pixi 的 contrast 是加量：0 为中性，0.5 产生 1.5x 的矩阵乘子
      contrast: postEnabled ? tuning.postProcessContrast * 0.5 : 0,
      // 供转场期间使用
      glitchIntensity: 1,
      lensDistortion: postEnabled ? tuning.postProcessLensDistortion : 0,
      lensDispersion: postEnabled ? tuning.postProcessLensDispersion : 0,
      // 固定印刷风格 pass 跟随总开关，各自由 0..1 滑杆缩放
      printEffects: postEnabled
        ? {
          rgbShift: tuning.postProcessRgbShift,
          halftone: tuning.postProcessHalftone,
          vignette: tuning.postProcessVignette
        }
        : { rgbShift: 0, halftone: 0, vignette: 0 }
    }
  }

  function createSonnetHaloLayer(pixi, profile) {
    var layer = new pixi.Container()
    var filters = []
    if (profile.glowStrength > 0) {
      var blur = new pixi.BlurFilter({
        strength: profile.glowStrength,
        quality: 2,
        kernelSize: 5,
        resolution: 0.75
      })
      layer.filters = [blur]
      layer.alpha = profile.glowAlpha
      layer.blendMode = 'screen'
      filters.push(blur)
    }
    return { layer: layer, filters: filters }
  }

  function applySonnetScenePostProcess(pixi, container, profile, seed) {
    var filters = []

    // 镜头弯曲在调色与印刷 pass 之前运行，半调/暗角跟随扭曲后的帧
    if (profile.lensDistortion > 0 || profile.lensDispersion > 0) {
      filters.push(createSonnetLensFilter(pixi, {
        distortion: profile.lensDistortion,
        dispersion: profile.lensDispersion
      }))
    }

    // 印刷/胶片颗粒噪点
    if (profile.noise > 0) {
      var noise = new pixi.NoiseFilter({
        noise: profile.noise,
        seed: (seed % 10000) / 10000,
        antialias: 'on' // 滤镜纹理绕过画布 MSAA；细线条需要补回
      })
      filters.push(noise)
    }

    // ColorMatrix 对比度保持可选（默认 profile.contrast === 0），
    // 因为它会让细背景线条产生锯齿——用户通过 tuning 启用
    if (profile.contrast > 0) {
      var colorMatrix = new pixi.ColorMatrixFilter()
      colorMatrix.contrast(profile.contrast, false)
      colorMatrix.antialias = 'on'
      filters.push(colorMatrix)
    }

    // 固定印刷风格 pass（RGB 偏移、半调、抖动、暗角）最后执行，
    // 让半调网屏与暗角框住已调色的场景
    var printFilters = createSonnetPrintFilters(pixi, profile.printEffects)
    if (printFilters.length > 0) {
      for (var i = 0; i < printFilters.length; i += 1) filters.push(printFilters[i])
    }

    if (filters.length > 0) {
      container.filters = filters
    }
    return filters
  }

  window.FoliaSonnetFilters = {
    createSonnetLensFilter: createSonnetLensFilter,
    createSonnetGlitchEffect: createSonnetGlitchEffect,
    createSonnetPrintFilters: createSonnetPrintFilters,
    resolveSonnetPostProcessProfile: resolveSonnetPostProcessProfile,
    createSonnetHaloLayer: createSonnetHaloLayer,
    applySonnetScenePostProcess: applySonnetScenePostProcess
  }
})()
