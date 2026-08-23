// @vitest-environment node
//
// The chat assistant's retention window — the DAL and the route that drives it.
//
// A chat transcript is the most personal thing this subsystem keeps: free text
// a stranger typed into a public box, beside an `ip_hash` and a user agent.
// The whole promise here is a bound — "no conversation is kept more than N
// days after it started" — and a bound is only worth what its off-by-one
// cases are worth. So every assertion below names the exact column, the exact
// default and the exact number of rows, rather than checking that something
// happened: a test that only pins "a delete was issued" stays green for a job
// that deletes the wrong table on the wrong timestamp.
//
// NOTHING IS MOCKED BETWEEN THE ROUTE AND THE DELETE. The route tests below
// swap the Supabase client, not `pruneChatConversations`, so "the route prunes
// to the configured window" is asserted against the query that was actually
// built rather than against a spy that was called with a number. A spy proves
// the route can pass an argument; it cannot prove the argument reaches a
// `WHERE` clause.
import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

const DAY_MS = 24 * 60 * 60 * 1000

type DeleteCall = { table: string; options: unknown; filters: Array<[string, string, unknown]> }

let deleteCalls: DeleteCall[] = []
let touchedTables: string[] = []
let deleteResult: { count: number | null; error: { message: string } | null } = { count: 0, error: null }

/**
 * A Supabase double that RECORDS the query rather than answering a canned
 * result regardless of it. The bugs worth catching here — deleting
 * `chat_messages` instead of its parent, cutting on `last_activity_at`
 * instead of `created_at` — are all invisible to a mock that just resolves.
 */
function fakeSupabase() {
  return {
    from(table: string) {
      touchedTables.push(table)
      const call: DeleteCall = { table, options: undefined, filters: [] }
      const chain = {
        delete(options: unknown) {
          call.options = options
          deleteCalls.push(call)
          return chain
        },
        lt(column: string, value: unknown) {
          call.filters.push(["lt", column, value])
          return chain
        },
        then(resolve: (v: unknown) => unknown) {
          return Promise.resolve(deleteResult).then(resolve)
        },
      }
      return chain
    },
  }
}

/** The one cutoff assertion, in days rather than in "a timestamp came back". */
function cutoffDaysAgo(call: DeleteCall): number {
  const value = call.filters.find(([op]) => op === "lt")?.[2]
  return (Date.now() - Date.parse(String(value))) / DAY_MS
}

const h = vi.hoisted(() => ({
  isCronSkipped: vi.fn(),
  getSetting: vi.fn(),
  logCronStart: vi.fn(),
  logCronEnd: vi.fn(),
}))

vi.mock("@/lib/db/system-settings", () => ({ isCronSkipped: h.isCronSkipped, getSetting: h.getSetting }))
vi.mock("@/lib/db/cron-runs", () => ({ logCronStart: h.logCronStart, logCronEnd: h.logCronEnd }))
vi.mock("@/lib/supabase", () => ({ createServiceRoleClient: () => fakeSupabase() }))

beforeEach(() => {
  vi.resetAllMocks()
  deleteCalls = []
  touchedTables = []
  deleteResult = { count: 0, error: null }
  h.isCronSkipped.mockResolvedValue({ skipped: false })
  h.getSetting.mockImplementation(async (_key: string, fallback: unknown) => fallback)
  h.logCronStart.mockResolvedValue("run-1")
  h.logCronEnd.mockResolvedValue(undefined)
  process.env.INTERNAL_CRON_TOKEN = "shared-secret"
})

describe("pruneChatConversations", () => {
  it("deletes the CONVERSATION and lets the transcript go by cascade — it never touches chat_messages itself", async () => {
    const { pruneChatConversations } = await import("@/lib/db/chat-retention")

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await pruneChatConversations(fakeSupabase() as any, 90)

    expect(deleteCalls).toHaveLength(1)
    expect(deleteCalls[0].table).toBe("chat_conversations")
    // A second delete against the child table is a second chance to get the
    // cutoff wrong, and a window in which a conversation exists with its
    // transcript already gone. The FK (migration 00227) does it atomically.
    expect(touchedTables).toEqual(["chat_conversations"])
  })

  it("cuts on created_at, so nothing a visitor does can extend its own retention window", async () => {
    const { pruneChatConversations } = await import("@/lib/db/chat-retention")

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await pruneChatConversations(fakeSupabase() as any, 90)

    expect(deleteCalls[0].filters).toHaveLength(1)
    const [op, column] = deleteCalls[0].filters[0]
    expect(op).toBe("lt")
    // NOT `last_activity_at`: measuring from the last thing that happened lets
    // a conversation somebody keeps poking renew its own window forever, which
    // is the one property a retention window must not have.
    expect(column).toBe("created_at")
    // Asserted as a NUMBER OF DAYS AGO. A prune that passed `now` would delete
    // every conversation ever recorded and still satisfy a test that checked
    // only the type of the value.
    expect(cutoffDaysAgo(deleteCalls[0])).toBeCloseTo(90, 3)
  })

  it("honours the window it is given rather than a hardcoded one", async () => {
    const { pruneChatConversations } = await import("@/lib/db/chat-retention")

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await pruneChatConversations(fakeSupabase() as any, 7)

    expect(cutoffDaysAgo(deleteCalls[0])).toBeCloseTo(7, 3)
  })

  it("returns how many conversations it actually removed", async () => {
    const { pruneChatConversations } = await import("@/lib/db/chat-retention")
    deleteResult = { count: 17, error: null }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const removed = await pruneChatConversations(fakeSupabase() as any, 90)

    expect(removed).toBe(17)
    // `{ count: "exact" }` is what makes that number real rather than a guess
    // at what the filter probably matched.
    expect(deleteCalls[0].options).toEqual({ count: "exact" })
  })

  it("throws on a failed delete instead of reporting that nothing needed pruning", async () => {
    const { pruneChatConversations } = await import("@/lib/db/chat-retention")
    deleteResult = { count: null, error: { message: "permission denied for table chat_conversations" } }

    // "could not read" and "there was nothing" are different answers. A prune
    // that swallowed this would log a clean nightly success while the window
    // silently stopped being enforced.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    // A real `Error` carrying the database's own words: the caller writes
    // `err.message` into `cron_runs.details`, and `String(rawPostgrestObject)`
    // is the string "[object Object]" — a nightly failure nobody can diagnose.
    await expect(pruneChatConversations(fakeSupabase() as any, 90)).rejects.toThrow(
      "pruneChatConversations: permission denied for table chat_conversations",
    )
  })
})

async function callRoute({ bearer = "shared-secret" }: { bearer?: string } = {}) {
  const { POST } = await import("@/app/api/admin/internal/chat-retention/route")
  const req = new NextRequest("https://example.test/api/admin/internal/chat-retention", {
    method: "POST",
    headers: { authorization: bearer ? `Bearer ${bearer}` : "" },
    body: "{}",
  })
  return POST(req)
}

describe("POST /api/admin/internal/chat-retention", () => {
  it("deletes nothing for a caller without the internal token", async () => {
    const res = await callRoute({ bearer: "" })

    expect(res.status).toBe(401)
    expect(h.isCronSkipped).not.toHaveBeenCalled()
    expect(deleteCalls).toEqual([])
  })

  it("deletes nothing for a caller with the wrong token, and nothing when no token is configured at all", async () => {
    expect((await callRoute({ bearer: "wrong" })).status).toBe(401)

    delete process.env.INTERNAL_CRON_TOKEN
    expect((await callRoute({ bearer: "shared-secret" })).status).toBe(401)
    expect(deleteCalls).toEqual([])
  })

  it("ships OFF — a destructive job does not switch itself on the day the code lands", async () => {
    await callRoute()

    // The literal key and the literal default, not a constant: the key is a
    // `system_settings` row that exists in a database, so renaming a constant
    // must break a test rather than quietly start reading a row nobody wrote.
    expect(h.isCronSkipped).toHaveBeenCalledWith({
      enabledKey: "cron_chat_retention_enabled",
      defaultEnabled: false,
    })
  })

  it("keeps a transcript 90 days unless a settings row says otherwise", async () => {
    await callRoute()

    expect(h.getSetting).toHaveBeenCalledWith("chat_retention_days", 90)
    // …and 90 is what reached the WHERE clause, not just what reached the call.
    expect(cutoffDaysAgo(deleteCalls[0])).toBeCloseTo(90, 3)
  })

  it("prunes to the configured window when a settings row does say otherwise", async () => {
    h.getSetting.mockResolvedValue(30)

    await callRoute()

    expect(cutoffDaysAgo(deleteCalls[0])).toBeCloseTo(30, 3)
  })

  it("deletes nothing while the flag is off", async () => {
    h.isCronSkipped.mockResolvedValue({ skipped: true, reason: "disabled" })

    const res = await callRoute()

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ skipped: "disabled" })
    expect(deleteCalls).toEqual([])
    // No run was started, so nothing is left hanging in `cron_runs` either.
    expect(h.logCronStart).not.toHaveBeenCalled()
  })

  it("reports the count it deleted and closes the cron_runs row", async () => {
    deleteResult = { count: 12, error: null }

    const res = await callRoute()

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, deleted: 12, days: 90 })
    expect(h.logCronEnd).toHaveBeenCalledWith(expect.anything(), "run-1", "success", { deleted: 12, days: 90 })
  })

  it("records a failed prune as failed rather than closing the run as a success", async () => {
    deleteResult = { count: null, error: { message: "permission denied for table chat_conversations" } }

    const res = await callRoute()

    expect(res.status).toBe(500)
    expect(h.logCronEnd).toHaveBeenCalledWith(expect.anything(), "run-1", "failed", {
      message: "pruneChatConversations: permission denied for table chat_conversations",
    })
    // A retention job that reported success while pruning nothing is how a
    // window stops being enforced without anybody noticing for a quarter.
    expect(h.logCronEnd).not.toHaveBeenCalledWith(expect.anything(), "run-1", "success", expect.anything())
  })
})

describe("the retention window is validated, because it is hand-typed", () => {
  // chat_retention_days has no admin UI writer that constrains it, so the value
  // arrives as raw jsonb from a row a person edited. Deleting everything
  // because someone typed 0 is not a retention policy.
  it.each([
    [0, "zero would delete the conversation currently being had"],
    [-1, "negative puts the cutoff in the future"],
    ["90", "a string makes the arithmetic NaN and toISOString throw inside the cron"],
    [null, "an absent value must not read as 'delete everything'"],
    [Number.NaN, "NaN reaches toISOString as an invalid date"],
  ])("refuses %j — %s", async (days) => {
    const { pruneChatConversations } = await import("@/lib/db/chat-retention")
    const supabase = {
      from: () => {
        throw new Error("must not reach the database")
      },
    }
    await expect(pruneChatConversations(supabase as never, days as never)).rejects.toThrow(
      /chat_retention_days must be a number of at least 1/,
    )
  })

  it("still prunes on a sane window", async () => {
    const { pruneChatConversations } = await import("@/lib/db/chat-retention")
    const lt = vi.fn().mockResolvedValue({ count: 3, error: null })
    const supabase = { from: () => ({ delete: () => ({ lt }) }) }
    await expect(pruneChatConversations(supabase as never, 90)).resolves.toBe(3)
    expect(lt).toHaveBeenCalledTimes(1)
  })
})
