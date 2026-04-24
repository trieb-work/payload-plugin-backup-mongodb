import type { Endpoint } from 'payload'

import type { BackupPluginOptions } from '../types'

import { createAdminBackupDownloadEndpoint } from './paths/admin-backup-download'
import { createAdminDeleteEndpoint } from './paths/admin-delete'
import { createAdminManualEndpoint } from './paths/admin-manual'
import { createAdminPreviewEndpoints } from './paths/admin-preview'
import { createAdminRestoreEndpoint } from './paths/admin-restore'
import { createAdminSeedEndpoint } from './paths/admin-seed'
import { createAdminSettingsEndpoints } from './paths/admin-settings'
import { createAdminTaskEndpoint } from './paths/admin-task'
import { createAdminValidateBlobTokenEndpoint } from './paths/admin-validate-blob-token'
import { createCronListEndpoint } from './paths/cron-list'
import { createCronRestoreEndpoint } from './paths/cron-restore'
import { createCronRunEndpoint } from './paths/cron-run'

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
  if (seed) {
    endpoints.push(seed)
  }

  return endpoints
}
