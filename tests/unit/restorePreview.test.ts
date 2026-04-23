import { describe, it, expect } from 'vitest'
import { buildCollectionPreviewGroups, buildRestorePreviewGroups } from '../../src/core/restorePreview.js'

const mockPayload = {
  config: {
    collections: [
      {
        slug: 'pages',
        admin: { hidden: false },
        labels: {
          plural: { de: 'Seiten', en: 'Pages' },
          singular: { de: 'Seite', en: 'Page' },
        },
      },
      {
        slug: 'media',
        admin: { hidden: false },
      },
      {
        slug: 'posts',
        admin: { hidden: false },
      },
      {
        slug: 'backup-tasks',
        admin: { hidden: true },
      },
    ],
  },
} as any

describe('buildCollectionPreviewGroups', () => {
  it('groups counts like restore preview', () => {
    const counts = { pages: 2, _pages_versions: 30, posts: 1 }
    const groups = buildCollectionPreviewGroups(mockPayload, counts, { preferredLocales: ['de', 'en'] })
    const pages = groups.find((g) => g.groupId === 'pages')
    expect(pages?.main?.docCount).toBe(2)
    expect(pages?.versions?.docCount).toBe(30)
  })

  it('omits empty collections by default', () => {
    const counts = { pages: 1, forms: 0, 'form-submissions': 0 }
    const groups = buildCollectionPreviewGroups(mockPayload, counts, { preferredLocales: ['en'] })
    expect(groups.map((g) => g.groupId).sort()).toEqual(['pages'])
  })

  it('includes empty collections when includeEmptyCollections is true', () => {
    const counts = { pages: 1, forms: 0, 'form-submissions': 0 }
    const groups = buildCollectionPreviewGroups(mockPayload, counts, {
      preferredLocales: ['en'],
      includeEmptyCollections: true,
    })
    expect(groups.map((g) => g.groupId).sort()).toEqual(['form-submissions', 'forms', 'pages'])
    expect(groups.find((g) => g.groupId === 'forms')?.main?.docCount).toBe(0)
  })

  it('orders like admin sidebar when sortLikeAdminNav is true, unknown mongo names last', () => {
    const payload = {
      config: {
        collections: [
          {
            slug: 'pages',
            admin: { hidden: false },
            labels: { plural: { en: 'Pages' } },
          },
          { slug: 'media', admin: { hidden: false } },
          { slug: 'posts', admin: { hidden: false } },
          { slug: 'backup-tasks', admin: { hidden: true } },
        ],
      },
    } as any

    const counts = { posts: 1, pages: 1, media: 1, orphan_coll: 1 }
    const groups = buildCollectionPreviewGroups(payload, counts, {
      preferredLocales: ['en'],
      includeEmptyCollections: true,
      sortLikeAdminNav: true,
    })
    expect(groups.map((g) => g.groupId)).toEqual(['pages', 'media', 'posts', 'orphan_coll'])
  })
})

describe('buildRestorePreviewGroups', () => {
  it('merges main + version mongo names and hides backup-tasks', () => {
    const parsed = {
      byName: {
        pages: [{ _id: '1' }, { _id: '2' }],
        _pages_versions: [{ _id: 'v1' }],
        'backup-tasks': [{ _id: 't' }],
        posts: [{ _id: 'p1' }],
      },
      fileKind: 'json' as const,
      mediaBlobCount: 0,
    }

    const preview = buildRestorePreviewGroups(mockPayload, parsed, { preferredLocales: ['de', 'en'] })

    expect(preview.groups.some((g) => g.groupId === 'backup-tasks')).toBe(false)
    expect(preview.groups.map((g) => g.groupId)).toEqual(['pages', 'media', 'posts'])
    expect(preview.groups.find((g) => g.groupId === 'media')?.main?.docCount).toBe(0)
    const pagesGroup = preview.groups.find((g) => g.groupId === 'pages')
    expect(pagesGroup?.main?.docCount).toBe(2)
    expect(pagesGroup?.versions?.docCount).toBe(1)
    expect(pagesGroup?.mongoNames.sort()).toEqual(['_pages_versions', 'pages'].sort())
    expect(pagesGroup?.displayTitle).toBe('Seiten (pages)')
    expect(pagesGroup?.adminHiddenReasons).toContain('version-history')
  })

  it('flags auth session on users group', () => {
    const parsed = {
      byName: {
        users: [{ _id: 'u1' }],
        media: [{ _id: 'm1' }],
      },
      fileKind: 'json' as const,
      mediaBlobCount: 0,
    }

    const preview = buildRestorePreviewGroups(mockPayload, parsed)
    const users = preview.groups.find((g) => g.groupId === 'users')
    expect(users?.affectsAuthSession).toBe(true)
  })

  it('flags auth session on roles group', () => {
    const parsed = {
      byName: {
        roles: [{ _id: 'r1' }],
        media: [{ _id: 'm1' }],
      },
      fileKind: 'json' as const,
      mediaBlobCount: 0,
    }

    const preview = buildRestorePreviewGroups(mockPayload, parsed)
    const roles = preview.groups.find((g) => g.groupId === 'roles')
    expect(roles?.affectsAuthSession).toBe(true)
  })
})
