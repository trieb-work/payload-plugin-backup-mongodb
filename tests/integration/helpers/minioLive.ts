import { CreateBucketCommand, HeadBucketCommand, S3Client } from '@aws-sdk/client-s3'

import { loadS3Config } from '../../../src/core/storage/config.js'

export const S3_LIVE_ENV_KEYS = [
  'BACKUP_STORAGE',
  'BACKUP_S3_BUCKET',
  'BACKUP_S3_REGION',
  'BACKUP_S3_ENDPOINT',
  'BACKUP_S3_FORCE_PATH_STYLE',
  'BACKUP_S3_PREFIX',
  'BACKUP_S3_ACCESS_KEY_ID',
  'BACKUP_S3_SECRET_ACCESS_KEY',
  'BLOB_READ_WRITE_TOKEN',
] as const

/** True when a live MinIO / S3-compatible endpoint is configured for integration tests. */
export function isLiveS3Configured(): boolean {
  return Boolean(process.env.BACKUP_S3_ENDPOINT?.trim() && process.env.BACKUP_S3_BUCKET?.trim())
}

export function saveS3Env(): Record<string, string | undefined> {
  const saved: Record<string, string | undefined> = {}
  for (const key of S3_LIVE_ENV_KEYS) {
    saved[key] = process.env[key]
  }
  return saved
}

export function restoreS3Env(saved: Record<string, string | undefined>): void {
  for (const key of S3_LIVE_ENV_KEYS) {
    if (saved[key] === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = saved[key]
    }
  }
}

export function applyLiveS3Env(): void {
  process.env.BACKUP_STORAGE = 's3'
  delete process.env.BLOB_READ_WRITE_TOKEN
}

/** Ensures the configured bucket exists (idempotent). */
export async function ensureLiveS3Bucket(): Promise<void> {
  const cfg = loadS3Config()
  const client = new S3Client({
    ...(cfg.endpoint ? { endpoint: cfg.endpoint } : {}),
    credentials:
      cfg.accessKeyId && cfg.secretAccessKey ?
        { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey }
      : undefined,
    forcePathStyle: cfg.forcePathStyle,
    region: cfg.region,
  })

  try {
    await client.send(new HeadBucketCommand({ Bucket: cfg.bucket }))
  } catch {
    await client.send(new CreateBucketCommand({ Bucket: cfg.bucket }))
  }
}
