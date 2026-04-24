'use client'

import type { FC } from 'react'

import { Button } from '@payloadcms/ui'

import type { BackupSourcePreviewResponse } from '../../core/backupSourcePreview'

function hiddenPills(
  reasons: BackupSourcePreviewResponse['groups'][number]['adminHiddenReasons'],
): string[] {
  const out: string[] = []
  if (reasons.includes('collection-config')) {
    out.push('Hidden in admin')
  }
  return out
}

export interface CollectionBackupPreviewBodyProps {
  /** When true, omit the scrollable dialog body wrapper (use inside another `restore-preview` container). */
  embedded?: boolean
  errorMessage: null | string
  includeAllCollections: boolean
  includeAllLabel?: string
  includeMediaBlobs: boolean
  onRetry: () => void
  onToggleGroup: (groupId: string) => void
  onToggleIncludeAllCollections: () => void
  onToggleIncludeMedia: () => void
  phase: 'error' | 'idle' | 'loading' | 'ready'
  preview: BackupSourcePreviewResponse | null
  selected: Record<string, boolean>
}

export const CollectionBackupPreviewBody: FC<CollectionBackupPreviewBodyProps> = ({
  embedded = false,
  errorMessage,
  includeAllCollections,
  includeAllLabel = 'Backup all collections',
  includeMediaBlobs,
  onRetry,
  onToggleGroup,
  onToggleIncludeAllCollections,
  onToggleIncludeMedia,
  phase,
  preview,
  selected,
}) => {
  const mediaGroupIncluded = preview ? includeAllCollections || selected['media'] !== false : false
  const hasMediaBlobOption = Boolean(
    preview && preview.mediaBlobCandidates > 0 && mediaGroupIncluded,
  )

  const inner = (
    <>
      {phase === 'loading' && (
        <div aria-live="polite" className="restore-preview__loading-block">
          <p className="restore-preview__status">Loading collections…</p>
          <div className="restore-preview__loading-line" />
          <div className="restore-preview__loading-line restore-preview__loading-line--short" />
          <div className="restore-preview__loading-line" />
        </div>
      )}

      {phase === 'error' && (
        <div className="restore-preview__error">
          <p>{errorMessage}</p>
          <Button buttonStyle="secondary" onClick={() => void onRetry()} size="small">
            Retry
          </Button>
        </div>
      )}

      {phase === 'ready' && preview && (
        <>
          <p className="restore-preview__sticky-heading">Collection selection</p>
          <p className="restore-preview__intro">
            Choose which collections to include. Version drafts are grouped with their collection.
            Collections with no documents still appear so you can exclude them explicitly. If you
            add new collections later, they are automatically included in backups by default.
          </p>

          {preview.groups.length === 0 && (
            <p className="restore-preview__empty">No collections found to list.</p>
          )}

          {includeAllCollections ? (
            <div className="restore-preview__all-block">
              <label className="restore-preview__all-block-head">
                <input
                  aria-label={includeAllLabel}
                  checked
                  className="checkbox-input__input restore-preview__group-check"
                  onChange={onToggleIncludeAllCollections}
                  type="checkbox"
                />
                <span className="restore-preview__media-label">{includeAllLabel}</span>
              </label>
              {preview.groups.length > 0 ? (
                <ul aria-label="Collections to back up" className="restore-preview__all-list">
                  {preview.groups.map((g) => {
                    const mainDocs = g.main?.docCount ?? 0
                    const versionDocs = g.versions?.docCount ?? 0
                    const totalDocs = mainDocs + versionDocs
                    return (
                      <li className="restore-preview__all-item" key={g.groupId}>
                        <span className="restore-preview__all-name">{g.displayTitle}</span>
                        <span className="restore-preview__all-count">
                          {totalDocs} doc{totalDocs === 1 ? '' : 's'}
                          {versionDocs > 0 ? (
                            <>
                              {' '}
                              <span className="restore-preview__all-count-sub">
                                (incl. {versionDocs} version{versionDocs === 1 ? '' : 's'})
                              </span>
                            </>
                          ) : null}
                        </span>
                      </li>
                    )
                  })}
                </ul>
              ) : null}
              {hasMediaBlobOption ? (
                <label className="restore-preview__media-block restore-preview__media-block--nested">
                  <input
                    aria-label={`Include media files from storage (${preview.mediaBlobCandidates} files)`}
                    checked={includeMediaBlobs}
                    className="checkbox-input__input restore-preview__group-check"
                    onChange={onToggleIncludeMedia}
                    type="checkbox"
                  />
                  <span className="restore-preview__media-label">
                    Include media files from storage? ({preview.mediaBlobCandidates} file
                    {preview.mediaBlobCandidates === 1 ? '' : 's'})
                  </span>
                </label>
              ) : null}
            </div>
          ) : (
            <>
              <label className="restore-preview__media-block">
                <input
                  aria-label={includeAllLabel}
                  checked={false}
                  className="checkbox-input__input restore-preview__group-check"
                  onChange={onToggleIncludeAllCollections}
                  type="checkbox"
                />
                <span className="restore-preview__media-label">{includeAllLabel}</span>
              </label>

              <ul aria-label="Collections to back up" className="restore-preview__list">
                {preview.groups.map((g) => {
                  const adminPills = hiddenPills(g.adminHiddenReasons)
                  const isMedia = g.groupId === 'media'
                  return (
                    <li className="restore-preview__group" key={g.groupId}>
                      <div className="restore-preview__group-head">
                        <label className="restore-preview__group-label">
                          <input
                            aria-label={`Include collection ${g.displayTitle} in backup`}
                            checked={selected[g.groupId] !== false}
                            className="checkbox-input__input restore-preview__group-check"
                            onChange={() => onToggleGroup(g.groupId)}
                            type="checkbox"
                          />
                          <span className="restore-preview__group-title">{g.displayTitle}</span>
                        </label>
                      </div>
                      <div className="restore-preview__sublines">
                        {g.main ? (
                          <div className="restore-preview__subline">
                            {g.main.docCount} doc{g.main.docCount === 1 ? '' : 's'} to include
                          </div>
                        ) : null}
                        {g.versions ? (
                          <div className="restore-preview__subline">
                            {g.versions.docCount} version doc
                            {g.versions.docCount === 1 ? '' : 's'} to include
                          </div>
                        ) : null}
                        {isMedia &&
                          selected['media'] !== false &&
                          preview.mediaBlobCandidates === 0 &&
                          (g.main?.docCount ?? 0) + (g.versions?.docCount ?? 0) > 0 && (
                            <div className="restore-preview__note restore-preview__note--media">
                              No blob paths in media docs — only collection data will be in the
                              backup file.
                            </div>
                          )}
                        {isMedia && hasMediaBlobOption && (
                          <label className="restore-preview__media-block restore-preview__media-block--nested">
                            <input
                              aria-label={`Include media files from storage (${preview.mediaBlobCandidates} files)`}
                              checked={includeMediaBlobs}
                              className="checkbox-input__input restore-preview__group-check"
                              onChange={onToggleIncludeMedia}
                              type="checkbox"
                            />
                            <span className="restore-preview__media-label">
                              Include media files from storage? ({preview.mediaBlobCandidates} file
                              {preview.mediaBlobCandidates === 1 ? '' : 's'})
                            </span>
                          </label>
                        )}
                        {adminPills.length > 0 && (
                          <div className="restore-preview__pills">
                            {adminPills.map((t) => (
                              <span className="restore-preview__pill" key={t}>
                                {t}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </li>
                  )
                })}
              </ul>
            </>
          )}
        </>
      )}
    </>
  )

  if (embedded) {
    return inner
  }

  return <div className="backup-confirm-dialog__body restore-preview">{inner}</div>
}
