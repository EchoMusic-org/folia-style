// 町景景深参数（移植自 engine/lens.ts）：设置里的光圈、强度、清晰范围、移轴，
// 和此刻相对默认构图的缩放 → 镜头 pass（fx 层）要的对焦带宽度与离焦圆大小（纯函数）。
(function () {
  'use strict'

  /** f/8、强度 1 时离焦最多处的离焦圆半径（画面高度的比例）：原来的微缩感。 */
  var MACHI_BASE_COC = 0.012
  /** 光圈按这一档换算：f/8 是原来的样子。 */
  var MACHI_REFERENCE_APERTURE = 8

  /**
   * 清晰的那一层（米，半宽与过渡）按清晰范围放宽、随拉近变浅；光圈每大一档（f 值除以 √2），
   * 清晰层薄到 1/√2、离焦圆大到 √2 倍。从清晰到最虚的过渡只按光圈的平方根收窄。
   * 移轴的离焦圆只跟强度走，不随光圈变。
   */
  function resolveMachiLens(tuning, zoom) {
    var open = MACHI_REFERENCE_APERTURE / tuning.aperture
    var depth = tuning.dofRange / Math.max(0.001, zoom)
    return {
      focusBand: (3.4 * depth) / open,
      focusFalloff: (7.5 * depth) / Math.sqrt(open),
      coc: MACHI_BASE_COC * tuning.dof * open,
      tilt: MACHI_BASE_COC * Math.max(1, tuning.dof) * tuning.tiltShift
    }
  }

  window.FoliaMachiLens = { resolveMachiLens: resolveMachiLens, MACHI_BASE_COC: MACHI_BASE_COC, MACHI_REFERENCE_APERTURE: MACHI_REFERENCE_APERTURE }
})()
