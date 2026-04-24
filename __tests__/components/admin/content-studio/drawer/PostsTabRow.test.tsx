import { describe, expect, it, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { PostsTabRow } from "@/components/admin/content-studio/drawer/PostsTabRow"
import type { SocialPost } from "@/types/database"

function makePost(overrides: Partial<SocialPost> = {}): SocialPost {
  return {
    id: "post-1",
    platform: "instagram",
    content: "Morning rotation check-in.",
    media_url: null,
    post_type: "video",
    approval_status: "draft",
    scheduled_at: null,
    published_at: null,
    source_video_id: "video-1",
    rejection_notes: null,
    platform_post_id: null,
    created_by: "user-1",
    created_at: "2026-04-15T12:10:00Z",
    updated_at: "2026-04-15T12:10:00Z",
    ...overrides,
  }
}

describe("<PostsTabRow>", () => {
  it("shows platform label, status pill, and caption preview when collapsed", () => {
    render(<PostsTabRow post={makePost()} isExpanded={false} onToggle={vi.fn()} onMutate={vi.fn()} />)
    expect(screen.getByText(/Instagram/)).toBeInTheDocument()
    expect(screen.getByText(/needs review/i)).toBeInTheDocument()
    expect(screen.getByText(/Morning rotation check-in/)).toBeInTheDocument()
  })

  it("clicking the row header calls onToggle", () => {
    const onToggle = vi.fn()
    render(<PostsTabRow post={makePost()} isExpanded={false} onToggle={onToggle} onMutate={vi.fn()} />)
    fireEvent.click(screen.getByRole("button", { name: /expand/i }))
    expect(onToggle).toHaveBeenCalledWith("post-1")
  })

  it("when expanded, shows the edit textarea and action buttons", () => {
    render(<PostsTabRow post={makePost()} isExpanded={true} onToggle={vi.fn()} onMutate={vi.fn()} />)
    expect(screen.getByRole("textbox", { name: /caption/i })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /approve/i })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /schedule/i })).toBeInTheDocument()
  })

  it("for failed posts, surfaces the rejection note", () => {
    render(
      <PostsTabRow
        post={makePost({ approval_status: "failed", rejection_notes: "Facebook API 403" })}
        isExpanded={true}
        onToggle={vi.fn()}
        onMutate={vi.fn()}
      />,
    )
    expect(screen.getByText(/Facebook API 403/)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument()
  })

  it("published posts lock the edit UI and hide approve/schedule", () => {
    render(
      <PostsTabRow
        post={makePost({ approval_status: "published", published_at: "2026-04-16T08:00:00Z" })}
        isExpanded={true}
        onToggle={vi.fn()}
        onMutate={vi.fn()}
      />,
    )
    expect(screen.queryByRole("button", { name: /approve/i })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /schedule/i })).not.toBeInTheDocument()
    // "Published [timestamp]" appears in the row footer when the post is published
    expect(screen.getByText(/Published\s+\d/)).toBeInTheDocument()
  })
})
