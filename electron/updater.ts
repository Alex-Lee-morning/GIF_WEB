import { app, BrowserWindow, ipcMain } from 'electron'
import { autoUpdater } from 'electron-updater'
import type { UpdateStatus } from '../shared/types.js'

type BroadcastFn = (status: UpdateStatus) => void

let lastStatus: UpdateStatus = { type: 'idle' }
let started = false

function broadcast(status: UpdateStatus, onStatus?: BroadcastFn): void {
  lastStatus = status
  onStatus?.(status)
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send('update:status', status)
    }
  }
}

/**
 * Wire auto-update against GitHub Releases (see update/update-config.json).
 * No-op in development; failures are silent so they never block the app.
 */
export function setupAutoUpdater(isDev: boolean): void {
  if (started) return
  started = true

  ipcMain.handle('update:get-status', () => lastStatus)
  ipcMain.handle('update:get-version', () => app.getVersion())
  ipcMain.handle('update:install', () => {
    if (lastStatus.type !== 'ready') return false
    setImmediate(() => {
      autoUpdater.quitAndInstall(false, true)
    })
    return true
  })
  ipcMain.handle('update:check', async () => {
    if (isDev) {
      broadcast({ type: 'idle', message: '开发模式不检查更新' })
      return lastStatus
    }
    try {
      await autoUpdater.checkForUpdates()
    } catch (err) {
      broadcast({
        type: 'error',
        message: err instanceof Error ? err.message : String(err),
      })
    }
    return lastStatus
  })

  if (isDev) {
    broadcast({ type: 'idle', message: '开发模式已跳过自动更新' })
    return
  }

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  // Unsigned mac builds often fail signature verification; still allow updates.
  autoUpdater.allowDowngrade = false

  autoUpdater.on('checking-for-update', () => {
    broadcast({ type: 'checking', message: '正在检查更新…' })
  })

  autoUpdater.on('update-available', (info) => {
    broadcast({
      type: 'available',
      version: info.version,
      message: `发现新版本 v${info.version}，开始下载…`,
    })
  })

  autoUpdater.on('update-not-available', () => {
    broadcast({
      type: 'idle',
      version: app.getVersion(),
      message: `已是最新版 v${app.getVersion()}`,
    })
  })

  autoUpdater.on('download-progress', (progress) => {
    const percent = Math.max(0, Math.min(100, Math.round(progress.percent)))
    broadcast({
      type: 'downloading',
      percent,
      message: `正在下载更新… ${percent}%`,
    })
  })

  autoUpdater.on('update-downloaded', (info) => {
    broadcast({
      type: 'ready',
      version: info.version,
      message: `更新 v${info.version} 已就绪，点击重启安装`,
    })
  })

  autoUpdater.on('error', (err) => {
    broadcast({
      type: 'error',
      message: err instanceof Error ? err.message : String(err),
    })
  })

  // Check on every launch; ignore network/GitHub failures.
  void autoUpdater.checkForUpdates().catch((err) => {
    broadcast({
      type: 'error',
      message: err instanceof Error ? err.message : String(err),
    })
  })
}
