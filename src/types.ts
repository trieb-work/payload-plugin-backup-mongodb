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
   * Default: checks if user has a role with slug 'admin'.
   */
  access?: (user: Record<string, unknown> | null) => boolean
}
