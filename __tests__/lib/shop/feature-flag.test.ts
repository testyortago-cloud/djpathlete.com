import { afterEach, describe, expect, it } from "vitest"
import {
  isShopEnabled,
  isShopDigitalEnabled,
  isShopAffiliateEnabled,
} from "@/lib/shop/feature-flag"

describe("shop feature flags", () => {
  const origEnv = { ...process.env }
  afterEach(() => {
    process.env = { ...origEnv }
  })

  it("isShopDigitalEnabled returns true only when env is 'true'", () => {
    process.env.SHOP_DIGITAL_ENABLED = "true"
    expect(isShopDigitalEnabled()).toBe(true)
    process.env.SHOP_DIGITAL_ENABLED = "false"
    expect(isShopDigitalEnabled()).toBe(false)
    delete process.env.SHOP_DIGITAL_ENABLED
    expect(isShopDigitalEnabled()).toBe(false)
  })

  it("isShopAffiliateEnabled returns true only when env is 'true'", () => {
    process.env.SHOP_AFFILIATE_ENABLED = "true"
    expect(isShopAffiliateEnabled()).toBe(true)
    process.env.SHOP_AFFILIATE_ENABLED = "false"
    expect(isShopAffiliateEnabled()).toBe(false)
  })

  it("isShopEnabled remains independent", () => {
    process.env.SHOP_ENABLED = "true"
    expect(isShopEnabled()).toBe(true)
  })
})
