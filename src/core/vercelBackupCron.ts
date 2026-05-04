import cronstrue from 'cronstrue'
import fs from 'node:fs'
import path from 'node:path'

export interface VercelBackupCronInfo {
  /** Path relative to the app root (where `vercel.json` lives). */
  configFileRelative: string
  path: string
  schedule: string
}

export function readVercelBackupCronFromRepo(): null | VercelBackupCronInfo {
  const configFileRelative = 'vercel.json'
  try {
    const abs = path.join(process.cwd(), configFileRelative)
    if (!fs.existsSync(abs)) {
      return null
    }
    const raw = fs.readFileSync(abs, 'utf8')
    const parsed = JSON.parse(raw) as { crons?: Array<{ path?: string; schedule?: string }> }
    const crons = parsed.crons
    if (!Array.isArray(crons)) {
      return null
    }
    const hit = crons.find(
      (c) =>
        typeof c?.path === 'string' &&
        c.path.includes('backup-mongodb/cron') &&
        typeof c?.schedule === 'string',
    )
    if (!hit?.schedule || !hit.path) {
      return null
    }
    return { configFileRelative, path: hit.path, schedule: hit.schedule }
  } catch {
    return null
  }
}

export function describeCronSchedule(schedule: string): null | string {
  try {
    return cronstrue.toString(schedule)
  } catch {
    return null
  }
}
