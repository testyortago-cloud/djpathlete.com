import { describe, expect, it } from "vitest"
import {
  videoColumnFor,
  videosByColumn,
  postColumnFor,
  postsByColumn,
  VIDEO_COLUMNS,
  POST_COLUMNS,
} from "@/lib/content-studio/pipeline-columns"
import type { SocialPost, VideoUpload } from "@/types/database"

const video = (id: string, o: Partial<VideoUpload> = {}): VideoUpload => ({
  id,
  storage_path: "p",
  original_filename: `${id}.mp4`,
  duration_seconds: 10,
  size_bytes: 100,
  mime_type: null,
  title: id,
  uploaded_by: null,
  status: "uploaded",
  created_at: "",
  updated_at: "",
  ...o,
})

const post = (id: string, o: Partial<SocialPost> = {}): SocialPost => ({
  id,
  platform: "instagram",
  content: "x",
  media_url: null,
  post_type: "text",
  approval_status: "draft",
  scheduled_at: null,
  published_at: null,
  source_video_id: null,
  rejection_notes: null,
  platform_post_id: null,
  created_by: null,
  created_at: "",
  updated_at: "",
  ...o,
})

describe("videoColumnFor", () => {
  it("maps status to column", () => {
    expect(videoColumnFor(video("v1", { status: "uploaded" }), [])).toBe("uploaded")
    expect(videoColumnFor(video("v1", { status: "transcribing" }), [])).toBe("transcribing")
    expect(videoColumnFor(video("v1", { status: "transcribed" }), [])).toBe("transcribed")
    expect(videoColumnFor(video("v1", { status: "analyzed" }), [])).toBe("transcribed")
    expect(videoColumnFor(video("v1", { status: "failed" }), [])).toBe("transcribing")
  })

  it("moves video to 'generated' when it has posts but none are published", () => {
    const v = video("v1", { status: "transcribed" })
    const posts = [post("p1", { source_video_id: "v1", approval_status: "approved" })]
    expect(videoColumnFor(v, posts)).toBe("generated")
  })

  it("moves video to 'complete' when ALL child posts are published", () => {
    const v = video("v1", { status: "analyzed" })
    const posts = [
      post("p1", { source_video_id: "v1", approval_status: "published" }),
      post("p2", { source_video_id: "v1", approval_status: "published" }),
    ]
    expect(videoColumnFor(v, posts)).toBe("complete")
  })
})

describe("videosByColumn", () => {
  it("groups videos by their derived column", () => {
    const vs = [video("v1", { status: "uploaded" }), video("v2", { status: "transcribing" })]
    const grouped = videosByColumn(vs, [])
    expect(grouped.uploaded.map((v) => v.id)).toEqual(["v1"])
    expect(grouped.transcribing.map((v) => v.id)).toEqual(["v2"])
  })

  it("returns empty arrays for columns with no matches", () => {
    const grouped = videosByColumn([], [])
    for (const col of VIDEO_COLUMNS) expect(grouped[col]).toEqual([])
  })
})

describe("postColumnFor", () => {
  it("maps approval_status to post columns", () => {
    expect(postColumnFor(post("p", { approval_status: "draft" }))).toBe("needs_review")
    expect(postColumnFor(post("p", { approval_status: "edited" }))).toBe("needs_review")
    expect(postColumnFor(post("p", { approval_status: "approved" }))).toBe("approved")
    expect(postColumnFor(post("p", { approval_status: "awaiting_connection" }))).toBe("approved")
    expect(postColumnFor(post("p", { approval_status: "scheduled" }))).toBe("scheduled")
    expect(postColumnFor(post("p", { approval_status: "published" }))).toBe("published")
    expect(postColumnFor(post("p", { approval_status: "failed" }))).toBe("failed")
    expect(postColumnFor(post("p", { approval_status: "rejected" }))).toBe(null)
  })
})

describe("postsByColumn", () => {
  it("excludes rejected posts by default", () => {
    const ps = [post("p1", { approval_status: "draft" }), post("p2", { approval_status: "rejected" })]
    const grouped = postsByColumn(ps)
    expect(grouped.needs_review.map((p) => p.id)).toEqual(["p1"])
    for (const col of POST_COLUMNS) {
      expect(grouped[col].find((p) => p.id === "p2")).toBeUndefined()
    }
  })
})
