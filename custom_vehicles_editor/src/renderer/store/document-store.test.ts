import { beforeEach, describe, expect, it } from 'vitest'
import { createDefaultModel, createDefaultVariant } from '../../shared/schema'
import { useDocumentStore } from './document-store'

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
    expect(useDocumentStore.getState().selectedPartId).toBeNull()
  })

  it('меняет document epoch только при загрузке или создании документа', () => {
    const initialEpoch = useDocumentStore.getState().documentEpoch
    useDocumentStore.getState().selectPart(null)
    useDocumentStore.getState().update((document) => ({ ...document, id: 'edited_model' }))
    expect(useDocumentStore.getState().documentEpoch).toBe(initialEpoch)

    useDocumentStore.getState().reset(createDefaultModel())
    expect(useDocumentStore.getState().documentEpoch).toBe(initialEpoch + 1)
  })
})
