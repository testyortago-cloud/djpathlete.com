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
import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
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
