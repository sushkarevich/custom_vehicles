import {
  isModelDefinition,
  type ModelDefinition,
  type ModelPart,
  type Vector3
} from '../../../shared/schema'
import { useDocumentStore } from '../../store/document-store'
import { renamePart, updateParts } from '../../store/operations'
import { selectionFromIds } from '../../store/selection'
import {
  Field,
  IndeterminateCheckbox,
  NumberField,
  Section,
  TransactionalText
} from './fields'
import { MaterialPicker } from './MaterialPicker'

const AXES = ['x', 'y', 'z'] as const
type Axis = (typeof AXES)[number]
type PartVectorKey = 'position' | 'scale' | 'rotation-degrees'

function updateVector(vector: Vector3, axis: Axis, value: number): Vector3 {
  return { ...vector, [axis]: value }
}

function VectorFields({
  value,
  onChange,
  min,
  max,
  step
}: {
  value: Vector3
  onChange: (value: Vector3) => void
  min?: number
  max?: number
  step?: number
}): React.JSX.Element {
  return (
    <div className="vector-fields">
      {AXES.map((axis) => (
        <NumberField
          key={axis}
          label={axis.toLocaleUpperCase('en-US')}
          value={value[axis]}
          onChange={(next) => onChange(updateVector(value, axis, next))}
          {...(min === undefined ? {} : { min })}
          {...(max === undefined ? {} : { max })}
          {...(step === undefined ? {} : { step })}
        />
      ))}
    </div>
  )
}

function commonValue<T>(values: readonly T[]): T | null {
  const first = values[0]
  if (first === undefined) return null
  return values.every((value) => Object.is(value, first)) ? first : null
}

function MixedPartVectorFields({
  parts,
  vectorKey,
  onAxisChange,
  disabled,
  min,
  max,
  step
}: {
  parts: readonly ModelPart[]
  vectorKey: PartVectorKey
  onAxisChange: (axis: Axis, value: number) => void
  disabled: boolean
  min?: number
  max?: number
  step?: number
}): React.JSX.Element {
  return (
    <div className="vector-fields">
      {AXES.map((axis) => (
        <NumberField
          key={axis}
          label={axis.toLocaleUpperCase('en-US')}
          value={commonValue(parts.map((part) => part[vectorKey][axis]))}
          onChange={(value) => onAxisChange(axis, value)}
          disabled={disabled}
          {...(min === undefined ? {} : { min })}
          {...(max === undefined ? {} : { max })}
          {...(step === undefined ? {} : { step })}
        />
      ))}
    </div>
  )
}

export function ModelInspector({
  model,
  selectedPartIds,
  activePartId
}: {
  model: ModelDefinition
  selectedPartIds: readonly string[]
  activePartId: string | null
}): React.JSX.Element {
  const update = useDocumentStore((state) => state.update)
  const applyEdit = useDocumentStore((state) => state.applyEdit)
  const executeModelCommand = useDocumentStore((state) => state.executeModelCommand)
  const selected = new Set(selectedPartIds)
  const parts = model.parts.filter((part) => selected.has(part.id))
  const activePart = model.parts.find((part) => part.id === activePartId)
  const hidden = new Set(model.editor?.['hidden-parts'] ?? [])
  const locked = new Set(model.editor?.['locked-parts'] ?? [])
  const unlockedCount = parts.filter((part) => !locked.has(part.id)).length
  const skippedLocked = parts.length - unlockedCount
  const allHidden = parts.length > 0 && parts.every((part) => hidden.has(part.id))
  const someHidden = parts.some((part) => hidden.has(part.id))
  const allLocked = parts.length > 0 && parts.every((part) => locked.has(part.id))
  const someLocked = parts.some((part) => locked.has(part.id))
  const material = commonValue(parts.map((part) => part.material))

  const updateModel = (mutate: (next: ModelDefinition) => void): void => {
    update((document) => {
      if (!isModelDefinition(document)) return document
      mutate(document)
      return document
    })
  }

  const updateSelectedAxis = (
    vectorKey: PartVectorKey,
    axis: Axis,
    value: number
  ): void => {
    applyEdit((document, selection) => {
      if (!isModelDefinition(document)) return { document, selection }
      const currentLocked = new Set(document.editor?.['locked-parts'] ?? [])
      const targetIds = selection.selectedPartIds.filter(
        (partId) => !currentLocked.has(partId)
      )
      return {
        document: updateParts(document, targetIds, (part) => {
          part[vectorKey] = {
            ...part[vectorKey],
            [axis]: value
          }
        }),
        selection,
        editorNotice:
          selection.selectedPartIds.length === targetIds.length
            ? null
            : `Пропущено заблокированных деталей: ${
                selection.selectedPartIds.length - targetIds.length
              }.`
      }
    })
  }

  return (
    <aside className="right-panel panel">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">Свойства</span>
          <h2>
            {parts.length === 0
              ? 'Модель'
              : parts.length === 1
                ? activePart?.id ?? parts[0]?.id
                : `Выбрано: ${parts.length}`}
          </h2>
        </div>
        <span className="coordinate-badge">XYZ</span>
      </div>
      <div className="inspector-scroll">
        <Section title="Модель" subtitle="Общие данные YAML">
          <TransactionalText
            label="ID модели"
            value={model.id}
            hint="Стабильный идентификатор: a-z, 0-9, _ и -"
            onChange={(value) =>
              updateModel((next) => {
                next.id = value
              })
            }
          />
          <TransactionalText
            label="Отображаемое имя"
            value={model['display-name']}
            onChange={(value) =>
              updateModel((next) => {
                next['display-name'] = value
              })
            }
          />
          <Field label="Направление вперёд" hint="+X вправо, +Y вверх">
            <select
              value={model['coordinate-system'].forward}
              onChange={(event) =>
                updateModel((next) => {
                  next['coordinate-system'].forward = event.target.value as
                    | 'positive-z'
                    | 'negative-z'
                })
              }
            >
              <option value="positive-z">+Z (positive-z)</option>
              <option value="negative-z">−Z (negative-z)</option>
            </select>
          </Field>
        </Section>

        <Section
          title="Взаимодействие"
          subtitle="Необязательная область Interaction на сервере"
          actions={
            <label className="inline-checkbox">
              <input
                type="checkbox"
                checked={model.interaction !== undefined}
                onChange={(event) =>
                  updateModel((next) => {
                    if (event.target.checked) {
                      next.interaction = {
                        offset: { x: 0, y: 0, z: 0 },
                        width: 1,
                        height: 1
                      }
                    } else {
                      delete next.interaction
                    }
                  })
                }
              />
              <span>Включена</span>
            </label>
          }
        >
          {model.interaction === undefined ? (
            <p className="empty-state compact">
              Модель не создаёт Interaction entity.
            </p>
          ) : (
            <>
              <span className="subsection-label">
                Смещение нижнего центра (anchor)
              </span>
              <VectorFields
                value={model.interaction.offset}
                min={-256}
                max={256}
                onChange={(value) =>
                  updateModel((next) => {
                    if (next.interaction !== undefined) {
                      next.interaction.offset = value
                    }
                  })
                }
              />
              <div className="two-column-fields">
                <NumberField
                  label="Ширина"
                  value={model.interaction.width}
                  min={0.01}
                  max={64}
                  onChange={(value) =>
                    updateModel((next) => {
                      if (next.interaction !== undefined) {
                        next.interaction.width = value
                      }
                    })
                  }
                />
                <NumberField
                  label="Высота"
                  value={model.interaction.height}
                  min={0.01}
                  max={64}
                  onChange={(value) =>
                    updateModel((next) => {
                      if (next.interaction !== undefined) {
                        next.interaction.height = value
                      }
                    })
                  }
                />
              </div>
            </>
          )}
        </Section>

        <Section title="Плавность Display">
          <div className="two-column-fields">
            <NumberField
              label="Интерполяция"
              value={model.display['interpolation-duration']}
              min={0}
              max={59}
              step={1}
              onChange={(value) =>
                updateModel((next) => {
                  next.display['interpolation-duration'] = Math.round(value)
                })
              }
            />
            <NumberField
              label="Телепорт"
              value={model.display['teleport-duration']}
              min={0}
              max={59}
              step={1}
              onChange={(value) =>
                updateModel((next) => {
                  next.display['teleport-duration'] = Math.round(value)
                })
              }
            />
          </div>
        </Section>

        {parts.length > 0 && (
          <>
            <Section
              title={parts.length === 1 ? 'Выбранная деталь' : 'Множественное выделение'}
              subtitle={
                parts.length === 1
                  ? `Деталь ${model.parts.indexOf(parts[0]!) + 1} из ${model.parts.length}`
                  : `Выбрано деталей: ${parts.length} · Активная: ${activePart?.id ?? 'нет'}`
              }
              actions={<span className="type-chip">block</span>}
            >
              {parts.length === 1 && activePart !== undefined ? (
                <Field
                  label="ID детали"
                  hint="Enter или потеря фокуса применит новое имя"
                >
                  <input
                    id="part-id-input"
                    key={activePart.id}
                    type="text"
                    defaultValue={activePart.id}
                    onFocus={() =>
                      useDocumentStore.getState().beginTransaction()
                    }
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') event.currentTarget.blur()
                    }}
                    onBlur={(event) => {
                      const requestedId = event.target.value
                      const oldId = activePart.id
                      applyEdit((document, selection) => {
                        if (!isModelDefinition(document)) {
                          return { document, selection }
                        }
                        const result = renamePart(document, oldId, requestedId)
                        const mappedIds = selection.selectedPartIds.map((id) =>
                          id === oldId ? result.partId : id
                        )
                        return {
                          document: result.model,
                          selection: selectionFromIds(
                            mappedIds,
                            selection.activePartId === oldId
                              ? result.partId
                              : selection.activePartId
                          )
                        }
                      })
                      useDocumentStore.getState().endTransaction()
                    }}
                  />
                </Field>
              ) : (
                <p className="mixed-value-note">
                  ID редактируется только для одной активной детали.
                </p>
              )}
              <MaterialPicker
                value={material}
                onChange={(nextMaterial) =>
                  executeModelCommand({
                    type: 'assign-material',
                    material: nextMaterial
                  })
                }
              />
              <div className="toggle-grid">
                <label className="switch-row">
                  <IndeterminateCheckbox
                    checked={allHidden}
                    indeterminate={someHidden && !allHidden}
                    ariaLabel="Скрыть выбранные детали"
                    onChange={() =>
                      executeModelCommand({
                        type: 'set-metadata',
                        key: 'hidden-parts',
                        enabled: !allHidden
                      })
                    }
                  />
                  <span>Скрыты в редакторе</span>
                </label>
                <label className="switch-row">
                  <IndeterminateCheckbox
                    checked={allLocked}
                    indeterminate={someLocked && !allLocked}
                    ariaLabel="Заблокировать выбранные детали"
                    onChange={() =>
                      executeModelCommand({
                        type: 'set-metadata',
                        key: 'locked-parts',
                        enabled: !allLocked
                      })
                    }
                  />
                  <span>Трансформация заблокирована</span>
                </label>
              </div>
              {skippedLocked > 0 && (
                <p className="mixed-value-note">
                  Заблокированные детали пропускаются командами и изменением
                  трансформации.
                </p>
              )}
            </Section>

            <Section title="Позиция" subtitle="Центр кубоида, блоки">
              <MixedPartVectorFields
                parts={parts}
                vectorKey="position"
                min={-256}
                max={256}
                disabled={unlockedCount === 0}
                onAxisChange={(axis, value) =>
                  updateSelectedAxis('position', axis, value)
                }
              />
            </Section>
            <Section title="Масштаб" subtitle="Размер кубоида, блоки">
              <MixedPartVectorFields
                parts={parts}
                vectorKey="scale"
                min={0.0001}
                max={64}
                disabled={unlockedCount === 0}
                onAxisChange={(axis, value) =>
                  updateSelectedAxis('scale', axis, value)
                }
              />
            </Section>
            <Section title="Вращение" subtitle="Euler XYZ, градусы">
              <MixedPartVectorFields
                parts={parts}
                vectorKey="rotation-degrees"
                step={1}
                disabled={unlockedCount === 0}
                onAxisChange={(axis, value) =>
                  updateSelectedAxis('rotation-degrees', axis, value)
                }
              />
            </Section>
            <Section title="Зеркальная копия">
              <div className="wide-button-row">
                {(['x', 'z'] as const).map((axis) => (
                  <button
                    type="button"
                    key={axis}
                    disabled={unlockedCount === 0}
                    onClick={() =>
                      executeModelCommand({ type: 'mirror', axis })
                    }
                  >
                    Копия по {axis.toLocaleUpperCase('en-US')}
                  </button>
                ))}
              </div>
            </Section>
          </>
        )}
      </div>
    </aside>
  )
}
