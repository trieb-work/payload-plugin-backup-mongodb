import type { CollectionConfig } from 'payload'

export const BackupTasksCollection: CollectionConfig = {
  slug: 'backup-tasks',
  access: {
    create: () => false,
    delete: () => false,
    read: () => false,
    update: () => false,
  },
  admin: {
    hidden: true,
  },
  fields: [
    {
      name: 'kind',
      type: 'select',
      options: ['backup', 'restore', 'seed', 'delete', 'blobTransfer'],
      required: true,
    },
    {
      name: 'status',
      type: 'select',
      options: ['queued', 'running', 'completed', 'failed'],
      required: true,
    },
    {
      name: 'message',
      type: 'text',
      required: true,
    },
    {
      name: 'error',
      type: 'text',
    },
    {
      name: 'pollSecret',
      type: 'text',
      admin: {
        hidden: true,
      },
    },
  ],
  timestamps: true,
}
