// 商籁模式·流式版式：移植自 folia-major
//   sonnet/sonnetShotFlowLayouts.ts（非海报 shot 的流式摆放 pass）
//   sonnet/sonnetPosterBlocksLayout.ts（海报分区流：强调词占固定 zone，支持词按阅读序填空）
// 全部基于精确测量的盒子做版面收排；gap 统一取 clamp(baseFontSize * 0.35, 16, 40)。
(function () {
  'use strict'

  function clamp(value, min, max) { return Math.min(max, Math.max(min, value)) }

  // 词间 gap（flowGap）与行/列 gap（stackGap），所有分支共用
  function resolveSonnetFlowGaps(baseFontSize) {
    var flowGap = clamp(baseFontSize * 0.35, 16, 40)
    return { flowGap: flowGap, stackGap: Math.max(24, flowGap * 1.35) }
  }

  // 以递减的全局缩放反复摆放，直到每个测量盒都进入安全区。
  // 所有角色一起缩放，因此 hero > semi-hero > support 的层级与
  // "支持词永不放大"规则在每次重试中都成立。
  function placeWithGlobalFit(ctx, place) {
    var snapshot = ctx.boxes.map(function (box) {
      return {
        fontScale: box.fontScale,
        measuredWidth: box.measuredWidth,
        measuredHeight: box.measuredHeight
      }
    })
    var safeHalfW = ctx.width * 0.48
    var safeHalfH = ctx.height * 0.46
    var scales = [1, 0.92, 0.84, 0.76, 0.68, 0.6, 0.52]
    for (var s = 0; s < scales.length; s += 1) {
      var globalScale = scales[s]
      ctx.boxes.forEach(function (box, index) {
        box.fontScale = snapshot[index].fontScale * globalScale
        box.measuredWidth = snapshot[index].measuredWidth * globalScale
        box.measuredHeight = snapshot[index].measuredHeight * globalScale
      })
      place(globalScale)
      var fits = ctx.boxes.every(function (box) {
        return Math.abs(box.x) + box.measuredWidth / 2 <= safeHalfW + 0.5
          && Math.abs(box.y) + box.measuredHeight / 2 <= safeHalfH + 0.5
      })
      if (fits) return
    }
  }

  // 平静静物（quiet-tableau）：一列从容的堆叠，早词在 hero 上方、晚词在下方，
  // 列严格按时间线自上而下阅读。超高时换侧列而不是缩小：
  // 早词向右续列、晚词向左续列——列按时间线从右往左读。
  function layoutQuietTableau(ctx, variant) {
    var boxes = ctx.boxes
    var heroIndex = ctx.heroIndex
    var height = ctx.height
    var stackGap = ctx.stackGap
    var heroBox = boxes[heroIndex]
    var horizontalCard = variant === 2 || variant === 3
    boxes.forEach(function (box) { box.layoutDirection = horizontalCard ? 'horizontal' : 'vertical' })
    var safeHalfH = height * 0.46
    placeWithGlobalFit(ctx, function () {
      heroBox.x = 0
      heroBox.y = horizontalCard ? 0 : -height * 0.1
      var stagger = variant === 3 ? 70 : 0
      var maxWidth = 0
      boxes.forEach(function (box) { maxWidth = Math.max(maxWidth, box.measuredWidth) })
      var columnStep = maxWidth + stackGap + stagger
      var xFor = function (box, index) {
        if (variant === 1) return heroBox.x - heroBox.measuredWidth / 2 + box.measuredWidth / 2
        if (variant === 3) return heroBox.x + ((index % 2 === 0) ? 1 : -1) * 35
        return heroBox.x
      }
      // hero 之前：自 hero 向上；溢出向右续列
      var column = 0
      var currentY = heroBox.y - heroBox.measuredHeight / 2 - stackGap
      for (var i = heroIndex - 1; i >= 0; i--) {
        var box = boxes[i]
        if (currentY - box.measuredHeight < -safeHalfH) {
          column += 1
          currentY = safeHalfH
        }
        box.x = xFor(box, i) + column * columnStep
        box.y = currentY - box.measuredHeight / 2
        currentY -= box.measuredHeight + stackGap
        if (variant === 1) { box.enterX = 20; box.enterY = 0 }
        else if (variant === 3) { box.enterX = box.x > heroBox.x ? 30 : -30; box.enterY = 0 }
        else { box.enterX = 0; box.enterY = 20 }
      }
      // hero 之后：自 hero 向下；溢出向左续列
      column = 0
      currentY = heroBox.y + heroBox.measuredHeight / 2 + stackGap
      for (var j = heroIndex + 1; j < boxes.length; j++) {
        var box2 = boxes[j]
        if (currentY + box2.measuredHeight > safeHalfH) {
          column += 1
          currentY = -safeHalfH
        }
        box2.x = xFor(box2, j) - column * columnStep
        box2.y = currentY + box2.measuredHeight / 2
        currentY += box2.measuredHeight + stackGap
        if (variant === 1) { box2.enterX = -20; box2.enterY = 0 }
        else if (variant === 3) { box2.enterX = box2.x > heroBox.x ? 30 : -30; box2.enterY = 0 }
        else { box2.enterX = 0; box2.enterY = -20 }
      }
    })
  }

  // 追踪缎带（tracking-ribbon）：一条水平线；hero 之前的词向左延伸（最早的最靠左），
  // 之后的向右延伸——严格阅读顺序。
  function layoutTrackingRibbon(ctx, variant) {
    var boxes = ctx.boxes
    var heroIndex = ctx.heroIndex
    var flowGap = ctx.flowGap
    var heroBox = boxes[heroIndex]
    boxes.forEach(function (box) { box.layoutDirection = 'horizontal' })
    placeWithGlobalFit(ctx, function () {
      heroBox.x = 0
      heroBox.y = 0
      var alignY = function (box, index) {
        if (variant === 1) return heroBox.y + heroBox.measuredHeight / 2 - box.measuredHeight / 2
        if (variant === 2) return heroBox.y - heroBox.measuredHeight / 2 + box.measuredHeight / 2
        return heroBox.y + (index % 2 === 0 ? 10 : -10)
      }
      var enter = variant === 2 ? 20 : 30
      var currentX = heroBox.x - heroBox.measuredWidth / 2 - flowGap
      for (var i = heroIndex - 1; i >= 0; i--) {
        var box = boxes[i]
        box.x = currentX - box.measuredWidth / 2
        box.y = alignY(box, i)
        currentX -= box.measuredWidth + flowGap
        box.enterX = enter; box.enterY = 0
      }
      currentX = heroBox.x + heroBox.measuredWidth / 2 + flowGap
      for (var j = heroIndex + 1; j < boxes.length; j++) {
        var box2 = boxes[j]
        box2.x = currentX + box2.measuredWidth / 2
        box2.y = alignY(box2, j)
        currentX += box2.measuredWidth + flowGap
        box2.enterX = -enter; box2.enterY = 0
      }
    })
  }

  // 杂志竖排列（editorial-column）家族：围绕测量流重建的五种杂志构图，
  // 列不逆转时间线、行互不碰撞。
  function layoutEditorialColumn(ctx, variant, secondaryHeroIndex) {
    var boxes = ctx.boxes
    var heroIndex = ctx.heroIndex
    var width = ctx.width
    var height = ctx.height
    var flowGap = ctx.flowGap
    var stackGap = ctx.stackGap
    var heroBox = boxes[heroIndex]

    if (variant === 0) {
      boxes.forEach(function (box) { box.layoutDirection = 'vertical' })
      // 传统竖排阅读：hero 立柱右侧的列放更早的词，左侧放更晚的词
      // （列从右往左读，列内自上而下）。
      placeWithGlobalFit(ctx, function () {
        heroBox.x = -width * 0.15
        heroBox.y = 0
        var currentY = heroBox.y - heroBox.measuredHeight / 2 + stackGap * 0.5
        for (var i = 0; i < heroIndex; i++) {
          var box = boxes[i]
          box.x = heroBox.x + heroBox.measuredWidth / 2 + flowGap + box.measuredWidth / 2
          box.y = currentY + box.measuredHeight / 2
          currentY += box.measuredHeight + stackGap
          box.enterX = -20; box.enterY = 0
        }
        currentY = heroBox.y - heroBox.measuredHeight / 2 + stackGap * 0.5
        for (var j = heroIndex + 1; j < boxes.length; j++) {
          var box2 = boxes[j]
          box2.x = heroBox.x - heroBox.measuredWidth / 2 - flowGap - box2.measuredWidth / 2
          box2.y = currentY + box2.measuredHeight / 2
          currentY += box2.measuredHeight + stackGap
          box2.enterX = 20; box2.enterY = 0
        }
      })
    } else if (variant === 1) {
      boxes.forEach(function (box) { box.layoutDirection = 'vertical' })
      // 贴右的杂志竖轨，按时间线自上而下。一条轨超出安全高度时向左续轨
      // （列从右往左读）而不是缩小。
      placeWithGlobalFit(ctx, function () {
        var rightEdge = width * 0.28
        var safeHalfH = height * 0.46
        var maxWidth = 0
        boxes.forEach(function (box) { maxWidth = Math.max(maxWidth, box.measuredWidth) })
        var railStep = maxWidth + stackGap
        var totalHeight = boxes.reduce(function (sum, box) { return sum + box.measuredHeight }, 0)
          + stackGap * (boxes.length - 1)
        // 只要"梯子"最小刻度下能放下就优先使用单条居中竖轨；真正长的 shot 才换轨
        var fitsSingleRail = boxes.reduce(function (sum, box) { return sum + box.measuredHeight }, 0) * 0.52
          + stackGap * (boxes.length - 1) <= safeHalfH * 2
        if (fitsSingleRail) {
          var currentY0 = -totalHeight / 2
          boxes.forEach(function (box) {
            box.x = rightEdge - box.measuredWidth / 2
            box.y = currentY0 + box.measuredHeight / 2
            currentY0 += box.measuredHeight + stackGap
            box.enterX = 20; box.enterY = 0
          })
          return
        }
        var rail = 0
        var currentY = -safeHalfH
        boxes.forEach(function (box) {
          if (currentY + box.measuredHeight > safeHalfH) {
            rail += 1
            currentY = -safeHalfH
          }
          box.x = (rightEdge - rail * railStep) - box.measuredWidth / 2
          box.y = currentY + box.measuredHeight / 2
          currentY += box.measuredHeight + stackGap
          box.enterX = 20; box.enterY = 0
        })
      })
    } else if (variant === 2) {
      boxes.forEach(function (box) { box.layoutDirection = 'horizontal' })
      // 杂志刊头：更早的词在 hero 上方组成引题行，更晚的词在刊头下方两列成对排列
      placeWithGlobalFit(ctx, function () {
        heroBox.x = 0
        heroBox.y = -height * 0.25
        var before = boxes.slice(0, heroIndex)
        var after = boxes.slice(heroIndex + 1)
        if (before.length > 0) {
          var kickerHeight = 0
          before.forEach(function (box) { kickerHeight = Math.max(kickerHeight, box.measuredHeight) })
          var kickerWidth = before.reduce(function (sum, box) { return sum + box.measuredWidth }, 0)
            + flowGap * (before.length - 1)
          var kickerY = heroBox.y - heroBox.measuredHeight / 2 - stackGap - kickerHeight / 2
          var currentX = heroBox.x - kickerWidth / 2
          before.forEach(function (box) {
            box.x = currentX + box.measuredWidth / 2
            box.y = kickerY
            currentX += box.measuredWidth + flowGap
            box.enterX = 0; box.enterY = -20
          })
        }
        var leftAnchor = heroBox.x - heroBox.measuredWidth * 0.25 - flowGap
        var rightAnchor = heroBox.x + heroBox.measuredWidth * 0.25 + flowGap
        var currentY = heroBox.y + heroBox.measuredHeight / 2 + stackGap
        for (var pair = 0; pair < after.length; pair += 2) {
          var left = after[pair]
          var right = after[pair + 1]
          var rowHeight = Math.max(left.measuredHeight, right ? right.measuredHeight : 0)
          left.x = leftAnchor - left.measuredWidth / 2
          left.y = currentY + left.measuredHeight / 2
          left.enterX = -20; left.enterY = 0
          if (right) {
            right.x = rightAnchor + right.measuredWidth / 2
            right.y = currentY + right.measuredHeight / 2
            right.enterX = 20; right.enterY = 0
          }
          currentY += rowHeight + stackGap
        }
      })
    } else if (variant === 3) {
      boxes.forEach(function (box) { box.layoutDirection = 'horizontal' })
      // 双 hero 行：两条错位的行，各自按时间线从左到右排，
      // 行距用真实行高而不是固定微移。
      placeWithGlobalFit(ctx, function () {
        heroBox.x = 0
        heroBox.y = 0
        var firstHero = Math.min(heroIndex, secondaryHeroIndex)
        var line1 = boxes.slice(0, firstHero + 1)
        var line2 = boxes.slice(firstHero + 1)
        var line1Height = 0
        line1.forEach(function (box) { line1Height = Math.max(line1Height, box.measuredHeight) })
        var line2Height = 0
        line2.forEach(function (box) { line2Height = Math.max(line2Height, box.measuredHeight) })
        var totalHeight = line1Height + stackGap + line2Height
        var line1Y = heroBox.y - totalHeight / 2 + line1Height / 2
        var line2Y = line1Y + line1Height / 2 + stackGap + line2Height / 2
        var layLine = function (line, lineY, enterX) {
          var lineWidth = line.reduce(function (sum, box) { return sum + box.measuredWidth }, 0)
            + flowGap * (line.length - 1)
          var currentX = -lineWidth / 2
          line.forEach(function (box) {
            box.x = currentX + box.measuredWidth / 2
            box.y = lineY
            currentX += box.measuredWidth + flowGap
            box.enterX = enterX; box.enterY = 0
          })
          return lineWidth
        }
        var line1Width = layLine(line1, line1Y, 30)
        var line2Width = layLine(line2, line2Y, -30)
        // 两行之间的阶梯错位
        var offsetAmount = Math.max(line1Width, line2Width) * 0.12
        line1.forEach(function (box) { box.x -= offsetAmount })
        line2.forEach(function (box) { box.x += offsetAmount })
      })
    } else if (variant === 4) {
      boxes.forEach(function (box, index) {
        box.layoutDirection = index === heroIndex ? 'vertical' : 'horizontal'
      })
      // 徽标卡：hero 立柱浮在阅读起始侧。更早的词在其上方占满行，
      // 更晚的词绕柱换行，之后再回到满行——海报流的分区浮动规则。
      placeWithGlobalFit(ctx, function () {
        var heroOnRight = heroIndex === boxes.length - 1
        var blockLeft = -width * 0.40
        var blockRight = width * 0.40
        var currentY = -height * 0.34

        // 下标从左到右收进行；柱旁的行区可收窄、柱下再放宽
        var flowWords = function (indices, regionFor) {
          var region = regionFor(currentY)
          var left = region[0]
          var right = region[1]
          var currentX = left
          var rowHeight = 0
          indices.forEach(function (index) {
            var box = boxes[index]
            if (currentX > left && currentX + box.measuredWidth > right) {
              currentY += rowHeight + stackGap
              region = regionFor(currentY)
              left = region[0]
              right = region[1]
              currentX = left
              rowHeight = 0
            }
            box.x = currentX + box.measuredWidth / 2
            box.y = currentY + box.measuredHeight / 2
            box.enterX = heroOnRight ? -25 : 25
            box.enterY = 0
            currentX += box.measuredWidth + flowGap
            rowHeight = Math.max(rowHeight, box.measuredHeight)
          })
          if (indices.length > 0) currentY += rowHeight
        }

        var beforeIndices = boxes.slice(0, heroIndex).map(function (box) { return box.index })
        var afterIndices = boxes.slice(heroIndex + 1).map(function (box) { return box.index })
        flowWords(beforeIndices, function () { return [blockLeft, blockRight] })
        currentY += stackGap

        var pillarLeft = heroOnRight ? blockRight - heroBox.measuredWidth : blockLeft
        heroBox.x = pillarLeft + heroBox.measuredWidth / 2
        heroBox.y = currentY + heroBox.measuredHeight / 2
        var pillarBottom = currentY + heroBox.measuredHeight + stackGap
        var besideLeft = heroOnRight ? blockLeft : pillarLeft + heroBox.measuredWidth + flowGap
        var besideRight = heroOnRight ? pillarLeft - flowGap : blockRight
        flowWords(afterIndices, function (rowTop) {
          return rowTop < pillarBottom - 0.5 ? [besideLeft, besideRight] : [blockLeft, blockRight]
        })
      })
    }
  }

  // 碎片拼贴（fragment-collage）：按时间线顺时针的极轨道。每个支持词
  // 不断推进角度直到其测量矩形不再压住任何已放置矩形（含 hero），
  // 环保持混乱外观的同时没有实际重叠。
  function layoutFragmentCollage(ctx, variant) {
    var boxes = ctx.boxes
    var heroIndex = ctx.heroIndex
    var flowGap = ctx.flowGap
    var stackGap = ctx.stackGap
    var heroBox = boxes[heroIndex]
    // 矩形重叠时为负，否则返回两者间距
    var rectSeparation = function (a, b) {
      return Math.max(
        Math.max(a.left - b.right, b.left - a.right),
        Math.max(a.top - b.bottom, b.top - a.bottom)
      )
    }
    // 旋转的非 CJK 盒按高旋转姿态测量；拼贴把它们放平回水平。
    // 在全局缩放重试拍照快照前放平一次，让每一档都按水平占位收排，
    // 边框装饰也不会把竖排文本框包到水平文本上。
    boxes.forEach(function (box, index) {
      if (index === heroIndex) return
      if (Math.abs(Math.round(box.rotation / (Math.PI / 2)) % 2) === 1) {
        var rotatedWidth = box.measuredHeight
        box.measuredHeight = box.measuredWidth
        box.measuredWidth = rotatedWidth
      }
      box.rotation = 0
    })
    placeWithGlobalFit(ctx, function (globalScale) {
      heroBox.x = 0
      heroBox.y = 0
      var baseRadius = Math.hypot(heroBox.measuredWidth, heroBox.measuredHeight) / 2 + stackGap
      var count = Math.max(1, boxes.length - 1)
      var squash = 0.65
      var placed = [{
        left: heroBox.x - heroBox.measuredWidth / 2,
        right: heroBox.x + heroBox.measuredWidth / 2,
        top: heroBox.y - heroBox.measuredHeight / 2,
        bottom: heroBox.y + heroBox.measuredHeight / 2
      }]
      var angle = Math.PI / 4
      var supportIndex = 0
      for (var i = 0; i < boxes.length; i++) {
        if (i === heroIndex) continue
        var box = boxes[i]
        var radius = baseRadius
        if (variant === 1) {
          // 阿基米德螺线随时间线外漂
          radius += (35 + (supportIndex / count) * 150) * globalScale
        } else if (variant === 2) {
          // 交错双环
          radius += ((supportIndex % 2 === 1) ? 140 : 50) * globalScale
        } else {
          // 经典环 + 确定性径向抖动
          radius += (45 + ((supportIndex * 23) % 90)) * globalScale
        }
        supportIndex += 1
        var candidate = angle
        var rect = { left: 0, right: 0, top: 0, bottom: 0 }
        // 沿环扫描空位；整圈无空位则半径外扩再扫，拥挤的 shot 也不会把盒子丢到已占位置上
        var resolvedRadius = radius
        var placedClear = false
        for (var ring = 0; ring < 14 && !placedClear; ring += 1) {
          for (var attempt = 0; attempt < 400; attempt++) {
            rect = {
              left: Math.cos(candidate) * resolvedRadius - box.measuredWidth / 2,
              right: Math.cos(candidate) * resolvedRadius + box.measuredWidth / 2,
              top: Math.sin(candidate) * resolvedRadius * squash - box.measuredHeight / 2,
              bottom: Math.sin(candidate) * resolvedRadius * squash + box.measuredHeight / 2
            }
            var allClear = placed.every(function (entry) { return rectSeparation(entry, rect) >= flowGap })
            if (allClear) {
              placedClear = true
              break
            }
            candidate += 0.07
          }
          if (!placedClear) resolvedRadius += (36 + ring * 12) * globalScale
        }
        angle = candidate + 0.02
        placed.push(rect)
        box.x = heroBox.x + Math.cos(candidate) * resolvedRadius
        box.y = heroBox.y + Math.sin(candidate) * resolvedRadius * squash
        box.layoutDirection = Math.abs(Math.cos(candidate)) >= Math.abs(Math.sin(candidate))
          ? 'vertical'
          : 'horizontal'
        box.enterX = Math.cos(candidate) * -60
        box.enterY = Math.sin(candidate) * -60
      }
    })
  }

  // 动态十字（type-impact / mask-reveal）：上列 → 左行 → hero → 右行 → 下列。
  // 分段规则天然保证扫描顺序等于时间线顺序。
  function layoutCrossStack(ctx) {
    var boxes = ctx.boxes
    var heroIndex = ctx.heroIndex
    var height = ctx.height
    var flowGap = ctx.flowGap
    var stackGap = ctx.stackGap
    var heroBox = boxes[heroIndex]
    var beforeCount = heroIndex
    var topCount = Math.floor(beforeCount / 2)
    var afterCount = boxes.length - 1 - heroIndex
    var rightCount = Math.ceil(afterCount / 2)

    // 列带用于把支持级词紧密贴住 hero；短列会留大片空白。
    // 放大不足的列词（上限低于 hero 层级）并沿可用区间两端撑开列。
    // 放在 fit 回调内执行：只有当前档（可能已缩小的）hero 高度决定列带余量。
    var fillColumn = function (column) {
      if (column.length === 0) return 0
      var available = Math.max(0, height * 0.46 - heroBox.measuredHeight / 2 - stackGap)
      if (available <= 0) return 0
      var gaps = stackGap * (column.length - 1)
      var contentHeight = column.reduce(function (sum, box) { return sum + box.measuredHeight }, 0)
      var target = available * 0.72
      if (contentHeight + gaps < target) {
        var boost = Math.min(2.2, (target - gaps) / Math.max(1, contentHeight))
        column.forEach(function (box) {
          // 放大的词绝不超过 hero 层级
          var capped = Math.min(boost, (heroBox.fontScale * 0.6) / box.fontScale)
          if (capped > 1.05) {
            box.fontScale *= capped
            box.measuredWidth *= capped
            box.measuredHeight *= capped
          }
        })
      }
      if (column.length < 2) return 0
      var grown = column.reduce(function (sum, box) { return sum + box.measuredHeight }, 0)
      var pitch = (available * 0.95 - grown) / (column.length - 1)
      return Math.max(0, Math.min(stackGap * 2, pitch - stackGap))
    }

    placeWithGlobalFit(ctx, function () {
      heroBox.x = 0
      heroBox.y = 0
      var topStretch = fillColumn(boxes.slice(0, topCount))
      var bottomStretch = fillColumn(boxes.slice(heroIndex + rightCount + 1))

      // 左行：下标 topCount..heroIndex-1，最早的最靠左
      var currentX = heroBox.x - heroBox.measuredWidth / 2 - stackGap
      for (var i = heroIndex - 1; i >= topCount; i--) {
        var box = boxes[i]
        box.layoutDirection = 'horizontal'
        box.x = currentX - box.measuredWidth / 2
        box.y = heroBox.y + (i % 2 === 0 ? 10 : -10)
        currentX -= box.measuredWidth + flowGap
        box.enterX = -30; box.enterY = 0
      }

      // 上列：下标 0..topCount-1，最早的最靠上
      var currentY = heroBox.y - heroBox.measuredHeight / 2 - stackGap
      for (var j = topCount - 1; j >= 0; j--) {
        var box2 = boxes[j]
        box2.layoutDirection = 'vertical'
        box2.x = heroBox.x + (j % 2 === 0 ? 15 : -15)
        box2.y = currentY - box2.measuredHeight / 2
        currentY -= box2.measuredHeight + stackGap + topStretch
        box2.enterX = 0; box2.enterY = -30
      }

      // 右行：紧随 hero 的词，从左到右
      currentX = heroBox.x + heroBox.measuredWidth / 2 + stackGap
      for (var k = heroIndex + 1; k <= heroIndex + rightCount; k++) {
        var box3 = boxes[k]
        box3.layoutDirection = 'horizontal'
        box3.x = currentX + box3.measuredWidth / 2
        box3.y = heroBox.y + (k % 2 === 0 ? 10 : -10)
        currentX += box3.measuredWidth + flowGap
        box3.enterX = 30; box3.enterY = 0
      }

      // 下列：其余词，自上而下
      currentY = heroBox.y + heroBox.measuredHeight / 2 + stackGap
      for (var m = heroIndex + rightCount + 1; m < boxes.length; m++) {
        var box4 = boxes[m]
        box4.layoutDirection = 'vertical'
        box4.x = heroBox.x + (m % 2 === 0 ? 15 : -15)
        box4.y = currentY + box4.measuredHeight / 2
        currentY += box4.measuredHeight + stackGap + bottomStretch
        box4.enterX = 0; box4.enterY = 30
      }
    })
  }

  // ---------- 海报分区流（原版 sonnetPosterBlocksLayout.ts） ----------
  // 把阅读序列切成强调词 zone 与支持词 run
  function partitionFlowItems(boxes) {
    var items = []
    var group = []
    boxes.forEach(function (box) {
      if (box.isHero || box.isSemiHero) {
        if (group.length > 0) items.push({ kind: 'group', group: group })
        group = []
        items.push({ kind: 'zone', zone: box })
      } else {
        group.push(box)
      }
    })
    if (group.length > 0) items.push({ kind: 'group', group: group })
    return items
  }

  // 流空间矩形映射到屏幕坐标。竖排列变体中列从右向左推进，
  // 与传统日文排版一致。
  function flowToScreen(space, rect, canvas) {
    if (space.orientation === 'horizontal') {
      return {
        x: canvas.x + rect.u,
        y: canvas.y + rect.v,
        width: rect.uSize,
        height: rect.vSize
      }
    }
    return {
      x: canvas.x + canvas.width - rect.v - rect.vSize,
      y: canvas.y + rect.u,
      width: rect.vSize,
      height: rect.uSize
    }
  }

  // zone 后跟支持词组时，把这些行跨过的阅读起始侧保留出来，
  // 后续支持词得以绕排，同时保持扫描顺序。
  // 在给定全局缩放摆放整个 shot。总是返回尝试结果（即便堆叠溢出画布），
  // 让调用者挑选第一个放得下的缩放或对最后一个做应急收缩——盒子绝不能被留在原点。
  function attemptFlowLayout(boxes, space, globalScale, chipGap, lineGap, seed) {
    var items = partitionFlowItems(boxes)
    var placements = []
    var floats = []
    var vCursor = 0
    var ownBandOnEndSide = ((seed >> 1) & 1) === 1

    // 当前缩放下的屏幕尺寸；仅当 shot 竖排且存在精确列测量时才用竖排朝向
    var measure = function (box) {
      var useVertical = space.orientation === 'vertical'
        && typeof box.verticalMeasuredWidth === 'number'
        && typeof box.verticalMeasuredHeight === 'number'
        && typeof box.verticalFontScale === 'number'
      var baseScale = useVertical ? box.verticalFontScale : box.fontScale
      var width = (useVertical ? box.verticalMeasuredWidth : box.measuredWidth) * globalScale
      var height = (useVertical ? box.verticalMeasuredHeight : box.measuredHeight) * globalScale
      return { useVertical: useVertical, baseScale: baseScale, width: width, height: height }
    }
    var toFlowSize = function (width, height) {
      return space.orientation === 'horizontal'
        ? { uSize: width, vSize: height }
        : { uSize: height, vSize: width }
    }

    var pruneFloats = function () {
      for (var index = floats.length - 1; index >= 0; index--) {
        if (floats[index].vBottom <= vCursor) floats.splice(index, 1)
      }
    }

    items.forEach(function (item, itemIndex) {
      pruneFloats()
      if (item.kind === 'group') {
        var reservedU = floats.reduce(function (sum, entry) { return sum + entry.extent }, 0)
        var capacity = Math.max(chipGap * 2, space.u - reservedU)
        var uStart = reservedU
        var chips = item.group.map(function (box) {
          var dims = measure(box)
          var flow = toFlowSize(dims.width, dims.height)
          return { box: box, dims: dims, uSize: flow.uSize, vSize: flow.vSize, shrink: 1 }
        })

        // 按阅读序贪心换行，再逐行两端撑开，让支持词铺满带区而非挤在一边
        var line = []
        var lineUsedU = 0
        var flushLine = function () {
          if (line.length === 0) return
          var lineV = 0
          line.forEach(function (chip) { lineV = Math.max(lineV, chip.vSize * chip.shrink) })
          var leftover = capacity - lineUsedU
          var spread = line.length > 1 && leftover > 0
            ? Math.min(leftover / (line.length - 1), chipGap * 2.5)
            : 0
          var uCursor = uStart
          line.forEach(function (chip) {
            var finalScale = chip.dims.baseScale * globalScale * chip.shrink
            placements.push({
              box: chip.box,
              rect: {
                u: uCursor,
                v: vCursor,
                uSize: chip.uSize * chip.shrink,
                vSize: chip.vSize * chip.shrink
              },
              scale: finalScale,
              vertical: chip.dims.useVertical
            })
            uCursor += chip.uSize * chip.shrink + chipGap + spread
          })
          vCursor += lineV + lineGap
          pruneFloats()
          line = []
          lineUsedU = 0
        }

        chips.forEach(function (chip) {
          var needed = lineUsedU + (line.length > 0 ? chipGap : 0) + chip.uSize
          if (needed > capacity && line.length > 0) flushLine()
          if (chip.uSize > capacity) {
            // 单个超宽 chip 收缩进带内而不是换行
            chip.shrink = Math.max(0.5, capacity / chip.uSize)
            lineUsedU = 0
            line.push(chip)
            flushLine()
            return
          }
          lineUsedU += (line.length > 0 ? chipGap : 0) + chip.uSize
          line.push(chip)
        })
        flushLine()
        return
      }

      // zone 摆放：绝不与前一个 zone 的浮动区间重叠
      var zone = item.zone
      floats.forEach(function (entry) { vCursor = Math.max(vCursor, entry.vBottom) })
      vCursor = Math.max(vCursor, 0)
      floats.length = 0

      var zoneDims = measure(zone)
      var zoneFlow = toFlowSize(zoneDims.width, zoneDims.height)
      var followedByGroup = itemIndex + 1 < items.length && items[itemIndex + 1].kind === 'group'
      var zoneShrink = Math.min(
        1,
        (space.u * (followedByGroup ? 0.62 : 0.9)) / zoneFlow.uSize,
        (space.v * 0.66) / zoneFlow.vSize
      )
      var uSize = zoneFlow.uSize * zoneShrink
      var vSize = zoneFlow.vSize * zoneShrink
      var onlyZone = items.length === 1
      var u = onlyZone
        ? (space.u - uSize) / 2
        : followedByGroup
          ? 0
          : ownBandOnEndSide
            ? space.u - uSize
            : 0
      placements.push({
        box: zone,
        rect: { u: u, v: vCursor, uSize: uSize, vSize: vSize },
        scale: zoneDims.baseScale * globalScale * zoneShrink,
        vertical: zoneDims.useVertical
      })
      if (followedByGroup) {
        floats.push({ extent: uSize + chipGap, vBottom: vCursor + vSize + lineGap })
      } else {
        vCursor += vSize + lineGap
        ownBandOnEndSide = !ownBandOnEndSide
      }
    })

    var vTotal = placements.reduce(function (max, placement) {
      return Math.max(max, placement.rect.v + placement.rect.vSize)
    }, 0)
    return { placements: placements, vTotal: vTotal }
  }

  function layoutSonnetPosterBlocks(boxes, width, height, baseFontSize, seed) {
    if (seed === undefined) seed = 0
    if (boxes.length === 0) return { placements: [], width: 0, height: 0, gap: 0 }
    var gap = clamp(baseFontSize * 0.35, 16, 40)
    var chipGap = gap
    var lineGap = gap * 1.15
    // 画布保持在台面内（海报相机最大变焦约 1.18），
    // 但足够大让兜底构图保持可读字号。
    var canvas = {
      x: -width * 0.42,
      y: -height * 0.40,
      width: width * 0.84,
      height: height * 0.80
    }
    var orientation = (seed % 2 === 0) ? 'horizontal' : 'vertical'
    // 流 u 是阅读方向（行模式为屏幕 x，列模式为屏幕 y），流 v 是堆叠方向——竖排变体交换容量
    var space = orientation === 'horizontal'
      ? { orientation: 'horizontal', u: canvas.width, v: canvas.height }
      : { orientation: 'vertical', u: canvas.height, v: canvas.width }

    // 支持词绝不放大超过其角色字号；全局重试只缩不放
    var attempt = attemptFlowLayout(boxes, space, 1, chipGap, lineGap, seed)
    var scales = [0.92, 0.84, 0.76, 0.68, 0.6, 0.52]
    for (var s = 0; s < scales.length; s += 1) {
      if (attempt.vTotal <= space.v + 0.5) break
      attempt = attemptFlowLayout(boxes, space, scales[s], chipGap, lineGap, seed)
    }
    // 应急等比收缩：即便每档梯子都溢出，也把整个构图缩进画布而不是把盒子留在原点
    if (attempt.vTotal > space.v) {
      var fitScale = space.v / attempt.vTotal
      attempt.placements.forEach(function (placement) {
        placement.rect.u *= fitScale
        placement.rect.v *= fitScale
        placement.rect.uSize *= fitScale
        placement.rect.vSize *= fitScale
        placement.scale *= fitScale
      })
      attempt.vTotal = space.v
    }

    var vShift = Math.max(0, (space.v - attempt.vTotal) / 2)
    attempt.placements.forEach(function (placement) {
      var box = placement.box
      var rect = {
        u: placement.rect.u,
        v: placement.rect.v + vShift,
        uSize: placement.rect.uSize,
        vSize: placement.rect.vSize
      }
      var screen = flowToScreen(space, rect, canvas)
      box.fontScale = placement.scale
      box.measuredWidth = screen.width
      box.measuredHeight = screen.height
      box.x = screen.x + screen.width / 2
      box.y = screen.y + screen.height / 2
      box.rotation = 0
      box.vertical = placement.vertical
      if (placement.vertical && box.verticalDisplayText) box.displayText = box.verticalDisplayText
      box.layoutDirection = orientation === 'vertical' ? 'vertical' : 'horizontal'
      if (orientation === 'horizontal') {
        box.enterX = (screen.x + screen.width / 2 < 0 ? -1 : 1) * Math.min(28, baseFontSize * 0.45)
        box.enterY = Math.min(18, baseFontSize * 0.25)
      } else {
        box.enterX = Math.min(18, baseFontSize * 0.25)
        box.enterY = (screen.y + screen.height / 2 < 0 ? -1 : 1) * Math.min(28, baseFontSize * 0.45)
      }
    })
    return { placements: boxes, width: canvas.width, height: canvas.height, gap: gap }
  }

  window.FoliaSonnetFlowLayouts = {
    resolveSonnetFlowGaps: resolveSonnetFlowGaps,
    placeWithGlobalFit: placeWithGlobalFit,
    layoutQuietTableau: layoutQuietTableau,
    layoutTrackingRibbon: layoutTrackingRibbon,
    layoutEditorialColumn: layoutEditorialColumn,
    layoutFragmentCollage: layoutFragmentCollage,
    layoutCrossStack: layoutCrossStack,
    layoutSonnetPosterBlocks: layoutSonnetPosterBlocks
  }
})()
