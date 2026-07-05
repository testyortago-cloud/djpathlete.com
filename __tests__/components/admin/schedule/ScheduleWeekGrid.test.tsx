import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { ScheduleWeekGrid } from "@/components/admin/schedule/ScheduleWeekGrid"

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

// Anchor 2026-07-08 (Wed) → week Sun 2026-07-05 .. Sat 2026-07-11.

describe("ScheduleWeekGrid", () => {
  it("renders the 7 day headers of the anchor week", () => {
    render(<ScheduleWeekGrid anchor="2026-07-08" sessions={[]} today="2026-07-06" />)
    expect(screen.getByText(/Sun/)).toBeInTheDocument()
    expect(screen.getByText(/Sat/)).toBeInTheDocument()
    expect(screen.getAllByTestId("day-header")).toHaveLength(7)
  })

  it("marks today's header", () => {
    render(<ScheduleWeekGrid anchor="2026-07-08" sessions={[]} today="2026-07-06" />)
    const headers = screen.getAllByTestId("day-header")
    expect(headers[1]).toHaveAttribute("aria-current", "date") // Mon Jul 6
  })

  it("renders a session as a clickable block in its day", () => {
    render(<ScheduleWeekGrid anchor="2026-07-08" sessions={[s() as never]} today="2026-07-06" />)
    expect(screen.getByRole("button", { name: /Aean/ })).toBeInTheDocument()
    expect(screen.getAllByTestId("session-block")).toHaveLength(1)
  })

  it("renders hour labels expanded to include an early session", () => {
    render(<ScheduleWeekGrid anchor="2026-07-08" sessions={[s() as never]} today="2026-07-06" />)
    expect(screen.getByText("05:00")).toBeInTheDocument()
  })

  it("places same-time sessions side by side (different lane offsets)", () => {
    const two = [
      s({ id: "occ-1", clientName: "Aean" }),
      s({ id: "occ-2", clientName: "Brie" }),
    ] as never[]
    render(<ScheduleWeekGrid anchor="2026-07-08" sessions={two} today="2026-07-06" />)
    const blocks = screen.getAllByTestId("session-block")
    expect(blocks).toHaveLength(2)
    expect(blocks[0].style.left).not.toBe(blocks[1].style.left)
  })

  it("ignores sessions outside the anchor week", () => {
    render(
      <ScheduleWeekGrid anchor="2026-07-08" sessions={[s({ session_date: "2026-07-13" }) as never]} today="2026-07-06" />,
    )
    expect(screen.queryAllByTestId("session-block")).toHaveLength(0)
  })
})
