/**
 * Runs `next dev` and the SCSS → inline-CSS watcher in one process
 * (single `pnpm dev`).
 */
import { createRequire } from 'node:module'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(join(root, 'package.json'))
const nextBin = require.resolve('next/dist/bin/next')
const useTurbo = process.argv.includes('--turbo')
const nextArgs = [nextBin, 'dev', 'dev', ...(useTurbo ? ['--turbo'] : ['--webpack'])]

const childEnv = { ...process.env, FORCE_COLOR: '1' }

const next = spawn(process.execPath, nextArgs, {
  cwd: root,
  stdio: 'inherit',
  env: childEnv,
})
const watch = spawn(process.execPath, [join(root, 'scripts', 'watch-backup-css.mjs')], {
  cwd: root,
  stdio: 'inherit',
  env: childEnv,
})

let childShutdown = false
function killBoth(sig) {
  if (childShutdown) return
  childShutdown = true
  try {
    next.kill(sig)
  } catch {
    // ignore
  }
  try {
    watch.kill(sig)
  } catch {
    // ignore
  }
}

;['SIGINT', 'SIGTERM'].forEach((sig) => {
  process.on(sig, () => killBoth('SIGTERM'))
})
if (process.platform !== 'win32') {
  process.on('SIGHUP', () => killBoth('SIGTERM'))
}

next.on('error', (err) => {
  console.error('dev: failed to start next:', err)
  process.exit(1)
})
watch.on('error', (err) => {
  console.error('dev: failed to start watch-backup-css:', err)
  process.exit(1)
})

let nextExited = false
next.on('close', (code) => {
  nextExited = true
  try {
    watch.kill('SIGTERM')
  } catch {
    // ignore
  }
  setTimeout(() => process.exit(code ?? 0), 100)
})

watch.on('close', (code) => {
  if (nextExited) return
  if (code === 0) return
  console.error(`dev: watch-backup-css exited with code ${code ?? 'unknown'}`)
  try {
    next.kill('SIGTERM')
  } catch {
    // ignore
  }
  setTimeout(() => process.exit(code ?? 1), 200)
})
