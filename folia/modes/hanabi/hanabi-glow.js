// 花火（hanabi）烟花层辉光：移植自 folia-major src/components/visualizer/hanabi/mg/glow.ts
// 烟花层的辉光：复用共享的 dual-filter bloom（hanabi-bloom.js：亮部提取 → 逐级降采样 → 上采样叠加），参数调成花火的「热芯 + 宽光晕」。
// 只在 tuning.glow > 0 时由 scene 挂到烟花层上；强度随 tuning 变化时调 setHanabiGlow，不必重建。
// 滤镜区域跟着烟花层的包围盒走，刚升空的一颗火星只有一两个像素宽：共享 bloom 在一级都降不了时原样透传，不会让整帧中断。
(function () {
  'use strict'

  var Bloom = window.FoliaHanabiBloom

  var BASE = {
    strength: 1.1,
    threshold: 0.2,
    knee: 0.25,
    levels: 5,
    spread: 0.85,
    tint: [1, 0.96, 0.9]
  }

  /**
   * 建烟花层的 bloom 滤镜。amount = tuning.glow（0..2）；padding 让光晕能晕出烟花层的包围盒（逻辑像素）。
   * quality：{ resolution filter 分辨率（null = 跟渲染分辨率（满画质）；画质档降了时是降过的数值）,
   *            levelDrop 相对满画质少降几级（分辨率降了 2^k 倍就少 k 级，辉光宽度不变） }——hanabi-core.js 的 resolveHanabiGlowQuality。
   */
  function createHanabiGlow(pixi, amount, quality, padding) {
    if (quality === undefined) quality = { resolution: null, levelDrop: 0 }
    if (padding === undefined) padding = 48
    var initial = Object.assign({}, BASE, {
      strength: BASE.strength * Math.max(0, amount),
      levels: Math.max(1, BASE.levels - quality.levelDrop),
      padding: padding
    })
    var filter = Bloom.createBloomFilter(pixi, initial)
    // 满画质跟渲染分辨率：Pixi 的 Filter 默认 resolution 是 1，1.5× / 2× 渲染时烟花层会先画成 1× 再被拉伸（lumisynth 在
    // 共享 bloom 里设，folia 的共享 bloom 由各自的运行时设：绘光在 lumiereGroupFilters，花火在这里）。降档时按画质档的数值。
    filter.resolution = quality.resolution !== null && quality.resolution !== undefined ? quality.resolution : 'inherit'
    return filter
  }

  /** 改辉光强度（tuning.glow 变了调这个，不必重建）。 */
  function setHanabiGlow(filter, amount) {
    filter.options.strength = BASE.strength * Math.max(0, amount)
  }

  window.FoliaHanabiMGGlow = {
    createHanabiGlow: createHanabiGlow,
    setHanabiGlow: setHanabiGlow
  }
})()
