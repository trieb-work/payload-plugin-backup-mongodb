import { describe, expect, it } from 'vitest'

import {
  buildRestoreWarnings,
  formatRestoreSummary,
  type RestoreBackupResult,
  restoreTaskStatus,
} from '../../src/core/restoreResult.js'

const baseResult: RestoreBackupResult = {
  archiveKind: 'json',
  collections: [{ name: 'pages', docCount: 2, kind: 'restored' }],
  durationMs: 100,
  media: null,
}

describe('restoreResult', () => {
  it('reports completed when there are no warnings', () => {
    expect(buildRestoreWarnings(baseResult)).toEqual([])
    expect(restoreTaskStatus(baseResult)).toBe('completed')
    expect(formatRestoreSummary(baseResult)).toMatch(/Restored 1 collection/)
  })

  it('reports completed_with_warnings when media uploads fail', () => {
    const result: RestoreBackupResult = {
      ...baseResult,
      media: {
        accessFallbackCount: 0,
        attempted: 2,
        failed: [{ name: 'a.png', error: 'network error' }],
        restored: 1,
        skippedByOption: false,
      },
    }

    expect(buildRestoreWarnings(result)).toEqual(['Media "a.png": network error'])
    expect(restoreTaskStatus(result)).toBe('completed_with_warnings')
    expect(formatRestoreSummary(result)).toMatch(/1 error/)
  })

  it('reports completed_with_warnings when a collection restore fails', () => {
    const result: RestoreBackupResult = {
      ...baseResult,
      collections: [
        { name: 'pages', docCount: 1, kind: 'restored' },
        { name: 'users', error: 'bulk write failed', kind: 'failed' },
      ],
    }

    expect(buildRestoreWarnings(result)).toEqual(['Collection "users": bulk write failed'])
    expect(restoreTaskStatus(result)).toBe('completed_with_warnings')
  })
})
