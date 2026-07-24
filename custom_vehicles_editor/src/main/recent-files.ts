import { basename } from 'node:path'
import type { RecentDocument } from '../shared/ipc'
import { pathExists, readDocumentFile, writeFileAtomically } from './file-system'

const MAX_RECENT_FILES = 10

interface RecentFileStorage {
  version: 1
  files: Array<{
    filePath: string
    lastOpenedAt: string
  }>
}

export class RecentFiles {
  readonly #storagePath: string

  public constructor(storagePath: string) {
    this.#storagePath = storagePath
  }

  async #read(): Promise<RecentFileStorage> {
    try {
      const text = await readDocumentFile(this.#storagePath)
      const value: unknown = JSON.parse(text)
      if (
        typeof value !== 'object' ||
        value === null ||
        !('version' in value) ||
        !('files' in value) ||
        value.version !== 1 ||
        !Array.isArray(value.files)
      ) {
        return { version: 1, files: [] }
      }
      const files = (value.files as unknown[]).flatMap((entry): RecentFileStorage['files'] => {
        if (
          typeof entry === 'object' &&
          entry !== null &&
          'filePath' in entry &&
          'lastOpenedAt' in entry &&
          typeof entry.filePath === 'string' &&
          typeof entry.lastOpenedAt === 'string'
        ) {
          return [{ filePath: entry.filePath, lastOpenedAt: entry.lastOpenedAt }]
        }
        return []
      })
      return { version: 1, files }
    } catch {
      return { version: 1, files: [] }
    }
  }

  async list(): Promise<RecentDocument[]> {
    const storage = await this.#read()
    const existing: RecentDocument[] = []
    for (const entry of storage.files) {
      if (await pathExists(entry.filePath)) {
        existing.push({
          filePath: entry.filePath,
          displayName: basename(entry.filePath),
          lastOpenedAt: entry.lastOpenedAt
        })
      }
    }
    if (existing.length !== storage.files.length) {
      await this.#write(existing)
    }
    return existing
  }

  async touch(filePath: string): Promise<void> {
    const storage = await this.#read()
    const files = [
      { filePath, lastOpenedAt: new Date().toISOString() },
      ...storage.files.filter((entry) => entry.filePath !== filePath)
    ].slice(0, MAX_RECENT_FILES)
    await this.#write(files)
  }

  async contains(filePath: string): Promise<boolean> {
    const storage = await this.#read()
    return storage.files.some((entry) => entry.filePath === filePath)
  }

  async #write(
    entries: Array<{ filePath: string; lastOpenedAt: string } | RecentDocument>
  ): Promise<void> {
    const storage: RecentFileStorage = {
      version: 1,
      files: entries.map((entry) => ({
        filePath: entry.filePath,
        lastOpenedAt: entry.lastOpenedAt
      }))
    }
    await writeFileAtomically(this.#storagePath, `${JSON.stringify(storage, null, 2)}\n`)
  }
}
