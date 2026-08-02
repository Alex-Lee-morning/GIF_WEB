import { removeBackground } from '@imgly/background-removal'
import { detectFaceCropBox } from './detectParts'
import { loadImage } from './pixelate'

export type SubjectCropMode = 'full' | 'face'

export interface SubjectExtractResult {
  cutoutDataUrl: string
  usedFaceCrop: boolean
  width: number
  height: number
}

type ProgressFn = (message: string) => void

/** Local assets under public/bg-removal (synced for @imgly/background-removal 1.7.0). */
function bgRemovalPublicPath(): string {
  return new URL('bg-removal/', document.baseURI).href
}

/**
 * Extract person/animal with transparent background.
 * Default keeps head+body; face crop only when mode === 'face'.
 */
export async function extractSubject(
  sourceDataUrl: string,
  onProgress?: ProgressFn,
  cropMode: SubjectCropMode = 'full',
): Promise<SubjectExtractResult> {
  onProgress?.('正在准备图片…')
  const prepared = await prepareImageBlob(sourceDataUrl)

  onProgress?.('正在抠出主体（头+身体）…')
  let blob: Blob | null = null
  let lastError: unknown = null

  try {
    blob = await removeBackground(prepared, {
      publicPath: bgRemovalPublicPath(),
      model: 'isnet_quint8',
      device: 'cpu',
      proxyToWorker: false,
      output: { format: 'image/png' },
      debug: false,
      progress: (key, current, total) => {
        if (total > 0) {
          const pct = Math.round((current / total) * 100)
          onProgress?.(`正在加载抠图模型… ${key} ${pct}%`)
        } else {
          onProgress?.(`正在抠图… ${key}`)
        }
      },
    })
  } catch (err) {
    lastError = err
    onProgress?.('本地模型抠图失败，尝试备用去背景…')
  }

  if (blob) {
    const cutoutUrl = await blobToDataUrl(blob)
    const cutoutImg = await loadImage(cutoutUrl)
    const bounds = opaqueBounds(cutoutImg)
    if (bounds && bounds.area >= 64) {
      return finishCrop(cutoutImg, bounds, cropMode, onProgress)
    }
    onProgress?.('AI 未识别到主体，改用边缘填充去背景…')
    blob = null
  }

  try {
    blob = await fallbackRemoveBackground(sourceDataUrl)
  } catch (err) {
    throw new Error(
      `主体提取失败：${
        lastError instanceof Error ? lastError.message : err instanceof Error ? err.message : String(err)
      }。请换一张主体更清晰、背景更简单的照片后再试。`,
    )
  }

  const cutoutUrl = await blobToDataUrl(blob)
  const cutoutImg = await loadImage(cutoutUrl)
  const bounds = opaqueBounds(cutoutImg)
  if (!bounds || bounds.area < 64) {
    throw new Error('未识别到主体，请换一张人像、宠物或正面照片再试（主体尽量居中、背景尽量简单）。')
  }

  return finishCrop(cutoutImg, bounds, cropMode, onProgress)
}

async function finishCrop(
  cutoutImg: HTMLImageElement,
  bounds: Bounds,
  cropMode: SubjectCropMode,
  onProgress?: ProgressFn,
): Promise<SubjectExtractResult> {
  let cropped = cropImageToBounds(cutoutImg, bounds, 0.08)
  let usedFaceCrop = false

  if (cropMode === 'face') {
    onProgress?.('正在裁切脸部…')
    const face = await detectFaceCropBox(cropped.dataUrl, cropped.width, cropped.height)
    if (!face) {
      // Still allow face-mode sprites on the full cutout rather than aborting
      onProgress?.('未精确定位脸部，将用主体上部作为脸部继续生成…')
      usedFaceCrop = true
    } else {
      if (face.source === 'heuristic') {
        onProgress?.('未检测到人像脸，已按主体头部区域裁切…')
      }
      const padX = Math.max(face.width, face.height) * 0.28
      const padTop = Math.max(face.width, face.height) * 0.35
      const padBottom = Math.max(face.width, face.height) * 0.55
      const faceBounds: Bounds = {
        x: Math.max(0, Math.floor(face.x - padX)),
        y: Math.max(0, Math.floor(face.y - padTop)),
        w: 0,
        h: 0,
        area: 0,
      }
      faceBounds.w = Math.min(cropped.width - faceBounds.x, Math.ceil(face.width + padX * 2))
      faceBounds.h = Math.min(
        cropped.height - faceBounds.y,
        Math.ceil(face.height + padTop + padBottom),
      )
      faceBounds.area = faceBounds.w * faceBounds.h
      if (faceBounds.area >= 64) {
        const faceImg = await loadImage(cropped.dataUrl)
        cropped = cropImageToBounds(faceImg, faceBounds, 0.04)
      }
      usedFaceCrop = true
    }
  }

  return {
    cutoutDataUrl: cropped.dataUrl,
    usedFaceCrop,
    width: cropped.width,
    height: cropped.height,
  }
}

/** Downscale huge photos so ONNX runs more reliably */
async function prepareImageBlob(sourceDataUrl: string): Promise<Blob> {
  const img = await loadImage(sourceDataUrl)
  const maxSide = 1280
  const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight))
  const w = Math.max(1, Math.round(img.naturalWidth * scale))
  const h = Math.max(1, Math.round(img.naturalHeight * scale))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas unsupported')
  ctx.drawImage(img, 0, 0, w, h)
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('图片预处理失败'))),
      'image/png',
    )
  })
  return blob
}

/**
 * Edge flood-fill fallback: only erase background connected to image borders.
 * Safer than global color-key for subjects that share colors with the background.
 */
async function fallbackRemoveBackground(sourceDataUrl: string): Promise<Blob> {
  const img = await loadImage(sourceDataUrl)
  const maxSide = 1024
  const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight))
  const w = Math.max(1, Math.round(img.naturalWidth * scale))
  const h = Math.max(1, Math.round(img.naturalHeight * scale))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('Canvas unsupported')
  ctx.drawImage(img, 0, 0, w, h)
  const image = ctx.getImageData(0, 0, w, h)
  const { data } = image

  const samples = [
    sample(data, w, 0, 0),
    sample(data, w, w - 1, 0),
    sample(data, w, 0, h - 1),
    sample(data, w, w - 1, h - 1),
    sample(data, w, Math.floor(w / 2), 0),
    sample(data, w, Math.floor(w / 2), h - 1),
    sample(data, w, 0, Math.floor(h / 2)),
    sample(data, w, w - 1, Math.floor(h / 2)),
  ]
  const bg = averageColor(samples)
  const threshold = 42

  const visited = new Uint8Array(w * h)
  const stack: number[] = []

  const tryPush = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return
    const idx = y * w + x
    if (visited[idx]) return
    const i = idx * 4
    const dr = data[i] - bg[0]
    const dg = data[i + 1] - bg[1]
    const db = data[i + 2] - bg[2]
    const dist = Math.sqrt(dr * dr + dg * dg + db * db)
    if (dist > threshold) return
    visited[idx] = 1
    stack.push(idx)
  }

  for (let x = 0; x < w; x++) {
    tryPush(x, 0)
    tryPush(x, h - 1)
  }
  for (let y = 0; y < h; y++) {
    tryPush(0, y)
    tryPush(w - 1, y)
  }

  while (stack.length) {
    const idx = stack.pop()!
    const x = idx % w
    const y = (idx / w) | 0
    const i = idx * 4
    data[i + 3] = 0
    tryPush(x + 1, y)
    tryPush(x - 1, y)
    tryPush(x, y + 1)
    tryPush(x, y - 1)
  }

  // Soften fringe near cleared pixels
  const alpha = new Uint8ClampedArray(w * h)
  for (let i = 0, p = 0; i < data.length; i += 4, p++) alpha[p] = data[i + 3]
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const p = y * w + x
      if (alpha[p] === 0) continue
      let cleared = 0
      if (alpha[p - 1] === 0) cleared++
      if (alpha[p + 1] === 0) cleared++
      if (alpha[p - w] === 0) cleared++
      if (alpha[p + w] === 0) cleared++
      if (cleared >= 2) data[p * 4 + 3] = Math.round(alpha[p] * 0.35)
    }
  }

  ctx.putImageData(image, 0, 0)

  const bounds = opaqueBoundsFromImageData(image)
  if (!bounds || bounds.area < 64) {
    throw new Error('简易去背景也失败了')
  }

  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('导出失败'))), 'image/png')
  })
}

function sample(data: Uint8ClampedArray, w: number, x: number, y: number): [number, number, number] {
  const i = (y * w + x) * 4
  return [data[i], data[i + 1], data[i + 2]]
}

function averageColor(colors: Array<[number, number, number]>): [number, number, number] {
  let r = 0
  let g = 0
  let b = 0
  for (const c of colors) {
    r += c[0]
    g += c[1]
    b += c[2]
  }
  const n = colors.length
  return [r / n, g / n, b / n]
}

interface Bounds {
  x: number
  y: number
  w: number
  h: number
  area: number
}

function opaqueBounds(img: HTMLImageElement): Bounds | null {
  const canvas = document.createElement('canvas')
  canvas.width = img.naturalWidth
  canvas.height = img.naturalHeight
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null
  ctx.drawImage(img, 0, 0)
  return opaqueBoundsFromImageData(ctx.getImageData(0, 0, canvas.width, canvas.height))
}

function opaqueBoundsFromImageData(image: ImageData): Bounds | null {
  const { data, width, height } = image
  let minX = width
  let minY = height
  let maxX = -1
  let maxY = -1
  let count = 0
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const a = data[(y * width + x) * 4 + 3]
      if (a > 24) {
        count++
        if (x < minX) minX = x
        if (y < minY) minY = y
        if (x > maxX) maxX = x
        if (y > maxY) maxY = y
      }
    }
  }
  if (maxX < minX || maxY < minY) return null
  return {
    x: minX,
    y: minY,
    w: maxX - minX + 1,
    h: maxY - minY + 1,
    area: count,
  }
}

function cropImageToBounds(
  img: HTMLImageElement,
  bounds: Bounds,
  padRatio: number,
): { dataUrl: string; width: number; height: number } {
  const padX = Math.round(bounds.w * padRatio)
  const padY = Math.round(bounds.h * padRatio)
  const x = Math.max(0, bounds.x - padX)
  const y = Math.max(0, bounds.y - padY)
  const w = Math.min(img.naturalWidth - x, bounds.w + padX * 2)
  const h = Math.min(img.naturalHeight - y, bounds.h + padY * 2)

  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas unsupported')
  ctx.clearRect(0, 0, w, h)
  ctx.drawImage(img, x, y, w, h, 0, 0, w, h)
  return { dataUrl: canvas.toDataURL('image/png'), width: w, height: h }
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('读取抠图结果失败'))
    reader.readAsDataURL(blob)
  })
}

