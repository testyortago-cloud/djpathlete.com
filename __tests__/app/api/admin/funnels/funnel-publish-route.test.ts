// __tests__/app/api/admin/funnels/funnel-publish-route.test.ts
//
// THE DEFECT THIS FILE EXISTS FOR: taking a funnel live used to be
// `PATCH /api/admin/funnels/[id]` with `{status:"published"}`, which validates
// the body and writes. It never looked at the steps — so a funnel whose second
// page had never been built went live with a 404 behind its own button, and
// nothing anywhere said so.
//
// EVERY TEST NAMES THE MUTANT IT KILLS.
//
// NOT MOCKED: `resolveDoc`, `publishGate` and `loadCatalogues` run for real
// over mocked DAL reads. Mocking the resolver would replace the machinery the
// gate is made of with a restatement of what it is assumed to do.

import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/permissions/guard", () => ({ canAccessAdminPath: vi.fn() }))
vi.mock("@/lib/audit/record", () => ({ recordAudit: vi.fn() }))
vi.mock("@/lib/db/funnels", () => ({
  getFunnelById: vi.fn(),
  listSteps: vi.fn(),
  publishStep: vi.fn(),
  updateFunnel: vi.fn(),
}))
vi.mock("@/lib/db/funnel-builder", () => ({ getDraft: vi.fn() }))
vi.mock("@/lib/db/programs", () => ({ getPrograms: vi.fn(), getAllPrograms: vi.fn() }))
vi.mock("@/lib/db/session-pack-products", () => ({ listActiveProducts: vi.fn(), listAllProducts: vi.fn() }))
vi.mock("@/lib/db/events", () => ({ getEvents: vi.fn(), getPublishedEvents: vi.fn() }))
vi.mock("@/lib/db/faqs", () => ({ getFaqCountsByPage: vi.fn() }))

import { POST } from "@/app/api/admin/funnels/[id]/publish/route"
import { auth } from "@/lib/auth"
import { canAccessAdminPath } from "@/lib/permissions/guard"
import { getFunnelById, listSteps, publishStep, updateFunnel } from "@/lib/db/funnels"
import { getDraft } from "@/lib/db/funnel-builder"
import { getAllPrograms, getPrograms } from "@/lib/db/programs"
import { listActiveProducts, listAllProducts } from "@/lib/db/session-pack-products"
import { getEvents, getPublishedEvents } from "@/lib/db/events"
import { getFaqCountsByPage } from "@/lib/db/faqs"
import type { SectionDoc } from "@/lib/funnels/sections/registry"

const mock = (fn: unknown) => fn as ReturnType<typeof vi.fn>

const FUNNEL_ID = "ffffffff-1111-4222-8333-444444444444"
const ADMIN_ID = "aaaaaaaa-1111-4222-8333-444444444444"
const PROGRAM_ID = "11111111-2222-4333-8444-555555555555"
const PROGRAM_NAME = "Comeback Code"
const DEAD_REF = "Winter Throwing Intensive"

const FUNNEL = { id: FUNNEL_ID, slug: "free-trial-week", name: "Free Trial Week", kind: "funnel", status: "draft" }

/** A one-hero page whose only CTA points at `ref`. */
function docWithCta(ref: string): SectionDoc {
  return {
    v: 1,
    engine: "sections",
    theme: { tone: "light", accent: "accent", radius: "soft" },
    sections: [
      {
        id: "hero",
        kind: "hero",
        variant: "centered",
        style: { headline: "lg", align: "center" },
        props: {
          headline: "Rotational power in eight weeks",
          sub: "Eight weeks of programming built from your numbers.",
          // `heroPropsSchema` requires `primaryCta`, not `cta` — matching
          // `publish-route.test.ts`'s fixture for the same section kind.
          primaryCta: { label: "Join", target: { kind: "program", ref } },
        },
      },
    ],
  } as unknown as SectionDoc
}

function stepRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "s1",
    funnel_id: FUNNEL_ID,
    name: "Signup",
    slug: "index",
    position: 0,
    is_entry: true,
    published_version_id: null,
    ...overrides,
  }
}

function request() {
  return new Request(`http://localhost/api/admin/funnels/${FUNNEL_ID}/publish`, { method: "POST" })
}
const ctx = { params: Promise.resolve({ id: FUNNEL_ID }) }

beforeEach(() => {
  vi.clearAllMocks()
  mock(auth).mockResolvedValue({ user: { id: ADMIN_ID, role: "admin" } })
  mock(canAccessAdminPath).mockResolvedValue(true)
  mock(getFunnelById).mockResolvedValue(FUNNEL)
  mock(publishStep).mockImplementation(async ({ stepId }: { stepId: string }) => ({
    ok: true,
    version: { id: `v-${stepId}`, version: 1 },
    warnings: [],
  }))
  mock(updateFunnel).mockResolvedValue({ ...FUNNEL, status: "published" })
  // The catalogue reads the REAL `loadCatalogues` makes.
  mock(getPrograms).mockResolvedValue([{ id: PROGRAM_ID, name: PROGRAM_NAME, slug: "comeback-code" }])
  mock(getAllPrograms).mockResolvedValue([{ id: PROGRAM_ID, name: PROGRAM_NAME, slug: "comeback-code" }])
  mock(listActiveProducts).mockResolvedValue([])
  mock(listAllProducts).mockResolvedValue([])
  mock(getEvents).mockResolvedValue([])
  mock(getPublishedEvents).mockResolvedValue([])
  mock(getFaqCountsByPage).mockResolvedValue({})
})

describe("POST /api/admin/funnels/[id]/publish", () => {
  it("publishes every page AND takes the funnel live", async () => {
    mock(listSteps).mockResolvedValue([stepRow(), stepRow({ id: "s2", name: "Thank you", slug: "thank-you", position: 1, is_entry: false })])
    mock(getDraft).mockResolvedValue({ doc: docWithCta(PROGRAM_NAME), docInvalid: false, revision: 1 })

    const response = await POST(request(), ctx)
    expect(response.status).toBe(200)
    // MUTANT: publishing only the entry step. The ids are asserted, not the
    // count — a route that writes one page twice would pass a count check.
    expect(mock(publishStep).mock.calls.map((call) => call[0].stepId)).toEqual(["s1", "s2"])
    expect(mock(updateFunnel)).toHaveBeenCalledWith(FUNNEL_ID, { status: "published" })
  })

  it("REFUSES when a page has never been built, and writes NOTHING", async () => {
    mock(listSteps).mockResolvedValue([stepRow(), stepRow({ id: "s2", name: "Thank you", slug: "thank-you", position: 1, is_entry: false })])
    mock(getDraft).mockImplementation(async (stepId: string) =>
      stepId === "s1"
        ? { doc: docWithCta(PROGRAM_NAME), docInvalid: false, revision: 1 }
        : { doc: null, docInvalid: false, revision: 0 },
    )

    const response = await POST(request(), ctx)
    const body = await response.json()
    expect(response.status).toBe(422)
    expect(body.pages).toEqual([
      { stepId: "s2", stepName: "Thank you", problems: ["Thank you has no content yet."], blank: true },
    ])
    // THREE SEPARATE ASSERTIONS, because "nothing was written" is the claim and
    // a test that only checks the status code cannot see a partial write.
    // MUTANT: writing `plan.publish` before checking `plan.ok`.
    expect(mock(publishStep)).not.toHaveBeenCalled()
    // MUTANT: flipping the funnel row anyway — which is the exact defect that
    // `PATCH {status}` has today and this route exists to replace.
    expect(mock(updateFunnel)).not.toHaveBeenCalled()
  })

  it("REFUSES on an unresolved CTA and names the page it is on", async () => {
    mock(listSteps).mockResolvedValue([stepRow(), stepRow({ id: "s2", name: "Offer", slug: "offer", position: 1, is_entry: false })])
    mock(getDraft).mockImplementation(async (stepId: string) => ({
      doc: docWithCta(stepId === "s2" ? DEAD_REF : PROGRAM_NAME),
      docInvalid: false,
      revision: 1,
    }))

    const response = await POST(request(), ctx)
    const body = await response.json()
    expect(response.status).toBe(422)
    // MUTANT: gating only the entry step, or flattening blockers so the owner
    // is told what is wrong but not where.
    expect(body.pages).toHaveLength(1)
    expect(body.pages[0].stepId).toBe("s2")
    expect(body.pages[0].stepName).toBe("Offer")
    expect(body.pages[0].blank).toBe(false)
    expect(body.pages[0].problems.join(" ")).toContain(DEAD_REF)
    expect(mock(publishStep)).not.toHaveBeenCalled()
    expect(mock(updateFunnel)).not.toHaveBeenCalled()
  })

  it("FAILS CLOSED when the catalogue cannot be read", async () => {
    mock(listSteps).mockResolvedValue([stepRow()])
    mock(getDraft).mockResolvedValue({ doc: docWithCta(PROGRAM_NAME), docInvalid: false, revision: 1 })
    // The REAL `loadCatalogues` throws when a recognition read comes back at
    // PostgREST's 1000-row cap. Driven through the real path rather than a
    // `mockRejectedValue`, which would prove only that try/catch catches.
    mock(getAllPrograms).mockResolvedValue(
      Array.from({ length: 1000 }, (_, index) => ({ id: PROGRAM_ID, name: `p${index}`, slug: `p${index}` })),
    )

    const response = await POST(request(), ctx)
    const body = await response.json()
    expect(response.status).toBe(422)
    // MUTANT: catching the throw and publishing anyway. The trigger is
    // PERSISTENT — once a table crosses 1000 rows it throws on every call — so
    // failing open would switch the gate off permanently, on the day a table
    // grows, with nothing saying so.
    expect(mock(publishStep)).not.toHaveBeenCalled()
    expect(mock(updateFunnel)).not.toHaveBeenCalled()
    // MUTANT: swallowing the throw and substituting an empty catalogue.
    // `funnelPublishPlan`'s own problems always carry a real `stepId` — this
    // route's fail-closed catch is the only path that reports `stepId: ""`
    // for "This funnel" as a whole — so asserting on it distinguishes the
    // real fail-closed refusal from a `.catch(() => EMPTY_CATALOGUES)` that
    // would ALSO end up at 422 with nothing written, just for the wrong
    // reason (the CTA no longer resolving against an empty catalogue).
    expect(body.pages).toEqual([
      {
        stepId: "",
        stepName: "This funnel",
        problems: [expect.stringContaining("could not be checked")],
        blank: false,
      },
    ])
  })

  it("does not refuse a legacy step that has no document but is already live", async () => {
    mock(listSteps).mockResolvedValue([
      stepRow(),
      stepRow({ id: "s2", name: "Old page", slug: "old", position: 1, is_entry: false, published_version_id: "v-old" }),
    ])
    mock(getDraft).mockImplementation(async (stepId: string) =>
      stepId === "s1"
        ? { doc: docWithCta(PROGRAM_NAME), docInvalid: false, revision: 1 }
        // What `getDraft` reports for legacy GrapesJS state.
        : { doc: null, docInvalid: true, revision: 0 },
    )

    const response = await POST(request(), ctx)
    expect(response.status).toBe(200)
    // MUTANT: refusing every doc-less step. That freezes out every funnel
    // created before the section editor.
    expect(mock(publishStep).mock.calls.map((call) => call[0].stepId)).toEqual(["s1"])
    expect(mock(updateFunnel)).toHaveBeenCalledWith(FUNNEL_ID, { status: "published" })
  })

  it("refuses a funnel with no pages", async () => {
    mock(listSteps).mockResolvedValue([])
    const response = await POST(request(), ctx)
    // MUTANT: publishing an empty funnel — `funnelPublishPlan([])` is legitimately
    // `ok`, so without this the route would take an empty funnel live and serve
    // a 404 at its own public URL.
    expect(response.status).toBe(400)
    expect(mock(updateFunnel)).not.toHaveBeenCalled()
  })

  it("refuses a non-admin", async () => {
    mock(canAccessAdminPath).mockResolvedValue(false)
    const response = await POST(request(), ctx)
    expect(response.status).toBe(403)
    expect(mock(updateFunnel)).not.toHaveBeenCalled()
  })

  it("does not flip the funnel row when a page fails to compile", async () => {
    mock(listSteps).mockResolvedValue([stepRow(), stepRow({ id: "s2", name: "Thanks", slug: "thanks", position: 1, is_entry: false })])
    mock(getDraft).mockResolvedValue({ doc: docWithCta(PROGRAM_NAME), docInvalid: false, revision: 1 })
    mock(publishStep).mockImplementation(async ({ stepId }: { stepId: string }) =>
      stepId === "s2" ? { ok: false, errors: [{ message: "too big" }] } : { ok: true, version: { id: "v1", version: 1 }, warnings: [] },
    )

    const response = await POST(request(), ctx)
    expect(response.status).toBe(422)
    // MUTANT: flipping the row regardless of the write results. A half-written
    // funnel that says "published" is the state with no way to reason about it.
    expect(mock(updateFunnel)).not.toHaveBeenCalled()
  })
})
