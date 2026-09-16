import { describe, it, expect, vi, beforeEach } from "vitest"

// countRenewalsAwaitingPayment is the watch that catches a renewal which
// resolved into "a human has to collect this" and then went quiet. The cron
// route mocks it away wholesale, so its predicates — which are the entire
// behaviour — are pinned here or nowhere.

type Recorded = { table: string; in: Record<string, unknown>; eq: Record<string, unknown>; not: unknown[][] }

let recorded: Recorded[] = []
let attemptRows: Array<{ new_package_id: string }> = []
let packCount = 0

function builder(table: string) {
  const rec: Recorded = { table, in: {}, eq: {}, not: [] }
  recorded.push(rec)
  const result =
    table === "pack_renewal_attempts" ? { data: attemptRows, error: null } : { count: packCount, error: null }
  const self: Record<string, unknown> = {
    select: () => self,
    in: (col: string, vals: unknown) => {
      rec.in[col] = vals
      return self
    },
    eq: (col: string, val: unknown) => {
      rec.eq[col] = val
      return self
    },
    not: (...args: unknown[]) => {
      rec.not.push(args)
      return self
    },
    // Every step is thenable so the assertion never depends on which call
    // happens to be last — a chain reorder is a refactor, not a behaviour change.
    then: (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve),
  }
  return self
}

vi.mock("@/lib/supabase", () => ({
  createServiceRoleClient: () => ({ from: (table: string) => builder(table) }),
}))

async function run() {
  const { countRenewalsAwaitingPayment } = await import("@/lib/db/pack-renewal-attempts")
  return countRenewalsAwaitingPayment()
}

beforeEach(() => {
  vi.clearAllMocks()
  recorded = []
  attemptRows = []
  packCount = 0
})

describe("countRenewalsAwaitingPayment", () => {
  it("counts only attempts that resolved to skipped or failed", async () => {
    attemptRows = [{ new_package_id: "pack-1" }]
    packCount = 1
    await run()
    // `pending` must NOT be here: those are attempts still in flight, which
    // countStalePendingRenewalAttempts already watches on a timer. Counting
    // them here would double-alert every renewal during its normal lifetime.
    expect(recorded[0].table).toBe("pack_renewal_attempts")
    expect(recorded[0].in.status).toEqual(["skipped", "failed"])
  })

  it("requires the replacement pack to be BOTH unpaid and still active", async () => {
    attemptRows = [{ new_package_id: "pack-1" }]
    packCount = 1
    await run()
    const packs = recorded.find((r) => r.table === "client_packages")!
    // Two conjuncts, two separate reasons to drop out of the count: paying the
    // link flips payment_status, and voiding the pack moves status off active.
    // Dropping either one turns a self-clearing alert into a permanent nag.
    expect(packs.eq.payment_status).toBe("pending")
    expect(packs.eq.status).toBe("active")
    expect(packs.in.id).toEqual(["pack-1"])
  })

  it("returns zero without touching client_packages when no attempt resolved that way", async () => {
    attemptRows = []
    packCount = 99
    expect(await run()).toBe(0)
    // Guarding on the empty list is not just an optimisation: `.in("id", [])`
    // is a query whose result nothing should depend on, and packCount here is
    // deliberately 99 so falling through would be loudly wrong rather than
    // accidentally right.
    expect(recorded.some((r) => r.table === "client_packages")).toBe(false)
  })

  it("returns zero once every fallback pack has been paid", async () => {
    attemptRows = [{ new_package_id: "pack-1" }, { new_package_id: "pack-2" }]
    packCount = 0
    // The self-clearing claim, pinned. Attempts are never cleaned up, so the
    // first list keeps growing forever; only the second query decides. An
    // implementation that fell back to the attempt count when the pack query
    // said zero would alert every day for the rest of the product's life,
    // about renewals that were settled months ago.
    expect(await run()).toBe(0)
  })

  it("returns the count of packages still awaiting payment", async () => {
    attemptRows = [{ new_package_id: "pack-1" }, { new_package_id: "pack-2" }]
    packCount = 1
    // Two fallbacks, one already paid — the answer is what is still OWED, not
    // how many renewals ever fell back.
    expect(await run()).toBe(1)
  })
})
