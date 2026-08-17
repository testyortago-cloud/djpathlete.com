// __tests__/app/api/admin/funnels/build-route.test.ts
//
// EVERY TEST HERE NAMES THE MUTANT IT KILLS. This repo's dominant defect class
// is a test that cannot fail, and this feature has produced six of them in one
// day — most recently a fake DB client that recorded the columns it was asked
// for and never asserted them, which let a mutant through that would have made
// every write fail to save with a green suite. So: nothing below asserts only
// a status code where the interesting claim is about what was WRITTEN, and
// nothing asserts "was called" where the claim is about what it was called
// WITH.
//
// WHAT IS DELIBERATELY NOT MOCKED: `applyOps`, `resolveDoc`, `reassemble`,
// `compileFunnelStep` and `loadCatalogues` all run for real. They are pure (or,
// for `loadCatalogues`, pure over three mocked DAL reads), so mocking them
// would replace the exact machinery this route exists to wire together with a
// restatement of what it is assumed to do. The truncation test in particular
// makes the REAL `loadCatalogues` throw, by handing its recognition read 1000
// rows, rather than a `mockRejectedValue` that proves only that try/catch
// catches.

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
// The review stage. MOCKED FOR A CORRECTNESS REASON, NOT A SPEED ONE: only
// `streamAgent` is faked above, so `callAgent` is the real one — and the review
// runs automatically on every `set_page`, which is what the first-draft tests
// below produce. Left unmocked, those existing tests would each fire four live
// Anthropic calls. `shouldReview` stays REAL, because which turns earn a review
// is exactly what the tests here are about.
vi.mock("@/lib/funnels/sections/review/pipeline", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/funnels/sections/review/pipeline")>()),
  reviewDoc: vi.fn(),
}))
// The three catalogue reads, so the REAL `loadCatalogues` runs over them.
vi.mock("@/lib/db/programs", () => ({ getPrograms: vi.fn(), getAllPrograms: vi.fn() }))
vi.mock("@/lib/db/session-pack-products", () => ({ listActiveProducts: vi.fn(), listAllProducts: vi.fn() }))
vi.mock("@/lib/db/events", () => ({ getEvents: vi.fn(), getPublishedEvents: vi.fn() }))

import { POST, maxDuration } from "@/app/api/admin/funnels/steps/[stepId]/build/route"
import { auth } from "@/lib/auth"
import { canAccessAdminPath } from "@/lib/permissions/guard"
import { streamAgent } from "@/lib/ai/anthropic"
import { createGenerationLog, updateGenerationLog } from "@/lib/db/ai-generation-log"
import { appendTurn, getDraft, listTurns, revertToRevision } from "@/lib/db/funnel-builder"
import { getFunnelById, getStep, listSteps } from "@/lib/db/funnels"
import { getFaqCountsByPage } from "@/lib/db/faqs"
import { getAllPrograms, getPrograms } from "@/lib/db/programs"
import { listActiveProducts, listAllProducts } from "@/lib/db/session-pack-products"
import { getEvents, getPublishedEvents } from "@/lib/db/events"
import { reviewDoc } from "@/lib/funnels/sections/review/pipeline"
import {
  SECTION_BUILDER_EDIT_MAX_TOKENS,
  SECTION_BUILDER_MAX_TOKENS_CEILING,
  SECTION_BUILDER_RATE_LIMIT_MAX,
  SECTION_BUILDER_SECTION_MAX_TOKENS,
} from "@/lib/funnels/sections/builder-config"
import type { SectionDoc } from "@/lib/funnels/sections/registry"
import { createBuildStreamDecoder, type BuildStreamEvent } from "@/lib/funnels/sections/build-stream"

const mock = (fn: unknown) => fn as ReturnType<typeof vi.fn>

const STEP_ID = "3f1b7c5e-1111-4222-8333-444444444444"
const ADMIN = { user: { id: "aaaaaaaa-1111-4222-8333-444444444444", role: "admin" } }

/** RFC-4122 conformant — Zod v4's `.uuid()` is strict, and `checkoutIslandSchema.productId` uses it. */
const PROGRAM_ID = "11111111-2222-4333-8444-555555555555"
const PROGRAM_NAME = "Comeback Code"

const STEP = { id: STEP_ID, funnel_id: "ffffffff-1111-4222-8333-444444444444", slug: "apply", name: "Apply" }
const FUNNEL = { id: STEP.funnel_id, slug: "summer-camp", name: "Summer camp", status: "draft" }

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

/** A full page, for the first-draft `set_page` path. */
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

/**
 * A page every schema in the pipeline accepts and `reassemble` still reports as
 * unpublishable — the ONLY such document, because `reassemble`'s `problems` are
 * the publish size caps and nothing else.
 *
 * The lever is `escapeHtml`, which turns one `&` into five characters. A
 * maxed-out FAQ answer (1000 chars, the registry's own limit) therefore renders
 * as 5000; twelve per section, eight sections, ~580 KB against
 * `FUNNEL_STEP_HTML_MAX_LENGTH`'s 500 KB. That is not a trick to dodge a check
 * — it is precisely why the cap is measured on RENDERED output instead of on
 * the document, and doc.ts says as much: the per-field limits multiplied out
 * across 24 sections cannot reach the cap on their own.
 */
function overCapSections() {
  const q = "&".repeat(200)
  const a = "&".repeat(1000)
  return Array.from({ length: 8 }, (_, index) => ({
    id: `faq-${index}`,
    kind: "faq",
    variant: "stack",
    style: {},
    props: { source: "inline", items: Array.from({ length: 12 }, () => ({ q, a })) },
  }))
}

// ---------------------------------------------------------------------------
// The streaming harness.
//
// `streamAgent` is SYNCHRONOUS and returns a handle: `fullStream` to iterate
// and `object` to await. The route reads the whole stream and then awaits the
// object, so a fake has to supply both — and a fresh one per call, because a
// generator is drained by its first reader and the retry tests call twice.
// ---------------------------------------------------------------------------

/** Matches what the real provider reports: 200 in + 1000 out = 1200 total. */
const USAGE = {
  inputTokens: 200,
  outputTokens: 1000,
  inputTokenDetails: { cacheWriteTokens: 3400, cacheReadTokens: 0 },
}

function agentResult(content: unknown) {
  return {
    object: Promise.resolve(content),
    fullStream: (async function* () {
      // One `object` part carrying the finished response. The route's section
      // events are derived from these, so a fake that yielded nothing here
      // would still exercise every downstream branch — which is exactly why
      // the progress assertions below drive a MULTI-part stream instead.
      yield { type: "object", object: content }
      yield { type: "finish", usage: USAGE }
    })(),
  }
}

/**
 * A model call that fails the way the real one does: the stream ends and the
 * object rejects. `generateObject` used to throw for a refusal, a truncated
 * response and a schema violation alike, and `streamObject` surfaces all three
 * here, so this is the faithful shape for all of them.
 */
function agentFailure(message: string) {
  const object = Promise.reject(new Error(message))
  // The route claims this rejection immediately; claiming it here too keeps
  // the test runner from reporting an unhandled rejection for the tests that
  // never reach the route's own handler.
  object.catch(() => {})
  return {
    object,
    fullStream: (async function* () {
      yield { type: "finish", usage: USAGE }
    })(),
  }
}

/**
 * Every event the route wrote, in order. For assertions about PROGRESS —
 * what the owner is shown while the model is writing.
 */
async function readEvents(res: Response): Promise<BuildStreamEvent[]> {
  expect(res.headers.get("content-type")).toContain("text/event-stream")
  return createBuildStreamDecoder()(await res.text())
}

/**
 * POST a build turn and WAIT FOR THE WHOLE TURN, discarding the events.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS: `await POST(...)` NO LONGER WAITS FOR THE TURN.
 * ---------------------------------------------------------------------------
 * It used to, by accident. `withAudit` awaited `resp.clone().json()` before
 * returning, and cloning a streaming Response TEES the body — so that await
 * did not settle until the stream closed, and every assertion about what the
 * route WROTE happened to run after the writes had finished.
 *
 * That was the bug that made the live progress stream useless in production:
 * the client got nothing until the turn was over. Fixing it (with-audit.ts,
 * `isStreamingResponse`) means `POST` now returns as soon as the headers are
 * ready, which is correct — and which leaves any test that asserts on a
 * database write racing the handler it is testing.
 *
 * So the waiting is now explicit and in one place. A test that asserts about
 * writes uses this; a test that asserts about a pre-flight status code can
 * still use `POST` directly, because those responses are ordinary JSON.
 */
async function runTurn(body: unknown): Promise<Response> {
  const res = await POST(req(body), ctx)
  // Only a streaming response has work still in flight behind it.
  if ((res.headers.get("content-type") ?? "").includes("text/event-stream")) {
    await res.clone().text()
  }
  return res
}

/**
 * The turn, however the route chose to deliver it.
 *
 * A pre-flight failure is still ordinary JSON with a real status; a build turn
 * is an SSE body ending in `result`. One helper reads both so the tests below
 * assert the OUTCOME rather than the transport, which is the whole claim of
 * this change — the turn contract did not move.
 *
 * A stream that ends in `fail`, or in nothing at all, THROWS. Neither is a
 * turn, and returning undefined would let an assertion about a turn's contents
 * pass by reading properties off nothing.
 */
async function readTurn(res: Response): Promise<any> {
  if (!(res.headers.get("content-type") ?? "").includes("text/event-stream")) {
    return res.json()
  }
  const events = await readEvents(res)
  const terminal = events.filter((event) => event.type === "result" || event.type === "fail").pop()
  if (!terminal) throw new Error("the stream ended with no terminal event")
  if (terminal.type === "fail") {
    throw new Error(`the stream ended in fail(${terminal.status}): ${JSON.stringify(terminal.body)}`)
  }
  return terminal.turn
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

beforeEach(() => {
  vi.clearAllMocks()
  mock(auth).mockResolvedValue(freshAdmin())
  mock(canAccessAdminPath).mockResolvedValue(true)

  mock(getDraft).mockResolvedValue({ doc: doc(), docInvalid: false, revision: 4 })
  mock(getStep).mockResolvedValue(STEP)
  mock(getFunnelById).mockResolvedValue(FUNNEL)
  mock(listSteps).mockResolvedValue([STEP, { ...STEP, id: "other", slug: "thanks" }])
  mock(getFaqCountsByPage).mockResolvedValue({ coaching: 4 })
  mock(listTurns).mockResolvedValue([])

  mock(getAllPrograms).mockResolvedValue([{ id: PROGRAM_ID, name: PROGRAM_NAME }])
  mock(getPrograms).mockResolvedValue([{ id: PROGRAM_ID, name: PROGRAM_NAME }])
  mock(listAllProducts).mockResolvedValue([])
  mock(listActiveProducts).mockResolvedValue([])
  mock(getEvents).mockResolvedValue([])
  mock(getPublishedEvents).mockResolvedValue([])

  mock(createGenerationLog).mockResolvedValue({ id: "log-1" })
  mock(updateGenerationLog).mockResolvedValue({})

  // The review finds nothing by default, so every pre-existing test below sees
  // the behaviour it was written against. The review-specific tests override
  // this; nothing else should have to know the stage exists.
  mock(reviewDoc).mockResolvedValue({
    changed: false,
    doc: doc(),
    ops: [],
    summary: "",
    findings: [],
    surviving: [],
    receipt: null,
    tokensUsed: 0,
    error: null,
  })

  // Revisions advance 4 -> 5 (user turn) -> 6 (assistant turn).
  let next = 4
  mock(appendTurn).mockImplementation(async (input: { expectedRevision: number }) => {
    next = input.expectedRevision + 1
    return { ok: true, turn: { revision: next, doc: null, message: "" }, revision: next }
  })

  // `mockReset`, not just the `clearAllMocks` above: several tests below queue
  // TWO `...Once` results to drive the retry, and `clearAllMocks` clears
  // recorded calls WITHOUT draining that queue. A mutation that consumes only
  // the first queued value therefore leaves the second one to be picked up by
  // the NEXT test — which made three unrelated tests go red during mutation
  // testing and would, in the other direction, let a leaked "once" satisfy a
  // test whose own setup was wrong. Scoped to this one mock rather than a
  // blanket `resetAllMocks`, which has bitten this repo before by wiping a
  // throwing implementation a later test depended on.
  mock(streamAgent).mockReset()
  // `mockImplementation`, never `mockReturnValue`: a shared handle would have
  // its `fullStream` generator drained by the first read, so the second call in
  // a retry test would see an empty stream and a resolved object it had already
  // consumed. Every call builds its own.
  mock(streamAgent).mockImplementation(() =>
    agentResult({
      reply: "Rewrote the hero headline.",
      blocked: false,
      ops: [{ op: "update_section", id: "hero", props: { headline: "New headline" } }],
    }),
  )
})

// ---------------------------------------------------------------------------
// The auth gate
// ---------------------------------------------------------------------------

describe("POST /api/admin/funnels/steps/:stepId/build — auth", () => {
  it("403s a signed-in non-admin and never reads the draft", async () => {
    // MUTANT: dropping `canAccessAdminPath` (or checking only that a session
    // exists). A `client` session would then be able to rewrite funnel pages
    // and spend Opus tokens doing it.
    mock(canAccessAdminPath).mockResolvedValue(false)
    const res = await runTurn({ message: "hi", revision: 4 })
    expect(res.status).toBe(403)
    expect(getDraft).not.toHaveBeenCalled()
    expect(streamAgent).not.toHaveBeenCalled()
  })

  it("403s an anonymous request", async () => {
    // MUTANT: `session?.user?.id` dropped from the condition — this route is
    // not covered by middleware's /admin/* matcher (that matches PAGES), so
    // the handler's own check is the only gate.
    mock(auth).mockResolvedValue(null)
    const res = await runTurn({ message: "hi", revision: 4 })
    expect(res.status).toBe(403)
    expect(getDraft).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// Body, rate limit, existence
// ---------------------------------------------------------------------------

describe("POST .../build — request handling", () => {
  it("400s a body with no message and no revision", async () => {
    // MUTANT: not validating, then reading `body.message` as undefined and
    // sending an empty owner message to the model.
    expect((await POST(req({}), ctx)).status).toBe(400)
    expect((await POST(req({ message: "hi" }), ctx)).status).toBe(400)
    expect((await POST(req({ message: "", revision: 4 }), ctx)).status).toBe(400)
    expect(streamAgent).not.toHaveBeenCalled()
  })

  it("429s once the per-user window is full, and the limit is the BUILDER's, not the chatbot's", async () => {
    // MUTANT: importing AI_CHAT_RATE_LIMIT_MAX (10) from admin-ai-config
    // instead of SECTION_BUILDER_RATE_LIMIT_MAX (20). Firing exactly
    // SECTION_BUILDER_RATE_LIMIT_MAX requests and requiring all of them to
    // pass fails immediately under the smaller constant.
    const who = freshAdmin()
    mock(auth).mockResolvedValue(who)
    for (let i = 0; i < SECTION_BUILDER_RATE_LIMIT_MAX; i++) {
      expect((await POST(req({ message: "again", revision: 4 }), ctx)).status).toBe(200)
    }
    const res = await runTurn({ message: "one too many", revision: 4 })
    expect(res.status).toBe(429)
  })

  it("404s when the step does not exist", async () => {
    mock(getDraft).mockResolvedValue(null)
    mock(getStep).mockResolvedValue(null)
    expect((await POST(req({ message: "hi", revision: 0 }), ctx)).status).toBe(404)
  })
})

// ---------------------------------------------------------------------------
// (e) The optimistic lock
// ---------------------------------------------------------------------------

describe("POST .../build — the optimistic lock", () => {
  it("409s a stale client revision BEFORE spending a model call, and says what to re-sync to", async () => {
    // MUTANT: comparing revisions but not returning early — two admin tabs then
    // silently overwrite each other, and because the document is a FULL
    // snapshot per turn the loser's page reverts several turns with no message.
    mock(getDraft).mockResolvedValue({ doc: doc(), docInvalid: false, revision: 9 })
    const res = await runTurn({ message: "hi", revision: 4 })
    expect(res.status).toBe(409)
    const body = await readTurn(res)
    expect(body.code).toBe("stale_revision")
    expect(body.currentRevision).toBe(9)
    expect(streamAgent).not.toHaveBeenCalled()
    expect(appendTurn).not.toHaveBeenCalled()
  })

  it("409s when appendTurn's compare-and-swap loses the race, even though the read agreed", async () => {
    // MUTANT: treating `appendTurn`'s result as fire-and-forget. The read-side
    // check above cannot see a writer that arrives DURING the model call; only
    // the CAS result can, and ignoring it drops the turn on the floor with a
    // 200 and a doc the DB never stored.
    mock(appendTurn).mockResolvedValue({ ok: false, reason: "stale_revision", currentRevision: 11 })
    const res = await runTurn({ message: "hi", revision: 4 })
    expect(res.status).toBe(409)
    const body = await readTurn(res)
    expect(body.code).toBe("stale_revision")
    expect(body.currentRevision).toBe(11)
  })
})

// ---------------------------------------------------------------------------
// (b) + (c) docInvalid
// ---------------------------------------------------------------------------

describe("POST .../build — a draft this builder cannot read", () => {
  it("refuses rather than overwriting, spends nothing, and names the revision to restore", async () => {
    // MUTANT: collapsing `docInvalid` into "no document yet" and starting a
    // fresh page. That is silent, unrecoverable data loss — the owner's real
    // page (legacy GrapesJS state, or a document the registry has since
    // tightened past) is replaced by an AI first draft with no undo.
    mock(getDraft).mockResolvedValue({ doc: null, docInvalid: true, revision: 7 })
    mock(listTurns).mockResolvedValue([
      { revision: 2, doc: doc("older") },
      { revision: 5, doc: doc("last good") },
      // Newest, but not restorable: a user turn carries no document.
      { revision: 6, doc: null },
    ])

    const res = await runTurn({ message: "make the headline bigger", revision: 7 })
    expect(res.status).toBe(422)
    const body = await readTurn(res)
    expect(body.code).toBe("doc_invalid")
    expect(body.resetToRevision).toBe(5)
    expect(body.currentRevision).toBe(7)
    // The two claims that make this a refusal rather than a message.
    expect(streamAgent).not.toHaveBeenCalled()
    expect(appendTurn).not.toHaveBeenCalled()
  })

  it("says so honestly when no earlier revision is restorable", async () => {
    // MUTANT: defaulting `resetToRevision` to the current revision, or to 1 —
    // the client would then offer a reset button that always fails.
    mock(getDraft).mockResolvedValue({ doc: null, docInvalid: true, revision: 3 })
    mock(listTurns).mockResolvedValue([{ revision: 1, doc: null }, { revision: 2, doc: { not: "a doc" } }])
    const body = await readTurn(await POST(req({ message: "hi", revision: 3 }), ctx))
    expect(body.resetToRevision).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// (a) The retry — the whole point of this test file
// ---------------------------------------------------------------------------

describe("POST .../build — the one-shot retry", () => {
  it("retries an applyOps SEMANTIC error, not just a Zod error, and feeds the model the actual error", async () => {
    // MUTANT: `catch (parse error) { retry }` only — i.e. retrying when
    // `streamAgent` throws and giving up when `applyOps` returns
    // `{ok:false, errors}`. That mutant passes every "the retry works" test
    // written around a thrown error, and turns "no section with id x" — the
    // single most likely thing a model gets wrong — into a user-visible dead
    // end on a request that cost a full Opus call.
    //
    // Note what the first response is: `buildResultSchema` ACCEPTS it and
    // `opSchema` accepts every op in it. Nothing throws. The only signal is
    // `applyOps`'s return value.
    mock(streamAgent)
      .mockImplementationOnce(() =>
        agentResult({
          reply: "Updated the section.",
          blocked: false,
          ops: [{ op: "update_section", id: "does-not-exist", props: { headline: "x" } }],
        }),
      )
      .mockImplementationOnce(() =>
        agentResult({
          reply: "Rewrote the hero headline.",
          blocked: false,
          ops: [{ op: "update_section", id: "hero", props: { headline: "Second time lucky" } }],
        }),
      )

    const res = await runTurn({ message: "change the headline", revision: 4 })
    expect(res.status).toBe(200)
    expect(streamAgent).toHaveBeenCalledTimes(2)

    // The correction has to reach the MODEL, verbatim. A retry that resends the
    // identical prompt is a retry in name only — the model has no new
    // information and will make the same mistake.
    const secondUserMessage = mock(streamAgent).mock.calls[1][1] as string
    expect(secondUserMessage).toContain('no section with id "does-not-exist"')
    expect(secondUserMessage).not.toBe(mock(streamAgent).mock.calls[0][1])

    const body = await readTurn(res)
    expect(body.doc.sections[0].props.headline).toBe("Second time lucky")
    expect(body.reply).toBe("Rewrote the hero headline.")
  })

  it("retries a thrown parse/refusal the same way", async () => {
    // MUTANT: no retry at all. `stop_reason: "refusal"` and a truncated
    // response both surface through `streamObject` as a rejected `.object`.
    mock(streamAgent)
      .mockImplementationOnce(() => agentFailure("response did not match schema"))
      .mockImplementationOnce(() =>
        agentResult({
          reply: "Done.",
          blocked: false,
          ops: [{ op: "update_section", id: "hero", props: { headline: "Recovered" } }],
        }),
      )
    const body = await readTurn(await POST(req({ message: "hi", revision: 4 }), ctx))
    expect(streamAgent).toHaveBeenCalledTimes(2)
    expect(body.doc.sections[0].props.headline).toBe("Recovered")
  })

  it("retries exactly ONCE, then answers honestly with the draft intact — never a 500", async () => {
    // MUTANT 1: letting the throw escape, i.e. a 500 on a model refusal.
    // MUTANT 2: an unbounded retry loop, which on a systematically-rejected
    // batch burns the whole 300s budget and N Opus calls.
    // MUTANT 3: writing a document anyway — the draft must be untouched.
    mock(streamAgent).mockImplementation(() => agentFailure("no object generated: could not parse"))

    const res = await runTurn({ message: "hi", revision: 4 })
    expect(res.status).toBe(200)
    expect(streamAgent).toHaveBeenCalledTimes(2)

    const body = await readTurn(res)
    expect(body.reply).toBe("I couldn't build that — try describing it differently.")
    expect(body.doc.sections[0].props.headline).toBe("Rotational power in eight weeks")

    const assistantWrite = mock(appendTurn).mock.calls.map((c) => c[0]).filter((i) => i.role === "assistant")
    expect(assistantWrite).toHaveLength(1)
    expect(assistantWrite[0].status).toBe("failed")
    expect(assistantWrite[0].doc).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// (d) The catalogue
// ---------------------------------------------------------------------------

describe("POST .../build — a catalogue that cannot be read", () => {
  it("degrades to 'not checked' instead of 500ing, and still returns the document", async () => {
    // MUTANT: an unwrapped `loadCatalogues()`. Its truncation guard THROWS, and
    // unlike the publish-time truncation it replaced, an unhandled throw here
    // takes down EVERY builder turn on EVERY page rather than one page's
    // publish. The throw below is the REAL one: 1000 rows is exactly what
    // `assertNotTruncated` treats as a possibly-truncated recognition read.
    const thousand = Array.from({ length: 1000 }, (_, i) => ({ id: `p${i}`, name: `Program ${i}` }))
    mock(getAllPrograms).mockResolvedValue(thousand)

    const res = await runTurn({ message: "hi", revision: 4 })
    expect(res.status).toBe(200)

    const body = await readTurn(res)
    expect(body.doc.sections[0].props.headline).toBe("New headline")
    // `unresolved: []` here means NOT CHECKED, and the response has to say so —
    // a silent empty list reads as "every CTA resolved" and would let a UI
    // present an unpublishable page as ready.
    expect(body.unresolved).toEqual([])
    expect(body.resolutionError).toMatch(/not checked/i)
    expect(body.resolutionError).toMatch(/1000/)
  })

  it("advertises an EMPTY catalogue to the model when it could not be read", async () => {
    // MUTANT: falling back to a stale or partial catalogue, or omitting Block B
    // entirely. Telling the model about programs the server cannot resolve
    // produces CTAs that come back unresolved on every subsequent turn.
    mock(getAllPrograms).mockResolvedValue(Array.from({ length: 1000 }, (_, i) => ({ id: `p${i}`, name: `P${i}` })))
    await runTurn({ message: "hi", revision: 4 })
    const system = mock(streamAgent).mock.calls[0][0] as string
    expect(system).toContain("The catalogue — the only names a CTA may reference")
    expect(system).not.toContain(PROGRAM_NAME)
  })
})

// ---------------------------------------------------------------------------
// Resolution, compilation and what gets stored
// ---------------------------------------------------------------------------

describe("POST .../build — resolve, compile, store", () => {
  it("STORES the resolved document, so the ref is a real id from turn two onwards", async () => {
    // MUTANT: running the plan's literal step order — reassemble/compile (5)
    // BEFORE resolve (6) — and persisting the pre-resolution document. The
    // compiler would then build a checkout island around the string
    // "Comeback Code" as though it were a product id, and because the stored
    // doc keeps the NAME, `resolveDoc`'s id-match-first idempotence rule can
    // never engage: every turn re-resolves from scratch forever and a program
    // renamed tomorrow silently breaks a button committed today.
    const res = await runTurn({ message: "hi", revision: 4 })
    expect(res.status).toBe(200)

    const stored = mock(appendTurn).mock.calls.map((c) => c[0]).find((i) => i.doc)
    expect(stored).toBeDefined()
    expect(stored.doc.sections[0].props.primaryCta.target.ref).toBe(PROGRAM_ID)

    const body = await readTurn(res)
    expect(body.doc.sections[0].props.primaryCta.target.ref).toBe(PROGRAM_ID)
    expect(body.unresolved).toEqual([])
    expect(body.resolutionError).toBeNull()
  })

  it("compiles clean with NO warnings — dropped attributes are silent otherwise", async () => {
    // MUTANT: any renderer/compiler drift that makes `filterAttrs` drop an
    // attribute. `ok === true` alone cannot see it: a bad href or src is
    // removed silently and the page compiles green with a dead button. Only an
    // EMPTY `warnings` proves the round trip lost nothing.
    const body = await readTurn(await POST(req({ message: "hi", revision: 4 }), ctx))
    expect(body.compile.ok).toBe(true)
    expect(body.compile.problems).toEqual([])
    expect(body.compile.warnings).toEqual([])
  })

  it("reports an unresolvable CTA instead of resolving it to something plausible", async () => {
    // MUTANT: name matching against the RECOGNITION list, or a substring rule
    // loose enough to match anything. Either ships a live buy button for a
    // product that is not on sale.
    mock(getPrograms).mockResolvedValue([])
    mock(getAllPrograms).mockResolvedValue([])
    const body = await readTurn(await POST(req({ message: "hi", revision: 4 }), ctx))
    expect(body.unresolved).toHaveLength(1)
    expect(body.unresolved[0].ref).toBe(PROGRAM_NAME)
    expect(body.unresolved[0].kind).toBe("program")
    expect(body.resolutionError).toBeNull()
  })

  it("reports a dead in-page anchor, which nothing else in the pipeline can see", async () => {
    // MUTANT: dropping `danglingAnchors` from the response — the shape the
    // Stage 1.8 brief specified, and the shape Stage 1.9 cannot fix because it
    // is forbidden from editing app/api/. `<a href="#nope">` is valid markup,
    // so the compiler reports `ok: true, warnings: []` and the link silently
    // scrolls nowhere. `resolveDoc` is the only thing in the pipeline that
    // holds the whole document at once and can notice.
    mock(streamAgent).mockImplementation(() =>
      agentResult({
        reply: "Pointed the button at the pricing section.",
        blocked: false,
        ops: [
          {
            op: "update_section",
            id: "hero",
            props: { primaryCta: { label: "See plans", target: { kind: "anchor", sectionId: "pricing" } } },
          },
        ],
      }),
    )
    const body = await readTurn(await POST(req({ message: "hi", revision: 4 }), ctx))
    expect(body.danglingAnchors).toEqual([
      { sectionId: "hero", field: "primaryCta", target: "pricing" },
    ])
    // Reported, NOT blocking: the compile is still clean and the doc is saved.
    expect(body.compile.ok).toBe(true)
    expect(body.compile.warnings).toEqual([])
  })

  it("saves a page that does not compile — a draft is not a publish", async () => {
    // MUTANT: refusing to persist unless `compile.ok`. The owner would be
    // unable to iterate towards a page that DOES compile, because every turn
    // would be discarded. Publishing is the gate; drafting is not.
    //
    // FIX ROUND 1: the first version of this test used a `javascript:` media
    // src and asserted only a 200 plus a stored doc. That page COMPILES —
    // render.ts degrades a bad src to a placeholder div and reports nothing —
    // so `compile.ok` was true, the branch this test is named for never ran,
    // and its mutant survived. `reassemble`'s `problems` are the publish SIZE
    // CAPS and nothing else, so an over-cap page is the only document the
    // registry accepts that comes back non-compiling. Hence `overCapSections`,
    // and hence the `compile.ok === false` assertion below: without it, the
    // test passes on the happy path.
    mock(streamAgent).mockImplementation(() =>
      agentResult({
        reply: "Built the FAQ out.",
        blocked: false,
        ops: [{ op: "set_page", sections: overCapSections() }],
      }),
    )
    const res = await runTurn({ message: "hi", revision: 4 })
    expect(res.status).toBe(200)

    const body = await readTurn(res)
    // The premise. If this is true the test below proves nothing.
    expect(body.compile.ok).toBe(false)
    expect(body.compile.problems.join(" ")).toMatch(/over the 500000-character publish cap/)

    // ... and it was saved anyway, with the verdict recorded next to it.
    const stored = mock(appendTurn).mock.calls.map((c) => c[0]).find((i) => i.doc)
    expect(stored).toBeDefined()
    expect(stored.doc.sections).toHaveLength(8)
    expect(stored.compileStatus).toBe("failed")
    expect(stored.compileProblems.problems.join(" ")).toMatch(/publish cap/)
  })

  it("marks a turn whose CTAs were NEVER CHECKED as unchecked in the row, not as clean", async () => {
    // MUTANT: `unresolved: resolution.unresolved` at the write site. The
    // response carries `resolutionError`, but the response dies with the
    // request — the ROW would store `[]`, which is byte-identical to what a
    // turn with every CTA resolved stores. That is the same "the stored column
    // lies" failure this route's header calls out in `revertToRevision`'s
    // display cache, and it goes live the moment anything reads the column to
    // decide whether a page can be published.
    mock(getAllPrograms).mockResolvedValue(Array.from({ length: 1000 }, (_, i) => ({ id: `p${i}`, name: `P${i}` })))

    await runTurn({ message: "hi", revision: 4 })
    const stored = mock(appendTurn).mock.calls.map((c) => c[0]).find((i) => i.doc)
    expect(stored).toBeDefined()
    expect(Array.isArray(stored.unresolved)).toBe(false)
    expect(stored.unresolved).toMatchObject({ checked: false })
    expect(String(stored.unresolved.reason)).toMatch(/not checked/i)
  })

  it("stores a plain LIST when resolution did run, so a reader can tell the two apart", async () => {
    // MUTANT: writing the marker object unconditionally, or writing
    // `{checked:true, ...}` — either makes every turn look unchecked and the
    // distinction above worthless.
    mock(getPrograms).mockResolvedValue([])
    mock(getAllPrograms).mockResolvedValue([])
    await runTurn({ message: "hi", revision: 4 })
    const stored = mock(appendTurn).mock.calls.map((c) => c[0]).find((i) => i.doc)
    expect(Array.isArray(stored.unresolved)).toBe(true)
    expect(stored.unresolved).toHaveLength(1)
    expect(stored.unresolved[0].ref).toBe(PROGRAM_NAME)
  })
})

// ---------------------------------------------------------------------------
// The transcript and the spend ledger
// ---------------------------------------------------------------------------

describe("POST .../build — what it writes down", () => {
  it("records the owner's message as its own turn before spending anything", async () => {
    // MUTANT: writing only the assistant turn. `listTurns` is the sole source
    // of Block C's history, which alternates "Owner:" and "You:" — drop the
    // user turns and the model sees its own replies with nothing to reply to.
    const order: string[] = []
    mock(appendTurn).mockImplementation(async (input: { expectedRevision: number; role: string }) => {
      order.push(`append:${input.role}`)
      return { ok: true, turn: { revision: input.expectedRevision + 1 }, revision: input.expectedRevision + 1 }
    })
    mock(streamAgent).mockImplementation(() => {
      order.push("streamAgent")
      return agentResult({ reply: "ok", blocked: false, ops: [] })
    })

    await runTurn({ message: "make it shorter", revision: 4 })
    expect(order).toEqual(["append:user", "streamAgent", "append:assistant"])

    const userTurn = mock(appendTurn).mock.calls[0][0]
    expect(userTurn.message).toBe("make it shorter")
    expect(userTurn.expectedRevision).toBe(4)
    expect(userTurn.doc).toBeUndefined()

    // The assistant turn must chain off the revision the USER turn produced,
    // never off the client's original number — that would collide.
    expect(mock(appendTurn).mock.calls[1][0].expectedRevision).toBe(5)
  })

  it("logs spend under input_params.feature and passes NEITHER phantom column", async () => {
    // MUTANT: adding `generation_trigger` / `assessment_result_id` because
    // types/database.ts declares them. Prod's `ai_generation_log` has neither,
    // and PostgREST rejects the ENTIRE insert with PGRST204 on one unknown key
    // — which would kill the AI leg of every request.
    await runTurn({ message: "hi", revision: 4 })
    const insert = mock(createGenerationLog).mock.calls[0][0]
    expect(insert.input_params.feature).toBe("funnel_page_build")
    expect(Object.keys(insert)).not.toContain("generation_trigger")
    expect(Object.keys(insert)).not.toContain("assessment_result_id")
    expect(updateGenerationLog).toHaveBeenCalledWith("log-1", expect.objectContaining({ status: "completed" }))
  })

  it("bills the retried turn for BOTH calls", async () => {
    // MUTANT: `tokensUsed = result.tokens_used` instead of `+=`, which reports
    // only the winning attempt and understates every retried turn.
    mock(streamAgent)
      .mockImplementationOnce(() =>
        agentResult({ reply: "x", blocked: false, ops: [{ op: "update_section", id: "nope", props: { a: 1 } }] }),
      )
      .mockImplementationOnce(() =>
        agentResult({ reply: "y", blocked: false, ops: [{ op: "update_section", id: "hero", props: { sub: "s" } }] }),
      )
    await runTurn({ message: "hi", revision: 4 })
    expect(updateGenerationLog).toHaveBeenCalledWith("log-1", expect.objectContaining({ tokens_used: 2400 }))
  })

  it("still answers when the spend log cannot be opened", async () => {
    // MUTANT: awaiting `createGenerationLog` unguarded. A ledger outage would
    // then 500 an owner's page edit.
    mock(createGenerationLog).mockRejectedValue(new Error("PGRST204"))
    const res = await runTurn({ message: "hi", revision: 4 })
    expect(res.status).toBe(200)
  })
})

// ---------------------------------------------------------------------------
// The model declining
// ---------------------------------------------------------------------------

describe("POST .../build — blocked", () => {
  it("leaves the draft exactly as it was and does not apply the ops that came with it", async () => {
    // MUTANT: applying ops regardless of `blocked`. The prompt tells the model
    // to send no ops when it declines, but "the prompt says so" is not an
    // enforcement mechanism — a blocked reply carrying a half-built page would
    // silently overwrite the owner's document.
    mock(streamAgent).mockImplementation(() =>
      agentResult({
        reply: "There is no session pack by that name, so I have not changed anything.",
        blocked: true,
        ops: [{ op: "remove_section", id: "hero" }],
      }),
    )
    const res = await runTurn({ message: "sell the gold pack", revision: 4 })
    expect(res.status).toBe(200)

    const body = await readTurn(res)
    expect(body.blocked).toBe(true)
    expect(body.doc.sections).toHaveLength(1)

    const assistant = mock(appendTurn).mock.calls.map((c) => c[0]).find((i) => i.role === "assistant")
    expect(assistant.blocked).toBe(true)
    expect(assistant.doc).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// The first draft and its seed
// ---------------------------------------------------------------------------

describe("POST .../build — the first draft", () => {
  it("builds a page from nothing and leaves no placeholder behind", async () => {
    // `sectionDocSchema` bounds sections at 1..24, so a first draft has to
    // apply ops to a seed document. MUTANT: seeding and not checking the
    // output — a model answering with `add_section` instead of `set_page`
    // would leave an empty footer named "New page" on the owner's brand-new
    // page, valid, compiling clean, and visible.
    mock(getDraft).mockResolvedValue({ doc: null, docInvalid: false, revision: 0 })
    mock(streamAgent)
      .mockImplementationOnce(() =>
        agentResult({
          reply: "Added a hero.",
          blocked: false,
          ops: [{ op: "add_section", after: null, section: fullPageSections()[0] }],
        }),
      )
      .mockImplementationOnce(() =>
        agentResult({ reply: "Built the page.", blocked: false, ops: [{ op: "set_page", sections: fullPageSections() }] }),
      )

    const res = await runTurn({ message: "build me a camp page", revision: 0 })
    expect(res.status).toBe(200)
    expect(streamAgent).toHaveBeenCalledTimes(2)

    const body = await readTurn(res)
    expect(body.doc.sections.map((s: { id: string }) => s.id)).toEqual(["hero"])
    expect(body.doc.sections.some((s: { id: string }) => s.id === "draft-placeholder")).toBe(false)

    // And the correction reached the model rather than being swallowed.
    expect(mock(streamAgent).mock.calls[1][1]).toContain("set_page")
  })

  it("tells the model there is no page yet rather than showing it a seed", async () => {
    // MUTANT: passing the seed document into Block C. The model would then
    // treat "New page" as the owner's existing content and edit around it.
    mock(getDraft).mockResolvedValue({ doc: null, docInvalid: false, revision: 0 })
    mock(streamAgent).mockImplementation(() =>
      agentResult({ reply: "Built it.", blocked: false, ops: [{ op: "set_page", sections: fullPageSections() }] }),
    )
    await runTurn({ message: "build me a page", revision: 0 })
    const userMessage = mock(streamAgent).mock.calls[0][1] as string
    expect(userMessage).toContain("There is no page yet")
    expect(userMessage).not.toContain("draft-placeholder")
  })
})

// ---------------------------------------------------------------------------
// (c) The reset path
// ---------------------------------------------------------------------------

describe("POST .../build — reset to an earlier revision", () => {
  beforeEach(() => {
    mock(revertToRevision).mockResolvedValue({
      ok: true,
      revision: 8,
      turn: {
        revision: 8,
        doc: doc("restored headline"),
        message: "Restored the page as it was at step 5.",
        compile_status: "ok",
        compile_problems: [],
        // The STALE display cache the DAL copies forward.
        unresolved: [],
      },
    })
  })

  it("restores the document and returns it compiled", async () => {
    // MUTANT: no reset path at all. A document with a malformed section is
    // rejected by `applyOps` at its entry parse, before any op is inspected —
    // so unlike a duplicate id (repairable by `set_page`) there is no chat
    // instruction that can ever fix it. Without this, that page is dead.
    const res = await runTurn({ action: "reset", toRevision: 5 })
    expect(res.status).toBe(200)
    const body = await readTurn(res)
    expect(body.source).toBe("revert")
    expect(body.revision).toBe(8)
    expect(body.doc.sections[0].props.headline).toBe("restored headline")
    expect(body.compile.ok).toBe(true)
    expect(revertToRevision).toHaveBeenCalledWith(expect.objectContaining({ stepId: STEP_ID, toRevision: 5 }))
    expect(streamAgent).not.toHaveBeenCalled()
  })

  it("RE-RESOLVES against the live catalogue instead of trusting the restored row", async () => {
    // MUTANT: returning `turn.unresolved` from the restored row. The DAL copies
    // those three columns forward as a DISPLAY CACHE computed against the
    // catalogue as it was at that revision — its own comment says the route
    // must re-resolve. Here the restored turn claims `unresolved: []` while the
    // program it points at no longer exists, so the mutant tells the owner the
    // page is publishable when it is not.
    mock(getPrograms).mockResolvedValue([])
    mock(getAllPrograms).mockResolvedValue([])
    const body = await readTurn(await POST(req({ action: "reset", toRevision: 5 }), ctx))
    expect(body.unresolved).toHaveLength(1)
    expect(body.unresolved[0].ref).toBe(PROGRAM_NAME)
  })

  it("maps every revert failure to its own status", async () => {
    // MUTANT: collapsing these into one 500 or one 404. "That turn has no
    // document" is a click on a user turn in the transcript — routine, and
    // needs its own message.
    mock(revertToRevision).mockResolvedValue({ ok: false, reason: "stale_revision", currentRevision: 12 })
    const stale = await POST(req({ action: "reset", toRevision: 5 }), ctx)
    expect(stale.status).toBe(409)
    expect((await readTurn(stale)).currentRevision).toBe(12)

    mock(revertToRevision).mockResolvedValue({ ok: false, reason: "revision_has_no_doc" })
    expect((await POST(req({ action: "reset", toRevision: 5 }), ctx)).status).toBe(422)

    mock(revertToRevision).mockResolvedValue({ ok: false, reason: "revision_not_found" })
    expect((await POST(req({ action: "reset", toRevision: 5 }), ctx)).status).toBe(404)
  })

  it("rejects a reset to revision 0, which no turn can ever carry", async () => {
    // MUTANT: `min(0)` copied from the build member. Revision 0 is the state
    // before any turn exists.
    expect((await POST(req({ action: "reset", toRevision: 0 }), ctx)).status).toBe(400)
    expect(revertToRevision).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// The prompt this route actually sends
// ---------------------------------------------------------------------------

describe("POST .../build — the prompt", () => {
  it("sends the catalogue by NAME, never by id, and caches the system prefix", async () => {
    // MUTANT: passing the recognition set, or a catalogue rendered with ids.
    // One UUID in the prompt is a training signal to emit UUIDs, which is the
    // exact failure the whole name-not-id design exists to make impossible.
    await runTurn({ message: "hi", revision: 4 })
    const [system, , , options] = mock(streamAgent).mock.calls[0]
    expect(system).toContain(PROGRAM_NAME)
    expect(system).not.toContain(PROGRAM_ID)
    expect(options.cacheSystemPrompt).toBe(true)
    // `streamAgent`'s default of 32000 must be overridden — `generateObject` is
    // non-streaming, so a huge budget invites SDK HTTP timeouts.
    expect(options.maxTokens).toBeLessThanOrEqual(16_000)
  })

  it("gives a FIRST DRAFT the whole-page budget, not the plan's per-section one", async () => {
    // MUTANT: `isFirstDraft ? SECTION_BUILDER_SECTION_MAX_TOKENS : EDIT` — what
    // shipped before fix round 1. 6000 was sized as a PER-SECTION budget for a
    // fan-out that was never built; as the budget for a whole first-draft page
    // it truncates the response, `generateObject` throws a parse error, the one
    // retry does exactly the same, and the owner's very first turn on a
    // brand-new page dead-ends. Nothing else in this file can see it: every
    // other test drives a mocked `streamAgent` that cannot run out of tokens.
    mock(getDraft).mockResolvedValue({ doc: null, docInvalid: false, revision: 0 })
    mock(streamAgent).mockImplementation(() =>
      agentResult({ reply: "Built it.", blocked: false, ops: [{ op: "set_page", sections: fullPageSections() }] }),
    )
    await runTurn({ message: "build me a page", revision: 0 })
    const firstDraftBudget = mock(streamAgent).mock.calls[0][3].maxTokens

    // The same turn against an EXISTING page. Comparing the two is what makes
    // this a claim about the BUDGET rather than a restatement of a constant.
    mock(streamAgent).mockClear()
    mock(getDraft).mockResolvedValue({ doc: doc(), docInvalid: false, revision: 4 })
    mock(streamAgent).mockImplementation(() =>
      agentResult({ reply: "ok", blocked: false, ops: [{ op: "update_section", id: "hero", props: { sub: "s" } }] }),
    )
    await runTurn({ message: "tweak it", revision: 4 })
    const editBudget = mock(streamAgent).mock.calls[0][3].maxTokens

    // A first draft is a single `set_page` carrying every section — the same
    // worst case as the largest edit, so the same budget.
    expect(firstDraftBudget).toBe(editBudget)
    expect(firstDraftBudget).toBe(SECTION_BUILDER_EDIT_MAX_TOKENS)
    expect(firstDraftBudget).not.toBe(SECTION_BUILDER_SECTION_MAX_TOKENS)
    expect(firstDraftBudget).toBeLessThanOrEqual(SECTION_BUILDER_MAX_TOKENS_CEILING)
  })

  it("offers the funnel's OTHER steps, never this one", async () => {
    // MUTANT: passing every step. A CTA pointing at the page it is on is a
    // no-op link the owner cannot diagnose.
    await runTurn({ message: "hi", revision: 4 })
    const system = mock(streamAgent).mock.calls[0][0] as string
    expect(system).toContain('"thanks"')
    expect(system).not.toContain('"apply"')
  })
})

// ---------------------------------------------------------------------------
// The platform contract
// ---------------------------------------------------------------------------

describe("POST .../build — the route's own runtime config", () => {
  it("pins the serverless timeout at 300s", () => {
    // MUTANT: dropping the `maxDuration` export. Vercel's default cap is far
    // below this, and a first draft is a WHOLE PAGE in one response — the ~60s
    // call the no-fan-out decision explicitly accepts. The platform would kill
    // the request mid-generation, after the Opus tokens were spent and before
    // any turn was written, and it would do it only in production where nothing
    // in this suite can see it.
    expect(maxDuration).toBe(300)
  })
})

// ---------------------------------------------------------------------------
// Progress reporting
//
// The claim under test is not "there is an animation". It is that what reaches
// the screen is DERIVED FROM THE MODEL'S OUTPUT — so every test here drives a
// stream that arrives in pieces and asserts the pieces come back out.
// ---------------------------------------------------------------------------

/** A model call whose response arrives across several partials, as a real one does. */
function agentStream(partials: unknown[], final: unknown, deltas = 3) {
  return {
    object: Promise.resolve(final),
    fullStream: (async function* () {
      for (const partial of partials) {
        for (let i = 0; i < deltas; i++) yield { type: "text-delta", textDelta: "x" }
        yield { type: "object", object: partial }
      }
      yield { type: "finish", usage: USAGE }
    })(),
  }
}

describe("POST .../build — what the owner is shown while it works", () => {
  it("emits each section as the model writes it, not all at the end", async () => {
    // MUTANT: collecting the sections and emitting them once the object
    // resolves. The display would sit empty for the whole call and then fill in
    // instantly — the exact spinner behaviour this replaced, wearing a
    // wireframe. The assertion that kills it is ORDERING: the hero must be on
    // the wire before the bullets section exists in any partial.
    const partials = [
      { ops: [{ op: "set_page", sections: [{ kind: "hero" }] }] },
      { ops: [{ op: "set_page", sections: [{ kind: "hero", props: { headline: "Join the waitlist" } }] }] },
      {
        ops: [
          {
            op: "set_page",
            sections: [
              { kind: "hero", props: { headline: "Join the waitlist" } },
              { kind: "bullets", props: { heading: "What the class is" } },
            ],
          },
        ],
      },
    ]
    mock(streamAgent).mockImplementation(() =>
      agentStream(partials, {
        reply: "Built the page.",
        blocked: false,
        ops: [{ op: "set_page", sections: fullPageSections() }],
      }),
    )
    mock(getDraft).mockResolvedValue({ doc: null, docInvalid: false, revision: 4 })

    const events = await readEvents(await POST(req({ message: "waitlist page", revision: 4 }), ctx))
    const sections = events.filter((event) => event.type === "section")

    // The hero appears first, bare; then gains its headline; then the bullets
    // section appears. Three events for two sections, in that order.
    expect(sections.map((event) => [event.section.kind, event.section.headline])).toEqual([
      ["hero", null],
      ["hero", "Join the waitlist"],
      ["bullets", "What the class is"],
    ])
    // And every one of them was written BEFORE the turn finished.
    const resultIndex = events.findIndex((event) => event.type === "result")
    const lastSectionIndex = events.map((event) => event.type).lastIndexOf("section")
    expect(lastSectionIndex).toBeLessThan(resultIndex)
  })

  it("walks the phases in order and ends on checking", async () => {
    // MUTANT: emitting a single phase, or emitting `writing` before any section
    // exists. `writing` is a claim that the model has started producing the
    // page; making it on the way in would be a guess.
    const events = await readEvents(await POST(req({ message: "hi", revision: 4 }), ctx))
    const phases = events.filter((event) => event.type === "phase").map((event) => event.phase)
    expect(phases[0]).toBe("reading")
    expect(phases).toContain("planning")
    expect(phases).toContain("writing")
    expect(phases[phases.length - 1]).toBe("checking")
  })

  it("marks the live token count as an estimate and the final one as exact", async () => {
    // MUTANT: reporting the delta count as `exact: true`, or never sending the
    // provider's real figure. The meter would present a number this code made
    // up as a measurement — on a display whose entire value is that it shows
    // the real work.
    mock(streamAgent).mockImplementation(() =>
      agentStream(
        [{ ops: [{ op: "update_section", id: "hero", props: { headline: "New" } }] }],
        { reply: "Done.", blocked: false, ops: [{ op: "update_section", id: "hero", props: { headline: "New" } }] },
        40,
      ),
    )

    const events = await readEvents(await POST(req({ message: "hi", revision: 4 }), ctx))
    const usage = events.filter((event) => event.type === "usage")

    expect(usage.length).toBeGreaterThan(1)
    expect(usage.slice(0, -1).every((event) => event.exact === false)).toBe(true)

    const last = usage[usage.length - 1]
    expect(last.exact).toBe(true)
    expect(last.outputTokens).toBe(USAGE.outputTokens)
  })

  it("announces a retry so the stage can clear, instead of doubling the page", async () => {
    // MUTANT: no `restart` event. Attempt 2 rewrites the same page, so its
    // sections would append to attempt 1's and the owner would watch a
    // 2-section page grow to 4 sections that do not exist.
    mock(streamAgent)
      .mockImplementationOnce(() => agentFailure("response did not match schema"))
      .mockImplementationOnce(() =>
        agentResult({
          reply: "Recovered.",
          blocked: false,
          ops: [{ op: "update_section", id: "hero", props: { headline: "Recovered" } }],
        }),
      )

    const events = await readEvents(await POST(req({ message: "hi", revision: 4 }), ctx))
    const restart = events.find((event) => event.type === "restart")
    expect(restart).toEqual({ type: "restart", attempt: 2 })

    // And it is emitted BEFORE the second attempt's sections, or clearing on it
    // would wipe the very sections it was meant to make room for.
    const restartIndex = events.indexOf(restart!)
    const sectionIndex = events.findIndex((event) => event.type === "section")
    expect(restartIndex).toBeLessThan(sectionIndex)
  })
})

describe("POST .../build — failures that happen after the stream is open", () => {
  it("delivers a lost compare-and-swap on the ASSISTANT turn as a fail event carrying the 409 body", async () => {
    // MUTANT 1: emitting `{type:"error", error:"..."}` with a bare message. The
    // client routes `fail` through the same handler as a real 409, and that
    // handler needs `code` and `currentRevision` to resync the revision — a
    // flattened string silently disables the resync on exactly the race the
    // compare-and-swap exists to catch.
    // MUTANT 2: returning a 409 status. Impossible once bytes are on the wire —
    // the status was decided at the first byte — so a route that "returns" one
    // here actually returns 200 with no terminal event, and the client would
    // hang on a turn that never ends.
    mock(appendTurn).mockImplementation(async (input: { expectedRevision: number; role: string }) => {
      if (input.role === "user") {
        return { ok: true, turn: { revision: 5, doc: null, message: "" }, revision: 5 }
      }
      return { ok: false, reason: "stale_revision", currentRevision: 11 }
    })

    const res = await runTurn({ message: "hi", revision: 4 })
    expect(res.status).toBe(200)

    const events = await readEvents(res)
    const terminal = events[events.length - 1]
    expect(terminal.type).toBe("fail")
    expect(terminal).toMatchObject({
      status: 409,
      body: { code: "stale_revision", currentRevision: 11 },
    })
    expect(events.some((event) => event.type === "result")).toBe(false)
  })

  it("ends every stream with exactly one terminal event", async () => {
    // MUTANT: emitting `result` and then falling through to another emit. Two
    // terminal events mean the client's "last one wins" rule decides the turn,
    // which is a coin toss dressed as a contract.
    const events = await readEvents(await POST(req({ message: "hi", revision: 4 }), ctx))
    const terminals = events.filter((event) => event.type === "result" || event.type === "fail")
    expect(terminals).toHaveLength(1)
    expect(events[events.length - 1]).toBe(terminals[0])
  })
})

describe("POST .../build — which paths stream", () => {
  it("streams a build and does NOT stream a reset", async () => {
    // MUTANT: streaming both. `reset` copies a stored document forward without
    // calling a model, so a stream would frame a response that was already
    // complete — pure cost — and the client's reset path reads JSON.
    mock(revertToRevision).mockResolvedValue({
      ok: true,
      revision: 9,
      turn: { revision: 5, doc: doc("Restored"), message: "Restored step 5." },
    })

    const build = await POST(req({ message: "hi", revision: 4 }), ctx)
    expect(build.headers.get("content-type")).toContain("text/event-stream")

    const reset = await POST(req({ action: "reset", toRevision: 5 }), ctx)
    expect(reset.headers.get("content-type")).toContain("application/json")
  })

  it("keeps every pre-flight failure a real HTTP status with a JSON body", async () => {
    // MUTANT: opening the stream first and reporting these as `fail` events.
    // They would all become 200s, and `handleErrorResponse`'s 409/422 branches
    // — the restore button, the revision resync — would stop firing.
    mock(getDraft).mockResolvedValue({ doc: doc(), docInvalid: false, revision: 9 })
    const stale = await POST(req({ message: "hi", revision: 4 }), ctx)
    expect(stale.status).toBe(409)
    expect(stale.headers.get("content-type")).toContain("application/json")

    mock(getDraft).mockResolvedValue({ doc: null, docInvalid: true, revision: 9 })
    const invalid = await POST(req({ message: "hi", revision: 9 }), ctx)
    expect(invalid.status).toBe(422)
    expect(invalid.headers.get("content-type")).toContain("application/json")
  })
})

// ---------------------------------------------------------------------------
// The review stage.
//
// `reviewDoc` is mocked (see the note on the mock at the top of this file);
// `shouldReview` and `opsRewrotePage` are the real ones, because WHICH TURNS
// EARN A REVIEW is the claim these tests exist to pin. Getting that wrong is
// not a cosmetic defect — it is four extra model calls on every typo fix.
// ---------------------------------------------------------------------------

const REVIEWED_DOC = doc("A reviewed headline")

function reviewChanged(summary = "Retoned two seams.") {
  return {
    changed: true,
    doc: REVIEWED_DOC,
    ops: [{ op: "update_section", id: "hero", style: { tone: "muted" } }],
    summary,
    findings: [
      {
        code: "tone-run",
        severity: "high" as const,
        sectionIds: ["a", "b"],
        issue: "two sections share a tone",
        suggestion: "retone one",
        source: "audit" as const,
      },
    ],
    surviving: [],
    receipt: { changed: [], isRewrite: false } as never,
    tokensUsed: 1020,
    error: null,
  }
}

/** A model response that REPLACES the page — the first-draft shape. */
function setPageResult() {
  return {
    reply: "Drafted the page.",
    blocked: false,
    ops: [{ op: "set_page", sections: fullPageSections() }],
  }
}

/**
 * Install `reviewDoc` so it CALLS BACK the way the real one does.
 *
 * A plain `mockResolvedValue` returns the outcome without ever invoking
 * `onFinding`, which would leave the route's streaming half completely
 * unexercised — the `finding` events would silently never be emitted and the
 * assertions about them would be measuring the mock rather than the route.
 */
function installReview(outcome: ReturnType<typeof reviewChanged>) {
  mock(reviewDoc).mockImplementation(async (input: { onFinding?: (finding: unknown) => void }) => {
    for (const finding of outcome.findings) input.onFinding?.(finding)
    return outcome
  })
}

describe("POST .../build — which turns earn a review", () => {
  it("reviews a set_page, because every word on that page is the model's own", async () => {
    mock(streamAgent).mockImplementation(() => agentResult(setPageResult()))
    mock(getDraft).mockResolvedValue({ doc: null, docInvalid: false, revision: 4 })

    await readEvents(await POST(req({ message: "build me a page", revision: 4 }), ctx))

    expect(reviewDoc).toHaveBeenCalledTimes(1)
  })

  it("does NOT review an ordinary edit turn", async () => {
    // MUTANT: keying the trigger off `DiffReceipt.isRewrite`. That flag is a
    // 60%-of-sections VOLUME heuristic, so on this one-section draft an
    // ordinary headline edit scores 1/1 and reads as a full rewrite — and the
    // owner pays four model calls to fix a typo. The default mocked op here is
    // exactly that edit, which is why this test goes red under the mutant.
    await readEvents(await POST(req({ message: "shorter headline", revision: 4 }), ctx))

    expect(reviewDoc).not.toHaveBeenCalled()
  })

  it("does not review a turn the model refused", async () => {
    mock(streamAgent).mockImplementation(() =>
      agentResult({ reply: "The catalogue has no such program.", blocked: true, ops: [] }),
    )

    await readEvents(await POST(req({ message: "sell the moon", revision: 4 }), ctx))

    expect(reviewDoc).not.toHaveBeenCalled()
  })
})

describe("POST .../build — the review stage runs AFTER the page is safe", () => {
  beforeEach(() => {
    mock(streamAgent).mockImplementation(() => agentResult(setPageResult()))
    mock(getDraft).mockResolvedValue({ doc: null, docInvalid: false, revision: 4 })
  })

  it("emits result BEFORE it starts reviewing", async () => {
    // THE WHOLE SAFETY ARGUMENT. If `result` came after the review, a review
    // that hung would leave the owner watching a turn that had already
    // succeeded — and one that threw would report a failure for a page that
    // built fine.
    installReview(reviewChanged())

    const events = await readEvents(await POST(req({ message: "build", revision: 4 }), ctx))
    const types = events.map((event) => event.type)

    expect(types.indexOf("result")).toBeLessThan(types.indexOf("finding"))
    expect(types.indexOf("result")).toBeLessThan(types.indexOf("review"))
  })

  it("writes the review as its OWN turn, with source review", async () => {
    // MUTANT: appending with source "ai", or folding the polish into the build
    // turn. Both make "Go back to here" unable to undo the polish without also
    // discarding the draft it polished.
    installReview(reviewChanged())

    await readEvents(await POST(req({ message: "build", revision: 4 }), ctx))

    const reviewWrite = mock(appendTurn).mock.calls.find(
      (call) => (call[0] as { source: string }).source === "review",
    )
    expect(reviewWrite).toBeDefined()
    expect(reviewWrite?.[0]).toMatchObject({
      role: "assistant",
      source: "review",
      status: "complete",
      message: "Retoned two seams.",
    })
  })

  it("supersedes the ASSISTANT turn's revision, not the user turn's", async () => {
    // MUTANT: passing the pre-build revision. The compare-and-swap would fail
    // every time and the polish would be silently dropped on every page.
    installReview(reviewChanged())

    await readEvents(await POST(req({ message: "build", revision: 4 }), ctx))

    const calls = mock(appendTurn).mock.calls.map((call) => call[0] as { source: string; expectedRevision: number })
    // 4 -> 5 (user turn) -> 6 (assistant turn) -> the review must expect 6.
    const review = calls.find((call) => call.source === "review")
    expect(review?.expectedRevision).toBe(6)
  })

  it("streams each finding so the extra wait shows its work", async () => {
    installReview(reviewChanged())

    const events = await readEvents(await POST(req({ message: "build", revision: 4 }), ctx))
    const findings = events.filter((event) => event.type === "finding")

    expect(findings).toHaveLength(1)
    expect(findings[0]).toMatchObject({ finding: { code: "tone-run", severity: "high" } })
  })

  it("emits a review event carrying the polished document", async () => {
    installReview(reviewChanged())

    const events = await readEvents(await POST(req({ message: "build", revision: 4 }), ctx))
    const review = events.find((event) => event.type === "review")

    expect(review).toMatchObject({
      turn: { revision: 7, source: "review", reply: "Retoned two seams." },
    })
  })

  it("writes NOTHING when the review changed nothing", async () => {
    // MUTANT: appending a turn regardless. Every page would gain an empty
    // "I changed nothing" entry in the owner's transcript.
    await readEvents(await POST(req({ message: "build", revision: 4 }), ctx))

    expect(mock(appendTurn).mock.calls.some((call) => (call[0] as { source: string }).source === "review")).toBe(false)
  })
})

describe("POST .../build — a review that goes wrong cannot break the turn", () => {
  beforeEach(() => {
    mock(streamAgent).mockImplementation(() => agentResult(setPageResult()))
    mock(getDraft).mockResolvedValue({ doc: null, docInvalid: false, revision: 4 })
  })

  it("still delivers the built page when the review reports an error", async () => {
    mock(reviewDoc).mockResolvedValue({
      changed: false,
      doc: doc(),
      ops: [],
      summary: "",
      findings: [],
      surviving: [],
      receipt: null,
      tokensUsed: 120,
      error: "reviser failed",
    })

    const events = await readEvents(await POST(req({ message: "build", revision: 4 }), ctx))

    expect(events.some((event) => event.type === "result")).toBe(true)
    expect(events.some((event) => event.type === "fail")).toBe(false)
  })

  it("drops the polish silently when the owner edited underneath it", async () => {
    // A lost compare-and-swap on the REVIEW turn means a human was typing
    // while a background improvement ran. The human wins, and they must not be
    // shown an error about it — they already have a correct page.
    installReview(reviewChanged())
    mock(appendTurn).mockImplementation(async (input: { expectedRevision: number; source: string }) => {
      if (input.source === "review") return { ok: false, reason: "stale_revision", currentRevision: 99 }
      return {
        ok: true,
        turn: { revision: input.expectedRevision + 1, doc: null, message: "" },
        revision: input.expectedRevision + 1,
      }
    })

    const events = await readEvents(await POST(req({ message: "build", revision: 4 }), ctx))

    expect(events.some((event) => event.type === "result")).toBe(true)
    expect(events.some((event) => event.type === "fail")).toBe(false)
    expect(events.some((event) => event.type === "review")).toBe(false)
  })
})

describe("POST .../build — the Polish button PROPOSES, and writes nothing", () => {
  it("reviews without calling the builder at all", async () => {
    // MUTANT: implementing Polish as a message body. The builder would run
    // first, spending an Opus call answering a message the owner never wrote.
    installReview(reviewChanged("Tightened three headlines."))

    const events = await readEvents(await POST(req({ action: "polish", revision: 4 }), ctx))

    expect(streamAgent).not.toHaveBeenCalled()
    expect(reviewDoc).toHaveBeenCalledTimes(1)
    expect(events.some((event) => event.type === "proposal")).toBe(true)
  })

  it("WRITES NOTHING — no turn of any kind, however good the review was", async () => {
    // THE WHOLE FEATURE. Polish used to append a `source:"review"` turn the
    // instant the reviser returned, so the owner's first sight of the change
    // was a page that had already changed.
    //
    // MUTANT: restoring the `appendTurn` call before the proposal is emitted.
    // Nothing else in this file would notice — the stream still terminates and
    // the document is still correct — which is exactly why this assertion is
    // about the CALL COUNT and not about the response.
    installReview(reviewChanged("Tightened three headlines."))

    await runTurn({ action: "polish", revision: 4 })

    expect(appendTurn).not.toHaveBeenCalled()
  })

  it("emits the ops Apply will replay, and the revision they were computed against", async () => {
    // MUTANT: sending only `doc`. Apply would have nothing to re-apply and
    // would have to trust a document from the client — which is the authority
    // this design exists to keep on the server.
    installReview(reviewChanged())

    const events = await readEvents(await POST(req({ action: "polish", revision: 4 }), ctx))
    const proposal = events.find((event) => event.type === "proposal")

    expect(proposal).toBeDefined()
    const payload = (proposal as { proposal: Record<string, unknown> }).proposal
    expect(payload.baseRevision).toBe(4)
    expect(payload.ops).toEqual([{ op: "update_section", id: "hero", style: { tone: "muted" } }])
    // Carried for the preview, so the owner sees what they are agreeing to.
    expect(payload.doc).toBeTruthy()
  })

  it("says 'nothing worth changing' as a terminal event, without moving the revision", async () => {
    // This used to append a turn — burning a revision to record that nothing
    // happened. MUTANT: returning early with no event at all. The stream would
    // end with no terminal and the client would report a dropped connection on
    // a review that completed perfectly.
    installReview({ ...reviewChanged(), changed: false, ops: [], summary: "" })

    const events = await readEvents(await POST(req({ action: "polish", revision: 4 }), ctx))
    const proposal = events.find((event) => event.type === "proposal")

    expect(proposal).toBeDefined()
    expect((proposal as { proposal: unknown }).proposal).toBeNull()
    expect((proposal as { summary: string }).summary).toMatch(/nothing worth changing/i)
    expect(appendTurn).not.toHaveBeenCalled()
  })

  it("still fails loudly when the reviewer itself could not finish", async () => {
    // Unchanged behaviour, pinned because the error branch now sits beside a
    // `mode` check and is the easiest thing to break while editing it.
    installReview({ ...reviewChanged(), changed: false, ops: [], error: "review exceeded 60000ms" })

    const events = await readEvents(await POST(req({ action: "polish", revision: 4 }), ctx))
    const fail = events.find((event) => event.type === "fail")

    expect(fail).toBeDefined()
    expect((fail as { status: number }).status).toBe(502)
    expect(appendTurn).not.toHaveBeenCalled()
  })

  it("appends no user turn — the owner did not write a message", async () => {
    installReview(reviewChanged())

    await readEvents(await POST(req({ action: "polish", revision: 4 }), ctx))

    expect(mock(appendTurn).mock.calls.some((call) => (call[0] as { role: string }).role === "user")).toBe(false)
  })

  it("refuses when the client is behind, before spending anything", async () => {
    const res = await runTurn({ action: "polish", revision: 2 })

    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ code: "stale_revision", currentRevision: 4 })
    expect(reviewDoc).not.toHaveBeenCalled()
  })

  it("refuses when there is no page yet, rather than reviewing a seed", async () => {
    // MUTANT: falling through to `seedDoc()`. Four model calls would be spent
    // discovering that a one-section placeholder footer is too short.
    mock(getDraft).mockResolvedValue({ doc: null, docInvalid: false, revision: 4 })

    const res = await runTurn({ action: "polish", revision: 4 })

    expect(res.status).toBe(409)
    expect(reviewDoc).not.toHaveBeenCalled()
  })

  it("refuses a document this builder cannot read", async () => {
    mock(getDraft).mockResolvedValue({ doc: null, docInvalid: true, revision: 4 })
    mock(listTurns).mockResolvedValue([])

    const res = await runTurn({ action: "polish", revision: 4 })

    expect(res.status).toBe(422)
    expect(await res.json()).toMatchObject({ code: "doc_invalid" })
    expect(reviewDoc).not.toHaveBeenCalled()
  })
})

describe("POST .../build — accepting a proposed polish", () => {
  /** The op the propose leg emitted, replayed by the client on Apply. */
  const OPS = [{ op: "update_section", id: "hero", style: { tone: "muted" } }]

  it("writes exactly one turn, and spends nothing to do it", async () => {
    // MUTANT: leaving the model call in. The whole point of the split is that
    // the thinking was paid for on the propose leg — an Apply that re-ran the
    // reviewer would double the cost of every accepted polish AND could produce
    // a different page from the one the owner previewed and agreed to.
    const res = await runTurn({ action: "apply_polish", revision: 4, ops: OPS })

    expect(res.status).toBe(200)
    expect(streamAgent).not.toHaveBeenCalled()
    expect(reviewDoc).not.toHaveBeenCalled()
    expect(appendTurn).toHaveBeenCalledTimes(1)
  })

  it("records it as the REVIEWER's edit, not the builder's", async () => {
    // MUTANT: `source: "ai"`. Migration 00209 exists precisely so "the builder
    // wrote this, then the reviewer changed that" stays separable — folding
    // them together would make "Go back to here" unable to undo only the
    // polish. The owner pressing Apply does not make it the builder's work.
    await runTurn({ action: "apply_polish", revision: 4, ops: OPS })

    expect(mock(appendTurn).mock.calls[0][0]).toMatchObject({ source: "review", role: "assistant" })
  })

  it("applies the ops to the SERVER's document, not to anything the client sent", async () => {
    // The security claim, and the one a test can most easily fake. The draft on
    // the server has a headline no client ever sent; the ops touch only `style`.
    // If the route ever started trusting a client document, the stored doc's
    // headline would stop being this one.
    //
    // MUTANT: accepting a `doc` field from the body and storing it. There is no
    // `doc` in the request at all, so a route that read one would store
    // undefined and this assertion would go red.
    mock(getDraft).mockResolvedValue({ doc: doc("Only the server knows this"), docInvalid: false, revision: 4 })

    await runTurn({ action: "apply_polish", revision: 4, ops: OPS })

    const written = mock(appendTurn).mock.calls[0][0] as { doc: SectionDoc }
    expect(written.doc.sections[0].props.headline).toBe("Only the server knows this")
    expect(written.doc.sections[0].style).toMatchObject({ tone: "muted" })
  })

  it("takes the compare-and-swap on the revision the proposal was computed against", async () => {
    await runTurn({ action: "apply_polish", revision: 4, ops: OPS })

    expect(mock(appendTurn).mock.calls[0][0]).toMatchObject({ expectedRevision: 4 })
  })

  it("discards the polish when the owner edited while it waited", async () => {
    // The proposal sat on screen; the page moved underneath it. The ops were
    // computed against a document that no longer exists, so they are thrown
    // away rather than applied to one they were never meant for.
    //
    // MUTANT: dropping the revision check. The ops would apply to a document
    // the reviewer never read, silently reverting the owner's own edit.
    const res = await runTurn({ action: "apply_polish", revision: 3, ops: OPS })

    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ code: "stale_revision", currentRevision: 4 })
    expect(appendTurn).not.toHaveBeenCalled()
  })

  it("refuses ops the document will not take, rather than writing a half-applied page", async () => {
    // `applyOps` is transactional. MUTANT: ignoring `applied.ok` and storing
    // `applied.doc` anyway.
    const res = await runTurn({
      action: "apply_polish",
      revision: 4,
      ops: [{ op: "update_section", id: "no-such-section", style: { tone: "muted" } }],
    })

    expect(res.status).toBe(422)
    expect(await res.json()).toMatchObject({ code: "ops_rejected" })
    expect(appendTurn).not.toHaveBeenCalled()
  })

  it("rejects an empty batch at the validator", async () => {
    // An empty batch is not a polish. Letting it through would write a turn
    // announcing changes that did not happen.
    const res = await runTurn({ action: "apply_polish", revision: 4, ops: [] })

    expect(res.status).toBe(400)
    expect(appendTurn).not.toHaveBeenCalled()
  })

  it("rejects an op that is not in the schema", async () => {
    // The body is whatever the client sent, not what the server sent it.
    const res = await runTurn({
      action: "apply_polish",
      revision: 4,
      ops: [{ op: "drop_database", id: "hero" }],
    })

    expect(res.status).toBe(400)
    expect(appendTurn).not.toHaveBeenCalled()
  })

  it("answers as plain JSON, not as a stream", async () => {
    // There is no model call to narrate, so opening an SSE stream to say one
    // thing would be pure ceremony — and the client branches on the content
    // type to decide how to read the response.
    const res = await runTurn({ action: "apply_polish", revision: 4, ops: OPS })

    expect(res.headers.get("content-type")).toContain("application/json")
    expect(await res.json()).toMatchObject({ source: "review", revision: 5 })
  })
})
