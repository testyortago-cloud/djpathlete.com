import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { FactCheckSidebar, type FactCheckFlaggedClaim } from "@/components/admin/blog/FactCheckSidebar"

const claim1: FactCheckFlaggedClaim = {
  claim: "Shoulder rehab takes 6 weeks.",
  span_start: null,
  span_end: null,
  source_urls_checked: ["https://pubmed.example/a"],
  verdict: "contradicted",
  notes: "Source says typical timeline is 8-12 weeks.",
}

const claim2: FactCheckFlaggedClaim = {
  claim: "Everyone needs 10k steps a day.",
  span_start: null,
  span_end: null,
  source_urls_checked: [],
  verdict: "unverifiable",
  notes: "No source for the exact 10k figure.",
}

describe("FactCheckSidebar", () => {
  it("renders one row per flagged claim with verdict + notes + source links", () => {
    render(<FactCheckSidebar claims={[claim1, claim2]} onClose={vi.fn()} />)
    expect(screen.getByText(/shoulder rehab takes 6 weeks/i)).toBeInTheDocument()
    expect(screen.getByText(/contradicted/i)).toBeInTheDocument()
    expect(screen.getByText(/8-12 weeks/i)).toBeInTheDocument()
    expect(screen.getByText(/unverifiable/i)).toBeInTheDocument()
    expect(screen.getByText("pubmed.example")).toBeInTheDocument()
  })

  it("renders empty state when no claims", () => {
    render(<FactCheckSidebar claims={[]} onClose={vi.fn()} />)
    expect(screen.getByText(/no flagged claims/i)).toBeInTheDocument()
  })

  it("Dismiss strikes through claim locally", () => {
    render(<FactCheckSidebar claims={[claim1]} onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole("button", { name: /dismiss/i }))
    const claimText = screen.getByText(/shoulder rehab takes 6 weeks/i)
    expect(claimText.className).toMatch(/line-through/)
  })
})
