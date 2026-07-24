import { parse, stringify } from 'yaml'
import {
  SCHEMA_VERSION,
  type EditorDocument,
  type EditorMetadata,
  type ModelDefinition,
  type ModelPart,
  type ParseResult,
  type ValidationIssue,
  type VariantItem,
  type Vector3,
  type VehicleBehavior,
  type VehicleVariantDefinition
} from './schema'
import { validateModel, validateVariant } from './validation'

type UnknownRecord = Record<string, unknown>

const MODEL_ROOT_FIELDS = new Set([
  'schema-version',
  'id',
  'display-name',
  'coordinate-system',
  'interaction',
  'display',
  'parts',
  'editor'
])
const VARIANT_ROOT_FIELDS = new Set([
  'schema-version',
  'id',
  'display-name',
  'behavior',
  'model',
  'models',
  'item',
  'menu-description',
  'permission'
])

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function issue(
  issues: ValidationIssue[],
  severity: ValidationIssue['severity'],
  path: string,
  message: string
): void {
  issues.push({ severity, path, message })
}

function stringValue(
  record: UnknownRecord,
  key: string,
  path: string,
  issues: ValidationIssue[],
  fallback = ''
): string {
  const value = record[key]
  if (typeof value === 'string') return value
  issue(issues, 'error', path, `Ожидалась строка, получено ${value === null ? 'null' : typeof value}`)
  return fallback
}

function optionalStringValue(
  record: UnknownRecord,
  key: string,
  path: string,
  issues: ValidationIssue[],
  fallback: string
): string {
  return record[key] === undefined ? fallback : stringValue(record, key, path, issues, fallback)
}

function numberValue(
  record: UnknownRecord,
  key: string,
  path: string,
  issues: ValidationIssue[],
  fallback: number
): number {
  const value = record[key]
  if (typeof value === 'number') return normalizeNumber(value)
  issue(issues, 'error', path, 'Ожидалось число')
  return fallback
}

function optionalNumberValue(
  record: UnknownRecord,
  key: string,
  path: string,
  issues: ValidationIssue[],
  fallback: number
): number {
  return record[key] === undefined ? fallback : numberValue(record, key, path, issues, fallback)
}

function integerValue(
  record: UnknownRecord,
  key: string,
  path: string,
  issues: ValidationIssue[],
  fallback: number
): number {
  const value = numberValue(record, key, path, issues, fallback)
  return value
}

function recordValue(
  record: UnknownRecord,
  key: string,
  path: string,
  issues: ValidationIssue[],
  fallback: UnknownRecord = {}
): UnknownRecord {
  const value = record[key]
  if (isRecord(value)) return value
  issue(issues, 'error', path, 'Ожидался объект')
  return fallback
}

function optionalRecordValue(
  record: UnknownRecord,
  key: string,
  path: string,
  issues: ValidationIssue[]
): UnknownRecord | undefined {
  const value = record[key]
  if (value === undefined) return undefined
  if (isRecord(value)) return value
  issue(issues, 'error', path, 'Ожидался объект')
  return {}
}

function vectorFromRecord(
  vector: UnknownRecord,
  path: string,
  issues: ValidationIssue[],
  fallback: Vector3
): Vector3 {
  return {
    x: optionalNumberValue(vector, 'x', `${path}.x`, issues, fallback.x),
    y: optionalNumberValue(vector, 'y', `${path}.y`, issues, fallback.y),
    z: optionalNumberValue(vector, 'z', `${path}.z`, issues, fallback.z)
  }
}

function requiredVectorValue(
  record: UnknownRecord,
  key: string,
  path: string,
  issues: ValidationIssue[],
  fallback: Vector3
): Vector3 {
  const vector = recordValue(record, key, path, issues)
  return vectorFromRecord(vector, path, issues, fallback)
}

function optionalVectorValue(
  record: UnknownRecord,
  key: string,
  path: string,
  issues: ValidationIssue[],
  fallback: Vector3
): Vector3 {
  const vector = optionalRecordValue(record, key, path, issues)
  return vector === undefined ? fallback : vectorFromRecord(vector, path, issues, fallback)
}

function stringListValue(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
  acceptScalar: boolean
): string[] {
  if (acceptScalar && typeof value === 'string') return [value]
  if (!Array.isArray(value)) {
    issue(issues, 'error', path, 'Ожидался список строк')
    return []
  }
  const result: string[] = []
  value.forEach((entry, index) => {
    if (typeof entry === 'string') {
      result.push(entry)
    } else {
      issue(issues, 'error', `${path}[${index}]`, 'Ожидалась строка')
    }
  })
  return result
}

function versionValue(root: UnknownRecord, issues: ValidationIssue[]): 1 {
  const value = root['schema-version']
  if (value !== SCHEMA_VERSION) {
    issue(
      issues,
      'error',
      'schema-version',
      `Неподдерживаемая версия схемы: ${String(value)}; ожидается ${SCHEMA_VERSION}`
    )
  }
  return SCHEMA_VERSION
}

function unknownFieldWarnings(
  root: UnknownRecord,
  allowed: ReadonlySet<string>,
  issues: ValidationIssue[]
): void {
  Object.keys(root).forEach((key) => {
    if (!allowed.has(key)) {
      issue(issues, 'warning', key, `Неизвестное поле "${key}" не будет сохранено`)
    }
  })
}

function partValue(value: unknown, index: number, issues: ValidationIssue[]): ModelPart {
  const path = `parts[${index}]`
  if (!isRecord(value)) {
    issue(issues, 'error', path, 'Ожидался объект детали')
    return {
      id: `part_${index + 1}`,
      type: 'block',
      material: '',
      position: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
      'rotation-degrees': { x: 0, y: 0, z: 0 }
    }
  }
  const type = optionalStringValue(value, 'type', `${path}.type`, issues, 'block')
  return {
    id: stringValue(value, 'id', `${path}.id`, issues),
    type: type === 'block' ? 'block' : (type as 'block'),
    material: stringValue(value, 'material', `${path}.material`, issues),
    position: requiredVectorValue(value, 'position', `${path}.position`, issues, { x: 0, y: 0, z: 0 }),
    scale: requiredVectorValue(value, 'scale', `${path}.scale`, issues, { x: 1, y: 1, z: 1 }),
    'rotation-degrees': optionalVectorValue(
      value,
      'rotation-degrees',
      `${path}.rotation-degrees`,
      issues,
      { x: 0, y: 0, z: 0 }
    )
  }
}

function editorValue(value: unknown, issues: ValidationIssue[]): EditorMetadata | undefined {
  if (value === undefined) return undefined
  if (!isRecord(value)) {
    issue(issues, 'error', 'editor', 'Ожидался объект метаданных редактора')
    return undefined
  }
  const editor: EditorMetadata = {}
  if (value['hidden-parts'] !== undefined) {
    editor['hidden-parts'] = stringListValue(value['hidden-parts'], 'editor.hidden-parts', issues, false)
  }
  if (value['locked-parts'] !== undefined) {
    editor['locked-parts'] = stringListValue(value['locked-parts'], 'editor.locked-parts', issues, false)
  }
  Object.keys(value).forEach((key) => {
    if (!['hidden-parts', 'locked-parts'].includes(key)) {
      issue(issues, 'warning', `editor.${key}`, `Неизвестное поле метаданных "${key}" не будет сохранено`)
    }
  })
  return editor
}

function parseYamlRoot(text: string): ParseResult<UnknownRecord> {
  const issues: ValidationIssue[] = []
  try {
    const parsed: unknown = parse(text, {
      maxAliasCount: 0,
      merge: false,
      prettyErrors: true,
      uniqueKeys: true
    })
    if (!isRecord(parsed)) {
      issue(issues, 'error', '$', 'Корень YAML должен быть объектом')
      return { value: null, issues }
    }
    return { value: parsed, issues }
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : String(caught)
    issue(issues, 'error', '$', `Ошибка YAML: ${message}`)
    return { value: null, issues }
  }
}

function uniqueIssues(issues: ValidationIssue[]): ValidationIssue[] {
  const seen = new Set<string>()
  return issues.filter((entry) => {
    const key = `${entry.severity}\0${entry.path}\0${entry.message}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export function parseModelYaml(
  text: string,
  knownMaterials?: ReadonlySet<string>
): ParseResult<ModelDefinition> {
  const parsed = parseYamlRoot(text)
  if (parsed.value === null) return { value: null, issues: parsed.issues }
  const root = parsed.value
  const issues = parsed.issues
  unknownFieldWarnings(root, MODEL_ROOT_FIELDS, issues)
  const coordinateSystem =
    optionalRecordValue(root, 'coordinate-system', 'coordinate-system', issues) ?? {}
  const interaction = optionalRecordValue(root, 'interaction', 'interaction', issues)
  const display = optionalRecordValue(root, 'display', 'display', issues) ?? {}
  const partsValue = root.parts
  if (!Array.isArray(partsValue)) issue(issues, 'error', 'parts', 'Ожидался список деталей')
  const forward = optionalStringValue(
    coordinateSystem,
    'forward',
    'coordinate-system.forward',
    issues,
    'positive-z'
  )
  const editor = editorValue(root.editor, issues)
  const model: ModelDefinition = {
    'schema-version': versionValue(root, issues),
    id: stringValue(root, 'id', 'id', issues),
    'display-name': stringValue(root, 'display-name', 'display-name', issues),
    'coordinate-system': {
      forward: forward === 'negative-z' ? 'negative-z' : (forward as 'positive-z')
    },
    ...(interaction === undefined
      ? {}
      : {
          interaction: {
            offset: optionalVectorValue(
              interaction,
              'offset',
              'interaction.offset',
              issues,
              { x: 0, y: 0, z: 0 }
            ),
            width: numberValue(interaction, 'width', 'interaction.width', issues, 1),
            height: numberValue(interaction, 'height', 'interaction.height', issues, 1)
          }
        }),
    display: {
      'interpolation-duration': optionalNumberValue(
        display,
        'interpolation-duration',
        'display.interpolation-duration',
        issues,
        2
      ),
      'teleport-duration': optionalNumberValue(
        display,
        'teleport-duration',
        'display.teleport-duration',
        issues,
        1
      )
    },
    parts: Array.isArray(partsValue) ? partsValue.map((part, index) => partValue(part, index, issues)) : [],
    ...(editor === undefined ? {} : { editor })
  }
  issues.push(...validateModel(model, knownMaterials))
  return { value: model, issues: uniqueIssues(issues) }
}

function modelsValue(value: unknown, issues: ValidationIssue[]): Record<string, string> | undefined {
  if (value === undefined) return undefined
  if (!isRecord(value)) {
    issue(issues, 'error', 'models', 'Ожидался объект ролей модели')
    return {}
  }
  const models: Record<string, string> = {}
  Object.entries(value).forEach(([role, modelId]) => {
    if (typeof modelId === 'string') {
      models[role] = modelId
    } else {
      issue(issues, 'error', `models.${role}`, 'ID модели должен быть строкой')
    }
  })
  return models
}

function itemValue(value: unknown, issues: ValidationIssue[]): VariantItem | undefined {
  if (value === undefined) return undefined
  if (!isRecord(value)) {
    issue(issues, 'error', 'item', 'Ожидался объект предмета')
    return undefined
  }
  const customModelData =
    value['custom-model-data'] === undefined
      ? undefined
      : integerValue(value, 'custom-model-data', 'item.custom-model-data', issues, 0)
  const material =
    value.material === undefined ? undefined : stringValue(value, 'material', 'item.material', issues)
  const name = value.name === undefined ? undefined : stringValue(value, 'name', 'item.name', issues)
  const lore =
    value.lore === undefined ? undefined : stringListValue(value.lore, 'item.lore', issues, true)
  return {
    ...(material === undefined ? {} : { material }),
    ...(name === undefined ? {} : { name }),
    ...(lore === undefined ? {} : { lore }),
    ...(customModelData === undefined ? {} : { 'custom-model-data': customModelData })
  }
}

export function parseVariantYaml(
  text: string,
  knownModelIds?: ReadonlySet<string>
): ParseResult<VehicleVariantDefinition> {
  const parsed = parseYamlRoot(text)
  if (parsed.value === null) return { value: null, issues: parsed.issues }
  const root = parsed.value
  const issues = parsed.issues
  unknownFieldWarnings(root, VARIANT_ROOT_FIELDS, issues)
  const behaviorValue = stringValue(root, 'behavior', 'behavior', issues, 'car')
  const model = root.model === undefined ? undefined : stringValue(root, 'model', 'model', issues)
  const models = modelsValue(root.models, issues)
  const item = itemValue(root.item, issues)
  const menuDescription =
    root['menu-description'] === undefined
      ? undefined
      : stringListValue(root['menu-description'], 'menu-description', issues, true)
  const permission =
    root.permission === undefined ? undefined : stringValue(root, 'permission', 'permission', issues)
  const variant: VehicleVariantDefinition = {
    'schema-version': versionValue(root, issues),
    id: stringValue(root, 'id', 'id', issues),
    'display-name': stringValue(root, 'display-name', 'display-name', issues),
    behavior: behaviorValue as VehicleBehavior,
    ...(model === undefined ? {} : { model }),
    ...(models === undefined ? {} : { models }),
    ...(item === undefined ? {} : { item }),
    ...(menuDescription === undefined ? {} : { 'menu-description': menuDescription }),
    ...(permission === undefined ? {} : { permission })
  }
  issues.push(...validateVariant(variant, knownModelIds))
  return { value: variant, issues: uniqueIssues(issues) }
}

export function parseEditorDocument(
  text: string,
  kind?: 'model' | 'variant',
  options?: {
    knownMaterials?: ReadonlySet<string>
    knownModelIds?: ReadonlySet<string>
  }
): ParseResult<EditorDocument> {
  if (kind === 'model') return parseModelYaml(text, options?.knownMaterials)
  if (kind === 'variant') return parseVariantYaml(text, options?.knownModelIds)
  const root = parseYamlRoot(text)
  if (root.value === null) return { value: null, issues: root.issues }
  return 'behavior' in root.value
    ? parseVariantYaml(text, options?.knownModelIds)
    : parseModelYaml(text, options?.knownMaterials)
}

export function normalizeNumber(value: number): number {
  if (!Number.isFinite(value)) return value
  const normalized = Number(value.toFixed(6))
  return Object.is(normalized, -0) ? 0 : normalized
}

function normalizeVector(vector: Vector3): Vector3 {
  return {
    x: normalizeNumber(vector.x),
    y: normalizeNumber(vector.y),
    z: normalizeNumber(vector.z)
  }
}

function orderedModel(model: ModelDefinition): UnknownRecord {
  return {
    'schema-version': SCHEMA_VERSION,
    id: model.id,
    'display-name': model['display-name'],
    'coordinate-system': {
      forward: model['coordinate-system'].forward
    },
    ...(model.interaction === undefined
      ? {}
      : {
          interaction: {
            offset: normalizeVector(model.interaction.offset),
            width: normalizeNumber(model.interaction.width),
            height: normalizeNumber(model.interaction.height)
          }
        }),
    display: {
      'interpolation-duration': normalizeNumber(model.display['interpolation-duration']),
      'teleport-duration': normalizeNumber(model.display['teleport-duration'])
    },
    parts: model.parts.map((part) => ({
      id: part.id,
      type: part.type,
      material: part.material,
      position: normalizeVector(part.position),
      scale: normalizeVector(part.scale),
      'rotation-degrees': normalizeVector(part['rotation-degrees'])
    })),
    ...(model.editor === undefined
      ? {}
      : {
          editor: {
            ...(model.editor['hidden-parts'] === undefined
              ? {}
              : { 'hidden-parts': model.editor['hidden-parts'] }),
            ...(model.editor['locked-parts'] === undefined
              ? {}
              : { 'locked-parts': model.editor['locked-parts'] })
          }
        })
  }
}

function orderedVariant(variant: VehicleVariantDefinition): UnknownRecord {
  return {
    'schema-version': SCHEMA_VERSION,
    id: variant.id,
    'display-name': variant['display-name'],
    behavior: variant.behavior,
    ...(variant.model === undefined ? {} : { model: variant.model }),
    ...(variant.models === undefined ? {} : { models: { ...variant.models } }),
    ...(variant.item === undefined
      ? {}
      : {
          item: {
            ...(variant.item.material === undefined ? {} : { material: variant.item.material }),
            ...(variant.item.name === undefined ? {} : { name: variant.item.name }),
            ...(variant.item.lore === undefined ? {} : { lore: variant.item.lore }),
            ...(variant.item['custom-model-data'] === undefined
              ? {}
              : { 'custom-model-data': variant.item['custom-model-data'] })
          }
        }),
    ...(variant['menu-description'] === undefined
      ? {}
      : { 'menu-description': variant['menu-description'] }),
    ...(variant.permission === undefined ? {} : { permission: variant.permission })
  }
}

export function serializeModelYaml(model: ModelDefinition): string {
  return stringify(orderedModel(model), {
    indent: 2,
    lineWidth: 0,
    minContentWidth: 0,
    defaultStringType: 'PLAIN',
    defaultKeyType: 'PLAIN'
  })
}

export function serializeVariantYaml(variant: VehicleVariantDefinition): string {
  return stringify(orderedVariant(variant), {
    indent: 2,
    lineWidth: 0,
    minContentWidth: 0,
    defaultStringType: 'PLAIN',
    defaultKeyType: 'PLAIN'
  })
}

export function serializeEditorDocument(document: EditorDocument): string {
  return 'parts' in document ? serializeModelYaml(document) : serializeVariantYaml(document)
}
