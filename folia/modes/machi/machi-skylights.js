// 三个场景共用的天光（移植自 engine/skyLights.ts）：半球光（天、地两色）与一盏平行光（夜里是月光，
// 黄昏是低低的橙色太阳，白天是高处的太阳），平行光投柔和阴影。方向与强度随环境走；
// 阴影图只在需要时重画（建场景、开关门、太阳转过了一点）。场景自己的灯由场景挂。
(function () {
  'use strict'

  var THREE = window.THREE
  var Environment = window.FoliaMachiEnvironment

  /** 夜、黄昏、白天三个方向（指向光源）。黄昏的太阳从左前方低低地照过来。 */
  var DIRECTIONS = {
    night: new THREE.Vector3(-6.5, 14, -5).normalize(),
    dusk: new THREE.Vector3(-11, 5.5, 6).normalize(),
    day: new THREE.Vector3(-6, 16, 8).normalize()
  }
  var LIGHT_DISTANCE = 17
  /** 太阳方向变过这么多（单位向量的差）就重画一次阴影图。 */
  var SHADOW_REDRAW_STEP = 0.012

  function MachiSkyLights(blend, shadowMapSize) {
    this._blend = blend
    this.group = new THREE.Group()
    this.group.name = 'SkyLights'
    this.hemi = new THREE.HemisphereLight(0xffffff, 0xffffff, 2.1)
    this.hemi.name = 'Lights/hemi'
    this.moon = new THREE.DirectionalLight(0xffffff, 1.35)
    this.moon.name = 'Lights/moon'
    this._direction = new THREE.Vector3().copy(DIRECTIONS.night)
    this._shadowDirection = new THREE.Vector3().copy(DIRECTIONS.night)
    this.moon.position.copy(this._direction).multiplyScalar(LIGHT_DISTANCE)
    this.moon.target.position.set(0, 0, 0)
    // shadowMapSize 为 0 是不投阴影（画质）。
    this.moon.castShadow = shadowMapSize > 0
    this.moon.shadow.mapSize.setScalar(shadowMapSize > 0 ? shadowMapSize : 1024)
    var shadowCamera = this.moon.shadow.camera
    shadowCamera.left = -9.5
    shadowCamera.right = 9.5
    shadowCamera.top = 9.5
    shadowCamera.bottom = -9.5
    shadowCamera.near = 1
    shadowCamera.far = 40
    this.moon.shadow.bias = -0.0006
    this.moon.shadow.normalBias = 0.025
    this.moon.shadow.radius = 3
    this.moon.shadow.autoUpdate = false
    this.group.add(this.hemi)
    this.group.add(this.moon)
    this.group.add(this.moon.target)
    this.sync()
  }

  /** 颜色（插值后的、按环境推出来的）写回。 */
  MachiSkyLights.prototype.sync = function () {
    this.hemi.color.copy(this._blend.get('hemiSky'))
    this.hemi.groundColor.copy(this._blend.get('hemiGround'))
    this.moon.color.copy(this._blend.get('moon'))
  }

  /** 每帧：方向在夜、黄昏、白天之间插值，强度乘上闪电。太阳转过了一点就重画阴影图。 */
  MachiSkyLights.prototype.update = function (frame) {
    var d = frame.daylight
    var dusk = Environment.MACHI_DAYLIGHT.dusk
    if (d <= dusk) this._direction.lerpVectors(DIRECTIONS.night, DIRECTIONS.dusk, d / dusk)
    else this._direction.lerpVectors(DIRECTIONS.dusk, DIRECTIONS.day, (d - dusk) / (1 - dusk))
    this._direction.normalize()
    this.moon.position.copy(this._direction).multiplyScalar(LIGHT_DISTANCE)
    if (this._direction.distanceTo(this._shadowDirection) > SHADOW_REDRAW_STEP) {
      this._shadowDirection.copy(this._direction)
      this.invalidateShadows()
    }
    this.hemi.intensity = frame.hemiIntensity * (1 + 1.5 * frame.flash)
    this.moon.intensity = frame.sunIntensity * (1 + 1.2 * frame.flash)
  }

  /** 下一帧重画阴影图。 */
  MachiSkyLights.prototype.invalidateShadows = function () {
    this.moon.shadow.needsUpdate = true
  }

  /** 太阳方向停在中间值上时，补一次精确的阴影。 */
  MachiSkyLights.prototype.settleShadows = function () {
    if (this._direction.equals(this._shadowDirection)) return
    this._shadowDirection.copy(this._direction)
    this.invalidateShadows()
  }

  /** 0 是不投阴影（画质里关了阴影）。 */
  MachiSkyLights.prototype.setShadowMapSize = function (size) {
    var cast = size > 0
    if (this.moon.castShadow !== cast) {
      this.moon.castShadow = cast
      this.invalidateShadows()
    }
    if (!cast || this.moon.shadow.mapSize.x === size) return
    this.moon.shadow.mapSize.set(size, size)
    if (this.moon.shadow.map) this.moon.shadow.map.dispose()
    this.moon.shadow.map = null
    this.invalidateShadows()
  }

  MachiSkyLights.prototype.dispose = function () {
    if (this.moon.shadow.map) this.moon.shadow.map.dispose()
  }

  window.FoliaMachiSkyLights = MachiSkyLights
})()
