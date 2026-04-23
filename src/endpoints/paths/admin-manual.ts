import { after } from 'next/server'
import type { Endpoint } from 'payload'

import { createBackup } from '../../core/backup.js'
import {
  getResolvedCronBackupSettings,
  resolveBackupBlobAccess,
  resolveBackupBlobToken,
} from '../../core/backupSettings.js'
import { completeBackupTask, createBackupTask, failBackupTask } from '../../core/taskProgress.js'
import type { BackupPluginOptions } from '../../types.js'
import { readRequestJson, requireBackupAdmin } from '../shared.js'

export function createAdminManualEndpoint(options: BackupPluginOptions): Endpoint {
  return {
    method: 'post',
    path: '/backup-mongodb/admin/manual',
    handler: async (req) => {
      const auth = await requireBackupAdmin(req, options)
      if (auth instanceof Response) return auth

      const { payload } = req
      const settings = await getResolvedCronBackupSettings(payload)
      const blobToken = resolveBackupBlobToken(settings)
      const blobAccess = resolveBackupBlobAccess(settings)
      if (!blobToken) return new Response('Service unavailable', { status: 503 })

      const body = (await readRequestJson(req)) as Record<string, unknown>
      const clientSkipRaw = body?.skipCollections
      const clientSkip = Array.isArray(clientSkipRaw)
        ? clientSkipRaw.filter(
            (x: unknown): x is string => typeof x === 'string' && x.length > 0 && x.length < 512,
          )
        : []
      const wantsBlobMedia = body?.includeMedia === true
      const includeMedia = wantsBlobMedia && !clientSkip.includes('media')

      const { pollSecret, taskId } = await createBackupTask(payload, 'backup', 'Backup queued')

      payload.logger.info(
        { skipCount: clientSkip.length, taskId, includeMedia },
        '[backup-endpoint] Manual backup queued',
      )

      after(
        createBackup(payload, {
          cron: false,
          includeMedia,
          skipCollections: clientSkip,
          blobToken,
          blobAccess,
          taskId,
        })
          .then(() => completeBackupTask(payload, taskId, 'Backup completed'))
          .catch(async (error) => {
            await failBackupTask(payload, taskId, error)
            payload.logger.error({ err: error, taskId }, '[backup-endpoint] Manual backup failed')
          }),
      )

      return Response.json({ pollSecret, taskId }, { status: 202 })
    },
  }
}
