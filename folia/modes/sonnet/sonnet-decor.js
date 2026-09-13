// 商籁模式·背景装饰层：移植自 folia-major
//   sonnet/sonnetAnimatedGraphics.ts（记录 Graphics 命令，随共享错峰日程生长）
//   sonnet/sonnetSpatialMgGeometry.ts（确定性变体选取 + 空间几何配方）
//   sonnet/sonnetShotMgViewport.ts（过扫描出血范围）
//   sonnet/sonnetBackgroundMgVariants.ts（背景 HUD 构图变体）
//   sonnet/sonnetBackgroundDecor.ts（漂浮粒子装饰变体）
//   sonnet/sonnetFixedGeoVariants.ts（固定几何构图变体）
(function () {
  'use strict'

  var Core = window.FoliaSonnetCore
  var hashSonnetSeed = Core.hashSonnetSeed
  var mixSonnetSeed = Core.mixSonnetSeed
  var sonnetHash01 = Core.sonnetHash01

  // ---------- 视口出血（原版 sonnetShotMgViewport.ts） ----------
  function resolveSonnetShotMgBleed(width, height, radius) {
    return {
      x: Math.max(radius * 0.92, width * 0.64),
      y: Math.max(radius * 0.92, height * 0.64)
    }
  }

  // ---------- 动画图形（原版 sonnetAnimatedGraphics.ts） ----------
  // 记录 Graphics 命令，让描边/填充随共享错峰日程在播放期间生长，
  // 而不是在场景构建时就完整绘制。
  class AnimatedGraphics {
    constructor(pixi) {
      this.display = new pixi.Graphics()
      this.commands = []
      this.currentPath = []
      this.currentLength = 0
      this.lastX = 0
      this.lastY = 0
      this.staggerScheduled = false
    }

    get rotation() { return this.display.rotation }
    set rotation(v) { this.display.rotation = v }

    get mask() { return this.display.mask }
    set mask(v) { this.display.mask = v }

    moveTo(x, y) {
      this.currentPath.push({ type: 'moveTo', x: x, y: y })
      this.lastX = x
      this.lastY = y
      return this
    }

    lineTo(x, y) {
      var len = Math.hypot(x - this.lastX, y - this.lastY)
      this.currentPath.push({ type: 'lineTo', x: x, y: y, len: len, lastX: this.lastX, lastY: this.lastY })
      this.currentLength += len
      this.lastX = x
      this.lastY = y
      return this
    }

    quadraticCurveTo(cx, cy, tx, ty) {
      var len = Math.hypot(cx - this.lastX, cy - this.lastY) + Math.hypot(tx - cx, ty - cy)
      this.currentPath.push({ type: 'quadraticCurveTo', cx: cx, cy: cy, tx: tx, ty: ty, len: len, lastX: this.lastX, lastY: this.lastY })
      this.currentLength += len
      this.lastX = tx
      this.lastY = ty
      return this
    }

    bezierCurveTo(c1x, c1y, c2x, c2y, tx, ty) {
      var len = Math.hypot(c1x - this.lastX, c1y - this.lastY)
        + Math.hypot(c2x - c1x, c2y - c1y)
        + Math.hypot(tx - c2x, ty - c2y)
      this.currentPath.push({ type: 'bezierCurveTo', c1x: c1x, c1y: c1y, c2x: c2x, c2y: c2y, tx: tx, ty: ty, len: len, lastX: this.lastX, lastY: this.lastY })
      this.currentLength += len
      this.lastX = tx
      this.lastY = ty
      return this
    }

    arc(cx, cy, r, start, end, anticlockwise) {
      if (anticlockwise === undefined) anticlockwise = false
      var diff = end - start
      if (anticlockwise && diff > 0) diff -= Math.PI * 2
      else if (!anticlockwise && diff < 0) diff += Math.PI * 2
      var len = Math.abs(diff) * r
      this.currentPath.push({ type: 'arc', cx: cx, cy: cy, r: r, start: start, end: end, anticlockwise: anticlockwise, len: len, diff: diff })
      this.currentLength += len
      this.lastX = cx + Math.cos(end) * r
      this.lastY = cy + Math.sin(end) * r
      return this
    }

    circle(x, y, r) {
      // 随机化起始角与方向带来有机差异（避免千篇一律的"从右侧画起"观感）
      var start = Math.random() * Math.PI * 2
      var anticlockwise = Math.random() > 0.5
      var diff = anticlockwise ? -Math.PI * 2 : Math.PI * 2
      var len = Math.PI * 2 * r
      var startX = x + Math.cos(start) * r
      var startY = y + Math.sin(start) * r

      this.moveTo(startX, startY)
      this.currentPath.push({ type: 'arc', cx: x, cy: y, r: r, start: start, end: start + diff, anticlockwise: anticlockwise, len: len, diff: diff })
      this.currentLength += len
      this.lastX = x + Math.cos(start + diff) * r
      this.lastY = y + Math.sin(start + diff) * r
      return this
    }

    rect(x, y, w, h) {
      this.currentPath.push({ type: 'rect_hint', x: x, y: y, w: w, h: h })
      this.moveTo(x, y).lineTo(x + w, y).lineTo(x + w, y + h).lineTo(x, y + h).lineTo(x, y)
      return this
    }

    stroke(options) {
      if (this.currentPath.length > 0) {
        this.commands.push({ type: 'stroke', path: this.currentPath.slice(), length: this.currentLength, options: options })
        this.currentPath = []
        this.currentLength = 0
      }
      return this
    }

    fill(options) {
      if (this.currentPath.length > 0) {
        this.commands.push({ type: 'fill', path: this.currentPath.slice(), length: this.currentLength, options: options })
        this.currentPath = []
        this.currentLength = 0
      }
      return this
    }

    // 为每条描边/填充分配确定性的时间窗口，让生长在整个 shot 上分层展开。
    // 黄金比槽位均匀铺开起始时间（无混叠聚集），逐命令抖动改变时长，
    // 每个区间被钳制保证所有命令恰好在 progress 1 完成。命令顺序的纯函数——seek 安全。
    scheduleStagger() {
      var GOLDEN = 0.6180339887498949
      var strokeIndex = 0
      var fillIndex = 0
      for (var i = 0; i < this.commands.length; i += 1) {
        var cmd = this.commands[i]
        var isStroke = cmd.type === 'stroke'
        var index = isStroke ? strokeIndex++ : fillIndex++
        var slot = (index * GOLDEN) % 1
        var jitter = ((index * 2654435761) >>> 0) / 4294967296
        var delay = slot * (isStroke ? 0.5 : 0.45)
        var span = isStroke ? 0.32 + jitter * 0.26 : 0.4 + jitter * 0.25
        cmd.staggerDelay = delay
        cmd.staggerSpan = Math.min(span, 1 - delay)
      }
      this.staggerScheduled = true
    }

    update(rawProgress) {
      this.display.clear()
      if (!this.staggerScheduled) this.scheduleStagger()
      for (var i = 0; i < this.commands.length; i += 1) {
        var cmd = this.commands[i]
        if (cmd.type === 'fill') {
          this.display.moveTo(0, 0)
          var localRaw = Math.min(1, Math.max(0, (rawProgress - cmd.staggerDelay) / cmd.staggerSpan))
          var localProgress = 1 - Math.pow(1 - localRaw, 3) // 局部三次缓出
          var isRectWipe = false
          if (cmd.path.length === 6 && cmd.path[0].type === 'rect_hint') {
            isRectWipe = true
            var r = cmd.path[0]
            // 从左到右的遮罩擦除：只动画宽度
            this.display.rect(r.x, r.y, r.w * localProgress, r.h)
          }

          if (!isRectWipe) {
            for (var p = 0; p < cmd.path.length; p += 1) {
              var point = cmd.path[p]
              if (point.type === 'rect_hint') continue
              if (point.type === 'moveTo') this.display.moveTo(point.x, point.y)
              else if (point.type === 'lineTo') this.display.lineTo(point.x, point.y)
              else if (point.type === 'circle') this.display.circle(point.x, point.y, point.r)
              else if (point.type === 'arc') this.display.arc(point.cx, point.cy, point.r, point.start, point.end, point.anticlockwise)
              else if (point.type === 'quadraticCurveTo') this.display.quadraticCurveTo(point.cx, point.cy, point.tx, point.ty)
              else if (point.type === 'bezierCurveTo') this.display.bezierCurveTo(point.c1x, point.c1y, point.c2x, point.c2y, point.tx, point.ty)
            }
          }
          var alphaProgress = 1 - Math.pow(1 - Math.min(1, localRaw * 2), 3) // 前半窗口的缓出透明度
          var alpha = (cmd.options.alpha !== undefined ? cmd.options.alpha : 1) * alphaProgress
          var fillOptions = {}
          for (var key in cmd.options) fillOptions[key] = cmd.options[key]
          fillOptions.alpha = alpha
          this.display.fill(fillOptions)
        } else if (cmd.type === 'stroke') {
          if (cmd.length <= 0) continue

          var localRaw2 = Math.min(1, Math.max(0, (rawProgress - cmd.staggerDelay) / cmd.staggerSpan))
          var localProgress2 = 1 - Math.pow(1 - localRaw2, 3) // 局部应用三次缓出

          var targetLen = cmd.length * localProgress2
          var currentLen = 0

          for (var q = 0; q < cmd.path.length; q += 1) {
            var pt = cmd.path[q]
            if (pt.type === 'rect_hint') continue
            if (pt.type === 'moveTo') {
              this.display.moveTo(pt.x, pt.y)
            } else {
              if (currentLen >= targetLen) break

              if (currentLen + pt.len <= targetLen) {
                if (pt.type === 'lineTo') this.display.lineTo(pt.x, pt.y)
                else if (pt.type === 'circle') this.display.circle(pt.x, pt.y, pt.r)
                else if (pt.type === 'arc') this.display.arc(pt.cx, pt.cy, pt.r, pt.start, pt.end, pt.anticlockwise)
                else if (pt.type === 'quadraticCurveTo') this.display.quadraticCurveTo(pt.cx, pt.cy, pt.tx, pt.ty)
                else if (pt.type === 'bezierCurveTo') this.display.bezierCurveTo(pt.c1x, pt.c1y, pt.c2x, pt.c2y, pt.tx, pt.ty)
                currentLen += pt.len
              } else {
                var ratio = (targetLen - currentLen) / pt.len
                if (pt.type === 'lineTo') {
                  var x = pt.lastX + (pt.x - pt.lastX) * ratio
                  var y = pt.lastY + (pt.y - pt.lastY) * ratio
                  this.display.lineTo(x, y)
                } else if (pt.type === 'circle') {
                  this.display.arc(pt.x, pt.y, pt.r, 0, Math.PI * 2 * ratio)
                } else if (pt.type === 'arc') {
                  this.display.arc(pt.cx, pt.cy, pt.r, pt.start, pt.start + pt.diff * ratio, pt.anticlockwise)
                } else if (pt.type === 'quadraticCurveTo') {
                  var newCpX = pt.lastX + ratio * (pt.cx - pt.lastX)
                  var newCpY = pt.lastY + ratio * (pt.cy - pt.lastY)
                  var newTx = (1 - ratio) * (1 - ratio) * pt.lastX + 2 * (1 - ratio) * ratio * pt.cx + ratio * ratio * pt.tx
                  var newTy = (1 - ratio) * (1 - ratio) * pt.lastY + 2 * (1 - ratio) * ratio * pt.cy + ratio * ratio * pt.ty
                  this.display.quadraticCurveTo(newCpX, newCpY, newTx, newTy)
                } else if (pt.type === 'bezierCurveTo') {
                  var q0x = pt.lastX + ratio * (pt.c1x - pt.lastX)
                  var q0y = pt.lastY + ratio * (pt.c1y - pt.lastY)
                  var q1x = pt.c1x + ratio * (pt.c2x - pt.c1x)
                  var q1y = pt.c1y + ratio * (pt.c2y - pt.c1y)
                  var q2x = pt.c2x + ratio * (pt.tx - pt.c2x)
                  var q2y = pt.c2y + ratio * (pt.ty - pt.c2y)
                  var r0x = q0x + ratio * (q1x - q0x)
                  var r0y = q0y + ratio * (q1y - q0y)
                  var r1x = q1x + ratio * (q2x - q1x)
                  var r1y = q1y + ratio * (q2y - q1y)
                  var bx = r0x + ratio * (r1x - r0x)
                  var by = r0y + ratio * (r1y - r0y)
                  this.display.bezierCurveTo(q0x, q0y, r0x, r0y, bx, by)
                }
                currentLen = targetLen
                break
              }
            }
          }

          this.display.stroke(cmd.options)
        }
      }
    }
  }

  // ---------- 空间几何（原版 sonnetSpatialMgGeometry.ts） ----------
  var SONNET_GEO_VARIANT_COUNT = 100

  function resolveSonnetGeoVariant(seed) {
    return ((Math.trunc(seed) % SONNET_GEO_VARIANT_COUNT) + SONNET_GEO_VARIANT_COUNT) % SONNET_GEO_VARIANT_COUNT
  }

  function resolveSonnetGeoCycle(seed) {
    return Math.floor(Math.trunc(seed) / SONNET_GEO_VARIANT_COUNT)
  }

  // 让子变体选取与主几何下标互不影响
  function resolveSonnetGeoSubVariant(seed, count) {
    var cycle = resolveSonnetGeoCycle(seed)
    return ((cycle % count) + count) % count
  }

  function resolveSonnetMoleculeVariant(seed) {
    return resolveSonnetGeoSubVariant(seed, 3)
  }

  function resolveSonnetHudRotationQuarterTurns(seed) {
    return resolveSonnetGeoSubVariant(seed, 4)
  }

  function tracePolygon(target, points) {
    target.moveTo(points[0][0], points[0][1])
    for (var index = 1; index < points.length; index += 1) {
      target.lineTo(points[index][0], points[index][1])
    }
    return target.lineTo(points[0][0], points[0][1])
  }

  function drawFace(target, points, color, fillAlpha) {
    tracePolygon(target, points).fill({ color: color, alpha: fillAlpha })
  }

  function drawSonnetSolidCuboid(target, x, y, width, height, depthX, depthY, color, alpha) {
    var left = x - width / 2
    var right = x + width / 2
    var top = y - height / 2
    var bottom = y + height / 2
    var front = [[left, top], [right, top], [right, bottom], [left, bottom]]
    var topFace = [[left, top], [left + depthX, top + depthY], [right + depthX, top + depthY], [right, top]]
    var sideFace = [[right, top], [right + depthX, top + depthY], [right + depthX, bottom + depthY], [right, bottom]]
    drawFace(target, topFace, color, alpha * 0.42)
    drawFace(target, sideFace, color, alpha * 0.68)
    drawFace(target, front, color, alpha * 0.24)
  }

  function drawSonnetExtrudedPolygon(target, front, depthX, depthY, color, alpha) {
    var back = front.map(function (p) { return [p[0] + depthX, p[1] + depthY] })
    for (var index = 0; index < front.length; index += 1) {
      var next = (index + 1) % front.length
      drawFace(
        target,
        [front[index], back[index], back[next], front[next]],
        color,
        alpha * (0.34 + (index % 3) * 0.12)
      )
    }
    drawFace(target, front, color, alpha * 0.22)
  }

  function drawSonnetTriangularPrism(target, x, y, width, height, depthX, depthY, color, alpha) {
    return drawSonnetExtrudedPolygon(target, [
      [x, y - height / 2],
      [x + width / 2, y + height / 2],
      [x - width / 2, y + height / 2]
    ], depthX, depthY, color, alpha)
  }

  function drawSonnetHexagonalPrism(target, x, y, width, height, depthX, depthY, color, alpha) {
    return drawSonnetExtrudedPolygon(target, [
      [x - width * 0.25, y - height / 2],
      [x + width * 0.25, y - height / 2],
      [x + width / 2, y],
      [x + width * 0.25, y + height / 2],
      [x - width * 0.25, y + height / 2],
      [x - width / 2, y]
    ], depthX, depthY, color, alpha)
  }

  function drawSonnetTrapezoidPrism(target, x, y, topWidth, bottomWidth, height, depthX, depthY, color, alpha) {
    return drawSonnetExtrudedPolygon(target, [
      [x - topWidth / 2, y - height / 2],
      [x + topWidth / 2, y - height / 2],
      [x + bottomWidth / 2, y + height / 2],
      [x - bottomWidth / 2, y + height / 2]
    ], depthX, depthY, color, alpha)
  }

  // ---------- 背景 HUD 变体（原版 sonnetBackgroundMgVariants.ts） ----------
  var SONNET_BACKGROUND_MG_VARIANT_COUNT = 8
  var SONNET_BACKGROUND_MG_VARIANTS = [
    'classic-cross', 'corner-brackets', 'marquee-strips', 'diagonal-corners',
    'dotted-columns', 'double-frame', 'ruler-frame', 'arc-gauge'
  ]

  function resolveSonnetBackgroundMgVariant(seed) {
    return mixSonnetSeed(seed, 0x9e3779b9) % SONNET_BACKGROUND_MG_VARIANT_COUNT
  }

  function withFrame(options) {
    return {
      target: options.target,
      variant: options.variant,
      width: options.width,
      height: options.height,
      seed: options.seed,
      primary: options.primary,
      secondary: options.secondary,
      hw: options.width / 2,
      hh: options.height / 2,
      marginX: options.width * 0.05,
      marginY: options.height * 0.05
    }
  }

  // 多个变体共用的小 X 标记（铆钉/节点强调）
  function drawCrossMark(target, x, y, size, color, alpha) {
    if (alpha === undefined) alpha = 0.5
    target.moveTo(x - size, y - size).lineTo(x + size, y + size).stroke({ color: color, width: 1, alpha: alpha })
    target.moveTo(x + size, y - size).lineTo(x - size, y + size).stroke({ color: color, width: 1, alpha: alpha })
  }

  // 变体 0：最初的 HUD——角落十字、左列十字、底部进度条
  function drawClassicCross(context) {
    var target = context.target
    var hw = context.hw
    var hh = context.hh
    var marginX = context.marginX
    var marginY = context.marginY
    var primary = context.primary
    var secondary = context.secondary
    var size = 4
    drawCrossMark(target, -hw + marginX, -hh + marginY, size, primary, 0.4)
    drawCrossMark(target, hw - marginX, -hh + marginY, size, primary, 0.4)
    drawCrossMark(target, -hw + marginX, hh - marginY, size, primary, 0.4)
    drawCrossMark(target, hw - marginX, hh - marginY, size, primary, 0.4)

    for (var i = 0; i < 8; i += 1) {
      drawCrossMark(target, -hw + marginX, -hh + marginY + i * 20 + 30, 3, primary, 0.3)
    }

    var barY = hh - marginY - 10
    target.moveTo(-hw + marginX + 20, barY).lineTo(hw - marginX - 20, barY).stroke({ color: primary, width: 1, alpha: 0.3 })
    drawCrossMark(target, -hw + marginX + 10, barY, 3, primary, 0.5)
    drawCrossMark(target, -hw + marginX + 30, barY, 3, primary, 0.5)
    drawCrossMark(target, hw - marginX - 10, barY, 3, primary, 0.5)
    target.circle(0, barY, 2).fill({ color: secondary, alpha: 0.8 })
  }

  // 变体 1：制图风格的角 L 括号，底部带刻度尺
  function drawCornerBrackets(context) {
    var target = context.target
    var hw = context.hw
    var hh = context.hh
    var marginX = context.marginX
    var marginY = context.marginY
    var primary = context.primary
    var secondary = context.secondary
    var seed = context.seed
    var arm = Math.min(hw, hh) * 0.08
    var inset = 6
    var corners = [
      [-hw + marginX, -hh + marginY, 1, 1],
      [hw - marginX, -hh + marginY, -1, 1],
      [-hw + marginX, hh - marginY, 1, -1],
      [hw - marginX, hh - marginY, -1, -1]
    ]
    corners.forEach(function (corner, index) {
      var cx = corner[0]
      var cy = corner[1]
      var sx = corner[2]
      var sy = corner[3]
      target.moveTo(cx + sx * arm, cy)
        .lineTo(cx, cy)
        .lineTo(cx, cy + sy * arm)
        .stroke({ color: primary, width: 2, alpha: 0.55 })
      target.moveTo(cx + sx * (arm + inset), cy + sy * inset)
        .lineTo(cx + sx * inset, cy + sy * inset)
        .lineTo(cx + sx * inset, cy + sy * (arm + inset))
        .stroke({ color: primary, width: 1, alpha: 0.25 })
      if (index % 2 === 0) {
        target.rect(cx + sx * arm * 0.4 - 2, cy + sy * arm * 0.4 - 2, 4, 4)
          .fill({ color: secondary, alpha: 0.6 })
      }
    })

    // 括号之间的底部刻度尺
    var rulerY = hh - marginY + inset
    target.moveTo(-hw + marginX + arm + 12, rulerY).lineTo(hw - marginX - arm - 12, rulerY)
      .stroke({ color: primary, width: 1, alpha: 0.3 })
    var ticks = 24
    var span = (hw - marginX - arm - 12) * 2
    for (var i = 0; i <= ticks; i += 1) {
      var x = -hw + marginX + arm + 12 + (span * i) / ticks
      var long = i % 6 === 0
      target.moveTo(x, rulerY).lineTo(x, rulerY - (long ? 8 : 4))
        .stroke({ color: long ? secondary : primary, width: 1, alpha: long ? 0.55 : 0.3 })
    }

    // 侧边上按种子错开的定位点
    for (var d = 0; d < 5; d += 1) {
      var y = -hh + marginY + arm + 14 + d * ((hh - marginY - arm - 14) * 2) / 5
      target.circle(-hw + marginX - 4, y, 1.5).fill({ color: primary, alpha: 0.35 })
      target.circle(hw - marginX + 4, y + (seed % 7), 1.5).fill({ color: primary, alpha: 0.35 })
    }
  }

  // 变体 2：上/下跑马灯条带，带吊挂刻度与端帽块
  function drawMarqueeStrips(context) {
    var target = context.target
    var hw = context.hw
    var hh = context.hh
    var marginX = context.marginX
    var marginY = context.marginY
    var primary = context.primary
    var secondary = context.secondary
    var left = -hw + marginX
    var right = hw - marginX
    ;[-1, 1].forEach(function (direction) {
      var stripY = hh - marginY
      var y = direction * stripY
      target.moveTo(left, y).lineTo(right, y).stroke({ color: primary, width: 2, alpha: 0.45 })
      target.moveTo(left, y + direction * 6).lineTo(right, y + direction * 6)
        .stroke({ color: primary, width: 1, alpha: 0.2 })
      // 端帽块
      target.rect(left, y - 3, 14, 6).fill({ color: secondary, alpha: 0.55 })
      target.rect(right - 14, y - 3, 14, 6).fill({ color: secondary, alpha: 0.55 })
      // 两轨之间的吊挂刻度
      var ticks = 18
      for (var i = 1; i < ticks; i += 1) {
        var x = left + ((right - left) * i) / ticks
        if (i % 3 === 0) {
          target.moveTo(x, y).lineTo(x, y + direction * 6)
            .stroke({ color: primary, width: 1, alpha: 0.35 })
        }
      }
    })
    drawCrossMark(target, 0, -hh + marginY, 4, primary, 0.5)
    target.moveTo(-6, hh - marginY - 14).lineTo(0, hh - marginY - 8).lineTo(6, hh - marginY - 14)
      .stroke({ color: secondary, width: 1, alpha: 0.6 })
  }

  // 变体 3：描边角三角 + 平行斜线对
  function drawDiagonalCorners(context) {
    var target = context.target
    var hw = context.hw
    var hh = context.hh
    var marginX = context.marginX
    var marginY = context.marginY
    var primary = context.primary
    var secondary = context.secondary
    var corner = Math.min(hw, hh) * 0.12
    var corners = [
      [-hw + marginX, -hh + marginY, 1, 1],
      [hw - marginX, -hh + marginY, -1, 1],
      [-hw + marginX, hh - marginY, 1, -1],
      [hw - marginX, hh - marginY, -1, -1]
    ]
    corners.forEach(function (cornerEntry, index) {
      var cx = cornerEntry[0]
      var cy = cornerEntry[1]
      var sx = cornerEntry[2]
      var sy = cornerEntry[3]
      target.moveTo(cx + sx * corner, cy)
        .lineTo(cx, cy)
        .lineTo(cx, cy + sy * corner)
        .lineTo(cx + sx * corner, cy)
        .stroke({ color: primary, width: 1.5, alpha: 0.5 })
      // 内侧平行斜线对
      target.moveTo(cx + sx * corner * 0.55, cy).lineTo(cx, cy + sy * corner * 0.55)
        .stroke({ color: index % 2 === 0 ? secondary : primary, width: 1, alpha: 0.4 })
      target.moveTo(cx + sx * corner * 0.3, cy).lineTo(cx, cy + sy * corner * 0.3)
        .stroke({ color: primary, width: 1, alpha: 0.25 })
    })

    // 带交替菱形标记的基线
    var barY = hh - marginY - 12
    target.moveTo(-hw + marginX + corner + 10, barY).lineTo(hw - marginX - corner - 10, barY)
      .stroke({ color: primary, width: 1, alpha: 0.3 })
    for (var i = 0; i < 5; i += 1) {
      var x = -hw + marginX + corner + 30 + i * 26
      var s = i === 2 ? 5 : 3
      target.moveTo(x, barY - s).lineTo(x + s, barY).lineTo(x, barY + s).lineTo(x - s, barY)
        .lineTo(x, barY - s)
        .stroke({ color: i === 2 ? secondary : primary, width: 1, alpha: 0.55 })
    }
  }

  // 变体 4：点列 + 中央十字线 + 基线
  function drawDottedColumns(context) {
    var target = context.target
    var hw = context.hw
    var hh = context.hh
    var marginX = context.marginX
    var marginY = context.marginY
    var primary = context.primary
    var secondary = context.secondary
    var rows = 14
    for (var i = 0; i < rows; i += 1) {
      var y = -hh + marginY + 10 + i * ((hh - marginY - 10) * 2) / (rows - 1)
      var strong = i % 4 === 0
      target.circle(-hw + marginX, y, strong ? 2.4 : 1.4)
        .fill({ color: strong ? secondary : primary, alpha: strong ? 0.6 : 0.3 })
      target.circle(hw - marginX, y, strong ? 2.4 : 1.4)
        .fill({ color: strong ? secondary : primary, alpha: strong ? 0.6 : 0.3 })
    }
    // 中央定位十字保持低调，位于文字之后
    target.moveTo(-18, 0).lineTo(18, 0).stroke({ color: primary, width: 1, alpha: 0.22 })
    target.moveTo(0, -18).lineTo(0, 18).stroke({ color: primary, width: 1, alpha: 0.22 })
    target.circle(0, 0, 6).stroke({ color: primary, width: 1, alpha: 0.3 })

    var barY = hh - marginY - 8
    target.moveTo(-hw + marginX + 16, barY).lineTo(hw - marginX - 16, barY)
      .stroke({ color: primary, width: 1, alpha: 0.3 })
    drawCrossMark(target, -hw + marginX + 8, barY, 3, primary, 0.5)
    drawCrossMark(target, hw - marginX - 8, barY, 3, primary, 0.5)
  }

  // 变体 5：内缩双框，边缘中央留缺口 + 填充角方块
  function drawDoubleFrame(context) {
    var target = context.target
    var hw = context.hw
    var hh = context.hh
    var marginX = context.marginX
    var marginY = context.marginY
    var primary = context.primary
    var secondary = context.secondary
    var left = -hw + marginX
    var right = hw - marginX
    var top = -hh + marginY
    var bottom = hh - marginY
    var gapX = (right - left) * 0.18
    var gapY = (bottom - top) * 0.22
    var cx = (left + right) / 2
    var cy = (top + bottom) / 2

    // 外框在每条边中央断开
    target.moveTo(left, top).lineTo(cx - gapX / 2, top).stroke({ color: primary, width: 2, alpha: 0.45 })
    target.moveTo(cx + gapX / 2, top).lineTo(right, top).stroke({ color: primary, width: 2, alpha: 0.45 })
    target.moveTo(left, bottom).lineTo(cx - gapX / 2, bottom).stroke({ color: primary, width: 2, alpha: 0.45 })
    target.moveTo(cx + gapX / 2, bottom).lineTo(right, bottom).stroke({ color: primary, width: 2, alpha: 0.45 })
    target.moveTo(left, top).lineTo(left, cy - gapY / 2).stroke({ color: primary, width: 2, alpha: 0.45 })
    target.moveTo(left, cy + gapY / 2).lineTo(left, bottom).stroke({ color: primary, width: 2, alpha: 0.45 })
    target.moveTo(right, top).lineTo(right, cy - gapY / 2).stroke({ color: primary, width: 2, alpha: 0.45 })
    target.moveTo(right, cy + gapY / 2).lineTo(right, bottom).stroke({ color: primary, width: 2, alpha: 0.45 })

    // 内侧回声框（连续、更细）
    var inset = 7
    target.rect(left + inset, top + inset, right - left - inset * 2, bottom - top - inset * 2)
      .stroke({ color: primary, width: 1, alpha: 0.18 })

    // 填充角方块 + 缺口处的小凹槽刻度
    ;[[left, top], [right, top], [left, bottom], [right, bottom]].forEach(function (point, index) {
      target.rect(point[0] - 3, point[1] - 3, 6, 6).fill({ color: index % 2 === 0 ? secondary : primary, alpha: 0.6 })
    })
    target.moveTo(cx - 5, top).lineTo(cx + 5, top).stroke({ color: secondary, width: 3, alpha: 0.5 })
    target.moveTo(cx - 5, bottom).lineTo(cx + 5, bottom).stroke({ color: secondary, width: 3, alpha: 0.5 })
  }

  // 变体 6：四边测量刻度尺
  function drawRulerFrame(context) {
    var target = context.target
    var hw = context.hw
    var hh = context.hh
    var marginX = context.marginX
    var marginY = context.marginY
    var primary = context.primary
    var secondary = context.secondary
    var left = -hw + marginX
    var right = hw - marginX
    var top = -hh + marginY
    var bottom = hh - marginY
    var xTicks = 32
    var yTicks = 18
    for (var i = 0; i <= xTicks; i += 1) {
      var x = left + ((right - left) * i) / xTicks
      var major = i % 8 === 0
      var mid = i % 4 === 0
      var len = major ? 12 : mid ? 7 : 4
      var color = major ? secondary : primary
      target.moveTo(x, top).lineTo(x, top + len).stroke({ color: color, width: 1, alpha: major ? 0.55 : 0.32 })
      target.moveTo(x, bottom).lineTo(x, bottom - len).stroke({ color: color, width: 1, alpha: major ? 0.55 : 0.32 })
    }
    for (var j = 0; j <= yTicks; j += 1) {
      var y = top + ((bottom - top) * j) / yTicks
      var majorY = j % 6 === 0
      var lenY = majorY ? 12 : j % 3 === 0 ? 7 : 4
      var colorY = majorY ? secondary : primary
      target.moveTo(left, y).lineTo(left + lenY, y).stroke({ color: colorY, width: 1, alpha: majorY ? 0.55 : 0.32 })
      target.moveTo(right, y).lineTo(right - lenY, y).stroke({ color: colorY, width: 1, alpha: majorY ? 0.55 : 0.32 })
    }
    // 安静的中心环锚定刻度系统
    target.circle(0, 0, 10).stroke({ color: primary, width: 1, alpha: 0.25 })
    target.circle(0, 0, 3).fill({ color: secondary, alpha: 0.4 })
  }

  // 变体 7：角四分弧、边缘节点 + 带指针的底部弧形表盘
  function drawArcGauge(context) {
    var target = context.target
    var hw = context.hw
    var hh = context.hh
    var marginX = context.marginX
    var marginY = context.marginY
    var primary = context.primary
    var secondary = context.secondary
    var seed = context.seed
    var arcR = Math.min(hw, hh) * 0.11
    var corners = [
      [-hw + marginX, -hh + marginY, 0, Math.PI / 2],
      [hw - marginX, -hh + marginY, Math.PI / 2, Math.PI],
      [hw - marginX, hh - marginY, Math.PI, Math.PI * 1.5],
      [-hw + marginX, hh - marginY, Math.PI * 1.5, Math.PI * 2]
    ]
    corners.forEach(function (corner, index) {
      target.arc(corner[0], corner[1], arcR, corner[2], corner[3]).stroke({ color: primary, width: 2, alpha: 0.5 })
      target.arc(corner[0], corner[1], arcR * 0.72, corner[2], corner[3]).stroke({ color: primary, width: 1, alpha: 0.25 })
      var mid = (corner[2] + corner[3]) / 2
      target.circle(corner[0] + Math.cos(mid) * arcR, corner[1] + Math.sin(mid) * arcR, 2)
        .fill({ color: index % 2 === 0 ? secondary : primary, alpha: 0.6 })
    })

    // 每条边中点的边缘节点
    target.circle(0, -hh + marginY, 2).fill({ color: primary, alpha: 0.45 })
    target.circle(-hw + marginX, 0, 2).fill({ color: primary, alpha: 0.45 })
    target.circle(hw - marginX, 0, 2).fill({ color: primary, alpha: 0.45 })

    // 底部半圆表盘 + 种子固定的指针
    var gaugeY = hh - marginY + arcR * 0.4
    var gaugeR = Math.min(hw, hh) * 0.16
    target.arc(0, gaugeY, gaugeR, Math.PI, Math.PI * 2).stroke({ color: primary, width: 1.5, alpha: 0.4 })
    for (var i = 0; i <= 8; i += 1) {
      var angle = Math.PI + (i / 8) * Math.PI
      target.moveTo(Math.cos(angle) * (gaugeR - 5), gaugeY + Math.sin(angle) * (gaugeR - 5))
        .lineTo(Math.cos(angle) * gaugeR, gaugeY + Math.sin(angle) * gaugeR)
        .stroke({ color: i % 4 === 0 ? secondary : primary, width: 1, alpha: 0.45 })
    }
    var needle = Math.PI + (((seed % 100) / 100) * Math.PI)
    target.moveTo(0, gaugeY)
      .lineTo(Math.cos(needle) * (gaugeR - 8), gaugeY + Math.sin(needle) * (gaugeR - 8))
      .stroke({ color: secondary, width: 2, alpha: 0.6 })
    target.circle(0, gaugeY, 2.5).fill({ color: primary, alpha: 0.7 })
  }

  // 按种子分发背景 HUD 变体；未知变体回退经典
  function drawSonnetBackgroundMgHud(options) {
    var context = withFrame(options)
    switch (options.variant % SONNET_BACKGROUND_MG_VARIANT_COUNT) {
      case 1: drawCornerBrackets(context); return
      case 2: drawMarqueeStrips(context); return
      case 3: drawDiagonalCorners(context); return
      case 4: drawDottedColumns(context); return
      case 5: drawDoubleFrame(context); return
      case 6: drawRulerFrame(context); return
      case 7: drawArcGauge(context); return
      default: drawClassicCross(context)
    }
  }

  // ---------- 漂浮粒子装饰（原版 sonnetBackgroundDecor.ts） ----------
  var SONNET_BACKGROUND_DECOR_VARIANT_COUNT = 6
  var SONNET_BACKGROUND_DECOR_VARIANTS = [
    'scatter', 'orbit', 'edge-band', 'corner-clusters', 'constellation', 'twin-columns'
  ]

  function resolveSonnetBackgroundDecorVariant(seed) {
    return mixSonnetSeed(seed, 0xc2b2ae35) % SONNET_BACKGROUND_DECOR_VARIANT_COUNT
  }

  var SHAPE_PALETTES = [
    ['square', 'diamond', 'sparkle'],
    ['ring', 'hexagon', 'dot'],
    ['bar', 'plus', 'square'],
    ['triangle', 'diamond', 'plus'],
    ['dot', 'ring', 'sparkle'],
    ['chevron', 'bar', 'hexagon']
  ]

  // 以 (0,0) 为中心绘制一个粒子字形；pSize 为标称半尺寸
  function drawShape(g, shape, pSize, color, alpha) {
    switch (shape) {
      case 'diamond':
        g.moveTo(0, -pSize).lineTo(pSize, 0).lineTo(0, pSize).lineTo(-pSize, 0)
          .fill({ color: color, alpha: alpha * 0.85 })
        return
      case 'sparkle':
        g.moveTo(0, -pSize * 1.5).quadraticCurveTo(0, 0, pSize * 1.5, 0)
          .quadraticCurveTo(0, 0, 0, pSize * 1.5)
          .quadraticCurveTo(0, 0, -pSize * 1.5, 0)
          .quadraticCurveTo(0, 0, 0, -pSize * 1.5)
          .fill({ color: color, alpha: alpha * 1.2 })
        return
      case 'plus': {
        var arm = pSize * 0.34
        g.rect(-pSize, -arm, pSize * 2, arm * 2).fill({ color: color, alpha: alpha * 0.9 })
        g.rect(-arm, -pSize, arm * 2, pSize * 2).fill({ color: color, alpha: alpha * 0.9 })
        return
      }
      case 'ring':
        g.circle(0, 0, pSize).stroke({ color: color, width: Math.max(1, pSize * 0.22), alpha: alpha * 0.9 })
        return
      case 'triangle':
        g.moveTo(0, -pSize).lineTo(pSize * 0.9, pSize * 0.7).lineTo(-pSize * 0.9, pSize * 0.7)
          .lineTo(0, -pSize)
          .fill({ color: color, alpha: alpha * 0.85 })
        return
      case 'hexagon': {
        for (var j = 0; j <= 6; j += 1) {
          var angle = (j * Math.PI) / 3
          var x = Math.sin(angle) * pSize
          var y = -Math.cos(angle) * pSize
          if (j === 0) g.moveTo(x, y)
          else g.lineTo(x, y)
        }
        g.stroke({ color: color, width: Math.max(1, pSize * 0.16), alpha: alpha })
        return
      }
      case 'bar':
        g.rect(-pSize, -pSize * 0.18, pSize * 2, pSize * 0.36).fill({ color: color, alpha: alpha * 0.85 })
        return
      case 'dot':
        g.circle(0, 0, pSize * 0.34).fill({ color: color, alpha: alpha })
        return
      case 'chevron':
        g.moveTo(-pSize * 0.5, -pSize * 0.55).lineTo(pSize * 0.35, 0).lineTo(-pSize * 0.5, pSize * 0.55)
          .stroke({ color: color, width: Math.max(1.5, pSize * 0.2), alpha: alpha })
        return
      default:
        g.rect(-pSize / 2, -pSize / 2, pSize, pSize).fill({ color: color, alpha: alpha })
    }
  }

  // 每种排布下解析粒子 index 的种子驱动位置/旋转
  function resolvePlacement(variant, index, count, seed, width, height) {
    var hw = width / 2
    var hh = height / 2
    var radius = Math.min(width, height)
    var jitter = function (salt, range) { return (sonnetHash01(seed, index, salt) - 0.5) * range }
    var baseRotation = sonnetHash01(seed, index, 11) * Math.PI * 2

    switch (variant) {
      case 1: {
        // 两条同心轨道环；粒子沿环推进
        var ring = index % 2
        var ringRadius = radius * (0.36 + ring * 0.26)
        var angle = (index / count) * Math.PI * 4 + jitter(13, 0.35)
        return {
          x: Math.cos(angle) * ringRadius,
          y: Math.sin(angle) * ringRadius * 0.86,
          rotation: angle + Math.PI / 2
        }
      }
      case 2: {
        // 上下交替的边缘带
        var side = index % 2 === 0 ? -1 : 1
        var t = (Math.floor(index / 2) + 0.5) / Math.max(1, Math.floor(count / 2))
        return {
          x: -hw + width * (0.06 + 0.88 * t) + jitter(17, width * 0.03),
          y: side * hh * 0.78 + jitter(19, height * 0.05),
          rotation: side < 0 ? 0 : Math.PI
        }
      }
      case 3: {
        // 锚定四角的松散簇
        var corner = index % 4
        var sx = corner % 2 === 0 ? -1 : 1
        var sy = corner < 2 ? -1 : 1
        return {
          x: sx * hw * 0.68 + jitter(23, width * 0.12),
          y: sy * hh * 0.62 + jitter(29, height * 0.12),
          rotation: baseRotation
        }
      }
      case 4: {
        // 抖动的星座网格
        var cols = 6
        var rows = 4
        var col = index % cols
        var row = Math.floor(index / cols) % rows
        return {
          x: -hw * 0.8 + (col / (cols - 1)) * hw * 1.6 + jitter(31, width * 0.06),
          y: -hh * 0.72 + (row / (rows - 1)) * hh * 1.44 + jitter(37, height * 0.06),
          rotation: baseRotation
        }
      }
      case 5: {
        // 镜像的左右竖列
        var side2 = index % 2 === 0 ? -1 : 1
        var t2 = (Math.floor(index / 2) + 0.5) / Math.max(1, Math.ceil(count / 2))
        return {
          x: side2 * hw * 0.74 + jitter(41, width * 0.04),
          y: -hh * 0.8 + t2 * hh * 1.6 + jitter(43, height * 0.05),
          rotation: side2 < 0 ? Math.PI : 0
        }
      }
      default:
        // 经典均匀散布（最初行为）
        return {
          x: -hw + width * sonnetHash01(seed, index, 47),
          y: -hh + height * sonnetHash01(seed, index, 53),
          rotation: baseRotation
        }
    }
  }

  // 构建漂浮装饰层：种子调色板 + 排布，主题图标精灵按图标日程插入粒子槽
  function buildSonnetBackgroundDecor(options) {
    var pixi = options.pixi
    var kind = options.kind
    var width = options.width
    var height = options.height
    var seed = options.seed
    var primary = options.primary
    var secondary = options.secondary
    var iconTextures = options.iconTextures
    var layer = new pixi.Container()
    var variant = resolveSonnetBackgroundDecorVariant(seed)
    var palette = SHAPE_PALETTES[variant]
    var particleCount = kind === 'type-impact' ? 24 : 12
    var iconParticleIndices = window.FoliaSonnetText.buildSonnetIconParticleIndices(
      iconTextures.length,
      particleCount,
      seed
    )
    var hasIcons = iconTextures.length > 0
    var iconAnimations = []

    for (var i = 0; i < particleCount; i += 1) {
      var pSize = 4 + (seed + i) % 12
      var iconTextureIndex = iconParticleIndices[i]
      var node

      if (hasIcons && iconTextureIndex !== null) {
        var texture = iconTextures[iconTextureIndex]
        if (texture) {
          var sprite = new pixi.Sprite(texture)
          sprite.anchor.set(0.5)
          sprite.width = pSize * 7
          sprite.height = pSize * 7
          var iconSeed = Math.abs(seed + i * 17)
          sprite.alpha = 0
          iconAnimations.push({
            node: sprite,
            baseScale: sprite.scale.x,
            baseAlpha: 0.85,
            entryPhase: 0,
            preferredDuration: 0.62 + (iconSeed % 4) * 0.08,
            phase: (iconSeed % 31) * 0.2
          })
          node = sprite
        } else {
          var gFallback = new pixi.Graphics()
          gFallback.rect(-pSize / 2, -pSize / 2, pSize, pSize).fill({ color: primary, alpha: 0.6 })
          node = gFallback
        }
      } else {
        var g = new pixi.Graphics()
        var shape = palette[(seed + i) % palette.length]
        var color = i % 2 === 0 ? primary : secondary
        drawShape(g, shape, pSize, color, 0.55 + sonnetHash01(seed, i, 59) * 0.3)
        node = g
      }

      var placement = resolvePlacement(variant, i, particleCount, seed, width, height)
      node.position.set(placement.x, placement.y)
      node.rotation = placement.rotation
      layer.addChild(node)
    }

    return { layer: layer, iconAnimations: iconAnimations }
  }

  // ---------- 固定几何变体（原版 sonnetFixedGeoVariants.ts） ----------
  var SONNET_FIXED_GEO_VARIANT_COUNT = 8
  var SONNET_FIXED_GEO_VARIANTS = [
    'classic-blocks', 'twin-pillars', 'disc-ring', 'diamond-pair',
    'stripe-stack', 'corner-els', 'twin-wedges', 'cross-ring'
  ]

  function resolveSonnetFixedGeoVariant(seed) {
    return mixSonnetSeed(seed, 0x85ebca6b) % SONNET_FIXED_GEO_VARIANT_COUNT
  }

  // 由静态矩形遮罩裁剪的对角线影线；影线描边记录在 AnimatedGraphics 上，
  // 随共享错峰日程一起生长
  function drawHatching(pixi, primary, x, y, w, h, spacing, target) {
    var hatch = new AnimatedGraphics(pixi)
    for (var i = -w; i < w + h; i += spacing) {
      hatch.moveTo(x + i, y).lineTo(x + i + h, y + h).stroke({ color: primary, width: 1, alpha: 0.15 })
    }

    var mask = new pixi.Graphics()
    mask.rect(x, y, w, h).fill({ color: 0xffffff })
    hatch.mask = mask

    target.addChild(hatch.display)
    target.addChild(mask)
    return hatch
  }

  function addHatch(context, x, y, w, h, spacing) {
    if (spacing === undefined) spacing = 6
    context.parts.push(drawHatching(context.pixi, context.primary, x, y, w, h, spacing, context.layer))
  }

  // 变体 0：最初的实心块 + 空心框 + 影线补丁三件套
  function drawClassicBlocks(context) {
    var geo = context.geo
    var r = context.radius
    var primary = context.primary
    geo.rect(-r * 0.4, -r * 0.2, r * 0.6, r * 0.15).fill({ color: primary, alpha: 0.7 })
    geo.rect(-r * 0.1, r * 0.1, r * 0.5, r * 0.3).stroke({ color: primary, width: 2, alpha: 0.6 })
    addHatch(context, -r * 0.3, -r * 0.4, r * 0.4, r * 0.25)
  }

  // 变体 1：实心立柱 + 更高的空心框，中间夹影线条
  function drawTwinPillars(context) {
    var geo = context.geo
    var r = context.radius
    var primary = context.primary
    var accent = context.accent
    geo.rect(-r * 0.34, -r * 0.28, r * 0.12, r * 0.56).fill({ color: accent, alpha: 0.65 })
    geo.rect(-r * 0.34 + r * 0.035, -r * 0.28 + r * 0.035, r * 0.05, r * 0.49)
      .fill({ color: primary, alpha: 0.35 })
    geo.rect(r * 0.06, -r * 0.34, r * 0.28, r * 0.68).stroke({ color: primary, width: 2, alpha: 0.6 })
    geo.rect(r * 0.06 + r * 0.04, -r * 0.34 + r * 0.04, r * 0.2, r * 0.6)
      .stroke({ color: primary, width: 1, alpha: 0.3 })
    addHatch(context, -r * 0.14, -r * 0.2, r * 0.12, r * 0.4, 5)
  }

  // 变体 2：实心圆盘 + 同心空心环 + 影线弦
  function drawDiscRing(context) {
    var geo = context.geo
    var r = context.radius
    var primary = context.primary
    var accent = context.accent
    geo.circle(-r * 0.2, r * 0.12, r * 0.15).fill({ color: accent, alpha: 0.7 })
    geo.circle(-r * 0.2, r * 0.12, r * 0.06).fill({ color: primary, alpha: 0.5 })
    geo.circle(r * 0.14, -r * 0.06, r * 0.3).stroke({ color: primary, width: 2, alpha: 0.6 })
    geo.circle(r * 0.14, -r * 0.06, r * 0.22).stroke({ color: primary, width: 1, alpha: 0.3 })
    addHatch(context, r * 0.02, -r * 0.14, r * 0.24, r * 0.16, 5)
  }

  // 变体 3：大空心菱形 + 小实心伴菱形
  function drawDiamondPair(context) {
    var geo = context.geo
    var r = context.radius
    var primary = context.primary
    var accent = context.accent
    var seed = context.seed
    var direction = seed % 2 === 0 ? 1 : -1
    var dr = r * 0.3
    var cx = -r * 0.08 * direction
    geo.moveTo(cx, -dr).lineTo(cx + dr, 0).lineTo(cx, dr).lineTo(cx - dr, 0).lineTo(cx, -dr)
      .stroke({ color: primary, width: 2, alpha: 0.6 })
    geo.moveTo(cx, -dr * 0.7).lineTo(cx + dr * 0.7, 0).lineTo(cx, dr * 0.7).lineTo(cx - dr * 0.7, 0)
      .lineTo(cx, -dr * 0.7)
      .stroke({ color: primary, width: 1, alpha: 0.3 })
    var sr = r * 0.11
    var sx = r * 0.3 * direction
    var sy = -r * 0.2
    geo.moveTo(sx, sy - sr).lineTo(sx + sr, sy).lineTo(sx, sy + sr).lineTo(sx - sr, sy).lineTo(sx, sy - sr)
      .fill({ color: accent, alpha: 0.7 })
    addHatch(context, sx - sr * 0.8, r * 0.16, sr * 1.6, sr * 1.2, 4)
  }

  // 变体 4：错位的横条纹堆（实心 / 空心 / 细强调）
  function drawStripeStack(context) {
    var geo = context.geo
    var r = context.radius
    var primary = context.primary
    var accent = context.accent
    var seed = context.seed
    var direction = seed % 2 === 0 ? 1 : -1
    geo.rect(-r * 0.36 * direction - r * 0.2, -r * 0.26, r * 0.56, r * 0.09)
      .fill({ color: accent, alpha: 0.7 })
    geo.rect(-r * 0.28, -r * 0.06, r * 0.56, r * 0.16).stroke({ color: primary, width: 2, alpha: 0.6 })
    geo.rect(-r * 0.2 * direction, r * 0.2, r * 0.4, r * 0.045).fill({ color: primary, alpha: 0.5 })
    addHatch(context, r * 0.26 * direction, -r * 0.3, r * 0.12, r * 0.6, 5)
  }

  // 变体 5：对角线上的两个粗角 L + 中央空心方块
  function drawCornerEls(context) {
    var geo = context.geo
    var r = context.radius
    var primary = context.primary
    var accent = context.accent
    var seed = context.seed
    var direction = seed % 2 === 0 ? 1 : -1
    var arm = r * 0.24
    var thick = r * 0.07
    // 左上 / 右下 L 对（方向翻转时镜像）
    var x1 = -r * 0.3 * direction
    var y1 = -r * 0.24
    geo.rect(x1 - (direction < 0 ? arm : 0), y1, arm, thick).fill({ color: accent, alpha: 0.7 })
    geo.rect(direction < 0 ? x1 - arm : x1, y1, thick, arm).fill({ color: accent, alpha: 0.7 })
    var x2 = r * 0.3 * direction
    var y2 = r * 0.24
    geo.rect(direction < 0 ? x2 : x2 - arm, y2 - thick, arm, thick).fill({ color: primary, alpha: 0.55 })
    geo.rect(direction < 0 ? x2 + arm - thick : x2 - thick, y2 - arm, thick, arm)
      .fill({ color: primary, alpha: 0.55 })
    geo.rect(-r * 0.13, -r * 0.13, r * 0.26, r * 0.26).stroke({ color: primary, width: 2, alpha: 0.6 })
    addHatch(context, -r * 0.09 * direction, r * 0.02, r * 0.16, r * 0.1, 4)
  }

  // 变体 6：实心上升楔形对着空心下降楔形
  function drawTwinWedges(context) {
    var geo = context.geo
    var r = context.radius
    var primary = context.primary
    var accent = context.accent
    var seed = context.seed
    var direction = seed % 2 === 0 ? 1 : -1
    var wx = -r * 0.14 * direction
    geo.moveTo(wx, -r * 0.3).lineTo(wx + r * 0.24, r * 0.02).lineTo(wx - r * 0.24, r * 0.02)
      .lineTo(wx, -r * 0.3)
      .fill({ color: accent, alpha: 0.6 })
    var hx = r * 0.16 * direction
    geo.moveTo(hx, r * 0.3).lineTo(hx + r * 0.24, -r * 0.02).lineTo(hx - r * 0.24, -r * 0.02)
      .lineTo(hx, r * 0.3)
      .stroke({ color: primary, width: 2, alpha: 0.6 })
    geo.moveTo(hx, r * 0.2).lineTo(hx + r * 0.15, 0).lineTo(hx - r * 0.15, 0).lineTo(hx, r * 0.2)
      .stroke({ color: primary, width: 1, alpha: 0.3 })
    addHatch(context, -r * 0.3 * direction - r * 0.05, r * 0.1, r * 0.2, r * 0.18, 5)
  }

  // 变体 7：空心环中央的实心十字 + 影线方块
  function drawCrossRing(context) {
    var geo = context.geo
    var r = context.radius
    var primary = context.primary
    var accent = context.accent
    var seed = context.seed
    var cx = (seed % 3 - 1) * r * 0.08
    var arm = r * 0.17
    var thick = r * 0.075
    geo.rect(cx - arm, -thick / 2, arm * 2, thick).fill({ color: accent, alpha: 0.7 })
    geo.rect(cx - thick / 2, -arm, thick, arm * 2).fill({ color: accent, alpha: 0.7 })
    geo.circle(cx, 0, r * 0.3).stroke({ color: primary, width: 2, alpha: 0.6 })
    geo.circle(cx, 0, r * 0.36).stroke({ color: primary, width: 1, alpha: 0.25 })
    addHatch(context, cx + r * 0.18, r * 0.14, r * 0.16, r * 0.16, 4)
  }

  // 把种子化的固定几何构图构建进 layer，返回所有 AnimatedGraphics 部件，
  // 供 shot 更新循环一起生长
  function buildSonnetFixedGeo(options) {
    var geo = new AnimatedGraphics(options.pixi)
    var context = {
      pixi: options.pixi,
      layer: options.layer,
      variant: options.variant,
      radius: options.radius,
      seed: options.seed,
      primary: options.primary,
      secondary: options.secondary,
      geo: geo,
      parts: [geo],
      accent: options.seed % 2 === 0 ? options.secondary : options.primary
    }
    options.layer.addChild(geo.display)

    switch (options.variant % SONNET_FIXED_GEO_VARIANT_COUNT) {
      case 1: drawTwinPillars(context); break
      case 2: drawDiscRing(context); break
      case 3: drawDiamondPair(context); break
      case 4: drawStripeStack(context); break
      case 5: drawCornerEls(context); break
      case 6: drawTwinWedges(context); break
      case 7: drawCrossRing(context); break
      default: drawClassicBlocks(context)
    }
    return context.parts
  }

  window.FoliaSonnetDecor = {
    AnimatedGraphics: AnimatedGraphics,
    SONNET_GEO_VARIANT_COUNT: SONNET_GEO_VARIANT_COUNT,
    resolveSonnetGeoVariant: resolveSonnetGeoVariant,
    resolveSonnetMoleculeVariant: resolveSonnetMoleculeVariant,
    resolveSonnetHudRotationQuarterTurns: resolveSonnetHudRotationQuarterTurns,
    drawSonnetSolidCuboid: drawSonnetSolidCuboid,
    drawSonnetTriangularPrism: drawSonnetTriangularPrism,
    drawSonnetHexagonalPrism: drawSonnetHexagonalPrism,
    drawSonnetTrapezoidPrism: drawSonnetTrapezoidPrism,
    resolveSonnetShotMgBleed: resolveSonnetShotMgBleed,
    SONNET_BACKGROUND_MG_VARIANT_COUNT: SONNET_BACKGROUND_MG_VARIANT_COUNT,
    SONNET_BACKGROUND_MG_VARIANTS: SONNET_BACKGROUND_MG_VARIANTS,
    resolveSonnetBackgroundMgVariant: resolveSonnetBackgroundMgVariant,
    drawSonnetBackgroundMgHud: drawSonnetBackgroundMgHud,
    SONNET_BACKGROUND_DECOR_VARIANT_COUNT: SONNET_BACKGROUND_DECOR_VARIANT_COUNT,
    SONNET_BACKGROUND_DECOR_VARIANTS: SONNET_BACKGROUND_DECOR_VARIANTS,
    resolveSonnetBackgroundDecorVariant: resolveSonnetBackgroundDecorVariant,
    buildSonnetBackgroundDecor: buildSonnetBackgroundDecor,
    SONNET_FIXED_GEO_VARIANT_COUNT: SONNET_FIXED_GEO_VARIANT_COUNT,
    SONNET_FIXED_GEO_VARIANTS: SONNET_FIXED_GEO_VARIANTS,
    resolveSonnetFixedGeoVariant: resolveSonnetFixedGeoVariant,
    buildSonnetFixedGeo: buildSonnetFixedGeo,
    hashSonnetSeedForMg: hashSonnetSeed
  }
})()
