import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  BACKUP_LABEL_MAX_LENGTH,
  createBlobName,
  getBackupSortTimeMs,
  sanitizeBackupLabel,
  transformBlobName,
} from '../../src/utils/blobName.js'
import { formatBytes } from '../../src/utils/formatBytes.js'
import { getCurrentDbName, getCurrentHostname } from '../../src/utils/hostname.js'

describe('createBlobName', () => {
  it('creates a json blob name with collection count and timestamp', () => {
    const name = createBlobName(
      'manual',
      'localhost/mydb',
      'example.com',
      14,
      1_234_567_890_123,
      'json',
    )
    expect(name).toBe(
      `manual---${encodeURIComponent('localhost/mydb')}---${encodeURIComponent('example.com')}---14-1234567890123.json`,
    )
  })

  it('creates a tar.gz blob name with collection count and timestamp', () => {
    const name = createBlobName(
      'cron',
      'localhost/mydb',
      'example.com',
      22,
      1_700_000_000_000,
      'tar.gz',
    )
    expect(name).toBe(
      `cron---${encodeURIComponent('localhost/mydb')}---${encodeURIComponent('example.com')}---22-1700000000000.tar.gz`,
    )
  })

  it('encodes special characters in dbName and hostname', () => {
    const name = createBlobName('manual', 'host.com/my db', 'my.host.com', 3, 1, 'json')
    expect(name).toContain(encodeURIComponent('host.com/my db'))
    expect(name).toContain(encodeURIComponent('my.host.com'))
    expect(name).toMatch(/---3-1\.json$/)
  })

  it('appends an encoded label segment when a label is provided', () => {
    const name = createBlobName(
      'manual',
      'localhost/mydb',
      'example.com',
      5,
      1_700_000_000_000,
      'json',
      'pre release snapshot',
    )
    expect(name).toBe(
      `manual---${encodeURIComponent('localhost/mydb')}---${encodeURIComponent('example.com')}---5-1700000000000---${encodeURIComponent('pre release snapshot')}.json`,
    )
  })

  it('omits the label segment when label is empty or whitespace', () => {
    const a = createBlobName('manual', 'db', 'h', 1, 1700000000000, 'json', '')
    const b = createBlobName('manual', 'db', 'h', 1, 1700000000000, 'json', '   ')
    const c = createBlobName('manual', 'db', 'h', 1, 1700000000000, 'json')
    expect(a).toBe(c)
    expect(b).toBe(c)
    expect(a).not.toMatch(/---[^-]+\.json$/)
  })
})

describe('sanitizeBackupLabel', () => {
  it('trims and collapses whitespace', () => {
    expect(sanitizeBackupLabel('  pre  release   v1 ')).toBe('pre release v1')
  })

  it('returns empty string for non-strings or empty input', () => {
    expect(sanitizeBackupLabel(undefined)).toBe('')
    expect(sanitizeBackupLabel(null)).toBe('')
    expect(sanitizeBackupLabel(123)).toBe('')
    expect(sanitizeBackupLabel('')).toBe('')
    expect(sanitizeBackupLabel('   ')).toBe('')
  })

  it('collapses hyphen runs so the separator cannot appear inside the label', () => {
    expect(sanitizeBackupLabel('a---b')).toBe('a-b')
    expect(sanitizeBackupLabel('a----b--c')).toBe('a-b-c')
  })

  it('caps the label length', () => {
    const long = 'x'.repeat(BACKUP_LABEL_MAX_LENGTH + 20)
    const out = sanitizeBackupLabel(long)
    expect(out.length).toBe(BACKUP_LABEL_MAX_LENGTH)
  })
})

describe('transformBlobName', () => {
  it('correctly parses a new-format json blob name', () => {
    const blobName = `backups/manual---${encodeURIComponent('localhost/mydb')}---${encodeURIComponent('example.com')}---14-1234567890123.json`
    const result = transformBlobName(blobName)
    expect(result).toEqual({
      collectionCount: 14,
      date: '1234567890123',
      fileType: 'json',
      type: 'manual',
      dbName: 'localhost/mydb',
      hostname: 'example.com',
    })
  })

  it('correctly parses a new-format tar.gz blob name', () => {
    const blobName = `backups/cron---${encodeURIComponent('localhost/mydb')}---${encodeURIComponent('app.vercel.app')}---8-1700000000000.tar.gz`
    const result = transformBlobName(blobName)
    expect(result).toEqual({
      collectionCount: 8,
      date: '1700000000000',
      fileType: 'tar.gz',
      type: 'cron',
      dbName: 'localhost/mydb',
      hostname: 'app.vercel.app',
    })
  })

  it('parses legacy timestamp-only tail', () => {
    const blobName = `backups/manual---${encodeURIComponent('localhost/mydb')}---${encodeURIComponent('example.com')}---1234567890.json`
    const result = transformBlobName(blobName)
    expect(result.collectionCount).toBeUndefined()
    expect(result.date).toBe('1234567890')
    expect(result.fileType).toBe('json')
  })

  it('falls back to legacy when hyphenated tail is not a plausible new-format tail', () => {
    const blobName = `backups/manual---${encodeURIComponent('db')}---${encodeURIComponent('h')}---200000-1700000000000.json`
    const result = transformBlobName(blobName)
    expect(result.collectionCount).toBeUndefined()
    expect(result.date).toBe('200000-1700000000000')
    expect(result.type).toBe('manual')
  })

  it('handles unknown file type', () => {
    const result = transformBlobName('backups/some-unknown-file.txt')
    expect(result.fileType).toBe('na')
  })

  it('is a round-trip with createBlobName', () => {
    const original = createBlobName(
      'manual',
      'db.host.com/mydb',
      'site.com',
      11,
      1_717_000_000_000,
      'json',
    )
    const parsed = transformBlobName(`backups/${original}`)
    expect(parsed.type).toBe('manual')
    expect(parsed.dbName).toBe('db.host.com/mydb')
    expect(parsed.hostname).toBe('site.com')
    expect(parsed.date).toBe('1717000000000')
    expect(parsed.collectionCount).toBe(11)
    expect(parsed.fileType).toBe('json')
    expect(parsed.label).toBeUndefined()
  })

  it('parses the optional label segment on new-format names', () => {
    const original = createBlobName(
      'manual',
      'localhost/mydb',
      'example.com',
      7,
      1_710_000_000_000,
      'tar.gz',
      'Pre release snapshot',
    )
    const parsed = transformBlobName(`backups/${original}`)
    expect(parsed.label).toBe('Pre release snapshot')
    expect(parsed.type).toBe('manual')
    expect(parsed.collectionCount).toBe(7)
    expect(parsed.date).toBe('1710000000000')
    expect(parsed.fileType).toBe('tar.gz')
  })

  it('round-trips labels with URL-reserved characters', () => {
    const label = 'Release #42 – v1.0 / QA'
    const original = createBlobName('manual', 'db', 'h', 1, 1_700_000_000_000, 'json', label)
    const parsed = transformBlobName(`backups/${original}`)
    expect(parsed.label).toBe(label)
  })

  it('keeps existing (unlabelled) blob names parsing the same', () => {
    const blobName = `backups/manual---${encodeURIComponent('db')}---${encodeURIComponent('h')}---5-1700000000000.json`
    const parsed = transformBlobName(blobName)
    expect(parsed.label).toBeUndefined()
    expect(parsed.collectionCount).toBe(5)
  })
})

describe('getBackupSortTimeMs', () => {
  it('uses filename timestamp when present', () => {
    const parsed = transformBlobName(
      `backups/manual---${encodeURIComponent('db')}---${encodeURIComponent('h')}---5-1700000000000.json`,
    )
    const t = getBackupSortTimeMs(parsed, new Date('2020-01-01'))
    expect(t).toBe(1_700_000_000_000)
  })

  it('treats legacy digit-only tails below 1e12 as unix seconds', () => {
    const parsed = transformBlobName(
      `backups/manual---${encodeURIComponent('db')}---${encodeURIComponent('h')}---1234567890.json`,
    )
    const t = getBackupSortTimeMs(parsed, new Date('2020-01-01'))
    expect(t).toBe(1_234_567_890_000)
  })

  it('uses legacy digit-only tails as ms when already in ms range', () => {
    const parsed = transformBlobName(
      `backups/manual---${encodeURIComponent('db')}---${encodeURIComponent('h')}---1700000000000.json`,
    )
    const t = getBackupSortTimeMs(parsed, new Date('2020-01-01'))
    expect(t).toBe(1_700_000_000_000)
  })

  it('falls back to uploadedAt when filename has no parseable ms', () => {
    const parsed = transformBlobName(
      `backups/manual---${encodeURIComponent('db')}---${encodeURIComponent('h')}---not-a-timestamp.json`,
    )
    const up = new Date('2019-06-15T12:00:00.000Z')
    const t = getBackupSortTimeMs(parsed, up)
    expect(t).toBe(up.getTime())
  })
})

describe('formatBytes', () => {
  it('returns em dash for invalid input', () => {
    expect(formatBytes(-1)).toBe('—')
    expect(formatBytes(Number.NaN)).toBe('—')
    expect(formatBytes(Number.POSITIVE_INFINITY)).toBe('—')
  })

  it('formats bytes below 1 KiB', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(999)).toBe('999 B')
  })

  it('formats kilobytes', () => {
    expect(formatBytes(1024)).toBe('1.0 KB')
    expect(formatBytes(1536)).toBe('1.5 KB')
    expect(formatBytes(10 * 1024)).toBe('10 KB')
  })

  it('formats megabytes', () => {
    expect(formatBytes(1024 * 1024)).toBe('1.0 MB')
    expect(formatBytes(Math.floor(5.5 * 1024 * 1024))).toBe('5.5 MB')
  })

  it('formats gigabytes', () => {
    expect(formatBytes(1024 * 1024 * 1024)).toBe('1.00 GB')
    expect(formatBytes(12 * 1024 * 1024 * 1024)).toBe('12.0 GB')
  })
})

describe('getCurrentDbName', () => {
  const originalEnv = process.env

  beforeEach(() => {
    process.env = { ...originalEnv }
  })

  afterEach(() => {
    process.env = originalEnv
  })

  it('extracts hostname + pathname from MONGODB_URI', () => {
    process.env.MONGODB_URI = 'mongodb://user:pass@cluster.mongodb.net/myDatabase'
    expect(getCurrentDbName()).toBe('cluster.mongodb.net/myDatabase')
  })

  it('returns "none" when MONGODB_URI is not set', () => {
    delete process.env.MONGODB_URI
    expect(getCurrentDbName()).toBe('none')
  })

  it('returns "none" when MONGODB_URI is invalid', () => {
    process.env.MONGODB_URI = 'not-a-valid-url'
    expect(getCurrentDbName()).toBe('none')
  })
})

describe('getCurrentHostname', () => {
  const originalEnv = process.env

  beforeEach(() => {
    process.env = { ...originalEnv }
  })

  afterEach(() => {
    process.env = originalEnv
  })

  it('extracts hostname from NEXT_PUBLIC_SERVER_URL when set', () => {
    process.env.NEXT_PUBLIC_SERVER_URL = 'https://cluster.example.com:3000'
    expect(getCurrentHostname()).toBe('cluster.example.com')
  })

  it('falls back to VERCEL_URL when NEXT_PUBLIC_SERVER_URL is unset', () => {
    delete process.env.NEXT_PUBLIC_SERVER_URL
    process.env.VERCEL_URL = 'my-app.vercel.app'
    expect(getCurrentHostname()).toBe('my-app.vercel.app')
  })

  it('returns "none" when no server URL env is set', () => {
    delete process.env.NEXT_PUBLIC_SERVER_URL
    delete process.env.VERCEL_URL
    expect(getCurrentHostname()).toBe('none')
  })
})
