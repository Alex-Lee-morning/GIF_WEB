import type { BodyParts, Rect } from './detectParts'
import type { PetSpriteSet } from '../../shared/types'
import { generatePetSprites } from './sprites'
import { loadImage, type PixelImage } from './pixelate'

interface Rgb {
  r: number
  g: number
  b: number
}

interface CartoonAnalysis {
  primary: Rgb
  secondary: Rgb
  accent: Rgb
  outline: Rgb
  highlight: Rgb
  eye: Rgb
  /** Soft face stamp from upper source (optional likeness) */
  faceStamp: HTMLCanvasElement | null
}

/**
 * Build a brand-new side-facing cartoon pet from the user's cartoonized cutout
 * (does NOT paste onto the default dog). Then generate walk L/R + blink idle.
 */
export async function synthesizeNewSideWalkPet(cartoonDataUrl: string): Promise<PetSpriteSet> {
  const img = await loadImage(cartoonDataUrl)
  const src = imageToCanvas(img)
  const analysis = analyzeCartoon(src)
  const { canvas, parts } = drawNewSideCharacter(analysis)
  const pixel = canvasToPixelImage(canvas)
  const sx = pixel.width / canvas.width
  const sy = pixel.height / canvas.height
  const scaled = scaleParts(parts, sx, sy)
  return generatePetSprites(pixel, scaled, { mode: 'full' })
}

function analyzeCartoon(src: HTMLCanvasElement): CartoonAnalysis {
  const ctx = src.getContext('2d', { willReadFrequently: true })
  if (!ctx) {
    return fallbackAnalysis()
  }
  const { data, width, height } = ctx.getImageData(0, 0, src.width, src.height)
  const counts = new Map<string, { c: Rgb; n: number }>()
  let minX = width
  let minY = height
  let maxX = 0
  let maxY = 0

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      if (data[i + 3] < 128) continue
      minX = Math.min(minX, x)
      minY = Math.min(minY, y)
      maxX = Math.max(maxX, x)
      maxY = Math.max(maxY, y)
      const r = data[i]
      const g = data[i + 1]
      const b = data[i + 2]
      // quantize for palette clustering
      const key = `${r >> 4},${g >> 4},${b >> 4}`
      const cur = counts.get(key)
      if (cur) {
        cur.n++
        cur.c.r += r
        cur.c.g += g
        cur.c.b += b
      } else {
        counts.set(key, { c: { r, g, b }, n: 1 })
      }
    }
  }

  const sorted = [...counts.values()]
    .map((v) => ({
      r: Math.round(v.c.r / v.n),
      g: Math.round(v.c.g / v.n),
      b: Math.round(v.c.b / v.n),
      n: v.n,
      lum: 0.299 * (v.c.r / v.n) + 0.587 * (v.c.g / v.n) + 0.114 * (v.c.b / v.n),
    }))
    .sort((a, b) => b.n - a.n)

  if (sorted.length === 0) return fallbackAnalysis()

  const primary = sorted[0]
  const secondary =
    sorted.find((c) => c.lum > primary.lum + 25) ??
    sorted.find((c) => Math.abs(c.lum - primary.lum) > 20) ??
    lighten(primary, 40)
  const accent = sorted.find((c) => c.lum < primary.lum - 30) ?? darken(primary, 45)
  const outline = darken(accent, 25)
  const highlight = lighten(secondary, 35)
  const eye = sorted.find((c) => c.lum < 70) ?? { r: 30, g: 24, b: 22 }

  // Face stamp: upper 45% of opaque subject, side-cropped to rightish for profile feel
  let faceStamp: HTMLCanvasElement | null = null
  if (maxX > minX && maxY > minY) {
    const bw = maxX - minX + 1
    const bh = maxY - minY + 1
    const fy = minY
    const fh = Math.max(8, Math.floor(bh * 0.48))
    const fx = minX + Math.floor(bw * 0.15)
    const fw = Math.max(8, Math.floor(bw * 0.7))
    faceStamp = document.createElement('canvas')
    faceStamp.width = 32
    faceStamp.height = 28
    const fctx = faceStamp.getContext('2d')
    if (fctx) {
      fctx.imageSmoothingEnabled = false
      fctx.clearRect(0, 0, 32, 28)
      fctx.drawImage(src, fx, fy, fw, fh, 0, 0, 32, 28)
      // Force cartoon levels again lightly
      const id = fctx.getImageData(0, 0, 32, 28)
      for (let i = 0; i < id.data.length; i += 4) {
        if (id.data[i + 3] < 100) {
          id.data[i + 3] = 0
          continue
        }
        id.data[i] = Math.round(id.data[i] / 32) * 32
        id.data[i + 1] = Math.round(id.data[i + 1] / 32) * 32
        id.data[i + 2] = Math.round(id.data[i + 2] / 32) * 32
        id.data[i + 3] = 255
      }
      fctx.putImageData(id, 0, 0)
    }
  }

  return {
    primary: { r: primary.r, g: primary.g, b: primary.b },
    secondary: { r: secondary.r, g: secondary.g, b: secondary.b },
    accent: { r: accent.r, g: accent.g, b: accent.b },
    outline,
    highlight: { r: highlight.r, g: highlight.g, b: highlight.b },
    eye: { r: eye.r, g: eye.g, b: eye.b },
    faceStamp,
  }
}

function drawNewSideCharacter(a: CartoonAnalysis): { canvas: HTMLCanvasElement; parts: BodyParts } {
  const size = 64
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas unsupported')
  ctx.imageSmoothingEnabled = false
  ctx.clearRect(0, 0, size, size)

  const fill = (c: Rgb) => {
    ctx.fillStyle = rgb(c)
  }
  const stroke = (c: Rgb) => {
    ctx.strokeStyle = rgb(c)
  }

  // === Brand-new side profile facing RIGHT (not the default dog mesh) ===
  // Legs (back then front)
  fill(a.secondary)
  ctx.fillRect(18, 46, 6, 14) // back leg
  ctx.fillRect(22, 48, 5, 12)
  ctx.fillRect(34, 46, 6, 14) // front leg
  ctx.fillRect(38, 48, 5, 12)
  fill(a.highlight)
  ctx.fillRect(18, 56, 6, 4) // paws
  ctx.fillRect(34, 56, 6, 4)

  // Tail
  fill(a.primary)
  ctx.fillRect(10, 34, 8, 6)
  ctx.fillRect(8, 30, 5, 6)

  // Torso (loaf / side body)
  fill(a.primary)
  roundRect(ctx, 16, 26, 28, 22, 6)
  fill(a.secondary)
  roundRect(ctx, 22, 34, 20, 12, 4) // belly

  // Neck
  fill(a.primary)
  ctx.fillRect(38, 24, 8, 10)

  // Head
  fill(a.primary)
  roundRect(ctx, 36, 8, 22, 22, 8)
  // Snout
  fill(a.secondary)
  roundRect(ctx, 50, 18, 10, 10, 3)
  // Ear
  fill(a.accent)
  ctx.fillRect(40, 4, 7, 10)
  fill(a.highlight)
  ctx.fillRect(42, 6, 3, 5)

  // Soft face stamp for likeness (clipped to head)
  if (a.faceStamp) {
    ctx.save()
    ctx.beginPath()
    ctx.arc(48, 18, 9, 0, Math.PI * 2)
    ctx.clip()
    ctx.globalAlpha = 0.55
    ctx.drawImage(a.faceStamp, 40, 8, 20, 18)
    ctx.globalAlpha = 1
    ctx.restore()
  }

  // Eye (open)
  fill(a.eye)
  ctx.fillRect(52, 16, 3, 3)
  fill(a.highlight)
  ctx.fillRect(53, 16, 1, 1)

  // Nose
  fill(a.outline)
  ctx.fillRect(58, 20, 2, 2)

  // Mouth
  stroke(a.outline)
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(54, 24)
  ctx.lineTo(58, 25)
  ctx.stroke()

  // Outline pass for silhouette readability
  outlineOpaque(ctx, size, a.outline)

  const head: Rect = { x: 36, y: 4, w: 24, h: 26 }
  const torso: Rect = { x: 16, y: 26, w: 28, h: 22 }
  const legs: Rect = { x: 16, y: 44, w: 30, h: 16 }
  const leftLeg: Rect = { x: 16, y: 44, w: 14, h: 16 }
  const rightLeg: Rect = { x: 32, y: 44, w: 14, h: 16 }
  const leftEye: Rect = { x: 50, y: 14, w: 5, h: 5 }
  const rightEye: Rect = { x: 52, y: 15, w: 4, h: 4 }
  const mouth: Rect = { x: 52, y: 22, w: 8, h: 5 }
  const leftArm: Rect = { x: 16, y: 28, w: 8, h: 12 }
  const rightArm: Rect = { x: 40, y: 28, w: 8, h: 12 }

  const parts: BodyParts = {
    head,
    torso,
    legs,
    leftLeg,
    rightLeg,
    leftArm,
    rightArm,
    leftEye,
    rightEye,
    mouth,
    hasEyes: true,
    hasMouth: true,
    fromPose: true,
    fromFace: true,
  }

  return { canvas, parts }
}

function outlineOpaque(ctx: CanvasRenderingContext2D, size: number, outline: Rgb) {
  const { data } = ctx.getImageData(0, 0, size, size)
  const out = new Uint8ClampedArray(data)
  for (let y = 1; y < size - 1; y++) {
    for (let x = 1; x < size - 1; x++) {
      const i = (y * size + x) * 4
      if (data[i + 3] < 128) continue
      let edge = false
      for (const [dx, dy] of [
        [-1, 0],
        [1, 0],
        [0, -1],
        [0, 1],
      ] as const) {
        if (data[((y + dy) * size + (x + dx)) * 4 + 3] < 64) {
          edge = true
          break
        }
      }
      if (edge) {
        out[i] = outline.r
        out[i + 1] = outline.g
        out[i + 2] = outline.b
        out[i + 3] = 255
      }
    }
  }
  ctx.putImageData(new ImageData(out, size, size), 0, 0)
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  const rr = Math.min(r, Math.floor(w / 2), Math.floor(h / 2))
  ctx.beginPath()
  ctx.moveTo(x + rr, y)
  ctx.arcTo(x + w, y, x + w, y + h, rr)
  ctx.arcTo(x + w, y + h, x, y + h, rr)
  ctx.arcTo(x, y + h, x, y, rr)
  ctx.arcTo(x, y, x + w, y, rr)
  ctx.closePath()
  ctx.fill()
}

function canvasToPixelImage(canvas: HTMLCanvasElement): PixelImage {
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('Canvas unsupported')
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height)
  return {
    width: canvas.width,
    height: canvas.height,
    data: new Uint8ClampedArray(data),
    dataUrl: canvas.toDataURL('image/png'),
  }
}

function scaleParts(parts: BodyParts, sx: number, sy: number): BodyParts {
  const scale = (r: Rect): Rect => ({
    x: Math.floor(r.x * sx),
    y: Math.floor(r.y * sy),
    w: Math.max(1, Math.round(r.w * sx)),
    h: Math.max(1, Math.round(r.h * sy)),
  })
  return {
    ...parts,
    head: scale(parts.head),
    torso: scale(parts.torso),
    legs: scale(parts.legs),
    leftLeg: scale(parts.leftLeg),
    rightLeg: scale(parts.rightLeg),
    leftArm: scale(parts.leftArm),
    rightArm: scale(parts.rightArm),
    leftEye: parts.leftEye ? scale(parts.leftEye) : null,
    rightEye: parts.rightEye ? scale(parts.rightEye) : null,
    mouth: parts.mouth ? scale(parts.mouth) : null,
  }
}

function imageToCanvas(img: HTMLImageElement): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = img.naturalWidth || img.width
  c.height = img.naturalHeight || img.height
  const ctx = c.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('Canvas unsupported')
  ctx.drawImage(img, 0, 0)
  return c
}

function rgb(c: Rgb): string {
  return `rgb(${c.r},${c.g},${c.b})`
}

function lighten(c: Rgb, amt: number): Rgb {
  return {
    r: Math.min(255, c.r + amt),
    g: Math.min(255, c.g + amt),
    b: Math.min(255, c.b + amt),
  }
}

function darken(c: Rgb, amt: number): Rgb {
  return {
    r: Math.max(0, c.r - amt),
    g: Math.max(0, c.g - amt),
    b: Math.max(0, c.b - amt),
  }
}

function fallbackAnalysis(): CartoonAnalysis {
  return {
    primary: { r: 210, g: 140, b: 70 },
    secondary: { r: 245, g: 230, b: 210 },
    accent: { r: 150, g: 90, b: 50 },
    outline: { r: 60, g: 40, b: 30 },
    highlight: { r: 255, g: 245, b: 230 },
    eye: { r: 30, g: 24, b: 22 },
    faceStamp: null,
  }
}
