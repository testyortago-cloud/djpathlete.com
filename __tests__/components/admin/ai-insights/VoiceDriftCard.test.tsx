import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, waitFor, fireEvent } from "@testing-library/react"
import { VoiceDriftCard } from "@/components/admin/ai-insights/VoiceDriftCard"
import type { VoiceDriftFlag } from "@/types/database"

function jsonResponse<T>(body: T, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

const sampleFlag: VoiceDriftFlag = {
  id: "f-1",
  entity_type: "social_post",
  entity_id: "p-1",
  drift_score: 75,
  severity: "high",
  issues: [{ issue: "Too formal for the brand", suggestion: "Drop the corporate tone" }],
  content_preview: "We are pleased to announce new offerings",
  scanned_at: "2026-04-21T04:00:00Z",
  created_at: "2026-04-21T04:00:00Z",
}

describe("<VoiceDriftCard />", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it("renders empty state when the API returns zero flags", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ flags: [], lastScanAt: null })))
    render(<VoiceDriftCard />)
    await waitFor(() => {
      expect(screen.getByText(/No drift flagged this week/i)).toBeInTheDocument()
    })
    vi.unstubAllGlobals()
  })

  it("renders the flag list and severity badges", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({
          flags: [sampleFlag],
          lastScanAt: sampleFlag.scanned_at,
        }),
      ),
    )
    render(<VoiceDriftCard />)
    await waitFor(() => {
      expect(screen.getByText(/We are pleased/)).toBeInTheDocument()
    })
    expect(screen.getByText(/high/i)).toBeInTheDocument()
    expect(screen.getByText(/Social post/i)).toBeInTheDocument()
    vi.unstubAllGlobals()
  })

  it("expands an item to show issue + suggestion", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ flags: [sampleFlag], lastScanAt: sampleFlag.scanned_at })),
    )
    render(<VoiceDriftCard />)
    await waitFor(() => {
      expect(screen.getByText(/We are pleased/)).toBeInTheDocument()
    })

    const toggle = screen.getByRole("button", { expanded: false })
    fireEvent.click(toggle)

    expect(screen.getByText(/Too formal for the brand/)).toBeInTheDocument()
    expect(screen.getByText(/Drop the corporate tone/)).toBeInTheDocument()
    vi.unstubAllGlobals()
  })

  it("renders an error state when the API fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("oops", { status: 500 })))
    render(<VoiceDriftCard />)
    await waitFor(() => {
      expect(screen.getByText(/Couldn't load voice drift flags/i)).toBeInTheDocument()
    })
    vi.unstubAllGlobals()
  })
})
