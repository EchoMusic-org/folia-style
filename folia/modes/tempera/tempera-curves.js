// 凝彩模式·几何生成器：移植自 folia-major src/components/visualizer/tempera/
//   temperaCurves.ts（圆滑语汇：圆盘、瓣徽章、蕾丝波边、弧缎带、贴纸板）
//   temperaHatch.ts（网点语汇：斜线填充、抖动涂鸦折线、重复装饰行列）
// 同一套纯函数约定：无 Pixi、无 Math.random，一律输出扁平多边形/线段数组，
// 每条曲线都由种子驱动，渲染层零随机。
(function () {
  'use strict'

  var temperaHash01 = window.FoliaTemperaCore.temperaHash01

  var TAU = Math.PI * 2

  // ---------- 曲线语汇（原版 temperaCurves.ts） ----------
  // 凸性是硬约束：buildHatchLines 靠半平面裁剪，只有 ellipsePolygon /
  // roundedRectPolygon 能进 drawHatchFill；心形、星形、波边、缎带都是凹多边形，
  // 只能填充和描边（pixi 用 earcut 三角化，填充是安全的）

  // 构图空间里的一个圆。drawDiscs / drawRings 接受这类数组
  // （TemperaDisc：{ x, y, radius }）

  // 凸。
  function ellipsePolygon(cx, cy, rx, ry, segments) {
    if (segments === undefined) segments = 32
    var count = Math.max(8, Math.round(segments))
    var points = []
    for (var index = 0; index < count; index += 1) {
      var angle = (index / count) * TAU
      points.push(cx + Math.cos(angle) * rx, cy + Math.sin(angle) * ry)
    }
    return points
  }

  // 凸。贴纸板：四角为四分之一圆弧的矩形
  function roundedRectPolygon(x, y, width, height, radius, cornerSegments) {
    if (cornerSegments === undefined) cornerSegments = 6
    var limit = Math.max(0, Math.min(radius, Math.min(width, height) / 2))
    var steps = Math.max(1, Math.round(cornerSegments))
    var corners = [
      [x + width - limit, y + limit, -Math.PI / 2],
      [x + width - limit, y + height - limit, 0],
      [x + limit, y + height - limit, Math.PI / 2],
      [x + limit, y + limit, Math.PI]
    ]
    var points = []
    corners.forEach(function (corner) {
      var ccx = corner[0]
      var ccy = corner[1]
      var start = corner[2]
      for (var step = 0; step <= steps; step += 1) {
        var angle = start + (step / steps) * (Math.PI / 2)
        points.push(ccx + Math.cos(angle) * limit, ccy + Math.sin(angle) * limit)
      }
    })
    return points
  }

  // 绕轴心旋转多边形。凸性保持，可 hatch 的形状保持可 hatch
  function rotatePolygon(polygon, cx, cy, angle) {
    var cos = Math.cos(angle)
    var sin = Math.sin(angle)
    var points = []
    for (var index = 0; index < polygon.length; index += 2) {
      var dx = polygon[index] - cx
      var dy = polygon[index + 1] - cy
      points.push(cx + dx * cos - dy * sin, cy + dx * sin + dy * cos)
    }
    return points
  }

  // 凹。带 lobes 个正弦鼓包的轮廓，归一化后仍恰好装进 rx/ry。
  // 小振幅读作云或蕾丝徽章，大振幅读作蔷薇花
  function lobedPolygon(cx, cy, rx, ry, lobes, amplitude, segments) {
    if (segments === undefined) segments = 96
    var count = Math.max(24, Math.round(segments))
    var petals = Math.max(1, Math.round(lobes))
    var swell = Math.max(0, amplitude)
    var points = []
    for (var index = 0; index < count; index += 1) {
      var angle = (index / count) * TAU
      var scale = (1 + Math.cos(angle * petals) * swell) / (1 + swell)
      points.push(cx + Math.cos(angle) * rx * scale, cy + Math.sin(angle) * ry * scale)
    }
    return points
  }

  // 凹。在 flatY 处一条平直边、baseY 上挂一排相切半圆鼓包的带子——蕾丝边。
  // 鼓包半径是鼓包宽度的一半，所以仅由数量决定蕾丝的细腻程度
  function scallopBandPolygon(x0, x1, flatY, baseY, bumps, segmentsPerBump) {
    if (segmentsPerBump === undefined) segmentsPerBump = 10
    var count = Math.max(1, Math.round(bumps))
    var steps = Math.max(3, Math.round(segmentsPerBump))
    var span = (x1 - x0) / count
    var radius = Math.abs(span) / 2
    var direction = baseY >= flatY ? 1 : -1
    var points = [x0, flatY, x1, flatY]
    // 从右向左走，让鼓包以同一个绕向接上平直边
    for (var bump = count - 1; bump >= 0; bump -= 1) {
      var cx = x0 + span * (bump + 0.5)
      for (var step = 0; step <= steps; step += 1) {
        var angle = (step / steps) * Math.PI
        points.push(cx + Math.cos(angle) * (span / 2), baseY + direction * Math.sin(angle) * radius)
      }
    }
    return points
  }

  // 凹。经典参数化心形，采样后归一化进 rx/ry 框，
  // 调用方即可像其他形状一样指定尺寸而不必携带曲线自身比例
  function heartPolygon(cx, cy, rx, ry, segments) {
    if (segments === undefined) segments = 64
    var count = Math.max(16, Math.round(segments))
    var raw = []
    var minX = Number.POSITIVE_INFINITY
    var maxX = Number.NEGATIVE_INFINITY
    var minY = Number.POSITIVE_INFINITY
    var maxY = Number.NEGATIVE_INFINITY
    for (var index = 0; index < count; index += 1) {
      var t = (index / count) * TAU
      var x = Math.pow(Math.sin(t), 3) * 16
      // 取负：曲线按数学向上书写，构图在屏幕向下的空间里绘制
      var y = -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t))
      raw.push(x, y)
      minX = Math.min(minX, x)
      maxX = Math.max(maxX, x)
      minY = Math.min(minY, y)
      maxY = Math.max(maxY, y)
    }
    var halfWidth = Math.max(1e-6, (maxX - minX) / 2)
    var halfHeight = Math.max(1e-6, (maxY - minY) / 2)
    var midX = (minX + maxX) / 2
    var midY = (minY + maxY) / 2
    var points = []
    for (var i = 0; i < raw.length; i += 2) {
      points.push(
        cx + ((raw[i] - midX) / halfWidth) * rx,
        cy + ((raw[i + 1] - midY) / halfHeight) * ry
      )
    }
    return points
  }

  // 凹。一段环，从 startAngle 到 endAngle。一圈这样的扇段会留下它们之间的辐条
  // 和圈内的毂——这正是把环从板上冲掉而中间不掉下来的做法
  function annularSectorPolygon(cx, cy, innerRadius, outerRadius, startAngle, endAngle, segments) {
    if (segments === undefined) segments = 10
    var steps = Math.max(2, Math.round(segments))
    var points = []
    for (var step = 0; step <= steps; step += 1) {
      var angle = startAngle + ((endAngle - startAngle) * step) / steps
      points.push(cx + Math.cos(angle) * outerRadius, cy + Math.sin(angle) * outerRadius)
    }
    for (var back = steps; back >= 0; back -= 1) {
      var innerAngle = startAngle + ((endAngle - startAngle) * back) / steps
      points.push(cx + Math.cos(innerAngle) * innerRadius, cy + Math.sin(innerAngle) * innerRadius)
    }
    return points
  }

  // 凹。四根尖刺带收紧的腰是 VN 的闪光；尖更多读作星
  function starPolygon(cx, cy, outerRadius, innerRadius, points, rotation) {
    if (rotation === undefined) rotation = 0
    var tips = Math.max(3, Math.round(points))
    var polygon = []
    for (var index = 0; index < tips * 2; index += 1) {
      var radius = index % 2 === 0 ? outerRadius : innerRadius
      var angle = rotation - Math.PI / 2 + (index / (tips * 2)) * TAU
      polygon.push(cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius)
    }
    return polygon
  }

  // 凹。中心线沿半段正弦下沉、两端切平的带子，因此能穿过两条画框边
  // 而仍读作一条弯曲缎带
  function arcRibbonPolygon(x0, x1, y, thickness, sag, steps) {
    if (steps === undefined) steps = 28
    var count = Math.max(4, Math.round(steps))
    var half = thickness / 2
    var top = []
    var bottom = []
    for (var index = 0; index <= count; index += 1) {
      var progress = index / count
      var x = x0 + (x1 - x0) * progress
      var centre = y + Math.sin(progress * Math.PI) * sag
      top.push(x, centre - half)
      bottom.push(x, centre + half)
    }
    var points = top.slice()
    for (var i = bottom.length - 2; i >= 0; i -= 2) {
      points.push(bottom[i], bottom[i + 1])
    }
    return points
  }

  // 抖动格点上的种子驱动圆盘场。格点保持覆盖均匀；每格抖动让它不至于读成点阵
  function buildDiscField(seed, salt, width, height, count, radius) {
    var total = Math.max(0, Math.round(count))
    if (total === 0 || width <= 0 || height <= 0) return []
    var columns = Math.max(1, Math.round(Math.sqrt(total * (width / height))))
    var rows = Math.max(1, Math.ceil(total / columns))
    var cellWidth = width / columns
    var cellHeight = height / rows
    var discs = []
    for (var index = 0; index < total; index += 1) {
      var column = index % columns
      var row = Math.floor(index / columns)
      discs.push({
        x: cellWidth * (column + 0.15 + temperaHash01(seed, index, salt) * 0.7),
        y: cellHeight * (row + 0.15 + temperaHash01(seed, index, salt + 3) * 0.7),
        radius: radius * (0.55 + temperaHash01(seed, index, salt + 7) * 0.75)
      })
    }
    return discs
  }

  // ---------- 网点语汇（原版 temperaHatch.ts） ----------
  var MAX_HATCH_LINES = 320

  // 从种子挑选 hatch 角度/间距/线宽三元组；密度档位保持粗粒度，
  // 让同一形状读作一个色调而非摩尔纹
  function buildHatchSpec(seed, salt, scale) {
    if (scale === undefined) scale = 1
    var angleIndex = Math.floor(temperaHash01(seed, 1, salt) * 4)
    var angle = [-Math.PI / 4, Math.PI / 4, -Math.PI / 3, Math.PI / 6][angleIndex]
    if (angle === undefined) angle = Math.PI / 4
    var density = Math.floor(temperaHash01(seed, 2, salt) * 3)
    var spacing = ([9, 13, 18][density] || 13) * scale
    var width = Math.max(0.8, spacing * (0.16 + temperaHash01(seed, 3, salt) * 0.14))
    return { angle: angle, spacing: spacing, width: width }
  }

  function rectPolygon(x, y, width, height) {
    return [
      x, y,
      x + width, y,
      x + width, y + height,
      x, y + height
    ]
  }

  // 圆的凸多边形近似，让 hatch 裁剪器也能填充圆窗
  function circlePolygon(cx, cy, radius, segments) {
    if (segments === undefined) segments = 28
    var points = []
    var count = Math.max(6, Math.round(segments))
    for (var index = 0; index < count; index += 1) {
      var angle = (index / count) * TAU
      points.push(cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius)
    }
    return points
  }

  function diamondPolygon(cx, cy, rx, ry) {
    return [
      cx, cy - ry,
      cx + rx, cy,
      cx, cy + ry,
      cx - rx, cy
    ]
  }

  // 把无限长线按凸多边形各边半平面裁剪；完全错过形状时返回 null
  function clipToConvex(polygon, ax, ay, dx, dy, span) {
    var count = polygon.length / 2
    var cx = 0
    var cy = 0
    for (var i = 0; i < count; i += 1) {
      cx += polygon[i * 2]
      cy += polygon[i * 2 + 1]
    }
    cx /= count
    cy /= count

    var tMin = -span
    var tMax = span
    for (var index = 0; index < count; index += 1) {
      var x0 = polygon[index * 2]
      var y0 = polygon[index * 2 + 1]
      var x1 = polygon[((index + 1) % count) * 2]
      var y1 = polygon[((index + 1) % count) * 2 + 1]
      var nx = y1 - y0
      var ny = -(x1 - x0)
      // 用多边形重心测试法线方向，强制法线朝外
      if (nx * (cx - x0) + ny * (cy - y0) > 0) {
        nx = -nx
        ny = -ny
      }
      var denominator = nx * dx + ny * dy
      var numerator = nx * (ax - x0) + ny * (ay - y0)
      if (Math.abs(denominator) < 1e-9) {
        if (numerator > 0) return null
        continue
      }
      var t = -numerator / denominator
      if (denominator > 0) tMax = Math.min(tMax, t)
      else tMin = Math.max(tMin, t)
      if (tMin > tMax) return null
    }
    if (tMax - tMin < 0.5) return null
    return {
      x1: ax + dx * tMin,
      y1: ay + dy * tMin,
      x2: ax + dx * tMax,
      y2: ay + dy * tMax
    }
  }

  // 用平行线填充凸多边形；coverage（0..1）收短线端，让填充能在 shot 入场时
  // 从形状中心长开
  function buildHatchLines(polygon, spec, coverage) {
    if (coverage === undefined) coverage = 1
    if (polygon.length < 6 || spec.spacing <= 0) return []
    var xs = []
    var ys = []
    for (var p = 0; p < polygon.length; p += 2) {
      xs.push(polygon[p])
      ys.push(polygon[p + 1])
    }
    var minX = Math.min.apply(null, xs)
    var maxX = Math.max.apply(null, xs)
    var minY = Math.min.apply(null, ys)
    var maxY = Math.max.apply(null, ys)
    var centerX = (minX + maxX) / 2
    var centerY = (minY + maxY) / 2
    var diagonal = Math.hypot(maxX - minX, maxY - minY)
    if (diagonal <= 0) return []

    var dx = Math.cos(spec.angle)
    var dy = Math.sin(spec.angle)
    // 垂直于线方向步进，扫满整形状对角线
    var px = -dy
    var py = dx
    // 扫描从形状中心向两侧进行，半条对角线就够
    var steps = Math.min(MAX_HATCH_LINES / 2, Math.ceil(diagonal / (spec.spacing * 2)) + 2)
    var clampedCoverage = Math.min(1, Math.max(0, coverage))
    var lines = []
    for (var step = -steps; step <= steps; step += 1) {
      var offset = step * spec.spacing
      var clipped = clipToConvex(
        polygon,
        centerX + px * offset,
        centerY + py * offset,
        dx,
        dy,
        diagonal
      )
      if (!clipped) continue
      if (clampedCoverage >= 1) {
        lines.push(clipped)
        continue
      }
      var midX = (clipped.x1 + clipped.x2) / 2
      var midY = (clipped.y1 + clipped.y2) / 2
      lines.push({
        x1: midX + (clipped.x1 - midX) * clampedCoverage,
        y1: midY + (clipped.y1 - midY) * clampedCoverage,
        x2: midX + (clipped.x2 - midX) * clampedCoverage,
        y2: midY + (clipped.y2 - midY) * clampedCoverage
      })
    }
    return lines
  }

  // 无纹理的手绘感：抖动螺旋折线，读作涂鸦圈
  function buildScribblePath(seed, salt, cx, cy, radius, turns) {
    if (turns === undefined) turns = 2
    var perTurn = 13
    var total = Math.max(perTurn, Math.round(perTurn * Math.max(1, turns)))
    var points = []
    for (var index = 0; index <= total; index += 1) {
      var progress = index / total
      var angle = progress * TAU * Math.max(1, turns)
      var jitterR = (temperaHash01(seed, index, salt) - 0.5) * radius * 0.26
      var jitterA = (temperaHash01(seed, index, salt + 7) - 0.5) * 0.22
      var currentRadius = radius * (0.52 + 0.48 * progress) + jitterR
      points.push(
        cx + Math.cos(angle + jitterA) * currentRadius,
        cy + Math.sin(angle + jitterA) * currentRadius * 0.82
      )
    }
    return points
  }

  // 海报构图底部使用的起伏横边
  function buildWavyPath(seed, salt, x0, x1, y, amplitude, steps) {
    if (steps === undefined) steps = 24
    var points = []
    var safeSteps = Math.max(2, Math.round(steps))
    for (var index = 0; index <= safeSteps; index += 1) {
      var progress = index / safeSteps
      var wave = Math.sin(progress * TAU * 1.5 + temperaHash01(seed, 0, salt) * TAU)
      var jitter = (temperaHash01(seed, index, salt) - 0.5) * amplitude * 0.5
      points.push(x0 + (x1 - x0) * progress, y + wave * amplitude + jitter)
    }
    return points
  }

  // 沿方向等距排布的记号，每枚带种子抖动使行列不读作印刷品
  function buildMarkRow(seed, salt, x, y, count, spacing, size, angle) {
    var marks = []
    var total = Math.max(0, Math.round(count))
    var dx = Math.cos(angle)
    var dy = Math.sin(angle)
    for (var index = 0; index < total; index += 1) {
      var jitter = (temperaHash01(seed, index, salt) - 0.5) * spacing * 0.16
      var distance = index * spacing + jitter
      marks.push({
        x: x + dx * distance,
        y: y + dy * distance,
        size: size * (0.82 + temperaHash01(seed, index, salt + 3) * 0.36),
        rotation: (temperaHash01(seed, index, salt + 11) - 0.5) * 0.3
      })
    }
    return marks
  }

  function buildCrossRow(seed, salt, x, y, count, spacing, size, angle) {
    if (size === undefined) size = 9
    if (angle === undefined) angle = 0
    return buildMarkRow(seed, salt, x, y, count, spacing, size, angle)
  }

  function buildDotRow(seed, salt, x, y, count, spacing, size, angle) {
    if (size === undefined) size = 4
    if (angle === undefined) angle = Math.PI / 2
    return buildMarkRow(seed, salt, x, y, count, spacing, size, angle)
  }

  // 整个场景背后的浅纸面网点用的均匀点阵
  function buildDotGrid(width, height, spacing, size) {
    if (size === undefined) size = 1.6
    var marks = []
    if (spacing <= 0 || width <= 0 || height <= 0) return marks
    var columns = Math.min(200, Math.ceil(width / spacing) + 1)
    var rows = Math.min(200, Math.ceil(height / spacing) + 1)
    for (var row = 0; row < rows; row += 1) {
      for (var column = 0; column < columns; column += 1) {
        // 隔行偏移，让格阵读作半调而非网格
        marks.push({
          x: column * spacing + (row % 2 === 0 ? 0 : spacing / 2),
          y: row * spacing,
          size: size,
          rotation: 0
        })
      }
    }
    return marks
  }

  // 一到三条穿过视口边缘的浅线，负责把视线在构图之间带过去
  function buildCrossingLines(seed, salt, width, height, count) {
    var total = Math.min(3, Math.max(0, Math.round(count)))
    var lines = []
    for (var index = 0; index < total; index += 1) {
      var anchorY = height * (0.18 + temperaHash01(seed, index, salt) * 0.64)
      var sign = temperaHash01(seed, index, salt + 5) > 0.5 ? 1 : -1
      var angle = sign * (0.07 + temperaHash01(seed, index, salt + 9) * 0.11)
      // 大幅越过两侧边缘：这一层随构图滑动，停在画框里的线会明显脱节
      var reach = width * 0.9
      lines.push({
        x1: -width * 0.3,
        y1: anchorY - Math.tan(angle) * reach,
        x2: width * 1.3,
        y2: anchorY + Math.tan(angle) * reach
      })
    }
    return lines
  }

  window.FoliaTemperaCurves = {
    ellipsePolygon: ellipsePolygon,
    roundedRectPolygon: roundedRectPolygon,
    rotatePolygon: rotatePolygon,
    lobedPolygon: lobedPolygon,
    scallopBandPolygon: scallopBandPolygon,
    heartPolygon: heartPolygon,
    annularSectorPolygon: annularSectorPolygon,
    starPolygon: starPolygon,
    arcRibbonPolygon: arcRibbonPolygon,
    buildDiscField: buildDiscField,
    buildHatchSpec: buildHatchSpec,
    rectPolygon: rectPolygon,
    circlePolygon: circlePolygon,
    diamondPolygon: diamondPolygon,
    buildHatchLines: buildHatchLines,
    buildScribblePath: buildScribblePath,
    buildWavyPath: buildWavyPath,
    buildCrossRow: buildCrossRow,
    buildDotRow: buildDotRow,
    buildDotGrid: buildDotGrid,
    buildCrossingLines: buildCrossingLines
  }
})()
