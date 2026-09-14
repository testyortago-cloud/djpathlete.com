/**
 * @vitest-environment node
 */
// __tests__/app/api/admin/funnels/build-route-render.test.ts
//
// Task 7: `runReviewStage` renders the page before handing it to `reviewDoc`.
// Follows the mocking idiom of `build-route.test.ts` — read there for the
// full rationale of each `vi.mock` below; this file adds exactly one more,
// for `renderDocToImages`. That function is mocked directly rather than
// through its browser dependency: it never throws and this route only ever
// sees its RETURN VALUE, so faking the return value IS the real contract —
// going through a fake `puppeteer-core` launch would buy nothing these tests
// need and would drag browser-port plumbing into a route suite.

import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/permissions/guard", () => ({ canAccessAdminPath: vi.fn() }))
vi.mock("@/lib/audit/record", () => ({ recordAudit: vi.fn() }))
vi.mock("@/lib/ai/anthropic", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai/anthropic")>()),
  streamAgent: vi.fn(),
}))
vi.mock("@/lib/db/ai-generation-log", () => ({
  createGenerationLog: vi.fn(),
  updateGenerationLog: vi.fn(),
}))
vi.mock("@/lib/db/funnel-builder", () => ({
  getDraft: vi.fn(),
  appendTurn: vi.fn(),
  listTurns: vi.fn(),
  revertToRevision: vi.fn(),
}))
vi.mock("@/lib/db/funnels", () => ({
  getStep: vi.fn(),
  getFunnelById: vi.fn(),
  listSteps: vi.fn(),
}))
vi.mock("@/lib/db/faqs", () => ({ getFaqCountsByPage: vi.fn() }))
vi.mock("@/lib/db/businesses", () => ({ getBusinessSettings: vi.fn() }))
vi.mock("@/lib/tenancy/resolve", () => ({
  resolveAdminTenantForRequest: vi.fn(),
  NoAccessibleBusinessError: class NoAccessibleBusinessError extends Error {},
}))
// The review stage. `shouldReview`/`opsRewrotePage` stay REAL: which turns
// earn a review is not this file's claim, but the render tests still need the
// real gate to open for a `set_page` and stay shut for an ordinary edit.
vi.mock("@/lib/funnels/sections/review/pipeline", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/funnels/sections/review/pipeline")>()),
  reviewDoc: vi.fn(),
}))
// THE RENDER.
vi.mock("@/lib/funnels/render-image", () => ({ renderDocToImages: vi.fn() }))
// The three catalogue reads, so the REAL `loadCatalogues` runs over them.
vi.mock("@/lib/db/programs", () => ({ getPrograms: vi.fn(), getAllPrograms: vi.fn() }))
vi.mock("@/lib/db/session-pack-products", () => ({ listActiveProducts: vi.fn(), listAllProducts: vi.fn() }))
vi.mock("@/lib/db/events", () => ({ getEvents: vi.fn(), getPublishedEvents: vi.fn() }))

import { POST } from "@/app/api/admin/funnels/steps/[stepId]/build/route"
import { auth } from "@/lib/auth"
import { canAccessAdminPath } from "@/lib/permissions/guard"
import { streamAgent } from "@/lib/ai/anthropic"
import { createGenerationLog, updateGenerationLog } from "@/lib/db/ai-generation-log"
import { appendTurn, getDraft, listTurns } from "@/lib/db/funnel-builder"
import { getFunnelById, getStep, listSteps } from "@/lib/db/funnels"
import { getFaqCountsByPage } from "@/lib/db/faqs"
import { getBusinessSettings } from "@/lib/db/businesses"
import { resolveAdminTenantForRequest } from "@/lib/tenancy/resolve"
import { getAllPrograms, getPrograms } from "@/lib/db/programs"
import { listActiveProducts, listAllProducts } from "@/lib/db/session-pack-products"
import { getEvents, getPublishedEvents } from "@/lib/db/events"
import { reviewDoc } from "@/lib/funnels/sections/review/pipeline"
import { renderDocToImages } from "@/lib/funnels/render-image"
import type { SectionDoc } from "@/lib/funnels/sections/registry"
import { createBuildStreamDecoder, type BuildStreamEvent } from "@/lib/funnels/sections/build-stream"

const mock = (fn: unknown) => fn as ReturnType<typeof vi.fn>

const STEP_ID = "3f1b7c5e-1111-4222-8333-444444444444"

/** RFC-4122 conformant — Zod v4's `.uuid()` is strict, and `checkoutIslandSchema.productId` uses it. */
const PROGRAM_ID = "11111111-2222-4333-8444-555555555555"
const PROGRAM_NAME = "Comeback Code"

const STEP = { id: STEP_ID, funnel_id: "ffffffff-1111-4222-8333-444444444444", slug: "apply", name: "Apply" }
const FUNNEL = { id: STEP.funnel_id, slug: "summer-camp", name: "Summer camp", status: "draft" }

/**
 * What `loadPageContext` derives from `FUNNEL.slug`, and therefore the exact
 * string the render must be given. Written out rather than interpolated: the
 * claim is that the ROUTE'S OWN base path reaches the render, and an
 * expectation built from the same expression as the code cannot fail when the
 * code stops passing it.
 */
const EXPECTED_BASE_PATH = "/go/summer-camp"

/**
 * A REAL brand, not the column's `null` default. `resolveBrandKit` returns
 * `null` for an unbranded tenant, and `null` is also what a mutant that drops
 * the argument entirely produces — so an unbranded fixture would make the
 * brand-kit half of the assertion unfalsifiable.
 */
const BRAND_COLOR = "#2f5d62"
const ACCENT_COLOR = "#d08c3f"
const EXPECTED_BRAND_KIT = { brand: BRAND_COLOR, accent: ACCENT_COLOR }

const BUSINESS_ID = "bbbbbbbb-1111-4222-8333-444444444444"

const BUSINESS_SETTINGS = {
  business_id: BUSINESS_ID,
  display_name: "DJP Athlete",
  sender_name: "DJP Athlete",
  sender_email: "hello@djpathlete.com",
  reply_to: "hello@djpathlete.com",
  logo_url: null,
  timezone: "America/New_York",
  quiet_hours_start: 21,
  quiet_hours_end: 8,
  daily_message_cap: 50,
  postal_address: "",
  sms_help_text: "",
  sms_messaging_service_sid: "",
  sms_sender_phone: "",
  brand_color: null as string | null,
  accent_color: null as string | null,
}

function doc(headline = "Rotational power in eight weeks"): SectionDoc {
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
          headline,
          sub: "Eight weeks of programming built from your numbers.",
          primaryCta: { label: "Start", target: { kind: "program", ref: PROGRAM_NAME } },
        },
      },
    ],
  }
}

/** A full page, for the first-draft `set_page` path — the only path that earns a review. */
function fullPageSections() {
  return [
    {
      id: "hero",
      kind: "hero",
      variant: "centered",
      style: {},
      props: {
        headline: "Eight weeks. Measurable rotational power.",
        primaryCta: { label: "Start", target: { kind: "program", ref: PROGRAM_NAME } },
      },
    },
  ]
}

const USAGE = {
  inputTokens: 200,
  outputTokens: 1000,
  inputTokenDetails: { cacheWriteTokens: 3400, cacheReadTokens: 0 },
}

function agentResult(content: unknown) {
  return {
    object: Promise.resolve(content),
    fullStream: (async function* () {
      yield { type: "object", object: content }
      yield { type: "finish", usage: USAGE }
    })(),
  }
}

/** A model response that REPLACES the page — the shape `opsRewrotePage` treats as a rewrite. */
function setPageResult() {
  return {
    reply: "Drafted the page.",
    blocked: false,
    ops: [{ op: "set_page", sections: fullPageSections() }],
  }
}

async function readEvents(res: Response): Promise<BuildStreamEvent[]> {
  expect(res.headers.get("content-type")).toContain("text/event-stream")
  return createBuildStreamDecoder()(await res.text())
}

/**
 * The document the build turn actually stored, read back off its own `result`
 * event. This is what `runReviewStage` is handed and therefore what the render
 * must be given — taking it from the stream rather than rebuilding it here
 * keeps the expectation tied to the route's output instead of to a second copy
 * of the resolver's behaviour maintained in this file.
 */
function storedDoc(events: BuildStreamEvent[]): SectionDoc {
  const result = events.find((e) => e.type === "result")
  expect(result, "the build turn must have emitted a result before any review").toBeDefined()
  return (result as { turn: { doc: SectionDoc } }).turn.doc
}

const req = (body: unknown) =>
  new Request(`http://x/api/admin/funnels/steps/${STEP_ID}/build`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }) as never

const ctx = { params: Promise.resolve({ stepId: STEP_ID }) } as never

/** A distinct user id per test keeps the module-level rate limiter isolated. */
let userSeed = 0
function freshAdmin() {
  userSeed += 1
  return { user: { id: `aaaaaaaa-1111-4222-8333-${String(userSeed).padStart(12, "0")}`, role: "admin" } }
}

/** What `renderDocToImages` returns on a successful render. */
function renderedOk() {
  return {
    images: [{ mediaType: "image/png" as const, data: "AAAA" }],
    width: 1200,
    height: 900,
    truncated: false,
    typographyFaithful: true,
    error: null as string | null,
  }
}

/** `renderDocToImages` NEVER throws — a failed launch reports trouble here instead. */
function renderedFailed(error = "no browser available for rendering") {
  return { images: [], width: 0, height: 0, truncated: false, typographyFaithful: false, error }
}

beforeEach(() => {
  vi.clearAllMocks()
  mock(auth).mockResolvedValue(freshAdmin())
  mock(canAccessAdminPath).mockResolvedValue(true)

  // `doc: null` — the first-draft shape. A `set_page` against an empty draft
  // is what makes `opsRewrotePage` true and opens the automatic review gate.
  mock(getDraft).mockResolvedValue({ doc: null, docInvalid: false, revision: 4 })
  mock(getStep).mockResolvedValue(STEP)
  mock(getFunnelById).mockResolvedValue(FUNNEL)
  mock(listSteps).mockResolvedValue([STEP, { ...STEP, id: "other", slug: "thanks" }])
  mock(getFaqCountsByPage).mockResolvedValue({ coaching: 4 })
  mock(listTurns).mockResolvedValue([])

  mock(resolveAdminTenantForRequest).mockResolvedValue({
    businessId: BUSINESS_ID,
    choices: [{ id: BUSINESS_ID, name: "DJP Athlete", slug: "djp-athlete" }],
    isOperator: true,
  })
  // A BRANDED tenant, so `context.brandKit` is a real object rather than the
  // `null` an unbranded one produces. See `BRAND_COLOR`.
  mock(getBusinessSettings).mockResolvedValue({
    ...BUSINESS_SETTINGS,
    brand_color: BRAND_COLOR,
    accent_color: ACCENT_COLOR,
  })

  mock(getAllPrograms).mockResolvedValue([{ id: PROGRAM_ID, name: PROGRAM_NAME }])
  mock(getPrograms).mockResolvedValue([{ id: PROGRAM_ID, name: PROGRAM_NAME }])
  mock(listAllProducts).mockResolvedValue([])
  mock(listActiveProducts).mockResolvedValue([])
  mock(getEvents).mockResolvedValue([])
  mock(getPublishedEvents).mockResolvedValue([])

  mock(createGenerationLog).mockResolvedValue({ id: "log-1" })
  mock(updateGenerationLog).mockResolvedValue({})

  // THE REVIEW CHANGES SOMETHING, AND THAT IS LOAD-BEARING.
  //
  // It used to answer `changed: false`, which sends `runReviewStage` straight
  // out through `if (!review.changed) { if (mode === "apply") return }` —
  // BEFORE it reaches its own `appendTurn`. The only turns recorded were then
  // the two BUILD turns, both written before `render` exists, so the
  // "no image bytes in the turn log" test could not fail: a mutant that
  // appended the base64 payload onto the review turn's message was writing to
  // a call that never happened. A review that rewrites the hero is what makes
  // the stage run all the way to the write it is being watched for.
  mock(reviewDoc).mockResolvedValue({
    changed: true,
    doc: doc("Reviewed: rotational power in eight weeks"),
    ops: [{ op: "update_section", id: "hero", props: { headline: "Reviewed: rotational power in eight weeks" } }],
    summary: "Tightened the hero headline.",
    findings: [],
    surviving: [],
    receipt: null,
    tokensUsed: 1200,
    error: null,
  })

  mock(renderDocToImages).mockResolvedValue(renderedOk())

  // Revisions advance 4 -> 5 (user turn) -> 6 (assistant turn).
  let next = 4
  mock(appendTurn).mockImplementation(async (input: { expectedRevision: number }) => {
    next = input.expectedRevision + 1
    return { ok: true, turn: { revision: next, doc: null, message: "" }, revision: next }
  })

  mock(streamAgent).mockReset()
  // Default: an ordinary edit (no `set_page`), so `shouldReview` stays closed
  // and `renderDocToImages` is untouched unless a test opts into a first draft.
  mock(streamAgent).mockImplementation(() =>
    agentResult({
      reply: "Rewrote the hero headline.",
      blocked: false,
      ops: [{ op: "update_section", id: "hero", props: { headline: "New headline" } }],
    }),
  )
})

describe("POST .../build — the review stage renders before it reviews", () => {
  it("renders the page and gives it to the review", async () => {
    mock(streamAgent).mockImplementation(() => agentResult(setPageResult()))

    await readEvents(await POST(req({ message: "build me a page", revision: 4 }), ctx))

    // MUTANT: calling `reviewDoc` without ever calling `renderDocToImages` (or
    // calling it and dropping the result on the floor). Both leave the art
    // director exactly where it stood before this feature — seeing only JSON.
    expect(renderDocToImages).toHaveBeenCalledTimes(1)
    expect(reviewDoc).toHaveBeenCalledWith(
      expect.objectContaining({ render: expect.objectContaining({ images: expect.any(Array) }) }),
    )
  })

  it("renders the stored document, with this funnel's base path and brand", async () => {
    mock(streamAgent).mockImplementation(() => agentResult(setPageResult()))

    const events = await readEvents(await POST(req({ message: "build me a page", revision: 4 }), ctx))

    // WHICH DOCUMENT, AND WITH WHAT. The test above pins only that a render
    // happened; every assertion in it survives rendering an empty document
    // with no base path and no brand.
    //
    // This is the claim that matters. The critic has to be shown the page the
    // owner will actually get, which is the ALREADY-RESOLVED document the
    // build turn stored — the same object `appendTurn` was handed and `result`
    // carried. Render anything else (the model's raw pre-resolution ops, a
    // fresh empty doc, the draft as it stood before this turn) and the critic
    // is judging a picture of a page that publish will never ship: this
    // subsystem's worst failure mode, preview and publish disagreeing about
    // one document.
    //
    // `funnelBasePath` and `brandKit` are half of that same claim. Drop the
    // base path and every in-funnel button in the screenshot points nowhere;
    // drop the brand kit and the critic reviews the palette of a page nobody
    // will ever see. Both come from the ROUTE'S OWN `PageContext` — the object
    // it already uses to compile what it stores — not from the render's
    // defaults.
    expect(renderDocToImages).toHaveBeenCalledWith(
      storedDoc(events),
      expect.objectContaining({ funnelBasePath: EXPECTED_BASE_PATH, brandKit: EXPECTED_BRAND_KIT }),
    )
  })

  it("reviews anyway when the render fails", async () => {
    mock(streamAgent).mockImplementation(() => agentResult(setPageResult()))
    mock(renderDocToImages).mockResolvedValue(renderedFailed())

    const res = await POST(req({ message: "build me a page", revision: 4 }), ctx)
    // The build turn's `result` is emitted before the review stage runs at
    // all, so the response is already 200 by the time this awaits — but the
    // stream itself must still be drained for the review stage to execute.
    await res.clone().text()

    // MUTANT: an early return when `render.error` is set, which would also
    // silently turn off the review whenever a browser cannot be launched —
    // exactly the case this test forces.
    expect(res.status).toBe(200)
    expect(reviewDoc).toHaveBeenCalledTimes(1)
  })

  it("says nothing to the owner when the render fails", async () => {
    // THE SILENCE PROMISE, PINNED. `render.error` is `console.warn`ed and
    // never emitted: on the automatic path the owner already has a finished
    // page, and an event saying a background improvement was slightly less
    // well informed reads as a failure of the thing that just worked.
    //
    // Asserted by COMPARING THE TWO RUNS rather than by listing forbidden
    // event types. A run whose render failed must be indistinguishable, in the
    // stream, from one whose render succeeded — which catches an extra `fail`,
    // an extra `phase`, a `finding` carrying the browser error, or anything
    // else a future hand might reach for, without this test having to predict
    // which.
    mock(streamAgent).mockImplementation(() => agentResult(setPageResult()))

    const FAILURE = "no browser available for rendering"
    mock(renderDocToImages).mockResolvedValue(renderedFailed(FAILURE))
    const failed = await readEvents(await POST(req({ message: "build me a page", revision: 4 }), ctx))

    // The control. A fresh admin so the module-level rate limiter, which is
    // keyed by user id, does not see this as a second turn from one person.
    mock(auth).mockResolvedValue(freshAdmin())
    mock(renderDocToImages).mockResolvedValue(renderedOk())
    const succeeded = await readEvents(await POST(req({ message: "build me a page", revision: 4 }), ctx))

    // The presence control: an "emitted nothing" assertion passes just as well
    // when the stream never ran at all.
    expect(succeeded.map((e) => e.type)).toContain("result")
    expect(succeeded.map((e) => e.type)).toContain("review")

    expect(failed.map((e) => e.type)).toEqual(succeeded.map((e) => e.type))
    expect(failed.some((e) => e.type === "fail")).toBe(false)
    // Belt and braces: not even carried inside an event the successful run
    // also emits.
    expect(JSON.stringify(failed)).not.toContain(FAILURE)
  })

  it("never puts image bytes in the turn log", async () => {
    // Phase 1's idiom (see the reference-image tests in build-route.test.ts):
    // assert against the SERIALIZED call list, not one field, so a mutant
    // that smuggles the payload into any argument of any call is caught. The
    // render is transient — handed to the model and garbage afterwards.
    mock(streamAgent).mockImplementation(() => agentResult(setPageResult()))

    await readEvents(await POST(req({ message: "build me a page", revision: 4 }), ctx))

    // THE PRESENCE CONTROL, AND IT IS THE POINT OF THIS TEST.
    //
    // Three turns: the owner's message, the built page, and the review's own
    // polish. Only the third is written AFTER `render` exists, so if it is
    // missing, the assertion below is inspecting two turns that were recorded
    // before there were any bytes to leak and cannot fail. That is exactly
    // what happened while `reviewDoc` answered `changed: false` — see the note
    // on the mock in `beforeEach`.
    const written = mock(appendTurn).mock.calls.map((c) => {
      const input = c[0] as { role: string; source: string }
      return `${input.role}/${input.source}`
    })
    expect(written).toEqual(["user/ai", "assistant/ai", "assistant/review"])

    const serialized = JSON.stringify(mock(appendTurn).mock.calls)
    expect(serialized).not.toContain("AAAA")
  })

  it("does not render on an ordinary edit turn", async () => {
    // The default `streamAgent` mock answers with `update_section`, not
    // `set_page` — `shouldReview` stays closed and the whole stage, render
    // included, must never run.
    mock(getDraft).mockResolvedValue({ doc: doc(), docInvalid: false, revision: 4 })

    await readEvents(await POST(req({ message: "shorter headline", revision: 4 }), ctx))

    expect(renderDocToImages).not.toHaveBeenCalled()
  })
})
