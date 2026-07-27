import {
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
  setPartMetadata,
  updatePart
} from '../../store/operations'
import { ModelInspector } from './ModelInspector'

function mixedModel(withMetadata = false): ModelDefinition {
  const added = addPart(createDefaultModel())
  let model = renamePart(added.model, added.partId, 'roof').model
  model = updatePart(model, 'body', (part) => {
    part.position.x = -2
    part.material = 'STONE'
  })
  model = updatePart(model, 'roof', (part) => {
    part.position.x = 4
    part.material = 'ACACIA_PLANKS'
  })
  if (withMetadata) {
    model = setPartMetadata(model, 'body', 'hidden-parts', true)
    model = setPartMetadata(model, 'roof', 'locked-parts', true)
  }
  return model
}

function ModelInspectorHarness(): React.JSX.Element | null {
  const document = useDocumentStore((state) => state.history.present)
  const selectedPartIds = useDocumentStore((state) => state.selectedPartIds)
  const activePartId = useDocumentStore((state) => state.activePartId)
  if (!isModelDefinition(document)) return null
  return (
    <ModelInspector
      model={document}
      selectedPartIds={selectedPartIds}
      activePartId={activePartId}
    />
  )
}

function inspectorSection(name: string): HTMLElement {
  const section = screen.getByRole('heading', { name }).closest('section')
  if (section === null) throw new Error(`Секция ${name} не найдена`)
  return section
}

describe('инспектор multi-selection', () => {
  beforeEach(() => {
    useDocumentStore.getState().reset(mixedModel())
    useDocumentStore.getState().setSelection(['body', 'roof'], 'roof')
  })

  it('явно показывает multi-selection, active и mixed значения', () => {
    useDocumentStore.getState().reset(mixedModel(true))
    useDocumentStore.getState().setSelection(['body', 'roof'], 'roof')
    render(<ModelInspectorHarness />)

    expect(
      screen.getByRole('heading', { name: 'Выбрано: 2' })
    ).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: 'Множественное выделение' })
    ).toBeInTheDocument()
    expect(
      screen.getByText('Выбрано деталей: 2 · Активная: roof')
    ).toBeInTheDocument()
    expect(
      screen.getByText('ID редактируется только для одной активной детали.')
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /Разные материалы/ })
    ).toBeInTheDocument()

    const positionX = within(inspectorSection('Позиция')).getByLabelText('X')
    expect(positionX).toHaveValue(null)
    expect(positionX).toHaveAttribute('placeholder', 'Смешано')

    const hidden = screen.getByRole('checkbox', {
      name: 'Скрыть выбранные детали'
    })
    const locked = screen.getByRole('checkbox', {
      name: 'Заблокировать выбранные детали'
    })
    expect(hidden).toHaveAttribute('aria-checked', 'mixed')
    expect((hidden as HTMLInputElement).indeterminate).toBe(true)
    expect(locked).toHaveAttribute('aria-checked', 'mixed')
    expect((locked as HTMLInputElement).indeterminate).toBe(true)
  })

  it('назначает material всей selection одной history entry', () => {
    render(<ModelInspectorHarness />)

    fireEvent.click(
      screen.getByRole('button', { name: /Разные материалы/ })
    )
    const search = screen.getByRole('combobox', {
      name: 'Поиск блочного материала'
    })
    fireEvent.change(search, { target: { value: 'RED_CONCRETE' } })
    fireEvent.click(
      screen.getByRole('option', {
        name: /^RED_CONCRETE\s*Red Concrete$/
      })
    )

    const state = useDocumentStore.getState()
    expect(state.history.past).toHaveLength(1)
    expect(state.selectedPartIds).toEqual(['body', 'roof'])
    expect(
      isModelDefinition(state.history.present)
        ? state.history.present.parts.map((part) => part.material)
        : null
    ).toEqual(['RED_CONCRETE', 'RED_CONCRETE'])
    expect(
      screen.getByRole('button', { name: /RED_CONCRETE/ })
    ).toBeInTheDocument()
  })

  it('применяет введённое mixed numeric значение ко всей selection одной transaction', () => {
    render(<ModelInspectorHarness />)
    const positionX = within(inspectorSection('Позиция')).getByLabelText('X')

    fireEvent.focus(positionX)
    fireEvent.change(positionX, { target: { value: '5' } })
    fireEvent.blur(positionX)

    const state = useDocumentStore.getState()
    expect(state.history.past).toHaveLength(1)
    expect(state.selectedPartIds).toEqual(['body', 'roof'])
    expect(
      isModelDefinition(state.history.present)
        ? state.history.present.parts.map((part) => part.position.x)
        : null
    ).toEqual([5, 5])
  })
})
