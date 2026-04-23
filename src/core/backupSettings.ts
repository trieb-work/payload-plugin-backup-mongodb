import type { Payload } from 'payload'

export const BACKUP_SETTINGS_SLUG = 'backup-settings' as const

export interface ResolvedCronBackupSettings {
  id: string
  backupsToKeep: number
  skipMongoCollections: string[]
  includeMediaForCron: boolean
  backupBlobReadWriteToken: string
  /**
   * Validated access level of the current backup blob store, populated via
   * `validateBackupBlobToken`. `null` when validation has never run (default token use is still
   * treated as `public`, dedicated token without validation falls back to heuristic private).
   */
  backupBlobAccess: 'public' | 'private' | null
}

function defaultBackupsToKeep(): number {
  const n = Number(process.env.BACKUPS_TO_KEEP)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 10
}

export function normalizeSkipMongoCollections(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const out: string[] = []
  for (const entry of raw) {
    if (typeof entry === 'string' && entry.length > 0 && entry.length < 512) {
      out.push(entry)
      continue
    }
    if (entry && typeof entry === 'object' && 'name' in entry) {
      const name = (entry as { name?: unknown }).name
      if (typeof name === 'string' && name.length > 0 && name.length < 512) out.push(name)
    }
  }
  return out
}

export function toPayloadSkipRows(names: string[]): { name: string }[] {
  return names.map((name) => ({ name }))
}

export async function getResolvedCronBackupSettings(
  payload: Payload,
): Promise<ResolvedCronBackupSettings> {
  const res = await payload.find({
    collection: BACKUP_SETTINGS_SLUG,
    limit: 1,
    depth: 0,
    overrideAccess: true,
  })
  const doc = res.docs[0] as unknown as Record<string, unknown> | undefined
  if (!doc) {
    return {
      id: '',
      backupsToKeep: defaultBackupsToKeep(),
      skipMongoCollections: [],
      includeMediaForCron: true,
      backupBlobReadWriteToken: '',
      backupBlobAccess: null,
    }
  }
  const rawKeep = doc.backupsToKeep
  const backupsToKeep =
    typeof rawKeep === 'number' && Number.isFinite(rawKeep)
      ? Math.min(365, Math.max(1, Math.floor(rawKeep)))
      : defaultBackupsToKeep()

  const rawAccess = typeof doc.backupBlobAccess === 'string' ? doc.backupBlobAccess : null
  const backupBlobAccess: 'public' | 'private' | null =
    rawAccess === 'public' || rawAccess === 'private' ? rawAccess : null

  return {
    id: String(doc.id),
    backupsToKeep,
    skipMongoCollections: normalizeSkipMongoCollections(doc.skipMongoCollections),
    includeMediaForCron: doc.includeMediaForCron === true,
    backupBlobReadWriteToken:
      typeof doc.backupBlobReadWriteToken === 'string' ? doc.backupBlobReadWriteToken : '',
    backupBlobAccess,
  }
}

export function resolveBackupBlobToken(settings: ResolvedCronBackupSettings): string {
  const fromSettings = settings.backupBlobReadWriteToken.trim()
  if (fromSettings.length > 0) return fromSettings
  return process.env.BLOB_READ_WRITE_TOKEN || ''
}

/**
 * Vercel Blob `access` for new backup archives. Prefers the detected + persisted access level from
 * {@link validateBackupBlobToken}; otherwise heuristically treats a dedicated backup token as
 * `private` and the default env token as `public`.
 */
export function resolveBackupBlobAccess(
  settings: ResolvedCronBackupSettings,
): 'public' | 'private' {
  if (settings.backupBlobAccess === 'public' || settings.backupBlobAccess === 'private') {
    return settings.backupBlobAccess
  }
  return settings.backupBlobReadWriteToken.trim().length > 0 ? 'private' : 'public'
}

/**
 * When `pathname` is sent, restore/preview read via token + flexible SDK/fetch (works for public
 * and private blobs). Returns undefined if pathname is missing or invalid.
 */
export function resolveBackupArchiveRead(
  settings: ResolvedCronBackupSettings,
  pathname: unknown,
): { pathname: string; token: string } | undefined {
  if (typeof pathname !== 'string' || !pathname.startsWith('backups/')) return undefined
  const token = resolveBackupBlobToken(settings).trim()
  if (!token) return undefined
  return { pathname, token }
}
