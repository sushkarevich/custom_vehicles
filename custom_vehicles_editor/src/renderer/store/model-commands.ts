import type { ModelDefinition } from '../../shared/schema'
import {
  assignMaterialToParts,
  deleteParts,
  duplicateParts,
  mirrorParts,
  reorderParts,
  setPartsMetadata,
  type MirrorAxis
} from './operations'
import {
  normalizePartSelection,
  selectionFromIds,
  type PartSelection
} from './selection'

type PartMetadataKey = 'hidden-parts' | 'locked-parts'

export type ModelSelectionCommand =
  | { type: 'delete' }
  | { type: 'duplicate' }
  | { type: 'mirror'; axis: MirrorAxis }
  | { type: 'set-metadata'; key: PartMetadataKey; enabled: boolean }
  | { type: 'assign-material'; material: string }
  | { type: 'reorder'; direction: -1 | 1 }

export interface ModelSelectionCommandResult {
  model: ModelDefinition
  selection: PartSelection
  notice: string | null
}

function skippedLockedNotice(skipped: number): string | null {
  return skipped === 0
    ? null
    : `Пропущено заблокированных деталей: ${skipped}.`
}

function commandTargets(
  model: ModelDefinition,
  selection: PartSelection,
  includeLocked: boolean
): { selection: PartSelection; partIds: string[]; skippedLocked: number } {
  const normalized = normalizePartSelection(selection, model)
  if (includeLocked) {
    return {
      selection: normalized,
      partIds: normalized.selectedPartIds,
      skippedLocked: 0
    }
  }
  const locked = new Set(model.editor?.['locked-parts'] ?? [])
  const partIds = normalized.selectedPartIds.filter((id) => !locked.has(id))
  return {
    selection: normalized,
    partIds,
    skippedLocked: normalized.selectedPartIds.length - partIds.length
  }
}

/**
 * Pure bulk model command path. The caller commits this result atomically so a
 * command always produces at most one document history entry.
 *
 * Locked parts are skipped by all selected-part commands except lock/unlock
 * itself. This keeps the policy predictable and lets the UI report one concise
 * notice without partially hiding the command behavior in individual widgets.
 */
export function executeModelSelectionCommand(
  model: ModelDefinition,
  currentSelection: PartSelection,
  command: ModelSelectionCommand
): ModelSelectionCommandResult {
  const includeLocked =
    command.type === 'set-metadata' && command.key === 'locked-parts'
  const targets = commandTargets(model, currentSelection, includeLocked)
  const notice = skippedLockedNotice(targets.skippedLocked)

  if (targets.partIds.length === 0) {
    return { model, selection: targets.selection, notice }
  }

  switch (command.type) {
    case 'delete': {
      const result = deleteParts(
        model,
        targets.partIds,
        targets.selection.activePartId
      )
      if (result.deletedPartIds.length === 0) {
        return {
          model,
          selection: targets.selection,
          notice: 'Нельзя удалить все детали модели.'
        }
      }
      const deleted = new Set(result.deletedPartIds)
      const remainingSelected = targets.selection.selectedPartIds.filter(
        (id) => !deleted.has(id)
      )
      const selection =
        remainingSelected.length > 0
          ? selectionFromIds(remainingSelected, targets.selection.activePartId)
          : selectionFromIds(
              result.selectedPartId === null ? [] : [result.selectedPartId],
              result.selectedPartId
            )
      return { model: result.model, selection, notice }
    }
    case 'duplicate': {
      const result = duplicateParts(model, targets.partIds)
      const selectedPartIds = targets.partIds.flatMap((sourceId) => {
        const copyId = result.partIdBySource.get(sourceId)
        return copyId === undefined ? [] : [copyId]
      })
      const activePartId =
        targets.selection.activePartId === null
          ? null
          : (result.partIdBySource.get(targets.selection.activePartId) ?? null)
      return {
        model: result.model,
        selection: selectionFromIds(selectedPartIds, activePartId),
        notice
      }
    }
    case 'mirror': {
      const result = mirrorParts(model, targets.partIds, command.axis)
      const selectedPartIds = targets.partIds.flatMap((sourceId) => {
        const copyId = result.partIdBySource.get(sourceId)
        return copyId === undefined ? [] : [copyId]
      })
      const activePartId =
        targets.selection.activePartId === null
          ? null
          : (result.partIdBySource.get(targets.selection.activePartId) ?? null)
      return {
        model: result.model,
        selection: selectionFromIds(selectedPartIds, activePartId),
        notice
      }
    }
    case 'set-metadata':
      return {
        model: setPartsMetadata(
          model,
          targets.partIds,
          command.key,
          command.enabled
        ),
        selection: targets.selection,
        notice
      }
    case 'assign-material':
      return {
        model: assignMaterialToParts(
          model,
          targets.partIds,
          command.material
        ),
        selection: targets.selection,
        notice
      }
    case 'reorder':
      return {
        model: reorderParts(model, targets.partIds, command.direction),
        selection: targets.selection,
        notice
      }
  }
}
