import type { Payload, SanitizedConfig } from 'payload'

import configPromise from '@payload-config'
import { getPayload } from 'payload'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

let payload: Payload
let resolvedConfig: SanitizedConfig

beforeAll(async () => {
  payload = await getPayload({ config: configPromise })
  resolvedConfig = payload.config
})

afterAll(async () => {
  await payload.destroy()
})

describe('backupMongodbPlugin integration', () => {
  test('registers backup-tasks collection', () => {
    expect(payload.collections['backup-tasks']).toBeDefined()
  })

  test('registers backup-settings collection', () => {
    expect(payload.collections['backup-settings']).toBeDefined()
  })

  test('seeds a default backup-settings document', async () => {
    const { totalDocs } = await payload.count({
      collection: 'backup-settings',
      overrideAccess: true,
    })
    expect(totalDocs).toBe(1)
  })

  test('exposes backup REST endpoints', () => {
    const paths = (resolvedConfig.endpoints ?? []).map((e) => e.path)
    expect(paths).toContain('/backup-mongodb/admin/manual')
    expect(paths).toContain('/backup-mongodb/admin/restore')
    expect(paths).toContain('/backup-mongodb/cron/list')
  })
})
