import type { ArenaMap } from './maps'

export type TerrainPlacement = {
  x: number
  y: number
  width: number
  height: number
}

export const SOLID_ALPHA = 128

function bottomCenter({ data, width, height }: ImageData) {
  let left = width
  let right = -1
  let bottom = -1
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] < SOLID_ALPHA) continue
      left = Math.min(left, x)
      right = Math.max(right, x)
      bottom = y
    }
  }
  if (bottom < 0) throw new Error('Маска грунта не содержит опоры')
  return { x: (left + right + 1) / 2, y: bottom + 1 }
}

export async function loadTerrainPlacement(map: ArenaMap) {
  const source = new Image()
  source.src = map.mask
  await source.decode()

  const { width, height } = map.terrainSize ?? map
  const { scale, offsetX, offsetY } = map.terrainTransform ?? { scale: 1, offsetX: 0, offsetY: 0 }
  if (!Number.isFinite(scale) || scale <= 0 || !Number.isFinite(offsetX) || !Number.isFinite(offsetY)) {
    throw new Error('Некорректное преобразование грунта')
  }

  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d', { willReadFrequently: true })!
  let x = offsetX
  let y = offsetY
  if (scale !== 1) {
    canvas.width = width
    canvas.height = height
    context.drawImage(source, 0, 0, width, height)
    const anchor = bottomCenter(context.getImageData(0, 0, width, height))
    x += anchor.x * (1 - scale)
    y += anchor.y * (1 - scale)
  }

  const placement = { x, y, width: width * scale, height: height * scale }
  canvas.width = map.width
  canvas.height = map.height
  context.drawImage(source, x, y, placement.width, placement.height)
  const pixels = context.getImageData(0, 0, map.width, map.height).data
  const worldMap: ArenaMap = map.spawnCoordinateSpace === 'terrain' ? {
    ...map,
    spawnCoordinateSpace: 'world',
    spawnPoints: map.spawnPoints.map(point => ({ ...point, x: x + point.x * scale, y: y + point.y * scale })),
  } : map
  return { placement, pixels, worldMap }
}
