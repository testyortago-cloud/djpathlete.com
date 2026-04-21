import { describe, expect, it } from "vitest"
import {
  parseFilters,
  filtersToSearchParams,
  applyFilters,
  type PipelineFilters,
} from "@/lib/content-studio/pipeline-filters"
import type { SocialPost, VideoUpload } from "@/types/database"

const video = (id: string, overrides: Partial<VideoUpload> = {}): VideoUpload => ({
  id,
  storage_path: `u/${id}.mp4`,
  original_filename: `${id}.mp4`,
  duration_seconds: 10,
  size_bytes: 100,
  mime_type: "video/mp4",
  title: id,
  uploaded_by: null,
  status: "transcribed",
  created_at: "2026-04-15T12:00:00Z",
  updated_at: "2026-04-15T12:00:00Z",
  ...overrides,
})

const post = (id: string, overrides: Partial<SocialPost> = {}): SocialPost => ({
  id,
  platform: "instagram",
  content: "x",
  media_url: null,
  approval_status: "draft",
  scheduled_at: null,
  published_at: null,
  source_video_id: "v1",
  rejection_notes: null,
  platform_post_id: null,
  created_by: "u",
  created_at: "2026-04-15T12:00:00Z",
  updated_at: "2026-04-15T12:00:00Z",
  ...overrides,
})

describe("parseFilters", () => {
  it("returns empty filters when nothing is set", () => {
    expect(parseFilters(new URLSearchParams(""))).toEqual({
      platforms: [],
      statuses: [],
      from: null,
      to: null,
      sourceVideoId: null,
    })
  })

  it("splits comma-separated platform and status lists", () => {
    const f = parseFilters(new URLSearchParams("platform=instagram,tiktok&status=approved,scheduled"))
    expect(f.platforms).toEqual(["instagram", "tiktok"])
    expect(f.statuses).toEqual(["approved", "scheduled"])
  })

  it("drops unknown platform and status tokens", () => {
    const f = parseFilters(new URLSearchParams("platform=instagram,nope&status=approved,bogus"))
    expect(f.platforms).toEqual(["instagram"])
    expect(f.statuses).toEqual(["approved"])
  })

  it("parses from/to ISO dates", () => {
    const f = parseFilters(new URLSearchParams("from=2026-04-01&to=2026-04-30"))
    expect(f.from).toBe("2026-04-01")
    expect(f.to).toBe("2026-04-30")
  })

  it("parses sourceVideoId", () => {
    const f = parseFilters(new URLSearchParams("sourceVideo=video-abc"))
    expect(f.sourceVideoId).toBe("video-abc")
  })
})

describe("filtersToSearchParams", () => {
  it("round-trips a full filter set", () => {
    const f: PipelineFilters = {
      platforms: ["instagram", "tiktok"],
      statuses: ["approved"],
      from: "2026-04-01",
      to: "2026-04-30",
      sourceVideoId: "video-1",
    }
    const sp = filtersToSearchParams(f)
    expect(sp.get("platform")).toBe("instagram,tiktok")
    expect(sp.get("status")).toBe("approved")
    expect(sp.get("from")).toBe("2026-04-01")
    expect(sp.get("to")).toBe("2026-04-30")
    expect(sp.get("sourceVideo")).toBe("video-1")
  })

  it("omits keys with empty values", () => {
    const f: PipelineFilters = {
      platforms: [],
      statuses: [],
      from: null,
      to: null,
      sourceVideoId: null,
    }
    const sp = filtersToSearchParams(f)
    expect(sp.toString()).toBe("")
  })
})

describe("applyFilters", () => {
  const posts: SocialPost[] = [
    post("p1", { platform: "instagram", approval_status: "approved", source_video_id: "v1" }),
    post("p2", {
      platform: "tiktok",
      approval_status: "scheduled",
      source_video_id: "v2",
      scheduled_at: "2026-04-20T10:00:00Z",
    }),
    post("p3", {
      platform: "facebook",
      approval_status: "published",
      source_video_id: "v1",
      published_at: "2026-04-01T10:00:00Z",
    }),
  ]
  const videos: VideoUpload[] = [video("v1"), video("v2")]

  it("filters posts by platform", () => {
    const { posts: filtered } = applyFilters(videos, posts, {
      platforms: ["instagram"],
      statuses: [],
      from: null,
      to: null,
      sourceVideoId: null,
    })
    expect(filtered.map((p) => p.id)).toEqual(["p1"])
  })

  it("filters posts by status", () => {
    const { posts: filtered } = applyFilters(videos, posts, {
      platforms: [],
      statuses: ["scheduled", "published"],
      from: null,
      to: null,
      sourceVideoId: null,
    })
    expect(filtered.map((p) => p.id).sort()).toEqual(["p2", "p3"])
  })

  it("filters posts by date range against scheduled_at OR published_at OR created_at", () => {
    const { posts: filtered } = applyFilters(videos, posts, {
      platforms: [],
      statuses: [],
      from: "2026-04-15",
      to: "2026-04-21",
      sourceVideoId: null,
    })
    expect(filtered.map((p) => p.id).sort()).toEqual(["p1", "p2"])
  })

  it("filters posts by sourceVideoId", () => {
    const { posts: filtered } = applyFilters(videos, posts, {
      platforms: [],
      statuses: [],
      from: null,
      to: null,
      sourceVideoId: "v2",
    })
    expect(filtered.map((p) => p.id)).toEqual(["p2"])
  })

  it("filters videos to only those whose child posts pass the filter", () => {
    const { videos: filtered } = applyFilters(videos, posts, {
      platforms: ["tiktok"],
      statuses: [],
      from: null,
      to: null,
      sourceVideoId: null,
    })
    expect(filtered.map((v) => v.id)).toEqual(["v2"])
  })

  it("when no filters are set, returns everything", () => {
    const out = applyFilters(videos, posts, {
      platforms: [],
      statuses: [],
      from: null,
      to: null,
      sourceVideoId: null,
    })
    expect(out.videos.length).toBe(2)
    expect(out.posts.length).toBe(3)
  })
})
