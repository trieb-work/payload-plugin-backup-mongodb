import fs from 'node:fs'
import path from 'node:path'

import cronstrue from 'cronstrue'

export interface VercelBackupCronInfo {
  schedule: string
  path: string
  /** Path relative to the app root (where `vercel.json` lives). */
  configFileRelative: string
}

export function readVercelBackupCronFromRepo(): VercelBackupCronInfo | null {
  const configFileRelative = 'vercel.json'
  try {
    const abs = path.join(process.cwd(), configFileRelative)
    if (!fs.existsSync(abs)) return null
    const raw = fs.readFileSync(abs, 'utf8')
    const parsed = JSON.parse(raw) as { crons?: Array<{ path?: string; schedule?: string }> }
    const crons = parsed.crons
    if (!Array.isArray(crons)) return null
    const hit = crons.find(
      (c) =>
        typeof c?.path === 'string' &&
        c.path.includes('backup-mongodb/cron') &&
        typeof c?.schedule === 'string',
    )
    if (!hit?.schedule || !hit.path) return null
    return { schedule: hit.schedule, path: hit.path, configFileRelative }
  } catch {
    return null
  }
}

export function describeCronSchedule(schedule: string): string | null {
  try {
    return cronstrue.toString(schedule)
  } catch {
    return null
  }
}
