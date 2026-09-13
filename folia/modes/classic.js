// 流光模式：移植自 folia-major src/components/visualizer/classic/Visualizer.tsx（默认模式）
// 逐词弹性动画：三层词结构（发光层/本体层/合唱涟漪），词状态机 waiting → active → passed，
// 行进出场按 renderHints 的 lineTransitionMode 分三档，整行呼吸浮动。
// 语义布局单元（CJK 语义分组 + 粘着标点）与原版管线一致。
(function () {
  'use strict'

  var Anim = window.FoliaAnim
  var Runtime = window.FoliaVisualizerRuntime
  var RenderHints = window.FoliaRenderHints
  var Layout = window.FoliaCjkSemanticLayout
  var WordColoring = window.FoliaWordColoring

  var measureCanvas = null
  function measureWordWidth(text, pxSize, fontStack, fontWeight) {
    if (!measureCanvas) measureCanvas = document.createElement('canvas')
    var context = measureCanvas.getContext('2d')
    if (!context) return text.length * pxSize * 0.65
    context.font = fontWeight + ' ' + pxSize + 'px ' + fontStack
    return context.measureText(text).width
  }

  function getPixelFontSize(fontScale, width) {
    var rem = 16
    var minPx = 2.25 * fontScale * rem
    var valPx = (6 * fontScale * width) / 100
    var maxPx = 4.5 * fontScale * rem
    return Math.max(minPx, Math.min(valPx, maxPx))
  }

  function createMode() {
    var host = null
    var floatEl = null      // 呼吸浮动容器（70vh 区）
    var lineHost = null     // 行挂载点（AnimatePresence 等价）
    var currentLineEl = null
    var currentLineKey = null
    var wordEls = []        // [{el, glowLayer, bodyLayer, word, config, renderProfile, status, rippleEl}]
    var intensity = 'normal'
    var fontScale = 1
    var theme = null
    var showText = true
    var lastTime = 0

    function mount(hostEl) {
      host = hostEl

      floatEl = document.createElement('div')
      floatEl.className = 'folia-mode-classic'
      floatEl.style.cssText = [
        'position:absolute', 'left:0', 'right:0', 'top:0', 'height:70vh', 'z-index:10',
        'display:flex', 'align-items:center', 'justify-content:center', 'padding:32px',
        'pointer-events:none', 'will-change:transform', 'overflow:visible'
      ].join(';')

      lineHost = document.createElement('div')
      lineHost.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:none'
      floatEl.appendChild(lineHost)
      host.appendChild(floatEl)
    }

    function fontFamily() {
      return window.foliaGetLyricFontFamily
        ? window.foliaGetLyricFontFamily()
        : (theme && theme.fontFamily) || 'sans-serif'
    }

    // ---------- 行进出场（原版 getClassicLineContainerMotion 三档） ----------
    function lineContainerMotion(renderProfile) {
      var mode = renderProfile ? renderProfile.lineTransitionMode : 'normal'
      if (mode === 'none') {
        return {
          initial: { opacity: 1, scale: 1, filter: 'blur(0px)' },
          animate: { opacity: 1, scale: 1, filter: 'blur(0px)' },
          exit: { opacity: 0, scale: 1.02, filter: 'blur(6px)', duration: 0.12 }
        }
      }
      if (mode === 'fast') {
        return {
          initial: { opacity: 0.35, scale: 0.96, filter: 'blur(4px)' },
          animate: { opacity: 1, scale: 1, filter: 'blur(0px)', duration: 0.16 },
          exit: { opacity: 0, scale: 1.04, filter: 'blur(10px)', duration: 0.16 }
        }
      }
      return {
        initial: { opacity: 0, scale: 0.9, filter: 'blur(10px)' },
        animate: { opacity: 1, scale: 1, filter: 'blur(0px)', duration: 0.3 },
        exit: { opacity: 0, scale: 1.1, filter: 'blur(20px)', duration: 0.3 }
      }
    }

    // ---------- 行渲染 ----------
    function renderLine(line, lines, currentLineIndex) {
      if (!lineHost || !theme) return

      var renderProfile = null
      if (line) {
        var renderHints = RenderHints.getLineRenderHints(line)
        var wordRevealMode = renderHints ? renderHints.wordRevealMode : 'normal'
        renderProfile = {
          renderHints: renderHints,
          lineRenderEndTime: RenderHints.getLineRenderEndTime(line),
          lineTransitionMode: renderHints ? renderHints.lineTransitionMode : 'normal',
          wordRevealMode: wordRevealMode,
          wordLookahead: wordRevealMode === 'instant' ? 0.03 : wordRevealMode === 'fast' ? 0.08 : 0.15
        }
      }

      var motion = lineContainerMotion(renderProfile)
      var seed = line ? line.startTime : 0
      var isChaotic = intensity === 'chaotic'
      var isCalm = intensity === 'calm'

      // 行容器确定性随机布局（与原版一致）
      var justifyOptions = isCalm
        ? ['center']
        : ['flex-start', 'center', 'flex-end', 'space-around', 'space-between']
      var alignOptions = isCalm ? ['center'] : ['flex-start', 'center', 'flex-end']
      var isInterlude = line && line.fullText === '......'

      var justify = isInterlude ? 'center' : justifyOptions[Math.floor(seed % justifyOptions.length)]
      var align = alignOptions[Math.floor((seed * 2) % alignOptions.length)]
      var perspective = isChaotic ? 500 + (seed % 500) : 1000

      var displayWords = line
        ? Layout.buildDisplayWordsFromLayoutUnits(Layout.buildPostLyricLayoutUnits(line, { semantic: true, sticky: true }))
        : []

      var viewportWidth = window.innerWidth
      var pxFontSize = getPixelFontSize(fontScale, viewportWidth)
      var fontStack = fontFamily()
      var fontWeight = 700
      var wordWidths = displayWords.map(function (w) { return measureWordWidth(w.text, pxFontSize, fontStack, fontWeight) })

      var baseSpread = isChaotic ? 60 : isCalm ? 0 : 20
      var baseRotate = isChaotic ? 30 : isCalm ? 0 : 5

      var lineEl = document.createElement('div')
      lineEl.className = 'folia-classic-line'
      lineEl.style.cssText = [
        'display:flex', 'flex-wrap:wrap', 'width:100%', 'max-width:72rem',
        'align-content:center', 'justify-content:' + justify, 'align-items:' + align,
        'perspective:' + perspective + 'px', 'min-height:300px',
        'will-change:transform,opacity,filter', 'pointer-events:none'
      ].join(';')

      // 进入动画
      lineEl.style.opacity = String(motion.initial.opacity)
      lineEl.style.transform = Anim.transformStr({ scale: motion.initial.scale })
      lineEl.style.filter = motion.initial.filter
      requestAnimationFrame(function () {
        if (!lineEl.isConnected) return
        var animSpec = {
          opacity: { from: motion.initial.opacity, to: motion.animate.opacity },
          transform: { from: { scale: motion.initial.scale }, to: { scale: motion.animate.scale } },
          filter: { from: motion.initial.filter, to: motion.animate.filter }
        }
        if (renderProfile && renderProfile.lineTransitionMode === 'normal') {
          Anim.animateProps(lineEl, animSpec, { duration: motion.animate.duration })
        } else {
          Anim.animateProps(lineEl, animSpec, { duration: motion.animate.duration || 0.16 })
        }
      })

      var wordConfigs = []
      displayWords.forEach(function (w, i) {
        var wordSeed = seed + i
        var random = function (offset) {
          var x = Math.sin(wordSeed + offset) * 10000
          return x - Math.floor(x)
        }

        if (isInterlude) {
          wordConfigs.push({
            x: 0,
            y: (random(2) - 0.5) * 15,
            rotate: 0,
            scale: 1.5,
            marginRight: '3rem',
            alignSelf: 'center',
            passedRotate: 0
          })
        } else {
          var wordConfigScale = isChaotic ? 0.8 + random(4) * 0.6 : 1.1 + random(4) * 0.2
          var xVal = (random(1) - 0.5) * baseSpread * 2
          var yVal = (random(2) - 0.5) * baseSpread * 2

          var marginRight
          // 精算 margin 防止缩放与平移时视觉重叠（原版非 legacy 布局）
          var wI = wordWidths[i] || 0
          var sI = wordConfigScale * 1.4
          var wNext = 0
          var sNext = 1.0
          var xNext = 0
          if (i + 1 < displayWords.length) {
            var nextSeed = seed + (i + 1)
            var nextRandom = function (offset) {
              var x = Math.sin(nextSeed + offset) * 10000
              return x - Math.floor(x)
            }
            var nextConfigScale = isChaotic ? 0.8 + nextRandom(4) * 0.6 : 1.1 + nextRandom(4) * 0.2
            sNext = nextConfigScale * 1.4
            xNext = (nextRandom(1) - 0.5) * baseSpread * 2
            wNext = wordWidths[i + 1] || 0
          }
          var spacingMultiplier = 0.7 // 原版 DEFAULT wordSpacing
          var gap = 0.05 * pxFontSize
          var halfOverflowI = (wI * (sI - 1)) / 2
          var halfOverflowNext = (wNext * (sNext - 1)) / 2
          var xOffsetDiff = xVal - xNext
          var calculatedMargin = (halfOverflowI + halfOverflowNext + xOffsetDiff + gap) * spacingMultiplier
          var minMargin = (isChaotic ? 0.08 * pxFontSize : 0.12 * pxFontSize) * spacingMultiplier
          var finalMargin = Math.max(minMargin, calculatedMargin)
          marginRight = finalMargin.toFixed(1) + 'px'

          wordConfigs.push({
            x: xVal,
            y: yVal,
            rotate: (random(3) - 0.5) * baseRotate * 2,
            scale: wordConfigScale,
            marginRight: marginRight,
            alignSelf: isChaotic && random(6) > 0.7 ? (random(7) > 0.5 ? 'flex-start' : 'flex-end') : 'auto',
            passedRotate: (random(8) - 0.5) * 45
          })
        }
      })

      var mainFontSize = getPixelFontSize(fontScale, viewportWidth)

      displayWords.forEach(function (word, idx) {
        var config = wordConfigs[idx] || { x: 0, y: 0, rotate: 0, scale: 1, marginRight: '0.5rem', alignSelf: 'auto', passedRotate: 0 }
        var activeColor = WordColoring.resolveWordColor(word.text, theme.wordColors, theme.accentColor)

        var wordEl = document.createElement('div')
        wordEl.style.cssText = [
          'display:inline-block', 'transform-origin:center', 'position:relative',
          'will-change:transform', 'white-space:nowrap',
          'font-size:' + mainFontSize + 'px', 'font-weight:' + fontWeight,
          'margin-right:' + config.marginRight, 'line-height:1.22'
        ].join(';')
        if (config.alignSelf !== 'auto') wordEl.style.alignSelf = config.alignSelf

        // 发光层（absolute、透明文字 + textShadow）
        var glowLayer = document.createElement('span')
        glowLayer.style.cssText = [
          'position:absolute', 'inset:0', 'user-select:none', 'pointer-events:none',
          'display:block', 'color:transparent'
        ].join(';')

        // 逐字时拆分字形 span（带字符级 textShadow 时序）
        var graphemeTimings = window.FoliaGraphemeTiming.buildWordGraphemeTimings(word)
        var glowSpans = []
        if (graphemeTimings.length > 1) {
          graphemeTimings.forEach(function (timing) {
            var gs = document.createElement('span')
            gs.textContent = timing.char
            glowLayer.appendChild(gs)
            glowSpans.push({ el: gs, timing: timing })
          })
        } else {
          var gs = document.createElement('span')
          gs.textContent = word.text
          glowLayer.appendChild(gs)
          glowSpans.push({ el: gs, timing: null })
        }

        // 本体层（颜色 + blur）
        var bodyLayer = document.createElement('span')
        bodyLayer.style.cssText = [
          'position:relative', 'z-index:10', 'display:block',
          'color:' + theme.primaryColor, 'filter:blur(10px)'
        ].join(';')
        bodyLayer.textContent = word.text

        wordEl.appendChild(glowLayer)
        wordEl.appendChild(bodyLayer)
        lineEl.appendChild(wordEl)

        wordEls.push({
          el: wordEl,
          glowLayer: glowLayer,
          glowSpans: glowSpans,
          bodyLayer: bodyLayer,
          word: word,
          config: config,
          renderProfile: renderProfile,
          status: null,
          baseColor: theme.primaryColor,
          activeColor: activeColor
        })
      })

      lineHost.appendChild(lineEl)
      currentLineEl = lineEl
      currentLineKey = line ? line.startTime : 'empty'
    }

    // 旧行退场动画后移除
    function exitLine(line, renderProfile) {
      if (!line) return
      var motion = lineContainerMotion(renderProfile)
      line.style.pointerEvents = 'none'
      Anim.animateProps(line, {
        opacity: { to: motion.exit.opacity },
        transform: { to: { scale: motion.exit.scale } },
        filter: { to: motion.exit.filter }
      }, { duration: motion.exit.duration })
      var el = line
      setTimeout(function () { el.remove() }, Math.max(motion.exit.duration * 1000 + 60, 120))
    }

    // ---------- 词状态机（原版 layout/body/glow variants） ----------
    function applyWordState(item, newStatus, now) {
      var config = item.config
      var profile = item.renderProfile
      var word = item.word
      item.status = newStatus

      var activeColor = item.activeColor
      var baseColor = item.baseColor
      var reveal = profile ? profile.wordRevealMode : 'normal'

      // 词 active 结束时间与显示时长（原版 getClassicWordActiveEndTime/DisplayDuration）
      var lineRenderEndTime = profile ? profile.lineRenderEndTime : word.endTime
      var activeEndTime
      if (reveal === 'instant') activeEndTime = lineRenderEndTime
      else if (reveal === 'fast') activeEndTime = Math.min(lineRenderEndTime, Math.max(word.endTime, word.startTime + 0.12))
      else activeEndTime = word.endTime
      var minDuration = reveal === 'instant' ? 0.08 : reveal === 'fast' ? 0.12 : 0.1
      var duration = Math.max(activeEndTime - word.startTime, minDuration)

      if (newStatus === 'waiting') {
        // layout: opacity 0 / scale 0.5 / 偏移位置
        Anim.animateProps(item.el, {
          opacity: { to: 0 },
          transform: {
            from: { x: config.x, y: config.y, scale: config.scale * 1.4, rotate: config.rotate },
            to: { x: config.x + (Math.sin(config.y) * 100), y: config.y + (Math.cos(config.x) * 50), scale: 0.5, rotate: config.rotate + 20 }
          }
        }, { duration: 0.4 })
        // body: baseColor + blur 10
        Anim.animateProps(item.bodyLayer, {
          color: { to: baseColor },
          filter: { to: 'blur(10px)' }
        }, { duration: 0.4 })
        // glow: 透明无阴影
        Anim.setProps(item.glowLayer, { textShadow: 'none' })
        item.glowSpans.forEach(function (span) {
          span.el.style.textShadow = 'none'
        })
        return
      }

      if (newStatus === 'active') {
        // layout: spring(stiffness 200, damping 20) + opacity 0.1s
        Anim.animateProps(item.el, {
          opacity: { to: 1 },
          transform: {
            from: { x: config.x + (Math.sin(config.y) * 100), y: config.y + (Math.cos(config.x) * 50), scale: 0.5, rotate: config.rotate + 20 },
            to: { x: config.x, y: config.y, scale: config.scale * 1.4, rotate: config.rotate }
          }
        }, { type: 'spring', stiffness: 200, damping: 20, opacity: { duration: 0.1 } })
        // body: color 线性过渡到 activeColor，blur 清除
        Anim.animateProps(item.bodyLayer, {
          color: { from: baseColor, to: activeColor },
          filter: { from: 'blur(10px)', to: 'blur(0px)' }
        }, {
          color: { duration: duration },
          filter: { duration: reveal === 'instant' ? 0.08 : reveal === 'fast' ? 0.12 : 0.2 }
        })
        item.bodyLayer.style.filter = 'none'
        // glow: textShadow 关键帧（先亮后灭，字符级错峰）
        item.glowSpans.forEach(function (span, index) {
          if (reveal === 'instant') {
            span.el.animate(
              [
                { textShadow: 'none', offset: 0 },
                { textShadow: '0 0 14px ' + activeColor + ', 0 0 24px ' + activeColor, offset: 0.35 },
                { textShadow: 'none', offset: 1 }
              ],
              { duration: Math.min(duration * 1000, 120), easing: 'ease-out', fill: 'forwards' }
            )
          } else if (reveal === 'fast') {
            span.el.animate(
              [
                { textShadow: 'none', offset: 0 },
                { textShadow: '0 0 18px ' + activeColor + ', 0 0 32px ' + activeColor, offset: 0.4 },
                { textShadow: 'none', offset: 1 }
              ],
              { duration: Math.min(Math.max(duration * 1000, 120), 200), easing: 'ease-in-out', fill: 'forwards' }
            )
          } else if (item.glowSpans.length > 1) {
            // 逐字：delay = 字符起点 - 词起点，时长 = 字符时长 × 6
            var charDelay = Math.max(0, span.timing.startTime - word.startTime)
            var charDuration = Math.max(span.timing.endTime - span.timing.startTime, 0.001)
            span.el.animate(
              [
                { textShadow: 'none', offset: 0 },
                { textShadow: '0 0 20px ' + activeColor + ', 0 0 40px ' + activeColor, offset: 0.3 },
                { textShadow: 'none', offset: 1 }
              ],
              { duration: charDuration * 6000, delay: charDelay * 1000, easing: 'ease-in-out', fill: 'forwards' }
            )
          } else {
            span.el.animate(
              [
                { textShadow: 'none', offset: 0 },
                { textShadow: '0 0 20px ' + activeColor + ', 0 0 40px ' + activeColor, offset: 0.9 },
                { textShadow: '0 0 20px ' + activeColor + ', 0 0 40px ' + activeColor, offset: 1 }
              ],
              { duration: duration * 1000, easing: 'ease-in-out', fill: 'forwards' }
            )
          }
        })
        return
      }

      // passed
      Anim.animateProps(item.el, {
        opacity: { to: intensity === 'chaotic' ? 0.9 : 0.82 },
        transform: {
          from: { x: config.x, y: config.y, scale: config.scale * 1.4, rotate: config.rotate },
          to: { x: config.x, y: config.y, scale: config.scale, rotate: config.rotate + config.passedRotate }
        }
      }, {
        duration: 0.5,
        transform: { duration: 5, ease: 'linear' }
      })
      Anim.animateProps(item.bodyLayer, {
        color: { to: baseColor },
        filter: { to: 'blur(0px)' }
      }, {
        color: { duration: reveal === 'instant' ? 0.12 : reveal === 'fast' ? 0.24 : 0.8, ease: 'easeInOut' },
        filter: { duration: reveal === 'instant' ? 0.12 : reveal === 'fast' ? 0.2 : 0.5 }
      })
      item.bodyLayer.style.filter = 'none'
      item.glowSpans.forEach(function (span) {
        span.el.animate(
          [{ textShadow: getComputedStyle(span.el).textShadow }, { textShadow: 'none' }],
          { duration: (reveal === 'instant' ? 0.12 : reveal === 'fast' ? 0.22 : 0.9) * 1000, easing: 'ease-out', fill: 'forwards' }
        )
      })
    }

    // 每帧：词状态机推进
    function updateWordStates(now) {
      for (var i = 0; i < wordEls.length; i += 1) {
        var item = wordEls[i]
        var profile = item.renderProfile
        var word = item.word
        var lookahead = profile ? profile.wordLookahead : 0.15
        var reveal = profile ? profile.wordRevealMode : 'normal'

        var lineRenderEndTime = profile ? profile.lineRenderEndTime : word.endTime
        var activeEndTime
        if (reveal === 'instant') activeEndTime = lineRenderEndTime
        else if (reveal === 'fast') activeEndTime = Math.min(lineRenderEndTime, Math.max(word.endTime, word.startTime + 0.12))
        else activeEndTime = word.endTime

        var newStatus
        if (now >= word.startTime - lookahead && now <= activeEndTime) newStatus = 'active'
        else if (now > activeEndTime) newStatus = 'passed'
        else newStatus = 'waiting'

        if (newStatus !== item.status) applyWordState(item, newStatus, now)
      }
    }

    // 整行呼吸浮动（原版 lyricContainerFloat，按强度分档）
    function startBreathingFloat() {
      if (!floatEl) return
      var configByIntensity = {
        calm: { distance: 10, duration: 8.5 },
        normal: { distance: 14, duration: 7 },
        chaotic: { distance: 18, duration: 5.8 }
      }
      var cfg = configByIntensity[intensity] || configByIntensity.normal
      Anim.animateKeyframes(floatEl, {
        transform: [
          { x: 0, y: 0, scale: 1 },
          { x: 0, y: -cfg.distance, scale: 1.01 },
          { x: 0, y: 0, scale: 1 },
          { x: 0, y: cfg.distance * 0.45, scale: 0.995 },
          { x: 0, y: 0, scale: 1 }
        ]
      }, { duration: cfg.duration, repeat: Infinity, ease: 'easeInOut' })
    }

    // 空闲提示（等待音乐）
    var emptyEl = null
    function showEmpty(show) {
      if (!lineHost) return
      if (show && !emptyEl) {
        emptyEl = document.createElement('div')
        emptyEl.style.cssText = [
          'position:absolute', 'opacity:0.5', 'font-size:1.5rem', 'transition:opacity 0.4s',
          'color:' + (theme ? theme.secondaryColor : '#71717a')
        ].join(';')
        emptyEl.textContent = '等待音乐...'
        emptyEl.style.opacity = '0'
        lineHost.appendChild(emptyEl)
        requestAnimationFrame(function () { if (emptyEl) emptyEl.style.opacity = '0.5' })
      } else if (!show && emptyEl) {
        var el = emptyEl
        emptyEl = null
        el.style.opacity = '0'
        setTimeout(function () { el.remove() }, 400)
      }
    }

    // ---------- 生命周期 ----------
    function setTheme(newTheme) {
      theme = newTheme
      if (theme && theme.animationIntensity) {
        var newIntensity = theme.animationIntensity
        if (newIntensity !== intensity) {
          intensity = newIntensity
          startBreathingFloat()
        }
      }
    }

    function setLines(lines) { /* 行数据经 tick 的 lines 传入 */ }

    function tick(frameState) {
      if (!theme) return
      var now = frameState.currentTime
      lastTime = now

      var runtimeState = Runtime.getRuntimeState({
        lines: frameState.lines,
        currentLineIndex: frameState.currentLineIndex,
        currentTime: now,
        getLineEndTime: RenderHints.getLineRenderEndTime
      })

      showText = frameState.showText !== false
      var line = runtimeState.activeLine
      var key = line ? line.startTime : null

      if (!showText || !line) {
        if (currentLineEl) {
          var old = currentLineEl
          var oldProfile = wordEls.length ? wordEls[0].renderProfile : null
          wordEls = []
          currentLineEl = null
          currentLineKey = null
          exitLine(old, oldProfile)
        }
        showEmpty(showText && !line)
        window.FoliaSubtitleOverlay.update({
          hostEl: host,
          showText: showText,
          activeLine: null,
          recentCompletedLine: runtimeState.recentCompletedLine,
          nextLines: runtimeState.nextLines,
          theme: theme
        })
        return
      }

      showEmpty(false)

      if (key !== currentLineKey) {
        var previousEl = currentLineEl
        var previousProfile = wordEls.length ? wordEls[0].renderProfile : null
        wordEls = []
        renderLine(line, frameState.lines, frameState.currentLineIndex)
        if (previousEl) exitLine(previousEl, previousProfile)
      }

      updateWordStates(now)

      window.FoliaSubtitleOverlay.update({
        hostEl: host,
        showText: showText,
        activeLine: line,
        recentCompletedLine: runtimeState.recentCompletedLine,
        nextLines: runtimeState.nextLines,
        theme: theme
      })
    }

    function destroy() {
      if (floatEl) { floatEl.remove(); floatEl = null }
      lineHost = null
      currentLineEl = null
      wordEls = []
      emptyEl = null
      window.FoliaSubtitleOverlay.destroy()
      host = null
    }

    return {
      id: 'classic',
      mount: mount,
      setTheme: setTheme,
      setLines: setLines,
      setFontScale: function (s) { fontScale = s === undefined ? 1 : s },
      tick: tick,
      destroy: destroy
    }
  }

  window.FoliaModeClassic = { create: createMode }
})()
