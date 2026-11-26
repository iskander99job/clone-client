import Phaser from 'phaser'
import { aim, CELL, Duel, HEIGHT, initPhysics, MAX_WIND, RADIUS, WIDTH, type Fighter, type ReplayFrame } from './duel'
import { createMatch, getMatch, joinMatch, sessionValue, submitShot, type Match } from './online'
import './style.css'

const online = document.querySelector<HTMLButtonElement>('#online')!
const skip = document.querySelector<HTMLButtonElement>('#skip')!
const invite = document.querySelector<HTMLInputElement>('#invite')!
const inviteControl = document.querySelector<HTMLLabelElement>('#invite-control')!
const connection = document.querySelector<HTMLParagraphElement>('#connection')!
const mode = document.querySelector<HTMLElement>('#mode')!
const names = ['player', 'bot'].map(id => document.querySelector<HTMLElement>('#' + id + '-name')!)
const status = document.querySelector<HTMLParagraphElement>('#status')!
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
  match?: Match
  token?: string
  inviteId = new URL(location.href).searchParams.get('match')?.match(/^[\w-]{16}$/)?.[0]
  busy = false
  polling = false
  replayTime = 0
  replayFrame?: ReplayFrame
  replaying = false
  replayImpact?: number

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
    restart.addEventListener('click', () => {
      this.match = undefined
      this.inviteId = undefined
      this.token = undefined
      this.replaying = false
      this.replayFrame = undefined
      this.setRoomUrl()
      this.report()
      this.newMatch()
    })
    fire.addEventListener('click', () => void this.fireShot())
    online.addEventListener('click', () => void this.openMatch())
    skip.addEventListener('click', () => this.finishReplay())
    invite.addEventListener('click', () => invite.select())
    window.setInterval(() => {
      if (!document.hidden) void this.poll()
    }, 1800)
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) void this.poll()
    })
    const saved = this.inviteId && sessionValue('crater:' + this.inviteId)
    if (saved) void this.openMatch()
    angle.addEventListener('input', () => this.readAim())
    power.addEventListener('input', () => this.readAim())
  }

  setRoomUrl(id?: string) {
    const url = new URL(location.href)
    if (id) url.searchParams.set('match', id)
    else url.searchParams.delete('match')
    history.replaceState(null, '', url)
  }

  report(message = '') {
    connection.hidden = !message
    connection.textContent = message
  }

  async openMatch() {
    if (this.busy) return
    if (this.match) {
      invite.focus()
      invite.select()
      try {
        await navigator.clipboard.writeText(invite.value)
        this.report('Ссылка скопирована')
      } catch {
        this.report('Скопируй выделенную ссылку')
      }
      return
    }
    this.busy = true
    this.report('Подключение…')
    try {
      const saved = this.inviteId && sessionValue('crater:' + this.inviteId)
      const entry = this.inviteId
        ? saved
          ? { token: saved, match: (await getMatch(this.inviteId, saved))! }
          : await joinMatch(this.inviteId)
        : await createMatch()
      this.token = entry.token
      this.inviteId = entry.match.id
      sessionValue('crater:' + entry.match.id, entry.token)
      this.setRoomUrl(entry.match.id)
      invite.value = location.href
      this.installMatch(entry.match, entry.match.replay?.seat !== entry.match.seat)
      this.report()
    } catch (error) {
      this.report((error as Error).message)
    } finally {
      this.busy = false
    }
  }

  async poll() {
    const match = this.match
    const token = this.token
    if (!match || !token || this.busy || this.polling || this.replaying || match.state.finished) return
    this.polling = true
    try {
      const next = await getMatch(match.id, token, match.version)
      if (this.match?.id === match.id) {
        if (next && next.version > this.match.version) this.installMatch(next, true)
        if (connection.textContent === 'Нет связи. Повторяем подключение…') this.report()
      }
    } catch {
      if (this.match?.id === match.id) this.report('Нет связи. Повторяем подключение…')
    } finally {
      this.polling = false
    }
  }

  canFire() {
    return this.match
      ? this.match.ready && this.match.state.turn === this.match.seat && !this.match.state.finished && !this.replaying && !this.busy
      : !this.inviteId && !this.busy && this.duel.phase === 'aim'
  }

  async fireShot() {
    if (!this.canFire()) return
    if (!this.match || !this.token) {
      this.duel.fire(this.duel.angle, this.duel.power)
      this.updateControls()
      return
    }
    this.busy = true
    try {
      this.installMatch(await submitShot(this.match, this.token, this.duel.angle, this.duel.power), true)
      this.report()
    } catch (error) {
      this.report((error as Error).message)
    } finally {
      this.busy = false
      void this.poll()
    }
  }

  installMatch(match: Match, play: boolean) {
    const first = !this.match
    this.match = match
    if (first) {
      this.duel.world.free()
      this.duel = new Duel(true)
      this.drawnRevision = 0
    }
    const replay = play ? match.replay : null
    this.replaying = Boolean(replay)
    this.replayTime = 0
    this.replayImpact = undefined
    this.replayFrame = undefined
    this.duel.restore(replay?.before ?? match.state)
    if (replay) this.showReplayFrame(0)
    mode.textContent = 'ОНЛАЙН-ДУЭЛЬ'
    names[0].textContent = match.seat === 0 ? 'Мята · ты' : 'Мята · друг'
    names[1].textContent = match.seat === 1 ? 'Искра · ты' : 'Искра · друг'
  }

  showReplayFrame(index: number) {
    const match = this.match!
    const frame = match.replay!.frames[index]
    if (!frame) {
      this.finishReplay()
      return
    }
    if (frame === this.replayFrame) return
    this.replayFrame = frame
    this.duel.fighters.forEach((fighter, seat) => fighter.body.setTranslation(frame.positions[seat], false))
    if (frame.rocket) {
      this.duel.trail.push(frame.rocket.position)
      if (this.duel.trail.length > 12) this.duel.trail.shift()
    } else {
      this.duel.trail = []
    }
    if (frame.blast && this.replayImpact === undefined) {
      this.replayImpact = this.replayTime
      this.duel.blast = frame.blast
      if (this.duel.mask.join('') !== match.state.mask) {
        this.duel.mask = Array.from(match.state.mask, Number)
        this.duel.rebuildTerrain()
      }
    }
  }

  finishReplay() {
    if (!this.replaying || !this.match) return
    this.replaying = false
    this.replayFrame = undefined
    this.duel.restore(this.match.state)
  }

  newMatch() {
    this.duel?.world.free()
    this.duel = new Duel()
    mode.textContent = 'ДУЭЛЬ С БОТОМ'
    names[0].textContent = 'Мята · ты'
    names[1].textContent = 'Искра · бот'
    this.accumulator = 0
    this.drawnRevision = 0
    angle.value = String(this.duel.angle)
    power.value = String(this.duel.power)
    this.readAim()
    this.updateControls()
    this.draw()
  }

  readAim() {
    this.duel.angle = angle.valueAsNumber
    this.duel.power = power.valueAsNumber
    angleValue.value = this.duel.angle + '°'
    powerValue.value = this.duel.power + '%'
  }

  update(_time: number, delta: number) {
    if (this.replaying) {
      this.replayTime += Math.min(delta, 100)
      this.showReplayFrame(Math.floor(this.replayTime / 50))
      if (this.replayImpact !== undefined) this.duel.blastAge = (this.replayTime - this.replayImpact) / 1000
    } else if (!this.match && !this.inviteId && !this.busy) {
      this.accumulator += Math.min(delta, 100)
      while (this.accumulator >= 1000 / 60) {
        this.duel.tick()
        this.accumulator -= 1000 / 60
      }
    }
    this.updateControls()
    this.draw()
  }

  updateControls() {
    const { phase, winner, turn, fighters } = this.duel
    fire.disabled = angle.disabled = power.disabled = !this.canFire()
    online.disabled = this.busy || this.replaying || (!this.match && !this.inviteId && phase !== 'aim' && phase !== 'over')
    restart.disabled = this.busy
    const restartLabel = this.match || this.inviteId ? 'Тренировка' : 'Заново'
    if (restart.textContent !== restartLabel) restart.textContent = restartLabel
    online.hidden = Boolean(this.match?.ready)
    const onlineLabel = this.match ? 'Скопировать приглашение' : this.inviteId ? 'Вступить в дуэль' : 'Позвать друга'
    if (online.textContent !== onlineLabel) online.textContent = onlineLabel
    inviteControl.hidden = !this.match || this.match.ready
    skip.hidden = !this.replaying
    const localMessage = {
      aim: 'Твой ход',
      bot: 'Искра целится…',
      flight: turn ? 'Выстрел Искры' : 'Твой выстрел',
      settle: 'Ход завершается…',
      over: winner === 0 ? 'Ты победил!' : winner === 1 ? 'Искра победила' : 'Ничья',
    }[phase]
    const message = this.match
      ? this.replaying ? 'Повтор выстрела'
        : this.match.state.finished
          ? winner === null ? 'Ничья' : winner === this.match.seat ? 'Ты победил!' : 'Друг победил'
          : !this.match.ready ? 'Ждём друга'
            : this.match.state.turn === this.match.seat ? 'Твой ход' : 'Ход друга'
      : this.inviteId ? 'Приглашение на дуэль' : localMessage
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
    const replay = this.replaying ? this.match?.replay : null
    const localSeat = this.match?.seat ?? 0
    const angle = replay?.seat === index ? replay.angle : index === localSeat ? this.duel.angle : this.duel.botAngle
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
    if (index === localSeat && this.canFire()) {
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
    const projectile = this.replayFrame?.rocket ?? (rocket && { position: rocket.translation(), velocity: rocket.linvel() })
    if (projectile) {
      const { x, y } = projectile.position
      const velocity = projectile.velocity
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
