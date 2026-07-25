import { useCallback, useEffect } from 'react'
import type { EditorHistoryCommand } from '../../../shared/history-commands'
import { isTextEditingTarget } from '../editing-target'
import { executeEditorHistoryCommand } from '../history-actions'

export function useHistoryIntegration(
  canUndo: boolean,
  canRedo: boolean
): (command: EditorHistoryCommand) => void {
  const execute = useCallback((command: EditorHistoryCommand) => {
    executeEditorHistoryCommand(command)
  }, [])

  useEffect(() => window.editorApi.onHistoryCommand(execute), [execute])

  useEffect(() => {
    const report = (textEditing: boolean): void => {
      window.editorApi.setHistoryState({ canUndo, canRedo, textEditing })
    }
    const handleFocusIn = (event: FocusEvent): void => {
      report(isTextEditingTarget(event.target))
    }
    const handleFocusOut = (event: FocusEvent): void => {
      report(isTextEditingTarget(event.relatedTarget))
    }

    report(isTextEditingTarget(document.activeElement))
    window.addEventListener('focusin', handleFocusIn)
    window.addEventListener('focusout', handleFocusOut)
    return () => {
      window.removeEventListener('focusin', handleFocusIn)
      window.removeEventListener('focusout', handleFocusOut)
    }
  }, [canRedo, canUndo])

  return execute
}
