import RAPIER from '@dimforge/rapier2d-compat'
import { contours } from 'd3-contour'

export const WIDTH = 640
export const HEIGHT = 510
export const CELL = 2
export const RADIUS = 31
const GRAVITY = 370
const BLAST = 67
const STEP = 1 / 60
export const MAX_WIND = 90

function rollWind() {
  return (Math.floor(Math.random() * 7) - 3) * (MAX_WIND / 3)
}
const columns = WIDTH / CELL
const rows = HEIGHT / CELL
const getContours = contours().size([columns, rows]).thresholds([0.5]).smooth(false)

export type Point = { x: number; y: number }
export type Fighter = { hp: number; body: RAPIER.RigidBody; direction: number }
type Phase = 'aim' | 'bot' | 'flight' | 'settle' | 'over'

const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y)
const groundHeight = (x: number) => 353 - 77 * Math.exp(-((x - 320) ** 2) / 9300) + 9 * Math.sin(x / 32)
export const aim = (angle: number, direction: number) => ({
  x: Math.cos(angle * Math.PI / 180) * direction,
  y: -Math.sin(angle * Math.PI / 180),
})

export class Duel {
  world = new RAPIER.World({ x: 0, y: GRAVITY })
  mask = new Array<number>(columns * rows).fill(0)
  rings: number[][][] = []
  fighters: [Fighter, Fighter]
  terrain: RAPIER.Collider[] = []
  phase: Phase = 'aim'
  turn = 0
  angle = 47
  power = 49
  botAngle = 48
  rocketShape = new RAPIER.Ball(5)
  rocket?: RAPIER.RigidBody
  trail: Point[] = []
  blast?: Point
  blastAge = 0
  elapsed = 0
  revision = 0
  botTurns = 0
  wind = rollWind()
  winner: number | null = null

  constructor() {
    this.world.timestep = STEP
    this.world.lengthUnit = 32
    for (let y = 0; y < rows; y++) {
      for (let x = 1; x < columns - 1; x++) {
        this.mask[y * columns + x] = Number(y * CELL >= groundHeight(x * CELL))
      }
    }
    this.rebuildTerrain()
    this.fighters = [this.createFighter(83, 1), this.createFighter(556, -1)]
    for (let i = 0; i < 35; i++) this.world.step()
  }

  createFighter(x: number, direction: number): Fighter {
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setTranslation(x, groundHeight(x) - RADIUS - 4)
        .lockRotations().setLinearDamping(0.18).setCcdEnabled(true),
    )
    this.world.createCollider(RAPIER.ColliderDesc.ball(RADIUS).setFriction(1.5), body)
    return { body, hp: 100, direction }
  }

  rebuildTerrain() {
    for (const collider of this.terrain) this.world.removeCollider(collider, true)
    this.rings = getContours(this.mask).flatMap(({ coordinates }) => coordinates.flat())
    this.terrain = this.rings.map(ring => {
      const vertices = new Float32Array(ring.flatMap(point => point.map(coordinate => coordinate * CELL)))
      return this.world.createCollider(RAPIER.ColliderDesc.polyline(vertices).setFriction(1.5))
    })
    this.revision++
  }

  solid(x: number, y: number) {
    const column = Math.floor(x / CELL)
    const row = Math.floor(y / CELL)
    return column >= 0 && column < columns && row >= 0 && row < rows && this.mask[row * columns + column] === 1
  }

  muzzle(fighter: Fighter, angle: number) {
    const origin = fighter.body.translation()
    const vector = aim(angle, fighter.direction)
    return { x: origin.x + vector.x * 48, y: origin.y + vector.y * 48 }
  }

  fire(angle: number, power: number) {
    if (this.phase !== 'aim' && this.phase !== 'bot') return
    const fighter = this.fighters[this.turn]
    const origin = this.muzzle(fighter, angle)
    const direction = aim(angle, fighter.direction)
    const speed = 120 + power * 5.6
    this.phase = 'flight'
    this.elapsed = 0
    this.trail = [origin]
    if (this.solid(origin.x, origin.y)) {
      this.explode(origin)
      return
    }
    this.rocket = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setTranslation(origin.x, origin.y)
        .setLinvel(direction.x * speed, direction.y * speed).setCcdEnabled(true),
    )
    this.world.createCollider(RAPIER.ColliderDesc.ball(5).setSensor(true), this.rocket)
    this.rocket.addForce({ x: this.rocket.mass() * this.wind, y: 0 }, true)
  }

  tick() {
    if (this.phase === 'over') return
    this.elapsed += STEP
    this.blastAge += STEP
    const previous = this.rocket?.translation()
    this.world.step()
    for (const fighter of this.fighters) {
      const point = fighter.body.translation()
      if (point.y > HEIGHT + 65 || point.x < -90 || point.x > WIDTH + 90) fighter.hp = 0
    }
    if (previous && this.rocket) {
      const current = this.rocket.translation()
      const travel = { x: current.x - previous.x, y: current.y - previous.y }
      const hit = this.world.castShape(
        previous, 0, travel, this.rocketShape, 0, 1, true,
        undefined, undefined, undefined, this.rocket,
      )
      if (hit) {
        this.explode({
          x: previous.x + travel.x * hit.time_of_impact,
          y: previous.y + travel.y * hit.time_of_impact,
        })
        return
      }
      this.trail.push(current)
      if (this.trail.length > 22) this.trail.shift()
      if (current.x < -60 || current.x > WIDTH + 60 || current.y > HEIGHT + 50 || this.elapsed > 6) {
        this.finishFlight()
      }
    }
    if (this.phase === 'settle' && this.elapsed > 0.8) {
      const moving = this.fighters.some(fighter => fighter.hp > 0 &&
        Math.hypot(fighter.body.linvel().x, fighter.body.linvel().y) > 10)
      if (!moving || this.elapsed > 4) this.advance()
    }
    if (this.phase === 'bot' && this.elapsed > 0.7) {
      const { angle, power } = this.chooseBotShot()
      this.botAngle = angle
      this.fire(angle, power)
    }
  }

  explode(point: Point) {
    this.blast = point
    this.blastAge = 0
    for (let y = Math.max(0, Math.floor((point.y - BLAST) / CELL)); y < Math.min(rows, (point.y + BLAST) / CELL); y++) {
      for (let x = Math.max(0, Math.floor((point.x - BLAST) / CELL)); x < Math.min(columns, (point.x + BLAST) / CELL); x++) {
        if (distance(point, { x: (x + 0.5) * CELL, y: (y + 0.5) * CELL }) < BLAST) {
          this.mask[y * columns + x] = 0
        }
      }
    }
    this.rebuildTerrain()
    for (const fighter of this.fighters) {
      const center = fighter.body.translation()
      const separation = distance(point, center)
      const exposure = Math.max(0, 1 - separation / (BLAST + RADIUS))
      if (fighter.hp === 0 || exposure === 0) continue
      fighter.hp = Math.max(0, fighter.hp - Math.ceil(exposure * 72))
      fighter.body.setLinvel({
        x: Math.sign(center.x - point.x) * exposure * 94,
        y: -exposure * 165,
      }, true)
    }
    this.finishFlight()
  }

  finishFlight() {
    if (this.rocket) this.world.removeRigidBody(this.rocket)
    this.rocket = undefined
    this.trail = []
    this.phase = 'settle'
    this.elapsed = 0
  }

  advance() {
    const [player, bot] = this.fighters
    if (!player.hp || !bot.hp) {
      this.winner = player.hp ? 0 : bot.hp ? 1 : null
      this.phase = 'over'
      return
    }
    player.direction = bot.body.translation().x >= player.body.translation().x ? 1 : -1
    bot.direction = -player.direction
    this.turn = 1 - this.turn
    this.wind = rollWind()
    this.phase = this.turn === 0 ? 'aim' : 'bot'
    this.elapsed = 0
  }

  chooseBotShot() {
    const [player, bot] = this.fighters
    const target = player.body.translation()
    const center = bot.body.translation()
    let best = { angle: 48, power: 55, score: Infinity }
    for (let angle = 24; angle <= 80; angle += 4) {
      const start = this.muzzle(bot, angle)
      const direction = aim(angle, bot.direction)
      for (let power = 22; power <= 100; power += 3) {
        const speed = 120 + power * 5.6
        for (let t = 0; t < 4; t += 1 / 90) {
          const point = {
            x: start.x + direction.x * speed * t + this.wind * t * t / 2,
            y: start.y + direction.y * speed * t + GRAVITY * t * t / 2,
          }
          if (point.x < 0 || point.x > WIDTH || point.y > HEIGHT) break
          const gap = distance(point, target)
          if (this.solid(point.x, point.y) || gap < RADIUS + 5) {
            const score = gap + Math.max(0, 100 - distance(point, center)) * 2 + t * 2
            if (score < best.score) best = { angle, power, score }
            break
          }
        }
      }
    }
    const powerError = [3, -2, 1, 0][this.botTurns++ % 4]
    return { angle: best.angle, power: Math.min(100, best.power + powerError) }
  }
}
