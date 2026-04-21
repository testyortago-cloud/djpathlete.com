import { describe, expect, it, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { DndContext } from "@dnd-kit/core"
import { MonthGrid } from "@/components/admin/content-studio/calendar/MonthGrid"
import { postToChip } from "@/lib/content-studio/calendar-chips"

function wrap(ui: React.ReactNode) {
  return <DndContext>{ui}</DndContext>
}

describe("<MonthGrid>", () => {
  it("renders a 6-week grid (42 day cells)", () => {
    render(wrap(<MonthGrid anchor={new Date("2026-04-15T00:00:00Z")} chips={[]} onEmptyDayClick={vi.fn()} />))
    const cells = screen.getAllByRole("gridcell")
    expect(cells).toHaveLength(42)
  })

  it("highlights 'today' when inside the visible month", () => {
    const now = new Date()
    now.setUTCHours(0, 0, 0, 0)
    const { container } = render(wrap(<MonthGrid anchor={now} chips={[]} onEmptyDayClick={vi.fn()} />))
    expect(container.querySelector("[data-today='true']")).toBeTruthy()
  })

  it("renders a chip on its scheduled day", () => {
    const chip = postToChip({
      id: "p1",
      platform: "instagram",
      content: "caption",
      media_url: null,
      approval_status: "scheduled",
      scheduled_at: "2026-04-20T15:00:00Z",
      published_at: null,
      source_video_id: null,
      rejection_notes: null,
      platform_post_id: null,
      created_by: "u",
      created_at: "",
      updated_at: "",
    })
    render(wrap(<MonthGrid anchor={new Date("2026-04-15T00:00:00Z")} chips={[chip]} onEmptyDayClick={vi.fn()} />))
    expect(screen.getByText(/caption/)).toBeInTheDocument()
  })
})
