// 水洼里的倒影（移植自 engine/fx/reflection.ts）：把正交镜头按地面（y = planeY）镜像，只渲染 REFLECT 图层上
// 的亮东西（招牌、灯箱、天花灯、灯头、贩卖机、只在倒影里出现的“橱窗光”）到半分辨率的 HDR 贴图；
// 湿路面的着色器按 textureMatrix 投影取样。暗的墙和地本来就映不出什么，不画它们。
(function () {
  'use strict'

  var THREE = window.THREE

  /** 只在倒影里出现、或者主画面和倒影都要出现的图层。 */
  var MACHI_REFLECT_LAYER = 1

  function MachiReflection(planeY, scale) {
    this.planeY = planeY
    this.scale = scale
    // 带 mipmap：湿路面按粗糙度取糊一点的那一级，倒影不至于像镜子。
    this.target = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType,
      depthBuffer: true,
      generateMipmaps: true,
      minFilter: THREE.LinearMipmapLinearFilter
    })
    this.target.texture.name = 'machi:reflection'
    this.textureMatrix = new THREE.Matrix4()
    this._mirror = new THREE.OrthographicCamera()
    this._mirror.layers.set(MACHI_REFLECT_LAYER)
    this._up = new THREE.Vector3()
    this._lookTarget = new THREE.Vector3()
    this._forward = new THREE.Vector3()
  }

  MachiReflection.prototype.setSize = function (width, height) {
    this.target.setSize(Math.max(1, Math.round(width * this.scale)), Math.max(1, Math.round(height * this.scale)))
  }

  MachiReflection.prototype.setScale = function (scale, width, height) {
    this.scale = scale
    this.setSize(width, height)
  }

  /** 跟着主镜头更新镜像镜头和投影矩阵，再把 REFLECT 图层画进贴图。 */
  MachiReflection.prototype.render = function (renderer, scene, camera) {
    var y = this.planeY
    var mirror = this._mirror
    mirror.left = camera.left
    mirror.right = camera.right
    mirror.top = camera.top
    mirror.bottom = camera.bottom
    mirror.near = camera.near
    mirror.far = camera.far
    mirror.zoom = camera.zoom
    mirror.updateProjectionMatrix()
    mirror.position.set(camera.position.x, 2 * y - camera.position.y, camera.position.z)
    camera.getWorldDirection(this._forward)
    this._lookTarget.copy(camera.position).add(this._forward)
    this._lookTarget.y = 2 * y - this._lookTarget.y
    this._up.set(0, 1, 0).applyQuaternion(camera.quaternion)
    this._up.y = -this._up.y
    mirror.up.copy(this._up)
    mirror.lookAt(this._lookTarget)
    mirror.updateMatrixWorld()
    this.textureMatrix.set(
      0.5, 0, 0, 0.5,
      0, 0.5, 0, 0.5,
      0, 0, 0.5, 0.5,
      0, 0, 0, 1
    ).multiply(mirror.projectionMatrix).multiply(mirror.matrixWorldInverse)

    var background = scene.background
    var fog = scene.fog
    var previousTarget = renderer.getRenderTarget()
    var previousClear = renderer.getClearColor(new THREE.Color())
    var previousAlpha = renderer.getClearAlpha()
    var shadowAuto = renderer.shadowMap.autoUpdate
    scene.background = null
    scene.fog = null
    renderer.shadowMap.autoUpdate = false
    renderer.setRenderTarget(this.target)
    renderer.setClearColor(0x000000, 1)
    renderer.clear()
    renderer.render(scene, mirror)
    renderer.setRenderTarget(previousTarget)
    renderer.setClearColor(previousClear, previousAlpha)
    renderer.shadowMap.autoUpdate = shadowAuto
    scene.background = background
    scene.fog = fog
  }

  MachiReflection.prototype.dispose = function () {
    this.target.dispose()
  }

  window.FoliaMachiReflection = { MachiReflection: MachiReflection, MACHI_REFLECT_LAYER: MACHI_REFLECT_LAYER }
})()
