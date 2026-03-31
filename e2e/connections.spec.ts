import { test, expect } from '@playwright/test'
import { registerAndLogin } from './helpers'

test.describe('Connections', () => {
  test.beforeEach(async ({ page }) => {
    await registerAndLogin(page)
  })

  test('should show "no connection" state', async ({ page }) => {
    // The sidebar should show the connection dropdown
    const connButton = page.locator('[data-sidebar="header"] button').first()
    await expect(connButton).toBeVisible()
  })

  test('should open connection modal via sidebar button', async ({ page }) => {
    // Click on the connection switcher
    const connButton = page.locator('[data-sidebar="header"] button').first()
    await connButton.click()

    // Click "Nouvelle connexion" or "New connection"
    const newConnItem = page.locator('text=Nouvelle connexion').or(page.locator('text=New connection'))
    await expect(newConnItem).toBeVisible({ timeout: 3_000 })
    await newConnItem.click()

    // The modal should open
    await expect(page.locator('text=Nouvelle connexion').or(page.locator('text=New connection')).first()).toBeVisible({ timeout: 3_000 })
  })

  test('should show new connection option in dropdown', async ({ page }) => {
    const connButton = page.locator('[data-sidebar="header"] button').first()
    await connButton.click()

    // "New connection" option should be visible even with no connections
    const newConn = page.locator('text=Nouvelle connexion').or(page.locator('text=New connection'))
    await expect(newConn).toBeVisible({ timeout: 3_000 })
  })
})
