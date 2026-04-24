import type { Locator, Page } from '@playwright/test'

import { expect } from '@playwright/test'

/** Seeded in `dev/seed.ts` (see `dev/helpers/credentials.ts`). */
export async function loginAsDevUser(page: Page): Promise<void> {
  await page.goto('/admin')
  await page.fill('#field-email', 'dev@payloadcms.com')
  await page.fill('#field-password', 'test')
  await page.click('.form-submit button')
  await page.waitForURL(/\/admin/)
  await page.waitForSelector('.modular-dashboard')
}

/**
 * Logs in as the dev user and waits for the Backup dashboard section to be mounted.
 * Most plugin UI tests start from here.
 */
export async function openBackupDashboard(page: Page): Promise<void> {
  await loginAsDevUser(page)
  await page.goto('/admin')
  await page.waitForSelector('.backup-dashboard', { timeout: 60_000 })
}

/**
 * Expand the `Backup list` `Collapsible` on the dashboard. Payload only wires
 * `toggleCollapsible` to `.collapsible__toggle` (not the whole header), so clicking the
 * title text would not be enough.
 *
 * Safe to call even when the collapsible is already open — the second click would
 * collapse, so we first check the current state.
 */
export async function expandBackupList(page: Page): Promise<void> {
  const collapsible = page.locator('.backup-dashboard .collapsible').first()
  const isCollapsed = await collapsible.evaluate((el) =>
    el.classList.contains('collapsible--collapsed'),
  )
  if (!isCollapsed) {
    return
  }
  const toggle = page.locator('.backup-dashboard .collapsible__toggle').first()
  await toggle.click()
  await expect(page.locator('.backup-dashboard .collapsible--collapsed')).toHaveCount(0)
}

/**
 * Env-gated test guard. Many roundtrip tests need the real `@vercel/blob` store; we
 * skip rather than `fail` so CI without the secret stays green and locally a developer
 * only needs `BLOB_READ_WRITE_TOKEN` to opt in.
 */
export function requireBlobToken(): string {
  const token = process.env.BLOB_READ_WRITE_TOKEN?.trim()
  return token || ''
}

export function requireCronSecret(): string {
  const secret = process.env.CRON_SECRET?.trim()
  return secret || ''
}

/**
 * Waits for the `TaskActionButton` status slot inside a dialog to transition to `Done`.
 * The button also surfaces failures via a `Failed` pill — this helper throws with the
 * underlying error message so tests fail fast and loudly on a real backend error.
 */
export async function waitForTaskDone(
  scope: Locator,
  options: { timeout?: number } = {},
): Promise<void> {
  const timeout = options.timeout ?? 120_000
  const donePill = scope.locator('.backup-task-status-slot .pill', { hasText: /^Done$/ })
  const failedPill = scope.locator('.backup-task-status-slot .pill', { hasText: /^Failed$/ })

  await expect(async () => {
    if ((await failedPill.count()) > 0) {
      const message =
        (await scope.locator('.backup-task-status__message').first().textContent()) ?? ''
      throw new Error(`Task failed: ${message.trim() || 'no message'}`)
    }
    await expect(donePill).toBeVisible({ timeout: 1_000 })
  }).toPass({ timeout })
}
