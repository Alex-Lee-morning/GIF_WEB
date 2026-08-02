import { GIFEncoder, quantize, applyPalette } from 'gifenc'
import type { PetSpriteSet, PetSpriteState } from '../../shared/types'
import type { BodyParts, Rect } from './detectParts'
import type { PixelImage } from './pixelate'
import { generateFacePetSprites } from './faceSprites'

const SCALE_UP = 8

export async function generatePetSprites(
  pixel: PixelImage,
  parts: BodyParts,
  opts?: { mode?: 'full' | 'face' },
): Promise<PetSpriteSet> {
  if (opts?.mode === 'face') {
    return generateFacePetSprites(pixel, parts)
  }
  const base = canvasFromPixel(pixel)
  const { width, height } = pixel
  const open = cloneCanvas(base)

  // Idle: whole-image breath (no cuts) + obvious blink when eyes exist
  const idleCanvases: HTMLCanvasElement[] = []
  for (let i = 0; i < 10; i++) {
    const breath = Math.sin((i / 10) * Math.PI * 2)
    let frame = warp(base, width, height, {
      scaleY: 1 + breath * 0.03,
      scaleX: 1 - breath * 0.01,
      ty: Math.round(breath * -1.2),
    })
    if (parts.hasEyes && parts.leftEye && parts.rightEye) {
      if (i === 6) frame = applyBlink(frame, parts, 'half')
      if (i === 7) frame = applyBlink(frame, parts, 'closed')
      if (i === 8) frame = applyBlink(frame, parts, 'half')
    }
    idleCanvases.push(frame)
  }
  const idleFrames = idleCanvases.map(upscaleDataUrl)

  const talkFrames = (parts.hasMouth && parts.mouth
    ? [0, 0.35, 0.7, 1, 0.7, 0.35, 0.85, 0].map((a) => applyTalk(base, parts, a))
    : Array.from({ length: 6 }, (_, i) => {
        const breath = Math.sin((i / 6) * Math.PI * 2)
        return warp(base, width, height, { scaleY: 1 + breath * 0.012, ty: Math.round(breath * -0.5) })
      })
  ).map(upscaleDataUrl)

  const walkRightCanvases = makeCoherentWalk(base, parts, 'right')
  const walkLeftCanvases = makeCoherentWalk(base, parts, 'left')
  const walkRight = walkRightCanvases.map(upscaleDataUrl)
  const walkLeft = walkLeftCanvases.map(upscaleDataUrl)
  const liftFrames = makeLiftCycle(base, parts).map(upscaleDataUrl)
  const pressFrames = makePressCycle(base, width, height).map(upscaleDataUrl)

  const reactFrames = [
    warp(base, width, height, { scaleX: 1.06, scaleY: 0.9, ty: 1 }),
    warp(base, width, height, { scaleX: 0.95, scaleY: 1.1, ty: -2 }),
    warp(base, width, height, { scaleX: 1.04, scaleY: 0.96 }),
    warp(base, width, height, { scaleX: 0.98, scaleY: 1.04, ty: -1 }),
    warp(base, width, height, { scaleX: 1.02, scaleY: 0.98 }),
    open,
  ].map(upscaleDataUrl)

  const thinkFrames = [
    warp(base, width, height, { tx: -1, rot: -3 }),
    warp(base, width, height, { tx: 1, rot: 3 }),
    warp(base, width, height, { tx: -1, rot: -2 }),
    warp(base, width, height, { tx: 1, rot: 2 }),
    warp(base, width, height, { scaleY: 0.98 }),
    open,
  ].map(upscaleDataUrl)

  const frames: Record<PetSpriteState, string[]> = {
    idle: idleFrames,
    talk: talkFrames,
    dragRight: walkRight,
    dragLeft: walkLeft,
    dragUp: liftFrames,
    dragDown: pressFrames,
    react: reactFrames,
    think: thinkFrames,
  }

  const previewSources: Array<{ canvas: HTMLCanvasElement; delay: number }> = [
    { canvas: idleCanvases[0], delay: 200 },
    { canvas: idleCanvases[3], delay: 200 },
    { canvas: idleCanvases[6], delay: 90 },
    { canvas: idleCanvases[7], delay: 120 },
    { canvas: idleCanvases[8], delay: 90 },
    { canvas: idleCanvases[0], delay: 200 },
    { canvas: walkRightCanvases[0], delay: 100 },
    { canvas: walkRightCanvases[2], delay: 100 },
    { canvas: walkRightCanvases[4], delay: 100 },
    { canvas: walkRightCanvases[6], delay: 100 },
    { canvas: walkLeftCanvases[2], delay: 100 },
    { canvas: walkLeftCanvases[6], delay: 100 },
  ]
  const previewGifDataUrl = await encodePreviewGif(previewSources)

  return {
    width: width * SCALE_UP,
    height: height * SCALE_UP,
    frames,
    previewGifDataUrl,
    animStyle: 'body',
  }
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

function mirrorHorizontal(source: HTMLCanvasElement): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = source.width
  c.height = source.height
  const ctx = c.getContext('2d')
  if (!ctx) return cloneCanvas(source)
  ctx.imageSmoothingEnabled = false
  ctx.translate(c.width, 0)
  ctx.scale(-1, 1)
  ctx.drawImage(source, 0, 0)
  return c
}

function mirrorRect(r: Rect, canvasW: number): Rect {
  return { x: canvasW - r.x - r.w, y: r.y, w: r.w, h: r.h }
}

function mirrorParts(parts: BodyParts, canvasW: number): BodyParts {
  return {
    ...parts,
    leftEye: parts.rightEye ? mirrorRect(parts.rightEye, canvasW) : null,
    rightEye: parts.leftEye ? mirrorRect(parts.leftEye, canvasW) : null,
    mouth: parts.mouth ? mirrorRect(parts.mouth, canvasW) : null,
    head: mirrorRect(parts.head, canvasW),
    torso: mirrorRect(parts.torso, canvasW),
    leftArm: mirrorRect(parts.rightArm, canvasW),
    rightArm: mirrorRect(parts.leftArm, canvasW),
    legs: mirrorRect(parts.legs, canvasW),
    leftLeg: mirrorRect(parts.rightLeg, canvasW),
    rightLeg: mirrorRect(parts.leftLeg, canvasW),
  }
}

/**
 * Generate walk frames by remapping the WHOLE image (no crop/clear/recomposite).
 * Left facing = full horizontal flip first, then same gait.
 * Legs get strong alternating swing/lift via smooth displacement fields.
 */
function makeCoherentWalk(
  source: HTMLCanvasElement,
  parts: BodyParts,
  facing: 'left' | 'right',
): HTMLCanvasElement[] {
  const facingSrc = facing === 'right' ? source : mirrorHorizontal(source)
  const p = facing === 'right' ? parts : mirrorParts(parts, source.width)
  return [0, 1, 2, 3, 4, 5, 6, 7].map((i) => remapWalkFrame(facingSrc, p, (i / 8) * Math.PI * 2))
}

/** Soft radial membership 0..1 for a rect (1 inside, fades outside). */
function softRectWeight(x: number, y: number, r: Rect, pad: number): number {
  const cx = r.x + r.w / 2
  const cy = r.y + r.h / 2
  const hx = r.w / 2 + pad
  const hy = r.h / 2 + pad
  const nx = Math.abs(x - cx) / Math.max(1, hx)
  const ny = Math.abs(y - cy) / Math.max(1, hy)
  const d = Math.max(nx, ny)
  if (d <= 0.55) return 1
  if (d >= 1) return 0
  const t = (d - 0.55) / 0.45
  return 1 - t * t * (3 - 2 * t)
}

function remapWalkFrame(source: HTMLCanvasElement, parts: BodyParts, phase: number): HTMLCanvasElement {
  const w = source.width
  const h = source.height
  const sctx = source.getContext('2d', { willReadFrequently: true })
  if (!sctx) return cloneCanvas(source)
  const src = sctx.getImageData(0, 0, w, h)
  const out = sctx.createImageData(w, h)

  const step = Math.sin(phase)
  const step2 = Math.sin(phase + Math.PI / 2)
  const bounce = Math.abs(Math.sin(phase))
  const bodyBob = Math.sin(phase * 2) * -Math.max(1.5, h * 0.035)
  const leanX = step * Math.max(1.2, w * 0.035)

  const legs = parts.legs
  const waistY = Math.max(1, Math.min(h - 2, legs.y - Math.floor(legs.h * 0.08)))

  // Prefer Cursor-AI / detector limb boxes; else 4 equal columns
  const limbBoxes = [parts.leftLeg, parts.rightLeg, parts.leftArm, parts.rightArm]
  const useLimbs = limbBoxes.every((r) => r.w >= 2 && r.h >= 2)
  const columns = useLimbs
    ? limbBoxes
    : [0, 1, 2, 3].map((i) => {
        const colW = Math.max(2, legs.w / 4)
        return { x: legs.x + i * colW, y: waistY, w: colW + 1, h: h - waistY }
      })
  // Diagonal gait: rear-left+front-right vs rear-right+front-left
  const swings = [step, -step, -step, step]
  const lifts = [Math.max(0, step), Math.max(0, -step), Math.max(0, -step), Math.max(0, step)]

  const swingAmp = Math.max(3, Math.min(w * 0.16, legs.w * 0.22))
  const liftAmp = Math.max(2.5, Math.min(h * 0.14, legs.h * 0.7))

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const lower = y < waistY ? 0 : Math.min(1, (y - waistY) / Math.max(1, h - waistY))
      let dx = leanX * (1 - lower * 0.55)
      let dy = bodyBob * (1 - lower * 0.25) + bounce * lower * 0.8

      if (lower > 0.05) {
        for (let c = 0; c < 4; c++) {
          const weight = softRectWeight(x, y, columns[c], 1.5) * (0.25 + 0.75 * lower)
          if (weight <= 0) continue
          dx += weight * swings[c] * swingAmp
          dy -= weight * lifts[c] * liftAmp
          // Slight squash on planted legs
          dy += weight * (1 - lifts[c]) * bounce * 0.6
        }
        // Extra mid-band wiggle so short legs still read as steps
        const mid = softRectWeight(x, y, legs, 2) * lower
        dx += mid * step2 * swingAmp * 0.25
      }

      const sx = Math.round(x - dx)
      const sy = Math.round(y - dy)
      const di = (y * w + x) * 4
      if (sx < 0 || sy < 0 || sx >= w || sy >= h) {
        out.data[di + 3] = 0
        continue
      }
      const si = (sy * w + sx) * 4
      out.data[di] = src.data[si]
      out.data[di + 1] = src.data[si + 1]
      out.data[di + 2] = src.data[si + 2]
      out.data[di + 3] = src.data[si + 3]
    }
  }

  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) return cloneCanvas(source)
  ctx.putImageData(out, 0, 0)
  return canvas
}

function makeLiftCycle(source: HTMLCanvasElement, _parts: BodyParts): HTMLCanvasElement[] {
  const w = source.width
  const h = source.height
  return [0.15, 0.35, 0.55, 0.75, 0.5, 0.25].map((a) =>
    warp(source, w, h, {
      scaleX: 1 - a * 0.04,
      scaleY: 1 + a * 0.08,
      ty: -Math.round(a * 3),
    }),
  )
}

/** Blink via whole-image remap of eye neighborhoods (no clearRect cutouts). */
function applyBlink(
  source: HTMLCanvasElement,
  parts: BodyParts,
  phase: 'half' | 'closed',
): HTMLCanvasElement {
  if (!parts.hasEyes || !parts.leftEye || !parts.rightEye) return cloneCanvas(source)
  const w = source.width
  const h = source.height
  const sctx = source.getContext('2d', { willReadFrequently: true })
  if (!sctx) return cloneCanvas(source)
  const src = sctx.getImageData(0, 0, w, h)
  const out = new ImageData(new Uint8ClampedArray(src.data), w, h)
  const squash = phase === 'closed' ? 0.18 : 0.45

  for (const eye of [parts.leftEye, parts.rightEye]) {
    const pad = 1
    const x0 = Math.max(0, eye.x - pad)
    const y0 = Math.max(0, eye.y - pad)
    const x1 = Math.min(w, eye.x + eye.w + pad)
    const y1 = Math.min(h, eye.y + eye.h + pad)
    const cy = eye.y + eye.h / 2
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const weight = softRectWeight(x, y, eye, pad)
        if (weight <= 0) continue
        // Pull samples toward eyelid midline → eye looks closed
        const sy = Math.round(cy + (y - cy) * (1 - weight * (1 - squash)))
        const sx = x
        const di = (y * w + x) * 4
        const si = (Math.max(0, Math.min(h - 1, sy)) * w + sx) * 4
        out.data[di] = src.data[si]
        out.data[di + 1] = src.data[si + 1]
        out.data[di + 2] = src.data[si + 2]
        out.data[di + 3] = src.data[si + 3]
        if (phase === 'closed' && weight > 0.55 && Math.abs(y - cy) <= Math.max(1, eye.h * 0.2)) {
          // Sample fur above eye for lid color instead of hard black bar
          const lidY = Math.max(0, eye.y - 1)
          const li = (lidY * w + x) * 4
          const a = 0.55 * weight
          out.data[di] = Math.round(out.data[di] * (1 - a) + src.data[li] * a)
          out.data[di + 1] = Math.round(out.data[di + 1] * (1 - a) + src.data[li + 1] * a)
          out.data[di + 2] = Math.round(out.data[di + 2] * (1 - a) + src.data[li + 2] * a)
        }
      }
    }
  }

  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  canvas.getContext('2d')?.putImageData(out, 0, 0)
  return canvas
}

function applyTalk(source: HTMLCanvasElement, parts: BodyParts, openAmount: number): HTMLCanvasElement {
  if (!parts.mouth) return cloneCanvas(source)
  const c = cloneCanvas(source)
  const ctx = c.getContext('2d')
  if (!ctx) return c
  const m = parts.mouth
  const maxW = Math.max(2, Math.floor(source.width * 0.3))
  const w = Math.min(m.w, maxW)
  const x = Math.floor(m.x + (m.w - w) / 2)
  const openH = Math.max(1, Math.round(Math.max(m.h, 2) * (0.4 + openAmount * 1.1)))
  const patch = document.createElement('canvas')
  patch.width = w
  patch.height = Math.max(m.h, 1)
  const pctx = patch.getContext('2d')
  if (pctx) {
    pctx.drawImage(c, x, m.y, w, m.h, 0, 0, w, m.h)
    ctx.clearRect(x, m.y, w, Math.max(m.h, openH))
    ctx.drawImage(patch, 0, 0, w, m.h, x, m.y, w, openH)
  }
  if (openAmount > 0.45) {
    ctx.fillStyle = 'rgba(25, 18, 18, 0.7)'
    ctx.fillRect(x + Math.floor(w * 0.2), m.y + Math.floor(openH * 0.35), Math.floor(w * 0.6), Math.max(1, Math.floor(openH * 0.3)))
  }
  return c
}

interface WarpOpts {
  scaleX?: number
  scaleY?: number
  tx?: number
  ty?: number
  rot?: number
}

function warp(source: HTMLCanvasElement, width: number, height: number, opts: WarpOpts): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = width
  c.height = height
  const ctx = c.getContext('2d')
  if (!ctx) return cloneCanvas(source)
  ctx.imageSmoothingEnabled = false
  ctx.clearRect(0, 0, width, height)
  ctx.save()
  ctx.translate(width / 2 + (opts.tx ?? 0), height / 2 + (opts.ty ?? 0))
  ctx.rotate(((opts.rot ?? 0) * Math.PI) / 180)
  ctx.scale(opts.scaleX ?? 1, opts.scaleY ?? 1)
  ctx.drawImage(source, -width / 2, -height / 2)
  ctx.restore()
  return c
}

function makePressCycle(source: HTMLCanvasElement, w: number, h: number): HTMLCanvasElement[] {
  return [0.15, 0.35, 0.55, 0.7, 0.45, 0.2].map((a) =>
    warp(source, w, h, { scaleX: 1 + a * 0.12, scaleY: 1 - a * 0.16, ty: Math.round(a * 2) }),
  )
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

export async function createDefaultPetSprites(): Promise<PetSpriteSet> {
  const { getDefaultPetSprites } = await import('./defaultPet')
  return getDefaultPetSprites()
}
