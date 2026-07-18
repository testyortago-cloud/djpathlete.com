import { describe, it, expect } from "vitest"
import { reportQuerySchema, quickbooksQuerySchema, emailPackSchema, homeOfficePercentSchema } from "@/lib/validators/bookkeeping"

describe("reportQuerySchema", () => {
  it("accepts a sane window", () => {
    expect(reportQuerySchema.safeParse({ from: "2026-01-01", to: "2026-12-31" }).success).toBe(true)
  })
  it("rejects from > to", () => {
    expect(reportQuerySchema.safeParse({ from: "2026-02-01", to: "2026-01-01" }).success).toBe(false)
  })
  it("rejects a window over 5 years", () => {
    expect(reportQuerySchema.safeParse({ from: "2020-01-01", to: "2026-01-02" }).success).toBe(false)
  })
  it("rejects malformed dates", () => {
    expect(reportQuerySchema.safeParse({ from: "01/01/2026", to: "2026-12-31" }).success).toBe(false)
  })
})

describe("quickbooksQuerySchema", () => {
  it("requires a UUID book_id", () => {
    expect(quickbooksQuerySchema.safeParse({ from: "2026-01-01", to: "2026-12-31" }).success).toBe(false)
    expect(quickbooksQuerySchema.safeParse({ from: "2026-01-01", to: "2026-12-31", book_id: "nope" }).success).toBe(false)
    expect(quickbooksQuerySchema.safeParse({ from: "2026-01-01", to: "2026-12-31", book_id: "b0000000-0000-4000-8000-000000000001" }).success).toBe(true)
  })
})

describe("emailPackSchema", () => {
  it("requires a valid recipient email", () => {
    expect(emailPackSchema.safeParse({ from: "2026-01-01", to: "2026-03-31", recipient_email: "not-an-email" }).success).toBe(false)
    expect(emailPackSchema.safeParse({ from: "2026-01-01", to: "2026-03-31", recipient_email: "cpa@firm.com" }).success).toBe(true)
  })
  it("keeps the window rules", () => {
    expect(emailPackSchema.safeParse({ from: "2026-03-31", to: "2026-01-01", recipient_email: "cpa@firm.com" }).success).toBe(false)
    expect(emailPackSchema.safeParse({ from: "2019-01-01", to: "2026-01-01", recipient_email: "cpa@firm.com" }).success).toBe(false)
  })
  it("remember is optional boolean", () => {
    expect(emailPackSchema.safeParse({ from: "2026-01-01", to: "2026-03-31", recipient_email: "cpa@firm.com", remember: true }).success).toBe(true)
  })
})

describe("homeOfficePercentSchema", () => {
  it("accepts in-range numbers and null", () => {
    expect(homeOfficePercentSchema.safeParse({ percent: 12.5 }).success).toBe(true)
    expect(homeOfficePercentSchema.safeParse({ percent: 100 }).success).toBe(true)
    expect(homeOfficePercentSchema.safeParse({ percent: 12.345 }).success).toBe(true) // route rounds to 2dp
    expect(homeOfficePercentSchema.safeParse({ percent: null }).success).toBe(true)
  })
  it("rejects 0, negatives, >100, strings, missing key", () => {
    for (const percent of [0, -1, 100.01, "25"]) {
      expect(homeOfficePercentSchema.safeParse({ percent }).success).toBe(false)
    }
    expect(homeOfficePercentSchema.safeParse({}).success).toBe(false)
  })
})
