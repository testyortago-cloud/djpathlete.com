// @vitest-environment jsdom
// __tests__/components/admin/sequences/SequenceSwitch.test.tsx
//
// The on/off control shared by the sequences list and detail screen.
// Turning ON confirms first — it starts sending real email and texts to real
// people and lets anyone held while the sequence was off resume, possibly
// within minutes. Turning OFF is the safe direction and goes straight to the
// server. See the component's own header for the full reasoning.

import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react"
import { SequenceSwitch } from "@/components/admin/sequences/SequenceSwitch"

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }))
vi.mock("sonner", () => ({ toast }))

// next/navigation's useRouter is globally mocked in __tests__/setup.tsx.

beforeEach(() => {
  vi.clearAllMocks()
})

describe("<SequenceSwitch> — reading the current state", () => {
  it("renders on for an active sequence", () => {
    render(<SequenceSwitch sequenceKey="cold_lead" sequenceName="Cold Lead" status="active" />)
    expect(screen.getByRole("switch")).toHaveAttribute("data-state", "checked")
  })

  it("renders off for a paused sequence — this is the state 00256 makes matter", () => {
    // MUTANT this guards against: deriving the switch's reading from
    // `status !== "draft"` instead of `status === "active"`. That mutant
    // would read "paused" as ON, which is exactly backwards for the sequence
    // an operator most needs to see is off.
    render(<SequenceSwitch sequenceKey="cold_lead" sequenceName="Cold Lead" status="paused" />)
    expect(screen.getByRole("switch")).toHaveAttribute("data-state", "unchecked")
  })

  it("renders off for a draft sequence too — never turned on is still off", () => {
    // Presence control for the mutant above: `status !== "draft"` would pass
    // THIS test (draft correctly reads unchecked) while failing the paused
    // one, so the two together are what pin `=== "active"` specifically.
    render(<SequenceSwitch sequenceKey="cold_lead" sequenceName="Cold Lead" status="draft" />)
    expect(screen.getByRole("switch")).toHaveAttribute("data-state", "unchecked")
  })
})

describe("<SequenceSwitch> — turning on confirms first", () => {
  it("opens a confirm dialog and does not call the route until confirmed", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
    }) as unknown as typeof fetch

    render(<SequenceSwitch sequenceKey="cold_lead" sequenceName="Cold Lead" status="paused" />)
    fireEvent.click(screen.getByRole("switch"))

    const dialog = await screen.findByRole("alertdialog")
    expect(dialog).toHaveTextContent(/switch on/i)
    expect(dialog).toHaveTextContent(/start getting these emails and texts straight away/i)
    expect(dialog).toHaveTextContent(/pick up where they left off/i)
    expect(dialog).toHaveTextContent(/quiet hours/i)

    // MUTANT this guards against: calling the route from onCheckedChange
    // itself before the dialog is confirmed.
    expect(global.fetch).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole("button", { name: /^switch on$/i }))

    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1))
    const [url, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(url).toBe("/api/admin/sequences/cold_lead/status")
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ on: true })
    await waitFor(() => expect(toast.success).toHaveBeenCalled())
  })

  it("calling cancel leaves the switch off and never calls the route", async () => {
    global.fetch = vi.fn()
    render(<SequenceSwitch sequenceKey="cold_lead" sequenceName="Cold Lead" status="paused" />)
    fireEvent.click(screen.getByRole("switch"))
    const dialog = await screen.findByRole("alertdialog")
    fireEvent.click(within(dialog).getByRole("button", { name: /cancel/i }))
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument())
    expect(global.fetch).not.toHaveBeenCalled()
    expect(screen.getByRole("switch")).toHaveAttribute("data-state", "unchecked")
  })
})

describe("<SequenceSwitch> — turning off is the safe direction", () => {
  it("calls the route directly, with no confirmation dialog", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
    }) as unknown as typeof fetch

    render(<SequenceSwitch sequenceKey="cold_lead" sequenceName="Cold Lead" status="active" />)
    fireEvent.click(screen.getByRole("switch"))

    // No dialog at all — turning off must never wait on one.
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument()

    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1))
    const [url, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(url).toBe("/api/admin/sequences/cold_lead/status")
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ on: false })
    await waitFor(() => expect(toast.success).toHaveBeenCalled())
  })
})

describe("<SequenceSwitch> — a failed call", () => {
  it("surfaces a message and leaves the switch where it was, for turning off", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ error: "Could not reach the database" }),
    }) as unknown as typeof fetch

    render(<SequenceSwitch sequenceKey="cold_lead" sequenceName="Cold Lead" status="active" />)
    fireEvent.click(screen.getByRole("switch"))

    await waitFor(() => expect(toast.error).toHaveBeenCalled())
    // PRESENCE CONTROL: still "on" — a switch that never rendered anything
    // would also satisfy "not unchecked", so this pins the checked state
    // explicitly rather than merely the absence of "unchecked".
    expect(screen.getByRole("switch")).toHaveAttribute("data-state", "checked")
  })

  it("surfaces a message and leaves the switch where it was, for turning on", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ error: "Could not reach the database" }),
    }) as unknown as typeof fetch

    render(<SequenceSwitch sequenceKey="cold_lead" sequenceName="Cold Lead" status="paused" />)
    fireEvent.click(screen.getByRole("switch"))
    fireEvent.click(await screen.findByRole("button", { name: /^switch on$/i }))

    await waitFor(() => expect(toast.error).toHaveBeenCalled())
    expect(screen.getByRole("switch")).toHaveAttribute("data-state", "unchecked")
  })

  it("surfaces a message on a network error too, not just a non-ok response", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("network down"))
    render(<SequenceSwitch sequenceKey="cold_lead" sequenceName="Cold Lead" status="active" />)
    fireEvent.click(screen.getByRole("switch"))

    await waitFor(() => expect(toast.error).toHaveBeenCalled())
    expect(screen.getByRole("switch")).toHaveAttribute("data-state", "checked")
  })
})
