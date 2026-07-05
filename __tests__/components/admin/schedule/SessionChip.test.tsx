import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { SessionChip } from "@/components/admin/schedule/SessionChip"

const refresh = vi.fn()
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => refresh() }) }))
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

beforeEach(() => {
  vi.clearAllMocks()
  global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true }) }) as never
})

describe("SessionChip", () => {
  it("renders time and client name on the chip", () => {
    render(<SessionChip session={s() as never} />)
    const trigger = screen.getByRole("button")
    expect(trigger).toHaveTextContent(/05:45/)
    expect(trigger).toHaveTextContent(/Aean/)
  })

  it("opens a dialog with the session details and actions when scheduled", async () => {
    render(<SessionChip session={s() as never} />)
    fireEvent.click(screen.getByRole("button"))
    expect(await screen.findByRole("dialog")).toBeInTheDocument()
    expect(screen.getByRole("dialog")).toHaveTextContent(/Aean Durante/)
    expect(screen.getByRole("button", { name: /attended/i })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /no-show/i })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /cancel session/i })).toBeInTheDocument()
  })

  it("PATCHes the occurrence route and refreshes on Attended", async () => {
    render(<SessionChip session={s() as never} />)
    fireEvent.click(screen.getByRole("button"))
    fireEvent.click(await screen.findByRole("button", { name: /attended/i }))
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/admin/sessions/occurrence/occ-1",
        expect.objectContaining({ method: "PATCH", body: JSON.stringify({ action: "attended" }) }),
      )
      expect(refresh).toHaveBeenCalled()
    })
  })

  it("sends the cancel action from the Cancel session button", async () => {
    render(<SessionChip session={s() as never} />)
    fireEvent.click(screen.getByRole("button"))
    fireEvent.click(await screen.findByRole("button", { name: /cancel session/i }))
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/admin/sessions/occurrence/occ-1",
        expect.objectContaining({ method: "PATCH", body: JSON.stringify({ action: "cancel" }) }),
      )
    })
  })

  it("shows a status chip and no actions for a resolved session", async () => {
    render(<SessionChip session={s({ status: "attended" }) as never} />)
    fireEvent.click(screen.getByRole("button"))
    expect(await screen.findByRole("dialog")).toBeInTheDocument()
    expect(screen.getByRole("dialog")).toHaveTextContent(/attended/i)
    expect(screen.queryByRole("button", { name: /no-show/i })).toBeNull()
    expect(screen.queryByRole("button", { name: /cancel session/i })).toBeNull()
  })

  it("toasts an error when the update fails", async () => {
    const { toast } = await import("sonner")
    ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: false, status: 500 })
    render(<SessionChip session={s() as never} />)
    fireEvent.click(screen.getByRole("button"))
    fireEvent.click(await screen.findByRole("button", { name: /no-show/i }))
    await waitFor(() => expect(toast.error).toHaveBeenCalled())
    expect(refresh).not.toHaveBeenCalled()
  })
})
