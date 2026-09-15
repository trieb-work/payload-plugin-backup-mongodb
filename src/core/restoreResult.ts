export type RestoreArchiveKind = 'json' | 'tar-gzip'

export type RestoreCollectionOutcome =
  | { docCount: number; kind: 'restored'; name: string }
  | { error: string; kind: 'failed'; name: string }
  | { kind: 'skipped'; name: string; reason: 'blacklist' | 'empty' }

export type RestoreMediaOutcome = {
  accessFallbackCount: number
  attempted: number
  failed: Array<{ error: string; name: string }>
  restored: number
  skippedByOption: boolean
}

/** Structured outcome of a restore run (returned to endpoints and task progress). */
export type RestoreBackupResult = {
  archiveKind: RestoreArchiveKind
  collections: RestoreCollectionOutcome[]
  durationMs: number
  media: null | RestoreMediaOutcome
}

export function buildRestoreWarnings(result: RestoreBackupResult): string[] {
  const warnings: string[] = []

  for (const collection of result.collections) {
    if (collection.kind === 'failed') {
      warnings.push(`Collection "${collection.name}": ${collection.error}`)
    }
  }

  if (result.media && !result.media.skippedByOption) {
    for (const failed of result.media.failed) {
      warnings.push(`Media "${failed.name}": ${failed.error}`)
    }
    if (result.media.accessFallbackCount > 0) {
      warnings.push(
        `${result.media.accessFallbackCount} media file(s) uploaded with a fallback blob access level`,
      )
    }
  }

  return warnings
}

export function formatRestoreSummary(result: RestoreBackupResult): string {
  const restored = result.collections.filter((c) => c.kind === 'restored')
  const docTotal = restored.reduce((sum, c) => sum + (c.kind === 'restored' ? c.docCount : 0), 0)
  const skipped = result.collections.filter((c) => c.kind === 'skipped')
  const failedCollections = result.collections.filter((c) => c.kind === 'failed')

  const parts: string[] = [
    `Restored ${restored.length} collection${restored.length === 1 ? '' : 's'} (${docTotal} document${docTotal === 1 ? '' : 's'})`,
  ]

  if (skipped.length > 0) {
    parts.push(
      `skipped ${skipped.length} collection${skipped.length === 1 ? '' : 's'} (blacklist or empty)`,
    )
  }

  if (result.media?.skippedByOption) {
    parts.push('archive media not restored (option disabled)')
  } else if (result.media) {
    parts.push(
      `media ${result.media.restored}/${result.media.attempted} file${result.media.attempted === 1 ? '' : 's'}`,
    )
  }

  const failedMedia = result.media?.failed.length ?? 0
  const errorCount = failedCollections.length + failedMedia
  if (errorCount > 0) {
    parts.push(`${errorCount} error${errorCount === 1 ? '' : 's'} — see warnings`)
  }

  return parts.join('; ')
}

export function restoreTaskStatus(
  result: RestoreBackupResult,
): 'completed' | 'completed_with_warnings' {
  return buildRestoreWarnings(result).length > 0 ? 'completed_with_warnings' : 'completed'
}
