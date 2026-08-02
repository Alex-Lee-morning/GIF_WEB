import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AppConfig, AiProviderPreset, PetSpriteSet, UpdateStatus } from '../shared/types'
import { AI_PROVIDERS, DEFAULT_CONFIG, PET_SIZE_MAX, PET_SIZE_MIN } from '../shared/types'
import { type SubjectCropMode } from './lib/extractSubject'
import { buildPetFromUpload } from './lib/petPipeline'
import { getDefaultPetSprites, getDefaultPetStill } from './lib/defaultPet'
import { SpritePreview } from './components/SpritePreview'
import './App.css'

interface DraftPreview {
  originalDataUrl: string
  cutoutDataUrl: string
  cartoonDataUrl: string
  usedFaceCrop: boolean
  sprites: PetSpriteSet
}

function usePixelPet() {
  return typeof window !== 'undefined' ? window.pixelPet : null
}

export default function App() {
  const api = usePixelPet()
  const [config, setLocalConfig] = useState<AppConfig>(DEFAULT_CONFIG)
  const [providers, setProviders] = useState<AiProviderPreset[]>(AI_PROVIDERS)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('准备就绪')
  const [activePreview, setActivePreview] = useState<string | null>(getDefaultPetStill())
  const [draft, setDraft] = useState<DraftPreview | null>(null)
  const [cropMode, setCropMode] = useState<SubjectCropMode>('full')
  const [preservePose, setPreservePose] = useState(true)
  const [appVersion, setAppVersion] = useState('')
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>({ type: 'idle' })
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!api) {
      setStatus('请在 Electron 中运行本应用')
      setActivePreview(getDefaultPetStill())
      return
    }
    let unsubConfig = () => {}
    let unsubUpdate = () => {}
    ;(async () => {
      const [cfg, list, version, upd] = await Promise.all([
        api.getConfig(),
        api.getProviders(),
        api.getAppVersion(),
        api.getUpdateStatus(),
      ])
      let next = cfg
      if (!cfg.petSprites) {
        const defaults = getDefaultPetSprites()
        next = await api.setConfig({
          petSprites: defaults,
          photoDataUrl: cfg.photoDataUrl ?? getDefaultPetStill(),
        })
      }
      setLocalConfig(next)
      setProviders(list)
      setAppVersion(version)
      setUpdateStatus(upd)
      setActivePreview(next.photoDataUrl ?? getDefaultPetStill())
      unsubConfig = api.onConfigUpdated((updated) => {
        setLocalConfig(updated)
        setActivePreview(updated.photoDataUrl ?? getDefaultPetStill())
      })
      unsubUpdate = api.onUpdateStatus(setUpdateStatus)
    })().catch((err) => setStatus(String(err)))
    return () => {
      unsubConfig()
      unsubUpdate()
    }
  }, [api])

  const currentProvider = useMemo(
    () => providers.find((p) => p.id === config.aiProvider) ?? providers[0],
    [providers, config.aiProvider],
  )

  const update = useCallback(
    async (partial: Partial<AppConfig>) => {
      if (!api) {
        setLocalConfig((c) => ({ ...c, ...partial }))
        return
      }
      const next = await api.setConfig(partial)
      setLocalConfig(next)
    },
    [api],
  )

  const onUpload = async (file: File | null) => {
    if (!file) return
    setBusy(true)
    setDraft(null)
    try {
      const dataUrl = await readFileAsDataUrl(file)
      const built = await buildPetFromUpload(dataUrl, {
        cropMode,
        preservePose: cropMode === 'full' ? preservePose : true,
        pixelSize: config.pixelSize,
        colorCount: config.colorCount,
        onProgress: setStatus,
      })
      setDraft({
        originalDataUrl: built.originalDataUrl,
        cutoutDataUrl: built.cutoutDataUrl,
        cartoonDataUrl: built.cartoonDataUrl,
        usedFaceCrop: built.usedFaceCrop,
        sprites: built.sprites,
      })
      setActivePreview(built.sprites.frames.idle[0] ?? built.cartoonDataUrl)
      setStatus(
        built.usedFaceCrop
          ? '仅脸部动画预览已生成，请确认'
          : built.preservePose
            ? '卡通动画预览已生成（保留原图姿势），请确认'
            : '卡通动画预览已生成（AI 部位建模侧面形象 + 左右走），请确认',
      )
    } catch (err) {
      setStatus(err instanceof Error ? err.message : '处理失败')
      setDraft(null)
    } finally {
      setBusy(false)
      // Allow selecting the same file again (Windows/Electron otherwise skips onChange)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const openFilePicker = () => {
    const input = fileInputRef.current
    if (!input || busy) return
    input.value = ''
    input.click()
  }

  const regeneratePreview = async () => {
    const original =
      draft?.originalDataUrl ?? config.originalPhotoDataUrl ?? config.cutoutDataUrl
    if (!original) {
      setStatus('请先上传照片')
      return
    }
    setBusy(true)
    try {
      const built = await buildPetFromUpload(original, {
        cropMode,
        preservePose: cropMode === 'full' ? preservePose : true,
        pixelSize: config.pixelSize,
        colorCount: config.colorCount,
        onProgress: setStatus,
      })
      setDraft({
        originalDataUrl: built.originalDataUrl,
        cutoutDataUrl: built.cutoutDataUrl,
        cartoonDataUrl: built.cartoonDataUrl,
        usedFaceCrop: built.usedFaceCrop,
        sprites: built.sprites,
      })
      setActivePreview(built.sprites.frames.idle[0] ?? built.cartoonDataUrl)
      setStatus('卡通动画预览已重新生成，请确认')
    } catch (err) {
      setStatus(err instanceof Error ? err.message : '重新生成失败')
    } finally {
      setBusy(false)
    }
  }

  const confirmDraft = async () => {
    if (!draft) return
    setBusy(true)
    try {
      const still = draft.sprites.frames.idle[0] ?? draft.cartoonDataUrl
      await update({
        photoDataUrl: still,
        originalPhotoDataUrl: draft.originalDataUrl,
        cutoutDataUrl: draft.cartoonDataUrl,
        petSprites: draft.sprites,
      })
      setActivePreview(still)
      setDraft(null)
      setStatus('桌宠已更新')
    } catch (err) {
      setStatus(err instanceof Error ? err.message : '应用失败')
    } finally {
      setBusy(false)
    }
  }

  const cancelDraft = () => {
    setDraft(null)
    setActivePreview(config.photoDataUrl ?? getDefaultPetStill())
    setStatus('已取消预览')
  }

  const restoreDefaultPet = async () => {
    setBusy(true)
    try {
      const sprites = getDefaultPetSprites()
      const still = getDefaultPetStill()
      await update({
        photoDataUrl: still,
        originalPhotoDataUrl: null,
        cutoutDataUrl: null,
        petSprites: sprites,
      })
      setDraft(null)
      setActivePreview(still)
      setStatus('已恢复默认卡通小狗桌宠')
    } catch (err) {
      setStatus(err instanceof Error ? err.message : '恢复失败')
    } finally {
      setBusy(false)
    }
  }

  const toggleWalkDirection = async () => {
    const next = !config.swapWalkDirection
    await update({ swapWalkDirection: next })
    setStatus(next ? '已对调左右走动画（向左移动播向右走帧）' : '已还原左右走动画对应')
  }

  const downloadGif = () => {
    if (!draft) return
    const a = document.createElement('a')
    a.href = draft.sprites.previewGifDataUrl
    a.download = 'pixel-pet-preview.gif'
    a.click()
  }

  const heroSrc = draft?.sprites.previewGifDataUrl ?? activePreview

  return (
    <div className="settings-page">
      <header className="hero">
        <div className="hero-copy">
          <p className="brand">像素桌宠</p>
          <h1>把照片变成会动的卡通桌宠</h1>
          <p className="lead">
            上传后先卡通化，再生成全新动画帧。默认桌宠是卡通像素小狗，可随时恢复。
          </p>
        </div>
        <div className="hero-preview">
          {heroSrc ? <img src={heroSrc} alt="桌宠预览" className="preview-img" /> : null}
        </div>
      </header>

      <main className="panels">
        <section className="panel">
          <h2>形象</h2>
          <div className="upload-row">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/*"
              disabled={busy}
              className="file-input-hidden"
              onChange={(e) => void onUpload(e.target.files?.[0] ?? null)}
            />
            <button
              type="button"
              className="upload"
              disabled={busy}
              onClick={openFilePicker}
            >
              {busy ? '处理中…' : '上传照片'}
            </button>
          </div>

          <label className="field">
            <span>抠图范围</span>
            <select
              value={cropMode}
              disabled={busy}
              onChange={(e) => setCropMode(e.target.value as SubjectCropMode)}
            >
              <option value="full">完整主体（头+身体）· 走路动画</option>
              <option value="face">仅脸部 · 手拉脸 / 小球砸头</option>
            </select>
          </label>

          {cropMode === 'full' ? (
            <label className="field">
              <span>保留原图姿势</span>
              <select
                value={preservePose ? 'yes' : 'no'}
                disabled={busy}
                onChange={(e) => setPreservePose(e.target.value === 'yes')}
              >
                <option value="yes">是 · 按照片姿势生成动画</option>
                <option value="no">否 · AI 识别部位，生成相似动漫像素侧面并左右走</option>
              </select>
            </label>
          ) : null}

          {draft ? (
            <SpritePreview
              sprites={draft.sprites}
              cutoutDataUrl={draft.cutoutDataUrl}
              cartoonDataUrl={draft.cartoonDataUrl}
              usedFaceCrop={draft.usedFaceCrop}
              swapWalkDirection={config.swapWalkDirection}
              onConfirm={() => void confirmDraft()}
              onCancel={cancelDraft}
              onSwapWalkDirection={() => void toggleWalkDirection()}
              onDownloadGif={downloadGif}
            />
          ) : null}

          <label className="field">
            <span>像素精度 {config.pixelSize}</span>
            <input
              type="range"
              min={16}
              max={96}
              value={config.pixelSize}
              disabled={busy}
              onChange={(e) => void update({ pixelSize: Number(e.target.value) })}
            />
          </label>

          <label className="field">
            <span>色彩数量 {config.colorCount}</span>
            <input
              type="range"
              min={8}
              max={64}
              value={config.colorCount}
              disabled={busy}
              onChange={(e) => void update({ colorCount: Number(e.target.value) })}
            />
          </label>

          <button
            type="button"
            className="btn secondary"
            disabled={busy || !(draft?.originalDataUrl || config.originalPhotoDataUrl)}
            onClick={() => void regeneratePreview()}
          >
            按当前参数重新生成预览
          </button>

          <button
            type="button"
            className="btn secondary"
            disabled={busy}
            onClick={() => void toggleWalkDirection()}
          >
            {config.swapWalkDirection ? '还原左右走动画' : '对调左右走动画'}
          </button>

          <button
            type="button"
            className="btn secondary"
            disabled={busy}
            onClick={() => void restoreDefaultPet()}
          >
            恢复默认卡通小狗
          </button>

          <label className="field">
            <span>桌宠大小 {config.petSize}px</span>
            <input
              type="range"
              min={PET_SIZE_MIN}
              max={PET_SIZE_MAX}
              value={config.petSize}
              onChange={(e) => void update({ petSize: Number(e.target.value) })}
            />
          </label>

          <label className="toggle">
            <input
              type="checkbox"
              checked={config.petVisible}
              onChange={(e) => void update({ petVisible: e.target.checked })}
            />
            <span>显示桌宠</span>
          </label>
        </section>

        <section className="panel">
          <h2>AI 对话</h2>
          <label className="field">
            <span>厂商</span>
            <select
              value={config.aiProvider}
              onChange={(e) => void update({ aiProvider: e.target.value as AppConfig['aiProvider'] })}
            >
              {providers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>Base URL</span>
            <input
              type="text"
              value={config.aiBaseUrl}
              placeholder="https://api.example.com/v1"
              onChange={(e) => void update({ aiBaseUrl: e.target.value })}
            />
          </label>

          <label className="field">
            <span>模型</span>
            {currentProvider?.models?.length ? (
              <select value={config.aiModel} onChange={(e) => void update({ aiModel: e.target.value })}>
                {currentProvider.models.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            ) : (
              <input
                type="text"
                value={config.aiModel}
                placeholder="model-name"
                onChange={(e) => void update({ aiModel: e.target.value })}
              />
            )}
          </label>

          <label className="field">
            <span>API Key</span>
            <input
              type="password"
              value={config.aiApiKey}
              placeholder="仅保存在本机"
              autoComplete="off"
              onChange={(e) => void update({ aiApiKey: e.target.value })}
            />
          </label>

          <label className="field">
            <span>系统提示词</span>
            <textarea
              rows={4}
              value={config.systemPrompt}
              onChange={(e) => void update({ systemPrompt: e.target.value })}
            />
          </label>

          <p className="hint">API Key 只存在本机配置文件中，请求由主进程代理发往你选择的厂商。</p>
        </section>
      </main>

      <footer className="status-bar">
        <span className="status-main">{status}</span>
        <span className="status-update">
          {appVersion ? `v${appVersion}` : ''}
          {updateStatus.message ? ` · ${updateStatus.message}` : ''}
          {updateStatus.type === 'ready' ? (
            <button
              type="button"
              className="update-install-btn"
              onClick={() => void api?.installUpdateNow()}
            >
              重启并安装
            </button>
          ) : null}
          {updateStatus.type === 'idle' || updateStatus.type === 'error' ? (
            <button
              type="button"
              className="update-check-btn"
              disabled={busy}
              onClick={() => void api?.checkForUpdates()}
            >
              检查更新
            </button>
          ) : null}
        </span>
      </footer>
    </div>
  )
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('读取文件失败'))
    reader.readAsDataURL(file)
  })
}
