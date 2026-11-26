import type Phaser from 'phaser'

type Point = { x: number; y: number }

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))

export function bindMapView(
  arena: HTMLElement,
  scene: Phaser.Scene,
  mapWidth: number,
  mapHeight: number,
  waterY: number,
) {
  const camera = scene.cameras.main
  let zoom = 1
  const center = { x: mapWidth / 2, y: mapHeight / 2 }
  const pointers = new Map<number, Point>()

  function cameraZoom() {
    return Math.min(camera.width / mapWidth, camera.height / mapHeight) * zoom
  }

  function boundCenter(value: number, mapSize: number, viewSize: number) {
    const limit = Math.max(0, (mapSize - viewSize) / 2)
    return clamp(value, mapSize / 2 - limit, mapSize / 2 + limit)
  }

  function render() {
    const scale = cameraZoom()
    if (scale <= 0) return
    center.x = boundCenter(center.x, mapWidth, camera.width / scale)
    center.y = boundCenter(center.y, mapHeight, camera.height / scale)
    camera.setZoom(scale).centerOn(center.x, center.y)
    const waterTop = camera.height / 2 + (waterY - center.y) * scale
    arena.style.setProperty('--water-top', `${waterTop}px`)
  }

  function moveView(from: Point, to: Point, requestedZoom: number) {
    const previousScale = cameraZoom()
    if (previousScale <= 0) return
    zoom = clamp(requestedZoom, 1, 4)
    const nextScale = cameraZoom()
    center.x += from.x / previousScale - to.x / nextScale
    center.y += from.y / previousScale - to.y / nextScale
    render()
  }

  function point(event: MouseEvent): Point {
    const bounds = arena.getBoundingClientRect()
    return {
      x: (event.clientX - bounds.left - bounds.width / 2) * camera.width / bounds.width,
      y: (event.clientY - bounds.top - bounds.height / 2) * camera.height / bounds.height,
    }
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
    moveView(before.center, after.center, zoom * ratio)
  })

  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) {
    arena.addEventListener(type, event => {
      pointers.delete(event.pointerId)
      if (!pointers.size) delete arena.dataset.panning
    })
  }

  scene.scale.on('resize', render)
  render()
}
