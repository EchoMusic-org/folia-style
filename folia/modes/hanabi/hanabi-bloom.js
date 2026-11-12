// 花火（hanabi）共享 Pixi 助手：移植自 folia-major src/components/visualizer/pixi/
//   bloomFilter.ts（绘光、花火共用的 dual-filter bloom：亮部提取 → 逐级降采样 → 上采样叠加 → 与原图相加）
//   pixiFilterVertex.ts（Pixi 8 自定义 Filter 共用的顶点着色器，GLSL 原文照搬）
//   pixiTextureBudget.ts（把渲染分辨率按 Pixi 纹理池的 2 的幂分桶往下吸附，省掉整块用不到的池纹理）
//   pixiDisplayResources.ts（不丢显示树地放掉渲染器侧数据 / 逐节点销毁整棵显示树）
// 被 hanabi-glow.js（烟花层辉光）与 hanabi-core.js（画质档的分辨率吸附）消费；绘制光的是 lumiere-light.js 自己的一份。
(function () {
  'use strict'

  var PIXI = window.PIXI

  // ---------- 共用顶点着色器（原版 pixiFilterVertex.ts，GLSL 原文） ----------
  // Pixi 8 自定义 Filter 共用的顶点着色器：把单位方块铺到 filter 的输出区域上，并按输入纹理尺寸换算 vTextureCoord。
  // 各模式的 filter 只写自己的片元着色器，顶点阶段统一用这一份。
  var PIXI_FILTER_VERTEX = `
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

  // ---------- bloom（原版 bloomFilter.ts） ----------
  // 绘光、花火共用的 bloom：挂在场景自己的子容器上（绘光的图形组、文字组，花火的烟花层），不作用于共享背景层与素材层。
  // 亮部提取（阈值 + 软膝）→ 逐级半分辨率降采样（dual filter）→ 逐级上采样并叠加同级 → 与原图相加。
  //
  // 每一级的临时纹理都与输入同样的逻辑尺寸、只降分辨率：Pixi 的 filter 按逻辑尺寸铺满输出，
  // 这样 applyFilter 天然就是缩放。第二张纹理（同级 / 最终的 bloom）按两张源纹理的逻辑尺寸比换算 UV。

  var downFragment = `
in vec2 vTextureCoord;
out vec4 finalColor;
uniform sampler2D uTexture;
uniform vec4 uInputPixel;
uniform vec4 uInputClamp;
uniform vec4 uParams; // threshold, knee, prefilter(0/1), 0

vec4 tap(vec2 uv) {
    return texture(uTexture, clamp(uv, uInputClamp.xy, uInputClamp.zw));
}

void main(void) {
    vec2 uv = vTextureCoord;
    vec2 hp = uInputPixel.zw;
    vec4 sum = tap(uv) * 4.0;
    sum += tap(uv - hp);
    sum += tap(uv + hp);
    sum += tap(uv + vec2(hp.x, -hp.y));
    sum += tap(uv - vec2(hp.x, -hp.y));
    vec4 c = sum / 8.0;
    if (uParams.z > 0.5) {
        float br = max(c.r, max(c.g, c.b));
        float knee = max(uParams.y, 1e-4);
        float soft = clamp(br - uParams.x + knee, 0.0, 2.0 * knee);
        soft = soft * soft / (4.0 * knee);
        float contrib = max(soft, br - uParams.x) / max(br, 1e-4);
        c *= clamp(contrib, 0.0, 1.0);
    }
    finalColor = c;
}
`

  var upFragment = `
in vec2 vTextureCoord;
out vec4 finalColor;
uniform sampler2D uTexture;
uniform sampler2D uAdd;
uniform vec4 uInputPixel;
uniform vec4 uInputClamp;
uniform vec4 uAddMap;   // uv 缩放 xy、同级权重、0
uniform vec4 uAddClamp;

vec4 tap(vec2 uv) {
    return texture(uTexture, clamp(uv, uInputClamp.xy, uInputClamp.zw));
}

void main(void) {
    vec2 uv = vTextureCoord;
    vec2 hp = uInputPixel.zw;
    vec4 sum = tap(uv + vec2(-hp.x * 2.0, 0.0));
    sum += tap(uv + vec2(-hp.x, hp.y)) * 2.0;
    sum += tap(uv + vec2(0.0, hp.y * 2.0));
    sum += tap(uv + vec2(hp.x, hp.y)) * 2.0;
    sum += tap(uv + vec2(hp.x * 2.0, 0.0));
    sum += tap(uv + vec2(hp.x, -hp.y)) * 2.0;
    sum += tap(uv + vec2(0.0, -hp.y * 2.0));
    sum += tap(uv + vec2(-hp.x, -hp.y)) * 2.0;
    vec4 up = sum / 12.0;
    vec4 same = texture(uAdd, clamp(uv * uAddMap.xy, uAddClamp.xy, uAddClamp.zw));
    finalColor = up + same * uAddMap.z;
}
`

  var combineFragment = `
in vec2 vTextureCoord;
out vec4 finalColor;
uniform sampler2D uTexture;
uniform sampler2D uAdd;
uniform vec4 uInputClamp;
uniform vec4 uAddMap;   // uv 缩放 xy、强度、0
uniform vec4 uAddClamp;
uniform vec4 uTint;     // 乘在 bloom 上的颜色

void main(void) {
    vec4 base = texture(uTexture, clamp(vTextureCoord, uInputClamp.xy, uInputClamp.zw));
    vec4 glow = texture(uAdd, clamp(vTextureCoord * uAddMap.xy, uAddClamp.xy, uAddClamp.zw)) * uAddMap.z;
    vec3 g = glow.rgb * uTint.rgb;
    // 加上去的辉光也是光：预乘、alpha 取最大通道（与光场一致，近似 screen）。
    vec3 rgb = base.rgb + g * (1.0 - base.a * 0.5);
    // 超过 1 时按最大通道整体缩回（保持金色），只让一小部分变白；逐通道截断会把亮字烧成白块。
    float peak = max(max(rgb.r, rgb.g), rgb.b);
    if (peak > 1.0) rgb = mix(rgb / peak, vec3(1.0), 0.2 * (1.0 - 1.0 / peak));
    float a = base.a + max(max(g.r, g.g), g.b) * (1.0 - base.a);
    finalColor = vec4(rgb, min(max(a, max(max(rgb.r, rgb.g), rgb.b)), 1.0));
}
`

  /**
   * BloomOptions：strength 叠加强度（绘光默认给高）、threshold 亮部阈值（按最大通道，预乘颜色）、knee 软膝、
   * levels 降采样级数（1/2 .. 1/2^levels，级数越多辉光越宽）、spread 每级上采样时同级的权重、
   * padding filter 的外扩（逻辑像素，让辉光能晕出内容边界）、tint 乘在 bloom 上的颜色 [r, g, b]。
   */
  function createBloomFilter(pixi, initial) {
    var Filter = pixi.Filter
    var GlProgram = pixi.GlProgram
    var TexturePool = pixi.TexturePool
    var UniformGroup = pixi.UniformGroup
    var program = function (fragment, name) { return GlProgram.from({ vertex: PIXI_FILTER_VERTEX, fragment: fragment, name: name }) }

    var downUniforms = new UniformGroup({ uParams: { value: new Float32Array(4), type: 'vec4<f32>' } })
    var down = new Filter({ glProgram: program(downFragment, 'lumiere-bloom-down'), resources: { bloomDown: downUniforms } })

    var upUniforms = new UniformGroup({
      uAddMap: { value: new Float32Array(4), type: 'vec4<f32>' },
      uAddClamp: { value: new Float32Array(4), type: 'vec4<f32>' }
    })
    var up = new Filter({
      glProgram: program(upFragment, 'lumiere-bloom-up'),
      resources: { bloomUp: upUniforms, uAdd: pixi.Texture.EMPTY.source }
    })

    var combineUniforms = new UniformGroup({
      uAddMap: { value: new Float32Array(4), type: 'vec4<f32>' },
      uAddClamp: { value: new Float32Array(4), type: 'vec4<f32>' },
      uTint: { value: new Float32Array([1, 1, 1, 1]), type: 'vec4<f32>' }
    })
    var combine = new Filter({
      glProgram: program(combineFragment, 'lumiere-bloom-combine'),
      resources: { bloomCombine: combineUniforms, uAdd: pixi.Texture.EMPTY.source }
    })

    var mapFor = function (from, to, target, clamp, weight) {
      target[0] = from.source.width / to.source.width
      target[1] = from.source.height / to.source.height
      target[2] = weight
      clamp[0] = 0.5 / to.source.pixelWidth
      clamp[1] = 0.5 / to.source.pixelHeight
      clamp[2] = to.frame.width / to.source.width - 0.5 / to.source.pixelWidth
      clamp[3] = to.frame.height / to.source.height - 0.5 / to.source.pixelHeight
    }

    class LumiereBloomFilter extends Filter {
      constructor(options) {
        super({ resources: {}, compatibleRenderers: pixi.RendererType.BOTH })
        this.options = Object.assign({}, options)
        this.padding = options.padding
        // 分遍画用的三个 filter。放在字段上，第一帧之前 linkPixiPrograms 才找得到它们的着色器程序。
        this.passes = [down, up, combine]
      }

      apply(filterManager, input, output, clearMode) {
        var options = this.options
        var strength = options.strength
        var threshold = options.threshold
        var knee = options.knee
        var levels = options.levels
        var spread = options.spread
        var tint = options.tint
        // 滤镜区域太小（一两个像素宽：花火刚升空的一颗火星、几乎出画的烟花）时一级都降不了，没有可叠加的光晕，
        // 原样画回去。不拦的话下面取 chain 的最后一级是 undefined，mapFor 抛错，Pixi 这一帧的渲染中断，后面的字整层不见。
        var passThrough = function () {
          mapFor(input, input, combineUniforms.uniforms.uAddMap, combineUniforms.uniforms.uAddClamp, 0)
          combineUniforms.update()
          combine.resources.uAdd = input.source
          combine.blendMode = this.blendMode
          filterManager.applyFilter(combine, input, output, clearMode)
        }.bind(this)
        if (strength <= 0) {
          passThrough()
          return
        }
        var width = input.frame.width
        var height = input.frame.height
        var baseResolution = input.source.resolution
        var chain = []
        var source = input
        // 上游写 8 + LUMIERE_NEUTRAL_OFFSET（一条恒等于 0 的混淆式），这里直接是 8。
        var count = Math.max(1, Math.min(8, Math.round(levels)))
        for (var level = 1; level <= count; level += 1) {
          var resolution = baseResolution / Math.pow(2, level)
          if (Math.min(width, height) * resolution < 2) break
          // 用位置参数的签名：folia 装的 Pixi 8.20 还没有对象形式（8.21 起对象形式为主、位置参数仍可用）。
          var target = TexturePool.getOptimalTexture(width, height, resolution, false)
          var params = downUniforms.uniforms.uParams
          params[0] = threshold
          params[1] = knee
          params[2] = level === 1 ? 1 : 0
          downUniforms.update()
          down.blendMode = 'normal'
          filterManager.applyFilter(down, source, target, true)
          chain.push(target)
          source = target
        }

        if (chain.length === 0) {
          passThrough()
          return
        }

        // 上采样：从最小一级往上，每一级叠加同级的降采样结果。
        var current = chain[chain.length - 1]
        var scratch = []
        for (var index = chain.length - 2; index >= 0; index -= 1) {
          var same = chain[index]
          var upTarget = TexturePool.getOptimalTexture(width, height, same.source.resolution, false)
          mapFor(current, same, upUniforms.uniforms.uAddMap, upUniforms.uniforms.uAddClamp, spread)
          upUniforms.update()
          up.resources.uAdd = same.source
          up.blendMode = 'normal'
          filterManager.applyFilter(up, current, upTarget, true)
          scratch.push(upTarget)
          current = upTarget
        }

        mapFor(input, current, combineUniforms.uniforms.uAddMap, combineUniforms.uniforms.uAddClamp, strength)
        var tintUniform = combineUniforms.uniforms.uTint
        tintUniform[0] = tint[0]
        tintUniform[1] = tint[1]
        tintUniform[2] = tint[2]
        combineUniforms.update()
        combine.resources.uAdd = current.source
        combine.blendMode = this.blendMode
        filterManager.applyFilter(combine, input, output, clearMode)

        chain.forEach(function (texture) { TexturePool.returnTexture(texture) })
        scratch.forEach(function (texture) { TexturePool.returnTexture(texture) })
      }

      destroy() {
        down.destroy()
        up.destroy()
        combine.destroy()
        super.destroy()
      }
    }

    return new LumiereBloomFilter(initial)
  }

  // ---------- 纹理池吸附（原版 pixiTextureBudget.ts） ----------
  // 把渲染分辨率按 Pixi 纹理池的 2 的幂分桶往下吸附，让整屏的 filter pass 别为永远画不到的像素买单。
  //
  // TexturePool.getOptimalTexture 会把每个渲染目标按轴向上取整到 2 的幂（nextPow2(ceil(frame * resolution - 1e-6))）
  // 并按这对数给池里的纹理分桶。一个 pass 的账单按「桶」算，不按画面算：textureResolution 为 1.5 时，
  // 781x850 的视口先栅格化成 1172x1275，再落进 2048x2048 的纹理——16 MiB 里只装了 5.7 MiB 的画面，71% 是浪费。
  //
  // 代价是个阶梯函数，这正是容易搞错的地方：实测 Intel 核显上窗口从 640x640 拉到 700x700（+18% 面积），
  // 1.5x700 越过 1024，池里每个目标在两条轴上同时翻倍。画面什么都没变，内存却多了。
  //
  // 所以与其整体降分辨率（处处变糊，还照样落进某个桶里），不如只让掉「能换到更小桶」的那部分分辨率：
  // 同一个 781x850 视口它返回 1.2047 而不是 1.5——柔 20%，但池目标从 2048x2048 → 1024x1024，
  // 内存只剩四分之一，画面也把纹理填满了 92%。每字节的清晰度是上升的，不是下降的。
  //
  // 刻意保守：每条轴只考虑向下走一级，且只接受 TEXTURE_POOL_MAX_RESOLUTION_DROP 以内的让步。
  // 离边界还很远的视口（2000x1200 在 1.5 下要降到 1.024，一档就 32%）保持自己要的分辨率——为桶买单是次坏选择。

  /**
   * Pixi 自己的 nextPow2（maths/misc/pow2），照抄而不是 import。
   * 池的分桶数学就是这个模块要精确预测的东西，所以必须是同一个函数；
   * 但从 pixi.js import 会让本模块——以及调用它的 tuning 解析器——在任何 bundle 与测试里拖上整个渲染器，
   * 而这里其它关于 Pixi 的东西都在 loadPixi 的动态 import 后面（folia 插件里则在 registry 懒加载的 vendor 之后）。
   */
  var nextPow2 = function (value) {
    var v = value + (value === 0 ? 1 : 0)
    v -= 1
    v |= v >>> 1
    v |= v >>> 2
    v |= v >>> 4
    v |= v >>> 8
    v |= v >>> 16
    return v + 1
  }

  /**
   * 一个全视口 pass 在一条轴上会拿到的池纹理尺寸（设备像素）。
   * 与 TexturePool.getOptimalTexture 逐句一致，epsilon 也在——那个 -1e-6 让恰好压在边界上的候选
   * 不会因为浮点误差又向上翻一档。
   */
  function texturePoolAxis(cssSize, resolution) {
    return nextPow2(Math.ceil(cssSize * resolution - 1e-6))
  }

  /**
   * 一次吸附最多让掉多少分辨率（相对要的值）。
   * 降一级必然让一条轴的桶减半，所以赚到的内存是 2x 或 4x；25% 是过了这个点「降质」就开始被看出
   * 「渲染降了档」而不是「同一幅画面更便宜」的界限。默认 1.5 能容忍降到 1.125，
   * 覆盖常见的桌面视口——781x850 需要的 1.2047 就在其中，够不到 1.0。
   */
  var TEXTURE_POOL_MAX_RESOLUTION_DROP = 0.25

  /**
   * 让这条轴落进低一个桶的最高分辨率；下面没有桶了（单像素桶）返回 null。
   */
  function stepDownCandidate(cssSize, resolution) {
    var bucket = texturePoolAxis(cssSize, resolution)
    if (bucket < 2) return null
    return (bucket / 2) / cssSize
  }

  /**
   * 返回实际该用的渲染分辨率：resolution 本身，或在 maxDrop 之内能把池渲染目标送进更小桶的最高值。
   * 两条轴都要试，因为它们不对等——需要让得更多的那条轴，可能顺路把另一条轴也带下一档，等于赚两倍。
   * 1030x520 在 1.0 下：只按宽度吸（0.994）桶减半成 1024x1024，而按高度吸（0.985）能到 1024x512，
   * 又省一半，分辨率只再多让 0.9%。所以候选按「产出的桶面积」排序，而不是按让得少排序。
   */
  function snapResolutionToTexturePool(cssWidth, cssHeight, resolution, maxDrop) {
    if (maxDrop === undefined) maxDrop = TEXTURE_POOL_MAX_RESOLUTION_DROP
    var inputs = [cssWidth, cssHeight, resolution]
    var allFinite = true
    for (var i = 0; i < inputs.length; i += 1) {
      if (!(Number.isFinite(inputs[i]) && inputs[i] > 0)) allFinite = false
    }
    if (!allFinite) return resolution
    var lowest = resolution * (1 - Math.min(Math.max(maxDrop, 0), 1))
    var candidates = [stepDownCandidate(cssWidth, resolution), stepDownCandidate(cssHeight, resolution)].filter(function (candidate) {
      return candidate !== null && candidate > 0 && candidate < resolution && candidate >= lowest
    })

    var best = resolution
    // 桶面积随分辨率单调，所以现任最优只可能被正面击败。
    var bestArea = texturePoolAxis(cssWidth, resolution) * texturePoolAxis(cssHeight, resolution)
    candidates.forEach(function (candidate) {
      var area = texturePoolAxis(cssWidth, candidate) * texturePoolAxis(cssHeight, candidate)
      if (area >= bestArea) return
      bestArea = area
      best = candidate
    })
    return best
  }

  // ---------- 显示树资源（原版 pixiDisplayResources.ts） ----------
  // 放掉渲染器持有的数据，但不丢掉必须保持可 seek 的显示树。

  /**
   * 卸载整棵显示树的视图数据（递归）。Graphics.unload() 只放视图自己的批数据，
   * 缓冲挂在 context 上，要单独 unload；再画到它时 Pixi 自动重建、重传。共享的 context 也只是被迫重传一次，不会画错。
   */
  function unloadPixiDisplayTree(root) {
    var stack = (root.children || []).slice()
    while (stack.length > 0) {
      var node = stack.pop()
      if (node.children && node.children.length) {
        for (var i = 0; i < node.children.length; i += 1) stack.push(node.children[i])
      }
      // Graphics 的 GraphicsContext：大号（不走合批）的 context 各自持有 batcher 与顶点 / 索引缓冲。
      if (node.context && typeof node.context.unload === 'function') node.context.unload()
      if (typeof node.unload === 'function') node.unload()
    }
  }

  /** 留驻的 Pixi 树离开可见集合时，把后代恰好卸载一次。 */
  function setPixiDisplayTreeVisibility(root, visible) {
    var wasVisible = root.visible !== false
    root.visible = visible
    if (wasVisible && !visible) unloadPixiDisplayTree(root)
  }

  /**
   * 销毁整棵显示树，Graphics 自建的 GraphicsContext 一并销毁，构造时传进来的共享 context 不动。
   * 不能用 destroy({ children: true })：Container 会把这份选项原样传给子节点，而 Pixi 8 的 Graphics.destroy
   * 只要收到选项对象、却没写 context: true，就不销毁自建的 context，它的 GPU 批数据要等 Pixi 的 GC 空闲 60 秒才收；
   * 写 context: true 又会把共享的 context 一起销毁。所以逐个节点不带参数 destroy()——Graphics 只在这时按归属销毁
   * 自建的 context；其余节点不带参数与 { children: true } 一样，都不动纹理。
   */
  function destroyPixiDisplayTree(root) {
    // 先序收集再倒着销毁：子节点总在父节点之前，父节点 destroy() 时已经没有子节点要处理。
    var order = []
    var stack = [root]
    while (stack.length > 0) {
      var node = stack.pop()
      order.push(node)
      if (node.children && node.children.length) {
        for (var i = 0; i < node.children.length; i += 1) stack.push(node.children[i])
      }
    }
    for (var index = order.length - 1; index >= 0; index -= 1) {
      if (typeof order[index].destroy === 'function') order[index].destroy()
    }
  }

  // removeChildren() 只是把节点摘下来；摘下来的子树要显式 unload + destroy。
  function destroyPixiContainerChildren(container) {
    var children = container.removeChildren()
    for (var i = 0; i < children.length; i += 1) destroyPixiDisplayTree(children[i])
  }

  window.FoliaHanabiBloom = {
    createBloomFilter: createBloomFilter,
    texturePoolAxis: texturePoolAxis,
    TEXTURE_POOL_MAX_RESOLUTION_DROP: TEXTURE_POOL_MAX_RESOLUTION_DROP,
    snapResolutionToTexturePool: snapResolutionToTexturePool,
    unloadPixiDisplayTree: unloadPixiDisplayTree,
    setPixiDisplayTreeVisibility: setPixiDisplayTreeVisibility,
    destroyPixiDisplayTree: destroyPixiDisplayTree,
    destroyPixiContainerChildren: destroyPixiContainerChildren
  }
})()
