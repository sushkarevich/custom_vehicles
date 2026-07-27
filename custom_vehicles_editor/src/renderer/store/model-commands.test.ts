import { describe, expect, it } from 'vitest'
import { createDefaultModel } from '../../shared/schema'
import { executeModelSelectionCommand } from './model-commands'
import {
  addPart,
  renamePart,
  setPartMetadata,
  updatePart
} from './operations'
import { selectionFromIds } from './selection'

function threePartModel() {
  const roof = renamePart(addPart(createDefaultModel()).model, 'part', 'roof')
  const trim = renamePart(addPart(roof.model).model, 'part', 'trim')
  return updatePart(
    updatePart(trim.model, 'body', (part) => {
      part.position.x = 2
    }),
    'trim',
    (part) => {
      part.position.x = -3
    }
  )
}

describe('единый путь multi-part команд', () => {
  it('дублирует детерминированно, но сохраняет порядок selection и active', () => {
    const result = executeModelSelectionCommand(
      threePartModel(),
      selectionFromIds(['trim', 'body'], 'body'),
      { type: 'duplicate' }
    )
    expect(result.model.parts.map((part) => part.id)).toEqual([
      'body',
      'body_2',
      'roof',
      'trim',
      'trim_2'
    ])
    expect(result.selection).toEqual({
      selectedPartIds: ['trim_2', 'body_2'],
      activePartId: 'body_2'
    })
  })

  it('удаляет одним результатом и выбирает соседа active', () => {
    const result = executeModelSelectionCommand(
      threePartModel(),
      selectionFromIds(['body', 'roof'], 'roof'),
      { type: 'delete' }
    )
    expect(result.model.parts.map((part) => part.id)).toEqual(['trim'])
    expect(result.selection).toEqual({
      selectedPartIds: ['trim'],
      activePartId: 'trim'
    })
  })

  it('не позволяет удалить модель целиком', () => {
    const model = threePartModel()
    const result = executeModelSelectionCommand(
      model,
      selectionFromIds(['body', 'roof', 'trim'], 'trim'),
      { type: 'delete' }
    )
    expect(result.model).toBe(model)
    expect(result.notice).toBe('Нельзя удалить все детали модели.')
  })

  it('зеркалит все незаблокированные детали и сообщает о пропуске', () => {
    const model = setPartMetadata(
      threePartModel(),
      'roof',
      'locked-parts',
      true
    )
    const result = executeModelSelectionCommand(
      model,
      selectionFromIds(['body', 'roof', 'trim'], 'roof'),
      { type: 'mirror', axis: 'x' }
    )
    expect(result.selection.selectedPartIds).toEqual([
      'body_mirror_x',
      'trim_mirror_x'
    ])
    expect(result.selection.activePartId).toBe('trim_mirror_x')
    expect(result.notice).toBe('Пропущено заблокированных деталей: 1.')
    expect(
      result.model.parts.find((part) => part.id === 'body_mirror_x')?.position.x
    ).toBe(-2)
    expect(
      result.model.parts.find((part) => part.id === 'trim_mirror_x')?.position.x
    ).toBe(3)
  })

  it('material пропускает locked, а lock/unlock применяется ко всем', () => {
    const model = setPartMetadata(
      threePartModel(),
      'roof',
      'locked-parts',
      true
    )
    const selection = selectionFromIds(['body', 'roof'], 'roof')
    const material = executeModelSelectionCommand(model, selection, {
      type: 'assign-material',
      material: 'ACACIA_PLANKS'
    })
    expect(
      material.model.parts.find((part) => part.id === 'body')?.material
    ).toBe('ACACIA_PLANKS')
    expect(
      material.model.parts.find((part) => part.id === 'roof')?.material
    ).not.toBe('ACACIA_PLANKS')
    expect(material.notice).toBe('Пропущено заблокированных деталей: 1.')

    const unlocked = executeModelSelectionCommand(model, selection, {
      type: 'set-metadata',
      key: 'locked-parts',
      enabled: false
    })
    expect(unlocked.model.editor?.['locked-parts']).toEqual([])
    expect(unlocked.notice).toBeNull()
  })

  it('скрывает и переупорядочивает selection как одну pure-команду', () => {
    const model = threePartModel()
    const selection = selectionFromIds(['roof', 'trim'], 'trim')
    const hidden = executeModelSelectionCommand(model, selection, {
      type: 'set-metadata',
      key: 'hidden-parts',
      enabled: true
    })
    expect(hidden.model.editor?.['hidden-parts']).toEqual(['roof', 'trim'])
    expect(hidden.selection).toEqual(selection)

    const reordered = executeModelSelectionCommand(model, selection, {
      type: 'reorder',
      direction: -1
    })
    expect(reordered.model.parts.map((part) => part.id)).toEqual([
      'roof',
      'trim',
      'body'
    ])
    expect(reordered.selection).toEqual(selection)
  })
})
