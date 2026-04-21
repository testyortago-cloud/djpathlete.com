import { describe, expect, it, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { DndContext } from "@dnd-kit/core"
import { WeekGrid } from "@/components/admin/content-studio/calendar/WeekGrid"

function wrap(ui: React.ReactNode) {
  return <DndContext>{ui}</DndContext>
}

describe("<WeekGrid>", () => {
  it("renders 7 day cells", () => {
    render(
      wrap(
        <WeekGrid
          anchor={new Date("2026-04-20T00:00:00Z")}
          chips={[]}
          onEmptyDayClick={vi.fn()}
        />,
      ),
    )
    expect(screen.getAllByRole("gridcell")).toHaveLength(7)
  })

  it("renders weekday + day number labels", () => {
    render(
      wrap(
        <WeekGrid
          anchor={new Date("2026-04-20T00:00:00Z")}
          chips={[]}
          onEmptyDayClick={vi.fn()}
        />,
      ),
    )
    expect(screen.getByText("20")).toBeInTheDocument()
    expect(screen.getByText("26")).toBeInTheDocument()
  })
})
