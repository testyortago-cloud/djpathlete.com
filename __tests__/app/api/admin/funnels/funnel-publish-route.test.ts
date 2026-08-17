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

/**
 * A page whose RENDERED output blows past `FUNNEL_STEP_HTML_MAX_LENGTH`.
 *
 * Copied in shape from `build-route.test.ts`'s `overCapSections`, and for the
 * same reason it exists there: the size caps are measured on rendered HTML,
 * not on the document, so no per-field limit can produce this and only a real
 * fixture can reach the branch. 8 FAQ sections x 12 items x ~1200 chars, with
 * `&` expanding to `&amp;` on the way out, clears 500 KB.
 */
function overCapDoc(): SectionDoc {
  const q = "&".repeat(200)
  const a = "&".repeat(1000)
  return {
    v: 1,
    engine: "sections",
    theme: { tone: "light", accent: "accent", radius: "soft" },
    sections: Array.from({ length: 8 }, (_, index) => ({
      id: `faq-${index}`,
      kind: "faq",
      variant: "stack",
      style: {},
      props: { source: "inline", items: Array.from({ length: 12 }, () => ({ q, a })) },
    })),
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

  it("publishes the RESOLVED document, with the CTA ref substituted for the real id", async () => {
    mock(listSteps).mockResolvedValue([stepRow()])
    mock(getDraft).mockResolvedValue({ doc: docWithCta(PROGRAM_NAME), docInvalid: false, revision: 1 })

    const response = await POST(request(), ctx)
    expect(response.status).toBe(200)
    // MUTANT: rendering and storing the raw draft (`drafts[i].doc`) instead of
    // `resolution.doc`. `resolveDoc` matches a CTA `ref` BY NAME and puts the
    // real row id into the doc it RETURNS, so the raw draft still says
    // "Comeback Code" — and it PASSES THE GATE saying that. Downstream,
    // `renderCtaTarget` hands that name to the checkout island as `productId`,
    // the island schema requires a uuid, and `renderIslandIfValid` silently
    // emits `disabledCta`: a dead button on a live page that compiles with
    // `ok: true` and no warnings.
    //
    // The STATUS IS 200 EITHER WAY, so only asserting on the stored value can
    // see this. That is the whole point of this test.
    const stored = mock(publishStep).mock.calls[0][0].projectData as unknown as {
      sections: { props: { primaryCta: { target: { ref: string } } } }[]
    }
    expect(stored.sections[0].props.primaryCta.target.ref).toBe(PROGRAM_ID)
    expect(stored.sections[0].props.primaryCta.target.ref).not.toBe(PROGRAM_NAME)
  })

  it("returns the published pages, versions and warnings a caller reads", async () => {
    mock(listSteps).mockResolvedValue([stepRow(), stepRow({ id: "s2", name: "Thank you", slug: "thank-you", position: 1, is_entry: false })])
    mock(getDraft).mockResolvedValue({ doc: docWithCta(PROGRAM_NAME), docInvalid: false, revision: 1 })
    mock(publishStep).mockImplementation(async ({ stepId }: { stepId: string }) => ({
      ok: true,
      version: { id: `v-${stepId}`, version: stepId === "s1" ? 3 : 7 },
      warnings: [{ message: `check ${stepId}` }],
    }))

    const response = await POST(request(), ctx)
    const body = await response.json()
    expect(response.status).toBe(200)
    // MUTANT: dropping `version`, collapsing `pages` to a count, or swallowing
    // the per-page warnings. Tasks 5 and 6 read exactly these fields, and this
    // repo has twice shipped a field on the funnels path that was collected
    // and then ignored — so the SHAPE is asserted whole, not field by field.
    expect(body).toEqual({
      published: 2,
      pages: [
        { stepId: "s1", stepName: "Signup", version: 3 },
        { stepId: "s2", stepName: "Thank you", version: 7 },
      ],
      warnings: ["check s1", "check s2"],
    })
  })

  it("404s when the funnel does not exist", async () => {
    mock(getFunnelById).mockResolvedValue(null)

    const response = await POST(request(), ctx)
    expect(response.status).toBe(404)
    // MUTANT: reading the steps before checking the funnel exists, which turns
    // a missing funnel into an empty-funnel 400 or a publish against nothing.
    expect(mock(listSteps)).not.toHaveBeenCalled()
    expect(mock(publishStep)).not.toHaveBeenCalled()
    expect(mock(updateFunnel)).not.toHaveBeenCalled()
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

  it("does not claim nothing was published when a write threw part way through", async () => {
    mock(listSteps).mockResolvedValue([stepRow(), stepRow({ id: "s2", name: "Thanks", slug: "thanks", position: 1, is_entry: false })])
    mock(getDraft).mockResolvedValue({ doc: docWithCta(PROGRAM_NAME), docInvalid: false, revision: 1 })
    // `publishStep` THROWS rather than returning `ok:false` — any Supabase
    // error does — after page 1 already has a version row.
    mock(publishStep).mockImplementation(async ({ stepId }: { stepId: string }) => {
      if (stepId === "s2") throw new Error("connection reset")
      return { ok: true, version: { id: "v1", version: 1 }, warnings: [] }
    })

    const response = await POST(request(), ctx)
    const body = await response.json()
    expect(response.status).toBe(422)
    // MUTANT: the single catch message that says "nothing was published". It
    // is FALSE in this reachable state — page 1 is written — and this repo
    // does not ship messages that lie. Nothing public breaks (the funnel row
    // is still a draft), which is exactly why only the wording can catch it.
    expect(body.pages[0].problems[0]).not.toContain("nothing was published")
    expect(body.pages[0].problems[0]).toContain("1 of its pages were published")
    expect(body.pages[0].problems[0]).toContain("connection reset")
    expect(mock(updateFunnel)).not.toHaveBeenCalled()
  })

  it("REFUSES on the SECOND page's size cap without writing the FIRST", async () => {
    mock(listSteps).mockResolvedValue([
      stepRow(),
      stepRow({ id: "s2", name: "Thanks", slug: "thanks", position: 1, is_entry: false }),
    ])
    mock(getDraft).mockImplementation(async (stepId: string) =>
      stepId === "s1"
        ? { doc: docWithCta(PROGRAM_NAME), docInvalid: false, revision: 1 }
        : { doc: overCapDoc(), docInvalid: false, revision: 1 },
    )

    const response = await POST(request(), ctx)
    const body = await response.json()
    expect(response.status).toBe(422)
    // The premise. If the fixture is not actually over the cap this test
    // proves nothing — it would be asserting a happy path wrote nothing.
    expect(body.pages).toHaveLength(1)
    expect(body.pages[0].stepId).toBe("s2")
    expect(body.pages[0].problems.join(" ")).toMatch(/over the 500000-character publish cap/)

    // MUTANT: the size-cap check living INSIDE the write loop, which is where
    // it was. Page 1 passes its own check, gets a version row and a repointed
    // `published_version_id`, and only THEN does page 2 refuse — a partial
    // write reported by a 422 that never mentions it. The status code is 422
    // either way, so ONLY this assertion can see the difference.
    expect(mock(publishStep)).not.toHaveBeenCalled()
    expect(mock(updateFunnel)).not.toHaveBeenCalled()
  })

  it("names EVERY page that fails its size cap, not just the first", async () => {
    mock(listSteps).mockResolvedValue([
      stepRow(),
      stepRow({ id: "s2", name: "Thanks", slug: "thanks", position: 1, is_entry: false }),
    ])
    mock(getDraft).mockResolvedValue({ doc: overCapDoc(), docInvalid: false, revision: 1 })

    const response = await POST(request(), ctx)
    const body = await response.json()
    expect(response.status).toBe(422)
    // MUTANT: returning on the first render problem instead of accumulating.
    // That sends the owner back to fix one page and only then tells them about
    // the next — the friction `funnelPublishPlan` already refuses to create,
    // and the refusal shape must match it.
    expect(body.pages.map((page: { stepId: string }) => page.stepId)).toEqual(["s1", "s2"])
    expect(mock(publishStep)).not.toHaveBeenCalled()
  })

  it("tells a REPUBLISHED funnel that the pages already written are public", async () => {
    // THE STATE NO OTHER TEST IN THIS FILE STARTS FROM. Every other case here
    // begins at `status: "draft"`, which is why the catch below could claim
    // "none of it is public yet" unconditionally and survive the suite.
    mock(getFunnelById).mockResolvedValue({ ...FUNNEL, status: "published" })
    mock(listSteps).mockResolvedValue([
      stepRow(),
      stepRow({ id: "s2", name: "Thanks", slug: "thanks", position: 1, is_entry: false }),
    ])
    mock(getDraft).mockResolvedValue({ doc: docWithCta(PROGRAM_NAME), docInvalid: false, revision: 1 })
    mock(publishStep).mockImplementation(async ({ stepId }: { stepId: string }) => {
      if (stepId === "s2") throw new Error("connection reset")
      return { ok: true, version: { id: "v1", version: 1 }, warnings: [] }
    })

    const response = await POST(request(), ctx)
    const body = await response.json()
    expect(response.status).toBe(422)
    const problem = body.pages[0].problems[0]

    // MUTANT: the unconditional "It is still a draft, so none of it is public
    // yet — publishing again is safe." That sentence is TRUE on a first
    // publish and FALSE here: the funnel row was already `published` on the
    // way in, so page 1's new version is being served to the public right now
    // while page 2 still serves its previous one. Nothing crashes, which is
    // exactly why only the wording can catch it.
    expect(problem).not.toContain("still a draft")
    expect(problem).not.toContain("none of it is public")
    expect(problem).toContain("already live")
    expect(problem).toContain("1 of its pages were published")
    expect(problem).toContain("connection reset")
  })

  it("still says nothing is public when a DRAFT funnel throws part way through", async () => {
    // The sibling of the test above, pinned so the two messages cannot be
    // collapsed back into one. Same failure, opposite entry status.
    mock(listSteps).mockResolvedValue([
      stepRow(),
      stepRow({ id: "s2", name: "Thanks", slug: "thanks", position: 1, is_entry: false }),
    ])
    mock(getDraft).mockResolvedValue({ doc: docWithCta(PROGRAM_NAME), docInvalid: false, revision: 1 })
    mock(publishStep).mockImplementation(async ({ stepId }: { stepId: string }) => {
      if (stepId === "s2") throw new Error("connection reset")
      return { ok: true, version: { id: "v1", version: 1 }, warnings: [] }
    })

    const response = await POST(request(), ctx)
    const body = await response.json()
    const problem = body.pages[0].problems[0]
    // MUTANT: making the "already live" wording unconditional instead, which
    // would tell the owner of a draft funnel that changes are public when the
    // row was never flipped and none of it is reachable.
    expect(problem).toContain("still a draft")
    expect(problem).not.toContain("already live")
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
    //
    // NOTE ON WHAT THIS NOW COVERS. `publishStep` returning `ok:false` is
    // UNREACHABLE since the compile gate moved above the write loop — the
    // route runs the same pure `compileFunnelStep` over the same `{html,css}`
    // first, so a page that reaches the write has already compiled. This mock
    // therefore drives the route's defensive `throw`, and what is pinned here
    // is that the throw behaves like every other mid-write failure: 422, row
    // untouched. It must not become a mid-loop `return` of a 422, which would
    // reinstate the partial write silently.
    expect(mock(updateFunnel)).not.toHaveBeenCalled()
  })
})
