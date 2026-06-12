import type { BackupStorageKind } from './types'

/**
 * Resolved S3 configuration. Credentials are optional: when omitted, the AWS SDK's default
 * provider chain is used (env vars `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`, shared config,
 * instance/role credentials, …), which is the recommended setup on AWS.
 */
export interface BackupS3Config {
  accessKeyId?: string
  bucket: string
  /** Custom endpoint for S3-compatible stores (Cloudflare R2, MinIO). Omit for AWS S3. */
  endpoint?: string
  /** Path-style addressing — required for MinIO and some R2 setups. Defaults true when an endpoint is set. */
  forcePathStyle: boolean
  /** Optional key namespace prepended to every object key (for sharing a bucket). No trailing slash. */
  prefix: string
  region: string
  secretAccessKey?: string
  sessionToken?: string
}

function env(name: string): string | undefined {
  const v = process.env[name]
  if (typeof v !== 'string') {
    return undefined
  }
  const trimmed = v.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function parseBool(raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined) {
    return fallback
  }
  return ['1', 'on', 'true', 'yes'].includes(raw.toLowerCase())
}

/**
 * Selected backup target. Precedence: explicit `override` (plugin option) → `BACKUP_STORAGE`
 * env var → `vercel-blob` (default, so existing deployments are unaffected).
 */
export function getBackupStorageKind(override?: BackupStorageKind): BackupStorageKind {
  if (override === 's3' || override === 'vercel-blob') {
    return override
  }
  const raw = env('BACKUP_STORAGE')?.toLowerCase()
  if (raw === 's3') {
    return 's3'
  }
  return 'vercel-blob'
}

/** True when the S3 target has the minimum configuration (a bucket) to operate. */
export function isS3Configured(): boolean {
  return Boolean(env('BACKUP_S3_BUCKET'))
}

/**
 * Reads S3 configuration from the environment. Throws a descriptive error when the bucket is
 * missing so endpoints can surface a clear failure instead of an opaque SDK error.
 */
export function loadS3Config(): BackupS3Config {
  const bucket = env('BACKUP_S3_BUCKET')
  if (!bucket) {
    throw new Error('BACKUP_S3_BUCKET is required when BACKUP_STORAGE=s3')
  }
  const endpoint = env('BACKUP_S3_ENDPOINT')
  const rawPrefix = env('BACKUP_S3_PREFIX') ?? ''
  const accessKeyId = env('BACKUP_S3_ACCESS_KEY_ID') ?? env('AWS_ACCESS_KEY_ID')
  const secretAccessKey = env('BACKUP_S3_SECRET_ACCESS_KEY') ?? env('AWS_SECRET_ACCESS_KEY')

  return {
    accessKeyId,
    bucket,
    endpoint,
    forcePathStyle: parseBool(env('BACKUP_S3_FORCE_PATH_STYLE'), Boolean(endpoint)),
    prefix: rawPrefix.replace(/\/+$/, ''),
    region: env('BACKUP_S3_REGION') ?? env('AWS_REGION') ?? 'us-east-1',
    secretAccessKey,
    sessionToken: env('BACKUP_S3_SESSION_TOKEN') ?? env('AWS_SESSION_TOKEN'),
  }
}
