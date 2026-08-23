// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest"

/**
 * WHY THIS FILE EXISTS.
 *
 * `lib/db/chat.ts`'s WRITE and COUNT half had no test at all. It is mocked in
 * `ask.test.ts`, `ask-capture.test.ts` and `chat-refusals.test.ts`, and
 * `chat-admin-list.test.ts` points its query-recording double only at the READ
 * half. Four mutations were applied at once and ALL FOUR SURVIVED:
 *
 *   - `countRecentConversationsByIp` losing `.eq("ip_hash")` + `.gte(created_at)`
 *     — the 5-per-hour limit becomes a global all-time count, locking out every
 *     visitor after the fifth conversation the site has ever had.
 *   - `countRecentMessagesByIp` losing `.in(conversation_id)` + `.gte(...)` —
 *     exactly the failure that function's own comment says the two-query form
 *     makes impossible: "every message anyone sent this hour".
 *   - `markCaptured` not stamping `captured_at` — the capture route's
 *     one-per-conversation cap reads that column, so one card could file
 *     unlimited contacts and consent rows.
 *   - `appendMessage` writing `verdict: null, violations: []` regardless —
 *     every blocked turn persists as clean, and both the admin blocked filter
 *     and the "why was this blocked" panel go permanently empty.
 *
 * Spec §7.2 calls the limits "DB-backed" and §3 calls the fact set "kept per
 * message so a block can be explained months later". Neither claim was pinned
 * below the mock line until now.
 */

type Call = { table: string; op: string; filters: Record<string, unknown>; payload?: unknown }
const calls: Call[] = []
let countValue = 0
let rows: unknown[] = []

vi.mock("@/lib/supabase", () => ({
  createServiceRoleClient: () => ({
    from(table: string) {
      const call: Call = { table, op: "select", filters: {} }
      const chain: Record<string, unknown> = {
        insert(payload: unknown) {
          call.op = "insert"
          call.payload = payload
          calls.push(call)
          return chain
        },
        update(payload: unknown) {
          call.op = "update"
          call.payload = payload
          calls.push(call)
          return chain
        },
        select(_cols?: string, opts?: { head?: boolean }) {
          if (call.op === "select" && !calls.includes(call)) calls.push(call)
          if (opts?.head) call.op = "count"
          return chain
        },
        eq(col: string, val: unknown) {
          call.filters[col] = val
          return chain
        },
        gte(col: string, val: unknown) {
          call.filters[`${col}__gte`] = val
          return chain
        },
        in(col: string, val: unknown) {
          call.filters[`${col}__in`] = val
          return chain
        },
        single: () => Promise.resolve({ data: { id: "m1" }, error: null }),
        maybeSingle: () => Promise.resolve({ data: { tokens_used: 0 }, error: null }),
        then(res: (v: unknown) => unknown) {
          return Promise.resolve(
            call.op === "count" ? { count: countValue, error: null } : { data: rows, error: null },
          ).then(res)
        },
      }
      return chain
    },
  }),
}))

beforeEach(() => {
  calls.length = 0
  countValue = 0
  rows = []
})

const find = (table: string, op: string) => calls.find((c) => c.table === table && c.op === op)

describe("the per-IP limits actually scope their queries", () => {
  it("counts conversations for THIS origin, inside the window", async () => {
    const { countRecentConversationsByIp } = await import("@/lib/db/chat")
    countValue = 3
    await expect(countRecentConversationsByIp("hash-abc", "2026-08-23T00:00:00Z")).resolves.toBe(3)

    const q = find("chat_conversations", "count")
    expect(q?.filters).toEqual({ ip_hash: "hash-abc", created_at__gte: "2026-08-23T00:00:00Z" })
  })

  it("counts messages only within this origin's conversations, inside the window", async () => {
    const { countRecentMessagesByIp } = await import("@/lib/db/chat")
    rows = [{ id: "c1" }, { id: "c2" }]
    countValue = 9
    await expect(countRecentMessagesByIp("hash-abc", "2026-08-23T00:00:00Z")).resolves.toBe(9)

    const lookup = find("chat_conversations", "select")
    expect(lookup?.filters).toEqual({ ip_hash: "hash-abc" })

    const q = find("chat_messages", "count")
    expect(q?.filters).toEqual({
      conversation_id__in: ["c1", "c2"],
      created_at__gte: "2026-08-23T00:00:00Z",
    })
  })

  it("asks for no messages at all when this origin has no conversations", async () => {
    const { countRecentMessagesByIp } = await import("@/lib/db/chat")
    rows = []
    await expect(countRecentMessagesByIp("hash-new", "2026-08-23T00:00:00Z")).resolves.toBe(0)
    expect(find("chat_messages", "count")).toBeUndefined()
  })
})

describe("the writes carry what the caps and the admin surface read", () => {
  it("markCaptured stamps captured_at and the contact", async () => {
    const { markCaptured } = await import("@/lib/db/chat")
    await markCaptured("conv-1", "contact-9")

    const w = find("chat_conversations", "update") as Call
    const payload = w.payload as Record<string, unknown>
    expect(payload.contact_id).toBe("contact-9")
    expect(payload.captured_at).toEqual(expect.any(String))
    expect(w.filters).toMatchObject({ id: "conv-1" })
  })

  it("appendMessage persists the verdict and the violations it was given", async () => {
    const { appendMessage } = await import("@/lib/db/chat")
    await appendMessage({
      conversationId: "conv-1",
      role: "assistant",
      content: "It is $250.",
      verdict: "blocked",
      violations: [{ rule: "ungrounded_price", found: "250" }],
      factSet: { groundedValues: ["79"] },
    })

    const w = find("chat_messages", "insert") as Call
    const payload = w.payload as Record<string, unknown>
    expect(payload.verdict).toBe("blocked")
    expect(payload.violations).toEqual([{ rule: "ungrounded_price", found: "250" }])
    expect(payload.fact_set).toEqual({ groundedValues: ["79"] })
  })
})
