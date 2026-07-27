import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EditorApi, ResourcePreviewApi } from '../../shared/ipc'
import {
  RESOURCE_PREVIEW_SETTINGS_VERSION,
  type ResolvedMaterialBatch,
  type ResolvedMaterialPreview,
  type ResourcePreviewEvent,
  type ResourcePreviewMode,
  type ResourcePreviewState
} from '../../shared/resource-preview'
import { createDefaultModel } from '../../shared/schema'
import { serializeEditorDocument } from '../../shared/yaml'
import { useDocumentStore } from './document-store'
import {
  disposeResourcePreviewSubscription,
  useResourcePreviewStore
} from './resource-preview-store'

declare global {
  interface Window {
    editorApi: EditorApi
  }
}

function deferred<T>(): {
  promise: Promise<T>
  resolve: (value: T) => void
} {
  let resolve: (value: T) => void = () => undefined
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

function previewState(
  revision: number,
  mode: ResourcePreviewMode = 'textures'
): ResourcePreviewState {
  return {
    version: RESOURCE_PREVIEW_SETTINGS_VERSION,
    revision,
    mode,
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
}

function resolvedMaterial(
  material: string,
  revision: number
): ResolvedMaterialPreview {
  return {
    material,
    revision,
    source: 'resource-pack',
    sourceName: 'Test Pack',
    modelPath: `assets/minecraft/models/block/${material.toLowerCase()}.json`,
    faces: {
      top: {
        assetToken: `rp_${material.toLowerCase()}`,
        logicalPath: `minecraft:block/${material.toLowerCase()}`,
        sourcePackId: 'pack-test',
        sourceName: 'Test Pack',
        rotation: 0
      }
    },
    diagnostics: []
  }
}

function resourceApiDouble(initial: ResourcePreviewState) {
  let current = initial
  let listener: ((event: ResourcePreviewEvent) => void) | null = null
  const update = (
    patch: Partial<ResourcePreviewState> = {}
  ): ResourcePreviewState => {
    current = {
      ...current,
      ...patch,
      revision: current.revision + 1
    }
    return current
  }
  const api = {
    getState: vi.fn(async () => current),
    addDirectory: vi.fn(async () => update()),
    addZip: vi.fn(async () => update()),
    setMode: vi.fn(async (mode: ResourcePreviewMode) => update({ mode })),
    setPackEnabled: vi.fn(async () => update()),
    movePack: vi.fn(async () => update()),
    removePack: vi.fn(async () => update()),
    rescanPack: vi.fn(async () => update()),
    revealPack: vi.fn(async () => undefined),
    discoverVanilla: vi.fn(async () => update()),
    selectVanillaJar: vi.fn(async () => update()),
    selectVanillaVersion: vi.fn(async () => update()),
    setVanillaEnabled: vi.fn(async (enabled: boolean) =>
      update({
        vanilla: {
          ...current.vanilla,
          enabled
        }
      })
    ),
    refreshVanilla: vi.fn(async () => update()),
    revealVanilla: vi.fn(async () => undefined),
    assignManualTexture: vi.fn(async (material: string) =>
      update({
        manualTextures: [
          {
            material,
            face: 'all',
            assetToken: 'manual_stone',
            originalName: 'stone.png',
            width: 16,
            height: 16
          }
        ]
      })
    ),
    clearManualTexture: vi.fn(async () =>
      update({ manualTextures: [] })
    ),
    resolveMaterials: vi.fn(
      async (materials: string[]): Promise<ResolvedMaterialBatch> => ({
        revision: current.revision,
        materials: materials.map((material) =>
          resolvedMaterial(material, current.revision)
        )
      })
    ),
    readAsset: vi.fn(async () => new Uint8Array([1, 2, 3])),
    onEvent: vi.fn((next: (event: ResourcePreviewEvent) => void) => {
      listener = next
      return () => {
        listener = null
      }
    }),
    emit(event: ResourcePreviewEvent): void {
      if (event.type === 'state') current = event.state
      listener?.(event)
    }
  } satisfies ResourcePreviewApi & {
    emit(event: ResourcePreviewEvent): void
  }
  return api
}

function installResourceApi(api?: ResourcePreviewApi): void {
  Object.defineProperty(window, 'editorApi', {
    configurable: true,
    value: api === undefined ? {} : { resourcePreview: api }
  })
}

function resetPreviewStore(): void {
  disposeResourcePreviewSubscription()
  useResourcePreviewStore.setState({
    preview: previewState(0, 'colors'),
    resolved: {},
    progress: {},
    initialized: false,
    busy: false,
    pendingOperations: 0,
    error: null
  })
}

describe('renderer resource preview store', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetPreviewStore()
    useDocumentStore.getState().reset(createDefaultModel())
  })

  afterEach(() => {
    disposeResourcePreviewSubscription()
  })

  it('игнорирует resolve result после смены revision', async () => {
    const api = resourceApiDouble(previewState(10))
    installResourceApi(api)
    await useResourcePreviewStore.getState().initialize()
    useResourcePreviewStore.setState({
      resolved: {
        OLD: resolvedMaterial('OLD', 10)
      }
    })

    const pending = deferred<ResolvedMaterialBatch>()
    api.resolveMaterials.mockReturnValueOnce(pending.promise)
    const resolving = useResourcePreviewStore
      .getState()
      .resolveMaterials(['STONE'])

    api.emit({
      type: 'state',
      state: previewState(11)
    })
    pending.resolve({
      revision: 10,
      materials: [resolvedMaterial('STONE', 10)]
    })
    await resolving

    expect(useResourcePreviewStore.getState().preview.revision).toBe(11)
    expect(useResourcePreviewStore.getState().resolved).toEqual({})
  })

  it('применяет только material batch текущей revision', async () => {
    const api = resourceApiDouble(previewState(4))
    installResourceApi(api)
    await useResourcePreviewStore.getState().initialize()

    await useResourcePreviewStore
      .getState()
      .resolveMaterials(['STONE', 'ACACIA_PLANKS', 'STONE'])

    expect(api.resolveMaterials).toHaveBeenCalledWith([
      'ACACIA_PLANKS',
      'STONE'
    ])
    expect(Object.keys(useResourcePreviewStore.getState().resolved)).toEqual([
      'ACACIA_PLANKS',
      'STONE'
    ])
  })

  it('не принимает regressive responses/events и сохраняет busy до завершения всех операций', async () => {
    const api = resourceApiDouble(previewState(1))
    installResourceApi(api)
    await useResourcePreviewStore.getState().initialize()
    const older = deferred<ResourcePreviewState>()
    const newer = deferred<ResourcePreviewState>()
    api.setMode.mockReturnValueOnce(older.promise)
    api.addDirectory.mockReturnValueOnce(newer.promise)

    const settingMode = useResourcePreviewStore
      .getState()
      .setMode('colors')
    const addingDirectory = useResourcePreviewStore
      .getState()
      .addDirectory()

    expect(useResourcePreviewStore.getState()).toMatchObject({
      busy: true,
      pendingOperations: 2
    })

    newer.resolve(previewState(3, 'colors'))
    await addingDirectory
    expect(useResourcePreviewStore.getState()).toMatchObject({
      busy: true,
      pendingOperations: 1,
      preview: { revision: 3, mode: 'colors' }
    })

    api.emit({
      type: 'state',
      state: previewState(2)
    })
    expect(useResourcePreviewStore.getState().preview).toMatchObject({
      revision: 3,
      mode: 'colors'
    })

    older.resolve(previewState(2))
    await settingMode
    expect(useResourcePreviewStore.getState()).toMatchObject({
      busy: false,
      pendingOperations: 0,
      preview: { revision: 3, mode: 'colors' }
    })
  })

  it('направляет preview actions в optional API, не меняя YAML и document history', async () => {
    const api = resourceApiDouble(previewState(2))
    installResourceApi(api)
    await useResourcePreviewStore.getState().initialize()
    const documentBefore = useDocumentStore.getState()
    const historyBefore = documentBefore.history
    const yamlBefore = serializeEditorDocument(historyBefore.present)
    const selectionBefore = {
      selectedPartIds: documentBefore.selectedPartIds,
      activePartId: documentBefore.activePartId
    }

    const actions = useResourcePreviewStore.getState()
    await actions.setMode('colors')
    await actions.addDirectory()
    await actions.addZip()
    await actions.setPackEnabled('pack-a', false)
    await actions.movePack('pack-a', 'higher')
    await actions.rescanPack('pack-a')
    await actions.revealPack('pack-a')
    await actions.discoverVanilla()
    await actions.selectVanillaJar()
    await actions.selectVanillaVersion('mc-detected')
    await actions.setVanillaEnabled(false)
    await actions.refreshVanilla()
    await actions.revealVanilla()
    await actions.assignManualTexture('STONE', 'all')
    await actions.clearManualTexture('STONE', 'all')
    await actions.removePack('pack-a')

    expect(api.setMode).toHaveBeenCalledWith('colors')
    expect(api.addDirectory).toHaveBeenCalledOnce()
    expect(api.addZip).toHaveBeenCalledOnce()
    expect(api.setPackEnabled).toHaveBeenCalledWith('pack-a', false)
    expect(api.movePack).toHaveBeenCalledWith('pack-a', 'higher')
    expect(api.rescanPack).toHaveBeenCalledWith('pack-a')
    expect(api.revealPack).toHaveBeenCalledWith('pack-a')
    expect(api.discoverVanilla).toHaveBeenCalledOnce()
    expect(api.selectVanillaJar).toHaveBeenCalledOnce()
    expect(api.selectVanillaVersion).toHaveBeenCalledWith('mc-detected')
    expect(api.setVanillaEnabled).toHaveBeenCalledWith(false)
    expect(api.refreshVanilla).toHaveBeenCalledOnce()
    expect(api.revealVanilla).toHaveBeenCalledOnce()
    expect(api.assignManualTexture).toHaveBeenCalledWith('STONE', 'all')
    expect(api.clearManualTexture).toHaveBeenCalledWith('STONE', 'all')
    expect(api.removePack).toHaveBeenCalledWith('pack-a')

    const documentAfter = useDocumentStore.getState()
    expect(documentAfter.history).toBe(historyBefore)
    expect(documentAfter.history.past).toHaveLength(0)
    expect(documentAfter.dirty).toBe(false)
    expect({
      selectedPartIds: documentAfter.selectedPartIds,
      activePartId: documentAfter.activePartId
    }).toEqual(selectionBefore)
    expect(serializeEditorDocument(documentAfter.history.present)).toBe(
      yamlBefore
    )
  })

  it('без optional API безопасно инициализирует fallback и оставляет actions no-op', async () => {
    installResourceApi()

    await useResourcePreviewStore.getState().initialize()
    await useResourcePreviewStore.getState().setMode('textures')
    await useResourcePreviewStore
      .getState()
      .assignManualTexture('STONE', 'all')

    const state = useResourcePreviewStore.getState()
    expect(state.initialized).toBe(true)
    expect(state.preview).toEqual(previewState(0, 'colors'))
    expect(state.busy).toBe(false)
    expect(state.error).toBeNull()
    expect(useDocumentStore.getState().history.past).toHaveLength(0)
  })
})
