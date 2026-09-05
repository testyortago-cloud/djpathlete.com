// @vitest-environment jsdom
// __tests__/components/admin/pipeline-board.test.tsx
//
// Fix round 1, Finding 1: the board must render the CONFIGURED stage name
// (pipeline_stages.name), never a label reconstructed from `key`. The two
// happen to produce the same string for every stage seeded today
// ("consult_booked" -> "Consult Booked"), which is exactly why a prior
// version of this component deriving the label from `key` alone passed every
// existing test while silently ignoring a real rename. This fixture
// deliberately makes `key` and `name` diverge so a regression back to
// key-derivation fails loudly instead of coincidentally matching.

import { describe, expect, it, vi, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"
import { PipelineBoard } from "@/components/admin/pipeline-board"
import type { BoardColumn } from "@/lib/db/pipeline"

// The page moved from requireAdmin() to requirePermission("contacts") on
// 2026-09-04 (0dcedc9f); left unmocked, the real guard reaches auth() and
// throws "headers was called outside a request scope".
vi.mock("@/lib/permissions/guard", () => ({ requirePermission: vi.fn() }))
vi.mock("@/lib/db/businesses", () => ({ getBusinessSettings: vi.fn() }))
// The page resolves its tenant at the session boundary (lib/tenancy/resolve.ts,
// which reads cookies() and so cannot run outside a request). Mocked to a
// sentinel so both reads below are pinned to the RESOLVED tenant.
vi.mock("@/lib/tenancy/resolve", () => ({ resolveAdminTenant: vi.fn() }))
vi.mock("@/lib/db/pipeline", async () => {
  const actual = await vi.importActual<typeof import("@/lib/db/pipeline")>("@/lib/db/pipeline")
  return { ...actual, readBoard: vi.fn() }
})

import { requirePermission } from "@/lib/permissions/guard"
import { getBusinessSettings } from "@/lib/db/businesses"
import { readBoard } from "@/lib/db/pipeline"
import { resolveAdminTenant } from "@/lib/tenancy/resolve"
import PipelinePage from "@/app/(admin)/admin/pipeline/page"

const COLUMNS: BoardColumn[] = [
  {
    stage: {
      id: "stage-1",
      key: "consult_booked",
      // Deliberately NOT "Consult Booked" — a business renamed this stage.
      // stageLabel("consult_booked") would produce "Consult Booked", so if
      // the component ever reverts to deriving from `key`, this exact
      // fixture is what catches it.
      name: "Discovery Call",
      position: 1,
      kind: "open",
      amber_after_days: 3,
      red_after_days: 7,
    },
    cards: [],
  },
  {
    stage: {
      id: "stage-2",
      key: "won",
      name: "Won",
      position: 2,
      kind: "won",
      amber_after_days: null,
      red_after_days: null,
    },
    cards: [],
  },
]

describe("<PipelineBoard>", () => {
  it("renders the configured stage name, not a key-derived label", () => {
    render(<PipelineBoard columns={COLUMNS} grantablePrograms={[]} />)
    expect(screen.getByText("Discovery Call")).toBeInTheDocument()
    expect(screen.queryByText("Consult Booked")).not.toBeInTheDocument()
  })

  it("still renders a plain key-derived label when name and key would coincide", () => {
    render(<PipelineBoard columns={COLUMNS} grantablePrograms={[]} />)
    expect(screen.getByText("Won")).toBeInTheDocument()
  })
})

// app/(admin)/admin/pipeline/page.tsx — the server component that builds
// the possessive intro sentence from the business's own name (via
// getBusinessSettings) and hands the board to <PipelineBoard>. Rendered
// directly here, same "server component invoked directly" pattern as
// __tests__/app/admin/campaign-revenue-page.test.tsx.
describe("<PipelinePage>", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(requirePermission as ReturnType<typeof vi.fn>).mockResolvedValue({ user: { id: "u1", role: "admin" } })
    ;(readBoard as ReturnType<typeof vi.fn>).mockResolvedValue([])
    ;(resolveAdminTenant as ReturnType<typeof vi.fn>).mockResolvedValue({
      businessId: "biz-resolved",
      choices: [],
      isOperator: false,
    })
  })

  // business_settings.display_name is seeded as '' (migration 00212 — NOT
  // NULL DEFAULT ''), not null, on any install where the owner hasn't
  // filled in Business Settings yet — including production today. A bare
  // `${display_name}'s coaching pipeline` then rendered as "'s coaching
  // pipeline. Drag a card..." — a stray leading apostrophe with nothing in
  // front of it.
  it("falls back to neutral copy, with no stray leading apostrophe, when display_name is blank", async () => {
    ;(getBusinessSettings as ReturnType<typeof vi.fn>).mockResolvedValue({ display_name: "" })
    const { container } = render(await PipelinePage())
    // Scoped to the intro paragraph itself, not the whole body — the
    // paragraph sits directly after the "Pipeline" <h1> with no
    // whitespace between their textContent, so a body-wide scan for
    // "<whitespace>'s" would miss the unconditional-possessive bug (it
    // reads as "...Pipeline's coaching..." with the apostrophe glued to
    // the heading, not standing alone at a word boundary).
    const intro = container.querySelector("p")
    expect(intro?.textContent).toMatch(/^The coaching pipeline\. Drag a card to move it between stages/)
    expect(intro?.textContent).not.toMatch(/^[’']s\b/)
    // Both reads take the tenant the SESSION resolved to, threaded once.
    expect(readBoard).toHaveBeenCalledWith(undefined, "biz-resolved")
    expect(getBusinessSettings).toHaveBeenCalledWith("biz-resolved")
  })

  it("still renders the possessive when display_name is a real name", async () => {
    ;(getBusinessSettings as ReturnType<typeof vi.fn>).mockResolvedValue({ display_name: "Acme Coaching" })
    render(await PipelinePage())
    expect(
      screen.getByText(/^Acme Coaching’s coaching pipeline\. Drag a card to move it between stages/),
    ).toBeInTheDocument()
  })
})
