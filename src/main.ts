import Phaser from 'phaser'
import { FLAT_TEST, FRUIT_ARENA, FRUIT_FOREGROUND, STONE_QUARRY } from './maps'
import { addIslandFighter } from './island-fighter'
import { bindMapView } from './map-view'
import { createRasterTerrain, createVectorTerrain } from './terrain-view'
import { createSvgViewport } from './svg-viewport'
import './style.css'
import './hud.css'

// Keep the island's world dimensions independent of the texture resolution.
const requestedMap = new URLSearchParams(location.search).get('map')
const mapId = requestedMap === 'fruit' || requestedMap === 'quarry' || requestedMap === 'flat'
  ? requestedMap : 'fruit-foreground'
const map = {
  flat: FLAT_TEST,
  fruit: FRUIT_ARENA,
  quarry: STONE_QUARRY,
  'fruit-foreground': FRUIT_FOREGROUND,
}[mapId]
const { width, height, waterY } = map
const arena = document.querySelector<HTMLElement>('.arena')!
const field = document.querySelector<HTMLElement>('#field')!
const maxBridge = document.querySelector<HTMLScriptElement>('#max-bridge')!

function detectMaxMobile() {
  const platform = (window as Window & { WebApp?: { platform?: string | null } }).WebApp?.platform
  document.documentElement.classList.toggle('max-mobile', platform === 'android' || platform === 'ios')
}

maxBridge.addEventListener('load', detectMaxMobile, { once: true })
detectMaxMobile()
arena.setAttribute('aria-label', map.title)
arena.dataset.map = mapId
document.title = `Кратер — ${map.title}`
const buildVersion = import.meta.env.VITE_BUILD_SHA?.slice(0, 7) || 'dev'
document.querySelector<HTMLElement>('#build-version')!.textContent = `Сборка ${buildVersion}`

class Arena extends Phaser.Scene {
  preload() {
    if (map.art !== undefined) {
      const renderer = this.game.renderer
      const largeArt = map.largeArt
      const supportsLargeTexture = largeArt && (!(renderer instanceof Phaser.Renderer.WebGL.WebGLRenderer)
        || renderer.getMaxTextureSize() >= largeArt.width)
      this.load.image('terrain-art', supportsLargeTexture ? largeArt.url : map.art)
    }
  }

  create() {
    const vector = map.vectorArt === undefined ? undefined : createVectorTerrain(this, field, map.vectorArt, width, height)
    if (!vector && !this.textures.exists('terrain-art')) return
    const terrain = vector ?? createRasterTerrain(this, width, height)
    const actors = createSvgViewport(this, 'vector-actors')
    field.append(actors.svg)
    bindMapView(arena, this, width, height, waterY, (left, top, visibleWidth, visibleHeight, preview) => {
      vector?.updateView(left, top, visibleWidth, visibleHeight, preview)
      actors.updateView(left, top, visibleWidth, visibleHeight)
    })
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
    // Temporarily isolate SVG camera performance from crater rendering in MAX.
    const cutCrater = vector ? undefined : terrain.cutCrater
    void addIslandFighter(this, arena, map, cutCrater, actors.svg).catch(error => {
      console.error('Не удалось запустить управление персонажем', error)
    })
  }
}

new Phaser.Game({
  type: Phaser.AUTO,
  transparent: true,
  width: field.clientWidth,
  height: field.clientHeight,
  parent: field,
  scene: Arena,
  scale: { mode: Phaser.Scale.NONE },
  audio: { noAudio: true },
})
