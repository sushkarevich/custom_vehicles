import type { ValidationIssue } from '../../../shared/schema'
import type { WorkflowStatus } from '../hooks/useFileWorkflows'

export function StatusBar({
  issues,
  status,
  filePath,
  selectedPartIds,
  activePartId,
  partCount
}: {
  issues: ValidationIssue[]
  status: WorkflowStatus
  filePath: string | null
  selectedPartIds: string[]
  activePartId: string | null
  partCount: number | null
}): React.JSX.Element {
  const errors = issues.filter((issue) => issue.severity === 'error')
  const warnings = issues.filter((issue) => issue.severity === 'warning')
  return (
    <footer className="status-bar">
      <details className={`validation-summary ${errors.length > 0 ? 'has-errors' : warnings.length > 0 ? 'has-warnings' : 'is-valid'}`}>
        <summary>
          <span className="status-dot" />
          {errors.length > 0
            ? `Ошибки: ${errors.length}`
            : warnings.length > 0
              ? `Предупреждения: ${warnings.length}`
              : 'Схема корректна'}
        </summary>
        <div className="validation-popover">
          {issues.length === 0 ? (
            <p>Документ готов к сохранению и экспорту.</p>
          ) : (
            issues.map((issue, index) => (
              <button
                type="button"
                className={issue.severity}
                key={`${issue.path}-${issue.message}-${index}`}
                onClick={() => {
                  const field = document.querySelector<HTMLElement>(`[data-validation-path="${CSS.escape(issue.path)}"]`)
                  field?.focus()
                }}
              >
                <code>{issue.path}</code>
                <span>{issue.message}</span>
              </button>
            ))
          )}
        </div>
      </details>
      <span className={`workflow-status ${status.kind}`}>{status.text}</span>
      <span className="status-spacer" />
      {selectedPartIds.length === 0 ? null : (
        <span>
          Выбрано: <strong>{selectedPartIds.length}</strong>
          {activePartId === null ? null : <> · Активная: <strong>{activePartId}</strong></>}
        </span>
      )}
      {partCount === null ? null : <span>Деталей: <strong>{partCount}</strong></span>}
      <span className="path-status" title={filePath ?? 'Новый документ'}>
        {filePath ?? 'Новый документ'}
      </span>
    </footer>
  )
}
