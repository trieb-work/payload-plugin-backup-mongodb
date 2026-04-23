import { del, put } from '@vercel/blob'

import type { BackupBlobAccessLevel } from './backupBlobIO.js'

export interface BackupBlobTokenValidation {
  ok: boolean
  /** Detected access level the store accepts (set when ok). */
  access?: BackupBlobAccessLevel
  /** Short error description when validation fails. */
  error?: string
}

const PROBE_PATH_PREFIX = 'backups/.backup-mongodb-probe-'

function looksLikeAccessModeRejection(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error ?? '')
  const lower = msg.toLowerCase()
  if (!lower.includes('access')) return false
  return (
    lower.includes('public') ||
    lower.includes('private') ||
    lower.includes('not support') ||
    lower.includes('invalid')
  )
}

/**
 * Probes a Vercel Blob read/write token by uploading a tiny file and deleting it afterwards. Tries
 * `private` first and falls back to `public` so the caller sees which access modes the store
 * accepts. Non-access errors (auth, network, quota…) are reported as invalid.
 */
export async function validateBackupBlobToken(
  token: string,
): Promise<BackupBlobTokenValidation> {
  const trimmed = token.trim()
  if (!trimmed) return { error: 'Token is empty', ok: false }

  const probePath = `${PROBE_PATH_PREFIX}${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 10)}.txt`
  const probeBody = 'backup-mongodb-plugin-probe'

  let firstError: unknown
  for (const access of ['private', 'public'] as const) {
    let uploadedUrl: string | undefined
    try {
      const result = await put(probePath, probeBody, {
        access,
        addRandomSuffix: false,
        token: trimmed,
      })
      uploadedUrl = result?.url
      return { access, ok: true }
    } catch (error) {
      if (firstError === undefined) firstError = error
      if (!looksLikeAccessModeRejection(error)) {
        return { error: error instanceof Error ? error.message : 'Token rejected', ok: false }
      }
    } finally {
      if (uploadedUrl) {
        try {
          await del(uploadedUrl, { token: trimmed })
        } catch {
          /* best-effort cleanup */
        }
      }
    }
  }

  return {
    error:
      firstError instanceof Error
        ? firstError.message
        : 'Token rejected for both public and private access',
    ok: false,
  }
}
