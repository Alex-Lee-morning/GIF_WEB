import { chromium } from 'playwright'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(fileURLToPath(import.meta.url)) + '/..'
const outDir = path.join(root, 'tmp-test-output')
fs.mkdirSync(outDir, { recursive: true })

const vite = spawn('npx', ['vite', '--host', '127.0.0.1', '--port', '5173'], {
  cwd: root,
  env: { ...process.env, PATH: `/opt/homebrew/bin:${process.env.PATH}` },
  stdio: ['ignore', 'pipe', 'pipe'],
})

function waitForVite() {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('vite timeout')), 30000)
    const onData = (buf) => {
      const s = buf.toString()
      if (s.includes('Local:') || s.includes('5173')) {
        clearTimeout(t)
        vite.stdout?.off('data', onData)
        resolve(undefined)
      }
    }
    vite.stdout?.on('data', onData)
    vite.stderr?.on('data', onData)
  })
}

async function main() {
  await waitForVite()
  await new Promise((r) => setTimeout(r, 500))

  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage()
  page.on('console', (msg) => console.log('[page]', msg.text()))

  const downloads = []
  page.on('download', async (download) => {
    const name = download.suggestedFilename()
    const dest = path.join(outDir, name)
    await download.saveAs(dest)
    downloads.push(name)
    console.log('saved', name)
  })

  await page.goto('http://127.0.0.1:5173/test-pipeline.html', { waitUntil: 'networkidle', timeout: 120000 })

  // Wait for RESULT
  await page.waitForFunction(
    () => typeof window.__PIPELINE_RESULT__ === 'string',
    null,
    { timeout: 300000 },
  )
  // allow downloads to flush
  await page.waitForTimeout(2000)

  const result = await page.evaluate(() => window.__PIPELINE_RESULT__)
  const logText = await page.locator('#log').innerText()
  fs.writeFileSync(path.join(outDir, 'pipeline-log.txt'), logText)
  console.log(logText)
  console.log('RESULT', result)

  await browser.close()
  vite.kill('SIGTERM')

  if (result !== 'PASS') {
    process.exitCode = 1
  }
}

main().catch((err) => {
  console.error(err)
  vite.kill('SIGTERM')
  process.exit(1)
})
