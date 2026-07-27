// @vitest-environment node

import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  discoverInstalledMinecraftVersions,
  inspectSelectedMinecraftJar,
  minecraftVersionsDirectory,
  parseMinecraftVersionMetadata,
  preferredMinecraftVersion
} from './minecraft-installation-discovery'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    )
  )
})

async function temporaryRoot(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'Minecraft версии '))
  temporaryDirectories.push(directory)
  return directory
}

async function addVersion(
  versionsRoot: string,
  directoryName: string,
  metadata: Record<string, unknown> | null = {
    id: directoryName,
    type: 'release'
  }
): Promise<string> {
  const directory = join(versionsRoot, directoryName)
  await mkdir(directory, { recursive: true })
  const jarPath = join(directory, `${directoryName}.jar`)
  await writeFile(jarPath, 'client jar fixture')
  if (metadata !== null) {
    await writeFile(
      join(directory, `${directoryName}.json`),
      JSON.stringify(metadata)
    )
  }
  return jarPath
}

describe('Minecraft Java installation discovery', () => {
  it('uses the conventional macOS and Windows installation locations', () => {
    expect(
      minecraftVersionsDirectory({
        platform: 'darwin',
        homeDirectory: '/Users/Игрок'
      })
    ).toBe(
      '/Users/Игрок/Library/Application Support/minecraft/versions'
    )
    expect(
      minecraftVersionsDirectory({
        platform: 'win32',
        appDataDirectory: 'C:\\Users\\Игрок\\AppData\\Roaming'
      })
    ).toBe(
      'C:\\Users\\Игрок\\AppData\\Roaming/.minecraft/versions'
    )
  })

  it('discovers installations through both macOS and Windows roots', async () => {
    const root = await temporaryRoot()
    const macHome = join(root, 'macOS Игрок')
    const macVersions = minecraftVersionsDirectory({
      platform: 'darwin',
      homeDirectory: macHome
    })
    if (macVersions === null) throw new Error('missing macOS versions path')
    await addVersion(macVersions, '1.21.1')
    await expect(
      discoverInstalledMinecraftVersions({
        platform: 'darwin',
        homeDirectory: macHome
      })
    ).resolves.toMatchObject([{ version: '1.21.1', preferred: true }])

    const windowsAppData = join(root, 'Windows AppData')
    const windowsVersions = minecraftVersionsDirectory({
      platform: 'win32',
      appDataDirectory: windowsAppData
    })
    if (windowsVersions === null) throw new Error('missing Windows versions path')
    await addVersion(windowsVersions, '1.21.4')
    await expect(
      discoverInstalledMinecraftVersions({
        platform: 'win32',
        appDataDirectory: windowsAppData
      })
    ).resolves.toMatchObject([{ version: '1.21.4', compatible: true }])
  })

  it('parses official version metadata and prefers Paper target 1.21.1', async () => {
    const metadata = parseMinecraftVersionMetadata(
      JSON.stringify({
        id: '1.21.1',
        type: 'release',
        downloads: {
          client: {
            size: 26_836_906,
            sha1: '30c73b1c5da787909b2f73340419fdf13b9def88'
          }
        }
      })
    )
    expect(metadata).toEqual({
      id: '1.21.1',
      releaseType: 'release',
      inheritedJarVersion: null,
      clientSize: 26_836_906,
      clientSha1: '30c73b1c5da787909b2f73340419fdf13b9def88'
    })

    const root = await temporaryRoot()
    const versions = join(root, 'versions')
    await addVersion(versions, '1.21.4')
    await addVersion(versions, 'target-directory', {
      id: '1.21.1',
      type: 'release'
    })
    await addVersion(versions, '1.20.6')

    const detected = await discoverInstalledMinecraftVersions({
      versionsDirectory: versions
    })
    expect(detected.map((entry) => entry.version)).toEqual([
      '1.21.1',
      '1.21.4',
      '1.20.6'
    ])
    expect(preferredMinecraftVersion(detected)).toMatchObject({
      version: '1.21.1',
      preferred: true,
      metadataAvailable: true
    })
  })

  it('supports Unicode/spaced launcher paths, metadata-free versions and manual JAR fallback', async () => {
    const root = await temporaryRoot()
    const versions = join(root, 'Пользовательский лаунчер', 'versions')
    const discoveredJar = await addVersion(
      versions,
      'Версия с пробелами',
      null
    )
    const detected = await discoverInstalledMinecraftVersions({
      versionsDirectory: versions
    })
    expect(detected).toHaveLength(1)
    expect(detected[0]).toMatchObject({
      version: 'Версия с пробелами',
      jarPath: discoveredJar,
      metadataAvailable: false
    })

    const manualJar = join(root, 'Ручной клиент 1.21.1.jar')
    await writeFile(manualJar, 'manual jar')
    await writeFile(
      join(root, 'Ручной клиент 1.21.1.json'),
      JSON.stringify({ id: '1.21.1', type: 'release' })
    )
    await expect(inspectSelectedMinecraftJar(manualJar)).resolves.toMatchObject({
      version: '1.21.1',
      jarPath: manualJar,
      metadataAvailable: true
    })
  })

  it('returns an empty result for a missing installation without throwing', async () => {
    const root = await temporaryRoot()
    await expect(
      discoverInstalledMinecraftVersions({
        versionsDirectory: join(root, 'missing versions')
      })
    ).resolves.toEqual([])
  })
})
