import { describe, expect, it } from "vitest"
import { render, screen } from "@testing-library/react"
import { DndContext } from "@dnd-kit/core"
import { UnscheduledPanel } from "@/components/admin/content-studio/calendar/UnscheduledPanel"
import type { PipelinePostRow } from "@/lib/db/social-posts"

const post = (id: string, overrides: Partial<PipelinePostRow> = {}): PipelinePostRow => ({
  id,
  platform: "instagram",
  content: "caption",
  media_url: null,
  approval_status: "approved",
  scheduled_at: null,
  published_at: null,
  source_video_id: "v1",
  source_video_filename: "rotational-reboot.mp4",
  rejection_notes: null,
  platform_post_id: null,
  created_by: null,
  created_at: "",
  updated_at: "",
  ...overrides,
})

function wrap(ui: React.ReactNode) {
  return <DndContext>{ui}</DndContext>
}

describe("<UnscheduledPanel>", () => {
  it("groups posts by source_video_id with a filename header", () => {
    const posts = [
      post("a", { source_video_id: "v1", source_video_filename: "clip-a.mp4" }),
      post("b", { source_video_id: "v1", source_video_filename: "clip-a.mp4" }),
      post("c", { source_video_id: "v2", source_video_filename: "clip-b.mp4" }),
    ]
    render(wrap(<UnscheduledPanel posts={posts} />))
    expect(screen.getByText(/clip-a\.mp4/)).toBeInTheDocument()
    expect(screen.getByText(/clip-b\.mp4/)).toBeInTheDocument()
  })

  it("renders a manual-posts bucket for source_video_id=null", () => {
    const posts = [post("m", { source_video_id: null, source_video_filename: null })]
    render(wrap(<UnscheduledPanel posts={posts} />))
    expect(screen.getByText(/Manual posts/i)).toBeInTheDocument()
  })

  it("renders an empty state when no unscheduled posts", () => {
    render(wrap(<UnscheduledPanel posts={[]} />))
    expect(screen.getByText(/All caught up/i)).toBeInTheDocument()
  })
})
