import { describe, expect, it, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { DrawerContent } from "@/components/admin/content-studio/drawer/DrawerContent"
import type { DrawerData } from "@/lib/content-studio/drawer-data"

const replaceMock = vi.fn()
vi.mock("next/navigation", async () => {
  const actual = await vi.importActual<typeof import("next/navigation")>("next/navigation")
  return {
    ...actual,
    useRouter: () => ({ push: vi.fn(), replace: replaceMock, back: vi.fn() }),
    useSearchParams: () => new URLSearchParams("drawerTab=posts"),
    usePathname: () => "/admin/content/video-1",
  }
})

const videoData: DrawerData = {
  mode: "video",
  video: {
    id: "video-1",
    storage_path: "p.mp4",
    original_filename: "p.mp4",
    duration_seconds: 10,
    size_bytes: 1000,
    mime_type: "video/mp4",
    title: "Test",
    uploaded_by: "u",
    status: "transcribed",
    created_at: "2026-04-15T00:00:00Z",
    updated_at: "2026-04-15T00:00:00Z",
  },
  previewUrl: "https://signed.example/video.mp4",
  transcript: null,
  posts: [],
  highlightPostId: null,
}

const postOnlyData: DrawerData = {
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
      created_at: "2026-04-15T00:00:00Z",
      updated_at: "2026-04-15T00:00:00Z",
    },
  ],
  highlightPostId: "p1",
}

describe("<DrawerContent>", () => {
  it("renders the video header when mode=video", () => {
    render(<DrawerContent data={videoData} defaultTab="transcript" />)
    expect(screen.getByRole("heading", { name: /Test/ })).toBeInTheDocument()
  })

  it("renders the post-only header when mode=post-only", () => {
    render(<DrawerContent data={postOnlyData} defaultTab="posts" />)
    expect(screen.getByText(/Manual post/i)).toBeInTheDocument()
  })

  it("shows the posts count in the tab label", () => {
    render(<DrawerContent data={{ ...videoData, posts: [postOnlyData.posts[0]] }} defaultTab="transcript" />)
    expect(screen.getByRole("tab", { name: /Posts \(1\)/ })).toBeInTheDocument()
  })

  it("clicking a tab updates the URL via router.replace", () => {
    replaceMock.mockClear()
    render(<DrawerContent data={videoData} defaultTab="transcript" />)
    fireEvent.click(screen.getByRole("tab", { name: /Meta/ }))
    expect(replaceMock).toHaveBeenCalledWith(expect.stringMatching(/drawerTab=meta/), { scroll: false })
  })
})
