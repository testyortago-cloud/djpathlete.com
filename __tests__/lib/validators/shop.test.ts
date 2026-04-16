import { describe, it, expect } from "vitest"
import {
  shippingAddressSchema,
  cartItemSchema,
  checkoutRequestSchema,
  orderLookupSchema,
} from "@/lib/validators/shop"

describe("shippingAddressSchema", () => {
  const valid = {
    name: "Jane Doe",
    email: "jane@example.com",
    phone: "+15555551234",
    line1: "123 Main St",
    line2: null,
    city: "Austin",
    state: "TX",
    country: "US",
    postal_code: "78701",
  }

  it("accepts valid address", () => {
    expect(shippingAddressSchema.safeParse(valid).success).toBe(true)
  })

  it("rejects invalid email", () => {
    const r = shippingAddressSchema.safeParse({ ...valid, email: "not-an-email" })
    expect(r.success).toBe(false)
  })

  it("requires country as 2-letter code", () => {
    const r = shippingAddressSchema.safeParse({ ...valid, country: "USA" })
    expect(r.success).toBe(false)
  })

  it("allows nullable phone and line2", () => {
    const r = shippingAddressSchema.safeParse({ ...valid, phone: null, line2: null })
    expect(r.success).toBe(true)
  })
})

describe("cartItemSchema", () => {
  it("requires positive quantity", () => {
    const r = cartItemSchema.safeParse({
      variant_id: "a7f0a5c3-0000-4000-8000-000000000000",
      quantity: 0,
    })
    expect(r.success).toBe(false)
  })

  it("caps quantity at 99", () => {
    const r = cartItemSchema.safeParse({
      variant_id: "a7f0a5c3-0000-4000-8000-000000000000",
      quantity: 100,
    })
    expect(r.success).toBe(false)
  })
})

describe("checkoutRequestSchema", () => {
  it("requires at least one item", () => {
    const r = checkoutRequestSchema.safeParse({
      items: [],
      address: {
        name: "J",
        email: "j@x.co",
        phone: null,
        line1: "1 A St",
        line2: null,
        city: "A",
        state: "TX",
        country: "US",
        postal_code: "78701",
      },
      shipping_cents: 0,
    })
    expect(r.success).toBe(false)
  })
})

describe("orderLookupSchema", () => {
  it("requires email", () => {
    expect(orderLookupSchema.safeParse({}).success).toBe(false)
  })
})
