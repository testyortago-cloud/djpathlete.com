// Read-only check: confirm a Stripe price's type/recurrence.
// Run: npx tsx scripts/check-stripe-price.ts <price_id>
import { config } from "dotenv"
config({ path: ".env.local" })
import Stripe from "stripe"

async function main() {
  const priceId = process.argv[2] ?? "price_1TCfPaGBpu1V9kTubXTl5iTM"
  const productId = process.argv[3] ?? "prod_UB1SYTfUUDsawr"
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) throw new Error("STRIPE_SECRET_KEY not set")
  console.log(`[check] Using key mode: ${key.startsWith("sk_test_") ? "TEST" : key.startsWith("sk_live_") ? "LIVE" : "UNKNOWN"}`)

  const stripe = new Stripe(key)

  console.log(`\n[check] Listing active prices for product ${productId}`)
  try {
    const prices = await stripe.prices.list({ product: productId, active: true, limit: 100 })
    if (prices.data.length === 0) {
      console.log("  (no active prices on this product)")
    }
    for (const p of prices.data) {
      console.log(
        `  - ${p.id}  type=${p.type}  ${p.recurring ? `recurring/${p.recurring.interval}` : "one_time"}  amount=${p.unit_amount} ${p.currency}  active=${p.active}`,
      )
    }
  } catch (err) {
    console.log("  product lookup failed:", (err as Error).message)
  }

  console.log(`\n[check] Stripe price: ${priceId}`)
  const price = await stripe.prices.retrieve(priceId, { expand: ["product"] })
  const product = price.product as Stripe.Product

  console.log({
    id: price.id,
    active: price.active,
    type: price.type,
    recurring: price.recurring
      ? {
          interval: price.recurring.interval,
          interval_count: price.recurring.interval_count,
          usage_type: price.recurring.usage_type,
        }
      : null,
    unit_amount: price.unit_amount,
    currency: price.currency,
    nickname: price.nickname,
    product: {
      id: product?.id,
      name: product?.name,
      active: product?.active,
    },
  })

  if (price.type === "recurring") {
    console.log("\n✓ This price is RECURRING — subscription checkout will work.")
  } else {
    console.log(
      "\n✗ This price is ONE-TIME — subscription checkout will fail. You need to create a recurring price.",
    )
  }
}

main().catch((err) => {
  console.error("CHECK FAILED:", err.message)
  process.exit(1)
})
