import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"

const useAiJobMock = vi.fn()
vi.mock("@/hooks/use-ai-job", () => ({
  useAiJob: (jobId: string | null) => useAiJobMock(jobId),
}))

const routerRefreshMock = vi.fn()
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: routerRefreshMock }),
}))

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

const fetchMock = vi.fn()
globalThis.fetch = fetchMock as unknown as typeof fetch

import { TopicResearchForm } from "@/components/admin/topic-suggestions/TopicResearchForm"

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

describe("TopicResearchForm", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useAiJobMock.mockReturnValue(defaultAiJobState())
  })

  it("renders the input and Research button", () => {
    render(<TopicResearchForm />)
    expect(screen.getByPlaceholderText(/e\.g\./i)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /research/i })).toBeInTheDocument()
  })

  it("POSTs the typed topic and shows a loading state once a job is running", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ jobId: "job-1", status: "pending" }) })
    useAiJobMock.mockReturnValue(defaultAiJobState({ status: "processing" }))

    render(<TopicResearchForm />)
    fireEvent.change(screen.getByPlaceholderText(/e\.g\./i), {
      target: { value: "blood flow restriction training" },
    })
    fireEvent.click(screen.getByRole("button", { name: /research/i }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/admin/topic-suggestions/research",
        expect.objectContaining({ method: "POST" }),
      )
    })
    expect(await screen.findByText(/researching/i)).toBeInTheDocument()
  })

  it("renders candidates as a checked-by-default list once the job completes", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ jobId: "job-1", status: "pending" }) })
    useAiJobMock.mockReturnValue(
      defaultAiJobState({
        status: "completed",
        result: {
          topics: [
            { title: "BFR accelerates return-to-play hypertrophy", summary: "s1", tavily_url: "https://a.example/1", rank: 1 },
            { title: "BFR safety thresholds in adolescents", summary: "s2", tavily_url: "https://b.example/2", rank: 2 },
          ],
        },
      }),
    )

    render(<TopicResearchForm />)
    fireEvent.change(screen.getByPlaceholderText(/e\.g\./i), {
      target: { value: "blood flow restriction training" },
    })
    fireEvent.click(screen.getByRole("button", { name: /research/i }))

    expect(await screen.findByText("BFR accelerates return-to-play hypertrophy")).toBeInTheDocument()
    expect(screen.getByText("BFR safety thresholds in adolescents")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /add 2 selected/i })).toBeInTheDocument()
  })

  it("unchecking a candidate updates the Add-selected count", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ jobId: "job-1", status: "pending" }) })
    useAiJobMock.mockReturnValue(
      defaultAiJobState({
        status: "completed",
        result: {
          topics: [
            { title: "Topic A", summary: "s1", tavily_url: "https://a.example/1", rank: 1 },
            { title: "Topic B", summary: "s2", tavily_url: "https://b.example/2", rank: 2 },
          ],
        },
      }),
    )

    render(<TopicResearchForm />)
    fireEvent.change(screen.getByPlaceholderText(/e\.g\./i), { target: { value: "some topic here" } })
    fireEvent.click(screen.getByRole("button", { name: /research/i }))
    await screen.findByText("Topic A")

    fireEvent.click(screen.getByRole("checkbox", { name: /include "topic a"/i }))
    expect(screen.getByRole("button", { name: /add 1 selected/i })).toBeInTheDocument()
  })

  it("shows a no-results message when the job completes with zero candidates", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ jobId: "job-1", status: "pending" }) })
    useAiJobMock.mockReturnValue(defaultAiJobState({ status: "completed", result: { topics: [] } }))

    render(<TopicResearchForm />)
    fireEvent.change(screen.getByPlaceholderText(/e\.g\./i), { target: { value: "an obscure niche topic" } })
    fireEvent.click(screen.getByRole("button", { name: /research/i }))

    expect(await screen.findByText(/no strong sources found/i)).toBeInTheDocument()
  })

  it("shows an error state with a retry action when the job fails", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ jobId: "job-1", status: "pending" }) })
    useAiJobMock.mockReturnValue(defaultAiJobState({ status: "failed", error: "Tavily rate limit" }))

    render(<TopicResearchForm />)
    fireEvent.change(screen.getByPlaceholderText(/e\.g\./i), { target: { value: "some topic here" } })
    fireEvent.click(screen.getByRole("button", { name: /research/i }))

    expect(await screen.findByText(/tavily rate limit/i)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument()
  })
})
