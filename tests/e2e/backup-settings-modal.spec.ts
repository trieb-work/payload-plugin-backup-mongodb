import type { Page } from '@playwright/test'

import { expect, test } from '@playwright/test'

import { openBackupDashboard } from './helpers'

const DIALOG_SELECTOR = 'dialog.backup-confirm-dialog--settings'

const FAKE_SETTINGS = {
  id: 'settings-1',
  backupBlobAccess: null,
  backupBlobAccessEffective: 'public',
  backupBlobTokenMasked: '',
  backupsToKeep: 10,
  cron: null,
  effectiveBackupsToKeep: 10,
  hasBackupBlobReadWriteToken: false,
  includeMediaForCron: false,
  pluginBackupsToKeepOverride: false,
  skipMongoCollections: [] as string[],
}

async function mockSettingsResponse(page: Page): Promise<void> {
  await page.route('**/api/backup-mongodb/admin/settings*', async (route) => {
    if (route.request().method() !== 'GET') {
      await route.continue()
      return
    }
    await route.fulfill({
      body: JSON.stringify(FAKE_SETTINGS),
      contentType: 'application/json',
      status: 200,
    })
  })
}

test.describe('Backup settings modal (dev app)', () => {
  test('opens from the toolbar and renders the three configuration sections', async ({
    page,
  }) => {
    await mockSettingsResponse(page)
    await openBackupDashboard(page)
    await page.getByRole('button', { name: /^Backup settings$/ }).click()

    const dialog = page.locator(DIALOG_SELECTOR)
    await expect(dialog).toBeVisible()
    await expect(dialog.getByText('Scheduled backup settings', { exact: true })).toBeVisible()

    await expect(
      dialog.locator('.restore-preview__sticky-heading', { hasText: /Schedule/i }).first(),
    ).toBeVisible({ timeout: 10_000 })
    await expect(
      dialog.locator('.restore-preview__sticky-heading', { hasText: /Retention/i }),
    ).toBeVisible()
    await expect(
      dialog.locator('.restore-preview__sticky-heading', { hasText: /Dedicated backup storage/i }),
    ).toBeVisible()
  })

  test('retention input is rendered with the mocked default limit', async ({ page }) => {
    await mockSettingsResponse(page)
    await openBackupDashboard(page)
    await page.getByRole('button', { name: /^Backup settings$/ }).click()

    const dialog = page.locator(DIALOG_SELECTOR)
    const retention = dialog.getByLabel('Cron backups to keep')
    await expect(retention).toBeVisible({ timeout: 10_000 })
    await expect(retention).toHaveValue('10')
  })

  test('blob token field is present and starts empty when the mocked settings have no token', async ({
    page,
  }) => {
    await mockSettingsResponse(page)
    await openBackupDashboard(page)
    await page.getByRole('button', { name: /^Backup settings$/ }).click()

    const dialog = page.locator(DIALOG_SELECTOR)
    const tokenInput = dialog.getByLabel('Backup Blob read/write token')
    await expect(tokenInput).toBeVisible({ timeout: 10_000 })
    await expect(tokenInput).toHaveValue('')
  })

  test('Cancel closes the settings modal', async ({ page }) => {
    await mockSettingsResponse(page)
    await openBackupDashboard(page)
    await page.getByRole('button', { name: /^Backup settings$/ }).click()

    const dialog = page.locator(DIALOG_SELECTOR)
    await expect(dialog).toBeVisible()
    await dialog.getByRole('button', { name: /^Cancel$/ }).click()
    await expect(dialog).toBeHidden()
  })
})
