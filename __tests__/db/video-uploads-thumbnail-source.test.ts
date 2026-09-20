import { describe, it, expect } from "vitest"
import type { VideoUpload, TeamVideoVersion, ThumbnailSource } from "@/types/database"

describe("thumbnail typing", () => {
  it("accepts a VideoUpload with no thumbnail_source (pre-existing rows)", () => {
    const row = {
      id: "v1",
      storage_path: "videos/a/clip.mp4",
      original_filename: "clip.mp4",
      duration_seconds: 42,
      size_bytes: 1000,
      mime_type: "video/mp4",
      title: null,
      uploaded_by: null,
      status: "uploaded",
      needs_edit: true,
      created_at: "2026-09-20T00:00:00Z",
      updated_at: "2026-09-20T00:00:00Z",
    } satisfies VideoUpload
    expect(row.id).toBe("v1")
  })

  it("accepts each ThumbnailSource value", () => {
    const sources: ThumbnailSource[] = ["auto", "frame", "upload"]
    expect(sources).toHaveLength(3)
  })

  it("allows a null thumbnail_path on a team video version", () => {
    const version = {
      id: "ver1",
      submission_id: "s1",
      version_number: 1,
      storage_path: "team/clip.mp4",
      original_filename: "clip.mp4",
      duration_seconds: null,
      size_bytes: null,
      mime_type: null,
      image_count: null,
      status: "uploaded",
      uploaded_at: null,
      thumbnail_path: null,
      created_at: "2026-09-20T00:00:00Z",
    } satisfies TeamVideoVersion
    expect(version.thumbnail_path).toBeNull()
  })
})
