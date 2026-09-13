// 凝彩模式·测量与拼贴排版：移植自 folia-major src/components/visualizer/tempera/
//   temperaMeasure.ts（pretext 文本度量 + 字形内排版）
//   temperaLayout.ts（拼贴式排版：词度量、行包罗、行错位/旋转、逐字入场时序）
(function () {
  'use strict'

  var Core = window.FoliaTemperaCore
  var Profiles = window.FoliaTemperaProfiles
  var temperaHash01 = Core.temperaHash01

  // ---------- 文本度量（原版 temperaMeasure.ts） ----------
  // 词来自编译期的 Intl.Segmenter 拆分；先量整词再按该宽度归一化每字素 advance，
  // 保留 shaping/kerning 的同时仍允许逐字放置
  //
  // 度量在所有 layout 调用间共享，不限定于单次调用。缓存键写全整个规格
  // （weight size family|text），因此场景/shot/歌曲层面都不会出现同键不同值——
  // 而相同的字素反复出现：fit loop 会把一个 shot 重测最多四次，一个段落有多个 shot，
  // 相邻歌曲共享大部分字符集。单次调用的缓存把这些全扔了，还让换歌在落地那一帧
  // 全部重测
  var MEASURE_CACHE_LIMIT = 20000
  var measureCache = new Map()

  function readMeasureCache(key) {
    return measureCache.get(key)
  }

  function writeMeasureCache(key, width) {
    // 普通 FIFO 淘汰：条目重新计算的代价相同，淘汰策略只需限制内存，不必预测复用
    if (measureCache.size >= MEASURE_CACHE_LIMIT) {
      var oldest = measureCache.keys().next()
      if (!oldest.done) measureCache.delete(oldest.value)
    }
    measureCache.set(key, width)
  }

  function createTemperaMeasureContext(fontFamily, fontWeight) {
    return { cache: measureCache, fontFamily: fontFamily, fontWeight: fontWeight }
  }

  function measureText(ctx, text, fontSize) {
    var fontSpec = ctx.fontWeight + ' ' + fontSize + 'px ' + ctx.fontFamily
    var key = fontSpec + '|' + text
    var cached = readMeasureCache(key)
    if (cached !== undefined) return cached
    var measured
    try {
      // 度量经 window.Pretext（vendor，registry 保证先加载）；任何异常回退到按字数估算
      var prepare = window.Pretext.prepareWithSegments
      var layoutWithLines = window.Pretext.layoutWithLines
      var layout = layoutWithLines(prepare(text, fontSpec), 99999, fontSize * 1.2)
      measured = layout.lines[0] ? layout.lines[0].width : text.length * fontSize * 0.6
    } catch (error) {
      measured = text.length * fontSize * 0.6
    }
    var width = Math.max(fontSize * 0.08, measured)
    writeMeasureCache(key, width)
    return width
  }

  function measureTemperaGrapheme(ctx, char, fontSize) {
    return char.trim().length === 0 ? fontSize * 0.3 : measureText(ctx, char, fontSize)
  }

  // 度量一个词并把字素排进 shaped 宽度内，使每字素 advance 之和
  // 恒等于 pretext 报告的整词宽度
  function buildTemperaWordUnit(ctx, segment, lineIndex, segmentIndex, fontSize, scale) {
    var glyphs = segment.graphemes.filter(function (grapheme) { return grapheme.char.length > 0 })
    if (glyphs.length === 0) return null
    var scaledSize = fontSize * scale
    var raw = glyphs.map(function (grapheme) {
      return measureTemperaGrapheme(ctx, grapheme.char, scaledSize)
    })
    var rawTotal = raw.reduce(function (sum, value) { return sum + value }, 0)
    var shaped = measureText(ctx, segment.text.replace(/\s+$/u, ''), scaledSize)
    // 按比例分摊 shaping 差异，而不是只推单个字素
    var correction = rawTotal > 0 ? shaped / rawTotal : 1
    var offset = 0
    var placed = glyphs.map(function (grapheme, index) {
      var width = raw[index] * correction
      var glyph = {
        char: grapheme.char,
        startTime: grapheme.startTime,
        endTime: grapheme.endTime,
        offset: offset,
        width: width
      }
      offset += width
      return glyph
    })
    return {
      lineIndex: lineIndex,
      segmentIndex: segmentIndex,
      text: segment.text,
      startOffset: segment.startOffset,
      endOffset: segment.endOffset,
      // 本词之前的水平空隙，像素
      leadingGap: 0,
      // shot 基准字号的倍数；层级强调落在这里
      scale: scale,
      width: offset,
      glyphs: placed,
      startTime: placed[0].startTime,
      endTime: placed[placed.length - 1].endTime
    }
  }

  // ---------- 拼贴排版（原版 temperaLayout.ts） ----------
  var TAU = Math.PI * 2

  function isTemperaLayoutSegment(segment) {
    return segment.text.trim().length > 0
  }

  // 区域与入场向量是数据，按构图保存在 tempera-profiles
  function resolveRegion(shotKind, width, height) {
    var profile = Profiles.resolveTemperaShotProfile(shotKind)
    var r = profile.region
    return {
      centerX: r.cx * width,
      centerY: r.cy * height,
      width: r.w * width,
      height: r.h * height,
      align: r.align,
      rotation: r.rotation,
      fontScale: r.fontScale
    }
  }

  function resolveEnterVector(shotKind, fontSize) {
    var profile = Profiles.resolveTemperaShotProfile(shotKind)
    return { x: profile.enter.x * fontSize, y: profile.enter.y * fontSize }
  }

  function rotateAbout(x, y, cx, cy, angle) {
    if (angle === 0) return { x: x, y: y }
    var cos = Math.cos(angle)
    var sin = Math.sin(angle)
    var dx = x - cx
    var dy = y - cy
    return { x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos }
  }

  // 每行歌词有一个词被提升到主词尺寸；其余围绕基准轻微变化，
  // 让一行读作一组有构写的组合而不是一条均匀的条带
  function resolveWordScales(segments, seed, lineIndex) {
    var lengths = segments.map(function (segment) {
      return segment.isWordLike ? segment.graphemes.length : 0
    })
    var maxLength = Math.max(0, Math.max.apply(null, lengths))
    var heroCandidates = []
    lengths.forEach(function (length, index) {
      if (length > 0 && length >= maxLength - 1) heroCandidates.push(index)
    })
    var heroIndex = heroCandidates.length > 0
      ? heroCandidates[Math.floor(temperaHash01(seed, lineIndex, 101) * heroCandidates.length) % heroCandidates.length]
      : -1
    // 主词与余词之间的宽度差正是 shot 重心感的来源
    return segments.map(function (_, index) {
      return index === heroIndex
        ? 1.34 + temperaHash01(seed, lineIndex * 31 + index, 103) * 0.26
        : 0.7 + temperaHash01(seed, lineIndex * 31 + index, 107) * 0.16
    })
  }

  // 带种子行宽预算的贪心包罗，行因此参差。新歌词行总起新行，阅读顺序保持明显
  function packRows(words, maxWidth, seed) {
    var rows = []
    var current = []
    var currentWidth = 0
    function budgetFor(rowIndex) {
      return maxWidth * (0.72 + temperaHash01(seed, rowIndex, 109) * 0.28)
    }
    function flush() {
      if (current.length === 0) return
      rows.push({ words: current, width: currentWidth, height: 0 })
      current = []
      currentWidth = 0
    }

    words.forEach(function (word) {
      var newLine = current.length > 0 && word.lineIndex !== current[0].lineIndex
      var advance = current.length === 0 ? word.width : word.width + word.leadingGap
      if (newLine || (current.length > 0 && currentWidth + advance > budgetFor(rows.length))) flush()
      currentWidth += current.length === 0 ? word.width : advance
      current.push(word)
    })
    flush()
    return rows
  }

  // 分词的存在是为了挑字号，不是把文字撑开。词前的空隙只有在源文本确实有空白时
  // 才是真正的空格；单纯的分词边界（每个 CJK 词界）只给一个视觉微距
  function buildWordUnits(ctx, lines, fontSize, seed) {
    var units = []
    lines.forEach(function (segments, lineIndex) {
      var scales = resolveWordScales(segments, seed, lineIndex)
      var previousEnd = null
      segments.forEach(function (segment, segmentIndex) {
        var unit = buildTemperaWordUnit(ctx, segment, lineIndex, segmentIndex, fontSize, scales[segmentIndex])
        if (!unit) return
        var spaced = previousEnd !== null && segment.startOffset > previousEnd
        unit.leadingGap = previousEnd === null ? 0 : fontSize * (spaced ? 0.26 : 0.035)
        previousEnd = segment.endOffset
        units.push(unit)
      })
    })
    return units
  }

  // 任何字素能拿到的最短入场，无论 shot 节奏如何
  var MIN_SETTLE_SECONDS = 0.34
  // 入场向 shot 歌词末端拉伸程度的默认值。以 tuning（glyphSettleStretch）开放；
  // 这是两种各自试过的行为之间唯一的旋钮：
  //
  // - 0 给每个字同样的短窗口，无论它在 shot 中的位置。密集快歌读起来有打击感——
  //   每字 ~0.09s 内咬合然后停住——但慢乐句在第一秒内全部落位，之后什么都不动。
  // - 1 让整个 shot 恰好落在歌词结束那一刻。慢乐句全程保有生命，
  //   但快 shot 完全没有静止的瞬间：切镜前的平均停留归零，每个字都还在飞，
  //   文字读作一团糊。
  //
  // 0.5 让多数 shot 在切镜前落定，同时仍给长乐句一个深入 shot 的入场
  var DEFAULT_SETTLE_STRETCH = 0.5

  // 让每个入场对着本 shot 携带的歌词末端排期，然后设置唱后释放。
  //
  // 字从自己的歌词时间起步，窗口是下限加上到末端剩余距离的一份，
  // 因此错峰从第一个字到最后一个字平滑缩短，shot 作为一道扫过并收住的波到达，
  // 而不是一排各自为政的爆点。曲线前重，所以长窗口是「果断的开场 + 慢爬」，
  // 不是慢吞吞地飘进来。
  //
  // 目标是 shot 自己的歌词末端。默认切分模式下 shot 只显示半句，一条源行常横跨
  // 多个 shot；整句模式则让 shot 末端等于该行的歌词末端。两种情况下传入的 lines
  // 都已是该 shot 携带的精确切片集合，同屏的切片按同一末端排期。
  // 只在末端下限之内起步的字才会在末端之后落位。
  //
  // alpha 与浮影斜坡不跟随这个窗口（见 tempera-core 运动求解）：
  // 半透明撑满一个 shot 的字可读不了。
  //
  // 释放是独立的：一唱完就停下的字会让整行在长 shot 里冻住，
  // 所以块从中心向外缓慢张开字距，每个字的力臂就是它到中心的偏移。
  // 斜坡与该字所在行一样长，不再更长
  function applyGlyphTiming(placements, settleStretch) {
    if (placements.length === 0) return placements
    var stretch = Number.isFinite(settleStretch)
      ? Math.min(1, Math.max(0, settleStretch))
      : DEFAULT_SETTLE_STRETCH
    var lineSpans = new Map()
    placements.forEach(function (placement) {
      var current = lineSpans.has(placement.lineIndex) ? lineSpans.get(placement.lineIndex) : 0
      lineSpans.set(placement.lineIndex, Math.max(current, placement.endTime))
    })
    var lineStarts = new Map()
    placements.forEach(function (placement) {
      var current = lineStarts.has(placement.lineIndex)
        ? lineStarts.get(placement.lineIndex)
        : Number.POSITIVE_INFINITY
      lineStarts.set(placement.lineIndex, Math.min(current, placement.startTime))
    })

    // 这里的每个 placement 都属于正在排版的那一个 shot
    var shotLyricEnd = placements.reduce(function (latest, p) { return Math.max(latest, p.endTime) }, 0)
    placements.forEach(function (placement) {
      var reach = Math.max(0, shotLyricEnd - placement.startTime - MIN_SETTLE_SECONDS)
      placement.settleTime = placement.startTime + MIN_SETTLE_SECONDS + reach * stretch
    })
    // 文字块的中心；外扩从这里度量，排版保持原形，只有间距张开
    var centerX = placements.reduce(function (sum, placement) { return sum + placement.x }, 0) / placements.length
    var centerY = placements.reduce(function (sum, placement) { return sum + placement.y }, 0) / placements.length
    placements.forEach(function (placement) {
      var span = Math.max(
        0.5,
        (lineSpans.has(placement.lineIndex) ? lineSpans.get(placement.lineIndex) : placement.endTime)
        - (lineStarts.has(placement.lineIndex) ? lineStarts.get(placement.lineIndex) : placement.startTime)
      )
      placement.releaseTime = Math.max(placement.endTime, placement.settleTime) + span
      placement.trackingX = placement.x - centerX
      placement.trackingY = placement.y - centerY
    })

    return placements
  }

  // 排版入口：量词 → 行包罗 → fit loop → 行错位/旋转 → 逐字入场向量与时序
  function resolveTemperaLayout(options) {
    var lines = options.lines
    var shotKind = options.shotKind
    var width = options.width
    var height = options.height
    var baseFontSize = options.baseFontSize
    var fontFamily = options.fontFamily
    var fontWeight = options.fontWeight
    var seed = options.seed
    var segmentColors = options.segmentColors
    var settleStretch = options.settleStretch === undefined ? DEFAULT_SETTLE_STRETCH : options.settleStretch

    var region = resolveRegion(shotKind, width, height)
    var ctx = createTemperaMeasureContext(fontFamily, fontWeight)

    // fit loop：收缩字号直到包罗出的行装进区域
    var fontSize = Math.max(14, baseFontSize * region.fontScale)
    var rows = []
    var blockHeight = 0
    for (var attempt = 0; attempt < 4; attempt += 1) {
      rows = packRows(buildWordUnits(ctx, lines, fontSize, seed), region.width, seed)
      rows.forEach(function (row, rowIndex) {
        var tallest = Math.max.apply(null, row.words.map(function (word) { return word.scale }))
        // 紧行距：块要读作一团，而不是散开的行
        row.height = fontSize * tallest * (1.02 + temperaHash01(seed, rowIndex, 113) * 0.1)
      })
      blockHeight = rows.reduce(function (sum, row) { return sum + row.height }, 0)
      var maxRowWidth = Math.max(1, Math.max.apply(null, rows.map(function (row) { return row.width })))
      var fit = Math.min(
        1,
        blockHeight > region.height ? region.height / blockHeight : 1,
        maxRowWidth > region.width ? region.width / maxRowWidth : 1
      )
      if (fit >= 0.999) break
      fontSize *= fit
    }

    var base = resolveEnterVector(shotKind, fontSize)
    var baseAngle = Math.atan2(base.y, base.x)
    var baseMagnitude = Math.hypot(base.x, base.y)
    var placements = []
    var cursorY = region.centerY - blockHeight / 2

    rows.forEach(function (row, rowIndex) {
      var rowCenterY = cursorY + row.height / 2
      cursorY += row.height
      // 行横向错开并微微倾斜；这就是层叠拼贴的读感
      var drift = (temperaHash01(seed, rowIndex, 127) - 0.5) * region.width * 0.06
      var rowRotation = (temperaHash01(seed, rowIndex, 131) - 0.5) * 0.06
      var rowLeft = region.align === 'center'
        ? region.centerX - row.width / 2 + drift
        : region.align === 'left'
          ? region.centerX - region.width / 2 + Math.abs(drift) * 0.6
          : region.centerX + region.width / 2 - row.width - Math.abs(drift) * 0.6
      var rowCenterX = rowLeft + row.width / 2

      var cursorX = rowLeft
      row.words.forEach(function (word, wordIndex) {
        var salt = rowIndex * 37 + wordIndex
        // 每词一种入场样式：相邻的词以不同方式到达，但一个词从不拆成几种动作
        var enterStyle = Core.TEMPERA_ENTER_STYLES[
          Math.floor(temperaHash01(seed, salt, 193) * Core.TEMPERA_ENTER_STYLES.length)
          % Core.TEMPERA_ENTER_STYLES.length
        ]
        var wordRotation = (temperaHash01(seed, salt, 137) - 0.5) * 0.07
        var wordShiftY = (temperaHash01(seed, salt, 139) - 0.5) * fontSize * 0.09
        var wordLeft = cursorX + (wordIndex === 0 ? 0 : word.leadingGap)
        cursorX = wordLeft + word.width
        var wordCenterX = wordLeft + word.width / 2
        var wordCenterY = rowCenterY + wordShiftY
        var glyphSize = fontSize * word.scale

        word.glyphs.forEach(function (glyph, glyphIndex) {
          if (glyph.char.trim().length === 0) return
          var localX = wordLeft + glyph.offset + glyph.width / 2
          var rotatedWord = rotateAbout(localX, wordCenterY, wordCenterX, wordCenterY, wordRotation)
          var rotatedRow = rotateAbout(rotatedWord.x, rotatedWord.y, rowCenterX, rowCenterY, rowRotation)
          var finalPoint = rotateAbout(
            rotatedRow.x,
            rotatedRow.y,
            region.centerX,
            region.centerY,
            region.rotation
          )

          // 逐字入场：shot 的基准方向扇出并重新赋幅，同一行里没有两个字
          // 在完全相同的向量上到达
          var glyphSalt = salt * 53 + glyphIndex
          var spread = (temperaHash01(seed, glyphSalt, 149) - 0.5) * 1.7
          var magnitude = baseMagnitude * (0.55 + temperaHash01(seed, glyphSalt, 151) * 1.05)
          var angle = baseAngle + spread
          placements.push({
            char: glyph.char,
            lineIndex: word.lineIndex,
            segmentIndex: word.segmentIndex,
            x: finalPoint.x,
            y: finalPoint.y,
            rotation: region.rotation + rowRotation + wordRotation,
            startTime: glyph.startTime,
            endTime: glyph.endTime,
            settleTime: glyph.endTime,
            fontSize: glyphSize,
            color: (segmentColors && segmentColors[word.lineIndex] && segmentColors[word.lineIndex][word.segmentIndex] !== undefined)
              ? segmentColors[word.lineIndex][word.segmentIndex]
              : null,
            enterX: Math.cos(angle) * magnitude,
            enterY: Math.sin(angle) * magnitude,
            enterRotation: (temperaHash01(seed, glyphSalt, 157) - 0.5) * 0.7,
            enterScale: 0.6 + temperaHash01(seed, glyphSalt, 163) * 0.3,
            enterStyle: enterStyle,
            releaseTime: 0,
            trackingX: 0,
            trackingY: 0
          })
        })
      })
    })

    return applyGlyphTiming(placements, settleStretch)
  }

  window.FoliaTemperaMeasure = {
    createTemperaMeasureContext: createTemperaMeasureContext,
    measureTemperaGrapheme: measureTemperaGrapheme,
    buildTemperaWordUnit: buildTemperaWordUnit,
    isTemperaLayoutSegment: isTemperaLayoutSegment,
    resolveTemperaLayout: resolveTemperaLayout,
    clearMeasureCache: function () { measureCache.clear() }
  }
})()
