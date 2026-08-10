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
  callAgent: vi.fn(),
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
// The three catalogue reads, so the REAL `loadCatalogues` runs over them.
vi.mock("@/lib/db/programs", () => ({ getPrograms: vi.fn(), getAllPrograms: vi.fn() }))
vi.mock("@/lib/db/session-pack-products", () => ({ listActiveProducts: vi.fn(), listAllProducts: vi.fn() }))
vi.mock("@/lib/db/events", () => ({ getEvents: vi.fn(), getPublishedEvents: vi.fn() }))

import { POST } from "@/app/api/admin/funnels/steps/[stepId]/build/route"
import { auth } from "@/lib/auth"
import { canAccessAdminPath } from "@/lib/permissions/guard"
import { callAgent } from "@/lib/ai/anthropic"
import { createGenerationLog, updateGenerationLog } from "@/lib/db/ai-generation-log"
import { appendTurn, getDraft, listTurns, revertToRevision } from "@/lib/db/funnel-builder"
import { getFunnelById, getStep, listSteps } from "@/lib/db/funnels"
import { getFaqCountsByPage } from "@/lib/db/faqs"
import { getAllPrograms, getPrograms } from "@/lib/db/programs"
import { listActiveProducts, listAllProducts } from "@/lib/db/session-pack-products"
import { getEvents, getPublishedEvents } from "@/lib/db/events"
import { SECTION_BUILDER_RATE_LIMIT_MAX } from "@/lib/funnels/sections/builder-config"
import type { SectionDoc } from "@/lib/funnels/sections/registry"

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

function agentResult(content: unknown) {
  return { content, tokens_used: 1200, cache_creation_tokens: 3400, cache_read_tokens: 0 }
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
  mock(callAgent).mockReset()
  mock(callAgent).mockResolvedValue(
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
    const res = await POST(req({ message: "hi", revision: 4 }), ctx)
    expect(res.status).toBe(403)
    expect(getDraft).not.toHaveBeenCalled()
    expect(callAgent).not.toHaveBeenCalled()
  })

  it("403s an anonymous request", async () => {
    // MUTANT: `session?.user?.id` dropped from the condition — this route is
    // not covered by middleware's /admin/* matcher (that matches PAGES), so
    // the handler's own check is the only gate.
    mock(auth).mockResolvedValue(null)
    const res = await POST(req({ message: "hi", revision: 4 }), ctx)
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
    expect(callAgent).not.toHaveBeenCalled()
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
    const res = await POST(req({ message: "one too many", revision: 4 }), ctx)
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
    const res = await POST(req({ message: "hi", revision: 4 }), ctx)
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.code).toBe("stale_revision")
    expect(body.currentRevision).toBe(9)
    expect(callAgent).not.toHaveBeenCalled()
    expect(appendTurn).not.toHaveBeenCalled()
  })

  it("409s when appendTurn's compare-and-swap loses the race, even though the read agreed", async () => {
    // MUTANT: treating `appendTurn`'s result as fire-and-forget. The read-side
    // check above cannot see a writer that arrives DURING the model call; only
    // the CAS result can, and ignoring it drops the turn on the floor with a
    // 200 and a doc the DB never stored.
    mock(appendTurn).mockResolvedValue({ ok: false, reason: "stale_revision", currentRevision: 11 })
    const res = await POST(req({ message: "hi", revision: 4 }), ctx)
    expect(res.status).toBe(409)
    const body = await res.json()
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

    const res = await POST(req({ message: "make the headline bigger", revision: 7 }), ctx)
    expect(res.status).toBe(422)
    const body = await res.json()
    expect(body.code).toBe("doc_invalid")
    expect(body.resetToRevision).toBe(5)
    expect(body.currentRevision).toBe(7)
    // The two claims that make this a refusal rather than a message.
    expect(callAgent).not.toHaveBeenCalled()
    expect(appendTurn).not.toHaveBeenCalled()
  })

  it("says so honestly when no earlier revision is restorable", async () => {
    // MUTANT: defaulting `resetToRevision` to the current revision, or to 1 —
    // the client would then offer a reset button that always fails.
    mock(getDraft).mockResolvedValue({ doc: null, docInvalid: true, revision: 3 })
    mock(listTurns).mockResolvedValue([{ revision: 1, doc: null }, { revision: 2, doc: { not: "a doc" } }])
    const body = await (await POST(req({ message: "hi", revision: 3 }), ctx)).json()
    expect(body.resetToRevision).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// (a) The retry — the whole point of this test file
// ---------------------------------------------------------------------------

describe("POST .../build — the one-shot retry", () => {
  it("retries an applyOps SEMANTIC error, not just a Zod error, and feeds the model the actual error", async () => {
    // MUTANT: `catch (parse error) { retry }` only — i.e. retrying when
    // `callAgent` throws and giving up when `applyOps` returns
    // `{ok:false, errors}`. That mutant passes every "the retry works" test
    // written around a thrown error, and turns "no section with id x" — the
    // single most likely thing a model gets wrong — into a user-visible dead
    // end on a request that cost a full Opus call.
    //
    // Note what the first response is: `buildResultSchema` ACCEPTS it and
    // `opSchema` accepts every op in it. Nothing throws. The only signal is
    // `applyOps`'s return value.
    mock(callAgent)
      .mockResolvedValueOnce(
        agentResult({
          reply: "Updated the section.",
          blocked: false,
          ops: [{ op: "update_section", id: "does-not-exist", props: { headline: "x" } }],
        }),
      )
      .mockResolvedValueOnce(
        agentResult({
          reply: "Rewrote the hero headline.",
          blocked: false,
          ops: [{ op: "update_section", id: "hero", props: { headline: "Second time lucky" } }],
        }),
      )

    const res = await POST(req({ message: "change the headline", revision: 4 }), ctx)
    expect(res.status).toBe(200)
    expect(callAgent).toHaveBeenCalledTimes(2)

    // The correction has to reach the MODEL, verbatim. A retry that resends the
    // identical prompt is a retry in name only — the model has no new
    // information and will make the same mistake.
    const secondUserMessage = mock(callAgent).mock.calls[1][1] as string
    expect(secondUserMessage).toContain('no section with id "does-not-exist"')
    expect(secondUserMessage).not.toBe(mock(callAgent).mock.calls[0][1])

    const body = await res.json()
    expect(body.doc.sections[0].props.headline).toBe("Second time lucky")
    expect(body.reply).toBe("Rewrote the hero headline.")
  })

  it("retries a thrown parse/refusal the same way", async () => {
    // MUTANT: no retry at all. `stop_reason: "refusal"` and a truncated
    // response both surface through `generateObject` as a throw.
    mock(callAgent)
      .mockRejectedValueOnce(new Error("response did not match schema"))
      .mockResolvedValueOnce(
        agentResult({
          reply: "Done.",
          blocked: false,
          ops: [{ op: "update_section", id: "hero", props: { headline: "Recovered" } }],
        }),
      )
    const body = await (await POST(req({ message: "hi", revision: 4 }), ctx)).json()
    expect(callAgent).toHaveBeenCalledTimes(2)
    expect(body.doc.sections[0].props.headline).toBe("Recovered")
  })

  it("retries exactly ONCE, then answers honestly with the draft intact — never a 500", async () => {
    // MUTANT 1: letting the throw escape, i.e. a 500 on a model refusal.
    // MUTANT 2: an unbounded retry loop, which on a systematically-rejected
    // batch burns the whole 300s budget and N Opus calls.
    // MUTANT 3: writing a document anyway — the draft must be untouched.
    mock(callAgent).mockRejectedValue(new Error("no object generated: could not parse"))

    const res = await POST(req({ message: "hi", revision: 4 }), ctx)
    expect(res.status).toBe(200)
    expect(callAgent).toHaveBeenCalledTimes(2)

    const body = await res.json()
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

    const res = await POST(req({ message: "hi", revision: 4 }), ctx)
    expect(res.status).toBe(200)

    const body = await res.json()
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
    await POST(req({ message: "hi", revision: 4 }), ctx)
    const system = mock(callAgent).mock.calls[0][0] as string
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
    const res = await POST(req({ message: "hi", revision: 4 }), ctx)
    expect(res.status).toBe(200)

    const stored = mock(appendTurn).mock.calls.map((c) => c[0]).find((i) => i.doc)
    expect(stored).toBeDefined()
    expect(stored.doc.sections[0].props.primaryCta.target.ref).toBe(PROGRAM_ID)

    const body = await res.json()
    expect(body.doc.sections[0].props.primaryCta.target.ref).toBe(PROGRAM_ID)
    expect(body.unresolved).toEqual([])
    expect(body.resolutionError).toBeNull()
  })

  it("compiles clean with NO warnings — dropped attributes are silent otherwise", async () => {
    // MUTANT: any renderer/compiler drift that makes `filterAttrs` drop an
    // attribute. `ok === true` alone cannot see it: a bad href or src is
    // removed silently and the page compiles green with a dead button. Only an
    // EMPTY `warnings` proves the round trip lost nothing.
    const body = await (await POST(req({ message: "hi", revision: 4 }), ctx)).json()
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
    const body = await (await POST(req({ message: "hi", revision: 4 }), ctx)).json()
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
    mock(callAgent).mockResolvedValue(
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
    const body = await (await POST(req({ message: "hi", revision: 4 }), ctx)).json()
    expect(body.danglingAnchors).toEqual([
      { sectionId: "hero", field: "primaryCta", target: "pricing" },
    ])
    // Reported, NOT blocking: the compile is still clean and the doc is saved.
    expect(body.compile.ok).toBe(true)
    expect(body.compile.warnings).toEqual([])
  })

  it("saves a page that does not compile — a draft is not a publish", async () => {
    // MUTANT: refusing to persist unless the page compiles. The owner would be
    // unable to iterate towards a page that DOES compile, because every turn
    // would be discarded. Publishing is the gate; drafting is not.
    mock(callAgent).mockResolvedValue(
      agentResult({
        reply: "Added a hero image.",
        blocked: false,
        ops: [
          {
            op: "update_section",
            id: "hero",
            // `heroMediaSchema.src` has no URL shape constraint, so this passes
            // Zod and then fails render.ts's `safeUrl` re-check.
            props: { media: { kind: "image", src: "javascript:alert(1)", alt: "x", w: 10, h: 10 } },
          },
        ],
      }),
    )
    const res = await POST(req({ message: "hi", revision: 4 }), ctx)
    expect(res.status).toBe(200)
    const stored = mock(appendTurn).mock.calls.map((c) => c[0]).find((i) => i.doc)
    expect(stored).toBeDefined()
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
    mock(callAgent).mockImplementation(async () => {
      order.push("callAgent")
      return agentResult({ reply: "ok", blocked: false, ops: [] })
    })

    await POST(req({ message: "make it shorter", revision: 4 }), ctx)
    expect(order).toEqual(["append:user", "callAgent", "append:assistant"])

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
    await POST(req({ message: "hi", revision: 4 }), ctx)
    const insert = mock(createGenerationLog).mock.calls[0][0]
    expect(insert.input_params.feature).toBe("funnel_page_build")
    expect(Object.keys(insert)).not.toContain("generation_trigger")
    expect(Object.keys(insert)).not.toContain("assessment_result_id")
    expect(updateGenerationLog).toHaveBeenCalledWith("log-1", expect.objectContaining({ status: "completed" }))
  })

  it("bills the retried turn for BOTH calls", async () => {
    // MUTANT: `tokensUsed = result.tokens_used` instead of `+=`, which reports
    // only the winning attempt and understates every retried turn.
    mock(callAgent)
      .mockResolvedValueOnce(
        agentResult({ reply: "x", blocked: false, ops: [{ op: "update_section", id: "nope", props: { a: 1 } }] }),
      )
      .mockResolvedValueOnce(
        agentResult({ reply: "y", blocked: false, ops: [{ op: "update_section", id: "hero", props: { sub: "s" } }] }),
      )
    await POST(req({ message: "hi", revision: 4 }), ctx)
    expect(updateGenerationLog).toHaveBeenCalledWith("log-1", expect.objectContaining({ tokens_used: 2400 }))
  })

  it("still answers when the spend log cannot be opened", async () => {
    // MUTANT: awaiting `createGenerationLog` unguarded. A ledger outage would
    // then 500 an owner's page edit.
    mock(createGenerationLog).mockRejectedValue(new Error("PGRST204"))
    const res = await POST(req({ message: "hi", revision: 4 }), ctx)
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
    mock(callAgent).mockResolvedValue(
      agentResult({
        reply: "There is no session pack by that name, so I have not changed anything.",
        blocked: true,
        ops: [{ op: "remove_section", id: "hero" }],
      }),
    )
    const res = await POST(req({ message: "sell the gold pack", revision: 4 }), ctx)
    expect(res.status).toBe(200)

    const body = await res.json()
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
    mock(callAgent)
      .mockResolvedValueOnce(
        agentResult({
          reply: "Added a hero.",
          blocked: false,
          ops: [{ op: "add_section", after: null, section: fullPageSections()[0] }],
        }),
      )
      .mockResolvedValueOnce(
        agentResult({ reply: "Built the page.", blocked: false, ops: [{ op: "set_page", sections: fullPageSections() }] }),
      )

    const res = await POST(req({ message: "build me a camp page", revision: 0 }), ctx)
    expect(res.status).toBe(200)
    expect(callAgent).toHaveBeenCalledTimes(2)

    const body = await res.json()
    expect(body.doc.sections.map((s: { id: string }) => s.id)).toEqual(["hero"])
    expect(body.doc.sections.some((s: { id: string }) => s.id === "draft-placeholder")).toBe(false)

    // And the correction reached the model rather than being swallowed.
    expect(mock(callAgent).mock.calls[1][1]).toContain("set_page")
  })

  it("tells the model there is no page yet rather than showing it a seed", async () => {
    // MUTANT: passing the seed document into Block C. The model would then
    // treat "New page" as the owner's existing content and edit around it.
    mock(getDraft).mockResolvedValue({ doc: null, docInvalid: false, revision: 0 })
    mock(callAgent).mockResolvedValue(
      agentResult({ reply: "Built it.", blocked: false, ops: [{ op: "set_page", sections: fullPageSections() }] }),
    )
    await POST(req({ message: "build me a page", revision: 0 }), ctx)
    const userMessage = mock(callAgent).mock.calls[0][1] as string
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
    const res = await POST(req({ action: "reset", toRevision: 5 }), ctx)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.source).toBe("revert")
    expect(body.revision).toBe(8)
    expect(body.doc.sections[0].props.headline).toBe("restored headline")
    expect(body.compile.ok).toBe(true)
    expect(revertToRevision).toHaveBeenCalledWith(expect.objectContaining({ stepId: STEP_ID, toRevision: 5 }))
    expect(callAgent).not.toHaveBeenCalled()
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
    const body = await (await POST(req({ action: "reset", toRevision: 5 }), ctx)).json()
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
    expect((await stale.json()).currentRevision).toBe(12)

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
    await POST(req({ message: "hi", revision: 4 }), ctx)
    const [system, , , options] = mock(callAgent).mock.calls[0]
    expect(system).toContain(PROGRAM_NAME)
    expect(system).not.toContain(PROGRAM_ID)
    expect(options.cacheSystemPrompt).toBe(true)
    // `callAgent`'s default of 32000 must be overridden — `generateObject` is
    // non-streaming, so a huge budget invites SDK HTTP timeouts.
    expect(options.maxTokens).toBeLessThanOrEqual(16_000)
  })

  it("offers the funnel's OTHER steps, never this one", async () => {
    // MUTANT: passing every step. A CTA pointing at the page it is on is a
    // no-op link the owner cannot diagnose.
    await POST(req({ message: "hi", revision: 4 }), ctx)
    const system = mock(callAgent).mock.calls[0][0] as string
    expect(system).toContain('"thanks"')
    expect(system).not.toContain('"apply"')
  })
})
