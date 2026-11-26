import Phaser from 'phaser'
import terrainUrl from './assets/fruit-island.png'
import { FRUIT_ISLAND } from './fruit-island.ts'
import './style.css'

// Keep the Phaser canvas at the island artwork's native resolution.
const width = 2172
const height = Math.round(width * FRUIT_ISLAND.height / FRUIT_ISLAND.width)
const arena = document.querySelector<HTMLElement>('.arena')!
arena.style.setProperty('--water-ratio', String(FRUIT_ISLAND.waterY / FRUIT_ISLAND.height))

class Arena extends Phaser.Scene {
  preload() {
    this.load.image('terrain-art', terrainUrl)
  }

  create() {
    if (!this.textures.exists('terrain-art')) return
    this.add.image(0, 0, 'terrain-art').setOrigin(0).setDisplaySize(width, height)
  }
}

new Phaser.Game({
  type: Phaser.AUTO,
  transparent: true,
  width,
  height,
  parent: 'field',
  scene: Arena,
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  audio: { noAudio: true },
})
