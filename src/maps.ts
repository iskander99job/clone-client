import cardsBackgroundSvg from './assets/house-of-cards/background.svg?raw'
import cardsTerrainUrl from './assets/house-of-cards/terrain.svg'
import cardsTerrainSvg from './assets/house-of-cards/terrain.svg?raw'
import flatUrl from './assets/flat-test.png'
import fruitForegroundUrl from './assets/fruit-island.svg'
import fruitForegroundSvg from './assets/fruit-island.svg?raw'
import fruitUrl from './assets/fruit-island.png'
import fruit2xUrl from './assets/fruit-island-2x.webp'
import quarryUrl from './assets/stone-quarry.webp'
import quarryMaskUrl from './assets/stone-quarry-mask.png'
import { FRUIT_ISLAND } from './fruit-island'
import { mapLayout, type SpawnConfiguration, type TerrainMap, type TerrainPlacementConfig } from './map-config'

export type ArenaMap = TerrainMap & SpawnConfiguration & TerrainPlacementConfig & {
  title: string
  mask: string
  fighterSize: number
  backgroundSvg?: string
} & (
  | { vectorArt: string; art?: never; largeArt?: never }
  | { vectorArt?: never; art: string; largeArt?: { url: string; width: number } }
)

export const FLAT_TEST: ArenaMap = {
  title: 'Тестовая площадка',
  ...mapLayout('flat'),
  shotSpeed: 2.2,
  contourTolerance: 1.25,
  art: flatUrl,
  mask: flatUrl,
  fighterSize: 70,
}

export const FRUIT_FOREGROUND: ArenaMap = {
  title: 'Фруктовая карта',
  ...mapLayout('fruit-foreground'),
  shotSpeed: FLAT_TEST.shotSpeed,
  contourTolerance: FLAT_TEST.contourTolerance,
  vectorArt: fruitForegroundSvg,
  mask: fruitForegroundUrl,
  fighterSize: FLAT_TEST.fighterSize,
}

export const STONE_QUARRY: ArenaMap = {
  title: 'Каменный карьер',
  ...mapLayout('quarry'),
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
  ...mapLayout('house-of-cards'),
  shotSpeed: FLAT_TEST.shotSpeed,
  contourTolerance: FLAT_TEST.contourTolerance,
  backgroundSvg: cardsBackgroundSvg,
  vectorArt: cardsTerrainSvg,
  mask: cardsTerrainUrl,
  fighterSize: FLAT_TEST.fighterSize,
}
