// @vitest-environment jsdom
// __tests__/components/admin/sequences/SequenceCooldownField.test.tsx
//
// The one editable setting on the sequence detail screen: how many days a
// person must be out of this sequence before a trigger may put them back in
// (migration 00263). No local optimistic state beyond the input itself — the
// starting value is the prop, a save PATCHes the settings route, and success
// refreshes the server component so the prop comes back with the stored value.

import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { SequenceCooldownField } from "@/components/admin/sequences/SequenceCooldownField"

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }))
vi.mock("sonner", () => ({ toast }))

// next/navigation's useRouter is globally mocked in __tests__/setup.tsx.

beforeEach(() => {
  vi.clearAllMocks()
})

function renderField(value = 30) {
  return render(<SequenceCooldownField sequenceKey="cold_lead" sequenceName="Cold Lead" value={value} />)
}

describe("<SequenceCooldownField> — reading", () => {
  it("shows the stored value in a labelled number input", () => {
    renderField(14)
    const input = screen.getByLabelText(/days before someone can enter again/i) as HTMLInputElement
    expect(input.type).toBe("number")
    expect(input.value).toBe("14")
  })

  it("explains 0 in words, because 0 is what the quiz sequences carry", () => {
    renderField(0)
    expect(screen.getByText(/can enter again straight away/i)).toBeInTheDocument()
  })
})

describe("<SequenceCooldownField> — saving", () => {
  it("PATCHes the settings route with the typed value, and says so", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, sequenceKey: "cold_lead", from: 30, to: 14 }),
    }) as unknown as typeof fetch

    renderField(30)
    const input = screen.getByLabelText(/days before someone can enter again/i)
    fireEvent.change(input, { target: { value: "14" } })
    fireEvent.click(screen.getByRole("button", { name: /save/i }))

    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1))
    const [url, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(url).toBe("/api/admin/sequences/cold_lead/settings")
    expect(init.method).toBe("PATCH")
    expect(JSON.parse(init.body)).toEqual({ reenrolCooldownDays: 14 })
    await waitFor(() => expect(toast.success).toHaveBeenCalled())
  })

  it("does nothing when the value has not changed — no request, no toast", async () => {
    global.fetch = vi.fn()
    renderField(30)
    fireEvent.click(screen.getByRole("button", { name: /save/i }))
    expect(global.fetch).not.toHaveBeenCalled()
    expect(toast.success).not.toHaveBeenCalled()
  })

  it("shows the route's own error message when the save is refused for a reason the client cannot predict", async () => {
    // A value the client accepts (14 is in range) that the server refuses —
    // here, a key that turns out not to be this tenant's. The message on
    // screen must be the route's, not a generic one.
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ error: "Sequence not found." }),
    }) as unknown as typeof fetch

    renderField(30)
    fireEvent.change(screen.getByLabelText(/days before someone can enter again/i), { target: { value: "14" } })
    fireEvent.click(screen.getByRole("button", { name: /save/i }))

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Sequence not found."))
    expect(toast.success).not.toHaveBeenCalled()
  })

  it("saves the two edges the route accepts, 0 and 365 — pins `>= 0` and `<= 365`, not `>`/`<`", async () => {
    for (const [start, typed] of [
      [30, "0"],
      [30, "365"],
    ] as const) {
      global.fetch = vi
        .fn()
        .mockResolvedValue({ ok: true, json: async () => ({ ok: true }) }) as unknown as typeof fetch
      const { unmount } = renderField(start)
      fireEvent.change(screen.getByLabelText(/days before someone can enter again/i), { target: { value: typed } })
      fireEvent.click(screen.getByRole("button", { name: /save/i }))
      await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1))
      const [, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
      expect(JSON.parse(init.body)).toEqual({ reenrolCooldownDays: Number(typed) })
      unmount()
    }
  })

  it("refuses a fraction without a round trip — the column is whole days", async () => {
    global.fetch = vi.fn()
    renderField(30)
    fireEvent.change(screen.getByLabelText(/days before someone can enter again/i), { target: { value: "1.5" } })
    fireEvent.click(screen.getByRole("button", { name: /save/i }))
    expect(global.fetch).not.toHaveBeenCalled()
    await waitFor(() => expect(toast.error).toHaveBeenCalled())
  })

  it("refuses to send a value outside 0–365 without a round trip", async () => {
    global.fetch = vi.fn()
    renderField(30)
    fireEvent.change(screen.getByLabelText(/days before someone can enter again/i), { target: { value: "-3" } })
    fireEvent.click(screen.getByRole("button", { name: /save/i }))
    expect(global.fetch).not.toHaveBeenCalled()
    await waitFor(() => expect(toast.error).toHaveBeenCalled())
  })
})
