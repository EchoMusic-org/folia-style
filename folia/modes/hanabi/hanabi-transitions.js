// 花火（hanabi）段落转场与场景帧：移植自 folia-major hanabiTransitions.ts + hanabiSceneFrames.ts
//
// 花火的段落转场（取自 lumisynth 花火包的 transitions）：上升 ascend、闪白 flash、开花 bloom。
// lumisynth 里这一帧由内核套在单元容器上，folia 没有内核，由运行时按同样的规则套（hanabiSceneFrames.ts）：
//   - 出场：transitionOut 窗口里对旧段落的容器套 resolveFrame('exit', 进度)；
//   - 进场：边界之后 enterDuration 秒里对新段落的容器套 resolveFrame('enter', 进度)，同时与还在出场的旧段落交叉渐变
//     （旧段落的出场进度接着走过 1：上升按边界上的速度继续滑走、转走，闪白 / 开花停在终点帧）。
// 上升是这个模式的招牌：摄影机继续往上走，旧画面向下滑走并模糊，新画面从上方落进来，与段内镜头之间的上升连成一片。
// 三种转场都带一点绕画面中心的旋转（旧画面转出去、新画面从反方向转回正），与段内镜头之间的大角度旋转接上。
//
// 场景帧（hanabiSceneFrames.ts）：某一时刻哪些段落场景在画、各自套什么帧（透明度 / 缩放 / 模糊 / 纵向位移）。
// 纯函数，只由 program 与时间决定。段落首尾相接，所以任何时刻只有「当前段落」一个场景，外加边界之后的进入窗口里
// 正在退出的上一段（同绘光）：
//   - 出场窗口（transitionOut.startTime..边界）：当前段套 resolveFrame('exit')；
//   - 进入窗口（边界之后 resolveHanabiEnterDuration 秒）：新段套 resolveFrame('enter')，同时与出场接着往下走的
//     上一段交叉渐变，边界两侧的画面是连续的，没有硬切，旧画面也不在边界上一下停住。
// program（下一批 hanabi-program.js 的 HanabiProgram）按鸭子类型消费：paragraphs[].startTime 与
// paragraphs[].transitionOut { kind, startTime, endTime }。
(function () {
  'use strict'

  // ---------- 基础缓动（原版 hanabiTransitions.ts） ----------

  // 两端速度、加速度都为 0 的缓动（与镜头之间慢转换速度的是同一条，来自 hanabi-timeline.js）。
  // timeline 未加载时的本地等价兜底，保证本文件可独立加载。
  function easeSepticLocal(value) {
    var t = Math.min(1, Math.max(0, value))
    return Math.pow(t, 4) * (35 + t * (-84 + t * (70 - 20 * t)))
  }
  var ease = window.FoliaHanabiTimeline && window.FoliaHanabiTimeline.easeSeptic
    ? window.FoliaHanabiTimeline.easeSeptic
    : easeSepticLocal

  var HANABI_TRANSITION_KINDS = ['ascend', 'flash', 'bloom']

  /**
   * 从静止起步、越走越快，到 1 时正好变成匀速（速度 2、加速度 0）；超过 1 接着匀速走。
   * 上升转场的旧画面过了边界还按这个速度继续往下滑、继续转着淡掉，不会在边界上一下停住。
   */
  function launch(p) {
    if (p <= 0) return 0
    if (p >= 1) return 1 + 2 * (p - 1)
    return p * p * p * (2 - p)
  }

  /** 一帧 = { alpha, scale, blur, y, rotation }，缺省项按 { 1, 1, 0, 0, 0 } 补。 */
  function frame(partial) {
    return Object.assign({ alpha: 1, scale: 1, blur: 0, y: 0, rotation: 0 }, partial)
  }

  /** exit 的 progress 可以超过 1（边界之后还在淡出的旧段落）：上升接着走，闪白 / 开花停在终点。 */
  function resolveFrame(kind, phase, progress) {
    var p = Math.max(0, phase === 'exit' ? progress : Math.min(1, progress))
    if (kind === 'ascend') {
      if (phase === 'exit') {
        var e = launch(p)
        return frame({ y: 0.32 * e, blur: 10 * Math.min(e, 1), alpha: 1 - 0.7 * ease((p - 0.5) / 0.5), rotation: 0.55 * e })
      }
      // 镜像的 launch：带着速度落进来，减速停稳。
      var k = launch(1 - p)
      return frame({ y: -0.26 * k, blur: 10 * k, alpha: 1 - 0.7 * k, rotation: -0.5 * k })
    }
    if (kind === 'flash') {
      var near = phase === 'exit' ? ease(p) : 1 - ease(p)
      return frame({ scale: 1 + 0.05 * near, blur: 9 * near * near, alpha: 1 - 0.55 * near * near, rotation: (phase === 'exit' ? 0.12 : -0.12) * near })
    }
    if (phase === 'exit') {
      var e2 = ease(p)
      return frame({ scale: 1 + 0.18 * e2, blur: 5 * e2, alpha: 1 - e2, rotation: 0.3 * e2 })
    }
    var k2 = 1 - ease(p)
    return frame({ scale: 1 - 0.08 * k2, blur: 4 * k2, alpha: 1 - k2, rotation: -0.25 * k2 })
  }

  var HANABI_TRANSITIONS = {}
  HANABI_TRANSITION_KINDS.forEach(function (kind) {
    HANABI_TRANSITIONS[kind] = {
      kind: kind,
      /** 段落边界处的时长；gap 为两段之间的空隙（下一段开始 − 这一段最后一行唱完）。 */
      duration: function (gap) {
        return kind === 'flash'
          ? Math.min(0.5, Math.max(0.28, gap > 0 ? gap * 0.4 : 0.35))
          : Math.min(1.1, Math.max(0.5, gap > 0 ? gap * 0.6 : 0.8))
      },
      /** 边界之后进入阶段时长的钳制（进入时长 = 上一段转场窗口的长度钳在这个区间里）。 */
      enterClamp: kind === 'flash' ? [0.2, 0.45] : [0.4, 0.9],
      /** exit：0 → 1 走向边界；enter：0 → 1 离开边界。 */
      resolveFrame: function (phase, progress) {
        return resolveFrame(kind, phase, progress)
      }
    }
  })

  /** 进入阶段的时长：上一段 transitionOut 窗口（startTime..endTime）的长度钳在转场的 enterClamp 里。 */
  function resolveHanabiEnterDuration(kind, startTime, endTime) {
    var clampRange = HANABI_TRANSITIONS[kind].enterClamp
    return Math.max(clampRange[0], Math.min(clampRange[1], endTime - startTime))
  }

  /**
   * 选转场：上升占一半（连续升空是这个模式的主线），另一半在闪白 / 开花里挑；不与上一次相同，按 (seed, 段落序号) 散列确定。
   */
  function chooseHanabiTransition(seed, paragraphIndex, previous) {
    var text = seed + ':' + paragraphIndex + ':hanabi-transition'
    var hash = 0
    for (var i = 0; i < text.length; i += 1) hash = (hash * 31 + text.charCodeAt(i)) | 0
    var roll = Math.abs(hash)
    if (previous !== 'ascend' && roll % 2 === 0) return 'ascend'
    var choices = HANABI_TRANSITION_KINDS.filter(function (kind) { return kind !== previous && kind !== 'ascend' })
    return choices[(roll >> 1) % choices.length]
  }

  // ---------- 段落场景帧（原版 hanabiSceneFrames.ts） ----------

  var IDLE = { alpha: 1, scale: 1, blur: 0, y: 0, rotation: 0 }

  function smooth(value) {
    var t = Math.min(1, Math.max(0, value))
    return t * t * (3 - 2 * t)
  }

  /** 边界之后还在淡出的旧段落，出场进度接着走过 1（上升转场的旧画面接着滑走，不在边界上停住）。 */
  function exitFrameOf(program, index, time, beyondBoundary) {
    var paragraph = program.paragraphs[index]
    var out = paragraph ? paragraph.transitionOut : null
    if (!out || time < out.startTime) return IDLE
    var progress = (time - out.startTime) / Math.max(out.endTime - out.startTime, 1e-3)
    return HANABI_TRANSITIONS[out.kind].resolveFrame('exit', beyondBoundary ? progress : Math.min(progress, 1))
  }

  /** 倒序找第一个 startTime <= time 的段落（与 hanabi-program.js 的 findHanabiParagraphIndexAtTime 等价）。 */
  function findParagraphIndexAt(program, time) {
    for (var index = program.paragraphs.length - 1; index >= 0; index -= 1) {
      if (time >= program.paragraphs[index].startTime) return index
    }
    return 0
  }

  // 段落序号优先走 hanabi-program.js（下一批）的实现；它没加载时用上面的等价兜底。
  function findHanabiParagraphIndexAtTime(program, time) {
    if (window.FoliaHanabiProgram && typeof window.FoliaHanabiProgram.findHanabiParagraphIndexAtTime === 'function') {
      return window.FoliaHanabiProgram.findHanabiParagraphIndexAtTime(program, time)
    }
    return findParagraphIndexAt(program, time)
  }

  /**
   * 某一时刻各段落场景的层帧。transitionsEnabled 为 false（静态模式）时段落之间硬切。没有段落时 layers 为空。
   * 返回 { activeIndex（当前段落，场景缓存以它为中心）, layers（从下往上画的层；通常一个，进入窗口里两个，上一段在下） }。
   */
  function resolveHanabiSceneFrames(program, time, transitionsEnabled) {
    if (program.paragraphs.length === 0) return { activeIndex: -1, layers: [] }
    var activeIndex = findHanabiParagraphIndexAtTime(program, time)
    if (!transitionsEnabled) {
      return { activeIndex: activeIndex, layers: [Object.assign({ index: activeIndex }, IDLE)] }
    }
    var paragraph = program.paragraphs[activeIndex]
    var current = exitFrameOf(program, activeIndex, time, false)
    var layers = []

    var previousParagraph = activeIndex > 0 ? program.paragraphs[activeIndex - 1] : null
    var previousOut = previousParagraph ? previousParagraph.transitionOut : null
    if (previousOut) {
      var enterDuration = resolveHanabiEnterDuration(previousOut.kind, previousOut.startTime, previousOut.endTime)
      var progress = (time - paragraph.startTime) / enterDuration
      if (progress >= 0 && progress < 1) {
        var enter = HANABI_TRANSITIONS[previousOut.kind].resolveFrame('enter', progress)
        var weight = smooth(progress)
        // 上一段的出场接着走（上升按边界上的速度继续滑走、转走），随进入进度淡掉。
        var leaving = exitFrameOf(program, activeIndex - 1, time, true)
        if (leaving.alpha * (1 - weight) > 0.002) {
          layers.push(Object.assign({ index: activeIndex - 1 }, leaving, { alpha: leaving.alpha * (1 - weight) }))
        }
        layers.push({
          index: activeIndex,
          alpha: Math.min(enter.alpha, weight) * current.alpha,
          scale: enter.scale * current.scale,
          blur: Math.max(enter.blur, current.blur),
          y: enter.y + current.y,
          rotation: enter.rotation + current.rotation
        })
        return { activeIndex: activeIndex, layers: layers }
      }
    }
    layers.push(Object.assign({ index: activeIndex }, current))
    return { activeIndex: activeIndex, layers: layers }
  }

  window.FoliaHanabiTransitions = {
    HANABI_TRANSITION_KINDS: HANABI_TRANSITION_KINDS,
    HANABI_TRANSITIONS: HANABI_TRANSITIONS,
    resolveHanabiEnterDuration: resolveHanabiEnterDuration,
    chooseHanabiTransition: chooseHanabiTransition,
    resolveHanabiSceneFrames: resolveHanabiSceneFrames
  }
})()
