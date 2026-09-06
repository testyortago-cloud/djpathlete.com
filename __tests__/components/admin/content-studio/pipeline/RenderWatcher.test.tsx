// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render } from "@testing-library/react"

// Mock the live-job hook: return a status driven per-jobId from a controllable map.
const statusByJob: Record<string, string> = {}
vi.mock("@/hooks/use-ai-job", () => ({
  useAiJob: (jobId: string | null) => ({
    status: jobId ? (statusByJob[jobId] ?? "processing") : "pending",
    error: null,
  }),
}))

// Capture router.refresh calls.
const refreshMock = vi.fn()
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: refreshMock,
    push: vi.fn(),
    replace: vi.fn(),
    prefetch: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
  }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({}),
}))

import { RenderWatcher } from "@/components/admin/content-studio/pipeline/RenderWatcher"

describe("RenderWatcher", () => {
  beforeEach(() => {
    refreshMock.mockClear()
    for (const k of Object.keys(statusByJob)) delete statusByJob[k]
  })

  it("does not refresh while jobs are still processing", () => {
    statusByJob["j1"] = "processing"
    render(<RenderWatcher jobIds={["j1"]} />)
    expect(refreshMock).not.toHaveBeenCalled()
  })

  it("refreshes when a watched job has completed", () => {
    statusByJob["j1"] = "completed"
    render(<RenderWatcher jobIds={["j1"]} />)
    expect(refreshMock).toHaveBeenCalled()
  })

  it("refreshes when a watched job has failed", () => {
    statusByJob["j1"] = "failed"
    render(<RenderWatcher jobIds={["j1"]} />)
    expect(refreshMock).toHaveBeenCalled()
  })

  it("renders nothing visible", () => {
    statusByJob["j1"] = "processing"
    const { container } = render(<RenderWatcher jobIds={["j1"]} />)
    expect(container.textContent).toBe("")
  })

  it("refreshes once when one of several jobs completes, not for the still-processing one", () => {
    statusByJob["j1"] = "processing"
    statusByJob["j2"] = "completed"
    render(<RenderWatcher jobIds={["j1", "j2"]} />)
    expect(refreshMock).toHaveBeenCalledTimes(1)
  })
})
