// @vitest-environment node
//
// findAttributionForContact replaces findAttributionByEmail. The old function
// joined marketing_attribution -> users!inner(email), so it only ever matched
// a row already CLAIMED by a registered user whose email happened to match —
// which, per marketing-attribution-claim.test.ts's own header, was silently
// dead in production (242 gclid rows, zero with user_id). Keying on user_id
// directly removes that join AND the cross-tenant path an email lookup would
// reopen once two coaches can share a lead: a click id captured on coach A's
// funnel must never attach to coach B's contact just because a shared lead
// typed the same email address into both.
//
// Tenant safety here is NOT a business_id column (marketing_attribution has
// none, and can't get one honestly until proxy.ts resolves a tenant in phase
// 4 — see findAttributionForContact's own docstring). It comes from HOW the
// caller obtained the userId: from a contact record scoped to its own
// business. This suite only pins what the DAL function itself does with the
// userId it's handed.
import { beforeEach, describe, expect, it, vi } from "vitest"

type Op = [string, ...unknown[]]

const calls: { selectArgs: unknown[]; ops: Op[] }[] = []

/**
 * Minimal chainable PostgREST double, same shape as
 * __tests__/lib/db/contacts-list.test.ts's `makeBuilder` — records every
 * `.eq()`/`.gte()`/`.order()`/`.limit()` call so the test can assert on the
 * VALUE passed, not merely that "some eq call" happened.
 */
function makeBuilder(selectArgs: unknown[]) {
  const record = { selectArgs, ops: [] as Op[] }
  calls.push(record)
  const builder: Record<string, unknown> = {}
  for (const method of ["eq", "gte", "order", "limit"]) {
    builder[method] = (...args: unknown[]) => {
      record.ops.push([method, ...args])
      return builder
    }
  }
  builder.maybeSingle = () => Promise.resolve(result)
  return builder
}

let result: { data: unknown; error: unknown } = { data: null, error: null }

vi.mock("@/lib/supabase", () => ({
  createServiceRoleClient: () => ({
    from: () => ({
      select: (...args: unknown[]) => makeBuilder(args),
    }),
  }),
}))

import { findAttributionForContact } from "@/lib/db/marketing-attribution"

beforeEach(() => {
  calls.length = 0
  result = { data: null, error: null }
})

describe("findAttributionForContact", () => {
  // MUTATION 1 target: change `.eq("user_id", args.userId)` to a literal and
  // this must fail on the VALUE ("u9" vs whatever literal), not merely on an
  // eq call having happened at all.
  it("keys the lookup on the caller's own user_id, and drops the cross-tenant users!inner join", async () => {
    await findAttributionForContact({ userId: "u9" })
    expect(calls).toHaveLength(1)
    expect(calls[0].ops).toContainEqual(["eq", "user_id", "u9"])
    expect(String(calls[0].selectArgs[0])).not.toMatch(/users!inner/)
  })

  // MUTATION 2 target: drop the `.gte("first_seen_at", since)` call entirely
  // and this must fail — there is no gte op left to find.
  it("keeps the 30-day window by default", async () => {
    const before = Date.now()
    await findAttributionForContact({ userId: "u9" })
    const gte = calls[0].ops.find(([method]) => method === "gte")
    expect(gte?.[1]).toBe("first_seen_at")
    const sinceMs = new Date(gte?.[2] as string).getTime()
    // since = now - 30 days, computed inside the function; allow generous
    // slack for CI scheduling jitter rather than pinning an exact instant.
    const expectedMs = before - 30 * 86_400_000
    expect(Math.abs(sinceMs - expectedMs)).toBeLessThan(10_000)
  })

  it("honours a caller-supplied withinDays window instead of the 30-day default", async () => {
    const before = Date.now()
    await findAttributionForContact({ userId: "u9", withinDays: 7 })
    const gte = calls[0].ops.find(([method]) => method === "gte")
    const sinceMs = new Date(gte?.[2] as string).getTime()
    const expectedMs = before - 7 * 86_400_000
    expect(Math.abs(sinceMs - expectedMs)).toBeLessThan(10_000)
  })

  it("returns null when no attribution row matches", async () => {
    result = { data: null, error: null }
    await expect(findAttributionForContact({ userId: "nobody" })).resolves.toBeNull()
  })

  // PostgREST RESOLVES, it does not throw — a failed read is not "no rows".
  it("throws on a read failure rather than treating it as no match", async () => {
    result = { data: null, error: { message: "connection reset" } }
    await expect(findAttributionForContact({ userId: "u9" })).rejects.toBeTruthy()
  })
})
