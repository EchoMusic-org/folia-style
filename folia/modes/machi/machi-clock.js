// 町景统一时钟（移植自 engine/clock.ts）：雨、涟漪、招牌闪烁、门这些氛围动效都只读它。
// 暂停时停住，场景定格；一帧最多走 0.1 秒，切回前台不跳一大截。歌词相关读歌曲时间，不读它。
(function () {
  'use strict'

  var MAX_STEP_SECONDS = 0.1

  function MachiClock() {
    this.elapsed = 0      // 氛围时间（秒），只在没暂停时前进
    this.delta = 0        // 这一帧氛围时间走了多少（暂停时 0）
    this.realDelta = 0    // 这一帧的真实时间（镜头回正这类界面动画用，不随暂停停住）
    this.paused = false
    this.timeScale = 1    // 动效强度乘在速度上
    this._last = -1
  }

  /** 每帧调一次，now 是 requestAnimationFrame 给的毫秒时间戳。 */
  MachiClock.prototype.tick = function (now) {
    var real = this._last < 0 ? 0 : Math.min(MAX_STEP_SECONDS, Math.max(0, (now - this._last) / 1000))
    this._last = now
    this.realDelta = real
    this.delta = this.paused ? 0 : real * this.timeScale
    this.elapsed += this.delta
  }

  /** 循环停过一阵后重新开始：不把停着的这段算进下一帧。 */
  MachiClock.prototype.resync = function () { this._last = -1 }

  window.FoliaMachiClock = MachiClock
})()
