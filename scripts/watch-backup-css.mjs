/**
 * Watches `index.scss` and runs `build:css` + `build:embed-css` so
 * `backupDashboardInlineCss.ts` updates and Next dev can HMR. `pnpm dev`
 * starts this together with the Next dev server; use this script alone
 * only if you need the watcher without Next.
 */
import { watch } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { execSync } from 'node:child_process'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')
const scssPath = join(
  root,
  'src',
  'components',
  'BackupDashboard',
  'index.scss',
)

let timer = null
function run() {
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => {
    try {
      execSync('pnpm run build:css && pnpm run build:embed-css', {
        cwd: root,
        stdio: 'inherit',
        env: { ...process.env, FORCE_COLOR: '1' },
      })
    } catch {
      // build:css / embed may exit non-zero; stderr already shown
    }
  }, 120)
}

console.log('watch-backup-css: watching', scssPath)
run()
try {
  watch(scssPath, { persistent: true }, run)
} catch (e) {
  console.error('watch-backup-css: failed to watch (try saving index.scss to trigger a rebuild):', e)
  process.exit(1)
}
