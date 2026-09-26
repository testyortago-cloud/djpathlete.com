// @vitest-environment node
//
// __tests__/lib/db/coach-scoped-reads.test.ts
//
// The two reads that had NO business predicate at all until 2026-09-04, and
// were safe only because nothing could reach them, plus a third (G35) that
// inherited the first one's hole through the public chat route:
//
//   lib/db/chat.ts          getConversation(id)
//   lib/db/pipeline.ts      readOpportunityForGrant(opportunityId)
//   lib/db/pipeline.ts      readContactIdentity(contactId)          (G35)
//
// Both took a UUID that arrives from a URL bar or a request body and returned
// whichever row carried it, in any tenant. `/admin/chat` and
// `/api/admin/pipeline` were unmapped in PATH_PERMISSIONS, so proxy.ts
// default-denied every staff member and only the operator — who is meant to see
// everything — could get there. Mapping those prefixes to a staff-grantable
// permission is what converts "unreachable" into "one guessed id away", which
// is why the scoping and the reachability had to land together.
//
// THE FAKE RECORDS ARGUMENTS AND THE TESTS ASSERT VALUES. An argument-blind
// Supabase mock let a wrong tenant pass 91/91 on an earlier branch: asserting
// that `.eq("business_id", …)` was CALLED is satisfied by passing the wrong id.
//
// BUSINESS below is deliberately NOT SINGLETON_BUSINESS_ID. Four tenancy
// assertions on the previous branch were vacuous because their "other business"
// fixture was the singleton, so code that had quietly kept scoping to the
// constant satisfied them.

import { beforeEach, describe, expect, it, vi } from "vitest"

type Op = [string, ...unknown[]]
const calls: { table: string; select: string; ops: Op[] }[] = []

let result: unknown = { data: null, error: null }

function makeBuilder(table: string, selectArgs: unknown[]) {
  const record = { table, select: String(selectArgs[0]), ops: [] as Op[] }
  calls.push(record)

  const builder: Record<string, unknown> = {}
  for (const method of ["eq", "order", "limit", "in", "not", "gte"]) {
    builder[method] = (...args: unknown[]) => {
      record.ops.push([method, ...args])
      return builder
    }
  }
  builder.maybeSingle = () => Promise.resolve(result)
  builder.single = () => Promise.resolve(result)
  builder.then = (resolve: (value: unknown) => void) => resolve(result)
  return builder
}

vi.mock("@/lib/supabase", () => ({
  createServiceRoleClient: () => ({
    from: (table: string) => ({ select: (...args: unknown[]) => makeBuilder(table, args) }),
  }),
}))

import { getConversation } from "@/lib/db/chat"
import { readContactIdentity, readOpportunityForGrant } from "@/lib/db/pipeline"
import { SINGLETON_BUSINESS_ID } from "@/lib/lead-engine/constants"

/** The coach's own tenant. Distinct from the singleton — see the header. */
const BUSINESS = "7c9e6679-7425-40de-944b-e07fc1f90ae7"
const SUBJECT_ID = "3f2504e0-4f89-11d3-9a0c-0305e82c3301"

const eqOps = (record: (typeof calls)[number]) => record.ops.filter(([m]) => m === "eq")
const eqValue = (record: (typeof calls)[number], column: string) =>
  eqOps(record).find(([, col]) => col === column)?.[2]

beforeEach(() => {
  calls.length = 0
  result = { data: null, error: null }
})

describe("getConversation", () => {
  it("fences the read to the business it was given", () => {
    // MUTANT: dropping `.eq("business_id", businessId)`. A coach opening
    // /admin/chat/<someone else's uuid> reads another tenant's website-visitor
    // transcript — visitor-typed prose containing names, injuries and phone
    // numbers, which is why the page audits itself as admin_read_sensitive.
    return getConversation(SUBJECT_ID, BUSINESS).then(() => {
      const record = calls.find((c) => c.table === "chat_conversations")
      expect(record).toBeDefined()
      // The VALUE, not merely that a business_id filter exists.
      expect(eqValue(record!, "business_id")).toBe(BUSINESS)
      expect(eqValue(record!, "id")).toBe(SUBJECT_ID)
    })
  })

  it("does not silently scope to the singleton instead", () => {
    // MUTANT: `.eq("business_id", SINGLETON_BUSINESS_ID)`. This is the exact
    // shape the four vacuous assertions on the previous branch could not see.
    return getConversation(SUBJECT_ID, BUSINESS).then(() => {
      const record = calls.find((c) => c.table === "chat_conversations")!
      expect(eqValue(record, "business_id")).not.toBe(SINGLETON_BUSINESS_ID)
    })
  })

  it("applies the predicate UNCONDITIONALLY — an empty tenant matches nothing, never everything (G35)", () => {
    // RETARGETED, not deleted. This used to pin the opposite: that omitting
    // the business left the read unscoped for the public /api/ask paths, which
    // then had no tenant to give. Since the Host boundary (phase 4) they do,
    // and G35 made the argument required. What is worth pinning now is the
    // SHAPE that made it optional. MUTANT: `if (businessId) query =
    // query.eq("business_id", businessId)`. The type system stops `undefined`.
    // It does not stop an empty string from a caller whose own resolution came
    // back blank, and under the mutant that reads EVERY business's
    // conversation. Here it is filtered like any other value.
    return getConversation(SUBJECT_ID, "").then(() => {
      const record = calls.find((c) => c.table === "chat_conversations")!
      expect(eqOps(record).map(([, col]) => col)).toEqual(["id", "business_id"])
      expect(eqValue(record, "business_id")).toBe("")
    })
  })

  it("propagates a read error rather than reporting an absent row", () => {
    // `null` and a failed read are different answers: the caller 404s on null.
    // Swallowing the error would turn an outage into "no such conversation".
    result = { data: null, error: { code: "PGRST301", message: "boom" } }
    return expect(getConversation(SUBJECT_ID, BUSINESS)).rejects.toBeTruthy()
  })
})

describe("readOpportunityForGrant", () => {
  it("fences the read to the business it was given", () => {
    // MUTANT: dropping the predicate. This one is the highest-consequence of
    // the four — the caller grants a program off the row this returns, which
    // assigns a program, can create an account and sends email. Unscoped, a
    // coach grants against another coach's won opportunity.
    return readOpportunityForGrant(SUBJECT_ID, BUSINESS).then(() => {
      const record = calls.find((c) => c.table === "opportunities")
      expect(record).toBeDefined()
      expect(eqValue(record!, "business_id")).toBe(BUSINESS)
      expect(eqValue(record!, "id")).toBe(SUBJECT_ID)
    })
  })

  it("does not silently scope to the singleton instead", () => {
    return readOpportunityForGrant(SUBJECT_ID, BUSINESS).then(() => {
      const record = calls.find((c) => c.table === "opportunities")!
      expect(eqValue(record, "business_id")).not.toBe(SINGLETON_BUSINESS_ID)
    })
  })

  it("still throws on a read failure rather than reading as a refusal", () => {
    // The function's own comment: a read that fails is NOT "no such card".
    // Returning null here would let the caller treat an outage as a refusal
    // and, worse, a retry as a fresh grant.
    result = { data: null, error: { code: "PGRST301", message: "boom" } }
    return expect(readOpportunityForGrant(SUBJECT_ID, BUSINESS)).rejects.toBeTruthy()
  })
})

describe("readContactIdentity (G35)", () => {
  it("fences the read to the business it was given", () => {
    // MUTANT: dropping `.eq("business_id", businessId)`. Both callers hold a
    // contact id taken off another row (a chat conversation, a won
    // opportunity). The chat's conversation read had no predicate until G35,
    // and this read inherited that hole silently. The predicate makes "this
    // contact is that business's" true here, not only in the caller.
    return readContactIdentity(BUSINESS, SUBJECT_ID).then(() => {
      const record = calls.find((c) => c.table === "contacts")
      expect(record).toBeDefined()
      expect(eqValue(record!, "business_id")).toBe(BUSINESS)
      expect(eqValue(record!, "id")).toBe(SUBJECT_ID)
    })
  })

  it("does not silently scope to the singleton instead", () => {
    return readContactIdentity(BUSINESS, SUBJECT_ID).then(() => {
      const record = calls.find((c) => c.table === "contacts")!
      expect(eqValue(record, "business_id")).not.toBe(SINGLETON_BUSINESS_ID)
    })
  })

  it("returns the name and email it found — the presence control", async () => {
    result = { data: { email: "athlete@example.test", name: "Sam" }, error: null }
    await expect(readContactIdentity(BUSINESS, SUBJECT_ID)).resolves.toEqual({
      email: "athlete@example.test",
      name: "Sam",
    })
  })

  it("answers null for no row, and throws on a failed read rather than reading as 'no contact'", async () => {
    await expect(readContactIdentity(BUSINESS, SUBJECT_ID)).resolves.toBeNull()
    result = { data: null, error: { code: "PGRST301", message: "boom" } }
    await expect(readContactIdentity(BUSINESS, SUBJECT_ID)).rejects.toThrow(/contacts read failed/)
  })
})
