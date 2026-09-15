import type { Payload } from 'payload'

import { EJSON } from 'bson'

import type {
  RestoreArchiveKind,
  RestoreBackupResult,
  RestoreCollectionOutcome,
  RestoreMediaOutcome,
} from './restoreResult'

import { resolveTarGzip } from './archive'
import { COLLECTION_FILE_NAME } from './backup'
import { readBackupArchiveBytes, resolveArchiveFileReference } from './backupArchiveRead'
import { type BackupBlobAccessLevel, putBackupBlobContent } from './backupBlobIO'
import { getDb } from './db'
import { updateBackupTask } from './taskProgress'

export type { RestoreBackupResult } from './restoreResult'

export interface RestoreBackupOptions {
  /** When set with S3, the archive is read server-side and list URLs may be stale. */
  archivePathname?: string
  /**
   * When set, the archive is loaded with the backup token (fetch + SDK fallback; works for
   * public and private blobs). Otherwise `downloadUrl` is fetched anonymously.
   */
  backupRead?: { pathname: string; token: string }
  /**
   * Preferred Vercel Blob access for re-uploaded media files. When the store rejects the
   * preferred level (e.g. a private-only store rejects `public`), the other level is tried
   * automatically. Defaults to `public`.
   */
  blobAccess?: BackupBlobAccessLevel
  /** Optional explicit Vercel Blob token used for archive media blob uploads. */
  blobToken?: string
  /**
   * When false, skip uploading media blobs from a tar.gz archive (Mongo `media` and other
   * collections still restore). Default true.
   */
  restoreArchiveMedia?: boolean
}

export async function restoreBackup(
  payload: Payload,
  downloadUrl: string,
  collectionBlacklist: string[] = [],
  mergeData = false,
  taskId?: string,
  options?: RestoreBackupOptions,
): Promise<RestoreBackupResult> {
  const restoreArchiveMedia = options?.restoreArchiveMedia !== false
  const blobToken = options?.blobToken
  const blobAccess: BackupBlobAccessLevel = options?.blobAccess ?? 'public'
  const backupRead = options?.backupRead
  const archivePathname = options?.archivePathname
  const t0 = Date.now()
  const archiveRef = resolveArchiveFileReference(downloadUrl, archivePathname)
  const collectionOutcomes: RestoreCollectionOutcome[] = []
  let mediaOutcome: null | RestoreMediaOutcome = null
  let archiveKind: RestoreArchiveKind

  // Progress is stored in `backup-tasks`. Restoring that collection from the file
  // would delete/replace the active task doc and break GET .../admin/task/:id polling.
  const effectiveBlacklist =
    taskId ?
      Array.from(new Set(['backup-tasks', ...collectionBlacklist]))
    : [...collectionBlacklist]

  payload.logger.info(
    { blacklist: effectiveBlacklist, mergeData, url: archiveRef },
    '[restore] Starting restore',
  )
  if (taskId) {
    await updateBackupTask(payload, taskId, {
      message: 'Starting restore',
      status: 'running',
    })
  }

  const db = getDb(payload)
  const archiveBytes = await readBackupArchiveBytes(downloadUrl, {
    archivePathname,
    backupRead,
    blobAccess,
    blobToken,
  })
  let collections: Record<string, Record<string, unknown>[]> = {}

  if (archiveRef.endsWith('.json')) {
    archiveKind = 'json'
    payload.logger.info('[restore] Parsing JSON backup')
    if (taskId) {
      await updateBackupTask(payload, taskId, {
        message: 'Parsing JSON backup',
      })
    }
    collections = EJSON.parse(archiveBytes.toString('utf8'))
  } else if (archiveRef.endsWith('.gz')) {
    archiveKind = 'tar-gzip'
    payload.logger.info('[restore] Extracting tar.gz backup')
    if (taskId) {
      await updateBackupTask(payload, taskId, {
        message: 'Extracting tar.gz backup',
      })
    }
    const files = await resolveTarGzip(archiveBytes)
    collections = EJSON.parse(
      files.find((file) => file.name === COLLECTION_FILE_NAME)?.content?.toString() || '{}',
    )
    const medias =
      restoreArchiveMedia ? files.filter((file) => file.name !== COLLECTION_FILE_NAME) : []

    mediaOutcome = {
      accessFallbackCount: 0,
      attempted: medias.length,
      failed: [],
      restored: 0,
      skippedByOption: !restoreArchiveMedia,
    }

    if (!restoreArchiveMedia) {
      payload.logger.info(
        '[restore] Skipping archive media blob upload (restoreArchiveMedia=false)',
      )
      if (taskId) {
        await updateBackupTask(payload, taskId, {
          message: 'Skipped media files from archive',
        })
      }
    } else {
      payload.logger.info(
        { count: medias.length },
        '[restore] Restoring media files to blob storage',
      )
      if (taskId) {
        await updateBackupTask(payload, taskId, {
          message: `Restoring ${medias.length} media file${medias.length === 1 ? '' : 's'}`,
        })
      }

      const mediaResults = await Promise.all(
        medias.map(async (media) => {
          try {
            const effectiveAccess = await putBackupBlobContent(
              media.name,
              media.content,
              blobToken,
              blobAccess,
            )
            return {
              name: media.name,
              effectiveAccess,
              error: undefined as string | undefined,
              ok: true as const,
            }
          } catch (err) {
            const error = err instanceof Error ? err.message : String(err)
            payload.logger.warn(
              { err, filename: media.name },
              '[restore] Failed to upload media file to blob storage',
            )
            return { name: media.name, error, ok: false as const }
          }
        }),
      )

      for (const result of mediaResults) {
        if (result.ok) {
          mediaOutcome.restored += 1
          if (result.effectiveAccess !== blobAccess) {
            mediaOutcome.accessFallbackCount += 1
          }
          payload.logger.debug(
            { name: result.name, access: result.effectiveAccess },
            '[restore] Media file uploaded',
          )
        } else {
          mediaOutcome.failed.push({ name: result.name, error: result.error })
        }
      }

      if (mediaOutcome.accessFallbackCount > 0) {
        payload.logger.warn(
          { count: mediaOutcome.accessFallbackCount, preferredAccess: blobAccess },
          '[restore] Blob store rejected preferred access level for media; uploaded with fallback',
        )
      }
    }
  } else {
    throw new Error(`File type of backup ${downloadUrl} not supported`)
  }

  const collectionNames = Object.keys(collections)
  payload.logger.info(
    { blacklisted: effectiveBlacklist.length, total: collectionNames.length },
    '[restore] Restoring collections',
  )
  if (taskId) {
    await updateBackupTask(payload, taskId, {
      message: `Restoring ${collectionNames.length} collection${collectionNames.length === 1 ? '' : 's'}`,
    })
  }

  for (const collectionName of collectionNames) {
    if (effectiveBlacklist.includes(collectionName)) {
      payload.logger.debug(
        { collection: collectionName },
        '[restore] Skipping blacklisted collection',
      )
      collectionOutcomes.push({ name: collectionName, kind: 'skipped', reason: 'blacklist' })
      continue
    }
    const collectionData = collections[collectionName]
    if (collectionData.length === 0) {
      collectionOutcomes.push({ name: collectionName, kind: 'skipped', reason: 'empty' })
      continue
    }

    payload.logger.info(
      { collection: collectionName, docs: collectionData.length, mergeData },
      '[restore] Restoring collection',
    )
    if (taskId) {
      await updateBackupTask(payload, taskId, {
        message: `Restoring collection ${collectionName} (${collectionData.length} docs)`,
      })
    }

    try {
      const collection = db.collection(collectionName)
      const indexes = await collection.indexes()
      const uniqueIndexes = indexes
        .filter((idx) => idx.unique)
        .flatMap((idx) => Object.keys(idx.key))
      if (!mergeData) {
        await collection.deleteMany({})
      }
      const res = await collection.bulkWrite(
        collectionData.map((doc) => ({
          updateOne: {
            filter:
              uniqueIndexes.length > 0 ?
                {
                  $or: [
                    { _id: doc._id },
                    ...uniqueIndexes.map((field) => ({ [field]: doc[field] })),
                  ],
                }
              : { _id: doc._id },
            update: { $set: doc },
            upsert: true,
          },
        })),
      )
      payload.logger.debug(
        { collection: collectionName, modified: res.modifiedCount, upserted: res.upsertedCount },
        '[restore] Collection restored',
      )
      collectionOutcomes.push({
        name: collectionName,
        docCount: collectionData.length,
        kind: 'restored',
      })
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err)
      payload.logger.error(
        { collection: collectionName, err },
        '[restore] Failed to restore collection',
      )
      collectionOutcomes.push({ name: collectionName, error, kind: 'failed' })
    }
  }

  const durationMs = Date.now() - t0
  const result: RestoreBackupResult = {
    archiveKind,
    collections: collectionOutcomes,
    durationMs,
    media: mediaOutcome,
  }

  payload.logger.info({ durationMs, result }, '[restore] Restore complete')
  return result
}
