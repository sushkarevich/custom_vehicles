import { useEffect } from 'react'
import { isModelDefinition } from '../../../shared/schema'
import { useDocumentStore } from '../../store/document-store'
import { deletePart, duplicatePart } from '../../store/operations'
import type { TransformMode } from '../types'

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return (
    target.matches('input, textarea, select, [contenteditable="true"]') ||
    target.closest('input, textarea, select, [contenteditable="true"]') !== null
  )
}

export function useKeyboardShortcuts(options: {
  setTransformMode: (mode: TransformMode) => void
  save: () => Promise<boolean>
  saveAs: () => Promise<boolean>
}): void {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      const command = event.metaKey || event.ctrlKey
      const key = event.key.toLocaleLowerCase('en-US')
      const editable = isEditableTarget(event.target)

      if (command && key === 's') {
        event.preventDefault()
        void (event.shiftKey ? options.saveAs() : options.save())
        return
      }
      if (editable) return

      if (command && key === 'z') {
        event.preventDefault()
        if (event.shiftKey) useDocumentStore.getState().redo()
        else useDocumentStore.getState().undo()
        return
      }
      if (command && key === 'y') {
        event.preventDefault()
        useDocumentStore.getState().redo()
        return
      }
      if (command && key === 'd') {
        event.preventDefault()
        const state = useDocumentStore.getState()
        const document = state.history.present
        if (!isModelDefinition(document) || state.selectedPartId === null) return
        const result = duplicatePart(document, state.selectedPartId)
        state.update(() => result.model)
        state.selectPart(result.partId)
        return
      }
      if (event.key === 'Delete' || event.key === 'Backspace') {
        const state = useDocumentStore.getState()
        const document = state.history.present
        if (!isModelDefinition(document) || state.selectedPartId === null) return
        event.preventDefault()
        const result = deletePart(document, state.selectedPartId)
        state.update(() => result.model)
        state.selectPart(result.selectedPartId)
        return
      }
      if (key === 'w') options.setTransformMode('translate')
      if (key === 'e') options.setTransformMode('rotate')
      if (key === 'r') options.setTransformMode('scale')
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [options])
}
