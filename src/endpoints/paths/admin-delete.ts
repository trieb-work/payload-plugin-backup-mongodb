import { after } from 'next/server'
import { del } from '@vercel/blob'
import type { Endpoint } from 'payload'

import { getResolvedCronBackupSettings, resolveBackupBlobToken } from '../../core/backupSettings.js'
import { completeBackupTask, createBackupTask, failBackupTask, updateBackupTask } from '../../core/taskProgress.js'
import type { BackupPluginOptions } from '../../types.js'
import { jsonError, readRequestJson, requireBackupAdmin } from '../shared.js'

export function createAdminDeleteEndpoint(options: BackupPluginOptions): Endpoint {
  return {
    method: 'post',
    path: '/backup-mongodb/admin/delete',
    handler: async (req) => {
      const auth = await requireBackupAdmin(req, options)
      if (auth instanceof Response) return auth

      const { payload } = req
      const settings = await getResolvedCronBackupSettings(payload)
      const blobToken = resolveBackupBlobToken(settings)
      if (!blobToken) return jsonError('Service unavailable', 503)

      const body = (await readRequestJson(req)) as { url?: string; pathname?: string }
      const blobUrl = body?.url
      const pathname = body?.pathname

      if (!blobUrl || !pathname || typeof blobUrl !== 'string' || typeof pathname !== 'string') {
        return jsonError('Missing url or pathname', 400)
      }

      const { pollSecret, taskId } = await createBackupTask(
        payload,
        'delete',
        `Queued deletion of ${pathname}`,
      )

      payload.logger.info({ taskId, pathname }, '[backup-endpoint] Delete queued')

      after(
        updateBackupTask(payload, taskId, { status: 'running', message: `Deleting backup ${pathname}` })
          .then(() => del(blobUrl, { token: blobToken }))
          .then(() => completeBackupTask(payload, taskId, `Deleted backup ${pathname}`))
          .catch(async (error) => {
            await failBackupTask(payload, taskId, error)
            payload.logger.error({ err: error, taskId, pathname }, '[backup-endpoint] Delete failed')
          }),
      )

      return Response.json({ pollSecret, taskId }, { status: 202 })
    },
  }
}
