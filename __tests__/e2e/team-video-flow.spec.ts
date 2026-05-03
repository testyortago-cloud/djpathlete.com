import { test, expect } from "@playwright/test"
import { createServiceRoleClient } from "@/lib/supabase"
import { existsSync } from "node:fs"
import { join } from "node:path"

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD
const EDITOR_EMAIL = process.env.E2E_EDITOR_EMAIL
const EDITOR_PASSWORD = process.env.E2E_EDITOR_PASSWORD
const FIXTURE_PATH = join(process.cwd(), "__tests__/fixtures/sample-video.mp4")

test.describe("Team video review flow", () => {
  test.skip(
    !ADMIN_EMAIL || !ADMIN_PASSWORD || !EDITOR_EMAIL || !EDITOR_PASSWORD || !existsSync(FIXTURE_PATH),
    "Requires E2E_ADMIN_EMAIL/PASSWORD, E2E_EDITOR_EMAIL/PASSWORD, and __tests__/fixtures/sample-video.mp4",
  )

  let submissionId: string

  test.afterAll(async () => {
    if (!submissionId) return
    const supabase = createServiceRoleClient()
    // Cascades will clean up versions, comments, annotations
    await supabase.from("team_video_submissions").delete().eq("id", submissionId)
  })

  test("editor uploads → admin reviews → approve → send to Content Studio", async ({ browser }) => {
    // EDITOR — upload
    const editorCtx = await browser.newContext()
    const editorPage = await editorCtx.newPage()
    await editorPage.goto("/login")
    await editorPage.getByLabel(/email/i).fill(EDITOR_EMAIL!)
    await editorPage.getByLabel(/password/i).fill(EDITOR_PASSWORD!)
    await editorPage.getByRole("button", { name: /log in/i }).click()
    await editorPage.waitForURL("**/editor")

    await editorPage.goto("/editor/upload")
    await editorPage.getByLabel(/title/i).fill(`E2E test video ${Date.now()}`)
    await editorPage.setInputFiles('input[type="file"]', FIXTURE_PATH)
    await editorPage.getByRole("button", { name: /submit for review/i }).click()
    await editorPage.waitForURL("**/editor/videos/**")

    // Capture the submission id from the URL
    const url = new URL(editorPage.url())
    submissionId = url.pathname.split("/").pop()!
    expect(submissionId).toBeTruthy()
    await editorCtx.close()

    // ADMIN — review + approve + send
    const adminCtx = await browser.newContext()
    const adminPage = await adminCtx.newPage()
    await adminPage.goto("/login")
    await adminPage.getByLabel(/email/i).fill(ADMIN_EMAIL!)
    await adminPage.getByLabel(/password/i).fill(ADMIN_PASSWORD!)
    await adminPage.getByRole("button", { name: /log in/i }).click()
    await adminPage.waitForURL("**/admin/**")

    await adminPage.goto(`/admin/team-videos/${submissionId}`)
    await expect(adminPage.getByRole("heading", { level: 1 })).toBeVisible()

    await adminPage.getByRole("button", { name: /^approve$/i }).click()
    await expect(adminPage.getByText(/Submission approved/i)).toBeVisible()

    await adminPage.getByRole("button", { name: /send to content studio/i }).click()
    await adminPage.waitForURL("**/admin/content**")
  })
})
