import { describe, expect, it, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { DetailDrawer } from "@/components/admin/content-studio/DetailDrawer"
import type { DrawerData } from "@/lib/content-studio/drawer-data"

const pushMock = vi.fn()
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, replace: vi.fn(), back: vi.fn() }),
  usePathname: () => "/admin/content/abc-123",
  useSearchParams: () => new URLSearchParams(""),
}))

const data: DrawerData = {
  mode: "video",
  video: {
    id: "abc-123",
    storage_path: "p.mp4",
    original_filename: "p.mp4",
    duration_seconds: 10,
    size_bytes: 1000,
    mime_type: "video/mp4",
    title: "Abc",
    uploaded_by: null,
    status: "transcribed",
    created_at: "2026-04-15T00:00:00Z",
    updated_at: "2026-04-15T00:00:00Z",
  },
  previewUrl: "https://example/p.mp4",
  transcript: null,
  posts: [],
  highlightPostId: null,
}

describe("<DetailDrawer>", () => {
  it("renders the video title in the header", () => {
    render(<DetailDrawer data={data} defaultTab="transcript" closeHref="/admin/content" />)
    expect(screen.getByText(/Video · Abc/)).toBeInTheDocument()
  })

  it("renders the drawer dialog role", () => {
    render(<DetailDrawer data={data} defaultTab="transcript" closeHref="/admin/content" />)
    expect(screen.getByRole("dialog")).toBeInTheDocument()
  })

  it("navigates to closeHref when close is clicked", () => {
    pushMock.mockClear()
    render(<DetailDrawer data={data} defaultTab="transcript" closeHref="/admin/content?tab=videos" />)
    fireEvent.click(screen.getByRole("button", { name: /close drawer$/i }))
    expect(pushMock).toHaveBeenCalledWith("/admin/content?tab=videos")
  })
})
