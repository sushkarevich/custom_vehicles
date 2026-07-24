import { contextBridge, ipcRenderer } from 'electron'
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
  setDirty: (dirty: boolean) => ipcRenderer.send(IPC_CHANNELS.setDirty, dirty)
})

contextBridge.exposeInMainWorld('editorApi', api)
