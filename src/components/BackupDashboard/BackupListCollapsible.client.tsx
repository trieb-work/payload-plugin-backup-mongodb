'use client'

import { Button, Collapsible } from '@payloadcms/ui'
import { useCallback, useId, useMemo, useRef, useState } from 'react'

import type { TransformBlobNameResult } from '../../utils/index'

import { closeNativeDialogOnBackdropPointer } from '../../utils/dialogBackdrop'
import { formatBytes, getBackupSortTimeMs, transformBlobName } from '../../utils/index'
import { BackupItemActions } from './BackupItemActions.client'

export interface SerializableBackupBlob {
  downloadUrl: string
  pathname: string
  size: number
  uploadedAt: string
  url: string
}

export interface BackupListCollapsibleProps {
  blobs: SerializableBackupBlob[]
  countOtherDb: number
  countOtherHostname: number
  currentDbName: string
  currentHostname: string
  i18nLanguage: string
}

interface BackupListFilterState {
  dateFrom: string
  dateTo: string
  label: string
  media: 'all' | 'with' | 'without'
  showOtherDb: boolean
  showOtherHostname: boolean
  source: 'all' | 'cron' | 'manual'
}

const defaultFilterState: BackupListFilterState = {
  dateFrom: '',
  dateTo: '',
  label: '',
  media: 'all',
  showOtherDb: true,
  showOtherHostname: false,
  source: 'all',
}

function parseDateInputStartMs(isoDate: string): null | number {
  const parts = isoDate.split('-').map(Number)
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) {
    return null
  }
  const [y, m, d] = parts
  const t = new Date(y, m - 1, d, 0, 0, 0, 0).getTime()
  return Number.isFinite(t) ? t : null
}

function parseDateInputEndMs(isoDate: string): null | number {
  const parts = isoDate.split('-').map(Number)
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) {
    return null
  }
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
    if (from != null && displayMs < from) {
      return false
    }
  }
  if (filters.dateTo) {
    const to = parseDateInputEndMs(filters.dateTo)
    if (to != null && displayMs > to) {
      return false
    }
  }
  if (filters.media === 'with' && parsed.fileType !== 'tar.gz') {
    return false
  }
  if (filters.media === 'without' && parsed.fileType !== 'json') {
    return false
  }
  if (filters.source === 'manual' && parsed.type !== 'manual') {
    return false
  }
  if (filters.source === 'cron' && parsed.type !== 'cron') {
    return false
  }
  const labelQuery = filters.label.trim().toLowerCase()
  if (labelQuery) {
    const blobLabel = (parsed.label ?? '').toLowerCase()
    if (!blobLabel.includes(labelQuery)) {
      return false
    }
  }
  return true
}

function hasNonDefaultFilters(f: BackupListFilterState): boolean {
  return (
    f.dateFrom !== defaultFilterState.dateFrom ||
    f.dateTo !== defaultFilterState.dateTo ||
    f.label !== defaultFilterState.label ||
    f.media !== defaultFilterState.media ||
    f.source !== defaultFilterState.source ||
    f.showOtherDb !== defaultFilterState.showOtherDb ||
    f.showOtherHostname !== defaultFilterState.showOtherHostname
  )
}

export const BackupListCollapsible: React.FC<BackupListCollapsibleProps> = ({
  blobs,
  countOtherDb,
  countOtherHostname,
  currentDbName,
  currentHostname,
  i18nLanguage,
}) => {
  const uid = useId()
  const idDb = `${uid}-show-other-db`
  const idHost = `${uid}-show-other-host`
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [filters, setFilters] = useState<BackupListFilterState>(defaultFilterState)

  const visibleRows = useMemo(() => {
    const rows: Array<{
      blob: SerializableBackupBlob
      displayAt: Date
      displayMs: number
      parsed: TransformBlobNameResult
    }> = []

    for (const blob of blobs) {
      const parsed = transformBlobName(blob.pathname)
      const { dbName, hostname } = parsed
      const isCurrentDb = currentDbName === dbName
      const isCurrentHostname = currentHostname === hostname
      if (!(filters.showOtherDb || isCurrentDb)) {
        continue
      }
      if (!(filters.showOtherHostname || isCurrentHostname)) {
        continue
      }

      const uploadedAt = new Date(blob.uploadedAt)
      const displayMs = getBackupSortTimeMs(parsed, uploadedAt)
      if (!passesDateMediaSource(parsed, displayMs, filters)) {
        continue
      }

      rows.push({
        blob,
        displayAt: new Date(displayMs),
        displayMs,
        parsed,
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
        filtersActive ?
          'backup-dashboard__filter-btn backup-dashboard__filter-btn--active'
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
        {blobs.length === 0 ?
          <p className="backup-dashboard__list-empty">No backups yet</p>
        : visibleRows.length === 0 ?
          <p className="backup-dashboard__list-empty">No backups match the current filters</p>
        : visibleRows.map(({ blob, displayAt, parsed }) => {
            const { type, collectionCount, dbName, fileType, hostname, label } = parsed
            const isCurrentDb = currentDbName === dbName
            const isCurrentHostname = currentHostname === hostname

            return (
              <div className="backup-item" key={blob.pathname}>
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
                    {label ?
                      <span
                        className="backup-item__pill backup-item__pill--label"
                        title={`Label: ${label}`}
                      >
                        <span className="backup-item__pill-key">Label</span>
                        {label}
                      </span>
                    : null}
                  </div>
                  <div className="backup-item__meta">
                    <span
                      className={`backup-item__pill backup-item__pill--db${isCurrentDb ? '' : ' backup-item__pill--warn'}`}
                    >
                      <span className="backup-item__pill-key">
                        {isCurrentDb ? 'DB' : 'other DB'}
                      </span>
                      {dbName || 'Unknown'}
                    </span>
                    <span
                      className={`backup-item__pill backup-item__pill--host${isCurrentHostname ? '' : ' backup-item__pill--warn'}`}
                    >
                      <span className="backup-item__pill-key">Host</span>
                      {hostname || 'Unknown'}
                    </span>
                    {typeof collectionCount === 'number' ?
                      <span className="backup-item__pill backup-item__pill--collections">
                        <span className="backup-item__pill-key">Collections</span>
                        {collectionCount}
                      </span>
                    : null}
                    {fileType === 'tar.gz' ?
                      <span className="backup-item__pill backup-item__pill--media">With media</span>
                    : fileType === 'json' ?
                      <span className="backup-item__pill backup-item__pill--media">
                        Without media
                      </span>
                    : null}
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
        }
      </Collapsible>

      <dialog
        className="backup-confirm-dialog backup-confirm-dialog--backup-list-filters"
        onPointerDown={(e) => closeNativeDialogOnBackdropPointer(e, dialogRef)}
        ref={dialogRef}
      >
        <h3 className="backup-confirm-dialog__title">Filter backups</h3>
        <p className="backup-confirm-dialog__subtitle">
          All filters apply in the browser only. Current DB and hostname are always shown; enable
          the options below to include backups from other databases or hosts.
        </p>
        <div className="backup-confirm-dialog__body backup-list-filters__body">
          {hasScopeOptions ?
            <fieldset className="backup-list-filters__fieldset">
              <legend className="backup-list-filters__legend">Scope</legend>
              {countOtherDb > 0 ?
                <div className="field-type checkbox backup-dashboard__collapsible-checkbox backup-list-filters__scope-row">
                  <input
                    aria-label={`Show other databases (${countOtherDb} in list)`}
                    checked={filters.showOtherDb}
                    className="checkbox-input__input"
                    id={idDb}
                    onChange={(e) => setFilters((f) => ({ ...f, showOtherDb: e.target.checked }))}
                    type="checkbox"
                  />
                  <label className="field-label" htmlFor={idDb}>
                    Show other DBs
                    <span className="backup-list-filters__hint"> ({countOtherDb} in list)</span>
                  </label>
                </div>
              : null}
              {countOtherHostname > 0 ?
                <div className="field-type checkbox backup-dashboard__collapsible-checkbox backup-list-filters__scope-row">
                  <input
                    aria-label={`Show other hostnames (${countOtherHostname} in list)`}
                    checked={filters.showOtherHostname}
                    className="checkbox-input__input"
                    id={idHost}
                    onChange={(e) =>
                      setFilters((f) => ({ ...f, showOtherHostname: e.target.checked }))
                    }
                    type="checkbox"
                  />
                  <label className="field-label" htmlFor={idHost}>
                    Show other Hostnames
                    <span className="backup-list-filters__hint">
                      {' '}
                      ({countOtherHostname} in list)
                    </span>
                  </label>
                </div>
              : null}
            </fieldset>
          : null}

          <fieldset className="backup-list-filters__fieldset">
            <legend className="backup-list-filters__legend">Label</legend>
            <div className="backup-list-filters__row backup-list-filters__row--label">
              <label className="backup-list-filters__label" htmlFor={`${uid}-label`}>
                Search
              </label>
              <input
                aria-label="Filter backups by label text"
                autoComplete="off"
                className="backup-list-filters__text"
                id={`${uid}-label`}
                onChange={(e) => setFilters((f) => ({ ...f, label: e.target.value }))}
                placeholder="Filter by label text"
                spellCheck={false}
                type="text"
                value={filters.label}
              />
            </div>
          </fieldset>

          <fieldset className="backup-list-filters__fieldset">
            <legend className="backup-list-filters__legend">Date range</legend>
            <div className="backup-list-filters__row">
              <label className="backup-list-filters__label" htmlFor={`${uid}-from`}>
                From
              </label>
              <input
                aria-label="Filter from date"
                className="backup-list-filters__date"
                id={`${uid}-from`}
                onChange={(e) => setFilters((f) => ({ ...f, dateFrom: e.target.value }))}
                type="date"
                value={filters.dateFrom}
              />
            </div>
            <div className="backup-list-filters__row">
              <label className="backup-list-filters__label" htmlFor={`${uid}-to`}>
                To
              </label>
              <input
                aria-label="Filter to date"
                className="backup-list-filters__date"
                id={`${uid}-to`}
                onChange={(e) => setFilters((f) => ({ ...f, dateTo: e.target.value }))}
                type="date"
                value={filters.dateTo}
              />
            </div>
          </fieldset>

          <fieldset className="backup-list-filters__fieldset">
            <legend className="backup-list-filters__legend">Media</legend>
            <div className="field-type radio backup-list-filters__radio-row">
              <input
                aria-label="Media filter: all backups"
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
                aria-label="Media filter: with media"
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
                aria-label="Media filter: without media"
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
                aria-label="Source filter: all"
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
                aria-label="Source filter: manual backups"
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
                aria-label="Source filter: cron backups"
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
