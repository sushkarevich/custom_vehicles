export const SCHEMA_VERSION = 1 as const

export type ForwardDirection = 'positive-z' | 'negative-z'
export type PartType = 'block'
export type VehicleBehavior = 'car' | 'train' | 'tram' | 'wagon'
export type DocumentKind = 'model' | 'variant'

export interface Vector3 {
  x: number
  y: number
  z: number
}

export interface ModelPart {
  id: string
  type: PartType
  material: string
  position: Vector3
  scale: Vector3
  'rotation-degrees': Vector3
}

export interface EditorMetadata {
  'hidden-parts'?: string[]
  'locked-parts'?: string[]
}

export interface ModelDefinition {
  'schema-version': typeof SCHEMA_VERSION
  id: string
  'display-name': string
  'coordinate-system': {
    forward: ForwardDirection
  }
  interaction?: {
    offset: Vector3
    width: number
    height: number
  }
  display: {
    'interpolation-duration': number
    'teleport-duration': number
  }
  parts: ModelPart[]
  editor?: EditorMetadata
}

export interface VariantItem {
  material?: string
  name?: string
  lore?: string[]
  'custom-model-data'?: number
}

export interface VehicleVariantDefinition {
  'schema-version': typeof SCHEMA_VERSION
  id: string
  'display-name': string
  behavior: VehicleBehavior
  model?: string
  models?: Record<string, string>
  item?: VariantItem
  'menu-description'?: string[]
  permission?: string
}

export type EditorDocument = ModelDefinition | VehicleVariantDefinition

export interface ValidationIssue {
  severity: 'error' | 'warning'
  path: string
  message: string
}

export interface ParseResult<T> {
  value: T | null
  issues: ValidationIssue[]
}

export const DEFAULT_VECTOR: Readonly<Vector3> = Object.freeze({ x: 0, y: 0, z: 0 })
export const DEFAULT_VARIANT_ITEM_MATERIAL: Readonly<Record<VehicleBehavior, string>> =
  Object.freeze({
    car: 'MINECART',
    train: 'FURNACE_MINECART',
    tram: 'HOPPER_MINECART',
    wagon: 'CHEST_MINECART'
  })
export const DEFAULT_VARIANT_ITEM_LORE: Readonly<Record<VehicleBehavior, readonly string[]>> =
  Object.freeze({
    car: [
      'ПКМ по блоку — установить',
      'Пробел во время езды — гудок',
      'Shift + ПКМ — меню транспорта'
    ],
    train: [
      'ПКМ по рельсам — установить',
      'Пробел во время езды — гудок',
      'Shift + ПКМ — меню транспорта'
    ],
    tram: [
      'ПКМ по рельсам — установить',
      'Пробел во время езды — гудок',
      'Shift + ПКМ — меню транспорта'
    ],
    wagon: [
      'ПКМ по локомотиву или вагону — подцепить',
      'Shift + ПКМ с поводком — отцепить последний'
    ]
  })

export function createDefaultPart(id = 'part'): ModelPart {
  return {
    id,
    type: 'block',
    material: 'STONE',
    position: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
    'rotation-degrees': { x: 0, y: 0, z: 0 }
  }
}

export function createDefaultModel(): ModelDefinition {
  return {
    'schema-version': SCHEMA_VERSION,
    id: 'new_model',
    'display-name': 'Новая модель',
    'coordinate-system': { forward: 'positive-z' },
    interaction: {
      offset: { x: 0, y: 0.65, z: 0 },
      width: 2.2,
      height: 1.35
    },
    display: {
      'interpolation-duration': 2,
      'teleport-duration': 1
    },
    parts: [createDefaultPart('body')],
    editor: {
      'hidden-parts': [],
      'locked-parts': []
    }
  }
}

export function createDefaultVariant(): VehicleVariantDefinition {
  return {
    'schema-version': SCHEMA_VERSION,
    id: 'new_variant',
    'display-name': 'Новый транспорт',
    behavior: 'car',
    model: 'new_model',
    item: {
      material: 'MINECART',
      name: 'Новый транспорт',
      lore: []
    },
    'menu-description': []
  }
}

export function isModelDefinition(document: EditorDocument): document is ModelDefinition {
  return 'parts' in document
}

export function cloneDocument<T extends EditorDocument>(document: T): T {
  return structuredClone(document)
}
