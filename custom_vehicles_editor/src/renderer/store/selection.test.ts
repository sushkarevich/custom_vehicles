import { describe, expect, it } from 'vitest'
import { createDefaultModel } from '../../shared/schema'
import { addPart } from './operations'
import {
  createPartSelection,
  normalizePartSelection,
  reducePartSelection,
  reducePartSelectionIntent,
  selectionFromIds
} from './selection'

describe('ordered multi-selection', () => {
  it('plain click replaces selection and makes the part active', () => {
    const initial = selectionFromIds(['body', 'roof'], 'roof')
    expect(reducePartSelection(initial, 'body', false)).toEqual({
      selectedPartIds: ['body'],
      activePartId: 'body'
    })
  })

  it('Shift+click adds an unselected part exactly once', () => {
    const initial = createPartSelection('body')
    const added = reducePartSelection(initial, 'roof', true)
    expect(added).toEqual({
      selectedPartIds: ['body', 'roof'],
      activePartId: 'roof'
    })
    expect(reducePartSelection(added, 'roof', true)).toEqual({
      selectedPartIds: ['body'],
      activePartId: 'body'
    })
  })

  it('removing a non-active part retains the active part', () => {
    const initial = selectionFromIds(['body', 'roof', 'trim'], 'trim')
    expect(reducePartSelection(initial, 'roof', true)).toEqual({
      selectedPartIds: ['body', 'trim'],
      activePartId: 'trim'
    })
  })

  it('uses the most recently selected remaining part when active is removed', () => {
    const initial = selectionFromIds(['body', 'roof', 'trim'], 'trim')
    expect(reducePartSelection(initial, 'trim', true)).toEqual({
      selectedPartIds: ['body', 'roof'],
      activePartId: 'roof'
    })
  })

  it('plain empty click clears while Shift+empty preserves selection', () => {
    const initial = selectionFromIds(['body', 'roof'], 'roof')
    expect(
      reducePartSelectionIntent(initial, { type: 'empty', additive: true })
    ).toBe(initial)
    expect(
      reducePartSelectionIntent(initial, { type: 'empty', additive: false })
    ).toEqual({
      selectedPartIds: [],
      activePartId: null
    })
  })

  it('deduplicates and normalizes IDs without changing their order', () => {
    const added = addPart(createDefaultModel())
    expect(
      normalizePartSelection(
        {
          selectedPartIds: [added.partId, 'missing', 'body', added.partId],
          activePartId: 'missing'
        },
        added.model
      )
    ).toEqual({
      selectedPartIds: [added.partId, 'body'],
      activePartId: 'body'
    })
  })

  it('clears model selection for a non-model document boundary', () => {
    expect(
      normalizePartSelection(selectionFromIds(['body']), null)
    ).toEqual({
      selectedPartIds: [],
      activePartId: null
    })
  })
})
