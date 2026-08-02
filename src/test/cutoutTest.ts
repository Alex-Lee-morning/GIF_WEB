import { extractSubject } from '../lib/extractSubject'

declare global {
  interface Window {
    __CUTOUT_RESULT__?: string
  }
}

const logEl = document.getElementById('log')
function log(msg: string) {
  if (logEl) logEl.textContent += `${msg}\n`
  console.log(msg)
}

async function main() {
  try {
    log('loading test image…')
    const res = await fetch('/test%20image.png')
    if (!res.ok) throw new Error(`fetch image failed: ${res.status}`)
    const blob = await res.blob()
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const r = new FileReader()
      r.onload = () => resolve(String(r.result))
      r.onerror = () => reject(new Error('read failed'))
      r.readAsDataURL(blob)
    })

    const result = await extractSubject(dataUrl, (m) => log(m), 'full')
    log(`OK cutout ${result.width}x${result.height} face=${result.usedFaceCrop}`)

    const a = document.createElement('a')
    a.href = result.cutoutDataUrl
    a.download = 'cutout-test.png'
    a.textContent = 'download cutout'
    document.body.appendChild(a)

    const img = document.createElement('img')
    img.src = result.cutoutDataUrl
    img.style.maxWidth = '320px'
    img.style.background = '#ddd'
    document.body.appendChild(img)

    window.__CUTOUT_RESULT__ = 'PASS'
  } catch (err) {
    log(`FAIL ${err instanceof Error ? err.message : String(err)}`)
    window.__CUTOUT_RESULT__ = 'FAIL'
  }
}

main()
