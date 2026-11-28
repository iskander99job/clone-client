import { SVG_NS } from './svg-viewport'

const STEP = 10
const OUTLINE = 'M-45,20 C-58,8 -42,-20 -24,-23 C-15,-44 10,-45 21,-28 C44,-36 55,-14 48,-1 C61,12 44,37 27,32 C14,45 -7,41 -17,31 C-35,40 -50,33 -45,20Z'

export function mountSvgObjectTest(arena: HTMLElement, svg: SVGSVGElement, width: number, height: number) {
  const controls = document.createElement('div')
  controls.className = 'svg-test-controls'
  controls.setAttribute('role', 'group')
  controls.setAttribute('aria-label', 'Количество SVG-объектов')
  controls.innerHTML = `
    <button type="button" aria-label="Добавить 10 SVG-объектов">+10</button>
    <output aria-label="SVG-объектов" aria-live="polite"></output>
    <button type="button" aria-label="Убрать 10 SVG-объектов">−10</button>
  `
  arena.querySelector('.hud')!.append(controls)
  const [plus, minus] = controls.querySelectorAll('button')
  const count = controls.querySelector('output')!
  const objects = document.createElementNS(SVG_NS, 'g')
  objects.id = 'svg-test-objects'
  svg.append(objects)

  function updateCount() {
    count.textContent = String(objects.childElementCount)
    minus.disabled = objects.childElementCount <= 1
  }

  function addObject() {
    const index = objects.childElementCount
    const spread = (stride: number) => index === 0 ? 0.5 : 0.1 + (index * stride % 1) * 0.8
    const x = width * spread(0.61803398875)
    const y = height * spread(0.41421356237)
    const object = document.createElementNS(SVG_NS, 'path')
    object.setAttribute('d', OUTLINE)
    object.setAttribute('transform', `translate(${x} ${y}) rotate(${index * 37 % 360})`)
    object.setAttribute('fill', index % 2 ? '#9ce6da' : '#ffe4aa')
    object.setAttribute('stroke', '#493251')
    object.setAttribute('stroke-width', '4')
    objects.append(object)
  }

  plus.addEventListener('click', () => {
    for (let i = 0; i < STEP; i++) addObject()
    updateCount()
  })
  minus.addEventListener('click', () => {
    for (let i = 0; i < STEP && objects.childElementCount > 1; i++) objects.lastElementChild?.remove()
    updateCount()
  })
  addObject()
  updateCount()
  return () => controls.remove()
}
