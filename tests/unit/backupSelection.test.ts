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
        groupId: 'pages',
        displayTitle: 'Pages',
        mongoNames: ['pages', '_pages_versions'],
        adminHidden: false,
        adminHiddenReasons: [],
        affectsAuthSession: false,
        main: { mongoName: 'pages', docCount: 2 },
        versions: { mongoName: '_pages_versions', docCount: 1 },
      },
      {
        groupId: 'media',
        displayTitle: 'Media',
        mongoNames: ['media'],
        adminHidden: false,
        adminHiddenReasons: [],
        affectsAuthSession: false,
        main: { mongoName: 'media', docCount: 0 },
      },
    ])
    const selected = { pages: false as const, media: true as const }
    expect(skipMongoNamesFromPreview(preview, selected)).toEqual(['pages', '_pages_versions'])
  })

  it('selectedFromSkipMongoNames unchecks groups fully covered by skip list', () => {
    const preview = mockPreview([
      {
        groupId: 'a',
        displayTitle: 'A',
        mongoNames: ['a1', 'a2'],
        adminHidden: false,
        adminHiddenReasons: [],
        affectsAuthSession: false,
        main: { mongoName: 'a1', docCount: 1 },
      },
      {
        groupId: 'b',
        displayTitle: 'B',
        mongoNames: ['b1'],
        adminHidden: false,
        adminHiddenReasons: [],
        affectsAuthSession: false,
        main: { mongoName: 'b1', docCount: 1 },
      },
    ])
    const selected = selectedFromSkipMongoNames(preview, ['a1', 'a2'])
    expect(selected.a).toBe(false)
    expect(selected.b).not.toBe(false)
  })
})
