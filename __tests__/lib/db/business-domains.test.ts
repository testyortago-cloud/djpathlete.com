// @vitest-environment node
//
// business_domains has had ZERO readers since migration 00240; this is the
// first. Two claims are pinned that a "convenient" implementation gets wrong:
// the lookup is by the EXACT host it was handed (no lowercasing here — the
// boundary normalises), and a failed read THROWS. Returning null on a failed
// read would make "could not look" indistinguishable from "nobody owns this
// host", and lib/tenancy/public.ts would then serve the platform silently
// for what is really an outage. null and [] are different answers.
import { describe, it, expect, vi, beforeEach } from "vitest"

const state = {
  result: { data: null as unknown, error: null as null | { code: string; message: string } },
  calls: [] as Array<[string, string]>,
}

vi.mock("@/lib/supabase", () => ({
  createServiceRoleClient: () => ({
    from: (table: string) => {
      state.calls.push(["from", table])
      const builder = {
        select: (cols: string) => {
          state.calls.push(["select", cols])
          return builder
        },
        eq: (col: string, val: unknown) => {
          state.calls.push(["eq", `${col}=${String(val)}`])
          return builder
        },
        maybeSingle: async () => state.result,
      }
      return builder
    },
  }),
}))

import { findBusinessIdByHost, BusinessDomainReadError } from "@/lib/db/business-domains"

beforeEach(() => {
  state.calls.length = 0
  state.result = { data: null, error: null }
})

describe("findBusinessIdByHost", () => {
  it("reads business_domains by the EXACT host it was given and returns that row's business", async () => {
    state.result = { data: { business_id: "biz-42" }, error: null }
    await expect(findBusinessIdByHost("coach.example.com")).resolves.toBe("biz-42")
    expect(state.calls).toEqual([
      ["from", "business_domains"],
      ["select", "business_id"],
      ["eq", "host=coach.example.com"],
    ])
  })

  it("does not lowercase on the way in — normalisation is the boundary's job, and a wrong-case host finds nothing", async () => {
    await findBusinessIdByHost("Coach.Example.COM")
    expect(state.calls).toContainEqual(["eq", "host=Coach.Example.COM"])
  })

  it("returns null when no row claims the host", async () => {
    await expect(findBusinessIdByHost("nobody.test")).resolves.toBeNull()
  })

  it("THROWS on a failed read, carrying PostgREST's code — null is reserved for 'no row'", async () => {
    state.result = { data: null, error: { code: "PGRST205", message: "Could not find the table 'public.business_domains'" } }
    const attempt = findBusinessIdByHost("x.test")
    await expect(attempt).rejects.toBeInstanceOf(BusinessDomainReadError)
    await expect(findBusinessIdByHost("x.test")).rejects.toMatchObject({ code: "PGRST205" })
    // The message names the code and the reason: a raw PostgREST object logs as [object Object].
    await expect(findBusinessIdByHost("x.test")).rejects.toThrow(/PGRST205.*Could not find the table/)
  })
})
