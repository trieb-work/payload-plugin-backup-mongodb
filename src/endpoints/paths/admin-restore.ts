import type { Endpoint } from 'payload'

import { after } from 'next/server'

import type { BackupPluginOptions } from '../../types'

import {
  getResolvedCronBackupSettings,
  resolveBackupArchiveRead,
  resolveBackupBlobAccess,
  resolveBackupBlobToken,
} from '../../core/backupSettings'
import { restoreBackup } from '../../core/restore'
import { completeBackupTask, createBackupTask, failBackupTask } from '../../core/taskProgress'
import { jsonError, readRequestJson, requireBackupAdmin } from '../shared'

export function createAdminRestoreEndpoint(options: BackupPluginOptions): Endpoint {
  return {
    handler: async (req) => {
      const auth = await requireBackupAdmin(req, options)
      if (auth instanceof Response) {
        return auth
      }

      const { payload } = req
      const settings = await getResolvedCronBackupSettings(payload)
      const blobToken = resolveBackupBlobToken(settings)
      const blobAccess = resolveBackupBlobAccess(settings)
      if (!blobToken) {
        return jsonError('Service unavailable', 503)
      }

      const body = (await readRequestJson(req)) as Record<string, unknown>
      const pathname = body?.pathname
      const url = body?.url
      const clientSkipRaw = body?.skipCollections
      const clientSkip =
        Array.isArray(clientSkipRaw) ?
          clientSkipRaw.filter(
            (x: unknown): x is string => typeof x === 'string' && x.length > 0 && x.length < 512,
          )
        : []

      if (!url || typeof url !== 'string') {
        return jsonError('Missing url', 400)
      }
      try {
        new URL(url)
      } catch {
        return jsonError('Invalid url', 400)
      }

      const backupRead = resolveBackupArchiveRead(settings, pathname)
      if (blobAccess === 'private' && !backupRead) {
        return jsonError('Missing pathname (required for dedicated backup blob store)', 400)
      }

      const { pollSecret, taskId } = await createBackupTask(payload, 'restore', 'Restore queued')

      payload.logger.info({ taskId, url }, '[backup-endpoint] Restore queued')

      const collectionBlacklist = [...new Set(['backup-tasks', ...clientSkip])]
      const restoreArchiveMedia = body?.restoreArchiveMedia !== false

      after(
        restoreBackup(payload, url, collectionBlacklist, false, taskId, {
          backupRead: backupRead ?? undefined,
          blobAccess,
          blobToken,
          restoreArchiveMedia,
        })
          .then(() => completeBackupTask(payload, taskId, 'Restore completed'))
          .catch(async (error) => {
            await failBackupTask(payload, taskId, error)
            payload.logger.error({ err: error, taskId, url }, '[backup-endpoint] Restore failed')
          }),
      )

      return Response.json({ pollSecret, taskId }, { status: 202 })
    },
    method: 'post',
    path: '/backup-mongodb/admin/restore',
  }
}
