import type { Payload } from 'payload'

import { EJSON } from 'bson'

import type { BackupStorageAdapter } from './storage/types'

import {
  createBlobName,
  getCurrentDbName,
  getCurrentHostname,
  sanitizeBackupLabel,
} from '../utils/index'
import { createTarGzip } from './archive'
import { type BackupBlobAccessLevel } from './backupBlobIO'
import { getResolvedCronBackupSettings, resolveBackupBlobToken } from './backupSettings'
import { getDb } from './db'
import { getBackupStorageKind, resolveBackupStorage } from './storage'
import { updateBackupTask } from './taskProgress'

export const COLLECTION_FILE_NAME = 'collections.json'

/**
 * Resolves the Vercel Blob read/write token the same way as backup endpoints and
 * {@link createBackup} / {@link restoreBackup}: settings document override, else `BLOB_READ_WRITE_TOKEN`.
 * Pass `explicitToken` to skip reading settings (same as `options.blobToken` in those calls).
 */
export async function resolveBackupListToken(
  payload: Payload,
  explicitToken?: string,
): Promise<string> {
  const t = explicitToken?.trim()
  if (t) {
    return t
  }
  return resolveBackupBlobToken(await getResolvedCronBackupSettings(payload)).trim()
}

export async function listBackups(
  payload: Payload,
  options: {
    /**
     * When set, used as the Vercel Blob token (e.g. tests or a pre-resolved value).
     * When omitted, uses {@link resolveBackupListToken} (settings + env), same as other backup APIs.
     */
    blobToken?: string
  } = {},
) {
  const kind = getBackupStorageKind()
  if (kind === 'vercel-blob') {
    const token = await resolveBackupListToken(payload, options.blobToken)
    if (!token) {
      return []
    }
    return resolveBackupStorage({ blobToken: token, kind }).list('backups/')
  }
  return resolveBackupStorage({ kind }).list('backups/')
}

function resolveBlobToken(blobToken?: string): string | undefined {
  if (blobToken && blobToken.trim().length > 0) {
    return blobToken
  }
  return undefined
}

/**
 * Builds a tar.gz archive containing the collection dump plus any media files retrieved
 * through the given storage adapter. The adapter abstracts Vercel Blob vs S3 so this
 * function stays target-agnostic.
 */
export async function createMediaBackupFile(
  collectionBackupFile: string,
  mediaCollection: { filename: string }[],
  storage: BackupStorageAdapter,
  payload?: Payload,
): Promise<Buffer> {
  const mediaFiles = await Promise.all(
    mediaCollection.map(async (media) => {
      try {
        const matchingFiles = await storage.list(media.filename)
        const blob = matchingFiles.find((blob) => blob.pathname === media.filename)
        if (!blob) {
          payload?.logger.warn(
            { filename: media.filename },
            '[backup] File was in collection but not in blob storage',
          )
          return undefined
        }
        const content = await storage.read({
          downloadUrl: blob.downloadUrl,
          pathname: blob.pathname,
          url: blob.url,
        })
        return { name: media.filename, content }
      } catch (err) {
        payload?.logger.warn(
          { err, filename: media.filename },
          '[backup] Failed to read media file from storage',
        )
        return undefined
      }
    }),
  )
  return await createTarGzip([
    { name: COLLECTION_FILE_NAME, content: Buffer.from(collectionBackupFile) },
    ...(mediaFiles.filter(Boolean) as { content: Buffer; name: string }[]),
  ])
}

export async function createBackup(
  payload: Payload,
  options: {
    backupsToKeep?: number
    /** Public (default) or private Vercel Blob access for the uploaded backup archive. */
    blobAccess?: BackupBlobAccessLevel
    /** Optional explicit Vercel Blob token (falls back to env inside @vercel/blob). */
    blobToken?: string
    cron?: boolean
    includeMedia?: boolean
    /**
     * Optional human-readable label for manual backups (appears in the backup list and is
     * searchable via the label filter). Ignored for cron backups. Whitespace is collapsed,
     * length is capped and the stored value is URL-encoded in the blob pathname.
     */
    label?: string
    /** Mongo collection names to omit from the dump (e.g. manual backup UI). */
    skipCollections?: string[]
    taskId?: string
  } = {},
): Promise<void> {
  const {
    backupsToKeep,
    blobToken,
    cron = false,
    includeMedia = false,
    skipCollections,
    taskId,
  } = options
  const label = cron ? '' : sanitizeBackupLabel(options.label)
  const blobAccess: BackupBlobAccessLevel = options.blobAccess ?? 'public'
  const token = resolveBlobToken(blobToken)
  const skip = new Set(skipCollections ?? [])
  const resolvedBackupsToKeep = backupsToKeep ?? (Number(process.env.BACKUPS_TO_KEEP) || 10)
  const storage = resolveBackupStorage({ blobAccess, blobToken: token })

  const currentHostname = getCurrentHostname()
  const currentDbName = getCurrentDbName()
  const type = cron ? 'cron' : 'manual'
  const t0 = Date.now()

  payload.logger.info(
    {
      type,
      blacklist: skipCollections?.length ?? 0,
      db: currentDbName,
      host: currentHostname,
      includeMedia,
    },
    '[backup] Starting backup',
  )
  if (taskId) {
    await updateBackupTask(payload, taskId, {
      message: 'Starting backup',
      status: 'running',
    })
  }

  if (cron) {
    const blobs = await storage.list('backups/cron-')
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
      await storage.del({ pathname: blob.pathname, url: blob.url })
      payload.logger.info({ pathname: blob.pathname }, '[backup] Deleted old backup')
    }
  }

  const db = getDb(payload)
  const collections = await db.listCollections().toArray()
  payload.logger.info({ collections: collections.length }, '[backup] Dumping collections')
  if (taskId) {
    await updateBackupTask(payload, taskId, {
      message: `Dumping ${collections.length} collection${collections.length === 1 ? '' : 's'}`,
    })
  }

  const allData: Record<string, Record<string, unknown>[]> = {}
  for (const collection of collections) {
    if (skip.has(collection.name)) {
      payload.logger.debug(
        { collection: collection.name },
        '[backup] Skipping blacklisted collection',
      )
      continue
    }
    allData[collection.name] = (await db.collection(collection.name).find({}).toArray()) as Record<
      string,
      unknown
    >[]
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

  const backupFile =
    includeMedia ?
      await createMediaBackupFile(
        collectionBackupFile,
        (allData?.['media'] as { filename: string }[] | undefined) || [],
        storage,
        payload,
      )
    : collectionBackupFile
  const name = `backups/${createBlobName(
    type,
    currentDbName,
    currentHostname,
    includedCollectionCount,
    backupTimestampMs,
    includeMedia ? 'tar.gz' : 'json',
    label || undefined,
  )}`

  payload.logger.info({ name }, '[backup] Uploading backup to blob storage')
  if (taskId) {
    await updateBackupTask(payload, taskId, {
      message: 'Uploading backup to blob storage',
    })
  }
  await storage.put(name, backupFile)

  payload.logger.info({ name, durationMs: Date.now() - t0 }, '[backup] Backup complete')
}
