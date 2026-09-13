// 云阶模式：移植自 folia-major src/components/visualizer/partita/VisualizerPartita.tsx
// 词驱动，但先构建"块/行"分块结构：把行切成不均匀的 chunk，奇偶行左右交错（stagger 是云阶的招牌），
// 块内词再用与流光同款的三态动画。支持引导线装饰（showGuideLines 默认开）。
(function () {
  'use strict'

  var Anim = window.FoliaAnim
  var Runtime = window.FoliaVisualizerRuntime
  var RenderHints = window.FoliaRenderHints
  var Layout = window.FoliaCjkSemanticLayout
  var WordColoring = window.FoliaWordColoring
  var GraphemeTiming = window.FoliaGraphemeTiming

  // 原版 DEFAULT_PARTITA_TUNING
  var TUNING = { showGuideLines: true, useSemanticLayout: true, staggerMin: 20, staggerMax: 100 }
  var PREHEAT_WINDOW = { minLead: 0.18, maxLead: 1.2 }
  var LAYOUT_CACHE_LIMIT = 48

  function splitGraphemes(text) {
    return GraphemeTiming.splitLyricGraphemes(text)
  }

  function createMode() {
    var host = null
    var floatEl = null
    var lineHost = null
    var currentLineEl = null
    var currentLineKey = null
    var words = []          // [{el, glowSpans, bodyLayer, word, config, renderProfile, status, baseColor, activeColor}]
    var chunks = []         // [{el, guideEls, chunkWords, displayWords, config, renderProfile, status, activeColor, guidePosition}]
    var theme = null
    var fontScale = 1
    var showText = true
    var layoutCache = new Map()

    function mount(hostEl) {
      host = hostEl

      floatEl = document.createElement('div')
      floatEl.className = 'folia-mode-partita'
      floatEl.style.cssText = [
        'position:absolute', 'left:0', 'right:0', 'top:0', 'height:70vh', 'z-index:10',
        'display:flex', 'align-items:center', 'justify-content:center', 'padding:32px',
        'pointer-events:none', 'will-change:transform'
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

    // ---------- 分块布局（原版 buildSequentialColumns） ----------
    function buildSequentialColumns(line, windowHeight) {
      var isChaotic = theme.animationIntensity === 'chaotic'
      var isCalm = theme.animationIntensity === 'calm'
      var strippedText = line.fullText.replace(/\s+/g, '')
      var totalGraphemes = Math.max(splitGraphemes(strippedText).length, line.words.length, 1)
      var layoutUnits = Layout.buildPostLyricLayoutUnits(line, { semantic: TUNING.useSemanticLayout, sticky: true })

      var columnWords = []
      var baseRowHeight = 100
      var availableHeight = windowHeight * 0.65
      var targetRowCount = Math.max(1, Math.floor(availableHeight / baseRowHeight))
      var actualRowCount = Math.min(layoutUnits.length, targetRowCount)

      var seed = line.startTime
      var random = function () {
        var x = Math.sin(seed++) * 10000
        return x - Math.floor(x)
      }

      var chunkList = []
      var remainingUnits = layoutUnits.length
      var remainingChunks = actualRowCount
      var unitIndex = 0

      // 块长刻意不均匀：完全均匀切分太机械，会杀死手写乐谱感
      for (var c = 0; c < actualRowCount; c += 1) {
        var isLastChunk = c === actualRowCount - 1
        var avg = remainingUnits / remainingChunks

        var chunkLength = 1
        if (isLastChunk) {
          chunkLength = remainingUnits
        } else {
          var max = Math.ceil(avg * 1.5)
          var min = 1
          var randVal = random()
          chunkLength = Math.max(min, Math.min(max, Math.round(avg + (randVal - 0.5) * avg)))
        }

        chunkLength = Math.max(1, Math.min(chunkLength, remainingUnits - (remainingChunks - 1)))

        chunkList.push(layoutUnits.slice(unitIndex, unitIndex + chunkLength))
        unitIndex += chunkLength
        remainingUnits -= chunkLength
        remainingChunks -= 1
      }

      chunkList.forEach(function (chunkUnits, rowIndex) {
        var chunkWords = []
        chunkUnits.forEach(function (unit) { chunkWords = chunkWords.concat(unit.words) })
        var displayWords = Layout.buildDisplayWordsFromLayoutUnits(chunkUnits)
        if (chunkWords.length === 0) return

        var mergedTextForConfig = chunkWords.map(function (w) { return w.text.trim() }).join('')
        var graphemeCount = splitGraphemes(mergedTextForConfig.replace(/\s+/g, '')).length
        var rowBias = rowIndex - (actualRowCount - 1) / 2
        var isStaggeredLeft = rowIndex % 2 === 0

        // stagger 是云阶的核心动作：块位置错落有致但整体仍是一条可读的行
        var staggerMagnitude = TUNING.staggerMin + random() * Math.max(TUNING.staggerMax - TUNING.staggerMin, 0)
        var staggerX = isStaggeredLeft ? -staggerMagnitude : staggerMagnitude
        var staggerScale = isCalm ? 1 : 0.8 + random() * 0.9

        columnWords.push({
          chunkUnits: chunkUnits,
          chunkWords: chunkWords,
          displayWords: displayWords,
          order: rowIndex,
          rowIndex: rowIndex,
          config: {
            x: staggerX,
            y: isCalm ? 0 : rowBias * 2.5,
            rotate: isChaotic ? (isStaggeredLeft ? -3 : 3) : 0,
            scale: (isChaotic ? 1 + Math.min(graphemeCount * 0.01, 0.05) : 1) * staggerScale,
            marginBottom: isChaotic ? '0.4rem' : '0.6rem',
            alignSelf: 'center',
            passedRotate: (rowIndex % 2 === 0 ? 1 : -1) * (isChaotic ? 6 : 3)
          }
        })
      })

      return {
        columns: columnWords.length > 0 ? [{ id: 'column-' + line.startTime + '-0', words: columnWords }] : [],
        totalGraphemes: totalGraphemes,
        lineConfig: {
          perspective: theme.animationIntensity === 'chaotic' ? 720 : 1000,
          columnGap: '2rem'
        }
      }
    }

    function getLayoutKey(line, windowHeight) {
      var windowHeightBucket = Math.round(windowHeight / 24)
      return [
        'semantic-layout-v1',
        line.startTime, line.endTime, line.words.length, line.fullText,
        window.FoliaWordSegmentation.getWordSegmentationKey(line),
        theme.animationIntensity, theme.fontWeight || 'auto',
        windowHeightBucket, TUNING.staggerMin, TUNING.staggerMax,
        TUNING.showGuideLines ? 1 : 0, TUNING.useSemanticLayout ? 1 : 0
      ].join('|')
    }

    function getOrBuildLayout(line, windowHeight) {
      var cacheKey = getLayoutKey(line, windowHeight)
      var cached = layoutCache.get(cacheKey)
      if (cached) return cached

      var layout = buildSequentialColumns(line, windowHeight)
      layoutCache.set(cacheKey, layout)
      if (layoutCache.size > LAYOUT_CACHE_LIMIT) {
        var oldestKey = layoutCache.keys().next().value
        layoutCache.delete(oldestKey)
      }
      return layout
    }

    // ---------- 行渲染 ----------
    function resolveLineRenderProfile(line) {
      if (!line) return null
      var renderHints = RenderHints.getLineRenderHints(line)
      var wordRevealMode = renderHints ? renderHints.wordRevealMode : 'normal'
      return {
        renderHints: renderHints,
        lineRenderEndTime: RenderHints.getLineRenderEndTime(line),
        lineTransitionMode: renderHints ? renderHints.lineTransitionMode : 'normal',
        wordRevealMode: wordRevealMode,
        wordLookahead: wordRevealMode === 'instant' ? 0.03 : wordRevealMode === 'fast' ? 0.08 : 0.15
      }
    }

    function getWordActiveEndTime(word, profile) {
      if (profile.wordRevealMode === 'instant') return profile.lineRenderEndTime
      if (profile.wordRevealMode === 'fast') return Math.min(profile.lineRenderEndTime, Math.max(word.endTime, word.startTime + 0.12))
      return word.endTime
    }

    function lineContainerMotion(profile) {
      var mode = profile ? profile.lineTransitionMode : 'normal'
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

    function getMainFontSize(totalGraphemes) {
      var densityScale = totalGraphemes > 40 ? 0.8 : 1
      var rem = 16
      return Math.max(2.5 * densityScale * fontScale * rem, Math.min(5.5 * densityScale * fontScale * window.innerWidth / 100, 4.5 * densityScale * fontScale * rem))
    }

    function renderLine(line, currentLineIndex) {
      if (!lineHost || !theme) return
      var profile = resolveLineRenderProfile(line)
      var motion = lineContainerMotion(profile)
      var windowHeight = window.innerHeight
      var layout = getOrBuildLayout(line, windowHeight)

      var lineEl = document.createElement('div')
      lineEl.style.cssText = [
        'display:flex', 'flex-direction:row-reverse', 'align-items:stretch', 'justify-content:center',
        'width:100%', 'max-width:64rem',
        'perspective:' + layout.lineConfig.perspective + 'px', 'gap:' + layout.lineConfig.columnGap,
        'min-height:320px', 'will-change:transform,opacity,filter', 'pointer-events:none'
      ].join(';')

      // 进场
      lineEl.style.opacity = String(motion.initial.opacity)
      lineEl.style.transform = Anim.transformStr({ scale: motion.initial.scale })
      lineEl.style.filter = motion.initial.filter
      requestAnimationFrame(function () {
        if (!lineEl.isConnected) return
        Anim.animateProps(lineEl, {
          opacity: { from: motion.initial.opacity, to: motion.animate.opacity },
          transform: { from: { scale: motion.initial.scale }, to: { scale: motion.animate.scale } },
          filter: { from: motion.initial.filter, to: motion.animate.filter }
        }, { duration: motion.animate.duration || 0.16 })
      })

      var fontSize = getMainFontSize(layout.totalGraphemes)

      layout.columns.forEach(function (column) {
        var columnEl = document.createElement('div')
        columnEl.style.cssText = [
          'position:relative', 'display:flex', 'min-height:24rem', 'min-width:3.8rem',
          'align-items:center', 'justify-content:center', 'padding:0 12px'
        ].join(';')

        var inner = document.createElement('div')
        inner.style.cssText = 'position:relative;z-index:10;display:flex;flex-direction:column;align-items:center;justify-content:flex-start'

        column.words.forEach(function (entry) {
          buildChunk(inner, entry, profile, fontSize)
        })

        columnEl.appendChild(inner)
        lineEl.appendChild(columnEl)
      })

      lineHost.appendChild(lineEl)
      currentLineEl = lineEl
      currentLineKey = line.startTime
    }

    // ---------- 块（PartitaChunk：结构包装 + 引导线） ----------
    function buildChunk(parent, entry, profile, fontSize) {
      var config = entry.config
      var displayWords = entry.displayWords
      var chunkWords = entry.chunkWords

      var chunkEl = document.createElement('div')
      chunkEl.style.cssText = [
        'display:inline-flex', 'transform-origin:center', 'position:relative',
        'white-space:nowrap', 'align-items:center', 'justify-content:center', 'flex-direction:row',
        'margin-bottom:' + config.marginBottom, 'line-height:1',
        'padding:0.2rem 0.5rem', 'will-change:transform,opacity'
      ].join(';')
      if (config.alignSelf !== 'auto') chunkEl.style.alignSelf = config.alignSelf

      var activeColor = WordColoring.resolveWordColor(displayWords.map(function (w) { return w.text }).join(' '), theme.wordColors, theme.accentColor)
      var guidePosition = entry.rowIndex % 2 === 0 ? 'left' : 'right'

      var guideEls = []
      if (TUNING.showGuideLines) {
        var isLeft = guidePosition === 'left'
        var sideKey = isLeft ? 'left' : 'right'
        // 竖线
        var vGuide = document.createElement('span')
        vGuide.style.cssText = [
          'position:absolute', 'width:1px', 'pointer-events:none',
          sideKey + ':-8px', 'bottom:-16px', 'height:32px', 'transform-origin:bottom',
          'background-color:rgba(255,255,255,0.14)', 'transform:scaleY(0)', 'opacity:0',
          'transition:background-color 0.4s, box-shadow 0.4s'
        ].join(';')
        // 横线
        var hGuide = document.createElement('span')
        hGuide.style.cssText = [
          'position:absolute', 'height:1px', 'pointer-events:none',
          sideKey + ':-16px', 'bottom:-8px', 'width:calc(100% + 36px)', 'transform-origin:' + sideKey,
          'background-color:rgba(255,255,255,0.14)', 'transform:scaleX(0)', 'opacity:0',
          'transition:background-color 0.4s, box-shadow 0.4s'
        ].join(';')
        chunkEl.appendChild(vGuide)
        chunkEl.appendChild(hGuide)
        guideEls.push(vGuide, hGuide)
      }

      // 块内每词的随机偏移
      displayWords.forEach(function (w, idx) {
        var wordSeed = displayWords[0].startTime + idx * 7.13
        var random = function (offset) {
          var x = Math.sin(wordSeed + offset) * 10000
          return x - Math.floor(x)
        }

        var isCalm = theme.animationIntensity === 'calm'
        var isChaotic = theme.animationIntensity === 'chaotic'
        var baseSpread = isChaotic ? 15 : isCalm ? 0 : 6
        var baseRotate = isChaotic ? 8 : isCalm ? 0 : 3

        var wordConfig = {
          x: (random(1) - 0.5) * baseSpread * 2,
          y: (random(2) - 0.5) * baseSpread * 2,
          rotate: (random(3) - 0.5) * baseRotate * 2,
          scale: config.scale,
          passedRotate: (random(8) - 0.5) * 20
        }

        buildWord(chunkEl, w, wordConfig, profile, fontSize)
      })

      parent.appendChild(chunkEl)
      chunks.push({
        el: chunkEl,
        guideEls: guideEls,
        chunkWords: chunkWords,
        config: config,
        renderProfile: profile,
        status: null,
        activeColor: activeColor,
        guidePosition: guidePosition
      })
    }

    // ---------- 词（与 classic 同款三态结构） ----------
    function buildWord(parent, word, config, profile, fontSize) {
      var wordEl = document.createElement('div')
      wordEl.style.cssText = [
        'display:inline-block', 'transform-origin:center', 'position:relative',
        'will-change:transform', 'white-space:nowrap',
        'font-size:' + fontSize + 'px', 'font-weight:700', 'line-height:1.22',
        'margin-right:0.8rem'
      ].join(';')

      var glowLayer = document.createElement('span')
      glowLayer.style.cssText = 'position:absolute;inset:0;user-select:none;pointer-events:none;display:block;color:transparent'

      var graphemeTimings = GraphemeTiming.buildWordGraphemeTimings(word)
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

      var bodyLayer = document.createElement('span')
      bodyLayer.style.cssText = 'position:relative;z-index:10;display:block;color:' + theme.primaryColor + ';filter:blur(10px)'
      bodyLayer.textContent = word.text

      wordEl.appendChild(glowLayer)
      wordEl.appendChild(bodyLayer)
      parent.appendChild(wordEl)

      words.push({
        el: wordEl,
        glowSpans: glowSpans,
        bodyLayer: bodyLayer,
        word: word,
        config: config,
        renderProfile: profile,
        status: null,
        baseColor: theme.primaryColor,
        activeColor: WordColoring.resolveWordColor(word.text, theme.wordColors, theme.accentColor)
      })
    }

    // 块状态机（waiting 偏移隐身 / active spring / passed 常驻）
    function applyChunkState(item, newStatus) {
      item.status = newStatus
      var config = item.config
      var activeColor = item.activeColor
      var waiting = newStatus === 'waiting'

      Anim.animateProps(item.el, {
        opacity: { to: waiting ? 0 : 1 },
        transform: {
          from: waiting
            ? { x: config.x + (item.guidePosition === 'left' ? -40 : 40), y: config.y, scale: 0.85, rotate: config.rotate }
            : { x: config.x + (item.guidePosition === 'left' ? -40 : 40), y: config.y, scale: 0.85, rotate: config.rotate },
          to: waiting
            ? { x: config.x + (item.guidePosition === 'left' ? -40 : 40), y: config.y, scale: 0.85, rotate: config.rotate }
            : { x: config.x, y: config.y, scale: 1, rotate: config.rotate }
        }
      }, newStatus === 'active'
        ? { type: 'spring', stiffness: 200, damping: 20, opacity: { duration: 0.1 } }
        : { duration: 0.4, ease: 'easeOut' })

      // 引导线颜色/发光
      var guideColor = newStatus === 'active'
        ? activeColor
        : newStatus === 'passed' ? 'rgba(255,255,255,0.22)' : 'rgba(255,255,255,0.14)'
      var guideShadow = newStatus === 'active' ? '0 0 10px ' + activeColor : 'none'
      item.guideEls.forEach(function (guide, index) {
        guide.style.backgroundColor = guideColor
        guide.style.boxShadow = newStatus === 'active' ? (index === 0 ? guideShadow + '45' : guideShadow + '35') : 'none'
        var scaleProp = index === 0 ? 'transform' : 'transform'
        guide.animate(
          [
            { transform: index === 0 ? 'scaleY(0)' : 'scaleX(0)', opacity: 0 },
            { transform: index === 0 ? 'scaleY(1)' : 'scaleX(1)', opacity: 1 }
          ],
          { duration: 400, easing: 'ease-out', fill: 'forwards' }
        )
      })
    }

    // 词状态机（复用 classic 的三态逻辑，块位置由 chunk 容器持有）
    function applyWordState(item, newStatus) {
      var config = item.config
      var word = item.word
      var profile = item.renderProfile
      var activeColor = item.activeColor
      var baseColor = item.baseColor
      var reveal = profile ? profile.wordRevealMode : 'normal'

      var lineRenderEndTime = profile ? profile.lineRenderEndTime : word.endTime
      var activeEndTime
      if (reveal === 'instant') activeEndTime = lineRenderEndTime
      else if (reveal === 'fast') activeEndTime = Math.min(lineRenderEndTime, Math.max(word.endTime, word.startTime + 0.12))
      else activeEndTime = word.endTime
      var minDuration = reveal === 'instant' ? 0.08 : reveal === 'fast' ? 0.12 : 0.1
      var duration = Math.max(activeEndTime - word.startTime, minDuration)

      if (newStatus === 'waiting') {
        Anim.animateProps(item.el, {
          opacity: { to: 0 },
          transform: {
            from: { x: config.x, y: config.y, scale: config.scale * 1.4, rotate: config.rotate },
            to: { x: config.x + (Math.sin(config.y) * 100), y: config.y + (Math.cos(config.x) * 50), scale: 0.5, rotate: config.rotate + 20 }
          }
        }, { duration: 0.4 })
        Anim.animateProps(item.bodyLayer, {
          color: { to: baseColor },
          filter: { to: 'blur(10px)' }
        }, { duration: 0.4 })
        item.glowSpans.forEach(function (span) { span.el.style.textShadow = 'none' })
        return
      }

      if (newStatus === 'active') {
        Anim.animateProps(item.el, {
          opacity: { to: 1 },
          transform: {
            from: { x: config.x + (Math.sin(config.y) * 100), y: config.y + (Math.cos(config.x) * 50), scale: 0.5, rotate: config.rotate + 20 },
            to: { x: config.x, y: config.y, scale: config.scale * 1.4, rotate: config.rotate }
          }
        }, { type: 'spring', stiffness: 200, damping: 20, opacity: { duration: 0.1 } })
        Anim.animateProps(item.bodyLayer, {
          color: { from: baseColor, to: activeColor },
          filter: { from: 'blur(10px)', to: 'blur(0px)' }
        }, {
          color: { duration: duration },
          filter: { duration: reveal === 'instant' ? 0.08 : reveal === 'fast' ? 0.12 : 0.2 }
        })
        item.bodyLayer.style.filter = 'none'
        item.glowSpans.forEach(function (span) {
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
        opacity: { to: theme.animationIntensity === 'chaotic' ? 0.9 : 0.82 },
        transform: {
          from: { x: config.x, y: config.y, scale: config.scale * 1.4, rotate: config.rotate },
          to: { x: config.x, y: config.y, scale: config.scale, rotate: config.rotate + config.passedRotate }
        }
      }, { duration: 0.5, transform: { duration: 5, ease: 'linear' } })
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

    function updateWordStates(now) {
      for (var i = 0; i < words.length; i += 1) {
        var item = words[i]
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

        if (newStatus !== item.status) applyWordState(item, newStatus)
      }
    }

    function updateChunkStates(now) {
      for (var i = 0; i < chunks.length; i += 1) {
        var item = chunks[i]
        var profile = item.renderProfile
        var chunkWords = item.chunkWords
        if (!chunkWords.length) continue
        var chunkStartTime = chunkWords[0].startTime
        var chunkEndTime = getWordActiveEndTime(chunkWords[chunkWords.length - 1], profile)
        var lookahead = profile ? profile.wordLookahead : 0.15

        var newStatus
        if (now >= chunkStartTime - lookahead && now <= chunkEndTime) newStatus = 'active'
        else if (now > chunkEndTime) newStatus = 'passed'
        else newStatus = 'waiting'

        if (newStatus !== item.status) applyChunkState(item, newStatus)
      }
    }

    function startBreathingFloat() {
      if (!floatEl) return
      var configByIntensity = {
        calm: { distance: 10, duration: 8.5 },
        normal: { distance: 14, duration: 7 },
        chaotic: { distance: 18, duration: 5.8 }
      }
      var cfg = configByIntensity[theme.animationIntensity] || configByIntensity.normal
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

    var emptyEl = null
    function showEmpty(show) {
      if (!lineHost) return
      if (show && !emptyEl) {
        emptyEl = document.createElement('div')
        emptyEl.style.cssText = [
          'position:absolute', 'font-size:1.9rem', 'color:' + theme.secondaryColor,
          'transition:opacity 0.4s'
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

    function exitLine(line, profile) {
      if (!line) return
      var motion = lineContainerMotion(profile)
      Anim.animateProps(line, {
        opacity: { to: motion.exit.opacity },
        transform: { to: { scale: motion.exit.scale } },
        filter: { to: motion.exit.filter }
      }, { duration: motion.exit.duration })
      var el = line
      setTimeout(function () { el.remove() }, Math.max(motion.exit.duration * 1000 + 60, 120))
    }

    function setTheme(newTheme) {
      theme = newTheme
      if (theme && theme.animationIntensity) startBreathingFloat()
    }

    function setLines() { /* 行数据经 tick 传入 */ }

    function tick(frameState) {
      if (!theme) return
      var now = frameState.currentTime

      var runtimeState = Runtime.getRuntimeState({
        lines: frameState.lines,
        currentLineIndex: frameState.currentLineIndex,
        currentTime: now,
        getLineEndTime: RenderHints.getLineRenderEndTime
      })

      showText = frameState.showText !== false
      var line = runtimeState.activeLine

      // 预热下一行布局
      if (runtimeState.upcomingLine && Runtime.shouldPreheatLine(runtimeState.upcomingLine, now, PREHEAT_WINDOW)) {
        getOrBuildLayout(runtimeState.upcomingLine, window.innerHeight)
      }

      if (!showText || !line) {
        if (currentLineEl) {
          var old = currentLineEl
          var oldProfile = chunks.length ? chunks[0].renderProfile : null
          words = []
          chunks = []
          currentLineEl = null
          currentLineKey = null
          exitLine(old, oldProfile)
        }
        showEmpty(showText && !line)
        window.FoliaSubtitleOverlay.update({
          hostEl: host, showText: showText, activeLine: null,
          recentCompletedLine: runtimeState.recentCompletedLine,
          nextLines: runtimeState.nextLines, theme: theme
        })
        return
      }

      showEmpty(false)

      if (line.startTime !== currentLineKey) {
        var previousEl = currentLineEl
        var previousProfile = chunks.length ? chunks[0].renderProfile : null
        words = []
        chunks = []
        renderLine(line, frameState.currentLineIndex)
        if (previousEl) exitLine(previousEl, previousProfile)
      }

      updateChunkStates(now)
      updateWordStates(now)

      window.FoliaSubtitleOverlay.update({
        hostEl: host, showText: showText, activeLine: line,
        recentCompletedLine: runtimeState.recentCompletedLine,
        nextLines: runtimeState.nextLines, theme: theme
      })
    }

    function destroy() {
      if (floatEl) { floatEl.remove(); floatEl = null }
      lineHost = null
      currentLineEl = null
      words = []
      chunks = []
      layoutCache.clear()
      emptyEl = null
      window.FoliaSubtitleOverlay.destroy()
      host = null
    }

    return {
      id: 'partita',
      mount: mount,
      setTheme: setTheme,
      setLines: setLines,
      setFontScale: function (s) { fontScale = s === undefined ? 1 : s },
      tick: tick,
      destroy: destroy
    }
  }

  window.FoliaModePartita = { create: createMode }
})()
