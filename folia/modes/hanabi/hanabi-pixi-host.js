// Pixi 模式共用的换歌交接与段落场景缓存（移植自 pixiSongSwap.ts + pixiSceneCache.ts，合成一文件）：
// 换歌交接两帧状态机：第一帧在旧歌还在画时把新歌当前段落的场景建好（stage），第二帧切过去（commit）；
// 中途取消或销毁时立即了结。段落场景缓存：按段落下标缓存当前段 ±1，换歌整批换下（retire），
// 换下的场景一帧销毁一个，免得交接那一帧卡住。
(function () {
  'use strict'

  // ===== 换歌交接（pixiSongSwap.ts） =====
  /**
   * hooks: { stage(song) → TStaged|null, commit(song, staged|null), discard(staged) }
   */
  function PixiSongSwap(hooks) {
    this._hooks = hooks
    this._pending = null
  }

  Object.defineProperty(PixiSongSwap.prototype, 'active', {
    get: function () { return this._pending !== null }
  })

  /** 正在交接的新歌（还没切过去）。 */
  Object.defineProperty(PixiSongSwap.prototype, 'song', {
    get: function () { return this._pending ? this._pending.song : null }
  })

  /** 已经建好、还没切过去的场景（tuning / 尺寸变化时需要一起更新或丢弃）。 */
  Object.defineProperty(PixiSongSwap.prototype, 'staged', {
    get: function () { return this._pending ? this._pending.staged : null }
  })

  /** 丢掉已建好的 staged（它是按旧的尺寸 / tuning 建的）；交接照常在下一帧切，切的时候重建。 */
  PixiSongSwap.prototype.dropStaged = function () {
    var pending = this._pending
    if (!pending || !pending.staged) return
    this._hooks.discard(pending.staged)
    pending.staged = null
  }

  /** 开始一次交接，两帧之后 resolve。signal 可选（abort 时立即了结）。 */
  PixiSongSwap.prototype.begin = function (song, signal) {
    var self = this
    return new Promise(function (resolve) {
      var onAbort = function () { self._settle(true) }
      self._pending = {
        song: song,
        staged: null,
        prepared: false,
        settle: resolve,
        detachAbort: function () { if (signal) signal.removeEventListener('abort', onAbort) }
      }
      if (signal) signal.addEventListener('abort', onAbort, { once: true })
    })
  }

  /** 每帧开头调用：第一帧 stage，第二帧 commit。切的那一帧不做任何重活。 */
  PixiSongSwap.prototype.advance = function () {
    var pending = this._pending
    if (!pending) return
    if (!pending.prepared) {
      pending.prepared = true
      pending.staged = this._hooks.stage(pending.song)
      return
    }
    this._settle(true)
  }

  /** 立即了结：commit 为 false（运行时正在销毁）时只丢弃 staged。 */
  PixiSongSwap.prototype._settle = function (commit) {
    var pending = this._pending
    if (!pending) return
    this._pending = null
    pending.detachAbort()
    if (commit) this._hooks.commit(pending.song, pending.staged)
    else if (pending.staged) this._hooks.discard(pending.staged)
    pending.settle()
  }

  PixiSongSwap.prototype.settle = function (commit) { this._settle(commit) }

  // ===== 段落场景缓存（pixiSceneCache.ts） =====
  /**
   * hooks: { count() → 段落数, build(index) → scene, destroy(scene), detach?(scene) }
   */
  function PixiSceneCache(hooks) {
    this._hooks = hooks
    this._scenes = new Map()
    /**
     * 换歌时换下来的场景，之后一帧销毁一个，免得交接那一帧卡住
     * （销毁一个场景要走每个镜头与每个字形 Text，交接帧全清正是要藏掉的那次卡顿）。
     */
    this._retired = []
  }

  Object.defineProperty(PixiSceneCache.prototype, 'size', {
    get: function () { return this._scenes.size }
  })

  Object.defineProperty(PixiSceneCache.prototype, 'hasRetired', {
    get: function () { return this._retired.length > 0 }
  })

  PixiSceneCache.prototype.has = function (index) { return this._scenes.has(index) }

  PixiSceneCache.prototype.get = function (index) { return this._scenes.get(index) }

  PixiSceneCache.prototype.forEach = function (callback) {
    this._scenes.forEach(callback)
  }

  /** 取缓存里的场景，没有就建；越界返回 null。 */
  PixiSceneCache.prototype.ensure = function (index) {
    if (index < 0 || index >= this._hooks.count()) return null
    var cached = this._scenes.get(index)
    if (cached) return cached
    var scene = this._hooks.build(index)
    this._scenes.set(index, scene)
    return scene
  }

  /** 收下一个在缓存外建好的场景（换歌交接的 staged）。 */
  PixiSceneCache.prototype.adopt = function (index, scene) {
    this._scenes.set(index, scene)
  }

  /** 销毁离 index 超过一段、且不在 keep 里的场景。 */
  PixiSceneCache.prototype.prune = function (index, keep) {
    var hooks = this._hooks
    var doomed = []
    this._scenes.forEach(function (scene, sceneIndex) {
      if (Math.abs(sceneIndex - index) <= 1 || (keep && keep.has(sceneIndex))) return
      doomed.push(sceneIndex)
    })
    doomed.forEach(function (sceneIndex) {
      hooks.destroy(this._scenes.get(sceneIndex))
      this._scenes.delete(sceneIndex)
    }, this)
  }

  /** 立即销毁全部缓存场景（不含已换下的）。 */
  PixiSceneCache.prototype.clear = function () {
    var self = this
    this._scenes.forEach(function (scene) { self._hooks.destroy(scene) })
    this._scenes.clear()
  }

  /** 整批换下：摘离场景层但不销毁，留给 drainRetired 一帧一个地释放。 */
  PixiSceneCache.prototype.retireAll = function () {
    var self = this
    this._scenes.forEach(function (scene) {
      if (self._hooks.detach) self._hooks.detach(scene)
      self._retired.push(scene)
    })
    this._scenes.clear()
  }

  /** 销毁一个换下的场景；没有可销毁的返回 false。空闲帧调用。 */
  PixiSceneCache.prototype.drainRetired = function () {
    var scene = this._retired.shift()
    if (scene === undefined) return false
    this._hooks.destroy(scene)
    return true
  }

  /** 运行时销毁：缓存与换下的场景全部释放。 */
  PixiSceneCache.prototype.destroyAll = function () {
    this.clear()
    var self = this
    this._retired.forEach(function (scene) { self._hooks.destroy(scene) })
    this._retired.length = 0
  }

  window.FoliaHanabiPixiHost = { PixiSongSwap: PixiSongSwap, PixiSceneCache: PixiSceneCache }
})()
