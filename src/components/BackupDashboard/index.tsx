import './index.scss'

import type { I18n } from '@payloadcms/translations'
import configPromise from '@payload-config'
import { getPayload } from 'payload'
import {
  getBackupSortTimeMs,
  getCurrentDbName,
  getCurrentHostname,
  transformBlobName,
} from '../../utils/index.js'
import { listBackups } from '../../core/backup.js'
import { getResolvedCronBackupSettings, resolveBackupBlobToken } from '../../core/backupSettings.js'
import { BackupListCollapsible, BackupSettingsModal, ManualBackupDialog } from './index.client.js'
import type { BackupPluginOptions } from '../../types.js'

interface BackupDashboardProps {
  user: Record<string, unknown> | null
  i18n: I18n
}

function defaultIsHidden(
  user: Record<string, unknown> | null,
  access?: BackupPluginOptions['access'],
): boolean {
  if (!user) return true
  if (access) return !access(user)
  const roles = user.roles as Array<string | { slug?: string }> | undefined
  if (!roles) return true
  return !roles.some((role) =>
    typeof role === 'string' ? role === 'admin' : role?.slug === 'admin',
  )
}

export const BackupDashboard: React.FC<BackupDashboardProps> = async ({ user, i18n }) => {
  if (defaultIsHidden(user)) {
    return null
  }

  if (!process.env.MONGODB_URI) {
    return null
  }

  const payload = await getPayload({ config: configPromise })
  const settings = await getResolvedCronBackupSettings(payload)
  const blobToken = resolveBackupBlobToken(settings)
  if (!blobToken) return null

  const blobs = await listBackups(blobToken)
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
    <div className="backup-dashboard">
      <h2>
        Backups <span className="experimental">(experimental)</span>
      </h2>

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
          pathname: b.pathname,
          url: b.url,
          downloadUrl: b.downloadUrl,
          size: b.size,
          uploadedAt: new Date(b.uploadedAt).toISOString(),
        }))}
        countOtherDb={countOtherDb}
        countOtherHostname={countOtherHostname}
        currentDbName={currentDbName}
        currentHostname={currentHostname}
        i18nLanguage={i18n?.language || 'en'}
      />
    </div>
  )
}

export default BackupDashboard

