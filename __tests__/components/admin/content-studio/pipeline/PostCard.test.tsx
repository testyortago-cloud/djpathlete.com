import { describe, expect, it, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { DndContext } from "@dnd-kit/core"
import { PostCard } from "@/components/admin/content-studio/pipeline/PostCard"
import type { PipelinePostRow } from "@/lib/db/social-posts"

function wrap(ui: React.ReactNode) {
  return <DndContext>{ui}</DndContext>
}

const post = (overrides: Partial<PipelinePostRow> = {}): PipelinePostRow => ({
  id: "p1",
  platform: "instagram",
  content: "Great caption body goes here for preview.",
  media_url: null,
  approval_status: "approved",
  scheduled_at: null,
  published_at: null,
  source_video_id: "v1",
  source_video_filename: "rotational-reboot.mp4",
  rejection_notes: null,
  platform_post_id: null,
  created_by: null,
  created_at: "2026-04-15T00:00:00Z",
  updated_at: "2026-04-15T00:00:00Z",
  ...overrides,
})

describe("<PostCard>", () => {
  it("renders platform icon + 2-line caption + source video filename", () => {
    render(wrap(<PostCard post={post()} selected={false} onToggleSelected={vi.fn()} />))
    expect(screen.getByText(/Great caption/)).toBeInTheDocument()
    expect(screen.getByText(/rotational-reboot\.mp4/)).toBeInTheDocument()
  })

  it("renders a scheduled-for line when scheduled_at is set", () => {
    render(
      wrap(
        <PostCard
          post={post({ approval_status: "scheduled", scheduled_at: "2026-04-20T10:00:00Z" })}
          selected={false}
          onToggleSelected={vi.fn()}
        />,
      ),
    )
    expect(screen.getByText(/Apr|2026|20/)).toBeInTheDocument()
  })

  it("selection checkbox toggles via callback", () => {
    const onToggle = vi.fn()
    render(wrap(<PostCard post={post()} selected={false} onToggleSelected={onToggle} />))
    fireEvent.click(screen.getByRole("checkbox"))
    expect(onToggle).toHaveBeenCalledWith("p1", true)
  })

  it("links header to /admin/content/post/[postId]", () => {
    render(wrap(<PostCard post={post()} selected={false} onToggleSelected={vi.fn()} />))
    expect(screen.getByRole("link")).toHaveAttribute("href", "/admin/content/post/p1")
  })

  it("renders a red border + retry hint when failed", () => {
    const { container } = render(
      wrap(
        <PostCard
          post={post({ approval_status: "failed", rejection_notes: "FB 500" })}
          selected={false}
          onToggleSelected={vi.fn()}
        />,
      ),
    )
    expect(container.firstChild).toHaveClass(/border-error/)
    expect(screen.getByText(/FB 500/)).toBeInTheDocument()
  })
})
