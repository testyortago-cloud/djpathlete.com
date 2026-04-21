import { describe, expect, it } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { PostsTab } from "@/components/admin/content-studio/drawer/PostsTab"
import type { SocialPost } from "@/types/database"

const basePost = (id: string, overrides: Partial<SocialPost> = {}): SocialPost => ({
  id,
  platform: "instagram",
  content: `Caption for ${id}.`,
  media_url: null,
  approval_status: "draft",
  scheduled_at: null,
  published_at: null,
  source_video_id: "video-1",
  rejection_notes: null,
  platform_post_id: null,
  created_by: "u",
  created_at: "2026-04-15T00:00:00Z",
  updated_at: "2026-04-15T00:00:00Z",
  ...overrides,
})

describe("<PostsTab>", () => {
  it("renders all posts", () => {
    render(<PostsTab posts={[basePost("p1"), basePost("p2")]} initialExpandedPostId={null} />)
    expect(screen.getByText(/Caption for p1/)).toBeInTheDocument()
    expect(screen.getByText(/Caption for p2/)).toBeInTheDocument()
  })

  it("pre-expands the initialExpandedPostId row", () => {
    render(<PostsTab posts={[basePost("p1"), basePost("p2")]} initialExpandedPostId="p2" />)
    expect(screen.getByRole("textbox", { name: /caption/i })).toBeInTheDocument()
    expect(screen.getAllByRole("textbox", { name: /caption/i })).toHaveLength(1)
  })

  it("clicking a collapsed row header expands it", () => {
    render(<PostsTab posts={[basePost("p1")]} initialExpandedPostId={null} />)
    expect(screen.queryByRole("textbox", { name: /caption/i })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: /expand/i }))
    expect(screen.getByRole("textbox", { name: /caption/i })).toBeInTheDocument()
  })

  it("renders an empty state when there are no posts", () => {
    render(<PostsTab posts={[]} initialExpandedPostId={null} />)
    expect(screen.getByText(/No posts generated yet/i)).toBeInTheDocument()
  })
})
