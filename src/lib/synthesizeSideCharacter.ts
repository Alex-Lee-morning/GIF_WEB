import type { BodyParts, Rect } from './detectParts'
import { detectParts } from './detectParts'
import type { PetSpriteSet } from '../../shared/types'
import { generatePetSprites } from './sprites'
import { loadImage, type PixelImage } from './pixelate'

interface Rgb {
  r: number
  g: number
  b: number
}

interface PartLayer {
  canvas: HTMLCanvasElement
  /** Dominant fill color inside the patch */
  fill: Rgb
}

interface PartKit {
  head: PartLayer
  torso: PartLayer
  leftLeg: PartLayer
  rightLeg: PartLayer
  leftArm: PartLayer
  rightArm: PartLayer
  leftEye: PartLayer | null
  rightEye: PartLayer | null
  mouth: PartLayer | null
  palette: {
    primary: Rgb
    secondary: Rgb
    accent: Rgb
    outline: Rgb
    highlight: Rgb
  }
  sourceParts: BodyParts
}

type ProgressFn = (message: string) => void

/**
 * AI-assisted side-walk pet:
 * 1) detect head/torso/limbs on the cartoonized photo
 * 2) extract each part as a textured layer (likeness from the image)
 * 3) rebuild a right-facing anime-pixel side model from those layers
 * 4) generate walk L/R + blink idle
 */
export async function synthesizeNewSideWalkPet(
  cartoonDataUrl: string,
  onProgress?: ProgressFn,
): Promise<PetSpriteSet> {
  onProgress?.('正在识别图片各部位（头/身/四肢）…')
  const img = await loadImage(cartoonDataUrl)
  const src = imageToCanvas(img)
  const detected = await detectParts(cartoonDataUrl, src.width, src.height)

  onProgress?.('正在按部位提取贴图并分析配色…')
  const kit = buildPartKit(src, detected)

  onProgress?.('正在生成相似的动漫像素侧面形象…')
  const { canvas, parts } = assembleSideAnimeModel(kit)
  stylizeAnimePixel(canvas, kit.palette.outline)

  const pixel = canvasToPixelImage(canvas)
  const sx = pixel.width / canvas.width
  const sy = pixel.height / canvas.height
  const scaled = scaleParts(parts, sx, sy)

  onProgress?.('正在生成左右走 / 眨眼动画…')
  return generatePetSprites(pixel, scaled, { mode: 'full' })
}

function buildPartKit(src: HTMLCanvasElement, parts: BodyParts): PartKit {
  const palette = extractPalette(src)
  const pad = (r: Rect, ratio: number) => padRect(r, ratio, src.width, src.height)

  const head = extractLayer(src, pad(parts.head, 0.08), palette.primary)
  const torso = extractLayer(src, pad(parts.torso, 0.06), palette.primary)
  const leftLeg = extractLayer(src, pad(parts.leftLeg, 0.1), palette.secondary)
  const rightLeg = extractLayer(src, pad(parts.rightLeg, 0.1), palette.secondary)
  const leftArm = extractLayer(src, pad(parts.leftArm, 0.1), palette.secondary)
  const rightArm = extractLayer(src, pad(parts.rightArm, 0.1), palette.secondary)

  return {
    head,
    torso,
    leftLeg,
    rightLeg,
    leftArm,
    rightArm,
    leftEye: parts.leftEye ? extractLayer(src, pad(parts.leftEye, 0.35), palette.accent) : null,
    rightEye: parts.rightEye ? extractLayer(src, pad(parts.rightEye, 0.35), palette.accent) : null,
    mouth: parts.mouth ? extractLayer(src, pad(parts.mouth, 0.25), palette.accent) : null,
    palette,
    sourceParts: parts,
  }
}

/**
 * Compose a 64×64 right-facing side model using extracted part textures.
 * Layout is a walkable side silhouette; textures come from the user's image.
 */
function assembleSideAnimeModel(kit: PartKit): { canvas: HTMLCanvasElement; parts: BodyParts } {
  const size = 64
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas unsupported')
  ctx.imageSmoothingEnabled = false
  ctx.clearRect(0, 0, size, size)

  const { primary, secondary, accent, highlight } = kit.palette

  // Soft underpainting so gaps match the photo palette
  fillRoundRect(ctx, 14, 28, 30, 20, 7, primary)
  fillRoundRect(ctx, 20, 36, 22, 10, 4, secondary)

  // Back (far) limbs first
  const backLegSlot = { x: 16, y: 42, w: 12, h: 18 }
  const frontLegSlot = { x: 34, y: 42, w: 12, h: 18 }
  const backArmSlot = { x: 18, y: 30, w: 10, h: 14 }
  const frontArmSlot = { x: 38, y: 30, w: 10, h: 14 }
  const torsoSlot = { x: 16, y: 24, w: 30, h: 24 }
  const headSlot = { x: 34, y: 4, w: 26, h: 26 }

  drawLayerFitted(ctx, kit.leftLeg.canvas, backLegSlot, kit.leftLeg.fill)
  drawLayerFitted(ctx, kit.leftArm.canvas, backArmSlot, kit.leftArm.fill)
  drawLayerFitted(ctx, kit.torso.canvas, torsoSlot, kit.torso.fill)
  // Belly tint from secondary for anime depth
  ctx.globalAlpha = 0.35
  fillRoundRect(ctx, 24, 36, 18, 10, 4, secondary)
  ctx.globalAlpha = 1
  drawLayerFitted(ctx, kit.rightArm.canvas, frontArmSlot, kit.rightArm.fill)
  drawLayerFitted(ctx, kit.rightLeg.canvas, frontLegSlot, kit.rightLeg.fill)

  // Head + facial features for likeness
  drawLayerFitted(ctx, kit.head.canvas, headSlot, kit.head.fill)
  if (kit.leftEye) {
    drawLayerFitted(ctx, kit.leftEye.canvas, { x: 48, y: 14, w: 6, h: 6 }, kit.leftEye.fill)
  } else {
    ctx.fillStyle = rgb(accent)
    ctx.fillRect(50, 16, 3, 3)
    ctx.fillStyle = rgb(highlight)
    ctx.fillRect(51, 16, 1, 1)
  }
  if (kit.rightEye) {
    drawLayerFitted(ctx, kit.rightEye.canvas, { x: 52, y: 15, w: 5, h: 5 }, kit.rightEye.fill)
  }
  if (kit.mouth) {
    drawLayerFitted(ctx, kit.mouth.canvas, { x: 50, y: 22, w: 8, h: 6 }, kit.mouth.fill)
  }

  // Tiny snout / nose cue from accent (anime side face)
  ctx.fillStyle = rgb(secondary)
  fillRoundRect(ctx, 52, 18, 8, 8, 2, secondary)
  ctx.fillStyle = rgb(kit.palette.outline)
  ctx.fillRect(58, 21, 2, 2)

  // Ear tip hint if head doesn't already cover
  ctx.fillStyle = rgb(accent)
  ctx.fillRect(40, 4, 6, 8)
  ctx.fillStyle = rgb(highlight)
  ctx.fillRect(41, 5, 3, 4)

  const head: Rect = headSlot
  const torso: Rect = torsoSlot
  const legs: Rect = { x: 14, y: 42, w: 36, h: 18 }
  const leftLeg: Rect = backLegSlot
  const rightLeg: Rect = frontLegSlot
  const leftArm: Rect = backArmSlot
  const rightArm: Rect = frontArmSlot
  const leftEye: Rect = { x: 48, y: 14, w: 6, h: 6 }
  const rightEye: Rect = { x: 52, y: 15, w: 5, h: 5 }
  const mouth: Rect = { x: 50, y: 22, w: 8, h: 6 }

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
    hasEyes: Boolean(kit.leftEye || kit.rightEye || kit.sourceParts.hasEyes),
    hasMouth: Boolean(kit.mouth || kit.sourceParts.hasMouth),
    fromPose: kit.sourceParts.fromPose,
    fromFace: kit.sourceParts.fromFace,
  }

  return { canvas, parts }
}

/** Anime-pixel look: posterize + dark outline on opaque edges. */
function stylizeAnimePixel(canvas: HTMLCanvasElement, outline: Rgb) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return
  const { width: w, height: h } = canvas
  const image = ctx.getImageData(0, 0, w, h)
  const { data } = image
  const levels = 7
  const step = 255 / (levels - 1)

  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 40) {
      data[i + 3] = 0
      continue
    }
    let r = data[i]
    let g = data[i + 1]
    let b = data[i + 2]
    // Slight saturation for cel look
    const max = Math.max(r, g, b)
    const min = Math.min(r, g, b)
    const mid = (max + min) / 2
    const sat = 1.18
    r = Math.max(0, Math.min(255, mid + (r - mid) * sat))
    g = Math.max(0, Math.min(255, mid + (g - mid) * sat))
    b = Math.max(0, Math.min(255, mid + (b - mid) * sat))
    data[i] = Math.round(Math.round(r / step) * step)
    data[i + 1] = Math.round(Math.round(g / step) * step)
    data[i + 2] = Math.round(Math.round(b / step) * step)
    data[i + 3] = 255
  }

  const out = new Uint8ClampedArray(data)
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = (y * w + x) * 4
      if (data[i + 3] < 128) continue
      let edge = false
      for (const [dx, dy] of [
        [-1, 0],
        [1, 0],
        [0, -1],
        [0, 1],
      ] as const) {
        if (data[((y + dy) * w + (x + dx)) * 4 + 3] < 64) {
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
  ctx.putImageData(new ImageData(out, w, h), 0, 0)
}

function extractLayer(src: HTMLCanvasElement, rect: Rect, fallback: Rgb): PartLayer {
  const w = Math.max(1, rect.w)
  const h = Math.max(1, rect.h)
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return { canvas, fill: fallback }
  ctx.imageSmoothingEnabled = false
  ctx.clearRect(0, 0, w, h)
  ctx.drawImage(src, rect.x, rect.y, w, h, 0, 0, w, h)

  // Drop near-transparent fringe
  const id = ctx.getImageData(0, 0, w, h)
  let sr = 0
  let sg = 0
  let sb = 0
  let n = 0
  for (let i = 0; i < id.data.length; i += 4) {
    if (id.data[i + 3] < 48) {
      id.data[i + 3] = 0
      continue
    }
    sr += id.data[i]
    sg += id.data[i + 1]
    sb += id.data[i + 2]
    n++
  }
  ctx.putImageData(id, 0, 0)
  const fill =
    n > 0
      ? { r: Math.round(sr / n), g: Math.round(sg / n), b: Math.round(sb / n) }
      : fallback
  return { canvas, fill }
}

function drawLayerFitted(
  ctx: CanvasRenderingContext2D,
  layer: HTMLCanvasElement,
  slot: Rect,
  fill: Rgb,
) {
  // Underpaint so thin/partial patches still read as a limb/body
  ctx.fillStyle = rgb(fill)
  ctx.globalAlpha = 0.55
  fillRoundRect(ctx, slot.x, slot.y, slot.w, slot.h, 3, fill)
  ctx.globalAlpha = 1

  const lw = layer.width
  const lh = layer.height
  if (lw < 1 || lh < 1) return

  // Contain-fit with slight overscale so photo detail fills the slot
  const scale = Math.max(slot.w / lw, slot.h / lh) * 0.96
  const dw = Math.max(1, Math.round(lw * scale))
  const dh = Math.max(1, Math.round(lh * scale))
  const dx = slot.x + Math.floor((slot.w - dw) / 2)
  const dy = slot.y + Math.floor((slot.h - dh) / 2)

  ctx.save()
  // Soft clip to slot
  ctx.beginPath()
  roundRectPath(ctx, slot.x, slot.y, slot.w, slot.h, 3)
  ctx.clip()
  ctx.imageSmoothingEnabled = false
  ctx.drawImage(layer, dx, dy, dw, dh)
  ctx.restore()
}

function extractPalette(src: HTMLCanvasElement): PartKit['palette'] {
  const ctx = src.getContext('2d', { willReadFrequently: true })
  if (!ctx) {
    return {
      primary: { r: 210, g: 140, b: 70 },
      secondary: { r: 245, g: 230, b: 210 },
      accent: { r: 150, g: 90, b: 50 },
      outline: { r: 50, g: 36, b: 28 },
      highlight: { r: 255, g: 245, b: 230 },
    }
  }
  const { data } = ctx.getImageData(0, 0, src.width, src.height)
  const counts = new Map<string, { c: Rgb; n: number }>()
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) continue
    const r = data[i]
    const g = data[i + 1]
    const b = data[i + 2]
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
  const sorted = [...counts.values()]
    .map((v) => ({
      r: Math.round(v.c.r / v.n),
      g: Math.round(v.c.g / v.n),
      b: Math.round(v.c.b / v.n),
      n: v.n,
      lum: 0.299 * (v.c.r / v.n) + 0.587 * (v.c.g / v.n) + 0.114 * (v.c.b / v.n),
    }))
    .sort((a, b) => b.n - a.n)

  if (!sorted.length) {
    return {
      primary: { r: 210, g: 140, b: 70 },
      secondary: { r: 245, g: 230, b: 210 },
      accent: { r: 150, g: 90, b: 50 },
      outline: { r: 50, g: 36, b: 28 },
      highlight: { r: 255, g: 245, b: 230 },
    }
  }

  const primary = sorted[0]
  const secondary =
    sorted.find((c) => c.lum > primary.lum + 22) ??
    sorted.find((c) => Math.abs(c.lum - primary.lum) > 18) ??
    lighten(primary, 36)
  const accent = sorted.find((c) => c.lum < primary.lum - 28) ?? darken(primary, 40)
  return {
    primary: { r: primary.r, g: primary.g, b: primary.b },
    secondary: { r: secondary.r, g: secondary.g, b: secondary.b },
    accent: { r: accent.r, g: accent.g, b: accent.b },
    outline: darken(accent, 22),
    highlight: lighten(secondary, 30),
  }
}

function padRect(r: Rect, ratio: number, maxW: number, maxH: number): Rect {
  const px = Math.round(r.w * ratio)
  const py = Math.round(r.h * ratio)
  const x = Math.max(0, r.x - px)
  const y = Math.max(0, r.y - py)
  return {
    x,
    y,
    w: Math.min(maxW - x, r.w + px * 2),
    h: Math.min(maxH - y, r.h + py * 2),
  }
}

function fillRoundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  c: Rgb,
) {
  ctx.fillStyle = rgb(c)
  roundRectPath(ctx, x, y, w, h, r)
  ctx.fill()
}

function roundRectPath(
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
  const scale = (r: Rect | null): Rect | null =>
    r
      ? {
          x: Math.floor(r.x * sx),
          y: Math.floor(r.y * sy),
          w: Math.max(1, Math.round(r.w * sx)),
          h: Math.max(1, Math.round(r.h * sy)),
        }
      : null
  return {
    ...parts,
    head: scale(parts.head)!,
    torso: scale(parts.torso)!,
    legs: scale(parts.legs)!,
    leftLeg: scale(parts.leftLeg)!,
    rightLeg: scale(parts.rightLeg)!,
    leftArm: scale(parts.leftArm)!,
    rightArm: scale(parts.rightArm)!,
    leftEye: scale(parts.leftEye),
    rightEye: scale(parts.rightEye),
    mouth: scale(parts.mouth),
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
