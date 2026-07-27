// @vitest-environment node

import { constants } from 'node:fs'
import { access, readFile, readdir } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'
import { listPackage } from '@electron/asar'
import { describe, expect, it } from 'vitest'

const PROJECT_ROOT = resolve(import.meta.dirname, '../..')
const MOJANG_RESOURCE_PATH =
  /(?:^|\/)assets\/minecraft\/(?:blockstates|models|textures)\//

async function existingDirectoryFiles(directory: string): Promise<string[]> {
  try {
    const entries = await readdir(directory, {
      recursive: true,
      withFileTypes: true
    })
    return entries
      .filter((entry) => entry.isFile())
      .map((entry) =>
        relative(
          PROJECT_ROOT,
          join(entry.parentPath, entry.name)
        ).replaceAll('\\', '/')
      )
  } catch {
    return []
  }
}

describe('packaging excludes Mojang assets', () => {
  it('has no Minecraft resource files in application-owned package inputs', async () => {
    const files = (
      await Promise.all(
        ['src', 'build', 'resources'].map((directory) =>
          existingDirectoryFiles(join(PROJECT_ROOT, directory))
        )
      )
    ).flat()
    expect(files.filter((file) => MOJANG_RESOURCE_PATH.test(file))).toEqual([])

    const packageJson = JSON.parse(
      await readFile(join(PROJECT_ROOT, 'package.json'), 'utf8')
    ) as { build?: { extraResources?: unknown; extraFiles?: unknown } }
    expect(packageJson.build?.extraResources).toBeUndefined()
    expect(packageJson.build?.extraFiles).toBeUndefined()
  })

  it('contains no cached Mojang resources in an existing packaged ASAR', async () => {
    const archive = join(
      PROJECT_ROOT,
      'release',
      'mac-arm64',
      'Редактор CustomVehicles.app',
      'Contents',
      'Resources',
      'app.asar'
    )
    try {
      await access(archive, constants.R_OK)
    } catch {
      return
    }
    expect(
      listPackage(archive, { isPack: false }).filter((file) =>
        MOJANG_RESOURCE_PATH.test(file)
      )
    ).toEqual([])
  })
})
