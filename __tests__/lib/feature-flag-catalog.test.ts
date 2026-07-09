import { describe, it, expect } from "vitest"
import { FEATURE_FLAG_CATALOG, isFeatureFlagKey } from "@/lib/feature-flag-catalog"

describe("feature flag catalog", () => {
  it("declares the captioned-cut flag, default off", () => {
    const flag = FEATURE_FLAG_CATALOG.find((f) => f.key === "feature_captioned_cut_enabled")
    expect(flag).toBeDefined()
    expect(flag?.defaultEnabled).toBe(false)
  })
  it("recognizes a known key and rejects an unknown one", () => {
    expect(isFeatureFlagKey("feature_captioned_cut_enabled")).toBe(true)
    expect(isFeatureFlagKey("feature_bogus")).toBe(false)
  })
  it("declares the program-excel-import flag, default on", () => {
    const flag = FEATURE_FLAG_CATALOG.find((f) => f.key === "feature_program_excel_import_enabled")
    expect(flag?.defaultEnabled).toBe(true)
    expect(isFeatureFlagKey("feature_program_excel_import_enabled")).toBe(true)
  })
})
