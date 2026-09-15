import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  getBackupStorageKind,
  isS3Configured,
  loadS3Config,
} from '../../src/core/storage/config.js'

const S3_ENV_KEYS = [
  'BACKUP_STORAGE',
  'BACKUP_S3_BUCKET',
  'BACKUP_S3_REGION',
  'BACKUP_S3_ENDPOINT',
  'BACKUP_S3_FORCE_PATH_STYLE',
  'BACKUP_S3_PREFIX',
  'BACKUP_S3_ACCESS_KEY_ID',
  'BACKUP_S3_SECRET_ACCESS_KEY',
  'BACKUP_S3_SESSION_TOKEN',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_REGION',
  'AWS_SESSION_TOKEN',
]

describe('storage config', () => {
  let saved: Record<string, string | undefined>

  beforeEach(() => {
    saved = {}
    for (const key of S3_ENV_KEYS) {
      saved[key] = process.env[key]
      delete process.env[key]
    }
  })

  afterEach(() => {
    for (const key of S3_ENV_KEYS) {
      if (saved[key] === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = saved[key]
      }
    }
  })

  describe('getBackupStorageKind', () => {
    it('defaults to vercel-blob', () => {
      expect(getBackupStorageKind()).toBe('vercel-blob')
    })

    it('reads s3 from BACKUP_STORAGE (case-insensitive)', () => {
      process.env.BACKUP_STORAGE = 'S3'
      expect(getBackupStorageKind()).toBe('s3')
    })

    it('honors an explicit override over the env var', () => {
      process.env.BACKUP_STORAGE = 's3'
      expect(getBackupStorageKind('vercel-blob')).toBe('vercel-blob')
    })
  })

  describe('isS3Configured', () => {
    it('is false without a bucket and true with one', () => {
      expect(isS3Configured()).toBe(false)
      process.env.BACKUP_S3_BUCKET = 'my-bucket'
      expect(isS3Configured()).toBe(true)
    })
  })

  describe('loadS3Config', () => {
    it('throws when the bucket is missing', () => {
      expect(() => loadS3Config()).toThrow(/BACKUP_S3_BUCKET/)
    })

    it('defaults region/forcePathStyle and trims the prefix', () => {
      process.env.BACKUP_S3_BUCKET = 'my-bucket'
      process.env.BACKUP_S3_PREFIX = 'team-a/'
      const cfg = loadS3Config()
      expect(cfg.bucket).toBe('my-bucket')
      expect(cfg.region).toBe('us-east-1')
      expect(cfg.forcePathStyle).toBe(false)
      expect(cfg.prefix).toBe('team-a')
      expect(cfg.accessKeyId).toBeUndefined()
    })

    it('defaults forcePathStyle to true when a custom endpoint is set (R2/MinIO)', () => {
      process.env.BACKUP_S3_BUCKET = 'my-bucket'
      process.env.BACKUP_S3_ENDPOINT = 'http://127.0.0.1:9000'
      expect(loadS3Config().forcePathStyle).toBe(true)
    })

    it('prefers BACKUP_S3_* credentials but falls back to AWS_* ', () => {
      process.env.BACKUP_S3_BUCKET = 'my-bucket'
      process.env.AWS_ACCESS_KEY_ID = 'aws-key'
      process.env.AWS_SECRET_ACCESS_KEY = 'aws-secret'
      process.env.AWS_REGION = 'eu-central-1'
      const fallback = loadS3Config()
      expect(fallback.accessKeyId).toBe('aws-key')
      expect(fallback.region).toBe('eu-central-1')

      process.env.BACKUP_S3_ACCESS_KEY_ID = 'backup-key'
      process.env.BACKUP_S3_SECRET_ACCESS_KEY = 'backup-secret'
      const preferred = loadS3Config()
      expect(preferred.accessKeyId).toBe('backup-key')
      expect(preferred.secretAccessKey).toBe('backup-secret')
    })
  })
})
