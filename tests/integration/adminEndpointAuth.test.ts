import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/server', () => ({
  after: vi.fn((work: unknown) => {
    void work
  }),
}))

vi.mock('@vercel/blob', () => ({
  del: vi.fn(),
  list: vi.fn(async () => ({ blobs: [], cursor: undefined, hasMore: false })),
  put: vi.fn(),
}))

vi.mock('../../src/core/backupSettings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/core/backupSettings')>()
  return {
    ...actual,
    getResolvedCronBackupSettings: vi.fn(async () => ({
      id: 'settings-1',
      backupBlobAccess: 'public' as const,
      backupBlobReadWriteToken: 'env-token',
      backupsToKeep: 10,
      includeMediaForCron: false,
      skipMongoCollections: [] as string[],
    })),
  }
})

vi.mock('../../src/core/backup', () => ({
  createBackup: vi.fn(async () => undefined),
  listBackups: vi.fn(async () => []),
  resolveBackupListToken: vi.fn(async () => 'env-token'),
}))

vi.mock('../../src/core/restore', () => ({
  restoreBackup: vi.fn(async () => undefined),
  restoreSeedMedia: vi.fn(async () => []),
}))

vi.mock('../../src/core/taskProgress', async () => {
  return {
    completeBackupTask: vi.fn(async () => undefined),
    createBackupTask: vi.fn(async () => ({ pollSecret: 'secret', taskId: 'tid-1' })),
    failBackupTask: vi.fn(async () => undefined),
    getBackupTask: vi.fn(async () => undefined),
    pollSecretsMatch: vi.fn(() => false),
    stripPollSecretForClient: vi.fn((x: unknown) => x),
    updateBackupTask: vi.fn(async () => undefined),
  }
})

import type { Endpoint } from 'payload'

import { createBackupMongodbEndpoints } from '../../src/endpoints/index'
import { makeMockPayload, makeMockRequest } from './helpers'

const ADMIN_PATHS = [
  '/backup-mongodb/admin/manual',
  '/backup-mongodb/admin/restore',
  '/backup-mongodb/admin/backup-preview',
  '/backup-mongodb/admin/restore-preview',
  '/backup-mongodb/admin/delete',
  '/backup-mongodb/admin/backup-download',
  '/backup-mongodb/admin/settings',
  '/backup-mongodb/admin/validate-blob-token',
] as const

function getEndpoint(
  endpoints: Endpoint[],
  path: string,
  method?: Endpoint['method'],
): Endpoint {
  const match = endpoints.find((e) =>
    method ? e.path === path && e.method === method : e.path === path,
  )
  if (!match) {
    throw new Error(`endpoint not found: ${method ?? ''} ${path}`)
  }
  return match
}

describe('admin endpoints auth gate', () => {
  const prevRoles = process.env.PAYLOAD_BACKUP_ALLOWED_ROLES

  beforeEach(() => {
    vi.clearAllMocks()
    delete process.env.PAYLOAD_BACKUP_ALLOWED_ROLES
  })

  afterEach(() => {
    if (prevRoles !== undefined) {
      process.env.PAYLOAD_BACKUP_ALLOWED_ROLES = prevRoles
    } else {
      delete process.env.PAYLOAD_BACKUP_ALLOWED_ROLES
    }
  })

  it.each(ADMIN_PATHS)('%s returns 401 for unauthenticated requests', async (path) => {
    const endpoints = createBackupMongodbEndpoints({})
    const ep = getEndpoint(endpoints, path)
    const payload = makeMockPayload({
      auth: vi.fn(async () => ({ user: null })),
    })
    const req = makeMockRequest(payload, {
      body: {},
      method: ep.method as string,
      user: null,
    })
    const res = await ep.handler(req)
    expect(res.status).toBe(401)
  })

  it('blocks users that do not pass the custom access() option', async () => {
    const access = vi.fn(() => false)
    const endpoints = createBackupMongodbEndpoints({ access })
    const ep = getEndpoint(endpoints, '/backup-mongodb/admin/manual')
    const payload = makeMockPayload({
      auth: vi.fn(async () => ({ user: { id: 'u1', email: 'x@y' } })),
    })
    const req = makeMockRequest(payload, { body: {}, user: { id: 'u1' } })
    const res = await ep.handler(req)
    expect(res.status).toBe(401)
    expect(access).toHaveBeenCalled()
  })

  it('PAYLOAD_BACKUP_ALLOWED_ROLES=admin denies non-admin roles', async () => {
    process.env.PAYLOAD_BACKUP_ALLOWED_ROLES = 'admin'
    const endpoints = createBackupMongodbEndpoints({})
    const ep = getEndpoint(endpoints, '/backup-mongodb/admin/delete')
    const payload = makeMockPayload()
    const req = makeMockRequest(payload, {
      body: { pathname: 'backups/x.json', url: 'https://blob/x.json' },
      user: { id: 'u1', roles: [{ slug: 'editor' }] },
    })
    const res = await ep.handler(req)
    expect(res.status).toBe(401)
  })

  it('PAYLOAD_BACKUP_ALLOWED_ROLES="*" allows any authenticated user past the gate', async () => {
    process.env.PAYLOAD_BACKUP_ALLOWED_ROLES = '*'
    process.env.BLOB_READ_WRITE_TOKEN = 'env-token'
    const endpoints = createBackupMongodbEndpoints({})
    const ep = getEndpoint(endpoints, '/backup-mongodb/admin/delete')
    const payload = makeMockPayload()
    const req = makeMockRequest(payload, {
      body: { pathname: 'backups/x.json', url: 'https://blob/x.json' },
      user: { id: 'u1' },
    })
    const res = await ep.handler(req)
    // Not 401 => gate passed. The concrete status depends on downstream logic
    // (202 accepted here because pathname + url are valid).
    expect(res.status).not.toBe(401)
  })
})
