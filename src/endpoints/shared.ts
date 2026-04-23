import type { PayloadRequest } from 'payload'

import type { BackupPluginOptions } from '../types.js'

export async function readRequestJson(req: PayloadRequest): Promise<unknown> {
  return (req as unknown as Request).json() as Promise<unknown>
}

export function requireBlobEnv(): Response | null {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return new Response('Service unavailable', { status: 503 })
  }
  return null
}

export function requireCronBearer(req: PayloadRequest): Response | null {
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
): Promise<Record<string, unknown> | null> {
  const fromRequest = (req as PayloadRequest & { user?: Record<string, unknown> | null }).user
  const authUser = fromRequest
    ? fromRequest
    : ((await req.payload.auth({ headers: req.headers }))?.user as
        | Record<string, unknown>
        | null
        | undefined)
  const user = authUser
  if (!user) return null
  if (options.access) {
    return options.access(user) ? user : null
  }
  const roles = user.roles as Array<string | { slug?: string }> | undefined
  if (!roles?.length) return null
  const ok = roles.some((role) =>
    typeof role === 'string' ? role === 'admin' : role?.slug === 'admin',
  )
  return ok ? user : null
}

export async function requireBackupAdmin(
  req: PayloadRequest,
  options: BackupPluginOptions,
): Promise<Response | Record<string, unknown>> {
  // Security gate for admin routes: request must resolve to an authorized backup admin user.
  const user = await getAuthorizedBackupAdmin(req, options)
  if (!user) {
    return new Response('Unauthorized', { status: 401 })
  }
  return user
}
