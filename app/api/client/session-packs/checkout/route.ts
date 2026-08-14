import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { selfCheckoutSchema } from "@/lib/validators/session-packs"
import { getProductById } from "@/lib/db/session-pack-products"
import { createClientPackage } from "@/lib/db/client-packages"
import { buildPackageInsert } from "@/lib/services/session-credits"
import { createPackCheckoutSession } from "@/lib/stripe"
import { clientSelfPurchaseEnabled } from "@/lib/packs/flags"
import { recordAudit } from "@/lib/audit/record"

/**
 * Client self-purchase of a session pack. Stripe only; the pack is created
 * pending (the webhook promotes it on payment) and stays UNLINKED to any
 * program. The buyer is the authenticated session user — never a body id.
 */
export async function POST(request: Request) {
  try {
    if (!(await clientSelfPurchaseEnabled())) {
      return NextResponse.json({ error: "Self-purchase is not enabled" }, { status: 403 })
    }

    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    if (session.user.role !== "client") return NextResponse.json({ error: "Forbidden" }, { status: 403 })

    const parsed = selfCheckoutSchema.safeParse(await request.json())
    if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 })

    const product = await getProductById(parsed.data.productId).catch(() => null)
    if (!product || !product.is_active) {
      return NextResponse.json({ error: "Product not available" }, { status: 404 })
    }

    const clientUserId = session.user.id
    const now = new Date()
    const checkout = await createPackCheckoutSession({
      clientUserId,
      name: product.name,
      sessionType: product.session_type,
      credits: product.credits,
      priceCents: product.price_cents,
      validityDays: product.validity_days,
      productId: product.id,
      stripePriceId: product.stripe_price_id,
      // Consent checkbox: save the client's own card so a depleted pack can
      // auto-buy its replacement.
      autoRenew: parsed.data.autoRenew,
      returnUrl: "/client/sessions",
      cancelUrl: "/client/sessions/buy",
    })

    const pkg = await createClientPackage(
      buildPackageInsert({
        clientUserId,
        productId: product.id,
        assignmentId: null,
        sessionType: product.session_type,
        credits: product.credits,
        priceCents: product.price_cents,
        validityDays: product.validity_days,
        paymentMethod: "stripe",
        createdBy: clientUserId,
        now,
        stripeSessionId: checkout.id,
      }),
    )

    void recordAudit({
      action: "pack.sold",
      category: "commerce",
      outcome: "success",
      actor: { id: clientUserId, email: session.user.email ?? null, role: "client" },
      target: { type: "client_package", id: pkg.id, label: product.name },
      metadata: {
        payment_method: "stripe",
        self_purchase: true,
        client_user_id: clientUserId,
        credits: product.credits,
        price_cents: product.price_cents,
      },
      request,
    })

    return NextResponse.json({ url: checkout.url, packageId: pkg.id })
  } catch (error) {
    console.error("Client pack checkout error:", error)
    return NextResponse.json({ error: "Failed to start checkout" }, { status: 500 })
  }
}
