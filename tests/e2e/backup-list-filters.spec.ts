import type { Page } from '@playwright/test'

import { expect, test } from '@playwright/test'

import { openBackupDashboard } from './helpers'

const FILTERS_DIALOG = 'dialog.backup-confirm-dialog--backup-list-filters'

/**
 * Click the Collapsible's chevron button inside the Backup dashboard. Payload's
 * `Collapsible` only wires `toggleCollapsible` onto `.collapsible__toggle`, not the
 * whole header, so clicking the title text would not be enough.
 */
async function expandBackupList(page: Page): Promise<void> {
  const toggle = page.locator('.backup-dashboard .collapsible__toggle').first()
  await toggle.click()
  await expect(page.locator('.backup-dashboard .collapsible--collapsed')).toHaveCount(0)
}

test.describe('Backup list filters (dev app)', () => {
  test('Collapsible expands on click', async ({ page }) => {
    await openBackupDashboard(page)
    await expandBackupList(page)
    // Once expanded, the "Filters" toolbar button must be visible.
    await expect(page.getByRole('button', { name: /^Filters$/ })).toBeVisible()
  })

  test('Filters dialog opens, exposes the filter controls, and closes on Done', async ({
    page,
  }) => {
    await openBackupDashboard(page)
    await expandBackupList(page)

    await page.getByRole('button', { name: /^Filters$/ }).click()

    const dialog = page.locator(FILTERS_DIALOG)
    await expect(dialog).toBeVisible()
    await expect(dialog.getByText('Filter backups', { exact: true })).toBeVisible()

    await expect(dialog.getByLabel('Filter backups by label text')).toBeVisible()
    await expect(dialog.getByLabel('Filter from date')).toBeVisible()
    await expect(dialog.getByLabel('Filter to date')).toBeVisible()
    await expect(dialog.getByLabel('Media filter: all backups')).toBeChecked()
    await expect(dialog.getByLabel('Source filter: all')).toBeChecked()

    await dialog.getByRole('button', { name: /^Done$/ }).click()
    await expect(dialog).toBeHidden()
  })

  test('Clear filters button resets the label text input', async ({ page }) => {
    await openBackupDashboard(page)
    await expandBackupList(page)
    await page.getByRole('button', { name: /^Filters$/ }).click()

    const dialog = page.locator(FILTERS_DIALOG)
    const labelInput = dialog.getByLabel('Filter backups by label text')
    await labelInput.fill('some-label')
    await expect(labelInput).toHaveValue('some-label')

    await dialog.getByRole('button', { name: /^Clear filters$/ }).click()
    await expect(labelInput).toHaveValue('')
  })
})
