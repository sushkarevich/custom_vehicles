import type { ModelDefinition } from '../../shared/schema'

export interface PartSelection {
  selectedPartIds: string[]
  activePartId: string | null
}

export const EMPTY_PART_SELECTION: PartSelection = {
  selectedPartIds: [],
  activePartId: null
}

export function createPartSelection(partId: string | null): PartSelection {
  return partId === null
    ? { selectedPartIds: [], activePartId: null }
    : { selectedPartIds: [partId], activePartId: partId }
}

export function normalizePartSelection(
  selection: PartSelection,
  model: ModelDefinition | null
): PartSelection {
  if (model === null) return EMPTY_PART_SELECTION
  const valid = new Set(model.parts.map((part) => part.id))
  const selectedPartIds = selection.selectedPartIds.filter(
    (id, index, entries) => valid.has(id) && entries.indexOf(id) === index
  )
  const activePartId =
    selection.activePartId !== null && selectedPartIds.includes(selection.activePartId)
      ? selection.activePartId
      : (selectedPartIds.at(-1) ?? null)
  return { selectedPartIds, activePartId }
}

export function reducePartSelection(
  selection: PartSelection,
  partId: string,
  additive: boolean
): PartSelection {
  if (!additive) return createPartSelection(partId)
  if (!selection.selectedPartIds.includes(partId)) {
    return {
      selectedPartIds: [...selection.selectedPartIds, partId],
      activePartId: partId
    }
  }
  const selectedPartIds = selection.selectedPartIds.filter((id) => id !== partId)
  return {
    selectedPartIds,
    activePartId:
      selection.activePartId === partId
        ? (selectedPartIds.at(-1) ?? null)
        : selection.activePartId
  }
}

export type PartSelectionIntent =
  | { type: 'part'; partId: string; additive: boolean }
  | { type: 'empty'; additive: boolean }

/**
 * Shared hierarchy/viewport selection semantics. The array is ordered by
 * selection recency; its final entry is the deterministic active fallback.
 */
export function reducePartSelectionIntent(
  selection: PartSelection,
  intent: PartSelectionIntent
): PartSelection {
  if (intent.type === 'empty') {
    return intent.additive ? selection : createPartSelection(null)
  }
  return reducePartSelection(selection, intent.partId, intent.additive)
}

export function selectionFromIds(
  partIds: Iterable<string>,
  activePartId?: string | null
): PartSelection {
  const selectedPartIds = [...new Set(partIds)]
  return {
    selectedPartIds,
    activePartId:
      activePartId !== undefined && activePartId !== null && selectedPartIds.includes(activePartId)
        ? activePartId
        : (selectedPartIds.at(-1) ?? null)
  }
}
