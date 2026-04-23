import type { Endpoint } from 'payload'

import { listBackups } from '../../core/backup.js'
import { getResolvedCronBackupSettings, resolveBackupBlobToken } from '../../core/backupSettings.js'
import { requireCronBearer } from '../shared.js'

export function createCronListEndpoint(): Endpoint {
  return {
    method: 'get',
    path: '/backup-mongodb/cron/list',
    handler: async (req) => {
      const cronErr = requireCronBearer(req)
      if (cronErr) return cronErr

      const { payload } = req
      const settings = await getResolvedCronBackupSettings(payload)
      const blobToken = resolveBackupBlobToken(settings)
      if (!blobToken) {
        return new Response('Service unavailable', { status: 503 })
      }
      payload.logger.info('[backup-endpoint] Listing backups')
      const blobs = await listBackups(blobToken)
      payload.logger.info({ count: blobs.length }, '[backup-endpoint] Backup list loaded')
      return Response.json(blobs, { status: 200 })
    },
  }
}
