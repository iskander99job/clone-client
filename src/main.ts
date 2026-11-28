import Phaser from 'phaser'
import { FLAT_TEST, FRUIT_ARENA, FRUIT_FOREGROUND, HOUSE_OF_CARDS, STONE_QUARRY } from './maps'
import { addIslandFighter } from './island-fighter'
import { bindMapView } from './map-view'
import { createRasterTerrain, createVectorTerrain } from './terrain-view'
import { createSvgViewport, SVG_NS } from './svg-viewport'
import { loadTerrainPlacement } from './terrain-placement'
import { mountSvgBackground } from './background-renderer'
import './style.css'
import './hud.css'

// Keep the island's world dimensions independent of the texture resolution.
const query = new URLSearchParams(location.search)
const requestedMap = query.get('map')
const cameraOnly = query.get('player') === 'off'
const centerOnly = query.get('terrain') === 'off'
const mapId = requestedMap === 'fruit' || requestedMap === 'quarry' || requestedMap === 'flat'
  || requestedMap === 'fruit-foreground' ? requestedMap : 'house-of-cards'
const map = {
  flat: FLAT_TEST,
  fruit: FRUIT_ARENA,
  quarry: STONE_QUARRY,
  'fruit-foreground': FRUIT_FOREGROUND,
  'house-of-cards': HOUSE_OF_CARDS,
}[mapId]
const { width, height, waterY } = map
const arena = document.querySelector<HTMLElement>('.arena')!
const field = document.querySelector<HTMLElement>('#field')!
const maxBridge = document.querySelector<HTMLScriptElement>('#max-bridge')!

function detectMax() {
  const platform = (window as Window & { WebApp?: { platform?: string | null } }).WebApp?.platform
  document.documentElement.classList.toggle('max-app', Boolean(platform))
  document.documentElement.classList.toggle('max-mobile', platform === 'android' || platform === 'ios')
}

maxBridge.addEventListener('load', detectMax, { once: true })
detectMax()
arena.setAttribute('aria-label', map.title)
arena.dataset.map = mapId
document.title = `Кратер — ${map.title}`
const buildVersion = import.meta.env.VITE_BUILD_SHA?.slice(0, 7) || 'dev'
document.querySelector<HTMLElement>('#build-version')!.textContent = `Сборка ${buildVersion}`

const clouds = Array.from(arena.querySelectorAll<HTMLElement>('.clouds span'))
const lanes = clouds.map((_, index) => index)
const skyWidth = Math.max(1, arena.clientWidth)

for (const cloud of clouds) {
  // Randomize which cloud starts in each section of the sky.
  const [lane] = lanes.splice(Math.floor(Math.random() * lanes.length), 1)
  const cloudWidth = cloud.offsetWidth
  const startX = (lane + Math.random() * 0.65) / clouds.length * Math.max(0, skyWidth - cloudWidth)
  const duration = 130 + Math.random() * 160
  const offscreen = cloudWidth * 1.05
  const progress = (startX + offscreen) / (skyWidth + offscreen)

  cloud.style.setProperty('--x', `${startX / skyWidth * 100}%`)
  cloud.style.setProperty('--duration', `${duration}s`)
  cloud.style.setProperty('--delay', `${-progress * duration}s`)
}

const bubbles = arena.querySelector<HTMLElement>('.water-bubbles')!
bubbles.style.width = `${width}px`
const bubbleCount = 22

for (let index = 0; index < bubbleCount; index++) {
  const bubble = document.createElement('span')
  const duration = 6 + Math.random() * 8
  bubble.style.setProperty('--bubble-x', `${(index + 0.5 + (Math.random() - 0.5) * 0.8) / bubbleCount * 100}%`)
  bubble.style.setProperty('--bubble-size', `${5 + Math.random() * 9}px`)
  bubble.style.setProperty('--bubble-depth', `${height * (0.12 + Math.random() * 0.36)}px`)
  bubble.style.setProperty('--bubble-drift', `${(Math.random() - 0.5) * 24}px`)
  bubble.style.setProperty('--bubble-duration', `${duration}s`)
  bubble.style.setProperty('--bubble-delay', `${-Math.random() * duration}s`)
  bubbles.append(bubble)
}

class Arena extends Phaser.Scene {
  preload() {
    if (!centerOnly && map.art !== undefined) {
      const renderer = this.game.renderer
      const largeArt = map.largeArt
      const supportsLargeTexture = largeArt && (!(renderer instanceof Phaser.Renderer.WebGL.WebGLRenderer)
        || renderer.getMaxTextureSize() >= largeArt.width)
      this.load.image('terrain-art', supportsLargeTexture ? largeArt.url : map.art)
    }
  }

  create() {
    if (map.backgroundSvg) {
      this.events.once('shutdown', mountSvgBackground(field, map.backgroundSvg))
    }
    // Phaser RESIZE measures the transformed bounding box. Use the actual layout size instead.
    const observer = new ResizeObserver(() => {
      const { clientWidth, clientHeight } = field
      if (clientWidth > 0 && clientHeight > 0
        && (clientWidth !== this.scale.width || clientHeight !== this.scale.height)) {
        this.scale.resize(clientWidth, clientHeight)
      }
    })
    observer.observe(field)
    this.events.once('shutdown', () => observer.disconnect())
    void this.startTerrain().catch(error => {
      console.error('Не удалось запустить карту', error)
    })
  }

  private async startTerrain() {
    if (centerOnly) {
      const { svg, updateView } = createSvgViewport(this, 'vector-actors')
      const size = 48
      const marker = svg.appendChild(document.createElementNS(SVG_NS, 'rect'))
      marker.id = 'world-center'
      marker.setAttribute('x', String((width - size) / 2))
      marker.setAttribute('y', String((height - size) / 2))
      marker.setAttribute('width', String(size))
      marker.setAttribute('height', String(size))
      marker.setAttribute('fill', '#fff')
      marker.setAttribute('stroke', '#172c39')
      marker.setAttribute('stroke-width', '5')
      field.append(svg)
      bindMapView(arena, this, width, height, waterY, updateView)
      return
    }
    const { placement, physics } = await loadTerrainPlacement(map, !cameraOnly)
    if (!this.sys.isActive()) return
    const vector = map.vectorArt === undefined ? undefined
      : createVectorTerrain(this, field, map.vectorArt, width, height, placement)
    if (!vector && !this.textures.exists('terrain-art')) return
    const terrain = vector ?? createRasterTerrain(this, width, height, placement)
    const actors = createSvgViewport(this, 'vector-actors')
    field.append(actors.svg)
    bindMapView(arena, this, width, height, waterY, (left, top, visibleWidth, visibleHeight) => {
      vector?.updateView(left, top, visibleWidth, visibleHeight)
      actors.updateView(left, top, visibleWidth, visibleHeight)
    })
    if (!physics) return
    await addIslandFighter(this, arena, physics.worldMap, physics.pixels, terrain.cutCrater, actors.svg)
  }
}

new Phaser.Game({
  type: map.vectorArt === undefined ? Phaser.AUTO : Phaser.CANVAS,
  transparent: true,
  width: field.clientWidth,
  height: field.clientHeight,
  parent: field,
  scene: Arena,
  scale: { mode: Phaser.Scale.NONE },
  audio: { noAudio: true },
})
