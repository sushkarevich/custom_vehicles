import { join } from 'node:path'
import { app, BrowserWindow, dialog, ipcMain, session, shell } from 'electron'
import { IPC_CHANNELS } from '../shared/ipc'
import { registerIpcHandlers } from './ipc'

let rendererDirty = false
let closeConfirmed = false
let closeDialogOpen = false
let unregisterIpc: (() => void) | null = null

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

  unregisterIpc = registerIpcHandlers(window)

  ipcMain.on(IPC_CHANNELS.setDirty, (event, value: unknown) => {
    if (event.sender === window.webContents && typeof value === 'boolean') {
      rendererDirty = value
      window.setDocumentEdited(value)
    }
  })

  window.on('ready-to-show', () => window.show())
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
        if (result.response === 1) {
          closeConfirmed = true
          window.close()
        }
      })
      .finally(() => {
        closeDialogOpen = false
      })
  })
  window.on('closed', () => {
    unregisterIpc?.()
    unregisterIpc = null
    ipcMain.removeAllListeners(IPC_CHANNELS.setDirty)
  })

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })
  window.webContents.on('will-navigate', (event, url) => {
    const currentUrl = window.webContents.getURL()
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
