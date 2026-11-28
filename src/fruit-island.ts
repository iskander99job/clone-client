import { mapLayout, type SpawnConfiguration, type TerrainMap } from './map-config'

export type { TerrainMap } from './map-config'

export const FRUIT_ISLAND: TerrainMap & SpawnConfiguration = {
  ...mapLayout('fruit'),
  shotSpeed: 1.5,
}
