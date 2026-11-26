// Input rings are closed and expressed in terrain-mask cells.
export function simplifyRing(ring: number[][], tolerance: number): number[][] {
  if (tolerance <= 0 || ring.length <= 4) return ring

  const end = ring.length - 1
  const middle = Math.floor(end / 2)
  const keep = new Set([0, middle, end])
  const spans = [[0, middle], [middle, end]]
  while (spans.length) {
    const [first, last] = spans.pop()!
    const [x, y] = ring[first]
    const dx = ring[last][0] - x
    const dy = ring[last][1] - y
    const lengthSquared = dx * dx + dy * dy
    let furthest = -1
    let maxDistance = tolerance * tolerance

    for (let index = first + 1; index < last; index++) {
      const offsetX = ring[index][0] - x
      const offsetY = ring[index][1] - y
      const along = lengthSquared ? Math.max(0, Math.min(1, (offsetX * dx + offsetY * dy) / lengthSquared)) : 0
      const distance = (offsetX - along * dx) ** 2 + (offsetY - along * dy) ** 2
      if (distance > maxDistance) {
        furthest = index
        maxDistance = distance
      }
    }

    if (furthest >= 0) {
      keep.add(furthest)
      spans.push([first, furthest], [furthest, last])
    }
  }

  return keep.size < 4 ? ring : ring.filter((_, index) => keep.has(index))
}
