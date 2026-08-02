import * as esbuild from 'esbuild'
import { mkdirSync } from 'node:fs'

mkdirSync('dist-electron', { recursive: true })

await esbuild.build({
  entryPoints: ['electron/main.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: 'dist-electron/main.js',
  external: ['electron', 'electron-updater'],
  sourcemap: true,
})

await esbuild.build({
  entryPoints: ['electron/preload.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile: 'dist-electron/preload.cjs',
  external: ['electron'],
  sourcemap: true,
})

console.log('Electron build complete')
