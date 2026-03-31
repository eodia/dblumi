import { test, expect } from '@playwright/test'
import { registerAndLogin } from './helpers'

test.describe('UI Components', () => {
  test.beforeEach(async ({ page }) => {
    await registerAndLogin(page)
  })

  test('should show sidebar with navigation items', async ({ page }) => {
    // Navigation items should be visible
    await expect(page.locator('text=Tables')).toBeVisible({ timeout: 5_000 })
    await expect(page.locator('text=Éditeur SQL').or(page.locator('text=SQL Editor'))).toBeVisible()
  })

  test('should navigate to Tables page', async ({ page }) => {
    await page.click('text=Tables')
    // Should show some kind of table/schema view or empty state
    await expect(page.locator('text=Tables').first()).toBeVisible()
  })

  test('should show copilot button in toolbar', async ({ page }) => {
    const copilotBtn = page.locator('text=Copilot').first()
    await expect(copilotBtn).toBeVisible({ timeout: 5_000 })
  })

  test('should toggle copilot panel', async ({ page }) => {
    const copilotBtn = page.locator('button:has-text("Copilot")').first()
    await copilotBtn.click()

    // Copilot panel should open — without a connection it shows the empty state
    const copilotPanel = page.locator('text=copilot').or(page.locator('text=Copilot')).nth(1)
    await expect(copilotPanel).toBeVisible({ timeout: 3_000 })

    // Close it
    await copilotBtn.click()
    await page.waitForTimeout(500)
  })

  test('should show save button in toolbar', async ({ page }) => {
    const saveBtn = page.locator('button:has-text("Sauvegarder")').or(page.locator('button:has-text("Save")'))
    await expect(saveBtn.first()).toBeVisible({ timeout: 5_000 })
  })

  test('should show execute button in toolbar', async ({ page }) => {
    const execBtn = page.locator('button:has-text("Exécuter")').or(page.locator('button:has-text("Execute")'))
    await expect(execBtn.first()).toBeVisible({ timeout: 5_000 })
  })

  test('should middle-click close a tab', async ({ page }) => {
    // Create a second tab
    await page.keyboard.press('Alt+n')
    await expect(page.locator('text=Query 2')).toBeVisible({ timeout: 3_000 })

    // Middle-click on the second tab
    const tab2 = page.locator('text=Query 2')
    await tab2.click({ button: 'middle' })
    await expect(page.locator('text=Query 2')).not.toBeVisible({ timeout: 3_000 })
  })
})
