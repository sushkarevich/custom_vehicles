// @vitest-environment node

import { describe, expect, it } from 'vitest'
import { parseResourcePreviewSettings } from './resource-preview-storage'

describe('resource preview settings validation', () => {
  it('drops unsafe and duplicate persisted records', () => {
    const settings = parseResourcePreviewSettings({
      version: 1,
      revision: 8,
      mode: 'textures',
      packs: [
        {
          id: 'abcd1234-abcd',
          type: 'directory',
          sourcePath: '/tmp/пак с пробелами',
          name: 'Pack',
          enabled: true,
          diagnostics: []
        },
        {
          id: 'abcd1234-abcd',
          type: 'zip',
          sourcePath: '/tmp/duplicate.zip',
          name: 'Duplicate',
          enabled: true
        },
        {
          id: '../unsafe',
          type: 'directory',
          sourcePath: 'relative',
          name: 'Unsafe',
          enabled: true
        }
      ],
      manualTextures: [
        {
          material: 'STONE',
          face: 'all',
          fileName: `${'a'.repeat(64)}.png`,
          originalName: 'камень.png',
          width: 16,
          height: 16
        },
        {
          material: 'STONE',
          face: 'all',
          fileName: '../escape.png',
          originalName: 'bad.png',
          width: 1,
          height: 1
        }
      ]
    })
    expect(settings.revision).toBe(8)
    expect(settings.packs).toHaveLength(1)
    expect(settings.manualTextures).toHaveLength(1)
    expect(settings.manualTextures[0]?.originalName).toBe('камень.png')
  })

  it('falls back to a clean v1 document for corrupt values', () => {
    expect(parseResourcePreviewSettings({ version: 99 })).toEqual({
      version: 1,
      revision: 0,
      mode: 'textures',
      packs: [],
      vanilla: {
        enabled: true,
        discoveryAttempted: false,
        diagnostics: []
      },
      manualTextures: []
    })
  })

  it('persists only validated local vanilla discovery/cache metadata', () => {
    const settings = parseResourcePreviewSettings({
      version: 1,
      revision: 3,
      mode: 'textures',
      packs: [],
      vanilla: {
        enabled: true,
        discoveryAttempted: true,
        sourceKind: 'manual',
        sourcePath: '/Users/Игрок/Лаунчер с пробелами/1.21.1.jar',
        version: '1.21.1',
        sourceSize: 1234,
        sourceMtimeMs: 5678,
        sourceSha256: 'a'.repeat(64),
        cacheIdentity: 'b'.repeat(64),
        cacheKey: 'c'.repeat(64),
        diagnostics: []
      },
      manualTextures: []
    })
    expect(settings.vanilla).toMatchObject({
      sourceKind: 'manual',
      sourcePath: '/Users/Игрок/Лаунчер с пробелами/1.21.1.jar',
      version: '1.21.1',
      sourceSha256: 'a'.repeat(64),
      cacheIdentity: 'b'.repeat(64),
      cacheKey: 'c'.repeat(64)
    })

    const unsafe = parseResourcePreviewSettings({
      version: 1,
      mode: 'textures',
      packs: [],
      vanilla: {
        enabled: true,
        discoveryAttempted: true,
        sourceKind: 'manual',
        sourcePath: '../client.jar',
        version: '1.21.1'
      },
      manualTextures: []
    })
    expect(unsafe.vanilla.sourcePath).toBeUndefined()
  })
})
