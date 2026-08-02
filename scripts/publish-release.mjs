/**
 * Upload packaged artifacts to GitHub Releases for electron-updater.
 * Reads owner/repo from update/update-config.json.
 *
 * Prerequisites:
 *   - gh auth login
 *   - git remote pointing at the GitHub repo (optional but recommended)
 *   - npm run dist  and/or  npm run dist:win
 */
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const configPath = path.join(root, 'update', 'update-config.json')
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const updateConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'))

const owner = updateConfig.owner
const repo = updateConfig.repo
const version = pkg.version
const tag = `v${version}`
const title = `像素桌宠 ${tag}`

function exists(p) {
  return fs.existsSync(p)
}

function collectAssets() {
  const assets = []
  const releaseDir = path.join(root, 'release')
  const winDir = path.join(root, 'Windows版')

  const candidates = [
    // Mac updater channel
    path.join(releaseDir, 'latest-mac.yml'),
    ...globNamed(releaseDir, /^像素桌宠-.*-mac\.zip$/),
    ...globNamed(releaseDir, /^像素桌宠-.*-arm64-mac\.zip$/),
    ...globNamed(releaseDir, /^像素桌宠-.*\.blockmap$/),
    ...globNamed(releaseDir, /^像素桌宠-.*-mac-.*\.dmg$/),
    // Windows updater channel (NSIS) — prefer Windows版/, fallback release/
    path.join(winDir, 'latest.yml'),
    path.join(releaseDir, 'latest.yml'),
    ...globNamed(winDir, /^像素桌宠-.*-win-x64\.exe$/),
    ...globNamed(winDir, /^像素桌宠-.*-win-x64\.exe\.blockmap$/),
    ...globNamed(releaseDir, /^像素桌宠-.*-win-x64\.exe$/),
    ...globNamed(releaseDir, /^像素桌宠-.*-win-x64\.exe\.blockmap$/),
    // Optional manual downloads (not used by updater)
    ...globNamed(winDir, /^像素桌宠-.*-win-portable\.exe$/),
    ...globNamed(winDir, /^像素桌宠-.*-win-x64\.zip$/),
  ]

  const seen = new Set()
  for (const file of candidates) {
    if (!exists(file)) continue
    const key = path.basename(file)
    if (seen.has(key)) continue
    seen.add(key)
    assets.push(file)
  }
  return assets
}

function globNamed(dir, re) {
  if (!exists(dir)) return []
  return fs
    .readdirSync(dir)
    .filter((name) => re.test(name))
    .map((name) => path.join(dir, name))
}

function gh(args, opts = {}) {
  console.log('>', 'gh', args.join(' '))
  return execFileSync('gh', args, {
    cwd: root,
    stdio: opts.capture ? 'pipe' : 'inherit',
    encoding: 'utf8',
  })
}

function ensureGhAuth() {
  try {
    execFileSync('gh', ['auth', 'status'], { stdio: 'pipe' })
  } catch {
    throw new Error('未登录 GitHub CLI。请先运行：gh auth login')
  }
}

function releaseExists() {
  try {
    gh(['release', 'view', tag, '--repo', `${owner}/${repo}`], { capture: true })
    return true
  } catch {
    return false
  }
}

function main() {
  ensureGhAuth()
  const assets = collectAssets()
  if (!assets.length) {
    throw new Error(
      '未找到可上传的安装包。请先执行 npm run dist 和/或 npm run dist:win（需包含 zip / NSIS / latest*.yml）',
    )
  }

  console.log(`Publishing ${tag} to ${owner}/${repo}`)
  console.log('Assets:')
  for (const a of assets) console.log(' -', path.relative(root, a))

  const notes = [
    `像素桌宠 ${tag}`,
    '',
    '- Mac：安装 zip/dmg；自动更新走 zip + latest-mac.yml',
    '- Windows：安装 NSIS（*-win-x64.exe）；自动更新不支持 portable 绿色版',
    '',
    `配置见仓库内 update/update-config.json`,
  ].join('\n')

  if (releaseExists()) {
    console.log(`Release ${tag} already exists, uploading/replacing assets…`)
    for (const file of assets) {
      gh([
        'release',
        'upload',
        tag,
        file,
        '--repo',
        `${owner}/${repo}`,
        '--clobber',
      ])
    }
  } else {
    gh([
      'release',
      'create',
      tag,
      ...assets,
      '--repo',
      `${owner}/${repo}`,
      '--title',
      title,
      '--notes',
      notes,
    ])
  }

  console.log(`Done. Release: https://github.com/${owner}/${repo}/releases/tag/${tag}`)
}

try {
  main()
} catch (err) {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
}
