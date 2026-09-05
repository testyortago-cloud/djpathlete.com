// @vitest-environment jsdom
// The name the owner typed, on the card, and editable from it.
//
// What shipped: `createFunnel` names a landing page's only step "Landing page",
// the card titled itself with THAT, and the owner's own name appeared nowhere
// except as a filter chip. So a list of landing pages read as identical cards
// called "Landing page", filed under categories nobody created — and the name
// could be set exactly once, at create time, with no way back to it.
//
// Every assertion below is paired with its opposite on the funnels board, since
// "always show the funnel's name" and "never show it" are both wrong and each
// would pass a one-sided test.
//
// RETARGETED FROM `FunnelBoard`, WHICH IS DELETED. Both screens render
// `FunnelList` now: one card per FUNNEL, with a multi-step funnel's steps
// listed inside it. The naming guarantees survive that unchanged -- a landing
// page is still titled with the owner's name, a funnel's step names are still
// not collapsed into the container's -- so those assertions are retargeted
// verbatim. Two blocks did NOT survive, and each says why where it stood.

import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react"
import { FunnelList } from "@/components/admin/funnels/FunnelList"
import type { Funnel, FunnelStep } from "@/types/database"

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const funnel = (over: Partial<Funnel> = {}): Funnel => ({
  id: "f1",
  slug: "free-trial",
  name: "Free Trial Week",
  description: null,
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
    // The name `createFunnel` writes. Nobody chooses it, and every landing page
    // in the database has it — which is exactly why titling with it was wrong.
    name: "Landing page",
    position: 0,
    is_entry: true,
    published_version_id: "v1",
    project_data: null,
    ...over,
  }) as FunnelStep

function okFetch() {
  const fetchMock = vi.fn(
    async (_url: string, _init?: RequestInit) => new Response(JSON.stringify({ ok: true }), { status: 200 }),
  )
  vi.stubGlobal("fetch", fetchMock)
  return fetchMock
}

/** Opens the pencil next to `currentName`, types `next`, saves. */
async function rename(currentName: string, next: string) {
  const fetchMock = okFetch()
  fireEvent.click(screen.getByRole("button", { name: `Rename ${currentName}` }))
  fireEvent.change(await screen.findByLabelText(/^name$/i), { target: { value: next } })
  fireEvent.click(screen.getByRole("button", { name: /^save$/i }))
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
  const [url, init] = fetchMock.mock.calls[0]
  return { url: String(url), body: JSON.parse(String(init?.body ?? "{}")) as { name?: string } }
}

beforeEach(() => vi.clearAllMocks())

describe("what a card is called", () => {
  it("titles a landing page with the owner's name, not the step row's placeholder", () => {
    // MUTANT KILLED: `title={step.name}`, which is what shipped.
    render(
      <FunnelList kind="page" funnels={[{ funnel: funnel(), steps: [step()] }]} leadCounts={{}} />,
    )

    const card = screen.getByRole("link", { name: "Free Trial Week" })
    expect(card).toHaveAttribute("href", "/admin/pages/f1/edit/s1")
    // The placeholder must be GONE, not merely joined by the real name — two
    // names on one card is the same confusion wearing a longer label.
    expect(screen.queryByText("Landing page")).not.toBeInTheDocument()
  })

  it("still titles a FUNNEL's page with the step's own name", () => {
    // MUTANT KILLED: titling every card with `funnel.name`. A funnel's steps are
    // named individually and would all collapse to the container's name.
    const f = funnel({ kind: "funnel", goal: null })
    render(
      <FunnelList
        kind="funnel"
        funnels={[
          {
            funnel: f,
            steps: [
              step({ id: "s1", name: "Step 1" }),
              step({ id: "s2", name: "Book a call", slug: "book", is_entry: false, position: 1 }),
            ],
          },
        ]}
        leadCounts={{}}
      />,
    )

    expect(screen.getByRole("link", { name: "Step 1" })).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Book a call" })).toBeInTheDocument()
  })
})

// REMOVED: the three "filter chips" tests.
//
// The chips grouped cards BY FUNNEL, and `FunnelList` has none -- one card per
// funnel IS the grouping, so a chip could only filter to a card already on
// screen. Their own guarantee ("do not turn one-page-per-funnel names into
// categories") is now satisfied by construction rather than by a conditional,
// and `FunnelList`'s header records why the chips went.
//
// Kept as a note rather than silently dropped: three deleted tests with no
// explanation is indistinguishable from three tests lost in a refactor.

describe("renaming from the card", () => {
  it("writes a landing page's new name to the FUNNEL row", async () => {
    render(
      <FunnelList kind="page" funnels={[{ funnel: funnel(), steps: [step()] }]} leadCounts={{}} />,
    )

    const { url, body } = await rename("Free Trial Week", "Spring Trial")
    expect(url).toBe("/api/admin/funnels/f1")
    expect(body).toEqual({ name: "Spring Trial" })
  })

  // REMOVED: "writes a funnel page's new name to the STEP row".
  //
  // It tested a per-STEP rename pencil on a per-STEP card, and there are no
  // per-step cards any more -- `FunnelList` draws one card per FUNNEL, whose
  // pencil renames the funnel row (asserted above). A funnel's step is renamed
  // in the builder, which owns `/api/admin/funnels/steps/<id>`.
  //
  // It was already testing unreachable code before this change:
  // `FunnelBoard`'s `kind === "funnel"` branches had not been rendered by any
  // screen since /admin/funnels moved to `FunnelList`. Deleted rather than
  // retargeted because there is no surface left that should fire that write,
  // and a test kept alive against a component nothing renders is worse than no
  // test -- it reads as coverage.

  it("promises the address does not move, and sends no slug", async () => {
    // A rename that also moved /go/<slug> would break every link already handed
    // out. The dialog says so, and the request has to agree with the promise.
    render(
      <FunnelList kind="page" funnels={[{ funnel: funnel(), steps: [step()] }]} leadCounts={{}} />,
    )
    fireEvent.click(screen.getByRole("button", { name: "Rename Free Trial Week" }))
    const dialog = await screen.findByRole("dialog")
    expect(within(dialog).getByText("/go/free-trial")).toBeInTheDocument()

    fireEvent.change(within(dialog).getByLabelText(/^name$/i), { target: { value: "Spring Trial" } })
    const fetchMock = okFetch()
    fireEvent.click(within(dialog).getByRole("button", { name: /^save$/i }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body ?? "{}"))).not.toHaveProperty("slug")
  })

  it("refuses a name the server would reject, before sending it", async () => {
    // MUTANT KILLED: a client-side bound copied as `>= 1`. The schema's minimum
    // is imported, so this cannot drift into a 400 the dialog said was fine.
    render(
      <FunnelList kind="page" funnels={[{ funnel: funnel(), steps: [step()] }]} leadCounts={{}} />,
    )
    fireEvent.click(screen.getByRole("button", { name: "Rename Free Trial Week" }))
    fireEvent.change(await screen.findByLabelText(/^name$/i), { target: { value: "x" } })
    expect(screen.getByRole("button", { name: /^save$/i })).toBeDisabled()
  })
})
