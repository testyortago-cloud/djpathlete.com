// @vitest-environment node
import { describe, it, expect } from "vitest"
import { normaliseEmail, normalisePhone } from "@/lib/lead-engine/identity"

describe("normaliseEmail", () => {
  it("lowercases and trims", () => {
    expect(normaliseEmail("  Darren@Example.COM ")).toBe("darren@example.com")
  })

  it("returns null for blank or missing input", () => {
    expect(normaliseEmail("")).toBeNull()
    expect(normaliseEmail("   ")).toBeNull()
    expect(normaliseEmail(null)).toBeNull()
    expect(normaliseEmail(undefined)).toBeNull()
  })

  it("returns null for something that is not an address", () => {
    expect(normaliseEmail("not-an-email")).toBeNull()
  })
})

describe("normalisePhone", () => {
  it("normalises the same US number written four ways to one E.164 value", () => {
    const expected = "+16176504548"
    expect(normalisePhone("617-650-4548")).toBe(expected)
    expect(normalisePhone("(617) 650 4548")).toBe(expected)
    expect(normalisePhone("6176504548")).toBe(expected)
    expect(normalisePhone("+1 617 650 4548")).toBe(expected)
  })

  it("keeps a non-US number in its own country format", () => {
    expect(normalisePhone("+44 20 7946 0958")).toBe("+442079460958")
  })

  it("returns null rather than throwing on junk", () => {
    expect(normalisePhone("hello")).toBeNull()
    expect(normalisePhone("123")).toBeNull()
    expect(normalisePhone(null)).toBeNull()
    expect(normalisePhone(undefined)).toBeNull()
    expect(normalisePhone("")).toBeNull()
  })
})
