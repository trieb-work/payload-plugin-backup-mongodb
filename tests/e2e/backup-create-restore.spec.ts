import { expect, test } from '@playwright/test'

import { expandBackupList, openBackupDashboard, requireBlobToken, waitForTaskDone } from './helpers'

const MANUAL_DIALOG = 'dialog.backup-confirm-dialog--manual[open]'
// One `<dialog>` is rendered per backup row — target the one that was just opened.
const RESTORE_DIALOG = 'dialog.backup-confirm-dialog--restore[open]'
// The delete confirm dialog has no `--variant` suffix. Use `:not()` to exclude the
// variant dialogs and require `[open]` to pick the one associated with our row.
const DELETE_DIALOG = 'dialog.backup-confirm-dialog:not([class*="--"])[open]'

// Skip this whole file when no real Vercel Blob store is configured — the roundtrip needs
// a writable backend. CI only runs the happy path when the optional secret is present.
test.describe('Backup create + restore roundtrip (dev app)', () => {
  test.beforeEach(() => {
    test.skip(
      !requireBlobToken(),
      'Needs BLOB_READ_WRITE_TOKEN to exercise the real @vercel/blob backend',
    )
  })

  // The roundtrip touches the real blob store and includes dialog polling, so give it
  // plenty of time: create (mongo dump + upload) + restore (download + upsert).
  test.setTimeout(300_000)

  test('create a manual backup via the UI and restore it from the backup list', async ({
    page,
  }) => {
    const label = `e2e-roundtrip-${Date.now()}`

    await openBackupDashboard(page)

    // ---- CREATE -----------------------------------------------------------------
    await page.getByRole('button', { name: /Create manual Backup/i }).click()
    const manualDialog = page.locator(MANUAL_DIALOG)
    await expect(manualDialog).toBeVisible()

    // Wait for the backup preview to load (the Start backup button is disabled until
    // the phase transitions to `ready` or `error`).
    await expect(
      manualDialog.locator('.restore-preview__sticky-heading', {
        hasText: /Collection selection/i,
      }),
    ).toBeVisible({ timeout: 30_000 })

    await manualDialog.getByLabel('Optional backup label').fill(label)

    // Keep every collection checked by default — in dev the `media` collection is empty
    // so `includeMedia` is implicitly `false` (mediaBlobCandidates=0) and the archive
    // stays as a small json.
    const startButton = manualDialog.getByRole('button', { name: /Start backup/i })
    await expect(startButton).toBeEnabled({ timeout: 30_000 })
    await startButton.click()

    await waitForTaskDone(manualDialog, { timeout: 120_000 })
    // After success the dialog auto-closes within ~1s (router.refresh() + close).
    await expect(manualDialog).toBeHidden({ timeout: 10_000 })

    // The list is server-rendered and refreshes after create. Expand it and locate
    // the row by its unique label pill.
    await expandBackupList(page)
    const createdRow = page
      .locator('.backup-item')
      .filter({ has: page.locator('.backup-item__pill--label', { hasText: label }) })
    await expect(createdRow).toHaveCount(1, { timeout: 30_000 })
    await expect(createdRow.locator('.backup-item__pill--manual')).toBeVisible()

    // ---- RESTORE ----------------------------------------------------------------
    await createdRow.getByRole('button', { name: /^Restore$/ }).click()
    const restoreDialog = page.locator(RESTORE_DIALOG)
    await expect(restoreDialog).toBeVisible()

    // Preview transitions from `loading` to `ready` once the blob is downloaded +
    // analysed. On a cold cache this can take 10–20s.
    await expect(
      restoreDialog.locator('.restore-preview__sticky-heading', {
        hasText: /Collection selection/i,
      }),
    ).toBeVisible({ timeout: 60_000 })

    // Deselect the auth-session collections so the restore keeps our session intact.
    // The checkbox `aria-label` is `Restore collection ${displayTitle}` where
    // `displayTitle` is `"<Label> (<slug>)"`, so we match by the slug suffix to stay
    // resilient against localisation differences.
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

    // ---- CLEANUP: delete the just-created backup via the UI ---------------------
    // Exercises the delete flow AND keeps the blob store tidy for subsequent runs.
    await expandBackupList(page)
    await expect(createdRow).toHaveCount(1, { timeout: 15_000 })
    await createdRow.getByRole('button', { name: /^Delete$/ }).click()

    const deleteDialog = page.locator(DELETE_DIALOG)
    await expect(deleteDialog).toBeVisible()
    await deleteDialog.getByRole('button', { name: /Yes, delete/i }).click()
    await waitForTaskDone(deleteDialog, { timeout: 60_000 })

    // `TaskActionButton` with `refreshOnComplete` triggers a router.refresh; wait for
    // the row to disappear from the list so the test leaves a clean slate.
    await expect(createdRow).toHaveCount(0, { timeout: 30_000 })
  })
})
