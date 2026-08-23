// @vitest-environment node
//
// THE LOAD-BEARING PROPERTY OF THIS FILE: no tool the model can call has a
// write path.
//
// `capture_lead` does not create a contact — it pushes a card and returns a
// sentence telling the model the card is on screen. The visitor's own click on
// that rendered form is what writes, through a separate route. `book_consult`
// returns a link and books nothing. `escalate` records an intent for the route
// to act on AFTER the reply has been validated.
//
// So a prompt injection that reaches a tool still cannot create a contact, file
// a consent row or spend money. That is the same discipline as
// `app/api/funnels/preview-submit`, which writes nothing BY CONSTRUCTION rather
// than by a filter someone has to keep maintaining — and, like that route, the
// first test here reads the source off disk, because a guarantee about what a
// file does not contain is only checkable against the file.
import { describe, it, expect, vi, beforeEach } from "vitest"
import { readFileSync } from "fs"
import type { BusinessSettings } from "@/lib/db/businesses"

// Rows the real fact accessors will read. The accessors' own visibility
// filters are pinned by `chat-facts.test.ts` against a mock that applies
// them; this file is about what the EXECUTOR does with what comes back, so
// the mock here just hands over the table's rows.
let rowsByTable: Record<string, Record<string, unknown>[]> = {}

vi.mock("@/lib/supabase", () => ({
  createServiceRoleClient: () => ({
    from(table: string) {
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: () => chain,
        gte: () => chain,
        order: () => chain,
        limit: () => chain,
        then(res: (v: unknown) => unknown) {
          return Promise.resolve({ data: rowsByTable[table] ?? [], error: null }).then(res)
        },
      }
      return chain
    },
  }),
}))

const SETTINGS: BusinessSettings = {
  business_id: "00000000-0000-0000-0000-000000000001",
  display_name: "Acme Performance",
  sender_name: "Acme Performance",
  sender_email: "hello@example.com",
  reply_to: "hello@example.com",
  logo_url: null,
  timezone: "America/New_York",
  quiet_hours_start: 21,
  quiet_hours_end: 8,
  daily_message_cap: 200,
  postal_address: "12 Example Street, Springfield",
  sms_help_text: "Reply HELP for help.",
  sms_messaging_service_sid: "",
  sms_sender_phone: "+15550101234",
}

const PUBLIC_PROGRAMME = {
  name: "Rotational Reboot",
  price_cents: 7900,
  duration_weeks: 6,
  sessions_per_week: 3,
  payment_type: "one_time",
}

beforeEach(() => {
  rowsByTable = {}
})

describe("no tool the model can call has a write path", () => {
  const src = readFileSync("lib/lead-engine/chat/tools.ts", "utf8")

  it("never imports a write helper", () => {
    for (const forbidden of ["captureLead", "recordConsent", "recordContactEvent", "suppress", "stripe"]) {
      expect(src).not.toContain(forbidden)
    }
  })

  it("never inserts, updates or deletes", () => {
    expect(src).not.toMatch(/\.(insert|update|upsert|delete)\(/)
  })

  it("reaches the database only through the public-only fact accessors", () => {
    // The privacy boundary is `facts.ts`. A tool that opened its own Supabase
    // client would be outside it, and the two-visibility-column trap that
    // file exists for would be back in play.
    expect(src).not.toContain("createServiceRoleClient")
    for (const dal of ["@/lib/db/programs", "@/lib/db/events", "@/lib/db/faqs", "@/lib/db/testimonials"]) {
      expect(src).not.toContain(dal)
    }
  })
})

describe("the executor", () => {
  it("marks capture as wanted without writing anything", async () => {
    const { createToolExecutor } = await import("@/lib/lead-engine/chat/tools")
    const ex = createToolExecutor()
    await ex.execute("capture_lead", { reason: "wants pricing" })
    expect(ex.outcome().wantsCapture).toBe(true)
    expect(ex.outcome().cards.some((c) => c.kind === "capture")).toBe(true)
  })

  it("tells the model the form is on screen and that nothing has been saved yet", async () => {
    const { createToolExecutor } = await import("@/lib/lead-engine/chat/tools")
    const ex = createToolExecutor()
    const out = (await ex.execute("capture_lead", { reason: "wants pricing" })).toLowerCase()
    expect(out).toContain("on screen")
    expect(out).toContain("nothing has been saved")
  })

  it("declares exactly the three tools the spec names, plus retrieval", async () => {
    const { CHAT_TOOLS, TOOL_LABELS } = await import("@/lib/lead-engine/chat/tools")
    const names = CHAT_TOOLS.map((t) => t.name)
    for (const n of ["capture_lead", "book_consult", "escalate"]) expect(names).toContain(n)
    for (const n of ["search_faqs", "list_programmes", "list_camps_and_clinics", "list_testimonials"])
      expect(names).toContain(n)
    for (const n of names) expect(TOOL_LABELS[n]).toBeTruthy()
  })

  it("book_consult hands over a link and creates no booking", async () => {
    const { createToolExecutor } = await import("@/lib/lead-engine/chat/tools")
    const ex = createToolExecutor()
    const out = await ex.execute("book_consult", {})
    expect(out).toContain("/contact")
    expect(ex.outcome().cards.some((c) => c.kind === "consult")).toBe(true)
  })

  it("escalate records the summary for the route and nothing else", async () => {
    const { createToolExecutor } = await import("@/lib/lead-engine/chat/tools")
    const ex = createToolExecutor()
    await ex.execute("escalate", { summary: "Asked about a shoulder problem" })
    const outcome = ex.outcome()
    expect(outcome.wantsEscalate).toBe(true)
    expect(outcome.escalateSummary).toBe("Asked about a shoulder problem")
    // Escalation is the ONE tool that leads to a write, and the executor is
    // not where it happens: the route acts on this intent only after the
    // reply has been validated, so a blocked turn cannot email anyone.
    expect(outcome.wantsCapture).toBe(false)
  })

  it("hands programme facts and a card to the turn, with money as integer cents", async () => {
    const { createToolExecutor } = await import("@/lib/lead-engine/chat/tools")
    rowsByTable = { programs: [PUBLIC_PROGRAMME] }
    const ex = createToolExecutor()
    await ex.execute("list_programmes", {})
    const outcome = ex.outcome()
    expect(outcome.facts).toContainEqual(
      expect.objectContaining({ kind: "programme", name: "Rotational Reboot", priceCents: 7900 }),
    )
    // Numbers reach the visitor as a rendered card, not as prose the model
    // typed, so the card carries the integer the database holds.
    expect(outcome.cards).toContainEqual(expect.objectContaining({ kind: "programme", priceCents: 7900 }))
  })

  it("does not duplicate facts or cards when the model looks the same thing up twice", async () => {
    const { createToolExecutor } = await import("@/lib/lead-engine/chat/tools")
    rowsByTable = { programs: [PUBLIC_PROGRAMME] }
    const ex = createToolExecutor()
    await ex.execute("list_programmes", {})
    await ex.execute("list_programmes", {})
    expect(ex.outcome().facts).toHaveLength(1)
    expect(ex.outcome().cards).toHaveLength(1)
  })

  it("answers the empty camp list with designed copy rather than an empty array", async () => {
    const { createToolExecutor } = await import("@/lib/lead-engine/chat/tools")
    const { NO_EVENTS_SCHEDULED } = await import("@/lib/lead-engine/chat/constants")
    rowsByTable = { events: [] }
    const ex = createToolExecutor()
    // 0 published events is the COMMON path in this corpus, not an edge case.
    expect(await ex.execute("list_camps_and_clinics", {})).toBe(NO_EVENTS_SCHEDULED)
    expect(ex.outcome().cards).toEqual([])
  })

  it("gives each turn its own accumulator", async () => {
    const { createToolExecutor } = await import("@/lib/lead-engine/chat/tools")
    const first = createToolExecutor()
    await first.execute("capture_lead", { reason: "wants pricing" })
    const second = createToolExecutor()
    expect(second.outcome().wantsCapture).toBe(false)
    expect(second.outcome().cards).toEqual([])
  })

  it("throws on a tool it does not declare, rather than returning a quiet empty answer", async () => {
    const { createToolExecutor } = await import("@/lib/lead-engine/chat/tools")
    const ex = createToolExecutor()
    // The tool loop turns this into a tool_result the model can respond to.
    // Returning "" instead would read to the model as "the lookup found
    // nothing", which is a different and much worse answer.
    await expect(ex.execute("delete_everything", {})).rejects.toThrow()
  })
})

describe("the system prompt", () => {
  it("names the business from settings, never from a literal", async () => {
    const { buildSystemPrompt } = await import("@/lib/lead-engine/chat/prompt")
    expect(buildSystemPrompt(SETTINGS)).toContain("Acme Performance")
  })

  it("states the address it was given", async () => {
    const { buildSystemPrompt } = await import("@/lib/lead-engine/chat/prompt")
    expect(buildSystemPrompt(SETTINGS)).toContain("12 Example Street, Springfield")
  })

  it("says nothing at all about a detail that is blank", async () => {
    const { buildSystemPrompt } = await import("@/lib/lead-engine/chat/prompt")
    // Blank is the SHIPPED state of both `display_name` and `postal_address`.
    // A prompt that renders "Postal address:" with nothing after it teaches the
    // model to say exactly that back to a visitor.
    const prompt = buildSystemPrompt({ ...SETTINGS, display_name: "", postal_address: "  " })
    expect(prompt).not.toContain("Springfield")
    // The LABEL has to go too, not just the value. Asserting only that the old
    // value is absent passes with the empty line still rendered — which is what
    // this assertion was doing until a mutation caught it out.
    expect(prompt).not.toContain("Postal address")
    expect(prompt).not.toContain("undefined")
    expect(prompt).not.toContain("null")
    // The two marks a blank interpolation always leaves behind, wherever it
    // happens: a doubled space, or a space where a word should sit before the
    // punctuation ("the website of .").
    expect(prompt).not.toMatch(/ {2,}/)
    expect(prompt).not.toMatch(/\s[.,]/)
  })

  it("leaves no blank-looking gap when every detail IS configured either", async () => {
    const { buildSystemPrompt } = await import("@/lib/lead-engine/chat/prompt")
    const prompt = buildSystemPrompt(SETTINGS)
    expect(prompt).not.toMatch(/ {2,}/)
    expect(prompt).not.toMatch(/\s[.,]/)
  })
})

describe("no model-authored prose reaches the visitor on a card", () => {
  // THE DEFECT THIS EXISTS FOR. `capture_lead(reason)` is a tool ARGUMENT, so
  // the model writes it — and `validateReply` is handed the assistant's TEXT
  // and nothing else, so a card never passed the output validator. A
  // prompt-injected reason carrying a fabricated price, a fabricated date and a
  // guaranteed outcome rendered under "Leave your details" while the turn
  // recorded verdict:"ok", with no violation and no audit row, because the
  // assistant's own sentence was clean.
  //
  // It is redacted rather than validated, on this directory's usual principle:
  // a thing that cannot be expressed needs no filter maintaining.
  const INJECTED = "Lock in the $49/month launch rate — guaranteed to add 10mph to your throw, offer ends July 1"

  it("strips the model's reason from every capture card", async () => {
    const { createToolExecutor, visitorSafeCards } = await import("@/lib/lead-engine/chat/tools")
    const ex = createToolExecutor()
    await ex.execute("capture_lead", { reason: INJECTED })

    const persisted = ex.outcome().cards
    const shown = visitorSafeCards(persisted)

    // Exact, not a containment check: a containment assertion would still pass
    // if a SECOND card carried the text through.
    expect(shown).toEqual([{ kind: "capture", reason: null }])
    expect(JSON.stringify(shown)).not.toContain("49")
    expect(JSON.stringify(shown)).not.toContain("guaranteed")
  })

  it("keeps the reason on the PERSISTED card, because the operator needs the evidence", async () => {
    const { createToolExecutor } = await import("@/lib/lead-engine/chat/tools")
    const ex = createToolExecutor()
    await ex.execute("capture_lead", { reason: INJECTED })
    expect(ex.outcome().cards).toEqual([{ kind: "capture", reason: INJECTED }])
  })

  it("leaves every server-authored card untouched", async () => {
    const { visitorSafeCards } = await import("@/lib/lead-engine/chat/tools")
    const consult = { kind: "consult" as const, href: "/contact" }
    expect(visitorSafeCards([consult])).toEqual([consult])
  })
})
