import type { Page } from '@playwright/test'

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
