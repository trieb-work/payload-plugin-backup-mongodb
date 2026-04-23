import type { Config, Plugin } from 'payload'
import { createBackupMongodbEndpoints } from './endpoints/index.js'
import type { BackupPluginOptions } from './types.js'
import { BackupSettingsCollection } from './collections/BackupSettings.js'
import { BackupTasksCollection } from './collections/BackupTasks.js'
import { BACKUP_SETTINGS_SLUG } from './core/backupSettings.js'

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
      collections: [...existingCollections, BackupTasksCollection, BackupSettingsCollection],
      endpoints: [...existingEndpoints, ...backupEndpoints],
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
                backupsToKeep: Number(process.env.BACKUPS_TO_KEEP) || 10,
                backupBlobAccess: null,
                backupBlobReadWriteToken: '',
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
              .createIndex({ updatedAt: 1 }, { expireAfterSeconds: 1800, background: true })
          }
        } catch {
          payload.logger.warn('[backup-plugin] Could not create TTL index on backup-tasks')
        }
      },
    }
  }
}
