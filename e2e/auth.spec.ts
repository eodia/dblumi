import { test, expect } from '@playwright/test'

test.describe('Authentication', () => {
  test('should show login page by default', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('text=dblumi')).toBeVisible()
    await expect(page.locator('input[type="email"]')).toBeVisible()
    await expect(page.locator('input[type="password"]')).toBeVisible()
  })

  test('should navigate to register page', async ({ page }) => {
    await page.goto('/')
    const link = page.locator('text=Créer un compte').or(page.locator('text=Create an account'))
    await link.click()
    await expect(page.locator('input#name')).toBeVisible()
  })

  test('should register a new account', async ({ page }) => {
    await page.goto('/')
    const link = page.locator('text=Créer un compte').or(page.locator('text=Create an account'))
    await link.click()

    const email = `reg-${Date.now()}@dblumi.dev`
    await page.fill('input#name', 'Test User')
    await page.fill('input#reg-email', email)
    await page.fill('input#reg-password', 'testpassword123')
    await page.click('button[type="submit"]')

    // Should redirect to main app (sidebar visible)
    await expect(page.locator('[data-sidebar]').first()).toBeVisible({ timeout: 10_000 })
  })

  test('should login with existing account', async ({ page }) => {
    // First register
    await page.goto('/')
    const email = `login-${Date.now()}@dblumi.dev`
    const regLink = page.locator('text=Créer un compte').or(page.locator('text=Create an account'))
    await regLink.click()
    await page.fill('input#name', 'Login Test')
    await page.fill('input#reg-email', email)
    await page.fill('input#reg-password', 'testpassword123')
    await page.click('button[type="submit"]')
    await expect(page.locator('[data-sidebar]').first()).toBeVisible({ timeout: 10_000 })

    // Logout via user menu
    await page.click('[data-sidebar="footer"] button')
    const logoutItem = page.locator('text=Se déconnecter').or(page.locator('text=Sign out'))
    await logoutItem.click()
    await expect(page.locator('input[type="email"]')).toBeVisible({ timeout: 5_000 })

    // Make sure we're on the login page, not register
    const onRegister = await page.locator('input#name').isVisible().catch(() => false)
    if (onRegister) {
      const loginLink = page.locator('text=Se connecter').or(page.locator('text=Sign in')).last()
      await loginLink.click()
    }

    // Login
    await page.fill('input[type="email"]', email)
    await page.fill('input[type="password"]', 'testpassword123')
    await page.click('button[type="submit"]')
    await expect(page.locator('[data-sidebar]').first()).toBeVisible({ timeout: 10_000 })
  })

  test('should show error on wrong password', async ({ page }) => {
    await page.goto('/')
    await page.fill('input[type="email"]', 'wrong@dblumi.dev')
    await page.fill('input[type="password"]', 'wrongpassword')
    await page.click('button[type="submit"]')
    await expect(page.locator('.text-destructive')).toBeVisible({ timeout: 5_000 })
  })
})
