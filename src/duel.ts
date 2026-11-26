import RAPIER from '@dimforge/rapier2d-compat'
import { contours } from 'd3-contour'
import { simplifyRing } from './terrain-contour'
import type { TerrainMap } from './fruit-island.ts'

export { FRUIT_ISLAND } from './fruit-island.ts'

export const WIDTH = 640
export const HEIGHT = 510
export const CELL = 2
export const RADIUS = 31
export const initPhysics = () => RAPIER.init()
const GRAVITY = 370
const BLAST = 67
export const STEP = 1 / 60
export const MAX_WIND = 90

function rollWind() {
  return (Math.floor(Math.random() * 7) - 3) * (MAX_WIND / 3)
}
export type Point = { x: number; y: number }
export type FighterState = { position: Point; velocity: Point; hp: number; direction: number }
export type MatchState = {
  mask: string; fighters: [FighterState, FighterState]; turn: number; wind: number
  finished: boolean; winner: number | null
}
export type ReplayFrame = {
  positions: [Point, Point]; rocket?: { position: Point; velocity: Point }; blast?: Point
}

export type Fighter = { hp: number; body: RAPIER.RigidBody; direction: number }
type Phase = 'aim' | 'bot' | 'flight' | 'settle' | 'over'

const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y)
const groundHeight = (x: number) => 353 - 24 * Math.exp(-((x - 320) ** 2) / 9300) + 9 * Math.sin(x / 32)
export const aim = (angle: number, direction: number) => ({
  x: Math.cos(angle * Math.PI / 180) * direction,
  y: -Math.sin(angle * Math.PI / 180),
})

export function terrainMaskFromPixels(rgba: Uint8ClampedArray, width = WIDTH, height = HEIGHT) {
  const columns = width / CELL
  const rows = height / CELL
  return Array.from({ length: columns * rows }, (_, index) => {
    const x = index % columns * CELL + CELL / 2
    const y = Math.floor(index / columns) * CELL + CELL / 2
    return Number(rgba[(y * width + x) * 4 + 3] >= 128)
  })
}

export class Duel {
  world = new RAPIER.World({ x: 0, y: GRAVITY })
  mask: number[]
  readonly width: number
  readonly height: number
  private readonly columns: number
  private readonly rows: number
  private readonly waterY?: number
  private readonly shotSpeed: number
  private readonly contourTolerance: number
  rings: number[][][] = []
  fighters: [Fighter, Fighter]
  terrain: RAPIER.Collider[] = []
  phase: Phase = 'aim'
  turn = 0
  angle = 47
  power = 49
  botAngle = 48
  rocketShape = new RAPIER.Ball(5)
  private playerGroundProbe = new RAPIER.Ball(RADIUS - 1)
  rocket?: RAPIER.RigidBody
  trail: Point[] = []
  blast?: Point
  blastAge = 0
  elapsed = 0
  revision = 0
  botTurns = 0
  wind = rollWind()
  winner: number | null = null

  readonly online: boolean

  constructor(online = false, terrainMask?: number[], map?: TerrainMap) {
    this.width = map?.width ?? WIDTH
    this.height = map?.height ?? HEIGHT
    this.columns = this.width / CELL
    this.rows = this.height / CELL
    this.waterY = map?.waterY
    this.shotSpeed = map?.shotSpeed ?? 1
    this.contourTolerance = map?.contourTolerance ?? 0
    const { columns, rows } = this
    this.mask = new Array<number>(columns * rows).fill(0)
    this.online = online
    this.world.timestep = STEP
    this.world.lengthUnit = 32
    if (terrainMask) {
      this.mask = terrainMask.slice()
    } else {
      for (let y = 0; y < rows; y++) {
        for (let x = 1; x < columns - 1; x++) {
          this.mask[y * columns + x] = Number(y * CELL >= groundHeight(x * CELL))
        }
      }
    }
    this.rebuildTerrain()
    this.fighters = [this.createFighter(map?.spawn[0] ?? 83, 1), this.createFighter(map?.spawn[1] ?? 556, -1)]
    for (let i = 0; i < 35; i++) this.world.step()
  }

  snapshot(): MatchState {
    const state = ({ body, hp, direction }: Fighter): FighterState => ({
      position: body.translation(), velocity: body.linvel(), hp, direction,
    })
    return {
      mask: this.mask.join(''), fighters: [state(this.fighters[0]), state(this.fighters[1])],
      turn: this.turn, wind: this.wind, finished: this.phase === 'over', winner: this.winner,
    }
  }

  restore(state: MatchState) {
    this.mask = Array.from(state.mask, Number)
    this.rebuildTerrain()
    this.fighters.forEach((fighter, index) => {
      const saved = state.fighters[index]
      fighter.hp = saved.hp
      fighter.direction = saved.direction
      fighter.body.setTranslation(saved.position, true)
      fighter.body.setLinvel(saved.velocity, true)
    })
    this.turn = state.turn
    this.wind = state.wind
    this.winner = state.winner
    this.phase = state.finished ? 'over' : 'aim'
    this.elapsed = 0
    this.trail = []
    this.blast = undefined
  }

  replayFrame(): ReplayFrame {
    return {
      positions: [this.fighters[0].body.translation(), this.fighters[1].body.translation()],
      rocket: this.rocket && { position: this.rocket.translation(), velocity: this.rocket.linvel() },
      blast: this.blast,
    }
  }

  createFighter(x: number, direction: number): Fighter {
    const { columns } = this
    const column = Math.floor(x / CELL)
    const surface = this.mask.findIndex((solid, index) => solid === 1 && index % columns === column)
    const groundY = this.online ? groundHeight(x)
      : surface < 0 ? this.height : Math.floor(surface / columns) * CELL
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setTranslation(x, groundY - RADIUS - 4)
        .lockRotations().setLinearDamping(0.18).setCcdEnabled(true),
    )
    this.world.createCollider(RAPIER.ColliderDesc.ball(RADIUS).setFriction(1.5), body)
    return { body, hp: 100, direction }
  }

  rebuildTerrain() {
    for (const collider of this.terrain) this.world.removeCollider(collider, true)
    const getContours = contours().size([this.columns, this.rows]).thresholds([0.5]).smooth(false)
    this.rings = getContours(this.mask).flatMap(({ coordinates }) => coordinates.flat())
    this.terrain = this.rings.map(ring => {
      const boundary = simplifyRing(ring, this.contourTolerance)
      const vertices = new Float32Array(boundary.flatMap(point => point.map(coordinate => coordinate * CELL)))
      return this.world.createCollider(RAPIER.ColliderDesc.polyline(vertices).setFriction(1.5))
    })
    this.revision++
  }

  solid(x: number, y: number) {
    const { columns, rows } = this
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
    if (this.turn === 0 && !this.online) this.movePlayer(0)
    const fighter = this.fighters[this.turn]
    const origin = this.muzzle(fighter, angle)
    const direction = aim(angle, fighter.direction)
    const speed = (120 + power * 5.6) * this.shotSpeed
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

  private movingPlayer = false

  private playerGroundContact(reach: number) {
    const { body } = this.fighters[0]
    return this.world.castShape(
      body.translation(), 0, { x: 0, y: 1 }, this.playerGroundProbe, 0, reach, true,
      RAPIER.QueryFilterFlags.EXCLUDE_DYNAMIC,
    )
  }

  playerGrounded() {
    return this.playerGroundContact(4) !== null
  }

  movePlayer(direction: number) {
    if (!direction && !this.movingPlayer) return
    const player = this.fighters[0]
    if (direction) player.direction = direction
    const ground = this.playerGroundContact(10)
    if (!ground) return
    this.movingPlayer = direction !== 0
    const speed = direction * 155
    const normal = ground.normal1
    if (direction && normal.y < -0.55) {
      // Walk tangentially so friction cannot pin horizontal input against the slope.
      player.body.setLinvel({ x: -normal.y * speed, y: normal.x * speed }, true)
    } else {
      player.body.setLinvel({ x: speed, y: player.body.linvel().y }, true)
    }
  }

  jumpPlayer(relativeDirection: number) {
    if (!this.playerGrounded()) return false
    const { body, direction } = this.fighters[0]
    if (body.linvel().y < -20) return false
    body.setLinvel({ x: relativeDirection * direction * 125, y: -205 }, true)
    this.movingPlayer = true
    return true
  }

  tick(move = 0, elevation = 0) {
    if (this.phase === 'over') return
    if (this.phase === 'aim' && !this.online) {
      this.movePlayer(move)
      this.angle = Math.max(12, Math.min(84, this.angle + elevation))
    }
    this.elapsed += STEP
    this.blastAge += STEP
    const previous = this.rocket?.translation()
    this.world.step()
    for (const fighter of this.fighters) {
      const point = fighter.body.translation()
      if (point.y >= (this.waterY ?? this.height + 65) || point.x < -90 || point.x > this.width + 90) fighter.hp = 0
    }
    if (this.phase === 'aim' && this.fighters.some(fighter => fighter.hp === 0)) {
      this.advance()
      return
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
      if (current.x < -60 || current.x > this.width + 60 || current.y >= (this.waterY ?? this.height + 50) || this.elapsed > 6) {
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
    const { columns, rows } = this
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
    this.phase = this.online || this.turn === 0 ? 'aim' : 'bot'
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
        const speed = (120 + power * 5.6) * this.shotSpeed
        for (let t = 0; t < (this.waterY === undefined ? 4 : 6); t += 1 / 90) {
          const point = {
            x: start.x + direction.x * speed * t + this.wind * t * t / 2,
            y: start.y + direction.y * speed * t + GRAVITY * t * t / 2,
          }
          if (point.x < 0 || point.x > this.width || point.y >= (this.waterY ?? this.height)) break
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
