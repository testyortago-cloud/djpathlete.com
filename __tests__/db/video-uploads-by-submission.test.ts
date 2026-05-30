// __tests__/db/video-uploads-by-submission.test.ts
import { describe, it, expect, beforeEach, afterAll } from "vitest"
import { createVideoUpload, getVideoUploadBySubmission } from "@/lib/db/video-uploads"
import { createServiceRoleClient } from "@/lib/supabase"

const TAG = "__TEST_VU_SUB__"

describe("getVideoUploadBySubmission", () => {
  const supabase = createServiceRoleClient()
  const cleanup = () =>
    supabase.from("video_uploads").delete().like("original_filename", `${TAG}%`)
  beforeEach(cleanup)
  afterAll(cleanup)

  it("returns null when no row references the submission", async () => {
    expect(
      await getVideoUploadBySubmission("00000000-0000-0000-0000-000000000000"),
    ).toBeNull()
  })

  it("does not return a row that has no source_submission_id", async () => {
    // A direct admin upload (source_submission_id null) must never be returned
    // by a by-submission lookup. We also pass an arbitrary uuid that no row
    // references, so the result is null. (The full create-with-real-submission
    // round-trip is covered by the route integration in M2 Task 4, where a real
    // team_video_submissions row exists to satisfy the FK.)
    await createVideoUpload({
      storage_path: `videos/${TAG}-unrelated.mp4`,
      original_filename: `${TAG}-unrelated.mp4`,
      duration_seconds: 10,
      size_bytes: 1,
      mime_type: "video/mp4",
      title: null,
      uploaded_by: null,
      status: "uploaded",
    })
    expect(
      await getVideoUploadBySubmission("11111111-1111-1111-8111-111111111111"),
    ).toBeNull()
  })
})
