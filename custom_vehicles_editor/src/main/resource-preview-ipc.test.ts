// @vitest-environment node

import type { BrowserWindow } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { IPC_CHANNELS } from '../shared/ipc'
import type {
  ResourcePreviewEvent,
  ResourcePreviewState,
  ResourceTextureFace
} from '../shared/resource-preview'
import type {
  PngDecoder,
  ResourcePreviewManager
} from './resource-preview-manager'
import { registerIpcHandlers } from './ipc'

const electron = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => Promise<unknown>>(),
  removeHandler: vi.fn(),
  showOpenDialog: vi.fn(),
  showSaveDialog: vi.fn(),
  showMessageBox: vi.fn(),
  showItemInFolder: vi.fn(),
  createFromBuffer: vi.fn(
    (content: Buffer, options: { scaleFactor: number }) => {
      void content
      void options
      return {
        isEmpty: () => false,
        getSize: () => ({ width: 16, height: 16 }),
        toPNG: () => Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
      }
    }
  )
}))

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/customvehicles-ipc-test' },
  dialog: {
    showOpenDialog: electron.showOpenDialog,
    showSaveDialog: electron.showSaveDialog,
    showMessageBox: electron.showMessageBox
  },
  ipcMain: {
    handle: (
      channel: string,
      handler: (...args: unknown[]) => Promise<unknown>
    ) => electron.handlers.set(channel, handler),
    removeHandler: electron.removeHandler
  },
  nativeImage: {
    createFromBuffer: electron.createFromBuffer
  },
  shell: { showItemInFolder: electron.showItemInFolder }
}))

const state: ResourcePreviewState = {
  version: 1,
  revision: 0,
  mode: 'textures',
  packs: [],
  vanilla: {
    enabled: true,
    sourceKind: null,
    sourcePath: null,
    version: null,
    missing: false,
    scanning: false,
    ready: false,
    cacheReused: false,
    detectedVersions: [],
    diagnostics: []
  },
  manualTextures: []
}

function managerDouble() {
  let listener: ((event: ResourcePreviewEvent) => void) | null = null
  return {
    getState: vi.fn(async () => state),
    addPack: vi.fn(async () => state),
    setMode: vi.fn(async () => state),
    setPackEnabled: vi.fn(async () => state),
    movePack: vi.fn(async () => state),
    removePack: vi.fn(async () => state),
    rescanPack: vi.fn(async () => state),
    packSourcePath: vi.fn(() => '/tmp/resource pack.zip'),
    discoverVanilla: vi.fn(async () => state),
    selectDetectedVanilla: vi.fn(async () => state),
    selectVanillaJar: vi.fn(async () => state),
    setVanillaEnabled: vi.fn(async () => state),
    rescanVanilla: vi.fn(async () => state),
    vanillaSourcePath: vi.fn(() => '/tmp/1.21.1.jar'),
    importManualTexture: vi.fn(
      async (
        material: string,
        face: ResourceTextureFace,
        sourcePath: string,
        decodePng: PngDecoder
      ) => {
        void material
        void face
        void sourcePath
        void decodePng
        return state
      }
    ),
    clearManualTexture: vi.fn(async () => state),
    resolveMaterials: vi.fn(async () => ({ revision: 0, materials: [] })),
    readAsset: vi.fn(async () => new Uint8Array([1, 2, 3])),
    subscribe: vi.fn((next: (event: ResourcePreviewEvent) => void) => {
      listener = next
      return () => {
        listener = null
      }
    }),
    emit(event: ResourcePreviewEvent) {
      listener?.(event)
    },
    dispose: vi.fn()
  }
}

function invokeHandler(channel: string, ...args: unknown[]) {
  const handler = electron.handlers.get(channel)
  if (handler === undefined) throw new Error(`missing handler ${channel}`)
  return handler(...args)
}

describe('narrow resource-preview IPC', () => {
  beforeEach(() => {
    electron.handlers.clear()
    vi.clearAllMocks()
    electron.createFromBuffer.mockReturnValue({
      isEmpty: () => false,
      getSize: () => ({ width: 16, height: 16 }),
      toPNG: () => Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
    })
  })

  it('accepts only the live renderer and never exposes an arbitrary path operation', async () => {
    const manager = managerDouble()
    const contents = { send: vi.fn(), isDestroyed: () => false }
    const window = {
      isDestroyed: () => false,
      webContents: contents
    } as unknown as BrowserWindow
    const dispose = registerIpcHandlers(
      () => window,
      manager as unknown as ResourcePreviewManager
    )
    await Promise.resolve()

    await expect(
      invokeHandler(
        IPC_CHANNELS.resourcePreviewState,
        { sender: contents }
      )
    ).resolves.toEqual(state)
    await expect(
      invokeHandler(
        IPC_CHANNELS.resourcePreviewState,
        { sender: {} }
      )
    ).rejects.toThrow('Недопустимый отправитель')

    expect(
      Object.keys(IPC_CHANNELS)
        .filter((key) => key.startsWith('resourcePreview'))
        .some((key) => /arbitraryPath|readFile/i.test(key))
    ).toBe(false)
    dispose()
    await Promise.resolve()
    expect(manager.dispose).toHaveBeenCalledOnce()
  })

  it('grants pack/manual paths only through native dialogs and sends events to a live window', async () => {
    const manager = managerDouble()
    const contents = { send: vi.fn(), isDestroyed: () => false }
    let current = {
      isDestroyed: () => false,
      webContents: contents
    } as unknown as BrowserWindow | null
    const dispose = registerIpcHandlers(
      () => current,
      manager as unknown as ResourcePreviewManager
    )
    await Promise.resolve()
    electron.showOpenDialog
      .mockResolvedValueOnce({
        canceled: false,
        filePaths: ['/tmp/пак с пробелами']
      })
      .mockResolvedValueOnce({
        canceled: false,
        filePaths: ['/tmp/ручная текстура.png']
      })
    const event = { sender: contents }

    await invokeHandler(IPC_CHANNELS.resourcePreviewAddDirectory, event)
    expect(manager.addPack).toHaveBeenCalledWith(
      'directory',
      '/tmp/пак с пробелами'
    )

    await invokeHandler(
      IPC_CHANNELS.resourcePreviewAssignManual,
      event,
      'STONE',
      'all'
    )
    expect(manager.importManualTexture).toHaveBeenCalledWith(
      'STONE',
      'all',
      '/tmp/ручная текстура.png',
      expect.any(Function)
    )

    manager.emit({ type: 'state', state })
    expect(contents.send).toHaveBeenCalledWith(
      IPC_CHANNELS.resourcePreviewEvent,
      { type: 'state', state }
    )
    current = null
    expect(() => manager.emit({ type: 'state', state })).not.toThrow()
    expect(contents.send).toHaveBeenCalledOnce()
    dispose()
  })

  it('decodes a transparent PNG through the IPC-provided nativeImage adapter', async () => {
    const manager = managerDouble()
    const contents = { send: vi.fn(), isDestroyed: () => false }
    const window = {
      isDestroyed: () => false,
      webContents: contents
    } as unknown as BrowserWindow
    const dispose = registerIpcHandlers(
      () => window,
      manager as unknown as ResourcePreviewManager
    )
    await Promise.resolve()

    // Valid 1×1 grayscale+alpha PNG whose decoded alpha byte is zero.
    const transparentPng = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=',
      'base64'
    )
    const selectedPng = Buffer.concat([
      transparentPng,
      Buffer.from('source-metadata')
    ])
    electron.createFromBuffer.mockReturnValue({
      isEmpty: () => false,
      getSize: () => ({ width: 1, height: 1 }),
      toPNG: () => transparentPng
    })
    let decoded:
      | { png: Buffer; width: number; height: number }
      | undefined
    manager.importManualTexture.mockImplementation(
      async (_material, _face, _sourcePath, decodePng) => {
        decoded = decodePng(selectedPng)
        return state
      }
    )
    electron.showOpenDialog.mockResolvedValue({
      canceled: false,
      filePaths: ['/tmp/прозрачная текстура.png']
    })

    await invokeHandler(
      IPC_CHANNELS.resourcePreviewAssignManual,
      { sender: contents },
      'STONE',
      'all'
    )

    expect(electron.createFromBuffer).toHaveBeenCalledOnce()
    expect(electron.createFromBuffer).toHaveBeenCalledWith(selectedPng, {
      scaleFactor: 1
    })
    expect(decoded).toEqual({
      png: transparentPng,
      width: 1,
      height: 1
    })
    expect(decoded?.png).not.toEqual(selectedPng)
    dispose()
  })

  it('routes vanilla discovery and manual JAR selection through narrow native-dialog IPC', async () => {
    const manager = managerDouble()
    const contents = { send: vi.fn(), isDestroyed: () => false }
    const window = {
      isDestroyed: () => false,
      webContents: contents
    } as unknown as BrowserWindow
    const dispose = registerIpcHandlers(
      () => window,
      manager as unknown as ResourcePreviewManager
    )
    await Promise.resolve()
    const event = { sender: contents }
    electron.showOpenDialog.mockResolvedValue({
      canceled: false,
      filePaths: ['/tmp/Лаунчер с пробелами/1.21.1.jar']
    })

    await invokeHandler(
      IPC_CHANNELS.resourcePreviewDiscoverVanilla,
      event
    )
    await invokeHandler(
      IPC_CHANNELS.resourcePreviewSelectVanillaJar,
      event
    )
    await invokeHandler(
      IPC_CHANNELS.resourcePreviewSelectVanillaVersion,
      event,
      'mc_candidate'
    )
    await invokeHandler(
      IPC_CHANNELS.resourcePreviewSetVanillaEnabled,
      event,
      false
    )
    await invokeHandler(
      IPC_CHANNELS.resourcePreviewRefreshVanilla,
      event
    )
    await invokeHandler(
      IPC_CHANNELS.resourcePreviewRevealVanilla,
      event
    )

    expect(manager.discoverVanilla).toHaveBeenCalledOnce()
    expect(manager.selectVanillaJar).toHaveBeenCalledWith(
      '/tmp/Лаунчер с пробелами/1.21.1.jar'
    )
    expect(manager.selectDetectedVanilla).toHaveBeenCalledWith('mc_candidate')
    expect(manager.setVanillaEnabled).toHaveBeenCalledWith(false)
    expect(manager.rescanVanilla).toHaveBeenCalledOnce()
    expect(electron.showItemInFolder).toHaveBeenCalledWith('/tmp/1.21.1.jar')
    dispose()
  })
})
