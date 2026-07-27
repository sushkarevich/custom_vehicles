import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import {
  isEditorHistoryCommand,
  type EditorHistoryCommand,
  type EditorHistoryState
} from '../shared/history-commands'
import {
  isResourcePreviewEvent,
  type PackMoveDirection,
  type ResourcePreviewEvent,
  type ResourcePreviewMode,
  type ResourceTextureFace
} from '../shared/resource-preview'
import {
  IPC_CHANNELS,
  type ChooseSavePathRequest,
  type EditorApi,
  type ExportDocumentRequest,
  type SaveDocumentRequest
} from '../shared/ipc'

const api: EditorApi = Object.freeze({
  openDocument: () => ipcRenderer.invoke(IPC_CHANNELS.openDocument),
  openRecent: (filePath: string) => ipcRenderer.invoke(IPC_CHANNELS.openRecent, filePath),
  getRecentDocuments: () => ipcRenderer.invoke(IPC_CHANNELS.recentDocuments),
  chooseSavePath: (request: ChooseSavePathRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.chooseSavePath, request),
  saveDocument: (request: SaveDocumentRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.saveDocument, request),
  exportDocument: (request: ExportDocumentRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.exportDocument, request),
  confirmDiscard: (documentName: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.confirmDiscard, documentName),
  setDirty: (dirty: boolean) => ipcRenderer.send(IPC_CHANNELS.setDirty, dirty),
  onHistoryCommand: (listener: (command: EditorHistoryCommand) => void) => {
    const handleCommand = (_event: IpcRendererEvent, value: unknown): void => {
      if (isEditorHistoryCommand(value)) listener(value)
    }
    ipcRenderer.on(IPC_CHANNELS.editorCommand, handleCommand)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.editorCommand, handleCommand)
  },
  setHistoryState: (state: EditorHistoryState) =>
    ipcRenderer.send(IPC_CHANNELS.historyState, state),
  resourcePreview: Object.freeze({
    getState: () => ipcRenderer.invoke(IPC_CHANNELS.resourcePreviewState),
    addDirectory: () => ipcRenderer.invoke(IPC_CHANNELS.resourcePreviewAddDirectory),
    addZip: () => ipcRenderer.invoke(IPC_CHANNELS.resourcePreviewAddZip),
    setMode: (mode: ResourcePreviewMode) =>
      ipcRenderer.invoke(IPC_CHANNELS.resourcePreviewSetMode, mode),
    setPackEnabled: (packId: string, enabled: boolean) =>
      ipcRenderer.invoke(
        IPC_CHANNELS.resourcePreviewSetPackEnabled,
        packId,
        enabled
      ),
    movePack: (packId: string, direction: PackMoveDirection) =>
      ipcRenderer.invoke(IPC_CHANNELS.resourcePreviewMovePack, packId, direction),
    removePack: (packId: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.resourcePreviewRemovePack, packId),
    rescanPack: (packId: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.resourcePreviewRescanPack, packId),
    revealPack: (packId: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.resourcePreviewRevealPack, packId),
    discoverVanilla: () =>
      ipcRenderer.invoke(IPC_CHANNELS.resourcePreviewDiscoverVanilla),
    selectVanillaJar: () =>
      ipcRenderer.invoke(IPC_CHANNELS.resourcePreviewSelectVanillaJar),
    selectVanillaVersion: (candidateId: string) =>
      ipcRenderer.invoke(
        IPC_CHANNELS.resourcePreviewSelectVanillaVersion,
        candidateId
      ),
    setVanillaEnabled: (enabled: boolean) =>
      ipcRenderer.invoke(
        IPC_CHANNELS.resourcePreviewSetVanillaEnabled,
        enabled
      ),
    refreshVanilla: () =>
      ipcRenderer.invoke(IPC_CHANNELS.resourcePreviewRefreshVanilla),
    revealVanilla: () =>
      ipcRenderer.invoke(IPC_CHANNELS.resourcePreviewRevealVanilla),
    assignManualTexture: (
      material: string,
      face: ResourceTextureFace = 'all'
    ) =>
      ipcRenderer.invoke(
        IPC_CHANNELS.resourcePreviewAssignManual,
        material,
        face
      ),
    clearManualTexture: (
      material: string,
      face: ResourceTextureFace = 'all'
    ) =>
      ipcRenderer.invoke(
        IPC_CHANNELS.resourcePreviewClearManual,
        material,
        face
      ),
    resolveMaterials: (materials: string[]) =>
      ipcRenderer.invoke(IPC_CHANNELS.resourcePreviewResolveMaterials, materials),
    readAsset: (assetToken: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.resourcePreviewReadAsset, assetToken),
    onEvent: (listener: (event: ResourcePreviewEvent) => void) => {
      const handleEvent = (_event: IpcRendererEvent, value: unknown): void => {
        if (isResourcePreviewEvent(value)) listener(value)
      }
      ipcRenderer.on(IPC_CHANNELS.resourcePreviewEvent, handleEvent)
      return () =>
        ipcRenderer.removeListener(IPC_CHANNELS.resourcePreviewEvent, handleEvent)
    }
  })
})

contextBridge.exposeInMainWorld('editorApi', api)
