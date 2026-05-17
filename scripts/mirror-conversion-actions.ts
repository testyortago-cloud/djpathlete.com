// scripts/mirror-conversion-actions.ts
// One-shot: mirror the freshly-created Google Ads conversion actions into
// our local google_ads_conversion_actions table so the admin Conversions
// page + agent see them. Idempotent — uses upsertConversionAction.

import { config as loadEnv } from "dotenv"
loadEnv({ path: ".env.local" })
loadEnv()

async function main() {
  const { upsertConversionAction, listConversionActions } = await import(
    "@/lib/db/google-ads-conversion-actions"
  )

  await upsertConversionAction({
    customer_id: "4974459872",
    conversion_action_id: "7614178992",
    name: "Rotational Reboot Purchase",
    trigger_type: "payment_succeeded",
    default_value_micros: 79_000_000,
    default_currency: "USD",
    is_active: true,
  })
  await upsertConversionAction({
    customer_id: "4974459872",
    conversion_action_id: "7614178995",
    name: "Assessment Form Submission",
    // No native form_submission_lead trigger; use booking_created as the
    // closest local proxy until we wire a dedicated form-submit trigger.
    trigger_type: "booking_created",
    default_value_micros: 0,
    default_currency: "USD",
    is_active: true,
  })

  const all = await listConversionActions()
  console.log(`Mirror now has ${all.length} conversion action(s):`)
  for (const a of all)
    console.log(`  ${a.conversion_action_id} - ${a.name} (${a.trigger_type})`)
}

main().catch((err) => {
  console.error("Mirror failed:", err)
  process.exit(1)
})
