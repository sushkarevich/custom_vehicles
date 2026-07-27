import { isModelDefinition, type ModelDefinition } from '../../../shared/schema'
import { useDocumentStore } from '../../store/document-store'
import { addPart } from '../../store/operations'
import { selectionFromIds } from '../../store/selection'
import { materialColor } from '../materialColor'

export function PartList({
  model,
  selectedPartIds,
  activePartId
}: {
  model: ModelDefinition
  selectedPartIds: string[]
  activePartId: string | null
}): React.JSX.Element {
  const applyEdit = useDocumentStore((state) => state.applyEdit)
  const executeModelCommand = useDocumentStore((state) => state.executeModelCommand)
  const selectPart = useDocumentStore((state) => state.selectPart)
  const hidden = new Set(model.editor?.['hidden-parts'] ?? [])
  const locked = new Set(model.editor?.['locked-parts'] ?? [])
  const selected = new Set(selectedPartIds)
  const editablePartIds = selectedPartIds.filter((id) => !locked.has(id))

  const targetRow = (partId: string, isSelected: boolean): void => {
    if (!isSelected) selectPart(partId)
  }

  return (
    <aside className="left-panel panel">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">Иерархия</span>
          <h2>Детали</h2>
        </div>
        <span className="count-badge">{model.parts.length}</span>
      </div>
      <div
        className="part-list"
        role="listbox"
        aria-label="Детали модели"
        aria-multiselectable="true"
      >
        {model.parts.map((part, index) => {
          const isHidden = hidden.has(part.id)
          const isLocked = locked.has(part.id)
          const isSelected = selected.has(part.id)
          const isActive = activePartId === part.id
          const lockTargets = isSelected ? selectedPartIds : [part.id]
          const shouldLockTargets = !lockTargets.every((id) => locked.has(id))
          const lockActionLabel =
            lockTargets.length > 1
              ? shouldLockTargets
                ? 'Заблокировать выбранные детали'
                : 'Разблокировать выбранные детали'
              : shouldLockTargets
                ? 'Заблокировать деталь'
                : 'Разблокировать деталь'
          return (
            <div
              className={`part-row ${isSelected ? 'is-selected' : ''} ${isActive ? 'is-active-selection' : ''} ${isHidden ? 'is-hidden' : ''}`}
              role="option"
              aria-selected={isSelected}
              aria-current={isActive ? 'true' : undefined}
              key={part.id}
              onClick={(event) => selectPart(part.id, event.shiftKey)}
              onDoubleClick={() => document.querySelector<HTMLInputElement>('#part-id-input')?.focus()}
            >
              <span
                className="material-swatch"
                style={{ '--swatch-color': materialColor(part.material) } as React.CSSProperties}
                aria-hidden="true"
              />
              <span className="part-copy">
                <strong>{part.id}</strong>
                <small>{part.material.replaceAll('_', ' ')}</small>
              </span>
              <div className="part-row-actions">
                <button
                  type="button"
                  className={isHidden ? 'is-active' : ''}
                  title={isHidden ? 'Показать деталь' : 'Скрыть деталь'}
                  aria-label={isHidden ? 'Показать деталь' : 'Скрыть деталь'}
                  onClick={(event) => {
                    event.stopPropagation()
                    targetRow(part.id, isSelected)
                    const targets = isSelected ? editablePartIds : [part.id]
                    const allHidden = targets.every((id) => hidden.has(id))
                    executeModelCommand({
                      type: 'set-metadata',
                      key: 'hidden-parts',
                      enabled: !allHidden
                    })
                  }}
                >
                  {isHidden ? '○' : '●'}
                </button>
                <button
                  type="button"
                  className={isLocked ? 'is-active' : ''}
                  title={lockActionLabel}
                  aria-label={lockActionLabel}
                  onClick={(event) => {
                    event.stopPropagation()
                    targetRow(part.id, isSelected)
                    executeModelCommand({
                      type: 'set-metadata',
                      key: 'locked-parts',
                      enabled: shouldLockTargets
                    })
                  }}
                >
                  {isLocked ? '◆' : '◇'}
                </button>
                <button
                  type="button"
                  title="Поднять в списке"
                  aria-label="Поднять в списке"
                  disabled={index === 0}
                  onClick={(event) => {
                    event.stopPropagation()
                    targetRow(part.id, isSelected)
                    executeModelCommand({ type: 'reorder', direction: -1 })
                  }}
                >
                  ↑
                </button>
                <button
                  type="button"
                  title="Опустить в списке"
                  aria-label="Опустить в списке"
                  disabled={index === model.parts.length - 1}
                  onClick={(event) => {
                    event.stopPropagation()
                    targetRow(part.id, isSelected)
                    executeModelCommand({ type: 'reorder', direction: 1 })
                  }}
                >
                  ↓
                </button>
              </div>
            </div>
          )
        })}
      </div>
      <div className="part-actions">
        <button
          type="button"
          className="primary-button"
          onClick={() => {
            applyEdit((document, selection) => {
              if (!isModelDefinition(document)) return { document, selection }
              const result = addPart(document, selection.activePartId ?? undefined)
              return {
                document: result.model,
                selection: selectionFromIds([result.partId], result.partId)
              }
            })
          }}
        >
          + Деталь
        </button>
        <button
          type="button"
          disabled={editablePartIds.length === 0}
          onClick={() => executeModelCommand({ type: 'duplicate' })}
        >
          Дубликат
        </button>
        <button
          type="button"
          className="danger-button"
          disabled={
            editablePartIds.length === 0 ||
            editablePartIds.length >= model.parts.length
          }
          onClick={() => executeModelCommand({ type: 'delete' })}
        >
          Удалить
        </button>
        <div className="mirror-actions">
          <button
            type="button"
            disabled={editablePartIds.length === 0}
            onClick={() => executeModelCommand({ type: 'mirror', axis: 'x' })}
          >
            Зеркало X
          </button>
          <button
            type="button"
            disabled={editablePartIds.length === 0}
            onClick={() => executeModelCommand({ type: 'mirror', axis: 'z' })}
          >
            Зеркало Z
          </button>
        </div>
      </div>
    </aside>
  )
}
