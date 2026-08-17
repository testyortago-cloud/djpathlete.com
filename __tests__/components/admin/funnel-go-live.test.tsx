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
    render(<FunnelGoLiveButton funnelId="f1" status="draft" kind="page" canGoLive />)
    expect(screen.getByRole("button", { name: /go live/i })).toBeEnabled()
  })

  it("PATCHes the funnel to published and says the page is live", async () => {
    // MUTANT KILLED: a button that only navigates, or PATCHes the wrong field.
    // The assertion reads the actual request body, so flipping `published` to
    // anything else fails.
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>
    render(<FunnelGoLiveButton funnelId="f1" status="draft" kind="page" canGoLive />)

    fireEvent.click(screen.getByRole("button", { name: /go live/i }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toBe("/api/admin/funnels/f1")
    expect((init as RequestInit).method).toBe("PATCH")
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ status: "published" })
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("This page is live."))
    // MUTANT: deleting `setCurrent(next)` from `setStatus`. THE NEGATIVE
    // ASSERTION IN "keeps the failure visible" CANNOT SEE THAT — it only ever
    // checks the label did NOT flip, so a control that never flips at all
    // passes it. Without this positive sibling the whole file stays green with
    // the state update removed, and the owner presses Go live, gets a success
    // toast, and watches the button go on saying "Go live".
    expect(await screen.findByRole("button", { name: /take offline/i })).toBeInTheDocument()
  })

  it("offers Take offline when it is already live, and PATCHes back to draft", async () => {
    // MUTANT KILLED: a one-way control. Going live must be reversible from the
    // same place, or the owner has to go hunting again to undo it.
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>
    render(<FunnelGoLiveButton funnelId="f1" status="published" kind="page" canGoLive />)

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
    render(<FunnelGoLiveButton funnelId="f1" status="draft" kind="page" canGoLive={false} />)

    const button = screen.getByRole("button", { name: /go live/i })
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute("title", expect.stringMatching(/publish the page first/i))
  })

  it("does not fire a request when there is nothing to serve", () => {
    // MUTANT KILLED: `disabled` as styling only. A funnel with no compiled page
    // going live serves a reachable URL that renders nothing — worse than a
    // 404, because it looks deliberate.
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>
    render(<FunnelGoLiveButton funnelId="f1" status="draft" kind="page" canGoLive={false} />)

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

    render(<FunnelGoLiveButton funnelId="f1" status="draft" kind="page" canGoLive />)
    fireEvent.click(screen.getByRole("button", { name: /go live/i }))

    await waitFor(() => expect(toast.error).toHaveBeenCalled())
    expect(screen.getByRole("button", { name: /go live/i })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /take offline/i })).not.toBeInTheDocument()
    expect(toast.success).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// A FUNNEL IS NOT A LANDING PAGE, and this button is on the card for both.
//
// `canGoLive` means "the ENTRY page has a published version" — it says nothing
// about pages 2..N. So on a five-step funnel this control could PATCH
// `status:"published"` with four unbuilt pages behind it, producing a live
// funnel whose own buttons 404: the exact split the funnel-wide publish route
// exists to make unreachable. The board is the third doorway onto that
// operation, so it goes through the same door.
// ---------------------------------------------------------------------------
describe("<FunnelGoLiveButton> — a funnel goes live through the guarded route", () => {
  /** The 200 the funnel-wide route sends. */
  const published = {
    ok: true,
    status: 200,
    json: async () => ({
      published: 3,
      pages: [
        { stepId: "s1", stepName: "Opt-in", version: 2 },
        { stepId: "s2", stepName: "Offer", version: 1 },
        { stepId: "s3", stepName: "Thank you", version: 1 },
      ],
      warnings: [],
    }),
  }

  it("publishes a FUNNEL through the funnel-wide route, not PATCH status", async () => {
    // MUTANT KILLED: leaving the PATCH. That route writes `status` without
    // reading a single step — this card was the last surface that could still
    // take a funnel live with unbuilt pages behind it.
    const fetchMock = vi.fn(async () => published)
    global.fetch = fetchMock as unknown as typeof fetch

    render(<FunnelGoLiveButton funnelId="f1" status="draft" kind="funnel" canGoLive />)
    fireEvent.click(screen.getByRole("button", { name: /go live/i }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit | undefined]
    expect(String(url)).toBe("/api/admin/funnels/f1/publish")
    expect(init?.method).toBe("POST")
    await waitFor(() => expect(toast.success).toHaveBeenCalled())
    expect(String(toast.success.mock.calls[0][0])).toMatch(/funnel is live/i)
    // MUTANT: deleting `setCurrent("published")` from `goLive`. Same unpaired
    // -negative trap as the page path above: this describe block asserts the
    // label does NOT become "Take offline" after a 422, and nothing asserted it
    // DOES after a 200 — so the state update could be removed with the file
    // still green, leaving the card claiming a draft over a funnel that is live.
    // `funnel-status-control.test.tsx` pairs its own negative this way.
    expect(await screen.findByRole("button", { name: /take offline/i })).toBeInTheDocument()
  })

  it("reports a refusal, naming the page, instead of claiming success", async () => {
    // MUTANT KILLED: `toast.success` regardless of status, or a bare "could not
    // publish". A funnel has several pages; not naming the one that refused
    // sends the owner to open all of them.
    global.fetch = vi.fn(async () => ({
      ok: false,
      status: 422,
      json: async () => ({
        error: "This funnel could not be published.",
        pages: [{ stepId: "s2", stepName: "Thank you", problems: ["It has no content yet."], blank: true }],
      }),
    })) as unknown as typeof fetch

    render(<FunnelGoLiveButton funnelId="f1" status="draft" kind="funnel" canGoLive />)
    fireEvent.click(screen.getByRole("button", { name: /go live/i }))

    await waitFor(() => expect(toast.error).toHaveBeenCalled())
    const message = String(toast.error.mock.calls[0][0])
    expect(message).toContain("Thank you")
    expect(message).toContain("It has no content yet.")
    expect(toast.success).not.toHaveBeenCalled()
    // Still offering to go live, because it did not.
    expect(screen.getByRole("button", { name: /go live/i })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /take offline/i })).toBeNull()
  })

  it("does not refuse a funnel just because its entry page has no version yet", async () => {
    // MUTANT KILLED: keeping `canGoLive` as the gate for funnels as well. It
    // means "the ENTRY page has a published version", and the funnel route
    // publishes every page's stored DRAFT — so the disabled button's own advice
    // ("publish the page first") is now telling the owner to go and do by hand
    // the exact thing the button does. A control that refuses for a reason that
    // stopped being true is the `silent_gate_reads_as_broken` pattern this
    // button was added to fix. The route is the gate; it names what it refuses.
    // The parameters are DECLARED: `vi.fn(async () => …)` types `mock.calls` as
    // a zero-length tuple, so reading `calls[0][0]` is a type error — and the
    // URL is the entire point of the assertion.
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => published)
    global.fetch = fetchMock as unknown as typeof fetch

    render(<FunnelGoLiveButton funnelId="f1" status="draft" kind="funnel" canGoLive={false} />)
    const button = screen.getByRole("button", { name: /go live/i })
    expect(button).toBeEnabled()

    fireEvent.click(button)
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(String(fetchMock.mock.calls[0][0])).toBe("/api/admin/funnels/f1/publish")
  })

  it("carries what the compiler changed into the success toast", async () => {
    // MUTANT KILLED: dropping `result.warnings`, which is what shipped here and
    // on `FunnelStatusControl`. This card is a row on a list — there is no
    // result strip anywhere near it — so a toast that ignores the warnings is
    // the only place they could have been said, and it says nothing.
    global.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        published: 3,
        pages: [],
        warnings: ["A custom font on Offer could not be carried over."],
      }),
    })) as unknown as typeof fetch

    render(<FunnelGoLiveButton funnelId="f1" status="draft" kind="funnel" canGoLive />)
    fireEvent.click(screen.getByRole("button", { name: /go live/i }))

    await waitFor(() => expect(toast.success).toHaveBeenCalled())
    expect(String(toast.success.mock.calls[0][0])).toContain("A custom font on Offer could not be carried over.")
  })

  it("does not read a route's internal error out to the owner", async () => {
    // MUTANT KILLED: `error ?? fallback` with no status check. A 24-hour
    // session expiring mid-session makes this route answer 403
    // `{error: "Forbidden"}`, and the owner read a toast saying "Forbidden".
    global.fetch = vi.fn(async () => ({
      ok: false,
      status: 500,
      json: async () => ({ error: "supabaseAdmin.from is not a function" }),
    })) as unknown as typeof fetch

    render(<FunnelGoLiveButton funnelId="f1" status="draft" kind="funnel" canGoLive />)
    fireEvent.click(screen.getByRole("button", { name: /go live/i }))

    await waitFor(() => expect(toast.error).toHaveBeenCalled())
    const message = String(toast.error.mock.calls[0][0])
    expect(message).not.toContain("supabaseAdmin")
    expect(message).toMatch(/could not publish this funnel/i)
    // ...and the 422 the route DOES write for the owner still comes through in
    // full — asserted two tests up, so this rule mutes the right half only.
  })

  it("takes a funnel offline through PATCH, unchanged", async () => {
    // MUTANT KILLED: routing the un-publish through the publish endpoint too.
    // Hiding a broken funnel must not be gated on the funnel being unbroken.
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }))
    global.fetch = fetchMock as unknown as typeof fetch

    render(<FunnelGoLiveButton funnelId="f1" status="published" kind="funnel" canGoLive />)
    fireEvent.click(screen.getByRole("button", { name: /take offline/i }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit | undefined]
    expect(String(url)).toBe("/api/admin/funnels/f1")
    expect(init?.method).toBe("PATCH")
    expect(JSON.parse(init?.body as string)).toEqual({ status: "draft" })
  })
})
