// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { PersonalCheckinClient } from "@/components/checkin/PersonalCheckinClient"

beforeEach(() => {
  vi.restoreAllMocks()
})

describe("PersonalCheckinClient", () => {
  it("greets the resolved client by name, then checks in on tap", async () => {
    const fetchMock = vi
      .fn()
      // initial GET → resolve name + balance
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ firstName: "Aean", remaining: 5 }) })
      // POST → check in
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ ok: true, remaining: 4 }) })
    global.fetch = fetchMock as never

    render(<PersonalCheckinClient token="t" />)

    await waitFor(() => expect(screen.getByRole("button", { name: /check in, aean/i })).toBeInTheDocument())
    expect(screen.queryByPlaceholderText(/search your name/i)).toBeNull()

    fireEvent.click(screen.getByRole("button", { name: /check in, aean/i }))
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith("/api/checkin/personal", expect.objectContaining({ method: "POST" })),
    )
    await waitFor(() => expect(screen.getByText(/you're in/i)).toBeInTheDocument())
  })

  it("re-reads the balance when the page comes back into view", async () => {
    // The link is a permanent bookmark, so the page is routinely opened from a
    // tab parked for days — and the coach may have tapped the client in from the
    // admin side since. A number fetched once at mount goes quietly wrong.
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ firstName: "Aean", remaining: 5 }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ firstName: "Aean", remaining: 3 }) })
    global.fetch = fetchMock as never

    render(<PersonalCheckinClient token="t" />)
    await waitFor(() => expect(screen.getByText(/5 sessions left/i)).toBeInTheDocument())

    document.dispatchEvent(new Event("visibilitychange"))

    await waitFor(() => expect(screen.getByText(/3 sessions left/i)).toBeInTheDocument())
    expect(screen.queryByText(/5 sessions left/i)).toBeNull()
  })

  it("keeps the confirmation on screen when the page is re-shown after a check-in", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ firstName: "Aean", remaining: 5 }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ ok: true, clientRemaining: 4 }) })
      .mockResolvedValue({ ok: true, status: 200, json: async () => ({ firstName: "Aean", remaining: 4 }) })
    global.fetch = fetchMock as never

    render(<PersonalCheckinClient token="t" />)
    await waitFor(() => expect(screen.getByRole("button", { name: /check in, aean/i })).toBeInTheDocument())
    fireEvent.click(screen.getByRole("button", { name: /check in, aean/i }))
    await waitFor(() => expect(screen.getByText(/you're in/i)).toBeInTheDocument())

    document.dispatchEvent(new Event("visibilitychange"))

    // A refresh must never drop the client back to the pre-tap screen, which
    // would read as "your check-in did not go through".
    await waitFor(() => expect(screen.getByText(/you're in/i)).toBeInTheDocument())
    expect(screen.queryByRole("button", { name: /check in, aean/i })).toBeNull()
  })

  it("reports the client's whole balance after check-in, not just the deducted pack's", async () => {
    // Two active packs: the check-in took a credit off one (2 left on it), but
    // the client still has 9 sessions in hand. The screen said 10 a moment ago,
    // so 2 would read as losing eight sessions in one tap.
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ firstName: "Aean", remaining: 10 }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ ok: true, remaining: 2, clientRemaining: 9 }) })
    global.fetch = fetchMock as never

    render(<PersonalCheckinClient token="t" />)
    await waitFor(() => expect(screen.getByRole("button", { name: /check in, aean/i })).toBeInTheDocument())
    fireEvent.click(screen.getByRole("button", { name: /check in, aean/i }))

    await waitFor(() => expect(screen.getByText(/9 sessions left/i)).toBeInTheDocument())
  })

  it("shows an expired-link state when the token resolve fails", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({}) }) as never
    render(<PersonalCheckinClient token="bad" />)
    await waitFor(() => expect(screen.getByText(/not valid/i)).toBeInTheDocument())
  })
})
