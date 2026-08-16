// __tests__/components/admin/funnel-publish-actions.test.ts
//
// `renderDocForPublish` — the server action that turns the owner's SectionDoc
// into the `{html, css}` the publish route stores.
//
// ---------------------------------------------------------------------------
// WHY THIS FILE EXISTS: ONE UNTESTED ASSIGNMENT WAS THE WHOLE GUARANTEE.
// ---------------------------------------------------------------------------
// `publish-actions.ts:118` — `resolvedDoc = resolution.doc` — is the ONLY line
// making the published HTML use resolved row ids, and the publish route's gate
// structurally cannot back it up: that route gates the DOCUMENT
// (`docUnderPublish`), never the MARKUP, which is the documented
// `html`/`css`-are-client-supplied gap. So:
//
//   * the gate proves "this document is resolvable"
//   * NOTHING proved "the shipped markup was built from the resolved document"
//
// Delete that line and `resolvedDoc` stays at its `let resolvedDoc = doc`
// initialiser. The gate still passes. The route still 200s. And `render.ts`'s
// `session_pack` branch re-emits a LIVE CHECKOUT ISLAND WITH `productId`
// SILENTLY DROPPED — the one CTA kind with no visible tell (`program` at least
// degrades to a disabled span). `compile.ok` is `true`, `warnings` is `[]`.
//
// Before this file, `renderDocForPublish` had ZERO tests; its only consumer
// test mocks it wholesale as a prop. Three other mutants survived in the same
// function and are pinned below: deleting `canAccessAdminPath` (a server
// action is a public POST), the fail-open `catch`, and taking `funnelBasePath`
// from the caller instead of deriving it from the funnel row.
//
// WHAT IS DELIBERATELY NOT MOCKED: `resolveDoc`, `publishGate`,
// `loadCatalogues` and `reassemble` all run for real, over mocked DAL reads —
// the same choice `publish-route.test.ts` makes and for the same reason.
// Mocking the resolver would replace the machinery under test with a
// restatement of what it is assumed to do, and the assertion that matters here
// is about which DOCUMENT reached the renderer, which a mock cannot see.

import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/permissions/guard", () => ({ canAccessAdminPath: vi.fn() }))
vi.mock("@/lib/db/funnels", () => ({ getStep: vi.fn(), getFunnelById: vi.fn(), listSteps: vi.fn() }))
// The catalogue reads, so the REAL `loadCatalogues` runs over them.
vi.mock("@/lib/db/programs", () => ({ getPrograms: vi.fn(), getAllPrograms: vi.fn() }))
vi.mock("@/lib/db/session-pack-products", () => ({ listActiveProducts: vi.fn(), listAllProducts: vi.fn() }))
vi.mock("@/lib/db/events", () => ({ getEvents: vi.fn(), getPublishedEvents: vi.fn() }))
vi.mock("@/lib/db/faqs", () => ({ getFaqCountsByPage: vi.fn() }))

import { renderDocForPublish } from "@/components/admin/funnels/builder/publish-actions"
import { auth } from "@/lib/auth"
import { canAccessAdminPath } from "@/lib/permissions/guard"
import { getFunnelById, getStep, listSteps } from "@/lib/db/funnels"
import { getAllPrograms, getPrograms } from "@/lib/db/programs"
import { listActiveProducts, listAllProducts } from "@/lib/db/session-pack-products"
import { getEvents, getPublishedEvents } from "@/lib/db/events"
import { getFaqCountsByPage } from "@/lib/db/faqs"
import type { SectionDoc } from "@/lib/funnels/sections/registry"

const mock = (fn: unknown) => fn as ReturnType<typeof vi.fn>

const STEP_ID = "3f1b7c5e-1111-4222-8333-444444444444"
const ADMIN_ID = "aaaaaaaa-1111-4222-8333-444444444444"
const STEP = { id: STEP_ID, funnel_id: "ffffffff-1111-4222-8333-444444444444", slug: "apply", name: "Apply" }
const FUNNEL = { id: STEP.funnel_id, slug: "summer-camp", name: "Summer camp", status: "draft" }

/** RFC-4122 conformant — Zod v4's `.uuid()` is strict, and the islands use it. */
const PROGRAM_ID = "11111111-2222-4333-8444-555555555555"
const PACK_ID = "66666666-7777-4888-8999-aaaaaaaaaaaa"
const PROGRAM_NAME = "Comeback Code"
const PACK_NAME = "Ten Session Pack"

/**
 * A page whose CTAs are written the way the MODEL writes them: by NAME.
 *
 * That is the whole experiment. `resolveDoc` turns these into row ids; whether
 * the markup that ships was built from that resolved document or from this one
 * is invisible to the publish gate, to the compiler, and — for the session
 * pack — to anyone looking at the rendered page.
 */
function docWithNamedCtas(): SectionDoc {
  return {
    v: 1,
    engine: "sections",
    theme: { tone: "light", accent: "accent", radius: "soft" },
    sections: [
      {
        id: "hero",
        kind: "hero",
        variant: "centered",
        style: {},
        props: {
          headline: "Rotational power in eight weeks",
          primaryCta: { label: "Start the program", target: { kind: "program", ref: PROGRAM_NAME } },
          secondaryCta: { label: "Buy sessions", target: { kind: "session_pack", ref: PACK_NAME } },
        },
      },
    ],
  } as SectionDoc
}

/** Same page, plus a `step` CTA — the only thing `funnelBasePath` is used for. */
function docWithStepCta(): SectionDoc {
  return {
    v: 1,
    engine: "sections",
    theme: { tone: "light", accent: "accent", radius: "soft" },
    sections: [
      {
        id: "hero",
        kind: "hero",
        variant: "centered",
        style: {},
        props: {
          headline: "Rotational power in eight weeks",
          primaryCta: { label: "Apply", target: { kind: "step", stepSlug: "thanks" } },
        },
      },
    ],
  } as SectionDoc
}

function docWithCta(target: unknown): SectionDoc {
  return {
    v: 1,
    engine: "sections",
    theme: { tone: "light", accent: "accent", radius: "soft" },
    sections: [
      {
        id: "hero",
        kind: "hero",
        variant: "centered",
        style: {},
        props: { headline: "Rotational power in eight weeks", primaryCta: { label: "Go", target } },
      },
    ],
  } as SectionDoc
}

beforeEach(() => {
  vi.clearAllMocks()
  mock(auth).mockResolvedValue({ user: { id: ADMIN_ID, role: "admin" } })
  mock(canAccessAdminPath).mockResolvedValue(true)
  mock(getStep).mockResolvedValue(STEP)
  mock(getFunnelById).mockResolvedValue(FUNNEL)
  // The funnel's pages, for `resolveDoc`'s step-link check. "thanks" is the
  // slug `docWithStepCta` points at, so the default state of this suite is a
  // funnel whose step links all resolve — otherwise every test in this file
  // would ALSO be a test about a broken link, and the `funnelBasePath` one
  // would fail for a reason that has nothing to do with base paths.
  mock(listSteps).mockResolvedValue([
    { slug: STEP.slug, name: STEP.name },
    { slug: "thanks", name: "Thanks" },
  ])

  mock(getAllPrograms).mockResolvedValue([{ id: PROGRAM_ID, name: PROGRAM_NAME }])
  mock(getPrograms).mockResolvedValue([{ id: PROGRAM_ID, name: PROGRAM_NAME }])
  mock(listAllProducts).mockResolvedValue([{ id: PACK_ID, name: PACK_NAME }])
  mock(listActiveProducts).mockResolvedValue([{ id: PACK_ID, name: PACK_NAME }])
  mock(getEvents).mockResolvedValue([])
  mock(getPublishedEvents).mockResolvedValue([])
  mock(getFaqCountsByPage).mockResolvedValue({ camps: 3 })
})

// ---------------------------------------------------------------------------
// THE ONE THAT NOTHING ELSE CAN CATCH
// ---------------------------------------------------------------------------

describe("renderDocForPublish — the markup is built from the RESOLVED document", () => {
  it("puts real row ids in the html, not the names the model wrote", async () => {
    // MUTANT KILLED: deleting `resolvedDoc = resolution.doc` (or hoisting
    // `reassemble` above the try block). `resolvedDoc` then keeps its
    // `let resolvedDoc = doc` initialiser: the gate still says ok, this action
    // still returns `ok: true`, the publish route still 200s, and the live page
    // ships a `session_pack` checkout island with `productId` DROPPED — no
    // disabled state, no compiler warning, nothing to see.
    //
    // The names are asserted ABSENT as well as the ids present: a
    // half-substituting implementation that left the name in place beside the
    // id would satisfy the positive half alone.
    const result = await renderDocForPublish(STEP_ID, docWithNamedCtas())

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.html).toContain(PACK_ID)
    expect(result.html).toContain(PROGRAM_ID)
    expect(result.html).not.toContain(PACK_NAME)
    expect(result.html).not.toContain(PROGRAM_NAME)
  })

  it("derives funnelBasePath from the funnel row, so a step CTA gets a real href", async () => {
    // MUTANT KILLED: accepting `funnelBasePath` as a parameter instead of
    // reading it off `getFunnelById` — which the file's own comment calls "an
    // open redirect factory". A caller-supplied path is not passed by anything
    // in this repo, so under that mutant the value is `undefined` and
    // render.ts degrades the step CTA to a disabled <span> with NO href and no
    // warning: the same silent-drop class, arriving from the other side.
    const result = await renderDocForPublish(STEP_ID, docWithStepCta())

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.html).toContain(`href="/go/${FUNNEL.slug}/thanks"`)
    expect(mock(getFunnelById).mock.calls[0][0]).toBe(STEP.funnel_id)
  })
})

// ---------------------------------------------------------------------------
// A server action is a public POST endpoint
// ---------------------------------------------------------------------------

describe("renderDocForPublish — authorisation", () => {
  it("refuses an anonymous caller without reading the step", async () => {
    // MUTANT KILLED: no auth check at all. `stepId` is bound on the server, so
    // a caller cannot point this at someone else's step — but a bound argument
    // is not an authorisation, and this renders (and gates) a page for whoever
    // POSTs the action id.
    mock(auth).mockResolvedValue(null)

    const result = await renderDocForPublish(STEP_ID, docWithNamedCtas())

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.blockers[0]).toMatch(/permission/i)
    expect(getStep).not.toHaveBeenCalled()
  })

  it("refuses a signed-in user who is not allowed on /admin/funnels", async () => {
    // MUTANT KILLED: deleting `canAccessAdminPath(session.user)` and keeping
    // only the `session?.user?.id` check — which is the shape the refusal
    // above would still pass. Every logged-in CLIENT would then be able to
    // render and gate an admin page.
    mock(canAccessAdminPath).mockResolvedValue(false)

    const result = await renderDocForPublish(STEP_ID, docWithNamedCtas())

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.blockers[0]).toMatch(/permission/i)
    expect(getStep).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// Fail CLOSED
// ---------------------------------------------------------------------------

describe("renderDocForPublish — refusals", () => {
  it("refuses when the catalogue cannot be read, rather than rendering unresolved refs", async () => {
    // MUTANT KILLED: `catch { /* carry on */ }` — a fail-OPEN catch. The throw
    // here is REAL, not a `mockRejectedValue`: `loadCatalogues` asserts its
    // recognition read was not truncated at PostgREST's 1000-row cap, because
    // a truncated catalogue is indistinguishable from "that row was deleted".
    // Swallowing it would render the doc with its names still in place — the
    // exact silent session_pack island the first test exists for.
    mock(getAllPrograms).mockResolvedValue(
      Array.from({ length: 1000 }, (_, index) => ({ id: `p${index}`, name: `Program ${index}` })),
    )

    const result = await renderDocForPublish(STEP_ID, docWithNamedCtas())

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.blockers.join(" ")).toMatch(/could not be checked/i)
    expect(result.blockers.join(" ")).toMatch(/programs/i)
  })

  it("refuses a page whose CTA points at nothing, and hands back the gate's own blockers", async () => {
    // MUTANT KILLED: asking the COMPILER whether this page is publishable. An
    // unresolved `program` ref renders a disabled placeholder and compiles to
    // `ok: true, warnings: []` — the compiler has zero signal to give. The
    // blocker text has to come from `publishGate`, and it names the slot.
    const result = await renderDocForPublish(
      STEP_ID,
      docWithCta({ kind: "program", ref: "Winter Throwing Intensive" }),
    )

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.blockers.join(" ")).toContain("Winter Throwing Intensive")
    expect(result.blockers.join(" ")).toContain("hero")
  })

  it("refuses a live FAQ section whose page key has no rows", async () => {
    // MUTANT KILLED: gating on `unresolved` alone. `faq.pageKey` is not a CTA,
    // so the CTA walk never sees it, and a key with no rows renders the whole
    // section as NOTHING on the live page — `compile.ok: true`, `warnings: []`.
    const doc = {
      v: 1,
      engine: "sections",
      theme: { tone: "light", accent: "accent", radius: "soft" },
      sections: [
        { id: "faq1", kind: "faq", variant: "stack", style: {}, props: { source: "live", pageKey: "kettlebells" } },
      ],
    } as SectionDoc

    const result = await renderDocForPublish(STEP_ID, doc)

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.blockers.join(" ")).toContain("kettlebells")
    // The real keys, so the fix is one name away.
    expect(result.blockers.join(" ")).toContain("camps")
  })

  it("refuses a document the builder cannot read, instead of throwing at the owner", async () => {
    // MUTANT KILLED: casting the incoming doc instead of parsing it.
    // `resolveDoc` and `reassemble` both THROW on a bad document, and a thrown
    // server action is an unexplained failure in the owner's face.
    const result = await renderDocForPublish(STEP_ID, { v: 1, engine: "sections" } as unknown as SectionDoc)

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.blockers[0]).toMatch(/not a document the builder can read/i)
  })

  it("refuses when the step no longer exists", async () => {
    mock(getStep).mockResolvedValue(null)

    const result = await renderDocForPublish(STEP_ID, docWithNamedCtas())

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.blockers[0]).toMatch(/no longer exists/i)
  })
})

// ---------------------------------------------------------------------------
// Warnings survive the success path
// ---------------------------------------------------------------------------

describe("renderDocForPublish — warnings", () => {
  it("carries the gate's dangling-anchor warnings through a successful render", async () => {
    // MUTANT KILLED: `return { ok: true, html, css, problems, warnings: [] }`.
    // A dangling anchor never blocks (an explicit ruling: a dead in-page link
    // is degraded, not lead-losing), so dropping the warnings here is a change
    // NO other assertion in this repo would notice — the page publishes either
    // way and the owner is simply never told.
    const result = await renderDocForPublish(STEP_ID, docWithCta({ kind: "anchor", sectionId: "pricing" }))

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0]).toContain("#pricing")
  })
})
