// @vitest-environment node
//
// Escalation is the assistant's honesty backstop: it is what happens when the
// conversation has run out of things the database can answer, and the visitor
// is told a person will pick it up.
//
// That sentence is a promise, so the ORDER here is the whole design. The
// durable record — `escalated_at` on the conversation, which is what
// `/admin/chat` lists — is written FIRST and is allowed to fail loudly.
// Everything after it is best effort and is caught: the timeline row, the
// transcript email, the audit row. A mail provider that is down, or a
// `business_settings.reply_to` that was never filled in, must not be able to
// swallow the fact that somebody asked for help.
//
// The blank-reply_to case is not hypothetical. `business_settings.reply_to` is
// the EMPTY STRING in the dev clone, measured, and whether production matches
// could not be checked from here. So it is a tested path, not a defensive
// flourish.
import { describe, it, expect, vi, beforeEach } from "vitest"
import type { BusinessSettings } from "@/lib/db/businesses"
import type { ChatConversation, ChatMessage } from "@/types/database"

const h = vi.hoisted(() => ({
  getConversation: vi.fn(),
  listMessages: vi.fn(),
  markEscalated: vi.fn(),
  getBusinessSettings: vi.fn(),
  sendChatEscalationEmail: vi.fn(),
  recordAudit: vi.fn(),
  inserts: [] as { table: string; row: Record<string, unknown> }[],
  insertError: null as unknown,
}))

vi.mock("@/lib/db/chat", () => ({
  getConversation: h.getConversation,
  listMessages: h.listMessages,
  markEscalated: h.markEscalated,
}))

vi.mock("@/lib/db/businesses", () => ({ getBusinessSettings: h.getBusinessSettings }))
vi.mock("@/lib/email", () => ({ sendChatEscalationEmail: h.sendChatEscalationEmail }))
vi.mock("@/lib/audit/record", () => ({ recordAudit: h.recordAudit }))

vi.mock("@/lib/supabase", () => ({
  createServiceRoleClient: () => ({
    from: (table: string) => ({
      insert: async (row: Record<string, unknown>) => {
        h.inserts.push({ table, row })
        return { error: h.insertError }
      },
    }),
  }),
}))

import { runEscalation, CHAT_ESCALATION_TIMELINE_KIND } from "@/lib/lead-engine/chat/escalate"

const SETTINGS: BusinessSettings = {
  business_id: "00000000-0000-0000-0000-000000000001",
  display_name: "Test Business",
  sender_name: "Test Business",
  sender_email: "hello@example.com",
  reply_to: "coach@example.com",
  logo_url: null,
  timezone: "America/New_York",
  quiet_hours_start: 21,
  quiet_hours_end: 8,
  daily_message_cap: 500,
  postal_address: "1 Example Street",
  sms_help_text: "Reply HELP for help",
  sms_messaging_service_sid: "",
  sms_sender_phone: "",
}

function conversation(over: Partial<ChatConversation> = {}): ChatConversation {
  return {
    id: "c1",
    business_id: SETTINGS.business_id,
    contact_id: null,
    status: "open",
    ip_hash: "hash",
    user_agent: null,
    landing_path: "/programs",
    attribution_session_id: null,
    message_count: 4,
    tokens_used: 900,
    escalated_at: null,
    captured_at: null,
    last_activity_at: "2026-08-23T10:00:00.000Z",
    created_at: "2026-08-23T09:59:00.000Z",
    ...over,
  }
}

function message(over: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: "m1",
    business_id: SETTINGS.business_id,
    conversation_id: "c1",
    role: "user",
    content: "Do you coach goalkeepers?",
    fact_set: {},
    cards: [],
    verdict: null,
    violations: [],
    tokens_input: null,
    tokens_output: null,
    model: null,
    created_at: "2026-08-23T10:00:00.000Z",
    ...over,
  }
}

const TRANSCRIPT = [
  message({ id: "m1", role: "user", content: "Do you coach goalkeepers?" }),
  message({ id: "m2", role: "assistant", content: "I can put you to a person." }),
]

beforeEach(() => {
  // resetAllMocks, not clearAllMocks: a queued *Once rejection left behind by
  // the send-failure test would otherwise reject in whichever test ran next
  // and misattribute the failure. Every mock is re-armed below.
  vi.resetAllMocks()
  h.inserts.length = 0
  h.insertError = null
  h.getConversation.mockResolvedValue(conversation())
  h.listMessages.mockResolvedValue(TRANSCRIPT)
  h.markEscalated.mockResolvedValue(undefined)
  h.getBusinessSettings.mockResolvedValue(SETTINGS)
  h.sendChatEscalationEmail.mockResolvedValue({ delivered: true })
  h.recordAudit.mockResolvedValue(undefined)
  vi.spyOn(console, "error").mockImplementation(() => {})
  vi.spyOn(console, "warn").mockImplementation(() => {})
})

describe("runEscalation", () => {
  it("emails business_settings.reply_to with the transcript", async () => {
    const out = await runEscalation({ conversationId: "c1", summary: "Asked about goalkeeper coaching" })

    expect(h.sendChatEscalationEmail).toHaveBeenCalledTimes(1)
    const arg = h.sendChatEscalationEmail.mock.calls[0][0]
    expect(arg.to).toBe("coach@example.com")
    expect(arg.conversationId).toBe("c1")
    expect(arg.summary).toBe("Asked about goalkeeper coaching")
    expect(arg.transcript.map((m: ChatMessage) => m.content)).toEqual([
      "Do you coach goalkeepers?",
      "I can put you to a person.",
    ])
    expect(out).toMatchObject({ ok: true, notice: "sent" })
  })

  it("marks the conversation escalated BEFORE it tries to tell anyone", async () => {
    await runEscalation({ conversationId: "c1", summary: "s" })

    // The durable record has to be in place before any best-effort step runs,
    // or a send that hangs leaves a visitor promised a reply nobody can see.
    expect(h.markEscalated.mock.invocationCallOrder[0]).toBeLessThan(
      h.sendChatEscalationEmail.mock.invocationCallOrder[0],
    )
  })

  it("writes a contact timeline event when a contact is known", async () => {
    h.getConversation.mockResolvedValue(conversation({ contact_id: "contact-7" }))

    const out = await runEscalation({ conversationId: "c1", summary: "Wants a call" })

    const timeline = h.inserts.filter((i) => i.table === "contact_timeline_events")
    expect(timeline).toHaveLength(1)
    expect(timeline[0].row).toMatchObject({
      contact_id: "contact-7",
      kind: CHAT_ESCALATION_TIMELINE_KIND,
      source: "ai_chat",
    })
    expect(out).toMatchObject({ ok: true, timelineEvent: true })
  })

  it("writes no timeline event when no contact was captured", async () => {
    // contact_id is NOT NULL on contact_timeline_events, so an anonymous
    // escalation has nothing to hang a row on. It is still escalated.
    const out = await runEscalation({ conversationId: "c1", summary: "s" })

    expect(h.inserts.filter((i) => i.table === "contact_timeline_events")).toHaveLength(0)
    expect(h.markEscalated).toHaveBeenCalledWith("c1")
    expect(out).toMatchObject({ ok: true, timelineEvent: false })
  })

  it("is capped at one escalation per conversation", async () => {
    h.getConversation.mockResolvedValue(conversation({ escalated_at: "2026-08-23T10:05:00.000Z" }))

    const out = await runEscalation({ conversationId: "c1", summary: "s" })

    expect(out).toEqual({ ok: false, reason: "already_escalated" })
    expect(h.markEscalated).not.toHaveBeenCalled()
    expect(h.sendChatEscalationEmail).not.toHaveBeenCalled()
    expect(h.inserts).toHaveLength(0)
  })

  it("still marks the conversation escalated when the email send fails", async () => {
    h.sendChatEscalationEmail.mockRejectedValue(new Error("resend down"))

    const out = await runEscalation({ conversationId: "c1", summary: "s" })

    expect(h.markEscalated).toHaveBeenCalledWith("c1")
    expect(out).toMatchObject({ ok: true, notice: "failed" })
  })

  it("still marks the conversation escalated when reply_to is blank, and sends nothing", async () => {
    // The measured state of the dev clone. An empty string is a valid `to` as
    // far as TypeScript is concerned and a hard provider error at send time,
    // so it is caught here rather than thrown at Resend.
    h.getBusinessSettings.mockResolvedValue({ ...SETTINGS, reply_to: "" })

    const out = await runEscalation({ conversationId: "c1", summary: "s" })

    expect(h.markEscalated).toHaveBeenCalledWith("c1")
    expect(h.sendChatEscalationEmail).not.toHaveBeenCalled()
    expect(out).toMatchObject({ ok: true, notice: "not_configured" })
  })

  it("still marks the conversation escalated when business_settings cannot be read", async () => {
    h.getBusinessSettings.mockRejectedValue(new Error("supabase down"))

    const out = await runEscalation({ conversationId: "c1", summary: "s" })

    expect(h.markEscalated).toHaveBeenCalledWith("c1")
    expect(out).toMatchObject({ ok: true, notice: "failed" })
  })

  it("reports not_configured when the sender says it delivered nothing", async () => {
    // The Resend wrapper in lib/email.ts returns a SUCCESS shape when
    // RESEND_API_KEY is unset. Treating "no exception" as "sent" would report
    // a delivery that never left the process.
    h.sendChatEscalationEmail.mockResolvedValue({ delivered: false })

    const out = await runEscalation({ conversationId: "c1", summary: "s" })

    expect(out).toMatchObject({ ok: true, notice: "not_configured" })
  })

  it("keeps the escalation when the timeline write fails", async () => {
    h.getConversation.mockResolvedValue(conversation({ contact_id: "contact-7" }))
    h.insertError = { message: "timeline exploded" }

    const out = await runEscalation({ conversationId: "c1", summary: "s" })

    expect(h.markEscalated).toHaveBeenCalledWith("c1")
    expect(out).toMatchObject({ ok: true, timelineEvent: false, notice: "sent" })
  })

  it("records what actually happened in the audit trail", async () => {
    h.sendChatEscalationEmail.mockResolvedValue({ delivered: false })

    await runEscalation({ conversationId: "c1", summary: "Wants a call" })

    expect(h.recordAudit).toHaveBeenCalledTimes(1)
    const arg = h.recordAudit.mock.calls[0][0]
    expect(arg.action).toBe("chat.escalated")
    expect(arg.category).toBe("marketing")
    expect(arg.target).toEqual({ type: "chat_conversation", id: "c1" })
    // The trail has to say whether anybody was actually told, not just that an
    // escalation was recorded.
    expect(arg.metadata.notice).toBe("not_configured")
  })

  it("refuses a conversation that is not there rather than inventing one", async () => {
    h.getConversation.mockResolvedValue(null)

    const out = await runEscalation({ conversationId: "nope", summary: "s" })

    expect(out).toEqual({ ok: false, reason: "conversation_not_found" })
    expect(h.markEscalated).not.toHaveBeenCalled()
  })

  it("lets a failed conversation READ throw instead of reporting 'no such conversation'", async () => {
    // null and "the database was unreachable" are different answers. Reporting
    // the second as the first would silently drop an escalation.
    h.getConversation.mockRejectedValue(new Error("supabase down"))

    await expect(runEscalation({ conversationId: "c1", summary: "s" })).rejects.toThrow("supabase down")
  })

  it("hands the operator the whole summary by email, however long it is", async () => {
    h.getConversation.mockResolvedValue(conversation({ contact_id: "contact-7" }))

    const out = await runEscalation({ conversationId: "c1", summary: "x".repeat(5_000) })

    expect(out).toMatchObject({ ok: true })
    // The email is a notification to one operator that is read and deleted.
    // It is the ONE place the whole summary is allowed to go, so it is not
    // truncated on the way out.
    expect(h.sendChatEscalationEmail.mock.calls[0][0].summary).toHaveLength(5_000)
  })
})

// ---------------------------------------------------------------------------
// WHAT THE LONG-RETENTION TABLES ARE ALLOWED TO KEEP
// ---------------------------------------------------------------------------
//
// Three tables hold something about a handover, and they do NOT expire
// together:
//
//   chat_messages             chat_retention_days             90
//   audit_logs                audit_log_retention_days       365
//   contact_timeline_events   contact_timeline_retention_days 365
//
// The transcript — the visitor's actual words — belongs in the 90-day one,
// which is also the one with an admin surface built over it. `/api/ask` builds
// the escalation summary from the visitor's own message when the assistant did
// not write one, so a summary IS visitor text in the common case: a parent
// asking about their child's knee, quoted verbatim.
//
// Copying that into either 365-day table gives the most sensitive sentence in
// the feature the LONGEST life of anything in it, in tables the retention
// design never claimed to cover, and `lib/audit/scrub.ts` will not save us —
// it redacts `password|token|secret|api_key` and nothing else.
//
// So both long-lived rows record THAT a handover happened and carry the ids
// needed to go and read it. `/admin/chat/<conversation_id>` renders the
// transcript already.
describe("runEscalation — the visitor's words stay in the 90-day table", () => {
  /** Deliberately the shape /api/ask falls back to: the visitor's raw message. */
  const VISITOR_WORDS = "my daughter tore her ACL on Saturday and I want to know if she can still train"
  const SUMMARY = `The assistant handed this over. The visitor asked: ${VISITOR_WORDS}`

  it("keeps the visitor's words out of audit_logs, and carries the ids instead", async () => {
    h.getConversation.mockResolvedValue(conversation({ contact_id: "contact-7" }))

    await runEscalation({ conversationId: "c1", summary: SUMMARY })

    expect(JSON.stringify(h.recordAudit.mock.calls)).not.toContain(VISITOR_WORDS)

    // Asserted as an EXACT object rather than as an absence: a test that only
    // says "no summary key" passes just as happily for a row that quietly
    // renamed the field, and a test that says "some metadata came back" cannot
    // tell the ids from the prose.
    const arg = h.recordAudit.mock.calls[0][0]
    expect(arg.metadata).toEqual({
      business_id: SETTINGS.business_id,
      notice: "sent",
      contact_id: "contact-7",
      timeline_event: true,
    })
    // The pointer to where the words DO live, for the 90 days they live there.
    expect(arg.target).toEqual({ type: "chat_conversation", id: "c1" })
  })

  it("keeps the visitor's words out of contact_timeline_events, and carries the conversation id instead", async () => {
    h.getConversation.mockResolvedValue(conversation({ contact_id: "contact-7" }))

    await runEscalation({ conversationId: "c1", summary: SUMMARY })

    const row = h.inserts.find((i) => i.table === "contact_timeline_events")!.row
    expect(JSON.stringify(row)).not.toContain(VISITOR_WORDS)
    expect(row.metadata).toEqual({ conversation_id: "c1" })
    // The row still says what happened and where it came from.
    expect(row).toMatchObject({ kind: CHAT_ESCALATION_TIMELINE_KIND, source: "ai_chat", contact_id: "contact-7" })
  })

  it("logs the code and message of a failed timeline insert, never the row PostgREST echoed back", async () => {
    h.getConversation.mockResolvedValue(conversation({ contact_id: "contact-7" }))
    // A real PostgREST constraint violation: `details` quotes the failing row
    // back at you, which is how visitor text reaches a log even when the
    // insert never landed.
    h.insertError = {
      code: "23514",
      message: "new row violates check constraint",
      details: `Failing row contains (c1, contact-7, chat_escalated, ${VISITOR_WORDS}).`,
      hint: "Check the metadata column.",
    }

    const out = await runEscalation({ conversationId: "c1", summary: SUMMARY })

    expect(out).toMatchObject({ ok: true, timelineEvent: false })
    const logged = JSON.stringify(vi.mocked(console.error).mock.calls)
    expect(logged).not.toContain(VISITOR_WORDS)
    expect(logged).not.toContain("Check the metadata column.")
    // And it is not silent about the failure either — the operator still gets
    // the two fields that identify which constraint refused it.
    expect(logged).toContain("23514")
    expect(logged).toContain("new row violates check constraint")
  })
})
