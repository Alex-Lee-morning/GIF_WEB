import { FaceLandmarker, PoseLandmarker, FilesetResolver } from '@mediapipe/tasks-vision'
import { loadImage } from './pixelate'

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export interface BodyParts {
  leftEye: Rect | null
  rightEye: Rect | null
  mouth: Rect | null
  head: Rect
  torso: Rect
  leftArm: Rect
  rightArm: Rect
  legs: Rect
  leftLeg: Rect
  rightLeg: Rect
  /** face eyes detected */
  hasEyes: boolean
  hasMouth: boolean
  /** pose body detected */
  fromPose: boolean
  fromFace: boolean
}

let visionPromise: Promise<Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>> | null> | null =
  null
let facePromise: Promise<FaceLandmarker | null> | null = null
let posePromise: Promise<PoseLandmarker | null> | null = null

function wasmBaseUrl(): string {
  return new URL('mediapipe/wasm', window.location.href).href.replace(/\/?$/, '/')
}

async function getVision() {
  if (!visionPromise) {
    visionPromise = FilesetResolver.forVisionTasks(wasmBaseUrl()).catch((err) => {
      console.warn('Vision wasm failed', err)
      return null
    })
  }
  return visionPromise
}

async function getFaceLandmarker(): Promise<FaceLandmarker | null> {
  if (!facePromise) {
    facePromise = (async () => {
      try {
        const vision = await getVision()
        if (!vision) return null
        return await FaceLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: new URL('mediapipe/face_landmarker.task', window.location.href).href,
            delegate: 'CPU',
          },
          runningMode: 'IMAGE',
          numFaces: 1,
        })
      } catch (err) {
        console.warn('FaceLandmarker init failed', err)
        return null
      }
    })()
  }
  return facePromise
}

async function getPoseLandmarker(): Promise<PoseLandmarker | null> {
  if (!posePromise) {
    posePromise = (async () => {
      try {
        const vision = await getVision()
        if (!vision) return null
        return await PoseLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: new URL(
              'mediapipe/pose_landmarker_lite.task',
              window.location.href,
            ).href,
            delegate: 'CPU',
          },
          runningMode: 'IMAGE',
          numPoses: 1,
        })
      } catch (err) {
        console.warn('PoseLandmarker init failed', err)
        return null
      }
    })()
  }
  return posePromise
}

/** BlazePose landmark indices */
/** BlazePose landmark indices */
const NOSE = 0
const LEFT_SHOULDER = 11
const RIGHT_SHOULDER = 12
const LEFT_ELBOW = 13
const RIGHT_ELBOW = 14
const LEFT_WRIST = 15
const RIGHT_WRIST = 16
const LEFT_HIP = 23
const RIGHT_HIP = 24

const FACE_LEFT_EYE = [33, 133, 160, 159, 158, 144, 145, 153]
const FACE_RIGHT_EYE = [362, 263, 387, 386, 385, 373, 374, 380]
const FACE_MOUTH = [61, 291, 0, 17, 13, 14]
const FACE_OVAL = [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109]

export interface FaceCropBox {
  x: number
  y: number
  width: number
  height: number
  source: 'mediapipe' | 'browser' | 'heuristic'
}

/**
 * Find a face/head crop for 「仅脸部」mode.
 * MediaPipe → Chromium FaceDetector → upper opaque silhouette (pets/anime).
 * Always returns a usable box when the image has opaque pixels.
 */
export async function detectFaceCropBox(
  imageSource: HTMLImageElement | HTMLCanvasElement | string,
  canvasWidth: number,
  canvasHeight: number,
): Promise<FaceCropBox | null> {
  const img =
    typeof imageSource === 'string' ? await loadImage(imageSource) : imageSource

  const face = await getFaceLandmarker()
  if (face) {
    try {
      const result = face.detect(img as HTMLImageElement)
      const lm = result.faceLandmarks?.[0]
      if (lm && lm.length > 0) {
        const oval = padRect(
          bboxFromIndices(lm, FACE_OVAL, canvasWidth, canvasHeight),
          0.18,
          canvasWidth,
          canvasHeight,
        )
        if (oval.w >= 8 && oval.h >= 8) {
          return { x: oval.x, y: oval.y, width: oval.w, height: oval.h, source: 'mediapipe' }
        }
      }
    } catch (err) {
      console.warn('MediaPipe face crop failed', err)
    }
  }

  const FaceDetectorCtor = (
    window as unknown as {
      FaceDetector?: new (opts?: { fastMode?: boolean; maxDetectedFaces?: number }) => {
        detect: (source: CanvasImageSource) => Promise<Array<{ boundingBox: DOMRectReadOnly }>>
      }
    }
  ).FaceDetector

  if (FaceDetectorCtor) {
    try {
      const detector = new FaceDetectorCtor({ fastMode: false, maxDetectedFaces: 5 })
      const faces = await detector.detect(img as HTMLImageElement)
      if (faces.length) {
        let best = faces[0].boundingBox
        let bestArea = best.width * best.height
        for (const f of faces.slice(1)) {
          const b = f.boundingBox
          const a = b.width * b.height
          if (a > bestArea) {
            best = b
            bestArea = a
          }
        }
        const x = Math.max(0, Math.min(canvasWidth - 1, Math.floor(best.x)))
        const y = Math.max(0, Math.min(canvasHeight - 1, Math.floor(best.y)))
        const width = Math.min(canvasWidth - x, Math.ceil(best.width))
        const height = Math.min(canvasHeight - y, Math.ceil(best.height))
        if (width >= 8 && height >= 8) {
          return { x, y, width, height, source: 'browser' }
        }
      }
    } catch (err) {
      console.warn('Browser FaceDetector failed', err)
    }
  }

  // Pets / stylized: take upper opaque region as "face"
  const subject = opaqueBounds(img, canvasWidth, canvasHeight)
  if (!subject || subject.w < 8 || subject.h < 8) return null
  const faceH = Math.max(16, Math.floor(subject.h * (subject.h / subject.w > 1.35 ? 0.48 : 0.62)))
  return {
    x: subject.x,
    y: subject.y,
    width: subject.w,
    height: Math.min(subject.h, faceH),
    source: 'heuristic',
  }
}

/**
 * Detect body parts using Pose (primary) + Face (eyes/mouth optional).
 */
export async function detectParts(
  imageSource: HTMLImageElement | HTMLCanvasElement | string,
  canvasWidth: number,
  canvasHeight: number,
): Promise<BodyParts> {
  const img =
    typeof imageSource === 'string' ? await loadImage(imageSource) : imageSource

  const subject = opaqueBounds(img, canvasWidth, canvasHeight) ?? {
    x: 0,
    y: 0,
    w: canvasWidth,
    h: canvasHeight,
  }

  let fromPose = false
  let fromFace = false
  let head: Rect | null = null
  let torso: Rect | null = null
  let leftArm: Rect | null = null
  let rightArm: Rect | null = null
  let leftLeg: Rect | null = null
  let rightLeg: Rect | null = null
  let legs: Rect | null = null
  let leftEye: Rect | null = null
  let rightEye: Rect | null = null
  let mouth: Rect | null = null

  const pose = await getPoseLandmarker()
  if (pose) {
    try {
      const result = pose.detect(img as HTMLImageElement)
      const lm = result.landmarks?.[0]
      if (lm && lm.length >= 29) {
        fromPose = true
        const pt = (i: number) => ({
          x: lm[i].x * canvasWidth,
          y: lm[i].y * canvasHeight,
          v: lm[i].visibility ?? 1,
        })

        const nose = pt(NOSE)
        const lShoulder = pt(LEFT_SHOULDER)
        const rShoulder = pt(RIGHT_SHOULDER)
        const lHip = pt(LEFT_HIP)
        const rHip = pt(RIGHT_HIP)
        const lElbow = pt(LEFT_ELBOW)
        const rElbow = pt(RIGHT_ELBOW)
        const lWrist = pt(LEFT_WRIST)
        const rWrist = pt(RIGHT_WRIST)

        const shoulderY = (lShoulder.y + rShoulder.y) / 2
        const hipY = (lHip.y + rHip.y) / 2
        const shoulderSpan = Math.max(24, Math.abs(lShoulder.x - rShoulder.x))
        const subjBottom = subject.y + subject.h

        head = clampRect(
          {
            x: subject.x + subject.w * 0.12,
            y: subject.y,
            w: subject.w * 0.76,
            h: Math.max(8, Math.min(shoulderY, nose.y + shoulderSpan * 0.35) - subject.y + shoulderSpan * 0.15),
          },
          canvasWidth,
          canvasHeight,
        )

        // Torso: shoulders → mid/hips, widened to silhouette
        const torsoBottom = Math.max(hipY, subject.y + subject.h * 0.55)
        torso = clampRect(
          {
            x: subject.x + subject.w * 0.1,
            y: Math.min(shoulderY, head.y + head.h * 0.9),
            w: subject.w * 0.8,
            h: Math.max(torsoBottom - shoulderY, subject.h * 0.22),
          },
          canvasWidth,
          canvasHeight,
        )

        // Legs: to feet of cutout
        const legsTop = Math.min(Math.max(hipY, torso.y + torso.h * 0.75), subjBottom - 24)
        legs = clampRect(
          {
            x: subject.x + subject.w * 0.12,
            y: legsTop,
            w: subject.w * 0.76,
            h: subjBottom - legsTop,
          },
          canvasWidth,
          canvasHeight,
        )
        const half = Math.floor(legs.w / 2)
        leftLeg = { x: legs.x, y: legs.y, w: half, h: legs.h }
        rightLeg = { x: legs.x + half, y: legs.y, w: legs.w - half, h: legs.h }

        leftArm = clampRect(
          {
            x: Math.max(subject.x, Math.min(lShoulder.x, lWrist.x, lElbow.x) - 12),
            y: Math.max(subject.y, Math.min(lShoulder.y, lWrist.y, lElbow.y) - 8),
            w: Math.abs(lShoulder.x - Math.max(lWrist.x, lElbow.x)) + 28,
            h: Math.abs(Math.max(lWrist.y, lElbow.y) - lShoulder.y) + 28,
          },
          canvasWidth,
          canvasHeight,
        )
        rightArm = clampRect(
          {
            x: Math.max(subject.x, Math.min(rShoulder.x, rWrist.x, rElbow.x) - 12),
            y: Math.max(subject.y, Math.min(rShoulder.y, rWrist.y, rElbow.y) - 8),
            w: Math.abs(rShoulder.x - Math.max(rWrist.x, rElbow.x)) + 28,
            h: Math.abs(Math.max(rWrist.y, rElbow.y) - rShoulder.y) + 28,
          },
          canvasWidth,
          canvasHeight,
        )

        // Eyes only from Face Landmarker later
        leftEye = null
        rightEye = null
      }
    } catch (err) {
      console.warn('Pose detect failed', err)
    }
  }

  const face = await getFaceLandmarker()
  if (face) {
    try {
      const result = face.detect(img as HTMLImageElement)
      const lm = result.faceLandmarks?.[0]
      if (lm && lm.length > 0) {
        fromFace = true
        leftEye = clampEye(
          padRect(bboxFromIndices(lm, FACE_LEFT_EYE, canvasWidth, canvasHeight), 0.12, canvasWidth, canvasHeight),
          canvasWidth,
        )
        rightEye = clampEye(
          padRect(bboxFromIndices(lm, FACE_RIGHT_EYE, canvasWidth, canvasHeight), 0.12, canvasWidth, canvasHeight),
          canvasWidth,
        )
        mouth = clampMouth(
          padRect(bboxFromIndices(lm, FACE_MOUTH, canvasWidth, canvasHeight), 0.15, canvasWidth, canvasHeight),
          canvasWidth,
        )
        if (!head) {
          head = padRect(bboxFromIndices(lm, FACE_OVAL, canvasWidth, canvasHeight), 0.1, canvasWidth, canvasHeight)
        }
      }
    } catch (err) {
      console.warn('Face detect failed', err)
    }
  }

  // Alpha-based fallback / fill gaps for full-body cutouts (e.g. anime characters)
  if (!fromPose) {
    const sliced = sliceFromAlpha(subject)
    head = head ?? sliced.head
    torso = torso ?? sliced.torso
    legs = legs ?? sliced.legs
    leftLeg = leftLeg ?? sliced.leftLeg
    rightLeg = rightLeg ?? sliced.rightLeg
    leftArm = leftArm ?? sliced.leftArm
    rightArm = rightArm ?? sliced.rightArm
  } else {
    // Ensure arms/legs exist
    const sliced = sliceFromAlpha(subject)
    leftArm = leftArm ?? sliced.leftArm
    rightArm = rightArm ?? sliced.rightArm
    if (!legs || legs.h < 4) legs = sliced.legs
    if (!leftLeg) leftLeg = sliced.leftLeg
    if (!rightLeg) rightLeg = sliced.rightLeg
    if (!torso) torso = sliced.torso
    if (!head) head = sliced.head
  }

  // Animals / stylized faces: Face Landmarker often misses eyes — scan face zone for dark spots
  if ((!leftEye || !rightEye) && subject) {
    const faceZone = {
      x: subject.x + Math.floor(subject.w * 0.08),
      y: subject.y,
      w: Math.floor(subject.w * 0.84),
      // Dog eyes sit below ears — search upper ~55% of silhouette, not tiny head slice
      h: Math.floor(subject.h * 0.55),
    }
    const guessed = guessEyesFromHead(img, faceZone, canvasWidth, canvasHeight)
    if (guessed) {
      leftEye = guessed.left
      rightEye = guessed.right
    }
  }

  const hasEyes = Boolean(
    leftEye && rightEye && leftEye.w <= canvasWidth * 0.25 && rightEye.w <= canvasWidth * 0.25,
  )
  const hasMouth = Boolean(fromFace && mouth && mouth.w <= canvasWidth * 0.4)

  return {
    leftEye: hasEyes ? leftEye : null,
    rightEye: hasEyes ? rightEye : null,
    mouth: hasMouth ? mouth : null,
    head: head!,
    torso: torso!,
    leftArm: leftArm!,
    rightArm: rightArm!,
    legs: legs!,
    leftLeg: leftLeg!,
    rightLeg: rightLeg!,
    hasEyes,
    hasMouth,
    fromPose,
    fromFace,
  }
}

function guessEyesFromHead(
  img: CanvasImageSource,
  head: Rect,
  canvasWidth: number,
  canvasHeight: number,
): { left: Rect; right: Rect } | null {
  const canvas = document.createElement('canvas')
  canvas.width = canvasWidth
  canvas.height = canvasHeight
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null
  ctx.drawImage(img as CanvasImageSource, 0, 0, canvasWidth, canvasHeight)
  const { data } = ctx.getImageData(0, 0, canvasWidth, canvasHeight)

  // Search mid face band (below ear tips, above muzzle tip)
  const y0 = head.y + Math.floor(head.h * 0.22)
  const y1 = head.y + Math.floor(head.h * 0.72)
  const x0 = head.x + Math.floor(head.w * 0.1)
  const x1 = head.x + Math.floor(head.w * 0.9)
  if (y1 <= y0 || x1 <= x0) return null

  type Spot = { x: number; y: number; score: number }
  const spots: Spot[] = []
  const step = Math.max(1, Math.floor(Math.min(head.w, head.h) / 64))
  for (let y = y0; y < y1; y += step) {
    for (let x = x0; x < x1; x += step) {
      const i = (y * canvasWidth + x) * 4
      const a = data[i + 3]
      if (a < 128) continue
      const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
      // Dog eyes are dark brown/black; keep threshold loose after compression
      if (lum > 95) continue
      let darker = 0
      let localSum = 0
      let localN = 0
      for (let dy = -2 * step; dy <= 2 * step; dy += step) {
        for (let dx = -2 * step; dx <= 2 * step; dx += step) {
          if (dx === 0 && dy === 0) continue
          const nx = x + dx
          const ny = y + dy
          if (nx < x0 || nx >= x1 || ny < y0 || ny >= y1) continue
          const ni = (ny * canvasWidth + nx) * 4
          if (data[ni + 3] < 128) continue
          const nl = 0.299 * data[ni] + 0.587 * data[ni + 1] + 0.114 * data[ni + 2]
          localSum += nl
          localN++
          if (lum + 12 < nl) darker++
        }
      }
      const localAvg = localN > 0 ? localSum / localN : 255
      if (darker < 2 && lum > localAvg - 18) continue
      spots.push({ x, y, score: localAvg - lum + darker * 4 })
    }
  }
  if (spots.length < 2) return null
  spots.sort((a, b) => b.score - a.score)

  // Pick two darkest spots that are horizontally separated
  let best: { left: Spot; right: Spot; score: number } | null = null
  const top = spots.slice(0, Math.min(40, spots.length))
  for (let i = 0; i < top.length; i++) {
    for (let j = i + 1; j < top.length; j++) {
      const a = top[i]
      const b = top[j]
      const dx = Math.abs(a.x - b.x)
      const dy = Math.abs(a.y - b.y)
      if (dx < head.w * 0.12 || dx > head.w * 0.7) continue
      if (dy > head.h * 0.22) continue
      const score = a.score + b.score + dx
      if (!best || score > best.score) {
        const left = a.x <= b.x ? a : b
        const right = a.x <= b.x ? b : a
        best = { left, right, score }
      }
    }
  }
  if (!best) return null

  const eyeW = Math.max(3, Math.floor(head.w * 0.1))
  const eyeH = Math.max(2, Math.floor(head.h * 0.1))
  const left = clampRect(
    { x: best.left.x - Math.floor(eyeW / 2), y: best.left.y - Math.floor(eyeH / 2), w: eyeW, h: eyeH },
    canvasWidth,
    canvasHeight,
  )
  const right = clampRect(
    { x: best.right.x - Math.floor(eyeW / 2), y: best.right.y - Math.floor(eyeH / 2), w: eyeW, h: eyeH },
    canvasWidth,
    canvasHeight,
  )
  return { left, right }
}

function sliceFromAlpha(subject: Rect): {
  head: Rect
  torso: Rect
  legs: Rect
  leftLeg: Rect
  rightLeg: Rect
  leftArm: Rect
  rightArm: Rect
} {
  const headH = Math.max(8, Math.floor(subject.h * 0.28))
  const torsoH = Math.max(8, Math.floor(subject.h * 0.32))
  const head = { x: subject.x, y: subject.y, w: subject.w, h: headH }
  const torso = {
    x: subject.x + Math.floor(subject.w * 0.12),
    y: subject.y + headH,
    w: Math.floor(subject.w * 0.76),
    h: torsoH,
  }
  const legsY = subject.y + headH + torsoH
  const legsH = Math.max(8, subject.y + subject.h - legsY)
  const legs = { x: subject.x + Math.floor(subject.w * 0.15), y: legsY, w: Math.floor(subject.w * 0.7), h: legsH }
  const half = Math.floor(legs.w / 2)
  const leftLeg = { x: legs.x, y: legs.y, w: half, h: legs.h }
  const rightLeg = { x: legs.x + half, y: legs.y, w: legs.w - half, h: legs.h }
  const armW = Math.max(4, Math.floor(subject.w * 0.22))
  const armH = Math.max(8, Math.floor(subject.h * 0.35))
  const leftArm = { x: subject.x, y: subject.y + Math.floor(headH * 0.7), w: armW, h: armH }
  const rightArm = {
    x: subject.x + subject.w - armW,
    y: subject.y + Math.floor(headH * 0.7),
    w: armW,
    h: armH,
  }
  return { head, torso, legs, leftLeg, rightLeg, leftArm, rightArm }
}

function clampRect(r: Rect, maxW: number, maxH: number): Rect {
  const x = Math.max(0, Math.floor(r.x))
  const y = Math.max(0, Math.floor(r.y))
  return {
    x,
    y,
    w: Math.max(1, Math.min(maxW - x, Math.ceil(r.w))),
    h: Math.max(1, Math.min(maxH - y, Math.ceil(r.h))),
  }
}

function bboxFromIndices(
  landmarks: Array<{ x: number; y: number }>,
  indices: number[],
  width: number,
  height: number,
): Rect {
  let minX = 1
  let minY = 1
  let maxX = 0
  let maxY = 0
  for (const i of indices) {
    const p = landmarks[i]
    if (!p) continue
    minX = Math.min(minX, p.x)
    minY = Math.min(minY, p.y)
    maxX = Math.max(maxX, p.x)
    maxY = Math.max(maxY, p.y)
  }
  return {
    x: Math.floor(minX * width),
    y: Math.floor(minY * height),
    w: Math.max(1, Math.ceil((maxX - minX) * width)),
    h: Math.max(1, Math.ceil((maxY - minY) * height)),
  }
}

function padRect(r: Rect, pad: number, maxW: number, maxH: number): Rect {
  const px = Math.max(1, Math.round(r.w * pad))
  const py = Math.max(1, Math.round(r.h * pad))
  return clampRect({ x: r.x - px, y: r.y - py, w: r.w + px * 2, h: r.h + py * 2 }, maxW, maxH)
}

function clampEye(r: Rect, canvasW: number): Rect {
  const maxW = Math.max(2, Math.floor(canvasW * 0.18))
  if (r.w <= maxW) return r
  const cx = r.x + r.w / 2
  return { x: Math.max(0, Math.floor(cx - maxW / 2)), y: r.y, w: maxW, h: Math.max(1, Math.min(r.h, Math.floor(maxW * 0.7))) }
}

function clampMouth(r: Rect, canvasW: number): Rect {
  const maxW = Math.max(3, Math.floor(canvasW * 0.32))
  if (r.w <= maxW) return r
  const cx = r.x + r.w / 2
  return { x: Math.max(0, Math.floor(cx - maxW / 2)), y: r.y, w: maxW, h: Math.max(1, r.h) }
}

function opaqueBounds(
  img: HTMLImageElement | HTMLCanvasElement,
  targetW: number,
  targetH: number,
): Rect | null {
  const canvas = document.createElement('canvas')
  canvas.width = targetW
  canvas.height = targetH
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null
  ctx.drawImage(img as CanvasImageSource, 0, 0, targetW, targetH)
  const { data, width, height } = ctx.getImageData(0, 0, targetW, targetH)
  let minX = width
  let minY = height
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] > 24) {
        if (x < minX) minX = x
        if (y < minY) minY = y
        if (x > maxX) maxX = x
        if (y > maxY) maxY = y
      }
    }
  }
  if (maxX < minX) return null
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 }
}

/** Draw debug overlay of parts for testing */
export function drawPartsOverlay(
  source: HTMLCanvasElement | HTMLImageElement,
  parts: BodyParts,
): HTMLCanvasElement {
  const w = 'naturalWidth' in source ? source.naturalWidth : source.width
  const h = 'naturalHeight' in source ? source.naturalHeight : source.height
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d')!
  ctx.drawImage(source as CanvasImageSource, 0, 0)
  const draw = (r: Rect | null, color: string, label: string) => {
    if (!r) return
    ctx.strokeStyle = color
    ctx.lineWidth = Math.max(2, Math.floor(w / 200))
    ctx.strokeRect(r.x, r.y, r.w, r.h)
    ctx.fillStyle = color
    ctx.font = `${Math.max(12, Math.floor(w / 40))}px sans-serif`
    ctx.fillText(label, r.x + 2, Math.max(12, r.y - 4))
  }
  draw(parts.head, '#00e5ff', 'head')
  draw(parts.torso, '#76ff03', 'torso')
  draw(parts.leftArm, '#ffea00', 'L-arm')
  draw(parts.rightArm, '#ff9100', 'R-arm')
  draw(parts.leftLeg, '#e040fb', 'L-leg')
  draw(parts.rightLeg, '#7c4dff', 'R-leg')
  draw(parts.legs, '#f50057', 'legs')
  draw(parts.leftEye, '#ffffff', 'L-eye')
  draw(parts.rightEye, '#ffffff', 'R-eye')
  draw(parts.mouth, '#ff1744', 'mouth')
  return c
}
