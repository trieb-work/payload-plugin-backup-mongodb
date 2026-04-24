import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../src/core/restore', () => ({
  restoreBackup: vi.fn(async () => undefined),
}))

vi.mock('../../src/core/backupSettings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/core/backupSettings')>()
  return {
    ...actual,
    getResolvedCronBackupSettings: vi.fn(async () => ({
      id: 'settings-1',
      backupBlobAccess: 'public' as const,
      backupBlobReadWriteToken: '',
      backupsToKeep: 10,
      includeMediaForCron: false,
      skipMongoCollections: [] as string[],
    })),
  }
})

import { getResolvedCronBackupSettings } from '../../src/core/backupSettings'
import { restoreBackup } from '../../src/core/restore'
import { createCronRestoreEndpoint } from '../../src/endpoints/paths/cron-restore'
import { makeMockPayload, makeMockRequest } from './helpers'

describe('POST /backup-mongodb/cron/restore', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.CRON_SECRET = 'cron-secret'
    process.env.BLOB_READ_WRITE_TOKEN = 'env-token'
    vi.mocked(getResolvedCronBackupSettings).mockResolvedValue({
      id: 'settings-1',
      backupBlobAccess: 'public',
      backupBlobReadWriteToken: '',
      backupsToKeep: 10,
      includeMediaForCron: false,
      skipMongoCollections: [],
    })
  })

  it('returns 401 when bearer does not match CRON_SECRET', async () => {
    const ep = createCronRestoreEndpoint()
    const res = await ep.handler(
      makeMockRequest(makeMockPayload(), {
        body: { url: 'https://blob/x.json' },
        headers: { authorization: 'Bearer wrong' },
      }),
    )
    expect(res.status).toBe(401)
  })

  it('returns 503 when no blob token is resolved', async () => {
    vi.mocked(getResolvedCronBackupSettings).mockResolvedValueOnce({
      id: 'settings-1',
      backupBlobAccess: null,
      backupBlobReadWriteToken: '',
      backupsToKeep: 10,
      includeMediaForCron: false,
      skipMongoCollections: [],
    })
    delete process.env.BLOB_READ_WRITE_TOKEN
    const ep = createCronRestoreEndpoint()
    const res = await ep.handler(
      makeMockRequest(makeMockPayload(), {
        body: { url: 'https://blob/x.json' },
        headers: { authorization: 'Bearer cron-secret' },
      }),
    )
    expect(res.status).toBe(503)
  })

  it('returns 400 when url is missing', async () => {
    const ep = createCronRestoreEndpoint()
    const res = await ep.handler(
      makeMockRequest(makeMockPayload(), {
        body: {},
        headers: { authorization: 'Bearer cron-secret' },
      }),
    )
    expect(res.status).toBe(400)
  })

  it('returns 400 when url is not a parsable URL', async () => {
    const ep = createCronRestoreEndpoint()
    const res = await ep.handler(
      makeMockRequest(makeMockPayload(), {
        body: { url: 'not a url' },
        headers: { authorization: 'Bearer cron-secret' },
      }),
    )
    expect(res.status).toBe(400)
  })

  it('returns 202 and awaits restoreBackup on success', async () => {
    const ep = createCronRestoreEndpoint()
    const res = await ep.handler(
      makeMockRequest(makeMockPayload(), {
        body: { url: 'https://blob/x.json' },
        headers: { authorization: 'Bearer cron-secret' },
      }),
    )
    expect(res.status).toBe(202)
    expect(restoreBackup).toHaveBeenCalledOnce()
  })

  it('requires pathname when settings resolve to a private dedicated store', async () => {
    vi.mocked(getResolvedCronBackupSettings).mockResolvedValueOnce({
      id: 'settings-1',
      backupBlobAccess: 'private',
      backupBlobReadWriteToken: 'dedicated',
      backupsToKeep: 10,
      includeMediaForCron: false,
      skipMongoCollections: [],
    })
    const ep = createCronRestoreEndpoint()
    const res = await ep.handler(
      makeMockRequest(makeMockPayload(), {
        body: { url: 'https://blob/x.json' },
        headers: { authorization: 'Bearer cron-secret' },
      }),
    )
    expect(res.status).toBe(400)
  })
})
