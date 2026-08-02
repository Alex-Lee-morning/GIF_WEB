import { extractSubject } from '../lib/extractSubject'
import { detectParts, drawPartsOverlay } from '../lib/detectParts'
import { generatePetSprites } from '../lib/sprites'
import { loadImage, pixelateImage } from '../lib/pixelate'

const logEl = document.getElementById('log')!
function log(msg: string) {
  logEl.textContent += `\n${msg}`
  console.log(msg)
}

async function main() {
  logEl.textContent = ''
  log('加载 Test Image.png …')
  let res = await fetch('/Test%20Image.png')
  if (!res.ok) res = await fetch('/test%20image.png')
  if (!res.ok) throw new Error(`无法加载测试图: ${res.status}`)
  const blob = await res.blob()
  const dataUrl = await blobToDataUrl(blob)

  log('抠图中…')
  const subject = await extractSubject(dataUrl, (m) => log(m), 'full')
  log(`抠图完成 ${subject.width}x${subject.height} faceCrop=${subject.usedFaceCrop}`)

  log('识别部位…')
  const img = await loadImage(subject.cutoutDataUrl)
  const parts = await detectParts(subject.cutoutDataUrl, img.naturalWidth, img.naturalHeight)
  log(
    JSON.stringify(
      {
        fromPose: parts.fromPose,
        fromFace: parts.fromFace,
        hasEyes: parts.hasEyes,
        hasMouth: parts.hasMouth,
        head: parts.head,
        torso: parts.torso,
        leftArm: parts.leftArm,
        rightArm: parts.rightArm,
        leftLeg: parts.leftLeg,
        rightLeg: parts.rightLeg,
        legs: parts.legs,
      },
      null,
      2,
    ),
  )

  // Validation: parts should cover meaningful regions of the subject
  const area = (r: { w: number; h: number }) => r.w * r.h
  const canvasArea = img.naturalWidth * img.naturalHeight
  const checks = [
    ['head', area(parts.head) > canvasArea * 0.03],
    ['torso', area(parts.torso) > canvasArea * 0.04],
    ['legs', area(parts.legs) > canvasArea * 0.06],
    ['leftLeg', area(parts.leftLeg) > 40],
    ['rightLeg', area(parts.rightLeg) > 40],
    ['legsReachBottom', parts.legs.y + parts.legs.h >= img.naturalHeight * 0.85],
    ['headAboveTorso', parts.head.y <= parts.torso.y + 8],
    ['legsBelowTorso', parts.legs.y >= parts.torso.y + parts.torso.h * 0.4],
  ] as const
  let failed = 0
  for (const [name, ok] of checks) {
    log(`${ok ? 'OK' : 'FAIL'} ${name}`)
    if (!ok) failed++
  }

  const overlay = drawPartsOverlay(img, parts)
  downloadDataUrl(overlay.toDataURL('image/png'), 'debug-parts-overlay.png')
  log('已下载 debug-parts-overlay.png')

  log('像素化 + 生成动画…')
  const pixel = await pixelateImage(img, 64, 28)
  const sx = pixel.width / img.naturalWidth
  const sy = pixel.height / img.naturalHeight
  const scale = (r: typeof parts.head) => ({
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
  log(`idle frames=${sprites.frames.idle.length}`)
  log(`walkR frames=${sprites.frames.dragRight.length}`)
  log(`walkL frames=${sprites.frames.dragLeft.length}`)
  log(`hasEyes=${pixelParts.hasEyes}`)
  if (sprites.frames.idle.length < 5 || sprites.frames.dragRight.length < 5) {
    failed++
    log('FAIL frame counts')
  }
  if (!pixelParts.hasEyes) {
    failed++
    log('FAIL eyes not detected (blink requires eyes)')
  }
  if (sprites.frames.dragRight[0] === sprites.frames.dragRight[4]) {
    failed++
    log('FAIL walk cycle frames identical (no leg motion)')
  } else {
    log('OK walk cycle frames differ')
  }

  downloadDataUrl(sprites.previewGifDataUrl, 'debug-preview.gif')
  downloadDataUrl(sprites.frames.dragRight[0], 'debug-walk-right-0.png')
  downloadDataUrl(sprites.frames.dragRight[2], 'debug-walk-right-2.png')
  downloadDataUrl(sprites.frames.dragRight[4], 'debug-walk-right-4.png')
  downloadDataUrl(sprites.frames.dragLeft[2], 'debug-walk-left-2.png')
  downloadDataUrl(sprites.frames.idle[0], 'debug-idle-0.png')
  downloadDataUrl(sprites.frames.idle[7], 'debug-idle-blink.png')
  log('已下载预览 GIF 与关键帧')

  // Ensure left/right walk frames differ
  if (sprites.frames.dragLeft[2] === sprites.frames.dragRight[2]) {
    failed++
    log('FAIL left/right walk frames identical')
  } else {
    log('OK left/right walk frames differ')
  }

  log(failed === 0 ? 'RESULT PASS' : `RESULT FAIL (${failed})`)
  ;(window as unknown as { __PIPELINE_RESULT__: string }).__PIPELINE_RESULT__ =
    failed === 0 ? 'PASS' : 'FAIL'
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
