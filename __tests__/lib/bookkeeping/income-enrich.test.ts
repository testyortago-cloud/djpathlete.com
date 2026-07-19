import { describe, it, expect } from "vitest"
import { collectEnrichmentIds, fullName, stampIncomeEnrichment } from "@/lib/bookkeeping/income-enrich"
import type { IncomeSourceRows } from "@/lib/bookkeeping/types"

const U1 = "11111111-1111-4111-8111-111111111111"
const U2 = "22222222-2222-4222-8222-222222222222"
const PR = "33333333-3333-4333-8333-333333333333"

function sources(over: Partial<IncomeSourceRows> = {}): IncomeSourceRows {
  return { payments: [], shopOrders: [], clientPackages: [], eventSignups: [], memberships: [], ...over } as IncomeSourceRows
}

describe("collectEnrichmentIds", () => {
  it("collects distinct user ids from payments + packages and uuid programIds from metadata", () => {
    const s = sources({
      payments: [
        { user_id: U1, metadata: { programId: PR } },
        { user_id: U1, metadata: { programId: "not-a-uuid" } },
        { user_id: null, metadata: null },
      ] as never,
      clientPackages: [{ client_user_id: U2 }, { client_user_id: null }] as never,
    })
    const ids = collectEnrichmentIds(s)
    expect(ids.userIds.sort()).toEqual([U1, U2].sort())
    expect(ids.programIds).toEqual([PR])
  })
})

describe("fullName", () => {
  it("joins and trims, null on blank or missing", () => {
    expect(fullName({ first_name: "Mila", last_name: "Rukosuev", email: null })).toBe("Mila Rukosuev")
    expect(fullName({ first_name: "  ", last_name: null, email: "x@y.z" })).toBeNull()
    expect(fullName(undefined)).toBeNull()
  })
})

describe("stampIncomeEnrichment", () => {
  it("stamps payer/program/client fields; misses become null; other members untouched", () => {
    const s = sources({
      payments: [{ id: "p1", user_id: U1, metadata: { programId: PR } }, { id: "p2", user_id: null, metadata: {} }] as never,
      clientPackages: [{ id: "c1", client_user_id: U2 }, { id: "c2", client_user_id: null }] as never,
      shopOrders: [{ id: "o1" }] as never,
    })
    const out = stampIncomeEnrichment(
      s,
      new Map([
        [U1, { first_name: "Cannon", last_name: "Kremer", email: "ck@x.com" }],
        [U2, { first_name: "Sandeep", last_name: "Chennadi", email: "sc@x.com" }],
      ]),
      new Map([[PR, "Cannon Baller!"]]),
    )
    expect(out.payments[0]).toMatchObject({ payer_name: "Cannon Kremer", payer_email: "ck@x.com", program_name: "Cannon Baller!" })
    expect(out.payments[1]).toMatchObject({ payer_name: null, payer_email: null, program_name: null })
    expect(out.clientPackages[0]).toMatchObject({ client_name: "Sandeep Chennadi" })
    expect(out.clientPackages[1]).toMatchObject({ client_name: null })
    expect(out.shopOrders).toBe(s.shopOrders)
  })
})
