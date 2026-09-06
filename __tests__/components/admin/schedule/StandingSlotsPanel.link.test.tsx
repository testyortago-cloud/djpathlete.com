// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { StandingSlotsPanel } from "@/components/admin/schedule/StandingSlotsPanel"

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const slot = (over: Record<string, unknown> = {}) => ({
  id: "slot-1",
  client_user_id: "c1",
  day_of_week: 1,
  start_time: "05:45:00",
  duration_minutes: 60,
  location: null,
  notes: null,
  status: "active",
  assignment_id: null,
  created_by: null,
  created_at: "",
  updated_at: "",
  ...over,
})

const ASSIGNMENTS = [
  { id: "asg-1", label: "Comeback Code" },
  { id: "asg-2", label: "Rotational Reboot" },
]

beforeEach(() => {
  vi.clearAllMocks()
  global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ slot: slot() }) }) as never
})

describe("StandingSlotsPanel — program link", () => {
  it("renders an Advances-program select with None + the client's programs", () => {
    render(<StandingSlotsPanel clientUserId="c1" slots={[slot() as never]} assignments={ASSIGNMENTS} />)
    const select = screen.getByRole("combobox", { name: /advances program/i })
    expect(select).toBeInTheDocument()
    expect(screen.getByRole("option", { name: "None" })).toBeInTheDocument()
    expect(screen.getByRole("option", { name: "Comeback Code" })).toBeInTheDocument()
  })

  it("PATCHes the slot with the chosen assignmentId", async () => {
    render(<StandingSlotsPanel clientUserId="c1" slots={[slot() as never]} assignments={ASSIGNMENTS} />)
    fireEvent.change(screen.getByRole("combobox", { name: /advances program/i }), { target: { value: "asg-2" } })
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/admin/sessions/slot-1",
        expect.objectContaining({ method: "PATCH", body: JSON.stringify({ assignmentId: "asg-2" }) }),
      )
    })
  })

  it("PATCHes null when None is chosen", async () => {
    render(
      <StandingSlotsPanel clientUserId="c1" slots={[slot({ assignment_id: "asg-1" }) as never]} assignments={ASSIGNMENTS} />,
    )
    fireEvent.change(screen.getByRole("combobox", { name: /advances program/i }), { target: { value: "" } })
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/admin/sessions/slot-1",
        expect.objectContaining({ method: "PATCH", body: JSON.stringify({ assignmentId: null }) }),
      )
    })
  })

  it("shows the current link as the select value", () => {
    render(
      <StandingSlotsPanel clientUserId="c1" slots={[slot({ assignment_id: "asg-1" }) as never]} assignments={ASSIGNMENTS} />,
    )
    expect(screen.getByRole("combobox", { name: /advances program/i })).toHaveValue("asg-1")
  })

  it("renders no select when the client has no assignments to link", () => {
    render(<StandingSlotsPanel clientUserId="c1" slots={[slot() as never]} />)
    expect(screen.queryByRole("combobox", { name: /advances program/i })).toBeNull()
  })
})
