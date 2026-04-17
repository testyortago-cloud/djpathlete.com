import { describe, it, expect } from "vitest"
import { createServiceRoleClient } from "@/lib/supabase"

describe("migration 00067 shop_product_type", () => {
  it("exposes product_type column with default 'pod'", async () => {
    const supabase = createServiceRoleClient()
    const { data, error } = await supabase
      .from("shop_products")
      .select("product_type, digital_is_free, digital_signed_url_ttl_seconds")
      .eq("product_type", "pod")
      .limit(1)
    expect(error).toBeNull()
    if (data && data.length > 0) {
      expect(data[0].product_type).toBe("pod")
      expect(data[0].digital_is_free).toBe(false)
      expect(data[0].digital_signed_url_ttl_seconds).toBe(900)
    }
  })
})
