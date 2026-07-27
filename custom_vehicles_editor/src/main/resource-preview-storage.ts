import { randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { mkdir, open, rename, rm } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join } from 'node:path'
import {
  RESOURCE_PREVIEW_SETTINGS_VERSION,
  RESOURCE_PACK_TYPES,
  RESOURCE_TEXTURE_FACES,
  isResourcePreviewMode,
  type ResourceDiagnostic,
  type ResourcePackMetadata,
  type ResourcePackType,
  type ResourcePreviewMode,
  type ResourceTextureFace,
  type VanillaMinecraftSourceKind
} from '../shared/resource-preview'
import { BLOCK_MATERIAL_SET } from '../shared/materials'

const MAX_SETTINGS_BYTES = 2 * 1024 * 1024

export interface StoredResourcePack {
  id: string
  type: ResourcePackType
  sourcePath: string
  name: string
  enabled: boolean
  sourceSignature?: string
  cacheKey?: string
  metadata?: ResourcePackMetadata
  diagnostics: ResourceDiagnostic[]
}

export interface StoredManualTexture {
  material: string
  face: ResourceTextureFace
  fileName: string
  originalName: string
  width: number
  height: number
}

export interface StoredVanillaResources {
  enabled: boolean
  discoveryAttempted: boolean
  sourceKind?: VanillaMinecraftSourceKind
  sourcePath?: string
  version?: string
  sourceSize?: number
  sourceMtimeMs?: number
  sourceSha256?: string
  cacheIdentity?: string
  cacheKey?: string
  diagnostics: ResourceDiagnostic[]
}

export interface StoredResourcePreviewSettings {
  version: typeof RESOURCE_PREVIEW_SETTINGS_VERSION
  revision: number
  mode: ResourcePreviewMode
  packs: StoredResourcePack[]
  vanilla: StoredVanillaResources
  manualTextures: StoredManualTexture[]
}

function defaultVanillaSettings(): StoredVanillaResources {
  return {
    enabled: true,
    discoveryAttempted: false,
    diagnostics: []
  }
}

function defaultSettings(): StoredResourcePreviewSettings {
  return {
    version: RESOURCE_PREVIEW_SETTINGS_VERSION,
    revision: 0,
    mode: 'textures',
    packs: [],
    vanilla: defaultVanillaSettings(),
    manualTextures: []
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function safeDiagnostics(value: unknown): ResourceDiagnostic[] {
  if (!Array.isArray(value)) return []
  return value.slice(0, 200).flatMap((entry): ResourceDiagnostic[] => {
    const item = record(entry)
    if (
      item === null ||
      (item.severity !== 'info' &&
        item.severity !== 'warning' &&
        item.severity !== 'error') ||
      typeof item.code !== 'string' ||
      typeof item.message !== 'string'
    ) {
      return []
    }
    return [
      {
        severity: item.severity,
        code: item.code.slice(0, 80),
        message: item.message.slice(0, 500),
        ...(typeof item.path === 'string' ? { path: item.path.slice(0, 500) } : {})
      }
    ]
  })
}

function safeMetadata(value: unknown): ResourcePackMetadata | undefined {
  const item = record(value)
  if (item === null || typeof item.description !== 'string') return undefined
  const packFormat =
    typeof item.packFormat === 'number' && Number.isInteger(item.packFormat)
      ? item.packFormat
      : null
  return {
    packFormat,
    description: item.description.slice(0, 500)
  }
}

function safePack(value: unknown): StoredResourcePack | null {
  const item = record(value)
  if (
    item === null ||
    typeof item.id !== 'string' ||
    !/^[a-f0-9-]{8,64}$/i.test(item.id) ||
    typeof item.sourcePath !== 'string' ||
    !isAbsolute(item.sourcePath) ||
    typeof item.name !== 'string' ||
    typeof item.enabled !== 'boolean' ||
    typeof item.type !== 'string' ||
    !(RESOURCE_PACK_TYPES as readonly string[]).includes(item.type)
  ) {
    return null
  }
  const metadata = safeMetadata(item.metadata)
  return {
    id: item.id,
    type: item.type as ResourcePackType,
    sourcePath: item.sourcePath,
    name: item.name.slice(0, 240),
    enabled: item.enabled,
    diagnostics: safeDiagnostics(item.diagnostics),
    ...(typeof item.sourceSignature === 'string'
      ? { sourceSignature: item.sourceSignature.slice(0, 200) }
      : {}),
    ...(typeof item.cacheKey === 'string' && /^[a-f0-9]{64}$/i.test(item.cacheKey)
      ? { cacheKey: item.cacheKey }
      : {}),
    ...(metadata === undefined ? {} : { metadata })
  }
}

function safeManualTexture(value: unknown): StoredManualTexture | null {
  const item = record(value)
  if (
    item === null ||
    typeof item.material !== 'string' ||
    !BLOCK_MATERIAL_SET.has(item.material) ||
    typeof item.face !== 'string' ||
    !(RESOURCE_TEXTURE_FACES as readonly string[]).includes(item.face) ||
    typeof item.fileName !== 'string' ||
    !/^[a-f0-9]{64}\.png$/i.test(item.fileName) ||
    typeof item.originalName !== 'string' ||
    typeof item.width !== 'number' ||
    typeof item.height !== 'number'
  ) {
    return null
  }
  return {
    material: item.material,
    face: item.face as ResourceTextureFace,
    fileName: basename(item.fileName),
    originalName: basename(item.originalName).slice(0, 240),
    width: Math.max(1, Math.floor(item.width)),
    height: Math.max(1, Math.floor(item.height))
  }
}

function safeVanilla(value: unknown): StoredVanillaResources {
  const item = record(value)
  if (item === null) return defaultVanillaSettings()
  const result: StoredVanillaResources = {
    enabled: typeof item.enabled === 'boolean' ? item.enabled : true,
    discoveryAttempted:
      typeof item.discoveryAttempted === 'boolean'
        ? item.discoveryAttempted
        : false,
    diagnostics: safeDiagnostics(item.diagnostics)
  }
  const sourceKind =
    item.sourceKind === 'automatic' || item.sourceKind === 'manual'
      ? item.sourceKind
      : undefined
  if (
    sourceKind === undefined ||
    typeof item.sourcePath !== 'string' ||
    !isAbsolute(item.sourcePath) ||
    typeof item.version !== 'string' ||
    item.version.trim().length === 0
  ) {
    return result
  }
  result.sourceKind = sourceKind
  result.sourcePath = item.sourcePath
  result.version = item.version.trim().slice(0, 160)
  if (
    typeof item.sourceSize === 'number' &&
    Number.isInteger(item.sourceSize) &&
    item.sourceSize >= 0
  ) {
    result.sourceSize = item.sourceSize
  }
  if (
    typeof item.sourceMtimeMs === 'number' &&
    Number.isFinite(item.sourceMtimeMs) &&
    item.sourceMtimeMs >= 0
  ) {
    result.sourceMtimeMs = item.sourceMtimeMs
  }
  if (typeof item.sourceSha256 === 'string' && /^[a-f0-9]{64}$/i.test(item.sourceSha256)) {
    result.sourceSha256 = item.sourceSha256.toLocaleLowerCase('en-US')
  }
  if (typeof item.cacheIdentity === 'string' && /^[a-f0-9]{64}$/i.test(item.cacheIdentity)) {
    result.cacheIdentity = item.cacheIdentity.toLocaleLowerCase('en-US')
  }
  if (typeof item.cacheKey === 'string' && /^[a-f0-9]{64}$/i.test(item.cacheKey)) {
    result.cacheKey = item.cacheKey.toLocaleLowerCase('en-US')
  }
  return result
}

export function parseResourcePreviewSettings(
  value: unknown
): StoredResourcePreviewSettings {
  const item = record(value)
  if (
    item === null ||
    item.version !== RESOURCE_PREVIEW_SETTINGS_VERSION ||
    !isResourcePreviewMode(item.mode)
  ) {
    return defaultSettings()
  }
  const packs = Array.isArray(item.packs)
    ? item.packs.flatMap((entry) => {
        const pack = safePack(entry)
        return pack === null ? [] : [pack]
      })
    : []
  const seenPackIds = new Set<string>()
  const uniquePacks = packs.filter((pack) => {
    if (seenPackIds.has(pack.id)) return false
    seenPackIds.add(pack.id)
    return true
  })
  const manualTextures = Array.isArray(item.manualTextures)
    ? item.manualTextures.flatMap((entry) => {
        const texture = safeManualTexture(entry)
        return texture === null ? [] : [texture]
      })
    : []
  const seenManual = new Set<string>()
  const uniqueManual = manualTextures.filter((texture) => {
    const key = `${texture.material}\0${texture.face}`
    if (seenManual.has(key)) return false
    seenManual.add(key)
    return true
  })
  return {
    version: RESOURCE_PREVIEW_SETTINGS_VERSION,
    revision:
      typeof item.revision === 'number' &&
      Number.isInteger(item.revision) &&
      item.revision >= 0
        ? item.revision
        : 0,
    mode: item.mode,
    packs: uniquePacks,
    vanilla: safeVanilla(item.vanilla),
    manualTextures: uniqueManual
  }
}

export async function writeBoundedJsonAtomically(
  filePath: string,
  value: unknown,
  maxBytes: number,
  tooLargeMessage: string
): Promise<void> {
  const content = `${JSON.stringify(value, null, 2)}\n`
  if (Buffer.byteLength(content, 'utf8') > maxBytes) {
    throw new Error(tooLargeMessage)
  }
  await mkdir(dirname(filePath), { recursive: true })
  const temporaryPath = join(
    dirname(filePath),
    `.${basename(filePath)}.${randomUUID()}.tmp`
  )
  const handle = await open(
    temporaryPath,
    constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
    0o600
  )
  try {
    await handle.writeFile(content, 'utf8')
    await handle.sync()
    await handle.close()
    await rename(temporaryPath, filePath)
  } catch (caught) {
    await handle.close().catch(() => undefined)
    await rm(temporaryPath, { force: true }).catch(() => undefined)
    throw caught
  }
}

export async function writeJsonAtomically(
  filePath: string,
  value: unknown
): Promise<void> {
  await writeBoundedJsonAtomically(
    filePath,
    value,
    MAX_SETTINGS_BYTES,
    'Настройки ресурс-паков слишком большие'
  )
}

export class ResourcePreviewStorage {
  readonly rootPath: string
  readonly settingsPath: string
  readonly manualPath: string
  readonly cachePath: string

  public constructor(userDataPath: string) {
    this.rootPath = join(userDataPath, 'resource-preview')
    this.settingsPath = join(this.rootPath, 'settings.json')
    this.manualPath = join(this.rootPath, 'manual')
    this.cachePath = join(this.rootPath, 'cache')
  }

  public async ensureDirectories(): Promise<void> {
    await Promise.all([
      mkdir(this.rootPath, { recursive: true }),
      mkdir(this.manualPath, { recursive: true }),
      mkdir(this.cachePath, { recursive: true })
    ])
  }

  public async load(): Promise<StoredResourcePreviewSettings> {
    await this.ensureDirectories()
    try {
      const info = await open(this.settingsPath, constants.O_RDONLY)
      try {
        const stat = await info.stat()
        if (stat.size > MAX_SETTINGS_BYTES) return defaultSettings()
        const content = await info.readFile({ encoding: 'utf8' })
        return parseResourcePreviewSettings(JSON.parse(content) as unknown)
      } finally {
        await info.close()
      }
    } catch {
      return defaultSettings()
    }
  }

  public save(settings: StoredResourcePreviewSettings): Promise<void> {
    return writeJsonAtomically(this.settingsPath, settings)
  }
}
