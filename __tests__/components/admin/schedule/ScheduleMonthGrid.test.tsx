// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { ScheduleMonthGrid } from "@/components/admin/schedule/ScheduleMonthGrid"

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const s = (over: Record<string, unknown> = {}) => ({
  id: "occ-1",
  client_user_id: "c1",
  clientName: "Aean Durante",
  recurring_session_id: "slot-1",
  session_date: "2026-07-06",
  start_time: "05:45:00",
  duration_minutes: 60,
  status: "scheduled",
  attended_at: null,
  checkin_id: null,
  cancelled_at: null,
  cancel_reason: null,
  notes: null,
  created_by: null,
  created_at: "",
  updated_at: "",
  ...over,
})

// July 2026: grid spans Sun Jun 28 .. Sat Aug 1 (5 weeks = 35 cells).

describe("ScheduleMonthGrid", () => {
  it("renders 35 day cells for July 2026 plus weekday headers", () => {
    render(<ScheduleMonthGrid anchor="2026-07-15" sessions={[]} today="2026-07-06" />)
    expect(screen.getAllByTestId("month-cell")).toHaveLength(35)
    expect(screen.getByText("Sun")).toBeInTheDocument()
    expect(screen.getByText("Sat")).toBeInTheDocument()
  })

  it("dims days outside the anchor month", () => {
    render(<ScheduleMonthGrid anchor="2026-07-15" sessions={[]} today="2026-07-06" />)
    const cells = screen.getAllByTestId("month-cell")
    expect(cells[0]).toHaveAttribute("data-inmonth", "false") // Jun 28
    expect(cells[3]).toHaveAttribute("data-inmonth", "true") // Jul 1
  })

  it("marks today's cell", () => {
    render(<ScheduleMonthGrid anchor="2026-07-15" sessions={[]} today="2026-07-06" />)
    const cells = screen.getAllByTestId("month-cell")
    expect(cells[8]).toHaveAttribute("aria-current", "date") // Mon Jul 6 (week 2, index 1)
  })

  it("renders a session chip with time and client in its day cell", () => {
    render(<ScheduleMonthGrid anchor="2026-07-15" sessions={[s() as never]} today="2026-07-06" />)
    const chip = screen.getByRole("button", { name: /Aean/ })
    expect(chip).toHaveTextContent(/05:45/)
  })

  it("renders multiple sessions on the same day sorted by time", () => {
    const two = [
      s({ id: "occ-2", clientName: "Brie", start_time: "08:00:00" }),
      s({ id: "occ-1", clientName: "Aean" }),
    ] as never[]
    render(<ScheduleMonthGrid anchor="2026-07-15" sessions={two} today="2026-07-06" />)
    const chips = screen.getAllByRole("button")
    expect(chips[0]).toHaveTextContent(/Aean/) // 05:45 sorts before 08:00
    expect(chips[1]).toHaveTextContent(/Brie/)
  })
})
