// 町景场景表（移植自 scenes/index.ts）：场景 id → 场景定义（resolveArt + create）。
// machi-runtime.js 的 buildStage/swapSong 按 seed（scene 配置"自动"时）从这里取。
(function () {
  'use strict'

  window.FoliaMachiScenes = {
    konbini: window.FoliaMachiSceneKonbini.KONBINI_SCENE,
    station: window.FoliaMachiSceneStation.STATION_SCENE,
    kowloon: window.FoliaMachiSceneKowloon.KOWLOON_SCENE
  }
})()
