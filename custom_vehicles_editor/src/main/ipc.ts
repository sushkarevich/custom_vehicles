import { basename, join } from 'node:path'
import {
  app,
  dialog,
  ipcMain,
  nativeImage,
  shell,
  type BrowserWindow,
  type IpcMainInvokeEvent
} from 'electron'
import {
  IPC_CHANNELS,
  type ChooseSavePathRequest,
  type ExportDocumentRequest,
  type OpenedDocument,
  type SaveDocumentRequest
} from '../shared/ipc'
import type {
  PackMoveDirection,
  ResourcePreviewMode,
  ResourceTextureFace
} from '../shared/resource-preview'
import { BLOCK_MATERIAL_SET } from '../shared/materials'
import { assertAbsoluteDocumentPath, ensureYamlExtension, readDocumentFile, writeFileAtomically } from './file-system'
import { RecentFiles } from './recent-files'
import {
  resolveLiveEditorWindow,
  type EditorWindowResolver
} from './editor-window'
import { ResourcePreviewManager } from './resource-preview-manager'

const YAML_FILTER = [{ name: 'YAML CustomVehicles', extensions: ['yaml', 'yml'] }]
const MAX_IPC_CONTENT_LENGTH = 1_048_576

function assertSender(
  event: IpcMainInvokeEvent,
  resolveWindow: EditorWindowResolver<BrowserWindow>
): BrowserWindow {
  const window = resolveLiveEditorWindow(resolveWindow)
  if (window === null || event.sender !== window.webContents) {
    throw new Error('Недопустимый отправитель IPC')
  }
  return window
}

function assertRequestContent(content: unknown): asserts content is string {
  if (typeof content !== 'string') throw new Error('Некорректное содержимое документа')
  if (Buffer.byteLength(content, 'utf8') > MAX_IPC_CONTENT_LENGTH) {
    throw new Error('Документ слишком большой')
  }
}

export function registerIpcHandlers(
  resolveWindow: EditorWindowResolver<BrowserWindow>,
  resourceManagerOverride?: Promise<ResourcePreviewManager> | ResourcePreviewManager
): () => void {
  const recentFiles = new RecentFiles(join(app.getPath('userData'), 'recent-files.yaml'))
  const grantedPaths = new Set<string>()
  const registeredChannels: string[] = []
  const resourceManager = Promise.resolve(
    resourceManagerOverride ??
      ResourcePreviewManager.create(app.getPath('userData'))
  )
  let disposed = false
  let unsubscribeResourceEvents: (() => void) | null = null

  void resourceManager
    .then((manager) => {
      if (disposed) {
        manager.dispose()
        return
      }
      unsubscribeResourceEvents = manager.subscribe((resourceEvent) => {
        const window = resolveLiveEditorWindow(resolveWindow)
        if (window !== null) {
          window.webContents.send(IPC_CHANNELS.resourcePreviewEvent, resourceEvent)
        }
      })
    })
    .catch((error: unknown) => {
      console.error('Resource preview initialization failed', error)
    })

  const register = <Args extends unknown[], Result>(
    channel: string,
    handler: (event: IpcMainInvokeEvent, ...args: Args) => Promise<Result>
  ): void => {
    ipcMain.handle(channel, handler)
    registeredChannels.push(channel)
  }

  register(IPC_CHANNELS.openDocument, async (event): Promise<OpenedDocument | null> => {
    const window = assertSender(event, resolveWindow)
    const selected = await dialog.showOpenDialog(window, {
      title: 'Открыть модель или вариант транспорта',
      properties: ['openFile'],
      filters: YAML_FILTER
    })
    const selectedPath = selected.filePaths[0]
    if (selected.canceled || selectedPath === undefined) return null
    const filePath = assertAbsoluteDocumentPath(selectedPath)
    const content = await readDocumentFile(filePath)
    grantedPaths.add(filePath)
    await recentFiles.touch(filePath)
    return { filePath, content }
  })

  register(
    IPC_CHANNELS.openRecent,
    async (event, requestedPath: string): Promise<OpenedDocument> => {
      assertSender(event, resolveWindow)
      const filePath = assertAbsoluteDocumentPath(requestedPath)
      if (!(await recentFiles.contains(filePath))) {
        throw new Error('Файл отсутствует в списке недавних')
      }
      const content = await readDocumentFile(filePath)
      grantedPaths.add(filePath)
      await recentFiles.touch(filePath)
      return { filePath, content }
    }
  )

  register(IPC_CHANNELS.recentDocuments, async (event) => {
    assertSender(event, resolveWindow)
    const recent = await recentFiles.list()
    recent.forEach((entry) => grantedPaths.add(entry.filePath))
    return recent
  })

  register(
    IPC_CHANNELS.chooseSavePath,
    async (event, request: ChooseSavePathRequest): Promise<string | null> => {
      const window = assertSender(event, resolveWindow)
      const currentPath =
        request.currentPath === undefined ? undefined : assertAbsoluteDocumentPath(request.currentPath)
      const defaultPath = currentPath ?? ensureYamlExtension(request.suggestedName)
      const result = await dialog.showSaveDialog(window, {
        title: 'Сохранить документ CustomVehicles',
        defaultPath,
        filters: YAML_FILTER
      })
      if (result.canceled || result.filePath === undefined) return null
      const filePath = assertAbsoluteDocumentPath(ensureYamlExtension(result.filePath))
      grantedPaths.add(filePath)
      return filePath
    }
  )

  register(
    IPC_CHANNELS.saveDocument,
    async (event, request: SaveDocumentRequest): Promise<{ filePath: string }> => {
      assertSender(event, resolveWindow)
      const filePath = assertAbsoluteDocumentPath(request.filePath)
      if (!grantedPaths.has(filePath)) {
        throw new Error('Сохранение разрешено только в выбранный пользователем файл')
      }
      assertRequestContent(request.content)
      await writeFileAtomically(filePath, request.content)
      await recentFiles.touch(filePath)
      return { filePath }
    }
  )

  register(
    IPC_CHANNELS.exportDocument,
    async (event, request: ExportDocumentRequest): Promise<{ filePath: string } | null> => {
      const window = assertSender(event, resolveWindow)
      assertRequestContent(request.content)
      const result = await dialog.showSaveDialog(window, {
        title: 'Экспортировать в каталог CustomVehicles',
        buttonLabel: 'Экспортировать',
        defaultPath: ensureYamlExtension(request.suggestedName),
        filters: YAML_FILTER
      })
      if (result.canceled || result.filePath === undefined) return null
      const filePath = assertAbsoluteDocumentPath(ensureYamlExtension(result.filePath))
      await writeFileAtomically(filePath, request.content)
      grantedPaths.add(filePath)
      await recentFiles.touch(filePath)
      return { filePath }
    }
  )

  register(
    IPC_CHANNELS.confirmDiscard,
    async (event, documentName: string): Promise<boolean> => {
      const window = assertSender(event, resolveWindow)
      const safeName =
        typeof documentName === 'string' && documentName.length > 0
          ? basename(documentName).slice(0, 160)
          : 'текущий документ'
      const result = await dialog.showMessageBox(window, {
        type: 'warning',
        title: 'Несохранённые изменения',
        message: `Отбросить изменения в «${safeName}»?`,
        detail: 'При продолжении несохранённые изменения будут потеряны.',
        buttons: ['Отмена', 'Не сохранять'],
        defaultId: 0,
        cancelId: 0,
        noLink: true
      })
      return result.response === 1
    }
  )

  register(IPC_CHANNELS.resourcePreviewState, async (event) => {
    assertSender(event, resolveWindow)
    return (await resourceManager).getState()
  })

  register(IPC_CHANNELS.resourcePreviewAddDirectory, async (event) => {
    const window = assertSender(event, resolveWindow)
    const selected = await dialog.showOpenDialog(window, {
      title: 'Добавить папку ресурс-пака',
      properties: ['openDirectory']
    })
    const sourcePath = selected.filePaths[0]
    const manager = await resourceManager
    return selected.canceled || sourcePath === undefined
      ? manager.getState()
      : manager.addPack('directory', sourcePath)
  })

  register(IPC_CHANNELS.resourcePreviewAddZip, async (event) => {
    const window = assertSender(event, resolveWindow)
    const selected = await dialog.showOpenDialog(window, {
      title: 'Добавить ZIP ресурс-пака',
      properties: ['openFile'],
      filters: [{ name: 'Minecraft resource pack', extensions: ['zip'] }]
    })
    const sourcePath = selected.filePaths[0]
    const manager = await resourceManager
    return selected.canceled || sourcePath === undefined
      ? manager.getState()
      : manager.addPack('zip', sourcePath)
  })

  register(
    IPC_CHANNELS.resourcePreviewSetMode,
    async (event, mode: ResourcePreviewMode) => {
      assertSender(event, resolveWindow)
      return (await resourceManager).setMode(mode)
    }
  )

  register(
    IPC_CHANNELS.resourcePreviewSetPackEnabled,
    async (event, packId: string, enabled: boolean) => {
      assertSender(event, resolveWindow)
      return (await resourceManager).setPackEnabled(packId, enabled)
    }
  )

  register(
    IPC_CHANNELS.resourcePreviewMovePack,
    async (event, packId: string, direction: PackMoveDirection) => {
      assertSender(event, resolveWindow)
      return (await resourceManager).movePack(packId, direction)
    }
  )

  register(
    IPC_CHANNELS.resourcePreviewRemovePack,
    async (event, packId: string) => {
      assertSender(event, resolveWindow)
      return (await resourceManager).removePack(packId)
    }
  )

  register(
    IPC_CHANNELS.resourcePreviewRescanPack,
    async (event, packId: string) => {
      assertSender(event, resolveWindow)
      return (await resourceManager).rescanPack(packId)
    }
  )

  register(
    IPC_CHANNELS.resourcePreviewRevealPack,
    async (event, packId: string): Promise<void> => {
      assertSender(event, resolveWindow)
      const sourcePath = (await resourceManager).packSourcePath(packId)
      shell.showItemInFolder(sourcePath)
    }
  )

  register(IPC_CHANNELS.resourcePreviewDiscoverVanilla, async (event) => {
    assertSender(event, resolveWindow)
    return (await resourceManager).discoverVanilla()
  })

  register(IPC_CHANNELS.resourcePreviewSelectVanillaJar, async (event) => {
    const window = assertSender(event, resolveWindow)
    const selected = await dialog.showOpenDialog(window, {
      title: 'Выбрать client JAR Minecraft',
      properties: ['openFile'],
      filters: [{ name: 'Minecraft client JAR', extensions: ['jar'] }]
    })
    const sourcePath = selected.filePaths[0]
    const manager = await resourceManager
    return selected.canceled || sourcePath === undefined
      ? manager.getState()
      : manager.selectVanillaJar(sourcePath)
  })

  register(
    IPC_CHANNELS.resourcePreviewSelectVanillaVersion,
    async (event, candidateId: string) => {
      assertSender(event, resolveWindow)
      return (await resourceManager).selectDetectedVanilla(candidateId)
    }
  )

  register(
    IPC_CHANNELS.resourcePreviewSetVanillaEnabled,
    async (event, enabled: boolean) => {
      assertSender(event, resolveWindow)
      return (await resourceManager).setVanillaEnabled(enabled)
    }
  )

  register(IPC_CHANNELS.resourcePreviewRefreshVanilla, async (event) => {
    assertSender(event, resolveWindow)
    return (await resourceManager).rescanVanilla()
  })

  register(
    IPC_CHANNELS.resourcePreviewRevealVanilla,
    async (event): Promise<void> => {
      assertSender(event, resolveWindow)
      const sourcePath = (await resourceManager).vanillaSourcePath()
      if (sourcePath === null) throw new Error('Minecraft JAR не выбран')
      shell.showItemInFolder(sourcePath)
    }
  )

  register(
    IPC_CHANNELS.resourcePreviewAssignManual,
    async (
      event,
      material: string,
      face: ResourceTextureFace = 'all'
    ) => {
      const window = assertSender(event, resolveWindow)
      if (!BLOCK_MATERIAL_SET.has(material)) throw new Error('Неизвестный блочный Material')
      const selected = await dialog.showOpenDialog(window, {
        title: `Назначить PNG для ${material}`,
        properties: ['openFile'],
        filters: [{ name: 'PNG texture', extensions: ['png'] }]
      })
      const sourcePath = selected.filePaths[0]
      const manager = await resourceManager
      if (selected.canceled || sourcePath === undefined) return manager.getState()
      return manager.importManualTexture(material, face, sourcePath, (content) => {
        const image = nativeImage.createFromBuffer(content, { scaleFactor: 1 })
        if (image.isEmpty()) throw new Error('PNG не удалось декодировать')
        const size = image.getSize()
        return {
          png: image.toPNG(),
          width: size.width,
          height: size.height
        }
      })
    }
  )

  register(
    IPC_CHANNELS.resourcePreviewClearManual,
    async (
      event,
      material: string,
      face: ResourceTextureFace = 'all'
    ) => {
      assertSender(event, resolveWindow)
      return (await resourceManager).clearManualTexture(material, face)
    }
  )

  register(
    IPC_CHANNELS.resourcePreviewResolveMaterials,
    async (event, materials: string[]) => {
      assertSender(event, resolveWindow)
      return (await resourceManager).resolveMaterials(materials)
    }
  )

  register(
    IPC_CHANNELS.resourcePreviewReadAsset,
    async (event, assetToken: string) => {
      assertSender(event, resolveWindow)
      return (await resourceManager).readAsset(assetToken)
    }
  )

  return () => {
    disposed = true
    unsubscribeResourceEvents?.()
    unsubscribeResourceEvents = null
    registeredChannels.forEach((channel) => ipcMain.removeHandler(channel))
    void resourceManager
      .then((manager) => manager.dispose())
      .catch(() => undefined)
  }
}
