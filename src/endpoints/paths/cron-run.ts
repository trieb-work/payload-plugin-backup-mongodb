import type { Endpoint } from 'payload'

import { after } from 'next/server'

import type { BackupPluginOptions } from '../../types'

import { createBackup } from '../../core/backup'
import {
  getResolvedCronBackupSettings,
  resolveBackupBlobAccess,
  resolveBackupBlobToken,
} from '../../core/backupSettings'
import { requireCronBearer } from '../shared'

export function createCronRunEndpoint(options: BackupPluginOptions): Endpoint {
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
      if (!blobToken) {
        return new Response('Service unavailable', { status: 503 })
      }
      payload.logger.info('[backup-endpoint] Cron backup request accepted')
      after(
        createBackup(payload, {
          backupsToKeep: options.backupsToKeep ?? settings.backupsToKeep,
          blobAccess,
          blobToken,
          cron: true,
          includeMedia: settings.includeMediaForCron,
          skipCollections: settings.skipMongoCollections,
        }).catch((error) => {
          payload.logger.error({ err: error }, '[backup-endpoint] Cron backup failed')
          throw error
        }),
      )
      payload.logger.info('[backup-endpoint] Cron backup queued')
      return new Response('Backup creation started', { status: 202 })
    },
    method: 'get',
    path: '/backup-mongodb/cron/run',
  }
}
