import { describe, expect, it, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { DndContext } from "@dnd-kit/core"
import { DayGrid } from "@/components/admin/content-studio/calendar/DayGrid"

function wrap(ui: React.ReactNode) {
  return <DndContext>{ui}</DndContext>
}

describe("<DayGrid>", () => {
  it("renders 24 hour rows", () => {
    render(
      wrap(
        <DayGrid
          anchor={new Date("2026-04-20T00:00:00Z")}
          chips={[]}
          onEmptyDayClick={vi.fn()}
        />,
      ),
    )
    expect(screen.getAllByRole("row")).toHaveLength(24)
  })

  it("renders hour labels", () => {
    render(
      wrap(
        <DayGrid
          anchor={new Date("2026-04-20T00:00:00Z")}
          chips={[]}
          onEmptyDayClick={vi.fn()}
        />,
      ),
    )
    expect(screen.getByText("09:00")).toBeInTheDocument()
    expect(screen.getByText("23:00")).toBeInTheDocument()
  })
})
