import { del, list } from '@vercel/blob'
import { EJSON } from 'bson'
import type { Payload } from 'payload'
import { createTarGzip } from './archive.js'
import {
  putBackupBlobContent,
  readBackupBlobContentFlexible,
  type BackupBlobAccessLevel,
} from './backupBlobIO.js'
import { getDb } from './db.js'
import { updateBackupTask } from './taskProgress.js'
import { createBlobName, getCurrentDbName, getCurrentHostname } from '../utils/index.js'

export const COLLECTION_FILE_NAME = 'collections.json'

export async function listBackups(blobToken?: string) {
  const { blobs } = await list({
    prefix: 'backups/',
    limit: 1000,
    token: resolveBlobToken(blobToken),
  })
  return blobs
}

function resolveBlobToken(blobToken?: string): string | undefined {
  if (blobToken && blobToken.trim().length > 0) return blobToken
  return undefined
}

/**
 * @param mediaListToken Token for listing/fetching **Payload media** blobs (usually
 * `BLOB_READ_WRITE_TOKEN`). When omitted, uses env then falls back to `backupBlobToken`.
 */
export async function createMediaBackupFile(
  collectionBackupFile: string,
  mediaCollection: { filename: string }[],
  backupBlobToken?: string,
  mediaListToken?: string,
): Promise<Buffer> {
  const envMedia = (process.env.BLOB_READ_WRITE_TOKEN || '').trim()
  const tokenForMedia =
    resolveBlobToken(mediaListToken) ??
    (envMedia.length > 0 ? envMedia : undefined) ??
    resolveBlobToken(backupBlobToken)
  const mediaFiles = await Promise.all(
    mediaCollection.map(async (media) => {
      const matchingFiles = await list({ limit: 2, prefix: media.filename, token: tokenForMedia })
      const blob = matchingFiles.blobs.find((blob) => blob.pathname === media.filename)
      if (!blob) {
        console.warn('Backup: File was in collection but not in blob storage', media.filename)
        return undefined
      }
      const content = await readBackupBlobContentFlexible(
        blob.pathname,
        blob.downloadUrl,
        tokenForMedia ?? '',
      )
      return { name: media.filename, content }
    }),
  )
  return await createTarGzip([
    { name: COLLECTION_FILE_NAME, content: Buffer.from(collectionBackupFile) },
    ...(mediaFiles.filter(Boolean) as { name: string; content: Buffer }[]),
  ])
}

export async function createBackup(
  payload: Payload,
  options: {
    cron?: boolean
    includeMedia?: boolean
    backupsToKeep?: number
    /** Mongo collection names to omit from the dump (e.g. manual backup UI). */
    skipCollections?: string[]
    /** Optional explicit Vercel Blob token (falls back to env inside @vercel/blob). */
    blobToken?: string
    /** Public (default) or private Vercel Blob access for the uploaded backup archive. */
    blobAccess?: BackupBlobAccessLevel
    taskId?: string
  } = {},
): Promise<void> {
  const { cron = false, includeMedia = false, backupsToKeep, skipCollections, blobToken, taskId } =
    options
  const blobAccess: BackupBlobAccessLevel = options.blobAccess ?? 'public'
  const envMedia = (process.env.BLOB_READ_WRITE_TOKEN || '').trim()
  const token = resolveBlobToken(blobToken)
  const skip = new Set(skipCollections ?? [])
  const resolvedBackupsToKeep = backupsToKeep ?? (Number(process.env.BACKUPS_TO_KEEP) || 10)

  const currentHostname = getCurrentHostname()
  const currentDbName = getCurrentDbName()
  const type = cron ? 'cron' : 'manual'
  const t0 = Date.now()

  payload.logger.info(
    { blacklist: skipCollections?.length ?? 0, includeMedia, type, db: currentDbName, host: currentHostname },
    '[backup] Starting backup',
  )
  if (taskId) {
    await updateBackupTask(payload, taskId, {
      message: 'Starting backup',
      status: 'running',
    })
  }

  if (cron) {
    const { blobs } = await list({
      prefix: 'backups/cron-',
      limit: 1000,
      token,
    })
    const sorted = blobs.sort(
      (a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime(),
    )
    const oldest = sorted.slice(resolvedBackupsToKeep - 1)
    if (oldest.length > 0) {
      payload.logger.info({ count: oldest.length }, '[backup] Pruning old cron backups')
      if (taskId) {
        await updateBackupTask(payload, taskId, {
          message: `Pruning ${oldest.length} old cron backup${oldest.length === 1 ? '' : 's'}`,
        })
      }
    }
    for (const blob of oldest) {
      await del(blob.url, { token })
      payload.logger.info({ pathname: blob.pathname }, '[backup] Deleted old backup')
    }
  }

  const db = await getDb(payload)
  const collections = await db.listCollections().toArray()
  payload.logger.info({ collections: collections.length }, '[backup] Dumping collections')
  if (taskId) {
    await updateBackupTask(payload, taskId, {
      message: `Dumping ${collections.length} collection${collections.length === 1 ? '' : 's'}`,
    })
  }

  const allData: Record<string, any[]> = {}
  for (const collection of collections) {
    if (skip.has(collection.name)) {
      payload.logger.debug({ collection: collection.name }, '[backup] Skipping blacklisted collection')
      continue
    }
    allData[collection.name] = await db.collection(collection.name).find({}).toArray()
    payload.logger.debug(
      { collection: collection.name, docs: allData[collection.name].length },
      '[backup] Collection dumped',
    )
    if (taskId) {
      await updateBackupTask(payload, taskId, {
        message: `Dumped collection ${collection.name} (${allData[collection.name].length} docs)`,
      })
    }
  }

  const collectionBackupFile = EJSON.stringify(allData)
  const includedCollectionCount = Object.keys(allData).length
  const backupTimestampMs = Date.now()

  if (includeMedia) {
    payload.logger.info('[backup] Bundling media files into archive')
    if (taskId) {
      await updateBackupTask(payload, taskId, {
        message: 'Bundling media files into archive',
      })
    }
  }

  const backupFile = includeMedia
    ? await createMediaBackupFile(
        collectionBackupFile,
        allData?.['media'] || [],
        token,
        envMedia.length > 0 ? envMedia : undefined,
      )
    : collectionBackupFile
  const name = `backups/${createBlobName(
    type,
    currentDbName,
    currentHostname,
    includedCollectionCount,
    backupTimestampMs,
    includeMedia ? 'tar.gz' : 'json',
  )}`

  payload.logger.info({ name }, '[backup] Uploading backup to blob storage')
  if (taskId) {
    await updateBackupTask(payload, taskId, {
      message: 'Uploading backup to blob storage',
    })
  }
  const effectiveAccess = await putBackupBlobContent(name, backupFile, token, blobAccess)
  if (effectiveAccess !== blobAccess) {
    payload.logger.warn(
      { name, preferredAccess: blobAccess, effectiveAccess },
      '[backup] Blob store rejected preferred access level; uploaded with fallback',
    )
  }

  payload.logger.info({ name, durationMs: Date.now() - t0 }, '[backup] Backup complete')
}
