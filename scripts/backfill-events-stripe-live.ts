// Backfill Stripe Product+Price for published priced events that have no
// stripe_price_id, using STRIPE_SECRET_KEY_LIVE (live-mode) from .env.local.
//
//   npx tsx scripts/backfill-events-stripe-live.ts            // sync events with null stripe_price_id
//   npx tsx scripts/backfill-events-stripe-live.ts --dry      // print plan, do nothing
//   npx tsx scripts/backfill-events-stripe-live.ts --include-resync   // ALSO overwrite existing IDs
//
// Note: --include-resync replaces existing stripe_product_id / stripe_price_id columns.
// If those IDs were created in test mode, they become orphaned references in test mode.
import { config } from "dotenv"
config({ path: ".env.local" })

import Stripe from "stripe"
import { createClient } from "@supabase/supabase-js"

async function main() {
  const args = process.argv.slice(2)
  const dryRun = args.includes("--dry")
  const includeResync = args.includes("--include-resync")

  const liveKey = process.env.STRIPE_SECRET_KEY_LIVE
  if (!liveKey) throw new Error("STRIPE_SECRET_KEY_LIVE is not set in .env.local")
  if (!liveKey.startsWith("sk_live_")) {
    throw new Error(`STRIPE_SECRET_KEY_LIVE does not look like a live key`)
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !supabaseKey) throw new Error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set")

  const stripe = new Stripe(liveKey)
  const supabase = createClient(supabaseUrl, supabaseKey)

  const { data: events, error } = await supabase
    .from("events")
    .select("id, type, slug, title, summary, status, price_cents, stripe_product_id, stripe_price_id")
    .eq("status", "published")
    .gt("price_cents", 0)
    .order("created_at", { ascending: true })

  if (error) throw new Error(`Supabase query failed: ${error.message}`)
  if (!events || events.length === 0) {
    console.log("[backfill] No published priced events. Nothing to do.")
    return
  }

  const needSync = events.filter((e) => !e.stripe_price_id)
  const alreadySynced = events.filter((e) => !!e.stripe_price_id)

  console.log(`[backfill] Mode:           ${dryRun ? "DRY RUN" : "LIVE WRITE"}`)
  console.log(`[backfill] Stripe key:     LIVE`)
  console.log(`[backfill] Total events:   ${events.length}`)
  console.log(`[backfill] Need sync:      ${needSync.length}`)
  console.log(
    `[backfill] Already synced: ${alreadySynced.length}${
      includeResync ? "  (--include-resync: WILL OVERWRITE)" : "  (skipped — pass --include-resync to overwrite)"
    }`,
  )

  const targets = includeResync ? events : needSync
  if (targets.length === 0) {
    console.log("[backfill] Nothing to do.")
    return
  }

  for (const e of targets) {
    console.log(`\n[backfill] ${e.title.trim()}  (${e.slug})  id=${e.id}  price_cents=${e.price_cents}`)
    if (e.stripe_price_id) {
      console.log(`           previous IDs: product=${e.stripe_product_id} price=${e.stripe_price_id} (will be replaced)`)
    }
    if (dryRun) {
      console.log("           (dry run — no Stripe or DB writes)")
      continue
    }

    const product = await stripe.products.create({
      name: e.title.trim(),
      description: e.summary || undefined,
      metadata: { eventId: e.id, type: "event" },
    })
    const price = await stripe.prices.create({
      product: product.id,
      unit_amount: e.price_cents!,
      currency: "usd",
    })

    const { error: upErr } = await supabase
      .from("events")
      .update({
        stripe_product_id: product.id,
        stripe_price_id: price.id,
        updated_at: new Date().toISOString(),
      })
      .eq("id", e.id)

    if (upErr) {
      console.error(`           DB update FAILED: ${upErr.message}`)
      console.error(`           Orphan in Stripe — archive manually: product=${product.id}`)
      throw upErr
    }
    console.log(`           ✓ live product=${product.id}`)
    console.log(`           ✓ live price=${price.id}`)
  }

  console.log("\n[backfill] Done.")
}

main().catch((err) => {
  console.error("BACKFILL FAILED:", err.message)
  process.exit(1)
})
