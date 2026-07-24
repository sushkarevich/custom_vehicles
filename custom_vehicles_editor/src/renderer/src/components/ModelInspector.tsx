import type { ModelDefinition, Vector3 } from '../../../shared/schema'
import { useDocumentStore } from '../../store/document-store'
import {
  mirrorPart,
  renamePart,
  setPartMetadata,
  updatePart
} from '../../store/operations'
import { Field, NumberField, Section, TransactionalText } from './fields'
import { MaterialPicker } from './MaterialPicker'

function updateVector(vector: Vector3, axis: keyof Vector3, value: number): Vector3 {
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
      {(['x', 'y', 'z'] as const).map((axis) => (
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

export function ModelInspector({
  model,
  selectedPartId
}: {
  model: ModelDefinition
  selectedPartId: string | null
}): React.JSX.Element {
  const update = useDocumentStore((state) => state.update)
  const selectPart = useDocumentStore((state) => state.selectPart)
  const part = model.parts.find((entry) => entry.id === selectedPartId)
  const hidden = part === undefined ? false : model.editor?.['hidden-parts']?.includes(part.id) === true
  const locked = part === undefined ? false : model.editor?.['locked-parts']?.includes(part.id) === true

  const updateModel = (mutate: (next: ModelDefinition) => void): void => {
    update((document) => {
      if (!('parts' in document)) return document
      mutate(document)
      return document
    })
  }

  const updateSelected = (mutate: Parameters<typeof updatePart>[2]): void => {
    if (part === undefined) return
    update(() => updatePart(model, part.id, mutate))
  }

  return (
    <aside className="right-panel panel">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">Свойства</span>
          <h2>{part === undefined ? 'Модель' : part.id}</h2>
        </div>
        <span className="coordinate-badge">XYZ</span>
      </div>
      <div className="inspector-scroll">
        <Section title="Модель" subtitle="Общие данные YAML">
          <TransactionalText
            label="ID модели"
            value={model.id}
            hint="Стабильный идентификатор: a-z, 0-9, _ и -"
            onChange={(value) => updateModel((next) => {
              next.id = value
            })}
          />
          <TransactionalText
            label="Отображаемое имя"
            value={model['display-name']}
            onChange={(value) => updateModel((next) => {
              next['display-name'] = value
            })}
          />
          <Field label="Направление вперёд" hint="+X вправо, +Y вверх">
            <select
              value={model['coordinate-system'].forward}
              onChange={(event) => updateModel((next) => {
                next['coordinate-system'].forward = event.target.value as 'positive-z' | 'negative-z'
              })}
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
                onChange={(event) => updateModel((next) => {
                  if (event.target.checked) {
                    next.interaction = {
                      offset: { x: 0, y: 0, z: 0 },
                      width: 1,
                      height: 1
                    }
                  } else {
                    delete next.interaction
                  }
                })}
              />
              <span>Включена</span>
            </label>
          }
        >
          {model.interaction === undefined ? (
            <p className="empty-state compact">Модель не создаёт Interaction entity.</p>
          ) : (
            <>
              <span className="subsection-label">Смещение нижнего центра (anchor)</span>
              <VectorFields
                value={model.interaction.offset}
                min={-256}
                max={256}
                onChange={(value) => updateModel((next) => {
                  if (next.interaction !== undefined) next.interaction.offset = value
                })}
              />
              <div className="two-column-fields">
                <NumberField
                  label="Ширина"
                  value={model.interaction.width}
                  min={0.01}
                  max={64}
                  onChange={(value) => updateModel((next) => {
                    if (next.interaction !== undefined) next.interaction.width = value
                  })}
                />
                <NumberField
                  label="Высота"
                  value={model.interaction.height}
                  min={0.01}
                  max={64}
                  onChange={(value) => updateModel((next) => {
                    if (next.interaction !== undefined) next.interaction.height = value
                  })}
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
              onChange={(value) => updateModel((next) => {
                next.display['interpolation-duration'] = Math.round(value)
              })}
            />
            <NumberField
              label="Телепорт"
              value={model.display['teleport-duration']}
              min={0}
              max={59}
              step={1}
              onChange={(value) => updateModel((next) => {
                next.display['teleport-duration'] = Math.round(value)
              })}
            />
          </div>
        </Section>

        {part !== undefined && (
          <>
            <Section
              title="Выбранная деталь"
              subtitle={`Деталь ${model.parts.indexOf(part) + 1} из ${model.parts.length}`}
              actions={<span className="type-chip">block</span>}
            >
              <Field label="ID детали" hint="Enter или потеря фокуса применит новое имя">
                <input
                  id="part-id-input"
                  key={part.id}
                  type="text"
                  defaultValue={part.id}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') event.currentTarget.blur()
                  }}
                  onBlur={(event) => {
                    const result = renamePart(model, part.id, event.target.value)
                    update(() => result.model)
                    selectPart(result.partId)
                  }}
                />
              </Field>
              <MaterialPicker
                value={part.material}
                onChange={(material) => updateSelected((next) => {
                  next.material = material
                })}
              />
              <div className="toggle-grid">
                <label className="switch-row">
                  <input
                    type="checkbox"
                    checked={hidden}
                    onChange={(event) =>
                      update(() => setPartMetadata(model, part.id, 'hidden-parts', event.target.checked))
                    }
                  />
                  <span>Скрыта в редакторе</span>
                </label>
                <label className="switch-row">
                  <input
                    type="checkbox"
                    checked={locked}
                    onChange={(event) =>
                      update(() => setPartMetadata(model, part.id, 'locked-parts', event.target.checked))
                    }
                  />
                  <span>Трансформация заблокирована</span>
                </label>
              </div>
            </Section>

            <Section title="Позиция" subtitle="Центр кубоида, блоки">
              <VectorFields
                value={part.position}
                min={-256}
                max={256}
                onChange={(position) => updateSelected((next) => {
                  next.position = position
                })}
              />
            </Section>
            <Section title="Масштаб" subtitle="Размер кубоида, блоки">
              <VectorFields
                value={part.scale}
                min={0.0001}
                max={64}
                onChange={(scale) => updateSelected((next) => {
                  next.scale = scale
                })}
              />
            </Section>
            <Section title="Вращение" subtitle="Euler XYZ, градусы">
              <VectorFields
                value={part['rotation-degrees']}
                step={1}
                onChange={(rotation) => updateSelected((next) => {
                  next['rotation-degrees'] = rotation
                })}
              />
            </Section>
            <Section title="Зеркальная копия">
              <div className="wide-button-row">
                {(['x', 'z'] as const).map((axis) => (
                  <button
                    type="button"
                    key={axis}
                    onClick={() => {
                      const result = mirrorPart(model, part.id, axis)
                      update(() => result.model)
                      selectPart(result.partId)
                    }}
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
