// 町景天空（移植自 engine/sky.ts）：一张 4×256 的竖向渐变贴图，作为场景背景铺满画面。颜色插值时重画。
(function () {
  'use strict'

  var THREE = window.THREE

  function MachiSky() {
    var canvas = document.createElement('canvas')
    canvas.width = 4
    canvas.height = 256
    this.context = canvas.getContext('2d')
    this.texture = new THREE.CanvasTexture(canvas)
    this.texture.colorSpace = THREE.SRGBColorSpace
  }

  MachiSky.prototype.paint = function (top, bottom) {
    var gradient = this.context.createLinearGradient(0, 0, 0, 256)
    gradient.addColorStop(0, '#' + top.getHexString())
    gradient.addColorStop(1, '#' + bottom.getHexString())
    this.context.fillStyle = gradient
    this.context.fillRect(0, 0, 4, 256)
    this.texture.needsUpdate = true
  }

  MachiSky.prototype.dispose = function () { this.texture.dispose() }

  window.FoliaMachiSky = MachiSky
})()
