export type AiProviderId =
  | 'deepseek'
  | 'qwen'
  | 'zhipu'
  | 'kimi'
  | 'custom'

export interface AiProviderPreset {
  id: AiProviderId
  name: string
  baseUrl: string
  models: string[]
  defaultModel: string
}

export interface AppConfig {
  petVisible: boolean
  petSize: number
  pixelSize: number
  colorCount: number
  photoDataUrl: string | null
  originalPhotoDataUrl: string | null
  /** Confirmed cutout (transparent PNG) used to regenerate sprites */
  cutoutDataUrl: string | null
  petSprites: PetSpriteSet | null
  /** When true, left/right movement uses the opposite walk animation */
  swapWalkDirection: boolean
  aiProvider: AiProviderId
  aiBaseUrl: string
  aiModel: string
  aiApiKey: string
  systemPrompt: string
}

export type PetSpriteState =
  | 'idle'
  | 'react'
  | 'talk'
  | 'think'
  | 'dragUp'
  | 'dragDown'
  | 'dragLeft'
  | 'dragRight'

export interface PetSpriteSet {
  width: number
  height: number
  frames: Record<PetSpriteState, string[]>
  previewGifDataUrl: string
  /** body = walk pet; face = hand-pull + ball-bonk idle */
  animStyle?: 'body' | 'face'
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface ChatRequest {
  messages: ChatMessage[]
}

export interface ChatStreamChunk {
  type: 'reasoning' | 'content' | 'done' | 'error'
  text?: string
}

export const AI_PROVIDERS: AiProviderPreset[] = [
  {
    id: 'deepseek',
    name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com',
    models: ['deepseek-chat', 'deepseek-reasoner'],
    defaultModel: 'deepseek-chat',
  },
  {
    id: 'qwen',
    name: '通义千问',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    models: ['qwen-plus', 'qwen-turbo', 'qwen-max'],
    defaultModel: 'qwen-plus',
  },
  {
    id: 'zhipu',
    name: '智谱 GLM',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    models: ['glm-4-flash', 'glm-4-air', 'glm-4'],
    defaultModel: 'glm-4-flash',
  },
  {
    id: 'kimi',
    name: '月之暗面 Kimi',
    baseUrl: 'https://api.moonshot.cn/v1',
    models: ['moonshot-v1-8k', 'moonshot-v1-32k', 'moonshot-v1-128k'],
    defaultModel: 'moonshot-v1-8k',
  },
  {
    id: 'custom',
    name: '自定义（OpenAI 兼容）',
    baseUrl: '',
    models: [],
    defaultModel: '',
  },
]

export const DEFAULT_CONFIG: AppConfig = {
  petVisible: true,
  petSize: 128,
  pixelSize: 48,
  colorCount: 24,
  photoDataUrl: null,
  originalPhotoDataUrl: null,
  cutoutDataUrl: null,
  petSprites: null,
  swapWalkDirection: false,
  aiProvider: 'deepseek',
  aiBaseUrl: AI_PROVIDERS[0].baseUrl,
  aiModel: AI_PROVIDERS[0].defaultModel,
  aiApiKey: '',
  systemPrompt:
    '你是一个可爱的像素桌宠。回答要简短、亲切、口语化，偶尔带一点俏皮。',
}

export const PET_SIZE_MIN = 64
export const PET_SIZE_MAX = 256

export interface PetMoveResult {
  x: number
  y: number
  hitLeft: boolean
  hitRight: boolean
  hitTop: boolean
  hitBottom: boolean
}

export type UpdateStatusType =
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'ready'
  | 'error'

export interface UpdateStatus {
  type: UpdateStatusType
  version?: string
  percent?: number
  message?: string
}

export interface PixelPetApi {
  getConfig: () => Promise<AppConfig>
  setConfig: (partial: Partial<AppConfig>) => Promise<AppConfig>
  getProviders: () => Promise<AiProviderPreset[]>
  setPetVisible: (visible: boolean) => Promise<void>
  openSettings: () => Promise<void>
  hidePet: () => Promise<void>
  movePetWindow: (x: number, y: number) => Promise<PetMoveResult | null>
  resizePetWindow: (size: number) => Promise<void>
  onConfigUpdated: (cb: (config: AppConfig) => void) => () => void
  chatStream: (
    messages: ChatMessage[],
    onChunk: (chunk: ChatStreamChunk) => void,
  ) => Promise<void>
  getAppVersion: () => Promise<string>
  getUpdateStatus: () => Promise<UpdateStatus>
  checkForUpdates: () => Promise<UpdateStatus>
  installUpdateNow: () => Promise<boolean>
  onUpdateStatus: (cb: (status: UpdateStatus) => void) => () => void
}
