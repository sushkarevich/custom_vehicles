import {
  dispatchHistoryCommand,
  type EditorHistoryCommand,
  type EditorHistoryState
} from '../shared/history-commands'
import { IPC_CHANNELS } from '../shared/ipc'

interface DestroyableWindow {
  isDestroyed(): boolean
  readonly webContents: {
    isDestroyed(): boolean
  }
}

interface HistoryWindow extends DestroyableWindow {
  readonly webContents: DestroyableWindow['webContents'] & {
    send(channel: string, command: EditorHistoryCommand): void
    undo(): void
    redo(): void
  }
}

export type EditorWindowResolver<T extends DestroyableWindow> = () => T | null

/**
 * Resolves the editor window at the moment an action is dispatched. Callers
 * must not retain the returned window across an asynchronous boundary.
 */
export function resolveLiveEditorWindow<T extends DestroyableWindow>(
  resolveWindow: EditorWindowResolver<T>
): T | null {
  const window = resolveWindow()
  if (window === null || window.isDestroyed()) return null
  if (window.webContents.isDestroyed()) return null
  return window
}

export function dispatchHistoryToLiveWindow<T extends HistoryWindow>(
  resolveWindow: EditorWindowResolver<T>,
  state: EditorHistoryState,
  command: EditorHistoryCommand
): boolean {
  const window = resolveLiveEditorWindow(resolveWindow)
  if (window === null) return false
  const { webContents } = window

  dispatchHistoryCommand(state, command, {
    application: (next) => webContents.send(IPC_CHANNELS.editorCommand, next),
    nativeUndo: () => webContents.undo(),
    nativeRedo: () => webContents.redo()
  })
  return true
}
