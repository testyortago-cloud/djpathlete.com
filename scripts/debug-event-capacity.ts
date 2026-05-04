// Debug why "1 spot left" event is returning at_capacity on checkout.
// Lists upcoming clinics and shows: capacity, signup_count, and recent
// pending paid signups in the last hour.
//
// Run: npx tsx scripts/debug-event-capacity.ts
import { config } from "dotenv"
config({ path: ".env.local" })

import { createServiceRoleClient } from "@/lib/supabase"

async function main() {
  const supabase = createServiceRoleClient()
  const now = new Date()
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString()

  console.log("Now:", now.toISOString(), "\n")

  const { data: events, error: evErr } = await supabase
    .from("events")
    .select("id,title,type,start_date,capacity,signup_count,status,price_cents,stripe_price_id")
    .eq("status", "published")
    .gte("end_date", now.toISOString())
    .order("start_date", { ascending: true })
  if (evErr) throw evErr
  if (!events || events.length === 0) {
    console.log("No upcoming published events.")
    return
  }

  for (const ev of events) {
    console.log("─".repeat(80))
    console.log(`${ev.title}  [${ev.type}]`)
    console.log(`  id=${ev.id}`)
    console.log(`  starts=${ev.start_date}`)
    console.log(`  capacity=${ev.capacity}  signup_count=${ev.signup_count}`)
    console.log(`  price_cents=${ev.price_cents}  stripe_price_id=${ev.stripe_price_id ?? "—"}`)

    const { data: signups } = await supabase
      .from("event_signups")
      .select("id,parent_email,signup_type,status,created_at")
      .eq("event_id", ev.id)
      .order("created_at", { ascending: false })
    const all = signups ?? []

    const confirmed = all.filter((s) => s.status === "confirmed")
    const pendingAll = all.filter((s) => s.signup_type === "paid" && s.status === "pending")
    const pendingFresh = pendingAll.filter((s) => s.created_at >= oneHourAgo)
    const pendingStale = pendingAll.filter((s) => s.created_at < oneHourAgo)

    console.log(`  confirmed signups: ${confirmed.length}`)
    console.log(`  pending paid (≤1h, blocks checkout): ${pendingFresh.length}`)
    console.log(`  pending paid (>1h, will auto-cancel on next admin read): ${pendingStale.length}`)

    const effective = (ev.signup_count as number) + pendingFresh.length
    const wouldBlock = effective >= (ev.capacity as number)
    console.log(
      `  effective fill = signup_count(${ev.signup_count}) + freshPending(${pendingFresh.length}) = ${effective} / capacity ${ev.capacity}  → ${wouldBlock ? "BLOCKS new checkout" : "OK"}`,
    )

    if (pendingFresh.length > 0) {
      console.log("\n  Fresh pending paid rows (these are eating spots):")
      for (const s of pendingFresh) {
        console.log(
          `    - ${s.id}  ${s.parent_email}  created=${s.created_at}  age=${Math.round(
            (Date.now() - new Date(s.created_at).getTime()) / 1000 / 60,
          )}m`,
        )
      }
    }
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
