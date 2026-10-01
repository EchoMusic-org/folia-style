// 绘光模式·线稿：移植自 folia-major src/components/visualizer/lumiere/lineart/
//   lineArt.ts（光学线稿层：一组折线按进度描出来、节点闪点、GPU 数据滞回卸载）
//   iconPaths.ts（lucide 图标 → 折线：path/circle/ellipse/line/rect/polyline/polygon 展平，弧与贝塞尔分段）
//   themeIcons.ts（主题图标线稿：theme.lyricsIcons 按种子散落在构图空处，逐笔描出）
// 统一挂载到 window.FoliaLumiereLineart，属性名与源导出名完全一致：
//   LINE_ART_UNLOAD_AFTER / LINE_ART_UNLOAD_LEAD / shouldUnloadLineArt / createLineArt（lineArt.ts）
//   ICON_VIEWBOX / svgPathToPolylines / iconNodeToPolylines / lucideIconPolylines（iconPaths.ts）
//   placeThemeIcons / themeIconsArt / buildThemeIconArt / buildShotIconArts（themeIcons.ts）
//   （源的 Point / LinePath / LineNode / LineArtSpec / LineArtLayer / IconPolyline / IconAvoidRegion /
//     PlacedIcon / ThemeIconOptions 为 TS 类型，编译期擦除，不转写）
// 特殊处理（lucide 图标）：原 iconPaths.ts 经 resolveLucideIcon（lucide-react）取图标组件里的 IconNode；
//   插件没有 lucide-react，改为内嵌 LUCIDE_ICON_NODES 表——flower/heart/star/moon/sun/music/sparkles/
//   leaf/snowflake/flame/zap/ghost/cloud/bird 共 14 枚图标的 [tag, attrs] 节点数据（24×24 viewBox，
//   数据与 lucide 官方 SVG 一致），展平逻辑（ellipsePoints / arcToPoints / 贝塞尔分段）按原版转写，
//   只是数据源从 lucide 组件换成这张表；原 readIconNode 不再需要，删除。
//   原 lucideIconResolver 的 resolveLucideIconNames 转为查该表：小写索引、Set 去重、未知名字丢弃、无回退。
// 兼容别名：lumiere-credits.js 从本对象取 recipes.ts 的 mergeSpecs / protractorHalo / scatteredSparks /
//   viewfinderFrame；这四个函数按全局命名表归 window.FoliaLumiereDiagrams（见 lumiere-diagrams.js），
//   此处以 getter 在运行时转发，与脚本加载顺序无关。
// 跨模块依赖（全部在函数体内运行时经 window 取，与脚本加载顺序无关）：
//   window.FoliaLumiereRigs（light/rig.ts 的 compressLight / lightAt）
//   window.FoliaLumiereCore（lumiereRandom.ts 的 createRng）
//   （lineArt.ts 对 pixi.js 只有类型引用，运行时的 pixi 模块由 createLineArt 的入参传入，不取 window.PIXI）
// 简化：源文件里的混淆常量 LUMIERE_NEUTRAL_OFFSET 是（表达式）-（表达式），恒等于 0，
//   直接内联为 0（LINE_ART_UNLOAD_AFTER = 2、TEXT_PAD = 0.05），并删除不再使用的 lumiereScaleMask。
//   theme.lyricsIcons 在插件里恒为空数组，主题图标线稿实际为空，行为与原版一致。
(function () {
  'use strict'

  // =============================================================================================
  // lineArt.ts —— 光学线稿层
  // 光学线稿：一组折线（高度单位坐标），按进度描出来，节点上有闪点。每条线一个 Graphics：
  // 描线进度变化时才重建几何，受光强弱只改 alpha（光柱扫过时，照到的线更亮）。

  /** 藏起来多少秒（歌曲时间）之后才放 GPU 数据：刚淡出的线可能被回拖一下又要画。 */
  const LINE_ART_UNLOAD_AFTER = 2
  /** 下次出现在这么多秒之内就不放：马上又要画，放了只是白传一遍。 */
  const LINE_ART_UNLOAD_LEAD = 4

  /**
   * 藏着的线稿这一帧该不该放掉 GPU 数据（滞回：藏够 LINE_ART_UNLOAD_AFTER 秒，且离下次出现至少 LINE_ART_UNLOAD_LEAD 秒）。
   * 起因：轨迹过渡把整首歌并成一个单元，每个镜头的线稿都活到单元销毁，画过一次的每条线都留着一个 batcher 和两块缓冲。
   */
  const shouldUnloadLineArt = (hiddenSince, time, nextUse) =>
    time - hiddenSince >= LINE_ART_UNLOAD_AFTER && nextUse - time >= LINE_ART_UNLOAD_LEAD

  const cumulative = (points) => {
    const lengths = [0]
    for (let i = 1; i < points.length; i += 1) {
      const [ax, ay] = points[i - 1]
      const [bx, by] = points[i]
      lengths.push(lengths[i - 1] + Math.hypot(bx - ax, by - ay))
    }
    return lengths
  }

  const clamp01 = (value) => Math.min(1, Math.max(0, value))

  const createLineArt = (pixi, options) => {
    const { height, spec } = options
    const view = new pixi.Container()
    const pathsHolder = new pixi.Container()
    const nodesHolder = new pixi.Container()
    view.addChild(pathsHolder, nodesHolder)

    const paths = spec.paths.filter(path => path.points.length > 1).map(path => {
      const graphics = new pixi.Graphics()
      pathsHolder.addChild(graphics)
      const lengths = cumulative(path.points)
      const mid = path.points[Math.floor(path.points.length / 2)]
      return { spec: path, graphics, lengths, total: lengths[lengths.length - 1], drawn: -1, midpoint: mid }
    })

    const nodes = spec.nodes.map(node => {
      const sprite = new pixi.Sprite(options.starTexture)
      sprite.anchor.set(0.5)
      sprite.position.set(node.at[0] * height, node.at[1] * height)
      nodesHolder.addChild(sprite)
      return { spec: node, sprite }
    })

    /** 画出一条线的前 amount 长度（考虑虚线）。 */
    const redraw = (path, amount) => {
      const g = path.graphics
      g.clear()
      if (amount <= 0) return
      const { points, dash } = path.spec
      const limit = Math.min(amount, path.total)
      const period = dash ? dash[0] + dash[1] : 0
      const at = (index, distance) => {
        const [ax, ay] = points[index - 1]
        const [bx, by] = points[index]
        const segment = path.lengths[index] - path.lengths[index - 1]
        const f = segment > 0 ? (distance - path.lengths[index - 1]) / segment : 0
        return [(ax + (bx - ax) * f) * height, (ay + (by - ay) * f) * height]
      }
      g.moveTo(points[0][0] * height, points[0][1] * height)
      for (let i = 1; i < points.length; i += 1) {
        const start = path.lengths[i - 1]
        const end = Math.min(path.lengths[i], limit)
        if (start >= limit) break
        if (!dash) {
          const [x, y] = at(i, end)
          g.lineTo(x, y)
          continue
        }
        // 虚线：按周期的整数下标取出落在本段里的每一截实线（不用浮点游标，避免卡在边界上）。
        for (let k = Math.floor(start / period); k * period < end; k += 1) {
          const from = Math.max(start, k * period)
          const to = Math.min(end, k * period + dash[0])
          if (to <= from) continue
          const [ax, ay] = at(i, from)
          const [bx, by] = at(i, to)
          g.moveTo(ax, ay)
          g.lineTo(bx, by)
        }
      }
      const px = path.spec.width * height
      g.stroke({ width: px * 3.2, color: 0xffffff, alpha: 0.12, cap: 'round', join: 'round' })
      g.stroke({ width: px, color: 0xffffff, alpha: 1, cap: 'round', join: 'round' })
    }

    // resident：画过、GPU 数据可能还在；hiddenSince：这次藏起来的时刻（NaN 表示正在画）。
    let resident = false
    let hiddenSince = Number.NaN

    const update = (time, draw, fade, beams, color) => {
      resident = true
      hiddenSince = Number.NaN
      const Rigs = window.FoliaLumiereRigs
      for (const path of paths) {
        const { delay, span } = path.spec
        const local = clamp01((draw - delay) / Math.max(span, 1e-3))
        const eased = 1 - (1 - local) ** 3
        const amount = eased * path.total
        if (Math.abs(amount - path.drawn) > 1e-5) {
          redraw(path, amount)
          path.drawn = amount
        }
        const lit = Rigs.compressLight(Rigs.lightAt(beams, path.midpoint[0], path.midpoint[1]))
        // 光束外的线也要看得见（参考图里取景框、叶片都在暗处），受光的部分再亮一截。
        path.graphics.alpha = Math.min(1, path.spec.alpha * fade * (0.55 + 0.9 * lit))
        path.graphics.tint = color
      }
      for (const { spec: node, sprite } of nodes) {
        const appear = clamp01((draw - node.delay) / 0.08)
        const lit = Rigs.compressLight(Rigs.lightAt(beams, node.at[0], node.at[1]))
        const twinkle = 0.55 + 0.45 * Math.sin(time * 2.3 + node.twinklePhase)
        const alpha = appear * fade * (0.25 + 0.75 * lit) * twinkle
        sprite.visible = alpha > 0.004
        if (!sprite.visible) continue
        const pop = 1 + (1 - appear) * 1.5
        const px = node.size * height * pop * (0.8 + 0.2 * twinkle)
        sprite.width = px
        sprite.height = px
        sprite.alpha = alpha
        sprite.tint = color
      }
    }

    const idle = (time, nextUse) => {
      if (!resident) return
      // 刚藏起来，或回拖到了藏起来之前：从这一刻重新计时。
      if (!(hiddenSince <= time)) hiddenSince = time
      if (!shouldUnloadLineArt(hiddenSince, time, nextUse)) return
      // 只放 GPU 数据，几何指令留在 context 里；再画到时 Pixi 按指令重建、重传，和描线期间每帧重画走的是同一条路。
      // context 都是各条线自建的，没有别人共用。
      for (const path of paths) path.graphics.context.unload()
      resident = false
    }

    return {
      view,
      update,
      idle,
      // context: true 必须带上：Pixi 8 的 Graphics.destroy 只要收到选项对象、却没写 context: true，就不销毁它自己建的
      // GraphicsContext。那个 context 还挂在渲染器的 GraphicsContextSystem 里，连同它的 GPU 批数据（一个 batcher、
      // 两块顶点 / 索引缓冲）要等 Pixi 的 GC 空闲 60 秒后才回收；单元换得勤时，WebGL 缓冲会一直涨到那个窗口的量。
      destroy: () => view.destroy({ children: true, context: true })
    }
  }

  // =============================================================================================
  // iconPaths.ts —— lucide 图标 → 折线
  // Lucide 图标 → 折线：取图标的 SVG 节点（path / circle / ellipse / line / rect / polyline / polygon），
  // 弧与贝塞尔按角度 / 分段展平成折线，坐标留在图标自己的 24×24 viewBox 里，交给描线引擎再缩放摆放。
  // 每个图标名只展平一次（模块级缓存），场景构建时直接取。

  /** lucide 的 viewBox 边长。 */
  const ICON_VIEWBOX = 24

  /** 曲线展平的精度：整圆 48 段，贝塞尔每段 12 段。 */
  const CIRCLE_STEPS = 48
  const CURVE_STEPS = 12

  const num = (value, fallback = 0) => {
    const parsed = typeof value === 'number' ? value : Number.parseFloat(String(value ?? ''))
    return Number.isFinite(parsed) ? parsed : fallback
  }

  const ellipsePoints = (cx, cy, rx, ry, steps = CIRCLE_STEPS) => (
    Array.from({ length: steps + 1 }, (_, i) => {
      const a = (i / steps) * Math.PI * 2
      return [cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]
    })
  )

  /** 圆角矩形：四条边 + 四个四分之一圆弧，顺时针闭合。 */
  const rectPoints = (x, y, w, h, rxIn, ryIn) => {
    const rx = Math.min(Math.max(0, rxIn), w / 2)
    const ry = Math.min(Math.max(0, ryIn), h / 2)
    if (rx <= 0 || ry <= 0) return [[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y]]
    const corner = (cx, cy, from) => Array.from({ length: 7 }, (_, i) => {
      const a = from + (i / 6) * (Math.PI / 2)
      return [cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]
    })
    const points = [
      ...corner(x + w - rx, y + ry, -Math.PI / 2),
      ...corner(x + w - rx, y + h - ry, 0),
      ...corner(x + rx, y + h - ry, Math.PI / 2),
      ...corner(x + rx, y + ry, Math.PI)
    ]
    points.push(points[0])
    return points
  }

  const pointList = (value) => {
    const numbers = String(value ?? '').trim().split(/[\s,]+/).map(Number).filter(Number.isFinite)
    const points = []
    for (let i = 0; i + 1 < numbers.length; i += 2) points.push([numbers[i], numbers[i + 1]])
    return points
  }

  /** SVG 椭圆弧（端点参数化）→ 折线（不含起点）。按 SVG 规范换成圆心参数化，半径不够时等比放大。 */
  const arcToPoints = (from, rxIn, ryIn, angleDeg, largeArc, sweep, to) => {
    let rx = Math.abs(rxIn)
    let ry = Math.abs(ryIn)
    if (rx === 0 || ry === 0 || (from[0] === to[0] && from[1] === to[1])) return [to]
    const phi = (angleDeg * Math.PI) / 180
    const cos = Math.cos(phi)
    const sin = Math.sin(phi)
    const dx = (from[0] - to[0]) / 2
    const dy = (from[1] - to[1]) / 2
    const x1 = cos * dx + sin * dy
    const y1 = -sin * dx + cos * dy
    const lambda = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry)
    if (lambda > 1) {
      rx *= Math.sqrt(lambda)
      ry *= Math.sqrt(lambda)
    }
    const numerator = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1
    const denominator = rx * rx * y1 * y1 + ry * ry * x1 * x1
    const factor = (largeArc === sweep ? -1 : 1) * Math.sqrt(Math.max(0, numerator / Math.max(denominator, 1e-12)))
    const cx1 = (factor * rx * y1) / ry
    const cy1 = (-factor * ry * x1) / rx
    const cx = cos * cx1 - sin * cy1 + (from[0] + to[0]) / 2
    const cy = sin * cx1 + cos * cy1 + (from[1] + to[1]) / 2
    const angleOf = (ux, uy) => Math.atan2(uy, ux)
    const start = angleOf((x1 - cx1) / rx, (y1 - cy1) / ry)
    let delta = angleOf((-x1 - cx1) / rx, (-y1 - cy1) / ry) - start
    if (sweep && delta < 0) delta += Math.PI * 2
    if (!sweep && delta > 0) delta -= Math.PI * 2
    const steps = Math.max(2, Math.ceil((Math.abs(delta) / (Math.PI * 2)) * CIRCLE_STEPS))
    const points = []
    for (let i = 1; i <= steps; i += 1) {
      const a = start + (delta * i) / steps
      const ex = Math.cos(a) * rx
      const ey = Math.sin(a) * ry
      points.push(i === steps ? to : [cos * ex - sin * ey + cx, sin * ex + cos * ey + cy])
    }
    return points
  }

  const cubicTo = (p0, p1, p2, p3) => Array.from({ length: CURVE_STEPS }, (_, k) => {
    const t = (k + 1) / CURVE_STEPS
    const u = 1 - t
    const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t
    return [a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0], a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1]]
  })

  const quadTo = (p0, p1, p2) => Array.from({ length: CURVE_STEPS }, (_, k) => {
    const t = (k + 1) / CURVE_STEPS
    const u = 1 - t
    return [u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0], u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1]]
  })

  /**
   * SVG path 的 d → 折线（每个子路径一条）。支持全部命令（M L H V C S Q T A Z，大小写）；
   * 弧的两个标志位可以不带分隔符紧挨着写（lucide 的压缩写法「a4.5 4.5 0 1 1 7.5 12」「a2 2 0 012 2」）。
   */
  const svgPathToPolylines = (d) => {
    const result = []
    let index = 0
    const skip = () => {
      while (index < d.length && /[\s,]/.test(d[index])) index += 1
    }
    const readNumber = () => {
      skip()
      const match = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(d.slice(index))
      if (!match) return null
      index += match[0].length
      return Number(match[0])
    }
    const readFlag = () => {
      skip()
      const char = d[index]
      if (char !== '0' && char !== '1') return null
      index += 1
      return char === '1'
    }
    const hasNumber = () => {
      skip()
      return index < d.length && /[+\-.\d]/.test(d[index])
    }

    let current = [0, 0]
    let start = [0, 0]
    let points = []
    let lastControl = null
    let lastKind = ''
    const flush = (closed) => {
      if (points.length > 1) result.push({ points, closed })
      points = []
    }

    while (index < d.length) {
      skip()
      if (index >= d.length) break
      const command = d[index]
      if (!/[MmLlHhVvCcSsQqTtAaZz]/.test(command)) break
      index += 1
      const relative = command === command.toLowerCase()
      const kind = command.toUpperCase()
      const abs = (x, y) => (relative ? [current[0] + x, current[1] + y] : [x, y])
      if (kind === 'Z') {
        if (points.length > 0) {
          points.push(start)
          flush(true)
        }
        current = start
        lastControl = null
        lastKind = kind
        continue
      }
      let first = true
      do {
        if (kind === 'M') {
          const x = readNumber(); const y = readNumber()
          if (x === null || y === null) break
          const target = abs(x, y)
          // M 后面的坐标对按 L 处理。
          if (first) {
            flush(false)
            start = target
            points = [target]
          } else {
            points.push(target)
          }
          current = target
          lastControl = null
        } else if (kind === 'L') {
          const x = readNumber(); const y = readNumber()
          if (x === null || y === null) break
          current = abs(x, y)
          points.push(current)
          lastControl = null
        } else if (kind === 'H') {
          const x = readNumber()
          if (x === null) break
          current = [relative ? current[0] + x : x, current[1]]
          points.push(current)
          lastControl = null
        } else if (kind === 'V') {
          const y = readNumber()
          if (y === null) break
          current = [current[0], relative ? current[1] + y : y]
          points.push(current)
          lastControl = null
        } else if (kind === 'C' || kind === 'S') {
          let c1
          if (kind === 'C') {
            const x1 = readNumber(); const y1 = readNumber()
            if (x1 === null || y1 === null) break
            c1 = abs(x1, y1)
          } else {
            c1 = lastControl && (lastKind === 'C' || lastKind === 'S')
              ? [current[0] * 2 - lastControl[0], current[1] * 2 - lastControl[1]]
              : current
          }
          const x2 = readNumber(); const y2 = readNumber(); const x = readNumber(); const y = readNumber()
          if (x2 === null || y2 === null || x === null || y === null) break
          const c2 = abs(x2, y2)
          const end = abs(x, y)
          if (points.length === 0) points = [current]
          points.push(...cubicTo(current, c1, c2, end))
          current = end
          lastControl = c2
        } else if (kind === 'Q' || kind === 'T') {
          let c
          if (kind === 'Q') {
            const x1 = readNumber(); const y1 = readNumber()
            if (x1 === null || y1 === null) break
            c = abs(x1, y1)
          } else {
            c = lastControl && (lastKind === 'Q' || lastKind === 'T')
              ? [current[0] * 2 - lastControl[0], current[1] * 2 - lastControl[1]]
              : current
          }
          const x = readNumber(); const y = readNumber()
          if (x === null || y === null) break
          const end = abs(x, y)
          if (points.length === 0) points = [current]
          points.push(...quadTo(current, c, end))
          current = end
          lastControl = c
        } else if (kind === 'A') {
          const rx = readNumber(); const ry = readNumber(); const angle = readNumber()
          const large = readFlag(); const sweep = readFlag()
          const x = readNumber(); const y = readNumber()
          if (rx === null || ry === null || angle === null || large === null || sweep === null || x === null || y === null) break
          const end = abs(x, y)
          if (points.length === 0) points = [current]
          points.push(...arcToPoints(current, rx, ry, angle, large, sweep, end))
          current = end
          lastControl = null
        }
        // 同一命令后面可以连着多组参数。
        lastKind = kind
        first = false
      } while (hasNumber())
    }
    flush(false)
    return result
  }

  /** 一个 lucide 节点 → 折线。未知元素忽略。 */
  const nodeToPolylines = (tag, attrs) => {
    switch (tag) {
      case 'path':
        return svgPathToPolylines(String(attrs.d ?? ''))
      case 'circle': {
        const r = num(attrs.r)
        return r > 0 ? [{ points: ellipsePoints(num(attrs.cx), num(attrs.cy), r, r), closed: true }] : []
      }
      case 'ellipse': {
        const rx = num(attrs.rx)
        const ry = num(attrs.ry)
        return rx > 0 && ry > 0 ? [{ points: ellipsePoints(num(attrs.cx), num(attrs.cy), rx, ry), closed: true }] : []
      }
      case 'line':
        return [{ points: [[num(attrs.x1), num(attrs.y1)], [num(attrs.x2), num(attrs.y2)]], closed: false }]
      case 'rect': {
        const w = num(attrs.width)
        const h = num(attrs.height)
        if (w <= 0 || h <= 0) return []
        // SVG：只给 rx 或 ry 之一时另一个取同值。
        const rx = attrs.rx !== undefined ? num(attrs.rx) : num(attrs.ry)
        const ry = attrs.ry !== undefined ? num(attrs.ry) : rx
        return [{ points: rectPoints(num(attrs.x), num(attrs.y), w, h, rx, ry), closed: true }]
      }
      case 'polyline':
      case 'polygon': {
        const points = pointList(attrs.points)
        if (tag === 'polygon' && points.length > 2) points.push(points[0])
        return points.length > 1 ? [{ points, closed: tag === 'polygon' }] : []
      }
      default:
        return []
    }
  }

  /** 图标节点（lucide 的 IconNode：[tag, attrs, children?][]）→ 折线，坐标在 24×24 viewBox 里；带子节点的（g）递归展开。 */
  const iconNodeToPolylines = (node) => (
    node.flatMap(entry => {
      const [tag, attrs, children] = entry
      return [
        ...nodeToPolylines(tag, attrs),
        ...(Array.isArray(children) ? iconNodeToPolylines(children) : [])
      ]
    })
  )

  // 内嵌 lucide 图标节点表（替代 lucide-react 的 resolveLucideIcon）：14 枚常用图标的 [tag, attrs] 数据，
  // 24×24 viewBox，与 lucide 官方 SVG 完全一致；attrs 里的 d 原样保留，弧与贝塞尔交给上面的展平逻辑。
  const LUCIDE_ICON_NODES = {
    flower: [
      ['circle', { cx: 12, cy: 12, r: 3 }],
      ['path', { d: 'M12 16.5A4.5 4.5 0 1 1 7.5 12 4.5 4.5 0 1 1 12 7.5a4.5 4.5 0 1 1 4.5 4.5 4.5 4.5 0 1 1-4.5 4.5' }],
      ['path', { d: 'M12 7.5V9' }],
      ['path', { d: 'M7.5 12H9' }],
      ['path', { d: 'M16.5 12H15' }],
      ['path', { d: 'M12 16.5V15' }]
    ],
    heart: [
      ['path', { d: 'M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z' }]
    ],
    star: [
      ['polygon', { points: '12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2' }]
    ],
    moon: [
      ['path', { d: 'M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z' }]
    ],
    sun: [
      ['circle', { cx: 12, cy: 12, r: 4 }],
      ['path', { d: 'M12 2v2' }],
      ['path', { d: 'M12 20v2' }],
      ['path', { d: 'm4.93 4.93 1.41 1.41' }],
      ['path', { d: 'm17.66 17.66 1.41 1.41' }],
      ['path', { d: 'M2 12h2' }],
      ['path', { d: 'M20 12h2' }],
      ['path', { d: 'm6.34 17.66-1.41 1.41' }],
      ['path', { d: 'm19.07 4.93-1.41 1.41' }]
    ],
    music: [
      ['path', { d: 'M9 18V5l12-2v13' }],
      ['circle', { cx: 6, cy: 18, r: 3 }],
      ['circle', { cx: 18, cy: 16, r: 3 }]
    ],
    sparkles: [
      ['path', { d: 'M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z' }],
      ['path', { d: 'M20 3v4' }],
      ['path', { d: 'M22 5h-4' }],
      ['path', { d: 'M4 17v2' }],
      ['path', { d: 'M5 18H3' }]
    ],
    leaf: [
      ['path', { d: 'M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z' }],
      ['path', { d: 'M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12' }]
    ],
    snowflake: [
      ['line', { x1: 2, y1: 12, x2: 22, y2: 12 }],
      ['line', { x1: 12, y1: 2, x2: 12, y2: 22 }],
      ['path', { d: 'm20 16-4-4 4-4' }],
      ['path', { d: 'm4 8 4 4-4 4' }],
      ['path', { d: 'm16 4-4 4-4-4' }],
      ['path', { d: 'm8 20 4-4 4 4' }]
    ],
    flame: [
      ['path', { d: 'M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z' }]
    ],
    zap: [
      ['polygon', { points: '13 2 3 14 12 14 11 22 21 10 12 10 13 2' }]
    ],
    ghost: [
      ['path', { d: 'M9 10h.01' }],
      ['path', { d: 'M15 10h.01' }],
      ['path', { d: 'M12 2a8 8 0 0 0-8 8v12l3-3 2.5 2.5L12 19l2.5 2.5L17 19l3 3V10a8 8 0 0 0-8-8z' }]
    ],
    cloud: [
      ['path', { d: 'M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z' }]
    ],
    bird: [
      ['path', { d: 'M16 7h.01' }],
      ['path', { d: 'M3.4 18H12a8 8 0 0 0 8-8V7a4 4 0 0 0-7.28-2.3L2 20' }],
      ['path', { d: 'm20 7 2 .5-2 .5' }],
      ['path', { d: 'M10 18v3' }],
      ['path', { d: 'M14 17.75V21' }],
      ['path', { d: 'M7 18a6 6 0 0 0 3.84-10.61' }]
    ]
  }

  // 原 lucideIconResolver 的名字表：小写名 → 表里的 PascalCase 键，首次使用时构建。
  let lucideIconNamesByLowercase = null
  const iconNamesByLowercase = () => {
    lucideIconNamesByLowercase ??= new Map(Object.keys(LUCIDE_ICON_NODES).map(name => [name.toLowerCase(), name]))
    return lucideIconNamesByLowercase
  }

  /**
   * 解析主题的 lyricsIcons 列表为规范的 lucide 名：大小写不敏感、去重、未知名字丢弃。
   * 无回退——想要默认图标的调用方自己加。
   */
  const resolveLucideIconNames = (names) => [...new Set((names ?? [])
    .map(name => (typeof name === 'string' ? iconNamesByLowercase().get(name.toLowerCase()) : undefined))
    .filter(Boolean))]

  const cache = new Map()

  /** 按图标名（lucide 的 PascalCase 导出名）取折线；未知图标返回 null。结果按名字缓存。 */
  const lucideIconPolylines = (name) => {
    if (cache.has(name)) return cache.get(name)
    const node = Object.prototype.hasOwnProperty.call(LUCIDE_ICON_NODES, name) ? LUCIDE_ICON_NODES[name] : null
    const polylines = node ? iconNodeToPolylines(node).filter(polyline => polyline.points.length > 1) : null
    const value = polylines && polylines.length > 0 ? polylines : null
    cache.set(name, value)
    return value
  }

  // =============================================================================================
  // themeIcons.ts —— 主题图标线稿
  // 主题图标线稿：theme.lyricsIcons（已解析成 lucide 名）按种子散落在构图的空处——避开文字区、画面边缘和
  // 彼此——每枚按图标自己的折线描出来，和量角器光环、叶片同一种金色细线，节点上有闪点。
  // 一个镜头一组（场景按镜头交叉渐变）；没有可用图标时返回空的线稿。坐标一律高度单位。

  /** 图标边长范围、与文字区 / 彼此之间留的空、离画面边缘的距离（高度单位）。 */
  const ICON_SIZE = [0.085, 0.13]
  // 原为 0.05 + LUMIERE_NEUTRAL_OFFSET（恒等于 0 的混淆常量），内联为 0.05。
  const TEXT_PAD = 0.05
  const EDGE = 0.05
  const ATTEMPTS = 48

  const overlapsRegion = (cx, cy, half, region, pad) => (
    Math.abs(cx - region.cx) < half + region.w / 2 + pad
    && Math.abs(cy - region.cy) < half + region.h / 2 + pad
  )

  /**
   * 按种子给图标找落点：在画面内（留边）随机取位置，拒绝与文字区（外扩 TEXT_PAD）或已放下的图标重叠的候选。
   * 找不到空处的图标就不放（文字区占满画面时可能一枚都没有）。
   */
  const placeThemeIcons = (options) => {
    const names = options.names.filter(name => lucideIconPolylines(name) !== null)
    if (names.length === 0) return []
    const { aspect, avoid, random } = options
    const count = options.count ?? 2 + (random() < 0.5 ? 1 : 0)
    const offset = options.offset ?? 0
    const placed = []
    for (let i = 0; i < count; i += 1) {
      const name = names[(offset + i) % names.length]
      const size = ICON_SIZE[0] + random() * (ICON_SIZE[1] - ICON_SIZE[0])
      const rotation = (random() - 0.5) * 0.3
      const half = size * 0.72 // 转动后的外接半径（留一点余量）
      for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
        const cx = EDGE + half + random() * Math.max(0, aspect - 2 * (EDGE + half))
        const cy = EDGE + half + random() * Math.max(0, 1 - 2 * (EDGE + half))
        if (overlapsRegion(cx, cy, half, avoid, TEXT_PAD)) continue
        if (placed.some(other => Math.hypot(other.cx - cx, other.cy - cy) < (other.size + size) * 0.9)) continue
        placed.push({ name, cx, cy, size, rotation })
        break
      }
    }
    return placed
  }

  /** 图标折线（viewBox 坐标）→ 画面折线：以图标中心为原点缩放、转动、平移。 */
  const transformPolyline = (polyline, icon) => {
    const scale = icon.size / ICON_VIEWBOX
    const cos = Math.cos(icon.rotation)
    const sin = Math.sin(icon.rotation)
    const half = ICON_VIEWBOX / 2
    return polyline.points.map(([x, y]) => {
      const lx = (x - half) * scale
      const ly = (y - half) * scale
      return [icon.cx + lx * cos - ly * sin, icon.cy + lx * sin + ly * cos]
    })
  }

  const polylineLength = (points) => {
    let length = 0
    for (let i = 1; i < points.length; i += 1) length += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1])
    return length
  }

  /**
   * 摆好的图标 → 线稿：每枚依次开始描（错开 0.12），图标内的笔画再各错开一点；最长那一笔的起点与
   * 另一个按种子挑的端点上各有一个闪点，笔画描到时出现。
   */
  const themeIconsArt = (icons, random, delay = 0.18, alpha = 0.5) => {
    const paths = []
    const nodes = []
    icons.forEach((icon, iconIndex) => {
      const polylines = lucideIconPolylines(icon.name)
      if (!polylines) return
      const start = delay + iconIndex * 0.12
      const strokes = polylines.map(polyline => transformPolyline(polyline, icon))
      strokes.forEach((points, strokeIndex) => {
        paths.push({
          points,
          width: 0.0013,
          alpha,
          delay: start + Math.min(strokeIndex, 8) * 0.035,
          span: 0.32
        })
      })
      const longest = strokes.reduce((best, points, index) => (polylineLength(points) > polylineLength(strokes[best]) ? index : best), 0)
      nodes.push({ at: strokes[longest][0], size: 0.02, delay: start + 0.08, twinklePhase: random() * Math.PI * 2 })
      const other = strokes[Math.floor(random() * strokes.length)]
      if (strokes.length > 1) {
        nodes.push({ at: other[other.length - 1], size: 0.015, delay: start + 0.3, twinklePhase: random() * Math.PI * 2 })
      }
    })
    return { paths, nodes }
  }

  /** 一个镜头的主题图标线稿：找落点 + 画成线稿。没有可用图标时是空的。 */
  const buildThemeIconArt = (options) => {
    const icons = placeThemeIcons(options)
    return themeIconsArt(icons, options.random, options.delay, options.alpha)
  }

  /**
   * 场景单元里每个镜头的主题图标线稿（与镜头一一对应）。开关关掉、主题没有图标或图标名都无效时返回空数组——
   * 不退回默认图标。每个镜头按 `${seed}:${镜头序号}:${光位}:icons` 播种，并轮到不同的图标。
   */
  const buildShotIconArts = (options) => {
    if (!options.enabled) return []
    const names = resolveLucideIconNames(options.icons).filter(name => lucideIconPolylines(name) !== null)
    if (names.length === 0) return []
    return options.shotKinds.map((kind, index) => buildThemeIconArt({
      names,
      aspect: options.aspect,
      avoid: options.avoid,
      random: window.FoliaLumiereCore.createRng(`${options.seed}:${index}:${kind}:icons`),
      offset: index * 2
    }))
  }

  // 统一挂载：属性名与源导出名完全一致。
  window.FoliaLumiereLineart = {
    LINE_ART_UNLOAD_AFTER: LINE_ART_UNLOAD_AFTER,
    LINE_ART_UNLOAD_LEAD: LINE_ART_UNLOAD_LEAD,
    shouldUnloadLineArt: shouldUnloadLineArt,
    createLineArt: createLineArt,
    ICON_VIEWBOX: ICON_VIEWBOX,
    svgPathToPolylines: svgPathToPolylines,
    iconNodeToPolylines: iconNodeToPolylines,
    lucideIconPolylines: lucideIconPolylines,
    placeThemeIcons: placeThemeIcons,
    themeIconsArt: themeIconsArt,
    buildThemeIconArt: buildThemeIconArt,
    buildShotIconArts: buildShotIconArts
  }

  // 兼容别名：lumiere-credits.js 从本对象取 recipes.ts 的这四个函数（它们按全局命名表归
  // window.FoliaLumiereDiagrams，见 lumiere-diagrams.js）。用 getter 在运行时转发，与加载顺序无关。
  for (const alias of ['mergeSpecs', 'protractorHalo', 'scatteredSparks', 'viewfinderFrame']) {
    Object.defineProperty(window.FoliaLumiereLineart, alias, {
      enumerable: true,
      configurable: true,
      get: () => (window.FoliaLumiereDiagrams ? window.FoliaLumiereDiagrams[alias] : undefined)
    })
  }
})()
