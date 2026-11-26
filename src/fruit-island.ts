export type TerrainMap = {
  width: number
  height: number
  waterY: number
  spawn: readonly [number, number]
  shotSpeed: number
  contourTolerance?: number
}

export const FRUIT_ISLAND: TerrainMap = {
  width: 1440, height: 480, waterY: 396, spawn: [173, 1260], shotSpeed: 1.5,
}
