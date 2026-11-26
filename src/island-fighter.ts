import type Phaser from 'phaser'
import type { Point } from './duel'
import type { ArenaMap } from './maps'
import boarSvg from './assets/boar.svg?raw'
import bazookaSvg from './assets/bazooka.svg?raw'
import { SVG_NS } from './svg-viewport'

const FRAME = 256
const FEET = 232

export async function addIslandFighter(
  scene: Phaser.Scene,
  arena: HTMLElement,
  map: ArenaMap,
  cutCrater: ((point: Point, radius: number) => void) | undefined,
  actors: SVGSVGElement,
) {
  const { width, height, waterY } = map
  const source = new Image()
  source.src = map.mask
  await source.decode()
  if (!scene.sys.isActive()) return
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')!
  context.drawImage(source, 0, 0, width, height)
  const pixels = context.getImageData(0, 0, width, height).data
  const { Duel, initPhysics, RADIUS, STEP, BLAST, aim, terrainMaskFromPixels } = await import('./duel')
  await initPhysics()
  if (!scene.sys.isActive()) return

  const duel = new Duel(false, terrainMaskFromPixels(pixels, width, height), map)
  const fighter = duel.fighters[0]
  const { body } = fighter
  duel.wind = 0
  duel.fighters[1].body.setEnabled(false)
  const spawn = body.translation()
  const sprite = actors.appendChild(document.createElementNS(SVG_NS, 'g'))
  sprite.classList.add('boar')
  sprite.innerHTML = boarSvg
  const bodyArt = sprite.querySelector('svg')!
  bodyArt.setAttribute('x', String(-FRAME / 2))
  bodyArt.setAttribute('y', String(-FEET))
  const baseScale = map.fighterSize / FRAME
  sprite.setAttribute('transform', `translate(${spawn.x} ${spawn.y + RADIUS}) scale(${baseScale})`)
  const input = new AbortController()
  const { signal } = input
  const pressed = new Map<number, string>()
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

  const inventory = button('.inventory')
  const shoot = button('.shoot')
  const menu = arena.querySelector<HTMLDialogElement>('#weapon-menu')!
  const bazooka = menu.querySelector<HTMLButtonElement>('[data-weapon="bazooka"]')!
  const unequip = menu.querySelector<HTMLButtonElement>('[data-weapon="none"]')!
  const up = button('.up')
  const down = button('.down')
  let equipped = false
  let angle = 24
  const barrel = actors.appendChild(document.createElementNS(SVG_NS, 'g'))
  barrel.classList.add('bazooka')
  barrel.innerHTML = bazookaSvg
  barrel.querySelector('svg')!.setAttribute('y', '-12')
  const effects = scene.add.graphics().setName('shot-effects')
  let lastBlast: Point | undefined

  function syncWeapon() {
    bazooka.setAttribute('aria-pressed', String(equipped))
    unequip.hidden = !equipped
    up.disabled = down.disabled = !equipped
    shoot.disabled = !equipped || duel.phase !== 'aim'
    barrel.style.display = equipped ? '' : 'none'
  }

  function grip(): Point {
    const position = body.translation()
    return { x: position.x + fighter.direction * 6, y: position.y + 7 }
  }

  inventory.addEventListener('click', () => {
    heldKeys.clear()
    pressed.clear()
    menu.showModal()
    inventory.setAttribute('aria-expanded', 'true')
  }, { signal })
  menu.addEventListener('close', () => {
    inventory.setAttribute('aria-expanded', 'false')
    inventory.focus()
  }, { signal })
  menu.addEventListener('click', event => {
    if (event.target !== menu) return
    const bounds = menu.getBoundingClientRect()
    if (event.clientX < bounds.left || event.clientX > bounds.right
      || event.clientY < bounds.top || event.clientY > bounds.bottom) menu.close()
  }, { signal })
  menu.addEventListener('wheel', event => event.stopPropagation(), { signal })
  menu.querySelector('[data-close-inventory]')!.addEventListener('click', () => menu.close(), { signal })
  for (const [option, active] of [[bazooka, true], [unequip, false]] as const) {
    option.addEventListener('click', () => {
      equipped = active
      syncWeapon()
      menu.close()
    }, { signal })
  }
  shoot.addEventListener('click', () => {
    if (!equipped || duel.phase !== 'aim') return
    duel.fire(angle, 20, grip())
    syncWeapon()
  }, { signal })
  syncWeapon()

  for (const [selector, code] of [
    ['.left', 'ArrowLeft'], ['.right', 'ArrowRight'], ['.up', 'ArrowUp'], ['.down', 'ArrowDown'],
  ] as const) {
    const control = arena.querySelector<HTMLButtonElement>(selector)!
    control.removeAttribute('aria-disabled')
    control.addEventListener('pointerdown', event => {
      if (event.button !== 0) return
      control.setPointerCapture(event.pointerId)
      pressed.set(event.pointerId, code)
    }, { signal })
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) {
      control.addEventListener(type, event => pressed.delete(event.pointerId), { signal })
    }
    control.addEventListener('keydown', event => {
      if (event.code === 'Enter' || event.code === 'Space') {
        event.preventDefault()
        heldKeys.add(code)
      }
    }, { signal })
    const release = () => heldKeys.delete(code)
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
    if (menu.open || event.altKey || event.ctrlKey || event.metaKey) return
    if (event.code === 'ArrowLeft' || event.code === 'ArrowRight'
      || (equipped && (event.code === 'ArrowUp' || event.code === 'ArrowDown'))) {
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
    const held = (code: string) => directions.includes(code) || heldKeys.has(code)
    const move = Number(held('ArrowRight')) - Number(held('ArrowLeft'))
    if (equipped) {
      const elevation = Number(held('ArrowUp')) - Number(held('ArrowDown'))
      angle = Math.max(-90, Math.min(90, angle + elevation * 70 * STEP))
    }
    if (!airborne) duel.movePlayer(crouch || landing ? 0 : move)

    if (crouch > 0) {
      crouch = Math.max(0, crouch - STEP)
      if (crouch === 0) airborne = duel.jumpPlayer(pendingJump)
    }

    duel.stepPhysics()
    if (duel.phase === 'settle') {
      duel.phase = 'aim'
      syncWeapon()
    }
    if (duel.blast && lastBlast !== duel.blast) {
      lastBlast = duel.blast
      cutCrater?.(lastBlast, BLAST)
    }
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
    const facing = duel.fighters[0].direction
    const walking = !crouch && !landing && !airborne && grounded && move && Math.abs(velocity.x) > 10
    walkTime = walking ? walkTime + STEP : 0
    const stride = Math.sin(walkTime * Math.PI * 16)

    let stretch = 0
    if (crouch) stretch = -0.15 * (1 - crouch / 0.09)
    else if (airborne || !grounded) stretch = Math.min(0.12, Math.abs(velocity.y) / 1600)
    else if (landing) stretch = -0.16 * (landing / 0.11)
    else if (walking) stretch = stride * 0.035

    const rotation = walking ? stride * facing * 2.5 : 0
    const scaleX = facing * baseScale * (1 - stretch * 0.55)
    const scaleY = baseScale * (1 + stretch)
    sprite.setAttribute('transform', `translate(${feet.x} ${feet.y + RADIUS}) rotate(${rotation}) scale(${scaleX} ${scaleY})`)

    if (equipped) {
      const origin = grip()
      const direction = aim(angle, facing)
      const rotation = Math.atan2(direction.y, direction.x) * 180 / Math.PI
      barrel.setAttribute('transform', `translate(${origin.x} ${origin.y}) rotate(${rotation}) scale(1 ${facing})`)
    }
    effects.clear()
    for (const [index, point] of duel.trail.entries()) {
      effects.fillStyle(0xffd586, (index + 1) / duel.trail.length * 0.65).fillCircle(point.x, point.y, 4)
    }
    if (duel.rocket) {
      const point = duel.rocket.translation()
      effects.fillStyle(0xfff2cc).fillCircle(point.x, point.y, 6)
    }
    if (duel.blast && duel.blastAge < 0.28) {
      const age = duel.blastAge / 0.28
      effects.lineStyle(5, 0xffa94d, 1 - age).strokeCircle(duel.blast.x, duel.blast.y, 12 + 55 * age)
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
    if (menu.open) menu.close()
    inventory.setAttribute('aria-expanded', 'false')
    scene.events.off('update', update)
    duel.world.free()
  })
}
