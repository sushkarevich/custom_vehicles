// @vitest-environment node

import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  parsePackMetadata,
  readResourcePackIndex,
  sanitizeArchiveEntryPath,
  scanResourcePack,
  writeResourcePackIndex,
  type ResourcePackIndex
} from './resource-pack-scanner'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    )
  )
})

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

interface ZipFixtureEntry {
  name: string
  content: string | Buffer
  unixMode?: number
}

function storedZip(entries: ZipFixtureEntry[]): Buffer {
  const locals: Buffer[] = []
  const central: Buffer[] = []
  let offset = 0
  for (const fixture of entries) {
    const name = Buffer.from(fixture.name, 'utf8')
    const content = Buffer.isBuffer(fixture.content)
      ? fixture.content
      : Buffer.from(fixture.content, 'utf8')
    const checksum = crc32(content)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0x800, 6)
    local.writeUInt16LE(0, 8)
    local.writeUInt32LE(checksum, 14)
    local.writeUInt32LE(content.length, 18)
    local.writeUInt32LE(content.length, 22)
    local.writeUInt16LE(name.length, 26)
    locals.push(local, name, content)

    const directory = Buffer.alloc(46)
    directory.writeUInt32LE(0x02014b50, 0)
    directory.writeUInt16LE((3 << 8) | 20, 4)
    directory.writeUInt16LE(20, 6)
    directory.writeUInt16LE(0x800, 8)
    directory.writeUInt16LE(0, 10)
    directory.writeUInt32LE(checksum, 16)
    directory.writeUInt32LE(content.length, 20)
    directory.writeUInt32LE(content.length, 24)
    directory.writeUInt16LE(name.length, 28)
    directory.writeUInt32LE(((fixture.unixMode ?? 0o100600) << 16) >>> 0, 38)
    directory.writeUInt32LE(offset, 42)
    central.push(directory, name)
    offset += local.length + name.length + content.length
  }
  const centralBytes = Buffer.concat(central)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(centralBytes.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, centralBytes, end])
}

async function temporaryRoot(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'Ресурс паки '))
  temporaryDirectories.push(directory)
  return directory
}

describe('resource-pack scanner security', () => {
  it('normalizes only safe archive entry paths', () => {
    expect(sanitizeArchiveEntryPath('assets/minecraft/textures/block/stone.png')).toBe(
      'assets/minecraft/textures/block/stone.png'
    )
    expect(sanitizeArchiveEntryPath('../escape.png')).toBeNull()
    expect(sanitizeArchiveEntryPath('folder\\..\\escape.png')).toBeNull()
    expect(sanitizeArchiveEntryPath('/absolute/escape.png')).toBeNull()
    expect(sanitizeArchiveEntryPath('C:\\escape.png')).toBeNull()
    expect(sanitizeArchiveEntryPath('safe/\0bad.png')).toBeNull()
  })

  it('reads pack.mcmeta text components conservatively', () => {
    expect(
      parsePackMetadata(
        JSON.stringify({
          pack: {
            pack_format: 34,
            description: { text: 'Метро ', extra: [{ text: '717' }] }
          }
        })
      )
    ).toEqual({ packFormat: 34, description: 'Метро 717' })
    expect(() => parsePackMetadata('{bad')).toThrow('некорректный JSON')
  })

  it('imports a directory with Unicode/spaces into a managed index', async () => {
    const root = await temporaryRoot()
    const source = join(root, 'Пак с пробелами')
    const destination = join(root, 'managed cache')
    await mkdir(join(source, 'assets/minecraft/models/block'), { recursive: true })
    await mkdir(join(source, 'assets/minecraft/textures/block'), { recursive: true })
    await writeFile(
      join(source, 'pack.mcmeta'),
      JSON.stringify({ pack: { pack_format: 34, description: 'Тестовый пак' } })
    )
    await writeFile(
      join(source, 'assets/minecraft/models/block/stone.json'),
      JSON.stringify({
        parent: 'minecraft:block/cube_all',
        textures: { all: 'minecraft:block/stone' }
      })
    )
    await writeFile(
      join(source, 'assets/minecraft/textures/block/stone.png'),
      Buffer.from('not-decoded-during-scan')
    )

    const index = await scanResourcePack({
      type: 'directory',
      sourcePath: source,
      destinationPath: destination,
      packId: 'pack-directory'
    })

    expect(index.metadata).toEqual({
      packFormat: 34,
      description: 'Тестовый пак'
    })
    expect(index.files.map((file) => file.logicalPath).sort()).toEqual([
      'assets/minecraft/models/block/stone.json',
      'assets/minecraft/textures/block/stone.png',
      'pack.mcmeta'
    ])
    expect(await readResourcePackIndex(destination)).toMatchObject({
      fingerprint: index.fingerprint
    })
  })

  it('writes a valid large pack index with its own limit above the settings cap', async () => {
    const root = await temporaryRoot()
    const longStem = 'a'.repeat(360)
    const files = Array.from({ length: 3_000 }, (_, index) => {
      const logicalPath = `assets/minecraft/models/block/${longStem}_${index}.json`
      return {
        logicalPath,
        relativePath: `files/${logicalPath}`,
        size: 1,
        sha256: 'a'.repeat(64)
      }
    })
    const index: ResourcePackIndex = {
      version: 1,
      fingerprint: 'b'.repeat(64),
      metadata: { packFormat: 34, description: 'Большой индекс' },
      files,
      diagnostics: []
    }

    await writeResourcePackIndex(root, index)
    const content = await readFile(join(root, 'index.json'))
    expect(content.byteLength).toBeGreaterThan(2 * 1024 * 1024)
    expect((await readResourcePackIndex(root))?.files).toHaveLength(files.length)
  })

  it('imports a wrapped ZIP while rejecting Zip Slip and symlink entries', async () => {
    const root = await temporaryRoot()
    const source = join(root, 'архив pack.zip')
    const destination = join(root, 'cache')
    await writeFile(
      source,
      storedZip([
        {
          name: 'wrapper/pack.mcmeta',
          content: JSON.stringify({
            pack: { pack_format: 34, description: 'ZIP pack' }
          })
        },
        {
          name: 'wrapper/assets/minecraft/textures/block/stone.png',
          content: Buffer.from('texture')
        },
        { name: '../outside.txt', content: 'escape' },
        {
          name: 'wrapper/assets/minecraft/textures/block/link.png',
          content: '../../outside',
          unixMode: 0o120777
        }
      ])
    )

    const index = await scanResourcePack({
      type: 'zip',
      sourcePath: source,
      destinationPath: destination,
      packId: 'pack-zip'
    })

    expect(index.files.map((file) => file.logicalPath)).toEqual([
      'pack.mcmeta',
      'assets/minecraft/textures/block/stone.png'
    ])
    expect(index.diagnostics.map((entry) => entry.code)).toEqual(
      expect.arrayContaining(['unsafe-entry', 'symlink-ignored'])
    )
    await expect(readFile(join(root, 'outside.txt'))).rejects.toThrow()
  })

  it('securely indexes a vanilla client JAR without pack.mcmeta', async () => {
    const root = await temporaryRoot()
    const source = join(root, 'Minecraft клиент 1.21.1.jar')
    const destination = join(root, 'vanilla cache')
    await writeFile(
      source,
      storedZip([
        {
          name: 'assets/minecraft/blockstates/stone.json',
          content: JSON.stringify({
            variants: { '': { model: 'minecraft:block/stone' } }
          })
        },
        {
          name: 'assets/minecraft/models/block/stone.json',
          content: JSON.stringify({
            parent: 'minecraft:block/cube_all',
            textures: { all: 'minecraft:block/stone' }
          })
        },
        {
          name: 'assets/minecraft/models/custom/relevant_parent.json',
          content: JSON.stringify({ parent: 'minecraft:block/cube_all' })
        },
        {
          name: 'assets/minecraft/textures/block/stone.png',
          content: Buffer.from('vanilla stone')
        },
        {
          name: 'assets/other/textures/block/ignored.png',
          content: Buffer.from('other namespace')
        },
        { name: '../escape.txt', content: 'escape' }
      ])
    )

    const index = await scanResourcePack({
      type: 'zip',
      sourceKind: 'vanilla-client',
      sourcePath: source,
      destinationPath: destination,
      packId: 'vanilla-minecraft',
      vanillaVersion: '1.21.1',
      sourceSha256: 'c'.repeat(64)
    })

    expect(index.metadata).toEqual({
      packFormat: null,
      description: 'Ванильные ресурсы Minecraft 1.21.1'
    })
    expect(index.sourceSha256).toBe('c'.repeat(64))
    expect(index.files.map((file) => file.logicalPath).sort()).toEqual([
      'assets/minecraft/blockstates/stone.json',
      'assets/minecraft/models/block/stone.json',
      'assets/minecraft/models/custom/relevant_parent.json',
      'assets/minecraft/textures/block/stone.png'
    ])
    expect(index.diagnostics.map((entry) => entry.code)).toContain(
      'unsafe-entry'
    )
    await expect(readFile(join(root, 'escape.txt'))).rejects.toThrow()
  })
})
