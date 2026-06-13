import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { sellPackSchema } from "@/lib/validators/session-packs"
import { getProductById } from "@/lib/db/session-pack-products"
import { createClientPackage } from "@/lib/db/client-packages"
import { buildPackageInsert } from "@/lib/services/session-credits"
import { createPackCheckoutSession } from "@/lib/stripe"
import { recordAudit } from "@/lib/audit/record"
import { assignProgram } from "@/lib/services/assign-program"
import { getAssignmentByUserAndProgram } from "@/lib/db/assignments"

/**
 * Sell a session pack to a client.
 * - paymentMethod "stripe": creates a Checkout Session, returns { url }. The pack
 *   row is created immediately (status active, payment pending); the webhook
 *   promotes it to paid.
 * - paymentMethod "cash" | "comp": creates the pack directly (paid / not_required).
 */
export async function POST(request: Request) {
  try {
    const session = await auth()
    if (!session?.user?.id || session.user.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
    }

    const parsed = sellPackSchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request", details: parsed.error.flatten().fieldErrors },
        { status: 400 },
      )
    }
    const input = parsed.data

    // Resolve pack shape from a catalogue product or the ad-hoc fields.
    let name: string
    let sessionType: string
    let credits: number
    let priceCents: number
    let validityDays: number | null
    let stripePriceId: string | null = null
    const productId = input.productId ?? null

    if (input.productId) {
      const product = await getProductById(input.productId)
      name = product.name
      sessionType = product.session_type
      credits = product.credits
      priceCents = product.price_cents
      validityDays = product.validity_days
      stripePriceId = product.stripe_price_id
    } else if (input.adhoc) {
      name = `${input.adhoc.credits}× ${input.adhoc.sessionType}`
      sessionType = input.adhoc.sessionType
      credits = input.adhoc.credits
      priceCents = input.adhoc.priceCents
      validityDays = input.adhoc.validityDays ?? null
    } else {
      return NextResponse.json({ error: "Provide productId or adhoc pack" }, { status: 400 })
    }

    const now = new Date()

    // Optionally link a program: resolve-or-create a COMPLIMENTARY assignment
    // (the pack is the payment), and store its id on the pack so check-ins advance it.
    let assignmentId: string | null = null
    if (input.programId) {
      try {
        const { assignment, skipped } = await assignProgram({
          programId: input.programId,
          userId: input.clientUserId,
          startDate: now.toISOString().slice(0, 10),
          assignedBy: session.user.id,
          complimentary: true,
        })
        if (assignment) {
          assignmentId = assignment.id
        } else if (skipped) {
          const existing = await getAssignmentByUserAndProgram(input.clientUserId, input.programId)
          assignmentId = existing?.id ?? null
        }
      } catch (err) {
        console.error("[sell pack] program link failed:", err)
      }
    }

    if (input.paymentMethod === "stripe") {
      const checkout = await createPackCheckoutSession({
        clientUserId: input.clientUserId,
        name,
        sessionType,
        credits,
        priceCents,
        validityDays,
        productId,
        stripePriceId,
        returnUrl: input.returnUrl,
      })
      const pkg = await createClientPackage(
        buildPackageInsert({
          clientUserId: input.clientUserId,
          productId,
          assignmentId,
          sessionType,
          credits,
          priceCents,
          validityDays,
          paymentMethod: "stripe",
          createdBy: session.user.id,
          now,
          stripeSessionId: checkout.id,
          notes: input.notes ?? null,
        }),
      )
      return NextResponse.json({ url: checkout.url, packageId: pkg.id })
    }

    // cash / comp — create the pack directly
    const pkg = await createClientPackage(
      buildPackageInsert({
        clientUserId: input.clientUserId,
        productId,
        assignmentId,
        sessionType,
        credits,
        priceCents,
        validityDays,
        paymentMethod: input.paymentMethod,
        createdBy: session.user.id,
        now,
        notes: input.notes ?? null,
      }),
    )

    void recordAudit({
      action: "pack.sold",
      category: "commerce",
      outcome: "success",
      target: { type: "client_package", id: pkg.id, label: name },
      metadata: { payment_method: input.paymentMethod, credits, price_cents: priceCents, client_user_id: input.clientUserId },
      request,
    })

    return NextResponse.json({ package: pkg }, { status: 201 })
  } catch (error) {
    console.error("Sell pack error:", error)
    return NextResponse.json({ error: "Failed to sell pack" }, { status: 500 })
  }
}
