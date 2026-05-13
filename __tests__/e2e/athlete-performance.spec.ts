import { test, expect, type Page } from "@playwright/test"

// These tests assume a seeded admin and client user exist.
// Set E2E_CLIENT_EMAIL / E2E_CLIENT_PASSWORD / E2E_ADMIN_EMAIL /
// E2E_ADMIN_PASSWORD / E2E_CLIENT_USER_ID env vars to run them against
// real accounts. Without them, tests skip — they're aspirational
// coverage for CI once seed users are in place.

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

test.describe("Athlete Performance", () => {
  test("athlete can log readiness", async ({ page }) => {
    test.skip(!CLIENT_EMAIL || !CLIENT_PASSWORD, "E2E client creds not set")
    await signIn(page, CLIENT_EMAIL!, CLIENT_PASSWORD!)
    await page.goto("/client/readiness")
    await page.getByRole("button", { name: /save readiness/i }).click()
    await expect(page.getByText(/readiness logged/i)).toBeVisible()
  })

  test("athlete can log a drop jump test and see PR badge on first entry", async ({ page }) => {
    test.skip(!CLIENT_EMAIL || !CLIENT_PASSWORD, "E2E client creds not set")
    await signIn(page, CLIENT_EMAIL!, CLIENT_PASSWORD!)
    await page.goto("/client/performance")
    await page.getByRole("button", { name: /log test/i }).click()
    await page.getByPlaceholder(/e\.g\. 38\.2/i).fill("38.5, 38.2, 37.9")
    await page.getByRole("button", { name: /^save$/i }).click()
    await expect(page.getByText(/new pr|test logged/i)).toBeVisible()
  })

  test("admin can view performance hub for client", async ({ page }) => {
    test.skip(
      !ADMIN_EMAIL || !ADMIN_PASSWORD || !CLIENT_USER_ID,
      "E2E admin creds or client id not set",
    )
    await signIn(page, ADMIN_EMAIL!, ADMIN_PASSWORD!)
    await page.goto(`/admin/clients/${CLIENT_USER_ID}/performance`)
    await expect(page.getByRole("heading", { name: /performance/i })).toBeVisible()
  })
})
