import { describe, expect, it } from "vitest"
import { render, screen } from "@testing-library/react"
import { PostsList } from "@/components/admin/content-studio/list/PostsList"
import type { PipelinePostRow } from "@/lib/db/social-posts"

const posts: PipelinePostRow[] = [
  {
    id: "p1",
    platform: "instagram",
    content: "caption one",
    media_url: null,
    approval_status: "approved",
    scheduled_at: null,
    published_at: null,
    source_video_id: "v1",
    source_video_filename: "a.mp4",
    rejection_notes: null,
    platform_post_id: null,
    created_by: null,
    created_at: "2026-04-15T00:00:00Z",
    updated_at: "",
  },
]

describe("<PostsList>", () => {
  it("renders a table with all posts", () => {
    render(<PostsList posts={posts} />)
    expect(screen.getByText(/caption one/)).toBeInTheDocument()
    expect(screen.getByText(/a\.mp4/)).toBeInTheDocument()
  })

  it("rows link to the post-only drawer", () => {
    render(<PostsList posts={posts} />)
    expect(screen.getByRole("link", { name: /caption one/ })).toHaveAttribute(
      "href",
      "/admin/content/post/p1",
    )
  })

  it("renders an empty state when no posts", () => {
    render(<PostsList posts={[]} />)
    expect(screen.getByText(/no posts yet/i)).toBeInTheDocument()
  })
})
