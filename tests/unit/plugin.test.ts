import type { Config } from 'payload'

import { describe, expect, it } from 'vitest'

import { backupMongodbPlugin } from '../../src/plugin.js'

function baseConfig(overrides: Partial<Config> = {}): Config {
  return {
    admin: {},
    collections: [],
    endpoints: [],
    ...overrides,
  } as unknown as Config
}

/**
 * Payload types `Plugin` as `(config) => Config | Promise<Config>`. `backupMongodbPlugin`
 * always returns synchronously, so narrow it here to keep the test assertions tidy.
 */
function applyPlugin(options: Parameters<typeof backupMongodbPlugin>[0], config: Config): Config {
  const result = backupMongodbPlugin(options)(config)
  if (result instanceof Promise) {
    throw new Error('backupMongodbPlugin unexpectedly returned a Promise')
  }
  return result
}

describe('backupMongodbPlugin', () => {
  it('returns the incoming config untouched when enabled=false', () => {
    const input = baseConfig({
      collections: [{ slug: 'existing' } as never],
    })
    const out = applyPlugin({ enabled: false }, input)
    expect(out).toBe(input)
  })

  it('registers the backup-tasks and backup-settings collections alongside existing ones', () => {
    const existing = { slug: 'existing' } as never
    const out = applyPlugin({}, baseConfig({ collections: [existing] }))
    const slugs = (out.collections ?? []).map((c: { slug: string }) => c.slug)
    expect(slugs).toContain('existing')
    expect(slugs).toContain('backup-tasks')
    expect(slugs).toContain('backup-settings')
  })

  it('appends backup endpoints without removing existing ones', () => {
    const existingEp = {
      handler: () => new Response('ok'),
      method: 'get' as const,
      path: '/pre-existing',
    }
    const out = applyPlugin({}, baseConfig({ endpoints: [existingEp as never] }))
    const paths = (out.endpoints ?? []).map((e: { path: string }) => e.path)
    expect(paths).toContain('/pre-existing')
    expect(paths).toContain('/backup-mongodb/cron/run')
    expect(paths).toContain('/backup-mongodb/admin/manual')
    expect(paths).toContain('/backup-mongodb/admin/restore')
    expect(paths).toContain('/backup-mongodb/admin/task/:id')
  })

  it('injects the BackupDashboard after existing afterDashboard components', () => {
    const existingAfter = 'some/existing/component'
    const out = applyPlugin(
      {},
      baseConfig({
        admin: { components: { afterDashboard: [existingAfter as never] } },
      } as Partial<Config>),
    )
    const afterDashboard = out.admin?.components?.afterDashboard as unknown[]
    expect(afterDashboard).toHaveLength(2)
    expect(afterDashboard[0]).toBe(existingAfter)
    expect(afterDashboard[1]).toMatch(/BackupDashboard/)
  })

  it('does not register the seed endpoint unless seedDemoDumpUrl is set', () => {
    const withoutSeed = applyPlugin({}, baseConfig())
    const withSeed = applyPlugin({ seedDemoDumpUrl: 'https://x/y.json' }, baseConfig())

    const pathsWithout = (withoutSeed.endpoints ?? []).map((e: { path: string }) => e.path)
    const pathsWith = (withSeed.endpoints ?? []).map((e: { path: string }) => e.path)

    expect(pathsWithout).not.toContain('/backup-mongodb/admin/seed')
    expect(pathsWith).toContain('/backup-mongodb/admin/seed')
  })
})
