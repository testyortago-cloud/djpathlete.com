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
    status: "pending", result: null, error: null, text: "", chunks: [],
    analysis: null, programCreated: null, messageId: null, activeTools: [], reset: vi.fn(),
  }),
}))

import { NewsletterGenerateDialog } from "@/components/admin/newsletter/NewsletterGenerateDialog"

describe("NewsletterGenerateDialog — From blog post tab", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fetchMock.mockImplementation((url: string) => {
      if (url.startsWith("/api/admin/blog?status=published")) {
        return Promise.resolve({
          ok: true,
          json: async () => [
            { id: "bp-1", title: "Shoulder Rehab", published_at: "2026-04-01" },
            { id: "bp-2", title: "Knee Drills", published_at: "2026-03-28" },
          ],
        })
      }
      if (url === "/api/admin/newsletter/generate-from-blog") {
        return Promise.resolve({
          ok: true,
          json: async () => ({ jobId: "job-1", status: "pending" }),
        })
      }
      return Promise.reject(new Error("unexpected url " + url))
    })
  })

  it("renders tabs and defaults to From prompt", () => {
    render(<NewsletterGenerateDialog open={true} onOpenChange={vi.fn()} onGenerated={vi.fn()} />)
    expect(screen.getByRole("tab", { name: /from prompt/i })).toBeInTheDocument()
    expect(screen.getByRole("tab", { name: /from blog post/i })).toBeInTheDocument()
  })

  it("switching to From blog post fetches published blogs and shows picker", async () => {
    render(<NewsletterGenerateDialog open={true} onOpenChange={vi.fn()} onGenerated={vi.fn()} />)
    fireEvent.click(screen.getByRole("tab", { name: /from blog post/i }))
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/api/admin/blog?status=published"))
    })
    expect(await screen.findByText(/shoulder rehab/i)).toBeInTheDocument()
  })

  it("submitting From blog post POSTs to /generate-from-blog", async () => {
    render(<NewsletterGenerateDialog open={true} onOpenChange={vi.fn()} onGenerated={vi.fn()} />)
    fireEvent.click(screen.getByRole("tab", { name: /from blog post/i }))
    await screen.findByText(/shoulder rehab/i)
    fireEvent.click(screen.getByText(/shoulder rehab/i))
    fireEvent.click(screen.getByRole("button", { name: /generate from blog/i }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/admin/newsletter/generate-from-blog",
        expect.objectContaining({ method: "POST" }),
      )
    })
  })
})
