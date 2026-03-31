import { test, expect } from '@playwright/test'
import { registerAndLogin } from './helpers'

test.describe('Internationalization', () => {
  test.beforeEach(async ({ page }) => {
    await registerAndLogin(page)
  })

  test('should switch language to English', async ({ page }) => {
    // Open user menu
    await page.click('[data-sidebar="footer"] button')

    // Open language sub-menu
    const langItem = page.locator('text=Langue').or(page.locator('text=Language'))
    await expect(langItem).toBeVisible({ timeout: 3_000 })
    await langItem.hover()

    // Click English
    await page.click('text=English')

    // Wait for re-render — editor label should change
    await expect(page.locator('text=SQL Editor')).toBeVisible({ timeout: 5_000 })
  })

  test('should switch language back to French', async ({ page }) => {
    // Switch to English first
    await page.click('[data-sidebar="footer"] button')
    const langItem = page.locator('text=Langue').or(page.locator('text=Language'))
    await langItem.hover()
    await page.click('text=English')
    await expect(page.locator('text=SQL Editor')).toBeVisible({ timeout: 5_000 })

    // Switch back to French
    await page.click('[data-sidebar="footer"] button')
    const langItem2 = page.locator('text=Language')
    await langItem2.hover()
    await page.click('text=Français')
    await expect(page.locator('text=Éditeur SQL')).toBeVisible({ timeout: 5_000 })
  })
})
