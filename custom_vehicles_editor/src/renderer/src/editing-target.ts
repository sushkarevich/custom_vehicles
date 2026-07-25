const TEXT_INPUT_TYPES = new Set([
  'email',
  'number',
  'password',
  'search',
  'tel',
  'text',
  'url'
])

function closestElement(target: EventTarget | null, selector: string): Element | null {
  if (!(target instanceof Element)) return null
  return target.matches(selector) ? target : target.closest(selector)
}

export function isTextEditingTarget(target: EventTarget | null): boolean {
  const control = closestElement(target, 'input, textarea, [contenteditable]')
  if (control instanceof HTMLTextAreaElement) return true
  if (control instanceof HTMLInputElement) return TEXT_INPUT_TYPES.has(control.type)
  return (
    control instanceof HTMLElement &&
    control.hasAttribute('contenteditable') &&
    control.getAttribute('contenteditable') !== 'false'
  )
}

export function isKeyboardEditingTarget(target: EventTarget | null): boolean {
  return (
    isTextEditingTarget(target) ||
    closestElement(target, 'select') instanceof HTMLSelectElement
  )
}
