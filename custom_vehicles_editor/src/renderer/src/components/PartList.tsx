import type { ModelDefinition } from '../../../shared/schema'
import { useDocumentStore } from '../../store/document-store'
import {
  addPart,
  deletePart,
  duplicatePart,
  mirrorPart,
  reorderPart,
  setPartMetadata
} from '../../store/operations'
import { materialColor } from '../materialColor'

export function PartList({
  model,
  selectedPartId
}: {
  model: ModelDefinition
  selectedPartId: string | null
}): React.JSX.Element {
  const update = useDocumentStore((state) => state.update)
  const selectPart = useDocumentStore((state) => state.selectPart)
  const hidden = new Set(model.editor?.['hidden-parts'] ?? [])
  const locked = new Set(model.editor?.['locked-parts'] ?? [])

  const duplicateSelected = (): void => {
    if (selectedPartId === null) return
    const result = duplicatePart(model, selectedPartId)
    update(() => result.model)
    selectPart(result.partId)
  }

  const deleteSelected = (): void => {
    if (selectedPartId === null) return
    const result = deletePart(model, selectedPartId)
    update(() => result.model)
    selectPart(result.selectedPartId)
  }

  const mirrorSelected = (axis: 'x' | 'z'): void => {
    if (selectedPartId === null) return
    const result = mirrorPart(model, selectedPartId, axis)
    update(() => result.model)
    selectPart(result.partId)
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
      <div className="part-list" role="listbox" aria-label="Детали модели">
        {model.parts.map((part, index) => {
          const isHidden = hidden.has(part.id)
          const isLocked = locked.has(part.id)
          return (
            <div
              className={`part-row ${selectedPartId === part.id ? 'is-selected' : ''} ${isHidden ? 'is-hidden' : ''}`}
              role="option"
              aria-selected={selectedPartId === part.id}
              key={part.id}
              onClick={() => selectPart(part.id)}
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
                    update(() => setPartMetadata(model, part.id, 'hidden-parts', !isHidden))
                  }}
                >
                  {isHidden ? '○' : '●'}
                </button>
                <button
                  type="button"
                  className={isLocked ? 'is-active' : ''}
                  title={isLocked ? 'Разблокировать деталь' : 'Заблокировать деталь'}
                  aria-label={isLocked ? 'Разблокировать деталь' : 'Заблокировать деталь'}
                  onClick={(event) => {
                    event.stopPropagation()
                    update(() => setPartMetadata(model, part.id, 'locked-parts', !isLocked))
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
                    update(() => reorderPart(model, part.id, -1))
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
                    update(() => reorderPart(model, part.id, 1))
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
            const result = addPart(model, selectedPartId ?? undefined)
            update(() => result.model)
            selectPart(result.partId)
          }}
        >
          + Деталь
        </button>
        <button type="button" disabled={selectedPartId === null} onClick={duplicateSelected}>
          Дубликат
        </button>
        <button
          type="button"
          className="danger-button"
          disabled={selectedPartId === null || model.parts.length <= 1}
          onClick={deleteSelected}
        >
          Удалить
        </button>
        <div className="mirror-actions">
          <button type="button" disabled={selectedPartId === null} onClick={() => mirrorSelected('x')}>
            Зеркало X
          </button>
          <button type="button" disabled={selectedPartId === null} onClick={() => mirrorSelected('z')}>
            Зеркало Z
          </button>
        </div>
      </div>
    </aside>
  )
}
