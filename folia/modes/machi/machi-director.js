// 町景编排（移植自 engine/director.ts，纯函数，三个场景共用）：
// 歌词屏此刻该亮哪一行还是曲名卡、副歌权重、副歌开头的闪电、招牌的闪烁日程、音频包络、跑马灯文本。
// 牌面、副歌、闪电跟歌曲时间走（拖进度也对得上），闪烁跟氛围时钟走。
(function () {
  'use strict'

  var SeedHash = window.FoliaSeedHash
  var RenderHints = window.FoliaRenderHints

  var INTERLUDE_FULL_TEXT = '......'

  /** 上游间奏行的标记文本；宿主行没有该标记时空文本同样按间奏处理。 */
  function isInterludeLine(line) {
    return !!line && line.fullText === INTERLUDE_FULL_TEXT
  }

  /** 一行唱完后，下一行还没来时牌面再留多久才换成曲名卡。 */
  var BOARD_HOLD_SECONDS = 2.6
  /** 牌面比歌词略早一点亮出来，翻牌动画落在唱起的那一刻。 */
  var BOARD_LEAD_SECONDS = 0.12

  /** 时刻 time 的牌面：在唱或刚唱完的那一行；间奏、开唱前、长空隙里是曲名卡。 */
  function resolveMachiBoardTarget(lines, time) {
    var index = -1
    for (var i = 0; i < lines.length; i += 1) {
      if (lines[i].startTime <= time + BOARD_LEAD_SECONDS) index = i
      else break
    }
    if (index < 0) return { kind: 'card' }
    var line = lines[index]
    if (isInterludeLine(line) || !String(line.fullText || '').trim()) return { kind: 'card' }
    var next = lines[index + 1]
    var hold = RenderHints.getLineRenderEndTime(line) + BOARD_HOLD_SECONDS
    if (time > hold && (!next || next.startTime - BOARD_LEAD_SECONDS > time)) return { kind: 'card' }
    return { kind: 'line', index: index }
  }

  function sameBoardTarget(a, b) {
    return !!a && a.kind === b.kind && (a.kind === 'card' || (b.kind === 'line' && a.index === b.index))
  }

  function isChorusLine(line) {
    return !!line && (line.isChorus === true || /chorus|副歌/i.test(line.songPart || ''))
  }

  /** 副歌权重：正在唱副歌行（或刚唱完、下一行还是副歌）时为 1。运行时再做平滑。 */
  function resolveMachiChorus(lines, target) {
    if (target.kind !== 'line') return 0
    return isChorusLine(lines[target.index]) ? 1 : 0
  }

  /** 招牌闪烁：每 6.5 秒一个窗口，按哈希决定这个窗口里有没有一阵快速的明暗（三下），返回亮度倍数 0.5..1。 */
  function resolveMachiFlicker(time, seed, rate) {
    rate = rate === undefined ? 1 : rate
    var windowSeconds = 6.5 / Math.max(0.3, rate)
    var index = Math.floor(time / windowSeconds)
    var key = SeedHash.hashVisualizerSeed('flicker:' + seed)
    if (SeedHash.visualizerHash01(key, index, 0x51) > 0.42) return 1
    var offset = SeedHash.visualizerHash01(key, index, 0x7a) * (windowSeconds - 0.6)
    var local = time - index * windowSeconds - offset
    if (local < 0 || local > 0.46) return 1
    // 三下：越来越短的暗。
    var dips = [[0, 0.07, 0.5], [0.15, 0.2, 0.68], [0.32, 0.36, 0.8]]
    for (var i = 0; i < dips.length; i += 1) {
      if (local >= dips[i][0] && local <= dips[i][1]) return dips[i][2]
    }
    return 1
  }

  /** 音频包络：一见到大于 1 的值就按 0..255 归一化（主播放器），否则当 0..1（预览）；起音快、释放慢。 */
  function MachiAudioFollower() {
    this.value = 0
    this._byteScale = false
  }

  MachiAudioFollower.prototype.step = function (raw, deltaSeconds, attack, release) {
    attack = attack === undefined ? 0.06 : attack
    release = release === undefined ? 0.25 : release
    if (raw > 1.0001) this._byteScale = true
    var target = Math.max(0, Math.min(1, this._byteScale ? raw / 255 : raw))
    var tau = target > this.value ? attack : release
    var k = deltaSeconds <= 0 ? 0 : 1 - Math.exp(-deltaSeconds / tau)
    this.value += (target - this.value) * k
    return this.value
  }

  // —— 闪电 ————————————————————————————————————————————————————————————

  /** 每段副歌的开头（相邻副歌行算一段）。 */
  function buildMachiLightningTimes(lines) {
    var times = []
    for (var index = 0; index < lines.length; index += 1) {
      if (isChorusLine(lines[index]) && !isChorusLine(lines[index - 1])) times.push(lines[index].startTime)
    }
    return times
  }

  /** 闪电亮度 0..1：两下闪，第二下略弱，一秒内收尽。 */
  function resolveMachiLightning(times, time) {
    var since = Infinity
    for (var index = times.length - 1; index >= 0; index -= 1) {
      if (times[index] <= time) { since = time - times[index]; break }
    }
    if (since > 1.2) return 0
    var flash = function (at, width, height) { return height * Math.exp(-Math.pow(since - at, 2) / (width * width)) }
    return Math.min(1, flash(0.04, 0.05, 1) + flash(0.24, 0.06, 0.7) + 0.25 * Math.exp(-since * 3.5))
  }

  /** 跑马灯写什么：下一句；没有下一句时用这一句的译文；曲名卡时是曲名与歌手。 */
  function resolveMachiTickerText(target, lines, song, fallbackTitle) {
    var title = song.title || fallbackTitle
    if (target.kind === 'card') {
      return '♪ ' + title + (song.artist ? ' — ' + song.artist : '') + '   ◆   OPEN 24H   ◆'
    }
    var next = null
    for (var i = target.index + 1; i < lines.length; i += 1) {
      if (String(lines[i].fullText || '').trim()) { next = lines[i]; break }
    }
    var current = lines[target.index]
    var parts = []
    if (next) parts.push('NEXT ▸ ' + next.fullText)
    if (current && current.translation) parts.push('◆ ' + current.translation)
    return parts.length ? parts.join('   ') + '   ' : '♪ ' + title + '   ◆   '
  }

  window.FoliaMachiDirector = {
    isInterludeLine: isInterludeLine,
    INTERLUDE_FULL_TEXT: INTERLUDE_FULL_TEXT,
    resolveMachiBoardTarget: resolveMachiBoardTarget,
    sameBoardTarget: sameBoardTarget,
    isChorusLine: isChorusLine,
    resolveMachiChorus: resolveMachiChorus,
    resolveMachiFlicker: resolveMachiFlicker,
    MachiAudioFollower: MachiAudioFollower,
    buildMachiLightningTimes: buildMachiLightningTimes,
    resolveMachiLightning: resolveMachiLightning,
    resolveMachiTickerText: resolveMachiTickerText,
    BOARD_HOLD_SECONDS: BOARD_HOLD_SECONDS,
    BOARD_LEAD_SECONDS: BOARD_LEAD_SECONDS
  }
})()
