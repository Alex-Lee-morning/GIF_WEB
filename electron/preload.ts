import { contextBridge, ipcRenderer } from 'electron'
import type { AppConfig, ChatStreamChunk, PixelPetApi, UpdateStatus } from '../shared/types.js'

const api: PixelPetApi = {
  getConfig: () => ipcRenderer.invoke('config:get'),
  setConfig: (partial) => ipcRenderer.invoke('config:set', partial),
  getProviders: () => ipcRenderer.invoke('ai:providers'),
  setPetVisible: (visible) => ipcRenderer.invoke('pet:set-visible', visible),
  openSettings: () => ipcRenderer.invoke('settings:open'),
  hidePet: () => ipcRenderer.invoke('pet:hide'),
  movePetWindow: (x, y) => ipcRenderer.invoke('pet:move', x, y),
  resizePetWindow: (size) => ipcRenderer.invoke('pet:resize', size),
  onConfigUpdated: (cb) => {
    const listener = (_event: Electron.IpcRendererEvent, config: AppConfig) => cb(config)
    ipcRenderer.on('config:updated', listener)
    return () => ipcRenderer.removeListener('config:updated', listener)
  },
  chatStream: async (messages, onChunk) => {
    const channel = `chat:chunk:${Date.now()}:${Math.random().toString(36).slice(2)}`
    const listener = (_event: Electron.IpcRendererEvent, chunk: ChatStreamChunk) => {
      onChunk(chunk)
    }
    ipcRenderer.on(channel, listener)
    try {
      await ipcRenderer.invoke('chat:stream', messages, channel)
    } finally {
      ipcRenderer.removeListener(channel, listener)
    }
  },
  getAppVersion: () => ipcRenderer.invoke('update:get-version'),
  getUpdateStatus: () => ipcRenderer.invoke('update:get-status'),
  checkForUpdates: () => ipcRenderer.invoke('update:check'),
  installUpdateNow: () => ipcRenderer.invoke('update:install'),
  onUpdateStatus: (cb) => {
    const listener = (_event: Electron.IpcRendererEvent, status: UpdateStatus) => cb(status)
    ipcRenderer.on('update:status', listener)
    return () => ipcRenderer.removeListener('update:status', listener)
  },
}

contextBridge.exposeInMainWorld('pixelPet', api)
