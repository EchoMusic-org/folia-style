// 商籁模式·文本视图层：移植自 folia-major
//   sonnet/sonnetIcons.ts（主题图标名校验 + 可缓存 SVG data URL；lucide-react 渲染改为内联路径表）
//   sonnet/sonnetTexturePool.ts（跨运行时重建的引用计数 Pixi 资源池）
//   sonnet/sonnetGuides.ts（文字到达前的短命语义引导曲线与定位标记）
//   sonnet/sonnetFrameDecor.ts（确定性 30% 段落的装饰开框）
//   sonnet/sonnetStaffNotation.ts + sonnetStaffView.ts（La Folia 五线谱视图）
//   sonnet/sonnetTextViewBuilder.ts（解析器时序的核心/辉光字形对与语义引导视图）
(function () {
  'use strict'

  var Core = window.FoliaSonnetCore
  var hashSonnetSeed = Core.hashSonnetSeed
  var Typography = window.FoliaSonnetTypography
  var Mg = window.FoliaSonnetMg

  // ---------- 图标（原版 sonnetIcons.ts；lucide 图标以内联 SVG 路径表提供） ----------
  // 插件主题的 lyricsIcons 恒为空数组，因此实际只使用回退的 'Flower'；
  // 内置常用 lucide 图标路径以便未来主题携带图标时保持一致观感。
  var LUCIDE_ICON_PATHS = {
    flower: '<circle cx="12" cy="12" r="3"/><path d="M12 16.5A4.5 4.5 0 1 1 7.5 12 4.5 4.5 0 1 1 12 7.5a4.5 4.5 0 1 1 4.5 4.5 4.5 4.5 0 1 1-4.5 4.5"/><path d="M12 7.5V9"/><path d="M7.5 12H9"/><path d="M16.5 12H15"/><path d="M12 16.5V15"/>',
    heart: '<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>',
    star: '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>',
    moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>',
    music: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
    sparkles: '<path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/><path d="M20 3v4"/><path d="M22 5h-4"/><path d="M4 17v2"/><path d="M5 18H3"/>',
    leaf: '<path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z"/><path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12"/>',
    snowflake: '<line x1="2" x2="22" y1="12" y2="12"/><line x1="12" x2="12" y1="2" y2="22"/><path d="m20 16-4-4 4-4"/><path d="m4 8 4 4-4 4"/><path d="m16 4-4 4-4-4"/><path d="m8 20 4-4 4 4"/>',
    flame: '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>',
    zap: '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>',
    ghost: '<path d="M9 10h.01"/><path d="M15 10h.01"/><path d="M12 2a8 8 0 0 0-8 8v12l3-3 2.5 2.5L12 19l2.5 2.5L17 19l3 3V10a8 8 0 0 0-8-8z"/>',
    cloud: '<path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/>',
    bird: '<path d="M16 7h.01"/><path d="M3.4 18H12a8 8 0 0 0 8-8V7a4 4 0 0 0-7.28-2.3L2 20"/><path d="m20 7 2 .5-2 .5"/><path d="M10 18v3"/><path d="M14 17.75V21"/><path d="M7 18a6 6 0 0 0 3.84-10.61"/>'
  }

  function resolveSonnetIconNames(names) {
    var seen = {}
    var resolved = []
    ;(names || []).forEach(function (name) {
      if (typeof name !== 'string') return
      var lucideName = LUCIDE_ICON_PATHS[name.toLowerCase()] ? name.toLowerCase() : null
      if (!lucideName || seen[lucideName]) return
      seen[lucideName] = true
      resolved.push(lucideName)
    })
    return resolved.length > 0 ? resolved : ['flower']
  }

  // 把图标粒子散布进场景，同时保证每个可用主题图标都被用到
  function buildSonnetIconParticleIndices(iconCount, particleCount, seed) {
    var safeIconCount = Math.max(0, Math.floor(iconCount))
    var safeParticleCount = Math.max(0, Math.floor(particleCount))
    if (safeIconCount === 0) {
      var empty = []
      for (var e = 0; e < safeParticleCount; e += 1) empty.push(null)
      return empty
    }

    var iconParticleCount = Math.min(
      safeParticleCount,
      Math.max(Math.ceil(safeParticleCount / 4), safeIconCount)
    )
    var emittedIconCount = 0
    var out = []
    for (var index = 0; index < safeParticleCount; index += 1) {
      var previousBand = Math.floor(index * iconParticleCount / safeParticleCount)
      var currentBand = Math.floor((index + 1) * iconParticleCount / safeParticleCount)
      if (currentBand === previousBand) {
        out.push(null)
        continue
      }
      var iconIndex = ((seed + emittedIconCount) % safeIconCount + safeIconCount) % safeIconCount
      emittedIconCount += 1
      out.push(iconIndex)
    }
    return out
  }

  // 把图标起点分散到 shot 的大部分区间，同时为最终揭示保留时间
  function resolveSonnetIconEntryPhase(index, iconCount) {
    var safeCount = Math.max(0, Math.floor(iconCount))
    if (safeCount <= 1) return 0.12
    var safeIndex = Math.min(safeCount - 1, Math.max(0, Math.floor(index)))
    return 0.04 + (safeIndex / (safeCount - 1)) * 0.82
  }

  function resolveSonnetIconEntryDuration(sceneDuration, preferredDuration) {
    var safeSceneDuration = Math.max(0.01, sceneDuration)
    return Math.min(
      Math.max(0.01, preferredDuration),
      Math.max(0.08, safeSceneDuration * 0.18),
      safeSceneDuration
    )
  }

  function resolveSonnetIconEntryDelay(entryPhase, sceneDuration, entryDuration) {
    return Math.min(1, Math.max(0, entryPhase)) * Math.max(0, sceneDuration - entryDuration)
  }

  function buildSonnetIconTextureKey(name, color, strokeWidth, size, resolution) {
    return name + '|' + color + '|' + strokeWidth + '|' + size + '|' + resolution
  }

  function buildSonnetIconDataUrl(name, color, strokeWidth, size) {
    var paths = LUCIDE_ICON_PATHS[name]
    if (!paths) return null
    // 复刻 lucide 的静态 SVG 输出（absoluteStrokeWidth: stroke-width 不随尺寸缩放）
    var markup = '<svg xmlns="http://www.w3.org/2000/svg" width="' + size + '" height="' + size
      + '" viewBox="0 0 24 24" fill="none" stroke="' + color
      + '" stroke-width="' + strokeWidth + '" stroke-linecap="round" stroke-linejoin="round">'
      + paths + '</svg>'
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(markup)
  }

  // ---------- 纹理池（原版 sonnetTexturePool.ts） ----------
  function SonnetTexturePool(load, unload, unloadDelayMs) {
    if (unloadDelayMs === undefined) unloadDelayMs = 750
    this.load = load
    this.unload = unload
    this.unloadDelayMs = unloadDelayMs
    this.entries = new Map()
  }

  SonnetTexturePool.prototype.acquire = function (url) {
    var self = this
    var entry = this.entries.get(url)
    if (!entry) {
      entry = { refs: 0, promise: this.load(url), unloadTimer: null }
      this.entries.set(url, entry)
    }
    entry.refs += 1
    if (entry.unloadTimer) {
      clearTimeout(entry.unloadTimer)
      entry.unloadTimer = null
    }
    return entry.promise.then(
      function (value) { return value },
      function (error) {
        if (self.entries.get(url) === entry) self.entries.delete(url)
        throw error
      }
    )
  }

  SonnetTexturePool.prototype.release = function (url) {
    var self = this
    var entry = this.entries.get(url)
    if (!entry) return
    entry.refs = Math.max(0, entry.refs - 1)
    if (entry.refs > 0 || entry.unloadTimer) return
    entry.unloadTimer = setTimeout(function () {
      if (entry.refs > 0 || self.entries.get(url) !== entry) return
      self.entries.delete(url)
      Promise.resolve(self.unload(url)).catch(function () { return undefined })
    }, this.unloadDelayMs)
  }

  var pixiPools = new WeakMap()

  function getSonnetTexturePool(pixi) {
    var assets = pixi.Assets
    var cached = pixiPools.get(assets)
    if (cached) return cached
    var pool = new SonnetTexturePool(
      function (url) { return pixi.Assets.load(url) },
      function (url) { return pixi.Assets.unload(url) }
    )
    pixiPools.set(assets, pool)
    return pool
  }

  // ---------- 语义引导（原版 sonnetGuides.ts） ----------
  function colorNumber(pixi, color) {
    return pixi.Color.shared.setValue(color).toNumber()
  }

  function resolveSonnetGuideCue(segment, textStartTime) {
    if (textStartTime === undefined) textStartTime = segment.startTime
    var leadDuration = Math.min(
      0.38,
      Math.max(0.2, 0.18 + (segment.endTime - segment.startTime) * 0.1)
    )
    return {
      startTime: textStartTime - leadDuration,
      endTime: textStartTime + 0.65 // 延长时长让装饰爆散与曲线淡出完成
    }
  }

  function createSonnetGuide(pixi, segment, placement, theme, fontSize, textStartTime) {
    if (textStartTime === undefined) textStartTime = segment.startTime
    var container = new pixi.Container()
    var graphics = new pixi.Graphics()

    // 几何装饰容器
    var shapesContainer = new pixi.Container()

    var isHero = Typography.isSonnetEmphasisRole(placement.role)
    var fallbackDirection = placement.timingPhase < 0.5 ? -1 : 1
    var startX = placement.enterX || fallbackDirection * fontSize * 1.8
    var startY = placement.enterY || -fontSize * 0.9

    var color = colorNumber(pixi, isHero ? theme.accentColor : theme.secondaryColor)

    var strokeProps = {
      color: color,
      width: isHero ? 1.8 : 1,
      alpha: isHero ? 0.82 : 0.55
    }

    // 三次贝塞尔控制点
    var p0 = { x: startX, y: startY }
    var p1 = { x: startX * 0.6, y: startY * 0.4 }
    var p2 = { x: startX * 0.2, y: startY * 0.1 }
    var p3 = { x: 0, y: 0 }

    var getBezier = function (p_0, p_1, p_2, p_3, t) {
      var mt = 1 - t
      return {
        x: mt * mt * mt * p_0.x + 3 * mt * mt * t * p_1.x + 3 * mt * t * t * p_2.x + t * t * t * p_3.x,
        y: mt * mt * mt * p_0.y + 3 * mt * mt * t * p_1.y + 3 * mt * t * t * p_2.y + t * t * t * p_3.y
      }
    }

    // 随机小几何形状
    var numShapes = isHero ? 6 : 3
    var shapeData = []

    for (var i = 0; i < numShapes; i++) {
      var shape = new pixi.Graphics()
      var type = Math.floor(Math.random() * 4)
      var size = (isHero ? 3 : 1.5) + Math.random() * 3.5
      var sAlpha = isHero ? 0.8 : 0.6

      if (type === 0) {
        shape.circle(0, 0, size).fill({ color: color, alpha: sAlpha })
      } else if (type === 1) {
        shape.rect(-size, -size, size * 2, size * 2).fill({ color: color, alpha: sAlpha })
      } else if (type === 2) {
        shape.moveTo(-size, 0).lineTo(size, 0).moveTo(0, -size).lineTo(0, size).stroke({ color: color, width: 2, alpha: sAlpha })
      } else {
        shape.moveTo(0, -size).lineTo(size, 0).lineTo(0, size).lineTo(-size, 0).fill({ color: color, alpha: sAlpha })
      }

      shapesContainer.addChild(shape)
      shapeData.push({
        obj: shape,
        angle: Math.random() * Math.PI * 2,
        speed: (15 + Math.random() * 45) * (isHero ? 1 : 0.7),
        rotSpeed: (Math.random() - 0.5) * 8
      })
    }

    // 环绕文字的近距丝绸轨迹
    var trackingTrails = []
    if (isHero || Math.random() > 0.4) {
      // 线 1：穿行文字的紧致 S 曲线
      var d = Math.random() > 0.5 ? 1 : -1
      var yOffset = (Math.random() - 0.5) * fontSize * 0.8
      trackingTrails.push({
        p0: { x: -d * fontSize * 2.5, y: yOffset + fontSize * 1.5 },
        p1: { x: -d * fontSize * 0.8, y: yOffset - fontSize * 2.0 },
        p2: { x: d * fontSize * 0.8, y: yOffset + fontSize * 2.0 },
        p3: { x: d * fontSize * 2.5, y: yOffset - fontSize * 1.5 },
        delay: Math.random() * 0.15
      })
    }
    if (isHero || Math.random() > 0.6) {
      // 线 2：包裹文字的紧致交叉环（缎带）
      var d2 = Math.random() > 0.5 ? 1 : -1
      trackingTrails.push({
        p0: { x: -fontSize * 2.0, y: -d2 * fontSize * 1.8 },
        p1: { x: fontSize * 2.0, y: d2 * fontSize * 1.8 },
        p2: { x: -fontSize * 2.0, y: d2 * fontSize * 1.8 },
        p3: { x: fontSize * 2.0, y: -d2 * fontSize * 1.8 },
        delay: Math.random() * 0.1
      })
    }
    // 生长的矩形样条（现代 HUD 风格）
    var rectSpline = null
    if (Math.random() > 0.4) {
      var length = fontSize * (1.2 + Math.random() * 1.5)
      var thickness = (isHero ? 6 : 3) + Math.random() * 8
      var angle = (Math.random() - 0.5) * Math.PI // 随机角度
      var rx = (Math.random() - 0.5) * fontSize * 1.2
      var ry = (Math.random() - 0.5) * fontSize * 1.2
      rectSpline = {
        p0: { x: rx, y: ry },
        p1: { x: rx + Math.cos(angle) * length, y: ry + Math.sin(angle) * length },
        thickness: thickness,
        delay: Math.random() * 0.15,
        duration: 0.25 + Math.random() * 0.2
      }
    }

    container.addChild(graphics, shapesContainer)
    container.position.set(placement.x, placement.y)
    container.alpha = 0

    var cue = resolveSonnetGuideCue(segment, textStartTime)

    var update = function (progress) {
      // 曲线 0~0.35 快速绘入，0.4~0.7 淡出
      var drawProgress = Math.min(1, Math.max(0, progress / 0.35))
      var fadeOut = 1 - Math.min(1, Math.max(0, (progress - 0.4) / 0.3))

      graphics.clear()
      if (drawProgress > 0 && fadeOut > 0) {
        var steps = 20
        var prevP = p0
        for (var s = 1; s <= steps; s++) {
          // 星轨观感：绘制带衰减的锥形尾巴
          var t = (s / steps) * drawProgress
          var p = getBezier(p0, p1, p2, p3, t)
          var intensity = Math.pow(s / steps, 2) // 二次曲线：尾部 0，头部 1

          var segmentAlpha = Math.min(1, intensity * strokeProps.alpha * fadeOut * 1.6)
          var segmentWidth = (isHero ? 2.5 : 1.5) + intensity * (isHero ? 5.0 : 3.0)

          graphics.moveTo(prevP.x, prevP.y)
          graphics.lineTo(p.x, p.y)
          graphics.stroke({ color: color, width: segmentWidth, alpha: segmentAlpha })
          prevP = p
        }

        // 星头（核心 + 辉光），更醒目
        var head = getBezier(p0, p1, p2, p3, drawProgress)
        graphics.circle(head.x, head.y, isHero ? 14 : 9).fill({ color: color, alpha: 0.5 * fadeOut })
        graphics.circle(head.x, head.y, isHero ? 4.5 : 3).fill({ color: 0xffffff, alpha: 1 * fadeOut })
      }

      // 音游风格的丝线轨迹
      trackingTrails.forEach(function (trail) {
        var localProg = (progress - trail.delay) / 0.55
        if (localProg > -0.15 && fadeOut > 0) {
          // 头尾扫动而不提前绘制完整轨迹
          if (localProg > 0 && localProg < 1.3) {
            var headT = Math.min(1, localProg)
            var tailT = Math.max(0, localProg - 0.35) // 彗尾长度

            if (headT > tailT) {
              var steps2 = 25
              var prevP2 = getBezier(trail.p0, trail.p1, trail.p2, trail.p3, tailT)

              for (var k = 1; k <= steps2; k++) {
                var stepT = tailT + (k / steps2) * (headT - tailT)
                var pos = getBezier(trail.p0, trail.p1, trail.p2, trail.p3, stepT)
                var intensity2 = Math.pow(k / steps2, 2)
                var alpha = intensity2 * strokeProps.alpha * fadeOut * 0.9
                var width = (isHero ? 2 : 1) + intensity2 * (isHero ? 5 : 2.5)

                graphics.moveTo(prevP2.x, prevP2.y)
                graphics.lineTo(pos.x, pos.y)
                graphics.stroke({ color: color, width: width, alpha: alpha })
                prevP2 = pos
              }
            }

            // 发光头与跟随圆
            if (headT > 0 && headT < 1) {
              var headPos = getBezier(trail.p0, trail.p1, trail.p2, trail.p3, headT)
              graphics.circle(headPos.x, headPos.y, isHero ? 7 : 4).fill({ color: color, alpha: 0.9 * fadeOut })
              graphics.circle(headPos.x, headPos.y, isHero ? 2.5 : 1.5).fill({ color: 0xffffff, alpha: 1 * fadeOut })

              // 音游感的外圈"跟随圆"辉光
              graphics.circle(headPos.x, headPos.y, isHero ? 20 : 12).stroke({ color: color, width: isHero ? 2 : 1, alpha: 0.4 * fadeOut })
            }
          }
        }
      })

      // 矩形样条（现代 HUD 风格）
      if (rectSpline) {
        var localProg2 = (progress - rectSpline.delay) / rectSpline.duration
        if (localProg2 > 0 && localProg2 < 1.3 && fadeOut > 0) {
          // 生长相：头从 p0 移向 p1
          var headT2 = Math.min(1, Math.max(0, localProg2 * 1.5))
          // 收缩相：尾从 p0 移向 p1，落后于头
          var tailT2 = Math.min(1, Math.max(0, (localProg2 - 0.3) * 1.5))

          if (headT2 > tailT2) {
            var hx = rectSpline.p0.x + (rectSpline.p1.x - rectSpline.p0.x) * headT2
            var hy = rectSpline.p0.y + (rectSpline.p1.y - rectSpline.p0.y) * headT2
            var tx = rectSpline.p0.x + (rectSpline.p1.x - rectSpline.p0.x) * tailT2
            var ty = rectSpline.p0.y + (rectSpline.p1.y - rectSpline.p0.y) * tailT2

            graphics.moveTo(tx, ty)
            graphics.lineTo(hx, hy)
            graphics.stroke({ color: color, width: rectSpline.thickness, alpha: strokeProps.alpha * fadeOut * 0.7 })

            // 明亮的内核
            graphics.moveTo(tx, ty)
            graphics.lineTo(hx, hy)
            graphics.stroke({ color: 0xffffff, width: rectSpline.thickness * 0.3, alpha: strokeProps.alpha * fadeOut * 0.9 })
          }
        }
      }

      // 文字开始落定（progress ~ 0.3）时形状向外爆散
      var burstProgress = Math.min(1, Math.max(0, (progress - 0.3) / 0.7))
      shapeData.forEach(function (s2) {
        var ease = 1 - Math.pow(1 - burstProgress, 3) // 缓出
        s2.obj.x = p3.x + Math.cos(s2.angle) * s2.speed * ease
        s2.obj.y = p3.y + Math.sin(s2.angle) * s2.speed * ease
        s2.obj.rotation = s2.rotSpeed * burstProgress
        s2.obj.alpha = (1 - burstProgress) * (isHero ? 1 : 0.8)
        s2.obj.scale.set(1 - burstProgress * 0.4)
      })
    }

    return {
      container: container,
      startTime: cue.startTime,
      endTime: cue.endTime,
      maxAlpha: isHero ? 0.95 : 0.7,
      update: update
    }
  }

  // ---------- 帧装饰（原版 sonnetFrameDecor.ts） ----------
  var SONNET_FRAME_DECOR_PROBABILITY = 0.4
  var SONNET_FRAME_DECOR_VARIANTS = 4

  // 每段的确定性选择，保证 seek 与重放得到相同的框
  function resolveSonnetFrameDecorSpec(segment) {
    var hash = hashSonnetSeed([
      segment.text,
      segment.startOffset,
      segment.endOffset,
      'frame-decor'
    ].join(':'))
    return {
      applied: (hash & 1023) / 1024 < SONNET_FRAME_DECOR_PROBABILITY,
      variant: (hash >>> 10) % SONNET_FRAME_DECOR_VARIANTS
    }
  }

  // 把文字颜色调暗，让框读作安静的次级图层
  function dimmedColor(pixi, color, multiplier) {
    var base = pixi.Color.shared.setValue(color).toNumber()
    var r = Math.round(((base >> 16) & 255) * multiplier)
    var g = Math.round(((base >> 8) & 255) * multiplier)
    var b = Math.round((base & 255) * multiplier)
    return (r << 16) | (g << 8) | b
  }

  function resolveCorners(geometry) {
    return [
      { x: -geometry.halfW, y: -geometry.halfH, sx: -1, sy: -1 },
      { x: geometry.halfW, y: -geometry.halfH, sx: 1, sy: -1 },
      { x: geometry.halfW, y: geometry.halfH, sx: 1, sy: 1 },
      { x: -geometry.halfW, y: geometry.halfH, sx: -1, sy: 1 }
    ]
  }

  // 从每个角起顺时针到下一角，按角缺口内缩，轮廓刻意不闭合
  function resolveSideEnds(geometry, corners, side) {
    var from = corners[side]
    var to = corners[(side + 1) % 4]
    var insetX = to.x === from.x ? 0 : geometry.cornerGap * (to.x > from.x ? 1 : -1)
    var insetY = to.y === from.y ? 0 : geometry.cornerGap * (to.y > from.y ? 1 : -1)
    return {
      startX: from.x + insetX,
      startY: from.y + insetY,
      endX: to.x - insetX,
      endY: to.y - insetY
    }
  }

  // 还原框容器施加旋转之前的本地文字尺寸
  function resolveSonnetFrameLocalDimensions(placement) {
    var quarterTurns = Math.round(placement.rotation / (Math.PI / 2))
    var snappedRotation = quarterTurns * (Math.PI / 2)
    var isOddQuarterTurn = (
      Math.abs(placement.rotation - snappedRotation) < 1e-6
      && Math.abs(quarterTurns % 2) === 1
    )

    return isOddQuarterTurn
      ? { width: placement.measuredHeight, height: placement.measuredWidth }
      : { width: placement.measuredWidth, height: placement.measuredHeight }
  }

  function buildSonnetFrameDecor(pixi, options) {
    if (options.placement.role === 'decoration') return null
    var spec = resolveSonnetFrameDecorSpec(options.segment)
    if (!spec.applied) return null

    var placement = options.placement
    var fontSize = options.fontSize
    var clampRange = function (value, min, max) { return Math.min(max, Math.max(min, value)) }

    var pad = clampRange(fontSize * 0.22, 8, 20)
    var frameDimensions = resolveSonnetFrameLocalDimensions(placement)
    var geometry = {
      halfW: frameDimensions.width / 2 + pad,
      halfH: frameDimensions.height / 2 + pad,
      cornerGap: 0,
      pad: pad
    }
    geometry.cornerGap = clampRange(
      Math.min(geometry.halfW, geometry.halfH) * (spec.variant === 1 ? 0.42 : 0.3),
      6,
      30
    )

    var color = dimmedColor(pixi, options.theme.primaryColor, 0.55)
    var corners = resolveCorners(geometry)
    var container = new pixi.Container()
    container.position.set(placement.x, placement.y)
    container.rotation = placement.rotation
    var graphics = new pixi.Graphics()
    container.addChild(graphics)
    container.alpha = 0

    var strokeWidth = clampRange(fontSize * 0.03, 1.2, 2.2)

    // 顺时针描绘四条边，每条边在各自窗口内生长
    var traceSides = function (eased, dashed) {
      for (var side = 0; side < 4; side++) {
        var sideProgress = Core.clamp01((eased - side * 0.2) / 0.4)
        if (sideProgress <= 0) continue
        var sideEnds = resolveSideEnds(geometry, corners, side)
        var tipX = sideEnds.startX + (sideEnds.endX - sideEnds.startX) * sideProgress
        var tipY = sideEnds.startY + (sideEnds.endY - sideEnds.startY) * sideProgress
        if (!dashed) {
          graphics.moveTo(sideEnds.startX, sideEnds.startY).lineTo(tipX, tipY)
            .stroke({ color: color, width: strokeWidth, alpha: 0.85 })
          continue
        }
        // 虚线变体：只绘制完全位于描绘尖端之内的虚线段
        var sideLength = Math.hypot(sideEnds.endX - sideEnds.startX, sideEnds.endY - sideEnds.startY)
        if (sideLength < 1) continue
        var ux = (sideEnds.endX - sideEnds.startX) / sideLength
        var uy = (sideEnds.endY - sideEnds.startY) / sideLength
        var dash = clampRange(fontSize * 0.14, 5, 8)
        var gap = dash * 0.7
        var traced = sideLength * sideProgress
        for (var offset = 0; offset + dash <= traced + 0.001; offset += dash + gap) {
          graphics
            .moveTo(sideEnds.startX + ux * offset, sideEnds.startY + uy * offset)
            .lineTo(sideEnds.startX + ux * (offset + dash), sideEnds.startY + uy * (offset + dash))
            .stroke({ color: color, width: strokeWidth, alpha: 0.85 })
        }
      }
    }

    var ornamentProgress = function (eased, corner) {
      return Core.easeSonnetElasticOut(Core.clamp01((eased - 0.35 - corner * 0.14) / 0.3))
    }

    // 变体 0：位于每角外侧的裁切标记刻度
    var drawCornerTicks = function (eased) {
      var arm = clampRange(pad * 0.8, 5, 12)
      var offset = 3
      corners.forEach(function (corner, index) {
        var op = ornamentProgress(eased, index)
        if (op <= 0.02) return
        var innerX = corner.x + corner.sx * offset
        var innerY = corner.y + corner.sy * offset
        graphics
          .moveTo(innerX + corner.sx * arm * op, innerY)
          .lineTo(innerX, innerY)
          .lineTo(innerX, innerY + corner.sy * arm * op)
          .stroke({ color: color, width: strokeWidth, alpha: 0.9 * Math.min(1, op) })
      })
    }

    // 变体 1：每个角落绽放的四瓣花
    var drawCornerFlowers = function (eased) {
      var radius = clampRange(pad * 0.55, 4, 9)
      corners.forEach(function (corner, index) {
        var op = ornamentProgress(eased, index)
        if (op <= 0.02) return
        var petal = radius * 0.44 * op
        graphics.circle(corner.x - radius, corner.y, petal).fill({ color: color, alpha: 0.8 })
        graphics.circle(corner.x + radius, corner.y, petal).fill({ color: color, alpha: 0.8 })
        graphics.circle(corner.x, corner.y - radius, petal).fill({ color: color, alpha: 0.8 })
        graphics.circle(corner.x, corner.y + radius, petal).fill({ color: color, alpha: 0.8 })
        graphics.circle(corner.x, corner.y, radius * 0.3 * op).fill({ color: 0xffffff, alpha: 0.5 })
      })
    }

    // 变体 2：嵌套直角括号 + 每边中点的菱形
    var drawBrackets = function (eased) {
      var arm = clampRange(pad, 6, 14)
      var offset = 2.5
      corners.forEach(function (corner, index) {
        var op = ornamentProgress(eased, index)
        if (op <= 0.02) return
        var innerX = corner.x + corner.sx * offset
        var innerY = corner.y + corner.sy * offset
        graphics
          .moveTo(innerX + corner.sx * arm * op, innerY)
          .lineTo(innerX, innerY)
          .lineTo(innerX, innerY + corner.sy * arm * op)
          .stroke({ color: color, width: strokeWidth * 1.4, alpha: 0.9 })
        graphics
          .moveTo(innerX + corner.sx * (arm * op + 4), innerY + corner.sy * 4)
          .lineTo(innerX + corner.sx * 4, innerY + corner.sy * 4)
          .lineTo(innerX + corner.sx * 4, innerY + corner.sy * (arm * op + 4))
          .stroke({ color: color, width: strokeWidth * 0.8, alpha: 0.5 })
      })
      var diamond = clampRange(pad * 0.45, 3.5, 7)
      for (var side = 0; side < 4; side++) {
        var op2 = ornamentProgress(eased, side)
        if (op2 <= 0.02) continue
        var sideEnds = resolveSideEnds(geometry, corners, side)
        var midX = (sideEnds.startX + sideEnds.endX) / 2
        var midY = (sideEnds.startY + sideEnds.endY) / 2
        var size = diamond * op2
        graphics
          .poly([midX, midY - size, midX + size, midY, midX, midY + size, midX - size, midY])
          .fill({ color: color, alpha: 0.85 })
      }
    }

    // 变体 3：每个角落向外斜指的小三角
    var drawCornerTriangles = function (eased) {
      var size = clampRange(pad * 0.6, 4, 9)
      var offset = 2
      corners.forEach(function (corner, index) {
        var op = ornamentProgress(eased, index)
        if (op <= 0.02) return
        var diagX = corner.sx / Math.SQRT2
        var diagY = corner.sy / Math.SQRT2
        var perpX = corner.sy / Math.SQRT2
        var perpY = -corner.sx / Math.SQRT2
        var tipX = corner.x + diagX * (offset + size * op)
        var tipY = corner.y + diagY * (offset + size * op)
        var baseX = corner.x + diagX * offset
        var baseY = corner.y + diagY * offset
        var half = size * 0.7 * op
        graphics
          .poly([
            tipX, tipY,
            baseX + perpX * half, baseY + perpY * half,
            baseX - perpX * half, baseY - perpY * half
          ])
          .fill({ color: color, alpha: 0.85 })
        graphics.circle(corner.x, corner.y, strokeWidth).fill({ color: color, alpha: 0.9 })
      })
    }

    // 按动画进度重绘框；纯函数，seek 安全
    var update = function (progress) {
      var eased = Core.easeSonnetExpoOut(Core.clamp01(progress))
      graphics.clear()
      container.alpha = eased <= 0 ? 0 : 1
      if (eased <= 0) return
      traceSides(eased, spec.variant === 3)
      if (spec.variant === 0) drawCornerTicks(eased)
      else if (spec.variant === 1) drawCornerFlowers(eased)
      else if (spec.variant === 2) drawBrackets(eased)
      else drawCornerTriangles(eased)
    }

    var growDuration = Typography.resolveSonnetGlyphMotionDuration({
      startTime: options.shotStartTime,
      endTime: options.shotEndTime
    }) * 1.25
    var startTime = options.firstGlyphStartTime
    return {
      container: container,
      startTime: startTime,
      endTime: startTime + growDuration,
      update: update
    }
  }

  // ---------- 五线谱记谱（原版 sonnetStaffNotation.ts） ----------
  // La Folia 的公有领域 D 小调主题，自 3/4 拍 LilyPond 记谱转录
  var LA_FOLIA_STAFF_NOTES = [
    { pitch: 'D5', staffStep: 6, beats: 1 },
    { pitch: 'D5', staffStep: 6, beats: 1.5 },
    { pitch: 'E5', staffStep: 7, beats: 0.5 },
    { pitch: 'C#5', staffStep: 5, beats: 1, accidental: 'sharp' },
    { pitch: 'C#5', staffStep: 5, beats: 1, accidental: 'sharp' },
    { pitch: 'C#5', staffStep: 5, beats: 1, accidental: 'sharp' },
    { pitch: 'D5', staffStep: 6, beats: 1 },
    { pitch: 'D5', staffStep: 6, beats: 1.5 },
    { pitch: 'D5', staffStep: 6, beats: 0.5 },
    { pitch: 'E5', staffStep: 7, beats: 1 },
    { pitch: 'E5', staffStep: 7, beats: 1 },
    { pitch: 'E5', staffStep: 7, beats: 1 },
    { pitch: 'F5', staffStep: 8, beats: 1 },
    { pitch: 'F5', staffStep: 8, beats: 1.5 },
    { pitch: 'F5', staffStep: 8, beats: 0.5 },
    { pitch: 'E5', staffStep: 7, beats: 1 },
    { pitch: 'E5', staffStep: 7, beats: 1 },
    { pitch: 'E5', staffStep: 7, beats: 1 },
    { pitch: 'D5', staffStep: 6, beats: 1 },
    { pitch: 'D5', staffStep: 6, beats: 1.5 },
    { pitch: 'C#5', staffStep: 5, beats: 0.5, accidental: 'sharp' },
    { pitch: 'D5', staffStep: 6, beats: 3 }
  ]

  var LA_FOLIA_TOTAL_BEATS = LA_FOLIA_STAFF_NOTES.reduce(function (total, note) { return total + note.beats }, 0)
  var LA_FOLIA_CYCLE_SECONDS = 8

  // ---------- 五线谱视图（原版 sonnetStaffView.ts） ----------
  function positiveModulo(value, divisor) {
    return ((value % divisor) + divisor) % divisor
  }

  function buildSonnetStaffView(pixi, placement, theme, baseFontSize, shotStartTime, width, containerLayer) {
    var wrapper = new pixi.Container()
    wrapper.rotation = placement.rotation
    wrapper.position.set(placement.x, placement.y)
    wrapper.alpha = 0

    var staffWidth = Math.max(300, width * 0.6)
    var lineSpacing = baseFontSize * 0.25
    var totalHeight = lineSpacing * 4
    var halfWidth = staffWidth / 2
    var halfHeight = totalHeight / 2
    var playableWidth = staffWidth * 0.92
    var beatWidth = playableWidth / LA_FOLIA_TOTAL_BEATS
    var timedNotes = []
    var beatCursor = 0
    LA_FOLIA_STAFF_NOTES.forEach(function (note) {
      var timed = { pitch: note.pitch, staffStep: note.staffStep, beats: note.beats, startBeat: beatCursor }
      if (note.accidental) timed.accidental = note.accidental
      timedNotes.push(timed)
      beatCursor += note.beats
    })

    var primaryColor = pixi.Color.shared.setValue(theme.primaryColor).toNumber()
    var accentColor = pixi.Color.shared.setValue(theme.accentColor).toNumber()

    var staffGraphics = new pixi.Graphics()

    // 绘制 5 条谱线
    for (var i = 0; i < 5; i++) {
      var y = -halfHeight + i * lineSpacing
      staffGraphics.moveTo(-halfWidth, y)
      staffGraphics.lineTo(halfWidth, y)
    }
    staffGraphics.stroke({ color: primaryColor, width: 2, alpha: 0.3 })

    // 音符独立循环时保持书写的 3/4 小节结构可见
    for (var bar = 1; bar < 8; bar += 1) {
      var x = -playableWidth / 2 + beatWidth * bar * 3
      staffGraphics.moveTo(x, -halfHeight)
      staffGraphics.lineTo(x, halfHeight)
    }
    staffGraphics.stroke({ color: primaryColor, width: 1, alpha: 0.16 })

    // 装饰性谱号/小节线
    staffGraphics.moveTo(-halfWidth + 10, -halfHeight)
    staffGraphics.lineTo(-halfWidth + 10, halfHeight)
    staffGraphics.stroke({ color: primaryColor, width: 4, alpha: 0.5 })

    staffGraphics.moveTo(halfWidth - 10, -halfHeight)
    staffGraphics.lineTo(halfWidth - 10, halfHeight)
    staffGraphics.stroke({ color: primaryColor, width: 2, alpha: 0.5 })
    staffGraphics.moveTo(halfWidth - 4, -halfHeight)
    staffGraphics.lineTo(halfWidth - 4, halfHeight)
    staffGraphics.stroke({ color: primaryColor, width: 6, alpha: 0.5 })

    var noteGraphics = new pixi.Graphics()
    wrapper.addChild(staffGraphics, noteGraphics)

    containerLayer.addChild(wrapper)

    // 绘制固定的 La Folia 乐句并按普通时间循环推进播放游标
    var updateAnimation = function (time) {
      var cycleElapsed = positiveModulo(time - shotStartTime, LA_FOLIA_CYCLE_SECONDS)
      var beatPosition = (cycleElapsed / LA_FOLIA_CYCLE_SECONDS) * LA_FOLIA_TOTAL_BEATS
      var cursorX = -playableWidth / 2 + beatWidth * beatPosition

      noteGraphics.clear()
      noteGraphics.moveTo(cursorX, -halfHeight - lineSpacing * 0.8)
      noteGraphics.lineTo(cursorX, halfHeight + lineSpacing * 0.8)
      noteGraphics.stroke({ color: accentColor, width: 1.5, alpha: 0.34 })

      timedNotes.forEach(function (note, index) {
        var isActive = beatPosition >= note.startBeat && beatPosition < note.startBeat + note.beats
        var pulse = isActive
          ? (Math.sin(cycleElapsed * Math.PI * 5 + index * 0.4) + 1) * 0.5
          : 0
        var noteScale = isActive ? 1 + pulse * 0.12 : 1
        var noteRadiusX = lineSpacing * 0.42 * noteScale
        var noteRadiusY = lineSpacing * 0.29 * noteScale
        var x = -playableWidth / 2 + beatWidth * (note.startBeat + note.beats * 0.5)
        var y = halfHeight - note.staffStep * lineSpacing * 0.5
        var alpha = isActive ? 0.78 + pulse * 0.16 : 0.28 + (index % 3) * 0.03
        var stemDown = note.staffStep >= 6
        var stemX = x + (stemDown ? -noteRadiusX : noteRadiusX)
        var stemEndY = y + (stemDown ? lineSpacing * 3.1 : -lineSpacing * 3.1)

        noteGraphics.ellipse(x, y, noteRadiusX, noteRadiusY)
          .fill({ color: accentColor, alpha: alpha })
        noteGraphics.moveTo(stemX, y)
        noteGraphics.lineTo(stemX, stemEndY)
        noteGraphics.stroke({ color: primaryColor, width: 1.6, alpha: Math.min(0.9, alpha + 0.08) })

        if (note.beats <= 0.5) {
          var flagY = stemEndY
          var flagDirection = stemDown ? -1 : 1
          noteGraphics.moveTo(stemX, flagY)
            .quadraticCurveTo(
              stemX + lineSpacing * 1.1,
              flagY + lineSpacing * 0.55 * flagDirection,
              stemX + lineSpacing * 0.1,
              flagY + lineSpacing * flagDirection
            )
            .stroke({ color: primaryColor, width: 1.6, alpha: Math.min(0.9, alpha + 0.08) })
        }

        if (note.accidental === 'sharp') {
          var sharpX = x - noteRadiusX * 2.3
          var sharpHeight = lineSpacing * 1.15
          noteGraphics.moveTo(sharpX - lineSpacing * 0.16, y - sharpHeight * 0.5)
            .lineTo(sharpX - lineSpacing * 0.16, y + sharpHeight * 0.5)
            .moveTo(sharpX + lineSpacing * 0.16, y - sharpHeight * 0.5)
            .lineTo(sharpX + lineSpacing * 0.16, y + sharpHeight * 0.5)
            .moveTo(sharpX - lineSpacing * 0.34, y - lineSpacing * 0.12)
            .lineTo(sharpX + lineSpacing * 0.34, y - lineSpacing * 0.28)
            .moveTo(sharpX - lineSpacing * 0.34, y + lineSpacing * 0.28)
            .lineTo(sharpX + lineSpacing * 0.34, y + lineSpacing * 0.12)
            .stroke({ color: primaryColor, width: 1.2, alpha: Math.min(0.86, alpha + 0.08) })
        }
      })
    }

    return {
      display: wrapper,
      halo: null,
      baseX: placement.x,
      baseY: placement.y,
      enterX: placement.enterX,
      enterY: placement.enterY,
      entryRotation: 0,
      finalRotation: placement.rotation,
      startTime: shotStartTime,
      settleTime: shotStartTime + 0.5,
      zDepth: 0,
      isTextGlyph: false,
      updateAnimation: updateAnimation
    }
  }

  // ---------- 文本视图构建（原版 sonnetTextViewBuilder.ts） ----------
  var measureCanvas = null

  function measureText(text, fontSpec, fontSize) {
    var pretext = window.Pretext
    if (pretext && typeof pretext.prepareWithSegments === 'function' && typeof pretext.layoutWithLines === 'function') {
      try {
        var layout = pretext.layoutWithLines(pretext.prepareWithSegments(text || ' ', fontSpec), 99999, fontSize * 1.2)
        if (layout && layout.lines && layout.lines[0] && layout.lines[0].width !== undefined) {
          return layout.lines[0].width
        }
      } catch (e) { /* 走回退 */ }
    }
    if (!measureCanvas) measureCanvas = document.createElement('canvas')
    var context = measureCanvas.getContext('2d')
    if (!context) return text.length * fontSize * 0.6
    context.font = fontSpec
    return context.measureText(text || ' ').width
  }

  function buildSonnetTextView(pixi, options) {
    var Text = pixi.Text
    var TextStyle = pixi.TextStyle
    var segment = options.segment
    var originalPlacement = options.placement
    var placement = {}
    for (var key in originalPlacement) placement[key] = originalPlacement[key]

    var fontSize = options.baseFontSize * placement.fontScale
    var normalOffsetSeed = hashSonnetSeed([
      segment.text,
      segment.startOffset,
      segment.endOffset,
      options.segmentIndex,
      'normal-offset'
    ].join(':'))
    var normalOffset = Core.resolveSonnetSegmentNormalOffset(
      placement.role,
      placement.layoutDirection,
      placement.rotation,
      fontSize,
      normalOffsetSeed / 0xffffffff
    )
    placement.x += normalOffset.x
    placement.y += normalOffset.y
    var isKeyword = options.theme.wordColors
      ? options.theme.wordColors.find(function (w) { return w.word.toLowerCase() === segment.text.toLowerCase() })
      : undefined

    // 文字主体保持主色
    var bodyColor = options.theme.primaryColor

    // 辉光与装饰边缘使用关键词颜色，支持文本用强调色
    var glowColor = isKeyword
      ? isKeyword.color
      : (Typography.isSonnetEmphasisRole(placement.role) ? options.theme.primaryColor : options.theme.accentColor)

    var isDecoration = placement.role === 'decoration'
    var renderWeight = Typography.resolveSonnetRoleFontWeight(options.fontWeight, placement.role)
    var fontSpec = renderWeight + ' ' + fontSize + 'px ' + options.fontFamily

    // 视差深度分配
    var zDepth = Core.resolveSonnetSegmentDepth(placement.role)

    var baseDropShadow = options.glowEnabled && !isDecoration ? {
      color: glowColor,
      alpha: 0.8,
      blur: Math.max(12, fontSize * 0.18),
      distance: 0
    } : undefined

    var style = new TextStyle({
      fontFamily: options.fontFamily,
      fontWeight: String(renderWeight),
      fontSize: fontSize,
      fill: (isDecoration ? 'transparent' : bodyColor),
      stroke: isDecoration ? { color: glowColor, width: Math.max(1, Math.min(8, fontSize * 0.006)) } : undefined,
      align: 'center',
      dropShadow: baseDropShadow,
      padding: baseDropShadow ? Math.max(20, baseDropShadow.blur * 2.5) : 0
    })

    // 次强调回声幽灵：空心（仅描边）副本沿版式流向法线分裂，
    // 快速淡入又迅速消失。峰值透明度保持很低，读作淡残影而不与主体竞争
    var isSemiHero = placement.role === 'semi-hero'
    var ghostStyle = isSemiHero ? new TextStyle({
      fontFamily: options.fontFamily,
      fontWeight: String(renderWeight),
      fontSize: fontSize,
      fill: 'transparent',
      stroke: { color: glowColor, width: Math.max(1, Math.min(8, fontSize * 0.006)) },
      align: 'center'
    }) : undefined
    // 流向法线的屏幕空间坐标，换到包装器局部坐标，让幽灵正确继承旋转
    var ghostNormal = (function () {
      var screen = placement.layoutDirection === 'vertical' ? { x: 1, y: 0 } : { x: 0, y: 1 }
      var cosine = Math.cos(-placement.rotation)
      var sine = Math.sin(-placement.rotation)
      return {
        x: screen.x * cosine - screen.y * sine,
        y: screen.x * sine + screen.y * cosine
      }
    })()
    var ghostSpread = fontSize * 0.85
    var ghostDuration = Math.min(
      0.7,
      Math.max(0.4, (options.shotEndTime - options.shotStartTime) * 0.12 + 0.1)
    )

    if (segment.text === '♪') {
      var staffView = buildSonnetStaffView(
        pixi,
        placement,
        options.theme,
        options.baseFontSize,
        options.shotStartTime,
        options.width,
        options.textLayer
      )
      var staffGuide = createSonnetGuide(
        pixi,
        segment,
        placement,
        options.theme,
        fontSize,
        staffView.startTime
      )
      if (!isDecoration) {
        options.guideLayer.addChild(staffGuide.container)
      }
      return {
        segmentIndex: options.segmentIndex,
        displayText: segment.text,
        role: placement.role,
        fontScale: placement.fontScale,
        x: placement.x,
        y: placement.y,
        rotation: placement.rotation,
        enterX: placement.enterX,
        enterY: placement.enterY,
        vertical: placement.vertical,
        timingPhase: placement.timingPhase,
        guide: staffGuide,
        glyphs: [staffView],
        trackingGlyphs: [staffView]
      }
    }

    var glyphs = Typography.buildSonnetGlyphLayout(
      segment,
      placement,
      fontSize,
      function (char) { return measureText(char, fontSpec, fontSize) },
      {
        startTime: options.shotStartTime,
        endTime: options.shotEndTime
      }
    ).map(function (glyph) {
      var display = new Text({ text: glyph.char, style: style })
      display.anchor.set(0.5)
      if (isDecoration) display.alpha = 0.2

      var wrapper = new pixi.Container()
      wrapper.rotation = placement.rotation
      wrapper.position.set(glyph.baseX, glyph.baseY)
      wrapper.alpha = 0

      // 色差（色散）效果
      var caCyanNode
      var caRedNode
      var caOffsetValue

      if (!isDecoration) {
        var isHero = Typography.isSonnetEmphasisRole(placement.role)
        var offset = fontSize * (isHero ? 0.025 : 0.010)
        caOffsetValue = offset

        var caCyan = new Text({ text: glyph.char, style: style })
        caCyan.tint = 0x00ffff
        caCyan.blendMode = 'screen'
        caCyan.anchor.set(0.5)
        caCyan.alpha = isHero ? 0.8 : 0.5

        var caRed = new Text({ text: glyph.char, style: style })
        caRed.tint = 0xff0044
        caRed.blendMode = 'screen'
        caRed.anchor.set(0.5)
        caRed.alpha = isHero ? 0.8 : 0.5

        wrapper.addChild(caCyan, caRed)
        caCyanNode = caCyan
        caRedNode = caRed
      }

      wrapper.addChild(display)

      // 回声幽灵位于核心字形之后；每个幽灵的方向/透明度预计算。
      // 两个回声叠在同一法线侧（每段确定性），残影读作定向拖尾而非对称模糊
      var ghosts
      if (ghostStyle) {
        ghosts = []
        var side = normalOffsetSeed % 2 === 0 ? 1 : -1
        for (var layer = 1; layer <= 2; layer++) {
          var ghost = new Text({ text: glyph.char, style: ghostStyle })
          ghost.anchor.set(0.5)
          ghost.alpha = 0
          ghost.visible = false
          wrapper.addChildAt(ghost, 0)
          var factor = layer === 1 ? 1 : 1.7
          ghosts.push({
            node: ghost,
            dirX: ghostNormal.x * side * factor * ghostSpread,
            dirY: ghostNormal.y * side * factor * ghostSpread,
            alphaBase: layer === 1 ? 0.3 : 0.16
          })
        }
      }

      options.textLayer.addChild(wrapper)

      return {
        display: wrapper,
        halo: null,
        caCyan: caCyanNode,
        caRed: caRedNode,
        caOffset: caOffsetValue,
        ghosts: ghosts,
        ghostDuration: ghosts ? ghostDuration : undefined,
        baseX: glyph.baseX,
        baseY: glyph.baseY,
        enterX: glyph.enterX,
        enterY: glyph.enterY,
        entryRotation: glyph.entryRotation,
        finalRotation: placement.rotation,
        startTime: glyph.startTime,
        settleTime: glyph.settleTime,
        zDepth: zDepth,
        isTextGlyph: true
      }
    })

    // 伴随特定文本段落的随机背景几何。
    // 保持比以前更罕见，并与帧装饰互斥，避免两层轮廓风格叠加在同一段上
    var isChorusParagraph = options.paragraphKind === 'chorus'
    var textSeed = segment.text.split('').reduce(function (a, b) { return a + b.charCodeAt(0) }, 0) + options.segmentIndex * 13
    var isChorusEffect = isChorusParagraph || ((textSeed % 100) < 35)
    var shapeThreshold = isChorusEffect ? 26 : 15 // 合唱效果下概率更高
    var hasFrameDecor = resolveSonnetFrameDecorSpec(segment).applied
    var shouldAddBgShape = options.showFixedGeo
      && (textSeed % 100) < shapeThreshold
      && !isDecoration
      && segment.isWordLike
      && !hasFrameDecor
      && glyphs.length > 0

    if (shouldAddBgShape) {
      var bgWrapper = new pixi.Container()
      bgWrapper.position.set(placement.x, placement.y)
      bgWrapper.rotation = placement.rotation
      bgWrapper.alpha = 0

      var bgShape = Mg.buildSonnetTextFixedGeo(pixi, {
        seed: textSeed,
        isChorusEffect: isChorusEffect,
        fontSize: fontSize,
        layoutWidth: options.width,
        theme: options.theme
      })

      bgWrapper.addChild(bgShape)
      options.textLayer.addChildAt(bgWrapper, 0) // 保证它在文字后面

      var firstGlyph = glyphs[0]
      var bgGlyph = {
        display: bgWrapper,
        halo: null,
        baseX: placement.x,
        baseY: placement.y,
        enterX: placement.enterX,
        enterY: placement.enterY,
        entryRotation: 0,
        finalRotation: placement.rotation,
        startTime: firstGlyph.startTime,
        settleTime: firstGlyph.settleTime,
        zDepth: -0.5 - (textSeed % 5) * 0.1, // 视差的背景深度
        isBackgroundShape: true,
        isTextGlyph: false
      }
      glyphs.unshift(bgGlyph)
    }

    var guide = createSonnetGuide(
      pixi,
      segment,
      placement,
      options.theme,
      fontSize,
      glyphs.length > 0 && glyphs[0].startTime !== undefined ? glyphs[0].startTime : options.shotStartTime
    )
    if (!isDecoration) {
      options.guideLayer.addChild(guide.container)
    }

    // 装饰性开框（40% 段落），保持在字形之后
    var firstTextGlyph = glyphs.find(function (glyph) { return glyph.isTextGlyph !== false })
    var frameDecor = buildSonnetFrameDecor(pixi, {
      segment: segment,
      placement: placement,
      theme: options.theme,
      fontSize: fontSize,
      shotStartTime: options.shotStartTime,
      shotEndTime: options.shotEndTime,
      firstGlyphStartTime: firstTextGlyph ? firstTextGlyph.startTime : segment.startTime
    })
    if (frameDecor) options.textLayer.addChildAt(frameDecor.container, 0)

    return {
      segmentIndex: options.segmentIndex,
      displayText: segment.text,
      role: placement.role,
      fontScale: placement.fontScale,
      x: placement.x,
      y: placement.y,
      rotation: placement.rotation,
      enterX: placement.enterX,
      enterY: placement.enterY,
      vertical: placement.vertical,
      timingPhase: placement.timingPhase,
      guide: guide,
      frameDecor: frameDecor,
      glyphs: glyphs,
      trackingGlyphs: Typography.resolveSonnetCameraTrackingGlyphs(glyphs)
    }
  }

  window.FoliaSonnetText = {
    resolveSonnetIconNames: resolveSonnetIconNames,
    buildSonnetIconParticleIndices: buildSonnetIconParticleIndices,
    resolveSonnetIconEntryPhase: resolveSonnetIconEntryPhase,
    resolveSonnetIconEntryDuration: resolveSonnetIconEntryDuration,
    resolveSonnetIconEntryDelay: resolveSonnetIconEntryDelay,
    buildSonnetIconTextureKey: buildSonnetIconTextureKey,
    buildSonnetIconDataUrl: buildSonnetIconDataUrl,
    getSonnetTexturePool: getSonnetTexturePool,
    resolveSonnetGuideCue: resolveSonnetGuideCue,
    createSonnetGuide: createSonnetGuide,
    SONNET_FRAME_DECOR_PROBABILITY: SONNET_FRAME_DECOR_PROBABILITY,
    resolveSonnetFrameDecorSpec: resolveSonnetFrameDecorSpec,
    resolveSonnetFrameLocalDimensions: resolveSonnetFrameLocalDimensions,
    buildSonnetFrameDecor: buildSonnetFrameDecor,
    LA_FOLIA_STAFF_NOTES: LA_FOLIA_STAFF_NOTES,
    LA_FOLIA_TOTAL_BEATS: LA_FOLIA_TOTAL_BEATS,
    LA_FOLIA_CYCLE_SECONDS: LA_FOLIA_CYCLE_SECONDS,
    buildSonnetStaffView: buildSonnetStaffView,
    measureText: measureText,
    buildSonnetTextView: buildSonnetTextView
  }
})()
