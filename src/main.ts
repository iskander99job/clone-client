import Phaser from 'phaser'
import terrainUrl from './assets/fruit-island.png'
import orchardUrl from './assets/fruit-orchard.webp'
import { FRUIT_ISLAND } from './fruit-island.ts'
import './style.css'

const { width, height, waterY } = FRUIT_ISLAND

class Arena extends Phaser.Scene {
  preload() {
    this.load.image('terrain-art', terrainUrl)
    this.load.image('orchard', orchardUrl)
  }

  create() {
    if (!this.textures.exists('orchard') || !this.textures.exists('terrain-art')) return

    this.add.image(0, 0, 'orchard').setOrigin(0).setDisplaySize(width, height)
    this.add.image(0, 0, 'terrain-art').setOrigin(0).setDisplaySize(width, height)

    const waterHeight = height - waterY
    const water = this.textures.createCanvas('water', 2, waterHeight)!
    const context = water.context
    const fill = context.createLinearGradient(0, 0, 0, waterHeight)
    fill.addColorStop(0, 'rgba(18, 184, 199, 0.53)')
    fill.addColorStop(1, '#006d9d')
    context.fillStyle = fill
    context.fillRect(0, 0, 2, waterHeight)
    context.fillStyle = 'rgba(192, 255, 245, 0.85)'
    context.fillRect(0, 0, 2, 2)
    water.refresh()
    this.add.image(0, waterY, 'water').setOrigin(0).setDisplaySize(width, waterHeight)
  }
}

new Phaser.Game({
  type: Phaser.AUTO,
  width,
  height,
  parent: 'field',
  scene: Arena,
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  audio: { noAudio: true },
})
