import { useCallback, useEffect, useState } from 'react'
import type { RecentDocument } from '../../../shared/ipc'
import {
  isModelDefinition,
  type EditorDocument,
  type ValidationIssue
} from '../../../shared/schema'
import { hasValidationErrors, validateModel, validateVariant } from '../../../shared/validation'
import { parseEditorDocument, serializeEditorDocument } from '../../../shared/yaml'
import { useDocumentStore } from '../../store/document-store'

export interface WorkflowStatus {
  kind: 'info' | 'success' | 'error'
  text: string
}

function errorText(caught: unknown): string {
  return caught instanceof Error ? caught.message : String(caught)
}

function documentIssues(document: EditorDocument): ValidationIssue[] {
  return isModelDefinition(document) ? validateModel(document) : validateVariant(document)
}

export function useFileWorkflows(
  setLoadIssues: (issues: ValidationIssue[]) => void
): {
  recent: RecentDocument[]
  status: WorkflowStatus
  newModel: () => Promise<void>
  newVariant: () => Promise<void>
  open: () => Promise<void>
  openRecent: (filePath: string) => Promise<void>
  save: () => Promise<boolean>
  saveAs: () => Promise<boolean>
  exportDocument: () => Promise<boolean>
  refreshRecent: () => Promise<void>
  setStatus: (status: WorkflowStatus) => void
} {
  const [recent, setRecent] = useState<RecentDocument[]>([])
  const [status, setStatus] = useState<WorkflowStatus>({
    kind: 'info',
    text: 'Готово к работе'
  })

  const refreshRecent = useCallback(async () => {
    try {
      setRecent(await window.editorApi.getRecentDocuments())
    } catch (caught) {
      setStatus({ kind: 'error', text: `Не удалось загрузить недавние файлы: ${errorText(caught)}` })
    }
  }, [])

  useEffect(() => {
    void refreshRecent()
  }, [refreshRecent])

  const mayDiscard = useCallback(async (): Promise<boolean> => {
    const state = useDocumentStore.getState()
    if (!state.dirty) return true
    const name = state.filePath ?? state.history.present['display-name']
    return window.editorApi.confirmDiscard(name)
  }, [])

  const loadOpenedDocument = useCallback(
    (opened: { filePath: string; content: string }): void => {
      const parsed = parseEditorDocument(opened.content)
      if (parsed.value === null) {
        setLoadIssues(parsed.issues)
        setStatus({
          kind: 'error',
          text: 'Документ не открыт: исправьте синтаксис YAML во внешнем редакторе'
        })
        return
      }
      useDocumentStore.getState().reset(parsed.value, opened.filePath)
      setLoadIssues(parsed.issues)
      setStatus({
        kind: hasValidationErrors(parsed.issues) ? 'error' : 'success',
        text: hasValidationErrors(parsed.issues)
          ? 'Документ открыт с ошибками — исправьте их перед сохранением'
          : `Открыт файл ${opened.filePath}`
      })
      void refreshRecent()
    },
    [refreshRecent, setLoadIssues]
  )

  const newModel = useCallback(async () => {
    if (!(await mayDiscard())) return
    useDocumentStore.getState().newModel()
    setLoadIssues([])
    setStatus({ kind: 'success', text: 'Создана новая модель' })
  }, [mayDiscard, setLoadIssues])

  const newVariant = useCallback(async () => {
    if (!(await mayDiscard())) return
    useDocumentStore.getState().newVariant()
    setLoadIssues([])
    setStatus({ kind: 'success', text: 'Создан новый вариант транспорта' })
  }, [mayDiscard, setLoadIssues])

  const open = useCallback(async () => {
    if (!(await mayDiscard())) return
    try {
      const opened = await window.editorApi.openDocument()
      if (opened !== null) loadOpenedDocument(opened)
    } catch (caught) {
      setStatus({ kind: 'error', text: `Не удалось открыть файл: ${errorText(caught)}` })
    }
  }, [loadOpenedDocument, mayDiscard])

  const openRecent = useCallback(
    async (filePath: string) => {
      if (!(await mayDiscard())) return
      try {
        loadOpenedDocument(await window.editorApi.openRecent(filePath))
      } catch (caught) {
        setStatus({ kind: 'error', text: `Не удалось открыть недавний файл: ${errorText(caught)}` })
        void refreshRecent()
      }
    },
    [loadOpenedDocument, mayDiscard, refreshRecent]
  )

  const write = useCallback(
    async (forceSaveAs: boolean): Promise<boolean> => {
      const state = useDocumentStore.getState()
      const document = state.history.present
      const issues = documentIssues(document)
      setLoadIssues(issues)
      if (hasValidationErrors(issues)) {
        setStatus({ kind: 'error', text: 'Сохранение отменено: исправьте ошибки в документе' })
        return false
      }
      try {
        let filePath = forceSaveAs ? null : state.filePath
        if (filePath === null) {
          filePath = await window.editorApi.chooseSavePath({
            suggestedName: `${document.id}.yaml`,
            ...(state.filePath === null ? {} : { currentPath: state.filePath })
          })
          if (filePath === null) return false
        }
        await window.editorApi.saveDocument({
          filePath,
          content: serializeEditorDocument(document)
        })
        useDocumentStore.getState().markSaved(filePath)
        setStatus({ kind: 'success', text: `Сохранено: ${filePath}` })
        void refreshRecent()
        return true
      } catch (caught) {
        setStatus({ kind: 'error', text: `Не удалось сохранить файл: ${errorText(caught)}` })
        return false
      }
    },
    [refreshRecent, setLoadIssues]
  )

  const save = useCallback(() => write(false), [write])
  const saveAs = useCallback(() => write(true), [write])

  const exportDocument = useCallback(async (): Promise<boolean> => {
    const document = useDocumentStore.getState().history.present
    const issues = documentIssues(document)
    setLoadIssues(issues)
    if (hasValidationErrors(issues)) {
      setStatus({ kind: 'error', text: 'Экспорт отменён: исправьте ошибки в документе' })
      return false
    }
    try {
      const result = await window.editorApi.exportDocument({
        suggestedName: `${document.id}.yaml`,
        content: serializeEditorDocument(document)
      })
      if (result === null) return false
      setStatus({ kind: 'success', text: `Экспортировано: ${result.filePath}` })
      void refreshRecent()
      return true
    } catch (caught) {
      setStatus({ kind: 'error', text: `Не удалось экспортировать файл: ${errorText(caught)}` })
      return false
    }
  }, [refreshRecent, setLoadIssues])

  return {
    recent,
    status,
    newModel,
    newVariant,
    open,
    openRecent,
    save,
    saveAs,
    exportDocument,
    refreshRecent,
    setStatus
  }
}
