import type Phaser from 'phaser'

export const SVG_NS = 'http://www.w3.org/2000/svg'

export function createSvgViewport(scene: Phaser.Scene, className: string) {
  const svg = document.createElementNS(SVG_NS, 'svg')
  svg.classList.add('world-svg', className)
  svg.setAttribute('aria-hidden', 'true')
  svg.setAttribute('preserveAspectRatio', 'none')
  scene.events.once('shutdown', () => svg.remove())

  return {
    svg,
    updateView(left: number, top: number, width: number, height: number) {
      svg.setAttribute('viewBox', `${left} ${top} ${width} ${height}`)
    },
  }
}
