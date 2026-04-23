import { after } from 'next/server'
import type { Endpoint } from 'payload'

import { createBackup } from '../../core/backup.js'
import {
  getResolvedCronBackupSettings,
  resolveBackupBlobAccess,
  resolveBackupBlobToken,
} from '../../core/backupSettings.js'
import type { BackupPluginOptions } from '../../types.js'
import { requireCronBearer } from '../shared.js'

export function createCronRunEndpoint(options: BackupPluginOptions): Endpoint {
  return {
    method: 'get',
    path: '/backup-mongodb/cron/run',
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
      payload.logger.info('[backup-endpoint] Cron backup request accepted')
      after(
        createBackup(payload, {
          cron: true,
          backupsToKeep: options.backupsToKeep ?? settings.backupsToKeep,
          skipCollections: settings.skipMongoCollections,
          includeMedia: settings.includeMediaForCron,
          blobToken,
          blobAccess,
        }).catch((error) => {
          payload.logger.error({ err: error }, '[backup-endpoint] Cron backup failed')
          throw error
        }),
      )
      payload.logger.info('[backup-endpoint] Cron backup queued')
      return new Response('Backup creation started', { status: 202 })
    },
  }
}
