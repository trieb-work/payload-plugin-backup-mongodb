import { describe, it, expect, vi, beforeEach } from 'vitest'

const putMock = vi.fn()
const delMock = vi.fn()
vi.mock('@vercel/blob', () => ({
  del: (...args: unknown[]) => delMock(...args),
  put: (...args: unknown[]) => putMock(...args),
}))

import { validateBackupBlobToken } from '../src/core/blobTokenValidate.js'

beforeEach(() => {
  putMock.mockReset()
  delMock.mockReset()
})

describe('validateBackupBlobToken', () => {
  it('returns ok=false for empty tokens without probing', async () => {
    const result = await validateBackupBlobToken('   ')
    expect(result.ok).toBe(false)
    expect(putMock).not.toHaveBeenCalled()
  })

  it('detects a private-capable store and cleans up the probe blob', async () => {
    putMock.mockResolvedValueOnce({ url: 'https://blob/probe.txt' })
    delMock.mockResolvedValueOnce(undefined)
    const result = await validateBackupBlobToken('vercel_blob_rw_xxx')
    expect(result).toEqual({ access: 'private', ok: true })
    expect(putMock).toHaveBeenCalledTimes(1)
    expect(putMock.mock.calls[0][2]).toMatchObject({ access: 'private' })
    expect(delMock).toHaveBeenCalledTimes(1)
  })

  it('falls back to public when the store rejects private access', async () => {
    putMock.mockRejectedValueOnce(new Error('This blob store does not support private access'))
    putMock.mockResolvedValueOnce({ url: 'https://blob/probe.txt' })
    delMock.mockResolvedValueOnce(undefined)
    const result = await validateBackupBlobToken('vercel_blob_rw_public')
    expect(result).toEqual({ access: 'public', ok: true })
    expect(putMock).toHaveBeenCalledTimes(2)
  })

  it('returns ok=false with a message for non-access errors', async () => {
    putMock.mockRejectedValueOnce(new Error('Unauthorized'))
    const result = await validateBackupBlobToken('broken')
    expect(result.ok).toBe(false)
    expect(result.error).toContain('Unauthorized')
    expect(putMock).toHaveBeenCalledTimes(1)
  })

  it('returns ok=false when both access levels are rejected', async () => {
    putMock.mockRejectedValueOnce(new Error('Invalid access: private not allowed'))
    putMock.mockRejectedValueOnce(new Error('Invalid access: public not allowed'))
    const result = await validateBackupBlobToken('weird')
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/private/)
    expect(putMock).toHaveBeenCalledTimes(2)
  })
})
