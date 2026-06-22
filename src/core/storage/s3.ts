import type { S3Client } from '@aws-sdk/client-s3'

import type { BackupS3Config } from './config'
import type {
  BackupStorageAdapter,
  BackupStorageObject,
  BackupStorageRef,
  BackupStorageValidation,
} from './types'

/** Presigned download URLs are valid this long — long enough to start a restore/download. */
const SIGNED_URL_TTL_SECONDS = 3600

function contentTypeFor(pathname: string): string {
  if (pathname.endsWith('.json')) {
    return 'application/json'
  }
  if (pathname.endsWith('.gz') || pathname.endsWith('.tar.gz')) {
    return 'application/gzip'
  }
  return 'application/octet-stream'
}

/**
 * AWS S3 backup target. The same implementation serves any S3-compatible store (Cloudflare R2,
 * MinIO, …) — only the `endpoint`/`forcePathStyle` config differs, never the code. The AWS SDK is
 * loaded lazily via dynamic import so it stays an optional dependency for Vercel-only installs.
 */
export class S3BackupStorage implements BackupStorageAdapter {
  private readonly cfg: BackupS3Config

  private clientPromise: null | Promise<S3Client> = null
  readonly kind = 's3'

  constructor(cfg: BackupS3Config) {
    this.cfg = cfg
  }

  private async buildClient(): Promise<S3Client> {
    const { S3Client } = await this.sdk()
    const { accessKeyId, secretAccessKey, sessionToken } = this.cfg
    return new S3Client({
      ...(this.cfg.endpoint ? { endpoint: this.cfg.endpoint } : {}),
      forcePathStyle: this.cfg.forcePathStyle,
      region: this.cfg.region,
      // When keys are absent, fall back to the SDK's default credential provider chain
      // (env vars, shared config, instance/role credentials).
      ...(accessKeyId && secretAccessKey ?
        { credentials: { accessKeyId, secretAccessKey, sessionToken } }
      : {}),
    })
  }

  private async client(): Promise<S3Client> {
    if (!this.clientPromise) {
      this.clientPromise = this.buildClient()
    }
    return this.clientPromise
  }

  /** Strip the configured key prefix, returning the provider-agnostic `backups/...` pathname. */
  private fromKey(key: string): string {
    if (!this.cfg.prefix) {
      return key
    }
    const lead = `${this.cfg.prefix}/`
    return key.startsWith(lead) ? key.slice(lead.length) : key
  }

  private async presignGet(key: string): Promise<string> {
    const { GetObjectCommand } = await this.sdk()
    const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner')
    const client = await this.client()
    return getSignedUrl(client, new GetObjectCommand({ Bucket: this.cfg.bucket, Key: key }), {
      expiresIn: SIGNED_URL_TTL_SECONDS,
    })
  }

  private async sdk() {
    try {
      return await import('@aws-sdk/client-s3')
    } catch {
      throw new Error(
        'BACKUP_STORAGE=s3 requires the AWS SDK. Install it with: ' +
          'pnpm add @aws-sdk/client-s3 @aws-sdk/lib-storage @aws-sdk/s3-request-presigner',
      )
    }
  }

  /** Prepend the configured key prefix to a provider-agnostic `backups/...` pathname. */
  private toKey(pathname: string): string {
    return this.cfg.prefix ? `${this.cfg.prefix}/${pathname}` : pathname
  }

  async del(ref: BackupStorageRef): Promise<void> {
    const { DeleteObjectCommand } = await this.sdk()
    const client = await this.client()
    await client.send(
      new DeleteObjectCommand({ Bucket: this.cfg.bucket, Key: this.toKey(ref.pathname) }),
    )
  }

  async list(prefix: string): Promise<BackupStorageObject[]> {
    const { ListObjectsV2Command } = await this.sdk()
    const client = await this.client()
    const keyPrefix = this.toKey(prefix)

    const objects: BackupStorageObject[] = []
    let continuationToken: string | undefined
    do {
      const res = await client.send(
        new ListObjectsV2Command({
          Bucket: this.cfg.bucket,
          ContinuationToken: continuationToken,
          Prefix: keyPrefix,
        }),
      )
      for (const obj of res.Contents ?? []) {
        if (!obj.Key) {
          continue
        }
        const pathname = this.fromKey(obj.Key)
        const url = await this.presignGet(obj.Key)
        objects.push({
          downloadUrl: url,
          pathname,
          size: obj.Size ?? 0,
          uploadedAt: obj.LastModified ?? new Date(0),
          url,
        })
      }
      continuationToken = res.IsTruncated ? res.NextContinuationToken : undefined
    } while (continuationToken)

    return objects
  }

  async openDownloadStream(ref: BackupStorageRef) {
    const { GetObjectCommand } = await this.sdk()
    const client = await this.client()
    try {
      const res = await client.send(
        new GetObjectCommand({ Bucket: this.cfg.bucket, Key: this.toKey(ref.pathname) }),
      )
      if (!res.Body) {
        return null
      }
      const stream = (
        res.Body as { transformToWebStream: () => ReadableStream<Uint8Array> }
      ).transformToWebStream()
      return {
        contentType: res.ContentType || contentTypeFor(ref.pathname),
        stream,
      }
    } catch {
      return null
    }
  }

  async put(pathname: string, body: Buffer | string | Uint8Array) {
    const { Upload } = await import('@aws-sdk/lib-storage')
    const client = await this.client()
    const key = this.toKey(pathname)
    await new Upload({
      client,
      params: {
        Body: typeof body === 'string' ? Buffer.from(body) : body,
        Bucket: this.cfg.bucket,
        ContentType: contentTypeFor(pathname),
        Key: key,
      },
    }).done()
    return { pathname, url: await this.presignGet(key) }
  }

  async read(ref: BackupStorageRef): Promise<Buffer> {
    const { GetObjectCommand } = await this.sdk()
    const client = await this.client()
    const res = await client.send(
      new GetObjectCommand({ Bucket: this.cfg.bucket, Key: this.toKey(ref.pathname) }),
    )
    if (!res.Body) {
      throw new Error(`Failed to read backup object (${ref.pathname}): empty body`)
    }
    const bytes = await (
      res.Body as { transformToByteArray: () => Promise<Uint8Array> }
    ).transformToByteArray()
    return Buffer.from(bytes)
  }

  async validate(): Promise<BackupStorageValidation> {
    try {
      const { HeadBucketCommand } = await this.sdk()
      const client = await this.client()
      await client.send(new HeadBucketCommand({ Bucket: this.cfg.bucket }))
      return { ok: true }
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : 'S3 bucket not reachable',
        ok: false,
      }
    }
  }
}
