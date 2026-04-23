const SEPARATOR = '---'

/**
 * Last segment is `{collectionCount}-{timestampMs}` (new) or legacy `{timestampMs}` only.
 * A hyphenated tail that does not pass {@link isPlausibleNewFormatTail} is treated as legacy
 * (whole `last` string, no collection count) so older blobs are never mis-parsed.
 */
const NEW_NAME_TAIL = /^(\d+)-(\d{10,})$/

const NEW_TAIL_MAX_COLLECTIONS = 100_000

/** Max length for a user-supplied manual backup label (after sanitization). */
export const BACKUP_LABEL_MAX_LENGTH = 64

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

/**
 * Normalize a user-supplied manual backup label so it is safe to embed as a
 * blob-name segment. Trims, collapses whitespace, removes characters that would
 * confuse the separator, and enforces {@link BACKUP_LABEL_MAX_LENGTH}.
 * Returns an empty string when nothing usable remains.
 */
export function sanitizeBackupLabel(raw: unknown): string {
  if (typeof raw !== 'string') return ''
  const collapsed = raw.replace(/\s+/g, ' ').trim()
  if (!collapsed) return ''
  // The blob-name separator is three hyphens; collapse any hyphen run in the
  // label to a single hyphen so round-trip parsing stays unambiguous.
  const deHyphen = collapsed.replace(/-{2,}/g, '-')
  return deHyphen.slice(0, BACKUP_LABEL_MAX_LENGTH).trim()
}

export interface TransformBlobNameResult {
  collectionCount?: number
  date: string
  dbName: string
  fileType: 'json' | 'tar.gz' | 'na'
  hostname: string
  label?: string
  type: string
}

export function transformBlobName(blobName: string): TransformBlobNameResult {
  const fileType: 'json' | 'tar.gz' | 'na' = blobName.endsWith('json')
    ? 'json'
    : blobName.endsWith('tar.gz')
      ? 'tar.gz'
      : 'na'
  const [type = '', dbName = '', hostname = '', last = '', labelEncoded = ''] = blobName
    .replace(/\.(?:json|tar\.gz)$/, '')
    .replace(/^backups\//, '')
    .split(SEPARATOR)

  let label: string | undefined
  if (labelEncoded) {
    try {
      const decoded = decodeURIComponent(labelEncoded)
      if (decoded) label = decoded
    } catch {
      label = labelEncoded
    }
  }

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
        label,
        type,
      }
    }
  }

  return {
    date: last,
    dbName: decodeURIComponent(dbName),
    fileType,
    hostname: decodeURIComponent(hostname),
    label,
    type,
  }
}

/**
 * Backup blob pathname segment (without `backups/` prefix or extension).
 * New format: `{collectionCount}-{timestampMs}` encodes included collection count + backup time.
 * When a non-empty `label` is supplied it is appended as a separate URL-encoded segment
 * (`---{encodedLabel}`) so older parsers that only read the first 4 segments still work.
 */
export function createBlobName(
  type: string,
  dbName: string,
  hostname: string,
  collectionCount: number,
  timestampMs: number,
  fileType: 'json' | 'tar.gz',
  label?: string,
): string {
  const tail = `${Math.max(0, Math.floor(collectionCount))}-${Math.floor(timestampMs)}`
  const sanitizedLabel = sanitizeBackupLabel(label)
  const labelSegment = sanitizedLabel ? `${SEPARATOR}${encodeURIComponent(sanitizedLabel)}` : ''
  return `${type}${SEPARATOR}${encodeURIComponent(dbName)}${SEPARATOR}${encodeURIComponent(hostname)}${SEPARATOR}${tail}${labelSegment}.${fileType}`
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
