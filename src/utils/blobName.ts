const SEPARATOR = '---'

/**
 * Last segment is `{collectionCount}-{timestampMs}` (new) or legacy `{timestampMs}` only.
 * A hyphenated tail that does not pass {@link isPlausibleNewFormatTail} is treated as legacy
 * (whole `last` string, no collection count) so older blobs are never mis-parsed.
 */
const NEW_NAME_TAIL = /^(\d+)-(\d{10,})$/

const NEW_TAIL_MAX_COLLECTIONS = 100_000

function isPlausibleNewFormatTail(collectionCount: number, timestampMs: number): boolean {
  return (
    Number.isFinite(collectionCount) &&
    Number.isFinite(timestampMs) &&
    collectionCount >= 0 &&
    collectionCount <= NEW_TAIL_MAX_COLLECTIONS &&
    timestampMs > 0 &&
    timestampMs < 1e15
  )
}

export interface TransformBlobNameResult {
  collectionCount?: number
  date: string
  dbName: string
  fileType: 'json' | 'tar.gz' | 'na'
  hostname: string
  type: string
}

export function transformBlobName(blobName: string): TransformBlobNameResult {
  const fileType: 'json' | 'tar.gz' | 'na' = blobName.endsWith('json')
    ? 'json'
    : blobName.endsWith('tar.gz')
      ? 'tar.gz'
      : 'na'
  const [type = '', dbName = '', hostname = '', last = ''] = blobName
    .replace('.json', '')
    .replace('.tar.gz', '')
    .replace('backups/', '')
    .split(SEPARATOR)

  const m = NEW_NAME_TAIL.exec(last)
  if (m) {
    const collectionCount = Number(m[1])
    const timestampMs = Number(m[2])
    if (isPlausibleNewFormatTail(collectionCount, timestampMs)) {
      return {
        collectionCount,
        date: m[2],
        dbName: decodeURIComponent(dbName),
        fileType,
        hostname: decodeURIComponent(hostname),
        type,
      }
    }
  }

  return {
    date: last,
    dbName: decodeURIComponent(dbName),
    fileType,
    hostname: decodeURIComponent(hostname),
    type,
  }
}

/**
 * Backup blob pathname segment (without `backups/` prefix or extension).
 * New format: `{collectionCount}-{timestampMs}` encodes included collection count + backup time.
 */
export function createBlobName(
  type: string,
  dbName: string,
  hostname: string,
  collectionCount: number,
  timestampMs: number,
  fileType: 'json' | 'tar.gz',
): string {
  const tail = `${Math.max(0, Math.floor(collectionCount))}-${Math.floor(timestampMs)}`
  return `${type}${SEPARATOR}${encodeURIComponent(dbName)}${SEPARATOR}${encodeURIComponent(hostname)}${SEPARATOR}${tail}.${fileType}`
}

/**
 * Prefer timestamp encoded in filename (stable across blob store migration); else blob upload time.
 * Legacy tails are digits-only epoch values; if {@link TransformBlobNameResult.collectionCount}
 * is absent, values below 1e12 are treated as **Unix seconds** (common older convention), else ms.
 */
export function getBackupSortTimeMs(parsed: TransformBlobNameResult, uploadedAt: Date): number {
  if (!parsed.date || !/^\d+$/.test(parsed.date)) {
    return uploadedAt.getTime()
  }
  const n = Number(parsed.date)
  if (!Number.isFinite(n)) {
    return uploadedAt.getTime()
  }
  const isLegacyTimestampOnly = parsed.collectionCount === undefined
  if (isLegacyTimestampOnly && n < 1e12) {
    return n * 1000
  }
  return n
}
