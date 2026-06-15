import { describe, it, expect } from "vitest"
import {
  auditCsvLines,
  isValidEmailFormat,
  isDisposableDomain,
} from "@/lib/newsletter/audit"

describe("isValidEmailFormat", () => {
  it("accepts a normal email", () => {
    expect(isValidEmailFormat("a@b.com")).toBe(true)
  })
  it("rejects missing @ or domain", () => {
    expect(isValidEmailFormat("nope")).toBe(false)
    expect(isValidEmailFormat("a@b")).toBe(false)
    expect(isValidEmailFormat("a b@c.com")).toBe(false)
  })
})

describe("isDisposableDomain", () => {
  it("flags a known disposable domain (case-insensitive)", () => {
    expect(isDisposableDomain("x@Mailinator.com")).toBe(true)
  })
  it("passes a normal domain", () => {
    expect(isDisposableDomain("x@gmail.com")).toBe(false)
  })
})

describe("auditCsvLines", () => {
  it("extracts emails, skips headers, de-dupes, and flags invalid + disposable", () => {
    const result = auditCsvLines([
      "Email,Name",
      "john@example.com,John",
      '"jane@example.com","Jane"',
      "JOHN@example.com,dupe", // duplicate (case-insensitive)
      "not-an-email",
      "spam@mailinator.com",
      "", // blank
      "first_name,last_name", // header-ish
    ])
    expect(result.valid).toEqual(["john@example.com", "jane@example.com"])
    expect(result.duplicates).toBe(1)
    expect(result.invalidFormat).toEqual(["not-an-email"])
    expect(result.disposable).toEqual(["spam@mailinator.com"])
  })

  it("pulls the email out of a multi-column row regardless of position", () => {
    const result = auditCsvLines(["Mr,John Smith,john@club.org,2024-01-01"])
    expect(result.valid).toEqual(["john@club.org"])
  })

  it("returns empty buckets for no input", () => {
    expect(auditCsvLines([])).toEqual({
      valid: [],
      invalidFormat: [],
      disposable: [],
      duplicates: 0,
    })
  })
})
