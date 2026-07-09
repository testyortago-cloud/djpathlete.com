import { describe, it, expect } from "vitest"
import { FEATURE_FLAG_CATALOG, isFeatureFlagKey } from "@/lib/feature-flag-catalog"

describe("program excel import feature flag", () => {
  it("is registered in the catalog and defaults enabled", () => {
    const flag = FEATURE_FLAG_CATALOG.find((f) => f.key === "feature_program_excel_import_enabled")
    expect(flag).toBeDefined()
    expect(flag?.defaultEnabled).toBe(true)
    expect(isFeatureFlagKey("feature_program_excel_import_enabled")).toBe(true)
  })
})
