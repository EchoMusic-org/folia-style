// 花火（hanabi）PV 拼贴视图：移植自 folia-major src/components/visualizer/hanabi/collage/collageViews.ts
// 把一个镜头的拼贴计划搭成 Pixi 的件，并逐帧摆姿态。全部精灵 / 平铺精灵（矩形用 Texture.WHITE 上色），不用 Graphics，
// 不用遮罩：装饰带「擦出」靠改平铺精灵的宽度与 tilePosition，图案钉在带上不跟着动。每帧画面只由 t 决定。
//   back：装饰带（胶片 / 剪切线 + 剪刀 / 蕾丝花边）、重复字、纸片、窗口、后层贴纸（在字底色块后面）
//   front：贴纸、胶带、标签、开花时的图标贴纸、跟着尾迹升空的小图标、间奏的贴纸气球（在字前面，但都摆在字组外面）
(function () {
  'use strict'

  var PIXI = window.PIXI
  var Plan = window.FoliaHanabiCollagePlan
  var Painters = window.FoliaHanabiCollagePainters
  var MathLib = window.FoliaHanabiOrnaments.Math

  /** 弹出：0.32 秒 easeOutBack 到 1。 */
  var popIn = function (time, at, duration) {
    if (duration === undefined) duration = 0.32
    return MathLib.easeOutBack((time - at) / duration, 2.4)
  }
  /** 退场进度 0..1。 */
  var leave = function (time, exitAt, exitDuration) { return MathLib.clamp01((time - exitAt) / Math.max(exitDuration, 0.05)) }

  /** 贴纸精灵的缩放：形状半径约是纹理边长的 0.34，加白边约 0.4。 */
  var stickerScale = function (size) { return size / (Painters.STICKER_PX * 0.8) }

  /**
   * 把一个镜头的拼贴计划（plan = FoliaHanabiCollagePlan.planShotCollage 的结果）搭成显示树。
   * cache = FoliaHanabiCollagePainters.createCollageTextureCache 的一套；textures = FoliaHanabiTextures 的共享纹理。
   * 返回 { back, front, update(time), destroy() }。
   */
  function createShotCollage(pixi, plan, cache, textures) {
    var back = new pixi.Container()
    var front = new pixi.Container()
    var parts = []

    var rect = function (parent, color, alpha) {
      if (alpha === undefined) alpha = 1
      var sprite = new pixi.Sprite(pixi.Texture.WHITE)
      sprite.tint = color
      sprite.alpha = alpha
      parent.addChild(sprite)
      return sprite
    }
    var setRect = function (sprite, x, y, width, height) {
      sprite.position.set(x, y)
      sprite.width = Math.max(0, width)
      sprite.height = Math.max(0, height)
    }

    var build = function (item) {
      switch (item.kind) {
        case 'strip': {
          var holder = new pixi.Container()
          holder.position.set(item.x, item.y)
          holder.rotation = item.rotation
          // 胶片是直边，阴影用一块偏移的深色矩形；花边、剪切线的阴影画在纹理里。
          var shadow = item.style === 'film' ? rect(holder, Plan.CANDY_INK, 0.3) : null
          var band = new pixi.TilingSprite({
            texture: cache.strip(item.style, item.color, item.thickness),
            width: item.length,
            height: item.thickness
          })
          holder.addChild(band)
          // 剪切线：一把剪刀在「剪开」的那一头，剪的时候一开一合。
          var blade = item.style === 'cut' ? new pixi.Sprite(cache.scissors(item.thickness)) : null
          if (blade) {
            blade.anchor.set(0.5)
            holder.addChild(blade)
          }
          back.addChild(holder)
          var half = item.length / 2
          var tile = band.texture.width || 1
          var lift = item.thickness * 0.14
          // 剪刀剪过整条线要一段时间，看得见它走；另外两种是快速擦出。
          var wipe = item.style === 'cut' ? 1.25 : item.style === 'lace' ? 0.55 : 0.42
          parts.push({
            update: function (time) {
              var raw = MathLib.clamp01((time - item.at) / wipe)
              var enter = item.style === 'cut' ? raw * raw * (3 - 2 * raw) : MathLib.easeOutCubic(raw)
              var exit = MathLib.easeInCubic(leave(time, item.exitAt, item.exitDuration))
              holder.visible = time > item.at && exit < 1
              if (!holder.visible) return
              // 从 from 那一端擦出，退场时朝另一端收走。
              var startAt = item.from < 0 ? exit : 1 - enter
              var endAt = item.from < 0 ? enter : 1 - exit
              var x0 = -half + item.length * Math.min(startAt, endAt)
              var width = item.length * Math.max(0, Math.abs(endAt - startAt))
              band.position.set(x0, -item.thickness / 2)
              band.width = width
              band.height = item.thickness
              // 图案钉在整条带上：带的左缘移动多少，tilePosition 反向补多少；再加上图案自己沿带子走。
              band.tilePosition.x = ((item.speed * time - (x0 + half)) % tile + tile) % tile
              if (shadow) setRect(shadow, x0 + lift, -item.thickness / 2 + lift * 1.3, width, item.thickness)
              if (blade) {
                blade.visible = raw < 1 && exit <= 0
                if (!blade.visible) return
                var age = time - item.at
                blade.position.set(item.from < 0 ? x0 + width : x0, 0)
                blade.scale.set(item.from < 0 ? 1 : -1, 1 - 0.3 * Math.abs(Math.sin(age * 16)))
                blade.alpha = MathLib.clamp01(age / 0.12)
              }
            }
          })
          return
        }
        case 'echo': {
          var texture = cache.echo(item.text, item.color, item.size, item.axis)
          var strip = new pixi.TilingSprite({
            texture: texture,
            width: item.axis === 'x' ? item.width : texture.width,
            height: item.axis === 'x' ? texture.height : item.height
          })
          strip.anchor.set(0.5)
          strip.position.set(item.x, item.y)
          strip.rotation = item.rotation
          back.addChild(strip)
          parts.push({
            update: function (time) {
              var enter = MathLib.easeOutCubic((time - item.at) / 0.6)
              var exit = leave(time, item.exitAt, item.exitDuration)
              var alpha = item.alpha * enter * (1 - exit)
              strip.visible = alpha > 0.002
              if (!strip.visible) return
              strip.alpha = alpha
              strip.scale.set(1 + 0.06 * (1 - enter))
              if (item.axis === 'x') strip.tilePosition.x = item.speed * time
              else strip.tilePosition.y = item.speed * time
            }
          })
          return
        }
        case 'patch': {
          var holderP = new pixi.Container()
          holderP.position.set(item.x, item.y)
          var hw = item.width / 2
          var hh = item.height / 2
          var border = Math.max(3, Math.min(item.width, item.height) * 0.025)
          var shadowP = rect(holderP, Plan.CANDY_INK, item.dark ? 0.35 : 0.3)
          setRect(shadowP, -hw - border + border * 2.2, -hh - border + border * 2.6, item.width + border * 2, item.height + border * 2)
          var rim = rect(holderP, 0xffffff, item.dark ? 0.9 : 1)
          setRect(rim, -hw - border, -hh - border, item.width + border * 2, item.height + border * 2)
          var fill = rect(holderP, item.color, item.dark ? 0.86 : 1)
          setRect(fill, -hw, -hh, item.width, item.height)
          if (item.pattern !== 'plain') {
            var patternSprite = new pixi.TilingSprite({ texture: cache.pattern(item.pattern), width: item.width, height: item.height })
            patternSprite.position.set(-hw, -hh)
            patternSprite.alpha = item.dark ? 0.16 : 0.45
            holderP.addChild(patternSprite)
          }
          back.addChild(holderP)
          parts.push({
            update: function (time) {
              var enter = popIn(time, item.at, 0.36)
              var exit = leave(time, item.exitAt, item.exitDuration)
              holderP.visible = time >= item.at && exit < 1
              if (!holderP.visible) return
              holderP.alpha = MathLib.clamp01((time - item.at) / 0.12) * (1 - exit)
              holderP.scale.set(1.14 - 0.14 * enter)
              holderP.rotation = item.rotation + 0.12 * (1 - Math.min(1, enter))
              holderP.y = item.y + exit * item.height * 0.15
            }
          })
          return
        }
        case 'window': {
          var holderW = new pixi.Container()
          holderW.position.set(item.x, item.y)
          holderW.rotation = item.rotation
          var hwW = item.width / 2
          var hhW = item.height / 2
          var borderW = Math.max(2.5, item.bar * 0.12)
          var offset = item.bar * 0.32
          // 糖果粉的硬阴影：日系 PV 的界面窗口不用灰影。
          setRect(rect(holderW, Plan.CANDY[0], 0.85), -hwW + offset, -hhW + offset, item.width, item.height)
          setRect(rect(holderW, 0xffffff), -hwW - borderW, -hhW - borderW, item.width + borderW * 2, item.height + borderW * 2)
          setRect(rect(holderW, 0x1d1838, 0.62), -hwW, -hhW + item.bar, item.width, item.height - item.bar)
          var titleColor = Plan.CANDY[(Math.abs(Math.round(item.x + item.y)) % Plan.CANDY.length)]
          setRect(rect(holderW, titleColor), -hwW, -hhW, item.width, item.bar)
          // 标题栏右边三颗圆点按钮。
          ;[0xff8fb5, 0xffe27a, 0x8ff0c8].forEach(function (color, k) {
            var dot = new pixi.Sprite(textures.dot)
            dot.anchor.set(0.5)
            dot.tint = color
            dot.width = dot.height = item.bar * 0.42
            dot.position.set(hwW - item.bar * (0.55 + k * 0.6), -hhW + item.bar / 2)
            holderW.addChild(dot)
          })
          var title = new pixi.Sprite(cache.label(item.title, titleColor, item.bar * 0.48))
          title.anchor.set(0, 0.5)
          title.scale.set(0.92)
          title.position.set(-hwW + item.bar * 0.25, -hhW + item.bar / 2)
          holderW.addChild(title)
          back.addChild(holderW)
          parts.push({
            update: function (time) {
              var enter = popIn(time, item.at, 0.34)
              var exit = leave(time, item.exitAt, item.exitDuration)
              holderW.visible = time >= item.at && exit < 1
              if (!holderW.visible) return
              holderW.alpha = MathLib.clamp01((time - item.at) / 0.1) * (1 - MathLib.easeInCubic(exit))
              holderW.scale.set((0.86 + 0.14 * enter) * (1 - 0.12 * exit))
            }
          })
          return
        }
        case 'sticker': {
          var sprite = new pixi.Sprite(cache.sticker(item.shape, item.color, item.label))
          sprite.anchor.set(0.5)
          sprite.position.set(item.x, item.y)
          ;(item.layer === 'back' ? back : front).addChild(sprite)
          var base = stickerScale(item.size)
          var phase = (item.x * 0.013 + item.y * 0.007) % MathLib.TAU
          parts.push({
            update: function (time) {
              var exit = leave(time, item.exitAt, Math.min(0.3, item.exitDuration))
              sprite.visible = time >= item.at && exit < 1
              if (!sprite.visible) return
              var enter = popIn(time, item.at)
              var age = time - item.at
              sprite.scale.set(base * enter * (1 - MathLib.easeInCubic(exit)))
              sprite.rotation = item.rotation + (1 - Math.min(1, enter)) * 0.8 + Math.sin(age * 2.6 + phase) * 0.07 + exit * 0.9
              sprite.y = item.y + Math.sin(age * 1.9 + phase) * item.size * 0.05
            }
          })
          return
        }
        case 'tape': {
          var spriteT = new pixi.Sprite(cache.tape(item.color, item.pattern))
          spriteT.anchor.set(0.5)
          spriteT.position.set(item.x, item.y)
          spriteT.rotation = item.rotation
          front.addChild(spriteT)
          var sx = item.length / (spriteT.texture.width || 1)
          var sy = item.width / (spriteT.texture.height || 1)
          parts.push({
            update: function (time) {
              var exit = leave(time, item.exitAt, item.exitDuration)
              spriteT.visible = time >= item.at && exit < 1
              if (!spriteT.visible) return
              // 「啪」地贴上：从稍大处压下来。
              var stick = MathLib.easeOutCubic((time - item.at) / 0.16)
              spriteT.scale.set(sx * (1.25 - 0.25 * stick), sy * (1.25 - 0.25 * stick))
              spriteT.alpha = stick * (1 - exit)
            }
          })
          return
        }
        case 'label': {
          var spriteL = new pixi.Sprite(cache.label(item.text, item.color, item.size))
          spriteL.anchor.set(0.5)
          spriteL.position.set(item.x, item.y)
          spriteL.rotation = item.rotation
          front.addChild(spriteL)
          parts.push({
            update: function (time) {
              var exit = leave(time, item.exitAt, item.exitDuration)
              spriteL.visible = time >= item.at && exit < 1
              if (!spriteL.visible) return
              spriteL.scale.set(popIn(time, item.at, 0.28) * (1 - MathLib.easeInCubic(exit)))
            }
          })
          return
        }
        case 'headline': {
          var spriteH = new pixi.Sprite(cache.sound(item.text, item.color, item.size))
          spriteH.anchor.set(0.5)
          spriteH.position.set(item.x, item.y)
          back.addChild(spriteH)
          parts.push({
            update: function (time) {
              var exit = leave(time, item.exitAt, item.exitDuration)
              spriteH.visible = time >= item.at && exit < 1
              if (!spriteH.visible) return
              var age = time - item.at
              spriteH.scale.set(popIn(time, item.at, 0.4) * (1 - MathLib.easeInCubic(exit)))
              spriteH.rotation = item.rotation + Math.sin(age * 1.6) * 0.015
              spriteH.y = item.y + Math.sin(age * 2.1) * item.size * 0.04
            }
          })
          return
        }
        case 'pop': {
          var spritePop = new pixi.Sprite(cache.icon(item.icon, item.color, item.size))
          spritePop.anchor.set(0.5)
          spritePop.position.set(item.x, item.y)
          front.addChild(spritePop)
          parts.push({
            update: function (time) {
              var age = time - item.at
              spritePop.visible = age >= 0 && age <= item.duration
              if (!spritePop.visible) return
              var fade = MathLib.clamp01((age - (item.duration - 0.35)) / 0.35)
              // 跟着开花蹦出来：从小弹过 1 再落定、转着摆两下；最后往上飘着淡出。
              var pop = MathLib.easeOutBack(age / 0.24, 3)
              var swing = Math.exp(-age / 0.18) * Math.sin(age * 38) * 0.22
              spritePop.scale.set(Math.max(0, pop) * (1 + 0.06 * fade))
              spritePop.rotation = item.rotation + swing
              spritePop.y = item.y - fade * item.size * 0.6
              spritePop.alpha = 1 - MathLib.easeInCubic(fade)
            }
          })
          return
        }
        case 'whoosh': {
          var spriteW = new pixi.Sprite(cache.icon(item.icon, item.color, item.size))
          spriteW.anchor.set(0.5)
          front.addChild(spriteW)
          parts.push({
            update: function (time) {
              var age = time - item.at
              var life = item.duration + 0.55
              spriteW.visible = age >= 0 && age <= life
              if (!spriteW.visible) return
              var p = MathLib.easeOutCubic(age / item.duration)
              // 贴着尾迹的头、偏右一点往上走，一路转着；到顶后停一下再淡出。
              spriteW.position.set(
                item.fromX + (item.toX - item.fromX) * p + item.size * 0.8,
                item.fromY + (item.toY - item.fromY) * p + item.size * 0.3
              )
              spriteW.alpha = MathLib.clamp01(age / 0.08) * (1 - MathLib.clamp01((age - item.duration - 0.2) / 0.35))
              spriteW.rotation = p * Math.PI * 1.5
              spriteW.scale.set(0.7 + 0.3 * MathLib.clamp01(age / item.duration))
            }
          })
          return
        }
        case 'floater': {
          var spriteF = new pixi.Sprite(cache.sticker(item.shape, item.color, null))
          spriteF.anchor.set(0.5)
          front.addChild(spriteF)
          var baseF = stickerScale(item.size)
          var phaseF = (item.x * 0.017) % MathLib.TAU
          parts.push({
            update: function (time) {
              var age = time - item.at
              spriteF.visible = age >= 0 && age <= item.duration
              if (!spriteF.visible) return
              var p = age / item.duration
              spriteF.position.set(item.x + Math.sin(age * 2.2 + phaseF) * item.sway, item.y - item.rise * p)
              spriteF.rotation = Math.sin(age * 1.7 + phaseF) * 0.25
              spriteF.scale.set(baseF * Math.min(1, popIn(time, item.at, 0.3)))
              spriteF.alpha = 1 - MathLib.clamp01((p - 0.82) / 0.18)
            }
          })
          return
        }
      }
    }

    plan.items.forEach(build)

    return {
      back: back,
      front: front,
      update: function (time) { parts.forEach(function (part) { part.update(time) }) },
      // 纹理归缓存（场景单元销毁时一起放），这里只拆显示树。
      // Pixi v8 销毁纪律（PORTING.md）：逐节点无参 destroy（上游写 destroy({ children: true })）。
      destroy: function () {
        window.FoliaHanabiBloom.destroyPixiDisplayTree(back)
        window.FoliaHanabiBloom.destroyPixiDisplayTree(front)
      }
    }
  }

  window.FoliaHanabiCollageViews = {
    createShotCollage: createShotCollage
  }
})()
