import type { Payload } from 'payload'

import { buildCollectionPreviewGroups } from './restorePreview.js'
import type { RestorePreviewGroup } from './restorePreview.js'
import { getDb } from './db.js'

export type BackupSourcePreviewResponse = {
  groups: RestorePreviewGroup[]
  /** Media docs with a filename (blob path candidates for tar backup). */
  mediaBlobCandidates: number
}

export async function getBackupSourcePreviewForManual(
  payload: Payload,
  options: { preferredLocales?: string[] } = {},
): Promise<BackupSourcePreviewResponse> {
  const db = await getDb(payload)
  const cols = await db.listCollections().toArray()
  const counts: Record<string, number> = {}
  for (const { name } of cols) {
    counts[name] = await db.collection(name).countDocuments({})
  }

  const groups = buildCollectionPreviewGroups(payload, counts, {
    preferredLocales: options.preferredLocales,
    includeEmptyCollections: true,
    sortLikeAdminNav: true,
  })

  let mediaBlobCandidates = 0
  if ((counts['media'] ?? 0) > 0) {
    mediaBlobCandidates = await db.collection('media').countDocuments({
      filename: { $exists: true, $nin: [null, ''] },
    })
  }

  return { groups, mediaBlobCandidates }
}
