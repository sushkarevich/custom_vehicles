// @vitest-environment node

import { describe, expect, it } from 'vitest'
import {
  resolveMaterialPreview,
  type ResolverFile,
  type ResolverPack
} from './resource-pack-resolver'

function pack(
  id: string,
  name: string,
  resources: Record<string, string>
): {
  pack: ResolverPack
  readText(file: ResolverFile): Promise<string>
} {
  const values = new Map<string, string>()
  const files = new Map<string, ResolverFile>()
  for (const [logicalPath, content] of Object.entries(resources)) {
    const token = `${id}:${logicalPath}`
    files.set(logicalPath, { logicalPath, assetToken: token })
    values.set(token, content)
  }
  return {
    pack: { id, name, files },
    readText: async (file) => values.get(file.assetToken) ?? ''
  }
}

function composeReaders(
  ...readers: Array<(file: ResolverFile) => Promise<string>>
): (file: ResolverFile) => Promise<string> {
  return async (file) => {
    for (const reader of readers) {
      const value = await reader(file)
      if (value !== '') return value
    }
    throw new Error('missing fixture')
  }
}

describe('Minecraft resource-pack resolver', () => {
  it('layers each resource independently and resolves inherited aliases/cube layouts', async () => {
    const lower = pack('low', 'Нижний', {
      'assets/minecraft/blockstates/test_block.json': JSON.stringify({
        variants: { 'facing=north': { model: 'minecraft:block/test_block' } }
      }),
      'assets/minecraft/models/block/test_block.json': JSON.stringify({
        parent: 'minecraft:block/cube_bottom_top',
        textures: {
          side_alias: 'minecraft:block/test_side',
          side: '#side_alias',
          top: 'minecraft:block/test_top',
          bottom: 'minecraft:block/test_bottom'
        }
      }),
      'assets/minecraft/textures/block/test_side.png': 'lower-side',
      'assets/minecraft/textures/block/test_top.png': 'lower-top',
      'assets/minecraft/textures/block/test_bottom.png': 'lower-bottom'
    })
    const higher = pack('high', 'Верхний', {
      'assets/minecraft/textures/block/test_top.png': 'higher-top'
    })

    const resolved = await resolveMaterialPreview({
      material: 'TEST_BLOCK',
      revision: 4,
      packs: [higher.pack, lower.pack],
      manualTextures: [],
      readText: composeReaders(higher.readText, lower.readText)
    })

    expect(resolved.source).toBe('mixed')
    expect(resolved.faces.top).toMatchObject({
      sourcePackId: 'high',
      sourceName: 'Верхний'
    })
    expect(resolved.faces.bottom).toMatchObject({ sourcePackId: 'low' })
    expect(resolved.faces.north?.assetToken).toContain('test_side.png')
    expect(resolved.diagnostics.map((entry) => entry.code)).toContain(
      'representative-variant'
    )
  })

  it('uses manual all-face overrides above every pack', async () => {
    const resources = pack('pack', 'Pack', {
      'assets/minecraft/textures/block/acacia_planks.png': 'pack texture'
    })
    const resolved = await resolveMaterialPreview({
      material: 'ACACIA_PLANKS',
      revision: 1,
      packs: [resources.pack],
      manualTextures: [
        { face: 'all', assetToken: 'manual-token', sourceName: 'Ручная текстура' }
      ],
      readText: resources.readText
    })
    expect(resolved.source).toBe('manual')
    expect(Object.values(resolved.faces)).toHaveLength(6)
    expect(
      Object.values(resolved.faces).every(
        (face) => face.assetToken === 'manual-token' && face.sourcePackId === null
      )
    ).toBe(true)
  })

  it('uses deterministic variants, reports cycles and falls back without crashing', async () => {
    const resources = pack('pack', 'Pack', {
      'assets/minecraft/blockstates/cycle_block.json': JSON.stringify({
        variants: {
          z: { model: 'minecraft:block/ignored' },
          '': [
            { model: 'minecraft:block/cycle_a', weight: 1 },
            { model: 'minecraft:block/cycle_a', weight: 4 }
          ]
        }
      }),
      'assets/minecraft/models/block/cycle_a.json': JSON.stringify({
        parent: 'minecraft:block/cycle_b',
        textures: { all: '#next', next: '#all' }
      }),
      'assets/minecraft/models/block/cycle_b.json': JSON.stringify({
        parent: 'minecraft:block/cycle_a'
      })
    })
    const resolved = await resolveMaterialPreview({
      material: 'CYCLE_BLOCK',
      revision: 1,
      packs: [resources.pack],
      manualTextures: [],
      readText: resources.readText
    })
    expect(resolved.source).toBe('fallback-color')
    expect(resolved.diagnostics.map((entry) => entry.code)).toEqual(
      expect.arrayContaining(['model-cycle', 'fallback-color'])
    )
  })

  it('inherits custom parent textures and detects texture-variable cycles', async () => {
    const inherited = pack('pack', 'Pack', {
      'assets/minecraft/blockstates/inherited_block.json': JSON.stringify({
        variants: { '': { model: 'minecraft:block/inherited_child' } }
      }),
      'assets/minecraft/models/block/inherited_parent.json': JSON.stringify({
        parent: 'minecraft:block/cube_all',
        textures: { all: 'minecraft:block/inherited_texture' }
      }),
      'assets/minecraft/models/block/inherited_child.json': JSON.stringify({
        parent: 'minecraft:block/inherited_parent'
      }),
      'assets/minecraft/textures/block/inherited_texture.png': 'texture'
    })
    const resolved = await resolveMaterialPreview({
      material: 'INHERITED_BLOCK',
      revision: 1,
      packs: [inherited.pack],
      manualTextures: [],
      readText: inherited.readText
    })
    expect(Object.values(resolved.faces)).toHaveLength(6)
    expect(resolved.faces.top?.logicalPath).toContain('inherited_texture.png')

    const cycle = pack('cycle', 'Cycle', {
      'assets/minecraft/blockstates/alias_cycle.json': JSON.stringify({
        variants: { '': { model: 'minecraft:block/alias_cycle' } }
      }),
      'assets/minecraft/models/block/alias_cycle.json': JSON.stringify({
        parent: 'minecraft:block/cube_all',
        textures: { all: '#next', next: '#all' }
      })
    })
    const cycleResult = await resolveMaterialPreview({
      material: 'ALIAS_CYCLE',
      revision: 1,
      packs: [cycle.pack],
      manualTextures: [],
      readText: cycle.readText
    })
    expect(cycleResult.source).toBe('fallback-color')
    expect(cycleResult.diagnostics.map((entry) => entry.code)).toContain(
      'texture-cycle'
    )
  })

  it('provides a direct cube/column texture fallback and unsupported geometry diagnostic', async () => {
    const direct = pack('pack', 'Pack', {
      'assets/minecraft/textures/block/oak_log.png': 'side',
      'assets/minecraft/textures/block/oak_log_top.png': 'top'
    })
    const log = await resolveMaterialPreview({
      material: 'OAK_LOG',
      revision: 1,
      packs: [direct.pack],
      manualTextures: [],
      readText: direct.readText
    })
    expect(log.faces.top?.logicalPath).toContain('oak_log_top.png')
    expect(log.faces.north?.logicalPath).toContain('oak_log.png')
    expect(log.diagnostics.map((entry) => entry.code)).toContain(
      'direct-texture-fallback'
    )

    const complex = pack('complex', 'Complex', {
      'assets/minecraft/blockstates/complex_block.json': JSON.stringify({
        variants: { '': { model: 'minecraft:block/complex_block' } }
      }),
      'assets/minecraft/models/block/complex_block.json': JSON.stringify({
        parent: 'minecraft:block/cube_all',
        textures: { all: 'minecraft:block/complex_block' },
        elements: [
          {
            from: [0, 0, 0],
            to: [8, 16, 16],
            faces: { north: { texture: '#all' } }
          }
        ]
      }),
      'assets/minecraft/textures/block/complex_block.png': 'texture'
    })
    const approximation = await resolveMaterialPreview({
      material: 'COMPLEX_BLOCK',
      revision: 1,
      packs: [complex.pack],
      manualTextures: [],
      readText: complex.readText
    })
    expect(approximation.faces.top).toBeDefined()
    expect(approximation.diagnostics.map((entry) => entry.code)).toContain(
      'unsupported-geometry'
    )
  })

  it('maps Minecraft up/down full-cube faces to renderer top/bottom', async () => {
    const resources = pack('pack', 'Pack', {
      'assets/minecraft/blockstates/exact_cube.json': JSON.stringify({
        variants: { '': { model: 'minecraft:block/exact_cube' } }
      }),
      'assets/minecraft/models/block/exact_cube.json': JSON.stringify({
        textures: {
          top: 'minecraft:block/exact_top',
          bottom: 'minecraft:block/exact_bottom',
          side: 'minecraft:block/exact_side'
        },
        elements: [
          {
            from: [0, 0, 0],
            to: [16, 16, 16],
            faces: {
              up: { texture: '#top', rotation: 90 },
              down: { texture: '#bottom' },
              north: { texture: '#side' },
              south: { texture: '#side' },
              east: { texture: '#side' },
              west: { texture: '#side' }
            }
          }
        ]
      }),
      'assets/minecraft/textures/block/exact_top.png': 'top',
      'assets/minecraft/textures/block/exact_bottom.png': 'bottom',
      'assets/minecraft/textures/block/exact_side.png': 'side'
    })
    const resolved = await resolveMaterialPreview({
      material: 'EXACT_CUBE',
      revision: 1,
      packs: [resources.pack],
      manualTextures: [],
      readText: resources.readText
    })
    expect(resolved.faces.top).toMatchObject({
      logicalPath: 'assets/minecraft/textures/block/exact_top.png',
      rotation: 90
    })
    expect(resolved.faces.bottom?.logicalPath).toContain('exact_bottom.png')
  })
})
