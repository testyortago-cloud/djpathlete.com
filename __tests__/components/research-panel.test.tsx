import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import type { TavilyResearchBrief } from "@/components/admin/blog/ResearchPanel"

// Mock useAiJob so we can drive its state per test
const useAiJobMock = vi.fn()
vi.mock("@/hooks/use-ai-job", () => ({
  useAiJob: (jobId: string | null) => useAiJobMock(jobId),
}))

// Mock fetch for the POST kick-off
const fetchMock = vi.fn()
globalThis.fetch = fetchMock as unknown as typeof fetch

import { ResearchPanel } from "@/components/admin/blog/ResearchPanel"

function defaultAiJobState(overrides: Partial<Record<string, unknown>> = {}) {
  return {
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
    ...overrides,
  }
}

const sampleBrief: TavilyResearchBrief = {
  topic: "shoulder rehab",
  summary: "Top protocols emphasize scapular control.",
  results: [
    { title: "PubMed", url: "https://pubmed.example/a", snippet: "abc", score: 0.9, published_date: "2025-01-01" },
  ],
  extracted: [{ url: "https://pubmed.example/a", content: "full page text" }],
  generated_at: "2026-04-20T10:00:00.000Z",
}

describe("ResearchPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useAiJobMock.mockReturnValue(defaultAiJobState())
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ jobId: "job-1", status: "pending" }),
    })
  })

  it("renders empty state when no brief and no job", () => {
    render(<ResearchPanel blogPostId="bp-1" postTitle="shoulder rehab" initialBrief={null} onBriefChange={vi.fn()} />)
    expect(screen.getByText(/research this topic/i)).toBeInTheDocument()
  })

  it("renders populated state when initialBrief provided", () => {
    render(<ResearchPanel blogPostId="bp-1" postTitle="shoulder rehab" initialBrief={sampleBrief} onBriefChange={vi.fn()} />)
    expect(screen.getByText(/top protocols emphasize scapular control/i)).toBeInTheDocument()
    expect(screen.getByText("PubMed")).toBeInTheDocument()
  })

  it("expands extracted content when a source is clicked", () => {
    render(<ResearchPanel blogPostId="bp-1" postTitle="x" initialBrief={sampleBrief} onBriefChange={vi.fn()} />)
    fireEvent.click(screen.getByText("PubMed"))
    expect(screen.getByText(/full page text/i)).toBeInTheDocument()
  })

  it("renders loading state while useAiJob is processing", () => {
    useAiJobMock.mockReturnValue(defaultAiJobState({ status: "processing" }))
    render(
      <ResearchPanel
        blogPostId="bp-1"
        postTitle="x"
        initialBrief={null}
        onBriefChange={vi.fn()}
        activeJobId="job-1"
      />,
    )
    expect(screen.getByText(/researching/i)).toBeInTheDocument()
  })

  it("renders error state + Retry when job failed", () => {
    useAiJobMock.mockReturnValue(defaultAiJobState({ status: "failed", error: "Tavily rate limit" }))
    render(
      <ResearchPanel
        blogPostId="bp-1"
        postTitle="x"
        initialBrief={null}
        onBriefChange={vi.fn()}
        activeJobId="job-1"
      />,
    )
    expect(screen.getByText(/tavily rate limit/i)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument()
  })

  it("clicking Research POSTs to the route and stores the returned jobId", async () => {
    render(<ResearchPanel blogPostId="bp-1" postTitle="shoulder rehab" initialBrief={null} onBriefChange={vi.fn()} />)
    fireEvent.click(screen.getByRole("button", { name: /research this topic/i }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/admin/blog-posts/bp-1/research",
        expect.objectContaining({ method: "POST" }),
      )
    })
  })

  it("calls onBriefChange when job completes with a result", async () => {
    const onBriefChange = vi.fn()
    useAiJobMock.mockReturnValue(defaultAiJobState({ status: "completed", result: sampleBrief }))
    render(
      <ResearchPanel
        blogPostId="bp-1"
        postTitle="x"
        initialBrief={null}
        onBriefChange={onBriefChange}
        activeJobId="job-1"
      />,
    )
    await waitFor(() => expect(onBriefChange).toHaveBeenCalledWith(sampleBrief))
  })
})
