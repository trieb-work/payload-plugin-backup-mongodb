import type { Config, Plugin } from 'payload'

import type { BackupPluginOptions } from './types'

import { BackupSettingsCollection } from './collections/BackupSettings'
import { BackupTasksCollection } from './collections/BackupTasks'
import { BACKUP_SETTINGS_SLUG } from './core/backupSettings'
import { createBackupMongodbEndpoints } from './endpoints/index'

export const backupMongodbPlugin = (options: BackupPluginOptions = {}): Plugin => {
  return (incomingConfig: Config): Config => {
    if (options.enabled === false) {
      return incomingConfig
    }

    const existingAfterDashboard = incomingConfig.admin?.components?.afterDashboard || []
    const existingCollections = incomingConfig.collections || []
    const existingEndpoints = incomingConfig.endpoints ?? []
    const backupEndpoints = createBackupMongodbEndpoints(options)

    return {
      ...incomingConfig,
      admin: {
        ...incomingConfig.admin,
        components: {
          ...incomingConfig.admin?.components,
          afterDashboard: [
            ...existingAfterDashboard,
            '@trieb.work/payload-plugin-backup-mongodb/rsc#BackupDashboard',
          ],
        },
      },
      collections: [...existingCollections, BackupTasksCollection, BackupSettingsCollection],
      endpoints: [...existingEndpoints, ...backupEndpoints],
      onInit: async (payload) => {
        await incomingConfig.onInit?.(payload)
        try {
          const existing = await payload.count({
            collection: BACKUP_SETTINGS_SLUG,
            overrideAccess: true,
          })
          if (existing.totalDocs === 0) {
            await payload.create({
              collection: BACKUP_SETTINGS_SLUG,
              data: {
                backupBlobAccess: null,
                backupBlobReadWriteToken: '',
                backupsToKeep: Number(process.env.BACKUPS_TO_KEEP) || 10,
                includeMediaForCron: true,
                skipMongoCollections: [],
              },
              overrideAccess: true,
            })
            payload.logger.info('[backup-plugin] Created default backup-settings document')
          }
        } catch (err) {
          payload.logger.warn({ err }, '[backup-plugin] Could not ensure backup-settings document')
        }
        try {
          if (payload.db.name === 'mongoose') {
            const db = (payload.db as any).connection.db
            await db
              .collection('backup-tasks')
              .createIndex({ updatedAt: 1 }, { background: true, expireAfterSeconds: 1800 })
          }
        } catch {
          payload.logger.warn('[backup-plugin] Could not create TTL index on backup-tasks')
        }
      },
    }
  }
}
