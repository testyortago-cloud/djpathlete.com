import dotenv from "dotenv"
import { createClient } from "@supabase/supabase-js"
import { randomUUID } from "node:crypto"
import { mkdirSync, writeFileSync } from "node:fs"
import assert from "node:assert/strict"

async function main() {
  const env = dotenv.config({ path: ".env.local", quiet: true }).parsed!
  assert.equal(
    new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname,
    "anjvztjiokcgiyhobknq.supabase.co",
    "Development clone only",
  )
  const { acquirePackPaymentLinkEdit, releasePackPaymentLinkEdit, updateLeasedPackPaymentLink } =
    await import("../lib/db/client-packages")
  const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)
  const { data: pack, error } = await db
    .from("client_packages")
    .insert({
      client_user_id: "f7942da3-5593-40e3-88da-fc5c213d6bae",
      session_type: "Personal training",
      credits_total: 10,
      credits_used: 8,
      price_cents: 150000,
      payment_status: "pending",
      payment_method: "cash",
      status: "active",
    })
    .select("*")
    .single()
  if (error) throw error
  const checks: Record<string, boolean> = {}
  try {
    const tokens = [randomUUID(), randomUUID()]
    // This deliberate race proves that Postgres grants only one lease.
    const claimed = await Promise.all(tokens.map((token) => acquirePackPaymentLinkEdit(pack, token)))
    assert.equal(claimed.filter(Boolean).length, 1)
    checks.oneWinnerInConcurrentClaim = true
    const winner = tokens[claimed.findIndex(Boolean)]
    const loser = tokens[claimed.findIndex((value) => !value)]
    await assert.rejects(updateLeasedPackPaymentLink(pack.id, loser, { price_cents: 1 }))
    checks.nonOwnerCannotWrite = true
    await releasePackPaymentLinkEdit(pack.id, loser)
    const { data: stillLocked, error: readError } = await db
      .from("client_packages")
      .select("payment_link_edit_token")
      .eq("id", pack.id)
      .single()
    if (readError) throw readError
    assert.equal(stillLocked.payment_link_edit_token, winner)
    checks.nonOwnerCannotRelease = true
    const { error: expiryError } = await db
      .from("client_packages")
      .update({ payment_link_edit_expires_at: "2020-01-01T00:00:00Z" })
      .eq("id", pack.id)
    if (expiryError) throw expiryError
    await assert.rejects(updateLeasedPackPaymentLink(pack.id, winner, { price_cents: 1 }))
    checks.expiredOwnerCannotWrite = true
    const recoveredToken = randomUUID()
    assert.ok(await acquirePackPaymentLinkEdit(pack, recoveredToken))
    checks.deadWorkerLeaseRecovered = true
    await assert.rejects(updateLeasedPackPaymentLink(pack.id, winner, { price_cents: 1 }))
    const corrected = await updateLeasedPackPaymentLink(pack.id, recoveredToken, { price_cents: 75000 })
    assert.equal(corrected.price_cents, 75000)
    assert.equal(corrected.credits_total, 10)
    assert.equal(corrected.credits_used, 8)
    checks.recoveredOwnerCanCorrectPrice = true
    const { error: paidError } = await db.from("client_packages").update({ payment_status: "paid" }).eq("id", pack.id)
    if (paidError) throw paidError
    await assert.rejects(updateLeasedPackPaymentLink(pack.id, recoveredToken, { price_cents: 1 }))
    checks.paidDuringEditCannotBeChanged = true
    await releasePackPaymentLinkEdit(pack.id, recoveredToken)
  } finally {
    const { error: cleanupError } = await db.from("client_packages").delete().eq("id", pack.id)
    if (cleanupError) throw cleanupError
    checks.temporaryPackRemoved = true
    mkdirSync("screenshots/pack-price-correction", { recursive: true })
    writeFileSync("screenshots/pack-price-correction/lease-checks.json", JSON.stringify(checks, null, 2))
  }
  console.log(JSON.stringify(checks))
}
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
