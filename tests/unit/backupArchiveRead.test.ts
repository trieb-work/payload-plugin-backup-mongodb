import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { getBackupStorageKindMock, readMock } = vi.hoisted(() => ({
  getBackupStorageKindMock: vi.fn((): 's3' | 'vercel-blob' => 's3'),
  readMock: vi.fn(async () => Buffer.from('{"pages":[]}')),
}))

vi.mock('../../src/core/storage/index.js', () => ({
  getBackupStorageKind: getBackupStorageKindMock,
  resolveBackupStorage: vi.fn(() => ({
    read: readMock,
  })),
}))

import { readBackupArchiveBytes } from '../../src/core/backupArchiveRead.js'

describe('readBackupArchiveBytes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getBackupStorageKindMock.mockReturnValue('s3')
    global.fetch = vi.fn() as typeof fetch
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('reads S3 archives via storage.read when archivePathname is provided', async () => {
    const bytes = await readBackupArchiveBytes('https://expired.example/stale-signature', {
      archivePathname: 'backups/manual---db---host---1.json',
    })

    expect(readMock).toHaveBeenCalledWith({
      pathname: 'backups/manual---db---host---1.json',
    })
    expect(fetch).not.toHaveBeenCalled()
    expect(bytes.toString('utf8')).toBe('{"pages":[]}')
  })

  it('falls back to fetch when archivePathname is missing', async () => {
    getBackupStorageKindMock.mockReturnValueOnce('vercel-blob')
    const encoded = new TextEncoder().encode('{"pages":[]}').buffer
    vi.mocked(fetch).mockResolvedValueOnce({
      arrayBuffer: async () => encoded,
      ok: true,
      status: 200,
    } as Response)

    await readBackupArchiveBytes('https://blob.example/backup.json')

    expect(fetch).toHaveBeenCalledWith('https://blob.example/backup.json')
    expect(readMock).not.toHaveBeenCalled()
  })
})
