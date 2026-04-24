import { expect, test } from '@playwright/test'

import { openBackupDashboard } from './helpers'

test.describe('Backup plugin dashboard (dev app)', () => {
  test('Backups block is visible on dashboard after login', async ({ page }) => {
    await openBackupDashboard(page)
    await expect(page.getByRole('heading', { name: /^Backups/ })).toBeVisible({
      timeout: 10_000,
    })
  })

  test('toolbar renders the Total + Last backup pills', async ({ page }) => {
    await openBackupDashboard(page)
    const toolbar = page.locator('.backup-dashboard__toolbar')
    await expect(toolbar).toBeVisible()
    // The two toolbar pills are always rendered; their numeric / date value depends on env.
    await expect(toolbar).toContainText(/Total/i)
    await expect(toolbar).toContainText(/Last backup/i)
  })

  test('toolbar exposes the two action buttons (Create manual Backup + Backup settings)', async ({
    page,
  }) => {
    await openBackupDashboard(page)
    await expect(page.getByRole('button', { name: /Create manual Backup/i })).toBeVisible()
    await expect(page.getByRole('button', { name: /^Backup settings$/i })).toBeVisible()
  })

  test('Backup list Collapsible is present below the toolbar', async ({ page }) => {
    await openBackupDashboard(page)
    await expect(page.locator('.backup-dashboard__collapsible-title')).toBeVisible()
    await expect(page.locator('.backup-dashboard__collapsible-title')).toHaveText(/Backup list/i)
  })

  test('setup hint links either render the no-token state or the connected state (env-dependent)', async ({
    page,
  }) => {
    await openBackupDashboard(page)
    // The dashboard has two exclusive states. We document both here so whichever env the
    // test runs in (local with token, CI without) exercises one of the documented paths.
    const setupHint = page.locator('.backup-dashboard__setup-hint')
    const hintCount = await setupHint.count()

    if (hintCount > 0) {
      await expect(setupHint).toContainText(/BLOB_READ_WRITE_TOKEN/)
      await expect(setupHint).toContainText(/Backup settings/)
    } else {
      // Token is configured → the toolbar action buttons are still present and the
      // dashboard did not bail out.
      await expect(page.getByRole('button', { name: /Create manual Backup/i })).toBeVisible()
    }
  })
})
