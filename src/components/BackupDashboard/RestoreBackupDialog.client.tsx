'use client'

import { Button } from '@payloadcms/ui'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { RestorePreviewResponse } from '../../core/restorePreview.js'
import { backupPluginPublicApiPaths } from '../../publicApiPaths.js'
import { closeNativeDialogOnBackdropPointer } from '../../utils/dialogBackdrop.js'

import { TaskActionButton } from './TaskActionButton.client.js'

type RestoreBackupDialogProps = {
  downloadUrl: string
  pathname: string
}

function hiddenPills(
  reasons: RestorePreviewResponse['groups'][number]['adminHiddenReasons'],
): string[] {
  const out: string[] = []
  if (reasons.includes('collection-config')) out.push('Hidden in admin')
  return out
}

function groupDocTotal(g: RestorePreviewResponse['groups'][number]): number {
  return (g.main?.docCount ?? 0) + (g.versions?.docCount ?? 0)
}

function isRestoreRowVisuallyEmpty(
  g: RestorePreviewResponse['groups'][number],
  preview: RestorePreviewResponse,
): boolean {
  const t = groupDocTotal(g)
  const isMedia = g.groupId === 'media'
  const hasBlobs = preview.mediaBlobCount > 0
  return t === 0 && !(isMedia && hasBlobs)
}

function isRestoreCollectionCheckboxDisabled(
  g: RestorePreviewResponse['groups'][number],
  preview: RestorePreviewResponse,
): boolean {
  return isRestoreRowVisuallyEmpty(g, preview)
}

function isRestoreSignInAgainGroup(groupId: string): boolean {
  return groupId === 'users' || groupId === 'roles' || groupId === 'payload-preferences'
}

export const RestoreBackupDialog: React.FC<RestoreBackupDialogProps> = ({
  downloadUrl,
  pathname,
}) => {
  const router = useRouter()
  const dialogRef = useRef<HTMLDialogElement>(null)
  const postSuccessCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [preview, setPreview] = useState<RestorePreviewResponse | null>(null)
  const [phase, setPhase] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [selected, setSelected] = useState<Record<string, boolean>>({})
  const [restoreAllCollections, setRestoreAllCollections] = useState(false)
  const [restoreArchiveMedia, setRestoreArchiveMedia] = useState(true)

  const resetState = useCallback(() => {
    setPreview(null)
    setPhase('idle')
    setErrorMessage(null)
    setSelected({})
    setRestoreAllCollections(false)
    setRestoreArchiveMedia(true)
  }, [])

  useEffect(() => {
    const el = dialogRef.current
    if (!el) return
    const onClose = () => {
      if (postSuccessCloseTimerRef.current) {
        clearTimeout(postSuccessCloseTimerRef.current)
        postSuccessCloseTimerRef.current = null
      }
      resetState()
    }
    el.addEventListener('close', onClose)
    return () => el.removeEventListener('close', onClose)
  }, [resetState])

  useEffect(() => {
    return () => {
      if (postSuccessCloseTimerRef.current) {
        clearTimeout(postSuccessCloseTimerRef.current)
      }
    }
  }, [])

  useEffect(() => {
    if (!preview) return
    setSelected(
      Object.fromEntries(
        preview.groups.map((g) => {
          const t = groupDocTotal(g)
          const isMedia = g.groupId === 'media'
          const hasBlobs = preview.mediaBlobCount > 0
          if (t === 0 && !(isMedia && hasBlobs)) {
            return [g.groupId, false]
          }
          return [g.groupId, true]
        }),
      ),
    )
    setRestoreAllCollections(false)
    setRestoreArchiveMedia(true)
  }, [preview])

  const loadPreview = useCallback(async () => {
    setPhase('loading')
    setErrorMessage(null)
    setPreview(null)
    try {
      const locale =
        typeof document !== 'undefined' ? (document.documentElement.lang || 'en').slice(0, 2) : 'en'
      const response = await fetch(backupPluginPublicApiPaths.adminRestorePreview, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          locale,
          pathname,
          url: downloadUrl,
        }),
      })
      const data = (await response.json()) as RestorePreviewResponse & { error?: string }
      if (!response.ok) {
        throw new Error(data.error || 'Could not analyse backup')
      }
      setPreview(data)
      setPhase('ready')
    } catch (e) {
      setPhase('error')
      setErrorMessage(e instanceof Error ? e.message : 'Could not analyse backup')
    }
  }, [downloadUrl, pathname])

  const openDialog = () => {
    setPhase('loading')
    setErrorMessage(null)
    setPreview(null)
    setSelected({})
    setRestoreAllCollections(false)
    setRestoreArchiveMedia(true)
    dialogRef.current?.showModal()
    void loadPreview()
  }

  const skipCollections = useMemo(() => {
    if (!preview) return []
    if (restoreAllCollections) return []
    return preview.groups.filter((g) => selected[g.groupId] === false).flatMap((g) => g.mongoNames)
  }, [preview, restoreAllCollections, selected])

  const willAutoLogout = useMemo(() => {
    if (!preview) return false
    return preview.groups.some(
      (g) => (restoreAllCollections || selected[g.groupId] !== false) && g.affectsAuthSession,
    )
  }, [preview, restoreAllCollections, selected])

  const needsAuthLockoutConfirm = useCallback(() => {
    if (!preview) return false
    return preview.groups.some(
      (g) =>
        isRestoreSignInAgainGroup(g.groupId) &&
        (restoreAllCollections || selected[g.groupId] !== false),
    )
  }, [preview, restoreAllCollections, selected])

  const hasArchiveMedia = preview ? preview.mediaBlobCount > 0 : false
  const mediaGroupIncluded = preview ? restoreAllCollections || selected['media'] !== false : false
  const hasMediaBlobOption = Boolean(preview && preview.mediaBlobCount > 0 && mediaGroupIncluded)

  const restoreBody = useMemo(
    () => ({
      pathname,
      restoreArchiveMedia: hasArchiveMedia ? restoreArchiveMedia : true,
      skipCollections,
      url: downloadUrl,
    }),
    [downloadUrl, hasArchiveMedia, pathname, restoreArchiveMedia, skipCollections],
  )

  const closeModalAfterRestoreSuccess = useCallback(() => {
    if (postSuccessCloseTimerRef.current) {
      clearTimeout(postSuccessCloseTimerRef.current)
    }
    postSuccessCloseTimerRef.current = setTimeout(() => {
      postSuccessCloseTimerRef.current = null
      router.refresh()
      dialogRef.current?.close()
    }, 1000)
  }, [router])

  return (
    <>
      <Button buttonStyle="secondary" size="small" onClick={openDialog}>
        Restore
      </Button>

      <dialog
        ref={dialogRef}
        className="backup-confirm-dialog backup-confirm-dialog--restore"
        onMouseDown={(e) => closeNativeDialogOnBackdropPointer(e, dialogRef)}
      >
        <p className="backup-confirm-dialog__title">Restore this backup?</p>

        <div className="backup-confirm-dialog__body restore-preview">
          {phase === 'loading' && (
            <div className="restore-preview__loading-block" aria-live="polite">
              <p className="restore-preview__status">Downloading and analysing backup…</p>
              <div className="restore-preview__loading-line" />
              <div className="restore-preview__loading-line restore-preview__loading-line--short" />
              <div className="restore-preview__loading-line" />
            </div>
          )}

          {phase === 'error' && (
            <div className="restore-preview__error">
              <p>{errorMessage}</p>
              <p className="restore-preview__error-hint">
                You can still start restore below. If this backup replaces users or sessions, sign
                out manually afterwards if you are not redirected automatically.
              </p>
              <Button buttonStyle="secondary" size="small" onClick={() => void loadPreview()}>
                Retry analysis
              </Button>
            </div>
          )}

          {phase === 'ready' && preview && (
            <>
              <p className="restore-preview__sticky-heading">Collection selection</p>
              <p className="restore-preview__intro">
                Choose which collections to restore. Version history is grouped with its collection.
                Collections with no documents in this backup still appear (greyed); you can leave
                them unchecked.
              </p>

              {preview.groups.length === 0 && (
                <p className="restore-preview__empty">No collections found to list.</p>
              )}

              {restoreAllCollections ? (
                <div className="restore-preview__all-block">
                  <label className="restore-preview__all-block-head">
                    <input
                      type="checkbox"
                      className="checkbox-input__input restore-preview__group-check"
                      checked
                      onChange={() =>
                        setRestoreAllCollections((prev) => {
                          const next = !prev
                          if (next && preview) {
                            setSelected(
                              Object.fromEntries(preview.groups.map((g) => [g.groupId, true])),
                            )
                          }
                          return next
                        })
                      }
                    />
                    <span className="restore-preview__media-label">Restore all collections</span>
                  </label>
                  {preview.groups.length > 0 ? (
                    <ul className="restore-preview__all-list" aria-label="Collections in backup">
                      {preview.groups.map((g) => {
                        const isMedia = g.groupId === 'media'
                        const rowEmpty = isRestoreRowVisuallyEmpty(g, preview)
                        const versionDocs = g.versions?.docCount ?? 0
                        const docTotal = groupDocTotal(g)
                        const signInAgain = isRestoreSignInAgainGroup(g.groupId)

                        let countLabel: string
                        if (rowEmpty) {
                          countLabel = 'Nothing to restore'
                        } else if (docTotal === 0 && isMedia && preview.mediaBlobCount > 0) {
                          countLabel = `0 docs · ${preview.mediaBlobCount} media file${preview.mediaBlobCount === 1 ? '' : 's'} in archive`
                        } else {
                          countLabel = `${docTotal} doc${docTotal === 1 ? '' : 's'} to restore`
                          if (versionDocs > 0) {
                            countLabel += ` (incl. ${versionDocs} version${versionDocs === 1 ? '' : 's'})`
                          }
                        }

                        return (
                          <li key={g.groupId} className="restore-preview__all-item">
                            <span className="restore-preview__all-name">
                              {g.displayTitle}
                              {signInAgain ? (
                                <>
                                  {' '}
                                  <span className="restore-preview__pill restore-preview__pill--signin">
                                    Sign-in again
                                  </span>
                                </>
                              ) : null}
                            </span>
                            <span className="restore-preview__all-count">{countLabel}</span>
                          </li>
                        )
                      })}
                    </ul>
                  ) : null}
                  {hasMediaBlobOption ? (
                    <label className="restore-preview__media-block restore-preview__media-block--nested">
                      <input
                        type="checkbox"
                        className="checkbox-input__input restore-preview__group-check"
                        checked={restoreArchiveMedia}
                        onChange={() => setRestoreArchiveMedia((v) => !v)}
                      />
                      <span className="restore-preview__media-label">
                        Restore media files from backup? ({preview.mediaBlobCount} file
                        {preview.mediaBlobCount === 1 ? '' : 's'} in archive)
                      </span>
                    </label>
                  ) : null}
                </div>
              ) : (
                <>
                  <label className="restore-preview__media-block">
                    <input
                      type="checkbox"
                      className="checkbox-input__input restore-preview__group-check"
                      checked={false}
                      onChange={() =>
                        setRestoreAllCollections((prev) => {
                          const next = !prev
                          if (next && preview) {
                            setSelected(
                              Object.fromEntries(preview.groups.map((g) => [g.groupId, true])),
                            )
                          }
                          return next
                        })
                      }
                    />
                    <span className="restore-preview__media-label">Restore all collections</span>
                  </label>

                  <ul className="restore-preview__list" aria-label="Collections in backup">
                    {preview.groups.map((g) => {
                      const adminPills = hiddenPills(g.adminHiddenReasons)
                      const isMedia = g.groupId === 'media'
                      const rowEmpty = isRestoreRowVisuallyEmpty(g, preview)
                      const checkboxDisabled = isRestoreCollectionCheckboxDisabled(g, preview)
                      const docTotal = groupDocTotal(g)

                      return (
                        <li
                          key={g.groupId}
                          className={`restore-preview__group${rowEmpty ? 'restore-preview__group--empty' : ''}`}
                        >
                          <div className="restore-preview__group-head">
                            <label className="restore-preview__group-label">
                              <input
                                type="checkbox"
                                className="checkbox-input__input restore-preview__group-check"
                                checked={selected[g.groupId] !== false}
                                disabled={checkboxDisabled}
                                onChange={() => {
                                  setSelected((prev) => {
                                    const isOn = prev[g.groupId] !== false
                                    return { ...prev, [g.groupId]: !isOn }
                                  })
                                }}
                              />
                              <span className="restore-preview__group-title">{g.displayTitle}</span>
                            </label>
                            {isRestoreSignInAgainGroup(g.groupId) && (
                              <span className="restore-preview__pill restore-preview__pill--signin">
                                Requires sign-in again
                              </span>
                            )}
                          </div>
                          <div className="restore-preview__sublines">
                            {rowEmpty ? (
                              <div className="restore-preview__subline restore-preview__subline--empty">
                                0 docs, nothing to restore
                              </div>
                            ) : docTotal === 0 && isMedia && preview.mediaBlobCount > 0 ? (
                              <div className="restore-preview__subline">
                                0 collection docs in backup
                              </div>
                            ) : (
                              <>
                                {g.main ? (
                                  <div className="restore-preview__subline">
                                    {g.main.docCount} doc{g.main.docCount === 1 ? '' : 's'} to
                                    restore
                                  </div>
                                ) : null}
                                {g.versions ? (
                                  <div className="restore-preview__subline">
                                    {g.versions.docCount} version doc
                                    {g.versions.docCount === 1 ? '' : 's'} to restore
                                  </div>
                                ) : null}
                              </>
                            )}
                            {isMedia &&
                              selected['media'] !== false &&
                              preview.mediaBlobCount === 0 &&
                              docTotal > 0 && (
                                <div className="restore-preview__note restore-preview__note--media">
                                  No media files in this backup archive — only collection data will
                                  be restored for media.
                                </div>
                              )}
                            {isMedia && hasMediaBlobOption && (
                              <label className="restore-preview__media-block restore-preview__media-block--nested">
                                <input
                                  type="checkbox"
                                  className="checkbox-input__input restore-preview__group-check"
                                  checked={restoreArchiveMedia}
                                  onChange={() => setRestoreArchiveMedia((v) => !v)}
                                />
                                <span className="restore-preview__media-label">
                                  Restore media files from backup? ({preview.mediaBlobCount} file
                                  {preview.mediaBlobCount === 1 ? '' : 's'} in archive)
                                </span>
                              </label>
                            )}
                            {adminPills.length > 0 && (
                              <div className="restore-preview__pills">
                                {adminPills.map((t) => (
                                  <span key={t} className="restore-preview__pill">
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
        </div>

        <div className="backup-confirm-dialog__actions">
          <TaskActionButton
            body={restoreBody}
            buttonStyle="error"
            completeLabel="Restore started"
            dangerConfirm={{
              body: 'You have selected Users, Roles, and/or Payload preferences. Restoring these collections replaces login accounts, role definitions, and/or UI session data. You can be locked out until you sign in again with the restored credentials. After a successful restore you will be signed out automatically.',
              cancelLabel: 'Go back',
              confirmLabel: 'I understand — restore anyway',
              title: 'Danger: lock-out risk',
              when: needsAuthLockoutConfirm,
            }}
            endpoint={backupPluginPublicApiPaths.adminRestore}
            idleDisabled={phase !== 'ready' && phase !== 'error'}
            idleLabel="Yes, restore"
            kind="restore"
            onComplete={closeModalAfterRestoreSuccess}
            pendingLabel="Restoring..."
            redirectOnComplete={willAutoLogout ? '/admin/logout' : undefined}
          />
          <Button buttonStyle="secondary" size="small" onClick={() => dialogRef.current?.close()}>
            Cancel
          </Button>
        </div>
      </dialog>
    </>
  )
}
