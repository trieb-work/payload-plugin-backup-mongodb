'use client'

import { Button } from '@payloadcms/ui'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'

import type { BackupSourcePreviewResponse } from '../../core/backupSourcePreview'

import { backupPluginPublicApiPaths } from '../../publicApiPaths'
import { skipMongoNamesFromPreview } from '../../utils/backupSelection'
import { BACKUP_LABEL_MAX_LENGTH, sanitizeBackupLabel } from '../../utils/blobName'
import { closeNativeDialogOnBackdropPointer } from '../../utils/dialogBackdrop'
import { CollectionBackupPreviewBody } from './CollectionBackupPreviewBody.client'
import { TaskActionButton } from './TaskActionButton.client'

export const ManualBackupDialog: React.FC = () => {
  const router = useRouter()
  const uid = useId()
  const labelInputId = `${uid}-manual-backup-label`
  const dialogRef = useRef<HTMLDialogElement>(null)
  const postSuccessCloseTimerRef = useRef<null | ReturnType<typeof setTimeout>>(null)
  const [preview, setPreview] = useState<BackupSourcePreviewResponse | null>(null)
  const [phase, setPhase] = useState<'error' | 'idle' | 'loading' | 'ready'>('idle')
  const [errorMessage, setErrorMessage] = useState<null | string>(null)
  const [selected, setSelected] = useState<Record<string, boolean>>({})
  const [includeMediaBlobs, setIncludeMediaBlobs] = useState(true)
  const [backupAllCollections, setBackupAllCollections] = useState(false)
  const [label, setLabel] = useState('')

  const resetState = useCallback(() => {
    setPreview(null)
    setPhase('idle')
    setErrorMessage(null)
    setSelected({})
    setIncludeMediaBlobs(true)
    setBackupAllCollections(false)
    setLabel('')
  }, [])

  useEffect(() => {
    const el = dialogRef.current
    if (!el) {
      return
    }
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
    if (!preview) {
      return
    }
    setSelected(Object.fromEntries(preview.groups.map((g) => [g.groupId, true])))
    setIncludeMediaBlobs(true)
    setBackupAllCollections(false)
  }, [preview])

  const loadPreview = useCallback(async () => {
    setPhase('loading')
    setErrorMessage(null)
    setPreview(null)
    try {
      const locale =
        typeof document !== 'undefined' ? (document.documentElement.lang || 'en').slice(0, 2) : 'en'
      const response = await fetch(backupPluginPublicApiPaths.adminBackupPreview, {
        body: JSON.stringify({ locale }),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      })
      const data = (await response.json()) as { error?: string } & BackupSourcePreviewResponse
      if (!response.ok) {
        throw new Error(data.error || 'Could not load collections')
      }
      setPreview(data)
      setPhase('ready')
    } catch (e) {
      setPhase('error')
      setErrorMessage(e instanceof Error ? e.message : 'Could not load collections')
    }
  }, [])

  const openDialog = () => {
    setPhase('loading')
    setErrorMessage(null)
    setPreview(null)
    setSelected({})
    setIncludeMediaBlobs(true)
    setBackupAllCollections(false)
    setLabel('')
    dialogRef.current?.showModal()
    void loadPreview()
  }

  const skipCollections = useMemo(() => {
    if (!preview) {
      return []
    }
    if (backupAllCollections) {
      return []
    }
    return skipMongoNamesFromPreview(preview, selected)
  }, [backupAllCollections, preview, selected])

  const mediaGroupIncluded = preview ? backupAllCollections || selected['media'] !== false : false
  const hasMediaBlobOption = Boolean(
    preview && preview.mediaBlobCandidates > 0 && mediaGroupIncluded,
  )

  const includeMedia = useMemo(() => {
    if (!hasMediaBlobOption) {
      return false
    }
    return includeMediaBlobs
  }, [hasMediaBlobOption, includeMediaBlobs])

  const sanitizedLabel = useMemo(() => sanitizeBackupLabel(label), [label])

  const backupBody = useMemo(
    () => ({
      includeMedia,
      label: sanitizedLabel || undefined,
      skipCollections,
    }),
    [includeMedia, sanitizedLabel, skipCollections],
  )

  const closeModalAfterBackupSuccess = useCallback(() => {
    if (postSuccessCloseTimerRef.current) {
      clearTimeout(postSuccessCloseTimerRef.current)
    }
    postSuccessCloseTimerRef.current = setTimeout(() => {
      postSuccessCloseTimerRef.current = null
      router.refresh()
      dialogRef.current?.close()
    }, 1000)
  }, [router])

  const onToggleGroup = useCallback((groupId: string) => {
    setSelected((prev) => {
      const isOn = prev[groupId] !== false
      return { ...prev, [groupId]: !isOn }
    })
  }, [])

  const onToggleBackupAllCollections = useCallback(() => {
    setBackupAllCollections((prev) => {
      const next = !prev
      if (next && preview) {
        setSelected(Object.fromEntries(preview.groups.map((g) => [g.groupId, true])))
      }
      return next
    })
  }, [preview])

  return (
    <>
      <Button buttonStyle="primary" onClick={openDialog} size="small">
        Create manual Backup
      </Button>

      {/* Native <dialog>: backdrop dismiss; element not in jsx-a11y interactive list */}
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
      <dialog
        className="backup-confirm-dialog backup-confirm-dialog--manual"
        onMouseDown={(e) => closeNativeDialogOnBackdropPointer(e, dialogRef)}
        ref={dialogRef}
      >
        <p className="backup-confirm-dialog__title">Create manual backup</p>

        <div className="manual-backup-label">
          <label className="manual-backup-label__label" htmlFor={labelInputId}>
            Label <span className="manual-backup-label__hint">(optional)</span>
          </label>
          <input
            aria-label="Optional backup label"
            autoComplete="off"
            className="manual-backup-label__input"
            id={labelInputId}
            maxLength={BACKUP_LABEL_MAX_LENGTH}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="e.g. pre-release snapshot"
            spellCheck={false}
            type="text"
            value={label}
          />
          <p className="manual-backup-label__help">
            Shown in the backup list so you can find this backup later.
          </p>
        </div>

        <CollectionBackupPreviewBody
          errorMessage={errorMessage}
          includeAllCollections={backupAllCollections}
          includeAllLabel="Backup all collections"
          includeMediaBlobs={includeMediaBlobs}
          onRetry={loadPreview}
          onToggleGroup={onToggleGroup}
          onToggleIncludeAllCollections={onToggleBackupAllCollections}
          onToggleIncludeMedia={() => setIncludeMediaBlobs((v) => !v)}
          phase={phase}
          preview={preview}
          selected={selected}
        />

        <div className="backup-confirm-dialog__actions">
          <TaskActionButton
            body={backupBody}
            buttonStyle="primary"
            completeLabel="Backup created"
            endpoint={backupPluginPublicApiPaths.adminManual}
            idleDisabled={phase !== 'ready' && phase !== 'error'}
            idleLabel="Start backup"
            kind="backup"
            onComplete={closeModalAfterBackupSuccess}
            pendingLabel="Creating backup…"
          />
          <button
            aria-label="Manual backups will not get automatically deleted"
            className="backup-help-icon"
            data-tip="Manual backups will not get automatically deleted"
            type="button"
          >
            i
          </button>
          <Button buttonStyle="secondary" onClick={() => dialogRef.current?.close()} size="small">
            Cancel
          </Button>
        </div>
      </dialog>
    </>
  )
}
