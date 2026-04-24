import { expect, test } from '@playwright/test'

import { loginAsDevUser } from './helpers'

test.describe('Payload admin (dev app)', () => {
  test('login shows dashboard', async ({ page }) => {
    await loginAsDevUser(page)
    await expect(page).toHaveTitle(/Dashboard/)
    await expect(page.locator('.graphic-icon')).toBeVisible()
  })

  test('posts collection is reachable after login', async ({ page }) => {
    await loginAsDevUser(page)
    await page.goto('/admin/collections/posts')
    await expect(page).toHaveURL(/\/admin\/collections\/posts/)
    await expect(page.getByText('Posts').first()).toBeVisible()
  })
})
