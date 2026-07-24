import { describe, expect, it } from 'vitest'
import {
  createDefaultPart,
  createDefaultModel,
  type VehicleVariantDefinition
} from './schema'
import {
  normalizeNumber,
  parseEditorDocument,
  parseModelYaml,
  parseVariantYaml,
  serializeModelYaml,
  serializeVariantYaml
} from './yaml'

const VALID_MODEL_YAML = `schema-version: 1
id: car_default
display-name: "Стандартный автомобиль"
coordinate-system:
  forward: positive-z
interaction:
  offset: { x: 0, y: 0.65, z: 0 }
  width: 2.2
  height: 1.35
display:
  interpolation-duration: 2
  teleport-duration: 1
parts:
  - id: body
    type: block
    material: RED_CONCRETE
    position: { x: 0, y: 0.4, z: 0 }
    scale: { x: 1.7, y: 0.38, z: 3.2 }
    rotation-degrees: { x: 0, y: 15, z: 0 }
editor:
  hidden-parts: [body]
  locked-parts: []
`

describe('YAML модели', () => {
  it('разбирает корректную модель и сохраняет Unicode', () => {
    const result = parseModelYaml(VALID_MODEL_YAML)
    expect(result.issues.filter((entry) => entry.severity === 'error')).toEqual([])
    expect(result.value?.id).toBe('car_default')
    expect(result.value?.['display-name']).toBe('Стандартный автомобиль')
    expect(result.value?.parts[0]?.scale.z).toBe(3.2)
  })

  it('сериализует поля в стабильном порядке и выполняет round-trip', () => {
    const parsed = parseModelYaml(VALID_MODEL_YAML)
    expect(parsed.value).not.toBeNull()
    const yaml = serializeModelYaml(parsed.value!)
    expect(yaml.indexOf('schema-version')).toBeLessThan(yaml.indexOf('id:'))
    expect(yaml.indexOf('coordinate-system')).toBeLessThan(yaml.indexOf('parts:'))
    const roundTrip = parseModelYaml(yaml)
    expect(roundTrip.value).toEqual(parsed.value)
    expect(roundTrip.value?.editor?.['hidden-parts']).toEqual(['body'])
  })

  it('применяет безопасные значения по умолчанию к отсутствующим компонентам вектора', () => {
    const yaml = VALID_MODEL_YAML.replace('    scale: { x: 1.7, y: 0.38, z: 3.2 }', '    scale: { x: 1.7, y: 0.38 }')
    const result = parseModelYaml(yaml)
    expect(result.value?.parts[0]?.scale.z).toBe(1)
    expect(result.issues.filter((entry) => entry.severity === 'error')).toEqual([])
  })

  it('поддерживает canonical defaults и необязательный Interaction', () => {
    const result = parseModelYaml(`schema-version: 1
id: minimal_model
display-name: Минимальная модель
parts:
  - id: body
    material: STONE
    position: {}
    scale: {}
`)
    expect(result.issues.filter((entry) => entry.severity === 'error')).toEqual([])
    expect(result.value?.['coordinate-system'].forward).toBe('positive-z')
    expect(result.value?.display).toEqual({
      'interpolation-duration': 2,
      'teleport-duration': 1
    })
    expect(result.value?.interaction).toBeUndefined()
    expect(result.value?.parts[0]?.position).toEqual({ x: 0, y: 0, z: 0 })
    expect(result.value?.parts[0]?.scale).toEqual({ x: 1, y: 1, z: 1 })
    expect(result.value?.parts[0]?.['rotation-degrees']).toEqual({ x: 0, y: 0, z: 0 })
    expect(parseModelYaml(serializeModelYaml(result.value!)).value?.interaction).toBeUndefined()
  })

  it('требует position/scale и размеры присутствующего Interaction', () => {
    const missingPosition = parseModelYaml(
      VALID_MODEL_YAML.replace('    position: { x: 0, y: 0.4, z: 0 }\n', '')
    )
    expect(missingPosition.issues).toContainEqual(
      expect.objectContaining({ path: 'parts[0].position', severity: 'error' })
    )
    const missingWidth = parseModelYaml(
      VALID_MODEL_YAML.replace('  width: 2.2\n', '')
    )
    expect(missingWidth.issues).toContainEqual(
      expect.objectContaining({ path: 'interaction.width', severity: 'error' })
    )
  })

  it('применяет canonical пределы масштаба и вращения', () => {
    const tinyScale = parseModelYaml(
      VALID_MODEL_YAML.replace('x: 1.7, y: 0.38, z: 3.2', 'x: 0.00009, y: 0.38, z: 3.2')
    )
    expect(tinyScale.issues).toContainEqual(
      expect.objectContaining({ path: 'parts[0].scale.x', severity: 'error' })
    )
    const excessiveRotation = parseModelYaml(
      VALID_MODEL_YAML.replace('x: 0, y: 15, z: 0', 'x: 0, y: 360001, z: 0')
    )
    expect(excessiveRotation.issues).toContainEqual(
      expect.objectContaining({ path: 'parts[0].rotation-degrees.y', severity: 'error' })
    )
  })

  it('ограничивает модель 512 деталями', () => {
    const model = createDefaultModel()
    model.parts = Array.from({ length: 513 }, (_unused, index) =>
      createDefaultPart(`part_${index}`)
    )
    const result = parseModelYaml(serializeModelYaml(model))
    expect(result.issues).toContainEqual(
      expect.objectContaining({ path: 'parts', severity: 'error' })
    )
  })

  it('отклоняет неизвестный материал, дубликаты, пустые детали и версию схемы', () => {
    const unknown = parseModelYaml(VALID_MODEL_YAML.replace('RED_CONCRETE', 'FAKE_BLOCK'))
    expect(unknown.issues).toContainEqual(
      expect.objectContaining({ path: 'parts[0].material', severity: 'error' })
    )

    const duplicate = parseModelYaml(
      VALID_MODEL_YAML.replace(
        'editor:',
        `  - id: body
    type: block
    material: STONE
    position: { x: 0, y: 0, z: 0 }
    scale: { x: 1, y: 1, z: 1 }
    rotation-degrees: { x: 0, y: 0, z: 0 }
editor:`
      )
    )
    expect(duplicate.issues).toContainEqual(
      expect.objectContaining({ path: 'parts[1].id', severity: 'error' })
    )

    const emptyModel = createDefaultModel()
    emptyModel.parts = []
    const empty = parseModelYaml(serializeModelYaml(emptyModel))
    expect(empty.issues).toContainEqual(
      expect.objectContaining({ path: 'parts', severity: 'error' })
    )

    const unsupported = parseModelYaml(VALID_MODEL_YAML.replace('schema-version: 1', 'schema-version: 2'))
    expect(unsupported.issues).toContainEqual(
      expect.objectContaining({ path: 'schema-version', severity: 'error' })
    )
  })

  it('отключает YAML aliases', () => {
    const aliased = VALID_MODEL_YAML.replace(
      'position: { x: 0, y: 0.4, z: 0 }',
      'position: &point { x: 0, y: 0.4, z: 0 }'
    ).replace(
      'rotation-degrees: { x: 0, y: 15, z: 0 }',
      'rotation-degrees: *point'
    )
    const result = parseModelYaml(aliased)
    expect(result.value).toBeNull()
    expect(result.issues[0]?.message).toContain('YAML')
  })

  it('нормализует дробные числа и отрицательный ноль', () => {
    expect(normalizeNumber(1.23456789)).toBe(1.234568)
    expect(Object.is(normalizeNumber(-0), -0)).toBe(false)
  })
})

describe('YAML варианта транспорта', () => {
  it('разбирает одиночный автомобиль и нормализует скалярное описание', () => {
    const result = parseVariantYaml(
      `schema-version: 1
id: car_default
display-name: Стандартный автомобиль
behavior: car
model: car_default
item:
  material: MINECART
  name: Стандартный автомобиль
  lore: Доступен всем
  custom-model-data: 12
menu-description: Городской автомобиль
permission: customvehicles.spawn.car
`,
      new Set(['car_default'])
    )
    expect(result.issues.filter((entry) => entry.severity === 'error')).toEqual([])
    expect(result.value?.['menu-description']).toEqual(['Городской автомобиль'])
    expect(result.value?.item?.lore).toEqual(['Доступен всем'])
    const yaml = serializeVariantYaml(result.value!)
    expect(parseVariantYaml(yaml, new Set(['car_default'])).value).toEqual(result.value)
  })

  it('проверяет роли состава и ссылки на модели', () => {
    const variant: VehicleVariantDefinition = {
      'schema-version': 1,
      id: 'metro_717',
      'display-name': 'Метропоезд 81-717',
      behavior: 'train',
      models: {
        locomotive: 'metro_717_head',
        wagon: 'metro_714_wagon'
      }
    }
    const result = parseVariantYaml(
      serializeVariantYaml(variant),
      new Set(['metro_717_head'])
    )
    expect(result.issues).toContainEqual(
      expect.objectContaining({ path: 'models.wagon', severity: 'error' })
    )
  })

  it('требует singular model для car/wagon и role map для train/tram', () => {
    const wrongCar = parseVariantYaml(`schema-version: 1
id: bad_car
display-name: Плохой автомобиль
behavior: car
models:
  body: car_default
`)
    expect(wrongCar.issues).toContainEqual(
      expect.objectContaining({ path: 'model', severity: 'error' })
    )

    const wrongTram = parseVariantYaml(`schema-version: 1
id: bad_tram
display-name: Неполный трамвай
behavior: tram
models:
  front: vityaz_m_front
`)
    expect(wrongTram.issues.map((entry) => entry.path)).toEqual(
      expect.arrayContaining(['models.middle', 'models.rear'])
    )
  })

  it('автоматически определяет тип документа', () => {
    expect(parseEditorDocument(VALID_MODEL_YAML).value).toHaveProperty('parts')
    const variant = serializeVariantYaml({
      'schema-version': 1,
      id: 'metro_714_wagon',
      'display-name': 'Вагон',
      behavior: 'wagon',
      model: 'metro_714_wagon'
    })
    expect(parseEditorDocument(variant).value).toHaveProperty('behavior', 'wagon')
  })

  it('сохраняет item с individually optional полями и проверяет permission', () => {
    const result = parseVariantYaml(`schema-version: 1
id: car_default
display-name: Стандартный автомобиль
behavior: car
model: car_default
item: {}
`)
    expect(result.issues.filter((entry) => entry.severity === 'error')).toEqual([])
    expect(result.value?.item).toEqual({})
    expect(parseVariantYaml(serializeVariantYaml(result.value!)).value?.item).toEqual({})

    const invalidPermission = parseVariantYaml(`schema-version: 1
id: car_default
display-name: Стандартный автомобиль
behavior: car
model: car_default
permission: "bad permission!"
`)
    expect(invalidPermission.issues).toContainEqual(
      expect.objectContaining({ path: 'permission', severity: 'error' })
    )
  })
})
