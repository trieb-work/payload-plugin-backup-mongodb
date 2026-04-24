import type { I18n } from '@payloadcms/translations'
import type { Payload } from 'payload'

import type { BackupPluginOptions } from '../../types'

import { listBackups, resolveBackupListToken } from '../../core/backup'
import {
  getBackupSortTimeMs,
  getCurrentDbName,
  getCurrentHostname,
  isUserAllowedByEnvRoles,
  transformBlobName,
} from '../../utils/index'
import { backupDashboardInlineCss } from './backupDashboardInlineCss'
import { BackupListCollapsible, BackupSettingsModal, ManualBackupDialog } from './index.client'

interface BackupDashboardProps {
  i18n: I18n
  /**
   * Payload instance injected by Payload's admin `RenderServerComponent` as a server prop
   * for `afterDashboard` components. Avoids importing `@payload-config` from the plugin,
   * which does not resolve when the plugin runs from `node_modules`.
   */
  payload?: Payload
  /** Optional on admin server props; omitted does not mean logged out (see `defaultIsHidden`). */
  user?: null | Record<string, unknown>
}

function defaultIsHidden(
  user: null | Record<string, unknown> | undefined,
  access?: BackupPluginOptions['access'],
): boolean {
  if (user === null) {
    return true
  }
  if (user === undefined) {
    if (access) {
      return true
    }
    return false
  }
  if (access) {
    return !access(user)
  }
  // Role allow-list via `PAYLOAD_BACKUP_ALLOWED_ROLES`. When unset, falls back to the
  // historical default (admin role, or "visible" when the project has no roles field).
  return !isUserAllowedByEnvRoles(user)
}

export const BackupDashboard: React.FC<BackupDashboardProps> = async ({ i18n, payload, user }) => {
  if (defaultIsHidden(user)) {
    return null
  }

  const hasMongoConnection =
    Boolean(process.env.MONGODB_URI?.trim()) || Boolean(process.env.DATABASE_URL?.trim())
  if (!hasMongoConnection) {
    return (
      <>
        <style dangerouslySetInnerHTML={{ __html: backupDashboardInlineCss }} />
        <div className="backup-dashboard">
          <h2>
            Backups <span className="experimental">(experimental)</span>
          </h2>
          <p className="backup-dashboard__setup-hint" role="status">
            Set <code className="backup-dashboard__setup-hint-code">MONGODB_URI</code> or{' '}
            <code className="backup-dashboard__setup-hint-code">DATABASE_URL</code> so Payload can
            connect to MongoDB. The in-memory dev database sets both automatically when neither is
            provided.
          </p>
        </div>
      </>
    )
  }

  if (!payload) {
    // Should not happen in a normal Payload admin render; guard for safety.
    return (
      <>
        <style dangerouslySetInnerHTML={{ __html: backupDashboardInlineCss }} />
        <div className="backup-dashboard">
          <h2>
            Backups <span className="experimental">(experimental)</span>
          </h2>
          <p className="backup-dashboard__setup-hint" role="status">
            Backup dashboard could not initialise: Payload instance was not provided by the admin
            server props.
          </p>
        </div>
      </>
    )
  }

  const backupBlobToken = await resolveBackupListToken(payload)
  const hasBlobToken = backupBlobToken.trim().length > 0

  const blobs = hasBlobToken ? await listBackups(payload, { blobToken: backupBlobToken }) : []
  const sortedBlobs = [...blobs].sort((a, b) => {
    const ta = getBackupSortTimeMs(transformBlobName(a.pathname), new Date(a.uploadedAt))
    const tb = getBackupSortTimeMs(transformBlobName(b.pathname), new Date(b.uploadedAt))
    return tb - ta
  })
  const currentHostname = getCurrentHostname()
  const currentDbName = getCurrentDbName()

  const countOtherDb = sortedBlobs.filter((blob) => {
    const { dbName } = transformBlobName(blob.pathname)
    return currentDbName !== dbName
  }).length

  const countOtherHostname = sortedBlobs.filter((blob) => {
    const { hostname } = transformBlobName(blob.pathname)
    return currentHostname !== hostname
  }).length
  const lastBackup = sortedBlobs[0]

  return (
    <>
      <style
        dangerouslySetInnerHTML={{ __html: backupDashboardInlineCss }}
        data-payload-backup-mongodb="1"
      />
      <div className="backup-dashboard">
        <h2>
          Backups <span className="experimental">(experimental)</span>
        </h2>

        {!hasBlobToken && (
          <p className="backup-dashboard__setup-hint" role="status">
            Add a Vercel Blob read/write token: set environment variable{' '}
            <code className="backup-dashboard__setup-hint-code">BLOB_READ_WRITE_TOKEN</code>, or
            open <strong>Backup settings</strong> and paste a token. Until then, the list stays
            empty and cron or manual backups cannot run.
          </p>
        )}

        <div className="backup-dashboard__toolbar">
          <div className="backup-dashboard__toolbar-meta">
            <span className="backup-dashboard__toolbar-pill">
              <span className="backup-dashboard__toolbar-key">Total</span>
              {sortedBlobs.length} backup{sortedBlobs.length === 1 ? '' : 's'}
            </span>
            <span className="backup-dashboard__toolbar-pill">
              <span className="backup-dashboard__toolbar-key">Last backup</span>
              {lastBackup
                ? new Date(
                    getBackupSortTimeMs(
                      transformBlobName(lastBackup.pathname),
                      new Date(lastBackup.uploadedAt),
                    ),
                  ).toLocaleString(i18n?.language || 'en')
                : 'No backups yet'}
            </span>
          </div>
          <div className="make-backup-actions">
            <BackupSettingsModal />
            <ManualBackupDialog />
          </div>
        </div>

        <BackupListCollapsible
          blobs={sortedBlobs.map((b) => ({
            downloadUrl: b.downloadUrl,
            pathname: b.pathname,
            size: b.size,
            uploadedAt: new Date(b.uploadedAt).toISOString(),
            url: b.url,
          }))}
          countOtherDb={countOtherDb}
          countOtherHostname={countOtherHostname}
          currentDbName={currentDbName}
          currentHostname={currentHostname}
          i18nLanguage={i18n?.language || 'en'}
        />
      </div>
    </>
  )
}

export default BackupDashboard
