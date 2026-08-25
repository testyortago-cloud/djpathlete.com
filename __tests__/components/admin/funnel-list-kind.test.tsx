// ONE BOARD COMPONENT, TWO VOCABULARIES.
//
// `/admin/pages` and `/admin/funnels` are separate ROUTES — they have to be,
// because the sidebar highlights by path prefix and sharing a URL is what
// produced "IM CREATING A LANDING PAGE WHEN I GO BACK IM IN THE FUNNEL TAB".
// What they no longer have is separate COMPONENTS. That split is how the quiz
// button came to exist on one board and not the other.
//
// `kind` here drives copy and the create dialog and NOTHING about how a card
// behaves: a row's own `funnel.kind` decides that (see funnel-card-kind).
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { toast } from "sonner"
import { FunnelList, type FunnelWithSteps } from "@/components/admin/funnels/FunnelList"
import type { Funnel, FunnelStep } from "@/types/database"

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const funnel = (over: Partial<Funnel> = {}): Funnel =>
  ({
    id: "f1",
    slug: "free-trial",
    name: "Free Trial",
    description: null,
    status: "draft",
    kind: "page",
    goal: "leads",
    created_by: null,
    created_at: "",
    updated_at: "",
    ...over,
  }) as Funnel

const step = (over: Partial<FunnelStep> = {}): FunnelStep =>
  ({
    id: "s1",
    funnel_id: "f1",
    slug: "index",
    name: "Landing page",
    position: 0,
    is_entry: true,
    published_version_id: null,
    project_data: null,
    created_at: "",
    updated_at: "",
    ...over,
  }) as FunnelStep

const rows = (kind: "page" | "funnel"): FunnelWithSteps[] => [{ funnel: funnel({ kind }), steps: [step()] }]

describe("FunnelList, per board", () => {
  it("searches pages on the pages board", () => {
    render(<FunnelList kind="page" funnels={rows("page")} leadCounts={{}} />)
    expect(screen.getByPlaceholderText("Search pages…")).toBeTruthy()
  })

  it("searches funnels and pages on the funnels board", () => {
    render(<FunnelList kind="funnel" funnels={rows("funnel")} leadCounts={{}} />)
    expect(screen.getByPlaceholderText("Search funnels and pages…")).toBeTruthy()
  })

  it("offers New landing page on the pages board, and not New funnel", () => {
    render(<FunnelList kind="page" funnels={rows("page")} leadCounts={{}} />)
    expect(screen.getByRole("button", { name: "New landing page" })).toBeTruthy()
    expect(screen.queryByRole("button", { name: "New funnel" })).toBeNull()
  })

  it("offers New funnel on the funnels board, and not New page", () => {
    render(<FunnelList kind="funnel" funnels={rows("funnel")} leadCounts={{}} />)
    expect(screen.getByRole("button", { name: "New funnel" })).toBeTruthy()
    expect(screen.queryByRole("button", { name: "New landing page" })).toBeNull()
  })

  it("uses the landing-page empty state on an empty pages board", () => {
    // MATCHED ON THE HEADING, not on the words "landing page" anywhere in the
    // block. The FUNNEL empty state explains a funnel as "a landing page, then
    // a booking step, then a thank-you" -- so a loose match is satisfied by the
    // prose that describes the other kind.
    render(<FunnelList kind="page" funnels={[]} leadCounts={{}} />)
    expect(screen.getByText("No landing pages yet")).toBeTruthy()
  })

  it("uses the funnel empty state on an empty funnels board", () => {
    // The presence control for the assertion above: both kinds render an empty
    // state, so a passing pair means the wording follows the kind rather than
    // one of them simply being the only empty state there is.
    render(<FunnelList kind="funnel" funnels={[]} leadCounts={{}} />)
    expect(screen.getByText("No funnels yet")).toBeTruthy()
    expect(screen.queryByText("No landing pages yet")).toBeNull()
  })

  it("defaults to the funnels board when no kind is given", () => {
    // Every caller that predates /admin/pages moving here omits the prop. A
    // default of "page" would silently turn the funnels board into a pages one.
    render(<FunnelList funnels={rows("funnel")} leadCounts={{}} />)
    expect(screen.getByPlaceholderText("Search funnels and pages…")).toBeTruthy()
  })
})

// WHICH WORD DESCRIBES WHAT JUST VANISHED comes from the ROW, never from the
// request. Deleting a landing page hits the same `/api/admin/funnels/<id>`
// endpoint a funnel does — a landing page IS a funnels row — so a message
// written from the endpoint tells an owner on the landing pages screen that a
// "funnel" has gone, naming a thing they have never seen.
//
// This shipped once and was fixed on the old board. The fix has to survive the
// board being replaced, which is the entire reason this block is here.
describe("FunnelList, deleting", () => {
  beforeEach(() => {
    // CLEAR, NOT RESTORE. `vi.mock("sonner")` builds `toast.success` as a
    // module-level `vi.fn()` once; `restoreAllMocks` restores SPIES and leaves
    // that fn's call history intact, so reading `mock.calls[0]` returns the
    // previous test's call. This suite asserts on calls[0] by design -- it is
    // the first thing the owner is told -- so the history must be empty here.
    // Order matters: clear first, then re-arm the stub that was just cleared.
    vi.clearAllMocks()
    vi.restoreAllMocks()
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })))
  })

  async function deleteTheOnlyCard(kind: "page" | "funnel") {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true)
    render(<FunnelList kind={kind} funnels={rows(kind)} leadCounts={{}} />)
    fireEvent.click(screen.getByLabelText(/^Delete /))
    await waitFor(() => expect(toast.success).toHaveBeenCalled())
    return {
      asked: String(confirmSpy.mock.calls[0]?.[0] ?? ""),
      told: String(vi.mocked(toast.success).mock.calls[0]?.[0] ?? ""),
      url: String(vi.mocked(fetch).mock.calls[0]?.[0] ?? ""),
    }
  }

  it("calls a deleted landing page a landing page, in the question AND the answer", async () => {
    const { asked, told, url } = await deleteTheOnlyCard("page")
    expect(told).toBe("Landing page deleted.")
    expect(asked).toContain("landing page")
    // A landing page holds exactly one page, so "and all of its pages"
    // describes a funnel and nothing else.
    expect(asked).not.toContain("all of its pages")
    // The ENDPOINT is unchanged and must stay so: the wording was the bug, and
    // "fixing" it by deleting something else would be far worse.
    expect(url).toContain("/api/admin/funnels/f1")
  })

  it("calls a deleted funnel a funnel, in the question AND the answer", async () => {
    const { asked, told, url } = await deleteTheOnlyCard("funnel")
    expect(told).toBe("Funnel deleted.")
    expect(asked).toContain("all of its pages")
    expect(url).toContain("/api/admin/funnels/f1")
  })
})
