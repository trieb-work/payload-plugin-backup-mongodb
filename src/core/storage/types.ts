import type { BackupBlobAccessLevel } from '../backupBlobIO'

/** Selectable backup target. Vercel Blob is the historical default; `s3` covers AWS S3 and any
 * S3-compatible store (Cloudflare R2, MinIO, …) — they share one implementation. */
export type BackupStorageKind = 's3' | 'vercel-blob'

/**
 * Backup archive as seen by the dashboard and the cron/list endpoints. The field names match the
 * objects Vercel Blob's `list()` returns so existing consumers (UI, restore-by-`url`) keep working;
 * the S3 adapter synthesizes the same shape (with a presigned `downloadUrl`/`url`).
 */
export interface BackupStorageObject {
  /** Time-limited URL suitable for downloading the object (presigned for S3). */
  downloadUrl: string
  /** Object key without any provider prefix, e.g. `backups/manual---db---host---2-1700.json`. */
  pathname: string
  /** Object size in bytes. */
  size: number
  /** Upload/last-modified time. */
  uploadedAt: Date | string
  /** Stable reference used for download/delete (Vercel blob URL; presigned GET for S3). */
  url: string
}

/** Result of probing the target's credentials/reachability. */
export interface BackupStorageValidation {
  /** Detected Vercel Blob access level, when applicable. */
  access?: BackupBlobAccessLevel
  /** Short description when validation fails. */
  error?: string
  ok: boolean
}

/** A reference good enough to read or delete a single archive across providers. */
export interface BackupStorageRef {
  downloadUrl?: null | string
  pathname: string
  url?: null | string
}

/**
 * Provider-agnostic operations the plugin performs on backup archives. Implementations live in
 * `vercelBlob.ts` and `s3.ts`; callers obtain one via {@link resolveBackupStorage}.
 */
export interface BackupStorageAdapter {
  /** Delete a single archive. */
  del(ref: BackupStorageRef): Promise<void>
  readonly kind: BackupStorageKind
  /** List archives under a pathname prefix (e.g. `backups/` or `backups/cron-`). */
  list(prefix: string): Promise<BackupStorageObject[]>
  /** Open a readable stream for streaming a download response, or null when not found. */
  openDownloadStream(
    ref: BackupStorageRef,
  ): Promise<{ contentType: string; stream: ReadableStream<Uint8Array> } | null>
  /** Upload an archive at `pathname`. */
  put(
    pathname: string,
    body: Buffer | string | Uint8Array,
  ): Promise<{ pathname: string; url: string }>
  /** Read the full bytes of an archive. */
  read(ref: BackupStorageRef): Promise<Buffer>
  /** Probe credentials / reachability without persisting anything. */
  validate(): Promise<BackupStorageValidation>
}
