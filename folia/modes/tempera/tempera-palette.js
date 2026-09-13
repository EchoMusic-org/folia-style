// 凝彩模式·调色板与文字反色：移植自 folia-major src/components/visualizer/tempera/
//   temperaPalette.ts（从主题派生 duo/mono/gradient 调色板）
//   temperaDifferenceFilter.ts（歌词层单 pass 阈值反色滤镜，GLSL 逐字照搬）
//   src/utils/colorExtractor.ts + src/utils/colorPalette.ts（封面代表色提取，加权中位切分）
(function () {
  'use strict'

  var ColorMix = window.FoliaColorMix
  var colorWithAlpha = ColorMix.colorWithAlpha
  var mixColors = ColorMix.mixColors
  var parseColorChannels = ColorMix.parseColorChannels

  // ---------- 封面代表色提取（原版 colorExtractor.ts + colorPalette.ts） ----------
  // 把封面缩到 50x50 取像素，再用加权中位切分（median cut）提出 count 个代表色，
  // 大面积色块的权重高于小面积高饱和细节
  var QUANTIZATION_SHIFT = 4
  var MIN_ALPHA = 128

  function loadImagePixels(imageUrl) {
    return new Promise(function (resolve) {
      var img = new Image()
      img.crossOrigin = 'Anonymous'

      img.onload = function () {
        var canvas = document.createElement('canvas')
        var ctx = canvas.getContext('2d')
        if (!ctx) {
          resolve(null)
          return
        }
        // 缩小以提速
        var width = 50
        var height = 50
        canvas.width = width
        canvas.height = height
        ctx.drawImage(img, 0, 0, width, height)
        resolve(ctx.getImageData(0, 0, width, height).data)
      }

      img.onerror = function (e) {
        console.warn('[folia-style] 封面取色加载失败', e)
        resolve(null)
      }
      img.src = imageUrl
    })
  }

  function getChannelRange(colors, channel) {
    var min = 255
    var max = 0
    for (var i = 0; i < colors.length; i += 1) {
      min = Math.min(min, colors[i][channel])
      max = Math.max(max, colors[i][channel])
    }
    return max - min
  }

  function splitBucket(bucket) {
    if (bucket.colors.length < 2) return null

    var ranges = {
      r: getChannelRange(bucket.colors, 'r'),
      g: getChannelRange(bucket.colors, 'g'),
      b: getChannelRange(bucket.colors, 'b')
    }
    var channel = 'r'
    if (ranges.g > ranges[channel]) channel = 'g'
    if (ranges.b > ranges[channel]) channel = 'b'
    var sorted = bucket.colors.slice().sort(function (a, b) { return a[channel] - b[channel] })
    var midpoint = bucket.weight / 2
    var accumulatedWeight = 0
    var splitIndex = 1

    for (var index = 0; index < sorted.length - 1; index += 1) {
      accumulatedWeight += sorted[index].weight
      splitIndex = index + 1
      if (accumulatedWeight >= midpoint) break
    }

    var left = sorted.slice(0, splitIndex)
    var right = sorted.slice(splitIndex)
    return [
      { colors: left, weight: left.reduce(function (sum, color) { return sum + color.weight }, 0) },
      { colors: right, weight: right.reduce(function (sum, color) { return sum + color.weight }, 0) }
    ]
  }

  function averageBucket(bucket) {
    var totals = bucket.colors.reduce(function (result, color) {
      return {
        r: result.r + color.r * color.weight,
        g: result.g + color.g * color.weight,
        b: result.b + color.b * color.weight
      }
    }, { r: 0, g: 0, b: 0 })
    return {
      r: Math.round(totals.r / bucket.weight),
      g: Math.round(totals.g / bucket.weight),
      b: Math.round(totals.b / bucket.weight),
      weight: bucket.weight
    }
  }

  function toHex(color) {
    return '#' + color.r.toString(16).padStart(2, '0')
      + color.g.toString(16).padStart(2, '0')
      + color.b.toString(16).padStart(2, '0')
  }

  // 加权中位切分：大面积封面区域比小面积高饱和细节更重要
  function extractRepresentativeColorsFromPixels(pixels, count) {
    if (count <= 0) return []

    var histogram = new Map()
    for (var index = 0; index < pixels.length; index += 4) {
      if (pixels[index + 3] < MIN_ALPHA) continue
      var r = pixels[index]
      var g = pixels[index + 1]
      var b = pixels[index + 2]
      var key = ((r >> QUANTIZATION_SHIFT) << 8)
        | ((g >> QUANTIZATION_SHIFT) << 4)
        | (b >> QUANTIZATION_SHIFT)
      var existing = histogram.get(key)
      if (existing) {
        existing.r += r
        existing.g += g
        existing.b += b
        existing.weight += 1
      } else {
        histogram.set(key, { r: r, g: g, b: b, weight: 1 })
      }
    }

    var colors = Array.from(histogram.values()).map(function (color) {
      return {
        r: Math.round(color.r / color.weight),
        g: Math.round(color.g / color.weight),
        b: Math.round(color.b / color.weight),
        weight: color.weight
      }
    })
    if (colors.length === 0) return []

    var buckets = [{
      colors: colors,
      weight: colors.reduce(function (sum, color) { return sum + color.weight }, 0)
    }]
    while (buckets.length < Math.min(count, colors.length)) {
      var bucketIndex = -1
      var bestScore = -1
      for (var i = 0; i < buckets.length; i += 1) {
        if (buckets[i].colors.length < 2) continue
        var widestRange = Math.max(
          getChannelRange(buckets[i].colors, 'r'),
          getChannelRange(buckets[i].colors, 'g'),
          getChannelRange(buckets[i].colors, 'b')
        )
        var score = widestRange * Math.sqrt(buckets[i].weight)
        if (score > bestScore) {
          bestScore = score
          bucketIndex = i
        }
      }
      if (bucketIndex < 0) break
      var split = splitBucket(buckets[bucketIndex])
      if (!split) break
      buckets.splice(bucketIndex, 1, split[0], split[1])
    }

    return buckets
      .map(averageBucket)
      .sort(function (a, b) { return b.weight - a.weight })
      .map(toHex)
  }

  // 原版 extractRepresentativeColors：像素加载 + 中位切分
  function extractRepresentativeColors(imageUrl, count) {
    if (count === undefined) count = 5
    return loadImagePixels(imageUrl).then(function (pixels) {
      return pixels ? extractRepresentativeColorsFromPixels(pixels, count) : []
    })
  }

  // ---------- 调色板（原版 temperaPalette.ts） ----------
  // 从当前主题派生 Tempera 的色块调色板；mono 模式把每个派生步骤收缩为
  // 灰度墨↔纸阶梯，绝不漏出色相

  // 固定的纸→墨混合位置；网点层把 tone 序号映射到 hatch 密度
  var TEMPERA_TONE_STOPS = [0.12, 0.3, 0.52, 0.72]

  function luminanceOf(color) {
    var channels = parseColorChannels(color)
    if (!channels) return 128
    return channels.r * 0.2126 + channels.g * 0.7152 + channels.b * 0.0722
  }

  // 把颜色折叠到 Rec.709 亮度，mono 色块才是真正的灰度阶梯
  function toGray(color, fallback) {
    var channels = parseColorChannels(color)
    if (!channels) return fallback
    var luminance = Math.round(channels.r * 0.2126 + channels.g * 0.7152 + channels.b * 0.0722)
    return 'rgb(' + luminance + ', ' + luminance + ', ' + luminance + ')'
  }

  function grayLevel(color) {
    var channels = parseColorChannels(color)
    return channels ? channels.r : 128
  }

  var MIN_INK_CONTRAST = 96

  // 保证 ink/paper 真的对比。theme.primaryColor 不做这种承诺：很多主题把浅色
  // primary 配浅色背景，歌词不可读、反色滤镜在两个近似色之间二选一。
  // 发生时把 ink 推到 paper 的另一端，只留一丝主题色相
  function ensureInkContrast(paper, ink) {
    if (Math.abs(luminanceOf(ink) - luminanceOf(paper)) >= MIN_INK_CONTRAST) return ink
    var target = luminanceOf(paper) < 128 ? '#f4f4f2' : '#141414'
    var tinted = mixColors(target, ink, 0.14)
    return Math.abs(luminanceOf(tinted) - luminanceOf(paper)) >= MIN_INK_CONTRAST ? tinted : target
  }

  // 把带色相的颜色重新缩放回未着色档位的亮度，让加色相不改变 tone 阶梯的次序
  function matchLuminance(color, target) {
    var channels = parseColorChannels(color)
    if (!channels) return target
    var current = luminanceOf(color)
    var wanted = luminanceOf(target)
    if (current <= 0.5) return target
    var gain = wanted / current
    var scaled = {
      r: Math.round(Math.min(255, channels.r * gain)),
      g: Math.round(Math.min(255, channels.g * gain)),
      b: Math.round(Math.min(255, channels.b * gain))
    }
    // 亮通道被裁会破坏匹配；回退到中性档位
    if (Math.abs(luminanceOf('rgb(' + scaled.r + ', ' + scaled.g + ', ' + scaled.b + ')') - wanted) > 1.5) {
      return target
    }
    return 'rgb(' + scaled.r + ', ' + scaled.g + ', ' + scaled.b + ')'
  }

  // 构建四档网点阶梯。色相只改彩度：每个着色档位被拉回中性档位的亮度，
  // 纸→墨的亮度次序始终成立
  function buildToneLadder(paper, ink, tintA, tintB) {
    function step(index, tint) {
      var base = mixColors(paper, ink, TEMPERA_TONE_STOPS[index])
      return tint ? matchLuminance(mixColors(base, tint, 0.3), base) : base
    }
    return {
      tone1: step(0, tintA),
      tone2: step(1, tintB),
      tone3: step(2, tintA),
      tone4: step(3)
    }
  }

  // 构建四色渐变 ramp。封面色带色相，但每个先被拉上纸→墨亮度阶梯：
  // 次序错乱的 ramp 会同时破坏构图的明暗结构和读取它的文字反色
  function buildGradientRamp(paper, ink, sources) {
    var usable = sources.map(function (color) { return color.trim() }).filter(Boolean)
    var ranked = usable.slice().sort(function (a, b) { return luminanceOf(a) - luminanceOf(b) })
    var towardInk = luminanceOf(ink) < luminanceOf(paper)
    var ordered = towardInk ? ranked.reverse() : ranked
    return TEMPERA_TONE_STOPS.map(function (stop, index) {
      var rung = mixColors(paper, ink, stop)
      var hue = ordered[index % Math.max(ordered.length, 1)]
      return hue ? matchLuminance(mixColors(rung, hue, 0.78), rung) : rung
    })
  }

  // 让封面色可辨识的同时保证对纸可读。不把它拉上墨阶梯（那正是背景 ramp 变灰的原因），
  // 只把它推离纸的亮度直到过线
  function enforceReadable(paper, color) {
    var paperLuminance = luminanceOf(paper)
    if (Math.abs(luminanceOf(color) - paperLuminance) >= 88) return color
    var away = paperLuminance < 128 ? '#ffffff' : '#101010'
    for (var step = 1; step <= 5; step += 1) {
      var pushed = mixColors(color, away, step * 0.16)
      if (Math.abs(luminanceOf(pushed) - paperLuminance) >= 88) return pushed
    }
    return mixColors(color, away, 0.8)
  }

  // 每个提取到的封面色混入多少主题色。封面保持主导——这正是模式采样的对象——
  // 但纯封面 ramp 会把主题整个丢掉，恰好在最显眼的时候无视用户的配色
  var THEME_HUE_MIX = 0.32

  function blendCoverWithTheme(cover, themeHues) {
    return cover.slice(0, 4).map(function (color, index) {
      return mixColors(color, themeHues[index % themeHues.length], THEME_HUE_MIX)
    })
  }

  function buildTextGradient(paper, sources) {
    var usable = sources.map(function (color) { return color.trim() }).filter(Boolean)
    if (usable.length === 0) return null
    var out = []
    for (var index = 0; index < 4; index += 1) {
      out.push(enforceReadable(paper, usable[index % usable.length]))
    }
    return out
  }

  function resolveTemperaPalette(theme, tuning, coverColors) {
    if (coverColors === undefined) coverColors = []
    if (tuning.colorMode === 'mono') {
      var grayPaper = toGray(theme.backgroundColor, '#111111')
      var grayInk = toGray(theme.primaryColor, '#f5f5f5')
      // 主题的墨是中灰时也保证可读的对比
      if (Math.abs(grayLevel(grayInk) - grayLevel(grayPaper)) < 96) {
        grayInk = grayLevel(grayPaper) < 128 ? '#f2f2f2' : '#141414'
      }
      return Object.assign(
        {
          paper: grayPaper,
          ink: grayInk,
          blockA: mixColors(grayPaper, grayInk, 0.08),
          blockB: mixColors(grayPaper, grayInk, 0.18),
          blockC: mixColors(grayPaper, grayInk, 0.34),
          accent: mixColors(grayPaper, grayInk, 0.85),
          line: colorWithAlpha(mixColors(grayPaper, grayInk, 0.55), 0.55),
          shadow: colorWithAlpha(mixColors(grayPaper, grayInk, 0.75), 0.35)
        },
        buildToneLadder(grayPaper, grayInk),
        { gradient: null, textGradient: null }
      )
    }
    var paper = theme.backgroundColor
    var ink = ensureInkContrast(paper, theme.primaryColor)
    if (tuning.colorMode === 'gradient') {
      // 封面色带 ramp 的色相，每个再向主题色着色，用户配色仍然在场；
      // 还没有封面时主题色独自站住
      var themeHues = [theme.accentColor, theme.secondaryColor, theme.primaryColor, ink]
      var hues = coverColors.length >= 2
        ? blendCoverWithTheme(coverColors, themeHues)
        : themeHues
      var ramp = buildGradientRamp(paper, ink, hues)
      return {
        paper: paper,
        ink: ink,
        blockA: ramp[0],
        blockB: ramp[1],
        blockC: ramp[2],
        accent: theme.accentColor,
        line: colorWithAlpha(mixColors(paper, ink, 0.6), 0.5),
        shadow: colorWithAlpha(mixColors(paper, ink, 0.8), 0.32),
        tone1: ramp[0],
        tone2: ramp[1],
        tone3: ramp[2],
        tone4: ramp[3],
        gradient: ramp,
        textGradient: buildTextGradient(paper, hues)
      }
    }
    return Object.assign(
      {
        paper: paper,
        ink: ink,
        blockA: mixColors(paper, theme.accentColor, 0.55),
        blockB: mixColors(paper, theme.secondaryColor, 0.6),
        blockC: mixColors(paper, ink, 0.78),
        accent: theme.accentColor,
        line: colorWithAlpha(mixColors(paper, ink, 0.6), 0.5),
        shadow: colorWithAlpha(mixColors(paper, ink, 0.8), 0.32)
      },
      // duo 保持同一条亮度阶梯，但中段档位用主题色着色，
      // 网点构图在两种色彩模式下读起来一致
      buildToneLadder(paper, ink, theme.accentColor, theme.secondaryColor),
      { gradient: null, textGradient: null }
    )
  }

  // ---------- 文字反色滤镜（原版 temperaDifferenceFilter.ts） ----------
  // 歌词层的单 pass 阈值反色：采样其下已渲染的画面，每个文字像素涂上
  // ink/paper 中对比更强的那个，无需逐 shot 类型手挑填充色。
  //
  // 它也是 gradient 模式给歌词上色的唯一途径——ramp 以 tint 一起传入。
  // 所以滤镜还有第二个仅着色形态，供用户关掉反色时使用：同一条 ramp、不读底色。
  // 那里整个丢掉滤镜会悄悄带走 gradient 模式的颜色，只剩平墨文字。

  var DIFF_VERTEX = `
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

  // 两种形态共享：底色读取与颜色判定之外的全部
  var DIFF_FRAGMENT_HEAD = `
in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform highp vec4 uInputSize;
uniform highp vec4 uOutputFrame;
uniform vec3 uInkColor;
uniform vec3 uPaperColor;
uniform float uInkLuminance;
uniform float uPaperLuminance;
uniform float uBias;
uniform vec3 uTintA;
uniform vec3 uTintB;
uniform vec3 uTintC;
uniform vec3 uTintD;
uniform float uTintAmount;

// 四档 ramp 沿滤镜自身 bounds 横向采样，颜色因此扫过整行，
// 而不是在每个字内部重复
vec3 sampleTint(float position) {
    float scaled = clamp(position, 0.0, 1.0) * 3.0;
    if (scaled < 1.0) return mix(uTintA, uTintB, scaled);
    if (scaled < 2.0) return mix(uTintB, uTintC, scaled - 1.0);
    return mix(uTintC, uTintD, scaled - 2.0);
}

float tintPosition(vec2 uv) {
    return clamp(uv.x * uInputSize.x / max(uOutputFrame.z, 1.0), 0.0, 1.0);
}
`

  var DIFF_INVERSION_FRAGMENT = DIFF_FRAGMENT_HEAD + `
uniform sampler2D uBackTexture;

float backLuminance(vec2 uv) {
    vec4 back = texture(uBackTexture, uv);
    // Pixi 渲染目标是预乘的；读亮度前先还原
    vec3 straight = back.rgb / max(back.a, 1e-4);
    float lum = dot(straight, vec3(0.2126, 0.7152, 0.0722));
    // 没画任何东西的地方露出外壳背景，那是纸
    return mix(uPaperLuminance, lum, clamp(back.a * 3.0, 0.0, 1.0));
}

void main(void) {
    vec4 front = texture(uTexture, vTextureCoord);
    // 5 点平均让细 hatch 不至于逐像素闪烁反色判定
    vec2 texel = uInputSize.zw * 1.5;
    float lum = backLuminance(vTextureCoord) * 0.4
        + (backLuminance(vTextureCoord + texel)
            + backLuminance(vTextureCoord - texel)
            + backLuminance(vTextureCoord + vec2(texel.x, -texel.y))
            + backLuminance(vTextureCoord + vec2(-texel.x, texel.y))) * 0.15;

    float distanceToPaper = abs(lum - uPaperLuminance);
    float distanceToInk = abs(lum - uInkLuminance);
    // 选离底色更远的那个颜色，无论主题把浅墨配深纸还是反过来，对比都不会塌
    vec3 tone = mix(uInkColor, uPaperColor, step(distanceToInk + uBias, distanceToPaper));

    // 色彩模式对判定结果着色而不是替换：色相来自 ramp，亮度保持反色刚选出的那个。
    // 任何别的方式给文字上色都会扔掉唯一保证它对画面可读的东西
    if (uTintAmount > 0.0) {
        vec3 tint = sampleTint(tintPosition(vTextureCoord));
        float tintLuminance = max(dot(tint, vec3(0.2126, 0.7152, 0.0722)), 1e-3);
        float toneLuminance = dot(tone, vec3(0.2126, 0.7152, 0.0722));
        vec3 matched = clamp(tint * (toneLuminance / tintLuminance), 0.0, 1.0);
        tone = mix(tone, matched, uTintAmount);
    }
    finalColor = vec4(tone * front.a, front.a);
}
`

  // 反色关掉的形态。不拷贝底色，ramp 就是颜色：四档本来就被建到与纸的亮度差
  // 约 88 以上，这正是反色只借出亮度时它们仍然可读的原因
  var DIFF_TINT_ONLY_FRAGMENT = DIFF_FRAGMENT_HEAD + `
void main(void) {
    vec4 front = texture(uTexture, vTextureCoord);
    vec3 tone = uTintAmount > 0.0 ? sampleTint(tintPosition(vTextureCoord)) : uInkColor;
    finalColor = vec4(tone * front.a, front.a);
}
`

  var REC709 = { r: 0.2126, g: 0.7152, b: 0.0722 }

  function toNormalizedRgb(color, fallback) {
    var channels = parseColorChannels(color)
    if (!channels) return fallback
    return [channels.r / 255, channels.g / 255, channels.b / 255]
  }

  function luminanceOfRgb(rgb) {
    return rgb[0] * REC709.r + rgb[1] * REC709.g + rgb[2] * REC709.b
  }

  // options: { ink, paper, threshold?, tint?, inversion? }
  function createTemperaDifferenceFilter(pixi, options) {
    var ink = toNormalizedRgb(options.ink, [1, 1, 1])
    var paper = toNormalizedRgb(options.paper, [0, 0, 0])
    var tint = options.tint && options.tint.length >= 2 ? options.tint : null
    var stops = []
    for (var index = 0; index < 4; index += 1) {
      stops.push(tint ? toNormalizedRgb(tint[Math.min(index, tint.length - 1)], ink) : ink)
    }
    var uniforms = new pixi.UniformGroup({
      uInkColor: { value: new Float32Array(ink), type: 'vec3<f32>' },
      uTintA: { value: new Float32Array(stops[0]), type: 'vec3<f32>' },
      uTintB: { value: new Float32Array(stops[1]), type: 'vec3<f32>' },
      uTintC: { value: new Float32Array(stops[2]), type: 'vec3<f32>' },
      uTintD: { value: new Float32Array(stops[3]), type: 'vec3<f32>' },
      uTintAmount: { value: tint ? 1 : 0, type: 'f32' },
      uPaperColor: { value: new Float32Array(paper), type: 'vec3<f32>' },
      uInkLuminance: { value: luminanceOfRgb(ink), type: 'f32' },
      uPaperLuminance: { value: luminanceOfRgb(paper), type: 'f32' },
      uBias: { value: (options.threshold !== undefined ? options.threshold : 0.5) - 0.5, type: 'f32' }
    })
    var inversion = options.inversion === undefined ? true : options.inversion
    return new pixi.Filter({
      glProgram: pixi.GlProgram.from({
        vertex: DIFF_VERTEX,
        fragment: inversion ? DIFF_INVERSION_FRAGMENT : DIFF_TINT_ONLY_FRAGMENT,
        name: inversion ? 'tempera-difference-inversion' : 'tempera-text-tint'
      }),
      // blendRequired 让 Pixi 把滤镜 bounds 之下已绘制的像素快照进 uBackTexture；
      // 下面的空纹理是必需的占位。仅着色形态不读底色，两个都不声明
      blendRequired: inversion,
      resources: inversion
        ? { differenceUniforms: uniforms, uBackTexture: pixi.Texture.EMPTY }
        : { differenceUniforms: uniforms },
      padding: 0,
      // 必须是 'inherit'。Pixi 的 Filter 默认硬编码 1，会以与 back texture
      // （后者永远跟随渲染目标的 resolution）不同的像素尺寸分配输入纹理，
      // vTextureCoord 于是对两张纹理索引不一致，底色读错位置——反色成片选错颜色，
      // 细 hatch 上最严重。仅着色形态没有 back texture 可以错位，
      // 但硬编码 1 仍会把文字按低于画布的分辨率光栅化再拉伸
      resolution: 'inherit'
    })
  }

  window.FoliaTemperaPalette = {
    TEMPERA_TONE_STOPS: TEMPERA_TONE_STOPS,
    extractRepresentativeColors: extractRepresentativeColors,
    extractRepresentativeColorsFromPixels: extractRepresentativeColorsFromPixels,
    resolveTemperaPalette: resolveTemperaPalette,
    createTemperaDifferenceFilter: createTemperaDifferenceFilter
  }
})()
