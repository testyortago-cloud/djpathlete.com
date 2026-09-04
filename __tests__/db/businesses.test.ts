// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest"

/**
 * The mock RECORDS its arguments. An argument-blind chain would accept
 * `.eq("business_id", <wrong value>)` and report green -- phase 0 left 91/91
 * passing that way. Every assertion below names the VALUE, so mutating the
 * value (not the arity) is what proves the test.
 */
const calls: { rpc: Array<[string, Record<string, unknown>]>; eq: Array<[string, unknown]> } = {
  rpc: [],
  eq: [],
}
let rpcResult: { data: unknown; error: unknown } = { data: null, error: null }
let selectResult: { data: unknown; error: unknown } = { data: null, error: null }

vi.mock("@/lib/supabase", () => ({
  createServiceRoleClient: () => ({
    rpc: (name: string, args: Record<string, unknown>) => {
      calls.rpc.push([name, args])
      return Promise.resolve(rpcResult)
    },
    from: () => {
      const chain: Record<string, unknown> = {}
      const self = () => chain
      chain.select = self
      chain.order = self
      chain.update = self
      chain.eq = (col: string, val: unknown) => {
        calls.eq.push([col, val])
        return chain
      }
      chain.single = () => Promise.resolve(selectResult)
      chain.maybeSingle = () => Promise.resolve(selectResult)
      chain.then = (res: (v: unknown) => unknown) => Promise.resolve(selectResult).then(res)
      return chain
    },
  }),
}))

import { createBusiness, listBusinesses, updateBusiness, SlugTakenError, getBusinessBySmsNumber } from "@/lib/db/businesses"

const ROW = {
  id: "b1",
  name: "Coach Two",
  slug: "coach-two",
  status: "active",
  booking_provider: "calendly",
  created_by: "u1",
  created_at: "2026-09-03T00:00:00Z",
}

beforeEach(() => {
  calls.rpc = []
  calls.eq = []
  rpcResult = { data: null, error: null }
  selectResult = { data: null, error: null }
})

describe("createBusiness", () => {
  it("calls create_business with the lowercased, trimmed slug and the creator", async () => {
    rpcResult = { data: ROW, error: null }
    const out = await createBusiness({
      name: "  Coach Two  ",
      slug: "  Coach-Two  ",
      timezone: "America/Chicago",
      hostDisplayName: "Coach Two",
      hostEmail: "two@example.com",
      createdBy: "u1",
    })
    expect(out.id).toBe("b1")
    expect(calls.rpc).toHaveLength(1)
    const [name, args] = calls.rpc[0]
    expect(name).toBe("create_business")
    // The VALUES, not merely the keys.
    expect(args.p_slug).toBe("coach-two")
    expect(args.p_name).toBe("Coach Two")
    expect(args.p_timezone).toBe("America/Chicago")
    expect(args.p_created_by).toBe("u1")
  })

  it("maps 23505 to SlugTakenError rather than a raw throw", async () => {
    rpcResult = { data: null, error: { code: "23505", message: "duplicate key" } }
    await expect(
      createBusiness({
        name: "Dupe",
        slug: "primary",
        timezone: "UTC",
        hostDisplayName: "H",
        hostEmail: "",
        createdBy: "u1",
      }),
    ).rejects.toBeInstanceOf(SlugTakenError)
  })

  it("throws on any other rpc error instead of returning a partial business", async () => {
    rpcResult = { data: null, error: { code: "42883", message: "function does not exist" } }
    await expect(
      createBusiness({
        name: "X",
        slug: "x-co",
        timezone: "UTC",
        hostDisplayName: "H",
        hostEmail: "",
        createdBy: null,
      }),
    ).rejects.toThrow(/42883|function does not exist/)
  })

  it("throws when the rpc reports no error but returns no row", async () => {
    // PostgREST RESOLVES rather than throwing. A null row with a null error is
    // a real possible answer and must not be returned as a Business.
    rpcResult = { data: null, error: null }
    await expect(
      createBusiness({
        name: "X",
        slug: "x-co",
        timezone: "UTC",
        hostDisplayName: "H",
        hostEmail: "",
        createdBy: null,
      }),
    ).rejects.toThrow(/returned no row/i)
  })
})

describe("listBusinesses", () => {
  it("filters on status=active by default and does not when asked for all", async () => {
    selectResult = { data: [ROW], error: null }
    await listBusinesses()
    expect(calls.eq).toEqual([["status", "active"]])

    calls.eq = []
    await listBusinesses({ activeOnly: false })
    expect(calls.eq).toEqual([])
  })

  it("throws on a read error instead of reporting an empty list", async () => {
    selectResult = { data: null, error: { code: "42P01", message: "no such table" } }
    await expect(listBusinesses()).rejects.toThrow(/42P01|no such table/)
  })
})

describe("updateBusiness", () => {
  it("scopes the update to the id it was given", async () => {
    selectResult = { data: ROW, error: null }
    await updateBusiness("b1", { name: "Renamed" })
    expect(calls.eq).toEqual([["id", "b1"]])
  })
})

// The To number is the ONLY tenant evidence an inbound SMS carries. These
// pin the DAL function directly: the query it builds, and the two ways an
// unmatched number must NOT be confused with an error.
describe("getBusinessBySmsNumber", () => {
  it("resolves the business_id for a matching sms_sender_phone", async () => {
    selectResult = { data: { business_id: "bbb" }, error: null }
    const result = await getBusinessBySmsNumber("+15550001111")
    expect(result).toBe("bbb")
    expect(calls.eq).toEqual([["sms_sender_phone", "+15550001111"]])
  })

  it("returns null when no business claims the number (the ordinary case today)", async () => {
    selectResult = { data: null, error: null }
    const result = await getBusinessBySmsNumber("+15559999999")
    expect(result).toBeNull()
  })

  // sms_sender_phone is NOT NULL DEFAULT '', so a query for '' would match
  // every business that has not configured a number -- the single worst
  // possible outcome (every unconfigured business's SMS routes to whichever
  // one the query happens to return first).
  it("does NOT query an empty To number", async () => {
    const result = await getBusinessBySmsNumber("")
    expect(result).toBeNull()
    expect(calls.eq).toEqual([])
  })

  it("does not query a To number that is only whitespace either", async () => {
    const result = await getBusinessBySmsNumber("   ")
    expect(result).toBeNull()
    expect(calls.eq).toEqual([])
  })

  // PostgREST resolves rather than throwing: {data: null, error} for a
  // genuine read failure looks identical in shape to {data: null, error:
  // null} for "nobody configured this number" unless the error is checked.
  // Fix round 1, Important 1: a failed read must NOT read as "no business
  // claims this number" -- that would fall back to the platform business and
  // route a coach's STOP to the WRONG tenant (their own sequences keep
  // texting someone who just opted out). THROW instead, matching the route's
  // own stated rule 100 lines away ("a settings read that fails is an infra
  // fault, and a 500 there is the correct, retryable answer"): Twilio retries
  // on 500, so throwing is the fail-safe direction. Only a genuine miss
  // (error: null, data: null) returns null.
  it("throws on a read error, rather than silently matching the no-business-claims-it case", async () => {
    selectResult = { data: null, error: { code: "42501", message: "permission denied" } }
    await expect(getBusinessBySmsNumber("+15550001111")).rejects.toThrow(/42501|permission denied/)
  })
})
