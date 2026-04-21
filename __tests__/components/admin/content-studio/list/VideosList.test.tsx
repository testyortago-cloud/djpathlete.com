import { describe, expect, it, vi } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { VideosList } from "@/components/admin/content-studio/list/VideosList"
import type { VideoUpload } from "@/types/database"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}))

vi.mock("@/hooks/use-ai-job", () => ({
  useAiJob: () => ({
    status: "pending",
    text: "",
    chunks: [],
    analysis: null,
    programCreated: null,
    messageId: null,
    error: null,
    result: null,
    activeTools: [],
    reset: vi.fn(),
  }),
}))

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
    expect(screen.getByRole("link", { name: /Alpha/ })).toHaveAttribute("href", "/admin/content/v1")
  })

  it("renders an empty state when no videos", () => {
    render(<VideosList videos={[]} />)
    expect(screen.getByText(/no videos yet/i)).toBeInTheDocument()
  })

  it("truncates long filenames with a title tooltip", () => {
    const longName = "a_really_long_filename_that_should_be_truncated_in_the_table_view.mp4"
    render(
      <VideosList
        videos={[
          {
            ...vids[0],
            id: "long",
            title: "Short Title",
            original_filename: longName,
          },
        ]}
      />,
    )
    const cell = screen.getByText(longName).closest("span")
    expect(cell).toHaveClass("truncate")
    expect(cell).toHaveAttribute("title", longName)
  })

  it("shows a Generate Social button for transcribed videos", () => {
    render(<VideosList videos={vids} />)
    expect(screen.getByRole("button", { name: /generate social/i })).toBeInTheDocument()
  })

  it("shows a Transcribe button for uploaded videos", () => {
    render(<VideosList videos={vids} />)
    expect(screen.getByRole("button", { name: /^transcribe$/i })).toBeInTheDocument()
  })

  it("hides Generate Social and shows Generated pill when posts already exist", () => {
    render(<VideosList videos={vids} postCountsByVideo={{ v1: { total: 6, needs_review: 0, approved: 0, scheduled: 0, published: 0, failed: 0 } }} />)
    expect(screen.getByText(/Generated \(6\)/i)).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /generate social/i })).not.toBeInTheDocument()
  })

  it("POSTs to the fanout API when Generate Social is clicked", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({}),
      text: async () => "",
    })
    vi.stubGlobal("fetch", fetchMock)
    try {
      render(<VideosList videos={vids} />)
      fireEvent.click(screen.getByRole("button", { name: /generate social/i }))
      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
      const [url, init] = fetchMock.mock.calls[0]
      expect(url).toBe("/api/admin/social/fanout")
      expect(init.method).toBe("POST")
      expect(JSON.parse(init.body as string)).toEqual({ videoUploadId: "v1" })
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
