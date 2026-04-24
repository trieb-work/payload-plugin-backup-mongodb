import { put } from '@vercel/blob'

/** Vercel Blob access for backup archives under `backups/`. */
export type BackupBlobAccessLevel = 'private' | 'public'

/**
 * Returns the blob pathname (no leading slash) for a trusted Vercel Blob HTTPS URL, or null.
 * The URL's path component is percent-decoded once so the result matches the literal pathname
 * stored by Vercel Blob (e.g. blobs whose own pathname contains `%2F` are served from a URL that
 * double-encodes it to `%252F`).
 */
export function vercelBlobPathnameFromUrl(urlStr: string): null | string {
  try {
    const u = new URL(urlStr)
    if (u.protocol !== 'https:') {return null}
    if (!u.hostname.endsWith('.blob.vercel-storage.com')) {return null}
    const raw = u.pathname.replace(/^\//, '')
    if (raw.length === 0) {return null}
    try {
      return decodeURIComponent(raw)
    } catch {
      return raw
    }
  } catch {
    return null
  }
}

export function isTrustedBackupBlobReference(urlStr: string, expectedPathname: string): boolean {
  const fromUrl = vercelBlobPathnameFromUrl(urlStr)
  return Boolean(fromUrl && fromUrl === expectedPathname)
}

/** True when the URL points to any Vercel Blob host (public or private). */
function isVercelBlobHost(urlStr: string): boolean {
  try {
    const u = new URL(urlStr)
    return u.protocol === 'https:' && u.hostname.endsWith('.blob.vercel-storage.com')
  } catch {
    return false
  }
}

/**
 * Fetches a Vercel Blob URL with the Bearer token attached when the host belongs to Vercel Blob.
 * Works transparently for public stores (token is ignored) and private stores (token is required).
 * Tokens are never sent to non-Vercel hosts.
 */
async function fetchBackupBlobUrl(url: string, token: string): Promise<Response> {
  const init: RequestInit | undefined =
    token && isVercelBlobHost(url)
      ? { headers: { authorization: `Bearer ${token}` } }
      : undefined
  return fetch(url, init)
}

export type BackupBlobDownloadStream = {
  contentType: string
  stream: ReadableStream<Uint8Array>
}

/**
 * Opens a readable stream for a backup object (public or private). Prefers the `downloadUrl` /
 * `blobUrl` returned by `list()` because Vercel Blob already encodes the pathname correctly there
 * (some legacy backups store literal `%2F` sequences inside the pathname, which the SDK's
 * pathname-to-URL construction would misinterpret).
 */
export async function streamBackupBlobForDownload(options: {
  blobUrl?: null | string
  downloadUrl?: null | string
  pathname: string
  preferredAccess: BackupBlobAccessLevel
  token: string
}): Promise<BackupBlobDownloadStream | null> {
  const { blobUrl, downloadUrl, pathname, token } = options
  const candidates: string[] = []
  if (downloadUrl && isTrustedBackupBlobReference(downloadUrl, pathname)) {
    candidates.push(downloadUrl)
  }
  if (blobUrl && isTrustedBackupBlobReference(blobUrl, pathname)) {
    candidates.push(blobUrl)
  }

  for (const target of candidates) {
    try {
      const res = await fetchBackupBlobUrl(target, token)
      if (res.ok && res.body) {
        return {
          contentType: res.headers.get('content-type') || 'application/octet-stream',
          stream: res.body,
        }
      }
    } catch {
      /* try next candidate */
    }
  }

  return null
}

export async function bufferFromWebReadableStream(
  stream: ReadableStream<Uint8Array>,
): Promise<Buffer> {
  const reader = stream.getReader()
  const chunks: Buffer[] = []
  while (true) {
    const { done, value } = await reader.read()
    if (done) {break}
    if (value) {chunks.push(Buffer.from(value))}
  }
  return Buffer.concat(chunks)
}

/**
 * Read a backup blob using the trusted `downloadUrl` returned by `list()`. The Bearer token is
 * always attached for Vercel Blob hosts; this works for public blobs (token ignored) and is
 * required for private blobs.
 */
export async function readBackupBlobContent(options: {
  /** Kept for API compatibility — the fetch path is the same for public and private stores. */
  access: BackupBlobAccessLevel
  downloadUrl: string
  pathname: string
  token: string
}): Promise<Buffer> {
  const { downloadUrl, pathname, token } = options
  const res = await fetchBackupBlobUrl(downloadUrl, token)
  if (res.ok) {
    return Buffer.from(await res.arrayBuffer())
  }
  throw new Error(`Failed to read backup blob (${pathname}): HTTP ${res.status}`)
}

/**
 * Flexible read used during restore/preview/transfer where the source store visibility may differ
 * from the new one. Always tries authenticated access first (correct for private stores and
 * harmless for public ones). Falls back to anonymous fetch only when the URL is not a Vercel
 * Blob URL, so tokens never leak to arbitrary hosts.
 */
export async function readBackupBlobContentFlexible(
  pathname: string,
  downloadUrl: string,
  token: string,
  _sourceAccessHint?: BackupBlobAccessLevel,
): Promise<Buffer> {
  try {
    const res = await fetchBackupBlobUrl(downloadUrl, token)
    if (res.ok) {return Buffer.from(await res.arrayBuffer())}
  } catch {
    /* try anonymous fallback */
  }

  if (!isVercelBlobHost(downloadUrl)) {
    try {
      const res = await fetch(downloadUrl)
      if (res.ok) {return Buffer.from(await res.arrayBuffer())}
    } catch {
      /* fall through to error */
    }
  }

  throw new Error(`Failed to read backup blob ${pathname}`)
}

/**
 * Uploads a backup blob with the preferred access level and transparently retries the other level
 * if the Vercel Blob store rejects the preferred one (e.g. legacy public-only stores reject
 * `access: 'private'`). Returns the effective access level that succeeded so callers can log/track
 * it; throws the original error if both attempts fail.
 */
export async function putBackupBlobContent(
  pathname: string,
  body: Buffer | string | Uint8Array,
  token: string | undefined,
  access: BackupBlobAccessLevel,
): Promise<BackupBlobAccessLevel> {
  const order: BackupBlobAccessLevel[] =
    access === 'private' ? ['private', 'public'] : ['public', 'private']
  let firstError: unknown
  for (const attempt of order) {
    try {
      await put(pathname, body, {
        access: attempt,
        addRandomSuffix: false,
        allowOverwrite: true,
        ...(token ? { token } : {}),
      })
      return attempt
    } catch (error) {
      if (firstError === undefined) {firstError = error}
      if (!looksLikeAccessModeMismatch(error)) {throw error}
    }
  }
  throw firstError instanceof Error ? firstError : new Error('Failed to upload backup blob')
}

/** Heuristic for Vercel Blob errors that indicate the store rejects the chosen access level. */
function looksLikeAccessModeMismatch(error: unknown): boolean {
  const msg =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : error == null
          ? ''
          : (() => {
              try {
                return JSON.stringify(error)
              } catch {
                return 'unknown'
              }
            })()
  const lower = msg.toLowerCase()
  return (
    lower.includes('access') &&
    (lower.includes('public') ||
      lower.includes('private') ||
      lower.includes('not support') ||
      lower.includes('invalid'))
  )
}
