import type { PetSpriteSet } from '../../shared/types'
import { extractSubject, type SubjectCropMode } from './extractSubject'
import { cartoonizeImage } from './cartoonize'
import { detectParts, type BodyParts, type Rect } from './detectParts'
import { generatePetSprites } from './sprites'
import { synthesizeNewSideWalkPet } from './synthesizeSideCharacter'
import { loadImage, type PixelImage } from './pixelate'

export interface PetBuildProgress {
  (message: string): void
}

export interface PetBuildResult {
  originalDataUrl: string
  cutoutDataUrl: string
  cartoonDataUrl: string
  usedFaceCrop: boolean
  preservePose: boolean
  sprites: PetSpriteSet
}

/**
 * Upload pipeline: cutout → cartoon stylize → generate animation frames.
 * All processing stays in-renderer under this project.
 */
export async function buildPetFromUpload(
  originalDataUrl: string,
  opts: {
    cropMode?: SubjectCropMode
    /** full-body only: keep photo pose (true) or synthesize new side-walk character (false) */
    preservePose?: boolean
    pixelSize?: number
    colorCount?: number
    onProgress?: PetBuildProgress
  } = {},
): Promise<PetBuildResult> {
  const cropMode = opts.cropMode ?? 'full'
  const preservePose = opts.preservePose !== false
  const onProgress = opts.onProgress

  onProgress?.('正在抠出主体…')
  const subject = await extractSubject(originalDataUrl, onProgress, cropMode)

  const faceMode = cropMode === 'face' || subject.usedFaceCrop
  // Side-walk rebuild keeps more photo detail; pose-preserve uses flatter cel look
  onProgress?.('正在动漫像素化…')
  const cartoonCanvas = await cartoonizeImage(subject.cutoutDataUrl, {
    size: !faceMode && !preservePose
      ? Math.max(128, Math.min(192, (opts.pixelSize ?? 64) * 3))
      : Math.max(96, Math.min(160, (opts.pixelSize ?? 64) * 2)),
    levels: !faceMode && !preservePose
      ? Math.max(6, Math.min(10, Math.round((opts.colorCount ?? 24) / 3)))
      : Math.max(4, Math.min(10, Math.round((opts.colorCount ?? 24) / 4))),
    blur: !faceMode && !preservePose ? 0.9 : 1.4,
    outline: true,
  })
  const cartoonDataUrl = cartoonCanvas.toDataURL('image/png')

  let sprites: PetSpriteSet
  if (!faceMode && !preservePose) {
    sprites = await synthesizeNewSideWalkPet(cartoonDataUrl, onProgress)
  } else {
    onProgress?.('正在识别卡通形象部位…')
    const img = await loadImage(cartoonDataUrl)
    const parts = await detectParts(cartoonDataUrl, img.naturalWidth, img.naturalHeight)
    const pixel = canvasToPixelImage(cartoonCanvas)
    const pixelParts = scaleParts(parts, pixel.width / img.naturalWidth, pixel.height / img.naturalHeight)

    onProgress?.('正在生成卡通动画帧…')
    sprites = await generatePetSprites(pixel, pixelParts, {
      mode: faceMode ? 'face' : 'full',
    })
  }

  return {
    originalDataUrl,
    cutoutDataUrl: subject.cutoutDataUrl,
    cartoonDataUrl,
    usedFaceCrop: faceMode,
    preservePose: faceMode ? true : preservePose,
    sprites,
  }
}

function canvasToPixelImage(canvas: HTMLCanvasElement): PixelImage {
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('Canvas unsupported')
  const side = 64
  const small = document.createElement('canvas')
  small.width = side
  small.height = side
  const sctx = small.getContext('2d', { willReadFrequently: true })
  if (!sctx) throw new Error('Canvas unsupported')
  sctx.imageSmoothingEnabled = false
  sctx.clearRect(0, 0, side, side)
  sctx.drawImage(canvas, 0, 0, side, side)
  const { data } = sctx.getImageData(0, 0, side, side)
  return {
    width: side,
    height: side,
    data: new Uint8ClampedArray(data),
    dataUrl: small.toDataURL('image/png'),
  }
}

function scaleParts(parts: BodyParts, sx: number, sy: number): BodyParts {
  const scale = (r: Rect | null): Rect | null =>
    r
      ? {
          x: Math.max(0, Math.floor(r.x * sx)),
          y: Math.max(0, Math.floor(r.y * sy)),
          w: Math.max(1, Math.round(r.w * sx)),
          h: Math.max(1, Math.round(r.h * sy)),
        }
      : null
  return {
    leftEye: scale(parts.leftEye),
    rightEye: scale(parts.rightEye),
    mouth: scale(parts.mouth),
    head: scale(parts.head)!,
    torso: scale(parts.torso)!,
    leftArm: scale(parts.leftArm)!,
    rightArm: scale(parts.rightArm)!,
    legs: scale(parts.legs)!,
    leftLeg: scale(parts.leftLeg)!,
    rightLeg: scale(parts.rightLeg)!,
    hasEyes: parts.hasEyes,
    hasMouth: parts.hasMouth,
    fromPose: parts.fromPose,
    fromFace: parts.fromFace,
  }
}
