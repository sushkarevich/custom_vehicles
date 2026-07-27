import {
  act,
  fireEvent,
  render,
  screen,
  within
} from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  createDefaultModel,
  isModelDefinition,
  type ModelDefinition
} from '../../../shared/schema'
import { useDocumentStore } from '../../store/document-store'
import {
  addPart,
  renamePart,
  setPartMetadata
} from '../../store/operations'
import { PartList } from './PartList'

function threePartModel(): ModelDefinition {
  const roof = renamePart(addPart(createDefaultModel()).model, 'part', 'roof')
  return renamePart(addPart(roof.model).model, 'part', 'trim').model
}

function PartListHarness(): React.JSX.Element | null {
  const document = useDocumentStore((state) => state.history.present)
  const selectedPartIds = useDocumentStore((state) => state.selectedPartIds)
  const activePartId = useDocumentStore((state) => state.activePartId)
  if (!isModelDefinition(document)) return null
  return (
    <PartList
      model={document}
      selectedPartIds={selectedPartIds}
      activePartId={activePartId}
    />
  )
}

describe('иерархия multi-selection', () => {
  beforeEach(() => {
    useDocumentStore.getState().reset(threePartModel())
  })

  it('plain и Shift click используют ordered store selection и различают active row', () => {
    render(<PartListHarness />)
    const body = screen.getByRole('option', { name: /body/i })
    const roof = screen.getByRole('option', { name: /roof/i })
    const trim = screen.getByRole('option', { name: /trim/i })

    expect(body).toHaveClass('is-selected', 'is-active-selection')
    expect(roof).not.toHaveClass('is-selected')

    fireEvent.click(roof)
    expect(useDocumentStore.getState().selectedPartIds).toEqual(['roof'])
    expect(useDocumentStore.getState().activePartId).toBe('roof')
    expect(body).not.toHaveClass('is-selected')
    expect(roof).toHaveClass('is-selected', 'is-active-selection')

    fireEvent.click(trim, { shiftKey: true })
    expect(useDocumentStore.getState().selectedPartIds).toEqual([
      'roof',
      'trim'
    ])
    expect(useDocumentStore.getState().activePartId).toBe('trim')
    expect(roof).toHaveClass('is-selected')
    expect(roof).not.toHaveClass('is-active-selection')
    expect(trim).toHaveClass('is-selected', 'is-active-selection')

    fireEvent.click(trim, { shiftKey: true })
    expect(useDocumentStore.getState().selectedPartIds).toEqual(['roof'])
    expect(useDocumentStore.getState().activePartId).toBe('roof')
    expect(roof).toHaveClass('is-selected', 'is-active-selection')
    expect(trim).not.toHaveClass('is-selected')

    expect(useDocumentStore.getState().history.past).toHaveLength(0)
    expect(useDocumentStore.getState().dirty).toBe(false)
  })

  it('batch duplicate from hierarchy is one history entry and Undo restores selection', () => {
    render(<PartListHarness />)
    fireEvent.click(screen.getByRole('option', { name: /roof/i }), {
      shiftKey: true
    })

    fireEvent.click(screen.getByRole('button', { name: 'Дубликат' }))

    const duplicated = useDocumentStore.getState()
    expect(duplicated.history.past).toHaveLength(1)
    expect(duplicated.selectedPartIds).toEqual(['body_2', 'roof_2'])
    expect(duplicated.activePartId).toBe('roof_2')
    expect(
      isModelDefinition(duplicated.history.present)
        ? duplicated.history.present.parts.map((part) => part.id)
        : null
    ).toEqual(['body', 'body_2', 'roof', 'roof_2', 'trim'])
    expect(
      screen.getByRole('option', { name: /roof_2/i })
    ).toHaveClass('is-active-selection')

    act(() => useDocumentStore.getState().undo())

    expect(useDocumentStore.getState().selectedPartIds).toEqual([
      'body',
      'roof'
    ])
    expect(useDocumentStore.getState().activePartId).toBe('roof')
    expect(screen.getByRole('option', { name: /roof/i })).toHaveClass(
      'is-active-selection'
    )
  })

  it('показывает действие всей mixed selection на lock button', () => {
    const mixedLocks = setPartMetadata(
      threePartModel(),
      'body',
      'locked-parts',
      true
    )
    useDocumentStore.getState().reset(mixedLocks)
    useDocumentStore
      .getState()
      .setSelection(['body', 'roof'], 'roof')
    render(<PartListHarness />)
    const body = screen.getByRole('option', { name: /body/i })

    const lockAll = within(body).getByRole('button', {
      name: 'Заблокировать выбранные детали'
    })
    expect(lockAll).toHaveAttribute(
      'title',
      'Заблокировать выбранные детали'
    )
    fireEvent.click(lockAll)

    let state = useDocumentStore.getState()
    expect(state.history.past).toHaveLength(1)
    expect(
      isModelDefinition(state.history.present)
        ? state.history.present.editor?.['locked-parts']
        : null
    ).toEqual(['body', 'roof'])

    const unlockAll = within(body).getByRole('button', {
      name: 'Разблокировать выбранные детали'
    })
    expect(unlockAll).toHaveAttribute(
      'title',
      'Разблокировать выбранные детали'
    )
    fireEvent.click(unlockAll)

    state = useDocumentStore.getState()
    expect(state.history.past).toHaveLength(2)
    expect(
      isModelDefinition(state.history.present)
        ? state.history.present.editor?.['locked-parts']
        : null
    ).toEqual([])
  })
})
