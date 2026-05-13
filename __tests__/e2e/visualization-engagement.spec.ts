import { test, expect, type Page } from "@playwright/test"

const CLIENT_EMAIL = process.env.E2E_CLIENT_EMAIL
const CLIENT_PASSWORD = process.env.E2E_CLIENT_PASSWORD
const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD
const CLIENT_USER_ID = process.env.E2E_CLIENT_USER_ID

async function signIn(page: Page, email: string, password: string) {
  await page.goto("/login")
  await page.getByLabel(/email/i).fill(email)
  await page.getByLabel(/password/i).fill(password)
  await page.getByRole("button", { name: /sign in|log in/i }).click()
  await page.waitForURL(/\/(client|admin)/, { timeout: 10_000 })
}

test.describe("Visualization & Engagement", () => {
  test("athlete renders snapshot page with all four cards", async ({ page }) => {
    test.skip(!CLIENT_EMAIL || !CLIENT_PASSWORD, "E2E client creds not set")
    await signIn(page, CLIENT_EMAIL!, CLIENT_PASSWORD!)
    await page.goto("/client/snapshot")
    await expect(page.getByText(/athlete profile/i)).toBeVisible()
    await expect(page.getByText(/training streak/i)).toBeVisible()
    await expect(page.getByText(/badges/i)).toBeVisible()
    await expect(page.getByText(/open goals/i)).toBeVisible()
  })

  test("athlete creates a goal", async ({ page }) => {
    test.skip(!CLIENT_EMAIL || !CLIENT_PASSWORD, "E2E client creds not set")
    await signIn(page, CLIENT_EMAIL!, CLIENT_PASSWORD!)
    await page.goto("/client/goals")
    await page.getByRole("button", { name: /add goal/i }).click()
    await expect(page.getByText(/goal added/i)).toBeVisible()
  })

  test("admin sees Profile tab on hub", async ({ page }) => {
    test.skip(!ADMIN_EMAIL || !ADMIN_PASSWORD || !CLIENT_USER_ID, "E2E admin creds or client id not set")
    await signIn(page, ADMIN_EMAIL!, ADMIN_PASSWORD!)
    await page.goto(`/admin/clients/${CLIENT_USER_ID}/performance?tab=profile`)
    await expect(page.getByText(/athlete profile/i)).toBeVisible()
  })
})
