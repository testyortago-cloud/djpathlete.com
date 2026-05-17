// scripts/backfill-conversion-kinds.ts
// Sets client_trigger_kind + conversion_label on the 3 conversion actions
// we've created so the dynamic registry can resolve send_to without
// touching code per product. Idempotent — runs UPDATEs, INSERT if missing.

import { config as loadEnv } from "dotenv"
loadEnv({ path: ".env.local" })
loadEnv()

async function main() {
  const { createServiceRoleClient } = await import("@/lib/supabase")
  const supabase = createServiceRoleClient()

  const updates = [
    {
      conversion_action_id: "7614178992",
      client_trigger_kind: "shop_purchase",
      conversion_label: "m76NCLDN3K4cEOXr9MZD",
    },
    {
      conversion_action_id: "7614178995",
      client_trigger_kind: "lead_form",
      conversion_label: "Vu0HCLPN3K4cEOXr9MZD",
    },
    {
      conversion_action_id: "7614199344",
      client_trigger_kind: "event_booking",
      conversion_label: "d9FLCLDs3a4cEOXr9MZD",
    },
  ]

  for (const u of updates) {
    const { data: existing } = await supabase
      .from("google_ads_conversion_actions")
      .select("conversion_action_id")
      .eq("conversion_action_id", u.conversion_action_id)
      .maybeSingle()
    if (existing) {
      const { error } = await supabase
        .from("google_ads_conversion_actions")
        .update({
          client_trigger_kind: u.client_trigger_kind,
          conversion_label: u.conversion_label,
        })
        .eq("conversion_action_id", u.conversion_action_id)
      console.log(`UPDATE ${u.conversion_action_id} → ${u.client_trigger_kind}${error ? ` (err: ${error.message})` : ""}`)
    } else {
      // Insert if the row was created in Google Ads but never mirrored.
      const name =
        u.client_trigger_kind === "event_booking" ? "Event Booking (Camp/Clinic)" : "(restored)"
      const trigger_type = u.client_trigger_kind === "lead_form" ? "booking_created" : "payment_succeeded"
      const default_value_micros = u.client_trigger_kind === "event_booking" ? 150_000_000 : 0
      const { error } = await supabase.from("google_ads_conversion_actions").insert({
        customer_id: "4974459872",
        conversion_action_id: u.conversion_action_id,
        name,
        trigger_type,
        default_value_micros,
        default_currency: "USD",
        is_active: true,
        client_trigger_kind: u.client_trigger_kind,
        conversion_label: u.conversion_label,
      })
      console.log(`INSERT ${u.conversion_action_id} → ${u.client_trigger_kind}${error ? ` (err: ${error.message})` : ""}`)
    }
  }

  const { data } = await supabase
    .from("google_ads_conversion_actions")
    .select("conversion_action_id, name, client_trigger_kind, conversion_label, is_active")
  console.log("\n=== Final state ===")
  console.log(JSON.stringify(data, null, 2))
}

main().catch((err) => {
  console.error("Backfill failed:", err)
  process.exit(1)
})
