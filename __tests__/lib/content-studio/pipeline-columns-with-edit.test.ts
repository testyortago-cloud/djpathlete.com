import { describe, expect, it } from "vitest"
import {
  videoColumnForWithEdit,
  videosByColumnWithEdit,
  VIDEO_COLUMNS_WITH_EDIT,
  type VideoEditSignals,
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
  status: "transcribed",
  needs_edit: true,
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

const sig = (o: Partial<VideoEditSignals> = {}): VideoEditSignals => ({
  hasCut: false,
  isRendering: false,
  ...o,
})

describe("videoColumnForWithEdit", () => {
  it("keeps the pre-edit statuses", () => {
    expect(videoColumnForWithEdit(video("v", { status: "uploaded" }), [], sig())).toBe("uploaded")
    expect(videoColumnForWithEdit(video("v", { status: "transcribing" }), [], sig())).toBe("transcribing")
    expect(videoColumnForWithEdit(video("v", { status: "failed" }), [], sig())).toBe("transcribing")
  })

  it("routes a gated transcribed video with no cut/render to needs_edit", () => {
    expect(videoColumnForWithEdit(video("v", { status: "transcribed", needs_edit: true }), [], sig())).toBe(
      "needs_edit",
    )
    expect(videoColumnForWithEdit(video("v", { status: "analyzed", needs_edit: true }), [], sig())).toBe("needs_edit")
  })

  it("routes to rendering when a render is in flight (even if a cut already exists)", () => {
    expect(videoColumnForWithEdit(video("v", { status: "transcribed" }), [], sig({ isRendering: true }))).toBe(
      "rendering",
    )
    expect(
      videoColumnForWithEdit(video("v", { status: "transcribed" }), [], sig({ isRendering: true, hasCut: true })),
    ).toBe("rendering")
  })

  it("routes to needs_edit when hasCut=true but needs_edit still true (cut no longer unblocks)", () => {
    expect(
      videoColumnForWithEdit(video("v", { status: "transcribed", needs_edit: true }), [], sig({ hasCut: true })),
    ).toBe("needs_edit")
  })

  it("routes to edited when marked ready (needs_edit=false) with no cut", () => {
    expect(videoColumnForWithEdit(video("v", { status: "transcribed", needs_edit: false }), [], sig())).toBe("edited")
  })

  it("keeps a gated video in needs_edit even after caption posts are generated", () => {
    // Auto-fanout drafts caption posts the moment transcription finishes, but a
    // video that still needs a cut must stay in needs_edit — not skip to
    // generated — so the cut actually gets rendered.
    const v = video("v1", { status: "transcribed", needs_edit: true })
    expect(videoColumnForWithEdit(v, [post("p", { source_video_id: "v1", approval_status: "draft" })], sig())).toBe(
      "needs_edit",
    )
    expect(videoColumnForWithEdit(v, [post("p", { source_video_id: "v1", approval_status: "approved" })], sig())).toBe(
      "needs_edit",
    )
  })

  it("uses post state for generated/complete once the video is postable", () => {
    // Marked ready (needs_edit=false) → the edit gate is cleared and post state
    // drives the column.
    const ready = video("v1", { status: "transcribed", needs_edit: false })
    expect(
      videoColumnForWithEdit(ready, [post("p", { source_video_id: "v1", approval_status: "approved" })], sig()),
    ).toBe("generated")
    // hasCut=true but needs_edit still true → stays in needs_edit (cut no longer unblocks).
    expect(
      videoColumnForWithEdit(
        video("v1", { status: "transcribed", needs_edit: true }),
        [post("p", { source_video_id: "v1", approval_status: "approved" })],
        sig({ hasCut: true }),
      ),
    ).toBe("needs_edit")
    // All posts published → complete, regardless of the edit gate (content shipped).
    expect(
      videoColumnForWithEdit(
        video("v1", { status: "transcribed" }),
        [post("p", { source_video_id: "v1", approval_status: "published" })],
        sig(),
      ),
    ).toBe("complete")
  })

  it("routes to rendering when a render is in flight even if posts already exist (re-render)", () => {
    const v = video("v1", { status: "transcribed" })
    // A video that already generated posts (so would otherwise be "generated"/
    // "complete") but is now re-rendering a captioned cut must surface in the
    // Rendering column — an in-flight render wins over post state.
    expect(
      videoColumnForWithEdit(v, [post("p", { source_video_id: "v1", approval_status: "approved" })], sig({ isRendering: true })),
    ).toBe("rendering")
    expect(
      videoColumnForWithEdit(v, [post("p", { source_video_id: "v1", approval_status: "published" })], sig({ isRendering: true })),
    ).toBe("rendering")
  })
})

describe("videosByColumnWithEdit", () => {
  it("groups by derived edit column using per-video signals", () => {
    const vs = [
      video("v1", { status: "transcribed", needs_edit: true }),
      video("v2", { status: "transcribed" }),
      video("v3", { status: "transcribed", needs_edit: false }),
    ]
    const grouped = videosByColumnWithEdit(vs, [], {
      cutVideoIds: new Set<string>(),
      renderingVideoIds: new Set<string>(["v2"]),
    })
    expect(grouped.needs_edit.map((v) => v.id)).toEqual(["v1"])
    expect(grouped.rendering.map((v) => v.id)).toEqual(["v2"])
    expect(grouped.edited.map((v) => v.id)).toEqual(["v3"])
  })

  it("returns an empty array for every column when given no videos", () => {
    const grouped = videosByColumnWithEdit([], [], { cutVideoIds: new Set(), renderingVideoIds: new Set() })
    for (const col of VIDEO_COLUMNS_WITH_EDIT) expect(grouped[col]).toEqual([])
  })
})
