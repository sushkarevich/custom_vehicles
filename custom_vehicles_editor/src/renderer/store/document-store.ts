import { create } from 'zustand'
import {
  cloneDocument,
  createDefaultModel,
  createDefaultVariant,
  isModelDefinition,
  type DocumentKind,
  type EditorDocument,
  type ModelDefinition
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
import {
  executeModelSelectionCommand,
  type ModelSelectionCommand
} from './model-commands'
import {
  createPartSelection,
  normalizePartSelection,
  reducePartSelectionIntent,
  selectionFromIds,
  type PartSelection
} from './selection'

const HISTORY_LIMIT = 100

function signature(document: EditorDocument): string {
  return JSON.stringify(document)
}

interface SelectionHistoryState {
  /**
   * Selection recorded immediately after the current document history action.
   * Ordinary selection gestures intentionally do not overwrite this context.
   */
  present: PartSelection
  past: PartSelection[]
  future: PartSelection[]
  group: {
    base: PartSelection
    previousPresent: PartSelection
    future: PartSelection[]
  } | null
}

export interface DocumentEditResult {
  document: EditorDocument
  selection?: PartSelection
  editorNotice?: string | null
}

interface DocumentStore {
  history: HistoryState<EditorDocument>
  kind: DocumentKind
  filePath: string | null
  selectedPartIds: string[]
  activePartId: string | null
  selectionHistory: SelectionHistoryState
  documentEpoch: number
  savedSignature: string
  dirty: boolean
  editorNotice: string | null
  reset(document: EditorDocument, filePath?: string | null): void
  newModel(): void
  newVariant(): void
  update(updater: (document: EditorDocument) => EditorDocument): void
  applyEdit(
    edit: (
      document: EditorDocument,
      selection: PartSelection
    ) => DocumentEditResult
  ): void
  executeModelCommand(command: ModelSelectionCommand): void
  beginTransaction(): void
  endTransaction(): void
  undo(): void
  redo(): void
  selectPart(partId: string | null, additive?: boolean): void
  setSelection(partIds: Iterable<string>, activePartId?: string | null): void
  clearSelection(): void
  setEditorNotice(message: string | null): void
  markSaved(filePath: string): void
}

function modelFromDocument(document: EditorDocument): ModelDefinition | null {
  return isModelDefinition(document) ? document : null
}

function copySelection(selection: PartSelection): PartSelection {
  return {
    selectedPartIds: [...selection.selectedPartIds],
    activePartId: selection.activePartId
  }
}

function currentSelection(
  state: Pick<DocumentStore, 'selectedPartIds' | 'activePartId'>
): PartSelection {
  return {
    selectedPartIds: [...state.selectedPartIds],
    activePartId: state.activePartId
  }
}

function selectionState(
  selection: PartSelection
): Pick<DocumentStore, 'selectedPartIds' | 'activePartId'> {
  return {
    selectedPartIds: [...selection.selectedPartIds],
    activePartId: selection.activePartId
  }
}

function createSelectionHistory(selection: PartSelection): SelectionHistoryState {
  return {
    present: copySelection(selection),
    past: [],
    future: [],
    group: null
  }
}

function boundedSelections(
  selections: PartSelection[],
  expectedLength: number
): PartSelection[] {
  if (expectedLength === 0) return []
  return selections.slice(-Math.min(expectedLength, HISTORY_LIMIT))
}

function normalizeSelectionForDocument(
  selection: PartSelection,
  document: EditorDocument
): PartSelection {
  return normalizePartSelection(selection, modelFromDocument(document))
}

function applyEditToState(
  state: DocumentStore,
  result: DocumentEditResult
): Partial<DocumentStore> {
  const beforeSelection = currentSelection(state)
  const afterSelection = normalizeSelectionForDocument(
    result.selection ?? beforeSelection,
    result.document
  )
  const history = commitHistory(state.history, result.document)
  const base = {
    history,
    kind: isModelDefinition(history.present) ? 'model' as const : 'variant' as const,
    ...selectionState(afterSelection),
    dirty: signature(history.present) !== state.savedSignature,
    ...(result.editorNotice === undefined
      ? {}
      : { editorNotice: result.editorNotice })
  }

  if (history === state.history) return base

  if (state.history.group !== null) {
    return {
      ...base,
      selectionHistory: {
        ...state.selectionHistory,
        present: copySelection(afterSelection),
        future: []
      }
    }
  }

  return {
    ...base,
    selectionHistory: {
      present: copySelection(afterSelection),
      past: boundedSelections(
        [...state.selectionHistory.past, beforeSelection],
        history.past.length
      ),
      future: [],
      group: null
    }
  }
}

function settleSelectionGroup(
  selectionHistory: SelectionHistoryState,
  before: HistoryState<EditorDocument>,
  after: HistoryState<EditorDocument>
): SelectionHistoryState {
  const group = selectionHistory.group
  if (group === null || before.group === null) return selectionHistory
  const changed = signature(before.group.base) !== signature(before.present)
  if (!changed) {
    return {
      present: copySelection(group.previousPresent),
      past: selectionHistory.past,
      future: group.future,
      group: null
    }
  }
  return {
    present: copySelection(selectionHistory.present),
    past: boundedSelections(
      [...selectionHistory.past, copySelection(group.base)],
      after.past.length
    ),
    future: [],
    group: null
  }
}

function initialState(): Pick<
  DocumentStore,
  | 'history'
  | 'kind'
  | 'filePath'
  | 'selectedPartIds'
  | 'activePartId'
  | 'selectionHistory'
  | 'documentEpoch'
  | 'savedSignature'
  | 'dirty'
  | 'editorNotice'
> {
  const document = createDefaultModel()
  const selection = createPartSelection(document.parts[0]?.id ?? null)
  return {
    history: createHistory(document),
    kind: 'model',
    filePath: null,
    ...selectionState(selection),
    selectionHistory: createSelectionHistory(selection),
    documentEpoch: 0,
    savedSignature: signature(document),
    dirty: false,
    editorNotice: null
  }
}

export const useDocumentStore = create<DocumentStore>((set) => ({
  ...initialState(),
  reset(document, filePath = null) {
    const copied = cloneDocument(document)
    const selection = createPartSelection(
      isModelDefinition(copied) ? (copied.parts[0]?.id ?? null) : null
    )
    set((state) => ({
      history: createHistory(copied),
      kind: isModelDefinition(copied) ? 'model' : 'variant',
      filePath,
      ...selectionState(selection),
      selectionHistory: createSelectionHistory(selection),
      documentEpoch: state.documentEpoch + 1,
      savedSignature: signature(copied),
      dirty: false,
      editorNotice: null
    }))
  },
  newModel() {
    const document = createDefaultModel()
    const selection = createPartSelection(document.parts[0]?.id ?? null)
    set((state) => ({
      history: createHistory(document),
      kind: 'model',
      filePath: null,
      ...selectionState(selection),
      selectionHistory: createSelectionHistory(selection),
      documentEpoch: state.documentEpoch + 1,
      savedSignature: signature(document),
      dirty: false,
      editorNotice: null
    }))
  },
  newVariant() {
    const document = createDefaultVariant()
    const selection = createPartSelection(null)
    set((state) => ({
      history: createHistory(document),
      kind: 'variant',
      filePath: null,
      ...selectionState(selection),
      selectionHistory: createSelectionHistory(selection),
      documentEpoch: state.documentEpoch + 1,
      savedSignature: signature(document),
      dirty: false,
      editorNotice: null
    }))
  },
  update(updater) {
    set((state) =>
      applyEditToState(state, {
        document: updater(cloneDocument(state.history.present)),
        selection: currentSelection(state)
      })
    )
  },
  applyEdit(edit) {
    set((state) => {
      const result = edit(
        cloneDocument(state.history.present),
        currentSelection(state)
      )
      return applyEditToState(state, {
        ...result,
        document: cloneDocument(result.document)
      })
    })
  },
  executeModelCommand(command) {
    set((state) => {
      const document = state.history.present
      if (!isModelDefinition(document)) return state
      const result = executeModelSelectionCommand(
        document,
        currentSelection(state),
        command
      )
      return applyEditToState(state, {
        document: result.model,
        selection: result.selection,
        editorNotice: result.notice
      })
    })
  },
  beginTransaction() {
    set((state) => {
      if (state.history.group !== null) return state
      return {
        history: beginHistoryGroup(state.history),
        selectionHistory: {
          ...state.selectionHistory,
          group: {
            base: currentSelection(state),
            previousPresent: copySelection(state.selectionHistory.present),
            future: state.selectionHistory.future.map(copySelection)
          }
        }
      }
    })
  },
  endTransaction() {
    set((state) => {
      if (state.history.group === null) return state
      const history = endHistoryGroup(state.history)
      return {
        history,
        selectionHistory: settleSelectionGroup(
          state.selectionHistory,
          state.history,
          history
        ),
        dirty: signature(history.present) !== state.savedSignature
      }
    })
  },
  undo() {
    set((state) => {
      const settledHistory = endHistoryGroup(state.history)
      const settledSelectionHistory = settleSelectionGroup(
        state.selectionHistory,
        state.history,
        settledHistory
      )
      const previousSelection = settledSelectionHistory.past.at(-1)
      if (settledHistory.past.length === 0 || previousSelection === undefined) {
        return {
          history: settledHistory,
          selectionHistory: settledSelectionHistory,
          dirty: signature(settledHistory.present) !== state.savedSignature
        }
      }

      const history = undoHistory(settledHistory)
      const selection = normalizeSelectionForDocument(
        previousSelection,
        history.present
      )
      return {
        history,
        kind: isModelDefinition(history.present) ? 'model' : 'variant',
        ...selectionState(selection),
        selectionHistory: {
          present: copySelection(selection),
          past: settledSelectionHistory.past.slice(0, -1),
          future: [
            copySelection(settledSelectionHistory.present),
            ...settledSelectionHistory.future
          ],
          group: null
        },
        dirty: signature(history.present) !== state.savedSignature
      }
    })
  },
  redo() {
    set((state) => {
      const settledHistory = endHistoryGroup(state.history)
      const settledSelectionHistory = settleSelectionGroup(
        state.selectionHistory,
        state.history,
        settledHistory
      )
      const nextSelection = settledSelectionHistory.future[0]
      if (settledHistory.future.length === 0 || nextSelection === undefined) {
        return {
          history: settledHistory,
          selectionHistory: settledSelectionHistory,
          dirty: signature(settledHistory.present) !== state.savedSignature
        }
      }

      const history = redoHistory(settledHistory)
      const selection = normalizeSelectionForDocument(
        nextSelection,
        history.present
      )
      return {
        history,
        kind: isModelDefinition(history.present) ? 'model' : 'variant',
        ...selectionState(selection),
        selectionHistory: {
          present: copySelection(selection),
          past: boundedSelections(
            [
              ...settledSelectionHistory.past,
              copySelection(settledSelectionHistory.present)
            ],
            history.past.length
          ),
          future: settledSelectionHistory.future.slice(1),
          group: null
        },
        dirty: signature(history.present) !== state.savedSignature
      }
    })
  },
  selectPart(partId, additive = false) {
    set((state) => {
      const selection = reducePartSelectionIntent(currentSelection(state), {
        ...(partId === null
          ? { type: 'empty' as const }
          : { type: 'part' as const, partId }),
        additive
      })
      return selectionState(
        normalizeSelectionForDocument(selection, state.history.present)
      )
    })
  },
  setSelection(partIds, activePartId) {
    set((state) =>
      selectionState(
        normalizeSelectionForDocument(
          selectionFromIds(partIds, activePartId),
          state.history.present
        )
      )
    )
  },
  clearSelection() {
    set(selectionState(createPartSelection(null)))
  },
  setEditorNotice(editorNotice) {
    set({ editorNotice })
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
