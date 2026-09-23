# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目定位

这是 EchoMusic（Electron + Vue 3 + Pinia 桌面音乐播放器）的一个 **插件子目录**：`plugins/folia-style`。仓库根在 `B:\git-workspace\EchoMusic`，本插件是根仓库跟踪的众多插件之一（`plugins/` 下与 `betterlyrics-engine`、`lyric-focus`、`Record-player` 等并列）。

插件的作用是替换宿主内置的歌词页——当宿主 `player.isLyricViewOpen` 变为 true 时，本插件挂载一个全屏覆盖层，在其中用 `<iframe>` 加载 `folia/bridge.html`（独立的可视化前端），通过 `postMessage` 与宿主双向通信。

歌词动画体系是 **folia-major（React 项目）13 种歌词可视化模式的原生 JS 一比一复刻**（另含其 6 种背景系统与封面取色主题）。歌词数据不用原版的解析管线，而是沿用本插件现有获取方式：宿主 Pinia lyric store → `index.js` 归一化毫秒行 → postMessage → iframe 内适配为原版 Line 结构（秒）。

没有构建、没有测试、没有 lint 配置。所有 JS 都是运行时直接由宿主/浏览器执行的源码——修改后直接由 EchoMusic 加载即可，不需要打包。

## 目录结构（关键的部分）

```
manifest.json            # 插件元数据（id/version/capabilities/requires）
index.js                 # 宿主侧 ESM 模块，暴露 activate/deactivate
style.css                # 宿主侧样式（覆盖层容器 + 加载态）
TRANSPILE_GUIDE.md       # 模式转写规范（模式接口/frameState/工具库/React→原生对应规则）
INTEGRATION.md           # bridge.html 接入规范（历史文档，集成已完成，留作参考）
folia/
  bridge.html            # iframe 内的完整前端（HTML + 内联主脚本 ~1300 行）：
                         #   状态机 S、消息路由、模式/背景经注册表调度、主循环 tick、设置菜单
  css/base.css           # 基础样式（控制胶囊/设置菜单/队列面板；旧模式 override 已删）
  runtime/               # 公共运行时（folia-major utils 的原生 JS 移植 + 自研动画引擎）
    color-mix.js           # 颜色混合/解析（colorWithAlpha/mixColors/parseColorChannels）
    grapheme-timing.js     # 字形级时间轴（splitLyricGraphemes/buildWordGraphemeTimings/buildLineGraphemeTimeline）
    word-segmentation.js   # Intl.Segmenter 词级分词
    render-hints.js        # 行渲染提示（normal/short/micro 三档，决定进出场与词揭示节奏）
    visualizer-runtime.js  # 行调度（activeLine/recentCompletedLine/upcomingLine/nextLines/preheat）
    sentence-layout.js     # 多行分句（标点/括号/西文块/CJK 空格分层切分，倾诉模式用）
    cjk-semantic-layout.js # CJK 语义布局单元 + 粘着标点（流光/云阶用）
    word-coloring.js       # 主题关键词上色（resolveWordColor/区间着色）
    anim.js                # framer-motion 等价引擎（spring 物理采样 + WAAPI 关键帧/补间）
    theme.js               # 封面取色主题链路（extractColors → 调色板分析 → 明暗五色主题 + 对比度求解）
    lyrics-data.js         # 行数据适配（宿主毫秒行 → 原版 Line 秒制 + renderHints 推导 + 行索引查找）
    subtitle-overlay.js    # 共享底部字幕（翻译/罗马音 + 下一句预览）
    registry.js            # 13 种模式注册表（id/label/文件清单/vendor 懒加载/旧 id 映射）
  modes/                 # 13 种模式；统一接口 create() → { id, mount, setTheme, setLines, setFontScale, tick(frameState), destroy }
    classic.js liuguang 已并入  # 流光（原版 classic，逐词弹性 + 双层发光，默认模式）
    cadenza.js             # 心象（pretext 排版 + hero 强调 + 碰撞回避散落 + 指数平滑逐帧驱动）
    partita.js             # 云阶（分块 stagger + 引导线）
    tilt.js                # 倾诉（SentenceLayout 分句 + 斜体错落 + 逐字脉冲）
    fume.js                # 浮名（canvas 2D 文章布局 + 相机阅读）
    monet.js               # 莫奈（海报人像 + 歌词 rail + 频谱，原版 ~3400 行转写）
    sonnet/ + sonnet.js    # 商籁（Pixi WebGL 日系文字 PV，15 文件 ~10600 行）
    tempera/ + tempera.js  # 凝彩（Pixi 色块拼贴，14 文件 ~9400 行，复用 sonnet-core/sonnet-filters）
    diorama/ + diorama.js  # 镜台（three.js 3D 歌词走廊，8 文件 ~5100 行）
    claddagh.js            # 回环（椭圆环投影 + spring 自转）
    pendolo-core.js + pendolo.js  # 时计（表盘弧形歌词 + 机芯 canvas）
    cappella.js            # 群唱（聊天弹幕 + 表情/头像图）
    still.js               # 静止（低占用静态三行）
  backgrounds/           # 6 种背景系统（与模式同构的注册表 + 实例接口）
    background-registry.js # 背景注册表（common/latent/monet/nomand/sora/url）
    paper-mount.js         # @paper-design/shaders core 适配层（uniforms 组装 + 图片预加载）
    common.js              # 底色 + 可选封面流体（blur 40px 交叉淡入）+ 几何音频响应 + 暗角
    latent.js              # MeshGradient + Dithering 双 shader + 音频响应
    monet-bg.js            # 封面 canvas 位图管线 + 分形噪声漂移
    nomand.js              # 5 种 Paper 图像滤镜（抖动/半调/镜头畸变/纸纹理/毛玻璃）
    sora.js                # twgl GLSL 星空粒子
    url.js                 # 网页 iframe 背景
  vendor/                # 预编译第三方库（从 CDN 下载 / esbuild 打包的 IIFE，按需懒加载）
    pixi.min.js            # PixiJS 8.20（window.PIXI）— 商籁/凝彩
    three.iife.js          # three 0.185（window.THREE）— 镜台
    pretext.iife.js        # @chenglou/pretext 0.0.8（window.Pretext）— 心象/浮名/莫奈/时计/群唱/回环/商籁/凝彩
    paper-shaders.iife.js  # @paper-design/shaders core（window.PaperShaders）— latent/nomand 背景
    twgl-full.min.js       # twgl.js 7（window.twgl）— 星野背景
  assets/                # 群唱模式表情/头像 PNG（cappella-emo/ cappella-avatar/）
```

## 模式接口与 frameState（改模式前必读）

完整规范见 `TRANSPILE_GUIDE.md`。要点：

- 模式实例 `tick(frameState)` 每帧收到：`currentTime`（秒，含歌词矫正）、`dt`、`currentLineIndex`、`lines`（原版 Line 结构：`{startTime, endTime, words, fullText, translation, renderHints}`，秒制）、`theme`（五色 + animationIntensity）、`audioPower`（0~1）、`audioBands`（`{bass, lowMid, mid, vocal, treble}` 0~1；背景内部自行 ×255 还原原版值域）、`isPlaying`、`showText`、`songTitle/songArtist/songAlbum/coverUrl`。
- 主循环行索引用 `FoliaLyricsData.findLatestActiveLineIndex`（renderEndTime 内视为活动行），与原版 `findLatestActiveLineIndex` 行为一致。
- 主题：切歌时 `FoliaTheme.buildThemeFromCover(coverUrl)` 异步取色生成；默认主题为原版"午夜墨染"（#09090b/#f4f4f5/#f4f4f5/#71717a）。
- 字体：模式内一律走 `window.foliaGetLyricFontFamily()`（bridge.html 由宿主 `echo-folia:appearance` 设置），判空回退 `theme.fontFamily || 'sans-serif'`。

## 宿主 API（`ctx`）实际使用面

`index.js` 的 `activate(ctx)` 依赖以下宿主注入项，改动前先确认还在使用：

- `ctx.vue`：`defineComponent / h / ref / watch / onMounted / onBeforeUnmount`
- `ctx.ui.teleport(component, { id, className })`：挂载一个组件到宿主 DOM 顶层
- `ctx.router`：Vue Router 实例；`ctx.router.push({ name: 'artist-detail' | 'album-detail' })`
- `ctx.fs.getFileUrl(pluginRelativePath)`：把插件内文件转成 iframe 能加载的 URL
- `ctx.descriptor.directory`：本插件磁盘根，用于拼接 `folia/bridge.html`
- `ctx.manifest.version`
- `ctx.dispose(fn)`：注册卸载回调
- Stores：`ctx.stores.player / lyric / playlist / settings`（Pinia，`$subscribe` 可用）
- 便捷 facade：`ctx.player.{toggle,prev,next,seek,setVolume,setPlayMode,playTrack,playSong,playNext,toggleLyricView}`、`ctx.playlist.{remove,clear,activeQueue,getActiveQueue}`
- `ctx.audio.spectrum.subscribe({ fps, binCount, smoothing, scale, includeWaveform }, cb) → dispose`
- 全局 `window.electron.{platform, windowControl(action), miniPlayer.show()}`

宿主要求写在 `manifest.json` 的 `requires.echoMusicVersion` 与 `capabilities`（当前 `localFiles + audioSpectrum`）里；改动时同步更新。

## 双向消息协议（宿主 ↔ iframe）

所有消息带 `source` 字段区分方向；宿主发 `echo-folia-parent`，iframe 发 `echo-folia-child`。

宿主 → iframe（`index.js` 中 `postToFrame`）：
- `echo-folia:init`：iframe ready 后一次，携带 `pluginVersion / hostControls(含 nativeWindowControls/windowControlsInset) / settings(动画模式+强度)`
- `echo-folia:host-controls`：宿主窗口能力变更（缩放/全屏等导致原生按钮预留宽度变化）时重推，iframe 据此重装右上角窗口控制按钮；宿主 >=2.3.2-beta.2 在 Windows/Linux 用原生 `titleBarOverlay` 按钮，插件据此不再自绘最小化/最大化/关闭，并把 mini+全屏 右移 `windowControlsInset` 避开原生按钮
- `echo-folia:snapshot`：完整状态（track / queue / playMode / isFavorited / coverBlur / lyric.currentIndex 等），命令执行后与曲目/音量变化会强制重推
- `echo-folia:lyrics`：归一化后的歌词行（毫秒；characters 逐字时间轴同为毫秒），带 dedupe key
- `echo-folia:position`：`{position_ms, duration_ms, is_playing, cause}`，5 秒心跳 + 事件驱动
- `echo-folia:spectrum`：`{bins, waveform, rms, peak, state, timePos}`；注意 S.bass/mid/treble 值域为 0~200（bins 均值/255*200），bridge 的 `normBand` 归一到 0~1 后才传给模式/背景
- `echo-folia:appearance`：歌词字体族变化时推送

iframe → 宿主（`bridge.html` 内 `parent.postMessage`）：
- `echo-folia:ready`：iframe 完成初始化
- `echo-folia:request-snapshot`：请求重推快照+歌词+位置
- `echo-folia:command`：受支持的 `command` 值在 `index.js` 的 `executeCommand` 里，包括
  `toggle-play/play/pause/prev/next/seek/volume/cycle-mode/set-mode/play-index/play-song/queue-play-next-song/queue-play-next-index/queue-remove-index/queue-clear/close/mini-player/window-control/open-artist/open-album/toggle-favorite/toggle-cover-blur/set-anim-mode/set-intensity`

**改协议时两边都要改**：宿主 `index.js` + `folia/bridge.html`（搜 `echo-folia:` 就能找齐所有分支）。命令在宿主端通过 `commandQueue` 串行执行，命令完成后自动补发一次 snapshot + position。`set-anim-mode` 的 mode 值现在是原版模式 id（classic/cadenza/...），宿主只透传存储。

## iframe 内部架构（`folia/bridge.html`）

- 前半是模板 DOM：设置菜单（音乐/歌词/设置/播放列表四页）、底部控制胶囊、`#folia-bg-host`（背景挂载，z1）、`#folia-mode-host`（模式挂载，z5）、`#win-controls` 窗口控制。
- 主脚本：状态机 `S`、歌词过滤（保留）、模式/背景注册表调度（`switchToMode/switchToBackground`）、切歌钩子 `onSongMaybeChanged`（主题取色 + 每歌随机模式）、主循环 `tick`（进度条 + frameState 驱动模式 + 背景帧驱动）。
- 时间轴：宿主 `position` 事件只在事件/心跳时发；iframe 用 `getLocalTimeMs()` 做本地外推，加上用户 `folia-timeOffset`（localStorage 存的歌词矫正秒数）得到 `effectiveLyricTimeMs()`——只影响歌词显示，绝不改真实播放进度。
- 设置存储（localStorage）：`folia-animMode`（模式 id，旧 id 自动经 `FoliaRegistry.resolveId` 映射）、`folia-intensity`（calm/normal/chaotic）、`folia-backgroundMode`（6 种背景）、`folia-randomModePerSong`（每歌随机开关）、`folia-timeOffset`、`folia-lyricFilterEnabled/folia-lyricFilterRegex`、`folia-coverBlur`、`folia-urlBackgrounds`（url 背景列表 JSON）。
- 背景切换幂等（同 id 重复调用返回现有实例）；common 背景的 `useCoverColorBg` 跟随 `folia-coverBlur` 开关，变更时销毁重建实例。

新增模式的路径：按 `TRANSPILE_GUIDE.md` 写 `modes/xxx.js`（工厂 `window.FoliaModeXxx.create`）→ `runtime/registry.js` 注册（大体量模式用模块数组）→ `bridge.html` 设置菜单加选项。vendor 依赖（pixi/three/pretext）由注册表在加载模式前自动懒加载。

## 兼容与遗留

- `LEGACY_PAGE_PATH = '/main/plugin/folia-style/player'`：旧版本插件曾以路由页承载，现在检测到就 replace 到 `/main/home` 并弹覆盖层。删/改这个字符串前搜一下 EchoMusic 主仓有没有链接进来。
- 覆盖层通过监听 `stores.player.isLyricViewOpen` 触发；`closeOverlay` 会把它设回 false，两个方向都要保持同步，否则宿主播放器抽屉状态会漂移。
- 旧体系（`window.ModeXxx`/`ModeUtils`/`modeMap`/`FumeMode`/monet-container）已全部移除；若需回溯看 git 历史。

## 开发流程与本地约定

- 无 npm 脚本、无 lockfile：本插件是纯运行时源码。修改后由 EchoMusic 主程序热加载或重启拾取。
- vendor 库文件是预编译产物（pixi/three 从 jsdelivr 下载；three/pretext/paper-shaders 用 `npx esbuild --bundle --format=iife` 打包），更新时重新生成即可，不要手工编辑。
- 依赖 EchoMusic 主仓与 `native/*` 原生模块能正常构建才有得测；那些属于主仓，别在插件目录里操作它们。
- Git 由用户手动管理；不要自动 `git add / commit / push`。
- 使用 Node 时默认 ESM、无分号、Windows 环境；本插件的宿主入口 `index.js` 已经是 ESM（`export function activate`）。iframe 内脚本走 IIFE，是浏览器脚本环境。注释一律中文。
- 语法自查：`node --check <file>`（对每个 JS 文件）；bridge.html 的内联脚本可提取后 `new Function()` 验证。
