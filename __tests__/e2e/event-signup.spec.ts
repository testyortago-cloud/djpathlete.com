import { test, expect } from "@playwright/test"

// Needs a seeded published clinic. Skip if EVENT_TEST_SLUG is missing.
const eventSlug = process.env.EVENT_TEST_SLUG

test.describe("Public event signup flow", () => {
  test.skip(!eventSlug, "EVENT_TEST_SLUG not set — scaffolding only")

  test("visitor can open the signup modal from the detail page and submit", async ({ page }) => {
    await page.goto(`/clinics/${eventSlug}`)

    await expect(page.getByRole("heading", { level: 1 })).toBeVisible()

    await page.getByRole("button", { name: /register your interest/i }).first().click()

    await page.fill("input[name='parent_name']", "E2E Parent")
    await page.fill("input[name='parent_email']", `e2e-${Date.now()}@test.example`)
    await page.fill("input[name='athlete_name']", "E2E Athlete")
    await page.fill("input[name='athlete_age']", "14")

    await page.getByRole("button", { name: /^submit$/i }).click()

    await expect(page.getByText(/we'll be in touch within 48 hours/i)).toBeVisible()
  })
})
