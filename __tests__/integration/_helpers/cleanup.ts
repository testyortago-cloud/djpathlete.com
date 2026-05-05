import { createServiceRoleClient } from "@/lib/supabase"

/**
 * Tracks rows inserted by an integration test and tears them down in afterAll.
 * Order of deletion respects FK rules: orders & explicit leads first, then
 * products (which cascade variants/files/affiliate_clicks).
 */
export class TestCleanup {
  productIds: string[] = []
  orderIds: string[] = []
  leadIds: string[] = []

  trackProduct(id: string | null | undefined) {
    if (id) this.productIds.push(id)
  }
  trackOrder(id: string | null | undefined) {
    if (id) this.orderIds.push(id)
  }
  trackLead(id: string | null | undefined) {
    if (id) this.leadIds.push(id)
  }

  async run() {
    const supabase = createServiceRoleClient()
    if (this.orderIds.length) {
      // CASCADE removes shop_order_downloads
      await supabase.from("shop_orders").delete().in("id", this.orderIds)
    }
    if (this.leadIds.length) {
      await supabase.from("shop_leads").delete().in("id", this.leadIds)
    }
    if (this.productIds.length) {
      // shop_leads.product_id is NO ACTION — clear any stragglers first
      await supabase.from("shop_leads").delete().in("product_id", this.productIds)
      // shop_order_downloads.product_id / file_id are NO ACTION — clear too
      await supabase
        .from("shop_order_downloads")
        .delete()
        .in("product_id", this.productIds)
      // CASCADE removes variants, files, affiliate_clicks
      await supabase.from("shop_products").delete().in("id", this.productIds)
    }
  }
}
