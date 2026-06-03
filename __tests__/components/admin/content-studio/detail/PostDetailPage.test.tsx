import { render, screen } from "@testing-library/react"
import { describe, it, expect, vi } from "vitest"
import type { DrawerData } from "@/lib/content-studio/drawer-data"

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}))
vi.mock("@/components/admin/content-studio/drawer/PostsTab", () => ({
  PostsTab: () => <div data-testid="posts" />,
}))
vi.mock("@/components/admin/content-studio/drawer/MetaTab", () => ({
  MetaTab: () => <div data-testid="meta" />,
}))

import { PostDetailPage } from "@/components/admin/content-studio/detail/PostDetailPage"

const data: DrawerData = {
  mode: "post-only",
  video: null,
  previewUrl: null,
  transcript: null,
  posts: [
    {
      id: "p1",
      platform: "instagram",
      content: "manual",
      media_url: null,
      post_type: "text",
      approval_status: "draft",
      scheduled_at: null,
      published_at: null,
      source_video_id: null,
      rejection_notes: null,
      platform_post_id: null,
      created_by: "u",
      created_at: "2026-05-31T00:00:00Z",
      updated_at: "2026-05-31T00:00:00Z",
    },
  ],
  mediaByPost: {},
  highlightPostId: "p1",
  splitReelEnabled: false,
}

describe("<PostDetailPage>", () => {
  it("renders the Manual post title, back link, posts, and meta — no transcript", () => {
    render(<PostDetailPage data={data} backHref="/admin/content?tab=posts" backLabel="Posts" />)
    expect(screen.getByRole("heading", { name: /Manual post/i })).toBeInTheDocument()
    expect(screen.getByRole("link", { name: /Posts/ })).toHaveAttribute("href", "/admin/content?tab=posts")
    expect(screen.getByTestId("posts")).toBeInTheDocument()
    expect(screen.getByTestId("meta")).toBeInTheDocument()
    expect(screen.queryByTestId("transcript")).toBeNull()
  })
})
