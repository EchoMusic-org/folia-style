// 雾笺（nebbia）WebGL2 层：移植自 folia-major src/components/visualizer/nebbia/
//   nebbiaGlUtils.ts（编译/提交/链接检查/建纹理）
//   nebbiaMaskGl.ts（擦痕遮罩的 GPU 绘制：遮罩着色器 + 实例化画线段）
//   nebbiaSnowGl.ts 的 GL 绘制部分（雪花着色器 + 图集上传 + draw；雪的实例打包在后续批次 nebbia-snow.js，以参数传入）
//   nebbiaFireflyGl.ts 的 GL 绘制部分（萤虫着色器 + draw；实例打包在后续批次，以参数传入）
//   nebbiaFogGl.ts（雾的预渲染）、nebbiaNoiseTex.ts（静态噪声纹理）、nebbiaBuildingCache.ts（楼群环形缓存）
//   nebbiaPrograms.ts（8 个程序后台编译，KHR_parallel_shader_compile 轮询、canRenderFogToFloat）
//   nebbiaGl.ts（主控 NebbiaGl 类：webgl2 上下文、采样单元分配、render 管线全套、setFlakeAtlas、mistTint）
// 着色器源码按 window.FoliaNebbiaGlsl 引用（nebbia-glsl.js），常量按 window.FoliaNebbiaCore 引用（nebbia-core.js）。
// 原生 WebGL2，不用 twgl/three；TS 的 interface（Tex / NebbiaUniforms / NebbiaAquaUniforms / NebbiaBuildingState 等）
// 没有运行时形态，保留为段首注释；类改成构造函数 + 原型方法，导出形状与上游一致（挂 window.FoliaNebbiaGl）。
//
// 插件差异（相对上游）：
//   水珠精灵贴图 import './nebbiaRaindrop.png' → 插件 folia/assets/nebbia-raindrop.png 的相对 URL（与群唱表情同款加载方式），
//   上游 nebbiaSnowGl.ts 的 FLAKE_FILL/FLAKE_STAGES（nebbiaSnowFlakes.ts）与 nebbiaFireflyGl.ts 的 FIREFLY_FLOATS/fireflyParams.halo
//   （nebbiaFireflies.ts）还没随 snow/fireflies 批次移植进来，着色器插值和步长要用，先按上游值在本文件写死（导出给后续批次对齐）；
//   擦痕遮罩的线段收集器（nebbiaSegments.ts）也在后续批次，draw 收上游同形状的 { data, count } 参数。
(function () {
  'use strict'

  var GLSL = window.FoliaNebbiaGlsl
  var Core = window.FoliaNebbiaCore

  /** 上游 nebbiaGl.ts 经打包器 import 的水珠精灵（raindrop-fx 1.0.8，MIT，见 folia/assets/nebbia-raindrop.LICENSE.txt）。 */
  var RAINDROP_SPRITE_URL = 'assets/nebbia-raindrop.png'

  // ---------- GL 小工具（原版 nebbiaGlUtils.ts） ----------
  // Tex：{ t: WebGLTexture, unit: number, fb?: WebGLFramebuffer }——纹理、挂的采样单元，画进自己时另挂帧缓冲。
  //
  // NebbiaUniforms：主着色器每帧的 uniform（nebbiaFrameUniforms.ts 每帧算好，后续批次传入 render）：
  //   time, mist, edge, refract, bus, glint, neon（数值）
  //   glassShift [x, y]、sceneShift [x, y]（玻璃、窗外的颠簸位移，uv 比例）
  //   spotSrc [x, y]、spotSrc2 [x, y]、spotTgt [x, y]、spotR、spotI（两盏聚光灯）
  //   scenery（窗外画哪几样，位和着色器的 SCN_* 对应）
  //   dewGlint（凝露玻璃的冷凝水珠高光；雨窗的程序里没有这个 uniform）
  //   aqua（窗外是水族箱时的水母和气泡 uniform，街景时 null）
  //
  // NebbiaAquaUniforms：
  //   jelly（Float32Array，每只 4 个数：x、y（scene 坐标）、伞盖半径、收缩；长度是着色器数组的 24 只）
  //   jellyColor（Float32Array，每只 4 个数：颜色 rgb、触手波的相位）
  //   count（几只水母）、bubbles（气泡多少）
  //   sway（Float32Array，水草跟拍的弹簧：现在、0.05、0.1、0.15 秒前的横向偏移）
  //   weedIdle（水草自己摆动的幅度 0..1：跟拍时落到 0）
  //   bursts（Float32Array，跟拍冒的大泡每排 4 个数：x、冒出的时刻、大小 0..1、种子；长度是 NEBBIA_MAX_BURSTS 排）
  //   burstCount（几排）、beatRows（1 时不冒随机的大泡）、spotScale（聚光灯光斑半径乘多少）

  /** 提交编译，不等结果（结果在链接时一起查，见 checkLinked）。 */
  function compileShader(gl, type, src) {
    var s = gl.createShader(type)
    gl.shaderSource(s, src)
    gl.compileShader(s)
    return s
  }

  /** 提交链接，不等结果：属性位置先绑死，VAO 不必等程序编好就能建。 */
  function startProgram(gl, vs, fs, attribs) {
    var p = gl.createProgram()
    gl.attachShader(p, vs)
    gl.attachShader(p, fs)
    var names = Object.keys(attribs)
    for (var i = 0; i < names.length; i++) gl.bindAttribLocation(p, attribs[names[i]], names[i])
    gl.linkProgram(p)
    return p
  }

  /** 链接结果：失败时把着色器的报错一起抛出。查 LINK_STATUS 会等到编完，所以先确认编好了再调。 */
  function checkLinked(gl, p) {
    if (gl.getProgramParameter(p, gl.LINK_STATUS)) return
    var logs = (gl.getAttachedShaders(p) || [])
      .map(function (s) { return gl.getShaderInfoLog(s) })
      .filter(Boolean)
      .join('\n')
    throw new Error('Nebbia program: ' + gl.getProgramInfoLog(p) + (logs ? '\n' + logs : ''))
  }

  /** 一张线性过滤、边缘夹紧的纹理，挂在采样单元 `unit` 上（程序编好后再把采样器指过来）。 */
  function makeTex(gl, unit) {
    var t = gl.createTexture()
    gl.activeTexture(gl.TEXTURE0 + unit)
    gl.bindTexture(gl.TEXTURE_2D, t)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    return { t: t, unit: unit }
  }

  // ---------- 擦痕遮罩（原版 nebbiaMaskGl.ts） ----------
  // 擦痕遮罩在 GPU 上画：线段收集器（上游 nebbiaSegments.ts，后续批次移植）收好的线段一次实例化画进一张 R8 纹理
  // （半分辨率，亮 = 擦开），混合取最大值，代替原来 2D 画布上每段三次 stroke 加 lighten（Windows 的 D3D11 上每次
  // 都要拷一份目标像素，很贵）和每帧把画布上传成纹理。一段的三层由宽到窄、由暗到亮（原 strokePath 的
  // [1.3, 0.38] [1.0, 0.72] [0.62, 1]）在片元里一起算。程序和别的雾笺程序一起在后台编译，编好后 attach 进来。

  /** 每段 6 个数：x0, y0, x1, y1, 线宽（遮罩像素）, 亮度 0..1（上游 nebbiaSegments.ts 的 SEGMENT_FLOATS，后续批次保持一致）。 */
  var SEGMENT_FLOATS = 6

  var NEBBIA_MASK_VS = `#version 300 es
in vec2 aCorner; in vec4 aSeg; in vec2 aParam;
uniform vec2 uView;
out vec2 vP; flat out vec4 vSeg; flat out vec2 vParam;
void main() {
  vec2 a = aSeg.xy, b = aSeg.zw, d = b - a;
  float l = length(d);
  vec2 t = l > 1e-5 ? d / l : vec2(1.0, 0.0), n = vec2(-t.y, t.x);
  // 最宽那层的半宽再留 1 像素抗锯齿
  float R = aParam.x * 0.65 + 1.0;
  vec2 p = (a + b) * 0.5 + t * aCorner.x * (l * 0.5 + R) + n * aCorner.y * R;
  vP = p; vSeg = aSeg; vParam = aParam;
  gl_Position = vec4(p / uView * 2.0 - 1.0, 0.0, 1.0);
}`

  var NEBBIA_MASK_FS = `#version 300 es
precision highp float;
in vec2 vP; flat in vec4 vSeg; flat in vec2 vParam;
out vec4 o;
// 半宽 r 的线离像素中心 d 时的覆盖度（1 像素线性过渡，接近画布的抗锯齿）
float cover(float r, float d) { return clamp(r + 0.5 - d, 0.0, 1.0); }
// 画布的颜色是 8 位：先量化再乘覆盖度
float level(float x) { return floor(x * 255.0 + 0.5) / 255.0; }
void main() {
  vec2 a = vSeg.xy, ba = vSeg.zw - a, pa = vP - a;
  float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-6), 0.0, 1.0);
  float d = length(pa - ba * h), w = vParam.x * 0.5, v = vParam.y;
  // 三层按画布的 lighten 一层层叠：每层都比下面亮，覆盖度 a 的像素是 m + a × (这层 − m)
  float m = level(v * 0.38) * cover(w * 1.3, d);
  m += cover(w, d) * (level(v * 0.72) - m);
  m += cover(w * 0.62, d) * (level(v) - m);
  o = vec4(m, 0.0, 0.0, 1.0);
}`

  /** constructor(gl, unit)：纹理挂在采样单元 `unit` 上（主程序的 uMask 编好后指过来）。 */
  function NebbiaMaskGl(gl, unit) {
    this.gl = gl
    this.prog = null
    this.uView = null
    this.w = 1
    this.h = 1
    this.tex = makeTex(gl, unit)
    this.fb = gl.createFramebuffer()
    this.vao = gl.createVertexArray()
    gl.bindVertexArray(this.vao)
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer())
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
    this.buf = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf)
    var stride = SEGMENT_FLOATS * 4
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 4, gl.FLOAT, false, stride, 0); gl.vertexAttribDivisor(1, 1)
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 2, gl.FLOAT, false, stride, 16); gl.vertexAttribDivisor(2, 1)
    gl.bindVertexArray(null)
  }

  /** 编好的遮罩程序（后台编译的 `mask`）。 */
  NebbiaMaskGl.prototype.attach = function (prog) {
    this.prog = prog
    this.uView = this.gl.getUniformLocation(prog, 'uView')
  }

  /** W、H 是 CSS 像素，遮罩按 MASK_SCALE 缩（和原来的遮罩画布一样大）。 */
  NebbiaMaskGl.prototype.resize = function (W, H) {
    var gl = this.gl
    this.w = Math.max(1, Math.round(W * Core.MASK_SCALE))
    this.h = Math.max(1, Math.round(H * Core.MASK_SCALE))
    gl.activeTexture(gl.TEXTURE0 + this.tex.unit)
    gl.bindTexture(gl.TEXTURE_2D, this.tex.t)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, this.w, this.h, 0, gl.RED, gl.UNSIGNED_BYTE, null)
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fb)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.tex.t, 0)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
  }

  /** 清成全雾，再把这一帧的线段画上去。segs 是线段收集器（上游 NebbiaSegments，后续批次传入）：
   *  data 是 Float32Array、count 是这一帧的段数。画完恢复默认的加法混合（水珠那一趟只设混合因子）。 */
  NebbiaMaskGl.prototype.draw = function (segs) {
    var gl = this.gl
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fb)
    gl.viewport(0, 0, this.w, this.h)
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)
    if (segs.count && this.prog) {
      gl.useProgram(this.prog)
      gl.bindVertexArray(this.vao)
      gl.bindBuffer(gl.ARRAY_BUFFER, this.buf)
      gl.bufferData(gl.ARRAY_BUFFER, segs.data.subarray(0, segs.count * SEGMENT_FLOATS), gl.DYNAMIC_DRAW)
      gl.uniform2f(this.uView, this.w, this.h)
      gl.enable(gl.BLEND)
      gl.blendEquation(gl.MAX)
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, segs.count)
      gl.blendEquation(gl.FUNC_ADD)
      gl.disable(gl.BLEND)
      gl.bindVertexArray(null)
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
  }

  // ---------- 雪窗的雪花：GL 绘制（原版 nebbiaSnowGl.ts） ----------
  // 雪花在 WebGL 里画（NebbiaGl 在主画面之后调 drawFlakes）：全部阶段贴图拼成一张图集（上游 nebbiaSnowFlakes.ts，
  // 后续批次），每片雪一个实例，预乘透明度叠上去。雪被身后窗外的光照着：取主画面已经预渲染好的那层大范围糊的窗外
  // （雾的光晕层，uFogGlow），暖橙的灯下泛一点暖黄、蓝的地方带一点冷蓝、暗的地方暗下去；逆光时像冰一样被照透，
  // 透过它看到身后折过来的窗外，冰棱和身后的光成固定角度时闪出色散的火彩（NEBBIA_FIRE_GLSL，nebbia-glsl.js）；
  // 靠近亮光的雪外面再散一圈很淡、不大的柔光。透明、或不能预渲染雾时没有这层，雪按中等亮度、不上色画。
  // 雪跟玻璃一起颠（和水珠纹理一样按 glassShift 挪）。

  /** 一片雪的实例：x、y、半径（CSS 像素）、转角；融化阶段（0..FLAKE_STAGES-1）、图集里第几行、透明度、清楚的程度
   *  （1 = 贴上了、对上焦；飘过来时、窗外的雪小于 1，越小越糊）；横、竖压扁。（打包在后续批次的雪模块。） */
  var FLAKE_FLOATS = 10
  /** 雪的融化阶段数、贴图占格子的比例（上游 nebbiaSnowFlakes.ts 的 FLAKE_STAGES / FLAKE_FILL，后续批次保持一致）。 */
  var FLAKE_STAGES = 16
  var FLAKE_FILL = 0.84
  /** 火彩把贴图分成几乘几格（每格一块冰面，各有自己的折射角）。 */
  var GLINT_GRID = '9.0'
  /** 实例方块的半边长是雪花半径的几倍（要盖住整张贴图和飘过来时的糊光）。 */
  var EXT = 2.6

  var NEBBIA_FLAKE_VS = `#version 300 es
in vec2 aCorner; in vec4 aA; in vec4 aB; in vec2 aC;
uniform vec2 uView, uShift;
out vec2 vLocal; out vec2 vHalo; out vec2 vFu; flat out vec4 vB; flat out float vR; flat out float vSeed;
void main() {
  vec2 c = (aCorner * 2.0 - 1.0) * ${EXT.toFixed(2)};
  float cs = cos(aA.w), sn = sin(aA.w);
  vec2 off = c * aA.z;
  vec2 p = aA.xy + vec2(off.x * cs - off.y * sn, off.x * sn + off.y * cs) + uShift;
  // vLocal：贴图里的坐标（单位是雪花半径，压扁之前）；vHalo：糊光、柔光用的（不压扁）
  vLocal = c / aC; vHalo = c; vB = aB; vR = aA.z;
  // 每片雪自己的随机数（闪光用）：贴上以后转角、种类都不再变
  vSeed = fract(sin(aA.w * 12.9898 + aB.y * 78.233) * 43758.5453);
  // 雾的预渲染纹理第 0 行是屏幕底部
  vFu = vec2(p.x / uView.x, 1.0 - p.y / uView.y);
  gl_Position = vec4(p.x / uView.x * 2.0 - 1.0, 1.0 - p.y / uView.y * 2.0, 0.0, 1.0);
}`

  var NEBBIA_FLAKE_FS = `#version 300 es
precision mediump float;
uniform sampler2D uAtlas, uGlow, uBehind;
uniform bool uLit; uniform vec2 uGrid; uniform highp vec2 uView;
in vec2 vLocal; in vec2 vHalo; in vec2 vFu; flat in vec4 vB; flat in float vR; flat in float vSeed;
out vec4 o;
${GLSL.NEBBIA_FIRE_GLSL}
vec4 tile(float col, vec2 t, float bias) { return texture(uAtlas, (vec2(col, vB.y) + t) / uGrid, bias); }
void main() {
  float p = vB.w;
  vec2 t = 0.5 + vLocal * ${(FLAKE_FILL / 2).toFixed(3)};
  // 相邻两个融化阶段交叉；还没飘到焦点上的取更糊的一级。不放在分支里取（分支里取样的 mipmap 级别不可靠），格子外面乘 0
  float st = floor(vB.x), fr = vB.x - st, bias = 2.0 * (1.0 - p);
  vec2 tc = clamp(t, 0.0, 1.0);
  vec4 c = mix(tile(st, tc, bias), tile(min(st + 1.0, uGrid.x - 1.0), tc, bias), fr);
  c *= vB.z * float(t == tc);
  // 身后的光：颜色带大半（还看得出是白雪），亮度跟着走：暗处压得很暗，灯下亮过雾
  vec3 L = uLit ? texture(uGlow, vFu).rgb : vec3(0.42);
  float lum = dot(L, vec3(0.3, 0.59, 0.11));
  vec3 hue = clamp(mix(vec3(1.0), L / max(lum, 0.02), 0.8), 0.0, 2.2);
  vec3 lit = hue * clamp(0.22 + 2.5 * lum, 0.0, 1.4);
  vec3 rgb = c.rgb * lit;
  // 逆光（身后有亮光）：雪像冰一样被照透。冰晶的厚薄（贴图的不透明度）当成表面的起伏，斜的地方把身后的窗外往里折（取主画面那层稍糊的窗外，uBehind），
  // 透过来的光比四周亮一点；薄的边、斜面上再亮一道。暗处照旧是白雪。只在对上焦（贴上玻璃）后，化得越多越弱（化成水交给水珠去折射）
  float back = float(uLit) * smoothstep(0.08, 0.45, lum) * p * (1.0 - 0.7 * vB.x / ${(FLAKE_STAGES - 1).toFixed(1)});
  float a0 = c.a / max(vB.z, 0.001);
  vec2 n = vec2(dFdx(a0), dFdy(a0)) * vR;
  float edge = clamp(length(n) * 0.5, 0.0, 1.0);
  // 色散（比真冰放大了不少，要看得出）：红、绿、蓝折得不一样多，棱上再沿斜的方向分开一点，透过来的窗外在边上错出彩边、颜色加浓；
  vec2 bend = n * vR * 0.7 / uView, split = n / max(length(n), 0.001) * vR * 0.35 * edge / uView;
  vec3 through = vec3(texture(uBehind, vFu - bend * 0.8 - split).r, texture(uBehind, vFu - bend).g, texture(uBehind, vFu - bend * 1.25 + split).b);
  vec3 gray = vec3(dot(through, vec3(0.3333)));
  through = gray + (through - gray) * (1.0 + 1.5 * edge);
  vec3 ice = (through * (1.1 + 0.3 * edge) + min(L, vec3(1.2)) * edge * 0.3) * c.a + c.rgb * lit * 0.15;
  rgb = mix(rgb, ice, back * 0.85);
  float d = length(vHalo);
  // 还没飘到焦点上：外面套一圈糊的
  float ha = 0.35 * (1.0 - p) * max(0.0, 1.0 - d / (1.6 - 0.6 * p));
  rgb = vec3(0.92, 0.95, 1.0) * lit * ha + rgb * (1.0 - ha);
  float a = ha + c.a * (1.0 - ha);
  // 靠近亮光：外面散一圈很淡的柔光（只加颜色，比雪花大不了多少），化得越多越淡；没有光照（透明）时不加
  float soft = float(uLit) * smoothstep(0.12, 0.6, lum) * 0.45 * exp(-d * d * 2.4) * vB.z * (1.0 - vB.x / ${(FLAKE_STAGES - 1).toFixed(1)});
  // 火彩（色散）：贴图按格子分，每格一块冰面、有自己固定的折射角，只有冰棱上（斜面）的格子会出；颜色由斜面和光的方向定（nebbiaFireGlsl.ts），
  // 只加光，亮度按身后光的亮度给，不跟灯的颜色走；约四成格子有朝得对的冰面
  vec2 g = tc * ${GLINT_GRID}, gc = floor(g), gf = fract(g) - 0.5;
  float h = fract(sin(dot(gc, vec2(12.9898, 78.233)) + vSeed * 91.7) * 43758.5453);
  vec3 fire = fixedFire(uGlow, vFu, n, fract(h * 7.31)) * step(h, 0.4);
  float glint = back * exp(-dot(gf, gf) * 18.0) * edge * (0.6 + 2.0 * lum) * vB.z;
  o = vec4(rgb + min(L, vec3(1.2)) * soft + fire * glint * 2.2, a);
}`

  /** constructor(gl, unit)：图集纹理挂在采样单元 `unit` 上。 */
  function NebbiaSnowGl(gl, unit) {
    this.gl = gl
    this.prog = null
    this.uView = null
    this.uShift = null
    this.uGrid = null
    this.rows = 0
    // 实例缓冲分配了多少个数（只在要放的比这多时重新分配，平时每帧只覆盖内容）。
    this.capacity = 0
    this.atlas = makeTex(gl, unit)
    this.vao = gl.createVertexArray()
    gl.bindVertexArray(this.vao)
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer())
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW)
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
    this.buf = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf)
    var stride = FLAKE_FLOATS * 4
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 4, gl.FLOAT, false, stride, 0); gl.vertexAttribDivisor(1, 1)
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 4, gl.FLOAT, false, stride, 16); gl.vertexAttribDivisor(2, 1)
    gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 2, gl.FLOAT, false, stride, 32); gl.vertexAttribDivisor(3, 1)
    gl.bindVertexArray(null)
  }

  /** 程序编好时调：取 uniform 位置、指好图集、雾的光晕层（glowUnit）和稍糊的窗外（behindUnit，冰折射用）；lit 为假时不取光。 */
  NebbiaSnowGl.prototype.attach = function (prog, glowUnit, behindUnit, lit) {
    var gl = this.gl
    this.prog = prog
    gl.useProgram(prog)
    this.uView = gl.getUniformLocation(prog, 'uView')
    this.uShift = gl.getUniformLocation(prog, 'uShift')
    this.uGrid = gl.getUniformLocation(prog, 'uGrid')
    gl.uniform1i(gl.getUniformLocation(prog, 'uAtlas'), this.atlas.unit)
    gl.uniform1i(gl.getUniformLocation(prog, 'uGlow'), glowUnit)
    gl.uniform1i(gl.getUniformLocation(prog, 'uBehind'), behindUnit)
    gl.uniform1i(gl.getUniformLocation(prog, 'uLit'), lit ? 1 : 0)
  }

  /** 上传图集（每种一行、每个阶段一格），带 mipmap：小雪花、飘过来时的糊都从这里取。 */
  NebbiaSnowGl.prototype.setAtlas = function (canvas, rows) {
    var gl = this.gl
    this.rows = rows
    gl.activeTexture(gl.TEXTURE0 + this.atlas.unit)
    gl.bindTexture(gl.TEXTURE_2D, this.atlas.t)
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas)
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)
    gl.generateMipmap(gl.TEXTURE_2D)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR)
    // 再小格子就和隔壁的阶段混了
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAX_LEVEL, 4)
  }

  /** 叠到当前帧缓冲上：data 里 count 片雪（打包在后续批次，每片 FLAKE_FLOATS 个数），W、H 是 CSS 像素，shift 是玻璃颠簸（CSS 像素）。 */
  NebbiaSnowGl.prototype.draw = function (data, count, W, H, shift) {
    var gl = this.gl
    if (!this.prog || !this.rows || !count) return
    gl.useProgram(this.prog)
    gl.bindVertexArray(this.vao)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf)
    // 按 data 的容量分配一次（它变大了才重新分配），之后每帧只传这一帧用到的那段
    if (data.length > this.capacity) {
      gl.bufferData(gl.ARRAY_BUFFER, data.byteLength, gl.DYNAMIC_DRAW)
      this.capacity = data.length
    }
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, data, 0, count * FLAKE_FLOATS)
    gl.uniform2f(this.uView, W, H)
    gl.uniform2f(this.uShift, shift[0], shift[1])
    gl.uniform2f(this.uGrid, FLAKE_STAGES, this.rows)
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count)
    gl.disable(gl.BLEND)
    gl.bindVertexArray(null)
  }

  // ---------- 凝露玻璃上的萤虫：GL 绘制（原版 nebbiaFireflyGl.ts） ----------
  // 萤虫在 WebGL 里画（NebbiaGl 在主画面之后调 drawFireflies），每只一个实例，预乘透明度叠上去。
  // 虫子按头的朝向画：淡淡的白色身子，两边两片半透明的翅膀，飞的时候翅膀张开快速扇、看着是一团糊影，停在玻璃上收拢；
  // 没对上焦（还在飞远）时整只糊开。尾巴尖上一点自己发的光（主题的灯光色，加色，外面带一小圈光晕），亮多少按上游
  // nebbiaFireflies.ts（后续批次）排的节奏。身子的光照照融雪最早那版雪花：身子不自己发光，颜色、亮度取身后雾的光晕层
  //（uFogGlow），暗处压暗，灯边亮过雾，外面散一圈大的柔光（大小可调）。透明、或不能预渲染雾时没有光晕层，按中等亮度、不上色画。

  /** 每只 12 个数（上游 nebbiaFireflies.ts 的 FIREFLY_FLOATS，后续批次保持一致）：位置 x、y、半径、对焦 p；
   *  亮度、模糊、朝向、扇翅相位；柔光量、尾巴的灯光色 rgb。 */
  var FIREFLY_FLOATS = 12
  /** 萤虫柔光的大小（上游 fireflyParams.halo，后续批次保持一致）。 */
  var FIREFLY_HALO = 2

  var NEBBIA_FIREFLY_VS = `#version 300 es
in vec2 aCorner; in vec4 aA; in vec4 aB; in vec4 aC;
uniform vec2 uView; uniform float uHalo;
out vec2 vLocal; out vec2 vFu; flat out vec4 vP; flat out vec4 vGlow;
void main() {
  // 方块要盖住糊开的虫子和柔光：柔光到方块边上要淡到看不出（低于 1/255），不然灯下看得见方框
  float ext = max(2.6, 4.1 * uHalo);
  vec2 c = (aCorner * 2.0 - 1.0) * ext;
  // 按身子朝向转：vLocal 是虫子自己的坐标（x 朝头，单位是半径）
  float cs = cos(aB.z), sn = sin(aB.z);
  vec2 off = c * aA.z;
  vec2 p = aA.xy + vec2(off.x * cs - off.y * sn, off.x * sn + off.y * cs);
  vLocal = c; vP = vec4(aA.w, aB.x, aB.y, aB.w); vGlow = aC;
  // 雾的预渲染纹理第 0 行是屏幕底部
  vFu = vec2(p.x / uView.x, 1.0 - p.y / uView.y);
  gl_Position = vec4(p.x / uView.x * 2.0 - 1.0, 1.0 - p.y / uView.y * 2.0, 0.0, 1.0);
}`

  var NEBBIA_FIREFLY_FS = `#version 300 es
precision mediump float;
uniform sampler2D uGlow;
// uHalo 两边都用：和顶点着色器的精度要一样
uniform bool uLit; uniform highp float uHalo;
in vec2 vLocal; in vec2 vFu; flat in vec4 vP; flat in vec4 vGlow;
out vec4 o;
// 一个椭圆（中心 c、半轴 ab、转 a 弧度）的覆盖，边缘宽 e
float blob(vec2 q, vec2 c, vec2 ab, float a, float e) {
  q -= c;
  float cs = cos(a), sn = sin(a);
  q = vec2(q.x * cs + q.y * sn, -q.x * sn + q.y * cs) / ab;
  return 1.0 - smoothstep(1.0 - e, 1.0 + e, length(q));
}
void main() {
  float p = vP.y, flap = vP.w;
  vec2 q = vLocal;
  // 没对上焦：边缘糊开
  float e = 0.18 + 0.9 * (1.0 - p);
  // 身子：头、胸、长一点的肚子
  float body = max(max(blob(q, vec2(0.62, 0.0), vec2(0.17, 0.15), 0.0, e),
                       blob(q, vec2(0.3, 0.0), vec2(0.22, 0.2), 0.0, e)),
                   blob(q, vec2(-0.25, 0.0), vec2(0.48, 0.19), 0.0, e));
  // 翅膀：收拢时盖在背上往后，张开时往两边摆；扇得快，看着是一片半透明的糊影
  float wa = 0.12 + 1.2 * flap, we = e + 0.3 * flap;
  float wing = max(blob(q, vec2(-0.15 + 0.2 * flap, 0.08 + 0.45 * flap), vec2(0.62, 0.17), wa, we),
                   blob(q, vec2(-0.15 + 0.2 * flap, -0.08 - 0.45 * flap), vec2(0.62, 0.17), -wa, we));
  // 身后的光：颜色带大半，亮度跟着走：暗处压得很暗，灯下亮过雾
  vec3 L = uLit ? texture(uGlow, vFu).rgb : vec3(0.42);
  float lum = dot(L, vec3(0.3, 0.59, 0.11));
  vec3 hue = clamp(mix(vec3(1.0), L / max(lum, 0.02), 0.8), 0.0, 2.2);
  vec3 lit = hue * clamp(0.22 + 2.5 * lum, 0.0, 1.4);
  // 身子淡淡的白；翅膀更薄、透光，叠在身子上面
  float ab = body * 0.5, aw = wing * (0.3 - 0.1 * flap);
  float ca = (aw + ab * (1.0 - aw)) * vP.x;
  vec3 rgb = (vec3(0.95, 0.97, 1.0) * aw + vec3(0.86, 0.88, 0.92) * ab * (1.0 - aw)) * lit * vP.x;
  float d = length(q);
  // 还没飘到焦点上：外面套一圈糊的
  float ha = 0.35 * (1.0 - p) * max(0.0, 1.0 - d / (1.6 - 0.6 * p)) * vP.x;
  rgb = vec3(0.92, 0.95, 1.0) * lit * ha + rgb * (1.0 - ha);
  float a = ha + ca * (1.0 - ha);
  // 靠近亮光：散一圈很淡的柔光（只加颜色）；没有光照（透明）时不加
  // 身后已经很亮（聚光灯正照着）时柔光收掉大半：再往亮处加光只会叠成一片白
  float soft = float(uLit) * smoothstep(0.12, 0.6, lum) * (1.0 - 0.75 * smoothstep(0.6, 1.2, lum)) * 0.45 * exp(-d * d * 0.3 / (uHalo * uHalo)) * vP.z;
  // 尾巴的光：肚子尖上一小团，外面一小圈光晕，只加颜色（自己发光，不挡后面）；没对上焦时糊大
  float dt = length(q - vec2(-0.55, 0.0)), gr = 0.45 + 0.35 * (1.0 - p);
  float lamp = (1.0 - smoothstep(0.0, gr, dt)) + 0.8 * exp(-dt * dt * 0.7);
  // 中心偏白一点（亮到发白），外圈是灯光色
  vec3 tint = mix(vGlow.yzw, vec3(1.0), 0.35 * (1.0 - smoothstep(0.0, gr, dt)));
  vec3 glow = tint * lamp * vGlow.x * vP.x * mix(0.5, 1.0, p);
  o = vec4(rgb + min(L, vec3(1.2)) * soft + glow, a);
}`

  /** constructor(gl)。 */
  function NebbiaFireflyGl(gl) {
    this.gl = gl
    this.prog = null
    this.uView = null
    this.uHalo = null
    this.vao = gl.createVertexArray()
    gl.bindVertexArray(this.vao)
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer())
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW)
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
    this.buf = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf)
    var stride = FIREFLY_FLOATS * 4
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 4, gl.FLOAT, false, stride, 0); gl.vertexAttribDivisor(1, 1)
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 4, gl.FLOAT, false, stride, 16); gl.vertexAttribDivisor(2, 1)
    gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 4, gl.FLOAT, false, stride, 32); gl.vertexAttribDivisor(3, 1)
    gl.bindVertexArray(null)
  }

  /** 程序编好时调：取 uniform 位置，指好雾的光晕层（glowUnit）；lit 为假时不取光。 */
  NebbiaFireflyGl.prototype.attach = function (prog, glowUnit, lit) {
    var gl = this.gl
    this.prog = prog
    gl.useProgram(prog)
    this.uView = gl.getUniformLocation(prog, 'uView')
    this.uHalo = gl.getUniformLocation(prog, 'uHalo')
    gl.uniform1i(gl.getUniformLocation(prog, 'uGlow'), glowUnit)
    gl.uniform1i(gl.getUniformLocation(prog, 'uLit'), lit ? 1 : 0)
  }

  /** 叠到当前帧缓冲上：data 里 count 只（打包在后续批次，每只 FIREFLY_FLOATS 个数），W、H 是 CSS 像素。 */
  NebbiaFireflyGl.prototype.draw = function (data, count, W, H) {
    var gl = this.gl
    if (!this.prog || !count) return
    gl.useProgram(this.prog)
    gl.bindVertexArray(this.vao)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf)
    gl.bufferData(gl.ARRAY_BUFFER, data.subarray(0, count * FIREFLY_FLOATS), gl.DYNAMIC_DRAW)
    gl.uniform2f(this.uView, W, H)
    gl.uniform1f(this.uHalo, Math.max(0.05, FIREFLY_HALO))
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count)
    gl.disable(gl.BLEND)
    gl.bindVertexArray(null)
  }

  // ---------- 雾的预渲染（原版 nebbiaFogGl.ts） ----------
  // 雾后面两层模糊的窗外各画进一张 RGBA16F，主画面放大采样。模糊半径 0.03 那层 1/4 画布分辨率；
  // 0.09 那层糊得多（2K 屏上约 180 像素），1/8 就够。用雾的预渲染程序（nebbia-glsl.js 的 NEBBIA_FOG_FS）画，一层画一次。
  // 不能渲染到浮点纹理时（`ok` 为假）不分配、不画，主画面自己算雾。
  // 凝露玻璃再多一层清晰的（模糊 0.006，和主画面里水珠折射现算的一样）：细水珠折射时读它，不逐像素重算窗外。

  /** 清晰那层的分辨率（画布的几分之一）：模糊半径 0.006 屏高在 2K 屏上约 11 像素，1/4 的一格只有 4 像素，同一帧放大对比看不出差别。 */
  var SHARP_DIV = 4

  /** constructor(gl, unit, ok, sharpUnit)：两层纹理挂在 `unit`、`unit + 1`；凝露玻璃再加清晰的一层挂在 `sharpUnit`。 */
  function NebbiaFogGl(gl, unit, ok, sharpUnit) {
    if (sharpUnit === undefined) sharpUnit = null
    this.gl = gl
    this.ok = ok
    this.layers = [
      { tex: makeTex(gl, unit), fb: ok ? gl.createFramebuffer() : null, div: Core.FOG_DIV, b: 0.03, w: 1, h: 1 },
      { tex: makeTex(gl, unit + 1), fb: ok ? gl.createFramebuffer() : null, div: Core.FOG_DIV * 2, b: 0.09, w: 1, h: 1 }
    ]
    if (ok && sharpUnit !== null) this.layers.push({ tex: makeTex(gl, sharpUnit), fb: gl.createFramebuffer(), div: SHARP_DIV, b: 0.006, w: 1, h: 1 })
  }

  /** 画布的像素尺寸。帧缓冲能不能拼起来在建上下文时已经试过，这里不再同步查状态。 */
  NebbiaFogGl.prototype.resize = function (canvasW, canvasH) {
    var gl = this.gl
    if (!this.ok) return
    for (var i = 0; i < this.layers.length; i++) {
      var L = this.layers[i]
      L.w = Math.max(1, Math.ceil(canvasW / L.div)); L.h = Math.max(1, Math.ceil(canvasH / L.div))
      gl.activeTexture(gl.TEXTURE0 + L.tex.unit)
      gl.bindTexture(gl.TEXTURE_2D, L.tex.t)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, L.w, L.h, 0, gl.RGBA, gl.HALF_FLOAT, null)
      gl.bindFramebuffer(gl.FRAMEBUFFER, L.fb)
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, L.tex.t, 0)
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
  }

  /**
   * 每帧在主画面之前调：雾的预渲染程序是当前程序、街景 uniform 已设好、全屏四边形已绑好；`uFogB` 是那个程序里模糊半径的位置。
   * 预渲染程序只采样楼群缓存，画进雾纹理不会和采样单元成反馈环。
   */
  NebbiaFogGl.prototype.draw = function (uFogB) {
    var gl = this.gl
    if (!this.ok) return
    for (var i = 0; i < this.layers.length; i++) {
      var L = this.layers[i]
      gl.bindFramebuffer(gl.FRAMEBUFFER, L.fb)
      gl.viewport(0, 0, L.w, L.h)
      gl.uniform1f(uFogB, L.b)
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
  }

  // ---------- 静态噪声纹理（原版 nebbiaNoiseTex.ts） ----------
  // 主画面每个像素都要的三个静态噪声（擦痕边的细噪声、重新起雾的大块噪声、雾上的闪点），只跟像素位置有关，
  // 改尺寸时用自己的小程序（nebbia-glsl.js 的 NEBBIA_NOISE_FS）一次算进一张画布大小的 RGBA8 纹理
  //（R 细、G 大块、B 闪点），之后每帧取一次样代替五次 value noise。颠簸时玻璃有小数像素的偏移，取样是双线性插值，
  // 和现算差一点；8 位存储让擦痕边上偶尔差一两级。画布超过纹理尺寸上限，或还没算好时，主画面照旧现算（uNoiseOn 为假）。

  /** constructor(gl, unit)：纹理挂在采样单元 `unit` 上。 */
  function NebbiaNoiseTex(gl, unit) {
    this.gl = gl
    this.tex = makeTex(gl, unit)
    this.fb = gl.createFramebuffer()
    this.w = 1
    this.h = 1
    this.ok = false
    this.dirty = false
  }

  /** 画布的像素尺寸。 */
  NebbiaNoiseTex.prototype.resize = function (w, h) {
    var gl = this.gl
    var max = gl.getParameter(gl.MAX_TEXTURE_SIZE)
    this.w = w
    this.h = h
    this.ok = w <= max && h <= max
    if (!this.ok) return
    gl.activeTexture(gl.TEXTURE0 + this.tex.unit)
    gl.bindTexture(gl.TEXTURE_2D, this.tex.t)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fb)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.tex.t, 0)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    this.dirty = true
  }

  /**
   * 每帧在主画面之前调（全屏四边形已绑好）：改过尺寸就用 `prog`（NEBBIA_NOISE_FS）重算一次；
   * 返回主画面能不能取纹理（uNoiseOn）。调完当前程序可能是 `prog`。
   */
  NebbiaNoiseTex.prototype.update = function (prog) {
    var gl = this.gl
    if (this.ok && this.dirty) {
      // 画进这张时先从采样单元上卸下，不然算反馈环
      gl.activeTexture(gl.TEXTURE0 + this.tex.unit)
      gl.bindTexture(gl.TEXTURE_2D, null)
      gl.useProgram(prog)
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fb)
      gl.viewport(0, 0, this.w, this.h)
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
      gl.bindFramebuffer(gl.FRAMEBUFFER, null)
      gl.bindTexture(gl.TEXTURE_2D, this.tex.t)
      this.dirty = false
    }
    return this.ok
  }

  // ---------- 楼群缓存（原版 nebbiaBuildingCache.ts） ----------
  // 窗外楼群的缓存：楼群只跟横向位置（随车速平移）和纵向位置有关，不随时间变，所以远近两层 × 三档模糊
  //（主画面清晰的 0.0012，雾的 0.03、0.09）各存一张横向环形的纹理（预乘颜色），车往前开时每帧只补画新露出来的几列，
  // 主画面和雾的预渲染从缓存取，不再每个像素现算楼群。清晰那档存半分辨率（窗格边略软），约 17 MB（2K 屏）。
  // 整张重画（刚开始、改尺寸、换配色、车速突变）一帧最多一张，还没画好的那档着色器照旧现算。
  // 补画用补画程序（nebbia-glsl.js 的 NEBBIA_BLD_FILL_FS）；取样的 uBldOn、uBldGeo 由 NebbiaGl 设到用缓存的程序上。

  var LEVELS = [
    { b: 0.0012, y0: 0.03, y1: 0.63, fog: false },
    { b: 0.03, y0: 0.0, y1: 0.66, fog: true },
    { b: 0.09, y0: -0.06, y1: 0.73, fog: true }
  ]
  /** 远近两层的平移速度，和着色器 building() 里的一样。 */
  var SPEED = [0.02, 0.035]
  /** 清晰那档相对画布的分辨率。 */
  var SHARP_SCALE = 0.5
  /** 屏幕左右各多留的宽度（颠簸会取到屏外一点），和环形缓存比需要的多出的宽度。 */
  var MARGIN = 0.15
  var SLACK = 0.2

  /**
   * 世界横坐标 [a, b) 落在宽 w 像素、周期 span 的环形缓存上的列：起始世界坐标 x0（着色器按它把每列换回世界坐标）
   * 和一到两段 [起始列, 列数]（折回开头时两段）。x0 取在列的边界上，每列中心离 [x0, x0 + span) 两端都有半列，
   * 单精度的 fract 不会把哪一列算到另一个周期去。
   */
  function ringColumns(a, b, span, w) {
    var ca = Math.floor(a / span * w)
    var n = Math.min(w, Math.ceil(b / span * w) - ca)
    var start = ((ca % w) + w) % w
    var first = Math.min(Math.max(n, 0), w - start)
    var runs = n <= 0 ? [] : (n > first ? [[start, first], [0, n - first]] : [[start, n]])
    return { x0: ca * span / w, runs: runs }
  }

  /** 补画程序的 uniform。 */
  var BLD_FILL_UNIFORMS = ['uFillB', 'uFillLayer', 'uFillX0', 'uFillGeo', 'uFillSize']

  // NebbiaBuildingState（用缓存的程序要设的）：on 是每档画好了没有（bvec3 的三个数），geo 是每档 (y0, y1, 横向周期) 的九个数。

  /** constructor(gl, firstUnit)：六张纹理挂在 firstUnit..firstUnit + 5。 */
  function NebbiaBuildingCache(gl, firstUnit) {
    this.gl = gl
    this.caches = []
    this.span = 1
    this.aspect = 1
    var self = this
    LEVELS.forEach(function (_level, level) {
      SPEED.forEach(function (_speed, layer) {
        var tex = makeTex(gl, firstUnit + level * 2 + layer)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT)
        self.caches.push({ tex: tex, fb: gl.createFramebuffer(), level: level, layer: layer, w: 1, h: 1, lo: 0, hi: 0, valid: false })
      })
    })
  }

  /** 用缓存的程序（编好后）：采样器 uBld0..5 指到各自的单元。 */
  NebbiaBuildingCache.prototype.bindSamplers = function (prog) {
    var gl = this.gl
    gl.useProgram(prog)
    this.caches.forEach(function (c, i) {
      gl.uniform1i(gl.getUniformLocation(prog, 'uBld' + i), c.tex.unit)
    })
  }

  /** 配色变了：全部重画。 */
  NebbiaBuildingCache.prototype.invalidate = function () {
    for (var i = 0; i < this.caches.length; i++) this.caches[i].valid = false
  }

  /** 画布、雾的预渲染的像素高度（fogH 是 1/4 分辨率那张的高）。 */
  NebbiaBuildingCache.prototype.resize = function (canvasW, canvasH, fogH) {
    var gl = this.gl
    this.aspect = canvasW / canvasH
    this.span = this.aspect + 2 * MARGIN + SLACK
    var maxSize = gl.getParameter(gl.MAX_TEXTURE_SIZE)
    for (var i = 0; i < this.caches.length; i++) {
      var c = this.caches[i]
      var L = LEVELS[c.level]
      // 每屏高多少像素；太宽的屏按纹理上限收
      var dens = Math.min(L.fog ? fogH : canvasH * SHARP_SCALE, maxSize / this.span)
      c.w = Math.max(1, Math.ceil(this.span * dens))
      c.h = Math.max(1, Math.ceil((L.y1 - L.y0) * dens))
      gl.activeTexture(gl.TEXTURE0 + c.tex.unit)
      gl.bindTexture(gl.TEXTURE_2D, c.tex.t)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, c.w, c.h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
      gl.bindFramebuffer(gl.FRAMEBUFFER, c.fb)
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, c.tex.t, 0)
      c.valid = false
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
  }

  /**
   * 每帧在雾的预渲染之前调（全屏四边形已绑好），t = uTime × uBus：用补画程序 `prog`（uniform 位置 `F`）补画缓存，
   * 返回取样要的 uBldOn、uBldGeo。调完当前程序可能是补画程序。
   */
  NebbiaBuildingCache.prototype.update = function (t, prog, F) {
    var gl = this.gl
    var self = this
    // 整张重画一帧只画一档（远近两层一起，一档要两层都画好才用得上）
    var fullLevel = -1
    var drawing = false
    for (var i = 0; i < this.caches.length; i++) {
      var c = this.caches[i]
      var off = t * SPEED[c.layer]
      var lo = off - MARGIN
      var hi = off + this.aspect + MARGIN
      if (c.valid && lo >= c.lo && hi <= c.hi) continue
      var ahead = c.valid && lo >= c.lo && hi - c.hi < this.span / 2
      if (!ahead && fullLevel >= 0 && fullLevel !== c.level) { c.valid = false; continue }
      if (!drawing) { gl.useProgram(prog); gl.enable(gl.SCISSOR_TEST); drawing = true }
      if (ahead) {
        // 往前开了一点：只补新露出来的那几列，最旧的几列被覆盖掉
        var next = hi + SLACK / 4
        this.fill(c, c.hi, next, F)
        c.hi = next
        c.lo = next - this.span
      } else {
        // 第一次、尺寸或配色变了、车速突变跳得太远：整张重画
        fullLevel = c.level
        c.lo = lo - SLACK / 4
        c.hi = c.lo + this.span
        this.fill(c, c.lo, c.hi, F)
        c.valid = true
      }
    }
    if (drawing) { gl.disable(gl.SCISSOR_TEST); gl.bindFramebuffer(gl.FRAMEBUFFER, null) }
    var on = []
    for (var level = 0; level < LEVELS.length; level++) {
      on.push(this.caches[level * 2].valid && this.caches[level * 2 + 1].valid ? 1 : 0)
    }
    var geo = []
    LEVELS.forEach(function (L) { geo.push(L.y0, L.y1, self.span) })
    return { on: [on[0], on[1], on[2]], geo: geo }
  }

  // 补画世界横坐标 [a, b) 这一段（内部用）
  NebbiaBuildingCache.prototype.fill = function (c, a, b, U) {
    var gl = this.gl
    var L = LEVELS[c.level]
    var cols = ringColumns(a, b, this.span, c.w)
    var runs = cols.runs
    if (!runs.length) return
    // 画进这张时先从采样单元上卸下，不然算反馈环
    gl.activeTexture(gl.TEXTURE0 + c.tex.unit)
    gl.bindTexture(gl.TEXTURE_2D, null)
    gl.bindFramebuffer(gl.FRAMEBUFFER, c.fb)
    gl.viewport(0, 0, c.w, c.h)
    gl.uniform1f(U.uFillB, L.b); gl.uniform1f(U.uFillLayer, c.layer); gl.uniform1f(U.uFillX0, cols.x0)
    gl.uniform3f(U.uFillGeo, L.y0, L.y1, this.span); gl.uniform2f(U.uFillSize, c.w, c.h)
    for (var i = 0; i < runs.length; i++) {
      gl.scissor(runs[i][0], 0, runs[i][1], c.h)
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
    }
    gl.bindTexture(gl.TEXTURE_2D, c.tex.t)
  }

  // ---------- 着色器程序后台编译（原版 nebbiaPrograms.ts） ----------
  // 雾笺的着色器程序（雾的预渲染、主画面、水珠精灵、擦痕遮罩、楼群缓存的补画、静态噪声纹理、雪花、萤虫）在后台编：
  // 有 KHR_parallel_shader_compile 时提交了不等，每帧问一次编好没有，编好才查链接结果（查结果会一直等到编完，
  // D3D11 上冷编要将近 1 秒）；没有这个扩展就当场等。运行时（本文件 NebbiaGl 的 ready）从这里编：源码、属性位置一样。
  // 雾的预渲染和主画面按窗外场景编（街景或水族箱）；楼群缓存的补画只有街景要；雪花只有雪窗要，萤虫只有凝露要。
  // ParallelCompile 类型：{ COMPLETION_STATUS_KHR: number }——KHR_parallel_shader_compile 扩展对象。

  /** 能不能把雾预渲染到浮点纹理：有 EXT_color_buffer_float，而且 RGBA16F 的帧缓冲拼得起来。上下文刚建好时调（查状态要等 GPU 进程一个来回）。 */
  function canRenderFogToFloat(gl) {
    if (!gl.getExtension('EXT_color_buffer_float')) return false
    var tex = gl.createTexture()
    var fb = gl.createFramebuffer()
    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, 1, 1, 0, gl.RGBA, gl.HALF_FLOAT, null)
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0)
    var ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.bindTexture(gl.TEXTURE_2D, null)
    gl.deleteFramebuffer(fb)
    gl.deleteTexture(tex)
    // 有的驱动报了 EXT_color_buffer_float 却拼不成 RGBA16F 的帧缓冲：退回主画面自己算雾
    if (!ok) console.warn('[Nebbia] fog prepass framebuffer incomplete, computing the fog in the main pass')
    return ok
  }

  /** constructor(gl, fogToFloat, scene, glass)：提交八个程序的编译，`poll()` 问编好没有。 */
  function NebbiaProgramBuild(gl, fogToFloat, scene, glass) {
    if (scene === undefined) scene = 'night'
    if (glass === undefined) glass = 'rain'
    this.gl = gl
    this.done = false
    this.parallel = gl.getExtension('KHR_parallel_shader_compile')
    var vs = compileShader(gl, gl.VERTEX_SHADER, GLSL.NEBBIA_VS)
    var frag = function (src) { return compileShader(gl, gl.FRAGMENT_SHADER, src) }
    var shaders = GLSL.nebbiaSceneShaders(scene, glass)
    this.programs = {
      // 雾的预渲染；不能渲染到浮点纹理时没有（主画面自己算雾）。
      fog: fogToFloat ? startProgram(gl, vs, frag(shaders.fog), { aPos: 0 }) : null,
      main: startProgram(gl, vs, frag(fogToFloat ? shaders.main : shaders.mainFallback), { aPos: 0 }),
      sprite: startProgram(gl, compileShader(gl, gl.VERTEX_SHADER, GLSL.NEBBIA_SPRITE_VS), frag(GLSL.NEBBIA_SPRITE_FS), { aCorner: 0, aRect: 1, aParam: 2 }),
      // 擦痕遮罩（本文件的 NebbiaMaskGl）。
      mask: startProgram(gl, compileShader(gl, gl.VERTEX_SHADER, NEBBIA_MASK_VS), frag(NEBBIA_MASK_FS), { aCorner: 0, aSeg: 1, aParam: 2 }),
      // 往楼群缓存里补画；窗外是水族箱时没有。
      bldFill: scene === 'night' ? startProgram(gl, vs, frag(GLSL.NEBBIA_BLD_FILL_FS), { aPos: 0 }) : null,
      // 算静态噪声纹理（本文件的 NebbiaNoiseTex）。
      noise: startProgram(gl, vs, frag(GLSL.NEBBIA_NOISE_FS), { aPos: 0 }),
      // 雪窗的雪花（本文件的 NebbiaSnowGl）；别的玻璃没有。
      flake: glass === 'snow' ? startProgram(gl, compileShader(gl, gl.VERTEX_SHADER, NEBBIA_FLAKE_VS), frag(NEBBIA_FLAKE_FS), { aCorner: 0, aA: 1, aB: 2, aC: 3 }) : null,
      // 凝露玻璃上的萤虫（本文件的 NebbiaFireflyGl）；别的玻璃没有。
      firefly: glass === 'dew' ? startProgram(gl, compileShader(gl, gl.VERTEX_SHADER, NEBBIA_FIREFLY_VS), frag(NEBBIA_FIREFLY_FS), { aCorner: 0, aA: 1, aB: 2, aC: 3 }) : null
    }
  }

  /** 都编好了吗：没编好返回 false，不等；编好了查链接结果，失败抛错。 */
  NebbiaProgramBuild.prototype.poll = function () {
    if (this.done) return true
    var gl = this.gl
    var parallel = this.parallel
    var programs = this.programs
    var list = [programs.fog, programs.main, programs.sprite, programs.mask, programs.bldFill, programs.noise, programs.flake, programs.firefly]
      .filter(function (p) { return !!p })
    if (parallel && !list.every(function (p) { return gl.getProgramParameter(p, parallel.COMPLETION_STATUS_KHR) })) return false
    for (var i = 0; i < list.length; i++) checkLinked(gl, list[i])
    // 链接好了，着色器对象不再要：删掉（挂在程序上的等程序删了才真正释放）
    for (var j = 0; j < list.length; j++) {
      var attached = gl.getAttachedShaders(list[j]) || []
      for (var k = 0; k < attached.length; k++) gl.deleteShader(attached[k])
    }
    this.done = true
    return true
  }

  // ---------- 主控（原版 nebbiaGl.ts） ----------
  // 雾笺的 WebGL2 部分：雾的预渲染和主画面两个全屏着色器，四张玻璃上的纹理（擦痕遮罩（每帧画）、擦痕边 / 雨点的水珠、
  // 雾上的凝结水珠、哈气的白气），两张雾的预渲染（RGBA16F，1/4、1/8 画布分辨率；不支持浮点渲染目标时主画面自己算；
  // 凝露玻璃再加一张清晰的给细水珠折射，采样单元 1），窗外楼群的缓存（采样单元 9–14，雾的预渲染和主画面从它取楼群），
  // 静态噪声纹理（采样单元 15）；雪窗的雪花在主画面之后叠上去（图集在采样单元 1，凝露才用的那个）。
  // 透明（seeThrough）时画布带透明通道，窗外不画：楼群缓存和雾的预渲染都跳过，主画面输出预乘的透明度。
  // 窗外是水族箱（scene）时程序按水族箱编，没有楼群缓存，每帧多传水母和气泡的 uniform。
  // 着色器在后台编译：`ready` 为真之前不画。雪和萤虫的实例打包数据由后续批次的模块以参数传入 draw 函数。

  // 街景（两个程序都有）读的 uniform；其余只在主画面
  var PALETTE_UNIFORMS = ['uSky0', 'uSky1', 'uLa', 'uLb', 'uLc']
  // 水族箱的（uJelly 这些）在街景的程序里取不到位置，设了也没事
  var SCENE_UNIFORMS = ['uRes', 'uSceneShift', 'uTime', 'uBus', 'uNeon', ...PALETTE_UNIFORMS, 'uSpotSrc', 'uSpotSrc2', 'uSpotTgt', 'uSpotR', 'uSpotI', 'uScenery', 'uBldOn', 'uBldGeo',
    'uJelly', 'uJellyC', 'uJellyN', 'uBubbles', 'uSway', 'uBurst', 'uBurstN', 'uBeatRows', 'uWeedIdle']
  var MAIN_UNIFORMS = [...SCENE_UNIFORMS, 'uDewGlint', 'uMist', 'uEdge', 'uRefract', 'uGlint', 'uGlassShift', 'uBreathOn', 'uBreathThick', 'uNoiseOn', 'uSeeThrough', 'uMistTint']

  /** uScenery 里楼群那一位（上游 nebbiaFrameUniforms.ts 的 SCENERY_BITS），和关着时给着色器的楼群缓存状态。 */
  var SCN_BUILDINGS = 1
  var NO_BUILDINGS = { on: [0, 0, 0], geo: [0, 1, 1, 0, 1, 1, 0, 1, 1] }

  function locate(gl, prog, names) {
    var out = {}
    for (var i = 0; i < names.length; i++) out[names[i]] = gl.getUniformLocation(prog, names[i])
    return out
  }

  /** constructor(canvas, seeThrough, scene, glass)：seeThrough 透明（窗外不画），scene 窗外场景，glass 玻璃上的水。 */
  function NebbiaGl(canvas, seeThrough, scene, glass) {
    if (seeThrough === undefined) seeThrough = false
    if (scene === undefined) scene = 'night'
    if (glass === undefined) glass = 'rain'
    var gl = canvas.getContext('webgl2', { antialias: false, alpha: seeThrough, preserveDrawingBuffer: false })
    if (!gl) throw new Error('Nebbia: WebGL2 unavailable')
    this.canvas = canvas
    this.seeThrough = seeThrough
    this.gl = gl
    // 编好后取的 uniform 位置：主画面、雾的预渲染、楼群缓存的补画。
    this.U = {}
    this.F = {}
    this.B = {}
    this.uView = null
    this.uFogB = null
    this.linked = false
    this.W = 1
    this.H = 1
    this.spriteReady = false
    // 白气纹理里是哪一版画布、多大（版本没变不重传）。
    this.breathVersion = -1
    this.breathW = 0
    this.breathH = 0
    // 雾上水珠纹理是不是还是对的：换尺寸后、精灵贴图加载好之前画的都不算，下一帧照画。
    this.fieldValid = false
    this.instData = new Float32Array(0)
    // 主题配色：编好之前先记下，编好时补上。
    this.palette = null
    // 透明时雾的颜色（0..1 的 RGB），跟主题日夜。
    this.mistTint = [0.07, 0.08, 0.1]
    // 精灵贴图加载好时调（这之前不画水珠）。
    this.onSpriteReady = null

    this.fogOK = canRenderFogToFloat(gl)
    this.build = new NebbiaProgramBuild(gl, this.fogOK, scene, glass)
    this.quadVao = gl.createVertexArray()
    gl.bindVertexArray(this.quadVao)
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer())
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
    // 属性位置在后台编译时绑死：aPos 0；aCorner 0、aRect 1、aParam 2；遮罩 aCorner 0、aSeg 1、aParam 2
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
    this.mask = new NebbiaMaskGl(gl, 2)
    this.drop = makeTex(gl, 3)
    this.field = makeTex(gl, 4)
    this.sprite = makeTex(gl, 5)
    this.fogGl = new NebbiaFogGl(gl, 6, this.fogOK, glass === 'dew' && !seeThrough ? 1 : null)
    this.breath = makeTex(gl, 8)
    // 楼群缓存，只有雨夜街景有（水族箱没有楼群，不建这几张纹理）。
    this.bld = scene === 'night' ? new NebbiaBuildingCache(gl, 9) : null
    this.noise = new NebbiaNoiseTex(gl, 15)
    this.snow = glass === 'snow' ? new NebbiaSnowGl(gl, 1) : null
    // 凝露玻璃上的萤虫；别的玻璃 null。
    this.fireflies = glass === 'dew' ? new NebbiaFireflyGl(gl) : null

    this.spriteVao = gl.createVertexArray()
    gl.bindVertexArray(this.spriteVao)
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer())
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW)
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
    this.instBuf = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instBuf)
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 24, 0); gl.vertexAttribDivisor(1, 1)
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 2, gl.FLOAT, false, 24, 16); gl.vertexAttribDivisor(2, 1)
    gl.bindVertexArray(null)
    this.loadSprite()
  }

  Object.defineProperty(NebbiaGl.prototype, 'isContextLost', {
    /** 上下文丢了没有（入口每帧查，丢了重建整个运行时）。 */
    get: function () { return this.gl.isContextLost() }
  })

  Object.defineProperty(NebbiaGl.prototype, 'ready', {
    /** 着色器编好了没有（没编好不等）；编好的那一次取 uniform 位置、指好采样器。链接失败时抛错。 */
    get: function () {
      if (this.linked) return true
      if (!this.build.poll()) return false
      var gl = this.gl
      var programs = this.build.programs
      var main = programs.main, fog = programs.fog, sprite = programs.sprite, mask = programs.mask
      var bldFill = programs.bldFill, flake = programs.flake, firefly = programs.firefly
      this.mask.attach(mask)
      this.U = locate(gl, main, MAIN_UNIFORMS)
      gl.useProgram(main)
      var fogBlur = this.fogGl.layers[0]
      var fogGlow = this.fogGl.layers[1]
      var fogSharp = this.fogGl.layers[2]
      var samplers = [['uMask', this.mask.tex], ['uDrop', this.drop], ['uField', this.field], ['uFogBlur', fogBlur.tex], ['uFogGlow', fogGlow.tex], ['uBreath', this.breath], ['uNoise', this.noise.tex]]
      if (fogSharp) samplers.push(['uFogSharp', fogSharp.tex])
      for (var i = 0; i < samplers.length; i++) gl.uniform1i(gl.getUniformLocation(main, samplers[i][0]), samplers[i][1].unit)
      gl.uniform1f(this.U.uBreathThick, Core.NEBBIA_FIXED.breathThick)
      gl.uniform1i(this.U.uSeeThrough, this.seeThrough ? 1 : 0)
      if (this.bld) this.bld.bindSamplers(main)
      if (fog) {
        this.F = locate(gl, fog, SCENE_UNIFORMS)
        this.uFogB = gl.getUniformLocation(fog, 'uFogB')
        if (this.bld) this.bld.bindSamplers(fog)
      }
      if (bldFill) this.B = locate(gl, bldFill, PALETTE_UNIFORMS.concat(BLD_FILL_UNIFORMS))
      if (flake && this.snow) this.snow.attach(flake, fogGlow.tex.unit, fogBlur.tex.unit, this.fogOK && !this.seeThrough)
      if (firefly && this.fireflies) this.fireflies.attach(firefly, fogGlow.tex.unit, this.fogOK && !this.seeThrough)
      gl.useProgram(sprite)
      this.uView = gl.getUniformLocation(sprite, 'uView')
      gl.uniform1i(gl.getUniformLocation(sprite, 'uSprite'), this.sprite.unit)
      this.linked = true
      if (this.palette) this.applyPalette(this.palette)
      return true
    }
  })

  NebbiaGl.prototype.loadSprite = function () {
    var self = this
    var img = new Image()
    img.onload = function () {
      var gl = self.gl
      if (gl.isContextLost()) return
      gl.activeTexture(gl.TEXTURE0 + self.sprite.unit)
      gl.bindTexture(gl.TEXTURE_2D, self.sprite.t)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img)
      gl.generateMipmap(gl.TEXTURE_2D)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR)
      self.spriteReady = true
      if (self.onSpriteReady) self.onSpriteReady()
    }
    img.src = RAINDROP_SPRITE_URL
  }

  /** 主题配色：天色两档、三个灯光色，0..1 的 RGB。 */
  NebbiaGl.prototype.setPalette = function (sky0, sky1, la, lb, lc) {
    this.palette = [sky0, sky1, la, lb, lc]
    if (this.linked) this.applyPalette(this.palette)
  }

  NebbiaGl.prototype.applyPalette = function (palette) {
    var sky0 = palette[0], sky1 = palette[1], la = palette[2], lb = palette[3], lc = palette[4]
    var gl = this.gl
    var programs = this.build.programs
    var pairs = [[programs.main, this.U], [programs.fog, this.F], [programs.bldFill, this.B]]
    for (var i = 0; i < pairs.length; i++) {
      var prog = pairs[i][0]
      var L = pairs[i][1]
      if (!prog) continue
      gl.useProgram(prog)
      gl.uniform3fv(L.uSky0, sky0); gl.uniform3fv(L.uSky1, sky1)
      gl.uniform3fv(L.uLa, la); gl.uniform3fv(L.uLb, lb); gl.uniform3fv(L.uLc, lc)
    }
    // 楼群的颜色跟着配色：缓存全部重画
    if (this.bld) this.bld.invalidate()
  }

  /** W、H 是 CSS 像素（水珠纹理用这个分辨率），dpr 是画布的像素比。 */
  NebbiaGl.prototype.resize = function (W, H, dpr) {
    var gl = this.gl
    this.W = Math.max(1, Math.round(W))
    this.H = Math.max(1, Math.round(H))
    this.canvas.width = Math.max(1, Math.round(W * dpr))
    this.canvas.height = Math.max(1, Math.round(H * dpr))
    this.mask.resize(W, H)
    this.fieldValid = false
    var texList = [this.drop, this.field]
    for (var i = 0; i < texList.length; i++) {
      var tex = texList[i]
      gl.activeTexture(gl.TEXTURE0 + tex.unit)
      gl.bindTexture(gl.TEXTURE_2D, tex.t)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, this.W, this.H, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
      if (!tex.fb) tex.fb = gl.createFramebuffer()
      gl.bindFramebuffer(gl.FRAMEBUFFER, tex.fb)
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex.t, 0)
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    this.fogGl.resize(this.canvas.width, this.canvas.height)
    this.noise.resize(this.canvas.width, this.canvas.height)
    if (this.bld) this.bld.resize(this.canvas.width, this.canvas.height, Math.max(1, Math.ceil(this.canvas.height / Core.FOG_DIV)))
  }

  // 水珠实例画进一张水珠纹理（CSS 分辨率）
  // inst 是 Float32Array（凝露的冷凝水珠，后续批次传入）时直接上传，不再拷一遍
  NebbiaGl.prototype.renderDrops = function (tex, inst) {
    var gl = this.gl
    gl.bindFramebuffer(gl.FRAMEBUFFER, tex.fb)
    gl.viewport(0, 0, this.W, this.H)
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)
    if (inst.length && this.spriteReady) {
      var data
      if (inst instanceof Float32Array) data = inst
      else {
        if (this.instData.length < inst.length) this.instData = new Float32Array(Math.ceil(inst.length * 1.5))
        this.instData.set(inst)
        data = this.instData.subarray(0, inst.length)
      }
      gl.useProgram(this.build.programs.sprite)
      gl.bindVertexArray(this.spriteVao)
      gl.bindBuffer(gl.ARRAY_BUFFER, this.instBuf)
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW)
      gl.uniform2f(this.uView, this.W, this.H)
      gl.enable(gl.BLEND)
      gl.blendFuncSeparate(gl.ONE_MINUS_DST_COLOR, gl.ONE_MINUS_SRC_COLOR, gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, inst.length / 6)
      gl.disable(gl.BLEND)
      gl.bindVertexArray(null)
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
  }

  // 街景要的 uniform（两个程序都设）
  NebbiaGl.prototype.setScene = function (L, u) {
    var gl = this.gl
    gl.uniform2f(L.uRes, this.canvas.width, this.canvas.height)
    gl.uniform1f(L.uTime, u.time); gl.uniform1f(L.uBus, u.bus); gl.uniform1f(L.uNeon, u.neon)
    gl.uniform2fv(L.uSceneShift, u.sceneShift)
    gl.uniform2fv(L.uSpotSrc, u.spotSrc); gl.uniform2fv(L.uSpotSrc2, u.spotSrc2); gl.uniform2fv(L.uSpotTgt, u.spotTgt)
    gl.uniform1f(L.uSpotR, u.spotR); gl.uniform1f(L.uSpotI, u.spotI)
    gl.uniform1i(L.uScenery, u.scenery)
    gl.uniform1f(L.uDewGlint, u.dewGlint)
    if (u.aqua) {
      gl.uniform4fv(L.uJelly, u.aqua.jelly); gl.uniform4fv(L.uJellyC, u.aqua.jellyColor)
      gl.uniform1i(L.uJellyN, u.aqua.count); gl.uniform1f(L.uBubbles, u.aqua.bubbles)
      gl.uniform4fv(L.uSway, u.aqua.sway); gl.uniform4fv(L.uBurst, u.aqua.bursts); gl.uniform1i(L.uBurstN, u.aqua.burstCount)
      gl.uniform1f(L.uBeatRows, u.aqua.beatRows)
      gl.uniform1f(L.uWeedIdle, u.aqua.weedIdle)
    }
  }

  // 楼群缓存的取样状态（两个程序都设）
  NebbiaGl.prototype.setBuildings = function (L, s) {
    var gl = this.gl
    gl.uniform3i(L.uBldOn, s.on[0], s.on[1], s.on[2])
    gl.uniform3fv(L.uBldGeo, s.geo)
  }

  /**
   * 画一帧（`ready` 为真之后才调）：擦痕遮罩（后续批次的线段收集器传 { data, count }），白气遮罩上传（这一帧有哈气、
   * 且画布重画过才传，`breath` 为 null 就不传），两张水珠纹理，补画楼群缓存，静态噪声纹理（改尺寸后算一次），
   * 雾的预渲染，主画面。
   */
  NebbiaGl.prototype.render = function (mask, breath, drops, field, u, fieldChanged) {
    if (fieldChanged === undefined) fieldChanged = true
    var gl = this.gl
    var U = this.U
    var programs = this.build.programs
    var main = programs.main, fog = programs.fog, bldFill = programs.bldFill, noise = programs.noise
    this.mask.draw(mask)
    // 白气画布重画过才重传；尺寸没变时只覆盖内容，不重新分配纹理
    if (breath && breath.version !== this.breathVersion) {
      var c = breath.canvas
      gl.activeTexture(gl.TEXTURE0 + this.breath.unit)
      gl.bindTexture(gl.TEXTURE_2D, this.breath.t)
      if (c.width === this.breathW && c.height === this.breathH) gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, c)
      else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c)
      this.breathVersion = breath.version
      this.breathW = c.width
      this.breathH = c.height
    }
    this.renderDrops(this.drop, drops)
    // 雾上水珠没变（凝露的冷凝水珠隔一阵才更新）时纹理留着上次的
    if (fieldChanged || !this.fieldValid) {
      this.renderDrops(this.field, field)
      this.fieldValid = this.spriteReady
    }
    gl.bindVertexArray(this.quadVao)
    // 楼群关着时不补画缓存；再打开时缓存发现位置对不上，自己整张重画。水族箱没有楼群（没有补画程序）
    var buildings = (u.scenery & SCN_BUILDINGS) && !this.seeThrough && bldFill && this.bld
      ? this.bld.update(u.time * u.bus, bldFill, this.B)
      : NO_BUILDINGS
    var noiseOn = this.noise.update(noise)
    if (fog && !this.seeThrough) {
      gl.useProgram(fog)
      this.setScene(this.F, u)
      this.setBuildings(this.F, buildings)
      this.fogGl.draw(this.uFogB)
    }
    gl.useProgram(main)
    this.setScene(U, u)
    this.setBuildings(U, buildings)
    gl.uniform1f(U.uMist, u.mist); gl.uniform1f(U.uEdge, u.edge)
    gl.uniform1f(U.uRefract, u.refract); gl.uniform1f(U.uGlint, u.glint)
    gl.uniform2fv(U.uGlassShift, u.glassShift)
    gl.uniform1i(U.uBreathOn, breath ? 1 : 0)
    gl.uniform1i(U.uNoiseOn, noiseOn ? 1 : 0)
    gl.uniform3fv(U.uMistTint, this.mistTint)
    gl.viewport(0, 0, this.canvas.width, this.canvas.height)
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
    gl.bindVertexArray(null)
  }

  /** 雪花图集（雪窗才有）。 */
  NebbiaGl.prototype.setFlakeAtlas = function (canvas, rows) {
    if (this.snow) this.snow.setAtlas(canvas, rows)
  }

  /** render 之后叠上雪花：count 片（打包在后续批次），shift 是这一帧的玻璃颠簸（uniform 里的 glassShift）。 */
  NebbiaGl.prototype.drawFlakes = function (data, count, shift) {
    if (this.snow) this.snow.draw(data, count, this.W, this.H, [-shift[0] * this.W, -shift[1] * this.H])
  }

  /** render 之后叠上凝露玻璃上的萤虫：count 只（打包在后续批次）。 */
  NebbiaGl.prototype.drawFireflies = function (data, count) {
    if (this.fireflies) this.fireflies.draw(data, count, this.W, this.H)
  }

  NebbiaGl.prototype.destroy = function () {
    var ext = this.gl.getExtension('WEBGL_lose_context')
    if (ext) ext.loseContext()
  }

  window.FoliaNebbiaGl = {
    // nebbiaGlUtils.ts
    compileShader: compileShader,
    startProgram: startProgram,
    checkLinked: checkLinked,
    makeTex: makeTex,
    // nebbiaPrograms.ts
    canRenderFogToFloat: canRenderFogToFloat,
    NebbiaProgramBuild: NebbiaProgramBuild,
    // nebbiaFogGl.ts / nebbiaNoiseTex.ts / nebbiaBuildingCache.ts
    NebbiaFogGl: NebbiaFogGl,
    NebbiaNoiseTex: NebbiaNoiseTex,
    ringColumns: ringColumns,
    BLD_FILL_UNIFORMS: BLD_FILL_UNIFORMS,
    NebbiaBuildingCache: NebbiaBuildingCache,
    // nebbiaMaskGl.ts
    NEBBIA_MASK_VS: NEBBIA_MASK_VS,
    NEBBIA_MASK_FS: NEBBIA_MASK_FS,
    NebbiaMaskGl: NebbiaMaskGl,
    // nebbiaSnowGl.ts 的 GL 绘制部分（FLAKE_FILL/FLAKE_STAGES 出自上游 nebbiaSnowFlakes.ts，后续批次对齐）
    FLAKE_FLOATS: FLAKE_FLOATS,
    FLAKE_FILL: FLAKE_FILL,
    FLAKE_STAGES: FLAKE_STAGES,
    NEBBIA_FLAKE_VS: NEBBIA_FLAKE_VS,
    NEBBIA_FLAKE_FS: NEBBIA_FLAKE_FS,
    NebbiaSnowGl: NebbiaSnowGl,
    // nebbiaFireflyGl.ts 的 GL 绘制部分（FIREFLY_FLOATS/fireflyParams.halo 出自上游 nebbiaFireflies.ts，后续批次对齐）
    FIREFLY_FLOATS: FIREFLY_FLOATS,
    NEBBIA_FIREFLY_VS: NEBBIA_FIREFLY_VS,
    NEBBIA_FIREFLY_FS: NEBBIA_FIREFLY_FS,
    NebbiaFireflyGl: NebbiaFireflyGl,
    // nebbiaGl.ts 主控
    RAINDROP_SPRITE_URL: RAINDROP_SPRITE_URL,
    NebbiaGl: NebbiaGl
  }
})()
