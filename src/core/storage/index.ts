import type { BackupBlobAccessLevel } from '../backupBlobIO'
import type { BackupStorageAdapter, BackupStorageKind } from './types'

import { getBackupStorageKind, isS3Configured, loadS3Config } from './config'
import { S3BackupStorage } from './s3'
import { VercelBlobStorage } from './vercelBlob'

export type { BackupS3Config } from './config'
export { getBackupStorageKind, isS3Configured, loadS3Config } from './config'
export type {
  BackupStorageAdapter,
  BackupStorageKind,
  BackupStorageObject,
  BackupStorageRef,
  BackupStorageValidation,
} from './types'

export interface ResolveBackupStorageOptions {
  /** Vercel Blob access level (ignored for S3). */
  blobAccess?: BackupBlobAccessLevel
  /** Vercel Blob read/write token (ignored for S3). */
  blobToken?: string
  /** Force a target; defaults to {@link getBackupStorageKind} (plugin option / env / vercel-blob). */
  kind?: BackupStorageKind
}

/**
 * Builds the backup storage adapter for the active target. Vercel Blob is the default; `s3` is
 * selected via the `BACKUP_STORAGE` env var (or plugin option) and reads `BACKUP_S3_*` config.
 */
export function resolveBackupStorage(
  options: ResolveBackupStorageOptions = {},
): BackupStorageAdapter {
  const kind = getBackupStorageKind(options.kind)
  if (kind === 's3') {
    return new S3BackupStorage(loadS3Config())
  }
  return new VercelBlobStorage({ access: options.blobAccess, token: options.blobToken })
}

/**
 * True when the active target has enough configuration to serve requests. Used by endpoints to
 * return 503 early: Vercel Blob needs a token; S3 needs a bucket.
 */
export function isBackupStorageConfigured(blobToken?: string): boolean {
  return getBackupStorageKind() === 's3' ? isS3Configured() : Boolean(blobToken?.trim())
}
