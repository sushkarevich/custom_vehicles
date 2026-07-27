import type {
  BrowserWindow,
  MenuItemConstructorOptions
} from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { installApplicationMenu } from './application-menu'

interface MockMenuItem {
  id?: string
  enabled?: boolean
  click?: () => void
  submenu?: MockMenuItem[]
}

const electron = vi.hoisted(() => ({
  template: null as MockMenuItem[] | null,
  setApplicationMenu: vi.fn()
}))

vi.mock('electron', () => ({
  app: {
    getName: () => 'Редактор CustomVehicles'
  },
  Menu: {
    buildFromTemplate: (template: MenuItemConstructorOptions[]) => {
      electron.template = template as MockMenuItem[]
      const findItem = (
        items: MockMenuItem[],
        id: string
      ): MockMenuItem | null => {
        for (const item of items) {
          if (item.id === id) return item
          const nested =
            item.submenu === undefined ? null : findItem(item.submenu, id)
          if (nested !== null) return nested
        }
        return null
      }
      return {
        getMenuItemById: (id: string) => findItem(electron.template ?? [], id)
      }
    },
    setApplicationMenu: electron.setApplicationMenu
  }
}))

function findItem(id: string): MockMenuItem {
  const visit = (items: MockMenuItem[]): MockMenuItem | null => {
    for (const item of items) {
      if (item.id === id) return item
      const nested = item.submenu === undefined ? null : visit(item.submenu)
      if (nested !== null) return nested
    }
    return null
  }
  const item = visit(electron.template ?? [])
  if (item === null) throw new Error(`Пункт меню ${id} не найден`)
  return item
}

function createWindow() {
  return {
    isDestroyed: vi.fn(() => false),
    webContents: {
      isDestroyed: vi.fn(() => false),
      send: vi.fn(),
      undo: vi.fn(),
      redo: vi.fn(),
      on: vi.fn(),
      removeListener: vi.fn()
    }
  }
}

describe('application menu window lifecycle', () => {
  beforeEach(() => {
    electron.template = null
    vi.clearAllMocks()
  })

  it('dispatches through the live window and ignores the same command after close', () => {
    const window = createWindow()
    let current = window
    const controller = installApplicationMenu(
      (() => current) as unknown as () => BrowserWindow | null
    )
    controller.updateHistoryState({
      canUndo: true,
      canRedo: false,
      textEditing: false
    })
    const undo = findItem('editor-history-undo')

    undo.click?.()
    expect(window.webContents.send).toHaveBeenCalledOnce()

    window.isDestroyed.mockReturnValue(true)
    expect(() => undo.click?.()).not.toThrow()
    expect(window.webContents.send).toHaveBeenCalledOnce()

    current = window
    controller.dispose()
  })

  it('accepts a late history-state update while closing without touching a dead window', () => {
    const window = createWindow()
    let current: ReturnType<typeof createWindow> | null = window
    const controller = installApplicationMenu(
      (() => current) as unknown as () => BrowserWindow | null
    )
    current = null

    expect(() =>
      controller.updateHistoryState({
        canUndo: true,
        canRedo: true,
        textEditing: false
      })
    ).not.toThrow()
    expect(findItem('editor-history-undo').enabled).toBe(true)
    expect(findItem('editor-history-redo').enabled).toBe(true)
    expect(window.webContents.send).not.toHaveBeenCalled()
  })

  it('disposes safely after webContents destruction and makes stale callbacks no-ops', () => {
    const window = createWindow()
    const controller = installApplicationMenu(
      (() => window) as unknown as () => BrowserWindow | null
    )
    const redo = findItem('editor-history-redo')
    window.webContents.isDestroyed.mockReturnValue(true)

    expect(() => controller.dispose()).not.toThrow()
    expect(window.webContents.removeListener).not.toHaveBeenCalled()
    expect(() => redo.click?.()).not.toThrow()
    expect(window.webContents.send).not.toHaveBeenCalled()
  })
})
