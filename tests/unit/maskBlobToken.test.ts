import { describe, expect, it } from 'vitest'

import {
  maskBlobReadWriteToken,
  shouldPreserveBackupBlobTokenField,
} from '../../src/utils/maskBlobToken.js'

describe('maskBlobReadWriteToken', () => {
  it('returns empty for blank', () => {
    expect(maskBlobReadWriteToken('')).toBe('')
    expect(maskBlobReadWriteToken('  ')).toBe('')
  })

  it('masks long tokens with a fixed-length middle run of asterisks', () => {
    const raw = `vercel_blob_rw_PREFIX${'x'.repeat(32)}UNIQUE_MIDDLE${'y'.repeat(8)}TAIL`
    const m = maskBlobReadWriteToken(raw)
    const starRun = m.match(/\*+/)?.[0] ?? ''
    expect(starRun.length).toBe(32)
    expect(m).not.toContain('UNIQUE_MIDDLE')
    expect(m.endsWith('TAIL')).toBe(true)
  })
})

describe('shouldPreserveBackupBlobTokenField', () => {
  it('never preserves when no token was stored', () => {
    expect(shouldPreserveBackupBlobTokenField('', false)).toBe(false)
    expect(shouldPreserveBackupBlobTokenField('vercel_blob_rw_new', false)).toBe(false)
  })

  it('preserves when stored token exists and client sent empty', () => {
    expect(shouldPreserveBackupBlobTokenField('', true)).toBe(true)
  })

  it('preserves when client value looks like a masked placeholder', () => {
    expect(shouldPreserveBackupBlobTokenField(`vercel_blob_rw_3k6${'*'.repeat(23)}2UH`, true)).toBe(
      true,
    )
    expect(shouldPreserveBackupBlobTokenField('vercel_blob_rw_3k6*****....***2UH', true)).toBe(true)
    expect(shouldPreserveBackupBlobTokenField('abc**def', true)).toBe(true)
  })

  it('does not preserve when client sent a new plain token', () => {
    expect(shouldPreserveBackupBlobTokenField('vercel_blob_rw_completelynewtoken', true)).toBe(
      false,
    )
  })
})
