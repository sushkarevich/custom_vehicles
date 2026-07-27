import type { EditorHistoryCommand, EditorHistoryState } from './history-commands'
import type {
  PackMoveDirection,
  ResolvedMaterialBatch,
  ResourcePreviewEvent,
  ResourcePreviewMode,
  ResourcePreviewState,
  ResourceTextureFace
} from './resource-preview'

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
  historyState: 'editor:history-state',
  resourcePreviewState: 'resource-preview:state',
  resourcePreviewAddDirectory: 'resource-preview:add-directory',
  resourcePreviewAddZip: 'resource-preview:add-zip',
  resourcePreviewSetMode: 'resource-preview:set-mode',
  resourcePreviewSetPackEnabled: 'resource-preview:set-pack-enabled',
  resourcePreviewMovePack: 'resource-preview:move-pack',
  resourcePreviewRemovePack: 'resource-preview:remove-pack',
  resourcePreviewRescanPack: 'resource-preview:rescan-pack',
  resourcePreviewRevealPack: 'resource-preview:reveal-pack',
  resourcePreviewDiscoverVanilla: 'resource-preview:discover-vanilla',
  resourcePreviewSelectVanillaJar: 'resource-preview:select-vanilla-jar',
  resourcePreviewSelectVanillaVersion: 'resource-preview:select-vanilla-version',
  resourcePreviewSetVanillaEnabled: 'resource-preview:set-vanilla-enabled',
  resourcePreviewRefreshVanilla: 'resource-preview:refresh-vanilla',
  resourcePreviewRevealVanilla: 'resource-preview:reveal-vanilla',
  resourcePreviewAssignManual: 'resource-preview:assign-manual',
  resourcePreviewClearManual: 'resource-preview:clear-manual',
  resourcePreviewResolveMaterials: 'resource-preview:resolve-materials',
  resourcePreviewReadAsset: 'resource-preview:read-asset',
  resourcePreviewEvent: 'resource-preview:event'
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

export interface ResourcePreviewApi {
  getState(): Promise<ResourcePreviewState>
  addDirectory(): Promise<ResourcePreviewState>
  addZip(): Promise<ResourcePreviewState>
  setMode(mode: ResourcePreviewMode): Promise<ResourcePreviewState>
  setPackEnabled(packId: string, enabled: boolean): Promise<ResourcePreviewState>
  movePack(packId: string, direction: PackMoveDirection): Promise<ResourcePreviewState>
  removePack(packId: string): Promise<ResourcePreviewState>
  rescanPack(packId: string): Promise<ResourcePreviewState>
  revealPack(packId: string): Promise<void>
  discoverVanilla(): Promise<ResourcePreviewState>
  selectVanillaJar(): Promise<ResourcePreviewState>
  selectVanillaVersion(candidateId: string): Promise<ResourcePreviewState>
  setVanillaEnabled(enabled: boolean): Promise<ResourcePreviewState>
  refreshVanilla(): Promise<ResourcePreviewState>
  revealVanilla(): Promise<void>
  assignManualTexture(
    material: string,
    face?: ResourceTextureFace
  ): Promise<ResourcePreviewState>
  clearManualTexture(
    material: string,
    face?: ResourceTextureFace
  ): Promise<ResourcePreviewState>
  resolveMaterials(materials: string[]): Promise<ResolvedMaterialBatch>
  readAsset(assetToken: string): Promise<Uint8Array>
  onEvent(listener: (event: ResourcePreviewEvent) => void): () => void
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
  /**
   * Kept optional so older renderer test doubles remain source-compatible.
   * Production preload always exposes this narrow resource-preview API.
   */
  resourcePreview?: ResourcePreviewApi
}
