// 花火（hanabi）整单元拼贴层：移植自 folia-major src/components/visualizer/hanabi/collage/unitCollage.ts
// 整个场景单元一份的拼贴层（屏幕坐标，不放进上升的世界里）：
//   - back：满屏的网点底纹，按世界上升量的 0.35 倍视差往下流——画面空着的地方也看得出一直在往上走；
//   - front：画面左缘一条竖着的电影胶片（齿孔 + 一格格粉彩画面，不带字），跟着世界的上升一起往下走，像摄影机沿着它往上爬。
// 两层的位置只由 t 与 rise(t) 决定。
(function () {
  'use strict'

  var PIXI = window.PIXI
  var Core = window.FoliaHanabiCore
  var Plan = window.FoliaHanabiCollagePlan

  /** 网点底纹的小格（白点，靠 tint 上色）。 */
  var paintDotTile = function (scale) {
    var tile = 26
    var canvas = document.createElement('canvas')
    canvas.width = Math.ceil(tile * scale)
    canvas.height = Math.ceil(tile * scale)
    var context = canvas.getContext('2d')
    context.setTransform(scale, 0, 0, scale, 0, 0)
    context.fillStyle = '#ffffff'
    context.beginPath()
    context.arc(tile / 4, tile / 4, 1.6, 0, Math.PI * 2)
    context.arc((tile * 3) / 4, (tile * 3) / 4, 1.6, 0, Math.PI * 2)
    context.fill()
    return canvas
  }

  /**
   * 建整单元的拼贴层。options：{ width, height, resolution, seed, cache（FoliaHanabiCollagePainters 的一套）,
   * paper（调色板的纸白）, amount（tuning.collage 0..2）, startTime }。
   * 返回 { back, front, update(time, rise), destroy() }。
   */
  function createUnitCollage(pixi, options) {
    var width = options.width
    var height = options.height
    var amount = options.amount
    var unit = Math.min(width, height)
    var random = Core.createRng(options.seed + ':unit-collage')
    var back = new pixi.Container()
    var front = new pixi.Container()
    var scale = Math.max(1, Math.min(2, options.resolution || 1))

    var dotTexture = new pixi.Texture({ source: new pixi.CanvasSource({ resource: paintDotTile(scale), resolution: scale }) })
    var dots = new pixi.TilingSprite({ texture: dotTexture, width: width * 1.2, height: height * 1.2 })
    dots.position.set(-width * 0.1, -height * 0.1)
    dots.tint = options.paper
    dots.alpha = 0.05 + 0.03 * Math.min(1, amount)
    back.addChild(dots)

    var thickness = Math.max(20, unit * 0.055)
    var rail = new pixi.TilingSprite({
      texture: options.cache.strip('film', Plan.CANDY[Math.floor(random() * Plan.CANDY.length)], thickness),
      width: height * 1.3,
      height: thickness
    })
    // 转成竖条：本地 +x 指向画面上方。
    rail.anchor.set(0.5)
    rail.rotation = -Math.PI / 2
    rail.position.set(Math.max(thickness * 0.9, width * 0.022), height / 2)
    rail.alpha = 0.92
    front.addChild(rail)
    var tile = rail.texture.width || 1
    var drift = unit * 0.03

    return {
      back: back,
      front: front,
      update: function (time, rise) {
        dots.tilePosition.y = rise * 0.35
        // 胶片跟着世界往下走（本地 −x 是画面下方），外加一点自己的慢速走片。段落之间由运行时的转场交叉渐变接上。
        rail.tilePosition.x = (((-(rise + drift * (time - options.startTime))) % tile) + tile) % tile
      },
      destroy: function () {
        // Pixi v8 销毁纪律（PORTING.md）：逐节点无参 destroy（上游写 destroy({ children: true })）。
        window.FoliaHanabiBloom.destroyPixiDisplayTree(back)
        window.FoliaHanabiBloom.destroyPixiDisplayTree(front)
        dotTexture.destroy(true)
      }
    }
  }

  window.FoliaHanabiCollageUnit = {
    createUnitCollage: createUnitCollage
  }
})()
