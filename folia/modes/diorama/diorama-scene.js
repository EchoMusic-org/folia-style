// 镜台（diorama）模式·场景主体模块：移植自 folia-major src/components/visualizer/diorama/
//   DioramaScene.tsx（全文逻辑）
// React → 原生转写：
//   JSX 树（mote points / DioramaParticleField / 邻居行平面 / 活动行单元群）
//     → THREE.Group 内的对象管理与逐帧 diff（对应 React 重渲染的属性更新）；
//   useMemo → 按依赖签名缓存（mountedIndices / visibleLines / corridorSpans /
//     particleClusters / activeLineTimeline / activeLineUnits / keywordUnitColors /
//     activeUnitsRaster / 邻居行光栅缓存）；
//   useEffect（字体就绪、纹理释放、异步邻居光栅批构建）→ 缓存失效 + 逐帧预算处理；
//   useFrame → update(ctx)（原版注释明确：逐帧值一律 ref，绝不 React state——照此办理）。
// drei 依赖：无（DioramaScene 未使用 drei 组件）。
// 依赖：window.THREE、window.FoliaDioramaCore/Sequencer/Text/Particles/Field、
//       window.FoliaGraphemeTiming、window.FoliaWordColoring。
// 挂载于 window.FoliaDioramaScene。
(function () {
  'use strict'

  var THREE = window.THREE
  var Core = window.FoliaDioramaCore
  var Sequencer = window.FoliaDioramaSequencer
  var Text = window.FoliaDioramaText
  var Particles = window.FoliaDioramaParticles
  var FieldFactory = window.FoliaDioramaField
  var GraphemeTiming = window.FoliaGraphemeTiming

  // 挂载为 3D 文本 + 构图的行窗口（相对当前行）。过去的行保持挂载可见后退，
  // 未来行挂在前方、由距离生命周期从远雾中诞生。
  var LINES_AHEAD = 3
  var LINES_BEHIND = 2
  // 转场期间离场文本只需小的离场簇，窗口更紧（纯文本；走廊按净空取窗）
  var OUTGOING_LINES_BEHIND = 2
  var OUTGOING_LINES_AHEAD = 1
  // 走廊窗口比文本更长，两端都要清出可见带（27 外点消亡、30 雾闭合）
  var CORRIDOR_LINES_AHEAD = 7
  var CORRIDOR_LINES_BEHIND = 6
  // 每动画帧光栅化的邻居行纹理预算——切歌的多行请求摊到几帧，避免单帧卡顿
  var NEIGHBOR_RASTER_BUDGET = 2
  // 非活动挂载行的不透明度（按有符号行偏移）。过去的行是压暗的退行轨迹
  function resolveNeighborLineOpacity(offset) {
    if (offset === -1) return 0.3
    if (offset === -2) return 0.1
    if (offset === 1) return 0.34
    if (offset === 2) return 0.16
    if (offset === 3) return 0.06
    return 0
  }
  // 转场期间离场走廊行的不透明度：柔和均匀的离场辉光，前活动行最亮
  function resolveOutgoingLineOpacity(offsetFromOutgoing) {
    return offsetFromOutgoing === 0 ? 0.7 : (Math.abs(offsetFromOutgoing) <= 2 ? 0.45 : 0.25)
  }

  // 歌词文本一 em 的标称世界尺寸。一行永远单行排版（不折行），超长行按帧宽缩放
  var LINE_FONT_SIZE = 0.62
  // 主构图距离处整行可占的画面宽度比例。fit 按 FIXED 参考距离算，相机推近/远离真实缩放
  var TARGET_FRAME_WIDTH_FRACTION = 0.72
  // fit 下限：极长行变小但可读
  var MIN_FIT_SCALE = 0.28
  var DEG_TO_RAD = Math.PI / 180
  // 雾带：主行与构图清晰，+3 行与配景诞生在雾中
  var FOG_NEAR = 12
  var FOG_FAR = 30
  // 文本专属的近端熔解带（比形体的紧）：贴镜歌词熔掉而非糊过镜头
  var TEXT_DISSOLVE_START = 2.0
  var TEXT_DISSOLVE_END = 0.9
  // 文本生命周期的远端——整体在雾远面之后，保证行真正到零而非雾色残影
  var TEXT_FADE_IN_START = 32
  var TEXT_FADE_IN_END = 40
  // 阻尼主题色的追踪速率（每秒，exp 平滑）
  var COLOR_DAMP_RATE = 1.2
  // 逐单元演唱态渲染（照搬 classic 揭示模型）
  var ACTIVE_LINE_OPACITY = 0.92
  var UNSUNG_UNIT_OPACITY = 0.5
  // 辉光平面加性不透明度上限（乘逐帧电平与辉光滑条）
  var UNIT_GLOW_MAX_OPACITY = 0.9
  // 灵魂出窍：加性鬼影副本的各上限
  var SOUL_MAX_OPACITY = 0.6
  var SOUL_ACTIVE_LIFT_EM = 0.06
  var SOUL_DETACH_LIFT_EM = 0.5
  var SOUL_ACTIVE_SWELL = 0.1
  var SOUL_DETACH_SWELL = 0.3
  // 字形唱完后鬼影从"贴字漂移"过渡到"离体飞行"的时长
  var SOUL_HANDOFF_SECONDS = 0.5

  function clamp01(value) { return Math.min(1, Math.max(0, value)) }

  // 空集合常量：粒子场输入按引用比较，避免逐帧新建空数组导致几何反复重建
  var EMPTY_CLUSTERS = []
  var EMPTY_SPANS = []

  // 快攻慢放包络步进：上升目标被快速追踪，下降缓慢
  function stepEnvelope(current, target, attack, release, delta) {
    return current + (target - current) * (1 - Math.exp(-(target > current ? attack : release) * delta))
  }

  function smoothstep01(t) { return t * t * (3 - 2 * t) }

  // 渐变跟唱的尾迹时长
  var GRADIENT_HOLD_SECONDS = 0.35
  var GRADIENT_TRAIL_SECONDS = 1.8

  /**
   * 渐变跟唱能量（单单元单时刻）：唱前 0，跨自身时程缓到 1，保持，再单路衰减回 0。
   * 只读该单元自己的起止时间——播放时钟的纯函数，seek/循环/暂停按构造正确。
   */
  function resolveGradientEnergy(now, unit) {
    if (now <= unit.startTime) return 0
    if (now < unit.endTime) {
      var span = Math.max(unit.endTime - unit.startTime, 0.001)
      return smoothstep01(clamp01((now - unit.startTime) / span))
    }
    var sinceSung = now - unit.endTime
    if (sinceSung <= GRADIENT_HOLD_SECONDS) return 1
    return 1 - smoothstep01(clamp01((sinceSung - GRADIENT_HOLD_SECONDS) / GRADIENT_TRAIL_SECONDS))
  }

  /** 单个歌词单元的填充色：静息色按自身演唱进度向 `target` 染色（写入 out，零分配）。 */
  function resolveDioramaUnitFill(out, primary, target, progress) {
    return out.copy(primary).lerp(target, clamp01(progress))
  }

  /** 活动行的逐单元状态是否必须重新分配（新活动行，或活下标下的歌词置换）。 */
  function shouldResetDioramaUnitState(previousGlobalIndex, globalIndex, unitStateLength, unitCount) {
    return previousGlobalIndex !== globalIndex || unitStateLength !== unitCount
  }

  /** 歌词平面的距离生命周期（两端）：远雾外 0、中段 1、贴近镜头再熔解回 0。 */
  function resolveTextLife(distanceToCamera) {
    var farT = clamp01((TEXT_FADE_IN_END - distanceToCamera) / (TEXT_FADE_IN_END - TEXT_FADE_IN_START))
    var nearT = clamp01((distanceToCamera - TEXT_DISSOLVE_END) / (TEXT_DISSOLVE_START - TEXT_DISSOLVE_END))
    return (farT * farT * (3 - 2 * farT)) * (nearT * nearT * (3 - 2 * nearT))
  }

  // 按 `distance` 处画面宽度的目标占比收缩一行的统一缩放（three fov 为垂直方向）
  function resolveFrameFitScale(renderedWidth, distance, verticalFovDeg, aspect) {
    if (renderedWidth <= 0 || distance <= 0) return 1
    var frameWidth = 2 * distance * Math.tan((verticalFovDeg * DEG_TO_RAD) / 2) * aspect
    var targetWidth = frameWidth * TARGET_FRAME_WIDTH_FRACTION
    return Math.min(1, Math.max(MIN_FIT_SCALE, targetWidth / renderedWidth))
  }

  // 渐变着色临时量（无逐帧分配）
  var _sungTint = new THREE.Color()
  var _gradDeep = new THREE.Color()
  var _neutral = new THREE.Color()

  // 行文本朝向构建的可复用临时量
  var _basisMatrix = new THREE.Matrix4()
  var _basisQuat = new THREE.Quaternion()
  var _tiltQuat = new THREE.Quaternion()
  var _basisRight = new THREE.Vector3()
  var _basisUp = new THREE.Vector3()
  var _basisFwd = new THREE.Vector3()
  var _axisY = new THREE.Vector3(0, 1, 0)
  var _axisZ = new THREE.Vector3(0, 0, 1)

  // 把行文本定向为背沿路径面向跟随相机（+X -> frame right, +Y -> frame up, +Z -> -forward：
  // 真旋转，永不镜像），再叠加放置的 yaw 与面内 roll
  function frameQuaternion(frame, roll, yaw) {
    if (roll === undefined) roll = 0
    if (yaw === undefined) yaw = 0
    _basisRight.set(frame.right.x, frame.right.y, frame.right.z)
    _basisUp.set(frame.up.x, frame.up.y, frame.up.z)
    _basisFwd.set(-frame.forward.x, -frame.forward.y, -frame.forward.z)
    _basisMatrix.makeBasis(_basisRight, _basisUp, _basisFwd)
    _basisQuat.setFromRotationMatrix(_basisMatrix)
    if (yaw !== 0) _basisQuat.multiply(_tiltQuat.setFromAxisAngle(_axisY, yaw))
    if (roll !== 0) _basisQuat.multiply(_tiltQuat.setFromAxisAngle(_axisZ, roll))
    return _basisQuat.clone()
  }

  // CJK 字形按字符拆分：汉字/假名/兼容表意/半角假名，外加圆点与几何形状
  // （插曲倒计时的 ●●● 每个点必须是独立单元，辉光才能逐点居中）。其余按词组成单元。
  var CJK_GRAPHEME_RE = /[\u2E80-\u9FFF\u3040-\u30FF\uF900-\uFAFF\uFF66-\uFF9F\u2022\u00B7\u25A0-\u25FF]/

  function createDioramaScene(options) {
    // options: { theme, showLyrics, showParticles, backgroundParticleCircumference,
    //   backgroundParticleRadial, geometryVisibility, particleDensity, particleScale,
    //   particleGlowEnabled, particleGlowIntensity, lyricsFontScale, glowIntensity,
    //   soulIntensity, soulActiveEnabled, gradientIntensity, keywordColoringEnabled,
    //   motion, scene }
    var params = {
      showLyrics: options.showLyrics,
      showParticles: options.showParticles,
      backgroundParticleCircumference: options.backgroundParticleCircumference,
      backgroundParticleRadial: options.backgroundParticleRadial,
      geometryVisibility: options.geometryVisibility,
      particleDensity: options.particleDensity,
      particleScale: options.particleScale,
      particleGlowEnabled: options.particleGlowEnabled,
      particleGlowIntensity: options.particleGlowIntensity,
      lyricsFontScale: options.lyricsFontScale,
      glowIntensity: options.glowIntensity,
      soulIntensity: options.soulIntensity,
      soulActiveEnabled: options.soulActiveEnabled,
      gradientIntensity: options.gradientIntensity,
      keywordColoringEnabled: options.keywordColoringEnabled
    }
    var themeRef = options.theme
    var motion = options.motion
    var scene = options.scene

    // ---- 阻尼主题色（原版 colorTargets useMemo + dampedColorsRef）----
    var colorTargets = null
    var colorTargetsKey = null
    var dampedColors = null

    function resolveColorTargets() {
      var primary = themeRef.primaryColor
      var accent = themeRef.accentColor || themeRef.primaryColor
      var secondary = themeRef.secondaryColor
      var bg = themeRef.backgroundColor
      var key = primary + '|' + accent + '|' + secondary + '|' + bg
      if (colorTargetsKey !== key || !colorTargets) {
        colorTargetsKey = key
        colorTargets = {
          primary: new THREE.Color(primary),
          accent: new THREE.Color(accent),
          secondary: new THREE.Color(secondary),
          bg: new THREE.Color(bg)
        }
        // 关键字匹配器也依赖主题（原版 useMemo [theme.wordColors, enabled]）
        keywordMatchers = Text.prepareDioramaKeywordMatchers(themeRef.wordColors, params.keywordColoringEnabled)
      }
      return colorTargets
    }
    resolveColorTargets()

    // ---- 字体（原版 fontStack/fontWeight/fontSpec + document.fonts.ready）----
    var fontEpoch = 0
    var fontStack = Text.resolveThemeFontStack(themeRef)
    var fontWeight = Text.resolveThemeFontWeight(themeRef, 700)
    var fontSpec = Text.buildDioramaFontSpec(fontStack, fontWeight)
    if (typeof document !== 'undefined' && document.fonts && document.fonts.ready) {
      // Web 字体加载完成后光栅必须重建（否则保留回退字形）
      document.fonts.ready.then(function () {
        fontEpoch += 1
        fontStackDirty = true
      })
    }
    var fontStackDirty = false

    // ---- 根组与场景雾（原版 JSX 根 <group> + useEffect fog）----
    var group = new THREE.Group()
    var previousFog = scene ? scene.fog : null
    if (scene) {
      scene.fog = new THREE.Fog(resolveColorTargets().bg.getHex(), FOG_NEAR, FOG_FAR)
    }

    // ---- 背景尘埃层（原版 points/bufferAttribute/pointsMaterial）----
    var moteCircumference = Sequencer.resolveDioramaMoteCircumference(params.backgroundParticleCircumference)
    var moteRadial = Sequencer.resolveDioramaMoteRadial(params.backgroundParticleRadial)
    var moteDensity = moteCircumference * moteRadial
    var motePositions = new Float32Array(Sequencer.DIORAMA_MOTE_WINDOW_LINES * moteDensity * 3)
    var moteGeometry = new THREE.BufferGeometry()
    var moteAttr = new THREE.BufferAttribute(motePositions, 3)
    moteGeometry.setAttribute('position', moteAttr)
    var moteMaterial = new THREE.PointsMaterial({
      size: 0.03,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.2,
      depthWrite: false,
      color: new THREE.Color(themeRef.secondaryColor),
      blending: THREE.NormalBlending
    })
    var motePoints = new THREE.Points(moteGeometry, moteMaterial)
    motePoints.frustumCulled = false
    group.add(motePoints)
    // slot -> 当前写入的行下标。空数组 = 所有槽过期待重写
    var moteWritten = []
    var moteSegKey = null   // activeSegKey 变化时清空 written（原版 useEffect）
    var motePointsKey = null

    function rebuildMoteBuffers() {
      moteDensity = moteCircumference * moteRadial
      motePositions = new Float32Array(Sequencer.DIORAMA_MOTE_WINDOW_LINES * moteDensity * 3)
      moteAttr = new THREE.BufferAttribute(motePositions, 3)
      moteGeometry.setAttribute('position', moteAttr)
      moteWritten = []
    }

    // ---- 粒子场（原版 <DioramaParticleField/>）----
    var field = FieldFactory.createDioramaParticleField({
      mode: params.geometryVisibility.mode || 'clouds',
      clusters: [],
      corridorSpans: [],
      density: params.particleDensity,
      particleGlowEnabled: params.particleGlowEnabled,
      particleGlowIntensity: params.particleGlowIntensity,
      primaryColor: themeRef.primaryColor,
      accentColor: themeRef.accentColor || themeRef.primaryColor,
      secondaryColor: themeRef.secondaryColor,
      backgroundColor: themeRef.backgroundColor
    })
    group.add(field.group)

    // ---- 邻居行平面（原版 lineMeshRefs/lineMatRefs Maps）----
    var lineMeshes = new Map() // index -> { mesh, mat, raster }

    // ---- 活动行单元群（原版 unitsGroupRef + unit*Refs 数组）----
    var unitsGroup = null
    var unitsKey = null
    var unitBaseMats = []
    var unitGlowMats = []
    var unitGlowMeshes = []
    var unitSoulMats = []
    var unitSoulMeshes = []
    // 逐单元平滑值：lightVals 驱动辉光（快释放），soulVals 驱动鬼影（慢释放）
    var unitLightVals = null
    var unitSoulVals = null
    var prevActiveGlobal = -1
    var lastRasterForUnits = null

    // ---- 邻居行光栅缓存（原版 lineRasterCacheRef + 异步批构建）----
    var lineRasterCache = new Map()
    var lineRasterFont = fontSpec
    var lineRasterEpoch = -1
    var rasterQueue = []   // 待构建 index 队列（对应原版 missing + rAF 批处理）

    // ---- 音频包络（原版 powerEnvRef/trebleEnvRef）----
    var powerEnv = 0
    var trebleEnv = 0

    // ---- 缓存（原版 useMemo 群）----
    var totalCache = { key: null, value: 0 }
    var mountedCache = { key: null, value: null }
    var visibleCache = { key: null, value: null }
    var corridorCache = { key: null, value: null }
    var clustersCache = { key: null, value: null }
    var timelineCache = { line: null, value: null }
    var unitsCache = { line: null, timeline: null, value: null }
    var keywordColorsCache = { line: null, units: null, matchers: null, targets: null, value: null }
    var activeRasterCache = { line: null, units: null, font: null, value: null }
    var lastGeometryInputs = { mode: null, clusters: null, spans: null, density: null }
    var keywordMatchers = Text.prepareDioramaKeywordMatchers(themeRef.wordColors, params.keywordColoringEnabled)

    // ---------- 缓存重算（对应原版渲染体 useMemo） ----------

    function computeTotal(sequencer) {
      var seg = sequencer.segments[sequencer.segments.length - 1] || null
      var linesEpoch = seg ? seg.linesEpoch : 0
      var total = Sequencer.totalGlobalLines(sequencer)
      return { total: total, linesEpoch: linesEpoch, seg: seg }
    }

    function computeMountedIndices(globalIndex, transitionOutgoingIndex, total) {
      var key = globalIndex + '|' + transitionOutgoingIndex + '|' + total
      if (mountedCache.key === key) return mountedCache.value
      var indices = []
      var seen = {}
      var addWindow = function (center, behind, ahead) {
        var start = Math.max(center - behind, 0)
        var end = Math.min(center + ahead, total - 1)
        for (var i = start; i <= end; i += 1) {
          if (!seen[i]) { seen[i] = true; indices.push(i) }
        }
      }
      addWindow(globalIndex, LINES_BEHIND, LINES_AHEAD)
      if (transitionOutgoingIndex != null) addWindow(transitionOutgoingIndex, OUTGOING_LINES_BEHIND, OUTGOING_LINES_AHEAD)
      indices.sort(function (a, b) { return a - b })
      mountedCache.key = key
      mountedCache.value = indices
      return indices
    }

    function computeVisibleLines(sequencer, mountedIndices, linesEpoch, transitionOutgoingIndex, globalIndex, weaveScale) {
      var key = mountedCache.key + '|' + SequencerTotalKey(sequencer) + '|' + linesEpoch + '|' + transitionOutgoingIndex
        + '|' + globalIndex + '|' + weaveScale
      if (visibleCache.key === key && visibleCache.value) return visibleCache.value
      var result = []
      for (var m = 0; m < mountedIndices.length; m += 1) {
        var i = mountedIndices[m]
        var resolved = Sequencer.resolveGlobal(sequencer, i)
        if (!resolved || !resolved.line) continue
        var frame = resolved.frame
        var placement = Core.getDioramaTextPlacement(resolved.localIndex, resolved.segment.seed, weaveScale)
        var position = {
          x: frame.position.x + frame.right.x * placement.offsetR + frame.up.x * placement.offsetU,
          y: frame.position.y + frame.right.y * placement.offsetR + frame.up.y * placement.offsetU,
          z: frame.position.z + frame.right.z * placement.offsetR + frame.up.z * placement.offsetU
        }
        result.push({
          index: i,
          line: resolved.line,
          placement: placement,
          position: position,
          quaternion: frameQuaternion(frame, placement.roll, placement.yaw),
          // 离场簇归属：离场中心更近的行属于离场群（不同段或本段远端都成立）
          isOutgoing: transitionOutgoingIndex != null
            && Math.abs(i - transitionOutgoingIndex) <= Math.abs(i - globalIndex)
        })
      }
      visibleCache.key = key
      visibleCache.value = result
      return result
    }

    // 段引用序列号：seq 内容可能原位改变（原位歌词重建），key 中计入段对象引用
    function SequencerTotalKey(sequencer) {
      var parts = ''
      for (var i = 0; i < sequencer.segments.length; i += 1) {
        parts += sequencer.segments[i].key + '@' + sequencer.segments[i].globalStart + ';' + sequencer.segments[i].span + ';' + sequencer.segments[i].linesEpoch + '|'
      }
      return parts
    }

    function computeCorridorSpans(sequencer, globalIndex, transitionOutgoingIndex, linesEpoch) {
      var geometryMode = params.geometryVisibility.mode || 'clouds'
      var enabled = params.geometryVisibility.enabled
      var key = enabled + '|' + geometryMode + '|' + globalIndex + '|' + transitionOutgoingIndex
        + '|' + linesEpoch + '|' + SequencerTotalKey(sequencer)
      if (corridorCache.key === key && corridorCache.value) return corridorCache.value
      var spans = []
      if (enabled && geometryMode === 'corridor') {
        var live = Sequencer.buildDioramaParticleCorridorWindow(
          sequencer, globalIndex, CORRIDOR_LINES_BEHIND, CORRIDOR_LINES_AHEAD
        )
        if (transitionOutgoingIndex == null) {
          spans = live
        } else {
          spans = Sequencer.buildDioramaParticleCorridorWindow(
            sequencer, transitionOutgoingIndex, CORRIDOR_LINES_BEHIND, CORRIDOR_LINES_AHEAD
          ).concat(live)
        }
      }
      corridorCache.key = key
      corridorCache.value = spans
      return spans
    }

    function computeParticleClusters(sequencer, mountedIndices, linesEpoch) {
      var geometryMode = params.geometryVisibility.mode || 'clouds'
      var key = geometryMode + '|' + mountedCache.key + '|' + motion.weaveScale + '|' + motion.subMode
        + '|' + params.particleScale + '|' + params.geometryVisibility.enabled
        + '|' + (params.geometryVisibility.strands ? 1 : 0) + (params.geometryVisibility.blobs ? 1 : 0)
        + (params.geometryVisibility.ribbons ? 1 : 0) + (params.geometryVisibility.rings ? 1 : 0)
        + '|' + linesEpoch
      if (clustersCache.key === key && clustersCache.value) return clustersCache.value
      var result = []
      if (geometryMode === 'clouds') {
        var mounted = {}
        for (var mi = 0; mi < mountedIndices.length; mi += 1) mounted[mountedIndices[mi]] = true
        var clusterIndices = {}
        for (var n = 0; n < mountedIndices.length; n += 1) {
          for (var back = 0; back <= Core.DIORAMA_CLUSTER_COLLISION_LINE_SPAN; back += 1) {
            var idx = mountedIndices[n] - back
            if (idx >= 0) clusterIndices[idx] = true
          }
        }
        var sorted = Object.keys(clusterIndices).map(Number).sort(function (a, b) { return a - b })
        for (var s = 0; s < sorted.length; s += 1) {
          var i = sorted[s]
          var resolved = Sequencer.resolveGlobal(sequencer, i)
          if (!resolved) continue
          var frame = resolved.frame
          var localIndex = resolved.localIndex
          var segment = resolved.segment
          var placement = Core.getDioramaTextPlacement(localIndex, segment.seed, motion.weaveScale)
          var shot = Core.getDioramaShot(localIndex, segment.lines, segment.seed, motion.subMode)
          var pieces = Core.buildFormation(localIndex, segment.seed, shot, frame, placement, params.particleScale)
          for (var p = 0; p < pieces.length; p += 1) {
            var piece = pieces[p]
            result.push({
              kind: piece.kind,
              position: piece.position,
              scale: piece.scale,
              stretchY: piece.stretchY,
              upright: piece.upright,
              spinSpeed: piece.spinSpeed,
              colorSlot: piece.colorSlot,
              layer: piece.layer,
              key: i + '-' + p,
              sourceLine: i,
              // 稳定粒子种子排除全局下标：循环重放时云图案不变
              particleSeed: (segment.seed || 'seed') + ':' + localIndex + ':' + p + ':' + piece.kind,
              role: 'formation'
            })
          }
          // 前景闸门云刻意省略：其负深度落在歌词轨道相机一侧，是路径穿越与单侧堆积的主因
        }
        result = selectVisibleClusters(result, params.geometryVisibility).filter(function (cluster) {
          return mounted[cluster.sourceLine]
        })
      }
      clustersCache.key = key
      clustersCache.value = result
      return result
    }

    // 原版 dioramaGeometry.ts selectVisibleDioramaClusters（跨行碰撞剔除）
    function selectVisibleClusters(shapes, visibility) {
      if (!visibility.enabled || visibility.mode !== 'clouds') return []
      var isKindVisible = function (kind) {
        if (kind === 'box') return visibility.strands
        if (kind === 'sphere') return visibility.blobs
        if (kind === 'cone') return visibility.ribbons
        return visibility.rings
      }
      var getClusterRadius = function (shape) {
        var familyRadius = shape.kind === 'box'
          ? 0.5
          : shape.kind === 'sphere'
            ? 0.74
            : shape.kind === 'cone'
              ? 0.68
              : 0.9
        return shape.scale * Math.max(familyRadius, shape.stretchY * 0.55) * Core.DIORAMA_PARTICLE_AUDIO_SCALE_MAX
      }
      var candidates = shapes.filter(function (shape) { return isKindVisible(shape.kind) })
      return candidates.filter(function (candidate, index) {
        var candidateRadius = getClusterRadius(candidate)
        for (var rivalIndex = index - 1; rivalIndex >= 0; rivalIndex -= 1) {
          var rival = candidates[rivalIndex]
          if (candidate.sourceLine - rival.sourceLine > 2) break // DIORAMA_CLUSTER_COLLISION_LINE_SPAN
          if (rival.sourceLine === candidate.sourceLine) continue
          var clearance = Math.max(1.8, (getClusterRadius(rival) + candidateRadius) * 1.18)
          var d = Math.hypot(
            rival.position.x - candidate.position.x,
            rival.position.y - candidate.position.y,
            rival.position.z - candidate.position.z
          )
          if (d < clearance) return false
        }
        return true
      })
    }

    // 活动行字形时间轴（原版 useMemo [activeLine]）
    function computeTimeline(activeLine) {
      if (timelineCache.line !== activeLine) {
        timelineCache.line = activeLine
        timelineCache.value = activeLine ? GraphemeTiming.buildLineGraphemeTimeline(activeLine) : []
      }
      return timelineCache.value
    }

    // 活动行拆分为逐单元渲染的单元（原版 useMemo [activeLine, activeLineTimeline]）
    function computeActiveLineUnits(activeLine, activeLineTimeline) {
      if (unitsCache.line === activeLine && unitsCache.timeline === activeLineTimeline && unitsCache.value) {
        return unitsCache.value
      }
      var units = []
      if (activeLine && activeLineTimeline.length > 0) {
        var graphemes = GraphemeTiming.splitLyricGraphemes(activeLine.fullText)
        // 每个字形的前缀码元偏移：字形下标 -> 字符串下标
        var charOffsets = []
        var acc = 0
        for (var g = 0; g < graphemes.length; g += 1) {
          charOffsets.push(acc)
          acc += graphemes[g].length
        }
        var pushUnit = function (from, to) {
          var text = graphemes.slice(from, to).join('')
          if (text.trim().length === 0) return
          units.push({
            text: text,
            charStart: charOffsets[from] !== undefined ? charOffsets[from] : 0,
            charEnd: (charOffsets[to - 1] !== undefined ? charOffsets[to - 1] : 0) + (graphemes[to - 1] ? graphemes[to - 1].length : 1),
            startTime: activeLineTimeline[from].startTime,
            endTime: activeLineTimeline[to - 1].endTime
          })
        }
        var i = 0
        while (i < activeLineTimeline.length) {
          var glyph = graphemes[i] !== undefined ? graphemes[i] : ''
          if (glyph.trim().length === 0) { i += 1; continue }
          if (CJK_GRAPHEME_RE.test(glyph)) {
            pushUnit(i, i + 1)
            i += 1
            continue
          }
          // 非 CJK：跨同一词延伸（wordIndex 相同），到空白或 CJK 停止
          var wordIndex = activeLineTimeline[i].wordIndex
          var j = i + 1
          while (
            j < activeLineTimeline.length
            && activeLineTimeline[j].wordIndex === wordIndex
            && (graphemes[j] !== undefined ? graphemes[j] : '').trim().length > 0
            && !CJK_GRAPHEME_RE.test(graphemes[j] !== undefined ? graphemes[j] : '')
          ) {
            j += 1
          }
          pushUnit(i, j)
          i = j
        }
      }
      unitsCache.line = activeLine
      unitsCache.timeline = activeLineTimeline
      unitsCache.value = units
      return units
    }

    // 关键字逐单元颜色（原版 useMemo [activeLine, activeLineUnits, keywordMatchers, colorTargets]）
    function computeKeywordUnitColors(activeLine, activeLineUnits) {
      var targets = resolveColorTargets()
      if (keywordColorsCache.line === activeLine && keywordColorsCache.units === activeLineUnits
        && keywordColorsCache.matchers === keywordMatchers && keywordColorsCache.targets === targets
        && keywordColorsCache.value) {
        return keywordColorsCache.value
      }
      var value = Text.resolveDioramaKeywordUnitColors(
        activeLine ? activeLine.fullText : '',
        activeLineUnits,
        keywordMatchers,
        targets.primary,
        targets.accent,
        targets.bg
      )
      keywordColorsCache.line = activeLine
      keywordColorsCache.units = activeLineUnits
      keywordColorsCache.matchers = keywordMatchers
      keywordColorsCache.targets = targets
      keywordColorsCache.value = value
      return value
    }

    // 活动行单元光栅 + 布局（原版 useMemo [activeLine, activeLineUnits, fontSpec]）
    function computeActiveUnitsRaster(activeLine, activeLineUnits) {
      if (activeRasterCache.line === activeLine && activeRasterCache.units === activeLineUnits
        && activeRasterCache.font === fontSpec && activeRasterCache.value !== null) {
        return activeRasterCache.value
      }
      var value = null
      if (activeLine && activeLine.fullText && activeLineUnits.length > 0) {
        var worldPerPx = LINE_FONT_SIZE / Text.DIORAMA_RASTER_FONT_PX
        var full = activeLine.fullText
        var totalPx = Text.measureDioramaText(full, fontSpec)
        var placedUnits = activeLineUnits.map(function (unit) {
          var prefixPx = Text.measureDioramaText(full.slice(0, unit.charStart), fontSpec)
          var raster = Text.rasterDioramaUnit(full.slice(unit.charStart, unit.charEnd), fontSpec)
          return {
            raster: raster,
            centerX: (-totalPx / 2 + prefixPx + raster.advancePx / 2) * worldPerPx,
            width: raster.canvasWidthPx * worldPerPx,
            height: raster.canvasHeightPx * worldPerPx
          }
        })
        value = { units: placedUnits, lineWidth: totalPx * worldPerPx }
      }
      // 原版 useEffect cleanup：新光栅就位后释放上一组的纹理
      if (activeRasterCache.value && activeRasterCache.value !== value) {
        activeRasterCache.value.units.forEach(function (u) {
          u.raster.baseTexture.dispose()
          u.raster.glowTexture.dispose()
        })
      }
      activeRasterCache.line = activeLine
      activeRasterCache.units = activeLineUnits
      activeRasterCache.font = fontSpec
      activeRasterCache.value = value
      return value
    }

    // ---------- 邻居行光栅缓存管理（原版 useEffect + rAF 批构建 → 逐帧预算） ----------

    function maintainRasterCache(fontSpecNow, linesEpoch, visibleLines, globalIndex) {
      // 字体或歌词世代变化：全部缓存条目已基于过期输入，清空（释放纹理）
      if (lineRasterFont !== fontSpecNow || lineRasterEpoch !== linesEpoch) {
        lineRasterCache.forEach(function (raster) { raster.texture.dispose() })
        lineRasterCache.clear()
        rasterQueue.length = 0
        lineRasterFont = fontSpecNow
        lineRasterEpoch = linesEpoch
      }
      // 期望集合：挂载窗口内有 fullText 且非活动行的下标
      var wanted = {}
      rasterQueue.length = 0
      for (var v = 0; v < visibleLines.length; v += 1) {
        var entry = visibleLines[v]
        if (entry.line && entry.line.fullText && entry.index !== globalIndex) {
          wanted[entry.index] = true
          if (!lineRasterCache.has(entry.index)) rasterQueue.push(entry.index)
        }
      }
      // 修剪不再需要的条目（释放纹理）
      var changed = false
      var stale = []
      lineRasterCache.forEach(function (raster, index) {
        if (!wanted[index]) stale.push(index)
      })
      stale.forEach(function (index) {
        lineRasterCache.get(index).texture.dispose()
        lineRasterCache.delete(index)
        changed = true
      })
      return changed
    }

    // 每帧最多构建 NEIGHBOR_RASTER_BUDGET 张（原版 rAF 批构建的等价节奏）
    function processRasterQueue(visibleLines) {
      var built = 0
      while (built < NEIGHBOR_RASTER_BUDGET && rasterQueue.length > 0) {
        var index = rasterQueue.shift()
        if (lineRasterCache.has(index)) continue
        var entry = null
        for (var v = 0; v < visibleLines.length; v += 1) {
          if (visibleLines[v].index === index) { entry = visibleLines[v]; break }
        }
        if (entry && entry.line && entry.line.fullText) {
          lineRasterCache.set(index, Text.rasterDioramaLine(entry.line.fullText, fontStack, fontWeight))
          built += 1
        }
      }
    }

    // ---------- 邻居行平面对象同步（对应 React 渲染树 diff） ----------

    function syncNeighborMeshes(visibleLines, globalIndex, transitionOutgoingIndex) {
      var needed = {}
      if (params.showLyrics) {
        for (var v = 0; v < visibleLines.length; v += 1) {
          var entry = visibleLines[v]
          var index = entry.index
          if (!entry.line || !entry.line.fullText) continue
          if (index === globalIndex) continue
          var offset = index - globalIndex
          var initialOpacity = entry.isOutgoing
            ? resolveOutgoingLineOpacity(index - (transitionOutgoingIndex !== null && transitionOutgoingIndex !== undefined ? transitionOutgoingIndex : index))
            : resolveNeighborLineOpacity(offset)
          if (initialOpacity <= 0) continue
          var raster = lineRasterCache.get(index)
          if (!raster) continue
          needed[index] = { entry: entry, raster: raster }
          var existing = lineMeshes.get(index)
          if (existing && existing.raster === raster) {
            // 原版每次渲染重写 position/quaternion（值可能随 visibleLines 重算变化）
            existing.mesh.position.set(entry.position.x, entry.position.y, entry.position.z)
            existing.mesh.quaternion.copy(entry.quaternion)
            continue
          }
          if (existing) disposeNeighborMesh(index)
          var worldPerPx = LINE_FONT_SIZE / raster.fontPx
          var geom = new THREE.PlaneGeometry(raster.canvasWidthPx * worldPerPx, raster.canvasHeightPx * worldPerPx)
          var color = entry.isOutgoing || offset < 0 ? themeRef.primaryColor : themeRef.secondaryColor
          var mat = new THREE.MeshBasicMaterial({
            map: raster.texture,
            transparent: true,
            opacity: initialOpacity,
            depthWrite: false,
            color: new THREE.Color(color)
          })
          var mesh = new THREE.Mesh(geom, mat)
          mesh.position.set(entry.position.x, entry.position.y, entry.position.z)
          mesh.quaternion.copy(entry.quaternion)
          mesh.renderOrder = 0
          group.add(mesh)
          lineMeshes.set(index, { mesh: mesh, mat: mat, raster: raster })
        }
      }
      // 移除不再需要的平面（showLyrics=false 时全部移除）
      var removeKeys = []
      lineMeshes.forEach(function (record, index) {
        if (!needed[index]) removeKeys.push(index)
      })
      removeKeys.forEach(function (index) { disposeNeighborMesh(index) })
    }

    function disposeNeighborMesh(index) {
      var record = lineMeshes.get(index)
      if (!record) return
      group.remove(record.mesh)
      record.mesh.geometry.dispose()
      record.mat.dispose()
      lineMeshes.delete(index)
    }

    // ---------- 活动行单元群（原版 <group key={globalIndex}> 的 remount 语义） ----------

    function disposeUnitsGroup() {
      if (!unitsGroup) return
      for (var i = 0; i < unitsGroup.children.length; i += 1) {
        var mesh = unitsGroup.children[i]
        if (mesh.geometry) mesh.geometry.dispose()
        if (mesh.material) mesh.material.dispose()
      }
      group.remove(unitsGroup)
      unitsGroup = null
      unitsKey = null
      unitBaseMats = []
      unitGlowMats = []
      unitGlowMeshes = []
      unitSoulMats = []
      unitSoulMeshes = []
    }

    function buildUnitsGroup(globalIndex, activeEntry, activeUnitsRaster) {
      disposeUnitsGroup()
      var g = new THREE.Group()
      g.position.set(activeEntry.position.x, activeEntry.position.y, activeEntry.position.z)
      g.quaternion.copy(activeEntry.quaternion)
      for (var i = 0; i < activeUnitsRaster.units.length; i += 1) {
        var placed = activeUnitsRaster.units[i]
        // 辉光平面（加性，心象辉光光栅）
        var glowGeom = new THREE.PlaneGeometry(placed.width, placed.height)
        var glowMat = new THREE.MeshBasicMaterial({
          map: placed.raster.glowTexture,
          transparent: true,
          opacity: 0,
          depthTest: false,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          color: new THREE.Color(themeRef.accentColor || themeRef.primaryColor)
        })
        var glowMesh = new THREE.Mesh(glowGeom, glowMat)
        glowMesh.visible = false
        glowMesh.position.set(placed.centerX, 0, -0.01)
        glowMesh.renderOrder = 17
        g.add(glowMesh)
        // 灵魂出窍鬼影：清晰的基底光栅加性绘制，随包络释放抬升/膨胀/淡出
        var soulGeom = new THREE.PlaneGeometry(placed.width, placed.height)
        var soulMat = new THREE.MeshBasicMaterial({
          map: placed.raster.baseTexture,
          transparent: true,
          opacity: 0,
          depthTest: false,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          color: new THREE.Color(themeRef.accentColor || themeRef.primaryColor)
        })
        var soulMesh = new THREE.Mesh(soulGeom, soulMat)
        soulMesh.visible = false
        soulMesh.position.set(placed.centerX, 0, -0.005)
        soulMesh.renderOrder = 18
        g.add(soulMesh)
        // 基底字形
        var baseGeom = new THREE.PlaneGeometry(placed.width, placed.height)
        var baseMat = new THREE.MeshBasicMaterial({
          map: placed.raster.baseTexture,
          transparent: true,
          opacity: UNSUNG_UNIT_OPACITY,
          depthTest: false,
          depthWrite: false,
          color: new THREE.Color(themeRef.primaryColor)
        })
        var baseMesh = new THREE.Mesh(baseGeom, baseMat)
        baseMesh.position.set(placed.centerX, 0, 0)
        baseMesh.renderOrder = 19
        g.add(baseMesh)

        unitGlowMeshes[i] = glowMesh
        unitGlowMats[i] = glowMat
        unitSoulMeshes[i] = soulMesh
        unitSoulMats[i] = soulMat
        unitBaseMats[i] = baseMat
      }
      group.add(g)
      unitsGroup = g
      unitsKey = globalIndex + ':' + fontSpec
      lastRasterForUnits = activeUnitsRaster
    }

    // ---------- 对外接口 ----------

    /** 主题变化：色目标/关键字匹配器失效 + 粒子场目标色更新。 */
    function setTheme(theme) {
      var prev = themeRef
      themeRef = theme
      if (prev.primaryColor !== theme.primaryColor || prev.accentColor !== theme.accentColor
        || prev.secondaryColor !== theme.secondaryColor || prev.backgroundColor !== theme.backgroundColor) {
        colorTargetsKey = null
        resolveColorTargets()
        field.setColors(theme.primaryColor, theme.accentColor || theme.primaryColor,
          theme.secondaryColor, theme.backgroundColor, params.particleGlowEnabled, params.particleGlowIntensity)
        moteMaterial.color.set(theme.secondaryColor)
      }
      if (prev.wordColors !== theme.wordColors) keywordMatchers = Text.prepareDioramaKeywordMatchers(theme.wordColors, params.keywordColoringEnabled)
      // fontStyle 变化（插件主题无 fontFamily）→ 字体栈重解析
      fontStack = Text.resolveThemeFontStack(theme)
      fontWeight = Text.resolveThemeFontWeight(theme, 700)
      fontSpec = Text.buildDioramaFontSpec(fontStack, fontWeight)
    }

    /** tuning 参数更新（本插件恒为默认值，保留代码路径以对齐原版 props）。 */
    function setParams(next) {
      var needMoteRebuild = false
      if (next.backgroundParticleCircumference !== undefined) {
        var c = Sequencer.resolveDioramaMoteCircumference(next.backgroundParticleCircumference)
        if (c !== moteCircumference) { moteCircumference = c; needMoteRebuild = true }
      }
      if (next.backgroundParticleRadial !== undefined) {
        var r = Sequencer.resolveDioramaMoteRadial(next.backgroundParticleRadial)
        if (r !== moteRadial) { moteRadial = r; needMoteRebuild = true }
      }
      var keys = ['showLyrics', 'showParticles', 'geometryVisibility', 'particleDensity', 'particleScale',
        'particleGlowEnabled', 'particleGlowIntensity', 'lyricsFontScale', 'glowIntensity',
        'soulIntensity', 'soulActiveEnabled', 'gradientIntensity', 'keywordColoringEnabled']
      var fieldColorsChanged = false
      keys.forEach(function (k) {
        if (next[k] === undefined) return
        if (params[k] !== next[k]) {
          params[k] = next[k]
          if (k === 'particleGlowEnabled' || k === 'particleGlowIntensity') fieldColorsChanged = true
          if (k === 'keywordColoringEnabled') {
            keywordMatchers = Text.prepareDioramaKeywordMatchers(themeRef.wordColors, params.keywordColoringEnabled)
          }
        }
      })
      if (needMoteRebuild) rebuildMoteBuffers()
      if (fieldColorsChanged) {
        field.setColors(themeRef.primaryColor, themeRef.accentColor || themeRef.primaryColor,
          themeRef.secondaryColor, themeRef.backgroundColor, params.particleGlowEnabled, params.particleGlowIntensity)
      }
    }

    function setMotion(nextMotion) {
      motion = nextMotion
    }

    /**
     * 每帧更新（原版渲染体 + useFrame 合并）。
     * ctx: { delta, now, clockElapsedTime, camera, sequencer, globalIndex,
     *        transitionOutgoingIndex, audioPower, audioBands, renderer, activeLineWidth(写出) }
     */
    function update(ctx) {
      var delta = ctx.delta
      var camera = ctx.camera
      var sequencer = ctx.sequencer
      var globalIndex = ctx.globalIndex
      var transitionOutgoingIndex = ctx.transitionOutgoingIndex

      // ---- 缓存重算（渲染体） ----
      var totals = computeTotal(sequencer)
      var total = totals.total
      var linesEpoch = totals.linesEpoch
      var activeSeg = totals.seg
      var mountedIndices = computeMountedIndices(globalIndex, transitionOutgoingIndex, total)
      var visibleLines = computeVisibleLines(sequencer, mountedIndices, linesEpoch, transitionOutgoingIndex, globalIndex, motion.weaveScale)
      var corridorSpans = computeCorridorSpans(sequencer, globalIndex, transitionOutgoingIndex, linesEpoch)
      var particleClusters = computeParticleClusters(sequencer, mountedIndices, linesEpoch)

      // 字体重载信号（document.fonts.ready）→ 字体规格重解析
      if (fontStackDirty) {
        fontStackDirty = false
        fontStack = Text.resolveThemeFontStack(themeRef)
        fontSpec = Text.buildDioramaFontSpec(fontStack, fontWeight)
      }

      var activeResolved = Sequencer.resolveGlobal(sequencer, globalIndex)
      var activeLine = activeResolved ? activeResolved.line : null
      var activeEntry = null
      for (var v = 0; v < visibleLines.length; v += 1) {
        if (visibleLines[v].index === globalIndex) { activeEntry = visibleLines[v]; break }
      }
      var activeLineTimeline = computeTimeline(activeLine)
      var activeLineUnits = computeActiveLineUnits(activeLine, activeLineTimeline)
      var keywordUnitColors = computeKeywordUnitColors(activeLine, activeLineUnits)
      var activeUnitsRaster = computeActiveUnitsRaster(activeLine, activeLineUnits)

      // 邻居行光栅缓存维护 + 预算批构建
      maintainRasterCache(fontSpec, linesEpoch, visibleLines, globalIndex)
      processRasterQueue(visibleLines)

      // 被离开的行此前按单元绘制（从不建整行光栅）。转场把它降级为后退平面的瞬间
      // 必须立即有光栅——同步构建这一行，单元群到平面的切换无缝。
      if (transitionOutgoingIndex != null && !lineRasterCache.has(transitionOutgoingIndex)) {
        var leaving = null
        for (var lv = 0; lv < visibleLines.length; lv += 1) {
          if (visibleLines[lv].index === transitionOutgoingIndex) { leaving = visibleLines[lv]; break }
        }
        if (leaving && leaving.line && leaving.line.fullText) {
          lineRasterCache.set(transitionOutgoingIndex, Text.rasterDioramaLine(leaving.line.fullText, fontStack, fontWeight))
        }
      }

      // ---- 粒子场输入（原版 JSX props + useMemo）----
      var geometryMode = params.geometryVisibility.mode || 'clouds'
      var fieldVisible = geometryMode === 'corridor' ? corridorSpans.length > 0 : particleClusters.length > 0
      field.group.visible = fieldVisible
      if (fieldVisible) {
        var newMode = geometryMode
        var newClusters = geometryMode === 'clouds' ? particleClusters : EMPTY_CLUSTERS
        var newSpans = geometryMode === 'corridor' ? corridorSpans : EMPTY_SPANS
        if (lastGeometryInputs.mode !== newMode || lastGeometryInputs.clusters !== newClusters
          || lastGeometryInputs.spans !== newSpans || lastGeometryInputs.density !== params.particleDensity) {
          lastGeometryInputs.mode = newMode
          lastGeometryInputs.clusters = newClusters
          lastGeometryInputs.spans = newSpans
          lastGeometryInputs.density = params.particleDensity
          field.setGeometry(newMode, newClusters, newSpans, params.particleDensity)
        }
      }

      // ---- 粒子场每帧更新（原版 DioramaParticleField 的 useFrame）----
      field.update({
        delta: delta,
        currentTime: ctx.now,
        audioBands: ctx.audioBands,
        audioLevel: motion.audioLevel,
        transitionActive: transitionOutgoingIndex != null,
        readHeadLine: globalIndex,
        renderer: ctx.renderer
      })

      // ---- 尘埃 buffer 重置条件（原版 useEffect [moteCircumference, moteRadial, activeSegKey]）----
      var activeSegKey = activeSeg ? activeSeg.key : 'x'
      if (moteSegKey !== activeSegKey) {
        moteSegKey = activeSegKey
        moteWritten = []
      }

      // ---- 阻尼主题色 ----
      var targets = resolveColorTargets()
      if (!dampedColors) {
        dampedColors = {
          primary: targets.primary.clone(),
          accent: targets.accent.clone(),
          secondary: targets.secondary.clone(),
          bg: targets.bg.clone()
        }
      }
      var colorK = 1 - Math.exp(-COLOR_DAMP_RATE * delta)
      dampedColors.primary.lerp(targets.primary, colorK)
      dampedColors.accent.lerp(targets.accent, colorK)
      dampedColors.secondary.lerp(targets.secondary, colorK)
      dampedColors.bg.lerp(targets.bg, colorK)
      if (scene && scene.fog) scene.fog.color.copy(dampedColors.bg)

      // ---- 音频包络（原版 0..255 频段；frameState 已是 0..1，直接取用）----
      var audioK = motion.audioLevel
      var bands01 = ctx.audioBands || { treble: 0 }
      var treble01 = Math.min(1, bands01.treble) * audioK
      var power01 = Math.min(1, ctx.audioPower) * audioK
      trebleEnv = stepEnvelope(trebleEnv, treble01, 14, 3.2, delta)
      powerEnv = stepEnvelope(powerEnv, power01, 18, 3.5, delta)
      var camPos = camera.position

      // ---- 尘埃窗口回收 ----
      if (params.showParticles) {
        var written = moteWritten
        var lastLine = Math.max(0, total - 1)
        var dirty = false
        for (var line = globalIndex - Sequencer.DIORAMA_MOTE_LINES_BEHIND; line <= globalIndex + Sequencer.DIORAMA_MOTE_LINES_AHEAD; line += 1) {
          var slot = Sequencer.dioramaMoteSlot(line)
          if (written[slot] === line) continue
          var anchorLine = Math.min(Math.max(line, 0), lastLine)
          var resolved = Sequencer.resolveGlobal(sequencer, anchorLine)
          if (!resolved) continue
          Sequencer.writeDioramaMoteLine(
            motePositions,
            Sequencer.extendDioramaFrame(resolved.frame, line - anchorLine),
            line,
            moteCircumference,
            moteRadial,
            activeSeg ? activeSeg.seed : undefined
          )
          written[slot] = line
          dirty = true
        }
        if (dirty) moteAttr.needsUpdate = true
      }

      // ---- 背景尘埃漂移 + 材质（原版 pointsRef/pointsMatRef）----
      var t = ctx.clockElapsedTime
      motePoints.position.set(Math.sin(t * 0.17) * 0.12, Math.sin(t * 0.11 + 1.7) * 0.09, Math.cos(t * 0.13) * 0.12)
      moteMaterial.size = 0.03 * (1 + 0.42 * trebleEnv)
      moteMaterial.opacity = 0.16 + 0.18 * powerEnv
      moteMaterial.color.copy(dampedColors.secondary).lerp(dampedColors.accent, 0.3)
      motePoints.visible = params.showParticles

      // ---- 邻居行适配 + 逐帧颜色（原版 visibleLines.forEach）----
      var aspect = camera.isPerspectiveCamera ? camera.aspect : 1
      var fov = camera.isPerspectiveCamera ? camera.fov : 55
      syncNeighborMeshes(visibleLines, globalIndex, transitionOutgoingIndex)
      for (var fi = 0; fi < visibleLines.length; fi += 1) {
        var entry = visibleLines[fi]
        var idx = entry.index
        if (idx === globalIndex) continue
        var record = lineMeshes.get(idx)
        if (!record) continue
        var raster = record.raster
        var worldWidth = raster.advancePx * (LINE_FONT_SIZE / raster.fontPx)
        var fit = resolveFrameFitScale(worldWidth, Core.DIORAMA_HERO_DISTANCE, fov, aspect) * entry.placement.scale * params.lyricsFontScale
        record.mesh.scale.setScalar(fit)
        var life = resolveTextLife(record.mesh.position.distanceTo(camPos))
        if (entry.isOutgoing) {
          // 离场走廊：相机正在飞离的柔和主色簇；life 随后退淡出，雾修饰退路
          record.mat.opacity = resolveOutgoingLineOpacity(idx - (transitionOutgoingIndex !== null && transitionOutgoingIndex !== undefined ? transitionOutgoingIndex : idx)) * life
          record.mat.color.copy(dampedColors.primary)
        } else {
          var offset = idx - globalIndex
          record.mat.opacity = resolveNeighborLineOpacity(offset) * life
          // 已唱行以主色发光成为亮点轨迹；未来行停在暗的 secondary 色里等待
          record.mat.color.copy(offset < 0 ? dampedColors.primary : dampedColors.secondary)
        }
      }

      // ---- 活动行单元群状态重置（原版 shouldResetDioramaUnitState）----
      if (shouldResetDioramaUnitState(prevActiveGlobal, globalIndex, unitLightVals ? unitLightVals.length : undefined, activeLineUnits.length)) {
        prevActiveGlobal = globalIndex
        unitLightVals = new Float32Array(activeLineUnits.length)
        unitSoulVals = new Float32Array(activeLineUnits.length)
        unitBaseMats.length = activeLineUnits.length
        unitGlowMats.length = activeLineUnits.length
        unitGlowMeshes.length = activeLineUnits.length
        unitSoulMats.length = activeLineUnits.length
        unitSoulMeshes.length = activeLineUnits.length
      }

      // ---- 逐单元揭示 + 三种独立跟唱效果 ----
      var wroteWidth = false
      if (params.showLyrics && activeUnitsRaster && activeEntry && activeLine) {
        // key 变化（新活动行 / 字体变化）或首次构建 → 重建单元群（对应 React remount + map 属性更新）
        var unitKey = globalIndex + ':' + fontSpec
        if (!unitsGroup || unitsKey !== unitKey || lastRasterForUnits !== activeUnitsRaster) {
          buildUnitsGroup(globalIndex, activeEntry, activeUnitsRaster)
        }
        unitsGroup.position.set(activeEntry.position.x, activeEntry.position.y, activeEntry.position.z)
        unitsGroup.quaternion.copy(activeEntry.quaternion)
        var fit = resolveFrameFitScale(activeUnitsRaster.lineWidth, Core.DIORAMA_HERO_DISTANCE, fov, aspect)
          * activeEntry.placement.scale * params.lyricsFontScale
        unitsGroup.scale.setScalar(fit)
        unitsGroup.visible = params.showLyrics
        // 发布活动行的世界宽度，供 CameraRig 调整跟词 truck
        ctx.activeLineWidth = activeUnitsRaster.lineWidth * fit
        wroteWidth = true
        var lifeA = resolveTextLife(unitsGroup.position.distanceTo(camPos))
        var now = ctx.now
        var breath = 0.9 + 0.1 * Math.sin(ctx.clockElapsedTime * 1.9)
        var lightVals = unitLightVals
        var soulVals = unitSoulVals

        // 渐变跟唱强度档。刻意没有行级门控：每个单元有自己的尾迹
        var gradientStrength = Math.min(1.5, params.gradientIntensity)
        // 本帧的演唱色调轴。palette 退化（accent ≈ primary）时朝中性灰偏移
        var tintSeparation = Math.abs(dampedColors.accent.r - dampedColors.primary.r)
          + Math.abs(dampedColors.accent.g - dampedColors.primary.g)
          + Math.abs(dampedColors.accent.b - dampedColors.primary.b)
        _sungTint.copy(dampedColors.accent)
        if (tintSeparation < 0.4) {
          var deficit = 1 - tintSeparation / 0.4
          var primaryLum = (dampedColors.primary.r + dampedColors.primary.g + dampedColors.primary.b) / 3
          var accentLum = (dampedColors.accent.r + dampedColors.accent.g + dampedColors.accent.b) / 3
          var targetLum = primaryLum > 0.5 ? accentLum * (1 - 0.5 * deficit) : accentLum + (1 - accentLum) * 0.55 * deficit
          _neutral.setRGB(targetLum, targetLum, targetLum)
          _sungTint.lerp(_neutral, deficit)
        }
        // 渐变的深色锚：演唱色调的更深、保色相（乘法而非 HSL）版本
        var gradHot01 = Math.min(1, Math.max(0, (gradientStrength - 0.1) / 1.4))
        _gradDeep.copy(_sungTint).multiplyScalar(0.8 - 0.18 * gradHot01)

        for (var ui = 0; ui < activeLineUnits.length; ui += 1) {
          var unit = activeLineUnits[ui]
          var baseMat = unitBaseMats[ui]
          if (!baseMat || !lightVals || !soulVals) continue
          var isCurrent = now >= unit.startTime && now < unit.endTime
          var sung = now >= unit.endTime
          var span = Math.max(unit.endTime - unit.startTime, 0.001)
          var sungMix = sung ? 1 : (isCurrent ? clamp01((now - unit.startTime) / span) : 0)

          // 共享演唱态包络：演唱时快涨，唱后衰减
          lightVals[ui] = stepEnvelope(lightVals[ui], isCurrent ? 1 : 0, 14, 4.5, delta)

          // 渐变跟唱能量（独立效果，其他两个关闭时也活着）
          var gradientEnergy = resolveGradientEnergy(now, unit) * gradientStrength

          // 基底揭示（恒开）：未唱偏暗，随演唱扫到全亮。渐变在其上再加小的透明度提升
          baseMat.opacity = Math.min(
            1,
            (UNSUNG_UNIT_OPACITY + (ACTIVE_LINE_OPACITY - UNSUNG_UNIT_OPACITY) * sungMix + 0.08 * Math.min(1, gradientEnergy)) * lifeA
          )

          // ---- 统一演唱色状态：填充色只算一次 ----
          // 关键字着色只改 TARGET：AI 关键字是隐藏色，唱到才浮现
          var unitTarget = keywordUnitColors.get(ui)
            || (params.gradientIntensity > 0 ? _gradDeep : _sungTint)
          // 渐变开启时由它决定染色时序（纯时钟函数）；否则共享基线包络
          var unitProgress = params.gradientIntensity > 0 ? gradientEnergy : lightVals[ui] * 1.15
          resolveDioramaUnitFill(baseMat.color, dampedColors.primary, unitTarget, unitProgress)

          // 普通辉光（只读统一色，绝不改写）：亮度骑共享包络 × 呼吸 × 音乐能量包络
          var glowStrength = Math.min(1.5, params.glowIntensity)
          var glowLevel = lightVals[ui] * lifeA * breath * (0.6 + 0.4 * powerEnv) * glowStrength
          var glowMat = unitGlowMats[ui]
          var glowMesh = unitGlowMeshes[ui]
          if (glowMat) {
            glowMat.opacity = Math.min(1, UNIT_GLOW_MAX_OPACITY * glowLevel)
            glowMat.color.copy(baseMat.color)
          }
          if (glowMesh) {
            glowMesh.visible = glowLevel > 0.012
          }

          // 灵魂出窍（只读统一色作能量色调）：按播放相位分为两个互斥鬼影
          soulVals[ui] = stepEnvelope(soulVals[ui], isCurrent ? 1 : 0, 12, 2.2, delta)
          var soulMat = unitSoulMats[ui]
          var soulMesh = unitSoulMeshes[ui]
          if (soulMat && soulMesh) {
            var soulStrength = Math.min(1.5, params.soulIntensity)       // 灵魂出窍强度：驱动两个阶段
            var flightMix = sung ? smoothstep01(clamp01((now - unit.endTime) / SOUL_HANDOFF_SECONDS)) : 0
            // 当前字漂移 ON => 当前字形以与其他字形相同的强度漂移；OFF => 0
            var activeReach = params.soulActiveEnabled ? soulStrength : 0
            var onGlyph = (1 - flightMix) * activeReach   // 已注册的叠影，仅当前字形
            var flown = flightMix * soulStrength          // 离体飞行，仅已唱完的字形
            soulMat.color.copy(baseMat.color)
            soulMat.opacity = Math.min(1, SOUL_MAX_OPACITY * lifeA * soulVals[ui] * (onGlyph + flown))
            soulMesh.position.y = LINE_FONT_SIZE * (SOUL_ACTIVE_LIFT_EM * onGlyph + SOUL_DETACH_LIFT_EM * flown)
            var soulSwell = 1 + SOUL_ACTIVE_SWELL * onGlyph + SOUL_DETACH_SWELL * flown
            soulMesh.scale.set(soulSwell, soulSwell, 1)
            soulMesh.visible = soulMat.opacity > 0.015
          }
        }
      } else {
        if (unitsGroup) unitsGroup.visible = false
      }
      if (!wroteWidth) ctx.activeLineWidth = 0
    }

    function dispose() {
      // 邻居行：几何 + 材质（纹理由缓存统一释放）
      var removeKeys = []
      lineMeshes.forEach(function (record, index) { removeKeys.push(index) })
      removeKeys.forEach(function (index) { disposeNeighborMesh(index) })
      // 邻居行光栅缓存纹理
      lineRasterCache.forEach(function (raster) { raster.texture.dispose() })
      lineRasterCache.clear()
      // 活动行单元群 + 其纹理
      disposeUnitsGroup()
      if (activeRasterCache.value) {
        activeRasterCache.value.units.forEach(function (u) {
          u.raster.baseTexture.dispose()
          u.raster.glowTexture.dispose()
        })
        activeRasterCache.value = null
      }
      // 尘埃层
      group.remove(motePoints)
      moteGeometry.dispose()
      moteMaterial.dispose()
      // 粒子场
      field.dispose()
      // 雾还原
      if (scene) scene.fog = previousFog
      group.clear()
    }

    return {
      group: group,
      setTheme: setTheme,
      setParams: setParams,
      setMotion: setMotion,
      update: update,
      dispose: dispose
    }
  }

  window.FoliaDioramaScene = {
    createDioramaScene: createDioramaScene
  }
})()
