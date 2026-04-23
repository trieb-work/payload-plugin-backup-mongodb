import type { BackupSourcePreviewResponse } from '../core/backupSourcePreview.js'

export function skipMongoNamesFromPreview(
  preview: BackupSourcePreviewResponse,
  selected: Record<string, boolean>,
): string[] {
  return preview.groups
    .filter((g) => selected[g.groupId] === false)
    .flatMap((g) => g.mongoNames)
}

/**
 * Derives checkbox state from stored Mongo collection names to skip (cron / settings).
 */
export function selectedFromSkipMongoNames(
  preview: BackupSourcePreviewResponse,
  skipMongoNames: string[],
): Record<string, boolean> {
  const skip = new Set(skipMongoNames)
  const selected: Record<string, boolean> = {}
  for (const g of preview.groups) {
    const allSkipped = g.mongoNames.length > 0 && g.mongoNames.every((m) => skip.has(m))
    selected[g.groupId] = !allSkipped
  }
  return selected
}
