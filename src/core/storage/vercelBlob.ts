import { del, list } from '@vercel/blob'

import type {
  BackupStorageAdapter,
  BackupStorageObject,
  BackupStorageRef,
  BackupStorageValidation,
} from './types'

import {
  type BackupBlobAccessLevel,
  putBackupBlobContent,
  readBackupBlobContentFlexible,
  streamBackupBlobForDownload,
} from '../backupBlobIO'
import { validateBackupBlobToken } from '../blobTokenValidate'

/**
 * Vercel Blob backup target — the historical default. This is a thin wrapper around the existing
 * `@vercel/blob` helpers so behaviour (and the test seams that mock `@vercel/blob`) is unchanged;
 * the adapter only generalizes the call shape so S3 can slot in alongside it.
 */
export class VercelBlobStorage implements BackupStorageAdapter {
  private readonly access: BackupBlobAccessLevel

  private readonly token: string | undefined
  readonly kind = 'vercel-blob'

  constructor(options: { access?: BackupBlobAccessLevel; token?: string }) {
    this.token = options.token
    this.access = options.access ?? 'public'
  }

  async del(ref: BackupStorageRef): Promise<void> {
    await del(ref.url ?? ref.pathname, { token: this.token })
  }

  async list(prefix: string): Promise<BackupStorageObject[]> {
    const { blobs } = await list({ limit: 1000, prefix, token: this.token })
    return blobs as unknown as BackupStorageObject[]
  }

  async openDownloadStream(ref: BackupStorageRef) {
    return streamBackupBlobForDownload({
      blobUrl: ref.url,
      downloadUrl: ref.downloadUrl,
      pathname: ref.pathname,
      preferredAccess: this.access,
      token: this.token ?? '',
    })
  }

  async put(pathname: string, body: Buffer | string | Uint8Array) {
    await putBackupBlobContent(pathname, body, this.token, this.access)
    return { pathname, url: '' }
  }

  async read(ref: BackupStorageRef): Promise<Buffer> {
    return readBackupBlobContentFlexible(
      ref.pathname,
      ref.downloadUrl ?? ref.url ?? '',
      this.token ?? '',
    )
  }

  async validate(): Promise<BackupStorageValidation> {
    return validateBackupBlobToken(this.token ?? '')
  }
}
