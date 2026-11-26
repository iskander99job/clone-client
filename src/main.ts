import Phaser from 'phaser'
import { aim, CELL, Duel, FRUIT_ISLAND, initPhysics, MAX_WIND, RADIUS, terrainMaskFromPixels, type Fighter } from './duel'
import terrainUrl from './assets/fruit-island.png'
import orchardUrl from './assets/fruit-orchard.webp'

import './style.css'

const { width: WIDTH, height: HEIGHT, waterY } = FRUIT_ISLAND

const status = document.querySelector<HTMLParagraphElement>('#status')!
const wind = document.querySelector<HTMLParagraphElement>('#wind')!
const fire = document.querySelector<HTMLButtonElement>('#fire')!
const restart = document.querySelector<HTMLButtonElement>('#restart')!
type Direction = 'left' | 'right' | 'up' | 'down'
const directions = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-control]'))
const keys: Record<string, Direction> = {
  ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down',
}
const power = document.querySelector<HTMLInputElement>('#power')!
const angleValue = document.querySelector<HTMLOutputElement>('#angle-value')!
const powerValue = document.querySelector<HTMLOutputElement>('#power-value')!
const hp = ['player', 'bot'].map(id => ({
  label: document.querySelector<HTMLElement>('#' + id + '-hp')!,
  bar: document.querySelector<HTMLProgressElement>('#' + id + '-bar')!,
}))

class Arena extends Phaser.Scene {
  duel!: Duel
  ground!: Phaser.Textures.CanvasTexture
  action!: Phaser.GameObjects.Graphics
  accumulator = 0
  drawnRevision = 0
  held = new Map<number | string, Direction>()
  tapped = new Set<Direction>()

  terrainImage!: CanvasImageSource
  initialMask!: number[]

  preload() {
    this.load.image('terrain-art', terrainUrl)
    this.load.image('orchard', orchardUrl)
  }

  create() {
    const terrain = this.textures.get('terrain-art').getSourceImage()
    if (!this.textures.exists('orchard') || !this.textures.exists('terrain-art') || !(terrain instanceof HTMLImageElement)) {
      status.textContent = 'Не удалось загрузить карту'
      return
    }
    this.terrainImage = terrain
    const pixels = document.createElement('canvas')
    pixels.width = WIDTH
    pixels.height = HEIGHT
    const context = pixels.getContext('2d')!
    context.drawImage(this.terrainImage, 0, 0, WIDTH, HEIGHT)
    this.initialMask = terrainMaskFromPixels(context.getImageData(0, 0, WIDTH, HEIGHT).data, WIDTH, HEIGHT)
    this.add.image(0, 0, 'orchard').setOrigin(0).setDisplaySize(WIDTH, HEIGHT)
    this.ground = this.textures.createCanvas('ground', WIDTH, HEIGHT)!
    this.add.image(0, 0, 'ground').setOrigin(0)
    this.action = this.add.graphics()
    const water = this.textures.createCanvas('water', 2, HEIGHT - waterY)!
    const waterContext = water.context
    const fill = waterContext.createLinearGradient(0, 0, 0, HEIGHT - waterY)
    fill.addColorStop(0, 'rgba(18, 184, 199, 0.53)')
    fill.addColorStop(1, '#006d9d')
    waterContext.fillStyle = fill
    waterContext.fillRect(0, 0, 2, HEIGHT - waterY)
    waterContext.fillStyle = 'rgba(192, 255, 245, 0.85)'
    waterContext.fillRect(0, 0, 2, 2)
    water.refresh()
    this.add.image(0, waterY, 'water').setOrigin(0).setDisplaySize(WIDTH, HEIGHT - waterY)
    this.newMatch()
    restart.addEventListener('click', () => this.newMatch())
    fire.addEventListener('click', () => {
      if (this.duel.phase === 'aim') {
        this.duel.fire(this.duel.angle, this.duel.power)
        this.updateControls()
      }
    })
    power.addEventListener('input', () => {
      this.duel.power = power.valueAsNumber
      this.updateControls()
    })
    this.bindDirections()
  }

  bindDirections() {
    for (const button of directions) {
      const direction = button.dataset.control as Direction
      button.addEventListener('pointerdown', event => {
        if (button.disabled || event.button !== 0) return
        button.setPointerCapture(event.pointerId)
        this.held.set(event.pointerId, direction)
        this.tapped.add(direction)
      })
      for (const eventName of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) {
        button.addEventListener(eventName, event => this.held.delete(event.pointerId))
      }
      button.addEventListener('click', event => {
        if (event.detail === 0 && !button.disabled) this.tapped.add(direction)
      })
    }
    window.addEventListener('keydown', event => {
      const direction = keys[event.key]
      if (!direction || this.duel.phase !== 'aim' || event.target === power) return
      event.preventDefault()
      if (!event.repeat) {
        this.held.set(event.key, direction)
        this.tapped.add(direction)
      }
    })
    window.addEventListener('keyup', event => this.held.delete(event.key))
    window.addEventListener('blur', () => this.clearDirections())
  }

  clearDirections() {
    this.held.clear()
    this.tapped.clear()
  }

  newMatch() {
    this.duel?.world.free()
    this.duel = new Duel(false, this.initialMask, FRUIT_ISLAND)
    this.accumulator = 0
    this.drawnRevision = 0
    power.value = String(this.duel.power)
    this.clearDirections()
    this.updateControls()
    this.draw()
  }

  update(_time: number, delta: number) {
    if (!this.duel) return
    this.accumulator += Math.min(delta, 100)
    while (this.accumulator >= 1000 / 60) {
      const active = new Set([...this.held.values(), ...this.tapped])
      this.duel.tick(
        Number(active.has('right')) - Number(active.has('left')),
        Number(active.has('up')) - Number(active.has('down')),
      )
      this.tapped.clear()
      this.accumulator -= 1000 / 60
    }
    this.updateControls()
    this.draw()
  }

  updateControls() {
    const { phase, winner, turn, fighters } = this.duel
    const enabled = phase === 'aim'
    if (!enabled) this.clearDirections()
    fire.disabled = power.disabled = !enabled
    for (const button of directions) {
      button.disabled = !enabled
      button.toggleAttribute('data-held', [...this.held.values()].includes(button.dataset.control as Direction))
    }
    const currentAngle = this.duel.angle + '°'
    const currentPower = this.duel.power + '%'
    if (angleValue.value !== currentAngle) angleValue.value = currentAngle
    if (powerValue.value !== currentPower) powerValue.value = currentPower
    const message = {
      aim: 'Твой ход',
      bot: 'Искра целится…',
      flight: turn ? 'Выстрел Искры' : 'Твой выстрел',
      settle: 'Ход завершается…',
      over: winner === 0 ? 'Ты победил!' : winner === 1 ? 'Искра победила' : 'Ничья',
    }[phase]
    if (status.textContent !== message) status.textContent = message
    const windPercent = Math.round(Math.abs(this.duel.wind) / MAX_WIND * 100)
    const windLabel = this.duel.wind === 0
      ? 'Ветер: штиль'
      : `Ветер: ${this.duel.wind > 0 ? 'вправо →' : '← влево'} · ${windPercent}%`
    if (wind.textContent !== windLabel) wind.textContent = windLabel
    fighters.forEach((fighter, i) => {
      if (hp[i].bar.value !== fighter.hp) {
        hp[i].label.textContent = String(fighter.hp)
        hp[i].bar.value = fighter.hp
      }
    })
  }

  drawTerrain() {
    const ctx = this.ground.context
    ctx.clearRect(0, 0, WIDTH, HEIGHT)
    ctx.save()
    ctx.beginPath()
    for (const ring of this.duel.rings) {
      ring.forEach(([x, y], i) => {
        if (i === 0) ctx.moveTo(x * CELL, y * CELL)
        else ctx.lineTo(x * CELL, y * CELL)
      })
      ctx.closePath()
    }
    ctx.clip('evenodd')
    ctx.drawImage(this.terrainImage, 0, 0, WIDTH, HEIGHT)
    ctx.restore()
    this.ground.refresh()
  }

  drawFighter(fighter: Fighter, index: number) {
    if (!fighter.hp) return
    const g = this.action
    const { x, y } = fighter.body.translation()
    const angle = index ? this.duel.botAngle : this.duel.angle
    const direction = aim(angle, fighter.direction)
    const mint = index === 0
    const color = mint ? 0x8bf0b9 : 0xff9b6d
    const shade = mint ? 0x439b8d : 0xcd5e55
    const outline = 0x152833
    g.fillStyle(outline)
    g.fillEllipse(x - 15, y + 24, 25, 17)
    g.fillEllipse(x + 15, y + 24, 25, 17)
    if (mint) {
      g.fillTriangle(x - 29, y - 11, x - 25, y - 44, x - 4, y - 23)
      g.fillTriangle(x + 29, y - 11, x + 25, y - 44, x + 4, y - 23)
      g.fillStyle(shade)
      g.fillTriangle(x - 25, y - 14, x - 22, y - 35, x - 8, y - 22)
      g.fillTriangle(x + 25, y - 14, x + 22, y - 35, x + 8, y - 22)
    } else {
      g.fillTriangle(x - 21, y - 20, x - 6, y - 47, x + 2, y - 29)
      g.fillTriangle(x - 8, y - 24, x + 13, y - 43, x + 19, y - 19)
    }
    g.fillStyle(outline).fillCircle(x, y, RADIUS + 3)
    g.fillStyle(shade).fillCircle(x, y + 1, RADIUS)
    g.fillStyle(color).fillEllipse(x, y - 4, 58, 51)
    g.fillStyle(0xfff1cd, 0.65).fillEllipse(x - 11, y - 18, 16, 7)
    const face = x + fighter.direction * 5
    g.fillStyle(0xfff4da)
    g.fillEllipse(face - 9, y - 4, 14, 18)
    g.fillEllipse(face + 7, y - 5, 14, 18)
    g.fillStyle(outline)
    g.fillCircle(face - 9 + fighter.direction * 3, y - 3, 4)
    g.fillCircle(face + 7 + fighter.direction * 3, y - 4, 4)
    g.fillEllipse(face, y + 10, 10, 4)
    const handle = { x: x + direction.x * 20, y: y + direction.y * 20 }
    const muzzle = this.duel.muzzle(fighter, angle)
    g.lineStyle(16, outline).lineBetween(handle.x, handle.y, muzzle.x, muzzle.y)
    g.lineStyle(10, 0x537686).lineBetween(handle.x, handle.y, muzzle.x, muzzle.y)
    g.fillStyle(0xffd370).fillCircle(muzzle.x, muzzle.y, 5)
    if (mint && this.duel.phase === 'aim') {
      for (let i = 1; i <= 5; i++) {
        const spacing = 7 + this.duel.power / 13
        g.fillStyle(0xffedab, 1 - i / 7)
        g.fillCircle(muzzle.x + direction.x * i * spacing, muzzle.y + direction.y * i * spacing, 2.7)
      }
    }
  }

  draw() {
    if (this.drawnRevision !== this.duel.revision) {
      this.drawTerrain()
      this.drawnRevision = this.duel.revision
    }
    const g = this.action.clear()
    this.duel.fighters.forEach((fighter, i) => this.drawFighter(fighter, i))
    const { trail, rocket, blast, blastAge } = this.duel
    trail.forEach((point, i) => {
      const opacity = (i + 1) / trail.length
      g.fillStyle(0xffd183, opacity * 0.46).fillCircle(point.x, point.y, 5 * opacity)
    })
    if (rocket) {
      const { x, y } = rocket.translation()
      const velocity = rocket.linvel()
      const heading = Math.atan2(velocity.y, velocity.x)
      g.lineStyle(8, 0xff985a).lineBetween(x - Math.cos(heading) * 12, y - Math.sin(heading) * 12, x, y)
      g.fillStyle(0xfff1b9).fillCircle(x, y, 5)
    }
    if (blast && blastAge < 0.58) {
      const life = blastAge / 0.58
      g.fillStyle(0xffa860, (1 - life) * 0.6).fillCircle(blast.x, blast.y, 22 + life * 53)
      g.fillStyle(0xfff2ba, (1 - life) ** 2).fillCircle(blast.x, blast.y, 15 + life * 26)
      for (let i = 0; i < 15; i++) {
        const radius = life * (38 + i * 4)
        const heading = i * Math.PI * 2 / 15
        g.fillStyle(i % 2 ? 0xffd370 : 0xfee6b3, 1 - life)
        g.fillCircle(blast.x + Math.cos(heading) * radius, blast.y + Math.sin(heading) * radius, 5 * (1 - life) + 1)
      }
    }
  }
}

initPhysics().then(() => {
  new Phaser.Game({
    type: Phaser.AUTO,
    width: WIDTH,
    height: HEIGHT,
    parent: 'field',
    backgroundColor: '#203c55',
    scene: Arena,
    scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
    audio: { noAudio: true },
  })
}).catch(error => {
  status.textContent = 'Не удалось запустить игру'
  console.error(error)
})
