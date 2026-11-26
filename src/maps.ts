import flatUrl from './assets/flat-test.png'
import fruitForegroundUrl from './assets/fruit-island.svg'
import fruitForegroundSvg from './assets/fruit-island.svg?raw'
import fruitUrl from './assets/fruit-island.png'
import fruit2xUrl from './assets/fruit-island-2x.webp'
import quarryUrl from './assets/stone-quarry.webp'
import quarryMaskUrl from './assets/stone-quarry-mask.png'
import { FRUIT_ISLAND, type TerrainMap } from './fruit-island'

export type ArenaMap = TerrainMap & {
  title: string
  mask: string
  fighterSize: number
} & (
  | { vectorArt: string; art?: never; largeArt?: never }
  | { vectorArt?: never; art: string; largeArt?: { url: string; width: number } }
)

export const FLAT_TEST: ArenaMap = {
  title: 'Тестовая площадка',
  width: 2160,
  height: 900,
  waterY: 760,
  spawn: [1080, 1735],
  shotSpeed: 2.2,
  contourTolerance: 1.25,
  art: flatUrl,
  mask: flatUrl,
  fighterSize: 70,
}

export const FRUIT_FOREGROUND: ArenaMap = {
  title: 'Фруктовая карта',
  width: FLAT_TEST.width,
  height: FLAT_TEST.height,
  waterY: FLAT_TEST.waterY,
  spawn: [875, 1735],
  shotSpeed: FLAT_TEST.shotSpeed,
  contourTolerance: FLAT_TEST.contourTolerance,
  vectorArt: fruitForegroundSvg,
  mask: fruitForegroundUrl,
  fighterSize: FLAT_TEST.fighterSize,
}

export const STONE_QUARRY: ArenaMap = {
  title: 'Каменный карьер',
  width: 2160,
  height: 900,
  waterY: 760,
  spawn: [425, 1735],
  shotSpeed: 2.2,
  contourTolerance: 1.25,
  art: quarryUrl,
  mask: quarryMaskUrl,
  fighterSize: 70,
}

export const FRUIT_ARENA: ArenaMap = {
  ...FRUIT_ISLAND,
  title: 'Фруктовый остров',
  art: fruitUrl,
  largeArt: { url: fruit2xUrl, width: 4344 },
  mask: fruitUrl,
  fighterSize: 128,
}
