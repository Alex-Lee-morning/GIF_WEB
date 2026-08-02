import {
  app,
  BrowserWindow,
  Tray,
  Menu,
  nativeImage,
  ipcMain,
  screen,
  session,
  type NativeImage,
} from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { AI_PROVIDERS, PET_SIZE_MAX, PET_SIZE_MIN, type AppConfig, type ChatMessage } from '../shared/types.js'
import { applyProviderDefaults, getConfig, setConfig } from './store.js'
import { streamChat } from './ai.js'
import { setupAutoUpdater } from './updater.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const isDev = Boolean(process.env.VITE_DEV_SERVER_URL)
const DEV_URL = process.env.VITE_DEV_SERVER_URL ?? 'http://127.0.0.1:5173'

let settingsWindow: BrowserWindow | null = null
let petWindow: BrowserWindow | null = null
let tray: Tray | null = null
let petVisible = true

function preloadPath(): string {
  return path.join(__dirname, 'preload.cjs')
}

function createTrayIcon(): NativeImage {
  const unpacked = path.join(process.resourcesPath, 'app.asar.unpacked', 'resources', 'trayTemplate.png')
  const bundled = path.join(__dirname, '../resources/trayTemplate.png')
  const devPath = path.join(process.cwd(), 'resources/trayTemplate.png')
  const candidates = isDev ? [devPath, bundled] : [unpacked, bundled]
  for (const iconPath of candidates) {
    const img = nativeImage.createFromPath(iconPath)
    if (!img.isEmpty()) {
      img.setTemplateImage(true)
      return img
    }
  }
  return nativeImage.createEmpty()
}

function broadcastConfig(config: AppConfig): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('config:updated', config)
  }
}

function petWindowSize(petSize: number): { width: number; height: number } {
  // Extra space for chat bubble and think dots
  const width = Math.max(280, petSize + 180)
  const height = Math.max(220, petSize + 160)
  return { width, height }
}

function createSettingsWindow(): void {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.show()
    settingsWindow.focus()
    return
  }

  settingsWindow = new BrowserWindow({
    width: 880,
    height: 720,
    minWidth: 720,
    minHeight: 560,
    title: '像素桌宠 · 设置',
    backgroundColor: '#f3efe6',
    webPreferences: {
      preload: preloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  if (isDev) {
    void settingsWindow.loadURL(DEV_URL)
  } else {
    void settingsWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }

  settingsWindow.on('closed', () => {
    settingsWindow = null
  })
}

function createPetWindow(): void {
  if (petWindow && !petWindow.isDestroyed()) {
    petWindow.show()
    return
  }

  const config = getConfig()
  const { width, height } = petWindowSize(config.petSize)
  const display = screen.getPrimaryDisplay().workArea
  const x = Math.round(display.x + display.width - width - 40)
  const y = Math.round(display.y + display.height - height - 40)

  petWindow = new BrowserWindow({
    width,
    height,
    x,
    y,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    focusable: true,
    show: false,
    webPreferences: {
      preload: preloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  petWindow.setAlwaysOnTop(true, 'screen-saver')
  petWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })

  if (isDev) {
    void petWindow.loadURL(`${DEV_URL}/pet.html`)
  } else {
    void petWindow.loadFile(path.join(__dirname, '../dist/pet.html'))
  }

  petWindow.once('ready-to-show', () => {
    if (petVisible) petWindow?.showInactive()
  })

  petWindow.on('closed', () => {
    petWindow = null
  })
}

function setPetVisible(visible: boolean): void {
  petVisible = visible
  setConfig({ petVisible: visible })
  if (visible) {
    if (!petWindow || petWindow.isDestroyed()) {
      createPetWindow()
    } else {
      petWindow.showInactive()
    }
  } else if (petWindow && !petWindow.isDestroyed()) {
    petWindow.hide()
  }
  rebuildTrayMenu()
  broadcastConfig(getConfig())
}

function rebuildTrayMenu(): void {
  if (!tray) return
  const menu = Menu.buildFromTemplate([
    {
      label: petVisible ? '隐藏桌宠' : '显示桌宠',
      click: () => setPetVisible(!petVisible),
    },
    {
      label: '打开设置',
      click: () => createSettingsWindow(),
    },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        app.quit()
      },
    },
  ])
  tray.setContextMenu(menu)
  tray.setToolTip('像素桌宠')
}

function createTray(): void {
  tray = new Tray(createTrayIcon())
  tray.on('click', () => {
    createSettingsWindow()
  })
  rebuildTrayMenu()
}

function clampPetBounds(x: number, y: number, width: number, height: number) {
  const point = { x: Math.round(x + width / 2), y: Math.round(y + height / 2) }
  const area = screen.getDisplayNearestPoint(point).workArea
  const minX = area.x
  const minY = area.y
  const maxX = area.x + area.width - width
  const maxY = area.y + area.height - height
  const cx = Math.min(Math.max(minX, Math.round(x)), Math.max(minX, maxX))
  const cy = Math.min(Math.max(minY, Math.round(y)), Math.max(minY, maxY))
  return {
    x: cx,
    y: cy,
    hitLeft: Math.round(x) < cx,
    hitRight: Math.round(x) > cx,
    hitTop: Math.round(y) < cy,
    hitBottom: Math.round(y) > cy,
  }
}

function registerIpc(): void {
  ipcMain.handle('config:get', () => getConfig())

  ipcMain.handle('config:set', (_event, partial: Partial<AppConfig>) => {
    let nextPartial = { ...partial }
    if (partial.aiProvider) {
      nextPartial = { ...applyProviderDefaults(partial.aiProvider), ...partial }
    }
    if (typeof partial.petSize === 'number') {
      nextPartial.petSize = Math.min(PET_SIZE_MAX, Math.max(PET_SIZE_MIN, partial.petSize))
    }
    const config = setConfig(nextPartial)
    if (typeof partial.petSize === 'number' && petWindow && !petWindow.isDestroyed()) {
      const { width, height } = petWindowSize(config.petSize)
      const bounds = petWindow.getBounds()
      petWindow.setBounds({ ...bounds, width, height })
    }
    if (typeof partial.petVisible === 'boolean') {
      setPetVisible(partial.petVisible)
      return getConfig()
    }
    broadcastConfig(config)
    return config
  })

  ipcMain.handle('ai:providers', () => AI_PROVIDERS)

  ipcMain.handle('pet:set-visible', (_event, visible: boolean) => {
    setPetVisible(Boolean(visible))
  })

  ipcMain.handle('settings:open', () => {
    createSettingsWindow()
  })

  ipcMain.handle('pet:hide', () => {
    setPetVisible(false)
  })

  ipcMain.handle('pet:move', (_event, x: number, y: number) => {
    if (!petWindow || petWindow.isDestroyed()) return null
    const { width, height } = petWindow.getBounds()
    const clamped = clampPetBounds(x, y, width, height)
    petWindow.setPosition(clamped.x, clamped.y)
    return clamped
  })

  ipcMain.handle('pet:resize', (_event, size: number) => {
    const petSize = Math.min(PET_SIZE_MAX, Math.max(PET_SIZE_MIN, size))
    const config = setConfig({ petSize })
    if (petWindow && !petWindow.isDestroyed()) {
      const { width, height } = petWindowSize(petSize)
      const bounds = petWindow.getBounds()
      const clamped = clampPetBounds(bounds.x, bounds.y, width, height)
      petWindow.setBounds({ x: clamped.x, y: clamped.y, width, height })
    }
    broadcastConfig(config)
  })

  ipcMain.handle(
    'chat:stream',
    async (event, messages: ChatMessage[], channel: string) => {
      const config = getConfig()
      try {
        for await (const chunk of streamChat(config, messages)) {
          if (event.sender.isDestroyed()) break
          event.sender.send(channel, chunk)
        }
      } catch (err) {
        if (!event.sender.isDestroyed()) {
          event.sender.send(channel, {
            type: 'error',
            text: err instanceof Error ? err.message : String(err),
          })
        }
      }
    },
  )
}

app.whenReady().then(() => {
  if (process.platform === 'darwin') {
    app.dock?.hide()
  }

  const gotLock = app.requestSingleInstanceLock()
  if (!gotLock) {
    app.quit()
    return
  }

  // Enable SharedArrayBuffer for @imgly/background-removal ONNX WASM
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const headers = { ...details.responseHeaders }
    headers['Cross-Origin-Opener-Policy'] = ['same-origin']
    headers['Cross-Origin-Embedder-Policy'] = ['require-corp']
    callback({ responseHeaders: headers })
  })

  app.on('second-instance', () => {
    createSettingsWindow()
  })

  registerIpc()
  createTray()
  setupAutoUpdater(isDev)

  const config = getConfig()
  petVisible = config.petVisible
  createSettingsWindow()
  if (petVisible) {
    createPetWindow()
  }

  app.on('activate', () => {
    createSettingsWindow()
  })
})

app.on('window-all-closed', () => {
  // Keep running in tray on macOS
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  if (tray) {
    tray.destroy()
    tray = null
  }
})
