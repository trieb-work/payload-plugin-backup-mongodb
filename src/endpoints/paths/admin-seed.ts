import { after } from 'next/server'
import type { Endpoint } from 'payload'

import { restoreBackup, restoreSeedMedia } from '../../core/restore.js'
import { completeBackupTask, createBackupTask, failBackupTask } from '../../core/taskProgress.js'
import type { BackupPluginOptions } from '../../types.js'
import { requireBackupAdmin, requireBlobEnv } from '../shared.js'

export function createAdminSeedEndpoint(options: BackupPluginOptions): Endpoint | null {
  const seedUrl = options.seedDemoDumpUrl
  if (!seedUrl) return null

  return {
    method: 'post',
    path: '/backup-mongodb/admin/seed',
    handler: async (req) => {
      const blobErr = requireBlobEnv()
      if (blobErr) return blobErr

      const auth = await requireBackupAdmin(req, options)
      if (auth instanceof Response) return auth

      const { payload } = req
      const { pollSecret, taskId } = await createBackupTask(payload, 'seed', 'Seed queued')

      payload.logger.info({ taskId }, '[backup-endpoint] Seed queued')

      after(
        restoreSeedMedia(payload, taskId)
          .then(() => restoreBackup(payload, seedUrl, ['users', 'roles'], false, taskId))
          .then(() => completeBackupTask(payload, taskId, 'Seed completed'))
          .catch(async (error) => {
            await failBackupTask(payload, taskId, error)
            payload.logger.error({ err: error, taskId }, '[backup-endpoint] Seed failed')
          }),
      )

      return Response.json({ pollSecret, taskId }, { status: 202 })
    },
  }
}
