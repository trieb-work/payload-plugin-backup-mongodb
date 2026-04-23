import type { CollectionConfig } from 'payload'

/**
 * Singleton-style settings for scheduled (cron) backups. Hidden from the Payload nav like
 * `backup-tasks`; the backup dashboard reads/writes via custom admin endpoints.
 */
export const BackupSettingsCollection: CollectionConfig = {
  slug: 'backup-settings',
  labels: {
    singular: 'Backup settings',
    plural: 'Backup settings',
  },
  admin: {
    hidden: true,
    defaultColumns: ['backupsToKeep', 'updatedAt'],
  },
  access: {
    create: () => false,
    read: () => false,
    update: () => false,
    delete: () => false,
  },
  fields: [
    {
      name: 'backupsToKeep',
      type: 'number',
      required: true,
      defaultValue: 10,
      min: 1,
      max: 365,
      admin: {
        description: 'How many automatic (cron) backups to keep in blob storage for this project.',
      },
    },
    {
      name: 'includeMediaForCron',
      type: 'checkbox',
      label: 'Include media blobs in cron backups',
      defaultValue: true,
    },
    {
      name: 'backupBlobReadWriteToken',
      type: 'text',
      label: 'Backup Vercel Blob read/write token (optional override)',
      admin: {
        description:
          'If set, backup routes use this store instead of BLOB_READ_WRITE_TOKEN. Leave empty for backups on the default token.',
      },
    },
    {
      name: 'backupBlobAccess',
      type: 'select',
      label: 'Detected backup blob access level',
      options: [
        { label: 'Public', value: 'public' },
        { label: 'Private', value: 'private' },
      ],
      admin: {
        description:
          'Populated automatically when the backup token is validated. Controls the access level used when uploading new backup archives.',
        readOnly: true,
      },
    },
    {
      name: 'skipMongoCollections',
      type: 'array',
      label: 'Mongo collections to skip (cron)',
      labels: { singular: 'Collection', plural: 'Collections' },
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
    },
  ],
  timestamps: true,
}
