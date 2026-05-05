import { describe, expect, it, beforeAll, afterAll } from "vitest"
import {
  upsertLead,
  markLeadSynced,
  markLeadFailed,
  listLeads,
  countLeadsForProduct,
} from "@/lib/db/shop-leads"
import { createServiceRoleClient } from "@/lib/supabase"
import { TestCleanup } from "../../_helpers/cleanup"

describe("shop-leads DAL", () => {
  let productId: string
  const cleanup = new TestCleanup()

  beforeAll(async () => {
    const supabase = createServiceRoleClient()
    const { data } = await supabase
      .from("shop_products")
      .insert({
        slug: `lead-${Date.now()}`,
        name: "lead-test",
        description: "",
        thumbnail_url: "https://x/i.jpg",
        product_type: "digital",
        digital_is_free: true,
      })
      .select("id")
      .single()
    productId = data!.id
    cleanup.trackProduct(productId)
  })

  afterAll(async () => {
    await cleanup.run()
  })

  it("upserts a lead and re-upserts without duplicating", async () => {
    const email = `u-${Date.now()}@x.com`
    const a = await upsertLead({
      product_id: productId,
      email,
      ip_address: "1.1.1.1",
    })
    const b = await upsertLead({
      product_id: productId,
      email,
      ip_address: "2.2.2.2",
    })
    expect(a.id).toBe(b.id)
    expect(await countLeadsForProduct(productId)).toBeGreaterThanOrEqual(1)
  })

  it("markLeadSynced updates status", async () => {
    const email = `sync-${Date.now()}@x.com`
    const lead = await upsertLead({ product_id: productId, email })
    await markLeadSynced(lead.id, "contact_abc")
    const list = await listLeads({})
    const found = list.find((l) => l.id === lead.id)
    expect(found?.resend_sync_status).toBe("synced")
    expect(found?.resend_contact_id).toBe("contact_abc")
  })

  it("markLeadFailed stores error", async () => {
    const email = `fail-${Date.now()}@x.com`
    const lead = await upsertLead({ product_id: productId, email })
    await markLeadFailed(lead.id, "network timeout")
    const list = await listLeads({})
    expect(list.find((l) => l.id === lead.id)?.resend_sync_error).toBe(
      "network timeout",
    )
  })
})
