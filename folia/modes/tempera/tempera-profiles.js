// 凝彩模式·构图档案：移植自 folia-major src/components/visualizer/tempera/temperaShotProfiles.ts
// 纯逐构图数据：文字坐哪、字从哪个方向飞入、镜头怎么走、构图读起来多吵。
// 刻意不依赖 Pixi，让排版器与程序编译器都能引用它而不拉入绘制代码。
(function () {
  'use strict'

  var Core = window.FoliaTemperaCore
  var TEMPERA_SHOT_KINDS = Core.TEMPERA_SHOT_KINDS

  // 歌词的排版框，视口比例
  function region(cx, cy, w, h, options) {
    options = options || {}
    return {
      cx: cx,
      cy: cy,
      w: w,
      h: h,
      align: options.align !== undefined ? options.align : 'center',
      rotation: options.rotation !== undefined ? options.rotation : 0,
      fontScale: options.fontScale !== undefined ? options.fontScale : 1
    }
  }

  var TEMPERA_SHOT_PROFILES = {
    'duo-split': {
      region: region(0.5, 0.52, 0.86, 0.46),
      enter: { x: 0, y: 1.3 },
      camera: { travel: 0.11, zoomStart: 1.06, zoomEnd: 1.13 },
      mood: 'neutral'
    },
    'quad-split': {
      // 正压在四块面板的交点上，让每个字都跨在两个色调上
      region: region(0.5, 0.5, 0.82, 0.4),
      enter: { x: 0.9, y: 0.9 },
      camera: { travel: 0.09, zoomStart: 1.08, zoomEnd: 1.16 },
      mood: 'loud'
    },
    'tri-column': {
      region: region(0.5, 0.5, 0.7, 0.5, { fontScale: 0.95 }),
      enter: { x: -1.2, y: 0 },
      camera: { travel: 0.12, zoomStart: 1.04, zoomEnd: 1.12 },
      mood: 'neutral'
    },
    'thirds-stack': {
      region: region(0.5, 0.5, 0.8, 0.28),
      enter: { x: 0, y: 1.1 },
      camera: { travel: 0.13, zoomStart: 1.03, zoomEnd: 1.11 },
      mood: 'neutral'
    },
    'checker-quad': {
      region: region(0.5, 0.5, 0.76, 0.36),
      enter: { x: 0.8, y: -0.8 },
      camera: { travel: 0.1, zoomStart: 1.1, zoomEnd: 1.02 },
      mood: 'loud'
    },
    'corner-wedge': {
      region: region(0.44, 0.56, 0.68, 0.4, { align: 'left', rotation: -0.03 }),
      enter: { x: -1.4, y: 0.5 },
      camera: { travel: 0.1, zoomStart: 1.05, zoomEnd: 1.14 },
      mood: 'loud'
    },
    'diagonal-halves': {
      region: region(0.5, 0.5, 0.78, 0.4, { rotation: -0.075 }),
      enter: { x: 1.1, y: 1.1 },
      camera: { travel: 0.12, zoomStart: 1.06, zoomEnd: 1.14 },
      mood: 'neutral'
    },
    'cross-axis': {
      region: region(0.5, 0.5, 0.66, 0.3),
      enter: { x: 0, y: 1.2 },
      camera: { travel: 0.08, zoomStart: 1.12, zoomEnd: 1.03 },
      mood: 'loud'
    },
    'offset-halves': {
      region: region(0.5, 0.5, 0.8, 0.4),
      enter: { x: 0.9, y: 0.6 },
      camera: { travel: 0.11, zoomStart: 1.05, zoomEnd: 1.13 },
      mood: 'neutral'
    },
    'stair-blocks': {
      region: region(0.5, 0.5, 0.72, 0.38, { rotation: -0.03 }),
      enter: { x: -1, y: 0.8 },
      camera: { travel: 0.12, zoomStart: 1.06, zoomEnd: 1.14 },
      mood: 'loud'
    },
    'pillar-gap': {
      // 歌词住在两块体量让出的亮缝里
      region: region(0.5, 0.5, 0.34, 0.62, { fontScale: 0.8 }),
      enter: { x: 0, y: 1.2 },
      camera: { travel: 0.07, zoomStart: 1.1, zoomEnd: 1.02 },
      mood: 'loud'
    },
    'corner-quad': {
      region: region(0.46, 0.46, 0.68, 0.36),
      enter: { x: -0.9, y: -0.9 },
      camera: { travel: 0.1, zoomStart: 1.07, zoomEnd: 1.15 },
      mood: 'neutral'
    },
    'sliver-stack': {
      region: region(0.5, 0.5, 0.76, 0.3),
      enter: { x: 1.2, y: 0 },
      camera: { travel: 0.13, zoomStart: 1.04, zoomEnd: 1.12 },
      mood: 'neutral'
    },
    'band-strip': {
      region: region(0.5, 0.52, 0.78, 0.26, { fontScale: 0.92 }),
      enter: { x: 0.5, y: 1.05 },
      camera: { travel: 0.12, zoomStart: 1.03, zoomEnd: 1.1 },
      mood: 'neutral'
    },
    'horizon-band': {
      // 字骑在水线上方；纵向 flow 因此读作下降
      region: region(0.5, 0.36, 0.8, 0.3),
      enter: { x: 0, y: -1.1 },
      camera: { travel: 0.14, zoomStart: 1.02, zoomEnd: 1.1 },
      mood: 'neutral'
    },
    'deep-dive': {
      region: region(0.5, 0.58, 0.76, 0.34),
      enter: { x: 0, y: 1.6 },
      camera: { travel: 0.16, zoomStart: 1.04, zoomEnd: 1.14 },
      mood: 'neutral'
    },
    'tone-ramp': {
      region: region(0.5, 0.5, 0.82, 0.38),
      enter: { x: 1.2, y: 0.4 },
      camera: { travel: 0.11, zoomStart: 1.05, zoomEnd: 1.12 },
      mood: 'neutral'
    },
    'double-band': {
      region: region(0.5, 0.5, 0.78, 0.22, { fontScale: 0.88 }),
      enter: { x: 0.8, y: 0 },
      camera: { travel: 0.12, zoomStart: 1.03, zoomEnd: 1.11 },
      mood: 'neutral'
    },
    'tilt-band': {
      region: region(0.5, 0.5, 0.8, 0.26, { rotation: -0.1 }),
      enter: { x: -1.1, y: 0.5 },
      camera: { travel: 0.13, zoomStart: 1.05, zoomEnd: 1.13 },
      mood: 'neutral'
    },
    'edge-rails': {
      region: region(0.5, 0.5, 0.74, 0.4),
      enter: { x: 0, y: 1 },
      camera: { travel: 0.09, zoomStart: 1.02, zoomEnd: 1.09 },
      mood: 'quiet'
    },
    'gradient-wall': {
      region: region(0.5, 0.44, 0.82, 0.36),
      enter: { x: 0.5, y: -0.9 },
      camera: { travel: 0.15, zoomStart: 1.04, zoomEnd: 1.13 },
      mood: 'neutral'
    },
    'terrace': {
      region: region(0.46, 0.52, 0.72, 0.34, { align: 'left' }),
      enter: { x: -1.2, y: 0.4 },
      camera: { travel: 0.14, zoomStart: 1.05, zoomEnd: 1.12 },
      mood: 'neutral'
    },
    'frame-window': {
      region: region(0.5, 0.5, 0.64, 0.5, { fontScale: 0.95 }),
      enter: { x: 0, y: 0.95 },
      camera: { travel: 0.05, zoomStart: 1.14, zoomEnd: 1.03 },
      mood: 'neutral'
    },
    'double-frame': {
      region: region(0.5, 0.5, 0.58, 0.4, { fontScale: 0.9 }),
      enter: { x: 0.6, y: 0.6 },
      camera: { travel: 0.06, zoomStart: 1.12, zoomEnd: 1.02 },
      mood: 'neutral'
    },
    'circle-window': {
      region: region(0.5, 0.5, 0.5, 0.34, { fontScale: 0.88 }),
      enter: { x: 0, y: 0.8 },
      camera: { travel: 0.05, zoomStart: 1.16, zoomEnd: 1.04 },
      mood: 'quiet'
    },
    'ladder-frame': {
      region: region(0.52, 0.5, 0.6, 0.4, { align: 'left', fontScale: 0.9 }),
      enter: { x: -0.9, y: 0.6 },
      camera: { travel: 0.07, zoomStart: 1.1, zoomEnd: 1.02 },
      mood: 'quiet'
    },
    'corner-brackets': {
      region: region(0.5, 0.5, 0.56, 0.3, { fontScale: 0.85 }),
      enter: { x: 0, y: 0.6 },
      camera: { travel: 0.04, zoomStart: 1.06, zoomEnd: 1.01 },
      mood: 'quiet'
    },
    'inset-box': {
      region: region(0.5, 0.5, 0.6, 0.42, { fontScale: 0.92 }),
      enter: { x: 0, y: 0.8 },
      camera: { travel: 0.06, zoomStart: 1.1, zoomEnd: 1.02 },
      mood: 'quiet'
    },
    'bracket-pair': {
      region: region(0.5, 0.5, 0.54, 0.34, { fontScale: 0.88 }),
      enter: { x: 1, y: 0 },
      camera: { travel: 0.05, zoomStart: 1.08, zoomEnd: 1.01 },
      mood: 'quiet'
    },
    'arch-window': {
      region: region(0.5, 0.54, 0.5, 0.34, { fontScale: 0.86 }),
      enter: { x: 0, y: 0.9 },
      camera: { travel: 0.06, zoomStart: 1.14, zoomEnd: 1.03 },
      mood: 'quiet'
    },
    'grid-cells': {
      region: region(0.5, 0.5, 0.72, 0.22, { fontScale: 0.8 }),
      enter: { x: 0.7, y: 0.7 },
      camera: { travel: 0.07, zoomStart: 1.06, zoomEnd: 1.13 },
      mood: 'neutral'
    },
    'keyhole': {
      region: region(0.5, 0.6, 0.42, 0.3, { fontScale: 0.78 }),
      enter: { x: 0, y: 1 },
      camera: { travel: 0.05, zoomStart: 1.12, zoomEnd: 1.02 },
      mood: 'quiet'
    },
    'poster-panel': {
      region: region(0.4, 0.5, 0.58, 0.62, { align: 'left', rotation: -0.045 }),
      enter: { x: -1.5, y: 0.35 },
      camera: { travel: 0.08, zoomStart: 1.05, zoomEnd: 1.12 },
      mood: 'loud'
    },
    'diamond-stack': {
      region: region(0.54, 0.5, 0.6, 0.42, { align: 'right', rotation: 0.035 }),
      enter: { x: 1.3, y: -0.5 },
      camera: { travel: 0.09, zoomStart: 1.07, zoomEnd: 1.15 },
      mood: 'loud'
    },
    'slash-poster': {
      region: region(0.46, 0.5, 0.66, 0.44, { align: 'left', rotation: -0.09 }),
      enter: { x: -1.2, y: 1 },
      camera: { travel: 0.11, zoomStart: 1.06, zoomEnd: 1.14 },
      mood: 'loud'
    },
    'arrow-wedge': {
      region: region(0.5, 0.34, 0.72, 0.26),
      enter: { x: 0, y: -1.2 },
      camera: { travel: 0.13, zoomStart: 1.04, zoomEnd: 1.13 },
      mood: 'loud'
    },
    'edge-bleed': {
      region: region(0.56, 0.5, 0.6, 0.44, { align: 'left' }),
      enter: { x: 1.4, y: 0.3 },
      camera: { travel: 0.1, zoomStart: 1.05, zoomEnd: 1.13 },
      mood: 'neutral'
    },
    'triangle-mass': {
      region: region(0.5, 0.42, 0.68, 0.3),
      enter: { x: 0.8, y: -1 },
      camera: { travel: 0.12, zoomStart: 1.05, zoomEnd: 1.14 },
      mood: 'loud'
    },
    'ribbon-cross': {
      region: region(0.5, 0.5, 0.62, 0.3, { rotation: 0.05 }),
      enter: { x: -1, y: -0.8 },
      camera: { travel: 0.11, zoomStart: 1.08, zoomEnd: 1.16 },
      mood: 'loud'
    },
    'half-disc': {
      region: region(0.44, 0.44, 0.6, 0.34, { align: 'left' }),
      enter: { x: -1.3, y: 0.4 },
      camera: { travel: 0.1, zoomStart: 1.06, zoomEnd: 1.14 },
      mood: 'loud'
    },
    'stacked-slabs': {
      region: region(0.52, 0.5, 0.62, 0.4, { rotation: -0.05 }),
      enter: { x: 1.1, y: 0.6 },
      camera: { travel: 0.1, zoomStart: 1.07, zoomEnd: 1.15 },
      mood: 'loud'
    },
    'wedge-pair': {
      region: region(0.5, 0.5, 0.44, 0.44, { fontScale: 0.82 }),
      enter: { x: 0, y: 1.1 },
      camera: { travel: 0.09, zoomStart: 1.1, zoomEnd: 1.02 },
      mood: 'loud'
    },
    'quiet-line': {
      region: region(0.5, 0.5, 0.6, 0.28, { fontScale: 0.58 }),
      enter: { x: 0, y: 0.7 },
      camera: { travel: 0.03, zoomStart: 1, zoomEnd: 1.04 },
      mood: 'quiet'
    },
    'starfield-dots': {
      region: region(0.5, 0.5, 0.62, 0.26, { fontScale: 0.66 }),
      enter: { x: 0.4, y: 0.5 },
      camera: { travel: 0.04, zoomStart: 1.02, zoomEnd: 1.08 },
      mood: 'quiet'
    },
    'ripple-lines': {
      region: region(0.5, 0.46, 0.66, 0.28, { fontScale: 0.72 }),
      enter: { x: 0, y: 0.9 },
      camera: { travel: 0.06, zoomStart: 1.03, zoomEnd: 1.1 },
      mood: 'quiet'
    },
    'hair-grid': {
      region: region(0.5, 0.5, 0.64, 0.26, { fontScale: 0.62 }),
      enter: { x: 0.4, y: 0.6 },
      camera: { travel: 0.04, zoomStart: 1.01, zoomEnd: 1.06 },
      mood: 'quiet'
    },
    'margin-rule': {
      region: region(0.54, 0.5, 0.62, 0.26, { align: 'left', fontScale: 0.66 }),
      enter: { x: -0.8, y: 0.3 },
      camera: { travel: 0.05, zoomStart: 1.02, zoomEnd: 1.07 },
      mood: 'quiet'
    },
    'dot-drift': {
      region: region(0.5, 0.48, 0.6, 0.26, { fontScale: 0.68 }),
      enter: { x: 0.6, y: 0.6 },
      camera: { travel: 0.05, zoomStart: 1.03, zoomEnd: 1.09 },
      mood: 'quiet'
    },
    'arc-sweep': {
      region: region(0.5, 0.5, 0.6, 0.26, { fontScale: 0.7 }),
      enter: { x: 0, y: 0.8 },
      camera: { travel: 0.06, zoomStart: 1.04, zoomEnd: 1.1 },
      mood: 'quiet'
    },
    'blank-page': {
      region: region(0.5, 0.5, 0.56, 0.24, { fontScale: 0.6 }),
      enter: { x: 0, y: 0.5 },
      camera: { travel: 0.03, zoomStart: 1, zoomEnd: 1.03 },
      mood: 'quiet'
    },
    // 电影遮幅。排版区域是保守的框，在任何视口比例下都留在窗内；
    // 构图按真实像素比例 aspect-fit 实际窗口
    'cinema-scope': {
      region: region(0.5, 0.5, 0.74, 0.22, { fontScale: 0.86 }),
      enter: { x: 0.9, y: 0 },
      camera: { travel: 0.09, zoomStart: 1.04, zoomEnd: 1.11 },
      mood: 'neutral'
    },
    'cinema-wide': {
      region: region(0.5, 0.5, 0.7, 0.3, { fontScale: 0.9 }),
      enter: { x: 0, y: 0.9 },
      camera: { travel: 0.08, zoomStart: 1.06, zoomEnd: 1.13 },
      mood: 'neutral'
    },
    'cinema-academy': {
      region: region(0.5, 0.5, 0.5, 0.4, { fontScale: 0.88 }),
      enter: { x: 0, y: 0.8 },
      camera: { travel: 0.06, zoomStart: 1.1, zoomEnd: 1.02 },
      mood: 'quiet'
    },
    'cinema-square': {
      region: region(0.5, 0.5, 0.42, 0.4, { fontScale: 0.84 }),
      enter: { x: 0.7, y: 0.7 },
      camera: { travel: 0.05, zoomStart: 1.12, zoomEnd: 1.03 },
      mood: 'quiet'
    },
    'cinema-portrait': {
      region: region(0.5, 0.5, 0.32, 0.46, { fontScale: 0.8 }),
      enter: { x: 0, y: 1 },
      camera: { travel: 0.06, zoomStart: 1.08, zoomEnd: 1.16 },
      mood: 'neutral'
    },
    'cinema-tall': {
      region: region(0.5, 0.5, 0.24, 0.5, { fontScale: 0.72 }),
      enter: { x: 0.8, y: 0.4 },
      camera: { travel: 0.07, zoomStart: 1.05, zoomEnd: 1.14 },
      mood: 'neutral'
    },
    'cinema-twin': {
      // 两个窗；歌词占更宽的那个，构图把它保持在左侧
      region: region(0.33, 0.5, 0.3, 0.32, { fontScale: 0.76 }),
      enter: { x: -0.9, y: 0.3 },
      camera: { travel: 0.08, zoomStart: 1.06, zoomEnd: 1.13 },
      mood: 'neutral'
    },
    // 圆滑族。字坐在曲线形状之内而不是跨在缝上，所以区域跟随该形状，
    // 镜头也比海报族更温和
    'bubble-drift': {
      region: region(0.5, 0.5, 0.72, 0.36, { fontScale: 0.92 }),
      enter: { x: 0.5, y: 1 },
      camera: { travel: 0.09, zoomStart: 1.05, zoomEnd: 1.12 },
      mood: 'neutral'
    },
    'cloud-window': {
      // 徽章内部；构图把中心放在略低于画面中心处
      region: region(0.5, 0.52, 0.46, 0.3, { fontScale: 0.84 }),
      enter: { x: 0, y: 0.8 },
      camera: { travel: 0.05, zoomStart: 1.14, zoomEnd: 1.03 },
      mood: 'quiet'
    },
    'heart-burst': {
      region: region(0.5, 0.52, 0.5, 0.3, { fontScale: 0.95 }),
      enter: { x: 0.8, y: 0.8 },
      camera: { travel: 0.1, zoomStart: 1.08, zoomEnd: 1.16 },
      mood: 'loud'
    },
    'sparkle-field': {
      region: region(0.5, 0.48, 0.64, 0.26, { fontScale: 0.7 }),
      enter: { x: 0.4, y: 0.6 },
      camera: { travel: 0.04, zoomStart: 1.02, zoomEnd: 1.08 },
      mood: 'quiet'
    },
    'petal-arc': {
      // 低在画面里：花瓣扇拥有它摆出的那个上角
      region: region(0.5, 0.6, 0.7, 0.3, { fontScale: 0.9 }),
      enter: { x: 0, y: 1.1 },
      camera: { travel: 0.1, zoomStart: 1.04, zoomEnd: 1.12 },
      mood: 'neutral'
    },
    'scallop-band': {
      region: region(0.5, 0.5, 0.76, 0.24, { fontScale: 0.88 }),
      enter: { x: 0.7, y: 0 },
      camera: { travel: 0.12, zoomStart: 1.03, zoomEnd: 1.1 },
      mood: 'neutral'
    },
    'ribbon-loop': {
      region: region(0.5, 0.5, 0.68, 0.22, { rotation: 0.04, fontScale: 0.86 }),
      enter: { x: -1.1, y: 0.6 },
      camera: { travel: 0.11, zoomStart: 1.07, zoomEnd: 1.15 },
      mood: 'loud'
    },
    'round-plate': {
      region: region(0.5, 0.5, 0.56, 0.36, { fontScale: 0.86 }),
      enter: { x: 0, y: 0.7 },
      camera: { travel: 0.05, zoomStart: 1.1, zoomEnd: 1.02 },
      mood: 'quiet'
    },
    'halo-burst': {
      region: region(0.5, 0.5, 0.46, 0.3, { fontScale: 0.95 }),
      enter: { x: 0, y: 0.9 },
      camera: { travel: 0.08, zoomStart: 1.12, zoomEnd: 1.02 },
      mood: 'loud'
    },
    // 冲孔板。这里的每个区域都贴着构图切出的开口摆放：
    // 反色滤镜读的是 Pixi 渲染目标，而洞露出的是 DOM 背景层，WebGL 看不见——
    // 所以字压在开口上就只能对着裸纸雾判定，任由背景摆布
    'iris-hole': {
      // 孔口偏右上，字在其左下
      region: region(0.28, 0.68, 0.44, 0.28, { fontScale: 0.78 }),
      enter: { x: -1, y: 0.6 },
      camera: { travel: 0.09, zoomStart: 1.06, zoomEnd: 1.14 },
      mood: 'loud'
    },
    'slot-rail': {
      region: region(0.5, 0.66, 0.72, 0.3, { fontScale: 0.9 }),
      enter: { x: 0.6, y: 0.9 },
      camera: { travel: 0.12, zoomStart: 1.04, zoomEnd: 1.11 },
      mood: 'neutral'
    },
    'punch-row': {
      region: region(0.5, 0.5, 0.76, 0.34, { fontScale: 0.92 }),
      enter: { x: 1.1, y: 0 },
      camera: { travel: 0.13, zoomStart: 1.03, zoomEnd: 1.1 },
      mood: 'neutral'
    },
    'film-gate': {
      region: region(0.5, 0.82, 0.66, 0.2, { fontScale: 0.8 }),
      enter: { x: 0, y: 1.1 },
      camera: { travel: 0.08, zoomStart: 1.08, zoomEnd: 1.02 },
      mood: 'loud'
    },
    'cross-vent': {
      region: region(0.5, 0.82, 0.66, 0.2, { fontScale: 0.8 }),
      enter: { x: 0, y: 1 },
      camera: { travel: 0.07, zoomStart: 1.1, zoomEnd: 1.02 },
      mood: 'loud'
    },
    'louvre-slats': {
      region: region(0.5, 0.8, 0.7, 0.22, { fontScale: 0.82 }),
      enter: { x: 0.8, y: 0.7 },
      camera: { travel: 0.11, zoomStart: 1.05, zoomEnd: 1.13 },
      mood: 'neutral'
    },
    'ring-eye': {
      // 在环内侧留下的岛上；画面里再无别处是实心的
      region: region(0.5, 0.5, 0.26, 0.18, { fontScale: 0.62 }),
      enter: { x: 0, y: 0.7 },
      camera: { travel: 0.05, zoomStart: 1.14, zoomEnd: 1.03 },
      mood: 'quiet'
    },
    'notch-stack': {
      region: region(0.32, 0.5, 0.5, 0.34, { fontScale: 0.84 }),
      enter: { x: -1.1, y: 0.5 },
      camera: { travel: 0.1, zoomStart: 1.05, zoomEnd: 1.13 },
      mood: 'neutral'
    },
    'wedge-gap': {
      region: region(0.5, 0.78, 0.7, 0.24, { fontScale: 0.82 }),
      enter: { x: 0, y: 1.2 },
      camera: { travel: 0.12, zoomStart: 1.06, zoomEnd: 1.14 },
      mood: 'loud'
    },
    'dot-sieve': {
      region: region(0.75, 0.5, 0.38, 0.3, { fontScale: 0.78 }),
      enter: { x: 0.9, y: 0.4 },
      camera: { travel: 0.06, zoomStart: 1.03, zoomEnd: 1.09 },
      mood: 'quiet'
    },
    // 仪表盘族。字与重心块共享画面而不是躲开它，所以这些区域只要构图留出实心，
    // 就坐在块本身上
    'sight-mark': {
      region: region(0.5, 0.5, 0.46, 0.2, { fontScale: 0.85 }),
      enter: { x: 0, y: 0.8 },
      camera: { travel: 0.06, zoomStart: 1.12, zoomEnd: 1.02 },
      mood: 'loud'
    },
    'dial-scale': {
      region: region(0.5, 0.5, 0.36, 0.2, { fontScale: 0.8 }),
      enter: { x: 0.7, y: 0.5 },
      camera: { travel: 0.05, zoomStart: 1.1, zoomEnd: 1.02 },
      mood: 'neutral'
    },
    'chevron-run': {
      region: region(0.5, 0.52, 0.72, 0.3, { fontScale: 0.9 }),
      enter: { x: 0, y: -1.1 },
      camera: { travel: 0.14, zoomStart: 1.04, zoomEnd: 1.12 },
      mood: 'neutral'
    },
    'tally-column': {
      region: region(0.38, 0.5, 0.6, 0.32, { align: 'left', fontScale: 0.76 }),
      enter: { x: -0.9, y: 0.3 },
      camera: { travel: 0.05, zoomStart: 1.02, zoomEnd: 1.08 },
      mood: 'quiet'
    },
    'grid-focus': {
      region: region(0.5, 0.5, 0.62, 0.22, { fontScale: 0.85 }),
      enter: { x: 0.8, y: 0.6 },
      camera: { travel: 0.09, zoomStart: 1.05, zoomEnd: 1.13 },
      mood: 'neutral'
    },
    'axis-caps': {
      // 在横杆上被钻穿的孔口下方，仍在杆身上
      region: region(0.5, 0.72, 0.66, 0.24, { fontScale: 0.82 }),
      enter: { x: 0, y: 1.2 },
      camera: { travel: 0.13, zoomStart: 1.06, zoomEnd: 1.15 },
      mood: 'loud'
    },
    'strobe-slats': {
      region: region(0.5, 0.5, 0.3, 0.36, { fontScale: 0.8 }),
      enter: { x: 1, y: 0 },
      camera: { travel: 0.1, zoomStart: 1.08, zoomEnd: 1.16 },
      mood: 'loud'
    },
    'offset-plate': {
      region: region(0.48, 0.62, 0.4, 0.2, { fontScale: 0.85 }),
      enter: { x: -0.9, y: -0.6 },
      camera: { travel: 0.09, zoomStart: 1.07, zoomEnd: 1.15 },
      mood: 'loud'
    },
    'radial-comb': {
      region: region(0.42, 0.4, 0.62, 0.3, { fontScale: 0.88 }),
      enter: { x: -1.2, y: -0.4 },
      camera: { travel: 0.11, zoomStart: 1.05, zoomEnd: 1.13 },
      mood: 'neutral'
    },
    'bracket-target': {
      region: region(0.5, 0.28, 0.66, 0.24, { fontScale: 0.85 }),
      enter: { x: 0, y: -0.9 },
      camera: { travel: 0.06, zoomStart: 1.04, zoomEnd: 1.1 },
      mood: 'quiet'
    },
    // 走廊族。通道随 flow 倾斜，所以这里的区域都避开了长斜开口横穿画面时的
    // 横向位移（见 compositions-a 的 channelAxis 说明）
    'flow-channel': {
      region: region(0.32, 0.5, 0.5, 0.3, { fontScale: 0.85 }),
      enter: { x: -1, y: 0.5 },
      camera: { travel: 0.13, zoomStart: 1.04, zoomEnd: 1.12 },
      mood: 'neutral'
    },
    'twin-channel': {
      // 在两条走廊之间的肋上
      region: region(0.5, 0.5, 0.4, 0.3, { fontScale: 0.85 }),
      enter: { x: 0, y: 1.2 },
      camera: { travel: 0.14, zoomStart: 1.03, zoomEnd: 1.11 },
      mood: 'neutral'
    },
    'reed-run': {
      region: region(0.5, 0.5, 0.3, 0.3, { fontScale: 0.72 }),
      enter: { x: 0, y: 0.9 },
      camera: { travel: 0.1, zoomStart: 1.02, zoomEnd: 1.09 },
      mood: 'quiet'
    },
    'taper-channel': {
      region: region(0.28, 0.5, 0.42, 0.3, { fontScale: 0.82 }),
      enter: { x: -1.1, y: 0.6 },
      camera: { travel: 0.12, zoomStart: 1.05, zoomEnd: 1.14 },
      mood: 'neutral'
    },
    'chain-ports': {
      region: region(0.32, 0.5, 0.5, 0.32, { fontScale: 0.8 }),
      enter: { x: -0.8, y: 0.7 },
      camera: { travel: 0.11, zoomStart: 1.03, zoomEnd: 1.1 },
      mood: 'quiet'
    },
    'dash-channel': {
      region: region(0.3, 0.5, 0.46, 0.3, { fontScale: 0.84 }),
      enter: { x: 0, y: 1.3 },
      camera: { travel: 0.15, zoomStart: 1.04, zoomEnd: 1.13 },
      mood: 'neutral'
    },
    'window-run': {
      region: region(0.28, 0.5, 0.42, 0.3, { fontScale: 0.82 }),
      enter: { x: 0, y: 1.2 },
      camera: { travel: 0.14, zoomStart: 1.04, zoomEnd: 1.12 },
      mood: 'neutral'
    },
    'bridge-span': {
      // 在横跨走廊的带上——族里最宽的开口从它下方穿过
      region: region(0.5, 0.5, 0.72, 0.16, { fontScale: 0.85 }),
      enter: { x: 1.2, y: 0 },
      camera: { travel: 0.12, zoomStart: 1.08, zoomEnd: 1.16 },
      mood: 'loud'
    },
    'braid-channel': {
      region: region(0.5, 0.5, 0.34, 0.3, { fontScale: 0.8 }),
      enter: { x: 0, y: 1.1 },
      camera: { travel: 0.13, zoomStart: 1.06, zoomEnd: 1.15 },
      mood: 'loud'
    },
    'port-ladder': {
      region: region(0.3, 0.5, 0.46, 0.3, { fontScale: 0.78 }),
      enter: { x: -0.9, y: 0.4 },
      camera: { travel: 0.09, zoomStart: 1.02, zoomEnd: 1.09 },
      mood: 'quiet'
    },
    // 粗野主义巨构。字后的地面是实心时，区域被摆到骑在体量轮廓线上——
    // 一个字一半在体量上一半在外，正是反色滤镜最出效果的地方。
    // 构图把地面开给背景时，区域整体挪到体量上（原因见 cutout 工具注释）
    'apex-mass': {
      // 坐在顶点略上方，顶点正好顶进字框下沿
      region: region(0.5, 0.3, 0.62, 0.2, { fontScale: 0.9 }),
      enter: { x: 0, y: -1 },
      camera: { travel: 0.12, zoomStart: 1.04, zoomEnd: 1.13 },
      mood: 'loud'
    },
    'ziggurat': {
      region: region(0.5, 0.32, 0.5, 0.18, { fontScale: 0.85 }),
      enter: { x: 0, y: -0.9 },
      camera: { travel: 0.1, zoomStart: 1.06, zoomEnd: 1.15 },
      mood: 'loud'
    },
    'slab-wall': {
      region: region(0.36, 0.5, 0.5, 0.24, { fontScale: 0.88 }),
      enter: { x: 1.2, y: 0 },
      camera: { travel: 0.11, zoomStart: 1.05, zoomEnd: 1.12 },
      mood: 'neutral'
    },
    'cantilever': {
      region: region(0.42, 0.42, 0.6, 0.14, { fontScale: 0.8 }),
      enter: { x: -1.3, y: 0 },
      camera: { travel: 0.13, zoomStart: 1.04, zoomEnd: 1.12 },
      mood: 'loud'
    },
    'pylon-pair': {
      // 在过梁上；它下方的间间开向背景
      region: region(0.5, 0.22, 0.7, 0.12, { fontScale: 0.75 }),
      enter: { x: 0, y: -0.8 },
      camera: { travel: 0.09, zoomStart: 1.08, zoomEnd: 1.02 },
      mood: 'loud'
    },
    'bunker-slit': {
      region: region(0.5, 0.48, 0.72, 0.2, { fontScale: 0.86 }),
      enter: { x: 0.9, y: 0.4 },
      camera: { travel: 0.08, zoomStart: 1.06, zoomEnd: 1.13 },
      mood: 'neutral'
    },
    'plinth-stack': {
      region: region(0.5, 0.32, 0.44, 0.16, { fontScale: 0.82 }),
      enter: { x: 0, y: -0.8 },
      camera: { travel: 0.1, zoomStart: 1.05, zoomEnd: 1.13 },
      mood: 'neutral'
    },
    'buttress-run': {
      region: region(0.5, 0.26, 0.7, 0.2, { fontScale: 0.86 }),
      enter: { x: 0.8, y: -0.8 },
      camera: { travel: 0.12, zoomStart: 1.03, zoomEnd: 1.11 },
      mood: 'loud'
    },
    'void-core': {
      region: region(0.5, 0.2, 0.66, 0.18, { fontScale: 0.84 }),
      enter: { x: 0, y: -1.1 },
      camera: { travel: 0.11, zoomStart: 1.07, zoomEnd: 1.15 },
      mood: 'loud'
    },
    'shear-block': {
      region: region(0.5, 0.5, 0.56, 0.2, { fontScale: 0.88 }),
      enter: { x: 1, y: 0.5 },
      camera: { travel: 0.12, zoomStart: 1.06, zoomEnd: 1.14 },
      mood: 'neutral'
    },
    'ridge-line': {
      region: region(0.5, 0.42, 0.72, 0.2, { fontScale: 0.9 }),
      enter: { x: 0, y: -1 },
      camera: { travel: 0.14, zoomStart: 1.03, zoomEnd: 1.12 },
      mood: 'neutral'
    },
    'chasm': {
      region: region(0.25, 0.5, 0.38, 0.24, { fontScale: 0.82 }),
      enter: { x: -1.2, y: 0.4 },
      camera: { travel: 0.1, zoomStart: 1.06, zoomEnd: 1.14 },
      mood: 'loud'
    },
    'overhang': {
      region: region(0.44, 0.58, 0.6, 0.22, { fontScale: 0.88 }),
      enter: { x: 0, y: 1.1 },
      camera: { travel: 0.11, zoomStart: 1.08, zoomEnd: 1.02 },
      mood: 'loud'
    },
    'step-well': {
      region: region(0.5, 0.26, 0.66, 0.2, { fontScale: 0.85 }),
      enter: { x: 0, y: -0.9 },
      camera: { travel: 0.09, zoomStart: 1.04, zoomEnd: 1.12 },
      mood: 'neutral'
    },
    'pier-row': {
      region: region(0.5, 0.4, 0.76, 0.14, { fontScale: 0.82 }),
      enter: { x: 1.1, y: 0 },
      camera: { travel: 0.13, zoomStart: 1.03, zoomEnd: 1.1 },
      mood: 'neutral'
    },
    'revetment': {
      region: region(0.46, 0.3, 0.6, 0.2, { fontScale: 0.86 }),
      enter: { x: -1, y: -0.6 },
      camera: { travel: 0.12, zoomStart: 1.05, zoomEnd: 1.13 },
      mood: 'neutral'
    },
    'tower-crop': {
      region: region(0.28, 0.5, 0.44, 0.24, { align: 'left', fontScale: 0.74 }),
      enter: { x: -0.8, y: 0.3 },
      camera: { travel: 0.06, zoomStart: 1.02, zoomEnd: 1.09 },
      mood: 'quiet'
    },
    'lintel': {
      region: region(0.5, 0.5, 0.76, 0.16, { fontScale: 0.9 }),
      enter: { x: -1.1, y: 0 },
      camera: { travel: 0.1, zoomStart: 1.02, zoomEnd: 1.08 },
      mood: 'quiet'
    },
    'rubble-fan': {
      region: region(0.56, 0.4, 0.5, 0.22, { fontScale: 0.84 }),
      enter: { x: 1.2, y: -0.5 },
      camera: { travel: 0.13, zoomStart: 1.07, zoomEnd: 1.16 },
      mood: 'loud'
    },
    'gnomon': {
      region: region(0.66, 0.34, 0.46, 0.2, { fontScale: 0.78 }),
      enter: { x: 0.9, y: -0.4 },
      camera: { travel: 0.07, zoomStart: 1.03, zoomEnd: 1.1 },
      mood: 'quiet'
    },
    // 物语系过场卡：一整面平涂，文字即整幅画面，所以区域大、字号大
    'monogatari-card': {
      region: region(0.5, 0.5, 0.78, 0.5, { fontScale: 1.15 }),
      enter: { x: 0, y: 0.7 },
      camera: { travel: 0.03, zoomStart: 1.02, zoomEnd: 1.07 },
      mood: 'quiet',
      // 裸卡按定义是一面素场；共享叠层会毁掉它
      sharedDecor: false
    },
    'monogatari-rule': {
      region: region(0.5, 0.46, 0.76, 0.4, { fontScale: 1.05 }),
      enter: { x: 0.6, y: 0 },
      camera: { travel: 0.04, zoomStart: 1.03, zoomEnd: 1.09 },
      mood: 'quiet',
      sharedDecor: false
    },
    'monogatari-edge': {
      region: region(0.52, 0.5, 0.72, 0.46, { align: 'left', fontScale: 1.05 }),
      enter: { x: -0.8, y: 0 },
      camera: { travel: 0.05, zoomStart: 1.02, zoomEnd: 1.08 },
      mood: 'neutral',
      sharedDecor: false
    },
    'monogatari-stack': {
      region: region(0.5, 0.5, 0.44, 0.62, { fontScale: 1 }),
      enter: { x: 0, y: 0.9 },
      camera: { travel: 0.04, zoomStart: 1.05, zoomEnd: 1.12 },
      mood: 'quiet',
      sharedDecor: false
    },
    'monogatari-flash': {
      region: region(0.5, 0.5, 0.82, 0.44, { fontScale: 1.3 }),
      enter: { x: 0, y: 0.5 },
      camera: { travel: 0.02, zoomStart: 1.08, zoomEnd: 1.01 },
      mood: 'loud',
      sharedDecor: false
    }
  }

  function resolveTemperaShotProfile(kind) {
    return TEMPERA_SHOT_PROFILES[kind] || TEMPERA_SHOT_PROFILES['duo-split']
  }

  // 该性格的段落允许切至的构图集合
  function resolveTemperaShotCandidates(moods) {
    var candidates = TEMPERA_SHOT_KINDS.filter(function (kind) {
      return moods.indexOf(resolveTemperaShotProfile(kind).mood) >= 0
    })
    return candidates.length > 0 ? candidates : TEMPERA_SHOT_KINDS
  }

  window.FoliaTemperaProfiles = {
    TEMPERA_SHOT_PROFILES: TEMPERA_SHOT_PROFILES,
    resolveTemperaShotProfile: resolveTemperaShotProfile,
    resolveTemperaShotCandidates: resolveTemperaShotCandidates
  }
})()
