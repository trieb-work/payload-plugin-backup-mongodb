import { beforeEach, describe, expect, it, vi } from 'vitest'

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

vi.mock('../../src/core/blobTokenValidate', () => ({
  validateBackupBlobToken: vi.fn(async () => ({ access: 'private', ok: true })),
}))

vi.mock('../../src/core/vercelBackupCron', () => ({
  describeCronSchedule: vi.fn(() => 'every day'),
  readVercelBackupCronFromRepo: vi.fn(() => null),
}))

vi.mock('../../src/core/backupBlobTransfer', () => ({
  transferBackupBlobsToToken: vi.fn(async () => ({
    failed: 0,
    skipped: 0,
    total: 0,
    transferred: 0,
  })),
}))

import { validateBackupBlobToken } from '../../src/core/blobTokenValidate'
import { createAdminSettingsEndpoints } from '../../src/endpoints/paths/admin-settings'
import { makeMockPayload, makeMockRequest, readJsonBody } from './helpers'

const adminUser = { id: 'u1' }

function findEndpoint(method: 'get' | 'patch') {
  const eps = createAdminSettingsEndpoints({})
  const match = eps.find((e) => e.path === '/backup-mongodb/admin/settings' && e.method === method)
  if (!match) {
    throw new Error(`missing settings endpoint: ${method}`)
  }
  return match
}

const storedDoc = {
  id: 'settings-1',
  backupBlobAccess: 'public',
  backupBlobReadWriteToken: 'vercel_blob_rw_stored-token',
  backupsToKeep: 10,
  includeMediaForCron: false,
  skipMongoCollections: [{ name: 'legacy' }],
}

function payloadWithSettings(doc = storedDoc) {
  return makeMockPayload({
    create: vi.fn(async (args: { data: Record<string, unknown> }) => ({
      ...doc,
      ...args.data,
      id: 'settings-1',
    })),
    find: vi.fn(async () => ({ docs: [doc] })),
    update: vi.fn(async (args: { data: Record<string, unknown>; id: string }) => ({
      ...doc,
      ...args.data,
      id: args.id,
    })),
  })
}

describe('GET /backup-mongodb/admin/settings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    delete process.env.PAYLOAD_BACKUP_ALLOWED_ROLES
  })

  it('returns 401 when unauthenticated', async () => {
    const ep = findEndpoint('get')
    const res = await ep.handler(makeMockRequest(makeMockPayload(), { method: 'get', user: null }))
    expect(res.status).toBe(401)
  })

  it('masks the stored backup blob token in the response', async () => {
    const ep = findEndpoint('get')
    const res = await ep.handler(
      makeMockRequest(payloadWithSettings(), { method: 'get', user: adminUser }),
    )
    expect(res.status).toBe(200)
    const body = (await readJsonBody(res)) as Record<string, unknown>
    expect(body.hasBackupBlobReadWriteToken).toBe(true)
    expect(body.backupBlobTokenMasked).not.toBe(storedDoc.backupBlobReadWriteToken)
    expect(String(body.backupBlobTokenMasked)).toMatch(/\*/)
  })
})

describe('PATCH /backup-mongodb/admin/settings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    delete process.env.PAYLOAD_BACKUP_ALLOWED_ROLES
    vi.mocked(validateBackupBlobToken).mockResolvedValue({ access: 'private', ok: true })
  })

  it('clamps backupsToKeep to the [1, 365] range', async () => {
    const ep = findEndpoint('patch')
    const payload = payloadWithSettings()
    const res = await ep.handler(
      makeMockRequest(payload, {
        body: { backupsToKeep: 9999 },
        method: 'patch',
        user: adminUser,
      }),
    )
    expect(res.status).toBe(200)
    const updateCall = vi.mocked(payload.update!).mock.calls[0][0] as {
      data: { backupsToKeep: number }
    }
    expect(updateCall.data.backupsToKeep).toBe(365)

    const res2 = await ep.handler(
      makeMockRequest(payload, {
        body: { backupsToKeep: -10 },
        method: 'patch',
        user: adminUser,
      }),
    )
    expect(res2.status).toBe(200)
    const updateCall2 = vi.mocked(payload.update!).mock.calls[1][0] as {
      data: { backupsToKeep: number }
    }
    expect(updateCall2.data.backupsToKeep).toBe(1)
  })

  it('preserves the stored token when the client sends a masked placeholder', async () => {
    const ep = findEndpoint('patch')
    const payload = payloadWithSettings()
    const masked = 'vercel_blob_rw_stored-tok************'
    await ep.handler(
      makeMockRequest(payload, {
        body: { backupBlobReadWriteToken: masked, backupsToKeep: 5 },
        method: 'patch',
        user: adminUser,
      }),
    )
    const updateCall = vi.mocked(payload.update!).mock.calls[0][0] as {
      data: { backupBlobReadWriteToken: string }
    }
    expect(updateCall.data.backupBlobReadWriteToken).toBe(storedDoc.backupBlobReadWriteToken)
    expect(validateBackupBlobToken).not.toHaveBeenCalled()
  })

  it('revalidates when the client sends a NEW plain token', async () => {
    const ep = findEndpoint('patch')
    const payload = payloadWithSettings()
    await ep.handler(
      makeMockRequest(payload, {
        body: { backupBlobReadWriteToken: 'vercel_blob_rw_brand_new_token' },
        method: 'patch',
        user: adminUser,
      }),
    )
    expect(validateBackupBlobToken).toHaveBeenCalledWith('vercel_blob_rw_brand_new_token')
  })

  it('returns 422 when the new token is rejected by validation', async () => {
    vi.mocked(validateBackupBlobToken).mockResolvedValueOnce({ error: 'Unauthorized', ok: false })
    const ep = findEndpoint('patch')
    const payload = payloadWithSettings()
    const res = await ep.handler(
      makeMockRequest(payload, {
        body: { backupBlobReadWriteToken: 'vercel_blob_rw_bogus' },
        method: 'patch',
        user: adminUser,
      }),
    )
    expect(res.status).toBe(422)
    const body = (await readJsonBody(res)) as { error: string }
    expect(body.error).toMatch(/rejected/i)
  })

  it('leaves backupBlobAccess null and skips validation when no token is ever provided', async () => {
    const ep = findEndpoint('patch')
    const payload = payloadWithSettings({
      ...storedDoc,
      backupBlobAccess: null,
      backupBlobReadWriteToken: '',
    } as unknown as typeof storedDoc)
    await ep.handler(
      makeMockRequest(payload, {
        body: { backupBlobReadWriteToken: '' },
        method: 'patch',
        user: adminUser,
      }),
    )
    expect(validateBackupBlobToken).not.toHaveBeenCalled()
    const updateCall = vi.mocked(payload.update!).mock.calls[0][0] as {
      data: { backupBlobAccess: null | string; backupBlobReadWriteToken: string }
    }
    expect(updateCall.data.backupBlobAccess).toBeNull()
    expect(updateCall.data.backupBlobReadWriteToken).toBe('')
  })
})
