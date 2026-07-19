import { describe, expect, it } from "vitest"
import { createAssetSchema, updateAssetSchema } from "@/lib/validators/bookkeeping"

const BOOK = "b0000000-0000-4000-8000-000000000001"
const valid = {
  book_id: BOOK,
  name: "Squat Rack",
  basis_cents: 10000,
  in_service_on: "2024-01-15",
  method: "straight_line",
  convention: "full_month",
  recovery_years: 3,
}

describe("createAssetSchema", () => {
  it("accepts a valid asset and defaults salvage_cents to 0", () => {
    const r = createAssetSchema.safeParse(valid)
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.salvage_cents).toBe(0)
  })
  it("rejects salvage > basis (the cross-field refine — DB CHECK's twin)", () => {
    expect(createAssetSchema.safeParse({ ...valid, salvage_cents: 10001 }).success).toBe(false)
    expect(createAssetSchema.safeParse({ ...valid, salvage_cents: 10000 }).success).toBe(true) // equal is legal
  })
  it("pins recovery_years to the DB CHECK bounds: 1 and 50 pass, 0 and 51 fail", () => {
    expect(createAssetSchema.safeParse({ ...valid, recovery_years: 1 }).success).toBe(true)
    expect(createAssetSchema.safeParse({ ...valid, recovery_years: 50 }).success).toBe(true)
    expect(createAssetSchema.safeParse({ ...valid, recovery_years: 0 }).success).toBe(false)
    expect(createAssetSchema.safeParse({ ...valid, recovery_years: 51 }).success).toBe(false)
    expect(createAssetSchema.safeParse({ ...valid, recovery_years: 2.5 }).success).toBe(false)
  })
  it("pins the enums byte-identical to the DB CHECKs — no invented methods/conventions", () => {
    expect(createAssetSchema.safeParse({ ...valid, method: "macrs" }).success).toBe(false)
    expect(createAssetSchema.safeParse({ ...valid, convention: "mid_quarter" }).success).toBe(false)
    expect(createAssetSchema.safeParse({ ...valid, convention: "half_year" }).success).toBe(true)
  })
  it("rejects negative money and bad dates", () => {
    expect(createAssetSchema.safeParse({ ...valid, basis_cents: -1 }).success).toBe(false)
    expect(createAssetSchema.safeParse({ ...valid, basis_cents: 100.5 }).success).toBe(false)
    expect(createAssetSchema.safeParse({ ...valid, in_service_on: "01/15/2024" }).success).toBe(false)
  })
})

describe("updateAssetSchema", () => {
  it("accepts partial updates and a null note (clears it)", () => {
    expect(updateAssetSchema.safeParse({ name: "New name" }).success).toBe(true)
    expect(updateAssetSchema.safeParse({ accountant_note: null }).success).toBe(true)
  })
  it("still pins enum + bound checks on the fields it does receive", () => {
    expect(updateAssetSchema.safeParse({ method: "macrs" }).success).toBe(false)
    expect(updateAssetSchema.safeParse({ recovery_years: 51 }).success).toBe(false)
  })
})
