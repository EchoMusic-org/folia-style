// 雾笺（nebbia）着色器源码模块：移植自 folia-major src/components/visualizer/nebbia/
//   nebbiaSceneCommonGlsl.ts（两套窗外场景共用的 GLSL：哈希、值噪声、灯光色、光点、矩形、开关位）
//   nebbiaSpotGlsl.ts（聚光灯光柱）、nebbiaSceneGlsl.ts（雨夜街景）、nebbiaAquaGlsl.ts（水族箱）
//   nebbiaJellyGlsl.ts（水母）、nebbiaBubbleGlsl.ts（气泡）、nebbiaFireGlsl.ts（冰的火彩）
//   nebbiaShaders.ts（雾的预渲染、主画面 6 个变体拼接、噪声纹理、水珠精灵、nebbiaSceneShaders(scene, glass) 拼接函数）
// GLSL 模板串逐字保留（含着色器字符串内的中文注释，上游原样）。被 nebbia-gl.js 按 window.FoliaNebbiaGlsl 引用。
(function () {
  'use strict'

  // ---------- 窗外场景共用片段（原版 nebbiaSceneCommonGlsl.ts） ----------
  // 窗外两套场景（雨夜街景 NEBBIA_SCENE_GLSL、水族箱 NEBBIA_AQUA_GLSL）共用的 GLSL：哈希和值噪声、主题灯光色、
  // 高斯光点和软边矩形、灯照多远，几个常量，和窗外开关的位（uScenery）。从街景里拆出，街景拼起来的源码和拆之前逐字相同。
  var NEBBIA_SCENE_COMMON_GLSL = `
float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
// 格子编号 → 0..1 的伪随机数（Dave Hoskins 的 hash11）。原来用 fract(sin(n) × 43758)，sin 的精度各家驱动不一样、
// 编号随行驶越来越大时平台间会对不上；纯算术的分布一样（均匀、相邻编号不相关），只是每格具体的值换了
float h1(float n) { n = fract(n * 0.1031); n *= n + 33.33; n *= n + n; return fract(n); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}
vec3 pick(float h) { return h < 0.34 ? uLa : (h < 0.67 ? uLb : uLc); }
// 高斯光点：r 光点半径，b 模糊半径，streak 横向拖影半长；模糊越大越暗、越散
float glowPt(vec2 d, float r, float b, float streak) {
  d.x = sign(d.x) * max(abs(d.x) - streak, 0.0);
  float s2 = r * r + b * b;
  return (r * r / s2) * exp(-dot(d, d) / s2 * 1.6);
}
// 软边矩形：size 半宽高，soft 模糊半径
float softBox(vec2 d, vec2 size, float soft) {
  vec2 q = abs(d) - size;
  float sd = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0);
  float k = min(size.x, size.y);
  return (1.0 - smoothstep(-soft * 0.5, soft, sd)) * k / (k + soft * 0.6);
}
// 半径 r、模糊 b 的 glowPt 纵向照得到多远：再远指数项 < 1e-6，乘上最大的倍数（霓虹 2.8 × uNeon 2）也远不到 8 位输出的一级。
// 下面各组灯纵向照不到当前这一行就整组跳过，画面不变
float reach(float r, float b) { return 3.0 * sqrt(r * r + b * b); }
const float HZ = 0.6, ROAD = 0.7;
const float WIND = 0.6;   // 车速 1 时，雨相对车身每往下 1 就往后 0.6（和 JS 里的 WIND_DRIFT 对应）
const vec3 SODIUM = vec3(1.0, 0.68, 0.32);
// uScenery 的位：窗外画哪几样（设置里的开关，nebbiaFrameUniforms.ts）。聚光灯不占位，关掉时 uSpotI 为 0
const int SCN_BUILDINGS = 1, SCN_LIGHTS = 2, SCN_CARS = 4, SCN_ROAD = 8, SCN_RAIN = 16, SCN_RAIN_SLANT = 32;
bool sceneryOn(int bit) { return (uScenery & bit) != 0; }
`

  // ---------- 聚光灯光柱（原版 nebbiaSpotGlsl.ts） ----------
  // 打向正在写的字的两盏聚光灯的光柱（GLSL，scene() 最后叠上去），上游从 nebbiaSceneGlsl.ts 拆出。
  var NEBBIA_SPOT_GLSL = `
// 聚光灯光柱：从楼底的光源射向玻璃上的光斑，越近越宽越亮；b 是模糊半径（雾后面看光柱更散）
float beamFrom(vec2 src, vec2 q, float b) {
  vec2 d = uSpotTgt - src;
  float L = length(d);
  if (uSpotI <= 0.0 || L < 1e-3) return 0.0;
  d /= L;
  vec2 rel = q - src;
  float along = dot(rel, d);
  // 到「光源—光斑」这条线段的距离，不是到无限长中轴线的：末端是以光斑为圆心的圆头。
  // 原来按中轴线算、再沿光柱方向平切，末端是一道和光柱一样宽的平口；两盏灯从不同角度打到同一处，
  // 两个平口的角露在光斑两侧，看着像个 X
  float perp = length(rel - d * clamp(along, 0.0, L));
  float k = clamp(along / L, 0.0, 1.0);
  float w = mix(0.004, uSpotR * 0.9, k) + b;
  float body = exp(-perp * perp / (w * w)) * smoothstep(-0.01, 0.04, along) * (0.25 + 0.75 * k * k);
  // 光源本身：楼底一颗很亮的灯
  float lamp = exp(-dot(rel, rel) / (0.00004 + b * b * 0.25)) * 2.5 / (1.0 + b * 50.0);
  return (body * 0.7 + lamp) * uSpotI;
}
// 左右两盏，光源左右对称，打到同一个字上
float spotBeam(vec2 q, float b) { return beamFrom(uSpotSrc, q, b) + beamFrom(uSpotSrc2, q, b); }
`

  // ---------- 水母（原版 nebbiaJellyGlsl.ts） ----------
  // 水族箱里的水母（GLSL，拼进水族箱场景）：海月水母的样子，四叶内纹、往下垂的波浪伞裙、几根飘动的触手和中间的口腕。
  // 每只的位置、大小、收缩、颜色由 JS 每帧算好（nebbiaJellies.ts），像素只读 uniform 数组；离这只太远的像素直接跳过。
  // 雾后面（预渲染的 b = 0.03、0.09）细触手糊开看不见，只画伞盖和伞下一道拖尾光，省掉触手那一大块。
  var NEBBIA_JELLY_GLSL = `
// 每只：xy 位置（scene 坐标）、z 伞盖半径、w 收缩（0 舒张，1 收得最紧）；颜色 rgb（已按远近调暗），a 触手波的相位
uniform vec4 uJelly[24], uJellyC[24];
uniform int uJellyN;
vec3 jellies(vec2 q, float b) {
  vec3 c = vec3(0.0);
  float sharp = 1.0 - clamp(b * 25.0, 0.0, 1.0);
  bool fine = b < 0.004;
  for (int i = 0; i < 24; i++) {
    if (i >= uJellyN) break;
    vec4 J = uJelly[i];
    float size = J.z, pulse = J.w;
    vec2 d = q - J.xy;
    if (abs(d.x) > size * 2.2 + b * 3.0 || d.y < -size * 1.6 - b * 3.0 || d.y > size * 5.0 + b * 3.0) continue;
    vec3 jc = uJellyC[i].rgb * uNeon;
    float ph = uJellyC[i].a;
    // 伞盖：收缩时变窄变高；下沿往两边垂、带一圈波纹
    float wx = size * (1.0 - 0.18 * pulse), hy = size * 0.72 * (1.0 + 0.14 * pulse);
    vec2 p = vec2(d.x / wx, d.y / hy);
    float soft = b / size + 0.04;
    // 下沿那一段 r 涨得快（÷0.3），模糊时按 soft 放缓，不然雾后面伞裙下沿还是一道硬边；波纹也跟着糊掉
    float edge = 0.05 + 0.3 * p.x * p.x + 0.04 * cos(p.x * 14.0 + ph * 0.5) * sharp;
    float r = max(length(vec2(p.x, min(p.y, 0.0))), (p.y - edge) / (0.3 + soft) + 1.0);
    float fill = smoothstep(1.0 + soft, 1.0 - soft, r);
    float rr = (r - 0.9) / (0.09 + soft);
    float rim = exp(-rr * rr);
    vec2 pc = p + vec2(0.0, 0.4);
    float lobe = length(pc) - 0.26 - 0.07 * cos(4.0 * atan(pc.y, pc.x));
    float gon = exp(-lobe * lobe / (0.004 + soft * soft)) * (0.4 + 0.6 * sharp);
    c += jc * (fill * (0.16 + 0.55 * rim + 0.45 * gon) + glowPt(d + vec2(0.0, size * 0.25), size * 0.9, b, 0.0) * 0.18);
    if (d.y <= 0.0) continue;
    // 伞下一道拖尾光：模糊时靠它认出是水母
    float we = sqrt(pow(wx * 0.55, 2.0) + b * b);
    c += jc * exp(-d.x * d.x / (we * we)) * pow(max(1.0 - d.y / (size * 3.5), 0.0), 2.0) * 0.12 * smoothstep(0.0, size * 0.3, d.y);
    if (!fine) continue;
    // 触手：伞裙下沿垂下几根细丝，顺着往下传的波飘
    float w = 0.0012 + size * 0.012;
    we = sqrt(w * w + b * b);
    for (float k = 0.0; k < 6.0; k++) {
      float len = size * (2.6 + 1.6 * h1(float(i) * 13.0 + k));
      float s = d.y / len;
      if (s > 1.05) continue;
      float tx = (k / 5.0 - 0.5) * 1.5 * wx * (1.0 - 0.35 * min(s, 1.0));
      float dx = d.x - tx - sin(d.y / size * 2.6 - ph * 0.9 + k * 1.3) * size * 0.28 * min(s, 1.0);
      c += jc * (w / we) * exp(-dx * dx / (we * we)) * pow(max(1.0 - s, 0.0), 1.5) * smoothstep(hy * 0.1, hy * 0.35, d.y) * 0.8;
    }
    // 中间的口腕：粗一点、短一点的一条飘带
    float s = d.y / (size * 1.7);
    if (s < 1.0) {
      float wa = size * 0.14 * (1.0 - s * 0.6), wae = sqrt(wa * wa + b * b);
      float dx = d.x - sin(d.y / size * 3.5 - ph + 1.0) * size * 0.12 * s;
      c += jc * (wa / wae) * exp(-dx * dx / (wae * wae)) * (1.0 - s) * 0.35 * smoothstep(0.0, 0.01, d.y);
    }
  }
  return c;
}
`

  // ---------- 气泡（原版 nebbiaBubbleGlsl.ts） ----------
  // 水族箱里的气泡（GLSL，拼进水族箱场景）：像温泉，海底零散几个泉眼一股股往上冒细泡（窗外「雨」那一项：斜着、竖直、不冒），
  // 偶尔一个大泡慢慢晃着浮上去（「车灯」那一项）。uBubbles 是多少（设置里的滑杆）。
  // 智能动感模式「舞潮踏拍」的气泡一项：每拍从沙底冒出一排大泡，先冲一下再慢慢浮（每排的位置、时刻由水族箱场景逻辑给）；
  // 开着时不冒随机的大泡，细泡照常一直冒。
  // 一颗泡边缘按菲涅尔变亮、上沿受光，里面略暗，左上高光、右下反高光、底部聚起一小团光；很小的泡只是一个亮点。
  // 雾后面细泡看不清，只算每股一道淡淡的光；模糊时泡的光和压暗按面积摊薄，不会糊成暗心的光圈。
  var NEBBIA_BUBBLE_GLSL = `
uniform float uBubbles;
// 跟拍冒的每排：x、冒出的时刻、大小（0 是空格）、种子
uniform vec4 uBurst[12];
uniform int uBurstN;
// 1 时舞潮踏拍的气泡一项开着：不冒随机的大泡
uniform float uBeatRows;
// 一颗泡（d 是到泡心的偏移，y 朝下）：rgb 加上去的光，a 泡里压暗多少
vec4 aqBubble(vec2 d, float rad, float b) {
  float l = length(d), aa = max(b, 0.0005);
  float keep = rad * rad / (rad * rad + b * b * 4.0);
  float disc = smoothstep(rad + aa, rad - aa, l);
  float up = 0.5 + 0.5 * clamp(-d.y / max(l, 1e-5), -1.0, 1.0);
  float fres = pow(clamp(l / rad, 0.0, 1.0), 5.0) * disc * (0.35 + 0.65 * up);
  float spec = glowPt(d + vec2(rad * 0.36, rad * 0.4), rad * 0.15, b, 0.0);
  float spec2 = glowPt(d - vec2(rad * 0.32, rad * 0.42), rad * 0.1, b, 0.0) * 0.3;
  float caus = glowPt(d - vec2(0.0, rad * 0.5), rad * 0.32, b, 0.0) * 0.14;
  vec4 big = vec4(vec3(fres * 0.9 * keep + spec * 1.3 + spec2 + caus), disc * 0.14 * keep);
  vec4 tiny = vec4(vec3(glowPt(d, rad * 0.6, b, 0.0) * 1.3 + spec * 1.2), 0.0);
  return mix(tiny, big, smoothstep(0.0018, 0.0034, rad));
}
vec3 aqBubbles(vec3 col, vec2 q, float b, vec3 bc) {
  float t = uTime;
  float drift = sceneryOn(SCN_RAIN_SLANT) ? 0.1 : 0.0;
  float fade = smoothstep(0.93, 0.8, q.y);
  float qx = q.x + (0.92 - q.y) * drift;
  // 细泡：每股从一个泉眼冒出，越往上越散、泡越大一点
  if (sceneryOn(SCN_RAIN)) {
    float cw = 0.055, cx = floor(qx / cw);
    for (float k = -1.0; k <= 1.0; k++) {
      float n = cx + k;
      if (h1(n * 2.3 + 1.0) > uBubbles * 0.9) continue;
      float src = (n + 0.5) * cw + (h1(n + 3.0) - 0.5) * cw * 0.5;
      float sp = 0.14 + 0.1 * h1(n + 7.0), ch = 0.014 + 0.01 * h1(n + 5.0);
      float rise = clamp((0.92 - q.y) / 0.9, 0.0, 1.0);
      float sw = 0.003 + 0.016 * rise, swe = sqrt(sw * sw + b * b);
      float sx = qx - src;
      col += bc * exp(-sx * sx / (swe * swe)) * 0.03 * fade * (sw / swe + 0.3);
      if (b > 0.02) continue;
      float v = q.y + t * sp, iy = floor(v / ch);
      for (float j = -1.0; j <= 1.0; j++) {
        float m = iy + j, hb = h1(m * 1.31 + n * 17.0);
        if (hb > 0.85) continue;
        // 每颗在格子里上下错一点、左右散开，不排成一串珠子
        float y = (m + 0.2 + 0.6 * h1(m * 2.7 + n)) * ch - t * sp;
        float up = clamp((0.92 - y) / 0.9, 0.0, 1.0);
        float rad = 0.0012 + 0.003 * hb * hb * hb + 0.0012 * up;
        vec2 c = vec2(src + sin(m * 2.1 + t * 6.0) * (0.0015 + 0.006 * up) + (h1(m + n) - 0.5) * (0.006 + 0.03 * up), y);
        vec4 bub = aqBubble(vec2(qx, q.y) - c, rad, b);
        col = col * (1.0 - bub.a * fade) + bc * bub.rgb * fade * (0.6 + 0.4 * h1(m * 5.0 + n));
      }
    }
  }
  // 大泡：少、慢，上下略扁，边缘一边浮一边轻轻晃
  if (sceneryOn(SCN_CARS) && uBeatRows < 0.5) {
    float bw = 0.13, bx = floor(qx / bw);
    for (float k = -1.0; k <= 1.0; k++) {
      float n = bx + k;
      float sp = 0.07 + 0.04 * h1(n + 41.0), ch = 0.42;
      float iy = floor((q.y + t * sp) / ch);
      for (float j = -1.0; j <= 0.0; j++) {
        float m = iy + j;
        if (h1(m * 3.7 + n * 11.0) > min(1.1 * uBubbles, 0.85)) continue;
        float rad = 0.008 + 0.016 * pow(h1(m + n * 5.0), 1.5);
        vec2 c = vec2((n + 0.2 + 0.6 * h1(m * 7.0 + n)) * bw + sin(t * 1.3 + m) * 0.02, (m + 0.5) * ch - t * sp);
        vec2 d = vec2(qx, q.y) - c;
        // 按方向缩放偏移，轮廓就晃：sin(3θ + φ)、sin(2θ - φ') 用方向的余弦正弦展开，不用 atan
        vec2 u = d / max(length(d), 1e-5);
        float c2 = u.x * u.x - u.y * u.y, s2 = 2.0 * u.x * u.y;
        float c3 = u.x * (4.0 * u.x * u.x - 3.0), s3 = u.y * (3.0 - 4.0 * u.y * u.y);
        float f1 = t * 4.0 + m, f2 = t * 3.0;
        float shape = 1.0 + 0.03 * (s3 * cos(f1) + c3 * sin(f1)) + 0.02 * (s2 * cos(f2) - c2 * sin(f2));
        vec4 bub = aqBubble(vec2(d.x, d.y * 1.18) / shape, rad, b);
        col = col * (1.0 - bub.a * fade) + bc * (bub.rgb + glowPt(d, rad * 1.4, b, 0.0) * 0.04) * fade;
      }
    }
  }
  // 跟拍冒的一排排大泡：一排六颗，冒出时从小涨到全大，先冲一下再慢慢浮；离这一排远的像素直接跳过。
  // 每颗带一圈光晕，雾后面糊开也是一排亮点，看得出跟拍
  for (int i = 0; i < 12; i++) {
    if (i >= uBurstN) break;
    vec4 B = uBurst[i];
    float a = t - B.y;
    if (B.z <= 0.0 || a < 0.0) continue;
    float y0 = 0.9 - 0.2 * a - 0.28 * (1.0 - exp(-a * 3.0));
    if (abs(q.y - y0) > 0.08 + b * 3.0) continue;
    float grow = smoothstep(0.0, 0.15, a) * (0.55 + 0.45 * B.z);
    for (float k = 0.0; k < 6.0; k++) {
      float h = h1(B.w + k * 7.3), h2 = h1(B.w * 1.7 + k * 3.1);
      float rad = (0.008 + 0.012 * h) * grow;
      vec2 c = vec2(B.x + (k - 2.5) * 0.05 + (h2 - 0.5) * 0.02 + sin(a * 3.0 + k * 1.7) * 0.004 * a, y0 + (h - 0.5) * 0.04);
      vec2 d = vec2(qx, q.y) - c;
      vec4 bub = aqBubble(vec2(d.x, d.y * 1.18), rad, b);
      col = col * (1.0 - bub.a * fade) + bc * (bub.rgb + glowPt(d, rad * 2.0 + 0.004, b, 0.0) * 0.22) * fade;
    }
  }
  return col;
}
`

  // ---------- 冰的火彩（原版 nebbiaFireGlsl.ts） ----------
  // 冰的火彩（色散），nebbia-gl.js 画雪花和结了冰的水珠的冰芯（也排成雪花实例）时用：不按时间随机闪，只在固定的几何关系下出现——
  // 冰面的斜面方向和身后亮光照过来的方向（雾光晕层亮度的梯度）的夹角，落在这块冰面自己固定的折射角附近时，
  // 这一小段角度按色散从红到紫分开。光不动、冰不动，颜色就不变；窗外的灯移过去，彩色才沿着冰棱扫过。
  var NEBBIA_FIRE_GLSL = `
// glow：雾的光晕层；fu：屏幕 uv（y 向上）；n：冰面斜面（屏幕方向，y 向上）；seed：这块冰面的随机数（定它的折射角）
vec3 fixedFire(sampler2D glow, vec2 fu, vec2 n, float seed) {
  const vec3 W = vec3(0.3, 0.59, 0.11);
  vec2 e = vec2(0.025, 0.0);
  vec2 lg = vec2(dot(textureLod(glow, fu + e.xy, 0.0).rgb - textureLod(glow, fu - e.xy, 0.0).rgb, W),
                 dot(textureLod(glow, fu + e.yx, 0.0).rgb - textureLod(glow, fu - e.yx, 0.0).rgb, W));
  float ll = length(lg), nl = length(n);
  if (ll < 1e-4 || nl < 1e-4) return vec3(0.0);
  float x = (dot(n / nl, lg / ll) - mix(0.6, 0.95, seed)) / 0.05;
  if (abs(x) >= 1.0) return vec3(0.0);
  float h = (x * 0.5 + 0.5) * 0.75;
  vec3 spec = clamp(abs(fract(h + vec3(0.0, 0.667, 0.333)) * 6.0 - 3.0) - 1.0, 0.0, 1.0);
  return spec * (1.0 - x * x) * smoothstep(0.002, 0.03, ll);
}
`

  // ---------- 雨夜街景（原版 nebbiaSceneGlsl.ts） ----------
  // 公交车侧窗外的雨夜街景（GLSL，主着色器和雾的预渲染共用）：远近两层楼群、主题色霓虹散景、路灯招牌、湿路面倒影、
  // 车灯、斜着落的雨，和打向正在唱的字的两盏聚光灯。scene(q, b) 里 b 是模糊半径（屏高的比例），雾后面的窗外用大的 b。
  // 窗外每样都能在设置里单独关掉（uScenery）。
  // 哈希、光点这些和水族箱共用的函数在 NEBBIA_SCENE_COMMON_GLSL。
  // 着色器从原型（feat/fog-write-prototype 分支 dev/prototypes/fog-write/index.html）搬来；格子伪随机数 h1 后来换成了纯算术哈希，分布不变、每格的样子和原型不同。
  var NEBBIA_SCENE_GLSL = `${NEBBIA_SCENE_COMMON_GLSL}// 路灯和招牌（倒影也用它）
vec3 lampsSigns(vec2 q, float b, float t) {
  vec3 c = vec3(0.0);
  // 招牌、店面：近，移动快，带横向拖影
  float xs = q.x + t * 0.42, cw = 0.34, streak = 0.012 * uBus;
  float cs = floor(xs / cw);
  // 招牌的灯在 0.46–0.56 高、店面在 0.645（倒影调用时 q、b 不一样，各自判断）
  bool sg = abs(q.y - 0.51) < 0.05 + reach(0.016, b + 0.002), sh = abs(q.y - 0.645) < reach(0.026, b + 0.003);
  if (sg || sh) for (float k = -1.0; k <= 1.0; k++) {
    float n = cs + k;
    // 招牌、店面的灯：都画成圆的散景光斑（远处的灯失焦后是圆的），不画方块
    if (sg) {
      vec2 cen = vec2((n + 0.2 + 0.6 * h1(n)) * cw, 0.46 + 0.1 * h1(n + 17.0));
      if (h1(n + 33.0) < 0.75) c += pick(h1(n + 2.0)) * glowPt(vec2(xs, q.y) - cen, 0.006 + 0.01 * h1(n + 5.0), b + 0.002, streak) * 1.6;
    }
    // 店面：底层一两团暖光
    vec2 shop = vec2((n + 0.5) * cw, 0.645);
    if (sh && h1(n + 41.0) < 0.6) c += mix(SODIUM, pick(h1(n + 8.0)), 0.3) * glowPt(vec2(xs, q.y) - shop, 0.016 + 0.01 * h1(n + 3.0), b + 0.003, streak) * 0.9;
  }
  // 路灯：中景，灯头 + 雨里的大光晕（0.36 高，光晕半径 0.07）
  float xl = q.x + t * 0.22, lw = 0.55;
  float cl = floor(xl / lw);
  if (abs(q.y - 0.36) < reach(0.07, b)) for (float k = -1.0; k <= 1.0; k++) {
    vec2 d = vec2(xl - (cl + k + 0.5) * lw, q.y - 0.36);
    c += SODIUM * (glowPt(d, 0.007, b, 0.004 * uBus) * 2.6 + glowPt(d, 0.07, b, 0.0) * 0.3);
  }
  return c;
}
// 一层楼群（layer 0 = 远，1 = 近）。返回 rgb = 颜色，a = 覆盖度。
// 每格一栋：宽度、高度随机，一半带收分的顶层，少数顶上有天线；立面下亮上暗（被街灯照）、一侧有一道边光；
// 窗是小格子，每栋亮灯比例不同，有的整层全黑，亮着的窗分暖白、冷白和主题色，亮度不一。
vec4 building(vec2 q, float b, float t, float layer) {
  float near = layer;
  float x = q.x + t * mix(0.02, 0.035, near) + layer * 7.7;
  float cw = mix(0.065, 0.12, near), aa = max(b, 0.0012);
  float c0 = floor(x / cw);
  vec4 res = vec4(0.0);
  // 每栋楼（连收分顶层、天线）都落在自己那一格里，左右邻居只在离格边不到模糊半径（再加天线宽）时才碰得到这个像素：
  // 离得更远时邻居的覆盖度必然是 0，跳过，画面不变。清晰窗外模糊半径很小，大部分像素只用算本格一栋
  float fx = x - c0 * cw, nbReach = aa + 0.0013;
  for (float k = -1.0; k <= 1.0; k++) {
    if ((k < 0.0 && fx > nbReach) || (k > 0.0 && cw - fx > nbReach)) continue;
    float n = c0 + k + layer * 100.0;
    float w = cw * (0.72 + 0.26 * h1(n));
    float left = (c0 + k) * cw + (cw - w) * h1(n + 1.0);
    float lx = x - left;
    float hgt = mix(0.07, 0.11, near) + mix(0.16, 0.27, near) * pow(h1(n + 2.0), 1.5);
    float base = HZ + near * 0.015;
    float top = base - hgt;
    // 收分的顶层
    bool tier = h1(n + 3.0) < 0.5;
    float tw = w * (0.5 + 0.25 * h1(n + 4.0)), tl = (w - tw) * 0.5, th = hgt * (0.12 + 0.15 * h1(n + 5.0));
    float body = smoothstep(-aa, aa, lx) * smoothstep(-aa, aa, w - lx) * smoothstep(-aa, aa, q.y - top);
    float up = tier ? smoothstep(-aa, aa, lx - tl) * smoothstep(-aa, aa, tl + tw - lx) * smoothstep(-aa, aa, q.y - (top - th)) : 0.0;
    float roof = tier ? top - th : top;
    // 天线
    float ant = h1(n + 6.0) < 0.3 ? smoothstep(0.0012 + aa, 0.0, abs(lx - w * 0.5)) * smoothstep(-aa, aa, q.y - (roof - 0.04 - 0.03 * h1(n + 7.0))) : 0.0;
    float cov = max(max(body, up), ant);
    if (cov <= 0.0) continue;
    // 立面：暗色，按楼略有差别；越往下越被街面的灯照亮；左侧一道细边光
    vec3 fac = mix(uSky0, vec3(0.015, 0.018, 0.025), 0.55) * (0.7 + 0.6 * h1(n + 8.0));
    float lowLit = pow(clamp((q.y - roof) / (base - roof), 0.0, 1.0), 2.5);
    fac += mix(SODIUM, uLa, 0.5) * 0.1 * lowLit;
    fac += mix(uSky1, uLb, 0.3) * 0.12 * smoothstep(0.003 + aa, 0.0, lx) * body;
    // 窗格
    float fh = mix(0.0075, 0.012, near), wc = mix(0.0055, 0.0085, near);
    vec2 g = vec2((lx - wc * 0.6) / wc, (q.y - roof - fh * 0.8) / fh);
    vec2 id = floor(g), f = fract(g);
    float dens = 0.15 + 0.5 * h1(n + 9.0);
    float floorOn = step(0.18, hash(vec2(id.y, n)));
    float on = step(hash(id + n * 3.7), dens) * floorOn;
    // 窗区边界跟着模糊半径变软，糊开时不出硬边
    float inside = smoothstep(-aa, aa, lx - wc * 0.6) * smoothstep(-aa, aa, w - wc * 0.6 - lx) * smoothstep(-aa, aa, q.y - roof - fh * 0.8) * smoothstep(-aa, aa, base - fh - q.y);
    float pane = smoothstep(0.32, 0.22, abs(f.x - 0.5)) * smoothstep(0.3, 0.2, abs(f.y - 0.5));
    // 被雾糊开时窗格变成平均亮度，不闪
    float blurMix = clamp(b / (wc * 0.8), 0.0, 1.0);
    float win = mix(pane * on, 0.3 * dens * 0.82, blurMix) * inside * max(body, up);
    float hc = hash(id + n * 1.3);
    vec3 wcol = hc < 0.5 ? vec3(1.0, 0.78, 0.5) : (hc < 0.8 ? vec3(0.78, 0.88, 1.0) : pick(hash(id + 5.0)));
    // 糊开时每格的颜色、亮度也换成平均值，否则会出现马赛克
    wcol = mix(wcol * (0.55 + 0.6 * hash(id + 2.9)), vec3(0.95, 0.82, 0.66) * 0.85, blurMix);
    vec3 bc = fac + wcol * win * mix(0.7, 1.0, near);
    // 远层被大气冲淡，往天色靠
    bc = mix(bc, mix(uSky0, uSky1, 0.7), mix(0.45, 0.12, near));
    res = vec4(mix(res.rgb, bc, cov), max(res.a, cov));
  }
  return res;
}
// 从楼群缓存取一层（预乘颜色）：横向按这层的速度（building 里的 0.02、0.035）平移，环形取样
vec4 bldAt(sampler2D s, vec2 q, float t, float speed, vec3 g) {
  // 没有 mipmap；在分支里取样，用 textureLod 不依赖导数
  return textureLod(s, vec2((q.x + t * speed) / g.z, (q.y - g.x) / (g.y - g.x)), 0.0);
}
// 主题色霓虹（照雨湖的远处灯光）：楼群之间密密的彩色小散景，偶尔一大团霓虹带一圈很大的光晕。
// 颜色取这首歌的三个灯光色；移动速度介于楼群和路灯之间。倒影也用它。
vec3 neonLights(vec2 q, float b, float t) {
  vec3 c = vec3(0.0);
  float bb = b + 0.003;   // 散景本身就是虚的
  // 小散景：两排格子，每格最多一颗，落在楼群那一段高度里（0.38–0.58）
  if (abs(q.y - (HZ - 0.12)) < 0.1 + reach(0.012, bb)) for (float row = 0.0; row < 2.0; row++) {
    float x = q.x + t * (0.06 + row * 0.03) + row * 7.3, cw = 0.045 - row * 0.012;
    float c0 = floor(x / cw);
    for (float k = -1.0; k <= 1.0; k++) {
      float n = c0 + k + row * 300.0;
      if (h1(n + 11.0) > 0.85) continue;
      vec2 cen = vec2((c0 + k + 0.15 + 0.7 * h1(n)) * cw, HZ - 0.02 - 0.2 * pow(h1(n + 3.0), 1.6));
      float r = 0.004 + 0.008 * pow(h1(n + 6.0), 3.0);
      c += pick(h1(n + 9.0)) * glowPt(vec2(x, q.y) - cen, r, bb, 0.0) * (1.0 + 1.8 * h1(n + 13.0));
    }
  }
  // 大霓虹：稀疏，一个亮核 + 一圈很大的同色光晕（雨湖左边那盏洋红灯）
  float xb = q.x + t * 0.1, bw = 0.75, cb = floor(xb / bw);
  if (abs(q.y - (HZ - 0.14)) < 0.06 + reach(0.13, b)) for (float k = -1.0; k <= 1.0; k++) {
    float n = cb + k + 500.0;
    vec2 d = vec2(xb - (cb + k + 0.2 + 0.6 * h1(n)) * bw, q.y - (HZ - 0.08 - 0.12 * h1(n + 2.0)));
    vec3 lc = pick(h1(n + 4.0));
    c += lc * (glowPt(d, 0.014, bb, 0.0) * 2.0 + glowPt(d, 0.13, b, 0.0) * 0.4);
  }
  return c;
}
${NEBBIA_SPOT_GLSL}
// 公交车侧窗外的雨夜街景：远处楼群慢、路灯中速、招牌和车灯快
vec3 scene(vec2 q, float b) {
  float t = uTime * uBus;
  vec3 col = mix(uSky0, uSky1, smoothstep(0.0, HZ, q.y));
  col += mix(uLa, SODIUM, 0.4) * 0.14 * exp(-abs(q.y - HZ + 0.12) * 6.0);
  // 楼群：远近两层，远层矮、淡、窗小；近层高、细节多
  float aa = max(b, 0.0015), c0;
  // 楼群走缓存（nebbiaBuildingCache.ts）。水珠透镜（b = 0.006）折射得远，会取到缓存范围外面，照旧现算（只占几颗水珠的面积）；
  // 缓存还没画好的那档也现算
  bool bldOn = sceneryOn(SCN_BUILDINGS);
  bool cached = b < 0.002 ? uBldOn.x : (b > 0.05 ? uBldOn.z : (b > 0.02 ? uBldOn.y : false));
  if (bldOn && cached) {
    vec4 bf, bn;
    if (b > 0.05) { bf = bldAt(uBld4, q, t, 0.02, uBldGeo[2]); bn = bldAt(uBld5, q, t, 0.035, uBldGeo[2]); }
    else if (b > 0.02) { bf = bldAt(uBld2, q, t, 0.02, uBldGeo[1]); bn = bldAt(uBld3, q, t, 0.035, uBldGeo[1]); }
    else { bf = bldAt(uBld0, q, t, 0.02, uBldGeo[0]); bn = bldAt(uBld1, q, t, 0.035, uBldGeo[0]); }
    col = col * (1.0 - bf.a) + bf.rgb;
    col = col * (1.0 - bn.a) + bn.rgb;
  } else if (bldOn) {
    vec4 bf = building(q, b, t, 0.0);
    col = mix(col, bf.rgb, bf.a);
    vec4 bn = building(q, b, t, 1.0);
    col = mix(col, bn.rgb, bn.a);
  }
  // 主题色霓虹压在楼群前面；天边再铺一层很宽的主题色辉光
  bool lightsOn = sceneryOn(SCN_LIGHTS);
  if (lightsOn) {
    col += (neonLights(q, b, t) + uLa * 0.12 * exp(-abs(q.y - HZ + 0.1) * 5.0)) * uNeon;
    col += lampsSigns(q, b, t);
  }
  // 湿路面和倒影（路面关掉时车灯也没有倒影）
  float road = sceneryOn(SCN_ROAD) ? smoothstep(ROAD - aa, ROAD + aa, q.y) : 0.0;
  col = mix(col, uSky0 * 0.5, road * 0.85);
  // 倒影都乘 road，路面以上恰好是 0：直接跳过，画面不变，省掉屏上大半像素的两整套招牌、霓虹计算
  if (road > 0.0 && lightsOn) {
    vec2 qr = vec2(q.x, ROAD - (q.y - ROAD) * 0.55);
    col += lampsSigns(qr, b + 0.012, t) * road * 0.35;
    // 霓虹倒影：纵向压得更扁，所以在湿路面上拉成竖直的光柱（雨湖的倒影做法）
    vec2 qn = vec2(q.x, HZ - (q.y - ROAD) * 0.22);
    col += neonLights(qn, b + 0.008, t) * road * 0.45 * uNeon;
  }
  // 车灯：同向车道尾灯（红），对向车道前灯（白），快速掠过拖出长影
  if (sceneryOn(SCN_CARS)) for (float lane = 0.0; lane < 2.0; lane++) {
    float sp = lane < 0.5 ? 0.55 : -1.1, ly = lane < 0.5 ? 0.76 : 0.83, ww = 0.9;
    float xc = q.x + t * sp, cc = floor(xc / ww);
    vec3 lc = lane < 0.5 ? vec3(1.0, 0.18, 0.12) : vec3(1.0, 0.95, 0.85);
    // 车灯和它在路面上的倒影纵向都照不到这一行（倒影乘 road，路面以上本来就是 0）就跳过这条车道
    bool hd = abs(q.y - ly) < reach(0.004, b), rf = road > 0.0 && abs((q.y - ly) * 3.0 - 0.03) < reach(0.02, b * 2.0);
    if (!hd && !rf) continue;
    for (float k = -1.0; k <= 1.0; k++) {
      float n = cc + k + lane * 50.0;
      if (h1(n) > 0.6) continue;
      float cx = (cc + k + 0.2 + 0.6 * h1(n + 4.0)) * ww;
      float st = abs(sp) * 0.03 * uBus;
      if (hd) {
        c0 = glowPt(vec2(xc - cx + 0.035, q.y - ly), 0.004, b, st) + glowPt(vec2(xc - cx - 0.035, q.y - ly), 0.004, b, st);
        col += lc * c0 * 2.2;
      }
      if (rf) col += lc * glowPt(vec2(xc - cx, (q.y - ly) * 3.0 - 0.03), 0.02, b * 2.0, st) * road * 0.3;
    }
  }
  // 窗外的雨：相对车身的速度 = 往下落 + 往后（车往右开，窗外往左走），车越快越斜；停站时竖直落。
  // 雨丝只在聚光灯光柱里画（被照亮的那些）。设置里可以让它总是竖直落，或者不下（只剩光柱）
  float beam = spotBeam(q, b);
  if (!sceneryOn(SCN_RAIN)) return col + uLa * beam;
  vec2 rd = normalize(vec2(sceneryOn(SCN_RAIN_SLANT) ? -WIND * uBus : 0.0, 1.0));
  vec2 r = vec2(dot(q, rd), dot(q, vec2(-rd.y, rd.x)));
  float colId = floor(r.y / 0.007), hr = h1(colId);
  float seg = fract(r.x * (1.5 + hr) - uTime * (2.5 + hr * 2.0) * (1.0 + 0.4 * uBus) + hr * 10.0);
  float line = smoothstep(0.0012 + b, 0.0, abs(fract(r.y / 0.007) - 0.5) * 0.007) * smoothstep(0.0, 0.1, seg) * smoothstep(0.3, 0.1, seg);
  // 聚光灯：光柱叠在最前面；光柱里的雨丝被照亮
  col += uLa * beam + mix(uLa, vec3(1.0), 0.5) * line * beam * 1.6 * step(0.3, hr) * (1.0 - clamp(b * 40.0, 0.0, 1.0));
  return col;
}
`

  // ---------- 水族箱（原版 nebbiaAquaGlsl.ts） ----------
  // 窗外的第二套场景：水族箱（GLSL，主着色器和雾的预渲染共用，选了水族箱时代替雨夜街景 NEBBIA_SCENE_GLSL 编进去）。
  // 水跟主题走：水面一层带强调色、越往下越深到主题的暗底色，水面照下来的一道道光，底下沙地和焦散；
  // 礁石和水草的剪影，水草上一串串荧光粒子，水母（NEBBIA_JELLY_GLSL），气泡（NEBBIA_BUBBLE_GLSL），
  // 两盏聚光灯从水面上方打到正在写的字上（光源在场景 uniform 里放到画面上沿外）。
  // 窗外开关的位和街景一样，换个说法：楼群 = 礁石水草，光斑 = 水草上的荧光粒子，车灯 = 大泡，马路 = 沙底，雨 = 细泡。
  var NEBBIA_AQUA_GLSL = `${NEBBIA_SCENE_COMMON_GLSL}${NEBBIA_SPOT_GLSL}${NEBBIA_JELLY_GLSL}${NEBBIA_BUBBLE_GLSL}
// 「舞潮踏拍」的水草一项（nebbiaWeedSway.ts）：弹簧现在、0.05、0.1、0.15 秒前的位置；根取现在、梢取 0.15 秒前，
// 从根往梢传
uniform vec4 uSway;
// 水草自己的摆动留多少：1 照常，舞潮踏拍的水草一项开着时 0（只跟拍走），切换时慢慢过渡（nebbiaAquarium.ts）
uniform float uWeedIdle;
float weedKick(float s) {
  float f = clamp(s, 0.0, 1.0) * 3.0;
  return f < 1.0 ? mix(uSway.x, uSway.y, f) : f < 2.0 ? mix(uSway.y, uSway.z, f - 1.0) : mix(uSway.z, uSway.w, f - 2.0);
}
vec3 scene(vec2 q, float b) {
  float t = uTime, sharp = 1.0 - clamp(b * 25.0, 0.0, 1.0);
  vec3 deep = uSky0 * 0.55;
  vec3 col = mix(mix(uSky1, uLa, 0.3) * 1.25 + 0.02, deep, smoothstep(0.0, 0.95, q.y));
  vec3 lightC = mix(uLa, vec3(1.0), 0.45);
  // 水面照下来的光束，越往下越淡；最上面一层水面的粼光
  float rx = q.x + q.y * 0.35;
  float rays = pow(0.5 + 0.5 * sin(rx * 9.0 + t * 0.3 + sin(rx * 3.1 - t * 0.2) * 1.5), 6.0)
             + 0.6 * pow(0.5 + 0.5 * sin(rx * 17.0 - t * 0.45), 8.0);
  col += lightC * mix(0.25, rays, sharp * 0.6 + 0.4) * (1.0 - smoothstep(0.0, 0.85, q.y)) * 0.13;
  col += lightC * 0.8 * exp(-q.y * 14.0) * (0.25 + 0.15 * sin(q.x * 30.0 + t * 1.3 + sin(q.x * 7.0)) * sharp);
  // 沙底和焦散（「马路」）
  if (sceneryOn(SCN_ROAD)) {
    float floorY = 0.89 + 0.015 * sin(q.x * 3.0);
    float caus = pow(abs(sin(q.x * 23.0 + sin(q.y * 40.0 + t) * 1.2 + t * 0.6) * sin(q.x * 17.0 - t * 0.5 + q.y * 30.0)), 3.0);
    col = mix(col, deep * 1.3 + 0.03 + lightC * caus * 0.12 * sharp, smoothstep(floorY - 0.01 - b, floorY + 0.01 + b, q.y));
  }
  // 礁石（「楼群」）：顶上被水面的光照亮、带一点焦散，往下渐暗，表面有坑洼的纹理；比后面的水亮一点才看得出是石头
  if (sceneryOn(SCN_BUILDINGS)) {
    float rockY = 0.8 + 0.07 * vnoise(vec2(q.x * 3.5, 1.0)) + 0.02 * vnoise(vec2(q.x * 14.0, 3.0));
    float under = max(q.y - rockY, 0.0);
    float tex = 0.75 + 0.5 * mix(0.5, vnoise(q * vec2(26.0, 34.0)) * 0.65 + vnoise(q * vec2(70.0, 90.0)) * 0.35, sharp);
    vec3 rock = mix(deep * 1.6 + lightC * 0.07, deep * 0.75, smoothstep(0.0, 0.09, under)) * tex;
    float rc = pow(abs(sin(q.x * 31.0 + t * 0.5 + sin(q.y * 50.0 - t * 0.7)) * sin(q.x * 19.0 - t * 0.4 + q.y * 37.0)), 4.0);
    rock += lightC * (0.16 * exp(-under * 70.0) + rc * 0.07 * sharp * (1.0 - smoothstep(0.0, 0.05, under)));
    col = mix(col, rock, smoothstep(rockY - b - 0.003, rockY + b + 0.003, q.y) * 0.95);
    // 石脊前面一块块圆石头：按椭球的法线算受光（光从水面往下打），顶上亮、底下暗，边缘被噪声啃得不圆
    float rw = 0.17, rcx = floor(q.x / rw);
    for (float k = -1.0; k <= 1.0; k++) {
      float n = rcx + k, h = h1(n * 4.1 + 2.0);
      if (h > 0.7) continue;
      float rx = 0.06 + 0.05 * h1(n + 9.0), ry = rx * (0.55 + 0.3 * h1(n * 2.7));
      vec2 c = vec2((n + 0.3 + 0.4 * h1(n * 5.3)) * rw, 0.95);
      vec2 d = (q - c) / vec2(rx, ry);
      float edge = 0.12 * (vnoise(vec2(atan(d.y, d.x) * 2.5, n * 3.0)) - 0.5);
      float e = length(d) + edge, soft = (b + 0.003) / ry;
      float cover = smoothstep(1.0 + soft, 1.0 - soft, e);
      if (cover <= 0.0) continue;
      vec3 nrm = normalize(vec3(d * 0.9, sqrt(max(1.0 - dot(d, d), 0.04))));
      float lit = max(dot(nrm, normalize(vec3(-0.35, -1.0, 0.7))), 0.0);
      vec3 stone = (deep * 1.8 + lightC * 0.08) * (0.4 + 1.0 * lit) * tex + lightC * pow(lit, 6.0) * 0.16 * sharp;
      col = mix(col, stone, cover * 0.97);
    }
  }
  // 水草（「楼群」）和长在上面的一串串荧光粒子（「光斑」）：水草从根到梢传一道波，摆得快一点，
  // 「舞潮踏拍」时再跟拍往一边推（weedKick）；粒子跟着草身一起摆，越往梢越亮，各自一闪一闪
  bool weeds = sceneryOn(SCN_BUILDINGS), glow = sceneryOn(SCN_LIGHTS);
  if (weeds || glow) {
    float cw = 0.06, cx = floor(q.x / cw);
    for (float k = -1.0; k <= 1.0; k++) {
      float n = cx + k, h = h1(n * 1.7 + 5.0);
      if (h > 0.45) continue;
      float top = 0.55 + 0.25 * h1(n + 2.0), base = 0.92, len = base - top;
      float sway = t * (3.6 + 1.8 * h) + h * 20.0, bend = 0.07 * (0.7 + 0.6 * h);
      if (weeds) {
        float s = clamp((base - q.y) / len, 0.0, 1.0);
        float x0 = (n + 0.5) * cw + sin(q.y * 11.0 + sway) * 0.025 * uWeedIdle * s + weedKick(s) * bend * s * s;
        float w = 0.003 * (1.0 - s * 0.6), we = sqrt(w * w + b * b), dx = q.x - x0;
        float a = (w / we) * exp(-dx * dx / (we * we)) * smoothstep(top - b, top + 0.02 + b, q.y) * step(q.y, base) * 0.5;
        col = mix(col, mix(deep, vec3(0.02, 0.08, 0.05), 0.6), a);
      }
      // 草梢上面离粒子太远（雾的预渲染要算上光晕糊开的范围）就跳过
      if (!glow || q.y < top - 0.05 - b * 3.0) continue;
      float s = clamp((base - q.y) / len, 0.0, 1.0);
      float N = 11.0, gap = len / (N - 1.0);
      // 雾后面（预渲染）粒子糊成一条：按连续的一条光带算，不一颗颗算，免得光晕比间距宽时漏算出断层
      if (b > 0.012) {
        float xs = (n + 0.5) * cw + sin(q.y * 11.0 + sway) * 0.025 * uWeedIdle * s + weedKick(s) * bend * s * s, dx = q.x - xs;
        float fj = s * (N - 1.0), ja = floor(fj);
        vec3 pc = mix(mix(pick(h1(n * 3.0 + ja)), pick(h1(n * 3.0 + ja + 1.0)), fj - ja), vec3(1.0), 0.25);
        float line = 0.0;
        for (float r3 = 0.0; r3 < 3.0; r3++) {
          float r = r3 < 0.5 ? 0.0018 + 0.0018 * s : r3 < 1.5 ? (0.0018 + 0.0018 * s) * 4.0 : 0.009 + 0.008 * s;
          float wgt = r3 < 0.5 ? 1.6 : r3 < 1.5 ? 0.25 : 0.4;
          // 一颗 glowPt 沿竖直方向积分，再除以间距：一串粒子的平均亮度
          float s2 = r * r + b * b;
          line += wgt * (r * r / s2) * exp(-dx * dx / s2 * 1.6) * sqrt(3.1416 * s2 / 1.6) / gap;
        }
        float e = 0.009 + b;
        line *= smoothstep(top - e, top + e, q.y) * smoothstep(base + e, base - e, q.y);
        col += pc * line * 0.7 * (0.35 + 0.65 * s) * uNeon;
        continue;
      }
      // 清晰的画面一颗颗算：最近的一颗前后各两颗（光晕比间距宽），超出两头的不算，不会把梢上那颗算两遍
      float j0 = floor(s * (N - 1.0) + 0.5);
      for (float dj = -2.0; dj <= 2.0; dj++) {
        float j = j0 + dj, sj = j / (N - 1.0);
        if (j < 0.0 || j > N - 1.0) continue;
        float py = base - sj * len;
        vec2 pp = vec2((n + 0.5) * cw + sin(py * 11.0 + sway) * 0.025 * uWeedIdle * sj + weedKick(sj) * bend * sj * sj, py);
        float tw = 0.45 + 0.55 * pow(0.5 + 0.5 * sin(t * (2.5 + h1(n * 9.0 + j) * 3.0) + j * 1.7 + h * 30.0), 2.0);
        float pr = 0.0018 + 0.0018 * sj;
        vec3 pc = mix(pick(h1(n * 3.0 + j)), vec3(1.0), 0.25);
        // 每颗带一圈大光晕：雾后面细小的亮点糊没了，光晕糊开还是一团团彩色的光
        vec2 d = q - pp;
        col += pc * (glowPt(d, pr, b, 0.0) * 1.6 + glowPt(d, pr * 4.0, b, 0.0) * 0.25 + glowPt(d, 0.009 + 0.008 * sj, b, 0.0) * 0.4) * tw * (0.35 + 0.65 * sj) * uNeon;
      }
    }
  }
  col += jellies(q, b);
  col = aqBubbles(col, q, b, mix(lightC, vec3(1.0), 0.4));
  // 聚光灯：从水面上方打到正在写的字上
  col += lightC * spotBeam(q, b) * 0.8;
  return col;
}
`

  // ---------- 主着色器（原版 nebbiaShaders.ts） ----------
  // 雾笺的着色器：雾的预渲染（两层模糊的窗外各画一次，写进 1/4、1/8 分辨率的两张浮点纹理）、主画面（雾、擦痕、水珠折射合成，
  // 照搬 raindrop-fx 的 compose.glsl；不支持浮点渲染目标时用自己算雾的那一版）、往楼群缓存里补画（nebbia-gl.js）、
  // 算静态噪声纹理（nebbia-gl.js），和画水珠精灵的实例化着色器。
  // 窗外选了水族箱时，雾的预渲染和主画面换成水族箱的场景（NEBBIA_AQUA_GLSL）编，见 nebbiaSceneShaders；街景的源码不变。
  // 预渲染和主画面分成两个程序、各只有一个输出：合在一个程序里（带回退分支、两个输出）时，D3D11 上链接要 3 秒、
  // 第一次画进两张纹理时还要再编 3 秒多；分开后链接不到 1 秒，第一次画不再重编（nebbia-gl.js 在后台编）。

  var NEBBIA_VS = `#version 300 es
in vec2 aPos; out vec2 vUv;
void main() { vUv = aPos * 0.5 + 0.5; vUv.y = 1.0 - vUv.y; gl_Position = vec4(aPos, 0.0, 1.0); }`

  // 窗外场景（街景或水族箱）读的 uniform，几个程序共用
  function sceneUniforms(sceneGlsl) {
    return `precision highp float;
uniform vec2 uRes, uSceneShift; uniform float uTime, uBus, uNeon;
uniform vec3 uSky0, uSky1, uLa, uLb, uLc;
// 聚光灯：光源（远处楼底）、照到玻璃上的点、光斑半径，都在 scene 坐标；uSpotI 强度
uniform vec2 uSpotSrc, uSpotSrc2, uSpotTgt; uniform float uSpotR, uSpotI;
// 窗外画哪几样（位见 nebbiaSceneGlsl.ts 的 SCN_*）
uniform int uScenery;
// 楼群缓存（nebbiaBuildingCache.ts）：三档模糊 × 远近两层，预乘颜色；uBldOn 每档画好了没有，uBldGeo 每档 (y0, y1, 横向周期)
uniform bvec3 uBldOn; uniform sampler2D uBld0, uBld1, uBld2, uBld3, uBld4, uBld5; uniform vec3 uBldGeo[3];
in vec2 vUv; layout(location = 0) out vec4 outColor;
${sceneGlsl}`
  }
  var SCENE_UNIFORMS = sceneUniforms(NEBBIA_SCENE_GLSL)
  var AQUA_UNIFORMS = sceneUniforms(NEBBIA_AQUA_GLSL)

  /**
   * 雾的预渲染：雾里的两层窗外（模糊半径 uFogB = 0.03、0.09 屏高）本来就很糊，在 1/4、1/8 分辨率下算好、主画面放大采样，
   * 结果几乎一样，却省掉每个像素两次完整的场景计算（2880×1800 下约 8 毫秒）。一层画一次（nebbia-gl.js）。
   */
  function fogFs(uniforms) {
    return `#version 300 es
${uniforms}
uniform float uFogB;
void main() {
  vec2 s0 = vUv + uSceneShift, q0 = vec2(s0.x * uRes.x / uRes.y, s0.y);
  outColor = vec4(scene(q0, uFogB), 1.0);
}`
  }
  var NEBBIA_FOG_FS = fogFs(SCENE_UNIFORMS)

  /**
   * 往楼群缓存里补画一段：缓存的一格像素对应的世界横坐标，取落在 [uFillX0, uFillX0 + 周期) 里的那一个。
   * uFillGeo 同 uBldGeo，uFillSize 是缓存的像素尺寸。只用到 building()，街景的其余部分（和缓存的采样器）编译时都去掉。
   */
  var NEBBIA_BLD_FILL_FS = `#version 300 es
${SCENE_UNIFORMS}
uniform float uFillB, uFillLayer, uFillX0; uniform vec3 uFillGeo; uniform vec2 uFillSize;
void main() {
  float span = uFillGeo.z;
  float xw = uFillX0 + fract((gl_FragCoord.x / uFillSize.x * span - uFillX0) / span) * span;
  vec4 r = building(vec2(xw, mix(uFillGeo.x, uFillGeo.y, gl_FragCoord.y / uFillSize.y)), uFillB, 0.0, uFillLayer);
  outColor = vec4(r.rgb * r.a, r.a);
}`

  // 主画面里只跟像素位置有关的三个噪声：R 擦痕边细噪声、G 起雾的大块噪声、B 闪点（静态噪声纹理里存的也是它）
  var STATIC_NOISE = `
vec3 staticNoise(vec2 px) { return vec3(vnoise(px / 6.0) * 0.6 + vnoise(px / 2.2) * 0.4, vnoise(px / 55.0 + 3.1), vnoise(px / 1.6)); }`

  /** 静态噪声纹理（nebbiaNoiseTex.ts）：改尺寸时算一次。纹理的第 j 行存 px.y = j + 0.5，主画面按 px / uRes 取样，正好落在格子中心。 */
  var NEBBIA_NOISE_FS = `#version 300 es
${SCENE_UNIFORMS}
${STATIC_NOISE}
void main() { outColor = vec4(staticNoise(gl_FragCoord.xy), 1.0); }`

  function MAIN_FS(fogTex, uniforms, dew) {
    if (uniforms === undefined) uniforms = SCENE_UNIFORMS
    if (dew === undefined) dew = false
    return `#version 300 es
#define NEBBIA_FOG_TEX ${fogTex ? 1 : 0}
${dew ? '#define NEBBIA_DEW 1\n' : ''}${uniforms === AQUA_UNIFORMS ? '#define NEBBIA_SOFT_HIGHLIGHT 1\n' : ''}${uniforms}
uniform sampler2D uMask, uDrop, uField;
#ifdef NEBBIA_DEW
// 凝露玻璃上冷凝水珠的高光（tuning.dewGlint）；细水珠折射的窗外（nebbiaFogGl.ts 预渲染的清晰的那层）
uniform float uDewGlint;
uniform sampler2D uFogSharp;
#endif
// 哈气的白气遮罩（R 形状、G 浓度，nebbiaBreath.ts）；屏上没有哈气时 uBreathOn 为假，不采样
uniform sampler2D uBreath; uniform bool uBreathOn; uniform float uBreathThick;
uniform vec2 uGlassShift; uniform float uMist, uEdge, uRefract, uGlint;
// 预渲染好的两层雾（NEBBIA_FOG_TEX 为 0 时主画面自己算：不支持浮点渲染目标时）
uniform sampler2D uFogBlur, uFogGlow;
// 静态噪声纹理（nebbiaNoiseTex.ts）：按 px 取样；uNoiseOn 为假（还没算好、画布超过纹理尺寸上限）时现算
uniform bool uNoiseOn; uniform sampler2D uNoise;
// 透明（窗外是共用背景或桌面）：不画窗外，输出预乘的透明度。雾是一层半透明的雾，擦开的地方全透明，
// 光（聚光灯、擦痕边、水珠高光）只加颜色不加不透明度，叠在后面的东西上。雾的颜色跟主题日夜：日间乳白、夜间深色
uniform bool uSeeThrough; uniform vec3 uMistTint;
${STATIC_NOISE}
void main() {
  // 颠簸：玻璃上的东西（雾、擦痕、水珠）跟车身一起晃，窗外晃得更多
  vec2 gv = vUv + uGlassShift, sv = vUv + uSceneShift;
  vec2 px = gv * uRes;
  float aspect = uRes.x / uRes.y;
  vec2 q = vec2(sv.x * aspect, sv.y);
  // 擦痕边缘：细噪声让边缘毛糙，大块噪声让重新起雾时一片片回来
  vec3 nz = uNoiseOn ? texture(uNoise, px / uRes).rgb : staticNoise(px);
  float fine = nz.r, blotch = nz.g;
  // 哈气：就是这一片的雾一下变密（更细密的一层水汽凝上来），不是另盖一层。边由大块噪声揉散成一卷卷的、
  // 细噪声让它发毛，散的时候从薄的地方先透。在白气上写的字照样擦开，水珠周围照样抹开一圈
  float breath = 0.0, melt = 0.0;
  if (uBreathOn) {
    vec3 bm = texture(uBreath, gv).rgb;
    if (bm.r > 0.003) {
      // 值噪声直接取阈值会露出横平竖直的格子：每层转一个角度、叠三层，边缘才是一卷卷的
      vec2 r1 = mat2(0.80, -0.60, 0.60, 0.80) * px, r2 = mat2(0.36, 0.93, -0.93, 0.36) * px;
      float bn = vnoise(r1 / 34.0 + 7.0) * 0.55 + vnoise(r2 / 15.0 + 2.3) * 0.3 + vnoise(px / 6.5) * 0.15;
      float bth = 0.3 + (bn - 0.5) * 0.5;
      float cover = smoothstep(bth - 0.2, bth + 0.25, bm.r);
      breath = cover * bm.g * uBreathThick;
      // 白气漫到哪，那儿被盖住的旧字跟着糊开（B 通道，只在鼓开的那一阵）
      melt = cover * bm.b;
    }
  }
  float m = texture(uMask, gv).r;
  // 被白气盖住的旧字：遮罩在周围一圈取几下（每个像素转一个角度，糊出来是颗粒的雾气，不是几道重影），字先糊开、边变软，
  // 再随 yieldFactor 淡进雾里
  if (melt > 0.01) {
    float rad = melt * 0.014 * uRes.y, a0 = hash(px) * 6.2832, acc = 0.0;
    for (int i = 0; i < 8; i++) {
      float a = a0 + float(i) * 0.7854, rr = rad * ((i & 1) == 0 ? 1.0 : 0.5);
      acc += texture(uMask, gv + vec2(cos(a), sin(a)) * rr / uRes).r;
    }
    m = mix(m, acc / 8.0, melt);
  }
  float th = 0.3 + (fine - 0.5) * 0.22 * uEdge + (blotch - 0.5) * 0.12;
  float clear = smoothstep(th - 0.05 - 0.12 * melt, th + 0.06 + 0.06 * melt, m);
  // 白气铺开后，盖掉的旧字在遮罩上留着 BREATH_GHOST（nebbiaScene.ts）那么一点：比阈值低、不透出窗外，
  // 只让那儿的白气薄一点，糊糊的留个浅浅的印子。在周围四下取样糊开；新写的字在遮罩上是满的，取到的有一下超过 0.15
  // 就是挨着新字，不薄（不然新字外面也薄一圈）
  if (breath > 0.001) {
    float gr = 0.006 * uRes.y, ga = hash(px + 17.0) * 6.2832, gm = 0.0, gx = m;
    for (int i = 0; i < 4; i++) {
      float a = ga + float(i) * 1.5708, g = texture(uMask, gv + vec2(cos(a), sin(a)) * gr / uRes).r;
      gm += g; gx = max(gx, g);
    }
    breath *= 1.0 - 0.55 * smoothstep(0.0, 0.07, gm * 0.25) * (1.0 - smoothstep(0.1, 0.15, gx));
  }
  // 雾：模糊的窗外提亮发灰，光晕散得更开，加浓淡起伏和细颗粒，下半部分略浓
  float dens = uMist * (0.82 + 0.3 * vnoise(px / 380.0 + uTime * 0.015)) * (0.9 + 0.2 * vUv.y) + breath * 0.9;
  vec3 haze = vec3(0.70, 0.74, 0.78);
  vec3 blur = vec3(0.0), glow = vec3(0.0);
  if (!uSeeThrough) {
#if NEBBIA_FOG_TEX
  // 预渲染纹理的第 0 行是 vUv.y = 1（屏幕底部），所以纵向翻一下
  vec2 fu = vec2(vUv.x, 1.0 - vUv.y);
  blur = texture(uFogBlur, fu).rgb;
  glow = texture(uFogGlow, fu).rgb;
#else
  blur = scene(q, 0.03);
  glow = scene(q, 0.09);
#endif
  }
  // 密到普通雾的范围以上（哈气）时，窗外再暗一点、乳白再多一点
  vec3 fog = blur * max(0.08, 1.0 - 0.45 * dens - 0.25 * breath) + glow * 0.9 * dens + haze * (0.2 * dens + 0.25 * breath);
  // 透明时雾的浓淡就是不透明度，颜色是 uMistTint
  float alpha = 1.0;
  if (uSeeThrough) {
    // 深色的雾叠在暗桌面上不显，比白雾浓一点
    alpha = clamp((0.62 * dens + 0.3 * breath) * mix(1.3, 1.0, dot(uMistTint, vec3(0.333))), 0.0, 0.92);
    fog = uMistTint * alpha;
  }
  // 透明时颗粒乘不透明度：雾很淡的地方不在后面的东西上撒亮点
  fog += (hash(px) - 0.5) * 0.025 * alpha;
  // 聚光灯照到玻璃上：雾里的小水滴把光散开，字周围一圈雾被照成强调色
  vec2 sd = q - uSpotTgt;
  fog += uLa * uSpotI * exp(-dot(sd, sd) / (uSpotR * uSpotR * 2.2)) * (0.18 + 0.4 * dens);
  fog += smoothstep(0.78, 0.98, nz.b) * 0.05 * dens;
  // 水珠纹理：擦痕边 / 下淌的水珠 rd，雾上的凝结水珠 fd（擦开的地方没有）
  vec4 rd = texture(uDrop, gv);
  vec4 fd = texture(uField, gv) * (1.0 - clear);
  // 和 raindrop-fx 一样，水珠周围一圈的雾也被抹掉
  clear = max(clear, smoothstep(0.93, 1.0, rd.a));
  vec3 col = fog;
  if (clear > 0.001) {
    // 擦开的地方：清晰的窗外，留一层很薄的水膜
    vec3 wiped = (uSeeThrough ? vec3(0.0) : scene(q, 0.0012) * 1.05) + haze * 0.02 * dens;
    float rim = clear * (1.0 - clear) * 4.0;
    col = mix(fog, wiped, clear) + rim * haze * 0.16 * dens;
    if (uSeeThrough) alpha = mix(alpha, 0.02 * dens, clear) + rim * 0.16 * dens;
  }
  // 合成方式照搬 raindrop-fx 的 compose.glsl：阈值成形、按法线折射清晰的窗外、按光照明暗
  vec4 comp = vec4(rd.rgb + fd.rgb - 2.0 * rd.rgb * fd.rgb, max(rd.a, fd.a));
  float dmask = smoothstep(0.96, 0.99, comp.a);
  if (dmask > 0.001) {
    vec2 nn = comp.rg - 0.5;
    vec2 ruv = sv + vec2(-nn.x, nn.y) * (comp.b * 0.6 + 0.4) * uRefract;
    // 雾笺 demo 用的是轻度模糊的背景、漫反射 0.2–0.5、高光指数 48
    vec3 lens;
#if defined(NEBBIA_DEW) && NEBBIA_FOG_TEX
    // 凝露的细水珠又密又小，每个像素重算一遍窗外太贵：读预渲染好的同样模糊（0.006）的窗外，低分辨率下放大看不出差别。
    // 擦痕边的水珠（rd 占上风）照旧现算
    if (!uSeeThrough && fd.a > rd.a) lens = texture(uFogSharp, vec2(ruv.x - uSceneShift.x, 1.0 - ruv.y + uSceneShift.y)).rgb;
    else
#endif
    lens = scene(vec2(ruv.x * aspect, ruv.y), 0.006);
    vec3 normal = normalize(vec3(nn * 2.0, 1.0));
    vec3 lightDir = normalize(vec3(-1.0, 1.0, 2.0));
    float lambert = clamp(dot(lightDir, normal), 0.0, 1.0);
    float spec = pow(max(dot(normal, normalize(lightDir + vec3(0.0, 0.0, 1.0))), 0.0), 48.0);
    lens += (lambert - 0.8) * vec3(0.3, 0.3, 0.32) + spec * vec3(0.3, 0.3, 0.33) * uGlint;
    if (uSeeThrough) {
      // 和 raindrop-fx 一样，水珠是一颗透镜，里面是折射过来的背景。透明时拿不到窗后面的画面，折射的还是雾笺自己的
      // 窗外（选了水族箱折射水族箱，别的折射雨夜街景）。白雾时水珠不透明：街景比雾暗，和透出后面的字一样是暗的；
      // 深色雾时字透出的后面比雾亮，水珠也要以透出后面为主：街景留一半不到，边上一圈折射的暗边
      float dark = 1.0 - dot(uMistTint, vec3(0.333));
      float rimA = (1.0 - smoothstep(0.975, 0.995, comp.a)) * 0.21;
      float da = mix(1.0, 0.47 + rimA, dark);
      lens = max(lens, vec3(0.0)) * mix(1.0, 0.47, dark);
      alpha = mix(alpha, da, dmask);
    } else {
      // 车厢里的灯照在水珠表面：比纯透过去的窗外亮一点，不会在灰白的雾上显成黑点
      lens = max(lens, fog * 0.55) + haze * 0.08 * dens;
#ifdef NEBBIA_DEW
      // 凝露玻璃上的细小冷凝水珠（nebbiaCondensation.ts）：后面暗（水族箱的水、夜里的街）时照常画会像一粒粒脏点；
      // 按挂在玻璃上的水珠画，比雾亮一点、带一点高光。擦痕边的水珠（rd 占上风的地方）照旧
      float fine = step(rd.a, fd.a);
      lens = mix(lens, max(lens * 1.15, fog * (1.0 + 0.051 * uDewGlint)) + (spec * 0.544 + lambert * 0.068) * dens * uDewGlint, fine);
#endif
    }
    col = mix(col, lens, dmask);
  }
#ifdef NEBBIA_SOFT_HIGHLIGHT
  // 水族箱：聚光灯、水母、凝露的水珠叠在同一处会加过 1，烧成一块白。最亮的那个通道过了 0.75 以后
  // 按指数慢慢逼近 1，三个通道同比例压，颜色不变；0.75 以下不动
  if (!uSeeThrough) {
    float pk = max(col.r, max(col.g, col.b));
    if (pk > 0.75) col *= (0.75 + 0.25 * (1.0 - exp((0.75 - pk) / 0.25))) / pk;
  }
#endif
  outColor = uSeeThrough ? vec4(max(col, 0.0), alpha) : vec4(col, 1.0);
}`
  }

  /** 主画面：用预渲染的雾。 */
  var NEBBIA_MAIN_FS = MAIN_FS(true)
  /** 主画面：雾自己算（不支持浮点渲染目标时）。 */
  var NEBBIA_MAIN_FALLBACK_FS = MAIN_FS(false)

  /**
   * 窗外场景和玻璃用的雾的预渲染和主画面（自己算雾的那一版也在）：街景配雨窗就是上面几个，水族箱换场景 GLSL 另拼一份；
   * 凝露玻璃的主画面多编一段冷凝水珠的画法（NEBBIA_DEW），雾的预渲染不看玻璃。
   */
  function nebbiaSceneShaders(scene, glass) {
    if (glass === undefined) glass = 'rain'
    var dew = glass === 'dew'
    if (scene === 'aquarium') return { fog: fogFs(AQUA_UNIFORMS), main: MAIN_FS(true, AQUA_UNIFORMS, dew), mainFallback: MAIN_FS(false, AQUA_UNIFORMS, dew) }
    if (dew) return { fog: NEBBIA_FOG_FS, main: MAIN_FS(true, SCENE_UNIFORMS, true), mainFallback: MAIN_FS(false, SCENE_UNIFORMS, true) }
    return { fog: NEBBIA_FOG_FS, main: NEBBIA_MAIN_FS, mainFallback: NEBBIA_MAIN_FALLBACK_FS }
  }

  // 水珠精灵：实例化四边形画进水珠纹理，混合方式同 raindrop-fx 的 "smoother"
  var NEBBIA_SPRITE_VS = `#version 300 es
in vec2 aCorner; in vec4 aRect; in vec2 aParam;
uniform vec2 uView;
out vec2 vUV; out float vSize; out float vAlpha;
void main() {
  vec2 p = aRect.xy + (aCorner - 0.5) * aRect.zw;
  vUV = aCorner; vSize = aParam.x; vAlpha = aParam.y;
  gl_Position = vec4(p.x / uView.x * 2.0 - 1.0, p.y / uView.y * 2.0 - 1.0, 0.0, 1.0);
}`

  var NEBBIA_SPRITE_FS = `#version 300 es
precision mediump float;
uniform sampler2D uSprite;
in vec2 vUV; in float vSize; in float vAlpha; out vec4 o;
void main() {
  vec4 c = texture(uSprite, vUV);
  c.a *= vAlpha;
  o = vec4(c.rg * c.a, vSize * c.a, c.a);
}`

  window.FoliaNebbiaGlsl = {
    NEBBIA_SCENE_COMMON_GLSL: NEBBIA_SCENE_COMMON_GLSL,
    NEBBIA_SPOT_GLSL: NEBBIA_SPOT_GLSL,
    NEBBIA_JELLY_GLSL: NEBBIA_JELLY_GLSL,
    NEBBIA_BUBBLE_GLSL: NEBBIA_BUBBLE_GLSL,
    NEBBIA_FIRE_GLSL: NEBBIA_FIRE_GLSL,
    NEBBIA_SCENE_GLSL: NEBBIA_SCENE_GLSL,
    NEBBIA_AQUA_GLSL: NEBBIA_AQUA_GLSL,
    NEBBIA_VS: NEBBIA_VS,
    SCENE_UNIFORMS: SCENE_UNIFORMS,
    AQUA_UNIFORMS: AQUA_UNIFORMS,
    NEBBIA_FOG_FS: NEBBIA_FOG_FS,
    NEBBIA_BLD_FILL_FS: NEBBIA_BLD_FILL_FS,
    NEBBIA_NOISE_FS: NEBBIA_NOISE_FS,
    NEBBIA_MAIN_FS: NEBBIA_MAIN_FS,
    NEBBIA_MAIN_FALLBACK_FS: NEBBIA_MAIN_FALLBACK_FS,
    NEBBIA_SPRITE_VS: NEBBIA_SPRITE_VS,
    NEBBIA_SPRITE_FS: NEBBIA_SPRITE_FS,
    nebbiaSceneShaders: nebbiaSceneShaders
  }
})()
