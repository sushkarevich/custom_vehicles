import { join } from 'node:path'
import { app, BrowserWindow, dialog, ipcMain, session, shell } from 'electron'
import { isEditorHistoryState } from '../shared/history-commands'
import { IPC_CHANNELS } from '../shared/ipc'
import { installApplicationMenu } from './application-menu'
import { registerIpcHandlers } from './ipc'
import { resolveLiveEditorWindow } from './editor-window'

let editorWindow: BrowserWindow | null = null

app.enableSandbox()

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1500,
    height: 920,
    minWidth: 1080,
    minHeight: 680,
    backgroundColor: '#101318',
    show: false,
    title: 'Редактор CustomVehicles',
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false
    }
  })
  const contents = window.webContents
  editorWindow = window
  let rendererDirty = false
  let closeConfirmed = false
  let closeDialogOpen = false
  const resolveWindow = (): BrowserWindow | null =>
    resolveLiveEditorWindow(() => editorWindow)

  const unregisterIpc = registerIpcHandlers(resolveWindow)
  const applicationMenu = installApplicationMenu(resolveWindow)

  const handleDirty = (event: Electron.IpcMainEvent, value: unknown): void => {
    const liveWindow = resolveWindow()
    if (
      liveWindow === window &&
      event.sender === contents &&
      typeof value === 'boolean'
    ) {
      rendererDirty = value
      liveWindow.setDocumentEdited(value)
    }
  }
  const handleHistoryState = (event: Electron.IpcMainEvent, value: unknown): void => {
    const liveWindow = resolveWindow()
    if (
      liveWindow === window &&
      event.sender === contents &&
      isEditorHistoryState(value)
    ) {
      applicationMenu.updateHistoryState(value)
    }
  }
  ipcMain.on(IPC_CHANNELS.setDirty, handleDirty)
  ipcMain.on(IPC_CHANNELS.historyState, handleHistoryState)

  window.on('ready-to-show', () => {
    const liveWindow = resolveWindow()
    if (liveWindow === window) liveWindow.show()
  })
  window.on('close', (event) => {
    if (!rendererDirty || closeConfirmed) return
    event.preventDefault()
    if (closeDialogOpen) return
    closeDialogOpen = true
    void dialog
      .showMessageBox(window, {
        type: 'warning',
        title: 'Несохранённые изменения',
        message: 'Закрыть редактор без сохранения?',
        detail: 'Несохранённые изменения будут потеряны.',
        buttons: ['Отмена', 'Закрыть без сохранения'],
        defaultId: 0,
        cancelId: 0,
        noLink: true
      })
      .then((result) => {
        const liveWindow = resolveWindow()
        if (result.response === 1 && liveWindow === window) {
          closeConfirmed = true
          liveWindow.close()
        }
      })
      .finally(() => {
        closeDialogOpen = false
      })
  })
  window.on('closed', () => {
    if (editorWindow === window) editorWindow = null
    unregisterIpc()
    applicationMenu.dispose()
    ipcMain.removeListener(IPC_CHANNELS.setDirty, handleDirty)
    ipcMain.removeListener(IPC_CHANNELS.historyState, handleHistoryState)
  })

  contents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })
  contents.on('will-navigate', (event, url) => {
    if (contents.isDestroyed()) return
    const currentUrl = contents.getURL()
    if (currentUrl !== '' && url !== currentUrl) event.preventDefault()
  })

  const developmentUrl = process.env.ELECTRON_RENDERER_URL
  if (developmentUrl !== undefined) {
    void window.loadURL(developmentUrl)
  } else {
    void window.loadFile(join(import.meta.dirname, '../renderer/index.html'))
  }
}

void app.whenReady().then(() => {
  app.setAppUserModelId('ru.customvehicles.editor')
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false)
  })
  session.defaultSession.setPermissionCheckHandler(() => false)
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('web-contents-created', (_event, contents) => {
  contents.on('will-attach-webview', (event) => event.preventDefault())
})
