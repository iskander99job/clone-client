export function mountSvgBackground(field: HTMLElement, artwork: string) {
  const drawing = new DOMParser().parseFromString(artwork, 'image/svg+xml').documentElement
  const background = document.importNode(drawing, true)
  background.classList.add('map-background')
  background.setAttribute('aria-hidden', 'true')
  background.setAttribute('preserveAspectRatio', 'xMidYMid slice')
  field.before(background)
  return () => background.remove()
}
