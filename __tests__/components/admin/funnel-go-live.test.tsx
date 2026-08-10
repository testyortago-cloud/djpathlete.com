// __tests__/components/admin/funnel-go-live.test.tsx
//
// "Publish" means two different things in this product, and the second one was
// invisible. Publishing a PAGE writes a version row. Publishing the FUNNEL is
// what makes /go/<slug> reachable. The owner did the first on production, was
// told "Published version 1", and got a 404 — because the control for the
// second lived one navigation away, on a page that otherwise just repeats the
// card he was already looking at.
//
// Every test here names the mutant it kills. This repo's dominant defect class
// is tests that cannot fail, and a badge test is an easy place to write one:
// asserting "the word live appears somewhere" passes against a card that says
// "live" unconditionally, which is the exact bug being fixed.

import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, waitFor, fireEvent } from "@testing-library/react"
import { FunnelGoLiveButton } from "@/components/admin/funnels/FunnelGoLiveButton"

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }))
vi.mock("sonner", () => ({ toast }))

// next/navigation is globally mocked in __tests__/setup.tsx.

beforeEach(() => {
  vi.clearAllMocks()
  global.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) })) as unknown as typeof fetch
})

describe("<FunnelGoLiveButton>", () => {
  it("offers Go live when the page has a version but the funnel is a draft", () => {
    // MUTANT KILLED: rendering "Take offline" (or nothing) in the draft state —
    // i.e. the shipped behaviour, where this control did not exist on the list
    // at all and the only way to go live was a page the owner never opened.
    render(<FunnelGoLiveButton funnelId="f1" status="draft" canGoLive />)
    expect(screen.getByRole("button", { name: /go live/i })).toBeEnabled()
  })

  it("PATCHes the funnel to published and says the page is live", async () => {
    // MUTANT KILLED: a button that only navigates, or PATCHes the wrong field.
    // The assertion reads the actual request body, so flipping `published` to
    // anything else fails.
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>
    render(<FunnelGoLiveButton funnelId="f1" status="draft" canGoLive />)

    fireEvent.click(screen.getByRole("button", { name: /go live/i }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toBe("/api/admin/funnels/f1")
    expect((init as RequestInit).method).toBe("PATCH")
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ status: "published" })
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("This page is live."))
  })

  it("offers Take offline when it is already live, and PATCHes back to draft", async () => {
    // MUTANT KILLED: a one-way control. Going live must be reversible from the
    // same place, or the owner has to go hunting again to undo it.
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>
    render(<FunnelGoLiveButton funnelId="f1" status="published" canGoLive />)

    fireEvent.click(screen.getByRole("button", { name: /take offline/i }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)).toEqual({
      status: "draft",
    })
  })

  it("disables Go live — with a reason — when no page has been published yet", () => {
    // MUTANT KILLED: omitting the control entirely in this state, which is the
    // pattern that caused all of this. A missing button is indistinguishable
    // from a broken one; the disabled button carries the explanation.
    render(<FunnelGoLiveButton funnelId="f1" status="draft" canGoLive={false} />)

    const button = screen.getByRole("button", { name: /go live/i })
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute("title", expect.stringMatching(/publish the page first/i))
  })

  it("does not fire a request when there is nothing to serve", () => {
    // MUTANT KILLED: `disabled` as styling only. A funnel with no compiled page
    // going live serves a reachable URL that renders nothing — worse than a
    // 404, because it looks deliberate.
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>
    render(<FunnelGoLiveButton funnelId="f1" status="draft" canGoLive={false} />)

    fireEvent.click(screen.getByRole("button", { name: /go live/i }))
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("keeps the failure visible instead of reporting a success it did not get", async () => {
    // MUTANT KILLED: optimistic `setCurrent(next)` before checking `response.ok`,
    // which would flip the label to "Take offline" over a funnel still in draft
    // — the same class of lie as a page badge reading "published" while the URL
    // 404s.
    global.fetch = vi.fn(async () => ({
      ok: false,
      status: 500,
      json: async () => ({}),
    })) as unknown as typeof fetch

    render(<FunnelGoLiveButton funnelId="f1" status="draft" canGoLive />)
    fireEvent.click(screen.getByRole("button", { name: /go live/i }))

    await waitFor(() => expect(toast.error).toHaveBeenCalled())
    expect(screen.getByRole("button", { name: /go live/i })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /take offline/i })).not.toBeInTheDocument()
    expect(toast.success).not.toHaveBeenCalled()
  })
})
