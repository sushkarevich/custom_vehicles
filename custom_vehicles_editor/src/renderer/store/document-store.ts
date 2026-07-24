import { create } from 'zustand'
import {
  cloneDocument,
  createDefaultModel,
  createDefaultVariant,
  isModelDefinition,
  type DocumentKind,
  type EditorDocument
} from '../../shared/schema'
import {
  beginHistoryGroup,
  commitHistory,
  createHistory,
  endHistoryGroup,
  redoHistory,
  undoHistory,
  type HistoryState
} from './history'

function signature(document: EditorDocument): string {
  return JSON.stringify(document)
}

interface DocumentStore {
  history: HistoryState<EditorDocument>
  kind: DocumentKind
  filePath: string | null
  selectedPartId: string | null
  savedSignature: string
  dirty: boolean
  reset(document: EditorDocument, filePath?: string | null): void
  newModel(): void
  newVariant(): void
  update(updater: (document: EditorDocument) => EditorDocument): void
  beginTransaction(): void
  endTransaction(): void
  undo(): void
  redo(): void
  selectPart(partId: string | null): void
  markSaved(filePath: string): void
}

function initialState(): Pick<
  DocumentStore,
  'history' | 'kind' | 'filePath' | 'selectedPartId' | 'savedSignature' | 'dirty'
> {
  const document = createDefaultModel()
  return {
    history: createHistory(document),
    kind: 'model',
    filePath: null,
    selectedPartId: document.parts[0]?.id ?? null,
    savedSignature: signature(document),
    dirty: false
  }
}

export const useDocumentStore = create<DocumentStore>((set) => ({
  ...initialState(),
  reset(document, filePath = null) {
    const copied = cloneDocument(document)
    set({
      history: createHistory(copied),
      kind: isModelDefinition(copied) ? 'model' : 'variant',
      filePath,
      selectedPartId: isModelDefinition(copied) ? (copied.parts[0]?.id ?? null) : null,
      savedSignature: signature(copied),
      dirty: false
    })
  },
  newModel() {
    const document = createDefaultModel()
    set({
      history: createHistory(document),
      kind: 'model',
      filePath: null,
      selectedPartId: document.parts[0]?.id ?? null,
      savedSignature: signature(document),
      dirty: false
    })
  },
  newVariant() {
    const document = createDefaultVariant()
    set({
      history: createHistory(document),
      kind: 'variant',
      filePath: null,
      selectedPartId: null,
      savedSignature: signature(document),
      dirty: false
    })
  },
  update(updater) {
    set((state) => {
      const history = commitHistory(state.history, updater(cloneDocument(state.history.present)))
      return {
        history,
        kind: isModelDefinition(history.present) ? 'model' : 'variant',
        dirty: signature(history.present) !== state.savedSignature
      }
    })
  },
  beginTransaction() {
    set((state) => ({ history: beginHistoryGroup(state.history) }))
  },
  endTransaction() {
    set((state) => {
      const history = endHistoryGroup(state.history)
      return {
        history,
        dirty: signature(history.present) !== state.savedSignature
      }
    })
  },
  undo() {
    set((state) => {
      const history = undoHistory(state.history)
      return {
        history,
        kind: isModelDefinition(history.present) ? 'model' : 'variant',
        dirty: signature(history.present) !== state.savedSignature
      }
    })
  },
  redo() {
    set((state) => {
      const history = redoHistory(state.history)
      return {
        history,
        kind: isModelDefinition(history.present) ? 'model' : 'variant',
        dirty: signature(history.present) !== state.savedSignature
      }
    })
  },
  selectPart(partId) {
    set({ selectedPartId: partId })
  },
  markSaved(filePath) {
    set((state) => ({
      filePath,
      savedSignature: signature(state.history.present),
      dirty: false
    }))
  }
}))

export function getCurrentDocument(): EditorDocument {
  return useDocumentStore.getState().history.present
}
