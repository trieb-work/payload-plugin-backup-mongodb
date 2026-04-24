import type { Page } from '@playwright/test'

/** Seeded in `dev/seed.ts` (see `dev/helpers/credentials.ts`). */
export async function loginAsDevUser(page: Page): Promise<void> {
  await page.goto('/admin')
  await page.fill('#field-email', 'dev@payloadcms.com')
  await page.fill('#field-password', 'test')
  await page.click('.form-submit button')
  await page.waitForURL(/\/admin/)
}
