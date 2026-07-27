import {
  app,
  Menu,
  type BrowserWindow,
  type Event as ElectronEvent,
  type Input,
  type MenuItemConstructorOptions
} from 'electron'
import {
  EMPTY_EDITOR_HISTORY_STATE,
  historyAccelerators,
  isAlternateRedoShortcut,
  isHistoryCommandEnabled,
  type EditorHistoryCommand,
  type EditorHistoryState
} from '../shared/history-commands'
import {
  dispatchHistoryToLiveWindow,
  resolveLiveEditorWindow,
  type EditorWindowResolver
} from './editor-window'

export interface ApplicationMenuController {
  updateHistoryState(state: EditorHistoryState): void
  dispose(): void
}

export function installApplicationMenu(
  resolveWindow: EditorWindowResolver<BrowserWindow>
): ApplicationMenuController {
  let historyState = EMPTY_EDITOR_HISTORY_STATE
  let disposed = false
  const accelerators = historyAccelerators(process.platform)

  const dispatch = (command: EditorHistoryCommand): void => {
    if (disposed) return
    dispatchHistoryToLiveWindow(resolveWindow, historyState, command)
  }

  const template: MenuItemConstructorOptions[] = []
  if (process.platform === 'darwin') {
    template.push({
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    })
  }
  template.push({
    label: 'Правка',
    submenu: [
      {
        id: 'editor-history-undo',
        label: 'Отменить',
        accelerator: accelerators.undo,
        click: () => dispatch('undo')
      },
      {
        id: 'editor-history-redo',
        label: 'Повторить',
        accelerator: accelerators.redo,
        click: () => dispatch('redo')
      },
      { type: 'separator' },
      { role: 'cut' },
      { role: 'copy' },
      { role: 'paste' },
      { role: 'selectAll' }
    ]
  })

  const menu = Menu.buildFromTemplate(template)
  Menu.setApplicationMenu(menu)
  const undoItem = menu.getMenuItemById('editor-history-undo')
  const redoItem = menu.getMenuItemById('editor-history-redo')

  const updateHistoryState = (state: EditorHistoryState): void => {
    if (disposed) return
    historyState = state
    if (undoItem !== null) undoItem.enabled = isHistoryCommandEnabled(state, 'undo')
    if (redoItem !== null) redoItem.enabled = isHistoryCommandEnabled(state, 'redo')
  }
  updateHistoryState(historyState)

  const handleBeforeInput = (event: ElectronEvent, input: Input): void => {
    if (!isAlternateRedoShortcut(process.platform, input)) return
    event.preventDefault()
    dispatch('redo')
  }
  const sourceContents = resolveLiveEditorWindow(resolveWindow)?.webContents ?? null
  sourceContents?.on('before-input-event', handleBeforeInput)

  return {
    updateHistoryState,
    dispose() {
      if (disposed) return
      disposed = true
      if (sourceContents !== null && !sourceContents.isDestroyed()) {
        sourceContents.removeListener('before-input-event', handleBeforeInput)
      }
      if (undoItem !== null) undoItem.enabled = false
      if (redoItem !== null) redoItem.enabled = false
    }
  }
}
