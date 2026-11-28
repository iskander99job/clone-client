import cardsBackgroundUrl from './assets/house-of-cards/background.svg'
import cardsTerrainUrl from './assets/house-of-cards/terrain.svg'
import cardsTerrainSvg from './assets/house-of-cards/terrain.svg?raw'
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
  background?: string
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

export const HOUSE_OF_CARDS: ArenaMap = {
  title: 'Карточный домик',
  width: 2160,
  height: 1080,
  waterY: 1000,
  spawn: [770, 1410],
  shotSpeed: FLAT_TEST.shotSpeed,
  contourTolerance: FLAT_TEST.contourTolerance,
  background: cardsBackgroundUrl,
  vectorArt: cardsTerrainSvg,
  mask: cardsTerrainUrl,
  fighterSize: FLAT_TEST.fighterSize,
}
