import { basename, join } from 'node:path'
import {
  app,
  dialog,
  ipcMain,
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
import { assertAbsoluteDocumentPath, ensureYamlExtension, readDocumentFile, writeFileAtomically } from './file-system'
import { RecentFiles } from './recent-files'

const YAML_FILTER = [{ name: 'YAML CustomVehicles', extensions: ['yaml', 'yml'] }]
const MAX_IPC_CONTENT_LENGTH = 1_048_576

function assertSender(event: IpcMainInvokeEvent, window: BrowserWindow): void {
  if (event.sender !== window.webContents) {
    throw new Error('Недопустимый отправитель IPC')
  }
}

function assertRequestContent(content: unknown): asserts content is string {
  if (typeof content !== 'string') throw new Error('Некорректное содержимое документа')
  if (Buffer.byteLength(content, 'utf8') > MAX_IPC_CONTENT_LENGTH) {
    throw new Error('Документ слишком большой')
  }
}

export function registerIpcHandlers(window: BrowserWindow): () => void {
  const recentFiles = new RecentFiles(join(app.getPath('userData'), 'recent-files.yaml'))
  const grantedPaths = new Set<string>()

  const register = <Args extends unknown[], Result>(
    channel: string,
    handler: (event: IpcMainInvokeEvent, ...args: Args) => Promise<Result>
  ): void => {
    ipcMain.handle(channel, handler)
  }

  register(IPC_CHANNELS.openDocument, async (event): Promise<OpenedDocument | null> => {
    assertSender(event, window)
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
      assertSender(event, window)
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
    assertSender(event, window)
    const recent = await recentFiles.list()
    recent.forEach((entry) => grantedPaths.add(entry.filePath))
    return recent
  })

  register(
    IPC_CHANNELS.chooseSavePath,
    async (event, request: ChooseSavePathRequest): Promise<string | null> => {
      assertSender(event, window)
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
      assertSender(event, window)
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
      assertSender(event, window)
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
      assertSender(event, window)
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

  return () => {
    Object.values(IPC_CHANNELS)
      .filter((channel) => channel !== IPC_CHANNELS.setDirty)
      .forEach((channel) => ipcMain.removeHandler(channel))
  }
}
