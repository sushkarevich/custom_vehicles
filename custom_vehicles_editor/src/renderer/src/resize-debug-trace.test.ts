import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const ENABLED_KEY = 'customVehicles.resizeTrace'
const RECORDS_KEY = 'customVehicles.resizeTrace.records'

function createStorage(): Storage {
  const values = new Map<string, string>()
  return {
    get length() {
      return values.size
    },
    clear() {
      values.clear()
    },
    getItem(key) {
      return values.get(key) ?? null
    },
    key(index) {
      return [...values.keys()][index] ?? null
    },
    removeItem(key) {
      values.delete(key)
    },
    setItem(key, value) {
      values.set(key, value)
    }
  }
}

describe('resize physical-input diagnostic persistence', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: createStorage()
    })
    window.localStorage.clear()
    delete window.__CUSTOM_VEHICLES_RESIZE_TRACE__
    vi.resetModules()
  })

  afterEach(() => {
    window.localStorage.clear()
    delete window.__CUSTOM_VEHICLES_RESIZE_TRACE__
  })

  it('does not allocate trace state while disabled', async () => {
    const { recordResizeDebugTrace } = await import('./resize-debug-trace')

    recordResizeDebugTrace('controller', 'pointerdown', { sessionId: 1 })

    expect(window.__CUSTOM_VEHICLES_RESIZE_TRACE__).toBeUndefined()
    expect(window.localStorage.getItem(RECORDS_KEY)).toBeNull()
  })

  it('hydrates physical trace records after a module reload', async () => {
    window.localStorage.setItem(ENABLED_KEY, '1')
    const { recordResizeDebugTrace } = await import('./resize-debug-trace')
    recordResizeDebugTrace('controller', 'pointerup-after-update', {
      sessionId: 7,
      state: 'dragging'
    })
    recordResizeDebugTrace('session', 'commit-complete', {
      sessionId: 7,
      storeTransforms: { part: { scale: [2, 1, 1] } }
    })

    expect(JSON.parse(window.localStorage.getItem(RECORDS_KEY) ?? '[]')).toHaveLength(
      2
    )

    delete window.__CUSTOM_VEHICLES_RESIZE_TRACE__
    vi.resetModules()
    await import('./resize-debug-trace')

    expect(window.__CUSTOM_VEHICLES_RESIZE_TRACE__).toEqual([
      expect.objectContaining({
        source: 'controller',
        event: 'pointerup-after-update'
      }),
      expect.objectContaining({
        source: 'session',
        event: 'commit-complete'
      })
    ])
  })
})
