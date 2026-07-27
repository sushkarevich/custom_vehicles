export type EditorHistoryCommand = 'undo' | 'redo'

export interface EditorHistoryState {
  canUndo: boolean
  canRedo: boolean
  textEditing: boolean
}

export const EMPTY_EDITOR_HISTORY_STATE: EditorHistoryState = {
  canUndo: false,
  canRedo: false,
  textEditing: false
}

export function historyAccelerators(platform: string): {
  undo: string
  redo: string
} {
  return {
    undo: 'CmdOrCtrl+Z',
    redo: platform === 'darwin' ? 'CmdOrCtrl+Shift+Z' : 'CmdOrCtrl+Y'
  }
}

export interface KeyboardInputLike {
  key: string
  control: boolean
  meta: boolean
  shift: boolean
  alt: boolean
  type?: string
}

export function isAlternateRedoShortcut(
  platform: string,
  input: KeyboardInputLike
): boolean {
  return (
    platform !== 'darwin' &&
    (input.type === undefined || input.type === 'keyDown') &&
    input.control &&
    !input.meta &&
    input.shift &&
    !input.alt &&
    input.key.toLocaleLowerCase('en-US') === 'z'
  )
}

export function isEditorHistoryCommand(value: unknown): value is EditorHistoryCommand {
  return value === 'undo' || value === 'redo'
}

export function isEditorHistoryState(value: unknown): value is EditorHistoryState {
  if (typeof value !== 'object' || value === null) return false
  const state = value as Partial<EditorHistoryState>
  return (
    typeof state.canUndo === 'boolean' &&
    typeof state.canRedo === 'boolean' &&
    typeof state.textEditing === 'boolean'
  )
}

export function isHistoryCommandEnabled(
  state: EditorHistoryState,
  command: EditorHistoryCommand
): boolean {
  if (state.textEditing) return true
  return command === 'undo' ? state.canUndo : state.canRedo
}

export interface HistoryCommandHandlers {
  application(command: EditorHistoryCommand): void
  nativeUndo(): void
  nativeRedo(): void
}

export function dispatchHistoryCommand(
  state: EditorHistoryState,
  command: EditorHistoryCommand,
  handlers: HistoryCommandHandlers
): void {
  if (!state.textEditing) {
    handlers.application(command)
    return
  }
  if (command === 'undo') handlers.nativeUndo()
  else handlers.nativeRedo()
}
