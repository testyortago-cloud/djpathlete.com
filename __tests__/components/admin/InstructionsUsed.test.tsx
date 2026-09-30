// @vitest-environment jsdom
import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import { InstructionsUsedPanel, extractInstructionsUsed } from "@/components/admin/GenerationWarnings"

const ENRICHED = {
  original: "12 exercises, mainly shoulder, some back and chest",
  enriched: "Exactly 12 exercises: 7 shoulder, 3 upper back, 2 chest.",
  model: "claude-opus-5-5",
  note: null,
}

describe("extractInstructionsUsed", () => {
  it("reads a well-formed value off the job result", () => {
    expect(extractInstructionsUsed({ instructions_used: ENRICHED })).toEqual(ENRICHED)
  })

  it("returns null for an older deployment's result, which has no such key", () => {
    expect(extractInstructionsUsed({ warnings: [] })).toBeNull()
    expect(extractInstructionsUsed(null)).toBeNull()
  })

  it("returns null for a malformed value rather than rendering garbage", () => {
    expect(extractInstructionsUsed({ instructions_used: { original: 5 } })).toBeNull()
    expect(extractInstructionsUsed({ instructions_used: "text" })).toBeNull()
  })
})

describe("InstructionsUsedPanel", () => {
  it("shows the rewrite the AI worked from", () => {
    render(<InstructionsUsedPanel used={ENRICHED} defaultOpen />)
    expect(screen.getByText("How the AI read your instructions")).toBeTruthy()
    expect(screen.getByText(/Exactly 12 exercises: 7 shoulder/)).toBeTruthy()
  })

  it("shows why the coach's own words were used when there was no rewrite", () => {
    render(
      <InstructionsUsedPanel
        used={{
          ...ENRICHED,
          enriched: null,
          model: null,
          note: "The AI rewrite took too long, so your instructions were used exactly as written.",
        }}
        defaultOpen
      />,
    )
    expect(screen.getByText(/took too long/)).toBeTruthy()
    expect(screen.queryByText(/Exactly 12 exercises/)).toBeNull()
  })

  it("renders nothing when there were no instructions", () => {
    const { container } = render(<InstructionsUsedPanel used={null} />)
    expect(container.innerHTML).toBe("")
  })
})
