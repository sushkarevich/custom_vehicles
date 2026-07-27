export const RESOURCE_PREVIEW_SETTINGS_VERSION = 1 as const
export const VANILLA_RESOURCE_PACK_ID = 'vanilla-minecraft' as const
export const PREFERRED_MINECRAFT_VERSION = '1.21.1' as const

export const RESOURCE_PACK_TYPES = ['directory', 'zip'] as const
export type ResourcePackType = (typeof RESOURCE_PACK_TYPES)[number]

export const RESOURCE_TEXTURE_FACES = [
  'all',
  'top',
  'bottom',
  'north',
  'south',
  'east',
  'west'
] as const
export type ResourceTextureFace = (typeof RESOURCE_TEXTURE_FACES)[number]
export type ResolvedCubeFace = Exclude<ResourceTextureFace, 'all'>

export const RESOURCE_PREVIEW_MODES = ['textures', 'colors'] as const
export type ResourcePreviewMode = (typeof RESOURCE_PREVIEW_MODES)[number]

export type ResourceDiagnosticSeverity = 'info' | 'warning' | 'error'

export interface ResourceDiagnostic {
  severity: ResourceDiagnosticSeverity
  code: string
  message: string
  path?: string
}

export interface ResourcePackMetadata {
  packFormat: number | null
  description: string
}

export interface ResourcePackView {
  id: string
  type: ResourcePackType
  sourcePath: string
  name: string
  enabled: boolean
  missing: boolean
  scanning: boolean
  metadata: ResourcePackMetadata | null
  diagnostics: ResourceDiagnostic[]
}

export type VanillaMinecraftSourceKind = 'automatic' | 'manual'

export interface DetectedMinecraftVersion {
  id: string
  version: string
  jarPath: string
  releaseType: string | null
  compatible: boolean
  preferred: boolean
  metadataAvailable: boolean
}

export interface VanillaMinecraftView {
  enabled: boolean
  sourceKind: VanillaMinecraftSourceKind | null
  sourcePath: string | null
  version: string | null
  missing: boolean
  scanning: boolean
  ready: boolean
  cacheReused: boolean
  detectedVersions: DetectedMinecraftVersion[]
  diagnostics: ResourceDiagnostic[]
}

export interface ManualTextureView {
  material: string
  face: ResourceTextureFace
  assetToken: string
  originalName: string
  width: number
  height: number
}

export interface ResourcePreviewState {
  version: typeof RESOURCE_PREVIEW_SETTINGS_VERSION
  revision: number
  mode: ResourcePreviewMode
  packs: ResourcePackView[]
  vanilla: VanillaMinecraftView
  manualTextures: ManualTextureView[]
}

export interface ResourceScanProgress {
  packId: string
  phase: 'indexing' | 'copying' | 'complete'
  processed: number
  total: number | null
}

export type ResourcePreviewEvent =
  | { type: 'state'; state: ResourcePreviewState }
  | { type: 'scan-progress'; progress: ResourceScanProgress }

export interface ResolvedTextureFace {
  assetToken: string
  logicalPath: string
  sourcePackId: string | null
  sourceName: string
  sourceKind?: 'resource-pack' | 'vanilla'
  rotation: 0 | 90 | 180 | 270
}

export interface ResolvedMaterialPreview {
  material: string
  revision: number
  source: 'manual' | 'resource-pack' | 'vanilla' | 'mixed' | 'fallback-color'
  sourceName: string
  modelPath: string | null
  faces: Partial<Record<ResolvedCubeFace, ResolvedTextureFace>>
  diagnostics: ResourceDiagnostic[]
}

export interface ResolvedMaterialBatch {
  revision: number
  materials: ResolvedMaterialPreview[]
}

export type PackMoveDirection = 'higher' | 'lower'

export function isResourceTextureFace(value: unknown): value is ResourceTextureFace {
  return (
    typeof value === 'string' &&
    (RESOURCE_TEXTURE_FACES as readonly string[]).includes(value)
  )
}

export function isResourcePreviewMode(value: unknown): value is ResourcePreviewMode {
  return (
    typeof value === 'string' &&
    (RESOURCE_PREVIEW_MODES as readonly string[]).includes(value)
  )
}

export function isPackMoveDirection(value: unknown): value is PackMoveDirection {
  return value === 'higher' || value === 'lower'
}

export function isResourcePreviewEvent(value: unknown): value is ResourcePreviewEvent {
  if (typeof value !== 'object' || value === null || !('type' in value)) return false
  if (value.type === 'state') {
    if (!('state' in value) || typeof value.state !== 'object' || value.state === null) {
      return false
    }
    const state = value.state as Record<string, unknown>
    return (
      state.version === RESOURCE_PREVIEW_SETTINGS_VERSION &&
      typeof state.revision === 'number' &&
      isResourcePreviewMode(state.mode) &&
      Array.isArray(state.packs) &&
      typeof state.vanilla === 'object' &&
      state.vanilla !== null &&
      Array.isArray(state.manualTextures)
    )
  }
  if (value.type !== 'scan-progress' || !('progress' in value)) return false
  if (typeof value.progress !== 'object' || value.progress === null) return false
  const progress = value.progress as Record<string, unknown>
  return (
    typeof progress.packId === 'string' &&
    (progress.phase === 'indexing' ||
      progress.phase === 'copying' ||
      progress.phase === 'complete') &&
    typeof progress.processed === 'number' &&
    (progress.total === null || typeof progress.total === 'number')
  )
}
