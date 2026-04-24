import { expect, test } from '@playwright/test'

import { loginAsDevUser } from './helpers'

test.describe('Backup plugin UI (dev app)', () => {
  test('Backups block is visible on dashboard after login', async ({ page }) => {
    await loginAsDevUser(page)
    await page.goto('/admin')
    await expect(page.getByRole('heading', { name: /Backups/i }).first()).toBeVisible()
  })
})
