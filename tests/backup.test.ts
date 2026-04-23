import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createBackup, listBackups, createMediaBackupFile } from '../src/core/backup.js'
import type { MongoDb } from '../src/core/db.js'

vi.mock('@vercel/blob', () => ({
  list: vi.fn(),
  put: vi.fn(),
  del: vi.fn(),
}))

vi.mock('bson', () => ({
  EJSON: {
    stringify: vi.fn((data) => JSON.stringify(data)),
    parse: vi.fn((data) => JSON.parse(data)),
  },
}))

import { list, put, del } from '@vercel/blob'

const mockDb: MongoDb = {
  listCollections: vi.fn().mockReturnValue({
    toArray: vi.fn().mockResolvedValue([{ name: 'pages' }, { name: 'users' }]),
  }),
  collection: vi.fn().mockReturnValue({
    find: vi.fn().mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        { _id: '1', title: 'Test Page' },
        { _id: '2', title: 'Test Page 2' },
      ]),
    }),
    deleteMany: vi.fn().mockResolvedValue({ deletedCount: 0 }),
    bulkWrite: vi.fn().mockResolvedValue({ ok: 1 }),
    indexes: vi.fn().mockResolvedValue([]),
  }),
}

const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}

const mockPayload = {
  db: {
    name: 'mongoose',
    connection: {
      db: mockDb,
    },
  },
  logger: mockLogger,
} as any

describe('listBackups', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns blobs from the backups/ prefix', async () => {
    const mockBlobs = [
      {
        pathname: 'backups/manual---db---host---123.json',
        url: 'https://blob.com/1.json',
        downloadUrl: 'https://blob.com/1.json?download=1',
        size: 1000,
        uploadedAt: new Date(),
        etag: '"m1"',
      },
    ]
    vi.mocked(list).mockResolvedValue({ blobs: mockBlobs, cursor: undefined, hasMore: false })

    const blobs = await listBackups()

    expect(list).toHaveBeenCalledWith({ prefix: 'backups/', limit: 1000 })
    expect(blobs).toEqual(mockBlobs)
  })

  it('returns empty array when no backups exist', async () => {
    vi.mocked(list).mockResolvedValue({ blobs: [], cursor: undefined, hasMore: false })

    const blobs = await listBackups()
    expect(blobs).toEqual([])
  })
})

describe('createBackup', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.MONGODB_URI = 'mongodb://localhost/testdb'
    process.env.NEXT_PUBLIC_SERVER_URL = 'https://test.example.com'
  })

  it('calls put with a json file for non-media backups', async () => {
    vi.mocked(put).mockResolvedValue({ url: 'https://blob.com/test.json' } as any)

    await createBackup(mockPayload, { cron: false, includeMedia: false })

    expect(put).toHaveBeenCalledOnce()
    const [name, content] = vi.mocked(put).mock.calls[0]
    expect(name).toMatch(/^backups\/manual---/)
    expect(name).toMatch(/\.json$/)
    // two collections (pages, users) + ms timestamp in tail
    expect(name).toMatch(/---2-\d{10,}\.json$/)
    expect(typeof content === 'string').toBe(true)
  })

  it('uses cron prefix for cron backups', async () => {
    vi.mocked(list).mockResolvedValue({ blobs: [], cursor: undefined, hasMore: false })
    vi.mocked(put).mockResolvedValue({ url: 'https://blob.com/test.json' } as any)

    await createBackup(mockPayload, { cron: true, includeMedia: false })

    const [name] = vi.mocked(put).mock.calls[0]
    expect(name).toMatch(/^backups\/cron---/)
  })

  it('deletes old cron backups when limit is exceeded', async () => {
    const oldBlobs = Array.from({ length: 12 }, (_, i) => ({
      url: `https://blob.com/cron-${i}.json`,
      downloadUrl: `https://blob.com/cron-${i}.json?download=1`,
      pathname: `backups/cron-${i}.json`,
      size: 500,
      uploadedAt: new Date(Date.now() - i * 1000),
      etag: `"c${i}"`,
    }))
    vi.mocked(list)
      .mockResolvedValueOnce({ blobs: oldBlobs, cursor: undefined, hasMore: false })
      .mockResolvedValue({ blobs: [], cursor: undefined, hasMore: false })
    vi.mocked(put).mockResolvedValue({ url: 'https://blob.com/new.json' } as any)

    await createBackup(mockPayload, { cron: true, includeMedia: false, backupsToKeep: 10 })

    expect(del).toHaveBeenCalledTimes(3)
  })

  it('queries all collections and includes them in the backup', async () => {
    vi.mocked(put).mockResolvedValue({ url: 'https://blob.com/test.json' } as any)

    await createBackup(mockPayload, { cron: false, includeMedia: false })

    expect(mockDb.listCollections).toHaveBeenCalled()
    expect(mockDb.collection).toHaveBeenCalledWith('pages')
    expect(mockDb.collection).toHaveBeenCalledWith('users')
  })

  it('throws when db adapter is not mongoose', async () => {
    const wrongPayload = {
      db: { name: 'postgres', connection: {} },
      logger: mockLogger,
    } as any

    await expect(createBackup(wrongPayload)).rejects.toThrow('Not a mongoose database adapter')
  })

  it('throws when db is not initialized', async () => {
    const uninitPayload = {
      db: { name: 'mongoose', connection: { db: undefined } },
      logger: mockLogger,
    } as any

    await expect(createBackup(uninitPayload)).rejects.toThrow('Database not initialized')
  })
})

describe('createMediaBackupFile', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('creates a tar.gz archive containing collections and media files', async () => {
    const mockBlobFile = {
      pathname: 'image.png',
      url: 'https://blob.com/image.png',
      downloadUrl: 'https://blob.com/image.png?download=1',
      size: 1024,
      uploadedAt: new Date(),
      etag: '"img"',
    }
    vi.mocked(list).mockResolvedValue({ blobs: [mockBlobFile], cursor: undefined, hasMore: false })

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      arrayBuffer: vi.fn().mockResolvedValue(Buffer.from('fake-image-data').buffer),
    }) as any

    const mediaCollection = [{ filename: 'image.png' }]
    const result = await createMediaBackupFile('{"pages":[]}', mediaCollection)

    expect(result).toBeInstanceOf(Buffer)
    expect(result[0]).toBe(0x1f)
    expect(result[1]).toBe(0x8b)
  })

  it('skips missing media files with a warning', async () => {
    vi.mocked(list).mockResolvedValue({ blobs: [], cursor: undefined, hasMore: false })
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const result = await createMediaBackupFile('{}', [{ filename: 'missing.png' }])

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('not in blob storage'),
      'missing.png',
    )
    expect(result).toBeInstanceOf(Buffer)
    consoleSpy.mockRestore()
  })
})
