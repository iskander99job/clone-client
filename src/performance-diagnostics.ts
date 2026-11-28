const SAMPLE_CAPACITY = 600
const REFRESH_INTERVAL = 500

export function mountPerformanceDiagnostics(arena: HTMLElement) {
  const panel = document.createElement('pre')
  panel.className = 'performance-diagnostics'
  panel.textContent = 'Измерение кадров…'
  arena.append(panel)

  const samples: number[] = []
  let cursor = 0
  let previousTime: number | undefined
  let lastRefresh = 0
  let frame = requestAnimationFrame(sample)

  function sample(now: number) {
    frame = requestAnimationFrame(sample)
    if (document.hidden) {
      previousTime = undefined
      return
    }
    const duration = previousTime === undefined ? 0 : now - previousTime
    previousTime = now
    if (duration <= 0) return

    samples[cursor] = duration
    cursor = (cursor + 1) % SAMPLE_CAPACITY
    if (now - lastRefresh < REFRESH_INTERVAL) return

    lastRefresh = now
    const ranked = samples.slice().sort((a, b) => a - b)
    const mean = samples.reduce((total, value) => total + value, 0) / samples.length
    const percentile = (p: number) => ranked[Math.ceil(ranked.length * p) - 1].toFixed(1)
    // The selector includes the SVG roots and counts nested SVG elements once.
    const svgCount = arena.querySelectorAll('svg, svg *').length
    const clipCount = arena.querySelectorAll('#terrain-crater-clip *').length
    panel.textContent = [
      `FPS ${(1000 / duration).toFixed(1)} · средний ${(1000 / mean).toFixed(1)}`,
      `Кадр ${duration.toFixed(1)} мс · p95 ${percentile(0.95)} · p99 ${percentile(0.99)} мс`,
      `SVG DOM ${svgCount} · отсечение ${clipCount}`,
    ].join('\n')
  }

  function resetTimestamp() {
    previousTime = undefined
  }
  document.addEventListener('visibilitychange', resetTimestamp)
  return () => {
    cancelAnimationFrame(frame)
    document.removeEventListener('visibilitychange', resetTimestamp)
    panel.remove()
  }
}
