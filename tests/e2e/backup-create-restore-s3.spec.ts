import { expect, test } from '@playwright/test'

import { expandBackupList, openBackupDashboard, requireS3Storage, waitForTaskDone } from './helpers'

const MANUAL_DIALOG = 'dialog.backup-confirm-dialog--manual[open]'
const RESTORE_DIALOG = 'dialog.backup-confirm-dialog--restore[open]'
const DELETE_DIALOG = 'dialog.backup-confirm-dialog:not([class*="--"])[open]'

test.describe('Backup create + restore roundtrip via MinIO (dev app)', () => {
  test.beforeEach(() => {
    test.skip(
      !requireS3Storage(),
      'Needs BACKUP_STORAGE=s3 with BACKUP_S3_BUCKET + BACKUP_S3_ENDPOINT (MinIO in CI)',
    )
  })

  test.setTimeout(300_000)

  test('dashboard shows S3 storage target and supports manual backup roundtrip', async ({
    page,
  }) => {
    const label = `e2e-s3-roundtrip-${Date.now()}`

    await openBackupDashboard(page)

    const toolbar = page.locator('.backup-dashboard__toolbar')
    await expect(toolbar).toBeVisible()
    await expect(toolbar).toContainText(/Storage/i)
    await expect(toolbar).toContainText(/AWS S3/i)
    await expect(page.locator('.backup-dashboard__setup-hint')).toHaveCount(0)

    await page.getByRole('button', { name: /Create manual Backup/i }).click()
    const manualDialog = page.locator(MANUAL_DIALOG)
    await expect(manualDialog).toBeVisible()

    await expect(
      manualDialog.locator('.restore-preview__sticky-heading', {
        hasText: /Collection selection/i,
      }),
    ).toBeVisible({ timeout: 30_000 })

    await manualDialog.getByLabel('Optional backup label').fill(label)

    const startButton = manualDialog.getByRole('button', { name: /Start backup/i })
    await expect(startButton).toBeEnabled({ timeout: 30_000 })
    await startButton.click()

    await waitForTaskDone(manualDialog, { timeout: 120_000 })
    await expect(manualDialog).toBeHidden({ timeout: 10_000 })

    await expandBackupList(page)
    const createdRow = page
      .locator('.backup-item')
      .filter({ has: page.locator('.backup-item__pill--label', { hasText: label }) })
    await expect(createdRow).toHaveCount(1, { timeout: 30_000 })

    await createdRow.getByRole('button', { name: /^Restore$/ }).click()
    const restoreDialog = page.locator(RESTORE_DIALOG)
    await expect(restoreDialog).toBeVisible()

    await expect(
      restoreDialog.locator('.restore-preview__sticky-heading', {
        hasText: /Collection selection/i,
      }),
    ).toBeVisible({ timeout: 60_000 })

    for (const slug of ['users', 'roles', 'payload-preferences']) {
      const cb = restoreDialog.locator(
        `input[type="checkbox"][aria-label*="(${slug})" i][aria-label^="Restore collection" i]`,
      )
      if ((await cb.count()) > 0 && (await cb.first().isChecked())) {
        await cb.first().click()
        await expect(cb.first()).not.toBeChecked()
      }
    }

    await restoreDialog.getByRole('button', { name: /Yes, restore/i }).click()
    await waitForTaskDone(restoreDialog, { timeout: 180_000 })
    await expect(restoreDialog).toBeHidden({ timeout: 10_000 })

    await expandBackupList(page)
    await expect(createdRow).toHaveCount(1, { timeout: 15_000 })
    await createdRow.getByRole('button', { name: /^Delete$/ }).click()

    const deleteDialog = page.locator(DELETE_DIALOG)
    await expect(deleteDialog).toBeVisible()
    await deleteDialog.getByRole('button', { name: /Yes, delete/i }).click()
    // Delete uses `refreshOnComplete`, so the dialog may close before the Done pill is
    // observable — assert the backup row disappears instead (same end state as blob e2e).
    await expect(createdRow).toHaveCount(0, { timeout: 120_000 })
  })
})
