import { describe, expect, it } from "vitest"
import {
  affiliateProductInputSchema,
  digitalProductInputSchema,
  leadFormSchema,
  downloadSignRequestSchema,
} from "@/lib/validators/shop-phase2"

describe("affiliateProductInputSchema", () => {
  const base = {
    name: "Amazon Protein Powder",
    slug: "amazon-protein-powder",
    description: "<p>Great protein</p>",
    affiliate_url: "https://www.amazon.com/dp/B01N5IB20Q",
    thumbnail_url: "https://example.com/img.jpg",
  }

  it("accepts a valid amazon URL", () => {
    const r = affiliateProductInputSchema.safeParse(base)
    expect(r.success).toBe(true)
  })

  it("rejects a non-amazon host", () => {
    const r = affiliateProductInputSchema.safeParse({
      ...base,
      affiliate_url: "https://walmart.com/item/123",
    })
    expect(r.success).toBe(false)
  })

  it("accepts optional asin + price", () => {
    const r = affiliateProductInputSchema.safeParse({
      ...base,
      affiliate_asin: "B01N5IB20Q",
      affiliate_price_cents: 2499,
    })
    expect(r.success).toBe(true)
  })
})

describe("digitalProductInputSchema", () => {
  const paid = {
    name: "Comeback Code",
    slug: "comeback-code",
    description: "<p>12-week return to training</p>",
    digital_is_free: false,
    retail_price_cents: 4900,
    digital_signed_url_ttl_seconds: 900,
  }

  it("accepts a valid paid product", () => {
    expect(digitalProductInputSchema.safeParse(paid).success).toBe(true)
  })

  it("rejects paid product without price", () => {
    const r = digitalProductInputSchema.safeParse({
      ...paid,
      retail_price_cents: undefined,
    })
    expect(r.success).toBe(false)
  })

  it("accepts free product without price", () => {
    const r = digitalProductInputSchema.safeParse({
      ...paid,
      digital_is_free: true,
      retail_price_cents: undefined,
    })
    expect(r.success).toBe(true)
  })

  it("rejects ttl outside 60..86400", () => {
    const r = digitalProductInputSchema.safeParse({
      ...paid,
      digital_signed_url_ttl_seconds: 30,
    })
    expect(r.success).toBe(false)
  })
})

describe("leadFormSchema", () => {
  it("accepts valid email", () => {
    const r = leadFormSchema.safeParse({
      email: "user@example.com",
      product_id: "00000000-0000-0000-0000-000000000000",
      website: "",
    })
    expect(r.success).toBe(true)
  })

  it("rejects if honeypot 'website' is filled", () => {
    const r = leadFormSchema.safeParse({
      email: "user@example.com",
      product_id: "00000000-0000-0000-0000-000000000000",
      website: "http://spam.com",
    })
    expect(r.success).toBe(false)
  })
})

describe("downloadSignRequestSchema", () => {
  it("accepts valid payload", () => {
    const r = downloadSignRequestSchema.safeParse({
      order_number: "DJP-1042",
      email: "user@example.com",
      download_id: "00000000-0000-0000-0000-000000000000",
    })
    expect(r.success).toBe(true)
  })
})
