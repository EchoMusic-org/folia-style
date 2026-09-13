// 镜台（diorama）模式·粒子场模块：移植自 folia-major src/components/visualizer/diorama/
//   DioramaParticleField.tsx（全文逻辑）
// React 组件 → 工厂转写：
//   useMemo(built) → setGeometry()（模式/簇/span/密度引用变化才重建）；
//   useMemo(targetColors) → setColors()（颜色字符串变化才重算对比适配色）；
//   useFrame → update(ctx)；useEffect(resetKey) → reset()；
//   <points> 两个（辉光 renderOrder 3 + 对比 renderOrder 4）挂同一 Group 返回。
// 依赖：window.THREE、window.FoliaDioramaCore、window.FoliaDioramaParticles。
// 挂载于 window.FoliaDioramaField。
(function () {
  'use strict'

  var THREE = window.THREE
  var Core = window.FoliaDioramaCore
  var Particles = window.FoliaDioramaParticles

  /**
   * 活纹波源池。这就是音频→几何的唯一边界：频段 onset 写一条记录后再不碰表面——
   * 着色器在自己的时钟上传播与沉降。运动因此是弹性的，而非逐帧重画当前带值。
   */
  function createRipplePool() {
    return {
      sources: new Float32Array(Particles.DIORAMA_RIPPLE_COUNT * 4),
      shapes: new Float32Array(Particles.DIORAMA_RIPPLE_COUNT * 4),
      cursor: Particles.RIPPLE_BANDS.map(function () { return 0 }),
      spawned: 0
    }
  }

  /** 隧道沿坐标（每歌词行，半径单位）——aWave.x 的烘焙空间。 */
  var CORRIDOR_UNITS_PER_LINE = Core.DIORAMA_STEP_DISTANCE / window.FoliaDioramaSequencer.DIORAMA_PARTICLE_CORRIDOR_RADIUS

  /**
   * 写入一个纹波源，围绕其频段性格确定性地变化高度/宽度/到达量/速度（绝不 Math.random）。
   * 云取单位球上一点（position / localRadius 所在处）；隧道取读头前方壁上一点。
   */
  function spawnRipple(pool, bandIndex, strength, now, corridor, readHeadAlong) {
    var seed = Core.hashSeed('diorama-ripple:' + pool.spawned)
    var preset = Particles.RIPPLE_BANDS[bandIndex]
    var height = Core.seededUnit(seed + 1)
    var spread = Core.seededUnit(seed + 2)
    var pace = Core.seededUnit(seed + 3)
    var cursor = pool.cursor[bandIndex]
    var offset = (bandIndex * Particles.RIPPLE_SLOTS_PER_BAND + cursor) * 4

    if (corridor) {
      // 在读头前方 0.4..2.6 半径单位（~3..19 世界单位），波峰在视野中展开再扫过
      pool.sources[offset] = readHeadAlong + 0.4 + Core.seededUnit(seed + 4) * 2.2
      pool.sources[offset + 1] = Core.seededUnit(seed + 5) * Math.PI * 2
      pool.sources[offset + 2] = 0
    } else {
      // 单位球上的均匀点
      var up = Core.seededUnit(seed + 4) * 2 - 1
      var around = Core.seededUnit(seed + 5) * Math.PI * 2
      var ring = Math.sqrt(Math.max(0, 1 - up * up))
      pool.sources[offset] = ring * Math.cos(around)
      pool.sources[offset + 1] = up
      pool.sources[offset + 2] = ring * Math.sin(around)
    }
    pool.sources[offset + 3] = now
    pool.shapes[offset] = preset.strength * strength * (0.7 + height * 0.6)
    pool.shapes[offset + 1] = preset.speed * (0.8 + pace * 0.45)
    pool.shapes[offset + 2] = preset.width * (0.78 + spread * 0.5)
    pool.shapes[offset + 3] = preset.wavenumber

    pool.cursor[bandIndex] = (cursor + 1) % Particles.RIPPLE_SLOTS_PER_BAND
    pool.spawned += 1
  }

  // 相机锁定当前歌词后需保持的秒数，走廊才开始重新聚合
  var FORMATION_SETTLE_SECONDS = 0.4

  // 位移是各几何自身半径的比例（见着色器），这些数字在 0.7 单位云与半径 7.4 隧道上读数一致。
  // 它们是音频响应 1.0 时的 swell；滑条缩放它们（gain 唯一作用点）。
  var CLOUD_SWELL = 0.34
  var CORRIDOR_MAX_SWELL = 0.45
  var CORRIDOR_QUIET_SWELL = 0.1
  /** 满强度波前实际达到的波值（GPU 实测）。 */
  var MAX_WAVE = 0.85
  var CLOUD_MAX_SWELL = MAX_WAVE * CLOUD_SWELL
  var CORRIDOR_MAX_SWELL_REACH = MAX_WAVE * CORRIDOR_MAX_SWELL

  /**
   * 创建粒子场：一个确定性自发光 Points 绘制 + 可选加性辉光 pass（同一缓冲）。
   * 音频来自共享频段，经快攻慢放包络平滑；全部读数落在着色器 uniform 上，
   * 每帧状态不参与任何 React 式状态，音频路径从不读相机。
   */
  function createDioramaParticleField(options) {
    // 惰性状态（原版 useRef 语义）。材质只创建一次，颜色经 lerp 逐帧追逐主题。
    var targetColors = Particles.resolveDioramaParticleContrastColors({
      primary: new THREE.Color(options.primaryColor),
      accent: new THREE.Color(options.accentColor),
      secondary: new THREE.Color(options.secondaryColor)
    }, new THREE.Color(options.backgroundColor))
    var geometry = null
    var waveNumberMax = 8
    var material = Particles.createDioramaParticleMaterial(targetColors)
    var glowMaterial = Particles.createDioramaParticleGlowMaterial(targetColors, options.particleGlowIntensity)

    // 对比适配目标色缓存（原版 useMemo [primaryColor, accentColor, secondaryColor, backgroundColor]）
    var targetColorsKey = options.primaryColor + '|' + options.accentColor + '|' + options.secondaryColor + '|' + options.backgroundColor
    var glowIntensity = options.particleGlowIntensity

    var trackers = Particles.RIPPLE_BANDS.map(function () { return Particles.createDioramaBandTracker() })
    var ripples = createRipplePool()
    var flowTime = 0
    var previousPlaybackTime = null
    var drawingBufferSize = new THREE.Vector2()
    var elasticState = Particles.createDioramaParticleElasticState()
    // 1 = 成形，0 = 散开。转场飞行期间下降；相机锁定新场景歌词并保持 FORMATION_SETTLE_SECONDS 后聚合
    var formation = 1
    var lockedSeconds = FORMATION_SETTLE_SECONDS

    // 几何输入缓存（原版 useMemo [mode, clusters, corridorSpans, density]，按引用比较）
    var geomMode = options.mode
    var geomClusters = options.clusters
    var geomSpans = options.corridorSpans
    var geomDensity = options.density
    var lastInputs = { mode: null, clusters: null, spans: null, density: null }

    var group = new THREE.Group()
    var glowPoints = null
    var solidPoints = null

    function rebuildPoints() {
      if (glowPoints) {
        group.remove(glowPoints)
        glowPoints = null
      }
      if (solidPoints) {
        group.remove(solidPoints)
        solidPoints = null
      }
      if (!geometry) return
      solidPoints = new THREE.Points(geometry, material)
      solidPoints.frustumCulled = false
      solidPoints.renderOrder = 4
      group.add(solidPoints)
      if (options.particleGlowEnabled) {
        glowPoints = new THREE.Points(geometry, glowMaterial)
        glowPoints.frustumCulled = false
        glowPoints.renderOrder = 3
        group.add(glowPoints)
      }
    }

    /** 重建缓冲几何与点阵细节上限（原版 built useMemo，引用比较）。 */
    function setGeometry(mode, clusters, corridorSpans, density) {
      if (lastInputs.mode === mode && lastInputs.clusters === clusters
        && lastInputs.spans === corridorSpans && lastInputs.density === density && geometry) return
      lastInputs.mode = mode
      lastInputs.clusters = clusters
      lastInputs.spans = corridorSpans
      lastInputs.density = density
      geomMode = mode
      geomClusters = clusters
      geomSpans = corridorSpans
      geomDensity = density
      if (geometry) geometry.dispose()
      var data = mode === 'corridor'
        ? Particles.buildDioramaCorridorGeometryData(corridorSpans || [], density)
        : Particles.buildDioramaCloudGeometryData(clusters || [], density)
      geometry = Particles.createDioramaBufferGeometry(data)
      waveNumberMax = Particles.resolveWaveNumberMax(data.spacing)
      rebuildPoints()
    }

    /** 对比适配目标色 + 辉光强度（原版 useMemo/useEffect）。 */
    function setColors(primaryColor, accentColor, secondaryColor, backgroundColor, particleGlowEnabled, particleGlowIntensity) {
      var key = primaryColor + '|' + accentColor + '|' + secondaryColor + '|' + backgroundColor
      if (targetColorsKey !== key) {
        targetColorsKey = key
        targetColors = Particles.resolveDioramaParticleContrastColors({
          primary: new THREE.Color(primaryColor),
          accent: new THREE.Color(accentColor),
          secondary: new THREE.Color(secondaryColor)
        }, new THREE.Color(backgroundColor))
      }
      if (options.particleGlowEnabled !== particleGlowEnabled) {
        options.particleGlowEnabled = particleGlowEnabled
        rebuildPoints()
      }
      glowIntensity = particleGlowIntensity
      glowMaterial.uniforms.uGlow.value = glowIntensity
    }

    /** 歌/轮切换：平滑音频态清零重启（原版 useEffect [resetKey]）。 */
    function reset() {
      previousPlaybackTime = null
      elasticState = Particles.createDioramaParticleElasticState()
      ripples = createRipplePool()
      // 新歌有自己的响度；跟踪器重新对新歌整定
      trackers = Particles.RIPPLE_BANDS.map(function () { return Particles.createDioramaBandTracker() })
    }

    /**
     * 每帧更新（原版 useFrame）。
     * ctx: { delta, currentTime, audioBands(0~1), audioLevel, transitionActive, readHeadLine, renderer }
     */
    function update(ctx) {
      var rawDelta = ctx.delta
      var delta = Math.min(rawDelta, 0.1)
      // 共享 0~1 频段（原版 0..255 归一化）。音频响应滑条刻意不在此应用：
      // 它曾把频段乘在 onset 检测之前——信号与参照同缩放，纹波几乎到不了，还饱和频段。
      // 检测保持响度不变；滑条在输出端以 gain 一次性生效。
      var bands01 = ctx.audioBands || { bass: 0, lowMid: 0, mid: 0, treble: 0 }
      var bassTarget = Math.min(1, bands01.bass)
      var midTarget = Math.min(1, (bands01.lowMid * 0.5 + bands01.mid * 0.5))
      var trebleTarget = Math.min(1, bands01.treble)
      var bass = Particles.stepDioramaBandTracker(trackers[0], bassTarget, delta)
      var mid = Particles.stepDioramaBandTracker(trackers[1], midTarget, delta)
      var treble = Particles.stepDioramaBandTracker(trackers[2], trebleTarget, delta)
      var bands = [bass, mid, treble]
      var response = Particles.resolveDioramaParticleAudioResponse(bass, mid)
      // 滑条唯一落点。0 = 完全禁用音频响应；1 = 设计手感；顶格真过载（缩放的是位移）
      var gain = Math.max(0, ctx.audioLevel)

      // 流时间随播放推进（非挂钟）：暂停冻结漂移，seek/循环跳变而非拖影。
      // 低音加速流——音乐驱动世界。
      var playbackTime = Math.max(0, ctx.currentTime)
      var playbackDelta = previousPlaybackTime == null ? 0 : playbackTime - previousPlaybackTime
      var playbackDiscontinuity = previousPlaybackTime == null
        || playbackDelta < -0.05
        || playbackDelta > 0.5
      if (playbackDiscontinuity) {
        flowTime = playbackTime * 0.28
        // 纹波在此时钟上携带诞生时间——seek/循环否则会留下"生于未来"的源
        ripples = createRipplePool()
      } else if (playbackDelta > 0) {
        flowTime += playbackDelta * response.flowSpeed
      }
      previousPlaybackTime = playbackTime

      // 音频 → 几何，唯一交叉点：越过触发的击打催生该频段尺度的一个纹波，之后着色器接管。
      // 触发是带迟滞的上升沿：一次击打一个纹波。
      var pool = ripples
      var isCorridor = geomMode === 'corridor'
      var readHeadAlong = ctx.readHeadLine * CORRIDOR_UNITS_PER_LINE
      if (gain > 0.001) {
        bands.forEach(function (signal, index) {
          if (!signal.onset) return
          spawnRipple(pool, index, signal.transient, flowTime, isCorridor, readHeadAlong)
        })
      }

      // 隧道只留整体脉冲的痕迹：它的运动属于纹波场。云全保——簇随节拍呼吸正是要点。
      var elasticPulse = Particles.stepDioramaParticleElasticResponse(
        elasticState,
        Particles.resolveDioramaPulseTarget(response.clusterPulse, gain, isCorridor),
        delta
      )
      ctx.renderer.getDrawingBufferSize(drawingBufferSize)
      var colorAmount = 1 - Math.exp(-1.2 * delta)

      // 转场飞行期间散开；相机锁定当前歌词并短暂保持后聚合
      lockedSeconds = ctx.transitionActive
        ? 0
        : Math.min(FORMATION_SETTLE_SECONDS, lockedSeconds + delta)
      var formationTarget = !ctx.transitionActive && lockedSeconds >= FORMATION_SETTLE_SECONDS ? 1 : 0
      formation = Particles.stepDioramaEnvelope(formation, formationTarget, 1.5, 3.2, delta)

      // 两种模式的动力学都在纹波强度里，swell 是波到位移的固定换算。
      // 隧道保留底值 + 持续能量的缓升；gain 是滑条的全部作用。
      var amplitude = gain * (isCorridor
        ? Math.min(CORRIDOR_MAX_SWELL, CORRIDOR_QUIET_SWELL + bass.sustained * 0.18 + mid.sustained * 0.08)
        : CLOUD_SWELL)
      var flow = isCorridor ? 1 : 0
      var scatterDistance = isCorridor ? 6 : 1.4
      // 隧道壁上更大更稀疏的点
      var sizeBase = isCorridor ? 0.072 : 0.05
      // 隧道的 swell 少有饱和，pow(d,3) 需更大增益让滚动区域可见地增厚增亮
      var sizeGain = isCorridor ? 0.34 : 0.3
      // 高音驱动的简单亮度代理驱动色板热色偏移（无频谱分析）
      var centroid = Math.min(1, 0.2 + treble.sustained * 0.8)
      var viewportHeight = drawingBufferSize.y

      var targets = [material, glowMaterial]
      for (var ti = 0; ti < targets.length; ti += 1) {
        var u = targets[ti].uniforms
        u.uTime.value = flowTime
        u.uCorridor.value = isCorridor ? 1 : 0
        u.uAmplitude.value = amplitude
        u.uMaxSwell.value = isCorridor ? CORRIDOR_MAX_SWELL_REACH : CLOUD_MAX_SWELL
        u.uWaveNumberMax.value = waveNumberMax
        // 持续高音决定多少细纹理骑在波峰上。着色器按已有 swell 门控。
        u.uDetail.value = Math.min(1, treble.sustained * gain)
        u.uRippleSource.value = pool.sources
        u.uRippleShape.value = pool.shapes
        u.uOffsetGain.value = mid.sustained * gain
        u.uFlow.value = flow
        u.uFormation.value = formation
        u.uScatter.value = scatterDistance
        u.uSizeBase.value = sizeBase
        u.uSizeGain.value = sizeGain
        u.uPulse.value = elasticPulse
        u.uSpectralCentroid.value = centroid
        u.uViewportHeight.value = viewportHeight
        Particles.lerpDioramaParticleMaterialColors(targets[ti], targetColors, colorAmount)
      }
    }

    function dispose() {
      if (geometry) geometry.dispose()
      material.dispose()
      glowMaterial.dispose()
      group.clear()
    }

    setGeometry(options.mode, options.clusters, options.corridorSpans, options.density)
    setColors(options.primaryColor, options.accentColor, options.secondaryColor, options.backgroundColor,
      options.particleGlowEnabled, options.particleGlowIntensity)

    return {
      group: group,
      setGeometry: setGeometry,
      setColors: setColors,
      reset: reset,
      update: update,
      dispose: dispose
    }
  }

  window.FoliaDioramaField = {
    createDioramaParticleField: createDioramaParticleField
  }
})()
