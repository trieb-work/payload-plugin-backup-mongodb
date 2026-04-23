export { backupMongodbPlugin } from './plugin.js'
export { backupPluginPublicApiPaths } from './publicApiPaths.js'
export type { BackupPluginOptions } from './types.js'

export { createBackup, listBackups, createMediaBackupFile } from './core/backup.js'
export { getBackupSourcePreviewForManual } from './core/backupSourcePreview.js'
export type { BackupSourcePreviewResponse } from './core/backupSourcePreview.js'
export { restoreBackup, restoreSeedMedia } from './core/restore.js'
export type { RestoreBackupOptions } from './core/restore.js'
export {
  buildCollectionPreviewGroups,
  buildRestorePreviewGroups,
  getRestorePreviewForAdminRestore,
  loadRestoreBackupIndex,
  navVisibleCollectionOrderIndex,
} from './core/restorePreview.js'
export type {
  RestorePreviewAdminHiddenReason,
  RestorePreviewFileKind,
  RestorePreviewGroup,
  RestorePreviewResponse,
} from './core/restorePreview.js'
export { getDb } from './core/db.js'
export type { MongoDb } from './core/db.js'
export { createTarGzip, resolveTarGzip } from './core/archive.js'
export {
  completeBackupTask,
  createBackupTask,
  failBackupTask,
  getBackupTask,
  pollSecretsMatch,
  stripPollSecretForClient,
  updateBackupTask,
} from './core/taskProgress.js'
export type {
  BackupTaskKind,
  BackupTaskProgress,
  BackupTaskStatus,
  BackupTaskWithPollSecret,
} from './core/taskProgress.js'

export { createBlobName, getBackupSortTimeMs, transformBlobName } from './utils/blobName.js'
export { formatBytes } from './utils/formatBytes.js'
export { getCurrentDbName, getCurrentHostname } from './utils/hostname.js'
