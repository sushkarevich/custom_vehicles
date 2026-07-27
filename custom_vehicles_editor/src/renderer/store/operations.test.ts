import { describe, expect, it } from 'vitest'
import { createDefaultModel } from '../../shared/schema'
import {
  addPart,
  assignMaterialToParts,
  deletePart,
  deleteParts,
  duplicatePart,
  duplicateParts,
  generateUniquePartId,
  mirrorPart,
  mirrorParts,
  normalizeNumericInput,
  renamePart,
  reorderPart,
  reorderParts,
  setPartMetadata,
  setPartsMetadata,
  updatePart
} from './operations'

function threePartModel() {
  const roof = renamePart(addPart(createDefaultModel()).model, 'part', 'roof')
  return renamePart(addPart(roof.model).model, 'part', 'trim').model
}

describe('операции с деталями', () => {
  it('создаёт стабильные уникальные ID', () => {
    expect(generateUniquePartId('Wheel Left', ['wheel_left', 'wheel_left_2'])).toBe('wheel_left_3')
    expect(generateUniquePartId('Колесо', [])).toBe('part')
  })

  it('добавляет, дублирует, переименовывает и удаляет детали', () => {
    const initial = createDefaultModel()
    const added = addPart(initial, 'body')
    expect(added.model.parts).toHaveLength(2)
    const duplicated = duplicatePart(added.model, added.partId)
    expect(duplicated.model.parts).toHaveLength(3)
    expect(duplicated.partId).not.toBe(added.partId)
    const renamed = renamePart(duplicated.model, duplicated.partId, 'roof')
    expect(renamed.partId).toBe('roof')
    const deleted = deletePart(renamed.model, 'roof')
    expect(deleted.model.parts).toHaveLength(2)
    expect(deleted.model.parts.some((part) => part.id === 'roof')).toBe(false)
  })

  it('не удаляет последнюю деталь', () => {
    const model = createDefaultModel()
    expect(deletePart(model, 'body').model).toBe(model)
  })

  it('зеркально копирует по X и Z с корректными Euler XYZ знаками', () => {
    let model = createDefaultModel()
    model = updatePart(model, 'body', (part) => {
      part.position = { x: 2, y: 3, z: 4 }
      part['rotation-degrees'] = { x: 10, y: 20, z: 30 }
    })
    const mirrorX = mirrorPart(model, 'body', 'x')
    const xPart = mirrorX.model.parts.find((part) => part.id === mirrorX.partId)!
    expect(xPart.position).toEqual({ x: -2, y: 3, z: 4 })
    expect(xPart['rotation-degrees']).toEqual({ x: 10, y: -20, z: -30 })

    const mirrorZ = mirrorPart(model, 'body', 'z')
    const zPart = mirrorZ.model.parts.find((part) => part.id === mirrorZ.partId)!
    expect(zPart.position).toEqual({ x: 2, y: 3, z: -4 })
    expect(zPart['rotation-degrees']).toEqual({ x: -10, y: -20, z: 30 })
  })

  it('переносит editor metadata при копировании и очищает при удалении', () => {
    const model = setPartMetadata(createDefaultModel(), 'body', 'hidden-parts', true)
    const duplicated = duplicatePart(model, 'body')
    expect(duplicated.model.editor?.['hidden-parts']).toContain(duplicated.partId)
    const deleted = deletePart(duplicated.model, duplicated.partId)
    expect(deleted.model.editor?.['hidden-parts']).not.toContain(duplicated.partId)
  })

  it('меняет порядок без выхода за границы', () => {
    const added = addPart(createDefaultModel())
    const reordered = reorderPart(added.model, added.partId, -1)
    expect(reordered.parts.map((part) => part.id)).toEqual([added.partId, 'body'])
    expect(reorderPart(reordered, added.partId, -1)).toBe(reordered)
  })

  it('нормализует числовой ввод с русской десятичной запятой', () => {
    expect(normalizeNumericInput(' 1,23456789 ', 0)).toBe(1.234568)
    expect(normalizeNumericInput('не число', 7)).toBe(7)
    expect(normalizeNumericInput(200, 0, { min: -10, max: 64 })).toBe(64)
  })

  it('bulk duplicate и mirror создают стабильные ID в порядке модели', () => {
    const model = setPartsMetadata(
      threePartModel(),
      ['body', 'trim'],
      'hidden-parts',
      true
    )
    const duplicated = duplicateParts(model, ['trim', 'body'])
    expect(duplicated.partIds).toEqual(['body_2', 'trim_2'])
    expect(duplicated.partIdBySource.get('body')).toBe('body_2')
    expect(duplicated.partIdBySource.get('trim')).toBe('trim_2')
    expect(duplicated.model.parts.map((part) => part.id)).toEqual([
      'body',
      'body_2',
      'roof',
      'trim',
      'trim_2'
    ])
    expect(duplicated.model.editor?.['hidden-parts']).toEqual([
      'body',
      'trim',
      'body_2',
      'trim_2'
    ])
    expect(duplicateParts(model, ['trim', 'body']).partIds).toEqual(
      duplicated.partIds
    )

    const mirrored = mirrorParts(model, ['trim', 'body'], 'x')
    expect(mirrored.partIds).toEqual(['body_mirror_x', 'trim_mirror_x'])
    expect(mirrored.partIdBySource.get('trim')).toBe('trim_mirror_x')
  })

  it('bulk delete очищает metadata и выбирает соседа активной детали', () => {
    const model = setPartsMetadata(
      setPartsMetadata(
        threePartModel(),
        ['body', 'roof'],
        'hidden-parts',
        true
      ),
      ['roof'],
      'locked-parts',
      true
    )
    const deleted = deleteParts(model, ['body', 'roof'], 'roof')
    expect(deleted.deletedPartIds).toEqual(['body', 'roof'])
    expect(deleted.model.parts.map((part) => part.id)).toEqual(['trim'])
    expect(deleted.selectedPartId).toBe('trim')
    expect(deleted.model.editor?.['hidden-parts']).toEqual([])
    expect(deleted.model.editor?.['locked-parts']).toEqual([])

    const all = deleteParts(model, ['body', 'roof', 'trim'], 'roof')
    expect(all.model).toBe(model)
    expect(all.deletedPartIds).toEqual([])
  })

  it('bulk reorder сохраняет взаимный порядок выделенных деталей', () => {
    const model = threePartModel()
    expect(
      reorderParts(model, ['roof', 'trim'], -1).parts.map((part) => part.id)
    ).toEqual(['roof', 'trim', 'body'])
    expect(
      reorderParts(model, ['body', 'roof'], 1).parts.map((part) => part.id)
    ).toEqual(['trim', 'body', 'roof'])
  })

  it('bulk metadata и material применяются ко всем целям', () => {
    const model = threePartModel()
    const hidden = setPartsMetadata(
      model,
      ['body', 'trim'],
      'hidden-parts',
      true
    )
    expect(hidden.editor?.['hidden-parts']).toEqual(['body', 'trim'])
    const material = assignMaterialToParts(
      hidden,
      ['body', 'trim'],
      'ACACIA_PLANKS'
    )
    expect(
      material.parts
        .filter((part) => part.id !== 'roof')
        .map((part) => part.material)
    ).toEqual(['ACACIA_PLANKS', 'ACACIA_PLANKS'])
  })
})
