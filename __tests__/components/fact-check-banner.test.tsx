import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { FactCheckBanner } from "@/components/admin/blog/FactCheckBanner"

describe("FactCheckBanner", () => {
  it("renders nothing for status=passed", () => {
    const { container } = render(<FactCheckBanner status="passed" flaggedCount={0} open={false} onToggle={vi.fn()} />)
    expect(container.firstChild).toBeNull()
  })

  it("renders nothing for status=pending", () => {
    const { container } = render(<FactCheckBanner status="pending" flaggedCount={0} open={false} onToggle={vi.fn()} />)
    expect(container.firstChild).toBeNull()
  })

  it("renders amber flagged banner with count", () => {
    render(<FactCheckBanner status="flagged" flaggedCount={3} open={false} onToggle={vi.fn()} />)
    expect(screen.getByText(/3 claims flagged/i)).toBeInTheDocument()
  })

  it("renders red failed banner", () => {
    render(<FactCheckBanner status="failed" flaggedCount={7} open={false} onToggle={vi.fn()} />)
    expect(screen.getByText(/fact-check failed/i)).toBeInTheDocument()
  })

  it("clicking the banner toggles open", () => {
    const onToggle = vi.fn()
    render(<FactCheckBanner status="flagged" flaggedCount={2} open={false} onToggle={onToggle} />)
    fireEvent.click(screen.getByRole("button"))
    expect(onToggle).toHaveBeenCalled()
  })
})
