import type { Endpoint } from 'payload'

import { del } from '@vercel/blob'
import { after } from 'next/server'

import type { BackupPluginOptions } from '../../types'

import { getResolvedCronBackupSettings, resolveBackupBlobToken } from '../../core/backupSettings'
import {
  completeBackupTask,
  createBackupTask,
  failBackupTask,
  updateBackupTask,
} from '../../core/taskProgress'
import { jsonError, readRequestJson, requireBackupAdmin } from '../shared'

export function createAdminDeleteEndpoint(options: BackupPluginOptions): Endpoint {
  return {
    handler: async (req) => {
      const auth = await requireBackupAdmin(req, options)
      if (auth instanceof Response) {
        return auth
      }

      const { payload } = req
      const settings = await getResolvedCronBackupSettings(payload)
      const blobToken = resolveBackupBlobToken(settings)
      if (!blobToken) {
        return jsonError('Service unavailable', 503)
      }

      const body = (await readRequestJson(req)) as { pathname?: string; url?: string }
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

      payload.logger.info({ pathname, taskId }, '[backup-endpoint] Delete queued')

      after(
        updateBackupTask(payload, taskId, {
          message: `Deleting backup ${pathname}`,
          status: 'running',
        })
          .then(() => del(blobUrl, { token: blobToken }))
          .then(() => completeBackupTask(payload, taskId, `Deleted backup ${pathname}`))
          .catch(async (error) => {
            await failBackupTask(payload, taskId, error)
            payload.logger.error(
              { err: error, pathname, taskId },
              '[backup-endpoint] Delete failed',
            )
          }),
      )

      return Response.json({ pollSecret, taskId }, { status: 202 })
    },
    method: 'post',
    path: '/backup-mongodb/admin/delete',
  }
}
