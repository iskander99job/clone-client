import Phaser from 'phaser'
import RAPIER from '@dimforge/rapier2d-compat'
import { aim, CELL, Duel, HEIGHT, MAX_WIND, RADIUS, WIDTH, type Fighter, type Weapon } from './duel'
import './style.css'

const status = document.querySelector<HTMLParagraphElement>('#status')!
const weapon = document.querySelector<HTMLSelectElement>('#weapon')!
const powerControl = document.querySelector<HTMLLabelElement>('#power-control')!
const wind = document.querySelector<HTMLParagraphElement>('#wind')!
const fire = document.querySelector<HTMLButtonElement>('#fire')!
const restart = document.querySelector<HTMLButtonElement>('#restart')!
const angle = document.querySelector<HTMLInputElement>('#angle')!
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

  create() {
    const sky = this.textures.createCanvas('sky', WIDTH, HEIGHT)!
    const ctx = sky.context
    const gradient = ctx.createLinearGradient(0, 0, 0, HEIGHT)
    gradient.addColorStop(0, '#203c55')
    gradient.addColorStop(1, '#d29880')
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, WIDTH, HEIGHT)
    ctx.fillStyle = '#ffd88c'
    ctx.beginPath()
    ctx.arc(495, 121, 43, 0, Math.PI * 2)
    ctx.fill()
    for (let i = 0; i < 34; i++) {
      ctx.fillStyle = i % 3 ? '#b3d5df80' : '#f6e6ba'
      ctx.fillRect((i * 137 + 27) % WIDTH, (i * 59 + 12) % 222, i % 4 ? 2 : 3, 2)
    }
    for (let layer = 0; layer < 3; layer++) {
      ctx.fillStyle = ['#5a637b', '#40566b', '#2e4858'][layer]
      ctx.beginPath()
      ctx.moveTo(0, HEIGHT)
      for (let x = 0; x <= WIDTH; x += 20) {
        ctx.lineTo(x, 236 + layer * 28 + 36 * Math.sin(x / (67 - layer * 8) + layer * 1.5) + 12 * Math.cos(x / 22))
      }
      ctx.lineTo(WIDTH, HEIGHT)
      ctx.fill()
    }
    sky.refresh()
    this.add.image(0, 0, 'sky').setOrigin(0)
    this.ground = this.textures.createCanvas('ground', WIDTH, HEIGHT)!
    this.add.image(0, 0, 'ground').setOrigin(0)
    this.action = this.add.graphics()
    this.newMatch()
    restart.addEventListener('click', () => this.newMatch())
    fire.addEventListener('click', () => {
      if (this.duel.phase === 'aim') {
        this.duel.fire(this.duel.angle, this.duel.power, this.duel.weapon)
        this.updateControls()
      }
    })
    weapon.addEventListener('change', () => {
      if (this.duel.phase !== 'aim') return
      this.duel.weapon = weapon.value as Weapon
      this.syncWeapon()
      this.readAim()
    })
    angle.addEventListener('input', () => this.readAim())
    power.addEventListener('input', () => this.readAim())
  }

  newMatch() {
    this.duel?.world.free()
    this.duel = new Duel()
    this.accumulator = 0
    this.drawnRevision = 0
    weapon.value = this.duel.weapon
    this.syncWeapon()
    angle.value = String(this.duel.angle)
    power.value = String(this.duel.power)
    this.readAim()
    this.updateControls()
    this.draw()
  }

  syncWeapon() {
    const uzi = this.duel.weapon === 'uzi'
    angle.min = uzi ? '-45' : '12'
    if (uzi) angle.value = '3'
    powerControl.hidden = uzi
  }

  readAim() {
    this.duel.angle = angle.valueAsNumber
    this.duel.power = power.valueAsNumber
    angleValue.value = this.duel.angle + '°'
    powerValue.value = this.duel.power + '%'
  }

  update(_time: number, delta: number) {
    this.accumulator += Math.min(delta, 100)
    while (this.accumulator >= 1000 / 60) {
      this.duel.tick()
      this.accumulator -= 1000 / 60
    }
    this.updateControls()
    this.draw()
  }

  updateControls() {
    const { phase, winner, turn, fighters } = this.duel
    fire.disabled = angle.disabled = weapon.disabled = phase !== 'aim'
    power.disabled = phase !== 'aim' || this.duel.weapon === 'uzi'
    const burstSelected = this.duel.weapon === 'uzi'
    const fireLabel = burstSelected ? 'Дать очередь' : 'Выстрелить'
    if (fire.textContent !== fireLabel) fire.textContent = fireLabel
    const message = {
      aim: 'Твой ход',
      bot: 'Искра целится…',
      flight: turn ? 'Выстрел Искры' : burstSelected ? 'Очередь Узи' : 'Твой выстрел',
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
    const soil = ctx.createLinearGradient(0, 260, 0, HEIGHT)
    soil.addColorStop(0, '#51765b')
    soil.addColorStop(0.47, '#395b4d')
    soil.addColorStop(1, '#263e3d')
    ctx.fillStyle = soil
    ctx.fillRect(0, 0, WIDTH, HEIGHT)
    for (let i = 0; i < 410; i++) {
      ctx.fillStyle = i % 3 ? '#afbc7834' : '#142e4066'
      ctx.fillRect((i * 127 + 61) % WIDTH, 243 + (i * 67) % 268, 2 + i % 10, 2 + i % 3)
    }
    ctx.strokeStyle = '#9fbd73'
    ctx.lineWidth = 9
    ctx.stroke()
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
    const weapon = mint ? this.duel.weapon : 'bazooka'
    const muzzle = this.duel.muzzle(fighter, angle, weapon)
    g.lineStyle(weapon === 'uzi' ? 12 : 16, outline).lineBetween(handle.x, handle.y, muzzle.x, muzzle.y)
    g.lineStyle(weapon === 'uzi' ? 6 : 10, 0x537686).lineBetween(handle.x, handle.y, muzzle.x, muzzle.y)
    g.fillStyle(0xffd370).fillCircle(muzzle.x, muzzle.y, 5)
    if (mint && this.duel.phase === 'aim') {
      for (let i = 1; i <= 5; i++) {
        const spacing = weapon === 'uzi' ? 16 : 7 + this.duel.power / 13
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
    for (const { start, end, age, hit } of this.duel.tracers) {
      const opacity = 1 - age / 0.16
      g.lineStyle(2, 0xffde89, opacity).lineBetween(start.x, start.y, end.x, end.y)
      g.fillStyle(0xfff1b9, opacity).fillCircle(start.x, start.y, 6 * opacity)
      if (hit) g.fillStyle(0xffad68, opacity).fillCircle(end.x, end.y, 5 * opacity)
    }
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

RAPIER.init().then(() => {
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
