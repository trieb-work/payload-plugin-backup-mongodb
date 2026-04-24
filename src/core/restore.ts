import type { Payload } from 'payload'

import { EJSON } from 'bson'
import fs from 'node:fs/promises'
import path from 'node:path'

import { resolveTarGzip } from './archive'
import { COLLECTION_FILE_NAME } from './backup'
import {
  type BackupBlobAccessLevel,
  putBackupBlobContent,
  readBackupBlobContentFlexible,
} from './backupBlobIO'
import { getDb } from './db'
import { updateBackupTask } from './taskProgress'

export interface RestoreBackupOptions {
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
): Promise<void> {
  const restoreArchiveMedia = options?.restoreArchiveMedia !== false
  const blobToken = options?.blobToken
  const blobAccess: BackupBlobAccessLevel = options?.blobAccess ?? 'public'
  const backupRead = options?.backupRead
  const t0 = Date.now()
  const urlBase = downloadUrl.split('?')?.[0]

  // Progress is stored in `backup-tasks`. Restoring that collection from the file
  // would delete/replace the active task doc and break GET .../admin/task/:id polling.
  const effectiveBlacklist = taskId
    ? Array.from(new Set(['backup-tasks', ...collectionBlacklist]))
    : [...collectionBlacklist]

  payload.logger.info(
    { blacklist: effectiveBlacklist, mergeData, url: urlBase },
    '[restore] Starting restore',
  )
  if (taskId) {
    await updateBackupTask(payload, taskId, {
      message: 'Starting restore',
      status: 'running',
    })
  }

  const db = getDb(payload)
  const archiveBytes = backupRead
    ? await readBackupBlobContentFlexible(backupRead.pathname, downloadUrl, backupRead.token)
    : await (async () => {
        const res = await fetch(downloadUrl)
        if (!res.ok) {
          throw new Error(`Failed to download backup (${res.status})`)
        }
        return Buffer.from(await res.arrayBuffer())
      })()
  let collections: Record<string, Record<string, unknown>[]> = {}

  if (urlBase?.endsWith('.json')) {
    payload.logger.info('[restore] Parsing JSON backup')
    if (taskId) {
      await updateBackupTask(payload, taskId, {
        message: 'Parsing JSON backup',
      })
    }
    collections = EJSON.parse(archiveBytes.toString('utf8'))
  } else if (urlBase?.endsWith('.gz')) {
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
    const medias = restoreArchiveMedia
      ? files.filter((file) => file.name !== COLLECTION_FILE_NAME)
      : []
    if (!restoreArchiveMedia) {
      payload.logger.info(
        '[restore] Skipping archive media blob upload (restoreArchiveMedia=false)',
      )
    }
    payload.logger.info({ count: medias.length }, '[restore] Restoring media files to blob storage')
    if (taskId) {
      await updateBackupTask(payload, taskId, {
        message: restoreArchiveMedia
          ? `Restoring ${medias.length} media file${medias.length === 1 ? '' : 's'}`
          : 'Skipped media files from archive',
      })
    }
    const mediaResults = await Promise.all(
      medias.map((media) =>
        putBackupBlobContent(media.name, media.content, blobToken, blobAccess).then(
          (effectiveAccess) => ({ name: media.name, effectiveAccess }),
        ),
      ),
    )
    const mismatched = mediaResults.filter((r) => r.effectiveAccess !== blobAccess)
    if (mismatched.length > 0) {
      payload.logger.warn(
        { count: mismatched.length, preferredAccess: blobAccess },
        '[restore] Blob store rejected preferred access level for media; uploaded with fallback',
      )
    }
    mediaResults.forEach((result) => {
      payload.logger.debug(
        { name: result.name, access: result.effectiveAccess },
        '[restore] Media file uploaded',
      )
    })
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
      continue
    }
    const collectionData = collections[collectionName]
    if (collectionData.length > 0) {
      payload.logger.info(
        { collection: collectionName, docs: collectionData.length, mergeData },
        '[restore] Restoring collection',
      )
      const collection = db.collection(collectionName)
      const indexes = await collection.indexes()
      const uniqueIndexes = indexes
        .filter((idx) => idx.unique)
        .flatMap((idx) => Object.keys(idx.key))
      if (!mergeData) {
        await collection.deleteMany({})
      }
      if (taskId) {
        await updateBackupTask(payload, taskId, {
          message: `Restoring collection ${collectionName} (${collectionData.length} docs)`,
        })
      }
      const res = await collection.bulkWrite(
        collectionData.map((doc) => ({
          updateOne: {
            filter:
              uniqueIndexes.length > 0
                ? {
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
    }
  }

  payload.logger.info({ durationMs: Date.now() - t0 }, '[restore] Restore complete')
}

export async function restoreSeedMedia(payload: Payload, taskId?: string): Promise<string[]> {
  const files = await fs.readdir(path.join(process.cwd(), 'public/seed/media'))
  if (taskId) {
    await updateBackupTask(payload, taskId, {
      message: `Restoring ${files.length} seed media file${files.length === 1 ? '' : 's'}`,
      status: 'running',
    })
  }
  for (const file of files) {
    const data = await fs.readFile(path.join(process.cwd(), 'public/seed/media', file))
    if (process.env.BLOB_READ_WRITE_TOKEN) {
      const effectiveAccess = await putBackupBlobContent(
        file,
        data,
        process.env.BLOB_READ_WRITE_TOKEN,
        'public',
      )
      payload.logger.info(
        { access: effectiveAccess, file },
        '[restore] Restored seed media to Vercel Blob storage',
      )
    } else {
      const folderPath = path.join(process.cwd(), 'public/media')
      const publicPath = path.join(folderPath, file)
      await fs.mkdir(folderPath, { recursive: true })
      await fs.writeFile(publicPath, data)
      payload.logger.info({ file, publicPath }, '[restore] Restored seed media to public directory')
    }
    if (taskId) {
      await updateBackupTask(payload, taskId, {
        message: `Restored seed media file ${file}`,
      })
    }
  }
  payload.logger.info({ count: files.length }, '[restore] Restored all seed media files')
  return files
}
