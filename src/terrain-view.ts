import type Phaser from 'phaser'
import type { Point } from './duel'

const SVG_NS = 'http://www.w3.org/2000/svg'

export function createVectorTerrain(
  scene: Phaser.Scene,
  field: HTMLElement,
  artwork: string,
  width: number,
  height: number,
) {
  const viewport = document.createElementNS(SVG_NS, 'svg')
  viewport.classList.add('vector-terrain')
  viewport.setAttribute('aria-hidden', 'true')
  viewport.setAttribute('preserveAspectRatio', 'none')

  const art = viewport.appendChild(document.createElementNS(SVG_NS, 'g'))
  // The SVG is a bundled project asset. Keep its paths inline for native rendering.
  art.innerHTML = artwork
  const drawing = art.querySelector('svg')!
  drawing.setAttribute('width', String(width))
  drawing.setAttribute('height', String(height))
  drawing.setAttribute('preserveAspectRatio', 'none')

  const defs = document.createElementNS(SVG_NS, 'defs')
  viewport.prepend(defs)
  const mask = defs.appendChild(document.createElementNS(SVG_NS, 'mask'))
  mask.id = 'terrain-crater-mask'
  mask.setAttribute('maskUnits', 'userSpaceOnUse')
  mask.setAttribute('mask-type', 'luminance')
  mask.setAttribute('x', '0')
  mask.setAttribute('y', '0')
  mask.setAttribute('width', String(width))
  mask.setAttribute('height', String(height))
  const ground = mask.appendChild(document.createElementNS(SVG_NS, 'rect'))
  ground.setAttribute('width', String(width))
  ground.setAttribute('height', String(height))
  ground.setAttribute('fill', 'white')

  field.prepend(viewport)
  scene.events.once('shutdown', () => viewport.remove())

  return {
    updateView(left: number, top: number, visibleWidth: number, visibleHeight: number) {
      viewport.setAttribute('viewBox', `${left} ${top} ${visibleWidth} ${visibleHeight}`)
    },
    cutCrater(point: Point, radius: number) {
      const hole = mask.appendChild(document.createElementNS(SVG_NS, 'circle'))
      hole.setAttribute('cx', String(point.x))
      hole.setAttribute('cy', String(point.y))
      hole.setAttribute('r', String(radius))
      hole.setAttribute('fill', 'black')
      art.setAttribute('mask', `url(#${mask.id})`)
    },
  }
}

export function createRasterTerrain(scene: Phaser.Scene, width: number, height: number) {
  const terrain = scene.add.image(0, 0, 'terrain-art').setOrigin(0).setDisplaySize(width, height)
  let damagedTerrain: Phaser.Textures.CanvasTexture | null = null

  scene.events.once('shutdown', () => {
    if (damagedTerrain) scene.textures.remove(damagedTerrain.key)
  })

  return {
    cutCrater(point: Point, radius: number) {
      if (!damagedTerrain) {
        const art = terrain.texture.getSourceImage() as HTMLImageElement
        damagedTerrain = scene.textures.createCanvas('damaged-terrain', art.width, art.height)
        if (!damagedTerrain) return
        damagedTerrain.context.drawImage(art, 0, 0)
        terrain.setTexture(damagedTerrain.key).setDisplaySize(width, height)
      }

      const context = damagedTerrain.context
      context.save()
      context.scale(damagedTerrain.width / width, damagedTerrain.height / height)
      context.globalCompositeOperation = 'destination-out'
      context.beginPath()
      context.arc(point.x, point.y, radius, 0, Math.PI * 2)
      context.fill()
      context.restore()
      damagedTerrain.refresh()
    },
  }
}
