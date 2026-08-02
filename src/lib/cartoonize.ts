import { loadImage } from './pixelate'

export interface CartoonizeOptions {
  /** Output canvas size (square). */
  size?: number
  /** Posterize levels per channel (lower = flatter cartoon). */
  levels?: number
  /** Soft blur radius before posterize. */
  blur?: number
  /** Draw dark outline. */
  outline?: boolean
}

/**
 * Convert a cutout/photo into a flat cartoon-style RGBA canvas.
 * This is a full redraw stylization (not a body-part cut-up).
 */
export async function cartoonizeImage(
  source: string | HTMLImageElement | HTMLCanvasElement,
  opts: CartoonizeOptions = {},
): Promise<HTMLCanvasElement> {
  const size = opts.size ?? 128
  const levels = opts.levels ?? 6
  const blur = opts.blur ?? 1.2
  const outline = opts.outline !== false

  const img: HTMLImageElement =
    typeof source === 'string'
      ? await loadImage(source)
      : source instanceof HTMLImageElement
        ? source
        : await canvasToImage(source)

  const work = document.createElement('canvas')
  work.width = size
  work.height = size
  const wctx = work.getContext('2d', { willReadFrequently: true })
  if (!wctx) throw new Error('Canvas unsupported')

  const iw = img.naturalWidth || img.width
  const ih = img.naturalHeight || img.height
  const scale = Math.min((size * 0.9) / Math.max(1, iw), (size * 0.9) / Math.max(1, ih))
  const dw = Math.max(1, Math.round(iw * scale))
  const dh = Math.max(1, Math.round(ih * scale))
  const dx = Math.floor((size - dw) / 2)
  const dy = Math.floor((size - dh) / 2)
  wctx.clearRect(0, 0, size, size)
  wctx.imageSmoothingEnabled = true
  wctx.drawImage(img, dx, dy, dw, dh)

  // Soft blur via down/up sample
  if (blur > 0) {
    const tiny = Math.max(8, Math.round(size / (2 + blur)))
    const tmp = document.createElement('canvas')
    tmp.width = tiny
    tmp.height = tiny
    const tctx = tmp.getContext('2d')
    if (tctx) {
      tctx.imageSmoothingEnabled = true
      tctx.drawImage(work, 0, 0, tiny, tiny)
      wctx.clearRect(0, 0, size, size)
      wctx.imageSmoothingEnabled = true
      wctx.drawImage(tmp, 0, 0, size, size)
    }
  }

  const { data } = wctx.getImageData(0, 0, size, size)
  const step = 255 / Math.max(1, levels - 1)
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3]
    if (a < 20) {
      data[i + 3] = 0
      continue
    }
    // Cel-shade: posterize + slight saturation boost
    let r = data[i]
    let g = data[i + 1]
    let b = data[i + 2]
    const max = Math.max(r, g, b)
    const min = Math.min(r, g, b)
    const sat = max === 0 ? 0 : (max - min) / max
    if (sat > 0.05) {
      const boost = 1.15
      const gray = 0.299 * r + 0.587 * g + 0.114 * b
      r = clamp(gray + (r - gray) * boost)
      g = clamp(gray + (g - gray) * boost)
      b = clamp(gray + (b - gray) * boost)
    }
    data[i] = Math.round(Math.round(r / step) * step)
    data[i + 1] = Math.round(Math.round(g / step) * step)
    data[i + 2] = Math.round(Math.round(b / step) * step)
    data[i + 3] = a > 128 ? 255 : 0
  }
  wctx.putImageData(new ImageData(data, size, size), 0, 0)

  if (outline) {
    applyCartoonOutline(wctx, size)
  }

  // Final crisp pixel look
  const pixel = document.createElement('canvas')
  const pxSize = Math.min(96, Math.max(48, Math.round(size / 2)))
  pixel.width = pxSize
  pixel.height = pxSize
  const pctx = pixel.getContext('2d')
  if (!pctx) return work
  pctx.imageSmoothingEnabled = false
  pctx.clearRect(0, 0, pxSize, pxSize)
  pctx.drawImage(work, 0, 0, pxSize, pxSize)

  const out = document.createElement('canvas')
  out.width = size
  out.height = size
  const octx = out.getContext('2d')
  if (!octx) return pixel
  octx.imageSmoothingEnabled = false
  octx.clearRect(0, 0, size, size)
  octx.drawImage(pixel, 0, 0, size, size)
  return out
}

export async function cartoonizeToDataUrl(
  source: string | HTMLImageElement | HTMLCanvasElement,
  opts?: CartoonizeOptions,
): Promise<string> {
  const canvas = await cartoonizeImage(source, opts)
  return canvas.toDataURL('image/png')
}

function applyCartoonOutline(ctx: CanvasRenderingContext2D, size: number) {
  const src = ctx.getImageData(0, 0, size, size)
  const out = new ImageData(new Uint8ClampedArray(src.data), size, size)
  const d = src.data
  const o = out.data
  for (let y = 1; y < size - 1; y++) {
    for (let x = 1; x < size - 1; x++) {
      const i = (y * size + x) * 4
      if (d[i + 3] < 128) continue
      let edge = false
      for (const [dx, dy] of [
        [-1, 0],
        [1, 0],
        [0, -1],
        [0, 1],
      ] as const) {
        const ni = ((y + dy) * size + (x + dx)) * 4
        if (d[ni + 3] < 64) {
          edge = true
          break
        }
      }
      if (edge) {
        o[i] = Math.round(d[i] * 0.35)
        o[i + 1] = Math.round(d[i + 1] * 0.35)
        o[i + 2] = Math.round(d[i + 2] * 0.35)
        o[i + 3] = 255
      }
    }
  }
  ctx.putImageData(out, 0, 0)
}

function clamp(n: number): number {
  return Math.max(0, Math.min(255, Math.round(n)))
}

function canvasToImage(canvas: HTMLCanvasElement): Promise<HTMLImageElement> {
  return loadImage(canvas.toDataURL('image/png'))
}
