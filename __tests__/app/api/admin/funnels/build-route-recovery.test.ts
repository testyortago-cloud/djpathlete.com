/**
 * @vitest-environment node
 */
// __tests__/app/api/admin/funnels/build-route-recovery.test.ts
//
// WHEN THE BUILD ROUTE MAY RESCUE A FAILED MODEL CALL, AND WHEN IT MUST NOT.
//
// `streamOneAttempt` recovers a DOUBLE-ENCODED answer (the whole object sent
// as a JSON string inside a one-key wrapper) instead of throwing it away — the
// 2026-09-08 incident `lib/ai/recover-object.ts` was written for. The
// whole-branch review of the OpenRouter move (2026-09-26) then reproduced the
// same recovery doing harm: an OpenRouter fault mid-stream rejected `.object`
// with a transport error, the route fell through to the LAST PARTIAL object,
// and that partial is a repaired PREFIX. `update_section` needs only `op` and
// `id`, so the prefix passed the schema — the headline cut off mid-word, the
// second requested change silently dropped, the reply claiming both were
// done, and the route's own retry never ran. A `finish_reason: "length"`
// truncation took the same path.
//
// So every test here drives one of two sides of one rule: recover only from a
// MODEL-OUTPUT failure of a stream that FINISHED NORMALLY.
//
// Two kinds of fake, on purpose:
//   - the OpenRouter cases run the REAL `streamObjectViaOpenRouter` over a
//     faked client, so the rejection the route sees is whatever that module
//     actually produces for a mid-stream SDK error or a truncation — never a
//     hand-built stand-in for it;
//   - the Anthropic-fallback cases (the AI SDK's `streamObject`) hand the route
//     the REAL error classes that path rejects with: `NoObjectGeneratedError`
//     from "ai", a genuine `ZodError`, `Anthropic.APIUserAbortError`. The SDK
//     classes never set `.name` (it is plain "Error"), which is how an earlier
//     round's tests passed against errors no SDK produces.
//
// Follows the mocking idiom of `build-route.test.ts` — read there for the full
// rationale of each `vi.mock` below. This file adds one: `getOpenRouterClient`.

import { beforeEach, describe, expect, it, vi } from "vitest"
import OpenAI from "openai"
import Anthropic from "@anthropic-ai/sdk"
import { NoObjectGeneratedError, parsePartialJson } from "ai"

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/permissions/guard", () => ({ canAccessAdminPath: vi.fn() }))
vi.mock("@/lib/audit/record", () => ({ recordAudit: vi.fn() }))
vi.mock("@/lib/ai/anthropic", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai/anthropic")>()),
  streamAgent: vi.fn(),
}))
// THE WIRE. Only the client is faked; everything that turns chunks into parts
// and a rejection is the real module.
const createMock = vi.fn()
vi.mock("@/lib/ai/openrouter", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai/openrouter")>()),
  getOpenRouterClient: () => ({ chat: { completions: { create: createMock } } }),
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
vi.mock("@/lib/funnels/sections/review/pipeline", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/funnels/sections/review/pipeline")>()),
  reviewDoc: vi.fn(),
}))
vi.mock("@/lib/funnels/render-image", () => ({ renderDocToImages: vi.fn() }))
vi.mock("@/lib/db/programs", () => ({ getPrograms: vi.fn(), getAllPrograms: vi.fn() }))
vi.mock("@/lib/db/session-pack-products", () => ({ listActiveProducts: vi.fn(), listAllProducts: vi.fn() }))
vi.mock("@/lib/db/events", () => ({ getEvents: vi.fn(), getPublishedEvents: vi.fn() }))

import { POST } from "@/app/api/admin/funnels/steps/[stepId]/build/route"
import { auth } from "@/lib/auth"
import { canAccessAdminPath } from "@/lib/permissions/guard"
import { streamAgent } from "@/lib/ai/anthropic"
import { streamObjectViaOpenRouter } from "@/lib/ai/openrouter-object-stream"
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
import { buildResultSchema } from "@/lib/funnels/sections/prompt"
import type { SectionDoc } from "@/lib/funnels/sections/registry"
import { createBuildStreamDecoder, type BuildStreamEvent } from "@/lib/funnels/sections/build-stream"

const mock = (fn: unknown) => fn as ReturnType<typeof vi.fn>

const STEP_ID = "3f1b7c5e-1111-4222-8333-444444444444"
const PROGRAM_ID = "11111111-2222-4333-8444-555555555555"
const PROGRAM_NAME = "Comeback Code"
const STEP = { id: STEP_ID, funnel_id: "ffffffff-1111-4222-8333-444444444444", slug: "apply", name: "Apply" }
const FUNNEL = { id: STEP.funnel_id, slug: "summer-camp", name: "Summer camp", status: "draft" }
const BUSINESS_ID = "bbbbbbbb-1111-4222-8333-444444444444"

const ORIGINAL_HEADLINE = "Rotational power in eight weeks"
const BUILD_FAILED_REPLY = "I couldn't build that — try describing it differently."

function doc(): SectionDoc {
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
          headline: ORIGINAL_HEADLINE,
          sub: "Eight weeks of programming built from your numbers.",
          primaryCta: { label: "Start", target: { kind: "program", ref: PROGRAM_NAME } },
        },
      },
    ],
  }
}

// ---------------------------------------------------------------------------
// What the model sends.
// ---------------------------------------------------------------------------

/**
 * The reproduced failure's payload, as far as it got: the reply already
 * claims TWO changes, the first op's headline is cut off mid-word, and the
 * second op (the FAQ) never arrived.
 */
const CUT_OFF_FRAGMENTS = [
  '{"reply":"Rewrote the hero headline and added an FAQ section.",',
  '"blocked":false,"ops":[{"op":"update_section","id":"hero",',
  '"props":{"headline":"Eight weeks to a stron',
]
const CUT_OFF_HEADLINE = "Eight weeks to a stron"

const WHOLE_ANSWER = {
  reply: "Rewrote the hero headline.",
  blocked: false,
  ops: [{ op: "update_section", id: "hero", props: { headline: "Eight weeks to a stronger swing" } }],
}

/** The 2026-09-08 shape: the complete answer as a JSON STRING in a one-key wrapper. */
const DOUBLE_ENCODED_ANSWER = {
  reply: "Rewrote the hero headline.",
  blocked: false,
  ops: [{ op: "update_section", id: "hero", props: { headline: "Recovered from the wrapper" } }],
}
const DOUBLE_ENCODED_WRAPPER = { params: JSON.stringify(DOUBLE_ENCODED_ANSWER) }

// ---------------------------------------------------------------------------
// The OpenRouter wire, in the shape `streamObjectViaOpenRouter` reads.
// ---------------------------------------------------------------------------

function chunk(delta: Record<string, unknown>, finishReason: string | null = null) {
  return { id: "gen-1", model: "anthropic/claude-opus-5", choices: [{ index: 0, delta, finish_reason: finishReason }] }
}

const USAGE_CHUNK = {
  id: "gen-1",
  model: "anthropic/claude-opus-5",
  choices: [],
  usage: { prompt_tokens: 1500, completion_tokens: 300 },
}

function toolCallStart() {
  return chunk({
    role: "assistant",
    tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: "structured_output", arguments: "" } }],
  })
}

function argumentChunks(fragments: string[]) {
  return fragments.map((fragment) => chunk({ tool_calls: [{ index: 0, function: { arguments: fragment } }] }))
}

/** A response the provider finished, with the given OpenAI-wire finish reason. */
function finishedWire(fragments: string[], finishReason: string) {
  return [toolCallStart(), ...argumentChunks(fragments), chunk({}, finishReason), USAGE_CHUNK]
}

function wire(chunks: unknown[], failWith?: unknown) {
  return (async function* () {
    for (const c of chunks) yield c
    if (failWith !== undefined) throw failWith
  })()
}

/**
 * The openai SDK's own mid-stream fault: it checks each SSE payload for
 * `error` and throws `new APIError(undefined, data.error)` — status undefined,
 * OpenRouter's number only in `.code` (node_modules/openai/core/streaming.js).
 */
function midStreamFault() {
  return new OpenAI.APIError(undefined, { code: 502, message: "Provider returned error" }, undefined, undefined)
}

/** Every way the OpenRouter stream can stop short, each as the wire delivers it. */
const STOPPED_SHORT: Array<[string, () => unknown]> = [
  [
    "an OpenRouter 502 mid-stream (the SDK's own APIError)",
    () => wire([toolCallStart(), ...argumentChunks(CUT_OFF_FRAGMENTS)], midStreamFault()),
  ],
  [
    "the socket dropping mid-stream (undici's TypeError)",
    () => wire([toolCallStart(), ...argumentChunks(CUT_OFF_FRAGMENTS)], new TypeError("terminated")),
  ],
  ['a finish_reason "length" truncation', () => wire(finishedWire(CUT_OFF_FRAGMENTS, "length"))],
  [
    "a body that closed with no finish_reason at all",
    () => wire([toolCallStart(), ...argumentChunks(CUT_OFF_FRAGMENTS)]),
  ],
]

/** Route every `streamAgent` call through the REAL OpenRouter object stream. */
function useRealOpenRouterStream() {
  mock(streamAgent).mockImplementation(
    (systemPrompt: string, userMessage: string, schema: never, options: { model: string; maxTokens: number }) =>
      streamObjectViaOpenRouter({
        modelId: options.model,
        systemPrompt,
        userMessage,
        schema,
        maxTokens: options.maxTokens,
      }),
  )
}

/** The user turn the route sent on its Nth OpenRouter call — the retry prompt lives here. */
function sentUserMessage(call: number): string {
  const body = createMock.mock.calls[call][0] as { messages: { role: string; content: unknown }[] }
  return String(body.messages.find((m) => m.role === "user")?.content)
}

// ---------------------------------------------------------------------------
// A stream handle, for the AI SDK (Anthropic-fallback) path.
// ---------------------------------------------------------------------------

const USAGE = { inputTokens: 200, outputTokens: 1000, inputTokenDetails: { cacheWriteTokens: 0, cacheReadTokens: 0 } }

function handle(opts: { partials: unknown[]; finishReason?: string | null; rejectWith: unknown }) {
  const object = Promise.reject(opts.rejectWith)
  object.catch(() => {})
  return {
    object,
    fullStream: (async function* () {
      for (const partial of opts.partials) {
        yield { type: "text-delta", textDelta: "x" }
        yield { type: "object", object: partial }
      }
      if (opts.finishReason !== null) {
        yield { type: "finish", finishReason: opts.finishReason ?? "stop", usage: USAGE }
      }
    })(),
  }
}

function succeeding(content: unknown) {
  return {
    object: Promise.resolve(content),
    fullStream: (async function* () {
      yield { type: "object", object: content }
      yield { type: "finish", finishReason: "stop", usage: USAGE }
    })(),
  }
}

// ---------------------------------------------------------------------------
// Reading the turn back.
// ---------------------------------------------------------------------------

async function turnEvents(): Promise<BuildStreamEvent[]> {
  const res = await POST(
    new Request(`http://x/api/admin/funnels/steps/${STEP_ID}/build`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "Sharpen the headline and add an FAQ", revision: 4 }),
    }) as never,
    { params: Promise.resolve({ stepId: STEP_ID }) } as never,
  )
  expect(res.headers.get("content-type")).toContain("text/event-stream")
  return createBuildStreamDecoder()(await res.text())
}

function resultTurn(events: BuildStreamEvent[]) {
  const result = events.find((event) => event.type === "result")
  if (!result || result.type !== "result") throw new Error(`no result event: ${JSON.stringify(events)}`)
  return result.turn as { reply: string; doc: SectionDoc }
}

function assistantWrites() {
  return mock(appendTurn)
    .mock.calls.map((call) => call[1] as { role: string; status?: string; doc?: SectionDoc; message: string })
    .filter((input) => input.role === "assistant")
}

function heroHeadline(d: SectionDoc | undefined | null): unknown {
  return (d?.sections[0]?.props as { headline?: unknown } | undefined)?.headline
}

let userSeed = 0
beforeEach(() => {
  vi.clearAllMocks()
  createMock.mockReset()
  userSeed += 1
  mock(auth).mockResolvedValue({
    user: { id: `aaaaaaaa-1111-4222-8333-${String(userSeed).padStart(12, "0")}`, role: "admin" },
  })
  mock(canAccessAdminPath).mockResolvedValue(true)
  mock(getDraft).mockResolvedValue({ doc: doc(), docInvalid: false, revision: 4 })
  mock(getStep).mockResolvedValue(STEP)
  mock(getFunnelById).mockResolvedValue(FUNNEL)
  mock(listSteps).mockResolvedValue([STEP, { ...STEP, id: "other", slug: "thanks" }])
  mock(getFaqCountsByPage).mockResolvedValue({})
  mock(listTurns).mockResolvedValue([])
  mock(resolveAdminTenantForRequest).mockResolvedValue({
    businessId: BUSINESS_ID,
    choices: [{ id: BUSINESS_ID, name: "DJP Athlete", slug: "djp-athlete" }],
    isOperator: true,
  })
  mock(getBusinessSettings).mockResolvedValue({ business_id: BUSINESS_ID, brand_color: null, accent_color: null })
  mock(getAllPrograms).mockResolvedValue([{ id: PROGRAM_ID, name: PROGRAM_NAME }])
  mock(getPrograms).mockResolvedValue([{ id: PROGRAM_ID, name: PROGRAM_NAME }])
  mock(listAllProducts).mockResolvedValue([])
  mock(listActiveProducts).mockResolvedValue([])
  mock(getEvents).mockResolvedValue([])
  mock(getPublishedEvents).mockResolvedValue([])
  mock(createGenerationLog).mockResolvedValue({ id: "log-1" })
  mock(updateGenerationLog).mockResolvedValue({})
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
  let next = 4
  mock(appendTurn).mockImplementation(async (_businessId: string, input: { expectedRevision: number }) => {
    next = input.expectedRevision + 1
    return { ok: true, turn: { revision: next, doc: null, message: "" }, revision: next }
  })
  mock(streamAgent).mockReset()
})

describe("the premise", () => {
  it("the cut-off prefix, repaired, PASSES buildResultSchema — which is why recovering from it is dangerous", async () => {
    // If this ever stops holding, the tests below stop proving anything: a
    // prefix the schema rejects could never have been applied in the first place.
    const { value } = await parsePartialJson(CUT_OFF_FRAGMENTS.join(""))
    const parsed = buildResultSchema.safeParse(value)
    expect(parsed.success).toBe(true)
    expect(parsed.data?.ops[0]).toMatchObject({
      op: "update_section",
      id: "hero",
      props: { headline: CUT_OFF_HEADLINE },
    })
  })
})

describe("a stream that stopped short is never applied — the route retries instead", () => {
  it.each(STOPPED_SHORT)(
    "%s: both attempts fail honestly, and the half-written edit never lands",
    async (_label, stoppedShort) => {
      // MUTANT: `recoverObjectFromError(e) ?? recoverObjectFromValue(lastPartial)`
      // for every rejection, i.e. the code the review reproduced. Attempt one
      // then "succeeds" with the cut-off headline and ONE call is made.
      useRealOpenRouterStream()
      createMock.mockImplementation(async () => stoppedShort())

      const events = await turnEvents()

      expect(createMock).toHaveBeenCalledTimes(2)
      const turn = resultTurn(events)
      expect(turn.reply).toBe(BUILD_FAILED_REPLY)
      expect(heroHeadline(turn.doc)).toBe(ORIGINAL_HEADLINE)

      const writes = assistantWrites()
      expect(writes).toHaveLength(1)
      expect(writes[0].status).toBe("failed")
      expect(writes[0].doc).toBeUndefined()
      // The live section events DID show the cut-off text while it was being
      // written — that is progress reporting — but the turn that ends the
      // stream must not carry it anywhere.
      expect(JSON.stringify(turn)).not.toContain(CUT_OFF_HEADLINE)
    },
  )

  it("retries a mid-stream 502, tells the model what happened, and applies the WHOLE second answer", async () => {
    // MUTANT: rethrowing without the retry prompt learning why. The retry must
    // run through `describeModelError`, whose first line is the error's own
    // message — the lifted OpenRouter fault, not "did not match schema".
    useRealOpenRouterStream()
    createMock
      .mockImplementationOnce(async () =>
        wire([toolCallStart(), ...argumentChunks(CUT_OFF_FRAGMENTS)], midStreamFault()),
      )
      .mockImplementationOnce(async () => wire(finishedWire([JSON.stringify(WHOLE_ANSWER)], "tool_calls")))

    const events = await turnEvents()

    expect(createMock).toHaveBeenCalledTimes(2)
    expect(events.some((event) => event.type === "restart")).toBe(true)
    expect(sentUserMessage(1)).toContain("Provider returned error")
    const turn = resultTurn(events)
    expect(turn.reply).toBe(WHOLE_ANSWER.reply)
    expect(heroHeadline(turn.doc)).toBe("Eight weeks to a stronger swing")
  })

  it('does not recover from a finish_reason "length" rejection even when its partial would validate', async () => {
    useRealOpenRouterStream()
    createMock
      .mockImplementationOnce(async () => wire(finishedWire(CUT_OFF_FRAGMENTS, "length")))
      .mockImplementationOnce(async () => wire(finishedWire([JSON.stringify(WHOLE_ANSWER)], "tool_calls")))

    const events = await turnEvents()

    expect(createMock).toHaveBeenCalledTimes(2)
    expect(sentUserMessage(1)).toMatch(/truncated/)
    expect(heroHeadline(resultTurn(events).doc)).toBe("Eight weeks to a stronger swing")
  })
})

describe("a double-encoded answer is still rescued — the reason recovery exists", () => {
  it.each([["tool_calls"], ["stop"]])(
    "recovers a complete wrapped answer from OpenRouter (finish_reason %s) on the FIRST attempt",
    async (finishReason) => {
      // MUTANT: rethrowing every rejection. The 2026-09-08 failure comes back:
      // a complete answer shown to the owner as "I couldn't build that", twice.
      useRealOpenRouterStream()
      const raw = JSON.stringify(DOUBLE_ENCODED_WRAPPER)
      createMock.mockImplementation(async () => wire(finishedWire([raw.slice(0, 40), raw.slice(40)], finishReason)))

      const events = await turnEvents()

      expect(createMock).toHaveBeenCalledTimes(1)
      const turn = resultTurn(events)
      expect(turn.reply).toBe(DOUBLE_ENCODED_ANSWER.reply)
      expect(heroHeadline(turn.doc)).toBe("Recovered from the wrapper")
    },
  )

  it("recovers from the AI SDK's NoObjectGeneratedError (Anthropic fallback, finishReason stop)", async () => {
    const text = JSON.stringify(DOUBLE_ENCODED_WRAPPER)
    const rejection = new NoObjectGeneratedError({
      message: "No object generated: response did not match schema.",
      text,
      response: { id: "msg_1", timestamp: new Date(), modelId: "claude-opus-5" },
      usage: USAGE as never,
      finishReason: "stop",
    })
    mock(streamAgent).mockImplementation(() =>
      handle({ partials: [DOUBLE_ENCODED_WRAPPER], finishReason: "stop", rejectWith: rejection }),
    )

    const events = await turnEvents()

    expect(streamAgent).toHaveBeenCalledTimes(1)
    expect(heroHeadline(resultTurn(events).doc)).toBe("Recovered from the wrapper")
  })

  it("recovers a bare ZodError from a normally finished stream, out of its last partial", async () => {
    // The second source the route's comment describes: no `.text`, no
    // `.value`, only the last partial. The ZodError is a real one, from the
    // real schema, for the real wrapper.
    const zodError = buildResultSchema.safeParse(DOUBLE_ENCODED_WRAPPER).error
    expect(zodError?.name).toBe("ZodError")
    mock(streamAgent).mockImplementation(() =>
      handle({ partials: [{ params: "{" }, DOUBLE_ENCODED_WRAPPER], finishReason: "stop", rejectWith: zodError }),
    )

    const events = await turnEvents()

    expect(streamAgent).toHaveBeenCalledTimes(1)
    expect(heroHeadline(resultTurn(events).doc)).toBe("Recovered from the wrapper")
  })
})

describe("rejections that are not a finished model answer are rethrown, however good the partial looks", () => {
  // Each of these hands the route a last partial that WOULD validate — the
  // complete, unwrapped answer — so the only thing standing between it and the
  // page is the classification. Attempt two is a plainly different answer, so
  // the stored headline says which attempt won.
  const LAST_PARTIAL = {
    reply: "Rewrote the hero headline.",
    blocked: false,
    ops: [{ op: "update_section", id: "hero", props: { headline: "From the partial" } }],
  }
  const SECOND = {
    reply: "Second attempt.",
    blocked: false,
    ops: [{ op: "update_section", id: "hero", props: { headline: "From attempt two" } }],
  }

  const cases: Array<[string, () => ReturnType<typeof handle>]> = [
    [
      'a bare ZodError whose stream finished on "length"',
      () =>
        handle({
          partials: [LAST_PARTIAL],
          finishReason: "length",
          rejectWith: buildResultSchema.safeParse({}).error,
        }),
    ],
    [
      // "other" is what the OpenRouter stream reports when the body closed
      // before any finish_reason arrived, and what the AI SDK reports for a
      // reason it does not know. Neither is evidence the model finished, so
      // the allow-list refuses it where a length/error/content-filter
      // deny-list would wave it through.
      'a bare ZodError whose stream finished on "other"',
      () =>
        handle({
          partials: [LAST_PARTIAL],
          finishReason: "other",
          rejectWith: buildResultSchema.safeParse({}).error,
        }),
    ],
    [
      "a bare ZodError from a stream that never finished",
      () => handle({ partials: [LAST_PARTIAL], finishReason: null, rejectWith: buildResultSchema.safeParse({}).error }),
    ],
    [
      "an Anthropic.APIUserAbortError (the fallback's own abort class)",
      () => handle({ partials: [LAST_PARTIAL], finishReason: null, rejectWith: new Anthropic.APIUserAbortError() }),
    ],
    [
      "an OpenAI.APIConnectionError",
      () =>
        handle({
          partials: [LAST_PARTIAL],
          finishReason: null,
          rejectWith: new OpenAI.APIConnectionError({
            message: "Connection error.",
            cause: new TypeError("terminated"),
          }),
        }),
    ],
    // The next three carry a COMPLETE, recoverable wrapped answer in `.text`,
    // so the finish reason is the only thing refusing them — without that, a
    // gate that no test can turn red would be sitting in the route.
    ...(["length", "content-filter", "error"] as const).map(
      (finishReason): [string, () => ReturnType<typeof handle>] => [
        `a NoObjectGeneratedError with finishReason "${finishReason}", even though its text is a whole wrapped answer`,
        () =>
          handle({
            partials: [LAST_PARTIAL],
            finishReason,
            rejectWith: new NoObjectGeneratedError({
              message: "No object generated: response did not match schema.",
              text: JSON.stringify(DOUBLE_ENCODED_WRAPPER),
              response: { id: "msg_1", timestamp: new Date(), modelId: "claude-opus-5" },
              usage: USAGE as never,
              finishReason,
            }),
          }),
      ],
    ),
    [
      // Carries no finish reason of its own, and the stream sent no finish
      // part: nothing says the model finished, so its text is not trusted.
      "a NoObjectGeneratedError with no finish reason anywhere",
      () =>
        handle({
          partials: [LAST_PARTIAL],
          finishReason: null,
          rejectWith: new NoObjectGeneratedError({
            message: "No object generated.",
            text: JSON.stringify(DOUBLE_ENCODED_WRAPPER),
            response: { id: "msg_1", timestamp: new Date(), modelId: "claude-opus-5" },
            usage: USAGE as never,
            finishReason: undefined as never,
          }),
        }),
    ],
    [
      // A normally finished stream whose JSON broke mid-answer: its `.text`
      // cannot be parsed, so nothing complete survives, and the last partial is
      // the repaired prefix up to the break. A NoObjectGeneratedError is
      // recovered only from the complete text it carries.
      "a NoObjectGeneratedError whose text will not parse, even with a normal finish",
      () =>
        handle({
          partials: [LAST_PARTIAL],
          finishReason: "tool-calls",
          rejectWith: new NoObjectGeneratedError({
            message: "No object generated: could not parse the response.",
            text: '{"reply":"Rewrote the hero headline.","blocked":false,"ops":[{"op":"update_section","id":"hero","props":{"headline":"From the partial"}}, {"op":"add_section" "kind":"faq"}]}',
            response: { id: "msg_1", timestamp: new Date(), modelId: "claude-opus-5" },
            usage: USAGE as never,
            finishReason: "tool-calls",
          }),
        }),
    ],
  ]

  it.each(cases)("%s", async (_label, first) => {
    // MUTANT 1: recovering from the last partial whatever the rejection was —
    // the reproduced code. Every case here then stores "From the partial".
    // MUTANT 2: classifying by `error.name` against the SDK class names. Every
    // SDK class here reports `.name === "Error"`, so a deny-list keyed on
    // "APIUserAbortError" or "APIConnectionError" matches none of them.
    mock(streamAgent)
      .mockImplementationOnce(first)
      .mockImplementationOnce(() => succeeding(SECOND))

    const events = await turnEvents()

    expect(streamAgent).toHaveBeenCalledTimes(2)
    expect(heroHeadline(resultTurn(events).doc)).toBe("From attempt two")
  })
})
