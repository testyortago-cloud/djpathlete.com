// The split is the whole feature, and it lives here. A board that renders the
// same chrome for both kinds would look done and be exactly the thing the owner
// complained about.
//
// RETARGETED FROM `FunnelBoard`, WHICH IS DELETED. Both screens render
// `FunnelList` now. Not one assertion below changed: the guarantees are about
// what the two boards must never share -- vocabulary, the goal badge, the
// create dialog, and above all WHICH WRITE go-live fires -- and merging the two
// components is exactly the moment those are most likely to be lost. Retargeted
// rather than deleted for that reason.

import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { toast } from "sonner"
import { FunnelList } from "@/components/admin/funnels/FunnelList"
import type { Funnel, FunnelStep } from "@/types/database"

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const funnel = (over: Partial<Funnel> = {}): Funnel => ({
  id: "f1",
  slug: "free-trial",
  name: "Free Trial",
  description: "For HS athletes.",
  status: "published",
  kind: "page",
  goal: "leads",
  created_by: null,
  created_at: "",
  updated_at: "",
  ...over,
})

const step = (over: Partial<FunnelStep> = {}): FunnelStep =>
  ({
    id: "s1",
    funnel_id: "f1",
    slug: "index",
    name: "Landing page",
    position: 0,
    is_entry: true,
    published_version_id: "v1",
    project_data: null,
    ...over,
  }) as FunnelStep

beforeEach(() => vi.clearAllMocks())

/**
 * Deletes the only card on screen and hands back what the owner was asked and
 * what they were told.
 *
 * Both come from the SAME call, because the bug was that they disagreed: the
 * confirmation named the landing page and the toast that followed announced a
 * funnel.
 */
async function deleteTheOnlyCard() {
  // Both mocks declare their parameters. `vi.fn(() => true)` types `mock.calls`
  // as a zero-length tuple, so reading `calls[0][0]` is a type error — and the
  // arguments are the entire point of this helper.
  const confirm = vi.fn((_message?: string) => true)
  vi.stubGlobal("confirm", confirm)
  const fetchMock = vi.fn(
    async (_url: string, _init?: RequestInit) => new Response(JSON.stringify({ ok: true }), { status: 200 }),
  )
  vi.stubGlobal("fetch", fetchMock)

  fireEvent.click(screen.getByRole("button", { name: /^delete /i }))
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))

  return {
    asked: String(confirm.mock.calls[0]?.[0] ?? ""),
    told: String((toast.success as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]?.[0] ?? ""),
    url: String(fetchMock.mock.calls[0]?.[0] ?? ""),
  }
}

describe("the landing pages board", () => {
  it("offers the landing page dialog, not a bare input", () => {
    // MUTANT KILLED: leaving the inline "New landing page name" input in place,
    // which is the control this whole feature replaces.
    render(<FunnelList kind="page" funnels={[]} leadCounts={{}} />)
    expect(screen.getByRole("button", { name: /new landing page/i })).toBeInTheDocument()
    expect(screen.queryByPlaceholderText(/new landing page name/i)).not.toBeInTheDocument()
  })

  it("teaches the flow when there is nothing yet", () => {
    // MUTANT KILLED: the old one-line "No landing pages yet." empty state,
    // which told a first-time owner nothing about what this screen makes.
    render(<FunnelList kind="page" funnels={[]} leadCounts={{}} />)
    expect(screen.getByText(/one focused page/i)).toBeInTheDocument()
  })

  it("shows the goal badge on a page card", () => {
    render(
      <FunnelList kind="page" funnels={[{ funnel: funnel(), steps: [step()] }]}
        leadCounts={{}}
      />,
    )
    expect(screen.getByText("Capture leads")).toBeInTheDocument()
  })

  it("calls a deleted landing page a landing page, in the question AND in the answer", async () => {
    // MUTANT KILLED: `toast.success(deletingFunnel ? "Funnel deleted." : …)`,
    // which is what shipped. Deleting a landing page's entry step deletes the
    // `funnels` row underneath it, and the message was written from the
    // ENDPOINT rather than from the row — so the owner deleted a landing page
    // on the landing pages screen and was told a funnel had gone. The URL
    // assertion is here to pin that the endpoint is unchanged: the wording is
    // the bug, and "fixing" it by deleting something else would be worse.
    render(
      <FunnelList kind="page" funnels={[{ funnel: funnel(), steps: [step()] }]} leadCounts={{}} />,
    )

    const { asked, told, url } = await deleteTheOnlyCard()
    expect(url).toContain("/api/admin/funnels/f1")
    expect(told).toBe("Landing page deleted.")
    expect(asked).toContain("landing page")
    // A landing page has exactly one page, so "and all of its pages" describes
    // a funnel and nothing else.
    expect(asked).not.toContain("all of its pages")
  })

  it("takes a landing page live with the PATCH its single step already gates", async () => {
    // The other half of the pair below. Without it, "route through the funnel
    // planner" could be satisfied by routing EVERYTHING through it — a second
    // code path with no second page to justify it.
    const fetchMock = goLiveOnTheOnlyCard(
      <FunnelList kind="page" funnels={[{ funnel: funnel({ status: "draft" }), steps: [step()] }]}
        leadCounts={{}}
      />,
    )
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(String(fetchMock.mock.calls[0][0])).toBe("/api/admin/funnels/f1")
    expect(fetchMock.mock.calls[0][1]?.method).toBe("PATCH")
  })
})

describe("the funnels board", () => {
  it("uses funnel vocabulary and hides the goal badge", () => {
    // MUTANT KILLED: reusing the page copy on the funnels screen — the two
    // screens would be indistinguishable, which is the original complaint.
    render(
      <FunnelList kind="funnel" funnels={[{ funnel: funnel({ kind: "funnel", goal: null }), steps: [step()] }]}
        leadCounts={{}}
      />,
    )
    expect(screen.getByRole("button", { name: /new funnel/i })).toBeInTheDocument()
    expect(screen.queryByText("Capture leads")).not.toBeInTheDocument()
  })

  it("says something funnel-shaped when empty", () => {
    render(<FunnelList kind="funnel" funnels={[]} leadCounts={{}} />)
    expect(screen.getByText(/more than one step/i)).toBeInTheDocument()
  })

  it("still calls a deleted funnel a funnel, and still warns that its other pages go with it", async () => {
    // The other half of the pair above. Without it, "say landing page" could be
    // satisfied by saying landing page EVERYWHERE — which would be the same
    // defect pointed the other way, on the screen where the funnel wording is
    // the correct one.
    const f = funnel({ kind: "funnel", goal: null })
    render(<FunnelList kind="funnel" funnels={[{ funnel: f, steps: [step()] }]} leadCounts={{}} />)

    const { asked, told } = await deleteTheOnlyCard()
    expect(told).toBe("Funnel deleted.")
    expect(asked).toContain("all of its pages")
  })

  it("takes a funnel live through the guarded route, not the unguarded PATCH", async () => {
    // MUTANT KILLED: `kind="page"` hardcoded at this call site, or the prop
    // dropped. `canGoLive` on this card means "the ENTRY page has a published
    // version" and says nothing about pages 2..N, so the PATCH here could take
    // a five-step funnel live with four unbuilt pages behind it — a public URL
    // whose own buttons 404. This board was the third doorway onto that write.
    const f = funnel({ kind: "funnel", goal: null, status: "draft" })
    const fetchMock = goLiveOnTheOnlyCard(
      <FunnelList kind="funnel" funnels={[{ funnel: f, steps: [step()] }]} leadCounts={{}} />,
    )
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(String(fetchMock.mock.calls[0][0])).toBe("/api/admin/funnels/f1/publish")
    expect(fetchMock.mock.calls[0][1]?.method).toBe("POST")
  })
})

/**
 * Presses Go live on the only card and hands back the fetch it fired.
 *
 * The URL is the whole assertion: BOTH publish paths call `fetch`, so "a
 * request was made" would pass against the unguarded write this change exists
 * to remove.
 */
function goLiveOnTheOnlyCard(ui: React.ReactElement) {
  const fetchMock = vi.fn(
    async (_url: string, _init?: RequestInit) =>
      new Response(JSON.stringify({ published: 2, pages: [], warnings: [] }), { status: 200 }),
  )
  vi.stubGlobal("fetch", fetchMock)
  render(ui)
  fireEvent.click(screen.getByRole("button", { name: /go live/i }))
  return fetchMock
}
