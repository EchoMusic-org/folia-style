// 花火（hanabi）烟花层：移植自 folia-major src/components/visualizer/hanabi/mg/fireworks.ts
// 烟花层：精灵池（上限 maxParticles）+ burstPlan 的闭式解。每帧 update(time, bursts, launches) 把池里的精灵
// 重新分配给此刻仍在燃烧的星、尾迹、闪光与升空尾迹，多出来的隐藏。画面只由 time 与事件决定。
// 每帧都有精灵显隐：Pixi 里改 visible / blendMode 会让所在渲染组整组重排绘制指令，所以烟花层自己是一个渲染组
// （重排只排这一池），叠加的闪光另用一个池画在上面，精灵不再来回换混合模式。
(function () {
  'use strict'

  var PIXI = window.PIXI
  var BurstPlan = window.FoliaHanabiBurstPlan
  var Bloom = window.FoliaHanabiBloom

  /** 方案缓存上限：超过就只保留此刻还活着的。 */
  var PLAN_CACHE_LIMIT = 160

  /**
   * 建烟花层（textures = FoliaHanabiTextures 的一套共享纹理）。
   * options：{ width, height, palette, amount（tuning.sparkAmount）, maxParticles 精灵池上限 }。
   */
  function createFireworks(pixi, textures, options) {
    var view = new pixi.Container({ isRenderGroup: true })
    var unit = Math.min(options.width, options.height)
    var maxParticles = Math.max(0, Math.floor(options.maxParticles))
    var poolOf = function (blendMode) {
      var layer = new pixi.Container()
      layer.blendMode = blendMode
      view.addChild(layer)
      return { layer: layer, sprites: [], used: 0, shown: 0 }
    }
    var normal = poolOf('normal')
    var additive = poolOf('add')
    var used = 0
    // 事件对象在场景里是建好就不变的（节拍烟花按拍缓存），直接按对象缓存方案，不必每帧拼键。
    var plans = new Map()
    var active = []

    var textureOf = {
      glow: textures.glow,
      dot: textures.dot,
      star4: textures.star4,
      streak: textures.streak,
      flash: textures.glow
    }

    // 池按需增长（两个池合起来不超过上限），之后只复用，不再新建。
    var emit = function (texture, x, y, width, height, rotation, alpha, tint) {
      if (used >= maxParticles) return false
      var pool = texture === 'flash' ? additive : normal
      var sprite = pool.sprites[pool.used]
      if (!sprite) {
        sprite = new pixi.Sprite(textures.glow)
        sprite.anchor.set(0.5)
        pool.layer.addChild(sprite)
        pool.sprites.push(sprite)
      }
      pool.used += 1
      sprite.texture = textureOf[texture]
      sprite.visible = true
      sprite.position.set(x, y)
      sprite.rotation = rotation
      sprite.width = width
      sprite.height = height
      sprite.alpha = alpha > 1 ? 1 : alpha
      sprite.tint = tint
      used += 1
      return true
    }

    var planOf = function (event) {
      var plan = plans.get(event)
      if (!plan) {
        plan = BurstPlan.planBurst(event, options.palette, { unit: unit, amount: options.amount })
        plans.set(event, plan)
      }
      return plan
    }

    var hideRest = function (pool) {
      for (var i = pool.used; i < pool.shown; i += 1) pool.sprites[i].visible = false
      pool.shown = pool.used
      pool.used = 0
    }

    var update = function (time, bursts, launches) {
      used = 0
      active.length = 0
      // 先粗筛时间窗（duration 是上限），只给可能在燃烧的事件取方案。
      for (var i = 0; i < bursts.length; i += 1) {
        var event = bursts[i]
        if (time < event.at || time > event.at + event.spec.duration) continue
        var plan = planOf(event)
        if (BurstPlan.burstActive(plan, time)) active.push(plan)
      }
      if (plans.size > PLAN_CACHE_LIMIT) {
        var keep = new Set(active)
        var stale = []
        plans.forEach(function (planCached, eventCached) {
          if (!keep.has(planCached)) stale.push(eventCached)
        })
        for (var s = 0; s < stale.length; s += 1) plans.delete(stale[s])
      }
      // 升空尾迹在下面、先画；它的精灵数很少，余下的全给烟花。
      var launchBudget = 0
      for (var l = 0; l < launches.length; l += 1) {
        var launch = launches[l]
        if (time < launch.at || time > BurstPlan.launchEnd(launch)) continue
        launchBudget += BurstPlan.launchDemand(launch, time)
      }
      launchBudget = Math.min(launchBudget, Math.floor(maxParticles * 0.2))
      for (var l2 = 0; l2 < launches.length; l2 += 1) {
        if (used >= launchBudget) break
        if (!BurstPlan.drawLaunch(launches[l2], time, unit, emit)) break
      }
      BurstPlan.drawBursts(active, time, maxParticles - used, emit)
      hideRest(normal)
      hideRest(additive)
      view.visible = used > 0
    }

    return {
      view: view,
      update: update,
      destroy: function () {
        plans.clear()
        // Pixi v8 销毁纪律（PORTING.md）：逐节点无参 destroy，禁 destroy({ children: true })（上游写法见注释）。
        Bloom.destroyPixiDisplayTree(view)
      }
    }
  }

  window.FoliaHanabiFireworks = {
    createFireworks: createFireworks
  }
})()
