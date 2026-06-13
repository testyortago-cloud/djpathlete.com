import { describe, it, expect } from "vitest"
import { randomUUID } from "crypto"
import { sellPackSchema, checkinSchema, packProductSchema, voidCheckinSchema } from "@/lib/validators/session-packs"

describe("sellPackSchema", () => {
  it("accepts a catalogue purchase", () => {
    expect(
      sellPackSchema.safeParse({ clientUserId: randomUUID(), productId: randomUUID(), paymentMethod: "stripe" }).success,
    ).toBe(true)
  })
  it("accepts an ad-hoc pack", () => {
    const r = sellPackSchema.safeParse({
      clientUserId: randomUUID(),
      adhoc: { sessionType: "1-on-1", credits: 10, priceCents: 50000, validityDays: 90 },
      paymentMethod: "cash",
    })
    expect(r.success).toBe(true)
  })
  it("rejects when neither productId nor adhoc given", () => {
    expect(sellPackSchema.safeParse({ clientUserId: randomUUID(), paymentMethod: "stripe" }).success).toBe(false)
  })
  it("rejects a non-uuid client id", () => {
    expect(sellPackSchema.safeParse({ clientUserId: "nope", productId: randomUUID(), paymentMethod: "stripe" }).success).toBe(false)
  })
})

describe("packProductSchema", () => {
  it("rejects zero credits", () => {
    expect(packProductSchema.safeParse({ name: "x", sessionType: "1-on-1", credits: 0, priceCents: 100 }).success).toBe(false)
  })
  it("accepts a drop-in (1 credit)", () => {
    expect(packProductSchema.safeParse({ name: "Drop-in", sessionType: "1-on-1", credits: 1, priceCents: 6000 }).success).toBe(true)
  })
})

describe("checkinSchema", () => {
  it("accepts a client id + token", () => {
    expect(checkinSchema.safeParse({ clientUserId: randomUUID(), token: "abc.def" }).success).toBe(true)
  })
  it("rejects an empty token", () => {
    expect(checkinSchema.safeParse({ clientUserId: randomUUID(), token: "" }).success).toBe(false)
  })
})

describe("voidCheckinSchema", () => {
  it("accepts a checkin id", () => {
    expect(voidCheckinSchema.safeParse({ checkinId: randomUUID(), reason: "mistake" }).success).toBe(true)
  })
})
