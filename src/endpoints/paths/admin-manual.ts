import type { Endpoint } from 'payload'

import { after } from 'next/server'

import type { BackupPluginOptions } from '../../types'

import { createBackup } from '../../core/backup'
import {
  getResolvedCronBackupSettings,
  resolveBackupBlobAccess,
  resolveBackupBlobToken,
} from '../../core/backupSettings'
import { completeBackupTask, createBackupTask, failBackupTask } from '../../core/taskProgress'
import { sanitizeBackupLabel } from '../../utils/index'
import { jsonError, readRequestJson, requireBackupAdmin } from '../shared'

export function createAdminManualEndpoint(options: BackupPluginOptions): Endpoint {
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
      const clientSkipRaw = body?.skipCollections
      const clientSkip =
        Array.isArray(clientSkipRaw) ?
          clientSkipRaw.filter(
            (x: unknown): x is string => typeof x === 'string' && x.length > 0 && x.length < 512,
          )
        : []
      const wantsBlobMedia = body?.includeMedia === true
      const includeMedia = wantsBlobMedia && !clientSkip.includes('media')
      const label = sanitizeBackupLabel(body?.label)

      const { pollSecret, taskId } = await createBackupTask(payload, 'backup', 'Backup queued')

      payload.logger.info(
        { hasLabel: Boolean(label), includeMedia, skipCount: clientSkip.length, taskId },
        '[backup-endpoint] Manual backup queued',
      )

      after(
        createBackup(payload, {
          blobAccess,
          blobToken,
          cron: false,
          includeMedia,
          label: label || undefined,
          skipCollections: clientSkip,
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
    method: 'post',
    path: '/backup-mongodb/admin/manual',
  }
}
