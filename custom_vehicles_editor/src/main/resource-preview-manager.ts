import { createHash, randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import {
  mkdir,
  open,
  opendir,
  readFile,
  rename,
  rm,
  stat,
  writeFile
} from 'node:fs/promises'
import { basename, dirname, extname, isAbsolute, relative, resolve, sep } from 'node:path'
import { BLOCK_MATERIAL_SET } from '../shared/materials'
import {
  RESOURCE_PREVIEW_SETTINGS_VERSION,
  VANILLA_RESOURCE_PACK_ID,
  isPackMoveDirection,
  isResourcePreviewMode,
  isResourceTextureFace,
  type DetectedMinecraftVersion,
  type PackMoveDirection,
  type ResolvedMaterialBatch,
  type ResourceDiagnostic,
  type ResourcePreviewEvent,
  type ResourcePreviewMode,
  type ResourcePreviewState,
  type ResourceTextureFace
} from '../shared/resource-preview'
import {
  discoverInstalledMinecraftVersions,
  inspectSelectedMinecraftJar,
  preferredMinecraftVersion,
  type MinecraftDiscoveryOptions
} from './minecraft-installation-discovery'
import {
  RESOURCE_PACK_LIMITS,
  fileSha256,
  readResourcePackIndex,
  scanResourcePack,
  sourceSignature,
  type ResourcePackIndex
} from './resource-pack-scanner'
import {
  resolveMaterialPreview,
  type ResolverFile,
  type ResolverManualTexture,
  type ResolverPack
} from './resource-pack-resolver'
import {
  ResourcePreviewStorage,
  type StoredManualTexture,
  type StoredResourcePack,
  type StoredResourcePreviewSettings,
  type StoredVanillaResources
} from './resource-preview-storage'

const MAX_MANUAL_SOURCE_BYTES = 32 * 1024 * 1024
const MAX_PREVIEW_ASSET_BYTES = 32 * 1024 * 1024
const MAX_RESOLVE_MATERIALS = 1060
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])

export interface DecodedPng {
  png: Buffer
  width: number
  height: number
}

export type PngDecoder = (content: Buffer) => DecodedPng

interface LoadedIndex {
  rootPath: string
  index: ResourcePackIndex
}

type ResourcePreviewListener = (event: ResourcePreviewEvent) => void

export interface ResourcePreviewManagerOptions {
  autoDiscoverVanilla?: boolean
  discovery?: MinecraftDiscoveryOptions
}

function cloneSettings(
  settings: StoredResourcePreviewSettings
): StoredResourcePreviewSettings {
  return structuredClone(settings)
}

function sameStrings(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  return left.size === right.size && [...left].every((value) => right.has(value))
}

function assertPackId(packId: unknown): asserts packId is string {
  if (typeof packId !== 'string' || !/^[a-f0-9-]{8,64}$/i.test(packId)) {
    throw new Error('Некорректный ID ресурс-пака')
  }
}

function assertMaterial(material: unknown): asserts material is string {
  if (typeof material !== 'string' || !BLOCK_MATERIAL_SET.has(material)) {
    throw new Error('Неизвестный блочный Material')
  }
}

function managedPath(rootPath: string, ...parts: string[]): string {
  const target = resolve(rootPath, ...parts)
  const relativePath = relative(resolve(rootPath), target)
  if (
    relativePath === '' ||
    relativePath === '..' ||
    relativePath.startsWith(`..${sep}`) ||
    isAbsolute(relativePath)
  ) {
    throw new Error('Некорректный управляемый путь')
  }
  return target
}

function assetToken(value: string): string {
  return `rp_${createHash('sha256').update(value).digest('hex')}`
}

function packError(caught: unknown): ResourceDiagnostic {
  return {
    severity: 'error',
    code: 'scan-failed',
    message:
      caught instanceof Error
        ? caught.message.slice(0, 500)
        : 'Не удалось просканировать ресурс-пак'
  }
}

function vanillaError(caught: unknown): ResourceDiagnostic {
  return {
    severity: 'error',
    code: 'vanilla-scan-failed',
    message:
      caught instanceof Error
        ? caught.message.slice(0, 500)
        : 'Не удалось подготовить ванильные ресурсы Minecraft'
  }
}

function vanillaName(version: string | undefined): string {
  return `Ванильные ресурсы Minecraft ${version ?? 'неизвестной версии'}`
}

function vanillaCacheIdentity(
  vanilla: Pick<
    StoredVanillaResources,
    'sourcePath' | 'version' | 'sourceSize' | 'sourceMtimeMs' | 'sourceSha256'
  >
): string {
  return createHash('sha256')
    .update(vanilla.sourcePath ?? '')
    .update('\0')
    .update(vanilla.version ?? '')
    .update('\0')
    .update(String(vanilla.sourceSize ?? -1))
    .update('\0')
    .update(String(Math.floor(vanilla.sourceMtimeMs ?? -1)))
    .update('\0')
    .update(vanilla.sourceSha256 ?? '')
    .digest('hex')
}

export class ResourcePreviewManager {
  readonly #storage: ResourcePreviewStorage
  #settings: StoredResourcePreviewSettings
  readonly #indices = new Map<string, LoadedIndex>()
  readonly #assetRegistry = new Map<string, string>()
  readonly #listeners = new Set<ResourcePreviewListener>()
  readonly #scanControllers = new Map<string, AbortController>()
  readonly #scanning = new Set<string>()
  readonly #missing = new Set<string>()
  readonly #stale = new Set<string>()
  readonly #resolutionCache = new Map<string, Promise<ResolvedMaterialBatch['materials'][number]>>()
  readonly #options: ResourcePreviewManagerOptions
  #detectedVanilla: DetectedMinecraftVersion[] = []
  #vanillaIndex: LoadedIndex | null = null
  #vanillaMissing = false
  #vanillaStale = false
  #vanillaScanning = false
  #vanillaCacheReused = false
  #vanillaScanController: AbortController | null = null
  #previewRevision: number
  #writeQueue: Promise<void> = Promise.resolve()

  private constructor(
    storage: ResourcePreviewStorage,
    settings: StoredResourcePreviewSettings,
    options: ResourcePreviewManagerOptions
  ) {
    this.#storage = storage
    this.#settings = settings
    this.#options = options
    this.#previewRevision = settings.revision
  }

  public static async create(
    userDataPath: string,
    options: ResourcePreviewManagerOptions = {}
  ): Promise<ResourcePreviewManager> {
    const storage = new ResourcePreviewStorage(userDataPath)
    const settings = await storage.load()
    const manager = new ResourcePreviewManager(storage, settings, options)
    if (options.autoDiscoverVanilla !== false) {
      await manager.#initializeVanillaSelection()
    }
    await manager.#loadCachedIndices()
    if (
      options.autoDiscoverVanilla !== false &&
      manager.#settings.vanilla.enabled &&
      manager.#settings.vanilla.sourcePath !== undefined &&
      manager.#vanillaIndex === null &&
      !manager.#vanillaMissing
    ) {
      await manager.#scanVanilla(false)
    }
    return manager
  }

  public subscribe(listener: ResourcePreviewListener): () => void {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  #advancePreviewGeneration(): void {
    this.#previewRevision = Math.max(
      this.#previewRevision + 1,
      this.#settings.revision
    )
    this.#resolutionCache.clear()
    this.#assetRegistry.clear()
  }

  async #initializeVanillaSelection(): Promise<void> {
    this.#detectedVanilla = await discoverInstalledMinecraftVersions(
      this.#options.discovery
    )
    if (this.#settings.vanilla.sourceKind === 'manual') return
    const selected = preferredMinecraftVersion(this.#detectedVanilla)
    if (selected === null) {
      if (
        !this.#settings.vanilla.discoveryAttempted ||
        this.#settings.vanilla.sourcePath !== undefined
      ) {
        await this.#commit((settings) => {
          settings.vanilla.discoveryAttempted = true
          if (settings.vanilla.sourceKind !== 'manual') {
            settings.vanilla = {
              enabled: settings.vanilla.enabled,
              discoveryAttempted: true,
              diagnostics: [
                {
                  severity: 'info',
                  code: 'vanilla-not-found',
                  message:
                    'Установка Minecraft Java Edition не найдена; используется цвет материалов'
                }
              ]
            }
          }
        })
      }
      return
    }
    await this.#selectVanillaSource(selected, 'automatic')
  }

  async #selectVanillaSource(
    selected: DetectedMinecraftVersion,
    sourceKind: NonNullable<StoredVanillaResources['sourceKind']>
  ): Promise<void> {
    const current = this.#settings.vanilla
    const changed =
      current.sourcePath !== selected.jarPath ||
      current.version !== selected.version
    if (
      !changed &&
      current.sourceKind === sourceKind &&
      current.discoveryAttempted &&
      current.diagnostics.length === 0
    ) {
      return
    }
    if (changed) {
      this.#vanillaIndex = null
      this.#vanillaCacheReused = false
    }
    await this.#commit((settings) => {
      const previous = settings.vanilla
      settings.vanilla = {
        enabled: previous.enabled,
        discoveryAttempted: true,
        sourceKind,
        sourcePath: selected.jarPath,
        version: selected.version,
        diagnostics: [],
        ...(!changed && previous.sourceSize !== undefined
          ? { sourceSize: previous.sourceSize }
          : {}),
        ...(!changed && previous.sourceMtimeMs !== undefined
          ? { sourceMtimeMs: previous.sourceMtimeMs }
          : {}),
        ...(!changed && previous.sourceSha256 !== undefined
          ? { sourceSha256: previous.sourceSha256 }
          : {}),
        ...(!changed && previous.cacheIdentity !== undefined
          ? { cacheIdentity: previous.cacheIdentity }
          : {}),
        ...(!changed && previous.cacheKey !== undefined
          ? { cacheKey: previous.cacheKey }
          : {})
      }
    })
  }

  #stateSnapshot(): ResourcePreviewState {
    const vanillaDiagnostics = [...this.#settings.vanilla.diagnostics]
    if (this.#vanillaMissing) {
      vanillaDiagnostics.push({
        severity: 'error',
        code: 'vanilla-source-missing',
        message: 'Выбранный Minecraft JAR отсутствует или был перемещён'
      })
    } else if (this.#vanillaStale) {
      vanillaDiagnostics.push({
        severity: 'warning',
        code: 'vanilla-source-changed',
        message: 'Minecraft JAR изменился; обновите ванильные ресурсы'
      })
    }
    return {
      version: RESOURCE_PREVIEW_SETTINGS_VERSION,
      revision: this.#previewRevision,
      mode: this.#settings.mode,
      packs: this.#settings.packs.map((pack) => {
        const diagnostics = [...pack.diagnostics]
        if (this.#missing.has(pack.id)) {
          diagnostics.push({
            severity: 'error',
            code: 'source-missing',
            message: 'Исходный путь ресурс-пака отсутствует'
          })
        } else if (this.#stale.has(pack.id)) {
          diagnostics.push({
            severity: 'warning',
            code: 'source-changed',
            message: 'Исходник изменился; требуется пересканирование'
          })
        }
        return {
          id: pack.id,
          type: pack.type,
          sourcePath: pack.sourcePath,
          name: pack.name,
          enabled: pack.enabled,
          missing: this.#missing.has(pack.id),
          scanning: this.#scanning.has(pack.id),
          metadata: pack.metadata ?? null,
          diagnostics
        }
      }),
      vanilla: {
        enabled: this.#settings.vanilla.enabled,
        sourceKind: this.#settings.vanilla.sourceKind ?? null,
        sourcePath: this.#settings.vanilla.sourcePath ?? null,
        version: this.#settings.vanilla.version ?? null,
        missing: this.#vanillaMissing,
        scanning: this.#vanillaScanning,
        ready:
          this.#vanillaIndex !== null &&
          !this.#vanillaMissing &&
          !this.#vanillaStale,
        cacheReused: this.#vanillaCacheReused,
        detectedVersions: this.#detectedVanilla,
        diagnostics: vanillaDiagnostics
      },
      manualTextures: this.#settings.manualTextures.map((texture) => ({
        material: texture.material,
        face: texture.face,
        assetToken: this.#manualToken(texture),
        originalName: texture.originalName,
        width: texture.width,
        height: texture.height
      }))
    }
  }

  #emitStateSnapshot(state = this.#stateSnapshot()): void {
    for (const listener of this.#listeners) listener({ type: 'state', state })
  }

  async #emitState(): Promise<void> {
    await this.#refreshPresence()
    this.#emitStateSnapshot()
  }

  #emitProgress(event: ResourcePreviewEvent): void {
    for (const listener of this.#listeners) listener(event)
  }

  async #loadCachedIndices(): Promise<void> {
    await this.#refreshPresence()
    for (const pack of this.#settings.packs) {
      if (
        pack.cacheKey === undefined ||
        this.#missing.has(pack.id) ||
        this.#stale.has(pack.id)
      ) {
        continue
      }
      const rootPath = managedPath(
        this.#storage.cachePath,
        'packs',
        pack.id,
        pack.cacheKey
      )
      const index = await readResourcePackIndex(rootPath)
      if (index !== null && index.fingerprint === pack.cacheKey) {
        this.#indices.set(pack.id, { rootPath, index })
      }
    }
    await this.#loadVanillaCachedIndex()
  }

  async #loadVanillaCachedIndex(): Promise<boolean> {
    const vanilla = this.#settings.vanilla
    if (
      vanilla.cacheIdentity === undefined ||
      vanilla.cacheKey === undefined ||
      vanilla.sourceSha256 === undefined ||
      this.#vanillaMissing ||
      this.#vanillaStale
    ) {
      return false
    }
    const rootPath = managedPath(
      this.#storage.cachePath,
      'vanilla',
      vanilla.cacheIdentity,
      vanilla.cacheKey
    )
    const index = await readResourcePackIndex(rootPath)
    if (
      index === null ||
      index.fingerprint !== vanilla.cacheKey ||
      index.sourceSha256 !== vanilla.sourceSha256
    ) {
      return false
    }
    this.#vanillaIndex = { rootPath, index }
    this.#vanillaCacheReused = true
    return true
  }

  async #refreshPresence(): Promise<boolean> {
    const settings = this.#settings
    const missing = new Set<string>()
    const stale = new Set<string>()
    for (const pack of settings.packs) {
      const signature = await sourceSignature(pack.sourcePath, pack.type)
      if (signature === null) {
        missing.add(pack.id)
      } else if (
        pack.sourceSignature !== undefined &&
        signature !== pack.sourceSignature
      ) {
        stale.add(pack.id)
      }
    }
    let vanillaMissing = false
    let vanillaStale = false
    const vanilla = settings.vanilla
    if (vanilla.sourcePath !== undefined) {
      try {
        const info = await stat(vanilla.sourcePath)
        if (!info.isFile()) {
          vanillaMissing = true
        } else if (
          vanilla.cacheKey !== undefined &&
          (vanilla.sourceSize !== info.size ||
            vanilla.sourceMtimeMs === undefined ||
            Math.floor(vanilla.sourceMtimeMs) !== Math.floor(info.mtimeMs))
        ) {
          vanillaStale = true
        }
      } catch {
        vanillaMissing = true
      }
    }
    if (settings !== this.#settings) return this.#refreshPresence()

    const changed =
      !sameStrings(this.#missing, missing) ||
      !sameStrings(this.#stale, stale) ||
      this.#vanillaMissing !== vanillaMissing ||
      this.#vanillaStale !== vanillaStale
    this.#missing.clear()
    missing.forEach((packId) => this.#missing.add(packId))
    this.#stale.clear()
    stale.forEach((packId) => {
      this.#stale.add(packId)
      this.#indices.delete(packId)
    })
    this.#vanillaMissing = vanillaMissing
    this.#vanillaStale = vanillaStale
    if (vanillaMissing || vanillaStale) {
      this.#vanillaIndex = null
      this.#vanillaCacheReused = false
    }
    if (changed) this.#advancePreviewGeneration()
    return changed
  }

  #packById(packId: string): StoredResourcePack {
    assertPackId(packId)
    const pack = this.#settings.packs.find((entry) => entry.id === packId)
    if (pack === undefined) throw new Error('Ресурс-пак не найден')
    return pack
  }

  async #commit(mutator: (settings: StoredResourcePreviewSettings) => void): Promise<void> {
    const write = async (): Promise<void> => {
      const next = cloneSettings(this.#settings)
      mutator(next)
      next.revision = this.#settings.revision + 1
      await this.#storage.save(next)
      this.#settings = next
      this.#advancePreviewGeneration()
    }
    this.#writeQueue = this.#writeQueue.then(write, write)
    await this.#writeQueue
    await this.#emitState()
  }

  #registerAsset(key: string, filePath: string): string {
    const safePath = managedPath(this.#storage.rootPath, relative(this.#storage.rootPath, filePath))
    const token = assetToken(key)
    this.#assetRegistry.set(token, safePath)
    return token
  }

  #manualToken(texture: StoredManualTexture): string {
    const path = managedPath(this.#storage.manualPath, texture.fileName)
    return this.#registerAsset(`manual\0${texture.fileName}`, path)
  }

  public async getState(): Promise<ResourcePreviewState> {
    const presenceChanged = await this.#refreshPresence()
    const state = this.#stateSnapshot()
    if (presenceChanged) this.#emitStateSnapshot(state)
    return state
  }

  public async setMode(mode: ResourcePreviewMode): Promise<ResourcePreviewState> {
    if (!isResourcePreviewMode(mode)) throw new Error('Некорректный режим предпросмотра')
    if (mode !== this.#settings.mode) {
      await this.#commit((settings) => {
        settings.mode = mode
      })
    }
    return this.getState()
  }

  public async discoverVanilla(): Promise<ResourcePreviewState> {
    this.#detectedVanilla = await discoverInstalledMinecraftVersions(
      this.#options.discovery
    )
    const selected = preferredMinecraftVersion(this.#detectedVanilla)
    if (selected === null) {
      await this.#commit((settings) => {
        settings.vanilla.discoveryAttempted = true
        settings.vanilla.diagnostics = [
          {
            severity: 'info',
            code: 'vanilla-not-found',
            message:
              'Установка Minecraft Java Edition не найдена. Можно выбрать client JAR вручную.'
          }
        ]
      })
      return this.getState()
    }
    await this.#selectVanillaSource(selected, 'automatic')
    return this.#scanVanilla(false)
  }

  public async selectDetectedVanilla(
    candidateId: string
  ): Promise<ResourcePreviewState> {
    if (typeof candidateId !== 'string') {
      throw new Error('Некорректная версия Minecraft')
    }
    const selected = this.#detectedVanilla.find(
      (candidate) => candidate.id === candidateId
    )
    if (selected === undefined) {
      throw new Error('Версия Minecraft больше не доступна; повторите поиск')
    }
    await this.#selectVanillaSource(selected, 'automatic')
    return this.#scanVanilla(false)
  }

  public async selectVanillaJar(sourcePath: string): Promise<ResourcePreviewState> {
    const selected = await inspectSelectedMinecraftJar(sourcePath)
    await this.#selectVanillaSource(selected, 'manual')
    return this.#scanVanilla(false)
  }

  public async setVanillaEnabled(
    enabled: boolean
  ): Promise<ResourcePreviewState> {
    if (typeof enabled !== 'boolean') {
      throw new Error('Некорректный флаг ванильных ресурсов')
    }
    if (enabled !== this.#settings.vanilla.enabled) {
      await this.#commit((settings) => {
        settings.vanilla.enabled = enabled
      })
    }
    return this.getState()
  }

  public async rescanVanilla(): Promise<ResourcePreviewState> {
    return this.#scanVanilla(true)
  }

  public vanillaSourcePath(): string | null {
    return this.#settings.vanilla.sourcePath ?? null
  }

  public async addPack(
    type: StoredResourcePack['type'],
    sourcePath: string
  ): Promise<ResourcePreviewState> {
    if (!isAbsolute(sourcePath)) throw new Error('Путь ресурс-пака должен быть абсолютным')
    const existing = this.#settings.packs.find(
      (pack) => pack.type === type && pack.sourcePath === sourcePath
    )
    if (existing !== undefined) {
      if (!existing.enabled) {
        await this.#commit((settings) => {
          const pack = settings.packs.find((entry) => entry.id === existing.id)
          if (pack !== undefined) pack.enabled = true
        })
      }
      return this.rescanPack(existing.id)
    }
    const id = randomUUID()
    await this.#commit((settings) => {
      settings.packs.unshift({
        id,
        type,
        sourcePath,
        name: basename(sourcePath, extname(sourcePath)).slice(0, 240),
        enabled: true,
        diagnostics: []
      })
    })
    return this.rescanPack(id)
  }

  public async setPackEnabled(
    packId: string,
    enabled: boolean
  ): Promise<ResourcePreviewState> {
    this.#packById(packId)
    if (typeof enabled !== 'boolean') throw new Error('Некорректный флаг ресурс-пака')
    await this.#commit((settings) => {
      const pack = settings.packs.find((entry) => entry.id === packId)
      if (pack !== undefined) pack.enabled = enabled
    })
    return this.getState()
  }

  public async movePack(
    packId: string,
    direction: PackMoveDirection
  ): Promise<ResourcePreviewState> {
    this.#packById(packId)
    if (!isPackMoveDirection(direction)) throw new Error('Некорректное направление')
    await this.#commit((settings) => {
      const index = settings.packs.findIndex((entry) => entry.id === packId)
      const destination = direction === 'higher' ? index - 1 : index + 1
      if (index < 0 || destination < 0 || destination >= settings.packs.length) return
      const [pack] = settings.packs.splice(index, 1)
      if (pack !== undefined) settings.packs.splice(destination, 0, pack)
    })
    return this.getState()
  }

  public async removePack(packId: string): Promise<ResourcePreviewState> {
    this.#packById(packId)
    this.#scanControllers.get(packId)?.abort()
    this.#scanControllers.delete(packId)
    this.#indices.delete(packId)
    await this.#commit((settings) => {
      settings.packs = settings.packs.filter((entry) => entry.id !== packId)
    })
    const root = managedPath(this.#storage.cachePath, 'packs', packId)
    await rm(root, { recursive: true, force: true }).catch(() => undefined)
    return this.getState()
  }

  public packSourcePath(packId: string): string {
    return this.#packById(packId).sourcePath
  }

  public async rescanPack(packId: string): Promise<ResourcePreviewState> {
    const selected = this.#packById(packId)
    this.#scanControllers.get(packId)?.abort()
    const controller = new AbortController()
    this.#scanControllers.set(packId, controller)
    this.#scanning.add(packId)
    await this.#emitState()

    const signature = await sourceSignature(selected.sourcePath, selected.type)
    if (signature === null) {
      if (this.#scanControllers.get(packId) === controller) {
        this.#scanning.delete(packId)
      }
      await this.#commit((settings) => {
        const pack = settings.packs.find((entry) => entry.id === packId)
        if (pack !== undefined) pack.diagnostics = [packError(new Error('Исходный путь отсутствует'))]
      })
      return this.getState()
    }

    const stagingRoot = managedPath(
      this.#storage.cachePath,
      `.staging-${packId}-${randomUUID()}`
    )
    try {
      await mkdir(stagingRoot, { recursive: true })
      const index = await scanResourcePack({
        type: selected.type,
        sourcePath: selected.sourcePath,
        destinationPath: stagingRoot,
        packId,
        signal: controller.signal,
        onProgress: (progress) =>
          this.#emitProgress({ type: 'scan-progress', progress })
      })
      if (this.#scanControllers.get(packId) !== controller || controller.signal.aborted) {
        throw new DOMException('Scan superseded', 'AbortError')
      }
      const packRoot = managedPath(this.#storage.cachePath, 'packs', packId)
      const finalRoot = managedPath(packRoot, index.fingerprint)
      await mkdir(dirname(finalRoot), { recursive: true })
      try {
        await rename(stagingRoot, finalRoot)
      } catch (caught) {
        const existing = await readResourcePackIndex(finalRoot)
        if (existing === null || existing.fingerprint !== index.fingerprint) throw caught
        await rm(stagingRoot, { recursive: true, force: true })
      }
      this.#indices.set(packId, { rootPath: finalRoot, index })
      this.#missing.delete(packId)
      this.#stale.delete(packId)
      if (this.#scanControllers.get(packId) === controller) {
        this.#scanning.delete(packId)
      }
      await this.#commit((settings) => {
        const pack = settings.packs.find((entry) => entry.id === packId)
        if (pack === undefined) return
        pack.sourceSignature = signature
        pack.cacheKey = index.fingerprint
        pack.metadata = index.metadata
        pack.diagnostics = index.diagnostics
        if (index.metadata.description.trim().length > 0) {
          pack.name = index.metadata.description.trim().slice(0, 240)
        }
      })
      await this.#garbageCollectPackCache(packId, index.fingerprint)
      return this.getState()
    } catch (caught) {
      await rm(stagingRoot, { recursive: true, force: true }).catch(() => undefined)
      if (this.#scanControllers.get(packId) === controller) {
        this.#scanning.delete(packId)
      }
      if (
        caught instanceof DOMException &&
        caught.name === 'AbortError' &&
        this.#scanControllers.get(packId) !== controller
      ) {
        return this.getState()
      }
      await this.#commit((settings) => {
        const pack = settings.packs.find((entry) => entry.id === packId)
        if (pack !== undefined) pack.diagnostics = [packError(caught)]
      })
      return this.getState()
    } finally {
      if (this.#scanControllers.get(packId) === controller) {
        this.#scanControllers.delete(packId)
      }
    }
  }

  async #scanVanilla(force: boolean): Promise<ResourcePreviewState> {
    const selected = this.#settings.vanilla
    if (selected.sourcePath === undefined || selected.version === undefined) {
      await this.#commit((settings) => {
        settings.vanilla.diagnostics = [
          {
            severity: 'info',
            code: 'vanilla-not-selected',
            message:
              'Ванильные ресурсы не выбраны; выполните автоматический поиск или выберите Minecraft JAR'
          }
        ]
      })
      return this.getState()
    }
    await this.#refreshPresence()
    if (this.#vanillaMissing) return this.getState()
    if (!force && this.#vanillaIndex !== null && !this.#vanillaStale) {
      return this.getState()
    }
    if (!force && !this.#vanillaStale && (await this.#loadVanillaCachedIndex())) {
      this.#advancePreviewGeneration()
      await this.#emitState()
      return this.getState()
    }

    this.#vanillaScanController?.abort()
    const controller = new AbortController()
    this.#vanillaScanController = controller
    this.#vanillaScanning = true
    this.#vanillaCacheReused = false
    await this.#emitState()

    const sourcePath = selected.sourcePath
    const version = selected.version
    const sourceKind = selected.sourceKind ?? 'manual'
    const stagingRoot = managedPath(
      this.#storage.cachePath,
      `.staging-vanilla-${randomUUID()}`
    )
    try {
      const sourceInfo = await stat(sourcePath)
      if (!sourceInfo.isFile()) throw new Error('Выбранный Minecraft JAR отсутствует')
      if (sourceInfo.size > RESOURCE_PACK_LIMITS.archiveBytes) {
        throw new Error('Minecraft JAR превышает безопасный лимит')
      }
      const sourceSha256 = await fileSha256(sourcePath)
      if (controller.signal.aborted) {
        throw new DOMException('Scan superseded', 'AbortError')
      }
      const sourceIdentityFields: StoredVanillaResources = {
        enabled: selected.enabled,
        discoveryAttempted: true,
        sourceKind,
        sourcePath,
        version,
        sourceSize: sourceInfo.size,
        sourceMtimeMs: sourceInfo.mtimeMs,
        sourceSha256,
        diagnostics: []
      }
      const cacheIdentity = vanillaCacheIdentity(sourceIdentityFields)
      await mkdir(stagingRoot, { recursive: true })
      const index = await scanResourcePack({
        type: 'zip',
        sourceKind: 'vanilla-client',
        sourcePath,
        destinationPath: stagingRoot,
        packId: VANILLA_RESOURCE_PACK_ID,
        vanillaVersion: version,
        sourceSha256,
        signal: controller.signal,
        onProgress: (progress) =>
          this.#emitProgress({ type: 'scan-progress', progress })
      })
      if (
        this.#vanillaScanController !== controller ||
        controller.signal.aborted
      ) {
        throw new DOMException('Scan superseded', 'AbortError')
      }
      const identityRoot = managedPath(
        this.#storage.cachePath,
        'vanilla',
        cacheIdentity
      )
      const finalRoot = managedPath(identityRoot, index.fingerprint)
      await mkdir(dirname(finalRoot), { recursive: true })
      try {
        await rename(stagingRoot, finalRoot)
      } catch (caught) {
        const existing = await readResourcePackIndex(finalRoot)
        if (
          existing === null ||
          existing.fingerprint !== index.fingerprint ||
          existing.sourceSha256 !== sourceSha256
        ) {
          throw caught
        }
        await rm(stagingRoot, { recursive: true, force: true })
      }
      this.#vanillaIndex = { rootPath: finalRoot, index }
      this.#vanillaMissing = false
      this.#vanillaStale = false
      this.#vanillaScanning = false
      await this.#commit((settings) => {
        settings.vanilla = {
          enabled: settings.vanilla.enabled,
          discoveryAttempted: true,
          sourceKind,
          sourcePath,
          version,
          sourceSize: sourceInfo.size,
          sourceMtimeMs: sourceInfo.mtimeMs,
          sourceSha256,
          cacheIdentity,
          cacheKey: index.fingerprint,
          diagnostics: index.diagnostics
        }
      })
      await this.#garbageCollectVanillaCache(
        cacheIdentity,
        index.fingerprint
      )
      return this.getState()
    } catch (caught) {
      await rm(stagingRoot, { recursive: true, force: true }).catch(
        () => undefined
      )
      if (
        caught instanceof DOMException &&
        caught.name === 'AbortError' &&
        this.#vanillaScanController !== controller
      ) {
        return this.getState()
      }
      this.#vanillaIndex = null
      this.#vanillaScanning = false
      await this.#commit((settings) => {
        settings.vanilla.diagnostics = [vanillaError(caught)]
      })
      return this.getState()
    } finally {
      if (this.#vanillaScanController === controller) {
        this.#vanillaScanController = null
        this.#vanillaScanning = false
      }
    }
  }

  public async importManualTexture(
    material: string,
    face: ResourceTextureFace,
    sourcePath: string,
    decodePng: PngDecoder
  ): Promise<ResourcePreviewState> {
    assertMaterial(material)
    if (!isResourceTextureFace(face)) throw new Error('Некорректная грань текстуры')
    if (!isAbsolute(sourcePath) || extname(sourcePath).toLocaleLowerCase('en-US') !== '.png') {
      throw new Error('Поддерживаются только PNG-файлы')
    }
    const info = await stat(sourcePath)
    if (!info.isFile() || info.size > MAX_MANUAL_SOURCE_BYTES) {
      throw new Error('PNG слишком большой или отсутствует')
    }
    const source = await readFile(sourcePath)
    if (!source.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
      throw new Error('Файл не является PNG')
    }
    const decoded = decodePng(source)
    if (
      decoded.png.byteLength === 0 ||
      decoded.png.byteLength > MAX_MANUAL_SOURCE_BYTES ||
      !decoded.png.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE) ||
      decoded.width < 1 ||
      decoded.height < 1 ||
      decoded.width > 8192 ||
      decoded.height > 8192
    ) {
      throw new Error('PNG не удалось декодировать или его размеры слишком велики')
    }
    const hash = createHash('sha256').update(decoded.png).digest('hex')
    const fileName = `${hash}.png`
    const destination = managedPath(this.#storage.manualPath, fileName)
    await mkdir(dirname(destination), { recursive: true })
    try {
      await writeFile(destination, decoded.png, { flag: 'wx', mode: 0o600 })
    } catch (caught) {
      if (
        typeof caught !== 'object' ||
        caught === null ||
        !('code' in caught) ||
        caught.code !== 'EEXIST'
      ) {
        throw caught
      }
    }
    await this.#commit((settings) => {
      settings.manualTextures = settings.manualTextures.filter(
        (entry) => entry.material !== material || entry.face !== face
      )
      settings.manualTextures.push({
        material,
        face,
        fileName,
        originalName: basename(sourcePath),
        width: decoded.width,
        height: decoded.height
      })
    })
    await this.#garbageCollectManual()
    return this.getState()
  }

  public async clearManualTexture(
    material: string,
    face: ResourceTextureFace
  ): Promise<ResourcePreviewState> {
    assertMaterial(material)
    if (!isResourceTextureFace(face)) throw new Error('Некорректная грань текстуры')
    await this.#commit((settings) => {
      settings.manualTextures = settings.manualTextures.filter(
        (entry) => entry.material !== material || entry.face !== face
      )
    })
    await this.#garbageCollectManual()
    return this.getState()
  }

  async #garbageCollectManual(): Promise<void> {
    const referenced = new Set(this.#settings.manualTextures.map((entry) => entry.fileName))
    let directory
    try {
      directory = await opendir(this.#storage.manualPath)
    } catch {
      return
    }
    for await (const entry of directory) {
      if (
        entry.isFile() &&
        /^[a-f0-9]{64}\.png$/i.test(entry.name) &&
        !referenced.has(entry.name)
      ) {
        await rm(managedPath(this.#storage.manualPath, entry.name), {
          force: true
        }).catch(() => undefined)
      }
    }
  }

  async #garbageCollectPackCache(packId: string, currentKey: string): Promise<void> {
    const packRoot = managedPath(this.#storage.cachePath, 'packs', packId)
    let directory
    try {
      directory = await opendir(packRoot)
    } catch {
      return
    }
    for await (const entry of directory) {
      if (
        entry.isDirectory() &&
        /^[a-f0-9]{64}$/i.test(entry.name) &&
        entry.name !== currentKey
      ) {
        await rm(managedPath(packRoot, entry.name), {
          recursive: true,
          force: true
        }).catch(() => undefined)
      }
    }
  }

  async #garbageCollectVanillaCache(
    currentIdentity: string,
    currentKey: string
  ): Promise<void> {
    const vanillaRoot = managedPath(this.#storage.cachePath, 'vanilla')
    let identities
    try {
      identities = await opendir(vanillaRoot)
    } catch {
      return
    }
    for await (const entry of identities) {
      if (!entry.isDirectory() || !/^[a-f0-9]{64}$/i.test(entry.name)) continue
      const identityPath = managedPath(vanillaRoot, entry.name)
      if (entry.name !== currentIdentity) {
        await rm(identityPath, { recursive: true, force: true }).catch(
          () => undefined
        )
        continue
      }
      let versions
      try {
        versions = await opendir(identityPath)
      } catch {
        continue
      }
      for await (const version of versions) {
        if (
          version.isDirectory() &&
          /^[a-f0-9]{64}$/i.test(version.name) &&
          version.name !== currentKey
        ) {
          await rm(managedPath(identityPath, version.name), {
            recursive: true,
            force: true
          }).catch(() => undefined)
        }
      }
    }
  }

  #resolverPacks(): ResolverPack[] {
    const imported = this.#settings.packs.flatMap((pack): ResolverPack[] => {
      if (!pack.enabled || this.#missing.has(pack.id) || this.#stale.has(pack.id)) return []
      const loaded = this.#indices.get(pack.id)
      if (loaded === undefined || pack.cacheKey === undefined) return []
      const files = new Map<string, ResolverFile>()
      for (const indexed of loaded.index.files) {
        const absolutePath = managedPath(loaded.rootPath, indexed.relativePath)
        const token = this.#registerAsset(
          `pack\0${pack.id}\0${pack.cacheKey}\0${indexed.logicalPath}\0${indexed.sha256}`,
          absolutePath
        )
        files.set(indexed.logicalPath, {
          logicalPath: indexed.logicalPath,
          assetToken: token
        })
      }
      return [{ id: pack.id, name: pack.name, kind: 'resource-pack', files }]
    })
    const vanilla = this.#settings.vanilla
    if (
      !vanilla.enabled ||
      this.#vanillaIndex === null ||
      this.#vanillaMissing ||
      this.#vanillaStale
    ) {
      return imported
    }
    const files = new Map<string, ResolverFile>()
    for (const indexed of this.#vanillaIndex.index.files) {
      const absolutePath = managedPath(
        this.#vanillaIndex.rootPath,
        indexed.relativePath
      )
      const token = this.#registerAsset(
        `vanilla\0${vanilla.cacheIdentity ?? ''}\0${indexed.logicalPath}\0${indexed.sha256}`,
        absolutePath
      )
      files.set(indexed.logicalPath, {
        logicalPath: indexed.logicalPath,
        assetToken: token
      })
    }
    return [
      ...imported,
      {
        id: VANILLA_RESOURCE_PACK_ID,
        name: vanillaName(vanilla.version),
        kind: 'vanilla',
        files
      }
    ]
  }

  public async resolveMaterials(materials: string[]): Promise<ResolvedMaterialBatch> {
    if (!Array.isArray(materials) || materials.length > MAX_RESOLVE_MATERIALS) {
      throw new Error('Некорректный список материалов')
    }
    const unique = [...new Set(materials)]
    unique.forEach(assertMaterial)
    const presenceChanged = await this.#refreshPresence()
    if (presenceChanged) this.#emitStateSnapshot()
    const revision = this.#previewRevision
    const packs = this.#resolverPacks()
    const resolved = await Promise.all(
      unique.map((material) => {
        const cacheKey = `${revision}\0${material}`
        let pending = this.#resolutionCache.get(cacheKey)
        if (pending === undefined) {
          const manualTextures: ResolverManualTexture[] =
            this.#settings.manualTextures
              .filter((entry) => entry.material === material)
              .map((entry) => ({
                face: entry.face,
                assetToken: this.#manualToken(entry),
                sourceName: 'Ручная текстура'
              }))
          const pathsByToken = new Map(this.#assetRegistry)
          pending = resolveMaterialPreview({
            material,
            revision,
            packs,
            manualTextures,
            readText: async (file) => {
              const path = pathsByToken.get(file.assetToken)
              if (path === undefined) throw new Error('Ресурс не зарегистрирован')
              const info = await stat(path)
              if (!info.isFile() || info.size > 2 * 1024 * 1024) {
                throw new Error('JSON-ресурс слишком большой')
              }
              return readFile(path, 'utf8')
            }
          })
          this.#resolutionCache.set(cacheKey, pending)
        }
        return pending
      })
    )
    return { revision, materials: resolved }
  }

  public async readAsset(token: string): Promise<Uint8Array> {
    if (typeof token !== 'string' || !/^rp_[a-f0-9]{64}$/.test(token)) {
      throw new Error('Некорректный токен текстуры')
    }
    const path = this.#assetRegistry.get(token)
    if (path === undefined) throw new Error('Текстура не зарегистрирована')
    const safePath = managedPath(
      this.#storage.rootPath,
      relative(this.#storage.rootPath, path)
    )
    const handle = await open(safePath, constants.O_RDONLY)
    try {
      const info = await handle.stat()
      if (!info.isFile() || info.size > MAX_PREVIEW_ASSET_BYTES) {
        throw new Error('Текстура превышает допустимый размер')
      }
      return new Uint8Array(await handle.readFile())
    } finally {
      await handle.close()
    }
  }

  public dispose(): void {
    this.#vanillaScanController?.abort()
    this.#vanillaScanController = null
    for (const controller of this.#scanControllers.values()) controller.abort()
    this.#scanControllers.clear()
    this.#listeners.clear()
    this.#assetRegistry.clear()
    this.#resolutionCache.clear()
  }
}
