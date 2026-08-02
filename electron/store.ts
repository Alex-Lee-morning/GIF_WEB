import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { AI_PROVIDERS, DEFAULT_CONFIG, type AppConfig, type AiProviderId } from '../shared/types.js'

function configPath(): string {
  return path.join(app.getPath('userData'), 'pixel-pet-config.json')
}

export function getConfig(): AppConfig {
  try {
    const raw = fs.readFileSync(configPath(), 'utf8')
    const data = JSON.parse(raw) as Partial<AppConfig>
    return normalize({ ...DEFAULT_CONFIG, ...data })
  } catch {
    return { ...DEFAULT_CONFIG }
  }
}

export function setConfig(partial: Partial<AppConfig>): AppConfig {
  const next = normalize({ ...getConfig(), ...partial })
  fs.mkdirSync(path.dirname(configPath()), { recursive: true })
  fs.writeFileSync(configPath(), JSON.stringify(next, null, 2), 'utf8')
  return next
}

export function applyProviderDefaults(provider: AiProviderId): Partial<AppConfig> {
  const preset = AI_PROVIDERS.find((p) => p.id === provider)
  if (!preset || provider === 'custom') {
    return { aiProvider: provider }
  }
  return {
    aiProvider: provider,
    aiBaseUrl: preset.baseUrl,
    aiModel: preset.defaultModel,
  }
}

function normalize(data: AppConfig): AppConfig {
  return {
    ...DEFAULT_CONFIG,
    ...data,
    petSize: clamp(Number(data.petSize ?? DEFAULT_CONFIG.petSize), 64, 256),
    pixelSize: clamp(Number(data.pixelSize ?? DEFAULT_CONFIG.pixelSize), 16, 96),
    colorCount: clamp(Number(data.colorCount ?? DEFAULT_CONFIG.colorCount), 8, 64),
    petVisible: Boolean(data.petVisible),
    photoDataUrl: data.photoDataUrl ?? null,
    originalPhotoDataUrl: data.originalPhotoDataUrl ?? null,
    cutoutDataUrl: data.cutoutDataUrl ?? null,
    petSprites: data.petSprites ?? null,
    swapWalkDirection: Boolean(data.swapWalkDirection),
    aiProvider: data.aiProvider ?? DEFAULT_CONFIG.aiProvider,
    aiBaseUrl: data.aiBaseUrl ?? DEFAULT_CONFIG.aiBaseUrl,
    aiModel: data.aiModel ?? DEFAULT_CONFIG.aiModel,
    aiApiKey: data.aiApiKey ?? '',
    systemPrompt: data.systemPrompt ?? DEFAULT_CONFIG.systemPrompt,
  }
}

function clamp(n: number, min: number, max: number): number {
  if (Number.isNaN(n)) return min
  return Math.min(max, Math.max(min, n))
}
