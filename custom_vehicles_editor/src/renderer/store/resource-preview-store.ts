import { create } from 'zustand'
import {
  RESOURCE_PREVIEW_SETTINGS_VERSION,
  type PackMoveDirection,
  type ResolvedMaterialPreview,
  type ResourcePreviewMode,
  type ResourcePreviewState,
  type ResourceScanProgress,
  type ResourceTextureFace
} from '../../shared/resource-preview'

const FALLBACK_STATE: ResourcePreviewState = {
  version: RESOURCE_PREVIEW_SETTINGS_VERSION,
  revision: 0,
  mode: 'colors',
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

interface ResourcePreviewStore {
  preview: ResourcePreviewState
  resolved: Readonly<Record<string, ResolvedMaterialPreview>>
  progress: Readonly<Record<string, ResourceScanProgress>>
  initialized: boolean
  busy: boolean
  pendingOperations: number
  error: string | null
  initialize(): Promise<void>
  resolveMaterials(materials: Iterable<string>): Promise<void>
  setMode(mode: ResourcePreviewMode): Promise<void>
  addDirectory(): Promise<void>
  addZip(): Promise<void>
  setPackEnabled(packId: string, enabled: boolean): Promise<void>
  movePack(packId: string, direction: PackMoveDirection): Promise<void>
  removePack(packId: string): Promise<void>
  rescanPack(packId: string): Promise<void>
  revealPack(packId: string): Promise<void>
  discoverVanilla(): Promise<void>
  selectVanillaJar(): Promise<void>
  selectVanillaVersion(candidateId: string): Promise<void>
  setVanillaEnabled(enabled: boolean): Promise<void>
  refreshVanilla(): Promise<void>
  revealVanilla(): Promise<void>
  assignManualTexture(
    material: string,
    face?: ResourceTextureFace
  ): Promise<void>
  clearManualTexture(
    material: string,
    face?: ResourceTextureFace
  ): Promise<void>
}

let initialization: Promise<void> | null = null
let unsubscribe: (() => void) | null = null

function messageFromError(caught: unknown): string {
  return caught instanceof Error
    ? caught.message
    : 'Не удалось обновить настройки предпросмотра'
}

function applyPreviewState(
  current: Pick<ResourcePreviewStore, 'preview' | 'resolved'>,
  preview: ResourcePreviewState
): Pick<ResourcePreviewStore, 'preview' | 'resolved'> {
  if (preview.revision < current.preview.revision) return current
  return {
    preview,
    resolved:
      current.preview.revision === preview.revision ? current.resolved : {}
  }
}

export const useResourcePreviewStore = create<ResourcePreviewStore>((set, get) => {
  const beginOperation = (): void => {
    set((current) => ({
      pendingOperations: current.pendingOperations + 1,
      busy: true,
      error: null
    }))
  }
  const finishOperation = (): void => {
    set((current) => {
      const pendingOperations = Math.max(0, current.pendingOperations - 1)
      return {
        pendingOperations,
        busy: pendingOperations > 0
      }
    })
  }
  const mutate = async (
    action: () => Promise<ResourcePreviewState>
  ): Promise<void> => {
    beginOperation()
    try {
      const preview = await action()
      set((current) => applyPreviewState(current, preview))
    } catch (caught) {
      set({ error: messageFromError(caught) })
    } finally {
      finishOperation()
    }
  }

  return {
    preview: FALLBACK_STATE,
    resolved: {},
    progress: {},
    initialized: false,
    busy: false,
    pendingOperations: 0,
    error: null,
    async initialize() {
      if (get().initialized) return
      if (initialization !== null) return initialization
      beginOperation()
      initialization = (async () => {
        const api = window.editorApi.resourcePreview
        if (api === undefined) {
          set((current) => ({
            ...applyPreviewState(current, FALLBACK_STATE),
            initialized: true
          }))
          return
        }
        try {
          const preview = await api.getState()
          unsubscribe?.()
          unsubscribe = api.onEvent((event) => {
            if (event.type === 'state') {
              set((current) => applyPreviewState(current, event.state))
              return
            }
            set((current) => ({
              progress: {
                ...current.progress,
                [event.progress.packId]: event.progress
              }
            }))
          })
          set((current) => ({
            ...applyPreviewState(current, preview),
            initialized: true
          }))
        } catch (caught) {
          set({
            initialized: true,
            error: messageFromError(caught)
          })
        }
      })().finally(() => {
        finishOperation()
        initialization = null
      })
      return initialization
    },
    async resolveMaterials(materials) {
      const api = window.editorApi.resourcePreview
      if (api === undefined || get().preview.mode !== 'textures') return
      const requested = [...new Set(materials)].sort()
      if (requested.length === 0) return
      const requestedRevision = get().preview.revision
      try {
        const batch = await api.resolveMaterials(requested)
        if (
          batch.revision !== requestedRevision ||
          get().preview.revision !== requestedRevision
        ) {
          return
        }
        set((current) => {
          if (current.preview.revision !== batch.revision) return current
          const resolved = { ...current.resolved }
          batch.materials.forEach((material) => {
            resolved[material.material] = material
          })
          return { resolved, error: null }
        })
      } catch (caught) {
        set({ error: messageFromError(caught) })
      }
    },
    async setMode(mode) {
      const api = window.editorApi.resourcePreview
      if (api !== undefined) await mutate(() => api.setMode(mode))
    },
    async addDirectory() {
      const api = window.editorApi.resourcePreview
      if (api !== undefined) await mutate(() => api.addDirectory())
    },
    async addZip() {
      const api = window.editorApi.resourcePreview
      if (api !== undefined) await mutate(() => api.addZip())
    },
    async setPackEnabled(packId, enabled) {
      const api = window.editorApi.resourcePreview
      if (api !== undefined) {
        await mutate(() => api.setPackEnabled(packId, enabled))
      }
    },
    async movePack(packId, direction) {
      const api = window.editorApi.resourcePreview
      if (api !== undefined) await mutate(() => api.movePack(packId, direction))
    },
    async removePack(packId) {
      const api = window.editorApi.resourcePreview
      if (api !== undefined) await mutate(() => api.removePack(packId))
    },
    async rescanPack(packId) {
      const api = window.editorApi.resourcePreview
      if (api !== undefined) await mutate(() => api.rescanPack(packId))
    },
    async revealPack(packId) {
      const api = window.editorApi.resourcePreview
      if (api === undefined) return
      beginOperation()
      try {
        await api.revealPack(packId)
      } catch (caught) {
        set({ error: messageFromError(caught) })
      } finally {
        finishOperation()
      }
    },
    async discoverVanilla() {
      const api = window.editorApi.resourcePreview
      if (api !== undefined) await mutate(() => api.discoverVanilla())
    },
    async selectVanillaJar() {
      const api = window.editorApi.resourcePreview
      if (api !== undefined) await mutate(() => api.selectVanillaJar())
    },
    async selectVanillaVersion(candidateId) {
      const api = window.editorApi.resourcePreview
      if (api !== undefined) {
        await mutate(() => api.selectVanillaVersion(candidateId))
      }
    },
    async setVanillaEnabled(enabled) {
      const api = window.editorApi.resourcePreview
      if (api !== undefined) {
        await mutate(() => api.setVanillaEnabled(enabled))
      }
    },
    async refreshVanilla() {
      const api = window.editorApi.resourcePreview
      if (api !== undefined) await mutate(() => api.refreshVanilla())
    },
    async revealVanilla() {
      const api = window.editorApi.resourcePreview
      if (api === undefined) return
      beginOperation()
      try {
        await api.revealVanilla()
      } catch (caught) {
        set({ error: messageFromError(caught) })
      } finally {
        finishOperation()
      }
    },
    async assignManualTexture(material, face = 'all') {
      const api = window.editorApi.resourcePreview
      if (api !== undefined) {
        await mutate(() => api.assignManualTexture(material, face))
      }
    },
    async clearManualTexture(material, face = 'all') {
      const api = window.editorApi.resourcePreview
      if (api !== undefined) {
        await mutate(() => api.clearManualTexture(material, face))
      }
    }
  }
})

export function disposeResourcePreviewSubscription(): void {
  unsubscribe?.()
  unsubscribe = null
  initialization = null
}
