// 雾笺（nebbia）擦痕遮罩的线段收集器：移植自 folia-major src/components/visualizer/nebbia/nebbiaSegments.ts
// 用法照 2D 画布（setTransform、moveTo / lineTo、stroke），但不光栅化，
// 只把每段折线变换到遮罩像素后记成「两端点 + 线宽 + 亮度」，每帧由 nebbia-gl.js 的 NebbiaMaskGl 一次实例化画完。
// 圆头、圆角的折线描边正好是各段圆头线段的并集，所以按段拆开、在 GPU 上取最大值，和画布上 lighten 叠出来的一样
// （只有几笔交叠处的抗锯齿边缘有一两级的差别）。
// 类改成构造函数 + 原型方法；导出挂 window.FoliaNebbiaSegments（SEGMENT_FLOATS 与 nebbia-gl.js 里写死的值一致）。
(function () {
  'use strict'

  /** 每段 6 个数：x0, y0, x1, y1, 线宽（遮罩像素）, 亮度 0..1。 */
  var SEGMENT_FLOATS = 6

  /** 点 (x, y) 到第 p 段（segs[p..p+3] 是两头；雪窗、凝露和歌词的水联动时用）的距离。 */
  function segDist(x, y, segs, p) {
    var ax = segs[p], ay = segs[p + 1], dx = segs[p + 2] - ax, dy = segs[p + 3] - ay, l2 = dx * dx + dy * dy
    var u = l2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2)) : 0
    return Math.hypot(x - ax - dx * u, y - ay - dy * u)
  }

  function NebbiaSegments() {
    this.data = new Float32Array(SEGMENT_FLOATS * 4096)
    /** 这一帧收了几段。 */
    this.count = 0
    this.a = 1; this.b = 0; this.c = 0; this.d = 1; this.e = 0; this.f = 0
    /** 当前变换的缩放（矩阵都是旋转 × 等比缩放）。 */
    this.k = 1
    /** 当前路径的点（已变换），一个子路径一段，NaN 分开。 */
    this.path = []
  }

  /** 每帧开头清空。 */
  NebbiaSegments.prototype.clear = function () {
    this.count = 0
    this.path.length = 0
  }

  NebbiaSegments.prototype.setTransform = function (a, b, c, d, e, f) {
    this.a = a; this.b = b; this.c = c; this.d = d; this.e = e; this.f = f
    this.k = Math.hypot(a, b)
  }

  NebbiaSegments.prototype.moveTo = function (x, y) {
    if (this.path.length) this.path.push(NaN, NaN)
    this.lineTo(x, y)
  }

  NebbiaSegments.prototype.lineTo = function (x, y) {
    this.path.push(this.a * x + this.c * y + this.e, this.b * x + this.d * y + this.f)
  }

  /** 描当前路径（宽度在当前变换下），再清掉路径。只有一个点的子路径不画（和画布一样）。 */
  NebbiaSegments.prototype.stroke = function (width, v) {
    var p = this.path, w = width * this.k
    for (var i = 2; i < p.length; i += 2) {
      if (Number.isNaN(p[i]) || Number.isNaN(p[i - 2])) continue
      this.push(p[i - 2], p[i - 1], p[i], p[i + 1], w, v)
    }
    p.length = 0
  }

  NebbiaSegments.prototype.push = function (x0, y0, x1, y1, w, v) {
    if ((this.count + 1) * SEGMENT_FLOATS > this.data.length) {
      var grown = new Float32Array(this.data.length * 2)
      grown.set(this.data)
      this.data = grown
    }
    var o = this.count * SEGMENT_FLOATS, dt = this.data
    dt[o] = x0; dt[o + 1] = y0; dt[o + 2] = x1; dt[o + 3] = y1; dt[o + 4] = w; dt[o + 5] = v
    this.count += 1
  }

  window.FoliaNebbiaSegments = {
    SEGMENT_FLOATS: SEGMENT_FLOATS,
    segDist: segDist,
    NebbiaSegments: NebbiaSegments
  }
})()
