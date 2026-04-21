import { describe, expect, it } from "vitest"
import { render, screen } from "@testing-library/react"
import { VideosList } from "@/components/admin/content-studio/list/VideosList"
import type { VideoUpload } from "@/types/database"

const vids: VideoUpload[] = [
  {
    id: "v1",
    storage_path: "",
    original_filename: "a.mp4",
    duration_seconds: 60,
    size_bytes: 1_000_000,
    mime_type: null,
    title: "Alpha",
    uploaded_by: null,
    status: "transcribed",
    created_at: "2026-04-10T10:00:00Z",
    updated_at: "",
  },
  {
    id: "v2",
    storage_path: "",
    original_filename: "b.mp4",
    duration_seconds: 90,
    size_bytes: 2_000_000,
    mime_type: null,
    title: "Beta",
    uploaded_by: null,
    status: "uploaded",
    created_at: "2026-04-12T10:00:00Z",
    updated_at: "",
  },
]

describe("<VideosList>", () => {
  it("renders a table with all videos", () => {
    render(<VideosList videos={vids} />)
    expect(screen.getByText(/Alpha/)).toBeInTheDocument()
    expect(screen.getByText(/Beta/)).toBeInTheDocument()
  })

  it("each row links to the drawer", () => {
    render(<VideosList videos={vids} />)
    expect(screen.getByRole("link", { name: /Alpha/ })).toHaveAttribute(
      "href",
      "/admin/content/v1",
    )
  })

  it("renders an empty state when no videos", () => {
    render(<VideosList videos={[]} />)
    expect(screen.getByText(/no videos yet/i)).toBeInTheDocument()
  })
})
