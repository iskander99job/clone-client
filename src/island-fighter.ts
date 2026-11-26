import type Phaser from 'phaser'
import type { ArenaMap } from './maps'
import walkUrl from './assets/boar-walk.png'
import jumpUrl from './assets/boar-jump.png'

const FRAME = 256
const FEET = 232

export function loadIslandFighter(scene: Phaser.Scene) {
  const frame = { frameWidth: FRAME, frameHeight: FRAME }
  scene.load.spritesheet('boar-walk', walkUrl, frame)
  scene.load.spritesheet('boar-jump', jumpUrl, frame)
}

export async function addIslandFighter(scene: Phaser.Scene, arena: HTMLElement, map: ArenaMap) {
  const { width, height, waterY } = map
  if (!scene.textures.exists('terrain-mask')) throw new Error('PNG карты не загружен')
  const source: unknown = scene.textures.get('terrain-mask').getSourceImage()
  if (!(source instanceof HTMLImageElement || source instanceof HTMLCanvasElement || source instanceof ImageBitmap)) {
    throw new Error('Неподдерживаемый формат изображения карты')
  }
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')!
  context.drawImage(source, 0, 0, width, height)
  const pixels = context.getImageData(0, 0, width, height).data
  const { Duel, initPhysics, RADIUS, STEP, terrainMaskFromPixels } = await import('./duel')
  await initPhysics()
  if (!scene.sys.isActive()) return

  const duel = new Duel(false, terrainMaskFromPixels(pixels, width, height), map)
  const { body } = duel.fighters[0]
  duel.fighters[1].body.setEnabled(false)
  const spawn = body.translation()
  const sprite = scene.add.sprite(spawn.x, spawn.y + RADIUS, 'boar-jump', 0)
    .setOrigin(0.5, FEET / FRAME).setDisplaySize(map.fighterSize, map.fighterSize)
  const input = new AbortController()
  const { signal } = input
  const pressed = new Map<number, number>()
  const heldKeys = new Set<string>()
  let pendingJump = 0
  let crouch = 0
  let landing = 0
  let airborne = false
  let walkTime = 0
  let accumulator = 0

  function button(selector: string) {
    const control = arena.querySelector<HTMLButtonElement>(selector)!
    control.removeAttribute('aria-disabled')
    return control
  }

  for (const [selector, direction] of [['.left', -1], ['.right', 1]] as const) {
    const control = button(selector)
    control.addEventListener('pointerdown', event => {
      if (event.button !== 0) return
      control.setPointerCapture(event.pointerId)
      pressed.set(event.pointerId, direction)
    }, { signal })
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) {
      control.addEventListener(type, event => pressed.delete(event.pointerId), { signal })
    }
    control.addEventListener('keydown', event => {
      if (event.code === 'Enter' || event.code === 'Space') {
        event.preventDefault()
        heldKeys.add(control.classList.contains('left') ? 'ArrowLeft' : 'ArrowRight')
      }
    }, { signal })
    const release = () => heldKeys.delete(direction < 0 ? 'ArrowLeft' : 'ArrowRight')
    control.addEventListener('keyup', release, { signal })
    control.addEventListener('blur', release, { signal })
  }

  function requestJump(direction: number) {
    if (crouch || airborne || landing || !duel.playerGrounded()) return
    pendingJump = direction
    crouch = 0.09
  }

  button('.jump-forward').addEventListener('click', () => requestJump(1), { signal })
  button('.jump-back').addEventListener('click', () => requestJump(-1), { signal })

  window.addEventListener('keydown', event => {
    if (event.altKey || event.ctrlKey || event.metaKey) return
    if (event.code === 'ArrowLeft' || event.code === 'ArrowRight') {
      event.preventDefault()
      heldKeys.add(event.code)
    } else if (event.code === 'Space' && !(event.target instanceof HTMLButtonElement)) {
      event.preventDefault()
      if (!event.repeat) requestJump(1)
    }
  }, { signal })
  window.addEventListener('keyup', event => heldKeys.delete(event.code), { signal })
  window.addEventListener('blur', () => {
    heldKeys.clear()
    pressed.clear()
  }, { signal })

  function step() {
    const directions = [...pressed.values()]
    const move = Number(directions.includes(1) || heldKeys.has('ArrowRight'))
      - Number(directions.includes(-1) || heldKeys.has('ArrowLeft'))
    if (!airborne) duel.movePlayer(crouch || landing ? 0 : move)

    if (crouch > 0) {
      crouch = Math.max(0, crouch - STEP)
      if (crouch === 0) airborne = duel.jumpPlayer(pendingJump)
    }

    duel.world.step()
    const position = body.translation()
    if (position.y >= waterY || position.x < 0 || position.x > width) {
      body.setTranslation(spawn, true)
      body.setLinvel({ x: 0, y: 0 }, true)
      airborne = false
      crouch = 0
      landing = 0
    }

    const velocity = body.linvel()
    const grounded = duel.playerGrounded()
    if (airborne && grounded && velocity.y >= -10) {
      airborne = false
      landing = 0.11
    } else {
      landing = Math.max(0, landing - STEP)
    }

    const feet = body.translation()
    sprite.setPosition(feet.x, feet.y + RADIUS).setFlipX(duel.fighters[0].direction < 0)
    if (crouch) sprite.setTexture('boar-jump', 1)
    else if (airborne || !grounded) {
      const frame = velocity.y < -115 ? 2 : velocity.y < 55 ? 3 : 4
      sprite.setTexture('boar-jump', frame)
    } else if (landing) sprite.setTexture('boar-jump', 5)
    else if (move && Math.abs(velocity.x) > 10) {
      walkTime += STEP
      sprite.setTexture('boar-walk', Math.floor(walkTime * 12) % 6)
    } else {
      walkTime = 0
      sprite.setTexture('boar-jump', 0)
    }
  }

  function update(_time: number, delta: number) {
    accumulator += Math.min(delta / 1000, 0.1)
    while (accumulator >= STEP) {
      step()
      accumulator -= STEP
    }
  }

  scene.events.on('update', update)
  scene.events.once('shutdown', () => {
    input.abort()
    scene.events.off('update', update)
    duel.world.free()
  })
}
