// @vitest-environment jsdom
import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import { extractSlotFit, SlotFitPanel } from "@/components/admin/GenerationWarnings"

const item = {
  day_of_week: 2,
  slot_role: "primary_compound",
  slot_pattern: "squat",
  exercise_name: "Reverse Lunge",
  reason: "no unused squat exercise left",
}

describe("extractSlotFit", () => {
  it("reads valid items and drops malformed ones", () => {
    expect(extractSlotFit({ slot_fit: [item, { day_of_week: "x" }, null] })).toEqual([item])
  })
  it("is empty for older results with no slot_fit", () => {
    expect(extractSlotFit({ warnings: [] })).toEqual([])
    expect(extractSlotFit(null)).toEqual([])
  })
})

describe("SlotFitPanel", () => {
  it("renders nothing with no items", () => {
    const { container } = render(<SlotFitPanel items={[]} />)
    expect(container).toBeEmptyDOMElement()
  })
  it("names the day, the exercise, the slot and the reason", () => {
    render(<SlotFitPanel items={[item]} defaultOpen />)
    expect(screen.getByText(/Substitutes the AI had to make/)).toBeInTheDocument()
    expect(screen.getByText(/Tuesday/)).toBeInTheDocument()
    expect(screen.getByText(/Reverse Lunge/)).toBeInTheDocument()
    expect(screen.getByText(/squat slot/)).toBeInTheDocument()
    expect(screen.getByText(/no unused squat exercise left/)).toBeInTheDocument()
  })
})
