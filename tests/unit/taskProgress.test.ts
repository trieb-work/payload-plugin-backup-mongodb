import { describe, it, expect } from 'vitest'
import { pollSecretsMatch, stripPollSecretForClient } from '../../src/core/taskProgress.js'

describe('taskProgress', () => {
  it('pollSecretsMatch accepts equal secrets', () => {
    const secret = 'a'.repeat(64)
    expect(pollSecretsMatch(secret, secret)).toBe(true)
  })

  it('pollSecretsMatch rejects unequal secrets', () => {
    const a = 'a'.repeat(64)
    const b = 'b'.repeat(64)
    expect(pollSecretsMatch(a, b)).toBe(false)
  })

  it('pollSecretsMatch rejects missing stored secret', () => {
    expect(pollSecretsMatch('abc', undefined)).toBe(false)
    expect(pollSecretsMatch('abc', null)).toBe(false)
  })

  it('stripPollSecretForClient removes pollSecret', () => {
    const stripped = stripPollSecretForClient({
      createdAt: 'x',
      id: '1',
      kind: 'restore',
      message: 'm',
      pollSecret: 'secret',
      status: 'running',
      updatedAt: 'y',
    })
    expect(stripped).not.toHaveProperty('pollSecret')
    expect(stripped.id).toBe('1')
  })
})
