import type { Endpoint } from 'payload'

import { restoreBackup } from '../../core/restore.js'
import {
  getResolvedCronBackupSettings,
  resolveBackupArchiveRead,
  resolveBackupBlobAccess,
  resolveBackupBlobToken,
} from '../../core/backupSettings.js'
import { readRequestJson, requireCronBearer } from '../shared.js'

export function createCronRestoreEndpoint(): Endpoint {
  return {
    method: 'post',
    path: '/backup-mongodb/cron/restore',
    handler: async (req) => {
      const cronErr = requireCronBearer(req)
      if (cronErr) return cronErr
      const { payload } = req
      const settings = await getResolvedCronBackupSettings(payload)
      const blobToken = resolveBackupBlobToken(settings)
      const blobAccess = resolveBackupBlobAccess(settings)
      if (!blobToken) {
        return new Response('Service unavailable', { status: 503 })
      }

      const { url, pathname } = (await readRequestJson(req)) as { url?: string; pathname?: string }
      if (!url || typeof url !== 'string') {
        return new Response('Missing url', { status: 400 })
      }
      try {
        new URL(url)
      } catch {
        return new Response('Invalid url', { status: 400 })
      }

      const backupRead = resolveBackupArchiveRead(settings, pathname)
      if (blobAccess === 'private' && !backupRead) {
        return new Response('Missing pathname (required for dedicated backup blob store)', {
          status: 400,
        })
      }

      payload.logger.info({ url }, '[backup-endpoint] Restore request accepted')
      await restoreBackup(payload, url, [], false, undefined, {
        blobToken,
        blobAccess,
        backupRead: backupRead ?? undefined,
      })
      payload.logger.info({ url }, '[backup-endpoint] Restore request finished')
      return Response.json({ message: 'Backup restore finished' }, { status: 202 })
    },
  }
}
