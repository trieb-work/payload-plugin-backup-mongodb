import { beforeEach, describe, expect, it, vi } from 'vitest'

// Use `vi.hoisted` so the mock is defined before `vi.mock` is hoisted above the file.
const { delMock } = vi.hoisted(() => ({
  delMock: vi.fn<(...args: unknown[]) => Promise<void>>(async () => undefined),
}))

vi.mock('@vercel/blob', () => ({
  del: delMock,
}))

vi.mock('next/server', () => ({
  after: vi.fn((work: unknown) => {
    void work
  }),
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
  createBackupTask: vi.fn(async () => ({ pollSecret: 'secret', taskId: 'task-d' })),
  failBackupTask: vi.fn(async () => undefined),
  updateBackupTask: vi.fn(async () => undefined),
}))

import { getResolvedCronBackupSettings } from '../../src/core/backupSettings'
import { createAdminDeleteEndpoint } from '../../src/endpoints/paths/admin-delete'
import { makeMockPayload, makeMockRequest, readJsonBody } from './helpers'

const adminUser = { id: 'u1' }

describe('POST /backup-mongodb/admin/delete', () => {
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
    const ep = createAdminDeleteEndpoint({})
    const res = await ep.handler(makeMockRequest(makeMockPayload(), { body: {}, user: adminUser }))
    expect(res.status).toBe(503)
  })

  it('returns 400 when url or pathname is missing', async () => {
    const ep = createAdminDeleteEndpoint({})
    const res = await ep.handler(
      makeMockRequest(makeMockPayload(), {
        body: { pathname: 'backups/x.json' },
        user: adminUser,
      }),
    )
    expect(res.status).toBe(400)
    const res2 = await ep.handler(
      makeMockRequest(makeMockPayload(), {
        body: { url: 'https://blob/x.json' },
        user: adminUser,
      }),
    )
    expect(res2.status).toBe(400)
  })

  it('queues a delete task and responds 202 with pollSecret + taskId', async () => {
    const ep = createAdminDeleteEndpoint({})
    const res = await ep.handler(
      makeMockRequest(makeMockPayload(), {
        body: {
          pathname: 'backups/manual---db---host---1-1700000000000.json',
          url: 'https://blob/backup.json',
        },
        user: adminUser,
      }),
    )
    expect(res.status).toBe(202)
    const body = (await readJsonBody(res)) as { pollSecret: string; taskId: string }
    expect(body.taskId).toBe('task-d')
    expect(body.pollSecret).toBe('secret')
  })
})
