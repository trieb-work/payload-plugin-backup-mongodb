import type { Endpoint } from 'payload'

import {
  getResolvedCronBackupSettings,
  resolveBackupArchiveRead,
  resolveBackupBlobAccess,
  resolveBackupBlobToken,
} from '../../core/backupSettings'
import { restoreBackup } from '../../core/restore'
import {
  buildRestoreWarnings,
  formatRestoreSummary,
  restoreTaskStatus,
} from '../../core/restoreResult'
import { getBackupStorageKind, isBackupStorageConfigured } from '../../core/storage'
import { readRequestJson, requireCronBearer } from '../shared'

export function createCronRestoreEndpoint(): Endpoint {
  return {
    handler: async (req) => {
      const cronErr = requireCronBearer(req)
      if (cronErr) {
        return cronErr
      }
      const { payload } = req
      const settings = await getResolvedCronBackupSettings(payload)
      const blobToken = resolveBackupBlobToken(settings)
      const blobAccess = resolveBackupBlobAccess(settings)
      if (!isBackupStorageConfigured(blobToken)) {
        return new Response('Service unavailable', { status: 503 })
      }

      const { pathname, url } = (await readRequestJson(req)) as { pathname?: string; url?: string }
      if (!url || typeof url !== 'string') {
        return new Response('Missing url', { status: 400 })
      }
      try {
        new URL(url)
      } catch {
        return new Response('Invalid url', { status: 400 })
      }

      const backupRead = resolveBackupArchiveRead(settings, pathname)
      if (getBackupStorageKind() === 'vercel-blob' && blobAccess === 'private' && !backupRead) {
        return new Response('Missing pathname (required for dedicated backup blob store)', {
          status: 400,
        })
      }

      const archivePathname =
        typeof pathname === 'string' && pathname.startsWith('backups/') ? pathname : undefined

      payload.logger.info({ url }, '[backup-endpoint] Restore request accepted')
      const result = await restoreBackup(payload, url, [], false, undefined, {
        archivePathname,
        backupRead: backupRead ?? undefined,
        blobAccess,
        blobToken,
      })
      const warnings = buildRestoreWarnings(result)
      const status = restoreTaskStatus(result)
      payload.logger.info({ result, status, url }, '[backup-endpoint] Restore request finished')
      return Response.json(
        {
          message: formatRestoreSummary(result),
          status,
          warnings,
        },
        { status: 202 },
      )
    },
    method: 'post',
    path: '/backup-mongodb/cron/restore',
  }
}
