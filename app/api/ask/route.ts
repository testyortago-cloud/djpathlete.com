// POST /api/ask — one turn of the public chat assistant.
//
// THE ORDER OF THIS FILE IS THE DESIGN. Every honesty property the feature
// claims is a property of when something happens relative to something else,
// so the sequence below is not a style choice and reordering it silently
// deletes a control:
//
//   1. THE FLAG, before anything is read or parsed. Off means 404 — never 403,
//      never a redirect. `middleware.ts` covers only `/admin/*` and
//      `/client/*`, so this route gates itself, and a public gate that fails
//      closed answers "there is nothing here".
//
//   2. THE BODY, through a schema that HAS NO FIELD FOR HISTORY. A browser
//      cannot be allowed to say what was said before it: a client that could
//      post its own transcript could invent a prior ASSISTANT turn — "you
//      already quoted me $5" — and have the model honour its own fabrication.
//
//   3. THE ORIGIN, as a SALTED hash and never an address. An unsalted sha256
//      of an IPv4 address reads as opaque and is not: there are 2^32 of them
//      and a laptop walks the whole space in seconds. A missing salt is
//      therefore a hard error, not a quiet downgrade — the downgrade is
//      invisible in every row it writes.
//
//   4. THE LIMITS, counted in the database. The in-memory pre-filter above
//      them sheds a flood that a single warm instance sees; it is NOT the
//      control, because a serverless instance is one of many and its Map dies
//      with it.
//
//   5. THE RISK CLASSIFIER, AND IT RETURNS FROM INSIDE THE GATE. An injury or
//      medical question is answered with a fixed refusal and the model is
//      never called — not called and then discarded, not called with a warning
//      appended. A model that is never asked cannot answer, and that is the
//      only version of this property that a prompt cannot be talked out of.
//
//   6. THE TURN, BUFFERED WHOLE, THEN VALIDATED, THEN RETURNED. You cannot
//      validate prose you have already put on somebody's screen. So the loop
//      does not stream, the complete text is checked against the values the
//      lookups actually returned, and only a clean turn is sent back. A turn
//      with a violation is replaced by a fixed refusal and persisted with what
//      it tried to say, so the block is visible in `/admin/chat` afterwards.
//
//   7. THE HANDOVER, LAST, AND ONLY FOR A TURN THAT PASSED. `escalate` records
//      an intent; this file is the only place that acts on it. A blocked turn
//      therefore emails nobody a transcript ending in a sentence the visitor
//      was never shown.
//
// NO BRAND NAMES IN THIS FILE, comments included — it is inside the Lead
// Engine's sweep. Business identity is read from `getBusinessSettings()`.
//
// Spec: docs/superpowers/specs/2026-08-23-lead-engine-stage3-chat-design.md
//       §2, §4, §7

import { createHash } from "crypto"
import { NextResponse } from "next/server"

import { runWithTools } from "@/lib/ai/tool-loop"
import { recordAudit } from "@/lib/audit/record"
import { getBusinessSettings, type BusinessSettings } from "@/lib/db/businesses"
import {
  appendMessage,
  countRecentConversationsByIp,
  countRecentMessagesByIp,
  createConversation,
  getConversation,
  listMessages,
} from "@/lib/db/chat"
import { getSetting } from "@/lib/db/system-settings"
import { parseAttrCookie } from "@/lib/marketing/cookies"
import { rateLimit } from "@/lib/shop/rate-limit"
import {
  CHAT_ASSISTANT_FLAG,
  CHAT_ASSISTANT_FLAG_DEFAULT,
  CHAT_MODEL,
  MAX_CONVERSATIONS_PER_IP_PER_HOUR,
  MAX_MESSAGES_PER_CONVERSATION,
  MAX_MESSAGES_PER_IP_PER_HOUR,
  MAX_OUTPUT_TOKENS,
  MAX_TOKENS_PER_CONVERSATION,
  MAX_TOOL_ROUNDS,
  REFUSAL_BLOCKED,
  REFUSAL_INJURY,
} from "@/lib/lead-engine/chat/constants"
import { runEscalation } from "@/lib/lead-engine/chat/escalate"
import { groundedValuesFor } from "@/lib/lead-engine/chat/facts"
import { buildSystemPrompt } from "@/lib/lead-engine/chat/prompt"
import { classifyRisk } from "@/lib/lead-engine/chat/risk"
import {
  CHAT_TOOLS,
  createToolExecutor,
  visitorSafeCards,
  type Card,
  type ToolOutcome,
} from "@/lib/lead-engine/chat/tools"
import { validateReply } from "@/lib/lead-engine/chat/validate"
import { askRequestSchema } from "@/lib/validators/chat"

// Type-only, so the closed audit taxonomy is checked at compile time: a slug
// that is not a row in `AUDIT_ACTIONS` stops the build rather than writing a
// row nothing can look up by name.
import type { AuditAction } from "@/lib/audit/actions"
import type { ChatConversation, ChatMessage } from "@/types/database"

const BLOCKED_AUDIT_ACTION: AuditAction = "chat.reply_blocked"

const HOUR_MS = 60 * 60 * 1000

/**
 * Every sentence a visitor can be shown by this route rather than by the
 * model. Fixed copy, written for the person asking the question: no field
 * names, no validator messages, no status codes read back as prose. A public
 * endpoint has no reason to describe its own schema to whoever is probing it.
 */
const COPY = {
  notFound: "Not found.",
  invalid: "I couldn't read that. Try sending it again in a sentence or two.",
  unknownConversation: "That conversation has expired. Start a new one and I'll pick it up from there.",
  tooManyMessages: "We've covered a lot in this conversation. Start a new one and I'll keep going.",
  tooFast: "That's a lot of questions at once. Give it a minute and try again.",
  failed: "Something went wrong at my end. Try that again in a moment.",
} as const

/**
 * Appended to a reply when the conversation was handed to a person but nobody
 * was actually emailed — no reply-to configured, or the send failed.
 *
 * The escalation itself is real: `escalated_at` is written and `/admin/chat`
 * lists it. What is NOT real in that case is a message sitting in somebody's
 * inbox, so this says what is true and promises nothing about when. Exported
 * so the test asserts the sentence rather than a paraphrase of it.
 *
 * It is fixed server copy carrying no numbers and no claims, which is why
 * appending it after validation is not a hole in the validator: nothing here
 * came from a model.
 */
export const ESCALATION_FLAGGED_NOTE =
  "I've flagged this conversation for a person to pick up. I can't say how quickly someone will get back to you."

/** The handover could not be recorded at all, so even the flag above would be a lie. */
export const ESCALATION_FAILED_NOTE =
  "I couldn't pass this on automatically. The contact page is the surest way to reach a person."

/**
 * What is persisted in place of a validator violation when a turn is discarded
 * for a reason the validator never saw.
 *
 * DELIBERATELY NOT A `Violation` from validate.ts. That union is the pure
 * validator's vocabulary, and widening it here would let a route-level verdict
 * masquerade as something the validator found. `violations` is `unknown[]` on
 * the row, and the admin transcript reads `rule` / `found` off whatever it
 * holds, so these render beside real violations without pretending to be them.
 */
const ROUND_LIMIT_NOTE = {
  rule: "stopped_on_round_limit",
  found: "the assistant ran out of lookup rounds before it could answer",
} as const

const EMPTY_REPLY_NOTE = {
  rule: "empty_reply",
  found: "the assistant returned no text at all",
} as const

/**
 * The one origin identifier this subsystem keeps.
 *
 * THE SALT IS NOT OPTIONAL AND ITS ABSENCE IS NOT A DEGRADED MODE. An
 * unsalted digest of an address is reversible by brute force — the entire IPv4
 * space is 4.3 billion strings — so falling back to one would write rows that
 * look privacy-preserving and are not, silently, forever. Throwing means the
 * endpoint is broken in an obvious way instead of leaking in a subtle one.
 */
function hashIp(ip: string): string {
  const salt = process.env.CHAT_IP_SALT
  if (!salt || salt.trim().length === 0) {
    throw new Error(
      "CHAT_IP_SALT is not set. The chat assistant will not hash a visitor's address without it — an unsalted hash of an IPv4 address is reversible by brute force.",
    )
  }
  return createHash("sha256").update(`${ip}${salt}`).digest("hex")
}

/**
 * The first hop only, as every other public route in this app reads it. The
 * hops after it are our own proxies, and taking the whole header would give
 * one visitor a different identity every time an edge region changed.
 *
 * A missing header collapses to one shared bucket. That is the safe direction
 * — those requests throttle each other rather than nobody — and in practice
 * the platform always sets it.
 */
function clientIp(request: Request): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown"
}

/**
 * The transcript as the MODEL is allowed to see it.
 *
 * A blocked turn is replayed as the refusal the visitor actually read, never
 * as the text it was blocked for. Without this the model's own invented price
 * comes back to it next turn as something it apparently said, and the second
 * turn quotes the first — laundering a fabrication into history through the
 * one path the validator cannot see, because by then nothing new is being
 * claimed.
 *
 * Empty rows are dropped: the API rejects a message with no content, and a
 * stored blank is a turn that never reached the visitor anyway.
 */
function toModelMessages(rows: ChatMessage[]): Array<{ role: "user" | "assistant"; content: string }> {
  const messages: Array<{ role: "user" | "assistant"; content: string }> = []
  for (const row of rows) {
    const content = row.role === "assistant" && row.verdict === "blocked" ? REFUSAL_BLOCKED : row.content
    if (!content || content.trim().length === 0) continue
    messages.push({ role: row.role, content })
  }
  return messages
}

/** Kept per message so a block can be explained months later without the lookups being re-run. */
function factSetFor(outcome: ToolOutcome, grounded: string[]): Record<string, unknown> {
  return { facts: outcome.facts, groundedValues: grounded }
}

/**
 * What the visitor is told about the handover, decided by what actually
 * happened rather than by the fact that it was asked for.
 *
 * `runEscalation` reports `sent` only when a message really left for a real
 * address. On anything else the conversation is still flagged and still shows
 * in `/admin/chat` — which is worth saying, and is all that is worth saying.
 * "Someone will be in touch" on the back of a send that could not happen is
 * the single lie this whole feature exists to make impossible.
 */
async function handOver(conversationId: string, summary: string | undefined, message: string): Promise<string | null> {
  const written = summary?.trim()
  try {
    const result = await runEscalation({
      conversationId,
      // `escalateSummary` is optional — the model can ask for a person without
      // writing a sentence — and `runEscalation` requires one. The fallback
      // carries the visitor's own words, which is the most useful thing the
      // operator could be handed anyway. `runEscalation` clamps the length.
      summary:
        written && written.length > 0 ? written : `The assistant handed this over. The visitor asked: ${message}`,
    })

    if (!result.ok) {
      // Already escalated: the flag is on the record and the visitor was told
      // last time. Saying it twice reads as a second, separate handover.
      return result.reason === "already_escalated" ? null : ESCALATION_FAILED_NOTE
    }
    return result.notice === "sent" ? null : ESCALATION_FLAGGED_NOTE
  } catch (err) {
    // `markEscalated` is allowed to fail loudly by design, and its caller
    // decides what that means. Here it means the visitor's ANSWER — which
    // passed the validator and is theirs — must not be lost because a handover
    // write failed. They are told the handover did not happen.
    const e = err as { message?: unknown } | null | undefined
    console.error(`[ask] handover failed for conversation ${conversationId}`, {
      message: typeof e?.message === "string" ? e.message : undefined,
    })
    return ESCALATION_FAILED_NOTE
  }
}

export async function POST(request: Request) {
  // ── 1. The flag ──────────────────────────────────────────────────────────
  const enabled = await getSetting<boolean>(CHAT_ASSISTANT_FLAG, CHAT_ASSISTANT_FLAG_DEFAULT)
  if (!enabled) return NextResponse.json({ error: COPY.notFound }, { status: 404 })

  // ── 2. The body ──────────────────────────────────────────────────────────
  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    return NextResponse.json({ error: COPY.invalid }, { status: 400 })
  }

  const parsed = askRequestSchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json({ error: COPY.invalid }, { status: 400 })
  }
  // Anything else the client sent — a `messages` array, most of all — was
  // dropped by the schema and does not exist from here down.
  const { conversationId: requestedId, message } = parsed.data

  // ── 3. The origin ────────────────────────────────────────────────────────
  const ipHash = hashIp(clientIp(request))

  // ── 4. The limits ────────────────────────────────────────────────────────
  // The pre-filter first, because it costs nothing. Same ceiling as the DB
  // count below, applied per instance: it can only ever shed a flood one warm
  // lambda sees, which is why the counts underneath it are the real control.
  if (!rateLimit(`ask:${ipHash}`, MAX_MESSAGES_PER_IP_PER_HOUR, HOUR_MS).ok) {
    return NextResponse.json({ error: COPY.tooFast }, { status: 429 })
  }

  const sinceIso = new Date(Date.now() - HOUR_MS).toISOString()

  let conversation: ChatConversation | null = null
  try {
    if ((await countRecentMessagesByIp(ipHash, sinceIso)) >= MAX_MESSAGES_PER_IP_PER_HOUR) {
      return NextResponse.json({ error: COPY.tooFast }, { status: 429 })
    }

    if (requestedId) {
      // A failed READ is not an absent row: `getConversation` throws on error
      // and returns null only for "no such row". Telling a visitor their
      // conversation expired during an outage sends them straight back into it.
      conversation = await getConversation(requestedId)
      if (!conversation) {
        return NextResponse.json({ error: COPY.unknownConversation }, { status: 404 })
      }
      if (conversation.message_count >= MAX_MESSAGES_PER_CONVERSATION) {
        return NextResponse.json({ error: COPY.tooManyMessages }, { status: 429 })
      }
      if (conversation.tokens_used >= MAX_TOKENS_PER_CONVERSATION) {
        return NextResponse.json({ error: COPY.tooManyMessages }, { status: 429 })
      }
    } else if ((await countRecentConversationsByIp(ipHash, sinceIso)) >= MAX_CONVERSATIONS_PER_IP_PER_HOUR) {
      return NextResponse.json({ error: COPY.tooFast }, { status: 429 })
    }
  } catch (err) {
    return failed("could not read the conversation or its limits", err)
  }

  // ── 5. The risk classifier, BEFORE the model exists in this function ─────
  // Everything below this line that could reach a model is inside the
  // `risk === "none"` path, by return rather than by condition.
  const risk = classifyRisk(message)

  try {
    // The row is created here rather than at the top so a 400 or a 429 never
    // leaves an empty conversation behind — the rate limits count rows, and a
    // limiter that its own rejections feed is a limiter that tightens itself.
    if (!conversation) {
      conversation = await createConversation({
        ipHash,
        userAgent: request.headers.get("user-agent"),
        landingPath: landingPathFrom(request),
        attributionSessionId: parseAttrCookie(request.headers.get("cookie")) ?? null,
      })
    }
  } catch (err) {
    return failed("could not start the conversation", err)
  }

  const conversationId = conversation.id

  if (risk !== "none") {
    try {
      await appendMessage({ conversationId, role: "user", content: message })
      await appendMessage({
        conversationId,
        role: "assistant",
        content: REFUSAL_INJURY,
        verdict: "short_circuit",
        // No model, so no fact set and no token spend. The classification is
        // kept because injury and medical are worth counting separately when
        // somebody reads a month of transcripts.
        factSet: { risk },
      })
    } catch (err) {
      return failed("could not record the short-circuited turn", err)
    }

    return NextResponse.json({ conversationId, reply: REFUSAL_INJURY, cards: [], verdict: "short_circuit" })
  }

  // ── 6. The turn ──────────────────────────────────────────────────────────
  let settings: BusinessSettings
  let modelMessages: Array<{ role: "user" | "assistant"; content: string }>
  try {
    settings = await getBusinessSettings(conversation.business_id)
    // Prior turns are read BEFORE this one is written, and this one is
    // appended to the array explicitly. Reading after the write would work
    // too, right up until a replica lagged and the model was handed a
    // conversation with no question in it.
    const prior = await listMessages(conversationId)
    modelMessages = [...toModelMessages(prior), { role: "user" as const, content: message }]
    await appendMessage({ conversationId, role: "user", content: message })
  } catch (err) {
    return failed("could not load the conversation", err)
  }

  const executor = createToolExecutor()

  let result
  try {
    result = await runWithTools({
      system: buildSystemPrompt(settings),
      messages: modelMessages,
      tools: CHAT_TOOLS,
      executeTool: executor.execute,
      model: CHAT_MODEL,
      maxTokens: MAX_OUTPUT_TOKENS,
      maxToolRounds: MAX_TOOL_ROUNDS,
    })
  } catch (err) {
    return failed("the assistant could not answer", err)
  }

  const outcome = executor.outcome()
  // NOT `FactSet.groundedValues` — that half knows only what the lookups
  // returned, because the merge has no settings to hand. Built here, from the
  // same facts plus the business's own details, immediately before validating,
  // so the assistant is not blocked for reading out its own address.
  const grounded = groundedValuesFor(outcome.facts, settings)
  const text = result.text.trim()
  const violations = validateReply(text, grounded)

  const recorded: unknown[] = [...violations]
  // The model asked for lookups it never got to read, so whatever it wrote was
  // written without them — the ungrounded case by another route.
  if (result.stoppedOnRoundLimit) recorded.push(ROUND_LIMIT_NOTE)
  if (text.length === 0) recorded.push(EMPTY_REPLY_NOTE)

  const persist = {
    conversationId,
    role: "assistant" as const,
    content: text,
    factSet: factSetFor(outcome, grounded),
    tokensInput: result.tokensInput,
    tokensOutput: result.tokensOutput,
    model: CHAT_MODEL,
  }

  if (recorded.length > 0) {
    try {
      await appendMessage({
        ...persist,
        verdict: "blocked",
        violations: recorded,
        // The cards ARE kept on a blocked row, unlike in the response: they
        // are database values, and whoever reads the block afterwards wants to
        // see what had been looked up when the model made something up anyway.
        cards: outcome.cards as unknown[],
      })
    } catch (err) {
      return failed("could not record the blocked turn", err)
    }

    // No `request` handed to the audit recorder, deliberately: it would lift
    // the raw address off the headers, and `chat_conversations.ip_hash` is the
    // only origin identifier this subsystem keeps. Actor `anonymous` because
    // nobody is signed in, which also stops the recorder reaching for a
    // NextAuth session that cannot exist on a public endpoint.
    await recordAudit({
      action: BLOCKED_AUDIT_ACTION,
      category: "compliance",
      outcome: "success",
      actor: { id: null, email: null, role: "anonymous" },
      target: { type: "chat_conversation", id: conversationId },
      metadata: {
        business_id: conversation.business_id,
        violations: recorded,
        stopped_on_round_limit: result.stoppedOnRoundLimit,
        grounded_value_count: grounded.length,
      },
    })

    // The whole turn goes, cards included. A price card beside "I can't answer
    // that accurately" is a mixed message, and the cards belonged to a reply
    // that no longer exists.
    return NextResponse.json({ conversationId, reply: REFUSAL_BLOCKED, cards: [], verdict: "blocked" })
  }

  try {
    await appendMessage({ ...persist, verdict: "ok", cards: outcome.cards as unknown[] })
  } catch (err) {
    return failed("could not record the turn", err)
  }

  // ── 7. The handover ──────────────────────────────────────────────────────
  // After the validator, and after the turn is on the record: the escalation
  // email carries the transcript, and sending it first would hand a person a
  // conversation missing the line that prompted it.
  let reply = text
  if (outcome.wantsEscalate) {
    const note = await handOver(conversationId, outcome.escalateSummary, message)
    if (note) reply = `${reply}\n\n${note}`
  }

  // The cards a visitor sees are the server's own typed values — integer cents,
  // ISO dates — never prose the model typed. That was ASSERTED here before it
  // was true: `capture.reason` is a tool argument, so the model writes it, and
  // the validator only ever sees the assistant's text. `visitorSafeCards`
  // redacts it. Formatting is the renderer's job, over the integer, so no money
  // value on screen is ever re-derived from a sentence.
  //
  // The unredacted cards are what was persisted above, deliberately: the reason
  // is evidence for whoever reads the transcript, and only the visitor-facing
  // copy needs to be free of it.
  const cards: Card[] = visitorSafeCards(outcome.cards)

  return NextResponse.json({ conversationId, reply, cards, verdict: "ok" })
}

/**
 * The referring page, so a lead can be attributed to where the conversation
 * started. Path only — a referrer can carry a query string somebody pasted a
 * token into, and this row is kept for months.
 */
function landingPathFrom(request: Request): string | null {
  const referer = request.headers.get("referer")
  if (!referer) return null
  try {
    return new URL(referer).pathname
  } catch {
    return null
  }
}

/**
 * One shape for every failure the visitor sees, and the detail stays in the
 * log. Never the thrown value itself: a Postgres error can embed the row it
 * choked on, and these rows hold visitor text.
 */
function failed(context: string, err: unknown) {
  const e = err as { message?: unknown } | null | undefined
  console.error(`[ask] ${context}`, { message: typeof e?.message === "string" ? e.message : undefined })
  return NextResponse.json({ error: COPY.failed }, { status: 500 })
}
