import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../src/core/blobTokenValidate', () => ({
  validateBackupBlobToken: vi.fn(async () => ({ access: 'private', ok: true })),
}))

import { validateBackupBlobToken } from '../../src/core/blobTokenValidate'
import { createAdminValidateBlobTokenEndpoint } from '../../src/endpoints/paths/admin-validate-blob-token'
import { makeMockPayload, makeMockRequest, readJsonBody } from './helpers'

const adminUser = { id: 'u1' }

describe('POST /backup-mongodb/admin/validate-blob-token', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    delete process.env.PAYLOAD_BACKUP_ALLOWED_ROLES
  })

  it('returns 401 for unauthenticated requests', async () => {
    const ep = createAdminValidateBlobTokenEndpoint({})
    const res = await ep.handler(
      makeMockRequest(makeMockPayload(), { body: { token: 'anything' }, user: null }),
    )
    expect(res.status).toBe(401)
  })

  it('returns 200 + { ok: true, access } when the token is accepted', async () => {
    const ep = createAdminValidateBlobTokenEndpoint({})
    const res = await ep.handler(
      makeMockRequest(makeMockPayload(), {
        body: { token: 'vercel_blob_rw_good' },
        user: adminUser,
      }),
    )
    expect(res.status).toBe(200)
    const body = (await readJsonBody(res)) as { access: string; ok: boolean }
    expect(body.ok).toBe(true)
    expect(body.access).toBe('private')
  })

  it('returns 422 when the token is rejected', async () => {
    vi.mocked(validateBackupBlobToken).mockResolvedValueOnce({
      error: 'Unauthorized',
      ok: false,
    })
    const ep = createAdminValidateBlobTokenEndpoint({})
    const res = await ep.handler(
      makeMockRequest(makeMockPayload(), {
        body: { token: 'broken' },
        user: adminUser,
      }),
    )
    expect(res.status).toBe(422)
    const body = (await readJsonBody(res)) as { error: string; ok: boolean }
    expect(body.ok).toBe(false)
    expect(body.error).toBe('Unauthorized')
  })

  it('passes an empty string to the validator when token is missing in the body', async () => {
    const ep = createAdminValidateBlobTokenEndpoint({})
    vi.mocked(validateBackupBlobToken).mockResolvedValueOnce({ error: 'Token is empty', ok: false })
    const res = await ep.handler(makeMockRequest(makeMockPayload(), { body: {}, user: adminUser }))
    expect(validateBackupBlobToken).toHaveBeenCalledWith('')
    expect(res.status).toBe(422)
  })
})
