import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"
import { ScheduleAgenda } from "@/components/admin/schedule/ScheduleAgenda"

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }))

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

beforeEach(() => {
  global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true }) }) as never
})

describe("ScheduleAgenda", () => {
  it("shows a scheduled session with its client, time, and action buttons", () => {
    render(<ScheduleAgenda sessions={[s() as never]} />)
    expect(screen.getByText(/Aean Durante/)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /attended/i })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /no-show/i })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /cancel/i })).toBeInTheDocument()
  })

  it("shows a status chip (no action buttons) for a resolved session", () => {
    render(<ScheduleAgenda sessions={[s({ status: "attended" }) as never]} />)
    expect(screen.getByText(/attended/i)).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /no-show/i })).toBeNull()
  })

  it("renders an empty state when there are no sessions", () => {
    render(<ScheduleAgenda sessions={[]} />)
    expect(screen.getByText(/no sessions/i)).toBeInTheDocument()
  })
})
