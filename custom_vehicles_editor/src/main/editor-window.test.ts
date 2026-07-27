import { describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'
import type { EditorHistoryCommand } from '../shared/history-commands'
import {
  dispatchHistoryToLiveWindow,
  resolveLiveEditorWindow
} from './editor-window'

interface FakeWindow {
  isDestroyed: Mock<() => boolean>
  webContents: {
    isDestroyed: Mock<() => boolean>
    send: Mock<(channel: string, command: EditorHistoryCommand) => void>
    undo: Mock<() => void>
    redo: Mock<() => void>
  }
}

function createWindow(): FakeWindow {
  return {
    isDestroyed: vi.fn(() => false),
    webContents: {
      isDestroyed: vi.fn(() => false),
      send: vi.fn<(channel: string, command: EditorHistoryCommand) => void>(),
      undo: vi.fn<() => void>(),
      redo: vi.fn<() => void>()
    }
  }
}

const applicationHistory = {
  canUndo: true,
  canRedo: true,
  textEditing: false
}

describe('live editor window lifecycle', () => {
  it('dispatches a menu command to the current valid renderer exactly once', () => {
    const window = createWindow()

    expect(
      dispatchHistoryToLiveWindow(() => window, applicationHistory, 'undo')
    ).toBe(true)
    expect(window.webContents.send).toHaveBeenCalledOnce()
    expect(window.webContents.send).toHaveBeenCalledWith('editor:command', 'undo')
    expect(window.webContents.undo).not.toHaveBeenCalled()
  })

  it('uses native field history without also dispatching application history', () => {
    const window = createWindow()

    dispatchHistoryToLiveWindow(
      () => window,
      { ...applicationHistory, textEditing: true },
      'redo'
    )

    expect(window.webContents.redo).toHaveBeenCalledOnce()
    expect(window.webContents.send).not.toHaveBeenCalled()
  })

  it('ignores a stale menu callback after its window has been destroyed', () => {
    const window = createWindow()
    window.isDestroyed.mockReturnValue(true)

    expect(() =>
      dispatchHistoryToLiveWindow(() => window, applicationHistory, 'undo')
    ).not.toThrow()
    expect(window.webContents.isDestroyed).not.toHaveBeenCalled()
    expect(window.webContents.send).not.toHaveBeenCalled()
  })

  it('does not send to destroyed webContents', () => {
    const window = createWindow()
    window.webContents.isDestroyed.mockReturnValue(true)

    expect(
      dispatchHistoryToLiveWindow(() => window, applicationHistory, 'redo')
    ).toBe(false)
    expect(window.webContents.send).not.toHaveBeenCalled()
    expect(window.webContents.redo).not.toHaveBeenCalled()
  })

  it('makes shutdown callbacks harmless after the live reference is cleared', () => {
    const window = createWindow()
    let current: FakeWindow | null = window
    const resolveWindow = (): FakeWindow | null => current

    expect(resolveLiveEditorWindow(resolveWindow)).toBe(window)
    current = null

    expect(() =>
      dispatchHistoryToLiveWindow(resolveWindow, applicationHistory, 'undo')
    ).not.toThrow()
    expect(window.webContents.send).not.toHaveBeenCalled()
  })
})
