import { test, expect } from "@playwright/test"
import { createServiceRoleClient } from "@/lib/supabase"

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL!
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD!
const INVITEE_EMAIL = `e2e-invitee-${Date.now()}@example.com`

test.describe("Team invite flow", () => {
  test.skip(
    !process.env.E2E_ADMIN_EMAIL || !process.env.E2E_ADMIN_PASSWORD,
    "E2E admin credentials not set",
  )

  test.afterAll(async () => {
    const supabase = createServiceRoleClient()
    await supabase.from("team_invites").delete().eq("email", INVITEE_EMAIL)
    await supabase.from("users").delete().eq("email", INVITEE_EMAIL)
  })

  test("admin can invite an editor and the invitee can claim it", async ({ page }) => {
    // 1. Admin signs in
    await page.goto("/login")
    await page.getByLabel(/email/i).fill(ADMIN_EMAIL)
    await page.getByLabel(/password/i).fill(ADMIN_PASSWORD)
    await page.getByRole("button", { name: /log in/i }).click()
    await page.waitForURL("**/admin/**")

    // 2. Send the invite
    await page.goto("/admin/team")
    await page.getByRole("button", { name: /invite member/i }).click()
    const dialog = page.getByRole("dialog")
    await dialog.getByLabel(/email/i).fill(INVITEE_EMAIL)
    await dialog.getByRole("button", { name: /send invite/i }).click()
    await expect(page.getByText(INVITEE_EMAIL)).toBeVisible()

    // 3. Look up the token from the DB (bypasses email)
    const supabase = createServiceRoleClient()
    const { data: invite } = await supabase
      .from("team_invites")
      .select("token")
      .eq("email", INVITEE_EMAIL)
      .single()
    expect(invite?.token).toBeTruthy()

    // 4. Sign out, then claim as the invitee
    const claimContext = page.context()
    await claimContext.clearCookies()

    await page.goto(`/invite/${invite!.token}`)
    await page.getByLabel(/first name/i).fill("E2E")
    await page.getByLabel(/last name/i).fill("Editor")
    await page.getByLabel(/password/i).fill("E2eTestPass!23")
    await page.getByRole("button", { name: /accept and continue/i }).click()

    // 5. Land on /editor
    await page.waitForURL("**/editor")
    await expect(page.getByRole("heading", { name: /welcome/i })).toBeVisible()
  })
})
