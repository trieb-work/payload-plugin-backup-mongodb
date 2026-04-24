import { EJSON } from 'bson'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { MongoDb } from '../../src/core/db.js'

import { restoreBackup } from '../../src/core/restore.js'

vi.mock('@vercel/blob', () => ({
  put: vi.fn(),
}))

vi.mock('node:fs/promises', () => ({
  default: {
    mkdir: vi.fn(),
    readdir: vi.fn(),
    readFile: vi.fn(),
    writeFile: vi.fn(),
  },
}))

vi.mock('../../src/core/taskProgress', () => ({
  updateBackupTask: vi.fn().mockResolvedValue(undefined),
}))

const mockCollection = {
  bulkWrite: vi.fn().mockResolvedValue({ ok: 1, upsertedCount: 2 }),
  deleteMany: vi.fn().mockResolvedValue({ deletedCount: 0 }),
  find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
  indexes: vi.fn().mockResolvedValue([]),
}

const mockDb: MongoDb = {
  collection: vi.fn().mockReturnValue(mockCollection),
  listCollections: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
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
  logger: mockLogger,
} as any

const makeJsonBackupUrl = (data: Record<string, any[]>) => {
  const url = 'https://blob.com/backup.json'
  const encoded = new TextEncoder().encode(EJSON.stringify(data))
  global.fetch = vi.fn().mockResolvedValue({
    arrayBuffer: vi.fn().mockResolvedValue(encoded.buffer),
    ok: true,
    status: 200,
  }) as any
  return url
}

describe('restoreBackup', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('fetches the backup URL and restores collections', async () => {
    const data = {
      pages: [
        { _id: 'page1', title: 'Home' },
        { _id: 'page2', title: 'About' },
      ],
    }
    const url = makeJsonBackupUrl(data)

    await restoreBackup(mockPayload, url)

    expect(fetch).toHaveBeenCalledWith(url)
    expect(mockDb.collection).toHaveBeenCalledWith('pages')
    expect(mockCollection.deleteMany).toHaveBeenCalledWith({})
    expect(mockCollection.bulkWrite).toHaveBeenCalledOnce()
  })

  it('skips collections in the blacklist', async () => {
    const data = {
      pages: [{ _id: 'page1', title: 'Home' }],
      users: [{ _id: 'user1', email: 'admin@example.com' }],
    }
    const url = makeJsonBackupUrl(data)

    await restoreBackup(mockPayload, url, ['users'])

    expect(mockDb.collection).not.toHaveBeenCalledWith('users')
    expect(mockDb.collection).toHaveBeenCalledWith('pages')
  })

  it('skips backup-tasks when taskId is set so progress polling still works', async () => {
    const data = {
      'backup-tasks': [{ _id: 'old-task', kind: 'backup', message: 'x', status: 'completed' }],
      pages: [{ _id: 'page1', title: 'Home' }],
    }
    const url = makeJsonBackupUrl(data)

    await restoreBackup(mockPayload, url, [], false, 'current-task-id')

    expect(mockDb.collection).not.toHaveBeenCalledWith('backup-tasks')
    expect(mockDb.collection).toHaveBeenCalledWith('pages')
  })

  it('does not delete existing data when mergeData is true', async () => {
    const data = { pages: [{ _id: 'page1', title: 'Home' }] }
    const url = makeJsonBackupUrl(data)

    await restoreBackup(mockPayload, url, [], true)

    expect(mockCollection.deleteMany).not.toHaveBeenCalled()
    expect(mockCollection.bulkWrite).toHaveBeenCalledOnce()
  })

  it('skips empty collections', async () => {
    const data = { pages: [], users: [] }
    const url = makeJsonBackupUrl(data)

    await restoreBackup(mockPayload, url)

    expect(mockCollection.bulkWrite).not.toHaveBeenCalled()
  })

  it('uses unique indexes for upsert filter when available', async () => {
    mockCollection.indexes.mockResolvedValueOnce([{ key: { _id: 1, email: 1 }, unique: true }])

    const data = { users: [{ _id: 'u1', email: 'test@test.com' }] }
    const url = makeJsonBackupUrl(data)

    await restoreBackup(mockPayload, url)

    const bulkWriteArg = vi.mocked(mockCollection.bulkWrite).mock.calls[0][0]
    const filter = bulkWriteArg[0].updateOne.filter
    expect(filter.$or).toBeDefined()
    expect(filter.$or).toContainEqual({ email: 'test@test.com' })
  })

  it('throws for unsupported file types', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(0)),
      ok: true,
      status: 200,
    }) as any

    await expect(restoreBackup(mockPayload, 'https://blob.com/backup.xml')).rejects.toThrow(
      'not supported',
    )
  })
})
