/**
 * Browser-facing paths for the backup plugin (Payload custom REST under default {@code /api}).
 * Must stay in sync with {@link createBackupMongodbEndpoints} in `endpoints/index.ts`.
 */
export const backupPluginPublicApiPaths = {
  adminBackupDownload: '/api/backup-mongodb/admin/backup-download',
  adminBackupPreview: '/api/backup-mongodb/admin/backup-preview',
  adminDelete: '/api/backup-mongodb/admin/delete',
  adminManual: '/api/backup-mongodb/admin/manual',
  adminRestore: '/api/backup-mongodb/admin/restore',
  adminRestorePreview: '/api/backup-mongodb/admin/restore-preview',
  adminSeed: '/api/backup-mongodb/admin/seed',
  adminSettings: '/api/backup-mongodb/admin/settings',
  adminTask: (id: string) => `/api/backup-mongodb/admin/task/${encodeURIComponent(id)}`,
  adminValidateBlobToken: '/api/backup-mongodb/admin/validate-blob-token',
  cron: '/api/backup-mongodb/cron/run',
  cronRestore: '/api/backup-mongodb/cron/restore',
  list: '/api/backup-mongodb/cron/list',
} as const
