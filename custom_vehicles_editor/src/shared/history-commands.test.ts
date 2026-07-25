import { describe, expect, it, vi } from 'vitest'
import {
  dispatchHistoryCommand,
  historyAccelerators,
  isAlternateRedoShortcut,
  isHistoryCommandEnabled,
  type EditorHistoryState,
  type HistoryCommandHandlers
} from './history-commands'

function input(overrides: Partial<Parameters<typeof isAlternateRedoShortcut>[1]> = {}) {
  return {
    key: 'z',
    control: true,
    meta: false,
    shift: true,
    alt: false,
    type: 'keyDown',
    ...overrides
  }
}

describe('native history shortcuts', () => {
  it('использует conventional accelerators на macOS', () => {
    expect(historyAccelerators('darwin')).toEqual({
      undo: 'CmdOrCtrl+Z',
      redo: 'CmdOrCtrl+Shift+Z'
    })
  })

  it('использует Ctrl+Z/Ctrl+Y и дополнительный Ctrl+Shift+Z на Windows/Linux', () => {
    expect(historyAccelerators('win32')).toEqual({
      undo: 'CmdOrCtrl+Z',
      redo: 'CmdOrCtrl+Y'
    })
    expect(historyAccelerators('linux')).toEqual(historyAccelerators('win32'))
    expect(isAlternateRedoShortcut('win32', input())).toBe(true)
    expect(isAlternateRedoShortcut('linux', input())).toBe(true)
    expect(isAlternateRedoShortcut('darwin', input())).toBe(false)
    expect(isAlternateRedoShortcut('win32', input({ shift: false }))).toBe(false)
  })

  it('выбирает ровно один application или native-text handler', () => {
    const handlers: HistoryCommandHandlers = {
      application: vi.fn(),
      nativeUndo: vi.fn(),
      nativeRedo: vi.fn()
    }
    const applicationState: EditorHistoryState = {
      canUndo: true,
      canRedo: true,
      textEditing: false
    }
    dispatchHistoryCommand(applicationState, 'undo', handlers)
    expect(handlers.application).toHaveBeenCalledOnce()
    expect(handlers.application).toHaveBeenCalledWith('undo')
    expect(handlers.nativeUndo).not.toHaveBeenCalled()

    dispatchHistoryCommand({ ...applicationState, textEditing: true }, 'redo', handlers)
    expect(handlers.application).toHaveBeenCalledOnce()
    expect(handlers.nativeRedo).toHaveBeenCalledOnce()
  })

  it('синхронизирует enabled state с application history и оставляет native editing доступным', () => {
    const empty: EditorHistoryState = {
      canUndo: false,
      canRedo: false,
      textEditing: false
    }
    expect(isHistoryCommandEnabled(empty, 'undo')).toBe(false)
    expect(isHistoryCommandEnabled({ ...empty, canUndo: true }, 'undo')).toBe(true)
    expect(isHistoryCommandEnabled({ ...empty, canRedo: true }, 'redo')).toBe(true)
    expect(isHistoryCommandEnabled({ ...empty, textEditing: true }, 'undo')).toBe(true)
    expect(isHistoryCommandEnabled({ ...empty, textEditing: true }, 'redo')).toBe(true)
  })
})
