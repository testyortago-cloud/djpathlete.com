// Release a stuck pending paid signup so the spot becomes bookable again.
// Used to recover from an abandoned checkout (browser closed before Stripe
// returned). Safe — flips status from 'pending' → 'cancelled' and updates
// updated_at; no Stripe call.
//
// Run: npx tsx scripts/release-pending-signup.ts <signup_id>
import { config } from "dotenv"
config({ path: ".env.local" })

import { createServiceRoleClient } from "@/lib/supabase"

async function main() {
  const id = process.argv[2]
  if (!id) throw new Error("usage: release-pending-signup.ts <signup_id>")
  const supabase = createServiceRoleClient()

  const { data: before, error: e1 } = await supabase
    .from("event_signups")
    .select("id,event_id,parent_email,signup_type,status,created_at")
    .eq("id", id)
    .maybeSingle()
  if (e1) throw e1
  if (!before) throw new Error("signup not found: " + id)
  if (before.status !== "pending") {
    console.log(`Signup ${id} is status=${before.status}, not pending — nothing to do.`)
    return
  }

  console.log("Before:", before)
  const { error: e2 } = await supabase
    .from("event_signups")
    .update({ status: "cancelled", updated_at: new Date().toISOString() })
    .eq("id", id)
  if (e2) throw e2

  const { data: after } = await supabase
    .from("event_signups")
    .select("id,status,updated_at")
    .eq("id", id)
    .maybeSingle()
  console.log("After :", after)
  console.log("\nSpot released. Retry checkout from the public event page.")
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
