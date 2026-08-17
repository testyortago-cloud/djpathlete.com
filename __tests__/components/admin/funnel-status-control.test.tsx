// __tests__/components/admin/funnel-status-control.test.tsx
//
// THE FUNNEL DETAIL PAGE'S PUBLISH BUTTON, which was the second unguarded way
// to produce the state this whole feature exists to remove: a funnel whose row
// says `published` while pages 2..N have never been built, so its own buttons
// 404. `PATCH /api/admin/funnels/[id]` validates a body and writes; it does not
// read a single step. `POST /api/admin/funnels/[id]/publish` gates every page
// first and flips the row last.
//
// A LANDING PAGE KEEPS THE PATCH, deliberately — see the component's comment.
//
// Every test names the mutant it kills. The easy vacuous test here is asserting
// "fetch was called": both paths call fetch, so only the URL and the method
// tell the guarded operation from the unguarded one.

import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, waitFor, fireEvent } from "@testing-library/react"
import { FunnelStatusControl } from "@/components/admin/funnels/FunnelStatusControl"

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }))
vi.mock("sonner", () => ({ toast }))

// next/navigation is globally mocked in __tests__/setup.tsx.

/** The 200 the funnel-wide route sends: what it wrote, page by page. */
function publishedResponse(pages = 3) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      published: pages,
      pages: Array.from({ length: pages }, (_, index) => ({
        stepId: `s${index + 1}`,
        stepName: `Page ${index + 1}`,
        version: 1,
      })),
      warnings: [],
    }),
  }
}

function mockFetch(response: unknown) {
  const fetchMock = vi.fn(async () => response)
  global.fetch = fetchMock as unknown as typeof fetch
  return fetchMock
}

beforeEach(() => {
  vi.clearAllMocks()
  mockFetch(publishedResponse())
})

describe("<FunnelStatusControl> — publishing a funnel", () => {
  it("publishes a FUNNEL through the funnel-wide route, not PATCH status", async () => {
    // MUTANT KILLED: leaving the PATCH. That route writes `status` without
    // reading a single step, which is how a funnel goes live with three unbuilt
    // pages behind it — the defect this whole feature exists to close.
    const fetchMock = mockFetch(publishedResponse())
    render(<FunnelStatusControl funnelId="f1" status="draft" kind="funnel" />)

    fireEvent.click(screen.getByRole("button", { name: /publish funnel/i }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit | undefined]
    expect(String(url)).toBe("/api/admin/funnels/f1/publish")
    expect(init?.method).toBe("POST")
  })

  it("says the funnel is live, and flips the badge, only after a 200", async () => {
    // MUTANT KILLED: `setCurrent` / `toast.success` before the status check.
    render(<FunnelStatusControl funnelId="f1" status="draft" kind="funnel" />)
    fireEvent.click(screen.getByRole("button", { name: /publish funnel/i }))

    await waitFor(() => expect(toast.success).toHaveBeenCalled())
    expect(String(toast.success.mock.calls[0][0])).toMatch(/live/i)
    expect(await screen.findByRole("button", { name: /unpublish/i })).toBeInTheDocument()
  })

  it("reports a refusal instead of claiming success", async () => {
    // fetch -> 422 { pages: [...] }
    // MUTANT KILLED: `toast.success` regardless of status. The screen would say
    // the funnel is live while it is not — the same class of lie as a badge
    // reading "published" over a URL that 404s.
    mockFetch({
      ok: false,
      status: 422,
      json: async () => ({
        error: "This funnel could not be published.",
        pages: [{ stepId: "s2", stepName: "Thank you", problems: ["It has no content yet."], blank: true }],
      }),
    })

    render(<FunnelStatusControl funnelId="f1" status="draft" kind="funnel" />)
    fireEvent.click(screen.getByRole("button", { name: /publish funnel/i }))

    await waitFor(() => expect(toast.error).toHaveBeenCalled())
    expect(toast.success).not.toHaveBeenCalled()
    // Still a draft on screen: the badge and the button both still say so.
    expect(screen.getByRole("button", { name: /publish funnel/i })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /unpublish/i })).toBeNull()
  })

  it("names the page that refused, rather than only that something did", async () => {
    // MUTANT KILLED: `toast.error("Could not publish this funnel.")` and
    // dropping `pages`. A funnel has four pages; "could not publish" alone
    // sends the owner to open all four to find the one that is wrong.
    mockFetch({
      ok: false,
      status: 422,
      json: async () => ({
        error: "This funnel could not be published.",
        pages: [{ stepId: "s2", stepName: "Thank you", problems: ["It has no content yet."], blank: true }],
      }),
    })

    render(<FunnelStatusControl funnelId="f1" status="draft" kind="funnel" />)
    fireEvent.click(screen.getByRole("button", { name: /publish funnel/i }))

    await waitFor(() => expect(toast.error).toHaveBeenCalled())
    const message = String(toast.error.mock.calls[0][0])
    expect(message).toContain("Thank you")
    expect(message).toContain("It has no content yet.")
  })

  it("does not read a route's internal error out to the owner", async () => {
    // MUTANT KILLED: `error ?? fallback` with no status check, which is what
    // shipped. `auth()` answers an expired 24-hour session with
    // `{error: "Forbidden"}` — so the owner pressed Publish and read a toast
    // that said, in full, "Forbidden". The path this replaced said "Could not
    // change the status."
    //
    // The status is the whole of the rule: 400 and 422 are the two the route
    // writes for the owner (and the 422 case is asserted directly above, so
    // this cannot be passing by muting everything).
    mockFetch({ ok: false, status: 403, json: async () => ({ error: "Forbidden" }) })

    render(<FunnelStatusControl funnelId="f1" status="draft" kind="funnel" />)
    fireEvent.click(screen.getByRole("button", { name: /publish funnel/i }))

    await waitFor(() => expect(toast.error).toHaveBeenCalled())
    const message = String(toast.error.mock.calls[0][0])
    expect(message).not.toContain("Forbidden")
    expect(message).toMatch(/could not publish this funnel/i)
  })

  it("carries what the compiler changed into the success toast", async () => {
    // MUTANT KILLED: `publishedSummary(result.published)` with the warnings
    // dropped — which is what shipped, on BOTH toast-only surfaces. The route
    // collects `result.warnings` per page on purpose (`route.ts:216`); a card
    // on a list has no strip to put them in, so a toast that ignores them
    // loses them altogether. "Collected and then ignored" is this path's own
    // recorded failure, twice.
    mockFetch({
      ok: true,
      status: 200,
      json: async () => ({
        published: 2,
        pages: [],
        warnings: ["The video embed on Thank you was removed."],
      }),
    })

    render(<FunnelStatusControl funnelId="f1" status="draft" kind="funnel" />)
    fireEvent.click(screen.getByRole("button", { name: /publish funnel/i }))

    await waitFor(() => expect(toast.success).toHaveBeenCalled())
    expect(String(toast.success.mock.calls[0][0])).toContain("The video embed on Thank you was removed.")
  })

  it("unpublishes through PATCH, unchanged", async () => {
    // MUTANT KILLED: routing the un-publish through the publish endpoint too.
    // Taking a funnel OFF the air has nothing to gate — refusing to hide a
    // broken funnel because it is broken would be exactly backwards.
    const fetchMock = mockFetch({ ok: true, status: 200, json: async () => ({}) })
    render(<FunnelStatusControl funnelId="f1" status="published" kind="funnel" />)

    fireEvent.click(screen.getByRole("button", { name: /unpublish/i }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit | undefined]
    expect(String(url)).toBe("/api/admin/funnels/f1")
    expect(init?.method).toBe("PATCH")
    expect(JSON.parse(init?.body as string)).toEqual({ status: "draft" })
  })
})

describe("<FunnelStatusControl> — a landing page keeps the PATCH", () => {
  it("still PATCHes for a landing page", async () => {
    // MUTANT KILLED: routing pages through the funnel planner too. A landing
    // page's single step is already gated by the step publish route, and its
    // publish already flips the row — a second path with no second page to
    // justify it.
    const fetchMock = mockFetch({ ok: true, status: 200, json: async () => ({}) })
    render(<FunnelStatusControl funnelId="f1" status="draft" kind="page" />)

    fireEvent.click(screen.getByRole("button", { name: /publish landing page/i }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit | undefined]
    expect(String(url)).toBe("/api/admin/funnels/f1")
    expect(init?.method).toBe("PATCH")
    expect(JSON.parse(init?.body as string)).toEqual({ status: "published" })
  })

  it("calls a landing page a landing page, never a funnel", async () => {
    // The owner said so: "the landing page still says its not a funnel yet
    // which isnt true its different". This is the one button that makes it
    // public, so the wrong noun here reads as the wrong screen.
    render(<FunnelStatusControl funnelId="f1" status="draft" kind="page" />)
    fireEvent.click(screen.getByRole("button", { name: /publish landing page/i }))

    await waitFor(() => expect(toast.success).toHaveBeenCalled())
    expect(String(toast.success.mock.calls[0][0])).toMatch(/landing page is live/i)
  })
})
