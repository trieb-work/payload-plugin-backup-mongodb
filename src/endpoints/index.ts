import type { Endpoint } from 'payload'

import type { BackupPluginOptions } from '../types.js'
import { createAdminBackupDownloadEndpoint } from './paths/admin-backup-download.js'
import { createAdminDeleteEndpoint } from './paths/admin-delete.js'
import { createAdminManualEndpoint } from './paths/admin-manual.js'
import { createAdminPreviewEndpoints } from './paths/admin-preview.js'
import { createAdminRestoreEndpoint } from './paths/admin-restore.js'
import { createAdminSeedEndpoint } from './paths/admin-seed.js'
import { createAdminSettingsEndpoints } from './paths/admin-settings.js'
import { createAdminTaskEndpoint } from './paths/admin-task.js'
import { createAdminValidateBlobTokenEndpoint } from './paths/admin-validate-blob-token.js'
import { createCronListEndpoint } from './paths/cron-list.js'
import { createCronRestoreEndpoint } from './paths/cron-restore.js'
import { createCronRunEndpoint } from './paths/cron-run.js'

export function createBackupMongodbEndpoints(options: BackupPluginOptions): Endpoint[] {
  const endpoints: Endpoint[] = [
    createCronRunEndpoint(options),
    createCronListEndpoint(),
    createCronRestoreEndpoint(),
    createAdminManualEndpoint(options),
    createAdminBackupDownloadEndpoint(options),
    createAdminRestoreEndpoint(options),
    ...createAdminPreviewEndpoints(options),
    ...createAdminSettingsEndpoints(options),
    createAdminDeleteEndpoint(options),
    createAdminTaskEndpoint(options),
    createAdminValidateBlobTokenEndpoint(options),
  ]

  const seed = createAdminSeedEndpoint(options)
  if (seed) endpoints.push(seed)

  return endpoints
}
