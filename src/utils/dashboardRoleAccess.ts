/**
 * Resolves which users may see/use the backup dashboard when no custom `access`
 * option is passed to the plugin. Driven by the `PAYLOAD_BACKUP_ALLOWED_ROLES`
 * environment variable.
 *
 * Syntax:
 *   PAYLOAD_BACKUP_ALLOWED_ROLES=admin,editor   // any user whose roles[].slug matches
 *   PAYLOAD_BACKUP_ALLOWED_ROLES=*              // any authenticated user
 *   (unset / empty)                             // backwards-compatible default:
 *                                               //   - roles present -> require `admin`
 *                                               //   - no roles field -> allow
 */

export const BACKUP_ALLOWED_ROLES_ENV = 'PAYLOAD_BACKUP_ALLOWED_ROLES'

/** Parses the env var value into a normalized list of role slugs (lower-cased, trimmed). */
export function parseAllowedRolesEnv(raw: string | undefined): string[] {
  if (!raw) return []
  return raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0)
}

function extractRoleSlugs(user: Record<string, unknown>): string[] | null {
  const roles = user.roles as Array<{ slug?: unknown } | string> | undefined
  if (!Array.isArray(roles)) return null
  const slugs: string[] = []
  for (const entry of roles) {
    if (typeof entry === 'string') {
      slugs.push(entry.toLowerCase())
    } else if (entry && typeof entry === 'object' && typeof entry.slug === 'string') {
      slugs.push(entry.slug.toLowerCase())
    }
  }
  return slugs
}

/**
 * Returns true when the authenticated user is allowed to view the backup dashboard based
 * on the `PAYLOAD_BACKUP_ALLOWED_ROLES` env var. Unauthenticated users always return false.
 *
 * Exported for unit testing and for advanced consumers that want to reuse the same check
 * (e.g. wrap it inside their own `access` option).
 */
export function isUserAllowedByEnvRoles(
  user: null | Record<string, unknown>,
  envValue: string | undefined = process.env[BACKUP_ALLOWED_ROLES_ENV],
): boolean {
  if (!user) return false
  const allowed = parseAllowedRolesEnv(envValue)
  const userRoles = extractRoleSlugs(user)

  // Env var not set -> backwards-compatible default.
  if (allowed.length === 0) {
    if (userRoles === null || userRoles.length === 0) return true
    return userRoles.includes('admin')
  }

  // Wildcard -> any authenticated user.
  if (allowed.includes('*')) return true

  // Explicit allow-list requires the user to actually expose roles that match.
  if (!userRoles || userRoles.length === 0) return false
  return userRoles.some((slug) => allowed.includes(slug))
}
