import { describe, expect, it } from 'vitest'

import { describeCronSchedule } from '../../src/core/vercelBackupCron.js'

describe('describeCronSchedule', () => {
  it('describes a daily cron', () => {
    const s = describeCronSchedule('0 3 * * *')
    expect(s).toBeTruthy()
    expect(s!.toLowerCase()).toMatch(/3/)
  })
})
