import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import {
  lstat,
  mkdir,
  open,
  opendir,
  readFile,
  realpath,
  stat,
  writeFile
} from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { Open, type FileEntry } from 'unzipper'
import type {
  ResourceDiagnostic,
  ResourcePackMetadata,
  ResourcePackType,
  ResourceScanProgress
} from '../shared/resource-preview'
import { writeBoundedJsonAtomically } from './resource-preview-storage'

export const RESOURCE_PACK_LIMITS = Object.freeze({
  archiveBytes: 512 * 1024 * 1024,
  entries: 50_000,
  totalRelevantBytes: 1024 * 1024 * 1024,
  jsonBytes: 2 * 1024 * 1024,
  pngBytes: 32 * 1024 * 1024,
  compressionRatio: 250,
  indexBytes: 128 * 1024 * 1024
})

export interface IndexedResourceFile {
  logicalPath: string
  relativePath: string
  size: number
  sha256: string
}

export interface ResourcePackIndex {
  version: 1
  fingerprint: string
  sourceSha256?: string
  metadata: ResourcePackMetadata
  files: IndexedResourceFile[]
  diagnostics: ResourceDiagnostic[]
}

export async function writeResourcePackIndex(
  cachePath: string,
  index: ResourcePackIndex
): Promise<void> {
  await writeBoundedJsonAtomically(
    join(cachePath, 'index.json'),
    index,
    RESOURCE_PACK_LIMITS.indexBytes,
    'Индекс ресурс-пака превышает безопасный лимит'
  )
}

export interface ScanResourcePackOptions {
  type: ResourcePackType
  sourcePath: string
  destinationPath: string
  packId: string
  sourceKind?: 'resource-pack' | 'vanilla-client'
  vanillaVersion?: string
  sourceSha256?: string
  signal?: AbortSignal
  onProgress?: (progress: ResourceScanProgress) => void
}

interface CandidateFile {
  logicalPath: string
  size: number
  read(): Promise<Buffer>
}

const RESOURCE_PATH_PATTERN =
  /^assets\/[a-z0-9_.-]+\/(?:blockstates\/[a-z0-9_./-]+\.json|models\/[a-z0-9_./-]+\.json|textures\/block\/[a-z0-9_./-]+\.png)$/

function abortIfNeeded(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) throw new DOMException('Scan cancelled', 'AbortError')
}

function normalizeLogicalPath(value: string): string | null {
  if (
    value.length === 0 ||
    value.length > 500 ||
    value.includes('\0') ||
    value.includes('\\') ||
    value.startsWith('/') ||
    /^[a-zA-Z]:/.test(value)
  ) {
    return null
  }
  const segments = value.split('/')
  if (segments.some((segment) => segment.length === 0 || segment === '.' || segment === '..')) {
    return null
  }
  const normalized = segments.join('/')
  if (normalized === 'pack.mcmeta' || RESOURCE_PATH_PATTERN.test(normalized)) {
    return normalized
  }
  return null
}

export function sanitizeArchiveEntryPath(value: string): string | null {
  if (
    value.length === 0 ||
    value.length > 1000 ||
    value.includes('\0') ||
    value.startsWith('/') ||
    value.startsWith('\\') ||
    /^[a-zA-Z]:/.test(value)
  ) {
    return null
  }
  const slashPath = value.replaceAll('\\', '/')
  const segments = slashPath.split('/').filter((segment, index, all) => {
    return !(segment.length === 0 && index === all.length - 1)
  })
  if (
    segments.length === 0 ||
    segments.some((segment) => segment.length === 0 || segment === '.' || segment === '..')
  ) {
    return null
  }
  return segments.join('/')
}

function isZipSymlink(entry: FileEntry): boolean {
  const madeBySystem = Math.floor(entry.versionMadeBy / 256)
  if (madeBySystem !== 3) return false
  const unixMode = entry.externalFileAttributes >>> 16
  return (unixMode & 0o170000) === 0o120000
}

function isRelevantPath(
  path: string,
  sourceKind: NonNullable<ScanResourcePackOptions['sourceKind']>
): boolean {
  if (sourceKind === 'vanilla-client') {
    return path.startsWith('assets/minecraft/') && RESOURCE_PATH_PATTERN.test(path)
  }
  return path === 'pack.mcmeta' || RESOURCE_PATH_PATTERN.test(path)
}

function crc32(content: Buffer): number {
  let crc = 0xffffffff
  for (const byte of content) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}

function limitForPath(path: string): number {
  return path.endsWith('.png')
    ? RESOURCE_PACK_LIMITS.pngBytes
    : RESOURCE_PACK_LIMITS.jsonBytes
}

function ensureContained(root: string, target: string): void {
  const relativePath = relative(resolve(root), resolve(target))
  if (
    relativePath === '' ||
    relativePath === '..' ||
    relativePath.startsWith(`..${sep}`) ||
    isAbsolute(relativePath)
  ) {
    throw new Error('Небезопасный путь ресурса')
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function plainTextDescription(value: unknown, depth = 0): string {
  if (depth > 8) return ''
  if (typeof value === 'string') return value
  if (Array.isArray(value)) {
    return value.map((entry) => plainTextDescription(entry, depth + 1)).join('')
  }
  if (typeof value !== 'object' || value === null) return ''
  const item = value as Record<string, unknown>
  const text = typeof item.text === 'string' ? item.text : ''
  const translate = typeof item.translate === 'string' ? item.translate : ''
  const extra = Array.isArray(item.extra)
    ? item.extra.map((entry) => plainTextDescription(entry, depth + 1)).join('')
    : ''
  return `${text || translate}${extra}`
}

export function parsePackMetadata(content: string): ResourcePackMetadata {
  let value: unknown
  try {
    value = JSON.parse(content) as unknown
  } catch {
    throw new Error('pack.mcmeta содержит некорректный JSON')
  }
  if (typeof value !== 'object' || value === null || !('pack' in value)) {
    throw new Error('pack.mcmeta не содержит объект pack')
  }
  const pack = record(value.pack)
  if (pack === null) {
    throw new Error('pack.mcmeta не содержит объект pack')
  }
  const packFormat =
    typeof pack.pack_format === 'number' && Number.isInteger(pack.pack_format)
      ? pack.pack_format
      : null
  return {
    packFormat,
    description: plainTextDescription(pack.description).slice(0, 500)
  }
}

async function directoryCandidates(
  sourcePath: string,
  signal: AbortSignal | undefined,
  diagnostics: ResourceDiagnostic[]
): Promise<CandidateFile[]> {
  const sourceRoot = await realpath(sourcePath)
  const sourceInfo = await lstat(sourceRoot)
  if (!sourceInfo.isDirectory()) throw new Error('Выбранный путь не является папкой')
  const candidates: CandidateFile[] = []
  let visitedEntries = 0

  const walk = async (directory: string): Promise<void> => {
    abortIfNeeded(signal)
    const handle = await opendir(directory)
    for await (const entry of handle) {
      abortIfNeeded(signal)
      visitedEntries += 1
      if (visitedEntries > RESOURCE_PACK_LIMITS.entries) {
        throw new Error('В ресурс-паке слишком много файлов')
      }
      const absolutePath = join(directory, entry.name)
      const relativePath = relative(sourceRoot, absolutePath).split(sep).join('/')
      if (entry.isSymbolicLink()) {
        diagnostics.push({
          severity: 'warning',
          code: 'symlink-ignored',
          message: 'Символическая ссылка проигнорирована',
          path: relativePath
        })
        continue
      }
      if (entry.isDirectory()) {
        if (
          relativePath === 'assets' ||
          (relativePath.startsWith('assets/') &&
            relativePath.split('/').length <= 20)
        ) {
          await walk(absolutePath)
        }
        continue
      }
      if (!entry.isFile()) continue
      const logicalPath = normalizeLogicalPath(relativePath)
      if (logicalPath === null) continue
      const resolvedFile = await realpath(absolutePath)
      ensureContained(sourceRoot, resolvedFile)
      const fileInfo = await lstat(resolvedFile)
      if (!fileInfo.isFile() || fileInfo.isSymbolicLink()) continue
      const sizeLimit = limitForPath(logicalPath)
      if (fileInfo.size > sizeLimit) {
        diagnostics.push({
          severity: 'warning',
          code: 'file-too-large',
          message: 'Ресурс превышает допустимый размер и проигнорирован',
          path: logicalPath
        })
        continue
      }
      candidates.push({
        logicalPath,
        size: fileInfo.size,
        read: async () => {
          const current = await lstat(resolvedFile)
          if (!current.isFile() || current.isSymbolicLink() || current.size > sizeLimit) {
            throw new Error(`Ресурс изменился во время сканирования: ${logicalPath}`)
          }
          return readFile(resolvedFile)
        }
      })
      if (candidates.length > RESOURCE_PACK_LIMITS.entries) {
        throw new Error('В ресурс-паке слишком много файлов')
      }
    }
  }

  await walk(sourceRoot)
  return candidates
}

function wrapperPrefix(entries: Array<{ path: string }>): string {
  if (entries.some((entry) => entry.path === 'pack.mcmeta')) return ''
  const candidates = [
    ...new Set(
      entries.flatMap((entry) => {
        const parts = entry.path.split('/')
        return parts.length === 2 && parts[1] === 'pack.mcmeta' ? [`${parts[0]}/`] : []
      })
    )
  ]
  if (candidates.length !== 1) {
    throw new Error('ZIP должен содержать один pack.mcmeta в корне или общей папке')
  }
  return candidates[0] ?? ''
}

async function assertSafeZipDirectory(sourcePath: string, size: number): Promise<void> {
  const tailLength = Math.min(size, 65_558)
  const handle = await open(sourcePath, 'r')
  try {
    const tail = Buffer.alloc(tailLength)
    const { bytesRead } = await handle.read(tail, 0, tail.length, size - tailLength)
    const content = tail.subarray(0, bytesRead)
    let offset = -1
    for (let index = content.length - 22; index >= 0; index -= 1) {
      if (content.readUInt32LE(index) === 0x06054b50) {
        offset = index
        break
      }
    }
    if (offset < 0 || offset + 22 > content.length) {
      throw new Error('ZIP не содержит корректный центральный каталог')
    }
    const recordsOnDisk = content.readUInt16LE(offset + 8)
    const records = content.readUInt16LE(offset + 10)
    const centralBytes = content.readUInt32LE(offset + 12)
    if (
      records === 0xffff ||
      recordsOnDisk !== records ||
      records > RESOURCE_PACK_LIMITS.entries ||
      centralBytes > size
    ) {
      throw new Error('ZIP содержит слишком много записей или неподдерживаемый Zip64')
    }
  } finally {
    await handle.close()
  }
}

async function zipCandidates(
  sourcePath: string,
  signal: AbortSignal | undefined,
  diagnostics: ResourceDiagnostic[],
  sourceKind: NonNullable<ScanResourcePackOptions['sourceKind']>
): Promise<CandidateFile[]> {
  const zipInfo = await stat(sourcePath)
  if (!zipInfo.isFile()) throw new Error('Выбранный ZIP отсутствует')
  if (zipInfo.size > RESOURCE_PACK_LIMITS.archiveBytes) {
    throw new Error('ZIP ресурс-пака слишком большой')
  }
  await assertSafeZipDirectory(sourcePath, zipInfo.size)
  const archive = await Open.file(sourcePath, { tailSize: 65_558 })
  if (archive.files.length > RESOURCE_PACK_LIMITS.entries) {
    throw new Error('В ZIP слишком много записей')
  }

  const safeEntries = archive.files.flatMap((entry) => {
    const safePath = sanitizeArchiveEntryPath(entry.path)
    if (safePath === null) {
      diagnostics.push({
        severity: 'warning',
        code: 'unsafe-entry',
        message: 'Небезопасный путь ZIP проигнорирован',
        path: entry.path.slice(0, 500)
      })
      return []
    }
    if (entry.type !== 'File') return []
    if (isZipSymlink(entry)) {
      diagnostics.push({
        severity: 'warning',
        code: 'symlink-ignored',
        message: 'Символическая ссылка в ZIP проигнорирована',
        path: safePath
      })
      return []
    }
    if ((entry.flags & 1) !== 0) {
      diagnostics.push({
        severity: 'warning',
        code: 'encrypted-entry',
        message: 'Зашифрованная запись ZIP проигнорирована',
        path: safePath
      })
      return []
    }
    if (entry.compressionMethod !== 0 && entry.compressionMethod !== 8) {
      diagnostics.push({
        severity: 'warning',
        code: 'unsupported-compression',
        message: 'Неподдерживаемый метод сжатия ZIP',
        path: safePath
      })
      return []
    }
    return [{ path: safePath, entry }]
  })
  const prefix = sourceKind === 'vanilla-client' ? '' : wrapperPrefix(safeEntries)
  const candidates: CandidateFile[] = []
  for (const item of safeEntries) {
    abortIfNeeded(signal)
    if (!item.path.startsWith(prefix)) continue
    const withoutPrefix = item.path.slice(prefix.length)
    const logicalPath = normalizeLogicalPath(withoutPrefix)
    if (logicalPath === null || !isRelevantPath(logicalPath, sourceKind)) continue
    const { entry } = item
    const limit = limitForPath(logicalPath)
    if (
      entry.uncompressedSize < 0 ||
      entry.uncompressedSize > limit ||
      entry.compressedSize < 0 ||
      (entry.uncompressedSize > 0 && entry.compressedSize === 0) ||
      (entry.compressedSize > 0 &&
        entry.uncompressedSize / entry.compressedSize >
          RESOURCE_PACK_LIMITS.compressionRatio)
    ) {
      diagnostics.push({
        severity: 'warning',
        code: 'archive-limit',
        message: 'Запись ZIP превышает безопасный лимит',
        path: logicalPath
      })
      continue
    }
    candidates.push({
      logicalPath,
      size: entry.uncompressedSize,
      read: async () => {
        abortIfNeeded(signal)
        const content = await entry.buffer()
        if (content.byteLength > limit || content.byteLength !== entry.uncompressedSize) {
          throw new Error(`Размер ZIP-записи не совпадает: ${logicalPath}`)
        }
        if (crc32(content) !== entry.crc32) {
          throw new Error(`Контрольная сумма ZIP-записи не совпадает: ${logicalPath}`)
        }
        return content
      }
    })
  }
  return candidates
}

function manifestFingerprint(files: IndexedResourceFile[]): string {
  const hash = createHash('sha256')
  for (const file of [...files].sort((left, right) =>
    left.logicalPath.localeCompare(right.logicalPath, 'en-US')
  )) {
    hash.update(file.logicalPath)
    hash.update('\0')
    hash.update(file.sha256)
    hash.update('\0')
  }
  return hash.digest('hex')
}

export async function scanResourcePack(
  options: ScanResourcePackOptions
): Promise<ResourcePackIndex> {
  const diagnostics: ResourceDiagnostic[] = []
  const sourceKind = options.sourceKind ?? 'resource-pack'
  abortIfNeeded(options.signal)
  await mkdir(options.destinationPath, { recursive: true })
  const candidates =
    options.type === 'zip'
      ? await zipCandidates(
          options.sourcePath,
          options.signal,
          diagnostics,
          sourceKind
        )
      : await directoryCandidates(options.sourcePath, options.signal, diagnostics)
  options.onProgress?.({
    packId: options.packId,
    phase: 'indexing',
    processed: 0,
    total: candidates.length
  })

  const unique = new Map<string, CandidateFile>()
  for (const candidate of candidates) {
    if (unique.has(candidate.logicalPath)) {
      diagnostics.push({
        severity: 'warning',
        code: 'duplicate-resource',
        message: 'Повторяющийся ресурс проигнорирован',
        path: candidate.logicalPath
      })
      continue
    }
    unique.set(candidate.logicalPath, candidate)
  }
  if (sourceKind === 'resource-pack' && !unique.has('pack.mcmeta')) {
    throw new Error('Ресурс-пак не содержит pack.mcmeta')
  }
  if (
    sourceKind === 'vanilla-client' &&
    ![...unique.keys()].some((path) => path.startsWith('assets/minecraft/'))
  ) {
    throw new Error('Minecraft JAR не содержит ванильные ресурсы')
  }

  let totalBytes = 0
  let processed = 0
  const indexed: IndexedResourceFile[] = []
  for (const candidate of unique.values()) {
    abortIfNeeded(options.signal)
    const content = await candidate.read()
    if (content.byteLength > limitForPath(candidate.logicalPath)) {
      throw new Error(`Ресурс превышает безопасный лимит: ${candidate.logicalPath}`)
    }
    totalBytes += content.byteLength
    if (totalBytes > RESOURCE_PACK_LIMITS.totalRelevantBytes) {
      throw new Error('Распакованный ресурс-пак превышает безопасный лимит')
    }
    const destination = join(options.destinationPath, 'files', candidate.logicalPath)
    ensureContained(options.destinationPath, destination)
    await mkdir(dirname(destination), { recursive: true })
    await writeFile(destination, content, { flag: 'wx', mode: 0o600 })
    indexed.push({
      logicalPath: candidate.logicalPath,
      relativePath: relative(options.destinationPath, destination).split(sep).join('/'),
      size: content.byteLength,
      sha256: createHash('sha256').update(content).digest('hex')
    })
    processed += 1
    if (processed === candidates.length || processed % 25 === 0) {
      options.onProgress?.({
        packId: options.packId,
        phase: 'copying',
        processed,
        total: candidates.length
      })
    }
  }

  const mcmeta = indexed.find((file) => file.logicalPath === 'pack.mcmeta')
  const metadata =
    sourceKind === 'vanilla-client'
      ? {
          packFormat: null,
          description: `Ванильные ресурсы Minecraft ${
            options.vanillaVersion?.trim() || 'неизвестной версии'
          }`
        }
      : mcmeta === undefined
        ? (() => {
            throw new Error('Ресурс-пак не содержит pack.mcmeta')
          })()
        : parsePackMetadata(
            await readFile(
              join(options.destinationPath, mcmeta.relativePath),
              'utf8'
            )
          )
  const result: ResourcePackIndex = {
    version: 1,
    fingerprint: manifestFingerprint(indexed),
    ...(options.sourceSha256 === undefined
      ? {}
      : { sourceSha256: options.sourceSha256 }),
    metadata,
    files: indexed,
    diagnostics
  }
  await writeResourcePackIndex(options.destinationPath, result)
  options.onProgress?.({
    packId: options.packId,
    phase: 'complete',
    processed: indexed.length,
    total: indexed.length
  })
  return result
}

export async function readResourcePackIndex(
  cachePath: string
): Promise<ResourcePackIndex | null> {
  try {
    const indexPath = join(cachePath, 'index.json')
    const indexInfo = await stat(indexPath)
    if (!indexInfo.isFile() || indexInfo.size > RESOURCE_PACK_LIMITS.indexBytes) {
      return null
    }
    const content = await readFile(indexPath, 'utf8')
    const value: unknown = JSON.parse(content) as unknown
    const item = record(value)
    if (
      item === null ||
      item.version !== 1 ||
      typeof item.fingerprint !== 'string' ||
      !/^[a-f0-9]{64}$/i.test(item.fingerprint) ||
      !Array.isArray(item.files) ||
      item.files.length > RESOURCE_PACK_LIMITS.entries
    ) return null
    const metadata = record(item.metadata)
    if (
      metadata === null ||
      (metadata.packFormat !== null &&
        (typeof metadata.packFormat !== 'number' ||
          !Number.isInteger(metadata.packFormat))) ||
      typeof metadata.description !== 'string'
    ) return null
    const files: IndexedResourceFile[] = []
    for (const value of item.files) {
      const file = record(value)
      if (
        file === null ||
        typeof file.logicalPath !== 'string' ||
        normalizeLogicalPath(file.logicalPath) === null ||
        typeof file.relativePath !== 'string' ||
        typeof file.size !== 'number' ||
        !Number.isInteger(file.size) ||
        file.size < 0 ||
        file.size > limitForPath(file.logicalPath) ||
        typeof file.sha256 !== 'string' ||
        !/^[a-f0-9]{64}$/i.test(file.sha256)
      ) {
        return null
      }
      const expectedRelative = `files/${file.logicalPath}`
      if (file.relativePath.replaceAll('\\', '/') !== expectedRelative) return null
      ensureContained(cachePath, join(cachePath, file.relativePath))
      files.push({
        logicalPath: file.logicalPath,
        relativePath: expectedRelative,
        size: file.size,
        sha256: file.sha256
      })
    }
    const diagnostics = Array.isArray(item.diagnostics)
      ? item.diagnostics.flatMap((value): ResourceDiagnostic[] => {
          const entry = record(value)
          if (
            entry === null ||
            (entry.severity !== 'info' &&
              entry.severity !== 'warning' &&
              entry.severity !== 'error') ||
            typeof entry.code !== 'string' ||
            typeof entry.message !== 'string'
          ) return []
          return [{
            severity: entry.severity,
            code: entry.code.slice(0, 80),
            message: entry.message.slice(0, 500),
            ...(typeof entry.path === 'string' ? { path: entry.path.slice(0, 500) } : {})
          }]
        })
      : []
    return {
      version: 1,
      fingerprint: item.fingerprint,
      ...(typeof item.sourceSha256 === 'string' &&
      /^[a-f0-9]{64}$/i.test(item.sourceSha256)
        ? { sourceSha256: item.sourceSha256 }
        : {}),
      metadata: {
        packFormat: metadata.packFormat,
        description: metadata.description.slice(0, 500)
      },
      files,
      diagnostics
    }
  } catch {
    return null
  }
}

export async function fileSha256(filePath: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(filePath)) {
    hash.update(chunk as Buffer)
  }
  return hash.digest('hex')
}

export async function sourceSignature(
  sourcePath: string,
  type: ResourcePackType
): Promise<string | null> {
  try {
    const info = await stat(sourcePath)
    if (type === 'zip' ? !info.isFile() : !info.isDirectory()) return null
    return `${info.size}:${Math.floor(info.mtimeMs)}`
  } catch {
    return null
  }
}
