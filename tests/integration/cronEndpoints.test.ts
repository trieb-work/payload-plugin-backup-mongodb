/**
 * Manual cron trigger (dev), same as Vercel:
 *
 * ```bash
 * curl -sS -D - "http://localhost:3000/api/backup-mongodb/cron/run" \
 *   -H "Authorization: Bearer $CRON_SECRET"
 * ```
 *
 * Expect `202` when `BLOB_READ_WRITE_TOKEN` and `CRON_SECRET` are set and Payload is up.
 */
import { after } from 'next/server'
import { describe, expect, it, vi, afterEach } from 'vitest'

import { createBackupMongodbEndpoints } from '../../src/endpoints/index.js'
import { createCronRunEndpoint } from '../../src/endpoints/paths/cron-run.js'

/** Next `after` accepts a Promise or work function; the handler passes a Promise. */
vi.mock('next/server', () => ({
  after: vi.fn((work: unknown) => {
    void work
  }),
}))

vi.mock('../../src/core/backup', () => ({
  createBackup: vi.fn(() => Promise.resolve()),
}))

vi.mock('../../src/core/backupSettings', () => ({
  getResolvedCronBackupSettings: vi.fn(() =>
    Promise.resolve({
      backupBlobAccess: null,
      backupBlobReadWriteToken: '',
      id: 'test',
      backupsToKeep: 10,
      skipMongoCollections: [] as string[],
      includeMediaForCron: false,
    }),
  ),
  resolveBackupBlobToken: vi.fn(
    (settings: { backupBlobReadWriteToken?: string }) =>
      settings.backupBlobReadWriteToken || process.env.BLOB_READ_WRITE_TOKEN || '',
  ),
  resolveBackupBlobAccess: vi.fn(() => 'public' as const),
}))

describe('cron backup endpoints', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('registers cron routes under /backup-mongodb/cron/...', () => {
    const eps = createBackupMongodbEndpoints({})
    const find = (path: string) => eps.find((e) => e.path === path)
    expect(find('/backup-mongodb/cron/run')?.method).toBe('get')
    expect(find('/backup-mongodb/cron/list')?.method).toBe('get')
    expect(find('/backup-mongodb/cron/restore')?.method).toBe('post')
  })

  it('cron run returns 503 when BLOB_READ_WRITE_TOKEN is missing', async () => {
    const prevBlob = process.env.BLOB_READ_WRITE_TOKEN
    const prevCron = process.env.CRON_SECRET
    delete process.env.BLOB_READ_WRITE_TOKEN
    process.env.CRON_SECRET = 'x'
    try {
      const ep = createCronRunEndpoint({})
      const res = await ep.handler({
        headers: new Headers({ authorization: 'Bearer x' }),
        payload: { logger: { info: vi.fn(), error: vi.fn() } },
      } as never)
      expect(res.status).toBe(503)
    } finally {
      if (prevBlob !== undefined) process.env.BLOB_READ_WRITE_TOKEN = prevBlob
      else delete process.env.BLOB_READ_WRITE_TOKEN
      if (prevCron !== undefined) process.env.CRON_SECRET = prevCron
      else delete process.env.CRON_SECRET
    }
  })

  it('cron run returns 401 when bearer does not match CRON_SECRET', async () => {
    const prevBlob = process.env.BLOB_READ_WRITE_TOKEN
    const prevCron = process.env.CRON_SECRET
    process.env.BLOB_READ_WRITE_TOKEN = 'blob-token'
    process.env.CRON_SECRET = 'expected-secret'
    try {
      const ep = createCronRunEndpoint({})
      const res = await ep.handler({
        headers: new Headers({ authorization: 'Bearer wrong' }),
        payload: { logger: { info: vi.fn(), error: vi.fn() } },
      } as never)
      expect(res.status).toBe(401)
    } finally {
      if (prevBlob !== undefined) process.env.BLOB_READ_WRITE_TOKEN = prevBlob
      else delete process.env.BLOB_READ_WRITE_TOKEN
      if (prevCron !== undefined) process.env.CRON_SECRET = prevCron
      else delete process.env.CRON_SECRET
    }
  })

  it('cron run returns 202 and queues createBackup when auth and env are valid', async () => {
    const prevBlob = process.env.BLOB_READ_WRITE_TOKEN
    const prevCron = process.env.CRON_SECRET
    process.env.BLOB_READ_WRITE_TOKEN = 'blob-token'
    process.env.CRON_SECRET = 'expected-secret'
    try {
      const { createBackup } = await import('../../src/core/backup.js')
      const ep = createCronRunEndpoint({ backupsToKeep: 7 })
      const res = await ep.handler({
        headers: new Headers({ authorization: 'Bearer expected-secret' }),
        payload: {
          logger: { info: vi.fn(), error: vi.fn() },
        },
      } as never)
      expect(res.status).toBe(202)
      expect(after).toHaveBeenCalled()
      expect(createBackup).toHaveBeenCalled()
      const call = vi.mocked(createBackup).mock.calls[0]
      expect(call[1]).toMatchObject({
        cron: true,
        backupsToKeep: 7,
        skipCollections: [],
        includeMedia: false,
        blobAccess: 'public',
      })
    } finally {
      if (prevBlob !== undefined) process.env.BLOB_READ_WRITE_TOKEN = prevBlob
      else delete process.env.BLOB_READ_WRITE_TOKEN
      if (prevCron !== undefined) process.env.CRON_SECRET = prevCron
      else delete process.env.CRON_SECRET
    }
  })
})
