export type BackupPluginOptions = {
  /** Enable/disable the plugin entirely. Default: true */
  enabled?: boolean
  /** Number of automatic (cron) backups to keep. Default: process.env.BACKUPS_TO_KEEP or 10 */
  backupsToKeep?: number
  /**
   * When set, registers POST {@code /api/backup-mongodb/admin/seed} (demo DB + media seed).
   * Omit to disable the seed endpoint entirely.
   */
  seedDemoDumpUrl?: string
  /**
   * Custom access control function. Receives the user object from Payload and returns true
   * if the user is allowed to see/use the backup dashboard.
   *
   * When omitted, visibility falls back to the `PAYLOAD_BACKUP_ALLOWED_ROLES` env var
   * (comma-separated role slugs, or `*` for any authenticated user). If that env var is
   * also unset, the historical default applies: user has a role with slug `admin`, or —
   * for users collections that have no `roles` field — any authenticated user.
   */
  access?: (user: Record<string, unknown> | null) => boolean
}
