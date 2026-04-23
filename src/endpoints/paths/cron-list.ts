import type { Endpoint } from 'payload'

import { listBackups, resolveBackupListToken } from '../../core/backup.js'
import { requireCronBearer } from '../shared.js'

export function createCronListEndpoint(): Endpoint {
  return {
    method: 'get',
    path: '/backup-mongodb/cron/list',
    handler: async (req) => {
      const cronErr = requireCronBearer(req)
      if (cronErr) return cronErr

      const { payload } = req
      const backupBlobToken = await resolveBackupListToken(payload)
      if (!backupBlobToken) {
        return new Response('Service unavailable', { status: 503 })
      }
      payload.logger.info('[backup-endpoint] Listing backups')
      const blobs = await listBackups(payload, { blobToken: backupBlobToken })
      payload.logger.info({ count: blobs.length }, '[backup-endpoint] Backup list loaded')
      return Response.json(blobs, { status: 200 })
    },
  }
}
