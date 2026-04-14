import { NextResponse } from "next/server"
import { programFormSchema } from "@/lib/validators/program"
import { updateProgram, deleteProgram, getProgramById } from "@/lib/db/programs"
import { createStripeProductAndPrice, updateStripeProduct, archiveAndCreateNewPrice } from "@/lib/stripe"

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const body = await request.json()
    const result = programFormSchema.safeParse(body)

    if (!result.success) {
      return NextResponse.json(
        { error: "Invalid form data", details: result.error.flatten().fieldErrors },
        { status: 400 },
      )
    }

    const data = result.data
    const existing = await getProgramById(id)

    let stripe_product_id = existing.stripe_product_id
    let stripe_price_id = existing.stripe_price_id

    if (data.payment_type === "free") {
      // Switching to free — archive Stripe price if it exists
      if (stripe_price_id) {
        const { stripe } = await import("@/lib/stripe")
        await stripe.prices.update(stripe_price_id, { active: false })
      }
      stripe_price_id = null
    } else if (data.price_cents) {
      if (!stripe_product_id) {
        // No Stripe product yet — create one
        const stripeResult = await createStripeProductAndPrice({
          name: data.name,
          description: data.description,
          priceCents: data.price_cents,
          paymentType: data.payment_type,
          billingInterval: data.billing_interval,
          programId: id,
        })
        stripe_product_id = stripeResult.productId
        stripe_price_id = stripeResult.priceId
      } else {
        // Update product name/description
        await updateStripeProduct(stripe_product_id, data.name, data.description)

        // If price, payment_type, or billing_interval changed, create new price
        const priceChanged = data.price_cents !== existing.price_cents
        const typeChanged = data.payment_type !== existing.payment_type
        const intervalChanged = data.billing_interval !== existing.billing_interval

        if ((priceChanged || typeChanged || intervalChanged) && stripe_price_id) {
          stripe_price_id = await archiveAndCreateNewPrice({
            productId: stripe_product_id,
            oldPriceId: stripe_price_id,
            priceCents: data.price_cents,
            paymentType: data.payment_type,
            billingInterval: data.billing_interval,
          })
        }
      }
    }

    const program = await updateProgram(id, {
      ...data,
      stripe_product_id,
      stripe_price_id,
    })

    return NextResponse.json(program)
  } catch {
    return NextResponse.json({ error: "Failed to update program. Please try again." }, { status: 500 })
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    await deleteProgram(id)
    return NextResponse.json({ success: true })
  } catch {
    return NextResponse.json({ error: "Failed to delete program. Please try again." }, { status: 500 })
  }
}
