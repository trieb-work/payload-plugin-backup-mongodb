import type { Payload } from 'payload'

import type { RestorePreviewGroup } from './restorePreview'

import { getDb } from './db'
import { buildCollectionPreviewGroups } from './restorePreview'

export type BackupSourcePreviewResponse = {
  groups: RestorePreviewGroup[]
  /** Media docs with a filename (blob path candidates for tar backup). */
  mediaBlobCandidates: number
}

export async function getBackupSourcePreviewForManual(
  payload: Payload,
  options: { preferredLocales?: string[] } = {},
): Promise<BackupSourcePreviewResponse> {
  const db = getDb(payload)
  const cols = await db.listCollections().toArray()
  const counts: Record<string, number> = {}
  for (const { name } of cols) {
    counts[name] = await db.collection(name).countDocuments({})
  }

  const groups = buildCollectionPreviewGroups(payload, counts, {
    includeEmptyCollections: true,
    preferredLocales: options.preferredLocales,
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
