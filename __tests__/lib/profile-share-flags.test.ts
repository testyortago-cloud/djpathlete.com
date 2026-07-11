import { describe, it, expect } from "vitest"
import { CLIENT_PROFILE_SHARE_KEY } from "@/lib/profile-share/flags"
import { FEATURE_FLAG_CATALOG, isFeatureFlagKey } from "@/lib/feature-flag-catalog"

describe("profile share flag", () => {
  it("is registered in the admin feature-flag catalog, default OFF", () => {
    const row = FEATURE_FLAG_CATALOG.find((f) => f.key === CLIENT_PROFILE_SHARE_KEY)
    expect(row).toBeDefined()
    expect(row!.defaultEnabled).toBe(false)
    expect(isFeatureFlagKey(CLIENT_PROFILE_SHARE_KEY)).toBe(true)
  })
})
