// 通用背景：移植自 folia-major src/components/visualizer/backgrounds/common/
//（entry.tsx + FluidBackground.tsx + GeometricBackground.tsx）
// 结构：可选流体封面层（blur 40px + 交叉淡入）→ 主题底色 → 几何形状/粒子层（音频响应）→ 暗角。
// 原版 iOS Safari 专用柔焦分支在 Electron 环境恒不触发，仅保留非 iOS 路径（注释说明）。
// theme.lyricsIcons 在本插件恒为空，几何层的 icon 形状分支自然不触发（逻辑保留）。
(function () {
  'use strict'

  // 原版 common 默认配置
  var DEFAULT_CONFIG = {
    useCoverColorBg: false,
    opacity: 0.75,
    disableGeometricBackground: false,
    disableVignette: false
  }

  // 封面模糊源最长边（px）：40px 模糊抹掉所有小于 ~40px 的细节，384px 源即可产生视觉一致的结果，
  // 且单瓦片上传消除大图纹理的网格闪烁
  var COVER_BLUR_SOURCE_MAX = 384

  function create(config) {
    var cfg = Object.assign({}, DEFAULT_CONFIG, config || {})

    var host = null
    var root = null
    var fluidWrap = null
    var fluidLayers = []     // [{wrapperEl, imgEl, key, ready, sourceCover}]
    var bgColorEl = null
    var geoLayer = null
    var coverKeyCounter = 0

    var theme = null
    var coverUrl = null
    var currentCoverUrl = null
    var shapes = []
    var particles = []
    var shapeEls = []        // [{el, spec, isIcon}]
    var particleEls = []     // [{el, spec}]
    var paused = false

    // ---------- 几何层（原版 shapes/particles 生成逻辑一致） ----------
    function buildShapes() {
      var shapeTypes = ['circle', 'square', 'triangle', 'cross']
      var availableIcons = (theme && theme.lyricsIcons) || []

      var iconCount = 0
      shapes = []
      for (var index = 0; index < 15; index += 1) {
        var wantIcon = availableIcons.length > 0 && Math.random() > 0.7
        var useIcon = wantIcon && iconCount < 6
        if (useIcon) iconCount += 1

        var iconName = useIcon ? availableIcons[Math.floor(Math.random() * availableIcons.length)] : null

        shapes.push({
          id: index,
          type: useIcon ? 'icon' : shapeTypes[Math.floor(Math.random() * shapeTypes.length)],
          iconName: iconName,
          initialX: Math.random() * 100,
          initialY: Math.random() * 100,
          size: 40 + Math.random() * 100,
          duration: useIcon ? 20 + Math.random() * 20 : 30 + Math.random() * 30,
          delay: Math.random() * 5,
          opacity: 0.11 + Math.random() * 0.08,
          reverse: Math.random() > 0.5,
          filled: Math.random() < 0.3,
          initialRotation: Math.random() * 360
        })
      }

      particles = []
      for (var p = 0; p < 20; p += 1) {
        particles.push({
          id: p,
          size: Math.random() * 4 + 1,
          left: Math.random() * 100,
          top: Math.random() * 100,
          opacity: Math.random() * 0.3,
          duration: 15 + Math.random() * 20,
          delay: Math.random() * 10
        })
      }
    }

    function getShapeClipPath(shapeType) {
      if (shapeType === 'triangle') return 'polygon(50% 0%, 0% 100%, 100% 100%)'
      if (shapeType === 'cross') return 'polygon(20% 0%, 0% 20%, 30% 50%, 0% 80%, 20% 100%, 50% 70%, 80% 100%, 100% 80%, 70% 50%, 100% 20%, 80% 0%, 50% 30%)'
      return 'none'
    }

    function getShapeScaleKey(shape) {
      switch (shape.type) {
        case 'circle': return 'bass'
        case 'square': return 'lowMid'
        case 'triangle': return 'mid'
        case 'cross': return 'treble'
        case 'icon': return 'vocal'
        default: return 'default'
      }
    }

    function buildGeometricDom() {
      if (!geoLayer) return
      geoLayer.innerHTML = ''
      shapeEls = []
      particleEls = []

      shapes.forEach(function (shape) {
        var el = document.createElement('div')
        var isCircleOrSquare = shape.type === 'circle' || shape.type === 'square'
        var useStroke = isCircleOrSquare && !shape.filled

        var styles = [
          'position:absolute',
          'left:' + shape.initialX + '%',
          'top:' + shape.initialY + '%',
          'width:' + shape.size + 'px',
          'height:' + shape.size + 'px',
          'border:' + (useStroke ? '1px solid ' + (theme ? theme.secondaryColor : '#fff') : 'none'),
          'background-color:' + (!useStroke ? (theme ? theme.secondaryColor : '#fff') : 'transparent'),
          'border-radius:' + (shape.type === 'circle' ? '50%' : '0%'),
          'opacity:' + shape.opacity,
          'clip-path:' + getShapeClipPath(shape.type),
          'will-change:transform,opacity'
        ].join(';')
        el.style.cssText = styles
        el.style.transform = 'rotate(' + shape.initialRotation + 'deg)'
        geoLayer.appendChild(el)
        shapeEls.push({ el: el, spec: shape, isIcon: false })
      })

      particles.forEach(function (particle) {
        var el = document.createElement('div')
        el.style.cssText = [
          'position:absolute', 'border-radius:50%',
          'background-color:' + (theme ? theme.accentColor : '#fff'),
          'width:' + particle.size + 'px',
          'height:' + particle.size + 'px',
          'left:' + particle.left + '%',
          'top:' + particle.top + '%',
          'opacity:' + particle.opacity,
          'will-change:transform,opacity'
        ].join(';')
        geoLayer.appendChild(el)
        particleEls.push({ el: el, spec: particle })
      })

      // 暗角
      if (!cfg.disableVignette) {
        var vignette = document.createElement('div')
        vignette.style.cssText = 'position:absolute;inset:0;pointer-events:none;background:radial-gradient(circle, transparent 40%, rgba(0,0,0,0.6) 100%)'
        geoLayer.appendChild(vignette)
      }
    }

    // 启动形状/粒子关键帧动画（WAAPI 无限循环；原版 framer-motion repeat:Infinity + linear）
    function startShapeAnimations() {
      shapeEls.forEach(function (item) {
        var shape = item.spec
        var keyframes = {
          transform: [
            'rotate(' + shape.initialRotation + 'deg) translate(' + (shape.reverse ? 15 : -15) + 'px, ' + (shape.reverse ? 30 : -30) + 'px)',
            'rotate(' + (shape.initialRotation + 180) + 'deg) translate(' + (shape.reverse ? -15 : 15) + 'px, ' + (shape.reverse ? -30 : 30) + 'px)',
            'rotate(' + (shape.initialRotation + 360) + 'deg) translate(' + (shape.reverse ? 15 : -15) + 'px, ' + (shape.reverse ? 30 : -30) + 'px)'
          ]
        }
        item.el.animate(keyframes, {
          duration: shape.duration * 1000,
          iterations: Infinity,
          easing: 'linear',
          delay: shape.delay * 1000
        })
      })

      particleEls.forEach(function (item) {
        var particle = item.spec
        item.el.animate({
          transform: ['translateY(0)', 'translateY(-100px)'],
          opacity: [0, particle.opacity, 0]
        }, {
          duration: particle.duration * 1000,
          iterations: Infinity,
          easing: 'linear',
          delay: particle.delay * 1000
        })
      })
    }

    // ---------- 流体封面层（原版非 iOS 路径：缩小源 + blur 40px + 交叉淡入） ----------
    function buildDownscaledCover(url, maxSize) {
      return new Promise(function (resolve) {
        var img = new Image()
        img.crossOrigin = 'anonymous'
        img.decoding = 'async'
        img.onload = function () {
          try {
            var naturalWidth = img.naturalWidth || img.width
            var naturalHeight = img.naturalHeight || img.height
            if (!naturalWidth || !naturalHeight) { resolve(null); return }
            var scale = Math.min(1, maxSize / Math.max(naturalWidth, naturalHeight))
            var width = Math.max(1, Math.round(naturalWidth * scale))
            var height = Math.max(1, Math.round(naturalHeight * scale))
            var canvas = document.createElement('canvas')
            canvas.width = width
            canvas.height = height
            var ctx = canvas.getContext('2d')
            if (!ctx) { resolve(null); return }
            ctx.imageSmoothingEnabled = true
            ctx.imageSmoothingQuality = 'high'
            ctx.drawImage(img, 0, 0, width, height)
            resolve(canvas.toDataURL('image/jpeg', 0.82))
          } catch (error) {
            // 跨域封面无 CORS 头会污染 canvas：回退原始 URL
            resolve(null)
          }
        }
        img.onerror = function () { resolve(null) }
        img.src = url
      })
    }

    function updateCoverLayers() {
      if (!fluidWrap) return
      if (!coverUrl) {
        fluidLayers.forEach(function (layer) { layer.wrapperEl.remove() })
        fluidLayers = []
        return
      }

      buildDownscaledCover(coverUrl, COVER_BLUR_SOURCE_MAX).then(function (smallUrl) {
        if (!fluidWrap) return
        var src = smallUrl || coverUrl
        var top = fluidLayers[fluidLayers.length - 1]
        if (top && top.sourceCover === coverUrl) return

        coverKeyCounter += 1
        var key = coverKeyCounter

        // 保留当前顶层（供新层淡入时垫底）+ 新层
        var wrapper = document.createElement('div')
        wrapper.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;will-change:opacity;opacity:0'
        var img = document.createElement('img')
        img.style.cssText = [
          'position:absolute', 'inset:0', 'width:100%', 'height:100%',
          'object-fit:cover',
          'filter:blur(40px)',
          'transform:scale(1.5) translateZ(0)',
          'opacity:1',
          'will-change:transform,opacity,filter',
          'backface-visibility:hidden',
          '-webkit-backface-visibility:hidden'
        ].join(';')
        img.src = src
        wrapper.appendChild(img)
        fluidWrap.appendChild(wrapper)

        var entry = { wrapperEl: wrapper, imgEl: img, key: key, ready: false, sourceCover: coverUrl }
        fluidLayers = [top, entry].filter(Boolean)

        img.decode
          ? img.decode().then(function () { requestAnimationFrame(function () { markCoverReady(entry) }) }).catch(function () { markCoverReady(entry) })
          : markCoverReady(entry)

        img.onerror = function () {
          // 坏层干净退出；最后一层不删
          if (fluidLayers.length > 1) {
            fluidLayers = fluidLayers.filter(function (l) { return l !== entry })
            entry.wrapperEl.remove()
          }
        }
      })
    }

    function markCoverReady(entry) {
      if (entry.ready) return
      entry.ready = true
      // 顶层淡入 1.5s；完成后清理下层
      entry.wrapperEl.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 1500, easing: 'ease-in-out', fill: 'forwards' })
      setTimeout(function () {
        fluidLayers = fluidLayers.filter(function (l) {
          if (l !== entry && entry.ready) {
            l.wrapperEl.remove()
            return false
          }
          return true
        })
      }, 1550)
    }

    // ---------- 生命周期 ----------
    function mount(hostEl) {
      host = hostEl

      root = document.createElement('div')
      root.style.cssText = [
        'position:absolute', 'inset:0', 'width:100%', 'height:100%',
        'overflow:hidden', 'pointer-events:none', 'z-index:0',
        'isolation:isolate', 'contain:paint', 'transform:translateZ(0)'
      ].join(';')

      fluidWrap = document.createElement('div')
      fluidWrap.style.cssText = 'position:absolute;inset:0;z-index:0;width:100%;height:100%'
      root.appendChild(fluidWrap)

      bgColorEl = document.createElement('div')
      bgColorEl.style.cssText = 'position:absolute;inset:0;z-index:0;transition:all 1s'
      root.appendChild(bgColorEl)

      geoLayer = document.createElement('div')
      geoLayer.style.cssText = 'position:absolute;inset:0;z-index:0'
      root.appendChild(geoLayer)

      // 阅读性渐变叠加（原版 Fluid 内的 overlay——独立于流体层开关存在）
      overlayEl = document.createElement('div')
      root.appendChild(overlayEl)

      host.appendChild(root)
      applyTheme()
      buildShapes()
      buildGeometricDom()
      startShapeAnimations()
      updateCoverLayers()
    }

    var overlayEl = null

    function applyTheme() {
      if (!theme) return

      if (coverUrl && cfg.useCoverColorBg) {
        bgColorEl.style.backgroundColor = theme.backgroundColor
        bgColorEl.style.opacity = String(cfg.opacity)
      } else {
        bgColorEl.style.backgroundColor = theme.backgroundColor
        bgColorEl.style.opacity = '1'
      }

      if (overlayEl) {
        overlayEl.style.cssText = [
          'position:absolute', 'inset:0', 'width:100%', 'height:100%',
          'background:linear-gradient(to bottom right, ' + theme.primaryColor + ', transparent, ' + theme.secondaryColor + ')',
          'opacity:0.4',
          'mix-blend-mode:overlay'
        ].join(';')
      }
    }

    function rebuildGeometry() {
      buildShapes()
      buildGeometricDom()
      startShapeAnimations()
    }

    function setTheme(newTheme) {
      var colorsChanged = !theme || !newTheme
        || theme.backgroundColor !== newTheme.backgroundColor
        || theme.primaryColor !== newTheme.primaryColor
        || theme.secondaryColor !== newTheme.secondaryColor
        || theme.accentColor !== newTheme.accentColor
      theme = newTheme
      applyTheme()
      if (colorsChanged) rebuildGeometry()
    }

    function setCoverUrl(url) {
      var changed = coverUrl !== url
      coverUrl = url
      if (changed) {
        applyTheme()
        updateCoverLayers()
      }
    }

    // 频段 0~1 → 0~255 还原原版值域；形状缩放 = spring(300/30) 后映射 [10,200]→[0.95,1.45]
    var bandSprings = {}
    function ensureSpring(key) {
      if (!bandSprings[key]) {
        bandSprings[key] = { value: 0, velocity: 0 }
      }
      return bandSprings[key]
    }

    function springStep(spring, target, dt) {
      var stiffness = 300
      var damping = 30
      var force = -stiffness * (spring.value - target)
      var damper = -damping * spring.velocity
      spring.velocity += (force + damper) * dt
      spring.value += spring.velocity * dt
      return spring.value
    }

    // 输入 0~255 尺度的平滑值，映射 [10,200] → [0.95,1.45]（原版 useTransform）
    function bandScaleFrom255(value255) {
      var clamped = Math.max(10, Math.min(200, value255))
      var t = (clamped - 10) / (200 - 10)
      return 0.95 + t * (1.45 - 0.95)
    }

    function tick(frameState) {
      if (!root) return
      paused = frameState.isPlaying === false

      if (paused) return // 暂停时形状冻结（原版 paused 走静态层，此处直接不更新）

      var dt = Math.min(frameState.dt || 1 / 60, 0.05)
      var bands = frameState.audioBands || {}

      // 形状缩放走 CSS 独立 scale 属性（与 WAAPI transform 关键帧动画互不覆盖，Chromium 支持）
      for (var i = 0; i < shapeEls.length; i += 1) {
        var item = shapeEls[i]
        var key = getShapeScaleKey(item.spec)
        var raw = key === 'default' ? (frameState.audioPower || 0) : (bands[key] || 0)
        var spring = ensureSpring(key + '_' + item.spec.id)
        springStep(spring, raw * 255, dt)
        item.el.style.scale = String(bandScaleFrom255(spring.value))
      }
    }

    function destroy() {
      if (root) { root.remove(); root = null }
      fluidWrap = null
      bgColorEl = null
      geoLayer = null
      overlayEl = null
      fluidLayers = []
      shapeEls = []
      particleEls = []
      shapes = []
      particles = []
      bandSprings = {}
      host = null
    }

    return {
      id: 'common',
      mount: mount,
      setTheme: setTheme,
      setCoverUrl: setCoverUrl,
      tick: tick,
      destroy: destroy
    }
  }

  window.FoliaBgCommon = { create: create }
})()
