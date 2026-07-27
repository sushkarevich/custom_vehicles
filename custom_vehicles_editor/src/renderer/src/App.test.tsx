import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { EditorHistoryCommand } from '../../shared/history-commands'
import { createDefaultModel, isModelDefinition } from '../../shared/schema'
import type { EditorApi } from '../../shared/ipc'
import { useDocumentStore } from '../store/document-store'
import { addPart } from '../store/operations'
import type { CameraCommand } from './types'
import { App } from './App'

interface ViewportMockProps {
  command: CameraCommand
}

const viewportSpy = vi.hoisted(() => vi.fn<(props: ViewportMockProps) => void>())
vi.mock('./components/Viewport', () => ({
  Viewport: (props: ViewportMockProps) => {
    viewportSpy(props)
    return <main aria-label="Трёхмерная сцена">3D viewport</main>
  }
}))

let historyCommandListener: ((command: EditorHistoryCommand) => void) | null = null
const api: EditorApi = {
  openDocument: vi.fn(async () => null),
  openRecent: vi.fn(async () => {
    throw new Error('not configured')
  }),
  getRecentDocuments: vi.fn(async () => []),
  chooseSavePath: vi.fn(async () => null),
  saveDocument: vi.fn(async (request: { filePath: string }) => ({ filePath: request.filePath })),
  exportDocument: vi.fn(async () => null),
  confirmDiscard: vi.fn(async () => true),
  setDirty: vi.fn(),
  onHistoryCommand: vi.fn((listener: (command: EditorHistoryCommand) => void) => {
    historyCommandListener = listener
    return () => {
      historyCommandListener = null
    }
  }),
  setHistoryState: vi.fn()
}

describe('запуск renderer', () => {
  function latestCameraCommand(): CameraCommand {
    const call = viewportSpy.mock.calls.at(-1)
    if (call === undefined) throw new Error('Viewport не был отрисован')
    return call[0].command
  }

  beforeEach(() => {
    Object.defineProperty(window, 'editorApi', {
      configurable: true,
      value: api
    })
    useDocumentStore.getState().reset(createDefaultModel())
    historyCommandListener = null
    vi.clearAllMocks()
    viewportSpy.mockClear()
  })

  it('показывает русскую оболочку модели и безопасно запрашивает recent', async () => {
    render(<App />)
    expect(screen.getByLabelText('Редактор CustomVehicles')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Детали' })).toBeInTheDocument()
    expect(screen.getByLabelText('Трёхмерная сцена')).toBeInTheDocument()
    expect(screen.getByText('Схема корректна')).toBeInTheDocument()
    await waitFor(() => expect(api.getRecentDocuments).toHaveBeenCalled())
  })

  it('переключается в структурированный режим варианта', async () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Новый вариант транспорта' }))
    expect(await screen.findByRole('heading', { name: 'Вариант' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Вариант транспорта' })).toBeInTheDocument()
    expect(screen.getByText('Предпросмотр YAML')).toBeInTheDocument()
  })

  it('не перехватывает W во время ввода текста', async () => {
    render(<App />)
    const idInput = screen.getByDisplayValue('new_model')
    fireEvent.keyDown(idInput, { key: 'w', code: 'KeyW' })
    expect(screen.getByRole('button', { name: 'Перемещение (W)' })).toHaveAttribute('aria-pressed', 'true')
    await waitFor(() => expect(api.getRecentDocuments).toHaveBeenCalled())
  })

  it('переключает W/E/R по физическим клавишам при русской раскладке', () => {
    render(<App />)

    fireEvent.keyDown(document.body, { key: 'у', code: 'KeyE' })
    expect(screen.getByRole('button', { name: 'Вращение (E)' })).toHaveAttribute('aria-pressed', 'true')

    fireEvent.keyDown(document.body, { key: 'к', code: 'KeyR' })
    expect(screen.getByRole('button', { name: 'Масштаб (R)' })).toHaveAttribute('aria-pressed', 'true')

    fireEvent.keyDown(document.body, { key: 'ц', code: 'KeyW' })
    expect(screen.getByRole('button', { name: 'Перемещение (W)' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('направляет toolbar и native menu IPC в один history action path', async () => {
    render(<App />)
    act(() => {
      useDocumentStore.getState().update((document) => ({ ...document, id: 'changed_model' }))
    })
    const undoButton = screen.getByRole('button', { name: 'Отменить (Ctrl/Cmd+Z)' })
    await waitFor(() => expect(undoButton).toBeEnabled())

    fireEvent.click(undoButton)
    expect(useDocumentStore.getState().history.present.id).toBe('new_model')

    act(() => useDocumentStore.getState().redo())
    expect(useDocumentStore.getState().history.present.id).toBe('changed_model')
    act(() => historyCommandListener?.('undo'))
    expect(useDocumentStore.getState().history.present.id).toBe('new_model')
  })

  it('не выполняет history дважды через renderer keydown и menu accelerator', () => {
    useDocumentStore.getState().update((document) => ({ ...document, id: 'first_change' }))
    useDocumentStore.getState().update((document) => ({ ...document, id: 'second_change' }))
    render(<App />)

    fireEvent.keyDown(document.body, { key: 'z', metaKey: true })
    expect(useDocumentStore.getState().history.present.id).toBe('second_change')

    act(() => historyCommandListener?.('undo'))
    expect(useDocumentStore.getState().history.present.id).toBe('first_change')
  })

  it('сообщает focus policy и не запускает application undo внутри input', async () => {
    useDocumentStore.getState().update((document) => ({ ...document, id: 'edited_model' }))
    render(<App />)
    const input = screen.getByDisplayValue('edited_model')

    fireEvent.focus(input)
    await waitFor(() =>
      expect(api.setHistoryState).toHaveBeenLastCalledWith({
        canUndo: true,
        canRedo: false,
        textEditing: true
      })
    )
    fireEvent.keyDown(input, { key: 'z', metaKey: true })
    expect(useDocumentStore.getState().history.present.id).toBe('edited_model')
  })

  it('не создаёт camera command при selection, но инициализирует новый документ', async () => {
    render(<App />)
    const initialCommand = latestCameraCommand()

    act(() => useDocumentStore.getState().selectPart(null))
    const afterClear = latestCameraCommand()
    expect(afterClear).toBe(initialCommand)

    act(() => useDocumentStore.getState().selectPart('body'))
    const afterSelection = latestCameraCommand()
    expect(afterSelection).toBe(initialCommand)

    act(() => useDocumentStore.getState().reset(createDefaultModel()))
    await waitFor(() => {
      const afterLoad = latestCameraCommand()
      expect(afterLoad.view).toBe('perspective')
      expect(afterLoad.nonce).toBeGreaterThan(initialCommand.nonce)
    })
  })

  it('keyboard duplicate/delete применяются ко всей selection ровно по одному разу', () => {
    const first = addPart(createDefaultModel())
    const second = addPart(first.model)
    useDocumentStore.getState().reset(second.model)
    useDocumentStore
      .getState()
      .setSelection(['body', first.partId], first.partId)
    render(<App />)

    fireEvent.keyDown(document.body, {
      key: 'd',
      code: 'KeyD',
      ctrlKey: true
    })

    let state = useDocumentStore.getState()
    expect(state.history.past).toHaveLength(1)
    expect(state.selectedPartIds).toEqual(['body_2', 'part_3'])
    expect(
      isModelDefinition(state.history.present)
        ? state.history.present.parts.map((part) => part.id)
        : null
    ).toEqual(['body', 'body_2', 'part', 'part_3', 'part_2'])

    fireEvent.keyDown(document.body, {
      key: 'Delete',
      code: 'Delete'
    })

    state = useDocumentStore.getState()
    expect(state.history.past).toHaveLength(2)
    expect(
      isModelDefinition(state.history.present)
        ? state.history.present.parts.map((part) => part.id)
        : null
    ).toEqual(['body', 'part', 'part_2'])
  })

  it('keyboard batch commands не срабатывают внутри input', () => {
    const added = addPart(createDefaultModel())
    useDocumentStore.getState().reset(added.model)
    useDocumentStore
      .getState()
      .setSelection(['body', added.partId], added.partId)
    render(<App />)
    const input = screen.getByDisplayValue('new_model')

    fireEvent.keyDown(input, {
      key: 'd',
      code: 'KeyD',
      ctrlKey: true
    })
    fireEvent.keyDown(input, {
      key: 'Backspace',
      code: 'Backspace'
    })

    expect(useDocumentStore.getState().history.past).toHaveLength(0)
    const documentAfterEditingKeys =
      useDocumentStore.getState().history.present
    expect(
      isModelDefinition(documentAfterEditingKeys)
        ? documentAfterEditingKeys.parts
        : []
    ).toHaveLength(2)
  })

  it('resource modal приостанавливает Delete и Cmd/Ctrl+D для модели', () => {
    const added = addPart(createDefaultModel())
    useDocumentStore.getState().reset(added.model)
    useDocumentStore
      .getState()
      .setSelection(['body', added.partId], added.partId)
    render(<App />)
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Настройки ресурс-паков и ручных текстур'
      })
    )
    const modalButton = screen.getByRole('button', {
      name: 'Добавить папку'
    })

    fireEvent.keyDown(modalButton, {
      key: 'Delete',
      code: 'Delete'
    })
    fireEvent.keyDown(modalButton, {
      key: 'd',
      code: 'KeyD',
      metaKey: true
    })

    const state = useDocumentStore.getState()
    expect(state.history.past).toHaveLength(0)
    expect(state.selectedPartIds).toEqual(['body', added.partId])
    expect(
      isModelDefinition(state.history.present)
        ? state.history.present.parts.map((part) => part.id)
        : null
    ).toEqual(['body', added.partId])
  })
})
