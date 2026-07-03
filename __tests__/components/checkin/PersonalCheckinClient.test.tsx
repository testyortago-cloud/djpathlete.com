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

  it("shows an expired-link state when the token resolve fails", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({}) }) as never
    render(<PersonalCheckinClient token="bad" />)
    await waitFor(() => expect(screen.getByText(/not valid/i)).toBeInTheDocument())
  })
})
