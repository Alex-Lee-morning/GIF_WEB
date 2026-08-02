export interface PixelImage {
  width: number
  height: number
  /** RGBA flat array at pixel resolution (not display size) */
  data: Uint8ClampedArray
  dataUrl: string
}

function clampByte(n: number): number {
  return Math.max(0, Math.min(255, Math.round(n)))
}

function colorDistance(
  r1: number,
  g1: number,
  b1: number,
  r2: number,
  g2: number,
  b2: number,
): number {
  const dr = r1 - r2
  const dg = g1 - g2
  const db = b1 - b2
  return dr * dr + dg * dg + db * db
}

/** Median-cut-ish palette via iterative averaging buckets */
function buildPalette(
  pixels: Uint8ClampedArray,
  colorCount: number,
): Array<[number, number, number]> {
  type Bucket = { r: number; g: number; b: number; n: number }
  const samples: Array<[number, number, number]> = []
  for (let i = 0; i < pixels.length; i += 16) {
    const a = pixels[i + 3]
    if (a < 16) continue
    samples.push([pixels[i], pixels[i + 1], pixels[i + 2]])
  }
  if (samples.length === 0) {
    return [[80, 80, 80]]
  }

  // Start with random-ish seeds from samples
  const palette: Array<[number, number, number]> = []
  const step = Math.max(1, Math.floor(samples.length / colorCount))
  for (let i = 0; i < colorCount && i * step < samples.length; i++) {
    palette.push([...samples[i * step]])
  }
  while (palette.length < colorCount) {
    palette.push([
      Math.floor(Math.random() * 255),
      Math.floor(Math.random() * 255),
      Math.floor(Math.random() * 255),
    ])
  }

  // k-means iterations
  for (let iter = 0; iter < 8; iter++) {
    const buckets: Bucket[] = palette.map(() => ({ r: 0, g: 0, b: 0, n: 0 }))
    for (const [r, g, b] of samples) {
      let best = 0
      let bestDist = Infinity
      for (let p = 0; p < palette.length; p++) {
        const d = colorDistance(r, g, b, palette[p][0], palette[p][1], palette[p][2])
        if (d < bestDist) {
          bestDist = d
          best = p
        }
      }
      buckets[best].r += r
      buckets[best].g += g
      buckets[best].b += b
      buckets[best].n += 1
    }
    for (let p = 0; p < palette.length; p++) {
      if (buckets[p].n > 0) {
        palette[p] = [
          clampByte(buckets[p].r / buckets[p].n),
          clampByte(buckets[p].g / buckets[p].n),
          clampByte(buckets[p].b / buckets[p].n),
        ]
      }
    }
  }

  return palette
}

function quantizeToPalette(
  r: number,
  g: number,
  b: number,
  palette: Array<[number, number, number]>,
): [number, number, number] {
  let best = palette[0]
  let bestDist = Infinity
  for (const c of palette) {
    const d = colorDistance(r, g, b, c[0], c[1], c[2])
    if (d < bestDist) {
      bestDist = d
      best = c
    }
  }
  return best
}

export async function pixelateImage(
  source: HTMLImageElement | ImageBitmap,
  pixelSize: number,
  colorCount: number,
): Promise<PixelImage> {
  const srcW = 'naturalWidth' in source ? source.naturalWidth : source.width
  const srcH = 'naturalHeight' in source ? source.naturalHeight : source.height

  const size = Math.max(16, Math.min(96, Math.round(pixelSize)))
  const scale = Math.min(size / srcW, size / srcH)
  const width = Math.max(8, Math.round(srcW * scale))
  const height = Math.max(8, Math.round(srcH * scale))

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('Canvas unsupported')

  ctx.imageSmoothingEnabled = false
  ctx.clearRect(0, 0, width, height)
  ctx.drawImage(source as CanvasImageSource, 0, 0, width, height)

  const imageData = ctx.getImageData(0, 0, width, height)
  const palette = buildPalette(imageData.data, Math.max(8, Math.min(64, colorCount)))

  for (let i = 0; i < imageData.data.length; i += 4) {
    const a = imageData.data[i + 3]
    if (a < 24) {
      imageData.data[i + 3] = 0
      continue
    }
    const [r, g, b] = quantizeToPalette(
      imageData.data[i],
      imageData.data[i + 1],
      imageData.data[i + 2],
      palette,
    )
    imageData.data[i] = r
    imageData.data[i + 1] = g
    imageData.data[i + 2] = b
    imageData.data[i + 3] = 255
  }

  ctx.putImageData(imageData, 0, 0)

  // Upscale for crisp preview storage
  const display = document.createElement('canvas')
  const scaleUp = 8
  display.width = width * scaleUp
  display.height = height * scaleUp
  const dctx = display.getContext('2d')
  if (!dctx) throw new Error('Canvas unsupported')
  dctx.imageSmoothingEnabled = false
  dctx.drawImage(canvas, 0, 0, display.width, display.height)

  return {
    width,
    height,
    data: new Uint8ClampedArray(imageData.data),
    dataUrl: display.toDataURL('image/png'),
  }
}

export async function pixelateFromDataUrl(
  dataUrl: string,
  pixelSize: number,
  colorCount: number,
): Promise<PixelImage> {
  const img = await loadImage(dataUrl)
  return pixelateImage(img, pixelSize, colorCount)
}

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('图片加载失败'))
    img.src = src
  })
}

export function createDefaultPetDataUrl(size = 48): string {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) return ''

  ctx.imageSmoothingEnabled = false
  ctx.fillStyle = '#5c8f6a'
  roundRect(ctx, 8, 10, 32, 30, 6)
  ctx.fill()

  // ears
  ctx.fillStyle = '#4a7356'
  ctx.fillRect(10, 6, 8, 8)
  ctx.fillRect(30, 6, 8, 8)

  // face panel
  ctx.fillStyle = '#d8f0c8'
  roundRect(ctx, 12, 16, 24, 18, 4)
  ctx.fill()

  // eyes
  ctx.fillStyle = '#1a1a1a'
  ctx.fillRect(16, 22, 4, 4)
  ctx.fillRect(28, 22, 4, 4)

  // blush
  ctx.fillStyle = '#e89a9a'
  ctx.fillRect(14, 28, 4, 2)
  ctx.fillRect(30, 28, 4, 2)

  // mouth
  ctx.fillStyle = '#1a1a1a'
  ctx.fillRect(21, 30, 6, 2)

  // feet
  ctx.fillStyle = '#4a7356'
  ctx.fillRect(14, 40, 8, 4)
  ctx.fillRect(26, 40, 8, 4)

  return canvas.toDataURL('image/png')
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const radius = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + radius, y)
  ctx.arcTo(x + w, y, x + w, y + h, radius)
  ctx.arcTo(x + w, y + h, x, y + h, radius)
  ctx.arcTo(x, y + h, x, y, radius)
  ctx.arcTo(x, y, x + w, y, radius)
  ctx.closePath()
}
