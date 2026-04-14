import { test, expect } from "@playwright/test"

test.describe("Clinics landing page", () => {
  test("renders hero, focus cards, flow, coming-soon panel, and inquiry form", async ({ page }) => {
    await page.goto("/clinics")

    await expect(
      page.getByRole("heading", { level: 1, name: /get quicker where the game actually changes/i }),
    ).toBeVisible()

    await expect(page.getByText("Acceleration")).toBeVisible()
    await expect(page.getByText("Deceleration")).toBeVisible()
    await expect(page.getByText("Change of Direction")).toBeVisible()
    await expect(page.getByText("Rotation")).toBeVisible()

    await expect(page.getByText(/new clinic dates rolling out soon/i)).toBeVisible()

    const serviceSelect = page.locator("select[name='service']")
    await expect(serviceSelect).toHaveValue("clinic")
  })

  test("hero CTA scrolls to the inquiry form", async ({ page }) => {
    await page.goto("/clinics")
    await page
      .getByRole("link", { name: /register your interest/i })
      .first()
      .click()
    await expect(page).toHaveURL(/#register-interest$/)
  })
})

test.describe("Camps landing page", () => {
  test("renders hero, focus cards, tech section, coming-soon panel, and inquiry form", async ({ page }) => {
    await page.goto("/camps")

    await expect(
      page.getByRole("heading", { level: 1, name: /build more before the season takes over/i }),
    ).toBeVisible()

    await expect(page.getByText("Speed + Power")).toBeVisible()
    await expect(page.getByText("Strength Qualities")).toBeVisible()
    await expect(page.getByText("Movement Quality")).toBeVisible()
    await expect(page.getByText("Conditioning")).toBeVisible()

    await expect(page.getByText(/next camp block being scheduled/i)).toBeVisible()

    const serviceSelect = page.locator("select[name='service']")
    await expect(serviceSelect).toHaveValue("camp")
  })

  test("hero CTA scrolls to the inquiry form", async ({ page }) => {
    await page.goto("/camps")
    await page.getByRole("link", { name: /register your interest/i }).first().click()
    await expect(page).toHaveURL(/#register-interest$/)
  })
})
