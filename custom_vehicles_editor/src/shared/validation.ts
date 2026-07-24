import { BLOCK_MATERIAL_SET } from './materials'
import {
  SCHEMA_VERSION,
  type ModelDefinition,
  type ModelPart,
  type ValidationIssue,
  type Vector3,
  type VehicleVariantDefinition
} from './schema'

const ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/
const MATERIAL_PATTERN = /^[A-Z][A-Z0-9_]*$/
const MAX_PARTS = 512
const MAX_COORDINATE = 256
const MAX_SCALE = 64
const MIN_SCALE = 0.0001
const MAX_ROTATION = 360_000
const MAX_HITBOX = 64
const MAX_DURATION = 59
const ALLOWED_BEHAVIORS = new Set(['car', 'train', 'tram', 'wagon'])
const PERMISSION_PATTERN = /^[A-Za-z0-9_.-]{1,128}$/

function error(path: string, message: string): ValidationIssue {
  return { severity: 'error', path, message }
}

function validateId(value: string, path: string, label: string): ValidationIssue[] {
  if (value.length === 0) {
    return [error(path, `${label} не может быть пустым`)]
  }
  if (!ID_PATTERN.test(value)) {
    return [error(path, `${label} должен содержать только a-z, 0-9, "_" и "-"`)]
  }
  return []
}

function validateVector(
  vector: Vector3,
  path: string,
  options: { minimum?: number; max: number }
): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  for (const axis of ['x', 'y', 'z'] as const) {
    const value = vector[axis]
    if (!Number.isFinite(value)) {
      issues.push(error(`${path}.${axis}`, 'Значение должно быть конечным числом'))
    } else if (options.minimum !== undefined && value < options.minimum) {
      issues.push(error(`${path}.${axis}`, `Значение должно быть не меньше ${options.minimum}`))
    } else if (Math.abs(value) > options.max) {
      issues.push(error(`${path}.${axis}`, `Значение должно быть не больше ${options.max} по модулю`))
    }
  }
  return issues
}

function validatePart(
  part: ModelPart,
  index: number,
  knownMaterials: ReadonlySet<string>
): ValidationIssue[] {
  const path = `parts[${index}]`
  const issues = validateId(part.id, `${path}.id`, 'ID детали')
  if (part.type !== 'block') {
    issues.push(error(`${path}.type`, 'Поддерживается только тип block'))
  }
  if (!MATERIAL_PATTERN.test(part.material)) {
    issues.push(error(`${path}.material`, 'Материал должен быть идентификатором Bukkit Material'))
  } else if (!knownMaterials.has(part.material)) {
    issues.push(error(`${path}.material`, `Неизвестный блочный материал: ${part.material}`))
  }
  issues.push(...validateVector(part.position, `${path}.position`, { max: MAX_COORDINATE }))
  issues.push(
    ...validateVector(part.scale, `${path}.scale`, {
      max: MAX_SCALE,
      minimum: MIN_SCALE
    })
  )
  issues.push(
    ...validateVector(part['rotation-degrees'], `${path}.rotation-degrees`, {
      max: MAX_ROTATION
    })
  )
  return issues
}

export function validateModel(
  model: ModelDefinition,
  knownMaterials: ReadonlySet<string> = BLOCK_MATERIAL_SET
): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  if (model['schema-version'] !== SCHEMA_VERSION) {
    issues.push(error('schema-version', 'Поддерживается только версия схемы 1'))
  }
  issues.push(...validateId(model.id, 'id', 'ID модели'))
  if (model['display-name'].trim().length === 0) {
    issues.push(error('display-name', 'Название модели не может быть пустым'))
  }
  if (!['positive-z', 'negative-z'].includes(model['coordinate-system'].forward)) {
    issues.push(
      error(
        'coordinate-system.forward',
        `Направление ${String(model['coordinate-system'].forward)} должно быть positive-z или negative-z`
      )
    )
  }
  if (model.interaction !== undefined) {
    issues.push(...validateVector(model.interaction.offset, 'interaction.offset', { max: MAX_COORDINATE }))
    for (const field of ['width', 'height'] as const) {
      const value = model.interaction[field]
      if (!Number.isFinite(value) || value < 0.01 || value > MAX_HITBOX) {
        issues.push(error(`interaction.${field}`, `Значение должно быть от 0.01 до ${MAX_HITBOX}`))
      }
    }
  }
  for (const field of ['interpolation-duration', 'teleport-duration'] as const) {
    const value = model.display[field]
    if (!Number.isInteger(value) || value < 0 || value > MAX_DURATION) {
      issues.push(error(`display.${field}`, `Значение должно быть целым от 0 до ${MAX_DURATION}`))
    }
  }
  if (model.parts.length > MAX_PARTS) {
    issues.push(error('parts', `Модель не может содержать больше ${MAX_PARTS} деталей`))
  }
  if (model.parts.length === 0) {
    issues.push(error('parts', 'Модель должна содержать хотя бы одну деталь'))
  }
  const seenPartIds = new Set<string>()
  model.parts.forEach((part, index) => {
    issues.push(...validatePart(part, index, knownMaterials))
    if (seenPartIds.has(part.id)) {
      issues.push(error(`parts[${index}].id`, `Повторяющийся ID детали: ${part.id}`))
    }
    seenPartIds.add(part.id)
  })
  const partIds = new Set(model.parts.map((part) => part.id))
  for (const [metadataKey, ids] of [
    ['hidden-parts', model.editor?.['hidden-parts']],
    ['locked-parts', model.editor?.['locked-parts']]
  ] as const) {
    ids?.forEach((id, index) => {
      if (!partIds.has(id)) {
        issues.push({
          severity: 'warning',
          path: `editor.${metadataKey}[${index}]`,
          message: `Метаданные ссылаются на отсутствующую деталь: ${id}`
        })
      }
    })
  }
  return issues
}

function validateModelReference(value: string, path: string, knownModelIds?: ReadonlySet<string>): ValidationIssue[] {
  const issues = validateId(value, path, 'ID модели')
  if (knownModelIds !== undefined && value.length > 0 && !knownModelIds.has(value)) {
    issues.push(error(path, `Модель не найдена: ${value}`))
  }
  return issues
}

export function validateVariant(
  variant: VehicleVariantDefinition,
  knownModelIds?: ReadonlySet<string>
): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  if (variant['schema-version'] !== SCHEMA_VERSION) {
    issues.push(error('schema-version', 'Поддерживается только версия схемы 1'))
  }
  issues.push(...validateId(variant.id, 'id', 'ID варианта'))
  if (variant['display-name'].trim().length === 0) {
    issues.push(error('display-name', 'Название варианта не может быть пустым'))
  }
  if (!ALLOWED_BEHAVIORS.has(variant.behavior)) {
    issues.push(
      error(
        'behavior',
        `Поведение ${String(variant.behavior)} должно быть car, train, tram или wagon`
      )
    )
  }
  const hasModel = variant.model !== undefined
  const hasModels = variant.models !== undefined
  const requiresComposition = variant.behavior === 'train' || variant.behavior === 'tram'
  if (requiresComposition && (hasModel || !hasModels)) {
    issues.push(error('models', `Для поведения ${variant.behavior} требуется поле models без поля model`))
  }
  if (!requiresComposition && (!hasModel || hasModels)) {
    issues.push(error('model', `Для поведения ${variant.behavior} требуется поле model без поля models`))
  }
  if (variant.model !== undefined) {
    issues.push(...validateModelReference(variant.model, 'model', knownModelIds))
  }
  if (variant.models !== undefined) {
    const entries = Object.entries(variant.models)
    if (entries.length === 0) {
      issues.push(error('models', 'Композиция должна содержать хотя бы одну роль'))
    }
    for (const [role, modelId] of entries) {
      issues.push(...validateId(role, `models.${role}`, 'Название роли'))
      issues.push(...validateModelReference(modelId, `models.${role}`, knownModelIds))
    }
    const requiredRoles =
      variant.behavior === 'train'
        ? ['locomotive', 'wagon']
        : variant.behavior === 'tram'
          ? ['front', 'middle', 'rear']
          : []
    requiredRoles.forEach((role) => {
      if (!(role in variant.models!)) {
        issues.push(error(`models.${role}`, `Для поведения ${variant.behavior} требуется роль ${role}`))
      }
    })
  }
  if (variant.item !== undefined) {
    if (
      variant.item.material !== undefined &&
      !MATERIAL_PATTERN.test(variant.item.material)
    ) {
      issues.push(error('item.material', 'Материал предмета должен быть идентификатором Bukkit Material'))
    }
    if (variant.item.name !== undefined && variant.item.name.trim().length === 0) {
      issues.push(error('item.name', 'Название предмета не может быть пустым'))
    }
    variant.item.lore?.forEach((line, index) => {
      if (line.trim().length === 0) {
        issues.push(error(`item.lore[${index}]`, 'Строка lore не может быть пустой'))
      }
    })
    const customModelData = variant.item['custom-model-data']
    if (customModelData !== undefined && (!Number.isInteger(customModelData) || customModelData < 0)) {
      issues.push(error('item.custom-model-data', 'Custom Model Data должен быть неотрицательным целым'))
    }
  }
  if (variant.permission !== undefined && !PERMISSION_PATTERN.test(variant.permission)) {
    issues.push(
      error(
        'permission',
        'Permission должен содержать 1–128 символов A-Z, a-z, 0-9, _, . или -'
      )
    )
  }
  variant['menu-description']?.forEach((line, index) => {
    if (line.trim().length === 0) {
      issues.push(error(`menu-description[${index}]`, 'Строка описания меню не может быть пустой'))
    }
  })
  return issues
}

export function hasValidationErrors(issues: readonly ValidationIssue[]): boolean {
  return issues.some((issue) => issue.severity === 'error')
}
