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

import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react"
import { FunnelBoard } from "@/components/admin/funnels/FunnelBoard"
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
      <FunnelBoard kind="page" pages={[{ step: step(), funnel: funnel() }]} funnels={[funnel()]} leadCounts={{}} />,
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
      <FunnelBoard
        kind="funnel"
        pages={[
          { step: step({ id: "s1", name: "Step 1" }), funnel: f },
          { step: step({ id: "s2", name: "Book a call", slug: "book", is_entry: false }), funnel: f },
        ]}
        funnels={[f]}
        leadCounts={{}}
      />,
    )

    expect(screen.getByRole("link", { name: "Step 1" })).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Book a call" })).toBeInTheDocument()
  })
})

describe("the filter chips", () => {
  it("do not turn one-page-per-funnel names into categories", () => {
    // MUTANT KILLED: `multiPageFunnels.length > 1`, which is what shipped: with
    // two landing pages it rendered two chips, each filtering to a single card
    // already on screen, labelled with the name that belongs to that card.
    const a = funnel({ id: "f1", name: "Free Trial Week", slug: "free-trial" })
    const b = funnel({ id: "f2", name: "Summer Camp", slug: "summer-camp" })
    render(
      <FunnelBoard
        kind="page"
        pages={[
          { step: step({ id: "s1", funnel_id: "f1" }), funnel: a },
          { step: step({ id: "s2", funnel_id: "f2" }), funnel: b },
        ]}
        funnels={[a, b]}
        leadCounts={{}}
      />,
    )

    expect(screen.queryByRole("button", { name: /^all \(/i })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /free trial week \(/i })).not.toBeInTheDocument()
    // Both cards are still listed — "no chips" must not mean "no rows".
    expect(screen.getByRole("link", { name: "Free Trial Week" })).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Summer Camp" })).toBeInTheDocument()
  })

  it("still group a funnel that genuinely holds several pages", () => {
    // MUTANT KILLED: deleting the chips outright. On the funnels board the
    // grouping is real information — a funnel has many steps.
    const a = funnel({ id: "f1", kind: "funnel", name: "Trial Funnel", goal: null })
    const b = funnel({ id: "f2", kind: "funnel", name: "Camp Funnel", slug: "camp", goal: null })
    render(
      <FunnelBoard
        kind="funnel"
        pages={[
          { step: step({ id: "s1", name: "Step 1" }), funnel: a },
          { step: step({ id: "s2", name: "Book", slug: "book", is_entry: false }), funnel: a },
          { step: step({ id: "s3", name: "Step 1", funnel_id: "f2" }), funnel: b },
        ]}
        funnels={[a, b]}
        leadCounts={{}}
      />,
    )

    expect(screen.getByRole("button", { name: "All (3)" })).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Trial Funnel (2)" }))
    expect(screen.getByRole("link", { name: "Book" })).toBeInTheDocument()
    expect(screen.queryByRole("link", { name: "Camp Funnel · /go/camp" })).not.toBeInTheDocument()
  })

  it("stop filtering when the chips themselves stop being shown", () => {
    // MUTANT KILLED: hiding the chip row while `funnelFilter` keeps applying.
    // Deleting the second page of a funnel drops the board below the threshold,
    // and a filter with no visible control is a board silently hiding rows.
    const a = funnel({ id: "f1", kind: "funnel", name: "Trial Funnel", goal: null })
    const b = funnel({ id: "f2", kind: "funnel", name: "Camp Funnel", slug: "camp", goal: null })
    const withChild = { step: step({ id: "s2", name: "Book", slug: "book", is_entry: false }), funnel: a }
    const entryA = { step: step({ id: "s1", name: "Step 1" }), funnel: a }
    const entryB = { step: step({ id: "s3", name: "Camp step", funnel_id: "f2" }), funnel: b }

    const { rerender } = render(
      <FunnelBoard kind="funnel" pages={[entryA, withChild, entryB]} funnels={[a, b]} leadCounts={{}} />,
    )
    fireEvent.click(screen.getByRole("button", { name: "Trial Funnel (2)" }))
    expect(screen.queryByRole("link", { name: "Camp step" })).not.toBeInTheDocument()

    rerender(<FunnelBoard kind="funnel" pages={[entryA, entryB]} funnels={[a, b]} leadCounts={{}} />)
    expect(screen.queryByRole("button", { name: /^all \(/i })).not.toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Camp step" })).toBeInTheDocument()
  })
})

describe("renaming from the card", () => {
  it("writes a landing page's new name to the FUNNEL row", async () => {
    render(
      <FunnelBoard kind="page" pages={[{ step: step(), funnel: funnel() }]} funnels={[funnel()]} leadCounts={{}} />,
    )

    const { url, body } = await rename("Free Trial Week", "Spring Trial")
    expect(url).toBe("/api/admin/funnels/f1")
    expect(body).toEqual({ name: "Spring Trial" })
  })

  it("writes a funnel page's new name to the STEP row", async () => {
    // MUTANT KILLED: sending every rename to `/api/admin/funnels/<id>`. That
    // renames the whole funnel from a card showing one of its steps — the card
    // would appear to do nothing and the container would silently change.
    const f = funnel({ kind: "funnel", goal: null })
    render(
      <FunnelBoard
        kind="funnel"
        pages={[{ step: step({ id: "s2", name: "Book a call", slug: "book", is_entry: false }), funnel: f }]}
        funnels={[f]}
        leadCounts={{}}
      />,
    )

    const { url, body } = await rename("Book a call", "Book a consult")
    expect(url).toBe("/api/admin/funnels/steps/s2")
    expect(body).toEqual({ name: "Book a consult" })
  })

  it("promises the address does not move, and sends no slug", async () => {
    // A rename that also moved /go/<slug> would break every link already handed
    // out. The dialog says so, and the request has to agree with the promise.
    render(
      <FunnelBoard kind="page" pages={[{ step: step(), funnel: funnel() }]} funnels={[funnel()]} leadCounts={{}} />,
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
      <FunnelBoard kind="page" pages={[{ step: step(), funnel: funnel() }]} funnels={[funnel()]} leadCounts={{}} />,
    )
    fireEvent.click(screen.getByRole("button", { name: "Rename Free Trial Week" }))
    fireEvent.change(await screen.findByLabelText(/^name$/i), { target: { value: "x" } })
    expect(screen.getByRole("button", { name: /^save$/i })).toBeDisabled()
  })
})
