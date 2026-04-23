import type { Endpoint, PayloadRequest } from 'payload'

import {
  getResolvedCronBackupSettings,
  resolveBackupBlobAccess,
  resolveBackupBlobToken,
} from '../../core/backupSettings.js'
import { streamBackupBlobForDownload } from '../../core/backupBlobIO.js'
import type { BackupPluginOptions } from '../../types.js'
import { requireBackupAdmin } from '../shared.js'

function queryParam(req: PayloadRequest, key: string): string {
  const fromPayload = req.searchParams.get(key)
  if (fromPayload) return fromPayload.trim()
  try {
    return new URL((req as unknown as Request).url).searchParams.get(key)?.trim() || ''
  } catch {
    return ''
  }
}

/**
 * Authenticated download of a backup archive. Streams via Vercel Blob `get` (private + public) and
 * optionally anonymous `fetch` of the list `downloadUrl` for public blobs. Pass `url` and
 * `downloadUrl` from `list()` so the correct public/private hostname is used.
 */
export function createAdminBackupDownloadEndpoint(options: BackupPluginOptions): Endpoint {
  return {
    method: 'get',
    path: '/backup-mongodb/admin/backup-download',
    handler: async (req) => {
      const auth = await requireBackupAdmin(req, options)
      if (auth instanceof Response) return auth

      const { payload } = req
      const settings = await getResolvedCronBackupSettings(payload)
      const token = resolveBackupBlobToken(settings).trim()
      if (!token) return new Response('Service unavailable', { status: 503 })

      const pathname = queryParam(req, 'pathname')
      if (!pathname.startsWith('backups/')) {
        return new Response('Invalid pathname', { status: 400 })
      }

      const blobUrl = queryParam(req, 'url')
      const downloadUrl = queryParam(req, 'downloadUrl')

      const preferred = resolveBackupBlobAccess(settings)
      const opened = await streamBackupBlobForDownload({
        pathname,
        token,
        preferredAccess: preferred,
        blobUrl: blobUrl || undefined,
        downloadUrl: downloadUrl || undefined,
      })

      if (!opened) {
        payload.logger.warn({ pathname }, '[backup-download] Blob not found or unreadable')
        return new Response('Backup not found', { status: 404 })
      }

      const filename = pathname.split('/').pop() || 'backup'
      const safeName = filename.replace(/["\r\n]/g, '_')
      return new Response(opened.stream, {
        headers: {
          'Content-Disposition': `attachment; filename="${safeName}"`,
          'Content-Type': opened.contentType || 'application/octet-stream',
        },
      })
    },
  }
}
