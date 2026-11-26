import Phaser from 'phaser'
import { FLAT_TEST, FRUIT_ARENA, FRUIT_FOREGROUND, STONE_QUARRY } from './maps'
import { addIslandFighter, loadIslandFighter } from './island-fighter'
import { bindMapView } from './map-view'
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
arena.setAttribute('aria-label', map.title)
arena.dataset.map = mapId
document.title = `Кратер — ${map.title}`

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
    const renderer = this.game.renderer
    const largeArt = map.largeArt
    const supportsLargeTexture = largeArt && (!(renderer instanceof Phaser.Renderer.WebGL.WebGLRenderer)
      || renderer.getMaxTextureSize() >= largeArt.width)
    this.load.image('terrain-art', supportsLargeTexture ? largeArt.url : map.art)
    this.load.image('terrain-mask', map.mask)
    loadIslandFighter(this)
  }

  create() {
    if (!this.textures.exists('terrain-art')) return
    const terrain = this.add.image(0, 0, 'terrain-art').setOrigin(0).setDisplaySize(width, height)
    bindMapView(arena, this, width, height, waterY)
    void addIslandFighter(this, arena, map, terrain).catch(error => {
      console.error('Не удалось запустить управление персонажем', error)
    })
  }
}

new Phaser.Game({
  type: Phaser.AUTO,
  transparent: true,
  width,
  height,
  parent: 'field',
  scene: Arena,
  scale: { mode: Phaser.Scale.RESIZE },
  audio: { noAudio: true },
})
