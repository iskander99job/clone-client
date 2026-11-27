import type Phaser from 'phaser'
import type { Point } from './duel'
import type { ArenaMap } from './maps'
import bearSvg from './assets/bear/bear.svg?raw'
import bearRig from './assets/bear/rig.json'
import walkConfig from './assets/bear/walk.config.json'
import idleConfig from './assets/bear/idle.config.json'
import jumpConfig from './assets/bear/jump.config.json'
import backflipConfig from './assets/bear/backflip.config.json'
import armsConfig from './assets/bear/arms.config.json'
import weaponConfig from './assets/bear/weapon.config.json'
import weaponMotion from './assets/bear/weapon-motion.config.json'
import { CharacterAnimator } from './character-animator'
import { WeaponController, type WeaponConfig } from './weapon-controller'
import bazookaSvg from './assets/bazooka.svg?raw'
import { SVG_NS } from './svg-viewport'

const [, , FRAME] = bearRig.viewBox
const FEET = walkConfig.groundY
const WALK_SPEED = 80

export async function addIslandFighter(
  scene: Phaser.Scene,
  arena: HTMLElement,
  map: ArenaMap,
  cutCrater: (point: Point, radius: number) => void,
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
  const { Duel, initPhysics, RADIUS, STEP, BLAST, terrainMaskFromPixels } = await import('./duel')
  await initPhysics()
  if (!scene.sys.isActive()) return

  const duel = new Duel(false, terrainMaskFromPixels(pixels, width, height), map)
  const fighter = duel.fighters[0]
  const { body } = fighter
  duel.wind = 0
  duel.fighters[1].body.setEnabled(false)
  const spawn = body.translation()
  const sprite = actors.appendChild(document.createElementNS(SVG_NS, 'g'))
  sprite.classList.add('bear')
  sprite.innerHTML = bearSvg.replace(/^<\?xml[^?]*\?>/, '')
  const bodyArt = sprite.querySelector('svg')!
  bodyArt.setAttribute('x', String(-FRAME / 2))
  bodyArt.setAttribute('y', String(-FEET))
  const animator = new CharacterAnimator(bodyArt, bearRig, walkConfig, idleConfig, jumpConfig, backflipConfig, armsConfig)
  animator.setFacing(fighter.direction < 0 ? 'left' : 'right')
  animator.playIdle()
  const baseScale = map.fighterSize / FRAME * 0.8
  sprite.setAttribute('transform', `translate(${spawn.x} ${spawn.y + RADIUS}) scale(${baseScale})`)
  const input = new AbortController()
  const { signal } = input
  const pressed = new Map<number, string>()
  const heldKeys = new Set<string>()
  let pendingJump = 0
  let flight: { elapsed: number; duration: number } | undefined
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
  const weaponAsset = new DOMParser().parseFromString(bazookaSvg, 'image/svg+xml').documentElement as unknown as SVGSVGElement
  const weapon = new WeaponController(animator, [{ config: weaponConfig as WeaponConfig, svg: weaponAsset }], weaponMotion)
  weapon.setAimAngle(24)
  const effects = scene.add.graphics().setName('shot-effects')
  let lastBlast: Point | undefined

  function syncShoot() {
    shoot.toggleAttribute('disabled', duel.phase !== 'aim' || !weapon.canShoot())
  }

  function syncWeapon() {
    const equipped = weapon.selectedWeaponId === weaponConfig.weaponId
    bazooka.setAttribute('aria-pressed', String(equipped))
    unequip.hidden = !equipped
    up.disabled = down.disabled = !equipped
    syncShoot()
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
      if (active) weapon.equip(weaponConfig.weaponId)
      else weapon.unequip()
      syncWeapon()
      menu.close()
    }, { signal })
  }
  shoot.addEventListener('click', () => {
    if (duel.phase !== 'aim' || !weapon.canShoot()) return
    const muzzle = weapon.getMuzzlePosition()
    const direction = weapon.getAimDirection()
    if (!muzzle || !direction) return
    const position = body.translation()
    const origin = {
      x: position.x + (muzzle.x - FRAME / 2) * baseScale,
      y: position.y + RADIUS + (muzzle.y - FEET) * baseScale,
    }
    duel.fire(weapon.aimAngle, 20, { origin, direction })
    weapon.playRecoil()
    syncShoot()
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
    if (animator.isJumping || !duel.playerGrounded()) return
    pendingJump = direction
    if (direction < 0) animator.playBackflip()
    else animator.playJump()
  }

  button('.jump-forward').addEventListener('click', () => requestJump(1), { signal })
  button('.jump-back').addEventListener('click', () => requestJump(-1), { signal })

  window.addEventListener('keydown', event => {
    if (menu.open || event.altKey || event.ctrlKey || event.metaKey) return
    if (event.code === 'ArrowLeft' || event.code === 'ArrowRight'
      || (weapon.selectedWeaponId && (event.code === 'ArrowUp' || event.code === 'ArrowDown'))) {
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
    if (weapon.selectedWeaponId) {
      const elevation = Number(held('ArrowUp')) - Number(held('ArrowDown'))
      if (elevation) weapon.setAimAngle(weapon.aimAngle + elevation * 70 * STEP)
    }
    if (!flight) duel.movePlayer(animator.isJumping ? 0 : move, WALK_SPEED)

    if (animator.isReadyForTakeoff) {
      if (duel.jumpPlayer(pendingJump)) {
        flight = { elapsed: 0, duration: -2 * body.linvel().y / duel.world.gravity.y }
        animator.notifyTakeoff()
      } else {
        animator.cancelJump()
      }
    }

    duel.stepPhysics()
    if (duel.phase === 'settle') {
      duel.phase = 'aim'
    }
    if (duel.blast && lastBlast !== duel.blast) {
      lastBlast = duel.blast
      cutCrater(lastBlast, BLAST)
    }
    const position = body.translation()
    if (position.y >= waterY || position.x < 0 || position.x > width) {
      body.setTranslation(spawn, true)
      body.setLinvel({ x: 0, y: 0 }, true)
      flight = undefined
      animator.resetPose()
    }

    const velocity = body.linvel()
    const grounded = duel.playerGrounded()
    if (flight) {
      flight.elapsed += STEP
      const progress = Math.min(1, flight.elapsed / flight.duration)
      animator.notifyAirborne(velocity.y, Math.max(0, (progress - 0.75) * 4), progress)
      if (grounded && velocity.y >= -10) {
        animator.notifyLanding()
        flight = undefined
      }
    }

    const feet = body.translation()
    const facing = fighter.direction
    const direction = facing < 0 ? 'left' : 'right'
    if (animator.direction !== direction) animator.setFacing(direction)
    const walking = grounded && move !== 0 && Math.abs(velocity.x) > 10
    if (walking) animator.playWalk()
    else animator.playIdle()
    // Keep the supplied stride cadence at the game's normal movement speed.
    const strideSpeed = walking ? animator.referenceSpeed * Math.abs(velocity.x) / WALK_SPEED : 0
    animator.update(STEP * 1000, strideSpeed)
    sprite.setAttribute('transform', `translate(${feet.x} ${feet.y + RADIUS}) scale(${baseScale})`)

    weapon.update(STEP * 1000)
    syncShoot()
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
