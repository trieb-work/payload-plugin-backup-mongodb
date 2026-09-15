import { EJSON } from 'bson'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import type { MongoDb } from '../../src/core/db.js'

import { createBackup, listBackups } from '../../src/core/backup.js'
import { restoreBackup } from '../../src/core/restore.js'
import { loadS3Config } from '../../src/core/storage/config.js'
import { S3BackupStorage } from '../../src/core/storage/s3.js'
import {
  applyLiveS3Env,
  ensureLiveS3Bucket,
  isLiveS3Configured,
  restoreS3Env,
  saveS3Env,
} from './helpers/minioLive.js'

const LIVE = isLiveS3Configured()

describe.skipIf(!LIVE)('S3BackupStorage against live MinIO', () => {
  let savedEnv: Record<string, string | undefined>
  let storage: S3BackupStorage

  beforeAll(async () => {
    savedEnv = saveS3Env()
    applyLiveS3Env()
    await ensureLiveS3Bucket()
    storage = new S3BackupStorage(loadS3Config())
    const validation = await storage.validate()
    expect(validation.ok, validation.error).toBe(true)
  }, 60_000)

  afterAll(() => {
    restoreS3Env(savedEnv)
  })

  it('put → list → read → openDownloadStream → del roundtrip', async () => {
    const pathname = `backups/live-minio---testdb---localhost---2-${Date.now()}.json`
    const body = JSON.stringify({ pages: [{ _id: '1', title: 'live test' }] })

    const putRes = await storage.put(pathname, body)
    expect(putRes.pathname).toBe(pathname)
    expect(putRes.url).toMatch(/^https?:\/\//)

    const listed = await storage.list('backups/')
    expect(listed.some((o) => o.pathname === pathname)).toBe(true)

    const readBuf = await storage.read({ pathname })
    expect(readBuf.toString('utf8')).toBe(body)

    const streamRes = await storage.openDownloadStream({ pathname })
    expect(streamRes?.contentType).toBe('application/json')
    expect(streamRes?.stream).toBeTruthy()

    await storage.del({ pathname })
    const afterDelete = await storage.list('backups/')
    expect(afterDelete.some((o) => o.pathname === pathname)).toBe(false)
  }, 60_000)
})

describe.skipIf(!LIVE)('backup core flow against live MinIO (no @vercel/blob)', () => {
  let savedEnv: Record<string, string | undefined>

  const mockDb: MongoDb = {
    collection: vi.fn().mockReturnValue({
      bulkWrite: vi.fn().mockResolvedValue({ ok: 1, upsertedCount: 1 }),
      deleteMany: vi.fn().mockResolvedValue({ deletedCount: 0 }),
      find: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([{ _id: '1', title: 'Roundtrip page' }]),
      }),
      indexes: vi.fn().mockResolvedValue([]),
    }),
    listCollections: vi.fn().mockReturnValue({
      toArray: vi.fn().mockResolvedValue([{ name: 'pages' }]),
    }),
  }

  const mockPayload = {
    db: { name: 'mongoose', connection: { db: mockDb } },
    find: vi.fn().mockResolvedValue({ docs: [] }),
    logger: { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() },
  } as any

  beforeAll(async () => {
    savedEnv = saveS3Env()
    applyLiveS3Env()
    process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/live-minio-test'
    process.env.NEXT_PUBLIC_SERVER_URL = 'http://127.0.0.1:3000'
    await ensureLiveS3Bucket()
  }, 60_000)

  afterAll(async () => {
    restoreS3Env(savedEnv)
  })

  it('createBackup uploads to MinIO, listBackups finds it, restoreBackup reads presigned URL', async () => {
    await createBackup(mockPayload, {
      cron: false,
      includeMedia: false,
      label: 'minio-live',
    })

    const backups = await listBackups(mockPayload)
    const created = backups.find((b) => b.pathname.includes(encodeURIComponent('minio-live')))
    expect(created, 'expected a backup with label minio-live').toBeTruthy()

    await restoreBackup(mockPayload, created!.downloadUrl, ['users'], false, undefined, {
      blobAccess: 'public',
      blobToken: undefined,
      restoreArchiveMedia: false,
    })

    expect(mockDb.collection).toHaveBeenCalledWith('pages')

    const storage = new S3BackupStorage(loadS3Config())
    await storage.del({ pathname: created!.pathname })
  }, 120_000)

  it('restoreBackup parses JSON fetched from a presigned MinIO URL', async () => {
    const storage = new S3BackupStorage(loadS3Config())
    const pathname = `backups/live-restore---testdb---localhost---2-${Date.now()}.json`
    const data = { posts: [{ _id: 'p1', title: 'from minio' }] }
    const putRes = await storage.put(pathname, EJSON.stringify(data))

    await restoreBackup(mockPayload, putRes.url, [], false)

    expect(mockDb.collection).toHaveBeenCalledWith('posts')
    await storage.del({ pathname })
  }, 60_000)
})
