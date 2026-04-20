// __tests__/db/video-uploads.test.ts
import { describe, it, expect, beforeEach, afterAll } from "vitest"
import {
  createVideoUpload,
  getVideoUploadById,
  listVideoUploads,
  updateVideoUploadStatus,
} from "@/lib/db/video-uploads"
import { saveTranscript, getTranscriptForVideo } from "@/lib/db/video-transcripts"
import { createServiceRoleClient } from "@/lib/supabase"

const TEST_TAG = "__TEST_VIDEO__"

describe("video-uploads + video-transcripts DAL", () => {
  const supabase = createServiceRoleClient()

  async function cleanup() {
    await supabase.from("video_uploads").delete().like("original_filename", `${TEST_TAG}%`)
  }

  beforeEach(cleanup)
  afterAll(cleanup)

  it("creates a video upload and transitions status", async () => {
    const created = await createVideoUpload({
      storage_path: `video-uploads/${TEST_TAG}a.mp4`,
      original_filename: `${TEST_TAG}a.mp4`,
      duration_seconds: 90,
      size_bytes: 1024,
      mime_type: "video/mp4",
      title: "Test Upload",
      uploaded_by: null,
      status: "uploaded",
    })
    expect(created.id).toBeTruthy()

    const updated = await updateVideoUploadStatus(created.id, "transcribing")
    expect(updated.status).toBe("transcribing")
  })

  it("saves and retrieves a transcript", async () => {
    const upload = await createVideoUpload({
      storage_path: `video-uploads/${TEST_TAG}b.mp4`,
      original_filename: `${TEST_TAG}b.mp4`,
      duration_seconds: null,
      size_bytes: null,
      mime_type: null,
      title: null,
      uploaded_by: null,
      status: "uploaded",
    })

    await saveTranscript({
      video_upload_id: upload.id,
      transcript_text: "Hello this is a test coaching video",
      language: "en",
      assemblyai_job_id: "aa_test_123",
      analysis: null,
    })

    const t = await getTranscriptForVideo(upload.id)
    expect(t?.transcript_text).toContain("coaching video")
    expect(t?.assemblyai_job_id).toBe("aa_test_123")
  })

  it("lists video uploads ordered by most recent", async () => {
    await createVideoUpload({
      storage_path: `video-uploads/${TEST_TAG}c1.mp4`,
      original_filename: `${TEST_TAG}c1.mp4`,
      duration_seconds: null,
      size_bytes: null,
      mime_type: null,
      title: null,
      uploaded_by: null,
      status: "uploaded",
    })
    const list = await listVideoUploads({ limit: 50 })
    expect(list.some((v) => v.original_filename === `${TEST_TAG}c1.mp4`)).toBe(true)
  })
})
