import { GIFEncoder, quantize, applyPalette } from 'gifenc'
import type { PetSpriteSet, PetSpriteState } from '../../shared/types'
import type { BodyParts } from './detectParts'
import type { PixelImage } from './pixelate'

const SCALE_UP = 8

/**
 * Face-crop pet sprites:
 * - drag*: a cartoon hand pulls the face with soft deformation
 * - idle: a ball drops, bonks the head, then the face frowns
 */
export async function generateFacePetSprites(
  pixel: PixelImage,
  parts: BodyParts,
): Promise<PetSpriteSet> {
  const base = canvasFromPixel(pixel)
  const { width, height } = pixel

  const idleCanvases = makeBallBonkIdle(base, parts)
  const pullLeft = makeHandPullCycle(base, parts, 'left')
  const pullRight = makeHandPullCycle(base, parts, 'right')
  const pullUp = makeHandPullCycle(base, parts, 'up')
  const pullDown = makeHandPullCycle(base, parts, 'down')

  const talkFrames = Array.from({ length: 6 }, (_, i) => {
    const a = Math.sin((i / 6) * Math.PI * 2)
    let f = deformFace(base, { squashX: 1 + a * 0.02, squashY: 1 - a * 0.02, ty: Math.round(a * -0.5) })
    if (parts.hasMouth && parts.mouth && a > 0.2) f = openMouthSlight(f, parts, 0.3 + a * 0.4)
    return f
  })

  const reactFrames = [
    deformFace(base, { squashX: 1.08, squashY: 0.9, ty: 1 }),
    deformFace(base, { squashX: 0.94, squashY: 1.08, ty: -2 }),
    deformFace(base, { rot: -4 }),
    deformFace(base, { rot: 4 }),
    deformFace(base, { squashX: 1.02, squashY: 0.98 }),
    cloneCanvas(base),
  ]

  const thinkFrames = [
    deformFace(base, { tx: -1, rot: -4 }),
    deformFace(base, { tx: 1, rot: 4 }),
    deformFace(base, { tx: -1, rot: -2 }),
    deformFace(base, { tx: 1, rot: 2 }),
    deformFace(base, { squashY: 0.97 }),
    cloneCanvas(base),
  ]

  const frames: Record<PetSpriteState, string[]> = {
    idle: idleCanvases.map(upscaleDataUrl),
    talk: talkFrames.map(upscaleDataUrl),
    dragLeft: pullLeft.map(upscaleDataUrl),
    dragRight: pullRight.map(upscaleDataUrl),
    dragUp: pullUp.map(upscaleDataUrl),
    dragDown: pullDown.map(upscaleDataUrl),
    react: reactFrames.map(upscaleDataUrl),
    think: thinkFrames.map(upscaleDataUrl),
  }

  const previewSources: Array<{ canvas: HTMLCanvasElement; delay: number }> = [
    { canvas: idleCanvases[0], delay: 120 },
    { canvas: idleCanvases[2], delay: 100 },
    { canvas: idleCanvases[4], delay: 90 },
    { canvas: idleCanvases[6], delay: 100 },
    { canvas: idleCanvases[8], delay: 140 },
    { canvas: idleCanvases[10], delay: 160 },
    { canvas: pullRight[1], delay: 110 },
    { canvas: pullRight[3], delay: 110 },
    { canvas: pullLeft[2], delay: 110 },
    { canvas: pullUp[2], delay: 110 },
    { canvas: pullDown[2], delay: 110 },
  ]
  const previewGifDataUrl = await encodePreviewGif(previewSources)

  return {
    width: width * SCALE_UP,
    height: height * SCALE_UP,
    frames,
    previewGifDataUrl,
    animStyle: 'face',
  }
}

/** Idle: ball falls → hits head → frown → recover */
function makeBallBonkIdle(base: HTMLCanvasElement, parts: BodyParts): HTMLCanvasElement[] {
  const w = base.width
  const h = base.height
  const headTop = Math.max(2, parts.head.y)
  const headCx = Math.floor(parts.head.x + parts.head.w / 2)
  const ballR = Math.max(2, Math.round(Math.min(w, h) * 0.07))

  // y positions for ball (from above canvas into head)
  const startY = -ballR * 2
  const hitY = headTop + Math.max(1, Math.floor(parts.head.h * 0.08))
  const frames: HTMLCanvasElement[] = []

  const timeline: Array<{ ballY: number; impact: number; frown: number }> = [
    { ballY: startY, impact: 0, frown: 0 },
    { ballY: startY + (hitY - startY) * 0.25, impact: 0, frown: 0 },
    { ballY: startY + (hitY - startY) * 0.5, impact: 0, frown: 0 },
    { ballY: startY + (hitY - startY) * 0.75, impact: 0, frown: 0 },
    { ballY: hitY, impact: 0.35, frown: 0.15 },
    { ballY: hitY + 1, impact: 1, frown: 0.55 },
    { ballY: hitY + 2, impact: 0.7, frown: 0.9 },
    { ballY: hitY + 4, impact: 0.35, frown: 1 },
    { ballY: hitY + 8, impact: 0.1, frown: 0.85 },
    { ballY: hitY + 14, impact: 0, frown: 0.55 },
    { ballY: h + ballR * 2, impact: 0, frown: 0.25 },
    { ballY: h + ballR * 3, impact: 0, frown: 0 },
  ]

  for (const t of timeline) {
    let face = deformFace(base, {
      squashX: 1 + t.impact * 0.08,
      squashY: 1 - t.impact * 0.12,
      ty: Math.round(t.impact * 1.5),
    })
    if (t.frown > 0.05) face = applyFrown(face, parts, t.frown)
    const out = cloneCanvas(face)
    const ctx = out.getContext('2d')
    if (ctx && t.ballY < h + ballR * 2) {
      drawPixelBall(ctx, headCx, Math.round(t.ballY), ballR)
    }
    frames.push(out)
  }
  return frames
}

type PullDir = 'left' | 'right' | 'up' | 'down'

function makeHandPullCycle(
  base: HTMLCanvasElement,
  parts: BodyParts,
  dir: PullDir,
): HTMLCanvasElement[] {
  const amounts = [0.2, 0.45, 0.75, 1, 0.7, 0.35]
  return amounts.map((a) => {
    const pull = pullFace(base, dir, a)
    const out = cloneCanvas(pull)
    const ctx = out.getContext('2d')
    if (ctx) drawPixelHand(ctx, parts, dir, a)
    return out
  })
}

/** Soft whole-face stretch toward pull direction (no layer cuts). */
function pullFace(source: HTMLCanvasElement, dir: PullDir, amount: number): HTMLCanvasElement {
  const w = source.width
  const h = source.height
  const sctx = source.getContext('2d', { willReadFrequently: true })
  if (!sctx) return cloneCanvas(source)
  const src = sctx.getImageData(0, 0, w, h)
  const out = sctx.createImageData(w, h)
  const amp = Math.max(2, Math.min(w, h) * 0.12) * amount

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const nx = x / Math.max(1, w - 1)
      const ny = y / Math.max(1, h - 1)
      let sx = x
      let sy = y
      if (dir === 'left') {
        const fall = 1 - nx
        sx = x + amp * fall
        sy = y + Math.sin(ny * Math.PI) * amp * 0.15 * fall
      } else if (dir === 'right') {
        const fall = nx
        sx = x - amp * fall
        sy = y + Math.sin(ny * Math.PI) * amp * 0.15 * fall
      } else if (dir === 'up') {
        const fall = 1 - ny
        sy = y + amp * fall
        sx = x + Math.sin(nx * Math.PI) * amp * 0.12 * fall
      } else {
        const fall = ny
        sy = y - amp * fall
        sx = x + Math.sin(nx * Math.PI) * amp * 0.12 * fall
      }
      const ix = Math.round(sx)
      const iy = Math.round(sy)
      const di = (y * w + x) * 4
      if (ix < 0 || iy < 0 || ix >= w || iy >= h) {
        out.data[di + 3] = 0
        continue
      }
      const si = (iy * w + ix) * 4
      out.data[di] = src.data[si]
      out.data[di + 1] = src.data[si + 1]
      out.data[di + 2] = src.data[si + 2]
      out.data[di + 3] = src.data[si + 3]
    }
  }

  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  canvas.getContext('2d')?.putImageData(out, 0, 0)
  return canvas
}

function deformFace(
  source: HTMLCanvasElement,
  opts: { squashX?: number; squashY?: number; tx?: number; ty?: number; rot?: number },
): HTMLCanvasElement {
  const w = source.width
  const h = source.height
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d')
  if (!ctx) return cloneCanvas(source)
  ctx.imageSmoothingEnabled = false
  ctx.clearRect(0, 0, w, h)
  ctx.save()
  ctx.translate(w / 2 + (opts.tx ?? 0), h / 2 + (opts.ty ?? 0))
  ctx.rotate(((opts.rot ?? 0) * Math.PI) / 180)
  ctx.scale(opts.squashX ?? 1, opts.squashY ?? 1)
  ctx.drawImage(source, -w / 2, -h / 2)
  ctx.restore()
  return c
}

function applyFrown(source: HTMLCanvasElement, parts: BodyParts, amount: number): HTMLCanvasElement {
  const c = cloneCanvas(source)
  const ctx = c.getContext('2d')
  if (!ctx) return c
  ctx.imageSmoothingEnabled = false

  const brows: Array<{ x: number; y: number; w: number }> = []
  if (parts.leftEye) {
    brows.push({
      x: parts.leftEye.x,
      y: Math.max(0, parts.leftEye.y - Math.max(1, Math.floor(parts.leftEye.h * 0.6))),
      w: parts.leftEye.w,
    })
  }
  if (parts.rightEye) {
    brows.push({
      x: parts.rightEye.x,
      y: Math.max(0, parts.rightEye.y - Math.max(1, Math.floor(parts.rightEye.h * 0.6))),
      w: parts.rightEye.w,
    })
  }
  if (brows.length === 0) {
    const midY = Math.floor(source.height * 0.28)
    brows.push({ x: Math.floor(source.width * 0.22), y: midY, w: Math.floor(source.width * 0.2) })
    brows.push({ x: Math.floor(source.width * 0.58), y: midY, w: Math.floor(source.width * 0.2) })
  }

  const thick = Math.max(1, Math.round(1 + amount))
  ctx.strokeStyle = `rgba(40, 28, 24, ${0.55 + amount * 0.4})`
  ctx.lineWidth = thick
  ctx.lineCap = 'square'

  // Inner ends drop → angry / frown brows
  if (brows[0]) {
    const b = brows[0]
    ctx.beginPath()
    ctx.moveTo(b.x, b.y + Math.round(amount * 2))
    ctx.lineTo(b.x + b.w, b.y - Math.round(amount))
    ctx.stroke()
  }
  if (brows[1]) {
    const b = brows[1]
    ctx.beginPath()
    ctx.moveTo(b.x, b.y - Math.round(amount))
    ctx.lineTo(b.x + b.w, b.y + Math.round(amount * 2))
    ctx.stroke()
  }

  // Slight mouth downturn
  if (parts.mouth) {
    const m = parts.mouth
    ctx.strokeStyle = `rgba(30, 20, 18, ${0.4 + amount * 0.45})`
    ctx.beginPath()
    ctx.moveTo(m.x, m.y + Math.floor(m.h * 0.4))
    ctx.quadraticCurveTo(
      m.x + m.w / 2,
      m.y + m.h + Math.round(amount * 2),
      m.x + m.w,
      m.y + Math.floor(m.h * 0.4),
    )
    ctx.stroke()
  }

  return deformFace(c, {
    squashX: 1 + amount * 0.03,
    squashY: 1 - amount * 0.04,
    ty: Math.round(amount),
  })
}

function openMouthSlight(source: HTMLCanvasElement, parts: BodyParts, open: number): HTMLCanvasElement {
  if (!parts.mouth) return cloneCanvas(source)
  const c = cloneCanvas(source)
  const ctx = c.getContext('2d')
  if (!ctx) return c
  const m = parts.mouth
  const h = Math.max(1, Math.round(m.h * (0.5 + open * 0.6)))
  ctx.fillStyle = 'rgba(30, 18, 18, 0.65)'
  ctx.fillRect(m.x + 1, m.y + 1, Math.max(1, m.w - 2), h)
  return c
}

function drawPixelBall(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  // Red/orange cartoon ball with highlight
  for (let y = -r; y <= r; y++) {
    for (let x = -r; x <= r; x++) {
      if (x * x + y * y > r * r) continue
      const edge = x * x + y * y > (r - 0.6) * (r - 0.6)
      const hi = x < -r * 0.2 && y < -r * 0.2
      ctx.fillStyle = edge ? '#7a2a18' : hi ? '#ffb08a' : '#e85a2e'
      ctx.fillRect(cx + x, cy + y, 1, 1)
    }
  }
}

function drawPixelHand(
  ctx: CanvasRenderingContext2D,
  parts: BodyParts,
  dir: PullDir,
  amount: number,
) {
  const head = parts.head
  const palm = Math.max(3, Math.round(Math.min(head.w, head.h) * 0.18))
  let hx = 0
  let hy = 0
  if (dir === 'left') {
    hx = head.x - Math.round(palm * (0.4 + amount * 0.5))
    hy = Math.floor(head.y + head.h * 0.4)
  } else if (dir === 'right') {
    hx = head.x + head.w - Math.round(palm * (0.2 - amount * 0.2))
    hy = Math.floor(head.y + head.h * 0.4)
  } else if (dir === 'up') {
    hx = Math.floor(head.x + head.w * 0.35)
    hy = head.y - Math.round(palm * (0.3 + amount * 0.4))
  } else {
    hx = Math.floor(head.x + head.w * 0.35)
    hy = head.y + head.h - Math.round(palm * (0.15 - amount * 0.1))
  }

  // Palm
  ctx.fillStyle = '#f0c29a'
  ctx.fillRect(hx, hy, palm, Math.max(3, Math.round(palm * 0.85)))
  // Fingers
  ctx.fillStyle = '#e8b48a'
  const fingerW = Math.max(1, Math.floor(palm / 4))
  for (let i = 0; i < 4; i++) {
    const fx = hx + i * fingerW
    if (dir === 'left') ctx.fillRect(fx - 1, hy - 2, fingerW, 3)
    else if (dir === 'right') ctx.fillRect(fx + 1, hy - 2, fingerW, 3)
    else if (dir === 'up') ctx.fillRect(fx, hy - 2, fingerW, 3)
    else ctx.fillRect(fx, hy + Math.round(palm * 0.7), fingerW, 3)
  }
  // Outline
  ctx.strokeStyle = 'rgba(80, 50, 35, 0.75)'
  ctx.strokeRect(hx, hy, palm, Math.max(3, Math.round(palm * 0.85)))
}

function canvasFromPixel(pixel: PixelImage): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = pixel.width
  canvas.height = pixel.height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas unsupported')
  ctx.putImageData(new ImageData(new Uint8ClampedArray(pixel.data), pixel.width, pixel.height), 0, 0)
  return canvas
}

function cloneCanvas(source: HTMLCanvasElement): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = source.width
  c.height = source.height
  const ctx = c.getContext('2d')
  if (!ctx) throw new Error('Canvas unsupported')
  ctx.drawImage(source, 0, 0)
  return c
}

function upscaleDataUrl(source: HTMLCanvasElement): string {
  const display = document.createElement('canvas')
  display.width = source.width * SCALE_UP
  display.height = source.height * SCALE_UP
  const ctx = display.getContext('2d')
  if (!ctx) return source.toDataURL('image/png')
  ctx.imageSmoothingEnabled = false
  ctx.clearRect(0, 0, display.width, display.height)
  ctx.drawImage(source, 0, 0, display.width, display.height)
  return display.toDataURL('image/png')
}

async function encodePreviewGif(
  frames: Array<{ canvas: HTMLCanvasElement; delay: number }>,
): Promise<string> {
  const first = frames[0].canvas
  const gif = GIFEncoder()
  const w = first.width
  const h = first.height
  for (const frame of frames) {
    const ctx = frame.canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) continue
    const { data } = ctx.getImageData(0, 0, w, h)
    const rgba = new Uint8ClampedArray(data.length)
    for (let i = 0; i < data.length; i += 4) {
      const a = data[i + 3] / 255
      rgba[i] = Math.round(data[i] * a + 243 * (1 - a))
      rgba[i + 1] = Math.round(data[i + 1] * a + 243 * (1 - a))
      rgba[i + 2] = Math.round(data[i + 2] * a + 243 * (1 - a))
      rgba[i + 3] = 255
    }
    const palette = quantize(rgba, 256)
    const index = applyPalette(rgba, palette)
    gif.writeFrame(index, w, h, {
      palette,
      delay: Math.max(2, Math.round(frame.delay / 10)),
      repeat: 0,
    })
  }
  gif.finish()
  const bytes = gif.bytes()
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return blobToDataUrl(new Blob([copy], { type: 'image/gif' }))
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('GIF 编码失败'))
    reader.readAsDataURL(blob)
  })
}
