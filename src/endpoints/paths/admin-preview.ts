import type { Endpoint } from 'payload'

import type { BackupPluginOptions } from '../../types'

import {
  getResolvedCronBackupSettings,
  resolveBackupArchiveRead,
  resolveBackupBlobAccess,
} from '../../core/backupSettings'
import { getBackupSourcePreviewForManual } from '../../core/backupSourcePreview'
import { getRestorePreviewForAdminRestore } from '../../core/restorePreview'
import { jsonError, readRequestJson, requireBackupAdmin } from '../shared'

/**
 * Admin backup source preview and restore archive preview (both POST).
 */
export function createAdminPreviewEndpoints(options: BackupPluginOptions): Endpoint[] {
  return [
    {
      handler: async (req) => {
        const auth = await requireBackupAdmin(req, options)
        if (auth instanceof Response) {
          return auth
        }

        const { payload } = req
        const body = (await readRequestJson(req)) as { locale?: string }
        const locale = typeof body?.locale === 'string' ? body.locale : undefined
        const preferredLocales = locale ? [locale, 'de', 'en'] : ['de', 'en']

        try {
          const preview = await getBackupSourcePreviewForManual(payload, { preferredLocales })
          return Response.json(preview)
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Preview failed'
          payload.logger.error({ err: error }, '[backup-endpoint] Backup source preview failed')
          return Response.json({ error: message }, { status: 422 })
        }
      },
      method: 'post',
      path: '/backup-mongodb/admin/backup-preview',
    },
    {
      handler: async (req) => {
        const auth = await requireBackupAdmin(req, options)
        if (auth instanceof Response) {
          return auth
        }

        const { payload } = req
        const body = (await readRequestJson(req)) as {
          locale?: string
          pathname?: string
          url?: string
        }
        const url = body?.url

        if (!url || typeof url !== 'string') {
          return jsonError('Missing url', 400)
        }

        try {
          new URL(url)
        } catch {
          return jsonError('Invalid url', 400)
        }

        const settings = await getResolvedCronBackupSettings(payload)
        const backupRead = resolveBackupArchiveRead(settings, body?.pathname)
        if (resolveBackupBlobAccess(settings) === 'private' && !backupRead) {
          return jsonError('Missing pathname (required for dedicated backup blob store)', 400)
        }

        const locale = typeof body?.locale === 'string' ? body.locale : undefined
        const preferredLocales = locale ? [locale, 'de', 'en'] : ['de', 'en']

        try {
          const preview = await getRestorePreviewForAdminRestore(payload, url, {
            backupRead: backupRead ?? undefined,
            preferredLocales,
          })
          return Response.json(preview)
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Preview failed'
          payload.logger.error({ err: error, url }, '[backup-endpoint] Restore preview failed')
          return Response.json({ error: message }, { status: 422 })
        }
      },
      method: 'post',
      path: '/backup-mongodb/admin/restore-preview',
    },
  ]
}
