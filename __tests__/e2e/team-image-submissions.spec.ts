import { test, expect } from "@playwright/test"
import { createServiceRoleClient } from "@/lib/supabase"
import { existsSync } from "node:fs"
import { join } from "node:path"

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD
const EDITOR_EMAIL = process.env.E2E_EDITOR_EMAIL
const EDITOR_PASSWORD = process.env.E2E_EDITOR_PASSWORD
const FIXTURES = [
  join(process.cwd(), "__tests__/fixtures/sample-1.jpg"),
  join(process.cwd(), "__tests__/fixtures/sample-2.jpg"),
  join(process.cwd(), "__tests__/fixtures/sample-3.jpg"),
]

test.describe("Team image submissions", () => {
  test.skip(
    !ADMIN_EMAIL ||
      !ADMIN_PASSWORD ||
      !EDITOR_EMAIL ||
      !EDITOR_PASSWORD ||
      FIXTURES.some((f) => !existsSync(f)),
    "Requires E2E_*_EMAIL/PASSWORD env + __tests__/fixtures/sample-1..3.jpg + NEXT_PUBLIC_TEAM_IMAGES_ENABLED=true",
  )

  let submissionId: string

  test.afterAll(async () => {
    if (!submissionId) return
    const supabase = createServiceRoleClient()
    // Cascades clean up versions, images, comments
    await supabase.from("team_video_submissions").delete().eq("id", submissionId)
  })

  test("editor submits photo set → admin reviews → approves → sends to Studio", async ({
    browser,
  }) => {
    // EDITOR: open dashboard, pick "New submission → Photos"
    const editorCtx = await browser.newContext()
    const editorPage = await editorCtx.newPage()
    await editorPage.goto("/login")
    await editorPage.getByLabel(/email/i).fill(EDITOR_EMAIL!)
    await editorPage.getByLabel(/password/i).fill(EDITOR_PASSWORD!)
    await editorPage.getByRole("button", { name: /log in/i }).click()
    await editorPage.waitForURL("**/editor/**")

    await editorPage.getByRole("button", { name: /New submission/i }).click()
    await editorPage.getByRole("button", { name: /^Photos$/i }).click()

    const title = `E2E photo set ${Date.now()}`
    await editorPage.getByLabel(/^Title$/i).fill(title)
    await editorPage.getByLabel(/Add photos/i).setInputFiles(FIXTURES)
    await editorPage.getByRole("button", { name: /^Submit$/i }).click()
    await expect(editorPage.getByText(/Photo set submitted/i)).toBeVisible({
      timeout: 30000,
    })
    await editorCtx.close()

    // Find the submission id from the DB so we can clean up after.
    const supabase = createServiceRoleClient()
    const { data } = await supabase
      .from("team_video_submissions")
      .select("id")
      .eq("title", title)
      .maybeSingle()
    submissionId = (data as { id: string } | null)?.id ?? ""
    expect(submissionId).toBeTruthy()

    // ADMIN: open the submission, comment pinned to image 2, approve, send.
    const adminCtx = await browser.newContext()
    const adminPage = await adminCtx.newPage()
    await adminPage.goto("/login")
    await adminPage.getByLabel(/email/i).fill(ADMIN_EMAIL!)
    await adminPage.getByLabel(/password/i).fill(ADMIN_PASSWORD!)
    await adminPage.getByRole("button", { name: /log in/i }).click()
    await adminPage.waitForURL("**/admin/**")

    await adminPage.goto(`/admin/team-media/${submissionId}`)
    await expect(adminPage.getByText(/1 of 3/i)).toBeVisible()
    await adminPage.keyboard.press("ArrowRight")
    await expect(adminPage.getByText(/2 of 3/i)).toBeVisible()

    // Carousel editor renders with placeholder "General comment on this carousel…"
    // until we pin to the current image (then it becomes "Comment on image 2…").
    await adminPage
      .getByPlaceholder(/General comment on this carousel/i)
      .fill("E2E pin")
    await adminPage.getByRole("button", { name: /Pin to current image/i }).click()
    await adminPage.getByRole("button", { name: /Post comment/i }).click()
    // The posted comment renders an "Image 2" pill linking to the pinned image.
    await expect(
      adminPage.getByRole("button", { name: /^Image 2$/i }),
    ).toBeVisible()

    await adminPage.getByRole("button", { name: /^Approve$/i }).click()
    await expect(adminPage.getByText(/Submission approved/i)).toBeVisible()

    await adminPage
      .getByRole("button", { name: /Send to Content Studio/i })
      .click()
    await expect(adminPage.getByText(/Sent to Content Studio/i)).toBeVisible({
      timeout: 30000,
    })
  })
})
