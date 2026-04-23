import { EJSON } from 'bson'
import type { Payload } from 'payload'

import { readBackupBlobContentFlexible } from './backupBlobIO.js'
import { resolveTarGzip } from './archive.js'
import { COLLECTION_FILE_NAME } from './backup.js'

/** Mongo collection names that invalidate the current admin session when replaced. */
const AUTH_SESSION_MONGO_NAMES = new Set([
  'users',
  'roles',
  'payload-preferences',
  'sessions',
])

const MONGO_VERSIONS = /^_(.+)_versions$/i

export type RestorePreviewFileKind = 'json' | 'tar-gzip'

export type RestorePreviewAdminHiddenReason = 'collection-config' | 'version-history'

export type RestorePreviewGroup = {
  /** Stable id for UI + skip payload (Payload collection slug when known, else mongo name). */
  groupId: string
  /** e.g. "Seiten (pages)" */
  displayTitle: string
  main?: { mongoName: string; docCount: number }
  versions?: { mongoName: string; docCount: number }
  /** All Mongo names restored when this group is checked. */
  mongoNames: string[]
  adminHidden: boolean
  adminHiddenReasons: RestorePreviewAdminHiddenReason[]
  affectsAuthSession: boolean
}

export type RestorePreviewResponse = {
  fileKind: RestorePreviewFileKind
  groups: RestorePreviewGroup[]
  mediaBlobCount: number
}

function docCount(byName: Record<string, unknown[]>, name: string): number {
  const docs = byName[name]
  return Array.isArray(docs) ? docs.length : 0
}

function isVersionsMongoName(name: string): boolean {
  return MONGO_VERSIONS.test(name)
}

function resolveAdminHidden(
  payload: Payload,
  mongoName: string,
): { adminHidden: boolean; adminHiddenReason: RestorePreviewAdminHiddenReason | null } {
  const col = payload.config.collections.find((c) => {
    const dbName = (c as { dbName?: string }).dbName ?? c.slug
    return dbName === mongoName || c.slug === mongoName
  })
  if (col?.admin?.hidden) {
    return { adminHidden: true, adminHiddenReason: 'collection-config' }
  }
  if (isVersionsMongoName(mongoName)) {
    return { adminHidden: true, adminHiddenReason: 'version-history' }
  }
  return { adminHidden: false, adminHiddenReason: null }
}

function pickLocalizedLabel(labels: unknown, preferredLocales: string[]): string | undefined {
  if (!labels || typeof labels !== 'object') return undefined
  const l = labels as { plural?: unknown; singular?: unknown }

  const pickField = (field: unknown): string | undefined => {
    if (typeof field === 'string') return field
    if (field && typeof field === 'object') {
      const map = field as Record<string, string>
      for (const loc of preferredLocales) {
        const v = map[loc]
        if (v) return v
      }
      const first = Object.values(map).find(Boolean)
      return first
    }
    return undefined
  }

  return pickField(l.plural) || pickField(l.singular)
}

function humanizeSlug(slug: string): string {
  return slug
    .split('-')
    .map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : ''))
    .join(' ')
}

/** Collections shown in the default Payload admin sidebar: config order, skipping `admin.hidden`. */
function getNavVisibleCollections(payload: Payload) {
  return payload.config.collections.filter((c) => c.admin?.hidden !== true)
}

/**
 * Index in sidebar order, or `null` if the group is not a visible nav collection
 * (hidden config, unknown mongo name, etc.).
 */
export function navVisibleCollectionOrderIndex(payload: Payload, groupId: string): number | null {
  const visible = getNavVisibleCollections(payload)
  const idx = visible.findIndex((c) => {
    const dbName = (c as { dbName?: string }).dbName ?? c.slug
    return c.slug === groupId || dbName === groupId
  })
  return idx === -1 ? null : idx
}

function sortPreviewGroupsLikeAdminNav(
  payload: Payload,
  groups: RestorePreviewGroup[],
  preferredLocales: string[],
): void {
  const locale = preferredLocales[0] ?? 'en'
  groups.sort((a, b) => {
    const ia = navVisibleCollectionOrderIndex(payload, a.groupId)
    const ib = navVisibleCollectionOrderIndex(payload, b.groupId)
    if (ia !== null && ib !== null && ia !== ib) return ia - ib
    if (ia !== null && ib === null) return -1
    if (ia === null && ib !== null) return 1
    return a.displayTitle.localeCompare(b.displayTitle, locale)
  })
}

function buildDisplayTitle(
  payload: Payload,
  groupSlug: string,
  preferredLocales: string[],
): string {
  const col = payload.config.collections.find((c) => c.slug === groupSlug)
  const label =
    pickLocalizedLabel(col?.labels, preferredLocales) || humanizeSlug(groupSlug)
  return `${label} (${groupSlug})`
}

export async function loadRestoreBackupIndex(
  downloadUrl: string,
  readAuth?: { pathname: string; token: string },
): Promise<{
  byName: Record<string, unknown[]>
  fileKind: RestorePreviewFileKind
  mediaBlobCount: number
}> {
  const urlBase = downloadUrl.split('?')?.[0]
  const bytes = readAuth
    ? await readBackupBlobContentFlexible(readAuth.pathname, downloadUrl, readAuth.token)
    : await (async () => {
        const res = await fetch(downloadUrl)
        if (!res.ok) {
          throw new Error(`Failed to download backup (${res.status})`)
        }
        return Buffer.from(await res.arrayBuffer())
      })()

  let byName: Record<string, unknown[]> = {}
  let mediaBlobCount = 0
  let fileKind: RestorePreviewFileKind

  if (urlBase?.endsWith('.json')) {
    fileKind = 'json'
    byName = EJSON.parse(bytes.toString('utf8')) as Record<string, unknown[]>
  } else if (urlBase?.endsWith('.gz')) {
    fileKind = 'tar-gzip'
    const files = await resolveTarGzip(bytes)
    byName = EJSON.parse(
      files.find((f) => f.name === COLLECTION_FILE_NAME)?.content?.toString() || '{}',
    ) as Record<string, unknown[]>
    mediaBlobCount = files.filter((f) => f.name !== COLLECTION_FILE_NAME).length
  } else {
    throw new Error('Unsupported backup file type (expected .json or .gz)')
  }

  return { byName, fileKind, mediaBlobCount }
}

type GroupAgg = {
  groupId: string
  main?: { mongoName: string; docCount: number }
  versions?: { mongoName: string; docCount: number }
}

function rebuildMongoNames(g: GroupAgg): string[] {
  return [g.main?.mongoName, g.versions?.mongoName].filter(Boolean) as string[]
}

function countsFromByName(byName: Record<string, unknown[]>): Record<string, number> {
  const out: Record<string, number> = {}
  for (const k of Object.keys(byName)) {
    out[k] = docCount(byName, k)
  }
  return out
}

/** Ensures every configured Payload collection appears (0 if absent from backup JSON), like live-DB preview. */
function mergeConfiguredCollectionZeros(
  payload: Payload,
  fileCounts: Record<string, number>,
  excludeMongo: Set<string>,
): Record<string, number> {
  const merged = { ...fileCounts }
  for (const col of payload.config.collections) {
    const mongo = (col as { dbName?: string }).dbName ?? col.slug
    if (excludeMongo.has(mongo)) continue
    if (!(mongo in merged)) {
      merged[mongo] = 0
    }
  }
  return merged
}

/** Group Mongo collection names + doc counts (live DB or backup file) for admin UI lists. */
export function buildCollectionPreviewGroups(
  payload: Payload,
  countsByMongo: Record<string, number>,
  options: {
    excludeMongo?: Set<string>
    preferredLocales?: string[]
    /** When true, list collections with 0 documents (e.g. manual backup UI). Default false. */
    includeEmptyCollections?: boolean
    /** When true, order like Payload admin sidebar; unknown / hidden-only groups last by title. */
    sortLikeAdminNav?: boolean
  } = {},
): RestorePreviewGroup[] {
  const preferredLocales = options.preferredLocales?.length
    ? options.preferredLocales
    : ['de', 'en']
  const excludeMongo = options.excludeMongo ?? new Set(['backup-tasks'])
  const includeEmptyCollections = options.includeEmptyCollections ?? false
  const sortLikeAdminNav = options.sortLikeAdminNav ?? false

  const aggs = new Map<string, GroupAgg>()

  for (const [mongoName, count] of Object.entries(countsByMongo)) {
    if (excludeMongo.has(mongoName)) continue
    if (!includeEmptyCollections && count === 0) continue

    const versionMatch = mongoName.match(MONGO_VERSIONS)
    if (versionMatch) {
      const groupId = versionMatch[1]
      const prev = aggs.get(groupId) ?? { groupId }
      aggs.set(groupId, {
        ...prev,
        groupId,
        versions: { docCount: count, mongoName },
      })
    } else {
      const groupId = mongoName
      const prev = aggs.get(groupId) ?? { groupId }
      aggs.set(groupId, {
        ...prev,
        groupId,
        main: { docCount: count, mongoName },
      })
    }
  }

  const groups: RestorePreviewGroup[] = [...aggs.values()].map((agg) => {
    const mongoNames = rebuildMongoNames(agg)
    const reasons = new Set<RestorePreviewAdminHiddenReason>()
    let adminHidden = false
    for (const mn of mongoNames) {
      const r = resolveAdminHidden(payload, mn)
      if (r.adminHidden && r.adminHiddenReason) {
        adminHidden = true
        reasons.add(r.adminHiddenReason)
      }
    }
    const affectsAuthSession = mongoNames.some((n) => AUTH_SESSION_MONGO_NAMES.has(n))

    return {
      adminHidden,
      adminHiddenReasons: [...reasons],
      affectsAuthSession,
      displayTitle: buildDisplayTitle(payload, agg.groupId, preferredLocales),
      groupId: agg.groupId,
      main: agg.main,
      mongoNames,
      versions: agg.versions,
    }
  })

  if (sortLikeAdminNav) {
    sortPreviewGroupsLikeAdminNav(payload, groups, preferredLocales)
  } else {
    const locale = preferredLocales[0] ?? 'en'
    groups.sort((a, b) => a.displayTitle.localeCompare(b.displayTitle, locale))
  }
  return groups
}

export function buildRestorePreviewGroups(
  payload: Payload,
  parsed: {
    byName: Record<string, unknown[]>
    fileKind: RestorePreviewFileKind
    mediaBlobCount: number
  },
  options: { preferredLocales?: string[]; excludeMongo?: Set<string> } = {},
): RestorePreviewResponse {
  const excludeMongo = options.excludeMongo ?? new Set(['backup-tasks'])
  const rawCounts = countsFromByName(parsed.byName)
  const counts = mergeConfiguredCollectionZeros(payload, rawCounts, excludeMongo)
  const groups = buildCollectionPreviewGroups(payload, counts, {
    preferredLocales: options.preferredLocales,
    includeEmptyCollections: true,
    sortLikeAdminNav: true,
    excludeMongo,
  })

  return {
    fileKind: parsed.fileKind,
    groups,
    mediaBlobCount: parsed.mediaBlobCount,
  }
}

export async function getRestorePreviewForAdminRestore(
  payload: Payload,
  downloadUrl: string,
  options: {
    preferredLocales?: string[]
    backupRead?: { pathname: string; token: string }
  } = {},
): Promise<RestorePreviewResponse> {
  const parsed = await loadRestoreBackupIndex(downloadUrl, options.backupRead)
  return buildRestorePreviewGroups(payload, parsed, options)
}
