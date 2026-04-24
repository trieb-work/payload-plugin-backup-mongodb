'use client'

import type { FC } from 'react'

import { Button } from '@payloadcms/ui'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'

import type { BackupSourcePreviewResponse } from '../../core/backupSourcePreview'
import type { BackupTaskProgress } from '../../core/taskProgress'

import { backupPluginPublicApiPaths } from '../../publicApiPaths'
import { selectedFromSkipMongoNames, skipMongoNamesFromPreview } from '../../utils/backupSelection'
import { closeNativeDialogOnBackdropPointer } from '../../utils/dialogBackdrop'
import { CollectionBackupPreviewBody } from './CollectionBackupPreviewBody.client'

function parseBlobTransferTaskMessage(msg: string): {
  failed: number
  pathname?: string
  total: number
  transferred: number
} | null {
  try {
    const o = JSON.parse(msg) as Record<string, unknown>
    if (typeof o.total !== 'number' || typeof o.transferred !== 'number') {
      return null
    }
    return {
      failed: typeof o.failed === 'number' ? o.failed : 0,
      pathname: typeof o.pathname === 'string' ? o.pathname : undefined,
      total: o.total,
      transferred: o.transferred,
    }
  } catch {
    return null
  }
}

const TIP_SETTINGS_SUBTITLE =
  'These settings apply to scheduled (cron) backups only. Manual backups use the choices in the manual backup dialog each time you create one.'

const TIP_TRANSFER_COPY =
  'When enabled, objects under backups/ are copied from the previous backup token (or from BLOB_READ_WRITE_TOKEN on first setup) into the new store. When disabled, only the new token is saved — existing backups stay in the old storage and remain reachable with the previous token.'

const TIP_TRANSFER_DELETE =
  'Destructive: when enabled, each blob is removed from the old store only after a successful copy to the new store. Leave disabled to keep a full copy in the previous storage as a safety net.'

interface SettingsHelpTipProps {
  multiline?: boolean
  tip: string
}

function settingsHelpIconClassName(multiline?: boolean): string {
  return [
    'backup-help-icon',
    'backup-help-icon--settings-tooltip',
    multiline ? 'backup-help-icon--multiline' : '',
  ]
    .filter(Boolean)
    .join(' ')
}

/** Info icon + CSS tooltip; fixed positioning so scroll/clipping in the dialog body does not hide it. */
const SettingsHelpTip: FC<SettingsHelpTipProps> = ({ multiline, tip }) => {
  const elRef = useRef<HTMLButtonElement>(null)

  const syncTooltipAnchor = useCallback(() => {
    const el = elRef.current
    if (!el) {
      return
    }
    const r = el.getBoundingClientRect()
    el.style.setProperty('--backup-tip-x', `${r.left + r.width / 2}px`)
    el.style.setProperty('--backup-tip-y', `${r.top}px`)
  }, [])

  return (
    <button
      aria-label={tip}
      className={settingsHelpIconClassName(multiline)}
      data-tip={tip}
      onFocus={syncTooltipAnchor}
      onMouseEnter={syncTooltipAnchor}
      ref={elRef}
      title={tip}
      type="button"
    >
      i
    </button>
  )
}

interface BackupSettingsApiResponse {
  /** Persisted access level after the last successful token validation, or null. */
  backupBlobAccess?: 'private' | 'public' | null
  /** Either the persisted access level or a heuristic derived value (never null). */
  backupBlobAccessEffective?: 'private' | 'public'
  backupBlobTokenMasked?: string
  backupsToKeep?: number
  cron?: {
    configFileRelative: string
    humanDescription: null | string
    path: string
    schedule: string
  } | null
  effectiveBackupsToKeep?: number
  error?: string
  hasBackupBlobReadWriteToken?: boolean
  id?: string
  includeMediaForCron?: boolean
  pluginBackupsToKeepOverride?: boolean
  skipMongoCollections?: string[]
  transfer?: {
    deferred?: boolean
    failed: number
    performed: boolean
    pollSecret?: string
    skipped: number
    taskId?: string
    total: number
    transferred: number
  }
}

export const BackupSettingsModal: FC = () => {
  const router = useRouter()
  const transferOptId = useId()
  const deleteSourceOptId = useId()
  const dialogRef = useRef<HTMLDialogElement>(null)
  const isPreparingOpenRef = useRef(false)
  const [preview, setPreview] = useState<BackupSourcePreviewResponse | null>(null)
  const [phase, setPhase] = useState<'error' | 'idle' | 'loading' | 'ready'>('idle')
  const [errorMessage, setErrorMessage] = useState<null | string>(null)
  const [selected, setSelected] = useState<Record<string, boolean>>({})
  const [backupAllCollections, setBackupAllCollections] = useState(false)
  const [includeMediaBlobs, setIncludeMediaBlobs] = useState(true)
  const [backupsToKeep, setBackupsToKeep] = useState(10)
  const [backupBlobReadWriteToken, setBackupBlobReadWriteToken] = useState('')
  /**
   * When saving a new raw token, copy backup blobs from the old store. Default on so rotating a
   * token automatically migrates existing archives; delete-from-source stays opt-in.
   */
  const [transferBackupBlobs, setTransferBackupBlobs] = useState(true)
  /**
   * When copying blobs into the new store, also delete them from the old store.
   * Default: off — the user must explicitly opt in to destructive behavior.
   */
  const [deleteBackupBlobsFromSource, setDeleteBackupBlobsFromSource] = useState(false)
  const [, setHasExistingBackupBlobToken] = useState(false)
  const [storedBackupBlobAccess, setStoredBackupBlobAccess] = useState<'private' | 'public' | null>(
    null,
  )
  const [effectiveBackupBlobAccess, setEffectiveBackupBlobAccess] = useState<
    'private' | 'public' | null
  >(null)
  const [tokenCheck, setTokenCheck] = useState<{
    access?: 'private' | 'public'
    message?: string
    status: 'checking' | 'idle' | 'invalid' | 'valid'
  }>({ status: 'idle' })
  const [pluginOverridesRetention, setPluginOverridesRetention] = useState(false)
  const [cronInfo, setCronInfo] = useState<BackupSettingsApiResponse['cron'] | undefined>(undefined)
  const [transferSummary, setTransferSummary] = useState<
    BackupSettingsApiResponse['transfer'] | null
  >(null)
  const [activeTransfer, setActiveTransfer] = useState<{
    pollSecret: string
    taskId: string
    total: number
  } | null>(null)
  const [transferLive, setTransferLive] = useState<{
    failed: number
    pathname?: string
    total: number
    transferred: number
  } | null>(null)
  const [savePhase, setSavePhase] = useState<
    'error' | 'idle' | 'saved' | 'saving' | 'transferring'
  >('idle')
  const [saveError, setSaveError] = useState<null | string>(null)
  const [isPreparingOpen, setIsPreparingOpen] = useState(false)

  const resetState = useCallback(() => {
    setPreview(null)
    setPhase('idle')
    setErrorMessage(null)
    setSelected({})
    setBackupAllCollections(false)
    setIncludeMediaBlobs(false)
    setBackupsToKeep(10)
    setBackupBlobReadWriteToken('')
    setTransferBackupBlobs(true)
    setDeleteBackupBlobsFromSource(false)
    setHasExistingBackupBlobToken(false)
    setStoredBackupBlobAccess(null)
    setEffectiveBackupBlobAccess(null)
    setTokenCheck({ status: 'idle' })
    setPluginOverridesRetention(false)
    setCronInfo(undefined)
    setTransferSummary(null)
    setActiveTransfer(null)
    setTransferLive(null)
    setSavePhase('idle')
    setSaveError(null)
    isPreparingOpenRef.current = false
    setIsPreparingOpen(false)
  }, [])

  useEffect(() => {
    const el = dialogRef.current
    if (!el) {
      return
    }
    const onClose = () => resetState()
    el.addEventListener('close', onClose)
    return () => el.removeEventListener('close', onClose)
  }, [resetState])

  const fetchSettingsAndPreview = useCallback(async () => {
    const locale =
      typeof document !== 'undefined' ? (document.documentElement.lang || 'en').slice(0, 2) : 'en'
    const [settingsRes, previewRes] = await Promise.all([
      fetch(backupPluginPublicApiPaths.adminSettings, { method: 'GET' }),
      fetch(backupPluginPublicApiPaths.adminBackupPreview, {
        body: JSON.stringify({ locale }),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      }),
    ])

    const settingsJson = (await settingsRes.json()) as BackupSettingsApiResponse
    if (!settingsRes.ok) {
      throw new Error(settingsJson.error || 'Could not load settings')
    }

    const previewJson = (await previewRes.json()) as {
      error?: string
    } & BackupSourcePreviewResponse
    if (!previewRes.ok) {
      throw new Error(previewJson.error || 'Could not load collections')
    }

    return { previewJson, settingsJson }
  }, [])

  const applyLoadedSettingsPreview = useCallback(
    (settingsJson: BackupSettingsApiResponse, previewJson: BackupSourcePreviewResponse) => {
      setActiveTransfer(null)
      setTransferLive(null)
      setPreview(previewJson)
      setBackupsToKeep(
        typeof settingsJson.backupsToKeep === 'number' ? settingsJson.backupsToKeep : 10,
      )
      setBackupBlobReadWriteToken(settingsJson.backupBlobTokenMasked || '')
      setHasExistingBackupBlobToken(settingsJson.hasBackupBlobReadWriteToken === true)
      setStoredBackupBlobAccess(settingsJson.backupBlobAccess ?? null)
      setEffectiveBackupBlobAccess(settingsJson.backupBlobAccessEffective ?? null)
      setTokenCheck({ status: 'idle' })
      setPluginOverridesRetention(settingsJson.pluginBackupsToKeepOverride === true)
      setCronInfo(settingsJson.cron ?? null)
      setIncludeMediaBlobs(settingsJson.includeMediaForCron === true)

      const skip = Array.isArray(settingsJson.skipMongoCollections)
        ? settingsJson.skipMongoCollections
        : []
      setSelected(selectedFromSkipMongoNames(previewJson, skip))
      setBackupAllCollections(skip.length === 0)
      setTransferBackupBlobs(true)
      setDeleteBackupBlobsFromSource(false)
      setPhase('ready')
    },
    [],
  )

  const loadPreview = useCallback(async () => {
    setPhase('loading')
    setErrorMessage(null)
    setPreview(null)
    setCronInfo(undefined)
    try {
      const { previewJson, settingsJson } = await fetchSettingsAndPreview()
      applyLoadedSettingsPreview(settingsJson, previewJson)
    } catch (e) {
      setPhase('error')
      setErrorMessage(e instanceof Error ? e.message : 'Could not load backup settings')
    }
  }, [applyLoadedSettingsPreview, fetchSettingsAndPreview])

  const openDialog = useCallback(() => {
    if (isPreparingOpenRef.current) {
      return
    }
    isPreparingOpenRef.current = true
    setSavePhase('idle')
    setSaveError(null)
    setIsPreparingOpen(true)
    void (async () => {
      try {
        const { previewJson, settingsJson } = await fetchSettingsAndPreview()
        applyLoadedSettingsPreview(settingsJson, previewJson)
        dialogRef.current?.showModal()
      } catch (e) {
        setPhase('error')
        setErrorMessage(e instanceof Error ? e.message : 'Could not load backup settings')
        setPreview(null)
        setCronInfo(undefined)
        dialogRef.current?.showModal()
      } finally {
        isPreparingOpenRef.current = false
        setIsPreparingOpen(false)
      }
    })()
  }, [applyLoadedSettingsPreview, fetchSettingsAndPreview])

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

  const willSaveNewRawToken = useMemo(
    () => backupBlobReadWriteToken.trim().length > 0 && !/\*{2,}/.test(backupBlobReadWriteToken),
    [backupBlobReadWriteToken],
  )

  const onChangeBackupBlobToken = useCallback((value: string) => {
    setBackupBlobReadWriteToken(value)
    setTokenCheck({ status: 'idle' })
  }, [])

  // Auto-validate a freshly pasted/typed token after a short debounce. The masked token coming
  // from the server (contains "**") never triggers this because `willSaveNewRawToken` stays false.
  useEffect(() => {
    if (!willSaveNewRawToken) {
      setTokenCheck((prev) => (prev.status === 'idle' ? prev : { status: 'idle' }))
      return
    }

    const candidate = backupBlobReadWriteToken.trim()
    if (!candidate) {
      return
    }

    let cancelled = false
    const timer = window.setTimeout(async () => {
      if (cancelled) {
        return
      }
      setTokenCheck({ status: 'checking' })
      try {
        const response = await fetch(backupPluginPublicApiPaths.adminValidateBlobToken, {
          body: JSON.stringify({ token: candidate }),
          headers: { 'Content-Type': 'application/json' },
          method: 'POST',
        })
        if (cancelled) {
          return
        }
        const data = (await response.json()) as {
          access?: 'private' | 'public'
          error?: string
          ok?: boolean
        }
        if (cancelled) {
          return
        }
        if (response.ok && data.ok && (data.access === 'public' || data.access === 'private')) {
          setTokenCheck({ access: data.access, status: 'valid' })
        } else {
          setTokenCheck({ message: data.error || 'Token rejected', status: 'invalid' })
        }
      } catch (error) {
        if (cancelled) {
          return
        }
        setTokenCheck({
          message: error instanceof Error ? error.message : 'Token validation failed',
          status: 'invalid',
        })
      }
    }, 150)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [backupBlobReadWriteToken, willSaveNewRawToken])

  const blockSaveForTokenCheck =
    willSaveNewRawToken && (tokenCheck.status === 'checking' || tokenCheck.status === 'invalid')

  const tokenStatusPill = (() => {
    if (willSaveNewRawToken) {
      if (tokenCheck.status === 'checking') {
        return <span className="backup-item__pill backup-item__pill--neutral">Checking…</span>
      }
      if (tokenCheck.status === 'valid' && tokenCheck.access) {
        return (
          <span
            className={`backup-item__pill backup-item__pill--${
              tokenCheck.access === 'private' ? 'cron' : 'manual'
            }`}
          >
            {tokenCheck.access === 'private' ? 'Private' : 'Public'}
          </span>
        )
      }
      if (tokenCheck.status === 'invalid') {
        return <span className="backup-item__pill backup-item__pill--danger">Invalid</span>
      }
      return null
    }
    if (effectiveBackupBlobAccess) {
      return (
        <span
          className={`backup-item__pill backup-item__pill--${
            effectiveBackupBlobAccess === 'private' ? 'cron' : 'manual'
          }`}
          title={
            storedBackupBlobAccess
              ? 'Detected and persisted after last validation'
              : 'Heuristic fallback — will be re-validated when saving a new token'
          }
        >
          {effectiveBackupBlobAccess === 'private' ? 'Private' : 'Public'}
        </span>
      )
    }
    return null
  })()

  const includeMediaForCron = useMemo(() => {
    if (!hasMediaBlobOption) {
      return false
    }
    return includeMediaBlobs
  }, [hasMediaBlobOption, includeMediaBlobs])

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

  const save = useCallback(async () => {
    if (!preview) {
      return
    }
    setSavePhase('saving')
    setSaveError(null)
    setTransferSummary(null)
    setActiveTransfer(null)
    setTransferLive(null)
    try {
      const response = await fetch(backupPluginPublicApiPaths.adminSettings, {
        body: JSON.stringify({
          backupBlobReadWriteToken,
          backupsToKeep,
          deleteBackupBlobsFromSource: transferBackupBlobs && deleteBackupBlobsFromSource,
          includeMediaForCron,
          skipMongoCollections: skipCollections,
          transferBackupBlobs,
        }),
        headers: { 'Content-Type': 'application/json' },
        method: 'PATCH',
      })
      const data = (await response.json()) as BackupSettingsApiResponse
      if (!response.ok) {
        throw new Error(data.error || 'Save failed')
      }

      setHasExistingBackupBlobToken(data.hasBackupBlobReadWriteToken === true)
      setBackupBlobReadWriteToken(data.backupBlobTokenMasked || '')
      setStoredBackupBlobAccess(data.backupBlobAccess ?? null)
      setEffectiveBackupBlobAccess(data.backupBlobAccessEffective ?? null)
      setTokenCheck({ status: 'idle' })

      const tr = data.transfer
      if (tr?.performed && tr.deferred && tr.taskId && tr.pollSecret) {
        setActiveTransfer({ pollSecret: tr.pollSecret, taskId: tr.taskId, total: tr.total })
        setTransferLive({ failed: 0, total: tr.total, transferred: 0 })
        setSavePhase('transferring')
        return
      }

      setTransferSummary(tr ?? null)
      setSavePhase('saved')
      router.refresh()
      if (!tr?.performed) {
        window.setTimeout(() => {
          setSavePhase('idle')
          dialogRef.current?.close()
        }, 800)
      } else {
        window.setTimeout(() => {
          setSavePhase('idle')
          dialogRef.current?.close()
        }, 1200)
      }
    } catch (e) {
      setSavePhase('error')
      setSaveError(e instanceof Error ? e.message : 'Save failed')
    }
  }, [
    preview,
    backupsToKeep,
    backupBlobReadWriteToken,
    skipCollections,
    includeMediaForCron,
    transferBackupBlobs,
    deleteBackupBlobsFromSource,
    router,
  ])

  useEffect(() => {
    if (!activeTransfer) {
      return
    }

    let cancelled = false
    let intervalId: null | number = null
    let successCloseTimer: null | number = null

    const stopPolling = () => {
      if (intervalId != null) {
        window.clearInterval(intervalId)
        intervalId = null
      }
    }

    const pollOnce = async () => {
      const res = await fetch(backupPluginPublicApiPaths.adminTask(activeTransfer.taskId), {
        cache: 'no-store',
        headers: { Authorization: `Bearer ${activeTransfer.pollSecret}` },
      })
      if (!res.ok || cancelled) {
        return
      }
      const task = (await res.json()) as BackupTaskProgress
      const parsed = parseBlobTransferTaskMessage(task.message)
      if (parsed) {
        setTransferLive({
          failed: parsed.failed,
          pathname: parsed.pathname,
          total: parsed.total,
          transferred: parsed.transferred,
        })
      }
      if (task.status === 'completed') {
        stopPolling()
        const final = parseBlobTransferTaskMessage(task.message)
        setTransferSummary({
          deferred: false,
          failed: final?.failed ?? 0,
          performed: true,
          skipped: 0,
          total: final?.total ?? activeTransfer.total,
          transferred: final?.transferred ?? 0,
        })
        setActiveTransfer(null)
        setTransferLive(null)
        setSavePhase('saved')
        try {
          const settingsRes = await fetch(backupPluginPublicApiPaths.adminSettings, {
            method: 'GET',
          })
          const refreshed = (await settingsRes.json()) as BackupSettingsApiResponse
          if (settingsRes.ok) {
            setBackupBlobReadWriteToken(refreshed.backupBlobTokenMasked || '')
            setHasExistingBackupBlobToken(refreshed.hasBackupBlobReadWriteToken === true)
          }
        } catch {
          /* ignore */
        }
        router.refresh()
        successCloseTimer = window.setTimeout(() => {
          successCloseTimer = null
          setSavePhase('idle')
          setTransferSummary(null)
          dialogRef.current?.close()
        }, 1400)
        return
      }
      if (task.status === 'failed') {
        stopPolling()
        setSavePhase('error')
        setSaveError(task.error || task.message || 'Transfer failed')
        setActiveTransfer(null)
        setTransferLive(null)
      }
    }

    intervalId = window.setInterval(() => void pollOnce(), 900)
    void pollOnce()
    return () => {
      cancelled = true
      stopPolling()
      if (successCloseTimer != null) {
        window.clearTimeout(successCloseTimer)
      }
    }
  }, [activeTransfer, router])

  const retentionDisabled = pluginOverridesRetention

  return (
    <>
      <Button buttonStyle="secondary" disabled={isPreparingOpen} onClick={openDialog} size="small">
        {isPreparingOpen ? 'Loading…' : 'Backup settings'}
      </Button>

      {/* Native <dialog>: backdrop dismiss; element not in jsx-a11y interactive list */}
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
      <dialog
        className="backup-confirm-dialog backup-confirm-dialog--settings"
        onMouseDown={(e) => closeNativeDialogOnBackdropPointer(e, dialogRef)}
        ref={dialogRef}
      >
        <p className="backup-confirm-dialog__title">Scheduled backup settings</p>
        <p className="backup-confirm-dialog__subtitle backup-confirm-dialog__subtitle--with-help">
          <span className="backup-confirm-dialog__subtitle-text">{TIP_SETTINGS_SUBTITLE}</span>
        </p>

        <div className="backup-confirm-dialog__body restore-preview">
          {phase !== 'idle' ? (
            <>
              <p className="restore-preview__sticky-heading">Schedule</p>
              {phase === 'loading' ? (
                <div
                  aria-live="polite"
                  className="restore-preview__loading-block restore-preview__loading-block--section"
                >
                  <p className="restore-preview__status">Loading cron configuration…</p>
                  <div className="restore-preview__loading-line" />
                  <div className="restore-preview__loading-line restore-preview__loading-line--short" />
                </div>
              ) : phase === 'error' ? (
                <p className="restore-preview__intro">Schedule details could not be loaded.</p>
              ) : cronInfo ? (
                <>
                  <p className="restore-preview__intro">
                    Active job: <code>{cronInfo.configFileRelative}</code> — edit and redeploy to
                    change the schedule.
                  </p>
                  <div aria-label="Configured schedule" className="restore-preview__settings-block">
                    <p className="restore-preview__settings-row">
                      <span className="restore-preview__settings-k">HTTP path</span>{' '}
                      <code>{cronInfo.path}</code>
                    </p>
                    <p className="restore-preview__settings-row">
                      <span className="restore-preview__settings-k">Cron expression</span>{' '}
                      <code>{cronInfo.schedule}</code>
                    </p>
                    {cronInfo.humanDescription ? (
                      <p className="restore-preview__settings-human">{cronInfo.humanDescription}</p>
                    ) : (
                      <p className="restore-preview__settings-human restore-preview__settings-human--muted">
                        Could not turn the cron expression into a short description.
                      </p>
                    )}
                  </div>
                </>
              ) : (
                <>
                  <p className="restore-preview__intro">
                    No vercel <code>crons</code> entry for the backup path yet. You can either setup
                    an external service to call /api/backup-mongodb/cron/run with your cron secret
                    or use Vercel. To use vercel create a file <code>vercel.json</code> in your
                    project root with the following content:
                  </p>
                  <p className="restore-preview__settings-hint">Example</p>
                  <pre className="restore-preview__settings-snippet">{`{
  "crons": [
    {
      "path": "/api/backup-mongodb/cron/run",
      "schedule": "0 3 * * *"
    }
  ]
}`}</pre>
                  <p>
                    Then add a <code>CRON_SECRET</code> environment variable to your Vercel project
                    and redeploy on Vercel so the cron job is registered.
                  </p>
                </>
              )}
            </>
          ) : null}

          <p className="restore-preview__sticky-heading">Retention</p>
          <p className="restore-preview__intro">
            {retentionDisabled ? (
              <>
                Locked by <code>backupMongodbPlugin({'{ backupsToKeep }'})</code> in Payload config.
              </>
            ) : (
              <>Oldest cron archives are deleted once the count exceeds this limit.</>
            )}
          </p>
          <div className="restore-preview__settings-fields">
            <label className="restore-preview__settings-label" htmlFor="backups-to-keep">
              Cron backups to keep
            </label>
            <input
              aria-label="Cron backups to keep"
              className="restore-preview__settings-input"
              disabled={retentionDisabled}
              id="backups-to-keep"
              max={365}
              min={1}
              onChange={(e) => setBackupsToKeep(Number(e.target.value) || 1)}
              type="number"
              value={backupsToKeep}
            />
          </div>

          <p className="restore-preview__sticky-heading">
            Dedicated backup storage{' '}
            <span className="restore-preview__sticky-heading-hint">(optional)</span>
          </p>
          <p className="restore-preview__intro">
            Separate Vercel Blob token for <code>backups/</code>. Without one, archives share the
            default media store.
          </p>
          <div className="restore-preview__settings-fields">
            <label className="restore-preview__settings-label" htmlFor="backup-blob-token">
              Backup Blob read/write token
            </label>
            <div className="restore-preview__blob-token-row">
              <input
                aria-label="Backup Blob read/write token"
                autoComplete="off"
                className="restore-preview__settings-input restore-preview__settings-input--wide"
                id="backup-blob-token"
                onChange={(e) => onChangeBackupBlobToken(e.target.value)}
                placeholder="vercel_blob_rw_..."
                spellCheck={false}
                type="text"
                value={backupBlobReadWriteToken}
              />
              <span className="restore-preview__blob-token-pill-slot">{tokenStatusPill}</span>
            </div>
            {tokenCheck.status === 'invalid' && tokenCheck.message ? (
              <p aria-live="polite" className="restore-preview__blob-token-error">
                {tokenCheck.message}
              </p>
            ) : null}
            {savePhase === 'transferring' && transferLive && transferLive.total > 0 ? (
              <div aria-live="polite" className="restore-preview__transfer-panel">
                <div className="restore-preview__transfer-bar-track">
                  <div
                    className="restore-preview__transfer-bar-fill"
                    style={{
                      width: `${Math.min(
                        100,
                        ((transferLive.transferred + transferLive.failed) / transferLive.total) *
                          100,
                      )}%`,
                    }}
                  />
                </div>
                <p className="restore-preview__transfer-meta">
                  Copying backup files: {transferLive.transferred + transferLive.failed} /{' '}
                  {transferLive.total}
                  {transferLive.failed > 0 ? ` (${transferLive.failed} failed)` : ''}
                  {transferLive.pathname ? (
                    <>
                      <br />
                      <span
                        className="restore-preview__transfer-path"
                        title={transferLive.pathname}
                      >
                        {transferLive.pathname.length > 56
                          ? `${transferLive.pathname.slice(0, 28)}…${transferLive.pathname.slice(-24)}`
                          : transferLive.pathname}
                      </span>
                    </>
                  ) : null}
                </p>
              </div>
            ) : null}
            {willSaveNewRawToken ? (
              <>
                <div className="field-type checkbox backup-dashboard__collapsible-checkbox restore-preview__blob-transfer-row restore-preview__blob-transfer-row--with-help-tip">
                  <input
                    aria-label="Copy existing backup files into this storage when saving"
                    checked={transferBackupBlobs}
                    className="checkbox-input__input"
                    id={transferOptId}
                    onChange={(e) => setTransferBackupBlobs(e.target.checked)}
                    type="checkbox"
                  />
                  <label className="field-label" htmlFor={transferOptId}>
                    Copy existing backup files into this storage when saving
                  </label>
                  <SettingsHelpTip multiline tip={TIP_TRANSFER_COPY} />
                </div>
                {transferBackupBlobs ? (
                  <div className="field-type checkbox backup-dashboard__collapsible-checkbox restore-preview__blob-transfer-row restore-preview__blob-transfer-row--with-help-tip">
                    <input
                      aria-label="Delete from previous storage after successful copy"
                      checked={deleteBackupBlobsFromSource}
                      className="checkbox-input__input"
                      id={deleteSourceOptId}
                      onChange={(e) => setDeleteBackupBlobsFromSource(e.target.checked)}
                      type="checkbox"
                    />
                    <label className="field-label" htmlFor={deleteSourceOptId}>
                      Delete from previous storage after successful copy
                    </label>
                    <SettingsHelpTip multiline tip={TIP_TRANSFER_DELETE} />
                  </div>
                ) : null}
              </>
            ) : null}
          </div>

          <CollectionBackupPreviewBody
            embedded
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

          {saveError ? (
            <p className="restore-preview__error restore-preview__error--inline">{saveError}</p>
          ) : null}
          {savePhase === 'saving' ? (
            <p className="restore-preview__status restore-preview__status--footer">
              Saving settings…
            </p>
          ) : null}
          {transferSummary?.performed ? (
            <p className="restore-preview__status restore-preview__status--footer">
              Migrated backups: {transferSummary.transferred}/{transferSummary.total}
              {transferSummary.failed > 0 ? `, failed: ${transferSummary.failed}` : ''}
            </p>
          ) : null}
        </div>

        <div className="backup-confirm-dialog__actions">
          <Button
            buttonStyle="primary"
            disabled={
              phase !== 'ready' ||
              savePhase === 'saving' ||
              savePhase === 'transferring' ||
              blockSaveForTokenCheck
            }
            onClick={() => void save()}
            size="small"
          >
            {savePhase === 'transferring'
              ? 'Transferring…'
              : savePhase === 'saving'
                ? 'Saving…'
                : savePhase === 'saved'
                  ? 'Saved'
                  : 'Save settings'}
          </Button>
          <Button buttonStyle="secondary" onClick={() => dialogRef.current?.close()} size="small">
            Cancel
          </Button>
        </div>
      </dialog>
    </>
  )
}
