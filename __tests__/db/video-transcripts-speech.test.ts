// __tests__/db/video-transcripts-speech.test.ts
import { describe, it, expect, beforeEach, afterAll } from "vitest"
import { createVideoUpload } from "@/lib/db/video-uploads"
import { saveTranscript, getSpeechTranscriptForVideo } from "@/lib/db/video-transcripts"
import { createServiceRoleClient } from "@/lib/supabase"

const TAG = "__TEST_SPEECH_TX__"

describe("getSpeechTranscriptForVideo", () => {
  const supabase = createServiceRoleClient()
  const cleanup = () =>
    supabase.from("video_uploads").delete().like("original_filename", `${TAG}%`)
  beforeEach(cleanup)
  afterAll(cleanup)

  async function makeVideo(suffix: string) {
    return createVideoUpload({
      storage_path: `videos/${TAG}${suffix}.mp4`,
      original_filename: `${TAG}${suffix}.mp4`,
      duration_seconds: 30,
      size_bytes: 1024,
      mime_type: "video/mp4",
      title: null,
      uploaded_by: null,
      status: "transcribed",
    })
  }

  it("returns a speech transcript with an assemblyai id", async () => {
    const v = await makeVideo("a")
    await saveTranscript({
      video_upload_id: v.id,
      transcript_text: "hello athletes welcome back",
      language: "en",
      assemblyai_job_id: "aa_speech_1",
      analysis: null,
      source: "speech",
    })
    const t = await getSpeechTranscriptForVideo(v.id)
    expect(t?.assemblyai_job_id).toBe("aa_speech_1")
    expect(t?.source).toBe("speech")
  })

  it("returns null when only a vision transcript exists", async () => {
    const v = await makeVideo("b")
    await saveTranscript({
      video_upload_id: v.id,
      transcript_text: "a person performing a lift",
      language: "en",
      assemblyai_job_id: null,
      analysis: null,
      source: "vision",
    })
    expect(await getSpeechTranscriptForVideo(v.id)).toBeNull()
  })

  it("returns null when no transcript exists", async () => {
    const v = await makeVideo("c")
    expect(await getSpeechTranscriptForVideo(v.id)).toBeNull()
  })
})
