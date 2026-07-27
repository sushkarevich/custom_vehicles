import { beforeEach, describe, expect, it } from 'vitest'
import {
  createDefaultModel,
  createDefaultVariant,
  isModelDefinition
} from '../../shared/schema'
import { useDocumentStore } from './document-store'
import { addPart, renamePart } from './operations'
import { selectionFromIds } from './selection'

function threePartModel() {
  const roof = renamePart(addPart(createDefaultModel()).model, 'part', 'roof')
  return renamePart(addPart(roof.model).model, 'part', 'trim').model
}

describe('хранилище документа', () => {
  beforeEach(() => {
    useDocumentStore.getState().reset(createDefaultModel())
  })

  it('отслеживает dirty и сохранённый путь', () => {
    const store = useDocumentStore.getState()
    store.update((document) => ({ ...document, id: 'car_default' }))
    expect(useDocumentStore.getState().dirty).toBe(true)
    useDocumentStore.getState().markSaved('/tmp/машины/car_default.yaml')
    expect(useDocumentStore.getState().dirty).toBe(false)
    expect(useDocumentStore.getState().filePath).toContain('машины')
  })

  it('поддерживает grouped history через store', () => {
    useDocumentStore.getState().beginTransaction()
    useDocumentStore.getState().update((document) => ({ ...document, id: 'one' }))
    useDocumentStore.getState().update((document) => ({ ...document, id: 'two' }))
    useDocumentStore.getState().endTransaction()
    expect(useDocumentStore.getState().history.past).toHaveLength(1)
    useDocumentStore.getState().undo()
    expect(useDocumentStore.getState().history.present.id).toBe('new_model')
    useDocumentStore.getState().redo()
    expect(useDocumentStore.getState().history.present.id).toBe('two')
  })

  it('переключает режим модели и варианта', () => {
    useDocumentStore.getState().reset(createDefaultVariant())
    expect(useDocumentStore.getState().kind).toBe('variant')
    expect(useDocumentStore.getState().activePartId).toBeNull()
    expect(useDocumentStore.getState().selectedPartIds).toEqual([])
  })

  it('меняет document epoch только при загрузке или создании документа', () => {
    const initialEpoch = useDocumentStore.getState().documentEpoch
    useDocumentStore.getState().selectPart(null)
    useDocumentStore.getState().update((document) => ({ ...document, id: 'edited_model' }))
    expect(useDocumentStore.getState().documentEpoch).toBe(initialEpoch)

    useDocumentStore.getState().reset(createDefaultModel())
    expect(useDocumentStore.getState().documentEpoch).toBe(initialEpoch + 1)
  })

  it('selection gestures не создают history и не меняют dirty', () => {
    useDocumentStore.getState().reset(threePartModel())
    const initialPast = useDocumentStore.getState().history.past

    useDocumentStore.getState().selectPart('roof', true)
    expect(useDocumentStore.getState().selectedPartIds).toEqual(['body', 'roof'])
    expect(useDocumentStore.getState().activePartId).toBe('roof')

    useDocumentStore.getState().selectPart('body', true)
    expect(useDocumentStore.getState().selectedPartIds).toEqual(['roof'])
    expect(useDocumentStore.getState().activePartId).toBe('roof')

    useDocumentStore.getState().selectPart(null, true)
    expect(useDocumentStore.getState().selectedPartIds).toEqual(['roof'])
    useDocumentStore.getState().selectPart(null)
    expect(useDocumentStore.getState().selectedPartIds).toEqual([])

    expect(useDocumentStore.getState().history.past).toBe(initialPast)
    expect(useDocumentStore.getState().dirty).toBe(false)
  })

  it('atomic duplicate восстанавливает exact before/after selection через Undo/Redo', () => {
    useDocumentStore.getState().reset(threePartModel())
    useDocumentStore.getState().setSelection(['trim', 'body'], 'body')

    useDocumentStore.getState().executeModelCommand({ type: 'duplicate' })
    expect(useDocumentStore.getState().history.past).toHaveLength(1)
    expect(useDocumentStore.getState().selectedPartIds).toEqual([
      'trim_2',
      'body_2'
    ])
    expect(useDocumentStore.getState().activePartId).toBe('body_2')

    // A later selection gesture must not rewrite the command's history context.
    useDocumentStore.getState().selectPart('roof')
    useDocumentStore.getState().undo()
    expect(useDocumentStore.getState().selectedPartIds).toEqual([
      'trim',
      'body'
    ])
    expect(useDocumentStore.getState().activePartId).toBe('body')

    useDocumentStore.getState().selectPart('roof')
    useDocumentStore.getState().redo()
    expect(useDocumentStore.getState().selectedPartIds).toEqual([
      'trim_2',
      'body_2'
    ])
    expect(useDocumentStore.getState().activePartId).toBe('body_2')
  })

  it('multi-delete — одна history entry с exact selection restoration', () => {
    useDocumentStore.getState().reset(threePartModel())
    useDocumentStore.getState().setSelection(['body', 'roof'], 'roof')

    useDocumentStore.getState().executeModelCommand({ type: 'delete' })
    expect(useDocumentStore.getState().history.past).toHaveLength(1)
    expect(useDocumentStore.getState().selectedPartIds).toEqual(['trim'])
    const deletedDocument = useDocumentStore.getState().history.present
    expect(
      isModelDefinition(deletedDocument)
        ? deletedDocument.parts.map((part) => part.id)
        : null
    ).toEqual(['trim'])

    useDocumentStore.getState().undo()
    expect(useDocumentStore.getState().selectedPartIds).toEqual([
      'body',
      'roof'
    ])
    expect(useDocumentStore.getState().activePartId).toBe('roof')

    useDocumentStore.getState().redo()
    expect(useDocumentStore.getState().selectedPartIds).toEqual(['trim'])
  })

  it.each([
    {
      name: 'mirror',
      selection: ['body', 'roof'],
      command: { type: 'mirror' as const, axis: 'x' as const }
    },
    {
      name: 'metadata',
      selection: ['body', 'roof'],
      command: {
        type: 'set-metadata' as const,
        key: 'hidden-parts' as const,
        enabled: true
      }
    },
    {
      name: 'material',
      selection: ['body', 'roof'],
      command: {
        type: 'assign-material' as const,
        material: 'ACACIA_PLANKS'
      }
    },
    {
      name: 'reorder',
      selection: ['roof', 'trim'],
      command: { type: 'reorder' as const, direction: -1 as const }
    }
  ])('$name multi-command создаёт ровно одну history entry', ({
    selection,
    command
  }) => {
    useDocumentStore.getState().reset(threePartModel())
    useDocumentStore.getState().setSelection(selection)
    useDocumentStore.getState().executeModelCommand(command)
    expect(useDocumentStore.getState().history.past).toHaveLength(1)
  })

  it('applyEdit атомарно меняет document и ID selection', () => {
    useDocumentStore.getState().reset(threePartModel())
    useDocumentStore.getState().setSelection(['roof'], 'roof')
    useDocumentStore.getState().applyEdit((document) => {
      if (!isModelDefinition(document)) return { document }
      const result = renamePart(document, 'roof', 'upper_roof')
      return {
        document: result.model,
        selection: selectionFromIds([result.partId], result.partId)
      }
    })

    expect(useDocumentStore.getState().activePartId).toBe('upper_roof')
    expect(useDocumentStore.getState().history.past).toHaveLength(1)
    useDocumentStore.getState().undo()
    expect(useDocumentStore.getState().activePartId).toBe('roof')
    useDocumentStore.getState().redo()
    expect(useDocumentStore.getState().activePartId).toBe('upper_roof')
  })

  it('store command читает актуальный document, а не stale component snapshot', () => {
    useDocumentStore.getState().reset(threePartModel())
    useDocumentStore.getState().setSelection(['body'], 'body')
    useDocumentStore.getState().update((document) => {
      if (!isModelDefinition(document)) return document
      const body = document.parts.find((part) => part.id === 'body')
      if (body !== undefined) body.material = 'GOLD_BLOCK'
      return document
    })
    const historyLength = useDocumentStore.getState().history.past.length

    useDocumentStore.getState().executeModelCommand({ type: 'duplicate' })

    const document = useDocumentStore.getState().history.present
    expect(
      isModelDefinition(document)
        ? document.parts.find((part) => part.id === 'body_2')?.material
        : null
    ).toBe('GOLD_BLOCK')
    expect(useDocumentStore.getState().history.past).toHaveLength(
      historyLength + 1
    )
  })

  it('grouped update сохраняет selection context и одну history entry', () => {
    useDocumentStore.getState().reset(threePartModel())
    useDocumentStore.getState().setSelection(['body', 'trim'], 'trim')
    useDocumentStore.getState().beginTransaction()
    useDocumentStore.getState().update((document) => ({
      ...document,
      id: 'first'
    }))
    useDocumentStore.getState().update((document) => ({
      ...document,
      id: 'second'
    }))
    useDocumentStore.getState().endTransaction()

    expect(useDocumentStore.getState().history.past).toHaveLength(1)
    useDocumentStore.getState().selectPart('roof')
    useDocumentStore.getState().undo()
    expect(useDocumentStore.getState().selectedPartIds).toEqual([
      'body',
      'trim'
    ])
    expect(useDocumentStore.getState().activePartId).toBe('trim')
  })

  it('Undo безопасно завершает открытую transaction и сохраняет selection context для Redo', () => {
    useDocumentStore.getState().reset(threePartModel())
    useDocumentStore.getState().setSelection(['roof', 'trim'], 'trim')
    useDocumentStore.getState().beginTransaction()
    useDocumentStore.getState().update((document) => ({
      ...document,
      id: 'during_drag'
    }))

    useDocumentStore.getState().undo()
    expect(useDocumentStore.getState().history.group).toBeNull()
    expect(useDocumentStore.getState().history.present.id).toBe('new_model')
    expect(useDocumentStore.getState().selectedPartIds).toEqual([
      'roof',
      'trim'
    ])

    useDocumentStore.getState().selectPart('body')
    useDocumentStore.getState().redo()
    expect(useDocumentStore.getState().history.present.id).toBe('during_drag')
    expect(useDocumentStore.getState().selectedPartIds).toEqual([
      'roof',
      'trim'
    ])
    expect(useDocumentStore.getState().activePartId).toBe('trim')
  })
})
