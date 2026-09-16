/**
 * READ-ONLY dry run of the expired-payment-link re-send pass, against real data.
 *
 *   npx tsx scripts/dry-run-pack-link-resend.ts            # dev clone
 *   npx tsx scripts/dry-run-pack-link-resend.ts --prod     # production, still read-only
 *
 * Answers one question: on the next cron run, which payers would be emailed a
 * fresh payment link, and why?
 *
 * WRAPPED IN main(), NOT top-level await. `next build` runs its own TypeScript
 * pass over every .ts file the tsconfig includes — and this repo's include list
 * covers scripts/ — under a `module` setting that forbids top-level await, which
 * fails the whole production build. `npx tsc --noEmit` uses different settings
 * and accepts it, so the local typecheck passes and the DEPLOY is what breaks.
 * Every other script here is .mjs, which is never type-checked, which is why a
 * .ts one was the first to hit this.
 *
 * It imports the REAL selection helper rather than restating its rules, so this
 * cannot drift from what the cron actually does. It deliberately does NOT call
 * resolvePackPaymentLink — that function MINTS a Stripe session and writes
 * stripe_session_id back. It reads the session instead, which is the same
 * decision without the side effects. Nothing here writes to a database, mints a
 * session, or sends an email; there is no flag to make it do so.
 */
import { readFileSync } from "node:fs"
import { createClient } from "@supabase/supabase-js"
import Stripe from "stripe"
import { selectPacksDueLinkResend, PACK_LINK_RESEND_THROTTLE_MS } from "../lib/automation/pack-link-resend"
import type { ClientPackage } from "../types/database"

async function main() {
  const useProd = process.argv.includes("--prod")
  const envFile = useProd ? ".env.prod" : ".env.local"
  const env: Record<string, string> = {}
  for (const line of readFileSync(envFile, "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "")
  }

  const MAX_RESENDS = 3 // pack_link_resend_max default

  const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)
  const stripeKey = useProd ? env.STRIPE_SECRET_KEY_LIVE : env.STRIPE_SECRET_KEY
  const stripe = new Stripe(stripeKey)

  console.log(`\nDry run against ${useProd ? "PRODUCTION" : "the dev clone"} — read-only.\n`)

  // Mirrors listRenewalsAwaitingPayment's two-query shape.
  const { data: attempts, error: aErr } = await supabase
    .from("pack_renewal_attempts")
    .select("new_package_id")
    .in("status", ["skipped", "failed"])
    .not("new_package_id", "is", null)
  if (aErr) throw aErr
  const ids = (attempts ?? []).map((r) => (r as { new_package_id: string }).new_package_id)
  if (ids.length === 0) {
    console.log("No renewal attempts have fallen back to a payment link. Nothing to do.")
    process.exit(0)
  }

  const { data: packs, error: pErr } = await supabase
    .from("client_packages")
    .select("*")
    .in("id", ids)
    .eq("payment_status", "pending")
    .eq("status", "active")
  if (pErr) throw pErr

  // ClientPackage already satisfies LinkResendCandidate (id, plus the two
  // optional resend columns), so no structural gymnastics are needed here.
  const awaiting = (packs ?? []) as ClientPackage[]
  console.log(`${awaiting.length} unpaid renewal pack(s) awaiting payment.\n`)

  const due = selectPacksDueLinkResend(awaiting, new Date(), {
    maxResends: MAX_RESENDS,
    throttleMs: PACK_LINK_RESEND_THROTTLE_MS,
  })

  for (const pack of awaiting) {
    const isDue = due.some((d) => d.id === pack.id)
    const label = `${pack.credits_total}× ${pack.session_type} · $${pack.price_cents / 100}`
    if (!isDue) {
      console.log(`  SKIP  ${pack.id}  ${label}`)
      console.log(
        `        budget spent or throttled (count=${pack.payment_link_resent_count ?? 0}, last=${pack.payment_link_resent_at ?? "never"})\n`,
      )
      continue
    }
    let verdict = "no session id on the pack — nothing to refresh"
    if (pack.stripe_session_id) {
      try {
        const s = await stripe.checkout.sessions.retrieve(String(pack.stripe_session_id))
        verdict =
          s.status === "expired"
            ? "WOULD RE-MINT AND EMAIL — session is expired"
            : s.status === "complete"
              ? "would skip — already paid, webhook may be in flight"
              : `would skip — session still ${s.status}, the payer's link works`
      } catch (err) {
        verdict = `would skip — Stripe unreadable (${String(err).split("\n")[0]})`
      }
    }
    console.log(`  DUE   ${pack.id}  ${label}`)
    console.log(
      `        to: ${pack.bill_to_email ?? "(household payer)"} · used ${pack.credits_used}/${pack.credits_total} credits`,
    )
    console.log(`        ${verdict}\n`)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
