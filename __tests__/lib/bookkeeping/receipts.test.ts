import { describe, it, expect } from "vitest"
import {
  accountRequiresBusinessPurpose, businessPurposeMissing, receiptSourceRef,
  RECEIPT_SOURCE_REF, isValidReceiptCommitRef, receiptRetainUntil,
} from "@/lib/bookkeeping/receipts"

describe("accountRequiresBusinessPurpose", () => {
  it("true only when flag set", () => {
    expect(accountRequiresBusinessPurpose({ requires_business_purpose: true })).toBe(true)
    expect(accountRequiresBusinessPurpose({ requires_business_purpose: false })).toBe(false)
    expect(accountRequiresBusinessPurpose({})).toBe(false)
    expect(accountRequiresBusinessPurpose({ requires_business_purpose: null })).toBe(false)
  })
})

describe("businessPurposeMissing", () => {
  it("missing only when required AND blank", () => {
    const sensitive = { requires_business_purpose: true }
    expect(businessPurposeMissing(sensitive, "team lunch")).toBe(false)
    expect(businessPurposeMissing(sensitive, "")).toBe(true)
    expect(businessPurposeMissing(sensitive, "   ")).toBe(true)
    expect(businessPurposeMissing(sensitive, null)).toBe(true)
    expect(businessPurposeMissing({ requires_business_purpose: false }, null)).toBe(false)
  })
})

describe("receiptSourceRef / validation", () => {
  it("builds and validates a receipt ref", () => {
    const id = "11111111-2222-4333-8444-555555555555"
    expect(receiptSourceRef(id)).toBe(`receipt:${id}`)
    expect(RECEIPT_SOURCE_REF.test(receiptSourceRef(id))).toBe(true)
    expect(isValidReceiptCommitRef(receiptSourceRef(id))).toBe(true)
    expect(isValidReceiptCommitRef("amazon:112-3456789-0000000:0")).toBe(true)
    expect(isValidReceiptCommitRef("statement:deadbeef")).toBe(false)
    expect(isValidReceiptCommitRef("receipt:not-a-uuid")).toBe(false)
  })
})

describe("receiptRetainUntil", () => {
  it("occurred-year + 7, Dec 31", () => {
    expect(receiptRetainUntil("2026-07-18")).toBe("2033-12-31")
    expect(receiptRetainUntil("2020-01-01")).toBe("2027-12-31")
  })
})
