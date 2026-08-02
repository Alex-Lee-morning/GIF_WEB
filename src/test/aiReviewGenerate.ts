import { extractSubject } from '../lib/extractSubject'
import { drawPartsOverlay } from '../lib/detectParts'
import { bodyPartsFromAiNorm, CORGI_AI_PARTS_NORM } from '../lib/aiParts'
import { generatePetSprites } from '../lib/sprites'
import { loadImage, pixelateImage } from '../lib/pixelate'

const logEl = document.getElementById('log')!
function log(msg: string) {
  logEl.textContent += `\n${msg}`
  console.log(msg)
}

async function main() {
  logEl.textContent = ''
  log('Cursor AI 识别流程：加载 Test Image.png …')
  let res = await fetch('/Test%20Image.png')
  if (!res.ok) res = await fetch('/test%20image.png')
  if (!res.ok) throw new Error(`无法加载测试图: ${res.status}`)
  const dataUrl = await blobToDataUrl(await res.blob())

  log('抠图中…')
  const subject = await extractSubject(dataUrl, (m) => log(m), 'full')
  log(`抠图完成 ${subject.width}x${subject.height}`)

  const img = await loadImage(subject.cutoutDataUrl)
  const W = img.naturalWidth
  const H = img.naturalHeight

  log('使用 Cursor AI 手标部位（跳过 MediaPipe）…')
  log(CORGI_AI_PARTS_NORM.label)
  for (const n of CORGI_AI_PARTS_NORM.notes) log(`  · ${n}`)
  const parts = bodyPartsFromAiNorm(W, H)
  log(JSON.stringify({ head: parts.head, leftEye: parts.leftEye, rightEye: parts.rightEye, legs: parts.legs, leftLeg: parts.leftLeg, rightLeg: parts.rightLeg, leftArm: parts.leftArm, rightArm: parts.rightArm }, null, 2))

  const overlay = drawPartsOverlay(img, parts)
  downloadDataUrl(overlay.toDataURL('image/png'), 'ai-parts-overlay.png')
  downloadDataUrl(subject.cutoutDataUrl, 'ai-cutout.png')

  log('像素化 + 基于 AI 部位生成动画帧…')
  const pixel = await pixelateImage(img, 72, 32)
  const sx = pixel.width / W
  const sy = pixel.height / H
  const scale = (r: { x: number; y: number; w: number; h: number }) => ({
    x: Math.floor(r.x * sx),
    y: Math.floor(r.y * sy),
    w: Math.max(1, Math.round(r.w * sx)),
    h: Math.max(1, Math.round(r.h * sy)),
  })
  const scaleN = (r: typeof parts.leftEye) => (r ? scale(r) : null)
  const pixelParts = {
    ...parts,
    leftEye: scaleN(parts.leftEye),
    rightEye: scaleN(parts.rightEye),
    mouth: scaleN(parts.mouth),
    head: scale(parts.head),
    torso: scale(parts.torso),
    leftArm: scale(parts.leftArm),
    rightArm: scale(parts.rightArm),
    legs: scale(parts.legs),
    leftLeg: scale(parts.leftLeg),
    rightLeg: scale(parts.rightLeg),
  }

  const sprites = await generatePetSprites(pixel, pixelParts)

  downloadDataUrl(sprites.previewGifDataUrl, 'ai-preview.gif')
  downloadDataUrl(sprites.frames.idle[0], 'ai-idle-0.png')
  downloadDataUrl(sprites.frames.idle[7], 'ai-idle-blink.png')
  for (let i = 0; i < sprites.frames.dragRight.length; i++) {
    downloadDataUrl(sprites.frames.dragRight[i], `ai-walk-right-${i}.png`)
  }
  for (let i = 0; i < sprites.frames.dragLeft.length; i++) {
    downloadDataUrl(sprites.frames.dragLeft[i], `ai-walk-left-${i}.png`)
  }

  // Also emit a single review HTML payload as JSON for the runner to assemble
  const review = {
    cutout: subject.cutoutDataUrl,
    overlay: overlay.toDataURL('image/png'),
    previewGif: sprites.previewGifDataUrl,
    idle: sprites.frames.idle,
    walkRight: sprites.frames.dragRight,
    walkLeft: sprites.frames.dragLeft,
    meta: {
      pixel: `${pixel.width}x${pixel.height}`,
      cutout: `${W}x${H}`,
      label: CORGI_AI_PARTS_NORM.label,
      notes: [...CORGI_AI_PARTS_NORM.notes],
    },
  }
  ;(window as unknown as { __AI_REVIEW__: typeof review }).__AI_REVIEW__ = review
  ;(window as unknown as { __PIPELINE_RESULT__: string }).__PIPELINE_RESULT__ = 'PASS'
  log('RESULT PASS — 帧已生成，等待审阅')
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('read fail'))
    reader.readAsDataURL(blob)
  })
}

function downloadDataUrl(dataUrl: string, filename: string) {
  const a = document.createElement('a')
  a.href = dataUrl
  a.download = filename
  a.click()
}

main().catch((err) => {
  log(`ERROR ${err instanceof Error ? err.message : String(err)}`)
  ;(window as unknown as { __PIPELINE_RESULT__: string }).__PIPELINE_RESULT__ = 'FAIL'
})
