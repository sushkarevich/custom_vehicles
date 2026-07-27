import {
  cloneDocument,
  createDefaultPart,
  type ModelDefinition,
  type ModelPart,
  type Vector3
} from '../../shared/schema'
import { normalizeNumber } from '../../shared/yaml'

export type MirrorAxis = 'x' | 'z'

function sanitizePartId(value: string): string {
  const normalized = value
    .trim()
    .toLocaleLowerCase('en-US')
    .replace(/[^a-z0-9_-]+/g, '_')
    .replace(/^[_-]+/, '')
    .replace(/[_-]+$/, '')
  return normalized.length > 0 ? normalized.slice(0, 56) : 'part'
}

export function generateUniquePartId(
  requestedBase: string,
  existing: Iterable<string>
): string {
  const ids = new Set(existing)
  const base = sanitizePartId(requestedBase)
  if (!ids.has(base)) return base
  let index = 2
  while (ids.has(`${base}_${index}`)) index += 1
  return `${base}_${index}`
}

function cloneModel(model: ModelDefinition): ModelDefinition {
  return cloneDocument(model)
}

function addMetadataForCopy(
  model: ModelDefinition,
  sourceId: string,
  copyId: string
): void {
  if (model.editor === undefined) return
  for (const key of ['hidden-parts', 'locked-parts'] as const) {
    if (model.editor[key]?.includes(sourceId) === true) {
      model.editor[key] = [...model.editor[key], copyId]
    }
  }
}

export function addPart(model: ModelDefinition, afterId?: string): {
  model: ModelDefinition
  partId: string
} {
  const next = cloneModel(model)
  const partId = generateUniquePartId('part', next.parts.map((part) => part.id))
  const part = createDefaultPart(partId)
  const afterIndex = afterId === undefined ? -1 : next.parts.findIndex((entry) => entry.id === afterId)
  if (afterIndex < 0) next.parts.push(part)
  else next.parts.splice(afterIndex + 1, 0, part)
  return { model: next, partId }
}

export function duplicatePart(model: ModelDefinition, partId: string): {
  model: ModelDefinition
  partId: string
} {
  const next = cloneModel(model)
  const sourceIndex = next.parts.findIndex((part) => part.id === partId)
  if (sourceIndex < 0) return { model, partId }
  const source = next.parts[sourceIndex]!
  const copyId = generateUniquePartId(source.id, next.parts.map((part) => part.id))
  const copy: ModelPart = structuredClone(source)
  copy.id = copyId
  next.parts.splice(sourceIndex + 1, 0, copy)
  addMetadataForCopy(next, source.id, copyId)
  return { model: next, partId: copyId }
}

export function deletePart(model: ModelDefinition, partId: string): {
  model: ModelDefinition
  selectedPartId: string | null
} {
  const index = model.parts.findIndex((part) => part.id === partId)
  if (index < 0 || model.parts.length <= 1) {
    return { model, selectedPartId: partId }
  }
  const next = cloneModel(model)
  next.parts.splice(index, 1)
  if (next.editor !== undefined) {
    for (const key of ['hidden-parts', 'locked-parts'] as const) {
      if (next.editor[key] !== undefined) {
        next.editor[key] = next.editor[key].filter((id) => id !== partId)
      }
    }
  }
  const fallback = next.parts[Math.min(index, next.parts.length - 1)]
  return { model: next, selectedPartId: fallback?.id ?? null }
}

export function renamePart(
  model: ModelDefinition,
  partId: string,
  requestedId: string
): { model: ModelDefinition; partId: string } {
  const next = cloneModel(model)
  const part = next.parts.find((entry) => entry.id === partId)
  if (part === undefined) return { model, partId }
  const newId = generateUniquePartId(
    requestedId,
    next.parts.filter((entry) => entry.id !== partId).map((entry) => entry.id)
  )
  part.id = newId
  if (next.editor !== undefined) {
    for (const key of ['hidden-parts', 'locked-parts'] as const) {
      const renamedIds = next.editor[key]?.map((id) => (id === partId ? newId : id))
      if (renamedIds === undefined) delete next.editor[key]
      else next.editor[key] = renamedIds
    }
  }
  return { model: next, partId: newId }
}

export function updatePart(
  model: ModelDefinition,
  partId: string,
  update: (part: ModelPart) => void
): ModelDefinition {
  const next = cloneModel(model)
  const part = next.parts.find((entry) => entry.id === partId)
  if (part === undefined) return model
  update(part)
  return next
}

export function updateParts(
  model: ModelDefinition,
  partIds: Iterable<string>,
  update: (part: ModelPart) => void
): ModelDefinition {
  const ids = new Set(partIds)
  if (ids.size === 0) return model
  const next = cloneModel(model)
  let changed = false
  next.parts.forEach((part) => {
    if (!ids.has(part.id)) return
    update(part)
    changed = true
  })
  return changed ? next : model
}

export function duplicateParts(
  model: ModelDefinition,
  partIds: Iterable<string>
): {
  model: ModelDefinition
  partIds: string[]
  partIdBySource: ReadonlyMap<string, string>
} {
  const selected = new Set(partIds)
  if (selected.size === 0) return { model, partIds: [], partIdBySource: new Map() }
  const next = cloneModel(model)
  const existing = new Set(next.parts.map((part) => part.id))
  const copies: string[] = []
  const partIdBySource = new Map<string, string>()
  const result: ModelPart[] = []

  next.parts.forEach((source) => {
    result.push(source)
    if (!selected.has(source.id)) return
    const copyId = generateUniquePartId(source.id, existing)
    existing.add(copyId)
    const copy: ModelPart = structuredClone(source)
    copy.id = copyId
    result.push(copy)
    copies.push(copyId)
    partIdBySource.set(source.id, copyId)
    addMetadataForCopy(next, source.id, copyId)
  })
  if (copies.length === 0) return { model, partIds: [], partIdBySource: new Map() }
  next.parts = result
  return { model: next, partIds: copies, partIdBySource }
}

export function deleteParts(
  model: ModelDefinition,
  partIds: Iterable<string>,
  preferredFallbackFromPartId?: string | null
): { model: ModelDefinition; selectedPartId: string | null; deletedPartIds: string[] } {
  const selected = new Set(partIds)
  const deletedPartIds = model.parts
    .filter((part) => selected.has(part.id))
    .map((part) => part.id)
  if (deletedPartIds.length === 0 || deletedPartIds.length >= model.parts.length) {
    return { model, selectedPartId: deletedPartIds.at(-1) ?? null, deletedPartIds: [] }
  }
  const preferredIndex =
    preferredFallbackFromPartId === undefined || preferredFallbackFromPartId === null
      ? -1
      : model.parts.findIndex((part) => part.id === preferredFallbackFromPartId)
  const firstIndex =
    preferredIndex >= 0
      ? preferredIndex
      : model.parts.findIndex((part) => selected.has(part.id))
  const next = cloneModel(model)
  next.parts = next.parts.filter((part) => !selected.has(part.id))
  if (next.editor !== undefined) {
    for (const key of ['hidden-parts', 'locked-parts'] as const) {
      if (next.editor[key] !== undefined) {
        next.editor[key] = next.editor[key].filter((id) => !selected.has(id))
      }
    }
  }
  const fallback = next.parts[Math.min(Math.max(firstIndex, 0), next.parts.length - 1)]
  return {
    model: next,
    selectedPartId: fallback?.id ?? null,
    deletedPartIds
  }
}

export function mirrorParts(
  model: ModelDefinition,
  partIds: Iterable<string>,
  axis: MirrorAxis
): {
  model: ModelDefinition
  partIds: string[]
  partIdBySource: ReadonlyMap<string, string>
} {
  const selected = new Set(partIds)
  if (selected.size === 0) return { model, partIds: [], partIdBySource: new Map() }
  const next = cloneModel(model)
  const existing = new Set(next.parts.map((part) => part.id))
  const copies: string[] = []
  const partIdBySource = new Map<string, string>()
  const result: ModelPart[] = []

  next.parts.forEach((source) => {
    result.push(source)
    if (!selected.has(source.id)) return
    const copyId = generateUniquePartId(`${source.id}_mirror_${axis}`, existing)
    existing.add(copyId)
    const copy: ModelPart = structuredClone(source)
    copy.id = copyId
    copy.position[axis] = normalizeNumber(-copy.position[axis])
    copy['rotation-degrees'] = mirroredRotation(copy['rotation-degrees'], axis)
    result.push(copy)
    copies.push(copyId)
    partIdBySource.set(source.id, copyId)
    addMetadataForCopy(next, source.id, copyId)
  })
  if (copies.length === 0) return { model, partIds: [], partIdBySource: new Map() }
  next.parts = result
  return { model: next, partIds: copies, partIdBySource }
}

export function reorderParts(
  model: ModelDefinition,
  partIds: Iterable<string>,
  direction: -1 | 1
): ModelDefinition {
  const selected = new Set(partIds)
  if (selected.size === 0) return model
  const parts = [...model.parts]
  if (direction < 0) {
    for (let index = 1; index < parts.length; index += 1) {
      const current = parts[index]
      const previous = parts[index - 1]
      if (
        current !== undefined &&
        previous !== undefined &&
        selected.has(current.id) &&
        !selected.has(previous.id)
      ) {
        parts[index - 1] = current
        parts[index] = previous
      }
    }
  } else {
    for (let index = parts.length - 2; index >= 0; index -= 1) {
      const current = parts[index]
      const next = parts[index + 1]
      if (
        current !== undefined &&
        next !== undefined &&
        selected.has(current.id) &&
        !selected.has(next.id)
      ) {
        parts[index] = next
        parts[index + 1] = current
      }
    }
  }
  if (parts.every((part, index) => part === model.parts[index])) return model
  return { ...cloneModel(model), parts }
}

export function setPartsMetadata(
  model: ModelDefinition,
  partIds: Iterable<string>,
  key: 'hidden-parts' | 'locked-parts',
  enabled: boolean
): ModelDefinition {
  const ids = new Set(partIds)
  if (ids.size === 0) return model
  const next = cloneModel(model)
  next.editor ??= {}
  const values = new Set(next.editor[key] ?? [])
  ids.forEach((id) => {
    if (enabled) values.add(id)
    else values.delete(id)
  })
  next.editor[key] = [...values]
  return next
}

export function assignMaterialToParts(
  model: ModelDefinition,
  partIds: Iterable<string>,
  material: string
): ModelDefinition {
  return updateParts(model, partIds, (part) => {
    part.material = material
  })
}

export function reorderPart(
  model: ModelDefinition,
  partId: string,
  direction: -1 | 1
): ModelDefinition {
  const index = model.parts.findIndex((part) => part.id === partId)
  const destination = index + direction
  if (index < 0 || destination < 0 || destination >= model.parts.length) return model
  const next = cloneModel(model)
  const [part] = next.parts.splice(index, 1)
  if (part === undefined) return model
  next.parts.splice(destination, 0, part)
  return next
}

function mirroredRotation(rotation: Vector3, axis: MirrorAxis): Vector3 {
  if (axis === 'x') {
    return {
      x: normalizeNumber(rotation.x),
      y: normalizeNumber(-rotation.y),
      z: normalizeNumber(-rotation.z)
    }
  }
  return {
    x: normalizeNumber(-rotation.x),
    y: normalizeNumber(-rotation.y),
    z: normalizeNumber(rotation.z)
  }
}

export function mirrorPart(
  model: ModelDefinition,
  partId: string,
  axis: MirrorAxis
): { model: ModelDefinition; partId: string } {
  const next = cloneModel(model)
  const sourceIndex = next.parts.findIndex((part) => part.id === partId)
  if (sourceIndex < 0) return { model, partId }
  const source = next.parts[sourceIndex]!
  const suffix = `mirror_${axis}`
  const copyId = generateUniquePartId(
    `${source.id}_${suffix}`,
    next.parts.map((part) => part.id)
  )
  const copy: ModelPart = structuredClone(source)
  copy.id = copyId
  copy.position[axis] = normalizeNumber(-copy.position[axis])
  copy['rotation-degrees'] = mirroredRotation(copy['rotation-degrees'], axis)
  next.parts.splice(sourceIndex + 1, 0, copy)
  addMetadataForCopy(next, source.id, copyId)
  return { model: next, partId: copyId }
}

export function setPartMetadata(
  model: ModelDefinition,
  partId: string,
  key: 'hidden-parts' | 'locked-parts',
  enabled: boolean
): ModelDefinition {
  const next = cloneModel(model)
  next.editor ??= {}
  const values = new Set(next.editor[key] ?? [])
  if (enabled) values.add(partId)
  else values.delete(partId)
  next.editor[key] = [...values]
  return next
}

export function normalizeNumericInput(
  input: string | number,
  fallback: number,
  limits?: { min?: number; max?: number }
): number {
  const parsed =
    typeof input === 'number' ? input : Number.parseFloat(input.trim().replace(',', '.'))
  if (!Number.isFinite(parsed)) return fallback
  const minimum = limits?.min ?? -Number.MAX_SAFE_INTEGER
  const maximum = limits?.max ?? Number.MAX_SAFE_INTEGER
  return normalizeNumber(Math.min(maximum, Math.max(minimum, parsed)))
}
