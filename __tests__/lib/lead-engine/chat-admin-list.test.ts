// @vitest-environment node
//
// __tests__/lib/lead-engine/chat-admin-list.test.ts — the reads behind
// /admin/chat.
//
// The Supabase mock below applies the filters it is given rather than
// returning canned rows, because every bug worth catching here is a MISSING or
// WRONG filter, and a mock that ignored them would pass with the bug present.
// That is the same construction `chat-facts.test.ts` uses for the privacy
// boundary, and for the same reason.
//
// Three properties are load-bearing:
//
//   1. THE LIST AND THE COUNT NARROW THE SAME WAY. A count that ignores the
//      filter renders "12 conversations" above a list of 3 — the exact bug
//      `lib/db/funnel-leads.ts` and `lib/db/contacts-list.ts` both carry a
//      comment about.
//   2. "BLOCKED" COMES FROM THE MESSAGES. It is not a column on the
//      conversation, so it costs a second query, and a conversation with no
//      blocked reply must not appear under that filter.
//   3. A TRUNCATED ANSWER IS WORSE THAN AN ERROR. The blocked-id walk throws
//      rather than returning a short list: "these are the conversations where
//      a reply was stopped", quietly missing some, is the one answer this page
//      must never give.

import { describe, it, expect, vi, beforeEach } from "vitest"

type Row = Record<string, unknown>

interface RecordedCall {
  table: string
  eq: Record<string, unknown>
  notNull: string[]
  inValues: Record<string, unknown[]>
  head: boolean
}

const calls: RecordedCall[] = []
let tables: Record<string, Row[]> = {}

vi.mock("@/lib/supabase", () => ({
  createServiceRoleClient: () => ({
    from(table: string) {
      const predicates: Array<(row: Row) => boolean> = []
      const call: RecordedCall = { table, eq: {}, notNull: [], inValues: {}, head: false }
      let sliceFrom: number | null = null
      let sliceTo: number | null = null

      const chain: Record<string, unknown> = {
        select(_columns?: string, options?: { count?: string; head?: boolean }) {
          call.head = options?.head === true
          return chain
        },
        eq(column: string, value: unknown) {
          call.eq[column] = value
          predicates.push((row) => row[column] === value)
          return chain
        },
        not(column: string, operator: string, value: unknown) {
          if (operator === "is" && value === null) {
            call.notNull.push(column)
            predicates.push((row) => row[column] !== null && row[column] !== undefined)
          }
          return chain
        },
        in(column: string, values: unknown[]) {
          call.inValues[column] = values
          predicates.push((row) => values.includes(row[column]))
          return chain
        },
        order() {
          return chain
        },
        range(from: number, to: number) {
          sliceFrom = from
          sliceTo = to
          return chain
        },
        then(resolve: (value: unknown) => unknown) {
          calls.push(call)
          const matching = (tables[table] ?? []).filter((row) => predicates.every((p) => p(row)))
          if (call.head) return Promise.resolve({ data: null, count: matching.length, error: null }).then(resolve)
          const windowed = sliceFrom === null ? matching : matching.slice(sliceFrom, (sliceTo ?? 0) + 1)
          return Promise.resolve({ data: windowed, count: windowed.length, error: null }).then(resolve)
        },
      }
      return chain
    },
  }),
}))

// Deliberately NOT SINGLETON_BUSINESS_ID ("00000000-0000-0000-0000-000000000001").
// Every call below passes `businessId: BUSINESS` explicitly, and if a mutation
// ever put the SINGLETON constant back in place of that argument, a BUSINESS
// that coincidentally equalled the singleton would go on passing. OTHER_BUSINESS
// is the singleton's own id for exactly that reason: it is what a reverted call
// would actually scope to, so "another business's rows leak in" is precisely
// what regresses if `businessId` stops being threaded through.
const BUSINESS = "22222222-2222-2222-2222-222222222222"
const OTHER_BUSINESS = "00000000-0000-0000-0000-000000000001"

function conversation(over: Row = {}): Row {
  return {
    id: "c-plain",
    business_id: BUSINESS,
    created_at: "2026-08-20T09:00:00.000Z",
    last_activity_at: "2026-08-20T09:04:00.000Z",
    message_count: 4,
    tokens_used: 100,
    landing_path: "/",
    escalated_at: null,
    captured_at: null,
    contact_id: null,
    ...over,
  }
}

function blockedMessage(conversationId: string, index = 0): Row {
  return {
    id: `${conversationId}-m${index}`,
    business_id: BUSINESS,
    conversation_id: conversationId,
    verdict: "blocked",
    created_at: "2026-08-20T09:00:10.000Z",
  }
}

beforeEach(() => {
  calls.length = 0
  tables = {}
})

describe("parsing what the URL asked for", () => {
  it("narrows a junk filter to everything, never to nothing", async () => {
    const { parseChatFilters } = await import("@/lib/db/chat")
    // "show me everything" is the obviously right answer to an unreadable
    // filter. Narrowing to nothing would read as "the assistant has never run".
    expect(parseChatFilters({ show: "junk" }).show).toBe("all")
    expect(parseChatFilters({}).show).toBe("all")
    expect(parseChatFilters({ show: "escalated" }).show).toBe("escalated")
    expect(parseChatFilters({ show: "blocked" }).show).toBe("blocked")
  })

  it("refuses a page number that would become a negative range start", async () => {
    const { parseChatFilters } = await import("@/lib/db/chat")
    // `?page=0` is `.range(-25, -1)`, which PostgREST answers with a 400 —
    // a hand-edited URL rendering the admin error boundary instead of a list.
    expect(parseChatFilters({ page: "0" }).page).toBe(1)
    expect(parseChatFilters({ page: "-2" }).page).toBe(1)
    expect(parseChatFilters({ page: "junk" }).page).toBe(1)
    expect(parseChatFilters({ page: "9999" }).page).toBe(1)
    expect(parseChatFilters({ page: "3" }).page).toBe(3)
  })
})

describe("the list and the count agree about what they are showing", () => {
  it("narrows both to the escalated conversations, and scopes both to the business", async () => {
    const { listChatConversations, countChatConversations } = await import("@/lib/db/chat")
    tables.chat_conversations = [
      conversation({ id: "c-escalated", escalated_at: "2026-08-20T09:05:00.000Z" }),
      conversation({ id: "c-plain-1" }),
      conversation({ id: "c-plain-2" }),
    ]
    tables.chat_messages = []

    const rows = await listChatConversations({ businessId: BUSINESS, show: "escalated", limit: 25 })
    const total = await countChatConversations({ businessId: BUSINESS, show: "escalated" })

    expect(rows.map((row) => row.id)).toEqual(["c-escalated"])
    // The count is asserted against the LIST's length, not against a literal:
    // the bug being prevented is the two disagreeing.
    expect(total).toBe(rows.length)

    const conversationCalls = calls.filter((call) => call.table === "chat_conversations")
    // A presence control: this loop is meaningless if nothing in it ran a
    // chat_conversations query at all.
    expect(conversationCalls.length).not.toBe(0)
    for (const call of conversationCalls) {
      expect(call.eq.business_id).toBe(BUSINESS)
      expect(call.notNull).toContain("escalated_at")
    }
  })

  it("narrows both to the captured conversations", async () => {
    const { listChatConversations, countChatConversations } = await import("@/lib/db/chat")
    tables.chat_conversations = [
      conversation({ id: "c-captured", captured_at: "2026-08-20T09:06:00.000Z", contact_id: "contact-1" }),
      conversation({ id: "c-plain-1" }),
    ]
    tables.chat_messages = []

    const rows = await listChatConversations({ businessId: BUSINESS, show: "captured", limit: 25 })
    expect(rows.map((row) => row.id)).toEqual(["c-captured"])
    expect(await countChatConversations({ businessId: BUSINESS, show: "captured" })).toBe(rows.length)
  })

  it("shows everything when nothing was asked for", async () => {
    const { listChatConversations, countChatConversations } = await import("@/lib/db/chat")
    tables.chat_conversations = [conversation({ id: "c-1" }), conversation({ id: "c-2" })]
    tables.chat_messages = []

    expect((await listChatConversations({ businessId: BUSINESS, limit: 25 })).map((row) => row.id)).toEqual([
      "c-1",
      "c-2",
    ])
    expect(await countChatConversations({ businessId: BUSINESS })).toBe(2)
  })

  it("never shows another business's conversations, even under the unfiltered 'all' view", async () => {
    const { listChatConversations, countChatConversations } = await import("@/lib/db/chat")
    tables.chat_conversations = [
      conversation({ id: "c-mine" }),
      conversation({ id: "c-someone-elses", business_id: OTHER_BUSINESS }),
    ]
    tables.chat_messages = []

    const rows = await listChatConversations({ businessId: BUSINESS, limit: 25 })
    expect(rows.map((row) => row.id)).toEqual(["c-mine"])
    expect(await countChatConversations({ businessId: BUSINESS })).toBe(1)
  })
})

describe("blocked is a property of the messages", () => {
  it("keeps a conversation out of the blocked filter when none of its replies were blocked", async () => {
    const { listChatConversations, countChatConversations } = await import("@/lib/db/chat")
    tables.chat_conversations = [conversation({ id: "c-blocked" }), conversation({ id: "c-clean" })]
    tables.chat_messages = [blockedMessage("c-blocked")]

    const rows = await listChatConversations({ businessId: BUSINESS, show: "blocked", limit: 25 })
    expect(rows.map((row) => row.id)).toEqual(["c-blocked"])
    expect(await countChatConversations({ businessId: BUSINESS, show: "blocked" })).toBe(rows.length)
  })

  it("answers an empty list rather than every conversation when nothing was ever blocked", async () => {
    const { listChatConversations, countChatConversations } = await import("@/lib/db/chat")
    tables.chat_conversations = [conversation({ id: "c-1" }), conversation({ id: "c-2" })]
    tables.chat_messages = []

    // An empty `.in()` list is the trap here: a filter that quietly becomes
    // "no filter" would show every conversation under "a reply was blocked".
    expect(await listChatConversations({ businessId: BUSINESS, show: "blocked", limit: 25 })).toEqual([])
    expect(await countChatConversations({ businessId: BUSINESS, show: "blocked" })).toBe(0)
  })

  it("does not count another business's blocked replies onto a conversation of ours", async () => {
    // blockedConversationIds and blockedCountsFor both query chat_messages
    // without going through chat_conversations' own filter, so each one needs
    // its own business_id predicate — this is the case that would go wrong if
    // either lost it.
    const { listChatConversations } = await import("@/lib/db/chat")
    tables.chat_conversations = [conversation({ id: "c-mine" })]
    tables.chat_messages = [{ ...blockedMessage("c-mine"), business_id: OTHER_BUSINESS }]

    const rows = await listChatConversations({ businessId: BUSINESS, limit: 25 })
    expect(rows.map((row) => [row.id, row.blocked_count])).toEqual([["c-mine", 0]])
    expect(await listChatConversations({ businessId: BUSINESS, show: "blocked", limit: 25 })).toEqual([])
  })

  it("counts the blocked replies on each row it returns", async () => {
    const { listChatConversations } = await import("@/lib/db/chat")
    tables.chat_conversations = [conversation({ id: "c-two" }), conversation({ id: "c-none" })]
    tables.chat_messages = [
      blockedMessage("c-two", 0),
      blockedMessage("c-two", 1),
      { ...blockedMessage("c-none", 0), verdict: "ok" },
    ]

    const rows = await listChatConversations({ businessId: BUSINESS, limit: 25 })
    expect(rows.map((row) => [row.id, row.blocked_count])).toEqual([
      ["c-two", 2],
      ["c-none", 0],
    ])
  })

  it("throws rather than answering with a truncated list of blocked conversations", async () => {
    const { listChatConversations } = await import("@/lib/db/chat")
    tables.chat_conversations = [conversation({ id: "c-1" })]
    // 20 full pages of 1000. A silent truncation here would render as
    // "these are the blocked conversations", missing some.
    tables.chat_messages = Array.from({ length: 20_001 }, (_, index) => blockedMessage(`c-${index}`, index))

    await expect(listChatConversations({ businessId: BUSINESS, show: "blocked", limit: 25 })).rejects.toThrow(
      /truncated/i,
    )
  })
})
