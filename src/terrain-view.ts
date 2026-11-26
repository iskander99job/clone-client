import type Phaser from 'phaser'
import polygonClipping, { type MultiPolygon, type Ring } from 'polygon-clipping'
import type { Point } from './duel'
import { createSvgViewport, SVG_NS } from './svg-viewport'

const CRATER_SEGMENTS = 96

export function createVectorTerrain(
  scene: Phaser.Scene,
  field: HTMLElement,
  artwork: string,
  width: number,
  height: number,
) {
  const { svg: viewport, updateView } = createSvgViewport(scene, 'vector-terrain')

  const art = viewport.appendChild(document.createElementNS(SVG_NS, 'g'))
  // The SVG is a bundled project asset. Keep its paths inline for native rendering.
  art.innerHTML = artwork
  const drawing = art.querySelector('svg')!
  drawing.setAttribute('width', String(width))
  drawing.setAttribute('height', String(height))
  drawing.setAttribute('preserveAspectRatio', 'none')

  const defs = document.createElementNS(SVG_NS, 'defs')
  viewport.prepend(defs)
  const clip = defs.appendChild(document.createElementNS(SVG_NS, 'clipPath'))
  clip.id = 'terrain-crater-clip'
  clip.setAttribute('clipPathUnits', 'userSpaceOnUse')
  const outline = clip.appendChild(document.createElementNS(SVG_NS, 'path'))
  outline.setAttribute('clip-rule', 'evenodd')
  let remaining: MultiPolygon = [[[[0, 0], [width, 0], [width, height], [0, height], [0, 0]]]]

  field.prepend(viewport)

  return {
    updateView,
    cutCrater(point: Point, radius: number) {
      const crater: Ring = Array.from({ length: CRATER_SEGMENTS }, (_, index) => {
        const angle = index * 2 * Math.PI / CRATER_SEGMENTS
        return [point.x + radius * Math.cos(angle), point.y + radius * Math.sin(angle)]
      })
      crater.push(crater[0])
      remaining = polygonClipping.difference(remaining, [crater])
      const path = remaining.flatMap(polygon => polygon.map(ring => {
        const coordinates = ring.slice(0, -1).map(([x, y]) => `${x},${y}`).join(' ')
        return `M${coordinates}Z`
      })).join(' ')
      outline.setAttribute('d', path)
      art.setAttribute('clip-path', `url(#${clip.id})`)
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
