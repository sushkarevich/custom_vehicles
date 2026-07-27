import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RESOURCE_PREVIEW_SETTINGS_VERSION } from '../../../shared/resource-preview'
import { useResourcePreviewStore } from '../../store/resource-preview-store'
import { ResourcePackManager } from './ResourcePackManager'

const originalActions = {
  discoverVanilla: useResourcePreviewStore.getState().discoverVanilla,
  selectVanillaJar: useResourcePreviewStore.getState().selectVanillaJar,
  selectVanillaVersion:
    useResourcePreviewStore.getState().selectVanillaVersion,
  setVanillaEnabled: useResourcePreviewStore.getState().setVanillaEnabled,
  refreshVanilla: useResourcePreviewStore.getState().refreshVanilla,
  revealVanilla: useResourcePreviewStore.getState().revealVanilla
}

describe('менеджер ванильных ресурсов Minecraft', () => {
  beforeEach(() => {
    useResourcePreviewStore.setState({
      preview: {
        version: RESOURCE_PREVIEW_SETTINGS_VERSION,
        revision: 12,
        mode: 'textures',
        packs: [],
        vanilla: {
          enabled: true,
          sourceKind: 'automatic',
          sourcePath:
            '/Users/Игрок/Library/Application Support/minecraft/versions/1.21.1/1.21.1.jar',
          version: '1.21.1',
          missing: false,
          scanning: false,
          ready: true,
          cacheReused: true,
          detectedVersions: [
            {
              id: 'mc_1211',
              version: '1.21.1',
              jarPath:
                '/Users/Игрок/Library/Application Support/minecraft/versions/1.21.1/1.21.1.jar',
              releaseType: 'release',
              compatible: true,
              preferred: true,
              metadataAvailable: true
            },
            {
              id: 'mc_1214',
              version: '1.21.4',
              jarPath: '/Users/Игрок/Другой лаунчер/1.21.4.jar',
              releaseType: 'release',
              compatible: true,
              preferred: false,
              metadataAvailable: true
            }
          ],
          diagnostics: []
        },
        manualTextures: []
      },
      busy: false,
      error: null,
      discoverVanilla: vi.fn(async () => undefined),
      selectVanillaJar: vi.fn(async () => undefined),
      selectVanillaVersion: vi.fn(async () => undefined),
      setVanillaEnabled: vi.fn(async () => undefined),
      refreshVanilla: vi.fn(async () => undefined),
      revealVanilla: vi.fn(async () => undefined)
    })
  })

  afterEach(() => {
    cleanup()
    useResourcePreviewStore.setState(originalActions)
  })

  it('показывает источник, cache, версии и все требуемые русские действия', () => {
    render(<ResourcePackManager onClose={vi.fn()} />)

    expect(
      screen.getByRole('heading', {
        name: 'Ванильные ресурсы Minecraft 1.21.1'
      })
    ).toBeInTheDocument()
    expect(screen.getByText(/найден автоматически/)).toBeInTheDocument()
    expect(screen.getByText(/cache переиспользован/)).toBeInTheDocument()
    expect(
      screen.getByText(/Library\/Application Support\/minecraft/)
    ).toBeInTheDocument()

    fireEvent.click(
      screen.getByRole('button', { name: 'Найти автоматически' })
    )
    fireEvent.click(
      screen.getByRole('button', { name: 'Выбрать Minecraft JAR' })
    )
    fireEvent.click(
      screen.getByRole('button', { name: 'Обновить ресурсы' })
    )
    fireEvent.click(
      screen.getByRole('button', { name: 'Открыть расположение' })
    )
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Отключить ванильные текстуры'
      })
    )
    fireEvent.change(screen.getByLabelText('Обнаруженная версия'), {
      target: { value: 'mc_1214' }
    })

    const state = useResourcePreviewStore.getState()
    expect(state.discoverVanilla).toHaveBeenCalledOnce()
    expect(state.selectVanillaJar).toHaveBeenCalledOnce()
    expect(state.refreshVanilla).toHaveBeenCalledOnce()
    expect(state.revealVanilla).toHaveBeenCalledOnce()
    expect(state.setVanillaEnabled).toHaveBeenCalledWith(false)
    expect(state.selectVanillaVersion).toHaveBeenCalledWith('mc_1214')
    expect(screen.getByText(/ручной PNG/)).toHaveTextContent(
      'ручной PNG → включённые паки → ваниль Minecraft → цвет материала'
    )
  })
})
