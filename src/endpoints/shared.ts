import type { PayloadRequest } from 'payload'

import type { BackupPluginOptions } from '../types'

import { isUserAllowedByEnvRoles } from '../utils/dashboardRoleAccess'

export async function readRequestJson(req: PayloadRequest): Promise<unknown> {
  return (req as unknown as Request).json() as Promise<unknown>
}

/**
 * Canonical JSON error response for admin-facing endpoints. The dashboard clients
 * always parse responses as JSON, so plain-text bodies would crash `await res.json()`
 * with `Unexpected token ... is not valid JSON`.
 */
export function jsonError(message: string, status: number): Response {
  return Response.json({ error: message }, { status })
}

export function requireBlobEnv(): null | Response {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return jsonError('Service unavailable', 503)
  }
  return null
}

export function requireCronBearer(req: PayloadRequest): null | Response {
  // Security gate for cron/external backup routes: only a matching CRON_SECRET bearer may pass.
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response('Unauthorized', { status: 401 })
  }
  return null
}

export async function getAuthorizedBackupAdmin(
  req: PayloadRequest,
  options: BackupPluginOptions,
): Promise<null | Record<string, unknown>> {
  const fromRequest = (req as { user?: null | Record<string, unknown> } & PayloadRequest).user
  const authUser = fromRequest
    ? fromRequest
    : ((await req.payload.auth({ headers: req.headers }))?.user as
        | null
        | Record<string, unknown>
        | undefined)
  const user = authUser
  if (!user) {
    return null
  }
  if (options.access) {
    return options.access(user) ? user : null
  }
  // Default access check stays in sync with the dashboard visibility rule:
  // driven by `PAYLOAD_BACKUP_ALLOWED_ROLES` with backwards-compatible defaults
  // (admin role required when roles exist, or allow when the project has no roles field).
  return isUserAllowedByEnvRoles(user) ? user : null
}

export async function requireBackupAdmin(
  req: PayloadRequest,
  options: BackupPluginOptions,
): Promise<Record<string, unknown> | Response> {
  // Security gate for admin routes: request must resolve to an authorized backup admin user.
  const user = await getAuthorizedBackupAdmin(req, options)
  if (!user) {
    return jsonError('Unauthorized', 401)
  }
  return user
}
