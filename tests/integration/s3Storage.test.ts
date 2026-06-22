import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { BackupS3Config } from '../../src/core/storage/config.js'

import { S3BackupStorage } from '../../src/core/storage/s3.js'

// Shared spies, hoisted so the `vi.mock` factories below can reference them.
const { getSignedUrlMock, sendMock, uploadDone } = vi.hoisted(() => ({
  getSignedUrlMock: vi.fn(async () => 'https://signed.example/object'),
  sendMock: vi.fn(),
  uploadDone: vi.fn(async () => ({})),
}))

// Minimal fakes for the AWS SDK. Each command records its kind + input so `sendMock` can branch.
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
    S3Client: vi.fn(function (this: { send: typeof sendMock }) {
      this.send = sendMock
    }),
  }
})

vi.mock('@aws-sdk/lib-storage', () => ({
  Upload: vi.fn(function (this: { done: typeof uploadDone }) {
    this.done = uploadDone
  }),
}))

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: getSignedUrlMock,
}))

import { Upload } from '@aws-sdk/lib-storage'

const baseConfig: BackupS3Config = {
  bucket: 'payload-backups',
  forcePathStyle: true,
  prefix: '',
  region: 'us-east-1',
}

describe('S3BackupStorage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('uploads via multipart Upload with the derived content type', async () => {
    const storage = new S3BackupStorage(baseConfig)
    const res = await storage.put('backups/manual---db---host---2-1700000000000.json', '{"a":1}')

    expect(Upload).toHaveBeenCalledOnce()
    const params = vi.mocked(Upload).mock.calls[0][0].params as unknown as Record<string, unknown>
    expect(params.Bucket).toBe('payload-backups')
    expect(params.Key).toBe('backups/manual---db---host---2-1700000000000.json')
    expect(params.ContentType).toBe('application/json')
    expect(uploadDone).toHaveBeenCalledOnce()
    expect(res.url).toBe('https://signed.example/object')
  })

  it('lists objects and maps them to the blob shape with a presigned url', async () => {
    sendMock.mockResolvedValueOnce({
      Contents: [
        {
          Key: 'backups/manual---db---host---2-1700000000000.json',
          LastModified: new Date('2024-01-02T03:04:05Z'),
          Size: 1234,
        },
      ],
      IsTruncated: false,
    })

    const storage = new S3BackupStorage(baseConfig)
    const objects = await storage.list('backups/')

    const listInput = sendMock.mock.calls[0][0].input as Record<string, unknown>
    expect(listInput.Bucket).toBe('payload-backups')
    expect(listInput.Prefix).toBe('backups/')
    expect(objects).toHaveLength(1)
    expect(objects[0]).toMatchObject({
      downloadUrl: 'https://signed.example/object',
      pathname: 'backups/manual---db---host---2-1700000000000.json',
      size: 1234,
      url: 'https://signed.example/object',
    })
  })

  it('paginates list results across continuation tokens', async () => {
    sendMock
      .mockResolvedValueOnce({
        Contents: [{ Key: 'backups/a.json', LastModified: new Date(), Size: 1 }],
        IsTruncated: true,
        NextContinuationToken: 'next',
      })
      .mockResolvedValueOnce({
        Contents: [{ Key: 'backups/b.json', LastModified: new Date(), Size: 2 }],
        IsTruncated: false,
      })

    const storage = new S3BackupStorage(baseConfig)
    const objects = await storage.list('backups/')

    expect(sendMock).toHaveBeenCalledTimes(2)
    expect(objects.map((o) => o.pathname)).toEqual(['backups/a.json', 'backups/b.json'])
  })

  it('reads object bytes into a Buffer', async () => {
    sendMock.mockResolvedValueOnce({
      Body: { transformToByteArray: async () => new Uint8Array([1, 2, 3]) },
    })

    const storage = new S3BackupStorage(baseConfig)
    const buf = await storage.read({ pathname: 'backups/x.json' })

    expect(Buffer.isBuffer(buf)).toBe(true)
    expect([...buf]).toEqual([1, 2, 3])
  })

  it('deletes by pathname', async () => {
    sendMock.mockResolvedValueOnce({})
    const storage = new S3BackupStorage(baseConfig)
    await storage.del({ pathname: 'backups/x.json' })

    const cmd = sendMock.mock.calls[0][0]
    expect(cmd.__kind).toBe('delete')
    expect(cmd.input.Key).toBe('backups/x.json')
  })

  it('applies the configured key prefix on write and strips it on list', async () => {
    const storage = new S3BackupStorage({ ...baseConfig, prefix: 'team-a' })

    await storage.put('backups/x.json', 'data')
    const putParams = vi.mocked(Upload).mock.calls[0][0].params as unknown as Record<
      string,
      unknown
    >
    expect(putParams.Key).toBe('team-a/backups/x.json')

    sendMock.mockResolvedValueOnce({
      Contents: [{ Key: 'team-a/backups/x.json', LastModified: new Date(), Size: 1 }],
      IsTruncated: false,
    })
    const objects = await storage.list('backups/')
    const listInput = sendMock.mock.calls[0][0].input as Record<string, unknown>
    expect(listInput.Prefix).toBe('team-a/backups/')
    expect(objects[0].pathname).toBe('backups/x.json')
  })

  it('validate() returns ok when HeadBucket succeeds and not ok when it throws', async () => {
    const storage = new S3BackupStorage(baseConfig)

    sendMock.mockResolvedValueOnce({})
    expect(await storage.validate()).toEqual({ ok: true })

    sendMock.mockRejectedValueOnce(new Error('Forbidden'))
    expect(await storage.validate()).toEqual({ error: 'Forbidden', ok: false })
  })
})
