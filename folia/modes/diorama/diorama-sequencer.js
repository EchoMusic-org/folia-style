// 镜台（diorama）模式·序列器模块：移植自 folia-major src/components/visualizer/diorama/
//   dioramaSequencer.ts（全文：连续隧道走廊段状态机）
//   dioramaMoteField.ts（全文：背景尘埃滑窗环缓冲）
//   dioramaParticleCorridor.ts（全文：隧道逐行 span 构建）
// 全部为纯函数，无 three 依赖。挂载于 window.FoliaDioramaSequencer。
(function () {
  'use strict'

  var Core = window.FoliaDioramaCore
  var buildDioramaPath = Core.buildDioramaPath
  var getFrame = Core.getFrame
  var translateFrames = Core.translateFrames
  var composeLocal = Core.composeLocal
  var extendImpl

  // ═══════════ dioramaSequencer.ts 全文 ═══════════

  function createSequencerState() {
    return { segments: [], nextGlobalStart: 0 }
  }

  /** 活动（最新）段——正在播放的走廊。首次 append 之前为 null。 */
  function activeSegment(state) {
    return state.segments[state.segments.length - 1] || null
  }

  /**
   * 以一首歌/一轮循环为新段追加，放置在 `placementOrigin`（其局部行 0 的世界位置）并激活。
   * 转场控制器传入远离当前走廊的原点偏移；首首歌放世界原点。全局下标至少前进一档，
   * 保证无歌词歌曲也占据真实空间。
   */
  function appendSegment(state, input) {
    var raw = buildDioramaPath(input.lines.length, input.seed)
    var frames = translateFrames(raw, input.placementOrigin)
    var span = Math.max(input.lines.length, 1)
    var segment = {
      key: String(input.seed) + '#' + input.round,
      seed: input.seed,
      round: input.round,
      lines: input.lines,
      frames: frames,
      globalStart: state.nextGlobalStart,
      span: span,
      placementOrigin: input.placementOrigin,
      linesEpoch: 0
    }
    state.segments.push(segment)
    state.nextGlobalStart += span
    return segment
  }

  /**
   * 就地重建活动（最新）段的歌词/帧，保持同一世界原点与 globalStart。
   * 用于歌词晚于走廊生成到达（在线歌词异步加载）——走廊身份与位置不变，
   * 没有第二段走廊、没有相机吸附，只有几何追上。活动段是最后一段，
   * nextGlobalStart 即其 globalStart + span，按 span 差调整。
   */
  function updateActiveSegmentLines(state, lines) {
    var seg = state.segments[state.segments.length - 1]
    if (!seg) return
    var raw = buildDioramaPath(lines.length, seg.seed)
    var span = Math.max(lines.length, 1)
    state.nextGlobalStart += span - seg.span
    seg.lines = lines
    seg.frames = translateFrames(raw, seg.placementOrigin)
    seg.span = span
    seg.linesEpoch += 1
  }

  /** 全局下标空间的排他上界（最后一个有效行之后）。 */
  function totalGlobalLines(state) {
    return state.nextGlobalStart
  }

  /** 把全局下标解析到段/局部行/世界帧/歌词，超出保留段时为 null。 */
  function resolveGlobal(state, globalIndex) {
    for (var i = 0; i < state.segments.length; i += 1) {
      var segment = state.segments[i]
      var localIndex = globalIndex - segment.globalStart
      if (localIndex >= 0 && localIndex < segment.span) {
        return {
          segment: segment,
          localIndex: localIndex,
          frame: getFrame(segment.frames, localIndex),
          line: segment.lines[localIndex] || null
        }
      }
    }
    return null
  }

  /**
   * 丢弃完全落在 `keepFromGlobal`（挂载窗口后缘）之后的段——相机早已飞过、
   * 行早已卸载。活动段必然跨当前下标，永不被剪。跨无限会话保持内存有界。
   */
  function pruneSegments(state, keepFromGlobal) {
    if (state.segments.length <= 1) return
    state.segments = state.segments.filter(function (segment) {
      return segment.globalStart + segment.span - 1 >= keepFromGlobal
    })
  }

  // ═══════════ dioramaMoteField.ts 全文 ═══════════

  /** 读头后方/前方保留尘埃的行数。 */
  var DIORAMA_MOTE_LINES_BEHIND = 2
  var DIORAMA_MOTE_LINES_AHEAD = 5
  var DIORAMA_MOTE_WINDOW_LINES = DIORAMA_MOTE_LINES_BEHIND + DIORAMA_MOTE_LINES_AHEAD + 1

  /** 该层能画的最坏情况点数——密度上限存在的全部理由。 */
  var DIORAMA_MOTE_MAX_POINTS = DIORAMA_MOTE_WINDOW_LINES
    * Core.DIORAMA_MOTE_CIRCUMFERENCE_MAX * Core.DIORAMA_MOTE_RADIAL_MAX

  /** 把请求的圆周数量（每圈尘埃数）钳入安全范围。 */
  function resolveDioramaMoteCircumference(requested) {
    return Math.round(Math.min(
      Core.DIORAMA_MOTE_CIRCUMFERENCE_MAX,
      Math.max(
        Core.DIORAMA_MOTE_CIRCUMFERENCE_MIN,
        Number.isFinite(requested) ? requested : Core.DEFAULT_DIORAMA_TUNING.backgroundParticleCircumference
      )
    ))
  }

  /** 把请求的径向数量（壳厚层数）钳入安全范围。 */
  function resolveDioramaMoteRadial(requested) {
    return Math.round(Math.min(
      Core.DIORAMA_MOTE_RADIAL_MAX,
      Math.max(
        Core.DIORAMA_MOTE_RADIAL_MIN,
        Number.isFinite(requested) ? requested : Core.DEFAULT_DIORAMA_TUNING.backgroundParticleRadial
      )
    ))
  }

  /** 每行尘埃数 = 圆周 × 径向（均已钳制）。 */
  function resolveDioramaMoteCount(circumference, radial) {
    return resolveDioramaMoteCircumference(circumference) * resolveDioramaMoteRadial(radial)
  }

  /** 一行拥有的环缓冲槽位。相邻行永远落进不同槽。 */
  function dioramaMoteSlot(line) {
    return ((line % DIORAMA_MOTE_WINDOW_LINES) + DIORAMA_MOTE_WINDOW_LINES) % DIORAMA_MOTE_WINDOW_LINES
  }

  // 尘埃分布在路径轴周围的椭球壳里。内净空让它离开歌词与相机轨道；
  // 外半径留在走廊 7.4 壁之内，corridor 模式下尘埃读作隧道内的空气。
  var MOTE_INNER_RADIUS = 2.4
  var MOTE_RADIAL_SPAN = 5.2
  var MOTE_VERTICAL_SQUASH = 0.64

  /**
   * 激进逆函数（van der Corput）——分层但与下标的线性顺序不相关的低差异序列。
   * 深度需要它：半径已随 p 递增，深度若也取自 p 会把每行尘埃耙成可见螺旋而非云。
   */
  function radicalInverse(index, base) {
    var result = 0
    var fraction = 1 / base
    var i = index
    while (i > 0) {
      result += (i % base) * fraction
      i = Math.floor(i / base)
      fraction /= base
    }
    return result
  }

  /**
   * 路径帧的直行程序化延伸，向后 `steps` 行。帧只存在于有歌词处；
   * 该函数把同样的航向延续下去，让场（或隧道）能越过最后一行继续而不是断头。
   */
  extendImpl = function extendDioramaFrame(frame, steps) {
    if (steps === 0) return frame
    return {
      position: {
        x: frame.position.x + frame.forward.x * Core.DIORAMA_STEP_DISTANCE * steps,
        y: frame.position.y + frame.forward.y * Core.DIORAMA_STEP_DISTANCE * steps,
        z: frame.position.z + frame.forward.z * Core.DIORAMA_STEP_DISTANCE * steps
      },
      forward: frame.forward,
      right: frame.right,
      up: frame.up
    }
  }

  /**
   * 把一行的尘埃写进该行的环缓冲槽。按 (seed, line) 确定——同一行总是再生同样的尘埃，
   * 循环或重回窗口都不会重洗。布点是叶序圆盘与 Hammersley 深度的交叉：
   * 黄金角散开圆周并让相邻行互不同相，sqrt 分层半径让壳面积均匀，激进逆散开深度。
   */
  function writeDioramaMoteLine(out, frame, line, circumference, radial, seed) {
    var base = Core.hashSeed(seed)
    var goldenAngle = Math.PI * (3 - Math.sqrt(5))
    var twoPi = Math.PI * 2
    var phase = Core.seededUnit(base + 991) * twoPi
    var total = circumference * radial
    var write = dioramaMoteSlot(line) * total * 3
    // 两条独立轴：radial 层横跨壳厚，circumference 均布每圈。
    // 每行/每层各旋转黄金角（相邻行与堆叠层不对齐成辐条），角度/半径再加种子半格抖动。
    for (var ri = 0; ri < radial; ri += 1) {
      for (var ci = 0; ci < circumference; ci += 1) {
        var p = ri * circumference + ci
        var s = base + line * 131 + p * 17
        var stratum = (ri + 0.35 + Core.seededUnit(s + 4) * 0.3) / radial
        var radius = MOTE_INNER_RADIUS + Math.sqrt(stratum) * MOTE_RADIAL_SPAN
        var angle = phase + (line + ri) * goldenAngle
          + (ci / circumference) * twoPi
          + (Core.seededUnit(s + 3) - 0.5) * (twoPi / circumference)
        var depth = (radicalInverse(p + 1, 2) + (Core.seededUnit(s + 2) - 0.5) / total - 0.5)
          * Core.DIORAMA_STEP_DISTANCE
        var point = composeLocal(
          frame,
          Math.cos(angle) * radius,
          Math.sin(angle) * radius * MOTE_VERTICAL_SQUASH,
          depth
        )
        out[write] = point.x
        out[write + 1] = point.y
        out[write + 2] = point.z
        write += 3
      }
    }
  }

  // ═══════════ dioramaParticleCorridor.ts 全文 ═══════════

  /** 常开点隧道的单行局部 span。固定圆柱沿飞行路径穿行，永不漂移或变形。 */
  var DIORAMA_PARTICLE_CORRIDOR_RADIUS = 7.4

  /** 构建单行局部隧道 span；绝不跨过歌段转场缝。 */
  function buildDioramaParticleCorridorSpan(frame, nextFrame, pathStart, enabled) {
    var start = { x: frame.position.x, y: frame.position.y, z: frame.position.z }
    var end = nextFrame != null
      ? { x: nextFrame.position.x, y: nextFrame.position.y, z: nextFrame.position.z }
      : {
        x: start.x + frame.forward.x * Core.DIORAMA_STEP_DISTANCE,
        y: start.y + frame.forward.y * Core.DIORAMA_STEP_DISTANCE,
        z: start.z + frame.forward.z * Core.DIORAMA_STEP_DISTANCE
      }
    return {
      start: start,
      end: end,
      startRight: frame.right,
      endRight: nextFrame ? nextFrame.right : frame.right,
      startUp: frame.up,
      endUp: nextFrame ? nextFrame.up : frame.up,
      pathStart: pathStart,
      enabled: enabled
    }
  }

  /**
   * 围绕 `center` 的一段连续隧道，在该行自己的段内构建并向段端外程序化延伸。
   * 窗口不钳制到歌词范围：越出歌词处路径按航向直行，环保持同样的半径/间距/
   * 波相位/振幅——延伸就是同一根圆柱，只是没有词。下标对窗口自己的段解析：
   * 切歌时读头已跳到新段，各自自延，两者在雾中重叠而互不伸入。
   */
  function buildDioramaParticleCorridorWindow(sequencer, center, behind, ahead) {
    var anchor = resolveGlobal(sequencer, center)
    if (!anchor) return []
    var segment = anchor.segment
    var first = segment.globalStart
    var last = segment.globalStart + segment.span - 1
    var frameAt = function (index) {
      var clamped = Math.min(Math.max(index, first), last)
      return extendImpl(getFrame(segment.frames, clamped - first), index - clamped)
    }
    var spans = []
    for (var i = center - behind; i <= center + ahead; i += 1) {
      // frameAt(i + 1)：同样的直行延伸，每个 span 的终点精确等于下一个 span 的起点，环无缝。
      spans.push(buildDioramaParticleCorridorSpan(frameAt(i), frameAt(i + 1), i, true))
    }
    return spans
  }

  window.FoliaDioramaSequencer = {
    // sequencer
    createSequencerState: createSequencerState,
    activeSegment: activeSegment,
    appendSegment: appendSegment,
    updateActiveSegmentLines: updateActiveSegmentLines,
    totalGlobalLines: totalGlobalLines,
    resolveGlobal: resolveGlobal,
    pruneSegments: pruneSegments,
    // mote field
    DIORAMA_MOTE_LINES_BEHIND: DIORAMA_MOTE_LINES_BEHIND,
    DIORAMA_MOTE_LINES_AHEAD: DIORAMA_MOTE_LINES_AHEAD,
    DIORAMA_MOTE_WINDOW_LINES: DIORAMA_MOTE_WINDOW_LINES,
    DIORAMA_MOTE_MAX_POINTS: DIORAMA_MOTE_MAX_POINTS,
    resolveDioramaMoteCircumference: resolveDioramaMoteCircumference,
    resolveDioramaMoteRadial: resolveDioramaMoteRadial,
    resolveDioramaMoteCount: resolveDioramaMoteCount,
    dioramaMoteSlot: dioramaMoteSlot,
    extendDioramaFrame: extendImpl,
    writeDioramaMoteLine: writeDioramaMoteLine,
    // corridor
    DIORAMA_PARTICLE_CORRIDOR_RADIUS: DIORAMA_PARTICLE_CORRIDOR_RADIUS,
    buildDioramaParticleCorridorSpan: buildDioramaParticleCorridorSpan,
    buildDioramaParticleCorridorWindow: buildDioramaParticleCorridorWindow
  }
})()
