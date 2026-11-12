// 样式参数（tuning）数据层：schema 定义 + 读写 + 归一化 + 持久化。
// schema 移植自 folia-major 各样式 tuning.ts / *SettingsPanel.tsx（键、默认值、范围、中文 label），
// 仅收录插件实际消费的键（未消费的键开了无效，不列入；差异见各模式注释与插件 CLAUDE.md）。
// 存储键：模式 folia-tuning-<modeId>、背景 folia-bgtuning-<bgId>、外观 folia-appearance、随机池 folia-randomPool。
// 模式 create(tuning) / 背景 create(config) 经 resolveModeTuning / resolveBgTuning 得到完整归一化对象。
(function () {
  'use strict'

  var MODE_PREFIX = 'folia-tuning-'
  var BG_PREFIX = 'folia-bgtuning-'

  // ===== 控件类型 =====
  // slider: {min,max,step,integer?,unit?('x'|'percent'|'px'|'deg')}  switch: 布尔
  // segmented: {options:[{value,label}]}  picture: 网格选项（同 segmented，渲染为卡片网格）  color: 颜色字符串
  // sub: 子行缩进（依赖 visibleWhen 的从属项）
  // invert: 开关反相展示（存值与开关语义相反，如 fume 的 disableGeometricBackground）
  // visibleWhen: {key, eq} 当前值等于 eq 时才显示（key 支持点路径）

  // ===== 模式 schema =====
  var MODE_SCHEMAS = {
    classic: {
      label: '流光',
      groups: [
        { title: '流光参数', keys: [
          { key: 'wordSpacing', label: '单词间距', type: 'slider', min: 0, max: 2, step: 0.05, unit: 'x', default: 0.7 }
        ]}
      ]
    },
    cadenza: {
      label: '心象',
      // 上游面板无调参项；以下为插件布局管线实际消费的键（插件扩展，范围自定义）
      groups: [
        { title: '心象参数', keys: [
          { key: 'fontScale', label: '字体缩放', type: 'slider', min: 0.7, max: 1.5, step: 0.05, unit: 'x', default: 1.12 },
          { key: 'widthRatio', label: '行宽占比', type: 'slider', min: 0.5, max: 0.9, step: 0.01, unit: 'x', default: 0.72 },
          { key: 'motionAmount', label: '动势强度', type: 'slider', min: 0, max: 2, step: 0.05, unit: 'x', default: 1 },
          { key: 'glowIntensity', label: '辉光强度', type: 'slider', min: 0, max: 2, step: 0.05, unit: 'x', default: 1 }
        ]}
      ]
    },
    partita: {
      label: '云阶',
      groups: [
        { title: '云阶参数', keys: [
          { key: 'showGuideLines', label: '引导线', type: 'switch', default: true },
          { key: 'useSemanticLayout', label: '语义排列', type: 'switch', default: true },
          { key: 'staggerMin', label: '错位最小值', type: 'slider', min: 0, max: 180, step: 5, unit: 'px', default: 20 },
          { key: 'staggerMax', label: '错位最大值', type: 'slider', min: 0, max: 180, step: 5, unit: 'px', default: 100 }
        ]}
      ]
    },
    fume: {
      label: '浮名',
      groups: [
        { title: '浮名参数', keys: [
          { key: 'hidePrintSymbols', label: '隐藏打印方块', type: 'switch', default: false },
          // 开关展示为"通用几何图形"，存值为其反相（disable 前缀）
          { key: 'disableGeometricBackground', label: '通用几何图形', type: 'switch', invert: true, default: true },
          { key: 'backgroundObjectOpacity', label: '世界背景物体透明度', type: 'slider', min: 0, max: 1, step: 0.05, unit: 'percent', default: 0.5 },
          { key: 'textHoldRatio', label: '文字停留比例', type: 'slider', min: 0, max: 1, step: 0.05, unit: 'percent', default: 1 },
          { key: 'cameraSpeed', label: '摄影机移动速度', type: 'slider', min: 0.55, max: 1.85, step: 0.05, unit: 'x', default: 1 },
          { key: 'cameraTrackingMode', label: '摄影机追焦方式', type: 'segmented', options: [{ value: 'stepped', label: '定格' }, { value: 'smooth', label: '平滑' }], default: 'smooth' },
          { key: 'glowIntensity', label: '当前句辉光强度', type: 'slider', min: 0, max: 1.8, step: 0.05, unit: 'x', default: 1 },
          { key: 'heroScale', label: '大标题比例', type: 'slider', min: 0.82, max: 1.32, step: 0.02, unit: 'x', default: 1 }
        ]}
      ]
    },
    tilt: {
      label: '倾诉',
      groups: [
        { title: '倾诉参数', keys: [
          { key: 'colorScheme', label: '配色方案', type: 'picture', options: [
            { value: 'default', label: '双色 1' }, { value: 'swap', label: '双色 2' },
            { value: 'accentAll', label: '单色 1' }, { value: 'primaryAll', label: '单色 2' }
          ], default: 'default' },
          { key: 'splitProbability', label: '分行概率', type: 'slider', min: 0, max: 1, step: 0.05, unit: 'percent', default: 0.75 },
          { key: 'tiltStyleProbability', label: '斜体强调概率', type: 'slider', min: 0, max: 1, step: 0.05, unit: 'percent', default: 0.35 }
        ]}
      ]
    },
    monet: {
      label: '莫奈',
      // portraitSource/portraitOffsetX：插件消费但未开放 UI（portraitOffsetX 上游为舞台拖拽回写）
      extraKeys: [
        { key: 'portraitSource', type: 'segmented', options: [{ value: 'cover', label: '封面' }], default: 'cover' },
        { key: 'portraitOffsetX', type: 'slider', min: -150, max: 0, step: 1, default: 0 }
      ],
      groups: [
        { title: '歌词样式', keys: [
          { key: 'fontScale', label: '字体缩放', type: 'slider', min: 0.7, max: 1.5, step: 0.05, unit: 'x', default: 1.2 },
          { key: 'keywordColoringEnabled', label: '关键字着色', type: 'switch', default: true },
          { key: 'showDescription', label: '显示歌曲描述', type: 'switch', default: true }
        ]},
        { title: '肖像', keys: [
          { key: 'portraitStyle', label: '封面形状', type: 'picture', options: [
            { value: 'rectangular', label: '长方形' }, { value: 'square', label: '正方形' }
          ], default: 'square' },
          { key: 'showPortraitDragHanger', label: '拖拽调整按钮', type: 'switch', default: true }
        ]},
        { title: '频谱样式', keys: [
          { key: 'showAudioVisualization', label: '音频图案', type: 'switch', default: true },
          { key: 'audioStyle', label: '频谱样式', type: 'picture', options: [
            { value: 'bar', label: '柱状' }, { value: 'line', label: '线条' }
          ], default: 'bar', visibleWhen: { key: 'showAudioVisualization', eq: true } }
        ]}
      ]
    },
    sonnet: {
      label: '商籁',
      groups: [
        { title: '动态与构图', keys: [
          { key: 'cameraIntensity', label: '镜头运动强度', type: 'slider', min: 0, max: 2, step: 0.05, unit: 'x', default: 1 },
          { key: 'typographyMotion', label: '文字动势', type: 'slider', min: 0, max: 2, step: 0.05, unit: 'x', default: 1 },
          { key: 'mgDensity', label: '背景短线密度', type: 'slider', min: 0, max: 2, step: 0.05, unit: 'x', default: 1 }
        ]},
        { title: '显示内容', keys: [
          { key: 'outerFrameMode', label: '外层边框', type: 'segmented', options: [
            { value: 'none', label: '完全隐藏' }, { value: 'frame', label: '仅显示框架' }, { value: 'full', label: '完全显示' }
          ], default: 'full' },
          { key: 'showOnlyText', label: '仅显示文字', type: 'switch', default: false },
          { key: 'showGuide', label: '轨迹线', type: 'switch', default: true },
          { key: 'showBackgroundMg', label: '主场景', type: 'switch', default: true },
          { key: 'showFixedGeo', label: '文字浮标', type: 'switch', default: true },
          { key: 'showGiantDecorativeText', label: '巨型装饰镂空文字', type: 'switch', default: true },
          { key: 'showBackgroundDecor', label: '背景装饰', type: 'switch', default: true },
          { key: 'enableTransitions', label: '场景转场', type: 'switch', default: true }
        ]},
        { title: '后处理', keys: [
          { key: 'postProcessEnabled', label: '整体后处理滤镜', type: 'switch', default: false },
          { key: 'postProcessGrain', label: '胶片颗粒', type: 'slider', min: 0, max: 1, step: 0.05, unit: 'percent', default: 0.2, sub: true, visibleWhen: { key: 'postProcessEnabled', eq: true } },
          { key: 'postProcessContrast', label: '对比度增强', type: 'slider', min: 0, max: 1, step: 0.05, unit: 'percent', default: 0, sub: true, visibleWhen: { key: 'postProcessEnabled', eq: true } },
          { key: 'postProcessRgbShift', label: 'RGB 色差', type: 'slider', min: 0, max: 1, step: 0.05, unit: 'percent', default: 0, sub: true, visibleWhen: { key: 'postProcessEnabled', eq: true } },
          { key: 'postProcessHalftone', label: '半调网点', type: 'slider', min: 0, max: 1, step: 0.05, unit: 'percent', default: 0, sub: true, visibleWhen: { key: 'postProcessEnabled', eq: true } },
          { key: 'postProcessLensDistortion', label: '透镜扭曲', type: 'slider', min: 0, max: 2, step: 0.05, unit: 'x', default: 0.3, sub: true, visibleWhen: { key: 'postProcessEnabled', eq: true } },
          { key: 'postProcessLensDispersion', label: '透镜色散', type: 'slider', min: 0, max: 1, step: 0.05, unit: 'percent', default: 0.6, sub: true, visibleWhen: { key: 'postProcessEnabled', eq: true } },
          { key: 'postProcessVignette', label: '暗角', type: 'slider', min: 0, max: 2, step: 0.05, unit: 'x', default: 0.85, sub: true, visibleWhen: { key: 'postProcessEnabled', eq: true } }
        ]},
        { title: '渲染质量', keys: [
          { key: 'textureResolution', label: '纹理分辨率', type: 'slider', min: 0.5, max: 4, step: 0.25, unit: 'x', default: 1.5 }
        ]}
      ]
    },
    tempera: {
      label: '凝彩',
      // 上游「画布图片」（layerImages 上传池）涉及文件资产管理，插件暂不开放 UI，
      // 但 tempera-runtime 直接消费这三个键，必须随 tuning 完整下发（extraKeys 仅归一化不渲染）
      extraKeys: [
        { key: 'layerImages', type: 'array', default: [] },
        { key: 'layerImageDepth', type: 'segmented', options: [{ value: 'back', label: '歌词之后' }, { value: 'front', label: '歌词之前' }], default: 'back' },
        { key: 'layerImageFrequency', type: 'slider', min: 0, max: 1, step: 0.05, default: 0.6 }
      ],
      groups: [
        { title: '动态与调色', keys: [
          { key: 'cameraIntensity', label: '镜头运动强度', type: 'slider', min: 0, max: 2, step: 0.05, unit: 'x', default: 1 },
          { key: 'glyphMotion', label: '逐字动势', type: 'slider', min: 0, max: 2, step: 0.05, unit: 'x', default: 1 },
          { key: 'glyphSettleStretch', label: '逐字入场时序', type: 'slider', min: 0, max: 1, step: 0.05, unit: 'percent', default: 0.5 },
          { key: 'colorMode', label: '色彩模式', type: 'picture', options: [
            { value: 'duo', label: '主题双色' }, { value: 'mono', label: '黑白灰' }, { value: 'gradient', label: '封面渐变' }
          ], default: 'duo' }
        ]},
        { title: '歌词分镜', keys: [
          { key: 'wholeLineLyrics', label: '整句显示歌词', type: 'switch', default: false }
        ]},
        { title: '显示内容', keys: [
          { key: 'showBlocks', label: '色块场景', type: 'switch', default: true },
          { key: 'showDecor', label: '装饰元素', type: 'switch', default: true },
          { key: 'textInversion', label: '文字动态反色', type: 'switch', default: true },
          { key: 'enableTransitions', label: '场景转场', type: 'switch', default: true }
        ]},
        { title: '渲染质量', keys: [
          { key: 'textureResolution', label: '纹理分辨率', type: 'slider', min: 0.5, max: 4, step: 0.25, unit: 'x', default: 1.5 }
        ]},
        { title: '后处理', keys: [
          { key: 'postProcessEnabled', label: '整体后处理滤镜', type: 'switch', default: true },
          { key: 'postProcessTextureCompression', label: '后处理纹理压缩', type: 'switch', default: false, sub: true, visibleWhen: { key: 'postProcessEnabled', eq: true } },
          { key: 'postProcessGrain', label: '胶片颗粒', type: 'slider', min: 0, max: 1, step: 0.05, unit: 'percent', default: 0.2, sub: true, visibleWhen: { key: 'postProcessEnabled', eq: true } },
          { key: 'postProcessContrast', label: '对比度增强', type: 'slider', min: 0, max: 1, step: 0.05, unit: 'percent', default: 0, sub: true, visibleWhen: { key: 'postProcessEnabled', eq: true } },
          { key: 'postProcessRgbShift', label: 'RGB 色差', type: 'slider', min: 0, max: 1, step: 0.05, unit: 'percent', default: 0, sub: true, visibleWhen: { key: 'postProcessEnabled', eq: true } },
          { key: 'postProcessVignette', label: '暗角', type: 'slider', min: 0, max: 2, step: 0.05, unit: 'x', default: 0.85, sub: true, visibleWhen: { key: 'postProcessEnabled', eq: true } },
          { key: 'postProcessLensDistortion', label: '透镜扭曲', type: 'slider', min: 0, max: 2, step: 0.05, unit: 'x', default: 0.3, sub: true, visibleWhen: { key: 'postProcessEnabled', eq: true } }
        ]}
      ]
    },
    lumiere: {
      label: '绘光',
      groups: [
        { title: '光', keys: [
          { key: 'lightIntensity', label: '光强', type: 'slider', min: 0.3, max: 2, step: 0.05, unit: 'x', default: 1 },
          { key: 'audioResponse', label: '随音乐变亮', type: 'slider', min: 0, max: 2, step: 0.05, unit: 'x', default: 1 },
          { key: 'bloom', label: '图形辉光', type: 'slider', min: 0, max: 2, step: 0.05, unit: 'x', default: 1 },
          { key: 'textBloom', label: '文字辉光', type: 'slider', min: 0, max: 2, step: 0.05, unit: 'x', default: 1 }
        ]},
        { title: '氛围', keys: [
          { key: 'darkField', label: '暗场强度', type: 'slider', min: 0, max: 1, step: 0.01, unit: 'percent', default: 0.75 },
          { key: 'fogDensity', label: '烟雾浓度', type: 'slider', min: 0, max: 2, step: 0.05, unit: 'x', default: 1 },
          { key: 'fogOctaves', label: '烟雾细节', type: 'slider', min: 2, max: 6, step: 1, integer: true, default: 5 },
          { key: 'moteAmount', label: '浮尘数量', type: 'slider', min: 0, max: 2, step: 0.05, unit: 'x', default: 1 },
          { key: 'frontBokeh', label: '前景散景', type: 'switch', default: true },
          { key: 'lineArt', label: '线稿', type: 'switch', default: true },
          { key: 'overlayFrame', label: '画框', type: 'switch', default: true }
        ]},
        { title: '文字', keys: [
          { key: 'textOnly', label: '仅显示歌词文字', type: 'switch', default: false },
          { key: 'unlitOpacity', label: '未唱字透明度', type: 'slider', min: 0.05, max: 0.6, step: 0.01, unit: 'percent', default: 0.22 },
          { key: 'windowNeighbors', label: '邻行', type: 'segmented', options: [
            { value: 1, label: '上一行 + 当前行' }, { value: 2, label: '上一行 + 当前行 + 下一行' }
          ], default: 2 },
          { key: 'decay', label: '崩解强度', type: 'slider', min: 0, max: 2, step: 0.05, unit: 'x', default: 1 },
          { key: 'echo', label: '背景歌词', type: 'slider', min: 0, max: 2, step: 0.05, unit: 'x', default: 1 },
          { key: 'trails', label: '所有换位都走轨迹线', type: 'switch', default: true },
          { key: 'seamlessTransitions', label: '轨迹过渡', type: 'switch', default: true }
        ]},
        { title: '主题', keys: [
          { key: 'themeColorMix', label: '主题色占比', type: 'slider', min: 0, max: 1, step: 0.01, unit: 'percent', default: 0.3 },
          { key: 'keywordColors', label: '关键字着色', type: 'switch', default: true },
          { key: 'themeIcons', label: '主题图标', type: 'switch', default: true }
        ]},
        { title: '性能', keys: [
          { key: 'renderQuality', label: '画质', type: 'segmented', options: [
            { value: 'full', label: '全分辨率' }, { value: 'balanced', label: '均衡' }, { value: 'low', label: '省电' }
          ], default: 'full' }
        ]}
      ]
    },
    hanabi: {
      label: '花火',
      groups: [
        { title: '烟花', keys: [
          { key: 'sparkAmount', label: '火花数量', type: 'slider', min: 0, max: 2, step: 0.05, unit: 'x', default: 1 },
          { key: 'glow', label: '烟花辉光', type: 'slider', min: 0, max: 2, step: 0.05, unit: 'x', default: 1 },
          { key: 'chorusBloom', label: '副歌辉光', type: 'slider', min: 0, max: 2, step: 0.05, unit: 'x', default: 1.3 },
          { key: 'bloom', label: '整体辉光', type: 'slider', min: 0, max: 2, step: 0.05, unit: 'x', default: 0.8 },
          { key: 'launches', label: '升空尾迹', type: 'switch', default: true }
        ]},
        { title: '画面', keys: [
          { key: 'sky', label: '夜空', type: 'slider', min: 0, max: 1, step: 0.01, unit: 'percent', default: 0.85 },
          { key: 'riseSpeed', label: '上升', type: 'slider', min: 0, max: 2, step: 0.05, unit: 'x', default: 1 },
          { key: 'spin', label: '旋转', type: 'slider', min: 0, max: 2, step: 0.05, unit: 'x', default: 1 },
          { key: 'ambient', label: '环境火星', type: 'slider', min: 0, max: 2, step: 0.05, unit: 'x', default: 1 },
          { key: 'overlayFrame', label: '画框', type: 'switch', default: true }
        ]},
        { title: '文字', keys: [
          { key: 'textOnly', label: '仅显示歌词文字', type: 'switch', default: false },
          { key: 'textMotion', label: '文字动作', type: 'slider', min: 0, max: 2, step: 0.05, unit: 'x', default: 1 },
          { key: 'blockOpacity', label: '字底色块', type: 'slider', min: 0, max: 1, step: 0.01, unit: 'percent', default: 1 }
        ]},
        { title: '装饰', keys: [
          { key: 'collage', label: 'PV 拼贴', type: 'slider', min: 0, max: 2, step: 0.05, unit: 'x', default: 1 },
          { key: 'ornamentAmount', label: 'MG 装饰件', type: 'slider', min: 0, max: 2, step: 0.05, unit: 'x', default: 1 }
        ]},
        { title: '配色与性能', keys: [
          { key: 'colorMode', label: '配色', type: 'picture', options: [
            { value: 'mixed', label: '混合' }, { value: 'vivid', label: '鲜艳' }, { value: 'theme', label: '主题' }
          ], default: 'mixed' },
          { key: 'renderQuality', label: '画质', type: 'segmented', options: [
            { value: 'full', label: '全分辨率' }, { value: 'balanced', label: '均衡' }, { value: 'low', label: '省电' }
          ], default: 'full' }
        ]}
      ]
    },
    nebbia: {
      label: '雾笺',
      groups: [
        { title: '窗外显示', keys: [
          { key: 'behind', label: '窗外', type: 'picture', options: [
            { value: 'night', label: '雨夜街景' }, { value: 'aquarium', label: '梦海流萤' }, { value: 'backdrop', label: '背景' }
          ], default: 'night' },
          { key: 'jellies', label: '水母数量', type: 'slider', min: 0, max: 24, step: 1, integer: true, default: 16, sub: true, visibleWhen: { key: 'behind', eq: 'aquarium' } },
          { key: 'jellySize', label: '水母大小', type: 'slider', min: 0.5, max: 1.8, step: 0.05, unit: 'x', default: 1, sub: true, visibleWhen: { key: 'behind', eq: 'aquarium' } },
          { key: 'bubbles', label: '气泡多少', type: 'slider', min: 0, max: 1, step: 0.05, unit: 'percent', default: 0.6, sub: true, visibleWhen: { key: 'behind', eq: 'aquarium' } },
          { key: 'scenery', label: '街景', type: 'multi', options: [
            { value: 'spot', label: '聚光灯' }, { value: 'buildings', label: '楼群' },
            { value: 'lights', label: '光斑' }, { value: 'cars', label: '车灯' }, { value: 'road', label: '马路' }
          ], default: ['spot', 'buildings', 'lights', 'cars', 'road'], visibleWhen: { key: 'behind', neq: 'aquarium' } },
          { key: 'rain', label: '窗外的雨', type: 'segmented', options: [
            { value: 'slant', label: '斜着' }, { value: 'straight', label: '竖直' }, { value: 'off', label: '不下' }
          ], default: 'slant', visibleWhen: { key: 'behind', neq: 'aquarium' } }
        ]},
        { title: '雾上写字', keys: [
          { key: 'strokeWidth', label: '笔画粗细', type: 'slider', min: 0.04, max: 0.16, step: 0.005, default: 0.09 },
          { key: 'writeSpeed', label: '书写速度', type: 'slider', min: 0.4, max: 2.5, step: 0.05, unit: 'x', default: 1 },
          { key: 'jitter', label: '手写歪斜', type: 'slider', min: 0, max: 1.5, step: 0.05, unit: 'x', default: 0.6 },
          { key: 'warp', label: '手写变形', type: 'slider', min: 0, max: 1.5, step: 0.05, unit: 'x', default: 0.6 },
          { key: 'doodle', label: '句尾画图标', type: 'slider', min: 0, max: 1, step: 0.05, unit: 'percent', default: 0.3 },
          { key: 'mist', label: '雾气浓度', type: 'slider', min: 0.2, max: 1, step: 0.01, unit: 'percent', default: 0.75 },
          { key: 'hold', label: '下一句开始后保持', type: 'slider', min: 0, max: 6, step: 0.1, default: 1.2 },
          { key: 'refog', label: '重新起雾用时', type: 'slider', min: 0.5, max: 12, step: 0.5, default: 4 },
          { key: 'credits', label: '片尾写曲名和歌手', type: 'switch', default: true }
        ]},
        { title: '出现与消失', keys: [
          { key: 'appear', label: '出现', type: 'multi', options: [
            { value: 'write', label: '手指书写' }, { value: 'fade', label: '慢慢显现' }, { value: 'breath', label: '哈气后书写' }
          ], default: ['write', 'fade'] },
          { key: 'fade', label: '消失', type: 'multi', options: [
            { value: 'fog', label: '慢慢起雾' }, { value: 'fingers', label: '手指抹掉' }
          ], default: ['fog'] }
        ]},
        { title: '构图', keys: [
          { key: 'layouts', label: '构图', type: 'multi', options: [
            { value: 'ribbon', label: '横条' }, { value: 'lines2', label: '两行错落' }, { value: 'lines3', label: '三行错落' },
            { value: 'cross', label: '十字' }, { value: 'pillar', label: '竖柱' }, { value: 'header', label: '刊头' },
            { value: 'badge', label: '徽章' }, { value: 'columns', label: '竖排几列' }, { value: 'orbit', label: '环绕' }
          ], default: ['ribbon', 'lines2', 'lines3', 'cross', 'pillar', 'header', 'badge', 'columns', 'orbit'] }
        ]},
        { title: '车窗与街景', keys: [
          { key: 'busSpeed', label: '车速', type: 'slider', min: 0, max: 3, step: 0.05, unit: 'x', default: 1 },
          { key: 'neon', label: '霓虹', type: 'slider', min: 0, max: 2, step: 0.05, unit: 'x', default: 1 },
          { key: 'bump', label: '颠簸', type: 'slider', min: 0, max: 2.5, step: 0.05, unit: 'x', default: 1, visibleWhen: { key: 'behind', neq: 'aquarium' } },
          { key: 'spot', label: '聚光灯', type: 'slider', min: 0, max: 2, step: 0.05, unit: 'x', default: 0.5 },
          { key: 'spotX', label: '聚光灯位置', type: 'slider', min: 0, max: 1, step: 0.01, unit: 'percent', default: 0.8 }
        ]},
        { title: '前面的玻璃', keys: [
          { key: 'glass', label: '玻璃', type: 'picture', options: [
            { value: 'rain', label: '雨窗' }, { value: 'dew', label: '凝露' }, { value: 'snow', label: '融雪' }
          ], default: 'rain' },
          { key: 'rainHit', label: '雨点打在玻璃上', type: 'slider', min: 0, max: 3, step: 0.05, unit: 'x', default: 1, sub: true, visibleWhen: { key: 'glass', eq: 'rain' } },
          { key: 'rainBig', label: '吐字时的大雨点', type: 'slider', min: 0, max: 2, step: 0.05, unit: 'x', default: 1, sub: true, visibleWhen: { key: 'glass', eq: 'rain' } },
          { key: 'dew', label: '冷凝水珠多少', type: 'slider', min: 0, max: 1.5, step: 0.05, unit: 'x', default: 1, sub: true, visibleWhen: { key: 'glass', eq: 'dew' } },
          { key: 'dewSize', label: '冷凝水珠大小', type: 'slider', min: 0.5, max: 2, step: 0.05, unit: 'x', default: 1, sub: true, visibleWhen: { key: 'glass', eq: 'dew' } },
          { key: 'dewGlint', label: '冷凝水珠高光', type: 'slider', min: 0, max: 2, step: 0.05, unit: 'x', default: 1, sub: true, visibleWhen: { key: 'glass', eq: 'dew' } },
          { key: 'snow', label: '雪多少', type: 'slider', min: 0, max: 3, step: 0.05, unit: 'x', default: 1, sub: true, visibleWhen: { key: 'glass', eq: 'snow' } },
          { key: 'snowSize', label: '雪花大小', type: 'slider', min: 0.5, max: 2, step: 0.05, unit: 'x', default: 1, sub: true, visibleWhen: { key: 'glass', eq: 'snow' } },
          { key: 'snowMelt', label: '雪化得多快', type: 'slider', min: 0.25, max: 3, step: 0.05, unit: 'x', default: 1, sub: true, visibleWhen: { key: 'glass', eq: 'snow' } }
        ]}
      ]
    },
    machi: {
      label: '町景',
      groups: [
        { title: '场景', keys: [
          { key: 'scene', label: '场景', type: 'picture', options: [
            { value: 'auto', label: '自动' }, { value: 'konbini', label: '便利店' },
            { value: 'station', label: '加油站' }, { value: 'kowloon', label: '城寨酒吧' }
          ], default: 'auto' }
        ]},
        { title: '时间与天气', keys: [
          { key: 'timeOfDay', label: '时间', type: 'segmented', options: [
            { value: 'auto', label: '自动' }, { value: 'day', label: '白天' },
            { value: 'dusk', label: '黄昏' }, { value: 'night', label: '夜间' }
          ], default: 'auto' },
          { key: 'weather', label: '天气', type: 'segmented', options: [
            { value: 'auto', label: '自动' }, { value: 'clear', label: '晴' },
            { value: 'rain', label: '雨' }, { value: 'snow', label: '雪' }, { value: 'fog', label: '雾' }
          ], default: 'auto' }
        ]},
        { title: '灯光', keys: [
          { key: 'simulatedBeat', label: '模拟节拍', type: 'switch', default: true }
        ]},
        { title: '镜头', keys: [
          { key: 'camera', label: '视角', type: 'segmented', options: [
            { value: 'default', label: '默认视角' }, { value: 'custom', label: '自定义视角' }
          ], default: 'default' },
          // 自定义视角（每场景各一份；画面上拖拽 / 右键平移后停稳会自动写回对应场景）
          { key: 'views.konbini.azimuth', label: '便利店 · 水平转角', type: 'slider', min: -75, max: 75, step: 1, unit: 'deg', default: 0, sub: true, visibleWhen: { key: 'camera', eq: 'custom' } },
          { key: 'views.konbini.elevation', label: '便利店 · 俯仰', type: 'slider', min: -12, max: 40, step: 1, unit: 'deg', default: 0, sub: true, visibleWhen: { key: 'camera', eq: 'custom' } },
          { key: 'views.konbini.zoom', label: '便利店 · 远近', type: 'slider', min: 0.5, max: 2.8, step: 0.05, unit: 'x', default: 1, sub: true, visibleWhen: { key: 'camera', eq: 'custom' } },
          { key: 'views.station.azimuth', label: '加油站 · 水平转角', type: 'slider', min: -75, max: 75, step: 1, unit: 'deg', default: 0, sub: true, visibleWhen: { key: 'camera', eq: 'custom' } },
          { key: 'views.station.elevation', label: '加油站 · 俯仰', type: 'slider', min: -12, max: 40, step: 1, unit: 'deg', default: 0, sub: true, visibleWhen: { key: 'camera', eq: 'custom' } },
          { key: 'views.station.zoom', label: '加油站 · 远近', type: 'slider', min: 0.5, max: 2.8, step: 0.05, unit: 'x', default: 1, sub: true, visibleWhen: { key: 'camera', eq: 'custom' } },
          { key: 'views.kowloon.azimuth', label: '城寨酒吧 · 水平转角', type: 'slider', min: -75, max: 75, step: 1, unit: 'deg', default: 0, sub: true, visibleWhen: { key: 'camera', eq: 'custom' } },
          { key: 'views.kowloon.elevation', label: '城寨酒吧 · 俯仰', type: 'slider', min: -12, max: 40, step: 1, unit: 'deg', default: 0, sub: true, visibleWhen: { key: 'camera', eq: 'custom' } },
          { key: 'views.kowloon.zoom', label: '城寨酒吧 · 远近', type: 'slider', min: 0.5, max: 2.8, step: 0.05, unit: 'x', default: 1, sub: true, visibleWhen: { key: 'camera', eq: 'custom' } },
          { key: 'motion', label: '运镜', type: 'switch', default: false },
          { key: 'motionSpeed', label: '运镜速度', type: 'slider', min: 0.25, max: 3, step: 0.05, unit: 'x', default: 1, sub: true, visibleWhen: { key: 'motion', eq: true } }
        ]},
        { title: '景深', keys: [
          { key: 'aperture', label: '光圈', type: 'slider', min: 1.4, max: 16, step: 0.1, default: 8 },
          { key: 'dof', label: '景深强度', type: 'slider', min: 0, max: 2, step: 0.05, unit: 'x', default: 1 },
          { key: 'dofRange', label: '清晰范围', type: 'slider', min: 0.3, max: 3, step: 0.05, unit: 'x', default: 1 },
          { key: 'tiltShift', label: '移轴', type: 'slider', min: 0, max: 1, step: 0.05, unit: 'percent', default: 0.3 },
          { key: 'focus', label: '对焦', type: 'segmented', options: [
            { value: 'center', label: '画面中心' }, { value: 'lyrics', label: '歌词屏' }, { value: 'manual', label: '手动' }
          ], default: 'center' },
          { key: 'focusOffset', label: '对焦前后', type: 'slider', min: -10, max: 10, step: 0.1, default: 0, sub: true, visibleWhen: { key: 'focus', eq: 'manual' } }
        ]},
        { title: '画质', keys: [
          // 插件无全局歌词画布挡位：「跟随全局」按 1 倍 + SMAA 解释（上游高档默认）
          { key: 'quality.renderScale', label: '分辨率', type: 'segmented', options: [
            { value: 'global', label: '跟随全局' }, { value: 1, label: '100%' }, { value: 0.75, label: '75%' }, { value: 0.5, label: '50%' }
          ], default: 'global' },
          { key: 'quality.antialias', label: '抗锯齿', type: 'segmented', options: [
            { value: 'global', label: '跟随全局' }, { value: 'off', label: '关' }, { value: 'fxaa', label: 'FXAA' },
            { value: 'smaa', label: 'SMAA' }, { value: 'ssaa', label: '超采样' }
          ], default: 'global' },
          { key: 'quality.shadows', label: '阴影', type: 'segmented', options: [
            { value: 'off', label: '关' }, { value: 'low', label: '低' }, { value: 'high', label: '高' }
          ], default: 'high' },
          { key: 'quality.reflections', label: '倒影', type: 'segmented', options: [
            { value: 'off', label: '关' }, { value: 'low', label: '低' }, { value: 'high', label: '高' }
          ], default: 'high' },
          { key: 'quality.glow', label: '辉光', type: 'switch', default: true },
          { key: 'quality.adaptive', label: '自动降级', type: 'switch', default: true }
        ]}
      ]
    },
    claddagh: {
      label: '回环',
      groups: [
        { title: '回环参数', keys: [
          { key: 'focusScaleRatio', label: '主歌词放大倍率', type: 'slider', min: 0, max: 1.5, step: 0.05, unit: 'x', default: 0.65 },
          { key: 'radiusScale', label: '轨道半径', type: 'slider', min: 0.5, max: 1.5, step: 0.05, unit: 'x', default: 1.0 },
          { key: 'ellipseTiltDeg', label: '轨道倾斜度', type: 'slider', min: 0, max: 60, step: 1, unit: 'deg', default: 45 },
          { key: 'showAxisLine', label: '中间轴线', type: 'switch', default: true },
          { key: 'letterSpacingOffset', label: '字符间距', type: 'slider', min: -5, max: 20, step: 0.5, unit: 'px', default: 0 }
        ]}
      ]
    },
    pendolo: {
      label: '时计',
      groups: [
        { title: '时计参数', keys: [
          { key: 'wheelCenterX', label: '轮盘水平位置', type: 'slider', min: -0.2, max: 0.4, step: 0.01, default: 0.0 },
          { key: 'wheelCenterY', label: '轮盘垂直位置', type: 'slider', min: 0.2, max: 0.8, step: 0.01, default: 0.50 },
          { key: 'arcRadius', label: '轮盘半径', type: 'slider', min: 0.25, max: 0.8, step: 0.01, default: 0.42 },
          { key: 'arcAngleDeg', label: '弧度角度', type: 'slider', min: 40, max: 160, step: 5, unit: 'deg', default: 100 },
          { key: 'tickSnappiness', label: '擒纵咬合力度', type: 'slider', min: 0.5, max: 2, step: 0.1, unit: 'x', default: 2.0 },
          { key: 'activeScale', label: '聚焦句缩放', type: 'slider', min: 1, max: 1.6, step: 0.05, unit: 'x', default: 1.25 },
          { key: 'showGearDecor', label: '机械齿轮饰线', type: 'segmented', options: [
            { value: 'none', label: '无' }, { value: 'subtle', label: '半透明' }, { value: 'full', label: '完整' }
          ], default: 'subtle' },
          { key: 'showCenterGradient', label: '齿轮中央深色渐变', type: 'switch', default: true },
          { key: 'showCoverOnWatchFace', label: '表盘显示专辑封面', type: 'switch', default: false },
          { key: 'enableLineGlow', label: '线条发光效果', type: 'switch', default: false }
        ]}
      ]
    },
    cappella: {
      label: '群唱',
      // emojiPackSource：插件未消费（表情恒用内置图清单），保留键位以对齐上游 tuning 形态
      extraKeys: [
        { key: 'emojiPackSource', type: 'segmented', options: [{ value: 'builtin', label: '内置' }, { value: 'custom', label: '自定义' }], default: 'builtin' }
      ],
      groups: [
        { title: '群唱参数', keys: [
          // 插件头像库固定内置（上游默认 'cover' 需封面人物检测，插件按需求固定 builtin）
          { key: 'avatarSource', label: '头像来源', type: 'segmented', options: [
            { value: 'cover', label: '封面' }, { value: 'builtin', label: '内置头像' }, { value: 'color', label: '色块' }
          ], default: 'builtin' },
          { key: 'showEmoMessages', label: '显示表情包', type: 'switch', default: true }
        ]}
      ]
    },
    diorama: {
      label: '镜台',
      groups: [
        { title: '镜头与运动', keys: [
          { key: 'cameraSpeed', label: '镜头速度', type: 'slider', min: 0.55, max: 1.85, step: 0.05, unit: 'x', default: 1 },
          { key: 'motionAmount', label: '运动幅度', type: 'slider', min: 0.4, max: 1.6, step: 0.05, unit: 'x', default: 1 },
          { key: 'audioReactivity', label: '点云音频响应', type: 'slider', min: 0, max: 1.5, step: 0.05, unit: 'percent', default: 1 }
        ]},
        { title: '跟唱效果', keys: [
          { key: 'glowEnabled', label: '普通辉光跟唱', type: 'switch', default: true },
          { key: 'glowIntensity', label: '强度', type: 'slider', min: 0.1, max: 1.5, step: 0.05, unit: 'x', default: 1, sub: true, visibleWhen: { key: 'glowEnabled', eq: true } },
          { key: 'soulEnabled', label: '灵魂出窍跟唱', type: 'switch', default: true },
          { key: 'soulIntensity', label: '强度', type: 'slider', min: 0.1, max: 1.5, step: 0.05, unit: 'x', default: 1, sub: true, visibleWhen: { key: 'soulEnabled', eq: true } },
          { key: 'soulActiveEnabled', label: '当前字出窍', type: 'switch', default: false, sub: true, visibleWhen: { key: 'soulEnabled', eq: true } },
          { key: 'gradientEnabled', label: '渐变跟唱', type: 'switch', default: false },
          { key: 'gradientIntensity', label: '强度', type: 'slider', min: 0.1, max: 1.5, step: 0.05, unit: 'x', default: 1, sub: true, visibleWhen: { key: 'gradientEnabled', eq: true } },
          { key: 'keywordColoringEnabled', label: '关键字着色', type: 'switch', default: true }
        ]},
        { title: '点云几何', keys: [
          { key: 'geometryVisibility.enabled', label: '点云几何', type: 'switch', default: true },
          { key: 'geometryVisibility.mode', label: '几何形态', type: 'segmented', options: [
            { value: 'clouds', label: '点云' }, { value: 'corridor', label: '长廊' }
          ], default: 'clouds', sub: true, visibleWhen: { key: 'geometryVisibility.enabled', eq: true } },
          { key: 'geometryVisibility.strands', label: '点云立方体', type: 'switch', default: true, sub: true, visibleWhen: { key: 'geometryVisibility.enabled', eq: true } },
          { key: 'geometryVisibility.blobs', label: '点云圆柱体', type: 'switch', default: true, sub: true, visibleWhen: { key: 'geometryVisibility.enabled', eq: true } },
          { key: 'geometryVisibility.ribbons', label: '三角晶体', type: 'switch', default: true, sub: true, visibleWhen: { key: 'geometryVisibility.enabled', eq: true } },
          { key: 'geometryVisibility.rings', label: '点云圆环', type: 'switch', default: true, sub: true, visibleWhen: { key: 'geometryVisibility.enabled', eq: true } },
          { key: 'particleDensity', label: '点云密度', type: 'slider', min: 96, max: 1536, step: 24, integer: true, default: 576, sub: true, visibleWhen: { key: 'geometryVisibility.enabled', eq: true } },
          { key: 'particleScale', label: '点云整体体积', type: 'slider', min: 0.65, max: 1.6, step: 0.05, unit: 'x', default: 1, sub: true, visibleWhen: { key: 'geometryVisibility.enabled', eq: true } },
          { key: 'particleGlowEnabled', label: '点云整体辉光', type: 'switch', default: true, sub: true, visibleWhen: { key: 'geometryVisibility.enabled', eq: true } },
          { key: 'particleGlowIntensity', label: '辉光强度', type: 'slider', min: 0.1, max: 1.5, step: 0.05, unit: 'x', default: 0.65, sub: true, visibleWhen: { key: 'geometryVisibility.enabled', eq: true } }
        ]},
        { title: '背景粒子', keys: [
          { key: 'showParticles', label: '背景粒子', type: 'switch', default: true },
          { key: 'backgroundParticleCircumference', label: '圆周密度', type: 'slider', min: 4, max: 48, step: 2, integer: true, default: 28, sub: true, visibleWhen: { key: 'showParticles', eq: true } },
          { key: 'backgroundParticleRadial', label: '径向密度', type: 'slider', min: 1, max: 4, step: 1, integer: true, default: 2, sub: true, visibleWhen: { key: 'showParticles', eq: true } }
        ]}
      ]
    }
    // still（静止）无调参项
  }

  // ===== 背景 schema =====
  // transparent 的透明度/毛玻璃走宿主窗口背景通道（bridge 现有逻辑），不经 tuning
  var BG_SCHEMAS = {
    common: {
      label: '通用',
      groups: [
        { title: '通用背景', keys: [
          { key: 'opacity', label: '叠层透明度', type: 'slider', min: 0, max: 1, step: 0.05, unit: 'percent', default: 0.75, visibleWhen: { key: 'useCoverColorBg', eq: true } },
          // invert：开关展示为"暗角"（默认开），存储值为其反相（disableVignette 默认 false）
          { key: 'disableVignette', label: '暗角', type: 'switch', invert: true, default: false }
        ]}
      ]
    },
    latent: {
      label: '隐现',
      groups: [
        { title: '隐现参数', keys: [
          { key: 'displayMode', label: '显示图层', type: 'segmented', options: [
            { value: 'dithering', label: '像素' }, { value: 'mesh', label: '流体' }, { value: 'both', label: '混合' }
          ], default: 'both' },
          { key: 'colorSource', label: '颜色来源', type: 'segmented', options: [
            { value: 'cover-theme', label: '封面与主题' }, { value: 'cover', label: '仅封面取色' }
          ], default: 'cover-theme' },
          { key: 'enhancedBeatResponse', label: '增强节拍响应', type: 'switch', default: true },
          { key: 'overlayEnabled', label: '可读性叠色', type: 'switch', default: true },
          { key: 'overlayOpacity', label: '叠色透明度', type: 'slider', min: 0, max: 1, step: 0.05, unit: 'percent', default: 0.35, sub: true, visibleWhen: { key: 'overlayEnabled', eq: true } }
        ]},
        { title: '像素背景', keys: [
          { key: 'ditheringSpeed', label: '基础速度', type: 'slider', min: 0, max: 2, step: 0.1, unit: 'x', default: 0.1 },
          { key: 'ditheringAudioSpeed', label: '音频响应最大速度', type: 'slider', min: 0, max: 2, step: 0.1, unit: 'x', default: 1.2 },
          { key: 'ditheringSize', label: '像素尺寸', type: 'slider', min: 0.5, max: 8, step: 0.25, unit: 'x', default: 2.5 },
          { key: 'ditheringOpacity', label: '像素层透明度', type: 'slider', min: 0, max: 1, step: 0.05, unit: 'percent', default: 0.55 }
        ]},
        { title: '流体背景', keys: [
          { key: 'meshSpeed', label: '基础速度', type: 'slider', min: 0, max: 2, step: 0.1, unit: 'x', default: 0.3 },
          { key: 'meshAudioSpeed', label: '音频响应最大速度', type: 'slider', min: 0, max: 2, step: 0.1, unit: 'x', default: 2 },
          { key: 'meshDistortion', label: '流体扭曲', type: 'slider', min: 0, max: 2, step: 0.1, unit: 'x', default: 0.8 },
          { key: 'meshSwirl', label: '流体旋涡', type: 'slider', min: 0, max: 1, step: 0.05, unit: 'percent', default: 0.1 }
        ]}
      ]
    },
    monet: {
      label: '莫奈',
      groups: [
        { title: '视觉增强与滤镜', keys: [
          { key: 'backgroundBlurPx', label: '背景模糊', type: 'slider', min: 0, max: 60, step: 2, unit: 'px', default: 6 },
          { key: 'backgroundSaturation', label: '饱和度', type: 'slider', min: 0, max: 2, step: 0.05, unit: 'x', default: 1.05 },
          { key: 'backgroundGrayscale', label: '去色', type: 'slider', min: 0, max: 1, step: 0.05, unit: 'percent', default: 0 }
        ]},
        { title: '叠色与水洗', keys: [
          { key: 'backgroundOverlayOpacity', label: '主题叠色强度', type: 'slider', min: 0, max: 1, step: 0.05, unit: 'percent', default: 0.74 },
          { key: 'backgroundWash', label: '水洗重着色', type: 'slider', min: 0, max: 1, step: 0.05, unit: 'percent', default: 0.34 },
          { key: 'backgroundStreaksEnabled', label: '竖向纹理', type: 'switch', default: true },
          { key: 'backgroundWashColorMode', label: '水洗色彩', type: 'segmented', options: [
            { value: 'theme', label: '主题色' }, { value: 'custom', label: '自定义' }
          ], default: 'theme' },
          { key: 'backgroundWashCustomColor', label: '自定义水洗色', type: 'color', default: '#8fb7ff', visibleWhen: { key: 'backgroundWashColorMode', eq: 'custom' } }
        ]},
        { title: '漂移', keys: [
          { key: 'backgroundDriftEnabled', label: '缓慢漂移', type: 'switch', default: true },
          { key: 'backgroundDriftStrength', label: '漂移幅度', type: 'slider', min: 0, max: 1, step: 0.05, unit: 'percent', default: 0.5, sub: true, visibleWhen: { key: 'backgroundDriftEnabled', eq: true } }
        ]}
      ]
    },
    nomand: {
      label: '漫游',
      groups: [
        { title: '漫游参数', keys: [
          { key: 'effect', label: '效果', type: 'picture', options: [
            { value: 'dithering', label: '像素画' }, { value: 'fluted-glass', label: '纹理玻璃' },
            { value: 'paper-texture', label: '纸张纹理' }, { value: 'halftone-dots', label: '半调网点' },
            { value: 'lens-distortion', label: '镜头畸变' }
          ], default: 'dithering' },
          // 像素画
          { key: 'ditheringType', label: '像素画图案', type: 'segmented', options: [
            { value: '2x2', label: '2x2' }, { value: '4x4', label: '4x4' }, { value: '8x8', label: '8x8' }
          ], default: '8x8', sub: true, visibleWhen: { key: 'effect', eq: 'dithering' } },
          { key: 'size', label: '网点尺寸', type: 'slider', min: 0.5, max: 20, step: 0.5, unit: 'x', default: 3, sub: true, visibleWhen: { key: 'effect', eq: 'dithering' } },
          { key: 'colorSteps', label: '色阶数量', type: 'slider', min: 1, max: 7, step: 1, integer: true, default: 4, sub: true, visibleWhen: { key: 'effect', eq: 'dithering' } },
          { key: 'originalColors', label: '保留图片原色', type: 'switch', default: false, sub: true, visibleWhen: { key: 'effect', eq: 'dithering' } },
          { key: 'inverted', label: '反转图片明度', type: 'switch', default: false, sub: true, visibleWhen: { key: 'effect', eq: 'dithering' } },
          // 纹理玻璃
          { key: 'flutedGlassSize', label: '纹理尺寸', type: 'slider', min: 0.1, max: 1, step: 0.05, unit: 'x', default: 0.5, sub: true, visibleWhen: { key: 'effect', eq: 'fluted-glass' } },
          { key: 'flutedGlassDistortion', label: '扭曲', type: 'slider', min: 0, max: 1, step: 0.05, unit: 'percent', default: 0.5, sub: true, visibleWhen: { key: 'effect', eq: 'fluted-glass' } },
          { key: 'flutedGlassBlur', label: '模糊', type: 'slider', min: 0, max: 1, step: 0.05, unit: 'percent', default: 0.08, sub: true, visibleWhen: { key: 'effect', eq: 'fluted-glass' } },
          // 纸张纹理
          { key: 'paperTextureContrast', label: '对比度', type: 'slider', min: 0, max: 1, step: 0.05, unit: 'percent', default: 0.32, sub: true, visibleWhen: { key: 'effect', eq: 'paper-texture' } },
          { key: 'paperTextureRoughness', label: '粗糙度', type: 'slider', min: 0, max: 1, step: 0.05, unit: 'percent', default: 0.42, sub: true, visibleWhen: { key: 'effect', eq: 'paper-texture' } },
          { key: 'paperTextureFiber', label: '纤维', type: 'slider', min: 0, max: 1, step: 0.05, unit: 'percent', default: 0.3, sub: true, visibleWhen: { key: 'effect', eq: 'paper-texture' } },
          // 半调网点
          { key: 'halftoneDotsSize', label: '网点尺寸', type: 'slider', min: 0.1, max: 1, step: 0.05, unit: 'x', default: 0.5, sub: true, visibleWhen: { key: 'effect', eq: 'halftone-dots' } },
          { key: 'halftoneDotsRadius', label: '网点半径', type: 'slider', min: 0.1, max: 2, step: 0.05, unit: 'x', default: 1.25, sub: true, visibleWhen: { key: 'effect', eq: 'halftone-dots' } },
          { key: 'halftoneDotsContrast', label: '对比度', type: 'slider', min: 0, max: 1, step: 0.05, unit: 'percent', default: 0.4, sub: true, visibleWhen: { key: 'effect', eq: 'halftone-dots' } },
          { key: 'halftoneDotsOriginalColors', label: '保留图片原色', type: 'switch', default: false, sub: true, visibleWhen: { key: 'effect', eq: 'halftone-dots' } },
          { key: 'halftoneDotsInverted', label: '反转图片明度', type: 'switch', default: false, sub: true, visibleWhen: { key: 'effect', eq: 'halftone-dots' } },
          // 镜头畸变
          { key: 'lensDistortionSpread', label: '色彩分离', type: 'slider', min: 0, max: 1, step: 0.05, unit: 'percent', default: 0.45, sub: true, visibleWhen: { key: 'effect', eq: 'lens-distortion' } },
          { key: 'lensDistortionBulge', label: '镜头膨胀', type: 'slider', min: -1, max: 1, step: 0.05, default: 0.3, sub: true, visibleWhen: { key: 'effect', eq: 'lens-distortion' } },
          { key: 'lensDistortionDispersion', label: '色彩色散', type: 'slider', min: 0, max: 1, step: 0.05, unit: 'percent', default: 0.65, sub: true, visibleWhen: { key: 'effect', eq: 'lens-distortion' } }
        ]}
      ]
    }
    // url：配置为网页列表（bridge urlBgConfig 管理）；sora：无已消费参数；transparent：走宿主窗口背景通道
  }

  // ===== 工具 =====
  function clampNum(v, min, max) {
    if (!Number.isFinite(Number(v))) return null
    var n = Number(v)
    return Math.max(min, Math.min(max, n))
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
  function setPath(obj, path, value) {
    var parts = String(path).split('.')
    var cur = obj
    for (var i = 0; i < parts.length - 1; i += 1) {
      if (cur[parts[i]] == null || typeof cur[parts[i]] !== 'object') cur[parts[i]] = {}
      cur = cur[parts[i]]
    }
    cur[parts[parts.length - 1]] = value
  }
  function readJson(key, fallback) {
    try {
      var raw = localStorage.getItem(key)
      if (!raw) return fallback
      var parsed = JSON.parse(raw)
      return parsed && typeof parsed === 'object' ? parsed : fallback
    } catch (e) { return fallback }
  }
  function writeJson(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)) } catch (e) { /* 存储失败静默 */ }
  }

  // 按 schema 归一化：从 stored 取值 + clamp，缺省回落 default；返回完整对象（含嵌套点路径）。
  // extraKeys：不渲染 UI 但参与归一化的键（模式 tuning 对象中未开放调节的键，保证传给
  // 模式/背景的完整对象不缺键——如 tempera 的 layerImages）。stored 中 schema 未覆盖的
  // 顶层键原样透传（向前兼容）。
  function resolveBySchema(schema, stored) {
    var out = {}
    var src = stored && typeof stored === 'object' ? stored : {}
    var allKeys = []
    ;(schema.groups || []).forEach(function (group) {
      allKeys = allKeys.concat(group.keys)
    })
    ;(schema.extraKeys || []).forEach(function (spec) {
      allKeys = allKeys.concat([spec])
    })
    allKeys.forEach(function (spec) {
      var raw = getPath(src, spec.key)
      var value
      if (spec.type === 'slider') {
        value = clampNum(raw, spec.min, spec.max)
        if (value === null) value = spec.default
        if (spec.integer) value = Math.round(value)
      } else if (spec.type === 'switch') {
        value = typeof raw === 'boolean' ? raw : spec.default
      } else if (spec.type === 'segmented' || spec.type === 'picture') {
        value = null
        for (var i = 0; i < spec.options.length; i += 1) {
          if (raw === spec.options[i].value) { value = raw; break }
        }
        if (value === null) value = spec.default
      } else if (spec.type === 'color') {
        value = typeof raw === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(raw) ? raw : spec.default
      } else if (spec.type === 'multi') {
        // 多选：只留认得的值、按 options 顺序；空数组回默认
        var picked = []
        if (Array.isArray(raw)) {
          spec.options.forEach(function (option) {
            if (raw.indexOf(option.value) >= 0) picked.push(option.value)
          })
        }
        value = picked.length ? picked : spec.default.slice()
      } else if (spec.type === 'array') {
        value = Array.isArray(raw) ? raw : spec.default
      } else {
        value = raw === undefined ? spec.default : raw
      }
      setPath(out, spec.key, value)
    })
    // 透传 schema 未覆盖的顶层键（嵌套键按顶层前缀判定，避免覆盖归一化结果）
    var topKnown = {}
    allKeys.forEach(function (spec) { topKnown[String(spec.key).split('.')[0]] = true })
    Object.keys(src).forEach(function (topKey) {
      if (!topKnown[topKey]) out[topKey] = src[topKey]
    })
    return out
  }

  function schemaOf(schemas, id) { return schemas[id] || null }
  /**
   * 深合并补丁：单键点路径补丁（如 {quality:{shadows:'off'}}）逐层并进基线，
   * 不丢同组兄弟字段（町景阴影/倒影互串、镜台几何显隐、背景嵌套项均依赖此语义）。
   * 纯对象递归合并；数组与原始值整体替换（multi 选项值、随机池等数组语义）。
   */
  function mergePatch(base, patch) {
    var out = Object.assign({}, base)
    Object.keys(patch).forEach(function (k) {
      var pv = patch[k]
      if (pv && typeof pv === 'object' && !Array.isArray(pv)
        && out[k] && typeof out[k] === 'object' && !Array.isArray(out[k])) {
        out[k] = mergePatch(out[k], pv)
      } else {
        out[k] = pv
      }
    })
    return out
  }
  function isModified(schemas, prefix, id) {
    var schema = schemaOf(schemas, id)
    if (!schema) return false
    var current = readJson(prefix + id, null)
    if (!current) return false
    var def = resolveBySchema(schema, {})
    var keys = []
    schema.groups.forEach(function (g) { g.keys.forEach(function (k) { keys.push(k.key) }) })
    for (var i = 0; i < keys.length; i += 1) {
      if (JSON.stringify(getPath(current, keys[i])) !== JSON.stringify(getPath(def, keys[i]))) return true
    }
    return false
  }

  function makeApi(schemas, prefix) {
    return {
      schema: function (id) { return schemaOf(schemas, id) },
      resolve: function (id, stored) {
        var schema = schemaOf(schemas, id)
        return schema ? resolveBySchema(schema, stored) : (stored || {})
      },
      get: function (id) { return this.resolve(id, readJson(prefix + id, null)) },
      set: function (id, patch) {
        var schema = schemaOf(schemas, id)
        if (!schema) return null
        var held = readJson(prefix + id, {})
        var next = resolveBySchema(schema, mergePatch(held, patch || {}))
        writeJson(prefix + id, next)
        return next
      },
      reset: function (id) {
        var schema = schemaOf(schemas, id)
        if (!schema) return null
        var def = resolveBySchema(schema, {})
        try { localStorage.removeItem(prefix + id) } catch (e) { /* 忽略 */ }
        return def
      },
      modified: function (id) { return isModified(schemas, prefix, id) }
    }
  }

  var modeApi = makeApi(MODE_SCHEMAS, MODE_PREFIX)
  var bgApi = makeApi(BG_SCHEMAS, BG_PREFIX)

  // ===== 外观设置（字体/字幕/整体透明度，窗口「字体」「字幕」tab） =====
  // 存储键 folia-appearance；字幕项由 runtime/subtitle-overlay.js 每次渲染时读取
  var APPEARANCE_KEY = 'folia-appearance'
  var APPEARANCE_DEFAULT = {
    fontScale: 1,            // 字号缩放 0.85~1.4（模式经 setFontScale 消费）
    fontWeight: 0,           // 字重覆盖：0 = 自动（各模式内置字重），100~900 = 全局覆盖
    visualizerOpacity: 1,    // 整体透明度 0.2~1（作用于模式层容器）
    subtitle: {
      enabled: true,         // 显示副歌词
      opacity: 0.6,          // 字幕透明度 0.2~1
      background: true,      // 字幕背景
      upcomingBlur: true,    // 下一句模糊
      fontScale: 1           // 字幕缩放 0.85~1.4
    }
  }
  function normalizeAppearance(a) {
    var src = a && typeof a === 'object' ? a : {}
    var out = {}
    var fs = clampNum(src.fontScale, 0.85, 1.4)
    out.fontScale = fs === null ? APPEARANCE_DEFAULT.fontScale : fs
    var fw = clampNum(src.fontWeight, 100, 900)
    out.fontWeight = fw === null ? APPEARANCE_DEFAULT.fontWeight : Math.round(fw)
    var vo = clampNum(src.visualizerOpacity, 0.2, 1)
    out.visualizerOpacity = vo === null ? APPEARANCE_DEFAULT.visualizerOpacity : vo
    var sub = src.subtitle && typeof src.subtitle === 'object' ? src.subtitle : {}
    var so = clampNum(sub.opacity, 0.2, 1)
    out.subtitle = {
      enabled: typeof sub.enabled === 'boolean' ? sub.enabled : APPEARANCE_DEFAULT.subtitle.enabled,
      opacity: so === null ? APPEARANCE_DEFAULT.subtitle.opacity : so,
      background: typeof sub.background === 'boolean' ? sub.background : APPEARANCE_DEFAULT.subtitle.background,
      upcomingBlur: typeof sub.upcomingBlur === 'boolean' ? sub.upcomingBlur : APPEARANCE_DEFAULT.subtitle.upcomingBlur,
      fontScale: (function () {
        var sfs = clampNum(sub.fontScale, 0.85, 1.4)
        return sfs === null ? APPEARANCE_DEFAULT.subtitle.fontScale : sfs
      })()
    }
    return out
  }

  // ===== 随机池 =====
  var RANDOM_POOL_KEY = 'folia-randomPool'
  function getRandomPool() {
    var list = readJson(RANDOM_POOL_KEY, [])
    return Array.isArray(list) ? list.filter(function (id) { return typeof id === 'string' }) : []
  }
  function setRandomPool(ids) {
    writeJson(RANDOM_POOL_KEY, Array.isArray(ids) ? ids.filter(function (id) { return typeof id === 'string' }) : [])
    return getRandomPool()
  }

  window.FoliaTunings = {
    resolveModeTuning: function (modeId, stored) { return modeApi.resolve(modeId, stored) },
    getModeTuning: function (modeId) { return modeApi.get(modeId) },
    setModeTuning: function (modeId, patch) { return modeApi.set(modeId, patch) },
    resetModeTuning: function (modeId) { return modeApi.reset(modeId) },
    isModeTuningModified: function (modeId) { return modeApi.modified(modeId) },
    getModeSchema: function (modeId) { return modeApi.schema(modeId) },

    resolveBgTuning: function (bgId, stored) { return bgApi.resolve(bgId, stored) },
    getBgTuning: function (bgId) { return bgApi.get(bgId) },
    setBgTuning: function (bgId, patch) { return bgApi.set(bgId, patch) },
    resetBgTuning: function (bgId) { return bgApi.reset(bgId) },
    isBgTuningModified: function (bgId) { return bgApi.modified(bgId) },
    getBgSchema: function (bgId) { return bgApi.schema(bgId) },

    getAppearance: function () {
      return normalizeAppearance(readJson(APPEARANCE_KEY, APPEARANCE_DEFAULT))
    },
    setAppearance: function (patch) {
      var held = readJson(APPEARANCE_KEY, APPEARANCE_DEFAULT)
      // 深合并：调用方可传单键补丁（如 {subtitle:{opacity:v}}）不丢 subtitle 其他字段
      var next = normalizeAppearance(mergePatch(held, patch || {}))
      writeJson(APPEARANCE_KEY, next)
      return next
    },
    getRandomPool: getRandomPool,
    setRandomPool: setRandomPool
  }
})()
