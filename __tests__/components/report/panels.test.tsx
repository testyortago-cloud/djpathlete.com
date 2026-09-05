// @vitest-environment jsdom
import { render, screen } from "@testing-library/react"
import { describe, it, expect } from "vitest"
import { BandPill } from "@/components/public/report/panels/BandPill"

describe("BandPill", () => {
  it("labels each band", () => {
    const { rerender } = render(<BandPill band="strength" />)
    expect(screen.getByText(/Strength/i)).toBeInTheDocument()
    rerender(<BandPill band="priority" />)
    expect(screen.getByText(/Priority/i)).toBeInTheDocument()
  })
})
