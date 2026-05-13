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

test.describe("Coach Intelligence", () => {
  test("athlete logs a training session", async ({ page }) => {
    test.skip(!CLIENT_EMAIL || !CLIENT_PASSWORD, "E2E client creds not set")
    await signIn(page, CLIENT_EMAIL!, CLIENT_PASSWORD!)
    await page.goto("/client/training")
    await page.getByRole("button", { name: /save session/i }).click()
    await expect(page.getByText(/session logged/i)).toBeVisible()
  })

  test("admin sees Load and Alerts tabs on the hub", async ({ page }) => {
    test.skip(!ADMIN_EMAIL || !ADMIN_PASSWORD || !CLIENT_USER_ID, "E2E admin creds or client id not set")
    await signIn(page, ADMIN_EMAIL!, ADMIN_PASSWORD!)
    await page.goto(`/admin/clients/${CLIENT_USER_ID}/performance`)
    await expect(page.getByRole("tab", { name: /load/i })).toBeVisible()
    await expect(page.getByRole("tab", { name: /alerts/i })).toBeVisible()
  })
})
