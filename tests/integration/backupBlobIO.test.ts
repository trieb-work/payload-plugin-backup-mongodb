import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const putMock = vi.fn()
vi.mock('@vercel/blob', () => ({
  put: (...args: unknown[]) => putMock(...args),
}))

import {
  isTrustedBackupBlobReference,
  putBackupBlobContent,
  readBackupBlobContent,
  readBackupBlobContentFlexible,
  streamBackupBlobForDownload,
  vercelBlobPathnameFromUrl,
} from '../../src/core/backupBlobIO.js'

const originalFetch = globalThis.fetch
const fetchMock = vi.fn()

beforeEach(() => {
  putMock.mockReset()
  fetchMock.mockReset()
  globalThis.fetch = fetchMock as unknown as typeof fetch
})

afterEach(() => {
  globalThis.fetch = originalFetch
})

describe('vercelBlobPathnameFromUrl', () => {
  it('returns pathname for vercel blob https URLs', () => {
    expect(
      vercelBlobPathnameFromUrl('https://abc123.public.blob.vercel-storage.com/backups/x.json'),
    ).toBe('backups/x.json')
  })

  it('returns null for non-blob hosts', () => {
    expect(vercelBlobPathnameFromUrl('https://evil.com/backups/x.json')).toBeNull()
  })
})

describe('isTrustedBackupBlobReference', () => {
  it('matches list url pathname to expected pathname', () => {
    const u = 'https://store.public.blob.vercel-storage.com/backups/cron---a---b---1.json'
    expect(isTrustedBackupBlobReference(u, 'backups/cron---a---b---1.json')).toBe(true)
    expect(isTrustedBackupBlobReference(u, 'backups/other.json')).toBe(false)
  })

  it('treats literal %2F inside pathnames as-is', () => {
    const u =
      'https://store.private.blob.vercel-storage.com/backups/manual---localhost%252Fdemo---localhost---21-1776865188117.json'
    expect(
      isTrustedBackupBlobReference(
        u,
        'backups/manual---localhost%2Fdemo---localhost---21-1776865188117.json',
      ),
    ).toBe(true)
  })
})

describe('streamBackupBlobForDownload', () => {
  it('streams via the trusted download URL with Bearer auth for private stores', async () => {
    const downloadUrl = 'https://sid.private.blob.vercel-storage.com/backups/f.json?download=1'
    fetchMock.mockResolvedValueOnce({
      body: new ReadableStream(),
      headers: new Headers({ 'content-type': 'application/json' }),
      ok: true,
    })
    const r = await streamBackupBlobForDownload({
      downloadUrl,
      pathname: 'backups/f.json',
      preferredAccess: 'private',
      token: 'tok',
    })
    expect(r?.contentType).toBe('application/json')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit | undefined]
    expect(url).toBe(downloadUrl)
    expect((init?.headers as Record<string, string>).authorization).toBe('Bearer tok')
  })

  it('preserves literal %2F sequences in the blob pathname without re-encoding', async () => {
    const pathname = 'backups/manual---localhost%2Fdemo---localhost---21-1776865188117.json'
    const downloadUrl =
      'https://sid.private.blob.vercel-storage.com/backups/manual---localhost%252Fdemo---localhost---21-1776865188117.json?download=1'
    fetchMock.mockResolvedValueOnce({
      body: new ReadableStream(),
      headers: new Headers(),
      ok: true,
    })
    const r = await streamBackupBlobForDownload({
      downloadUrl,
      pathname,
      preferredAccess: 'private',
      token: 'tok',
    })
    expect(r).not.toBeNull()
    expect(fetchMock.mock.calls[0][0]).toBe(downloadUrl)
  })

  it('returns null when no trusted blob URL is provided', async () => {
    const r = await streamBackupBlobForDownload({
      blobUrl: 'https://evil.com/backups/g.tar.gz',
      pathname: 'backups/g.tar.gz',
      preferredAccess: 'private',
      token: 'tok',
    })
    expect(r).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('readBackupBlobContent', () => {
  it('fetches the download URL with Bearer auth', async () => {
    const downloadUrl = 'https://sid.private.blob.vercel-storage.com/backups/x.json?download=1'
    fetchMock.mockResolvedValueOnce({
      arrayBuffer: async () => new TextEncoder().encode('hello').buffer,
      ok: true,
    })
    const buf = await readBackupBlobContent({
      access: 'private',
      downloadUrl,
      pathname: 'backups/x.json',
      token: 'tok',
    })
    expect(buf.toString()).toBe('hello')
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit | undefined]
    expect(url).toBe(downloadUrl)
    expect((init?.headers as Record<string, string>).authorization).toBe('Bearer tok')
  })

  it('throws when the download returns a non-2xx status', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 401 })
    await expect(
      readBackupBlobContent({
        access: 'private',
        downloadUrl: 'https://sid.private.blob.vercel-storage.com/backups/x.json',
        pathname: 'backups/x.json',
        token: 'tok',
      }),
    ).rejects.toThrow(/HTTP 401/)
  })
})

describe('readBackupBlobContentFlexible', () => {
  it('uses the authenticated download URL for private stores', async () => {
    const downloadUrl = 'https://sid.private.blob.vercel-storage.com/backups/f.json?download=1'
    fetchMock.mockResolvedValueOnce({
      arrayBuffer: async () => new TextEncoder().encode('payload').buffer,
      ok: true,
    })
    const buf = await readBackupBlobContentFlexible('backups/f.json', downloadUrl, 'tok')
    expect(buf.toString()).toBe('payload')
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit | undefined]
    expect((init?.headers as Record<string, string>).authorization).toBe('Bearer tok')
  })

  it('falls back to anonymous fetch for non-Vercel hosts without leaking the token', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 500,
    })
    fetchMock.mockResolvedValueOnce({
      arrayBuffer: async () => new TextEncoder().encode('legacy').buffer,
      ok: true,
    })
    const buf = await readBackupBlobContentFlexible(
      'backups/legacy.json',
      'https://cdn.example.com/backups/legacy.json',
      'tok',
    )
    expect(buf.toString()).toBe('legacy')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[0][1]).toBeUndefined()
    expect(fetchMock.mock.calls[1][1]).toBeUndefined()
  })

  it('throws the final error when no source can be read', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 401 })
    await expect(
      readBackupBlobContentFlexible(
        'backups/x.json',
        'https://sid.private.blob.vercel-storage.com/backups/x.json',
        'tok',
      ),
    ).rejects.toThrow('Failed to read backup blob backups/x.json')
  })
})

describe('putBackupBlobContent', () => {
  it('uploads with the requested access level when the store accepts it', async () => {
    putMock.mockResolvedValueOnce({ pathname: 'backups/x.json' })
    const effective = await putBackupBlobContent('backups/x.json', 'body', 't', 'private')
    expect(effective).toBe('private')
    expect(putMock).toHaveBeenCalledTimes(1)
    expect(putMock.mock.calls[0][2]).toMatchObject({
      access: 'private',
      addRandomSuffix: false,
      allowOverwrite: true,
    })
  })

  it('falls back to the other access level when the store rejects the preferred one', async () => {
    putMock.mockRejectedValueOnce(new Error('This blob store does not support private access'))
    putMock.mockResolvedValueOnce({ pathname: 'backups/x.json' })
    const effective = await putBackupBlobContent('backups/x.json', 'body', 't', 'private')
    expect(effective).toBe('public')
    expect(putMock).toHaveBeenCalledTimes(2)
    expect(putMock.mock.calls[0][2]).toMatchObject({
      access: 'private',
      allowOverwrite: true,
    })
    expect(putMock.mock.calls[1][2]).toMatchObject({
      access: 'public',
      allowOverwrite: true,
    })
  })

  it('re-throws non-access errors without retrying', async () => {
    putMock.mockRejectedValueOnce(new Error('Network unreachable'))
    await expect(putBackupBlobContent('backups/x.json', 'body', 't', 'private')).rejects.toThrow(
      'Network unreachable',
    )
    expect(putMock).toHaveBeenCalledTimes(1)
  })

  it('throws the first error when both attempts fail', async () => {
    putMock.mockRejectedValueOnce(new Error('Invalid access: private rejected'))
    putMock.mockRejectedValueOnce(new Error('Invalid access: public rejected'))
    await expect(putBackupBlobContent('backups/x.json', 'body', 't', 'public')).rejects.toThrow(
      /Invalid access: private rejected/,
    )
    expect(putMock).toHaveBeenCalledTimes(2)
  })
})
