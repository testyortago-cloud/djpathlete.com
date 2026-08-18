// __tests__/lib/lead-engine-constants.test.ts
// @vitest-environment node
import { describe, it, expect } from "vitest"
import { SINGLETON_BUSINESS_ID } from "@/lib/lead-engine/constants"

describe("SINGLETON_BUSINESS_ID", () => {
  it("matches the uuid seeded by migration 00212", () => {
    expect(SINGLETON_BUSINESS_ID).toBe("00000000-0000-0000-0000-000000000001")
  })

  it("is a syntactically valid uuid", () => {
    expect(SINGLETON_BUSINESS_ID).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    )
  })
})
