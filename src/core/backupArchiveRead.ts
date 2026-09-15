import { type BackupBlobAccessLevel, readBackupBlobContentFlexible } from './backupBlobIO'
import { getBackupStorageKind, resolveBackupStorage } from './storage'

export interface ReadBackupArchiveBytesOptions {
  /** Provider-agnostic archive pathname (e.g. `backups/manual---db---host---1.json`). */
  archivePathname?: string
  backupRead?: { pathname: string; token: string }
  blobAccess?: BackupBlobAccessLevel
  blobToken?: string
}

/**
 * Loads a backup archive into memory. Vercel private blobs use token-backed reads; S3 uses the
 * storage adapter via `archivePathname` so restore/preview do not depend on expiring list URLs.
 */
export async function readBackupArchiveBytes(
  downloadUrl: string,
  options: ReadBackupArchiveBytesOptions = {},
): Promise<Buffer> {
  if (options.backupRead) {
    return readBackupBlobContentFlexible(
      options.backupRead.pathname,
      downloadUrl,
      options.backupRead.token,
    )
  }

  const archivePathname = options.archivePathname
  if (
    getBackupStorageKind() === 's3' &&
    typeof archivePathname === 'string' &&
    archivePathname.startsWith('backups/')
  ) {
    const storage = resolveBackupStorage({
      blobAccess: options.blobAccess,
      blobToken: options.blobToken,
    })
    return storage.read({ pathname: archivePathname })
  }

  const res = await fetch(downloadUrl)
  if (!res.ok) {
    throw new Error(`Failed to download backup (${res.status})`)
  }
  return Buffer.from(await res.arrayBuffer())
}
