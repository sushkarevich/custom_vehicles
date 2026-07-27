import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { open, readdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, extname, isAbsolute, join } from 'node:path'
import {
  PREFERRED_MINECRAFT_VERSION,
  type DetectedMinecraftVersion
} from '../shared/resource-preview'

const MAX_VERSION_METADATA_BYTES = 2 * 1024 * 1024

export interface MinecraftVersionMetadata {
  id: string
  releaseType: string | null
  inheritedJarVersion: string | null
  clientSize: number | null
  clientSha1: string | null
}

export interface MinecraftDiscoveryOptions {
  platform?: NodeJS.Platform
  homeDirectory?: string
  appDataDirectory?: string
  versionsDirectory?: string
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

export function parseMinecraftVersionMetadata(
  content: string
): MinecraftVersionMetadata {
  const value: unknown = JSON.parse(content) as unknown
  const item = record(value)
  if (item === null || typeof item.id !== 'string' || item.id.trim().length === 0) {
    throw new Error('Метаданные версии Minecraft не содержат ID')
  }
  const downloads = record(item.downloads)
  const client = record(downloads?.client)
  return {
    id: item.id.trim().slice(0, 160),
    releaseType:
      typeof item.type === 'string' ? item.type.trim().slice(0, 80) : null,
    inheritedJarVersion:
      typeof item.jar === 'string' && item.jar.trim().length > 0
        ? item.jar.trim().slice(0, 160)
        : null,
    clientSize:
      typeof client?.size === 'number' &&
      Number.isInteger(client.size) &&
      client.size >= 0
        ? client.size
        : null,
    clientSha1:
      typeof client?.sha1 === 'string' && /^[a-f0-9]{40}$/i.test(client.sha1)
        ? client.sha1.toLocaleLowerCase('en-US')
        : null
  }
}

async function readVersionMetadata(
  filePath: string
): Promise<MinecraftVersionMetadata | null> {
  try {
    const handle = await open(filePath, constants.O_RDONLY)
    try {
      const info = await handle.stat()
      if (!info.isFile() || info.size > MAX_VERSION_METADATA_BYTES) return null
      return parseMinecraftVersionMetadata(
        await handle.readFile({ encoding: 'utf8' })
      )
    } finally {
      await handle.close()
    }
  } catch {
    return null
  }
}

export function minecraftVersionsDirectory(
  options: MinecraftDiscoveryOptions = {}
): string | null {
  if (options.versionsDirectory !== undefined) return options.versionsDirectory
  const platform = options.platform ?? process.platform
  if (platform === 'darwin') {
    return join(
      options.homeDirectory ?? homedir(),
      'Library',
      'Application Support',
      'minecraft',
      'versions'
    )
  }
  if (platform === 'win32') {
    const appData = options.appDataDirectory ?? process.env.APPDATA
    return appData === undefined || appData.length === 0
      ? null
      : join(appData, '.minecraft', 'versions')
  }
  return null
}

export function isCompatibleMinecraftVersion(version: string): boolean {
  return /^1\.21(?:\.\d+)?$/.test(version)
}

function numericVersionParts(version: string): number[] | null {
  if (!/^\d+(?:\.\d+)*$/.test(version)) return null
  return version.split('.').map(Number)
}

function compareVersionDescending(left: string, right: string): number {
  const leftParts = numericVersionParts(left)
  const rightParts = numericVersionParts(right)
  if (leftParts === null || rightParts === null) {
    return right.localeCompare(left, 'en-US', { numeric: true })
  }
  const length = Math.max(leftParts.length, rightParts.length)
  for (let index = 0; index < length; index += 1) {
    const difference = (rightParts[index] ?? 0) - (leftParts[index] ?? 0)
    if (difference !== 0) return difference
  }
  return 0
}

function candidateId(jarPath: string, version: string): string {
  return `mc_${createHash('sha256')
    .update(jarPath)
    .update('\0')
    .update(version)
    .digest('hex')}`
}

function candidate(
  jarPath: string,
  metadata: MinecraftVersionMetadata | null,
  fallbackVersion: string
): DetectedMinecraftVersion {
  const version = metadata?.id ?? fallbackVersion
  return {
    id: candidateId(jarPath, version),
    version,
    jarPath,
    releaseType: metadata?.releaseType ?? null,
    compatible: isCompatibleMinecraftVersion(version),
    preferred: version === PREFERRED_MINECRAFT_VERSION,
    metadataAvailable: metadata !== null
  }
}

async function existingJar(paths: string[]): Promise<string | null> {
  for (const filePath of [...new Set(paths)]) {
    try {
      const info = await stat(filePath)
      if (info.isFile()) return filePath
    } catch {
      // Continue through launcher-specific candidates.
    }
  }
  return null
}

export function sortDetectedMinecraftVersions(
  versions: readonly DetectedMinecraftVersion[]
): DetectedMinecraftVersion[] {
  return [...versions].sort((left, right) => {
    if (left.preferred !== right.preferred) return left.preferred ? -1 : 1
    if (left.compatible !== right.compatible) return left.compatible ? -1 : 1
    const versionOrder = compareVersionDescending(left.version, right.version)
    return (
      versionOrder ||
      left.jarPath.localeCompare(right.jarPath, 'en-US')
    )
  })
}

export function preferredMinecraftVersion(
  versions: readonly DetectedMinecraftVersion[]
): DetectedMinecraftVersion | null {
  return sortDetectedMinecraftVersions(versions)[0] ?? null
}

export async function discoverInstalledMinecraftVersions(
  options: MinecraftDiscoveryOptions = {}
): Promise<DetectedMinecraftVersion[]> {
  const versionsRoot = minecraftVersionsDirectory(options)
  if (versionsRoot === null) return []
  let directories
  try {
    directories = await readdir(versionsRoot, { withFileTypes: true })
  } catch {
    return []
  }
  const detected: DetectedMinecraftVersion[] = []
  for (const entry of directories) {
    if (!entry.isDirectory()) continue
    const versionRoot = join(versionsRoot, entry.name)
    let children
    try {
      children = await readdir(versionRoot, { withFileTypes: true })
    } catch {
      continue
    }
    const jsonNames = children
      .filter((child) => child.isFile() && extname(child.name) === '.json')
      .map((child) => child.name)
      .sort((left, right) => {
        const expected = `${entry.name}.json`
        if (left === expected) return -1
        if (right === expected) return 1
        return left.localeCompare(right, 'en-US')
      })
    const metadata =
      jsonNames.length === 0
        ? null
        : await readVersionMetadata(join(versionRoot, jsonNames[0] ?? ''))
    const inherited = metadata?.inheritedJarVersion
    const jarPath = await existingJar([
      join(versionRoot, `${entry.name}.jar`),
      ...(metadata === null
        ? []
        : [join(versionRoot, `${metadata.id}.jar`)]),
      ...(inherited === null || inherited === undefined
        ? []
        : [join(versionsRoot, inherited, `${inherited}.jar`)])
    ])
    if (jarPath === null) continue
    detected.push(candidate(jarPath, metadata, entry.name))
  }
  const unique = new Map<string, DetectedMinecraftVersion>()
  for (const version of detected) {
    const key = `${version.jarPath}\0${version.version}`
    if (!unique.has(key)) unique.set(key, version)
  }
  return sortDetectedMinecraftVersions([...unique.values()])
}

export async function inspectSelectedMinecraftJar(
  jarPath: string
): Promise<DetectedMinecraftVersion> {
  if (!isAbsolute(jarPath) || extname(jarPath).toLocaleLowerCase('en-US') !== '.jar') {
    throw new Error('Выберите client JAR Minecraft')
  }
  const info = await stat(jarPath)
  if (!info.isFile()) throw new Error('Выбранный Minecraft JAR отсутствует')
  const adjacentMetadata = `${jarPath.slice(0, -extname(jarPath).length)}.json`
  const metadata = await readVersionMetadata(adjacentMetadata)
  return candidate(
    jarPath,
    metadata,
    basename(jarPath, extname(jarPath)).slice(0, 160)
  )
}
