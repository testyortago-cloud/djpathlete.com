// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { CheckinClient } from "@/components/checkin/CheckinClient"

beforeEach(() => {
  vi.restoreAllMocks()
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ ok: true, remaining: 4 }),
  }) as never
})

describe("CheckinClient self mode", () => {
  it("shows a single self check-in button when `me` is provided and posts to /api/checkin/self", async () => {
    render(<CheckinClient token="t" me={{ firstName: "Aean", remaining: 5 }} />)
    expect(screen.queryByPlaceholderText(/search your name/i)).toBeNull()
    const btn = screen.getByRole("button", { name: /check in/i })
    fireEvent.click(btn)
    await waitFor(() =>
      expect(global.fetch).toHaveBeenCalledWith("/api/checkin/self", expect.objectContaining({ method: "POST" })),
    )
    await waitFor(() => expect(screen.getByText(/you're in/i)).toBeInTheDocument())
  })
})
