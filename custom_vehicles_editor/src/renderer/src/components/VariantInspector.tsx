import type {
  VariantItem,
  VehicleBehavior,
  VehicleVariantDefinition
} from '../../../shared/schema'
import {
  DEFAULT_VARIANT_ITEM_LORE,
  DEFAULT_VARIANT_ITEM_MATERIAL
} from '../../../shared/schema'
import { useDocumentStore } from '../../store/document-store'
import { Field, NumberField, Section, TransactionalText } from './fields'

const ROLE_LABELS: Record<string, string> = {
  locomotive: 'Локомотив',
  wagon: 'Вагон',
  front: 'Передняя секция',
  middle: 'Средняя секция',
  rear: 'Задняя секция'
}

function defaultModels(behavior: VehicleBehavior, fallback: string): Record<string, string> {
  if (behavior === 'train') {
    return { locomotive: fallback, wagon: `${fallback}_wagon` }
  }
  if (behavior === 'tram') {
    return {
      front: `${fallback}_front`,
      middle: `${fallback}_middle`,
      rear: `${fallback}_rear`
    }
  }
  return {}
}

export function VariantInspector({
  variant
}: {
  variant: VehicleVariantDefinition
}): React.JSX.Element {
  const update = useDocumentStore((state) => state.update)
  const beginTransaction = useDocumentStore((state) => state.beginTransaction)
  const endTransaction = useDocumentStore((state) => state.endTransaction)

  const updateVariant = (mutate: (next: VehicleVariantDefinition) => void): void => {
    update((document) => {
      if ('parts' in document) return document
      mutate(document)
      return document
    })
  }

  const setBehavior = (behavior: VehicleBehavior): void => {
    updateVariant((next) => {
      const fallback = next.model ?? Object.values(next.models ?? {})[0] ?? next.id
      next.behavior = behavior
      if (behavior === 'train' || behavior === 'tram') {
        delete next.model
        next.models = defaultModels(behavior, fallback)
      } else {
        next.model = fallback
        delete next.models
      }
    })
  }

  const setItem = (mutate: (item: VariantItem) => void): void => {
    updateVariant((next) => {
      next.item ??= {}
      mutate(next.item)
    })
  }

  return (
    <aside className="right-panel panel">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">Свойства</span>
          <h2>Вариант транспорта</h2>
        </div>
        <span className="behavior-badge">{variant.behavior}</span>
      </div>
      <div className="inspector-scroll">
        <Section title="Основное" subtitle="Spawnable-конфигурация">
          <TransactionalText
            label="ID варианта"
            value={variant.id}
            hint="Стабильный идентификатор варианта"
            onChange={(value) => updateVariant((next) => {
              next.id = value
            })}
          />
          <TransactionalText
            label="Отображаемое имя"
            value={variant['display-name']}
            onChange={(value) => updateVariant((next) => {
              next['display-name'] = value
            })}
          />
          <Field label="Семейство поведения">
            <select value={variant.behavior} onChange={(event) => setBehavior(event.target.value as VehicleBehavior)}>
              <option value="car">car — автомобиль</option>
              <option value="train">train — поезд</option>
              <option value="tram">tram — трамвай</option>
              <option value="wagon">wagon — отдельный вагон</option>
            </select>
          </Field>
        </Section>

        <Section
          title={variant.model === undefined ? 'Состав моделей' : 'Визуальная модель'}
          subtitle="ID из каталога models"
        >
          {variant.model !== undefined ? (
            <TransactionalText
              label="model"
              value={variant.model}
              placeholder="car_default"
              onChange={(value) => updateVariant((next) => {
                next.model = value
              })}
            />
          ) : (
            Object.entries(variant.models ?? {}).map(([role, modelId]) => (
              <TransactionalText
                key={role}
                label={`${ROLE_LABELS[role] ?? role} (${role})`}
                value={modelId}
                onChange={(value) => updateVariant((next) => {
                  next.models ??= {}
                  next.models[role] = value
                })}
              />
            ))
          )}
        </Section>

        <Section
          title="Предмет меню"
          actions={
            <label className="inline-checkbox">
              <input
                type="checkbox"
                checked={variant.item !== undefined}
                onChange={(event) => updateVariant((next) => {
                  if (event.target.checked) {
                    next.item = {}
                  } else {
                    delete next.item
                  }
                })}
              />
              <span>Включён</span>
            </label>
          }
        >
          {variant.item === undefined ? (
            <p className="empty-state compact">Плагин применит стандартный предмет меню.</p>
          ) : (
            <>
              <TransactionalText
                label="Material предмета"
                value={variant.item.material ?? ''}
                placeholder={`По умолчанию: ${DEFAULT_VARIANT_ITEM_MATERIAL[variant.behavior]}`}
                onChange={(value) => setItem((item) => {
                  const material = value.toLocaleUpperCase('en-US').replaceAll(' ', '_')
                  if (material.length === 0) delete item.material
                  else item.material = material
                })}
              />
              <TransactionalText
                label="Название предмета"
                value={variant.item.name ?? ''}
                placeholder={`По умолчанию: ${variant['display-name']}`}
                onChange={(value) => setItem((item) => {
                  if (value.length === 0) delete item.name
                  else item.name = value
                })}
              />
              <Field label="Lore" hint="Одна строка описания на строку">
                <textarea
                  rows={4}
                  placeholder={DEFAULT_VARIANT_ITEM_LORE[variant.behavior].join('\n')}
                  value={(variant.item.lore ?? []).join('\n')}
                  onFocus={beginTransaction}
                  onChange={(event) => setItem((item) => {
                    if (event.target.value.length === 0) delete item.lore
                    else item.lore = event.target.value.split('\n')
                  })}
                  onBlur={() => {
                    setItem((item) => {
                      const lore = item.lore?.filter((line) => line.trim().length > 0)
                      if (lore === undefined || lore.length === 0) delete item.lore
                      else item.lore = lore
                    })
                    endTransaction()
                  }}
                />
              </Field>
              <div className="optional-number">
                <label className="switch-row">
                  <input
                    type="checkbox"
                    checked={variant.item['custom-model-data'] !== undefined}
                    onChange={(event) => setItem((item) => {
                      if (event.target.checked) item['custom-model-data'] = 0
                      else delete item['custom-model-data']
                    })}
                  />
                  <span>Custom Model Data</span>
                </label>
                {variant.item['custom-model-data'] !== undefined && (
                  <NumberField
                    label="Значение"
                    min={0}
                    step={1}
                    value={variant.item['custom-model-data']}
                    onChange={(value) => setItem((item) => {
                      item['custom-model-data'] = Math.round(value)
                    })}
                  />
                )}
              </div>
            </>
          )}
        </Section>

        <Section title="Меню и доступ">
          <Field label="Описание в меню" hint="Одна строка описания на строку">
            <textarea
              rows={4}
              value={(variant['menu-description'] ?? []).join('\n')}
              onFocus={beginTransaction}
              onChange={(event) => updateVariant((next) => {
                next['menu-description'] = event.target.value.split('\n')
              })}
              onBlur={() => {
                updateVariant((next) => {
                  next['menu-description'] = (next['menu-description'] ?? []).filter(
                    (line) => line.trim().length > 0
                  )
                })
                endTransaction()
              }}
            />
          </Field>
          <div className="optional-field">
            <label className="switch-row">
              <input
                type="checkbox"
                checked={variant.permission !== undefined}
                onChange={(event) => updateVariant((next) => {
                  if (event.target.checked) next.permission = `customvehicles.spawn.${next.id}`
                  else delete next.permission
                })}
              />
              <span>Требовать право доступа</span>
            </label>
            {variant.permission !== undefined && (
              <TransactionalText
                label="Permission"
                value={variant.permission}
                onChange={(value) => updateVariant((next) => {
                  next.permission = value
                })}
              />
            )}
          </div>
        </Section>
      </div>
    </aside>
  )
}
