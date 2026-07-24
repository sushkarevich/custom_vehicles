import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createDefaultModel } from '../../shared/schema'
import type { EditorApi } from '../../shared/ipc'
import { useDocumentStore } from '../store/document-store'
import { App } from './App'

vi.mock('./components/Viewport', () => ({
  Viewport: () => <main aria-label="Трёхмерная сцена">3D viewport</main>
}))

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
  setDirty: vi.fn()
}

describe('запуск renderer', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'editorApi', {
      configurable: true,
      value: api
    })
    useDocumentStore.getState().reset(createDefaultModel())
    vi.clearAllMocks()
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
    fireEvent.keyDown(idInput, { key: 'w' })
    expect(screen.getByRole('button', { name: 'Перемещение (W)' })).toHaveAttribute('aria-pressed', 'true')
    await waitFor(() => expect(api.getRecentDocuments).toHaveBeenCalled())
  })
})
