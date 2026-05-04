import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/server', () => ({
  after: vi.fn((work: unknown) => {
    void work
  }),
}))

vi.mock('../../src/core/backup', () => ({
  createBackup: vi.fn(async () => undefined),
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
  createBackupTask: vi.fn(async () => ({ pollSecret: 'secret-hex', taskId: 'task-42' })),
  failBackupTask: vi.fn(async () => undefined),
}))

import { createBackup } from '../../src/core/backup'
import { getResolvedCronBackupSettings } from '../../src/core/backupSettings'
import { createAdminManualEndpoint } from '../../src/endpoints/paths/admin-manual'
import { makeMockPayload, makeMockRequest, readJsonBody } from './helpers'

const adminUser = { id: 'u1' }

describe('POST /backup-mongodb/admin/manual', () => {
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

  it('returns 503 when no blob token can be resolved', async () => {
    vi.mocked(getResolvedCronBackupSettings).mockResolvedValueOnce({
      id: 'settings-1',
      backupBlobAccess: null,
      backupBlobReadWriteToken: '',
      backupsToKeep: 10,
      includeMediaForCron: false,
      skipMongoCollections: [],
    })
    delete process.env.BLOB_READ_WRITE_TOKEN

    const ep = createAdminManualEndpoint({})
    const res = await ep.handler(makeMockRequest(makeMockPayload(), { body: {}, user: adminUser }))
    expect(res.status).toBe(503)
  })

  it('returns 202 with pollSecret + taskId and queues createBackup', async () => {
    const ep = createAdminManualEndpoint({})
    const payload = makeMockPayload()
    const res = await ep.handler(
      makeMockRequest(payload, {
        body: { includeMedia: false, label: '  pre release ' },
        user: adminUser,
      }),
    )
    expect(res.status).toBe(202)
    const body = (await readJsonBody(res)) as { pollSecret: string; taskId: string }
    expect(body.taskId).toBe('task-42')
    expect(body.pollSecret).toBe('secret-hex')
    expect(createBackup).toHaveBeenCalledOnce()
    const [, opts] = vi.mocked(createBackup).mock.calls[0]
    expect(opts).toMatchObject({
      cron: false,
      includeMedia: false,
      label: 'pre release',
      skipCollections: [],
      taskId: 'task-42',
    })
  })

  it('forwards skipCollections and disables includeMedia when "media" is skipped', async () => {
    const ep = createAdminManualEndpoint({})
    const res = await ep.handler(
      makeMockRequest(makeMockPayload(), {
        body: {
          includeMedia: true,
          skipCollections: ['media', 'posts'],
        },
        user: adminUser,
      }),
    )
    expect(res.status).toBe(202)
    const [, opts] = vi.mocked(createBackup).mock.calls[0]
    expect(opts?.skipCollections).toEqual(['media', 'posts'])
    expect(opts?.includeMedia).toBe(false)
  })

  it('keeps includeMedia=true when media is NOT skipped', async () => {
    const ep = createAdminManualEndpoint({})
    await ep.handler(
      makeMockRequest(makeMockPayload(), {
        body: { includeMedia: true, skipCollections: ['posts'] },
        user: adminUser,
      }),
    )
    const [, opts] = vi.mocked(createBackup).mock.calls[0]
    expect(opts?.includeMedia).toBe(true)
  })

  it('filters out non-string / empty entries from skipCollections', async () => {
    const ep = createAdminManualEndpoint({})
    await ep.handler(
      makeMockRequest(makeMockPayload(), {
        body: { skipCollections: ['posts', '', 42, null, 'media'] },
        user: adminUser,
      }),
    )
    const [, opts] = vi.mocked(createBackup).mock.calls[0]
    expect(opts?.skipCollections).toEqual(['posts', 'media'])
  })

  it('omits label when client sends whitespace only', async () => {
    const ep = createAdminManualEndpoint({})
    await ep.handler(
      makeMockRequest(makeMockPayload(), { body: { label: '   ' }, user: adminUser }),
    )
    const [, opts] = vi.mocked(createBackup).mock.calls[0]
    expect(opts?.label).toBeUndefined()
  })
})
