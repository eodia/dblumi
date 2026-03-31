import { type Page, expect } from '@playwright/test'

/** Register a fresh user and return to the main app */
export async function registerAndLogin(page: Page) {
  const email = `e2e-${Date.now()}@dblumi.dev`
  await page.goto('/')

  // Wait for the auth page to load
  await expect(page.locator('text=dblumi')).toBeVisible({ timeout: 10_000 })

  // Check if we're on login or register page
  const nameField = page.locator('input#name')
  const isOnRegister = await nameField.isVisible({ timeout: 2_000 }).catch(() => false)

  if (!isOnRegister) {
    // We're on login — navigate to register
    const createLink = page.locator('text=Créer un compte').or(page.locator('text=Create an account'))
    await createLink.click()
    await expect(nameField).toBeVisible({ timeout: 3_000 })
  }

  await page.fill('input#name', 'E2E Tester')
  await page.fill('input#reg-email', email)
  await page.fill('input#reg-password', 'testpassword123')
  await page.click('button[type="submit"]')

  // Wait for main app
  await expect(page.locator('[data-sidebar]').first()).toBeVisible({ timeout: 10_000 })
  return email
}

/** Open command palette */
export async function openCommandPalette(page: Page) {
  await page.keyboard.press('Control+k')
  // cmdk renders inside a dialog with role="dialog"
  await expect(page.locator('[role="dialog"] input').first()).toBeVisible({ timeout: 3_000 })
}
