import { describe, expect, it } from 'vitest'
import { isKeyboardEditingTarget, isTextEditingTarget } from './editing-target'

describe('focus policy истории', () => {
  it('распознаёт реальные текстовые controls и вложенный contenteditable', () => {
    const input = document.createElement('input')
    const textarea = document.createElement('textarea')
    const editable = document.createElement('div')
    const child = document.createElement('span')
    editable.setAttribute('contenteditable', 'true')
    editable.append(child)
    document.body.append(input, textarea, editable)

    expect(isTextEditingTarget(input)).toBe(true)
    expect(isTextEditingTarget(textarea)).toBe(true)
    expect(isTextEditingTarget(child)).toBe(true)
    expect(isTextEditingTarget(document.body)).toBe(false)
  })

  it('не считает checkbox текстовым, но блокирует global shortcuts для select', () => {
    const checkbox = document.createElement('input')
    checkbox.type = 'checkbox'
    const select = document.createElement('select')
    expect(isTextEditingTarget(checkbox)).toBe(false)
    expect(isTextEditingTarget(select)).toBe(false)
    expect(isKeyboardEditingTarget(select)).toBe(true)
  })
})
