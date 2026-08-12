// Conversion moves a page between two screens while it is live. The dialog's
// job is to say what does NOT change, because the owner's reasonable fear is
// that a URL people are already visiting is about to move.

import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { ConvertToFunnelDialog } from "@/components/admin/funnels/ConvertToFunnelDialog"

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock("sonner", () => ({ toast }))

const push = vi.hoisted(() => vi.fn())
const refresh = vi.hoisted(() => vi.fn())
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh }) }))

beforeEach(() => {
  vi.clearAllMocks()
  global.fetch = vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ funnel: {} }),
  })) as unknown as typeof fetch
})

describe("<ConvertToFunnelDialog>", () => {
  it("promises the URL will not change", async () => {
    // MUTANT KILLED: a bare "Are you sure?" confirm. The one question the owner
    // has is whether a live address moves, and silence reads as "probably".
    render(<ConvertToFunnelDialog funnelId="f1" funnelName="Free Trial" />)
    fireEvent.click(screen.getByRole("button", { name: /convert to funnel/i }))
    expect(await screen.findByText(/does not change/i)).toBeInTheDocument()
  })

  it("PATCHes kind to funnel", async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>
    render(<ConvertToFunnelDialog funnelId="f1" funnelName="Free Trial" />)
    fireEvent.click(screen.getByRole("button", { name: /convert to funnel/i }))
    fireEvent.click(await screen.findByRole("button", { name: /^convert$/i }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe("/api/admin/funnels/f1")
    expect(init.method).toBe("PATCH")
    expect(JSON.parse(init.body as string)).toEqual({ kind: "funnel" })
  })

  it("sends the owner to the funnels screen afterwards", async () => {
    // MUTANT KILLED: only refreshing. The card has just left this screen, so
    // refreshing in place makes the page appear to have been deleted.
    render(<ConvertToFunnelDialog funnelId="f1" funnelName="Free Trial" />)
    fireEvent.click(screen.getByRole("button", { name: /convert to funnel/i }))
    fireEvent.click(await screen.findByRole("button", { name: /^convert$/i }))

    await waitFor(() => expect(push).toHaveBeenCalledWith("/admin/funnels"))
  })

  it("stays put and reports the error when the server refuses", async () => {
    // MUTANT KILLED: navigating unconditionally, which would tell the owner the
    // conversion worked and leave the page on the screen it never left.
    global.fetch = vi.fn(async () => ({
      ok: false,
      status: 500,
      json: async () => ({ error: "Could not convert this page." }),
    })) as unknown as typeof fetch

    render(<ConvertToFunnelDialog funnelId="f1" funnelName="Free Trial" />)
    fireEvent.click(screen.getByRole("button", { name: /convert to funnel/i }))
    fireEvent.click(await screen.findByRole("button", { name: /^convert$/i }))

    await waitFor(() => expect(toast.error).toHaveBeenCalled())
    expect(push).not.toHaveBeenCalled()
  })
})
