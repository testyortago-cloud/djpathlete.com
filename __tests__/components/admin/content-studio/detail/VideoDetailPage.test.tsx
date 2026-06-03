import { render, screen } from "@testing-library/react"
import { describe, it, expect, vi } from "vitest"
import type { DrawerData } from "@/lib/content-studio/drawer-data"

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}))
vi.mock("@/components/admin/content-studio/detail/VideoDetailSidebar", () => ({
  VideoDetailSidebar: () => <div data-testid="sidebar" />,
}))
vi.mock("@/components/admin/content-studio/drawer/TranscriptTab", () => ({
  TranscriptTab: () => <div data-testid="transcript" />,
}))
vi.mock("@/components/admin/content-studio/drawer/PostsTab", () => ({
  PostsTab: () => <div data-testid="posts" />,
}))
vi.mock("@/components/admin/content-studio/drawer/MetaTab", () => ({
  MetaTab: () => <div data-testid="meta" />,
}))
vi.mock("@/components/admin/content-studio/drawer/MarkReadyButton", () => ({
  MarkReadyButton: ({ needsEdit }: { needsEdit: boolean }) =>
    needsEdit ? <button type="button">Mark as ready</button> : null,
}))

import { VideoDetailPage } from "@/components/admin/content-studio/detail/VideoDetailPage"

const data: DrawerData = {
  mode: "video",
  video: {
    id: "v1",
    storage_path: "p.mp4",
    original_filename: "p.mp4",
    duration_seconds: 10,
    size_bytes: 1000,
    mime_type: "video/mp4",
    title: "My Clip",
    uploaded_by: null,
    status: "transcribed",
    needs_edit: true,
    created_at: "2026-05-31T00:00:00Z",
    updated_at: "2026-05-31T00:00:00Z",
  },
  previewUrl: "https://example/p.mp4",
  transcript: null,
  posts: [],
  mediaByPost: {},
  highlightPostId: null,
  splitReelEnabled: false,
}

describe("<VideoDetailPage>", () => {
  it("renders the title, a back link, and all four sections", () => {
    render(<VideoDetailPage data={data} backHref="/admin/content?tab=videos" backLabel="Videos" highlightPostId={null} />)
    expect(screen.getByRole("heading", { name: "My Clip" })).toBeInTheDocument()
    expect(screen.getByRole("link", { name: /Videos/ })).toHaveAttribute("href", "/admin/content?tab=videos")
    expect(screen.getByTestId("sidebar")).toBeInTheDocument()
    expect(screen.getByTestId("transcript")).toBeInTheDocument()
    expect(screen.getByTestId("posts")).toBeInTheDocument()
    expect(screen.getByTestId("meta")).toBeInTheDocument()
  })

  it("shows the posts count from data.posts", () => {
    const three = [data, data, data].map((_, i) => ({ id: `p${i}` })) as never[]
    render(
      <VideoDetailPage
        data={{ ...data, posts: three }}
        backHref="/admin/content"
        backLabel="Pipeline"
        highlightPostId={null}
      />,
    )
    expect(screen.getByText(/Posts \(3\)/)).toBeInTheDocument()
  })

  it("shows Mark as ready only while the video needs editing", () => {
    const { rerender } = render(
      <VideoDetailPage data={data} backHref="/admin/content" backLabel="Pipeline" highlightPostId={null} />,
    )
    expect(screen.getByRole("button", { name: /mark as ready/i })).toBeInTheDocument()
    rerender(
      <VideoDetailPage
        data={{ ...data, video: { ...data.video!, needs_edit: false } }}
        backHref="/admin/content"
        backLabel="Pipeline"
        highlightPostId={null}
      />,
    )
    expect(screen.queryByRole("button", { name: /mark as ready/i })).toBeNull()
  })
})
