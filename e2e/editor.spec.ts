import { test, expect } from '@playwright/test'
import { registerAndLogin, openCommandPalette } from './helpers'

test.describe('SQL Editor', () => {
  test.beforeEach(async ({ page }) => {
    await registerAndLogin(page)
  })

  test('should show empty editor with placeholder', async ({ page }) => {
    // The results area should show the empty state
    await expect(page.locator('text=Ctrl+Enter').first()).toBeVisible({ timeout: 5_000 })
  })

  test('should create new tab with Alt+N', async ({ page }) => {
    await page.keyboard.press('Alt+n')
    // Should have at least 2 tabs
    const tabs = page.locator('[data-radix-collection-item]')
    // The tab bar should have a new query tab
    await expect(page.locator('text=Query 2')).toBeVisible({ timeout: 3_000 })
  })

  test('should close tab with Alt+W', async ({ page }) => {
    // Create a second tab
    await page.keyboard.press('Alt+n')
    await expect(page.locator('text=Query 2')).toBeVisible({ timeout: 3_000 })

    // Close it
    await page.keyboard.press('Alt+w')
    await expect(page.locator('text=Query 2')).not.toBeVisible({ timeout: 3_000 })
  })

  test('should open command palette with Ctrl+K', async ({ page }) => {
    await openCommandPalette(page)
    await expect(page.locator('[role="dialog"] input').first()).toBeVisible()
  })

  test('should create new query from command palette', async ({ page }) => {
    await openCommandPalette(page)
    const input = page.locator('[role="dialog"] input').first()
    // Search for new query action (works in both FR and EN)
    await input.fill('query')
    await page.waitForTimeout(300)
    // Click the first matching result
    const item = page.locator('[role="dialog"] [role="option"]').first()
    await item.click()
    await expect(page.locator('text=Query 2')).toBeVisible({ timeout: 3_000 })
  })
})
