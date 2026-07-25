import type { EditorHistoryCommand } from '../../shared/history-commands'
import { useDocumentStore } from '../store/document-store'

export function executeEditorHistoryCommand(command: EditorHistoryCommand): void {
  const state = useDocumentStore.getState()
  if (command === 'undo') state.undo()
  else state.redo()
}
