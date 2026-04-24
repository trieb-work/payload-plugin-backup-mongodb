import { describe, expect, it } from 'vitest'

import type { BackupSourcePreviewResponse } from '../../src/core/backupSourcePreview.js'

import { selectedFromSkipMongoNames, skipMongoNamesFromPreview } from '../../src/utils/backupSelection.js'

function mockPreview(
  groups: BackupSourcePreviewResponse['groups'],
): BackupSourcePreviewResponse {
  return {
    groups,
    mediaBlobCandidates: 0,
  }
}

describe('backupSelection', () => {
  it('skipMongoNamesFromPreview excludes unchecked groups', () => {
    const preview = mockPreview([
      {
        adminHidden: false,
        adminHiddenReasons: [],
        affectsAuthSession: false,
        displayTitle: 'Pages',
        groupId: 'pages',
        main: { docCount: 2, mongoName: 'pages' },
        mongoNames: ['pages', '_pages_versions'],
        versions: { docCount: 1, mongoName: '_pages_versions' },
      },
      {
        adminHidden: false,
        adminHiddenReasons: [],
        affectsAuthSession: false,
        displayTitle: 'Media',
        groupId: 'media',
        main: { docCount: 0, mongoName: 'media' },
        mongoNames: ['media'],
      },
    ])
    const selected = { media: true as const, pages: false as const }
    expect(skipMongoNamesFromPreview(preview, selected)).toEqual(['pages', '_pages_versions'])
  })

  it('selectedFromSkipMongoNames unchecks groups fully covered by skip list', () => {
    const preview = mockPreview([
      {
        adminHidden: false,
        adminHiddenReasons: [],
        affectsAuthSession: false,
        displayTitle: 'A',
        groupId: 'a',
        main: { docCount: 1, mongoName: 'a1' },
        mongoNames: ['a1', 'a2'],
      },
      {
        adminHidden: false,
        adminHiddenReasons: [],
        affectsAuthSession: false,
        displayTitle: 'B',
        groupId: 'b',
        main: { docCount: 1, mongoName: 'b1' },
        mongoNames: ['b1'],
      },
    ])
    const selected = selectedFromSkipMongoNames(preview, ['a1', 'a2'])
    expect(selected.a).toBe(false)
    expect(selected.b).not.toBe(false)
  })
})
