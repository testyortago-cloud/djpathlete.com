import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"

const fetchMock = vi.fn()
globalThis.fetch = fetchMock as unknown as typeof fetch

const pushMock = vi.fn()
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, replace: vi.fn(), refresh: vi.fn() }),
}))

vi.mock("@/hooks/use-ai-job", () => ({
  useAiJob: () => ({
    status: "pending",
    result: null,
    error: null,
    text: "",
    chunks: [],
    analysis: null,
    programCreated: null,
    messageId: null,
    activeTools: [],
    reset: vi.fn(),
  }),
}))

import { BlogGenerateDialog } from "@/components/admin/blog/BlogGenerateDialog"

describe("BlogGenerateDialog — From video tab", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fetchMock.mockImplementation((url: string) => {
      if (url === "/api/admin/videos?status=transcribed") {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            videos: [{ id: "v1", title: "Shoulder Rehab", created_at: "2026-04-01" }],
          }),
        })
      }
      if (url === "/api/admin/blog-posts/generate-from-video") {
        return Promise.resolve({
          ok: true,
          json: async () => ({ jobId: "job-1", blog_post_id: "bp-9" }),
        })
      }
      return Promise.reject(new Error("unexpected url " + url))
    })
  })

  it("renders tabs and defaults to From prompt", () => {
    render(<BlogGenerateDialog open={true} onOpenChange={vi.fn()} onGenerated={vi.fn()} />)
    expect(screen.getByRole("tab", { name: /from prompt/i })).toBeInTheDocument()
    expect(screen.getByRole("tab", { name: /from video/i })).toBeInTheDocument()
  })

  it("switching to From video fetches transcribed videos and shows picker", async () => {
    render(<BlogGenerateDialog open={true} onOpenChange={vi.fn()} onGenerated={vi.fn()} />)
    fireEvent.click(screen.getByRole("tab", { name: /from video/i }))
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/admin/videos?status=transcribed")
    })
    expect(await screen.findByText(/shoulder rehab/i)).toBeInTheDocument()
  })

  it("submitting From video POSTs to /generate-from-video", async () => {
    render(<BlogGenerateDialog open={true} onOpenChange={vi.fn()} onGenerated={vi.fn()} />)
    fireEvent.click(screen.getByRole("tab", { name: /from video/i }))
    await screen.findByText(/shoulder rehab/i)
    // Fill in required primary keyword before submission
    fireEvent.change(screen.getByPlaceholderText(/youth pitching velocity/i), { target: { value: "shoulder rehab exercises" } })
    fireEvent.click(screen.getByText(/shoulder rehab/i))
    fireEvent.click(screen.getByRole("button", { name: /generate from video/i }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/admin/blog-posts/generate-from-video",
        expect.objectContaining({ method: "POST" }),
      )
    })
  })
})
