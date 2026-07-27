import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  RESOURCE_PREVIEW_SETTINGS_VERSION,
  type ManualTextureView,
  type ResolvedMaterialPreview,
  type ResourcePreviewState
} from '../../../shared/resource-preview'
import { useResourcePreviewStore } from '../../store/resource-preview-store'
import { MaterialPicker } from './MaterialPicker'

const originalCreateObjectUrl = Object.getOwnPropertyDescriptor(
  URL,
  'createObjectURL'
)
const originalRevokeObjectUrl = Object.getOwnPropertyDescriptor(
  URL,
  'revokeObjectURL'
)
const originalResourceActions = {
  assignManualTexture:
    useResourcePreviewStore.getState().assignManualTexture,
  clearManualTexture: useResourcePreviewStore.getState().clearManualTexture
}

function previewState(
  manualTextures: ManualTextureView[] = []
): ResourcePreviewState {
  return {
    version: RESOURCE_PREVIEW_SETTINGS_VERSION,
    revision: 7,
    mode: 'textures',
    packs: [],
    vanilla: {
      enabled: true,
      sourceKind: null,
      sourcePath: null,
      version: null,
      missing: false,
      scanning: false,
      ready: false,
      cacheReused: false,
      detectedVersions: [],
      diagnostics: []
    },
    manualTextures
  }
}

function stonePreview(): ResolvedMaterialPreview {
  return {
    material: 'STONE',
    revision: 7,
    source: 'resource-pack',
    sourceName: 'Пак камня',
    modelPath: 'assets/minecraft/models/block/stone.json',
    faces: {
      top: {
        assetToken: 'pack_stone',
        logicalPath: 'minecraft:block/stone',
        sourcePackId: 'pack-a',
        sourceName: 'Пак камня',
        rotation: 0
      }
    },
    diagnostics: [
      {
        severity: 'warning',
        code: 'test-warning',
        message: 'Тестовая диагностика'
      }
    ]
  }
}

function manualStone(assetToken: string): ManualTextureView {
  return {
    material: 'STONE',
    face: 'all',
    assetToken,
    originalName: 'ручной камень.png',
    width: 16,
    height: 16
  }
}

function installAssetReader(
  readAsset: (assetToken: string) => Promise<Uint8Array>
): void {
  Object.defineProperty(window, 'editorApi', {
    configurable: true,
    value: {
      resourcePreview: { readAsset }
    }
  })
}

describe('MaterialPicker resource preview', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: vi.fn(() => 'blob:material-preview')
    })
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: vi.fn()
    })
    useResourcePreviewStore.setState({
      preview: previewState(),
      resolved: { STONE: stonePreview() },
      assignManualTexture: originalResourceActions.assignManualTexture,
      clearManualTexture: originalResourceActions.clearManualTexture
    })
  })

  afterEach(() => {
    cleanup()
    useResourcePreviewStore.setState(originalResourceActions)
    if (originalCreateObjectUrl === undefined) {
      Reflect.deleteProperty(URL, 'createObjectURL')
    } else {
      Object.defineProperty(URL, 'createObjectURL', originalCreateObjectUrl)
    }
    if (originalRevokeObjectUrl === undefined) {
      Reflect.deleteProperty(URL, 'revokeObjectURL')
    } else {
      Object.defineProperty(URL, 'revokeObjectURL', originalRevokeObjectUrl)
    }
  })

  it('показывает effective resource-pack source и загружает opaque asset token', async () => {
    const readAsset = vi.fn(async () => new Uint8Array([1, 2, 3]))
    installAssetReader(readAsset)

    render(<MaterialPicker value="STONE" onChange={vi.fn()} />)

    expect(screen.getByText('Пак камня')).toBeInTheDocument()
    expect(
      screen.getByText('assets/minecraft/models/block/stone.json')
    ).toBeInTheDocument()
    expect(screen.getByText('Тестовая диагностика')).toBeInTheDocument()
    const revealPaths = screen.getByRole('button', {
      name: 'Показать пути'
    })
    expect(revealPaths).toBeEnabled()
    fireEvent.click(revealPaths)
    expect(
      screen.getByLabelText('Пути ресурсов')
    ).toHaveTextContent('Модель: assets/minecraft/models/block/stone.json')
    expect(screen.getByLabelText('Пути ресурсов')).toHaveTextContent(
      'Текстура: minecraft:block/stone'
    )
    expect(
      screen.getByRole('button', { name: 'Скрыть пути' })
    ).toHaveAttribute('aria-expanded', 'true')
    expect(
      screen.getByRole('button', { name: 'Назначить PNG' })
    ).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Очистить' })).toBeDisabled()

    const image = await screen.findByRole('img', {
      name: 'Текстура STONE'
    })
    expect(readAsset).toHaveBeenCalledWith('pack_stone')
    expect(image).toHaveAttribute('src', 'blob:material-preview')
  })

  it('ставит manual texture выше pack source и связывает replace/clear controls со store', async () => {
    const readAsset = vi.fn(async () => new Uint8Array([4, 5, 6]))
    installAssetReader(readAsset)
    const assignManualTexture = vi.fn(
      async () => {
        useResourcePreviewStore.setState((current) => ({
          preview: {
            ...current.preview,
            revision: current.preview.revision + 1,
            manualTextures: [manualStone('manual_replacement')]
          }
        }))
      }
    )
    const clearManualTexture = vi.fn(async () => {
      useResourcePreviewStore.setState((current) => ({
        preview: {
          ...current.preview,
          revision: current.preview.revision + 1,
          manualTextures: []
        }
      }))
    })
    useResourcePreviewStore.setState({
      preview: previewState([manualStone('manual_initial')]),
      assignManualTexture,
      clearManualTexture
    })

    render(<MaterialPicker value="STONE" onChange={vi.fn()} />)

    expect(screen.getByText('Ручная текстура')).toBeInTheDocument()
    await waitFor(() =>
      expect(readAsset).toHaveBeenCalledWith('manual_initial')
    )
    expect(readAsset).not.toHaveBeenCalledWith('pack_stone')
    const replace = screen.getByRole('button', { name: 'Заменить PNG' })
    const clear = screen.getByRole('button', { name: 'Очистить' })
    expect(clear).toBeEnabled()

    fireEvent.click(replace)
    await waitFor(() => {
      expect(assignManualTexture).toHaveBeenCalledWith('STONE', 'all')
      expect(readAsset).toHaveBeenCalledWith('manual_replacement')
    })

    fireEvent.click(clear)
    await waitFor(() => {
      expect(clearManualTexture).toHaveBeenCalledWith('STONE', 'all')
      expect(screen.getByText('Пак камня')).toBeInTheDocument()
      expect(readAsset).toHaveBeenCalledWith('pack_stone')
    })
    expect(
      screen.getByRole('button', { name: 'Назначить PNG' })
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Очистить' })).toBeDisabled()
  })
})
