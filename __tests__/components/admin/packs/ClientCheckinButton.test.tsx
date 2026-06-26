import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { ClientCheckinButton } from "@/components/admin/packs/ClientCheckinButton"

const toast = vi.hoisted(() => ({ success: vi.fn(), info: vi.fn(), error: vi.fn() }))
vi.mock("sonner", () => ({ toast }))

beforeEach(() => {
  vi.clearAllMocks()
  vi.restoreAllMocks()
})

describe("<ClientCheckinButton>", () => {
  it("renders nothing without active credits", () => {
    const { container } = render(<ClientCheckinButton clientUserId="c1" hasActiveCredits={false} />)
    expect(container).toBeEmptyDOMElement()
  })

  it("checks in and toasts remaining", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: true, remaining: 4 }), { status: 200 }),
    )
    render(<ClientCheckinButton clientUserId="c1" hasActiveCredits />)
    fireEvent.click(screen.getByRole("button", { name: /check in/i }))
    await waitFor(() => expect(toast.success).toHaveBeenCalled())
    expect(global.fetch).toHaveBeenCalledWith(
      "/api/admin/session-packs/checkin",
      expect.objectContaining({ method: "POST" }),
    )
  })

  it("shows an info toast on a duplicate check-in", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: true, reason: "duplicate", remaining: 4 }), { status: 200 }),
    )
    render(<ClientCheckinButton clientUserId="c1" hasActiveCredits />)
    fireEvent.click(screen.getByRole("button", { name: /check in/i }))
    await waitFor(() => expect(toast.info).toHaveBeenCalled())
    expect(toast.success).not.toHaveBeenCalled()
  })

  it("surfaces a 409 as an error toast", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "No active credits" }), { status: 409 }),
    )
    render(<ClientCheckinButton clientUserId="c1" hasActiveCredits />)
    fireEvent.click(screen.getByRole("button", { name: /check in/i }))
    await waitFor(() => expect(toast.error).toHaveBeenCalled())
  })
})
