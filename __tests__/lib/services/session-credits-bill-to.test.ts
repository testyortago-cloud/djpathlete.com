import { describe, it, expect } from "vitest"
import { buildPackageInsert } from "@/lib/services/session-credits"
import { sellPackSchema } from "@/lib/validators/session-packs"

const base = {
  clientUserId: "11111111-1111-4111-8111-111111111111",
  productId: null,
  sessionType: "1-on-1",
  credits: 10,
  priceCents: 150000,
  validityDays: null,
  paymentMethod: "stripe" as const,
  createdBy: null,
  now: new Date("2026-07-29T00:00:00Z"),
}

describe("buildPackageInsert — bill_to_email", () => {
  it("carries an explicit address onto the row", () => {
    const row = buildPackageInsert({ ...base, billToEmail: "dad@example.com" })
    expect(row.bill_to_email).toBe("dad@example.com")
  })

  it("defaults to null so the payer/client resolution still applies", () => {
    expect(buildPackageInsert(base).bill_to_email).toBeNull()
  })

  it("never pre-stamps the emailed timestamp", () => {
    // A non-null value here would make the UI claim a link was sent that never was.
    expect(buildPackageInsert({ ...base, billToEmail: "dad@example.com" }).bill_to_emailed_at).toBeNull()
  })

  it("leaves the rest of the row untouched", () => {
    // Guards against the addressee leaking into who the pack belongs to.
    const row = buildPackageInsert({ ...base, billToEmail: "dad@example.com" })
    expect(row.client_user_id).toBe(base.clientUserId)
    expect(row.payment_status).toBe("pending")
  })
})

describe("sellPackSchema — billToEmail", () => {
  const valid = {
    clientUserId: base.clientUserId,
    paymentMethod: "stripe",
    productId: "22222222-2222-4222-8222-222222222222",
  }

  it("accepts a valid address", () => {
    expect(sellPackSchema.safeParse({ ...valid, billToEmail: "dad@example.com" }).success).toBe(true)
  })

  it("rejects a malformed address rather than pinning garbage into Stripe", () => {
    expect(sellPackSchema.safeParse({ ...valid, billToEmail: "not-an-email" }).success).toBe(false)
  })

  it("rejects an empty string — an unticked box must omit the field, not blank it", () => {
    expect(sellPackSchema.safeParse({ ...valid, billToEmail: "" }).success).toBe(false)
  })

  it("is optional", () => {
    expect(sellPackSchema.safeParse(valid).success).toBe(true)
  })
})
