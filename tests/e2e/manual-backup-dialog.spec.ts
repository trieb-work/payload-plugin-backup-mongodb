import type { Page } from '@playwright/test'

import { expect, test } from '@playwright/test'

import { openBackupDashboard } from './helpers'

const DIALOG_SELECTOR = 'dialog.backup-confirm-dialog--manual'

/**
 * Minimal deterministic backup-preview response. The dialog only needs a list of groups
 * for the preview body to enter the "ready" phase.
 */
const FAKE_PREVIEW = {
  groups: [
    {
      groupId: 'posts',
      groupLabel: 'Posts',
      mongoCollectionNames: ['posts'],
      members: [
        {
          kind: 'collection' as const,
          mongoCollectionName: 'posts',
          docCount: 0,
          labelSingular: 'Post',
          labelPlural: 'Posts',
          adminHidden: false,
          adminHiddenReasons: [],
        },
      ],
      adminHiddenReasons: [],
    },
  ],
  mediaBlobCandidates: 0,
}

async function mockBackupPreviewOk(page: Page): Promise<void> {
  await page.route('**/api/backup-mongodb/admin/backup-preview', async (route) => {
    await route.fulfill({
      body: JSON.stringify(FAKE_PREVIEW),
      contentType: 'application/json',
      status: 200,
    })
  })
}

async function mockManualEndpoint503(page: Page): Promise<void> {
  await page.route('**/api/backup-mongodb/admin/manual', async (route) => {
    await route.fulfill({
      body: JSON.stringify({ error: 'Service unavailable' }),
      contentType: 'application/json',
      status: 503,
    })
  })
}

test.describe('Manual backup dialog (dev app)', () => {
  test('opens from the toolbar and loads the collection preview', async ({ page }) => {
    await mockBackupPreviewOk(page)
    await openBackupDashboard(page)
    await page.getByRole('button', { name: /Create manual Backup/i }).click()

    const dialog = page.locator(DIALOG_SELECTOR)
    await expect(dialog).toBeVisible()
    await expect(dialog.getByText('Create manual backup', { exact: true })).toBeVisible()

    // Preview transitions to `ready` → the collection-selection header appears.
    await expect(
      dialog.locator('.restore-preview__sticky-heading', {
        hasText: /Collection selection/i,
      }),
    ).toBeVisible({ timeout: 10_000 })

    const labelInput = dialog.getByLabel('Optional backup label')
    await expect(labelInput).toBeVisible()
    await labelInput.fill('integration-demo')
    await expect(labelInput).toHaveValue('integration-demo')
  })

  test('Cancel closes the dialog without starting a backup', async ({ page }) => {
    await mockBackupPreviewOk(page)
    await openBackupDashboard(page)
    await page.getByRole('button', { name: /Create manual Backup/i }).click()

    const dialog = page.locator(DIALOG_SELECTOR)
    await expect(dialog).toBeVisible()
    await dialog.getByRole('button', { name: /^Cancel$/ }).click()
    await expect(dialog).toBeHidden()
  })

  test('surfaces a "Service unavailable" error when the backend rejects the request', async ({
    page,
  }) => {
    await mockBackupPreviewOk(page)
    await mockManualEndpoint503(page)
    await openBackupDashboard(page)
    await page.getByRole('button', { name: /Create manual Backup/i }).click()

    const dialog = page.locator(DIALOG_SELECTOR)
    await expect(dialog).toBeVisible()

    const startButton = dialog.getByRole('button', { name: /Start backup/i })
    await expect(startButton).toBeEnabled({ timeout: 10_000 })
    await startButton.click()

    const statusMessage = dialog.locator('.backup-task-status__message')
    await expect(statusMessage).toContainText(/Service unavailable/i, { timeout: 10_000 })
    await expect(dialog.locator('.pill', { hasText: /Failed/i })).toBeVisible()
  })
})
