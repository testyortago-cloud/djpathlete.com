import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { programFormSchema } from "@/lib/validators/program"
import { createProgram } from "@/lib/db/programs"
import { createStripeProductAndPrice } from "@/lib/stripe"

export async function POST(request: Request) {
  try {
    const session = await auth()
    const body = await request.json()

    const result = programFormSchema.safeParse(body)

    if (!result.success) {
      console.error("[API programs POST] Validation failed:", result.error.flatten().fieldErrors)
      return NextResponse.json(
        { error: "Invalid form data", details: result.error.flatten().fieldErrors },
        { status: 400 }
      )
    }

    const data = result.data

    // Create Stripe Product + Price for paid programs
    let stripe_product_id: string | null = null
    let stripe_price_id: string | null = null

    if (data.payment_type !== "free" && data.price_cents) {
      const stripeResult = await createStripeProductAndPrice({
        name: data.name,
        description: data.description,
        priceCents: data.price_cents,
        paymentType: data.payment_type,
        billingInterval: data.billing_interval,
        programId: "", // will be set after program creation if needed
      })
      stripe_product_id = stripeResult.productId
      stripe_price_id = stripeResult.priceId
    }

    const program = await createProgram({
      ...data,
      stripe_product_id,
      stripe_price_id,
      is_active: true,
      created_by: session?.user?.id ?? null,
      is_ai_generated: false,
      ai_generation_params: null,
    })

    // Update Stripe product metadata with actual program ID
    if (stripe_product_id) {
      const { stripe } = await import("@/lib/stripe")
      await stripe.products.update(stripe_product_id, {
        metadata: { programId: program.id },
      })
    }

    return NextResponse.json(program, { status: 201 })
  } catch (err) {
    console.error("[API programs POST] Error:", err)
    return NextResponse.json(
      { error: "Failed to create program. Please try again." },
      { status: 500 }
    )
  }
}
