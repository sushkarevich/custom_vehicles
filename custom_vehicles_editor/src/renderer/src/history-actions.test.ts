import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createDefaultModel } from '../../shared/schema'
import { useDocumentStore } from '../store/document-store'
import { executeEditorHistoryCommand } from './history-actions'

describe('единый application history action path', () => {
  beforeEach(() => {
    useDocumentStore.getState().reset(createDefaultModel())
  })

  it('вызывает undo ровно один раз', () => {
    const undo = vi.spyOn(useDocumentStore.getState(), 'undo')
    executeEditorHistoryCommand('undo')
    expect(undo).toHaveBeenCalledOnce()
  })

  it('вызывает redo ровно один раз', () => {
    const redo = vi.spyOn(useDocumentStore.getState(), 'redo')
    executeEditorHistoryCommand('redo')
    expect(redo).toHaveBeenCalledOnce()
  })
})
