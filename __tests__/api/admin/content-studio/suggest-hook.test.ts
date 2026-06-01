import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/db/system-settings", () => ({ getSetting: vi.fn() }))
vi.mock("@/lib/db/video-transcripts", () => ({ getSpeechTranscriptForVideo: vi.fn() }))
vi.mock("@/lib/ai/hook-suggestion", () => ({ suggestHookFromTranscript: vi.fn() }))

import { POST } from "@/app/api/admin/content-studio/captioned-cut/suggest-hook/route"
import { auth } from "@/lib/auth"
import { getSetting } from "@/lib/db/system-settings"
import { getSpeechTranscriptForVideo } from "@/lib/db/video-transcripts"
import { suggestHookFromTranscript } from "@/lib/ai/hook-suggestion"

const UUID = "11111111-1111-1111-1111-111111111111"
const admin = { user: { id: "admin-1", role: "admin" } }

function req(body: unknown) {
  return new Request("http://test/api/admin/content-studio/captioned-cut/suggest-hook", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(auth as ReturnType<typeof vi.fn>).mockResolvedValue(admin)
  ;(getSetting as ReturnType<typeof vi.fn>).mockResolvedValue(true)
  ;(getSpeechTranscriptForVideo as ReturnType<typeof vi.fn>).mockResolvedValue({
    transcript_text: "A transcript about cutting mechanics.",
  })
  ;(suggestHookFromTranscript as ReturnType<typeof vi.fn>).mockResolvedValue("5 Mistakes Athletes Make")
})

describe("POST /api/admin/content-studio/captioned-cut/suggest-hook", () => {
  it("401 for non-admin", async () => {
    ;(auth as ReturnType<typeof vi.fn>).mockResolvedValue(null)
    expect((await POST(req({ videoUploadId: UUID }))).status).toBe(401)
  })

  it("403 when the feature flag is off", async () => {
    ;(getSetting as ReturnType<typeof vi.fn>).mockResolvedValue(false)
    expect((await POST(req({ videoUploadId: UUID }))).status).toBe(403)
  })

  it("400 when videoUploadId is missing", async () => {
    expect((await POST(req({}))).status).toBe(400)
  })

  it("422 when there is no speech transcript", async () => {
    ;(getSpeechTranscriptForVideo as ReturnType<typeof vi.fn>).mockResolvedValue(null)
    expect((await POST(req({ videoUploadId: UUID }))).status).toBe(422)
  })

  it("200 with the suggested hook", async () => {
    const res = await POST(req({ videoUploadId: UUID }))
    expect(res.status).toBe(200)
    expect((await res.json()).hook).toBe("5 Mistakes Athletes Make")
    expect(suggestHookFromTranscript).toHaveBeenCalledWith("A transcript about cutting mechanics.")
  })

  it("200 with hook=null when the suggester can't produce one", async () => {
    ;(suggestHookFromTranscript as ReturnType<typeof vi.fn>).mockResolvedValue(null)
    const res = await POST(req({ videoUploadId: UUID }))
    expect(res.status).toBe(200)
    expect((await res.json()).hook).toBeNull()
  })
})
