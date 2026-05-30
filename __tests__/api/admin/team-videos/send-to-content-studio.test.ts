import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/db/team-video-submissions", () => ({
  getSubmissionById: vi.fn(),
  lockSubmission: vi.fn(),
}))
vi.mock("@/lib/db/team-video-versions", () => ({
  getCurrentVersion: vi.fn(),
}))
vi.mock("@/lib/db/video-uploads", () => ({
  getVideoUploadById: vi.fn(),
}))
vi.mock("@/lib/content-studio/promote-submission", () => ({
  resolveVideoUploadForSubmission: vi.fn(),
}))
vi.mock("@/lib/db/team-submission-images", () => ({
  listImagesForVersion: vi.fn(),
}))
vi.mock("@/lib/db/media-assets", () => ({
  createMediaAsset: vi.fn(),
}))
vi.mock("@/lib/db/social-posts", () => ({
  createSocialPost: vi.fn(),
}))
vi.mock("@/lib/db/social-post-media", () => ({
  attachMedia: vi.fn(),
}))
vi.mock("@/lib/db/platform-connections", () => ({
  listPlatformConnections: vi.fn(),
}))
// Self-contained mocks (no `async orig()` real-module load) so this file is
// hermetic and can't pick up a polluted module resolution when run alongside
// other suites that mock the same modules. The route only uses these exports.
vi.mock("@/lib/storage/team-videos", () => ({
  copyImageToMediaAssetsBucket: vi.fn(),
}))
vi.mock("@/lib/ai-jobs", () => ({
  createAiJob: vi.fn(),
}))

import { auth } from "@/lib/auth"
import { getSubmissionById, lockSubmission } from "@/lib/db/team-video-submissions"
import { getCurrentVersion } from "@/lib/db/team-video-versions"
import { getVideoUploadById } from "@/lib/db/video-uploads"
import { resolveVideoUploadForSubmission } from "@/lib/content-studio/promote-submission"
import { listImagesForVersion } from "@/lib/db/team-submission-images"
import { createMediaAsset } from "@/lib/db/media-assets"
import { createSocialPost } from "@/lib/db/social-posts"
import { attachMedia } from "@/lib/db/social-post-media"
import { listPlatformConnections } from "@/lib/db/platform-connections"
import { copyImageToMediaAssetsBucket } from "@/lib/storage/team-videos"
import { createAiJob } from "@/lib/ai-jobs"
import { POST } from "@/app/api/admin/team-videos/[id]/send-to-content-studio/route"

beforeEach(() => vi.clearAllMocks())

const params = Promise.resolve({ id: "sub1" })
const post = () =>
  new Request("http://localhost/api/admin/team-videos/sub1/send-to-content-studio", {
    method: "POST",
  })

describe("POST send-to-content-studio", () => {
  it("403 for non-admin", async () => {
    ;(auth as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: "u1", role: "editor" },
    })
    const res = await POST(post(), { params })
    expect(res.status).toBe(403)
  })
  it("404 if submission missing", async () => {
    ;(auth as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: "u1", role: "admin" },
    })
    ;(getSubmissionById as ReturnType<typeof vi.fn>).mockResolvedValue(null)
    const res = await POST(post(), { params })
    expect(res.status).toBe(404)
  })
  it("409 if not approved", async () => {
    ;(auth as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: "u1", role: "admin" },
    })
    ;(getSubmissionById as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "sub1", status: "in_review", title: "T",
    })
    const res = await POST(post(), { params })
    expect(res.status).toBe(409)
  })
  it("promotes a video submission via the shared promote-or-reuse helper", async () => {
    ;(auth as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: "admin1", role: "admin" },
    })
    ;(getSubmissionById as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "sub1", status: "approved", title: "Squat", kind: "video",
    })
    ;(getCurrentVersion as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "v1", storage_path: "team-videos/sub1/v1/squat.mp4",
      original_filename: "squat.mp4", duration_seconds: 120,
      size_bytes: 1024, mime_type: "video/mp4",
    })
    ;(resolveVideoUploadForSubmission as ReturnType<typeof vi.fn>).mockResolvedValue({
      videoUploadId: "vu1", transcribed: false,
    })
    ;(getVideoUploadById as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "vu1" })

    const res = await POST(post(), { params })
    expect(res.status).toBe(201)
    const json = await res.json()
    expect(json.videoUpload.id).toBe("vu1")
    // The route delegates row-creation + lock + transcription-queue to the shared
    // helper (unit-tested separately in promote-submission.test.ts).
    expect(resolveVideoUploadForSubmission).toHaveBeenCalledWith("sub1", "admin1")
  })
})

// --- image_set branch -------------------------------------------------

describe("send-to-content-studio image_set branch", () => {
  beforeEach(() => vi.clearAllMocks())

  it("creates media_assets + per-platform draft posts + caption jobs", async () => {
    ;(auth as ReturnType<typeof vi.fn>).mockResolvedValue({ user: { id: "admin1", role: "admin" } })
    ;(getSubmissionById as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "sub1", status: "approved", title: "Coaching", kind: "image_set",
    })
    ;(getCurrentVersion as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "v1" })
    ;(listImagesForVersion as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: "img1", position: 0, storage_path: "team-videos/sub1/v1/0_a.jpg", original_filename: "a.jpg", mime_type: "image/jpeg", size_bytes: 1000, width: 1080, height: 1080 },
      { id: "img2", position: 1, storage_path: "team-videos/sub1/v1/1_b.jpg", original_filename: "b.jpg", mime_type: "image/jpeg", size_bytes: 1000, width: 1080, height: 1080 },
    ])
    ;(copyImageToMediaAssetsBucket as ReturnType<typeof vi.fn>).mockImplementation(async ({ position }: { position: number }) => ({
      storagePath: `images/sub1/${position}_x.jpg`,
      publicUrl: `images/sub1/${position}_x.jpg`,
    }))
    ;(createMediaAsset as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ id: "ma1" })
      .mockResolvedValueOnce({ id: "ma2" })
    ;(listPlatformConnections as ReturnType<typeof vi.fn>).mockResolvedValue([
      { plugin_name: "instagram" }, { plugin_name: "facebook" },
    ])
    ;(createSocialPost as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ id: "post-ig" })
      .mockResolvedValueOnce({ id: "post-fb" })
    ;(createAiJob as ReturnType<typeof vi.fn>).mockResolvedValue({ jobId: "j1", status: "pending" })

    const res = await POST(post(), { params })
    expect(res.status).toBe(201)
    const json = await res.json()
    expect(json.kind).toBe("image_set")
    expect(json.mediaAssetIds).toEqual(["ma1", "ma2"])
    expect(json.socialPostIds).toEqual(["post-ig", "post-fb"])

    // Carousel post type because 2 images
    expect(createSocialPost).toHaveBeenCalledWith(
      expect.objectContaining({ platform: "instagram", post_type: "carousel", approval_status: "draft" }),
    )
    // 2 assets × 2 platforms = 4 attachments
    expect(attachMedia).toHaveBeenCalledTimes(4)
    // One caption job per platform
    expect(createAiJob).toHaveBeenCalledTimes(2)
    expect(createAiJob).toHaveBeenCalledWith(expect.objectContaining({
      type: "image_caption_generation",
      input: expect.objectContaining({ platform: "instagram", mediaAssetIds: ["ma1", "ma2"] }),
    }))
    expect(lockSubmission).toHaveBeenCalledWith("sub1")
  })

  it("skips platforms that don't support image/carousel", async () => {
    ;(auth as ReturnType<typeof vi.fn>).mockResolvedValue({ user: { id: "admin1", role: "admin" } })
    ;(getSubmissionById as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "sub1", status: "approved", title: "T", kind: "image_set",
    })
    ;(getCurrentVersion as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "v1" })
    ;(listImagesForVersion as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: "img1", position: 0, storage_path: "p0", original_filename: "a.jpg", mime_type: "image/jpeg", size_bytes: 1000 },
      { id: "img2", position: 1, storage_path: "p1", original_filename: "b.jpg", mime_type: "image/jpeg", size_bytes: 1000 },
    ])
    ;(copyImageToMediaAssetsBucket as ReturnType<typeof vi.fn>).mockResolvedValue({ storagePath: "x", publicUrl: "x" })
    ;(createMediaAsset as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "ma" })
    // YouTube doesn't support image at all.
    ;(listPlatformConnections as ReturnType<typeof vi.fn>).mockResolvedValue([
      { plugin_name: "instagram" }, { plugin_name: "youtube" },
    ])
    ;(createSocialPost as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "post-ig" })

    const res = await POST(post(), { params })
    expect(res.status).toBe(201)
    const json = await res.json()
    expect(json.socialPostIds).toEqual(["post-ig"])
  })
})
