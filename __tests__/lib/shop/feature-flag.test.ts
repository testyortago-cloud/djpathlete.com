import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { isShopEnabled } from "@/lib/shop/feature-flag"

describe("isShopEnabled", () => {
  const originalEnv = process.env.SHOP_ENABLED

  afterEach(() => {
    process.env.SHOP_ENABLED = originalEnv
  })

  it("returns false when env var is undefined", () => {
    delete process.env.SHOP_ENABLED
    expect(isShopEnabled()).toBe(false)
  })

  it("returns false when env var is 'false'", () => {
    process.env.SHOP_ENABLED = "false"
    expect(isShopEnabled()).toBe(false)
  })

  it("returns false when env var is any non-'true' value", () => {
    process.env.SHOP_ENABLED = "1"
    expect(isShopEnabled()).toBe(false)
  })

  it("returns true only when env var is exactly 'true'", () => {
    process.env.SHOP_ENABLED = "true"
    expect(isShopEnabled()).toBe(true)
  })
})
