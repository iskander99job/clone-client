import Phaser from 'phaser'
import terrainUrl from './assets/fruit-island.png'
import { FRUIT_ISLAND } from './fruit-island.ts'
import { bindMapView } from './map-view'
import './style.css'

// Keep the Phaser canvas at the island artwork's native resolution.
const width = 2172
const height = Math.round(width * FRUIT_ISLAND.height / FRUIT_ISLAND.width)
const arena = document.querySelector<HTMLElement>('.arena')!
const waterY = height * FRUIT_ISLAND.waterY / FRUIT_ISLAND.height

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

const water = arena.querySelector<HTMLElement>('.water')!
const bubbleCount = 22

for (let index = 0; index < bubbleCount; index++) {
  const bubble = document.createElement('span')
  const duration = 6 + Math.random() * 8
  bubble.style.setProperty('--bubble-x', `${(index + 0.5 + (Math.random() - 0.5) * 0.8) / bubbleCount * 100}%`)
  bubble.style.setProperty('--bubble-size', `${3 + Math.random() * 7}px`)
  bubble.style.setProperty('--bubble-depth', `${35 + Math.random() * 60}cqh`)
  bubble.style.setProperty('--bubble-drift', `${(Math.random() - 0.5) * 24}px`)
  bubble.style.setProperty('--bubble-duration', `${duration}s`)
  bubble.style.setProperty('--bubble-delay', `${-Math.random() * duration}s`)
  water.append(bubble)
}

class Arena extends Phaser.Scene {
  preload() {
    this.load.image('terrain-art', terrainUrl)
  }

  create() {
    if (!this.textures.exists('terrain-art')) return
    this.add.image(0, 0, 'terrain-art').setOrigin(0).setDisplaySize(width, height)
    bindMapView(arena, this, width, height, waterY)
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
