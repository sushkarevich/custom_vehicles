// @vitest-environment node

import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  utimes,
  writeFile
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ResourcePreviewManager } from './resource-preview-manager'

const temporaryDirectories: string[] = []
const PNG = Buffer.from([
  137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82
])

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

function storedZip(entries: Array<{ name: string; content: string | Buffer }>): Buffer {
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
    directory.writeUInt32LE(checksum, 16)
    directory.writeUInt32LE(content.length, 20)
    directory.writeUInt32LE(content.length, 24)
    directory.writeUInt16LE(name.length, 28)
    directory.writeUInt32LE((0o100600 << 16) >>> 0, 38)
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

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    )
  )
})

async function root(): Promise<string> {
  const result = await mkdtemp(join(tmpdir(), 'Настройки ресурсов '))
  temporaryDirectories.push(result)
  return result
}

function createManager(userDataPath: string): Promise<ResourcePreviewManager> {
  return ResourcePreviewManager.create(userDataPath, {
    autoDiscoverVanilla: false
  })
}

async function makeTexturePack(
  directory: string,
  name: string,
  material = 'stone',
  bytes = Buffer.from(`texture:${name}`)
): Promise<string> {
  const source = join(directory, name)
  await mkdir(join(source, 'assets/minecraft/textures/block'), {
    recursive: true
  })
  await writeFile(
    join(source, 'pack.mcmeta'),
    JSON.stringify({
      pack: { pack_format: 34, description: name }
    })
  )
  await writeFile(
    join(source, `assets/minecraft/textures/block/${material}.png`),
    bytes
  )
  return source
}

async function makeVanillaInstallation(
  directory: string,
  texture = Buffer.from('vanilla-stone')
): Promise<{ versions: string; jar: string }> {
  const versions = join(directory, 'Лаунчер с пробелами', 'versions')
  const versionRoot = join(versions, '1.21.1')
  await mkdir(versionRoot, { recursive: true })
  const jar = join(versionRoot, '1.21.1.jar')
  await writeFile(
    jar,
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
        name: 'assets/minecraft/textures/block/stone.png',
        content: texture
      }
    ])
  )
  await writeFile(
    join(versionRoot, '1.21.1.json'),
    JSON.stringify({ id: '1.21.1', type: 'release' })
  )
  return { versions, jar }
}

describe('resource preview manager persistence and priority', () => {
  it('persists imported directory packs and resolves opaque managed assets', async () => {
    const directory = await root()
    const userData = join(directory, 'user data')
    const source = await makeTexturePack(directory, 'Пак метро')
    const manager = await createManager(userData)

    const state = await manager.addPack('directory', source)
    expect(state.packs).toHaveLength(1)
    expect(state.packs[0]).toMatchObject({
      name: 'Пак метро',
      type: 'directory',
      enabled: true,
      missing: false,
      metadata: { packFormat: 34 }
    })

    const resolved = await manager.resolveMaterials(['STONE'])
    const face = resolved.materials[0]?.faces.top
    expect(face).toMatchObject({
      sourceName: 'Пак метро',
      sourcePackId: state.packs[0]?.id
    })
    expect(face?.assetToken).toMatch(/^rp_[a-f0-9]{64}$/)
    expect(Buffer.from(await manager.readAsset(face?.assetToken ?? ''))).toEqual(
      Buffer.from('texture:Пак метро')
    )

    const settings = JSON.parse(
      await readFile(join(userData, 'resource-preview/settings.json'), 'utf8')
    ) as { packs: Array<{ sourcePath: string }> }
    expect(settings.packs[0]?.sourcePath).toBe(source)

    manager.dispose()
    const reloaded = await createManager(userData)
    const reloadedResult = await reloaded.resolveMaterials(['STONE'])
    expect(reloadedResult.materials[0]?.source).toBe('resource-pack')
    reloaded.dispose()
  })

  it('applies pack order/enable state and invalidates a missing source safely', async () => {
    const directory = await root()
    const userData = join(directory, 'userData')
    const lower = await makeTexturePack(directory, 'Нижний')
    const higher = await makeTexturePack(directory, 'Верхний')
    const manager = await createManager(userData)
    const lowerState = await manager.addPack('directory', lower)
    const lowerId = lowerState.packs[0]?.id
    const highState = await manager.addPack('directory', higher)
    const highId = highState.packs[0]?.id
    if (lowerId === undefined || highId === undefined) throw new Error('missing pack id')

    expect((await manager.resolveMaterials(['STONE'])).materials[0]?.sourceName).toBe(
      'Верхний'
    )
    await manager.setPackEnabled(highId, false)
    expect((await manager.resolveMaterials(['STONE'])).materials[0]?.sourceName).toBe(
      'Нижний'
    )
    await manager.setPackEnabled(highId, true)
    await manager.movePack(highId, 'lower')
    expect((await manager.resolveMaterials(['STONE'])).materials[0]?.sourceName).toBe(
      'Нижний'
    )

    await rm(lower, { recursive: true, force: true })
    const missing = await manager.getState()
    expect(missing.packs.find((pack) => pack.id === lowerId)).toMatchObject({
      missing: true
    })
    expect(
      missing.packs
        .find((pack) => pack.id === lowerId)
        ?.diagnostics.some((entry) => entry.code === 'source-missing')
    ).toBe(true)
    manager.dispose()
  })

  it('bumps the effective revision, emits state and drops cached previews when a source disappears', async () => {
    const directory = await root()
    const source = await makeTexturePack(directory, 'Исчезающий пак')
    const manager = await createManager(
      join(directory, 'presence-userdata')
    )
    await manager.addPack('directory', source)
    const emittedRevisions: number[] = []
    manager.subscribe((event) => {
      if (event.type === 'state') emittedRevisions.push(event.state.revision)
    })

    const before = await manager.resolveMaterials(['STONE'])
    const oldToken = before.materials[0]?.faces.top?.assetToken
    expect(before.materials[0]?.source).toBe('resource-pack')
    await rm(source, { recursive: true, force: true })

    const missing = await manager.getState()
    expect(missing.revision).toBeGreaterThan(before.revision)
    expect(missing.packs[0]).toMatchObject({ missing: true })
    expect(emittedRevisions.at(-1)).toBe(missing.revision)

    const after = await manager.resolveMaterials(['STONE'])
    expect(after.revision).toBe(missing.revision)
    expect(after.materials[0]?.source).toBe('fallback-color')
    await expect(manager.readAsset(oldToken ?? '')).rejects.toThrow(
      'не зарегистрирована'
    )
    manager.dispose()
  })

  it('invalidates cached previews when an imported source becomes stale', async () => {
    const directory = await root()
    const source = await makeTexturePack(directory, 'Изменённый пак')
    const manager = await createManager(
      join(directory, 'stale-userdata')
    )
    await manager.addPack('directory', source)
    const before = await manager.resolveMaterials(['STONE'])
    expect(before.materials[0]?.source).toBe('resource-pack')

    const changedTime = new Date(Date.now() + 60_000)
    await utimes(source, changedTime, changedTime)
    const stale = await manager.getState()

    expect(stale.revision).toBeGreaterThan(before.revision)
    expect(stale.packs[0]).toMatchObject({ missing: false })
    expect(
      stale.packs[0]?.diagnostics.some(
        (diagnostic) => diagnostic.code === 'source-changed'
      )
    ).toBe(true)
    expect(
      (await manager.resolveMaterials(['STONE'])).materials[0]?.source
    ).toBe('fallback-color')
    manager.dispose()
  })

  it('copies and persists a decoded manual PNG above packs', async () => {
    const directory = await root()
    const userData = join(directory, 'userdata')
    const sourcePack = await makeTexturePack(directory, 'Pack', 'acacia_planks')
    const manualSource = join(directory, 'ручная текстура.png')
    await writeFile(manualSource, PNG)
    const manager = await createManager(userData)
    await manager.addPack('directory', sourcePack)

    const state = await manager.importManualTexture(
      'ACACIA_PLANKS',
      'all',
      manualSource,
      (content) => ({ png: content, width: 16, height: 16 })
    )
    expect(state.manualTextures).toHaveLength(1)
    expect(state.manualTextures[0]).toMatchObject({
      material: 'ACACIA_PLANKS',
      face: 'all',
      originalName: 'ручная текстура.png'
    })
    await rm(manualSource)

    const resolved = await manager.resolveMaterials(['ACACIA_PLANKS'])
    expect(resolved.materials[0]?.source).toBe('manual')
    const token = resolved.materials[0]?.faces.top?.assetToken
    expect(Buffer.from(await manager.readAsset(token ?? ''))).toEqual(PNG)
    await manager.setMode('colors')
    expect(Buffer.from(await manager.readAsset(token ?? ''))).toEqual(PNG)
    manager.dispose()

    const reloaded = await createManager(userData)
    expect((await reloaded.resolveMaterials(['ACACIA_PLANKS'])).materials[0]?.source).toBe(
      'manual'
    )
    await reloaded.clearManualTexture('ACACIA_PLANKS', 'all')
    expect((await reloaded.resolveMaterials(['ACACIA_PLANKS'])).materials[0]?.source).toBe(
      'resource-pack'
    )
    reloaded.dispose()
  })

  it('rejects arbitrary asset tokens and invalid manual imports', async () => {
    const directory = await root()
    const manager = await createManager(join(directory, 'data'))
    const invalid = join(directory, 'not really.png')
    await writeFile(invalid, 'not png')

    await expect(manager.readAsset('../../etc/passwd')).rejects.toThrow(
      'Некорректный токен'
    )
    await expect(
      manager.importManualTexture('STONE', 'all', invalid, () => ({
        png: PNG,
        width: 16,
        height: 16
      }))
    ).rejects.toThrow('не является PNG')
    await expect(manager.resolveMaterials(['NOT_A_MATERIAL'])).rejects.toThrow(
      'Неизвестный'
    )
    manager.dispose()
  })

  it('discovers 1.21.1, reuses its cache and invalidates it when the JAR changes', async () => {
    const directory = await root()
    const userData = join(directory, 'vanilla userData')
    const installation = await makeVanillaInstallation(directory)
    const options = {
      discovery: { versionsDirectory: installation.versions }
    }
    const manager = await ResourcePreviewManager.create(userData, options)
    const initial = await manager.getState()
    expect(initial.vanilla).toMatchObject({
      version: '1.21.1',
      sourceKind: 'automatic',
      ready: true,
      missing: false,
      cacheReused: false
    })
    const first = await manager.resolveMaterials(['STONE'])
    expect(first.materials[0]).toMatchObject({
      source: 'vanilla',
      sourceName: 'Ванильные ресурсы Minecraft 1.21.1'
    })
    const firstToken = first.materials[0]?.faces.top?.assetToken ?? ''
    expect(Buffer.from(await manager.readAsset(firstToken))).toEqual(
      Buffer.from('vanilla-stone')
    )
    manager.dispose()

    const reloaded = await ResourcePreviewManager.create(userData, options)
    expect((await reloaded.getState()).vanilla).toMatchObject({
      ready: true,
      cacheReused: true
    })
    reloaded.dispose()

    await writeFile(
      installation.jar,
      storedZip([
        {
          name: 'assets/minecraft/textures/block/stone.png',
          content: Buffer.from('changed-vanilla-stone')
        }
      ])
    )
    const changedTime = new Date(Date.now() + 60_000)
    await utimes(installation.jar, changedTime, changedTime)
    const rebuilt = await ResourcePreviewManager.create(userData, options)
    const rebuiltState = await rebuilt.getState()
    expect(rebuiltState.vanilla).toMatchObject({
      ready: true,
      cacheReused: false
    })
    const changed = await rebuilt.resolveMaterials(['STONE'])
    const changedToken = changed.materials[0]?.faces.top?.assetToken ?? ''
    expect(Buffer.from(await rebuilt.readAsset(changedToken))).toEqual(
      Buffer.from('changed-vanilla-stone')
    )
    rebuilt.dispose()
  })

  it('keeps manual JAR selection safe when the source is moved', async () => {
    const directory = await root()
    const installation = await makeVanillaInstallation(directory)
    const userData = join(directory, 'manual vanilla userData')
    const manager = await createManager(userData)
    await manager.selectVanillaJar(installation.jar)
    expect((await manager.getState()).vanilla).toMatchObject({
      sourceKind: 'manual',
      ready: true
    })
    manager.dispose()

    await rm(installation.jar)
    const reloaded = await createManager(userData)
    const state = await reloaded.getState()
    expect(state.vanilla).toMatchObject({
      sourceKind: 'manual',
      missing: true,
      ready: false
    })
    expect(
      state.vanilla.diagnostics.some(
        (diagnostic) => diagnostic.code === 'vanilla-source-missing'
      )
    ).toBe(true)
    expect(
      (await reloaded.resolveMaterials(['STONE'])).materials[0]?.source
    ).toBe('fallback-color')
    reloaded.dispose()
  })

  it('resolves manual override above imported pack above vanilla above color', async () => {
    const directory = await root()
    const installation = await makeVanillaInstallation(directory)
    const userData = join(directory, 'priority userData')
    const imported = await makeTexturePack(
      directory,
      'Импортированный',
      'stone',
      Buffer.from('imported-stone')
    )
    const manualSource = join(directory, 'ручной stone.png')
    await writeFile(manualSource, PNG)
    const manager = await ResourcePreviewManager.create(userData, {
      discovery: { versionsDirectory: installation.versions }
    })

    expect(
      (await manager.resolveMaterials(['STONE'])).materials[0]?.source
    ).toBe('vanilla')
    const packState = await manager.addPack('directory', imported)
    const packId = packState.packs[0]?.id ?? ''
    expect(
      (await manager.resolveMaterials(['STONE'])).materials[0]?.sourceName
    ).toBe('Импортированный')

    await manager.importManualTexture(
      'STONE',
      'all',
      manualSource,
      (content) => ({ png: content, width: 16, height: 16 })
    )
    expect(
      (await manager.resolveMaterials(['STONE'])).materials[0]?.source
    ).toBe('manual')
    await manager.clearManualTexture('STONE', 'all')
    expect(
      (await manager.resolveMaterials(['STONE'])).materials[0]?.sourceName
    ).toBe('Импортированный')

    await manager.setPackEnabled(packId, false)
    expect(
      (await manager.resolveMaterials(['STONE'])).materials[0]?.source
    ).toBe('vanilla')
    await manager.setVanillaEnabled(false)
    expect(
      (await manager.resolveMaterials(['STONE'])).materials[0]?.source
    ).toBe('fallback-color')
    manager.dispose()
  })
})
