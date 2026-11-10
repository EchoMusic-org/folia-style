// 设置列控件套件（vanilla DOM，复刻上游 settings kit 视觉与语义）：
// 滑条 draft-on-input / save-on-change（松手才 commit，对齐上游 useTuningDrafts gate）
// schema 渲染器：按 FoliaTunings schema（分组/键/控件类型/visibleWhen）生成整页控件
(function () {
  'use strict'

  function el(tag, className, text) {
    var node = document.createElement(tag)
    if (className) node.className = className
    if (text !== undefined && text !== null) node.textContent = String(text)
    return node
  }

  function getPath(obj, path) {
    var parts = String(path).split('.')
    var cur = obj
    for (var i = 0; i < parts.length; i += 1) {
      if (cur == null || typeof cur !== 'object') return undefined
      cur = cur[parts[i]]
    }
    return cur
  }

  // 数值显示格式：unit x → x1.20 / percent → 75% / px → 24px / deg → 45° / 无 → 原值
  function formatValue(value, spec) {
    var v = Number(value)
    if (!Number.isFinite(v)) return String(value)
    var unit = spec && spec.unit
    if (unit === 'percent') return Math.round(v * 100) + '%'
    if (unit === 'x') return v.toFixed(2) + 'x'
    if (unit === 'px') return (Number.isFinite(v) ? (Math.round(v * 10) / 10) : v) + 'px'
    if (unit === 'deg') return Math.round(v) + '°'
    return spec && spec.integer ? String(Math.round(v)) : (Math.round(v * 100) / 100).toString()
  }

  // ===== 滑条：input 拖动只回调 onDraft；change（松手）回调 onCommit =====
  function slider(opts) {
    var root = el('div', 'fsw-slider')
    var input = document.createElement('input')
    input.type = 'range'
    input.min = String(opts.min)
    input.max = String(opts.max)
    input.step = String(opts.step)
    input.value = String(opts.value)
    var valueEl = el('span', 'fsw-slider-value', formatValue(opts.value, opts))
    input.addEventListener('input', function () {
      var v = Number(input.value)
      valueEl.textContent = formatValue(v, opts)
      if (opts.onDraft) opts.onDraft(v)
    })
    input.addEventListener('change', function () {
      var v = Number(input.value)
      if (opts.onCommit) opts.onCommit(v)
    })
    root.appendChild(input)
    root.appendChild(valueEl)
    return {
      root: root,
      input: input,
      setValue: function (v) {
        input.value = String(v)
        valueEl.textContent = formatValue(v, opts)
      }
    }
  }

  // ===== 开关：invert 时展示值与存储值反相（如 fume 的 disableGeometricBackground） =====
  function switchControl(opts) {
    var btn = el('button', 'fsw-switch')
    btn.type = 'button'
    function render(value) {
      var shown = opts.invert ? !value : value
      btn.classList.toggle('checked', Boolean(shown))
    }
    render(opts.value)
    btn.addEventListener('click', function () {
      var shown = opts.invert ? !opts.value : opts.value
      var next = !shown
      opts.value = opts.invert ? !next : next
      render(opts.value)
      if (opts.onChange) opts.onChange(opts.value)
    })
    return {
      root: btn,
      setValue: function (v) {
        opts.value = v
        render(v)
      }
    }
  }

  // ===== 分段 =====
  function segmented(opts) {
    var root = el('div', 'fsw-seg')
    var buttons = []
    opts.options.forEach(function (option) {
      var btn = el('button', 'fsw-seg-btn', option.label)
      btn.type = 'button'
      btn.addEventListener('click', function () {
        if (opts.value === option.value) return
        opts.value = option.value
        render(opts.value)
        if (opts.onChange) opts.onChange(option.value)
      })
      buttons.push({ btn: btn, value: option.value })
      root.appendChild(btn)
    })
    function render(value) {
      buttons.forEach(function (item) {
        item.btn.classList.toggle('active', item.value === value)
      })
    }
    render(opts.value)
    return {
      root: root,
      setValue: function (v) {
        opts.value = v
        render(v)
      }
    }
  }

  // ===== 网格选项（picture）：按数量自适应列数 =====
  function picture(opts) {
    var count = opts.options.length
    var cols = count <= 2 ? 2 : (count === 3 ? 3 : (count === 4 ? 4 : 5))
    var root = el('div', 'fsw-picture cols-' + cols)
    var buttons = []
    opts.options.forEach(function (option) {
      var btn = el('button', 'fsw-picture-btn', option.label)
      btn.type = 'button'
      btn.addEventListener('click', function () {
        if (opts.value === option.value) return
        opts.value = option.value
        render(opts.value)
        if (opts.onChange) opts.onChange(option.value)
      })
      buttons.push({ btn: btn, value: option.value })
      root.appendChild(btn)
    })
    function render(value) {
      buttons.forEach(function (item) {
        item.btn.classList.toggle('active', item.value === value)
      })
    }
    render(opts.value)
    return {
      root: root,
      setValue: function (v) {
        opts.value = v
        render(v)
      }
    }
  }

  // ===== 颜色 =====
  function colorInput(opts) {
    var input = el('input', 'fsw-color')
    input.type = 'color'
    input.value = opts.value
    input.addEventListener('change', function () {
      if (opts.onChange) opts.onChange(input.value)
    })
    input.addEventListener('input', function () {
      if (opts.onDraft) opts.onDraft(input.value)
    })
    return {
      root: input,
      setValue: function (v) { input.value = v }
    }
  }

  // ===== 文本输入：change/Enter 提交 =====
  function textInput(opts) {
    var root = el('div')
    root.style.cssText = 'flex:1;min-width:0;display:flex;gap:6px;align-items:center'
    var input = el('input', 'fsw-input')
    input.type = 'text'
    input.value = opts.value || ''
    if (opts.placeholder) input.placeholder = opts.placeholder
    input.spellcheck = false
    function commit() {
      if (opts.onCommit) opts.onCommit(input.value)
    }
    input.addEventListener('change', commit)
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); commit() }
    })
    root.appendChild(input)
    if (opts.resetLabel !== undefined) {
      var reset = el('button', 'fsw-mini-btn', opts.resetLabel || '↺')
      reset.type = 'button'
      reset.title = '恢复默认'
      reset.addEventListener('click', function () {
        input.value = opts.defaultValue || ''
        commit()
      })
      root.appendChild(reset)
    }
    return {
      root: root,
      input: input,
      setValue: function (v) { input.value = v }
    }
  }

  // ===== 行 =====
  function row(label, controlRoot, opts) {
    opts = opts || {}
    var root = el('div', 'fsw-row' + (opts.sub ? ' sub' : ''))
    var labelWrap = el('div')
    labelWrap.style.cssText = 'flex-shrink:0;max-width:44%;min-width:0'
    var labelEl = el('span', 'fsw-row-label', label)
    labelWrap.appendChild(labelEl)
    if (opts.hint) {
      labelWrap.appendChild(el('div', 'fsw-row-hint', opts.hint))
    }
    root.appendChild(labelWrap)
    var control = el('div', 'fsw-row-control')
    control.appendChild(controlRoot)
    root.appendChild(control)
    return root
  }

  // ===== 分组标题 =====
  function groupTitle(text) {
    return el('div', 'fsw-group-title', text)
  }


  // schema: { groups:[{ title, keys:[spec] }] }，spec 来自 FoliaTunings
  // get(key) 读当前值；patch(key, value, commit) 写入（draft 或 commit）
  // 返回 { root, refresh }：refresh 重读全部控件值（外部状态变化时同步）
  function renderSchema(schema, api) {
    var root = el('div')
    var controls = []   // [{spec, control, rowEl, visibleWhen, invert}]
    var patchApi = {
      get: api.get,
      patch: api.patch
    }
    schema.groups.forEach(function (group) {
      root.appendChild(groupTitle(group.title))
      var card = el('div', 'fsw-card')
      group.keys.forEach(function (spec) {
        var control = null
        if (spec.type === 'slider') {
          control = slider({
            min: spec.min, max: spec.max, step: spec.step, integer: spec.integer, unit: spec.unit,
            value: getPath(api.get(), spec.key),
            onDraft: function (v) { api.patch(spec.key, v, false) },
            onCommit: function (v) { api.patch(spec.key, v, true) }
          })
        } else if (spec.type === 'switch') {
          control = switchControl({
            value: getPath(api.get(), spec.key), invert: spec.invert,
            onChange: function (v) { api.patch(spec.key, v, true) }
          })
        } else if (spec.type === 'segmented') {
          control = segmented({
            options: spec.options, value: getPath(api.get(), spec.key),
            onChange: function (v) { api.patch(spec.key, v, true) }
          })
        } else if (spec.type === 'picture') {
          control = picture({
            options: spec.options, value: getPath(api.get(), spec.key),
            onChange: function (v) { api.patch(spec.key, v, true) }
          })
        } else if (spec.type === 'color') {
          control = colorInput({
            value: getPath(api.get(), spec.key),
            onDraft: function (v) { api.patch(spec.key, v, false) },
            onChange: function (v) { api.patch(spec.key, v, true) }
          })
        }        if (!control) return
        var rowEl = row(spec.label, control.root, { sub: spec.sub })
        card.appendChild(rowEl)
        controls.push({ spec: spec, control: control, rowEl: rowEl })
      })
      root.appendChild(card)
    })

    function refreshVisible() {
      var current = api.get()
      controls.forEach(function (item) {
        var vw = item.spec.visibleWhen
        var show = true
        if (vw) show = getPath(current, vw.key) === vw.eq
        item.rowEl.style.display = show ? '' : 'none'
        // 值同步（外部 reset 等）
        var v = getPath(current, item.spec.key)
        if (item.control.setValue && v !== undefined) item.control.setValue(v)
      })
    }
    refreshVisible()
    return { root: root, refresh: refreshVisible }
  }

  window.FoliaPanelKit = {
    el: el,
    row: row,
    groupTitle: groupTitle,
    slider: slider,
    switchControl: switchControl,
    segmented: segmented,
    picture: picture,
    colorInput: colorInput,
    textInput: textInput,
    renderSchema: renderSchema,
    formatValue: formatValue
  }
})()
