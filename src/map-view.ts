import type Phaser from 'phaser'

type Point = { x: number; y: number }

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))

export function bindMapView(
  arena: HTMLElement,
  scene: Phaser.Scene,
  mapWidth: number,
  mapHeight: number,
  waterY: number,
  updateTerrainView?: (left: number, top: number, width: number, height: number, preview: boolean) => void,
) {
  const camera = scene.cameras.main
  const portrait = matchMedia('(orientation: portrait)')
  let zoom = 1
  const center = { x: mapWidth / 2, y: mapHeight / 2 }
  const pointers = new Map<number, Point>()

  function cameraZoom(multiplier = zoom) {
    return Math.min(camera.width / mapWidth, camera.height / mapHeight) * multiplier
  }

  function boundCenter(value: number, mapSize: number, viewSize: number, extraTravel = 0) {
    const limit = Math.max(0, (mapSize - viewSize) / 2) + extraTravel
    return clamp(value, mapSize / 2 - limit, mapSize / 2 + limit)
  }

  function render(preview = false) {
    const scale = cameraZoom()
    if (scale <= 0) return
    center.x = boundCenter(center.x, mapWidth, camera.width / scale)
    const verticalTravel = Math.min(camera.height * 0.2, 180) / scale
    center.y = boundCenter(center.y, mapHeight, camera.height / scale, verticalTravel)
    camera.setZoom(scale).centerOn(center.x, center.y)
    const mapLeft = camera.width / 2 - center.x * scale
    const mapTop = camera.height / 2 - center.y * scale
    updateTerrainView?.(-mapLeft / scale, -mapTop / scale, camera.width / scale, camera.height / scale, preview)
    arena.style.setProperty('--map-left', `${mapLeft}px`)
    arena.style.setProperty('--map-scale', String(scale))
    const waterTop = camera.height / 2 + (waterY - center.y) * scale
    arena.style.setProperty('--water-top', `${waterTop}px`)
  }

  function moveView(from: Point, to: Point, requestedZoom: number, preview = false) {
    const previousScale = cameraZoom()
    if (previousScale <= 0) return
    const nextScale = cameraZoom(requestedZoom)
    if (nextScale <= 0 || !Number.isFinite(nextScale)
      || !Number.isFinite(Math.max(camera.width, camera.height) / nextScale)) return
    zoom = requestedZoom
    center.x += from.x / previousScale - to.x / nextScale
    center.y += from.y / previousScale - to.y / nextScale
    render(preview)
  }

  function point(event: MouseEvent): Point {
    const bounds = arena.getBoundingClientRect()
    const x = (event.clientX - bounds.left) / bounds.width - 0.5
    const y = (event.clientY - bounds.top) / bounds.height - 0.5
    if (portrait.matches && document.documentElement.classList.contains('max-mobile')) {
      return { x: y * camera.width, y: -x * camera.height }
    }
    return { x: x * camera.width, y: y * camera.height }
  }

  function gesture() {
    const [first, second] = pointers.values()
    if (!second) return { center: first, distance: 0 }
    return {
      center: { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 },
      distance: Math.hypot(second.x - first.x, second.y - first.y),
    }
  }

  arena.addEventListener('wheel', event => {
    event.preventDefault()
    const units = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? arena.clientHeight : 1
    if (!event.ctrlKey && Math.abs(event.deltaX) > Math.abs(event.deltaY)) {
      moveView({ x: event.deltaX * units, y: 0 }, { x: 0, y: 0 }, zoom)
      return
    }
    const anchor = point(event)
    moveView(anchor, anchor, zoom * Math.exp(-event.deltaY * units * 0.002))
  }, { passive: false })

  arena.addEventListener('pointerdown', event => {
    if (event.target instanceof Element && event.target.closest('.hud')) return
    if (event.button !== 0 || pointers.size >= 2) return
    arena.setPointerCapture(event.pointerId)
    pointers.set(event.pointerId, point(event))
    arena.dataset.panning = ''
  })

  arena.addEventListener('pointermove', event => {
    if (!pointers.has(event.pointerId)) return
    const before = gesture()
    pointers.set(event.pointerId, point(event))
    const after = gesture()
    const ratio = before.distance > 0 ? after.distance / before.distance : 1
    moveView(before.center, after.center, zoom * ratio, true)
  })

  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) {
    arena.addEventListener(type, event => {
      if (pointers.delete(event.pointerId) && !pointers.size) {
        delete arena.dataset.panning
        render()
      }
    })
  }

  const resize = () => render()
  scene.scale.on('resize', resize)
  scene.events.once('shutdown', () => scene.scale.off('resize', resize))
  render()
}
