import { test, expect } from "@playwright/test"
import { createServiceRoleClient } from "@/lib/supabase"

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD
const CLIENT_EMAIL = process.env.E2E_CLIENT_EMAIL
const CLIENT_PASSWORD = process.env.E2E_CLIENT_PASSWORD

test.describe("Form review voice messages", () => {
  test.skip(
    !ADMIN_EMAIL || !ADMIN_PASSWORD || !CLIENT_EMAIL || !CLIENT_PASSWORD,
    "Requires E2E_ADMIN_EMAIL/PASSWORD and E2E_CLIENT_EMAIL/PASSWORD",
  )

  // Voice recording needs fake media stream flags — Chromium only.
  test.skip(({ browserName }) => browserName !== "chromium", "Voice recording requires Chromium fake-media-stream flags")

  let reviewId: string

  test.beforeAll(async () => {
    const supabase = createServiceRoleClient()

    // Find the client user
    const { data: clientUser } = await supabase
      .from("users")
      .select("id")
      .eq("email", CLIENT_EMAIL!)
      .single()

    if (!clientUser) throw new Error(`E2E client user ${CLIENT_EMAIL} not found in DB`)

    // Find any exercise to attach the review to
    const { data: exercise } = await supabase.from("exercises").select("id").limit(1).single()
    if (!exercise) throw new Error("No exercises in DB to seed form review with")

    // Create a seeded form review owned by the client. video_path can be a stub.
    const { data: review, error } = await supabase
      .from("form_reviews")
      .insert({
        client_user_id: clientUser.id,
        exercise_id: exercise.id,
        video_path: `form-reviews/${clientUser.id}/e2e-stub.mp4`,
        title: `E2E voice test ${Date.now()}`,
        status: "pending",
      })
      .select("id")
      .single()
    if (error || !review) throw new Error(`Failed to seed form review: ${error?.message}`)
    reviewId = review.id
  })

  test.afterAll(async () => {
    if (!reviewId) return
    const supabase = createServiceRoleClient()
    // Cascades will clean up messages + attachments
    await supabase.from("form_reviews").delete().eq("id", reviewId)
  })

  test("admin records a voice message; client sees it in their thread", async ({ browser }) => {
    // --- admin records ---
    const adminCtx = await browser.newContext()
    const adminPage = await adminCtx.newPage()
    await adminPage.goto("/login")
    await adminPage.getByLabel(/email/i).fill(ADMIN_EMAIL!)
    await adminPage.getByLabel(/password/i).fill(ADMIN_PASSWORD!)
    await adminPage.getByRole("button", { name: /log in|sign in/i }).click()

    await adminPage.goto(`/admin/form-reviews/${reviewId}`)

    await adminPage.getByRole("button", { name: /record voice message/i }).click()
    await expect(adminPage.getByRole("button", { name: /stop recording/i })).toBeVisible({ timeout: 5000 })
    await adminPage.waitForTimeout(3000) // record 3s of fake audio
    await adminPage.getByRole("button", { name: /stop recording/i }).click()
    await expect(adminPage.getByRole("button", { name: /send voice message/i })).toBeVisible({ timeout: 5000 })
    await adminPage.getByRole("button", { name: /send voice message/i }).click()

    // Audio bubble appears in admin's view
    await expect(adminPage.locator("audio").last()).toBeVisible({ timeout: 15_000 })

    // --- client sees it ---
    const clientCtx = await browser.newContext()
    const clientPage = await clientCtx.newPage()
    await clientPage.goto("/login")
    await clientPage.getByLabel(/email/i).fill(CLIENT_EMAIL!)
    await clientPage.getByLabel(/password/i).fill(CLIENT_PASSWORD!)
    await clientPage.getByRole("button", { name: /log in|sign in/i }).click()

    await clientPage.goto(`/client/form-reviews/${reviewId}`)

    await expect(clientPage.locator("audio").last()).toBeVisible({ timeout: 15_000 })

    await adminCtx.close()
    await clientCtx.close()
  })
})
