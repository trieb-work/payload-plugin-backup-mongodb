import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../src/core/backup', () => ({
  listBackups: vi.fn(async () => []),
  resolveBackupListToken: vi.fn(async () => 'env-token'),
}))

import { listBackups, resolveBackupListToken } from '../../src/core/backup'
import { createCronListEndpoint } from '../../src/endpoints/paths/cron-list'
import { makeMockPayload, makeMockRequest, readJsonBody } from './helpers'

describe('GET /backup-mongodb/cron/list', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.CRON_SECRET = 'cron-secret'
    vi.mocked(resolveBackupListToken).mockResolvedValue('env-token')
  })

  it('returns 401 when bearer does not match CRON_SECRET', async () => {
    const ep = createCronListEndpoint()
    const res = await ep.handler(
      makeMockRequest(makeMockPayload(), {
        headers: { authorization: 'Bearer wrong' },
        method: 'get',
      }),
    )
    expect(res.status).toBe(401)
  })

  it('returns 503 when no backup token can be resolved', async () => {
    vi.mocked(resolveBackupListToken).mockResolvedValueOnce('')
    const ep = createCronListEndpoint()
    const res = await ep.handler(
      makeMockRequest(makeMockPayload(), {
        headers: { authorization: 'Bearer cron-secret' },
        method: 'get',
      }),
    )
    expect(res.status).toBe(503)
  })

  it('returns 200 with the blob list on success', async () => {
    const blobs = [
      {
        pathname: 'backups/manual---db---host---1-1700000000000.json',
        size: 123,
        uploadedAt: new Date().toISOString(),
        url: 'https://blob/x.json',
      },
    ] as unknown as ReturnType<typeof vi.fn>[]
    vi.mocked(listBackups).mockResolvedValueOnce(blobs as never)
    const ep = createCronListEndpoint()
    const res = await ep.handler(
      makeMockRequest(makeMockPayload(), {
        headers: { authorization: 'Bearer cron-secret' },
        method: 'get',
      }),
    )
    expect(res.status).toBe(200)
    const body = (await readJsonBody(res)) as unknown[]
    expect(Array.isArray(body)).toBe(true)
    expect(body).toHaveLength(1)
  })
})
