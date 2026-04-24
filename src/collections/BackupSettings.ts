import type { CollectionConfig } from 'payload'

/**
 * Singleton-style settings for scheduled (cron) backups. Hidden from the Payload nav like
 * `backup-tasks`; the backup dashboard reads/writes via custom admin endpoints.
 */
export const BackupSettingsCollection: CollectionConfig = {
  slug: 'backup-settings',
  access: {
    create: () => false,
    delete: () => false,
    read: () => false,
    update: () => false,
  },
  admin: {
    defaultColumns: ['backupsToKeep', 'updatedAt'],
    hidden: true,
  },
  fields: [
    {
      name: 'backupsToKeep',
      type: 'number',
      admin: {
        description: 'How many automatic (cron) backups to keep in blob storage for this project.',
      },
      defaultValue: 10,
      max: 365,
      min: 1,
      required: true,
    },
    {
      name: 'includeMediaForCron',
      type: 'checkbox',
      defaultValue: true,
      label: 'Include media blobs in cron backups',
    },
    {
      name: 'backupBlobReadWriteToken',
      type: 'text',
      admin: {
        description:
          'If set, backup routes use this store instead of BLOB_READ_WRITE_TOKEN. Leave empty for backups on the default token.',
      },
      label: 'Backup Vercel Blob read/write token (optional override)',
    },
    {
      name: 'backupBlobAccess',
      type: 'select',
      admin: {
        description:
          'Populated automatically when the backup token is validated. Controls the access level used when uploading new backup archives.',
        readOnly: true,
      },
      label: 'Detected backup blob access level',
      options: [
        { label: 'Public', value: 'public' },
        { label: 'Private', value: 'private' },
      ],
    },
    {
      name: 'skipMongoCollections',
      type: 'array',
      admin: {
        description:
          'MongoDB collection names excluded from cron backups (same rules as manual backup skips).',
      },
      fields: [
        {
          name: 'name',
          type: 'text',
          required: true,
        },
      ],
      label: 'Mongo collections to skip (cron)',
      labels: { plural: 'Collections', singular: 'Collection' },
    },
  ],
  labels: {
    plural: 'Backup settings',
    singular: 'Backup settings',
  },
  timestamps: true,
}
