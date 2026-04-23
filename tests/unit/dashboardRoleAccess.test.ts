import { describe, expect, it } from 'vitest'

import {
  isUserAllowedByEnvRoles,
  parseAllowedRolesEnv,
} from '../../src/utils/dashboardRoleAccess.js'

describe('parseAllowedRolesEnv', () => {
  it('returns empty when unset or blank', () => {
    expect(parseAllowedRolesEnv(undefined)).toEqual([])
    expect(parseAllowedRolesEnv('')).toEqual([])
    expect(parseAllowedRolesEnv('   ')).toEqual([])
  })

  it('splits, trims and lowercases comma-separated slugs', () => {
    expect(parseAllowedRolesEnv(' Admin , Editor,  superadmin ')).toEqual([
      'admin',
      'editor',
      'superadmin',
    ])
  })

  it('drops empty segments', () => {
    expect(parseAllowedRolesEnv('admin,,editor,')).toEqual(['admin', 'editor'])
  })
})

describe('isUserAllowedByEnvRoles', () => {
  it('blocks unauthenticated users regardless of env', () => {
    expect(isUserAllowedByEnvRoles(null, undefined)).toBe(false)
    expect(isUserAllowedByEnvRoles(null, '*')).toBe(false)
    expect(isUserAllowedByEnvRoles(null, 'admin')).toBe(false)
  })

  describe('env unset (backwards-compatible default)', () => {
    it('allows users without a roles field', () => {
      expect(isUserAllowedByEnvRoles({ id: '1' }, undefined)).toBe(true)
      expect(isUserAllowedByEnvRoles({ id: '1', roles: [] }, undefined)).toBe(true)
    })

    it('requires admin role when roles are present', () => {
      expect(isUserAllowedByEnvRoles({ roles: [{ slug: 'editor' }] }, undefined)).toBe(false)
      expect(isUserAllowedByEnvRoles({ roles: [{ slug: 'admin' }] }, undefined)).toBe(true)
      expect(isUserAllowedByEnvRoles({ roles: ['admin'] }, undefined)).toBe(true)
    })
  })

  describe('env = "*"', () => {
    it('allows any authenticated user', () => {
      expect(isUserAllowedByEnvRoles({ id: '1' }, '*')).toBe(true)
      expect(isUserAllowedByEnvRoles({ roles: [{ slug: 'random' }] }, '*')).toBe(true)
    })
  })

  describe('env with explicit allow-list', () => {
    it('matches any configured role (case-insensitive)', () => {
      expect(isUserAllowedByEnvRoles({ roles: [{ slug: 'Editor' }] }, 'admin,editor')).toBe(true)
      expect(isUserAllowedByEnvRoles({ roles: ['admin'] }, 'admin,editor')).toBe(true)
    })

    it('denies users without matching roles', () => {
      expect(isUserAllowedByEnvRoles({ roles: [{ slug: 'viewer' }] }, 'admin,editor')).toBe(false)
    })

    it('denies users that have no roles field', () => {
      expect(isUserAllowedByEnvRoles({ id: '1' }, 'admin,editor')).toBe(false)
      expect(isUserAllowedByEnvRoles({ id: '1', roles: [] }, 'admin,editor')).toBe(false)
    })
  })
})
