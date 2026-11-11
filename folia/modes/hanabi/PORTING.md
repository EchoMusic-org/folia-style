# 花火（hanabi）移植规范

从 folia-major（React+TS+Pixi 8.21）移植到本插件（原生 JS IIFE + vendor pixi 8.20.1）。全程中文注释，保留上游注释原意。

## 文件与命名

每个模块文件一个 IIFE，导出挂全局命名空间：

```js
(function () {
  'use strict'
  var PIXI = window.PIXI          // vendor 已由 registry 懒加载
  ... // 全部代码
  window.FoliaHanabiXxx = { ... } // 该文件对应的全部顶层导出，名字保持上游原名
})()
```

文件名与全局名对照（registry.js 的 file 数组按此顺序加载）：

| 文件 | 上游源 | 全局名 |
|---|---|---|
| hanabi-core.js | hanabiKernel.ts + hanabiRandom.ts + types.ts（常量/DEFAULT_HANABI_TUNING/类型常量表）+ hanabiTuning.ts（normalize/质量档/LIVE/OVERLAY/重建分类） | FoliaHanabiCore |
| hanabi-catalog.js | catalog.ts（50 预设 + BURST_PRESETS，纯数据，可整段复制去类型） | FoliaHanabiCatalog |
| hanabi-program.js | paragraphStructure.ts + program.ts + hanabiProgram.ts + hanabiScreenBloom.ts | FoliaHanabiProgram |
| hanabi-timeline.js | timeline.ts | FoliaHanabiTimeline |
| hanabi-transitions.js | hanabiTransitions.ts + hanabiSceneFrames.ts | FoliaHanabiTransitions |
| hanabi-color.js | color.ts | FoliaHanabiColor |
| hanabi-bloom.js | pixi/bloomFilter.ts + pixiTextureBudget.ts + pixiDisplayResources.ts | FoliaHanabiBloom |
| hanabi-textures.js | mg/textures.ts | FoliaHanabiTextures |
| hanabi-burstplan.js | mg/burstPlan.ts | FoliaHanabiBurstPlan |
| hanabi-fireworks.js | mg/fireworks.ts | FoliaHanabiFireworks |
| hanabi-glow.js | mg/glow.ts | FoliaHanabiMGGlow |
| hanabi-ambient.js | mg/ambient.ts | FoliaHanabiAmbient |
| hanabi-ornaments-kit/lines/particles/shapes.js | mg/ornamentKit/Lines/Particles/Shapes.ts | FoliaHanabiOrnamentsKit 等 |
| hanabi-ornaments.js | mg/ornaments.ts（createOrnament 分发） | FoliaHanabiOrnaments |
| hanabi-text-glyphs/layout/blocks/animations.js | text/glyphs.ts 等 | FoliaHanabiTextGlyphs 等 |
| hanabi-text.js | text/lyricText.ts | FoliaHanabiText |
| hanabi-collage-plan/painters/views/unit.js | collage/*.ts | FoliaHanabiCollagePlan 等 |
| hanabi-scene.js | scene.ts（createHanabiScene） | FoliaHanabiScene |
| hanabi-credits.js | credits.ts + hanabiCreditsLayer.ts | FoliaHanabiCredits |
| hanabi-overlay.js | overlay.ts | FoliaHanabiOverlay |
| hanabi-beatfx.js | hanabiBeatFx.ts | FoliaHanabiBeatFx |
| hanabi-runtime.js | createHanabiPixiRuntime.ts（HanabiPixiRuntime 类） | FoliaHanabiRuntime |
| modes/hanabi.js | VisualizerHanabi.tsx（模式入口） | FoliaModeHanabi |

## 可用的共享模块（禁止重复造）

- `window.FoliaSeedHash`：hashVisualizerSeed / mixVisualizerSeed / visualizerHash01 / createVisualizerRng / createVisualizerRngAt（= 上游 visualizerSeedHash.ts）
- `window.FoliaThemeColorMath`：hexToHsl / hslToHex / mixHexColors / getRelativeLuminance / getContrastRatio / adjustLightnessForContrast / normalizeHue / parseThemeColor（= utils/themeColorMath.ts + colorMix）
- `window.FoliaColorMix`：parseColorChannels / colorWithAlpha
- `window.FoliaBeatFx`：智能动感。消费点：`resolveAccentGain(event, trackScale)`、`getEffectStrength('hanabi.beatBursts'|'hanabi.beatPulse')`、`getEvents()`、`getHeard().time`、`getTrackScale()`、`isReady()`、`getImpact('beat'|'downbeat')`、`getRotationSign()`（= 上游 beatFxLive + motionSignals 的鸭子等价）
- `window.FoliaRenderHints.getLineRenderEndTime(line)`；`window.FoliaGraphemeTiming.buildLineGraphemeTimeline(line)`；`window.FoliaWordSegmentation`（分词，查 runtime/word-segmentation.js 的导出名）；`window.FoliaLyricsData.adaptLines`
- `window.FoliaTunings.resolveModeTuning('hanabi', config)`（模式入口用）
- 字重：`window.foliaGetLyricFontWeight(fallback)`（全局字重覆盖），字体栈：`theme.fontFamilyStack / fontFamily / fontStyle` + sans-serif 兜底（可参考 modes/machi/machi-runtime.js 的 themeFontStack）
- 图标：插件无 lucide；collage/sticker 的主题图标统一走兜底 `'Flower'`（line-art path 数据需要时内嵌到用到的文件）

## TS→JS 规则

- 删 interface / type / declare / as const / satisfies / 泛型实参 / 非空断言 `!` / 可选参数 `?`（保留 undefined 处理逻辑）
- `private readonly x` 构造参数属性 → 普通参数 + 构造体内 `this.x = x`
- 类 → 原型或闭包工厂；导出形状与上游一致
- 保留全部数值常量精确不变；保留全部中文注释（GLSL 模板串原样保留）
- `import * as pixi from 'pixi.js'` → `var PIXI = window.PIXI`；`import type` 删

## 模式实例约定（与先例 sonnet/lumiere/machi 一致）

- `create(tuning, config?)` → `{ id:'hanabi', mount, setTheme, setLines, tick, destroy, setTuning?, setShowText? }`
- TUNING 是 **createMode 作用域内的实例变量**：`var TUNING = window.FoliaTunings.resolveModeTuning('hanabi', config) || FoliaHanabiCore.DEFAULT_HANABI_TUNING`；禁止模块级可变状态（预览舞台与主页面可能同时运行）
- MotionValue（currentTime/audioPower）→ tick(frameState) 每帧注入普通数值，运行时内部以字段/getter 现读
- 字号：花火自动按镜头文字区算字号（ownFontSize），`lyricsFontScale` 不接（与上游一致）
- 歌曲提交门：简化为「歌词签名 + 2 秒确认纯音乐」（参考 modes/machi.js 的 commitSong）
- 预览实例（config.previewMode）：分辨率 1、抗锯齿关（registry.previewCreate 会把 config 透传给 create 第二参）
- Pixi v8 销毁纪律：Graphics 树逐节点无参 destroy（禁 `destroy({children:true})`）；纹理 `destroy(true)`；retired 场景/纹理每帧至多放一个；WebGL 上下文丢失 → 入口重建运行时
- 运行循环：上游 Pixi ticker 自转；插件改为 bridge tick 驱动——入口 tick 里 `runtime.renderFrame(now)`（内部做 songSwap.advance/场景帧/credits/bloom 全套），paused 时仍要 renderOnce 补帧语义由 bridge tick 天然覆盖

## 智能动感消费（保持上游 readBeatSource 语义）

- guard：staticMode || tuning.textOnly || !FoliaBeatFx.isReady() → null（回常态）
- strength = FoliaBeatFx.getEffectStrength('hanabi.beatBursts')；events = getEvents()；trackScale = getTrackScale()
- 推镜：k = rescaleBeatEnvelope(getImpact('beat'), clockStrength, ownStrength)——上游 beatImpact 已乘首个读表效果的强度，需先除掉 clock 强度再乘自己的；clockStrength 用 getEffectStrength('hanabi.beatBursts')（第一个读表效果），own 用 'hanabi.beatPulse'
