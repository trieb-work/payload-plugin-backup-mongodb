/**
 * After `sass` writes dist/backup-dashboard.css, inlines that file into
 * src/.../backupDashboardInlineCss.ts so the admin UI can inject styles
 * without layout imports or transpilePackages.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')
const cssPath = join(root, 'dist', 'backup-dashboard.css')
const outPath = join(root, 'src', 'components', 'BackupDashboard', 'backupDashboardInlineCss.ts')

const css = readFileSync(cssPath, 'utf8')
const out = `/* Auto-generated from index.scss via scripts/embed-backup-css.mjs (run: pnpm build:css, pnpm build:embed-css, or pnpm build). */
export const backupDashboardInlineCss: string = ${JSON.stringify(css)}
`
writeFileSync(outPath, out, 'utf8')
