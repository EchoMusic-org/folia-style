// 运行时里的片尾卡层（移植自 hanabiCreditsLayer.ts）：最后一句唱完前几秒才建，歌曲信息、主题、尺寸或
// tuning 变了就作废，下次需要时再建。纯音乐（lyricEndTime 为 null）与没有任何歌曲信息时没有片尾卡，
// 歌词也不会淡出。credits 本体（credits.ts）由运行时批次的 hanabi-credits.js 提供。
(function () {
  'use strict'

  /** 最后一句唱完前多少秒开始预建。 */
  var PREBUILD_SECONDS = 4

  var INACTIVE = { active: false, lyricAlpha: 1, lyricBlur: 0, posterAlpha: 0, posterOffsetY: 0, posterScale: 1 }

  function toSongMetadata(metadata) {
    return {
      title: metadata.title !== undefined && metadata.title !== null ? metadata.title : null,
      artist: metadata.artist !== undefined && metadata.artist !== null ? metadata.artist : null,
      album: metadata.album !== undefined && metadata.album !== null ? metadata.album : null
    }
  }

  function HanabiCreditsLayer(pixi) {
    this._pixi = pixi
    this.holder = new pixi.Container()
    this.holder.visible = false
    this._credits = null
    this._lyricEndTime = 0
  }

  Object.defineProperty(HanabiCreditsLayer.prototype, 'built', {
    get: function () { return this._credits !== null }
  })

  HanabiCreditsLayer.prototype.hasMetadata = function (metadata) {
    var Credits = window.FoliaHanabiCredits
    return Credits ? Credits.hasHanabiCredits(toSongMetadata(metadata)) : false
  }

  /** 片尾时间线帧；没有片尾卡时恒为 inactive（歌词不淡出）。 */
  HanabiCreditsLayer.prototype.resolveFrame = function (time, program, metadata) {
    var Credits = window.FoliaHanabiCredits
    if (program.lyricEndTime === null || !this.hasMetadata(metadata)) return INACTIVE
    this._lyricEndTime = program.lyricEndTime
    return Credits.resolveHanabiCreditsFrame(time, program.lyricEndTime)
  }

  HanabiCreditsLayer.prototype.needsBuild = function (time, program, metadata) {
    return !this._credits
      && program.lyricEndTime !== null
      && time >= program.lyricEndTime - PREBUILD_SECONDS
      && this.hasMetadata(metadata)
  }

  HanabiCreditsLayer.prototype.build = function (context) {
    var Credits = window.FoliaHanabiCredits
    this.invalidate()
    this._credits = Credits.createHanabiCredits(this._pixi, {
      width: context.width,
      height: context.height,
      resolution: context.resolution,
      theme: context.theme,
      metadata: toSongMetadata(context.metadata),
      tuning: context.tuning,
      textures: context.textures,
      icons: context.icons
    })
    this.holder.addChild(this._credits.view)
    this.holder.pivot.set(context.width / 2, context.height / 2)
  }

  /** 片尾卡以画面中心缩放、上下偏移；没激活时整层不画。 */
  HanabiCreditsLayer.prototype.update = function (time, frame, width, height) {
    var credits = this._credits
    this.holder.visible = Boolean(credits) && frame.active && frame.posterAlpha > 0.002
    if (!credits || !this.holder.visible) return
    this.holder.alpha = frame.posterAlpha
    this.holder.position.set(width / 2, height / 2 + frame.posterOffsetY * height)
    this.holder.scale.set(frame.posterScale)
    credits.update(time - this._lyricEndTime)
  }

  /** 作废当前片尾卡（下次需要时重建）。 */
  HanabiCreditsLayer.prototype.invalidate = function () {
    if (!this._credits) return
    var credits = this._credits
    this._credits = null
    this.holder.removeChild(credits.view)
    credits.destroy()
    this.holder.visible = false
  }

  HanabiCreditsLayer.prototype.destroy = function () {
    this.invalidate()
    this.holder.destroy({ children: true })
  }

  window.FoliaHanabiCreditsLayer = { HanabiCreditsLayer: HanabiCreditsLayer, PREBUILD_SECONDS: PREBUILD_SECONDS, INACTIVE: INACTIVE }
})()
