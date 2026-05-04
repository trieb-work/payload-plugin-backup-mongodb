import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/server', () => ({
  after: vi.fn((work: unknown) => {
    void work
  }),
}))

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

vi.mock('../../src/core/taskProgress', () => ({
  completeBackupTask: vi.fn(async () => undefined),
  createBackupTask: vi.fn(async () => ({ pollSecret: 'secret-hex', taskId: 'task-7' })),
  failBackupTask: vi.fn(async () => undefined),
}))

import { getResolvedCronBackupSettings } from '../../src/core/backupSettings'
import { restoreBackup } from '../../src/core/restore'
import { createAdminRestoreEndpoint } from '../../src/endpoints/paths/admin-restore'
import { makeMockPayload, makeMockRequest, readJsonBody } from './helpers'

const adminUser = { id: 'u1' }

describe('POST /backup-mongodb/admin/restore', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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

  it('returns 503 when no blob token is available', async () => {
    vi.mocked(getResolvedCronBackupSettings).mockResolvedValueOnce({
      id: 'settings-1',
      backupBlobAccess: null,
      backupBlobReadWriteToken: '',
      backupsToKeep: 10,
      includeMediaForCron: false,
      skipMongoCollections: [],
    })
    delete process.env.BLOB_READ_WRITE_TOKEN
    const ep = createAdminRestoreEndpoint({})
    const res = await ep.handler(
      makeMockRequest(makeMockPayload(), { body: { url: 'https://x' }, user: adminUser }),
    )
    expect(res.status).toBe(503)
  })

  it('rejects missing url with 400', async () => {
    const ep = createAdminRestoreEndpoint({})
    const res = await ep.handler(makeMockRequest(makeMockPayload(), { body: {}, user: adminUser }))
    expect(res.status).toBe(400)
  })

  it('rejects non-URL string with 400', async () => {
    const ep = createAdminRestoreEndpoint({})
    const res = await ep.handler(
      makeMockRequest(makeMockPayload(), { body: { url: 'not-a-url' }, user: adminUser }),
    )
    expect(res.status).toBe(400)
  })

  it('rejects missing pathname for a private backup store with 400', async () => {
    vi.mocked(getResolvedCronBackupSettings).mockResolvedValueOnce({
      id: 'settings-1',
      backupBlobAccess: 'private',
      backupBlobReadWriteToken: 'dedicated-token',
      backupsToKeep: 10,
      includeMediaForCron: false,
      skipMongoCollections: [],
    })
    const ep = createAdminRestoreEndpoint({})
    const res = await ep.handler(
      makeMockRequest(makeMockPayload(), {
        body: { url: 'https://blob/x.json' },
        user: adminUser,
      }),
    )
    expect(res.status).toBe(400)
    const body = (await readJsonBody(res)) as { error: string }
    expect(body.error).toMatch(/pathname/i)
  })

  it('queues restoreBackup with backup-tasks in the blacklist', async () => {
    const ep = createAdminRestoreEndpoint({})
    const res = await ep.handler(
      makeMockRequest(makeMockPayload(), {
        body: {
          skipCollections: ['users'],
          url: 'https://blob/x.json',
        },
        user: adminUser,
      }),
    )
    expect(res.status).toBe(202)
    expect(restoreBackup).toHaveBeenCalledOnce()
    const call = vi.mocked(restoreBackup).mock.calls[0]
    const [, url, blacklist, mergeData, taskId, options] = call as unknown as [
      unknown,
      string,
      string[],
      boolean,
      string,
      { restoreArchiveMedia?: boolean } | undefined,
    ]
    expect(url).toBe('https://blob/x.json')
    expect(blacklist).toContain('backup-tasks')
    expect(blacklist).toContain('users')
    expect(mergeData).toBe(false)
    expect(taskId).toBe('task-7')
    expect(options?.restoreArchiveMedia).toBe(true)
  })

  it('propagates restoreArchiveMedia=false when the client opts out', async () => {
    const ep = createAdminRestoreEndpoint({})
    await ep.handler(
      makeMockRequest(makeMockPayload(), {
        body: { restoreArchiveMedia: false, url: 'https://blob/x.json' },
        user: adminUser,
      }),
    )
    const call = vi.mocked(restoreBackup).mock.calls[0]
    const options = call[5] as { restoreArchiveMedia?: boolean } | undefined
    expect(options?.restoreArchiveMedia).toBe(false)
  })

  it('deduplicates backup-tasks if the client also sent it', async () => {
    const ep = createAdminRestoreEndpoint({})
    await ep.handler(
      makeMockRequest(makeMockPayload(), {
        body: {
          skipCollections: ['backup-tasks', 'backup-tasks', 'users'],
          url: 'https://blob/x.json',
        },
        user: adminUser,
      }),
    )
    const call = vi.mocked(restoreBackup).mock.calls[0]
    const blacklist = call[2] as string[]
    expect(blacklist.filter((n) => n === 'backup-tasks')).toHaveLength(1)
    expect(blacklist).toContain('users')
  })
})
