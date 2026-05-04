import type { Payload } from 'payload'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { MongoDb } from '../../src/core/db.js'

import { createBackup, createMediaBackupFile, listBackups } from '../../src/core/backup.js'

vi.mock('@vercel/blob', () => ({
  del: vi.fn(),
  list: vi.fn(),
  put: vi.fn(),
}))

vi.mock('bson', () => ({
  EJSON: {
    parse: vi.fn((data) => JSON.parse(data)),
    stringify: vi.fn((data) => JSON.stringify(data)),
  },
}))

import { del, list, put } from '@vercel/blob'

const mockDb: MongoDb = {
  collection: vi.fn().mockReturnValue({
    bulkWrite: vi.fn().mockResolvedValue({ ok: 1 }),
    deleteMany: vi.fn().mockResolvedValue({ deletedCount: 0 }),
    find: vi.fn().mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        { _id: '1', title: 'Test Page' },
        { _id: '2', title: 'Test Page 2' },
      ]),
    }),
    indexes: vi.fn().mockResolvedValue([]),
  }),
  listCollections: vi.fn().mockReturnValue({
    toArray: vi.fn().mockResolvedValue([{ name: 'pages' }, { name: 'users' }]),
  }),
}

const mockLogger = {
  debug: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
}

const mockPayload = {
  db: {
    name: 'mongoose',
    connection: {
      db: mockDb,
    },
  },
  find: vi.fn().mockResolvedValue({ docs: [] }),
  logger: mockLogger,
} as any

describe('listBackups', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.BLOB_READ_WRITE_TOKEN = 'env-test-token'
  })

  it('returns blobs from the backups/ prefix (token from env via settings + resolve)', async () => {
    const mockBlobs = [
      {
        downloadUrl: 'https://blob.com/1.json?download=1',
        etag: '"m1"',
        pathname: 'backups/manual---db---host---123.json',
        size: 1000,
        uploadedAt: new Date(),
        url: 'https://blob.com/1.json',
      },
    ]
    vi.mocked(list).mockResolvedValue({ blobs: mockBlobs, cursor: undefined, hasMore: false })

    const blobs = await listBackups(mockPayload)

    expect(list).toHaveBeenCalledWith({
      limit: 1000,
      prefix: 'backups/',
      token: 'env-test-token',
    })
    expect(blobs).toEqual(mockBlobs)
  })

  it('returns empty array when no backups exist', async () => {
    vi.mocked(list).mockResolvedValue({ blobs: [], cursor: undefined, hasMore: false })

    const blobs = await listBackups(mockPayload)
    expect(blobs).toEqual([])
  })

  it('returns empty array when no blob token can be resolved', async () => {
    const prev = process.env.BLOB_READ_WRITE_TOKEN
    delete process.env.BLOB_READ_WRITE_TOKEN
    vi.mocked(list).mockReset()

    const blobs = await listBackups(mockPayload)

    expect(blobs).toEqual([])
    expect(list).not.toHaveBeenCalled()
    if (prev !== undefined) {
      process.env.BLOB_READ_WRITE_TOKEN = prev
    }
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
      downloadUrl: `https://blob.com/cron-${i}.json?download=1`,
      etag: `"c${i}"`,
      pathname: `backups/cron-${i}.json`,
      size: 500,
      uploadedAt: new Date(Date.now() - i * 1000),
      url: `https://blob.com/cron-${i}.json`,
    }))
    vi.mocked(list)
      .mockResolvedValueOnce({ blobs: oldBlobs, cursor: undefined, hasMore: false })
      .mockResolvedValue({ blobs: [], cursor: undefined, hasMore: false })
    vi.mocked(put).mockResolvedValue({ url: 'https://blob.com/new.json' } as any)

    await createBackup(mockPayload, { backupsToKeep: 10, cron: true, includeMedia: false })

    expect(del).toHaveBeenCalledTimes(3)
  })

  it('queries all collections and includes them in the backup', async () => {
    vi.mocked(put).mockResolvedValue({ url: 'https://blob.com/test.json' } as any)

    await createBackup(mockPayload, { cron: false, includeMedia: false })

    expect(mockDb.listCollections).toHaveBeenCalled()
    expect(mockDb.collection).toHaveBeenCalledWith('pages')
    expect(mockDb.collection).toHaveBeenCalledWith('users')
  })

  it('includes the sanitized label in the uploaded blob pathname', async () => {
    vi.mocked(put).mockResolvedValue({ url: 'https://blob.com/test.json' } as any)

    await createBackup(mockPayload, {
      cron: false,
      includeMedia: false,
      label: '  Pre release   snapshot ',
    })

    const [name] = vi.mocked(put).mock.calls[0]
    expect(name).toMatch(/^backups\/manual---/)
    expect(name).toContain(`---${encodeURIComponent('Pre release snapshot')}.json`)
  })

  it('ignores the label on cron backups', async () => {
    vi.mocked(list).mockResolvedValue({ blobs: [], cursor: undefined, hasMore: false })
    vi.mocked(put).mockResolvedValue({ url: 'https://blob.com/test.json' } as any)

    await createBackup(mockPayload, { cron: true, includeMedia: false, label: 'ignored' })

    const [name] = vi.mocked(put).mock.calls[0]
    expect(name).not.toContain(encodeURIComponent('ignored'))
    expect(name).toMatch(/---\d+-\d{10,}\.json$/)
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
      downloadUrl: 'https://blob.com/image.png?download=1',
      etag: '"img"',
      pathname: 'image.png',
      size: 1024,
      uploadedAt: new Date(),
      url: 'https://blob.com/image.png',
    }
    vi.mocked(list).mockResolvedValue({ blobs: [mockBlobFile], cursor: undefined, hasMore: false })

    global.fetch = vi.fn().mockResolvedValue({
      arrayBuffer: vi.fn().mockResolvedValue(Buffer.from('fake-image-data').buffer),
      ok: true,
      status: 200,
    }) as any

    const mediaCollection = [{ filename: 'image.png' }]
    const result = await createMediaBackupFile('{"pages":[]}', mediaCollection)

    expect(result).toBeInstanceOf(Buffer)
    expect(result[0]).toBe(0x1f)
    expect(result[1]).toBe(0x8b)
  })

  it('skips missing media files with a warning', async () => {
    vi.mocked(list).mockResolvedValue({ blobs: [], cursor: undefined, hasMore: false })
    const warn = vi.fn()
    const mockPayload = {
      logger: { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn },
    } as unknown as Payload

    const result = await createMediaBackupFile(
      '{}',
      [{ filename: 'missing.png' }],
      undefined,
      undefined,
      mockPayload,
    )

    expect(warn).toHaveBeenCalledWith(
      { filename: 'missing.png' },
      expect.stringMatching(/not in blob storage/i),
    )
    expect(result).toBeInstanceOf(Buffer)
  })
})
