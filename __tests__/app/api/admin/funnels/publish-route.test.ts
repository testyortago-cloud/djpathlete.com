// __tests__/app/api/admin/funnels/publish-route.test.ts
//
// EVERY TEST HERE NAMES THE MUTANT IT KILLS. This repo's dominant defect class
// is a test that cannot fail, and this feature produced seven of them in one
// day.
//
// THE DEFECT THIS FILE EXISTS FOR. Three modules (`resolve.ts`,
// `lib/db/funnel-builder.ts`, the build route) stated that a page with an
// unresolved CTA cannot be published, and named this endpoint as where that is
// enforced. It enforced nothing: it compiled `{html, css}` and wrote a version
// row. Stage 1.9 blocked publishing in the browser and again in a server
// action, so the ONLY way to observe the hole was a direct POST — which is
// exactly what every test below is.
//
// WHAT IS DELIBERATELY NOT MOCKED: `resolveDoc`, `publishGate` and
// `loadCatalogues` all run for real, over three mocked DAL reads. Mocking the
// resolver would replace the machinery the gate is made of with a restatement
// of what it is assumed to do — and the fail-closed test in particular makes
// the REAL `loadCatalogues` throw, by handing its recognition read 1000 rows,
// rather than a `mockRejectedValue` that proves only that try/catch catches.

import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/permissions/guard", () => ({ canAccessAdminPath: vi.fn() }))
vi.mock("@/lib/audit/record", () => ({ recordAudit: vi.fn() }))
vi.mock("@/lib/db/funnels", () => ({
  getStep: vi.fn(),
  publishStep: vi.fn(),
  getFunnelById: vi.fn(),
  updateFunnel: vi.fn(),
  listSteps: vi.fn(),
}))
vi.mock("@/lib/db/funnel-builder", () => ({ getDraft: vi.fn() }))
// The three catalogue read pairs, so the REAL `loadCatalogues` runs over them.
vi.mock("@/lib/db/programs", () => ({ getPrograms: vi.fn(), getAllPrograms: vi.fn() }))
vi.mock("@/lib/db/session-pack-products", () => ({ listActiveProducts: vi.fn(), listAllProducts: vi.fn() }))
vi.mock("@/lib/db/events", () => ({ getEvents: vi.fn(), getPublishedEvents: vi.fn() }))
// The FAQ page keys `loadCatalogues` reads for the `faq.pageKey` check — the
// one model-written string that is not a CtaTarget.
vi.mock("@/lib/db/faqs", () => ({ getFaqCountsByPage: vi.fn() }))

import { POST } from "@/app/api/admin/funnels/steps/[stepId]/publish/route"
import { auth } from "@/lib/auth"
import { canAccessAdminPath } from "@/lib/permissions/guard"
import { getStep, publishStep, getFunnelById, updateFunnel, listSteps } from "@/lib/db/funnels"
import { getDraft } from "@/lib/db/funnel-builder"
import { getAllPrograms, getPrograms } from "@/lib/db/programs"
import { listActiveProducts, listAllProducts } from "@/lib/db/session-pack-products"
import { getEvents, getPublishedEvents } from "@/lib/db/events"
import { getFaqCountsByPage } from "@/lib/db/faqs"
import type { SectionDoc } from "@/lib/funnels/sections/registry"

const mock = (fn: unknown) => fn as ReturnType<typeof vi.fn>

const STEP_ID = "3f1b7c5e-1111-4222-8333-444444444444"
const ADMIN_ID = "aaaaaaaa-1111-4222-8333-444444444444"
const STEP = { id: STEP_ID, funnel_id: "ffffffff-1111-4222-8333-444444444444", slug: "apply", name: "Apply" }

/** RFC-4122 conformant — Zod v4's `.uuid()` is strict. */
const PROGRAM_ID = "11111111-2222-4333-8444-555555555555"
const PROGRAM_NAME = "Comeback Code"
/** Matches no catalogue row by id, by exact name, or by either substring direction. */
const DEAD_REF = "Winter Throwing Intensive"

const HTML = "<section><h1>Rotational power in eight weeks</h1></section>"
const CSS = ".x{color:red}"

/**
 * A one-hero page whose only CTA points at `ref`.
 *
 * `ref` is the whole experiment: with `PROGRAM_NAME` it resolves, with
 * `DEAD_REF` it does not — and NOTHING ELSE about the request changes between
 * those two cases. The html is byte-identical and compiles identically, which
 * is the point: the compiler cannot tell these two pages apart.
 */
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
          primaryCta: { label: "Start", target: { kind: "program", ref } },
        },
      },
    ],
  } as SectionDoc
}

/** Same page, but its CTA scrolls to a section id that is not on the page. */
function docWithDeadAnchor(): SectionDoc {
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
          primaryCta: { label: "See pricing", target: { kind: "anchor", sectionId: "pricing" } },
        },
      },
    ],
  } as SectionDoc
}

const req = (body: unknown) =>
  new Request(`http://x/api/admin/funnels/steps/${STEP_ID}/publish`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }) as never

const ctx = { params: Promise.resolve({ stepId: STEP_ID }) } as never

beforeEach(() => {
  vi.clearAllMocks()
  mock(auth).mockResolvedValue({ user: { id: ADMIN_ID, role: "admin" } })
  mock(canAccessAdminPath).mockResolvedValue(true)
  mock(getStep).mockResolvedValue(STEP)
  // The funnel's pages, for `resolveDoc`'s step-link check. Resolves cleanly
  // unless a test says otherwise, so a refusal below is never an accident of
  // the fixture — the same discipline the draft mock below states.
  mock(listSteps).mockResolvedValue([
    { slug: STEP.slug, name: STEP.name },
    { slug: "thanks", name: "Thanks" },
  ])
  mock(publishStep).mockResolvedValue({
    ok: true,
    version: { id: "v1", version: 7 },
    warnings: [{ message: "dropped a <marquee>" }],
  })
  // The step's stored draft resolves cleanly unless a test says otherwise, so a
  // refusal below is never an accident of the fixture.
  mock(getDraft).mockResolvedValue({ doc: docWithCta(PROGRAM_ID), docInvalid: false, revision: 4 })

  mock(getAllPrograms).mockResolvedValue([{ id: PROGRAM_ID, name: PROGRAM_NAME }])
  mock(getPrograms).mockResolvedValue([{ id: PROGRAM_ID, name: PROGRAM_NAME }])
  mock(listAllProducts).mockResolvedValue([])
  mock(listActiveProducts).mockResolvedValue([])
  mock(getEvents).mockResolvedValue([])
  mock(getPublishedEvents).mockResolvedValue([])
  mock(getFaqCountsByPage).mockResolvedValue({ camps: 3 })
})

// ---------------------------------------------------------------------------
// THE PUBLISH GATE — the defect this file exists for
// ---------------------------------------------------------------------------

describe("POST /api/admin/funnels/steps/:stepId/publish — the publish gate", () => {
  it("REFUSES a direct POST whose document holds an unresolved CTA, and writes nothing", async () => {
    // MUTANT: delete the gate (this is the endpoint's state before this fix) —
    // or move it after `publishStep`, or derive it from the compile result.
    // Under any of those this request 200s and a page with a dead buy button
    // goes live. The `publishStep` assertion is the load-bearing half: a 422
    // returned AFTER the write would still be a published page.
    //
    // The compiler is deliberately given no chance to save us — `publishStep`
    // is mocked to succeed, so the ONLY thing that can produce a 422 here is a
    // check derived from the SectionDoc.
    const res = await POST(req({ html: HTML, css: CSS, project_data: docWithCta(DEAD_REF) }), ctx)

    expect(res.status).toBe(422)
    const body = await res.json()
    expect(body.problems).toHaveLength(1)
    expect(body.problems[0]).toContain(DEAD_REF)
    expect(body.problems[0]).toContain("hero")
    expect(publishStep).not.toHaveBeenCalled()
  })

  it("checks the STORED DRAFT when the body declines to say what it is publishing", async () => {
    // MUTANT: gate only `body.project_data`. `publishStepSchema` makes that
    // field OPTIONAL, so under that mutant a hand-built POST omitting it finds
    // nothing to check and publishes ungated — the gate would be opt-in, by the
    // caller, which is not a gate.
    mock(getDraft).mockResolvedValue({ doc: docWithCta(DEAD_REF), docInvalid: false, revision: 4 })

    const res = await POST(req({ html: HTML, css: CSS }), ctx)

    expect(res.status).toBe(422)
    expect((await res.json()).problems[0]).toContain(DEAD_REF)
    expect(publishStep).not.toHaveBeenCalled()
  })

  it("checks the document IN THE BODY, which is the one it stores, not the stored draft", async () => {
    // MUTANT: always gate `getDraft().doc` and ignore the body. The body's
    // `project_data` is what `publishStep` writes onto the version row, so a
    // route that gated only the draft would check a document it is not
    // publishing — green gate, dead button on the version that ships.
    // The draft here RESOLVES, so only a gate reading the body can refuse.
    mock(getDraft).mockResolvedValue({ doc: docWithCta(PROGRAM_NAME), docInvalid: false, revision: 4 })

    const res = await POST(req({ html: HTML, css: CSS, project_data: docWithCta(DEAD_REF) }), ctx)

    expect(res.status).toBe(422)
    const body = await res.json()
    expect(body.problems[0]).toContain(DEAD_REF)
    expect(body.problems[0]).not.toContain(PROGRAM_NAME)
    expect(publishStep).not.toHaveBeenCalled()
  })

  it("publishes a document whose CTA resolves BY NAME, and stores it verbatim", async () => {
    // MUTANT: a gate that refuses anything it is asked about (blockers built
    // from `resolved` instead of `unresolved`, or `ok: blockers.length > 0`).
    // A gate that never lets anything through is as broken as one that never
    // stops anything, and only a green-path test distinguishes them.
    const doc = docWithCta(PROGRAM_NAME)
    const res = await POST(req({ html: HTML, css: CSS, project_data: doc }), ctx)

    expect(res.status).toBe(200)
    // `wentLive` reports whether the route ALSO took a landing page live, which
    // is the second half of "a landing page has one publish, not two". False
    // here: this fixture is a funnel, where publishing one step must never put
    // the whole funnel live.
    expect(await res.json()).toEqual({
      version: 7,
      warnings: ["dropped a <marquee>"],
      wentLive: false,
    })
    expect(publishStep).toHaveBeenCalledWith({
      stepId: STEP_ID,
      html: HTML,
      css: CSS,
      projectData: doc,
      publishedBy: ADMIN_ID,
    })
  })

  it("publishes a document whose CTA already holds a real row id", async () => {
    // MUTANT: matching names only (dropping resolve.ts's id-first rule from the
    // gate's point of view). Every document after turn one holds ids, so that
    // mutant blocks publishing on EVERY page that has ever been resolved —
    // the exact "publish blocked on an untouched page" failure the
    // recognition/offer split exists to prevent, re-created at the gate.
    const res = await POST(req({ html: HTML, css: CSS, project_data: docWithCta(PROGRAM_ID) }), ctx)

    expect(res.status).toBe(200)
    expect(publishStep).toHaveBeenCalledTimes(1)
  })

  it("does NOT block on a dangling in-page anchor — that is a warning, not a blocker", async () => {
    // MUTANT: concatenating `gate.warnings` into `problems`. A CTA scrolling to
    // a section that was renamed is worth showing an owner and is nowhere near
    // the severity of a dead buy button; blocking on it would hold a campaign
    // page hostage over a scroll link.
    const res = await POST(req({ html: HTML, css: CSS, project_data: docWithDeadAnchor() }), ctx)

    expect(res.status).toBe(200)
    expect(publishStep).toHaveBeenCalledTimes(1)
  })
})

// ---------------------------------------------------------------------------
// Fail CLOSED
// ---------------------------------------------------------------------------

describe("POST .../publish — when the catalogue cannot be read", () => {
  it("REFUSES rather than publishing unchecked, and says why", async () => {
    // MUTANT: fail OPEN — `catch { return { ok: true } }`. The trigger here is
    // `assertNotTruncated`, which throws on EVERY call once a recognition read
    // hits PostgREST's 1000-row cap, so fail-open does not mean "one publish
    // slipped through during a blip": it means the gate silently switches
    // itself off for good on the day a table grows past 1000 rows.
    //
    // The REAL `loadCatalogues` throws here, driven by a real 1000-row read —
    // not a `mockRejectedValue`, which would prove only that try/catch catches.
    mock(getAllPrograms).mockResolvedValue(
      Array.from({ length: 1000 }, (_, i) => ({ id: `${PROGRAM_ID}-${i}`, name: `Program ${i}` })),
    )

    const res = await POST(req({ html: HTML, css: CSS, project_data: docWithCta(PROGRAM_NAME) }), ctx)

    expect(res.status).toBe(422)
    const body = await res.json()
    expect(body.problems[0]).toContain("links could not be checked")
    // The message carries the operator's fix, not just "something went wrong".
    expect(body.problems[0]).toContain("fetchAllRows")
    expect(publishStep).not.toHaveBeenCalled()
  })

  it("REFUSES rather than 500ing when the draft read itself fails", async () => {
    // MUTANT: leaving `getDraft` outside the gate's try/catch. A DB blip would
    // then surface as an unexplained 500 with a `funnel.published` audit row
    // recorded as `failure` and nothing an owner can act on.
    mock(getDraft).mockRejectedValue(new Error("PostgREST unreachable"))

    const res = await POST(req({ html: HTML, css: CSS }), ctx)

    expect(res.status).toBe(422)
    expect((await res.json()).problems[0]).toContain("PostgREST unreachable")
    expect(publishStep).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// Pages the gate has nothing to say about
// ---------------------------------------------------------------------------

describe("POST .../publish — steps with no SectionDoc", () => {
  it("still publishes a legacy GrapesJS step, whose draft is not a SectionDoc", async () => {
    // MUTANT: refusing whenever no SectionDoc can be found ("fail closed on
    // everything"). Every step predating 00203 holds GrapesJS editor state,
    // which `getDraft` reports as `docInvalid` with `doc: null` — those pages
    // carry raw hrefs, not `CtaTarget` refs, so there is nothing to resolve and
    // refusing them would break publishing across the whole existing funnel
    // library.
    mock(getDraft).mockResolvedValue({ doc: null, docInvalid: true, revision: 2 })

    const res = await POST(
      req({ html: HTML, css: CSS, project_data: { pages: [{ component: "<div/>" }] } }),
      ctx,
    )

    expect(res.status).toBe(200)
    expect(publishStep).toHaveBeenCalledTimes(1)
  })

  it("still publishes a step that has never been built", async () => {
    // MUTANT: treating a null draft as a refusal.
    mock(getDraft).mockResolvedValue({ doc: null, docInvalid: false, revision: 0 })

    const res = await POST(req({ html: HTML, css: CSS }), ctx)

    expect(res.status).toBe(200)
    expect(publishStep).toHaveBeenCalledTimes(1)
  })
})

// ---------------------------------------------------------------------------
// The pre-existing contract, pinned so the gate cannot quietly change it
// ---------------------------------------------------------------------------

describe("POST .../publish — auth, body and existence", () => {
  it("403s a signed-in non-admin and publishes nothing", async () => {
    // MUTANT: dropping `canAccessAdminPath`. This route is not covered by
    // middleware's /admin/* matcher (that matches PAGES), so the handler's own
    // check is the only gate on who may put a page in front of customers.
    mock(canAccessAdminPath).mockResolvedValue(false)
    const res = await POST(req({ html: HTML, css: CSS }), ctx)
    expect(res.status).toBe(403)
    expect(getStep).not.toHaveBeenCalled()
    expect(publishStep).not.toHaveBeenCalled()
  })

  it("403s an anonymous request", async () => {
    // MUTANT: `session?.user?.id` dropped from the condition.
    mock(auth).mockResolvedValue(null)
    expect((await POST(req({ html: HTML, css: CSS }), ctx)).status).toBe(403)
    expect(publishStep).not.toHaveBeenCalled()
  })

  it("400s a body missing html or css, before touching the step", async () => {
    // MUTANT: not validating, then publishing `undefined` html as "".
    expect((await POST(req({ css: CSS }), ctx)).status).toBe(400)
    expect((await POST(req({ html: HTML }), ctx)).status).toBe(400)
    expect(getStep).not.toHaveBeenCalled()
    expect(publishStep).not.toHaveBeenCalled()
  })

  it("404s when the step does not exist, and never runs the gate", async () => {
    mock(getStep).mockResolvedValue(null)
    expect((await POST(req({ html: HTML, css: CSS }), ctx)).status).toBe(404)
    expect(getDraft).not.toHaveBeenCalled()
    expect(publishStep).not.toHaveBeenCalled()
  })

  it("still returns the compiler's 422 with its problems", async () => {
    // MUTANT: the new gate replacing the compile-failure branch instead of
    // sitting in front of it. Both refusals share one response shape and the
    // client renders `problems` for both; losing either leaves an owner with
    // "This page could not be published." and no reason.
    mock(publishStep).mockResolvedValue({
      ok: false,
      errors: [{ message: "The page is 620 KB; the limit is 500 KB." }],
    })

    const res = await POST(req({ html: HTML, css: CSS, project_data: docWithCta(PROGRAM_NAME) }), ctx)

    expect(res.status).toBe(422)
    expect((await res.json()).problems).toEqual(["The page is 620 KB; the limit is 500 KB."])
  })
})

// ---------------------------------------------------------------------------
// A LANDING PAGE HAS ONE PUBLISH, NOT TWO.
//
// Publishing a step writes a version row; `/go/<slug>` additionally needs the
// FUNNEL ROW to be published. For a funnel that separation is real. For a
// landing page it is an artefact of the two sharing a table, and it cost the
// owner a 404 and a second button he did not want: "i published it but there
// are is still another publish button, I DONT WANT THAT".
// ---------------------------------------------------------------------------

describe("publishing a landing page takes it live", () => {
  it("flips the row to published and says so", async () => {
    mock(getFunnelById).mockResolvedValue({ id: "f1", kind: "page", status: "draft" })

    const res = await POST(req({ html: HTML, css: CSS, project_data: docWithCta(PROGRAM_NAME) }), ctx)

    expect(res.status).toBe(200)
    expect(updateFunnel).toHaveBeenCalledWith("f1", { status: "published" })
    expect((await res.json()).wentLive).toBe(true)
  })

  it("leaves a FUNNEL alone — one step is not the whole funnel", async () => {
    // MUTANT KILLED: flipping the row for every kind. Publishing step 1 of a
    // five-step funnel would put the unfinished rest of it in front of the
    // public.
    mock(getFunnelById).mockResolvedValue({ id: "f1", kind: "funnel", status: "draft" })

    const res = await POST(req({ html: HTML, css: CSS, project_data: docWithCta(PROGRAM_NAME) }), ctx)

    expect(updateFunnel).not.toHaveBeenCalled()
    expect((await res.json()).wentLive).toBe(false)
  })

  it("does not re-publish a landing page that is already live", async () => {
    mock(getFunnelById).mockResolvedValue({ id: "f1", kind: "page", status: "published" })

    const res = await POST(req({ html: HTML, css: CSS, project_data: docWithCta(PROGRAM_NAME) }), ctx)

    expect(updateFunnel).not.toHaveBeenCalled()
    expect((await res.json()).wentLive).toBe(false)
  })

  it("still reports the publish as a success when taking it live fails", async () => {
    // The version row is written and the page IS published. Reporting a failed
    // publish for a publish that succeeded would be the worse lie, and the
    // owner can still flip the row by hand.
    mock(getFunnelById).mockResolvedValue({ id: "f1", kind: "page", status: "draft" })
    mock(updateFunnel).mockRejectedValue(new Error("db down"))

    const res = await POST(req({ html: HTML, css: CSS, project_data: docWithCta(PROGRAM_NAME) }), ctx)

    expect(res.status).toBe(200)
    expect((await res.json()).wentLive).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Step links — the gate's newest blocker, and the one that used to be nothing.
//
// A `{kind:"step"}` CTA naming a page the funnel does not have rendered as an
// ordinary healthy <a> and published GREEN. `renderCtaTarget` only degrades a
// step CTA when `funnelBasePath` is missing, so a wrong slug is invisible to
// the compiler and was invisible here. It 404'd on a live page instead.
// ---------------------------------------------------------------------------
describe("POST — step links", () => {
  /** A page whose CTA points at another page of the funnel. */
  function docWithStepCta(stepSlug: string): SectionDoc {
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
            primaryCta: { label: "Get my spot", target: { kind: "step", stepSlug } },
          },
        },
      ],
    } as SectionDoc
  }

  it("publishes a step CTA that names a real page", () => {
    return POST(req({ html: HTML, css: CSS, project_data: docWithStepCta("thanks") }), ctx).then(
      async (res) => {
        expect(res.status).toBe(200)
        expect(mock(publishStep)).toHaveBeenCalled()
      },
    )
  })

  it("REFUSES a step CTA that names a page this funnel does not have, and writes nothing", async () => {
    const res = await POST(req({ html: HTML, css: CSS, project_data: docWithStepCta("offer-page") }), ctx)

    expect(res.status).toBe(422)
    const body = (await res.json()) as { problems?: string[] }
    // Names the slug, because that is the only thing the owner can search for.
    expect((body.problems ?? []).join(" ")).toContain("offer-page")
    // THE POINT: the live page keeps serving what it was already serving.
    expect(mock(publishStep)).not.toHaveBeenCalled()
  })

  it("REFUSES when the page list cannot be read, rather than publishing unchecked", async () => {
    // MUTANT KILLED — and it is NOT "pass `null` to `resolveDoc`", which this
    // comment claimed until the mutation was actually run and the test stayed
    // green. Both spellings throw out of the same `Promise.all`, so that
    // mutant is killed by the sibling test above, not by this one.
    //
    // What THIS test kills is degrading the read: `listSteps(...).catch(() =>
    // null)`. That reads as ordinary defensive coding — every other funnel
    // screen does exactly it — and here it would silently convert "could not
    // check" into "checked, nothing wrong" and publish unchecked. Verified by
    // applying that mutation and watching this test, and only this test, fail.
    mock(listSteps).mockRejectedValueOnce(new Error("supabase down"))

    const res = await POST(req({ html: HTML, css: CSS, project_data: docWithStepCta("thanks") }), ctx)

    expect(res.status).toBe(422)
    const body = (await res.json()) as { problems?: string[] }
    expect((body.problems ?? []).join(" ")).toContain("could not be checked")
    expect(mock(publishStep)).not.toHaveBeenCalled()
  })
})
