import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import {
  isEditorHistoryCommand,
  type EditorHistoryCommand,
  type EditorHistoryState
} from '../shared/history-commands'
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
    ipcRenderer.send(IPC_CHANNELS.historyState, state)
})

contextBridge.exposeInMainWorld('editorApi', api)
