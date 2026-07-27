import type {
  ResolvedCubeFace,
  ResolvedMaterialPreview,
  ResolvedTextureFace,
  ResourceDiagnostic,
  ResourceTextureFace
} from '../shared/resource-preview'

const CUBE_FACES: readonly ResolvedCubeFace[] = [
  'top',
  'bottom',
  'north',
  'south',
  'east',
  'west'
]
const MAX_MODEL_DEPTH = 32
const RESOURCE_LOCATION = /^[a-z0-9_.-]+:[a-z0-9_./-]+$/

export interface ResolverFile {
  logicalPath: string
  assetToken: string
}

export interface ResolverPack {
  id: string
  name: string
  kind?: 'resource-pack' | 'vanilla'
  files: ReadonlyMap<string, ResolverFile>
}

export interface ResolverManualTexture {
  face: ResourceTextureFace
  assetToken: string
  sourceName: string
}

export interface ResolveMaterialOptions {
  material: string
  revision: number
  packs: readonly ResolverPack[]
  manualTextures: readonly ResolverManualTexture[]
  readText(file: ResolverFile): Promise<string>
}

interface LocatedFile {
  pack: ResolverPack
  file: ResolverFile
}

interface FaceVariable {
  texture: string
  rotation: 0 | 90 | 180 | 270
}

interface ResolvedModel {
  modelPath: string
  textures: Record<string, string>
  faces: Partial<Record<ResolvedCubeFace, FaceVariable>>
  unsupportedGeometry: boolean
}

function diagnostic(
  diagnostics: ResourceDiagnostic[],
  severity: ResourceDiagnostic['severity'],
  code: string,
  message: string,
  path?: string
): void {
  diagnostics.push({
    severity,
    code,
    message,
    ...(path === undefined ? {} : { path })
  })
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function resourceLocation(
  value: unknown,
  defaultNamespace = 'minecraft'
): string | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > 300) return null
  const normalized = value.includes(':') ? value : `${defaultNamespace}:${value}`
  if (
    !RESOURCE_LOCATION.test(normalized) ||
    normalized.includes('/../') ||
    normalized.endsWith('/..') ||
    normalized.includes('/./')
  ) {
    return null
  }
  return normalized
}

function logicalFromLocation(
  location: string,
  category: 'blockstates' | 'models' | 'textures'
): string {
  const separator = location.indexOf(':')
  const namespace = location.slice(0, separator)
  const resourcePath = location.slice(separator + 1)
  return `assets/${namespace}/${category}/${resourcePath}${
    category === 'textures' ? '.png' : '.json'
  }`
}

function locate(packs: readonly ResolverPack[], logicalPath: string): LocatedFile | null {
  for (const pack of packs) {
    const file = pack.files.get(logicalPath)
    if (file !== undefined) return { pack, file }
  }
  return null
}

function semanticCubeFaces(parent: string): Partial<Record<ResolvedCubeFace, FaceVariable>> | null {
  const all = (texture: string): Partial<Record<ResolvedCubeFace, FaceVariable>> =>
    Object.fromEntries(
      CUBE_FACES.map((face) => [face, { texture, rotation: 0 }])
    )
  switch (parent) {
    case 'minecraft:block/cube_all':
      return all('#all')
    case 'minecraft:block/cube':
      return {
        top: { texture: '#up', rotation: 0 },
        bottom: { texture: '#down', rotation: 0 },
        north: { texture: '#north', rotation: 0 },
        south: { texture: '#south', rotation: 0 },
        east: { texture: '#east', rotation: 0 },
        west: { texture: '#west', rotation: 0 }
      }
    case 'minecraft:block/cube_column':
    case 'minecraft:block/cube_column_uv_locked_x':
    case 'minecraft:block/cube_column_uv_locked_y':
    case 'minecraft:block/cube_column_uv_locked_z':
      return {
        top: { texture: '#end', rotation: 0 },
        bottom: { texture: '#end', rotation: 0 },
        north: { texture: '#side', rotation: 0 },
        south: { texture: '#side', rotation: 0 },
        east: { texture: '#side', rotation: 0 },
        west: { texture: '#side', rotation: 0 }
      }
    case 'minecraft:block/cube_bottom_top':
      return {
        top: { texture: '#top', rotation: 0 },
        bottom: { texture: '#bottom', rotation: 0 },
        north: { texture: '#side', rotation: 0 },
        south: { texture: '#side', rotation: 0 },
        east: { texture: '#side', rotation: 0 },
        west: { texture: '#side', rotation: 0 }
      }
    case 'minecraft:block/orientable':
      return {
        top: { texture: '#top', rotation: 0 },
        bottom: { texture: '#top', rotation: 0 },
        north: { texture: '#front', rotation: 0 },
        south: { texture: '#side', rotation: 0 },
        east: { texture: '#side', rotation: 0 },
        west: { texture: '#side', rotation: 0 }
      }
    case 'minecraft:block/orientable_with_bottom':
      return {
        top: { texture: '#top', rotation: 0 },
        bottom: { texture: '#bottom', rotation: 0 },
        north: { texture: '#front', rotation: 0 },
        south: { texture: '#side', rotation: 0 },
        east: { texture: '#side', rotation: 0 },
        west: { texture: '#side', rotation: 0 }
      }
    default:
      return null
  }
}

function exactFullCubeFaces(
  elements: unknown
): Partial<Record<ResolvedCubeFace, FaceVariable>> | null {
  if (!Array.isArray(elements) || elements.length !== 1) return null
  const element = record(elements[0])
  if (element === null || !Array.isArray(element.from) || !Array.isArray(element.to)) return null
  const from = element.from
  const to = element.to
  if (
    from.length !== 3 ||
    to.length !== 3 ||
    from.some((value) => value !== 0) ||
    to.some((value) => value !== 16)
  ) {
    return null
  }
  const faces = record(element.faces)
  if (faces === null) return null
  const result: Partial<Record<ResolvedCubeFace, FaceVariable>> = {}
  for (const face of CUBE_FACES) {
    const modelFace = face === 'top' ? 'up' : face === 'bottom' ? 'down' : face
    const value = record(faces[modelFace])
    if (value === null || typeof value.texture !== 'string') continue
    const rotation =
      value.rotation === 90 || value.rotation === 180 || value.rotation === 270
        ? value.rotation
        : 0
    result[face] = { texture: value.texture, rotation }
  }
  return Object.keys(result).length === 0 ? null : result
}

function textureMap(value: unknown): Record<string, string> {
  const item = record(value)
  if (item === null) return {}
  const result: Record<string, string> = Object.create(null) as Record<string, string>
  for (const [key, entry] of Object.entries(item)) {
    if (/^[a-z0-9_.-]+$/.test(key) && typeof entry === 'string') result[key] = entry
  }
  return result
}

async function loadJson(
  file: ResolverFile,
  readText: ResolveMaterialOptions['readText'],
  diagnostics: ResourceDiagnostic[]
): Promise<Record<string, unknown> | null> {
  try {
    const value: unknown = JSON.parse(await readText(file)) as unknown
    const item = record(value)
    if (item === null) throw new Error('Ожидался объект JSON')
    return item
  } catch (caught) {
    diagnostic(
      diagnostics,
      'warning',
      'invalid-json',
      caught instanceof Error ? caught.message : 'Некорректный JSON',
      file.logicalPath
    )
    return null
  }
}

async function resolveModel(
  location: string,
  options: ResolveMaterialOptions,
  diagnostics: ResourceDiagnostic[],
  visited: Set<string>,
  depth: number
): Promise<ResolvedModel | null> {
  if (depth > MAX_MODEL_DEPTH) {
    diagnostic(diagnostics, 'warning', 'model-depth', 'Цепочка parent слишком глубокая', location)
    return null
  }
  if (visited.has(location)) {
    diagnostic(diagnostics, 'warning', 'model-cycle', 'Обнаружен цикл parent моделей', location)
    return null
  }
  const semantic = semanticCubeFaces(location)
  const logicalPath = logicalFromLocation(location, 'models')
  const located = locate(options.packs, logicalPath)
  if (located === null) {
    return semantic === null
      ? null
      : {
          modelPath: logicalPath,
          textures: {},
          faces: semantic,
          unsupportedGeometry: false
        }
  }

  visited.add(location)
  try {
    const value = await loadJson(
      located.file,
      (file) => options.readText(file),
      diagnostics
    )
    if (value === null) return null
    let inherited: ResolvedModel | null = null
    const parent = resourceLocation(value.parent, location.slice(0, location.indexOf(':')))
    if (parent !== null) {
      inherited = await resolveModel(parent, options, diagnostics, visited, depth + 1)
      if (inherited === null && semanticCubeFaces(parent) === null) {
        diagnostic(
          diagnostics,
          'warning',
          'missing-parent',
          'Родительская модель не найдена',
          parent
        )
      }
    }
    const ownFullCube = exactFullCubeFaces(value.elements)
    const hasElements = Array.isArray(value.elements)
    const unsupportedGeometry = hasElements && ownFullCube === null
    if (unsupportedGeometry) {
      diagnostic(
        diagnostics,
        'warning',
        'unsupported-geometry',
        'Сложная геометрия приближённо показана как куб',
        logicalPath
      )
    }
    return {
      modelPath: logicalPath,
      textures: { ...(inherited?.textures ?? {}), ...textureMap(value.textures) },
      faces: ownFullCube ?? inherited?.faces ?? semantic ?? {},
      unsupportedGeometry:
        unsupportedGeometry || (inherited?.unsupportedGeometry ?? false)
    }
  } finally {
    visited.delete(location)
  }
}

function candidateModel(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value)) {
    const entries = value
      .map((entry, index) => ({ entry: record(entry), index }))
      .filter(
        (item): item is { entry: Record<string, unknown>; index: number } =>
          item.entry !== null
      )
      .sort((left, right) => {
        const leftWeight =
          typeof left.entry.weight === 'number' ? left.entry.weight : 1
        const rightWeight =
          typeof right.entry.weight === 'number' ? right.entry.weight : 1
        if (leftWeight !== rightWeight) return rightWeight - leftWeight
        const leftModel =
          typeof left.entry.model === 'string' ? left.entry.model : ''
        const rightModel =
          typeof right.entry.model === 'string' ? right.entry.model : ''
        return leftModel.localeCompare(rightModel, 'en-US') || left.index - right.index
      })
    return entries[0]?.entry ?? null
  }
  return record(value)
}

function selectBlockstateModel(
  blockstate: Record<string, unknown>,
  diagnostics: ResourceDiagnostic[],
  path: string
): string | null {
  const variants = record(blockstate.variants)
  let candidate: Record<string, unknown> | null = null
  if (variants !== null) {
    const keys = Object.keys(variants).sort((left, right) => {
      const priority = (key: string): number => {
        if (key === '') return 0
        if (key === 'normal') return 1
        const properties = new Set(key.split(','))
        if (properties.has('axis=y')) return 2
        if (properties.has('facing=north')) return 3
        return 4
      }
      return priority(left) - priority(right) || left.localeCompare(right, 'en-US')
    })
    const key = keys[0]
    if (key !== undefined) candidate = candidateModel(variants[key])
    if (keys.length > 1 || key !== '') {
      diagnostic(
        diagnostics,
        'info',
        'representative-variant',
        `Использован детерминированный вариант «${key ?? ''}»`,
        path
      )
    }
  } else if (Array.isArray(blockstate.multipart) && blockstate.multipart.length > 0) {
    const first = record(blockstate.multipart[0])
    candidate = candidateModel(first?.apply)
    diagnostic(
      diagnostics,
      'warning',
      'multipart-approximation',
      'Multipart blockstate показан по первой детерминированной части',
      path
    )
  }
  return resourceLocation(candidate?.model)
}

function resolveTextureAlias(
  value: string,
  textures: Record<string, string>,
  diagnostics: ResourceDiagnostic[],
  modelPath: string
): string | null {
  let current = value
  const visited = new Set<string>()
  for (let depth = 0; depth <= MAX_MODEL_DEPTH; depth += 1) {
    if (!current.startsWith('#')) return resourceLocation(current)
    const key = current.slice(1)
    if (!/^[a-z0-9_.-]+$/.test(key) || visited.has(key)) {
      diagnostic(
        diagnostics,
        'warning',
        'texture-cycle',
        'Обнаружен цикл или некорректная ссылка переменной текстуры',
        modelPath
      )
      return null
    }
    visited.add(key)
    const next = textures[key]
    if (next === undefined) {
      diagnostic(
        diagnostics,
        'warning',
        'missing-texture-variable',
        `Не найдена переменная текстуры #${key}`,
        modelPath
      )
      return null
    }
    current = next
  }
  diagnostic(
    diagnostics,
    'warning',
    'texture-depth',
    'Цепочка переменных текстуры слишком глубокая',
    modelPath
  )
  return null
}

function directTextureModel(
  blockId: string,
  options: ResolveMaterialOptions,
  diagnostics: ResourceDiagnostic[]
): ResolvedModel | null {
  const baseLocation = `minecraft:block/${blockId}`
  const basePath = logicalFromLocation(baseLocation, 'textures')
  if (locate(options.packs, basePath) === null) return null
  const topPath = logicalFromLocation(`${baseLocation}_top`, 'textures')
  const hasTop = locate(options.packs, topPath) !== null
  const isColumn =
    /(?:_log|_stem|_pillar|^basalt$|^polished_basalt$|^hay_block$)$/.test(blockId)
  const cube = semanticCubeFaces(
    isColumn && hasTop ? 'minecraft:block/cube_column' : 'minecraft:block/cube_all'
  )
  diagnostic(
    diagnostics,
    'info',
    'direct-texture-fallback',
    'Blockstate/model отсутствует; использована прямая текстура блока',
    basePath
  )
  return {
    modelPath: basePath,
    textures:
      isColumn && hasTop
        ? { side: baseLocation, end: `${baseLocation}_top` }
        : { all: baseLocation },
    faces: cube ?? {},
    unsupportedGeometry: false
  }
}

function faceSourceSummary(
  faces: Partial<Record<ResolvedCubeFace, ResolvedTextureFace>>
): {
  source: ResolvedMaterialPreview['source']
  sourceName: string
} {
  const values = Object.values(faces)
  if (values.length === 0) return { source: 'fallback-color', sourceName: 'Цвет материала' }
  const names = new Set(values.map((face) => face.sourceName))
  const hasManual = values.some((face) => face.sourcePackId === null)
  if (hasManual && names.size === 1) {
    return { source: 'manual', sourceName: values[0]?.sourceName ?? 'Ручная текстура' }
  }
  if (!hasManual && names.size === 1) {
    if (values.every((face) => face.sourceKind === 'vanilla')) {
      return {
        source: 'vanilla',
        sourceName:
          values[0]?.sourceName ?? 'Ванильные ресурсы Minecraft'
      }
    }
    return {
      source: 'resource-pack',
      sourceName: values[0]?.sourceName ?? 'Ресурс-пак'
    }
  }
  return { source: 'mixed', sourceName: [...names].join(' + ') }
}

export async function resolveMaterialPreview(
  options: ResolveMaterialOptions
): Promise<ResolvedMaterialPreview> {
  const diagnostics: ResourceDiagnostic[] = []
  const blockId = options.material.toLocaleLowerCase('en-US')
  const blockstatePath = logicalFromLocation(
    `minecraft:${blockId}`,
    'blockstates'
  )
  const blockstate = locate(options.packs, blockstatePath)
  let model: ResolvedModel | null = null
  if (blockstate !== null) {
    const value = await loadJson(
      blockstate.file,
      (file) => options.readText(file),
      diagnostics
    )
    if (value !== null) {
      const modelLocation = selectBlockstateModel(value, diagnostics, blockstatePath)
      if (modelLocation !== null) {
        model = await resolveModel(
          modelLocation,
          options,
          diagnostics,
          new Set<string>(),
          0
        )
      }
    }
  }
  model ??= directTextureModel(blockId, options, diagnostics)
  const faces: Partial<Record<ResolvedCubeFace, ResolvedTextureFace>> = {}
  if (model !== null) {
    for (const face of CUBE_FACES) {
      const variable = model.faces[face]
      if (variable === undefined) continue
      const textureLocation = resolveTextureAlias(
        variable.texture,
        model.textures,
        diagnostics,
        model.modelPath
      )
      if (textureLocation === null) continue
      const texturePath = logicalFromLocation(textureLocation, 'textures')
      const texture = locate(options.packs, texturePath)
      if (texture === null) {
        diagnostic(
          diagnostics,
          'warning',
          'missing-texture',
          'Текстура не найдена',
          texturePath
        )
        continue
      }
      faces[face] = {
        assetToken: texture.file.assetToken,
        logicalPath: texturePath,
        sourcePackId: texture.pack.id,
        sourceName: texture.pack.name,
        sourceKind: texture.pack.kind ?? 'resource-pack',
        rotation: variable.rotation
      }
    }
  }

  const allOverride = options.manualTextures.find((entry) => entry.face === 'all')
  for (const face of CUBE_FACES) {
    const manual =
      options.manualTextures.find((entry) => entry.face === face) ?? allOverride
    if (manual === undefined) continue
    faces[face] = {
      assetToken: manual.assetToken,
      logicalPath: `manual:${options.material}:${manual.face}`,
      sourcePackId: null,
      sourceName: manual.sourceName,
      rotation: 0
    }
  }

  if (Object.keys(faces).length === 0) {
    diagnostic(
      diagnostics,
      'info',
      'fallback-color',
      'Подходящая текстура не найдена; используется цвет материала'
    )
  }
  const summary = faceSourceSummary(faces)
  return {
    material: options.material,
    revision: options.revision,
    source: summary.source,
    sourceName: summary.sourceName,
    modelPath: model?.modelPath ?? null,
    faces,
    diagnostics
  }
}
