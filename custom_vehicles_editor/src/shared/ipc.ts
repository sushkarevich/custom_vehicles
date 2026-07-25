import type { EditorHistoryCommand, EditorHistoryState } from './history-commands'

export const IPC_CHANNELS = {
  openDocument: 'document:open',
  openRecent: 'document:open-recent',
  recentDocuments: 'document:recent',
  chooseSavePath: 'document:choose-save-path',
  saveDocument: 'document:save',
  exportDocument: 'document:export',
  confirmDiscard: 'dialog:confirm-discard',
  setDirty: 'window:set-dirty',
  editorCommand: 'editor:command',
  historyState: 'editor:history-state'
} as const

export interface OpenedDocument {
  filePath: string
  content: string
}

export interface RecentDocument {
  filePath: string
  displayName: string
  lastOpenedAt: string
}

export interface SaveDocumentRequest {
  filePath: string
  content: string
}

export interface ChooseSavePathRequest {
  suggestedName: string
  currentPath?: string
}

export interface ExportDocumentRequest {
  suggestedName: string
  content: string
}

export interface SaveResult {
  filePath: string
}

export interface EditorApi {
  openDocument(): Promise<OpenedDocument | null>
  openRecent(filePath: string): Promise<OpenedDocument>
  getRecentDocuments(): Promise<RecentDocument[]>
  chooseSavePath(request: ChooseSavePathRequest): Promise<string | null>
  saveDocument(request: SaveDocumentRequest): Promise<SaveResult>
  exportDocument(request: ExportDocumentRequest): Promise<SaveResult | null>
  confirmDiscard(documentName: string): Promise<boolean>
  setDirty(dirty: boolean): void
  onHistoryCommand(listener: (command: EditorHistoryCommand) => void): () => void
  setHistoryState(state: EditorHistoryState): void
}
