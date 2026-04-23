'use client'

import { Button, Collapsible } from '@payloadcms/ui'
import { useCallback, useId, useMemo, useRef, useState } from 'react'

import type { TransformBlobNameResult } from '../../utils/index.js'
import { formatBytes, getBackupSortTimeMs, transformBlobName } from '../../utils/index.js'
import { closeNativeDialogOnBackdropPointer } from '../../utils/dialogBackdrop.js'

import { BackupItemActions } from './BackupItemActions.client.js'

export interface SerializableBackupBlob {
  pathname: string
  url: string
  downloadUrl: string
  size: number
  uploadedAt: string
}

export interface BackupListCollapsibleProps {
  blobs: SerializableBackupBlob[]
  i18nLanguage: string
  currentDbName: string
  currentHostname: string
  countOtherDb: number
  countOtherHostname: number
}

interface BackupListFilterState {
  dateFrom: string
  dateTo: string
  media: 'all' | 'with' | 'without'
  source: 'all' | 'manual' | 'cron'
  showOtherDb: boolean
  showOtherHostname: boolean
}

const defaultFilterState: BackupListFilterState = {
  dateFrom: '',
  dateTo: '',
  media: 'all',
  source: 'all',
  showOtherDb: true,
  showOtherHostname: false,
}

function parseDateInputStartMs(isoDate: string): number | null {
  const parts = isoDate.split('-').map(Number)
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return null
  const [y, m, d] = parts
  const t = new Date(y, m - 1, d, 0, 0, 0, 0).getTime()
  return Number.isFinite(t) ? t : null
}

function parseDateInputEndMs(isoDate: string): number | null {
  const parts = isoDate.split('-').map(Number)
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return null
  const [y, m, d] = parts
  const t = new Date(y, m - 1, d, 23, 59, 59, 999).getTime()
  return Number.isFinite(t) ? t : null
}

function passesDateMediaSource(
  parsed: TransformBlobNameResult,
  displayMs: number,
  filters: BackupListFilterState,
): boolean {
  if (filters.dateFrom) {
    const from = parseDateInputStartMs(filters.dateFrom)
    if (from != null && displayMs < from) return false
  }
  if (filters.dateTo) {
    const to = parseDateInputEndMs(filters.dateTo)
    if (to != null && displayMs > to) return false
  }
  if (filters.media === 'with' && parsed.fileType !== 'tar.gz') return false
  if (filters.media === 'without' && parsed.fileType !== 'json') return false
  if (filters.source === 'manual' && parsed.type !== 'manual') return false
  if (filters.source === 'cron' && parsed.type !== 'cron') return false
  return true
}

function hasNonDefaultFilters(f: BackupListFilterState): boolean {
  return (
    f.dateFrom !== defaultFilterState.dateFrom ||
    f.dateTo !== defaultFilterState.dateTo ||
    f.media !== defaultFilterState.media ||
    f.source !== defaultFilterState.source ||
    f.showOtherDb !== defaultFilterState.showOtherDb ||
    f.showOtherHostname !== defaultFilterState.showOtherHostname
  )
}

export const BackupListCollapsible: React.FC<BackupListCollapsibleProps> = ({
  blobs,
  i18nLanguage,
  currentDbName,
  currentHostname,
  countOtherDb,
  countOtherHostname,
}) => {
  const uid = useId()
  const idDb = `${uid}-show-other-db`
  const idHost = `${uid}-show-other-host`
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [filters, setFilters] = useState<BackupListFilterState>(defaultFilterState)

  const visibleRows = useMemo(() => {
    const rows: Array<{
      blob: SerializableBackupBlob
      parsed: TransformBlobNameResult
      displayMs: number
      displayAt: Date
    }> = []

    for (const blob of blobs) {
      const parsed = transformBlobName(blob.pathname)
      const { dbName, hostname } = parsed
      const isCurrentDb = currentDbName === dbName
      const isCurrentHostname = currentHostname === hostname
      if (!(filters.showOtherDb || isCurrentDb)) continue
      if (!(filters.showOtherHostname || isCurrentHostname)) continue

      const uploadedAt = new Date(blob.uploadedAt)
      const displayMs = getBackupSortTimeMs(parsed, uploadedAt)
      if (!passesDateMediaSource(parsed, displayMs, filters)) continue

      rows.push({
        blob,
        parsed,
        displayMs,
        displayAt: new Date(displayMs),
      })
    }

    return rows
  }, [blobs, currentDbName, currentHostname, filters])

  const openFilterDialog = useCallback(() => {
    dialogRef.current?.showModal()
  }, [])

  const closeFilterDialog = useCallback(() => {
    dialogRef.current?.close()
  }, [])

  const clearFilters = useCallback(() => {
    setFilters(defaultFilterState)
  }, [])

  const hasScopeOptions = countOtherDb > 0 || countOtherHostname > 0
  const filtersActive = hasNonDefaultFilters(filters)

  const filtersButton = (
    <Button
      buttonStyle="secondary"
      className={
        filtersActive
          ? 'backup-dashboard__filter-btn backup-dashboard__filter-btn--active'
          : 'backup-dashboard__filter-btn'
      }
      onClick={openFilterDialog}
      type="button"
    >
      Filters
    </Button>
  )

  return (
    <>
      <Collapsible
        header={<span className="backup-dashboard__collapsible-title">Backup list</span>}
        initCollapsed={true}
      >
        <div className="backup-dashboard__backup-list-toolbar">{filtersButton}</div>
        {blobs.length === 0 ? (
          <p className="backup-dashboard__list-empty">No backups yet</p>
        ) : visibleRows.length === 0 ? (
          <p className="backup-dashboard__list-empty">No backups match the current filters</p>
        ) : (
          visibleRows.map(({ blob, parsed, displayAt }) => {
            const { type, dbName, hostname, fileType, collectionCount } = parsed
            const isCurrentDb = currentDbName === dbName
            const isCurrentHostname = currentHostname === hostname

            return (
              <div key={blob.pathname} className="backup-item">
                <div className="backup-item__main">
                  <div className="backup-item__primary">
                    <time
                      className="backup-item__time"
                      dateTime={displayAt.toISOString()}
                      suppressHydrationWarning
                    >
                      {displayAt.toLocaleString(i18nLanguage)}
                    </time>
                    <span
                      className={`backup-item__pill backup-item__pill--kind backup-item__pill--${type === 'cron' ? 'cron' : 'manual'}`}
                    >
                      {type === 'cron' ? 'Cron backup' : 'Manual backup'}
                    </span>
                  </div>
                  <div className="backup-item__meta">
                    <span
                      className={`backup-item__pill backup-item__pill--db${isCurrentDb ? '' : 'backup-item__pill--warn'}`}
                    >
                      <span className="backup-item__pill-key">
                        {isCurrentDb ? 'DB' : 'other DB'}
                      </span>
                      {dbName || 'Unknown'}
                    </span>
                    <span
                      className={`backup-item__pill backup-item__pill--host${isCurrentHostname ? '' : 'backup-item__pill--warn'}`}
                    >
                      <span className="backup-item__pill-key">Host</span>
                      {hostname || 'Unknown'}
                    </span>
                    {typeof collectionCount === 'number' ? (
                      <span className="backup-item__pill backup-item__pill--collections">
                        <span className="backup-item__pill-key">Collections</span>
                        {collectionCount}
                      </span>
                    ) : null}
                    {fileType === 'tar.gz' ? (
                      <span className="backup-item__pill backup-item__pill--media">With media</span>
                    ) : fileType === 'json' ? (
                      <span className="backup-item__pill backup-item__pill--media">
                        Without media
                      </span>
                    ) : null}
                    <span
                      className="backup-item__pill backup-item__pill--size"
                      title={`${blob.size.toLocaleString(i18nLanguage)} bytes`}
                    >
                      <span className="backup-item__pill-key">Size</span>
                      <span className="backup-item__size-value">{formatBytes(blob.size)}</span>
                    </span>
                  </div>
                </div>
                <BackupItemActions
                  downloadUrl={blob.downloadUrl}
                  pathname={blob.pathname}
                  url={blob.url}
                />
              </div>
            )
          })
        )}
      </Collapsible>

      <dialog
        className="backup-confirm-dialog backup-confirm-dialog--backup-list-filters"
        ref={dialogRef}
        onPointerDown={(e) => closeNativeDialogOnBackdropPointer(e, dialogRef)}
      >
        <h3 className="backup-confirm-dialog__title">Filter backups</h3>
        <p className="backup-confirm-dialog__subtitle">
          All filters apply in the browser only. Current DB and hostname are always shown; enable
          the options below to include backups from other databases or hosts.
        </p>
        <div className="backup-confirm-dialog__body backup-list-filters__body">
          {hasScopeOptions ? (
            <fieldset className="backup-list-filters__fieldset">
              <legend className="backup-list-filters__legend">Scope</legend>
              {countOtherDb > 0 ? (
                <div className="field-type checkbox backup-dashboard__collapsible-checkbox backup-list-filters__scope-row">
                  <input
                    id={idDb}
                    type="checkbox"
                    className="checkbox-input__input"
                    checked={filters.showOtherDb}
                    onChange={(e) => setFilters((f) => ({ ...f, showOtherDb: e.target.checked }))}
                  />
                  <label htmlFor={idDb} className="field-label">
                    Show other DBs
                    <span className="backup-list-filters__hint"> ({countOtherDb} in list)</span>
                  </label>
                </div>
              ) : null}
              {countOtherHostname > 0 ? (
                <div className="field-type checkbox backup-dashboard__collapsible-checkbox backup-list-filters__scope-row">
                  <input
                    id={idHost}
                    type="checkbox"
                    className="checkbox-input__input"
                    checked={filters.showOtherHostname}
                    onChange={(e) =>
                      setFilters((f) => ({ ...f, showOtherHostname: e.target.checked }))
                    }
                  />
                  <label htmlFor={idHost} className="field-label">
                    Show other Hostnames
                    <span className="backup-list-filters__hint">
                      {' '}
                      ({countOtherHostname} in list)
                    </span>
                  </label>
                </div>
              ) : null}
            </fieldset>
          ) : null}

          <fieldset className="backup-list-filters__fieldset">
            <legend className="backup-list-filters__legend">Date range</legend>
            <div className="backup-list-filters__row">
              <label className="backup-list-filters__label" htmlFor={`${uid}-from`}>
                From
              </label>
              <input
                className="backup-list-filters__date"
                id={`${uid}-from`}
                type="date"
                value={filters.dateFrom}
                onChange={(e) => setFilters((f) => ({ ...f, dateFrom: e.target.value }))}
              />
            </div>
            <div className="backup-list-filters__row">
              <label className="backup-list-filters__label" htmlFor={`${uid}-to`}>
                To
              </label>
              <input
                className="backup-list-filters__date"
                id={`${uid}-to`}
                type="date"
                value={filters.dateTo}
                onChange={(e) => setFilters((f) => ({ ...f, dateTo: e.target.value }))}
              />
            </div>
          </fieldset>

          <fieldset className="backup-list-filters__fieldset">
            <legend className="backup-list-filters__legend">Media</legend>
            <div className="field-type radio backup-list-filters__radio-row">
              <input
                checked={filters.media === 'all'}
                className="radio-input__input"
                id={`${uid}-media-all`}
                name={`${uid}-media`}
                onChange={() => setFilters((f) => ({ ...f, media: 'all' }))}
                type="radio"
              />
              <label className="field-label" htmlFor={`${uid}-media-all`}>
                All
              </label>
            </div>
            <div className="field-type radio backup-list-filters__radio-row">
              <input
                checked={filters.media === 'with'}
                className="radio-input__input"
                id={`${uid}-media-with`}
                name={`${uid}-media`}
                onChange={() => setFilters((f) => ({ ...f, media: 'with' }))}
                type="radio"
              />
              <label className="field-label" htmlFor={`${uid}-media-with`}>
                With media
              </label>
            </div>
            <div className="field-type radio backup-list-filters__radio-row">
              <input
                checked={filters.media === 'without'}
                className="radio-input__input"
                id={`${uid}-media-without`}
                name={`${uid}-media`}
                onChange={() => setFilters((f) => ({ ...f, media: 'without' }))}
                type="radio"
              />
              <label className="field-label" htmlFor={`${uid}-media-without`}>
                Without media
              </label>
            </div>
          </fieldset>

          <fieldset className="backup-list-filters__fieldset">
            <legend className="backup-list-filters__legend">Source</legend>
            <div className="field-type radio backup-list-filters__radio-row">
              <input
                checked={filters.source === 'all'}
                className="radio-input__input"
                id={`${uid}-source-all`}
                name={`${uid}-source`}
                onChange={() => setFilters((f) => ({ ...f, source: 'all' }))}
                type="radio"
              />
              <label className="field-label" htmlFor={`${uid}-source-all`}>
                All
              </label>
            </div>
            <div className="field-type radio backup-list-filters__radio-row">
              <input
                checked={filters.source === 'manual'}
                className="radio-input__input"
                id={`${uid}-source-manual`}
                name={`${uid}-source`}
                onChange={() => setFilters((f) => ({ ...f, source: 'manual' }))}
                type="radio"
              />
              <label className="field-label" htmlFor={`${uid}-source-manual`}>
                Manual
              </label>
            </div>
            <div className="field-type radio backup-list-filters__radio-row">
              <input
                checked={filters.source === 'cron'}
                className="radio-input__input"
                id={`${uid}-source-cron`}
                name={`${uid}-source`}
                onChange={() => setFilters((f) => ({ ...f, source: 'cron' }))}
                type="radio"
              />
              <label className="field-label" htmlFor={`${uid}-source-cron`}>
                Cron
              </label>
            </div>
          </fieldset>
        </div>
        <div className="backup-confirm-dialog__actions">
          <Button buttonStyle="secondary" onClick={clearFilters} type="button">
            Clear filters
          </Button>
          <Button onClick={closeFilterDialog} type="button">
            Done
          </Button>
        </div>
      </dialog>
    </>
  )
}
