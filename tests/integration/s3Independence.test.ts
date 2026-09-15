import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createBackup } from '../../src/core/backup.js'
import { restoreBackup } from '../../src/core/restore.js'
import { resolveBackupStorage } from '../../src/core/storage/index.js'
import { S3BackupStorage } from '../../src/core/storage/s3.js'

const S3_ENV_KEYS = [
  'BACKUP_STORAGE',
  'BACKUP_S3_BUCKET',
  'BACKUP_S3_REGION',
  'BACKUP_S3_ENDPOINT',
  'BACKUP_S3_FORCE_PATH_STYLE',
  'BACKUP_S3_PREFIX',
  'BACKUP_S3_ACCESS_KEY_ID',
  'BACKUP_S3_SECRET_ACCESS_KEY',
]

// Track whether any @vercel/blob function was invoked.
let vercelBlobCalls = 0

vi.mock('@vercel/blob', () => {
  const makeThrowing = (name: string) =>
    vi.fn(() => {
      vercelBlobCalls += 1
      throw new Error(`@vercel/blob ${name} should not be called when BACKUP_STORAGE=s3`)
    })
  return {
    del: makeThrowing('del'),
    list: makeThrowing('list'),
    put: makeThrowing('put'),
  }
})

vi.mock('@aws-sdk/client-s3', () => {
  const makeCommand = (kind: string) =>
    class {
      __kind = kind
      input: Record<string, unknown>
      constructor(input: Record<string, unknown>) {
        this.input = input
      }
    }
  return {
    DeleteObjectCommand: makeCommand('delete'),
    GetObjectCommand: makeCommand('get'),
    HeadBucketCommand: makeCommand('head'),
    ListObjectsV2Command: makeCommand('list'),
    S3Client: vi.fn(function (this: { send: typeof vi.fn }) {
      this.send = vi.fn()
    }),
  }
})

vi.mock('@aws-sdk/lib-storage', () => ({
  Upload: vi.fn(function (this: { done: typeof vi.fn }) {
    this.done = vi.fn().mockResolvedValue({})
  }),
}))

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: vi.fn().mockResolvedValue('https://signed.example/object'),
}))

const mockDb = {
  collection: vi.fn().mockReturnValue({
    bulkWrite: vi.fn().mockResolvedValue({ modifiedCount: 0, upsertedCount: 0 }),
    deleteMany: vi.fn().mockResolvedValue({}),
    find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
    indexes: vi.fn().mockResolvedValue([]),
  }),
  listCollections: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
}

const mockPayload = {
  db: { name: 'mongoose', connection: { db: mockDb } },
  logger: { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() },
} as any

describe('S3 independence — no Vercel blob calls when BACKUP_STORAGE=s3', () => {
  let savedEnv: Record<string, string | undefined>

  beforeEach(() => {
    savedEnv = {}
    for (const key of S3_ENV_KEYS) {
      savedEnv[key] = process.env[key]
    }
    // Ensure no Vercel env token leaks in.
    delete process.env.BLOB_READ_WRITE_TOKEN

    process.env.BACKUP_STORAGE = 's3'
    process.env.BACKUP_S3_BUCKET = 'test-bucket'
    process.env.BACKUP_S3_REGION = 'us-east-1'

    vercelBlobCalls = 0
    vi.clearAllMocks()
  })

  afterEach(() => {
    for (const key of S3_ENV_KEYS) {
      if (savedEnv[key] === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = savedEnv[key]
      }
    }
  })

  it('resolveBackupStorage returns S3BackupStorage when BACKUP_STORAGE=s3', () => {
    const storage = resolveBackupStorage()
    expect(storage).toBeInstanceOf(S3BackupStorage)
    expect(storage.kind).toBe('s3')
  })

  it('createBackup does not invoke any @vercel/blob function when BACKUP_STORAGE=s3', async () => {
    await createBackup(mockPayload, { blobToken: undefined, includeMedia: false })
    expect(vercelBlobCalls).toBe(0)
  })

  it('restoreBackup does not invoke any @vercel/blob function when BACKUP_STORAGE=s3', async () => {
    const url = 'https://signed.example/object/backup.json'
    global.fetch = vi.fn().mockResolvedValue({
      arrayBuffer: vi.fn().mockResolvedValue(new TextEncoder().encode('{"pages":[]}').buffer),
      ok: true,
      status: 200,
    }) as any

    await restoreBackup(mockPayload, url, [], false, undefined, {
      blobAccess: 'public',
      blobToken: undefined,
      restoreArchiveMedia: false,
    })

    expect(vercelBlobCalls).toBe(0)
  })

  it('createMediaBackupFile does not invoke @vercel/blob when given an S3 adapter', async () => {
    const { createMediaBackupFile } = await import('../../src/core/backup.js')
    const storage = resolveBackupStorage()
    storage.list = vi.fn().mockResolvedValue([])
    storage.read = vi.fn().mockResolvedValue(Buffer.from('fake'))

    const result = await createMediaBackupFile('{"pages":[]}', [], storage)
    expect(result).toBeInstanceOf(Buffer)
    expect(vercelBlobCalls).toBe(0)
  })

  it('settings endpoint skips Vercel blob validation when BACKUP_STORAGE=s3', async () => {
    const { createAdminSettingsEndpoints } =
      await import('../../src/endpoints/paths/admin-settings.js')

    const eps = createAdminSettingsEndpoints({})
    const patch = eps.find(
      (e) => e.path === '/backup-mongodb/admin/settings' && e.method === 'patch',
    )
    if (!patch) {
      throw new Error('missing patch endpoint')
    }

    const mockPayload = {
      auth: vi.fn().mockResolvedValue({ user: { id: 'u1', role: 'admin' } }),
      find: vi.fn().mockResolvedValue({
        docs: [
          {
            id: 'settings-1',
            backupBlobAccess: 'public',
            backupBlobReadWriteToken: '',
            backupsToKeep: 10,
            includeMediaForCron: false,
            skipMongoCollections: [],
          },
        ],
      }),
      logger: { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() },
      update: vi.fn().mockResolvedValue({ id: 'settings-1' }),
    } as any

    const req = {
      headers: new Headers(),
      json: vi.fn().mockResolvedValue({
        backupBlobReadWriteToken: 'vercel_blob_rw_new_token',
        backupsToKeep: 5,
      }),
      payload: mockPayload,
      searchParams: new URLSearchParams(),
      user: { id: 'u1', role: 'admin' },
    } as any

    const res = await patch.handler(req)
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    // When S3 is active, Vercel token validation is skipped so the settings
    // save succeeds even though the token would be rejected by Vercel.
    expect(body.error).toBeUndefined()
    expect(body.id).toBe('settings-1')
  })
})
