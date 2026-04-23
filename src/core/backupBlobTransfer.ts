import { del, list } from '@vercel/blob'
import type { Payload } from 'payload'

import {
  putBackupBlobContent,
  readBackupBlobContentFlexible,
  type BackupBlobAccessLevel,
} from './backupBlobIO.js'
import { updateBackupTask } from './taskProgress.js'

export interface BackupBlobTransferProgress {
  failed: number
  index: number
  pathname: string
  total: number
  transferred: number
}

export interface BackupBlobTransferSummary {
  failed: number
  skipped: number
  total: number
  transferred: number
}

export interface TransferBackupBlobsOptions {
  /**
   * When true, successfully copied blobs are removed from the source store.
   * Defaults to false so the source remains intact unless the caller opts in.
   */
  deleteFromSource?: boolean
  onProgress?: (p: BackupBlobTransferProgress) => void
  taskId?: string
  /** Access level for blobs written to the target store. */
  targetAccess?: BackupBlobAccessLevel
  /** When set, prefer this access when reading from the source (token rotation). */
  sourceAccessHint?: BackupBlobAccessLevel
}

function sameToken(a: string, b: string): boolean {
  return a.trim() !== '' && a.trim() === b.trim()
}

async function writeTransferProgress(
  payload: Payload,
  taskId: string | undefined,
  p: BackupBlobTransferProgress,
): Promise<void> {
  if (!taskId) return
  try {
    await updateBackupTask(payload, taskId, {
      message: JSON.stringify({
        failed: p.failed,
        pathname: p.pathname,
        total: p.total,
        transferred: p.transferred,
      }),
      status: 'running',
    })
  } catch (err) {
    payload.logger.warn({ err, taskId }, '[backup-transfer] Could not persist transfer progress')
  }
}

export async function transferBackupBlobsToToken(
  payload: Payload,
  sourceToken: string,
  targetToken: string,
  options?: TransferBackupBlobsOptions,
): Promise<BackupBlobTransferSummary> {
  if (sameToken(sourceToken, targetToken)) {
    return { failed: 0, skipped: 0, total: 0, transferred: 0 }
  }

  const { blobs } = await list({
    limit: 1000,
    prefix: 'backups/',
    token: sourceToken,
  })

  const total = blobs.length
  let transferred = 0
  let failed = 0
  const taskId = options?.taskId
  const targetAccess: BackupBlobAccessLevel = options?.targetAccess ?? 'public'
  const sourceAccessHint = options?.sourceAccessHint
  const deleteFromSource = options?.deleteFromSource === true

  for (let index = 0; index < blobs.length; index += 1) {
    const blob = blobs[index]
    try {
      const data = await readBackupBlobContentFlexible(
        blob.pathname,
        blob.downloadUrl,
        sourceToken,
        sourceAccessHint,
      )

      await putBackupBlobContent(blob.pathname, data, targetToken, targetAccess)
      if (deleteFromSource) {
        await del(blob.url, { token: sourceToken })
      }
      transferred += 1
    } catch (err) {
      failed += 1
      payload.logger.error(
        { err, pathname: blob.pathname },
        '[backup-transfer] Failed to transfer backup blob',
      )
    }

    const progress: BackupBlobTransferProgress = {
      failed,
      index,
      pathname: blob.pathname,
      total,
      transferred,
    }
    options?.onProgress?.(progress)
    await writeTransferProgress(payload, taskId, progress)
  }

  return {
    failed,
    skipped: 0,
    total: blobs.length,
    transferred,
  }
}
