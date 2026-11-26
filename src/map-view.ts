type Point = { x: number; y: number }

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))

export function bindMapView(arena: HTMLElement, aspect: number) {
  let zoom = 1
  let x = 0
  let y = 0
  const pointers = new Map<number, Point>()

  function render() {
    const width = arena.clientWidth
    const height = arena.clientHeight
    const mapHeight = Math.min(height, width / aspect)
    const xLimit = Math.max(0, (mapHeight * aspect * zoom - width) / 2)
    const yLimit = Math.max(0, (mapHeight * zoom - height) / 2)
    x = clamp(x, -xLimit, xLimit)
    y = clamp(y, -yLimit, yLimit)
    arena.style.setProperty('--map-pan-x', `${x}px`)
    arena.style.setProperty('--map-zoom', String(zoom))
    arena.style.setProperty('--map-pan-y', `${y}px`)
  }

  function moveView(from: Point, to: Point, requestedZoom: number) {
    const nextZoom = clamp(requestedZoom, 1, 4)
    const ratio = nextZoom / zoom
    x = to.x - (from.x - x) * ratio
    y = to.y - (from.y - y) * ratio
    zoom = nextZoom
    render()
  }

  function point(event: MouseEvent): Point {
    const bounds = arena.getBoundingClientRect()
    return {
      x: event.clientX - bounds.left - bounds.width / 2,
      y: event.clientY - bounds.top - bounds.height / 2,
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
      x -= event.deltaX * units
      render()
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

  new ResizeObserver(render).observe(arena)
  render()
}
