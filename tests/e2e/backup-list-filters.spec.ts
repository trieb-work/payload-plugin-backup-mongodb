import { expect, test } from '@playwright/test'

import { expandBackupList, openBackupDashboard } from './helpers'

const FILTERS_DIALOG = 'dialog.backup-confirm-dialog--backup-list-filters'

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
