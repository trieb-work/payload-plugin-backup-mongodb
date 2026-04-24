import type { Endpoint } from 'payload'

import type { BackupPluginOptions } from '../../types'

import { validateBackupBlobToken } from '../../core/blobTokenValidate'
import { readRequestJson, requireBackupAdmin } from '../shared'

/**
 * Admin-only validation endpoint for a (candidate) Vercel Blob read/write token. Probes the store
 * by uploading and deleting a tiny marker file and reports back whether the token is usable and
 * which access level (public/private) the store accepts.
 */
export function createAdminValidateBlobTokenEndpoint(options: BackupPluginOptions): Endpoint {
  return {
    handler: async (req) => {
      const auth = await requireBackupAdmin(req, options)
      if (auth instanceof Response) {
        return auth
      }

      const body = (await readRequestJson(req)) as { token?: unknown }
      const token = typeof body?.token === 'string' ? body.token : ''

      const result = await validateBackupBlobToken(token)
      return Response.json(result, { status: result.ok ? 200 : 422 })
    },
    method: 'post',
    path: '/backup-mongodb/admin/validate-blob-token',
  }
}
