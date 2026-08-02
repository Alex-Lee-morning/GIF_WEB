import { chromium } from 'playwright'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(fileURLToPath(import.meta.url)) + '/..'
const outDir = path.join(root, 'tmp-ai-review')
fs.mkdirSync(outDir, { recursive: true })

const vite = spawn('npx', ['vite', '--host', '127.0.0.1', '--port', '5174'], {
  cwd: root,
  env: { ...process.env, PATH: `/opt/homebrew/bin:${process.env.PATH}` },
  stdio: ['ignore', 'pipe', 'pipe'],
})

function waitForVite() {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('vite timeout')), 30000)
    const onData = (buf) => {
      const s = buf.toString()
      if (s.includes('Local:') || s.includes('5174')) {
        clearTimeout(t)
        vite.stdout?.off('data', onData)
        resolve(undefined)
      }
    }
    vite.stdout?.on('data', onData)
    vite.stderr?.on('data', onData)
  })
}

function writeGallery(review) {
  const img = (src, caption) =>
    `<figure><img src="${src}" alt="${caption}" /><figcaption>${caption}</figcaption></figure>`

  const walkR = review.walkRight.map((s, i) => img(s, `向右走 ${i}`)).join('\n')
  const walkL = review.walkLeft.map((s, i) => img(s, `向左走 ${i}`)).join('\n')
  const idle = review.idle.map((s, i) => img(s, `待机 ${i}`)).join('\n')

  const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<title>桌宠帧审阅 · Cursor AI</title>
<style>
  body { font-family: ui-sans-serif, system-ui, sans-serif; margin: 24px; background: #1a1a1a; color: #eee; }
  h1,h2 { font-weight: 600; }
  .meta { opacity: 0.8; margin-bottom: 24px; }
  .row { display: flex; flex-wrap: wrap; gap: 12px; margin-bottom: 32px; }
  figure { margin: 0; background: #2a2a2a; padding: 8px; border-radius: 8px; }
  img { image-rendering: pixelated; height: 160px; width: auto; background:
    linear-gradient(45deg,#333 25%,transparent 25%),linear-gradient(-45deg,#333 25%,transparent 25%),
    linear-gradient(45deg,transparent 75%,#333 75%),linear-gradient(-45deg,transparent 75%,#333 75%);
    background-size: 16px 16px; background-position: 0 0,0 8px,8px -8px,-8px 0; }
  figcaption { font-size: 12px; text-align: center; margin-top: 6px; }
  .big img { height: 240px; }
</style>
</head>
<body>
  <h1>Cursor AI 识别 → 生成帧（请审阅）</h1>
  <div class="meta">
    <div>${review.meta.label}</div>
    <div>抠图 ${review.meta.cutout} · 像素 ${review.meta.pixel}</div>
    <ul>${review.meta.notes.map((n) => `<li>${n}</li>`).join('')}</ul>
  </div>

  <h2>预览 GIF</h2>
  <div class="row big">${img(review.previewGif, 'preview')}</div>

  <h2>部位叠加（AI 手标）</h2>
  <div class="row big">${img(review.overlay, 'parts overlay')}</div>

  <h2>待机（含眨眼）</h2>
  <div class="row">${idle}</div>

  <h2>向右走（8 帧）</h2>
  <div class="row">${walkR}</div>

  <h2>向左走（8 帧 · 整只翻转朝向）</h2>
  <div class="row">${walkL}</div>
</body>
</html>`
  fs.writeFileSync(path.join(outDir, 'index.html'), html)
}

async function main() {
  await waitForVite()
  await new Promise((r) => setTimeout(r, 400))

  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage()
  page.on('console', (msg) => console.log('[page]', msg.text()))

  page.on('download', async (download) => {
    const name = download.suggestedFilename()
    const dest = path.join(outDir, name)
    await download.saveAs(dest)
    console.log('saved', name)
  })

  await page.goto('http://127.0.0.1:5174/ai-review.html', { waitUntil: 'networkidle', timeout: 120000 })
  await page.waitForFunction(() => typeof window.__PIPELINE_RESULT__ === 'string', null, { timeout: 300000 })
  await page.waitForTimeout(2500)

  const result = await page.evaluate(() => window.__PIPELINE_RESULT__)
  const review = await page.evaluate(() => window.__AI_REVIEW__)
  if (review) {
    writeGallery(review)
    fs.writeFileSync(path.join(outDir, 'meta.json'), JSON.stringify(review.meta, null, 2))
    console.log('gallery →', path.join(outDir, 'index.html'))
  }

  const logText = await page.locator('#log').innerText()
  fs.writeFileSync(path.join(outDir, 'log.txt'), logText)
  console.log(logText)
  console.log('RESULT', result)

  await browser.close()
  vite.kill('SIGTERM')
  if (result !== 'PASS') process.exitCode = 1
}

main().catch((err) => {
  console.error(err)
  vite.kill('SIGTERM')
  process.exit(1)
})
