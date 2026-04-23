/**
 * Browser-facing paths for the backup plugin (Payload custom REST under default {@code /api}).
 * Must stay in sync with {@link createBackupMongodbEndpoints} in `endpoints/index.ts`.
 */
export const backupPluginPublicApiPaths = {
  cron: '/api/backup-mongodb/cron/run',
  list: '/api/backup-mongodb/cron/list',
  cronRestore: '/api/backup-mongodb/cron/restore',
  adminManual: '/api/backup-mongodb/admin/manual',
  adminRestore: '/api/backup-mongodb/admin/restore',
  adminBackupPreview: '/api/backup-mongodb/admin/backup-preview',
  adminRestorePreview: '/api/backup-mongodb/admin/restore-preview',
  adminBackupDownload: '/api/backup-mongodb/admin/backup-download',
  adminDelete: '/api/backup-mongodb/admin/delete',
  adminSeed: '/api/backup-mongodb/admin/seed',
  adminTask: (id: string) => `/api/backup-mongodb/admin/task/${encodeURIComponent(id)}`,
  adminSettings: '/api/backup-mongodb/admin/settings',
  adminValidateBlobToken: '/api/backup-mongodb/admin/validate-blob-token',
} as const
