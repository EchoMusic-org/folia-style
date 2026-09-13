// 星野背景：移植自 folia-major src/components/visualizer/backgrounds/sora/SoraBackground.tsx
// twgl.js + GL_POINTS 星空粒子：150 颗粒子横向流动、闪烁，10% 概率点亮色，预乘 alpha 混合。
// GLSL 与原版逐字一致。
(function () {
  'use strict'

  var PARTICLE_COUNT = 150

  var VERTEX_SHADER = `
attribute float a_index;
uniform vec2 u_resolution;
uniform float u_time;
varying float v_color_type;
varying float v_intensity_base;

float hash2(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

void main() {
  float seed = a_index * 123.456;
  
  float speed_rand = hash2(vec2(seed, 1.1));
  float size_rand = hash2(vec2(seed, 2.2));
  float y_rand = hash2(vec2(seed, 3.3));
  float x_rand = hash2(vec2(seed, 4.4));
  float blink_rand = hash2(vec2(seed, 5.5));
  float color_type_rand = hash2(vec2(seed, 6.6));

  float aspect = u_resolution.x / u_resolution.y;
  float speed = 0.008 + speed_rand * 0.024;
  float size = 0.0006 + 0.0032 * pow(size_rand, 3.8);
  
  float y = -0.45 + y_rand * 0.9;
  
  float margin = 0.05;
  float width = aspect + margin * 2.0;
  float x = fract(x_rand + u_time * speed);
  x = x * width - (aspect * 0.5 + margin);
  
  float wave = sin(u_time * 0.3 + y_rand * 6.283) * 0.005;
  
  float ndc_x = x / (aspect * 0.5);
  float ndc_y = (y + wave) / 0.5;
  
  gl_Position = vec4(ndc_x, ndc_y, 0.0, 1.0);
  
  // Point size in pixels. 
  float pointSize = size * u_resolution.y * 3.5;
  gl_PointSize = max(2.0, pointSize);
  
  float blink = 0.3 + 0.7 * sin(u_time * (1.0 + blink_rand * 2.5) + x_rand * 6.283);
  v_intensity_base = blink;
  v_color_type = color_type_rand;
}
`

  var FRAGMENT_SHADER = `
precision mediump float;
uniform vec3 u_particle_color;
uniform vec3 u_particle_accent_color;

varying float v_color_type;
varying float v_intensity_base;

void main() {
  vec2 pc = gl_PointCoord - 0.5;
  float dist = length(pc);
  
  float alpha = smoothstep(0.5, 0.1, dist) * v_intensity_base;
  if (alpha < 0.01) discard;
  
  vec3 baseColor = v_color_type > 0.90 ? u_particle_accent_color : u_particle_color;
  
  // Pre-multiplied alpha blending
  gl_FragColor = vec4(baseColor * alpha, alpha);
}
`

  function create() {
    var host = null
    var root = null
    var canvas = null
    var gl = null
    var programInfo = null
    var bufferInfo = null
    var rafId = null
    var time = 0
    var lastTimestamp = performance.now()
    var paused = false

    var theme = null
    var particleColor = [1, 1, 1]
    var particleAccentColor = [1, 1, 1]

    function mount(hostEl) {
      host = hostEl

      root = document.createElement('div')
      root.style.cssText = 'position:absolute;inset:0;overflow:hidden;pointer-events:none;z-index:0'

      canvas = document.createElement('canvas')
      canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;pointer-events:none;will-change:transform;transform:translateZ(0)'
      root.appendChild(canvas)
      host.appendChild(root)

      initGL()
      rafId = requestAnimationFrame(render)
    }

    function initGL() {
      var twgl = window.twgl
      if (!twgl || !canvas) return

      gl = twgl.getContext(canvas, { alpha: false, depth: false, antialias: false })
      if (!gl) return

      programInfo = twgl.createProgramInfo(gl, [VERTEX_SHADER, FRAGMENT_SHADER], function (err) {
        console.error('[SoraBackground] twgl 程序错误:', err)
      })
      if (!programInfo) return

      var indices = new Float32Array(PARTICLE_COUNT)
      for (var i = 0; i < PARTICLE_COUNT; i += 1) indices[i] = i

      var arrays = { a_index: { numComponents: 1, data: indices } }
      bufferInfo = twgl.createBufferInfoFromArrays(gl, arrays)
    }

    function applyThemeColors() {
      if (!theme) return
      var ColorMix = window.FoliaColorMix
      var primary = ColorMix.parseColorChannels(theme.primaryColor) || { r: 255, g: 255, b: 255 }
      particleColor = [primary.r / 255, primary.g / 255, primary.b / 255]
      var accent = ColorMix.parseColorChannels(theme.accentColor) || primary
      particleAccentColor = [accent.r / 255, accent.g / 255, accent.b / 255]
    }

    function render(now) {
      if (!gl || !programInfo) return

      var twgl = window.twgl
      if (!paused) {
        var delta = (now - lastTimestamp) / 1000
        time += delta
      }
      lastTimestamp = now

      twgl.resizeCanvasToDisplaySize(canvas)
      gl.viewport(0, 0, gl.canvas.width, gl.canvas.height)

      // 黑底（原版深色模式 bgColor [0,0,0]；本插件歌词页恒深色）
      gl.clearColor(0.0, 0.0, 0.0, 1.0)
      gl.clear(gl.COLOR_BUFFER_BIT)

      gl.enable(gl.BLEND)
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)

      var uniforms = {
        u_resolution: [gl.canvas.width, gl.canvas.height],
        u_time: time,
        u_particle_color: particleColor,
        u_particle_accent_color: particleAccentColor
      }

      gl.useProgram(programInfo.program)
      twgl.setBuffersAndAttributes(gl, programInfo, bufferInfo)
      twgl.setUniforms(programInfo, uniforms)

      twgl.drawBufferInfo(gl, bufferInfo, gl.POINTS)

      rafId = requestAnimationFrame(render)
    }

    function setTheme(newTheme) {
      theme = newTheme
      applyThemeColors()
    }

    function setCoverUrl() { /* 星野不使用封面 */ }

    function tick(frameState) {
      paused = frameState.isPlaying === false
    }

    function destroy() {
      if (rafId) cancelAnimationFrame(rafId)
      rafId = null
      if (gl && programInfo) {
        gl.deleteProgram(programInfo.program)
        if (bufferInfo && bufferInfo.attribs && bufferInfo.attribs.a_index && bufferInfo.attribs.a_index.buffer) {
          gl.deleteBuffer(bufferInfo.attribs.a_index.buffer)
        }
      }
      programInfo = null
      bufferInfo = null
      gl = null
      if (root) { root.remove(); root = null }
      canvas = null
      host = null
    }

    return {
      id: 'sora',
      mount: mount,
      setTheme: setTheme,
      setCoverUrl: setCoverUrl,
      tick: tick,
      destroy: destroy
    }
  }

  window.FoliaBgSora = { create: create }
})()
