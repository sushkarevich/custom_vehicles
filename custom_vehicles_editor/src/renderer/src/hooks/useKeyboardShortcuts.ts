import { useEffect } from 'react'
import { useDocumentStore } from '../../store/document-store'
import { isKeyboardEditingTarget } from '../editing-target'
import type { TransformMode } from '../types'

export function useKeyboardShortcuts(options: {
  enabled: boolean
  setTransformMode: (mode: TransformMode) => void
  save: () => Promise<boolean>
  saveAs: () => Promise<boolean>
}): void {
  useEffect(() => {
    if (!options.enabled) return
    const handleKeyDown = (event: KeyboardEvent): void => {
      const command = event.metaKey || event.ctrlKey
      const key = event.key.toLocaleLowerCase('en-US')
      const editable = isKeyboardEditingTarget(event.target)

      if (command && key === 's') {
        event.preventDefault()
        void (event.shiftKey ? options.saveAs() : options.save())
        return
      }
      if (editable) return

      // Undo/redo accelerators are owned by the Electron main process. Keeping
      // them out of this DOM listener prevents one key press from executing twice.
      if (command && key === 'd') {
        event.preventDefault()
        const state = useDocumentStore.getState()
        if (state.selectedPartIds.length === 0) return
        state.executeModelCommand({ type: 'duplicate' })
        return
      }
      if (event.key === 'Delete' || event.key === 'Backspace') {
        const state = useDocumentStore.getState()
        if (state.selectedPartIds.length === 0) return
        event.preventDefault()
        state.executeModelCommand({ type: 'delete' })
        return
      }
      // Transform hotkeys follow the physical W/E/R keys so they remain usable
      // with the Russian keyboard layout selected.
      if (event.code === 'KeyW') options.setTransformMode('translate')
      if (event.code === 'KeyE') options.setTransformMode('rotate')
      if (event.code === 'KeyR') options.setTransformMode('scale')
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [options])
}
