import layouts from './map_config.json'

export type SpawnPoint = { id: string; x: number; y: number }

export type SpawnConfiguration = {
  spawnCoordinateSpace: 'world' | 'terrain'
  spawnAnchor: 'feet'
  spawnPoints: readonly SpawnPoint[]
}

export type TerrainMap = {
  width: number
  height: number
  waterY: number
  spawn?: readonly [number, number]
  shotSpeed: number
  contourTolerance?: number
} & Partial<SpawnConfiguration>

export type TerrainTransform = { scale: number; offsetX: number; offsetY: number }

export type TerrainPlacementConfig = {
  terrainSize?: { width: number; height: number }
  terrainTransform?: TerrainTransform
}

type MapLayout = TerrainPlacementConfig & Pick<TerrainMap, 'width' | 'height' | 'waterY'> & SpawnConfiguration

export function mapLayout(id: keyof typeof layouts): MapLayout {
  const layout = layouts[id]
  const { spawnPoints, spawnCoordinateSpace, spawnAnchor } = layout
  if ((spawnCoordinateSpace !== 'world' && spawnCoordinateSpace !== 'terrain') || spawnAnchor !== 'feet'
    || spawnPoints.length < 4 || new Set(spawnPoints.map(point => point.id)).size !== spawnPoints.length) {
    throw new Error(`Некорректные точки появления на карте ${id}`)
  }
  return { ...layout, spawnCoordinateSpace, spawnAnchor }
}
