/**
 * Keep IMG.LY background-removal WASM + isnet_quint8 inside this project:
 *   public/bg-removal/          ← runtime assets (served by Vite / packaged app)
 *   vendor/bg-removal-cache/    ← optional download cache (gitignored)
 *
 * No /tmp, no runtime CDN dependency once assets exist.
 */
import fs from 'node:fs'
import path from 'node:path'
import { createWriteStream } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import https from 'node:https'
import http from 'node:http'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const version = '1.7.0'
const destRoot = path.join(root, 'public', 'bg-removal')
const cacheDir = path.join(root, 'vendor', 'bg-removal-cache')
const cacheTgz = path.join(cacheDir, `background-removal-data-${version}.tgz`)
const extractDir = path.join(cacheDir, `extract-${version}`)
const cdnUrl = `https://staticimgly.com/@imgly/background-removal-data/${version}/package.tgz`

const KEEP_KEYS = [
  '/onnxruntime-web/ort-wasm-simd-threaded.wasm',
  '/onnxruntime-web/ort-wasm-simd-threaded.mjs',
  '/models/isnet_quint8',
]

function download(url, dest) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    const file = createWriteStream(dest)
    const getter = url.startsWith('https') ? https : http
    const req = getter.get(url, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        file.close()
        fs.unlinkSync(dest)
        download(res.headers.location, dest).then(resolve, reject)
        return
      }
      if (res.statusCode !== 200) {
        file.close()
        reject(new Error(`Download failed ${res.statusCode} ${url}`))
        return
      }
      res.pipe(file)
      file.on('finish', () => file.close(() => resolve(undefined)))
    })
    req.on('error', (err) => {
      try {
        file.close()
        fs.unlinkSync(dest)
      } catch {
        /* ignore */
      }
      reject(err)
    })
  })
}

async function ensureTarball() {
  if (fs.existsSync(cacheTgz) && fs.statSync(cacheTgz).size > 1_000_000) return cacheTgz
  // Also accept a previously cached copy under tmp-test-output (legacy in-project path)
  const legacy = path.join(root, 'tmp-test-output', `background-removal-data-${version}.tgz`)
  if (fs.existsSync(legacy) && fs.statSync(legacy).size > 1_000_000) {
    fs.mkdirSync(cacheDir, { recursive: true })
    fs.copyFileSync(legacy, cacheTgz)
    return cacheTgz
  }
  console.log(`Downloading background-removal assets into ${cacheTgz} …`)
  await download(cdnUrl, cacheTgz)
  return cacheTgz
}

function extractTarball(tgz, outDir) {
  fs.rmSync(outDir, { recursive: true, force: true })
  fs.mkdirSync(outDir, { recursive: true })
  execFileSync('tar', ['-xzf', tgz, '-C', outDir], { stdio: 'inherit' })
}

function assetsReady() {
  const marker = path.join(destRoot, 'resources.json')
  if (!fs.existsSync(marker)) return false
  try {
    const existing = JSON.parse(fs.readFileSync(marker, 'utf8'))
    return KEEP_KEYS.every((k) => existing[k])
  } catch {
    return false
  }
}

function syncFromDist(srcDist) {
  const resources = JSON.parse(fs.readFileSync(path.join(srcDist, 'resources.json'), 'utf8'))
  const filtered = {}
  const needed = new Set()
  for (const key of KEEP_KEYS) {
    const entry = resources[key]
    if (!entry?.chunks?.length) throw new Error(`Missing resource key: ${key}`)
    filtered[key] = entry
    for (const chunk of entry.chunks) needed.add(chunk.name)
  }

  fs.rmSync(destRoot, { recursive: true, force: true })
  fs.mkdirSync(destRoot, { recursive: true })
  fs.writeFileSync(path.join(destRoot, 'resources.json'), JSON.stringify(filtered))

  let bytes = 0
  for (const name of needed) {
    const from = path.join(srcDist, name)
    const to = path.join(destRoot, name)
    if (!fs.existsSync(from)) throw new Error(`Missing chunk file: ${name}`)
    fs.copyFileSync(from, to)
    bytes += fs.statSync(to).size
  }
  console.log(
    `Synced ${needed.size} files (${(bytes / 1024 / 1024).toFixed(1)} MB) → ${path.relative(root, destRoot)}`,
  )
}

async function main() {
  if (assetsReady()) {
    console.log('public/bg-removal already present inside project, skip')
    return
  }

  const tgz = await ensureTarball()
  extractTarball(tgz, extractDir)
  syncFromDist(path.join(extractDir, 'package', 'dist'))

  if (!assetsReady()) {
    throw new Error('Failed to materialize public/bg-removal inside project')
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
